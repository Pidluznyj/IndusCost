import React, { useCallback, useEffect, useState } from "react";
import { TrendingUp, Loader2, RefreshCw, ArrowRight, AlertTriangle } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { fetchJsonOk } from "@/src/lib/http";
import { useNomusParentCodeResolver } from "@/src/hooks/useNomusParentCodeResolver";
import { useNomusMaintenanceWorkspaceSync } from "@/src/hooks/useNomusMaintenanceWorkspaceSync";
import { NomusMaintenanceErrorCard } from "@/src/components/product/NomusMaintenanceErrorCard";
import { NomusMaintenanceProductBanner } from "@/src/components/product/NomusMaintenanceProductBanner";
import { NomusMaintenanceStepHeader } from "@/src/components/product/NomusMaintenanceStepHeader";
import {
  COST_IMPACT_STATUS_LABEL,
  formatNomusStatusLabel,
  nomusStatusBadgeClass,
} from "@/src/lib/nomusMaintenanceStatusLabels";
import type { NomusMaintenanceWorkspaceProps } from "@/src/lib/nomusMaintenanceWorkspaceTypes";
import type {
  CostImpactComparisonLine,
  CostImpactLine,
  NomusEffectiveBomCostImpactResult,
} from "@/src/lib/nomusEffectiveBomCostImpactTypes";
import {
  NOMUS_IMPACT_CURRENT_LABEL,
  NOMUS_IMPACT_DELTA_MONEY_LABEL,
  NOMUS_IMPACT_DELTA_PCT_LABEL,
  NOMUS_IMPACT_EXPLANATION,
  NOMUS_IMPACT_SIMULATED_LABEL,
  NOMUS_IMPACT_USAGE_NOTE,
  formatProductCiu,
} from "@/src/lib/productCostDisplay";

const COMPARISON_STATUS_LABEL: Record<string, string> = {
  SAME_COMPONENT_SAME_QTY: "Igual",
  SAME_COMPONENT_QTY_DIFF: "Qtd diferente",
  ONLY_CURRENT_INDUS: "Só IndusCost",
  ONLY_EFFECTIVE_NOMUS: "Só Nomus efetivo",
  INCLUDED_BY_REVIEW: "Incluído por revisão",
  LOCAL_INCLUDED_BY_REVIEW: "Componente local incluído",
  EXCLUDED_BY_NOMUS_EFFECTIVE: "Excluído Nomus",
  UNRESOLVED_COST: "Custo não resolvido",
};

function isLocalIncludedComparisonLine(line: CostImpactComparisonLine): boolean {
  return (
    line.status === "LOCAL_INCLUDED_BY_REVIEW" || line.status === "INCLUDED_BY_REVIEW"
  );
}

function formatMoney(v: number | null | undefined): string {
  return formatProductCiu(v);
}

function formatPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

function formatQty(v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toLocaleString("pt-BR", { maximumFractionDigits: 4 });
}

