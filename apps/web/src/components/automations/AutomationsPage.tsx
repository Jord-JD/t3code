import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import { AsyncResult } from "effect/unstable/reactivity";
import { formatEnvironmentQueryError } from "../../state/query";
import { useState } from "react";
import {
  ArchiveIcon,
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
import { Input } from "../ui/input";
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
  const [tab, setTab] = useState<"tasks" | "inbox" | "archived">("tasks");
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
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
  const runs =
    data?.runs.filter(
      (run) =>
        run.archived === (tab === "archived") &&
        run.automationName.toLowerCase().includes(search.toLowerCase()),
    ) ?? [];
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4 pt-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Automations</h1>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            Give recurring work a schedule. Review the results when you return.
          </p>
        </div>
        <Button
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
            ["inbox", "Inbox", InboxIcon],
            ["archived", "Archived", ArchiveIcon],
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
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy || !unread}
                  onClick={() => void act({ type: "read-all" })}
                >
                  <CheckCheckIcon />
                  Mark all as read
                </Button>
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
                    <button
                      className="min-w-40 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => setEditor(item)}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{item.name}</span>
                        <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] capitalize text-muted-foreground">
                          {running ? "Running" : item.status}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {describeAutomationSchedule(item.rrule)} · {item.timezone}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {item.nextRunAt
                          ? `Next: ${new Date(item.nextRunAt).toLocaleString()}`
                          : "Schedule paused"}{" "}
                        ·{" "}
                        {item.projectIds
                          .map(
                            (id) =>
                              projects.find((p) => p.id === id)?.title ?? "Unavailable project",
                          )
                          .join(", ")}
                      </p>
                    </button>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy || running}
                        onClick={() => void act({ type: "run", id: item.id })}
                      >
                        <PlayIcon />
                        Run now
                      </Button>
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
                      >
                        {item.status === "active" ? <PauseIcon /> : <RotateCcwIcon />}
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        disabled={busy}
                        aria-label={`Delete ${item.name}`}
                        onClick={() => setDeleteId(item.id)}
                      >
                        <Trash2Icon />
                      </Button>
                    </div>
                    {deleteId === item.id && (
                      <div className="flex w-full flex-wrap items-center gap-3 rounded-lg bg-muted p-3 text-sm">
                        <span className="flex-1">
                          Delete this automation? Existing runs and threads will remain.
                        </span>
                        <Button size="sm" variant="ghost" onClick={() => setDeleteId(null)}>
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={busy}
                          onClick={async () => {
                            if (await act({ type: "delete", id: item.id })) setDeleteId(null);
                          }}
                        >
                          Delete automation
                        </Button>
                      </div>
                    )}
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
                    {tab === "archived" ? "No archived runs" : "You're all caught up"}
                  </h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {tab === "archived"
                      ? "Archived results will appear here."
                      : "Results from your automations will appear here."}
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
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      void act({ type: "review", id: run.id, read: true, archived: !run.archived })
                    }
                  >
                    {run.archived ? <RotateCcwIcon /> : <ArchiveIcon />}
                    {run.archived ? "Restore" : "Archive"}
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
