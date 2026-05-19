import React, { useCallback, useEffect, useState } from "react";
import { ExternalLink, GitCompareArrows, Loader2 } from "lucide-react";
import { NomusBomDiffModal } from "@/src/components/product/NomusBomDiffModal";
import { NomusMaintenanceErrorCard } from "@/src/components/product/NomusMaintenanceErrorCard";
import { NomusMaintenanceProductBanner } from "@/src/components/product/NomusMaintenanceProductBanner";
import { NomusMaintenanceStepHeader } from "@/src/components/product/NomusMaintenanceStepHeader";
import {
  buildNomusBomDiffRows,
  formatQtyDisplay,
  planActionBadgeClass,
} from "@/src/lib/nomusBomDiffView";
import { cn } from "@/src/lib/utils";
import { fetchJsonOk } from "@/src/lib/http";
import { useNomusParentCodeResolver } from "@/src/hooks/useNomusParentCodeResolver";
import { useNomusMaintenanceWorkspaceSync } from "@/src/hooks/useNomusMaintenanceWorkspaceSync";
import type { NomusMaintenanceWorkspaceProps } from "@/src/lib/nomusMaintenanceWorkspaceTypes";
import type { NomusBomApplyPlan } from "@/src/lib/nomusBomApplyPlan";
import type { NomusBomApplyPlansReport } from "@/src/lib/nomusBomApplyPlanLoad";

type NomusBomApplyPlanPanelProps = NomusMaintenanceWorkspaceProps & {
  onOpenProduct?: (productId: string) => void;
  disabled?: boolean;
};

