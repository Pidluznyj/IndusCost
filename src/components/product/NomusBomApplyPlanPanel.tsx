import React, { useCallback, useState } from "react";
import { FileSearch, ExternalLink, GitCompareArrows, Loader2, RefreshCw } from "lucide-react";
import { NomusBomDiffModal } from "@/src/components/product/NomusBomDiffModal";
import { NomusBomPartialSkuPickerModal } from "@/src/components/product/NomusBomPartialSkuPickerModal";
import { fetchJsonOk } from "@/src/lib/http";
import { normalizeSku } from "@/src/lib/nomusBomComparison";
import type { NomusBomApplyPlan } from "@/src/lib/nomusBomApplyPlan";
import type { NomusBomApplyPlansReport } from "@/src/lib/nomusBomApplyPlanLoad";

type NomusBomApplyPlanPanelProps = {
  onOpenProduct?: (productId: string) => void;
  disabled?: boolean;
};

export const NomusBomApplyPlanPanel: React.FC<NomusBomApplyPlanPanelProps> = ({
  onOpenProduct,
  disabled = false,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<NomusBomApplyPlansReport | null>(null);
  const [search, setSearch] = useState("");
  const [onlyCandidates, setOnlyCandidates] = useState(false);
  const [onlyBlocked, setOnlyBlocked] = useState(false);
  const [onlyImportProducts, setOnlyImportProducts] = useState(false);
  const [onlyUpdateQuantities, setOnlyUpdateQuantities] = useState(false);
  const [diffModalOpen, setDiffModalOpen] = useState(false);
  const [diffModalParentCode, setDiffModalParentCode] = useState<string | null>(null);
  const [diffModalProductId, setDiffModalProductId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [lastSearchTerm, setLastSearchTerm] = useState("");

  const openDiffModalForPlan = (plan: NomusBomApplyPlan) => {
    setDiffModalParentCode(plan.parentCode);
    setDiffModalProductId(plan.indusProductId ?? null);
    setDiffModalOpen(true);
    setPickerOpen(false);
  };

  const isExactSearchMatch = (term: string, plans: NomusBomApplyPlan[]): boolean => {
    const wanted = normalizeSku(term);
    return plans.some((p) => normalizeSku(p.parentCode) === wanted);
  };

  const shouldOfferPicker = (term: string, plans: NomusBomApplyPlan[]): boolean => {
    if (!term || plans.length <= 1) return false;
    return !isExactSearchMatch(term, plans);
  };

  const loadPlan = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "100", offset: "0" });
      if (search.trim()) params.set("sku", search.trim());
      if (onlyCandidates) params.set("onlyCandidates", "true");
      if (onlyBlocked) params.set("onlyBlocked", "true");
      if (onlyImportProducts) params.set("onlyImportProducts", "true");
      if (onlyUpdateQuantities) params.set("onlyUpdateQuantities", "true");

      const result = await fetchJsonOk<NomusBomApplyPlansReport>(
        `/api/nomus/bom-comparison/apply-plan?${params.toString()}`
      );
      const term = search.trim();
      setLastSearchTerm(term);

      if (result.plans.length === 0) {
        setReport(null);
        setPickerOpen(false);
        setError("Nenhum produto encontrado para a busca informada. Tente o SKU completo.");
        return;
      }

      setReport(result);
      setPickerOpen(shouldOfferPicker(term, result.plans));
    } catch (e) {
      setReport(null);
      setPickerOpen(false);
      setError(e instanceof Error ? e.message : "Não foi possível gerar o plano dry-run.");
    } finally {
      setLoading(false);
    }
  }, [onlyBlocked, onlyCandidates, onlyImportProducts, onlyUpdateQuantities, search]);

  const summary = report?.summary;

  return (
    <div className="rounded-xl border border-dashed border-primary/30 bg-card/50 p-4 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h4 className="text-sm font-bold flex items-center gap-2">
            <FileSearch className="h-4 w-4 text-primary" />
            Plano Dry-run de Aplicação da BOM Nomus
          </h4>
          <p className="text-[11px] text-muted-foreground mt-1 max-w-2xl">
            Dry-run somente leitura. Nenhuma alteração é aplicada ao IndusCost.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadPlan()}
          disabled={disabled || loading}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold hover:bg-accent disabled:opacity-50 shrink-0"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Gerar plano
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
        <label className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={onlyCandidates}
            onChange={(e) => setOnlyCandidates(e.target.checked)}
            className="rounded border-border"
          />
          Somente candidatos
        </label>
        <label className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={onlyBlocked}
            onChange={(e) => setOnlyBlocked(e.target.checked)}
            className="rounded border-border"
          />
          Somente bloqueados
        </label>
        <label className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={onlyImportProducts}
            onChange={(e) => setOnlyImportProducts(e.target.checked)}
            className="rounded border-border"
          />
          Só importação
        </label>
        <label className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={onlyUpdateQuantities}
            onChange={(e) => setOnlyUpdateQuantities(e.target.checked)}
            className="rounded border-border"
          />
          Só atualizar qtd.
        </label>
      </div>

      {error ? (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
      ) : null}

      {report && summary ? (
        <div className="space-y-4">
          {shouldOfferPicker(lastSearchTerm, report.plans) ? (
            <div className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950 sm:flex-row sm:items-center sm:justify-between">
              <p>
                Encontramos mais de um produto para{" "}
                <span className="font-semibold">{lastSearchTerm}</span>. Selecione qual deseja analisar.
              </p>
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                className="inline-flex shrink-0 items-center justify-center rounded-lg border border-amber-300 bg-background px-3 py-1.5 text-[11px] font-semibold hover:bg-amber-100/80"
              >
                Escolher produto
              </button>
            </div>
          ) : null}
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 text-xs">
            {[
              { label: "Importar produto", value: summary.importProductActions },
              { label: "Criar BOM", value: summary.createBomActions },
              { label: "Atualizar qtd.", value: summary.updateQuantityActions },
              { label: "Adicionar linha", value: summary.addBomLineActions },
              { label: "Manter Indus", value: summary.keepIndusLineActions },
              { label: "Operacional ign.", value: summary.ignoreOperationalItemActions },
              { label: "Bloqueadas", value: summary.blockedActions },
              {
                label: "Opcionais pendentes",
                value:
                  (summary.optionalSelectionRequiredActions ?? 0) +
                  (summary.optionalItemNotAutoAppliedActions ?? 0),
              },
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
                  <th className="text-left px-3 py-2 font-semibold">Classificação</th>
                  <th className="text-left px-3 py-2 font-semibold">Risco</th>
                  <th className="text-center px-3 py-2 font-semibold">Aprovação?</th>
                  <th className="text-right px-3 py-2 font-semibold">Ações</th>
                  <th className="text-left px-3 py-2 font-semibold">Avisos</th>
                  <th className="text-left px-3 py-2 font-semibold">Ações</th>
                </tr>
              </thead>
              <tbody>
                {report.plans.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                      Nenhum plano com os filtros atuais.
                    </td>
                  </tr>
                ) : (
                  report.plans.map((plan) => {
                    const actionCount = plan.actions.length;
                    const cls = plan.classification;
                    return (
                      <tr key={plan.parentCode} className="border-t border-border/60">
                        <td className="px-3 py-2 font-medium">{plan.parentCode}</td>
                        <td className="px-3 py-2 text-muted-foreground max-w-[120px] truncate">
                          {cls.actionClass.replace(/_/g, " ")}
                        </td>
                        <td className="px-3 py-2">{cls.riskLevel}</td>
                        <td className="px-3 py-2 text-center">
                          {plan.canApplyWithApproval ? "Sim" : "Não"}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{actionCount}</td>
                        <td className="px-3 py-2 text-muted-foreground max-w-[180px]">
                          <div className="flex flex-col gap-1">
                            {plan.summary.optionalSelectionRequiredActions > 0 ? (
                              <span className="inline-flex w-fit rounded-full bg-fuchsia-100 px-2 py-0.5 text-[10px] font-bold text-fuchsia-950">
                                {plan.summary.optionalSelectionRequiredActions} opcional(is) pendente(s)
                              </span>
                            ) : null}
                            <span className="line-clamp-2">{plan.warnings[0] ?? "—"}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-col gap-1 items-start">
                            <button
                              type="button"
                              onClick={() => openDiffModalForPlan(plan)}
                              className="inline-flex items-center gap-1 text-[10px] font-semibold text-primary hover:underline"
                            >
                              <GitCompareArrows className="h-3 w-3" />
                              Ver análise
                            </button>
                            {plan.indusProductId && onOpenProduct ? (
                              <button
                                type="button"
                                onClick={() => onOpenProduct(plan.indusProductId!)}
                                className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground hover:text-foreground hover:underline"
                              >
                                <ExternalLink className="h-3 w-3" />
                                Abrir cadastro
                              </button>
                            ) : null}
                          </div>
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

      <NomusBomPartialSkuPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        searchTerm={lastSearchTerm}
        plans={report?.plans ?? []}
        onViewAnalysis={openDiffModalForPlan}
      />

      <NomusBomDiffModal
        open={diffModalOpen}
        onClose={() => setDiffModalOpen(false)}
        parentCode={diffModalParentCode}
        productId={diffModalProductId}
      />
    </div>
  );
};
