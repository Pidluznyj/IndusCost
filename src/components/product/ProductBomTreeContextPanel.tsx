import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Box,
  ChevronRight,
  Layers,
  Loader2,
  Package,
  PanelRightClose,
  Save,
  ExternalLink,
  DollarSign,
} from "lucide-react";
import { cn, formatCurrency } from "@/src/lib/utils";
import { fetchJsonOk } from "@/src/lib/http";
import { buildProductPutBody } from "@/src/lib/productPutPayload";
import type { Product } from "@/src/types/product";

export type TreeEdgeSelection = {
  ownerProductId: string;
  nodeType: "COMPONENT" | "MATERIAL";
  childProductId?: string;
  materialId?: string;
  /** Snapshot from tree API */
  node: any;
};

type BomDraft = { quantity: number; lossPercentage: number; notes: string };

type ComponentDraft = {
  sku: string;
  name: string;
  description: string;
  cycleTimeSeconds: string;
  cavities: string;
  setupTimeMin: string;
  efficiencyExpected: string;
  defaultLotSize: string;
};

function emptyComponentDraft(): ComponentDraft {
  return {
    sku: "",
    name: "",
    description: "",
    cycleTimeSeconds: "",
    cavities: "",
    setupTimeMin: "",
    efficiencyExpected: "",
    defaultLotSize: "1",
  };
}

function confirmDiscardUnsaved(dirty: boolean): boolean {
  if (!dirty) return true;
  return window.confirm(
    "Existem alterações não salvas neste painel. Deseja descartá-las?"
  );
}

