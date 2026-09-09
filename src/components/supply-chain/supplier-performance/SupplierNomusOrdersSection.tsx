/**
 * Aba Desempenho do fornecedor → seção "Pedidos Nomus".
 *
 * Mostra os Pedidos Nomus atribuídos ao fornecedor pela identidade oficial
 * (alias Nomus exclusivo → CNPJ único; nunca por nome), com KPIs PRÓPRIOS da
 * origem Nomus e avaliação inline na mesma régua da worklist
 * (Compras → Avaliação Fornecedor). Persistência: PUT
 * /api/supplier-performance/nomus-orders/:id — o mesmo endpoint da worklist.
 *
 * Pedidos IndusCost (PurchaseOrder) e Pedidos Nomus (NomusPurchaseOrder) não
 * têm chave entre si: as duas origens ficam lado a lado com o selo "Origem" e
 * NÃO se somam — não existe nota consolidada única.
 *
 * As partes de apresentação (selo, KPIs, tabela) são componentes puros para
 * teste estático com renderToStaticMarkup; a busca fica só no container.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { nomusPurchaseOrderStageLabel } from "@/src/lib/nomus/nomusPurchaseOrderUi";
import type { NomusSupplierEvaluationWorklistRow } from "@/src/lib/purchasing/nomusPurchaseOrderEvaluation";
import { saveNomusPurchaseOrderSupplierEvaluationRequest } from "@/src/lib/purchasing/nomusPurchaseOrderEvaluationClient";
import {
  SUPPLIER_NOMUS_ORDERS_UNMATCHABLE_LABEL,
  SUPPLIER_ORDER_ORIGIN_LABELS,
  describeNomusOrderIdentityMethod,
  type SupplierNomusOrdersDetailResponse,
  type SupplierNomusOrdersIdentityDto,
  type SupplierOrderOrigin,
} from "@/src/lib/purchasing/supplierNomusOrders";
import {
  SUPPLIER_EVALUATION_CRITERIA,
  SUPPLIER_EVALUATION_METHODOLOGY_V1,
  SUPPLIER_EVALUATION_METHODOLOGY_VERSION,
  SUPPLIER_PERFORMANCE_PAGE_SIZE_DEFAULT,
  computeSupplierOrderEvaluation,
  formatSupplierCoverage,
  formatSupplierScore,
  formatSupplierScoreWithScale,
  getSupplierEvaluationMethodology,
  type SupplierEvaluationCriterionKey,
  type SupplierPerformanceEvaluationStatusFilter,
  type SupplierPerformancePeriod,
  type SupplierPerformanceSummaryDto,
} from "@/src/lib/purchasing/supplierPerformance";
import { fetchSupplierNomusOrders } from "@/src/lib/purchasing/supplierPerformanceClient";
import { SupplierEvaluationRatingSelector } from "./SupplierEvaluationRatingScale";

export type NomusOrderScoreDraft = Record<SupplierEvaluationCriterionKey, number | null>;

export const EMPTY_NOMUS_ORDER_DRAFT: NomusOrderScoreDraft = {
  quality: null,
  delivery: null,
  conformity: null,
  service: null,
};

export function draftFromNomusOrderRow(row: NomusSupplierEvaluationWorklistRow): NomusOrderScoreDraft {
  if (!row.evaluation) return EMPTY_NOMUS_ORDER_DRAFT;
  return {
    quality: row.evaluation.scores.quality,
    delivery: row.evaluation.scores.delivery,
    conformity: row.evaluation.scores.conformity,
    service: row.evaluation.scores.service,
  };
}

/**
 * O rascunho precisa ser resemeado quando a linha é nova OU quando a avaliação
 * gravada mudou de revisão. Sem isso, um rascunho antigo seguiria com o
 * `expectedRevision` recém-lido e sobrescreveria em silêncio a avaliação que
 * outra pessoa acabou de salvar (o CAS do backend passaria).
 */
