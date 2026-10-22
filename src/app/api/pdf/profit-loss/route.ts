import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import { createHash } from "crypto";
import type { DocumentProps } from "@react-pdf/renderer";
import { requireActiveUser } from "@/lib/auth/require-active-user";
import { fetchProfitLoss, defaultFrom, defaultTo } from "@/lib/finance/profit-loss";
import { ProfitLossPdf } from "@/lib/pdf/templates/profit-loss";

export const runtime = "nodejs";

// Its own route rather than a case in /api/pdf/[type]/[id]: that one keys every
// document off a record id, and a statement is a DATE RANGE, not a record.

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  // The proxy does not run on /api, so this route owes the session checks
  // itself — including the forced password change.
  const gate = await requireActiveUser();
  if (!gate.ok) {
    const status = gate.reason === "unauthenticated" ? 401 : 403;
    const error = gate.reason === "unauthenticated" ? "Unauthenticated"
      : gate.reason === "disabled" ? "This account has been disabled"
      : "Set your password before using the app";
    return NextResponse.json({ error }, { status });
  }

  // The statement is the owner's and the accountant's. A site manager can see
  // their own figures on screen through RLS, but the company statement is not
  // theirs to hand out.
  const role = gate.profile.role;
  if (role !== "owner" && role !== "accounting") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const from = req.nextUrl.searchParams.get("from") ?? defaultFrom();
  const to = req.nextUrl.searchParams.get("to") ?? defaultTo();
  if (!DATE.test(from) || !DATE.test(to)) {
    return NextResponse.json({ error: "Dates must look like YYYY-MM-DD" }, { status: 400 });
  }
  if (from > to) {
    return NextResponse.json({ error: "The start date is after the end date" }, { status: 400 });
  }

  const rows = await fetchProfitLoss(from, to);
  const docId = createHash("sha256")
    .update(`profit-loss:${from}:${to}:${Date.now()}`)
    .digest("hex").slice(0, 16).toUpperCase();

  const buffer = await renderToBuffer(
    React.createElement(ProfitLossPdf, { rows, from, to, docId }) as unknown as React.ReactElement<DocumentProps>,
  );

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="profit-and-loss-${from}-to-${to}.pdf"`,
      // A statement is a point-in-time figure; never let one be cached and
      // handed back for a different period or after the books move.
      "Cache-Control": "no-store",
    },
  });
}
