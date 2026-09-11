import { AutomationError } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { AutomationService } from "../../../automations/AutomationService.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { requireMcpCapability } from "../../McpInvocationContext.ts";
import { AutomationsToolkit } from "./tools.ts";

const context = Effect.gen(function* () {
  const invocation = yield* requireMcpCapability("automations");
  const query = yield* ProjectionSnapshotQuery;
  const thread = yield* query
    .getThreadShellById(invocation.threadId)
    .pipe(
      Effect.mapError(() => new AutomationError({ message: "Could not load the current thread." })),
    );
  if (Option.isNone(thread))
    return yield* new AutomationError({ message: "Current thread not found." });
  const service = yield* AutomationService;
  const snapshot = yield* service.list;
  return {
    thread: thread.value,
    service,
    automations: snapshot.automations.filter(
      (item) => item.projectIds.length === 1 && item.projectIds[0] === thread.value.projectId,
    ),
  };
});
export const AutomationsToolkitHandlersLive = AutomationsToolkit.toLayer({
  list_automations: () => context.pipe(Effect.map((value) => value.automations)),
  save_automation: (input) =>
    Effect.gen(function* () {
      const { thread, service, automations } = yield* context;
      if (input.id && !automations.some((item) => item.id === input.id))
        return yield* new AutomationError({ message: "Automation not found in this project." });
      const prior = automations.find((item) => item.id === input.id);
      const crypto = yield* Crypto.Crypto;
      const id =
        input.id ??
        (yield* crypto.randomUUIDv4.pipe(
          Effect.mapError(
            () => new AutomationError({ message: "Could not generate automation id." }),
          ),
        ));
      const snapshot = yield* service.action({
        type: "save",
        automation: {
          id,
          name: input.name,
          prompt: input.prompt,
          projectIds: [thread.projectId],
          modelSelection: input.modelSelection ?? prior?.modelSelection ?? thread.modelSelection,
          runtimeMode: input.runtimeMode ?? prior?.runtimeMode ?? "full-access",
          executionMode: input.continueThread ? "local" : input.executionMode,
          threadId: input.continueThread ? thread.id : null,
          rrule: input.rrule,
          timezone: input.timezone,
          status: input.status,
        },
      });
      return snapshot.automations.find((item) => item.id === id)!;
    }),
  set_automation_status: (input) =>
    Effect.gen(function* () {
      const { service, automations } = yield* context;
      if (!automations.some((item) => item.id === input.id))
        return yield* new AutomationError({ message: "Automation not found in this project." });
      const snapshot = yield* service.action({
        type: input.status === "active" ? "resume" : "pause",
        id: input.id,
      });
      return snapshot.automations.find((item) => item.id === input.id)!;
    }),
  delete_automation: (input) =>
    Effect.gen(function* () {
      const { service, automations } = yield* context;
      if (!automations.some((item) => item.id === input.id))
        return yield* new AutomationError({ message: "Automation not found in this project." });
      yield* service.action({ type: "delete", id: input.id });
      return { id: input.id, deleted: true as const };
    }),
});
