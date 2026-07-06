import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, RotateCcw, Save } from "lucide-react";
import { useAuth } from "@/src/contexts/AuthContext";
import { COMMISSIONS_SETTINGS_MANAGE_PERMISSIONS } from "@/src/lib/commissionsPermissions";
import {
  CommissionsEmptyState,
  CommissionsErrorBanner,
  CommissionsLoading,
  formatCommissionsApiError,
} from "@/src/components/commissions/commissionsUi";
import type { CommissionsSettingsPayload } from "@/src/components/commissions/commissionsTypes";
import {
  buildCalculationImpactWarning,
  buildReceivableWarning,
  COMMISSION_SETTINGS_SECTIONS,
  RELEASE_RULE_OPTIONS,
  validateSettingsForm,
} from "@/src/components/commissions/settings/commissionsSettingsConfig";
import {
  restoreCommissionSettingsApi,
  saveCommissionSettingsApi,
  useCommissionsSettingsData,
} from "@/src/components/commissions/settings/useCommissionsSettingsData";

const toggleClass =
  "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-[#2563EB]/40 disabled:cursor-not-allowed disabled:opacity-50";

function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`${toggleClass} ${checked ? "bg-[#2563EB]" : "bg-[#D1D5DB]"}`}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
          checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

export function CommissionsSettingsPage() {
  const auth = useAuth();
  const canManage = auth.hasAnyPermission([...COMMISSIONS_SETTINGS_MANAGE_PERMISSIONS]);

  const { data, loading, error, reload, setData } = useCommissionsSettingsData();
  const [form, setForm] = useState<CommissionsSettingsPayload | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveWarnings, setSaveWarnings] = useState<string[]>([]);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (data) {
      setForm({ ...data });
      setDirty(false);
    }
  }, [data]);

  const receivableWarning = useMemo(
    () => (form ? buildReceivableWarning(form) : null),
    [form]
  );

  const calculationImpactDirty = useMemo(() => {
    if (!form || !data) return false;
    const impactKeys = COMMISSION_SETTINGS_SECTIONS.flatMap((s) =>
      s.fields.filter((f) => f.impactsCalculation).map((f) => f.key)
    );
    return impactKeys.some((key) => form[key] !== data[key]);
  }, [form, data]);

  function patchField<K extends keyof CommissionsSettingsPayload>(
    key: K,
    value: CommissionsSettingsPayload[K]
  ) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
    setDirty(true);
    setSaveSuccess(null);
  }

  async function handleSave() {
    if (!form || !canManage) return;
    const validationError = validateSettingsForm(form);
    if (validationError) {
      setSaveError(validationError);
      return;
    }
    if (receivableWarning) {
      const ok = window.confirm(`${receivableWarning}\n\nDeseja salvar mesmo assim?`);
      if (!ok) return;
    }
    if (calculationImpactDirty) {
      const ok = window.confirm(`${buildCalculationImpactWarning(form)}\n\nContinuar?`);
      if (!ok) return;
    }

    setSaving(true);
    setSaveError(null);
    setSaveWarnings([]);
    try {
      const saved = await saveCommissionSettingsApi(form);
      setData(saved);
      setForm({ ...saved });
      setDirty(false);
      setSaveSuccess("Configurações salvas com sucesso.");
      if (saved.warnings?.length) setSaveWarnings(saved.warnings);
    } catch (e: unknown) {
      setSaveError(formatCommissionsApiError(e, "Não foi possível salvar as configurações."));
    } finally {
      setSaving(false);
    }
  }

  async function handleRestore() {
    if (!canManage) return;
    const ok = window.confirm(
      "Restaurar todas as configurações para os valores padrão do módulo?\n\nEsta ação não pode ser desfeita automaticamente."
    );
    if (!ok) return;

    setRestoring(true);
    setSaveError(null);
    setSaveWarnings([]);
    setSaveSuccess(null);
    try {
      const restored = await restoreCommissionSettingsApi();
      setData(restored);
      setForm({ ...restored });
      setDirty(false);
      setSaveSuccess("Configurações restauradas para o padrão.");
      if (restored.warnings?.length) setSaveWarnings(restored.warnings);
    } catch (e: unknown) {
      setSaveError(formatCommissionsApiError(e, "Não foi possível restaurar as configurações."));
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div className="space-y-5" data-testid="commissions-settings-page">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B7280]">
            Configurações
          </p>
          <h3 className="text-xl font-extrabold tracking-tight text-[#111827]">
            Parâmetros gerais do módulo de comissões
          </h3>
          <p className="mt-1 max-w-3xl text-sm text-[#6B7280]">
            Ajuste cálculo, pagamento, auditoria e escopo sem alterar código. Valores são
            persistidos em CommissionSettings.
          </p>
        </div>
        {canManage ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={restoring || saving || loading}
              onClick={() => void handleRestore()}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#E5E7EB] px-3 text-sm font-semibold text-[#111827] hover:bg-[#F9FAFB] disabled:opacity-50"
              data-testid="commissions-settings-restore-btn"
            >
              <RotateCcw className="h-4 w-4" />
              Restaurar padrões
            </button>
            <button
              type="button"
              disabled={!dirty || saving || loading}
              onClick={() => void handleSave()}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#2563EB] px-3 text-sm font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-50"
              data-testid="commissions-settings-save-btn"
            >
              <Save className="h-4 w-4" />
              Salvar
            </button>
          </div>
        ) : null}
      </div>

      {error ? <CommissionsErrorBanner message={error} onRetry={() => void reload()} /> : null}
      {saveError ? (
        <CommissionsErrorBanner message={saveError} onRetry={() => setSaveError(null)} />
      ) : null}
      {saveSuccess ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {saveSuccess}
        </div>
      ) : null}
      {saveWarnings.length > 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 space-y-1">
          {saveWarnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
        </div>
      ) : null}
      {calculationImpactDirty && form ? (
        <div
          className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-950"
          data-testid="commissions-settings-impact-banner"
        >
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <p className="text-sm">{buildCalculationImpactWarning(form)}</p>
        </div>
      ) : null}
      {receivableWarning ? (
        <div
          className="flex items-start gap-3 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-red-950"
          data-testid="commissions-settings-receivable-warning"
        >
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
          <p className="text-sm font-medium">{receivableWarning}</p>
        </div>
      ) : null}

      {loading ? <CommissionsLoading label="Carregando configurações…" /> : null}

      {!loading && !error && !form ? (
        <CommissionsEmptyState
          title="Configurações indisponíveis"
          description="Não foi possível montar o formulário de configurações."
        />
      ) : null}

      {!loading && form ? (
        <div className="space-y-5">
          {COMMISSION_SETTINGS_SECTIONS.map((section) => (
            <section
              key={section.id}
              className="rounded-xl border border-[#E5E7EB] bg-white p-5 space-y-4"
              data-testid={`commissions-settings-section-${section.id}`}
            >
              <div>
                <h4 className="text-base font-bold text-[#111827]">{section.title}</h4>
                <p className="mt-1 text-sm text-[#6B7280]">{section.description}</p>
              </div>
              <div className="space-y-4">
                {section.fields.map((field) => (
                  <div
                    key={field.key}
                    className="flex flex-wrap items-start justify-between gap-4 border-t border-[#F3F4F6] pt-4 first:border-t-0 first:pt-0"
                  >
                    <div className="min-w-0 flex-1 max-w-3xl">
                      <p className="text-sm font-semibold text-[#111827]">{field.label}</p>
                      <p className="mt-1 text-sm text-[#6B7280]">{field.description}</p>
                      {field.strongWarningWhenFalse &&
                      field.type === "boolean" &&
                      form[field.key] === false ? (
                        <p className="mt-2 text-xs font-semibold text-red-700">
                          Atenção: esta opção desativada altera o comportamento de liberação.
                        </p>
                      ) : null}
                    </div>
                    <div className="shrink-0">
                      {field.type === "boolean" ? (
                        <Toggle
                          checked={Boolean(form[field.key])}
                          onChange={(next) => patchField(field.key, next)}
                          disabled={!canManage || saving || restoring}
                          label={field.label}
                        />
                      ) : (
                        <select
                          className="h-9 min-w-[16rem] rounded-lg border border-[#E5E7EB] bg-white px-3 text-sm text-[#111827] disabled:opacity-50"
                          value={String(form.releaseDefaultRule)}
                          disabled={!canManage || saving || restoring}
                          onChange={(e) => patchField("releaseDefaultRule", e.target.value)}
                        >
                          {RELEASE_RULE_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : null}
    </div>
  );
}
