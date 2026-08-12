"use client";

import { useEffect, useState } from "react";
import { useMounted } from "@/lib/hooks/use-mounted";

// Captured beforeinstallprompt event (Chrome/Android/desktop Chrome).
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

// A floating "Install app" button that appears only when the browser reports the
// PWA is installable, and disappears once installed or already running
// standalone. On browsers without the install prompt (e.g. iOS Safari) it stays
// hidden — those users install via Share → Add to Home Screen.
export function InstallButton() {
  const [deferred, setDeferred] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  // Running standalone already? That is a fact about the browser, read on the
  // client rather than discovered by an effect.
  const mounted = useMounted();
  const standalone = mounted && (window.matchMedia?.("(display-mode: standalone)").matches ?? false);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as InstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (standalone || installed || !deferred) return null;

  async function install() {
    const evt = deferred;
    if (!evt) return;
    await evt.prompt();
    await evt.userChoice;
    setDeferred(null);
  }

  return (
    <button
      type="button"
      onClick={install}
      className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full bg-black px-4 py-2.5 text-sm font-semibold text-white shadow-lg ring-1 ring-white/10 hover:bg-zinc-800"
      aria-label="Install app"
    >
      <span aria-hidden>⬇</span> Install app
    </button>
  );
}
