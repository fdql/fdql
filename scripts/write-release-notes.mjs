#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

void main();

async function main() {
  const outputPath = resolve(
    repositoryRoot,
    process.env.RELEASE_NOTES_FILE ?? 'release-notes.md',
  );
  const mode = releaseNotesMode();
  const notes = mode === 'latest' ? latestNotes() : await stableNotes();

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${notes.trimEnd()}\n`);
  console.log(`Wrote ${outputPath}`);
}

async function stableNotes() {
  const generatedNotes = await readGeneratedNotes();
  const body = generatedNotes.length > 0
    ? generatedNotes
    : 'No merged pull request notes were generated for this release.';

  return `${stableIntro()}

${body}`;
}

function stableIntro() {
  return `Unsigned Firebase Desk build. OS warning prompts are expected. Verify downloads with the matching SHA256SUMS asset.

Source commit: \`${releaseCommit()}\``;
}

function latestNotes() {
  return `Rolling unsigned build mirrored from the latest versioned \`main\` release.

These binaries are published intentionally for development smoke testing. They are unsigned, so OS warning prompts are expected. Verify downloads with the matching SHA256SUMS asset.

Source commit: \`${releaseCommit()}\``;
}

async function readGeneratedNotes() {
  const inputPath = process.env.GENERATED_RELEASE_NOTES_FILE;
  if (inputPath === undefined) return '';
  if (inputPath.trim().length === 0) {
    throw new Error('GENERATED_RELEASE_NOTES_FILE must not be empty.');
  }
  return (await readFile(resolve(repositoryRoot, inputPath), 'utf8')).trim();
}

function releaseNotesMode() {
  const mode = process.env.RELEASE_NOTES_MODE ?? 'stable';
  if (mode === 'stable' || mode === 'latest') return mode;
  throw new Error(`Unsupported RELEASE_NOTES_MODE "${mode}". Expected "stable" or "latest".`);
}

function releaseCommit() {
  return process.env.RELEASE_COMMIT ?? process.env.GITHUB_SHA ?? 'local';
}
