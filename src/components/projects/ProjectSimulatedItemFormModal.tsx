import React, { useEffect, useState } from "react";
import { ProjectModalShell } from "@/src/components/projects/ProjectModalShell";
import { parseProjectsNumberInput } from "@/src/lib/projectsUiUtils";
import type { ProjectSimulatedItemRow, ProjectSimulatedItemType } from "@/src/types/projects";

export type SimulatedItemFormPayload = {
  provisionalCode: string | null;
  description: string;
  itemType: ProjectSimulatedItemType;
  unit: string;
  estimatedUnitCost: number | null;
  quotedUnitCost: number | null;
  supplierName: string | null;
  leadTimeDays: number | null;
  estimatedWeight: number | null;
  lossPercent: number | null;
  requiresQuotation: boolean;
  requiresEngineeringReview: boolean;
  canBecomeOfficial: boolean;
  notes: string | null;
};

const ITEM_TYPES: { value: ProjectSimulatedItemType; label: string }[] = [
  { value: "RAW_MATERIAL", label: "Matéria-prima" },
  { value: "COMPONENT", label: "Componente" },
  { value: "FINISHED_PRODUCT", label: "Produto acabado" },
  { value: "PACKAGING", label: "Embalagem" },
  { value: "SERVICE", label: "Serviço" },
  { value: "MOLD", label: "Molde" },
  { value: "TOOLING", label: "Ferramental" },
  { value: "OUTSOURCED_PROCESS", label: "Processo terceirizado" },
  { value: "OTHER", label: "Outro" },
];

type Props = {
  open: boolean;
  mode: "create" | "edit";
  initial?: ProjectSimulatedItemRow | null;
  saving?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (payload: SimulatedItemFormPayload) => Promise<void>;
};

const EMPTY = {
  provisionalCode: "",
  description: "",
  itemType: "RAW_MATERIAL" as ProjectSimulatedItemType,
  unit: "UN",
  estimatedUnitCost: "",
  quotedUnitCost: "",
  supplierName: "",
  leadTimeDays: "",
  estimatedWeight: "",
  lossPercent: "0",
  requiresQuotation: false,
  requiresEngineeringReview: false,
  canBecomeOfficial: true,
  notes: "",
};

