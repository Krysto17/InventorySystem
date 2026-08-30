/**
 * Reaching the running application over HTTP.
 *
 * The previous probe treated *any* response as "the app is up", so when an
 * unrelated project happened to be serving the same port the HTTP tests ran
 * against it and reported failures that had nothing to do with this codebase.
 *
 * Two states are deliberately distinguished:
 *
 *   absent  — nothing is listening. The dependency is missing; tests skip and
 *             say so. That is honest, not a green-washed failure.
 *   wrong   — something answered but it is not this application. That is far
 *             more dangerous than nothing answering, because the results look
 *             real. It throws.
 */
export const APP_BASE = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export type ServerProbe =
  | { state: "ok" }
  | { state: "absent"; detail: string }
  | { state: "wrong"; detail: string };

/**
 * Identify the app by a response only it produces: the PDF route answers an
 * unauthenticated request with a JSON 401 carrying `error: "Unauthenticated"`.
 * A different app on the port returns HTML, a 404, or a different body.
 */
export async function probeAppServer(base = APP_BASE): Promise<ServerProbe> {
  let res: Response;
  try {
    res = await fetch(`${base}/api/pdf/processing/00000000-0000-0000-0000-000000000000`, {
      signal: AbortSignal.timeout(3000),
    });
  } catch (e) {
    return { state: "absent", detail: `nothing listening on ${base} (${(e as Error).name})` };
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (res.status !== 401 || !contentType.includes("application/json")) {
    return {
      state: "wrong",
      detail:
        `${base} answered ${res.status} ${contentType || "(no content-type)"} — expected a JSON 401 ` +
        `from this app's PDF route. Something else is serving this port.`,
    };
  }
  try {
    const body = (await res.json()) as { error?: string };
    if (body.error !== "Unauthenticated") {
      return { state: "wrong", detail: `${base} returned JSON 401 but body was ${JSON.stringify(body)}` };
    }
  } catch {
    return { state: "wrong", detail: `${base} returned a 401 whose body was not JSON` };
  }
  return { state: "ok" };
}

/**
 * Resolve the probe into a boolean for the suite, throwing on the wrong-app
 * case so it can never be mistaken for a pass or a clean skip.
 */
export async function requireAppServer(base = APP_BASE): Promise<boolean> {
  const probe = await probeAppServer(base);
  if (probe.state === "wrong") {
    throw new Error(
      `HTTP tests aborted: ${probe.detail}\n` +
      `Start this app on that port (npm run build && npx next start -p <port>) ` +
      `or point NEXT_PUBLIC_SITE_URL at it.`,
    );
  }
  if (probe.state === "absent") {
    console.warn(`[skipped] HTTP tests need the app running — ${probe.detail}`);
    return false;
  }
  return true;
}

/**
 * Is Supabase Storage reachable?
 *
 * The receipts tests assert who may upload. When the storage container is not
 * running, an upload fails with a network error — which makes the negative
 * cases ("receiving cannot upload") pass for entirely the wrong reason, and
 * they would keep passing if Storage RLS were removed altogether. Skipping the
 * file is honest; running half of it is not.
 */
export async function storageAvailable(): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return false;
  try {
    const r = await fetch(`${url}/storage/v1/bucket`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(3000),
    });
    return r.ok;
  } catch {
    console.warn("[skipped] Supabase Storage is not reachable — receipts RLS tests need it running.");
    return false;
  }
}
