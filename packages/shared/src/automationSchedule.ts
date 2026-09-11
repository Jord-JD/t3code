import * as DateTime from "effect/DateTime";
import * as rrule from "rrule";
import type { RRule as RecurrenceRule } from "rrule";
// The package exposes CommonJS in Node and named ESM exports in Vite.
const { RRule } = (rrule as typeof rrule & { default?: typeof rrule }).default ?? rrule;

/** Expand floating calendar dates, then resolve their zone without using the host time zone. */
export function automationRule(rule: string, timezone: string, anchor: Date): RecurrenceRule {
  new Intl.DateTimeFormat("en", { timeZone: timezone }).format(anchor);
  const normalized = rule
    .trim()
    .toUpperCase()
    .replace(/^RRULE:/, "");
  if (
    !/^FREQ=(MINUTELY|HOURLY|DAILY|WEEKLY|MONTHLY|YEARLY)(;[A-Z]+=[A-Z0-9,+-]+)*$/.test(normalized)
  ) {
    throw new Error(
      "Use a single RRULE beginning with FREQ=MINUTELY, HOURLY, DAILY, WEEKLY, MONTHLY or YEARLY.",
    );
  }
  const options = RRule.parseString(normalized);
  if (options.interval !== undefined && (options.interval < 1 || options.interval > 1000)) {
    throw new Error("Schedule interval must be between 1 and 1000.");
  }
  if (
    options.bysecond !== undefined ||
    options.count !== undefined ||
    options.until !== undefined
  ) {
    throw new Error(
      "Use a recurring schedule without BYSECOND, COUNT or UNTIL. Pause it when finished.",
    );
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(anchor);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  return new RRule({
    ...options,
    bysecond: 0,
    dtstart: new Date(
      Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute")),
    ),
  });
}

export function nextAutomationRun(
  rule: string,
  timezone: string,
  anchor: Date,
  after: Date,
): string {
  const recurrence = automationRule(rule, timezone, anchor);
  const localAfter = DateTime.toDate(DateTime.makeZonedUnsafe(after, { timeZone: timezone }));
  const options = {
    ...recurrence.origOptions,
    until: new Date(localAfter.getTime() + 366 * 24 * 60 * 60 * 1000 * 5),
  };
  // Avoid scanning years of minute/hour occurrences while preserving the original interval phase.
  if (options.freq === RRule.MINUTELY || options.freq === RRule.HOURLY) {
    const step = (options.freq === RRule.MINUTELY ? 60_000 : 3_600_000) * (options.interval ?? 1);
    const original = options.dtstart!.getTime();
    const steps = Math.max(
      0,
      Math.floor((localAfter.getTime() - original - 2 * 86_400_000) / step),
    );
    options.dtstart = new Date(original + steps * step);
  }
  const bounded = new RRule(options);
  let candidate = bounded.after(localAfter, false);
  while (candidate) {
    const zoned = DateTime.makeZonedUnsafe(candidate, {
      timeZone: timezone,
      adjustForTimeZone: true,
    });
    // Skip nonexistent wall times on spring-forward days, and run ambiguous fall-back times once.
    if (
      DateTime.toDate(zoned).getTime() === candidate.getTime() &&
      DateTime.toEpochMillis(zoned) > after.getTime()
    ) {
      return DateTime.formatIso(zoned);
    }
    candidate = bounded.after(candidate, false);
  }
  throw new Error("This schedule has no occurrence in the next five years.");
}

export function describeAutomationSchedule(rule: string): string {
  try {
    return RRule.fromString(rule).toText();
  } catch {
    return rule;
  }
}
