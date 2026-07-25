import type { FdqlRepository, FdqlRunEventListener } from '@firebase-desk/repo-contracts';

export function createIpcFdqlRepository(): FdqlRepository {
  return {
    compile(request) {
      return window.firebaseDesk.fdql.compile(request);
    },
    run(request) {
      return window.firebaseDesk.fdql.run(request);
    },
    cancel(runId) {
      return window.firebaseDesk.fdql.cancel({ runId });
    },
    subscribe(listener: FdqlRunEventListener) {
      return window.firebaseDesk.fdql.subscribe(listener);
    },
  };
}
