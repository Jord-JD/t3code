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
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { McpSchema, McpServer } from "effect/unstable/ai";
import { AutomationService } from "../../../automations/AutomationService.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { McpInvocationContext } from "../../McpInvocationContext.ts";
import { AutomationsToolkit } from "./tools.ts";
import { AutomationsToolkitHandlersLive } from "./handlers.ts";

const PROJECT_ID = ProjectId.make("project");
const THREAD_ID = ThreadId.make("thread");
const decodeMcpObject = Schema.decodeUnknownEffect(Schema.JsonObject);
const encodeMcpObject = Schema.encodeEffect(Schema.fromJsonString(Schema.JsonObject));
const client = McpSchema.McpServerClient.of({
  clientId: 1,
  clientCapabilities: {},
  clientInfo: { name: "automation-test", version: "1.0.0" },
  protocolVersion: "2025-06-18",
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "automation-test", version: "1.0.0" },
  },
  getClient: Effect.die("unused"),
});
function makeThread(): OrchestrationThreadShell {
  return {
    id: THREAD_ID,
    projectId: PROJECT_ID,
    title: "Thread",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
    runtimeMode: "approval-required",
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
            automations:
              action.type === "save"
                ? [{ ...automation, ...action.automation }]
                : action.type === "pause" || action.type === "resume"
                  ? [{ ...automation, status: action.type === "pause" ? "paused" : "active" }]
                  : [],
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
    mcp: (name: keyof typeof AutomationsToolkit.tools, args: Record<string, unknown> = {}) =>
      Effect.gen(function* () {
        const server = yield* McpServer.McpServer;
        const tool = server.tools.find((entry) => entry.tool.name === name);
        expect(tool?.tool.outputSchema).toMatchObject({ type: "object" });
        const result = yield* server.callTool({ name, arguments: args });
        if (result.isError) {
          expect(result.structuredContent).toBeUndefined();
          expect(result.content).toEqual([{ type: "text", text: expect.any(String) }]);
        } else {
          const structured = yield* decodeMcpObject(result.structuredContent);
          expect(result.content).toEqual([
            {
              type: "text",
              text: yield* encodeMcpObject(structured),
            },
          ]);
        }
        return result;
      }).pipe(
        Effect.provide(
          McpServer.toolkit(AutomationsToolkit).pipe(
            Layer.provide(AutomationsToolkitHandlersLive),
            Layer.provideMerge(McpServer.McpServer.layer),
            Layer.provide(dependencies),
          ),
        ),
        Effect.provideService(McpSchema.McpServerClient, client),
        Effect.provideService(McpInvocationContext, {
          environmentId: EnvironmentId.make("environment"),
          threadId: THREAD_ID,
          providerSessionId: "session",
          providerInstanceId: ProviderInstanceId.make("codex"),
          capabilities: new Set<"automations">(allowed ? ["automations"] : []),
          issuedAt: 1,
        }),
      ),
    call: (id = automation.id) => invoke("delete_automation", { id }),
    save: (params: Parameters<typeof toolkit.handle<"save_automation">>[1]) =>
      invoke("save_automation", params),
    actions,
  };
});
it.effect("lists project automations as an MCP object, including empty results", () =>
  Effect.gen(function* () {
    for (const projectIds of [[PROJECT_ID], [ProjectId.make("other")]]) {
      const harness = yield* makeHarness(projectIds);
      const result = yield* harness.mcp("list_automations");
      const expected = { automations: projectIds[0] === PROJECT_ID ? [automation] : [] };
      expect(result.isError).toBe(false);
      expect(result.structuredContent).toEqual(expected);
      expect(harness.actions).toEqual([]);
    }
  }).pipe(Effect.scoped),
);
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
it.effect("serializes successful save, pause, resume and delete MCP responses", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness();
    const saved = yield* harness.mcp("save_automation", saveInput);
    expect(saved.isError).toBe(false);
    expect(saved.structuredContent).toMatchObject({ name: saveInput.name, status: "paused" });
    for (const status of ["paused", "active"]) {
      const result = yield* harness.mcp("set_automation_status", { id: automation.id, status });
      expect(result.isError).toBe(false);
      expect(result.structuredContent).toMatchObject({ id: automation.id, status });
    }
    const deleted = yield* harness.mcp("delete_automation", { id: automation.id });
    expect(deleted.isError).toBe(false);
    expect(deleted.structuredContent).toEqual({ id: automation.id, deleted: true });
  }).pipe(Effect.scoped),
);

it.effect("serializes capability failures for every automation MCP tool", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness([PROJECT_ID], false);
    const calls = [
      ["list_automations", {}],
      ["save_automation", saveInput],
      ["set_automation_status", { id: automation.id, status: "paused" }],
      ["delete_automation", { id: automation.id }],
    ] as const;
    for (const [name, args] of calls) {
      const result = yield* harness.mcp(name, args);
      expect(result.isError).toBe(true);
      expect(result.content).toEqual([
        { type: "text", text: expect.stringContaining("automations") },
      ]);
    }
    expect(harness.actions).toEqual([]);
  }).pipe(Effect.scoped),
);

it.effect("serializes missing-automation errors for all mutation tools", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness();
    const calls = [
      ["save_automation", { ...saveInput, id: "missing" }],
      ["set_automation_status", { id: "missing", status: "paused" }],
      ["delete_automation", { id: "missing" }],
    ] as const;
    for (const [name, args] of calls) {
      const result = yield* harness.mcp(name, args);
      expect(result.isError).toBe(true);
      expect(result.content).toEqual([
        { type: "text", text: "Automation not found in this project." },
      ]);
    }
    expect(harness.actions).toEqual([]);
  }).pipe(Effect.scoped),
);
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
  "agent creates inherit the model and default to full access; edits preserve saved settings",
  () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* harness.save(saveInput);
      expect(harness.actions[0]).toMatchObject({
        automation: {
          modelSelection: makeThread().modelSelection,
          runtimeMode: "full-access",
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
