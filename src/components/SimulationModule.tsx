import React, { useEffect, useState } from "react";
import { 
  TrendingUp, 
  Plus, 
  Search, 
  Trash2, 
  X,
  Loader2,
  Calculator,
  ArrowRight,
  AlertCircle,
  Save,
  Layers,
  Zap,
  Users,
  Truck,
  DollarSign,
  ArrowUpRight,
  ArrowDownRight,
  Info
} from "lucide-react";
import { cn, formatCurrency, formatNumber } from "@/src/lib/utils";
import { motion, AnimatePresence } from "motion/react";

export const SimulationModule = () => {
  const [simulations, setSimulations] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [taxRules, setTaxRules] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [comparing, setComparing] = useState<any | null>(null);

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
      const [sRes, pRes, tRes] = await Promise.all([
        fetch("/api/simulations"),
        fetch("/api/products"),
        fetch("/api/tax-rules")
      ]);
      setSimulations(await sRes.json());
      setProducts(await pRes.json());
      setTaxRules(await tRes.json());
    } catch (error) {
      console.error("Erro ao buscar simulações:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleCompare = async (id: string) => {
    try {
      const res = await fetch(`/api/simulations/${id}/compare`);
      const data = await res.json();
      setComparing(data);
    } catch (error) {
      console.error("Erro ao comparar:", error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/simulations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      if (res.ok) {
        setIsModalOpen(false);
        fetchData();
      }
    } catch (error) {
      console.error("Erro ao salvar simulação:", error);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Excluir esta simulação?")) return;
    try {
      await fetch(`/api/simulations/${id}`, { method: "DELETE" });
      fetchData();
    } catch (error) {
      console.error("Erro ao excluir:", error);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-bold tracking-tight">Cenários e Simulações</h2>
          <p className="text-xs text-muted-foreground">Teste o impacto de variações de mercado sem alterar seus dados oficiais.</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg font-medium hover:opacity-90 transition-opacity text-sm"
        >
          <Plus className="h-4 w-4" />
          Novo Cenário
        </button>
      </div>

      {/* Simulations Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
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

              <div className="flex-1 overflow-y-auto p-8 space-y-12">
                {/* Main Comparison Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  {/* Official Base */}
                  <div className="p-6 rounded-2xl border border-border bg-accent/5 space-y-6">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">Base Oficial</span>
                      <span className="px-2 py-0.5 rounded-full bg-muted text-[10px] font-bold">Atual</span>
                    </div>
                    <div className="space-y-1">
                      <p className="text-4xl font-black">{formatCurrency(comparing.base.resultados.suggestedPrice)}</p>
                      <p className="text-xs text-muted-foreground">Preço Sugerido Base</p>
                    </div>
                    <div className="pt-4 border-t border-border grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-[10px] font-bold text-muted-foreground uppercase">CIU Base</p>
                        <p className="text-sm font-bold">{formatCurrency(comparing.base.ciu)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold text-muted-foreground uppercase">Margem Base</p>
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
                        comparing.delta.pricePct > 0 ? "bg-red-100 text-red-600" : "bg-green-100 text-green-600"
                      )}>
                        {comparing.delta.pricePct > 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                        {formatNumber(Math.abs(comparing.delta.pricePct))}%
                      </div>
                    </div>
                    <div className="space-y-1">
                      <p className="text-4xl font-black text-primary">{formatCurrency(comparing.simulated.suggestedPrice)}</p>
                      <p className="text-xs text-primary/60">Novo Preço Sugerido</p>
                    </div>
                    <div className="pt-4 border-t border-primary/20 grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-[10px] font-bold text-primary uppercase">Novo CIU</p>
                        <p className="text-sm font-bold">{formatCurrency(comparing.simulated.ciu)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold text-primary uppercase">Nova Margem</p>
                        <p className="text-sm font-bold">{formatNumber(comparing.simulated.marginRate)}%</p>
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
                        {comparing.delta.ciu > 0 ? "+" : ""}{formatCurrency(comparing.delta.ciu)}
                      </p>
                      <p className="text-[10px] text-muted-foreground">por unidade produzida</p>
                    </div>
                    <div className="p-5 rounded-2xl border border-border bg-card shadow-sm flex flex-col items-center text-center">
                      <p className="text-[10px] font-bold text-muted-foreground uppercase mb-2">Variação de Preço</p>
                      <p className={cn("text-xl font-black", comparing.delta.price > 0 ? "text-red-600" : "text-green-600")}>
                        {comparing.delta.price > 0 ? "+" : ""}{formatCurrency(comparing.delta.price)}
                      </p>
                      <p className="text-[10px] text-muted-foreground">necessário para manter margem</p>
                    </div>
                    <div className="p-5 rounded-2xl border border-border bg-card shadow-sm flex flex-col items-center text-center">
                      <p className="text-[10px] font-bold text-muted-foreground uppercase mb-2">Novo Markup</p>
                      <p className="text-xl font-black text-primary">
                        {formatNumber(comparing.simulated.markup)}x
                      </p>
                      <p className="text-[10px] text-muted-foreground">fator multiplicador simulado</p>
                    </div>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-orange-50 border border-orange-100 flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-orange-600 shrink-0 mt-0.5" />
                  <p className="text-xs text-orange-800 leading-relaxed">
                    <b>Atenção:</b> Esta simulação utiliza aproximações baseadas na estrutura de custos atual. 
                    Os resultados são estimativas para suporte à decisão e não alteram os registros oficiais do sistema.
                  </p>
                </div>
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
                      <select
                        required
                        className="w-full p-3 rounded-xl border border-border bg-background outline-none focus:ring-2 focus:ring-primary/20"
                        value={formData.productId}
                        onChange={(e) => setFormData({...formData, productId: e.target.value})}
                      >
                        <option value="">Selecione...</option>
                        {products.map(p => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-muted-foreground uppercase">Canal de Venda</label>
                      <select
                        required
                        className="w-full p-3 rounded-xl border border-border bg-background outline-none focus:ring-2 focus:ring-primary/20"
                        value={formData.taxRuleId}
                        onChange={(e) => setFormData({...formData, taxRuleId: e.target.value})}
                      >
                        <option value="">Selecione...</option>
                        {taxRules.map(r => (
                          <option key={r.id} value={r.id}>{r.name}</option>
                        ))}
                      </select>
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
    </div>
  );
};
