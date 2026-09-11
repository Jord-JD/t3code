import * as Deferred from "effect/Deferred";
import {
  AutomationError,
  CommandId,
  MessageId,
  ThreadId,
  type Automation,
  type AutomationAction,
  type AutomationRun,
  type AutomationSnapshot,
} from "@t3tools/contracts";
import { nextAutomationRun } from "@t3tools/shared/automationSchedule";
import * as DateTime from "effect/DateTime";
import * as Crypto from "effect/Crypto";
import * as Schema from "effect/Schema";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import { GitWorkflowService } from "../git/GitWorkflowService.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { forkParked } from "../serverActivation.ts";
import { makeAutomationStore } from "./AutomationStore.ts";

const isAutomationError = Schema.is(AutomationError);
const failure = (cause: unknown) =>
  isAutomationError(cause)
    ? cause
    : new AutomationError({ message: cause instanceof Error ? cause.message : String(cause) });

export class AutomationService extends Context.Service<
  AutomationService,
  {
    readonly list: Effect.Effect<AutomationSnapshot, AutomationError>;
    readonly runDue: Effect.Effect<void, AutomationError>;
    readonly action: (
      action: AutomationAction,
    ) => Effect.Effect<AutomationSnapshot, AutomationError>;
  }
>()("t3/automations/AutomationService") {
  static layerWithOptions(options: { readonly startScheduler?: boolean } = {}) {
    return Layer.effect(
      AutomationService,
      Effect.gen(function* () {
        const store = yield* makeAutomationStore;
        const cryptoService = yield* Crypto.Crypto;
        const engine = yield* OrchestrationEngineService;
        const query = yield* ProjectionSnapshotQuery;
        const git = yield* GitWorkflowService;
        const mutex = yield* Semaphore.make(1);
        const ready = yield* Deferred.make<void, AutomationError>();
        if (options.startScheduler === false) yield* Deferred.succeed(ready, undefined);
        const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));
        const next = (automation: Automation, timestamp: string) =>
          Effect.try({
            try: () =>
              nextAutomationRun(
                automation.rrule,
                automation.timezone,
                DateTime.toDateUtc(DateTime.makeUnsafe(automation.createdAt)),
                DateTime.toDateUtc(DateTime.makeUnsafe(timestamp)),
              ),
            catch: failure,
          });

        const launch = Effect.fn("AutomationService.launch")(function* (
          automation: Automation,
          run: AutomationRun,
        ) {
          const timestamp = yield* now;
          const project = yield* query.getProjectShellById(run.projectId);
          if (Option.isNone(project)) {
            return yield* new AutomationError({
              message: "The automation project is no longer available.",
            });
          }
          if (automation.threadId) {
            const thread = yield* query.getThreadShellById(automation.threadId);
            if (Option.isNone(thread) || thread.value.projectId !== run.projectId) {
              return yield* new AutomationError({
                message: "The selected thread is no longer available in this project.",
              });
            }
            if (
              thread.value.session?.status === "running" ||
              thread.value.session?.status === "starting"
            ) {
              return yield* new AutomationError({
                message: "The selected thread is busy. Try again after its current turn finishes.",
              });
            }
          } else {
            let branch: string | null = null;
            let worktreePath: string | null = null;
            // Non-Git projects run locally. Git failures never fall back to modifying the checkout.
            if (
              automation.executionMode === "worktree" &&
              (yield* git.localStatus({ cwd: project.value.workspaceRoot })).isRepo
            ) {
              const worktree = yield* git.createWorktree({
                cwd: project.value.workspaceRoot,
                refName: "HEAD",
                newRefName: `automation/${run.id}`,
                path: null,
              });
              branch = worktree.worktree.refName;
              worktreePath = worktree.worktree.path;
            }
            yield* engine.dispatch({
              type: "thread.create",
              commandId: CommandId.make(`automation-create-${run.id}`),
              threadId: run.threadId,
              projectId: run.projectId,
              title: automation.name,
              modelSelection: automation.modelSelection,
              runtimeMode: automation.runtimeMode,
              interactionMode: "default",
              branch,
              worktreePath,
              createdAt: timestamp,
            });
          }
          yield* store.saveRun({ ...run, status: "running" });
          yield* engine.dispatch({
            type: "thread.turn.start",
            commandId: CommandId.make(`automation-turn-${run.id}`),
            threadId: run.threadId,
            modelSelection: automation.modelSelection,
            runtimeMode: automation.runtimeMode,
            interactionMode: "default",
            createdAt: timestamp,
            message: {
              messageId: MessageId.make(`automation-message-${run.id}`),
              role: "user",
              attachments: [],
              text: `${automation.prompt}\n\nThis is a scheduled automation. Report actionable findings. If there is nothing to report, reply with exactly AUTOMATION_NO_FINDINGS.`,
            },
          });
        });

        const claim = Effect.fn("AutomationService.claim")(function* (
          automation: Automation,
          scheduled: boolean,
        ) {
          const timestamp = yield* now;
          const active = yield* store.activeRuns();
          if (active.some((run) => run.automationId === automation.id)) {
            if (!scheduled)
              return yield* new AutomationError({
                message: "This automation already has a run in progress.",
              });
            yield* store.save({ ...automation, nextRunAt: yield* next(automation, timestamp) });
            return;
          }
          yield* store.transaction(
            Effect.gen(function* () {
              for (const projectId of new Set(automation.projectIds)) {
                const id = yield* cryptoService.randomUUIDv4;
                yield* store.saveRun({
                  id,
                  automationId: automation.id,
                  automationName: automation.name,
                  projectId,
                  threadId: automation.threadId ?? ThreadId.make(`automation-${id}`),
                  status: "queued",
                  startedAt: timestamp,
                  completedAt: null,
                  error: null,
                  read: false,
                  archived: false,
                });
              }
              if (scheduled)
                yield* store.save({ ...automation, nextRunAt: yield* next(automation, timestamp) });
            }),
          );
        });

        const action = Effect.fn("AutomationService.action")(function* (input: AutomationAction) {
          yield* Deferred.await(ready);
          yield* mutex.withPermits(1)(
            Effect.gen(function* () {
              const snapshot = yield* store.list();
              const timestamp = yield* now;
              if (input.type === "save") {
                const prior = snapshot.automations.find((item) => item.id === input.automation.id);
                if (
                  input.automation.threadId &&
                  (input.automation.projectIds.length !== 1 ||
                    input.automation.executionMode !== "local")
                ) {
                  return yield* new AutomationError({
                    message: "An existing thread needs exactly one project and local execution.",
                  });
                }
                for (const id of input.automation.projectIds) {
                  const project = yield* query.getProjectShellById(id);
                  if (Option.isNone(project))
                    return yield* new AutomationError({ message: "Choose an available project." });
                }
                const automation: Automation = {
                  ...input.automation,
                  projectIds: [...new Set(input.automation.projectIds)],
                  createdAt: prior?.createdAt ?? timestamp,
                  updatedAt: timestamp,
                  nextRunAt: null,
                };
                const nextRunAt = yield* next(automation, timestamp);
                yield* store.save({
                  ...automation,
                  nextRunAt: automation.status === "active" ? nextRunAt : null,
                });
              } else if (input.type === "review") {
                const run = snapshot.runs.find((item) => item.id === input.id);
                if (!run) return yield* new AutomationError({ message: "Run not found." });
                yield* store.saveRun({ ...run, read: input.read, archived: input.archived });
              } else if (input.type === "read-all") {
                yield* store.transaction(
                  Effect.forEach(
                    snapshot.runs.filter((run) => !run.read),
                    (run) => store.saveRun({ ...run, read: true }),
                    { discard: true },
                  ),
                );
              } else {
                const automation = snapshot.automations.find((item) => item.id === input.id);
                if (!automation)
                  return yield* new AutomationError({ message: "Automation not found." });
                if (input.type === "run") yield* claim(automation, false);
                else if (input.type === "delete") yield* store.remove(input.id, timestamp);
                else {
                  const status = input.type === "pause" ? "paused" : "active";
                  yield* store.save({
                    ...automation,
                    status,
                    updatedAt: timestamp,
                    nextRunAt: status === "paused" ? null : yield* next(automation, timestamp),
                  });
                }
              }
            }),
          );
          return yield* store.list();
        }, Effect.mapError(failure));

        const tick = Effect.gen(function* () {
          // Claims are persisted before execution, and every mutation shares this lock.
          yield* mutex.withPermits(1)(
            Effect.gen(function* () {
              const automations = yield* store.listAutomations();
              const timestamp = yield* now;
              for (const automation of automations) {
                if (
                  automation.status === "active" &&
                  automation.nextRunAt &&
                  automation.nextRunAt <= timestamp
                ) {
                  yield* claim(automation, true);
                }
              }
            }),
          );
          const runs = yield* store.activeRuns();
          const automations = yield* store.listAutomations();
          for (const run of runs.filter((item) => item.status === "queued")) {
            const automation = automations.find((item) => item.id === run.automationId);
            const task = automation
              ? launch(automation, run)
              : Effect.fail(
                  new AutomationError({
                    message: "Automation was deleted before this run started.",
                  }),
                );
            yield* task.pipe(
              Effect.catch((cause) =>
                now.pipe(
                  Effect.flatMap((timestamp) =>
                    store.saveRun({
                      ...run,
                      status: "failed",
                      completedAt: timestamp,
                      error: failure(cause).message,
                    }),
                  ),
                ),
              ),
            );
          }
        });

        const events = yield* engine.subscribeDomainEvents;
        yield* forkParked(
          events.pipe(
            Stream.runForEach((event) =>
              mutex
                .withPermits(1)(
                  Effect.gen(function* () {
                    const completed = event.type === "thread.turn-diff-completed";
                    const failed =
                      event.type === "thread.session-set" &&
                      ["error", "interrupted", "stopped"].includes(event.payload.session.status);
                    if (!completed && !failed) return;
                    const runs = yield* store.activeRuns();
                    for (const run of runs) {
                      if (run.threadId !== event.aggregateId) continue;
                      // Stream completion events can contain an empty delta. Read the final projection.
                      const message =
                        completed && event.payload.assistantMessageId
                          ? yield* query.getTurnStartMessage({
                              threadId: run.threadId,
                              messageId: event.payload.assistantMessageId,
                            })
                          : Option.none();
                      const noFindings =
                        Option.isSome(message) &&
                        message.value.message.text.trim() === "AUTOMATION_NO_FINDINGS";
                      yield* store.saveRun({
                        ...run,
                        status: completed ? "completed" : failed ? "failed" : run.status,
                        completedAt: completed || failed ? yield* now : null,
                        error:
                          failed && event.type === "thread.session-set"
                            ? (event.payload.session.lastError ?? "The provider session stopped.")
                            : null,
                        archived: noFindings || run.archived,
                        read: noFindings || run.read,
                      });
                    }
                  }),
                )
                .pipe(
                  Effect.catch((cause) =>
                    Effect.logWarning("Could not update automation run", { cause: String(cause) }),
                  ),
                ),
            ),
          ),
        );

        if (options.startScheduler !== false)
          yield* forkParked(
            Effect.gen(function* () {
              // Requests wait until interrupted runs have been reconciled.
              yield* now.pipe(
                Effect.flatMap(store.interruptActiveRuns),
                Effect.tap(() => Deferred.succeed(ready, undefined)),
                Effect.catch((cause) => Deferred.fail(ready, failure(cause))),
              );
              yield* Deferred.await(ready);
              yield* tick.pipe(
                Effect.catch((cause) =>
                  Effect.logWarning("Automation scheduler failed", { cause: String(cause) }),
                ),
                Effect.repeat(Schedule.spaced("5 seconds")),
              );
            }),
          );
        return AutomationService.of({
          list: Deferred.await(ready).pipe(Effect.andThen(store.list())),
          action,
          runDue: tick.pipe(Effect.mapError(failure)),
        });
      }),
    );
  }
  static readonly layer = AutomationService.layerWithOptions();
}
