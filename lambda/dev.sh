#!/bin/sh
set -e
set -x

cd $(dirname $0)

sam build

sam local start-lambda QuizWorkerFunction \
    --host 0.0.0.0 \
    --env-vars env.local.json \
    --parameter-overrides Env=local
