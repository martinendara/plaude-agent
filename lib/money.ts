function withThousands(value: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function formatUsd(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const fraction = abs % 100;

  return `USD ${sign}${withThousands(String(dollars))}.${String(fraction).padStart(2, "0")}`;
}

export function formatUsdCompact(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const fraction = abs % 100;
  const base = `USD ${sign}${withThousands(String(dollars))}`;

  return fraction === 0
    ? base
    : `${base}.${String(fraction).padStart(2, "0")}`;
}

export function dollarsToCents(amount: number): number {
  return Math.round(amount * 100);
}
