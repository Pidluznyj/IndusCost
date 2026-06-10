import React, { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { ProjectModalShell } from "@/src/components/projects/ProjectModalShell";
import { parseProjectsNumberInput } from "@/src/lib/projectsUiUtils";
import type {
  ProjectSimulatedItemRow,
  ProjectStructureLineType,
  ProjectStructureSourceType,
} from "@/src/types/projects";

type Props = {
  open: boolean;
  sourceType: ProjectStructureSourceType | null;
  simulatedItems: ProjectSimulatedItemRow[];
  saving?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (body: Record<string, unknown>) => Promise<void>;
};

export function ProjectStructureLineModal({
  open,
  sourceType,
  simulatedItems,
  saving,
  error,
  onClose,
  onSubmit,
}: Props) {
  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [materialRows, setMaterialRows] = useState<{ id: string; code: string; description: string }[]>([]);
  const [productRows, setProductRows] = useState<{ id: string; sku: string; name: string }[]>([]);
  const [selectedMaterialId, setSelectedMaterialId] = useState("");
  const [selectedProductId, setSelectedProductId] = useState("");
  const [selectedSimulatedItemId, setSelectedSimulatedItemId] = useState("");
  const [manualDescription, setManualDescription] = useState("");
  const [manualUnitCost, setManualUnitCost] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [lossPercent, setLossPercent] = useState("0");

  useEffect(() => {
    if (!open) return;
    setSearch("");
    setSearchError(null);
    setMaterialRows([]);
    setProductRows([]);
    setSelectedMaterialId("");
    setSelectedProductId("");
    setSelectedSimulatedItemId(simulatedItems[0]?.id ?? "");
    setManualDescription("");
    setManualUnitCost("");
    setQuantity("1");
    setLossPercent("0");
  }, [open, simulatedItems]);

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
          const res = await fetchJsonOk<{ rows: { id: string; code: string; description: string }[] }>(
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

  if (!open || !sourceType) return null;

  const titleBySource: Record<ProjectStructureSourceType, string> = {
    EXISTING_MATERIAL: "Adicionar material existente",
    EXISTING_PRODUCT: "Adicionar produto existente",
    SIMULATED_ITEM: "Adicionar item simulado",
    MANUAL: "Adicionar linha manual",
  };

  const canSubmit = (() => {
    switch (sourceType) {
      case "EXISTING_MATERIAL":
        return Boolean(selectedMaterialId);
      case "EXISTING_PRODUCT":
        return Boolean(selectedProductId);
      case "SIMULATED_ITEM":
        return Boolean(selectedSimulatedItemId);
      case "MANUAL":
        return Boolean(manualDescription.trim());
      default:
        return false;
    }
  })();

  const handleSubmit = async () => {
    const lineType: ProjectStructureLineType =
      sourceType === "EXISTING_PRODUCT"
        ? "COMPONENT"
        : sourceType === "SIMULATED_ITEM"
          ? "RAW_MATERIAL"
          : "RAW_MATERIAL";

    const body: Record<string, unknown> = {
      sourceType,
      lineType,
      quantity: parseProjectsNumberInput(quantity) ?? 1,
      lossPercent: parseProjectsNumberInput(lossPercent) ?? 0,
    };

    if (sourceType === "EXISTING_MATERIAL") body.existingMaterialId = selectedMaterialId;
    if (sourceType === "EXISTING_PRODUCT") body.existingProductId = selectedProductId;
    if (sourceType === "SIMULATED_ITEM") body.simulatedItemId = selectedSimulatedItemId;
    if (sourceType === "MANUAL") {
      body.description = manualDescription.trim();
      body.unitCost = parseProjectsNumberInput(manualUnitCost) ?? 0;
    }

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
            Adicionar linha
          </button>
        </>
      }
    >
      {error ? (
        <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {sourceType === "EXISTING_MATERIAL" || sourceType === "EXISTING_PRODUCT" ? (
        <div className="space-y-3">
          <input
            className={fieldClass}
            placeholder={sourceType === "EXISTING_MATERIAL" ? "Buscar material..." : "Buscar produto..."}
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
                    className={`block w-full px-3 py-2 text-left text-sm hover:bg-muted/50 ${selectedMaterialId === r.id ? "bg-muted" : ""}`}
                    onClick={() => setSelectedMaterialId(r.id)}
                  >
                    {r.code} — {r.description}
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
        </div>
      ) : null}

      {sourceType === "SIMULATED_ITEM" ? (
        <div className="space-y-2">
          {simulatedItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">Cadastre um item simulado antes.</p>
          ) : (
            <select
              className={fieldClass}
              value={selectedSimulatedItemId}
              onChange={(e) => setSelectedSimulatedItemId(e.target.value)}
            >
              {simulatedItems.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.description}
                </option>
              ))}
            </select>
          )}
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
          <input
            className={fieldClass}
            placeholder="Custo unitário"
            value={manualUnitCost}
            onChange={(e) => setManualUnitCost(e.target.value)}
          />
        </div>
      ) : null}

      <div className="mt-4 grid grid-cols-2 gap-3">
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
    </ProjectModalShell>
  );
}
