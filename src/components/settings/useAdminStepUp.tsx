import React, { useRef, useState } from "react";
import { AdminStepUpDialog } from "@/src/components/settings/AdminStepUpDialog";
import { isAdminElevationRequired } from "@/src/lib/adminElevationClient";

export function useAdminStepUp() {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const retryRef = useRef<(() => Promise<void>) | null>(null);

  const run = async (fn: () => Promise<void>): Promise<boolean> => {
    try {
      await fn();
      return true;
    } catch (error) {
      if (isAdminElevationRequired(error)) {
        retryRef.current = fn;
        setOpen(true);
        return false;
      }
      throw error;
    }
  };

  const dialog = (
    <AdminStepUpDialog
      open={open}
      onClose={() => {
        setOpen(false);
        retryRef.current = null;
      }}
      onConfirmed={(message) => {
        const retry = retryRef.current;
        retryRef.current = null;
        setOpen(false);
        setNotice(message);
        if (retry) {
          void retry().catch((error) => {
            if (isAdminElevationRequired(error)) {
              retryRef.current = retry;
              setOpen(true);
              return;
            }
            console.error("Falha após confirmação administrativa:", error);
          });
        }
      }}
    />
  );

  return {
    run,
    dialog,
    notice,
    clearNotice: () => setNotice(null),
  };
}
