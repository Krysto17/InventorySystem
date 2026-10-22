"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";
import { ok, fail, type ActionResult } from "@/lib/actions/result";
import { requestKeyFrom } from "@/lib/actions/request-key";

// Shared by /accounting/salaries and /manager/salaries: the accountant and the
// manager both enter payroll, and one copy of the rule keeps them identical.

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Save the payroll total for one site and one month.
 *
 * 0170 puts a unique constraint on (site_id, period), so this is an UPSERT
 * rather than an insert: entering August twice corrects August instead of
 * adding a second line. That matters more than it sounds — a duplicated
 * payroll figure would move the profit by millions and look perfectly normal.
 */
export async function saveSalary(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me) return fail("Not signed in.");
  const isOwner = me.role === "owner";
  if (!isOwner && me.role !== "accounting" && me.role !== "manager") {
    return fail("Only the accountant, the manager or the owner can enter salaries.");
  }

  const month = String(formData.get("month") ?? "").trim();
  if (!MONTH.test(month)) return fail("Pick the month this payroll covers.");

  const raw = String(formData.get("amount_naira") ?? "").replace(/,/g, "").trim();
  const amount = Number(raw);
  if (!raw || !Number.isFinite(amount) || amount < 0) {
    return fail("Enter the total salary figure for the month.");
  }

  // The owner may post for any site; everyone else posts for their own, and the
  // form does not offer them a choice.
  const siteId = isOwner ? String(formData.get("site_id") ?? "") : (me.site_id ?? "");
  if (!siteId) return fail(isOwner ? "Choose a site." : "Your account has no site.");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("salary_entries")
    .upsert(
      {
        site_id: siteId,
        period: `${month}-01`,
        amount_naira: amount,
        note: String(formData.get("note") ?? "").trim() || null,
        recorded_by: me.id,
        request_key: requestKeyFrom(formData) ?? undefined,
      },
      { onConflict: "site_id,period" },
    )
    .select("id");

  if (error) return fail(error.message.replace(/^.*?:\s*/, ""));
  // RLS refusing an upsert comes back as no error and no rows, which would
  // otherwise re-render the old figure as though it had saved.
  if ((data ?? []).length === 0) {
    return fail("That salary figure was not saved — check you have access to this site.");
  }

  revalidateSalaryViews();
  return ok(`Salary for ${month} saved.`);
}

/** Only the owner removes a payroll figure; a correction is an edit, not a delete. */
export async function deleteSalary(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me || me.role !== "owner") return fail("Only the owner can remove a salary figure.");
  const id = String(formData.get("id") ?? "");
  if (!id) return fail("Missing entry.");

  const supabase = await createClient();
  const { data, error } = await supabase.from("salary_entries").delete().eq("id", id).select("id");
  if (error) return fail(error.message.replace(/^.*?:\s*/, ""));
  if ((data ?? []).length === 0) return fail("That entry was not removed.");

  revalidateSalaryViews();
  return ok("Salary figure removed.");
}

function revalidateSalaryViews() {
  for (const p of ["/accounting/salaries", "/manager/salaries",
                   "/accounting/profit-loss", "/owner/profit-loss"]) {
    revalidatePath(p);
  }
}