export function nomusOrderDraftNeedsReseed(input: {
  hasDraft: boolean;
  seededRevision: number | null | undefined;
  currentRevision: number | null | undefined;
}): boolean {
  if (!input.hasDraft) return true;
  return (input.seededRevision ?? null) !== (input.currentRevision ?? null);
}

/** Prévia da nota do rascunho pelo motor oficial; null enquanto faltar critério. */
export function previewNomusOrderDraft(
  draft: NomusOrderScoreDraft | undefined,
  methodologyVersion: number
): ReturnType<typeof computeSupplierOrderEvaluation> | null {
  if (!draft) return null;
  try {
    return computeSupplierOrderEvaluation(
      {
        qualityScore: draft.quality,
        deliveryScore: draft.delivery,
        conformityScore: draft.conformity,
        serviceScore: draft.service,
      },
      methodologyVersion
    );
  } catch {
    return null;
  }
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleDateString("pt-BR");
}

function evaluationStatusLabel(status: NomusSupplierEvaluationWorklistRow["evaluationStatus"]): string {
  if (status === "EVALUATED") return "Finalizada";
  if (status === "PENDING") return "Pendente";
  return "Não elegível";
}

const ORIGIN_CLASS: Record<SupplierOrderOrigin, string> = {
  INTERNAL: "border-slate-300 bg-slate-100 text-slate-700",
  NOMUS: "border-sky-300 bg-sky-50 text-sky-800",
};

