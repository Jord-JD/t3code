import { WS_METHODS } from "@t3tools/contracts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "@t3tools/client-runtime/state/runtime";
import { connectionAtomRuntime } from "../connection/runtime";

export const automationSnapshot = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "automations:list",
  tag: WS_METHODS.automationsList,
  refreshIntervalMs: 5_000,
  staleTimeMs: 0,
});
export const automationAction = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "automations:action",
  tag: WS_METHODS.automationsAction,
});
