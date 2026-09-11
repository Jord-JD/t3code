import { describe, expect, it } from "vite-plus/test";
import { parseEditorSchedule } from "./automationEditorSchedule";

describe("saved automation schedule editing", () => {
  it("restores daily, weekly and hourly controls without losing their settings", () => {
    expect(parseEditorSchedule("FREQ=DAILY;BYHOUR=17;BYMINUTE=30")).toMatchObject({
      cadence: "daily",
      time: "17:30",
    });
    expect(parseEditorSchedule("FREQ=WEEKLY;BYHOUR=9;BYMINUTE=5;BYDAY=TU,SA")).toMatchObject({
      cadence: "weekly",
      time: "09:05",
      days: ["TU", "SA"],
    });
    expect(parseEditorSchedule("FREQ=HOURLY;INTERVAL=6")).toMatchObject({
      cadence: "hourly",
      interval: 6,
    });
  });
  it("preserves complex rules in the custom editor instead of silently dropping constraints", () => {
    for (const rule of [
      "FREQ=DAILY;BYHOUR=9;BYMINUTE=0;BYDAY=MO",
      "FREQ=WEEKLY;INTERVAL=2;BYHOUR=9;BYMINUTE=0;BYDAY=MO",
      "FREQ=MONTHLY;BYMONTHDAY=1",
      "FREQ=DAILY;BYHOUR=9,17;BYMINUTE=0",
      "FREQ=WEEKLY;BYHOUR=9;BYMINUTE=0",
      "FREQ=DAILY;BYHOUR=9;BYHOUR=17;BYMINUTE=0",
    ])
      expect(parseEditorSchedule(rule).cadence).toBe("custom");
  });
});
