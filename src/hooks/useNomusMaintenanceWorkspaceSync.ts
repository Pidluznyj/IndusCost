import { useCallback, useEffect } from "react";
import type { NomusParentCodeOption } from "@/src/lib/nomusParentCodeOptionsTypes";
import type {
  NomusMaintenanceWorkspaceProps,
  NomusWorkspaceParentSelection,
} from "@/src/lib/nomusMaintenanceWorkspaceTypes";

type UseNomusMaintenanceWorkspaceSyncArgs = NomusMaintenanceWorkspaceProps & {
  setLocalCode: (code: string) => void;
};

export function useNomusMaintenanceWorkspaceSync({
  selectedParentCode,
  selectedParentDescription,
  selectedIndusProductId,
  onWorkspaceParentChange,
  setLocalCode,
}: UseNomusMaintenanceWorkspaceSyncArgs) {
  useEffect(() => {
    if (selectedParentCode !== undefined) {
      setLocalCode(selectedParentCode);
    }
  }, [selectedParentCode, setLocalCode]);

  const reportWorkspaceSelection = useCallback(
    (code: string, option?: NomusParentCodeOption) => {
      if (!onWorkspaceParentChange) return;
      const trimmed = code.trim();
      if (!trimmed) {
        onWorkspaceParentChange(null);
        return;
      }
      const selection: NomusWorkspaceParentSelection = {
        parentCode: trimmed,
        parentDescription: option?.parentDescription ?? selectedParentDescription ?? null,
        indusProductId: option?.indusProductId ?? selectedIndusProductId ?? null,
        option: option ?? null,
      };
      onWorkspaceParentChange(selection);
    },
    [onWorkspaceParentChange, selectedParentDescription, selectedIndusProductId]
  );

  return { reportWorkspaceSelection };
}
