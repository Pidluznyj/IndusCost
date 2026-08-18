import React from "react";
import { LayoutDashboard, Loader2, RefreshCw } from "lucide-react";
import { ExecutiveSummarySection } from "@/src/components/ui/ExecutiveSummarySection";
import { FinanceExecutiveTotalizerCard } from "@/src/components/finance/shared/FinanceExecutiveTotalizerCard";
import { SYSTEM_TOTALIZER_GRID_CLASS } from "@/src/components/ui/SystemTotalizerCard";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";
import type { ManagementDashboardResponse } from "@/src/components/crmManagementTypes";
import type { ManagementKpiCard } from "@/src/components/crmManagementUi";
import { CRM_UI_TOOLTIPS } from "@/src/components/crm/crmCommercialUiConcepts";
import {
  CrmCommercialAuditStrip,
  CrmCommercialSourceInfoNote,
} from "@/src/components/crm/CrmCommercialSourceInfoNote";

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

/**
 * Prefixo do rodapé de cada card. O gestor precisa saber, olhando, o que
 * pode ser conferido contra a tela Pedidos de Venda e o que é métrica
 * própria do CRM — misturar as duas classes é o que gerava desconfiança.
 */
const KPI_CLASS_PREFIX: Record<string, string> = {
  TRANSACIONAL: "Pedidos de Venda (reconcilia no centavo)",
  RELACIONAMENTO: "CRM · relacionamento (janela móvel)",
};

const MONTH_OPTIONS = [
  { value: "", label: "Ano inteiro" },
  { value: "1", label: "Janeiro" },
  { value: "2", label: "Fevereiro" },
  { value: "3", label: "Março" },
  { value: "4", label: "Abril" },
  { value: "5", label: "Maio" },
  { value: "6", label: "Junho" },
  { value: "7", label: "Julho" },
  { value: "8", label: "Agosto" },
  { value: "9", label: "Setembro" },
  { value: "10", label: "Outubro" },
  { value: "11", label: "Novembro" },
  { value: "12", label: "Dezembro" },
] as const;

/** Recorte do cockpit — mesmo vocabulário da tela Pedidos de Venda. */
export type CrmManagementPeriodFilter = {
  /** Ano ("" = todos os anos). */
  year: string;
  /** Mês 1..12 ("" = ano inteiro). */
  month: string;
};

export type CrmManagementDashboardSectionProps = {
  data: ManagementDashboardResponse | null;
  loading: boolean;
  error: string | null;
  kpiCards: ManagementKpiCard[];
  onReload: () => void;
  children: React.ReactNode;
  formatDateTimePt: (iso: string | null | undefined) => string;
  formatNumberPt?: (v: number | null | undefined) => string;
  /** Filtro aplicado (estado do pai). Ausente = barra de período não aparece. */
  period?: CrmManagementPeriodFilter;
  onPeriodChange?: (next: CrmManagementPeriodFilter) => void;
  /** Anos disponíveis no seletor (default: ano atual e 4 anteriores). */
  yearOptions?: number[];
};

