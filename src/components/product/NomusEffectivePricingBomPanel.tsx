import React, { useCallback, useState } from "react";
import { Layers, Loader2, RefreshCw, ChevronRight, Save } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { fetchJsonOk } from "@/src/lib/http";
import { useNomusParentCodeResolver } from "@/src/hooks/useNomusParentCodeResolver";
import { useNomusMaintenanceWorkspaceSync } from "@/src/hooks/useNomusMaintenanceWorkspaceSync";
import type { NomusMaintenanceWorkspaceProps } from "@/src/lib/nomusMaintenanceWorkspaceTypes";
import type {
  EffectivePricingBomLine,
  EffectivePricingBomResult,
  EffectivePricingBomStatus,
  EffectivePricingBomTreeNode,
  LocalReviewCatalogItem,
  NomusBomReviewDecisionType,
  PricingOptionalStatus,
} from "@/src/lib/nomusEffectivePricingBomTypes";
import {
  REVIEW_DECISION_BADGE,
  REVIEW_DECISION_OPTIONS,
  isLocalAssemblyComponentCode,
} from "@/src/lib/nomusEffectivePricingBomTypes";

const STATUS_LABEL: Record<EffectivePricingBomStatus, string> = {
  READY_FOR_PRICING_PREVIEW: "Pronta para preview",
  READY_WITH_LOCAL_REVIEW: "Pronta com revisão local",
  PENDING_LOCAL_REVIEW: "Revisão local pendente",
  PENDING_OPTIONAL_SELECTION: "Opcionais pendentes",
  STALE_OPTIONAL_SELECTION: "Seleção desatualizada",
  BLOCKED_UNRESOLVED_COMPONENTS: "Componentes não resolvidos",
  NO_NOMUS_BOM: "Sem BOM Nomus",
};

const STATUS_CLASS: Record<EffectivePricingBomStatus, string> = {
  READY_FOR_PRICING_PREVIEW: "bg-green-100 text-green-800",
  READY_WITH_LOCAL_REVIEW: "bg-teal-100 text-teal-900",
  PENDING_LOCAL_REVIEW: "bg-violet-100 text-violet-900",
  PENDING_OPTIONAL_SELECTION: "bg-amber-100 text-amber-900",
  STALE_OPTIONAL_SELECTION: "bg-orange-100 text-orange-900",
  BLOCKED_UNRESOLVED_COMPONENTS: "bg-red-100 text-red-900",
  NO_NOMUS_BOM: "bg-muted text-muted-foreground",
};

const OPTIONAL_STATUS_LABEL: Record<PricingOptionalStatus, string> = {
  PENDING: "Pendente",
  RESOLVED: "Resolvido",
  NO_OPTIONALS: "Sem opcionais",
  STALE: "Desatualizado",
};

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

function placementBadgeClass(placement: LocalReviewCatalogItem["placement"]): string {
  switch (placement) {
    case "included":
      return "bg-green-100 text-green-800";
    case "excluded":
      return "bg-muted text-muted-foreground";
    case "engineering_review":
      return "bg-blue-100 text-blue-900";
    default:
      return "bg-amber-100 text-amber-900";
  }
}

