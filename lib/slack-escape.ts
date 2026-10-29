const MAX_CUSTOMER_TEXT = 500;

export function escapeSlack(text: string): string {
  const trimmed =
    text.length > MAX_CUSTOMER_TEXT
      ? `${text.slice(0, MAX_CUSTOMER_TEXT)}...`
      : text;

  return trimmed
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/([*_~`])/g, "\\$1");
}

export function customerSays(text: string): string {
  return `Customer says: ${escapeSlack(text)}`;
}
