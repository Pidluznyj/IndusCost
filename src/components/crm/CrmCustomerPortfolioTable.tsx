import React from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, Eye, Loader2, Plus, Sparkles, X } from "lucide-react";
import { cn } from "@/src/lib/utils";
import type { CrmCustomerListItem } from "@/src/lib/crmCustomersListTypes";
import {
  buildCustomerListStatusTags,
  computePortfolioEmptySummary,
  describeDaysAgo,
} from "@/src/components/crm/crmCustomerPortfolioUi";
import type { Formatters } from "@/src/components/crm/CrmCustomerAccountCockpit";

const MAX_STATUS_TAGS = 3;

export type CrmCustomerPortfolioTableProps = {
  customers: CrmCustomerListItem[];
  loading: boolean;
  error: string | null;
  emptyTitle: string;
  emptyBody: string;
  hasActiveFilters: boolean;
  onClearFilters: () => void;
  /** Coluna do responsável: some quando o usuário só vê a própria carteira. */
  showOwnerColumn: boolean;
  /** Universo do filtro (totals do backend); a página exibida é só um recorte. */
  totalInScope: number | null;
  offset: number;
  pageSize: number;
  hasMore: boolean;
  onPageChange: (offset: number) => void;
  selectedId: string | null;
  onViewCustomer: (id: string) => void;
  canRegisterContact: boolean;
  onRegisterContact: (customer: CrmCustomerListItem) => void;
  intelligencePathFor: (customerId: string) => string;
  formatNumberPt: (v: number | null | undefined) => string;
  formatters: Formatters;
  /** Referência de "hoje" (ms) para "há N dias"; injetável em teste. */
  now?: number;
};

const th = "px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap";
const td = "px-3 py-3 align-top text-sm";

/**
 * Grid da Carteira: uma linha por cliente do filtro, com os dados de cadastro
 * (como na tela de Clientes) e os do CRM — último contato, próximo follow-up e
 * última compra — mais as ações do dia a dia. O detalhe do cliente abre em
 * modal ("Ver cliente"), sem sair da lista.
 */
