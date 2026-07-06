import React, { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { ProjectModalShell } from "@/src/components/projects/ProjectModalShell";
import { formatProjectsNumberInput, parseProjectsNumberInput } from "@/src/lib/projectsUiUtils";
import { calculateStructureLineTotalCost } from "@/src/lib/projectsCalculations";
import type { ProjectStructureLineRow } from "@/src/types/projects";

type Props = {
  open: boolean;
  line: ProjectStructureLineRow | null;
  saving?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (body: Record<string, unknown>) => Promise<void>;
};

export function ProjectStructureLineEditModal({
  open,
  line,
  saving,
  error,
  onClose,
  onSubmit,
}: Props) {
  const [description, setDescription] = useState("");
  const [unit, setUnit] = useState("");
  const [quantity, setQuantity] = useState("");
  const [lossPercent, setLossPercent] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open || !line) return;
    setDescription(line.descriptionSnapshot);
    setUnit(line.unitSnapshot);
    setQuantity(formatProjectsNumberInput(line.quantity));
    setLossPercent(formatProjectsNumberInput(line.lossPercent ?? 0));
    setUnitCost(formatProjectsNumberInput(line.unitCostSnapshot));
    setNotes(line.notes ?? "");
  }, [open, line]);

  const previewTotal = useMemo(() => {
    const q = parseProjectsNumberInput(quantity) ?? 0;
    const u = parseProjectsNumberInput(unitCost) ?? 0;
    const loss = parseProjectsNumberInput(lossPercent) ?? 0;
    const total = calculateStructureLineTotalCost(q, u, loss);
    return Number.isFinite(total) ? total : 0;
  }, [quantity, unitCost, lossPercent]);

  if (!open || !line) return null;

  const isManual = line.sourceType === "MANUAL";
  const isExisting =
    line.sourceType === "EXISTING_PRODUCT" || line.sourceType === "EXISTING_MATERIAL";
  const fieldClass = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm";

  const handleSubmit = async () => {
    const body: Record<string, unknown> = {
      quantity: parseProjectsNumberInput(quantity) ?? 0,
      lossPercent: parseProjectsNumberInput(lossPercent) ?? 0,
      unitCost: parseProjectsNumberInput(unitCost) ?? 0,
      notes: notes.trim() || null,
    };
    if (isManual) {
      body.description = description.trim();
      body.unit = unit.trim() || "UN";
    }
    await onSubmit(body);
  };

  return (
    <ProjectModalShell
      title="Editar linha de estrutura"
      subtitle={
        isExisting
          ? "Altera apenas o snapshot deste projeto — não modifica o cadastro oficial."
          : "Edição da linha de estrutura do projeto."
      }
      onClose={onClose}
      footer={
        <>
          <button type="button" className="rounded-lg border border-border px-4 py-2 text-sm" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSubmit()}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Salvar
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
        {!isManual ? (
          <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm">
            <span className="font-medium">{line.descriptionSnapshot}</span>
            <span className="text-muted-foreground"> · {line.unitSnapshot}</span>
          </p>
        ) : (
          <>
            <input
              className={fieldClass}
              placeholder="Descrição"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <input
              className={fieldClass}
              placeholder="Unidade"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
            />
          </>
        )}

        <div className="grid grid-cols-2 gap-3">
          <input
            className={fieldClass}
            placeholder="Quantidade"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
          <input
            className={fieldClass}
            placeholder="Perda %"
            value={lossPercent}
            onChange={(e) => setLossPercent(e.target.value)}
          />
        </div>
        <input
          className={fieldClass}
          placeholder={isExisting ? "Custo unitário (snapshot do orçamento)" : "Custo unitário"}
          value={unitCost}
          onChange={(e) => setUnitCost(e.target.value)}
        />
        <textarea
          className={`${fieldClass} min-h-[72px]`}
          placeholder="Observações"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        <p className="text-sm text-muted-foreground">
          Total:{" "}
          <span className="font-medium text-foreground">
            {previewTotal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
          </span>
        </p>
      </div>
    </ProjectModalShell>
  );
}
