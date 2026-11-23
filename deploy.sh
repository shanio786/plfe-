#!/bin/sh
set -eu
# Run from the repository root after configuring .env and HTTPS.
git pull --ff-only
docker compose --profile maintenance build
docker compose up -d postgres
docker compose --profile maintenance run --rm maintenance npm run db:migrate
docker compose up -d --remove-orphans
