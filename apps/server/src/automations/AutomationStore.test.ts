import { assert, it } from "@effect/vitest";
import {
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type Automation,
  type AutomationRun,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { makeAutomationStore } from "./AutomationStore.ts";

const automation: Automation = {
  id: "daily",
  name: "Daily review",
  prompt: "Review recent changes",
  projectIds: [ProjectId.make("project")],
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test-model" },
  runtimeMode: "approval-required",
  executionMode: "worktree",
  threadId: null,
  rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
  timezone: "Europe/London",
  status: "active",
  createdAt: "2026-09-11T00:00:00.000Z",
  updatedAt: "2026-09-11T00:00:00.000Z",
  nextRunAt: "2026-09-11T08:00:00.000Z",
};
const run: AutomationRun = {
  id: "run",
  automationId: automation.id,
  automationName: automation.name,
  projectId: automation.projectIds[0]!,
  threadId: ThreadId.make("thread"),
  status: "queued",
  startedAt: automation.createdAt,
  completedAt: null,
  error: null,
  read: false,
  archived: false,
};

it.effect("persists definitions and runs across store instances", () =>
  Effect.gen(function* () {
    const first = yield* makeAutomationStore;
    yield* first.save(automation);
    yield* first.saveRun(run);
    const second = yield* makeAutomationStore;
    assert.deepEqual(yield* second.list(), { automations: [automation], runs: [run] });
    yield* second.saveRun({ ...run, status: "completed", completedAt: automation.createdAt });
    assert.deepEqual(yield* second.activeRuns(), []);
  }).pipe(Effect.provide(SqlitePersistenceMemory)),
);

it.effect("deleting a schedule preserves reviewable results", () =>
  Effect.gen(function* () {
    const store = yield* makeAutomationStore;
    yield* store.save(automation);
    yield* store.saveRun(run);
    yield* store.remove(automation.id, automation.createdAt);
    const result = yield* store.list();
    assert.deepEqual(result.automations, []);
    assert.deepEqual(result.runs, [run]);
  }).pipe(Effect.provide(SqlitePersistenceMemory)),
);

it.effect("rolls back run claims with schedule changes as one transaction", () =>
  Effect.gen(function* () {
    const store = yield* makeAutomationStore;
    yield* store.save(automation);
    yield* store
      .transaction(
        Effect.gen(function* () {
          yield* store.saveRun(run);
          yield* store.save({ ...automation, nextRunAt: null, status: "paused" });
          return yield* Effect.fail("simulate failed claim");
        }),
      )
      .pipe(Effect.ignore);
    assert.deepEqual(yield* store.list(), { automations: [automation], runs: [] });
  }).pipe(Effect.provide(SqlitePersistenceMemory)),
);

it.effect(
  "restart recovery interrupts unfinished runs without retrying or losing review state",
  () =>
    Effect.gen(function* () {
      const store = yield* makeAutomationStore;
      yield* store.saveRun({ ...run, status: "running", read: true });
      yield* store.saveRun({ ...run, id: "finished", status: "completed", archived: true });
      yield* store.interruptActiveRuns("2026-09-12T00:00:00.000Z");
      const result = yield* store.list();
      const interrupted = result.runs.find((item) => item.id === run.id)!;
      assert.equal(interrupted.status, "interrupted");
      assert.equal(interrupted.read, true);
      assert.include(interrupted.error ?? "", "server restarted");
      assert.equal(result.runs.find((item) => item.id === "finished")?.status, "completed");
      assert.deepEqual(yield* store.activeRuns(), []);
    }).pipe(Effect.provide(SqlitePersistenceMemory)),
);