export const CrmManagementDashboardSection: React.FC<CrmManagementDashboardSectionProps> = ({
  data,
  loading,
  error,
  kpiCards,
  onReload,
  children,
  formatDateTimePt,
  formatNumberPt,
  period,
  onPeriodChange,
  yearOptions,
}) => {
  const fmt = formatNumberPt ?? ((v: number | null | undefined) => String(v ?? 0));
  const currentYear = new Date().getFullYear();
  const years = yearOptions ?? [0, 1, 2, 3, 4].map((offset) => currentYear - offset);
  const showPeriodBar = period != null && onPeriodChange != null;
  const auditMetrics = data
    ? [
        {
          key: "no-nomus",
          label: "Pedidos sem vendedor no Nomus",
          value: fmt(data.summary.ordersWithoutNomusSeller),
          hint: CRM_UI_TOOLTIPS.orderSeller,
        },
        {
          key: "no-owner",
          label: "Clientes sem responsável comercial",
          value: fmt(data.summary.customersWithoutCommercialResponsible),
          hint: CRM_UI_TOOLTIPS.commercialOwner,
        },
        {
          key: "divergence",
          label: "Pedidos com responsável ≠ vendedor do pedido",
          value: fmt(data.summary.ordersWithResponsibleDifferentFromOrderSeller),
          hint: "Entram na carteira do responsável comercial; Nomus permanece só para auditoria/comissão.",
        },
      ]
    : [];

  return (
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
              Visão executiva da operação comercial por responsável de carteira. Pedidos vêm da fonte
              oficial; o vendedor Nomus do pedido não redefine a carteira.
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

      {showPeriodBar ? (
        <div
          className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-muted/20 px-3 py-2.5"
          data-testid="crm-management-period-filter"
        >
          <label className="space-y-1">
            <span className="block text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              Ano
            </span>
            <select
              className="w-36 rounded-lg border border-border bg-background px-2 py-1.5 text-xs"
              value={period!.year}
              onChange={(e) => onPeriodChange!({ year: e.target.value, month: "" })}
              data-testid="crm-management-filter-year"
            >
              {years.map((year) => (
                <option key={year} value={String(year)}>
                  {year}
                </option>
              ))}
              <option value="">Todos os anos</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="block text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              Mês
            </span>
            <select
              className="w-40 rounded-lg border border-border bg-background px-2 py-1.5 text-xs disabled:opacity-50"
              value={period!.month}
              disabled={period!.year === ""}
              onChange={(e) => onPeriodChange!({ ...period!, month: e.target.value })}
              data-testid="crm-management-filter-month"
            >
              {MONTH_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {data?.sourceInfo?.period?.dateFrom ? (
            <p className="pb-1 text-[11px] text-muted-foreground">
              Pedidos de {data.sourceInfo.period.dateFrom} a {data.sourceInfo.period.dateTo} — mesmo
              recorte (data de emissão) da tela Pedidos de Venda.
            </p>
          ) : null}
        </div>
      ) : null}

      {data?.sourceInfo?.truncated ? (
        <div
          className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          data-testid="crm-management-truncated-warning"
        >
          <strong>Números subestimados.</strong> O período selecionado tem{" "}
          {fmt(data.sourceInfo.matchedOrderCount)} pedidos e o cockpit carregou só parte deles.
          Reduza o período (ano ou mês) para ver os totais completos.
        </div>
      ) : null}

      <CrmCommercialSourceInfoNote sourceInfo={data?.sourceInfo} />

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
          <ExecutiveSummarySection
            title="Resumo da gestão comercial"
            eyebrow={
              data.generatedAt
                ? `Atualizado em ${formatDateTimePt(data.generatedAt)}`
                : "Indicadores agregados da operação comercial"
            }
            testId="crm-management-kpi-summary"
          >
            <SummaryKpiGrid minColumnWidth={200} className={SYSTEM_TOTALIZER_GRID_CLASS}>
              {kpiCards.map((card) => {
                const Icon = card.icon;
                return (
                  <FinanceExecutiveTotalizerCard
                    key={card.label}
                    label={card.label}
                    value={card.value}
                    helperText={`${KPI_CLASS_PREFIX[card.kpiClass] ?? ""} — ${card.description}`}
                    tone={
                      card.cardClass?.includes("green")
                        ? "success"
                        : card.cardClass?.includes("red")
                          ? "danger"
                          : card.cardClass?.includes("amber")
                            ? "warning"
                            : card.cardClass?.includes("blue")
                              ? "info"
                              : "neutral"
                    }
                    icon={Icon}
                  />
                );
              })}
            </SummaryKpiGrid>
          </ExecutiveSummarySection>
          <CrmCommercialAuditStrip metrics={auditMetrics} />
          {children}
        </div>
      ) : null}
    </section>
  );
};
