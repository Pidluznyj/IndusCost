import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, Percent, RefreshCw, Save, Scale } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { cn, formatCurrency, formatNumber } from "@/src/lib/utils";
import { useAuth } from "@/src/contexts/AuthContext";
import {
  buildSalesOrderMarginCoverageHint,
  resolveSalesOrderMarginMoneyLabel,
  resolveSalesOrderMarginPercentLabel,
} from "@/src/lib/salesOrderMarginDisplay";
import {
  assessSalesMarginNomusFiscalConfig,
  SALES_MARGIN_NOMUS_TAX_RULE_REQUIRED_MESSAGE,
  salesMarginNomusRequiresDefaultTaxRule,
  validateSalesMarginNomusConfigForSave,
  type SalesMarginNomusConfig,
} from "@/src/lib/salesMarginNomusConfig";
import type { ResolvedSalesTaxRule } from "@/src/lib/averageSalesTaxEngine";
import type { SalesMarginNomusPreviewPayload } from "@/src/lib/salesMarginNomusConfig.server";

type Payload = {
  config: SalesMarginNomusConfig;
  configRowId: string | null;
  taxRules: ResolvedSalesTaxRule[];
  selectedTaxRule: ResolvedSalesTaxRule | null;
  metricsSource: string;
  productTaxPriorityNote: string;
};

function coverageBadgeClass(status: string): string {
  switch (status) {
    case "FULL":
      return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300";
    case "PARTIAL":
      return "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200";
    case "NONE":
      return "bg-muted text-muted-foreground";
    default:
      return "bg-muted text-muted-foreground";
  }
}

