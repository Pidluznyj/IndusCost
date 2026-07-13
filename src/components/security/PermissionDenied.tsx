import React from "react";
import { ShieldOff } from "lucide-react";
import { cn } from "@/src/lib/utils";

type Props = {
  title?: string;
  message?: string;
  className?: string;
  testId?: string;
};

export function PermissionDenied({
  title = "Acesso negado",
  message = "Você não tem permissão para acessar este conteúdo.",
  className,
  testId = "permission-denied",
}: Props) {
  return (
    <div
      className={cn(
        "flex flex-col items-start gap-2 rounded-lg border border-border bg-muted/40 px-4 py-6 text-sm text-muted-foreground",
        className
      )}
      role="status"
      data-testid={testId}
    >
      <div className="flex items-center gap-2 text-foreground">
        <ShieldOff className="h-4 w-4 shrink-0" aria-hidden />
        <p className="font-semibold">{title}</p>
      </div>
      <p>{message}</p>
    </div>
  );
}
