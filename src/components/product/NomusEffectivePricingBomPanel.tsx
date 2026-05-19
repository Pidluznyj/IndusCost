import React, { useCallback, useEffect, useState } from "react";
import { Layers, Loader2, RefreshCw, ChevronRight, ArrowRight } from "lucide-react";
import { NomusLocalReviewSection } from "@/src/components/product/NomusLocalReviewSection";
import { NomusMaintenanceErrorCard } from "@/src/components/product/NomusMaintenanceErrorCard";
import { NomusMaintenanceProductBanner } from "@/src/components/product/NomusMaintenanceProductBanner";
import { NomusMaintenanceStepHeader } from "@/src/components/product/NomusMaintenanceStepHeader";
import { cn } from "@/src/lib/utils";
import {
  EFFECTIVE_BOM_STATUS_LABEL,
  OPTIONAL_PRICING_STATUS_LABEL,
  formatNomusStatusLabel,
  nomusStatusBadgeClass,
} from "@/src/lib/nomusMaintenanceStatusLabels";
import { fetchJsonOk } from "@/src/lib/http";
import { useNomusParentCodeResolver } from "@/src/hooks/useNomusParentCodeResolver";
import { useNomusMaintenanceWorkspaceSync } from "@/src/hooks/useNomusMaintenanceWorkspaceSync";
import type { NomusMaintenanceWorkspaceProps } from "@/src/lib/nomusMaintenanceWorkspaceTypes";
import type {
  EffectivePricingBomLine,
  EffectivePricingBomResult,
  EffectivePricingBomTreeNode,
} from "@/src/lib/nomusEffectivePricingBomTypes";

const SOURCE_LABEL: Record<string, string> = {
  NOMUS_REQUIRED: "Obrigatório Nomus",
  NOMUS_OPTIONAL_SELECTED: "Opcional selecionado",
  NOMUS_OPTIONAL_NOT_SELECTED: "Opcional não selecionado",
  NOMUS_OPTIONAL_SELECTED_NONE: "Grupo: nenhum",
  NOMUS_ALTERNATIVE_SELECTED: "Alternativa selecionada",
  NOMUS_ALTERNATIVE_NOT_SELECTED: "Alternativa não selecionada",
  LOCAL_ONLY_INDUS_REVIEW: "Somente IndusCost",
  LOCAL_ONLY_INCLUDED_BY_REVIEW: "Componente local incluído",
  LOCAL_ONLY_EXCLUDED_BY_REVIEW: "Local excluído",
  LOCAL_ONLY_DUPLICATED_BY_NOMUS: "Duplicado Nomus",
  LOCAL_ONLY_ENGINEERING_REVIEW: "Engenharia",
  OPERATIONAL_ROUTING_COST: "Roteiro/processo",
  OPERATIONAL_IGNORED: "Operacional ignorado",
};

function formatQty(v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toLocaleString("pt-BR", { maximumFractionDigits: 4 });
}

