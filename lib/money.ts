export function formatUsd(cents: number): string {
  return `USD ${(cents / 100).toFixed(2)}`;
}

export function dollarsToCents(amount: number): number {
  return Math.round(amount * 100);
}
