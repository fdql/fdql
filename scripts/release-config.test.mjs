import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { it } from 'node:test';

it('excludes non-release PRs and generated bump PRs from release notes', async () => {
  const releaseConfig = await readFile('.github/release.yml', 'utf8');

  assert.match(releaseConfig, /automation:release-bump/);
  assert.match(releaseConfig, /release:none/);
  assert.doesNotMatch(releaseConfig, /release:patch/);
  assert.doesNotMatch(releaseConfig, /release:minor/);
  assert.doesNotMatch(releaseConfig, /release:major/);
});
