export function formatValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return "—";
  if (Array.isArray(value)) return value.map(formatValue).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    const date = new Date(text);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleDateString("ru-RU");
    }
  }
  return text;
}

export function formatDate(value: unknown): string {
  if (!value) return "—";
  const text = String(value);
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleDateString("ru-RU");
}

export function formatDateRange(from: unknown, to: unknown): string {
  const start = formatDate(from);
  const end = formatDate(to);
  if (start === "—" && end === "—") return "даты не указаны";
  if (start === end) return start;
  return `${start} → ${end}`;
}

export function parseDate(value: unknown): Date | undefined {
  if (!value) return undefined;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return undefined;
  return date;
}