function placementLabel(placement: LocalReviewCatalogItem["placement"]): string {
  switch (placement) {
    case "included":
      return "Na BOM efetiva";
    case "excluded":
      return "Excluído";
    case "engineering_review":
      return "Engenharia";
    default:
      return "Pendente";
  }
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

type ReviewDraft = {
  decision: NomusBomReviewDecisionType;
  relatedNomusComponentCode: string;
  notes: string;
};

function LocalReviewSection({
  parentCode,
  parentProductId,
  catalog,
  disabled,
  onSaved,
}: {
  parentCode: string;
  parentProductId?: string | null;
  catalog: LocalReviewCatalogItem[];
  disabled?: boolean;
  onSaved: () => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, ReviewDraft>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const getDraft = (item: LocalReviewCatalogItem): ReviewDraft => {
    const key = item.productBomLineId;
    if (drafts[key]) return drafts[key];
    const saved = item.savedDecision;
    const defaultDecision: NomusBomReviewDecisionType = isLocalAssemblyComponentCode(
      item.componentCode
    )
      ? "INCLUDE_AS_LOCAL_EXCEPTION"
      : "PENDING";
    return {
      decision: saved?.decision ?? defaultDecision,
      relatedNomusComponentCode: saved?.relatedNomusComponentCode ?? "",
      notes: saved?.notes ?? "",
    };
  };

  const setDraftField = (
    productBomLineId: string,
    patch: Partial<ReviewDraft>
  ) => {
    setDrafts((prev) => {
      const item = catalog.find((c) => c.productBomLineId === productBomLineId);
      const current = prev[productBomLineId] ?? (item ? getDraft(item) : {
        decision: "PENDING" as const,
        relatedNomusComponentCode: "",
        notes: "",
      });
      return { ...prev, [productBomLineId]: { ...current, ...patch } };
    });
  };

  const saveItem = async (item: LocalReviewCatalogItem) => {
    const draft = getDraft(item);
    setSavingId(item.productBomLineId);
    setError(null);
    try {
      await fetchJsonOk("/api/nomus/effective-pricing-bom/review-decisions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parentCode,
          parentProductId: parentProductId ?? null,
          productBomLineId: item.productBomLineId,
          componentCode: item.componentCode,
          componentDescription: item.componentDescription,
          quantitySnapshot: item.quantity,
          decision: draft.decision,
          relatedNomusComponentCode:
            draft.decision === "DUPLICATED_BY_NOMUS_COMPONENT"
              ? draft.relatedNomusComponentCode.trim() || null
              : null,
          notes: draft.notes.trim() || null,
        }),
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar decisão.");
    } finally {
      setSavingId(null);
    }
  };

  if (catalog.length === 0) {
    return (
      <p className="text-[11px] text-muted-foreground">
        Nenhum item exclusivo do IndusCost (ProductBOM) para revisar neste produto.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-bold">Itens locais para revisão</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          Linhas presentes no ProductBOM e não na BOM Nomus efetiva. Montagens 800.xx usam por
          padrão &quot;Incluir como exceção local&quot; (componente local, não roteiro). A decisão
          altera apenas o preview — não muda ProductBOM, custo ou preço.
        </p>
      </div>

      {error ? (
        <p className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5">
          {error}
        </p>
      ) : null}

      <div className="space-y-3">
        {catalog.map((item) => {
          const draft = getDraft(item);
          const savedType = item.savedDecision?.decision ?? "PENDING";
          const badgeLabel =
            savedType === "PENDING"
              ? "Pendente"
              : REVIEW_DECISION_BADGE[savedType] ?? "Resolvido";

          return (
            <div
              key={item.productBomLineId}
              className="rounded-lg border border-border bg-background p-3 space-y-2"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-bold">
                    {item.componentCode}
                    {item.componentDescription ? (
                      <span className="font-normal text-muted-foreground">
                        {" "}
                        — {item.componentDescription}
                      </span>
                    ) : null}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Qtd IndusCost: {formatQty(item.quantity)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <span
                    className={cn(
                      "inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold",
                      placementBadgeClass(item.placement)
                    )}
                  >
                    {placementLabel(item.placement)}
                  </span>
                  <span
                    className={cn(
                      "inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold",
                      savedType === "PENDING"
                        ? "bg-amber-100 text-amber-900"
                        : "bg-slate-100 text-slate-800"
                    )}
                  >
                    {badgeLabel}
                  </span>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <div className="sm:col-span-2">
                  <label className="text-[10px] font-semibold uppercase text-muted-foreground">
                    Decisão
                  </label>
                  <select
                    value={draft.decision}
                    onChange={(e) =>
                      setDraftField(item.productBomLineId, {
                        decision: e.target.value as NomusBomReviewDecisionType,
                      })
                    }
                    className="mt-1 h-8 w-full rounded border border-border bg-background px-2 text-xs"
                  >
                    {REVIEW_DECISION_OPTIONS.map((d) => (
                      <option key={d.value} value={d.value}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </div>
                {draft.decision === "DUPLICATED_BY_NOMUS_COMPONENT" ? (
                  <div>
                    <label className="text-[10px] font-semibold uppercase text-muted-foreground">
                      Componente Nomus relacionado
                    </label>
                    <input
                      value={draft.relatedNomusComponentCode}
                      onChange={(e) =>
                        setDraftField(item.productBomLineId, {
                          relatedNomusComponentCode: e.target.value,
                        })
                      }
                      placeholder="Ex.: 309.81BB"
                      className="mt-1 h-8 w-full rounded border border-border bg-background px-2 text-xs"
                    />
                  </div>
                ) : null}
                <div className={draft.decision === "DUPLICATED_BY_NOMUS_COMPONENT" ? "" : "sm:col-span-2"}>
                  <label className="text-[10px] font-semibold uppercase text-muted-foreground">
                    Observação
                  </label>
                  <input
                    value={draft.notes}
                    onChange={(e) =>
                      setDraftField(item.productBomLineId, { notes: e.target.value })
                    }
                    placeholder="Motivo ou contexto da decisão"
                    className="mt-1 h-8 w-full rounded border border-border bg-background px-2 text-xs"
                  />
                </div>
              </div>

              <button
                type="button"
                disabled={disabled || savingId === item.productBomLineId}
                onClick={() => void saveItem(item)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/10 disabled:opacity-50"
              >
                {savingId === item.productBomLineId ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                Salvar decisão
              </button>
            </div>
          );
        })}
      </div>
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
};

export const NomusEffectivePricingBomPanel: React.FC<NomusEffectivePricingBomPanelProps> = ({
  disabled = false,
  onViewCostImpact,
  selectedParentCode,
  selectedParentDescription,
  selectedIndusProductId,
  onWorkspaceParentChange,
}) => {
  const [parentCode, setParentCode] = useState("");
  const [recursive, setRecursive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  const included = result?.directLines ?? [];
  const excluded = result?.excludedLines ?? [];
  const review = result?.reviewLines ?? [];
  const catalog = result?.localReviewCatalog ?? [];
  const summary = result?.summary;

  return (
    <div className="rounded-xl border border-dashed border-primary/30 bg-card/50 p-4 space-y-4">
      <div>
        <h4 className="text-sm font-bold flex items-center gap-2">
          <Layers className="h-4 w-4 text-primary" />
          BOM efetiva de precificação
        </h4>
        <p className="text-[11px] text-muted-foreground mt-1 max-w-3xl">
          Visualize quais itens da BOM Nomus entram na precificação considerando as escolhas de
          opcionais e decisões sobre itens locais do IndusCost. Esta tela não altera ProductBOM,
          custo ou preço.
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
        <label className="flex items-center gap-2 text-xs h-9 px-2 rounded-lg border border-border bg-background cursor-pointer">
          <input
            type="checkbox"
            checked={recursive}
            onChange={(e) => setRecursive(e.target.checked)}
            className="rounded"
          />
          Mostrar árvore recursiva
        </label>
        <button
          type="button"
          disabled={disabled || loading}
          onClick={() => void load()}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Gerar BOM efetiva
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
            <span className="text-[10px] text-muted-foreground">
              Opcionais: {OPTIONAL_STATUS_LABEL[result.optionalPricingStatus]}
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

          {result.warnings.length > 0 ? (
            <ul className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 list-disc list-inside">
              {result.warnings.map((w, i) => (
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

          {result.parentCode ? (
            <LocalReviewSection
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

          {result.recursiveTree && result.recursiveTree.length > 0 ? (
            <div className="space-y-2 rounded-lg border border-border p-3">
              <p className="text-xs font-bold">Árvore recursiva</p>
              <p className="text-[10px] text-muted-foreground">
                Nós: {summary?.recursiveNodesCount ?? 0} · Não resolvidos:{" "}
                {summary?.unresolvedComponentsCount ?? 0}
              </p>
              <div className="max-h-64 overflow-y-auto border border-border/60 rounded p-2 bg-muted/20">
                <p className="text-xs font-bold mb-1">{result.parentCode}</p>
                {result.recursiveTree.map((node) => (
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

