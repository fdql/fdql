import { type AppCoreStore, createAppCoreStore } from '../shared/store.ts';
import { createInitialUpdateState, type UpdateState } from './updateState.ts';

export type UpdateStore = AppCoreStore<UpdateState>;

export function createUpdateStore(
  initialState: UpdateState = createInitialUpdateState(),
): UpdateStore {
  return createAppCoreStore(initialState);
}
