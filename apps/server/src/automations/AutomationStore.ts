import {
  Automation,
  AutomationError,
  AutomationRun,
  type AutomationSnapshot,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export const makeAutomationStore = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const decodeAutomation = Schema.decodeUnknownEffect(Schema.fromJsonString(Automation));
  const decodeRun = Schema.decodeUnknownEffect(Schema.fromJsonString(AutomationRun));
  const encodeAutomation = Schema.encodeEffect(Schema.fromJsonString(Automation));
  const encodeRun = Schema.encodeEffect(Schema.fromJsonString(AutomationRun));
  const reconcileDeletedThreads = () =>
    sql.withTransaction(
      Effect.gen(function* () {
        yield* sql`DELETE FROM automation_runs WHERE thread_id IN (
          SELECT thread_id FROM projection_threads WHERE deleted_at IS NOT NULL
        )`;
        yield* sql`UPDATE automations SET next_run_at = NULL,
          definition = json_set(definition, '$.status', 'paused', '$.nextRunAt', NULL)
          WHERE deleted_at IS NULL AND json_extract(definition, '$.status') = 'active'
          AND json_extract(definition, '$.threadId') IN (
            SELECT thread_id FROM projection_threads WHERE deleted_at IS NOT NULL
          )`;
      }),
    );
  const listAutomations = Effect.fn("AutomationStore.listAutomations")(function* () {
    yield* reconcileDeletedThreads();
    const definitions = yield* sql<{
      definition: string;
    }>`SELECT definition FROM automations WHERE deleted_at IS NULL ORDER BY id`;
    return yield* Effect.forEach(definitions, (row) => decodeAutomation(row.definition));
  });
  const list = Effect.fn("AutomationStore.list")(function* (): Effect.fn.Return<
    AutomationSnapshot,
    AutomationError
  > {
    return yield* Effect.gen(function* () {
      const automations = yield* listAutomations();
      const rows = yield* sql<{
        data: string;
      }>`SELECT data FROM automation_runs ORDER BY rowid DESC LIMIT 500`;
      return {
        automations,
        runs: yield* Effect.forEach(rows, (row) => decodeRun(row.data)),
      };
    }).pipe(
      Effect.mapError(
        (cause) => new AutomationError({ message: `Could not load automations: ${String(cause)}` }),
      ),
    );
  });
  const save = Effect.fn("AutomationStore.save")(function* (automation: Automation) {
    const definition = yield* encodeAutomation(automation);
    yield* sql`INSERT INTO automations(id, definition, next_run_at) VALUES (${automation.id}, ${definition}, ${automation.nextRunAt})
      ON CONFLICT(id) DO UPDATE SET definition=excluded.definition, next_run_at=excluded.next_run_at`;
  });
  const saveRun = Effect.fn("AutomationStore.saveRun")(function* (run: AutomationRun) {
    const data = yield* encodeRun(run);
    yield* sql`INSERT INTO automation_runs(id, automation_id, thread_id, status, data)
      SELECT ${run.id}, ${run.automationId}, ${run.threadId}, ${run.status}, ${data}
      WHERE NOT EXISTS (SELECT 1 FROM projection_threads WHERE thread_id = ${run.threadId} AND deleted_at IS NOT NULL)
      ON CONFLICT(id) DO UPDATE SET status=excluded.status, data=excluded.data`;
  });
  const activeRuns = Effect.fn("AutomationStore.activeRuns")(function* () {
    const rows = yield* sql<{
      data: string;
    }>`SELECT data FROM automation_runs WHERE status IN ('queued', 'running')
      AND NOT EXISTS (SELECT 1 FROM projection_threads
        WHERE projection_threads.thread_id = automation_runs.thread_id AND deleted_at IS NOT NULL)`;
    return yield* Effect.forEach(rows, (row) => decodeRun(row.data));
  });
  const interruptActiveRuns = Effect.fn("AutomationStore.interruptActiveRuns")(function* (
    timestamp: string,
  ) {
    yield* sql.withTransaction(
      Effect.gen(function* () {
        for (const run of yield* activeRuns()) {
          yield* saveRun({
            ...run,
            status: "interrupted",
            completedAt: timestamp,
            error:
              "The server restarted before this run finished. Review its thread before running again.",
          });
        }
      }),
    );
  });
  const remove = (id: string, now: string) =>
    sql`UPDATE automations SET deleted_at=${now}, next_run_at=NULL WHERE id=${id}`;
  const removeRun = (id: string) =>
    sql`DELETE FROM automation_runs WHERE id=${id} AND status NOT IN ('queued', 'running')`;
  const removeAllReadRuns = (automationId?: string) =>
    sql`DELETE FROM automation_runs WHERE json_extract(data, '$.read') = 1
      AND json_extract(data, '$.archived') = 0 AND status NOT IN ('queued', 'running')
      AND (${automationId ?? null} IS NULL OR automation_id = ${automationId ?? null})`;
  return {
    list,
    listAutomations,
    save,
    saveRun,
    activeRuns,
    remove,
    removeRun,
    removeAllReadRuns,
    interruptActiveRuns,
    transaction: sql.withTransaction,
  };
});
