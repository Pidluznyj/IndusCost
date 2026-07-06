import React, { useEffect, useMemo, useState } from "react";
import { Loader2, X } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import type {
  CommissionsPersonsPayload,
  CommissionsRuleFormInput,
  CommissionsRuleItem,
} from "@/src/components/commissions/commissionsTypes";
import { CommissionsRuleConditionsSection } from "@/src/components/commissions/rules/CommissionsRuleConditionsSection";
import {
  buildCommissionRuleSummary,
  COMMISSION_RULE_BASE_OPTIONS,
  COMMISSION_RULE_BENEFICIARY_OPTIONS,
  COMMISSION_RULE_RELEASE_OPTIONS,
  COMMISSION_RULE_CALCULATION_OPTIONS,
  dateInputToIsoEnd,
  dateInputToIsoStart,
  isoToDateInput,
} from "@/src/components/commissions/rules/commissionsRulesLabels";

type Props = {
  open: boolean;
  mode: "create" | "edit";
  initial?: CommissionsRuleItem | null;
  saving?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (payload: CommissionsRuleFormInput) => Promise<void>;
};

type FormState = CommissionsRuleFormInput & {
  validFromInput: string;
  validToInput: string;
};

const EMPTY: FormState = {
  name: "",
  description: null,
  active: true,
  priority: 100,
  beneficiaryType: "SELLER",
  calculationType: "FIXED_PERCENT",
  fixedCommissionPersonId: null,
  ratePercent: 0,
  baseType: "SALES_ORDER_ITEM_NET",
  releaseRule: "EACH_RECEIVABLE_PAID",
  validFrom: null,
  validTo: null,
  validFromInput: "",
  validToInput: "",
  conditions: [],
};

