import React, { useEffect, useState } from "react";
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
import { motion, AnimatePresence } from "motion/react";

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
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCost, setEditingCost] = useState<IndirectCost | null>(null);

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
      const res = await fetch("/api/indirect-costs");
      setCosts(await res.json());
    } catch (error) {
      console.error("Erro ao buscar custos indiretos:", error);
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

  return (
    <div className="space-y-6">
      {/* Summary Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="p-6 rounded-2xl border border-border bg-card shadow-sm">
          <p className="text-[10px] font-bold text-muted-foreground uppercase mb-1">Total CIF Mensal</p>
          <p className="text-2xl font-black text-blue-600">{formatCurrency(totalCIF)}</p>
          <p className="text-[10px] text-muted-foreground mt-1">Absorvido no Custo Industrial</p>
        </div>
        <div className="p-6 rounded-2xl border border-border bg-card shadow-sm">
          <p className="text-[10px] font-bold text-muted-foreground uppercase mb-1">Total OPEX Mensal</p>
          <p className="text-2xl font-black text-purple-600">{formatCurrency(totalOPEX)}</p>
          <p className="text-[10px] text-muted-foreground mt-1">Despesas Administrativas/Comerciais</p>
        </div>
        <div className="p-6 rounded-2xl border border-border bg-card shadow-sm">
          <p className="text-[10px] font-bold text-muted-foreground uppercase mb-1">Total Geral</p>
          <p className="text-2xl font-black">{formatCurrency(totalCIF + totalOPEX)}</p>
          <p className="text-[10px] text-muted-foreground mt-1">Impacto total na operação</p>
        </div>
        <div className="p-6 rounded-2xl border border-border bg-primary text-primary-foreground shadow-lg shadow-primary/20">
          <p className="text-[10px] font-bold uppercase mb-1 opacity-80">Eficiência de Absorção</p>
          <p className="text-2xl font-black">84.5%</p>
          <div className="w-full bg-white/20 h-1.5 rounded-full mt-2 overflow-hidden">
            <div className="bg-white h-full" style={{ width: "84.5%" }} />
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
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
        <button 
          onClick={() => handleOpenModal()}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg font-medium hover:opacity-90 transition-opacity text-sm"
        >
          <Plus className="h-4 w-4" />
          Nova Despesa
        </button>
      </div>

      {/* Table */}
      <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
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
            ) : (
              costs.filter(c => c.category !== "GLOBAL_PARAM" && c.description.toLowerCase().includes(searchTerm.toLowerCase())).map((cost) => {
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
                      {formatCurrency(cost.monthlyValue)}
                    </td>
                    <td className="p-4 text-center">
                      <span className={cn(
                        "text-[10px] font-bold px-2 py-0.5 rounded-full",
                        cost.status === "ACTIVE" ? "bg-green-500/10 text-green-600" : "bg-red-500/10 text-red-600"
                      )}>
                        {cost.status}
                      </span>
                    </td>
                    <td className="p-4 text-right">
                      <button 
                        onClick={() => handleOpenModal(cost)}
                        className="p-2 rounded-lg hover:bg-accent text-muted-foreground hover:text-primary transition-colors"
                      >
                        <Edit2 className="h-4 w-4" />
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
                    <select
                      className="w-full p-3 rounded-xl border border-border bg-background outline-none focus:ring-2 focus:ring-primary/20"
                      value={formData.category}
                      onChange={(e) => setFormData({...formData, category: e.target.value})}
                    >
                      {categories.map(cat => (
                        <option key={cat.id} value={cat.id}>{cat.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase">Valor Mensal (R$)</label>
                    <input
                      required
                      type="number"
                      step="0.01"
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
                    <select
                      className="w-full p-3 rounded-xl border border-border bg-background outline-none focus:ring-2 focus:ring-primary/20"
                      value={formData.allocationCriteria}
                      onChange={(e) => setFormData({...formData, allocationCriteria: e.target.value})}
                    >
                      {criteria.map(cr => (
                        <option key={cr.id} value={cr.id}>{cr.label}</option>
                      ))}
                    </select>
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
