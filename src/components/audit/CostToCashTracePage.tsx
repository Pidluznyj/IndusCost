import { Download, Search } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import {
  CommissionsEmptyState,
  CommissionsErrorBanner,
  CommissionsLoading,
} from "@/src/components/commissions/commissionsUi";
import { FinanceDetailTabs } from "@/src/components/finance/shared/FinanceDetailTabs";
import {
  CostToCashTraceSections,
  CostToCashTraceSummary,
  TRACE_TABS,
  type TraceTabId,
} from "@/src/components/audit/CostToCashTraceSections";
import { useAuth } from "@/src/contexts/AuthContext";
import { downloadTraceJson } from "@/src/lib/audit/costToCashTraceClient";
import { canViewCostToCashTracePage } from "@/src/lib/audit/costToCashTracePermissions";
import { useCostToCashTraceSearch } from "@/src/lib/audit/useCostToCashTraceSearch";
import { financeBiButtonOutlineClass, financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";

const INPUT_CLASS =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";

export function CostToCashTracePage() {
  const auth = useAuth();
  const canView = canViewCostToCashTracePage(auth);
  const {
    draftFilters,
    data,
    loading,
    error,
    validationError,
    updateDraft,
    submit,
    reset,
    clearError,
  } = useCostToCashTraceSearch();
  const [activeTab, setActiveTab] = useState<TraceTabId>("product");

  if (!canView) {
    return (
      <CommissionsEmptyState
        title="Acesso restrito"
        description="Você não possui permissão para consultar a rastreabilidade Custo → Preço → Venda → Comissão."
        testId="trace-access-denied"
      />
    );
  }

  return (
    <div className="space-y-6" data-testid="cost-to-cash-trace-page">
      <header className="space-y-1">
        <p className="text-xs font-bold uppercase tracking-widest text-primary">Auditoria executiva</p>
        <h3 className="text-2xl font-bold text-foreground">Rastreabilidade Custo → Preço → Venda → Comissão</h3>
        <p className="text-sm text-muted-foreground max-w-3xl">
          Consulta read-only via APIs de auditoria — nenhum cálculo é feito nesta tela. Dados publicados e
          materializados têm precedência sobre diagnósticos ao vivo.
        </p>
      </header>

      <section className={financeBiCardClass}>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h4 className="text-sm font-semibold">Busca global</h4>
          <div className="flex flex-wrap gap-2">
            {data ? (
              <button
                type="button"
                className={financeBiButtonOutlineClass}
                onClick={() => downloadTraceJson(data)}
              >
                <Download className="h-4 w-4" />
                Export JSON
              </button>
            ) : null}
            <button type="button" className={financeBiButtonOutlineClass} onClick={reset}>
              Limpar
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          <label className="space-y-1 text-xs">
            <span className="font-medium text-muted-foreground">SKU / produto</span>
            <input
              className={INPUT_CLASS}
              value={draftFilters.sku ?? ""}
              onChange={(e) => updateDraft({ sku: e.target.value })}
              placeholder="618.08AA"
              data-testid="trace-filter-sku"
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-medium text-muted-foreground">Pedido Nomus</span>
            <input
              className={INPUT_CLASS}
              value={draftFilters.orderNumber ?? ""}
              onChange={(e) => updateDraft({ orderNumber: e.target.value })}
              placeholder="PD0001"
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-medium text-muted-foreground">NF</span>
            <input
              className={INPUT_CLASS}
              value={draftFilters.nfeNumber ?? ""}
              onChange={(e) => updateDraft({ nfeNumber: e.target.value })}
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-medium text-muted-foreground">Título AR</span>
            <input
              className={INPUT_CLASS}
              value={draftFilters.receivableCode ?? ""}
              onChange={(e) => updateDraft({ receivableCode: e.target.value })}
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-medium text-muted-foreground">Cliente</span>
            <input
              className={INPUT_CLASS}
              value={draftFilters.customer ?? ""}
              onChange={(e) => updateDraft({ customer: e.target.value })}
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-medium text-muted-foreground">Vendedor</span>
            <input
              className={INPUT_CLASS}
              value={draftFilters.seller ?? ""}
              onChange={(e) => updateDraft({ seller: e.target.value })}
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-medium text-muted-foreground">Tabela comercial</span>
            <input
              className={INPUT_CLASS}
              value={draftFilters.tableCode ?? ""}
              onChange={(e) => updateDraft({ tableCode: e.target.value })}
              placeholder="ATACADO"
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1 text-xs">
              <span className="font-medium text-muted-foreground">Ano</span>
              <input
                className={INPUT_CLASS}
                value={draftFilters.year ?? ""}
                onChange={(e) => updateDraft({ year: e.target.value })}
                placeholder="2026"
              />
            </label>
            <label className="space-y-1 text-xs">
              <span className="font-medium text-muted-foreground">Mês</span>
              <input
                className={INPUT_CLASS}
                value={draftFilters.month ?? ""}
                onChange={(e) => updateDraft({ month: e.target.value })}
                placeholder="6"
              />
            </label>
          </div>
        </div>

        {validationError ? (
          <p className="mt-3 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            {validationError}
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
            onClick={submit}
            disabled={loading}
            data-testid="trace-search-button"
          >
            <Search className="h-4 w-4" />
            Pesquisar
          </button>
          <Link to="/reports" className={financeBiButtonOutlineClass}>
            Voltar aos relatórios
          </Link>
        </div>
      </section>

      {error ? (
        <CommissionsErrorBanner message={error} onRetry={submit} onDismiss={clearError} />
      ) : null}

      {loading ? <CommissionsLoading label="Consultando rastreabilidade…" /> : null}

      {!loading && !data && !error ? (
        <CommissionsEmptyState
          title="Informe um filtro para iniciar"
          description="Ex.: SKU 618.08AA, pedido Nomus, NF ou título AR."
          testId="trace-initial-empty"
        />
      ) : null}

      {!loading && data ? (
        <div className="space-y-5">
          <CostToCashTraceSummary data={data} />

          <FinanceDetailTabs tabs={TRACE_TABS} activeId={activeTab} onChange={setActiveTab} />

          <CostToCashTraceSections data={data} activeTab={activeTab} />
        </div>
      ) : null}
    </div>
  );
}
