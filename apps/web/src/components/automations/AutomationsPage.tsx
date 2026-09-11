import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import { AsyncResult } from "effect/unstable/reactivity";
import { formatEnvironmentQueryError } from "../../state/query";
import { useState } from "react";
import {
  ArrowUpRightIcon,
  CheckCheckIcon,
  Clock3Icon,
  InboxIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  RotateCcwIcon,
  SearchIcon,
  TimerIcon,
  Trash2Icon,
} from "lucide-react";
import type {
  Automation,
  AutomationAction,
  AutomationInput,
  EnvironmentId,
} from "@t3tools/contracts";
import { describeAutomationSchedule } from "@t3tools/shared/automationSchedule";
import { automationAction, automationSnapshot } from "../../state/automations";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { useProjects } from "../../state/entities";
import { useAtomCommand } from "../../state/use-atom-command";
import { isElectron } from "../../env";
import { Button } from "../ui/button";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SidebarInset } from "../ui/sidebar";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { AutomationEditor } from "./AutomationEditor";

export const automationSelectClass =
  "h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function AutomationsPage() {
  const { environments } = useEnvironments();
  const primaryId = usePrimaryEnvironmentId();
  const [selectedId, setSelectedId] = useState<EnvironmentId | null>(null);
  const environmentId = selectedId ?? primaryId ?? environments[0]?.environmentId;
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
      <WorkspacePageHeader electron={isElectron}>
        <TimerIcon className="size-4 text-muted-foreground" />
        <span className="text-sm">Automations</span>
        {environments.length > 1 && (
          <select
            aria-label="Environment"
            className={`${automationSelectClass} ml-auto no-drag`}
            value={environmentId ?? ""}
            onChange={(e) =>
              setSelectedId(
                environments.find((item) => item.environmentId === e.target.value)?.environmentId ??
                  null,
              )
            }
          >
            {environments.map((item) => (
              <option key={item.environmentId} value={item.environmentId}>
                {item.label}
              </option>
            ))}
          </select>
        )}
      </WorkspacePageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <WorkspacePageContainer width="wide">
          {environmentId ? (
            <EnvironmentAutomations key={environmentId} environmentId={environmentId} />
          ) : (
            <p className="text-muted-foreground">Connect an environment to create an automation.</p>
          )}
        </WorkspacePageContainer>
      </div>
    </SidebarInset>
  );
}

