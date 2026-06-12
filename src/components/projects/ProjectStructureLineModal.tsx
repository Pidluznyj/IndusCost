import React, { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { previewProjectStructureLineTotal } from "@/src/lib/projectsStructureLineBuilderShared";
import { PROJECT_ENGINEERING_CLONE_NOTICE } from "@/src/lib/projectsEngineeringWorkspace";
import { formatCurrency } from "@/src/lib/utils";
import { ProjectModalShell } from "@/src/components/projects/ProjectModalShell";
import { parseProjectsNumberInput } from "@/src/lib/projectsUiUtils";
import type {
  ProjectSimulatedItemRow,
  ProjectSimulatedProductRow,
  ProjectStructureLineType,
  ProjectStructureSourceType,
} from "@/src/types/projects";

type MaterialLookupRow = {
  id: string;
  code: string;
  description: string;
  unit: string;
  category?: string | null;
  supplier?: string | null;
  currentCost: number;
  averageCost?: number;
  standardCost?: number;
  standardLoss?: number;
};

type StructureLineContext = {
  simulatedProductId?: string;
  parentLineId?: string;
  contextLabel?: string;
};

type Props = {
  open: boolean;
  sourceType: ProjectStructureSourceType | null;
  engineeringFlow?: "clone" | "official" | null;
  simulatedItems: ProjectSimulatedItemRow[];
  simulatedProducts?: ProjectSimulatedProductRow[];
  lineContext?: StructureLineContext | null;
  saving?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (body: Record<string, unknown>) => Promise<void>;
  onImportExistingProduct?: (productId: string) => Promise<void>;
  onOpenProductSimulation?: (productId: string) => void;
};

export function ProjectStructureLineModal({
  open,
  sourceType,
  engineeringFlow = null,
  simulatedItems,
  simulatedProducts = [],
  lineContext,
  saving,
  error,
  onClose,
  onSubmit,
  onImportExistingProduct,
  onOpenProductSimulation,
}: Props) {
  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [materialRows, setMaterialRows] = useState<MaterialLookupRow[]>([]);
  const [productRows, setProductRows] = useState<{ id: string; sku: string; name: string }[]>([]);
  const [selectedMaterial, setSelectedMaterial] = useState<MaterialLookupRow | null>(null);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [selectedSimulatedItemId, setSelectedSimulatedItemId] = useState("");
  const [selectedProjectComponentId, setSelectedProjectComponentId] = useState("");
  const [selectedSimulatedProductId, setSelectedSimulatedProductId] = useState("");
  const [manualDescription, setManualDescription] = useState("");
  const [manualUnit, setManualUnit] = useState("UN");
  const [manualUnitCost, setManualUnitCost] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [lossPercent, setLossPercent] = useState("0");

  useEffect(() => {
    if (!open) return;
    setSearch("");
    setSearchError(null);
    setMaterialRows([]);
    setProductRows([]);
    setSelectedMaterial(null);
    setSelectedProductId("");
    setSelectedSimulatedItemId(simulatedItems[0]?.id ?? "");
    setSelectedProjectComponentId("");
    setSelectedSimulatedProductId(
      lineContext?.simulatedProductId ?? simulatedProducts[0]?.id ?? ""
    );
    setManualDescription("");
    setManualUnit("UN");
    setManualUnitCost("");
    setQuantity("1");
    setLossPercent("0");
  }, [open, simulatedItems, simulatedProducts, lineContext]);

  useEffect(() => {
    if (!open || !sourceType) return;
    if (sourceType !== "EXISTING_MATERIAL" && sourceType !== "EXISTING_PRODUCT") return;
    const q = search.trim();
    if (q.length < 2) {
      setMaterialRows([]);
      setProductRows([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      setSearching(true);
      setSearchError(null);
      try {
        if (sourceType === "EXISTING_MATERIAL") {
          const res = await fetchJsonOk<{ rows: MaterialLookupRow[] }>(
            `/api/projects/lookup/materials?q=${encodeURIComponent(q)}`
          );
          setMaterialRows(res.rows ?? []);
        } else {
          const res = await fetchJsonOk<{ rows: { id: string; sku: string; name: string }[] }>(
            `/api/projects/lookup/products?q=${encodeURIComponent(q)}`
          );
          setProductRows(res.rows ?? []);
        }
      } catch (e) {
        setSearchError(e instanceof Error ? e.message : "Erro na busca.");
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [open, sourceType, search]);

  const qtyNum = parseProjectsNumberInput(quantity) ?? 0;
  const lossNum = parseProjectsNumberInput(lossPercent) ?? 0;

  const unitCostPreview = useMemo(() => {
    if (sourceType === "EXISTING_MATERIAL" && selectedMaterial) {
      return selectedMaterial.currentCost;
    }
    if (sourceType === "SIMULATED_ITEM") {
      const item = simulatedItems.find((i) => i.id === selectedSimulatedItemId);
      return item?.quotedUnitCost ?? item?.estimatedUnitCost ?? 0;
    }
    if (sourceType === "MANUAL") {
      return parseProjectsNumberInput(manualUnitCost) ?? 0;
    }
    return 0;
  }, [sourceType, selectedMaterial, selectedSimulatedItemId, simulatedItems, manualUnitCost]);

  const lineTotalPreview = useMemo(() => {
    if (qtyNum <= 0) return 0;
    return previewProjectStructureLineTotal(qtyNum, unitCostPreview, lossNum);
  }, [qtyNum, unitCostPreview, lossNum]);

  if (!open || !sourceType) return null;

  const titleBySource: Record<ProjectStructureSourceType, string> = {
    EXISTING_MATERIAL:
      engineeringFlow === "official" ? "Adicionar material oficial" : "Matéria-prima da base",
    EXISTING_PRODUCT:
      engineeringFlow === "clone"
        ? "Clonar item existente"
        : "Produto/componente existente",
    SIMULATED_ITEM: "Componente do projeto",
    MANUAL: engineeringFlow === "official" ? "Referência orçada no projeto" : "Item orçado / manual",
  };

  const canSubmit = (() => {
    if (qtyNum <= 0) return false;
    switch (sourceType) {
      case "EXISTING_MATERIAL":
        return Boolean(selectedMaterial);
      case "EXISTING_PRODUCT":
        return Boolean(selectedProductId);
      case "SIMULATED_ITEM":
        return Boolean(selectedSimulatedItemId || selectedProjectComponentId);
      case "MANUAL":
        return Boolean(manualDescription.trim());
      default:
        return false;
    }
  })();

  const handleSelectMaterial = (row: MaterialLookupRow) => {
    setSelectedMaterial(row);
    if ((parseProjectsNumberInput(lossPercent) ?? 0) === 0 && row.standardLoss > 0) {
      setLossPercent(String(row.standardLoss));
    }
  };

  const handleSubmit = async () => {
    if (
      sourceType === "EXISTING_PRODUCT" &&
      selectedProductId &&
      onImportExistingProduct &&
      !lineContext?.simulatedProductId
    ) {
      await onImportExistingProduct(selectedProductId);
      return;
    }

    if (sourceType === "SIMULATED_ITEM" && selectedProjectComponentId) {
      const refProduct = simulatedProducts.find((p) => p.id === selectedProjectComponentId);
      const body: Record<string, unknown> = {
        sourceType: "MANUAL",
        lineType: "COMPONENT",
        quantity: qtyNum,
        lossPercent: lossNum,
        description: refProduct
          ? `${refProduct.provisionalCode ? `${refProduct.provisionalCode} — ` : ""}${refProduct.description}`
          : "Componente do projeto",
        unit: refProduct?.unit ?? "UN",
        referencedSimulatedProductId: selectedProjectComponentId,
      };
      const targetProductId = lineContext?.simulatedProductId || selectedSimulatedProductId;
      if (targetProductId) body.simulatedProductId = targetProductId;
      if (lineContext?.parentLineId) body.parentLineId = lineContext.parentLineId;
      await onSubmit(body);
      return;
    }

    const simulatedItem =
      sourceType === "SIMULATED_ITEM"
        ? simulatedItems.find((i) => i.id === selectedSimulatedItemId)
        : null;
    const lineType: ProjectStructureLineType =
      sourceType === "EXISTING_PRODUCT"
        ? "COMPONENT"
        : sourceType === "SIMULATED_ITEM"
          ? simulatedItem?.itemType === "COMPONENT"
            ? "COMPONENT"
            : simulatedItem?.itemType === "PACKAGING"
              ? "PACKAGING"
              : "RAW_MATERIAL"
          : "RAW_MATERIAL";

    const body: Record<string, unknown> = {
      sourceType,
      lineType,
      quantity: qtyNum,
      lossPercent: lossNum,
    };

    if (sourceType === "EXISTING_MATERIAL" && selectedMaterial) {
      body.existingMaterialId = selectedMaterial.id;
    }
    if (sourceType === "EXISTING_PRODUCT") body.existingProductId = selectedProductId;
    if (sourceType === "SIMULATED_ITEM") body.simulatedItemId = selectedSimulatedItemId;
    if (sourceType === "MANUAL") {
      body.description = manualDescription.trim();
      body.unit = manualUnit.trim() || "UN";
      body.unitCost = parseProjectsNumberInput(manualUnitCost) ?? 0;
    }

    const targetProductId = lineContext?.simulatedProductId || selectedSimulatedProductId;
    if (targetProductId) body.simulatedProductId = targetProductId;
    if (lineContext?.parentLineId) body.parentLineId = lineContext.parentLineId;

    await onSubmit(body);
  };

  const fieldClass = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm";

  return (
    <ProjectModalShell
      title={titleBySource[sourceType]}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="rounded-lg border border-border px-4 py-2 text-sm" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            disabled={saving || !canSubmit}
            onClick={handleSubmit}
            className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-60"
          >
            {saving ? <Loader2 className="inline h-4 w-4 animate-spin" /> : null}
            {sourceType === "EXISTING_PRODUCT"
              ? lineContext?.simulatedProductId
                ? "Adicionar referência"
                : "Clonar para o projeto"
              : "Adicionar componente"}
          </button>
        </>
      }
    >
      {lineContext?.contextLabel ? (
        <p className="mb-3 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-950">
          {lineContext.contextLabel}
        </p>
      ) : null}

      {error ? (
        <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {sourceType === "EXISTING_PRODUCT" ? (
        <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {lineContext?.simulatedProductId
            ? "Referência ao componente oficial no BOM do projeto. O custo industrial do cadastro é usado como snapshot — editável aqui sem alterar o cadastro mestre."
            : engineeringFlow === "clone"
              ? PROJECT_ENGINEERING_CLONE_NOTICE
              : "Importa a BOM e os processos (HH) do produto oficial com os mesmos custos do cadastro. Os valores ficam como snapshot no projeto — editáveis aqui sem alterar Product, Material ou ProductBOM."}
        </p>
      ) : (
        <p className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-950">
          Cadastro exclusivo do projeto. Não cria Product, ProductBOM nem altera Material no Nomus.
        </p>
      )}

      {(sourceType === "EXISTING_MATERIAL" ||
        sourceType === "SIMULATED_ITEM" ||
        sourceType === "MANUAL") &&
      simulatedProducts.length > 0 &&
      !lineContext?.simulatedProductId ? (
        <div className="mb-3 space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Vincular ao produto do projeto</label>
          <select
            className={fieldClass}
            value={selectedSimulatedProductId}
            onChange={(e) => setSelectedSimulatedProductId(e.target.value)}
          >
            <option value="">Sem produto simulado (linha avulsa)</option>
            {simulatedProducts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.provisionalCode ? `${p.provisionalCode} — ` : ""}
                {p.description}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {sourceType === "EXISTING_MATERIAL" || sourceType === "EXISTING_PRODUCT" ? (
        <div className="space-y-3">
          <input
            className={fieldClass}
            placeholder={sourceType === "EXISTING_MATERIAL" ? "Buscar por código ou descrição..." : "Buscar produto..."}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {searching ? <p className="text-sm text-muted-foreground">Buscando...</p> : null}
          {searchError ? <p className="text-sm text-destructive">{searchError}</p> : null}
          <div className="max-h-40 overflow-auto rounded-lg border border-border">
            {sourceType === "EXISTING_MATERIAL"
              ? materialRows.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className={`block w-full px-3 py-2 text-left text-sm hover:bg-muted/50 ${selectedMaterial?.id === r.id ? "bg-muted" : ""}`}
                    onClick={() => handleSelectMaterial(r)}
                  >
                    <span className="font-medium">{r.code}</span> — {r.description}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {formatCurrency(r.currentCost)}/{r.unit}
                    </span>
                  </button>
                ))
              : productRows.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className={`block w-full px-3 py-2 text-left text-sm hover:bg-muted/50 ${selectedProductId === r.id ? "bg-muted" : ""}`}
                    onClick={() => setSelectedProductId(r.id)}
                  >
                    {r.sku} — {r.name}
                  </button>
                ))}
          </div>
          {sourceType === "EXISTING_MATERIAL" && selectedMaterial ? (
            <div className="rounded-lg border border-border bg-muted/20 p-3 text-xs space-y-1">
              <p>
                <span className="text-muted-foreground">Unidade:</span> {selectedMaterial.unit}
              </p>
              <p>
                <span className="text-muted-foreground">Categoria:</span> {selectedMaterial.category ?? "—"}
              </p>
              <p>
                <span className="text-muted-foreground">Fornecedor:</span> {selectedMaterial.supplier ?? "—"}
              </p>
              <p>
                <span className="text-muted-foreground">Custo atual:</span>{" "}
                {formatCurrency(selectedMaterial.currentCost)}
              </p>
              <p>
                <span className="text-muted-foreground">Custo médio:</span>{" "}
                {formatCurrency(selectedMaterial.averageCost ?? 0)}
              </p>
              <p>
                <span className="text-muted-foreground">Custo padrão:</span>{" "}
                {formatCurrency(selectedMaterial.standardCost ?? 0)}
              </p>
              <p>
                <span className="text-muted-foreground">Perda padrão:</span> {selectedMaterial.standardLoss ?? 0}%
              </p>
            </div>
          ) : null}
          {sourceType === "EXISTING_PRODUCT" && selectedProductId && onOpenProductSimulation ? (
            <button
              type="button"
              className="w-full rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950 hover:bg-amber-100"
              onClick={() => onOpenProductSimulation(selectedProductId)}
            >
              Editar simulação deste produto (BOM / processos / custo)
            </button>
          ) : null}
        </div>
      ) : null}

      {sourceType === "SIMULATED_ITEM" ? (
        <div className="space-y-3">
          {simulatedProducts.filter((p) => p.id !== lineContext?.simulatedProductId).length > 0 ? (
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Componente com estrutura no projeto
              </label>
              <select
                className={fieldClass}
                value={selectedProjectComponentId}
                onChange={(e) => {
                  setSelectedProjectComponentId(e.target.value);
                  if (e.target.value) setSelectedSimulatedItemId("");
                }}
              >
                <option value="">— Selecionar —</option>
                {simulatedProducts
                  .filter((p) => p.id !== lineContext?.simulatedProductId)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.provisionalCode ? `${p.provisionalCode} — ` : ""}
                      {p.description}
                    </option>
                  ))}
              </select>
            </div>
          ) : null}
          {simulatedItems.length > 0 ? (
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Matéria-prima / item simples
              </label>
              <select
                className={fieldClass}
                value={selectedSimulatedItemId}
                onChange={(e) => {
                  setSelectedSimulatedItemId(e.target.value);
                  if (e.target.value) setSelectedProjectComponentId("");
                }}
              >
                <option value="">— Selecionar —</option>
                {simulatedItems.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.provisionalCode ? `${i.provisionalCode} — ` : ""}
                    {i.description}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {simulatedItems.length === 0 &&
          simulatedProducts.filter((p) => p.id !== lineContext?.simulatedProductId).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Cadastre um componente ou matéria-prima na aba Itens do Projeto antes.
            </p>
          ) : null}
        </div>
      ) : null}

      {sourceType === "MANUAL" ? (
        <div className="space-y-3">
          <input
            className={fieldClass}
            placeholder="Descrição *"
            value={manualDescription}
            onChange={(e) => setManualDescription(e.target.value)}
          />
          <div className="grid grid-cols-2 gap-3">
            <input
              className={fieldClass}
              placeholder="Unidade"
              value={manualUnit}
              onChange={(e) => setManualUnit(e.target.value)}
            />
            <input
              className={fieldClass}
              placeholder="Custo unitário"
              value={manualUnitCost}
              onChange={(e) => setManualUnitCost(e.target.value)}
            />
          </div>
        </div>
      ) : null}

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Peso / consumo por unidade</label>
          <input
            className={fieldClass}
            placeholder="Quantidade"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Perda %</label>
          <input
            className={fieldClass}
            placeholder="Perda %"
            value={lossPercent}
            onChange={(e) => setLossPercent(e.target.value)}
          />
        </div>
      </div>

      {qtyNum > 0 ? (
        <div className="mt-4 rounded-lg border border-border bg-muted/30 p-3 text-sm">
          <p className="font-medium">Prévia do custo da linha</p>
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
            <span>Custo unitário: {formatCurrency(unitCostPreview)}</span>
            <span>Consumo: {qtyNum}</span>
            <span>Perda: {lossNum}%</span>
            <span className="font-semibold text-foreground">Total: {formatCurrency(lineTotalPreview)}</span>
          </div>
          {unitCostPreview <= 0 ? (
            <p className="mt-2 text-xs text-amber-800">Sem custo cadastrado — linha será marcada como custo faltante.</p>
          ) : null}
        </div>
      ) : (
        <p className="mt-3 text-xs text-destructive">Informe quantidade ou peso maior que zero.</p>
      )}
    </ProjectModalShell>
  );
}
