"use client";

import { useSyncExternalStore } from "react";
import { DEFAULT_LAYOUT } from "../cv/keyboardLayout";
import { loadKeyboardLayout, subscribeKeyboardLayout } from "../lib/keyboardSettings";

export function useKeyboardLayout() {
  return useSyncExternalStore(subscribeKeyboardLayout, loadKeyboardLayout, () => DEFAULT_LAYOUT);
}
