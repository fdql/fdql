#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { AUTOMATION_LABEL } from './release-policy.mjs';

export const RELEASE_BRANCH = 'release/bump';
export const RELEASE_LEVELS = Object.freeze(['patch', 'minor', 'major']);
export const RELEASE_LABEL_TO_LEVEL = Object.freeze({
  'release:patch': 'patch',
  'release:minor': 'minor',
  'release:major': 'major',
});

const versionFilePaths = ['package.json', 'apps/desktop/package.json'];
const stableTagPattern = /^v(\d+)\.(\d+)\.(\d+)$/;
const stableVersionPattern = /^\d+\.\d+\.\d+$/;

if (isMain(import.meta.url)) {
  void main();
}

export function planReleaseBump({ currentVersion, latestTag, pullRequests }) {
  const latestVersion = latestTag?.replace(/^v/, '') ?? null;
  if (!latestVersion) {
    return { shouldBump: false, reason: 'No stable release tag found.' };
  }
  if (currentVersion !== latestVersion) {
    return {
      shouldBump: false,
      reason: `Version ${currentVersion} is already ahead of ${latestTag}.`,
    };
  }

  const includedPullRequests = pullRequests
    .map((pullRequest) => {
      const level = releaseLevelFromLabels(pullRequest.labels);
      return level ? { ...pullRequest, level } : null;
    })
    .filter(Boolean);
  const level = highestReleaseLevel(includedPullRequests.map((pullRequest) => pullRequest.level));
  if (!level) {
    return {
      shouldBump: false,
      latestTag,
      reason: 'No merged PRs require a release.',
    };
  }

  const nextVersion = bumpVersion(currentVersion, level);
  return {
    branch: RELEASE_BRANCH,
    includedPullRequests,
    latestTag,
    level,
    nextVersion,
    shouldBump: true,
    targetTag: `v${nextVersion}`,
    title: `Release v${nextVersion}`,
  };
}

export function releaseLevelFromLabels(labels) {
  const levels = labels.map((label) => RELEASE_LABEL_TO_LEVEL[label]).filter(Boolean);
  return highestReleaseLevel(levels);
}

export function highestReleaseLevel(levels) {
  if (levels.includes('major')) return 'major';
  if (levels.includes('minor')) return 'minor';
  if (levels.includes('patch')) return 'patch';
  return null;
}

export function bumpVersion(version, level) {
  if (!stableVersionPattern.test(version)) {
    throw new Error(`Version must be stable semver, got ${version}.`);
  }
  const [major, minor, patch] = version.split('.').map((part) => Number.parseInt(part, 10));
  if (level === 'major') return `${major + 1}.0.0`;
  if (level === 'minor') return `${major}.${minor + 1}.0`;
  if (level === 'patch') return `${major}.${minor}.${patch + 1}`;
  throw new Error(`Unsupported release level "${level}".`);
}

async function main() {
  const command = process.argv[2] ?? 'plan';
  if (command === 'plan') {
    await runPlan();
    return;
  }
  if (command === 'write') {
    await writeVersions(requiredEnv('RELEASE_BUMP_VERSION'));
    return;
  }
  throw new Error(`Unsupported release bump command "${command}".`);
}

async function runPlan() {
  const repository = requiredEnv('GITHUB_REPOSITORY');
  const token = requiredEnv('GITHUB_TOKEN');
  const currentVersion = await desktopPackageVersion();
  const latestTag = latestStableTag();
  const pullRequests = latestTag
    ? await mergedPullRequestsSinceTag({ repository, tag: latestTag, token })
    : [];
  const plan = planReleaseBump({ currentVersion, latestTag, pullRequests });
  const bodyPath = resolve('/tmp', 'release-bump-body.md');

  if (plan.shouldBump) {
    await writeFile(bodyPath, releaseBumpBody(plan));
    writeOutput('should_bump', 'true');
    writeOutput('branch', plan.branch);
    writeOutput('next_version', plan.nextVersion);
    writeOutput('target_tag', plan.targetTag);
    writeOutput('title', plan.title);
    writeOutput('body_file', bodyPath);
    console.log(`Planned ${plan.level} release ${plan.targetTag}.`);
  } else {
    writeOutput('should_bump', 'false');
    console.log(plan.reason);
  }

  await writePlanFile(plan);
}

async function writeVersions(version) {
  if (!stableVersionPattern.test(version)) {
    throw new Error(`RELEASE_BUMP_VERSION must be stable semver, got ${version}.`);
  }
  for (const path of versionFilePaths) {
    const absolutePath = resolve(path);
    const packageJson = JSON.parse(await readFile(absolutePath, 'utf8'));
    packageJson.version = version;
    await writeFile(absolutePath, `${JSON.stringify(packageJson, null, 2)}\n`);
    console.log(`Set ${path} to ${version}.`);
  }
}

async function mergedPullRequestsSinceTag({ repository, tag, token }) {
  const numbers = pullRequestNumbersSinceTag(tag);
  const pullRequests = await Promise.all(
    numbers.map(async (number) => {
      const pullRequest = await githubJson({
        path: `/repos/${repository}/pulls/${number}`,
        token,
      });
      return {
        labels: pullRequest.labels.map((label) => label.name),
        number,
        title: pullRequest.title,
      };
    }),
  );
  return pullRequests.filter((pullRequest) => !pullRequest.labels.includes(AUTOMATION_LABEL));
}

function pullRequestNumbersSinceTag(tag) {
  const subjects = git(['log', '--format=%s', `${tag}..HEAD`]).split('\n').filter(Boolean);
  const numbers = new Set();
  for (const subject of subjects) {
    for (const match of subject.matchAll(/\(#(\d+)\)/g)) {
      numbers.add(Number.parseInt(match[1], 10));
    }
  }
  return [...numbers].sort((left, right) => left - right);
}

function latestStableTag() {
  const tags = git(['tag', '--list', 'v*.*.*']).split('\n').filter((tag) =>
    stableTagPattern.test(tag)
  );
  tags.sort(compareStableTags).reverse();
  return tags[0] ?? null;
}

async function desktopPackageVersion() {
  const packageJson = JSON.parse(await readFile(resolve('apps/desktop/package.json'), 'utf8'));
  return packageJson.version;
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

function releaseBumpBody(plan) {
  const included = plan.includedPullRequests.map((pullRequest) =>
    `- #${pullRequest.number} ${pullRequest.title} (${pullRequest.level})`
  ).join('\n');
  return `Automated ${plan.level} release bump to ${plan.targetTag}.

Included PRs:
${included}
`;
}

async function writePlanFile(plan) {
  const planPath = process.env.RELEASE_BUMP_PLAN_FILE;
  if (!planPath) return;
  await mkdir(dirname(resolve(planPath)), { recursive: true });
  await writeFile(resolve(planPath), `${JSON.stringify(plan, null, 2)}\n`);
}

function writeOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  execFileSync('sh', ['-c', 'printf "%s=%s\\n" "$1" "$2" >> "$3"', 'sh', name, value, outputPath]);
}

function compareStableTags(left, right) {
  const leftParts = stableTagParts(left);
  const rightParts = stableTagParts(right);
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index];
  }
  return 0;
}

function stableTagParts(tag) {
  return stableTagPattern.exec(tag).slice(1).map((part) => Number.parseInt(part, 10));
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
  return process.argv[1] && url === new URL(process.argv[1], 'file:').href;
}
