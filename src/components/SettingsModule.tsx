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
import { motion, AnimatePresence } from "motion/react";

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
  const [activeSubTab, setActiveSubTab] = useState<"roles" | "payroll" | "globals" | "branding">("roles");
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

  const [brandingForm, setBrandingForm] = useState({
    companyName: "",
    tradeName: "",
    document: "",
    logoUrl: "",
    logoBase64: "",
    primaryColor: "#2563eb",
    secondaryColor: "#0f172a",
    accentColor: "#3b82f6",
    address: "",
    phone: "",
    email: "",
    website: "",
    proposalFooterText: "",
    commercialContactName: "",
    commercialContactEmail: "",
    commercialContactPhone: "",
  });
  const [brandingSaving, setBrandingSaving] = useState(false);
  const [toastMessage, setToastMessage] = useState<{ type: "success" | "error", text: string } | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [rRes, cRes, gRes, bRes] = await Promise.all([
        fetch("/api/roles").catch(() => null),
        fetch("/api/payroll-components").catch(() => null),
        fetch("/api/settings/globals").catch(() => null),
        fetch("/api/branding-settings").catch(() => null)
      ]);

      if (rRes && rRes.ok) setRoles(await rRes.json());
      if (cRes && cRes.ok) setComponents(await cRes.json());
      
      if (gRes && gRes.ok) {
        const config = await gRes.json();
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
      }

      if (bRes && bRes.ok) {
        const branding = await bRes.json();
        setBrandingForm({
          companyName: branding.companyName || "Lazarios",
          tradeName: branding.tradeName || "Lazarios",
          document: branding.document || "",
          logoUrl: branding.logoUrl || "",
          logoBase64: branding.logoBase64 || "",
          primaryColor: branding.primaryColor || "#2563eb",
          secondaryColor: branding.secondaryColor || "#0f172a",
          accentColor: branding.accentColor || "#3b82f6",
          address: branding.address || "",
          phone: branding.phone || "",
          email: branding.email || "",
          website: branding.website || "",
          proposalFooterText: branding.proposalFooterText || "",
          commercialContactName: branding.commercialContactName || "",
          commercialContactEmail: branding.commercialContactEmail || "",
          commercialContactPhone: branding.commercialContactPhone || "",
        });
      }
    } catch (error) {
      console.error("Erro ao buscar configurações:", error);
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
      await fetch(energyUrl, {
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
      await fetch(hoursUrl, {
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
      await fetch(factoryUrl, {
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
      await fetch(hhUrl, {
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
    }
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        setToastMessage({ type: "error", text: "O logotipo deve ter no máximo 2MB." });
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setBrandingForm(prev => ({ ...prev, logoBase64: reader.result as string }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSaveBranding = async (e: React.FormEvent) => {
    e.preventDefault();
    setBrandingSaving(true);
    setToastMessage(null);
    try {
      const res = await fetch("/api/branding-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(brandingForm),
      });
      if (res.ok) {
        setToastMessage({ type: "success", text: "Identidade visual salva com sucesso!" });
        fetchData();
      } else {
        const errData = await res.json();
        setToastMessage({ type: "error", text: errData.message || "Erro ao salvar identidade visual." });
      }
    } catch (error) {
      console.error("Erro ao salvar branding:", error);
      setToastMessage({ type: "error", text: "Erro ao conectar ao servidor." });
    } finally {
      setBrandingSaving(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const endpoint = activeSubTab === "roles" ? "/api/roles" : "/api/payroll-components";
    const method = editingItem ? "PUT" : "POST";
    const url = editingItem ? `${endpoint}/${editingItem.id}` : endpoint;
    const body = activeSubTab === "roles" ? roleForm : componentForm;

    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setIsModalOpen(false);
        fetchData();
      }
    } catch (error) {
      console.error("Erro ao salvar:", error);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4 border-b border-border w-full sm:w-auto">
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
          <button
            onClick={() => { setActiveSubTab("branding"); setToastMessage(null); }}
            className={cn(
              "px-4 py-2 text-sm font-bold transition-all relative",
              activeSubTab === "branding" ? "text-primary" : "text-muted-foreground hover:text-foreground"
            )}
          >
            Identidade Visual
            {activeSubTab === "branding" && <motion.div layoutId="subtab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
          </button>
        </div>
        {(activeSubTab !== "globals" && activeSubTab !== "branding") && (
          <button 
            onClick={() => handleOpenModal()}
            className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg font-medium hover:opacity-90 transition-opacity text-sm shrink-0"
          >
            <Plus className="h-4 w-4" />
            {activeSubTab === "roles" ? "Novo Cargo" : "Novo Componente"}
          </button>
        )}
      </div>

      {loading ? (
        <div className="p-12 text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
        </div>
      ) : activeSubTab === "branding" ? (
            <div className="bg-card rounded-2xl border border-border shadow-sm p-6 space-y-6">
              <div className="border-b border-border pb-4">
                <h3 className="text-lg font-bold text-foreground">Identidade Visual da Empresa</h3>
                <p className="text-xs text-muted-foreground">Personalize a marca da empresa. Estas informações serão usadas nas propostas comerciais, relatórios e documentos exportados.</p>
              </div>

              {toastMessage && (
                <div className={cn(
                  "p-4 rounded-xl flex items-center gap-3 text-sm font-medium mb-6",
                  toastMessage.type === "success" ? "bg-green-500/10 text-green-700 border border-green-200" : "bg-red-500/10 text-red-700 border border-red-200"
                )}>
                  {toastMessage.type === "success" ? <CheckCircle2 className="h-5 w-5 shrink-0" /> : <AlertCircle className="h-5 w-5 shrink-0" />}
                  <span>{toastMessage.text}</span>
                </div>
              )}

              <form onSubmit={handleSaveBranding} className="space-y-8">
                {/* Grid 1: Informações Gerais */}
                <div className="space-y-4">
                  <h4 className="text-xs font-bold text-primary uppercase tracking-wider">Dados Corporativos</h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Razão Social *</label>
                      <input
                        required
                        type="text"
                        value={brandingForm.companyName}
                        onChange={(e) => setBrandingForm({ ...brandingForm, companyName: e.target.value })}
                        className="w-full p-3 bg-background border border-border rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all outline-none text-sm"
                        placeholder="Ex: Lazarios Koppetel Ltda"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Nome Fantasia *</label>
                      <input
                        required
                        type="text"
                        value={brandingForm.tradeName}
                        onChange={(e) => setBrandingForm({ ...brandingForm, tradeName: e.target.value })}
                        className="w-full p-3 bg-background border border-border rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all outline-none text-sm"
                        placeholder="Ex: Lazarios"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">CNPJ / CPF</label>
                      <input
                        type="text"
                        value={brandingForm.document}
                        onChange={(e) => setBrandingForm({ ...brandingForm, document: e.target.value })}
                        className="w-full p-3 bg-background border border-border rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all outline-none text-sm"
                        placeholder="Ex: 00.000.000/0000-00"
                      />
                    </div>
                  </div>
                </div>

                {/* Grid 2: Contato e Endereço */}
                <div className="space-y-4">
                  <h4 className="text-xs font-bold text-primary uppercase tracking-wider">Endereço e Contato</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-1.5 md:col-span-2">
                      <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Endereço Completo</label>
                      <input
                        type="text"
                        value={brandingForm.address}
                        onChange={(e) => setBrandingForm({ ...brandingForm, address: e.target.value })}
                        className="w-full p-3 bg-background border border-border rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all outline-none text-sm"
                        placeholder="Ex: Av. Paulista, 1000 - Bela Vista, São Paulo - SP"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Telefone</label>
                      <input
                        type="text"
                        value={brandingForm.phone}
                        onChange={(e) => setBrandingForm({ ...brandingForm, phone: e.target.value })}
                        className="w-full p-3 bg-background border border-border rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all outline-none text-sm"
                        placeholder="Ex: (11) 99999-9999"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">E-mail Geral</label>
                      <input
                        type="email"
                        value={brandingForm.email}
                        onChange={(e) => setBrandingForm({ ...brandingForm, email: e.target.value })}
                        className="w-full p-3 bg-background border border-border rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all outline-none text-sm"
                        placeholder="Ex: contato@empresa.com.br"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Website</label>
                      <input
                        type="text"
                        value={brandingForm.website}
                        onChange={(e) => setBrandingForm({ ...brandingForm, website: e.target.value })}
                        className="w-full p-3 bg-background border border-border rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all outline-none text-sm"
                        placeholder="Ex: www.empresa.com.br"
                      />
                    </div>
                  </div>
                </div>

                {/* Grid 3: Paleta de Cores e Logotipo */}
                <div className="space-y-4">
                  <h4 className="text-xs font-bold text-primary uppercase tracking-wider">Design Visual da Marca</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* Cores */}
                    <div className="space-y-4 bg-accent/20 p-5 rounded-2xl border border-border">
                      <h5 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Cores da Identidade</h5>
                      <div className="grid grid-cols-3 gap-4">
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Cor Primária</label>
                          <div className="flex gap-2 items-center">
                            <input
                              type="color"
                              value={brandingForm.primaryColor}
                              onChange={(e) => setBrandingForm({ ...brandingForm, primaryColor: e.target.value })}
                              className="h-9 w-9 rounded cursor-pointer border border-border bg-transparent p-0"
                            />
                            <input
                              type="text"
                              value={brandingForm.primaryColor}
                              onChange={(e) => setBrandingForm({ ...brandingForm, primaryColor: e.target.value })}
                              className="w-full p-1 border border-border rounded text-xs text-center outline-none bg-background font-mono"
                            />
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Cor Secundária</label>
                          <div className="flex gap-2 items-center">
                            <input
                              type="color"
                              value={brandingForm.secondaryColor || "#0f172a"}
                              onChange={(e) => setBrandingForm({ ...brandingForm, secondaryColor: e.target.value })}
                              className="h-9 w-9 rounded cursor-pointer border border-border bg-transparent p-0"
                            />
                            <input
                              type="text"
                              value={brandingForm.secondaryColor || ""}
                              onChange={(e) => setBrandingForm({ ...brandingForm, secondaryColor: e.target.value })}
                              className="w-full p-1 border border-border rounded text-xs text-center outline-none bg-background font-mono"
                              placeholder="#0f172a"
                            />
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Cor Destaque</label>
                          <div className="flex gap-2 items-center">
                            <input
                              type="color"
                              value={brandingForm.accentColor || "#3b82f6"}
                              onChange={(e) => setBrandingForm({ ...brandingForm, accentColor: e.target.value })}
                              className="h-9 w-9 rounded cursor-pointer border border-border bg-transparent p-0"
                            />
                            <input
                              type="text"
                              value={brandingForm.accentColor || ""}
                              onChange={(e) => setBrandingForm({ ...brandingForm, accentColor: e.target.value })}
                              className="w-full p-1 border border-border rounded text-xs text-center outline-none bg-background font-mono"
                              placeholder="#3b82f6"
                            />
                          </div>
                        </div>
                      </div>
                      <div className="pt-2">
                        <div className="text-[10px] text-muted-foreground">Pré-visualização da Paleta:</div>
                        <div className="flex gap-1 h-4 w-full rounded-md overflow-hidden border border-border mt-1">
                          <div className="flex-1" style={{ backgroundColor: brandingForm.primaryColor }} />
                          <div className="flex-1" style={{ backgroundColor: brandingForm.secondaryColor || "#0f172a" }} />
                          <div className="flex-1" style={{ backgroundColor: brandingForm.accentColor || "#3b82f6" }} />
                        </div>
                      </div>
                    </div>

                    {/* Logotipo */}
                    <div className="space-y-4 bg-accent/20 p-5 rounded-2xl border border-border flex flex-col justify-between">
                      <div>
                        <h5 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Logotipo da Empresa</h5>
                        <div className="flex items-center gap-4">
                          {brandingForm.logoBase64 ? (
                            <div className="h-20 w-20 rounded-xl bg-card border border-border flex items-center justify-center p-2 overflow-hidden shrink-0">
                              <img src={brandingForm.logoBase64} alt="Logo Preview" className="max-h-full max-w-full object-contain" />
                            </div>
                          ) : (
                            <div className="h-20 w-20 rounded-xl bg-card border border-dashed border-muted-foreground/30 flex items-center justify-center text-xs text-muted-foreground text-center p-1 shrink-0">
                              Sem Logo
                            </div>
                          )}
                          <div className="space-y-2 w-full">
                            <input
                              type="file"
                              accept="image/*"
                              id="logo-file-input"
                              onChange={handleLogoUpload}
                              className="hidden"
                            />
                            <label
                              htmlFor="logo-file-input"
                              className="cursor-pointer inline-flex items-center justify-center px-4 py-2 border border-border bg-card hover:bg-accent rounded-xl text-xs font-bold w-full transition-colors hover:bg-accent/80"
                            >
                              Carregar Imagem
                            </label>
                            {brandingForm.logoBase64 && (
                              <button
                                type="button"
                                onClick={() => setBrandingForm({ ...brandingForm, logoBase64: "" })}
                                className="w-full text-center text-xs text-red-500 hover:underline cursor-pointer"
                              >
                                Remover logotipo
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                      <p className="text-[10px] text-muted-foreground">Formato recomendado: PNG transparente ou SVG. Tamanho máximo de 2MB.</p>
                    </div>
                  </div>
                </div>

                {/* Grid 4: Rodapé e Contato Comercial */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-4">
                    <h4 className="text-xs font-bold text-primary uppercase tracking-wider">Rodapé das Propostas</h4>
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Texto de Termos / Rodapé</label>
                      <textarea
                        rows={5}
                        value={brandingForm.proposalFooterText}
                        onChange={(e) => setBrandingForm({ ...brandingForm, proposalFooterText: e.target.value })}
                        className="w-full p-3 bg-background border border-border rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all outline-none text-sm resize-none"
                        placeholder="Ex: Preços válidos por 15 dias. Condições de pagamento conforme acordado."
                      />
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h4 className="text-xs font-bold text-primary uppercase tracking-wider">Contato Comercial da Proposta</h4>
                    <div className="space-y-3 bg-accent/20 p-5 rounded-2xl border border-border">
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Nome do Contato</label>
                        <input
                          type="text"
                          value={brandingForm.commercialContactName}
                          onChange={(e) => setBrandingForm({ ...brandingForm, commercialContactName: e.target.value })}
                          className="w-full p-2 bg-background border border-border rounded-lg text-xs outline-none focus:ring-1 focus:ring-primary"
                          placeholder="Ex: João da Silva"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">E-mail Comercial</label>
                        <input
                          type="email"
                          value={brandingForm.commercialContactEmail}
                          onChange={(e) => setBrandingForm({ ...brandingForm, commercialContactEmail: e.target.value })}
                          className="w-full p-2 bg-background border border-border rounded-lg text-xs outline-none focus:ring-1 focus:ring-primary"
                          placeholder="Ex: joao.silva@empresa.com"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Telefone Comercial</label>
                        <input
                          type="text"
                          value={brandingForm.commercialContactPhone}
                          onChange={(e) => setBrandingForm({ ...brandingForm, commercialContactPhone: e.target.value })}
                          className="w-full p-2 bg-background border border-border rounded-lg text-xs outline-none focus:ring-1 focus:ring-primary"
                          placeholder="Ex: (11) 98888-8888"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Salvar */}
                <div className="flex justify-end pt-4 border-t border-border">
                  <button
                    type="submit"
                    disabled={brandingSaving}
                    className="flex items-center gap-2 bg-primary text-primary-foreground px-6 py-3 rounded-xl font-bold hover:opacity-90 transition-opacity disabled:opacity-50 text-sm shrink-0 cursor-pointer"
                  >
                    {brandingSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Salvar Identidade Visual
                  </button>
                </div>
              </form>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
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
                        <select
                          className="w-full p-3 rounded-xl border border-border bg-background outline-none focus:ring-2 focus:ring-primary/20"
                          value={componentForm.type}
                          onChange={(e) => setComponentForm({...componentForm, type: e.target.value as any})}
                        >
                          <option value="BENEFIT">Benefício</option>
                          <option value="CHARGE">Encargo</option>
                          <option value="PROVISION">Provisão</option>
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Cálculo</label>
                        <select
                          className="w-full p-3 rounded-xl border border-border bg-background outline-none focus:ring-2 focus:ring-primary/20"
                          value={componentForm.calculationType}
                          onChange={(e) => setComponentForm({...componentForm, calculationType: e.target.value as any})}
                        >
                          <option value="PERCENTAGE">Porcentagem (%)</option>
                          <option value="FIXED">Valor Fixo (R$)</option>
                        </select>
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
