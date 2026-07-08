import React, { useEffect, useMemo, useState } from "react";
import { 
  Plus, 
  Search, 
  Edit2, 
  Trash2, 
  X,
  Loader2,
  DollarSign,
  PieChart,
  Target,
  Building2,
  Briefcase,
  HelpCircle,
  Save,
  AlertCircle,
  TrendingUp,
  TrendingDown
} from "lucide-react";
import { cn, formatCurrency, formatNumber } from "@/src/lib/utils";
import { fetchJsonOk } from "@/src/lib/http";
import { motion, AnimatePresence } from "motion/react";
import { SearchableSelect } from "./shared/SearchableSelect";
import { FinanceExecutiveTotalizerCard } from "@/src/components/finance/shared/FinanceExecutiveTotalizerCard";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";
import { SYSTEM_TOTALIZER_GRID_CLASS } from "@/src/components/ui/SystemTotalizerCard";
import { GuidedTour } from "@/src/components/tour/GuidedTour";
import { TourHelpButton } from "@/src/components/tour/TourHelpButton";
import { INDIRECT_COST_TOUR_STEPS } from "@/src/tours/indirectTourSteps";
import { filterIndirectCosts } from "@/src/lib/operationalListFilters";

interface IndirectCost {
  id: string;
  description: string;
  category: string;
  monthlyValue: number;
  costCenter?: string;
  allocationCriteria: string;
  status: string;
}

