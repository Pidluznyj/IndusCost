import React, { useEffect, useState } from "react";
import { 
  Plus, 
  Search, 
  Edit2, 
  Trash2, 
  X,
  Loader2,
  Scale,
  FileText,
  Percent,
  Save,
  AlertCircle,
  ShieldCheck,
  Globe,
  MapPin
} from "lucide-react";
import { cn, formatNumber } from "@/src/lib/utils";
import { fetchJsonOk } from "@/src/lib/http";
import { motion, AnimatePresence } from "motion/react";
import { SearchableSelect } from "./shared/SearchableSelect";
import { GuidedTour } from "@/src/components/tour/GuidedTour";
import { TourHelpButton } from "@/src/components/tour/TourHelpButton";
import { TAX_TOUR_STEPS } from "@/src/tours/taxTourSteps";
import { FiscalSettlementsPanel } from "@/src/components/finance/FiscalSettlementsPanel";
import { useAuth } from "@/src/contexts/AuthContext";
import { canViewFiscalSettlements } from "@/src/lib/finance/fiscalSettlementPermissions";

const TAX_OPERATION_OPTIONS = [
  { value: "VENDA", label: "Venda", searchTerms: "VENDA venda" },
  { value: "COMPRA", label: "Compra", searchTerms: "COMPRA compra" },
  { value: "TRANSFERENCIA", label: "Transferência", searchTerms: "TRANSFERENCIA transferencia transferência" },
];

const TAX_BASE_TYPE_OPTIONS = [
  { value: "GROSS_PRICE", label: "Preço Bruto", searchTerms: "GROSS bruto" },
  { value: "NET_PRICE", label: "Preço Líquido", searchTerms: "NET líquido liquido" },
];

interface TaxComponent {
  id?: string;
  name: string;
  percentage: number;
  isRecoverable: boolean;
  baseType: string;
}

interface TaxRule {
  id: string;
  name: string;
  description?: string;
  operation: string;
  status: string;
  TaxComponent: TaxComponent[];
}

