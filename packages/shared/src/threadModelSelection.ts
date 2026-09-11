import {
  isProviderDriverKind,
  type ModelSelection,
  type OrchestrationThreadShell,
  type ServerProvider,
} from "@t3tools/contracts";

export function getStartedThreadModelChangeBlockReason(input: {
  providers: ReadonlyArray<Pick<ServerProvider, "instanceId" | "requiresNewThreadForModelChange">>;
  hasStartedSession: boolean;
  currentModelSelection: ModelSelection;
  currentProviderInstanceId?: ModelSelection["instanceId"] | null | undefined;
  nextModelSelection: ModelSelection;
}): { title: string; description: string } | null {
  if (!input.hasStartedSession) {
    return null;
  }
  const currentModelSelection = {
    ...input.currentModelSelection,
    instanceId: input.currentProviderInstanceId ?? input.currentModelSelection.instanceId,
  };
  if (
    currentModelSelection.instanceId === input.nextModelSelection.instanceId &&
    currentModelSelection.model === input.nextModelSelection.model
  ) {
    return null;
  }
  const currentProvider = input.providers.find(
    (snapshot) => snapshot.instanceId === currentModelSelection.instanceId,
  );
  const nextProvider = input.providers.find(
    (snapshot) => snapshot.instanceId === input.nextModelSelection.instanceId,
  );
  if (
    currentProvider?.requiresNewThreadForModelChange !== true &&
    nextProvider?.requiresNewThreadForModelChange !== true
  ) {
    return null;
  }
  return {
    title: "Start a new chat to change models",
    description: "This provider does not allow switching models after a conversation has started.",
  };
}

/** Check a continuation against the target thread, including imported history without a session. */
export function getThreadModelSelectionDisabledReason(
  thread: Pick<
    OrchestrationThreadShell,
    "modelSelection" | "session" | "latestTurn" | "latestUserMessageAt"
  > | null,
  providers: ReadonlyArray<
    Pick<
      ServerProvider,
      "instanceId" | "driver" | "continuation" | "requiresNewThreadForModelChange"
    >
  >,
  nextModelSelection: ModelSelection,
): string | null {
  if (!thread || !(thread.session || thread.latestTurn || thread.latestUserMessageAt)) return null;
  const currentInstanceId = thread.session?.providerInstanceId ?? thread.modelSelection.instanceId;
  const currentProvider = providers.find((provider) => provider.instanceId === currentInstanceId);
  const nextProvider = providers.find(
    (provider) => provider.instanceId === nextModelSelection.instanceId,
  );
  const driver =
    thread.session?.providerName ??
    currentProvider?.driver ??
    (isProviderDriverKind(currentInstanceId) ? currentInstanceId : null);
  if (nextModelSelection.instanceId !== currentInstanceId) {
    if (!nextProvider || !driver || nextProvider.driver !== driver) {
      return "Start a new thread to use a different provider.";
    }
    if (
      thread.session?.providerInstanceId &&
      currentProvider?.continuation?.groupKey &&
      currentProvider.continuation.groupKey !== nextProvider.continuation?.groupKey
    ) {
      return "Start a new thread to use an incompatible provider instance.";
    }
  }
  const reason = getStartedThreadModelChangeBlockReason({
    providers,
    hasStartedSession: thread.session !== null,
    currentModelSelection: thread.modelSelection,
    currentProviderInstanceId: currentInstanceId,
    nextModelSelection,
  });
  return reason ? `${reason.description} Start a new thread to use this model.` : null;
}
