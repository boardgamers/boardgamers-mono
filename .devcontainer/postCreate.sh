#!/bin/bash
set -euo pipefail
IFS=$'\n\t'

nvm install
pnpm install

docker compose up -d