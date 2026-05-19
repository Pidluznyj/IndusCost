import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

export const NOMUS_MAINTENANCE_LOAD_ERROR_MESSAGE =
  "Não foi possível carregar esta análise agora. Tente novamente ou consulte o diagnóstico técnico.";

type NomusMaintenanceErrorCardProps = {
  title?: string;
  message?: string;
  onRetry?: () => void;
  retryLabel?: string;
};

export const NomusMaintenanceErrorCard: React.FC<NomusMaintenanceErrorCardProps> = ({
  title = "Análise indisponível",
  message = NOMUS_MAINTENANCE_LOAD_ERROR_MESSAGE,
  onRetry,
  retryLabel = "Tentar novamente",
}) => (
  <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 space-y-2">
    <p className="text-xs font-bold text-amber-950 flex items-center gap-1.5">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      {title}
    </p>
    <p className="text-[11px] text-amber-900 leading-relaxed">{message}</p>
    {onRetry ? (
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-primary hover:underline"
      >
        <RefreshCw className="h-3 w-3" />
        {retryLabel}
      </button>
    ) : null}
  </div>
);
