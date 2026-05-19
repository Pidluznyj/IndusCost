import React, { useCallback, useState } from "react";
import { ClipboardList, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { fetchJsonOk } from "@/src/lib/http";
import { useNomusParentCodeResolver } from "@/src/hooks/useNomusParentCodeResolver";
import type { NomusBomClassificationReport } from "@/src/lib/nomusBomBatchReport";
import type { NomusBomRiskLevel } from "@/src/lib/nomusBomClassification";

type NomusBomClassificationPanelProps = {
  onOpenProduct?: (productId: string) => void;
  disabled?: boolean;
};

function riskBadgeClass(risk: string): string {
  switch (risk) {
    case "LOW":
      return "bg-green-100 text-green-800";
    case "MEDIUM":
      return "bg-amber-100 text-amber-900";
    case "HIGH":
      return "bg-orange-100 text-orange-900";
    case "BLOCKED":
      return "bg-red-100 text-red-900";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function actionClassLabel(actionClass: string): string {
  return actionClass.replace(/_/g, " ");
}

export const NomusBomClassificationPanel: React.FC<NomusBomClassificationPanelProps> = ({
  onOpenProduct,
  disabled = false,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<NomusBomClassificationReport | null>(null);
  const [search, setSearch] = useState("");
  const [risk, setRisk] = useState<"" | NomusBomRiskLevel>("");
  const [onlyBlocked, setOnlyBlocked] = useState(false);
  const [onlyReview, setOnlyReview] = useState(false);
  const [onlyCandidates, setOnlyCandidates] = useState(false);
  const { resolveThen, pickerModal, notFoundMessage } = useNomusParentCodeResolver();

  const fetchClassification = useCallback(
    async (resolvedSearch: string) => {
      const params = new URLSearchParams({ limit: "100", offset: "0" });
      if (resolvedSearch.trim()) params.set("search", resolvedSearch.trim());
      if (risk) params.set("risk", risk);
      if (onlyBlocked) params.set("onlyBlocked", "true");
      if (onlyReview) params.set("onlyReview", "true");
      if (onlyCandidates) params.set("onlyCandidates", "true");

      const result = await fetchJsonOk<NomusBomClassificationReport>(
        `/api/nomus/bom-comparison/classification?${params.toString()}`
      );
      setReport(result);
    },
    [onlyBlocked, onlyCandidates, onlyReview, risk]
  );

  const loadClassification = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const term = search.trim();
      if (!term) {
        await fetchClassification("");
        return;
      }

      const outcome = await resolveThen(term, async (code) => {
        setSearch(code);
        await fetchClassification(code);
      });
      if (!outcome.ok && outcome.reason === "none") {
        setReport(null);
        setError(notFoundMessage);
      }
    } catch (e) {
      setReport(null);
      setError(e instanceof Error ? e.message : "Não foi possível classificar divergências.");
    } finally {
      setLoading(false);
    }
  }, [fetchClassification, notFoundMessage, resolveThen, search]);

  const cs = report?.classificationSummary;

  return (
    <div className="rounded-xl border border-border bg-card/50 p-4 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h4 className="text-sm font-bold flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-primary" />
            Estratégia de Aplicação da BOM Nomus
          </h4>
          <p className="text-[11px] text-muted-foreground mt-1 max-w-2xl">
            Classificação somente leitura. Nenhuma alteração é aplicada à BOM do IndusCost.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadClassification()}
          disabled={disabled || loading}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold hover:bg-accent disabled:opacity-50 shrink-0"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Classificar divergências
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[160px] flex-1">
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
          <label className="text-[10px] font-semibold uppercase text-muted-foreground">Risco</label>
          <select
            value={risk}
            onChange={(e) => setRisk(e.target.value as "" | NomusBomRiskLevel)}
            className="mt-1 h-9 min-w-[120px] rounded-lg border border-border bg-background px-3 text-xs outline-none focus:ring-2 focus:ring-primary/20"
          >
            <option value="">Todos</option>
            <option value="LOW">Baixo</option>
            <option value="MEDIUM">Médio</option>
            <option value="HIGH">Alto</option>
            <option value="BLOCKED">Bloqueado</option>
          </select>
        </div>
        <label className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={onlyBlocked}
            onChange={(e) => setOnlyBlocked(e.target.checked)}
            className="rounded border-border"
          />
          Só bloqueados
        </label>
        <label className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={onlyReview}
            onChange={(e) => setOnlyReview(e.target.checked)}
            className="rounded border-border"
          />
          Só revisão
        </label>
        <label className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={onlyCandidates}
            onChange={(e) => setOnlyCandidates(e.target.checked)}
            className="rounded border-border"
          />
          Só candidatos
        </label>
      </div>

      {error ? (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
      ) : null}

      {report && cs ? (
        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 text-xs">
            {[
              { label: "Criar BOM", value: cs.createBomCandidates },
              { label: "Atualizar qtd.", value: cs.updateQuantitiesCandidates },
              { label: "Revisão estrutural", value: cs.reviewStructureDiff },
              { label: "Revisão quantidade", value: cs.reviewQuantityDiff },
              { label: "Itens operacionais", value: cs.reviewOperationalItems },
              { label: "Preparados 150.xx", value: cs.reviewPreparedComponents },
              { label: "Kits/pacotes", value: cs.reviewKitsOrPacks },
              { label: "Bloq. sem produto", value: cs.blockedMissingParentProduct },
              { label: "Bloq. sem componente", value: cs.blockedMissingComponents },
              { label: "OK", value: cs.noActionOk },
            ].map((card) => (
              <div key={card.label} className="rounded-lg border border-border bg-background px-3 py-2">
                <p className="text-[10px] uppercase text-muted-foreground font-semibold">{card.label}</p>
                <p className="font-bold mt-1 tabular-nums">{card.value}</p>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 text-[10px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold">Produto</th>
                  <th className="text-left px-3 py-2 font-semibold">Status</th>
                  <th className="text-left px-3 py-2 font-semibold">Risco</th>
                  <th className="text-left px-3 py-2 font-semibold">Classe</th>
                  <th className="text-left px-3 py-2 font-semibold">Ação recomendada</th>
                  <th className="text-left px-3 py-2 font-semibold">Próximo passo</th>
                  <th className="text-left px-3 py-2 font-semibold">Ação</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                      Nenhum produto com os filtros atuais.
                    </td>
                  </tr>
                ) : (
                  report.rows.map((row) => {
                    const cls = row.classification;
                    return (
                      <tr key={row.parentCode} className="border-t border-border/60">
                        <td className="px-3 py-2 font-medium">{row.parentCode}</td>
                        <td className="px-3 py-2">{row.status}</td>
                        <td className="px-3 py-2">
                          {cls ? (
                            <span
                              className={cn(
                                "inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold",
                                riskBadgeClass(cls.riskLevel)
                              )}
                            >
                              {cls.riskLevel}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground max-w-[140px]">
                          {cls ? actionClassLabel(cls.actionClass) : "—"}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground max-w-[160px] line-clamp-2">
                          {cls?.recommendedAction ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground max-w-[200px] line-clamp-2">
                          {cls?.suggestedNextStepText ?? cls?.reasons[0] ?? "—"}
                        </td>
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
                    );
                  })
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
