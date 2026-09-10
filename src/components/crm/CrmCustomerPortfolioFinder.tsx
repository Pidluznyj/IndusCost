import React, { useEffect } from "react";
import { Loader2, Search, X } from "lucide-react";
import type { CrmCommercialIntelResponse } from "@/src/lib/crmCommercialIntelligence";
import type { CrmCustomerListItem, CrmCustomersListResponse } from "@/src/lib/crmCustomersListTypes";
import { CrmCustomerIdentityCard, type Formatters } from "@/src/components/crm/CrmCustomerAccountCockpit";

const FINDER_CHIP_CAP = 6;

export type CrmCustomerPortfolioFinderProps = {
  customers: CrmCustomerListItem[];
  loading: boolean;
  error: string | null;
  hasActiveFilters: boolean;
  emptyTitle: string;
  emptyBody: string;
  onClearFilters: () => void;
  selectedId: string | null;
  selectedCustomer: CrmCustomerListItem | null;
  onSelectCustomer: (id: string) => void;
  onChangeCustomer: () => void;
  showSellerColumn: boolean;
  intel: CrmCommercialIntelResponse | null;
  intelligencePath: string;
  onRegisterContact: () => void;
  onEditProfile: () => void;
  totals?: CrmCustomersListResponse["totals"] | null;
  formatNumberPt: (v: number | null | undefined) => string;
  formatters: Formatters;
};

/**
 * Substitui a antiga tabela de listagem da Carteira: em vez de navegar
 * várias linhas, a busca/filtros resolvem para um único cartão-resumo. Só
 * quando a busca continua ambígua aparece uma desambiguação leve (nomes em
 * chips, nunca uma tabela de dados).
 */
export const CrmCustomerPortfolioFinder: React.FC<CrmCustomerPortfolioFinderProps> = ({
  customers,
  loading,
  error,
  hasActiveFilters,
  emptyTitle,
  emptyBody,
  onClearFilters,
  selectedId,
  selectedCustomer,
  onSelectCustomer,
  onChangeCustomer,
  showSellerColumn,
  intel,
  intelligencePath,
  onRegisterContact,
  onEditProfile,
  totals,
  formatNumberPt,
  formatters,
}) => {
  // A busca resolveu para um único cliente: abre o resumo sem exigir clique.
  useEffect(() => {
    if (customers.length === 1 && customers[0].id !== selectedId) {
      onSelectCustomer(customers[0].id);
    }
  }, [customers, selectedId, onSelectCustomer]);

  if (loading) {
    return (
      <div className="h-full min-h-[220px] rounded-2xl border border-dashed border-border bg-muted/20 p-10 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        Buscando clientes…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800 space-y-1">
        <p className="font-semibold">Não foi possível buscar a carteira</p>
        <p>{error}</p>
      </div>
    );
  }

  // Mostra o resumo assim que a busca resolve para 1 cliente, mesmo antes de
  // `selectedId` (estado do componente pai) alcançar o efeito acima.
  const resolvedCustomer = selectedCustomer ?? (customers.length === 1 ? customers[0] : null);
  if (resolvedCustomer) {
    return (
      <CrmCustomerIdentityCard
        customer={resolvedCustomer}
        showSellerColumn={showSellerColumn}
        intel={intel}
        intelligencePath={intelligencePath}
        onRegisterContact={onRegisterContact}
        onEditProfile={onEditProfile}
        onChangeCustomer={onChangeCustomer}
        formatters={formatters}
      />
    );
  }

  if (!hasActiveFilters) {
    return (
      <div className="h-full min-h-[220px] rounded-2xl border border-dashed border-border bg-gradient-to-br from-muted/30 to-card p-10 text-center space-y-3 flex flex-col items-center justify-center">
        <Search className="h-10 w-10 text-muted-foreground/40" />
        <p className="text-base font-bold text-foreground">Encontre um cliente para ver o resumo</p>
        <p className="text-sm text-muted-foreground max-w-md leading-relaxed">
          Digite um nome, CNPJ/CPF ou use os filtros à esquerda. Assim que a busca identificar o
          cliente, o resumo comercial abre aqui — sem precisar navegar uma lista.
        </p>
      </div>
    );
  }

  if (customers.length === 0) {
    return (
      <div className="h-full min-h-[220px] rounded-2xl border border-dashed border-border bg-muted/20 p-10 text-center space-y-2 flex flex-col items-center justify-center">
        <p className="text-sm font-semibold text-foreground">{emptyTitle}</p>
        <p className="text-sm text-muted-foreground max-w-md">{emptyBody}</p>
        <button
          type="button"
          onClick={onClearFilters}
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-accent"
        >
          <X className="h-3.5 w-3.5" />
          Limpar filtros
        </button>
      </div>
    );
  }

  // 2+ resultados: desambiguação leve — nomes clicáveis, nunca uma tabela.
  const visible = customers.slice(0, FINDER_CHIP_CAP);
  const universeCount = totals?.totalCustomersInScope ?? null;
  const totalForCopy = universeCount ?? customers.length;
  const hasOverflow = universeCount != null ? universeCount > visible.length : customers.length > visible.length;

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-sm space-y-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {formatNumberPt(totalForCopy)} clientes correspondem à busca — toque para abrir
      </p>
      <div className="flex flex-wrap gap-2">
        {visible.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onSelectCustomer(c.id)}
            className="rounded-full border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground shadow-sm hover:border-primary/40 hover:bg-primary/5"
          >
            {formatters.getCustomerDisplayName(c)}
          </button>
        ))}
      </div>
      {hasOverflow ? (
        <p className="text-xs text-muted-foreground">Refine a busca para abrir o cliente certo direto.</p>
      ) : null}
    </div>
  );
};
