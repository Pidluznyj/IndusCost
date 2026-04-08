import React, { useEffect, useState } from "react";
import { 
  Plus, 
  Search, 
  Edit2, 
  Trash2, 
  X,
  Loader2,
  Package,
  Settings,
  Layers,
  Clock,
  Cpu,
  Users,
  ChevronRight,
  ChevronDown,
  Save,
  AlertCircle,
  Info,
  DollarSign,
  Target,
  Calculator,
  ArrowRight
} from "lucide-react";
import { cn, formatCurrency, formatNumber } from "@/src/lib/utils";
import { Product, CreateProductInput, ProductBOM, ProductRouting } from "@/src/types/product";
import { Material } from "@/src/types/material";
import { motion, AnimatePresence } from "motion/react";

interface BOMTreeNodeProps {
  node: any;
  level?: number;
}

const BOMTreeNode: React.FC<BOMTreeNodeProps> = ({ node, level = 0 }) => {
  const [isExpanded, setIsExpanded] = React.useState(true);
  const hasChildren = node.children && node.children.length > 0;

  return (
    <div className="select-none">
      <div 
        className={cn(
          "flex items-center gap-2 py-2 px-3 rounded-lg hover:bg-accent/50 transition-colors cursor-pointer group",
          level === 0 ? "bg-accent/30 border border-border mb-2" : ""
        )}
        onClick={() => hasChildren && setIsExpanded(!isExpanded)}
        style={{ marginLeft: `${level * 24}px` }}
      >
        {hasChildren ? (
          isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />
        ) : (
          <div className="w-4" />
        )}
        
        <div className={cn(
          "h-8 w-8 rounded-lg flex items-center justify-center shrink-0",
          node.type === "MATERIAL" ? "bg-orange-100 text-orange-600" : 
          node.type === "COMPONENT" ? "bg-purple-100 text-purple-600" : "bg-primary/10 text-primary"
        )}>
          {node.type === "MATERIAL" ? <Package className="h-4 w-4" /> : 
           node.type === "COMPONENT" ? <Layers className="h-4 w-4" /> : <Target className="h-4 w-4" />}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold truncate">{node.name || node.item?.name || node.item?.description}</span>
            <span className="text-[10px] font-mono text-muted-foreground">({node.sku || node.item?.sku || node.item?.code})</span>
            {node.type && (
              <span className={cn(
                "text-[8px] font-bold px-1.5 py-0.5 rounded uppercase border",
                node.type === "MATERIAL" ? "bg-orange-50 text-orange-600 border-orange-100" : "bg-purple-50 text-purple-600 border-purple-100"
              )}>
                {node.type === "MATERIAL" ? "MP" : "COMP"}
              </span>
            )}
          </div>
          {node.quantity && (
            <p className="text-[10px] text-muted-foreground">
              Qtd: <span className="font-bold text-foreground">{formatNumber(node.quantity)}</span> • 
              Perda: <span className="font-bold text-orange-600">{formatNumber(node.lossPercentage)}%</span>
            </p>
          )}
        </div>
      </div>

      {hasChildren && isExpanded && (
        <div className="space-y-1 mt-1">
          {node.children.map((child: any, idx: number) => (
            <BOMTreeNode key={idx} node={child} level={level + 1} />
          ))}
        </div>
      )}
    </div>
  );
};

