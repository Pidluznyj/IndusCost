import React, { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { ProjectModalShell } from "@/src/components/projects/ProjectModalShell";
import {
  buildLaborLinePayload,
  calculateLaborLineTotal,
  formatProjectsNumberInput,
  parseProjectsNumberInput,
} from "@/src/lib/projectsUiUtils";
import type { ProjectStructureLineRow } from "@/src/types/projects";

type Props = {
  open: boolean;
  mode: "create" | "edit";
  initial?: ProjectStructureLineRow | null;
  saving?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (body: ReturnType<typeof buildLaborLinePayload>) => Promise<void>;
  onSubmitEdit?: (body: Record<string, unknown>) => Promise<void>;
};

const EMPTY = {
  description: "Hora-homem",
  hours: "",
  hourlyRate: "",
  lossPercent: "0",
  notes: "",
};

export function ProjectLaborLineModal({
  open,
  mode,
  initial,
  saving,
  error,
  onClose,
  onSubmit,
  onSubmitEdit,
}: Props) {
  const [form, setForm] = useState(EMPTY);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setForm({
        description: initial.descriptionSnapshot,
        hours: formatProjectsNumberInput(initial.quantity),
        hourlyRate: formatProjectsNumberInput(initial.unitCostSnapshot),
        lossPercent: formatProjectsNumberInput(initial.lossPercent ?? 0),
        notes: initial.notes ?? "",
      });
    } else {
      setForm(EMPTY);
    }
  }, [open, initial]);

  const previewTotal = useMemo(() => {
    const hours = parseProjectsNumberInput(form.hours) ?? 0;
    const rate = parseProjectsNumberInput(form.hourlyRate) ?? 0;
    const loss = parseProjectsNumberInput(form.lossPercent) ?? 0;
    return calculateLaborLineTotal(hours, rate, loss);
  }, [form.hours, form.hourlyRate, form.lossPercent]);

  if (!open) return null;

  const fieldClass = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm";

  const handleSubmit = async () => {
    if (mode === "edit" && initial && onSubmitEdit) {
      const quantity = parseProjectsNumberInput(form.hours) ?? 0;
      const unitCost = parseProjectsNumberInput(form.hourlyRate) ?? 0;
      const lossPercent = parseProjectsNumberInput(form.lossPercent) ?? 0;
      await onSubmitEdit({
        description: form.description.trim() || "Hora-homem",
        unit: "HH",
        lineType: "PROCESS",
        quantity,
        unitCost,
        lossPercent,
        notes: form.notes.trim() || null,
      });
      return;
    }
    await onSubmit(buildLaborLinePayload(form));
  };

  const canSubmit =
    Boolean(form.description.trim()) &&
    (parseProjectsNumberInput(form.hours) ?? 0) > 0 &&
    (parseProjectsNumberInput(form.hourlyRate) ?? 0) >= 0;

  return (
    <ProjectModalShell
      title={mode === "create" ? "Adicionar HH / Mão de obra" : "Editar HH / Mão de obra"}
      subtitle="Custo de hora-homem entra no custo de serviços do projeto."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="rounded-lg border border-border px-4 py-2 text-sm" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            disabled={saving || !canSubmit}
            onClick={() => void handleSubmit()}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {mode === "create" ? "Adicionar" : "Salvar"}
          </button>
        </>
      }
    >
      {error ? (
        <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}
      <div className="space-y-3">
        <input
          className={fieldClass}
          placeholder="Descrição"
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
        />
        <div className="grid grid-cols-2 gap-3">
          <input
            className={fieldClass}
            placeholder="Quantidade de horas *"
            value={form.hours}
            onChange={(e) => setForm((f) => ({ ...f, hours: e.target.value }))}
          />
          <input
            className={fieldClass}
            placeholder="Valor da hora *"
            value={form.hourlyRate}
            onChange={(e) => setForm((f) => ({ ...f, hourlyRate: e.target.value }))}
          />
        </div>
        <input
          className={fieldClass}
          placeholder="Perda ou acréscimo %"
          value={form.lossPercent}
          onChange={(e) => setForm((f) => ({ ...f, lossPercent: e.target.value }))}
        />
        <textarea
          className={`${fieldClass} min-h-[72px]`}
          placeholder="Observações"
          rows={2}
          value={form.notes}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
        />
        <p className="text-sm text-muted-foreground">
          Custo total calculado:{" "}
          <span className="font-medium text-foreground">
            {Number.isFinite(previewTotal)
              ? previewTotal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
              : "—"}
          </span>
        </p>
      </div>
    </ProjectModalShell>
  );
}
