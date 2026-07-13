import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Calculator, ChevronDown, ChevronUp, Loader2, Save } from "lucide-react";
import { cn } from "@/src/lib/utils";
import {
  buildProjectCommercialPricingSummary,
  computeLiveProjectPricingView,
  resolveProjectCommercialPricingWeights,
  type ProjectPricingItemView,
} from "@/src/lib/projectsPricing";
import { ProjectCommercialPricingSummaryCards } from "@/src/components/projects/ProjectCommercialPricingSummaryCards";
import type { ProjectDetail, ProjectPricingView } from "@/src/types/projects";

function formatMoney(value: number | null | undefined, digits = 6) {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: Math.min(2, digits),
    maximumFractionDigits: digits,
  });
}

function formatPercent(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(2)}%`;
}

type Props = {
  detail: ProjectDetail;
  projectId: string;
  canManage?: boolean;
  onDetailRefresh: (detail: ProjectDetail) => void;
};

async function fetchJsonOk<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof data.error === "string" ? data.error : "Falha na requisição.");
  }
  return data as T;
}

function pricingPriceDelta(
  withoutAmort: number | null | undefined,
  withAmort: number | null | undefined
): number | null {
  if (
    withoutAmort == null ||
    withAmort == null ||
    !Number.isFinite(withoutAmort) ||
    !Number.isFinite(withAmort)
  ) {
    return null;
  }
  return withAmort - withoutAmort;
}

function PriceWithAmortCell({
  withoutAmort,
  withAmort,
}: {
  withoutAmort: number | null;
  withAmort: number | null;
}) {
  const delta = pricingPriceDelta(withoutAmort, withAmort);
  return (
    <div className="space-y-0.5">
      <span className="font-semibold text-primary">{formatMoney(withAmort, 4)}</span>
      {delta != null && Math.abs(delta) > 0.000001 ? (
        <div className="text-[10px] text-muted-foreground">+{formatMoney(delta, 4)}</div>
      ) : null}
    </div>
  );
}

function CompositionPanel({ item }: { item: ProjectPricingItemView }) {
  const delta = pricingPriceDelta(
    item.suggestedPriceWithoutAmortization,
    item.suggestedPriceWithAmortization
  );

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm space-y-4">
      <p className="font-medium">Composição detalhada do preço — {item.displayName}</p>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-md border border-border/70 bg-background/80 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Cenário sem amortização
          </p>
          <dl className="mt-2 grid gap-1">
            <div>
              <dt className="text-muted-foreground">Custo usado</dt>
              <dd className="font-medium">{formatMoney(item.costBaseUnit)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Impostos ({formatPercent(item.taxPercent)})</dt>
              <dd className="font-medium">{formatMoney(item.taxAmountWithoutAmortization)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Margem ({formatPercent(item.targetMarginPercent)})</dt>
              <dd className="font-medium">{formatMoney(item.marginAmountWithoutAmortization)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Preço s/ amortização</dt>
              <dd className="font-semibold">{formatMoney(item.suggestedPriceWithoutAmortization)}</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-md border border-border/70 bg-background/80 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Cenário com amortização
          </p>
          <dl className="mt-2 grid gap-1">
            <div>
              <dt className="text-muted-foreground">Custo base unit.</dt>
              <dd className="font-medium">{formatMoney(item.costBaseUnit)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Amortização no custo</dt>
              <dd className="font-medium">{formatMoney(item.amortizationUnitCost)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Repasse no preço</dt>
              <dd className="font-medium">{formatMoney(item.amortizationPriceAddOnUnit)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Custo final unit.</dt>
              <dd className="font-medium">{formatMoney(item.finalUnitCost)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Impostos ({formatPercent(item.taxPercent)})</dt>
              <dd className="font-medium">{formatMoney(item.taxAmount)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Margem do produto</dt>
              <dd className="font-medium">{formatMoney(item.marginAmount)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Recuperação de projeto</dt>
              <dd className="font-medium">{formatMoney(item.projectRecoveryValue)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Preço produto</dt>
              <dd className="font-medium">{formatMoney(item.calculatedProductPrice)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Preço final c/ amortização</dt>
              <dd className="font-semibold text-primary">{formatMoney(item.suggestedPriceWithAmortization)}</dd>
            </div>
          </dl>
        </div>
      </div>

      {delta != null && Math.abs(delta) > 0.000001 ? (
        <p className="text-xs text-muted-foreground">
          Diferença entre os cenários: {formatMoney(delta)}
        </p>
      ) : null}
    </div>
  );
}

export function ProjectPricingSection({
  detail,
  projectId,
  canManage = false,
  onDetailRefresh,
}: Props) {
  const [loading, setLoading] = useState(!detail.projectPricing);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pricingView, setPricingView] = useState<ProjectPricingView | null>(
    detail.projectPricing ?? null
  );
  const [fiscalRuleId, setFiscalRuleId] = useState(
    detail.projectPricing?.config.fiscalRuleId ?? ""
  );
  const [defaultMargin, setDefaultMargin] = useState(
    String(detail.projectPricing?.config.defaultMarginPercent ?? detail.targetMarginPercent ?? "")
  );
  const [itemMargins, setItemMargins] = useState<Record<string, string>>({});
  const [itemFiscalRules, setItemFiscalRules] = useState<Record<string, string>>({});
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);

  const loadPricing = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJsonOk<{ view: ProjectPricingView }>(
        `/api/projects/${projectId}/pricing`
      );
      setPricingView(data.view);
      setFiscalRuleId(data.view.config.fiscalRuleId ?? "");
      setDefaultMargin(
        data.view.config.defaultMarginPercent != null
          ? String(data.view.config.defaultMarginPercent)
          : detail.targetMarginPercent != null
            ? String(detail.targetMarginPercent)
            : ""
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao carregar precificação.");
    } finally {
      setLoading(false);
    }
  }, [projectId, detail.targetMarginPercent]);

  useEffect(() => {
    if (!detail.projectPricing) {
      void loadPricing();
    }
  }, [detail.projectPricing, loadPricing]);

  const taxRules = pricingView?.taxRules ?? [];

  const computedItems = useMemo(() => {
    if (!pricingView) return [];
    const marginDefault = defaultMargin.trim() ? Number(defaultMargin) : null;
    const itemMarginsNumeric: Record<string, number> = {};
    for (const item of pricingView.items) {
      const raw = itemMargins[item.targetItemId];
      if (raw != null && raw.trim() !== "") {
        const n = Number(raw);
        if (Number.isFinite(n)) itemMarginsNumeric[item.targetItemId] = n;
      }
    }

    return computeLiveProjectPricingView(detail, {
      taxRules,
      config: {
        fiscalRuleId: fiscalRuleId || null,
        defaultMarginPercent: Number.isFinite(marginDefault) ? marginDefault : detail.targetMarginPercent,
      },
      itemMargins: itemMarginsNumeric,
      itemFiscalRules,
    }).items;
  }, [
    pricingView,
    detail,
    taxRules,
    fiscalRuleId,
    defaultMargin,
    itemMargins,
    itemFiscalRules,
  ]);

  const pricingSummary = useMemo(() => {
    const marginDefault = defaultMargin.trim() ? Number(defaultMargin) : null;
    return buildProjectCommercialPricingSummary({
      items: computedItems,
      weightsByTargetId: resolveProjectCommercialPricingWeights(detail),
      defaultMarginPercent: Number.isFinite(marginDefault)
        ? marginDefault
        : detail.targetMarginPercent,
    });
  }, [computedItems, detail, defaultMargin]);

  const hasUnsavedPricingChanges = useMemo(() => {
    const saved = detail.projectPricing;
    if (!saved || computedItems.length === 0) return false;

    const marginDefault = defaultMargin.trim() ? Number(defaultMargin) : null;
    if ((saved.config.fiscalRuleId ?? null) !== (fiscalRuleId || null)) return true;
    if ((saved.config.defaultMarginPercent ?? null) !== (Number.isFinite(marginDefault) ? marginDefault : null)) {
      return true;
    }

    for (const item of computedItems) {
      const savedItem = saved.items.find((row) => row.targetItemId === item.targetItemId);
      if (!savedItem) return true;
      if (Math.abs(item.targetMarginPercent - savedItem.targetMarginPercent) > 0.0001) return true;
      const draftRule = itemFiscalRules[item.targetItemId] ?? fiscalRuleId ?? null;
      if ((savedItem.fiscalRuleId ?? null) !== (draftRule || null)) return true;
    }
    return false;
  }, [computedItems, detail.projectPricing, defaultMargin, fiscalRuleId, itemFiscalRules]);

  const applyToAll = () => {
    const next: Record<string, string> = {};
    for (const item of computedItems) {
      next[item.targetItemId] = defaultMargin;
    }
    setItemMargins(next);
    const nextRules: Record<string, string> = {};
    for (const item of computedItems) {
      nextRules[item.targetItemId] = fiscalRuleId;
    }
    setItemFiscalRules(nextRules);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const marginDefault = defaultMargin.trim() ? Number(defaultMargin) : null;
      const result = await fetchJsonOk<{ project: ProjectDetail }>(
        `/api/projects/${projectId}/pricing`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fiscalRuleId: fiscalRuleId || null,
            defaultMarginPercent: marginDefault,
            items: computedItems.map((item) => ({
              targetItemId: item.targetItemId,
              targetItemType: item.targetItemType,
              fiscalRuleId: itemFiscalRules[item.targetItemId] || fiscalRuleId || null,
              targetMarginPercent:
                itemMargins[item.targetItemId] != null && itemMargins[item.targetItemId] !== ""
                  ? Number(itemMargins[item.targetItemId])
                  : marginDefault,
            })),
          }),
        }
      );
      onDetailRefresh(result.project);
      setPricingView(result.project.projectPricing ?? null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao salvar precificação.");
    } finally {
      setSaving(false);
    }
  };

  if (loading && !pricingView) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando precificação comercial...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h5 className="font-medium">Precificação comercial</h5>
        <p className="mt-1 text-sm text-muted-foreground">
          Compare o preço sugerido sem amortizar o projeto e com a amortização repassada ao produto,
          usando a mesma regra da Calculadora de Preço de Venda.
        </p>
      </div>

      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="grid gap-3 rounded-xl border border-border bg-card p-4 md:grid-cols-3">
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">Regra fiscal padrão</span>
          <select
            value={fiscalRuleId}
            onChange={(e) => setFiscalRuleId(e.target.value)}
            disabled={!canManage}
            className="w-full rounded-lg border border-border bg-background px-3 py-2"
          >
            <option value="">Selecione...</option>
            {taxRules.map((rule) => (
              <option key={rule.id} value={rule.id}>
                {rule.name} ({formatPercent(rule.taxPercent)})
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">Margem desejada padrão (%)</span>
          <input
            type="number"
            step="0.01"
            min={0}
            value={defaultMargin}
            onChange={(e) => setDefaultMargin(e.target.value)}
            disabled={!canManage}
            className="w-full rounded-lg border border-border bg-background px-3 py-2"
          />
        </label>
        <div className="flex flex-wrap items-end gap-2">
          {canManage ? (
            <>
              <button
                type="button"
                onClick={applyToAll}
                className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted"
              >
                <Calculator className="h-4 w-4" />
                Aplicar para todos
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Salvar precificação
              </button>
            </>
          ) : null}
        </div>
      </div>

      {hasUnsavedPricingChanges ? (
        <div
          className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
          data-testid="project-pricing-unsaved-warning"
        >
          Há alterações de margem ou regra fiscal não salvas. Salve a precificação antes de emitir
          relatórios para garantir que os valores coincidam com a aba Custos do Projeto.
        </div>
      ) : null}

      {computedItems.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhum produto/item simulado elegível para precificação neste projeto.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="min-w-[1100px] w-full text-sm">
            <thead className="border-b bg-muted/40 text-left">
              <tr>
                <th className="px-3 py-2">Item</th>
                <th className="px-3 py-2">Custo base unit.</th>
                <th className="px-3 py-2">Amort. no custo</th>
                <th className="px-3 py-2">Repasse no preço</th>
                <th className="px-3 py-2">Custo final unit.</th>
                <th className="px-3 py-2">Regra fiscal</th>
                <th className="px-3 py-2">Impostos %</th>
                <th className="px-3 py-2">Margem %</th>
                <th className="px-3 py-2">Preço produto</th>
                <th className="px-3 py-2">Preço final</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Ações</th>
              </tr>
            </thead>
            <tbody>
              {computedItems.map((item) => (
                <React.Fragment key={item.targetItemId}>
                  <tr className="border-b border-border/60">
                    <td className="px-3 py-2">{item.displayName}</td>
                    <td className="px-3 py-2">{formatMoney(item.costBaseUnit)}</td>
                    <td className="px-3 py-2">{formatMoney(item.amortizationUnitCost)}</td>
                    <td className="px-3 py-2">{formatMoney(item.amortizationPriceAddOnUnit)}</td>
                    <td className="px-3 py-2">{formatMoney(item.finalUnitCost)}</td>
                    <td className="px-3 py-2">
                      {canManage ? (
                        <select
                          value={itemFiscalRules[item.targetItemId] ?? fiscalRuleId}
                          onChange={(e) =>
                            setItemFiscalRules((prev) => ({
                              ...prev,
                              [item.targetItemId]: e.target.value,
                            }))
                          }
                          className="w-full min-w-[140px] rounded border border-border bg-background px-2 py-1 text-xs"
                        >
                          <option value="">—</option>
                          {taxRules.map((rule) => (
                            <option key={rule.id} value={rule.id}>
                              {rule.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        item.fiscalRuleName ?? "—"
                      )}
                    </td>
                    <td className="px-3 py-2">{formatPercent(item.taxPercent)}</td>
                    <td className="px-3 py-2">
                      {canManage ? (
                        <input
                          type="number"
                          step="0.01"
                          min={0}
                          value={itemMargins[item.targetItemId] ?? defaultMargin}
                          onChange={(e) =>
                            setItemMargins((prev) => ({
                              ...prev,
                              [item.targetItemId]: e.target.value,
                            }))
                          }
                          className="w-20 rounded border border-border bg-background px-2 py-1 text-xs"
                        />
                      ) : (
                        formatPercent(item.targetMarginPercent)
                      )}
                    </td>
                    <td className="px-3 py-2 font-medium">
                      {formatMoney(item.calculatedProductPrice ?? item.suggestedPriceWithoutAmortization, 4)}
                    </td>
                    <td className="px-3 py-2">
                      <PriceWithAmortCell
                        withoutAmort={item.calculatedProductPrice ?? item.suggestedPriceWithoutAmortization}
                        withAmort={item.suggestedPriceWithAmortization}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          "rounded px-2 py-0.5 text-xs",
                          item.status === "CALCULATED" && "bg-emerald-100 text-emerald-800",
                          item.status === "ERROR" && "bg-red-100 text-red-800",
                          item.status === "NO_COST" && "bg-amber-100 text-amber-800",
                          item.status === "PENDING" && "bg-slate-100 text-slate-700"
                        )}
                      >
                        {item.statusLabel}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedItemId((current) =>
                            current === item.targetItemId ? null : item.targetItemId
                          )
                        }
                        className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-muted"
                      >
                        {expandedItemId === item.targetItemId ? (
                          <ChevronUp className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" />
                        )}
                        Composição
                      </button>
                    </td>
                  </tr>
                  {expandedItemId === item.targetItemId ? (
                    <tr className="border-b border-border/60 bg-muted/20">
                      <td colSpan={11} className="px-3 py-3">
                        <CompositionPanel item={item} />
                        {item.errorMessage ? (
                          <p className="mt-2 text-xs text-red-600">{item.errorMessage}</p>
                        ) : null}
                      </td>
                    </tr>
                  ) : null}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ProjectCommercialPricingSummaryCards summary={pricingSummary} />
    </div>
  );
}
