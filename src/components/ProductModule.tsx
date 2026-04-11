import React, { useEffect, useState, useMemo } from "react";
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
  Download
} from "lucide-react";
import { cn, formatCurrency, formatNumber } from "@/src/lib/utils";
import { fetchJsonOk } from "@/src/lib/http";
import { SearchableSelect } from "./shared/SearchableSelect";
import { Product, CreateProductInput, ItemType, ProductBOM, ProductRouting } from "@/src/types/product";
import { Material } from "@/src/types/material";
import { motion, AnimatePresence } from "motion/react";
import { DataImportDialog } from "./shared/DataImportDialog";
import { ProductImportConfig } from "../lib/importer/ProductConfig";

/* -------------------------------------------------------------------------- */
/*                                Sub-Components                              */
/* -------------------------------------------------------------------------- */

const Badge = ({ children, variant = "default" }: { children: React.ReactNode, variant?: "default" | "success" | "warning" | "danger" | "info" }) => {
  const variants = {
    default: "bg-accent text-accent-foreground",
    success: "bg-green-500/10 text-green-600",
    warning: "bg-yellow-500/10 text-yellow-600",
    danger: "bg-red-500/10 text-red-600",
    info: "bg-blue-500/10 text-blue-600",
  };
  return (
    <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider", variants[variant])}>
      {children}
    </span>
  );
};

