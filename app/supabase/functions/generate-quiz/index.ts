import { createClient } from "@supabase/supabase-js";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOpenAI } from "@langchain/openai";
import { StateGraph, Command, interrupt } from "@langchain/langgraph";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import * as cheerio from "cheerio";
import { z } from "zod";
import { corsHeaders, corsJsonHeaders } from "../_shared/cors.ts"

import { SupabaseSaver } from "./SupabaseSaver.ts";
import { callWorkerAsync } from "./worker.ts";

// --- Config ---
const NUM_SENTENCES = 10;

// --- Interfaces ---
interface QuizQuestion {
  question: string;
  answer: string;
  english: string;
}

// Validation for new quiz request
const NewQuizSchema = z.object({
  word_list_ids: z.array(z.number()).optional().default([]),
  language: z.string().optional().default("Dutch"),
  quiz_type: z.string().optional().default("masked-word"),
  article_source: z.string().optional().default("nos.nl"), // TODO: support other sources
  article_type: z.string().optional().default("Article"),
  article_url: z.string().optional(),
  article_title: z.string().optional(),
  article_text: z.string().optional(),
  meta: z.unknown()
    .optional()
    .superRefine((val, ctx) => { // Ensure it is not a large object
      if (!val) return;
      const size = new TextEncoder().encode(JSON.stringify(val)).length;
      if (size > 512) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Meta JSON too large (${size}/512 bytes)`,
        });
      }
    }),
}).refine(
  // Ensure that if article_text is provided, then article_title is also provided.  This
  // is because if we are scraping from URL, we get both, but if article_text is provided,
  // we skip scraping, so w e have to ensure we have something to display.
  (data) => (!data.article_text || data.article_title), {
    message: "A title is required if you provide content text.",
    path: ["title"], // Highlights the missing 'title' field in the error
  });
type NewQuizRequest = z.infer<typeof NewQuizSchema>;

interface AgentState extends NewQuizRequest {
  // Inputs
  user_token: string;
  user_id: string;
  thread_id: string;

  // Job Data
  quiz_id?: number;
  target_words: string[];

  // Output
  generated_quiz?: QuizQuestion[];
  error?: string;
}

interface GenerateResponseItem {
  status: string;
}

interface GenerateResponse extends Record<string, GenerateResponseItem> {};

// --- Supabase Helpers ---
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabaseGlobal = createClient(supabaseUrl, supabaseKey);
const checkpointer = new SupabaseSaver(supabaseGlobal);

function supabaseClient(user_token: string) {
  return createClient(supabaseUrl, supabaseKey, {
    global: { headers: { Authorization: `Bearer ${user_token}` } },
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

// --- Node Functions ---

async function fetchWordsNode(state: AgentState): Promise<Partial<AgentState>> {
  if (state.error) return {};
  console.log("--- Step 1: Fetching Target Words ---");

  const supabase = supabaseClient(state.user_token);

  // If no word lists, return defaults based on language
  if (!state.word_list_ids || state.word_list_ids.length === 0) {
    if (state.language.toLowerCase() === 'dutch') {
        return { target_words: ["nieuws", "vandaag", "belangrijk"] };
    }
    return { target_words: ["general", "vocabulary", "context"] };
  }

  const { data, error } = await supabase
    .from("word_lists")
    .select("words")
    .in("id", state.word_list_ids);

  if (error) return { error: `DB Error: ${error.message}` };
  const allWords: string[] = data.flatMap((row: any) => row.words || []);
  const uniqueWords = [...new Set(allWords)];

  return { target_words: uniqueWords.length > 0 ? uniqueWords : ["general"] };
}

// This node only runs if we need to find a URL (none provided)
async function pickArticleNode(state: AgentState): Promise<Partial<AgentState>> {
  if (state.error) return {};
  console.log("--- Step 2: Picking Random Article ---");

  // Safety check: Random picker currently only supports Dutch/NOS
  if (state.language.toLowerCase() !== 'dutch' || state.article_source !== 'nos.nl') {
    return { error: "Random article picker only supported for Dutch (NOS.nl). Please provide a URL for other languages." };
  }

  try {
    const response = await fetch("https://nos.nl");
    const html = await response.text();
    const $ = cheerio.load(html);

    const links: string[] = [];
    $("a[href*='/artikel/']").each((_, element) => {
      const href = $(element).attr("href");
      if (href) links.push(href);
    });

    if (links.length === 0) return { error: "No articles found" };
    const selectedPath = links[Math.floor(Math.random() * links.length)];

    return {
        article_url: `https://nos.nl${selectedPath}`
    };
  } catch (e: any) {
    return { error: e.message };
  }
}

// This node only runs if we have a URL but no Text
async function scrapeContentNode(state: AgentState): Promise<Partial<AgentState>> {
  if (state.error) return {};
  // Double check in case graph logic slipped (though edge ensures this won't happen often)
  if (!state.article_url) return { error: "No URL to scrape" };

  console.log(`--- Step 3: Scraping ${state.article_url} ---`);

  try {
    const response = await fetch(state.article_url);
    if (!response.ok) throw new Error(`Failed to fetch URL: ${response.statusText}`);
    const html = await response.text();
    const $ = cheerio.load(html);

    let title = "";
    let textContent = "";

    // -- Specific Scraper: NOS.nl --
    if (state.article_url.includes("nos.nl")) {
        title = $("title").text().replace(" | NOS", "").trim();
        let paragraphs = $("article p");
        if (paragraphs.length === 0) paragraphs = $("p");

        const textParts: string[] = [];
        paragraphs.each((_, el) => textParts.push($(el).text()));
        textContent = textParts.join(" ");
    }
    // -- Generic Scraper --
    else {
        // Cleanup
        $('script, style, nav, footer, header').remove();

        title = $("title").text().trim() || "Web Article";

        // Attempt to isolate main content
        let contentSelection = $("article");
        if (contentSelection.length === 0) contentSelection = $("main");
        if (contentSelection.length === 0) contentSelection = $("body");

        const textParts: string[] = [];
        contentSelection.find("p").each((_, el) => {
            const txt = $(el).text().trim();
            if (txt.length > 50) textParts.push(txt);
        });
        textContent = textParts.join(" ");
    }

    if (!textContent || textContent.length < 100) {
        return { error: "Could not extract sufficient text from the URL." };
    }

    return {
      article_text: textContent.slice(0, 8000),
      article_title: title
    };
  } catch (e: any) {
    return { error: `Scraping error: ${e.message}` };
  }
}

async function triggerWorkerNode(state: AgentState): Promise<Partial<AgentState>> {
  if (state.error || !state.article_text) {
    console.log(state.error || "No article text found");
    return {};
  }
  console.log("--- Step 4: Generating Quiz ---");

  const supabase = supabaseClient(state.user_token);

  // 1. Prepare Prompt Payload
  const promptText = `
    You are a {language} language teacher creating {quiz_type} exercises.

    CONTEXT CONTENT:
    {article_text}

    TARGET WORDS TO INCLUDE:
    {target_words}

    TASK:
    1. Extract or create {num_sentences} simplified sentences based on the context. Try to
       include the target words in at least {subset_sentences} of the {num_sentences} sentences.
    2. Choose one word per sentence that is self-evident from context, again focusing on
       the target words as much as possible.
    3. Include a field with the English translation.
    4. Respond ONLY with a valid JSON list.

    FORMAT EXAMPLE:
    {{"exercises": [
      {{"question": "Het schrijven van een brief is een lastige klus.", "answer": klus", "english": "Writing a letter is a difficult task."}},
      ...
    ]}}

    GROUND RULES:
    - Ensure that the contents of the "answer" field appears exactly in the "question"
      field. You are permitted (though not encouraged) to use a modified form of the target
      word, but if you do, it must appear in "answer" in exactly the modified form.
    - For the reason above, for modified forms that split two parts of the word to different
      parts of the sentence, choose one part. Again, modifying the words is not encouraged,
      only to be done if it helps formulate a good question.
    - Ensure that the question is related to the article, do not make a question unrelated to
      the article just so you can use a target word. Instead, select target words that make
      sense for questions related to the article.
    `;

  const prompt = await ChatPromptTemplate.fromTemplate(promptText).invoke({
    language: state.language,
    quiz_type: state.quiz_type,
    article_text: state.article_text,
    target_words: state.target_words.join(", "),
    num_sentences: NUM_SENTENCES,
    subset_sentences: Math.floor(NUM_SENTENCES * 0.75),
  });

  // 2. Insert Placeholder Quiz in DB
  const context = {
    title: state.article_title,
    url: state.article_url,
    type: state.article_type,
  };
  if (state.meta)
    context.meta = state.meta;
  const { data: quiz, error: quizError } = await supabase
    .from("quizzes")
    .insert({
      user_id: state.user_id,
      context: context,
      content: null,
      type: state.quiz_type.toLowerCase(),
      language: state.language.toLowerCase(),
      status: "generating"
    })
    .select("id")
    .single();

  if (quizError) return { error: quizError.message };

  // 3. Call External Worker
  try {
    console.log(`Triggering worker for quiz_id: ${quiz.id}`);
    await callWorkerAsync({
      user_id: state.user_id,
      webhook: supabaseUrl + '/functions/v1/generate-quiz',
      user_token: state.user_token,
      requests: {
        [state.thread_id]: {
          prompt: prompt,
          quiz_id: quiz.id,
        }
      }
    });

  } catch (e: any) {
    console.log(`Caught error while calling external worker: ${e}`);

    const { error: quizError2 } = await supabase
      .from("quizzes")
      .update({
        status: 'error',
      })
      .eq('id', quiz.id)
      .select()
      .single();

    if (quizError2) return { error: `Failed saving worker error ${e.message}: ${quizError2.message}` };
    return { error: `Failed to call worker: ${e.message}` };
  }

  return { quiz_id: quiz.id };
}

// checks DB, updates state, returns
async function checkStatusNode(state: AgentState): Promise<Partial<AgentState>> {
  if (state.error || !state.article_text) return {};
  console.log(`--- Checking Status for Quiz ${state.quiz_id} ---`);

  const supabase = supabaseClient(state.user_token);
  const { data, error } = await supabase
    .from("quizzes")
    .select("content, status")
    .eq("id", state.quiz_id)
    .single();
  console.log(`Quiz ${state.quiz_id} has status ${data.status}`);

  if (error) return { error: error.message };
  if (data.content !== null) return { generated_quiz: data.content };
  if (data.status === 'error') return { error: "Worker reported an error" };

  // If content is ready
  if (data.content !== null) {
    return { generated_quiz: data.content };
  }

  // If error or timeout, handle logic here...
  if (data.status === 'error') return { error: "Worker error" };

  // If still waiting, the state remains generated_quiz: undefined.
  return {};
}

// handles the pause so that if we resume here we don't have to re-execute the query, we
// rely on the graph to cycle back to check_status for that.
function waitNode(state: AgentState) {
  console.log("--- Pause: Waiting for Client/Worker ---");
  // This value is returned when the client calls resume
  const result = interrupt("Waiting for external worker...");

  if (result === 'poll')
    return {};

  if (result.quiz_id !== state.quiz_id || result.user_id !== state.user_id) {
    throw new Error("Unexpected content from worker.");
  }

  return { generated_quiz: result.exercises };
}

async function finalizeQuizNode(state: AgentState): Promise<Partial<AgentState>> {
  if (state.error) return {};
  console.log("--- Step 6: Finalizing Quiz ---");

  const supabase = supabaseClient(state.user_token);

  // Update content and status
  await supabase
    .from("quizzes")
    .update({ status: "ready", content: state.generated_quiz })
    .eq("id", state.quiz_id);

  // Link Word Lists
  if (state.word_list_ids && state.word_list_ids.length > 0) {
    const links = state.word_list_ids.map(id => ({
      quiz_id: state.quiz_id,
      word_list_id: id
    }));
    await supabase.from("quiz_word_lists").insert(links);
  }

  return {};
}

// --- Graph Definition ---

// Conditional Router Logic
function routeSourceSelection(state: AgentState) {
    // 1. If text is already provided, skip sourcing entirely.
    if (state.article_text) {
        return "trigger_worker";
    }
    // 2. If URL is provided but no text, scrape it.
    if (state.article_url) {
        return "scrape_content";
    }
    // 3. Otherwise, pick a random article.
    return "pick_article";
}

const workflow = new StateGraph<AgentState>({
  channels: {
    user_token: null,
    user_id: null,
    thread_id: null,
    word_list_ids: null,
    language: null,
    quiz_type: null,
    target_words: null,
    article_source: null,
    article_type: null,
    article_url: null,
    article_title: null,
    article_text: null,
    generated_quiz: null,
    quiz_id: null,
    error: null
  }
});

workflow.addNode("fetch_words", fetchWordsNode);
workflow.addNode("pick_article", pickArticleNode);
workflow.addNode("scrape_content", scrapeContentNode);
workflow.addNode("trigger_worker", triggerWorkerNode);
workflow.addNode("check_status", checkStatusNode);
workflow.addNode("wait_node", waitNode);
workflow.addNode("finalize_quiz", finalizeQuizNode);

// Start
workflow.addEdge("__start__", "fetch_words");

// Conditional Edge: Determine source strategy
workflow.addConditionalEdges(
    "fetch_words",
    routeSourceSelection,
    {
        trigger_worker: "trigger_worker",
        scrape_content: "scrape_content",
        pick_article: "pick_article"
    }
);

// Standard flow adjustments
workflow.addEdge("pick_article", "scrape_content"); // Picked -> Scrape
workflow.addEdge("scrape_content", "trigger_worker"); // Scraped -> Trigger

// Worker flow
workflow.addEdge("trigger_worker", "check_status");
workflow.addEdge("check_status", "wait_node");

// Conditional Edge: Status check loop
workflow.addConditionalEdges(
  "wait_node",
  (state) => {
    if (state.error) return "finalize_quiz"; // Proceed to end (or error handler)
    if (state.generated_quiz) return "finalize_quiz"; // Done
    return "check_status"; // Interrupt and cycle back
  },
  {
    finalize_quiz: "finalize_quiz",
    check_status: "check_status"
  }
);

const app = workflow.compile({ checkpointer });

// --- HTTP Handler ---

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing Authorization header");
    const token = authHeader.replace("Bearer ", "");
    const supabase = supabaseClient(token);

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (!user) throw new Error("Unauthorized: " + authError);

    const body = await req.json();
    const threadPromises: Record<string, Promise<any>> = {};
    let response: GenerateResponse = {}

    // --- Check each requested thread ---
    for (const threadId of Object.keys(body)) {
      if (threadId === 'new_quiz') {
        const reqData = NewQuizSchema.parse(body.new_quiz);
        const newThreadId = `${user.id}-${Date.now()}`;

        // Map inputs directly to AgentState fields
        const initialState: AgentState = {
          ...reqData,
          user_token: token,
          user_id: user.id,
          thread_id: newThreadId,
          target_words: [],
        };

        // Run until the first interrupt (at check_status)
        const config = { configurable: { thread_id: newThreadId } };
        threadPromises[newThreadId] = app.invoke(initialState, config);
      }
      else {
        // --- Poll Existing Thread ---
        // We only try to resume threads that belong to this user (the threadID convention
        // helps, or Supabase Checkpointer RLS)
        if (!threadId.startsWith(user.id)) {
          response[threadId] = { status: "forbidden" };
          continue;
        }

        // Check current state
        const config = { configurable: { thread_id: threadId } };
        const stateSnapshot = await app.getState(config);

        // If graph is finished or error
        if (!stateSnapshot.next || stateSnapshot.next.length === 0) {
           response[threadId] = {
             status: "completed",
           };
        }

        // If graph is interrupted (tasks exist), we resume it to Poll the DB again
        else if (stateSnapshot.tasks && stateSnapshot.tasks.length > 0) {
          console.log(`Resuming thread ${threadId} to check status...`);
          threadPromises[threadId] = await app.invoke(
            new Command({ resume: body[threadId] }),
            config
          );
        }

        else {
           response[threadId] = {
             status: "unknown",
           };
        }
      }
    }

    // Await all graphs concurrently
    await Promise.all(Object.values(threadPromises));

    // Determine status based on state (is it done now?)
    for (const threadId of Object.keys(threadPromises)) {
      const config = { configurable: { thread_id: threadId } };
      const finalState = await app.getState(config);
      const isDone = !finalState.next || finalState.next.length === 0;
      response[threadId] = {
        status: isDone ? "completed" : "processing",
      };
      if (finalState.values.error) response[threadId].status = "error";
    }

    console.log(`Returning ${JSON.stringify(response)}`);
    return new Response(JSON.stringify(response),
                        { status: 200, headers: corsJsonHeaders });

  } catch (err: any) {
    console.error(err);
    return new Response(JSON.stringify({ error: err.message } as GenerateResponse),
                        { status: 500, headers: corsJsonHeaders });
  }
});
