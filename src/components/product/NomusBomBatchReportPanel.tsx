import React, { useCallback, useState } from "react";
import { BarChart3, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { fetchJsonOk } from "@/src/lib/http";
import { useNomusParentCodeResolver } from "@/src/hooks/useNomusParentCodeResolver";
import type { NomusBomBatchReport, NomusBomBatchReportRow } from "@/src/lib/nomusBomBatchReport";

type NomusBomBatchReportPanelProps = {
  onOpenProduct?: (productId: string) => void;
  disabled?: boolean;
};

type StatusFilter = "ALL" | "OK" | "DIVERGENT" | "BLOCKED";

function statusBadgeClass(status: NomusBomBatchReportRow["status"]): string {
  switch (status) {
    case "OK":
      return "bg-green-100 text-green-800";
    case "DIVERGENT":
      return "bg-amber-100 text-amber-900";
    case "BLOCKED":
      return "bg-red-100 text-red-900";
    default:
      return "bg-muted text-muted-foreground";
  }
}

export const NomusBomBatchReportPanel: React.FC<NomusBomBatchReportPanelProps> = ({
  onOpenProduct,
  disabled = false,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<NomusBomBatchReport | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [onlyDivergent, setOnlyDivergent] = useState(false);
  const { resolveThen, pickerModal, notFoundMessage } = useNomusParentCodeResolver();

  const fetchReport = useCallback(
    async (resolvedSearch: string) => {
      const params = new URLSearchParams({
        limit: "100",
        offset: "0",
      });
      if (resolvedSearch.trim()) params.set("search", resolvedSearch.trim());
      if (onlyDivergent) {
        params.set("onlyDivergent", "true");
      } else if (status !== "ALL") {
        params.set("status", status);
      }

      const result = await fetchJsonOk<NomusBomBatchReport>(
        `/api/nomus/bom-comparison/report?${params.toString()}`
      );
      setReport(result);
    },
    [onlyDivergent, status]
  );

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const term = search.trim();
      if (!term) {
        await fetchReport("");
        return;
      }

      const outcome = await resolveThen(term, async (code) => {
        setSearch(code);
        await fetchReport(code);
      });
      if (!outcome.ok && outcome.reason === "none") {
        setReport(null);
        setError(notFoundMessage);
      }
    } catch (e) {
      setReport(null);
      setError(e instanceof Error ? e.message : "Não foi possível gerar o relatório.");
    } finally {
      setLoading(false);
    }
  }, [fetchReport, notFoundMessage, resolveThen, search]);

  const summary = report?.summary;

  return (
    <div className="rounded-xl border border-border bg-card/50 p-4 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h4 className="text-sm font-bold flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" />
            Relatório de Divergências Nomus x IndusCost
          </h4>
          <p className="text-[11px] text-muted-foreground mt-1 max-w-2xl">
            Relatório somente leitura. Nenhuma alteração é aplicada à BOM do IndusCost.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadReport()}
          disabled={disabled || loading}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold hover:bg-accent disabled:opacity-50 shrink-0"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Gerar relatório
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[180px] flex-1">
          <label className="text-[10px] font-semibold uppercase text-muted-foreground">Busca SKU</label>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Ex.: 610.73BA"
            className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-3 text-xs outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <div>
          <label className="text-[10px] font-semibold uppercase text-muted-foreground">Status</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
            disabled={onlyDivergent}
            className="mt-1 h-9 w-full min-w-[140px] rounded-lg border border-border bg-background px-3 text-xs outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
          >
            <option value="ALL">Todos</option>
            <option value="OK">OK</option>
            <option value="DIVERGENT">Divergente</option>
            <option value="BLOCKED">Bloqueado</option>
          </select>
        </div>
        <label className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={onlyDivergent}
            onChange={(e) => setOnlyDivergent(e.target.checked)}
            className="rounded border-border"
          />
          Somente divergentes
        </label>
      </div>

      {error ? (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
      ) : null}

      {report ? (
        <div className="space-y-4">
          <p className="text-[11px] text-muted-foreground">
            Comparados nesta página: <span className="font-semibold text-foreground">{report.comparedCount}</span>{" "}
            de <span className="font-semibold text-foreground">{report.totalParentsInNomusStage}</span> produtos
            pais no stage Nomus.
          </p>

          {summary ? (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 text-xs">
              {[
                { label: "OK", value: summary.okCount },
                { label: "Divergentes", value: summary.divergentCount },
                { label: "Bloqueados", value: summary.blockedCount },
                { label: "Sem produto Indus", value: summary.missingProductInIndusCost },
                { label: "Sem BOM Indus", value: summary.noIndusBom },
                { label: "Dif. quantidade", value: summary.totalQuantityDiffs },
                { label: "Só Nomus", value: summary.totalOnlyInNomus },
                { label: "Só IndusCost", value: summary.totalOnlyInIndusCost },
              ].map((card) => (
                <div key={card.label} className="rounded-lg border border-border bg-background px-3 py-2">
                  <p className="text-[10px] uppercase text-muted-foreground font-semibold">{card.label}</p>
                  <p className="font-bold mt-1 tabular-nums">{card.value}</p>
                </div>
              ))}
            </div>
          ) : null}

          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 text-[10px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold">Produto</th>
                  <th className="text-left px-3 py-2 font-semibold">Status</th>
                  <th className="text-left px-3 py-2 font-semibold">Lista Nomus</th>
                  <th className="text-right px-3 py-2 font-semibold">Nomus</th>
                  <th className="text-right px-3 py-2 font-semibold">Indus</th>
                  <th className="text-right px-3 py-2 font-semibold">Match</th>
                  <th className="text-right px-3 py-2 font-semibold">Qtd dif.</th>
                  <th className="text-right px-3 py-2 font-semibold">Só Nomus</th>
                  <th className="text-right px-3 py-2 font-semibold">Só Indus</th>
                  <th className="text-right px-3 py-2 font-semibold">Score</th>
                  <th className="text-left px-3 py-2 font-semibold">Ação</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-3 py-6 text-center text-muted-foreground">
                      Nenhum produto encontrado com os filtros atuais.
                    </td>
                  </tr>
                ) : (
                  report.rows.map((row) => (
                    <tr key={row.parentCode} className="border-t border-border/60">
                      <td className="px-3 py-2">
                        <div className="font-medium">{row.parentCode}</div>
                        {row.indusProductName || row.parentDescription ? (
                          <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">
                            {row.indusProductName ?? row.parentDescription}
                          </p>
                        ) : null}
                        {row.hasDuplicateNomusLines || row.hasDuplicateIndusLines ? (
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {row.hasDuplicateNomusLines
                              ? `${row.duplicateNomusComponentsCount} comp. dup. Nomus`
                              : null}
                            {row.hasDuplicateNomusLines && row.hasDuplicateIndusLines ? " · " : null}
                            {row.hasDuplicateIndusLines
                              ? `${row.duplicateIndusComponentsCount} comp. dup. Indus`
                              : null}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={cn(
                            "inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold",
                            statusBadgeClass(row.status)
                          )}
                        >
                          {row.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {row.selectedListName ?? "—"}
                        {row.ignoredListsCount > 0 ? ` (+${row.ignoredListsCount} ign.)` : ""}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.nomusLines}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.indusLines}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.matches}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.quantityDiffs}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.onlyInNomus}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.onlyInIndusCost}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold">{row.severityScore}</td>
                      <td className="px-3 py-2">
                        {row.indusProductId && onOpenProduct ? (
                          <button
                            type="button"
                            onClick={() => onOpenProduct(row.indusProductId!)}
                            className="inline-flex items-center gap-1 text-[10px] font-semibold text-primary hover:underline"
                          >
                            <ExternalLink className="h-3 w-3" />
                            Abrir
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
        </div>
      ) : null}

      {pickerModal}
    </div>
  );
};
