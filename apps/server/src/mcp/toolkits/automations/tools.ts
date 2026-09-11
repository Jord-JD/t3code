import * as Crypto from "effect/Crypto";
import {
  Automation,
  AutomationError,
  AutomationInput,
  McpCapabilityUnavailableError,
  ProviderInstanceId,
  ProviderOptionSelections,
  RuntimeMode,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/unstable/ai";
import { AutomationService } from "../../../automations/AutomationService.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { McpInvocationContext } from "../../McpInvocationContext.ts";

const dependencies = [
  Crypto.Crypto,
  AutomationService,
  ProjectionSnapshotQuery,
  McpInvocationContext,
];
const failure = Schema.Union([AutomationError, McpCapabilityUnavailableError]);
export const AutomationsToolkit = Toolkit.make(
  Tool.make("list_automations", {
    description:
      "List automations for this thread's project. Use their ids to update, pause, resume or delete a schedule.",
    success: Schema.Array(Automation),
    failure,
    dependencies,
  }).annotate(Tool.Readonly, true),
  Tool.make("save_automation", {
    description:
      "Create or update a recurring automation for this project only when the user asks to schedule work. Optionally set modelSelection (provider instance, model and options such as reasoning effort) and runtimeMode (permissions). On creation, an omitted model inherits from the current thread and omitted permissions default to full-access. Omitted settings remain unchanged on updates. Supply a stable id for updates, an IANA timezone and an RFC 5545 RRULE. Set continueThread to return to this conversation; otherwise each run creates a new thread. Skills may be referenced in the prompt.",
    parameters: Schema.Struct({
      id: Schema.optional(Schema.String),
      name: AutomationInput.fields.name,
      prompt: AutomationInput.fields.prompt,
      rrule: AutomationInput.fields.rrule,
      timezone: AutomationInput.fields.timezone,
      status: AutomationInput.fields.status,
      executionMode: AutomationInput.fields.executionMode,
      continueThread: Schema.Boolean,
      modelSelection: Schema.optional(
        Schema.Struct({
          instanceId: ProviderInstanceId,
          model: Schema.String,
          options: Schema.optionalKey(ProviderOptionSelections),
        }),
      ),
      runtimeMode: Schema.optional(RuntimeMode),
    }),
    success: Automation,
    failure,
    dependencies,
  })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
  Tool.make("set_automation_status", {
    description:
      "Pause or resume a saved automation in this thread's project when requested by the user.",
    parameters: Schema.Struct({ id: Schema.String, status: AutomationInput.fields.status }),
    success: Automation,
    failure,
    dependencies,
  })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Idempotent, true),
  Tool.make("delete_automation", {
    description:
      "Delete a saved automation in this thread's project when requested by the user. This removes its schedule and preserves existing run history, conversations and worktrees. Use list_automations to find its id. To temporarily stop runs, use set_automation_status instead.",
    parameters: Schema.Struct({ id: AutomationInput.fields.id }),
    success: Schema.Struct({ id: Schema.String, deleted: Schema.Literal(true) }),
    failure,
    dependencies,
  })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, true),
);
