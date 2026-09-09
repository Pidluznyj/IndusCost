import React from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, Loader2, X } from "lucide-react";
import { cn } from "@/src/lib/utils";
import type { CrmCustomerListItem } from "@/src/lib/crmCustomersListTypes";
import { buildCustomerIntelligencePath } from "@/src/lib/customerIntelligenceNavigation";

/**
 * Janela de "sem compra" usada só para a cor do badge nesta tabela — 365
 * dias, o MESMO valor de `CUSTOMER_INTELLIGENCE_INACTIVE_DAYS`
 * (src/lib/customerIntelligenceScoring.ts, motor de Inteligência do
 * Cliente). Duplicado aqui como constante local (não importado) porque esse
 * módulo é server-only; o número é o mesmo, não uma régua nova.
 */
const DAYS_SINCE_PURCHASE_ATTENTION_THRESHOLD = 365;

export type CrmCustomerPortfolioTableProps = {
  customers: CrmCustomerListItem[];
  loading: boolean;
  error: string | null;
  emptyTitle: string;
  emptyBody: string;
  hasActiveFilters: boolean;
  onClearFilters: () => void;
  selectedId: string | null;
  onSelectCustomer: (id: string) => void;
  showSellerColumn: boolean;
  listHasMore: boolean;
  /** Paginação real (a carteira não tinha pager algum antes desta tela). */
  offset: number;
  onNextPage: () => void;
  onPrevPage: () => void;
  formatDateShortPt: (iso: string | null | undefined) => string;
  formatIntelCurrency: (v: unknown) => string;
  formatNumberPt: (v: number | null | undefined) => string;
  getCustomerDisplayName: (c: CrmCustomerListItem) => string;
  getCustomerTaxId: (c: CrmCustomerListItem) => string;
};

function portfolioStatusBadge(status: CrmCustomerListItem["portfolioStatus"]): {
  label: string;
  className: string;
} {
  switch (status) {
    case "COM_HISTORICO":
      return { label: "Com histórico", className: "border-emerald-200 bg-emerald-50 text-emerald-900" };
    case "CARTEIRA_ABERTA":
      return { label: "Carteira aberta", className: "border-sky-200 bg-sky-50 text-sky-900" };
    case "SOMENTE_FATURADO":
      return { label: "Faturado", className: "border-emerald-200 bg-emerald-50 text-emerald-900" };
    default:
      return { label: "Sem compra", className: "border-slate-200 bg-slate-50 text-slate-700" };
  }
}

function daysSincePurchaseClass(days: number | null): string {
  if (days === null) return "text-muted-foreground";
  if (days > DAYS_SINCE_PURCHASE_ATTENTION_THRESHOLD) return "text-amber-800 font-semibold";
  return "text-foreground";
}

type AttentionBadge = { key: string; label: string; className: string };

function buildAttentionBadges(c: CrmCustomerListItem): AttentionBadge[] {
  const badges: AttentionBadge[] = [];
  if (c.hasOverdueFollowUp) {
    badges.push({
      key: "overdue",
      label: "Follow-up atrasado",
      className: "border-red-200 bg-red-50 text-red-900",
    });
  }
  if (!c.hasCommercialOwner) {
    badges.push({
      key: "no-owner",
      label: "Sem responsável",
      className: "border-amber-200 bg-amber-50 text-amber-900",
    });
  }
  if (c.hasOwnerSellerDivergence) {
    badges.push({
      key: "divergence",
      label: "Divergência Nomus",
      className: "border-orange-200 bg-orange-50 text-orange-900",
    });
  }
  if (badges.length === 0 && c.hasOrderWithoutNomusSeller) {
    badges.push({
      key: "no-nomus",
      label: "Pedido s/ Nomus",
      className: "border-slate-200 bg-slate-50 text-slate-800",
    });
  }
  return badges.slice(0, 2);
}

/**
 * Tabela operacional da Carteira de Clientes. Substitui a lista estreita de
 * cards: densidade e colunas de verdade — ferramenta de trabalho, não
 * cartão de visita.
 */
