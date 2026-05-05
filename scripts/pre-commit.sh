#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export GIT_PAGER=cat
export PAGER=cat

run() {
  printf '\n==> %s\n' "$*"
  "$@"
}

run git --no-pager diff --check
run pnpm install --frozen-lockfile
run pnpm format:check
run pnpm lint
run pnpm typecheck
run pnpm test:coverage
run pnpm build
run pnpm docs:smoke
run pnpm --filter @firebase-desk/e2e typecheck
run pnpm --filter @firebase-desk/e2e exec playwright install chromium
run pnpm dlx firebase-tools@15.15.0 --project demo-local emulators:exec --only auth,firestore --config firebase/emulator/firebase.json "pnpm --filter @firebase-desk/emulator-tools seed && pnpm --filter @firebase-desk/e2e test:e2e"
