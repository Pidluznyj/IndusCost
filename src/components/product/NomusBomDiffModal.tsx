import React, { useCallback, useEffect, useState } from "react";
import { X, Loader2, GitCompareArrows, AlertTriangle } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/src/lib/utils";
import { fetchJsonOk } from "@/src/lib/http";
import type { NomusBomApplyPlansReport } from "@/src/lib/nomusBomApplyPlanLoad";
import type { NomusBomApplyPlan } from "@/src/lib/nomusBomApplyPlan";
import {
  buildNomusBomDiffRows,
  comparisonStatusLabel,
  formatQtyDisplay,
  hasImportProductOnly,
  planActionBadgeClass,
  type NomusBomDiffRow,
} from "@/src/lib/nomusBomDiffView";

export type NomusBomDiffModalProps = {
  open: boolean;
  onClose: () => void;
  sku: string | null;
  productId?: string | null;
};

function comparisonBadgeClass(status: string | null): string {
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

export const NomusBomDiffModal: React.FC<NomusBomDiffModalProps> = ({
  open,
  onClose,
  sku,
  productId: _productId,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<NomusBomApplyPlan | null>(null);

  const loadData = useCallback(async () => {
    if (!sku?.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ sku: sku.trim(), limit: "1", offset: "0" });
      const report = await fetchJsonOk<NomusBomApplyPlansReport>(
        `/api/nomus/bom-comparison/apply-plan?${params.toString()}`
      );
      const match =
        report.plans.find((p) => p.parentCode.toUpperCase() === sku.trim().toUpperCase()) ??
        report.plans[0] ??
        null;
      if (!match) {
        setPlan(null);
        setError("Nenhum plano encontrado para este SKU no stage Nomus.");
        return;
      }
      setPlan(match);
    } catch (e) {
      setPlan(null);
      setError(e instanceof Error ? e.message : "Não foi possível carregar a análise.");
    } finally {
      setLoading(false);
    }
  }, [sku]);

  useEffect(() => {
    if (open && sku) void loadData();
    if (!open) {
      setPlan(null);
      setError(null);
    }
  }, [open, sku, loadData]);

  const diffRows: NomusBomDiffRow[] = plan ? buildNomusBomDiffRows(plan) : [];
  const cls = plan?.classification;

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-4 bg-background/80 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="nomus-bom-diff-title"
            className="bg-card flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-border shadow-2xl"
            initial={{ opacity: 0, scale: 0.97, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 12 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4 bg-accent/20">
              <div className="min-w-0 flex-1">
                <h2 id="nomus-bom-diff-title" className="text-lg font-bold flex items-center gap-2">
                  <GitCompareArrows className="h-5 w-5 text-primary shrink-0" />
                  Análise da BOM Nomus x IndusCost
                </h2>
                {plan ? (
                  <p className="text-xs text-muted-foreground mt-1">
                    <span className="font-semibold text-foreground">{plan.parentCode}</span>
                    {plan.parentDescription ? ` · ${plan.parentDescription}` : ""}
                    {plan.selectedNomusList?.listaMateriaisNome
                      ? ` · Lista Nomus: ${plan.selectedNomusList.listaMateriaisNome}`
                      : ""}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground mt-1">{sku}</p>
                )}
                <p className="text-[10px] text-muted-foreground mt-2">
                  Somente leitura. Nenhuma alteração é aplicada ao IndusCost.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-2 rounded-lg hover:bg-accent shrink-0"
                aria-label="Fechar"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {loading ? (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <p className="mt-3 text-sm">Carregando análise...</p>
                </div>
              ) : null}

              {error ? (
                <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
                  {error}
                </p>
              ) : null}

              {plan && cls && !loading ? (
                <>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <span
                      className={cn(
                        "inline-flex rounded-full px-2.5 py-0.5 font-bold",
                        cls.riskLevel === "BLOCKED"
                          ? "bg-red-100 text-red-900"
                          : cls.riskLevel === "HIGH"
                            ? "bg-orange-100 text-orange-900"
                            : cls.riskLevel === "MEDIUM"
                              ? "bg-amber-100 text-amber-900"
                              : "bg-green-100 text-green-800"
                      )}
                    >
                      Risco: {cls.riskLevel}
                    </span>
                    <span className="inline-flex rounded-full px-2.5 py-0.5 font-medium bg-muted text-muted-foreground">
                      {cls.actionClass.replace(/_/g, " ")}
                    </span>
                    <span className="text-muted-foreground">
                      {cls.recommendedAction.replace(/_/g, " ")}
                    </span>
                  </div>

                  {hasImportProductOnly(plan) ? (
                    <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                      <p>
                        Produto existe no Nomus e ainda não no IndusCost. A BOM só pode ser planejada
                        após importação do produto.
                      </p>
                    </div>
                  ) : null}

                  <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 text-xs">
                    {[
                      { label: "Iguais", value: plan.comparison.summary.matches },
                      { label: "Atualizar qtd.", value: plan.summary.updateQuantityActions },
                      { label: "Adicionar", value: plan.summary.addBomLineActions },
                      { label: "Manter Indus", value: plan.summary.keepIndusLineActions },
                      { label: "Operacional", value: plan.summary.ignoreOperationalItemActions },
                      { label: "Bloqueadas", value: plan.summary.blockedActions },
                    ].map((card) => (
                      <div
                        key={card.label}
                        className="rounded-lg border border-border bg-background px-3 py-2"
                      >
                        <p className="text-[10px] uppercase text-muted-foreground font-semibold">
                          {card.label}
                        </p>
                        <p className="font-bold mt-0.5 tabular-nums">{card.value}</p>
                      </div>
                    ))}
                  </div>

                  {plan.warnings.length > 0 ? (
                    <ul className="text-[11px] text-muted-foreground list-disc list-inside space-y-0.5">
                      {plan.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  ) : null}

                  <div className="overflow-x-auto rounded-xl border border-border">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50 text-[10px] uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th className="text-left px-2 py-2 font-semibold">Status</th>
                          <th className="text-left px-2 py-2 font-semibold">Componente</th>
                          <th className="text-left px-2 py-2 font-semibold min-w-[120px]">
                            Descrição
                          </th>
                          <th className="text-right px-2 py-2 font-semibold">IndusCost atual</th>
                          <th className="text-right px-2 py-2 font-semibold">Nomus proposto</th>
                          <th className="text-right px-2 py-2 font-semibold">Diferença</th>
                          <th className="text-left px-2 py-2 font-semibold">Decisão do plano</th>
                          <th className="text-left px-2 py-2 font-semibold min-w-[140px]">
                            Observação
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {diffRows.length === 0 ? (
                          <tr>
                            <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">
                              Nenhuma linha de BOM para comparar.
                            </td>
                          </tr>
                        ) : (
                          diffRows.map((row) => (
                            <tr
                              key={row.componentCode}
                              className="border-t border-border/60 align-top"
                            >
                              <td className="px-2 py-2 whitespace-nowrap">
                                <span
                                  className={cn(
                                    "inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold",
                                    comparisonBadgeClass(row.comparisonStatus)
                                  )}
                                >
                                  {comparisonStatusLabel(row.comparisonStatus)}
                                </span>
                              </td>
                              <td className="px-2 py-2 font-medium whitespace-nowrap">
                                {row.componentCode}
                                {row.hasDuplicateNomusLines || row.hasDuplicateIndusLines ? (
                                  <p className="text-[9px] font-normal text-muted-foreground mt-0.5">
                                    {[
                                      row.hasDuplicateNomusLines ? "2+ linhas Nomus" : null,
                                      row.hasDuplicateIndusLines ? "2+ linhas Indus" : null,
                                    ]
                                      .filter(Boolean)
                                      .join(" · ")}
                                  </p>
                                ) : null}
                              </td>
                              <td className="px-2 py-2 text-muted-foreground max-w-[160px] line-clamp-2">
                                {row.componentDescription ?? "—"}
                              </td>
                              <td className="px-2 py-2 text-right tabular-nums font-medium">
                                {formatQtyDisplay(row.indusQuantity)}
                              </td>
                              <td className="px-2 py-2 text-right tabular-nums font-medium">
                                {formatQtyDisplay(row.nomusQuantity)}
                              </td>
                              <td className="px-2 py-2 text-right tabular-nums">
                                {row.quantityDiff != null ? (
                                  <span
                                    className={cn(
                                      row.quantityDiff !== 0 ? "text-amber-800 font-semibold" : ""
                                    )}
                                  >
                                    {formatQtyDisplay(row.quantityDiff)}
                                  </span>
                                ) : (
                                  "—"
                                )}
                              </td>
                              <td className="px-2 py-2">
                                <span
                                  className={cn(
                                    "inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold",
                                    planActionBadgeClass(row.planActionType)
                                  )}
                                >
                                  {row.planDecisionLabel}
                                </span>
                              </td>
                              <td className="px-2 py-2 text-muted-foreground text-[10px] leading-snug">
                                {row.observation || "—"}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : null}
            </div>

            <div className="border-t border-border px-5 py-3 flex justify-end bg-accent/10">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg text-sm font-semibold border border-border hover:bg-accent"
              >
                Fechar
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
};