export function ProjectSimulatedItemFormModal({
  open,
  mode,
  initial,
  saving,
  error,
  onClose,
  onSubmit,
}: Props) {
  const [form, setForm] = useState(EMPTY);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setForm({
        provisionalCode: initial.provisionalCode ?? "",
        description: initial.description,
        itemType: initial.itemType,
        unit: initial.unit,
        estimatedUnitCost:
          initial.estimatedUnitCost != null ? String(initial.estimatedUnitCost) : "",
        quotedUnitCost: initial.quotedUnitCost != null ? String(initial.quotedUnitCost) : "",
        supplierName: initial.supplierName ?? "",
        leadTimeDays: initial.leadTimeDays != null ? String(initial.leadTimeDays) : "",
        estimatedWeight: initial.estimatedWeight != null ? String(initial.estimatedWeight) : "",
        lossPercent: initial.lossPercent != null ? String(initial.lossPercent) : "0",
        requiresQuotation: initial.requiresQuotation,
        requiresEngineeringReview: initial.requiresEngineeringReview,
        canBecomeOfficial: initial.canBecomeOfficial,
        notes: initial.notes ?? "",
      });
    } else {
      setForm(EMPTY);
    }
  }, [open, initial]);

  if (!open) return null;

  const fieldClass = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.description.trim()) return;
    await onSubmit({
      provisionalCode: form.provisionalCode.trim() || null,
      description: form.description.trim(),
      itemType: form.itemType,
      unit: form.unit.trim() || "UN",
      estimatedUnitCost: parseProjectsNumberInput(form.estimatedUnitCost),
      quotedUnitCost: parseProjectsNumberInput(form.quotedUnitCost),
      supplierName: form.supplierName.trim() || null,
      leadTimeDays: form.leadTimeDays.trim()
        ? Math.floor(parseProjectsNumberInput(form.leadTimeDays) ?? 0)
        : null,
      estimatedWeight: parseProjectsNumberInput(form.estimatedWeight),
      lossPercent: parseProjectsNumberInput(form.lossPercent),
      requiresQuotation: form.requiresQuotation,
      requiresEngineeringReview: form.requiresEngineeringReview,
      canBecomeOfficial: form.canBecomeOfficial,
      notes: form.notes.trim() || null,
    });
  };

  return (
    <ProjectModalShell
      title={mode === "create" ? "Adicionar item simulado" : "Editar item simulado"}
      subtitle="Item permanece apenas neste projeto — não vira cadastro oficial."
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="rounded-lg border border-border px-4 py-2 text-sm" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="submit"
            form="project-sim-item-form"
            disabled={saving || !form.description.trim()}
            className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-60"
          >
            {mode === "create" ? "Adicionar" : "Salvar"}
          </button>
        </>
      }
    >
      <form id="project-sim-item-form" onSubmit={handleSubmit} className="space-y-4">
        {error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        <section className="space-y-3">
          <h4 className="text-sm font-semibold">Identificação</h4>
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              className={fieldClass}
              placeholder="Código provisório"
              value={form.provisionalCode}
              onChange={(e) => setForm((f) => ({ ...f, provisionalCode: e.target.value }))}
            />
            <select
              className={fieldClass}
              value={form.itemType}
              onChange={(e) =>
                setForm((f) => ({ ...f, itemType: e.target.value as ProjectSimulatedItemType }))
              }
            >
              {ITEM_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <input
            required
            className={fieldClass}
            placeholder="Descrição *"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
          <input
            className={fieldClass}
            placeholder="Unidade"
            value={form.unit}
            onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
          />
        </section>

        <section className="space-y-3">
          <h4 className="text-sm font-semibold">Custos e fornecedor</h4>
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              className={fieldClass}
              placeholder="Custo estimado"
              value={form.estimatedUnitCost}
              onChange={(e) => setForm((f) => ({ ...f, estimatedUnitCost: e.target.value }))}
            />
            <input
              className={fieldClass}
              placeholder="Custo cotado"
              value={form.quotedUnitCost}
              onChange={(e) => setForm((f) => ({ ...f, quotedUnitCost: e.target.value }))}
            />
            <input
              className={fieldClass}
              placeholder="Fornecedor"
              value={form.supplierName}
              onChange={(e) => setForm((f) => ({ ...f, supplierName: e.target.value }))}
            />
            <input
              className={fieldClass}
              placeholder="Prazo (dias)"
              value={form.leadTimeDays}
              onChange={(e) => setForm((f) => ({ ...f, leadTimeDays: e.target.value }))}
            />
            <input
              className={fieldClass}
              placeholder="Peso"
              value={form.estimatedWeight}
              onChange={(e) => setForm((f) => ({ ...f, estimatedWeight: e.target.value }))}
            />
            <input
              className={fieldClass}
              placeholder="Perda %"
              value={form.lossPercent}
              onChange={(e) => setForm((f) => ({ ...f, lossPercent: e.target.value }))}
            />
          </div>
        </section>

        <section className="space-y-2">
          <h4 className="text-sm font-semibold">Flags</h4>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.requiresQuotation}
              onChange={(e) => setForm((f) => ({ ...f, requiresQuotation: e.target.checked }))}
            />
            Exige cotação
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.requiresEngineeringReview}
              onChange={(e) =>
                setForm((f) => ({ ...f, requiresEngineeringReview: e.target.checked }))
              }
            />
            Exige engenharia
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.canBecomeOfficial}
              onChange={(e) => setForm((f) => ({ ...f, canBecomeOfficial: e.target.checked }))}
            />
            Pode virar cadastro oficial depois
          </label>
        </section>

        <textarea
          className={`${fieldClass} min-h-[80px]`}
          placeholder="Observações"
          rows={3}
          value={form.notes}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
        />
      </form>
    </ProjectModalShell>
  );
}
