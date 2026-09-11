import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE automations (id TEXT PRIMARY KEY, definition TEXT NOT NULL, next_run_at TEXT, deleted_at TEXT)`;
  yield* sql`CREATE INDEX automations_due ON automations(next_run_at) WHERE deleted_at IS NULL`;
  yield* sql`CREATE TABLE automation_runs (
    id TEXT PRIMARY KEY, automation_id TEXT NOT NULL, thread_id TEXT NOT NULL,
    status TEXT NOT NULL, data TEXT NOT NULL
  )`;
  yield* sql`CREATE INDEX automation_runs_active ON automation_runs(automation_id, status)`;
  yield* sql`CREATE INDEX automation_runs_thread ON automation_runs(thread_id, status)`;
});
