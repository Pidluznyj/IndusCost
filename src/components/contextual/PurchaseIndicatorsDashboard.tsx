/**
 * Indicadores executivos da Cadeia de Suprimentos (OP-26) + panorama legado de SC.
 */
import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { formatCurrency, formatNumber } from "@/src/lib/utils";
import type { PurchaseRequestRow, PurchaseRequestStatus } from "@/src/types/purchase";
import {
  purchaseStatusCounts,
  purchaseStatusChartData,
  topMaterialsByFrequency,
  totalPurchaseLines,
} from "@/src/lib/purchaseIndicatorsStats";
import { fetchSupplyChainFeatureStatus } from "@/src/lib/supply-chain/supplyChainClient";
import { ContextualDashboardLayout } from "./ContextualDashboardLayout";
import { ContextualDashboardKpiCard } from "./ContextualDashboardKpiCard";
import { ContextualDashboardKpiGrid } from "./ContextualDashboardKpiGrid";
import { ContextualDashboardEmpty } from "./ContextualDashboardEmpty";
import { cn } from "@/src/lib/utils";

type IndicatorCard = {
  id: string;
  label: string;
  value: number;
  unit: "BRL" | "QTY" | "COUNT" | "DAYS";
  base: string;
  grain: string;
  filtersApplied: string[];
  notes: string[];
};

type IndicatorsPayload = {
  cards: IndicatorCard[];
  report: {
    moneyStages: Array<{ id: string; value: number; grainCount: number }>;
    lateOrders: Array<{ purchaseOrderId: string; expectedDeliveryDate: string; quantityPending: number }>;
    belowMinimumItems: Array<{ itemId: string; available: number; minimumStock: number }>;
  };
  meta: {
    doNotSumMoneyAcrossStages: boolean;
    stockLayersAreNotAdditiveTotal: boolean;
  };
  generatedAt: string;
};

const STATUS_LABEL: Record<PurchaseRequestStatus, string> = {
  RASCUNHO: "Rascunho",
  AGUARDANDO_APROVACAO: "Aguardando aprovação",
  ABERTA: "Aberta",
  REJEITADA: "Rejeitada",
  EM_COTACAO: "Em cotação",
  CANCELADA: "Cancelada",
  ENCERRADA: "Encerrada",
};

const BAR_TONE = [
  "bg-slate-700",
  "bg-amber-600",
  "bg-slate-500",
  "bg-orange-500",
  "bg-violet-600",
  "bg-slate-400",
  "bg-slate-300",
];

function formatCardValue(card: IndicatorCard): string {
  if (card.unit === "BRL") return formatCurrency(card.value);
  if (card.unit === "DAYS") return `${formatNumber(card.value, 1)} d`;
  return formatNumber(card.value, card.unit === "QTY" ? 2 : 0);
}

const MONEY_IDS = new Set([
  "valor_solicitado",
  "valor_cotado",
  "valor_negociado",
  "ganho_negociado",
  "ganho_realizado",
]);
const OPS_IDS = new Set([
  "pedidos_em_aberto",
  "quantidade_pendente",
  "atrasos_fornecedor",
  "negociacoes_sem_evidencia",
  "recebimentos_divergentes",
]);
const STOCK_IDS = new Set([
  "estoque_fisico",
  "estoque_reservado",
  "estoque_bloqueado",
  "estoque_disponivel",
  "materiais_abaixo_minimo",
  "cobertura_estimada",
]);

