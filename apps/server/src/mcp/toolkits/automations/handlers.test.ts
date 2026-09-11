import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type Automation,
  type AutomationAction,
  type OrchestrationThreadShell,
} from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { AutomationService } from "../../../automations/AutomationService.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { McpInvocationContext } from "../../McpInvocationContext.ts";
import { AutomationsToolkit } from "./tools.ts";
import { AutomationsToolkitHandlersLive } from "./handlers.ts";

const PROJECT_ID = ProjectId.make("project");
const THREAD_ID = ThreadId.make("thread");
function makeThread(): OrchestrationThreadShell {
  return {
    id: THREAD_ID,
    projectId: PROJECT_ID,
    title: "Thread",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    pullRequests: [],
    latestTurn: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    session: null,
    latestUserMessageAt: "2026-08-20T00:00:00.000Z",
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
  };
}

const automation: Automation = {
  id: "daily",
  name: "Daily review",
  prompt: "Review changes",
  projectIds: [PROJECT_ID],
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test-model" },
  runtimeMode: "approval-required",
  executionMode: "local",
  threadId: null,
  rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
  timezone: "UTC",
  status: "active",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  nextRunAt: "2026-01-02T09:00:00.000Z",
};
const makeHarness = Effect.fn(function* (
  projectIds: Automation["projectIds"] = [PROJECT_ID],
  allowed = true,
) {
  const actions: AutomationAction[] = [];
  const dependencies = Layer.mergeAll(
    Layer.succeed(
      Crypto.Crypto,
      Crypto.make({
        randomBytes: (size) => new Uint8Array(size),
        digest: (_algorithm, data) => Effect.succeed(data),
      }),
    ),
    Layer.mock(ProjectionSnapshotQuery)({
      getThreadShellById: () => Effect.succeedSome(makeThread()),
    }),
    Layer.succeed(AutomationService, {
      list: Effect.succeed({ automations: [{ ...automation, projectIds }], runs: [] }),
      runDue: Effect.void,
      action: (action) =>
        Effect.sync(() => {
          actions.push(action);
          return {
            automations: action.type === "save" ? [{ ...automation, ...action.automation }] : [],
            runs: [],
          };
        }),
    }),
  );
  const toolkit = yield* AutomationsToolkit.pipe(
    Effect.provide(AutomationsToolkitHandlersLive.pipe(Layer.provide(dependencies))),
  );
  const invoke = <Name extends keyof typeof AutomationsToolkit.tools>(
    name: Name,
    params: Parameters<typeof toolkit.handle<Name>>[1],
  ) =>
    toolkit.handle(name, params).pipe(
      Stream.unwrap,
      Stream.runCollect,
      Effect.map((results) => results.at(-1)!.result),
      Effect.provideService(McpInvocationContext, {
        environmentId: EnvironmentId.make("environment"),
        threadId: THREAD_ID,
        providerSessionId: "session",
        providerInstanceId: ProviderInstanceId.make("codex"),
        capabilities: new Set<"automations">(allowed ? ["automations"] : []),
        issuedAt: 1,
      }),
      Effect.provide(dependencies),
    );
  return {
    call: (id = automation.id) => invoke("delete_automation", { id }),
    save: (params: Parameters<typeof toolkit.handle<"save_automation">>[1]) =>
      invoke("save_automation", params),
    actions,
  };
});
it.effect(
  "deletes an automation owned by the current project through the normal service action",
  () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      expect(yield* harness.call()).toEqual({ id: "daily", deleted: true });
      expect(harness.actions).toEqual([{ type: "delete", id: "daily" }]);
    }),
);
it.effect("refuses unknown, other-project and multi-project automations", () =>
  Effect.gen(function* () {
    for (const ids of [[ProjectId.make("other")], [PROJECT_ID, ProjectId.make("other")]]) {
      const harness = yield* makeHarness(ids);
      expect(yield* harness.call().pipe(Effect.flip)).toMatchObject({
        _tag: "AutomationError",
        message: "Automation not found in this project.",
      });
      expect(harness.actions).toEqual([]);
    }
    const harness = yield* makeHarness();
    expect(yield* harness.call("missing").pipe(Effect.flip)).toMatchObject({
      _tag: "AutomationError",
    });
    expect(harness.actions).toEqual([]);
  }),
);
it.effect("requires the automations capability before deleting", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness([PROJECT_ID], false);
    expect(yield* harness.call().pipe(Effect.flip)).toMatchObject({
      _tag: "McpCapabilityUnavailableError",
      capability: "automations",
    });
    expect(harness.actions).toEqual([]);
  }),
);

const saveInput = {
  name: "Scheduled review",
  prompt: "Review changes",
  rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
  timezone: "UTC",
  status: "paused" as const,
  executionMode: "local" as const,
  continueThread: false,
};
it.effect("agent saves accept explicit model, reasoning options and permissions", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness();
    const modelSelection = {
      instanceId: ProviderInstanceId.make("codex"),
      model: "chosen-model",
      options: [{ id: "reasoningEffort", value: "high" }],
    };
    yield* harness.save({ ...saveInput, modelSelection, runtimeMode: "auto-accept-edits" });
    expect(harness.actions[0]).toMatchObject({
      type: "save",
      automation: { modelSelection, runtimeMode: "auto-accept-edits" },
    });
  }),
);
it.effect(
  "agent creates inherit thread settings and edits preserve saved settings when omitted",
  () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* harness.save(saveInput);
      expect(harness.actions[0]).toMatchObject({
        automation: {
          modelSelection: makeThread().modelSelection,
          runtimeMode: makeThread().runtimeMode,
        },
      });
      yield* harness.save({ ...saveInput, id: automation.id });
      expect(harness.actions[1]).toMatchObject({
        automation: {
          modelSelection: automation.modelSelection,
          runtimeMode: automation.runtimeMode,
        },
      });
    }),
);
