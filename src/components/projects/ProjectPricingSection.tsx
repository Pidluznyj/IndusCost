import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Calculator, Loader2, Save } from "lucide-react";
import { calculateMarginPercentFromAgreedCustomerPrice } from "@/src/lib/pricingCalculations";
import {
  buildProjectCommercialPricingSummary,
  computeLiveProjectPricingView,
  resolveProjectCommercialPricingWeights,
  type ProjectPricingItemView,
} from "@/src/lib/projectsPricing";
import { formatProjectsNumberInput, parseProjectsNumberInput } from "@/src/lib/projectsUiUtils";
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

function reverseMarginFromAgreedPrice(
  item: Pick<
    ProjectPricingItemView,
    "finalUnitCost" | "taxPercent" | "amortizationPriceAddOnUnit"
  >,
  agreedRaw: string
): number | null {
  const agreed = parseProjectsNumberInput(agreedRaw);
  if (agreed == null) return null;
  const result = calculateMarginPercentFromAgreedCustomerPrice({
    agreedCustomerPrice: agreed,
    pricingCost: item.finalUnitCost,
    taxPercent: item.taxPercent,
    priceAddOnUnit: item.amortizationPriceAddOnUnit ?? 0,
  });
  return result.ok ? result.targetMarginPercent : null;
}

function buildItemMarginDrafts(
  items: Array<{ targetItemId: string; targetMarginPercent: number }>
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const item of items) {
    // type="number" — sem vírgula de locale
    next[item.targetItemId] = String(item.targetMarginPercent);
  }
  return next;
}

