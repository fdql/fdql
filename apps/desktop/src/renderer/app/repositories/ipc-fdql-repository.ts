import type { FdqlRepository, FdqlRunEventListener } from '@firebase-desk/repo-contracts';

export function createIpcFdqlRepository(): FdqlRepository {
  return {
    async compile(request) {
      return await window.firebaseDesk.fdql.compile(request);
    },
    async run(request) {
      return await window.firebaseDesk.fdql.run(request);
    },
    async cancel(runId) {
      await window.firebaseDesk.fdql.cancel({ runId });
    },
    subscribe(listener: FdqlRunEventListener) {
      return window.firebaseDesk.fdql.subscribe(listener);
    },
  };
}
