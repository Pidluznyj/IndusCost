import React, { useEffect, useState } from "react";
import { 
  Calculator, Plus, Search, Edit2, Trash2, X, Loader2, DollarSign,
  TrendingUp, TrendingDown, Percent, Truck, Users, ShieldCheck, Save,
  BarChart3, Layers, LayoutGrid, Play, AlertCircle, CheckCircle2, ChevronRight, BookOpen
} from "lucide-react";
import { cn, formatCurrency, formatNumber } from "@/src/lib/utils";
import { fetchJsonOk } from "@/src/lib/http";
import { SearchableSelect } from "./shared/SearchableSelect";
import { motion, AnimatePresence } from "motion/react";
import { GuidedTour } from "@/src/components/tour/GuidedTour";
import { TourHelpButton } from "@/src/components/tour/TourHelpButton";
import { PRICING_TOUR_STEPS } from "@/src/tours/pricingTourSteps";
import { PricingOpenBookTab } from "@/src/components/pricing/PricingOpenBookTab";
import type { PricingOpenBookPayload } from "@/src/lib/pricingOpenBook";

export const PricingModule = () => {
  const [tourOpen, setTourOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"UNIT" | "BATCH">("UNIT");
  const [selectedPricings, setSelectedPricings] = useState<string[]>([]);

  const [pricings, setPricings] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [taxRules, setTaxRules] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [calculationResult, setCalculationResult] = useState<any | null>(null);
  const [resultTab, setResultTab] = useState<"summary" | "composition">("summary");
  
  const [searchTermBatch, setSearchTermBatch] = useState("");
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [simulatingBatch, setSimulatingBatch] = useState(false);
  const [batchResults, setBatchResults] = useState<any[] | null>(null);

  const [formData, setFormData] = useState({
    productId: "",
    taxRuleId: "",
    desiredMargin: 15,
    commission: 5,
    freightOut: 0,
    otherVariables: 0,
  });

  const [batchFormData, setBatchFormData] = useState({
    taxRuleId: "",
    desiredMargin: 15,
    commission: 5,
    freightOut: 0,
    otherVariables: 0,
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const [p, prod, tax] = await Promise.all([
        fetchJsonOk("/api/pricing"),
        fetchJsonOk("/api/products"),
        fetchJsonOk("/api/tax-rules"),
      ]);
      setPricings(Array.isArray(p) ? p : []);
      setProducts(Array.isArray(prod) ? prod : []);
      setTaxRules(Array.isArray(tax) ? tax : []);
    } catch (error) {
      console.error("Erro ao buscar dados de preço:", error);
      alert(error instanceof Error ? error.message : "Não foi possível carregar precificação.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // --- UNITARY LOGIC ---
  const handleCalculateUnit = async (productId: string, taxRuleId: string) => {
    setCalculating(true);
    try {
      const data = await fetchJsonOk(`/api/pricing/${productId}/${taxRuleId}/calculate`);
      setCalculationResult(data);
      setResultTab("summary");
    } catch (error) {
      console.error("Erro no cálculo:", error);
      alert(error instanceof Error ? error.message : "Erro ao calcular preço.");
    } finally {
      setCalculating(false);
    }
  };

  const handleSubmitUnit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await fetchJsonOk("/api/pricing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      setIsModalOpen(false);
      fetchData();
    } catch (error) {
      console.error("Erro ao salvar premissas unitárias:", error);
      alert(error instanceof Error ? error.message : "Não foi possível salvar a formação de preço.");
    }
  };

  const handleDeleteUnit = async (pricing: any) => {
    if (!window.confirm(`Tem certeza que deseja excluir esta premissa de precificação do produto ${pricing.Product?.name}?`)) return;
    
    try {
      await fetchJsonOk(`/api/pricing/${pricing.id}`, { method: "DELETE" });
      fetchData();
    } catch (error) {
      console.error("Erro durante request de deleção:", error);
      window.alert(error instanceof Error ? error.message : "Falha ao excluir a formação de preço.");
    }
  };

  const togglePricingSelection = (id: string) => {
    setSelectedPricings(prev => prev.includes(id) ? prev.filter(v => v !== id) : [...prev, id]);
  };

  const toggleAllPricings = () => {
    if (selectedPricings.length > 0 && selectedPricings.length === pricings.length) {
      setSelectedPricings([]);
    } else {
      setSelectedPricings(pricings.map((p: any) => p.id));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedPricings.length === 0) return;
    if (!window.confirm(`Confirma a exclusão Múltipla de ${selectedPricings.length} formações de preço?`)) return;

    try {
      const data = await fetchJsonOk<{
        success?: number;
        error?: number;
        details?: Array<{ message?: string }>;
      }>("/api/pricing/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedPricings }),
      });

      if (data.error != null && data.error > 0) {
        window.alert(
          `${data.success ?? 0} apagados. Houveram ${data.error} falhas.\nExemplo de falha: ${data.details?.[0]?.message ?? "—"}`
        );
      }

      setSelectedPricings([]);
      fetchData();
    } catch (err) {
      console.error("Erro no bulk delete", err);
      window.alert(err instanceof Error ? err.message : "Falha de conexão ao excluir lote.");
    }
  };

  // --- BATCH LOGIC ---
  const handleToggleSelectAll = () => {
    const filteredIds = products
      .filter(p => p.name.toLowerCase().includes(searchTermBatch.toLowerCase()) || p.sku.toLowerCase().includes(searchTermBatch.toLowerCase()))
      .map(p => p.id);

    if (selectedProductIds.length === filteredIds.length) {
      setSelectedProductIds([]);
    } else {
      setSelectedProductIds(filteredIds);
    }
  };

  const handleSimulateBatch = async () => {
    if (selectedProductIds.length === 0) return alert("Selecione ao menos 1 produto.");
    if (!batchFormData.taxRuleId) return alert("Selecione uma Regra Fiscal.");

    setSimulatingBatch(true);
    try {
      const data = await fetchJsonOk<{ results: any[] }>("/api/pricing/simulate-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productIds: selectedProductIds,
          ...batchFormData
        }),
      });
      setBatchResults(data.results ?? []);
    } catch (error) {
      console.error("Erro na simulação de lote:", error);
      alert(error instanceof Error ? error.message : "Erro na simulação em lote.");
    } finally {
      setSimulatingBatch(false);
    }
  };

  const handleApplyBatch = async () => {
    if (!batchResults) return;
    
    // Pega apenas os resultados verdes (SUCCESS)
    const validResults = batchResults.filter(r => r.status === "SUCCESS");
    if (validResults.length === 0) return alert("Nenhum item válido para aplicar.");

    if (!window.confirm(`Tem certeza que deseja gravar as premissas de preço para ${validResults.length} produtos?`)) return;

    try {
      const data = await fetchJsonOk<{ appliedCount?: number }>("/api/pricing/apply-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          validResults,
          ...batchFormData
        })
      });
      alert(`${data.appliedCount ?? 0} produtos atualizados com sucesso!`);
      // Limpa para voltar à tabela com seleção vazia
      setBatchResults(null);
      setSelectedProductIds([]);
      fetchData(); // para aparecer na aba de unitário caso voltem lá
    } catch (err) {
      console.error("Apply batch error", err);
      alert(err instanceof Error ? err.message : "Falha ao aplicar lote.");
    }
  };

  return (
    <div className="space-y-6" data-tour="pricing-root">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Formação de Preço</h2>
            <p className="text-xs text-muted-foreground">Estratégia e precificação do portfólio industrial.</p>
          </div>
          <TourHelpButton onClick={() => setTourOpen(true)} />
        </div>

        {/* Toggle View Mode */}
        <div
          className="flex bg-accent/30 p-1 rounded-xl w-fit border border-border"
          data-tour="pricing-mode-toggle"
        >
          <button 
            onClick={() => setViewMode("UNIT")}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all",
              viewMode === "UNIT" ? "bg-card shadow-sm text-primary" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <LayoutGrid className="h-4 w-4" /> Gestão Unitária
          </button>
          <button 
            onClick={() => setViewMode("BATCH")}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all",
              viewMode === "BATCH" ? "bg-card shadow-sm text-primary" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Layers className="h-4 w-4" /> Processamento em Lote
          </button>
        </div>
      </div>

      {loading && viewMode === "UNIT" ? (
        <div className="p-12 text-center"><Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" /></div>
      ) : viewMode === "UNIT" ? (
        // --- VIEW: UNIT ---
        <div className="space-y-6" data-tour="pricing-unit-panel">
          <div className="flex justify-end">
             <button 
              onClick={() => {
                setFormData({ productId: "", taxRuleId: "", desiredMargin: 15, commission: 5, freightOut: 0, otherVariables: 0 });
                setIsModalOpen(true);
              }}
              className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg font-medium hover:opacity-90 transition-opacity text-sm"
            >
              <Plus className="h-4 w-4" /> Nova Premissa
            </button>
          </div>

     <div className="space-y-4">
       {/* UI Header Customizado pro Lote selecionado */}
       {selectedPricings.length > 0 && (
         <div className="bg-red-50 text-red-900 border border-red-200 rounded-xl p-3 flex justify-between items-center animate-in fade-in slide-in-from-top-2">
           <span className="text-sm font-bold">{selectedPricings.length} Formação(ões) selecionada(s)</span>
           <button onClick={handleBulkDelete} className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-xs font-bold transition-colors">
              Excluir Selecionados
           </button>
         </div>
       )}

       {/* Tabela de Leitura */}
       <div className="bg-card rounded-2xl border border-border overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-muted">
                 <tr>
                   <th className="p-4 w-10">
                      <input type="checkbox" className="rounded accent-primary w-4 h-4 cursor-pointer" 
                             checked={pricings.length > 0 && selectedPricings.length === pricings.length} 
                             onChange={toggleAllPricings} />
                   </th>
                   <th className="p-4 font-bold text-xs uppercase text-muted-foreground w-1/4">Produto</th>
                   <th className="p-4 font-bold text-xs uppercase text-muted-foreground">Inf. Trib</th>
                   <th className="p-4 font-bold text-xs uppercase text-muted-foreground text-center">Precificação Base</th>
                   <th className="p-4 font-bold text-xs uppercase text-muted-foreground text-center">Ações Lógicas</th>
                 </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {pricings.length === 0 ? (
                  <tr><td colSpan={5} className="p-12 text-center text-muted-foreground">Nenhuma premissa configurada.</td></tr>
                ) : (
                  pricings.map((pricing: any) => (
                     <tr key={pricing.id} className="hover:bg-accent/20 cursor-pointer" onClick={(e) => {
                        if((e.target as HTMLElement).closest('.btn-acoes')) return;
                        togglePricingSelection(pricing.id);
                     }}>
                       <td className="p-4 text-center btn-acoes">
                         <input type="checkbox" className="rounded accent-primary w-4 h-4 cursor-pointer" 
                                checked={selectedPricings.includes(pricing.id)} 
                                onChange={() => togglePricingSelection(pricing.id)} />
                       </td>
                       <td className="p-4">
                         <p className="font-bold text-sm tracking-tight">{pricing.Product?.name}</p>
                         <p className="text-[10px] font-mono text-muted-foreground">SKU: {pricing.Product?.sku}</p>
                       </td>
                       <td className="p-4">
                         <span className="bg-primary/10 text-primary px-2 py-1 rounded text-[10px] uppercase font-bold tracking-widest">{pricing.TaxRule?.name}</span>
                       </td>
                       <td className="p-4 text-center">
                         <div className="flex flex-col items-center gap-1">
                            <span className="text-xs text-muted-foreground">Mg. <span className="font-bold text-green-600">{Number(pricing.desiredMargin)}%</span></span>
                            <span className="text-xs text-muted-foreground">Comissão. <span className="font-bold text-orange-600">{Number(pricing.commission)}%</span></span>
                         </div>
                       </td>
                       <td className="p-4 btn-acoes">
                         <div className="flex gap-2 justify-center">
                           <button title="Calcular Simulação Unitária" onClick={() => handleCalculateUnit(pricing.productId, pricing.taxRuleId)} className="p-2 text-primary bg-primary/10 hover:bg-primary hover:text-white rounded-lg transition-colors"><Calculator className="h-4 w-4" /></button>
                           <button title="Editar Parametria" onClick={() => { 
                             setFormData({
                              productId: pricing.productId, taxRuleId: pricing.taxRuleId,
                              desiredMargin: Number(pricing.desiredMargin), commission: Number(pricing.commission),
                              freightOut: Number(pricing.freightOut), otherVariables: Number(pricing.otherVariables),
                             });
                             setIsModalOpen(true);
                            }} className="p-2 text-muted-foreground hover:bg-accent hover:text-primary rounded-lg transition-colors"><Edit2 className="h-4 w-4" /></button>
                           <button title="Excluir Restrito" onClick={() => handleDeleteUnit(pricing)} className="p-2 text-muted-foreground hover:bg-red-50 hover:text-red-500 rounded-lg transition-colors"><Trash2 className="h-4 w-4" /></button>
                         </div>
                       </td>
                     </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
       </div>
     </div>
        </div>
      ) : (
        // --- VIEW: BATCH ---
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6" data-tour="pricing-batch-panel">
          <div className="lg:col-span-2 space-y-4">
            {/* Esquerda: Seleção de Produtos ou Resultados em tabela */}

            {!batchResults ? (
              // BATCH TABELA SELEÇÃO
              <div className="bg-card rounded-2xl border border-border overflow-hidden flex flex-col h-[600px] shadow-sm">
                <div className="p-4 border-b border-border bg-accent/20 flex gap-4 items-center">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <input
                      type="text" placeholder="Filtrar produtos por SKU ou nome..."
                      className="w-full pl-9 pr-3 py-2 rounded-lg bg-background border border-border text-sm outline-none focus:ring-2 focus:ring-primary/20"
                      value={searchTermBatch} onChange={(e) => setSearchTermBatch(e.target.value)}
                    />
                  </div>
                  <div className="text-xs font-medium text-muted-foreground whitespace-nowrap">
                    Selecionados: <span className="font-bold text-primary">{selectedProductIds.length}</span>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-muted sticky top-0 z-10 hidden sm:table-header-group">
                      <tr>
                        <th className="p-3 w-10 text-center">
                          <input 
                            type="checkbox" className="rounded accent-primary w-4 h-4"
                            checked={products.length > 0 && selectedProductIds.length === products.filter(p => p.name.toLowerCase().includes(searchTermBatch.toLowerCase()) || p.sku.toLowerCase().includes(searchTermBatch.toLowerCase())).length}
                            onChange={handleToggleSelectAll}
                          />
                        </th>
                        <th className="p-3 font-bold text-xs uppercase text-muted-foreground">SKU</th>
                        <th className="p-3 font-bold text-xs uppercase text-muted-foreground">Produto</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {products.filter(p => p.name.toLowerCase().includes(searchTermBatch.toLowerCase()) || p.sku.toLowerCase().includes(searchTermBatch.toLowerCase())).map(p => (
                        <tr key={p.id} className="hover:bg-accent/20 cursor-pointer" onClick={() => {
                          setSelectedProductIds(prev => prev.includes(p.id) ? prev.filter(id => id !== p.id) : [...prev, p.id] )
                        }}>
                          <td className="p-3 text-center">
                            <input 
                              type="checkbox" className="rounded accent-primary w-4 h-4 pointer-events-none"
                              checked={selectedProductIds.includes(p.id)} readOnly
                            />
                          </td>
                          <td className="p-3 font-mono text-[10px] sm:text-xs text-muted-foreground">{p.sku}</td>
                          <td className="p-3 font-bold text-xs sm:text-sm">{p.name}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              // BATCH TABELA RESULTADOS DA SIMULAÇÃO
              <div className="bg-card rounded-2xl border border-border overflow-hidden flex flex-col h-[600px] shadow-sm">
                <div className="p-4 border-b border-border bg-primary text-primary-foreground flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5" />
                    <h3 className="font-bold">Resultados da Simulação</h3>
                  </div>
                  <button 
                    onClick={() => setBatchResults(null)}
                    className="text-xs bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded-lg font-medium transition-colors"
                  >
                    Voltar / Refazer
                  </button>
                </div>
                
                <div className="flex-1 overflow-y-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-muted sticky top-0 z-10 hidden sm:table-header-group">
                      <tr>
                        <th className="p-3 font-bold text-[10px] uppercase text-muted-foreground">Status / SKU</th>
                        <th className="p-3 font-bold text-[10px] uppercase text-muted-foreground">Custo Ind.</th>
                        <th className="p-3 font-bold text-[10px] uppercase text-right text-muted-foreground">Preço Sugerido</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {batchResults.map((r, idx) => (
                        <tr key={idx} className={r.status === "ERROR" ? "bg-red-50/50" : "bg-green-50/30"}>
                          <td className="p-3">
                            {r.status === "SUCCESS" ? (
                              <div className="flex items-center gap-2 text-green-600">
                                <CheckCircle2 className="h-4 w-4" />
                                <div>
                                  <p className="font-bold text-xs text-foreground">{r.name}</p>
                                  <p className="text-[10px] opacity-80">{r.sku}</p>
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2 text-red-600">
                                <AlertCircle className="h-4 w-4" />
                                <div>
                                  <p className="font-bold text-xs text-red-800">{r.name || r.productId}</p>
                                  <p className="text-[10px] leading-tight">Erro: {r.message}</p>
                                </div>
                              </div>
                            )}
                          </td>
                          <td className="p-3 font-medium text-xs">
                            {r.status === "SUCCESS" ? formatCurrency(r.ciu, 5) : "-"}
                          </td>
                          <td className="p-3 font-black text-primary text-right text-base">
                            {r.status === "SUCCESS" ? formatCurrency(r.suggestedPrice, 5) : "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="p-4 border-t border-border bg-accent/10 flex justify-end">
                   <button 
                    onClick={handleApplyBatch}
                    className="bg-primary text-primary-foreground px-6 py-2.5 rounded-xl font-bold flex items-center gap-2 hover:opacity-90"
                   >
                     Gravar Lote Oficialmente
                   </button>
                </div>
              </div>
            )}
          </div>

          {/* Direita: Painel de Definições em Lote */}
          <div className="col-span-1 space-y-4">
             <div className="bg-card rounded-2xl border border-border p-6 shadow-sm flex flex-col gap-5 sticky top-6">
                <div className="border-b border-border pb-4">
                  <h3 className="font-bold text-lg flex items-center gap-2">
                    <Calculator className="h-5 w-5 text-primary" /> Parâmetros em Lote
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    Esses parâmetros serão injetados simultaneamente.
                  </p>
                </div>

                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-1">Canal Fiscal</label>
                    <SearchableSelect
                      placeholder="Selecione a Regra..."
                      options={taxRules.map((r: { id: string; name: string; description?: string }) => ({
                        value: r.id,
                        label: r.name,
                        sublabel: r.description?.trim() || undefined,
                        searchTerms: [r.name, r.description].filter(Boolean).join(" "),
                      }))}
                      value={batchFormData.taxRuleId}
                      onChange={(val) => setBatchFormData({...batchFormData, taxRuleId: val})}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-muted-foreground uppercase flex items-center gap-1">Margem Líquida %</label>
                      <input
                        type="number" 
                        step="0.00001"
                        className="w-full p-2.5 text-sm rounded-xl border border-border bg-background outline-none"
                        value={batchFormData.desiredMargin} onChange={(e) => setBatchFormData({...batchFormData, desiredMargin: parseFloat(e.target.value)})}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-muted-foreground uppercase flex items-center gap-1">Comissão %</label>
                      <input
                        type="number" 
                        step="0.00001"
                        className="w-full p-2.5 text-sm rounded-xl border border-border bg-background outline-none"
                        value={batchFormData.commission} onChange={(e) => setBatchFormData({...batchFormData, commission: parseFloat(e.target.value)})}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-muted-foreground uppercase flex items-center gap-1">Frete Fixo (R$)</label>
                      <input
                        type="number" 
                        step="0.00001"
                        className="w-full p-2.5 text-sm rounded-xl border border-border bg-background outline-none"
                        value={batchFormData.freightOut} onChange={(e) => setBatchFormData({...batchFormData, freightOut: parseFloat(e.target.value)})}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-muted-foreground uppercase flex items-center gap-1">Outros Var %</label>
                      <input
                        type="number" 
                        step="0.00001"
                        className="w-full p-2.5 text-sm rounded-xl border border-border bg-background outline-none"
                        value={batchFormData.otherVariables} onChange={(e) => setBatchFormData({...batchFormData, otherVariables: parseFloat(e.target.value)})}
                      />
                    </div>
                  </div>
                </div>

                {!batchResults && (
                  <button 
                    onClick={handleSimulateBatch}
                    disabled={simulatingBatch}
                    className="w-full mt-2 py-3 rounded-xl font-bold bg-primary text-primary-foreground hover:bg-primary/90 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {simulatingBatch ? <Loader2 className="h-5 w-5 animate-spin" /> : <Play className="h-5 w-5 fill-current" />} 
                    Simular {selectedProductIds.length > 0 ? selectedProductIds.length : ''} Itens
                  </button>
                )}
             </div>
          </div>
        </div>
      )}

      {/* Modal Result Unitario - MANTIDO INTACTO DA ARQUITETURA ORIGINAL */}
      <AnimatePresence>
        {calculationResult && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
             <motion.div 
               initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
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

                <div className="px-4 pt-3 border-b border-border bg-gradient-to-b from-accent/40 to-accent/10">
                  <div className="flex items-end gap-1 overflow-x-auto -mb-px">
                    {[
                      { id: "summary" as const, label: "Resumo da Formação", icon: BarChart3 },
                      { id: "composition" as const, label: "Composição do Preço", icon: BookOpen },
                    ].map((tab) => {
                      const isActive = resultTab === tab.id;
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          role="tab"
                          aria-selected={isActive}
                          onClick={() => setResultTab(tab.id)}
                          className={cn(
                            "inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-t-lg border border-transparent border-b-0 whitespace-nowrap transition-all",
                            isActive
                              ? "bg-card border-border text-foreground -mb-px"
                              : "text-muted-foreground hover:text-foreground hover:bg-background/80"
                          )}
                        >
                          <tab.icon className={cn("h-3.5 w-3.5", isActive ? "text-primary" : "opacity-80")} />
                          {tab.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                
                <div className="flex-1 overflow-y-auto p-8 space-y-8">
                  {resultTab === "summary" && (
                    <>
                      <div className="relative p-8 rounded-3xl bg-primary/5 border-2 border-primary/20 flex flex-col items-center text-center overflow-hidden">
                     <div className="absolute top-4 right-4 bg-primary text-primary-foreground px-3 py-1 rounded-full text-[10px] font-black uppercase">
                       Preço Sugerido
                     </div>
                     <p className="text-5xl font-black text-primary mb-2">
                       {formatCurrency(calculationResult.resultados.suggestedPrice, 5)}
                     </p>
                     <div className="flex items-center gap-4 text-sm font-bold text-muted-foreground">
                       <span className="flex items-center gap-1">
                         <TrendingUp className="h-4 w-4 text-green-500" /> Markup: {formatNumber(calculationResult.resultados.markup)}x
                       </span>
                       <span className="h-4 w-px bg-border" />
                       <span className="flex items-center gap-1">
                         <ShieldCheck className="h-4 w-4 text-blue-500" /> Margem: {formatNumber(calculationResult.premissas.marginRate, 2)}%
                       </span>
                     </div>
                   </div>

                   <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                     <div className="space-y-4">
                       <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                         <BarChart3 className="h-3 w-3" /> Estrutura de Custos
                       </h4>
                       <div className="space-y-3">
                         <div className="flex items-center justify-between p-3 rounded-xl bg-accent/20 border border-border">
                           <span className="text-xs font-medium">Custo Industrial (CIU)</span>
                           <span className="text-sm font-bold">{formatCurrency(calculationResult.ciu, 5)}</span>
                         </div>
                         <div className="flex items-center justify-between p-3 rounded-xl bg-accent/20 border border-border">
                           <span className="text-xs font-medium">Custo Fabril Completo</span>
                           <span className="text-sm font-bold">{formatCurrency(calculationResult.custoFabril, 5)}</span>
                         </div>
                         <div className="flex items-center justify-between p-3 rounded-xl bg-accent/20 border border-border">
                           <span className="text-xs font-medium">Custo Gerencial Total</span>
                           <span className="text-sm font-bold">{formatCurrency(calculationResult.custoGerencial, 5)}</span>
                         </div>
                       </div>
                     </div>

                     <div className="space-y-4">
                       <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                         <TrendingDown className="h-3 w-3" /> Deduções sobre Venda
                       </h4>
                       <div className="space-y-3">
                         <div className="flex items-center justify-between p-3 rounded-xl bg-red-50 border border-red-100 text-red-700">
                           <span className="text-xs font-medium">Impostos ({calculationResult.premissas.taxRate}%)</span>
                           <span className="text-sm font-bold">-{formatCurrency(calculationResult.resultados.totalTaxes, 5)}</span>
                         </div>
                         <div className="flex items-center justify-between p-3 rounded-xl bg-red-50 border border-red-100 text-red-700">
                           <span className="text-xs font-medium">Comissão ({calculationResult.premissas.commRate}%)</span>
                           <span className="text-sm font-bold">-{formatCurrency(calculationResult.resultados.totalCommission, 5)}</span>
                         </div>
                         <div className="flex items-center justify-between p-3 rounded-xl bg-red-50 border border-red-100 text-red-700">
                           <span className="text-xs font-medium">Frete Saída</span>
                           <span className="text-sm font-bold">-{formatCurrency(calculationResult.premissas.freight, 5)}</span>
                         </div>
                       </div>
                     </div>
                   </div>

                      <div className="p-6 rounded-2xl bg-accent/30 border border-border space-y-4">
                     <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Rentabilidade</h4>
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                       <div className="p-4 rounded-xl bg-white border border-border">
                         <p className="text-[10px] font-bold text-muted-foreground uppercase mb-1">M. Contribuição</p>
                         <p className="text-xl font-black text-primary">{formatCurrency(calculationResult.resultados.contributionMargin, 5)}</p>
                       </div>
                       <div className="p-4 rounded-xl bg-white border border-border">
                         <p className="text-[10px] font-bold text-muted-foreground uppercase mb-1">M. Operacional</p>
                         <p className="text-xl font-black text-green-600">{formatCurrency(calculationResult.resultados.operationalMargin, 5)}</p>
                       </div>
                     </div>
                      </div>
                    </>
                  )}

                  {resultTab === "composition" && (
                    <PricingOpenBookTab
                      openBook={(calculationResult.openBook as PricingOpenBookPayload | undefined) ?? null}
                      premissas={{
                        taxRate: Number(calculationResult.premissas?.taxRate ?? 0),
                        commRate: Number(calculationResult.premissas?.commRate ?? 0),
                        marginRate: Number(calculationResult.premissas?.marginRate ?? 0),
                        freight: Number(calculationResult.premissas?.freight ?? 0),
                      }}
                    />
                  )}
                </div>
             </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal Criar Unitario */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
             <motion.div 
               initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
               className="bg-card w-full max-w-lg rounded-2xl border border-border shadow-2xl overflow-hidden"
             >
                <div className="p-6 border-b border-border flex items-center justify-between bg-accent/30">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                      <Calculator className="h-6 w-6" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold">Premissas Comerciais (Unitária)</h3>
                      <p className="text-xs text-muted-foreground">Criação individual de premissa para 1 produto.</p>
                    </div>
                  </div>
                  <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-accent rounded-full transition-colors"><X className="h-5 w-5" /></button>
                </div>
                
                <form onSubmit={handleSubmitUnit} className="p-6 space-y-5">
                   <div className="space-y-1.5">
                     <label className="text-xs font-bold text-muted-foreground uppercase">Produto Alvo</label>
                     <SearchableSelect
                       placeholder="Selecione o produto..."
                       options={products.map((p: { id: string; sku: string; name: string; type?: string }) => ({
                         value: p.id,
                         label: `${p.sku} — ${p.name}`,
                         sublabel: p.type === "COMPONENT" ? "Componente" : "Produto",
                         searchTerms: `${p.sku} ${p.name}`,
                       }))}
                       value={formData.productId}
                       onChange={(val) => setFormData({...formData, productId: val})}
                     />
                   </div>
                   <div className="space-y-1.5">
                     <label className="text-xs font-bold text-muted-foreground uppercase">Regra Fiscal</label>
                     <SearchableSelect
                       placeholder="Selecione a regra..."
                       options={taxRules.map((r: { id: string; name: string; description?: string }) => ({
                         value: r.id,
                         label: r.name,
                         sublabel: r.description?.trim() || undefined,
                         searchTerms: [r.name, r.description].filter(Boolean).join(" "),
                       }))}
                       value={formData.taxRuleId}
                       onChange={(val) => setFormData({...formData, taxRuleId: val})}
                     />
                   </div>
                   <div className="grid grid-cols-2 gap-4">
                     <div className="space-y-1.5">
                       <label className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-1"><Percent className="h-3 w-3" /> Margem Liq %</label>
                       <input required type="number" step="0.00001" className="w-full p-3 rounded-xl border border-border" value={formData.desiredMargin} onChange={(e) => setFormData({...formData, desiredMargin: parseFloat(e.target.value)})} />
                     </div>
                     <div className="space-y-1.5">
                       <label className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-1"><Users className="h-3 w-3" /> Comissão %</label>
                       <input required type="number" step="0.00001" className="w-full p-3 rounded-xl border border-border" value={formData.commission} onChange={(e) => setFormData({...formData, commission: parseFloat(e.target.value)})} />
                     </div>
                   </div>
                   <div className="grid grid-cols-2 gap-4">
                     <div className="space-y-1.5">
                       <label className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-1"><Truck className="h-3 w-3" /> Frete Fixo R$</label>
                       <input required type="number" step="0.00001" className="w-full p-3 rounded-xl border border-border" value={formData.freightOut} onChange={(e) => setFormData({...formData, freightOut: parseFloat(e.target.value)})} />
                     </div>
                     <div className="space-y-1.5">
                       <label className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-1"><Percent className="h-3 w-3" /> Outros Var %</label>
                       <input required type="number" step="0.00001" className="w-full p-3 rounded-xl border border-border" value={formData.otherVariables} onChange={(e) => setFormData({...formData, otherVariables: parseFloat(e.target.value)})} />
                     </div>
                   </div>
                   <div className="pt-4 flex gap-3">
                     <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 py-3 rounded-xl font-bold bg-accent hover:opacity-80">Cancelar</button>
                     <button type="submit" className="flex-1 py-3 rounded-xl font-bold bg-primary text-primary-foreground hover:opacity-90">Salvar Premissa</button>
                   </div>
                </form>
             </motion.div>
          </div>
        )}
      </AnimatePresence>

      <GuidedTour
        open={tourOpen}
        onClose={() => setTourOpen(false)}
        steps={PRICING_TOUR_STEPS}
        tourName="Tour de Precificação"
      />
    </div>
  );
};
