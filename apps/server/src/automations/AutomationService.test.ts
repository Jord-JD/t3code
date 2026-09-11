import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  OrchestrationEvent,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ProviderDriverKind,
  ThreadId,
  type OrchestrationThreadShell,
  type ServerProvider,
  type AutomationInput,
  type OrchestrationCommand,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { TestClock } from "effect/testing";
import { GitWorkflowService } from "../git/GitWorkflowService.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { ProviderRegistry } from "../provider/Services/ProviderRegistry.ts";
import { AutomationService } from "./AutomationService.ts";
import { makeAutomationStore } from "./AutomationStore.ts";

const decodeEvent = Schema.decodeUnknownEffect(OrchestrationEvent);

const input: AutomationInput = {
  id: "daily",
  name: "Daily review",
  prompt: "Review recent changes",
  projectIds: [ProjectId.make("project")],
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test-model" },
  runtimeMode: "approval-required",
  executionMode: "local",
  threadId: null,
  rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
  timezone: "UTC",
  status: "active",
};
function dependencies(commands: OrchestrationCommand[], missingProject = false) {
  return Layer.mergeAll(
    Layer.mock(ProviderRegistry)({ getProviders: Effect.succeed([]) }),
    Layer.mock(OrchestrationEngineService)({
      subscribeDomainEvents: Effect.succeed(Stream.empty),
      dispatch: (command) =>
        Effect.sync(() => {
          commands.push(command);
          return { sequence: commands.length };
        }),
    }),
    Layer.mock(ProjectionSnapshotQuery)({
      getProjectShellById: (id) =>
        Effect.succeed(
          missingProject
            ? Option.none()
            : Option.some({
                id,
                title: "Project",
                workspaceRoot: "/test-project",
                defaultModelSelection: null,
                scripts: [],
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
              }),
        ),
    }),
    Layer.mock(GitWorkflowService)({}),
  );
}
const provide = (commands: OrchestrationCommand[], missingProject = false) =>
  AutomationService.layerWithOptions({ startScheduler: false }).pipe(
    Layer.provide(dependencies(commands, missingProject)),
    Layer.provideMerge(SqlitePersistenceMemory),
    Layer.provide(NodeServices.layer),
  );

it.effect(
  "manual runs create independent threads using the saved prompt, model and permissions",
  () => {
    const commands: OrchestrationCommand[] = [];
    return Effect.gen(function* () {
      const service = yield* AutomationService;
      yield* service.action({ type: "save", automation: input });
      const before = yield* service.list;
      yield* service.action({ type: "run", id: input.id });
      yield* service.runDue;
      const result = yield* service.list;
      assert.deepEqual(
        commands.map((command) => command.type),
        ["thread.create", "thread.turn.start"],
      );
      assert.equal(result.runs[0]?.status, "running");
      assert.equal(result.automations[0]?.nextRunAt, before.automations[0]?.nextRunAt);
      const turn = commands[1];
      assert.equal(turn?.type, "thread.turn.start");
      if (turn?.type === "thread.turn.start") {
        assert.equal(turn.runtimeMode, input.runtimeMode);
        assert.deepEqual(turn.modelSelection, input.modelSelection);
        assert.include(turn.message.text, input.prompt);
      }
      const overlap = yield* service.action({ type: "run", id: input.id }).pipe(Effect.flip);
      assert.include(overlap.message, "already has a run");
    }).pipe(Effect.provide(provide(commands)));
  },
);

it.effect("coalesces missed schedules into one run and advances the next occurrence", () => {
  const commands: OrchestrationCommand[] = [];
  return Effect.gen(function* () {
    const service = yield* AutomationService;
    yield* service.action({ type: "save", automation: input });
    yield* TestClock.adjust("3 days");
    yield* service.runDue;
    const result = yield* service.list;
    assert.equal(result.runs.length, 1);
    assert.equal(result.automations[0]?.nextRunAt, "1970-01-04T09:00:00.000Z");
    yield* service.runDue;
    assert.equal(commands.length, 2);
  }).pipe(Effect.provide(provide(commands)));
});

