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
  const listAutomations = Effect.fn("AutomationStore.listAutomations")(function* () {
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
      const rows = yield* sql<{
        data: string;
      }>`SELECT data FROM automation_runs ORDER BY rowid DESC LIMIT 500`;
      return {
        automations: yield* listAutomations(),
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
      VALUES (${run.id}, ${run.automationId}, ${run.threadId}, ${run.status}, ${data})
      ON CONFLICT(id) DO UPDATE SET status=excluded.status, data=excluded.data`;
  });
  const activeRuns = Effect.fn("AutomationStore.activeRuns")(function* () {
    const rows = yield* sql<{
      data: string;
    }>`SELECT data FROM automation_runs WHERE status IN ('queued', 'running')`;
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
  return {
    list,
    listAutomations,
    save,
    saveRun,
    activeRuns,
    remove,
    interruptActiveRuns,
    transaction: sql.withTransaction,
  };
});
