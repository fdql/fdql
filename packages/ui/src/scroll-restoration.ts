import { type RefObject, type UIEvent, useCallback, useLayoutEffect } from 'react';

interface ScrollPosition {
  readonly left: number;
  readonly top: number;
}

const scrollPositions = new Map<string, ScrollPosition>();

export function useScrollRestoration<TElement extends HTMLElement>(
  key: string | null | undefined,
  ref: RefObject<TElement | null>,
  restoreSignal?: unknown,
): (event: UIEvent<TElement>) => void {
  useLayoutEffect(() => {
    if (!key) return;
    const element = ref.current;
    if (!element) return;
    const position = scrollPositions.get(key);
    if (!position) return;
    element.scrollLeft = position.left;
    element.scrollTop = position.top;
  }, [key, ref, restoreSignal]);

  return useCallback(
    (event: UIEvent<TElement>) => {
      if (!key) return;
      scrollPositions.set(key, {
        left: event.currentTarget.scrollLeft,
        top: event.currentTarget.scrollTop,
      });
    },
    [key],
  );
}
