import os
import logging
import httpx
from typing import Annotated
from fastapi import FastAPI, BackgroundTasks, Depends, HTTPException, status
from pydantic import BaseModel

from langchain.chat_models import init_chat_model
from langchain_core.prompt_values import ChatPromptValue

from .security import verify_jwt

# --- LOGGING CONFIGURATION ---
# Uvicorn uses standard python logging.
# We configure it to show the timestamp and level.
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("uvicorn.error") # Merges with uvicorn logs

# FastAPI app
app = FastAPI(title="Quiz Worker")

# --- Pydantic Models for API ---
class QuizRequest(BaseModel):
    prompt: dict # ChatPromptValue
    quiz_id: int
    user_id: str
    webhook: str
    user_token: str

class QuizQuestion(BaseModel):
    question: str
    answer: str
    english: str

class QuizResponse(BaseModel):
    exercises: list[QuizQuestion]

async def process_quiz_generation(request: QuizRequest):
    """
    Background task that calls the LLM and sends the result via webhook.
    """
    logger.info(f"Task Started | Quiz ID: {request.quiz_id} | User: {request.user_id}")

    # Initialize LLM
    # Best practice: init inside the task or use a global factory
    llm = init_chat_model(
        'local-model',
        model_provider='openai',
        base_url="http://localhost:1234/v1",
        api_key="lm-studio"
    ).with_structured_output(QuizResponse)

    try:
        # Reconstruct messages from the raw prompt dictionary
        messages = [
            {'role': {'HumanMessage': 'user',
                      'AIMessage': 'chatbot',
                      'SystemMessage': 'system'}[m['id'][-1]],
             'content': m['kwargs']['content']
             }
            for m in request.prompt['kwargs']['messages']
        ]

        # Invoke LLM
        result = await llm.ainvoke(messages)

        # Send webhook to save the results
        async with httpx.AsyncClient() as client:
            logger.info(f"LLM Success | Quiz {request.quiz_id} | Sending Webhook...")

            # Extract data safely
            exercises_data = result.model_dump()['exercises'] if hasattr(result, 'model_dump') else result.dict()['exercises']

            response = await client.post(
                request.webhook,
                headers={
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + request.user_token,
                },
                json={
                    'user_id': request.user_id,
                    'quiz_id': request.quiz_id,
                    'questions': exercises_data,
                    'status': 'completed'
                },
                timeout=30.0
            )
            logger.info(f"Webhook Success | Quiz {request.quiz_id} | Status: {response.status_code}")

    except Exception as e:
        logger.error(f"Task Failed | Quiz {request.quiz_id} | Error: {str(e)}")
        async with httpx.AsyncClient() as client:
            try:
                response = await client.post(
                    request.webhook,
                    headers={
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + request.user_token,
                    },
                    json={
                        'user_id': request.user_id,
                        'quiz_id': request.quiz_id,
                        'questions': None,
                        'status': 'error',
                        'error_details': str(e)
                    },
                    timeout=30.0
                )
                logger.critical(f"Error Webhook Sent | Result: {response.status_code}")
            except Exception as hook_err:
                logger.critical(f"Webhook Failed | Could not notify Supabase of error: {hook_err}")


@app.post('/generate_quiz')
async def generate_quiz(
    request: QuizRequest,
    background_tasks: BackgroundTasks,
    jwt_payload: Annotated[dict, Depends(verify_jwt)]
):
    """
    Accepts the request and schedules the generation in the background.
    Returns immediately.
    """

    # SECURITY CROSS-CHECK:
    # Ensure the user_id in the JSON body is the same as the one in the verified JWT
    if request.user_id != jwt_payload.get("sub"):
        logger.warning(f"Security Alert | User {jwt_payload.get('sub')} tried to generate quiz for {request.user_id}")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User ID mismatch. You can only generate quizzes for yourself."
        )

    logger.info(f"Request Accepted | Quiz {request.quiz_id} queued for user {request.user_id}")

    background_tasks.add_task(process_quiz_generation, request)

    # Respond immediately to the caller
    return {
        "status": "processing",
        "message": "Quiz generation started in background.",
        "quiz_id": request.quiz_id
    }

if __name__ == "__main__":
    import uvicorn
    # Use log_level="info" to ensure uvicorn passes our logs through
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
