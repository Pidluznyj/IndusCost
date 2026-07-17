import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
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
  DollarSign,
  LineChart,
  Radar
} from "lucide-react";
import { cn, formatCurrency, formatNumber } from "@/src/lib/utils";
import { fetchJsonOk, fetchOk } from "@/src/lib/http";
import { Material, CreateMaterialInput } from "@/src/types/material";
import {
  DEFAULT_MATERIAL_MARKET_CRITICALITY,
  DEFAULT_MATERIAL_MARKET_MONITORING_FREQUENCY_DAYS,
  MATERIAL_MARKET_CRITICALITY_LABELS,
  MATERIAL_MARKET_CRITICALITY_VALUES,
  type MaterialMarketCriticality,
} from "@/src/lib/materialMarketMonitoring";
import { getMaterialMarketIntelligenceDetailPath } from "@/src/lib/materialsNavigation";
import { MaterialMarketMonitoringBadge } from "@/src/components/materials/MaterialMarketMonitoringBadge";
import { MaterialMarketSituationBadge } from "@/src/components/materials/MaterialMarketSituationBadge";
import { motion } from "motion/react";
import { DataImportDialog } from "./shared/DataImportDialog";
import { MaterialImportConfig } from "../lib/importer/MaterialConfig";
import { SearchableSelect } from "./shared/SearchableSelect";
import { GuidedTour } from "@/src/components/tour/GuidedTour";
import { TourHelpButton } from "@/src/components/tour/TourHelpButton";
import { useAuth } from "@/src/contexts/AuthContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import { canEditMaterials } from "@/src/lib/commercialEngineeringPermissions";
import { MATERIAL_TOUR_STEPS } from "@/src/tours/materialTourSteps";

const MATERIAL_CATEGORY_OPTIONS = [
  { value: "MATERIA_PRIMA", label: "Matéria-Prima", searchTerms: "MATERIA_PRIMA materia prima" },
  { value: "INSUMO", label: "Insumo", searchTerms: "INSUMO insumo" },
  { value: "EMBALAGEM", label: "Embalagem", searchTerms: "EMBALAGEM embalagem" },
];

