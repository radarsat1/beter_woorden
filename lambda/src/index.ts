import { Handler } from 'aws-lambda';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage, AIMessage, BaseMessage } from '@langchain/core/messages';
import axios from 'axios';
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
  user_id: z.string(),
  webhook: z.string(),
  user_token: z.string(),
});

type QuizRequest = z.infer<typeof QuizRequestSchema>;

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
  // NOTE: When invoked via AWS SDK 'Event', 'event' IS the payload object.
  // We no longer parse event.body or check event.headers.

  console.log("Lambda Invoked (Async Worker)");

  // 1. Validate Input
  let request: QuizRequest;
  try {
    // Handle case where it might still be stringified (depending on how you invoke)
    const payload = typeof event === 'string' ? JSON.parse(event) : event;
    request = QuizRequestSchema.parse(payload);
  } catch (e) {
    console.error("Schema Validation Error", e);
    // In 'Event' invocation, throwing an error logs it to CloudWatch
    // but the caller (Deno) won't see it (fire-and-forget).
    return;
  }

  // 2. Security Check
  if (!verifyToken(request.user_token, request.user_id)) {
    console.error(`Forbidden: User ID mismatch for User ${request.user_id}`);
    return; // Exit silently or log to a security DLQ
  }

  console.log(`Task Started | Quiz ID: ${request.quiz_id}`);

  // 3. Initialize LLM
  const llm = new ChatOpenAI({...LLM_CONFIG, temperature: 1});
  const structuredLLM = llm.withStructuredOutput(QuizResponseSchema);

  // 4. Run Logic
  try {
    const messages = reconstructMessages(request.prompt);
    console.log(`LLM invocation | Quiz ${request.quiz_id}`);
    const result = await structuredLLM.invoke(messages);

    console.log(`LLM Success | Quiz ${request.quiz_id} | Sending Webhook...`);

    await axios.post(
      request.webhook,
      {
        user_id: request.user_id,
        quiz_id: request.quiz_id,
        questions: result.exercises,
        status: 'ready'
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + request.user_token,
        },
        timeout: 30000
      }
    );
    console.log(`Webhook Success`);

  } catch (error: any) {
    console.error(`Task Failed | Error: ${JSON.stringify(error)}`);

    // Attempt Error Webhook
    try {
      const response = await axios.post(
        request.webhook,
        {
          user_id: request.user_id,
          quiz_id: request.quiz_id,
          questions: null,
          status: 'error',
          error_details: error.message
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + request.user_token,
          },
          timeout: 30000
        }
      );
      console.log(`Sent error webhook: ${response.status}`);
    } catch (e) {
      console.error(`Fatal: Could not send error webhook: ${e}`);
    }
  }
};