export const ProductModule = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [machines, setMachines] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [activeFormTab, setActiveFormTab] = useState<"info" | "bom" | "routing">("info");
  const [viewingCostAnalysis, setViewingCostAnalysis] = useState<any | null>(null);
  const [viewingTree, setViewingTree] = useState<any>(null);
  const [treeLoading, setTreeLoading] = useState(false);

  const fetchTree = async (productId: string) => {
    setTreeLoading(true);
    try {
      const res = await fetch(`/api/products/${productId}/tree`);
      const data = await res.json();
      setViewingTree(data);
    } catch (error) {
      console.error("Erro ao buscar árvore BOM:", error);
    } finally {
      setTreeLoading(false);
    }
  };
  const [error, setError] = useState<{
    message: string;
    code?: string;
    action?: string;
    existingProduct?: { id: string; sku: string; name: string };
  } | null>(null);

  // Grid State
  const [sortConfig, setSortConfig] = useState<{ key: keyof Product | "cost"; direction: "asc" | "desc" }>({ key: "sku", direction: "asc" });
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(15);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  const fetchCostAnalysis = async (productId: string) => {
    try {
      const res = await fetch(`/api/products/${productId}/cost-analysis`);
      const data = await res.json();
      setViewingCostAnalysis(data);
    } catch (error) {
      console.error("Erro ao buscar análise de custo:", error);
    }
  };

  // Form State
  const [formData, setFormData] = useState<CreateProductInput>({
    sku: "",
    name: "",
    description: "",
    type: "PRODUCT",
    version: "1.0.0",
    defaultLotSize: 1,
    bom: [],
    routing: [],
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const [pRes, mRes, macRes, rRes] = await Promise.all([
        fetch("/api/products"),
        fetch("/api/materials"),
        fetch("/api/machines"),
        fetch("/api/roles")
      ]);
      
      setProducts(await pRes.json());
      setMaterials(await mRes.json());
      setMachines(await macRes.json());
      setRoles(await rRes.json());
    } catch (error) {
      console.error("Erro ao buscar dados:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleOpenModal = (product?: Product) => {
    setError(null);
    if (product) {
      setEditingProduct(product);
      setFormData({
        id: product.id,
        sku: product.sku,
        name: product.name,
        description: product.description || "",
        type: product.type,
        version: product.version,
        defaultLotSize: Number(product.defaultLotSize),
        bom: product.ProductBOM.map(b => ({ 
          ...b, 
          quantity: Number(b.quantity), 
          lossPercentage: Number(b.lossPercentage) 
        })),
        routing: product.ProductRouting.map(r => ({ 
          ...r, 
          setupTimeMin: Number(r.setupTimeMin), 
          operationTimeMin: Number(r.operationTimeMin),
          efficiencyExpected: Number(r.efficiencyExpected)
        })),
      });
    } else {
      setEditingProduct(null);
      setFormData({
        sku: "",
        name: "",
        description: "",
        type: "PRODUCT",
        version: "1.0.0",
        defaultLotSize: 1,
        bom: [],
        routing: [],
      });
    }
    setActiveFormTab("info");
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const method = editingProduct ? "PUT" : "POST";
    const url = editingProduct ? `/api/products/${editingProduct.id}` : "/api/products";

    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      
      const data = await res.json();

      if (res.ok) {
        setIsModalOpen(false);
        fetchData();
      } else if (res.status === 409) {
        setError({
          message: data.error,
          code: data.code,
          action: data.action,
          existingProduct: data.existingProduct
        });
      } else {
        setError({ message: data.error || "Erro ao salvar produto" });
      }
    } catch (error) {
      console.error("Erro ao salvar:", error);
      setError({ message: "Erro de conexão com o servidor" });
    }
  };

  const addBOMItem = () => {
    setFormData({
      ...formData,
      bom: [...formData.bom, { materialId: "", childProductId: "", quantity: 0, lossPercentage: 0 }]
    });
  };

  const removeBOMItem = (index: number) => {
    const newBOM = [...formData.bom];
    newBOM.splice(index, 1);
    setFormData({ ...formData, bom: newBOM });
  };

  const addRoutingStep = () => {
    const nextSeq = formData.routing.length > 0 
      ? Math.max(...formData.routing.map(r => r.sequence)) + 10 
      : 10;
    
    setFormData({
      ...formData,
      routing: [...formData.routing, { 
        sequence: nextSeq, 
        description: "", 
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

  const filteredProducts = products.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         p.sku.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === "ALL" || p.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const sortedProducts = [...filteredProducts].sort((a, b) => {
    const aValue = a[sortConfig.key as keyof Product];
    const bValue = b[sortConfig.key as keyof Product];

    if (aValue === undefined || bValue === undefined) return 0;

    if (aValue < bValue) return sortConfig.direction === "asc" ? -1 : 1;
    if (aValue > bValue) return sortConfig.direction === "asc" ? 1 : -1;
    return 0;
  });

  const totalPages = Math.ceil(sortedProducts.length / itemsPerPage);
  const paginatedProducts = sortedProducts.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const handleSort = (key: keyof Product | "cost") => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === "asc" ? "desc" : "asc"
    }));
  };

  const SortIcon = ({ column }: { column: keyof Product | "cost" }) => {
    if (sortConfig.key !== column) return <ChevronDown className="h-3 w-3 opacity-20" />;
    return sortConfig.direction === "asc" ? <ChevronDown className="h-3 w-3 rotate-180" /> : <ChevronDown className="h-3 w-3" />;
  };

  return (
    <div className="space-y-4">
      {/* Header Actions & Filters */}
      <div className="bg-card border border-border rounded-xl p-4 shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
              <Package className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold">Engenharia de Produtos</h2>
              <p className="text-xs text-muted-foreground">Gestão de estruturas (BOM) e roteiros industriais.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={() => handleOpenModal()}
              className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg font-bold hover:opacity-90 transition-all text-sm shadow-sm"
            >
              <Plus className="h-4 w-4" />
              Novo Produto
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 pt-2 border-t border-border/50">
          <div className="relative col-span-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Buscar por SKU ou nome..."
              className="w-full pl-10 pr-4 py-2 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm transition-all"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
            />
          </div>
          <div>
            <select 
              className="w-full p-2 rounded-lg border border-border bg-background text-sm outline-none focus:ring-2 focus:ring-primary/20"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setCurrentPage(1);
              }}
            >
              <option value="ALL">Todos os Status</option>
              <option value="ACTIVE">Ativos</option>
              <option value="DRAFT">Rascunhos</option>
              <option value="OBSOLETE">Obsoletos</option>
            </select>
          </div>
          <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
            <span>Mostrar</span>
            <select 
              className="p-1 rounded border border-border bg-background outline-none"
              value={itemsPerPage}
              onChange={(e) => setItemsPerPage(Number(e.target.value))}
            >
              <option value={10}>10</option>
              <option value={15}>15</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
            </select>
            <span>por página</span>
          </div>
        </div>
      </div>

      {/* Product Grid / Table */}
      <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[1000px]">
            <thead>
              <tr className="bg-accent/50 border-b border-border">
                <th 
                  className="p-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground cursor-pointer hover:bg-accent/80 transition-colors"
                  onClick={() => handleSort("sku")}
                >
                  <div className="flex items-center gap-2">
                    SKU <SortIcon column="sku" />
                  </div>
                </th>
                <th 
                  className="p-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground cursor-pointer hover:bg-accent/80 transition-colors"
                  onClick={() => handleSort("name")}
                >
                  <div className="flex items-center gap-2">
                    Produto <SortIcon column="name" />
                  </div>
                </th>
                <th className="p-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Tipo
                </th>
                <th className="p-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Unid.
                </th>
                <th className="p-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Categoria
                </th>
                <th className="p-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-center">
                  Estrutura
                </th>
                <th 
                  className="p-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground cursor-pointer hover:bg-accent/80 transition-colors text-center"
                  onClick={() => handleSort("status")}
                >
                  <div className="flex items-center justify-center gap-2">
                    Status <SortIcon column="status" />
                  </div>
                </th>
                <th className="p-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-right">
                  Custo (CIU)
                </th>
                <th className="p-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-right">
                  Ações
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={8} className="p-12 text-center">
                    <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
                    <p className="mt-2 text-sm text-muted-foreground">Carregando engenharia...</p>
                  </td>
                </tr>
              ) : paginatedProducts.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-12 text-center text-muted-foreground italic text-sm">
                    Nenhum produto encontrado com os filtros aplicados.
                  </td>
                </tr>
              ) : (
                paginatedProducts.map((product) => (
                  <tr 
                    key={product.id} 
                    className="hover:bg-accent/20 transition-colors group"
                  >
                    <td className="p-3 font-mono text-[11px] font-bold text-primary">
                      {product.sku}
                    </td>
                    <td className="p-3">
                      <p className="text-sm font-bold">{product.name}</p>
                      <p className="text-[10px] text-muted-foreground">v{product.version}</p>
                    </td>
                    <td className="p-3">
                      <span className={cn(
                        "px-2 py-0.5 rounded text-[10px] font-bold border",
                        product.type === "PRODUCT" ? "bg-blue-50 text-blue-700 border-blue-100" : "bg-purple-50 text-purple-700 border-purple-100"
                      )}>
                        {product.type === "PRODUCT" ? "PRODUTO" : "COMPONENTE"}
                      </span>
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">
                      UN
                    </td>
                    <td className="p-3 text-xs">
                      <span className="px-2 py-0.5 rounded bg-accent text-muted-foreground text-[10px] font-medium">
                        Industrial
                      </span>
                    </td>
                    <td className="p-3">
                      <div className="flex items-center justify-center gap-2">
                        <span title="Componentes (BOM)" className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 text-[10px] font-bold border border-blue-100">
                          <Layers className="h-3 w-3" />
                          {product.ProductBOM.length}
                        </span>
                        <span title="Operações (Roteiro)" className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 text-[10px] font-bold border border-purple-100">
                          <Settings className="h-3 w-3" />
                          {product.ProductRouting.length}
                        </span>
                      </div>
                    </td>
                    <td className="p-3 text-center">
                      <span className={cn(
                        "text-[10px] font-bold px-2 py-0.5 rounded-full border",
                        product.status === "ACTIVE" ? "bg-green-50 text-green-700 border-green-100" : 
                        product.status === "DRAFT" ? "bg-orange-50 text-orange-700 border-orange-100" :
                        "bg-gray-50 text-gray-700 border-gray-100"
                      )}>
                        {product.status}
                      </span>
                    </td>
                    <td className="p-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button 
                          onClick={() => fetchTree(product.id)}
                          className="text-[10px] font-bold text-muted-foreground hover:text-primary flex items-center gap-1"
                          title="Ver Árvore BOM"
                        >
                          <Layers className="h-3 w-3" />
                          Estrutura
                        </button>
                        <button 
                          onClick={() => fetchCostAnalysis(product.id)}
                          className="text-[10px] font-bold text-primary hover:underline flex items-center gap-1"
                        >
                          <Calculator className="h-3 w-3" />
                          Calcular
                        </button>
                      </div>
                    </td>
                    <td className="p-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button 
                          onClick={() => handleOpenModal(product)}
                          title="Editar"
                          className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-primary transition-colors"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button 
                          onClick={() => {
                            if(confirm("Deseja realmente excluir este produto?")) {
                              fetch(`/api/products/${product.id}`, { method: "DELETE" }).then(() => fetchData());
                            }
                          }}
                          title="Excluir"
                          className="p-1.5 rounded-lg hover:bg-red-50 text-muted-foreground hover:text-red-600 transition-colors"
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

        {/* Pagination Footer */}
        <div className="p-4 bg-accent/10 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground font-medium">
            Mostrando <span className="text-foreground font-bold">{paginatedProducts.length}</span> de <span className="text-foreground font-bold">{filteredProducts.length}</span> registros
          </p>
          
          <div className="flex items-center gap-2">
            <button 
              disabled={currentPage === 1}
              onClick={() => setCurrentPage(prev => prev - 1)}
              className="p-2 rounded-lg border border-border bg-background hover:bg-accent disabled:opacity-50 transition-colors"
            >
              <ChevronRight className="h-4 w-4 rotate-180" />
            </button>
            <div className="flex items-center gap-1">
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum = currentPage;
                if (totalPages <= 5) pageNum = i + 1;
                else if (currentPage <= 3) pageNum = i + 1;
                else if (currentPage >= totalPages - 2) pageNum = totalPages - 4 + i;
                else pageNum = currentPage - 2 + i;

                return (
                  <button
                    key={pageNum}
                    onClick={() => setCurrentPage(pageNum)}
                    className={cn(
                      "h-8 w-8 rounded-lg text-xs font-bold transition-all",
                      currentPage === pageNum ? "bg-primary text-primary-foreground shadow-sm" : "hover:bg-accent text-muted-foreground"
                    )}
                  >
                    {pageNum}
                  </button>
                );
              })}
            </div>
            <button 
              disabled={currentPage === totalPages || totalPages === 0}
              onClick={() => setCurrentPage(prev => prev + 1)}
              className="p-2 rounded-lg border border-border bg-background hover:bg-accent disabled:opacity-50 transition-colors"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Modal: Cost Analysis */}
      <AnimatePresence>
        {viewingCostAnalysis && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-card w-full max-w-4xl rounded-2xl border border-border shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-6 border-b border-border flex items-center justify-between bg-primary text-primary-foreground">
                <div>
                  <h3 className="text-xl font-bold">{viewingCostAnalysis.name}</h3>
                  <p className="text-xs opacity-80">Análise de Custo Industrial Unitário (CIU) • SKU: {viewingCostAnalysis.sku}</p>
                </div>
                <button onClick={() => setViewingCostAnalysis(null)} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-8">
                {/* Summary Cards */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                  <div className="p-5 rounded-2xl bg-accent/30 border border-border">
                    <p className="text-[10px] font-bold text-muted-foreground uppercase mb-1">Matérias-Primas</p>
                    <p className="text-2xl font-black">{formatCurrency(viewingCostAnalysis.summary.totalMaterialCost)}</p>
                  </div>
                  <div className="p-5 rounded-2xl bg-accent/30 border border-border">
                    <p className="text-[10px] font-bold text-muted-foreground uppercase mb-1">Conversão (HH+HM)</p>
                    <p className="text-2xl font-black">{formatCurrency(viewingCostAnalysis.summary.totalConversionCost)}</p>
                  </div>
                  <div className="p-5 rounded-2xl bg-accent/30 border border-border">
                    <p className="text-[10px] font-bold text-muted-foreground uppercase mb-1">CIF (Indiretos)</p>
                    <p className="text-2xl font-black text-blue-600">{formatCurrency(viewingCostAnalysis.summary.totalCIF_Unit)}</p>
                  </div>
                  <div className="p-5 rounded-2xl bg-primary/10 border border-primary/20">
                    <p className="text-[10px] font-bold text-primary uppercase mb-1">CIU Total</p>
                    <p className="text-3xl font-black text-primary">{formatCurrency(viewingCostAnalysis.summary.costPerUnit)}</p>
                  </div>
                </div>

                {/* OPEX Info */}
                <div className="p-4 rounded-xl bg-purple-50 border border-purple-100 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-lg bg-purple-600 text-white flex items-center justify-center">
                      <Target className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-[10px] font-bold text-purple-600 uppercase">Impacto OPEX (Adm/Com/Apoio)</p>
                      <p className="text-sm font-bold text-purple-900">{formatCurrency(viewingCostAnalysis.summary.totalOPEX_Unit)} / unidade</p>
                    </div>
                  </div>
                  <p className="text-[10px] text-purple-600 max-w-[200px] text-right italic">
                    * Valor rateado para fins de simulação de margem. Não compõe o custo industrial.
                  </p>
                </div>

                {/* Materials Breakdown */}
                <div className="space-y-4">
                  <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground border-b border-border pb-2">Detalhamento de Materiais</h4>
                  <div className="overflow-hidden rounded-xl border border-border">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-accent/50">
                        <tr>
                          <th className="p-3 font-bold">Material</th>
                          <th className="p-3 font-bold text-right">Qtd Bruta</th>
                          <th className="p-3 font-bold text-right">Custo Landed</th>
                          <th className="p-3 font-bold text-right">Perdas (Mat+BOM)</th>
                          <th className="p-3 font-bold text-right">Custo Unitário</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {viewingCostAnalysis.details.materials.map((mat: any, idx: number) => (
                          <tr key={idx} className="hover:bg-accent/20">
                            <td className="p-3">
                              <p className="font-bold">{mat.description}</p>
                              <p className="text-[10px] text-muted-foreground">{mat.materialCode}</p>
                            </td>
                            <td className="p-3 text-right">{formatNumber(mat.requiredQty)} {mat.unit}</td>
                            <td className="p-3 text-right">{formatCurrency(mat.landedCost)}</td>
                            <td className="p-3 text-right text-orange-600">+{formatNumber(mat.matLoss + mat.bomLoss)}%</td>
                            <td className="p-3 text-right font-bold">{formatCurrency(mat.unitCost)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Operations Breakdown */}
                <div className="space-y-4">
                  <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground border-b border-border pb-2">Detalhamento de Conversão (HH + HM)</h4>
                  <div className="overflow-hidden rounded-xl border border-border">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-accent/50">
                        <tr>
                          <th className="p-3 font-bold">Operação</th>
                          <th className="p-3 font-bold text-right">Tempo (min)</th>
                          <th className="p-3 font-bold text-right">Eficiência</th>
                          <th className="p-3 font-bold text-right">Setup (Rateado)</th>
                          <th className="p-3 font-bold text-right">Custo Unitário</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {viewingCostAnalysis.details.operations.map((op: any, idx: number) => (
                          <tr key={idx} className="hover:bg-accent/20">
                            <td className="p-3">
                              <p className="font-bold">{op.description}</p>
                              <p className="text-[10px] text-muted-foreground">{op.machineCode}</p>
                            </td>
                            <td className="p-3 text-right">{op.opTimeMin} min</td>
                            <td className="p-3 text-right">{op.efficiency}%</td>
                            <td className="p-3 text-right">{formatCurrency(op.setupCostPerUnit)}</td>
                            <td className="p-3 text-right font-bold">{formatCurrency(op.totalStepCost)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Audit Info */}
                <div className="p-4 rounded-xl border border-dashed border-border bg-accent/10 flex items-center justify-between text-[10px] text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <Info className="h-3 w-3" />
                    <span>Cálculo realizado em {new Date(viewingCostAnalysis.audit.calculatedAt).toLocaleString()}</span>
                  </div>
                  <span className="font-bold">Versão da Estrutura: {viewingCostAnalysis.audit.version}</span>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal: Engineering Form */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-card w-full max-w-5xl rounded-2xl border border-border shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              {/* Modal Header */}
              <div className="p-6 border-b border-border flex items-center justify-between bg-accent/30">
                <div className="flex items-center gap-4">
                  <div className="h-12 w-12 rounded-2xl bg-primary flex items-center justify-center text-primary-foreground">
                    <Package className="h-7 w-7" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold">{editingProduct ? "Editar Engenharia" : "Nova Engenharia de Produto"}</h3>
                    <p className="text-xs text-muted-foreground">Defina a estrutura técnica (BOM) e o roteiro de fabricação.</p>
                  </div>
                </div>
                <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-accent rounded-full transition-colors">
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Tabs */}
              <div className="flex border-b border-border bg-accent/10 px-6">
                {[
                  { id: "info", label: "Informações Gerais", icon: Info },
                  { id: "bom", label: "Estrutura (BOM)", icon: Layers },
                  { id: "routing", label: "Roteiro (Operações)", icon: Settings },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveFormTab(tab.id as any)}
                    className={cn(
                      "flex items-center gap-2 px-6 py-4 text-sm font-bold transition-all relative",
                      activeFormTab === tab.id ? "text-primary" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <tab.icon className="h-4 w-4" />
                    {tab.label}
                    {activeFormTab === tab.id && (
                      <motion.div layoutId="activeTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
                    )}
                  </button>
                ))}
              </div>
              
              <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6">
                {/* Error Message */}
                <AnimatePresence>
                  {error && (
                    <motion.div 
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="mb-6 overflow-hidden"
                    >
                      <div className="p-4 rounded-xl bg-red-50 border border-red-100 flex gap-3">
                        <AlertCircle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
                        <div className="space-y-1">
                          <p className="text-sm font-bold text-red-900">{error.message}</p>
                          {error.action && <p className="text-xs text-red-700">{error.action}</p>}
                          {error.existingProduct && (
                            <div className="mt-2 p-2 rounded-lg bg-white/50 border border-red-200 text-[10px]">
                              <p className="font-bold text-red-800">Produto Conflitante:</p>
                              <p className="text-red-700">{error.existingProduct.name} ({error.existingProduct.sku})</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Tab: Info */}
                {activeFormTab === "info" && (
                  <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="space-y-6 max-w-2xl mx-auto">
                    <div className="grid grid-cols-2 gap-6">
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-muted-foreground uppercase">SKU / Código</label>
                        <input
                          required
                          type="text"
                          className="w-full p-3 rounded-xl border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none"
                          value={formData.sku}
                          onChange={(e) => setFormData({...formData, sku: e.target.value})}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-muted-foreground uppercase">Tipo de Item</label>
                        <select
                          className="w-full p-3 rounded-xl border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none"
                          value={formData.type}
                          onChange={(e) => setFormData({...formData, type: e.target.value as any})}
                        >
                          <option value="PRODUCT">Produto Final</option>
                          <option value="COMPONENT">Componente / Subconjunto</option>
                        </select>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-6">
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-muted-foreground uppercase">Versão</label>
                        <input
                          required
                          type="text"
                          className="w-full p-3 rounded-xl border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none"
                          value={formData.version}
                          onChange={(e) => setFormData({...formData, version: e.target.value})}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-muted-foreground uppercase">Lote Padrão</label>
                        <input
                          required
                          type="number"
                          className="w-full p-3 rounded-xl border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none"
                          value={formData.defaultLotSize}
                          onChange={(e) => setFormData({...formData, defaultLotSize: Number(e.target.value)})}
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-muted-foreground uppercase">Nome do Produto</label>
                      <input
                        required
                        type="text"
                        className="w-full p-3 rounded-xl border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none"
                        value={formData.name}
                        onChange={(e) => setFormData({...formData, name: e.target.value})}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-muted-foreground uppercase">Descrição Técnica</label>
                      <textarea
                        rows={3}
                        className="w-full p-3 rounded-xl border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none resize-none"
                        value={formData.description}
                        onChange={(e) => setFormData({...formData, description: e.target.value})}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-muted-foreground uppercase">Lote Padrão de Fabricação</label>
                      <input
                        required
                        type="number"
                        className="w-full p-3 rounded-xl border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none"
                        value={formData.defaultLotSize}
                        onChange={(e) => setFormData({...formData, defaultLotSize: parseFloat(e.target.value)})}
                      />
                    </div>
                  </motion.div>
                )}

                {/* Tab: BOM */}
                {activeFormTab === "bom" && (
                  <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="space-y-4">
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="text-sm font-bold text-muted-foreground uppercase tracking-widest">Lista de Materiais</h4>
                      <button 
                        type="button"
                        onClick={addBOMItem}
                        className="flex items-center gap-2 text-xs font-bold text-primary hover:underline"
                      >
                        <Plus className="h-4 w-4" /> Adicionar Item
                      </button>
                    </div>

                    <div className="space-y-3">
                      {formData.bom.map((item, idx) => (
                        <div key={idx} className="grid grid-cols-12 gap-3 p-4 rounded-xl border border-border bg-accent/5 items-end group relative">
                          <div className="col-span-5 space-y-1.5">
                            <label className="text-[10px] font-bold text-muted-foreground uppercase">Item (Material ou Componente)</label>
                            <select
                              required
                              className="w-full p-2 rounded-lg border border-border bg-background text-sm outline-none focus:ring-2 focus:ring-primary/20"
                              value={item.materialId ? `MAT:${item.materialId}` : item.childProductId ? `COMP:${item.childProductId}` : ""}
                              onChange={(e) => {
                                const val = e.target.value;
                                const newBOM = [...formData.bom];
                                if (val.startsWith("MAT:")) {
                                  newBOM[idx].materialId = val.replace("MAT:", "");
                                  newBOM[idx].childProductId = "";
                                } else if (val.startsWith("COMP:")) {
                                  newBOM[idx].childProductId = val.replace("COMP:", "");
                                  newBOM[idx].materialId = "";
                                } else {
                                  newBOM[idx].materialId = "";
                                  newBOM[idx].childProductId = "";
                                }
                                setFormData({ ...formData, bom: newBOM });
                              }}
                            >
                              <option value="">Selecione...</option>
                              
                              {/* Regra: Se for Produto Final, só pode Componentes. Se for Componente, pode ambos. */}
                              {formData.type === "COMPONENT" && (
                                <optgroup label="Matérias-Primas">
                                  {materials.map(m => (
                                    <option key={m.id} value={`MAT:${m.id}`}>{m.description} ({m.unit})</option>
                                  ))}
                                </optgroup>
                              )}
                              
                              <optgroup label="Componentes / Subconjuntos">
                                {products
                                  .filter(p => p.type === "COMPONENT" && p.id !== formData.id)
                                  .map(p => (
                                    <option key={p.id} value={`COMP:${p.id}`}>{p.name} ({p.sku})</option>
                                  ))}
                              </optgroup>
                            </select>
                          </div>
                          <div className="col-span-2 space-y-1.5">
                            <label className="text-[10px] font-bold text-muted-foreground uppercase">Qtd. Líquida</label>
                            <input
                              required
                              type="number"
                              step="0.0001"
                              className="w-full p-2 rounded-lg border border-border bg-background text-sm outline-none focus:ring-2 focus:ring-primary/20"
                              value={item.quantity}
                              onChange={(e) => {
                                const newBOM = [...formData.bom];
                                newBOM[idx].quantity = parseFloat(e.target.value);
                                setFormData({ ...formData, bom: newBOM });
                              }}
                            />
                          </div>
                          <div className="col-span-2 space-y-1.5">
                            <label className="text-[10px] font-bold text-muted-foreground uppercase">Perda (%)</label>
                            <input
                              required
                              type="number"
                              step="0.1"
                              className="w-full p-2 rounded-lg border border-border bg-background text-sm outline-none focus:ring-2 focus:ring-primary/20"
                              value={item.lossPercentage}
                              onChange={(e) => {
                                const newBOM = [...formData.bom];
                                newBOM[idx].lossPercentage = parseFloat(e.target.value);
                                setFormData({ ...formData, bom: newBOM });
                              }}
                            />
                          </div>
                          <div className="col-span-2 space-y-1.5">
                            <label className="text-[10px] font-bold text-muted-foreground uppercase">Qtd. Bruta</label>
                            <div className="p-2 rounded-lg bg-accent/20 border border-border/50 text-sm font-bold text-primary">
                              {formatNumber(item.quantity / (1 - (item.lossPercentage / 100)))}
                            </div>
                          </div>
                          <div className="col-span-1 flex justify-end">
                            <button 
                              type="button"
                              onClick={() => removeBOMItem(idx)}
                              className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                          <div className="col-span-12 mt-2">
                            <input
                              placeholder="Observações do componente..."
                              className="w-full p-2 rounded-lg border border-border/50 bg-background/50 text-[10px] outline-none italic"
                              value={item.notes}
                              onChange={(e) => {
                                const newBOM = [...formData.bom];
                                newBOM[idx].notes = e.target.value;
                                setFormData({ ...formData, bom: newBOM });
                              }}
                            />
                          </div>
                        </div>
                      ))}
                      {formData.bom.length === 0 && (
                        <div className="text-center p-12 border-2 border-dashed border-border rounded-2xl text-muted-foreground">
                          Nenhum componente adicionado.
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}

                {/* Tab: Routing */}
                {activeFormTab === "routing" && (
                  <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="space-y-4">
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="text-sm font-bold text-muted-foreground uppercase tracking-widest">Roteiro de Produção</h4>
                      <button 
                        type="button"
                        onClick={addRoutingStep}
                        className="flex items-center gap-2 text-xs font-bold text-primary hover:underline"
                      >
                        <Plus className="h-4 w-4" /> Adicionar Operação
                      </button>
                    </div>

                    <div className="space-y-4">
                      {formData.routing.sort((a, b) => a.sequence - b.sequence).map((step, idx) => (
                        <div key={idx} className="p-5 rounded-2xl border border-border bg-accent/5 space-y-4 relative group">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className="h-8 w-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center font-bold text-xs">
                                {step.sequence}
                              </div>
                              <input
                                placeholder="Nome da Operação (ex: Torneamento, Solda...)"
                                className="bg-transparent border-b border-border/50 focus:border-primary outline-none font-bold text-sm min-w-[300px]"
                                value={step.description}
                                onChange={(e) => {
                                  const newRouting = [...formData.routing];
                                  newRouting[idx].description = e.target.value;
                                  setFormData({ ...formData, routing: newRouting });
                                }}
                              />
                            </div>
                            <button 
                              type="button"
                              onClick={() => removeRoutingStep(idx)}
                              className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                            <div className="space-y-1.5">
                              <label className="text-[10px] font-bold text-muted-foreground uppercase flex items-center gap-1">
                                <Cpu className="h-3 w-3" /> Máquina
                              </label>
                              <select
                                required
                                className="w-full p-2 rounded-lg border border-border bg-background text-xs outline-none focus:ring-2 focus:ring-primary/20"
                                value={step.machineId}
                                onChange={(e) => {
                                  const newRouting = [...formData.routing];
                                  newRouting[idx].machineId = e.target.value;
                                  setFormData({ ...formData, routing: newRouting });
                                }}
                              >
                                <option value="">Selecione...</option>
                                {machines.map(m => (
                                  <option key={m.id} value={m.id}>{m.name}</option>
                                ))}
                              </select>
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-[10px] font-bold text-muted-foreground uppercase flex items-center gap-1">
                                <Users className="h-3 w-3" /> Cargo Responsável
                              </label>
                              <select
                                required
                                className="w-full p-2 rounded-lg border border-border bg-background text-xs outline-none focus:ring-2 focus:ring-primary/20"
                                value={step.roleId}
                                onChange={(e) => {
                                  const newRouting = [...formData.routing];
                                  newRouting[idx].roleId = e.target.value;
                                  setFormData({ ...formData, routing: newRouting });
                                }}
                              >
                                <option value="">Selecione...</option>
                                {roles.map(r => (
                                  <option key={r.id} value={r.id}>{r.name}</option>
                                ))}
                              </select>
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-[10px] font-bold text-muted-foreground uppercase flex items-center gap-1">
                                <Clock className="h-3 w-3" /> Setup (min)
                              </label>
                              <input
                                required
                                type="number"
                                className="w-full p-2 rounded-lg border border-border bg-background text-xs outline-none focus:ring-2 focus:ring-primary/20"
                                value={step.setupTimeMin}
                                onChange={(e) => {
                                  const newRouting = [...formData.routing];
                                  newRouting[idx].setupTimeMin = parseFloat(e.target.value);
                                  setFormData({ ...formData, routing: newRouting });
                                }}
                              />
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-[10px] font-bold text-muted-foreground uppercase flex items-center gap-1">
                                <Clock className="h-3 w-3" /> Operação (min)
                              </label>
                              <input
                                required
                                type="number"
                                className="w-full p-2 rounded-lg border border-border bg-background text-xs outline-none focus:ring-2 focus:ring-primary/20"
                                value={step.operationTimeMin}
                                onChange={(e) => {
                                  const newRouting = [...formData.routing];
                                  newRouting[idx].operationTimeMin = parseFloat(e.target.value);
                                  setFormData({ ...formData, routing: newRouting });
                                }}
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                      {formData.routing.length === 0 && (
                        <div className="text-center p-12 border-2 border-dashed border-border rounded-2xl text-muted-foreground">
                          Nenhuma operação definida.
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </form>

              {/* Modal Footer */}
              <div className="p-6 border-t border-border bg-accent/10 flex items-center justify-between">
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    <span>Lote Padrão: {formData.defaultLotSize}</span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button 
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="px-6 py-2 rounded-xl font-bold hover:bg-accent transition-colors text-sm"
                  >
                    Cancelar
                  </button>
                  <button 
                    onClick={handleSubmit}
                    className="px-8 py-2 rounded-xl font-bold bg-primary text-primary-foreground hover:opacity-90 transition-opacity flex items-center gap-2 text-sm"
                  >
                    <Save className="h-4 w-4" />
                    {editingProduct ? "Salvar Alterações" : "Finalizar Engenharia"}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
        {/* Modal: BOM Tree View */}
        {viewingTree && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-card w-full max-w-2xl rounded-2xl border border-border shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-6 border-b border-border flex items-center justify-between bg-accent/50">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                    <Layers className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold">Estrutura de Produto (BOM)</h3>
                    <p className="text-xs text-muted-foreground">Visão multinível recursiva da engenharia.</p>
                  </div>
                </div>
                <button onClick={() => setViewingTree(null)} className="p-2 hover:bg-accent rounded-full transition-colors">
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6">
                {treeLoading ? (
                  <div className="flex flex-col items-center justify-center py-20 gap-3">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    <p className="text-sm text-muted-foreground italic">Mapeando estrutura recursiva...</p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <BOMTreeNode node={viewingTree} />
                  </div>
                )}
              </div>

              <div className="p-4 bg-accent/30 border-t border-border flex justify-end">
                <button 
                  onClick={() => setViewingTree(null)}
                  className="px-6 py-2 rounded-xl bg-background border border-border text-sm font-bold hover:bg-accent transition-all"
                >
                  Fechar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
