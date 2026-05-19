import React, { useEffect, useState, useMemo, useCallback } from "react";
import { 
  Plus, 
  Search, 
  Edit2, 
  Trash2, 
  X,
  Loader2,
  Package,
  Layers,
  Cpu,
  Settings,
  ChevronRight,
  ChevronDown,
  Info,
  Save,
  AlertCircle,
  TrendingUp,
  DollarSign,
  Clock,
  ArrowRight,
  Box,
  FileText,
  History,
  CheckCircle2,
  Download,
  BookOpen,
} from "lucide-react";
import { cn, formatCurrency, formatNumber } from "@/src/lib/utils";
import { fetchJsonOk } from "@/src/lib/http";
import { SearchableSelect, type SelectOption } from "./shared/SearchableSelect";
import { Product, CreateProductInput, ItemType, ProductBOM, ProductRouting } from "@/src/types/product";
import { Material } from "@/src/types/material";
import { motion, AnimatePresence } from "motion/react";
import { DataImportDialog } from "./shared/DataImportDialog";
import { ProductImportConfig } from "../lib/importer/ProductConfig";
import { CalculatedValue } from "./shared/CalculatedValue";
import { BomCostDetailRow } from "./shared/BomCostDetailRow";
import { AppAlert } from "./shared/AppAlert";
import type { CalculationExplainabilityMap } from "@/src/types/calculation";
import { GuidedTour } from "@/src/components/tour/GuidedTour";
import { TourHelpButton } from "@/src/components/tour/TourHelpButton";
import { PRODUCT_TOUR_STEPS } from "@/src/tours/productTourSteps";
import { ProductBomTreeContextPanel } from "@/src/components/product/ProductBomTreeContextPanel";
import { NomusBomComparisonPanel } from "@/src/components/product/NomusBomComparisonPanel";
import { NomusBomBatchReportPanel } from "@/src/components/product/NomusBomBatchReportPanel";
import { NomusBomClassificationPanel } from "@/src/components/product/NomusBomClassificationPanel";
import { NomusBomApplyPlanPanel } from "@/src/components/product/NomusBomApplyPlanPanel";
import type { BomCostDetailRowData } from "@/src/components/shared/BomCostDetailRow";
import {
  OpenBookCompositionTab,
  type OpenBookPayload,
} from "@/src/components/product/OpenBookCompositionTab";
import { buildEngineeringExportWorkbook, workbookToXlsxBytes } from "@/src/lib/productEngineeringExport";
import { useAuth } from "@/src/contexts/AuthContext";
import { getVisibleProductTabs, type ProductTabId } from "@/src/lib/modulePermissions";

/** Linha da lista de engenharia com resumo de custo (GET /api/products?cost=1&type=PRODUCT|COMPONENT). */
export type ProductWithCostSummary = Product & {
  costSummary?:
    | { na: true; label: string }
    | { unavailable: true; reason: string }
    | { error: true; code?: string; message?: string }
    | { totalIndustrialCost: number; partial?: boolean };
};

/** Linha retornada por GET /api/products/bom-item-options (lista unificada para a BOM). */
type BomItemOptionRow =
  | { type: "MATERIAL"; id: string; code: string; name: string; label: string }
  | { type: "PRODUCT"; id: string; sku: string; name: string; productType: ItemType; label: string };

/* -------------------------------------------------------------------------- */
/*                                Sub-Components                              */
/* -------------------------------------------------------------------------- */

const Badge = ({
  children,
  variant = "default",
  className,
}: {
  children: React.ReactNode;
  variant?: "default" | "success" | "warning" | "danger" | "info";
  className?: string;
}) => {
  const variants = {
    default: "bg-accent text-accent-foreground",
    success: "bg-green-500/10 text-green-600",
    warning:
      "bg-amber-100 text-amber-950 ring-1 ring-amber-500/35 dark:bg-amber-950/55 dark:text-amber-50 dark:ring-amber-400/35",
    danger: "bg-red-500/10 text-red-600",
    info: "bg-blue-500/10 text-blue-600",
  };
  return (
    <span
      className={cn(
        "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider",
        variants[variant],
        className
      )}
    >
      {children}
    </span>
  );
};

/* -------------------------------------------------------------------------- */
/*                                Main Module                                 */
/* -------------------------------------------------------------------------- */

const PRODUCT_FORM_TABS: {
  id: ProductTabId;
  label: string;
  icon: typeof Info;
}[] = [
  { id: "info", label: "Informações", icon: Info },
  { id: "bom", label: "Estrutura (BOM)", icon: Layers },
  { id: "routing", label: "Processo (Roteiro)", icon: Settings },
  { id: "tree", label: "Estrutura em Árvore", icon: ChevronRight },
  { id: "cost", label: "Análise de Custo", icon: DollarSign },
  { id: "composition", label: "Composição de Custos", icon: BookOpen },
];

