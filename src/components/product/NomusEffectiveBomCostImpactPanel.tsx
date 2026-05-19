import React, { useCallback, useEffect, useState } from "react";
import { TrendingUp, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { fetchJsonOk } from "@/src/lib/http";
import type {
  CostImpactComparisonLine,
  CostImpactLine,
  CostImpactStatus,
  NomusEffectiveBomCostImpactResult,
} from "@/src/lib/nomusEffectiveBomCostImpactTypes";

const STATUS_LABEL: Record<CostImpactStatus, string> = {
  READY: "Pronto",
  BLOCKED_EFFECTIVE_BOM_NOT_READY: "BOM efetiva não pronta",
  NO_INDUS_PRODUCT: "Sem produto IndusCost",
  CURRENT_COST_UNAVAILABLE: "Custo atual indisponível",
};

const STATUS_CLASS: Record<CostImpactStatus, string> = {
  READY: "bg-green-100 text-green-800",
  BLOCKED_EFFECTIVE_BOM_NOT_READY: "bg-amber-100 text-amber-900",
  NO_INDUS_PRODUCT: "bg-muted text-muted-foreground",
  CURRENT_COST_UNAVAILABLE: "bg-orange-100 text-orange-900",
};

const COMPARISON_STATUS_LABEL: Record<string, string> = {
  SAME_COMPONENT_SAME_QTY: "Igual",
  SAME_COMPONENT_QTY_DIFF: "Qtd diferente",
  ONLY_CURRENT_INDUS: "Só IndusCost",
  ONLY_EFFECTIVE_NOMUS: "Só Nomus efetivo",
  INCLUDED_BY_REVIEW: "Incluído por revisão",
  EXCLUDED_BY_NOMUS_EFFECTIVE: "Excluído Nomus",
  UNRESOLVED_COST: "Custo não resolvido",
};

function formatMoney(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
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
                  className="border-t border-border/60"
                >
                  <td className="px-2 py-1.5 font-medium">{line.componentCode}</td>
                  <td className="px-2 py-1.5 text-muted-foreground max-w-[140px] truncate">
                    {line.description ?? "—"}
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
                    <span className="text-[10px]">{COMPARISON_STATUS_LABEL[line.status] ?? line.status}</span>
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

type NomusEffectiveBomCostImpactPanelProps = {
  disabled?: boolean;
  initialParentCode?: string;
};

export const NomusEffectiveBomCostImpactPanel: React.FC<NomusEffectiveBomCostImpactPanelProps> = ({
  disabled = false,
  initialParentCode = "",
}) => {
  const [parentCode, setParentCode] = useState(initialParentCode);
  const [recursive, setRecursive] = useState(false);
  const [lotSize, setLotSize] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<NomusEffectiveBomCostImpactResult | null>(null);

  useEffect(() => {
    if (initialParentCode) setParentCode(initialParentCode);
  }, [initialParentCode]);

  const load = useCallback(async () => {
    const code = parentCode.trim();
    if (!code) {
      setError("Informe o SKU / parentCode.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ parentCode: code });
      if (recursive) params.set("recursive", "true");
      const lot = lotSize.trim();
      if (lot) params.set("lotSize", lot);
      const data = await fetchJsonOk<NomusEffectiveBomCostImpactResult>(
        `/api/nomus/effective-pricing-bom/cost-impact?${params.toString()}`
      );
      setResult(data);
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : "Erro ao calcular impacto de custo.");
    } finally {
      setLoading(false);
    }
  }, [parentCode, recursive, lotSize]);

  const lines = result?.lines ?? [];
  const includedLines = result?.includedLines ?? [];
  const excludedLines = result?.excludedLines ?? [];
  const unresolvedLines = result?.unresolvedLines ?? [];
  const currentCost = result?.currentCost;
  const effectiveCost = result?.effectiveNomusCost;
  const delta = result?.delta;

  return (
    <div className="rounded-xl border border-dashed border-primary/30 bg-card/50 p-4 space-y-4">
      <div>
        <h4 className="text-sm font-bold flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          Impacto de custo da BOM efetiva Nomus
        </h4>
        <p className="text-[11px] text-muted-foreground mt-1 max-w-3xl">
          Compara o custo atual do IndusCost com um preview usando a BOM efetiva Nomus. Esta análise
          é somente leitura e não altera ProductBOM, custo ou preço.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[160px] flex-1">
          <label className="text-[10px] font-semibold uppercase text-muted-foreground">
            SKU / parentCode
          </label>
          <input
            type="text"
            value={parentCode}
            onChange={(e) => setParentCode(e.target.value)}
            placeholder="Ex.: 610.73BA"
            className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-3 text-xs"
          />
        </div>
        <div className="w-24">
          <label className="text-[10px] font-semibold uppercase text-muted-foreground">Lote</label>
          <input
            type="text"
            value={lotSize}
            onChange={(e) => setLotSize(e.target.value)}
            placeholder="Opc."
            className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-3 text-xs"
          />
        </div>
        <label className="flex items-center gap-2 text-xs h-9 px-2 rounded-lg border border-border bg-background cursor-pointer">
          <input
            type="checkbox"
            checked={recursive}
            onChange={(e) => setRecursive(e.target.checked)}
            className="rounded"
          />
          Usar árvore recursiva
        </label>
        <button
          type="button"
          disabled={disabled || loading}
          onClick={() => void load()}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Calcular impacto
        </button>
      </div>

      {error ? (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
      ) : null}

      {result ? (
        <>
          <div className="flex flex-wrap gap-2 items-center">
            <span
              className={cn(
                "inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-bold",
                STATUS_CLASS[result.status]
              )}
            >
              {STATUS_LABEL[result.status]}
            </span>
            <span className="text-[10px] text-muted-foreground">BOM: {result.effectiveBomStatus}</span>
          </div>

          {result.warnings.length > 0 ? (
            <ul className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 list-disc list-inside">
              {result.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          ) : null}

          <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 text-xs">
            {[
              { label: "Custo atual", value: formatMoney(currentCost?.totalCost) },
              { label: "Custo BOM efetiva", value: formatMoney(effectiveCost?.totalCost) },
              { label: "Diferença R$", value: formatMoney(delta?.totalCost) },
              { label: "Diferença %", value: formatPct(delta?.totalCostPct) },
              {
                label: "Sem custo resolvido",
                value: String(result.summary.unresolvedCostLinesCount ?? 0),
              },
            ].map((c) => (
              <div key={c.label} className="rounded-lg border border-border bg-background px-3 py-2">
                <p className="text-[10px] uppercase text-muted-foreground font-semibold">{c.label}</p>
                <p className="font-bold mt-1 tabular-nums">{c.value}</p>
              </div>
            ))}
          </div>

          {currentCost && effectiveCost ? (
            <div className="grid gap-2 sm:grid-cols-2 text-[11px]">
              <div className="rounded-lg border border-border p-2">
                <p className="font-bold mb-1">Custo atual (detalhe)</p>
                <p>Material: {formatMoney(currentCost.materialCost)}</p>
                <p>Transformação: {formatMoney(currentCost.transformationCost)}</p>
              </div>
              <div className="rounded-lg border border-border p-2">
                <p className="font-bold mb-1">Custo BOM efetiva (detalhe)</p>
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
      ) : null}
    </div>
  );
};


