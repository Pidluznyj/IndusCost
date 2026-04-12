import React, { useEffect, useState } from "react";
import { 
  Settings, 
  Plus, 
  Search, 
  Edit2, 
  Trash2, 
  X,
  Loader2,
  Briefcase,
  CreditCard,
  Save,
  AlertCircle,
  CheckCircle2
} from "lucide-react";
import { cn, formatCurrency, formatNumber } from "@/src/lib/utils";
import { fetchJsonOk, fetchOk } from "@/src/lib/http";
import { motion, AnimatePresence } from "motion/react";
import { SearchableSelect } from "./shared/SearchableSelect";
import { GuidedTour } from "@/src/components/tour/GuidedTour";
import { TourHelpButton } from "@/src/components/tour/TourHelpButton";
import { SETTINGS_TOUR_STEPS } from "@/src/tours/settingsTourSteps";

const PAYROLL_COMPONENT_TYPE_OPTIONS = [
  { value: "BENEFIT", label: "Benefício", searchTerms: "BENEFIT benefício beneficio" },
  { value: "CHARGE", label: "Encargo", searchTerms: "CHARGE encargo" },
  { value: "PROVISION", label: "Provisão", searchTerms: "PROVISION provisão provisao" },
];

const PAYROLL_COMPONENT_CALC_OPTIONS = [
  { value: "PERCENTAGE", label: "Porcentagem (%)", searchTerms: "PERCENTAGE percentual" },
  { value: "FIXED", label: "Valor Fixo (R$)", searchTerms: "FIXED fixo" },
];

interface Role {
  id: string;
  name: string;
  baseSalary: number;
  monthlyHours: number;
}

interface PayrollComponent {
  id: string;
  name: string;
  type: "BENEFIT" | "CHARGE" | "PROVISION";
  calculationType: "PERCENTAGE" | "FIXED";
  value: number;
}

