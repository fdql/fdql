import { type AppCoreStore, createAppCoreStore } from '../shared/store.ts';
import { type CreateFdqlStateInput, createInitialFdqlState, type FdqlState } from './fdqlState.ts';

export type FdqlStore = AppCoreStore<FdqlState>;

export function createFdqlStore(input: CreateFdqlStateInput = {}): FdqlStore {
  return createAppCoreStore(createInitialFdqlState(input));
}