function buildItemFiscalRuleDrafts(
  items: Array<{ targetItemId: string; fiscalRuleId: string | null }>
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const item of items) {
    if (item.fiscalRuleId) next[item.targetItemId] = item.fiscalRuleId;
  }
  return next;
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
  const [itemMargins, setItemMargins] = useState<Record<string, string>>(() =>
    buildItemMarginDrafts(detail.projectPricing?.items ?? [])
  );
  const [itemFiscalRules, setItemFiscalRules] = useState<Record<string, string>>(() =>
    buildItemFiscalRuleDrafts(detail.projectPricing?.items ?? [])
  );
  const [itemAgreedPrices, setItemAgreedPrices] = useState<Record<string, string>>({});

  const hydrateDraftsFromView = useCallback((view: ProjectPricingView) => {
    setPricingView(view);
    setFiscalRuleId(view.config.fiscalRuleId ?? "");
    setDefaultMargin(
      view.config.defaultMarginPercent != null
        ? String(view.config.defaultMarginPercent)
        : detail.targetMarginPercent != null
          ? String(detail.targetMarginPercent)
          : ""
    );
    setItemMargins(buildItemMarginDrafts(view.items));
    setItemFiscalRules(buildItemFiscalRuleDrafts(view.items));
    setItemAgreedPrices({});
  }, [detail.targetMarginPercent]);

  const loadPricing = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJsonOk<{ view: ProjectPricingView }>(
        `/api/projects/${projectId}/pricing`
      );
      hydrateDraftsFromView(data.view);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao carregar precificação.");
    } finally {
      setLoading(false);
    }
  }, [projectId, hydrateDraftsFromView]);

  useEffect(() => {
    if (!detail.projectPricing) {
      void loadPricing();
      return;
    }
    hydrateDraftsFromView(detail.projectPricing);
  }, [detail.projectPricing, loadPricing, hydrateDraftsFromView]);

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

  const resolveAgreedPriceDraft = (item: ProjectPricingItemView): string => {
    if (itemAgreedPrices[item.targetItemId] != null) {
      return itemAgreedPrices[item.targetItemId]!;
    }
    const seed = item.agreedCustomerPrice ?? item.suggestedPriceWithAmortization;
    return seed != null ? formatProjectsNumberInput(seed) : "";
  };

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

      const draftAgreed = parseProjectsNumberInput(resolveAgreedPriceDraft(item));
      const savedAgreed =
        savedItem.agreedCustomerPrice != null && Number.isFinite(savedItem.agreedCustomerPrice)
          ? savedItem.agreedCustomerPrice
          : savedItem.suggestedPriceWithAmortization ??
            savedItem.suggestedPrice ??
            null;
      if (draftAgreed == null && savedAgreed == null) continue;
      if (draftAgreed == null || savedAgreed == null) return true;
      if (Math.abs(draftAgreed - savedAgreed) > 0.0001) return true;
    }
    return false;
  }, [
    computedItems,
    detail.projectPricing,
    defaultMargin,
    fiscalRuleId,
    itemFiscalRules,
    itemAgreedPrices,
  ]);

  const applyToAll = () => {
    const marginDefault = defaultMargin.trim() ? Number(defaultMargin) : null;
    const nextMargins: Record<string, string> = {};
    const nextRules: Record<string, string> = {};
    for (const item of computedItems) {
      nextRules[item.targetItemId] = fiscalRuleId;
      if (marginDefault != null && Number.isFinite(marginDefault)) {
        nextMargins[item.targetItemId] = String(marginDefault);
      }
    }
    setItemFiscalRules(nextRules);
    if (Object.keys(nextMargins).length > 0) setItemMargins(nextMargins);
  };

  const handleAgreedPriceChange = (item: ProjectPricingItemView, raw: string) => {
    setItemAgreedPrices((prev) => ({ ...prev, [item.targetItemId]: raw }));
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
              fiscalRuleId:
                itemFiscalRules[item.targetItemId] ||
                item.fiscalRuleId ||
                fiscalRuleId ||
                null,
              targetMarginPercent:
                itemMargins[item.targetItemId] != null && itemMargins[item.targetItemId] !== ""
                  ? Number(itemMargins[item.targetItemId])
                  : item.targetMarginPercent,
              agreedCustomerPrice: parseProjectsNumberInput(resolveAgreedPriceDraft(item)),
            })),
          }),
        }
      );
      onDetailRefresh(result.project);
      if (result.project.projectPricing) {
        hydrateDraftsFromView(result.project.projectPricing);
      } else {
        setPricingView(null);
      }
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
          A <strong>Margem %</strong> continua editável e recalcula os preços sugeridos. Informe o{" "}
          <strong>Preço acordado cliente</strong> para a proposta — a coluna{" "}
          <strong>Margem no acordado %</strong> mostra a margem implícita (mesma fórmula da
          Calculadora de Preço de Venda, em engenharia reversa).
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
          Há alterações de regra fiscal, margem ou preço acordado não salvas. Salve a precificação
          antes de emitir relatórios para garantir que os valores coincidam com a aba Custos do Projeto.
        </div>
      ) : null}

      {computedItems.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhum produto, componente oficial ou simulação elegível para precificação neste projeto.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="min-w-[1200px] w-full text-sm">
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
                <th className="px-3 py-2">Preço s/ amortização</th>
                <th className="px-3 py-2">Preço c/ amortização</th>
                <th className="px-3 py-2">Preço acordado cliente</th>
                <th className="px-3 py-2">Margem no acordado %</th>
              </tr>
            </thead>
            <tbody>
              {computedItems.map((item) => (
                  <tr key={item.targetItemId} className="border-b border-border/60">
                    <td className="px-3 py-2">{item.displayName}</td>
                    <td className="px-3 py-2">{formatMoney(item.costBaseUnit)}</td>
                    <td className="px-3 py-2">{formatMoney(item.amortizationUnitCost)}</td>
                    <td className="px-3 py-2">{formatMoney(item.amortizationPriceAddOnUnit)}</td>
                    <td className="px-3 py-2">{formatMoney(item.finalUnitCost)}</td>
                    <td className="px-3 py-2">
                      {canManage ? (
                        <select
                          value={
                            itemFiscalRules[item.targetItemId] ??
                            item.fiscalRuleId ??
                            fiscalRuleId
                          }
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
                          value={
                            itemMargins[item.targetItemId] ?? String(item.targetMarginPercent)
                          }
                          onChange={(e) =>
                            setItemMargins((prev) => ({
                              ...prev,
                              [item.targetItemId]: e.target.value,
                            }))
                          }
                          className="w-20 rounded border border-border bg-background px-2 py-1 text-xs"
                          title="Margem desejada — recalcula os preços sugeridos"
                        />
                      ) : (
                        formatPercent(item.targetMarginPercent)
                      )}
                    </td>
                    <td className="px-3 py-2 font-medium">
                      {formatMoney(item.suggestedPriceWithoutAmortization, 4)}
                    </td>
                    <td className="px-3 py-2">
                      <PriceWithAmortCell
                        withoutAmort={item.suggestedPriceWithoutAmortization}
                        withAmort={item.suggestedPriceWithAmortization}
                      />
                    </td>
                    <td className="px-3 py-2">
                      {canManage ? (
                        <input
                          type="text"
                          inputMode="decimal"
                          title="Preço unitário acordado com o cliente — alimenta a proposta"
                          value={resolveAgreedPriceDraft(item)}
                          onChange={(e) => handleAgreedPriceChange(item, e.target.value)}
                          className="w-28 rounded border border-border bg-background px-2 py-1 text-xs font-semibold"
                          data-testid={`agreed-customer-price-${item.targetItemId}`}
                        />
                      ) : (
                        <span className="font-semibold text-primary">
                          {formatMoney(
                            parseProjectsNumberInput(resolveAgreedPriceDraft(item)),
                            4
                          )}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className="inline-block min-w-[3.5rem] rounded border border-border/60 bg-muted/40 px-2 py-1 text-xs font-medium"
                        title="Margem implícita no preço acordado (engenharia reversa)"
                        data-testid={`agreed-margin-${item.targetItemId}`}
                      >
                        {formatPercent(
                          reverseMarginFromAgreedPrice(item, resolveAgreedPriceDraft(item))
                        )}
                      </span>
                    </td>
                  </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ProjectCommercialPricingSummaryCards summary={pricingSummary} />
    </div>
  );
}
