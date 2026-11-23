#!/bin/sh
set -eu
# Run from the repository root after configuring .env and HTTPS.
git pull --ff-only
docker compose build
docker compose up -d postgres
docker compose run --rm app npm run db:migrate
docker compose up -d --remove-orphans
