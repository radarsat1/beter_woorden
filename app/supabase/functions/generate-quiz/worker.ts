const WORKER_URL = Deno.env.get('GENERATE_QUIZ_WORKER_URL');
const WORKER_LAMBDA = Deno.env.get('GENERATE_QUIZ_WORKER_LAMBDA');
const CUSTOM_SECRET = Deno.env.get('CUSTOM_SECRET');

async function callWorkerURL(data: QuizWorkerArgs) {
  const workerResp = await fetch(WORKER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json',
               'Authorization': 'Bearer ' + data.user_token,
               'X-Custom-Secret': CUSTOM_SECRET },
    body: JSON.stringify(data)
  });

  if (!workerResp.ok) throw new Error(`Worker returned ${workerResp.status}`);

  return workerResp;
}

export async function callWorker(data: QuizWorkerArgs) {
  if (WORKER_URL)
    return await callWorkerURL(data);
  else if (WORKER_LAMBDA)
    ;

  throw new Error("No worker defined.");
}
