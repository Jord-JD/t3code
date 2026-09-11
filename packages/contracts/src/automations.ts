import * as Schema from "effect/Schema";
import { IsoDateTime, ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ModelSelection, RuntimeMode } from "./orchestration.ts";

export const AutomationInput = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(120)),
  prompt: TrimmedNonEmptyString.check(Schema.isMaxLength(32_000)),
  projectIds: Schema.Array(ProjectId).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  executionMode: Schema.Literals(["local", "worktree"]),
  threadId: Schema.NullOr(ThreadId),
  rrule: TrimmedNonEmptyString.check(Schema.isMaxLength(512)),
  timezone: TrimmedNonEmptyString,
  status: Schema.Literals(["active", "paused"]),
});
export type AutomationInput = typeof AutomationInput.Type;
export const Automation = Schema.Struct({
  ...AutomationInput.fields,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  nextRunAt: Schema.NullOr(IsoDateTime),
});
export type Automation = typeof Automation.Type;
export const AutomationRun = Schema.Struct({
  id: Schema.String,
  automationId: Schema.String,
  automationName: Schema.String,
  projectId: ProjectId,
  threadId: ThreadId,
  status: Schema.Literals(["queued", "running", "completed", "failed", "interrupted"]),
  startedAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime),
  error: Schema.NullOr(Schema.String),
  read: Schema.Boolean,
  archived: Schema.Boolean,
});
export type AutomationRun = typeof AutomationRun.Type;
export const AutomationSnapshot = Schema.Struct({
  automations: Schema.Array(Automation),
  runs: Schema.Array(AutomationRun),
});
export type AutomationSnapshot = typeof AutomationSnapshot.Type;
export const AutomationAction = Schema.Union([
  Schema.Struct({ type: Schema.Literal("save"), automation: AutomationInput }),
  Schema.Struct({ type: Schema.Literals(["run", "delete", "pause", "resume"]), id: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("review"),
    id: Schema.String,
    read: Schema.Boolean,
    archived: Schema.Boolean,
  }),
  Schema.Struct({ type: Schema.Literal("delete-run"), id: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("delete-all-read"),
    automationId: Schema.optional(Schema.String),
  }),
  Schema.Struct({ type: Schema.Literal("read-all"), automationId: Schema.optional(Schema.String) }),
]);
export type AutomationAction = typeof AutomationAction.Type;
export class AutomationError extends Schema.TaggedError<AutomationError>()("AutomationError", {
  message: Schema.String,
}) {}
