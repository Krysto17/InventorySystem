"use server";

import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";
import { fail, fromWrite, type ActionResult } from "@/lib/actions/result";
import { revalidateSupplierFinance } from "@/lib/finance/revalidate";
import { requestKeyFrom } from "@/lib/actions/request-key";
import { derivedRequestKey } from "@/lib/actions/derived-key";
import { one as g1 } from "@/lib/db/relation";

// Only the accountant executes payment. The DB triggers enforce the
// approved → paid transition + role; these surface failures (incl. an
// RLS-filtered 0-row update) to the UI instead of silently no-op'ing.
export async function markAdvancePaid(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me || me.role !== "accounting") return fail("Only accounting can mark items paid.");
  const id = String(formData.get("advance_id") ?? "");
  if (!id) return fail("Missing advance.");
  const supabase = await createClient();
  const res = await supabase.from("advances").update({ approval_status: "paid" }).eq("id", id).select("id");
  const result = fromWrite(res, "Couldn't mark this advance paid — check you have access to its site.");
  if (result.ok) revalidateSupplierFinance();
  return result;
}

export async function markConsumablePaid(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me || me.role !== "accounting") return fail("Only accounting can mark items paid.");
  const id = String(formData.get("consumable_id") ?? "");
  if (!id) return fail("Missing expense.");
  const supabase = await createClient();
  const res = await supabase.from("consumables").update({ approval_status: "paid" }).eq("id", id).select("id");
  const result = fromWrite(res, "Couldn't mark this expense paid — check you have access to its site.");
  if (result.ok) revalidateSupplierFinance();
  return result;
}

export async function markSettlementPaid(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me || me.role !== "accounting") return fail("Only accounting can mark items paid.");
  const id = String(formData.get("settlement_id") ?? "");
  if (!id) return fail("Missing settlement.");
  const supabase = await createClient();
  // Pay the full remaining balance in one go (net − already-recorded payments).
  const [{ data: st }, { data: paidTotal }] = await Promise.all([
    supabase.from("batch_settlements")
      .select("net_balance, visit_id, visit:visits(supplier:suppliers(account_name, account_number, bank_name))")
      .eq("id", id).maybeSingle(),
    supabase.rpc("settlement_paid_total", { p_settlement_id: id }),
  ]);
  if (!st) return fail("Couldn't load this settlement — check you have access to its site.");
  const remaining = Number(st.net_balance) - Number(paidTotal ?? 0);
  // 0163: paying off the remainder is one command; a resubmit replays it.
  const requestKey = requestKeyFrom(formData);

  // A ₦0 (fully-covered) balance is closed directly.
  if (remaining <= 0.005) {
    const { error } = await supabase.rpc("close_settlement", { p_id: id });
    if (error) return fail(error.message.replace(/^.*?:\s*/, ""));
    revalidateSupplierFinance();
    return { ok: true };
  }
  if (!requestKey) {
    return fail("That payment could not be identified. Refresh the page and try again.");
  }

  // Pay the manager's payout plan account by account.
  //
  // This button used to record ONE payment for the whole remaining balance with
  // no account on it. When the manager had split the payout across three
  // accounts, the money went to three places but the ledger remembered one
  // anonymous row, so nothing downstream could say which account received what.
  // Measured on production before this fix: of 59 closed settlements that had a
  // split plan, 55 held a single payment row.
  //
  // So each planned account becomes its own payment, carrying its own amount and
  // account details. One click, several rows — see derivedRequestKey for why
  // each row's key is derived from this one command id rather than freshly
  // minted, and why that makes a retry complete a half-written payout instead of
  // double-paying it.
  const { data: plan } = await supabase.from("settlement_payout_splits")
    .select("id, amount, account_name, account_number, bank_name, note")
    .eq("visit_id", st.visit_id as string)
    .order("created_at", { ascending: true });

  const supplier = g1<{ account_name: string | null; account_number: string | null; bank_name: string | null }>(
    g1<{ supplier: unknown }>((st as { visit: unknown }).visit)?.supplier,
  );

  type Leg = {
    key: string; amount: number; note: string | null;
    account_name: string | null; account_number: string | null; bank_name: string | null;
  };
  let legs: Leg[];

  if ((plan?.length ?? 0) > 0) {
    const planned = (plan ?? []).reduce((a, r) => a + Number(r.amount), 0);
    // The payables screen already warns about this; refuse rather than pay the
    // first accounts in full and shortchange the last one.
    if (planned > remaining + 0.005) {
      return fail(
        `The payout plan totals ₦${planned.toLocaleString()} but only ₦${remaining.toLocaleString()} `
        + "is still to pay. Ask the manager to correct the split first.",
      );
    }
    legs = (plan ?? []).map((r) => ({
      key: derivedRequestKey(requestKey, r.id as string),
      amount: Number(r.amount),
      note: (r.note as string | null) ?? null,
      account_name: (r.account_name as string | null) ?? null,
      account_number: (r.account_number as string | null) ?? null,
      bank_name: (r.bank_name as string | null) ?? null,
    }));
    // Whatever the plan did not cover goes to the supplier's own account, which
    // is exactly how the payables screen presents it.
    if (remaining - planned > 0.005) {
      legs.push({
        key: derivedRequestKey(requestKey, "supplier-balance"),
        amount: remaining - planned,
        note: "Balance to the supplier's own account",
        account_name: supplier?.account_name ?? null,
        account_number: supplier?.account_number ?? null,
        bank_name: supplier?.bank_name ?? null,
      });
    }
  } else {
    // No split: one payment, to the account the accountant was shown on this
    // page — the supplier's own. Naming it beats the blank cell that used to be
    // recorded and reads as missing data.
    legs = [{
      key: requestKey,
      amount: remaining,
      note: null,
      account_name: supplier?.account_name ?? null,
      account_number: supplier?.account_number ?? null,
      bank_name: supplier?.bank_name ?? null,
    }];
  }

  // Sequentially, never in parallel: each call takes `for update` on the
  // settlement and re-reads the paid total, and the last one is what flips the
  // status to `paid`.
  for (const leg of legs) {
    const { error } = await supabase.rpc("record_settlement_payment", {
      p_settlement_id: id,
      p_amount: leg.amount,
      p_method: "transfer",
      p_note: leg.note ?? undefined,
      p_account_name: leg.account_name ?? undefined,
      p_account_number: leg.account_number ?? undefined,
      p_bank_name: leg.bank_name ?? undefined,
      p_request_key: leg.key,
    });
    if (error) {
      revalidateSupplierFinance();
      // Legs already recorded stand, and the settlement is left
      // `partially_paid`. Pressing the button again replays those and writes
      // only what is missing.
      return fail(
        legs.length > 1
          ? `Paid ${legs.indexOf(leg)} of ${legs.length} accounts, then: `
            + `${error.message.replace(/^.*?:\s*/, "")}. Press Pay again to finish the rest.`
          : error.message.replace(/^.*?:\s*/, ""),
      );
    }
  }
  revalidateSupplierFinance();
  return { ok: true };
}

// An underpaid price correction is a compensation the accountant disburses to
// the supplier. The RPC enforces accounting-only + site + unpaid-underpaid.
export async function markCorrectionPaid(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me || me.role !== "accounting") return fail("Only accounting can mark items paid.");
  const id = String(formData.get("correction_id") ?? "");
  if (!id) return fail("Missing correction.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_price_correction_paid", { p_id: id });
  if (error) return fail(error.message.replace(/^.*?:\s*/, ""));
  revalidateSupplierFinance();
  return { ok: true };
}