export const CrmCustomerPortfolioTable: React.FC<CrmCustomerPortfolioTableProps> = ({
  customers,
  loading,
  error,
  emptyTitle,
  emptyBody,
  hasActiveFilters,
  onClearFilters,
  selectedId,
  onSelectCustomer,
  showSellerColumn,
  listHasMore,
  offset,
  onNextPage,
  onPrevPage,
  formatDateShortPt,
  formatIntelCurrency,
  formatNumberPt,
  getCustomerDisplayName,
  getCustomerTaxId,
}) => {
  if (loading) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-10 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        Carregando carteira de clientes…
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800 space-y-1">
        <p className="font-semibold">Não foi possível carregar a carteira</p>
        <p>{error}</p>
      </div>
    );
  }
  if (customers.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-10 text-center space-y-2">
        <p className="text-sm font-semibold text-foreground">{emptyTitle}</p>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">{emptyBody}</p>
        {hasActiveFilters ? (
          <button
            type="button"
            onClick={onClearFilters}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-accent"
          >
            <X className="h-3.5 w-3.5" />
            Limpar filtros
          </button>
        ) : null}
      </div>
    );
  }

  const rangeFrom = offset + 1;
  const rangeTo = offset + customers.length;

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid="crm-portfolio-table">
          <thead>
            <tr className="border-b border-border/60 bg-muted/20 text-left">
              <th className="px-4 py-2.5 font-semibold text-muted-foreground text-[11px] uppercase tracking-wide">
                Cliente
              </th>
              {showSellerColumn ? (
                <th className="px-4 py-2.5 font-semibold text-muted-foreground text-[11px] uppercase tracking-wide">
                  Responsável
                </th>
              ) : null}
              <th className="px-4 py-2.5 font-semibold text-muted-foreground text-[11px] uppercase tracking-wide">
                Status
              </th>
              <th className="px-4 py-2.5 font-semibold text-muted-foreground text-[11px] uppercase tracking-wide">
                Última compra
              </th>
              <th className="px-4 py-2.5 font-semibold text-muted-foreground text-[11px] uppercase tracking-wide text-right">
                Dias sem compra
              </th>
              <th className="px-4 py-2.5 font-semibold text-muted-foreground text-[11px] uppercase tracking-wide text-right">
                Pedidos no período
              </th>
              <th className="px-4 py-2.5 font-semibold text-muted-foreground text-[11px] uppercase tracking-wide text-right">
                Venda no período
              </th>
              <th className="px-4 py-2.5 font-semibold text-muted-foreground text-[11px] uppercase tracking-wide text-right">
                Ticket médio
              </th>
              <th className="px-4 py-2.5 font-semibold text-muted-foreground text-[11px] uppercase tracking-wide">
                Atenção
              </th>
              <th className="px-4 py-2.5 font-semibold text-muted-foreground text-[11px] uppercase tracking-wide text-right">
                Ações
              </th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => {
              const isActive = c.id === selectedId;
              const status = portfolioStatusBadge(c.portfolioStatus);
              const ticket =
                c.periodOrdersCount > 0 ? c.periodPurchaseValue / c.periodOrdersCount : null;
              const ownerLabel =
                c.commercialOwnerName?.trim() || c.primarySellerResponsible?.trim() || null;
              const attentionBadges = buildAttentionBadges(c);
              return (
                <tr
                  key={c.id}
                  className={cn(
                    "border-b border-border/40 last:border-0 cursor-pointer transition-colors",
                    isActive ? "bg-primary/10" : "hover:bg-accent/30"
                  )}
                  onClick={() => onSelectCustomer(c.id)}
                  data-testid="crm-portfolio-table-row"
                >
                  <td className="px-4 py-3 min-w-[200px]">
                    <p className="font-semibold text-foreground leading-snug line-clamp-1">
                      {getCustomerDisplayName(c)}
                    </p>
                    <p className="text-[11px] text-muted-foreground tabular-nums">
                      {getCustomerTaxId(c) !== "—" ? getCustomerTaxId(c) : "Documento não informado"}
                    </p>
                  </td>
                  {showSellerColumn ? (
                    <td className="px-4 py-3 text-muted-foreground max-w-[180px]">
                      <span className="line-clamp-1">{ownerLabel ?? "Não atribuído"}</span>
                    </td>
                  ) : null}
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        "inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase",
                        status.className
                      )}
                    >
                      {status.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground tabular-nums whitespace-nowrap">
                    {c.lastOrderAt ? formatDateShortPt(c.lastOrderAt) : "Sem pedido"}
                  </td>
                  <td
                    className={cn(
                      "px-4 py-3 text-right tabular-nums",
                      daysSincePurchaseClass(c.daysSinceLastOrder)
                    )}
                  >
                    {c.daysSinceLastOrder === null ? "—" : formatNumberPt(c.daysSinceLastOrder)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatNumberPt(c.periodOrdersCount)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold text-foreground">
                    {formatIntelCurrency(c.periodPurchaseValue)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                    {ticket === null ? "—" : formatIntelCurrency(ticket)}
                  </td>
                  <td className="px-4 py-3">
                    {attentionBadges.length === 0 ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {attentionBadges.map((b) => (
                          <span
                            key={b.key}
                            className={cn(
                              "rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase",
                              b.className
                            )}
                          >
                            {b.label}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <div className="inline-flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => onSelectCustomer(c.id)}
                        className="rounded-lg border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary/15"
                      >
                        Abrir
                      </button>
                      <Link
                        to={buildCustomerIntelligencePath(c.id)}
                        className="rounded-lg border border-border bg-background px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-accent"
                      >
                        Ver 360
                      </Link>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div
        className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-4 py-2.5"
        data-testid="crm-portfolio-pagination"
      >
        <p className="text-[11px] text-muted-foreground tabular-nums">
          Exibindo {formatNumberPt(rangeFrom)}–{formatNumberPt(rangeTo)}
          {listHasMore || offset > 0 ? "" : " (todos os resultados do filtro)"}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onPrevPage}
            disabled={offset <= 0}
            className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-semibold text-foreground hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Anterior
          </button>
          <button
            type="button"
            onClick={onNextPage}
            disabled={!listHasMore}
            className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-semibold text-foreground hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Próxima
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