const TreeNode: React.FC<{ node: any }> = ({ node }) => {
  const isComponent = node.type === "COMPONENT";
  const name = isComponent ? node.item?.name : node.item?.description;
  const code = isComponent ? node.item?.sku : node.item?.code;

  return (
    <div className="relative">
      <div className="absolute -left-6 top-4 w-6 h-px bg-border" />
      <div className="flex items-center gap-3 p-3 bg-accent/30 rounded-lg border border-border group hover:border-primary/30 transition-colors">
        <div className={cn(
          "h-8 w-8 rounded flex items-center justify-center",
          isComponent ? "bg-purple-500/10 text-purple-600" : "bg-orange-500/10 text-orange-600"
        )}>
          {isComponent ? <Layers className="h-4 w-4" /> : <Box className="h-4 w-4" />}
        </div>
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold">{name || "Desconhecido"}</p>
            <p className="text-[10px] font-bold text-primary">Qtd: {Number(node.quantity)}</p>
          </div>
          <p className="text-[10px] text-muted-foreground font-mono">{code}</p>
        </div>
      </div>
      
      {isComponent && node.item?.children && node.item.children.length > 0 && (
        <div className="ml-6 border-l-2 border-border pl-6 mt-2 space-y-2">
          {node.item.children.map((childNode: any, cIdx: number) => (
            <TreeNode key={cIdx} node={childNode} />
          ))}
        </div>
      )}
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/*                                Main Module                                 */
/* -------------------------------------------------------------------------- */

export const ProductModule = () => {
  const [items, setItems] = useState<Product[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [machines, setMachines] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Product | null>(null);
  const [activeFormTab, setActiveFormTab] = useState<"info" | "bom" | "routing" | "cost" | "tree">("info");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [treeData, setTreeData] = useState<any>(null);
  const [loadingTree, setLoadingTree] = useState(false);
  const [backendCostAnalysis, setBackendCostAnalysis] = useState<any>(null);
  const [loadingCost, setLoadingCost] = useState(false);

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

  const fetchData = async () => {
    setLoading(true);
    try {
      const [productsData, materialsData, machinesData, rolesData] = await Promise.all([
        fetchJsonOk<Product[]>("/api/products"),
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
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (activeFormTab === "tree" && editingItem?.id) {
      let cancelled = false;
      setLoadingTree(true);
      setTreeData(null);
      fetchJsonOk(`/api/products/${editingItem.id}/tree`)
        .then((data) => {
          if (!cancelled) setTreeData(data);
        })
        .catch((err) => {
          console.error("Erro ao carregar árvore:", err);
          if (!cancelled) {
            setTreeData(null);
            alert(err instanceof Error ? err.message : "Não foi possível carregar a árvore do produto.");
          }
        })
        .finally(() => {
          if (!cancelled) setLoadingTree(false);
        });
      return () => {
        cancelled = true;
      };
    }
  }, [activeFormTab, editingItem?.id]);

  useEffect(() => {
    if ((activeFormTab === "cost" || isModalOpen) && editingItem?.id) {
      let cancelled = false;
      setLoadingCost(true);
      fetchJsonOk(`/api/products/${editingItem.id}/cost-analysis`)
        .then((data) => {
          if (!cancelled) setBackendCostAnalysis(data);
        })
        .catch((err) => {
          console.error("Erro ao carregar custo:", err);
          if (!cancelled) {
            setBackendCostAnalysis(null);
            alert(err instanceof Error ? err.message : "Não foi possível carregar a análise de custo.");
          }
        })
        .finally(() => {
          if (!cancelled) setLoadingCost(false);
        });
      return () => {
        cancelled = true;
      };
    } else if (!editingItem?.id) {
      setBackendCostAnalysis(null);
    }
  }, [activeFormTab, isModalOpen, editingItem?.id]);

  const handleOpenModal = (item?: Product) => {
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validation based on type
    if (formData.type === "PRODUCT" && formData.bom.length === 0) {
      alert("Um PRODUTO deve ter pelo menos um COMPONENTE em sua estrutura.");
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
      await fetchJsonOk(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
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

  const filteredItems = items.filter(item => 
    item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.sku.toLowerCase().includes(searchTerm.toLowerCase())
  );

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

  const bomSelectOptions = useMemo(() => {
    const compOpts = items
      .filter((i) => i.type === "COMPONENT" && i.id !== editingItem?.id)
      .map((i) => ({
        value: i.id,
        label: `${i.sku} — ${i.name}`,
        sublabel: "Componente",
        searchTerms: `${i.sku} ${i.name}`,
      }));
    const matOpts =
      formData.type === "COMPONENT"
        ? materials.map((m) => ({
            value: m.id,
            label: `${m.code} — ${m.description}`,
            sublabel: "Material",
            searchTerms: `${m.code} ${m.description}`,
          }))
        : [];
    return [...compOpts, ...matOpts];
  }, [items, materials, formData.type, editingItem?.id]);

  const setBomLineMaterialOrChild = (index: number, val: string) => {
    const newBOM = [...formData.bom];
    if (!val) {
      newBOM[index] = { ...newBOM[index], materialId: undefined, childProductId: undefined };
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
      return {
        bomCost,
        routingCost,
        cifCost,
        total,
        details: backendCostAnalysis.details || { materials: [], operations: [], processBreakdown: [] },
        warnings,
        warningCount,
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
    };
  }, [backendCostAnalysis]);

  return (
    <div className="space-y-6">
      {/* Header Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Buscar por SKU ou nome..."
            className="w-full pl-10 pr-4 py-2 rounded-lg border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          {selectedIds.length > 0 && (
            <motion.button
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              onClick={handleBulkDelete}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500/10 text-red-600 font-bold hover:bg-red-500/20 transition-all border border-red-500/20 text-sm"
            >
              <Trash2 className="h-4 w-4" />
              Excluir ({selectedIds.length})
            </motion.button>
          )}
          <button 
            onClick={() => setIsImportOpen(true)}
            className="flex items-center gap-2 bg-accent text-accent-foreground px-4 py-2 rounded-lg font-medium hover:opacity-90 transition-opacity text-sm"
          >
            <Download className="h-4 w-4" />
            Importar
          </button>
          <button 
            onClick={() => handleOpenModal()}
            className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg font-medium hover:opacity-90 transition-opacity text-sm"
          >
            <Plus className="h-4 w-4" />
            Novo Item de Engenharia
          </button>
        </div>
      </div>

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
      <div className="bg-card rounded-xl border border-border overflow-hidden shadow-sm">
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
                <th className="p-4 font-semibold text-sm">Status</th>
                <th className="p-4 font-semibold text-sm text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center">
                    <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
                    <p className="mt-2 text-sm text-muted-foreground">Carregando engenharia...</p>
                  </td>
                </tr>
              ) : filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-muted-foreground">
                    Nenhum item encontrado.
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => (
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

      {/* Modal: Product Form */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-card w-full max-w-6xl rounded-2xl border border-border shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              {/* Modal Header */}
              <div className="p-6 border-b border-border flex items-center justify-between bg-accent/30">
                <div className="flex items-center gap-4">
                  <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                    {formData.type === "PRODUCT" ? <Package className="h-6 w-6" /> : 
                     formData.type === "COMPONENT" ? <Layers className="h-6 w-6" /> : 
                     <Box className="h-6 w-6" />}
                  </div>
                  <div>
                    <h3 className="text-xl font-bold">{editingItem ? "Editar Engenharia" : "Nova Engenharia"}</h3>
                    <p className="text-xs text-muted-foreground">Defina a estrutura e o processo produtivo do item</p>
                  </div>
                </div>
                <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-accent rounded-full transition-colors">
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Tabs Navigation */}
              <div className="flex items-center px-6 border-b border-border bg-card/50">
                {[
                  { id: "info", label: "Informações", icon: Info },
                  { id: "bom", label: "Estrutura (BOM)", icon: Layers },
                  { id: "routing", label: "Processo (Roteiro)", icon: Settings },
                  { id: "tree", label: "Estrutura em Árvore", icon: ChevronRight },
                  { id: "cost", label: "Análise de Custo", icon: DollarSign },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveFormTab(tab.id as any)}
                    className={cn(
                      "flex items-center gap-2 px-6 py-4 text-sm font-medium border-b-2 transition-all",
                      activeFormTab === tab.id 
                        ? "border-primary text-primary bg-primary/5" 
                        : "border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/50"
                    )}
                  >
                    <tab.icon className="h-4 w-4" />
                    {tab.label}
                  </button>
                ))}
              </div>
              
              <form onSubmit={handleSubmit} className="flex-1 overflow-hidden flex flex-col">
                <div className="flex-1 overflow-y-auto p-6">
                  {/* Tab: Info */}
                  {activeFormTab === "info" && (
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
                                  ? "Produtos só podem conter COMPONENTES." 
                                  : "Componentes podem conter COMPONENTES e MATERIAIS."}
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

                          <div className="space-y-3">
                            {formData.bom.length === 0 ? (
                              <div className="text-center py-12 border-2 border-dashed border-border rounded-xl">
                                <p className="text-sm text-muted-foreground">Nenhum item adicionado à estrutura.</p>
                              </div>
                            ) : (
                              formData.bom.map((item, idx) => (
                                <div key={idx} className="grid grid-cols-12 gap-4 p-4 bg-accent/20 rounded-xl border border-border items-end group relative">
                                  <div className="col-span-4 space-y-1.5">
                                    <label className="text-[10px] font-bold text-muted-foreground uppercase">Item / Componente</label>
                                    <SearchableSelect
                                      placeholder="Selecione um item..."
                                      options={bomSelectOptions}
                                      value={item.materialId || item.childProductId || ""}
                                      onChange={(val) => setBomLineMaterialOrChild(idx, val)}
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
                      ) : (
                        <div className="bg-card border border-border rounded-xl p-6">
                          <h4 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-6 flex items-center gap-2">
                            <ChevronRight className="h-4 w-4" /> Visualização Hierárquica
                          </h4>
                          
                          <div className="space-y-2">
                            <div className="flex items-center gap-3 p-3 bg-primary/10 rounded-lg border border-primary/20">
                              {formData.type === "PRODUCT" ? <Package className="h-5 w-5 text-primary" /> : <Layers className="h-5 w-5 text-primary" />}
                              <div>
                                <p className="text-sm font-bold">{formData.name || "Novo Item"}</p>
                                <p className="text-[10px] text-primary font-mono">{formData.sku || "SEM SKU"}</p>
                              </div>
                            </div>
                            
                            <div className="ml-6 border-l-2 border-border pl-6 space-y-4 pt-4">
                              {loadingTree ? (
                                <div className="flex items-center gap-2 text-muted-foreground">
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                  <span className="text-xs">Carregando estrutura completa...</span>
                                </div>
                              ) : !treeData || !treeData.children || treeData.children.length === 0 ? (
                                <p className="text-xs text-muted-foreground italic">Nenhum item na estrutura salva.</p>
                              ) : (
                                treeData.children.map((node: any, idx: number) => (
                                  <TreeNode key={idx} node={node} />
                                ))
                              )}
                            </div>

                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Tab: Cost Analysis */}
                  {activeFormTab === "cost" && (
                    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="p-6 rounded-2xl bg-blue-500/5 border border-blue-500/20 flex flex-col gap-2">
                          <div className="flex items-center justify-between">
                            <p className="text-xs font-bold text-blue-600 uppercase">Custo da estrutura (BOM)</p>
                            <Layers className="h-4 w-4 text-blue-500" />
                          </div>
                          <p className="text-3xl font-black text-blue-700">{formatCurrency(displayCost.bomCost)}</p>
                          <p className="text-[10px] text-blue-600/60">
                            Soma das linhas da BOM (matérias-primas e/ou CIU dos componentes), conforme o motor.
                          </p>
                        </div>
                        <div className="p-6 rounded-2xl bg-purple-500/5 border border-purple-500/20 flex flex-col gap-2">
                          <div className="flex items-center justify-between">
                            <p className="text-xs font-bold text-purple-600 uppercase">Conversão (HH + HM)</p>
                            <Settings className="h-4 w-4 text-purple-500" />
                          </div>
                          <p className="text-3xl font-black text-purple-700">{formatCurrency(displayCost.routingCost)}</p>
                          <p className="text-[10px] text-purple-600/60">Processo padrão ou roteiro; sem CIF rateado</p>
                        </div>
                        <div className="p-6 rounded-2xl bg-primary/10 border border-primary/20 flex flex-col gap-2">
                          <div className="flex items-center justify-between">
                            <p className="text-xs font-bold text-primary uppercase">Custo Industrial (CIU)</p>
                            <TrendingUp className="h-4 w-4 text-primary" />
                          </div>
                          <p className="text-3xl font-black text-primary">{formatCurrency(displayCost.total)}</p>
                          <p className="text-[10px] text-primary/60">
                            BOM + conversão + CIF ({formatCurrency(displayCost.cifCost)})
                          </p>
                        </div>
                      </div>

                      {!loadingCost && displayCost.warningCount > 0 && (
                        <div
                          className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 space-y-2"
                          role="alert"
                        >
                          <div className="flex items-start gap-2">
                            <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                            <div className="space-y-1 min-w-0">
                              <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">
                                A análise foi concluída, mas existem {displayCost.warningCount}{" "}
                                {displayCost.warningCount === 1 ? "alerta" : "alertas"} que exigem revisão.
                              </p>
                              <ul className="text-xs text-amber-900/90 dark:text-amber-100/90 space-y-1 list-disc pl-4">
                                {(displayCost.warnings as Array<{ message?: string }>).map((w, i) => (
                                  <li key={i}>{typeof w?.message === "string" ? w.message : String(w)}</li>
                                ))}
                              </ul>
                            </div>
                          </div>
                        </div>
                      )}

                      <p className="text-[11px] text-muted-foreground text-center px-2">
                        Conciliação: estrutura (BOM) + conversão + CIF = CIU (mesmo motor de{" "}
                        <code className="text-[10px] bg-accent px-1 rounded">/api/products/:id/cost-analysis</code>).
                      </p>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        {/* BOM Breakdown */}
                        <div className="space-y-4">
                          <h4 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                            Detalhamento BOM
                          </h4>
                          <div className="bg-card rounded-xl border border-border overflow-hidden">
                            <table className="w-full text-left text-xs">
                              <thead className="bg-accent/50 border-b border-border">
                                <tr>
                                  <th className="p-3 font-bold">Item</th>
                                  <th className="p-3 font-bold text-right">Qtd</th>
                                  <th className="p-3 font-bold text-right">Custo Unit.</th>
                                  <th className="p-3 font-bold text-right">Total</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-border">
                                {loadingCost ? (
                                  <tr>
                                    <td colSpan={4} className="p-4 text-center text-muted-foreground text-xs">
                                      Carregando análise do backend...
                                    </td>
                                  </tr>
                                ) : displayCost.details.materials.length === 0 ? (
                                  <tr>
                                    <td colSpan={4} className="p-4 text-center text-muted-foreground text-xs">
                                      Nenhum material ou componente na estrutura salva.
                                    </td>
                                  </tr>
                                ) : (
                                  displayCost.details.materials.map((item: any, idx: number) => (
                                    <tr key={idx}>
                                      <td className="p-3 font-medium">{item.description}</td>
                                      <td className="p-3 text-right">{formatNumber(item.requiredQty, 5)}</td>
                                      <td className="p-3 text-right">{formatCurrency(item.basePrice)}</td>
                                      <td className="p-3 text-right font-bold">{formatCurrency(item.unitCost)}</td>
                                    </tr>
                                  ))
                                )}
                              </tbody>
                            </table>
                          </div>
                        </div>

                        {/* Processing Breakdown */}
                        <div className="space-y-4">
                          <h4 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                            Detalhamento Processo
                          </h4>
                          <div className="bg-card rounded-xl border border-border overflow-hidden">
                            <table className="w-full text-left text-xs">
                              <thead className="bg-accent/50 border-b border-border">
                                <tr>
                                  <th className="p-3 font-bold">Operação</th>
                                  <th className="p-3 font-bold text-right">Tempo (min)</th>
                                  <th className="p-3 font-bold text-right">Custo Máq.</th>
                                  <th className="p-3 font-bold text-right">Custo HH</th>
                                  <th className="p-3 font-bold text-right">Total</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-border">
                                {loadingCost ? (
                                  <tr>
                                    <td colSpan={5} className="p-4 text-center text-muted-foreground text-xs">
                                      Carregando análise do backend...
                                    </td>
                                  </tr>
                                ) : !displayCost.details.processBreakdown || displayCost.details.processBreakdown.length === 0 ? (
                                  <tr>
                                    <td colSpan={5} className="p-4 text-center text-muted-foreground text-xs">
                                      Nenhum processo configurado.
                                    </td>
                                  </tr>
                                ) : (
                                  displayCost.details.processBreakdown.map((step: any, idx: number) => (
                                    <tr key={idx} className="group relative">
                                      <td className="p-3 font-medium">
                                        <div className="flex items-center gap-2">
                                          {step.description}
                                          {step.calculationDetails && (
                                            <div className="group/tooltip relative">
                                              <Info className="h-3 w-3 text-muted-foreground/50 cursor-help hover:text-primary transition-colors" />
                                              <div className="fixed z-[99] invisible group-hover/tooltip:visible bg-popover text-popover-foreground border shadow-xl rounded-xl p-4 w-80 text-[11px] pointer-events-none -translate-x-1/2 left-1/2 bottom-full mb-2 animate-in fade-in zoom-in-95 duration-200">
                                                <div className="space-y-3">
                                                  <div className="flex items-center justify-between border-b pb-2 mb-2">
                                                    <span className="font-bold uppercase text-[9px]">Memória de Cálculo</span>
                                                    <span className="bg-primary/10 text-primary px-1.5 py-0.5 rounded text-[8px] font-mono">
                                                      {step.source === "STANDARD_PROCESS" ? "PROCESSO PADRÃO" : "ROTEIRO"}
                                                    </span>
                                                  </div>
                                                  
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
                                      <td className="p-3 text-right">{formatNumber(step.timeMin, 5)}</td>
                                      <td className="p-3 text-right">{formatCurrency(step.machineCost)}</td>
                                      <td className="p-3 text-right">{formatCurrency(step.laborCost)}</td>
                                      <td className="p-3 text-right font-bold">{formatCurrency(step.total)}</td>
                                    </tr>
                                  ))
                                )}
                              </tbody>
                            </table>
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
