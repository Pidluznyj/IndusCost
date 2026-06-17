import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  Loader2,
  Printer,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import {
  buildCustomerIntelligenceApiPath,
  CUSTOMER_INTELLIGENCE_SCREEN_TITLE,
  type CustomerIntelligenceTabId,
} from "@/src/lib/customerIntelligenceNavigation";
import {
  buildCustomerIntelligenceApiQuery,
  createDefaultCustomerIntelligenceUiFilters,
  customerIntelligenceUiFiltersFromSearchParams,
  customerIntelligenceUiFiltersToSearchParams,
  type CustomerIntelligenceUiFilters,
} from "@/src/lib/customerIntelligencePageFilters";
import type { CustomerIntelligenceReport } from "@/src/lib/customerIntelligenceTypes";
import { CustomerIntelligenceHeader } from "./customer-intelligence/CustomerIntelligenceHeader";
import { CustomerIntelligenceFilters } from "./customer-intelligence/CustomerIntelligenceFilters";
import { CustomerIntelligenceDataQuality } from "./customer-intelligence/CustomerIntelligenceDataQuality";
import {
  CustomerIntelligenceTabs,
  CustomerIntelligenceTabPlaceholder,
} from "./customer-intelligence/CustomerIntelligenceTabs";
import { CustomerIntelligenceOverviewTab } from "./customer-intelligence/CustomerIntelligenceOverviewTab";
import { CustomerIntelligencePurchasesTab } from "./customer-intelligence/CustomerIntelligencePurchasesTab";
import { CustomerIntelligenceProductsTab } from "./customer-intelligence/CustomerIntelligenceProductsTab";
import "./customer-intelligence/customer-intelligence.css";

function isEmptyReport(report: CustomerIntelligenceReport): boolean {
  return (
    report.commercialSummary.validOrdersCount === 0 &&
    report.commercialSummary.ordersCount === 0 &&
    report.history.byYear.length === 0
  );
}

export function CustomerIntelligencePage() {
  const { customerId } = useParams<{ customerId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const appliedFilters = useMemo(
    () => customerIntelligenceUiFiltersFromSearchParams(searchParams),
    [searchParams]
  );

  const [draftFilters, setDraftFilters] = useState<CustomerIntelligenceUiFilters>(appliedFilters);
  const [activeTab, setActiveTab] = useState<CustomerIntelligenceTabId>("overview");
  const [report, setReport] = useState<CustomerIntelligenceReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraftFilters(appliedFilters);
  }, [appliedFilters]);

  const apiQuery = useMemo(
    () => buildCustomerIntelligenceApiQuery(appliedFilters),
    [appliedFilters]
  );

  const loadReport = useCallback(async () => {
    if (!customerId) {
      setError("Cliente não informado na URL.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJsonOk<CustomerIntelligenceReport>(
        buildCustomerIntelligenceApiPath(customerId, apiQuery)
      );
      setReport(data);
    } catch (e) {
      setReport(null);
      setError(
        e instanceof Error
          ? e.message
          : "Não foi possível carregar a inteligência do cliente."
      );
    } finally {
      setLoading(false);
    }
  }, [customerId, apiQuery]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  const handleApplyFilters = () => {
    setSearchParams(customerIntelligenceUiFiltersToSearchParams(draftFilters), { replace: true });
  };

  const handleResetFilters = () => {
    const defaults = createDefaultCustomerIntelligenceUiFilters();
    setDraftFilters(defaults);
    setSearchParams(customerIntelligenceUiFiltersToSearchParams(defaults), { replace: true });
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="customer-intelligence-page space-y-5 pb-8">
      <div className="customer-intelligence-no-print flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm font-semibold hover:bg-accent"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar
          </button>
          <Link
            to="/customers"
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm font-semibold hover:bg-accent"
          >
            Clientes
          </Link>
          <Link
            to="/crm-commercial"
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm font-semibold hover:bg-accent"
          >
            CRM Comercial
          </Link>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void loadReport()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm font-semibold hover:bg-accent disabled:opacity-60"
          >
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            Atualizar
          </button>
          <button
            type="button"
            onClick={handlePrint}
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm font-semibold hover:bg-accent"
          >
            <Printer className="h-4 w-4" />
            Imprimir ficha
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Sparkles className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-xl font-bold">{CUSTOMER_INTELLIGENCE_SCREEN_TITLE}</h1>
          <p className="text-sm text-muted-foreground">Central 360º — comercial, financeiro e CRM</p>
        </div>
      </div>

      <CustomerIntelligenceFilters
        draft={draftFilters}
        onChange={(patch) => setDraftFilters((prev) => ({ ...prev, ...patch }))}
        onApply={handleApplyFilters}
        onReset={handleResetFilters}
      />

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <p className="text-sm">Carregando inteligência do cliente…</p>
        </div>
      ) : null}

      {!loading && error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-6 text-center text-red-900">
          <p className="font-semibold">Não foi possível carregar os dados</p>
          <p className="text-sm mt-2">{error}</p>
          <button
            type="button"
            onClick={() => void loadReport()}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-red-900 px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            <RefreshCw className="h-4 w-4" />
            Tentar novamente
          </button>
        </div>
      ) : null}

      {!loading && !error && report ? (
        <>
          <CustomerIntelligenceDataQuality dataQuality={report.dataQuality} />
          <CustomerIntelligenceHeader report={report} />

          {isEmptyReport(report) ? (
            <div className="rounded-xl border border-dashed border-border bg-muted/20 p-10 text-center">
              <p className="font-semibold">Sem dados comerciais no filtro aplicado</p>
              <p className="text-sm text-muted-foreground mt-2">
                Ajuste os filtros ou aguarde novos pedidos de venda para este cliente.
              </p>
            </div>
          ) : null}

          <CustomerIntelligenceTabs activeTab={activeTab} onChange={setActiveTab} />

          <div className="pt-2">
            {activeTab === "overview" ? <CustomerIntelligenceOverviewTab report={report} /> : null}
            {activeTab === "purchases" ? (
              <CustomerIntelligencePurchasesTab report={report} />
            ) : null}
            {activeTab === "products" ? (
              <CustomerIntelligenceProductsTab report={report} />
            ) : null}
            {activeTab === "repurchase" ? (
              <CustomerIntelligenceTabPlaceholder
                title="Recompra"
                description={report.repurchase.detail ?? "Análise de recompra baseada no endpoint consolidado."}
              />
            ) : null}
            {activeTab === "financial" ? (
              <CustomerIntelligenceTabPlaceholder
                title="Financeiro"
                description={
                  report.financial.linkedByCnpj
                    ? `Carteira AR: ${report.financial.receivableOpenAmount ?? 0} | Vencido: ${report.financial.overdueAmount ?? 0}`
                    : "Financeiro não vinculado por CNPJ."
                }
              />
            ) : null}
            {activeTab === "crm" ? (
              <CustomerIntelligenceTabPlaceholder
                title="CRM"
                description={`${report.crm.openTasksCount} tarefa(s) aberta(s) — histórico na API.`}
              />
            ) : null}
            {activeTab === "profile" ? (
              <CustomerIntelligenceTabPlaceholder
                title="Cadastro"
                description="Dados cadastrais exibidos no cabeçalho; detalhes adicionais em etapa futura."
              />
            ) : null}
            {activeTab === "opportunities" ? (
              <CustomerIntelligenceTabPlaceholder
                title="Oportunidades"
                description={`${report.opportunities.length} sinal(is) comercial(is) identificado(s).`}
              />
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