export const ProductModule = () => {
  const auth = useAuth();
  const canCreateProduct = auth.hasPermission("products.create");
  const canEditProduct = auth.hasPermission("products.edit");
  const canDeleteProduct = auth.hasPermission("products.delete");
  const canExportEngineering = auth.hasPermission("products.export.engineering");
  const canCompareNomusBom = auth.hasAnyPermission([
    "products.tab.bom",
    "products.tab.tree",
    "products.tab.cost",
    "products.edit",
  ]);
  const canViewNomusBomReport = auth.hasAnyPermission([
    "products.view",
    "products.tab.bom",
    "products.tab.tree",
    "products.tab.cost",
    "products.edit",
  ]);

  const visibleFormTabs = useMemo(() => {
    const allowed = new Set(getVisibleProductTabs(auth));
    return PRODUCT_FORM_TABS.filter((t) => allowed.has(t.id));
  }, [auth]);

  const [items, setItems] = useState<ProductWithCostSummary[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [bomItemOptions, setBomItemOptions] = useState<BomItemOptionRow[]>([]);
  const [bomOptionsLoading, setBomOptionsLoading] = useState(false);
  const [machines, setMachines] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  /** Escopo da lista: só Produtos ou Componentes (GET /api/products?type=…). */
  const [engineeringSegment, setEngineeringSegment] = useState<"PRODUCT" | "COMPONENT">("PRODUCT");
  const [listStatusFilter, setListStatusFilter] = useState<"" | "ACTIVE" | "INACTIVE">("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Product | null>(null);
  const [activeFormTab, setActiveFormTab] = useState<ProductTabId>("info");

  useEffect(() => {
    if (!isModalOpen) return;
    if (visibleFormTabs.length === 0) return;
    if (!visibleFormTabs.some((t) => t.id === activeFormTab)) {
      setActiveFormTab(visibleFormTabs[0]!.id);
    }
  }, [isModalOpen, visibleFormTabs, activeFormTab]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [treeData, setTreeData] = useState<any>(null);
  const [loadingTree, setLoadingTree] = useState(false);
  const [backendCostAnalysis, setBackendCostAnalysis] = useState<any>(null);
  const [loadingCost, setLoadingCost] = useState(false);
  const [costAnalysisError, setCostAnalysisError] = useState<string | null>(null);
  const [tourOpen, setTourOpen] = useState(false);

  // Form State
  const [formData, setFormData] = useState<CreateProductInput>({
    sku: "",
    name: "",
    description: "",
    type: "PRODUCT",
    version: "1.0.0",
    defaultLotSize: 1,
    cycleTimeSeconds: "",
    cavities: "",
    setupTimeMin: "",
    efficiencyExpected: "",
    bom: [],
    routing: [],
  });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ cost: "1", type: engineeringSegment });
      const [productsData, materialsData, machinesData, rolesData] = await Promise.all([
        fetchJsonOk<ProductWithCostSummary[]>(`/api/products?${qs.toString()}`),
        fetchJsonOk<Material[]>("/api/materials"),
        fetchJsonOk("/api/machines"),
        fetchJsonOk("/api/roles"),
      ]);
      setItems(Array.isArray(productsData) ? productsData : []);
      setMaterials(Array.isArray(materialsData) ? materialsData : []);
      setMachines(Array.isArray(machinesData) ? machinesData : []);
      setRoles(Array.isArray(rolesData) ? rolesData : []);
    } catch (error) {
      console.error("Erro ao buscar dados:", error);
      alert(error instanceof Error ? error.message : "Não foi possível carregar dados de engenharia.");
    } finally {
      setLoading(false);
    }
  }, [engineeringSegment]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!isModalOpen || formData.type === "MATERIAL") {
      setBomItemOptions([]);
      setBomOptionsLoading(false);
      return;
    }
    let cancelled = false;
    setBomOptionsLoading(true);
    const params = new URLSearchParams();
    if (editingItem?.id) params.set("excludeProductId", editingItem.id);
    const q = params.toString();
    void fetchJsonOk<BomItemOptionRow[]>(`/api/products/bom-item-options${q ? `?${q}` : ""}`)
      .then((data) => {
        if (!cancelled) setBomItemOptions(Array.isArray(data) ? data : []);
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) {
          setBomItemOptions([]);
          alert(err instanceof Error ? err.message : "Não foi possível carregar opções da estrutura (BOM).");
        }
      })
      .finally(() => {
        if (!cancelled) setBomOptionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isModalOpen, formData.type, editingItem?.id]);

  useEffect(() => {
    setSelectedIds([]);
  }, [engineeringSegment]);

  const reloadTree = useCallback(async () => {
    if (!editingItem?.id) return;
    setLoadingTree(true);
    setTreeData(null);
    try {
      const data = await fetchJsonOk(`/api/products/${editingItem.id}/tree`);
      setTreeData(data);
    } catch (err) {
      console.error("Erro ao carregar árvore:", err);
      setTreeData(null);
      alert(err instanceof Error ? err.message : "Não foi possível carregar a árvore do produto.");
    } finally {
      setLoadingTree(false);
    }
  }, [editingItem?.id]);

  useEffect(() => {
    if (activeFormTab === "tree" && editingItem?.id) {
      void reloadTree();
    }
  }, [activeFormTab, editingItem?.id, reloadTree]);

  useEffect(() => {
    if (!isModalOpen || !editingItem?.id) {
      setBackendCostAnalysis(null);
      setCostAnalysisError(null);
      setLoadingCost(false);
      return;
    }
    if (activeFormTab !== "cost" && activeFormTab !== "composition") {
      return;
    }

    const ac = new AbortController();
    let cancelled = false;
    setLoadingCost(true);
    fetchJsonOk(`/api/products/${editingItem.id}/cost-analysis`, { signal: ac.signal })
      .then((data) => {
        if (!cancelled) {
          setBackendCostAnalysis(data);
          setCostAnalysisError(null);
        }
      })
      .catch((err) => {
        if (err instanceof Error && err.name === "AbortError") return;
        console.error("Erro ao carregar custo:", err);
        if (!cancelled) {
          setBackendCostAnalysis(null);
          const text = err instanceof Error ? err.message : "Não foi possível carregar a análise de custo.";
          setCostAnalysisError(text);
          alert(text);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingCost(false);
      });

    return () => {
      cancelled = true;
      ac.abort();
      setLoadingCost(false);
    };
  }, [activeFormTab, isModalOpen, editingItem?.id]);

  const handleOpenModal = (item?: Product) => {
    setBackendCostAnalysis(null);
    setCostAnalysisError(null);
    if (item) {
      setEditingItem(item);
      setFormData({
        sku: item.sku,
        name: item.name,
        description: item.description || "",
        type: item.type,
        version: item.version,
        defaultLotSize: item.defaultLotSize,
        cycleTimeSeconds: item.cycleTimeSeconds ?? "",
        cavities: item.cavities ?? "",
        setupTimeMin: item.setupTimeMin ?? "",
        efficiencyExpected: item.efficiencyExpected ?? "",
        bom: item.ProductBOM.map(b => ({
          materialId: b.materialId,
          childProductId: b.childProductId,
          quantity: Number(b.quantity),
          lossPercentage: Number(b.lossPercentage),
          notes: b.notes
        })),
        routing: item.ProductRouting.map(r => ({
          id: r.id,
          sequence: r.sequence,
          description: r.description,
          machineId: r.machineId,
          roleId: r.roleId,
          setupTimeMin: Number(r.setupTimeMin),
          operationTimeMin: Number(r.operationTimeMin),
          efficiencyExpected: Number(r.efficiencyExpected),
          cycleTimeSeconds: r.cycleTimeSeconds != null ? Number(r.cycleTimeSeconds) : undefined,
          cavities: r.cavities != null ? Number(r.cavities) : undefined,
          notes: r.notes
        })),
      });
    } else {
      setEditingItem(null);
      setFormData({
        sku: "",
        name: "",
        description: "",
        type: "PRODUCT",
        version: "1.0.0",
        defaultLotSize: 1,
        cycleTimeSeconds: "",
        cavities: "",
        setupTimeMin: "",
        efficiencyExpected: "",
        bom: [],
        routing: [],
      });
    }
    setActiveFormTab("info");
    setIsModalOpen(true);
  };

  const handleOpenProductById = useCallback(
    async (productId: string) => {
      const existing = items.find((item) => item.id === productId);
      if (existing) {
        handleOpenModal(existing);
        return;
      }
      try {
        const product = await fetchJsonOk<Product>(`/api/products/${productId}`);
        handleOpenModal(product);
      } catch (err) {
        console.error("Erro ao abrir produto do relatório Nomus:", err);
        alert(err instanceof Error ? err.message : "Não foi possível abrir o produto.");
      }
    },
    [items]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validation based on type
    if (formData.type === "PRODUCT" && formData.bom.length === 0) {
      alert("Um PRODUTO deve ter pelo menos uma linha na estrutura (componentes fabricados e/ou materiais comprados).");
      return;
    }

    // Validação do Processo Padrão do Componente
    // Se o ciclo foi informado, TODOS os campos do processo devem ser válidos — sem fallback
    if (formData.type === "COMPONENT" && formData.cycleTimeSeconds !== "" && formData.cycleTimeSeconds !== null && formData.cycleTimeSeconds !== undefined) {
      const ct = Number(formData.cycleTimeSeconds);
      if (!Number.isFinite(ct) || ct <= 0) {
        alert("Processo Padrão: Ciclo (segundos) deve ser um número válido maior que zero.");
        return;
      }

      // Cavidades: obrigatório quando ciclo está preenchido
      if (formData.cavities === "" || formData.cavities === null || formData.cavities === undefined) {
        alert("Processo Padrão: Cavidades é obrigatório quando o Ciclo está preenchido.");
        return;
      }
      const cv = Number(formData.cavities);
      if (!Number.isFinite(cv) || cv < 1) {
        alert("Processo Padrão: Cavidades deve ser >= 1.");
        return;
      }

      // Setup: obrigatório quando ciclo está preenchido
      if (formData.setupTimeMin === "" || formData.setupTimeMin === null || formData.setupTimeMin === undefined) {
        alert("Processo Padrão: Setup (minutos) é obrigatório quando o Ciclo está preenchido.");
        return;
      }
      const st = Number(formData.setupTimeMin);
      if (!Number.isFinite(st) || st < 0) {
        alert("Processo Padrão: Setup (minutos) deve ser >= 0.");
        return;
      }

      // Eficiência: obrigatório quando ciclo está preenchido
      if (formData.efficiencyExpected === "" || formData.efficiencyExpected === null || formData.efficiencyExpected === undefined) {
        alert("Processo Padrão: Eficiência (%) é obrigatório quando o Ciclo está preenchido.");
        return;
      }
      const ef = Number(formData.efficiencyExpected);
      if (!Number.isFinite(ef) || ef <= 0 || ef > 100) {
        alert("Processo Padrão: Eficiência deve ser > 0 e <= 100.");
        return;
      }
    }

    const method = editingItem ? "PUT" : "POST";
    const url = editingItem ? `/api/products/${editingItem.id}` : "/api/products";

    // Montagem segura do payload — string vazia vira null, nunca NaN
    const rawCycle = formData.cycleTimeSeconds;
    const rawCav = formData.cavities;
    const rawSetup = formData.setupTimeMin;
    const rawEff = formData.efficiencyExpected;

    const payload = {
      ...formData,
      cycleTimeSeconds: rawCycle === "" || rawCycle === null || rawCycle === undefined ? null : Number(rawCycle),
      cavities: rawCav === "" || rawCav === null || rawCav === undefined ? null : Number(rawCav),
      setupTimeMin: rawSetup === "" || rawSetup === null || rawSetup === undefined ? null : Number(rawSetup),
      efficiencyExpected: rawEff === "" || rawEff === null || rawEff === undefined ? null : Number(rawEff),
    };

    try {
      const saved = await fetchJsonOk<Product>(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (editingItem && saved?.id === editingItem.id) {
        setItems((prev) =>
          prev.map((p) => {
            if (p.id !== saved.id) return p;
            return {
              ...saved,
              costSummary: (p as ProductWithCostSummary).costSummary,
            } as ProductWithCostSummary;
          })
        );
      }
      setBackendCostAnalysis(null);
      setCostAnalysisError(null);
      setIsModalOpen(false);
      fetchData();
    } catch (error) {
      console.error("Erro ao salvar:", error);
      alert(error instanceof Error ? error.message : "Erro de conexão ao salvar o item.");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Tem certeza que deseja excluir este item? Esta ação não pode ser desfeita.")) {
      return;
    }

    try {
      await fetchJsonOk(`/api/products/${id}`, {
        method: "DELETE",
      });
      setSelectedIds((prev) => prev.filter((i) => i !== id));
      fetchData();
    } catch (error) {
      console.error("Erro ao excluir:", error);
      alert(error instanceof Error ? error.message : "Erro de conexão ao tentar excluir o item.");
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    
    if (!confirm(`Deseja realmente excluir os ${selectedIds.length} itens selecionados?`)) {
      return;
    }

    try {
      const result = await fetchJsonOk<{
        deleted?: number;
        blocked?: number;
        details?: Array<{ status?: string; name?: string; reason?: string }>;
        error?: string;
      }>("/api/products/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedIds }),
      });

      if (result.blocked != null && result.blocked > 0) {
        const blockedDetails = (result.details ?? [])
          .filter((d: any) => d.status === "blocked")
          .map((d: any) => `- ${d.name}: ${d.reason}`)
          .join("\n");

        alert(
          `${result.deleted ?? 0} itens excluídos.\n${result.blocked} itens não puderam ser excluídos:\n${blockedDetails}`
        );
      } else {
        alert(`${result.deleted ?? 0} itens excluídos com sucesso.`);
      }
      setSelectedIds([]);
      fetchData();
    } catch (error) {
      console.error("Bulk delete error:", error);
      alert(error instanceof Error ? error.message : "Erro de conexão ao tentar excluir itens.");
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === filteredItems.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredItems.map(i => i.id));
    }
  };

  const filteredItems = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return items.filter((item) => {
      if (listStatusFilter && item.status !== listStatusFilter) return false;
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.sku.toLowerCase().includes(q)
      );
    });
  }, [items, searchTerm, listStatusFilter]);

  const clearListFilters = () => {
    setSearchTerm("");
    setListStatusFilter("");
  };

  const handleExportEngineering = () => {
    const selected = selectedIds.length
      ? filteredItems.filter((i) => selectedIds.includes(i.id))
      : filteredItems;

    const exportable = selected.filter((p) => p.type === "PRODUCT" || p.type === "COMPONENT");
    const skipped = selected.length - exportable.length;

    if (exportable.length === 0) {
      alert("Nenhum item exportável. Selecione itens do tipo PRODUCT ou COMPONENT.");
      return;
    }

    try {
      const wb = buildEngineeringExportWorkbook(exportable);
      const bytes = workbookToXlsxBytes(wb);
      const blob = new Blob([bytes], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "engenharia_produto_export.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      if (skipped > 0) {
        alert(`Exportação concluída. ${skipped} item(ns) foram ignorados por não serem PRODUCT/COMPONENT.`);
      }
    } catch (err) {
      console.error("Export engineering error:", err);
      alert(err instanceof Error ? err.message : "Não foi possível exportar a engenharia.");
    }
  };

  /* -------------------------------------------------------------------------- */
  /*                                BOM Helpers                                 */
  /* -------------------------------------------------------------------------- */

  const addBOMItem = () => {
    setFormData({
      ...formData,
      bom: [...formData.bom, { quantity: 1, lossPercentage: 0 }]
    });
  };

  const removeBOMItem = (index: number) => {
    const newBOM = [...formData.bom];
    newBOM.splice(index, 1);
    setFormData({ ...formData, bom: newBOM });
  };

  const updateBOMItem = (index: number, field: keyof ProductBOM, value: any) => {
    const newBOM = [...formData.bom];
    newBOM[index] = { ...newBOM[index], [field]: value };
    
    // Ensure XOR between material and child product
    if (field === "materialId") newBOM[index].childProductId = undefined;
    if (field === "childProductId") newBOM[index].materialId = undefined;
    
    setFormData({ ...formData, bom: newBOM });
  };

  const baseBomSelectOptions = useMemo((): SelectOption[] => {
    return bomItemOptions.map((row) => {
      if (row.type === "MATERIAL") {
        return {
          value: `material:${row.id}`,
          label: row.label,
          sublabel: "Matéria-prima",
          searchTerms: `${row.code} ${row.name} MP material`,
        };
      }
      return {
        value: `product:${row.id}`,
        label: row.label,
        sublabel: row.productType === "COMPONENT" ? "Componente" : "Produto",
        searchTerms: `${row.sku} ${row.name} produto componente`,
      };
    });
  }, [bomItemOptions]);

  /**
   * Em edição, garante label para itens já salvos na BOM mesmo quando o valor
   * não está na lista atual do dropdown (ex.: tela em segmento PRODUCT).
   */
  const persistedBomSelectOptions = useMemo((): SelectOption[] => {
    const rows = Array.isArray((editingItem as any)?.ProductBOM) ? ((editingItem as any).ProductBOM as any[]) : [];
    return rows
      .map((row) => {
        const material = row?.Material || row?.material;
        if (row?.materialId) {
          if (material?.code && material?.description) {
            return {
              value: `material:${String(row.materialId)}`,
              label: `${material.code} — ${material.description}`,
              sublabel: "Material (salvo)",
              searchTerms: `${material.code} ${material.description}`,
            };
          }
          return {
            value: `material:${String(row.materialId)}`,
            label: "Material (salvo — fora da lista atual)",
            sublabel: "Material (salvo)",
            searchTerms: "material salvo",
          };
        }
        if (row?.childProductId) {
          const child = row?.ChildProduct || row?.childProduct;
          if (child?.sku && child?.name) {
            const isComp = child.type === "COMPONENT";
            return {
              value: `product:${String(row.childProductId)}`,
              label: `${child.sku} — ${child.name}`,
              sublabel: isComp ? "Componente (salvo)" : "Produto (salvo)",
              searchTerms: `${child.sku} ${child.name}`,
            };
          }
          return {
            value: `product:${String(row.childProductId)}`,
            label: "Produto/componente (salvo — fora da lista atual)",
            sublabel: "Produto (salvo)",
            searchTerms: "produto salvo",
          };
        }
        return null;
      })
      .filter((opt): opt is NonNullable<typeof opt> => Boolean(opt));
  }, [editingItem]);

  const bomSelectOptions = useMemo(() => {
    const merged = [...baseBomSelectOptions, ...persistedBomSelectOptions];
    const dedup = new Map<string, (typeof merged)[number]>();
    merged.forEach((opt) => {
      if (!dedup.has(opt.value)) dedup.set(opt.value, opt);
    });
    return Array.from(dedup.values());
  }, [baseBomSelectOptions, persistedBomSelectOptions]);

  const setBomLineMaterialOrChild = (index: number, val: string) => {
    const newBOM = [...formData.bom];
    if (!val) {
      newBOM[index] = { ...newBOM[index], materialId: undefined, childProductId: undefined };
    } else if (val.startsWith("material:")) {
      newBOM[index] = {
        ...newBOM[index],
        materialId: val.slice("material:".length),
        childProductId: undefined,
      };
    } else if (val.startsWith("product:")) {
      newBOM[index] = {
        ...newBOM[index],
        childProductId: val.slice("product:".length),
        materialId: undefined,
      };
    } else {
      const isMat = materials.some((m) => m.id === val);
      if (isMat) {
        newBOM[index] = { ...newBOM[index], materialId: val, childProductId: undefined };
      } else {
        newBOM[index] = { ...newBOM[index], childProductId: val, materialId: undefined };
      }
    }
    setFormData({ ...formData, bom: newBOM });
  };

  /* -------------------------------------------------------------------------- */
  /*                              Routing Helpers                               */
  /* -------------------------------------------------------------------------- */

  const addRoutingStep = () => {
    const nextSequence = formData.routing.length > 0 
      ? Math.max(...formData.routing.map(r => r.sequence)) + 10 
      : 10;
    
      setFormData({
      ...formData,
      routing: [...formData.routing, { 
        sequence: nextSequence, 
        machineId: "", 
        roleId: "", 
        setupTimeMin: 0, 
        operationTimeMin: 0, 
        efficiencyExpected: 100
      }]
    });
  };

  const removeRoutingStep = (index: number) => {
    const newRouting = [...formData.routing];
    newRouting.splice(index, 1);
    setFormData({ ...formData, routing: newRouting });
  };

  const updateRoutingStep = (index: number, field: keyof ProductRouting, value: any) => {
    const newRouting = [...formData.routing];
    newRouting[index] = { ...newRouting[index], [field]: value };
    setFormData({ ...formData, routing: newRouting });
  };

  /* -------------------------------------------------------------------------- */
  /*                               Cost Analysis                                */
  /* -------------------------------------------------------------------------- */

  const displayCost = useMemo(() => {
    if (backendCostAnalysis) {
      const s = backendCostAnalysis.summary;
      const bomCost = s?.totalMaterialCost || 0;
      const routingCost = s?.totalConversionCost || 0;
      const cifCost = s?.totalCIF_Unit || 0;
      const total = s?.totalIndustrialCost || 0;
      const warnings = Array.isArray(backendCostAnalysis.warnings)
        ? backendCostAnalysis.warnings
        : [];
      const warningCount =
        typeof backendCostAnalysis.warningCount === "number"
          ? backendCostAnalysis.warningCount
          : warnings.length;
      const calculationExplainability =
        (backendCostAnalysis as { calculationExplainability?: CalculationExplainabilityMap })
          .calculationExplainability ?? null;
      const costAnalysisPartial = Boolean(
        (backendCostAnalysis as { costAnalysisPartial?: boolean }).costAnalysisPartial
      );
      const excludedBomLines = Array.isArray(
        (backendCostAnalysis as { excludedBomLines?: unknown }).excludedBomLines
      )
        ? (backendCostAnalysis as { excludedBomLines: unknown[] }).excludedBomLines
        : [];
      const openBook = (backendCostAnalysis as { openBook?: unknown }).openBook ?? null;
      const productType = (backendCostAnalysis as { productType?: string }).productType ?? null;
      return {
        bomCost,
        routingCost,
        cifCost,
        total,
        details: backendCostAnalysis.details || { materials: [], operations: [], processBreakdown: [] },
        warnings,
        warningCount,
        calculationExplainability,
        costAnalysisPartial,
        excludedBomLines,
        openBook,
        productType,
      };
    }
    return {
      bomCost: 0,
      routingCost: 0,
      cifCost: 0,
      total: 0,
      details: { materials: [], operations: [], processBreakdown: [] },
      warnings: [] as unknown[],
      warningCount: 0,
      calculationExplainability: null as CalculationExplainabilityMap | null,
      costAnalysisPartial: false,
      excludedBomLines: [] as unknown[],
      openBook: null as unknown,
      productType: null as string | null,
    };
  }, [backendCostAnalysis]);

  return (
    <div className="space-y-6" data-tour="products-root">
      {/* Header: filtros (esq.) + ações (dir.) — altura h-10 alinhada */}
      <div
        className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between lg:gap-6"
        data-tour="products-toolbar"
      >
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div
            className="flex flex-wrap items-center gap-2"
            role="tablist"
            aria-label="Escopo da lista de engenharia"
          >
            {(["PRODUCT", "COMPONENT"] as const).map((seg) => (
              <button
                key={seg}
                type="button"
                role="tab"
                aria-selected={engineeringSegment === seg}
                onClick={() => setEngineeringSegment(seg)}
                className={cn(
                  "h-10 shrink-0 rounded-lg border px-3 text-sm font-semibold transition-colors",
                  engineeringSegment === seg
                    ? "border-primary bg-primary text-primary-foreground shadow-sm"
                    : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                {seg === "PRODUCT" ? "Produtos" : "Componentes"}
              </button>
            ))}
          </div>
          <div
            className="flex flex-wrap items-center gap-2"
            role="group"
            aria-label="Filtros da lista de engenharia"
          >
            <div className="relative min-w-[200px] max-w-md flex-1 basis-[220px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Buscar por SKU ou nome..."
                className="h-10 w-full rounded-lg border border-border bg-card pl-10 pr-3 text-sm outline-none transition-all focus:ring-2 focus:ring-primary/20"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>

            <select
              className="h-10 min-w-[150px] shrink-0 rounded-lg border border-border bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
              value={listStatusFilter}
              onChange={(e) => setListStatusFilter(e.target.value as any)}
            >
              <option value="">Todos os status</option>
              <option value="ACTIVE">Ativo</option>
              <option value="INACTIVE">Inativo</option>
            </select>

            <button
              type="button"
              onClick={clearListFilters}
              disabled={!searchTerm.trim() && !listStatusFilter}
              className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50 disabled:hover:bg-card"
              title="Limpar filtros"
            >
              <X className="h-4 w-4 shrink-0" />
              Limpar
            </button>
          </div>

          <p className="text-xs text-muted-foreground">
            Exibindo <span className="font-bold text-foreground">{filteredItems.length}</span> de{" "}
            <span className="font-bold text-foreground">{items.length}</span> item(ns).
          </p>
        </div>
        <div
          className="flex flex-wrap items-center gap-2 lg:justify-end"
          role="group"
          aria-label="Ações da engenharia"
        >
          <TourHelpButton
            onClick={() => setTourOpen(true)}
            className="h-10 shrink-0 rounded-lg px-3 py-0 text-sm font-medium"
          />
          {selectedIds.length > 0 && canDeleteProduct ? (
            <motion.button
              type="button"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              onClick={handleBulkDelete}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-red-500/25 bg-red-500/10 px-4 text-sm font-semibold text-red-600 transition-colors hover:bg-red-500/15"
            >
              <Trash2 className="h-4 w-4 shrink-0" />
              Excluir ({selectedIds.length})
            </motion.button>
          ) : null}
          <button
            type="button"
            onClick={() => setIsImportOpen(true)}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-transparent bg-accent px-4 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90"
          >
            <Download className="h-4 w-4 shrink-0" />
            Importar
          </button>
          {canExportEngineering ? (
            <button
              type="button"
              onClick={handleExportEngineering}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-transparent bg-accent px-4 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90"
              title={selectedIds.length ? "Exportar itens selecionados no layout de importação" : "Exportar itens filtrados no layout de importação"}
            >
              <BookOpen className="h-4 w-4 shrink-0" />
              Exportar
            </button>
          ) : null}
          {canCreateProduct ? (
            <button
              type="button"
              onClick={() => handleOpenModal()}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition-opacity hover:opacity-90"
            >
              <Plus className="h-4 w-4 shrink-0" />
              Novo Item de Engenharia
            </button>
          ) : null}
        </div>
      </div>

      {canViewNomusBomReport ? (
        <>
          <NomusBomBatchReportPanel onOpenProduct={(productId) => void handleOpenProductById(productId)} />
          <NomusBomClassificationPanel onOpenProduct={(productId) => void handleOpenProductById(productId)} />
          <NomusBomApplyPlanPanel onOpenProduct={(productId) => void handleOpenProductById(productId)} />
        </>
      ) : null}

      {/* Import Dialog */}
      <DataImportDialog 
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        onSuccess={fetchData}
        config={ProductImportConfig}
        templateUrl="/api/products/import/template"
        previewUrl="/api/products/import/preview"
        confirmUrl="/api/products/import/confirm"
      />

      {/* Table */}
      <div
        className="bg-card rounded-xl border border-border overflow-hidden shadow-sm"
        data-tour="products-table"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-accent/50 border-b border-border">
                <th className="p-4 w-10">
                  <input 
                    type="checkbox" 
                    className="rounded border-border text-primary focus:ring-primary"
                    checked={filteredItems.length > 0 && selectedIds.length === filteredItems.length}
                    ref={el => {
                      if (el) {
                        el.indeterminate = selectedIds.length > 0 && selectedIds.length < filteredItems.length;
                      }
                    }}
                    onChange={toggleSelectAll}
                  />
                </th>
                <th className="p-4 font-semibold text-sm">Item</th>
                <th className="p-4 font-semibold text-sm">Tipo</th>
                <th className="p-4 font-semibold text-sm">Versão</th>
                <th className="p-4 font-semibold text-sm">Estrutura</th>
                <th className="p-4 font-semibold text-sm text-right whitespace-nowrap">
                  <span className="inline-flex items-center gap-1.5">
                    <DollarSign className="h-3.5 w-3.5 text-primary opacity-80" />
                    Custo industrial (CIU)
                  </span>
                </th>
                <th className="p-4 font-semibold text-sm">Status</th>
                <th className="p-4 font-semibold text-sm text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center">
                    <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
                    <p className="mt-2 text-sm text-muted-foreground">Carregando engenharia...</p>
                  </td>
                </tr>
              ) : filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-muted-foreground">
                    Nenhum item encontrado.
                  </td>
                </tr>
              ) : (
                filteredItems.map((item: ProductWithCostSummary) => (
                  <tr key={item.id} className={cn(
                    "hover:bg-accent/30 transition-colors group",
                    selectedIds.includes(item.id) && "bg-primary/5"
                  )}>
                    <td className="p-4">
                      <input 
                        type="checkbox" 
                        className="rounded border-border text-primary focus:ring-primary"
                        checked={selectedIds.includes(item.id)}
                        onChange={() => toggleSelect(item.id)}
                      />
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "h-9 w-9 rounded-lg flex items-center justify-center",
                          item.type === "PRODUCT" ? "bg-blue-500/10 text-blue-600" : 
                          item.type === "COMPONENT" ? "bg-purple-500/10 text-purple-600" : 
                          "bg-orange-500/10 text-orange-600"
                        )}>
                          {item.type === "PRODUCT" ? <Package className="h-5 w-5" /> : 
                           item.type === "COMPONENT" ? <Layers className="h-5 w-5" /> : 
                           <Box className="h-5 w-5" />}
                        </div>
                        <div>
                          <p className="font-medium text-sm">{item.name}</p>
                          <p className="text-xs text-muted-foreground">{item.sku}</p>
                        </div>
                      </div>
                    </td>
                    <td className="p-4">
                      <Badge variant={
                        item.type === "PRODUCT" ? "info" : 
                        item.type === "COMPONENT" ? "default" : 
                        "warning"
                      }>
                        {item.type === "PRODUCT" ? "Produto" : 
                         item.type === "COMPONENT" ? "Componente" : 
                         "Material"}
                      </Badge>
                    </td>
                    <td className="p-4 text-sm text-muted-foreground">
                      v{item.version}
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Layers className="h-3 w-3" />
                          {item.ProductBOM.length} itens
                        </div>
                        <div className="flex items-center gap-1">
                          <Settings className="h-3 w-3" />
                          {item.ProductRouting.length} etapas
                        </div>
                      </div>
                    </td>
                    <td className="p-4 text-right align-middle min-w-[8.5rem]">
                      {(() => {
                        const cs = item.costSummary;
                        if (!cs) {
                          return <span className="text-xs text-muted-foreground">—</span>;
                        }
                        if ("na" in cs && cs.na) {
                          return (
                            <span className="text-xs text-muted-foreground" title={cs.label}>
                              —
                            </span>
                          );
                        }
                        if ("unavailable" in cs && cs.unavailable) {
                          return (
                            <span
                              className="text-xs font-medium text-amber-700 dark:text-amber-400"
                              title={cs.reason}
                            >
                              Config
                            </span>
                          );
                        }
                        if ("error" in cs && cs.error) {
                          return (
                            <span
                              className="text-xs font-medium text-destructive"
                              title={cs.message || cs.code || "Custeio indisponível"}
                            >
                              —
                            </span>
                          );
                        }
                        if (
                          "totalIndustrialCost" in cs &&
                          typeof cs.totalIndustrialCost === "number" &&
                          Number.isFinite(cs.totalIndustrialCost)
                        ) {
                          return (
                            <div className="flex flex-col items-end gap-1">
                              <span className="text-sm font-bold tabular-nums tracking-tight text-primary">
                                {formatCurrency(cs.totalIndustrialCost)}
                              </span>
                              {"partial" in cs && cs.partial ? (
                                <Badge variant="warning" className="text-[9px] px-1.5 py-0 h-5 font-bold">
                                  Parcial
                                </Badge>
                              ) : null}
                            </div>
                          );
                        }
                        return <span className="text-xs text-muted-foreground">—</span>;
                      })()}
                    </td>
                    <td className="p-4">
                      <Badge variant={item.status === "ACTIVE" ? "success" : "danger"}>
                        {item.status === "ACTIVE" ? "Ativo" : "Inativo"}
                      </Badge>
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button 
                          onClick={() => handleOpenModal(item)}
                          className="p-2 rounded-md hover:bg-accent text-muted-foreground hover:text-primary transition-all"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button 
                          onClick={() => handleDelete(item.id)}
                          className="p-2 rounded-md hover:bg-accent text-muted-foreground hover:text-red-500 transition-all"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <GuidedTour
        open={tourOpen}
        onClose={() => setTourOpen(false)}
        steps={PRODUCT_TOUR_STEPS}
        tourName="Tour de Produtos"
      />

      {/* Modal: Product Form */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-card flex max-h-[90vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-border shadow-2xl"
            >
              {/* Modal Header */}
              <div className="px-5 py-4 border-b border-border flex items-start justify-between gap-3 bg-accent/30">
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <div className="h-10 w-10 shrink-0 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                    {formData.type === "PRODUCT" ? <Package className="h-5 w-5" /> : 
                     formData.type === "COMPONENT" ? <Layers className="h-5 w-5" /> : 
                     <Box className="h-5 w-5" />}
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <h3 className="text-lg font-bold leading-tight">
                      {editingItem ? "Editar Engenharia" : "Nova Engenharia"}
                    </h3>
                    <p className="text-[11px] text-muted-foreground leading-snug">
                      Defina a estrutura e o processo produtivo do item
                    </p>
                    <p
                      className="flex items-baseline gap-2 pt-1 min-w-0 text-sm"
                      data-tour="products-modal-context"
                    >
                      <span className="shrink-0 font-mono text-xs font-semibold text-primary tabular-nums">
                        {(formData.sku && String(formData.sku).trim()) || (editingItem ? "—" : "…")}
                      </span>
                      <span className="text-muted-foreground/50 shrink-0 select-none" aria-hidden>
                        ·
                      </span>
                      <span
                        className="min-w-0 truncate text-[13px] font-medium text-foreground/90"
                        title={
                          (formData.description && String(formData.description).trim()) ||
                          (formData.name && String(formData.name).trim()) ||
                          ""
                        }
                      >
                        {(formData.description && String(formData.description).trim()) ||
                          (formData.name && String(formData.name).trim()) ||
                          "—"}
                      </span>
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="p-2 hover:bg-accent rounded-full transition-colors shrink-0"
                  aria-label="Fechar"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Tabs Navigation */}
              <div
                className="px-5 pt-3 border-b border-border bg-gradient-to-b from-accent/60 to-accent/20"
                data-tour="products-modal-tabs"
              >
                <div
                  className="flex items-end gap-1.5 overflow-x-auto pb-0.5 -mb-px"
                  role="tablist"
                  aria-label="Navegação de engenharia"
                >
                  {visibleFormTabs.map((tab) => {
                    const isActive = activeFormTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        role="tab"
                        aria-selected={isActive}
                        aria-current={isActive ? "page" : undefined}
                        onClick={() => setActiveFormTab(tab.id as any)}
                        className={cn(
                          "relative inline-flex items-center gap-2.5 px-4 py-2.5 text-[13px] font-semibold whitespace-nowrap rounded-t-xl border border-transparent border-b-0 transition-[color,background-color,box-shadow,transform] duration-200",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:ring-offset-1",
                          isActive
                            ? "bg-card text-foreground border-border shadow-[0_8px_20px_-14px_rgba(0,0,0,0.5)] -mb-px"
                            : "text-muted-foreground hover:text-foreground hover:bg-background/80"
                        )}
                      >
                        <tab.icon className={cn("h-4 w-4", isActive ? "text-primary" : "opacity-80")} />
                        {tab.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              
              <form onSubmit={handleSubmit} className="flex-1 overflow-hidden flex flex-col">
                <div className="flex-1 overflow-y-auto p-6">
                  {visibleFormTabs.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-12">
                      Você não possui permissão para nenhuma aba de engenharia deste produto.
                    </p>
                  ) : null}
                  {/* Tab: Info */}
                  {activeFormTab === "info" && visibleFormTabs.some((t) => t.id === "info") && (
                    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div className="space-y-6">
                          <h4 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                            <FileText className="h-4 w-4" /> Identificação
                          </h4>
                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                              <label className="text-xs font-bold text-muted-foreground uppercase">SKU / Código</label>
                              <input
                                required
                                type="text"
                                className="w-full p-2 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm font-mono"
                                value={formData.sku}
                                onChange={(e) => setFormData({...formData, sku: e.target.value})}
                              />
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-xs font-bold text-muted-foreground uppercase">Versão</label>
                              <input
                                required
                                type="text"
                                className="w-full p-2 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm"
                                value={formData.version}
                                onChange={(e) => setFormData({...formData, version: e.target.value})}
                              />
                            </div>
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-xs font-bold text-muted-foreground uppercase">Nome do Item</label>
                            <input
                              required
                              type="text"
                              className="w-full p-2 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm"
                              value={formData.name}
                              onChange={(e) => setFormData({...formData, name: e.target.value})}
                            />
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-xs font-bold text-muted-foreground uppercase">Descrição</label>
                            <textarea
                              rows={3}
                              className="w-full p-2 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm resize-none"
                              value={formData.description}
                              onChange={(e) => setFormData({...formData, description: e.target.value})}
                            />
                          </div>
                        </div>

                        <div className="space-y-6">
                          <h4 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                            <Cpu className="h-4 w-4" /> Configurações
                          </h4>
                          <div className="space-y-4">
                            <label className="text-xs font-bold text-muted-foreground uppercase">Tipo de Item</label>
                            <div className="grid grid-cols-3 gap-3">
                              {[
                                { id: "PRODUCT", label: "Produto", icon: Package, desc: "Item final de venda" },
                                { id: "COMPONENT", label: "Componente", icon: Layers, desc: "Sub-conjunto produzido" },
                                { id: "MATERIAL", label: "Material", icon: Box, desc: "Insumo ou matéria-prima" },
                              ].map((type) => (
                                <button
                                  key={type.id}
                                  type="button"
                                  onClick={() => {
                                    setFormData({
                                      ...formData, 
                                      type: type.id as ItemType,
                                      // Reset BOM/Routing if switching to Material
                                      bom: type.id === "MATERIAL" ? [] : formData.bom,
                                      routing: type.id === "MATERIAL" ? [] : formData.routing
                                    });
                                  }}
                                  className={cn(
                                    "flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all text-center group",
                                    formData.type === type.id 
                                      ? "border-primary bg-primary/5 text-primary" 
                                      : "border-border hover:border-primary/50 hover:bg-accent"
                                  )}
                                >
                                  <type.icon className={cn("h-6 w-6", formData.type === type.id ? "text-primary" : "text-muted-foreground group-hover:text-primary")} />
                                  <div>
                                    <p className="text-xs font-bold">{type.label}</p>
                                    <p className="text-[10px] opacity-60 leading-tight">{type.desc}</p>
                                  </div>
                                </button>
                              ))}
                            </div>
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-xs font-bold text-muted-foreground uppercase">Lote Padrão de Produção</label>
                            <input
                              required
                              type="number"
                              className="w-full p-2 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm"
                              value={formData.defaultLotSize}
                              onChange={(e) => setFormData({...formData, defaultLotSize: parseInt(e.target.value)})}
                            />
                            <p className="text-[10px] text-muted-foreground">Quantidade base para cálculos de custo e roteiro</p>
                          </div>
                        </div>
                      </div>
                      
                      {formData.type === "COMPONENT" && (
                        <div className="mt-6 border border-border rounded-xl bg-card overflow-hidden">
                          <div className="bg-muted px-4 py-3 border-b border-border">
                            <h4 className="font-bold text-sm text-foreground flex items-center gap-2">
                              <Cpu className="h-4 w-4 text-primary"/> Processo Padrão de Produção
                            </h4>
                            <p className="text-[10px] text-muted-foreground mt-0.5">Parâmetros formadores do Custo do Componente (Substitui Roteiro e Herda a Carga Indireta Global).</p>
                          </div>
                          <div className="p-4 grid grid-cols-2 lg:grid-cols-4 gap-4 bg-muted/30">
                            <div>
                              <label className="text-[10px] font-bold text-muted-foreground uppercase">Ciclo (Segundos)</label>
                              <input 
                                type="number" step="0.1"
                                value={formData.cycleTimeSeconds ?? ""}
                                onChange={(e) => setFormData({...formData, cycleTimeSeconds: e.target.value})}
                                className="w-full p-2 text-sm border rounded-lg focus:ring-1 outline-none mt-1 bg-background" 
                                placeholder="Tempo limpo" 
                              />
                            </div>
                            <div>
                              <label className="text-[10px] font-bold text-muted-foreground uppercase">Cavidades (Molde)</label>
                              <input 
                                type="number"
                                value={formData.cavities ?? ""}
                                onChange={(e) => setFormData({...formData, cavities: e.target.value})}
                                className="w-full p-2 text-sm border rounded-lg focus:ring-1 outline-none mt-1 bg-background" 
                                placeholder="1"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] font-bold text-muted-foreground uppercase">Setup (Min/Lote)</label>
                              <input 
                                type="number" step="0.1"
                                value={formData.setupTimeMin ?? ""}
                                onChange={(e) => setFormData({...formData, setupTimeMin: e.target.value})}
                                className="w-full p-2 text-sm border rounded-lg focus:ring-1 outline-none mt-1 bg-background" 
                              />
                            </div>
                            <div>
                              <label className="text-[10px] font-bold text-muted-foreground uppercase">Eficiência (%)</label>
                              <input 
                                type="number"
                                value={formData.efficiencyExpected ?? ""}
                                onChange={(e) => setFormData({...formData, efficiencyExpected: e.target.value})}
                                className="w-full p-2 text-sm border rounded-lg focus:ring-1 outline-none mt-1 bg-background" 
                                placeholder="Ex: 95" 
                              />
                            </div>
                          </div>
                        </div>
                      )}
                      
                    </div>
                  )}

                  {/* Tab: BOM */}
                  {activeFormTab === "bom" && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                      {formData.type === "MATERIAL" ? (
                        <div className="flex flex-col items-center justify-center py-20 text-center space-y-4 bg-accent/20 rounded-2xl border-2 border-dashed border-border">
                          <div className="h-16 w-16 rounded-full bg-orange-500/10 flex items-center justify-center text-orange-500">
                            <Box className="h-8 w-8" />
                          </div>
                          <div className="max-w-md">
                            <h4 className="text-lg font-bold">Item do tipo Material</h4>
                            <p className="text-sm text-muted-foreground">
                              Materiais são considerados "nós folha" na estrutura. Eles não possuem uma lista de materiais (BOM) própria, pois são comprados e não produzidos.
                            </p>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center justify-between">
                            <div>
                              <h4 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                                <Layers className="h-4 w-4" /> Composição do Item
                              </h4>
                              <p className="text-xs text-muted-foreground mt-1">
                                {formData.type === "PRODUCT"
                                  ? "Produtos finais podem listar outros PRODUTOS ou COMPONENTES fabricados e/ou MATERIAIS comprados (custo aterrissado)."
                                  : "Componentes podem conter PRODUTOS, outros COMPONENTES e MATERIAIS."}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={addBOMItem}
                              className="flex items-center gap-2 bg-primary/10 text-primary px-4 py-2 rounded-lg text-xs font-bold hover:bg-primary/20 transition-colors"
                            >
                              <Plus className="h-4 w-4" />
                              Adicionar Item
                            </button>
                          </div>

                          {canCompareNomusBom ? (
                            <NomusBomComparisonPanel
                              productId={editingItem?.id}
                              disabled={bomOptionsLoading}
                            />
                          ) : null}

                          <div className="space-y-3">
                            {bomOptionsLoading ? (
                              <p className="text-xs text-muted-foreground flex items-center gap-2">
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                Carregando catálogo de itens da estrutura…
                              </p>
                            ) : null}
                            {formData.bom.length === 0 ? (
                              <div className="text-center py-12 border-2 border-dashed border-border rounded-xl">
                                <p className="text-sm text-muted-foreground">Nenhum item adicionado à estrutura.</p>
                              </div>
                            ) : (
                              formData.bom.map((item, idx) => (
                                <div key={idx} className="grid grid-cols-12 gap-4 p-4 bg-accent/20 rounded-xl border border-border items-end group relative">
                                  <div className="col-span-4 space-y-1.5">
                                    <label className="text-[10px] font-bold text-muted-foreground uppercase">
                                      Item (matéria-prima, produto ou componente)
                                    </label>
                                    <SearchableSelect
                                      placeholder="Selecione um item..."
                                      options={bomSelectOptions}
                                      value={
                                        item.materialId
                                          ? `material:${item.materialId}`
                                          : item.childProductId
                                            ? `product:${item.childProductId}`
                                            : ""
                                      }
                                      onChange={(val) => setBomLineMaterialOrChild(idx, val)}
                                      disabled={bomOptionsLoading}
                                    />
                                  </div>
                                  <div className="col-span-2 space-y-1.5">
                                    <label className="text-[10px] font-bold text-muted-foreground uppercase">Qtd. Líquida</label>
                                    <input
                                      type="number"
                                      step="0.0001"
                                      className="w-full p-2 rounded-lg border border-border bg-background text-sm outline-none focus:ring-2 focus:ring-primary/20"
                                      value={item.quantity}
                                      onChange={(e) => updateBOMItem(idx, "quantity", parseFloat(e.target.value))}
                                    />
                                  </div>
                                  <div className="col-span-2 space-y-1.5">
                                    <label className="text-[10px] font-bold text-muted-foreground uppercase">Perda (%)</label>
                                    <input
                                      type="number"
                                      step="0.1"
                                      className="w-full p-2 rounded-lg border border-border bg-background text-sm outline-none focus:ring-2 focus:ring-primary/20"
                                      value={item.lossPercentage}
                                      onChange={(e) => updateBOMItem(idx, "lossPercentage", parseFloat(e.target.value))}
                                    />
                                  </div>
                                  <div className="col-span-3 space-y-1.5">
                                    <label className="text-[10px] font-bold text-muted-foreground uppercase">Observações</label>
                                    <input
                                      type="text"
                                      className="w-full p-2 rounded-lg border border-border bg-background text-sm outline-none focus:ring-2 focus:ring-primary/20"
                                      value={item.notes || ""}
                                      onChange={(e) => updateBOMItem(idx, "notes", e.target.value)}
                                    />
                                  </div>
                                  <div className="col-span-1 flex justify-end pb-1">
                                    <button
                                      type="button"
                                      onClick={() => removeBOMItem(idx)}
                                      className="p-2 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-all"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </button>
                                  </div>
                                </div>
                              ))
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {/* Tab: Routing */}
                  {activeFormTab === "routing" && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                      {formData.type === "MATERIAL" ? (
                        <div className="flex flex-col items-center justify-center py-20 text-center space-y-4 bg-accent/20 rounded-2xl border-2 border-dashed border-border">
                          <div className="h-16 w-16 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-500">
                            <Settings className="h-8 w-8" />
                          </div>
                          <div className="max-w-md">
                            <h4 className="text-lg font-bold">Processo não aplicável</h4>
                            <p className="text-sm text-muted-foreground">
                              Materiais não possuem roteiro de produção interno, pois são itens adquiridos de fornecedores externos.
                            </p>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center justify-between">
                            <div>
                              <h4 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                                <Settings className="h-4 w-4" /> Roteiro de Produção
                              </h4>
                              <p className="text-xs text-muted-foreground mt-1">Defina as etapas, máquinas e tempos necessários para produzir este item.</p>
                            </div>
                            <button
                              type="button"
                              onClick={addRoutingStep}
                              className="flex items-center gap-2 bg-primary/10 text-primary px-4 py-2 rounded-lg text-xs font-bold hover:bg-primary/20 transition-colors"
                            >
                              <Plus className="h-4 w-4" />
                              Adicionar Etapa
                            </button>
                          </div>

                          <div className="space-y-4">
                            {formData.routing.length === 0 ? (
                              <div className="text-center py-12 border-2 border-dashed border-border rounded-xl">
                                <p className="text-sm text-muted-foreground">Nenhuma etapa de produção definida.</p>
                              </div>
                            ) : (
                              formData.routing
                                .sort((a, b) => a.sequence - b.sequence)
                                .map((step, idx) => (
                                <div key={idx} className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
                                  <div className="bg-accent/30 px-4 py-2 border-b border-border flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                      <span className="bg-primary text-primary-foreground text-[10px] font-black px-2 py-0.5 rounded">
                                        SEQ {step.sequence}
                                      </span>
                                      <input 
                                        type="text"
                                        placeholder="Descrição da operação..."
                                        className="bg-transparent border-none outline-none text-sm font-bold placeholder:text-muted-foreground/50 w-64"
                                        value={step.description || ""}
                                        onChange={(e) => updateRoutingStep(idx, "description", e.target.value)}
                                      />
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => removeRoutingStep(idx)}
                                      className="text-muted-foreground hover:text-red-500 transition-colors"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </button>
                                  </div>
                                  <div className="p-4 grid grid-cols-1 md:grid-cols-4 gap-6">
                                    <div className="space-y-1.5">
                                      <label className="text-[10px] font-bold text-muted-foreground uppercase">Máquina / Centro Custo</label>
                                      <SearchableSelect
                                        placeholder="Selecione..."
                                        options={machines.map(m => ({
                                          value: m.id,
                                          label: `${m.code} — ${m.name}`,
                                          sublabel: "Máquina / centro",
                                          searchTerms: `${m.code} ${m.name}`,
                                        }))}
                                        value={step.machineId || ""}
                                        onChange={(val) => updateRoutingStep(idx, "machineId", val)}
                                      />
                                    </div>
                                    <div className="space-y-1.5">
                                      <label className="text-[10px] font-bold text-muted-foreground uppercase">Mão de Obra (Cargo)</label>
                                      <SearchableSelect
                                        placeholder="Selecione..."
                                        options={roles.map(r => ({
                                          value: r.id,
                                          label: r.name,
                                          searchTerms: r.name,
                                        }))}
                                        value={step.roleId || ""}
                                        onChange={(val) => updateRoutingStep(idx, "roleId", val)}
                                      />
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                      <div className="space-y-1.5">
                                        <label className="text-[10px] font-bold text-muted-foreground uppercase">Setup (min)</label>
                                        <input
                                          type="number"
                                          step="0.00001"
                                          className="w-full p-2 rounded-lg border border-border bg-background text-sm outline-none focus:ring-2 focus:ring-primary/20"
                                          value={step.setupTimeMin}
                                          onChange={(e) => updateRoutingStep(idx, "setupTimeMin", parseFloat(e.target.value))}
                                        />
                                      </div>
                                      <div className="space-y-1.5">
                                        <label className="text-[10px] font-bold text-muted-foreground uppercase">Op. (min)</label>
                                        <input
                                          type="number"
                                          step="0.00001"
                                          className="w-full p-2 rounded-lg border border-border bg-background text-sm outline-none focus:ring-2 focus:ring-primary/20"
                                          value={step.operationTimeMin}
                                          onChange={(e) => updateRoutingStep(idx, "operationTimeMin", parseFloat(e.target.value))}
                                        />
                                      </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                      <div className="space-y-1.5">
                                        <label className="text-[10px] font-bold text-muted-foreground uppercase">Eficiência (%)</label>
                                        <input
                                          type="number"
                                          step="0.00001"
                                          className="w-full p-2 rounded-lg border border-border bg-background text-sm outline-none focus:ring-2 focus:ring-primary/20"
                                          value={step.efficiencyExpected}
                                          onChange={(e) => updateRoutingStep(idx, "efficiencyExpected", parseFloat(e.target.value))}
                                        />
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              ))
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {/* Tab: Tree View */}
                  {activeFormTab === "tree" && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                      {formData.type === "MATERIAL" ? (
                        <div className="flex flex-col items-center justify-center py-20 text-center space-y-4 bg-accent/20 rounded-2xl border-2 border-dashed border-border">
                          <div className="h-16 w-16 rounded-full bg-orange-500/10 flex items-center justify-center text-orange-500">
                            <Box className="h-8 w-8" />
                          </div>
                          <div className="max-w-md">
                            <h4 className="text-lg font-bold">Item do tipo Material</h4>
                            <p className="text-sm text-muted-foreground">Materiais não possuem sub-estrutura.</p>
                          </div>
                        </div>
                      ) : editingItem?.id ? (
                        <ProductBomTreeContextPanel
                          treeData={treeData}
                          loadingTree={loadingTree}
                          rootProductId={editingItem.id}
                          rootName={formData.name || editingItem.name}
                          rootSku={formData.sku || editingItem.sku}
                          rootType={formData.type}
                          onReloadTree={reloadTree}
                          onAfterMutation={fetchData}
                          onOpenFullProductEdit={(p) => handleOpenModal(p)}
                        />
                      ) : (
                        <p className="text-sm text-muted-foreground">Salve o item para visualizar a árvore.</p>
                      )}
                    </div>
                  )}

                  {/* Tab: Cost Analysis */}
                  {activeFormTab === "composition" && (
                    <OpenBookCompositionTab
                      loading={loadingCost}
                      costAnalysisPartial={displayCost.costAnalysisPartial}
                      openBook={displayCost.openBook as OpenBookPayload | null}
                    />
                  )}

                  {activeFormTab === "cost" && (
                    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
                      {costAnalysisError && (
                        <AppAlert variant="destructive" title="Análise de custo indisponível" role="alert">
                          <p className="text-xs whitespace-pre-wrap break-words opacity-95">{costAnalysisError}</p>
                        </AppAlert>
                      )}
                      {!costAnalysisError && displayCost.costAnalysisPartial && (
                        <AppAlert variant="warning" role="status" showIcon={false} className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="warning">Cálculo parcial</Badge>
                            <span className="font-semibold">Um ou mais itens da BOM não foram custeados.</span>
                          </div>
                          <p className="text-xs opacity-95">
                            O total exibido nos cards soma apenas os itens com cadastro suficiente para custeio.
                            Itens excluídos aparecem em vermelho na tabela abaixo; passe o mouse para ver o motivo e o que
                            corrigir.
                          </p>
                          {displayCost.excludedBomLines.length > 0 && (
                            <p className="text-[11px] mt-2 font-mono opacity-95">
                              Exclusões: {displayCost.excludedBomLines.length} linha(s)
                            </p>
                          )}
                        </AppAlert>
                      )}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="p-6 rounded-2xl bg-blue-500/5 border border-blue-500/20 flex flex-col gap-2">
                          <div className="flex items-center justify-between">
                            <p className="text-xs font-bold text-blue-600 uppercase">Custo da estrutura (BOM)</p>
                            <Layers className="h-4 w-4 text-blue-500" />
                          </div>
                          <CalculatedValue meta={displayCost.calculationExplainability?.totalMaterialCost ?? null}>
                            <p className="text-3xl font-black text-blue-700">{formatCurrency(displayCost.bomCost)}</p>
                          </CalculatedValue>
                          <p className="text-[10px] text-blue-600/60">
                            Soma das linhas da BOM (matérias-primas e/ou CIU dos componentes), conforme o motor.
                          </p>
                        </div>
                        <div className="p-6 rounded-2xl bg-purple-500/5 border border-purple-500/20 flex flex-col gap-2">
                          <div className="flex items-center justify-between">
                            <p className="text-xs font-bold text-purple-600 uppercase">Conversão (HH + HM)</p>
                            <Settings className="h-4 w-4 text-purple-500" />
                          </div>
                          <CalculatedValue meta={displayCost.calculationExplainability?.totalConversionCost ?? null}>
                            <p className="text-3xl font-black text-purple-700">{formatCurrency(displayCost.routingCost)}</p>
                          </CalculatedValue>
                          <p className="text-[10px] text-purple-600/60">Processo padrão ou roteiro; sem CIF rateado</p>
                          <p className="text-[10px] text-muted-foreground leading-snug">
                            O motor usa primeiro o <strong>processo padrão</strong> do componente (ciclo/cavidades na aba
                            Informações). Só se ele estiver vazio é que entra o <strong>roteiro</strong> (aba Processo).
                            Remover só o roteiro não zera a conversão se o processo padrão continuar preenchido.
                          </p>
                        </div>
                        <div className="p-6 rounded-2xl bg-primary/10 border border-primary/20 flex flex-col gap-2">
                          <div className="flex items-center justify-between">
                            <p className="text-xs font-bold text-primary uppercase">Custo Industrial (CIU)</p>
                            <TrendingUp className="h-4 w-4 text-primary" />
                          </div>
                          <CalculatedValue meta={displayCost.calculationExplainability?.totalIndustrialCost ?? null}>
                            <p className="text-3xl font-black text-primary">{formatCurrency(displayCost.total)}</p>
                          </CalculatedValue>
                          {displayCost.costAnalysisPartial && (
                            <p className="text-[10px] font-bold text-amber-900 dark:text-amber-200">
                              Total parcial — exclui itens não custeados na BOM.
                            </p>
                          )}
                          <p className="text-[10px] text-primary/60 flex flex-wrap items-center gap-1">
                            <span>MP + HH + HM (CIF referência: </span>
                            <CalculatedValue meta={displayCost.calculationExplainability?.totalCIF_Unit ?? null} hideIcon>
                              <span>{formatCurrency(displayCost.cifCost)}</span>
                            </CalculatedValue>
                            <span>)</span>
                          </p>
                        </div>
                      </div>

                      {!loadingCost && displayCost.warningCount > 0 && (
                        <AppAlert variant="warning" role="alert" className="space-y-2">
                          <div className="space-y-1.5 min-w-0">
                            <p className="text-sm font-semibold">
                              A análise foi concluída, mas existem {displayCost.warningCount}{" "}
                              {displayCost.warningCount === 1 ? "alerta" : "alertas"} que exigem revisão.
                            </p>
                            <ul className="text-xs space-y-1.5 list-disc pl-4 marker:text-amber-800 dark:marker:text-amber-400">
                              {(displayCost.warnings as Array<{ message?: string }>).map((w, i) => (
                                <li key={i}>{typeof w?.message === "string" ? w.message : String(w)}</li>
                              ))}
                            </ul>
                          </div>
                        </AppAlert>
                      )}

                      <p className="text-[11px] text-muted-foreground text-center px-2">
                        Conciliação: MP + HH + HM = CIU; CIF não entra no total (mesmo motor de{" "}
                        <code className="text-[10px] bg-accent px-1 rounded">/api/products/:id/cost-analysis</code>).
                      </p>

                      <div className="grid grid-cols-1 gap-8 lg:grid-cols-5 lg:gap-6 xl:gap-8">
                        {/* BOM Breakdown — coluna mais estreita (mais números, menos texto) */}
                        <div className="min-w-0 space-y-3 lg:col-span-2">
                          <div className="space-y-1">
                            <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                              Detalhamento BOM
                            </h4>
                            <p className="text-[11px] leading-relaxed text-muted-foreground">
                              Estrutura salva: quantidades com perda e custo por linha (MP ou CIU do componente).
                            </p>
                          </div>
                          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm ring-1 ring-border/30">
                            <div className="max-h-[min(52vh,26rem)] overflow-auto overscroll-y-contain">
                              <table className="w-full table-fixed border-collapse text-left text-[13px] leading-snug">
                                <colgroup>
                                  <col style={{ width: "46%" }} />
                                  <col style={{ width: "14%" }} />
                                  <col style={{ width: "20%" }} />
                                  <col style={{ width: "20%" }} />
                                </colgroup>
                                <thead className="sticky top-0 z-10 border-b border-border bg-accent/95 backdrop-blur-sm supports-[backdrop-filter]:bg-accent/85">
                                  <tr>
                                    <th className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                                      Item
                                    </th>
                                    <th className="px-3 py-2.5 text-right text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                                      Qtd
                                    </th>
                                    <th className="px-3 py-2.5 text-right text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                                      Custo unit.
                                    </th>
                                    <th className="px-3 py-2.5 text-right text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                                      Total
                                    </th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-border [&>tr:nth-child(even)]:bg-muted/15">
                                  {loadingCost ? (
                                    <tr>
                                      <td colSpan={4} className="px-3 py-8 text-center text-sm text-muted-foreground">
                                        Carregando análise do backend...
                                      </td>
                                    </tr>
                                  ) : displayCost.details.materials.length === 0 ? (
                                    <tr>
                                      <td colSpan={4} className="px-3 py-8 text-center text-sm text-muted-foreground">
                                        Nenhum material ou componente na estrutura salva.
                                      </td>
                                    </tr>
                                  ) : (
                                    displayCost.details.materials.map((item: BomCostDetailRowData, idx: number) => (
                                      <React.Fragment key={`${item.description}-${idx}`}>
                                        <BomCostDetailRow item={item} />
                                      </React.Fragment>
                                    ))
                                  )}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </div>

                        {/* Processamento — coluna mais larga (mais texto e contexto) */}
                        <div className="min-w-0 space-y-3 lg:col-span-3">
                          <div className="space-y-2">
                            <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                              Detalhamento processo
                            </h4>
                            <div className="rounded-lg border border-border/70 bg-muted/25 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                              {displayCost.productType === "PRODUCT" ? (
                                <>
                                  <span className="font-semibold text-foreground/85">Produto: </span>
                                  mostra o processo próprio (ciclo/roteiro), quando houver, e linhas{" "}
                                  <span className="font-semibold text-foreground/85">“Estrutura (BOM)”</span> com a
                                  conversão (HH/HM) dos componentes fabricados na unidade do produto — mesma parcela do
                                  motor, sem duplicar.
                                </>
                              ) : (
                                <>
                                  <span className="font-semibold text-foreground/85">Componente: </span>
                                  origem do custo na linha abaixo (processo padrão ou roteiro). Detalhe técnico permanece
                                  no ícone de memória de cálculo.
                                </>
                              )}
                            </div>
                          </div>
                          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm ring-1 ring-border/30">
                            <div className="max-h-[min(56vh,30rem)] overflow-auto overscroll-y-contain">
                              <table className="w-full table-fixed border-collapse text-left text-[13px] leading-snug">
                                <colgroup>
                                  <col style={{ width: "44%" }} />
                                  <col style={{ width: "11%" }} />
                                  <col style={{ width: "15%" }} />
                                  <col style={{ width: "15%" }} />
                                  <col style={{ width: "15%" }} />
                                </colgroup>
                                <thead className="sticky top-0 z-10 border-b border-border bg-accent/95 backdrop-blur-sm supports-[backdrop-filter]:bg-accent/85">
                                  <tr>
                                    <th className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                                      Operação / componente
                                    </th>
                                    <th className="px-3 py-2.5 text-right text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                                      Tempo (min)
                                    </th>
                                    <th className="px-3 py-2.5 text-right text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                                      Custo máq.
                                    </th>
                                    <th className="px-3 py-2.5 text-right text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                                      Custo HH
                                    </th>
                                    <th className="px-3 py-2.5 text-right text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                                      Total
                                    </th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-border [&>tr:nth-child(even)]:bg-muted/15">
                                  {loadingCost ? (
                                    <tr>
                                      <td colSpan={5} className="px-3 py-8 text-center text-sm text-muted-foreground">
                                        Carregando análise do backend...
                                      </td>
                                    </tr>
                                  ) : !displayCost.details.processBreakdown ||
                                    displayCost.details.processBreakdown.length === 0 ? (
                                    <tr>
                                      <td colSpan={5} className="px-3 py-8 text-center text-sm text-muted-foreground">
                                        Nenhum processo configurado.
                                      </td>
                                    </tr>
                                  ) : (
                                  displayCost.details.processBreakdown.map((step: any, idx: number) => {
                                    const rollupBom = Boolean(step?.rollupFromBom || step?.calculationDetails?.rollupFromBom);
                                    const processOriginLabel =
                                      step?.source === "ROUTING"
                                        ? "Roteiro"
                                        : step?.source === "STANDARD_PROCESS"
                                          ? "Processo padrão"
                                          : "—";
                                    const timeCell =
                                      step?.timeMin != null && Number.isFinite(Number(step.timeMin))
                                        ? formatNumber(Number(step.timeMin), 2)
                                        : "—";
                                    const tooltipBadge = rollupBom
                                      ? "ESTRUTURA (BOM)"
                                      : step?.source === "STANDARD_PROCESS"
                                        ? "PROCESSO PADRÃO"
                                        : "ROTEIRO";
                                    return (
                                    <tr key={idx} className="group align-top">
                                      <td className="px-3 py-2.5 align-top">
                                        <div className="flex items-start gap-2">
                                          <div className="min-w-0 flex-1 pr-1">
                                            <div className="break-words font-medium text-foreground leading-snug">
                                              {step.description}
                                            </div>
                                            <div className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                                              {rollupBom ? (
                                                <>
                                                  <span className="text-muted-foreground/90">Origem no componente:</span>{" "}
                                                  <span className="font-medium text-foreground/90">{processOriginLabel}</span>
                                                  <span className="mx-1.5 text-border">·</span>
                                                  <span className="font-medium text-amber-900/85 dark:text-amber-200/90">
                                                    Conversão na unidade do produto
                                                  </span>
                                                </>
                                              ) : (
                                                <>
                                                  <span className="text-muted-foreground/90">Origem do custo:</span>{" "}
                                                  <span className="font-medium text-foreground/90">{processOriginLabel}</span>
                                                </>
                                              )}
                                            </div>
                                          </div>
                                          {step.calculationDetails && (
                                            <div className="group/tooltip relative shrink-0 pt-0.5">
                                              <Info className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help hover:text-primary transition-colors" />
                                              <div className="fixed z-[99] invisible group-hover/tooltip:visible bg-popover text-popover-foreground border shadow-xl rounded-xl p-4 w-80 text-[11px] pointer-events-none -translate-x-1/2 left-1/2 bottom-full mb-2 animate-in fade-in zoom-in-95 duration-200">
                                                <div className="space-y-3">
                                                  <div className="flex items-center justify-between border-b pb-2 mb-2">
                                                    <span className="font-bold uppercase text-[9px]">Memória de Cálculo</span>
                                                    <span className="bg-primary/10 text-primary px-1.5 py-0.5 rounded text-[8px] font-mono">
                                                      {tooltipBadge}
                                                    </span>
                                                  </div>

                                                  {rollupBom ? (
                                                    <div className="space-y-2 text-[11px] leading-relaxed">
                                                      <p>
                                                        Parcela de <b>HH/HM</b> do componente{" "}
                                                        <b>{String(step.calculationDetails?.childSku ?? "")}</b>{" "}
                                                        incorporada na <b>unidade do produto pai</b>, com a mesma escala
                                                        usada no motor (<code className="text-[10px]">scaleChildContribution</code>
                                                        ).
                                                      </p>
                                                      <p>
                                                        Qtd estrutura (com perda):{" "}
                                                        <b>{formatNumber(Number(step.calculationDetails?.requiredQty ?? 0), 4)}</b>
                                                      </p>
                                                      <p>
                                                        Tempo produtivo do componente (h/unid.):{" "}
                                                        <b>
                                                          {Number(step.calculationDetails?.childOwnProductiveTimeH_Unit) > 0
                                                            ? formatNumber(
                                                                Number(step.calculationDetails.childOwnProductiveTimeH_Unit),
                                                                4
                                                              )
                                                            : "—"}
                                                        </b>
                                                      </p>
                                                      <p>
                                                        Origem do processo no componente:{" "}
                                                        <b>
                                                          {step.calculationDetails?.processSource === "ROUTING"
                                                            ? "Roteiro"
                                                            : "Processo padrão"}
                                                        </b>
                                                      </p>
                                                    </div>
                                                  ) : (
                                                    <>
                                                  <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                                                    <div>
                                                      <p className="opacity-50 uppercase text-[8px] font-bold">Variáveis Entrada</p>
                                                      <p>Ciclo: <b>{formatNumber(step.calculationDetails.cycle, 5)}s</b></p>
                                                      <p>Cav: <b>{step.calculationDetails.cavities}</b></p>
                                                      <p>Eficiência: <b>{formatNumber(step.calculationDetails.efficiency, 5)}%</b></p>
                                                    </div>
                                                    <div>
                                                      <p className="opacity-50 uppercase text-[8px] font-bold">Setup e Lote</p>
                                                      <p>Lote Padrão: <b>{step.calculationDetails.lotSize}</b></p>
                                                      <p>Tempo Setup: <b>{step.calculationDetails.setupTimeMin}min</b></p>
                                                    </div>
                                                  </div>

                                                  <div className="bg-accent/30 p-2 rounded-lg space-y-1">
                                                    <p className="opacity-50 uppercase text-[8px] font-bold">Fórmulas (Unitário)</p>
                                                    <p>Pç/Hora Líq: <b>{formatNumber(step.calculationDetails.netPph, 5)}</b></p>
                                                    <p>Custo Transf: <b>{formatCurrency(step.calculationDetails.unitTransform)}</b></p>
                                                    <p>Custo Setup: <b>{formatCurrency(step.calculationDetails.setupCost)}</b></p>
                                                  </div>
                                                    </>
                                                  )}

                                                  <div className="pt-2 border-t flex justify-between items-center text-[10px]">
                                                    <span className="font-bold">TOTAL OPERAÇÃO</span>
                                                    <span className="font-black text-primary text-base">{formatCurrency(step.total)}</span>
                                                  </div>
                                                </div>
                                                <div className="absolute top-full left-1/2 -translate-x-1/2 border-l-8 border-r-8 border-t-8 border-l-transparent border-r-transparent border-t-popover" />
                                              </div>
                                            </div>
                                          )}
                                        </div>
                                      </td>
                                      <td className="px-3 py-2.5 text-right align-middle tabular-nums text-muted-foreground">
                                        {timeCell}
                                      </td>
                                      <td className="px-3 py-2.5 text-right align-middle tabular-nums">
                                        {formatCurrency(step.machineCost)}
                                      </td>
                                      <td className="px-3 py-2.5 text-right align-middle tabular-nums">
                                        {formatCurrency(step.laborCost)}
                                      </td>
                                      <td className="px-3 py-2.5 text-right align-middle tabular-nums font-semibold text-foreground">
                                        {formatCurrency(step.total)}
                                      </td>
                                    </tr>
                                    );
                                  })
                                  )}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Modal Footer */}
                <div className="p-6 border-t border-border bg-accent/10 flex items-center justify-between">
                  <div className="flex items-center gap-6">
                    <div className="flex flex-col">
                      <p className="text-[10px] font-bold text-muted-foreground uppercase">Custo Industrial</p>
                      <p className="text-lg font-black text-primary">{formatCurrency(displayCost.total)}</p>
                      {displayCost.costAnalysisPartial && (
                        <span className="text-[10px] font-bold text-amber-900 dark:text-amber-200">Parcial</span>
                      )}
                    </div>
                    <div className="h-8 w-px bg-border" />
                    <div className="flex flex-col">
                      <p className="text-[10px] font-bold text-muted-foreground uppercase">Itens BOM</p>
                      <p className="text-lg font-black">{formData.bom.length}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <button 
                      type="button"
                      onClick={() => setIsModalOpen(false)}
                      className="px-6 py-2 rounded-lg font-medium hover:bg-accent transition-colors text-sm"
                    >
                      Cancelar
                    </button>
                    <button 
                      type="submit"
                      className="flex items-center gap-2 px-8 py-2 rounded-lg font-bold bg-primary text-primary-foreground hover:opacity-90 transition-opacity text-sm shadow-lg shadow-primary/20"
                    >
                      <Save className="h-4 w-4" />
                      {editingItem ? "Salvar Alterações" : "Criar Item de Engenharia"}
                    </button>
                  </div>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