export const IndirectCostModule = () => {
  const [costs, setCosts] = useState<IndirectCost[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [listCategory, setListCategory] = useState("");
  const [listStatus, setListStatus] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCost, setEditingCost] = useState<IndirectCost | null>(null);
  const [tourOpen, setTourOpen] = useState(false);

  const [formData, setFormData] = useState({
    description: "",
    category: "CIF",
    monthlyValue: 0,
    costCenter: "",
    allocationCriteria: "HH_TOTAL",
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const data = await fetchJsonOk<IndirectCost[]>("/api/indirect-costs");
      setCosts(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Erro ao buscar custos indiretos:", error);
      alert(error instanceof Error ? error.message : "Não foi possível carregar custos indiretos.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleOpenModal = (cost?: IndirectCost) => {
    if (cost) {
      setEditingCost(cost);
      setFormData({
        description: cost.description,
        category: cost.category,
        monthlyValue: Number(cost.monthlyValue),
        costCenter: cost.costCenter || "",
        allocationCriteria: cost.allocationCriteria,
      });
    } else {
      setEditingCost(null);
      setFormData({
        description: "",
        category: "CIF",
        monthlyValue: 0,
        costCenter: "",
        allocationCriteria: "HH_TOTAL",
      });
    }
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const method = editingCost ? "PUT" : "POST";
    const url = editingCost ? `/api/indirect-costs/${editingCost.id}` : "/api/indirect-costs";

    try {
      await fetchJsonOk(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      setIsModalOpen(false);
      fetchData();
    } catch (error) {
      console.error("Erro ao salvar:", error);
      alert(error instanceof Error ? error.message : "Não foi possível salvar o custo indireto.");
    }
  };

  const handleDelete = async (cost: IndirectCost) => {
    if (!window.confirm(`Tem certeza que deseja excluir este custo indireto: ${cost.description}?`)) return;
    
    try {
      await fetchJsonOk(`/api/indirect-costs/${cost.id}`, { method: "DELETE" });
      fetchData();
    } catch (error) {
      console.error("Erro ao deletar custo indireto:", error);
      window.alert(error instanceof Error ? error.message : "Erro ao excluir custo indireto.");
    }
  };

  const categories = [
    { id: "CIF", label: "Custo Indireto de Fab. (CIF)", icon: FactoryIcon, color: "text-blue-600", bg: "bg-blue-50" },
    { id: "ADMINISTRATIVO", label: "Administrativo", icon: Building2, color: "text-purple-600", bg: "bg-purple-50" },
    { id: "COMERCIAL", label: "Comercial", icon: Briefcase, color: "text-green-600", bg: "bg-green-50" },
    { id: "APOIO", label: "Apoio / Logística", icon: HelpCircle, color: "text-orange-600", bg: "bg-orange-50" },
    { id: "OPEX_GERAL", label: "OPEX Geral", icon: Target, color: "text-gray-600", bg: "bg-gray-50" },
  ];

  const criteria = [
    { id: "HH_TOTAL", label: "Horas Homem (HH)" },
    { id: "HM_TOTAL", label: "Horas Máquina (HM)" },
    { id: "PROD_VOLUME", label: "Volume de Produção" },
    { id: "FIXED", label: "Valor Fixo" },
  ];

  const totalCIF = costs.filter(c => c.category === "CIF" && c.status === "ACTIVE").reduce((acc, c) => acc + Number(c.monthlyValue), 0);
  const totalOPEX = costs.filter(c => c.category !== "CIF" && c.status === "ACTIVE").reduce((acc, c) => acc + Number(c.monthlyValue), 0);

  const filteredCosts = useMemo(() => {
    return filterIndirectCosts(costs, { search: searchTerm, category: listCategory, status: listStatus });
  }, [costs, searchTerm, listCategory, listStatus]);

  const clearListFilters = () => {
    setSearchTerm("");
    setListCategory("");
    setListStatus("");
  };

  return (
    <div className="space-y-6" data-tour="indirect-cost-root">
      {/* Summary Section */}
      <div data-tour="indirect-cost-summary">
      <SummaryKpiGrid
        className={SYSTEM_TOTALIZER_GRID_CLASS}
        minColumnWidth={200}
        testId="indirect-cost-summary"
      >
        <FinanceExecutiveTotalizerCard
          label="Total CIF Mensal"
          value={formatCurrency(totalCIF)}
          subtitle="Absorvido no Custo Industrial"
          tone="info"
        />
        <FinanceExecutiveTotalizerCard
          label="Total OPEX Mensal"
          value={formatCurrency(totalOPEX)}
          subtitle="Despesas Administrativas/Comerciais"
          tone="info"
        />
        <FinanceExecutiveTotalizerCard
          label="Total Geral"
          value={formatCurrency(totalCIF + totalOPEX)}
          subtitle="Impacto total na operação"
        />
        <FinanceExecutiveTotalizerCard
          label="Eficiência de Absorção"
          value="84.5%"
          tone="success"
        />
      </SummaryKpiGrid>
      </div>

      {/* Actions */}
      <div
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-4"
        data-tour="indirect-cost-toolbar"
      >
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-1">
          <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Buscar despesa ou centro de custo..."
            className="w-full pl-10 pr-4 py-2 rounded-lg border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
          <select
            className="min-w-[220px] rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none"
            value={listCategory}
            onChange={(e) => setListCategory(e.target.value)}
          >
            <option value="">Todas as categorias</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <select
            className="min-w-[160px] rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none"
            value={listStatus}
            onChange={(e) => setListStatus(e.target.value)}
          >
            <option value="">Todos os status</option>
            <option value="ACTIVE">Ativo</option>
            <option value="INACTIVE">Inativo</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <TourHelpButton onClick={() => setTourOpen(true)} />
          <button
            onClick={() => handleOpenModal()}
            className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg font-medium hover:opacity-90 transition-opacity text-sm"
          >
            <Plus className="h-4 w-4" />
            Nova Despesa
          </button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Exibindo <span className="font-bold text-foreground">{filteredCosts.length}</span> de{" "}
          <span className="font-bold text-foreground">{costs.filter((c) => c.category !== "GLOBAL_PARAM").length}</span>{" "}
          despesa(s).
        </p>
        <button
          type="button"
          onClick={clearListFilters}
          disabled={!searchTerm.trim() && !listCategory && !listStatus}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card hover:bg-accent transition-colors text-sm font-medium disabled:opacity-50 disabled:hover:bg-card"
        >
          <X className="h-4 w-4" />
          Limpar filtros
        </button>
      </div>

      {/* Table */}
      <div
        className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden"
        data-tour="indirect-cost-table"
      >
        <table className="w-full text-left text-sm">
          <thead className="bg-accent/50 border-b border-border">
            <tr>
              <th className="p-4 font-bold">Descrição / C. Custo</th>
              <th className="p-4 font-bold">Categoria</th>
              <th className="p-4 font-bold">Critério Rateio</th>
              <th className="p-4 font-bold text-right">Valor Mensal</th>
              <th className="p-4 font-bold text-center">Status</th>
              <th className="p-4 font-bold text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              <tr>
                <td colSpan={6} className="p-12 text-center">
                  <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
                </td>
              </tr>
            ) : costs.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-12 text-center text-muted-foreground italic">
                  Nenhuma despesa indireta cadastrada.
                </td>
              </tr>
            ) : filteredCosts.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-12 text-center text-muted-foreground italic">
                  Nenhum resultado encontrado com os filtros aplicados.
                </td>
              </tr>
            ) : (
              filteredCosts.map((cost) => {
                const cat = categories.find(cat => cat.id === cost.category);
                const Icon = cat?.icon || HelpCircle;
                return (
                  <tr key={cost.id} className="hover:bg-accent/20 transition-colors group">
                    <td className="p-4">
                      <p className="font-bold">{cost.description}</p>
                      <p className="text-[10px] text-muted-foreground uppercase">{cost.costCenter || "Geral"}</p>
                    </td>
                    <td className="p-4">
                      <div className={cn("inline-flex items-center gap-2 px-2 py-1 rounded-lg text-[10px] font-bold uppercase", cat?.bg, cat?.color)}>
                        <Icon className="h-3 w-3" />
                        {cat?.label}
                      </div>
                    </td>
                    <td className="p-4">
                      <span className="text-xs text-muted-foreground">
                        {criteria.find(cr => cr.id === cost.allocationCriteria)?.label}
                      </span>
                    </td>
                    <td className="p-4 text-right font-bold text-base">
                      {formatCurrency(cost.monthlyValue, 2)}
                    </td>
                    <td className="p-4 text-center">
                      <span className={cn(
                        "text-[10px] font-bold px-2 py-0.5 rounded-full",
                        cost.status === "ACTIVE" ? "bg-green-500/10 text-green-600" : "bg-red-500/10 text-red-600"
                      )}>
                        {cost.status}
                      </span>
                    </td>
                    <td className="p-4 text-right flex justify-end gap-2">
                      <button 
                        onClick={() => handleOpenModal(cost)}
                        className="p-2 rounded-lg hover:bg-accent text-muted-foreground hover:text-primary transition-colors"
                        title="Editar"
                      >
                        <Edit2 className="h-4 w-4" />
                      </button>
                      <button 
                        onClick={() => handleDelete(cost)}
                        className="p-2 rounded-lg hover:bg-accent text-muted-foreground hover:text-red-500 transition-colors"
                        title="Excluir"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-card w-full max-w-lg rounded-2xl border border-border shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-border flex items-center justify-between bg-accent/30">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                    <PieChart className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold">{editingCost ? "Editar Despesa" : "Nova Despesa Indireta"}</h3>
                    <p className="text-xs text-muted-foreground">Configure os valores e critérios de rateio.</p>
                  </div>
                </div>
                <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-accent rounded-full transition-colors">
                  <X className="h-5 w-5" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="p-6 space-y-5">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-muted-foreground uppercase">Descrição da Despesa</label>
                  <input
                    required
                    type="text"
                    className="w-full p-3 rounded-xl border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none"
                    value={formData.description}
                    onChange={(e) => setFormData({...formData, description: e.target.value})}
                    placeholder="Ex: Energia Elétrica Fábrica, Aluguel Escritório..."
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase">Categoria</label>
                    <SearchableSelect
                      placeholder="Categoria..."
                      options={categories.map((cat) => ({
                        value: cat.id,
                        label: cat.label,
                        searchTerms: `${cat.id} ${cat.label}`,
                      }))}
                      value={formData.category}
                      onChange={(v) => setFormData({ ...formData, category: v })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase">Valor Mensal (R$)</label>
                    <input
                      required
                      type="number"
                      step="0.00001"
                      className="w-full p-3 rounded-xl border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none"
                      value={formData.monthlyValue}
                      onChange={(e) => setFormData({...formData, monthlyValue: parseFloat(e.target.value)})}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase">Centro de Custo</label>
                    <input
                      type="text"
                      className="w-full p-3 rounded-xl border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none"
                      value={formData.costCenter}
                      onChange={(e) => setFormData({...formData, costCenter: e.target.value})}
                      placeholder="Ex: PRODUCAO, ADM"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase">Critério de Rateio</label>
                    <SearchableSelect
                      placeholder="Critério..."
                      options={criteria.map((cr) => ({
                        value: cr.id,
                        label: cr.label,
                        searchTerms: `${cr.id} ${cr.label}`,
                      }))}
                      value={formData.allocationCriteria}
                      onChange={(v) => setFormData({ ...formData, allocationCriteria: v })}
                    />
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
                    Salvar
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
        steps={INDIRECT_COST_TOUR_STEPS}
        tourName="Tour de Custos Indiretos"
      />
    </div>
  );
};

const FactoryIcon = (props: any) => (
  <svg
    {...props}
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" />
    <path d="M17 18h1" />
    <path d="M12 18h1" />
    <path d="M7 18h1" />
  </svg>
);
