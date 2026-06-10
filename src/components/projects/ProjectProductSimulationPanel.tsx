import React, { useCallback, useEffect, useMemo, useState } from "react";
import { DollarSign, Info, Layers, Loader2, Settings, X } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { cn, formatCurrency } from "@/src/lib/utils";
import {
  PROJECT_SIMULATION_MODE,
  type ProjectSimulationMode,
} from "@/src/lib/projectSimulationMode";
import type { ProjectOfficialProductSnapshot } from "@/src/lib/projectsProductSnapshot";
import { ProjectSimulationBanner } from "@/src/components/projects/ProjectSimulationBanner";
import { ProjectBomSimulationTable } from "@/src/components/projects/ProjectBomSimulationTable";
import { structureLineTypeLabel } from "@/src/lib/projectsUiUtils";
import type { ProjectCostBreakdown, ProjectStructureLineRow } from "@/src/types/projects";

type TabId = "info" | "bom" | "routing" | "cost";

const TABS: { id: TabId; label: string; icon: typeof Info }[] = [
  { id: "info", label: "Produto base", icon: Info },
  { id: "bom", label: "Composição (BOM)", icon: Layers },
  { id: "routing", label: "Processos / HH", icon: Settings },
  { id: "cost", label: "Custo simulado", icon: DollarSign },
];

type Props = {
  open: boolean;
  mode?: ProjectSimulationMode;
  projectId: string;
  productId: string;
  structureLines: ProjectStructureLineRow[];
  costBreakdown: ProjectCostBreakdown;
  saving?: boolean;
  error?: string | null;
  onClose: () => void;
  /** Persiste alterações somente no projeto (nunca no cadastro oficial). */
  onSaveToProject: (payload: {
    linePatches: { id: string; quantity: number; lossPercent: number; unitCost: number }[];
  }) => Promise<void>;
  onImportSnapshot: (options: { includeBom: boolean; includeRouting: boolean }) => Promise<void>;
  onReload: () => Promise<void>;
};

