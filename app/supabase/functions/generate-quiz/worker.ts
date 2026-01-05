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
  requests: Record<string, QuizRequest>;
}

const WORKER_URL = Deno.env.get('GENERATE_QUIZ_WORKER_URL');
const WORKER_LAMBDA = Deno.env.get('GENERATE_QUIZ_WORKER_LAMBDA');
const CUSTOM_SECRET = Deno.env.get('CUSTOM_SECRET');

const AWS_REGION = Deno.env.get('AWS_REGION');
const AWS_ACCESS_KEY_ID = Deno.env.get('AWS_ACCESS_KEY_ID');
const AWS_SECRET_ACCESS_KEY = Deno.env.get('AWS_SECRET_ACCESS_KEY');

const aws_config = {
  accessKeyId: AWS_ACCESS_KEY_ID,
  secretAccessKey: AWS_SECRET_ACCESS_KEY,
  region: AWS_REGION,
  service: 'lambda'
};

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
  console.log(`calling worker lambda with: ${JSON.stringify(data)}`);
  const workerResp = await aws.fetch(
    `${AWS_LAMBDA_ENDPOINT}/2015-03-31/functions/${WORKER_LAMBDA}/invocations`,
    {
      body: JSON.stringify(data),
      headers: { 'X-Amz-Invocation-Type': 'Event' }
    }
  );

  if (workerResp.status != 202 && workerResp.ok) {
    // We expect Event invocation type to return 202, signifying async execution
    console.warn(`Worker lambda invocation unexpectedly returned status ${workerResp.status}`);
  }

  if (!workerResp.ok) {
    WAS HERE TRACING MYSTERIOUS ERROR
    const error = await workerResp.text();
    console.log(error);
    throw new Error(error);
  }

  // Result usually empty but log if anything was returned
  const result = await workerResp.text();
  if (result)
    console.log(`Worker returned ${workerResp.status}: ${result}`);
}

export async function callWorker(data: QuizWorkerBatchRequest) {
  if (WORKER_URL)
    return await callWorkerURL(data);
  else if (WORKER_LAMBDA)
    return await callWorkerLambda(data);

  throw new Error("No worker defined.");
}
