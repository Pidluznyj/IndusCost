import React, { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  ClipboardList,
  Layers,
  Loader2,
  RefreshCw,
  TrendingUp,
  FileSearch,
  Stethoscope,
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { fetchJsonOk } from "@/src/lib/http";
import {
  COST_IMPACT_STATUS_LABEL,
  EFFECTIVE_BOM_STATUS_LABEL,
  OPTIONAL_PRICING_STATUS_LABEL,
  formatNomusStatusLabel,
  nomusStatusBadgeClass,
} from "@/src/lib/nomusMaintenanceStatusLabels";
import type {
  NomusMaintenanceTab,
  NomusMaintenanceWorkspaceProps,
} from "@/src/lib/nomusMaintenanceWorkspaceTypes";
import type { NomusBomApplyPlansReport } from "@/src/lib/nomusBomApplyPlanLoad";
import type { EffectivePricingBomResult } from "@/src/lib/nomusEffectivePricingBomTypes";
import type { NomusEffectiveBomCostImpactResult } from "@/src/lib/nomusEffectiveBomCostImpactTypes";

type OptionalListRow = {
  parentCode: string;
  pricingOptionalStatus: string;
};

type OptionalListResponse = {
  rows?: OptionalListRow[];
};

type OverviewSnapshot = {
  effectiveBom: EffectivePricingBomResult | null;
  costImpact: NomusEffectiveBomCostImpactResult | null;
  applyPlan: NomusBomApplyPlansReport | null;
  optionalRow: OptionalListRow | null;
  loadErrors: {
    effectiveBom?: string;
    costImpact?: string;
    applyPlan?: string;
    optional?: string;
  };
};

type NomusMaintenanceOverviewPanelProps = NomusMaintenanceWorkspaceProps & {
  onNavigateTab: (tab: NomusMaintenanceTab) => void;
  disabled?: boolean;
};

function formatMoney(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

function deriveOverallStatus(snapshot: OverviewSnapshot): { label: string; tone: string } {
  const bom = snapshot.effectiveBom;
  if (!bom && snapshot.loadErrors.effectiveBom) {
    return { label: "BOM indisponível", tone: "bg-amber-100 text-amber-900" };
  }
  if (!bom) return { label: "Sem dados", tone: "bg-muted text-muted-foreground" };
  if (bom.status === "NO_NOMUS_BOM") {
    return { label: "Sem BOM Nomus", tone: "bg-red-100 text-red-900" };
  }
  if (
    bom.optionalPricingStatus === "PENDING" ||
    bom.optionalPricingStatus === "STALE" ||
    (bom.summary?.localReviewPendingCount ?? 0) > 0
  ) {
    return { label: "Pendências abertas", tone: "bg-amber-100 text-amber-900" };
  }
  if (bom.status === "BLOCKED_UNRESOLVED_COMPONENTS") {
    return { label: "Bloqueado", tone: "bg-red-100 text-red-900" };
  }
  if (snapshot.costImpact?.status === "READY") {
    return { label: "Pronto para revisão", tone: "bg-green-100 text-green-800" };
  }
  return { label: "Em análise", tone: "bg-blue-100 text-blue-900" };
}

function deriveNextAction(snapshot: OverviewSnapshot): { text: string; tab: NomusMaintenanceTab } {
  const bom = snapshot.effectiveBom;
  if (!bom && snapshot.loadErrors.effectiveBom) {
    return { text: "BOM efetiva indisponível — tente atualizar ou use o diagnóstico técnico.", tab: "diagnostic" };
  }
  if (!bom) return { text: "Selecione um produto e atualize a visão geral.", tab: "overview" };
  if (bom.status === "NO_NOMUS_BOM") {
    return { text: "Produto sem BOM Nomus no stage — revisar no diagnóstico técnico.", tab: "diagnostic" };
  }
  if (bom.optionalPricingStatus === "PENDING" || bom.optionalPricingStatus === "STALE") {
    return { text: "Resolver opcionais de precificação na aba Pendências.", tab: "pending" };
  }
  if ((bom.summary?.localReviewPendingCount ?? 0) > 0) {
    return { text: "Resolver itens locais para revisão na aba Pendências.", tab: "pending" };
  }
  if (bom.status === "BLOCKED_UNRESOLVED_COMPONENTS") {
    return { text: "Investigar componentes não mapeados no diagnóstico técnico.", tab: "diagnostic" };
  }
  if (snapshot.costImpact?.status === "BLOCKED_EFFECTIVE_BOM_NOT_READY") {
    return { text: "Concluir pendências antes de confiar no impacto de custo.", tab: "pending" };
  }
  if (snapshot.loadErrors.costImpact) {
    return { text: "Impacto de custo indisponível — revise pendências e tente novamente.", tab: "cost-impact" };
  }
  if (snapshot.costImpact?.status === "READY" && snapshot.costImpact.delta) {
    const d = snapshot.costImpact.delta.totalCost;
    if (Math.abs(d) > 0.01) {
      return { text: "Revisar impacto de custo e o plano de aplicação (simulação).", tab: "cost-impact" };
    }
  }
  return { text: "Revisar plano de aplicação (somente simulação).", tab: "apply-plan" };
}

function settledErrorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : "Falha ao carregar.";
}

export const NomusMaintenanceOverviewPanel: React.FC<NomusMaintenanceOverviewPanelProps> = ({
  selectedParentCode = "",
  selectedParentDescription,
  selectedIndusProductId,
  onNavigateTab,
  disabled = false,
}) => {
  const [loading, setLoading] = useState(false);
  const [snapshot, setSnapshot] = useState<OverviewSnapshot | null>(null);

  const loadOverview = useCallback(async (parentCode: string) => {
    const code = parentCode.trim();
    if (!code) {
      setSnapshot(null);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({ parentCode: code });
      const listParams = new URLSearchParams({ search: code, limit: "5", offset: "0" });
      const planParams = new URLSearchParams({ parentCode: code, limit: "1", offset: "0" });

      const [bomSettled, costSettled, planSettled, optionalSettled] = await Promise.allSettled([
        fetchJsonOk<EffectivePricingBomResult>(
          `/api/nomus/effective-pricing-bom?${params.toString()}`
        ),
        fetchJsonOk<NomusEffectiveBomCostImpactResult>(
          `/api/nomus/effective-pricing-bom/cost-impact?${params.toString()}`
        ),
        fetchJsonOk<NomusBomApplyPlansReport>(
          `/api/nomus/bom-comparison/apply-plan?${planParams.toString()}`
        ),
        fetchJsonOk<OptionalListResponse>(
          `/api/nomus/bom-optionals/pricing-selection?${listParams.toString()}`
        ),
      ]);

      const loadErrors: OverviewSnapshot["loadErrors"] = {};
      const effectiveBom =
        bomSettled.status === "fulfilled" ? bomSettled.value : null;
      if (bomSettled.status === "rejected") {
        loadErrors.effectiveBom = settledErrorMessage(bomSettled.reason);
      }

      const costImpact =
        costSettled.status === "fulfilled" ? costSettled.value : null;
      if (costSettled.status === "rejected") {
        loadErrors.costImpact = settledErrorMessage(costSettled.reason);
      }

      const applyPlan =
        planSettled.status === "fulfilled" ? planSettled.value : null;
      if (planSettled.status === "rejected") {
        loadErrors.applyPlan = settledErrorMessage(planSettled.reason);
      }

      const optionalList =
        optionalSettled.status === "fulfilled" ? optionalSettled.value : null;
      if (optionalSettled.status === "rejected") {
        loadErrors.optional = settledErrorMessage(optionalSettled.reason);
      }

      const rows = optionalList?.rows ?? [];
      const optionalRow =
        rows.find((r) => r.parentCode.toLowerCase() === code.toLowerCase()) ?? rows[0] ?? null;

      setSnapshot({
        effectiveBom,
        costImpact,
        applyPlan,
        optionalRow,
        loadErrors,
      });
    } catch (e) {
      setSnapshot({
        effectiveBom: null,
        costImpact: null,
        applyPlan: null,
        optionalRow: null,
        loadErrors: {
          effectiveBom: e instanceof Error ? e.message : "Erro ao carregar visão geral.",
        },
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedParentCode.trim()) {
      void loadOverview(selectedParentCode);
    } else {
      setSnapshot(null);
    }
  }, [loadOverview, selectedParentCode]);

  const bom = snapshot?.effectiveBom;
  const cost = snapshot?.costImpact;
  const loadErrors = snapshot?.loadErrors ?? {};
  const plan = snapshot?.applyPlan?.plans?.[0];
  const overall = snapshot ? deriveOverallStatus(snapshot) : null;
  const nextAction = snapshot ? deriveNextAction(snapshot) : null;
  const warnings = [
    ...(bom?.warnings ?? []),
    ...(cost?.warnings ?? []),
  ].slice(0, 6);
  const partialErrors = Object.entries(loadErrors).filter(([, msg]) => Boolean(msg));

  if (!selectedParentCode.trim()) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/20 p-6 text-center">
        <p className="text-sm text-muted-foreground">
          Selecione um produto no cabeçalho para ver a visão geral da manutenção Nomus.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h4 className="text-sm font-bold">Visão geral do produto</h4>
          <p className="text-[11px] text-muted-foreground mt-1">
            Resumo consolidado para <span className="font-semibold">{selectedParentCode}</span>
            {selectedParentDescription ? ` — ${selectedParentDescription}` : ""}
          </p>
        </div>
        <button
          type="button"
          disabled={disabled || loading}
          onClick={() => void loadOverview(selectedParentCode)}
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-semibold hover:bg-accent disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Atualizar
        </button>
      </div>

      {partialErrors.length > 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-2">
          <p className="text-xs font-bold text-amber-950 flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" />
            Algumas análises não carregaram
          </p>
          <ul className="text-[11px] text-amber-900 list-disc list-inside space-y-0.5">
            {loadErrors.effectiveBom ? <li>BOM efetiva: indisponível</li> : null}
            {loadErrors.costImpact ? <li>Impacto de custo: indisponível</li> : null}
            {loadErrors.applyPlan ? <li>Plano de aplicação: indisponível</li> : null}
            {loadErrors.optional ? <li>Opcionais: indisponível</li> : null}
          </ul>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-border bg-card p-3 space-y-1 sm:col-span-2">
          <p className="text-[10px] uppercase font-semibold text-muted-foreground">Produto selecionado</p>
          <p className="text-sm font-bold">{selectedParentCode}</p>
          {selectedParentDescription ? (
            <p className="text-xs text-muted-foreground line-clamp-2">{selectedParentDescription}</p>
          ) : null}
          <p className="text-[10px] text-muted-foreground">
            IndusCost: {selectedIndusProductId ? selectedIndusProductId.slice(0, 8) + "…" : "—"}
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-3 space-y-1">
          <p className="text-[10px] uppercase font-semibold text-muted-foreground">Status geral</p>
          {overall ? (
            <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold", overall.tone)}>
              {overall.label}
            </span>
          ) : (
            <span className="text-xs">{loading ? "Carregando…" : "—"}</span>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card p-3 space-y-1">
          <p className="text-[10px] uppercase font-semibold text-muted-foreground">Opcionais</p>
          {loadErrors.optional ? (
            <span className="text-xs text-amber-800">Indisponível</span>
          ) : (
            <span
              className={cn(
                "inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold",
                nomusStatusBadgeClass(
                  snapshot?.optionalRow?.pricingOptionalStatus ?? bom?.optionalPricingStatus ?? ""
                )
              )}
            >
              {formatNomusStatusLabel(
                snapshot?.optionalRow?.pricingOptionalStatus ?? bom?.optionalPricingStatus,
                OPTIONAL_PRICING_STATUS_LABEL
              )}
            </span>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card p-3 space-y-1">
          <p className="text-[10px] uppercase font-semibold text-muted-foreground">Revisão local</p>
          <p className="text-xs">
            Pendentes: <span className="font-bold">{bom?.summary?.localReviewPendingCount ?? "—"}</span>
          </p>
          <p className="text-xs">
            Resolvidos: <span className="font-bold">{bom?.summary?.localReviewResolvedCount ?? "—"}</span>
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-3 space-y-1">
          <p className="text-[10px] uppercase font-semibold text-muted-foreground">BOM efetiva</p>
          {loadErrors.effectiveBom ? (
            <span className="text-xs text-amber-800">Indisponível</span>
          ) : (
            <>
              <span
                className={cn(
                  "inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold",
                  nomusStatusBadgeClass(bom?.status ?? "")
                )}
              >
                {formatNomusStatusLabel(bom?.status, EFFECTIVE_BOM_STATUS_LABEL)}
              </span>
              <p className="text-[10px] text-muted-foreground mt-1">
                Incluídas: {bom?.summary?.includedLinesCount ?? "—"}
              </p>
            </>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card p-3 space-y-1">
          <p className="text-[10px] uppercase font-semibold text-muted-foreground">Impacto de custo</p>
          {loadErrors.costImpact ? (
            <span className="text-xs text-amber-800">Indisponível</span>
          ) : (
            <>
              <span
                className={cn(
                  "inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold",
                  nomusStatusBadgeClass(cost?.status ?? "")
                )}
              >
                {formatNomusStatusLabel(cost?.status, COST_IMPACT_STATUS_LABEL)}
              </span>
              {cost?.delta ? (
                <p className="text-[10px] text-muted-foreground mt-1 tabular-nums">
                  Δ total: {formatMoney(cost.delta.totalCost)}
                </p>
              ) : null}
            </>
          )}
        </div>

        <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-1 sm:col-span-2 lg:col-span-4">
          <p className="text-[10px] uppercase font-semibold text-muted-foreground">Custos (preview)</p>
          {loadErrors.costImpact ? (
            <p className="text-xs text-amber-800 mt-1">Impacto de custo indisponível neste momento.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-4 text-xs mt-1">
              <div>
                <p className="text-[10px] text-muted-foreground">Custo atual</p>
                <p className="font-bold tabular-nums">{formatMoney(cost?.currentCost?.totalCost)}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">Custo BOM efetiva</p>
                <p className="font-bold tabular-nums">{formatMoney(cost?.effectiveNomusCost?.totalCost)}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">Diferença R$</p>
                <p className="font-bold tabular-nums">{formatMoney(cost?.delta?.totalCost)}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">Diferença %</p>
                <p className="font-bold tabular-nums">{formatPct(cost?.delta?.totalCostPct)}</p>
              </div>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card p-3 space-y-2 sm:col-span-2 lg:col-span-4">
          <p className="text-[10px] uppercase font-semibold text-muted-foreground">Próxima ação recomendada</p>
          <p className="text-xs leading-relaxed">
            {nextAction?.text ?? (loading ? "Carregando…" : "—")}
          </p>
          {nextAction ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onNavigateTab(nextAction.tab)}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline disabled:opacity-50"
            >
              Ir para ação
              <ArrowRight className="h-3 w-3" />
            </button>
          ) : null}
          {plan ? (
            <p className="text-[10px] text-muted-foreground">
              Plano (simulação): {plan.classification?.actionClass?.replace(/_/g, " ") ?? "—"} ·{" "}
              {plan.classification?.riskLevel ?? "—"}
            </p>
          ) : loadErrors.applyPlan ? (
            <p className="text-[10px] text-amber-800">Plano de aplicação indisponível.</p>
          ) : null}
        </div>
      </div>

      {warnings.length > 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-bold text-amber-950 flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" />
            Principais avisos
          </p>
          <ul className="mt-2 space-y-1 text-[11px] text-amber-900 list-disc list-inside">
            {warnings.map((w, i) => (
              <li key={`${i}-${w.slice(0, 40)}`}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {(
          [
            { tab: "pending" as const, label: "Resolver pendências", icon: ClipboardList },
            { tab: "effective-pricing-bom" as const, label: "BOM efetiva", icon: Layers },
            { tab: "cost-impact" as const, label: "Impacto de custo", icon: TrendingUp },
            { tab: "apply-plan" as const, label: "Plano de aplicação", icon: FileSearch },
            { tab: "diagnostic" as const, label: "Diagnóstico técnico", icon: Stethoscope },
          ] as const
        ).map(({ tab, label, icon: Icon }) => (
          <button
            key={tab}
            type="button"
            disabled={disabled}
            onClick={() => onNavigateTab(tab)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs font-semibold text-primary hover:bg-primary/10 disabled:opacity-50"
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
            <ArrowRight className="h-3 w-3 opacity-60" />
          </button>
        ))}
      </div>
    </div>
  );
};
