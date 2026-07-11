import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrainCircuit } from "lucide-react";
import { fetchJsonOk, HttpError } from "@/src/lib/http";
import { buildFinanceTabLoadError } from "@/src/lib/financeTabLoadError";
import {
  buildPortfolioIntelligenceListQuery,
  type PortfolioIntelligenceListPayload,
} from "@/src/lib/financePortfolioReconciliationClient";
import {
  createDefaultPortfolioIntelligenceUiFilters,
  dateAxisLabel,
  portfolioIntelligenceUiFiltersToQueryArgs,
  type PortfolioIntelligenceUiFilters,
} from "@/src/lib/finance/portfolioIntelligenceFilters";
import {
  FinanceModuleEmptyState,
  FinanceModuleErrorBanner,
  FinanceModuleLoadingBlock,
} from "@/src/components/finance/shared/FinanceModuleStates";
import { cardKeyToAccordionKey } from "@/src/lib/finance/portfolioIntelligenceDrilldown";
import type { IntelligenceAccordionKey } from "@/src/lib/finance/portfolioIntelligenceDrilldown";
import { PortfolioIntelligenceAccordions } from "./PortfolioIntelligenceAccordions";
import { PortfolioIntelligenceCards } from "./PortfolioIntelligenceCards";
import { PortfolioIntelligenceFiltersBar } from "./PortfolioIntelligenceFiltersBar";
import { PortfolioIntelligenceOrderDrawer } from "./PortfolioIntelligenceOrderDrawer";
import { PortfolioIntelligenceSellerKpis } from "./PortfolioIntelligenceSellerKpis";
import type { PortfolioIntelligenceSellerKpiDto } from "@/src/lib/financePortfolioReconciliationClient";
import {
  INTELLIGENCE_ALERTS_NOTICE,
  INTELLIGENCE_AXIS_LEGEND,
  INTELLIGENCE_READING_GUIDE,
  INTELLIGENCE_SCREEN_INTRO,
  INTELLIGENCE_SCREEN_TITLE,
  INTELLIGENCE_SCREEN_WARNING,
} from "@/src/lib/finance/portfolioIntelligenceUiCopy";

type Props = {
  runId?: string;
  customerExternalId?: string;
  enabled?: boolean;
  customers?: Array<{ customerExternalId: number; customerName: string | null }>;
};

/**
 * Seção Inteligência da Carteira — consome API read-only; não recalcula regras.
 */
