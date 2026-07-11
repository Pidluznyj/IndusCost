import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrainCircuit } from "lucide-react";
import { fetchJsonOk, HttpError } from "@/src/lib/http";
import { buildFinanceTabLoadError } from "@/src/lib/financeTabLoadError";
import {
  buildPortfolioIntelligenceListQuery,
  type PortfolioIntelligenceListPayload,
} from "@/src/lib/financePortfolioReconciliationClient";
import {
  FinanceModuleEmptyState,
  FinanceModuleErrorBanner,
  FinanceModuleLoadingBlock,
} from "@/src/components/finance/shared/FinanceModuleStates";
import { cardKeyToAccordionKey } from "@/src/lib/finance/portfolioIntelligenceDrilldown";
import type { IntelligenceAccordionKey } from "@/src/lib/finance/portfolioIntelligenceDrilldown";
import { PortfolioIntelligenceAccordions } from "./PortfolioIntelligenceAccordions";
import { PortfolioIntelligenceCards } from "./PortfolioIntelligenceCards";

type Props = {
  runId?: string;
  customerExternalId?: string;
  enabled?: boolean;
};

/**
 * Seção Inteligência da Carteira — consome API read-only; não recalcula regras.
 */
export function PortfolioIntelligenceSection({
  runId = "",
  customerExternalId = "",
  enabled = true,
}: Props) {
  const abortRef = useRef<AbortController | null>(null);
  const [payload, setPayload] = useState<PortfolioIntelligenceListPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedKey, setExpandedKey] = useState<IntelligenceAccordionKey | null>(null);
  /** Preparado para drawer futuro — clique na linha do grid. */
  const [selectedSalesOrderId, setSelectedSalesOrderId] = useState<string | null>(null);

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
      const qs = buildPortfolioIntelligenceListQuery({
        runId,
        customerExternalId,
        page: 1,
        pageSize: 200,
      });
      const data = await fetchJsonOk<PortfolioIntelligenceListPayload>(
        `/api/finance/portfolio-reconciliation/intelligence?${qs}`,
        { signal: ac.signal, credentials: "include" }
      );
      setPayload(data);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(
        buildFinanceTabLoadError("Não foi possível carregar a inteligência da carteira.", e)
      );
      if (!(e instanceof HttpError && e.status === 404)) {
        setPayload(null);
      }
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, [enabled, runId, customerExternalId]);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  const noRun = payload != null && payload.ok === false;
  const hasCards = (payload?.cards?.length ?? 0) > 0;

  const carteiraTotal = useMemo(() => {
    const fromTotals = payload?.totals?.orderValue;
    if (typeof fromTotals === "number" && Number.isFinite(fromTotals)) return fromTotals;
    const card = payload?.cards?.find((c) => c.key === "CARTEIRA_TOTAL_ANALISADA");
    return card?.value ?? 0;
  }, [payload]);

  const activeCardKey = useMemo(() => {
    if (!expandedKey) return null;
    if (expandedKey === "CARTEIRA_VENCIDA_BLOQUEADA") {
      return "CARTEIRA_VENCIDA_BLOQUEADA";
    }
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

  return (
    <section
      className="space-y-3"
      data-testid="portfolio-intelligence-section"
      aria-label="Inteligência da Carteira"
      data-selected-order={selectedSalesOrderId ?? undefined}
    >
      <div className="flex items-start gap-2">
        <BrainCircuit className="mt-0.5 h-4 w-4 shrink-0 text-sky-700" aria-hidden />
        <div>
          <h2 className="text-sm font-semibold text-foreground">Inteligência da Carteira</h2>
          <p className="text-xs text-muted-foreground">
            Maturidade dos pedidos: o que já virou CR, o que é previsão e o que precisa revisão.
            Valores vêm da API — a tela só formata.
          </p>
        </div>
      </div>

      {error ? (
        <FinanceModuleErrorBanner
          message={error}
          onRetry={() => void load()}
          onDismiss={() => setError(null)}
        />
      ) : null}

      {(payload?.warnings?.length ?? 0) > 0 ? (
        <p
          className="rounded-md border border-amber-200/80 bg-amber-50/60 px-2.5 py-1.5 text-[11px] text-amber-950"
          data-testid="portfolio-intelligence-warnings"
        >
          {payload!.warnings.slice(0, 3).join(" · ")}
          {payload!.warnings.length > 3 ? "…" : ""}
        </p>
      ) : null}

      {loading && !payload ? (
        <FinanceModuleLoadingBlock label="Carregando inteligência da carteira…" />
      ) : null}

      {noRun ? (
        <FinanceModuleEmptyState
          title="Sem run materializada"
          description={
            payload?.message ??
            "Nenhuma conciliação materializada encontrada para montar a inteligência."
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

      {!loading && !noRun && !error && payload && !hasCards ? (
        <FinanceModuleEmptyState
          title="Sem indicadores"
          description="A API não retornou cards para o filtro atual."
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
    </section>
  );
}
