#!/bin/bash

# Configuration
STACK_NAME="beterwoorden-lambda-stack"
REGION="eu-central-1"

cd $(dirname $0)
set -e

# These need to be defined in env.prod.json
LLM_BASE_URL=$(jq .QuizWorkerFunction.LLM_BASE_URL < env.prod.json)
LLM_API_KEY=$(jq .QuizWorkerFunction.LLM_API_KEY < env.prod.json)
LLM_MODEL=$(jq .QuizWorkerFunction.LLM_MODEL < env.prod.json)

echo -e "\n--- Validating ---"
sam validate --lint

echo -e "\n--- Building ---"
sam build

echo -e "\n--- Deploying Infrastructure (this takes ~3 minutes) ---"
sam deploy \
  --stack-name "$STACK_NAME" \
  --capabilities CAPABILITY_NAMED_IAM \
  --region "$REGION" \
  --resolve-s3 \
  --parameter-overrides \
  ParameterKey=Env,ParameterValue=prod \
  ParameterKey=LlmBaseUrl,ParameterValue=$LLM_BASE_URL \
  ParameterKey=LlmApiKey,ParameterValue=$LLM_API_KEY \
  ParameterKey=LlmModel,ParameterValue=$LLM_MODEL

echo "=========================================================="
echo "Deployment Complete!"
echo "=========================================================="
echo ""
