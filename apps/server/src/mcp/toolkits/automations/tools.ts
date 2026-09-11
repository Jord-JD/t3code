import * as Crypto from "effect/Crypto";
import {
  Automation,
  AutomationError,
  AutomationInput,
  McpCapabilityUnavailableError,
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
      "List automations for this thread's project. Use their ids to update, pause or resume a schedule.",
    success: Schema.Array(Automation),
    failure,
    dependencies,
  }).annotate(Tool.Readonly, true),
  Tool.make("save_automation", {
    description:
      "Create or update a recurring automation for this project only when the user asks to schedule work. Use the current thread's model and permissions. Supply a stable id for updates, an IANA timezone and an RFC 5545 RRULE. Set continueThread to return to this conversation; otherwise each run creates a new thread. Skills may be referenced in the prompt.",
    parameters: Schema.Struct({
      id: Schema.optional(Schema.String),
      name: AutomationInput.fields.name,
      prompt: AutomationInput.fields.prompt,
      rrule: AutomationInput.fields.rrule,
      timezone: AutomationInput.fields.timezone,
      status: AutomationInput.fields.status,
      executionMode: AutomationInput.fields.executionMode,
      continueThread: Schema.Boolean,
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
);
