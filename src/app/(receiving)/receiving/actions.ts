"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";

export type AnalysisState = { error?: string };

function parseXrfJson(raw: string): object | null {
  if (!raw.trim()) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function submitAnalysis(
  _prev: AnalysisState,
  formData: FormData,
): Promise<AnalysisState> {
  const me = await getProfile();
  if (!me) return { error: "Not signed in" };
  if (me.role !== "receiving" && me.role !== "owner") return { error: "Forbidden" };

  const visitId = String(formData.get("visit_id") ?? "");
  const weight = Number(formData.get("weight"));
  if (!visitId) return { error: "Missing visit id" };
  if (!(weight >= 0)) return { error: "Weight is required and must be ≥ 0" };

  const sampleId = String(formData.get("sample_id") ?? "").trim() || null;
  const xrfRaw = String(formData.get("xrf_result") ?? "");
  const xrf = parseXrfJson(xrfRaw);
  if (xrfRaw.trim() && xrf === null) return { error: "XRF result must be valid JSON" };
  const purityRaw = String(formData.get("purity") ?? "").trim();
  const purity = purityRaw ? Number(purityRaw) : null;
  const grade = String(formData.get("grade") ?? "").trim() || null;
  const qc = String(formData.get("qc_observations") ?? "").trim() || null;

  const supabase = await createClient();
  const { error } = await supabase.from("analysis_records").insert({
    visit_id: visitId,
    weight,
    sample_id: sampleId,
    xrf_result: xrf as never, // parsed JSON → jsonb column
    purity,
    grade,
    qc_observations: qc,
    analyzed_at: new Date().toISOString(),
    recorded_by: me.id,
  });
  if (error) return { error: error.message };

  revalidatePath(`/visits/${visitId}`);
  revalidatePath("/receiving");
  return {};
}

export async function updateAnalysis(
  _prev: AnalysisState,
  formData: FormData,
): Promise<AnalysisState> {
  const me = await getProfile();
  if (!me) return { error: "Not signed in" };
  if (me.role !== "receiving" && me.role !== "owner") return { error: "Forbidden" };

  const recordId = String(formData.get("record_id") ?? "");
  if (!recordId) return { error: "Missing record id" };

  const patch: Record<string, unknown> = {};
  const weightRaw = formData.get("weight");
  if (weightRaw != null && String(weightRaw).trim() !== "") patch.weight = Number(weightRaw);
  const grade = formData.get("grade"); if (grade != null) patch.grade = String(grade).trim() || null;
  const purity = formData.get("purity");
  if (purity != null && String(purity).trim() !== "") patch.purity = Number(purity);
  const sample = formData.get("sample_id");
  if (sample != null) patch.sample_id = String(sample).trim() || null;
  const xrfRaw = String(formData.get("xrf_result") ?? "");
  if (xrfRaw.trim()) {
    const j = parseXrfJson(xrfRaw);
    if (j === null) return { error: "XRF result must be valid JSON" };
    patch.xrf_result = j;
  }
  const qc = formData.get("qc_observations");
  if (qc != null) patch.qc_observations = String(qc).trim() || null;

  const supabase = await createClient();
  const { error } = await supabase.from("analysis_records").update(patch as never).eq("id", recordId);
  if (error) return { error: error.message };
  return {};
}
