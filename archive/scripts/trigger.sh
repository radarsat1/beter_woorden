#!/bin/bash

curl -X POST "http://localhost:8000/trigger-daily-exercise" \
     -H "Content-Type: application/json" \
     -d '{ "suggested_words": ["bezig", "afhankelijk", "gereedschap", "omgaan", "ondanks"] }'
