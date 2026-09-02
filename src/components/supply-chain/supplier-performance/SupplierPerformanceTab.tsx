/**
 * OP-26 — Aba "Desempenho" do cadastro de fornecedor.
 *
 * Consolidado (nota geral, critérios, cobertura) + TODOS os pedidos do período
 * com paginação no servidor. O resumo cobre a população filtrada inteira, nunca
 * apenas a página visível — e a nota do fornecedor não é gravada em lugar nenhum.
 *
 * A avaliação retroativa usa exatamente o mesmo formulário do Pedido de Compra.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Loader2 } from "lucide-react";
import {
  SUPPLIER_EVALUATION_CRITERIA,
  SUPPLIER_PERFORMANCE_DEFAULT_PERIOD_PRESET,
  SUPPLIER_PERFORMANCE_EMPTY_COVERAGE_LABEL,
  SUPPLIER_PERFORMANCE_EMPTY_EVALUATIONS_LABEL,
  SUPPLIER_PERFORMANCE_EVALUATION_STATUS_FILTERS,
  SUPPLIER_PERFORMANCE_PAGE_SIZE_DEFAULT,
  SUPPLIER_PERFORMANCE_PERIOD_PRESETS,
  buildSupplierPerformancePeriodFromPreset,
  formatPurchaseOrderAmount,
  formatSupplierCoverage,
  formatSupplierScore,
  parseSupplierPerformanceCivilDateParam,
  type PurchaseOrderSupplierEvaluationDto,
  type SupplierPerformanceDetailResponse,
  type SupplierPerformanceEvaluationStatusFilter,
  type SupplierPerformanceOrderRowDto,
  type SupplierPerformancePeriod,
  type SupplierPerformancePeriodPresetId,
} from "@/src/lib/purchasing/supplierPerformance";
import {
  fetchPurchaseOrderSupplierEvaluation,
  fetchSupplierPerformanceDetail,
} from "@/src/lib/purchasing/supplierPerformanceClient";
import { PurchaseOrderSupplierEvaluationForm } from "./PurchaseOrderSupplierEvaluationForm";

const PO_STATUS_LABEL: Record<string, string> = {
  RASCUNHO: "Rascunho",
  APROVADO: "Aprovado",
  ENVIADO: "Enviado",
  EMITIDO: "Emitido",
  CONFIRMADO: "Confirmado",
  PARCIALMENTE_RECEBIDO: "Parcialmente recebido",
  RECEBIDO: "Recebido",
  CANCELADO: "Cancelado",
  ENCERRADO: "Encerrado",
};

const CHIP_BASE =
  "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors";
const CHIP_ACTIVE = "border-primary bg-primary text-primary-foreground";
const CHIP_IDLE = "border-border bg-background hover:bg-accent";

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleDateString("pt-BR");
}

type EvaluationTarget = {
  order: SupplierPerformanceOrderRowDto;
  evaluation: PurchaseOrderSupplierEvaluationDto | null;
};

type Props = {
  supplierId: string;
  supplierName?: string | null;
  /** operations.purchases:update — avaliar/revisar a partir do fornecedor. */
  canEvaluate: boolean;
};