it.effect("paused schedules do not run, but allow an explicit test run", () => {
  const commands: OrchestrationCommand[] = [];
  return Effect.gen(function* () {
    const service = yield* AutomationService;
    yield* service.action({ type: "save", automation: input });
    yield* service.action({ type: "pause", id: input.id });
    yield* TestClock.adjust("2 days");
    yield* service.runDue;
    assert.equal(commands.length, 0);
    yield* service.action({ type: "run", id: input.id });
    yield* service.runDue;
    assert.equal(commands.length, 2);
    yield* service.action({ type: "resume", id: input.id });
    assert.equal((yield* service.list).automations[0]?.nextRunAt, "1970-01-03T09:00:00.000Z");
  }).pipe(Effect.provide(provide(commands)));
});

it.effect("a project removed before execution produces a reviewable failure", () => {
  const commands: OrchestrationCommand[] = [];
  return Effect.gen(function* () {
    const store = yield* makeAutomationStore;
    yield* store.save({
      ...input,
      createdAt: "1970-01-01T00:00:00.000Z",
      updatedAt: "1970-01-01T00:00:00.000Z",
      nextRunAt: "1970-01-01T00:00:00.000Z",
    });
    const service = yield* AutomationService;
    yield* service.runDue;
    const result = yield* service.list;
    assert.equal(result.runs[0]?.status, "failed");
    assert.include(result.runs[0]?.error ?? "", "no longer available");
    assert.equal(commands.length, 0);
  }).pipe(Effect.provide(provide(commands, true)));
});

it.effect("isolates Git runs in a worktree and leaves non-Git projects local", () =>
  Effect.gen(function* () {
    for (const isRepo of [true, false]) {
      const commands: OrchestrationCommand[] = [];
      const worktrees: string[] = [];
      const git = Layer.mock(GitWorkflowService)({
        localStatus: () =>
          Effect.succeed({
            isRepo,
            hasPrimaryRemote: false,
            isDefaultRef: true,
            refName: "main",
            hasWorkingTreeChanges: false,
            workingTree: { files: [], insertions: 0, deletions: 0 },
          }),
        createWorktree: (request) =>
          Effect.sync(() => {
            worktrees.push(request.cwd);
            return { worktree: { path: "/isolated-run", refName: request.newRefName ?? "test" } };
          }),
      });
      yield* Effect.gen(function* () {
        const service = yield* AutomationService;
        yield* service.action({
          type: "save",
          automation: { ...input, executionMode: "worktree" },
        });
        yield* service.action({ type: "run", id: input.id });
        yield* service.runDue;
        assert.equal(worktrees.length, isRepo ? 1 : 0);
        const create = commands[0];
        assert.equal(create?.type, "thread.create");
        if (create?.type === "thread.create")
          assert.equal(create.worktreePath, isRepo ? "/isolated-run" : null);
      }).pipe(
        Effect.provide(
          AutomationService.layerWithOptions({ startScheduler: false }).pipe(
            Layer.provide(Layer.merge(dependencies(commands), git)),
            Layer.provide(SqlitePersistenceMemory),
            Layer.provide(NodeServices.layer),
          ),
        ),
      );
    }
  }),
);

