"use client";

import { useEffect, useState } from "react";

// Prompts the user to allow browser notifications for the site. Once granted (or
// denied/unsupported) the button disappears. When granted, AppShell fires a
// system pop-up on new queue/approval items via the existing realtime.
export function NotificationButton() {
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">("default");

  useEffect(() => {
    if (typeof window === "undefined" || typeof Notification === "undefined") {
      setPerm("unsupported");
      return;
    }
    setPerm(Notification.permission);
  }, []);

  if (perm !== "default") return null;

  async function enable() {
    try {
      setPerm(await Notification.requestPermission());
    } catch {
      /* permission request not available */
    }
  }

  return (
    <button
      type="button"
      onClick={enable}
      className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-full border border-line bg-panel px-4 py-2.5 text-sm font-semibold shadow-lg hover:bg-zinc-50 dark:hover:bg-zinc-800"
      aria-label="Enable notifications"
    >
      <span aria-hidden>🔔</span> Enable notifications
    </button>
  );
}
