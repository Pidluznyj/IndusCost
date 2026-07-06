import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, Plus, RefreshCw, Trash2 } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { buildFinanceTabLoadError } from "@/src/lib/financeTabLoadError";
import type { FinanceCostCenterDto } from "@/src/lib/financeCostCenters";
import {
  FINANCE_CLASSIFICATION_RULE_APPLY_CONFIRMATION_TEXT,
  FINANCE_CLASSIFICATION_RULE_TYPES,
  FINANCE_CLASSIFICATION_RULE_TYPE_LABEL,
  type ClassificationRuleDto,
  type ClassificationRulePreviewPayload,
  type FinancialCostCenterClassificationRuleType,
} from "@/src/lib/financeCostCenterClassificationRulesShared";
import {
  formatFinanceCurrency,
  formatFinanceInteger,
} from "@/src/lib/financeAccountsReceivableFormat";
import {
  FinanceModuleEmptyState,
  FinanceModuleErrorBanner,
  FinanceModuleLoadingBlock,
} from "@/src/components/finance/shared/FinanceModuleStates";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";
import { cn } from "@/src/lib/utils";
import {
  financeModuleFilterFieldClass,
  financeModuleFilterLabelClass,
} from "@/src/lib/financeModuleUiStandards";
import { FinanceSupplierAutocomplete } from "@/src/components/finance/cost-centers/FinanceSupplierAutocomplete";
import type { FinanceSupplierSearchResult } from "@/src/lib/financeSupplierCostCenterRules";
import { ensureFinanceSupplierSearchResult } from "@/src/lib/financeSupplierSearchClient";

type Props = {
  canManage: boolean;
};

const NO_SUPPLIER_TYPES = new Set<FinancialCostCenterClassificationRuleType>([
  "KEYWORDS",
  "DESCRIPTION_CONTAINS",
  "DOCUMENT_CONTAINS",
  "NOMUS_CLASSIFICATION",
  "NO_SUPPLIER",
  "FINANCIAL_NATURE",
  "MANUAL",
]);

function emptyForm() {
  return {
    name: "",
    ruleType: "KEYWORDS" as FinancialCostCenterClassificationRuleType,
    costCenterId: "",
    priority: "200",
    keywords: "",
    descriptionContains: "",
    documentContains: "",
    nomusClassification: "",
    financialNature: "",
    accountsPayableId: "",
    notes: "",
    supplierId: "",
  };
}

