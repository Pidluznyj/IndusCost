import React from "react";
import { Briefcase, CalendarRange, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/src/lib/utils";
import type { SellerDashboardResponse, SellerOption } from "@/src/components/crmSellerDashboardTypes";
import type { SellerKpiCard, SellerPeriodPreset } from "@/src/components/crmSellerDashboardUi";
import {
  SELLER_KEY_ALL,
  SELLER_PERIOD_PRESET_OPTIONS,
  buildSellerOptionKey,
  formatSellerOptionLabel,
} from "@/src/components/crmSellerDashboardUi";
import { CrmSellerSubTabs, type CrmSellerSubTabId } from "@/src/components/CrmSellerSubTabs";

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
  formatDateTimePt: (iso: string | null | undefined) => string;
  activeSubTab: CrmSellerSubTabId;
  onSubTabChange: (tab: CrmSellerSubTabId) => void;
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
  formatDateTimePt,
  activeSubTab,
  onSubTabChange,
  sellerDisplayName,
  children,
}) => {
  const isCustomPeriod = periodPreset === "custom";
  const headingTitle = ownScopeOnly ? "Minha Gestão Comercial" : "Gestão por Vendedor";
  const isDashboardTab = activeSubTab === "dashboard";
  const dashboardSubtitle = sellerDisplayName
    ? `Dashboard de: ${sellerDisplayName}`
    : ownScopeOnly
      ? "Meu dashboard"
      : "Meu dashboard";

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
              Seu usuário ainda não está vinculado a um vendedor Nomus. Solicite ajuste ao
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
                {isDashboardTab
                  ? "Resumo do desempenho comercial, atividades e oportunidades do vendedor."
                  : "Gerencie os clientes vinculados ao vendedor, acompanhe relacionamento, próximos contatos e oportunidades."}
              </p>
              {isDashboardTab ? (
                <p className="text-sm font-medium text-foreground mt-1">{dashboardSubtitle}</p>
              ) : null}
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

        <CrmSellerSubTabs
          activeTab={activeSubTab}
          onTabChange={onSubTabChange}
          ownScopeOnly={ownScopeOnly}
        />

        {isDashboardTab ? (
          <>
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
              >
                Vendedor / Responsável
              </label>
              <select
                id="crm-seller-filter"
                value={selectedSellerKey}
                onChange={(e) => onSellerChange(e.target.value)}
                disabled={loading || sellerOptions.length === 0}
                className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25"
              >
                <option value={SELLER_KEY_ALL}>Todos os vendedores (visão geral)</option>
                {sellerOptions.map((opt) => {
                  const key = buildSellerOptionKey(opt);
                  return (
                    <option key={key} value={key}>
                      {formatSellerOptionLabel(opt)} — {opt.ordersCount} ped. / {opt.proposalsCount}{" "}
                      prop.
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
          data?.filters?.dateFrom ||
          data?.filters?.dateTo ? (
            <p className="text-[10px] text-muted-foreground">
              Filtros ativos:
              {data?.filters?.externalSellerId !== null &&
              data?.filters?.externalSellerId !== undefined
                ? ` vendedor ID ${data.filters.externalSellerId}`
                : ""}
              {data?.filters?.responsible && !data?.filters?.externalSellerId
                ? ` ${data.filters.responsible}`
                : data?.filters?.responsible
                  ? ` · ${data.filters.responsible}`
                  : ""}
              {data?.filters?.dateFrom || data?.filters?.dateTo
                ? ` · período ${data.filters.dateFrom ?? "…"} a ${data.filters.dateTo ?? "…"}`
                : ""}
            </p>
          ) : null}
        </div>

            <p className="text-[11px] text-muted-foreground leading-relaxed rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5 max-w-3xl">
              Pedidos são filtrados pela data de emissão. Faturamento é filtrado pela data de
              processamento da NFe. Propostas são filtradas pela data de abertura.
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground max-w-2xl">
            Use a busca e os filtros abaixo para localizar clientes. O cockpit comercial abre ao
            selecionar um cliente na lista.
          </p>
        )}
      </div>

      {!isDashboardTab ? null : loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground rounded-2xl border border-dashed border-border bg-muted/20 px-4 py-8">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando gestão por vendedor…
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
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
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
                    <p className="text-2xl font-bold tabular-nums leading-none text-foreground">
                      {card.value}
                    </p>
                    <p className="text-xs font-semibold text-foreground mt-2 leading-snug">
                      {card.label}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                      {card.description}
                    </p>
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
};
