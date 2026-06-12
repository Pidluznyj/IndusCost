import React, { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { PROJECT_ENGINEERING_CLONE_NOTICE } from "@/src/lib/projectsEngineeringWorkspace";
import { PROJECT_GUIDED_MASTER_NOTICE } from "@/src/lib/projectsGuidedFlow";
import { ProjectModalShell } from "@/src/components/projects/ProjectModalShell";
import { parseProjectsNumberInput } from "@/src/lib/projectsUiUtils";
import type { ProjectSimulatedProductRow } from "@/src/types/projects";

export type ProjectEngineeringItemKind = "PRODUCT" | "COMPONENT" | "RAW_MATERIAL";

export type ProjectEngineeringItemFormPayload = {
  itemKind: ProjectEngineeringItemKind;
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
  onCloneOfficial?: (productId: string, provisionalCode: string | null) => Promise<void>;
};

const EMPTY = {
  itemKind: "PRODUCT" as ProjectEngineeringItemKind,
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
  onCloneOfficial,
}: Props) {
  const [form, setForm] = useState(EMPTY);
  const [cloneSearch, setCloneSearch] = useState("");
  const [cloneRows, setCloneRows] = useState<{ id: string; sku: string; name: string }[]>([]);
  const [cloneSearching, setCloneSearching] = useState(false);
  const [selectedCloneId, setSelectedCloneId] = useState("");

  useEffect(() => {
    if (!open) return;
    setCloneSearch("");
    setCloneRows([]);
    setSelectedCloneId("");
    if (initial) {
      setForm({
        itemKind: "PRODUCT",
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

  useEffect(() => {
    if (!open || form.originMode !== "CLONE") return;
    const q = cloneSearch.trim();
    if (q.length < 2) {
      setCloneRows([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      setCloneSearching(true);
      try {
        const res = await fetchJsonOk<{ rows: { id: string; sku: string; name: string }[] }>(
          `/api/projects/lookup/products?q=${encodeURIComponent(q)}`
        );
        setCloneRows(res.rows ?? []);
      } catch {
        setCloneRows([]);
      } finally {
        setCloneSearching(false);
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [open, form.originMode, cloneSearch]);

  if (!open) return null;

  const fieldClass = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm";
  const isCloneFlow = mode === "create" && form.originMode === "CLONE";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isCloneFlow) {
      if (!selectedCloneId || !onCloneOfficial) return;
      await onCloneOfficial(selectedCloneId, form.provisionalCode.trim() || null);
      return;
    }
    if (!form.description.trim()) return;
    await onSubmit({
      itemKind: form.itemKind,
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
          ? "Adicionar item de engenharia ao projeto"
          : "Editar item de engenharia do projeto"
      }
      subtitle="Crie um produto, componente ou matéria-prima para simulação dentro deste projeto."
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
            disabled={
              saving ||
              (isCloneFlow ? !selectedCloneId : !form.description.trim())
            }
            className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-60"
          >
            {saving ? <Loader2 className="inline h-4 w-4 animate-spin" /> : null}
            {isCloneFlow ? "Clonar para o projeto" : mode === "create" ? "Salvar item" : "Salvar"}
          </button>
        </>
      }
    >
      <div className="mb-4 space-y-1 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-950">
        <p>
          <span className="font-medium">Projeto:</span> {projectLabel}
        </p>
        <p>{PROJECT_GUIDED_MASTER_NOTICE}</p>
      </div>

      <form id="project-engineering-item-form" onSubmit={handleSubmit} className="space-y-3">
        {error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        {mode === "create" ? (
          <>
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
              >
                <option value="NEW">Criado do zero</option>
                <option value="CLONE">Clonado de item oficial</option>
                <option value="REFERENCE">Referência oficial</option>
              </select>
            </div>

            {form.originMode === "REFERENCE" ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                Referências oficiais entram na engenharia do item sem clonar. Após salvar o item,
                adicione materiais/componentes oficiais na estrutura do produto simulado.
              </p>
            ) : null}

            {form.originMode === "CLONE" ? (
              <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs text-amber-950">{PROJECT_ENGINEERING_CLONE_NOTICE}</p>
                <input
                  className={fieldClass}
                  placeholder="Buscar produto/componente oficial..."
                  value={cloneSearch}
                  onChange={(e) => setCloneSearch(e.target.value)}
                />
                {cloneSearching ? <p className="text-xs text-muted-foreground">Buscando...</p> : null}
                <div className="max-h-32 overflow-auto rounded border bg-background">
                  {cloneRows.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      className={`block w-full px-3 py-2 text-left text-sm hover:bg-muted ${selectedCloneId === r.id ? "bg-muted" : ""}`}
                      onClick={() => setSelectedCloneId(r.id)}
                    >
                      {r.sku} — {r.name}
                    </button>
                  ))}
                </div>
                <input
                  className={fieldClass}
                  placeholder="Código temporário (ex.: SMALTEC-301.05AA-VAR01)"
                  value={form.provisionalCode}
                  onChange={(e) => setForm((f) => ({ ...f, provisionalCode: e.target.value }))}
                />
              </div>
            ) : null}
          </>
        ) : null}

        {!isCloneFlow ? (
          <>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Tipo do item
              </label>
              <select
                className={fieldClass}
                value={form.itemKind}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    itemKind: e.target.value as ProjectEngineeringItemKind,
                  }))
                }
              >
                <option value="PRODUCT">Produto</option>
                <option value="COMPONENT">Componente</option>
                <option value="RAW_MATERIAL">Matéria-prima</option>
              </select>
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
              placeholder="Nome / descrição *"
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
          </>
        ) : null}
      </form>
    </ProjectModalShell>
  );
}
