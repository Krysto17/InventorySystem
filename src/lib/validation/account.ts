// Bank account details must always travel as a complete set: an account name,
// a 10-digit account number, and a bank name — or nothing at all. This is the
// single source of truth used by every action that stores account details
// (suppliers, advances, expenses); the DB enforces the same rule as a backstop.

export type AccountTrio = {
  account_name: string | null;
  account_number: string | null;
  bank_name: string | null;
};

export type AccountTrioResult =
  | { ok: true; value: AccountTrio }
  | { ok: false; error: string };

export function parseAccountTrio(name: string, number: string, bank: string): AccountTrioResult {
  const n = name.trim();
  const num = number.trim();
  const b = bank.trim();

  if (!n && !num && !b) {
    return { ok: true, value: { account_name: null, account_number: null, bank_name: null } };
  }
  if (!n || !num || !b) {
    return { ok: false, error: "Enter the account name, account number, and bank name together (or leave all three blank)." };
  }
  if (!/^\d{10}$/.test(num)) {
    return { ok: false, error: "Account number must be exactly 10 digits." };
  }
  return { ok: true, value: { account_name: n, account_number: num, bank_name: b } };
}

// Convenience for reading the three standard fields off a FormData.
export function accountTrioFromForm(formData: FormData): AccountTrioResult {
  return parseAccountTrio(
    String(formData.get("account_name") ?? ""),
    String(formData.get("account_number") ?? ""),
    String(formData.get("bank_name") ?? ""),
  );
}
