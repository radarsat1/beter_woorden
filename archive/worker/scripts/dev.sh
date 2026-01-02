#!/bin/bash
exec uv run uvicorn src.main:app --reload --port 3001 --host 0.0.0.0 --log-level=debug
