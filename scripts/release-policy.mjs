#!/usr/bin/env node

import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const AUTOMATION_LABEL = 'automation:release-bump';
export const RELEASE_LABELS = Object.freeze([
  'release:patch',
  'release:minor',
  'release:major',
  'release:none',
]);
export const VERSION_FILE_PATHS = Object.freeze([
  'package.json',
  'apps/desktop/package.json',
]);

const stableVersionPattern = /^\d+\.\d+\.\d+$/;

if (isMain(import.meta.url)) {
  void main();
}

export function evaluateReleasePolicy(input) {
  const labels = input.labels ?? [];
  const changedFiles = normalizeChangedFiles(input.changedFiles ?? []);
  const changedPaths = new Set(changedFiles.map((file) => file.filename));
  const releaseLabels = labels.filter((label) => RELEASE_LABELS.includes(label));
  const isAutomation = labels.includes(AUTOMATION_LABEL);
  const problems = [];

  if (isAutomation) {
    if (releaseLabels.length > 0) {
      problems.push(`${AUTOMATION_LABEL} PRs must not use release:* labels.`);
    }

    const unexpectedFiles = [...changedPaths].filter((path) => !VERSION_FILE_PATHS.includes(path));
    if (unexpectedFiles.length > 0) {
      problems.push(`Release bump PR changes unsupported files: ${unexpectedFiles.join(', ')}.`);
    }

    const missingVersionFiles = VERSION_FILE_PATHS.filter((path) => !changedPaths.has(path));
    if (missingVersionFiles.length > 0) {
      problems.push(`Release bump PR must change: ${missingVersionFiles.join(', ')}.`);
    }

    for (const path of VERSION_FILE_PATHS) {
      const basePackage = input.basePackages?.[path];
      const headPackage = input.headPackages?.[path];
      if (!basePackage || !headPackage) {
        problems.push(`Release bump PR must include readable ${path}.`);
        continue;
      }
      if (!changesOnlyVersion(basePackage, headPackage)) {
        problems.push(`Release bump PR may only change the top-level version in ${path}.`);
      }
      if (!stableVersionPattern.test(String(headPackage.version))) {
        problems.push(`${path} version must be stable semver.`);
      }
      if (!versionGreaterThan(String(headPackage.version), String(basePackage.version))) {
        problems.push(`${path} version must increase.`);
      }
    }

    const rootVersion = input.headPackages?.['package.json']?.version;
    const desktopVersion = input.headPackages?.['apps/desktop/package.json']?.version;
    if (rootVersion !== desktopVersion) {
      problems.push('Root and desktop package versions must match.');
    }
  } else {
    if (releaseLabels.length !== 1) {
      problems.push(
        `PRs must have exactly one release label: ${RELEASE_LABELS.join(', ')}.`,
      );
    }

    for (const path of VERSION_FILE_PATHS) {
      if (!changedPaths.has(path)) continue;
      const basePackage = input.basePackages?.[path];
      const headPackage = input.headPackages?.[path];
      if (!basePackage || !headPackage) {
        problems.push(`Normal PRs must keep ${path} readable.`);
        continue;
      }
      if (basePackage.version !== headPackage.version) {
        problems.push(`Normal PRs must not change ${path} version.`);
      }
    }
  }

  return {
    isAutomation,
    ok: problems.length === 0,
    problems,
    releaseLabels,
  };
}

export function changesOnlyVersion(basePackage, headPackage) {
  const baseWithoutVersion = withoutTopLevelVersion(basePackage);
  const headWithoutVersion = withoutTopLevelVersion(headPackage);
  return stableJson(baseWithoutVersion) === stableJson(headWithoutVersion)
    && basePackage.version !== headPackage.version;
}

export function versionGreaterThan(candidate, current) {
  const candidateParts = parseStableVersion(candidate);
  const currentParts = parseStableVersion(current);
  if (!candidateParts || !currentParts) return false;
  for (let index = 0; index < candidateParts.length; index += 1) {
    if (candidateParts[index] > currentParts[index]) return true;
    if (candidateParts[index] < currentParts[index]) return false;
  }
  return false;
}

async function main() {
  const command = process.argv[2] ?? 'pull-request';
  if (command === 'pull-request') {
    await runPullRequestPolicy();
    return;
  }
  if (command === 'local-release-bump') {
    await runLocalReleaseBumpPolicy(process.argv[3] ?? 'origin/main', process.argv[4] ?? 'HEAD');
    return;
  }
  throw new Error(`Unsupported release policy command "${command}".`);
}

