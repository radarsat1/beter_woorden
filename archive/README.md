# Beter Woorden

Application for Dutch practice by filling in the missing word. Uses Gemini to extract
practice sentences from NOS articles, chooses a word and makes you guess which word goes
where.

Work in progress but currently it works with a FastAPI server and a CLI command:

1. Run the server in a separate window: `scripts/dev.sh`
2. Trigger creating an exercise: `scripts/trigger.sh`
3. Do the latest exercise: `uv run scripts/exercise.py`

You must have `uv` installed and you should create `.env` with,

    GEMINI_API_KEY=xyz...


2025 Stephen Sinclair <radarsat1@gmail.com>, see LICENSE.

Disclaimer: a mostly "careful-vibe-coded" project with Gemini.
