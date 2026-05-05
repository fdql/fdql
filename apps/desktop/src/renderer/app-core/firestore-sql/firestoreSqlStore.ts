import { type AppCoreStore, createAppCoreStore } from '../shared/store.ts';
import {
  type CreateFirestoreSqlStateInput,
  createInitialFirestoreSqlState,
  type FirestoreSqlState,
} from './firestoreSqlState.ts';

export type FirestoreSqlStore = AppCoreStore<FirestoreSqlState>;

export function createFirestoreSqlStore(
  input: CreateFirestoreSqlStateInput = {},
): FirestoreSqlStore {
  return createAppCoreStore(createInitialFirestoreSqlState(input));
}
