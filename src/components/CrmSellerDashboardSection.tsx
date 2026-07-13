import React from "react";
import { Briefcase, CalendarRange, Loader2, RefreshCw, Users } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { ExecutiveSummarySection } from "@/src/components/ui/ExecutiveSummarySection";
import { FinanceExecutiveTotalizerCard } from "@/src/components/finance/shared/FinanceExecutiveTotalizerCard";
import { SYSTEM_TOTALIZER_GRID_CLASS } from "@/src/components/ui/SystemTotalizerCard";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";
import type { SellerDashboardResponse, SellerOption } from "@/src/components/crmSellerDashboardTypes";
import type { SellerKpiCard, SellerPeriodPreset } from "@/src/components/crmSellerDashboardUi";
import {
  SELLER_KEY_ALL,
  SELLER_PERIOD_PRESET_OPTIONS,
  buildSellerOptionKey,
  formatSellerOptionDetail,
  formatSellerOptionLabel,
} from "@/src/components/crmSellerDashboardUi";
import {
  CRM_SELLER_TAB_SUBTITLE,
  CRM_UI_TOOLTIPS,
  resolveCrmSellerEmptyKind,
} from "@/src/components/crm/crmCommercialUiConcepts";
import {
  CrmCommercialAuditStrip,
  CrmCommercialSourceInfoNote,
} from "@/src/components/crm/CrmCommercialSourceInfoNote";

export type CrmSellerDashboardSectionProps = {
  data: SellerDashboardResponse | null;
  loading: boolean;
  error: string | null;
  kpiCards: SellerKpiCard[];
  showSellerFilter: boolean;
  ownScopeOnly: boolean;
  sellerNotLinked: boolean;
  sellerOptions: SellerOption[];
  selectedSellerKey: string;
  onSellerChange: (key: string) => void;
  periodPreset: SellerPeriodPreset;
  onPeriodPresetChange: (preset: SellerPeriodPreset) => void;
  dateFrom: string;
  dateTo: string;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
  onApplyCustomPeriod: () => void;
  onReload: () => void;
  onOpenPortfolio?: () => void;
  formatDateTimePt: (iso: string | null | undefined) => string;
  formatNumberPt?: (v: number | null | undefined) => string;
  sellerDisplayName?: string | null;
  children: React.ReactNode;
};

