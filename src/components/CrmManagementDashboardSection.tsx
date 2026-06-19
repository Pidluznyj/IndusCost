import React from "react";
import { LayoutDashboard, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/src/lib/utils";
import type { ManagementDashboardResponse } from "@/src/components/crmManagementTypes";
import type { ManagementKpiCard } from "@/src/components/crmManagementUi";

type ManagementListPanelProps = {
  title: string;
  description?: string;
  emptyMessage: string;
  isEmpty: boolean;
  children: React.ReactNode;
};

export const ManagementListPanel: React.FC<ManagementListPanelProps> = ({
  title,
  description,
  emptyMessage,
  isEmpty,
  children,
}) => (
  <div className="rounded-2xl border border-border bg-card shadow-sm flex flex-col min-h-[200px] max-h-[320px]">
    <div className="px-4 pt-4 pb-2 shrink-0 border-b border-border/60">
      <p className="text-sm font-bold text-foreground">{title}</p>
      {description ? <p className="text-xs text-muted-foreground mt-0.5">{description}</p> : null}
    </div>
    <div className="flex-1 overflow-y-auto px-2 py-2 min-h-0">
      {isEmpty ? (
        <p className="text-xs text-muted-foreground italic px-2 py-4">{emptyMessage}</p>
      ) : (
        children
      )}
    </div>
  </div>
);

export type CrmManagementDashboardSectionProps = {
  data: ManagementDashboardResponse | null;
  loading: boolean;
  error: string | null;
  kpiCards: ManagementKpiCard[];
  onReload: () => void;
  children: React.ReactNode;
  formatDateTimePt: (iso: string | null | undefined) => string;
};

export const CrmManagementDashboardSection: React.FC<CrmManagementDashboardSectionProps> = ({
  data,
  loading,
  error,
  kpiCards,
  onReload,
  children,
  formatDateTimePt,
}) => (
  <section className="space-y-6" aria-labelledby="crm-management-heading">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-primary/10 p-2.5 text-primary shrink-0">
          <LayoutDashboard className="h-5 w-5" />
        </div>
        <div>
          <h3 id="crm-management-heading" className="text-lg font-bold text-foreground">
            Gestão Comercial
          </h3>
          <p className="text-sm text-muted-foreground mt-0.5 max-w-2xl">
            Visão executiva da operação comercial: KPIs agregados, rankings, alertas e indicadores de
            gestão.
          </p>
          {data?.generatedAt ? (
            <p className="text-[11px] text-muted-foreground mt-1.5">
              Atualizado em {formatDateTimePt(data.generatedAt)}
            </p>
          ) : null}
        </div>
      </div>
      {!loading ? (
        <button
          type="button"
          onClick={onReload}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-accent hover:text-foreground shrink-0"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Atualizar
        </button>
      ) : null}
    </div>

    {loading ? (
      <div className="flex items-center gap-2 text-sm text-muted-foreground rounded-2xl border border-dashed border-border bg-muted/20 px-4 py-8">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando gestão comercial…
      </div>
    ) : error ? (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900 space-y-3">
        <p>{error}</p>
        <button
          type="button"
          onClick={onReload}
          className="inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-50"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Tentar novamente
        </button>
      </div>
    ) : data ? (
      <div className="space-y-8">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {kpiCards.map((card) => {
            const Icon = card.icon;
            return (
              <div
                key={card.label}
                className={cn(
                  "rounded-2xl border p-4 shadow-sm flex flex-col gap-2.5 min-h-[118px]",
                  card.cardClass
                )}
              >
                <div className={cn("rounded-lg p-2 w-fit shrink-0", card.iconClass)}>
                  <Icon className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-2xl font-bold tabular-nums leading-none text-foreground">{card.value}</p>
                  <p className="text-xs font-semibold text-foreground mt-2 leading-snug">{card.label}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{card.description}</p>
                </div>
              </div>
            );
          })}
        </div>
        {children}
      </div>
    ) : null}
  </section>
);
