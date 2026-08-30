/**
 * The authorization matrix — the single machine-readable statement of who may
 * do what, driven as tests by authorization-matrix.test.ts.
 *
 * SOURCE OF TRUTH: the production RLS policies and RPC guards as they stand.
 * Nothing here invents a permission. Every row was checked against the live
 * schema; where a row and the database disagree, the database is right and the
 * row is the bug — do not "fix" a policy to satisfy this file.
 *
 * `site` is relative to the acting user:
 *   own   — the site the user is posted to
 *   other — a different site
 *   none  — not site-scoped (the resource is global, or the user is the owner)
 */
export type MatrixRole =
  | "owner" | "general_manager" | "site_manager" | "general_accountant"
  | "site_accounting" | "inventory" | "receiving" | "qc" | "processing"
  | "stock_keeper" | "gate";

export type MatrixCase = {
  role: MatrixRole;
  resource: string;
  action: "read" | "write";
  site: "own" | "other" | "none";
  expect: "ALLOW" | "DENY";
  /** Why this rule exists, so a future reader can tell intent from accident. */
  because: string;
  /**
   * Set when the row records what the system DOES rather than what it arguably
   * should do. The matrix must describe reality — but a reader deserves to know
   * which rules were chosen and which are simply inherited.
   */
  concern?: string;
};

export const AUTHORIZATION_MATRIX: MatrixCase[] = [
  // ── The visit workflow ────────────────────────────────────────────────────
  { role: "receiving", resource: "visits", action: "read", site: "own", expect: "ALLOW",
    because: "receiving works its own site's intake" },
  { role: "receiving", resource: "visits", action: "read", site: "other", expect: "DENY",
    because: "site-scoped roles never see another site's batches" },
  { role: "qc", resource: "visits", action: "read", site: "own", expect: "ALLOW",
    because: "QC analyses its own site's batches" },
  { role: "qc", resource: "visits", action: "read", site: "other", expect: "ALLOW",
    because: "the visits policy names qc explicitly — QC analyses samples from any site" },
  { role: "processing", resource: "visits", action: "read", site: "own", expect: "ALLOW",
    because: "processing works its own site's plant" },
  { role: "processing", resource: "visits", action: "read", site: "other", expect: "DENY",
    because: "site-scoped" },
  { role: "site_manager", resource: "visits", action: "read", site: "own", expect: "ALLOW",
    because: "the site manager runs their own site's pricing" },
  { role: "site_manager", resource: "visits", action: "read", site: "other", expect: "DENY",
    because: "cross-site read belongs to the general manager, not every manager" },
  { role: "general_manager", resource: "visits", action: "read", site: "other", expect: "ALLOW",
    because: "has_cross_site_read() — the GM reports across sites" },
  { role: "owner", resource: "visits", action: "read", site: "other", expect: "ALLOW",
    because: "the owner sees everything" },

  // ── Money ─────────────────────────────────────────────────────────────────
  { role: "site_accounting", resource: "batch_settlements", action: "read", site: "own", expect: "ALLOW",
    because: "the site accountant pays their own site's settlements" },
  { role: "site_accounting", resource: "batch_settlements", action: "read", site: "other", expect: "DENY",
    because: "cross-site read is the GENERAL accountant's (New-Site), not every accountant's" },
  { role: "general_accountant", resource: "batch_settlements", action: "read", site: "other", expect: "ALLOW",
    because: "is_general_accountant() — combined reporting" },
  // These three record CURRENT behaviour, not desired behaviour. The finance
  // tables are scoped by SITE and not by ROLE, so every operational role at a
  // site can read them through the API. The UI hides the figures by role, which
  // is presentation, not authorization. Flagged rather than changed: altering a
  // policy is out of scope for a regression-proofing phase.
  { role: "receiving", resource: "batch_settlements", action: "read", site: "own", expect: "ALLOW",
    because: "batch_settlements policy is site-scoped only: site_id = current_site() OR has_cross_site_read()",
    concern: "receiving can read settlement amounts for its site through the API; the UI hides them by role" },
  { role: "qc", resource: "batch_settlements", action: "read", site: "own", expect: "ALLOW",
    because: "same site-only policy",
    concern: "QC can read its site's settlement figures through the API" },
  { role: "receiving", resource: "advances", action: "read", site: "own", expect: "ALLOW",
    because: "advances policy is site-scoped only",
    concern: "receiving can read supplier advance balances for its site through the API" },
  { role: "site_manager", resource: "advances", action: "read", site: "own", expect: "ALLOW",
    because: "the manager records advances" },

  // ── Stock ─────────────────────────────────────────────────────────────────
  { role: "stock_keeper", resource: "stock_lots", action: "read", site: "own", expect: "ALLOW",
    because: "the keeper counts their own store" },
  { role: "stock_keeper", resource: "stock_lots", action: "read", site: "other", expect: "DENY",
    because: "one store, not the company's" },
  { role: "stock_keeper", resource: "suppliers", action: "read", site: "none", expect: "DENY",
    because: "0126 walls the keeper off suppliers — that row carries bank details" },
  { role: "stock_keeper", resource: "batch_settlements", action: "read", site: "own", expect: "DENY",
    because: "0126 restrictive policy: the keeper's login is the store and nothing else" },
  { role: "stock_keeper", resource: "advances", action: "read", site: "own", expect: "DENY",
    because: "0126 restrictive policy" },
  { role: "stock_keeper", resource: "visits", action: "read", site: "own", expect: "DENY",
    because: "0126 restrictive policy" },
  { role: "inventory", resource: "consumables", action: "read", site: "other", expect: "ALLOW",
    because: "0120 — one inventory officer keeps expenses for the whole organisation" },
  { role: "inventory", resource: "consumables", action: "write", site: "other", expect: "ALLOW",
    because: "0120 — inventory logs an expense against whichever site it belongs to" },
  { role: "site_manager", resource: "consumables", action: "read", site: "other", expect: "DENY",
    because: "a site manager sees their own site's expenses" },

  // ── The audit trail ───────────────────────────────────────────────────────
  { role: "owner", resource: "transaction_events", action: "read", site: "other", expect: "ALLOW",
    because: "the owner reads every account's history" },
  { role: "stock_keeper", resource: "transaction_events", action: "read", site: "own", expect: "DENY",
    because: "0126 restrictive policy" },

  // ── Employee records ──────────────────────────────────────────────────────
  { role: "receiving", resource: "profiles_other_users", action: "read", site: "none", expect: "DENY",
    because: "a user reads only their own profile row" },
  { role: "owner", resource: "profiles_other_users", action: "read", site: "none", expect: "ALLOW",
    because: "the owner provisions and reviews accounts" },
  { role: "site_manager", resource: "profiles_other_users", action: "read", site: "none", expect: "DENY",
    because: "employee records are the owner's" },
];
