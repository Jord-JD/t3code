export const AUTOMATION_DAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

/** Use simple controls only when they can round-trip the entire saved rule. */
export function parseEditorSchedule(rule?: string) {
  const fallback = {
    cadence: "custom",
    time: "09:00",
    interval: 1,
    days: AUTOMATION_DAYS.slice(0, 5),
  };
  if (!rule) return { ...fallback, cadence: "weekly" };
  const parts = rule
    .toUpperCase()
    .replace(/^RRULE:/, "")
    .split(";");
  const fields: Record<string, string | undefined> = Object.fromEntries(
    parts.map((part) => part.split("=")),
  );
  if (new Set(parts.map((part) => part.split("=")[0])).size !== parts.length) return fallback;
  if (
    fields.FREQ === "HOURLY" &&
    Object.keys(fields).every((key) => ["FREQ", "INTERVAL"].includes(key))
  ) {
    const interval = Number(fields.INTERVAL ?? 1);
    if (Number.isInteger(interval) && interval >= 1 && interval <= 1000)
      return { ...fallback, cadence: "hourly", interval };
  }
  if (
    !["DAILY", "WEEKLY"].includes(fields.FREQ ?? "") ||
    Object.keys(fields).some((key) => !["FREQ", "BYHOUR", "BYMINUTE", "BYDAY"].includes(key))
  )
    return fallback;
  if (!/^\d{1,2}$/.test(fields.BYHOUR ?? "") || !/^\d{1,2}$/.test(fields.BYMINUTE ?? ""))
    return fallback;
  const hour = Number(fields.BYHOUR),
    minute = Number(fields.BYMINUTE);
  if (hour > 23 || minute > 59) return fallback;
  const days = fields.BYDAY?.split(",");
  if (fields.FREQ === "DAILY" && days) return fallback;
  if (
    fields.FREQ === "WEEKLY" &&
    (!days?.length || days.some((day) => !AUTOMATION_DAYS.includes(day)))
  )
    return fallback;
  return {
    ...fallback,
    cadence: fields.FREQ === "DAILY" ? "daily" : "weekly",
    time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    days: days ?? fallback.days,
  };
}
