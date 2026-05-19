import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { fetchJsonOk } from "@/src/lib/http";
import { NomusMaintenanceErrorCard } from "@/src/components/product/NomusMaintenanceErrorCard";
import { NomusMaintenanceProductBanner } from "@/src/components/product/NomusMaintenanceProductBanner";
import {
  BATCH_COMPARISON_STATUS_LABEL,
  CLASSIFICATION_RISK_LABEL,
  formatBomComparisonStatusLabel,
  formatNomusStatusLabel,
} from "@/src/lib/nomusMaintenanceStatusLabels";
import type { NomusMaintenanceWorkspaceProps } from "@/src/lib/nomusMaintenanceWorkspaceTypes";
import type { NomusBomApplyPlan } from "@/src/lib/nomusBomApplyPlan";
import type { NomusBomApplyPlansReport } from "@/src/lib/nomusBomApplyPlanLoad";
import {
  buildNomusBomDiffRows,
  formatQtyDisplay,
  planActionBadgeClass,
  planActionTypeLabel,
} from "@/src/lib/nomusBomDiffView";
import { normalizeSku } from "@/src/lib/nomusBomComparison";

type NomusMaintenanceProductDiagnosticViewProps = NomusMaintenanceWorkspaceProps & {
  disabled?: boolean;
};

