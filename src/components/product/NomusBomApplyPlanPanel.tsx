import React, { useCallback, useEffect, useState } from "react";
import { GitCompareArrows, Loader2 } from "lucide-react";
import { NomusBomDiffModal } from "@/src/components/product/NomusBomDiffModal";
import { NomusMaintenanceErrorCard } from "@/src/components/product/NomusMaintenanceErrorCard";
import { NomusMaintenanceProductBanner } from "@/src/components/product/NomusMaintenanceProductBanner";
import { NomusMaintenanceStepHeader } from "@/src/components/product/NomusMaintenanceStepHeader";
import {
  buildNomusBomDiffRows,
  planActionBadgeClass,
} from "@/src/lib/nomusBomDiffView";
import { cn } from "@/src/lib/utils";
import { CLASSIFICATION_RISK_LABEL, formatNomusStatusLabel } from "@/src/lib/nomusMaintenanceStatusLabels";
import { fetchJsonOk } from "@/src/lib/http";
import { useNomusParentCodeResolver } from "@/src/hooks/useNomusParentCodeResolver";
import { useNomusMaintenanceWorkspaceSync } from "@/src/hooks/useNomusMaintenanceWorkspaceSync";
import type { NomusMaintenanceWorkspaceProps } from "@/src/lib/nomusMaintenanceWorkspaceTypes";
import { NomusBomControlledApplySection } from "@/src/components/product/NomusBomControlledApplySection";
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
    async (resolvedParentCode: string): Promise<NomusBomApplyPlansReport> => {
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
        throw new Error(notFoundMessage);
      }

      return result;
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
            const data = await fetchPlan(code);
            setReport(data);
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
      setError(e instanceof Error ? e.message : "NÃ£o foi possÃ­vel gerar o plano dry-run.");
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
        setError(e instanceof Error ? e.message : "NÃ£o foi possÃ­vel gerar o plano.");
      })
      .finally(() => setLoading(false));
  }, [fetchPlan, refreshToken, selectedParentCode]);

  const plans = report?.plans ?? [];
  const primaryPlan = workspaceFocused ? plans[0] ?? null : null;
  const summary = primaryPlan?.summary ?? report?.summary;
  const primaryDiffRows = primaryPlan ? buildNomusBomDiffRows(primaryPlan).slice(0, 15) : [];

  if (!workspaceFocused) {
    return (
      <div className="space-y-4">
        <NomusMaintenanceStepHeader tab="apply-plan" />
        <NomusMaintenanceProductBanner />
        <p className="text-sm text-muted-foreground">
          Selecione um produto no topo para ver o plano de aplicação (simulação).
        </p>
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
        <NomusMaintenanceErrorCard
          onRetry={() => {
            const code = selectedParentCode?.trim();
            if (!code) return;
            setLoading(true);
            void fetchPlan(code)
              .then((data) => {
                setReport(data);
                setAutoLoadFailed(false);
                setError(null);
              })
              .catch((e) => {
                setAutoLoadFailed(true);
                setError(e instanceof Error ? e.message : "Não foi possível gerar o plano.");
              })
              .finally(() => setLoading(false));
          }}
        />
      ) : null}

      {loading && !report ? (
        <p className="text-xs text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Gerando plano de aplicaÃ§Ã£o (simulaÃ§Ã£o)â€¦
        </p>
      ) : null}

      {report && summary ? (
        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 text-sm">
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
              <div key={card.label} className="rounded-lg border border-border bg-background px-3 py-2.5">
                <p className="text-xs uppercase text-muted-foreground font-semibold">{card.label}</p>
                <p className="font-bold mt-1 tabular-nums text-base">{card.value}</p>
              </div>
            ))}
          </div>

          {primaryPlan?.optionalPricingStatus === "RESOLVED" ? (
            <p className="text-sm text-green-900 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
              Opcionais resolvidos para este produto. Consulte a aba BOM efetiva para ver o que entrarÃ¡ na
              precificaÃ§Ã£o.
            </p>
          ) : primaryPlan?.optionalPricingStatus === "PENDING" ||
            primaryPlan?.optionalPricingStatus === "STALE" ? (
            <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Opcionais pendentes ou desatualizados. A BOM efetiva deste produto ainda nÃ£o estÃ¡ pronta.
            </p>
          ) : null}

          {primaryPlan ? (
            <div className="rounded-lg border border-border bg-background px-4 py-3 text-sm space-y-2">
              <p>
                <span className="font-semibold">ClassificaÃ§Ã£o: </span>
                {primaryPlan.classification.actionClass?.replace(/_/g, " ") ?? "â€”"}
                {" Â· "}
                <span className="font-semibold">Risco: </span>
                {formatNomusStatusLabel(primaryPlan.classification.riskLevel, CLASSIFICATION_RISK_LABEL)}
              </p>
              <p className="text-muted-foreground">{primaryPlan.classification.suggestedNextStepText}</p>
              {primaryDiffRows.length > 0 ? (
                <div className="overflow-x-auto rounded-lg border border-border/80 mt-2">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="text-left px-2 py-2">Componente</th>
                        <th className="text-left px-2 py-2">AÃ§Ã£o simulada</th>
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
                Ver anÃ¡lise completa (opcional)
              </button>
            </div>
          ) : null}

          {selectedParentCode ? (
            <NomusBomControlledApplySection
              parentCode={selectedParentCode}
              refreshToken={refreshToken}
              disabled={disabled}
            />
          ) : null}

        </div>
      ) : !loading && !error && !autoLoadFailed ? (
        <p className="text-sm text-muted-foreground">
          Plano de aplicação não carregado. Use &quot;Atualizar BOM e custo&quot; no topo.
        </p>
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
