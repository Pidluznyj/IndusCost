/**
 * Worklist operacional: avaliar Pedidos Nomus em grade, sem abrir o 360º.
 * Fórmula e persistência continuam no backend OP-26.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { PurchaseChainViewNav } from "@/src/components/supply-chain/PurchaseChainViewNav";
import { useAuth } from "@/src/contexts/AuthContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import { OPERATIONS_ACTIONS, OPERATIONS_RESOURCE_KEYS } from "@/src/lib/operationsAccess";
import {
  SUPPLIER_EVALUATION_CRITERIA,
  SUPPLIER_PERFORMANCE_PERIOD_PRESETS,
  buildSupplierPerformancePeriodFromPreset,
  computeSupplierOrderEvaluation,
  formatSupplierCoverage,
  formatSupplierScore,
  type SupplierEvaluationCriterionKey,
  type SupplierPerformancePeriodPresetId,
} from "@/src/lib/purchasing/supplierPerformance";
import {
  fetchNomusSupplierEvaluationWorklist,
  saveNomusPurchaseOrderSupplierEvaluationsBatchRequest,
} from "@/src/lib/purchasing/nomusPurchaseOrderEvaluationClient";
import { useSupplierPerformanceFeatureEnabled } from "@/src/lib/purchasing/supplierPerformanceClient";
import type {
  NomusSupplierEvaluationWorklistResponse,
  NomusSupplierEvaluationWorklistRow,
} from "@/src/lib/purchasing/nomusPurchaseOrderEvaluation";
import { nomusPurchaseOrderStageLabel } from "@/src/lib/nomus/nomusPurchaseOrderUi";

type ScoreDraft = Record<SupplierEvaluationCriterionKey, string>;
const EMPTY: ScoreDraft = { quality: "", delivery: "", conformity: "", service: "" };

function draftFromRow(row: NomusSupplierEvaluationWorklistRow): ScoreDraft {
  if (!row.evaluation) return EMPTY;
  const asText = (v: number) => String(v).replace(".", ",");
  return {
    quality: asText(row.evaluation.scores.quality),
    delivery: asText(row.evaluation.scores.delivery),
    conformity: asText(row.evaluation.scores.conformity),
    service: asText(row.evaluation.scores.service),
  };
}

function evaluationStatusLabel(status: NomusSupplierEvaluationWorklistRow["evaluationStatus"]): string {
  if (status === "EVALUATED") return "Finalizada";
  if (status === "PENDING") return "Pendente";
  return "Não elegível";
}

export function NomusSupplierEvaluationWorklistPage() {
  const featureEnabled = useSupplierPerformanceFeatureEnabled();
  const auth = useAuth();
  const permissions = usePermissions();
  const canUpdate =
    auth.hasPermission("purchases.edit") ||
    permissions.canPerformAction(
      OPERATIONS_RESOURCE_KEYS.purchases,
      OPERATIONS_ACTIONS.update
    );

  const [periodPreset, setPeriodPreset] = useState<SupplierPerformancePeriodPresetId>("last12m");
  const period = useMemo(
    () => buildSupplierPerformancePeriodFromPreset(periodPreset === "custom" ? "last12m" : periodPreset),
    [periodPreset]
  );
  const [q, setQ] = useState("");
  const [supplier, setSupplier] = useState("");
  const [evaluationStatus, setEvaluationStatus] = useState("pending");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<NomusSupplierEvaluationWorklistResponse | null>(null);
  const [drafts, setDrafts] = useState<Record<string, ScoreDraft>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [reviewing, setReviewing] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchNomusSupplierEvaluationWorklist({
        ...period,
        q: q.trim() || null,
        supplier: supplier.trim() || null,
        evaluationStatus,
        page,
        pageSize: 50,
      });
      setData(payload);
      setDrafts((prev) => {
        const next = { ...prev };
        for (const row of payload.items) {
          if (!next[row.nomusPurchaseOrderId]) next[row.nomusPurchaseOrderId] = draftFromRow(row);
        }
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar a worklist.");
    } finally {
      setLoading(false);
    }
  }, [period, q, supplier, evaluationStatus, page]);

  useEffect(() => {
    if (featureEnabled === true) void load();
  }, [featureEnabled, load]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil((data?.total ?? 0) / (data?.pageSize ?? 50))),
    [data]
  );

  const selectedIds = Object.entries(selected)
    .filter(([, on]) => on)
    .map(([id]) => id);

  const setScore = (id: string, key: SupplierEvaluationCriterionKey, value: string) => {
    setDrafts((prev) => ({ ...prev, [id]: { ...(prev[id] ?? EMPTY), [key]: value } }));
  };

  const previewOf = (id: string) => {
    const draft = drafts[id];
    if (!draft) return null;
    try {
      return computeSupplierOrderEvaluation({
        qualityScore: draft.quality,
        deliveryScore: draft.delivery,
        conformityScore: draft.conformity,
        serviceScore: draft.service,
      });
    } catch {
      return null;
    }
  };

  const saveSelected = async () => {
    if (!canUpdate || selectedIds.length === 0) return;
    const rows = data?.items.filter((row) => selectedIds.includes(row.nomusPurchaseOrderId)) ?? [];
    setSaving(true);
    setRowErrors({});
    try {
      const items = [];
      const localErrors: Record<string, string> = {};
      for (const row of rows) {
        if (!row.eligible) {
          localErrors[row.nomusPurchaseOrderId] = row.eligibilityReason ?? "Não elegível.";
          continue;
        }
        const isRevision = row.evaluation != null;
        if (isRevision && !reviewing[row.nomusPurchaseOrderId]) {
          localErrors[row.nomusPurchaseOrderId] = "Clique em Revisar antes de alterar uma avaliação finalizada.";
          continue;
        }
        const preview = previewOf(row.nomusPurchaseOrderId);
        if (!preview) {
          localErrors[row.nomusPurchaseOrderId] =
            "Informe as quatro notas de 0 a 10 com no máximo uma casa decimal.";
          continue;
        }
        const revisionReason = (reasons[row.nomusPurchaseOrderId] ?? "").trim();
        if (isRevision && !revisionReason) {
          localErrors[row.nomusPurchaseOrderId] = "Informe o motivo da revisão.";
          continue;
        }
        items.push({
          nomusPurchaseOrderId: row.nomusPurchaseOrderId,
          qualityScore: preview.scores.quality,
          deliveryScore: preview.scores.delivery,
          conformityScore: preview.scores.conformity,
          serviceScore: preview.scores.service,
          notes: null,
          expectedRevision: row.evaluation?.revision ?? null,
          revisionReason: isRevision ? revisionReason : null,
        });
      }
      if (Object.keys(localErrors).length) setRowErrors(localErrors);
      if (items.length === 0) return;
      const payload = await saveNomusPurchaseOrderSupplierEvaluationsBatchRequest(items);
      const nextErrors = { ...localErrors };
      for (const result of payload.results) {
        if (!result.success) nextErrors[result.nomusPurchaseOrderId] = result.error;
      }
      setRowErrors(nextErrors);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar as avaliações.");
    } finally {
      setSaving(false);
    }
  };

  if (featureEnabled == null) {
    return (
      <div className="space-y-4">
        <PurchaseChainViewNav current="supplier-evaluation" variant="nomus" />
        <p className="text-sm text-muted-foreground">
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
          Verificando a avaliação de fornecedor…
        </p>
      </div>
    );
  }

  if (featureEnabled === false) {
    return (
      <div className="space-y-4">
        <PurchaseChainViewNav current="supplier-evaluation" variant="nomus" />
        <p className="text-sm text-muted-foreground">A avaliação de fornecedor está desligada neste ambiente.</p>
      </div>
    );
  }

  const kpis = data?.kpis;

  return (
    <div className="space-y-4" data-testid="nomus-supplier-evaluation-worklist">
      <PurchaseChainViewNav current="supplier-evaluation" variant="nomus" />
      <p className="text-sm text-muted-foreground">
        Avaliação local do IndusCost pelo Pedido Nomus. A nota do fornecedor é a média das avaliações
        finalizadas — não é digitada no cadastro e não vai ao Nomus.
      </p>

      {kpis ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <Kpi label="Pedidos elegíveis" value={String(kpis.eligibleOrders)} />
          <Kpi label="Pendentes" value={String(kpis.pendingOrders)} />
          <Kpi label="Finalizados" value={String(kpis.evaluatedOrders)} />
          <Kpi
            label="Cobertura"
            value={
              kpis.coverage == null ? "Sem pedidos elegíveis no período" : formatSupplierCoverage(kpis.coverage)
            }
          />
          <Kpi label="Nota média" value={formatSupplierScore(kpis.overallScore)} />
          <Kpi
            label="Q / P / C / A"
            value={`${formatSupplierScore(kpis.qualityScore, 2)} · ${formatSupplierScore(kpis.deliveryScore, 2)} · ${formatSupplierScore(kpis.conformityScore, 2)} · ${formatSupplierScore(kpis.serviceScore, 2)}`}
          />
        </div>
      ) : null}

      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-muted/30 p-3">
        <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-xs text-muted-foreground">
          Pedido
          <input
            value={q}
            onChange={(e) => {
              setPage(1);
              setQ(e.target.value);
            }}
            className="rounded-md border border-border bg-white px-2 py-1.5 text-sm"
            placeholder="Número ou fornecedor"
            data-testid="nse-filter-q"
          />
        </label>
        <label className="flex min-w-[12rem] flex-col gap-1 text-xs text-muted-foreground">
          Fornecedor
          <input
            value={supplier}
            onChange={(e) => {
              setPage(1);
              setSupplier(e.target.value);
            }}
            className="rounded-md border border-border bg-white px-2 py-1.5 text-sm"
            data-testid="nse-filter-supplier"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Período
          <select
            value={periodPreset}
            onChange={(e) => {
              setPage(1);
              setPeriodPreset(e.target.value as SupplierPerformancePeriodPresetId);
            }}
            className="rounded-md border border-border bg-white px-2 py-1.5 text-sm"
            data-testid="nse-filter-period"
          >
            {SUPPLIER_PERFORMANCE_PERIOD_PRESETS.filter((p) => p.id !== "custom").map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Avaliação
          <select
            value={evaluationStatus}
            onChange={(e) => {
              setPage(1);
              setEvaluationStatus(e.target.value);
            }}
            className="rounded-md border border-border bg-white px-2 py-1.5 text-sm"
            data-testid="nse-filter-status"
          >
            <option value="pending">Pendentes</option>
            <option value="evaluated">Finalizados</option>
            <option value="ineligible">Não elegíveis</option>
            <option value="all">Todos</option>
          </select>
        </label>
      </div>

      {error ? <p className="text-sm text-rose-700">{error}</p> : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!canUpdate || saving || selectedIds.length === 0}
          onClick={() => void saveSelected()}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
          data-testid="nse-save-selected"
        >
          {saving ? "Salvando…" : "Salvar / finalizar selecionados"}
        </button>
        <p className="self-center text-[11px] text-muted-foreground">
          Cada pedido tem a sua avaliação. Não há “aplicar a mesma nota a todos”.
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="min-w-full text-left text-xs" data-testid="nse-grid">
          <thead className="bg-muted/50 text-[10px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-2 py-2">
                <span className="sr-only">Selecionar</span>
              </th>
              <th className="px-2 py-2">Pedido</th>
              <th className="px-2 py-2">Fornecedor</th>
              <th className="px-2 py-2">Pedido</th>
              <th className="px-2 py-2">Avaliação</th>
              {SUPPLIER_EVALUATION_CRITERIA.map((c) => (
                <th key={c.key} className="px-2 py-2">
                  {c.shortLabel}
                </th>
              ))}
              <th className="px-2 py-2">Nota</th>
              <th className="px-2 py-2">Ação</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={11} className="px-3 py-8 text-center text-muted-foreground">
                  <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                  Carregando pedidos Nomus…
                </td>
              </tr>
            ) : (data?.items.length ?? 0) === 0 ? (
              <tr>
                <td colSpan={11} className="px-3 py-8 text-center text-muted-foreground">
                  Nenhum pedido neste filtro.
                </td>
              </tr>
            ) : (
              data!.items.map((row) => {
                const id = row.nomusPurchaseOrderId;
                const draft = drafts[id] ?? EMPTY;
                const preview = previewOf(id);
                const locked = !row.eligible || (row.evaluation != null && !reviewing[id]) || !canUpdate;
                const supplierName =
                  row.supplier.resolvedName || row.supplier.nomusName || "Fornecedor não identificado";
                return (
                  <tr key={id} className="border-t border-border" data-testid={`nse-row-${row.orderNumber ?? row.externalId}`}>
                    <td className="px-2 py-1.5">
                      <input
                        type="checkbox"
                        checked={!!selected[id]}
                        disabled={!row.eligible}
                        onChange={(e) => setSelected((prev) => ({ ...prev, [id]: e.target.checked }))}
                        aria-label={`Selecionar ${row.orderNumber ?? row.externalId}`}
                      />
                    </td>
                    <td className="px-2 py-1.5 font-mono font-semibold">
                      {row.orderNumber ?? `Nomus #${row.externalId}`}
                    </td>
                    <td className="px-2 py-1.5">
                      <div>{supplierName}</div>
                      {!row.supplier.identitySafe ? (
                        <div className="text-[10px] text-amber-700">Identidade insegura — não consolida</div>
                      ) : null}
                    </td>
                    <td className="px-2 py-1.5">{nomusPurchaseOrderStageLabel(row.stage)}</td>
                    <td className="px-2 py-1.5">
                      {evaluationStatusLabel(row.evaluationStatus)}
                      {row.evaluation ? ` · ${formatSupplierScore(row.evaluation.scores.overall)}` : ""}
                    </td>
                    {SUPPLIER_EVALUATION_CRITERIA.map((c) => (
                      <td key={c.key} className="px-2 py-1.5">
                        <input
                          value={draft[c.key]}
                          disabled={locked}
                          onChange={(e) => setScore(id, c.key, e.target.value)}
                          className="w-16 rounded border border-border px-1 py-0.5 font-mono disabled:bg-muted"
                          inputMode="decimal"
                          aria-label={c.shortLabel}
                        />
                      </td>
                    ))}
                    <td className="px-2 py-1.5 font-mono font-semibold">
                      {formatSupplierScore(preview?.overallScore ?? row.evaluation?.scores.overall ?? null)}
                    </td>
                    <td className="px-2 py-1.5">
                      {row.evaluation && canUpdate ? (
                        <button
                          type="button"
                          className="text-[11px] font-semibold text-primary"
                          onClick={() => setReviewing((prev) => ({ ...prev, [id]: !prev[id] }))}
                        >
                          {reviewing[id] ? "Cancelar revisão" : "Revisar"}
                        </button>
                      ) : null}
                      {reviewing[id] ? (
                        <input
                          value={reasons[id] ?? ""}
                          onChange={(e) => setReasons((prev) => ({ ...prev, [id]: e.target.value }))}
                          placeholder="Motivo da revisão"
                          className="mt-1 w-40 rounded border border-border px-1 py-0.5"
                        />
                      ) : null}
                      {rowErrors[id] ? (
                        <p className="mt-1 text-[10px] text-rose-700">{rowErrors[id]}</p>
                      ) : null}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-end gap-2 text-xs">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          className="rounded border border-border px-2 py-1 disabled:opacity-50"
        >
          Anterior
        </button>
        <span>
          Página {page} de {totalPages}
        </span>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => setPage((p) => p + 1)}
          className="rounded border border-border px-2 py-1 disabled:opacity-50"
        >
          Próxima
        </button>
      </div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-white px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-semibold">{value}</p>
    </div>
  );
}
