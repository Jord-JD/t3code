import type { RuntimeMode } from "@t3tools/contracts";
import { LockIcon, LockOpenIcon, PenLineIcon, SparklesIcon, type LucideIcon } from "lucide-react";
import { Select, SelectItem, SelectPopup, SelectValue } from "../ui/select";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ComposerSelectControl, ComposerControlIcon } from "./ComposerControl";
import { composerFloatingLayerProps } from "./composerEventScope";
import { useComposerMenuState } from "./useComposerMenuState";

const runtimeModeConfig: Record<
  RuntimeMode,
  { label: string; description: string; icon: LucideIcon }
> = {
  "approval-required": {
    label: "Supervised",
    description: "Ask before commands and file changes.",
    icon: LockIcon,
  },
  "auto-accept-edits": {
    label: "Auto-accept edits",
    description: "Auto-approve edits, ask before other actions.",
    icon: PenLineIcon,
  },
  auto: {
    label: "Auto",
    description: "Supported providers approve routine actions; others still ask.",
    icon: SparklesIcon,
  },
  "full-access": {
    label: "Full access",
    description: "Allow commands and edits without prompts.",
    icon: LockOpenIcon,
  },
};

const runtimeModeOptions = Object.keys(runtimeModeConfig) as RuntimeMode[];

export function RuntimeModePicker(props: {
  runtimeMode: RuntimeMode;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
  size?: "sm" | "xs";
  hidden?: boolean | undefined;
}) {
  const size = props.size ?? "sm";
  const [open, setOpen] = useComposerMenuState(props.hidden);
  const runtimeModeOption = runtimeModeConfig[props.runtimeMode];
  const RuntimeModeIcon = runtimeModeOption.icon;
  return (
    <Tooltip>
      <Select
        open={open}
        onOpenChange={setOpen}
        value={props.runtimeMode}
        onValueChange={(value) => props.onRuntimeModeChange(value!)}
      >
        <TooltipTrigger
          render={
            <ComposerSelectControl
              size={size}
              className={size === "xs" ? undefined : "font-medium"}
              aria-label="Runtime mode"
            />
          }
        >
          <ComposerControlIcon icon={RuntimeModeIcon} size={size} />
          <SelectValue>{runtimeModeOption.label}</SelectValue>
        </TooltipTrigger>
        <SelectPopup alignItemWithTrigger={false} {...composerFloatingLayerProps}>
          {runtimeModeOptions.map((mode) => {
            const option = runtimeModeConfig[mode];
            const OptionIcon = option.icon;
            return (
              <SelectItem key={mode} value={mode} hideIndicator className="min-w-64 py-2">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="grid min-w-0 flex-1 gap-0.5">
                    <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                      <OptionIcon className="size-3.5 shrink-0 text-muted-foreground" />
                      {option.label}
                    </span>
                    <span className="text-muted-foreground text-xs leading-4">
                      {option.description}
                    </span>
                  </div>
                </div>
              </SelectItem>
            );
          })}
        </SelectPopup>
      </Select>
      <TooltipPopup side="top">{runtimeModeOption.description}</TooltipPopup>
    </Tooltip>
  );
}