export const MaterialModule = () => {
  const auth = useAuth();
  const permissions = usePermissions();
  const allowEditMaterials = canEditMaterials({
    ...auth,
    canPerformAction: permissions.canPerformAction,
  });
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [listCategoryFilter, setListCategoryFilter] = useState<"" | Material["category"]>("");
  const [listStatusFilter, setListStatusFilter] = useState<"" | "ACTIVE" | "INACTIVE">("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<Material | null>(null);
  const [viewingHistory, setViewingHistory] = useState<Material | null>(null);
  const [tourOpen, setTourOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<
    | null
    | {
        kind: "duplicate";
        code: string;
        message: string;
        existingMaterialId: string | null;
      }
    | { kind: "generic"; message: string }
  >(null);

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
    isMarketMonitored: false,
    marketCriticality: DEFAULT_MATERIAL_MARKET_CRITICALITY,
    marketMonitoringFrequencyDays: DEFAULT_MATERIAL_MARKET_MONITORING_FREQUENCY_DAYS,
    marketNotes: "",
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const data = await fetchJsonOk<Material[]>("/api/materials");
      setMaterials(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Erro ao buscar materiais:", error);
      alert(error instanceof Error ? error.message : "Não foi possível carregar materiais.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleOpenModal = (material?: Material) => {
    setFormError(null);
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
        isMarketMonitored: material.isMarketMonitored === true,
        marketCriticality:
          material.marketCriticality ?? DEFAULT_MATERIAL_MARKET_CRITICALITY,
        marketMonitoringFrequencyDays:
          material.marketMonitoringFrequencyDays ??
          DEFAULT_MATERIAL_MARKET_MONITORING_FREQUENCY_DAYS,
        marketNotes: material.marketNotes ?? "",
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
        isMarketMonitored: false,
        marketCriticality: DEFAULT_MATERIAL_MARKET_CRITICALITY,
        marketMonitoringFrequencyDays: DEFAULT_MATERIAL_MARKET_MONITORING_FREQUENCY_DAYS,
        marketNotes: "",
      });
    }
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const method = editingMaterial ? "PUT" : "POST";
    const url = editingMaterial ? `/api/materials/${editingMaterial.id}` : "/api/materials";

    setFormError(null);
    setSubmitting(true);
    try {
      const payload = { ...formData, code: formData.code.trim() };
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        let body: Record<string, unknown> | null = null;
        const ct = res.headers.get("content-type") ?? "";
        if (ct.includes("application/json")) {
          try {
            body = (await res.json()) as Record<string, unknown>;
          } catch {
            body = null;
          }
        }

        const errorCode = typeof body?.error === "string" ? body.error : "";
        const message =
          typeof body?.message === "string" && body.message.trim()
            ? body.message.trim()
            : `Erro HTTP ${res.status}`;

        if (res.status === 409 && errorCode === "MATERIAL_CODE_ALREADY_EXISTS") {
          const dupCode =
            typeof body?.code === "string" && body.code ? body.code : payload.code;
          const existingMaterialId =
            typeof body?.existingMaterialId === "string"
              ? body.existingMaterialId
              : null;
          setFormError({
            kind: "duplicate",
            code: dupCode,
            message: `Já existe um material com o código ${dupCode}. Abra o cadastro existente para editar ou use outro código.`,
            existingMaterialId,
          });
          return;
        }

        setFormError({ kind: "generic", message });
        return;
      }

      setIsModalOpen(false);
      setFormError(null);
      fetchData();
    } catch (error) {
      console.error("Erro ao salvar:", error);
      setFormError({
        kind: "generic",
        message:
          error instanceof Error
            ? `Falha de comunicação com o servidor: ${error.message}`
            : "Falha de comunicação com o servidor.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenExistingByCode = (existingMaterialId: string | null, code: string) => {
    const existing =
      (existingMaterialId && materials.find((m) => m.id === existingMaterialId)) ||
      materials.find((m) => m.code.trim().toLowerCase() === code.trim().toLowerCase());
    if (existing) {
      setFormError(null);
      handleOpenModal(existing);
      return;
    }
    fetchData().then(() => {
      setFormError({
        kind: "generic",
        message:
          "Material existente recarregado na lista. Clique em editar para abrir o cadastro.",
      });
    });
  };

  const toggleMarketMonitoring = async (material: Material) => {
    try {
      await fetchOk(`/api/materials/${material.id}/market-monitoring`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isMarketMonitored: !material.isMarketMonitored }),
      });
      await fetchData();
    } catch (error) {
      console.error("Erro ao alterar monitoramento:", error);
      alert(
        error instanceof Error
          ? error.message
          : "Erro de conexão ao alterar monitoramento de mercado."
      );
    }
  };

  const toggleStatus = async (id: string, currentStatus: string) => {
    const newStatus = currentStatus === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    try {
      await fetchOk(`/api/materials/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      await fetchData();
    } catch (error) {
      console.error("Erro ao alterar status:", error);
      alert(error instanceof Error ? error.message : "Erro de conexão ao alterar status do material.");
    }
  };

  const filteredMaterials = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return materials.filter((mat) => {
      if (listCategoryFilter && mat.category !== listCategoryFilter) return false;
      if (listStatusFilter && mat.status !== listStatusFilter) return false;
      if (!q) return true;
      return (
        mat.description.toLowerCase().includes(q) ||
        mat.code.toLowerCase().includes(q) ||
        (mat.supplier ?? "").toLowerCase().includes(q)
      );
    });
  }, [materials, searchTerm, listCategoryFilter, listStatusFilter]);

  const clearListFilters = () => {
    setSearchTerm("");
    setListCategoryFilter("");
    setListStatusFilter("");
  };

  return (
    <div className="space-y-6" data-tour="materials-root">
      {/* Header Actions */}
      <div
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-4"
        data-tour="materials-toolbar"
      >
        <div className="flex-1 flex flex-col gap-2">
          <div className="flex flex-col lg:flex-row lg:items-center gap-2">
            <div className="relative flex-1 max-w-md min-w-[260px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Buscar por código, descrição ou fornecedor..."
                className="w-full pl-10 pr-4 py-2 rounded-lg border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>

            <select
              className="min-w-[170px] rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none"
              value={listCategoryFilter}
              onChange={(e) => setListCategoryFilter(e.target.value as any)}
            >
              <option value="">Todas as categorias</option>
              {MATERIAL_CATEGORY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>

            <select
              className="min-w-[150px] rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none"
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
              disabled={!searchTerm.trim() && !listCategoryFilter && !listStatusFilter}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card hover:bg-accent transition-colors text-sm font-medium disabled:opacity-50 disabled:hover:bg-card"
              title="Limpar filtros"
            >
              <X className="h-4 w-4" />
              Limpar
            </button>
          </div>

          <p className="text-xs text-muted-foreground">
            Exibindo <span className="font-bold text-foreground">{filteredMaterials.length}</span> de{" "}
            <span className="font-bold text-foreground">{materials.length}</span> material(is).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <TourHelpButton onClick={() => setTourOpen(true)} />
          {allowEditMaterials ? (
          <button 
            onClick={() => setIsImportOpen(true)}
            className="flex items-center gap-2 bg-accent text-accent-foreground px-4 py-2 rounded-lg font-medium hover:opacity-90 transition-opacity text-sm"
          >
            <Download className="h-4 w-4" />
            Importar
          </button>
          ) : null}
          {allowEditMaterials ? (
          <button 
            onClick={() => handleOpenModal()}
            className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg font-medium hover:opacity-90 transition-opacity text-sm"
          >
            <Plus className="h-4 w-4" />
            Novo Material
          </button>
          ) : null}
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
      <div
        className="bg-card rounded-xl border border-border overflow-hidden shadow-sm"
        data-tour="materials-table"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-accent/50 border-b border-border">
                <th className="p-4 font-semibold text-sm">Material</th>
                <th className="p-4 font-semibold text-sm">Categoria / Unid.</th>
                <th className="p-4 font-semibold text-sm">Custo Atual</th>
                <th className="p-4 font-semibold text-sm">Posto Fábrica</th>
                <th className="p-4 font-semibold text-sm">Custo c/ Perda</th>
                <th className="p-4 font-semibold text-sm">Mercado</th>
                <th className="p-4 font-semibold text-sm">Status</th>
                <th className="p-4 font-semibold text-sm text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center">
                    <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
                    <p className="mt-2 text-sm text-muted-foreground">Carregando materiais...</p>
                  </td>
                </tr>
              ) : filteredMaterials.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-muted-foreground">
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
                      <div className="flex flex-col items-start gap-1.5">
                        <MaterialMarketMonitoringBadge
                          isMarketMonitored={mat.isMarketMonitored}
                          marketCriticality={mat.marketCriticality}
                        />
                        {mat.isMarketMonitored ? (
                          <MaterialMarketSituationBadge situation={mat.marketSituation} />
                        ) : null}
                      </div>
                    </td>
                    <td className="p-4">
                      <div
                        className={cn(
                          "inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
                          mat.status === "ACTIVE"
                            ? "bg-green-500/10 text-green-600"
                            : "bg-red-500/10 text-red-600"
                        )}
                      >
                        <div
                          className={cn(
                            "h-1.5 w-1.5 rounded-full",
                            mat.status === "ACTIVE" ? "bg-green-600" : "bg-red-600"
                          )}
                        />
                        {mat.status === "ACTIVE" ? "Ativo" : "Inativo"}
                      </div>
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          to={getMaterialMarketIntelligenceDetailPath(mat.id)}
                          className="inline-flex items-center rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-semibold text-primary hover:bg-accent transition-colors"
                          title="Inteligência de Mercado"
                          data-testid={`material-intelligence-link-${mat.id}`}
                        >
                          <LineChart className="h-3.5 w-3.5 mr-1" />
                          Inteligência
                        </Link>
                        <button
                          onClick={() => toggleMarketMonitoring(mat)}
                          className={cn(
                            "p-2 rounded-md hover:bg-accent transition-all",
                            mat.isMarketMonitored
                              ? "text-primary"
                              : "text-muted-foreground hover:text-primary"
                          )}
                          title={
                            mat.isMarketMonitored
                              ? "Desativar monitoramento de mercado"
                              : "Monitorar na Inteligência de Mercado"
                          }
                          data-testid={`material-market-toggle-${mat.id}`}
                        >
                          <Radar className="h-4 w-4" />
                        </button>
                        <button 
                          onClick={() => setViewingHistory(mat)}
                          className="p-2 rounded-md hover:bg-accent text-muted-foreground hover:text-primary transition-all"
                          title="Histórico de Preços"
                        >
                          <History className="h-4 w-4" />
                        </button>
                        {allowEditMaterials ? (
                        <button 
                          onClick={() => handleOpenModal(mat)}
                          className="p-2 rounded-md hover:bg-accent text-muted-foreground hover:text-primary transition-all"
                          title="Editar"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        ) : null}
                        {allowEditMaterials ? (
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
                        ) : null}
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
                        <SearchableSelect
                          placeholder="Categoria..."
                          options={MATERIAL_CATEGORY_OPTIONS}
                          value={formData.category}
                          onChange={(v) => setFormData({ ...formData, category: v })}
                        />
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

              <div className="rounded-xl border border-border bg-accent/20 p-5 space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h4 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                      <LineChart className="h-4 w-4" /> Inteligência de Mercado
                    </h4>
                    <p className="text-xs text-muted-foreground mt-1 max-w-2xl">
                      Marque matérias estratégicas para acompanhamento na aba Inteligência de Mercado.
                    </p>
                  </div>
                  <label className="inline-flex items-center gap-2 text-sm font-medium cursor-pointer select-none">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-border text-primary focus:ring-primary/30"
                      checked={formData.isMarketMonitored === true}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          isMarketMonitored: e.target.checked,
                        })
                      }
                      data-testid="material-form-market-monitored"
                    />
                    Monitorar matéria-prima
                  </label>
                </div>

                {formData.isMarketMonitored ? (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-muted-foreground uppercase">
                        Criticidade
                      </label>
                      <select
                        className="w-full p-2 rounded-lg border border-border bg-background text-sm outline-none focus:ring-2 focus:ring-primary/20"
                        value={formData.marketCriticality ?? DEFAULT_MATERIAL_MARKET_CRITICALITY}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            marketCriticality: e.target.value as MaterialMarketCriticality,
                          })
                        }
                      >
                        {MATERIAL_MARKET_CRITICALITY_VALUES.map((value) => (
                          <option key={value} value={value}>
                            {MATERIAL_MARKET_CRITICALITY_LABELS[value]}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-muted-foreground uppercase">
                        Frequência (dias)
                      </label>
                      <input
                        type="number"
                        min={1}
                        step={1}
                        className="w-full p-2 rounded-lg border border-border bg-background text-sm outline-none focus:ring-2 focus:ring-primary/20"
                        value={formData.marketMonitoringFrequencyDays ?? ""}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            marketMonitoringFrequencyDays: parseInt(e.target.value, 10) || null,
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1.5 md:col-span-1">
                      <label className="text-xs font-bold text-muted-foreground uppercase">
                        Observações
                      </label>
                      <input
                        type="text"
                        className="w-full p-2 rounded-lg border border-border bg-background text-sm outline-none focus:ring-2 focus:ring-primary/20"
                        placeholder="Contexto de mercado, fornecedor, risco..."
                        value={formData.marketNotes ?? ""}
                        onChange={(e) =>
                          setFormData({ ...formData, marketNotes: e.target.value })
                        }
                      />
                    </div>
                  </div>
                ) : null}
              </div>

              {formError ? (
                <div
                  role="alert"
                  className={cn(
                    "rounded-lg border px-4 py-3 text-sm",
                    formError.kind === "duplicate"
                      ? "border-amber-300 bg-amber-50 text-amber-900"
                      : "border-red-300 bg-red-50 text-red-900"
                  )}
                >
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                    <div className="flex-1 space-y-2">
                      <p className="font-semibold">{formError.message}</p>
                      {formError.kind === "duplicate" ? (
                        <button
                          type="button"
                          onClick={() =>
                            handleOpenExistingByCode(
                              formError.existingMaterialId,
                              formError.code
                            )
                          }
                          className="inline-flex items-center gap-1.5 text-xs font-bold underline hover:no-underline"
                        >
                          Abrir material existente ({formError.code})
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="flex items-center justify-end gap-3 pt-6 border-t border-border">
                <button 
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-6 py-2 rounded-lg font-medium hover:bg-accent transition-colors text-sm"
                  disabled={submitting}
                >
                  Cancelar
                </button>
                <button 
                  type="submit"
                  disabled={submitting}
                  className="px-8 py-2 rounded-lg font-bold bg-primary text-primary-foreground hover:opacity-90 transition-opacity text-sm disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center gap-2"
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
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

      <GuidedTour
        open={tourOpen}
        onClose={() => setTourOpen(false)}
        steps={MATERIAL_TOUR_STEPS}
        tourName="Tour de Materiais"
      />
    </div>
  );
};
