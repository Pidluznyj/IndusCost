import React, { useEffect, useState } from "react";
import { ProjectModalShell } from "@/src/components/projects/ProjectModalShell";
import {
  PROJECT_ENGINEERING_MASTER_DATA_NOTICE,
} from "@/src/lib/projectsEngineeringWorkspace";
import { parseProjectsNumberInput } from "@/src/lib/projectsUiUtils";
import type { ProjectSimulatedProductRow } from "@/src/types/projects";

export type ProjectEngineeringItemFormPayload = {
  provisionalCode: string | null;
  description: string;
  unit: string;
  estimatedWeight: number | null;
  expectedVolume: number | null;
  batchSize: number | null;
  notes: string | null;
  originMode: "NEW" | "CLONE" | "REFERENCE";
};

type Props = {
  open: boolean;
  mode: "create" | "edit";
  projectLabel: string;
  initial?: ProjectSimulatedProductRow | null;
  saving?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (payload: ProjectEngineeringItemFormPayload) => Promise<void>;
};

const EMPTY = {
  provisionalCode: "",
  description: "",
  unit: "UN",
  estimatedWeight: "",
  expectedVolume: "",
  batchSize: "",
  notes: "",
  originMode: "NEW" as const,
};

export function ProjectEngineeringItemModal({
  open,
  mode,
  projectLabel,
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
        originMode: "NEW",
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
      originMode: form.originMode,
    });
  };

  return (
    <ProjectModalShell
      title={
        mode === "create"
          ? "Novo Item de Engenharia do Projeto"
          : "Editar Item de Engenharia do Projeto"
      }
      subtitle="Crie uma estrutura produtiva simulada apenas dentro deste projeto."
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="rounded-lg border border-border px-4 py-2 text-sm" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="submit"
            form="project-engineering-item-form"
            disabled={saving || !form.description.trim()}
            className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-60"
          >
            {mode === "create" ? "Criar item local" : "Salvar"}
          </button>
        </>
      }
    >
      <div className="mb-4 space-y-1 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-950">
        <p>
          <span className="font-medium">Projeto:</span> {projectLabel}
        </p>
        <p>
          <span className="font-medium">Escopo:</span> Item local do projeto
        </p>
        <p>{PROJECT_ENGINEERING_MASTER_DATA_NOTICE}</p>
      </div>

      <p className="mb-3 text-xs text-muted-foreground">
        Este item pertence somente ao projeto e não altera o cadastro mestre.
      </p>

      <form id="project-engineering-item-form" onSubmit={handleSubmit} className="space-y-3">
        {error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Origem</label>
          <select
            className={fieldClass}
            value={form.originMode}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                originMode: e.target.value as "NEW" | "CLONE" | "REFERENCE",
              }))
            }
            disabled={mode === "edit"}
          >
            <option value="NEW">Criado do zero</option>
            <option value="CLONE">Clonado de item oficial</option>
            <option value="REFERENCE">Referência oficial</option>
          </select>
          {form.originMode !== "NEW" && mode === "create" ? (
            <p className="mt-1 text-xs text-amber-800">
              Para clonar ou referenciar itens oficiais, use os botões &quot;Clonar item existente&quot; ou
              &quot;Adicionar item oficial&quot; na aba Engenharia do Projeto.
            </p>
          ) : null}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <input
            className={fieldClass}
            placeholder="Ex.: SMALTEC-COMP-001"
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
          placeholder="Descrição / nome do item *"
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
            placeholder="Lote padrão"
            value={form.batchSize}
            onChange={(e) => setForm((f) => ({ ...f, batchSize: e.target.value }))}
          />
        </div>
        <textarea
          className={`${fieldClass} min-h-[80px]`}
          placeholder="Observações"
          value={form.notes}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
        />
      </form>
    </ProjectModalShell>
  );
}