function EnvironmentAutomations({ environmentId }: { environmentId: EnvironmentId }) {
  const atom = automationSnapshot({ environmentId, input: {} });
  const result = useAtomValue(atom);
  const refresh = useAtomRefresh(atom);
  const execute = useAtomCommand(automationAction);
  const projects = useProjects().filter((project) => project.environmentId === environmentId);
  const [editor, setEditor] = useState<Automation | "new" | null>(null);
  const [template, setTemplate] = useState<{ name: string; prompt: string } | undefined>();
  const [tab, setTab] = useState<"tasks" | "inbox">("tasks");
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [resultAutomationId, setResultAutomationId] = useState("");
  const [busy, setBusy] = useState(false);
  const [runClosing, setRunClosing] = useState(false);
  const [deleteClosing, setDeleteClosing] = useState(false);
  const [runTarget, setRunTarget] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<
    | { type: "delete" | "delete-run"; id: string; name: string }
    | { type: "delete-all-read"; automationId?: string }
    | null
  >(null);
  const data = AsyncResult.isSuccess(result) ? result.value : null;

  async function act(input: AutomationAction) {
    if (busy) return false;
    setBusy(true);
    setError(null);
    try {
      const outcome = await execute({ environmentId, input });
      if (AsyncResult.isFailure(outcome)) {
        setError(formatEnvironmentQueryError(outcome.cause));
        return false;
      }
      refresh();
      return true;
    } finally {
      setBusy(false);
    }
  }
  const unread =
    data?.runs.filter(
      (run) => !run.read && !run.archived && !["queued", "running"].includes(run.status),
    ).length ?? 0;
  const filtered =
    data?.automations.filter(
      (item) =>
        (filter === "all" || item.status === filter) &&
        `${item.name} ${item.prompt}`.toLowerCase().includes(search.toLowerCase()),
    ) ?? [];
  const resultAutomations = new Map(data?.automations.map((item) => [item.id, item.name]));
  for (const run of data?.runs ?? []) {
    if (!run.archived && !resultAutomations.has(run.automationId)) {
      resultAutomations.set(run.automationId, run.automationName);
    }
  }
  const runs =
    data?.runs.filter(
      (run) => !run.archived && (!resultAutomationId || run.automationId === resultAutomationId),
    ) ?? [];
  const hasUnreadResults = runs.some(
    (run) => !run.read && !["queued", "running"].includes(run.status),
  );
  const hasReadResults = runs.some(
    (run) => run.read && !["queued", "running"].includes(run.status),
  );
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4 pt-3">
        <h1 className="text-2xl font-semibold tracking-tight">Automations</h1>
        <Button
          size="sm"
          disabled={!data || !projects.length}
          onClick={() => {
            setTemplate(undefined);
            setEditor("new");
          }}
        >
          <PlusIcon />
          New automation
        </Button>
      </div>
      <div
        className="flex flex-wrap items-center gap-1 border-b pb-3"
        role="tablist"
        aria-label="Automation views"
      >
        {(
          [
            ["tasks", "Automations", TimerIcon],
            ["inbox", "Results", InboxIcon],
          ] as const
        ).map(([value, label, Icon]) => (
          <Button
            key={value}
            role="tab"
            className="gap-1.5 px-2 text-xs sm:px-3 sm:text-sm"
            aria-selected={tab === value}
            tabIndex={tab === value ? 0 : -1}
            onKeyDown={(event) => {
              const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
              if (!keys.includes(event.key)) return;
              event.preventDefault();
              const tabs =
                event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                  '[role="tab"]',
                );
              if (!tabs) return;
              const index = Array.from(tabs).indexOf(event.currentTarget);
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? tabs.length - 1
                    : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
              tabs[next]?.focus();
              tabs[next]?.click();
            }}
            variant={tab === value ? "secondary" : "ghost"}
            onClick={() => setTab(value)}
          >
            <Icon />
            {label}
            {value === "inbox" && unread > 0 && (
              <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground">
                {unread}
              </span>
            )}
          </Button>
        ))}
      </div>
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      {AsyncResult.isFailure(result) && (
        <div role="alert" className="rounded-xl border p-5">
          <p>
            Could not load automations. Check that this environment is connected and its server
            supports Automations.
          </p>
          <Button className="mt-3" variant="outline" onClick={refresh}>
            Retry
          </Button>
        </div>
      )}
      {!data && !AsyncResult.isFailure(result) && (
        <p role="status" className="py-12 text-center text-sm text-muted-foreground">
          Loading automations…
        </p>
      )}
      {data && (
        <>
          {(data.automations.length > 0 || tab !== "tasks") && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              {tab === "tasks" && (
                <div className="relative min-w-48 flex-1 sm:max-w-xs">
                  <SearchIcon className="absolute top-2.5 left-3 size-4 text-muted-foreground" />
                  <Input
                    aria-label="Search automations"
                    placeholder="Search automations"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-9"
                  />
                </div>
              )}
              {tab === "inbox" && (
                <Select
                  value={resultAutomationId}
                  onValueChange={(value) => setResultAutomationId(value ?? "")}
                >
                  <SelectTrigger
                    aria-label="Filter results by automation"
                    className="w-full sm:max-w-xs"
                  >
                    <SelectValue>
                      {resultAutomationId
                        ? (resultAutomations.get(resultAutomationId) ?? "Unavailable automation")
                        : "All automations"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup alignItemWithTrigger={false}>
                    <SelectItem value="">All automations</SelectItem>
                    {Array.from(resultAutomations, ([id, name]) => (
                      <SelectItem key={id} value={id}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              )}
              {tab === "tasks" ? (
                <div className="flex gap-1" aria-label="Filter status">
                  {["all", "active", "paused"].map((value) => (
                    <Button
                      key={value}
                      size="sm"
                      variant={filter === value ? "secondary" : "ghost"}
                      aria-pressed={filter === value}
                      onClick={() => setFilter(value)}
                      className="capitalize"
                    >
                      {value}
                    </Button>
                  ))}
                </div>
              ) : (
                <div className="ml-auto flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy || !hasUnreadResults}
                    onClick={() =>
                      void act({
                        type: "read-all",
                        ...(resultAutomationId ? { automationId: resultAutomationId } : {}),
                      })
                    }
                  >
                    <CheckCheckIcon />
                    Mark all as read
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy || !hasReadResults}
                    onClick={() => {
                      setError(null);
                      setDeleteTarget({
                        type: "delete-all-read",
                        ...(resultAutomationId ? { automationId: resultAutomationId } : {}),
                      });
                    }}
                  >
                    <Trash2Icon />
                    Delete all read
                  </Button>
                </div>
              )}
            </div>
          )}
          {tab === "tasks" && data.automations.length === 0 ? (
            <>
              <div className="flex flex-col items-center rounded-2xl border border-dashed px-6 py-12 text-center">
                <div className="mb-5 rounded-2xl border bg-muted/40 p-4">
                  <TimerIcon className="size-7 text-muted-foreground" />
                </div>
                <h2 className="text-base font-medium">No automations yet</h2>
                <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                  Schedule a code review, a daily briefing, or a check on your project. Each run
                  opens a thread you can pick up.
                </p>
                <Button
                  className="mt-6"
                  variant="outline"
                  disabled={!projects.length}
                  onClick={() => {
                    setTemplate(undefined);
                    setEditor("new");
                  }}
                >
                  <PlusIcon />
                  Create an automation
                </Button>
                {!projects.length && (
                  <p className="mt-3 text-sm text-muted-foreground">
                    Add a project to this environment first.
                  </p>
                )}
              </div>
              <div>
                <h2 className="mb-3 text-sm font-medium text-muted-foreground">
                  Start with an idea
                </h2>
                <div className="grid gap-3 sm:grid-cols-3">
                  {TEMPLATES.map((item) => (
                    <button
                      key={item.name}
                      disabled={!projects.length}
                      onClick={() => {
                        setTemplate(item);
                        setEditor("new");
                      }}
                      className="flex flex-col items-start rounded-xl border p-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                    >
                      <item.icon className="mb-3 size-4 text-muted-foreground" />
                      <h3 className="text-sm font-medium">{item.name}</h3>
                      <p className="mt-2 text-xs leading-5 text-muted-foreground">
                        {item.description}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : tab === "tasks" ? (
            <div className="divide-y rounded-xl border">
              {filtered.length === 0 && (
                <p className="p-8 text-center text-sm text-muted-foreground">
                  No automations match this search.
                </p>
              )}
              {filtered.map((item) => {
                const running = data.runs.some(
                  (run) =>
                    run.automationId === item.id && ["queued", "running"].includes(run.status),
                );
                return (
                  <div key={item.id} className="flex flex-wrap items-center gap-3 p-4">
                    <div className="rounded-lg border bg-muted/30 p-2.5">
                      {item.status === "paused" ? (
                        <PauseIcon className="size-4 text-muted-foreground" />
                      ) : (
                        <TimerIcon className="size-4" />
                      )}
                    </div>
                    <div className="min-w-40 flex-1">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="cursor-pointer text-left text-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={() => setEditor(item)}
                        >
                          {item.name}
                        </button>
                        <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] capitalize text-muted-foreground">
                          {running ? "Running" : item.status}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {item.projectIds
                          .map(
                            (id) =>
                              projects.find((p) => p.id === id)?.title ?? "Unavailable project",
                          )
                          .join(", ")}{" "}
                        ·{" "}
                        {describeAutomationSchedule(item.rrule).replace(/^./, (c) =>
                          c.toUpperCase(),
                        )}{" "}
                        ·{" "}
                        {item.nextRunAt
                          ? `Next: ${new Date(item.nextRunAt).toLocaleString()}`
                          : "Schedule paused"}
                      </p>
                    </div>
                    <div className="ml-auto flex shrink-0 items-center gap-1">
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={`View results for ${item.name}`}
                              onClick={() => {
                                setResultAutomationId(item.id);
                                setTab("inbox");
                              }}
                            />
                          }
                        >
                          <InboxIcon />
                        </TooltipTrigger>
                        <TooltipPopup>View results</TooltipPopup>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              size="icon"
                              variant="ghost"
                              disabled={busy || running}
                              aria-label={`Run ${item.name} now`}
                              onClick={() => {
                                setError(null);
                                setRunTarget({ id: item.id, name: item.name });
                              }}
                            />
                          }
                        >
                          <PlayIcon />
                        </TooltipTrigger>
                        <TooltipPopup>Run now</TooltipPopup>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              size="icon"
                              variant="ghost"
                              disabled={busy}
                              aria-label={`${item.status === "active" ? "Pause" : "Resume"} ${item.name}`}
                              onClick={() =>
                                void act({
                                  type: item.status === "active" ? "pause" : "resume",
                                  id: item.id,
                                })
                              }
                            />
                          }
                        >
                          {item.status === "active" ? <PauseIcon /> : <RotateCcwIcon />}
                        </TooltipTrigger>
                        <TooltipPopup>
                          {item.status === "active" ? "Pause automation" : "Resume automation"}
                        </TooltipPopup>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              size="icon"
                              variant="ghost"
                              disabled={busy}
                              aria-label={`Delete ${item.name}`}
                              onClick={() => {
                                setError(null);
                                setDeleteTarget({ type: "delete", id: item.id, name: item.name });
                              }}
                            />
                          }
                        >
                          <Trash2Icon />
                        </TooltipTrigger>
                        <TooltipPopup>Delete automation</TooltipPopup>
                      </Tooltip>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="divide-y rounded-xl border">
              {runs.length === 0 && (
                <div className="flex flex-col items-center p-12 text-center">
                  <InboxIcon className="mb-4 size-6 text-muted-foreground" />
                  <h2 className="text-sm font-medium">
                    {resultAutomationId ? "No results for this automation" : "You're all caught up"}
                  </h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Results from your automations will appear here.
                  </p>
                </div>
              )}
              {runs.map((run) => (
                <div key={run.id} className="flex flex-wrap items-center gap-3 p-4">
                  <span
                    className={`size-2 shrink-0 rounded-full ${run.read ? "bg-muted" : "bg-primary"}`}
                    aria-label={run.read ? "Read" : "Unread"}
                  />
                  <div className="min-w-40 flex-1">
                    <Link
                      to="/$environmentId/$threadId"
                      params={{ environmentId, threadId: run.threadId }}
                      onClick={() => {
                        void act({
                          type: "review",
                          id: run.id,
                          read: true,
                          archived: run.archived,
                        });
                      }}
                      className="inline-flex items-center gap-1 text-sm font-medium hover:underline"
                    >
                      {run.automationName}
                      <ArrowUpRightIcon className="size-3" />
                    </Link>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {projects.find((p) => p.id === run.projectId)?.title ?? "Project unavailable"}{" "}
                      · {new Date(run.startedAt).toLocaleString()} ·{" "}
                      <span className="capitalize">{run.status}</span>
                    </p>
                    {run.error && <p className="mt-2 text-xs text-destructive">{run.error}</p>}
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    disabled={busy || run.status === "queued" || run.status === "running"}
                    aria-label={`Delete result for ${run.automationName}`}
                    onClick={() => {
                      setError(null);
                      setDeleteTarget({ type: "delete-run", id: run.id, name: run.automationName });
                    }}
                  >
                    <Trash2Icon />
                  </Button>
                </div>
              ))}
            </div>
          )}
          <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
            <Clock3Icon className="mt-0.5 size-3.5 shrink-0" />
            Automations only run when the host computer is awake and T3 is running. Missed schedules
            run once when it returns.
          </p>
        </>
      )}
      <AlertDialog
        open={deleteTarget !== null && !deleteClosing}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleteClosing(true);
        }}
        onOpenChangeComplete={(open) => {
          if (!open) {
            setDeleteTarget(null);
            setDeleteClosing(false);
          }
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteTarget?.type === "delete-all-read"
                ? "Delete all read results?"
                : `${deleteTarget?.type === "delete" ? "Delete automation" : "Delete result"} "${deleteTarget?.name}"?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.type === "delete-all-read"
                ? deleteTarget.automationId
                  ? "All read results from finished runs of this automation will be permanently deleted. Their threads and worktrees will remain."
                  : "All read results from finished runs will be permanently deleted. Their threads and worktrees will remain."
                : deleteTarget?.type === "delete"
                  ? "This automation will stop running. Existing results, threads, and worktrees will remain."
                  : "This result will be permanently deleted. Its thread and worktree will remain."}
            </AlertDialogDescription>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" disabled={busy} />}>
              Cancel
            </AlertDialogClose>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                if (!deleteTarget) return;
                if (
                  await act(
                    deleteTarget.type === "delete-all-read"
                      ? deleteTarget
                      : { type: deleteTarget.type, id: deleteTarget.id },
                  )
                ) {
                  setDeleteClosing(true);
                }
              }}
            >
              {busy
                ? "Deleting…"
                : deleteTarget?.type === "delete-all-read"
                  ? "Delete all read"
                  : deleteTarget?.type === "delete"
                    ? "Delete automation"
                    : "Delete result"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
      <AlertDialog
        open={runTarget !== null && !runClosing}
        onOpenChange={(open) => {
          if (!open && !busy) setRunClosing(true);
        }}
        onOpenChangeComplete={(open) => {
          if (!open) {
            setRunTarget(null);
            setRunClosing(false);
          }
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Run "{runTarget?.name}" now?</AlertDialogTitle>
            <AlertDialogDescription>
              This will start a run using this automation's saved settings.
            </AlertDialogDescription>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" disabled={busy} />}>
              Cancel
            </AlertDialogClose>
            <Button
              disabled={busy}
              onClick={async () => {
                if (!runTarget) return;
                if (await act({ type: "run", id: runTarget.id })) setRunClosing(true);
              }}
            >
              {busy ? "Starting…" : "Run now"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
      {editor && (
        <AutomationEditor
          environmentId={environmentId}
          automation={editor === "new" ? undefined : editor}
          template={template}
          busy={busy}
          error={error}
          onClose={() => setEditor(null)}
          onSave={async (automation: AutomationInput) => {
            if (await act({ type: "save", automation })) setEditor(null);
          }}
        />
      )}
    </>
  );
}
const TEMPLATES = [
  {
    name: "Daily project briefing",
    description: "Catch up on changes and decide what needs attention.",
    icon: InboxIcon,
    prompt:
      "Review commits from the last 24 hours. Summarize the changes, identify risks, and suggest the most useful next steps. Link to relevant files.",
  },
  {
    name: "Review recent changes",
    description: "Look for regressions before they become problems.",
    icon: SearchIcon,
    prompt:
      "Review recent commits for bugs and regressions. Report only concrete, actionable findings with file references and a suggested fix. Do not modify files.",
  },
  {
    name: "Keep tests healthy",
    description: "Check the test suite and investigate new failures.",
    icon: CheckCheckIcon,
    prompt:
      "Run the project's relevant tests, investigate failures, and summarize what needs attention. Follow the repository's testing instructions. Do not change files without explaining why.",
  },
];
