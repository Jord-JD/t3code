import { randomUUID } from "../../lib/utils";
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
import { TraitsPicker } from "../chat/TraitsPicker";
import { Button } from "../ui/button";
import { Dialog, DialogPopup, DialogTitle, DialogDescription } from "../ui/dialog";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";

const selectClass =
  "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
const DAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
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
    automation?.runtimeMode ?? "approval-required",
  );
  const [threadId, setThreadId] = useState<ThreadId | null>(automation?.threadId ?? null);
  const [timezone, setTimezone] = useState(
    automation?.timezone ?? new Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const [cadence, setCadence] = useState(automation ? "custom" : "weekly");
  const [time, setTime] = useState("09:00");
  const [interval, setIntervalValue] = useState(1);
  const [days, setDays] = useState(["MO", "TU", "WE", "TH", "FR"]);
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
  const preview = useMemo(() => {
    try {
      return { date: nextAutomationRun(rule, timezone, new Date(), new Date()), error: null };
    } catch (error) {
      return { date: null, error: error instanceof Error ? error.message : "Check the schedule." };
    }
  }, [rule, timezone]);
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
        if (!open && !busy) onClose();
      }}
    >
      <DialogPopup className="max-h-[85dvh] max-w-2xl overflow-y-auto p-6">
        <DialogTitle>{automation ? "Edit automation" : "New automation"}</DialogTitle>
        <DialogDescription className="sr-only">
          Choose instructions, projects, and a schedule.
        </DialogDescription>
        <form
          className="mt-5 space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <fieldset disabled={busy} className="space-y-5 disabled:opacity-60">
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
                className="min-h-24 resize-y font-normal"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="What should the agent do on each run? You can reference skills with $skill-name."
                maxLength={32000}
                required
              />
            </label>
            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm font-medium">Projects</legend>
              <div className="max-h-32 space-y-2 overflow-y-auto rounded-lg border p-3">
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
            <div className="grid gap-4 sm:grid-cols-2">
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
              <label className="space-y-2 text-sm font-medium">
                Permissions
                <select
                  className={selectClass}
                  value={runtimeMode}
                  onChange={(e) => setRuntimeMode(e.target.value as RuntimeMode)}
                >
                  <option value="approval-required">Ask for approval</option>
                  <option value="auto-accept-edits">Accept edits</option>
                  <option value="auto">Automatic approval</option>
                  <option value="full-access">Full access</option>
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
                      threadRefs.find((ref) => ref.threadId === e.target.value)?.threadId ?? null,
                    )
                  }
                >
                  <option value="">New thread for each run</option>
                  {threadRefs.map((ref) => (
                    <ThreadOption key={ref.threadId} threadRef={ref} projectId={projectIds[0]!} />
                  ))}
                </select>
              </label>
            )}
            <div className="space-y-2">
              <span className="text-sm font-medium">Model</span>
              <div className="flex flex-wrap gap-2">
                {selection && activeEntry ? (
                  <>
                    <ProviderModelPicker
                      activeInstanceId={selection.instanceId}
                      model={selection.model}
                      lockedProvider={null}
                      instanceEntries={entries}
                      modelOptionsByInstance={modelOptions}
                      triggerVariant="outline"
                      triggerAriaLabel="Automation model"
                      onInstanceModelChange={(instanceId, model) =>
                        setSelection(createModelSelection(instanceId, model))
                      }
                    />
                    <TraitsPicker
                      provider={activeEntry.driverKind}
                      models={activeEntry.models}
                      model={selection.model}
                      prompt=""
                      onPromptChange={() => {}}
                      modelOptions={selection.options ?? []}
                      allowPromptInjectedEffort={false}
                      planModeEnabled={settings.planModeEnabled}
                      triggerVariant="outline"
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
              </div>
            </div>
            <fieldset className="space-y-3 rounded-xl border p-4">
              <legend className="px-1 text-sm font-medium">Schedule</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-2 text-sm">
                  Repeat
                  <select
                    className={selectClass}
                    value={cadence}
                    onChange={(e) => setCadence(e.target.value)}
                  >
                    <option value="weekly">Weekly</option>
                    <option value="daily">Daily</option>
                    <option value="hourly">Every few hours</option>
                    <option value="custom">Custom RRULE</option>
                  </select>
                </label>
                {cadence === "hourly" ? (
                  <label className="space-y-2 text-sm">
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
                  <label className="space-y-2 text-sm">
                    Time
                    <Input
                      type="time"
                      value={time}
                      onChange={(e) => setTime(e.target.value)}
                      required
                    />
                  </label>
                ) : null}
              </div>
              {cadence === "weekly" && (
                <div className="flex flex-wrap gap-1" aria-label="Days of the week">
                  {DAYS.map((day, index) => (
                    <Button
                      key={day}
                      type="button"
                      size="sm"
                      variant={days.includes(day) ? "secondary" : "outline"}
                      aria-pressed={days.includes(day)}
                      onClick={() =>
                        setDays(days.includes(day) ? days.filter((d) => d !== day) : [...days, day])
                      }
                    >
                      {LABELS[index]}
                    </Button>
                  ))}
                </div>
              )}
              {cadence === "custom" && (
                <label className="block space-y-2 text-sm">
                  Recurrence rule
                  <Input
                    value={customRule}
                    onChange={(e) => setCustomRule(e.target.value)}
                    className="font-mono text-xs"
                    placeholder="FREQ=MONTHLY;BYMONTHDAY=1;BYHOUR=9;BYMINUTE=0"
                    required
                  />
                </label>
              )}
              <label className="block space-y-2 text-sm">
                Time zone
                <Input
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  placeholder="Europe/London"
                  required
                />
              </label>
              <p
                className={`text-xs ${preview.error ? "text-destructive" : "text-muted-foreground"}`}
              >
                {preview.error ??
                  `Next run: ${new Date(preview.date!).toLocaleString(undefined, { timeZone: timezone })} (${timezone})`}
              </p>
            </fieldset>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={status === "active"}
                onChange={(e) => setStatus(e.target.checked ? "active" : "paused")}
                className="accent-primary"
              />
              Enable schedule
            </label>
            <p className="text-xs leading-5 text-muted-foreground">
              Runs use the selected provider's tools and skills. Requests that need approval wait in
              the run's thread. Local execution can change your checkout; non-Git projects always
              run locally.
            </p>
          </fieldset>
          {(validation || error) && (
            <p role="alert" className="text-sm text-destructive">
              {validation || error}
            </p>
          )}
          <div className="flex justify-end gap-2 border-t pt-4">
            <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !selection}>
              {busy ? "Saving…" : automation ? "Save changes" : "Create automation"}
            </Button>
          </div>
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