export const SettingsModule = () => {
  const [tourOpen, setTourOpen] = useState(false);
  const [roles, setRoles] = useState<Role[]>([]);
  const [components, setComponents] = useState<PayrollComponent[]>([]);
  const [globals, setGlobals] = useState<{
    energyCost: number, 
    workingHours: number, 
    factoryHours: number, 
    hhOverride: number | null,
    calculatedHh: number,
    hhSource: "AUTO" | "MANUAL",
    energyId?: string, 
    hoursId?: string, 
    factoryId?: string,
    hhOverrideId?: string
  }>({
    energyCost: 0, 
    workingHours: 176, 
    factoryHours: 8448, 
    hhOverride: null, 
    calculatedHh: 0, 
    hhSource: "AUTO"
  });
  const [loading, setLoading] = useState(true);
  const [activeSubTab, setActiveSubTab] = useState<"roles" | "payroll" | "globals">("roles");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<any>(null);

  const [roleForm, setRoleForm] = useState({
    name: "",
    baseSalary: 0,
    monthlyHours: 220,
  });

  const [componentForm, setComponentForm] = useState({
    name: "",
    type: "BENEFIT" as const,
    calculationType: "PERCENTAGE" as const,
    value: 0,
  });

  const [globalForm, setGlobalForm] = useState({
    energyCost: 0,
    workingHours: 176,
    factoryHours: 8448,
    hhOverride: "" as string | number
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const [rolesData, componentsData, config] = await Promise.all([
        fetchJsonOk<Role[]>("/api/roles"),
        fetchJsonOk<PayrollComponent[]>("/api/payroll-components"),
        fetchJsonOk<{
          values: {
            energyCost: number;
            workingHours: number;
            factoryHours: number;
            hhOverride: number | null;
          };
          calculated: { hhAuto: number; hhSource: "AUTO" | "MANUAL" };
          ids: {
            energyId?: string;
            hoursId?: string;
            factoryId?: string;
            hhOverrideId?: string;
          };
        }>("/api/settings/globals"),
      ]);
      setRoles(Array.isArray(rolesData) ? rolesData : []);
      setComponents(Array.isArray(componentsData) ? componentsData : []);
      
      setGlobals({
        energyCost: config.values.energyCost,
        workingHours: config.values.workingHours,
        factoryHours: config.values.factoryHours,
        hhOverride: config.values.hhOverride,
        calculatedHh: config.calculated.hhAuto,
        hhSource: config.calculated.hhSource,
        energyId: config.ids.energyId,
        hoursId: config.ids.hoursId,
        factoryId: config.ids.factoryId,
        hhOverrideId: config.ids.hhOverrideId
      });
      setGlobalForm({
        energyCost: config.values.energyCost,
        workingHours: config.values.workingHours,
        factoryHours: config.values.factoryHours,
        hhOverride: config.values.hhOverride ?? "",
      });
    } catch (error) {
      console.error("Erro ao buscar configurações:", error);
      alert(error instanceof Error ? error.message : "Não foi possível carregar configurações.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleOpenModal = (item?: any) => {
    if (item) {
      setEditingItem(item);
      if (activeSubTab === "roles") {
        setRoleForm({
          name: item.name,
          baseSalary: Number(item.baseSalary),
          monthlyHours: item.monthlyHours,
        });
      } else {
        setComponentForm({
          name: item.name,
          type: item.type,
          calculationType: item.calculationType,
          value: Number(item.value),
        });
      }
    } else {
      setEditingItem(null);
      setRoleForm({ name: "", baseSalary: 0, monthlyHours: 220 });
      setComponentForm({ name: "", type: "BENEFIT", calculationType: "PERCENTAGE", value: 0 });
    }
    setIsModalOpen(true);
  };

  const handleSaveGlobals = async () => {
    try {
      // Save Energy Cost
      const energyMethod = globals.energyId ? "PUT" : "POST";
      const energyUrl = globals.energyId ? `/api/indirect-costs/${globals.energyId}` : "/api/indirect-costs";
      await fetchOk(energyUrl, {
        method: energyMethod,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: "ENERGY_COST",
          category: "GLOBAL_PARAM",
          monthlyValue: globalForm.energyCost,
          costCenter: "Geral",
          allocationCriteria: "Geral",
          status: "ACTIVE"
        }),
      });

      // Save Working Hours
      const hoursMethod = globals.hoursId ? "PUT" : "POST";
      const hoursUrl = globals.hoursId ? `/api/indirect-costs/${globals.hoursId}` : "/api/indirect-costs";
      await fetchOk(hoursUrl, {
        method: hoursMethod,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: "WORKING_HOURS",
          category: "GLOBAL_PARAM",
          monthlyValue: globalForm.workingHours,
          costCenter: "Geral",
          allocationCriteria: "Geral",
          status: "ACTIVE"
        }),
      });

      // Save Factory Hours
      const factoryMethod = globals.factoryId ? "PUT" : "POST";
      const factoryUrl = globals.factoryId ? `/api/indirect-costs/${globals.factoryId}` : "/api/indirect-costs";
      await fetchOk(factoryUrl, {
        method: factoryMethod,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: "FACTORY_HOURS_MONTHLY",
          category: "GLOBAL_PARAM",
          monthlyValue: globalForm.factoryHours,
          costCenter: "Geral",
          allocationCriteria: "Geral",
          status: "ACTIVE"
        }),
      });

      // Save HH Override
      const hhVal = globalForm.hhOverride === "" ? 0 : Number(globalForm.hhOverride);
      const hhMethod = globals.hhOverrideId ? "PUT" : "POST";
      const hhUrl = globals.hhOverrideId ? `/api/indirect-costs/${globals.hhOverrideId}` : "/api/indirect-costs";
      await fetchOk(hhUrl, {
        method: hhMethod, 
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: "HH_VALUE_OVERRIDE",
          category: "GLOBAL_PARAM",
          monthlyValue: hhVal,
          costCenter: "Geral",
          allocationCriteria: "Override",
          status: "ACTIVE"
        }),
      });

      fetchData();
    } catch (error) {
      console.error("Erro ao salvar parâmetros globais:", error);
      alert(error instanceof Error ? error.message : "Não foi possível salvar parâmetros globais.");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const endpoint = activeSubTab === "roles" ? "/api/roles" : "/api/payroll-components";
    const method = editingItem ? "PUT" : "POST";
    const url = editingItem ? `${endpoint}/${editingItem.id}` : endpoint;
    const body = activeSubTab === "roles" ? roleForm : componentForm;

    try {
      await fetchJsonOk(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setIsModalOpen(false);
      fetchData();
    } catch (error) {
      console.error("Erro ao salvar:", error);
      alert(error instanceof Error ? error.message : "Não foi possível salvar.");
    }
  };

  return (
    <div className="space-y-6" data-tour="settings-root">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4" data-tour="settings-toolbar">
        <div
          className="flex items-center gap-4 border-b border-border w-full sm:w-auto"
          data-tour="settings-subtabs"
        >
          <button
            onClick={() => setActiveSubTab("roles")}
            className={cn(
              "px-4 py-2 text-sm font-bold transition-all relative",
              activeSubTab === "roles" ? "text-primary" : "text-muted-foreground hover:text-foreground"
            )}
          >
            Cargos e Salários
            {activeSubTab === "roles" && <motion.div layoutId="subtab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
          </button>
          <button
            onClick={() => setActiveSubTab("payroll")}
            className={cn(
              "px-4 py-2 text-sm font-bold transition-all relative",
              activeSubTab === "payroll" ? "text-primary" : "text-muted-foreground hover:text-foreground"
            )}
          >
            Encargos e Benefícios
            {activeSubTab === "payroll" && <motion.div layoutId="subtab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
          </button>
          <button
            onClick={() => setActiveSubTab("globals")}
            className={cn(
              "px-4 py-2 text-sm font-bold transition-all relative",
              activeSubTab === "globals" ? "text-primary" : "text-muted-foreground hover:text-foreground"
            )}
          >
            Parâmetros Globais
            {activeSubTab === "globals" && <motion.div layoutId="subtab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
          </button>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <TourHelpButton onClick={() => setTourOpen(true)} />
          {activeSubTab !== "globals" && (
            <button
              onClick={() => handleOpenModal()}
              className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg font-medium hover:opacity-90 transition-opacity text-sm"
            >
              <Plus className="h-4 w-4" />
              {activeSubTab === "roles" ? "Novo Cargo" : "Novo Componente"}
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="p-12 text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6" data-tour="settings-main-panel">
          {activeSubTab === "roles" ? (
            roles.map((role) => (
              <motion.div 
                key={role.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-card rounded-2xl border border-border overflow-hidden shadow-sm hover:shadow-md transition-all group"
              >
                <div className="p-5 border-b border-border bg-accent/30 flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                      <Briefcase className="h-6 w-6" />
                    </div>
                    <div>
                      <h3 className="font-bold text-sm">{role.name}</h3>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{role.monthlyHours}h mensais</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => handleOpenModal(role)} className="p-1.5 rounded-lg hover:bg-background text-muted-foreground hover:text-primary transition-colors">
                      <Edit2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <div className="p-5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Salário Base</span>
                    <span className="text-lg font-black text-primary">{formatCurrency(role.baseSalary)}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>Custo p/ Hora (Base)</span>
                    <span>{formatNumber(Number(role.baseSalary) / role.monthlyHours, 5)}</span>
                  </div>
                </div>
              </motion.div>
            ))
          ) : activeSubTab === "payroll" ? (
            components.map((comp) => (
              <motion.div 
                key={comp.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-card rounded-2xl border border-border overflow-hidden shadow-sm hover:shadow-md transition-all group"
              >
                <div className="p-5 border-b border-border bg-accent/30 flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                      <CreditCard className="h-6 w-6" />
                    </div>
                    <div>
                      <h3 className="font-bold text-sm">{comp.name}</h3>
                      <p className={cn(
                        "text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full inline-block mt-1",
                        comp.type === "BENEFIT" ? "bg-green-100 text-green-700" : 
                        comp.type === "CHARGE" ? "bg-blue-100 text-blue-700" : "bg-orange-100 text-orange-700"
                      )}>
                        {comp.type === "BENEFIT" ? "Benefício" : comp.type === "CHARGE" ? "Encargo" : "Provisão"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => handleOpenModal(comp)} className="p-1.5 rounded-lg hover:bg-background text-muted-foreground hover:text-primary transition-colors">
                      <Edit2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <div className="p-5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Valor / Alíquota</span>
                    <span className="text-lg font-black text-primary">
                      {comp.calculationType === "PERCENTAGE" ? `${formatNumber(comp.value)}%` : formatCurrency(comp.value)}
                    </span>
                  </div>
                  <div className="mt-2 text-[10px] text-muted-foreground italic">
                    {comp.calculationType === "PERCENTAGE" ? "Calculado sobre o salário base" : "Valor fixo mensal"}
                  </div>
                </div>
              </motion.div>
            ))
          ) : (
            <div className="col-span-1 md:col-span-2 lg:col-span-3 bg-card rounded-2xl border border-border overflow-hidden shadow-sm p-6">
              <h3 className="text-lg font-bold mb-4">Parâmetros Globais da Empresa</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Custo de Energia (R$ / mês)</label>
                  <input
                    type="number"
                    step="0.00001"
                    value={globalForm.energyCost}
                    onChange={(e) => setGlobalForm({ ...globalForm, energyCost: Number(e.target.value) })}
                    className="w-full p-3 bg-background border border-border rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all outline-none"
                    placeholder="Ex: 5000.00"
                  />
                  <p className="text-[10px] text-muted-foreground">Custo total estimado de energia da fábrica.</p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Horas Máquina Disponíveis</label>
                  <input
                    type="number"
                    step="0.00001"
                    value={globalForm.workingHours}
                    onChange={(e) => setGlobalForm({ ...globalForm, workingHours: Number(e.target.value) })}
                    className="w-full p-3 bg-background border border-border rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all outline-none"
                    placeholder="Ex: 176"
                  />
                  <p className="text-[10px] text-muted-foreground">Divisor da Energia para Taxa HM.</p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Capacidade Fabril Total</label>
                  <input
                    type="number"
                    step="0.00001"
                    value={globalForm.factoryHours}
                    onChange={(e) => setGlobalForm({ ...globalForm, factoryHours: Number(e.target.value) })}
                    className="w-full p-3 bg-background border border-border rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all outline-none"
                    placeholder="Ex: 8448"
                  />
                  <p className="text-[10px] text-muted-foreground">Horas mensais totais alocadas p/ rateio de CIF e OPEX.</p>
                </div>
                <div className="space-y-1.5 p-4 rounded-2xl bg-primary/5 border border-primary/10 lg:col-span-1">
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-bold text-primary uppercase tracking-wider">Override Custo HH (R$/h)</label>
                    <span className={cn(
                      "text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase",
                      globals.hhSource === "MANUAL" ? "bg-orange-100 text-orange-700" : "bg-blue-100 text-blue-700"
                    )}>
                      {globals.hhSource === "MANUAL" ? "Manual Ativo" : "Automático"}
                    </span>
                  </div>
                  <input
                    type="number"
                    step="0.00001"
                    value={globalForm.hhOverride}
                    onChange={(e) => setGlobalForm({ ...globalForm, hhOverride: e.target.value === "" ? "" : Number(e.target.value) })}
                    className="w-full p-3 bg-background border border-primary/20 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all outline-none font-bold text-primary placeholder:font-normal placeholder:text-muted-foreground/50"
                    placeholder={`Automático: ${formatCurrency(globals.calculatedHh, 5)}/h`}
                  />
                  <p className="text-[10px] text-muted-foreground">
                    {globalForm.hhOverride === "" || globalForm.hhOverride === 0 
                      ? `Usando cálculo automático da folha: ${formatCurrency(globals.calculatedHh, 5)}/h`
                      : `Sobrescrevendo cálculo automático com valor manual.`}
                  </p>
                </div>
              </div>
              <div className="mt-6 flex justify-end">
                <button
                  onClick={handleSaveGlobals}
                  className="bg-primary text-primary-foreground px-6 py-2.5 rounded-xl font-bold hover:opacity-90 transition-opacity"
                >
                  Salvar Parâmetros
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <GuidedTour
        open={tourOpen}
        onClose={() => setTourOpen(false)}
        steps={SETTINGS_TOUR_STEPS}
        tourName="Tour de Configurações"
      />

      {/* Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-card w-full max-w-md rounded-2xl border border-border shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-border flex items-center justify-between bg-accent/30">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                    <Settings className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold">
                      {editingItem ? "Editar" : "Novo"} {activeSubTab === "roles" ? "Cargo" : "Componente"}
                    </h3>
                  </div>
                </div>
                <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-accent rounded-full transition-colors">
                  <X className="h-5 w-5" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="p-6 space-y-4">
                {activeSubTab === "roles" ? (
                  <>
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Nome do Cargo</label>
                      <input
                        required
                        type="text"
                        className="w-full p-3 rounded-xl border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none"
                        value={roleForm.name}
                        onChange={(e) => setRoleForm({...roleForm, name: e.target.value})}
                        placeholder="Ex: Operador de Torno"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Salário Base</label>
                        <input
                          required
                          type="number"
                          step="0.00001"
                          className="w-full p-3 rounded-xl border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none"
                          value={roleForm.baseSalary}
                          onChange={(e) => setRoleForm({...roleForm, baseSalary: parseFloat(e.target.value)})}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Horas Mensais</label>
                        <input
                          required
                          type="number"
                          className="w-full p-3 rounded-xl border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none"
                          value={roleForm.monthlyHours}
                          onChange={(e) => setRoleForm({...roleForm, monthlyHours: parseInt(e.target.value)})}
                        />
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Nome do Componente</label>
                      <input
                        required
                        type="text"
                        className="w-full p-3 rounded-xl border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none"
                        value={componentForm.name}
                        onChange={(e) => setComponentForm({...componentForm, name: e.target.value})}
                        placeholder="Ex: FGTS, Vale Refeição..."
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Tipo</label>
                        <SearchableSelect
                          placeholder="Tipo..."
                          options={PAYROLL_COMPONENT_TYPE_OPTIONS}
                          value={componentForm.type}
                          onChange={(v) =>
                            setComponentForm({ ...componentForm, type: v as PayrollComponent["type"] })
                          }
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Cálculo</label>
                        <SearchableSelect
                          placeholder="Cálculo..."
                          options={PAYROLL_COMPONENT_CALC_OPTIONS}
                          value={componentForm.calculationType}
                          onChange={(v) =>
                            setComponentForm({
                              ...componentForm,
                              calculationType: v as PayrollComponent["calculationType"],
                            })
                          }
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Valor / Alíquota</label>
                      <input
                        required
                        type="number"
                        step="0.00001"
                        className="w-full p-3 rounded-xl border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none"
                        value={componentForm.value}
                        onChange={(e) => setComponentForm({...componentForm, value: parseFloat(e.target.value)})}
                      />
                    </div>
                  </>
                )}

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