export function PurchaseIndicatorsDashboard() {
  const [flagEnabled, setFlagEnabled] = useState<boolean | null>(null);
  const [exec, setExec] = useState<IndicatorsPayload | null>(null);
  const [execError, setExecError] = useState<string | null>(null);
  const [execLoading, setExecLoading] = useState(false);
  const [periodFrom, setPeriodFrom] = useState("");
  const [periodTo, setPeriodTo] = useState("");

  const [rows, setRows] = useState<PurchaseRequestRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetchSupplyChainFeatureStatus(controller.signal)
      .then((s) => {
        if (!controller.signal.aborted) setFlagEnabled(s.enabled.indicators === true);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFlagEnabled(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchJsonOk("/api/purchase-requests");
        if (!cancelled) setRows(Array.isArray(data) ? data : []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Erro ao carregar solicitações.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadExecutive = React.useCallback(async () => {
    setExecLoading(true);
    setExecError(null);
    try {
      const qs = new URLSearchParams();
      if (periodFrom.trim()) qs.set("periodFrom", periodFrom.trim());
      if (periodTo.trim()) qs.set("periodTo", periodTo.trim());
      const q = qs.toString();
      const data = await fetchJsonOk<IndicatorsPayload>(
        `/api/supply-chain/indicators${q ? `?${q}` : ""}`
      );
      setExec(data);
    } catch (e) {
      setExec(null);
      setExecError(e instanceof Error ? e.message : "Erro ao carregar indicadores SC.");
    } finally {
      setExecLoading(false);
    }
  }, [periodFrom, periodTo]);

  useEffect(() => {
    if (flagEnabled === true) void loadExecutive();
  }, [flagEnabled, loadExecutive]);

  const counts = useMemo(() => (rows ? purchaseStatusCounts(rows) : null), [rows]);
  const chart = useMemo(() => (counts ? purchaseStatusChartData(counts) : []), [counts]);
  const lines = rows ? totalPurchaseLines(rows) : 0;
  const topMp = useMemo(() => (rows ? topMaterialsByFrequency(rows, 8) : []), [rows]);

  const moneyCards = exec?.cards.filter((c) => MONEY_IDS.has(c.id)) ?? [];
  const opsCards = exec?.cards.filter((c) => OPS_IDS.has(c.id)) ?? [];
  const stockCards = exec?.cards.filter((c) => STOCK_IDS.has(c.id)) ?? [];

  if (error && flagEnabled === false) {
    return (
      <ContextualDashboardLayout moduleLabel="Compras — indicadores" backPath="/purchases">
        <p className="text-sm text-destructive">{error}</p>
      </ContextualDashboardLayout>
    );
  }

  return (
    <ContextualDashboardLayout moduleLabel="Compras — indicadores" backPath="/purchases">
      {flagEnabled === null ? (
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
        </p>
      ) : null}

      {flagEnabled === false ? (
        <div
          className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"
          data-testid="sc-indicators-flag-off"
        >
          Indicadores executivos SC desligados (
          <code>SUPPLY_CHAIN_INDICATORS_ENABLED</code>). Abaixo permanece o panorama legado de
          solicitações.
        </div>
      ) : null}

      {flagEnabled === true ? (
        <div className="space-y-6" data-testid="sc-executive-indicators">
          <div>
            <h3 className="text-lg font-bold tracking-tight">Indicadores executivos SC</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Cada card declara base e grain. Não some solicitação + cotação + pedido + recebimento
              como valores do mesmo fato. Camadas de estoque não formam um “total” aditivo.
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm space-y-1">
              <span className="text-muted-foreground">De</span>
              <input
                type="date"
                className="block rounded-md border border-border px-2 py-1.5 text-sm"
                value={periodFrom}
                onChange={(e) => setPeriodFrom(e.target.value)}
              />
            </label>
            <label className="text-sm space-y-1">
              <span className="text-muted-foreground">Até</span>
              <input
                type="date"
                className="block rounded-md border border-border px-2 py-1.5 text-sm"
                value={periodTo}
                onChange={(e) => setPeriodTo(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="rounded-lg bg-primary text-primary-foreground px-3 py-2 text-sm disabled:opacity-50"
              onClick={() => void loadExecutive()}
              disabled={execLoading}
            >
              {execLoading ? "Atualizando…" : "Aplicar filtros"}
            </button>
          </div>

          {execError ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900 flex gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              {execError}
            </div>
          ) : null}

          {execLoading && !exec ? (
            <p className="text-sm text-muted-foreground">Agregando indicadores…</p>
          ) : null}

          {exec ? (
            <>
              <section className="space-y-3">
                <h4 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
                  Valores e ganhos (estágios distintos)
                </h4>
                <ContextualDashboardKpiGrid>
                  {moneyCards.map((c) => (
                    <div key={c.id}>
                      <ContextualDashboardKpiCard
                        label={String(c.label)}
                        value={formatCardValue(c)}
                        hint={`${c.base} · grain ${c.grain}`}
                      />
                    </div>
                  ))}
                </ContextualDashboardKpiGrid>
              </section>

              <section className="space-y-3">
                <h4 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
                  Operação de compras / recebimento
                </h4>
                <ContextualDashboardKpiGrid>
                  {opsCards.map((c) => (
                    <div key={c.id}>
                      <ContextualDashboardKpiCard
                        label={String(c.label)}
                        value={formatCardValue(c)}
                        hint={String(c.base)}
                      />
                    </div>
                  ))}
                </ContextualDashboardKpiGrid>
              </section>

              <section className="space-y-3">
                <h4 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
                  Estoque SC (camadas)
                </h4>
                <ContextualDashboardKpiGrid>
                  {stockCards.map((c) => (
                    <div key={c.id}>
                      <ContextualDashboardKpiCard
                        label={String(c.label)}
                        value={formatCardValue(c)}
                        hint={String(c.base)}
                      />
                    </div>
                  ))}
                </ContextualDashboardKpiGrid>
              </section>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="rounded-2xl border border-border bg-card p-6 space-y-3">
                  <h4 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
                    Relatório — atrasos
                  </h4>
                  {exec.report.lateOrders.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nenhum PO aberto atrasado no filtro.</p>
                  ) : (
                    <ul className="text-sm space-y-2 max-h-56 overflow-auto">
                      {exec.report.lateOrders.slice(0, 20).map((l) => (
                        <li key={l.purchaseOrderId} className="flex justify-between gap-2 border-b border-border/50 pb-1">
                          <span className="font-mono text-xs">{l.purchaseOrderId.slice(0, 8)}…</span>
                          <span>prev. {l.expectedDeliveryDate}</span>
                          <span className="tabular-nums">pend. {formatNumber(l.quantityPending, 2)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="rounded-2xl border border-border bg-card p-6 space-y-3">
                  <h4 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
                    Relatório — abaixo do mínimo
                  </h4>
                  {exec.report.belowMinimumItems.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nenhum item abaixo do mínimo.</p>
                  ) : (
                    <ul className="text-sm space-y-2 max-h-56 overflow-auto">
                      {exec.report.belowMinimumItems.slice(0, 20).map((i) => (
                        <li key={i.itemId} className="flex justify-between gap-2 border-b border-border/50 pb-1">
                          <span className="font-mono text-xs">{i.itemId.slice(0, 8)}…</span>
                          <span className="tabular-nums">
                            {formatNumber(i.available, 2)} / mín. {formatNumber(i.minimumStock, 2)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              <details className="rounded-lg border border-border bg-muted/20 p-4 text-sm">
                <summary className="cursor-pointer font-medium">Bases e notas por indicador</summary>
                <ul className="mt-3 space-y-3">
                  {exec.cards.map((c) => (
                    <li key={c.id}>
                      <div className="font-semibold">{c.label}</div>
                      <div className="text-muted-foreground">{c.base}</div>
                      {c.notes.map((n) => (
                        <div key={n} className="text-xs text-muted-foreground">
                          • {n}
                        </div>
                      ))}
                    </li>
                  ))}
                </ul>
              </details>
            </>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-6 pt-4 border-t border-border">
        <div>
          <h3 className="text-lg font-bold tracking-tight">Panorama legado — solicitações</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Agregações sobre /api/purchase-requests (contagens). Não substitui os indicadores
            executivos SC.
          </p>
        </div>

        {rows === null ? (
          <p className="text-sm text-muted-foreground">Carregando solicitações…</p>
        ) : rows.length === 0 ? (
          <ContextualDashboardEmpty message="Não há solicitações de compra registradas." />
        ) : (
          <>
            <ContextualDashboardKpiGrid>
              <ContextualDashboardKpiCard label="Solicitações" value={String(rows.length)} />
              <ContextualDashboardKpiCard label="Linhas de itens (total)" value={String(lines)} />
              <ContextualDashboardKpiCard
                label="Abertas"
                value={String(counts!.ABERTA)}
                hint="Status ABERTA no cadastro atual."
              />
              <ContextualDashboardKpiCard label="Rascunhos" value={String(counts!.RASCUNHO)} />
            </ContextualDashboardKpiGrid>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="rounded-2xl border border-border bg-card p-6 space-y-4">
                <h4 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
                  Distribuição por status
                </h4>
                <div className="space-y-3">
                  {chart.map((row, i) => (
                    <div key={row.key} className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span>{STATUS_LABEL[row.key]}</span>
                        <span className="font-semibold tabular-nums">
                          {row.value} ({formatNumber(row.pct, 1)}%)
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className={cn(
                            "h-full rounded-full print:bg-slate-600",
                            BAR_TONE[i % BAR_TONE.length]
                          )}
                          style={{ width: `${Math.min(100, row.pct)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-card p-6 space-y-4">
                <h4 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
                  Matérias-primas mais citadas (linhas)
                </h4>
                {topMp.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sem linhas de MP nas solicitações atuais.</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {topMp.map((m) => (
                      <li
                        key={m.code}
                        className="flex justify-between gap-4 border-b border-border/60 pb-2 last:border-0"
                      >
                        <span className="font-mono text-xs text-muted-foreground shrink-0">{m.code}</span>
                        <span className="text-right leading-snug">{m.description}</span>
                        <span className="font-semibold tabular-nums shrink-0">{m.count}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </ContextualDashboardLayout>
  );
}
