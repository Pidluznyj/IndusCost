import React from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, ExternalLink, FolderOpen, Loader2, X } from "lucide-react";
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
  dot: string;
  className: string;
} {
  switch (status) {
    case "COM_HISTORICO":
      return {
        label: "Com histórico",
        dot: "bg-emerald-500",
        className: "border-emerald-200 bg-emerald-50 text-emerald-900",
      };
    case "CARTEIRA_ABERTA":
      return {
        label: "Carteira aberta",
        dot: "bg-sky-500",
        className: "border-sky-200 bg-sky-50 text-sky-900",
      };
    case "SOMENTE_FATURADO":
      return {
        label: "Faturado",
        dot: "bg-emerald-500",
        className: "border-emerald-200 bg-emerald-50 text-emerald-900",
      };
    default:
      return {
        label: "Sem compra",
        dot: "bg-slate-400",
        className: "border-slate-200 bg-slate-50 text-slate-700",
      };
  }
}

function daysSincePurchaseClass(days: number | null): string {
  if (days === null) return "text-muted-foreground";
  if (days > DAYS_SINCE_PURCHASE_ATTENTION_THRESHOLD) return "text-amber-700 font-bold";
  return "text-foreground";
}

type AttentionBadge = { key: string; label: string; className: string; rowAccent: string };

function buildAttentionBadges(c: CrmCustomerListItem): AttentionBadge[] {
  const badges: AttentionBadge[] = [];
  if (c.hasOverdueFollowUp) {
    badges.push({
      key: "overdue",
      label: "Follow-up atrasado",
      className: "border-red-200 bg-red-50 text-red-900",
      rowAccent: "border-l-red-400",
    });
  }
  if (!c.hasCommercialOwner) {
    badges.push({
      key: "no-owner",
      label: "Sem responsável",
      className: "border-amber-200 bg-amber-50 text-amber-900",
      rowAccent: "border-l-amber-400",
    });
  }
  if (c.hasOwnerSellerDivergence) {
    badges.push({
      key: "divergence",
      label: "Divergência Nomus",
      className: "border-orange-200 bg-orange-50 text-orange-900",
      rowAccent: "border-l-orange-400",
    });
  }
  if (badges.length === 0 && c.hasOrderWithoutNomusSeller) {
    badges.push({
      key: "no-nomus",
      label: "Pedido s/ Nomus",
      className: "border-slate-200 bg-slate-50 text-slate-800",
      rowAccent: "border-l-transparent",
    });
  }
  return badges.slice(0, 2);
}

const thClass =
  "px-4 py-3 font-bold text-muted-foreground text-[10.5px] uppercase tracking-wide align-bottom";