/** Selo "Origem" — distingue PurchaseOrder (IndusCost) de NomusPurchaseOrder (Nomus). */
export function SupplierOrderOriginBadge({ origin }: { origin: SupplierOrderOrigin }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${ORIGIN_CLASS[origin]}`}
      data-testid={`supplier-order-origin-${origin.toLowerCase()}`}
      title={`Origem: ${SUPPLIER_ORDER_ORIGIN_LABELS[origin]}`}
    >
      {SUPPLIER_ORDER_ORIGIN_LABELS[origin]}
    </span>
  );
}

function Kpi({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="rounded-xl border border-border bg-accent/20 p-4">
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums" data-testid={testId}>
        {value}
      </p>
    </div>
  );
}

/** KPIs SÓ da origem Nomus (não consolidam com os Pedidos IndusCost). */
export function SupplierNomusOrdersKpis({
  kpis,
  scaleMax,
}: {
  kpis: SupplierPerformanceSummaryDto;
  scaleMax: number;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="supplier-nomus-orders-kpis">
      <Kpi label="Pedidos Nomus elegíveis" value={String(kpis.eligibleOrders)} testId="supplier-nomus-orders-eligible" />
      <Kpi label="Avaliados" value={String(kpis.evaluatedOrders)} testId="supplier-nomus-orders-evaluated" />
      <Kpi
        label="Cobertura Nomus"
        value={kpis.coverage == null ? "Sem pedidos Nomus no período" : formatSupplierCoverage(kpis.coverage)}
        testId="supplier-nomus-orders-coverage"
      />
      <Kpi
        label="Nota Nomus"
        value={formatSupplierScoreWithScale(kpis.overallScore, scaleMax)}
        testId="supplier-nomus-orders-overall"
      />
    </div>
  );
}

/** Explica qual chave atribuiu os pedidos — e quando não há chave segura. */
export function SupplierNomusOrdersIdentityNote({ identity }: { identity: SupplierNomusOrdersIdentityDto }) {
  if (!identity.matchable) {
    return (
      <div
        className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"
        data-testid="supplier-nomus-orders-unmatchable"
      >
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <p>{SUPPLIER_NOMUS_ORDERS_UNMATCHABLE_LABEL}</p>
      </div>
    );
  }
  const parts: string[] = [];
  if (identity.aliasExternalIds.length > 0) {
    parts.push(`alias Nomus ${identity.aliasExternalIds.join(", ")}`);
  }
  if (identity.normalizedDocument) {
    parts.push(
      identity.documentUnique
        ? `CNPJ ${identity.normalizedDocument} (único no cadastro)`
        : identity.documentOwners > 1
          ? `CNPJ ${identity.normalizedDocument} ignorado: ${identity.documentOwners} cadastros com o mesmo documento`
          : `CNPJ ${identity.normalizedDocument} ignorado: documento não normalizado no cadastro`
    );
  }
  return (
    <div className="space-y-1 text-[11px] text-muted-foreground" data-testid="supplier-nomus-orders-identity">
      <p>Chave de identidade: {parts.join(" · ")}. Nunca por nome.</p>
      {identity.ambiguousExternalIds.length > 0 ? (
        <p className="text-amber-800" data-testid="supplier-nomus-orders-ambiguous">
          Alias Nomus {identity.ambiguousExternalIds.join(", ")} também aponta para outro fornecedor —
          pedidos desse alias não são mostrados aqui (conflito).
        </p>
      ) : null}
      {identity.excludedOnPage > 0 ? (
        <p className="text-amber-800" data-testid="supplier-nomus-orders-excluded">
          {identity.excludedOnPage} pedido(s) desta página não passaram na verificação de identidade e
          foram ocultados.
        </p>
      ) : null}
    </div>
  );
}

export type SupplierNomusOrdersTableProps = {
  rows: NomusSupplierEvaluationWorklistRow[];
  drafts: Record<string, NomusOrderScoreDraft>;
  reviewing: Record<string, boolean>;
  reasons: Record<string, string>;
  rowErrors: Record<string, string>;
  savingId: string | null;
  canEvaluate: boolean;
  onScore: (id: string, key: SupplierEvaluationCriterionKey, value: number | null) => void;
  onToggleReview: (id: string) => void;
  onReason: (id: string, value: string) => void;
  onSave: (row: NomusSupplierEvaluationWorklistRow) => void;
};

/** Tabela pura dos Pedidos Nomus com avaliação inline (mesma régua da worklist). */
export function SupplierNomusOrdersTable({
  rows,
  drafts,
  reviewing,
  reasons,
  rowErrors,
  savingId,
  canEvaluate,
  onScore,
  onToggleReview,
  onReason,
  onSave,
}: SupplierNomusOrdersTableProps) {
  const columnCount = 7 + SUPPLIER_EVALUATION_CRITERIA.length;
  return (
    <div className="overflow-x-auto rounded-2xl border border-border">
      <table className="min-w-full text-sm">
        <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="p-3">Pedido</th>
            <th className="p-3">Origem</th>
            <th className="p-3">Data</th>
            <th className="p-3">Status</th>
            <th className="p-3">Avaliação</th>
            {SUPPLIER_EVALUATION_CRITERIA.map((criterion) => (
              <th key={criterion.key} className="min-w-[11rem] whitespace-nowrap p-3">
                {criterion.shortLabel}
              </th>
            ))}
            <th className="p-3 text-center">Nota</th>
            <th className="p-3">Ação</th>
          </tr>
        </thead>
        <tbody data-testid="supplier-nomus-orders-rows">
          {rows.length === 0 ? (
            <tr>
              <td className="p-4 text-sm text-muted-foreground" colSpan={columnCount}>
                Nenhum Pedido Nomus no período com este filtro.
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const id = row.nomusPurchaseOrderId;
              const draft = drafts[id] ?? EMPTY_NOMUS_ORDER_DRAFT;
              const methodologyVersion =
                row.evaluation?.methodologyVersion ?? SUPPLIER_EVALUATION_METHODOLOGY_VERSION;
              const preview = previewNomusOrderDraft(drafts[id], methodologyVersion);
              const isRevision = row.evaluation != null;
              const locked = !row.eligible || (isRevision && !reviewing[id]) || !canEvaluate;
              const saving = savingId === id;
              const canSave =
                canEvaluate && row.eligible && !saving && (!isRevision || reviewing[id] === true);
              return (
                <tr
                  key={id}
                  className="border-t border-border/60 align-top"
                  data-testid={`supplier-nomus-order-${row.externalId}`}
                >
                  <td className="p-3 font-mono text-xs font-semibold">
                    {row.orderNumber ?? `Nomus #${row.externalId}`}
                    <div className="mt-1 font-sans text-[10px] font-normal text-muted-foreground">
                      {describeNomusOrderIdentityMethod(row.supplier.matchMethod)}
                    </div>
                  </td>
                  <td className="p-3">
                    <SupplierOrderOriginBadge origin="NOMUS" />
                  </td>
                  <td className="p-3 tabular-nums">{formatDate(row.issuedAt)}</td>
                  <td className="p-3">{nomusPurchaseOrderStageLabel(row.stage)}</td>
                  <td className="p-3 whitespace-nowrap">
                    {evaluationStatusLabel(row.evaluationStatus)}
                    {row.evaluation
                      ? ` · ${formatSupplierScoreWithScale(
                          row.evaluation.scores.overall,
                          getSupplierEvaluationMethodology(row.evaluation.methodologyVersion).scaleMax
                        )}`
                      : ""}
                  </td>
                  {SUPPLIER_EVALUATION_CRITERIA.map((criterion) => (
                    <td key={criterion.key} className="min-w-[11rem] whitespace-nowrap p-3">
                      {methodologyVersion === SUPPLIER_EVALUATION_METHODOLOGY_V1 ? (
                        <label className="block">
                          <span className="sr-only">{criterion.shortLabel}</span>
                          <input
                            type="number"
                            inputMode="decimal"
                            min={0}
                            max={10}
                            step={0.1}
                            disabled={locked}
                            aria-label={`${criterion.shortLabel} (metodologia 0 a 10)`}
                            className="w-16 rounded border border-border bg-background px-1 py-0.5 text-xs tabular-nums disabled:opacity-50"
                            value={draft[criterion.key] ?? ""}
                            onChange={(event) =>
                              onScore(
                                id,
                                criterion.key,
                                event.target.value === ""
                                  ? null
                                  : Number(event.target.value.replace(",", "."))
                              )
                            }
                          />
                        </label>
                      ) : (
                        <SupplierEvaluationRatingSelector
                          criterionKey={criterion.key}
                          criterionLabel={criterion.shortLabel}
                          value={draft[criterion.key]}
                          disabled={locked}
                          compact
                          onChange={(value) => onScore(id, criterion.key, value)}
                        />
                      )}
                    </td>
                  ))}
                  <td className="p-3 text-center font-mono font-semibold">
                    {formatSupplierScoreWithScale(
                      preview?.overallScore ?? row.evaluation?.scores.overall ?? null,
                      getSupplierEvaluationMethodology(methodologyVersion).scaleMax
                    )}
                  </td>
                  <td className="p-3">
                    {!row.eligible || !canEvaluate ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <div className="flex flex-col gap-1">
                        {isRevision ? (
                          <button
                            type="button"
                            className="text-left text-[11px] font-semibold text-primary"
                            onClick={() => onToggleReview(id)}
                            data-testid={`supplier-nomus-order-review-${row.externalId}`}
                          >
                            {reviewing[id] ? "Cancelar revisão" : "Revisar"}
                          </button>
                        ) : null}
                        {reviewing[id] ? (
                          <input
                            value={reasons[id] ?? ""}
                            onChange={(event) => onReason(id, event.target.value)}
                            placeholder="Motivo da revisão"
                            className="w-40 rounded border border-border bg-background px-1 py-0.5 text-xs"
                            data-testid={`supplier-nomus-order-reason-${row.externalId}`}
                          />
                        ) : null}
                        <button
                          type="button"
                          disabled={!canSave}
                          onClick={() => onSave(row)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-accent disabled:opacity-50"
                          data-testid={`supplier-nomus-order-save-${row.externalId}`}
                        >
                          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                          {isRevision ? "Salvar revisão" : "Avaliar"}
                        </button>
                      </div>
                    )}
                    {rowErrors[id] ? (
                      <p className="mt-1 text-[10px] text-rose-700" data-testid={`supplier-nomus-order-error-${row.externalId}`}>
                        {rowErrors[id]}
                      </p>
                    ) : null}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

type SectionProps = {
  supplierId: string;
  period: SupplierPerformancePeriod;
  evaluationStatus: SupplierPerformanceEvaluationStatusFilter;
  /** operations.purchases:update — avaliar/revisar Pedidos Nomus a partir do fornecedor. */
  canEvaluate: boolean;
};

/** Container: busca os Pedidos Nomus do fornecedor e salva avaliações uma a uma. */
export function SupplierNomusOrdersSection({ supplierId, period, evaluationStatus, canEvaluate }: SectionProps) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<SupplierNomusOrdersDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, NomusOrderScoreDraft>>({});
  const [reviewing, setReviewing] = useState<Record<string, boolean>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  /** Revisão da avaliação que originou cada rascunho — base do reseed. */
  const draftRevisionsRef = useRef<Record<string, number | null>>({});

  useEffect(() => {
    setPage(1);
  }, [supplierId, period, evaluationStatus]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void fetchSupplierNomusOrders(
      supplierId,
      { period, evaluationStatus, page, pageSize: SUPPLIER_PERFORMANCE_PAGE_SIZE_DEFAULT },
      controller.signal
    )
      .then((payload) => {
        if (controller.signal.aborted) return;
        setData(payload);

        // Rascunho é resemeado quando a linha é nova OU quando a avaliação
        // gravada mudou de revisão (alguém salvou). Sem isso, um rascunho
        // velho seguiria junto com o expectedRevision novo e sobrescreveria
        // em silêncio a avaliação de outra pessoa.
        const rows = payload.orders.items;
        const reseeded = new Set<string>();
        for (const row of rows) {
          const id = row.nomusPurchaseOrderId;
          const revision = row.evaluation?.revision ?? null;
          if (
            nomusOrderDraftNeedsReseed({
              hasDraft: id in draftRevisionsRef.current,
              seededRevision: draftRevisionsRef.current[id],
              currentRevision: revision,
            })
          ) {
            reseeded.add(id);
          }
          draftRevisionsRef.current[id] = revision;
        }
        if (reseeded.size === 0) return;
        setDrafts((prev) => {
          const next = { ...prev };
          for (const row of rows) {
            if (reseeded.has(row.nomusPurchaseOrderId)) {
              next[row.nomusPurchaseOrderId] = draftFromNomusOrderRow(row);
            }
          }
          return next;
        });
        setReviewing((prev) => {
          const next = { ...prev };
          for (const id of reseeded) delete next[id];
          return next;
        });
        setReasons((prev) => {
          const next = { ...prev };
          for (const id of reseeded) delete next[id];
          return next;
        });
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted) {
          setError(e instanceof Error ? e.message : "Erro ao carregar os Pedidos Nomus.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [supplierId, period, evaluationStatus, page, reloadToken]);

  const onScore = useCallback((id: string, key: SupplierEvaluationCriterionKey, value: number | null) => {
    setDrafts((prev) => ({ ...prev, [id]: { ...(prev[id] ?? EMPTY_NOMUS_ORDER_DRAFT), [key]: value } }));
  }, []);
  /** Cancelar a revisão devolve o rascunho ao que está gravado (sem resíduo). */
  const onToggleReview = useCallback(
    (id: string) => {
      if (reviewing[id]) {
        const row = data?.orders.items.find((item) => item.nomusPurchaseOrderId === id);
        if (row) setDrafts((prev) => ({ ...prev, [id]: draftFromNomusOrderRow(row) }));
        setReasons((prev) => ({ ...prev, [id]: "" }));
      }
      setReviewing((prev) => ({ ...prev, [id]: !prev[id] }));
    },
    [reviewing, data]
  );
  const onReason = useCallback((id: string, value: string) => {
    setReasons((prev) => ({ ...prev, [id]: value }));
  }, []);

  const onSave = useCallback(
    async (row: NomusSupplierEvaluationWorklistRow) => {
      const id = row.nomusPurchaseOrderId;
      const isRevision = row.evaluation != null;
      const preview = previewNomusOrderDraft(
        drafts[id],
        row.evaluation?.methodologyVersion ?? SUPPLIER_EVALUATION_METHODOLOGY_VERSION
      );
      if (!preview) {
        setRowErrors((prev) => ({ ...prev, [id]: "Escolha 1, 2, 3, 4 ou 5 nos quatro critérios." }));
        return;
      }
      const revisionReason = (reasons[id] ?? "").trim();
      if (isRevision && !revisionReason) {
        setRowErrors((prev) => ({ ...prev, [id]: "Informe o motivo da revisão." }));
        return;
      }
      setSavingId(id);
      setRowErrors((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      try {
        await saveNomusPurchaseOrderSupplierEvaluationRequest(id, {
          qualityScore: preview.scores.quality,
          deliveryScore: preview.scores.delivery,
          conformityScore: preview.scores.conformity,
          serviceScore: preview.scores.service,
          notes: null,
          expectedRevision: row.evaluation?.revision ?? null,
          revisionReason: isRevision ? revisionReason : null,
        });
        setReviewing((prev) => ({ ...prev, [id]: false }));
        setReasons((prev) => ({ ...prev, [id]: "" }));
        // Recarrega linha e KPIs Nomus — a nota do fornecedor nunca é gravada.
        setReloadToken((n) => n + 1);
      } catch (e) {
        setRowErrors((prev) => ({
          ...prev,
          [id]: e instanceof Error ? e.message : "Falha ao salvar a avaliação.",
        }));
      } finally {
        setSavingId(null);
      }
    },
    [drafts, reasons]
  );

  return (
    <section className="space-y-3" data-testid="supplier-nomus-orders">
      <div className="flex flex-wrap items-center gap-2">
        <h5 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Pedidos Nomus</h5>
        <SupplierOrderOriginBadge origin="NOMUS" />
      </div>
      <p className="text-xs text-muted-foreground">
        Pedidos do espelho Nomus atribuídos a este fornecedor pela identidade oficial (alias Nomus
        exclusivo ou CNPJ único no cadastro). A avaliação usa a mesma régua e o mesmo endpoint da tela
        Compras → Avaliação Fornecedor. Estes números não se somam aos Pedidos IndusCost.
      </p>

      {error ? (
        <div className="flex gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{error}</p>
        </div>
      ) : null}

      {loading && !data ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando Pedidos Nomus…
        </div>
      ) : !data ? null : (
        <>
          <SupplierNomusOrdersIdentityNote identity={data.identity} />
          {data.identity.matchable ? (
            <>
              <SupplierNomusOrdersKpis kpis={data.kpis} scaleMax={data.scaleMax} />
              <SupplierNomusOrdersTable
                rows={data.orders.items}
                drafts={drafts}
                reviewing={reviewing}
                reasons={reasons}
                rowErrors={rowErrors}
                savingId={savingId}
                canEvaluate={canEvaluate}
                onScore={onScore}
                onToggleReview={onToggleReview}
                onReason={onReason}
                onSave={(row) => void onSave(row)}
              />
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>
                  {data.orders.total} pedido(s) Nomus · página {data.orders.page} de{" "}
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
          ) : null}
        </>
      )}
    </section>
  );
}
