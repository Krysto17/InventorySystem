"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * False while server-rendering, true on the client — without an effect.
 *
 * The usual `useState(false)` + `useEffect(() => setMounted(true))` costs an
 * extra render pass on every mount and trips React's set-state-in-effect rule.
 * useSyncExternalStore reads the two snapshots directly instead.
 */
export function useMounted(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
