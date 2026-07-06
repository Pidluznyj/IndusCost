import React, { useEffect, useState } from "react";
import { ProjectModalShell } from "@/src/components/projects/ProjectModalShell";
import { parseProjectsNumberInput } from "@/src/lib/projectsUiUtils";
import type { ProjectSimulatedProductRow } from "@/src/types/projects";

export type SimulatedProductFormPayload = {
  provisionalCode: string | null;
  description: string;
  unit: string;
  estimatedWeight: number | null;
  expectedVolume: number | null;
  batchSize: number | null;
  notes: string | null;
};

type Props = {
  open: boolean;
  mode: "create" | "edit";
  initial?: ProjectSimulatedProductRow | null;
  saving?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (payload: SimulatedProductFormPayload) => Promise<void>;
};

const EMPTY = {
  provisionalCode: "",
  description: "",
  unit: "UN",
  estimatedWeight: "",
  expectedVolume: "",
  batchSize: "",
  notes: "",
};

export function ProjectSimulatedProductFormModal({
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
        unit: initial.unit,
        estimatedWeight: initial.estimatedWeight != null ? String(initial.estimatedWeight) : "",
        expectedVolume: initial.expectedVolume != null ? String(initial.expectedVolume) : "",
        batchSize: initial.batchSize != null ? String(initial.batchSize) : "",
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
      unit: form.unit.trim() || "UN",
      estimatedWeight: parseProjectsNumberInput(form.estimatedWeight),
      expectedVolume: parseProjectsNumberInput(form.expectedVolume),
      batchSize: parseProjectsNumberInput(form.batchSize),
      notes: form.notes.trim() || null,
    });
  };

  return (
    <ProjectModalShell
      title={mode === "create" ? "Adicionar produto simulado" : "Editar produto simulado"}
      subtitle="Produto permanece apenas neste projeto — não vira cadastro oficial."
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="rounded-lg border border-border px-4 py-2 text-sm" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="submit"
            form="project-sim-product-form"
            disabled={saving || !form.description.trim()}
            className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-60"
          >
            {mode === "create" ? "Adicionar" : "Salvar"}
          </button>
        </>
      }
    >
      <form id="project-sim-product-form" onSubmit={handleSubmit} className="space-y-3">
        {error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <input
            className={fieldClass}
            placeholder="Código provisório"
            value={form.provisionalCode}
            onChange={(e) => setForm((f) => ({ ...f, provisionalCode: e.target.value }))}
          />
          <input
            className={fieldClass}
            placeholder="Unidade"
            value={form.unit}
            onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
          />
        </div>
        <input
          required
          className={fieldClass}
          placeholder="Descrição *"
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <input
            className={fieldClass}
            placeholder="Peso estimado"
            value={form.estimatedWeight}
            onChange={(e) => setForm((f) => ({ ...f, estimatedWeight: e.target.value }))}
          />
          <input
            className={fieldClass}
            placeholder="Volume esperado"
            value={form.expectedVolume}
            onChange={(e) => setForm((f) => ({ ...f, expectedVolume: e.target.value }))}
          />
          <input
            className={fieldClass}
            placeholder="Lote"
            value={form.batchSize}
            onChange={(e) => setForm((f) => ({ ...f, batchSize: e.target.value }))}
          />
        </div>
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
