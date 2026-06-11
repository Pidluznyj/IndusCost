import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, DollarSign, Info, Layers, Loader2, Settings, X } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { cn, formatCurrency } from "@/src/lib/utils";
import {
  PROJECT_SIMULATION_MODE,
  type ProjectSimulationMode,
} from "@/src/lib/projectSimulationMode";
import type { ProjectEngineeringSnapshot } from "@/src/lib/projectsProductEngineeringSnapshot";
import type { ProjectOfficialProductSnapshot } from "@/src/lib/projectsProductSnapshot";
import { buildProjectEngineeringTree } from "@/src/lib/projectsEngineeringTree";
import { ProjectEngineeringTreePanel } from "@/src/components/projects/ProjectEngineeringTreePanel";
import { ProjectSimulationBanner } from "@/src/components/projects/ProjectSimulationBanner";
import { ProjectBomSimulationTable } from "@/src/components/projects/ProjectBomSimulationTable";
import { structureLineTypeLabel } from "@/src/lib/projectsUiUtils";
import type { ProjectCostBreakdown, ProjectStructureLineRow } from "@/src/types/projects";

type TabId = "info" | "bom" | "tree" | "routing" | "cost";

const TABS: { id: TabId; label: string; icon: typeof Info }[] = [
  { id: "info", label: "Informações", icon: Info },
  { id: "tree", label: "Estrutura em Árvore", icon: ChevronRight },
  { id: "bom", label: "Composição (BOM)", icon: Layers },
  { id: "routing", label: "Processos / HH", icon: Settings },
  { id: "cost", label: "Análise de Custo", icon: DollarSign },
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
  const [tab, setTab] = useState<TabId>("tree");
  const [snapshot, setSnapshot] = useState<ProjectOfficialProductSnapshot | null>(null);
  const [engineering, setEngineering] = useState<ProjectEngineeringSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedTreeLineId, setSelectedTreeLineId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<
    Record<string, { quantity: number; lossPercent: number; unitCostSnapshot: number }>
  >({});

  const productLines = useMemo(
    () =>
      structureLines.filter(
        (l) =>
          l.snapshotRootProductId === productId ||
          l.notes?.includes(`snapshot:${productId}`) ||
          l.notes?.includes(`routing-snapshot:${productId}`)
      ),
    [structureLines, productId]
  );

  const engineeringTree = useMemo(() => {
    if (!snapshot) return null;
    return buildProjectEngineeringTree(
      { productId, sku: snapshot.sku, name: snapshot.name },
      productLines
    );
  }, [productId, snapshot, productLines]);

  const simulatedIndustrialCost = useMemo(() => {
    let total = 0;
    for (const line of productLines) {
      if (!line.countsInSimulatedProductCost) continue;
      total += line.totalCost;
    }
    return total;
  }, [productLines]);

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
      const [data, eng] = await Promise.all([
        fetchJsonOk<ProjectOfficialProductSnapshot>(
          `/api/projects/lookup/products/${productId}/snapshot`
        ),
        fetchJsonOk<ProjectEngineeringSnapshot>(
          `/api/projects/lookup/products/${productId}/engineering-snapshot`
        ),
      ]);
      setSnapshot(data);
      setEngineering(eng);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Erro ao carregar produto base.");
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    if (!open) return;
    setTab("tree");
    setSelectedTreeLineId(null);
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

          {tab === "tree" && engineeringTree ? (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={saving}
                  className="rounded-lg border border-primary/40 bg-primary/5 px-3 py-1.5 text-sm font-medium"
                  onClick={() =>
                    void onImportSnapshot({ includeBom: true, includeRouting: true })
                  }
                >
                  Importar engenharia completa (árvore + custos)
                </button>
              </div>
              {engineering?.alerts.length ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                  {engineering.alerts.join(" · ")}
                </div>
              ) : null}
              <ProjectEngineeringTreePanel
                tree={engineeringTree}
                loading={loading}
                selectedLineId={selectedTreeLineId}
                onSelectLine={(line) => setSelectedTreeLineId(line?.id ?? null)}
              />
            </div>
          ) : null}

          {tab === "bom" ? (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={saving}
                  className="rounded-lg border border-border px-3 py-1.5 text-sm"
                  onClick={() => void onImportSnapshot({ includeBom: true, includeRouting: true })}
                >
                  Importar engenharia completa como snapshot
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
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <CostCard
                  label="Custo industrial oficial (importado)"
                  value={engineering?.officialIndustrialCost ?? null}
                />
                <CostCard
                  label="Custo industrial simulado (1º nível)"
                  value={simulatedIndustrialCost}
                  highlight
                />
                <CostCard
                  label="Diferença"
                  value={
                    engineering?.officialIndustrialCost != null
                      ? simulatedIndustrialCost - engineering.officialIndustrialCost
                      : null
                  }
                />
                <CostCard label="Matéria-prima (projeto)" value={costBreakdown.rawMaterialCost} />
                <CostCard label="Componentes (projeto)" value={costBreakdown.componentCost} />
                <CostCard label="Serviços / HH (projeto)" value={costBreakdown.serviceCost} />
                <CostCard label="Custo unitário total" value={costBreakdown.unitCost} />
                <CostCard label="Preço sugerido" value={costBreakdown.suggestedPrice} />
              </div>
              <p className="text-xs text-muted-foreground">
                O custo simulado do produto soma apenas linhas de 1º nível marcadas para rollup
                (componentes diretos + processos do pai). Materiais internos aparecem na árvore para
                referência e edição, sem duplicar o total.
              </p>
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
