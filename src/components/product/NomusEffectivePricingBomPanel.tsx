import React, { useCallback, useState } from "react";
import { Layers, Loader2, RefreshCw, ChevronRight } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { fetchJsonOk } from "@/src/lib/http";
import type {
  EffectivePricingBomLine,
  EffectivePricingBomResult,
  EffectivePricingBomStatus,
  EffectivePricingBomTreeNode,
} from "@/src/lib/nomusEffectivePricingBom";
import type { PricingOptionalStatus } from "@/src/lib/nomusOptionalPricingSelection";

const STATUS_LABEL: Record<EffectivePricingBomStatus, string> = {
  READY_FOR_PRICING_PREVIEW: "Pronta para preview",
  PENDING_OPTIONAL_SELECTION: "Opcionais pendentes",
  STALE_OPTIONAL_SELECTION: "Seleção desatualizada",
  BLOCKED_UNRESOLVED_COMPONENTS: "Componentes não resolvidos",
  NO_NOMUS_BOM: "Sem BOM Nomus",
};

const STATUS_CLASS: Record<EffectivePricingBomStatus, string> = {
  READY_FOR_PRICING_PREVIEW: "bg-green-100 text-green-800",
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
                <tr key={`${line.componentCode}-${line.source}-${line.reason}`} className="border-t border-border/60">
                  <td className="px-2 py-1.5 font-medium">{line.componentCode}</td>
                  <td className="px-2 py-1.5 text-muted-foreground max-w-[180px] truncate">
                    {line.componentDescription ?? "—"}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{formatQty(line.quantity)}</td>
                  <td className="px-2 py-1.5">{SOURCE_LABEL[line.source] ?? line.source}</td>
                  <td className="px-2 py-1.5">{line.decision}</td>
                  <td className="px-2 py-1.5 text-muted-foreground">{line.groupName ?? "—"}</td>
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

type NomusEffectivePricingBomPanelProps = {
  disabled?: boolean;
};

export const NomusEffectivePricingBomPanel: React.FC<NomusEffectivePricingBomPanelProps> = ({
  disabled = false,
}) => {
  const [parentCode, setParentCode] = useState("");
  const [recursive, setRecursive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EffectivePricingBomResult | null>(null);

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
      const data = await fetchJsonOk<EffectivePricingBomResult>(
        `/api/nomus/effective-pricing-bom?${params.toString()}`
      );
      setResult(data);
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : "Erro ao gerar BOM efetiva.");
    } finally {
      setLoading(false);
    }
  }, [parentCode, recursive]);

  const included = result?.directLines ?? [];
  const excluded = result?.excludedLines ?? [];
  const review = result?.reviewLines ?? [];

  return (
    <div className="rounded-xl border border-dashed border-primary/30 bg-card/50 p-4 space-y-4">
      <div>
        <h4 className="text-sm font-bold flex items-center gap-2">
          <Layers className="h-4 w-4 text-primary" />
          BOM efetiva de precificação
        </h4>
        <p className="text-[11px] text-muted-foreground mt-1 max-w-3xl">
          Visualize quais itens da BOM Nomus entram na precificação considerando as escolhas de
          opcionais. Esta tela é somente leitura e não altera ProductBOM, custo ou preço.
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
          </div>

          {result.warnings.length > 0 ? (
            <ul className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 list-disc list-inside">
              {result.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          ) : null}

          <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 text-xs">
            {[
              { label: "Incluídos", value: result.summary.includedLinesCount },
              { label: "Opc. selecionados", value: result.summary.optionalSelectedCount },
              { label: "Opc. excluídos", value: result.summary.optionalExcludedCount },
              { label: "Excluídos", value: result.summary.excludedLinesCount },
              { label: "Revisão", value: result.summary.reviewLinesCount },
              { label: "Bloqueios", value: result.summary.blockedLinesCount },
            ].map((c) => (
              <div key={c.label} className="rounded-lg border border-border bg-background px-3 py-2">
                <p className="text-[10px] uppercase text-muted-foreground font-semibold">{c.label}</p>
                <p className="font-bold mt-1 tabular-nums">{c.value}</p>
              </div>
            ))}
          </div>

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
            title="Itens para revisão"
            lines={review}
            emptyMessage="Nenhum item pendente de revisão."
          />

          {result.recursiveTree && result.recursiveTree.length > 0 ? (
            <div className="space-y-2 rounded-lg border border-border p-3">
              <p className="text-xs font-bold">Árvore recursiva</p>
              <p className="text-[10px] text-muted-foreground">
                Nós: {result.summary.recursiveNodesCount} · Não resolvidos:{" "}
                {result.summary.unresolvedComponentsCount}
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
    </div>
  );
};

