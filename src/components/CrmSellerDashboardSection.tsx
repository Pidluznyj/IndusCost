import React from "react";
import { Briefcase, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/src/lib/utils";
import type { SellerDashboardResponse, SellerOption } from "@/src/components/crmSellerDashboardTypes";
import type { SellerKpiCard } from "@/src/components/crmSellerDashboardUi";
import {
  SELLER_KEY_ALL,
  buildSellerOptionKey,
  formatSellerOptionLabel,
} from "@/src/components/crmSellerDashboardUi";

export type CrmSellerDashboardSectionProps = {
  data: SellerDashboardResponse | null;
  loading: boolean;
  error: string | null;
  kpiCards: SellerKpiCard[];
  sellerOptions: SellerOption[];
  selectedSellerKey: string;
  onSellerChange: (key: string) => void;
  onReload: () => void;
  formatDateTimePt: (iso: string | null | undefined) => string;
  children: React.ReactNode;
};

export const CrmSellerDashboardSection: React.FC<CrmSellerDashboardSectionProps> = ({
  data,
  loading,
  error,
  kpiCards,
  sellerOptions,
  selectedSellerKey,
  onSellerChange,
  onReload,
  formatDateTimePt,
  children,
}) => (
  <section className="space-y-6" aria-labelledby="crm-seller-heading">
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-primary/10 p-2.5 text-primary shrink-0">
            <Briefcase className="h-5 w-5" />
          </div>
          <div>
            <h3 id="crm-seller-heading" className="text-lg font-bold text-foreground">
              Gestão por Vendedor
            </h3>
            <p className="text-sm text-muted-foreground mt-0.5 max-w-2xl">
              Pedidos, faturamento Nomus (NFe) e propostas sem pedido vinculado por responsável.
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

      <div className="rounded-xl border border-border bg-card p-4 shadow-sm max-w-xl">
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
        {data?.filters?.externalSellerId !== null && data?.filters?.externalSellerId !== undefined ? (
          <p className="text-[10px] text-muted-foreground mt-2">
            Filtro ativo: ID {data.filters.externalSellerId}
            {data.filters.responsible ? ` · ${data.filters.responsible}` : ""}
          </p>
        ) : data?.filters?.responsible ? (
          <p className="text-[10px] text-muted-foreground mt-2">
            Filtro ativo: {data.filters.responsible}
          </p>
        ) : null}
      </div>
    </div>

    {loading ? (
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
