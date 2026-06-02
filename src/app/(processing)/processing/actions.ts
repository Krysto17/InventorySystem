"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";

export type ProcessingState = { error?: string };

type UsageLine = { machine_id: string; measurement: number };

export async function submitProcessing(
  _prev: ProcessingState,
  formData: FormData,
): Promise<ProcessingState> {
  const me = await getProfile();
  if (!me) return { error: "Not signed in" };
  if (me.role !== "processing" && me.role !== "owner") return { error: "Forbidden" };

  const visitId = String(formData.get("visit_id") ?? "");
  if (!visitId) return { error: "Missing visit id" };

  const lines: UsageLine[] = [];
  for (const [key, val] of formData.entries()) {
    const m = key.match(/^usage\[(\d+)\]\[(machine_id|measurement)\]$/);
    if (!m) continue;
    const idx = Number(m[1]);
    lines[idx] ??= { machine_id: "", measurement: 0 };
    if (m[2] === "machine_id") lines[idx].machine_id = String(val);
    else lines[idx].measurement = Number(val);
  }
  const cleaned = lines.filter((l) => l && l.machine_id && l.measurement > 0);
  if (cleaned.length === 0) return { error: "At least one machine usage row is required" };

  const supabase = await createClient();

  const { data: machineRows, error: mErr } = await supabase
    .from("machines")
    .select("id, rate")
    .in("id", cleaned.map((l) => l.machine_id));
  if (mErr) return { error: mErr.message };
  const rates = new Map<string, number>(
    (machineRows ?? []).map((r) => [r.id as string, Number(r.rate)]),
  );

  const now = new Date().toISOString();
  const { data: rec, error: prErr } = await supabase
    .from("processing_records")
    .insert({
      visit_id: visitId,
      recorded_by: me.id,
      started_at: now,
      completed_at: now,
    })
    .select("id")
    .single();
  if (prErr || !rec) return { error: prErr?.message ?? "Failed to create processing record" };

  const usageRows = cleaned.map((l) => ({
    processing_record_id: rec.id as string,
    machine_id: l.machine_id,
    measurement: l.measurement,
    rate_snapshot: rates.get(l.machine_id) ?? 0,
  }));
  const { error: uErr } = await supabase.from("processing_machine_usage").insert(usageRows);
  if (uErr) return { error: uErr.message };

  revalidatePath(`/visits/${visitId}`);
  revalidatePath("/processing");
  return {};
}

export async function updateProcessing(
  _prev: ProcessingState,
  formData: FormData,
): Promise<ProcessingState> {
  const me = await getProfile();
  if (!me) return { error: "Not signed in" };
  if (me.role !== "processing" && me.role !== "owner") return { error: "Forbidden" };

  const recordId = String(formData.get("record_id") ?? "");
  if (!recordId) return { error: "Missing record id" };

  const lines: UsageLine[] = [];
  for (const [key, val] of formData.entries()) {
    const m = key.match(/^usage\[(\d+)\]\[(machine_id|measurement)\]$/);
    if (!m) continue;
    const idx = Number(m[1]);
    lines[idx] ??= { machine_id: "", measurement: 0 };
    if (m[2] === "machine_id") lines[idx].machine_id = String(val);
    else lines[idx].measurement = Number(val);
  }
  const cleaned = lines.filter((l) => l && l.machine_id && l.measurement > 0);

  const supabase = await createClient();

  const { error: delErr } = await supabase
    .from("processing_machine_usage")
    .delete()
    .eq("processing_record_id", recordId);
  if (delErr) return { error: delErr.message };

  if (cleaned.length > 0) {
    const { data: machineRows } = await supabase
      .from("machines")
      .select("id, rate")
      .in("id", cleaned.map((l) => l.machine_id));
    const rates = new Map<string, number>(
      (machineRows ?? []).map((r) => [r.id as string, Number(r.rate)]),
    );
    const rows = cleaned.map((l) => ({
      processing_record_id: recordId,
      machine_id: l.machine_id,
      measurement: l.measurement,
      rate_snapshot: rates.get(l.machine_id) ?? 0,
    }));
    await supabase.from("processing_machine_usage").insert(rows);
  }

  await supabase
    .from("processing_records")
    .update({ recorded_by: me.id })
    .eq("id", recordId);

  return {};
}
