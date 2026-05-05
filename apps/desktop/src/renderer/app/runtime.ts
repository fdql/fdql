export type AppRuntime = 'demo' | 'desktop' | 'dev-browser';

export function resolveAppRuntime(): AppRuntime {
  if (import.meta.env.VITE_FIREBASE_DESK_RUNTIME === 'demo') return 'demo';
  if (import.meta.env.DEV && typeof window !== 'undefined' && !window.firebaseDesk?.app) {
    return 'dev-browser';
  }
  return 'desktop';
}

export function isDemoRuntime(runtime: AppRuntime): boolean {
  return runtime === 'demo';
}