export const TaxModule = () => {
  const auth = useAuth();
  const canSettlements = canViewFiscalSettlements(auth);
  const [moduleTab, setModuleTab] = useState<"pricing" | "settlements">("settlements");
  const [rules, setRules] = useState<TaxRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<TaxRule | null>(null);
  const [tourOpen, setTourOpen] = useState(false);

  const [formData, setFormData] = useState({
    name: "",
    description: "",
    operation: "VENDA",
    components: [] as TaxComponent[],
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const data = await fetchJsonOk<TaxRule[]>("/api/tax-rules");
      setRules(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Erro ao buscar regras tributárias:", error);
      alert(error instanceof Error ? error.message : "Não foi possível carregar regras tributárias.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (moduleTab === "pricing") fetchData();
  }, [moduleTab]);

  // default: settlements if permitted, else pricing
  useEffect(() => {
    if (!canSettlements) setModuleTab("pricing");
  }, [canSettlements]);

  const handleOpenModal = (rule?: TaxRule) => {
    if (rule) {
      setEditingRule(rule);
      setFormData({
        name: rule.name,
        description: rule.description || "",
        operation: rule.operation,
        components: rule.TaxComponent.map(c => ({ ...c, percentage: Number(c.percentage) })),
      });
    } else {
      setEditingRule(null);
      setFormData({
        name: "",
        description: "",
        operation: "VENDA",
        components: [
          { name: "ICMS", percentage: 18, isRecoverable: false, baseType: "GROSS_PRICE" },
          { name: "PIS", percentage: 1.65, isRecoverable: false, baseType: "GROSS_PRICE" },
          { name: "COFINS", percentage: 7.6, isRecoverable: false, baseType: "GROSS_PRICE" },
        ],
      });
    }
    setIsModalOpen(true);
  };

  const addComponent = () => {
    setFormData({
      ...formData,
      components: [...formData.components, { name: "", percentage: 0, isRecoverable: false, baseType: "GROSS_PRICE" }]
    });
  };

  const removeComponent = (index: number) => {
    const newComponents = [...formData.components];
    newComponents.splice(index, 1);
    setFormData({ ...formData, components: newComponents });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const method = editingRule ? "PUT" : "POST";
    const url = editingRule ? `/api/tax-rules/${editingRule.id}` : "/api/tax-rules";

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
      alert(error instanceof Error ? error.message : "Não foi possível salvar a regra tributária.");
    }
  };

  return (
    <div className="space-y-6" data-tour="tax-rules-root" data-testid="tax-module">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wide text-[#1e3a8a]">
          Financeiro · Tributos
        </p>
        <h1 className="text-lg font-bold text-[#0f172a]">Tributos</h1>
        <p className="text-[12px] text-[#6B7280]">
          Separe precificação comercial de apuração e recolhimento documental.
        </p>
      </div>

      <nav
        className="flex flex-wrap gap-1 border-b border-border pb-2"
        role="tablist"
        data-testid="tax-module-tabs"
      >
        {canSettlements ? (
          <button
            type="button"
            role="tab"
            aria-selected={moduleTab === "settlements"}
            className={cn(
              "rounded-md px-3 py-1.5 text-[12px] font-semibold",
              moduleTab === "settlements"
                ? "bg-white text-[#111827] shadow-sm ring-1 ring-[#E5E7EB]"
                : "text-[#4B5563] hover:bg-[#F3F4F6]"
            )}
            onClick={() => setModuleTab("settlements")}
            data-testid="tax-module-tab-settlements"
          >
            Apuração e guias
          </button>
        ) : null}
        <button
          type="button"
          role="tab"
          aria-selected={moduleTab === "pricing"}
          className={cn(
            "rounded-md px-3 py-1.5 text-[12px] font-semibold",
            moduleTab === "pricing"
              ? "bg-white text-[#111827] shadow-sm ring-1 ring-[#E5E7EB]"
              : "text-[#4B5563] hover:bg-[#F3F4F6]"
          )}
          onClick={() => setModuleTab("pricing")}
          data-testid="tax-module-tab-pricing"
        >
          Regras de precificação
        </button>
      </nav>

      {moduleTab === "settlements" && canSettlements ? (
        <FiscalSettlementsPanel />
      ) : (
        <>
      {/* Header Actions */}
      <div
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-4"
        data-tour="tax-rules-toolbar"
      >
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Buscar regra tributária..."
            className="w-full pl-10 pr-4 py-2 rounded-lg border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <TourHelpButton onClick={() => setTourOpen(true)} />
          <button
            onClick={() => handleOpenModal()}
            className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg font-medium hover:opacity-90 transition-opacity text-sm"
          >
            <Plus className="h-4 w-4" />
            Nova Regra Fiscal
          </button>
        </div>
      </div>

      {/* Rules Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6" data-tour="tax-rules-grid">
        {loading ? (
          <div className="col-span-full p-12 text-center">
            <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
          </div>
        ) : rules.length === 0 ? (
          <div className="col-span-full p-12 text-center border-2 border-dashed border-border rounded-2xl text-muted-foreground">
            Nenhuma regra tributária cadastrada.
          </div>
        ) : (
          rules.filter(r => r.name.toLowerCase().includes(searchTerm.toLowerCase())).map((rule) => {
            const totalTax = rule.TaxComponent.reduce((acc, c) => acc + Number(c.percentage), 0);
            return (
              <motion.div 
                key={rule.id}
                className="bg-card rounded-2xl border border-border overflow-hidden shadow-sm hover:shadow-md transition-all group"
              >
                <div className="p-5 border-b border-border bg-accent/30 flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                      {rule.name.includes("Export") ? <Globe className="h-6 w-6" /> : <MapPin className="h-6 w-6" />}
                    </div>
                    <div>
                      <h3 className="font-bold text-sm">{rule.name}</h3>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{rule.operation}</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => handleOpenModal(rule)}
                    className="p-2 rounded-lg hover:bg-background text-muted-foreground hover:text-primary transition-colors"
                  >
                    <Edit2 className="h-4 w-4" />
                  </button>
                </div>
                
                <div className="p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Carga Tributária Total</span>
                    <span className="text-lg font-black text-primary">{formatNumber(totalTax, 2)}%</span>
                  </div>

                  <div className="space-y-2">
                    {rule.TaxComponent.map((comp, idx) => (
                      <div key={idx} className="flex items-center justify-between text-[10px] font-medium p-2 rounded-lg bg-accent/20">
                        <span className="text-muted-foreground">{comp.name}</span>
                        <span className="font-bold">{formatNumber(Number(comp.percentage), 2)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
            );
          })
        )}
      </div>

      {/* Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-card w-full max-w-2xl rounded-2xl border border-border shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-6 border-b border-border flex items-center justify-between bg-accent/30">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                    <Scale className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold">{editingRule ? "Editar Regra Fiscal" : "Nova Regra Tributária"}</h3>
                    <p className="text-xs text-muted-foreground">Defina os impostos incidentes sobre o faturamento.</p>
                  </div>
                </div>
                <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-accent rounded-full transition-colors">
                  <X className="h-5 w-5" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase">Nome da Regra</label>
                    <input
                      required
                      type="text"
                      className="w-full p-3 rounded-xl border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none"
                      value={formData.name}
                      onChange={(e) => setFormData({...formData, name: e.target.value})}
                      placeholder="Ex: Venda Consumidor Final SP"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase">Tipo de Operação</label>
                    <SearchableSelect
                      placeholder="Tipo de operação..."
                      options={TAX_OPERATION_OPTIONS}
                      value={formData.operation}
                      onChange={(v) => setFormData({ ...formData, operation: v })}
                    />
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between border-b border-border pb-2">
                    <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-2">
                      <Percent className="h-3 w-3" /> Composição de Impostos
                    </h4>
                    <button 
                      type="button"
                      onClick={addComponent}
                      className="text-[10px] font-bold text-primary hover:underline flex items-center gap-1"
                    >
                      <Plus className="h-3 w-3" /> Adicionar Imposto
                    </button>
                  </div>

                  <div className="space-y-3">
                    {formData.components.map((comp, idx) => (
                      <div key={idx} className="grid grid-cols-12 gap-3 p-3 rounded-xl border border-border bg-accent/5 items-end">
                        <div className="col-span-5 space-y-1.5">
                          <label className="text-[10px] font-bold text-muted-foreground uppercase">Imposto</label>
                          <input
                            required
                            type="text"
                            className="w-full p-2 rounded-lg border border-border bg-background text-xs outline-none"
                            value={comp.name}
                            onChange={(e) => {
                              const newComps = [...formData.components];
                              newComps[idx].name = e.target.value;
                              setFormData({ ...formData, components: newComps });
                            }}
                            placeholder="PIS, COFINS..."
                          />
                        </div>
                        <div className="col-span-3 space-y-1.5">
                          <label className="text-[10px] font-bold text-muted-foreground uppercase">Alíquota (%)</label>
                          <input
                            required
                            type="number"
                            step="0.00001"
                            className="w-full p-2 rounded-lg border border-border bg-background text-xs outline-none"
                            value={comp.percentage}
                            onChange={(e) => {
                              const newComps = [...formData.components];
                              newComps[idx].percentage = parseFloat(e.target.value);
                              setFormData({ ...formData, components: newComps });
                            }}
                          />
                        </div>
                        <div className="col-span-3 space-y-1.5">
                          <label className="text-[10px] font-bold text-muted-foreground uppercase">Base de Cálculo</label>
                          <SearchableSelect
                            placeholder="Base..."
                            className="text-[10px]"
                            options={TAX_BASE_TYPE_OPTIONS}
                            value={comp.baseType}
                            onChange={(v) => {
                              const newComps = [...formData.components];
                              newComps[idx].baseType = v;
                              setFormData({ ...formData, components: newComps });
                            }}
                          />
                        </div>
                        <div className="col-span-1 flex justify-end">
                          <button 
                            type="button"
                            onClick={() => removeComponent(idx)}
                            className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-primary/5 border border-primary/20 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <ShieldCheck className="h-5 w-5 text-primary" />
                    <span className="text-xs font-bold text-primary uppercase">Carga Tributária Consolidada</span>
                  </div>
                  <span className="text-xl font-black text-primary">
                    {formatNumber(formData.components.reduce((acc, c) => acc + c.percentage, 0), 2)}%
                  </span>
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
                    Salvar Regra
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
        steps={TAX_TOUR_STEPS}
        tourName="Tour de Regras Fiscais"
      />
        </>
      )}
    </div>
  );
};
