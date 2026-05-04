import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

void main();

async function main(): Promise<void> {
  const outputPath = resolve(
    repositoryRoot,
    process.env['RELEASE_NOTES_FILE'] ?? 'release-notes.md',
  );
  const mode = process.env['RELEASE_NOTES_MODE'] ?? 'stable';
  const notes = mode === 'latest' ? latestNotes() : await stableNotes();

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${notes.trimEnd()}\n`);
  console.log(`Wrote ${outputPath}`);
}

async function stableNotes(): Promise<string> {
  const generatedNotes = await readGeneratedNotes();
  const body = generatedNotes.length > 0
    ? generatedNotes
    : 'No merged pull request notes were generated for this release.';

  return `${stableIntro()}

${body}`;
}

function stableIntro(): string {
  return `Unsigned Firebase Desk build. OS warning prompts are expected. Verify downloads with the matching SHA256SUMS asset.

Source commit: \`${releaseCommit()}\``;
}

function latestNotes(): string {
  return `Rolling unsigned build mirrored from the latest versioned \`main\` release.

These binaries are published intentionally for development smoke testing. They are unsigned, so OS warning prompts are expected. Verify downloads with the matching SHA256SUMS asset.

Source commit: \`${releaseCommit()}\``;
}

async function readGeneratedNotes(): Promise<string> {
  const inputPath = process.env['GENERATED_RELEASE_NOTES_FILE'];
  if (!inputPath) return '';
  try {
    return (await readFile(resolve(repositoryRoot, inputPath), 'utf8')).trim();
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return '';
    throw error;
  }
}

function releaseCommit(): string {
  return process.env['RELEASE_COMMIT'] ?? process.env['GITHUB_SHA'] ?? 'local';
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