async function runPullRequestPolicy() {
  const eventPath = requiredEnv('GITHUB_EVENT_PATH');
  const token = requiredEnv('GITHUB_TOKEN');
  const event = JSON.parse(await readFile(eventPath, 'utf8'));
  const pullRequest = event.pull_request;
  if (!pullRequest) throw new Error('release-policy requires a pull_request event.');

  const labels = pullRequest.labels.map((label) => label.name);
  const changedFiles = await listPullRequestFiles({
    repository: event.repository.full_name,
    pullNumber: pullRequest.number,
    token,
  });
  const packages = await loadPullRequestPackages({
    changedFiles,
    labels,
    pullRequest,
    token,
  });
  report(
    evaluateReleasePolicy({
      labels,
      changedFiles,
      basePackages: packages.basePackages,
      headPackages: packages.headPackages,
    }),
  );
}

async function runLocalReleaseBumpPolicy(baseRef, headRef) {
  const labels = [AUTOMATION_LABEL];
  const changedFiles = git([
    'diff',
    '--name-only',
    `${baseRef}..${headRef}`,
  ]).split('\n').filter(Boolean);
  const basePackages = {};
  const headPackages = {};
  for (const path of VERSION_FILE_PATHS) {
    basePackages[path] = JSON.parse(git(['show', `${baseRef}:${path}`]));
    headPackages[path] = JSON.parse(git(['show', `${headRef}:${path}`]));
  }
  report(evaluateReleasePolicy({ labels, changedFiles, basePackages, headPackages }));
}

async function loadPullRequestPackages({ changedFiles, labels, pullRequest, token }) {
  const isAutomation = labels.includes(AUTOMATION_LABEL);
  const changedPaths = new Set(changedFiles.map((file) => file.filename));
  const packagePaths = VERSION_FILE_PATHS.filter((path) => isAutomation || changedPaths.has(path));
  const basePackages = {};
  const headPackages = {};

  for (const path of packagePaths) {
    basePackages[path] = await readPackageFromGitHub({
      repository: pullRequest.base.repo.full_name,
      ref: pullRequest.base.sha,
      path,
      token,
    });
    headPackages[path] = await readPackageFromGitHub({
      repository: pullRequest.head.repo.full_name,
      ref: pullRequest.head.sha,
      path,
      token,
    });
  }

  return { basePackages, headPackages };
}

async function listPullRequestFiles({ repository, pullNumber, token }) {
  const files = [];
  for (let page = 1;; page += 1) {
    const pageFiles = await githubJson({
      path: `/repos/${repository}/pulls/${pullNumber}/files?per_page=100&page=${page}`,
      token,
    });
    files.push(...pageFiles);
    if (pageFiles.length < 100) return files;
  }
}

async function readPackageFromGitHub({ repository, ref, path, token }) {
  const content = await githubJson({
    path: `/repos/${repository}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`,
    token,
  });
  if (content.type !== 'file' || typeof content.content !== 'string') {
    throw new Error(`${path} at ${repository}@${ref} is not a file.`);
  }
  return JSON.parse(Buffer.from(content.content.replaceAll('\n', ''), 'base64').toString('utf8'));
}

async function githubJson({ path, token }) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub API ${path} failed: ${response.status} ${await response.text()}`);
  }
  return await response.json();
}

function report(result) {
  if (result.ok) {
    console.log('Release policy OK.');
    return;
  }
  console.error('Release policy violations found:\n');
  for (const problem of result.problems) console.error(`- ${problem}`);
  process.exit(1);
}

function normalizeChangedFiles(files) {
  return files.map((file) => {
    if (typeof file === 'string') return { filename: file };
    return file;
  });
}

function withoutTopLevelVersion(value) {
  const copy = { ...value };
  delete copy.version;
  return copy;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${
      Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
        .join(',')
    }}`;
  }
  return JSON.stringify(value);
}

function parseStableVersion(version) {
  if (!stableVersionPattern.test(version)) return null;
  return version.split('.').map((part) => Number.parseInt(part, 10));
}

function encodePath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function isMain(url) {
  return process.argv[1] && url === pathToFileURL(resolve(process.argv[1])).href;
}
