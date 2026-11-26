// Currency is account metadata, never inferred from browser locale or geography.
export function currencyFactor(currency: string) {
  if (!/^[A-Z]{3}$/.test(currency))
    throw new Error("A valid account currency is required");
  return (
    10 **
    new Intl.NumberFormat("en", {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits!
  );
}
export function formatMoney(amount: number | null, currency: string) {
  if (amount === null) return "—";
  currencyFactor(currency);
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    currencyDisplay: "code",
  }).format(amount);
}