/**
 * Tabela operacional da Carteira de Clientes. Substitui a lista estreita de
 * cards: densidade e colunas de verdade — ferramenta de trabalho, não
 * cartão de visita. Clientes que precisam de atenção ganham uma faixa
 * colorida na borda esquerda da linha — visível antes de ler qualquer
 * texto.
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
        <FolderOpen className="h-8 w-8 text-muted-foreground mx-auto" aria-hidden />
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
      <div className="flex items-center justify-between border-b border-border/70 bg-muted/20 px-4 py-3">
        <p className="text-sm font-bold text-foreground">Clientes da carteira</p>
        <p className="text-[11px] text-muted-foreground tabular-nums">
          {formatNumberPt(rangeFrom)}–{formatNumberPt(rangeTo)} nesta página
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid="crm-portfolio-table">
          <thead>
            <tr className="border-b border-border/60 bg-muted/30 text-left">
              <th className={thClass}>Cliente</th>
              {showSellerColumn ? <th className={thClass}>Responsável</th> : null}
              <th className={thClass}>Status</th>
              <th className={thClass}>
                Última compra
                <span className="block normal-case font-medium text-[9.5px] opacity-80">
                  Dias sem compra
                </span>
              </th>
              <th className={cn(thClass, "text-right")}>
                Venda no período
                <span className="block normal-case font-medium text-[9.5px] opacity-80">
                  Pedidos no período
                </span>
              </th>
              <th className={cn(thClass, "text-right")}>Ticket médio</th>
              <th className={thClass}>Atenção</th>
              <th className={cn(thClass, "text-right")}>Ações</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c, idx) => {
              const isActive = c.id === selectedId;
              const status = portfolioStatusBadge(c.portfolioStatus);
              const ticket =
                c.periodOrdersCount > 0 ? c.periodPurchaseValue / c.periodOrdersCount : null;
              const ownerLabel =
                c.commercialOwnerName?.trim() || c.primarySellerResponsible?.trim() || null;
              const attentionBadges = buildAttentionBadges(c);
              const rowAccent = attentionBadges[0]?.rowAccent ?? "border-l-transparent";
              return (
                <tr
                  key={c.id}
                  className={cn(
                    "border-b border-border/40 last:border-0 border-l-4 cursor-pointer transition-colors",
                    rowAccent,
                    isActive
                      ? "bg-primary/10"
                      : idx % 2 === 1
                        ? "bg-muted/15 hover:bg-accent/40"
                        : "hover:bg-accent/40"
                  )}
                  onClick={() => onSelectCustomer(c.id)}
                  data-testid="crm-portfolio-table-row"
                >
                  <td className="px-4 py-3.5 min-w-[210px] max-w-[260px]">
                    <p
                      className="font-semibold text-foreground leading-snug line-clamp-1"
                      title={getCustomerDisplayName(c)}
                    >
                      {getCustomerDisplayName(c)}
                    </p>
                    <p className="text-[11px] text-muted-foreground tabular-nums">
                      {getCustomerTaxId(c) !== "—" ? getCustomerTaxId(c) : "Documento não informado"}
                    </p>
                  </td>
                  {showSellerColumn ? (
                    <td className="px-4 py-3.5 text-muted-foreground max-w-[170px]">
                      <span className="line-clamp-1" title={ownerLabel ?? undefined}>
                        {ownerLabel ?? "Não atribuído"}
                      </span>
                    </td>
                  ) : null}
                  <td className="px-4 py-3.5">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase",
                        status.className
                      )}
                    >
                      <span className={cn("h-1.5 w-1.5 rounded-full", status.dot)} aria-hidden />
                      {status.label}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 whitespace-nowrap">
                    <span className="block text-foreground">
                      {c.lastOrderAt ? formatDateShortPt(c.lastOrderAt) : "Sem pedido"}
                    </span>
                    <span
                      className={cn(
                        "block text-[11px] tabular-nums",
                        daysSincePurchaseClass(c.daysSinceLastOrder)
                      )}
                    >
                      {c.daysSinceLastOrder === null
                        ? "—"
                        : `${formatNumberPt(c.daysSinceLastOrder)} dia(s)`}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-right whitespace-nowrap">
                    <span className="block tabular-nums font-semibold text-foreground">
                      {formatIntelCurrency(c.periodPurchaseValue)}
                    </span>
                    <span className="block text-[11px] tabular-nums text-muted-foreground">
                      {formatNumberPt(c.periodOrdersCount)} pedido(s)
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-right tabular-nums text-muted-foreground">
                    {ticket === null ? "—" : formatIntelCurrency(ticket)}
                  </td>
                  <td className="px-4 py-3.5">
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
                  <td className="px-4 py-3.5 text-right whitespace-nowrap">
                    <div
                      className="inline-flex items-center gap-1.5"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => onSelectCustomer(c.id)}
                        className="inline-flex items-center gap-1 rounded-lg border border-primary/30 bg-primary/10 px-2.5 py-1.5 text-xs font-semibold text-primary hover:bg-primary/15"
                      >
                        Abrir
                      </button>
                      <Link
                        to={buildCustomerIntelligencePath(c.id)}
                        className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-semibold text-foreground hover:bg-accent"
                      >
                        Ver 360
                        <ExternalLink className="h-3 w-3" />
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
        className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 bg-muted/10 px-4 py-2.5"
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