const TreeRow: React.FC<{
  node: any;
  parentProductId: string;
  selectedKey: string | null;
  onSelect: (sel: TreeEdgeSelection) => void;
  depth: number;
}> = ({ node, parentProductId, selectedKey, onSelect, depth }) => {
  const isComponent = node.type === "COMPONENT";
  const name = isComponent ? node.item?.name : node.item?.description;
  const code = isComponent ? node.item?.sku : node.item?.code;
  const key = `${parentProductId}:${node.id}`;
  const isSelected = selectedKey === key;

  return (
    <div className={cn("relative", depth > 0 && "mt-2")}>
      {depth > 0 && <div className="absolute -left-6 top-4 w-6 h-px bg-border" />}
      <button
        type="button"
        onClick={() =>
          onSelect({
            ownerProductId: parentProductId,
            nodeType: node.type,
            childProductId: isComponent ? node.item?.id : undefined,
            materialId: !isComponent ? node.item?.id : undefined,
            node,
          })
        }
        className={cn(
          "w-full text-left flex items-center gap-3 p-3 rounded-lg border transition-colors",
          isSelected
            ? "bg-primary/15 border-primary ring-2 ring-primary/30"
            : "bg-accent/30 border-border hover:border-primary/40"
        )}
      >
        <div
          className={cn(
            "h-8 w-8 rounded flex items-center justify-center shrink-0",
            isComponent ? "bg-purple-500/10 text-purple-600" : "bg-orange-500/10 text-orange-600"
          )}
        >
          {isComponent ? <Layers className="h-4 w-4" /> : <Box className="h-4 w-4" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-bold truncate">{name || "Desconhecido"}</p>
            <p className="text-[10px] font-bold text-primary shrink-0">Qtd: {Number(node.quantity)}</p>
          </div>
          <p className="text-[10px] text-muted-foreground font-mono truncate">{code}</p>
        </div>
      </button>

      {isComponent && node.item?.children && node.item.children.length > 0 && (
        <div className="ml-6 border-l-2 border-border pl-6 mt-2 space-y-2">
          {node.item.children.map((childNode: any, cIdx: number) => (
            <TreeRow
              key={cIdx}
              node={childNode}
              parentProductId={node.item.id}
              selectedKey={selectedKey}
              onSelect={onSelect}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export const ProductBomTreeContextPanel: React.FC<{
  treeData: any;
  loadingTree: boolean;
  rootProductId: string;
  rootName: string;
  rootSku: string;
  rootType: "PRODUCT" | "COMPONENT" | "MATERIAL";
  onReloadTree: () => Promise<void>;
  onAfterMutation: () => void;
  onOpenFullProductEdit: (product: Product) => void;
}> = ({
  treeData,
  loadingTree,
  rootProductId,
  rootName,
  rootSku,
  rootType,
  onReloadTree,
  onAfterMutation,
  onOpenFullProductEdit,
}) => {
  const [selection, setSelection] = useState<TreeEdgeSelection | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [bomDraft, setBomDraft] = useState<BomDraft>({ quantity: 1, lossPercentage: 0, notes: "" });
  const [componentDraft, setComponentDraft] = useState<ComponentDraft>(emptyComponentDraft());
  const [saving, setSaving] = useState(false);
  const [costPreview, setCostPreview] = useState<any | null>(null);
  const [loadingCost, setLoadingCost] = useState(false);

  const selectionKey = useMemo(() => {
    if (!selection) return null;
    return `${selection.ownerProductId}:${selection.node.id}`;
  }, [selection]);

  useEffect(() => {
    setSelectedKey(selectionKey);
  }, [selectionKey]);

  const applySelection = useCallback((sel: TreeEdgeSelection) => {
      const n = sel.node;
      setSelection(sel);
      setBomDraft({
        quantity: Number(n.quantity),
        lossPercentage: Number(n.lossPercentage),
        notes: (n.notes as string) || "",
      });
      if (sel.nodeType === "COMPONENT" && n.item) {
        const p = n.item;
        setComponentDraft({
          sku: p.sku ?? "",
          name: p.name ?? "",
          description: p.description ?? "",
          cycleTimeSeconds: p.cycleTimeSeconds != null ? String(p.cycleTimeSeconds) : "",
          cavities: p.cavities != null ? String(p.cavities) : "",
          setupTimeMin: p.setupTimeMin != null ? String(p.setupTimeMin) : "",
          efficiencyExpected: p.efficiencyExpected != null ? String(p.efficiencyExpected) : "",
          defaultLotSize: p.defaultLotSize != null ? String(p.defaultLotSize) : "1",
        });
      } else {
        setComponentDraft(emptyComponentDraft());
      }
      setCostPreview(null);
      setDirty(false);
  }, []);

  const requestSelect = useCallback(
    (raw: TreeEdgeSelection) => {
      if (!confirmDiscardUnsaved(dirty)) return;
      applySelection(raw);
    },
    [dirty, applySelection]
  );

  const closePanel = useCallback(() => {
    if (!confirmDiscardUnsaved(dirty)) return;
    setSelection(null);
    setSelectedKey(null);
    setDirty(false);
  }, [dirty]);

  const markDirty = () => setDirty(true);

  const matchLine = useCallback(
    (line: Product["ProductBOM"][0], sel: TreeEdgeSelection) => {
      if (sel.nodeType === "COMPONENT") return line.childProductId === sel.childProductId;
      return line.materialId === sel.materialId;
    },
    []
  );

  const saveBomLine = async (continueAfter: boolean) => {
    if (!selection) return;
    setSaving(true);
    try {
      const owner = await fetchJsonOk<Product>(`/api/products/${selection.ownerProductId}`);
      const bom = owner.ProductBOM.map((line) => {
        if (!matchLine(line, selection)) {
          return {
            materialId: line.materialId ?? undefined,
            childProductId: line.childProductId ?? undefined,
            quantity: Number(line.quantity),
            lossPercentage: Number(line.lossPercentage),
            notes: line.notes ?? "",
          };
        }
        return {
          materialId: line.materialId ?? undefined,
          childProductId: line.childProductId ?? undefined,
          quantity: bomDraft.quantity,
          lossPercentage: bomDraft.lossPercentage,
          notes: bomDraft.notes,
        };
      });
      await fetchJsonOk(`/api/products/${selection.ownerProductId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildProductPutBody(owner, { bom })),
      });
      if (selection.ownerProductId === rootProductId) onAfterMutation();
      const refreshed = await fetchJsonOk<Product>(`/api/products/${selection.ownerProductId}`);
      const line = refreshed.ProductBOM.find((l) => matchLine(l, selection));
      await onReloadTree();
      setDirty(false);
      if (!line) {
        setSelection(null);
        setSelectedKey(null);
      } else if (continueAfter) {
        applySelection({
          ...selection,
          node: {
            ...selection.node,
            id: line.id,
            quantity: line.quantity,
            lossPercentage: line.lossPercentage,
            notes: line.notes ?? "",
          },
        });
      } else {
        setSelection(null);
        setSelectedKey(null);
      }
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : "Erro ao salvar linha da BOM.");
    } finally {
      setSaving(false);
    }
  };

  const saveComponentCadastro = async (continueAfter: boolean) => {
    if (!selection || selection.nodeType !== "COMPONENT") return;
    const childId = selection.childProductId;
    if (!childId) return;
    setSaving(true);
    try {
      const child = await fetchJsonOk<Product>(`/api/products/${childId}`);
      const merged: Product = {
        ...child,
        sku: componentDraft.sku.trim() || child.sku,
        name: componentDraft.name.trim() || child.name,
        description: componentDraft.description || child.description,
        defaultLotSize: Number(componentDraft.defaultLotSize) || child.defaultLotSize,
        cycleTimeSeconds:
          componentDraft.cycleTimeSeconds === ""
            ? child.cycleTimeSeconds
            : Number(componentDraft.cycleTimeSeconds) || null,
        cavities:
          componentDraft.cavities === "" ? child.cavities : Number(componentDraft.cavities) || null,
        setupTimeMin:
          componentDraft.setupTimeMin === "" ? child.setupTimeMin : Number(componentDraft.setupTimeMin) || null,
        efficiencyExpected:
          componentDraft.efficiencyExpected === ""
            ? child.efficiencyExpected
            : Number(componentDraft.efficiencyExpected) || null,
      };
      await fetchJsonOk(`/api/products/${childId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildProductPutBody(merged)),
      });
      onAfterMutation();
      await onReloadTree();
      setDirty(false);
      if (!continueAfter) {
        setSelection(null);
        setSelectedKey(null);
      }
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : "Erro ao salvar cadastro do componente.");
    } finally {
      setSaving(false);
    }
  };

  const loadCostPreview = async () => {
    if (!selection || selection.nodeType !== "COMPONENT" || !selection.childProductId) return;
    setLoadingCost(true);
    setCostPreview(null);
    try {
      const data = await fetchJsonOk(`/api/products/${selection.childProductId}/cost-analysis`);
      if (data && typeof data === "object" && "error" in data) {
        alert(typeof (data as { message?: string }).message === "string" ? (data as { message: string }).message : "Análise indisponível.");
        setCostPreview(null);
        return;
      }
      setCostPreview(data);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Não foi possível carregar a análise de custo.");
    } finally {
      setLoadingCost(false);
    }
  };

  const openFullEdit = async () => {
    if (!selection) return;
    if (!confirmDiscardUnsaved(dirty)) return;
    try {
      const id =
        selection.nodeType === "COMPONENT" ? selection.childProductId! : selection.materialId!;
      const isMat = selection.nodeType === "MATERIAL";
      if (isMat) {
        alert("Matérias-primas são editadas no módulo de Suprimentos (Materiais).");
        return;
      }
      const p = await fetchJsonOk<Product>(`/api/products/${id}`);
      onOpenFullProductEdit(p);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao carregar item.");
    }
  };

  return (
    <div className="flex flex-col lg:flex-row gap-0 min-h-[420px] border border-border rounded-xl overflow-hidden bg-card">
      <div className="flex-1 min-w-0 p-4 lg:p-6 border-b lg:border-b-0 lg:border-r border-border">
        <h4 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-4 flex items-center gap-2">
          <ChevronRight className="h-4 w-4" /> Visualização Hierárquica
        </h4>
        <div className="space-y-2">
          <div className="flex items-center gap-3 p-3 bg-primary/10 rounded-lg border border-primary/20">
            {rootType === "PRODUCT" ? (
              <Package className="h-5 w-5 text-primary shrink-0" />
            ) : (
              <Layers className="h-5 w-5 text-primary shrink-0" />
            )}
            <div className="min-w-0">
              <p className="text-sm font-bold truncate">{rootName || "Item"}</p>
              <p className="text-[10px] text-primary font-mono truncate">{rootSku || "—"}</p>
            </div>
          </div>
          <div className="ml-6 border-l-2 border-border pl-6 space-y-2 pt-2">
            {loadingTree ? (
              <div className="flex items-center gap-2 text-muted-foreground py-4">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-xs">Carregando estrutura...</span>
              </div>
            ) : !treeData?.children?.length ? (
              <p className="text-xs text-muted-foreground italic py-4">Nenhum item na estrutura salva.</p>
            ) : (
              treeData.children.map((node: any, idx: number) => (
                <TreeRow
                  key={idx}
                  node={node}
                  parentProductId={rootProductId}
                  selectedKey={selectedKey}
                  onSelect={requestSelect}
                  depth={0}
                />
              ))
            )}
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground mt-4">
          Clique em uma linha da estrutura para editar a relação na BOM e o cadastro do componente no painel à
          direita.
        </p>
      </div>

      <aside className="w-full lg:w-[380px] xl:w-[420px] shrink-0 bg-accent/10 flex flex-col border-l border-border min-h-[280px]">
        {!selection ? (
          <div className="p-6 text-sm text-muted-foreground flex flex-col items-center justify-center min-h-[200px] gap-2">
            <PanelRightClose className="h-8 w-8 opacity-40" />
            <p className="text-center">Selecione um item na árvore para editar no contexto.</p>
          </div>
        ) : (
          <div className="flex flex-col h-full max-h-[70vh] overflow-y-auto">
            <div className="p-4 border-b border-border flex items-start justify-between gap-2 bg-card/80 sticky top-0 z-10">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase text-muted-foreground">Item selecionado</p>
                <p className="text-sm font-bold truncate">
                  {selection.nodeType === "COMPONENT"
                    ? selection.node.item?.name
                    : selection.node.item?.description}
                </p>
                <p className="text-[10px] font-mono text-muted-foreground truncate">
                  {selection.nodeType === "COMPONENT" ? selection.node.item?.sku : selection.node.item?.code}
                </p>
              </div>
              <button
                type="button"
                onClick={closePanel}
                className="text-xs text-muted-foreground hover:text-foreground shrink-0"
              >
                Fechar
              </button>
            </div>

            <div className="p-4 space-y-6 flex-1">
              <section className="space-y-3">
                <h5 className="text-xs font-bold uppercase text-primary border-b border-primary/20 pb-1">
                  Relação na BOM (pai → este item)
                </h5>
                <p className="text-[10px] text-muted-foreground">
                  Pertence à BOM do produto pai{" "}
                  <span className="font-mono">{selection.ownerProductId.slice(0, 8)}…</span>
                </p>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase">Quantidade</label>
                  <input
                    type="number"
                    step="0.0001"
                    className="w-full p-2 rounded-lg border border-border bg-background text-sm"
                    value={bomDraft.quantity}
                    onChange={(e) => {
                      setBomDraft((d) => ({ ...d, quantity: parseFloat(e.target.value) }));
                      markDirty();
                    }}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase">Perda (%)</label>
                  <input
                    type="number"
                    step="0.1"
                    className="w-full p-2 rounded-lg border border-border bg-background text-sm"
                    value={bomDraft.lossPercentage}
                    onChange={(e) => {
                      setBomDraft((d) => ({ ...d, lossPercentage: parseFloat(e.target.value) }));
                      markDirty();
                    }}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase">Obs. da linha</label>
                  <input
                    type="text"
                    className="w-full p-2 rounded-lg border border-border bg-background text-sm"
                    value={bomDraft.notes}
                    onChange={(e) => {
                      setBomDraft((d) => ({ ...d, notes: e.target.value }));
                      markDirty();
                    }}
                  />
                </div>
                <div className="flex flex-wrap gap-2 pt-2">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => saveBomLine(false)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 disabled:opacity-50"
                  >
                    <Save className="h-3.5 w-3.5" /> Salvar linha BOM
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => saveBomLine(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium hover:bg-accent"
                  >
                    Salvar e continuar
                  </button>
                </div>
              </section>

              {selection.nodeType === "COMPONENT" && (
                <section className="space-y-3">
                  <h5 className="text-xs font-bold uppercase text-primary border-b border-primary/20 pb-1">
                    Cadastro do componente
                  </h5>
                  <div className="grid grid-cols-1 gap-2">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-muted-foreground uppercase">SKU</label>
                      <input
                        className="w-full p-2 rounded-lg border border-border bg-background text-sm"
                        value={componentDraft.sku}
                        onChange={(e) => {
                          setComponentDraft((d) => ({ ...d, sku: e.target.value }));
                          markDirty();
                        }}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-muted-foreground uppercase">Nome</label>
                      <input
                        className="w-full p-2 rounded-lg border border-border bg-background text-sm"
                        value={componentDraft.name}
                        onChange={(e) => {
                          setComponentDraft((d) => ({ ...d, name: e.target.value }));
                          markDirty();
                        }}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-muted-foreground uppercase">Descrição</label>
                      <input
                        className="w-full p-2 rounded-lg border border-border bg-background text-sm"
                        value={componentDraft.description}
                        onChange={(e) => {
                          setComponentDraft((d) => ({ ...d, description: e.target.value }));
                          markDirty();
                        }}
                      />
                    </div>
                    <p className="text-[10px] text-muted-foreground font-semibold pt-1">Processo padrão (componente)</p>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-muted-foreground">Ciclo (s)</label>
                        <input
                          type="number"
                          className="w-full p-2 rounded-lg border border-border bg-background text-sm"
                          value={componentDraft.cycleTimeSeconds}
                          onChange={(e) => {
                            setComponentDraft((d) => ({ ...d, cycleTimeSeconds: e.target.value }));
                            markDirty();
                          }}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-muted-foreground">Cavidades</label>
                        <input
                          type="number"
                          className="w-full p-2 rounded-lg border border-border bg-background text-sm"
                          value={componentDraft.cavities}
                          onChange={(e) => {
                            setComponentDraft((d) => ({ ...d, cavities: e.target.value }));
                            markDirty();
                          }}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-muted-foreground">Setup (min)</label>
                        <input
                          type="number"
                          className="w-full p-2 rounded-lg border border-border bg-background text-sm"
                          value={componentDraft.setupTimeMin}
                          onChange={(e) => {
                            setComponentDraft((d) => ({ ...d, setupTimeMin: e.target.value }));
                            markDirty();
                          }}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-muted-foreground">Eficiência (%)</label>
                        <input
                          type="number"
                          className="w-full p-2 rounded-lg border border-border bg-background text-sm"
                          value={componentDraft.efficiencyExpected}
                          onChange={(e) => {
                            setComponentDraft((d) => ({ ...d, efficiencyExpected: e.target.value }));
                            markDirty();
                          }}
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-muted-foreground uppercase">Lote padrão</label>
                      <input
                        type="number"
                        className="w-full p-2 rounded-lg border border-border bg-background text-sm"
                        value={componentDraft.defaultLotSize}
                        onChange={(e) => {
                          setComponentDraft((d) => ({ ...d, defaultLotSize: e.target.value }));
                          markDirty();
                        }}
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => saveComponentCadastro(false)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 disabled:opacity-50"
                    >
                      <Save className="h-3.5 w-3.5" /> Salvar cadastro
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => saveComponentCadastro(true)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium hover:bg-accent"
                    >
                      Salvar cadastro e continuar
                    </button>
                  </div>
                </section>
              )}

              {selection.nodeType === "MATERIAL" && (
                <section className="text-xs text-muted-foreground border border-dashed border-border rounded-lg p-3">
                  <p>
                    Esta linha referencia uma <strong>matéria-prima</strong>. O cadastro completo é feito em{" "}
                    <strong>Suprimentos → Materiais</strong>.
                  </p>
                </section>
              )}

              <section className="space-y-2 border-t border-border pt-4">
                <h5 className="text-xs font-bold uppercase text-muted-foreground">Ações rápidas</h5>
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={openFullEdit}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-xs font-medium hover:bg-accent text-left"
                  >
                    <ExternalLink className="h-4 w-4 shrink-0" />
                    Abrir edição completa do item (substitui o formulário principal)
                  </button>
                  {selection.nodeType === "COMPONENT" && (
                    <>
                      <button
                        type="button"
                        onClick={loadCostPreview}
                        disabled={loadingCost}
                        className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-xs font-medium hover:bg-accent text-left"
                      >
                        {loadingCost ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <DollarSign className="h-4 w-4" />
                        )}
                        Carregar análise de custo (resumo)
                      </button>
                      {costPreview && !("error" in costPreview) && (
                        <div className="rounded-lg bg-background border border-border p-3 text-[11px] space-y-1">
                          <p>
                            <span className="text-muted-foreground">CIU:</span>{" "}
                            <span className="font-bold">
                              {formatCurrency(Number(costPreview.summary?.totalIndustrialCost ?? 0))}
                            </span>
                          </p>
                          <p>
                            <span className="text-muted-foreground">MP:</span>{" "}
                            {formatCurrency(Number(costPreview.summary?.totalMaterialCost ?? 0))}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            Dados da API de custo do componente; a árvore continua sendo do item raiz aberto no
                            modal.
                          </p>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </section>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
};
