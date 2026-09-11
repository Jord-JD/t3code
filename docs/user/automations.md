# Automations

Use Automations to run recurring work on your projects and review the results in normal T3 threads. Open Automations from the sidebar or command palette, then create a task with instructions, projects, a model, and a schedule. You can reference installed skills in the instructions.

Schedules support daily and weekly runs, hourly intervals, and custom RFC 5545 recurrence rules. Choose the time zone where the schedule should apply. For example, `FREQ=MONTHLY;BYMONTHDAY=1;BYHOUR=9;BYMINUTE=0` runs at 9 am on the first of each month. Minute-based rules are also supported. Pause a task to stop its schedule; Run now still lets you test it.

The host computer must be awake with the T3 server running. Your browser does not need to stay open. After downtime, a missed schedule runs once, rather than replaying every missed occurrence. An automation does not start another run while its previous run is still active. Unfinished runs are marked interrupted after a server restart; review their threads before retrying.

Choose an isolated worktree to keep Git changes separate from your checkout. Non-Git projects run in the project directory. Local execution can modify files you are editing. You can also select an existing thread in local mode to reuse its conversation. Busy threads are left alone and the run reports an error.

Runs use the selected provider and permissions. Approval requests wait in the run's thread. Review results in Inbox, archive results you have finished with, or restore them from Archived. Runs that explicitly report no findings are archived automatically. Archiving a result preserves its thread and worktree; manage those from the thread when you no longer need them. The inbox shows the most recent 500 runs.

You can ask an agent to create, update, pause, resume, or delete an automation from a chat. These tools operate on the current project and let you choose the model, reasoning options, and permissions. New tasks default to Full access permissions and inherit the thread's model when you do not specify one; edits preserve the saved settings. Event-based triggers and hosted execution while your T3 server is offline are not supported.
