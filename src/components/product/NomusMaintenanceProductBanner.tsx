import React from "react";
import { Package } from "lucide-react";

type NomusMaintenanceProductBannerProps = {
  parentCode?: string;
  description?: string | null;
  compact?: boolean;
};

export const NomusMaintenanceProductBanner: React.FC<NomusMaintenanceProductBannerProps> = ({
  parentCode,
  description,
  compact = false,
}) => {
  const code = parentCode?.trim();
  if (!code) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-3 text-center">
        <p className="text-sm text-muted-foreground">
          Selecione um produto no topo para iniciar a manutenção Nomus.
        </p>
      </div>
    );
  }

  return (
    <div
      className={
        compact
          ? "rounded-lg border border-border/80 bg-background px-3 py-2 flex flex-wrap items-center gap-2"
          : "rounded-lg border border-primary/20 bg-primary/5 px-4 py-2.5 flex flex-wrap items-start gap-2"
      }
    >
      <Package className="h-4 w-4 text-primary shrink-0 mt-0.5" />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">
          Produto em análise: <span className="font-bold">{code}</span>
        </p>
        {description && !compact ? (
          <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">{description}</p>
        ) : null}
      </div>
    </div>
  );
};
