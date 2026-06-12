import React, { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { ProjectModalShell } from "@/src/components/projects/ProjectModalShell";
import { PROJECT_GUIDED_MASTER_NOTICE } from "@/src/lib/projectsGuidedFlow";
import {
  computeOtherCostLineTotal,
  createEmptyOtherCostLine,
  OTHER_COST_GROUP_LABEL,
  type ProjectOtherCostGroupKey,
  type ProjectOtherCostLine,
} from "@/src/lib/projectsOtherCostGroups";
import { parseProjectsNumberInput } from "@/src/lib/projectsUiUtils";

export type GuidedOtherCostPayload = {
  lines: ProjectOtherCostLine[];
};

type Props = {
  open: boolean;
  projectLabel: string;
  saving?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (payload: GuidedOtherCostPayload) => Promise<void>;
};

export function ProjectOtherCostsModal({
  open,
  projectLabel,
  saving,
  error,
  onClose,
  onSubmit,
}: Props) {
  const [lines, setLines] = useState<ProjectOtherCostLine[]>([createEmptyOtherCostLine()]);

  useEffect(() => {
    if (!open) return;
    setLines([createEmptyOtherCostLine()]);
  }, [open]);

  const totalCost = useMemo(
    () => lines.reduce((acc, l) => acc + l.totalCost, 0),
    [lines]
  );

  if (!open) return null;

  const fieldClass = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm";

  const updateLine = (id: string, patch: Partial<ProjectOtherCostLine>) => {
    setLines((prev) =>
      prev.map((line) => {
        if (line.id !== id) return line;
        const next = { ...line, ...patch };
        next.totalCost = computeOtherCostLineTotal(next.quantity, next.unitCost);
        return next;
      })
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const valid = lines.filter((l) => l.description.trim());
    if (valid.length === 0) return;
    await onSubmit({ lines: valid });
  };

  return (
    <ProjectModalShell
      title="Adicionar outros custos do projeto"
      subtitle="Inclua custos adicionais que não fazem parte diretamente da engenharia ou do molde."
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="rounded-lg border px-4 py-2 text-sm" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="submit"
            form="other-costs-form"
            disabled={saving || !lines.some((l) => l.description.trim())}
            className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-60"
          >
            {saving ? <Loader2 className="inline h-4 w-4 animate-spin" /> : null}
            Salvar custos
          </button>
        </>
      }
    >
      <div className="mb-4 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-950">
        <p>
          <span className="font-medium">Projeto:</span> {projectLabel}
        </p>
        <p className="mt-1">{PROJECT_GUIDED_MASTER_NOTICE}</p>
      </div>

      <form id="other-costs-form" onSubmit={handleSubmit} className="space-y-4">
        {error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        <div className="flex justify-end">
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs"
            onClick={() => setLines((prev) => [...prev, createEmptyOtherCostLine()])}
          >
            <Plus className="h-3.5 w-3.5" />
            Adicionar linha
          </button>
        </div>

        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="min-w-[680px] w-full text-xs">
            <thead className="border-b bg-muted/40 text-left">
              <tr>
                <th className="px-2 py-2">Grupo</th>
                <th className="px-2 py-2">Descrição</th>
                <th className="px-2 py-2">Fornecedor</th>
                <th className="px-2 py-2">Qtd</th>
                <th className="px-2 py-2">Un.</th>
                <th className="px-2 py-2">Valor un.</th>
                <th className="px-2 py-2">Total</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id} className="border-b border-border/60">
                  <td className="px-2 py-1">
                    <select
                      className={fieldClass}
                      value={line.group}
                      onChange={(e) =>
                        updateLine(line.id, { group: e.target.value as ProjectOtherCostGroupKey })
                      }
                    >
                      {(Object.keys(OTHER_COST_GROUP_LABEL) as ProjectOtherCostGroupKey[]).map(
                        (key) => (
                          <option key={key} value={key}>
                            {OTHER_COST_GROUP_LABEL[key]}
                          </option>
                        )
                      )}
                    </select>
                  </td>
                  <td className="px-2 py-1">
                    <input
                      className={fieldClass}
                      value={line.description}
                      onChange={(e) => updateLine(line.id, { description: e.target.value })}
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      className={fieldClass}
                      value={line.supplierName ?? ""}
                      onChange={(e) =>
                        updateLine(line.id, { supplierName: e.target.value || null })
                      }
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      className={`${fieldClass} w-16`}
                      value={String(line.quantity)}
                      onChange={(e) =>
                        updateLine(line.id, {
                          quantity: parseProjectsNumberInput(e.target.value) ?? 0,
                        })
                      }
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      className={`${fieldClass} w-14`}
                      value={line.unit}
                      onChange={(e) => updateLine(line.id, { unit: e.target.value })}
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      className={`${fieldClass} w-24`}
                      value={String(line.unitCost)}
                      onChange={(e) =>
                        updateLine(line.id, {
                          unitCost: parseProjectsNumberInput(e.target.value) ?? 0,
                        })
                      }
                    />
                  </td>
                  <td className="px-2 py-1 font-medium">
                    {line.totalCost.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                  </td>
                  <td className="px-2 py-1">
                    <button
                      type="button"
                      className="rounded border p-1 text-destructive"
                      onClick={() =>
                        setLines((prev) =>
                          prev.length <= 1 ? prev : prev.filter((l) => l.id !== line.id)
                        )
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-sm font-semibold">
          Total: {totalCost.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
        </p>
      </form>
    </ProjectModalShell>
  );
}
