import React, { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { ProjectModalShell } from "@/src/components/projects/ProjectModalShell";
import {
  computeMoldLineTotal,
  createEmptyMoldLine,
  parseMoldNotes,
  serializeMoldNotes,
  sumMoldCostLines,
  type ProjectMoldCostLine,
  type ProjectMoldCostLineType,
} from "@/src/lib/projectsMoldCostLines";
import { PROJECT_GUIDED_MASTER_NOTICE } from "@/src/lib/projectsGuidedFlow";
import { parseProjectsNumberInput } from "@/src/lib/projectsUiUtils";
import type { ProjectMoldRow } from "@/src/types/projects";

const LINE_TYPES: { value: ProjectMoldCostLineType; label: string }[] = [
  { value: "MATERIAL", label: "Material" },
  { value: "SERVICE", label: "Serviço" },
  { value: "THIRD_PARTY", label: "Terceiro" },
  { value: "MACHINING", label: "Usinagem" },
  { value: "EDM", label: "Eletroerosão" },
  { value: "WELDING", label: "Solda" },
  { value: "TREATMENT", label: "Tratamento" },
  { value: "OTHER", label: "Outro" },
];

const MOLD_TYPES = ["Novo", "Alteração", "Manutenção", "Postiço", "Outro"];

export type GuidedMoldFormPayload = {
  name: string;
  moldType: string | null;
  cavities: number | null;
  notes: string | null;
  constructionCost: number;
  costLines: ProjectMoldCostLine[];
};

type Props = {
  open: boolean;
  mode: "create" | "edit";
  projectLabel: string;
  initial?: ProjectMoldRow | null;
  saving?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (payload: GuidedMoldFormPayload) => Promise<void>;
};

function formatMoney(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function ProjectGuidedMoldModal({
  open,
  mode,
  projectLabel,
  initial,
  saving,
  error,
  onClose,
  onSubmit,
}: Props) {
  const [name, setName] = useState("");
  const [moldType, setMoldType] = useState("Novo");
  const [cavities, setCavities] = useState("");
  const [userNotes, setUserNotes] = useState("");
  const [lines, setLines] = useState<ProjectMoldCostLine[]>([createEmptyMoldLine()]);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      const parsed = parseMoldNotes(initial.notes);
      setName(initial.name);
      setMoldType(initial.moldType ?? "Novo");
      setCavities(initial.cavities != null ? String(initial.cavities) : "");
      setUserNotes(parsed.userNotes ?? "");
      setLines(parsed.lines.length > 0 ? parsed.lines : [createEmptyMoldLine()]);
    } else {
      setName("");
      setMoldType("Novo");
      setCavities("");
      setUserNotes("");
      setLines([createEmptyMoldLine()]);
    }
  }, [open, initial]);

  const totalCost = useMemo(() => sumMoldCostLines(lines), [lines]);

  if (!open) return null;

  const fieldClass =
    "w-full min-w-0 rounded-lg border border-border bg-background px-3 py-2 text-sm";
  const compactFieldClass = `${fieldClass} tabular-nums`;

  const updateLine = (id: string, patch: Partial<ProjectMoldCostLine>) => {
    setLines((prev) =>
      prev.map((line) => {
        if (line.id !== id) return line;
        const next = { ...line, ...patch };
        const qty = next.quantity;
        const unit = next.unitCost;
        next.totalCost = computeMoldLineTotal(qty, unit);
        return next;
      })
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    await onSubmit({
      name: name.trim(),
      moldType: moldType || null,
      cavities: parseProjectsNumberInput(cavities),
      notes: serializeMoldNotes(lines, userNotes),
      constructionCost: totalCost,
      costLines: lines,
    });
  };

  return (
    <ProjectModalShell
      testId="projects-mold-modal"
      size="xl"
      title={mode === "create" ? "Criar molde do projeto" : "Editar molde do projeto"}
      subtitle="Liste materiais, serviços e custos necessários para construção ou alteração do molde."
      onClose={onClose}
      footer={
        <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p
            data-testid="projects-mold-total-footer"
            className="text-base font-semibold text-foreground"
          >
            Custo total do molde:{" "}
            <span className="text-primary tabular-nums">{formatMoney(totalCost)}</span>
          </p>
          <div className="flex shrink-0 justify-end gap-2">
            <button type="button" className="rounded-lg border px-4 py-2 text-sm" onClick={onClose}>
              Cancelar
            </button>
            <button
              type="submit"
              form="guided-mold-form"
              data-testid="projects-mold-save"
              disabled={saving || !name.trim()}
              className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-60"
            >
              {saving ? <Loader2 className="inline h-4 w-4 animate-spin" /> : null}
              Salvar molde
            </button>
          </div>
        </div>
      }
    >
      <div className="mb-4 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-950">
        <p>
          <span className="font-medium">Projeto:</span> {projectLabel}
        </p>
        <p className="mt-1">{PROJECT_GUIDED_MASTER_NOTICE}</p>
      </div>

      <form id="guided-mold-form" onSubmit={handleSubmit} className="space-y-5">
        {error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <input
            required
            className={fieldClass}
            placeholder="Nome do molde *"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <select className={fieldClass} value={moldType} onChange={(e) => setMoldType(e.target.value)}>
            {MOLD_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <input
            className={fieldClass}
            placeholder="Quantidade de cavidades"
            value={cavities}
            onChange={(e) => setCavities(e.target.value)}
          />
        </div>
        <textarea
          className={`${fieldClass} min-h-[72px]`}
          placeholder="Observações gerais"
          value={userNotes}
          onChange={(e) => setUserNotes(e.target.value)}
        />

        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h5 className="text-sm font-semibold">Linhas de custo do molde</h5>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted/50"
              onClick={() => setLines((prev) => [...prev, createEmptyMoldLine()])}
            >
              <Plus className="h-4 w-4" />
              Adicionar linha
            </button>
          </div>

          <div
            data-testid="projects-mold-cost-grid"
            className="overflow-x-auto rounded-xl border border-border bg-muted/10"
          >
            <table className="min-w-[1100px] w-full table-fixed text-sm">
              <colgroup>
                <col style={{ width: "28%" }} />
                <col style={{ width: "13%" }} />
                <col style={{ width: "18%" }} />
                <col style={{ width: "8%" }} />
                <col style={{ width: "7%" }} />
                <col style={{ width: "12%" }} />
                <col style={{ width: "10%" }} />
                <col style={{ width: "4%" }} />
              </colgroup>
              <thead className="border-b border-border bg-muted/40 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2.5">Descrição</th>
                  <th className="px-3 py-2.5">Tipo</th>
                  <th className="px-3 py-2.5">Fornecedor</th>
                  <th className="px-3 py-2.5">Qtd</th>
                  <th className="px-3 py-2.5">Un.</th>
                  <th className="px-3 py-2.5">Valor un.</th>
                  <th className="px-3 py-2.5">Total</th>
                  <th className="px-3 py-2.5 text-center">Ações</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.id} className="border-b border-border/60 align-top">
                    <td className="px-2 py-2">
                      <input
                        className={fieldClass}
                        placeholder="Descrição do item"
                        value={line.description}
                        onChange={(e) => updateLine(line.id, { description: e.target.value })}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <select
                        className={fieldClass}
                        value={line.lineType}
                        onChange={(e) =>
                          updateLine(line.id, { lineType: e.target.value as ProjectMoldCostLineType })
                        }
                      >
                        {LINE_TYPES.map((t) => (
                          <option key={t.value} value={t.value}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-2">
                      <input
                        className={fieldClass}
                        placeholder="Fornecedor"
                        value={line.supplierName ?? ""}
                        onChange={(e) =>
                          updateLine(line.id, { supplierName: e.target.value || null })
                        }
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        className={compactFieldClass}
                        inputMode="decimal"
                        value={String(line.quantity)}
                        onChange={(e) =>
                          updateLine(line.id, {
                            quantity: parseProjectsNumberInput(e.target.value) ?? 0,
                          })
                        }
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        className={compactFieldClass}
                        value={line.unit}
                        onChange={(e) => updateLine(line.id, { unit: e.target.value })}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        className={compactFieldClass}
                        inputMode="decimal"
                        value={String(line.unitCost)}
                        onChange={(e) =>
                          updateLine(line.id, {
                            unitCost: parseProjectsNumberInput(e.target.value) ?? 0,
                          })
                        }
                      />
                    </td>
                    <td className="px-2 py-2 pt-3 font-semibold tabular-nums text-foreground">
                      {formatMoney(line.totalCost)}
                    </td>
                    <td className="px-2 py-2 text-center">
                      <button
                        type="button"
                        title="Remover linha"
                        aria-label="Remover linha"
                        className="inline-flex rounded-lg border border-destructive/30 p-2 text-destructive hover:bg-destructive/10"
                        onClick={() =>
                          setLines((prev) =>
                            prev.length <= 1 ? prev : prev.filter((l) => l.id !== line.id)
                          )
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </form>
    </ProjectModalShell>
  );
}