it.effect("archives no-findings results using the completed message projection", () =>
  Effect.gen(function* () {
    const event = yield* Deferred.make<OrchestrationEvent>();
    const drained = yield* Deferred.make<void>();
    const commands: OrchestrationCommand[] = [];
    const events = Stream.concat(
      Stream.fromEffect(Deferred.await(event)),
      Stream.fromEffect(Deferred.succeed(drained, undefined)).pipe(Stream.drain),
    );
    const layer = AutomationService.layerWithOptions({ startScheduler: false }).pipe(
      Layer.provide(
        Layer.mergeAll(
          dependencies(commands),
          Layer.mock(OrchestrationEngineService)({
            subscribeDomainEvents: Effect.succeed(events),
            dispatch: (command) =>
              Effect.sync(() => {
                commands.push(command);
                return { sequence: commands.length };
              }),
          }),
          Layer.mock(ProjectionSnapshotQuery)({
            getProjectShellById: () =>
              Effect.succeedSome({
                id: input.projectIds[0]!,
                title: "Project",
                workspaceRoot: "/test",
                defaultModelSelection: null,
                scripts: [],
                createdAt: "1970-01-01T00:00:00.000Z",
                updatedAt: "1970-01-01T00:00:00.000Z",
              }),
            getTurnStartMessage: () =>
              Effect.succeedSome({
                hasOtherUserMessages: false,
                message: {
                  id: MessageId.make("reply"),
                  role: "assistant",
                  text: "AUTOMATION_NO_FINDINGS",
                  turnId: null,
                  streaming: false,
                  createdAt: "1970-01-01T00:00:00.000Z",
                  updatedAt: "1970-01-01T00:00:00.000Z",
                },
              }),
          }),
        ),
      ),
      Layer.provide(SqlitePersistenceMemory),
      Layer.provide(NodeServices.layer),
    );
    yield* Effect.gen(function* () {
      const service = yield* AutomationService;
      yield* service.action({ type: "save", automation: input });
      yield* service.action({ type: "run", id: input.id });
      yield* service.runDue;
      const run = (yield* service.list).runs[0]!;
      yield* Deferred.succeed(
        event,
        yield* decodeEvent({
          type: "thread.turn-diff-completed",
          sequence: 1,
          eventId: "completed",
          aggregateKind: "thread",
          aggregateId: run.threadId,
          occurredAt: "1970-01-01T00:00:00.000Z",
          commandId: null,
          causationEventId: null,
          correlationId: null,
          metadata: {},
          payload: {
            threadId: run.threadId,
            turnId: "turn",
            checkpointTurnCount: 1,
            checkpointRef: "refs/test",
            status: "ready",
            files: [],
            assistantMessageId: "reply",
            completedAt: "1970-01-01T00:00:00.000Z",
          },
        }),
      );
      yield* Deferred.await(drained);
      const completed = (yield* service.list).runs[0]!;
      assert.equal(completed.status, "completed");
      assert.isTrue(completed.archived);
      assert.isTrue(completed.read);
    }).pipe(Effect.provide(layer));
  }),
);

const timestamp = "2026-01-01T00:00:00.000Z";
const threadId = ThreadId.make("existing-thread");
const thread: OrchestrationThreadShell = {
  id: threadId,
  projectId: input.projectIds[0]!,
  title: "Existing conversation",
  modelSelection: input.modelSelection,
  runtimeMode: "approval-required",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  pullRequests: [],
  latestTurn: null,
  createdAt: timestamp,
  updatedAt: timestamp,
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  session: {
    threadId,
    status: "ready",
    providerName: "codex",
    providerInstanceId: input.modelSelection.instanceId,
    runtimeMode: "approval-required",
    activeTurnId: null,
    lastError: null,
    updatedAt: timestamp,
  },
  latestUserMessageAt: timestamp,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
};
const provider: ServerProvider = {
  instanceId: input.modelSelection.instanceId,
  driver: ProviderDriverKind.make("codex"),
  continuation: { groupKey: "shared-home" },
  enabled: true,
  installed: true,
  version: null,
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: timestamp,
  models: [],
  slashCommands: [],
  skills: [],
};
const otherInstance = ProviderInstanceId.make("other");
const otherModel = { instanceId: otherInstance, model: "other-model" };

