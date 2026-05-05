#!/usr/bin/env bash
set -euo pipefail

pnpm install --frozen-lockfile
pnpm package
CHECKSUM_FILE_NAME="${CHECKSUM_FILE_NAME:-SHA256SUMS-docker-linux-X64.txt}" pnpm package:checksums

sudo chown root:root apps/desktop/release/linux-unpacked/chrome-sandbox
sudo chmod 4755 apps/desktop/release/linux-unpacked/chrome-sandbox
ls -l apps/desktop/release/linux-unpacked/chrome-sandbox

xvfb-run --auto-servernum -- pnpm dlx --allow-build=protobufjs --allow-build=re2 firebase-tools@15.15.0 --project demo-local emulators:exec --only auth,firestore --config firebase/emulator/firebase.json "pnpm --filter @firebase-desk/emulator-tools seed && pnpm --filter @firebase-desk/e2e test:packaged"