export function FinanceGeneralClassificationRulesPanel({ canManage }: Props) {
  const [rules, setRules] = useState<ClassificationRuleDto[]>([]);
  const [centers, setCenters] = useState<FinanceCostCenterDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [preview, setPreview] = useState<ClassificationRulePreviewPayload | null>(null);
  const [saving, setSaving] = useState(false);
  const [applyConfirm, setApplyConfirm] = useState("");
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);
  const [selectedSupplier, setSelectedSupplier] = useState<FinanceSupplierSearchResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rulesPayload, centersPayload] = await Promise.all([
        fetchJsonOk<{ items: ClassificationRuleDto[] }>("/api/finance/classification-rules", {
          credentials: "include",
        }),
        fetchJsonOk<{ items: FinanceCostCenterDto[] }>("/api/finance/cost-centers", {
          credentials: "include",
        }),
      ]);
      setRules(rulesPayload.items);
      setCenters(centersPayload.items.filter((row) => row.status === "ACTIVE"));
    } catch (e) {
      setError(buildFinanceTabLoadError("Não foi possível carregar regras gerenciais.", e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const supplierOptionalHint = useMemo(() => {
    if (NO_SUPPLIER_TYPES.has(form.ruleType)) {
      return "Esta regra não depende de fornecedor. Aplicar mesmo quando o fornecedor estiver vazio ou não for usado como critério.";
    }
    return null;
  }, [form.ruleType]);

  const supplierRequired = form.ruleType === "SUPPLIER";

  const buildPayload = useCallback(() => {
    const keywords = form.keywords
      .split(/[,;\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
    return {
      name: form.name.trim(),
      ruleType: form.ruleType,
      costCenterId: form.costCenterId,
      priority: Number(form.priority) || 100,
      autoApply: false,
      keywords,
      descriptionContains: form.descriptionContains.trim() || null,
      documentContains: form.documentContains.trim() || null,
      nomusClassification: form.nomusClassification.trim() || null,
      financialNature: form.financialNature.trim() || null,
      accountsPayableId: form.accountsPayableId.trim()
        ? Number(form.accountsPayableId)
        : null,
      notes: form.notes.trim() || null,
      supplierId:
        form.ruleType === "SUPPLIER" || form.ruleType === "COMPOSITE"
          ? (selectedSupplier?.id ?? (form.supplierId.trim() || null))
          : null,
    };
  }, [form, selectedSupplier]);

  const runPreview = useCallback(async (ruleId?: string) => {
    if (supplierRequired && !selectedSupplier && !ruleId) {
      setError("Selecione o fornecedor para preview de regra por fornecedor.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      let payloadBody = buildPayload();
      if (!ruleId && selectedSupplier) {
        const supplierId = await ensureFinanceSupplierSearchResult(selectedSupplier);
        payloadBody = { ...payloadBody, supplierId };
      }
      const payload = ruleId
        ? await fetchJsonOk<ClassificationRulePreviewPayload>(
            `/api/finance/classification-rules/${ruleId}/preview`,
            { credentials: "include" }
          )
        : await fetchJsonOk<ClassificationRulePreviewPayload>(
            "/api/finance/classification-rules/preview",
            {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payloadBody),
            }
          );
      setPreview(payload);
      setSelectedRuleId(ruleId ?? null);
      setApplyConfirm("");
    } catch (e) {
      setError(buildFinanceTabLoadError("Não foi possível gerar preview da regra.", e));
    } finally {
      setSaving(false);
    }
  }, [buildPayload, selectedSupplier, supplierRequired]);

  const saveRule = useCallback(async () => {
    if (supplierRequired && !selectedSupplier) {
      setError("Selecione o fornecedor para regras do tipo Fornecedor.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      let supplierId = buildPayload().supplierId;
      if (selectedSupplier) {
        supplierId = await ensureFinanceSupplierSearchResult(selectedSupplier);
      }
      await fetchJsonOk("/api/finance/classification-rules", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...buildPayload(), supplierId }),
      });
      setFormOpen(false);
      setForm(emptyForm());
      setSelectedSupplier(null);
      await load();
    } catch (e) {
      setError(buildFinanceTabLoadError("Não foi possível salvar a regra.", e));
    } finally {
      setSaving(false);
    }
  }, [buildPayload, load, selectedSupplier, supplierRequired]);

  const applyRule = useCallback(async () => {
    if (!selectedRuleId) return;
    setSaving(true);
    setError(null);
    try {
      await fetchJsonOk(`/api/finance/classification-rules/${selectedRuleId}/apply`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmationText: applyConfirm }),
      });
      setPreview(null);
      setApplyConfirm("");
      await load();
    } catch (e) {
      setError(buildFinanceTabLoadError("Não foi possível aplicar a regra.", e));
    } finally {
      setSaving(false);
    }
  }, [applyConfirm, load, selectedRuleId]);

  const deactivateRule = useCallback(
    async (id: string) => {
      if (!window.confirm("Desativar esta regra de classificação?")) return;
      setSaving(true);
      try {
        await fetchJsonOk(`/api/finance/classification-rules/${id}`, {
          method: "DELETE",
          credentials: "include",
        });
        await load();
      } catch (e) {
        setError(buildFinanceTabLoadError("Não foi possível desativar a regra.", e));
      } finally {
        setSaving(false);
      }
    },
    [load]
  );

  if (loading) {
    return <FinanceModuleLoadingBlock label="Carregando regras por natureza/descrição…" />;
  }

  return (
    <section className="space-y-4" data-testid="finance-general-classification-rules">
      <div className={cn(financeBiCardClass, "p-4 space-y-2")}>
        <h3 className="text-sm font-semibold">Regras por natureza, descrição e palavras-chave</h3>
        <p className="text-xs text-muted-foreground">
          Classifique títulos AP sem depender obrigatoriamente de fornecedor. O fornecedor oficial
          do Nomus permanece intacto — esta camada é gerencial.
        </p>
      </div>

      {error ? (
        <FinanceModuleErrorBanner message={error} onRetry={() => void load()} onDismiss={() => setError(null)} />
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"
          disabled={!canManage}
          onClick={() => {
            setFormOpen(true);
            setPreview(null);
            setSelectedSupplier(null);
          }}
        >
          <Plus className="h-4 w-4" />
          Nova regra gerencial
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold"
          onClick={() => void load()}
        >
          <RefreshCw className="h-4 w-4" />
          Atualizar
        </button>
      </div>

      {rules.length === 0 ? (
        <FinanceModuleEmptyState title="Nenhuma regra gerencial cadastrada." />
      ) : (
        <div className="overflow-auto rounded-xl border">
          <table className="min-w-full text-xs">
            <thead className="bg-muted/40 text-[10px] uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Nome</th>
                <th className="px-3 py-2 text-left">Tipo</th>
                <th className="px-3 py-2 text-left">Centro de custo</th>
                <th className="px-3 py-2 text-right">Prioridade</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id} className="border-t">
                  <td className="px-3 py-2 font-medium">{rule.name}</td>
                  <td className="px-3 py-2">{FINANCE_CLASSIFICATION_RULE_TYPE_LABEL[rule.ruleType]}</td>
                  <td className="px-3 py-2">
                    {rule.costCenterCode} — {rule.costCenterName}
                  </td>
                  <td className="px-3 py-2 text-right">{rule.priority}</td>
                  <td className="px-3 py-2">{rule.isActive ? "Ativa" : "Inativa"}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      className="mr-2 inline-flex items-center gap-1 text-primary"
                      onClick={() => void runPreview(rule.id)}
                    >
                      <Eye className="h-3.5 w-3.5" />
                      Preview
                    </button>
                    {canManage ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-destructive"
                        onClick={() => void deactivateRule(rule.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {formOpen ? (
        <div className={cn(financeBiCardClass, "space-y-5 p-5")} data-testid="finance-classification-rule-form">
          <div>
            <h4 className="text-base font-semibold text-foreground">Cadastrar regra gerencial</h4>
            <p className="mt-1 text-xs text-muted-foreground">
              Preencha os campos abaixo. A prioridade define a ordem de aplicação (menor número = maior precedência).
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="block space-y-1.5">
              <span className={cn(financeModuleFilterLabelClass(), "block")}>Nome da regra</span>
              <input
                className={financeModuleFilterFieldClass()}
                value={form.name}
                placeholder="Ex.: Estornos e devoluções"
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              />
            </label>
            <label className="block space-y-1.5">
              <span className={cn(financeModuleFilterLabelClass(), "block")}>Tipo da regra</span>
              <select
                className={financeModuleFilterFieldClass()}
                value={form.ruleType}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    ruleType: e.target.value as FinancialCostCenterClassificationRuleType,
                  }))
                }
              >
                {FINANCE_CLASSIFICATION_RULE_TYPES.map((row) => (
                  <option key={row.value} value={row.value}>
                    {row.label}
                  </option>
                ))}
              </select>
            </label>
            {supplierRequired ? (
              <label className="block space-y-1.5 md:col-span-2" data-testid="finance-classification-supplier-field">
                <span className={cn(financeModuleFilterLabelClass(), "block")}>
                  Fornecedor <span className="text-destructive">*</span>
                </span>
                <FinanceSupplierAutocomplete
                  selected={selectedSupplier}
                  onSelect={setSelectedSupplier}
                  disabled={saving}
                  testIdPrefix="finance-classification-supplier"
                />
              </label>
            ) : null}
            <label className="block space-y-1.5 md:col-span-2">
              <span className={cn(financeModuleFilterLabelClass(), "block")}>Centro de custo destino</span>
              <select
                className={financeModuleFilterFieldClass()}
                value={form.costCenterId}
                onChange={(e) => setForm((prev) => ({ ...prev, costCenterId: e.target.value }))}
              >
                <option value="">Selecione…</option>
                {centers.map((cc) => (
                  <option key={cc.id} value={cc.id}>
                    {cc.code} — {cc.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1.5">
              <span className={cn(financeModuleFilterLabelClass(), "block")}>Prioridade</span>
              <input
                className={financeModuleFilterFieldClass()}
                type="number"
                min={1}
                value={form.priority}
                onChange={(e) => setForm((prev) => ({ ...prev, priority: e.target.value }))}
              />
            </label>
            {form.ruleType === "KEYWORDS" || form.ruleType === "COMPOSITE" ? (
              <label className="block space-y-1.5 md:col-span-2">
                <span className={cn(financeModuleFilterLabelClass(), "block")}>
                  Palavras-chave (vírgula ou linha)
                </span>
                <textarea
                  className={cn(financeModuleFilterFieldClass(), "min-h-28 resize-y")}
                  value={form.keywords}
                  onChange={(e) => setForm((prev) => ({ ...prev, keywords: e.target.value }))}
                  placeholder="estorno, ressarcimento, devolução cliente"
                  rows={4}
                />
              </label>
            ) : null}
            {form.ruleType === "DESCRIPTION_CONTAINS" || form.ruleType === "COMPOSITE" ? (
              <label className="block space-y-1.5 md:col-span-2">
                <span className={cn(financeModuleFilterLabelClass(), "block")}>Descrição contém</span>
                <input
                  className={financeModuleFilterFieldClass()}
                  value={form.descriptionContains}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, descriptionContains: e.target.value }))
                  }
                />
              </label>
            ) : null}
            {form.ruleType === "DOCUMENT_CONTAINS" ? (
              <label className="block space-y-1.5 md:col-span-2">
                <span className={cn(financeModuleFilterLabelClass(), "block")}>Documento contém</span>
                <input
                  className={financeModuleFilterFieldClass()}
                  value={form.documentContains}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, documentContains: e.target.value }))
                  }
                />
              </label>
            ) : null}
            {form.ruleType === "NOMUS_CLASSIFICATION" || form.ruleType === "COMPOSITE" ? (
              <label className="block space-y-1.5 md:col-span-2">
                <span className={cn(financeModuleFilterLabelClass(), "block")}>Classificação Nomus</span>
                <input
                  className={financeModuleFilterFieldClass()}
                  value={form.nomusClassification}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, nomusClassification: e.target.value }))
                  }
                />
              </label>
            ) : null}
            {form.ruleType === "FINANCIAL_NATURE" ? (
              <label className="block space-y-1.5 md:col-span-2">
                <span className={cn(financeModuleFilterLabelClass(), "block")}>Natureza financeira</span>
                <input
                  className={financeModuleFilterFieldClass()}
                  value={form.financialNature}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, financialNature: e.target.value }))
                  }
                />
              </label>
            ) : null}
            {form.ruleType === "MANUAL" ? (
              <label className="block space-y-1.5">
                <span className={cn(financeModuleFilterLabelClass(), "block")}>ID do título AP</span>
                <input
                  className={financeModuleFilterFieldClass()}
                  value={form.accountsPayableId}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, accountsPayableId: e.target.value }))
                  }
                />
              </label>
            ) : null}
            <label className="block space-y-1.5 md:col-span-2">
              <span className={cn(financeModuleFilterLabelClass(), "block")}>Observação</span>
              <textarea
                className={cn(financeModuleFilterFieldClass(), "min-h-24 resize-y")}
                value={form.notes}
                onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
                placeholder="Notas internas sobre esta regra (opcional)"
                rows={3}
              />
            </label>
          </div>
          {supplierOptionalHint ? (
            <p className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5 text-xs leading-relaxed text-primary">
              {supplierOptionalHint}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
            <button
              type="button"
              className="rounded-lg border px-3 py-2 text-xs font-semibold"
              onClick={() => void runPreview()}
              disabled={saving}
            >
              Preview
            </button>
            <button
              type="button"
              className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"
              onClick={() => void saveRule()}
              disabled={!canManage || saving}
            >
              Salvar regra
            </button>
            <button
              type="button"
              className="rounded-lg border px-3 py-2 text-xs font-semibold"
              onClick={() => setFormOpen(false)}
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : null}

      {preview ? (
        <div className={cn(financeBiCardClass, "p-4 space-y-3")} data-testid="finance-classification-rule-preview">
          <h4 className="text-sm font-semibold">Preview — {preview.rule.name}</h4>
          <div className="grid gap-2 sm:grid-cols-3">
            <p className="text-xs">
              Títulos encontrados:{" "}
              <strong>{formatFinanceInteger(preview.matchedTitlesCount)}</strong>
            </p>
            <p className="text-xs">
              Valor impactado: <strong>{formatFinanceCurrency(preview.matchedAmount)}</strong>
            </p>
            <p className="text-xs">
              Aplicaria em: <strong>{formatFinanceInteger(preview.wouldApplyCount)}</strong> (
              {formatFinanceCurrency(preview.wouldApplyAmount)})
            </p>
          </div>
          {preview.warnings.map((warning) => (
            <p key={warning} className="text-xs text-amber-700">
              {warning}
            </p>
          ))}
          {preview.sampleTitles.length > 0 ? (
            <div className="max-h-48 overflow-auto rounded border text-xs">
              <table className="min-w-full">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="px-2 py-1 text-left">AP</th>
                    <th className="px-2 py-1 text-left">Descrição</th>
                    <th className="px-2 py-1 text-left">Motivo</th>
                    <th className="px-2 py-1 text-right">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.sampleTitles.map((row) => (
                    <tr key={row.accountsPayableId} className="border-t">
                      <td className="px-2 py-1">{row.accountsPayableId}</td>
                      <td className="px-2 py-1">{row.description ?? "—"}</td>
                      <td className="px-2 py-1">{row.matchReason}</td>
                      <td className="px-2 py-1 text-right">{formatFinanceCurrency(row.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {selectedRuleId && canManage ? (
            <div className="space-y-2 border-t pt-3">
              <p className="text-xs text-muted-foreground">
                Confirme digitando:{" "}
                <code>{FINANCE_CLASSIFICATION_RULE_APPLY_CONFIRMATION_TEXT}</code>
              </p>
              <input
                className={financeModuleFilterFieldClass()}
                value={applyConfirm}
                onChange={(e) => setApplyConfirm(e.target.value)}
              />
              <button
                type="button"
                className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"
                disabled={
                  saving || applyConfirm.trim() !== FINANCE_CLASSIFICATION_RULE_APPLY_CONFIRMATION_TEXT
                }
                onClick={() => void applyRule()}
              >
                Confirmar aplicação
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
