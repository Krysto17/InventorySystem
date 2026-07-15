import Link from "next/link";
import { PayablesReview } from "@/components/payables/PayablesReview";

// Manager's payment console (own site; the general manager sees all sites via
// RLS). Hold or send back any payable awaiting payment, see what's on hold, and
// pick up items returned for correction. Settlements sent back land in the
// Pricing queue; advances/expenses return here as "returned for correction".
export default function ManagerPaymentsPage() {
  return (
    <main className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/manager" className="text-sm text-gray-500 hover:underline">← Pricing queue</Link>
        <h1 className="text-2xl font-bold">Payments</h1>
      </div>
      <p className="text-sm text-ink-2">
        Hold a payment to pause it, or send it back for correction. A settlement sent back
        returns to your <Link href="/manager" className="underline">pricing queue</Link> to re-price.
      </p>
      <PayablesReview canManage includeApproved includeReturned />
    </main>
  );
}
