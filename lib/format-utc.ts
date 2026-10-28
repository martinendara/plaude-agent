export function formatUtc(isoDate: string): string {
  const date = new Date(isoDate);

  if (Number.isNaN(date.getTime())) return isoDate;

  return `${date.toISOString().replace("T", " ").slice(0, 16)} UTC`;
}
