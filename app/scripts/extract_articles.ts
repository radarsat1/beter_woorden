
import { createClient } from "@supabase/supabase-js";
import { load } from "jsr:@std/dotenv";

const outputFilename = Deno.args[0] || "articles.json";

const cmd = new Deno.Command("npx", {
  args: ["supabase", "status", "-o", "json"],
  stdout: "piped",
});

// Wait for the process to finish and capture the output
const { code, stdout } = await cmd.output();
console.log();

const env = await JSON.parse((new TextDecoder()).decode(stdout));

const supabaseUrl = env.API_URL;
const supabaseKey = env.SECRET_KEY;
const supabase = createClient(env.API_URL, env.SECRET_KEY);

const { data: ckpts } = await supabase.from("checkpoints").select("checkpoint");

const articles: { url: string; text: string }[] = [];
const urls = new Set<string>();

for (const ckpt of ckpts) {
  if (!ckpt) continue;
  const article_url = ckpt.checkpoint.channel_values.article_url;
  const article_text = ckpt.checkpoint.channel_values.article_text;
  const article_title = ckpt.checkpoint.channel_values.article_title;
  if (!article_url || !article_text || !article_title) continue;
  if (!urls.has(article_url)) {
    articles.push({ url: article_url, text: article_text, title: article_title });
    urls.add(article_url);
  }
};

const jsonArticles = JSON.stringify(articles, null, 2);
Deno.writeTextFile(outputFilename, jsonArticles);
console.log(`Wrote ${articles.length} articles to ${outputFilename}`);