function ComparisonTable({
  title,
  lines,
  emptyMessage,
}: {
  title: string;
  lines: CostImpactComparisonLine[];
  emptyMessage: string;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-bold">{title}</p>
      {lines.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">{emptyMessage}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 text-[10px] uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-2 py-1.5">Componente</th>
                <th className="text-left px-2 py-1.5">Descrição</th>
                <th className="text-right px-2 py-1.5">Qtd atual</th>
                <th className="text-right px-2 py-1.5">Qtd efetiva</th>
                <th className="text-right px-2 py-1.5">Custo atual</th>
                <th className="text-right px-2 py-1.5">Custo efetivo</th>
                <th className="text-right px-2 py-1.5">Diferença</th>
                <th className="text-left px-2 py-1.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr
                  key={`${line.componentCode}-${line.status}`}
                  className={cn(
                    "border-t border-border/60",
                    line.status === "LOCAL_INCLUDED_BY_REVIEW" && "bg-teal-50/60"
                  )}
                >
                  <td className="px-2 py-1.5 font-medium">{line.componentCode}</td>
                  <td className="px-2 py-1.5 text-muted-foreground max-w-[160px]">
                    <span className="block truncate">{line.description ?? "—"}</span>
                    {isLocalIncludedComparisonLine(line) ? (
                      <span className="block text-[9px] text-teal-800 mt-0.5 leading-tight">
                        {COMPARISON_STATUS_LABEL[line.status] ?? line.status}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{formatQty(line.currentQuantity)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{formatQty(line.effectiveQuantity)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{formatMoney(line.currentCost)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{formatMoney(line.effectiveCost)}</td>
                  <td
                    className={cn(
                      "px-2 py-1.5 text-right tabular-nums font-medium",
                      line.deltaCost != null && line.deltaCost > 0 && "text-red-700",
                      line.deltaCost != null && line.deltaCost < 0 && "text-green-700"
                    )}
                  >
                    {formatMoney(line.deltaCost)}
                  </td>
                  <td className="px-2 py-1.5">
                    <span className="text-[10px] font-medium">
                      {COMPARISON_STATUS_LABEL[line.status] ?? line.status}
                    </span>
                    {line.explanation && isLocalIncludedComparisonLine(line) ? (
                      <span className="block text-[9px] text-muted-foreground mt-0.5 max-w-[200px] leading-tight">
                        {line.explanation}
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function DetailLinesTable({ title, lines }: { title: string; lines: CostImpactLine[] }) {
  if (lines.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-xs font-bold">{title}</p>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-xs">
          <thead className="bg-muted/50 text-[10px] uppercase text-muted-foreground">
            <tr>
              <th className="text-left px-2 py-1.5">Componente</th>
              <th className="text-right px-2 py-1.5">Qtd</th>
              <th className="text-right px-2 py-1.5">Custo linha</th>
              <th className="text-left px-2 py-1.5">Origem</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={`${line.componentCode}-${line.source}`} className="border-t border-border/60">
                <td className="px-2 py-1.5 font-medium">{line.componentCode}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{formatQty(line.quantity)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{formatMoney(line.totalCost)}</td>
                <td className="px-2 py-1.5 text-muted-foreground text-[10px]">{line.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type NomusEffectiveBomCostImpactPanelProps = NomusMaintenanceWorkspaceProps & {
  disabled?: boolean;
  onGoToPending?: () => void;
};

export const NomusEffectiveBomCostImpactPanel: React.FC<NomusEffectiveBomCostImpactPanelProps> = ({
  disabled = false,
  onGoToPending,
  selectedParentCode,
  selectedParentDescription,
  selectedIndusProductId,
  onWorkspaceParentChange,
  refreshToken = 0,
}) => {
  const workspaceFocused = Boolean(selectedParentCode?.trim());
  const [parentCode, setParentCode] = useState(selectedParentCode ?? "");
  const [recursive, setRecursive] = useState(false);
  const [lotSize, setLotSize] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoLoadFailed, setAutoLoadFailed] = useState(false);
  const [result, setResult] = useState<NomusEffectiveBomCostImpactResult | null>(null);
  const [paramsDirty, setParamsDirty] = useState(false);
  const { resolveThen, pickerModal, notFoundMessage } = useNomusParentCodeResolver();

  const { reportWorkspaceSelection } = useNomusMaintenanceWorkspaceSync({
    selectedParentCode,
    selectedParentDescription,
    selectedIndusProductId,
    onWorkspaceParentChange,
    setLocalCode: setParentCode,
  });

  const fetchCostImpact = useCallback(
    async (resolvedParentCode: string): Promise<NomusEffectiveBomCostImpactResult> => {
      const params = new URLSearchParams({ parentCode: resolvedParentCode });
      if (recursive) params.set("recursive", "true");
      const lot = lotSize.trim();
      if (lot) params.set("lotSize", lot);
      return fetchJsonOk<NomusEffectiveBomCostImpactResult>(
        `/api/nomus/effective-pricing-bom/cost-impact?${params.toString()}`
      );
    },
    [lotSize, recursive]
  );

  const load = useCallback(async () => {
    const code = parentCode.trim();
    if (!code) {
      setError("Informe o SKU / parentCode.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const outcome = await resolveThen(code, async (resolved, option) => {
        setLoading(true);
        setParentCode(resolved);
        reportWorkspaceSelection(resolved, option);
        try {
          const data = await fetchCostImpact(resolved);
          setResult(data);
        } finally {
          setLoading(false);
        }
      });
      if (!outcome.ok && outcome.reason === "none") {
        setResult(null);
        setError(notFoundMessage);
      }
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : "Erro ao calcular impacto de custo.");
    } finally {
      setLoading(false);
    }
  }, [fetchCostImpact, notFoundMessage, parentCode, resolveThen]);

  useEffect(() => {
    const code = selectedParentCode?.trim();
    if (!code) return;
    setError(null);
    setAutoLoadFailed(false);
    setLoading(true);
    void fetchCostImpact(code)
      .then((data) => {
        setResult(data);
        setAutoLoadFailed(false);
        setParamsDirty(false);
      })
      .catch((e) => {
        setResult(null);
        setAutoLoadFailed(true);
        setError(e instanceof Error ? e.message : "Erro ao calcular impacto de custo.");
      })
      .finally(() => setLoading(false));
  }, [fetchCostImpact, refreshToken, selectedParentCode]);

  const lines = result?.lines ?? [];
  const topMovers = [...lines]
    .filter((l) => l.deltaCost != null && Math.abs(l.deltaCost) > 0.01)
    .sort((a, b) => Math.abs(b.deltaCost ?? 0) - Math.abs(a.deltaCost ?? 0))
    .slice(0, 8);
  const localIncluded = lines.filter((l) => l.status === "LOCAL_INCLUDED_BY_REVIEW");
  const hasPendingImpact =
    result?.optionalPricingStatus === "PENDING" ||
    result?.optionalPricingStatus === "STALE" ||
    result?.status === "BLOCKED_EFFECTIVE_BOM_NOT_READY";
  const includedLines = result?.includedLines ?? [];
  const excludedLines = result?.excludedLines ?? [];
  const unresolvedLines = result?.unresolvedLines ?? [];
  const currentCost = result?.currentCost;
  const effectiveCost = result?.effectiveNomusCost;
  const delta = result?.delta;

  if (!workspaceFocused) {
    return (
      <div className="space-y-4">
        <NomusMaintenanceStepHeader tab="cost-impact" />
        <NomusMaintenanceProductBanner />
        <p className="text-sm text-muted-foreground">
          Selecione um produto no topo para calcular o impacto de custo.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-dashed border-primary/30 bg-card/50 p-5 space-y-4">
      <NomusMaintenanceStepHeader tab="cost-impact" />
      <NomusMaintenanceProductBanner
        parentCode={selectedParentCode}
        description={selectedParentDescription}
        compact
      />

      <div className="flex flex-wrap items-end gap-2">
        <div className="w-28">
          <label className="text-xs font-semibold uppercase text-muted-foreground">Lote (opc.)</label>
          <input
            type="text"
            value={lotSize}
            onChange={(e) => {
              setLotSize(e.target.value);
              setParamsDirty(true);
            }}
            placeholder="Opc."
            className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-3 text-sm"
          />
        </div>
        <label className="flex items-center gap-2 text-sm h-9 px-3 rounded-lg border border-border bg-background cursor-pointer">
          <input
            type="checkbox"
            checked={recursive}
            onChange={(e) => {
              setRecursive(e.target.checked);
              setParamsDirty(true);
            }}
            className="rounded"
          />
          Usar árvore recursiva
        </label>
        <button
          type="button"
          disabled={disabled || loading || !selectedParentCode}
          onClick={() => {
            const code = selectedParentCode?.trim();
            if (!code) return;
            setLoading(true);
            setError(null);
            void fetchCostImpact(code)
              .then((data) => {
                setResult(data);
                setAutoLoadFailed(false);
                setParamsDirty(false);
              })
              .catch((e) => {
                setResult(null);
                setAutoLoadFailed(true);
                setError(e instanceof Error ? e.message : "Erro ao calcular impacto de custo.");
              })
              .finally(() => setLoading(false));
          }}
          className={cn(
            "inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold disabled:opacity-50",
            paramsDirty
              ? "border-primary bg-primary/10 text-primary"
              : "border-border bg-background hover:bg-accent"
          )}
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          Recalcular impacto
        </button>
      </div>
      {paramsDirty && result ? (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Lote ou árvore recursiva alterados. Clique em &quot;Recalcular impacto&quot; para atualizar os
          valores.
        </p>
      ) : null}

      {error ? (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
      ) : null}

      {autoLoadFailed && !loading && !result ? (
        <NomusMaintenanceErrorCard
          onRetry={() => {
            const code = selectedParentCode?.trim();
            if (!code) return;
            setLoading(true);
            void fetchCostImpact(code)
              .then((data) => {
                setResult(data);
                setAutoLoadFailed(false);
                setError(null);
                setParamsDirty(false);
              })
              .catch((e) => {
                setAutoLoadFailed(true);
                setError(e instanceof Error ? e.message : "Erro ao calcular impacto de custo.");
              })
              .finally(() => setLoading(false));
          }}
        />
      ) : null}

      {loading && !result ? (
        <p className="text-xs text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Calculando impacto de custo…
        </p>
      ) : null}

      {result ? (
        <>
          <div className="flex flex-wrap gap-2 items-center">
            <span
              className={cn(
                "inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-bold",
                nomusStatusBadgeClass(result.status)
              )}
            >
              {formatNomusStatusLabel(result.status, COST_IMPACT_STATUS_LABEL)}
            </span>
            <span className="text-[10px] text-muted-foreground">
              BOM: {formatNomusStatusLabel(result.effectiveBomStatus)}
            </span>
          </div>

          {hasPendingImpact ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] text-amber-950 flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                Há pendências que podem afetar o impacto.
              </p>
              {onGoToPending ? (
                <button
                  type="button"
                  onClick={onGoToPending}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
                >
                  Resolver pendências
                  <ArrowRight className="h-3 w-3" />
                </button>
              ) : null}
            </div>
          ) : null}

          {(result.warnings ?? []).length > 0 ? (
            <ul className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 list-disc list-inside">
              {(result.warnings ?? []).map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          ) : null}

          {localIncluded.length > 0 ? (
            <div className="rounded-lg border border-teal-200 bg-teal-50 px-3 py-2">
              <p className="text-[11px] font-bold text-teal-950">Componentes locais incluídos</p>
              <ul className="mt-1 text-[11px] text-teal-900 space-y-0.5">
                {localIncluded.map((l) => {
                  const reconciled =
                    (l.deltaCost == null || Math.abs(l.deltaCost) < 0.000001) &&
                    (l.currentCost == null ||
                      l.effectiveCost == null ||
                      Math.abs((l.currentCost ?? 0) - (l.effectiveCost ?? 0)) < 0.000001);
                  return (
                    <li key={l.componentCode}>
                      {l.componentCode}
                      {l.description ? ` — ${l.description}` : ""}
                      <span className="text-teal-700">
                        {" "}
                        ·{" "}
                        {reconciled
                          ? "componente local mantido — sem impacto de custo"
                          : "componente local incluído"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          {result &&
          result.status === "READY" &&
          (result.hasStructuralChanges === false ||
            (delta != null && Math.abs(delta.totalCost ?? 0) < 0.000001)) ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-950">
              <p className="font-bold">A ProductBOM já reflete a BOM efetiva.</p>
              <p>
                {result.noOpReason === "PRODUCT_BOM_ALREADY_MATCHES_EFFECTIVE_BOM"
                  ? "Nenhuma alteração estrutural prevista. Aplicar a BOM efetiva não altera o custo do produto."
                  : "A aplicação não deve alterar o custo por estrutura. Linhas locais já existentes na ProductBOM atual são mantidas sem impacto."}
              </p>
            </div>
          ) : null}

          <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 space-y-1.5 text-[11px] text-muted-foreground">
            <p>{NOMUS_IMPACT_EXPLANATION}</p>
            <p>{NOMUS_IMPACT_USAGE_NOTE}</p>
          </div>

          <div className="grid gap-2 grid-cols-2 sm:grid-cols-4 text-xs">
            {[
              {
                label: NOMUS_IMPACT_CURRENT_LABEL,
                sub: "ProductBOM salva no IndusCost",
                value: formatMoney(currentCost?.totalCost),
                highlight: false,
              },
              {
                label: NOMUS_IMPACT_SIMULATED_LABEL,
                sub: "BOM Nomus + opcionais + decisões locais",
                value: formatMoney(effectiveCost?.totalCost),
                highlight: false,
              },
              {
                label: NOMUS_IMPACT_DELTA_MONEY_LABEL,
                sub: "Simulação − atual",
                value: formatMoney(delta?.totalCost),
                highlight: true,
              },
              {
                label: NOMUS_IMPACT_DELTA_PCT_LABEL,
                sub: null,
                value: formatPct(delta?.totalCostPct),
                highlight: true,
              },
            ].map((c) => (
              <div
                key={c.label}
                className={cn(
                  "rounded-lg border px-3 py-2",
                  c.highlight ? "border-primary/40 bg-primary/5" : "border-border bg-background"
                )}
              >
                <p className="text-[10px] uppercase text-muted-foreground font-semibold leading-tight">
                  {c.label}
                </p>
                {"sub" in c && c.sub ? (
                  <p className="text-[9px] text-muted-foreground/90 mt-0.5 leading-tight">{c.sub}</p>
                ) : null}
                <p className="font-bold mt-1 tabular-nums">{c.value}</p>
              </div>
            ))}
          </div>

          {topMovers.length > 0 ? (
            <ComparisonTable
              title="Principais componentes que mudaram"
              lines={topMovers}
              emptyMessage=""
            />
          ) : null}

          {currentCost && effectiveCost ? (
            <div className="grid gap-2 sm:grid-cols-2 text-[11px]">
              <div className="rounded-lg border border-border p-2">
                <p className="font-bold mb-1">{NOMUS_IMPACT_CURRENT_LABEL} (detalhe)</p>
                <p>Material: {formatMoney(currentCost.materialCost)}</p>
                <p>Transformação: {formatMoney(currentCost.transformationCost)}</p>
              </div>
              <div className="rounded-lg border border-border p-2">
                <p className="font-bold mb-1">{NOMUS_IMPACT_SIMULATED_LABEL} (detalhe)</p>
                <p>Material: {formatMoney(effectiveCost.materialCost)}</p>
                <p>Transformação: {formatMoney(effectiveCost.transformationCost)}</p>
              </div>
            </div>
          ) : null}

          <ComparisonTable
            title="Resumo por componente"
            lines={lines}
            emptyMessage="Nenhuma linha para comparar."
          />

          <DetailLinesTable title="Linhas incluídas na BOM efetiva" lines={includedLines} />
          <DetailLinesTable title="Linhas excluídas / revisão (sem custo efetivo)" lines={excludedLines} />
          {unresolvedLines.length > 0 ? (
            <DetailLinesTable title="Alertas — custo não resolvido" lines={unresolvedLines} />
          ) : null}
        </>
      ) : !loading && !error && !autoLoadFailed ? (
        <p className="text-sm text-muted-foreground">
          Nenhum impacto calculado. Use &quot;Recalcular impacto&quot; ou &quot;Atualizar BOM e custo&quot; no
          topo.
        </p>
      ) : null}

      {pickerModal}
    </div>
  );
};

