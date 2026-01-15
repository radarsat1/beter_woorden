import os
import json
import uuid
import argparse
import asyncio
import httpx
import pandas as pd
from typing import List, Dict, Any
from dotenv import load_dotenv
from tqdm import tqdm
from supabase import create_client, Client

from deepeval import evaluate
from deepeval.evaluate import DisplayConfig, AsyncConfig
from deepeval.models import GPTModel
from deepeval.test_case import LLMTestCase, LLMTestCaseParams
from deepeval.metrics import GEval, BaseMetric

load_dotenv()

# --- Configuration ---
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_PUBLISHABLE_KEY = os.getenv("SUPABASE_PUBLISHABLE_KEY")
SUPABASE_USER_EMAIL = os.getenv("SUPABASE_USER_EMAIL")
SUPABASE_USER_PASSWORD = os.getenv("SUPABASE_USER_PASSWORD")

EDGE_FUNCTION_URL = f"{SUPABASE_URL}/functions/v1/generate-quiz"
DATASET_PATH = "articles.json"
STATE_FILE = "quiz_run_state.json"

# --- Metrics ---
class SubstringMatchMetric(BaseMetric):
    def __init__(self, threshold: float = 0.5):
        self.threshold = threshold
        self.score = 0
        self.reason = ""

    def measure(self, test_case: LLMTestCase):
        question = test_case.input
        answer = test_case.actual_output
        self.score = 1.0 if answer.lower() in question.lower() else 0.0
        self.success = self.score >= self.threshold
        return self.score

    async def a_measure(self, test_case: LLMTestCase):
        return self.measure(test_case)

    def is_successful(self):
        return self.success

    @property
    def __name__(self):
        return "Answer-in-Question Substring Match"

llm_model = GPTModel(
    model=os.environ.get('OPENAI_API_MODEL', 'gpt-4'),
    api_key=os.environ.get('OPENAI_API_KEY'),
    base_url=os.getenv('OPENAI_API_BASE'),
    temperature=0,
)

naturalness_metric = GEval(
    name="Naturalness & Grammar",
    criteria="Determine if the question is written in natural, fluent language and is grammatically correct.",
    evaluation_steps=[
        "Check for awkward phrasing.",
        "Check for grammatical errors or typos.",
        "Rate 5 if it is sensible and free of errors, 1 if it is a poor sentence."
    ],
    evaluation_params=[LLMTestCaseParams.INPUT],
    model=llm_model,
)

# --- Helper Functions ---

def load_state() -> Dict[str, Any]:
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE, "r") as f:
            return json.load(f)
    return None

def save_state(state: Dict[str, Any]):
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)