for (const updating of [false, true]) {
  for (const scenario of [
    {
      name: "another driver",
      next: otherModel,
      other: { driver: ProviderDriverKind.make("claudeAgent") },
      error: "different provider",
    },
    {
      name: "incompatible resume state",
      next: otherModel,
      other: { continuation: { groupKey: "other-home" } },
      error: "incompatible provider instance",
    },
    {
      name: "a provider that requires a new thread",
      next: { ...input.modelSelection, model: "other-model" },
      current: { requiresNewThreadForModelChange: true },
      error: "does not allow switching models",
    },
    {
      name: "a destination that requires a new thread",
      next: otherModel,
      other: { requiresNewThreadForModelChange: true },
      error: "does not allow switching models",
    },
    { name: "compatible instances", next: otherModel },
    {
      name: "another model on the same provider",
      next: { ...input.modelSelection, model: "other-model" },
    },
    {
      name: "model options on a locked model",
      next: { ...input.modelSelection, options: [{ id: "reasoningEffort", value: "high" }] },
      current: { requiresNewThreadForModelChange: true },
    },
    {
      name: "a new thread for each run",
      next: otherModel,
      newThread: true,
      other: { driver: ProviderDriverKind.make("claudeAgent") },
    },
    {
      name: "an unstarted thread",
      next: otherModel,
      unstarted: true,
      other: { driver: ProviderDriverKind.make("claudeAgent") },
    },
    {
      name: "imported history switching drivers",
      next: otherModel,
      imported: true,
      other: { driver: ProviderDriverKind.make("claudeAgent") },
      error: "different provider",
    },
    {
      name: "a missing thread",
      next: input.modelSelection,
      missing: true,
      error: "no longer available",
    },
    {
      name: "a thread in another project",
      next: input.modelSelection,
      wrongProject: true,
      error: "no longer available",
    },
    {
      name: "a session instance different from the saved selection",
      next: input.modelSelection,
      sessionInstance: otherInstance,
      other: { continuation: { groupKey: "other-home" } },
      error: "incompatible provider instance",
    },
  ]) {
    it.effect(`${updating ? "updates" : "creation"} validate ${scenario.name}`, () =>
      Effect.gen(function* () {
        const service = yield* AutomationService;
        if (updating) yield* service.action({ type: "save", automation: input });
        const candidate = {
          ...input,
          threadId: scenario.newThread ? null : threadId,
          modelSelection: scenario.next,
        };
        if (scenario.error) {
          const error = yield* service
            .action({ type: "save", automation: candidate })
            .pipe(Effect.flip);
          assert.include(error.message, scenario.error);
          assert.deepEqual(
            (yield* service.list).automations.map((item) => item.modelSelection),
            updating ? [input.modelSelection] : [],
          );
        } else {
          const result = yield* service.action({ type: "save", automation: candidate });
          assert.deepEqual(result.automations[0]?.modelSelection, scenario.next);
        }
      }).pipe(
        Effect.provide(
          AutomationService.layerWithOptions({ startScheduler: false }).pipe(
            Layer.provide(
              Layer.mergeAll(
                dependencies([]),
                Layer.mock(ProviderRegistry)({
                  getProviders: Effect.succeed([
                    { ...provider, ...scenario.current },
                    { ...provider, instanceId: otherInstance, ...scenario.other },
                  ]),
                }),
                Layer.mock(ProjectionSnapshotQuery)({
                  getProjectShellById: (id) =>
                    Effect.succeedSome({
                      id,
                      title: "Project",
                      workspaceRoot: "/test",
                      defaultModelSelection: null,
                      scripts: [],
                      createdAt: timestamp,
                      updatedAt: timestamp,
                    }),
                  getThreadShellById: () =>
                    Effect.succeed(
                      scenario.missing
                        ? Option.none()
                        : Option.some({
                            ...thread,
                            projectId: scenario.wrongProject
                              ? ProjectId.make("other-project")
                              : thread.projectId,
                            session:
                              scenario.unstarted || scenario.imported
                                ? null
                                : {
                                    ...thread.session!,
                                    providerInstanceId:
                                      scenario.sessionInstance ?? provider.instanceId,
                                  },
                            latestUserMessageAt: scenario.unstarted ? null : timestamp,
                          }),
                    ),
                }),
              ),
            ),
            Layer.provide(SqlitePersistenceMemory),
            Layer.provide(NodeServices.layer),
          ),
        ),
      ),
    );
  }
}
