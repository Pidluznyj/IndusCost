/**
 * OP-26 — Seção "Avaliação do fornecedor" no detalhe do Pedido de Compra.
 * Só renderiza com a feature flag ligada (fail closed) e permissão de leitura.
 */

import React, { useCallback, useEffect, useState } from "react";
import { ClipboardCheck, Loader2 } from "lucide-react";
import {
  SUPPLIER_EVALUATION_CRITERIA,
  formatSupplierScore,
  type PurchaseOrderSupplierEvaluationResponse,
} from "@/src/lib/purchasing/supplierPerformance";
import {
  fetchPurchaseOrderSupplierEvaluation,
  useSupplierPerformanceFeatureEnabled,
} from "@/src/lib/purchasing/supplierPerformanceClient";
import { PurchaseOrderSupplierEvaluationForm } from "./PurchaseOrderSupplierEvaluationForm";

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleString("pt-BR");
}

type Props = {
  purchaseOrderId: string;
  purchaseOrderCode?: string | null;
  supplierName?: string | null;
  /** Permissão de escrita (operations.purchases:update) resolvida pela tela. */
  canEvaluate: boolean;
  /** Permite a tela do pedido reagir ao salvamento. */
  onChanged?: () => void;
};

export function PurchaseOrderSupplierEvaluationCard({
  purchaseOrderId,
  purchaseOrderCode,
  supplierName,
  canEvaluate,
  onChanged,
}: Props) {
  const featureEnabled = useSupplierPerformanceFeatureEnabled();
  const [data, setData] = useState<PurchaseOrderSupplierEvaluationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const payload = await fetchPurchaseOrderSupplierEvaluation(purchaseOrderId, signal);
        if (!signal?.aborted) setData(payload);
      } catch (e) {
        if (!signal?.aborted) {
          setError(e instanceof Error ? e.message : "Erro ao carregar a avaliação.");
        }
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [purchaseOrderId]
  );

  useEffect(() => {
    if (featureEnabled !== true) return;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [featureEnabled, load]);

  // Flag desligada (ou ainda carregando): nada renderizado, nenhuma chamada.
  if (featureEnabled !== true) return null;

  return (
    <section
      className="space-y-3 rounded-2xl border border-border bg-card p-4"
      data-testid="purchase-order-supplier-evaluation"
    >
      <div className="flex items-center gap-2">
        <ClipboardCheck className="h-4 w-4 text-primary" />
        <h4 className="text-xs font-bold uppercase text-muted-foreground">
          Avaliação do fornecedor
        </h4>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando…
        </div>
      ) : error ? (
        <div className="space-y-2">
          <p className="text-sm text-red-800">{error}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-accent"
          >
            Tentar novamente
          </button>
        </div>
      ) : !data ? null : editing ? (
        <PurchaseOrderSupplierEvaluationForm
          purchaseOrderId={purchaseOrderId}
          purchaseOrderCode={purchaseOrderCode}
          supplierName={supplierName ?? data.supplier?.name ?? null}
          evaluation={data.evaluation}
          onCancel={() => setEditing(false)}
          onSaved={(payload) => {
            setData(payload);
            setEditing(false);
            onChanged?.();
          }}
        />
      ) : !data.eligible ? (
        <p className="text-sm text-muted-foreground" data-testid="supplier-evaluation-not-eligible">
          {data.evaluation
            ? "Avaliação histórica preservada: este pedido não integra mais o consolidado do fornecedor."
            : "Avaliação disponível após o pedido ser recebido ou encerrado."}
        </p>
      ) : !data.evaluation ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Ainda não avaliado.</p>
          {canEvaluate ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              data-testid="supplier-evaluation-start"
              className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition-opacity hover:opacity-90"
            >
              Avaliar fornecedor
            </button>
          ) : null}
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Nota geral
            </p>
            <p className="text-2xl font-bold tabular-nums" data-testid="supplier-evaluation-overall">
              {formatSupplierScore(data.evaluation.scores.overall)}
            </p>
          </div>

          <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            {SUPPLIER_EVALUATION_CRITERIA.map((criterion) => (
              <div key={criterion.key} className="rounded-xl border border-border bg-accent/20 p-3">
                <dt className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  {criterion.shortLabel}
                </dt>
                <dd className="mt-1 font-semibold tabular-nums">
                  {formatSupplierScore(data.evaluation.scores[criterion.key], 1)}
                </dd>
              </div>
            ))}
          </dl>

          {data.evaluation.notes ? (
            <p className="whitespace-pre-wrap rounded-xl border border-border bg-background p-3 text-sm">
              {data.evaluation.notes}
            </p>
          ) : null}

          <p className="text-xs text-muted-foreground">
            Avaliado por {data.evaluation.createdBy.name ?? "—"} em{" "}
            {formatDateTime(data.evaluation.createdAt)}
            {data.evaluation.revision > 1
              ? ` · revisão ${data.evaluation.revision} por ${
                  data.evaluation.updatedBy.name ?? "—"
                } em ${formatDateTime(data.evaluation.updatedAt)}`
              : ""}
          </p>

          {canEvaluate ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              data-testid="supplier-evaluation-revise"
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
            >
              Revisar avaliação
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}
