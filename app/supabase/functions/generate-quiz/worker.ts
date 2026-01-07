import { AwsClient } from "@aws4fetch";

export interface QuizWorkerRequest {
  prompt: any;
  quiz_id: number;
  request_id?: string | number;
}

export interface QuizWorkerBatchRequest {
  user_id: string;
  user_token: string;
  webhook: string;
  requests: Record<string, QuizWorkerRequest>;
}

const WORKER_URL = Deno.env.get('GENERATE_QUIZ_WORKER_URL');
const WORKER_LAMBDA = Deno.env.get('GENERATE_QUIZ_WORKER_LAMBDA');
const CUSTOM_SECRET = Deno.env.get('CUSTOM_SECRET');

const AWS_REGION = Deno.env.get('AWS_REGION');
const AWS_ACCESS_KEY_ID = Deno.env.get('AWS_ACCESS_KEY_ID');
const AWS_SECRET_ACCESS_KEY = Deno.env.get('AWS_SECRET_ACCESS_KEY');

const aws = WORKER_LAMBDA && new AwsClient({
  accessKeyId: AWS_ACCESS_KEY_ID,
  secretAccessKey: AWS_SECRET_ACCESS_KEY,
  region: AWS_REGION,
  service: 'lambda'
});

const AWS_LAMBDA_ENDPOINT = Deno.env.get('AWS_LAMBDA_ENDPOINT')
  || `https://lambda.${AWS_REGION}.amazonaws.com`;

async function callWorkerURL(data: QuizWorkerBatchRequest) {
  const workerResp = await fetch(WORKER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json',
               'Authorization': 'Bearer ' + data.user_token,
               'X-Custom-Secret': CUSTOM_SECRET },
    body: JSON.stringify(data)
  });

  if (!workerResp.ok) throw new Error(`Worker returned status ${workerResp.status}`);

  // Result usually empty but log if anything was returned
  const result = await workerResp.text();
  if (result)
    console.log(`Worker returned ${workerResp.status}: ${result}`);
}

async function callWorkerLambda(data: QuizWorkerBatchRequest) {
  const workerResp = await aws.fetch(
    `${AWS_LAMBDA_ENDPOINT}/2015-03-31/functions/${WORKER_LAMBDA}/invocations`,
    {
      body: JSON.stringify(data),
      headers: { 'X-Amz-Invocation-Type': 'Event' }
    }
  );

  if (workerResp.status != 202 && workerResp.ok) {
    // We expect Event invocation type to return 202, signifying async execution
    console.warn(`Worker lambda invocation unexpectedly returned status ${workerResp.status}, expected 202.`);
  }

  if (!workerResp.ok) {
    const error = await workerResp.text();
    console.log(error);
    throw new Error(error);
  }

  // Result usually empty but log if anything was returned
  const result = await workerResp.text();
  if (result)
    console.log(`Worker returned ${workerResp.status}: ${result}`);
}

export async function callWorkerAsync(data: QuizWorkerBatchRequest) {
  let worker = null;
  if (WORKER_URL)
    worker = callWorkerURL(data);
  else if (WORKER_LAMBDA)
    worker = callWorkerLambda(data);
  else
    throw new Error("No worker defined.");

  // Call it with a short initial wait so that we have a chance to catch early errors
  // (wrong URL, etc)
  const timeout = new Promise((resolve) => { setTimeout(() => { resolve("TIMEOUT"); }, 300); });

  const winner = await Promise.race([worker, timeout]);
  if (winner === "TIMEOUT") {
    console.log("Moving worker to background and returning.");
    EdgeRuntime.waitUntil(worker.then(
      () => console.log('Done calling worker.')
    ));
  }
}
