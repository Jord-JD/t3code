import { randomUUID } from "../../lib/utils";
import { Clock3Icon, ChevronDownIcon, SlidersHorizontalIcon, XIcon } from "lucide-react";
import { AUTOMATION_DAYS, parseEditorSchedule } from "./automationEditorSchedule";
import { useMemo, useState } from "react";
import {
  DEFAULT_SERVER_SETTINGS,
  type Automation,
  type AutomationInput,
  type EnvironmentId,
  type ModelSelection,
  type RuntimeMode,
  type ThreadId,
} from "@t3tools/contracts";
import { nextAutomationRun } from "@t3tools/shared/automationSchedule";
import { createModelSelection } from "@t3tools/shared/model";
import { useClientSettings } from "../../hooks/useSettings";
import { useEnvironment } from "../../state/environments";
import { useProjects, useEnvironmentThreadRefs, useThreadShell } from "../../state/entities";
import { getCustomModelOptionsByInstance } from "../../modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  resolveDefaultProviderModelSelection,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import { EMPTY_SERVER_PROVIDERS } from "../../state/server";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { RuntimeModePicker } from "../chat/RuntimeModePicker";
import { ComposerControlSeparator } from "../chat/ComposerControl";
import { TraitsPicker } from "../chat/TraitsPicker";
import { Button } from "../ui/button";
import { Dialog, DialogPopup, DialogTitle, DialogDescription } from "../ui/dialog";
import { Switch } from "../ui/switch";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";

const selectClass =
  "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
