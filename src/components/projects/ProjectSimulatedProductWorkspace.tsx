import React, { useEffect, useMemo, useState } from "react";
import {
  ChevronRight,
  DollarSign,
  Info,
  Layers,
  Loader2,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { cn, formatCurrency } from "@/src/lib/utils";
import {
  isGuidedComponentProduct,
  PROJECT_GUIDED_MASTER_NOTICE,
  sumSimulatedProductStructureCost,
} from "@/src/lib/projectsGuidedFlow";
import { buildProjectEngineeringTree } from "@/src/lib/projectsEngineeringTree";
import { ProjectEngineeringTreePanel } from "@/src/components/projects/ProjectEngineeringTreePanel";
import { structureLineTypeLabel } from "@/src/lib/projectsUiUtils";
import type {
  ProjectSimulatedItemRow,
  ProjectSimulatedProductRow,
  ProjectStructureLineRow,
  ProjectStructureSourceType,
} from "@/src/types/projects";

type TabId = "info" | "bom" | "tree" | "cost";

const TABS: { id: TabId; label: string; icon: typeof Info }[] = [
  { id: "info", label: "Informações", icon: Info },
  { id: "tree", label: "Estrutura em Árvore", icon: ChevronRight },
  { id: "bom", label: "Composição (BOM)", icon: Layers },
  { id: "cost", label: "Custo", icon: DollarSign },
];

type Props = {
  open: boolean;
  projectId: string;
  product: ProjectSimulatedProductRow;
  structureLines: ProjectStructureLineRow[];
  simulatedItems: ProjectSimulatedItemRow[];
  simulatedProducts: ProjectSimulatedProductRow[];
  saving?: boolean;
  error?: string | null;
  canManage?: boolean;
  onClose: () => void;
  onReload: () => Promise<void>;
  onPatchProduct: (body: Record<string, unknown>) => Promise<void>;
  onAddLine: (
    sourceType: ProjectStructureSourceType,
    context?: { parentLineId?: string }
  ) => void;
  onCreateChildComponent: () => void;
  onEditLine: (line: ProjectStructureLineRow) => void;
  onDeleteLine: (line: ProjectStructureLineRow) => void;
};

export function ProjectSimulatedProductWorkspace({
  open,
  projectId,
  product,
  structureLines,
  simulatedItems,
  simulatedProducts,
  saving,
  error,
  canManage = true,
  onClose,
  onReload,
  onPatchProduct,
  onAddLine,
  onCreateChildComponent,
  onEditLine,
  onDeleteLine,
}: Props) {
  const [tab, setTab] = useState<TabId>("tree");
  const [selectedTreeLineId, setSelectedTreeLineId] = useState<string | null>(null);
  const [infoDraft, setInfoDraft] = useState({
    provisionalCode: "",
    description: "",
    unit: "UN",
    notes: "",
  });
  const [infoSaving, setInfoSaving] = useState(false);
  const [infoError, setInfoError] = useState<string | null>(null);

  const productLines = useMemo(
    () =>
      structureLines.filter(
        (l) => l.simulatedProductId === product.id && l.snapshotRootProductId == null
      ),
    [structureLines, product.id]
  );

  const engineeringTree = useMemo(
    () =>
      buildProjectEngineeringTree(
        {
          productId: product.id,
          sku: product.provisionalCode?.trim() || "PRJ",
          name: product.description,
        },
        productLines,
        { kind: "simulated_product", simulatedProductId: product.id }
      ),
    [product, productLines]
  );

  const bomLines = useMemo(
    () => productLines.filter((l) => l.parentLineId == null),
    [productLines]
  );

  const totalCost = useMemo(
    () => sumSimulatedProductStructureCost(structureLines, product.id),
    [structureLines, product.id]
  );

  const missingCostCount = useMemo(
    () => productLines.filter((l) => l.isMissingCost).length,
    [productLines]
  );

  const isComponent = isGuidedComponentProduct(product.notes);

  useEffect(() => {
    if (!open) return;
    setTab("tree");
    setSelectedTreeLineId(null);
    setInfoError(null);
    setInfoDraft({
      provisionalCode: product.provisionalCode ?? "",
      description: product.description,
      unit: product.unit,
      notes: product.notes ?? "",
    });
  }, [open, product]);

  if (!open) return null;

  const handleSaveInfo = async () => {
    setInfoSaving(true);
    setInfoError(null);
    try {
      await onPatchProduct({
        provisionalCode: infoDraft.provisionalCode.trim() || null,
        description: infoDraft.description.trim(),
        unit: infoDraft.unit.trim() || "UN",
        notes: infoDraft.notes.trim() || null,
      });
    } catch (e) {
      setInfoError(e instanceof Error ? e.message : "Erro ao salvar informações.");
    } finally {
      setInfoSaving(false);
    }
  };

  const addButtons: { label: string; source: ProjectStructureSourceType; action?: () => void }[] = [
    { label: "Matéria-prima oficial", source: "EXISTING_MATERIAL" },
    { label: "Componente oficial", source: "EXISTING_PRODUCT" },
    { label: "Item do projeto", source: "SIMULATED_ITEM" },
    { label: "Item manual / orçado", source: "MANUAL" },
    { label: "Novo componente do projeto", source: "MANUAL", action: onCreateChildComponent },
  ];

  const fieldClass = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-border px-6 py-4">
          <div>
            <h3 className="text-lg font-semibold">
              {isComponent ? "Componente do projeto" : "Produto do projeto"}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {product.provisionalCode ? `${product.provisionalCode} — ` : ""}
              {product.description}
            </p>
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
          <p className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-950">
            {PROJECT_GUIDED_MASTER_NOTICE}
          </p>

          {error ? (
            <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
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

          {tab === "info" ? (
            <div className="space-y-4">
              {infoError ? (
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {infoError}
                </div>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Referência</label>
                  <input
                    className={fieldClass}
                    value={infoDraft.provisionalCode}
                    onChange={(e) =>
                      setInfoDraft((d) => ({ ...d, provisionalCode: e.target.value }))
                    }
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Unidade</label>
                  <input
                    className={fieldClass}
                    value={infoDraft.unit}
                    onChange={(e) => setInfoDraft((d) => ({ ...d, unit: e.target.value }))}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs text-muted-foreground">Descrição</label>
                  <input
                    className={fieldClass}
                    value={infoDraft.description}
                    onChange={(e) =>
                      setInfoDraft((d) => ({ ...d, description: e.target.value }))
                    }
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs text-muted-foreground">Observações</label>
                  <textarea
                    className={fieldClass}
                    rows={3}
                    value={infoDraft.notes}
                    onChange={(e) => setInfoDraft((d) => ({ ...d, notes: e.target.value }))}
                  />
                </div>
              </div>
              {canManage ? (
                <button
                  type="button"
                  disabled={infoSaving || saving || !infoDraft.description.trim()}
                  onClick={() => void handleSaveInfo()}
                  className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-60"
                >
                  {infoSaving ? <Loader2 className="inline h-4 w-4 animate-spin" /> : null}
                  Salvar informações
                </button>
              ) : null}
            </div>
          ) : null}

          {(tab === "tree" || tab === "bom") && canManage ? (
            <div className="mb-4 flex flex-wrap gap-2">
              {addButtons.map((btn) => (
                <button
                  key={btn.label}
                  type="button"
                  disabled={saving}
                  className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted/50"
                  onClick={() => {
                    if (btn.action) {
                      btn.action();
                      return;
                    }
                    const parentLineId =
                      tab === "tree" && selectedTreeLineId ? selectedTreeLineId : undefined;
                    onAddLine(btn.source, parentLineId ? { parentLineId } : undefined);
                  }}
                >
                  <Plus className="h-3.5 w-3.5" />
                  {btn.label}
                </button>
              ))}
              <button
                type="button"
                disabled={saving}
                className="rounded-lg border border-border px-3 py-1.5 text-sm"
                onClick={() => void onReload()}
              >
                Atualizar
              </button>
            </div>
          ) : null}

          {tab === "tree" ? (
            <div className="space-y-4">
              {engineeringTree.children.length === 0 ? (
                <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                  Nenhum item na estrutura. Adicione matérias-primas, componentes oficiais ou itens
                  criados neste projeto.
                </p>
              ) : (
                <ProjectEngineeringTreePanel
                  tree={engineeringTree}
                  selectedLineId={selectedTreeLineId}
                  onSelectLine={(line) => setSelectedTreeLineId(line?.id ?? null)}
                  onEditLine={canManage ? onEditLine : undefined}
                  canManage={canManage}
                  variant="embedded"
                />
              )}
              {selectedTreeLineId && canManage ? (
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="rounded-lg border border-border px-3 py-1.5 text-sm"
                    onClick={() => {
                      const line = productLines.find((l) => l.id === selectedTreeLineId);
                      if (line) onEditLine(line);
                    }}
                  >
                    Editar linha selecionada
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-lg border border-destructive/40 px-3 py-1.5 text-sm text-destructive"
                    onClick={() => {
                      const line = productLines.find((l) => l.id === selectedTreeLineId);
                      if (line) onDeleteLine(line);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Remover
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          {tab === "bom" ? (
            <div className="space-y-4">
              <p className="text-xs text-muted-foreground">
                Composição de 1º nível. Para subcomponentes e matérias internas, use a aba Estrutura
                em Árvore.
              </p>
              <div className="overflow-hidden rounded-xl border border-border">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/40 text-left">
                    <tr>
                      <th className="px-3 py-2">Tipo</th>
                      <th className="px-3 py-2">Descrição</th>
                      <th className="px-3 py-2">Qtd</th>
                      <th className="px-3 py-2">Perda %</th>
                      <th className="px-3 py-2">R$/un</th>
                      <th className="px-3 py-2">Total</th>
                      {canManage ? <th className="px-3 py-2" /> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {bomLines.map((line) => (
                      <tr key={line.id} className="border-b border-border/60">
                        <td className="px-3 py-2">{structureLineTypeLabel(line)}</td>
                        <td className="px-3 py-2">{line.descriptionSnapshot}</td>
                        <td className="px-3 py-2">{line.quantity}</td>
                        <td className="px-3 py-2">{line.lossPercent ?? 0}</td>
                        <td className="px-3 py-2">{formatCurrency(line.unitCostSnapshot)}</td>
                        <td className="px-3 py-2">{formatCurrency(line.totalCost)}</td>
                        {canManage ? (
                          <td className="px-3 py-2">
                            <button
                              type="button"
                              className="text-xs text-primary hover:underline"
                              onClick={() => onEditLine(line)}
                            >
                              Editar
                            </button>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                    {!bomLines.length ? (
                      <tr>
                        <td
                          colSpan={canManage ? 7 : 6}
                          className="px-4 py-8 text-center text-muted-foreground"
                        >
                          BOM vazio — adicione itens com os botões acima.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {tab === "cost" ? (
            <div className="space-y-4">
              <dl className="grid gap-3 sm:grid-cols-2 text-sm">
                <div>
                  <dt className="text-muted-foreground">Linhas na estrutura</dt>
                  <dd className="font-medium">{productLines.length}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Linhas sem custo</dt>
                  <dd className="font-medium">{missingCostCount}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-muted-foreground">Custo total roll-up</dt>
                  <dd className="text-2xl font-bold">{formatCurrency(totalCost)}</dd>
                </div>
              </dl>
              <p className="text-xs text-muted-foreground">
                Projeto #{projectId.slice(0, 8)}… — {simulatedItems.length} item(ns) simulado(s),{" "}
                {simulatedProducts.length} produto(s) no projeto.
              </p>
            </div>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
