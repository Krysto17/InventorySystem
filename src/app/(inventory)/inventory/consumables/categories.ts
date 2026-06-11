export const CONSUMABLE_CATEGORIES = [
  "fuel_lubricants",
  "utility",
  "wages",
  "repairs_maintenance",
  "stationaries",
  "transport",
  "toiletries",
  "others",
] as const;

export type ConsumableCategory = (typeof CONSUMABLE_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<ConsumableCategory, string> = {
  fuel_lubricants: "Fuel / Lubricants",
  utility: "Utility",
  wages: "Wages",
  repairs_maintenance: "Repairs / Maintenance",
  stationaries: "Stationaries",
  transport: "Transport",
  toiletries: "Toiletries",
  others: "Others",
};