export function ProjectProductSimulationPanel({
  open,
  mode = PROJECT_SIMULATION_MODE,
  projectId,
  productId,
  structureLines,
  costBreakdown,
  saving,
  error,
  onClose,
  onSaveToProject,
  onImportSnapshot,
  onReload,
}: Props) {
  const [tab, setTab] = useState<TabId>("bom");
  const [snapshot, setSnapshot] = useState<ProjectOfficialProductSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<
    Record<string, { quantity: number; lossPercent: number; unitCostSnapshot: number }>
  >({});

  const productLines = useMemo(
    () =>
      structureLines.filter(
        (l) =>
          l.existingProductId === productId ||
          l.notes?.includes(`snapshot:${productId}`) ||
          l.notes?.includes(`routing-snapshot:${productId}`)
      ),
    [structureLines, productId]
  );

  const bomLines = useMemo(
    () => productLines.filter((l) => l.unitSnapshot !== "HH" && l.lineType !== "PROCESS"),
    [productLines]
  );

  const routingLines = useMemo(
    () =>
      productLines.filter(
        (l) => l.unitSnapshot === "HH" || l.lineType === "PROCESS" || l.lineType === "SERVICE"
      ),
    [productLines]
  );

  const loadSnapshot = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchJsonOk<ProjectOfficialProductSnapshot>(
        `/api/projects/lookup/products/${productId}/snapshot`
      );
      setSnapshot(data);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Erro ao carregar produto base.");
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    if (!open) return;
    setTab("bom");
    void loadSnapshot();
    const next: typeof drafts = {};
    for (const line of productLines) {
      next[line.id] = {
        quantity: line.quantity,
        lossPercent: line.lossPercent ?? 0,
        unitCostSnapshot: line.unitCostSnapshot,
      };
    }
    setDrafts(next);
  }, [open, productId, productLines, loadSnapshot]);

  if (!open || mode !== PROJECT_SIMULATION_MODE) return null;

  const handleLineChange = (lineId: string, patch: Partial<{ quantity: number; lossPercent: number; unitCostSnapshot: number }>) => {
    setDrafts((prev) => ({
      ...prev,
      [lineId]: { ...prev[lineId], ...patch },
    }));
  };

  const handleSave = async () => {
    const linePatches = Object.keys(drafts).map((id) => {
      const d = drafts[id]!;
      return {
        id,
        quantity: d.quantity,
        lossPercent: d.lossPercent,
        unitCost: d.unitCostSnapshot,
      };
    });
    await onSaveToProject({ linePatches });
  };

  const editableBomLines = bomLines.map((l) => {
    const d = drafts[l.id];
    return {
      ...l,
      quantity: d?.quantity ?? l.quantity,
      lossPercent: d?.lossPercent ?? l.lossPercent,
      unitCostSnapshot: d?.unitCostSnapshot ?? l.unitCostSnapshot,
    };
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-border px-6 py-4">
          <div>
            <h3 className="text-lg font-semibold">Edição de simulação do projeto</h3>
            {snapshot ? (
              <p className="mt-1 text-sm text-muted-foreground">
                {snapshot.sku} — {snapshot.name}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-muted-foreground hover:bg-muted"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <ProjectSimulationBanner mode={mode} />

          {error || loadError ? (
            <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error ?? loadError}
            </div>
          ) : null}

          <div className="mb-4 flex flex-wrap gap-1 border-b border-border">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-t-lg px-3 py-2 text-sm font-medium",
                  tab === t.id
                    ? "border border-b-0 border-border bg-background text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <t.icon className="h-4 w-4" />
                {t.label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="flex items-center gap-2 py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              Carregando dados do produto base (somente leitura)...
            </div>
          ) : null}

          {tab === "info" && snapshot ? (
            <dl className="grid gap-3 sm:grid-cols-2 text-sm">
              <div>
                <dt className="text-muted-foreground">SKU</dt>
                <dd className="font-medium">{snapshot.sku}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Tipo</dt>
                <dd>{snapshot.type}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Ciclo (s)</dt>
                <dd>{snapshot.cycleTimeSeconds ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Cavidades</dt>
                <dd>{snapshot.cavities ?? "—"}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">Descrição oficial (leitura)</dt>
                <dd>{snapshot.description ?? "—"}</dd>
              </div>
              <div className="sm:col-span-2 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                Dados acima são do cadastro oficial e servem apenas como referência. Alterações
                nesta tela salvam somente no projeto #{projectId.slice(0, 8)}…
              </div>
            </dl>
          ) : null}

          {tab === "bom" ? (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={saving}
                  className="rounded-lg border border-border px-3 py-1.5 text-sm"
                  onClick={() => void onImportSnapshot({ includeBom: true, includeRouting: false })}
                >
                  Importar BOM oficial como snapshot
                </button>
                <button
                  type="button"
                  disabled={saving}
                  className="rounded-lg border border-border px-3 py-1.5 text-sm"
                  onClick={() => void onReload()}
                >
                  Atualizar lista
                </button>
              </div>
              <ProjectBomSimulationTable
                mode={mode}
                lines={editableBomLines}
                onLineChange={handleLineChange}
              />
              {snapshot && !bomLines.length ? (
                <p className="text-sm text-muted-foreground">
                  BOM oficial: {snapshot.bomRows.length} linha(s) disponível(is) para importar.
                </p>
              ) : null}
            </div>
          ) : null}

          {tab === "routing" ? (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={saving}
                  className="rounded-lg border border-border px-3 py-1.5 text-sm"
                  onClick={() => void onImportSnapshot({ includeBom: false, includeRouting: true })}
                >
                  Importar processos como linhas HH
                </button>
              </div>
              <div className="overflow-hidden rounded-xl border border-border">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/40 text-left">
                    <tr>
                      <th className="px-3 py-2">Tipo</th>
                      <th className="px-3 py-2">Descrição</th>
                      <th className="px-3 py-2">Horas</th>
                      <th className="px-3 py-2">R$/HH</th>
                      <th className="px-3 py-2">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {routingLines.map((line) => (
                      <tr key={line.id} className="border-b border-border/60">
                        <td className="px-3 py-2">{structureLineTypeLabel(line)}</td>
                        <td className="px-3 py-2">{line.descriptionSnapshot}</td>
                        <td className="px-3 py-2">{line.quantity}</td>
                        <td className="px-3 py-2">{formatCurrency(line.unitCostSnapshot)}</td>
                        <td className="px-3 py-2">{formatCurrency(line.totalCost)}</td>
                      </tr>
                    ))}
                    {!routingLines.length ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                          Nenhum processo/HH no projeto. Importe o roteiro oficial ou adicione HH
                          manualmente na aba Estrutura.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
              {snapshot ? (
                <p className="text-xs text-muted-foreground">
                  Roteiro oficial: {snapshot.routingRows.length} operação(ões) — importação cria
                  linhas MANUAL/HH no projeto.
                </p>
              ) : null}
            </div>
          ) : null}

          {tab === "cost" ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <CostCard label="Matéria-prima" value={costBreakdown.rawMaterialCost} />
              <CostCard label="Componentes" value={costBreakdown.componentCost} />
              <CostCard label="Serviços / HH" value={costBreakdown.serviceCost} />
              <CostCard label="Embalagem" value={costBreakdown.packagingCost} />
              <CostCard label="Custo unitário" value={costBreakdown.unitCost} highlight />
              <CostCard label="Preço sugerido" value={costBreakdown.suggestedPrice} />
            </div>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-6 py-4">
          <button
            type="button"
            className="rounded-lg border border-border px-4 py-2 text-sm"
            onClick={onClose}
            disabled={saving}
          >
            Fechar
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-60"
            disabled={saving || !Object.keys(drafts).length}
            onClick={() => void handleSave()}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Salvar no projeto
          </button>
        </div>
      </div>
    </div>
  );
}

function CostCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number | null | undefined;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border p-4",
        highlight && "border-primary/40 bg-primary/5"
      )}
    >
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold">
        {value != null && Number.isFinite(value) ? formatCurrency(value) : "—"}
      </p>
    </div>
  );
}
