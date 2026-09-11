#!/usr/bin/env bash
# Pulls the latest `production` branch into this checkout and rebuilds.
# Run this FROM the production checkout (/root/thinkAI). To promote code from
# development first, from the dev checkout (/root/ThinkAIdevelopment):
#   git push origin main:production
set -euo pipefail
cd "$(dirname "$0")/.."

branch="$(git symbolic-ref --short HEAD)"
if [ "$branch" != "production" ]; then
  echo "Refusing: $(pwd) is on '$branch', not 'production'" >&2
  exit 1
fi

git pull origin production
docker compose up -d --build thought-refiner
echo "Production now running $(git rev-parse --short HEAD)"
