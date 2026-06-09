import React from "react";
import { controlRoomShellClass } from "@/src/lib/financeControlRoomTheme";
import { cn } from "@/src/lib/utils";

export function FinanceCashFlowShell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div data-testid="cash-flow-page" className={cn(controlRoomShellClass, className)}>
      {children}
    </div>
  );
}
