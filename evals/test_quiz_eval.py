import os
import json
import httpx
import pytest
import asyncio
from typing import List, Tuple
from dotenv import load_dotenv
import pandas as pd
from tqdm import tqdm
from supabase import create_client, Client

from deepeval import assert_test, evaluate
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

llm_model = GPTModel(
    model=os.environ['OPENAI_API_MODEL'],
    api_key=os.environ['OPENAI_API_KEY'],
    base_url=os.getenv('OPENAI_API_BASE'),
    temperature=0,
    cost_per_input_token=0.000002,
    cost_per_output_token=0.000008
)

# --- Metrics ---
class SubstringMatchMetric(BaseMetric):
    def __init__(self, threshold: float = 0.5):
        self.threshold = threshold
        self.score = 0

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

# --- Fixtures ---

@pytest.fixture(scope="module")
def supabase_session() -> Tuple[Client, str]:
    """Authenticates with Supabase and returns the client and access token."""
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
    auth_response = supabase.auth.sign_in_with_password({
        "email": SUPABASE_USER_EMAIL,
        "password": SUPABASE_USER_PASSWORD
    })
    return supabase, auth_response.session.access_token

@pytest.fixture(scope="module")
def test_data(supabase_session):
    """
    Setup: Triggers Edge Function for the dataset.
    Teardown: Deletes all quizzes marked as 'is_test' after the test module finishes.
    """
    supabase, token = supabase_session

    # --- Setup: Generate Quizzes ---
    async def run_generation():
        with open(DATASET_PATH, "r") as f:
            articles = json.load(f)
            # Process in batches of 5 as per your logic
            for i in tqdm(range(0, len(articles), 5), desc="Generating quizzes"):
                async with asyncio.TaskGroup() as tg:
                    for article in articles[i:i + 5]:
                        # print(f"Triggering generation for: {article['title']}")
                        tg.create_task(trigger_edge_function(token, article))

    async def trigger_edge_function(token, article):
        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        payload = {
            "new_quiz": {
                "article_title": article['title'],
                "article_text": article['text'],
                "article_url": article.get('url', ''),
                "meta": {"is_test": True} # TODO: also a random number to identify this test?
            }
        }
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(EDGE_FUNCTION_URL, json=payload, headers=headers)
            resp.raise_for_status()

            # Polling logic
            thread_id, values = next(iter(resp.json().items()))
            while values.get('status') != 'completed':
                await asyncio.sleep(1)
                resp = await client.post(EDGE_FUNCTION_URL, json={thread_id: 'poll'},
                                         headers=headers)
                thread_id, values = next(iter(resp.json().items()))

    # Run the async generation logic
    asyncio.run(run_generation())

    # --- Yield to Tests ---
    # Fetch results now that they are generated
    response = supabase.table("quizzes") \
        .select("*") \
        .eq("context->meta->is_test", "true") \
        .execute()

    # TODO: here save out the data too, might need to load it again to perform different
    # evaluations.

    yield response.data

    # --- Teardown: Cleanup ---
    print("\nCleaning up test quizzes from database...")
    supabase.table("quizzes") \
        .delete() \
        .eq("context->meta->is_test", "true") \
        .execute()
    print("Cleanup complete.")

# --- The Test Case ---

def test_quiz_quality(test_data):
    """
    Runs DeepEval on the generated quizzes fetched from the fixture.
    """
    test_cases = []

    for entry in test_data:
        quiz_items = entry.get("content", [])
        source_text = entry.get("source_text", "")

        for item in quiz_items:
            test_case = LLMTestCase(
                input=item.get("question", ""),
                actual_output=item.get("answer", ""),
                retrieval_context=[source_text]
            )
            test_cases.append(test_case)

    metrics = [SubstringMatchMetric(), naturalness_metric]

    # Note: We run assert_test inside a loop for individual sample tracking
    # Or you can use evaluate(test_cases, metrics) for a summary report.

    # for test_case in test_cases:
    #     assert_test(test_case, metrics)

    results = evaluate(test_cases, metrics)

    # Save the results
    with open('evaluation.json', 'w') as j:
        j.write(results.model_dump_json(indent=2))

    # Summary statistics
    data = []
    for r in results.test_results:
        for d in r.metrics_data:
            data.append((d.name, d.score))
    df = pd.DataFrame(data, columns=('metric','score'))
    print(df.groupby('metric').describe())
