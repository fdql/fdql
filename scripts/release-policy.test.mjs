import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AUTOMATION_LABEL, evaluateReleasePolicy } from './release-policy.mjs';

const basePackages = {
  'apps/desktop/package.json': packageJson('0.0.8'),
  'package.json': packageJson('0.0.8'),
};
const bumpedPackages = {
  'apps/desktop/package.json': packageJson('0.0.9'),
  'package.json': packageJson('0.0.9'),
};

describe('evaluateReleasePolicy', () => {
  it('rejects PRs without a release label', () => {
    const result = evaluateReleasePolicy({ labels: [], changedFiles: [] });

    assert.equal(result.ok, false);
    assert.match(result.problems.join('\n'), /exactly one release label/);
  });

  it('rejects PRs with multiple release labels', () => {
    const result = evaluateReleasePolicy({
      labels: ['release:patch', 'release:minor'],
      changedFiles: [],
    });

    assert.equal(result.ok, false);
    assert.match(result.problems.join('\n'), /exactly one release label/);
  });

  it('accepts normal PRs with one release label', () => {
    const result = evaluateReleasePolicy({
      labels: ['release:patch'],
      changedFiles: ['packages/ui/src/Button.tsx'],
    });

    assert.equal(result.ok, true);
  });

  it('rejects normal PR version edits', () => {
    const result = evaluateReleasePolicy({
      labels: ['release:patch'],
      changedFiles: ['package.json'],
      basePackages,
      headPackages: bumpedPackages,
    });

    assert.equal(result.ok, false);
    assert.match(result.problems.join('\n'), /must not change package.json version/);
  });

  it('accepts release bump PRs that only change versions', () => {
    const result = evaluateReleasePolicy({
      labels: [AUTOMATION_LABEL],
      changedFiles: ['package.json', 'apps/desktop/package.json'],
      basePackages,
      headPackages: bumpedPackages,
    });

    assert.equal(result.ok, true);
  });

  it('rejects release bump PRs that change other files', () => {
    const result = evaluateReleasePolicy({
      labels: [AUTOMATION_LABEL],
      changedFiles: ['package.json', 'apps/desktop/package.json', 'README.md'],
      basePackages,
      headPackages: bumpedPackages,
    });

    assert.equal(result.ok, false);
    assert.match(result.problems.join('\n'), /unsupported files: README.md/);
  });
});

function packageJson(version) {
  return {
    name: 'firebase-desk',
    private: true,
    version,
  };
}
