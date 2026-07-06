import React from "react";
import { financeBiShellClass } from "@/src/lib/financeBiDashboardTheme";
import { cn } from "@/src/lib/utils";

export function FinanceBiDashboardShell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn(financeBiShellClass, className)}>{children}</div>;
}