export const CrmCustomerPortfolioTable: React.FC<CrmCustomerPortfolioTableProps> = ({
  customers,
  loading,
  error,
  emptyTitle,
  emptyBody,
  hasActiveFilters,
  onClearFilters,
  showOwnerColumn,
  totalInScope,
  offset,
  pageSize,
  hasMore,
  onPageChange,
  selectedId,
  onViewCustomer,
  canRegisterContact,
  onRegisterContact,
  intelligencePathFor,
  formatNumberPt,
  formatters,
  now = Date.now(),
}) => {
  const { formatDateShortPt, formatIntelCurrency, getCustomerDisplayName, getCustomerTaxId, formatCityState } = formatters;
  const pageSummary = computePortfolioEmptySummary(customers);
  const first = customers.length === 0 ? 0 : offset + 1;
  const last = offset + customers.length;

  return (
    <section
      className="rounded-2xl border border-border bg-card shadow-sm"
      aria-label="Clientes da carteira"
      data-testid="crm-portfolio-table"
    >
      <header className="flex flex-col gap-3 border-b border-border px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h3 className="text-base font-bold text-foreground">Clientes da carteira</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {totalInScope != null
              ? `${formatNumberPt(totalInScope)} cliente(s) no filtro. Clique em uma linha para abrir o cliente.`
              : "Clique em uma linha para abrir o cliente."}
          </p>
        </div>
        {customers.length > 0 ? (
          // Contam só a página exibida; o universo do filtro está na faixa de auditoria acima.
          <div className="flex flex-wrap gap-2 text-[11px] font-semibold">
            <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-violet-900">
              Na lista: carteira aberta {pageSummary.withOpenPortfolio}
            </span>
            <span className="rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-red-900">
              Na lista: follow-up atrasado {pageSummary.withOverdueFollowUp}
            </span>
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-amber-900">
              Na lista: sem contato {pageSummary.withoutContact}
            </span>
          </div>
        ) : null}
      </header>

      {loading && customers.length === 0 ? (
        <div className="flex min-h-[220px] flex-col items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          Buscando clientes…
        </div>
      ) : error ? (
        <div className="m-5 space-y-1 rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
          <p className="font-semibold">Não foi possível buscar a carteira</p>
          <p>{error}</p>
        </div>
      ) : customers.length === 0 ? (
        <div className="flex min-h-[220px] flex-col items-center justify-center gap-2 p-10 text-center">
          <p className="text-sm font-semibold text-foreground">{emptyTitle}</p>
          <p className="max-w-md text-sm text-muted-foreground">{emptyBody}</p>
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
      ) : (
        <div className={cn("overflow-x-auto", loading && "opacity-60")} aria-busy={loading}>
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-muted/40">
              <tr>
                <th className={th}>Cliente</th>
                <th className={th}>Cidade / UF</th>
                {showOwnerColumn ? <th className={th}>Responsável</th> : null}
                <th className={th}>Situação</th>
                <th className={th}>Último contato</th>
                <th className={th}>Próximo follow-up</th>
                <th className={th}>Última compra</th>
                <th className={cn(th, "text-right")}>Compras no período</th>
                {/* Ações sempre à vista: a coluna fica presa à direita quando o grid rola na horizontal. */}
                <th className={cn(th, "sticky right-0 bg-muted text-right shadow-[-8px_0_8px_-8px_rgba(15,23,42,0.18)]")}>Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/70">
              {customers.map((customer) => {
                const tags = buildCustomerListStatusTags(customer);
                const name = getCustomerDisplayName(customer);
                const cityState = formatCityState(customer.city, customer.state);
                return (
                  <tr
                    key={customer.id}
                    onClick={() => onViewCustomer(customer.id)}
                    className={cn(
                      "group cursor-pointer transition-colors hover:bg-accent/50",
                      selectedId === customer.id && "bg-primary/5"
                    )}
                    data-testid="crm-portfolio-row"
                  >
                    <td className={cn(td, "min-w-[16rem] max-w-[24rem]")}>
                      <p className="font-semibold leading-snug text-foreground break-words">{name}</p>
                      {customer.tradeName?.trim() && customer.tradeName.trim() !== name ? (
                        <p className="text-xs text-muted-foreground break-words">{customer.tradeName}</p>
                      ) : null}
                      <p className="text-xs tabular-nums text-muted-foreground">{getCustomerTaxId(customer)}</p>
                    </td>
                    <td className={cn(td, "whitespace-nowrap text-muted-foreground")}>{cityState}</td>
                    {showOwnerColumn ? (
                      <td className={cn(td, "min-w-[10rem]")}>
                        {customer.commercialOwnerName?.trim() || customer.primarySellerResponsible?.trim() || (
                          <span className="text-amber-800">Sem responsável</span>
                        )}
                      </td>
                    ) : null}
                    <td className={cn(td, "min-w-[11rem]")}>
                      <div className="flex flex-wrap gap-1">
                        {tags.slice(0, MAX_STATUS_TAGS).map((tag) => (
                          <span
                            key={tag.key}
                            className={cn("rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase", tag.className)}
                          >
                            {tag.label}
                          </span>
                        ))}
                        {tags.length > MAX_STATUS_TAGS ? (
                          <span
                            className="rounded-full border border-border px-2 py-0.5 text-[10px] font-bold text-muted-foreground"
                            title={tags.slice(MAX_STATUS_TAGS).map((tag) => tag.label).join(" · ")}
                          >
                            +{tags.length - MAX_STATUS_TAGS}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className={cn(td, "whitespace-nowrap")}>
                      {customer.lastContactAt ? (
                        <>
                          <p className="tabular-nums text-foreground">{formatDateShortPt(customer.lastContactAt)}</p>
                          <p className="text-xs text-muted-foreground">
                            {describeDaysAgo(customer.lastContactAt, now)} · {formatNumberPt(customer.contactCount)} contato(s)
                          </p>
                        </>
                      ) : (
                        <span className="text-amber-800">Sem contato</span>
                      )}
                    </td>
                    <td className={cn(td, "whitespace-nowrap")}>
                      {customer.nextFollowUpAt ? (
                        <>
                          <p className={cn("tabular-nums", customer.hasOverdueFollowUp ? "font-semibold text-red-700" : "text-foreground")}>
                            {formatDateShortPt(customer.nextFollowUpAt)}
                          </p>
                          {customer.hasOverdueFollowUp ? <p className="text-xs text-red-700">Atrasado</p> : null}
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className={cn(td, "whitespace-nowrap")}>
                      {customer.lastOrderAt ? (
                        <>
                          <p className="tabular-nums text-foreground">{formatDateShortPt(customer.lastOrderAt)}</p>
                          <p className="text-xs text-muted-foreground">
                            {[customer.lastOrderCode, customer.daysSinceLastOrder != null ? `há ${formatNumberPt(customer.daysSinceLastOrder)} dia(s)` : null]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        </>
                      ) : (
                        <span className="text-muted-foreground">Sem compra</span>
                      )}
                    </td>
                    <td
                      className={cn(td, "whitespace-nowrap text-right")}
                      title={`Histórico: ${formatIntelCurrency(customer.historicalPurchaseValue)} em ${formatNumberPt(customer.ordersCount)} pedido(s)`}
                    >
                      <p className="tabular-nums font-semibold text-foreground">{formatIntelCurrency(customer.periodPurchaseValue)}</p>
                      <p className="text-xs text-muted-foreground">{formatNumberPt(customer.periodOrdersCount)} pedido(s)</p>
                    </td>
                    <td
                      className={cn(
                        td,
                        "sticky right-0 whitespace-nowrap bg-card shadow-[-8px_0_8px_-8px_rgba(15,23,42,0.18)] group-hover:bg-muted"
                      )}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <div className="flex items-center justify-end gap-1.5">
                        {canRegisterContact ? (
                          <button
                            type="button"
                            onClick={() => onRegisterContact(customer)}
                            className="inline-flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90"
                            title={`Registrar contato com ${name}`}
                          >
                            <Plus className="h-3.5 w-3.5" />
                            Registrar contato
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => onViewCustomer(customer.id)}
                          className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-semibold text-foreground hover:bg-accent"
                          title={`Ver ${name}: resumo comercial, relacionamento, agenda e linha do tempo`}
                        >
                          <Eye className="h-3.5 w-3.5" />
                          Ver cliente
                        </button>
                        <Link
                          to={intelligencePathFor(customer.id)}
                          className="inline-flex items-center rounded-lg border border-primary/30 bg-primary/10 p-1.5 text-primary hover:bg-primary/15"
                          title="Inteligência do cliente (Cliente 360)"
                          aria-label={`Inteligência de ${name}`}
                        >
                          <Sparkles className="h-3.5 w-3.5" />
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {customers.length > 0 ? (
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3 text-xs text-muted-foreground">
          <span className="tabular-nums">
            Mostrando {formatNumberPt(first)}–{formatNumberPt(last)}
            {totalInScope != null ? ` de ${formatNumberPt(totalInScope)}` : ""}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={offset <= 0 || loading}
              onClick={() => onPageChange(Math.max(0, offset - pageSize))}
              className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-3 py-1.5 font-semibold text-foreground hover:bg-accent disabled:opacity-40"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Anterior
            </button>
            <button
              type="button"
              disabled={!hasMore || loading}
              onClick={() => onPageChange(offset + pageSize)}
              className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-3 py-1.5 font-semibold text-foreground hover:bg-accent disabled:opacity-40"
            >
              Próxima
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </footer>
      ) : null}
    </section>
  );
};
