import React, { useEffect, useState } from "react";
import { 
  Calculator, 
  Plus, 
  Search, 
  Edit2, 
  Trash2, 
  X,
  Loader2,
  DollarSign,
  TrendingUp,
  TrendingDown,
  Percent,
  Truck,
  Users,
  ShieldCheck,
  Save,
  AlertCircle,
  Info,
  ChevronRight,
  BarChart3
} from "lucide-react";
import { cn, formatCurrency, formatNumber } from "@/src/lib/utils";
import { motion, AnimatePresence } from "motion/react";

export const PricingModule = () => {
  const [pricings, setPricings] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [taxRules, setTaxRules] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [calculationResult, setCalculationResult] = useState<any | null>(null);

  const [formData, setFormData] = useState({
    productId: "",
    taxRuleId: "",
    desiredMargin: 15,
    commission: 5,
    freightOut: 0,
    otherVariables: 0,
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const [pRes, prodRes, taxRes] = await Promise.all([
        fetch("/api/pricing"),
        fetch("/api/products"),
        fetch("/api/tax-rules")
      ]);
      setPricings(await pRes.json());
      setProducts(await prodRes.json());
      setTaxRules(await taxRes.json());
    } catch (error) {
      console.error("Erro ao buscar dados de preço:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleCalculate = async (productId: string, taxRuleId: string) => {
    setCalculating(true);
    try {
      const res = await fetch(`/api/pricing/${productId}/${taxRuleId}/calculate`);
      const data = await res.json();
      if (res.ok) {
        setCalculationResult(data);
      } else {
        alert(data.error || "Erro ao calcular preço");
      }
    } catch (error) {
      console.error("Erro no cálculo:", error);
    } finally {
      setCalculating(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/pricing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      if (res.ok) {
        setIsModalOpen(false);
        fetchData();
      }
    } catch (error) {
      console.error("Erro ao salvar premissas:", error);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-bold tracking-tight">Simulador de Preços</h2>
          <p className="text-xs text-muted-foreground">Transforme custos industriais em preços competitivos e margens saudáveis.</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg font-medium hover:opacity-90 transition-opacity text-sm"
        >
          <Plus className="h-4 w-4" />
          Nova Premissa Comercial
        </button>
      </div>

      {/* Pricing Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {loading ? (
          <div className="col-span-full p-12 text-center">
            <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
          </div>
        ) : pricings.length === 0 ? (
          <div className="col-span-full p-12 text-center border-2 border-dashed border-border rounded-2xl text-muted-foreground">
            Nenhuma premissa de preço configurada.
          </div>
        ) : (
          pricings.map((pricing) => (
            <motion.div 
              key={pricing.id}
              className="bg-card rounded-2xl border border-border overflow-hidden shadow-sm hover:shadow-md transition-all group"
            >
              <div className="p-5 border-b border-border bg-accent/30">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-bold text-primary uppercase tracking-widest">{pricing.TaxRule.name}</span>
                  <button 
                    onClick={() => {
                      setFormData({
                        productId: pricing.productId,
                        taxRuleId: pricing.taxRuleId,
                        desiredMargin: Number(pricing.desiredMargin),
                        commission: Number(pricing.commission),
                        freightOut: Number(pricing.freightOut),
                        otherVariables: Number(pricing.otherVariables),
                      });
                      setIsModalOpen(true);
                    }}
                    className="p-1.5 rounded-lg hover:bg-background text-muted-foreground hover:text-primary transition-colors"
                  >
                    <Edit2 className="h-3 w-3" />
                  </button>
                </div>
                <h3 className="font-bold text-sm">{pricing.Product.name}</h3>
                <p className="text-[10px] font-mono text-muted-foreground">{pricing.Product.sku}</p>
              </div>
              
              <div className="p-5 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <p className="text-[10px] text-muted-foreground uppercase font-bold">Margem Alvo</p>
                    <p className="text-lg font-black text-green-600">{formatNumber(pricing.desiredMargin)}%</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] text-muted-foreground uppercase font-bold">Comissão</p>
                    <p className="text-lg font-black text-orange-600">{formatNumber(pricing.commission)}%</p>
                  </div>
                </div>

                <button 
                  onClick={() => handleCalculate(pricing.productId, pricing.taxRuleId)}
                  className="w-full py-2 rounded-xl bg-primary/10 text-primary text-xs font-bold hover:bg-primary hover:text-primary-foreground transition-all flex items-center justify-center gap-2"
                >
                  <Calculator className="h-3 w-3" />
                  Calcular Preço Agora
                </button>
              </div>
            </motion.div>
          ))
        )}
      </div>

      {/* Modal: Calculation Result */}
      <AnimatePresence>
        {calculationResult && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-card w-full max-w-4xl rounded-2xl border border-border shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-6 border-b border-border flex items-center justify-between bg-primary text-primary-foreground">
                <div>
                  <h3 className="text-xl font-bold">Resultado da Formação de Preço</h3>
                  <p className="text-xs opacity-80">{calculationResult.product} • SKU: {calculationResult.sku}</p>
                </div>
                <button onClick={() => setCalculationResult(null)} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-8">
                {/* Main Price Card */}
                <div className="relative p-8 rounded-3xl bg-primary/5 border-2 border-primary/20 flex flex-col items-center text-center overflow-hidden">
                  <div className="absolute top-4 right-4 bg-primary text-primary-foreground px-3 py-1 rounded-full text-[10px] font-black uppercase">
                    Preço Sugerido
                  </div>
                  <p className="text-5xl font-black text-primary mb-2">
                    {formatCurrency(calculationResult.resultados.suggestedPrice)}
                  </p>
                  <div className="flex items-center gap-4 text-sm font-bold text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <TrendingUp className="h-4 w-4 text-green-500" />
                      Markup: {formatNumber(calculationResult.resultados.markup)}x
                    </span>
                    <span className="h-4 w-px bg-border" />
                    <span className="flex items-center gap-1">
                      <ShieldCheck className="h-4 w-4 text-blue-500" />
                      Margem Líquida: {calculationResult.premissas.marginRate}%
                    </span>
                  </div>
                </div>

                {/* Breakdown Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  {/* Costs Block */}
                  <div className="space-y-4">
                    <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                      <BarChart3 className="h-3 w-3" /> Estrutura de Custos
                    </h4>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between p-3 rounded-xl bg-accent/20 border border-border">
                        <span className="text-xs font-medium">Custo Industrial (CIU)</span>
                        <span className="text-sm font-bold">{formatCurrency(calculationResult.ciu)}</span>
                      </div>
                      <div className="flex items-center justify-between p-3 rounded-xl bg-accent/20 border border-border">
                        <span className="text-xs font-medium">Custo Fabril Completo</span>
                        <span className="text-sm font-bold">{formatCurrency(calculationResult.custoFabril)}</span>
                      </div>
                      <div className="flex items-center justify-between p-3 rounded-xl bg-accent/20 border border-border">
                        <span className="text-xs font-medium">Custo Gerencial Total</span>
                        <span className="text-sm font-bold">{formatCurrency(calculationResult.custoGerencial)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Deductions Block */}
                  <div className="space-y-4">
                    <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                      <TrendingDown className="h-3 w-3" /> Deduções sobre Venda
                    </h4>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between p-3 rounded-xl bg-red-50 border border-red-100 text-red-700">
                        <span className="text-xs font-medium">Impostos ({calculationResult.premissas.taxRate}%)</span>
                        <span className="text-sm font-bold">-{formatCurrency(calculationResult.resultados.totalTaxes)}</span>
                      </div>
                      <div className="flex items-center justify-between p-3 rounded-xl bg-red-50 border border-red-100 text-red-700">
                        <span className="text-xs font-medium">Comissão ({calculationResult.premissas.commRate}%)</span>
                        <span className="text-sm font-bold">-{formatCurrency(calculationResult.resultados.totalCommission)}</span>
                      </div>
                      <div className="flex items-center justify-between p-3 rounded-xl bg-red-50 border border-red-100 text-red-700">
                        <span className="text-xs font-medium">Frete de Saída</span>
                        <span className="text-sm font-bold">-{formatCurrency(calculationResult.premissas.freight)}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Margins Block */}
                <div className="p-6 rounded-2xl bg-accent/30 border border-border space-y-4">
                  <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Análise de Rentabilidade</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="p-4 rounded-xl bg-white border border-border">
                      <p className="text-[10px] font-bold text-muted-foreground uppercase mb-1">Margem de Contribuição</p>
                      <p className="text-xl font-black text-primary">{formatCurrency(calculationResult.resultados.contributionMargin)}</p>
                      <p className="text-[10px] text-muted-foreground mt-1">Sobra para pagar custos fixos e gerar lucro.</p>
                    </div>
                    <div className="p-4 rounded-xl bg-white border border-border">
                      <p className="text-[10px] font-bold text-muted-foreground uppercase mb-1">Margem Operacional Líquida</p>
                      <p className="text-xl font-black text-green-600">{formatCurrency(calculationResult.resultados.operationalMargin)}</p>
                      <p className="text-[10px] text-muted-foreground mt-1">Lucro real após absorção de todo o OPEX.</p>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal: Premissas Form */}
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
                    <Calculator className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold">Premissas Comerciais</h3>
                    <p className="text-xs text-muted-foreground">Configure as taxas que compõem o markup.</p>
                  </div>
                </div>
                <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-accent rounded-full transition-colors">
                  <X className="h-5 w-5" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="p-6 space-y-5">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-muted-foreground uppercase">Produto</label>
                  <select
                    required
                    className="w-full p-3 rounded-xl border border-border bg-background outline-none focus:ring-2 focus:ring-primary/20"
                    value={formData.productId}
                    onChange={(e) => setFormData({...formData, productId: e.target.value})}
                  >
                    <option value="">Selecione...</option>
                    {products.map(p => (
                      <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-muted-foreground uppercase">Canal / Regra Fiscal</label>
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

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-1">
                      <Percent className="h-3 w-3" /> Margem Líquida (%)
                    </label>
                    <input
                      required
                      type="number"
                      className="w-full p-3 rounded-xl border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none"
                      value={formData.desiredMargin}
                      onChange={(e) => setFormData({...formData, desiredMargin: parseFloat(e.target.value)})}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-1">
                      <Users className="h-3 w-3" /> Comissão (%)
                    </label>
                    <input
                      required
                      type="number"
                      className="w-full p-3 rounded-xl border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none"
                      value={formData.commission}
                      onChange={(e) => setFormData({...formData, commission: parseFloat(e.target.value)})}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-1">
                      <Truck className="h-3 w-3" /> Frete Saída (R$)
                    </label>
                    <input
                      required
                      type="number"
                      className="w-full p-3 rounded-xl border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none"
                      value={formData.freightOut}
                      onChange={(e) => setFormData({...formData, freightOut: parseFloat(e.target.value)})}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-1">
                      <Percent className="h-3 w-3" /> Outros Var. (%)
                    </label>
                    <input
                      required
                      type="number"
                      className="w-full p-3 rounded-xl border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none"
                      value={formData.otherVariables}
                      onChange={(e) => setFormData({...formData, otherVariables: parseFloat(e.target.value)})}
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
                    Salvar Premissas
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