export function PortfolioIntelligenceSection({
  runId = "",
  customerExternalId = "",
  enabled = true,
  customers = [],
}: Props) {
  const abortRef = useRef<AbortController | null>(null);
  const [payload, setPayload] = useState<PortfolioIntelligenceListPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedKey, setExpandedKey] = useState<IntelligenceAccordionKey | null>(null);
  const [selectedSalesOrderId, setSelectedSalesOrderId] = useState<string | null>(null);
  const [filtersExpanded, setFiltersExpanded] = useState(false);

  const [draftFilters, setDraftFilters] = useState<PortfolioIntelligenceUiFilters>(() =>
    createDefaultPortfolioIntelligenceUiFilters({ customerExternalId })
  );
  const [appliedFilters, setAppliedFilters] = useState<PortfolioIntelligenceUiFilters>(() =>
    createDefaultPortfolioIntelligenceUiFilters({ customerExternalId })
  );

  // Sincroniza cliente herdado da página de conciliação quando muda.
  useEffect(() => {
    setDraftFilters((prev) => ({
      ...prev,
      customerExternalId: customerExternalId || prev.customerExternalId,
    }));
    setAppliedFilters((prev) => ({
      ...prev,
      customerExternalId: customerExternalId || prev.customerExternalId,
    }));
  }, [customerExternalId]);

  const load = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError(null);
    try {
      const qs = buildPortfolioIntelligenceListQuery(
        portfolioIntelligenceUiFiltersToQueryArgs(appliedFilters, {
          runId,
          page: 1,
          pageSize: 200,
        })
      );
      const data = await fetchJsonOk<PortfolioIntelligenceListPayload>(
        `/api/finance/portfolio-reconciliation/intelligence?${qs}`,
        { signal: ac.signal, credentials: "include" }
      );
      setPayload(data);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      // 5xx: mensagem fixa (não vazar detalhe técnico). 4xx: detalhe amigável da API.
      if (e instanceof HttpError && e.status >= 500) {
        setError(
          "Não foi possível carregar a inteligência da carteira. Tente novamente em instantes."
        );
      } else {
        setError(
          buildFinanceTabLoadError(
            "Não foi possível carregar a inteligência da carteira.",
            e
          )
        );
      }
      if (!(e instanceof HttpError && e.status === 404)) {
        setPayload(null);
      }
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, [enabled, runId, appliedFilters]);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  const noRun = payload != null && payload.ok === false;
  const hasCards = (payload?.cards?.length ?? 0) > 0;
  const pagination = payload?.pagination;
  const rowsTruncated =
    pagination != null &&
    Number.isFinite(pagination.totalRows) &&
    pagination.totalRows > (payload?.rows?.length ?? 0);

  const carteiraTotal = useMemo(() => {
    const fromTotals = payload?.totals?.orderValue;
    if (typeof fromTotals === "number" && Number.isFinite(fromTotals)) return fromTotals;
    const card = payload?.cards?.find((c) => c.key === "CARTEIRA_TOTAL_ANALISADA");
    return card?.value ?? 0;
  }, [payload]);

  const activeCardKey = useMemo(() => {
    if (!expandedKey) return null;
    return expandedKey;
  }, [expandedKey]);

  const handleCardClick = useCallback((cardKey: string) => {
    const accordion = cardKeyToAccordionKey(cardKey);
    if (!accordion) return;
    setExpandedKey((prev) => (prev === accordion ? null : accordion));
  }, []);

  const handleOpenOrder = useCallback((salesOrderId: string) => {
    setSelectedSalesOrderId(salesOrderId);
  }, []);

  const handleCloseOrder = useCallback(() => {
    setSelectedSalesOrderId(null);
  }, []);

  const handleApply = useCallback(() => {
    setAppliedFilters(draftFilters);
  }, [draftFilters]);

  const handleApplyFilters = useCallback((next: PortfolioIntelligenceUiFilters) => {
    setDraftFilters(next);
    setAppliedFilters(next);
  }, []);

  const handleClear = useCallback(() => {
    const cleared = createDefaultPortfolioIntelligenceUiFilters({
      customerExternalId: "",
    });
    setDraftFilters(cleared);
    setAppliedFilters(cleared);
  }, []);

  const handleSelectSeller = useCallback((kpi: PortfolioIntelligenceSellerKpiDto) => {
    setAppliedFilters((prev) => {
      const next: PortfolioIntelligenceUiFilters = {
        ...prev,
        sellerExternalId: "",
        sellerName: "",
        onlyWithoutSeller: false,
      };
      if (kpi.sellerSource === "UNAVAILABLE" || kpi.sellerKey === "seller:unavailable") {
        next.onlyWithoutSeller = true;
      } else if (kpi.sellerExternalId != null) {
        next.sellerExternalId = String(kpi.sellerExternalId);
      } else {
        next.sellerName = kpi.sellerName;
      }
      setDraftFilters(next);
      return next;
    });
    setFiltersExpanded(true);
  }, []);

  const activeSellerKey = useMemo(() => {
    if (appliedFilters.onlyWithoutSeller) return "seller:unavailable";
    if (appliedFilters.sellerExternalId.trim()) {
      return `seller:${appliedFilters.sellerExternalId.trim()}`;
    }
    if (appliedFilters.sellerName.trim()) {
      const match = payload?.sellerKpis?.find(
        (s) =>
          s.sellerName.toLowerCase() === appliedFilters.sellerName.trim().toLowerCase()
      );
      return match?.sellerKey ?? null;
    }
    return null;
  }, [appliedFilters, payload?.sellerKpis]);

  return (
    <section
      className="space-y-4"
      data-testid="portfolio-intelligence-section"
      aria-label="Inteligência da Carteira"
    >
      <header
        className="rounded-2xl border border-slate-200/80 bg-gradient-to-br from-slate-50/90 via-white to-sky-50/40 px-4 py-4 shadow-sm sm:px-5"
        data-testid="portfolio-intelligence-header"
      >
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-sky-200/80 bg-sky-50 text-sky-800">
            <BrainCircuit className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0 space-y-2">
            <div>
              <h2 className="text-base font-semibold tracking-tight text-foreground sm:text-lg">
                {INTELLIGENCE_SCREEN_TITLE}
              </h2>
              <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
                {INTELLIGENCE_SCREEN_INTRO}
              </p>
            </div>
            <p
              className="inline-flex max-w-3xl rounded-lg border border-amber-200/80 bg-amber-50/80 px-3 py-2 text-xs font-medium leading-relaxed text-amber-950"
              data-testid="portfolio-intelligence-pd-warning"
            >
              {INTELLIGENCE_SCREEN_WARNING}
            </p>
            <p
              className="max-w-3xl text-[11px] leading-relaxed text-muted-foreground"
              data-testid="portfolio-intelligence-alerts-copy"
            >
              {INTELLIGENCE_ALERTS_NOTICE}
            </p>
            <p
              className="max-w-3xl text-[11px] leading-relaxed text-muted-foreground"
              data-testid="portfolio-intelligence-axis-legend"
            >
              {INTELLIGENCE_AXIS_LEGEND}
            </p>
            <p className="text-[11px] text-muted-foreground">{INTELLIGENCE_READING_GUIDE}</p>
          </div>
        </div>
      </header>

      {payload?.dataFreshness ? (
        <p
          className="rounded-xl border border-sky-200/70 bg-sky-50/40 px-3 py-2 text-[11px] leading-relaxed text-sky-950"
          data-testid="portfolio-intelligence-freshness-banner"
        >
          {payload.dataFreshness.laymanNotice} {payload.dataFreshness.syncRebuildNotice}
          {payload.dataFreshness.runUpdatedAt
            ? ` Run atualizada em ${payload.dataFreshness.runUpdatedAt.slice(0, 16).replace("T", " ")}.`
            : ""}
          {!payload.dataFreshness.isLatestRun
            ? " Atenção: a run exibida não é a SUCCESS mais recente."
            : ""}
        </p>
      ) : null}

      <PortfolioIntelligenceFiltersBar
        draft={draftFilters}
        applied={appliedFilters}
        expanded={filtersExpanded}
        onToggle={() => setFiltersExpanded((v) => !v)}
        onDraftChange={setDraftFilters}
        onApply={handleApply}
        onClear={handleClear}
        onApplyFilters={handleApplyFilters}
        customers={customers}
      />

      <p
        className="rounded-xl border border-sky-200/60 bg-sky-50/40 px-3 py-2 text-[11px] text-sky-950"
        data-testid="portfolio-intelligence-active-axis"
      >
        Recorte por <strong>{dateAxisLabel(appliedFilters.dateAxis)}</strong>
        {appliedFilters.from || appliedFilters.to
          ? ` · ${appliedFilters.from || "…"} → ${appliedFilters.to || "…"}`
          : " · período completo"}
        . Pedidos por emissão são diferentes de Contas a Receber por vencimento.
      </p>

      {error ? (
        <FinanceModuleErrorBanner
          message={error}
          onRetry={() => void load()}
          onDismiss={() => setError(null)}
        />
      ) : null}

      {(payload?.warnings?.length ?? 0) > 0 ? (
        <p
          className="rounded-xl border border-amber-200/70 bg-amber-50/50 px-3 py-2 text-[11px] text-amber-950"
          data-testid="portfolio-intelligence-warnings"
        >
          {payload!.warnings.slice(0, 3).join(" · ")}
          {payload!.warnings.length > 3 ? "…" : ""}
        </p>
      ) : null}

      {rowsTruncated ? (
        <p
          className="rounded-xl border border-sky-200/70 bg-sky-50/40 px-3 py-2 text-[11px] text-sky-950"
          data-testid="portfolio-intelligence-pagination-notice"
        >
          A lista mostra até {pagination!.pageSize} pedidos (
          {payload!.rows.length} de {pagination!.totalRows}). Os cards e as sanfonas já usam o
          filtro completo — refine a busca se precisar ver todos na grade.
        </p>
      ) : null}

      {loading && !payload ? (
        <FinanceModuleLoadingBlock label="Carregando maturidade da carteira…" />
      ) : null}

      {noRun ? (
        <FinanceModuleEmptyState
          title="Ainda não há conciliação pronta"
          description={
            payload?.message ??
            "Quando a conciliação da carteira for materializada, esta tela mostra o que já virou financeiro, o que ainda é pedido e o que precisa revisão."
          }
          icon={<BrainCircuit className="h-5 w-5" />}
        />
      ) : null}

      {!noRun ? (
        <PortfolioIntelligenceCards
          cards={payload?.cards ?? []}
          loading={loading && !hasCards}
          onCardClick={handleCardClick}
          activeCardKey={activeCardKey}
        />
      ) : null}

      {!noRun && payload ? (
        <PortfolioIntelligenceSellerKpis
          sellerKpis={payload.sellerKpis ?? []}
          loading={loading && !payload.sellerKpis}
          activeSellerKey={activeSellerKey}
          onSelectSeller={handleSelectSeller}
        />
      ) : null}

      {!loading && !noRun && !error && payload && !hasCards ? (
        <FinanceModuleEmptyState
          title="Nenhum indicador neste filtro"
          description="Tente limpar filtros ou escolher outro cliente/período. A carteira pode estar vazia neste recorte."
          icon={<BrainCircuit className="h-5 w-5" />}
        />
      ) : null}

      {!noRun && payload && hasCards ? (
        <PortfolioIntelligenceAccordions
          groups={payload.groups ?? []}
          cards={payload.cards ?? []}
          rows={payload.rows ?? []}
          carteiraTotal={carteiraTotal}
          expandedKey={expandedKey}
          onExpandedChange={setExpandedKey}
          onOpenOrder={handleOpenOrder}
        />
      ) : null}

      <PortfolioIntelligenceOrderDrawer
        open={Boolean(selectedSalesOrderId)}
        salesOrderId={selectedSalesOrderId}
        runId={runId}
        customerExternalId={appliedFilters.customerExternalId}
        onClose={handleCloseOrder}
      />
    </section>
  );
}
