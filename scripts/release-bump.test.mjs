import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  bumpVersion,
  planReleaseBump,
  pullRequestNumbersFromSubjects,
  releaseBranch,
} from './release-bump.mjs';

describe('bumpVersion', () => {
  it('bumps patch versions', () => {
    assert.equal(bumpVersion('0.0.8', 'patch'), '0.0.9');
  });

  it('bumps minor versions', () => {
    assert.equal(bumpVersion('0.0.8', 'minor'), '0.1.0');
  });

  it('bumps major versions', () => {
    assert.equal(bumpVersion('0.0.8', 'major'), '1.0.0');
  });
});

describe('releaseBranch', () => {
  it('uses the target version in the release branch name', () => {
    assert.equal(releaseBranch('0.2.0'), 'release/bump/v0.2.0');
  });
});

describe('pullRequestNumbersFromSubjects', () => {
  it('extracts squash and merge commit pull request numbers', () => {
    const numbers = pullRequestNumbersFromSubjects([
      'Add release notes (#52)',
      'Merge pull request #53 from viniciusrmcarneiro/native-ui',
      'Fix issue #999 without merge metadata',
      'Release v0.0.9 (#54)',
      'Merge pull request #53 from viniciusrmcarneiro/native-ui',
    ]);

    assert.deepEqual(numbers, [52, 53, 54]);
  });
});

describe('planReleaseBump', () => {
  it('does not bump when every PR opts out', () => {
    const plan = planReleaseBump({
      currentVersion: '0.0.8',
      latestTag: 'v0.0.8',
      pullRequests: [{ labels: ['release:none'], number: 1, title: 'Docs' }],
    });

    assert.equal(plan.shouldBump, false);
  });

  it('plans a patch bump from patch PRs', () => {
    const plan = planReleaseBump({
      currentVersion: '0.0.8',
      latestTag: 'v0.0.8',
      pullRequests: [{ labels: ['release:patch'], number: 1, title: 'Fix' }],
    });

    assert.equal(plan.shouldBump, true);
    assert.equal(plan.branch, 'release/bump/v0.0.9');
    assert.equal(plan.nextVersion, '0.0.9');
  });

  it('chooses the highest release level', () => {
    const plan = planReleaseBump({
      currentVersion: '0.0.8',
      latestTag: 'v0.0.8',
      pullRequests: [
        { labels: ['release:patch'], number: 1, title: 'Fix' },
        { labels: ['release:major'], number: 2, title: 'Breaking change' },
        { labels: ['release:minor'], number: 3, title: 'Feature' },
      ],
    });

    assert.equal(plan.shouldBump, true);
    assert.equal(plan.level, 'major');
    assert.equal(plan.nextVersion, '1.0.0');
  });

  it('does not bump while the current version is ahead of the latest tag', () => {
    const plan = planReleaseBump({
      currentVersion: '0.0.9',
      latestTag: 'v0.0.8',
      pullRequests: [{ labels: ['release:patch'], number: 1, title: 'Fix' }],
    });

    assert.equal(plan.shouldBump, false);
    assert.match(plan.reason, /ahead/);
  });
});
