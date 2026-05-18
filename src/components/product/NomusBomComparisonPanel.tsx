import React, { useCallback, useState } from "react";
import { GitCompareArrows, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { fetchJsonOk } from "@/src/lib/http";
import type { BomComparisonResult } from "@/src/lib/nomusBomComparison";

type NomusBomComparisonPanelProps = {
  productId: string | undefined;
  disabled?: boolean;
};

function statusLabel(status: string): string {
  switch (status) {
    case "MATCH":
      return "Igual";
    case "QUANTITY_DIFF":
      return "Qtd. diferente";
    case "ONLY_IN_NOMUS":
      return "Só no Nomus";
    case "ONLY_IN_INDUSCOST":
      return "Só no IndusCost";
    default:
      return status;
  }
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "MATCH":
      return "bg-green-100 text-green-800";
    case "QUANTITY_DIFF":
      return "bg-amber-100 text-amber-900";
    case "ONLY_IN_NOMUS":
      return "bg-blue-100 text-blue-900";
    case "ONLY_IN_INDUSCOST":
      return "bg-orange-100 text-orange-900";
    default:
      return "bg-muted text-muted-foreground";
  }
}

export const NomusBomComparisonPanel: React.FC<NomusBomComparisonPanelProps> = ({
  productId,
  disabled = false,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<BomComparisonResult | null>(null);

  const loadComparison = useCallback(async () => {
    if (!productId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchJsonOk<BomComparisonResult>(
        `/api/products/${productId}/nomus-bom-comparison`
      );
      setData(result);
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : "Não foi possível comparar com a BOM Nomus.");
    } finally {
      setLoading(false);
    }
  }, [productId]);

  if (!productId) {
    return (
      <p className="text-xs text-muted-foreground rounded-lg border border-dashed border-border px-3 py-2">
        Salve o produto para habilitar a comparação com a BOM Nomus.
      </p>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card/50 p-4 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h4 className="text-sm font-bold flex items-center gap-2">
            <GitCompareArrows className="h-4 w-4 text-primary" />
            Comparação com BOM Nomus
          </h4>
          <p className="text-[11px] text-muted-foreground mt-1 max-w-xl">
            Somente comparação. Nenhuma alteração é aplicada à BOM do IndusCost.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadComparison()}
          disabled={disabled || loading}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold hover:bg-accent disabled:opacity-50 shrink-0"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Comparar com Nomus
        </button>
      </div>

      {error ? (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
      ) : null}

      {data ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-xs">
            <div className="rounded-lg border border-border bg-background px-3 py-2">
              <p className="text-[10px] uppercase text-muted-foreground font-semibold">Status</p>
              <p className="font-bold mt-1">{data.summary.status}</p>
            </div>
            <div className="rounded-lg border border-border bg-background px-3 py-2">
              <p className="text-[10px] uppercase text-muted-foreground font-semibold">Itens iguais</p>
              <p className="font-bold mt-1 tabular-nums">{data.summary.matches}</p>
            </div>
            <div className="rounded-lg border border-border bg-background px-3 py-2">
              <p className="text-[10px] uppercase text-muted-foreground font-semibold">Divergências qtd.</p>
              <p className="font-bold mt-1 tabular-nums">{data.summary.quantityDiffs}</p>
            </div>
            <div className="rounded-lg border border-border bg-background px-3 py-2">
              <p className="text-[10px] uppercase text-muted-foreground font-semibold">Só Nomus / Só Indus</p>
              <p className="font-bold mt-1 tabular-nums">
                {data.summary.onlyInNomus} / {data.summary.onlyInIndusCost}
              </p>
            </div>
          </div>

          {data.selectedNomusList ? (
            <div className="text-xs rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
              <p className="font-semibold text-primary">Lista Nomus selecionada</p>
              <p className="mt-1 text-muted-foreground">
                {data.selectedNomusList.listaMateriaisNome ?? "—"}
                {data.selectedNomusList.listaMateriaisId != null
                  ? ` · ID ${data.selectedNomusList.listaMateriaisId}`
                  : ""}
                {" · "}
                {data.selectedNomusList.linesCount} linhas
                {data.selectedNomusList.listaMateriaisPadrao ? " · padrão" : ""}
                {data.selectedNomusList.listaMateriaisPadraoBlocoK ? " · Bloco K" : ""}
              </p>
            </div>
          ) : null}

          {data.ignoredNomusLists.length > 0 ? (
            <div className="text-xs text-muted-foreground">
              <p className="font-semibold text-foreground">Listas Nomus ignoradas ({data.ignoredNomusLists.length})</p>
              <ul className="mt-1 list-disc list-inside space-y-0.5">
                {data.ignoredNomusLists.map((list, idx) => (
                  <li key={`${list.listaMateriaisId ?? "n"}-${idx}`}>
                    {list.listaMateriaisNome ?? "—"} ({list.linesCount} lin.)
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 text-[10px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold">Componente</th>
                  <th className="text-right px-3 py-2 font-semibold">Qtd. Nomus</th>
                  <th className="text-right px-3 py-2 font-semibold">Qtd. IndusCost</th>
                  <th className="text-left px-3 py-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.lines.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                      Nenhuma linha para comparar.
                    </td>
                  </tr>
                ) : (
                  data.lines.map((line) => (
                    <tr key={`${line.componentCode}-${line.status}`} className="border-t border-border/60">
                      <td className="px-3 py-2 font-medium">{line.componentCode}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {line.nomusQuantity ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {line.indusQuantity ?? "—"}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={cn(
                            "inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold",
                            statusBadgeClass(line.status)
                          )}
                        >
                          {statusLabel(line.status)}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
};
