import { useEffect } from "react";

/**
 * Listen for a keyboard shortcut combo like "mod+k" or "mod+s".
 *
 * - "mod" matches Cmd on macOS and Ctrl elsewhere.
 * - The handler is called with the event so it can `preventDefault()`.
 * - Triggered keys are matched case-insensitively (letters only).
 */
export function useKeyboardShortcut(
  combo: string,
  handler: (e: KeyboardEvent) => void,
  { enabled = true }: { enabled?: boolean } = {},
) {
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const parts = combo.toLowerCase().split("+").map((s) => s.trim());
    const key = parts.pop()!;
    const needMod = parts.includes("mod") || parts.includes("ctrl") || parts.includes("cmd");
    const needShift = parts.includes("shift");
    const needAlt = parts.includes("alt") || parts.includes("option");

    function onKey(e: KeyboardEvent) {
      const isMod = navigator.platform.toLowerCase().includes("mac") ? e.metaKey : e.ctrlKey;
      if (needMod && !isMod) return;
      if (!needMod && (e.metaKey || e.ctrlKey)) return;
      if (needShift !== e.shiftKey) return;
      if (needAlt !== e.altKey) return;
      if (e.key.toLowerCase() !== key) return;
      handler(e);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [combo, handler, enabled]);
}
