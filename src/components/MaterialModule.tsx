import React, { useEffect, useState } from "react";
import { 
  Plus, 
  Search, 
  Edit2, 
  Trash2, 
  Filter,
  Download,
  X,
  Loader2,
  History,
  TrendingUp,
  TrendingDown,
  Package,
  Truck,
  AlertTriangle,
  DollarSign
} from "lucide-react";
import { cn, formatCurrency, formatNumber } from "@/src/lib/utils";
import { Material, CreateMaterialInput } from "@/src/types/material";
import { motion } from "motion/react";
import { DataImportDialog } from "./shared/DataImportDialog";
import { MaterialImportConfig } from "../lib/importer/MaterialConfig";

export const MaterialModule = () => {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<Material | null>(null);
  const [viewingHistory, setViewingHistory] = useState<Material | null>(null);

  // Form State
  const [formData, setFormData] = useState<CreateMaterialInput>({
    code: "",
    description: "",
    unit: "UN",
    category: "MATERIA_PRIMA",
    supplier: "",
    currentCost: 0,
    averageCost: 0,
    standardCost: 0,
    freight: 0,
    standardLoss: 0,
    conversionFactor: 1,
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/materials");
      const data = await res.json();
      setMaterials(data);
    } catch (error) {
      console.error("Erro ao buscar materiais:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleOpenModal = (material?: Material) => {
    if (material) {
      setEditingMaterial(material);
      setFormData({
        code: material.code,
        description: material.description,
        unit: material.unit,
        category: material.category,
        supplier: material.supplier || "",
        currentCost: Number(material.currentCost),
        averageCost: Number(material.averageCost),
        standardCost: Number(material.standardCost),
        freight: Number(material.freight),
        standardLoss: Number(material.standardLoss),
        conversionFactor: Number(material.conversionFactor),
      });
    } else {
      setEditingMaterial(null);
      setFormData({
        code: "",
        description: "",
        unit: "UN",
        category: "MATERIA_PRIMA",
        supplier: "",
        currentCost: 0,
        averageCost: 0,
        standardCost: 0,
        freight: 0,
        standardLoss: 0,
        conversionFactor: 1,
      });
    }
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const method = editingMaterial ? "PUT" : "POST";
    const url = editingMaterial ? `/api/materials/${editingMaterial.id}` : "/api/materials";

    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      if (res.ok) {
        setIsModalOpen(false);
        fetchData();
      }
    } catch (error) {
      console.error("Erro ao salvar:", error);
    }
  };

  const toggleStatus = async (id: string, currentStatus: string) => {
    const newStatus = currentStatus === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    try {
      const res = await fetch(`/api/materials/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        let message = "Não foi possível alterar o status do material.";
        try {
          const errBody = await res.json();
          if (errBody?.error && typeof errBody.error === "string") {
            message = errBody.error;
          }
        } catch {
          /* ignore */
        }
        alert(message);
        return;
      }
      await fetchData();
    } catch (error) {
      console.error("Erro ao alterar status:", error);
      alert("Erro de conexão ao alterar status do material.");
    }
  };

  const filteredMaterials = materials.filter(mat => 
    mat.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
    mat.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
    mat.supplier?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Buscar por código, descrição ou fornecedor..."
            className="w-full pl-10 pr-4 py-2 rounded-lg border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
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
            Novo Material
          </button>
        </div>
      </div>

      {/* Import Dialog */}
      <DataImportDialog 
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        onSuccess={fetchData}
        config={MaterialImportConfig}
        templateUrl="/api/materials/import/template"
        previewUrl="/api/materials/import/preview"
        confirmUrl="/api/materials/import/confirm"
      />

      {/* Table */}
      <div className="bg-card rounded-xl border border-border overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-accent/50 border-b border-border">
                <th className="p-4 font-semibold text-sm">Material</th>
                <th className="p-4 font-semibold text-sm">Categoria / Unid.</th>
                <th className="p-4 font-semibold text-sm">Custo Atual</th>
                <th className="p-4 font-semibold text-sm">Posto Fábrica</th>
                <th className="p-4 font-semibold text-sm">Custo c/ Perda</th>
                <th className="p-4 font-semibold text-sm">Status</th>
                <th className="p-4 font-semibold text-sm text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center">
                    <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
                    <p className="mt-2 text-sm text-muted-foreground">Carregando materiais...</p>
                  </td>
                </tr>
              ) : filteredMaterials.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-muted-foreground">
                    Nenhum material encontrado.
                  </td>
                </tr>
              ) : (
                filteredMaterials.map((mat) => (
                  <tr key={mat.id} className="hover:bg-accent/30 transition-colors group">
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                          <Package className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="font-medium text-sm">{mat.description}</p>
                          <p className="text-xs text-muted-foreground">{mat.code}</p>
                        </div>
                      </div>
                    </td>
                    <td className="p-4">
                      <p className="text-sm font-medium">{mat.category.replace("_", " ")}</p>
                      <p className="text-xs text-muted-foreground">{mat.unit}</p>
                    </td>
                    <td className="p-4">
                      <p className="text-sm font-medium">{formatCurrency(mat.currentCost)}</p>
                      <div className="flex items-center gap-1">
                        {Number(mat.currentCost) > Number(mat.standardCost) ? (
                          <TrendingUp className="h-3 w-3 text-red-500" />
                        ) : (
                          <TrendingDown className="h-3 w-3 text-green-500" />
                        )}
                        <span className="text-[10px] text-muted-foreground">Std: {formatCurrency(mat.standardCost)}</span>
                      </div>
                    </td>
                    <td className="p-4">
                      <p className="text-sm font-bold text-primary">{formatCurrency(mat.calculations?.landedCost || 0)}</p>
                      <p className="text-[10px] text-muted-foreground">Frete: {formatCurrency(mat.freight)}</p>
                    </td>
                    <td className="p-4">
                      <p className="text-sm font-bold">{formatCurrency(mat.calculations?.effectiveCost || 0)}</p>
                      <p className="text-[10px] text-muted-foreground">Perda: {formatNumber(mat.standardLoss, 2)}%</p>
                    </td>
                    <td className="p-4">
                      <div className={cn(
                        "inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
                        mat.status === "ACTIVE" ? "bg-green-500/10 text-green-600" : "bg-red-500/10 text-red-600"
                      )}>
                        <div className={cn("h-1.5 w-1.5 rounded-full", mat.status === "ACTIVE" ? "bg-green-600" : "bg-red-600")} />
                        {mat.status === "ACTIVE" ? "Ativo" : "Inativo"}
                      </div>
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button 
                          onClick={() => setViewingHistory(mat)}
                          className="p-2 rounded-md hover:bg-accent text-muted-foreground hover:text-primary transition-all"
                          title="Histórico de Preços"
                        >
                          <History className="h-4 w-4" />
                        </button>
                        <button 
                          onClick={() => handleOpenModal(mat)}
                          className="p-2 rounded-md hover:bg-accent text-muted-foreground hover:text-primary transition-all"
                          title="Editar"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button 
                          onClick={() => toggleStatus(mat.id, mat.status)}
                          className={cn(
                            "p-2 rounded-md hover:bg-accent transition-all",
                            mat.status === "ACTIVE" ? "text-red-500" : "text-green-500"
                          )}
                          title={mat.status === "ACTIVE" ? "Inativar" : "Ativar"}
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

      {/* Modal: Material Form */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-card w-full max-w-4xl rounded-2xl border border-border shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
          >
            <div className="p-6 border-b border-border flex items-center justify-between bg-accent/30">
              <h3 className="text-xl font-bold">{editingMaterial ? "Editar Material" : "Novo Material"}</h3>
              <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-accent rounded-full transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>
            
            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Basic Info */}
                <div className="space-y-4">
                  <h4 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                    <Package className="h-4 w-4" /> Especificação
                  </h4>
                  <div className="grid grid-cols-1 gap-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-muted-foreground uppercase">Código</label>
                        <input
                          required
                          type="text"
                          className="w-full p-2 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm"
                          value={formData.code}
                          onChange={(e) => setFormData({...formData, code: e.target.value})}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-muted-foreground uppercase">Unidade</label>
                        <input
                          required
                          type="text"
                          placeholder="KG, UN, M..."
                          className="w-full p-2 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm"
                          value={formData.unit}
                          onChange={(e) => setFormData({...formData, unit: e.target.value})}
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-muted-foreground uppercase">Descrição</label>
                      <input
                        required
                        type="text"
                        className="w-full p-2 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm"
                        value={formData.description}
                        onChange={(e) => setFormData({...formData, description: e.target.value})}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-muted-foreground uppercase">Categoria</label>
                        <select
                          className="w-full p-2 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm"
                          value={formData.category}
                          onChange={(e) => setFormData({...formData, category: e.target.value})}
                        >
                          <option value="MATERIA_PRIMA">Matéria-Prima</option>
                          <option value="INSUMO">Insumo</option>
                          <option value="EMBALAGEM">Embalagem</option>
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-muted-foreground uppercase">Fornecedor</label>
                        <input
                          type="text"
                          className="w-full p-2 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm"
                          value={formData.supplier}
                          onChange={(e) => setFormData({...formData, supplier: e.target.value})}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Costs Info */}
                <div className="space-y-4">
                  <h4 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                    <DollarSign className="h-4 w-4" /> Estrutura de Custos
                  </h4>
                  <div className="grid grid-cols-1 gap-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-muted-foreground uppercase">Custo Atual (R$)</label>
                        <input
                          required
                          type="number"
                          step="0.00001"
                          className="w-full p-2 rounded-lg border border-border bg-background font-bold text-primary focus:ring-2 focus:ring-primary/20 outline-none text-sm"
                          value={formData.currentCost}
                          onChange={(e) => setFormData({...formData, currentCost: parseFloat(e.target.value)})}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-muted-foreground uppercase">Custo Standard (R$)</label>
                        <input
                          required
                          type="number"
                          step="0.00001"
                          className="w-full p-2 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm"
                          value={formData.standardCost}
                          onChange={(e) => setFormData({...formData, standardCost: parseFloat(e.target.value)})}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-muted-foreground uppercase">Frete Unitário (R$)</label>
                        <input
                          required
                          type="number"
                          step="0.00001"
                          className="w-full p-2 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm"
                          value={formData.freight}
                          onChange={(e) => setFormData({...formData, freight: parseFloat(e.target.value)})}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-muted-foreground uppercase">Perda Padrão (%)</label>
                        <input
                          required
                          type="number"
                          step="0.00001"
                          className="w-full p-2 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm"
                          value={formData.standardLoss}
                          onChange={(e) => setFormData({...formData, standardLoss: parseFloat(e.target.value)})}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-muted-foreground uppercase">Custo Médio (R$)</label>
                        <input
                          type="number"
                          step="0.00001"
                          className="w-full p-2 rounded-lg border border-border bg-background/50 focus:ring-2 focus:ring-primary/20 outline-none text-sm"
                          value={formData.averageCost}
                          onChange={(e) => setFormData({...formData, averageCost: parseFloat(e.target.value)})}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-muted-foreground uppercase">Fator Conversão</label>
                        <input
                          required
                          type="number"
                          step="0.00001"
                          className="w-full p-2 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm"
                          value={formData.conversionFactor}
                          onChange={(e) => setFormData({...formData, conversionFactor: parseFloat(e.target.value)})}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Live Preview of Calculations */}
              <div className="p-4 rounded-xl bg-primary/5 border border-primary/20 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <Truck className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-muted-foreground uppercase">Custo Posto Fábrica</p>
                    <p className="text-lg font-black text-primary">
                      {formatCurrency(Number(formData.currentCost) + Number(formData.freight))}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-orange-500/10 flex items-center justify-center">
                    <AlertTriangle className="h-5 w-5 text-orange-500" />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-muted-foreground uppercase">Custo Efetivo (c/ Perda)</p>
                    <p className="text-lg font-black text-orange-600">
                      {formatCurrency((Number(formData.currentCost) + Number(formData.freight)) / (1 - (Number(formData.standardLoss) / 100)))}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-6 border-t border-border">
                <button 
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-6 py-2 rounded-lg font-medium hover:bg-accent transition-colors text-sm"
                >
                  Cancelar
                </button>
                <button 
                  type="submit"
                  className="px-8 py-2 rounded-lg font-bold bg-primary text-primary-foreground hover:opacity-90 transition-opacity text-sm"
                >
                  {editingMaterial ? "Salvar Alterações" : "Cadastrar Material"}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* Modal: Price History */}
      {viewingHistory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-card w-full max-w-2xl rounded-2xl border border-border shadow-2xl overflow-hidden"
          >
            <div className="p-6 border-b border-border flex items-center justify-between bg-primary text-primary-foreground">
              <div>
                <h3 className="text-xl font-bold">{viewingHistory.description}</h3>
                <p className="text-xs opacity-80">Histórico de Preços • {viewingHistory.code}</p>
              </div>
              <button onClick={() => setViewingHistory(null)} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>
            
            <div className="p-6">
              <div className="space-y-4">
                {viewingHistory.MaterialPriceHistory && viewingHistory.MaterialPriceHistory.length > 0 ? (
                  viewingHistory.MaterialPriceHistory.map((history, idx) => (
                    <div key={history.id} className="flex items-center justify-between p-4 rounded-xl border border-border hover:bg-accent/30 transition-colors">
                      <div className="flex items-center gap-4">
                        <div className="h-8 w-8 rounded-full bg-accent flex items-center justify-center text-xs font-bold">
                          {viewingHistory.MaterialPriceHistory!.length - idx}
                        </div>
                        <div>
                          <p className="text-sm font-bold">{formatCurrency(history.price)}</p>
                          <p className="text-[10px] text-muted-foreground">Frete: {formatCurrency(history.freight)}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-medium">{new Date(history.effectiveDate).toLocaleDateString()}</p>
                        <p className="text-[10px] text-muted-foreground">Data de Vigência</p>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-center p-8 text-muted-foreground">Nenhum histórico disponível.</p>
                )}
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
};
