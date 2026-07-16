"use client";

import { useEffect } from "react";

// App-wide safety net: every form submission asks for confirmation before it
// runs, because most actions here change money/stock records. Opt out per form
// with `data-confirm="skip"` (search, filters, login) or give a specific prompt
// with `data-confirm="Your message"`. Native GET forms (search) are ignored.
//
// Runs in the capture phase: on cancel we preventDefault + stopImmediatePropagation
// so the event never reaches React's action handler — nothing happens. On
// confirm we do nothing and the submission proceeds normally.
const DEFAULT_MESSAGE = "Please confirm — this will update the records.";

export function ConfirmSubmits() {
  useEffect(() => {
    const handler = (e: Event) => {
      const form = e.target as HTMLFormElement | null;
      if (!form || form.tagName !== "FORM") return;

      const method = (form.getAttribute("method") || "post").toLowerCase();
      if (method === "get") return; // search / filter navigation

      const attr = form.getAttribute("data-confirm");
      if (attr === "skip") return;

      const message = attr && attr.trim() ? attr : DEFAULT_MESSAGE;
      if (!window.confirm(message)) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    document.addEventListener("submit", handler, true);
    return () => document.removeEventListener("submit", handler, true);
  }, []);

  return null;
}
