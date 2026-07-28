import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { Download, Maximize2, Printer, RefreshCw, Settings2 } from "lucide-react";
import { useAuth } from "@/src/contexts/AuthContext";
import { fetchJsonOk } from "@/src/lib/http";
import { buildFinanceTabLoadError } from "@/src/lib/financeTabLoadError";
import type { FinanceDreReport } from "@/src/lib/financeDreTypes";
import type { CashBridgeReport } from "@/src/lib/financeDreCashBridgeTypes";
import { canViewFinanceDre } from "@/src/lib/financeDrePermissions";
import {
  buildFinanceDreQuery,
  createDefaultFinanceDreUiFilters,
  financeDreFiltersEqual,
  getFinanceDreApiPath,
  getFinanceDreCashBridgeApiPath,
  getFinanceDreExportPath,
  normalizeFinanceDreUiFilters,
  type FinanceDreUiFilters,
} from "@/src/lib/financeDreViewModel";
import {
  FinanceModuleErrorBanner,
  FinanceModulePageLoading,
} from "@/src/components/finance/shared/FinanceModuleStates";
import { FinanceDetailTabs } from "@/src/components/finance/shared/FinanceDetailTabs";
import { resolveFinanceBiFilterStatus } from "@/src/lib/financeBiFilterState";
import { financeBiCardClass, financeBiShellClass } from "@/src/lib/financeBiDashboardTheme";
import { FinanceBiFilterStatusBadge } from "@/src/components/finance/bi/FinanceBiFilterStatusBadge";
import { FinanceDreGrid } from "@/src/components/finance/dre/FinanceDreGrid";
import { FinanceDreInformativeReport } from "@/src/components/finance/dre/FinanceDreInformativeReport";
import { FinanceDrePresentationModal } from "@/src/components/finance/dre/FinanceDrePresentationModal";
import { FinanceDrePrintDocument } from "@/src/components/finance/dre/FinanceDrePrintDocument";
import { FinanceDreLineDetailModal } from "@/src/components/finance/dre/FinanceDreLineDetailModal";
import { FinanceDreCashBridgePanel } from "@/src/components/finance/dre/FinanceDreCashBridgePanel";
import type { FinanceDreLineId } from "@/src/lib/financeDreTypes";
import { formatFinanceKpiCurrency } from "@/src/lib/financeKpiFormat";
import { cn } from "@/src/lib/utils";

const DRE_PRINT_BODY_CLASS = "finance-dre-print-route";

type DrePageTabId = "dre" | "cash-bridge";

const DRE_PAGE_TABS = [
  { id: "dre" as const, label: "DRE" },
  { id: "cash-bridge" as const, label: "Ponte Lucro × Caixa" },
];

const YEAR_OPTIONS = Array.from({ length: 8 }, (_, i) => String(new Date().getFullYear() - 3 + i));
const MONTH_OPTIONS = [
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
];

function formatDreMarginPct(pct: number | null | undefined): string | undefined {
  if (pct == null || !Number.isFinite(pct)) return undefined;
  return `Margem ${pct.toFixed(1).replace(".", ",")}%`;
}

function KpiCard({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "positive" | "negative";
}) {
  return (
    <div
      className={cn(
        financeBiCardClass,
        "p-4",
        tone === "positive" && "border-emerald-300 bg-emerald-50",
        tone === "negative" && "border-rose-300 bg-rose-50"
      )}
    >
      <div
        className={cn(
          "text-[10px] font-bold uppercase tracking-wide",
          tone === "positive" && "text-emerald-950",
          tone === "negative" && "text-rose-950",
          tone === "default" && "text-[#4B5563]"
        )}
      >
        {label}
      </div>
      <div
        className={cn(
          "mt-2 text-xl font-semibold tabular-nums text-[#111827]",
          tone === "positive" && "text-emerald-950",
          tone === "negative" && "text-rose-950"
        )}
      >
        {value}
      </div>
      {hint ? (
        <div
          className={cn(
            "mt-1 text-xs font-medium",
            tone === "positive" && "text-emerald-900",
            tone === "negative" && "text-rose-900",
            tone === "default" && "text-[#374151]"
          )}
        >
          {hint}
        </div>
      ) : null}
    </div>
  );
}

