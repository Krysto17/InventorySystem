"use client";

import { useActionState } from "react";
import { authorizeExit, type AuthorizeState } from "@/app/(owner)/owner/actions";
import { releaseVisit } from "@/app/(gate)/gate/actions";
import { formatTimestamp } from "@/lib/visits/format";

type Authorization = {
  authorized_at: string;
  authorized_by_name: string | null;
  note: string | null;
};

const initialAuthorize: AuthorizeState = {};

export function ExitAuthorizationCard({
  visitId,
  authorization,
  canAuthorize,
  canRelease,
}: {
  visitId: string;
  authorization: Authorization | null;
  canAuthorize: boolean;
  canRelease: boolean;
}) {
  const [authState, authAction, authPending] = useActionState(authorizeExit, initialAuthorize);

  async function handleRelease() {
    const result = await releaseVisit(visitId);
    if (result.error) alert(result.error);
    else window.location.reload();
  }

  return (
    <section className="border rounded p-4">
      <div className="text-xs uppercase text-gray-500 mb-1">Exit authorization</div>

      {authorization ? (
        <>
          <div className="text-sm">
            Authorized by {authorization.authorized_by_name ?? "—"} at{" "}
            {formatTimestamp(authorization.authorized_at)}
          </div>
          {authorization.note && (
            <div className="text-sm text-gray-600 mt-1">"{authorization.note}"</div>
          )}
          {canRelease && (
            <button
              onClick={handleRelease}
              className="mt-3 px-3 py-2 bg-black text-white rounded"
            >
              Release supplier
            </button>
          )}
        </>
      ) : canAuthorize ? (
        <form action={authAction} className="space-y-2 mt-2">
          <input type="hidden" name="visit_id" value={visitId} />
          <input
            name="note"
            placeholder="Optional note"
            className="w-full border rounded px-2 py-1"
          />
          {authState.error && <p className="text-red-600 text-sm">{authState.error}</p>}
          <button
            type="submit"
            disabled={authPending}
            className="px-3 py-2 bg-black text-white rounded"
          >
            {authPending ? "Authorizing..." : "Authorize exit"}
          </button>
        </form>
      ) : (
        <p className="text-sm text-gray-600">Waiting for owner to authorize.</p>
      )}
    </section>
  );
}
