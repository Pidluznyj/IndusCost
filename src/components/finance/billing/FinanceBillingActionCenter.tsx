import React, { useMemo } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Scale, TrendingDown } from "lucide-react";
import type { BillingDashboardTab } from "@/src/lib/executiveDashboardTypes";
import type { BillingAuditResult } from "@/src/lib/financeBillingAuditTypes";
import {
  buildFinanceBillingActionItems,
  type FinanceBillingActionItem,
  type FinanceBillingActionSeverity,
} from "@/src/lib/financeBillingActions";
import type { FinanceBillingComparisonPayload } from "@/src/lib/financeBillingNfeComparison";
import { FinanceActionCenterShell } from "@/src/components/finance/shared/FinanceActionCenterShell";
import { cn } from "@/src/lib/utils";

function severityStyles(severity: FinanceBillingActionSeverity) {
  if (severity === "critical") {
    return {
      border: "border-l-4 border-l-red-500",
      icon: "text-red-500",
      badge: "bg-red-100 text-red-800",
    };
  }
  if (severity === "warning") {
    return {
      border: "border-l-4 border-l-amber-400",
      icon: "text-amber-500",
      badge: "bg-amber-100 text-amber-800",
    };
  }
  return {
    border: "border-l-4 border-l-blue-400",
    icon: "text-blue-500",
    badge: "bg-blue-100 text-blue-800",
  };
}

function ActionIcon({ item }: { item: FinanceBillingActionItem }) {
  if (item.id.includes("divergence")) return <Scale className="h-4 w-4" />;
  if (item.id.includes("cancelled") || item.id.includes("excluded")) {
    return <AlertTriangle className="h-4 w-4" />;
  }
  if (item.id.includes("below")) return <TrendingDown className="h-4 w-4" />;
  return <AlertTriangle className="h-4 w-4" />;
}

export function FinanceBillingActionCenter({
  tab,
  comparison,
  audit,
  loading,
}: {
  tab?: BillingDashboardTab | null;
  comparison?: FinanceBillingComparisonPayload | null;
  audit?: BillingAuditResult | null;
  loading?: boolean;
}) {
  const items = useMemo(
    () => buildFinanceBillingActionItems({ tab, comparison, audit }),
    [tab, comparison, audit]
  );

  return (
    <FinanceActionCenterShell
      title="Centro de Ações"
      subtitle="Alertas fiscais, divergências e concentração — filtros aplicados"
      badgeCount={items.length}
    >
      {loading ? (
        <div className="p-5 flex items-center gap-3">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Carregando alertas…</span>
        </div>
      ) : items.length === 0 ? (
        <div className="p-6 flex flex-col items-center gap-2 text-center">
          <CheckCircle2 className="h-8 w-8 text-green-500" />
          <p className="text-sm font-semibold text-foreground">Nenhum alerta prioritário.</p>
          <p className="text-[11px] text-muted-foreground">
            Faturamento fiscal coerente com os filtros atuais.
          </p>
        </div>
      ) : (
        items.map((item) => {
          const styles = severityStyles(item.severity);
          return (
            <div
              key={item.id}
              className={cn("px-4 py-3 flex items-start gap-3 bg-white dark:bg-card", styles.border)}
            >
              <span className={cn("mt-0.5 shrink-0", styles.icon)}>
                <ActionIcon item={item} />
              </span>
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="text-xs font-bold text-foreground leading-snug">{item.title}</p>
                <p className="text-[11px] text-muted-foreground leading-snug">{item.description}</p>
              </div>
              {item.value ? (
                <span
                  className={cn(
                    "shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold",
                    styles.badge
                  )}
                >
                  {item.value}
                </span>
              ) : null}
            </div>
          );
        })
      )}
    </FinanceActionCenterShell>
  );
}