def get_authenticated_supabase() -> Client:
    """Creates a client and logs in the user immediately."""
    sb = create_client(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
    sb.auth.sign_in_with_password({
        "email": SUPABASE_USER_EMAIL,
        "password": SUPABASE_USER_PASSWORD
    })
    return sb

# --- Commands ---

async def cmd_generate(args):
    """
    1. Triggers generation for all Article+WordList combinations.
    2. Downloads ALL quizzes for this run_id from DB.
    """
    state = load_state()

    # --- Initialization ---
    if state is None:
        run_id = str(uuid.uuid4())
        print(f"Initializing new run: {args.run_name} ({run_id})")

        state = {
            "run_id": run_id,
            "run_name": args.run_name,
            "triggered_keys": [],  # Tracks which (article+wordlist) we have already sent to API
            "quizzes": []          # Will hold the downloaded DB rows
        }
        save_state(state)
    else:
        print(f"Resuming run: {state['run_name']} ({state['run_id']})")

    # --- Auth ---
    print("Authenticating...")
    sb_client = get_authenticated_supabase()
    access_token = sb_client.auth.get_session().access_token

    # --- Generation Phase ---
    with open(DATASET_PATH, "r") as f:
        articles = json.load(f)

    word_lists = getattr(args, 'word_lists', None) or ['default']

    response = sb_client.table('word_lists').select('id, name').execute()
    word_list_ids = []

    for w in args.word_lists:
        matches = [d['id'] for d in response.data if d['name'] == w]
        word_list_ids += matches

    assert word_list_ids, "Need at least one word list."

    # Build list of tasks
    tasks = []
    for article in articles:
        for w_list in word_list_ids:
            key = f"{article['url']}::{w_list}"
            if key not in state['triggered_keys']:
                tasks.append({
                    "key": key,
                    "article": article,
                    "w_list": w_list
                })

    if tasks:
        print(f"Generating {len(tasks)} missing quizzes...")
        client = httpx.AsyncClient(timeout=60.0)
        headers = {"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"}

        try:
            for task in tqdm(tasks, desc="Triggering"):
                payload = {
                    "new_quiz": {
                        "article_title": task['article']['title'],
                        "article_text": task['article']['text'],
                        "article_url": task['article']['url'],
                        "word_list_ids": [task['w_list']],
                        "meta": {
                            "is_test": True,
                            "run_id": state['run_id'],
                            "run_name": state['run_name']
                        }
                    }
                }

                # Trigger
                resp = await client.post(EDGE_FUNCTION_URL, json=payload, headers=headers)
                resp.raise_for_status()

                # Poll
                data = resp.json()
                thread_id, values = next(iter(data.items()))

                while values.get('status') != 'completed':
                    await asyncio.sleep(1)
                    poll_resp = await client.post(EDGE_FUNCTION_URL, json={thread_id: 'poll'}, headers=headers)
                    data = poll_resp.json()
                    thread_id, values = next(iter(data.items()))

                # Mark as triggered in state so we don't repeat if script crashes
                state['triggered_keys'].append(task['key'])
                # We save frequently to support re-entrancy
                save_state(state)

        except Exception as e:
            print(f"Error during generation: {e}")
            raise e
        finally:
            await client.aclose()
    else:
        print("All combinations have been triggered already.")

    # --- Retrieval Phase ---
    print("Fetching all quizzes from database...")

    # Fetch everything for this run
    response = sb_client.table("quizzes") \
        .select("*") \
        .eq("context->meta->>run_id", state['run_id']) \
        .execute()

    db_rows = response.data
    print(f"Downloaded {len(db_rows)} quizzes.")

    # We overwrite the local cache with the authoritative DB state
    # We clean/flatten the data slightly for the evaluator
    clean_quizzes = []
    for row in db_rows:
        ctx = row.get('context', {})

        clean_quizzes.append({
            "supabase_id": row['id'],
            "article_title": ctx.get('article_title', 'Unknown'),
            "article_url": ctx.get('article_url', ''),
            "word_list": ctx.get('word_list', 'default'),
            "quiz_content": row.get('content', []), # List of Q/A pairs
            "eval_results": None # Placeholder
        })

    state['quizzes'] = clean_quizzes
    save_state(state)
    print("State updated. Ready for evaluation.")

def cmd_evaluate(args):
    state = load_state()
    if not state:
        print("No state file found. Run 'generate' first.")
        return

    quizzes = state.get('quizzes', [])
    test_cases = []

    # Map back structure: (quiz_index_in_state, question_index_inside_quiz)
    map_back = []

    # 1. Build Test Cases
    count_new = 0
    for q_idx, quiz in enumerate(quizzes):
        questions = quiz.get('quiz_content', [])

        # Ensure eval_results list exists and is correct length
        if not quiz.get('eval_results'):
            quiz['eval_results'] = [None] * len(questions)
        elif len(quiz['eval_results']) != len(questions):
            # content length changed? Reset results to be safe
            quiz['eval_results'] = [None] * len(questions)

        for i, q_item in enumerate(questions):
            # Only add if result is missing
            if quiz['eval_results'][i] is None:
                test_case = LLMTestCase(
                    input=q_item.get("question", ""),
                    actual_output=q_item.get("answer", ""),
                    retrieval_context=[quiz.get('source_text', "")]
                )
                test_cases.append(test_case)
                map_back.append((q_idx, i))
                count_new += 1

    if count_new == 0:
        print("All questions have been evaluated.")
        return

    print(f"Evaluating {count_new} questions...")

    # 2. Run Evaluation
    metrics = [SubstringMatchMetric(), naturalness_metric]

    try:
        results = evaluate(
            test_cases,
            metrics,
            display_config=DisplayConfig(print_results=False),
            async_config=AsyncConfig(max_concurrent=args.concurrency),
        )

        # 3. Save Results
        for idx, result in enumerate(results.test_results):
            q_idx, i_idx = map_back[idx]

            scores = {m.name: m.score for m in result.metrics_data}

            # Update state
            state['quizzes'][q_idx]['eval_results'][i_idx] = scores

    except Exception as e:
        print(f"Error during evaluation: {e}")
    finally:
        save_state(state)
        print("Progress saved.")

# Batch version, but let's see if there's a config option we can use above?
def cmd_evaluate(args):
    state = load_state()
    if not state:
        print("No state file found. Run 'generate' first.")
        return

    quizzes = state.get('quizzes', [])
    test_cases = []

    # Map back structure: (quiz_index_in_state, question_index_inside_quiz)
    map_back = []

    # 1. Build Test Cases
    count_new = 0
    for q_idx, quiz in enumerate(quizzes):
        questions = quiz.get('quiz_content', [])

        # Ensure eval_results list exists and is correct length
        if not quiz.get('eval_results'):
            quiz['eval_results'] = [None] * len(questions)
        elif len(quiz['eval_results']) != len(questions):
            quiz['eval_results'] = [None] * len(questions)

        for i, q_item in enumerate(questions):
            # Only add if result is missing
            if quiz['eval_results'][i] is None:
                test_case = LLMTestCase(
                    input=q_item.get("question", ""),
                    actual_output=q_item.get("answer", ""),
                    retrieval_context=[quiz.get('source_text', "")]
                )
                test_cases.append(test_case)
                map_back.append((q_idx, i))
                count_new += 1

    if count_new == 0:
        print("All questions have been evaluated.")
        return

    print(f"Evaluating {count_new} questions...")

    metrics = [SubstringMatchMetric(), naturalness_metric]

    # 2. Run Evaluation in Batches
    # We process in small chunks so that if a crash occurs,
    # we don't lose the progress of the whole run.
    BATCH_SIZE = 10

    # Calculate total batches for progress bar
    total_batches = (len(test_cases) + BATCH_SIZE - 1) // BATCH_SIZE

    try:
        for i in range(0, len(test_cases), BATCH_SIZE):
            current_batch_cases = test_cases[i : i + BATCH_SIZE]
            current_batch_map = map_back[i : i + BATCH_SIZE]

            print(f"Processing batch {i // BATCH_SIZE + 1}/{total_batches} ({len(current_batch_cases)} items)...")

            try:
                # Run DeepEval on just this chunk
                results = evaluate(
                    current_batch_cases,
                    metrics,
                    display_config=DisplayConfig(print_results=False),
                    async_config=AsyncConfig(max_concurrent=args.concurrency),
                )

                # Update state immediately for this batch
                for idx, result in enumerate(results.test_results):
                    q_idx, i_idx = current_batch_map[idx]

                    scores = {m.name: m.score for m in result.metrics_data}
                    state['quizzes'][q_idx]['eval_results'][i_idx] = scores

                # Save after every successful batch
                save_state(state)

            except Exception as batch_error:
                print(f"Error in batch {i // BATCH_SIZE + 1}: {batch_error}")
                print("Saving progress and stopping. Run 'evaluate' again to resume.")
                # We re-raise to exit the loop, or you could 'continue' to skip bad batches
                # But typically 'invalid json' might persist if not handled.
                raise batch_error

    except Exception as e:
        print(f"\nStopped due to error: {e}")
    finally:
        # Final save just in case
        save_state(state)
        print("Progress saved.")

def cmd_report(args):
    state = load_state()
    if not state:
        print("No state found.")
        return

    data = []
    for quiz in state.get('quizzes', []):
        results = quiz.get('eval_results', [])
        # results is a list of dicts (one per question in the quiz)
        if results:
            for res in results:
                if res:
                    row = {
                        "article": quiz['article_title'],
                        "word_list": quiz['word_list'],
                        **res
                    }
                    data.append(row)

    if not data:
        print("No evaluation results found.")
        return

    df = pd.DataFrame(data)

    print(f"\nRun: {state.get('run_name')} ({state.get('run_id')})")

    print("\n--- Summary by Metric ---")
    metric_cols = [col for col in df.columns if col not in ['article', 'word_list']]
    melted = df.melt(id_vars=['article'], value_vars=metric_cols, var_name='metric', value_name='score')
    print(melted.groupby('metric')['score'].describe())

    if 'word_list' in df.columns:
        print("\n--- Summary by Word List ---")
        print(df.groupby('word_list')[metric_cols].mean())

    if args.export:
        fname = f"report_{state.get('run_name').replace(' ', '_')}.csv"
        df.to_csv(fname, index=False)
        print(f"\nSaved to {fname}")

def cmd_clean(args):
    state = load_state()
    if not state:
        print("No state found to clean.")
        return

    sb = get_authenticated_supabase()

    ids_to_delete = [q['supabase_id'] for q in state.get('quizzes', [])]

    if ids_to_delete:
        print(f"Deleting {len(ids_to_delete)} quizzes from Supabase...")
        sb.table("quizzes").delete().in_("id", ids_to_delete).execute()
        print("Remote cleanup complete.")
    else:
        print("No IDs found to delete.")

    if os.path.exists(STATE_FILE):
        os.remove(STATE_FILE)
        print("Local state removed.")

# --- Entry Point ---

def main():
    parser = argparse.ArgumentParser(description="Quiz Gen & Eval CLI")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # Generate
    gen = subparsers.add_parser("generate")
    gen.add_argument("--run-name", type=str, required=True)
    gen.add_argument("--word-lists", nargs='+', default=["default"])

    # Evaluate
    evl = subparsers.add_parser("evaluate")
    evl.add_argument("--concurrency", type=int, default=2)

    # Report
    rep = subparsers.add_parser("report")
    rep.add_argument("--export", action="store_true")

    # Clean
    subparsers.add_parser("clean")

    args = parser.parse_args()

    if args.command == "generate":
        asyncio.run(cmd_generate(args))
    elif args.command == "evaluate":
        cmd_evaluate(args)
    elif args.command == "report":
        cmd_report(args)
    elif args.command == "clean":
        cmd_clean(args)

if __name__ == "__main__":
    main()