export function FinanceManagerialDrePage() {
  const auth = useAuth();
  const canView = canViewFinanceDre(auth);

  const [draftFilters, setDraftFilters] = useState<FinanceDreUiFilters>(() =>
    createDefaultFinanceDreUiFilters()
  );
  const [appliedFilters, setAppliedFilters] = useState<FinanceDreUiFilters>(() =>
    createDefaultFinanceDreUiFilters()
  );
  const [report, setReport] = useState<FinanceDreReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pageTab, setPageTab] = useState<DrePageTabId>("dre");
  const [cashBridge, setCashBridge] = useState<CashBridgeReport | null>(null);
  const [loadingCashBridge, setLoadingCashBridge] = useState(false);
  const [cashBridgeError, setCashBridgeError] = useState<string | null>(null);
  const [presentationOpen, setPresentationOpen] = useState(false);
  const [drillLineId, setDrillLineId] = useState<FinanceDreLineId | null>(null);
  const [drillSourceCheckId, setDrillSourceCheckId] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const printCleanupRef = useRef<number | null>(null);
  const cashBridgeAbortRef = useRef<AbortController | null>(null);

  const appliedQuery = useMemo(
    () => buildFinanceDreQuery(appliedFilters),
    [appliedFilters]
  );
  const hasPendingFilterChanges = !financeDreFiltersEqual(draftFilters, appliedFilters);
  const filterStatus = resolveFinanceBiFilterStatus(true, hasPendingFilterChanges);

  const loadReport = useCallback(async () => {
    if (!canView) {
      setLoading(false);
      setError("Você não possui permissão para visualizar o DRE Gerencial.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const url = getFinanceDreApiPath(appliedQuery);
      const payload = await fetchJsonOk<FinanceDreReport>(url);
      setReport(payload);
    } catch (err) {
      setReport(null);
      setError(buildFinanceTabLoadError("Falha ao carregar o DRE Gerencial.", err));
    } finally {
      setLoading(false);
    }
  }, [appliedQuery, canView]);

  const loadCashBridge = useCallback(async () => {
    if (!canView) return;
    cashBridgeAbortRef.current?.abort();
    const controller = new AbortController();
    cashBridgeAbortRef.current = controller;
    setLoadingCashBridge(true);
    setCashBridgeError(null);
    try {
      const url = getFinanceDreCashBridgeApiPath(appliedQuery);
      const payload = await fetchJsonOk<CashBridgeReport>(url, {
        signal: controller.signal,
        credentials: "include",
      });
      if (controller.signal.aborted) return;
      setCashBridge(payload);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setCashBridge(null);
      setCashBridgeError(
        buildFinanceTabLoadError("Falha ao carregar a Ponte Lucro × Caixa.", err)
      );
    } finally {
      if (!controller.signal.aborted) setLoadingCashBridge(false);
    }
  }, [appliedQuery, canView]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  useEffect(() => {
    setCashBridge(null);
    setCashBridgeError(null);
  }, [appliedQuery]);

  useEffect(() => {
    if (pageTab !== "cash-bridge") return;
    void loadCashBridge();
  }, [pageTab, loadCashBridge]);

  const applyFilters = () => {
    setAppliedFilters(normalizeFinanceDreUiFilters(draftFilters));
  };

  const handleExport = () => {
    window.open(getFinanceDreExportPath(appliedQuery), "_blank", "noopener,noreferrer");
  };

  const handlePrint = useCallback(() => {
    if (printing || loading || !report) return;

    const clearPrintRoute = () => {
      if (printCleanupRef.current != null) {
        window.clearTimeout(printCleanupRef.current);
        printCleanupRef.current = null;
      }
      document.body.classList.remove(DRE_PRINT_BODY_CLASS);
      setPrinting(false);
    };

    setPrinting(true);
    const onAfterPrint = () => {
      window.removeEventListener("afterprint", onAfterPrint);
      clearPrintRoute();
    };
    window.addEventListener("afterprint", onAfterPrint);
    printCleanupRef.current = window.setTimeout(() => {
      window.removeEventListener("afterprint", onAfterPrint);
      clearPrintRoute();
    }, 60_000);

    document.body.classList.add(DRE_PRINT_BODY_CLASS);
    document.title = `DRE Gerencial ${report.filters.year}`;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTimeout(() => window.print(), 200);
      });
    });
  }, [loading, printing, report]);

  useEffect(() => {
    return () => {
      if (printCleanupRef.current != null) {
        window.clearTimeout(printCleanupRef.current);
      }
      document.body.classList.remove(DRE_PRINT_BODY_CLASS);
    };
  }, []);

  if (!canView) {
    return (
      <FinanceModuleErrorBanner message="Você não possui permissão para visualizar o DRE Gerencial." />
    );
  }

  return (
    <>
    <div className={cn(financeBiShellClass, "space-y-5")} data-testid="finance-dre-page">
      <div className="flex flex-wrap items-start justify-between gap-3 no-print">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            Financeiro · DRE Gerencial
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
            DRE Gerencial Mensal
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Receita por NF-e emitida, deduções fiscais, CMV oficial e despesas por centro de custo —
            pronto para apresentação ao conselho.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FinanceBiFilterStatusBadge status={filterStatus} />
          <button
            type="button"
            onClick={() => {
              void loadReport();
              if (pageTab === "cash-bridge") void loadCashBridge();
            }}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-accent"
          >
            <RefreshCw className="h-4 w-4" />
            Atualizar
          </button>
          <button
            type="button"
            onClick={handleExport}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-accent"
          >
            <Download className="h-4 w-4" />
            CSV
          </button>
          <button
            type="button"
            onClick={handlePrint}
            disabled={!report || printing || loading}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
            data-testid="finance-dre-print-button"
          >
            <Printer className="h-4 w-4" />
            {printing ? "Preparando PDF…" : "PDF / Imprimir"}
          </button>
          <button
            type="button"
            onClick={() => setPresentationOpen(true)}
            disabled={!report}
            className="inline-flex items-center gap-2 rounded-lg bg-[#1e3a5f] px-3 py-2 text-sm font-semibold text-white hover:bg-[#163053] disabled:opacity-50"
            data-testid="finance-dre-open-presentation"
          >
            <Maximize2 className="h-4 w-4" />
            Abrir apresentação
          </button>
          <Link
            to="/finance/dre/parametrizacao"
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-accent"
            data-testid="finance-dre-parametrize-link"
          >
            <Settings2 className="h-4 w-4" />
            Parametrizar centros
          </Link>
        </div>
      </div>

      <section className={cn(financeBiCardClass, "p-4 no-print")} data-testid="finance-dre-filters">
        <div className="grid grid-cols-12 gap-3">
          <label className="col-span-12 sm:col-span-3 space-y-1">
            <span className="text-[10px] font-bold uppercase text-muted-foreground">Ano</span>
            <select
              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm"
              value={draftFilters.year}
              onChange={(e) => setDraftFilters((prev) => ({ ...prev, year: e.target.value }))}
            >
              {YEAR_OPTIONS.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
          <label className="col-span-12 sm:col-span-3 space-y-1">
            <span className="text-[10px] font-bold uppercase text-muted-foreground">Mês destaque</span>
            <select
              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm"
              value={draftFilters.month}
              onChange={(e) => setDraftFilters((prev) => ({ ...prev, month: e.target.value }))}
            >
              {MONTH_OPTIONS.map((month) => (
                <option key={month.value} value={month.value}>
                  {month.label}
                </option>
              ))}
            </select>
          </label>
          <label className="col-span-12 sm:col-span-3 space-y-1">
            <span className="text-[10px] font-bold uppercase text-muted-foreground">Empresa</span>
            <select
              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm"
              value={draftFilters.company}
              onChange={(e) =>
                setDraftFilters((prev) => ({
                  ...prev,
                  company: e.target.value as FinanceDreUiFilters["company"],
                }))
              }
            >
              <option value="all">Todas</option>
              <option value="lazarios">Lazarios</option>
              <option value="koppetel">Koppetel</option>
              <option value="sm">SM</option>
            </select>
          </label>
          <div className="col-span-12 sm:col-span-3 flex items-end">
            <button
              type="button"
              onClick={applyFilters}
              className="h-9 w-full rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground hover:opacity-95"
            >
              Aplicar filtros
            </button>
          </div>
        </div>
      </section>

      <div className="no-print" data-testid="finance-dre-page-tabs">
        <FinanceDetailTabs
          tabs={DRE_PAGE_TABS}
          activeId={pageTab}
          onChange={setPageTab}
        />
      </div>

      {pageTab === "dre" ? (
        <>
          {error ? <FinanceModuleErrorBanner message={error} /> : null}
          {loading ? <FinanceModulePageLoading label="Montando DRE Gerencial…" /> : null}

          {!loading && report ? (
            <>
              <div
                className="grid gap-3 sm:grid-cols-2"
                data-testid="finance-dre-ebitda-cards"
              >
                <KpiCard
                  label="EBITDA (mês)"
                  value={formatFinanceKpiCurrency(report.kpis.ebitda)}
                  hint={[
                    formatDreMarginPct(report.kpis.ebitdaPct),
                    `RO + Investimento sócios (${formatFinanceKpiCurrency(report.kpis.investimentoSocios)})`,
                    "Antes de IRPJ/CSLL",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  tone={report.kpis.ebitda >= 0 ? "positive" : "negative"}
                />
                <KpiCard
                  label="EBITDA (YTD)"
                  value={formatFinanceKpiCurrency(report.kpis.ytd.ebitda)}
                  hint={[
                    formatDreMarginPct(report.kpis.ytd.ebitdaPct),
                    `RO + Investimento sócios (${formatFinanceKpiCurrency(report.kpis.ytd.investimentoSocios)})`,
                    "Antes de IRPJ/CSLL",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  tone={report.kpis.ytd.ebitda >= 0 ? "positive" : "negative"}
                />
              </div>

              <div className="space-y-3" data-testid="finance-dre-kpi-blocks">
                <div>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Acumulado (YTD)
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                    <KpiCard
                      label="Receita bruta (YTD)"
                      value={formatFinanceKpiCurrency(report.kpis.ytd.receitaBruta)}
                    />
                    <KpiCard
                      label="Receita líquida (YTD)"
                      value={formatFinanceKpiCurrency(report.kpis.ytd.receitaLiquida)}
                      hint={formatDreMarginPct(report.kpis.ytd.receitaLiquidaPct)}
                    />
                    <KpiCard
                      label="Lucro bruto (YTD)"
                      value={formatFinanceKpiCurrency(report.kpis.ytd.lucroBruto)}
                      hint={formatDreMarginPct(report.kpis.ytd.margemBrutaPct)}
                      tone={report.kpis.ytd.lucroBruto >= 0 ? "positive" : "negative"}
                    />
                    <KpiCard
                      label="Resultado operacional (YTD)"
                      value={formatFinanceKpiCurrency(report.kpis.ytd.resultadoOperacional)}
                      hint={formatDreMarginPct(report.kpis.ytd.margemOperacionalPct)}
                      tone={
                        report.kpis.ytd.resultadoOperacional >= 0 ? "positive" : "negative"
                      }
                    />
                    <KpiCard
                      label="Lucro líquido após IRPJ e CSLL (YTD)"
                      value={formatFinanceKpiCurrency(report.kpis.ytd.lucroLiquidoAproximado)}
                      hint={
                        [
                          formatDreMarginPct(report.kpis.ytd.margemLiquidaAproximadaPct),
                          "Estimativa gerencial mensal",
                        ]
                          .filter(Boolean)
                          .join(" · ")
                      }
                      tone={
                        report.kpis.ytd.lucroLiquidoAproximado >= 0 ? "positive" : "negative"
                      }
                    />
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Mês destaque
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                    <KpiCard
                      label="Receita bruta (mês)"
                      value={formatFinanceKpiCurrency(report.kpis.receitaBruta)}
                    />
                    <KpiCard
                      label="Receita líquida (mês)"
                      value={formatFinanceKpiCurrency(report.kpis.receitaLiquida)}
                      hint={formatDreMarginPct(report.kpis.receitaLiquidaPct)}
                    />
                    <KpiCard
                      label="Lucro bruto (mês)"
                      value={formatFinanceKpiCurrency(report.kpis.lucroBruto)}
                      hint={formatDreMarginPct(report.kpis.margemBrutaPct)}
                      tone={report.kpis.lucroBruto >= 0 ? "positive" : "negative"}
                    />
                    <KpiCard
                      label="Resultado operacional"
                      value={formatFinanceKpiCurrency(report.kpis.resultadoOperacional)}
                      hint={formatDreMarginPct(report.kpis.margemOperacionalPct)}
                      tone={
                        report.kpis.resultadoOperacional >= 0 ? "positive" : "negative"
                      }
                    />
                    <KpiCard
                      label="Lucro líquido após IRPJ e CSLL"
                      value={formatFinanceKpiCurrency(report.kpis.lucroLiquidoAproximado)}
                      hint={
                        [
                          formatDreMarginPct(report.kpis.margemLiquidaAproximadaPct),
                          "Estimativa gerencial mensal",
                        ]
                          .filter(Boolean)
                          .join(" · ")
                      }
                      tone={
                        report.kpis.lucroLiquidoAproximado >= 0 ? "positive" : "negative"
                      }
                    />
                  </div>
                </div>
              </div>

              {report.qualityAlerts.length > 0 ? (
                <div className="space-y-2 no-print">
                  {report.qualityAlerts.map((alert) => (
                    <div
                      key={alert.code}
                      className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950"
                    >
                      {alert.message}
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="space-y-2">
                <div className="flex items-end justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">{report.subtitle}</h2>
                    <p className="text-xs text-muted-foreground">
                      Visão resumida (mês + YTD). Abra a apresentação para comparar mês a mês.
                    </p>
                    <p
                      className="mt-1 text-[11px] text-muted-foreground/90"
                      title={report.estimatedCorporateTaxes.disclaimer}
                    >
                      IRPJ/CSLL: estimativa gerencial (passe o mouse para o aviso completo).
                    </p>
                  </div>
                </div>
                <FinanceDreGrid
                  report={report}
                  showAllMonths={false}
                  onLineClick={(lineId) => {
                    setDrillSourceCheckId(null);
                    setDrillLineId(lineId);
                  }}
                />
                <p className="text-xs text-muted-foreground">{report.disclaimer}</p>
              </div>

              <FinanceDreInformativeReport
                report={report}
                onSourceCheckClick={(check) => {
                  setDrillLineId(null);
                  setDrillSourceCheckId(check.id);
                }}
              />

              {report.costCenterBreakdown.length > 0 ? (
                <section
                  className={cn(financeBiCardClass, "p-4 no-print")}
                  data-testid="finance-dre-cc-breakdown"
                >
                  <h3 className="text-sm font-semibold text-foreground">
                    Centros de custo usados no DRE
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Classificação automática por nome/código. Confira se Logística, Embalagens, Folha e
                    demais papéis estão corretos.
                  </p>
                  <div className="mt-3 overflow-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-left text-[11px] uppercase text-muted-foreground">
                          <th className="py-2 pr-3">Código</th>
                          <th className="py-2 pr-3">Nome</th>
                          <th className="py-2 pr-3">Papel no DRE</th>
                          <th className="py-2 pr-3 text-right">Mês</th>
                          <th className="py-2 text-right">YTD</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.costCenterBreakdown.map((row) => (
                          <tr key={row.costCenterId} className="border-b border-border/70">
                            <td className="py-2 pr-3 font-medium">{row.code}</td>
                            <td className="py-2 pr-3">{row.name}</td>
                            <td className="py-2 pr-3 text-muted-foreground">{row.roleLabel}</td>
                            <td className="py-2 pr-3 text-right tabular-nums">
                              {formatFinanceKpiCurrency(row.highlightAmount)}
                            </td>
                            <td className="py-2 text-right tabular-nums">
                              {formatFinanceKpiCurrency(row.ytdAmount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ) : null}

              <FinanceDrePresentationModal
                open={presentationOpen}
                report={report}
                onClose={() => setPresentationOpen(false)}
                onPrint={handlePrint}
                onExport={handleExport}
                onLineClick={(lineId) => {
                  setDrillSourceCheckId(null);
                  setDrillLineId(lineId);
                }}
                onSourceCheckClick={(check) => {
                  setDrillLineId(null);
                  setDrillSourceCheckId(check.id);
                }}
              />
              <FinanceDreLineDetailModal
                open={drillLineId != null || drillSourceCheckId != null}
                lineId={drillLineId}
                sourceCheckId={drillSourceCheckId}
                filters={appliedFilters}
                onClose={() => {
                  setDrillLineId(null);
                  setDrillSourceCheckId(null);
                }}
              />
            </>
          ) : null}
        </>
      ) : (
        <FinanceDreCashBridgePanel
          report={cashBridge}
          loading={loadingCashBridge}
          error={cashBridgeError}
          onRetry={() => void loadCashBridge()}
        />
      )}
    </div>
    {report && typeof document !== "undefined"
      ? createPortal(<FinanceDrePrintDocument report={report} />, document.body)
      : null}
    </>
  );
}
