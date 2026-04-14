import React from "react";
import { BarChart3 } from "lucide-react";

export function ContextualDashboardEmpty({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-muted/30 px-8 py-16 text-center">
      <BarChart3 className="h-10 w-10 text-muted-foreground mb-4 opacity-60" />
      <p className="text-sm font-medium text-foreground max-w-md">{message}</p>
    </div>
  );
}
