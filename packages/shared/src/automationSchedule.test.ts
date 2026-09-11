import { describe, expect, it } from "vite-plus/test";
import { nextAutomationRun } from "./automationSchedule.ts";

const next = (rule: string, zone: string, after: string, anchor = "2026-01-01T00:00:00Z") =>
  nextAutomationRun(rule, zone, new Date(anchor), new Date(after));

describe("automation schedules", () => {
  it("uses the chosen timezone and advances strictly past a due time", () => {
    expect(next("FREQ=DAILY;BYHOUR=9;BYMINUTE=0", "Europe/London", "2026-09-11T08:00:00Z")).toBe(
      "2026-09-12T08:00:00.000Z",
    );
  });
  it("keeps the local hour across the daylight saving transition", () => {
    expect(next("FREQ=DAILY;BYHOUR=9;BYMINUTE=0", "Europe/London", "2026-10-24T08:00:00Z")).toBe(
      "2026-10-25T09:00:00.000Z",
    );
  });
  it("skips nonexistent spring-forward times", () => {
    expect(next("FREQ=DAILY;BYHOUR=1;BYMINUTE=30", "Europe/London", "2026-03-28T01:30:00Z")).toBe(
      "2026-03-30T00:30:00.000Z",
    );
  });
  it("does not repeat an ambiguous fall-back time", () => {
    expect(next("FREQ=DAILY;BYHOUR=1;BYMINUTE=30", "Europe/London", "2026-10-25T00:30:00Z")).toBe(
      "2026-10-26T01:30:00.000Z",
    );
  });
  it("skips weekends and supports monthly rules", () => {
    expect(
      next("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=0", "UTC", "2026-09-11T10:00:00Z"),
    ).toBe("2026-09-14T09:00:00.000Z");
    expect(
      next("FREQ=MONTHLY;BYMONTHDAY=1;BYHOUR=9;BYMINUTE=0", "UTC", "2026-09-11T10:00:00Z"),
    ).toBe("2026-10-01T09:00:00.000Z");
  });
  it("preserves interval phase when the host missed many runs", () => {
    expect(
      next("FREQ=HOURLY;INTERVAL=3", "UTC", "2026-09-11T10:00:00Z", "2026-01-01T01:15:00Z"),
    ).toBe("2026-09-11T10:15:00.000Z");
  });
  it("rejects malformed and excessively frequent schedules", () => {
    for (const rule of [
      "FREQ=SECONDLY",
      "FREQ=HOURLY;INTERVAL=0",
      "FREQ=DAILY;BYSECOND=2",
      "FREQ=DAILY;COUNT=100",
      "not a rule",
    ]) {
      expect(() => next(rule, "UTC", "2026-09-11T00:00:00Z")).toThrow();
    }
    expect(() => next("FREQ=DAILY", "Not/AZone", "2026-09-11T00:00:00Z")).toThrow();
  });
});
