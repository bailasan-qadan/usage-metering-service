const MONTH_PATTERN = /^20\d{2}-(0[1-9]|1[0-2])$/;

export function utcMonthStart(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}-01`;
}

export function formatMonth(monthStart: string): string {
  return monthStart.slice(0, 7);
}

export function parseMonth(value: string): string | undefined {
  return MONTH_PATTERN.test(value) ? `${value}-01` : undefined;
}
