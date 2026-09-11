#!/usr/bin/env bash
# Pulls the latest `production` branch into this checkout, applies any pending
# database migrations, then rebuilds the app.
#
# Run this FROM the production checkout (/root/thinkAI). To promote code from
# development first, from the dev checkout (/root/thinkAIdevelopment):
#   git push origin main:production
#
# Migrations run before the rebuild so the schema is never behind the code that
# expects it. scripts/migrate.sh dumps the database before changing anything.
set -euo pipefail
cd "$(dirname "$0")/.."

branch="$(git symbolic-ref --short HEAD)"
if [ "$branch" != "production" ]; then
  echo "Refusing: $(pwd) is on '$branch', not 'production'" >&2
  exit 1
fi

git pull origin production
scripts/migrate.sh
docker compose up -d --build thought-refiner
echo "Production now running $(git rev-parse --short HEAD)"