export function SalesMarginNomusConfigPanel() {
  const auth = useAuth();
  const canEdit =
    auth.isSuperAdmin() ||
    auth.hasPermission("settings.global_params.edit") ||
    auth.hasPermission("users.manage");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [payload, setPayload] = useState<Payload | null>(null);
  const [form, setForm] = useState<SalesMarginNomusConfig | null>(null);
  const [preview, setPreview] = useState<SalesMarginNomusPreviewPayload | null>(null);
  const [previewFilters, setPreviewFilters] = useState({
    year: String(new Date().getFullYear()),
    month: String(new Date().getMonth() + 1),
    customerId: "",
    productId: "",
  });

  const selectedRule = useMemo(() => {
    if (!form?.defaultTaxRuleId) return null;
    const fromList = payload?.taxRules?.find((r) => r.id === form.defaultTaxRuleId);
    if (fromList) return fromList;
    if (payload?.selectedTaxRule?.id === form.defaultTaxRuleId) return payload.selectedTaxRule;
    return null;
  }, [form?.defaultTaxRuleId, payload]);

  const fiscalAssessment = useMemo(() => {
    if (!form) return null;
    return assessSalesMarginNomusFiscalConfig(form, selectedRule);
  }, [form, selectedRule]);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJsonOk<Payload>("/api/settings/sales-margin-nomus");
      setPayload(data);
      setForm(data.config);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar configuração.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const runPreview = useCallback(async () => {
    setPreviewLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        year: previewFilters.year,
        month: previewFilters.month,
      });
      if (previewFilters.customerId.trim()) params.set("customerId", previewFilters.customerId.trim());
      if (previewFilters.productId.trim()) params.set("productId", previewFilters.productId.trim());
      const data = await fetchJsonOk<SalesMarginNomusPreviewPayload>(
        `/api/settings/sales-margin-nomus/preview?${params.toString()}`
      );
      setPreview(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao gerar preview.");
    } finally {
      setPreviewLoading(false);
    }
  }, [previewFilters]);

  const handleSave = async () => {
    if (!form || !canEdit) return;
    setSaveMessage(null);
    setError(null);

    const clientValidation = validateSalesMarginNomusConfigForSave(form, selectedRule);
    if (!clientValidation.ok) {
      setError(clientValidation.error);
      return;
    }

    setSaving(true);
    try {
      const data = await fetchJsonOk<Payload>("/api/settings/sales-margin-nomus", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const mergedPayload: Payload = {
        ...data,
        taxRules: data.taxRules?.length ? data.taxRules : (payload?.taxRules ?? []),
      };
      setPayload(mergedPayload);
      setForm(mergedPayload.config);

      const postSaveAssessment = assessSalesMarginNomusFiscalConfig(
        mergedPayload.config,
        mergedPayload.selectedTaxRule ??
          mergedPayload.taxRules.find((r) => r.id === mergedPayload.config.defaultTaxRuleId) ??
          null
      );
      if (postSaveAssessment.status !== "OK" && salesMarginNomusRequiresDefaultTaxRule(mergedPayload.config)) {
        setError("Configuração fiscal incompleta — a TaxRule não foi persistida corretamente.");
        return;
      }

      setSaveMessage("Configuração salva. O motor oficial de margem passará a usar estes parâmetros.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando configuração de margem Nomus…
      </div>
    );
  }

  if (!form) {
    return (
      <p className="text-sm text-destructive">{error ?? "Configuração indisponível."}</p>
    );
  }

  const coverageForLabels = preview
    ? {
        costCoverageStatus: preview.costCoverageStatus as "FULL" | "PARTIAL" | "NONE",
      }
    : null;

  return (
    <div className="mt-8 border-t border-border pt-8 space-y-6" data-testid="sales-margin-nomus-config">
      <div>
        <h3 className="text-lg font-bold flex items-center gap-2">
          <Scale className="h-5 w-5 text-primary" />
          Parâmetros da Margem de Pedidos Nomus
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          Configura o motor oficial de margem ({payload?.metricsSource ?? "official-sales-margin-rules-engine"}).
          Nenhum cálculo é feito nesta tela — apenas parâmetros e preview via backend.
        </p>
      </div>

      {error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}
      {saveMessage ? (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-800">
          {saveMessage}
        </div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4 rounded-2xl border border-border p-4">
          <h4 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
            Regra fiscal padrão (TaxRule)
          </h4>
          <select
            value={form.defaultTaxRuleId ?? ""}
            disabled={!canEdit}
            onChange={(e) =>
              setForm({ ...form, defaultTaxRuleId: e.target.value || null })
            }
            className="w-full p-3 bg-background border border-border rounded-xl text-sm"
          >
            <option value="">— Selecionar regra —</option>
            {(payload?.taxRules ?? []).map((rule) => (
              <option key={rule.id} value={rule.id}>
                {rule.name} ({formatNumber(rule.totalPercent, 2)}%)
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">{payload?.productTaxPriorityNote}</p>

          {fiscalAssessment && fiscalAssessment.status !== "OK" && salesMarginNomusRequiresDefaultTaxRule(form) ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive space-y-1">
              <p className="font-semibold flex items-center gap-1">
                <AlertTriangle className="h-3.5 w-3.5" />
                Configuração fiscal incompleta
              </p>
              {fiscalAssessment.reasons.map((reason) => (
                <p key={reason} className="text-xs">
                  {reason}
                </p>
              ))}
              {!form.defaultTaxRuleId ? (
                <p className="text-xs">{SALES_MARGIN_NOMUS_TAX_RULE_REQUIRED_MESSAGE}</p>
              ) : null}
            </div>
          ) : selectedRule ? (
            <div className="rounded-xl bg-muted/40 p-3 text-sm space-y-2">
              <p className="font-semibold">{selectedRule.name}</p>
              <p className="text-xs text-muted-foreground">
                Status: {selectedRule.status ?? "—"} · Operação: {selectedRule.operation}
              </p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="py-1">Componente</th>
                    <th className="py-1 text-right">%</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedRule.components.map((c) => (
                    <tr key={c.id}>
                      <td className="py-1">{c.name}</td>
                      <td className="py-1 text-right tabular-nums">{formatNumber(c.percentage, 2)}%</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-bold border-t border-border">
                    <td className="pt-2">Total</td>
                    <td className="pt-2 text-right">{formatNumber(selectedRule.totalPercent, 2)}%</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : form.taxMode === "none" ? (
            <p className="text-xs text-muted-foreground">
              Modo sem imposto — TaxRule padrão não é obrigatória neste modo.
            </p>
          ) : null}
        </div>

        <div className="space-y-3 rounded-2xl border border-border p-4">
          <h4 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
            Comportamento do motor
          </h4>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>Modo fiscal na margem gerencial</span>
            <select
              disabled={!canEdit}
              value={form.taxMode}
              onChange={(e) =>
                setForm({
                  ...form,
                  taxMode: e.target.value === "none" ? "none" : "deductFromGross",
                })
              }
              className="p-2 border border-border rounded-lg text-sm"
            >
              <option value="deductFromGross">Deduzir imposto (gerencial)</option>
              <option value="none">Sem imposto (margem vendida)</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              disabled={!canEdit}
              checked={form.allowLiveCostFallback}
              onChange={(e) => setForm({ ...form, allowLiveCostFallback: e.target.checked })}
            />
            Permitir fallback de custo de produção via motor IndusCost (getProductCostAnalysis)
          </label>
          <p className="text-xs text-muted-foreground rounded-lg bg-muted/40 p-3">
            O custo de produção vem exclusivamente do motor de custo industrial IndusCost (custo vigente por produto — futura tabela publicada).
            <strong> SalesOrderItem.unitCost</strong> espelha preço unitário de venda Nomus — não entra na margem como custo de produção.
            Itens sem custo de produção resolvido ficam como SEM_CUSTO e reduzem a cobertura.
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              disabled={!canEdit}
              checked={form.showPartialCoverageWarning}
              onChange={(e) => setForm({ ...form, showPartialCoverageWarning: e.target.checked })}
            />
            Exibir aviso quando margem for parcial (PARTIAL)
          </label>
          <p className="text-xs text-muted-foreground pt-2">
            Custo zero silencioso é proibido — itens sem custo ficam como SEM_CUSTO e reduzem a cobertura.
          </p>
        </div>
      </div>

      {canEdit ? (
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-bold disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Salvar configuração Nomus
        </button>
      ) : (
        <p className="text-xs text-muted-foreground">Somente perfis com permissão de edição de parâmetros globais.</p>
      )}

      <div className="rounded-2xl border border-border p-4 space-y-4">
        <h4 className="text-sm font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
          <Percent className="h-4 w-4" />
          Preview / auditoria (motor oficial)
        </h4>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="text-xs font-bold text-muted-foreground">Ano</label>
            <input
              type="number"
              value={previewFilters.year}
              onChange={(e) => setPreviewFilters({ ...previewFilters, year: e.target.value })}
              className="block w-24 p-2 border border-border rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-muted-foreground">Mês</label>
            <input
              type="number"
              min={1}
              max={12}
              value={previewFilters.month}
              onChange={(e) => setPreviewFilters({ ...previewFilters, month: e.target.value })}
              className="block w-20 p-2 border border-border rounded-lg text-sm"
            />
          </div>
          <button
            type="button"
            onClick={() => void runPreview()}
            disabled={previewLoading}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted/50"
          >
            {previewLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Atualizar preview
          </button>
        </div>

        {preview ? (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2 items-center">
              <span className={cn("text-xs font-bold px-2 py-1 rounded-full", coverageBadgeClass(preview.costCoverageStatus))}>
                Cobertura: {preview.costCoverageStatus}
              </span>
              {preview.warnings.map((w) => (
                <span key={w} className="text-xs text-amber-800 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> {w}
                </span>
              ))}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Valor vendido total</p>
                <p className="font-bold tabular-nums">{formatCurrency(preview.totalSalesRevenueInScope)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Receita coberta</p>
                <p className="font-bold tabular-nums">{formatCurrency(preview.marginRevenueCovered)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Receita sem custo</p>
                <p className="font-bold tabular-nums">{formatCurrency(preview.marginRevenueUncovered)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Cobertura %</p>
                <p className="font-bold tabular-nums">
                  {preview.marginCoveragePercent != null
                    ? `${formatNumber(preview.marginCoveragePercent, 2)}%`
                    : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{resolveSalesOrderMarginMoneyLabel(coverageForLabels)}</p>
                <p className="font-bold tabular-nums">{formatCurrency(preview.marginValue)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{resolveSalesOrderMarginPercentLabel(coverageForLabels)}</p>
                <p className="font-bold tabular-nums">
                  {preview.marginPercent != null ? `${formatNumber(preview.marginPercent, 2)}%` : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Imposto estimado</p>
                <p className="font-bold tabular-nums">{formatCurrency(preview.taxAmount)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Custo total</p>
                <p className="font-bold tabular-nums">{formatCurrency(preview.totalCost)}</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {buildSalesOrderMarginCoverageHint(
                {
                  costCoverageStatus: preview.costCoverageStatus as "FULL" | "PARTIAL" | "NONE",
                  totalSalesRevenueInScope: preview.totalSalesRevenueInScope,
                  marginRevenueCovered: preview.marginRevenueCovered,
                  marginRevenueUncovered: preview.marginRevenueUncovered,
                  marginCoveragePercent: preview.marginCoveragePercent,
                  itemsTotal: preview.itemsTotal,
                  itemsWithCost: preview.itemsTotal - preview.itemsWithoutCost,
                  itemsWithoutCost: preview.itemsWithoutCost,
                },
                formatCurrency
              )}
            </p>
            <p className="text-xs text-muted-foreground">
              {preview.ordersCount} pedidos · {preview.itemsTotal} itens · {preview.itemsUsingLiveFallback}{" "}
              com custo IndusCost · {preview.itemsWithoutCost} sem custo de produção
            </p>
            <div>
              <h5 className="text-xs font-bold uppercase text-muted-foreground mb-2">Fontes do cálculo</h5>
              <ul className="text-xs space-y-1">
                {preview.calculationSources.map((row) => (
                  <li key={row.label}>
                    <span className="font-medium">{row.label}:</span> {row.value}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
