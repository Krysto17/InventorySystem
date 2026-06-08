// Server component — renders PDF download links based on visit state + viewer role.
import type { VisitState } from "@/lib/visits/state-machine";

type Role = "processing" | "receiving" | "manager" | "accounting" | "inventory" | "owner";

type Props = {
  visitId: string;
  visitState: VisitState;
  viewerRole: Role;
  hasProcessing: boolean;
  hasAnalysis: boolean;
  hasPricing: boolean;
  hasPayments: boolean;
};

function PdfLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 px-2 py-1 border rounded text-xs hover:bg-gray-50 text-gray-700"
    >
      ↓ {label}
    </a>
  );
}

export function PdfDownloadBar({
  visitId,
  visitState,
  viewerRole,
  hasProcessing,
  hasAnalysis,
  hasPricing,
  hasPayments,
}: Props) {
  const base = `/api/pdf`;
  const v = visitId;
  const isOwner = viewerRole === "owner";

  return (
    <section className="border rounded p-3 bg-gray-50">
      <div className="text-xs uppercase text-gray-500 mb-2 tracking-wide">Download PDFs</div>
      <div className="flex flex-wrap gap-2">
        {/* Processing — processing role, manager, accounting, inventory, owner */}
        {hasProcessing && (viewerRole === "processing" || viewerRole === "manager" || viewerRole === "accounting" || viewerRole === "inventory" || isOwner) && (
          <PdfLink href={`${base}/processing/${v}`} label="Processing report" />
        )}

        {/* Analysis — receiving, manager, accounting, inventory, owner */}
        {hasAnalysis && (viewerRole === "receiving" || viewerRole === "manager" || viewerRole === "accounting" || viewerRole === "inventory" || isOwner) && (
          <PdfLink href={`${base}/analysis/${v}`} label="Analysis report" />
        )}

        {/* Pricing — manager + owner only */}
        {hasPricing && (viewerRole === "manager" || isOwner) && (
          <PdfLink href={`${base}/pricing/${v}`} label="Pricing sheet" />
        )}

        {/* Payments — accounting + owner only */}
        {hasPayments && (viewerRole === "accounting" || isOwner) && (
          <PdfLink href={`${base}/payments/${v}`} label="Payment statement" />
        )}

        {/* Full dossier — owner only */}
        {isOwner && (
          <PdfLink href={`${base}/dossier/${v}`} label="Full dossier" />
        )}
      </div>
    </section>
  );
}
