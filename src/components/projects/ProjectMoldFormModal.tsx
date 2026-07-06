import React, { useEffect, useMemo, useState } from "react";
import { ProjectModalShell } from "@/src/components/projects/ProjectModalShell";
import {
  buildMoldPayloadFromForm,
  MOLD_CHARGE_MODE_OPTIONS,
  MOLD_OWNERSHIP_OPTIONS,
  parseProjectsNumberInput,
  suggestAmortizedCostPerUnit,
} from "@/src/lib/projectsUiUtils";
import { moldRowToForm } from "@/src/lib/projectsUiUtils";
import type { ProjectMoldChargeMode, ProjectMoldOwnership, ProjectMoldRow } from "@/src/types/projects";

const EMPTY_FORM = {
  name: "",
  moldType: "",
  cavities: "",
  estimatedLifeCycles: "",
  supplierName: "",
  constructionCost: "",
  maintenanceCost: "",
  changeCost: "",
  leadTimeDays: "",
  chargeMode: "CHARGED_SEPARATELY" as ProjectMoldChargeMode,
  amortizationQuantity: "",
  amortizedCostPerUnit: "",
  amortizedManual: false,
  ownership: "UNDEFINED" as ProjectMoldOwnership,
  notes: "",
};

type Props = {
  open: boolean;
  mode?: "create" | "edit";
  initial?: ProjectMoldRow | null;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (payload: ReturnType<typeof buildMoldPayloadFromForm>) => Promise<void>;
};

export function ProjectMoldFormModal({
  open,
  mode = "create",
  initial,
  saving,
  error,
  onClose,
  onSubmit,
}: Props) {
  const [form, setForm] = useState(EMPTY_FORM);

  useEffect(() => {
    if (!open) return;
    setForm(initial ? moldRowToForm(initial) : EMPTY_FORM);
  }, [open, initial]);

  const suggestedAmort = useMemo(() => {
    const construction = parseProjectsNumberInput(form.constructionCost);
    const qty = parseProjectsNumberInput(form.amortizationQuantity);
    return suggestAmortizedCostPerUnit(construction, qty, form.chargeMode, form.amortizedManual);
  }, [
    form.constructionCost,
    form.amortizationQuantity,
    form.chargeMode,
    form.amortizedManual,
  ]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    await onSubmit(buildMoldPayloadFromForm(form));
  };

  const fieldClass = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm";

  return (
    <ProjectModalShell
      title={mode === "create" ? "Adicionar molde / ferramental" : "Editar molde / ferramental"}
      subtitle="Dados do ferramental para simulação de custo. Não cria cadastro oficial."
      onClose={onClose}
      wide
      footer={
        <>
          <button
            type="button"
            className="rounded-lg border border-border px-4 py-2 text-sm"
            onClick={onClose}
            disabled={saving}
          >
            Cancelar
          </button>
          <button
            type="submit"
            form="project-mold-form"
            disabled={saving || !form.name.trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-60"
          >
            {saving ? <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : null}
            Salvar molde
          </button>
        </>
      }
    >
      <form id="project-mold-form" onSubmit={handleSubmit} className="space-y-6">
        {error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        <section className="space-y-3">
          <h4 className="text-sm font-semibold">Identificação</h4>
          <input
            required
            className={fieldClass}
            placeholder="Nome do molde/ferramental *"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              className={fieldClass}
              placeholder="Tipo do molde"
              value={form.moldType}
              onChange={(e) => setForm((f) => ({ ...f, moldType: e.target.value }))}
            />
            <input
              className={fieldClass}
              placeholder="Quantidade de cavidades"
              value={form.cavities}
              onChange={(e) => setForm((f) => ({ ...f, cavities: e.target.value }))}
            />
            <input
              className={fieldClass}
              placeholder="Vida útil estimada (ciclos)"
              value={form.estimatedLifeCycles}
              onChange={(e) => setForm((f) => ({ ...f, estimatedLifeCycles: e.target.value }))}
            />
            <input
              className={fieldClass}
              placeholder="Fornecedor"
              value={form.supplierName}
              onChange={(e) => setForm((f) => ({ ...f, supplierName: e.target.value }))}
            />
          </div>
        </section>

        <section className="space-y-3">
          <h4 className="text-sm font-semibold">Custos e prazos</h4>
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              className={fieldClass}
              placeholder="Custo de construção"
              value={form.constructionCost}
              onChange={(e) => setForm((f) => ({ ...f, constructionCost: e.target.value }))}
            />
            <input
              className={fieldClass}
              placeholder="Custo de manutenção"
              value={form.maintenanceCost}
              onChange={(e) => setForm((f) => ({ ...f, maintenanceCost: e.target.value }))}
            />
            <input
              className={fieldClass}
              placeholder="Custo de alteração"
              value={form.changeCost}
              onChange={(e) => setForm((f) => ({ ...f, changeCost: e.target.value }))}
            />
            <input
              className={fieldClass}
              placeholder="Prazo (dias)"
              value={form.leadTimeDays}
              onChange={(e) => setForm((f) => ({ ...f, leadTimeDays: e.target.value }))}
            />
          </div>
        </section>

        <section className="space-y-3">
          <h4 className="text-sm font-semibold">Cobrança e amortização</h4>
          <select
            className={fieldClass}
            value={form.chargeMode}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                chargeMode: e.target.value as ProjectMoldChargeMode,
                amortizedManual: false,
              }))
            }
          >
            {MOLD_CHARGE_MODE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              className={fieldClass}
              placeholder="Quantidade para amortização"
              value={form.amortizationQuantity}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  amortizationQuantity: e.target.value,
                  amortizedManual: false,
                }))
              }
            />
            <div className="space-y-1">
              <input
                className={fieldClass}
                placeholder="Custo amortizado por unidade"
                value={form.amortizedCostPerUnit}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    amortizedCostPerUnit: e.target.value,
                    amortizedManual: true,
                  }))
                }
              />
              {form.chargeMode === "AMORTIZED_IN_PRODUCT" && suggestedAmort != null && !form.amortizedManual ? (
                <p className="text-xs text-muted-foreground">
                  Calculado: construção ÷ quantidade para amortização
                </p>
              ) : null}
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <h4 className="text-sm font-semibold">Propriedade e observações</h4>
          <select
            className={fieldClass}
            value={form.ownership}
            onChange={(e) =>
              setForm((f) => ({ ...f, ownership: e.target.value as ProjectMoldOwnership }))
            }
          >
            {MOLD_OWNERSHIP_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <textarea
            className={cnTextarea(fieldClass)}
            placeholder="Observações"
            rows={3}
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          />
        </section>
      </form>
    </ProjectModalShell>
  );
}

function cnTextarea(base: string) {
  return `${base} min-h-[80px]`;
}

// Fix submit button - it's outside form. Need to associate or use form attribute.
// ProjectModalSubmitButton is type submit but outside form - add form="project-mold-form" to button
