export const campaignCurrencies = [
  "ZAR",
  "USD",
  "GBP",
  "EUR",
  "AUD",
  "CAD",
  "AED",
  "INR",
  "SGD",
  "NZD",
];
export const campaignCountries = [
  ["ALL", "Worldwide"],
  ["ZA", "South Africa"],
  ["US", "United States"],
  ["GB", "United Kingdom"],
  ["MY", "Malaysia"],
  ["SG", "Singapore"],
  ["AU", "Australia"],
  ["CA", "Canada"],
  ["NZ", "New Zealand"],
  ["AE", "United Arab Emirates"],
  ["IN", "India"],
  ["ID", "Indonesia"],
  ["KE", "Kenya"],
  ["NG", "Nigeria"],
  ["DE", "Germany"],
  ["FR", "France"],
  ["NL", "Netherlands"],
  ["IE", "Ireland"],
  ["PH", "Philippines"],
  ["TH", "Thailand"],
  ["ZM", "Zambia"],
  ["BW", "Botswana"],
  ["NA", "Namibia"],
  ["ZW", "Zimbabwe"],
];
export type CampaignPlan = {
  id: string;
  brand_id: string;
  brand_name: string;
  name: string;
  platform: string;
  objective: string;
  currency: string | null;
  budget_minor: number | null;
  budget_basis: "total" | "daily";
  start_date: string | null;
  end_date: string | null;
  countries: string[];
  audience: string;
  brief: string;
  destination: string;
  status: "draft" | "ready" | "archived";
  version: number;
  updated_at: number;
};
export function parseBudget(value: unknown) {
  if (value === "" || value === null || value === undefined) return null;
  if (typeof value !== "string" || !/^\d{1,9}(\.\d{1,2})?$/.test(value))
    throw new Error("Enter a budget with no more than two decimal places.");
  const [whole, fraction = ""] = value.split("."),
    minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (minor <= 0) throw new Error("Budget must be greater than zero.");
  return minor;
}
export function budgetGroups(plans: CampaignPlan[]) {
  const groups = new Map<
    string,
    { currency: string; basis: string; minor: number; plans: number }
  >();
  for (const p of plans) {
    if (p.status === "archived" || !p.currency || p.budget_minor == null)
      continue;
    const key = p.currency + ":" + p.budget_basis,
      g = groups.get(key) || {
        currency: p.currency,
        basis: p.budget_basis,
        minor: 0,
        plans: 0,
      };
    g.minor += p.budget_minor;
    g.plans++;
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) =>
    (a.currency + a.basis).localeCompare(b.currency + b.basis),
  );
}