export function CommissionsRuleFormModal({
  open,
  mode,
  initial,
  saving,
  error,
  onClose,
  onSubmit,
}: Props) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [conditionsOpen, setConditionsOpen] = useState(false);
  const [persons, setPersons] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const payload = await fetchJsonOk<CommissionsPersonsPayload>(
          "/api/commissions/persons?page=1&pageSize=200&active=true"
        );
        if (!cancelled) {
          setPersons(payload.items.map((p) => ({ id: p.id, name: p.name })));
        }
      } catch {
        if (!cancelled) setPersons([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setForm({
        name: initial.name,
        description: initial.description,
        active: initial.active,
        priority: initial.priority,
        beneficiaryType: initial.beneficiaryType,
        calculationType: initial.calculationType ?? "FIXED_PERCENT",
        fixedCommissionPersonId: initial.fixedCommissionPersonId,
        ratePercent: initial.ratePercent,
        baseType: initial.baseType,
        releaseRule: initial.releaseRule,
        validFrom: initial.validFrom,
        validTo: initial.validTo,
        validFromInput: isoToDateInput(initial.validFrom),
        validToInput: isoToDateInput(initial.validTo),
        conditions: initial.conditions.map((c) => ({ ...c })),
      });
      setConditionsOpen(initial.conditions.length > 0);
    } else {
      setForm(EMPTY);
      setConditionsOpen(false);
    }
  }, [open, initial]);

  const fixedPersonName = useMemo(() => {
    if (!form.fixedCommissionPersonId) return initial?.fixedCommissionPersonName ?? null;
    return (
      persons.find((p) => p.id === form.fixedCommissionPersonId)?.name ??
      initial?.fixedCommissionPersonName ??
      null
    );
  }, [form.fixedCommissionPersonId, persons, initial?.fixedCommissionPersonName]);

  const summary = useMemo(
    () =>
      buildCommissionRuleSummary({
        ...form,
        fixedCommissionPersonName: fixedPersonName,
      }),
    [form, fixedPersonName]
  );

  if (!open) return null;

  const fieldClass =
    "w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-sm text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (
      form.validFromInput &&
      form.validToInput &&
      form.validFromInput > form.validToInput
    ) {
      return;
    }
    await onSubmit({
      name: form.name.trim(),
      description: form.description?.trim() || null,
      active: form.active,
      priority: form.priority,
      beneficiaryType: form.beneficiaryType,
      calculationType: form.calculationType,
      fixedCommissionPersonId:
        form.beneficiaryType === "FIXED_PERSON" ? form.fixedCommissionPersonId : null,
      ratePercent: form.calculationType === "COMMERCIAL_PRICE_TIER" ? 0 : form.ratePercent,
      baseType: form.baseType,
      releaseRule: form.releaseRule,
      validFrom: dateInputToIsoStart(form.validFromInput),
      validTo: dateInputToIsoEnd(form.validToInput),
      conditions: form.conditions,
    });
  }

  const periodInvalid =
    form.validFromInput &&
    form.validToInput &&
    form.validFromInput > form.validToInput;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="commission-rule-form-title"
    >
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-[#E5E7EB] px-5 py-4">
          <h2 id="commission-rule-form-title" className="text-lg font-bold text-[#111827]">
            {mode === "create" ? "Nova regra de comissão" : "Editar regra de comissão"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-[#6B7280] hover:bg-[#F3F4F6]"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 p-5">
          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </div>
          ) : null}

          <div className="rounded-lg bg-[#EFF6FF] px-4 py-3 text-sm text-[#1E40AF]">
            {summary}
          </div>

          <label className="block space-y-1">
            <span className="text-xs font-medium text-[#6B7280]">Nome da regra *</span>
            <input
              required
              className={fieldClass}
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-medium text-[#6B7280]">Descrição</span>
            <textarea
              rows={2}
              className={fieldClass}
              value={form.description ?? ""}
              onChange={(e) =>
                setForm((f) => ({ ...f, description: e.target.value.trim() || null }))
              }
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-medium text-[#6B7280]">Tipo de comissão *</span>
            <select
              required
              className={fieldClass}
              value={form.calculationType}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  calculationType: e.target.value,
                  ratePercent: e.target.value === "COMMERCIAL_PRICE_TIER" ? 0 : f.ratePercent,
                }))
              }
            >
              {COMMISSION_RULE_CALCULATION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            {form.calculationType === "COMMERCIAL_PRICE_TIER" ? (
              <p className="text-[11px] text-[#6B7280] leading-snug">
                A comissão será resolvida conforme a faixa de preço em que o item vendido se
                enquadrar: Atacado, Varejo 1, Varejo 2 ou Varejo 3 — usando as tabelas geradas em
                Formação de Preço.
              </p>
            ) : null}
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-[#6B7280]">Prioridade *</span>
              <input
                type="number"
                required
                className={fieldClass}
                value={form.priority}
                onChange={(e) =>
                  setForm((f) => ({ ...f, priority: Number.parseInt(e.target.value, 10) || 0 }))
                }
              />
            </label>
            {form.calculationType === "FIXED_PERCENT" ? (
              <label className="block space-y-1">
                <span className="text-xs font-medium text-[#6B7280]">Percentual (%) *</span>
                <input
                  type="number"
                  required
                  min={0}
                  step="0.0001"
                  className={fieldClass}
                  value={form.ratePercent}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      ratePercent: Number.parseFloat(e.target.value) || 0,
                    }))
                  }
                />
              </label>
            ) : (
              <div className="flex items-end">
                <p className="text-xs text-[#6B7280] pb-2">
                  Percentual definido pela tabela comercial publicada.
                </p>
              </div>
            )}
          </div>

          <label className="block space-y-1">
            <span className="text-xs font-medium text-[#6B7280]">Beneficiário *</span>
            <select
              required
              className={fieldClass}
              value={form.beneficiaryType}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  beneficiaryType: e.target.value,
                  fixedCommissionPersonId:
                    e.target.value === "FIXED_PERSON" ? f.fixedCommissionPersonId : null,
                }))
              }
            >
              {COMMISSION_RULE_BENEFICIARY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          {form.beneficiaryType === "FIXED_PERSON" ? (
            <label className="block space-y-1">
              <span className="text-xs font-medium text-[#6B7280]">Pessoa fixa *</span>
              <select
                required
                className={fieldClass}
                value={form.fixedCommissionPersonId ?? ""}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    fixedCommissionPersonId: e.target.value || null,
                  }))
                }
              >
                <option value="">Selecione…</option>
                {persons.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-[#6B7280]">Base de cálculo *</span>
              <select
                required
                className={fieldClass}
                value={form.baseType}
                onChange={(e) => setForm((f) => ({ ...f, baseType: e.target.value }))}
              >
                {COMMISSION_RULE_BASE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-[#6B7280]">Regra de liberação *</span>
              <select
                required
                className={fieldClass}
                value={form.releaseRule}
                onChange={(e) => setForm((f) => ({ ...f, releaseRule: e.target.value }))}
              >
                {COMMISSION_RULE_RELEASE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-[#6B7280]">Vigência inicial</span>
              <input
                type="date"
                className={fieldClass}
                value={form.validFromInput}
                onChange={(e) => setForm((f) => ({ ...f, validFromInput: e.target.value }))}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-[#6B7280]">Vigência final</span>
              <input
                type="date"
                className={fieldClass}
                value={form.validToInput}
                onChange={(e) => setForm((f) => ({ ...f, validToInput: e.target.value }))}
              />
            </label>
          </div>
          {periodInvalid ? (
            <p className="text-xs text-red-600">
              Vigência final não pode ser anterior à vigência inicial.
            </p>
          ) : null}

          <label className="inline-flex items-center gap-2 text-sm text-[#374151]">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
            />
            Regra ativa
          </label>

          <CommissionsRuleConditionsSection
            open={conditionsOpen}
            onToggle={() => setConditionsOpen((v) => !v)}
            conditions={form.conditions}
            onChange={(conditions) => setForm((f) => ({ ...f, conditions }))}
          />

          <div className="flex justify-end gap-2 border-t border-[#E5E7EB] pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[#E5E7EB] px-4 py-2 text-sm font-medium text-[#374151] hover:bg-[#F9FAFB]"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving || Boolean(periodInvalid)}
              className="inline-flex items-center gap-2 rounded-lg bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {mode === "create" ? "Criar" : "Salvar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
