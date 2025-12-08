import os
import sqlite3
import random
import json
import httpx
from typing import List, TypedDict, Optional, Annotated
from datetime import datetime
from bs4 import BeautifulSoup

from fastapi import FastAPI, BackgroundTasks
from pydantic import BaseModel

from langchain_google_genai import ChatGoogleGenerativeAI

from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import JsonOutputParser
from langgraph.graph import StateGraph, END
from langgraph.checkpoint.sqlite import SqliteSaver

# --- CONFIGURATION ---
# Ensure you have GOOGLE_API_KEY in your environment variables
# os.environ["GOOGLE_API_KEY"] = "AIza..."

DB_PATH = "daily_dutch.db"
CHECKPOINT_DB_PATH = "workflow_state.db"

# --- DATABASE SETUP (Business Logic) ---
def init_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS daily_exercises (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT,
            source_url TEXT,
            exercises_json TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()
    conn.close()

init_db()

# --- Pydantic Models for API ---
class TriggerRequest(BaseModel):
    suggested_words: List[str] = ["bezig", "afhankelijk", "gereedschap", "omgaan", "ondanks"]

# --- LANGGRAPH STATE ---
class AgentState(TypedDict):
    suggested_words: List[str]
    article_url: Optional[str]
    article_text: Optional[str]
    exercises: Optional[List[dict]]
    error: Optional[str]

# --- NODE FUNCTIONS ---

def pick_article_node(state: AgentState):
    """Scrapes NOS.nl homepage and picks a random article URL."""
    print("--- Step 1: Picking Article ---")
    try:
        response = httpx.get("https://nos.nl")
        soup = BeautifulSoup(response.content, "html.parser")

        # Find links that look like articles
        links = [
            a['href'] for a in soup.find_all('a', href=True)
            if '/artikel/' in a['href']
        ]

        if not links:
            return {"error": "No articles found"}

        # Deduplicate and pick one
        unique_links = list(set(links))
        selected_path = random.choice(unique_links)
        full_url = f"https://nos.nl{selected_path}"

        return {"article_url": full_url}
    except Exception as e:
        return {"error": str(e)}

def scrape_content_node(state: AgentState):
    """Downloads the specific article text."""
    print(f"--- Step 2: Scraping {state['article_url']} ---")
    try:
        response = httpx.get(state['article_url'])
        soup = BeautifulSoup(response.content, "html.parser")

        # NOS articles usually have content in <p> tags inside an <article> or specific classes
        # This is a generic robust approach
        article_body = soup.find('article')
        if article_body:
            paragraphs = article_body.find_all('p')
        else:
            paragraphs = soup.find_all('p')

        text_content = " ".join([p.get_text() for p in paragraphs])

        # Limit text length to avoid token limits if necessary
        return {"article_text": text_content[:8000]}
    except Exception as e:
        return {"error": str(e)}

def generate_exercises_node(state: AgentState):
    """Calls Gemini to generate the JSON exercises."""
    if state.get("error") or not state.get("article_text"):
        return {"exercises": None}

    print("--- Step 3: Generating Exercises with Gemini ---")

    llm = ChatGoogleGenerativeAI(
        model="gemini-2.5-flash",
        temperature=0.7
    )

    parser = JsonOutputParser()

    prompt_text = """
    You are a Dutch language teacher creating exercises.

    CONTEXT ARTICLE:
    {article_text}

    TARGET WORDS TO INCLUDE (if possible, otherwise select relevant words from text):
    {suggested_words}

    TASK:
    1. Extract or create 20 simplified sentences based on the context of the article.
    2. For at least 5 sentences, try to use the 'Target Words' provided.
    3. For the rest, select a word that is self-evident from context (noun, verb, or preposition).
    4. Respond ONLY with a valid JSON list.

    FORMAT EXAMPLE:
    [
      {{"sentence": "Het schrijven van een brief is een lastige klus.", "word": "klus"}},
      ...
    ]
    """

    prompt = ChatPromptTemplate.from_template(prompt_text)
    chain = prompt | llm | parser

    try:
        result = chain.invoke({
            "article_text": state['article_text'],
            "suggested_words": ", ".join(state['suggested_words'])
        })
        return {"exercises": result}
    except Exception as e:
        return {"error": str(e)}

def save_to_db_node(state: AgentState):
    """Saves the final result to the business database."""
    print("--- Step 4: Saving to Database ---")

    if not state.get("exercises"):
        return {"error": "No exercises generated to save."}

    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()

        json_data = json.dumps(state["exercises"], ensure_ascii=False)
        today = datetime.now().strftime("%Y-%m-%d")

        cursor.execute(
            "INSERT INTO daily_exercises (date, source_url, exercises_json) VALUES (?, ?, ?)",
            (today, state['article_url'], json_data)
        )
        conn.commit()
        conn.close()
        return {"error": None} # Success
    except Exception as e:
        return {"error": str(e)}

# --- GRAPH CONSTRUCTION ---

workflow = StateGraph(AgentState)

# Add Nodes
workflow.add_node("pick_article", pick_article_node)
workflow.add_node("scrape_content", scrape_content_node)
workflow.add_node("generate_exercises", generate_exercises_node)
workflow.add_node("save_to_db", save_to_db_node)

# Add Edges
workflow.set_entry_point("pick_article")
workflow.add_edge("pick_article", "scrape_content")
workflow.add_edge("scrape_content", "generate_exercises")
workflow.add_edge("generate_exercises", "save_to_db")
workflow.add_edge("save_to_db", END)

# Setup Checkpointer (Sqlite) for resumability
# This allows us to resume the graph if it crashes, using the thread_id
conn = sqlite3.connect(CHECKPOINT_DB_PATH, check_same_thread=False)
memory = SqliteSaver(conn)

app_graph = workflow.compile(checkpointer=memory)

# --- FASTAPI APP ---

app = FastAPI(title="Dutch Learning Agent")

def run_agent_background(words: List[str], thread_id: str):
    """Helper to run the graph configuration"""
    config = {"configurable": {"thread_id": thread_id}}

    initial_state = {
        "suggested_words": words,
        "article_url": None,
        "article_text": None,
        "exercises": None,
        "error": None
    }

    # Run the graph
    # Because we use a checkpointer, we can inspect 'config' later to see state
    for event in app_graph.stream(initial_state, config=config):
        # We can log events here if we want
        pass

@app.post("/trigger-daily-exercise")
async def trigger_exercise(request: TriggerRequest, background_tasks: BackgroundTasks):
    # Create a unique ID for this run (e.g., today's date) to ensure we can resume it
    # or a UUID for unique runs.
    run_id = datetime.now().strftime("%Y%m%d-%H%M%S")

    # Add to background tasks so the API returns immediately
    background_tasks.add_task(run_agent_background, request.suggested_words, run_id)

    return {
        "status": "started",
        "run_id": run_id,
        "message": "Agent is generating exercises in the background."
    }

@app.get("/exercises")
def get_exercises():
    """View generated exercises from the DB"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM daily_exercises ORDER BY created_at DESC LIMIT 5")
    rows = cursor.fetchall()
    conn.close()

    results = []
    for row in rows:
        results.append({
            "id": row["id"],
            "date": row["date"],
            "url": row["source_url"],
            "exercises": json.loads(row["exercises_json"])
        })
    return results

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
