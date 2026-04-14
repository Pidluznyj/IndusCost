import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { 
  TrendingUp, 
  Plus, 
  Trash2, 
  X,
  Loader2,
  Calculator,
  AlertCircle,
  Save,
  Layers,
  Zap,
  Users,
  Truck,
  DollarSign,
  ArrowUpRight,
  ArrowDownRight,
  Info,
  Cpu,
  Copy,
  FileText,
  Printer,
  Search,
} from "lucide-react";
import { cn, formatCurrency, formatNumber } from "@/src/lib/utils";
import { fetchJsonOk, fetchOk } from "@/src/lib/http";
import { SearchableSelect } from "./shared/SearchableSelect";
import { motion, AnimatePresence } from "motion/react";
import { GuidedTour } from "@/src/components/tour/GuidedTour";
import { TourHelpButton } from "@/src/components/tour/TourHelpButton";
import { SIMULATION_TOUR_STEPS } from "@/src/tours/simulationTourSteps";
import {
  marginFromCostAndTargetPrice,
  priceFromCostAndMargin,
} from "@/src/lib/simulationFormula";
import {
  computeFinalProductFromComposition,
  computeSimulatedComponent,
  effectiveUnitCostFromMaterialPayload,
  type ExistingComponentCost,
  type FinalCompositionLine,
  materialLineTotal,
  type NewProductMaterialLine,
  type SimulatedComponent,
} from "@/src/lib/newProductSandbox";
import type { Material } from "@/src/types/material";
import {
  persistedStatusFromApiRecord,
  type NewProductSimulationSnapshot,
} from "@/src/lib/newProductSimulationSnapshot";
import { NewProductSimulationReport } from "@/src/components/NewProductSimulationReport";

type PersistedNewProductSimulationSummary = {
  id: string;
  name: string;
  status: "DRAFT" | "SAVED";
  sourceSimulationId?: string | null;
  productName: string;
  productSku?: string | null;
  savedAt?: string | null;
  createdAt?: string | null;
};

type PersistedNewProductSimulation = PersistedNewProductSimulationSummary & {
  snapshot: NewProductSimulationSnapshot;
};

