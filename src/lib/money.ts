export type Currency = "ARS" | "USD";

export function parseMoney(value: string): bigint {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d{1,16}(?:\.\d{1,2})?$/.test(normalized)) {
    throw new Error("Ingresá un importe positivo, sin separador de miles y con hasta dos decimales.");
  }
  const [whole, decimals = ""] = normalized.split(".");
  const amount = BigInt(whole!) * 100n + BigInt(decimals.padEnd(2, "0"));
  if (amount > 9_223_372_036_854_775_807n) throw new Error("El importe es demasiado grande.");
  return amount;
}

export function moneyInput(value: bigint | null | undefined): string {
  if (value === null || value === undefined) return "";
  return `${value / 100n}.${(value % 100n).toString().padStart(2, "0")}`;
}

export function formatMoney(amount: bigint, currency: Currency = "ARS"): string {
  const absolute = amount < 0n ? -amount : amount;
  const whole = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(absolute / 100n);
  const cents = (absolute % 100n).toString().padStart(2, "0");
  return `${amount < 0n ? "−" : ""}${currency} ${whole},${cents}`;
}

export function monthlyEquivalent(amount: bigint, frequencyMonths: number): bigint {
  if (![1, 6, 12].includes(frequencyMonths)) throw new Error("La frecuencia no es válida.");
  const divisor = BigInt(frequencyMonths);
  return (amount + divisor / 2n) / divisor;
}
