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
  const [error, setError] = useState<{
    message: string;
    code?: string;
    action?: string;
    existingProduct?: { id: string; sku: string; name: string };
  } | null>(null);

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
        sku: product.sku,
        name: product.name,
        description: product.description || "",
        version: product.version,
        defaultLotSize: Number(product.defaultLotSize),
        bom: product.ProductBOM.map(b => ({ ...b, quantity: Number(b.quantity), lossPercentage: Number(b.lossPercentage) })),
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
      bom: [...formData.bom, { materialId: "", quantity: 0, lossPercentage: 0 }]
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

  const filteredProducts = products.filter(p => 
    p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.sku.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Buscar por SKU ou nome do produto..."
            className="w-full pl-10 pr-4 py-2 rounded-lg border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <button 
          onClick={() => handleOpenModal()}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg font-medium hover:opacity-90 transition-opacity text-sm"
        >
          <Plus className="h-4 w-4" />
          Nova Engenharia
        </button>
      </div>

      {/* Product List */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {loading ? (
          <div className="col-span-full p-12 text-center">
            <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
            <p className="mt-2 text-sm text-muted-foreground">Carregando engenharia...</p>
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="col-span-full p-12 text-center border-2 border-dashed border-border rounded-2xl text-muted-foreground">
            Nenhum produto cadastrado.
          </div>
        ) : (
          filteredProducts.map((product) => (
            <motion.div 
              key={product.id}
              layoutId={product.id}
              className="bg-card rounded-2xl border border-border overflow-hidden shadow-sm hover:shadow-md transition-all group"
            >
              <div className="p-5 border-b border-border bg-accent/30 flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                    <Package className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm">{product.name}</h3>
                    <p className="text-[10px] font-mono text-muted-foreground">{product.sku} • v{product.version}</p>
                  </div>
                </div>
                <button 
                  onClick={() => handleOpenModal(product)}
                  className="p-2 rounded-lg hover:bg-background text-muted-foreground hover:text-primary transition-colors"
                >
                  <Edit2 className="h-4 w-4" />
                </button>
              </div>
              
              <div className="p-5 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 rounded-xl bg-accent/20 border border-border/50">
                    <div className="flex items-center gap-2 text-muted-foreground mb-1">
                      <Layers className="h-3 w-3" />
                      <span className="text-[10px] font-bold uppercase">Componentes</span>
                    </div>
                    <p className="text-lg font-black">{product.ProductBOM.length}</p>
                  </div>
                  <div className="p-3 rounded-xl bg-accent/20 border border-border/50">
                    <div className="flex items-center gap-2 text-muted-foreground mb-1">
                      <Settings className="h-3 w-3" />
                      <span className="text-[10px] font-bold uppercase">Operações</span>
                    </div>
                    <p className="text-lg font-black">{product.ProductRouting.length}</p>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2">
                  <button 
                    onClick={() => fetchCostAnalysis(product.id)}
                    className="flex items-center gap-2 text-xs font-bold text-primary hover:underline"
                  >
                    <DollarSign className="h-3 w-3" />
                    Análise de Custo
                  </button>
                  <span className={cn(
                    "text-[10px] font-bold px-2 py-0.5 rounded-full",
                    product.status === "ACTIVE" ? "bg-green-500/10 text-green-600" : "bg-orange-500/10 text-orange-600"
                  )}>
                    {product.status}
                  </span>
                </div>
              </div>
            </motion.div>
          ))
        )}
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
                        <label className="text-xs font-bold text-muted-foreground uppercase">Versão</label>
                        <input
                          required
                          type="text"
                          className="w-full p-3 rounded-xl border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none"
                          value={formData.version}
                          onChange={(e) => setFormData({...formData, version: e.target.value})}
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
                            <label className="text-[10px] font-bold text-muted-foreground uppercase">Material</label>
                            <select
                              required
                              className="w-full p-2 rounded-lg border border-border bg-background text-sm outline-none focus:ring-2 focus:ring-primary/20"
                              value={item.materialId}
                              onChange={(e) => {
                                const newBOM = [...formData.bom];
                                newBOM[idx].materialId = e.target.value;
                                setFormData({ ...formData, bom: newBOM });
                              }}
                            >
                              <option value="">Selecione...</option>
                              {materials.map(m => (
                                <option key={m.id} value={m.id}>{m.description} ({m.unit})</option>
                              ))}
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
      </AnimatePresence>
    </div>
  );
};