const DAYS = AUTOMATION_DAYS;
const LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function AutomationEditor({
  environmentId,
  automation,
  template,
  busy,
  error,
  onSave,
  onClose,
}: {
  environmentId: EnvironmentId;
  automation: Automation | undefined;
  template: { name: string; prompt: string } | undefined;
  busy: boolean;
  error: string | null;
  onSave: (input: AutomationInput) => Promise<void>;
  onClose: () => void;
}) {
  const environment = useEnvironment(environmentId);
  const projects = useProjects().filter((item) => item.environmentId === environmentId);
  const threadRefs = useEnvironmentThreadRefs(environmentId);
  const clientSettings = useClientSettings();
  const serverSettings = environment?.serverConfig?.settings ?? DEFAULT_SERVER_SETTINGS;
  const providers = environment?.serverConfig?.providers ?? EMPTY_SERVER_PROVIDERS;
  const settings = { ...serverSettings, ...clientSettings };
  const entries = sortProviderInstanceEntries(
    applyProviderInstanceSettings(deriveProviderInstanceEntries(providers), settings),
  );
  const [id] = useState(() => automation?.id ?? randomUUID());
  const [name, setName] = useState(automation?.name ?? template?.name ?? "");
  const [prompt, setPrompt] = useState(automation?.prompt ?? template?.prompt ?? "");
  const [projectIds, setProjectIds] = useState(
    automation?.projectIds ?? (projects[0] ? [projects[0].id] : []),
  );
  const [selection, setSelection] = useState<ModelSelection | null>(
    () =>
      automation?.modelSelection ??
      resolveDefaultProviderModelSelection(
        providers,
        projects[0]?.defaultModelSelection ?? serverSettings.defaultModelSelection,
      ),
  );
  const [executionMode, setExecutionMode] = useState<"local" | "worktree">(
    automation?.executionMode ?? "worktree",
  );
  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>(
    automation?.runtimeMode ?? "full-access",
  );
  const [threadId, setThreadId] = useState<ThreadId | null>(automation?.threadId ?? null);
  const [timezone, setTimezone] = useState(
    automation?.timezone ?? new Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const [initialSchedule] = useState(() => parseEditorSchedule(automation?.rrule));
  const [cadence, setCadence] = useState(initialSchedule.cadence);
  const [time, setTime] = useState(initialSchedule.time);
  const [interval, setIntervalValue] = useState(initialSchedule.interval);
  const [days, setDays] = useState(initialSchedule.days);
  const [customRule, setCustomRule] = useState(
    automation?.rrule ?? "FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
  );
  const [status, setStatus] = useState<"active" | "paused">(automation?.status ?? "active");
  const [validation, setValidation] = useState<string | null>(null);
  const rule =
    cadence === "custom"
      ? customRule
      : cadence === "hourly"
        ? `FREQ=HOURLY;INTERVAL=${interval}`
        : `FREQ=${cadence === "weekly" ? "WEEKLY" : "DAILY"};BYHOUR=${Number(time.split(":")[0])};BYMINUTE=${Number(time.split(":")[1])}${cadence === "weekly" ? `;BYDAY=${days.join(",")}` : ""}`;
  const draft = JSON.stringify({
    name,
    prompt,
    projectIds,
    selection,
    executionMode,
    runtimeMode,
    threadId,
    timezone,
    rule,
    status,
  });
  const [initialDraft] = useState(draft);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  function requestClose() {
    if (busy) return;
    if (draft !== initialDraft) setConfirmDiscard(true);
    else onClose();
  }
  const preview = useMemo(() => {
    try {
      if (cadence === "weekly" && !days.length) throw new Error("Choose at least one day.");
      const now = new Date();
      const anchor = new Date(automation?.createdAt ?? now);
      const dates: string[] = [];
      let after = now;
      for (let i = 0; i < 3; i++) {
        const date = nextAutomationRun(rule, timezone, anchor, after);
        dates.push(date);
        after = new Date(date);
      }
      return { dates, error: null };
    } catch (error) {
      return { dates: [], error: error instanceof Error ? error.message : "Check the schedule." };
    }
  }, [rule, timezone, cadence, days.length, automation]);
  const timezones = useMemo(
    () => [
      ...new Set([
        new Intl.DateTimeFormat().resolvedOptions().timeZone,
        "UTC",
        ...Intl.supportedValuesOf("timeZone"),
      ]),
    ],
    [],
  );

  const activeEntry = entries.find((entry) => entry.instanceId === selection?.instanceId);
  const modelOptions = getCustomModelOptionsByInstance(
    settings,
    providers,
    selection?.instanceId,
    selection?.model,
  );
  async function save() {
    if (!name.trim() || !prompt.trim()) {
      setValidation("Enter a name and instructions for this automation.");
      return;
    }
    if (!projectIds.length || !selection) {
      setValidation("Choose at least one project and a model.");
      return;
    }
    if (preview.error) {
      setValidation(preview.error);
      return;
    }
    setValidation(null);
    await onSave({
      id,
      name: name.trim(),
      prompt: prompt.trim(),
      projectIds,
      modelSelection: selection,
      runtimeMode,
      executionMode,
      threadId,
      timezone,
      rrule: rule,
      status,
    });
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) requestClose();
      }}
    >
      <DialogPopup
        showCloseButton={false}
        className="flex max-h-[90dvh] max-w-4xl flex-col overflow-hidden p-0"
      >
        <header className="flex min-h-16 shrink-0 items-center justify-between gap-4 border-b px-6 py-3">
          <DialogTitle className="leading-6">
            {automation ? "Edit automation" : "New automation"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Configure the task and its schedule.
          </DialogDescription>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Close"
            disabled={busy}
            onClick={requestClose}
          >
            <XIcon />
          </Button>
        </header>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onChange={() => {
            setValidation(null);
            setConfirmDiscard(false);
          }}
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="min-h-0 overflow-y-auto overscroll-contain">
            <fieldset
              disabled={busy}
              className="grid min-w-0 disabled:opacity-60 md:grid-cols-[minmax(0,1fr)_320px]"
            >
              <div className="min-w-0 space-y-5 p-6">
                <label className="block space-y-2 text-sm font-medium">
                  Name
                  <Input
                    autoFocus
                    maxLength={120}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Daily project briefing"
                    required
                  />
                </label>
                <label className="block space-y-2 text-sm font-medium">
                  Instructions
                  <Textarea
                    className="min-h-36 resize-y font-normal"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Describe the task and what a useful result should include."
                    maxLength={32000}
                    required
                  />
                </label>
                <p className="-mt-2 text-xs text-muted-foreground">
                  Reference installed skills with $skill-name.
                </p>
                <fieldset className="space-y-2">
                  <legend className="mb-2 text-sm font-medium">Projects</legend>
                  <div className="max-h-28 space-y-2 overflow-y-auto rounded-lg border p-3">
                    {projects.map((project) => (
                      <label key={project.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={projectIds.includes(project.id)}
                          onChange={(e) => {
                            setThreadId(null);
                            setProjectIds(
                              e.target.checked
                                ? [...projectIds, project.id]
                                : projectIds.filter((id) => id !== project.id),
                            );
                          }}
                          className="accent-primary"
                        />
                        {project.title}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div className="space-y-2">
                  <span className="block text-sm font-medium">Model</span>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-2 rounded-lg border p-2">
                    {selection && activeEntry ? (
                      <>
                        <ProviderModelPicker
                          activeInstanceId={selection.instanceId}
                          model={selection.model}
                          lockedProvider={null}
                          instanceEntries={entries}
                          modelOptionsByInstance={modelOptions}
                          triggerVariant="ghost"
                          triggerAriaLabel="Automation model"
                          onInstanceModelChange={(instanceId, model) =>
                            setSelection(createModelSelection(instanceId, model))
                          }
                        />
                        <ComposerControlSeparator />
                        <TraitsPicker
                          provider={activeEntry.driverKind}
                          models={activeEntry.models}
                          model={selection.model}
                          prompt=""
                          onPromptChange={() => {}}
                          modelOptions={selection.options ?? []}
                          allowPromptInjectedEffort={false}
                          planModeEnabled={settings.planModeEnabled}
                          triggerVariant="ghost"
                          onModelOptionsChange={(options) =>
                            setSelection(
                              createModelSelection(selection.instanceId, selection.model, options),
                            )
                          }
                        />
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Configure a provider in Settings to select a model.
                      </p>
                    )}
                    <ComposerControlSeparator />
                    <RuntimeModePicker
                      runtimeMode={runtimeMode}
                      onRuntimeModeChange={setRuntimeMode}
                    />
                  </div>
                </div>

                <details className="group rounded-lg border">
                  <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg p-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                    <SlidersHorizontalIcon className="size-4 text-muted-foreground" />
                    Run settings
                    <span className="ml-auto text-xs font-normal text-muted-foreground">
                      {executionMode === "worktree" ? "Worktree" : "Local"}
                    </span>
                    <ChevronDownIcon className="size-4 text-muted-foreground group-open:rotate-180" />
                  </summary>
                  <div className="space-y-4 border-t p-4">
                    <div className="grid gap-4">
                      <label className="space-y-2 text-sm font-medium">
                        Run in
                        <select
                          className={selectClass}
                          value={executionMode}
                          onChange={(e) => {
                            setExecutionMode(e.target.value === "local" ? "local" : "worktree");
                            setThreadId(null);
                          }}
                        >
                          <option value="worktree">Isolated worktree</option>
                          <option value="local">Local project</option>
                        </select>
                      </label>
                    </div>
                    {executionMode === "local" && projectIds.length === 1 && (
                      <label className="block space-y-2 text-sm font-medium">
                        Conversation
                        <select
                          className={selectClass}
                          value={threadId ?? ""}
                          onChange={(e) =>
                            setThreadId(
                              threadRefs.find((ref) => ref.threadId === e.target.value)?.threadId ??
                                null,
                            )
                          }
                        >
                          <option value="">New thread for each run</option>
                          {threadRefs.map((ref) => (
                            <ThreadOption
                              key={ref.threadId}
                              threadRef={ref}
                              projectId={projectIds[0]!}
                            />
                          ))}
                        </select>
                      </label>
                    )}

                    <p className="text-xs leading-5 text-muted-foreground">
                      {executionMode === "worktree"
                        ? "Git projects run in a separate worktree. Non-Git projects run locally."
                        : "Runs can change files in your checkout."}{" "}
                      Approval requests wait in the run’s thread.
                    </p>
                  </div>
                </details>
              </div>
              <aside className="min-w-0 border-t bg-muted/30 p-6 md:border-t-0 md:border-l">
                <fieldset className="space-y-4">
                  <legend className="mb-4 flex items-center gap-2 text-sm font-semibold">
                    <Clock3Icon className="size-4 text-muted-foreground" />
                    Schedule
                  </legend>
                  <div className="flex items-center justify-between gap-3 rounded-lg border bg-background p-3">
                    <div>
                      <label
                        htmlFor="automation-schedule-enabled"
                        className="cursor-pointer text-sm font-medium"
                      >
                        {status === "active" ? "Active" : "Paused"}
                      </label>
                      <p
                        id="automation-schedule-status"
                        className="mt-0.5 text-xs text-muted-foreground"
                      >
                        {status === "active"
                          ? "Runs automatically on schedule"
                          : "Run manually until resumed"}
                      </p>
                    </div>
                    <Switch
                      id="automation-schedule-enabled"
                      aria-label="Enable schedule"
                      aria-describedby="automation-schedule-status"
                      checked={status === "active"}
                      disabled={busy}
                      onCheckedChange={(checked) => setStatus(checked ? "active" : "paused")}
                    />
                  </div>
                  <label className="block space-y-2 text-sm font-medium">
                    Repeat
                    <select
                      className={selectClass}
                      value={cadence}
                      onChange={(e) => setCadence(e.target.value)}
                    >
                      <option value="weekly">Weekly</option>
                      <option value="daily">Daily</option>
                      <option value="hourly">Hourly</option>
                      <option value="custom">Custom rule</option>
                    </select>
                  </label>
                  {cadence === "weekly" && (
                    <fieldset className="space-y-2">
                      <legend className="mb-2 text-sm font-medium">On these days</legend>
                      <div className="flex gap-1">
                        {DAYS.map((day, index) => (
                          <Button
                            key={day}
                            type="button"
                            size="sm"
                            variant="outline"
                            className={`h-9 min-w-0 flex-1 px-0 text-xs ${days.includes(day) ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15" : "text-muted-foreground"}`}
                            aria-pressed={days.includes(day)}
                            onClick={() =>
                              setDays(
                                days.includes(day) ? days.filter((d) => d !== day) : [...days, day],
                              )
                            }
                          >
                            {LABELS[index]}
                          </Button>
                        ))}
                      </div>
                      <div className="flex gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          onClick={() => setDays(DAYS.slice(0, 5))}
                        >
                          Weekdays
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          onClick={() => setDays([...DAYS])}
                        >
                          Every day
                        </Button>
                      </div>
                    </fieldset>
                  )}
                  {cadence === "hourly" ? (
                    <label className="block space-y-2 text-sm font-medium">
                      Hours between runs
                      <Input
                        type="number"
                        min={1}
                        max={1000}
                        value={interval}
                        onChange={(e) => setIntervalValue(Number(e.target.value))}
                      />
                    </label>
                  ) : cadence !== "custom" ? (
                    <label className="block space-y-2 text-sm font-medium">
                      At
                      <Input
                        aria-label="Run time"
                        type="time"
                        value={time}
                        onChange={(e) => setTime(e.target.value)}
                        required
                      />
                    </label>
                  ) : (
                    <label className="block space-y-2 text-sm font-medium">
                      Recurrence rule
                      <Textarea
                        value={customRule}
                        onChange={(e) => setCustomRule(e.target.value)}
                        className="min-h-20 resize-y font-mono text-xs font-normal"
                        placeholder="FREQ=MONTHLY;BYMONTHDAY=1;BYHOUR=9;BYMINUTE=0"
                        required
                      />
                      <span className="block text-xs font-normal leading-5 text-muted-foreground">
                        Use an RRULE for intervals or monthly schedules.
                      </span>
                    </label>
                  )}
                  <label className="block space-y-2 text-sm font-medium">
                    Time zone
                    <Input
                      value={timezone}
                      onChange={(e) => setTimezone(e.target.value)}
                      list="automation-timezones"
                      placeholder="Search time zones…"
                      required
                    />
                  </label>
                  <datalist id="automation-timezones">
                    {timezones.map((zone) => (
                      <option key={zone} value={zone} />
                    ))}
                  </datalist>
                  <div
                    aria-live="polite"
                    className={`rounded-lg border bg-background p-3 ${preview.error ? "border-destructive/30" : ""}`}
                  >
                    {preview.error ? (
                      <p className="text-xs leading-5 text-destructive">{preview.error}</p>
                    ) : (
                      <>
                        <p className="mb-2 text-xs font-medium">
                          {status === "paused" ? "Upcoming if resumed" : "Next three runs"}
                        </p>
                        <ol className="space-y-2">
                          {preview.dates.map((date) => (
                            <li
                              key={date}
                              className="flex justify-between gap-2 text-xs tabular-nums text-muted-foreground"
                            >
                              <span>
                                {new Date(date).toLocaleDateString(undefined, {
                                  timeZone: timezone,
                                  weekday: "short",
                                  month: "short",
                                  day: "numeric",
                                })}
                              </span>
                              <span>
                                {new Date(date).toLocaleTimeString(undefined, {
                                  timeZone: timezone,
                                  hour: "numeric",
                                  minute: "2-digit",
                                })}
                              </span>
                            </li>
                          ))}
                        </ol>
                      </>
                    )}
                  </div>
                </fieldset>

                <p className="mt-4 text-xs leading-5 text-muted-foreground">
                  Automations only run when the host computer is awake and T3 is running.
                </p>
              </aside>
            </fieldset>
          </div>
          <footer className="shrink-0 space-y-3 border-t bg-background px-6 py-4">
            {(validation || error) && (
              <p role="alert" className="text-sm text-destructive">
                {validation || error}
              </p>
            )}
            {confirmDiscard ? (
              <div className="flex flex-wrap items-center justify-between gap-3" role="alert">
                <p className="text-sm">Discard your unsaved changes?</p>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={() => setConfirmDiscard(false)}>
                    Keep editing
                  </Button>
                  <Button type="button" variant="destructive" onClick={onClose}>
                    Discard changes
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="ml-auto flex gap-2">
                  <Button type="button" variant="ghost" disabled={busy} onClick={requestClose}>
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={busy || !selection || Boolean(preview.error) || !projectIds.length}
                  >
                    {busy ? "Saving…" : automation ? "Save changes" : "Create automation"}
                  </Button>
                </div>
              </div>
            )}
          </footer>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

function ThreadOption({
  threadRef,
  projectId,
}: {
  threadRef: { environmentId: EnvironmentId; threadId: ThreadId };
  projectId: string;
}) {
  const thread = useThreadShell(threadRef);
  return thread && thread.projectId === projectId ? (
    <option value={thread.id}>{thread.title}</option>
  ) : null;
}