export const SimulationModule = () => {
  const [workspaceTab, setWorkspaceTab] = useState<"SCENARIOS" | "NEW_PRODUCT">("SCENARIOS");
  const [simulations, setSimulations] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [taxRules, setTaxRules] = useState<any[]>([]);
  /** Materiais Suprimentos — preço efetivo alinhado ao GET /api/materials */
  const [materialCatalog, setMaterialCatalog] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [comparing, setComparing] = useState<any | null>(null);
  const [tourOpen, setTourOpen] = useState(false);
  const [compareViewTab, setCompareViewTab] = useState<"INTERNAL" | "CLIENT">("INTERNAL");
  const [clientCurrentPriceInput, setClientCurrentPriceInput] = useState("0");
  const [clientReadjustPctInput, setClientReadjustPctInput] = useState("0");
  const [clientValidityNote, setClientValidityNote] = useState("");
  const [clientObservation, setClientObservation] = useState("");
  const [commercialMode, setCommercialMode] = useState<"MARGIN" | "TARGET_PRICE">("MARGIN");
  const [commercialMarginInput, setCommercialMarginInput] = useState("0");
  const [commercialTargetPriceInput, setCommercialTargetPriceInput] = useState("0");
  const [newProductInnerTab, setNewProductInnerTab] = useState<"FINAL_PRODUCT" | "SIM_COMPONENTS" | "VIABILITY">("FINAL_PRODUCT");
  const [finalProductMode, setFinalProductMode] = useState<"MARGIN" | "TARGET_PRICE">("MARGIN");
  const [finalProductName, setFinalProductName] = useState("");
  const [finalProductSku, setFinalProductSku] = useState("");
  const [finalProductNotes, setFinalProductNotes] = useState("");
  const [finalDesiredMargin, setFinalDesiredMargin] = useState("20");
  const [finalTargetPrice, setFinalTargetPrice] = useState("0");
  const [finalCompositionLines, setFinalCompositionLines] = useState<FinalCompositionLine[]>([
    { id: "line-initial", type: "EXISTING_COMPONENT", refId: "", quantity: 1 },
  ]);
  const [simulatedComponents, setSimulatedComponents] = useState<SimulatedComponent[]>([]);
  const [editingSimulatedId, setEditingSimulatedId] = useState<string | null>(null);
  const [simDraftName, setSimDraftName] = useState("");
  const [simDraftSku, setSimDraftSku] = useState("");
  const [simDraftHh, setSimDraftHh] = useState("0");
  const [simDraftHm, setSimDraftHm] = useState("0");
  const [simDraftMaterials, setSimDraftMaterials] = useState<NewProductMaterialLine[]>([
    { code: "", description: "", quantity: 0, unit: "kg", unitCost: 0, source: "MANUAL", materialId: null },
  ]);
  const [existingComponentCosts, setExistingComponentCosts] = useState<Record<string, ExistingComponentCost>>({});
  const [existingCostLoadingId, setExistingCostLoadingId] = useState<string | null>(null);
  const [savedNewProductSimulations, setSavedNewProductSimulations] = useState<PersistedNewProductSimulationSummary[]>([]);
  const [savedSnapshotSearch, setSavedSnapshotSearch] = useState("");
  const [savedNewProductLoading, setSavedNewProductLoading] = useState(false);
  const [activePersistedSimulation, setActivePersistedSimulation] = useState<PersistedNewProductSimulationSummary | null>(null);
  const [frozenLineValues, setFrozenLineValues] = useState<Record<string, { unitCost: number; lineTotal: number }>>({});
  const [snapshotSaveName, setSnapshotSaveName] = useState("");
  const [frozenReportSnapshot, setFrozenReportSnapshot] = useState<NewProductSimulationSnapshot | null>(null);
  const [newProductReportOpen, setNewProductReportOpen] = useState(false);

  const [formData, setFormData] = useState({
    name: "",
    description: "",
    productId: "",
    taxRuleId: "",
    materialAdj: 0,
    laborAdj: 0,
    indirectAdj: 0,
    efficiencyAdj: 0,
    marginAdj: 0,
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const [s, p, t, mats] = await Promise.all([
        fetchJsonOk("/api/simulations"),
        fetchJsonOk("/api/products?cost=1"),
        fetchJsonOk("/api/tax-rules"),
        fetchJsonOk("/api/materials"),
      ]);
      setSimulations(Array.isArray(s) ? s : []);
      setProducts(Array.isArray(p) ? p : []);
      setTaxRules(Array.isArray(t) ? t : []);
      setMaterialCatalog(Array.isArray(mats) ? (mats as Material[]) : []);
    } catch (error) {
      console.error("Erro ao buscar simulações:", error);
      alert(error instanceof Error ? error.message : "Não foi possível carregar simulações.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const fetchSavedNewProductSimulations = async () => {
    setSavedNewProductLoading(true);
    try {
      const rows = await fetchJsonOk("/api/new-product-simulations");
      const list = Array.isArray(rows) ? rows : [];
      setSavedNewProductSimulations(
        list.map((r: any) => ({
          ...r,
          status: persistedStatusFromApiRecord(r),
        }))
      );
    } catch (error) {
      console.error("Erro ao buscar snapshots de novo produto:", error);
      alert(error instanceof Error ? error.message : "Não foi possível carregar snapshots salvos.");
    } finally {
      setSavedNewProductLoading(false);
    }
  };

  useEffect(() => {
    fetchSavedNewProductSimulations();
  }, []);

  useEffect(() => {
    if (!newProductReportOpen) return;
    document.body.classList.add("np-report-printing");
    return () => document.body.classList.remove("np-report-printing");
  }, [newProductReportOpen]);

  const handleCompare = async (id: string) => {
    try {
      const data = await fetchJsonOk(`/api/simulations/${id}/compare`);
      setComparing(data);
    } catch (error) {
      console.error("Erro ao comparar:", error);
      alert(error instanceof Error ? error.message : "Não foi possível carregar a comparação.");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await fetchJsonOk("/api/simulations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      setIsModalOpen(false);
      fetchData();
    } catch (error) {
      console.error("Erro ao salvar simulação:", error);
      alert(error instanceof Error ? error.message : "Não foi possível salvar a simulação.");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Excluir esta simulação?")) return;
    try {
      await fetchOk(`/api/simulations/${id}`, { method: "DELETE" });
      fetchData();
    } catch (error) {
      console.error("Erro ao excluir:", error);
      alert(error instanceof Error ? error.message : "Não foi possível excluir a simulação.");
    }
  };

  useEffect(() => {
    if (!comparing) return;
    setCompareViewTab("INTERNAL");
    setCommercialMode("MARGIN");
    setCommercialMarginInput(String(Number(comparing?.simulated?.marginRate ?? 0)));
    setCommercialTargetPriceInput(String(Number(comparing?.simulated?.suggestedPrice ?? 0)));
    setClientCurrentPriceInput(String(Number(comparing?.base?.resultados?.suggestedPrice ?? 0)));
    setClientReadjustPctInput(String(Number(comparing?.delta?.pricePct ?? 0)));
    setClientValidityNote("");
    setClientObservation("");
  }, [comparing]);

  const simulatedCostBase = Number(comparing?.breakdown?.simulated?.costBase ?? comparing?.simulated?.ciu ?? 0);
  const premissasNoMargin = {
    taxRatePct: Number(comparing?.base?.premissas?.taxRate ?? 0),
    commRatePct: Number(comparing?.base?.premissas?.commRate ?? 0),
    otherRatePct: Number(comparing?.base?.premissas?.otherRate ?? 0),
    freight: Number(comparing?.base?.premissas?.freight ?? 0),
  };
  const editedMargin = Number.parseFloat(commercialMarginInput.replace(",", "."));
  const editedTargetPrice = Number.parseFloat(commercialTargetPriceInput.replace(",", "."));

  const commercialProjection = (() => {
    if (!comparing) {
      return {
        price: 0,
        marginRate: 0,
        divisor: 0,
        feasible: false,
      };
    }
    if (commercialMode === "MARGIN") {
      const marginRate = Number.isFinite(editedMargin)
        ? editedMargin
        : Number(comparing?.simulated?.marginRate ?? 0);
      const calc = priceFromCostAndMargin(simulatedCostBase, premissasNoMargin, marginRate);
      return {
        price: calc.price,
        marginRate,
        divisor: calc.divisor,
        feasible: calc.divisor > 0,
      };
    }
    const target = Number.isFinite(editedTargetPrice)
      ? editedTargetPrice
      : Number(comparing?.simulated?.suggestedPrice ?? 0);
    const calc = marginFromCostAndTargetPrice(simulatedCostBase, premissasNoMargin, target);
    return {
      price: target,
      marginRate: calc.marginRatePct,
      divisor:
        1 -
        premissasNoMargin.taxRatePct / 100 -
        premissasNoMargin.commRatePct / 100 -
        premissasNoMargin.otherRatePct / 100 -
        calc.marginRatePct / 100,
      feasible: calc.feasible,
    };
  })();
  const baseSuggestedPrice = Number(comparing?.base?.resultados?.suggestedPrice ?? 0);
  const displayedSuggestedPrice = commercialProjection.price;
  const displayedMarginRate = commercialProjection.marginRate;
  const displayedPriceDelta = displayedSuggestedPrice - baseSuggestedPrice;
  const displayedPriceDeltaPct =
    baseSuggestedPrice > 0 ? (displayedPriceDelta / baseSuggestedPrice) * 100 : 0;
  const displayedMarkup = simulatedCostBase > 0 ? displayedSuggestedPrice / simulatedCostBase : 0;
  const simMp = Number(comparing?.breakdown?.simulated?.mp ?? 0);
  const simHh = Number(comparing?.breakdown?.simulated?.hh ?? 0);
  const simHm = Number(comparing?.breakdown?.simulated?.hm ?? 0);
  const simCostBase = Number(comparing?.breakdown?.simulated?.costBase ?? simulatedCostBase ?? 0);
  const simMpPct = simCostBase > 0 ? (simMp / simCostBase) * 100 : 0;
  const simHhPct = simCostBase > 0 ? (simHh / simCostBase) * 100 : 0;
  const simHmPct = simCostBase > 0 ? (simHm / simCostBase) * 100 : 0;
  const clientCurrentPrice = Number.parseFloat(clientCurrentPriceInput.replace(",", "."));
  const clientReajPct = Number.parseFloat(clientReadjustPctInput.replace(",", "."));
  const clientNewPrice = (Number.isFinite(clientCurrentPrice) ? clientCurrentPrice : 0) * (1 + (Number.isFinite(clientReajPct) ? clientReajPct : 0) / 100);

  const handleCopyClientSummary = async () => {
    const text =
      `Resumo Comercial - ${String(comparing?.base?.product ?? "").trim()}\n` +
      `Preço atual: ${formatCurrency(Number.isFinite(clientCurrentPrice) ? clientCurrentPrice : 0, 5)}\n` +
      `Reajuste: ${formatNumber(Number.isFinite(clientReajPct) ? clientReajPct : 0, 2)}%\n` +
      `Novo preço: ${formatCurrency(clientNewPrice, 5)}\n` +
      `Drivers: MP ${formatNumber(simMpPct, 2)}% | HH ${formatNumber(simHhPct, 2)}% | HM ${formatNumber(simHmPct, 2)}%\n` +
      (clientValidityNote.trim() ? `Vigência: ${clientValidityNote.trim()}\n` : "") +
      (clientObservation.trim() ? `Observação: ${clientObservation.trim()}\n` : "");
    try {
      await navigator.clipboard.writeText(text);
      alert("Resumo comercial copiado.");
    } catch {
      alert("Não foi possível copiar automaticamente.");
    }
  };

  const makeId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const materialSelectOptions = useMemo(() => {
    return materialCatalog.map((m) => {
      const u = effectiveUnitCostFromMaterialPayload({
        currentCost: Number(m.currentCost),
        freight: m.freight != null ? Number(m.freight) : 0,
        standardLoss: m.standardLoss != null ? Number(m.standardLoss) : 0,
        calculations: m.calculations,
      });
      return {
        value: m.id,
        label: `${m.code} — ${m.description}`,
        sublabel: `${m.unit} · ${formatCurrency(u, 2)} eff. por un. (cadastro)`,
        searchTerms: `${m.code} ${m.description} ${m.supplier ?? ""}`,
      };
    });
  }, [materialCatalog]);

  const filteredSavedNewProductSimulations = useMemo(() => {
    const q = savedSnapshotSearch.trim().toLowerCase();
    if (!q) return savedNewProductSimulations;
    return savedNewProductSimulations.filter((item) => {
      const name = (item.name ?? "").toLowerCase();
      const product = (item.productName ?? "").toLowerCase();
      const sku = (item.productSku ?? "").toLowerCase();
      return name.includes(q) || product.includes(q) || sku.includes(q);
    });
  }, [savedNewProductSimulations, savedSnapshotSearch]);

  const updateSimDraftMaterial = (idx: number, field: keyof NewProductMaterialLine, value: string) => {
    setSimDraftMaterials((prev) => {
      const next = [...prev];
      const row = { ...next[idx] } as NewProductMaterialLine & Record<string, unknown>;
      if (field === "quantity" || field === "unitCost") {
        row[field] = Number.parseFloat(value) || 0;
      } else {
        (row as any)[field] = value;
      }
      next[idx] = row as NewProductMaterialLine;
      return next;
    });
  };

  const applyCatalogMaterialToLine = (idx: number, materialId: string) => {
    if (!materialId.trim()) {
      setSimDraftMaterials((prev) => {
        const next = [...prev];
        const prevRow = next[idx];
        if (!prevRow) return prev;
        next[idx] = {
          ...prevRow,
          materialId: null,
          source: "CATALOG",
          code: "",
          description: "",
          unit: "kg",
          unitCost: 0,
        };
        return next;
      });
      return;
    }
    const m = materialCatalog.find((x) => x.id === materialId);
    if (!m) return;
    const unitCost = effectiveUnitCostFromMaterialPayload({
      currentCost: Number(m.currentCost),
      freight: m.freight != null ? Number(m.freight) : 0,
      standardLoss: m.standardLoss != null ? Number(m.standardLoss) : 0,
      calculations: m.calculations,
    });
    setSimDraftMaterials((prev) => {
      const next = [...prev];
      const prevRow = next[idx];
      if (!prevRow) return prev;
      const qty = Number(prevRow.quantity) > 0 ? Number(prevRow.quantity) : 1;
      next[idx] = {
        ...prevRow,
        materialId,
        source: "CATALOG",
        code: m.code,
        description: m.description,
        unit: m.unit,
        unitCost,
        quantity: qty,
      };
      return next;
    });
  };

  const convertSimDraftLineToManual = (idx: number) => {
    setSimDraftMaterials((prev) => {
      const next = [...prev];
      const prevRow = next[idx];
      if (!prevRow) return prev;
      next[idx] = { ...prevRow, source: "MANUAL", materialId: null };
      return next;
    });
  };

  const addSimDraftMaterialLine = (kind: "catalog" | "manual") => {
    setSimDraftMaterials((prev) => [
      ...prev,
      kind === "catalog"
        ? {
            code: "",
            description: "",
            quantity: 1,
            unit: "kg",
            unitCost: 0,
            source: "CATALOG",
            materialId: null,
          }
        : {
            code: "",
            description: "",
            quantity: 0,
            unit: "kg",
            unitCost: 0,
            source: "MANUAL",
            materialId: null,
          },
    ]);
  };

  const removeSimDraftMaterialLine = (idx: number) => {
    setSimDraftMaterials((prev) => {
      if (prev.length <= 1) return prev;
      const next = [...prev];
      next.splice(idx, 1);
      return next;
    });
  };

  const resetSimDraft = () => {
    setEditingSimulatedId(null);
    setSimDraftName("");
    setSimDraftSku("");
    setSimDraftHh("0");
    setSimDraftHm("0");
    setSimDraftMaterials([{ code: "", description: "", quantity: 0, unit: "kg", unitCost: 0, source: "MANUAL", materialId: null }]);
  };

  const simulatedDraftPreview = computeSimulatedComponent({
    id: editingSimulatedId ?? "draft",
    name: simDraftName || "Componente simulado",
    sku: simDraftSku || undefined,
    materials: simDraftMaterials,
    hh: Number.parseFloat(simDraftHh) || 0,
    hm: Number.parseFloat(simDraftHm) || 0,
  });

  const saveSimulatedComponent = () => {
    if (!simDraftName.trim()) {
      alert("Informe um nome para o componente simulado.");
      return;
    }
    const orphanCatalog = simDraftMaterials.some((m) => m.source === "CATALOG" && !m.materialId);
    if (orphanCatalog) {
      alert("Há linha de MP 'da base (Suprimentos)' sem material selecionado. Selecione um item da lista ou remova a linha.");
      return;
    }
    const id = editingSimulatedId ?? makeId();
    const component = computeSimulatedComponent({
      id,
      name: simDraftName.trim(),
      sku: simDraftSku.trim() || undefined,
      materials: simDraftMaterials,
      hh: Number.parseFloat(simDraftHh) || 0,
      hm: Number.parseFloat(simDraftHm) || 0,
    });
    setSimulatedComponents((prev) => {
      const idx = prev.findIndex((x) => x.id === id);
      if (idx < 0) return [...prev, component];
      const next = [...prev];
      next[idx] = component;
      return next;
    });
    resetSimDraft();
  };

  const startEditSimulatedComponent = (id: string) => {
    const target = simulatedComponents.find((x) => x.id === id);
    if (!target) return;
    setEditingSimulatedId(target.id);
    setSimDraftName(target.name);
    setSimDraftSku(target.sku ?? "");
    setSimDraftHh(String(target.hh));
    setSimDraftHm(String(target.hm));
    setSimDraftMaterials(
      target.materials.length > 0
        ? target.materials.map((m) => ({
            code: m.code,
            description: m.description,
            quantity: Number(m.quantity) || 0,
            unit: m.unit,
            unitCost: Number(m.unitCost) || 0,
            materialId: (m as NewProductMaterialLine).materialId ?? null,
            source:
              (m as NewProductMaterialLine).source === "CATALOG" || (m as NewProductMaterialLine).source === "MANUAL"
                ? (m as NewProductMaterialLine).source
                : (m as NewProductMaterialLine).materialId
                  ? "CATALOG"
                  : "MANUAL",
          }))
        : [{ code: "", description: "", quantity: 0, unit: "kg", unitCost: 0, source: "MANUAL", materialId: null }]
    );
    setNewProductInnerTab("SIM_COMPONENTS");
  };

  const removeSimulatedComponent = (id: string) => {
    setSimulatedComponents((prev) => prev.filter((x) => x.id !== id));
    setFinalCompositionLines((prev) =>
      prev.map((line) =>
        line.type === "SIMULATED_COMPONENT" && line.refId === id
          ? { ...line, refId: "" }
          : line
      )
    );
    if (editingSimulatedId === id) resetSimDraft();
  };

  const addCompositionLine = () => {
    setFinalCompositionLines((prev) => [
      ...prev,
      { id: makeId(), type: "EXISTING_COMPONENT", refId: "", quantity: 1 },
    ]);
  };

  const removeCompositionLine = (id: string) => {
    setFinalCompositionLines((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((line) => line.id !== id);
    });
  };

  const updateCompositionLineType = (id: string, type: FinalCompositionLine["type"]) => {
    setFinalCompositionLines((prev) =>
      prev.map((line) => {
        if (line.id !== id) return line;
        if (type === "DIRECT_MATERIAL") {
          return { id: line.id, type, description: "", quantity: 1, unitCost: 0 };
        }
        return { id: line.id, type, refId: "", quantity: 1 };
      })
    );
  };

  const updateCompositionLine = (id: string, field: string, value: string | number) => {
    setFinalCompositionLines((prev) =>
      prev.map((line) => {
        if (line.id !== id) return line;
        const next = { ...line } as any;
        next[field] = field === "quantity" || field === "unitCost" ? Number(value) || 0 : value;
        return next as FinalCompositionLine;
      })
    );
  };

  const ensureExistingComponentCost = async (productId: string) => {
    if (!productId || existingComponentCosts[productId]) return;
    const p = products.find((x) => x.id === productId);
    setExistingCostLoadingId(productId);
    try {
      const analysis = await fetchJsonOk(`/api/products/${productId}/cost-analysis`);
      setExistingComponentCosts((prev) => ({
        ...prev,
        [productId]: {
          id: productId,
          sku: String(p?.sku ?? analysis?.sku ?? ""),
          name: String(p?.name ?? analysis?.name ?? ""),
          mp: Number(analysis?.totalMaterialCost ?? 0),
          hh: Number(analysis?.totalHH_Unit ?? 0),
          hm: Number(analysis?.totalHM_Unit ?? 0),
        },
      }));
    } catch {
      // keep fallback from consolidated cost if detailed endpoint fails
    } finally {
      setExistingCostLoadingId(null);
    }
  };

  const existingComponentsForCalc: ExistingComponentCost[] = products.map((p) => {
    const detailed = existingComponentCosts[p.id];
    if (detailed) return detailed;
    return {
      id: p.id,
      sku: String(p.sku ?? ""),
      name: String(p.name ?? ""),
      mp: Number(p?.costSummary?.totalIndustrialCost ?? 0),
      hh: 0,
      hm: 0,
    };
  });

  const finalProductResult = computeFinalProductFromComposition({
    lines: finalCompositionLines,
    existingComponents: existingComponentsForCalc,
    simulatedComponents,
    mode: finalProductMode,
    desiredMarginPct: Number.parseFloat(finalDesiredMargin) || 0,
    targetPrice: Number.parseFloat(finalTargetPrice) || 0,
  });

  const resolveLineUnitCost = (line: FinalCompositionLine) => {
    if (newProductIsReadOnly && frozenLineValues[line.id]) return frozenLineValues[line.id].unitCost;
    if (line.type === "DIRECT_MATERIAL") return Number(line.unitCost) || 0;
    if (line.type === "SIMULATED_COMPONENT") {
      const s = simulatedComponents.find((x) => x.id === line.refId);
      return Number(s?.breakdown.costBase ?? 0);
    }
    const found = existingComponentsForCalc.find((x) => x.id === line.refId);
    return Number((found?.mp ?? 0) + (found?.hh ?? 0) + (found?.hm ?? 0));
  };

  /** Snapshot persistido congelado (imutável na UI) — única fonte para somente leitura + impressão. */
  const isViewingFrozenSavedSnapshot = activePersistedSimulation?.status === "SAVED";
  const newProductIsReadOnly = isViewingFrozenSavedSnapshot;

  const snapshotSummaryFromRecord = (row: any): PersistedNewProductSimulationSummary => ({
    id: row.id,
    name: row.name,
    status: persistedStatusFromApiRecord(row),
    sourceSimulationId: row.sourceSimulationId ?? null,
    productName: row.productName,
    productSku: row.productSku ?? null,
    savedAt: row.savedAt ?? null,
    createdAt: row.createdAt ?? null,
  });

  const resetNewProductDraftWorkspace = () => {
    setActivePersistedSimulation(null);
    setFrozenLineValues({});
    setFrozenReportSnapshot(null);
    setNewProductReportOpen(false);
    setSnapshotSaveName("");
    setFinalProductName("");
    setFinalProductSku("");
    setFinalProductNotes("");
    setFinalProductMode("MARGIN");
    setFinalDesiredMargin("20");
    setFinalTargetPrice("0");
    setFinalCompositionLines([{ id: "line-initial", type: "EXISTING_COMPONENT", refId: "", quantity: 1 }]);
    setSimulatedComponents([]);
    resetSimDraft();
    setNewProductInnerTab("FINAL_PRODUCT");
  };

  const buildCurrentNewProductSnapshot = (): NewProductSimulationSnapshot => {
    const nowIso = new Date().toISOString();
    const lines = finalCompositionLines.map((line) => {
      const quantity = Number(line.quantity) || 0;
      const unitCost = resolveLineUnitCost(line);
      const lineTotal = unitCost * quantity;
      if (line.type === "DIRECT_MATERIAL") {
        return {
          id: line.id,
          type: line.type,
          description: line.description,
          quantity,
          unitCost,
          lineTotal,
          breakdown: { mp: lineTotal, hh: 0, hm: 0 },
        };
      }
      if (line.type === "SIMULATED_COMPONENT") {
        const sim = simulatedComponents.find((x) => x.id === line.refId);
        return {
          id: line.id,
          type: line.type,
          referenceId: line.refId,
          referenceLabel: sim ? `${sim.sku ? `${sim.sku} — ` : ""}${sim.name}` : "Componente simulado",
          quantity,
          unitCost,
          lineTotal,
          breakdown: {
            mp: (sim?.breakdown.mp ?? 0) * quantity,
            hh: (sim?.breakdown.hh ?? 0) * quantity,
            hm: (sim?.breakdown.hm ?? 0) * quantity,
          },
        };
      }
      const ex = existingComponentsForCalc.find((x) => x.id === line.refId);
      return {
        id: line.id,
        type: line.type,
        referenceId: line.refId,
        referenceLabel: ex ? `${ex.sku ? `${ex.sku} — ` : ""}${ex.name}` : "Componente existente",
        quantity,
        unitCost,
        lineTotal,
        breakdown: {
          mp: (ex?.mp ?? 0) * quantity,
          hh: (ex?.hh ?? 0) * quantity,
          hm: (ex?.hm ?? 0) * quantity,
        },
      };
    });

    return {
      header: {
        simulationName: snapshotSaveName.trim() || finalProductName.trim() || "Simulação sem nome",
        productName: finalProductName.trim() || "Produto simulado",
        productSku: finalProductSku.trim() || undefined,
        notes: finalProductNotes.trim() || undefined,
        createdAt: nowIso,
        savedAt: nowIso,
        origin: "NEW_PRODUCT_SANDBOX",
      },
      commercial: {
        mode: finalProductMode,
        desiredMarginPct: Number.parseFloat(finalDesiredMargin) || 0,
        targetPrice: Number.parseFloat(finalTargetPrice) || 0,
      },
      composition: {
        lines,
        simulatedComponents: simulatedComponents.map((c) => ({
          id: c.id,
          name: c.name,
          sku: c.sku,
          hh: c.hh,
          hm: c.hm,
          costBase: c.breakdown.costBase,
          mp: c.breakdown.mp,
          mpPct: c.breakdown.mpPct,
          hhPct: c.breakdown.hhPct,
          hmPct: c.breakdown.hmPct,
          materials: c.materials.map((m) => ({
            code: m.code,
            description: m.description,
            quantity: m.quantity,
            unit: m.unit,
            unitCost: m.unitCost,
            total: materialLineTotal(m),
            materialId: m.materialId ?? null,
            source:
              m.source === "CATALOG" || m.source === "MANUAL"
                ? m.source
                : m.materialId
                  ? "CATALOG"
                  : "MANUAL",
          })),
        })),
      },
      result: {
        mp: finalProductResult.mp,
        hh: finalProductResult.hh,
        hm: finalProductResult.hm,
        costBase: finalProductResult.costBase,
        mpPct: finalProductResult.mpPct,
        hhPct: finalProductResult.hhPct,
        hmPct: finalProductResult.hmPct,
        price: finalProductResult.price,
        marginPct: finalProductResult.marginPct,
        viability: finalProductResult.viability,
      },
    };
  };

  const loadSnapshotIntoWorkspace = (
    snapshot: NewProductSimulationSnapshot,
    summary: PersistedNewProductSimulationSummary
  ) => {
    setFrozenReportSnapshot(snapshot);
    setActivePersistedSimulation(summary);
    setSnapshotSaveName(summary.name);
    setFinalProductName(snapshot.header.productName ?? "");
    setFinalProductSku(snapshot.header.productSku ?? "");
    setFinalProductNotes(snapshot.header.notes ?? "");
    setFinalProductMode(snapshot.commercial.mode ?? "MARGIN");
    setFinalDesiredMargin(String(Number(snapshot.commercial.desiredMarginPct ?? 0)));
    setFinalTargetPrice(String(Number(snapshot.commercial.targetPrice ?? 0)));
    const loadedLines: FinalCompositionLine[] = snapshot.composition.lines.map((line, idx) => {
      if (line.type === "DIRECT_MATERIAL") {
        return {
          id: line.id || `line-${idx}`,
          type: "DIRECT_MATERIAL",
          description: line.description ?? "",
          quantity: Number(line.quantity) || 0,
          unitCost: Number(line.unitCost) || 0,
        };
      }
      return {
        id: line.id || `line-${idx}`,
        type: line.type,
        refId: line.referenceId ?? "",
        quantity: Number(line.quantity) || 0,
      };
    });
    setFinalCompositionLines(
      loadedLines.length > 0
        ? loadedLines
        : [{ id: "line-initial", type: "EXISTING_COMPONENT", refId: "", quantity: 1 }]
    );
    if (summary.status !== "SAVED") {
      loadedLines.forEach((line) => {
        if (line.type === "EXISTING_COMPONENT" && line.refId) {
          ensureExistingComponentCost(line.refId);
        }
      });
    }
    setFrozenLineValues(
      summary.status === "SAVED"
        ? Object.fromEntries(
            snapshot.composition.lines.map((line, idx) => [
              line.id || `line-${idx}`,
              {
                unitCost: Number(line.unitCost) || 0,
                lineTotal: Number(line.lineTotal) || 0,
              },
            ])
          )
        : {}
    );
    setSimulatedComponents(
      snapshot.composition.simulatedComponents.map((item) => ({
        id: item.id,
        name: item.name,
        sku: item.sku,
        hh: Number(item.hh) || 0,
        hm: Number(item.hm) || 0,
        materials: item.materials.map((m) => ({
          code: m.code,
          description: m.description,
          quantity: Number(m.quantity) || 0,
          unit: m.unit,
          unitCost: Number(m.unitCost) || 0,
          materialId: m.materialId ?? null,
          source:
            m.source === "CATALOG" || m.source === "MANUAL"
              ? m.source
              : m.materialId
                ? "CATALOG"
                : "MANUAL",
        })),
        breakdown: {
          mp: Number(item.mp) || 0,
          hh: Number(item.hh) || 0,
          hm: Number(item.hm) || 0,
          costBase: Number(item.costBase) || 0,
          mpPct: Number(item.mpPct) || 0,
          hhPct: Number(item.hhPct) || 0,
          hmPct: Number(item.hmPct) || 0,
        },
      }))
    );
    resetSimDraft();
    setNewProductInnerTab("VIABILITY");
  };

  const handleSaveNewProductSnapshot = async () => {
    if (newProductIsReadOnly) return;
    const snapshot = buildCurrentNewProductSnapshot();
    try {
      const created = await fetchJsonOk("/api/new-product-simulations/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          simulationName: snapshotSaveName.trim() || snapshot.header.simulationName,
          origin: "NEW_PRODUCT_SANDBOX",
          snapshot,
        }),
      });
      const summary = snapshotSummaryFromRecord(created);
      loadSnapshotIntoWorkspace(
        created.snapshot as NewProductSimulationSnapshot,
        { ...summary, status: "SAVED" }
      );
      fetchSavedNewProductSimulations();
      alert("Snapshot salvo com sucesso. Registro agora está congelado.");
    } catch (error) {
      console.error("Erro ao salvar snapshot:", error);
      alert(error instanceof Error ? error.message : "Não foi possível salvar snapshot.");
    }
  };

  const handleOpenSavedSnapshot = async (id: string) => {
    try {
      const row = (await fetchJsonOk(`/api/new-product-simulations/${id}`)) as PersistedNewProductSimulation;
      const summary = snapshotSummaryFromRecord(row);
      loadSnapshotIntoWorkspace(row.snapshot as NewProductSimulationSnapshot, summary);
    } catch (error) {
      console.error("Erro ao abrir snapshot salvo:", error);
      alert(error instanceof Error ? error.message : "Não foi possível abrir o snapshot.");
    }
  };

  const handleDeleteSavedSnapshot = async (id: string) => {
    if (
      !confirm(
        "Excluir permanentemente este registro da biblioteca? Esta ação não pode ser desfeita."
      )
    ) {
      return;
    }
    try {
      await fetchOk(`/api/new-product-simulations/${id}`, { method: "DELETE" });
      if (activePersistedSimulation?.id === id) {
        resetNewProductDraftWorkspace();
      }
      await fetchSavedNewProductSimulations();
    } catch (error) {
      console.error("Erro ao excluir snapshot:", error);
      alert(error instanceof Error ? error.message : "Não foi possível excluir o registro.");
    }
  };

  const handleCloneSavedSnapshot = async (id: string) => {
    try {
      const row = (await fetchJsonOk(`/api/new-product-simulations/${id}/clone`, {
        method: "POST",
      })) as PersistedNewProductSimulation;
      loadSnapshotIntoWorkspace(
        row.snapshot,
        { ...snapshotSummaryFromRecord(row), status: "DRAFT" }
      );
      fetchSavedNewProductSimulations();
    } catch (error) {
      console.error("Erro ao clonar snapshot:", error);
      alert(error instanceof Error ? error.message : "Não foi possível clonar o snapshot.");
    }
  };

  return (
    <div className="space-y-6" data-tour="simulation-root">
      {/* Header Actions */}
      <div
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-4"
        data-tour="simulation-header"
      >
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-bold tracking-tight">Cenários e Simulações</h2>
          <p className="text-xs text-muted-foreground">Teste o impacto de variações de mercado sem alterar seus dados oficiais.</p>
        </div>
        <div className="flex items-center gap-2">
          <TourHelpButton onClick={() => setTourOpen(true)} />
          {workspaceTab === "SCENARIOS" && (
            <button
              onClick={() => setIsModalOpen(true)}
              className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg font-medium hover:opacity-90 transition-opacity text-sm"
            >
              <Plus className="h-4 w-4" />
              Novo Cenário
            </button>
          )}
        </div>
      </div>

      <div className="inline-flex rounded-xl border border-border p-1 bg-accent/20">
        <button
          type="button"
          onClick={() => setWorkspaceTab("SCENARIOS")}
          className={cn(
            "px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors",
            workspaceTab === "SCENARIOS"
              ? "bg-card text-primary shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          Cenários existentes
        </button>
        <button
          type="button"
          onClick={() => setWorkspaceTab("NEW_PRODUCT")}
          className={cn(
            "px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors",
            workspaceTab === "NEW_PRODUCT"
              ? "bg-card text-primary shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          Simular Novo Produto
        </button>
      </div>

      {/* Simulations Grid */}
      {workspaceTab === "SCENARIOS" && (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6" data-tour="simulation-grid">
        {loading ? (
          <div className="col-span-full p-12 text-center">
            <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
          </div>
        ) : simulations.length === 0 ? (
          <div className="col-span-full p-12 text-center border-2 border-dashed border-border rounded-2xl text-muted-foreground">
            Nenhum cenário de simulação criado.
          </div>
        ) : (
          simulations.map((sim) => (
            <motion.div 
              key={sim.id}
              className="bg-card rounded-2xl border border-border overflow-hidden shadow-sm hover:shadow-md transition-all group"
            >
              <div className="p-5 border-b border-border bg-accent/30 flex items-start justify-between">
                <div>
                  <h3 className="font-bold text-sm">{sim.name}</h3>
                  <p className="text-[10px] text-muted-foreground line-clamp-1">{sim.description || "Sem descrição"}</p>
                </div>
                <button 
                  onClick={() => handleDelete(sim.id)}
                  className="p-1.5 rounded-lg hover:bg-red-50 text-muted-foreground hover:text-red-500 transition-colors"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
              
              <div className="p-5 space-y-4">
                <div className="grid grid-cols-2 gap-2">
                  {Number(sim.materialAdj) !== 0 && (
                    <div className="flex items-center gap-1.5 text-[10px] font-bold text-orange-600">
                      <Layers className="h-3 w-3" /> MP: {sim.materialAdj > 0 ? "+" : ""}{sim.materialAdj}%
                    </div>
                  )}
                  {Number(sim.laborAdj) !== 0 && (
                    <div className="flex items-center gap-1.5 text-[10px] font-bold text-blue-600">
                      <Users className="h-3 w-3" /> HH: {sim.laborAdj > 0 ? "+" : ""}{sim.laborAdj}%
                    </div>
                  )}
                  {Number(sim.indirectAdj) !== 0 && (
                    <div className="flex items-center gap-1.5 text-[10px] font-bold text-violet-600">
                      <Cpu className="h-3 w-3" /> HM: {sim.indirectAdj > 0 ? "+" : ""}{sim.indirectAdj}%
                    </div>
                  )}
                  {Number(sim.efficiencyAdj) !== 0 && (
                    <div className="flex items-center gap-1.5 text-[10px] font-bold text-green-600">
                      <Zap className="h-3 w-3" /> Efic: {sim.efficiencyAdj > 0 ? "+" : ""}{sim.efficiencyAdj}%
                    </div>
                  )}
                </div>

                <button 
                  onClick={() => handleCompare(sim.id)}
                  className="w-full py-2 rounded-xl bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 transition-all flex items-center justify-center gap-2"
                >
                  <Calculator className="h-3 w-3" />
                  Ver Comparativo
                </button>
              </div>
            </motion.div>
          ))
        )}
      </div>
      )}

      {workspaceTab === "NEW_PRODUCT" && (
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:gap-6">
          <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <p
                className={cn(
                  "text-xs font-semibold rounded-lg px-3 py-2 w-fit max-w-full text-pretty",
                  newProductIsReadOnly
                    ? "bg-amber-500/10 text-amber-700"
                    : activePersistedSimulation?.status === "DRAFT"
                      ? "bg-blue-500/10 text-blue-700"
                      : "bg-emerald-500/10 text-emerald-700"
                )}
              >
                {newProductIsReadOnly
                  ? "Snapshot salvo · somente leitura"
                  : activePersistedSimulation?.status === "DRAFT"
                    ? "Cópia em rascunho (editável)"
                    : "Simulação em edição (não persistida)"}
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                {isViewingFrozenSavedSnapshot && frozenReportSnapshot && (
                  <>
                    <button
                      type="button"
                      onClick={() => setNewProductReportOpen(true)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-semibold hover:bg-accent transition-colors"
                    >
                      <FileText className="h-3.5 w-3.5" />
                      Ver relatório
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setNewProductReportOpen(true);
                        setTimeout(() => window.print(), 400);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-semibold hover:bg-accent transition-colors"
                    >
                      <Printer className="h-3.5 w-3.5" />
                      Imprimir relatório
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={resetNewProductDraftWorkspace}
                  className="px-3 py-1.5 rounded-lg border border-border text-xs font-semibold hover:bg-accent transition-colors"
                >
                  Novo draft
                </button>
                <button
                  type="button"
                  disabled={newProductIsReadOnly}
                  onClick={handleSaveNewProductSnapshot}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors",
                    newProductIsReadOnly
                      ? "bg-accent text-muted-foreground cursor-not-allowed"
                      : "bg-primary text-primary-foreground hover:opacity-90"
                  )}
                >
                  <Save className="h-3.5 w-3.5" />
                  Salvar simulação
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="space-y-1 md:col-span-2">
                <span className="text-[10px] font-bold uppercase text-muted-foreground">Nome da simulação (snapshot)</span>
                <input
                  type="text"
                  className="w-full p-2.5 rounded-lg border border-border bg-background text-sm"
                  value={snapshotSaveName}
                  onChange={(e) => setSnapshotSaveName(e.target.value)}
                  placeholder="Ex: Cenário novo produto cliente X - abril/2026"
                  disabled={newProductIsReadOnly}
                />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] font-bold uppercase text-muted-foreground">Nome do produto final (sandbox)</span>
                <input
                  type="text"
                  className="w-full p-2.5 rounded-lg border border-border bg-background text-sm"
                  value={finalProductName}
                  onChange={(e) => setFinalProductName(e.target.value)}
                  placeholder="Ex: Conjunto Técnico X"
                  disabled={newProductIsReadOnly}
                />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] font-bold uppercase text-muted-foreground">SKU provisório</span>
                <input
                  type="text"
                  className="w-full p-2.5 rounded-lg border border-border bg-background text-sm"
                  value={finalProductSku}
                  onChange={(e) => setFinalProductSku(e.target.value)}
                  placeholder="Ex: NP-2026-001"
                  disabled={newProductIsReadOnly}
                />
              </label>
              <label className="space-y-1 md:col-span-2">
                <span className="text-[10px] font-bold uppercase text-muted-foreground">Observações</span>
                <textarea
                  className="w-full p-2.5 rounded-lg border border-border bg-background text-sm min-h-20"
                  value={finalProductNotes}
                  onChange={(e) => setFinalProductNotes(e.target.value)}
                  placeholder="Observações do cenário (opcional)"
                  disabled={newProductIsReadOnly}
                />
              </label>
            </div>

            <div className="inline-flex rounded-xl border border-border p-1 bg-accent/20">
              <button
                type="button"
                onClick={() => setNewProductInnerTab("FINAL_PRODUCT")}
                className={cn(
                  "px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors",
                  newProductInnerTab === "FINAL_PRODUCT" ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                Produto final
              </button>
              <button
                type="button"
                onClick={() => setNewProductInnerTab("SIM_COMPONENTS")}
                className={cn(
                  "px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors",
                  newProductInnerTab === "SIM_COMPONENTS" ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                Componentes simulados
              </button>
              <button
                type="button"
                onClick={() => setNewProductInnerTab("VIABILITY")}
                className={cn(
                  "px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors",
                  newProductInnerTab === "VIABILITY" ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                Resumo de viabilidade
              </button>
            </div>
          </div>

          {newProductInnerTab === "FINAL_PRODUCT" && (
            <fieldset disabled={newProductIsReadOnly} className="rounded-2xl border border-border bg-card p-5 space-y-4 disabled:opacity-95">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-black uppercase tracking-wider text-muted-foreground">Composição do produto final</h3>
                <button
                  type="button"
                  onClick={addCompositionLine}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-semibold hover:bg-accent transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Adicionar linha
                </button>
              </div>

              <div className="space-y-2">
                {finalCompositionLines.map((line) => {
                  const unitCost = resolveLineUnitCost(line);
                  const lineTotal = newProductIsReadOnly && frozenLineValues[line.id]
                    ? frozenLineValues[line.id].lineTotal
                    : unitCost * (Number(line.quantity) || 0);
                  return (
                    <div key={line.id} className="grid grid-cols-12 gap-2 items-end rounded-lg border border-border p-2.5 bg-accent/10">
                      <label className="col-span-2 space-y-1">
                        <span className="text-[9px] font-bold uppercase text-muted-foreground">Tipo</span>
                        <select
                          className="w-full p-2 rounded border border-border bg-background text-xs"
                          value={line.type}
                          onChange={(e) => updateCompositionLineType(line.id, e.target.value as FinalCompositionLine["type"])}
                        >
                          <option value="EXISTING_COMPONENT">Componente existente</option>
                          <option value="SIMULATED_COMPONENT">Componente simulado</option>
                          <option value="DIRECT_MATERIAL">Material direto</option>
                        </select>
                      </label>

                      {line.type === "EXISTING_COMPONENT" && (
                        <div className="col-span-4 space-y-1">
                          <span className="text-[9px] font-bold uppercase text-muted-foreground">Item existente</span>
                          <SearchableSelect
                            placeholder="Selecione componente existente..."
                            options={products.map((p: any) => ({
                              value: p.id,
                              label: `${p.sku} — ${p.name}`,
                              sublabel: p.type === "COMPONENT" ? "Componente cadastrado" : "Produto cadastrado",
                              searchTerms: `${p.sku} ${p.name}`,
                            }))}
                            value={line.refId}
                            disabled={newProductIsReadOnly}
                            onChange={(val) => {
                              updateCompositionLine(line.id, "refId", val);
                              ensureExistingComponentCost(val);
                            }}
                          />
                        </div>
                      )}

                      {line.type === "SIMULATED_COMPONENT" && (
                        <div className="col-span-4 space-y-1">
                          <span className="text-[9px] font-bold uppercase text-muted-foreground">Componente simulado</span>
                          <select
                            className="w-full p-2 rounded border border-border bg-background text-xs"
                            value={line.refId}
                            disabled={newProductIsReadOnly}
                            onChange={(e) => updateCompositionLine(line.id, "refId", e.target.value)}
                          >
                            <option value="">Selecione...</option>
                            {simulatedComponents.map((item) => (
                              <option key={item.id} value={item.id}>
                                {(item.sku ? `${item.sku} — ` : "") + item.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      {line.type === "DIRECT_MATERIAL" && (
                        <label className="col-span-4 space-y-1">
                          <span className="text-[9px] font-bold uppercase text-muted-foreground">Descrição do material</span>
                          <input
                            type="text"
                            className="w-full p-2 rounded border border-border bg-background text-xs"
                            value={line.description}
                            disabled={newProductIsReadOnly}
                            onChange={(e) => updateCompositionLine(line.id, "description", e.target.value)}
                          />
                        </label>
                      )}

                      <label className="col-span-2 space-y-1">
                        <span className="text-[9px] font-bold uppercase text-muted-foreground">Quantidade</span>
                        <input
                          type="number"
                          step="0.00001"
                          className="w-full p-2 rounded border border-border bg-background text-xs"
                          value={line.quantity}
                          disabled={newProductIsReadOnly}
                          onChange={(e) => updateCompositionLine(line.id, "quantity", e.target.value)}
                        />
                      </label>

                      {line.type === "DIRECT_MATERIAL" ? (
                        <label className="col-span-2 space-y-1">
                          <span className="text-[9px] font-bold uppercase text-muted-foreground">Custo un.</span>
                          <input
                            type="number"
                            step="0.00001"
                            className="w-full p-2 rounded border border-border bg-background text-xs"
                            value={line.unitCost}
                            disabled={newProductIsReadOnly}
                            onChange={(e) => updateCompositionLine(line.id, "unitCost", e.target.value)}
                          />
                        </label>
                      ) : (
                        <div className="col-span-2 space-y-1">
                          <span className="text-[9px] font-bold uppercase text-muted-foreground">Custo un.</span>
                          <div className="w-full p-2 rounded border border-border bg-background text-xs font-semibold tabular-nums">
                            {formatCurrency(unitCost, 5)}
                          </div>
                        </div>
                      )}

                      <div className="col-span-2 flex items-center justify-between gap-2">
                        <div>
                          <p className="text-[9px] font-bold uppercase text-muted-foreground">Total linha</p>
                          <p className="text-xs font-bold tabular-nums">{formatCurrency(lineTotal, 5)}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeCompositionLine(line.id)}
                          className="p-1.5 rounded hover:bg-red-50 text-muted-foreground hover:text-red-600 transition-colors"
                          title="Remover linha"
                          disabled={newProductIsReadOnly}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      {line.type === "EXISTING_COMPONENT" && line.refId && (
                        <div className="col-span-12 text-[10px] text-muted-foreground">
                          {existingCostLoadingId === line.refId
                            ? "Carregando composição detalhada MP/HH/HM do componente existente..."
                            : existingComponentCosts[line.refId]
                              ? "Composição do componente existente carregada com custo detalhado (MP + HH + HM)."
                              : "Usando custo consolidado atual; ao selecionar novamente, o sistema tenta buscar composição detalhada."}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </fieldset>
          )}

          {newProductInnerTab === "SIM_COMPONENTS" && (
            <fieldset disabled={newProductIsReadOnly} className="grid grid-cols-1 xl:grid-cols-3 gap-6 disabled:opacity-95">
              <div className="xl:col-span-2 rounded-2xl border border-border bg-card p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-black uppercase tracking-wider text-muted-foreground">
                    {editingSimulatedId ? "Editar componente simulado" : "Novo componente simulado"}
                  </h3>
                  {editingSimulatedId && (
                    <button
                      type="button"
                      onClick={resetSimDraft}
                      className="px-3 py-1.5 rounded-lg border border-border text-xs font-semibold hover:bg-accent transition-colors"
                    >
                      Cancelar edição
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <label className="space-y-1">
                    <span className="text-[10px] font-bold uppercase text-muted-foreground">Nome provisório</span>
                    <input
                      type="text"
                      className="w-full p-2.5 rounded-lg border border-border bg-background text-sm"
                      value={simDraftName}
                      onChange={(e) => setSimDraftName(e.target.value)}
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[10px] font-bold uppercase text-muted-foreground">SKU provisório (opcional)</span>
                    <input
                      type="text"
                      className="w-full p-2.5 rounded-lg border border-border bg-background text-sm"
                      value={simDraftSku}
                      onChange={(e) => setSimDraftSku(e.target.value)}
                    />
                  </label>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div>
                    <h4 className="text-xs font-black uppercase tracking-wider text-muted-foreground">Matérias-primas do componente</h4>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      Priorize materiais do cadastro de Suprimentos (custo efetivo alinhado ao sistema). Uso manual é exceção.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => addSimDraftMaterialLine("catalog")}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-primary/30 bg-primary/5 text-xs font-semibold text-primary hover:bg-primary/10 transition-colors"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Da base (Suprimentos)
                    </button>
                    <button
                      type="button"
                      onClick={() => addSimDraftMaterialLine("manual")}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-semibold hover:bg-accent transition-colors"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Linha manual
                    </button>
                  </div>
                </div>

                <div className="space-y-3">
                  {simDraftMaterials.map((line, idx) => {
                    const mode = line.source === "CATALOG" ? "catalog" : "manual";
                    const catalogIncomplete = mode === "catalog" && !line.materialId;
                    const manualWarn = mode === "manual" && (Number(line.unitCost) === 0 || !Number.isFinite(Number(line.unitCost)));
                    const identityLocked = mode === "catalog" && Boolean(line.materialId);
                    return (
                      <div
                        key={`sim-mp-${idx}-${line.materialId ?? "none"}`}
                        className={cn(
                          "rounded-xl border p-3 space-y-2 bg-accent/10",
                          catalogIncomplete ? "border-amber-400/60" : "border-border",
                          manualWarn ? "border-amber-500/50" : null
                        )}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span
                            className={cn(
                              "text-[10px] font-bold uppercase px-2 py-0.5 rounded-md",
                              mode === "catalog" ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
                            )}
                          >
                            {mode === "catalog" ? "Cadastro Suprimentos" : "Manual (sandbox)"}
                          </span>
                          {mode === "catalog" && line.materialId ? (
                            <button
                              type="button"
                              disabled={newProductIsReadOnly}
                              onClick={() => convertSimDraftLineToManual(idx)}
                              className="text-[10px] font-semibold text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                            >
                              Trocar para manual
                            </button>
                          ) : null}
                        </div>

                        {mode === "catalog" ? (
                          <div className="space-y-1">
                            <span className="text-[9px] font-bold uppercase text-muted-foreground">Material do cadastro</span>
                            <SearchableSelect
                              options={materialSelectOptions}
                              value={line.materialId ?? ""}
                              onChange={(id) => applyCatalogMaterialToLine(idx, id)}
                              placeholder="Buscar por código, descrição..."
                              emptyMessage="Nenhum material encontrado."
                              disabled={newProductIsReadOnly}
                              className="text-xs"
                            />
                            {catalogIncomplete ? (
                              <p className="text-[10px] text-amber-800">Selecione um material da lista para aplicar custo e identificação do cadastro.</p>
                            ) : null}
                          </div>
                        ) : null}

                        <div className="grid grid-cols-12 gap-2 items-end">
                          <label className="col-span-2 space-y-1">
                            <span className="text-[9px] font-bold uppercase text-muted-foreground">Código</span>
                            <input
                              type="text"
                              className={cn(
                                "w-full p-2 rounded border border-border bg-background text-xs",
                                identityLocked && "bg-muted/50 text-muted-foreground"
                              )}
                              value={line.code}
                              disabled={newProductIsReadOnly || identityLocked}
                              onChange={(e) => updateSimDraftMaterial(idx, "code", e.target.value)}
                            />
                          </label>
                          <label className="col-span-3 space-y-1">
                            <span className="text-[9px] font-bold uppercase text-muted-foreground">Descrição</span>
                            <input
                              type="text"
                              className={cn(
                                "w-full p-2 rounded border border-border bg-background text-xs",
                                identityLocked && "bg-muted/50 text-muted-foreground"
                              )}
                              value={line.description}
                              disabled={newProductIsReadOnly || identityLocked}
                              onChange={(e) => updateSimDraftMaterial(idx, "description", e.target.value)}
                            />
                          </label>
                          <label className="col-span-2 space-y-1">
                            <span className="text-[9px] font-bold uppercase text-muted-foreground">Qtd</span>
                            <input
                              type="number"
                              step="0.00001"
                              className="w-full p-2 rounded border border-border bg-background text-xs"
                              value={line.quantity}
                              disabled={newProductIsReadOnly}
                              onChange={(e) => updateSimDraftMaterial(idx, "quantity", e.target.value)}
                            />
                          </label>
                          <label className="col-span-1 space-y-1">
                            <span className="text-[9px] font-bold uppercase text-muted-foreground">Un</span>
                            <input
                              type="text"
                              className={cn(
                                "w-full p-2 rounded border border-border bg-background text-xs",
                                identityLocked && "bg-muted/50 text-muted-foreground"
                              )}
                              value={line.unit}
                              disabled={newProductIsReadOnly || identityLocked}
                              onChange={(e) => updateSimDraftMaterial(idx, "unit", e.target.value)}
                            />
                          </label>
                          <label className="col-span-2 space-y-1">
                            <span className="text-[9px] font-bold uppercase text-muted-foreground">Custo un. (R$)</span>
                            <input
                              type="number"
                              step="0.00001"
                              className="w-full p-2 rounded border border-border bg-background text-xs"
                              value={line.unitCost}
                              disabled={newProductIsReadOnly}
                              onChange={(e) => updateSimDraftMaterial(idx, "unitCost", e.target.value)}
                            />
                            {mode === "catalog" && line.materialId ? (
                              <p className="text-[9px] text-muted-foreground">Pode ajustar o custo unitário para cenário; valor inicial vem do cadastro.</p>
                            ) : null}
                          </label>
                          <div className="col-span-2 flex items-center justify-between gap-2">
                            <div>
                              <p className="text-[9px] font-bold uppercase text-muted-foreground">Total</p>
                              <p className="text-xs font-bold tabular-nums">{formatCurrency(materialLineTotal(line), 5)}</p>
                            </div>
                            <button
                              type="button"
                              disabled={newProductIsReadOnly}
                              onClick={() => removeSimDraftMaterialLine(idx)}
                              className="p-1.5 rounded hover:bg-red-50 text-muted-foreground hover:text-red-600 transition-colors"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                        {manualWarn ? (
                          <p className="text-[10px] text-amber-800">
                            Custo unitário zero ou inválido: a linha não soma MP até você informar um valor.
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <label className="space-y-1">
                    <span className="text-[10px] font-bold uppercase text-muted-foreground">HH (R$)</span>
                    <input type="number" step="0.00001" className="w-full p-2.5 rounded-lg border border-border bg-background text-sm" value={simDraftHh} onChange={(e) => setSimDraftHh(e.target.value)} />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[10px] font-bold uppercase text-muted-foreground">HM (R$)</span>
                    <input type="number" step="0.00001" className="w-full p-2.5 rounded-lg border border-border bg-background text-sm" value={simDraftHm} onChange={(e) => setSimDraftHm(e.target.value)} />
                  </label>
                </div>

                <button
                  type="button"
                  onClick={saveSimulatedComponent}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 transition-opacity"
                >
                  <Save className="h-3.5 w-3.5" />
                  {editingSimulatedId ? "Atualizar componente" : "Salvar componente simulado"}
                </button>
              </div>

              <div className="space-y-4">
                <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
                  <h4 className="text-xs font-black uppercase tracking-wider text-muted-foreground">Pré-visualização</h4>
                  <MetricCard label="MP" value={formatCurrency(simulatedDraftPreview.breakdown.mp, 5)} />
                  <MetricCard label="HH" value={formatCurrency(simulatedDraftPreview.breakdown.hh, 5)} />
                  <MetricCard label="HM" value={formatCurrency(simulatedDraftPreview.breakdown.hm, 5)} />
                  <MetricCard label="Custo total" value={formatCurrency(simulatedDraftPreview.breakdown.costBase, 5)} />
                  <p className="text-xs text-muted-foreground">
                    MP {formatNumber(simulatedDraftPreview.breakdown.mpPct, 2)}% • HH {formatNumber(simulatedDraftPreview.breakdown.hhPct, 2)}% • HM {formatNumber(simulatedDraftPreview.breakdown.hmPct, 2)}%
                  </p>
                </div>

                <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
                  <h4 className="text-xs font-black uppercase tracking-wider text-muted-foreground">Componentes simulados salvos</h4>
                  {simulatedComponents.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Nenhum componente simulado criado.</p>
                  ) : (
                    simulatedComponents.map((item) => (
                      <div key={item.id} className="rounded-lg border border-border bg-accent/10 p-3 space-y-2">
                        <p className="text-xs font-black">{(item.sku ? `${item.sku} — ` : "") + item.name}</p>
                        <p className="text-[11px] text-muted-foreground">
                          Custo: {formatCurrency(item.breakdown.costBase, 5)} | MP {formatNumber(item.breakdown.mpPct, 2)}% | HH {formatNumber(item.breakdown.hhPct, 2)}% | HM {formatNumber(item.breakdown.hmPct, 2)}%
                        </p>
                        <div className="flex items-center gap-2">
                          <button type="button" className="px-2 py-1 rounded border border-border text-[11px] font-semibold hover:bg-accent" onClick={() => startEditSimulatedComponent(item.id)}>Editar</button>
                          <button type="button" className="px-2 py-1 rounded border border-red-200 text-[11px] font-semibold text-red-700 hover:bg-red-50" onClick={() => removeSimulatedComponent(item.id)}>Remover</button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </fieldset>
          )}

          {newProductInnerTab === "VIABILITY" && (
            <fieldset disabled={newProductIsReadOnly} className="grid grid-cols-1 xl:grid-cols-3 gap-6 disabled:opacity-95">
              <div className="xl:col-span-2 rounded-2xl border border-border bg-card p-5 space-y-4">
                <h3 className="text-sm font-black uppercase tracking-wider text-muted-foreground">Comercial do produto final</h3>
                <div className="inline-flex rounded-lg border border-border p-1 bg-accent/20">
                  <button type="button" onClick={() => setFinalProductMode("MARGIN")} className={cn("px-3 py-1.5 text-xs font-semibold rounded-md transition-colors", finalProductMode === "MARGIN" ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground")}>Margem desejada</button>
                  <button type="button" onClick={() => setFinalProductMode("TARGET_PRICE")} className={cn("px-3 py-1.5 text-xs font-semibold rounded-md transition-colors", finalProductMode === "TARGET_PRICE" ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground")}>Preço alvo</button>
                </div>
                {finalProductMode === "MARGIN" ? (
                  <label className="space-y-1">
                    <span className="text-[10px] font-bold uppercase text-muted-foreground">Margem desejada (%)</span>
                    <input type="number" step="0.00001" className="w-full p-2.5 rounded-lg border border-border bg-background text-sm" value={finalDesiredMargin} onChange={(e) => setFinalDesiredMargin(e.target.value)} />
                  </label>
                ) : (
                  <label className="space-y-1">
                    <span className="text-[10px] font-bold uppercase text-muted-foreground">Preço alvo (R$)</span>
                    <input type="number" step="0.00001" className="w-full p-2.5 rounded-lg border border-border bg-background text-sm" value={finalTargetPrice} onChange={(e) => setFinalTargetPrice(e.target.value)} />
                  </label>
                )}
                <div className="text-xs text-muted-foreground rounded-lg border border-border bg-accent/10 p-3">
                  Custo base utilizado no simulador: MP + HH + HM. Sem CIF e sem OPEX nesta fase de sandbox.
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
                <h3 className="text-sm font-black uppercase tracking-wider text-muted-foreground">Resumo de viabilidade</h3>
                <div className="grid grid-cols-2 gap-3">
                  <MetricCard label="MP total" value={formatCurrency(finalProductResult.mp, 5)} />
                  <MetricCard label="HH total" value={formatCurrency(finalProductResult.hh, 5)} />
                  <MetricCard label="HM total" value={formatCurrency(finalProductResult.hm, 5)} />
                  <MetricCard label="Custo base" value={formatCurrency(finalProductResult.costBase, 5)} />
                </div>
                <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
                  <p className="text-[10px] font-bold uppercase text-primary/80">Preço sugerido</p>
                  <p className="text-xl font-black text-primary">{formatCurrency(finalProductResult.price, 5)}</p>
                  <p className="text-[11px] text-muted-foreground">
                    Margem resultante: <b>{formatNumber(finalProductResult.marginPct, 2)}%</b>
                  </p>
                </div>
                <div className="space-y-2">
                  {[
                    { label: "MP", pct: finalProductResult.mpPct, bar: "bg-orange-500/80" },
                    { label: "HH", pct: finalProductResult.hhPct, bar: "bg-blue-500/80" },
                    { label: "HM", pct: finalProductResult.hmPct, bar: "bg-violet-500/80" },
                  ].map((row) => (
                    <div key={row.label} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold">{row.label}</span>
                        <span className="tabular-nums font-semibold">{formatNumber(row.pct, 2)}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-accent overflow-hidden">
                        <div className={cn("h-full rounded-full", row.bar)} style={{ width: `${Math.max(0, Math.min(100, row.pct))}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
                <p
                  className={cn(
                    "text-xs font-semibold rounded-lg px-3 py-2",
                    finalProductResult.viability === "VIAVEL"
                      ? "bg-green-500/10 text-green-700"
                      : finalProductResult.viability === "ATENCAO"
                        ? "bg-amber-500/10 text-amber-700"
                        : "bg-red-500/10 text-red-700"
                  )}
                >
                  {finalProductResult.viability === "VIAVEL"
                    ? "Viável"
                    : finalProductResult.viability === "ATENCAO"
                      ? "Atenção"
                      : "Inviável"}
                </p>
              </div>
            </fieldset>
          )}
          </div>

          <aside
            className={cn(
              "w-full shrink-0 xl:w-[360px]",
              "xl:sticky xl:top-4 xl:self-start",
              "max-xl:order-last"
            )}
            aria-label="Snapshots salvos"
          >
            <div className="flex min-h-0 max-h-[min(52vh,420px)] flex-col overflow-hidden rounded-2xl border border-border bg-card p-4 shadow-sm xl:max-h-[calc(100vh-8rem)]">
              <div className="mb-3 flex flex-shrink-0 flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-xs font-black uppercase tracking-wider text-muted-foreground">
                    Snapshots salvos
                  </h3>
                  <p className="text-[10px] text-muted-foreground">Biblioteca secundária</p>
                </div>
                <button
                  type="button"
                  onClick={fetchSavedNewProductSimulations}
                  className="shrink-0 px-3 py-1.5 rounded-lg border border-border text-xs font-semibold hover:bg-accent transition-colors"
                >
                  Atualizar lista
                </button>
              </div>
              <label className="mb-3 flex flex-shrink-0 items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5">
                <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <input
                  type="search"
                  className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                  placeholder="Filtrar por nome ou produto..."
                  value={savedSnapshotSearch}
                  onChange={(e) => setSavedSnapshotSearch(e.target.value)}
                />
              </label>
              <div className="min-h-0 flex-1 overflow-y-auto pr-0.5 xl:min-h-[12rem]">
                {savedNewProductLoading ? (
                  <p className="text-xs text-muted-foreground">Carregando snapshots...</p>
                ) : filteredSavedNewProductSimulations.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {savedNewProductSimulations.length === 0
                      ? "Nenhum snapshot salvo até o momento."
                      : "Nenhum resultado para o filtro."}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {filteredSavedNewProductSimulations.map((item) => (
                      <div
                        key={item.id}
                        className={cn(
                          "flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between",
                          activePersistedSimulation?.id === item.id
                            ? "border-primary/50 bg-primary/5 ring-1 ring-primary/30"
                            : "border-border bg-accent/10"
                        )}
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5 gap-y-0.5">
                            <p className="text-xs font-black">{item.name}</p>
                            <span
                              className={cn(
                                "rounded px-1.5 py-0.5 text-[9px] font-bold uppercase",
                                item.status === "SAVED"
                                  ? "bg-emerald-500/15 text-emerald-800"
                                  : "bg-blue-500/15 text-blue-800"
                              )}
                            >
                              {item.status === "SAVED" ? "Salvo" : "Rascunho"}
                            </span>
                          </div>
                          <p className="text-[11px] text-muted-foreground">
                            {item.productName}
                            {item.productSku ? ` • ${item.productSku}` : ""}
                            {item.savedAt ? ` • salvo em ${new Date(item.savedAt).toLocaleString()}` : ""}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleOpenSavedSnapshot(item.id)}
                            className="px-2.5 py-1 rounded border border-border text-[11px] font-semibold hover:bg-accent"
                          >
                            Abrir
                          </button>
                          <button
                            type="button"
                            onClick={() => handleCloneSavedSnapshot(item.id)}
                            className="px-2.5 py-1 rounded border border-border text-[11px] font-semibold hover:bg-accent"
                          >
                            Clonar
                          </button>
                          <button
                            type="button"
                            title="Excluir registro da biblioteca"
                            onClick={() => handleDeleteSavedSnapshot(item.id)}
                            className="inline-flex items-center justify-center rounded border border-red-200/80 bg-red-50/50 p-1.5 text-red-700 hover:bg-red-100 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300 dark:hover:bg-red-950/50"
                            aria-label={`Excluir ${item.name}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </aside>
        </div>
      )}

      {newProductReportOpen &&
        frozenReportSnapshot &&
        createPortal(
          <div
            id="new-product-report-print-portal"
            className="new-product-report-print-shell fixed inset-0 z-[100] flex items-start justify-center p-4 pt-16 sm:pt-8"
          >
            <button
              type="button"
              aria-label="Fechar relatório"
              className="absolute inset-0 bg-black/50 reports-no-print"
              onClick={() => setNewProductReportOpen(false)}
            />
            <div className="new-product-report-print-panel relative w-full max-w-[min(1100px,calc(100vw-2rem))] max-h-[95vh] overflow-y-auto rounded-2xl border border-border bg-card shadow-2xl">
              <div className="sticky top-0 z-10 flex flex-wrap items-center justify-end gap-2 border-b border-border bg-card/95 backdrop-blur px-4 py-3 reports-no-print">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-semibold hover:bg-accent transition-colors"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Imprimir
                </button>
                <button
                  type="button"
                  onClick={() => setNewProductReportOpen(false)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-semibold hover:bg-accent transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                  Fechar
                </button>
              </div>
              <div id="new-product-report-print-root" className="p-5 md:p-10 bg-white print:p-0">
                <NewProductSimulationReport
                  snapshot={frozenReportSnapshot}
                  recordStatus={activePersistedSimulation?.status}
                />
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* Modal: Comparison View */}
      <AnimatePresence>
        {comparing && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-card w-full max-w-5xl rounded-2xl border border-border shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-6 border-b border-border flex items-center justify-between bg-accent/50">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                    <TrendingUp className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold">Análise Comparativa de Cenário</h3>
                    <p className="text-xs text-muted-foreground">{comparing.base.product} • {comparing.base.sku}</p>
                  </div>
                </div>
                <button onClick={() => setComparing(null)} className="p-2 hover:bg-accent rounded-full transition-colors">
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-6">
                <div className="inline-flex rounded-xl border border-border p-1 bg-accent/20">
                  <button
                    type="button"
                    onClick={() => setCompareViewTab("INTERNAL")}
                    className={cn(
                      "px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors",
                      compareViewTab === "INTERNAL"
                        ? "bg-card text-primary shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    Visão interna
                  </button>
                  <button
                    type="button"
                    onClick={() => setCompareViewTab("CLIENT")}
                    className={cn(
                      "px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors",
                      compareViewTab === "CLIENT"
                        ? "bg-card text-primary shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    Reajuste para Cliente
                  </button>
                </div>

                {compareViewTab === "CLIENT" ? (
                  <div className="space-y-6">
                    <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
                      <div className="flex items-center justify-between gap-3">
                        <h4 className="text-sm font-black uppercase tracking-wider text-primary">Resumo Comercial</h4>
                        <button
                          type="button"
                          onClick={handleCopyClientSummary}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-semibold hover:bg-accent transition-colors"
                        >
                          <Copy className="h-3.5 w-3.5" />
                          Copiar resumo
                        </button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <label className="space-y-1">
                          <span className="text-[10px] font-bold uppercase text-muted-foreground">Preço atual do cliente (R$)</span>
                          <input
                            type="number"
                            step="0.00001"
                            className="w-full p-2.5 rounded-lg border border-border bg-background text-sm"
                            value={clientCurrentPriceInput}
                            onChange={(e) => setClientCurrentPriceInput(e.target.value)}
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="text-[10px] font-bold uppercase text-muted-foreground">Reajuste (%)</span>
                          <input
                            type="number"
                            step="0.00001"
                            className="w-full p-2.5 rounded-lg border border-border bg-background text-sm"
                            value={clientReadjustPctInput}
                            onChange={(e) => setClientReadjustPctInput(e.target.value)}
                          />
                        </label>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="rounded-lg border border-border bg-accent/10 p-3">
                          <p className="text-[10px] font-bold uppercase text-muted-foreground">Preço atual</p>
                          <p className="text-lg font-black">{formatCurrency(Number.isFinite(clientCurrentPrice) ? clientCurrentPrice : 0, 5)}</p>
                        </div>
                        <div className="rounded-lg border border-border bg-accent/10 p-3">
                          <p className="text-[10px] font-bold uppercase text-muted-foreground">Reajuste</p>
                          <p className="text-lg font-black">{formatNumber(Number.isFinite(clientReajPct) ? clientReajPct : 0, 2)}%</p>
                        </div>
                        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
                          <p className="text-[10px] font-bold uppercase text-primary/80">Novo preço</p>
                          <p className="text-lg font-black text-primary">{formatCurrency(clientNewPrice, 5)}</p>
                        </div>
                      </div>

                      <div className="rounded-xl border border-border p-4 bg-accent/5 space-y-3">
                        <h5 className="text-xs font-black uppercase tracking-wider text-muted-foreground">Composição percentual dos drivers</h5>
                        {[
                          { label: "MP", pct: simMpPct, bar: "bg-orange-500/80" },
                          { label: "HH", pct: simHhPct, bar: "bg-blue-500/80" },
                          { label: "HM", pct: simHmPct, bar: "bg-violet-500/80" },
                        ].map((row) => (
                          <div key={row.label} className="space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-bold">{row.label}</span>
                              <span className="tabular-nums font-semibold">{formatNumber(row.pct, 2)}%</span>
                            </div>
                            <div className="h-2 rounded-full bg-accent overflow-hidden">
                              <div className={cn("h-full rounded-full", row.bar)} style={{ width: `${Math.max(0, Math.min(100, row.pct))}%` }} />
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <label className="space-y-1">
                          <span className="text-[10px] font-bold uppercase text-muted-foreground">Vigência (opcional)</span>
                          <input
                            type="text"
                            className="w-full p-2.5 rounded-lg border border-border bg-background text-sm"
                            value={clientValidityNote}
                            onChange={(e) => setClientValidityNote(e.target.value)}
                            placeholder="Ex: a partir de 01/06/2026"
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="text-[10px] font-bold uppercase text-muted-foreground">Observação (opcional)</span>
                          <input
                            type="text"
                            className="w-full p-2.5 rounded-lg border border-border bg-background text-sm"
                            value={clientObservation}
                            onChange={(e) => setClientObservation(e.target.value)}
                            placeholder="Texto curto para negociação"
                          />
                        </label>
                      </div>

                      <p className="text-xs text-muted-foreground leading-relaxed">
                        O reajuste proposto considera a participação relativa de matéria-prima, mão de obra e custo de processo na composição do item.
                      </p>
                    </div>
                  </div>
                ) : (
                  <>
                {comparing.simulationNote && (
                  <p className="text-[11px] text-muted-foreground border border-border rounded-lg p-3 bg-accent/20">
                    {comparing.simulationNote}
                  </p>
                )}
                <div className="rounded-xl border border-border p-4 bg-card space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                      Modo comercial
                    </h4>
                    <div className="inline-flex rounded-lg border border-border p-1 bg-accent/20">
                      <button
                        type="button"
                        onClick={() => setCommercialMode("MARGIN")}
                        className={cn(
                          "px-3 py-1.5 text-xs font-semibold rounded-md transition-colors",
                          commercialMode === "MARGIN"
                            ? "bg-card text-primary shadow-sm"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        Margem desejada
                      </button>
                      <button
                        type="button"
                        onClick={() => setCommercialMode("TARGET_PRICE")}
                        className={cn(
                          "px-3 py-1.5 text-xs font-semibold rounded-md transition-colors",
                          commercialMode === "TARGET_PRICE"
                            ? "bg-card text-primary shadow-sm"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        Preço alvo
                      </button>
                    </div>
                  </div>

                  {commercialMode === "MARGIN" ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <label className="space-y-1">
                        <span className="text-[10px] font-bold uppercase text-muted-foreground">
                          Margem desejada (%) — editável
                        </span>
                        <input
                          type="number"
                          step="0.00001"
                          className="w-full p-2.5 rounded-lg border border-border bg-background text-sm"
                          value={commercialMarginInput}
                          onChange={(e) => setCommercialMarginInput(e.target.value)}
                        />
                      </label>
                      <div className="space-y-1">
                        <span className="text-[10px] font-bold uppercase text-muted-foreground">
                          Preço final calculado (R$)
                        </span>
                        <div className="w-full p-2.5 rounded-lg border border-border bg-accent/20 text-sm font-semibold">
                          {formatCurrency(displayedSuggestedPrice, 5)}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <label className="space-y-1">
                          <span className="text-[10px] font-bold uppercase text-muted-foreground">
                            Preço alvo (R$) — editável
                          </span>
                          <input
                            type="number"
                            step="0.00001"
                            className="w-full p-2.5 rounded-lg border border-border bg-background text-sm"
                            value={commercialTargetPriceInput}
                            onChange={(e) => setCommercialTargetPriceInput(e.target.value)}
                          />
                        </label>
                        <div className="space-y-1">
                          <span className="text-[10px] font-bold uppercase text-muted-foreground">
                            Margem resultante calculada (%)
                          </span>
                          <div className="w-full p-2.5 rounded-lg border border-border bg-accent/20 text-sm font-semibold">
                            {formatNumber(displayedMarginRate, 5)}%
                          </div>
                        </div>
                      </div>

                      <div className="rounded-xl border border-primary/25 bg-primary/5 p-4 space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h5 className="text-[11px] font-black uppercase tracking-wider text-primary">
                            Composição do preço alvo
                          </h5>
                          <span className="text-[10px] text-primary/70 font-semibold">
                            Custo base = MP + HH + HM
                          </span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <div className="rounded-lg border border-border bg-card p-3">
                            <p className="text-[10px] font-bold uppercase text-muted-foreground">Preço alvo</p>
                            <p className="text-base font-black text-primary">{formatCurrency(displayedSuggestedPrice, 5)}</p>
                          </div>
                          <div className="rounded-lg border border-border bg-card p-3">
                            <p className="text-[10px] font-bold uppercase text-muted-foreground">Margem resultante</p>
                            <p className="text-base font-black">{formatNumber(displayedMarginRate, 5)}%</p>
                          </div>
                          <div className="rounded-lg border border-border bg-card p-3">
                            <p className="text-[10px] font-bold uppercase text-muted-foreground">Custo base total</p>
                            <p className="text-base font-black">{formatCurrency(simCostBase, 5)}</p>
                          </div>
                        </div>

                        <div className="space-y-2">
                          {[
                            { label: "MP", value: simMp, pct: simMpPct, bar: "bg-orange-500/80" },
                            { label: "HH", value: simHh, pct: simHhPct, bar: "bg-blue-500/80" },
                            { label: "HM", value: simHm, pct: simHmPct, bar: "bg-violet-500/80" },
                          ].map((row) => (
                            <div key={row.label} className="rounded-lg border border-border bg-card p-2.5">
                              <div className="flex items-center justify-between gap-3 text-[11px]">
                                <span className="font-bold">{row.label}</span>
                                <span className="tabular-nums font-semibold">{formatCurrency(row.value, 5)}</span>
                                <span className="tabular-nums text-muted-foreground">{formatNumber(row.pct, 2)}%</span>
                              </div>
                              <div className="mt-1.5 h-1.5 rounded-full bg-accent overflow-hidden">
                                <div className={cn("h-full rounded-full", row.bar)} style={{ width: `${Math.max(0, Math.min(100, row.pct))}%` }} />
                              </div>
                            </div>
                          ))}
                        </div>

                        <p className="text-[11px] text-muted-foreground leading-relaxed">
                          Neste preço alvo, a matéria-prima representa <b>{formatNumber(simMpPct, 2)}%</b> do custo base,
                          HH representa <b>{formatNumber(simHhPct, 2)}%</b> e HM representa <b>{formatNumber(simHmPct, 2)}%</b>.
                          Isso ajuda a justificar comercialmente impactos de resina, dissídio e custo de máquina.
                        </p>
                      </div>
                    </div>
                  )}
                  {!commercialProjection.feasible && (
                    <p className="text-[11px] text-amber-700 dark:text-amber-300">
                      Campo comercial inválido para cálculo (divisor {"<="} 0). Ajuste margem/preço alvo.
                    </p>
                  )}
                </div>
                {/* Main Comparison Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  {/* Official Base */}
                  <div className="p-6 rounded-2xl border border-border bg-accent/5 space-y-6">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">Base Oficial</span>
                      <span className="px-2 py-0.5 rounded-full bg-muted text-[10px] font-bold">Atual</span>
                    </div>
                    <div className="space-y-1">
                      <p className="text-4xl font-black">{formatCurrency(comparing.base.resultados.suggestedPrice, 5)}</p>
                      <p className="text-xs text-muted-foreground">Preço Sugerido Base</p>
                    </div>
                    <div className="pt-4 border-t border-border grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-[10px] font-bold text-muted-foreground uppercase">CIU Base</p>
                        <p className="text-sm font-bold">{formatCurrency(comparing.base.ciu, 5)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold text-muted-foreground uppercase" title="Percentual de margem desejada na formação de preço (premissa), não margem realizada">
                          Margem premissa
                        </p>
                        <p className="text-sm font-bold">{comparing.base.premissas.marginRate}%</p>
                      </div>
                    </div>
                  </div>

                  {/* Simulated Scenario */}
                  <div className="p-6 rounded-2xl border-2 border-primary bg-primary/5 space-y-6 relative overflow-hidden">
                    <div className="absolute -right-8 -top-8 bg-primary text-primary-foreground w-24 h-24 rotate-45 flex items-end justify-center pb-2">
                      <Zap className="h-6 w-6" />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-black uppercase text-primary tracking-widest">Cenário Simulado</span>
                      <div className={cn(
                        "flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black",
                        displayedPriceDeltaPct > 0 ? "bg-red-100 text-red-600" : "bg-green-100 text-green-600"
                      )}>
                        {displayedPriceDeltaPct > 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                        {formatNumber(Math.abs(displayedPriceDeltaPct))}%
                      </div>
                    </div>
                    <div className="space-y-1">
                      <p className="text-4xl font-black text-primary">{formatCurrency(displayedSuggestedPrice, 5)}</p>
                      <p className="text-xs text-primary/60">Novo Preço Sugerido</p>
                    </div>
                    <div className="pt-4 border-t border-primary/20 grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-[10px] font-bold text-primary uppercase">Novo CIU</p>
                        <p className="text-sm font-bold">{formatCurrency(comparing.simulated.ciu, 5)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold text-primary uppercase" title="Margem comercial aplicada no modo ativo do cenário">
                          Margem premissa (cenário)
                        </p>
                        <p className="text-sm font-bold">{formatNumber(displayedMarginRate)}%</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Impact Analysis */}
                <div className="space-y-4">
                  <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                    <Info className="h-3 w-3" /> Resumo do Impacto
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="p-5 rounded-2xl border border-border bg-card shadow-sm flex flex-col items-center text-center">
                      <p className="text-[10px] font-bold text-muted-foreground uppercase mb-2">Variação de Custo</p>
                      <p className={cn("text-xl font-black", comparing.delta.ciu > 0 ? "text-red-600" : "text-green-600")}>
                        {comparing.delta.ciu > 0 ? "+" : ""}{formatCurrency(comparing.delta.ciu, 5)}
                      </p>
                      <p className="text-[10px] text-muted-foreground">por unidade produzida</p>
                    </div>
                    <div className="p-5 rounded-2xl border border-border bg-card shadow-sm flex flex-col items-center text-center">
                      <p className="text-[10px] font-bold text-muted-foreground uppercase mb-2">Variação de Preço</p>
                      <p className={cn("text-xl font-black", displayedPriceDelta > 0 ? "text-red-600" : "text-green-600")}>
                        {displayedPriceDelta > 0 ? "+" : ""}{formatCurrency(displayedPriceDelta, 5)}
                      </p>
                      <p className="text-[10px] text-muted-foreground">necessário para manter margem</p>
                    </div>
                    <div className="p-5 rounded-2xl border border-border bg-card shadow-sm flex flex-col items-center text-center">
                      <p className="text-[10px] font-bold text-muted-foreground uppercase mb-2">Novo Markup</p>
                      <p className="text-xl font-black text-primary">
                        {formatNumber(displayedMarkup)}x
                      </p>
                      <p className="text-[10px] text-muted-foreground">fator multiplicador simulado</p>
                    </div>
                  </div>
                </div>

                {comparing.breakdown && (
                  <div className="space-y-3">
                    <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                      Memória de cálculo (MP + HH + HM)
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="rounded-xl border border-border p-4 bg-accent/10 text-xs space-y-2">
                        <p className="font-bold uppercase text-muted-foreground">Base</p>
                        <p>MP: <b>{formatCurrency(comparing.breakdown.base.mp, 5)}</b></p>
                        <p>HH: <b>{formatCurrency(comparing.breakdown.base.hh, 5)}</b></p>
                        <p>HM: <b>{formatCurrency(comparing.breakdown.base.hm, 5)}</b></p>
                        <p className="pt-1 border-t border-border">Custo base: <b>{formatCurrency(comparing.breakdown.base.costBase, 5)}</b></p>
                      </div>
                      <div className="rounded-xl border border-primary/30 p-4 bg-primary/5 text-xs space-y-2">
                        <p className="font-bold uppercase text-primary">Simulado</p>
                        <p>MP: <b>{formatCurrency(comparing.breakdown.simulated.mp, 5)}</b></p>
                        <p>HH: <b>{formatCurrency(comparing.breakdown.simulated.hh, 5)}</b></p>
                        <p>HM: <b>{formatCurrency(comparing.breakdown.simulated.hm, 5)}</b></p>
                        <p className="pt-1 border-t border-primary/20">Custo base: <b>{formatCurrency(comparing.breakdown.simulated.costBase, 5)}</b></p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="p-4 rounded-xl bg-orange-50 border border-orange-100 flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-orange-600 shrink-0 mt-0.5" />
                  <p className="text-xs text-orange-800 leading-relaxed">
                    <b>Atenção:</b> Esta simulação utiliza aproximações baseadas na estrutura de custos atual. 
                    Os resultados são estimativas para suporte à decisão e não alteram os registros oficiais do sistema.
                  </p>
                </div>
                  </>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal: New Scenario Form */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-card w-full max-w-xl rounded-2xl border border-border shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-border flex items-center justify-between bg-accent/30">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                    <Layers className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold">Novo Cenário de Simulação</h3>
                    <p className="text-xs text-muted-foreground">Defina as variáveis para o teste de estresse.</p>
                  </div>
                </div>
                <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-accent rounded-full transition-colors">
                  <X className="h-5 w-5" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="p-6 space-y-6">
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase">Nome do Cenário</label>
                    <input
                      required
                      type="text"
                      className="w-full p-3 rounded-xl border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none"
                      value={formData.name}
                      onChange={(e) => setFormData({...formData, name: e.target.value})}
                      placeholder="Ex: Aumento Aço 10% + Dissídio"
                    />
                  </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-muted-foreground uppercase">Produto Base</label>
                        <SearchableSelect
                          placeholder="Selecione..."
                          options={products.map((p: { id: string; sku: string; name: string; type?: string }) => ({
                            value: p.id,
                            label: `${p.sku} — ${p.name}`,
                            sublabel: p.type === "COMPONENT" ? "Componente" : "Produto",
                            searchTerms: `${p.sku} ${p.name}`,
                          }))}
                          value={formData.productId}
                          onChange={(val) => setFormData({...formData, productId: val})}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-muted-foreground uppercase">Canal de Venda</label>
                        <SearchableSelect
                          placeholder="Selecione..."
                          options={taxRules.map((r: { id: string; name: string; description?: string }) => ({
                            value: r.id,
                            label: r.name,
                            sublabel: r.description?.trim() || undefined,
                            searchTerms: [r.name, r.description].filter(Boolean).join(" "),
                          }))}
                          value={formData.taxRuleId}
                          onChange={(val) => setFormData({...formData, taxRuleId: val})}
                        />
                      </div>
                    </div>
                </div>

                <div className="space-y-4 pt-4 border-t border-border">
                  <h4 className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">Variáveis de Ajuste (%)</h4>
                  
                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold flex items-center justify-between">
                        <span>Matéria-Prima</span>
                        <span className={cn(formData.materialAdj > 0 ? "text-red-600" : "text-green-600")}>
                          {formData.materialAdj > 0 ? "+" : ""}{formData.materialAdj}%
                        </span>
                      </label>
                      <input 
                        type="range" min="-50" max="100" step="1"
                        className="w-full accent-primary"
                        value={formData.materialAdj}
                        onChange={(e) => setFormData({...formData, materialAdj: parseInt(e.target.value)})}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold flex items-center justify-between">
                        <span>Mão de Obra (HH)</span>
                        <span className={cn(formData.laborAdj > 0 ? "text-red-600" : "text-green-600")}>
                          {formData.laborAdj > 0 ? "+" : ""}{formData.laborAdj}%
                        </span>
                      </label>
                      <input 
                        type="range" min="-50" max="100" step="1"
                        className="w-full accent-primary"
                        value={formData.laborAdj}
                        onChange={(e) => setFormData({...formData, laborAdj: parseInt(e.target.value)})}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold flex items-center justify-between">
                        <span>Máquina (HM)</span>
                        <span className={cn(formData.indirectAdj > 0 ? "text-red-600" : "text-green-600")}>
                          {formData.indirectAdj > 0 ? "+" : ""}{formData.indirectAdj}%
                        </span>
                      </label>
                      <input 
                        type="range" min="-50" max="100" step="1"
                        className="w-full accent-primary"
                        value={formData.indirectAdj}
                        onChange={(e) => setFormData({...formData, indirectAdj: parseInt(e.target.value)})}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold flex items-center justify-between">
                        <span>Eficiência Fabril</span>
                        <span className={cn(formData.efficiencyAdj > 0 ? "text-green-600" : "text-red-600")}>
                          {formData.efficiencyAdj > 0 ? "+" : ""}{formData.efficiencyAdj}%
                        </span>
                      </label>
                      <input 
                        type="range" min="-50" max="50" step="1"
                        className="w-full accent-primary"
                        value={formData.efficiencyAdj}
                        onChange={(e) => setFormData({...formData, efficiencyAdj: parseInt(e.target.value)})}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold flex items-center justify-between">
                        <span>Margem Desejada</span>
                        <span className={cn(formData.marginAdj > 0 ? "text-green-600" : "text-red-600")}>
                          {formData.marginAdj > 0 ? "+" : ""}{formData.marginAdj}%
                        </span>
                      </label>
                      <input 
                        type="range" min="-50" max="100" step="1"
                        className="w-full accent-primary"
                        value={formData.marginAdj}
                        onChange={(e) => setFormData({...formData, marginAdj: parseInt(e.target.value)})}
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-4 flex items-center gap-3">
                  <button 
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="flex-1 py-3 rounded-xl font-bold hover:bg-accent transition-colors"
                  >
                    Cancelar
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 py-3 rounded-xl font-bold bg-primary text-primary-foreground hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
                  >
                    <Save className="h-4 w-4" />
                    Criar Simulação
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <GuidedTour
        open={tourOpen}
        onClose={() => setTourOpen(false)}
        steps={SIMULATION_TOUR_STEPS}
        tourName="Tour de Simulações"
      />
    </div>
  );
};

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-accent/10 p-2.5">
      <p className="text-[10px] font-bold uppercase text-muted-foreground">{label}</p>
      <p className="text-sm font-black">{value}</p>
    </div>
  );
}
