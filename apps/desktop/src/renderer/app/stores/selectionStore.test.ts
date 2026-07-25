import { beforeEach, describe, expect, it } from 'vitest';
import { selectionActions, selectionStore } from './selectionStore.ts';

describe('selectionStore', () => {
  beforeEach(() => selectionActions.reset());

  it('tracks auth selection', () => {
    selectionActions.selectAuthUser('u_ada');
    expect(selectionStore.state).toEqual({
      authUserId: 'u_ada',
    });
  });
});
