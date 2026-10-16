#!/usr/bin/env bash
# One-command dev bootstrap (documenso's `dx` pattern):
# starts Postgres, migrates, and runs the dev servers.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example — fill in a model API key."
fi

docker compose up -d db
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev
