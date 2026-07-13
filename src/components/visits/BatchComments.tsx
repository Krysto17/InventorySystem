import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { addBatchComment } from "@/app/visits/[id]/settlement-actions";
import { formatTimestamp } from "@/lib/visits/format";
import { one as g1 } from "@/lib/db/relation";
import type { Role } from "@/lib/auth/roles";

// Manager's notes on a supply, visible to owner + accountant before paying.
// Manager/owner can add; accountant reads. Other roles don't see this card.
export async function BatchComments({ visitId, viewerRole }: { visitId: string; viewerRole: Role }) {
  if (!["manager", "owner", "accounting"].includes(viewerRole)) return null;

  const supabase = await createClient();
  const { data: comments } = await supabase
    .from("batch_comments")
    .select("id, body, created_at, author_profile:profiles!batch_comments_author_fkey(full_name)")
    .eq("visit_id", visitId)
    .order("created_at", { ascending: true });

  const canComment = viewerRole === "manager" || viewerRole === "owner";

  return (
    <Card>
      <CardHeader><h2 className="text-sm font-semibold">Manager comments</h2></CardHeader>
      <CardContent className="space-y-3">
        {(comments?.length ?? 0) === 0 ? (
          <p className="text-sm text-ink-2">No comments on this supply yet.</p>
        ) : (
          <ul className="space-y-2">
            {(comments ?? []).map((c) => {
              const who = g1<{ full_name: string }>((c as { author_profile: unknown }).author_profile)?.full_name ?? "—";
              return (
                <li key={c.id as string} className="rounded border border-line p-2 text-sm">
                  <div className="whitespace-pre-wrap">{c.body as string}</div>
                  <div className="mt-1 text-xs text-ink-2">{who} · {formatTimestamp(c.created_at as string)}</div>
                </li>
              );
            })}
          </ul>
        )}

        {canComment && (
          <form action={addBatchComment} className="space-y-2 border-t border-line pt-3">
            <input type="hidden" name="visit_id" value={visitId} />
            <label className="block text-xs font-medium">
              Add a comment <span className="font-normal text-ink-2">(visible to owner &amp; accountant)</span>
              <textarea
                name="body"
                rows={2}
                required
                placeholder="e.g. Rate reduced for moisture; pay after Friday; etc."
                className="mt-1 block w-full rounded border px-2 py-1 text-sm"
              />
            </label>
            <SubmitButton pendingText="Posting…" className="rounded bg-ink px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
              Post comment
            </SubmitButton>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