export function SupplierPerformanceTab({ supplierId, supplierName, canEvaluate }: Props) {
  const [preset, setPreset] = useState<SupplierPerformancePeriodPresetId>(
    SUPPLIER_PERFORMANCE_DEFAULT_PERIOD_PRESET
  );
  const [appliedPeriod, setAppliedPeriod] = useState<SupplierPerformancePeriod>(() =>
    buildSupplierPerformancePeriodFromPreset(SUPPLIER_PERFORMANCE_DEFAULT_PERIOD_PRESET)
  );
  // Rascunho das datas: a consulta só roda no botão Aplicar.
  const [draftFrom, setDraftFrom] = useState("");
  const [draftTo, setDraftTo] = useState("");
  const [customError, setCustomError] = useState<string | null>(null);

  const [evaluationStatus, setEvaluationStatus] =
    useState<SupplierPerformanceEvaluationStatusFilter>("all");
  const [page, setPage] = useState(1);

  const [data, setData] = useState<SupplierPerformanceDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [target, setTarget] = useState<EvaluationTarget | null>(null);
  const [openingOrderId, setOpeningOrderId] = useState<string | null>(null);

  /**
   * Abre o formulário com a avaliação CANÔNICA do pedido (observações e
   * `revision` corrente) — a linha da lista é resumo e não serve de base para
   * revisar sem apagar dados nem para o controle de concorrência.
   */
  const openEvaluation = useCallback(async (order: SupplierPerformanceOrderRowDto) => {
    setOpeningOrderId(order.id);
    setError(null);
    try {
      const payload = await fetchPurchaseOrderSupplierEvaluation(order.id);
      setTarget({ order, evaluation: payload.evaluation });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao abrir a avaliação.");
    } finally {
      setOpeningOrderId(null);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void fetchSupplierPerformanceDetail(
      supplierId,
      {
        period: appliedPeriod,
        evaluationStatus,
        page,
        pageSize: SUPPLIER_PERFORMANCE_PAGE_SIZE_DEFAULT,
      },
      controller.signal
    )
      .then((payload) => {
        if (!controller.signal.aborted) setData(payload);
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted) {
          setError(e instanceof Error ? e.message : "Erro ao carregar o desempenho.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [supplierId, appliedPeriod, evaluationStatus, page, reloadToken]);

  const applyPreset = useCallback((next: SupplierPerformancePeriodPresetId) => {
    setPreset(next);
    setCustomError(null);
    setPage(1);
    if (next !== "custom") {
      setAppliedPeriod(buildSupplierPerformancePeriodFromPreset(next));
    }
  }, []);

  const applyCustomPeriod = useCallback(() => {
    const from = parseSupplierPerformanceCivilDateParam(draftFrom);
    const to = parseSupplierPerformanceCivilDateParam(draftTo);
    if ((draftFrom && !from) || (draftTo && !to)) {
      setCustomError("Informe datas válidas no formato dd/mm/aaaa.");
      return;
    }
    if (from && to && from > to) {
      setCustomError("A data inicial não pode ser maior que a final.");
      return;
    }
    setCustomError(null);
    setPage(1);
    setAppliedPeriod({ from, to });
  }, [draftFrom, draftTo]);

  const summary = data?.summary ?? null;
  const criterionValue = useMemo(() => {
    if (!summary) return {} as Record<string, number | null>;
    return {
      quality: summary.qualityScore,
      delivery: summary.deliveryScore,
      conformity: summary.conformityScore,
      service: summary.serviceScore,
    };
  }, [summary]);

  return (
    <div className="space-y-5" data-testid="supplier-performance-tab">
      <div>
        <h4 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
          Desempenho do fornecedor
        </h4>
        <p className="mt-1 text-xs text-muted-foreground">
          Consolidado das avaliações dos Pedidos de Compra recebidos ou encerrados.
          A nota não é editável aqui — ela é derivada dos pedidos.
        </p>
      </div>

      {/* Período */}
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          {SUPPLIER_PERFORMANCE_PERIOD_PRESETS.map((option) => (
            <button
              key={option.id}
              type="button"
              data-testid={`supplier-performance-period-${option.id}`}
              onClick={() => applyPreset(option.id)}
              className={`${CHIP_BASE} ${preset === option.id ? CHIP_ACTIVE : CHIP_IDLE}`}
            >
              {option.label}
            </button>
          ))}
        </div>

        {preset === "custom" ? (
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1">
              <span className="text-[10px] font-bold uppercase text-muted-foreground">De</span>
              <input
                type="date"
                value={draftFrom}
                onChange={(e) => setDraftFrom(e.target.value)}
                className="rounded-lg border border-border bg-background p-2 text-sm"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-bold uppercase text-muted-foreground">Até</span>
              <input
                type="date"
                value={draftTo}
                onChange={(e) => setDraftTo(e.target.value)}
                className="rounded-lg border border-border bg-background p-2 text-sm"
              />
            </label>
            <button
              type="button"
              onClick={applyCustomPeriod}
              data-testid="supplier-performance-apply-period"
              className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground"
            >
              Aplicar
            </button>
          </div>
        ) : null}

        {customError ? (
          <p className="text-xs text-red-800">{customError}</p>
        ) : null}
      </div>

      {error ? (
        <div className="flex gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{error}</p>
        </div>
      ) : null}

      {loading && !data ? (
        <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando desempenho…
        </div>
      ) : !data ? null : (
        <>
          {/* Cards consolidados */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <div className="rounded-xl border border-border bg-accent/20 p-4">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Nota geral
              </p>
              <p
                className="mt-1 text-2xl font-bold tabular-nums"
                data-testid="supplier-performance-overall"
              >
                {formatSupplierScore(summary?.overallScore ?? null)}
              </p>
            </div>

            {SUPPLIER_EVALUATION_CRITERIA.map((criterion) => (
              <div key={criterion.key} className="rounded-xl border border-border bg-accent/20 p-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  {criterion.shortLabel}
                </p>
                <p className="mt-1 text-xl font-bold tabular-nums">
                  {formatSupplierScore(criterionValue[criterion.key] ?? null)}
                </p>
              </div>
            ))}

            <div className="rounded-xl border border-border bg-accent/20 p-4">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Cobertura
              </p>
              {summary && summary.eligibleOrders === 0 ? (
                <p
                  className="mt-1 text-sm text-muted-foreground"
                  data-testid="supplier-performance-no-eligible"
                >
                  {SUPPLIER_PERFORMANCE_EMPTY_COVERAGE_LABEL}
                </p>
              ) : (
                <>
                  <p
                    className="mt-1 text-xl font-bold tabular-nums"
                    data-testid="supplier-performance-coverage"
                  >
                    {formatSupplierCoverage(summary?.coverage ?? null)}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {summary?.evaluatedOrders ?? 0} de {summary?.eligibleOrders ?? 0} pedidos
                    avaliados
                  </p>
                </>
              )}
            </div>
          </div>

          {summary && summary.eligibleOrders > 0 && summary.evaluatedOrders === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="supplier-performance-empty">
              {SUPPLIER_PERFORMANCE_EMPTY_EVALUATIONS_LABEL}
            </p>
          ) : null}

          {/* Filtros da lista */}
          <div className="flex flex-wrap gap-2">
            {SUPPLIER_PERFORMANCE_EVALUATION_STATUS_FILTERS.map((filter) => (
              <button
                key={filter.id}
                type="button"
                data-testid={`supplier-performance-filter-${filter.id}`}
                onClick={() => {
                  setEvaluationStatus(filter.id);
                  setPage(1);
                }}
                className={`${CHIP_BASE} ${
                  evaluationStatus === filter.id ? CHIP_ACTIVE : CHIP_IDLE
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>

          {/* Formulário de avaliação (mesmo componente do Pedido de Compra) */}
          {target ? (
            <div className="rounded-2xl border border-primary/40 bg-background p-4">
              <PurchaseOrderSupplierEvaluationForm
                purchaseOrderId={target.order.id}
                purchaseOrderCode={target.order.code}
                supplierName={supplierName ?? data.supplier.name}
                evaluation={target.evaluation}
                onCancel={() => setTarget(null)}
                onSaved={() => {
                  setTarget(null);
                  // Recarrega linha, cards, cobertura e nota — sem reload da app.
                  setReloadToken((n) => n + 1);
                }}
              />
            </div>
          ) : null}

          {/* Pedidos do período */}
          <div className="overflow-x-auto rounded-2xl border border-border">
            <table className="min-w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="p-3">Pedido</th>
                  <th className="p-3">Data</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Valor</th>
                  <th className="p-3">Avaliação</th>
                  <th className="p-3">Ação</th>
                </tr>
              </thead>
              <tbody data-testid="supplier-performance-orders">
                {data.orders.items.length === 0 ? (
                  <tr>
                    <td className="p-4 text-sm text-muted-foreground" colSpan={6}>
                      Nenhum pedido no período com este filtro.
                    </td>
                  </tr>
                ) : (
                  data.orders.items.map((order) => (
                    <tr key={order.id} className="border-t border-border/60">
                      <td className="p-3 font-mono text-xs">
                        <Link
                          to={`/purchases/orders/${order.id}`}
                          className="text-primary hover:underline"
                        >
                          {order.code}
                        </Link>
                      </td>
                      <td className="p-3 tabular-nums">{formatDate(order.referenceDate)}</td>
                      <td className="p-3">{PO_STATUS_LABEL[order.status] ?? order.status}</td>
                      {/* Moeda do próprio pedido — nunca presume BRL. */}
                      <td className="p-3 tabular-nums">
                        {formatPurchaseOrderAmount(order.totalAmount, order.currency)}
                      </td>
                      <td className="p-3 tabular-nums">
                        {order.evaluation
                          ? formatSupplierScore(order.evaluation.overallScore)
                          : order.eligible
                            ? "Não avaliado"
                            : "Não elegível"}
                      </td>
                      <td className="p-3">
                        {!order.eligible ? (
                          <span className="text-muted-foreground">—</span>
                        ) : canEvaluate ? (
                          <button
                            type="button"
                            disabled={openingOrderId === order.id}
                            data-testid={`supplier-performance-evaluate-${order.code}`}
                            onClick={() => void openEvaluation(order)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-accent disabled:opacity-50"
                          >
                            {openingOrderId === order.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : null}
                            {order.evaluation ? "Ver/Revisar" : "Avaliar"}
                          </button>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Paginação server-side */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              {data.orders.total} pedido(s) · página {data.orders.page} de{" "}
              {Math.max(1, data.orders.totalPages)}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={data.orders.page <= 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded-lg border border-border px-3 py-1.5 font-semibold disabled:opacity-40"
              >
                Anterior
              </button>
              <button
                type="button"
                disabled={data.orders.page >= data.orders.totalPages || loading}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-lg border border-border px-3 py-1.5 font-semibold disabled:opacity-40"
              >
                Próxima
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
