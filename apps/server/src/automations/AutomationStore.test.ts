import { assert, it } from "@effect/vitest";
import {
  ModelSelection,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type Automation,
  type AutomationRun,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
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

it.effect("deletes only the selected finished result and preserves its schedule", () =>
  Effect.gen(function* () {
    const store = yield* makeAutomationStore;
    yield* store.save(automation);
    yield* store.saveRun({ ...run, status: "completed" });
    yield* store.saveRun({ ...run, id: "other", status: "failed" });
    yield* store.removeRun(run.id);
    const result = yield* store.list();
    assert.deepEqual(result.automations, [automation]);
    assert.deepEqual(
      result.runs.map((item) => item.id),
      ["other"],
    );
    const reopened = yield* makeAutomationStore;
    assert.deepEqual(yield* reopened.list(), result);
  }).pipe(Effect.provide(SqlitePersistenceMemory)),
);

it.effect("does not delete queued or running results", () =>
  Effect.gen(function* () {
    const store = yield* makeAutomationStore;
    yield* store.saveRun(run);
    yield* store.saveRun({ ...run, id: "running", status: "running" });
    yield* store.removeRun(run.id);
    yield* store.removeRun("running");
    assert.equal((yield* store.activeRuns()).length, 2);
  }).pipe(Effect.provide(SqlitePersistenceMemory)),
);

it.effect("bulk deletion preserves unread, archived, and active results", () =>
  Effect.gen(function* () {
    const store = yield* makeAutomationStore;
    yield* store.save(automation);
    yield* store.saveRun({ ...run, id: "read-completed", status: "completed", read: true });
    yield* store.saveRun({ ...run, id: "read-failed", status: "failed", read: true });
    yield* store.saveRun({ ...run, id: "unread", status: "completed" });
    yield* store.saveRun({
      ...run,
      id: "archived",
      status: "completed",
      read: true,
      archived: true,
    });
    yield* store.saveRun({ ...run, id: "queued", read: true });
    yield* store.saveRun({ ...run, id: "running", status: "running", read: true });
    yield* store.removeAllReadRuns();
    yield* store.removeAllReadRuns();
    const result = yield* store.list();
    assert.deepEqual(result.automations, [automation]);
    assert.deepEqual(result.runs.map((item) => item.id).sort(), [
      "archived",
      "queued",
      "running",
      "unread",
    ]);
  }).pipe(Effect.provide(SqlitePersistenceMemory)),
);

it.effect("bulk deletion can be restricted to one automation", () =>
  Effect.gen(function* () {
    const store = yield* makeAutomationStore;
    yield* store.saveRun({ ...run, status: "completed", read: true });
    yield* store.saveRun({
      ...run,
      id: "other",
      automationId: "other-automation",
      status: "completed",
      read: true,
    });
    yield* store.removeAllReadRuns(automation.id);
    assert.deepEqual(
      (yield* store.list()).runs.map((item) => item.id),
      ["other"],
    );
  }).pipe(Effect.provide(SqlitePersistenceMemory)),
);

it.effect(
  "removes deleted-thread results, pauses bound automations, and rejects late updates",
  () =>
    Effect.gen(function* () {
      const store = yield* makeAutomationStore;
      const sql = yield* SqlClient.SqlClient;
      yield* store.save(automation);
      yield* store.save({ ...automation, id: "bound", threadId: run.threadId });
      for (const status of ["queued", "running", "completed", "failed", "interrupted"] as const) {
        yield* store.saveRun({
          ...run,
          id: status,
          status,
          read: true,
          archived: status === "completed",
        });
      }
      const unrelated = { ...run, id: "unrelated", threadId: ThreadId.make("other-thread") };
      yield* store.saveRun(unrelated);
      yield* sql`INSERT INTO projection_threads
      (thread_id, project_id, title, model_selection_json, created_at, updated_at, deleted_at)
      VALUES (${run.threadId}, ${run.projectId}, 'Deleted thread', ${yield* Schema.encodeEffect(Schema.fromJsonString(ModelSelection))(automation.modelSelection)},
        ${automation.createdAt}, ${automation.createdAt}, ${automation.createdAt})`;
      assert.deepEqual(yield* store.activeRuns(), [unrelated]);
      const reopened = yield* makeAutomationStore;
      const result = yield* reopened.list();
      assert.deepEqual(result.runs, [unrelated]);
      assert.deepEqual(
        result.automations.find((item) => item.id === automation.id),
        automation,
      );
      assert.equal(result.automations.find((item) => item.id === "bound")?.status, "paused");
      assert.equal(result.automations.find((item) => item.id === "bound")?.nextRunAt, null);
      yield* store.saveRun({ ...run, id: "running", status: "failed" });
      yield* store.saveRun({ ...run, id: "new-late-update", status: "completed" });
      const rows = yield* sql<{ id: string }>`SELECT id FROM automation_runs`;
      assert.deepEqual(
        rows.map((row) => row.id),
        ["unrelated"],
      );
    }).pipe(Effect.provide(SqlitePersistenceMemory)),
);