function comparisonRowBadgeClass(status: string): string {
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

export const NomusMaintenanceProductDiagnosticView: React.FC<
  NomusMaintenanceProductDiagnosticViewProps
> = ({
  selectedParentCode = "",
  selectedParentDescription,
  refreshToken = 0,
  disabled = false,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<NomusBomApplyPlan | null>(null);

  const loadDiagnostic = useCallback(async (parentCode: string) => {
    const code = parentCode.trim();
    if (!code) {
      setPlan(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ parentCode: code, limit: "1", offset: "0" });
      const report = await fetchJsonOk<NomusBomApplyPlansReport>(
        `/api/nomus/bom-comparison/apply-plan?${params.toString()}`
      );
      const wanted = normalizeSku(code);
      const match =
        (report.plans ?? []).find((p) => normalizeSku(p.parentCode) === wanted) ?? null;
      if (!match) {
        setPlan(null);
        setError(`Nenhuma análise encontrada para ${code} no stage Nomus.`);
        return;
      }
      setPlan(match);
    } catch (e) {
      setPlan(null);
      setError(e instanceof Error ? e.message : "Não foi possível carregar o diagnóstico.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedParentCode.trim()) {
      void loadDiagnostic(selectedParentCode);
    } else {
      setPlan(null);
    }
  }, [loadDiagnostic, refreshToken, selectedParentCode]);

  const comparison = plan?.comparison;
  const classification = plan?.classification;
  const diffRows = plan ? buildNomusBomDiffRows(plan) : [];
  const topActions = (plan?.actions ?? [])
    .filter((a) => a.type !== "NO_ACTION")
    .slice(0, 12);
  const blockedActions = (plan?.actions ?? []).filter((a) => a.type === "BLOCKED");
  const keptActions = (plan?.actions ?? []).filter(
    (a) => a.type === "KEEP_INDUS_LINE" || a.type === "KEEP_LOCAL_PRODUCT"
  );
  const optionalActions = (plan?.actions ?? []).filter(
    (a) =>
      a.type === "OPTIONAL_SELECTION_REQUIRED" || a.type === "OPTIONAL_ITEM_NOT_AUTO_APPLIED"
  );

  return (
    <div className="space-y-5 pb-4">
      <NomusMaintenanceProductBanner
        parentCode={selectedParentCode}
        description={selectedParentDescription}
        compact
      />

      {loading && !plan ? (
        <p className="text-sm text-muted-foreground flex items-center gap-2 py-4">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando diagnóstico técnico…
        </p>
      ) : null}

      {error && !loading ? (
        <NomusMaintenanceErrorCard onRetry={() => void loadDiagnostic(selectedParentCode)} />
      ) : null}

      {plan && comparison ? (
        <>
          <section className="rounded-xl border border-border bg-card p-4 space-y-4">
            <h5 className="text-base font-bold">A) Comparação Nomus x IndusCost</h5>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
              <div className="rounded-lg border border-border bg-background px-3 py-2.5">
                <p className="text-xs uppercase text-muted-foreground font-semibold">Status geral</p>
                <span
                  className={cn(
                    "inline-flex mt-1 rounded-full px-2.5 py-0.5 text-xs font-bold",
                    comparisonRowBadgeClass(comparison.summary.status)
                  )}
                >
                  {formatNomusStatusLabel(comparison.summary.status, BATCH_COMPARISON_STATUS_LABEL)}
                </span>
              </div>
              <div className="rounded-lg border border-border bg-background px-3 py-2.5">
                <p className="text-xs uppercase text-muted-foreground font-semibold">Linhas Nomus</p>
                <p className="font-bold mt-1 tabular-nums">{comparison.summary.nomusLines}</p>
              </div>
              <div className="rounded-lg border border-border bg-background px-3 py-2.5">
                <p className="text-xs uppercase text-muted-foreground font-semibold">Linhas IndusCost</p>
                <p className="font-bold mt-1 tabular-nums">{comparison.summary.indusLines}</p>
              </div>
              <div className="rounded-lg border border-border bg-background px-3 py-2.5">
                <p className="text-xs uppercase text-muted-foreground font-semibold">Divergências</p>
                <p className="font-bold mt-1 tabular-nums text-sm">
                  {comparison.summary.quantityDiffs} qtd · {comparison.summary.onlyInNomus} só Nomus ·{" "}
                  {comparison.summary.onlyInIndusCost} só Indus
                </p>
              </div>
            </div>

            {comparison.selectedNomusList ? (
              <div className="text-sm rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5">
                <p className="font-semibold text-primary">Lista Nomus efetiva escolhida</p>
                <p className="mt-1 text-muted-foreground">
                  {comparison.selectedNomusList.listaMateriaisNome ?? "—"}
                  {comparison.selectedNomusList.listaMateriaisId != null
                    ? ` · ID ${comparison.selectedNomusList.listaMateriaisId}`
                    : ""}
                  {" · "}
                  {comparison.selectedNomusList.linesCount} linhas
                </p>
              </div>
            ) : null}

            {comparison.ignoredNomusLists.length > 0 ? (
              <div className="text-sm">
                <p className="font-semibold">Listas Nomus ignoradas ({comparison.ignoredNomusLists.length})</p>
                <ul className="mt-1 list-disc list-inside text-muted-foreground space-y-0.5">
                  {comparison.ignoredNomusLists.map((list, idx) => (
                    <li key={`${list.listaMateriaisId ?? "n"}-${idx}`}>
                      {list.listaMateriaisNome ?? "—"} ({list.linesCount} lin.)
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="text-left px-3 py-2.5 font-semibold">Componente</th>
                    <th className="text-left px-3 py-2.5 font-semibold">Descrição</th>
                    <th className="text-right px-3 py-2.5 font-semibold">Qtd. Nomus</th>
                    <th className="text-right px-3 py-2.5 font-semibold">Qtd. IndusCost</th>
                    <th className="text-right px-3 py-2.5 font-semibold">Diferença</th>
                    <th className="text-left px-3 py-2.5 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {diffRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                        Nenhuma linha para comparar.
                      </td>
                    </tr>
                  ) : (
                    diffRows.map((row) => (
                      <tr
                        key={row.componentCode}
                        className="border-t border-border/60 hover:bg-muted/20"
                      >
                        <td className="px-3 py-2.5 font-medium">{row.componentCode}</td>
                        <td className="px-3 py-2.5 text-muted-foreground max-w-[200px] truncate">
                          {row.componentDescription ?? "—"}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          {formatQtyDisplay(row.nomusQuantity)}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          {formatQtyDisplay(row.indusQuantity)}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          {formatQtyDisplay(row.quantityDiff)}
                        </td>
                        <td className="px-3 py-2.5">
                          <span
                            className={cn(
                              "inline-flex rounded-full px-2 py-0.5 text-xs font-bold",
                              comparisonRowBadgeClass(row.comparisonStatus ?? "")
                            )}
                          >
                            {formatBomComparisonStatusLabel(row.comparisonStatus)}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {classification ? (
            <section className="rounded-xl border border-border bg-card p-4 space-y-3">
              <h5 className="text-base font-bold">B) Classificação técnica</h5>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
                <div className="rounded-lg border border-border bg-background px-3 py-2.5">
                  <p className="text-xs uppercase text-muted-foreground font-semibold">Classificação</p>
                  <p className="font-bold mt-1">
                    {classification.actionClass?.replace(/_/g, " ") ?? "—"}
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-background px-3 py-2.5">
                  <p className="text-xs uppercase text-muted-foreground font-semibold">Risco</p>
                  <p className="font-bold mt-1">
                    {formatNomusStatusLabel(classification.riskLevel, CLASSIFICATION_RISK_LABEL)}
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-background px-3 py-2.5 sm:col-span-2">
                  <p className="text-xs uppercase text-muted-foreground font-semibold">Ação recomendada</p>
                  <p className="mt-1 text-muted-foreground leading-relaxed">
                    {classification.suggestedNextStepText ?? "—"}
                  </p>
                </div>
              </div>

              {(classification.issues ?? []).length > 0 ? (
                <div>
                  <p className="text-sm font-semibold mb-2">Issues principais</p>
                  <ul className="space-y-2">
                    {(classification.issues ?? []).slice(0, 8).map((issue, i) => (
                      <li
                        key={`${issue.code}-${i}`}
                        className="text-sm rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 flex gap-2"
                      >
                        <AlertTriangle className="h-4 w-4 text-amber-800 shrink-0 mt-0.5" />
                        <span className="text-amber-950">{issue.message}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {(plan.warnings ?? []).length > 0 ? (
                <div>
                  <p className="text-sm font-semibold mb-1">Avisos / bloqueios</p>
                  <ul className="text-sm text-muted-foreground list-disc list-inside space-y-0.5">
                    {plan.warnings.slice(0, 6).map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
          ) : null}

          <section className="rounded-xl border border-border bg-card p-4 space-y-3">
            <h5 className="text-base font-bold">C) Plano resumido (simulação)</h5>
            <p className="text-sm text-muted-foreground">
              Nenhuma alteração é aplicada. Resumo das ações que o dry-run consideraria.
            </p>

            {topActions.length > 0 ? (
              <div>
                <p className="text-sm font-semibold mb-2">Principais ações simuladas</p>
                <ul className="space-y-1.5">
                  {topActions.map((action, i) => (
                    <li
                      key={`${action.componentCode}-${action.type}-${i}`}
                      className="text-sm flex flex-wrap items-center gap-2 rounded-lg border border-border/60 px-3 py-2"
                    >
                      <span
                        className={cn(
                          "inline-flex rounded-full px-2 py-0.5 text-xs font-bold",
                          planActionBadgeClass(action.type)
                        )}
                      >
                        {planActionTypeLabel(action.type)}
                      </span>
                      {action.componentCode ? (
                        <span className="font-medium">{action.componentCode}</span>
                      ) : null}
                      <span className="text-muted-foreground">{action.reason}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-3 text-sm">
              <div className="rounded-lg border border-border bg-background px-3 py-2.5">
                <p className="font-semibold">Bloqueios</p>
                <p className="text-2xl font-bold tabular-nums mt-1">{blockedActions.length}</p>
              </div>
              <div className="rounded-lg border border-border bg-background px-3 py-2.5">
                <p className="font-semibold">Itens mantidos</p>
                <p className="text-2xl font-bold tabular-nums mt-1">{keptActions.length}</p>
              </div>
              <div className="rounded-lg border border-border bg-background px-3 py-2.5">
                <p className="font-semibold">Opcionais / alternativos</p>
                <p className="text-2xl font-bold tabular-nums mt-1">{optionalActions.length}</p>
              </div>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
};
