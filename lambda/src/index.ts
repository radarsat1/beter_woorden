import { Handler } from 'aws-lambda';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage, AIMessage, BaseMessage } from '@langchain/core/messages';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

// --- CONFIGURATION ---
const LLM_CONFIG = {
  model: process.env.LLM_MODEL,
  apiKey: process.env.LLM_API_KEY,
  configuration: {
    baseURL: process.env.LLM_BASE_URL,
  },
  maxRetries: 2,
  timeout: 300000,
};
console.log('LLM_CONFIG:', JSON.stringify(LLM_CONFIG));

// --- SCHEMAS ---
const QuizQuestionSchema = z.object({
  question: z.string(),
  answer: z.string(),
  english: z.string(),
});

const QuizResponseSchema = z.object({
  exercises: z.array(QuizQuestionSchema),
});

const QuizRequestSchema = z.object({
  prompt: z.any(),
  quiz_id: z.number(),
  request_id: z.union([z.string(), z.number()]).optional(),
});

const QuizRequestBatchSchema = z.object({
  user_id: z.string(),
  user_token: z.string(),
  webhook: z.string(),
  requests: z.looseRecord(z.string(), QuizRequestSchema),
});

type QuizRequest = z.infer<typeof QuizRequestSchema>;
type QuizRequestBatch = z.infer<typeof QuizRequestBatchSchema>;

// --- HELPERS ---

const verifyToken = (token: string, userId: string): boolean => {
  try {
    // Decode without verifying signature just to check 'sub' (User ID) mismatch.
    // In production, verify the signature with your secret/public key!
    const decoded = jwt.decode(token) as { sub: string } | null;
    if (!decoded || decoded.sub !== userId) {
      console.warn(`Security Alert | Token sub '${decoded?.sub}' !== request user '${userId}'`);
      return false;
    }
    return true;
  } catch (e) {
    return false;
  }
};

const reconstructMessages = (promptData: any): BaseMessage[] => {
  const messages: BaseMessage[] = [];
  const rawMessages = promptData.kwargs?.messages || [];
  for (const m of rawMessages) {
    const roleId = m.id[m.id.length - 1];
    const content = m.kwargs.content;
    if (roleId === 'SystemMessage') messages.push(new SystemMessage(content));
    else if (roleId === 'AIMessage') messages.push(new AIMessage(content));
    else messages.push(new HumanMessage(content));
  }
  return messages;
};

// --- HANDLER ---

export const handler: Handler = async (event: any) => {
  console.log(`event: ${JSON.stringify(event)}`);
  // Validate Input
  let batch: QuizRequestBatch;
  try {
    // Handle case where it might still be stringified (depending on how you invoke)
    const payload = typeof event === 'string' ? JSON.parse(event) : event;
    batch = QuizRequestBatchSchema.parse(payload);
  } catch (e) {
    console.error("Schema Validation Error", e);
    // In 'Event' invocation, throwing an error logs it to CloudWatch
    // but the caller (Deno) won't see it (fire-and-forget).
    return;
  }

  // Security Check
  if (!verifyToken(batch.user_token, batch.user_id)) {
    console.error(`Forbidden: User ID mismatch for User ${requests.user_id}`);
    return; // Exit silently or log to a security DLQ
  }

  // Initialize LLM
  const llm = new ChatOpenAI({...LLM_CONFIG, temperature: 1});
  const structuredLLM = llm.withStructuredOutput(QuizResponseSchema);

  const results = Object.fromEntries(await Promise.all(Object.entries(batch.requests).map(
    async ([task_id, request]) => {
      console.log(`Task Started | Quiz ID: ${request.quiz_id}`);

      // Allow user to attach some limited metadata as request_id and also include user_id
      // in each result to simplify webhook reception.
      let meta = {request_id: request.request_id, user_id: batch.user_id};
      if (meta.request_id?.length < 1 || meta.request_id?.length > 128)
        meta = {user_id: batch.user_id};

      // Run Logic
      try {
        const messages = reconstructMessages(request.prompt);
        console.log(`LLM invocation | Quiz ${request.quiz_id}`);
        const result = await structuredLLM.invoke(messages);
        console.log(`LLM Success | Quiz ${request.quiz_id}`);
        return [task_id, {quiz_id: request.quiz_id, status: 'success', ...result, ...meta}];
      } catch (error: any) {
        console.error(`Task Failed | Error: ${JSON.stringify(error)}`);
        return [task_id, {quiz_id: request.quiz_id, status: 'error',
                          error_detail: JSON.stringify(error), ...meta}];
      }
    }
  )));

  // Send the webhook
  const webhook_result = await fetch(
    batch.webhook,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + batch.user_token,
      },
      timeout: 30000,
      body: JSON.stringify(results),
    }
  );
  console.log(`Webhook sent, status ${webhook_result.status}`);
};
