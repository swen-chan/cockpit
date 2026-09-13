export function formatShanghaiTime(value: string, timeOnly = false): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Unavailable";
  const options: Intl.DateTimeFormatOptions = timeOnly
    ? { hour: "2-digit", hour12: false, minute: "2-digit", second: "2-digit", timeZone: "Asia/Shanghai" }
    : { day: "2-digit", hour: "2-digit", hour12: false, minute: "2-digit", month: "2-digit", timeZone: "Asia/Shanghai", year: "numeric" };
  return `${new Intl.DateTimeFormat("en-CA", options).format(date).replace(",", "")} CST`;
}
