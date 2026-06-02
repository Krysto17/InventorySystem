import { Card, CardContent } from "./card";

export function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: "green" | "red" | "blue" | "yellow";
}) {
  const accentMap: Record<string, string> = {
    green:  "text-green-700",
    red:    "text-red-700",
    blue:   "text-blue-700",
    yellow: "text-yellow-700",
  };
  const accentClass = accent ? (accentMap[accent] ?? "") : "";

  return (
    <Card>
      <CardContent className="space-y-1">
        <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
        <div className={`text-2xl font-bold ${accentClass}`}>{value}</div>
        {sub && <div className="text-xs text-gray-500">{sub}</div>}
      </CardContent>
    </Card>
  );
}