export const NomusBomApplyPlanPanel: React.FC<NomusBomApplyPlanPanelProps> = ({
  onOpenProduct,
  disabled = false,
  selectedParentCode,
  selectedParentDescription,
  selectedIndusProductId,
  onWorkspaceParentChange,
  refreshToken = 0,
}) => {
  const workspaceFocused = Boolean(selectedParentCode?.trim());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoLoadFailed, setAutoLoadFailed] = useState(false);
  const [report, setReport] = useState<NomusBomApplyPlansReport | null>(null);
  const [search, setSearch] = useState("");
  const [onlyCandidates, setOnlyCandidates] = useState(false);
  const [onlyBlocked, setOnlyBlocked] = useState(false);
  const [onlyImportProducts, setOnlyImportProducts] = useState(false);
  const [onlyUpdateQuantities, setOnlyUpdateQuantities] = useState(false);
  const [diffModalOpen, setDiffModalOpen] = useState(false);
  const [diffModalParentCode, setDiffModalParentCode] = useState<string | null>(null);
  const [diffModalProductId, setDiffModalProductId] = useState<string | null>(null);
  const { resolveThen, pickerModal, notFoundMessage } = useNomusParentCodeResolver();
  const { reportWorkspaceSelection } = useNomusMaintenanceWorkspaceSync({
    selectedParentCode,
    selectedParentDescription,
    selectedIndusProductId,
    onWorkspaceParentChange,
    setLocalCode: setSearch,
  });

  const openDiffModalForPlan = (plan: NomusBomApplyPlan) => {
    setDiffModalParentCode(plan.parentCode);
    setDiffModalProductId(plan.indusProductId ?? null);
    setDiffModalOpen(true);
  };

  const fetchPlan = useCallback(
    async (resolvedParentCode: string) => {
      const params = new URLSearchParams({ limit: "100", offset: "0" });
      if (resolvedParentCode.trim()) {
        params.set("parentCode", resolvedParentCode.trim());
      }
      if (onlyCandidates) params.set("onlyCandidates", "true");
      if (onlyBlocked) params.set("onlyBlocked", "true");
      if (onlyImportProducts) params.set("onlyImportProducts", "true");
      if (onlyUpdateQuantities) params.set("onlyUpdateQuantities", "true");

      const result = await fetchJsonOk<NomusBomApplyPlansReport>(
        `/api/nomus/bom-comparison/apply-plan?${params.toString()}`
      );

      if ((result.plans ?? []).length === 0) {
        setReport(null);
        throw new Error(notFoundMessage);
      }

      setReport(result);
    },
    [
      notFoundMessage,
      onlyBlocked,
      onlyCandidates,
      onlyImportProducts,
      onlyUpdateQuantities,
    ]
  );

  const loadPlan = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const term = search.trim();
      if (!term) {
        await fetchPlan("");
        return;
      }

      const outcome = await resolveThen(
        term,
        async (code, option) => {
          setLoading(true);
          setSearch(code);
          reportWorkspaceSelection(code, option);
          try {
            await fetchPlan(code);
          } finally {
            setLoading(false);
          }
        },
        { selectLabel: "Abrir" }
      );
      if (!outcome.ok && outcome.reason === "none") {
        setReport(null);
        setError(notFoundMessage);
      }
    } catch (e) {
      setReport(null);
      setError(e instanceof Error ? e.message : "Não foi possível gerar o plano dry-run.");
    } finally {
      setLoading(false);
    }
  }, [fetchPlan, notFoundMessage, resolveThen, search]);

  useEffect(() => {
    const code = selectedParentCode?.trim();
    if (!code) return;
    setError(null);
    setAutoLoadFailed(false);
    setLoading(true);
    void fetchPlan(code)
      .then((data) => {
        setReport(data);
        setAutoLoadFailed(false);
      })
      .catch((e) => {
        setReport(null);
        setAutoLoadFailed(true);
        setError(e instanceof Error ? e.message : "Não foi possível gerar o plano.");
      })
      .finally(() => setLoading(false));
  }, [fetchPlan, refreshToken, selectedParentCode]);

  const plans = report?.plans ?? [];
  const summary = report?.summary;
  const primaryPlan = workspaceFocused ? plans[0] ?? null : null;
  const primaryDiffRows = primaryPlan ? buildNomusBomDiffRows(primaryPlan).slice(0, 15) : [];

  if (!workspaceFocused) {
    return (
      <div className="space-y-4">
        <NomusMaintenanceStepHeader tab="apply-plan" />
        <NomusMaintenanceProductBanner />
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-dashed border-primary/30 bg-card/50 p-5 space-y-4">
      <NomusMaintenanceStepHeader tab="apply-plan" />
      <NomusMaintenanceProductBanner
        parentCode={selectedParentCode}
        description={selectedParentDescription}
        compact
      />

      {error ? (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
      ) : null}

      {autoLoadFailed && !loading && !report ? (
        <NomusMaintenanceErrorCard onRetry={() => void loadPlan(selectedParentCode ?? search)} />
      ) : null}

      {loading && !report ? (
        <p className="text-xs text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Gerando plano de aplicação (simulação)…
        </p>
      ) : null}

      {report && summary ? (
        <div className="space-y-4">
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

          {plans.some((p) => p.optionalPricingStatus === "RESOLVED") ? (
            <p className="text-[11px] text-green-900 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
              Há produtos com seleção de opcionais resolvida. Consulte a aba BOM efetiva para ver o que
              entrará na precificação.
            </p>
          ) : plans.some(
              (p) => p.optionalPricingStatus === "PENDING" || p.optionalPricingStatus === "STALE"
            ) ? (
            <p className="text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Há opcionais pendentes ou desatualizados. A BOM efetiva de precificação ainda não está pronta
              para todos os produtos listados.
            </p>
          ) : null}

          {primaryPlan ? (
            <div className="rounded-lg border border-border bg-background px-4 py-3 text-sm space-y-2">
              <p>
                <span className="font-semibold">Classificação: </span>
                {primaryPlan.classification.actionClass?.replace(/_/g, " ") ?? "—"}
                {" · "}
                <span className="font-semibold">Risco: </span>
                {primaryPlan.classification.riskLevel ?? "—"}
              </p>
              <p className="text-muted-foreground">{primaryPlan.classification.suggestedNextStepText}</p>
              {primaryDiffRows.length > 0 ? (
                <div className="overflow-x-auto rounded-lg border border-border/80 mt-2">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="text-left px-2 py-2">Componente</th>
                        <th className="text-left px-2 py-2">Ação simulada</th>
                      </tr>
                    </thead>
                    <tbody>
                      {primaryDiffRows.slice(0, 8).map((row) => (
                        <tr key={row.componentCode} className="border-t border-border/50">
                          <td className="px-2 py-2 font-medium">{row.componentCode}</td>
                          <td className="px-2 py-2">
                            <span
                              className={cn(
                                "inline-flex rounded-full px-2 py-0.5 text-xs font-bold",
                                planActionBadgeClass(row.planActionType)
                              )}
                            >
                              {row.planDecisionLabel}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => openDiffModalForPlan(primaryPlan)}
                className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
              >
                <GitCompareArrows className="h-4 w-4" />
                Ver análise completa (opcional)
              </button>
            </div>
          ) : null}

          <div className="overflow-x-auto rounded-xl border border-border hidden">
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
                {plans.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                      Nenhum plano com os filtros atuais.
                    </td>
                  </tr>
                ) : (
                  plans.map((plan) => {
                    const actionCount = (plan.actions ?? []).length;
                    const cls = plan.classification;
                    return (
                      <tr key={plan.parentCode} className="border-t border-border/60">
                        <td className="px-3 py-2 font-medium">{plan.parentCode}</td>
                        <td className="px-3 py-2 text-muted-foreground max-w-[120px] truncate">
                          {cls?.actionClass?.replace(/_/g, " ") ?? "—"}
                        </td>
                        <td className="px-3 py-2">{cls?.riskLevel ?? "—"}</td>
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

      {pickerModal}

      <NomusBomDiffModal
        open={diffModalOpen}
        onClose={() => setDiffModalOpen(false)}
        parentCode={diffModalParentCode}
        productId={diffModalProductId}
      />
    </div>
  );
};