export const CrmSellerDashboardSection: React.FC<CrmSellerDashboardSectionProps> = ({
  data,
  loading,
  error,
  kpiCards,
  showSellerFilter,
  ownScopeOnly,
  sellerNotLinked,
  sellerOptions,
  selectedSellerKey,
  onSellerChange,
  periodPreset,
  onPeriodPresetChange,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  onApplyCustomPeriod,
  onReload,
  onOpenPortfolio,
  formatDateTimePt,
  formatNumberPt,
  sellerDisplayName,
  children,
}) => {
  const isCustomPeriod = periodPreset === "custom";
  const headingTitle = ownScopeOnly ? "Minha Gestão Comercial" : "Gestão por Responsável";
  const dashboardSubtitle = sellerDisplayName
    ? `Carteira de: ${sellerDisplayName}`
    : ownScopeOnly
      ? "Meu dashboard"
      : "Visão consolidada por responsável comercial";

  const fmt = formatNumberPt ?? ((v: number | null | undefined) => String(v ?? 0));
  const emptyKind = resolveCrmSellerEmptyKind({
    sellerNotLinked,
    loading,
    error,
    hasData: Boolean(data),
    emptyStateReason: data?.emptyStateReason ?? null,
    totalOrders: data?.totalOrders ?? data?.summary?.ordersCount ?? null,
    customerCount: data?.selectedCommercialOwner?.customerCount ?? null,
  });

  const auditMetrics =
    data && emptyKind === "ready"
      ? [
          {
            key: "no-nomus",
            label: "Pedidos sem vendedor no Nomus",
            value: fmt(data.ordersWithoutNomusSeller ?? data.summary.ordersWithoutNomusSeller),
            hint: CRM_UI_TOOLTIPS.orderSeller,
          },
          {
            key: "divergence",
            label: "Pedidos com responsável ≠ vendedor do pedido",
            value: fmt(
              data.ordersWithDifferentNomusSeller ?? data.summary.ordersWithDifferentNomusSeller
            ),
            hint: "O pedido permanece na carteira do responsável comercial; o vendedor Nomus é só auditoria/comissão.",
          },
          {
            key: "customers",
            label: "Clientes na carteira do responsável",
            value: fmt(data.selectedCommercialOwner?.customerCount ?? data.customersWithOrders),
            hint: CRM_UI_TOOLTIPS.commercialOwner,
          },
        ]
      : [];

  if (sellerNotLinked) {
    return (
      <section className="space-y-6" aria-labelledby="crm-seller-heading">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-primary/10 p-2.5 text-primary shrink-0">
            <Briefcase className="h-5 w-5" />
          </div>
          <div>
            <h3 id="crm-seller-heading" className="text-lg font-bold text-foreground">
              {headingTitle}
            </h3>
            <p className="text-sm text-muted-foreground mt-2 max-w-2xl">
              Seu usuário ainda não está vinculado a um responsável comercial. Solicite ajuste ao
              administrador.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-6" aria-labelledby="crm-seller-heading">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-primary/10 p-2.5 text-primary shrink-0">
              <Briefcase className="h-5 w-5" />
            </div>
            <div>
              <h3 id="crm-seller-heading" className="text-lg font-bold text-foreground">
                {headingTitle}
              </h3>
              <p className="text-sm text-muted-foreground mt-0.5 max-w-2xl">
                {CRM_SELLER_TAB_SUBTITLE}
              </p>
              <p className="text-sm font-medium text-foreground mt-1">{dashboardSubtitle}</p>
              {ownScopeOnly ? (
                <p className="text-[11px] text-muted-foreground mt-2 max-w-2xl italic">
                  Você está visualizando apenas os dados vinculados ao seu usuário.
                </p>
              ) : null}
              {data?.generatedAt ? (
                <p className="text-[11px] text-muted-foreground mt-1.5">
                  Atualizado em {formatDateTimePt(data.generatedAt)}
                </p>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            {onOpenPortfolio ? (
              <button
                type="button"
                onClick={onOpenPortfolio}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-xs font-semibold text-primary hover:bg-primary/15"
              >
                <Users className="h-3.5 w-3.5" />
                Carteira de clientes
              </button>
            ) : null}
            {!loading ? (
              <button
                type="button"
                onClick={onReload}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Atualizar
              </button>
            ) : null}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 shadow-sm space-y-4">
          <div
            className={cn(
              "grid gap-4 sm:grid-cols-2",
              showSellerFilter ? "xl:grid-cols-4" : "xl:grid-cols-2"
            )}
          >
            {showSellerFilter ? (
              <div className="sm:col-span-2 xl:col-span-2">
                <label
                  htmlFor="crm-seller-filter"
                  className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                  title={CRM_UI_TOOLTIPS.commercialOwner}
                >
                  Responsável comercial da carteira
                </label>
                <select
                  id="crm-seller-filter"
                  value={selectedSellerKey}
                  onChange={(e) => onSellerChange(e.target.value)}
                  disabled={loading || sellerOptions.length === 0}
                  className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25"
                  title={CRM_UI_TOOLTIPS.commercialOwner}
                >
                  <option value={SELLER_KEY_ALL}>Todos os responsáveis (visão geral)</option>
                  {sellerOptions.map((opt) => {
                    const key = buildSellerOptionKey(opt);
                    const detail = formatSellerOptionDetail(opt);
                    const label = formatSellerOptionLabel(opt);
                    return (
                      <option key={key} value={key} title={detail ?? undefined}>
                        {label}
                      </option>
                    );
                  })}
                </select>
              </div>
            ) : null}

            <div className="sm:col-span-2 xl:col-span-2">
              <label
                htmlFor="crm-seller-period"
                className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
              >
                Período
              </label>
              <select
                id="crm-seller-period"
                value={periodPreset}
                onChange={(e) => onPeriodPresetChange(e.target.value as SellerPeriodPreset)}
                disabled={loading}
                className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25"
              >
                {SELLER_PERIOD_PRESET_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {isCustomPeriod ? (
              <>
                <div>
                  <label
                    htmlFor="crm-seller-date-from"
                    className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    Data inicial
                  </label>
                  <input
                    id="crm-seller-date-from"
                    type="date"
                    value={dateFrom}
                    onChange={(e) => onDateFromChange(e.target.value)}
                    disabled={loading}
                    className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25"
                  />
                </div>
                <div>
                  <label
                    htmlFor="crm-seller-date-to"
                    className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    Data final
                  </label>
                  <input
                    id="crm-seller-date-to"
                    type="date"
                    value={dateTo}
                    onChange={(e) => onDateToChange(e.target.value)}
                    disabled={loading}
                    className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25"
                  />
                </div>
              </>
            ) : null}
          </div>

          {isCustomPeriod ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onApplyCustomPeriod}
                disabled={loading || !dateFrom.trim() || !dateTo.trim()}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                <CalendarRange className="h-3.5 w-3.5" />
                Aplicar período
              </button>
            </div>
          ) : null}

          {(data?.filters?.externalSellerId !== null &&
            data?.filters?.externalSellerId !== undefined) ||
          data?.filters?.responsible ||
          data?.filters?.sellerIdentityKey ||
          data?.filters?.dateFrom ||
          data?.filters?.dateTo ? (
            <p className="text-[10px] text-muted-foreground">
              Filtros ativos:
              {data?.selectedCommercialOwner?.label
                ? ` ${data.selectedCommercialOwner.label}`
                : data?.filters?.sellerIdentityKey
                  ? ` ${data.filters.sellerIdentityKey}`
                  : data?.filters?.externalSellerId !== null &&
                      data?.filters?.externalSellerId !== undefined
                    ? ` ID ${data.filters.externalSellerId}`
                    : ""}
              {data?.filters?.dateFrom || data?.filters?.dateTo
                ? ` · período ${data.filters.dateFrom ?? "…"} a ${data.filters.dateTo ?? "…"}`
                : ""}
            </p>
          ) : null}
        </div>

        <CrmCommercialSourceInfoNote sourceInfo={data?.sourceInfo} />
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground rounded-2xl border border-dashed border-border bg-muted/20 px-4 py-8">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando gestão por responsável…
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
      ) : data && emptyKind === "no_customers_for_owner" ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-8 space-y-2">
          <p className="text-sm font-semibold text-foreground">
            Nenhum cliente sob esta responsabilidade
          </p>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Não há clientes com este responsável comercial atribuído. Os indicadores zerados
            refletem ausência de carteira — não um erro de cálculo.
          </p>
          <CrmCommercialSourceInfoNote sourceInfo={data.sourceInfo} showOfficialNote={false} />
        </div>
      ) : data && emptyKind === "no_orders_in_period" ? (
        <div className="space-y-6">
          <div className="rounded-xl border border-sky-200/80 bg-sky-50/60 px-4 py-3 text-sm text-sky-950">
            Há{" "}
            <span className="font-semibold">
              {fmt(data.selectedCommercialOwner?.customerCount)}
            </span>{" "}
            cliente(s) na carteira deste responsável, mas nenhum pedido na fonte oficial no período
            selecionado.
          </div>
          <ExecutiveSummarySection
            title="Resumo do responsável"
            eyebrow="Indicadores do período e escopo selecionado"
            testId="crm-seller-kpi-summary"
          >
            <SummaryKpiGrid minColumnWidth={200} className={SYSTEM_TOTALIZER_GRID_CLASS}>
              {kpiCards.map((card) => {
                const Icon = card.icon;
                return (
                  <FinanceExecutiveTotalizerCard
                    key={card.label}
                    label={card.label}
                    value={card.value}
                    helperText={card.description}
                    tone="neutral"
                    icon={Icon}
                  />
                );
              })}
            </SummaryKpiGrid>
          </ExecutiveSummarySection>
          <CrmCommercialAuditStrip metrics={auditMetrics} />
          {children}
        </div>
      ) : data ? (
        <div className="space-y-8">
          <ExecutiveSummarySection
            title="Resumo do responsável"
            eyebrow="Indicadores do período e escopo selecionado"
            testId="crm-seller-kpi-summary"
          >
            <SummaryKpiGrid minColumnWidth={200} className={SYSTEM_TOTALIZER_GRID_CLASS}>
              {kpiCards.map((card) => {
                const Icon = card.icon;
                return (
                  <FinanceExecutiveTotalizerCard
                    key={card.label}
                    label={card.label}
                    value={card.value}
                    helperText={card.description}
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