function LinesTable({
  title,
  lines,
  emptyMessage,
}: {
  title: string;
  lines: EffectivePricingBomLine[];
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
                <th className="text-right px-2 py-1.5">Qtd</th>
                <th className="text-left px-2 py-1.5">Origem</th>
                <th className="text-left px-2 py-1.5">Decisão</th>
                <th className="text-left px-2 py-1.5">Grupo</th>
                <th className="text-left px-2 py-1.5">Motivo</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr
                  key={`${line.componentCode}-${line.source}-${line.productBomLineId ?? line.reason}`}
                  className="border-t border-border/60"
                >
                  <td className="px-2 py-1.5 font-medium">{line.componentCode}</td>
                  <td className="px-2 py-1.5 text-muted-foreground max-w-[180px] truncate">
                    {line.componentDescription ?? "—"}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{formatQty(line.quantity)}</td>
                  <td className="px-2 py-1.5">{SOURCE_LABEL[line.source] ?? line.source}</td>
                  <td className="px-2 py-1.5">{line.decision}</td>
                  <td className="px-2 py-1.5 text-muted-foreground">
                    {line.groupName ?? line.relatedNomusComponentCode ?? "—"}
                  </td>
                  <td className="px-2 py-1.5 text-muted-foreground max-w-[220px]">{line.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function TreeBranch({ node, depth = 0 }: { node: EffectivePricingBomTreeNode; depth?: number }) {
  const indent = depth * 16;
  return (
    <div>
      <div
        className={cn(
          "text-xs py-0.5 flex flex-wrap gap-2 items-baseline",
          !node.includedForPricing && "text-muted-foreground"
        )}
        style={{ paddingLeft: indent }}
      >
        <ChevronRight className="h-3 w-3 shrink-0 opacity-50" />
        <span className="font-semibold">{node.componentCode}</span>
        {node.description ? (
          <span className="text-muted-foreground truncate max-w-[200px]">{node.description}</span>
        ) : null}
        <span className="text-[10px] tabular-nums">
          qtd acum. {formatQty(node.accumulatedQuantity)}
        </span>
        <span className="text-[10px]">{SOURCE_LABEL[node.source] ?? node.source}</span>
        {node.resolution === "UNRESOLVED_COMPONENT" ? (
          <span className="text-[10px] font-bold text-red-700">não resolvido</span>
        ) : node.resolution ? (
          <span className="text-[10px] text-muted-foreground">{node.resolution}</span>
        ) : null}
      </div>
      {node.children.map((child) => (
        <div key={`${child.parentCode}-${child.componentCode}-${child.level}`}>
          <TreeBranch node={child} depth={depth + 1} />
        </div>
      ))}
    </div>
  );
}

type NomusEffectivePricingBomPanelProps = NomusMaintenanceWorkspaceProps & {
  disabled?: boolean;
  onViewCostImpact?: (parentCode: string) => void;
  onGoToPending?: () => void;
  hideLocalReviewSection?: boolean;
};

export const NomusEffectivePricingBomPanel: React.FC<NomusEffectivePricingBomPanelProps> = ({
  disabled = false,
  onViewCostImpact,
  onGoToPending,
  hideLocalReviewSection = true,
  selectedParentCode,
  selectedParentDescription,
  selectedIndusProductId,
  onWorkspaceParentChange,
  refreshToken = 0,
}) => {
  const workspaceFocused = Boolean(selectedParentCode?.trim());
  const [parentCode, setParentCode] = useState("");
  const [recursive, setRecursive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoLoadFailed, setAutoLoadFailed] = useState(false);
  const [result, setResult] = useState<EffectivePricingBomResult | null>(null);
  const { resolveThen, pickerModal, notFoundMessage } = useNomusParentCodeResolver();
  const { reportWorkspaceSelection } = useNomusMaintenanceWorkspaceSync({
    selectedParentCode,
    selectedParentDescription,
    selectedIndusProductId,
    onWorkspaceParentChange,
    setLocalCode: setParentCode,
  });

  const fetchEffectiveBom = useCallback(
    async (resolvedParentCode: string) => {
      const params = new URLSearchParams({ parentCode: resolvedParentCode });
      if (recursive) params.set("recursive", "true");
      const data = await fetchJsonOk<EffectivePricingBomResult>(
        `/api/nomus/effective-pricing-bom?${params.toString()}`
      );
      setResult(data);
    },
    [recursive]
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
          await fetchEffectiveBom(resolved);
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
      setError(e instanceof Error ? e.message : "Erro ao gerar BOM efetiva.");
    } finally {
      setLoading(false);
    }
  }, [fetchEffectiveBom, notFoundMessage, parentCode, resolveThen]);

  useEffect(() => {
    const code = selectedParentCode?.trim();
    if (!code) return;
    setError(null);
    setAutoLoadFailed(false);
    setLoading(true);
    void fetchEffectiveBom(code)
      .then((data) => {
        setResult(data);
        setAutoLoadFailed(false);
      })
      .catch((e) => {
        setResult(null);
        setAutoLoadFailed(true);
        setError(e instanceof Error ? e.message : "Erro ao gerar BOM efetiva.");
      })
      .finally(() => setLoading(false));
  }, [fetchEffectiveBom, refreshToken, selectedParentCode]);

  const included = result?.directLines ?? [];
  const excluded = result?.excludedLines ?? [];
  const review = result?.reviewLines ?? [];
  const catalog = result?.localReviewCatalog ?? [];
  const summary = result?.summary;

  if (!workspaceFocused) {
    return (
      <div className="space-y-4">
        <NomusMaintenanceStepHeader tab="effective-pricing-bom" />
        <NomusMaintenanceProductBanner />
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-dashed border-primary/30 bg-card/50 p-5 space-y-4">
      <NomusMaintenanceStepHeader tab="effective-pricing-bom" />
      <NomusMaintenanceProductBanner
        parentCode={selectedParentCode}
        description={selectedParentDescription}
        compact
      />

      <label className="flex items-center gap-2 text-sm h-9 px-3 rounded-lg border border-border bg-background cursor-pointer w-fit">
        <input
          type="checkbox"
          checked={recursive}
          onChange={(e) => setRecursive(e.target.checked)}
          className="rounded"
        />
        Mostrar árvore recursiva
      </label>

      {error ? (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
      ) : null}

      {autoLoadFailed && !loading && !result ? (
        <NomusMaintenanceErrorCard onRetry={() => void load()} />
      ) : null}

      {loading && !result ? (
        <p className="text-xs text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Carregando BOM efetiva…
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
              {formatNomusStatusLabel(result.status, EFFECTIVE_BOM_STATUS_LABEL)}
            </span>
            <span className="text-[10px] text-muted-foreground">
              Opcionais:{" "}
              {formatNomusStatusLabel(
                result.optionalPricingStatus,
                OPTIONAL_PRICING_STATUS_LABEL
              )}
            </span>
            {result.selectedList?.listaMateriaisNome ? (
              <span className="text-[10px] text-muted-foreground">
                Lista: {result.selectedList.listaMateriaisNome}
              </span>
            ) : null}
            {onViewCostImpact && result.parentCode ? (
              <button
                type="button"
                onClick={() => onViewCostImpact(result.parentCode)}
                className="text-[10px] font-semibold text-primary hover:underline"
              >
                Ver impacto de custo
              </button>
            ) : null}
          </div>

          {(result.warnings ?? []).length > 0 ? (
            <ul className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 list-disc list-inside">
              {(result.warnings ?? []).map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          ) : null}

          <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-8 text-xs">
            {[
              { label: "Incluídos", value: summary?.includedLinesCount ?? 0 },
              { label: "Opc. selecionados", value: summary?.optionalSelectedCount ?? 0 },
              { label: "Locais incluídos", value: summary?.localIncludedByReviewCount ?? 0 },
              { label: "Revisão pendente", value: summary?.localReviewPendingCount ?? 0 },
              { label: "Revisão resolvida", value: summary?.localReviewResolvedCount ?? 0 },
              { label: "Excluídos", value: summary?.excludedLinesCount ?? 0 },
              { label: "Roteiro/processo", value: summary?.operationalRoutingReviewCount ?? 0 },
              { label: "Bloqueios", value: summary?.blockedLinesCount ?? 0 },
            ].map((c) => (
              <div key={c.label} className="rounded-lg border border-border bg-background px-3 py-2">
                <p className="text-[10px] uppercase text-muted-foreground font-semibold">{c.label}</p>
                <p className="font-bold mt-1 tabular-nums">{c.value}</p>
              </div>
            ))}
          </div>

          {result &&
          onGoToPending &&
          ((summary?.localReviewPendingCount ?? 0) > 0 ||
            result.optionalPricingStatus === "PENDING" ||
            result.optionalPricingStatus === "STALE") ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] text-amber-950">
                Há pendências de opcionais ou itens locais que podem afetar esta BOM.
              </p>
              <button
                type="button"
                onClick={onGoToPending}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
              >
                Resolver pendências
                <ArrowRight className="h-3 w-3" />
              </button>
            </div>
          ) : null}

          {result.parentCode && !hideLocalReviewSection ? (
            <NomusLocalReviewSection
              parentCode={result.parentCode}
              parentProductId={result.indusProductId}
              catalog={catalog}
              disabled={disabled || loading}
              onSaved={() => void load()}
            />
          ) : null}

          <LinesTable
            title="Itens incluídos para precificação"
            lines={included}
            emptyMessage="Nenhum item incluído na BOM efetiva."
          />

          <LinesTable
            title="Itens excluídos"
            lines={excluded}
            emptyMessage="Nenhum item excluído."
          />

          <LinesTable
            title="Outros itens em revisão"
            lines={review}
            emptyMessage="Nenhum outro item pendente de revisão."
          />

          {(result.recursiveTree ?? []).length > 0 ? (
            <div className="space-y-2 rounded-lg border border-border p-3">
              <p className="text-xs font-bold">Árvore recursiva</p>
              <p className="text-[10px] text-muted-foreground">
                Nós: {summary?.recursiveNodesCount ?? 0} · Não resolvidos:{" "}
                {summary?.unresolvedComponentsCount ?? 0}
              </p>
              <div className="max-h-64 overflow-y-auto border border-border/60 rounded p-2 bg-muted/20">
                <p className="text-xs font-bold mb-1">{result.parentCode}</p>
                {(result.recursiveTree ?? []).map((node) => (
                  <div key={`${node.componentCode}-${node.level}`}>
                    <TreeBranch node={node} depth={1} />
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      {pickerModal}
    </div>
  );
};

