// src/components/ProposalModule.tsx
import React, { useEffect, useState, useMemo, useCallback } from "react";
import { 
  Plus, 
  Search, 
  Edit2, 
  Trash2, 
  X,
  Loader2,
  FileText,
  Calendar,
  User,
  CheckCircle2,
  Clock,
  AlertCircle,
  ChevronRight,
  Save,
  ArrowLeft,
  Package,
  PlusCircle,
  Calculator,
  DollarSign,
  Percent,
  Truck,
  Info,
  ExternalLink,
  Printer,
  LayoutDashboard,
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { fetchJsonOk, fetchOk } from "@/src/lib/http";
import { SearchableSelect } from "./shared/SearchableSelect";
import { Proposal, Customer, ProposalItem, ProposalStatus } from "@/src/types/commercial";
import { Product } from "@/src/types/product";
import { motion, AnimatePresence } from "motion/react";
import { STORAGE_OPEN_PROPOSAL_KEY } from "@/src/lib/salesFunnel";
import { CalculatedValue } from "./shared/CalculatedValue";
import { buildProposalLineMarginExplanation } from "@/src/lib/proposalLineExplain";
import { GuidedTour } from "@/src/components/tour/GuidedTour";
import { TourHelpButton } from "@/src/components/tour/TourHelpButton";
import { PROPOSAL_TOUR_STEPS } from "@/src/tours/proposalTourSteps";
import { ProposalAnalysisModal } from "@/src/components/proposal/ProposalAnalysisModal";
import { ProposalIndicatorsTab } from "@/src/components/proposal/ProposalIndicatorsTab";
import { ProposalIndicatorsDetailModal } from "@/src/components/proposal/ProposalIndicatorsDetailModal";

const STATUS_CONFIG: Record<ProposalStatus, { label: string; color: string; icon: any }> = {
  DRAFT: { label: "Rascunho", color: "bg-slate-500/10 text-slate-600", icon: FileText },
  ANALYSIS: { label: "Em Análise", color: "bg-blue-500/10 text-blue-600", icon: Clock },
  SENT: { label: "Enviada", color: "bg-purple-500/10 text-purple-600", icon: ExternalLink },
  APPROVED: { label: "Aprovada", color: "bg-green-500/10 text-green-600", icon: CheckCircle2 },
  REJECTED: { label: "Rejeitada", color: "bg-red-500/10 text-red-600", icon: X },
  EXPIRED: { label: "Expirada", color: "bg-orange-500/10 text-orange-600", icon: AlertCircle },
  CANCELED: { label: "Cancelada", color: "bg-gray-500/10 text-gray-600", icon: Trash2 },
};

const PROPOSAL_STATUS_SELECT_OPTIONS = (Object.entries(STATUS_CONFIG) as [ProposalStatus, (typeof STATUS_CONFIG)["DRAFT"]][]).map(
  ([key, cfg]) => ({
    value: key,
    label: cfg.label,
    searchTerms: `${key} ${cfg.label}`,
  })
);

const FREIGHT_CONDITION_OPTIONS = [
  { value: "CIF", label: "CIF (Emitente)", searchTerms: "CIF emitente" },
  { value: "FOB", label: "FOB (Destinatário)", searchTerms: "FOB destinatario destinatário" },
];

function safeNum(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeProposalItem(
  item: Partial<ProposalItem> & { productId: string }
): ProposalItem {
  return {
    ...item,
    productId: item.productId,
    Product: item.Product,
    id: item.id,
    proposalId: item.proposalId,
    quantity: safeNum(item.quantity, 1),
    unit: item.unit ?? "UN",
    unitCost: safeNum(item.unitCost),
    suggestedPrice: safeNum(item.suggestedPrice),
    negotiatedPrice: safeNum(item.negotiatedPrice),
    discountPerc: safeNum(item.discountPerc),
    discountValue: safeNum(item.discountValue),
    marginValue: safeNum(item.marginValue),
    marginPerc: safeNum(item.marginPerc),
    taxesPerc: safeNum(item.taxesPerc),
    taxesValue: safeNum(item.taxesValue),
    commissionPerc: safeNum(item.commissionPerc),
    commissionValue: safeNum(item.commissionValue),
    freightValue: safeNum(item.freightValue),
    notes: item.notes,
    calculationExplainability: item.calculationExplainability,
  };
}

export const ProposalModule = () => {
  const [view, setView] = useState<"list" | "form">("list");
  const [tourOpen, setTourOpen] = useState(false);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [editingProposal, setEditingProposal] = useState<Proposal | null>(null);
  const [analysisProposalId, setAnalysisProposalId] = useState<string | null>(null);
  const [formTab, setFormTab] = useState<"items" | "indicators">("items");
  const [proposalIndicatorsDetailOpen, setProposalIndicatorsDetailOpen] = useState(false);

  // Form State
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [formData, setFormData] = useState<Partial<Proposal>>({
    title: "",
    customerId: "",
    status: "DRAFT",
    responsible: "",
    validityDays: 15,
    paymentTerms: "",
    paymentMethod: "",
    deliveryTimeDays: 7,
    freightCondition: "CIF",
    deliveryLocation: "",
    notes: "",
    items: []
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const [p, c, pr] = await Promise.all([
        fetchJsonOk<Proposal[]>("/api/proposals"),
        fetchJsonOk<Customer[]>("/api/customers"),
        fetchJsonOk<Product[]>("/api/products"),
      ]);
      setProposals(Array.isArray(p) ? p : []);
      setCustomers(Array.isArray(c) ? c : []);
      setProducts(Array.isArray(pr) ? pr : []);
    } catch (error) {
      console.error("Erro ao buscar dados:", error);
      alert(error instanceof Error ? error.message : "Não foi possível carregar propostas e cadastros.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleCreateNew = () => {
    setEditingProposal(null);
    setFormTab("items");
    setProposalIndicatorsDetailOpen(false);
    setFormData({
      title: "",
      customerId: "",
      status: "DRAFT",
      responsible: "",
      validityDays: 15,
      paymentTerms: "",
      paymentMethod: "",
      deliveryTimeDays: 7,
      freightCondition: "CIF",
      deliveryLocation: "",
      notes: "",
      items: []
    });
    setAnalysisProposalId(null);
    setView("form");
  };

  const handleEdit = useCallback(async (id: string) => {
    setAnalysisProposalId(null);
    setLoading(true);
    try {
      const data = await fetchJsonOk<Proposal & { items?: ProposalItem[] }>(`/api/proposals/${id}`);
      const items = Array.isArray(data.items)
        ? data.items.map((it: ProposalItem) => normalizeProposalItem(it))
        : [];
      setEditingProposal(data);
      setFormData({ ...data, items });
      setFormTab("items");
    setProposalIndicatorsDetailOpen(false);
      setView("form");
    } catch (error) {
      console.error("Erro ao buscar proposta:", error);
      alert(error instanceof Error ? error.message : "Não foi possível abrir a proposta.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (loading) return;
    let id: string | null = null;
    try {
      id = sessionStorage.getItem(STORAGE_OPEN_PROPOSAL_KEY);
    } catch {
      return;
    }
    if (!id) return;
    try {
      sessionStorage.removeItem(STORAGE_OPEN_PROPOSAL_KEY);
    } catch {
      /* ignore */
    }
    void handleEdit(id);
  }, [loading, handleEdit]);

  const handleSave = async () => {
    if (!formData.customerId) {
      alert("Selecione um cliente.");
      return;
    }
    if (!formData.items || formData.items.length === 0) {
      alert("Adicione pelo menos um item à proposta.");
      return;
    }

    const method = editingProposal ? "PUT" : "POST";
    const url = editingProposal ? `/api/proposals/${editingProposal.id}` : "/api/proposals";

    try {
      await fetchJsonOk(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      setView("list");
      fetchData();
    } catch (error) {
      console.error("Erro ao salvar proposta:", error);
      alert(error instanceof Error ? error.message : "Não foi possível salvar a proposta.");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Excluir esta proposta permanentemente?")) return;
    try {
      await fetchOk(`/api/proposals/${id}`, { method: "DELETE" });
      fetchData();
    } catch (error) {
      console.error("Erro ao excluir proposta:", error);
      alert(error instanceof Error ? error.message : "Não foi possível excluir a proposta.");
    }
  };

  const addItem = async (productId: string) => {
    const product = products.find(p => p.id === productId);
    if (!product) return;

    try {
      const snapshot = await fetchJsonOk<{
        unitCost?: unknown;
        suggestedPrice?: unknown;
        taxesPerc?: unknown;
        commissionPerc?: unknown;
        freightValue?: unknown;
        calculationExplainability?: ProposalItem["calculationExplainability"];
      }>(`/api/products/${productId}/pricing-snapshot`);

      const unitCost = safeNum(snapshot.unitCost);
      const suggestedPrice = safeNum(snapshot.suggestedPrice);
      const taxesPerc = safeNum(snapshot.taxesPerc);
      const commissionPerc = safeNum(snapshot.commissionPerc);
      const freightVal = safeNum(snapshot.freightValue);

      const qty = 1;
      const gross = qty * suggestedPrice;
      const totalCost = qty * unitCost;
      const taxesValue = gross * (taxesPerc / 100);
      const commissionValue = gross * (commissionPerc / 100);
      const marginValue = safeNum(
        gross - taxesValue - commissionValue - freightVal - totalCost
      );
      const marginPerc = gross > 0 ? safeNum((marginValue / gross) * 100) : 0;

      const newItem = normalizeProposalItem({
        productId,
        Product: product,
        quantity: qty,
        unit: "UN",
        unitCost,
        suggestedPrice,
        negotiatedPrice: suggestedPrice,
        discountPerc: 0,
        discountValue: 0,
        marginValue,
        marginPerc,
        taxesPerc,
        taxesValue,
        commissionPerc,
        commissionValue,
        freightValue: freightVal,
        calculationExplainability: snapshot.calculationExplainability,
      });

      setFormData(prev => ({
        ...prev,
        items: [...(prev.items || []), newItem]
      }));
    } catch (error) {
      console.error("Erro ao adicionar item:", error);
      alert(error instanceof Error ? error.message : "Não foi possível obter preço/custo do produto.");
    }
  };

  const updateItem = (index: number, updates: Partial<ProposalItem>) => {
    const newItems = [...(formData.items || [])];
    const merged = { ...newItems[index], ...updates };
    if (updates.unitCost !== undefined || updates.suggestedPrice !== undefined) {
      (merged as ProposalItem).calculationExplainability = undefined;
    }
    let item = normalizeProposalItem(merged);

    const qty = safeNum(item.quantity);
    const negotiated = safeNum(item.negotiatedPrice);
    const unitCost = safeNum(item.unitCost);
    const gross = qty * negotiated;

    if (updates.discountPerc !== undefined) {
      item.discountValue = safeNum(gross * (safeNum(item.discountPerc) / 100));
    } else if (updates.discountValue !== undefined) {
      const dv = safeNum(item.discountValue);
      item.discountPerc = gross > 0 ? safeNum((dv / gross) * 100) : 0;
      item.discountValue = dv;
    }

    const discountVal = safeNum(item.discountValue);
    const net = gross - discountVal;
    const totalCost = qty * unitCost;

    item.taxesValue = safeNum(net * (safeNum(item.taxesPerc) / 100));
    item.commissionValue = safeNum(net * (safeNum(item.commissionPerc) / 100));

    const freight = safeNum(item.freightValue);
    item.marginValue = safeNum(
      net - item.taxesValue - item.commissionValue - freight - totalCost
    );
    item.marginPerc = net > 0 ? safeNum((item.marginValue / net) * 100) : 0;

    newItems[index] = normalizeProposalItem(item);
    setFormData(prev => ({ ...prev, items: newItems }));
  };

  const removeItem = (index: number) => {
    const newItems = [...(formData.items || [])];
    newItems.splice(index, 1);
    setFormData(prev => ({ ...prev, items: newItems }));
  };

  // Totais Consolidados
  const totals = useMemo(() => {
    const items = formData.items || [];
    const totalGross = items.reduce(
      (acc, i) => acc + safeNum(i.quantity) * safeNum(i.negotiatedPrice),
      0
    );
    const totalDiscount = items.reduce((acc, i) => acc + safeNum(i.discountValue), 0);
    const totalNet = totalGross - totalDiscount;
    const totalCost = items.reduce(
      (acc, i) => acc + safeNum(i.quantity) * safeNum(i.unitCost),
      0
    );
    const totalTaxes = items.reduce((acc, i) => acc + safeNum(i.taxesValue), 0);
    const totalComm = items.reduce((acc, i) => acc + safeNum(i.commissionValue), 0);
    const totalFreight = items.reduce((acc, i) => acc + safeNum(i.freightValue), 0);
    
    const totalMarginValue = totalNet - totalTaxes - totalComm - totalFreight - totalCost;
    const totalMarginPerc = totalNet > 0 ? (totalMarginValue / totalNet) * 100 : 0;

    return {
      totalItems: items.length,
      totalGross,
      totalDiscount,
      totalNet,
      totalCost,
      totalTaxes,
      totalComm,
      totalFreight,
      totalMarginValue,
      totalMarginPerc
    };
  }, [formData.items]);

  // Sincronizar totais com o formData para salvar
  useEffect(() => {
    setFormData(prev => ({
      ...prev,
      totalItems: totals.totalItems,
      totalGrossValue: totals.totalGross,
      totalDiscount: totals.totalDiscount,
      totalNetValue: totals.totalNet,
      totalCost: totals.totalCost,
      totalTaxes: totals.totalTaxes,
      totalCommission: totals.totalComm,
      totalFreight: totals.totalFreight,
      totalMarginValue: totals.totalMarginValue,
      totalMarginPerc: totals.totalMarginPerc
    }));
  }, [totals]);

  const filteredProposals = proposals.filter(p => 
    (p.title || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.Customer?.companyName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.number.toString().includes(searchTerm)
  );

  if (view === "form") {
    return (
      <div className="space-y-6 pb-20" data-tour="proposals-root">
        {/* Form Header */}
        <div className="flex items-center justify-between" data-tour="proposals-form-actions">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setView("list")}
              className="p-2 rounded-full hover:bg-accent transition-colors"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div>
              <h3 className="text-2xl font-bold">
                {editingProposal ? `Editar Proposta #${editingProposal.number}` : "Nova Proposta Comercial"}
              </h3>
              <p className="text-sm text-muted-foreground">Preencha os dados e configure os itens para gerar a proposta.</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <TourHelpButton onClick={() => setTourOpen(true)} />
            <div className={cn("min-w-[200px]", STATUS_CONFIG[formData.status as ProposalStatus]?.color, "rounded-lg border border-border p-0.5")}>
              <SearchableSelect
                className="border-0 bg-transparent"
                placeholder="Status..."
                options={PROPOSAL_STATUS_SELECT_OPTIONS}
                value={formData.status || "DRAFT"}
                onChange={(v) => setFormData({ ...formData, status: v as ProposalStatus })}
              />
            </div>
            <button 
              onClick={handleSave}
              className="flex items-center gap-2 bg-primary text-primary-foreground px-6 py-2 rounded-lg font-bold hover:opacity-90 transition-opacity shadow-lg"
            >
              <Save className="h-4 w-4" />
              Salvar Proposta
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: Client & Conditions */}
          <div className="lg:col-span-1 space-y-6">
            <div className="bg-card rounded-xl border border-border p-6 shadow-sm space-y-6">
              <h4 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <User className="h-4 w-4" /> Cliente e Cabeçalho
              </h4>
              
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-muted-foreground uppercase">Título da Proposta</label>
                  <input
                    type="text"
                    placeholder="Ex: Fornecimento de Peças - Projeto X"
                    className="w-full p-2 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm"
                    value={formData.title}
                    onChange={(e) => setFormData({...formData, title: e.target.value})}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-muted-foreground uppercase">Cliente</label>
                  <SearchableSelect
                    required
                    placeholder="Selecione um cliente..."
                    options={customers.map((c) => {
                      const primary = (c.companyName || c.tradeName || "").trim() || "Cliente";
                      const sub =
                        c.tradeName && c.companyName && c.tradeName !== c.companyName
                          ? c.tradeName
                          : c.taxId || undefined;
                      return {
                        value: c.id,
                        label: primary,
                        sublabel: sub,
                        searchTerms: [c.companyName, c.tradeName, c.taxId].filter(Boolean).join(" "),
                      };
                    })}
                    value={formData.customerId || ""}
                    onChange={(val) => setFormData({...formData, customerId: val})}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase">Responsável</label>
                    <input
                      type="text"
                      className="w-full p-2 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm"
                      value={formData.responsible}
                      onChange={(e) => setFormData({...formData, responsible: e.target.value})}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase">Validade (Dias)</label>
                    <input
                      type="number"
                      className="w-full p-2 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm"
                      value={formData.validityDays}
                      onChange={(e) => setFormData({...formData, validityDays: parseInt(e.target.value)})}
                    />
                  </div>
                </div>
              </div>

              <hr className="border-border" />

              <h4 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <Truck className="h-4 w-4" /> Condições Comerciais
              </h4>

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-muted-foreground uppercase">Condição de Pagamento</label>
                  <input
                    type="text"
                    placeholder="Ex: 30/60/90 dias"
                    className="w-full p-2 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm"
                    value={formData.paymentTerms}
                    onChange={(e) => setFormData({...formData, paymentTerms: e.target.value})}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase">Frete</label>
                    <SearchableSelect
                      placeholder="Condição de frete..."
                      options={FREIGHT_CONDITION_OPTIONS}
                      value={formData.freightCondition || "CIF"}
                      onChange={(v) => setFormData({ ...formData, freightCondition: v })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase">Prazo Entrega (Dias)</label>
                    <input
                      type="number"
                      className="w-full p-2 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm"
                      value={formData.deliveryTimeDays}
                      onChange={(e) => setFormData({...formData, deliveryTimeDays: parseInt(e.target.value)})}
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-muted-foreground uppercase">Local de Entrega</label>
                  <input
                    type="text"
                    className="w-full p-2 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm"
                    value={formData.deliveryLocation}
                    onChange={(e) => setFormData({...formData, deliveryLocation: e.target.value})}
                  />
                </div>
              </div>
            </div>

            {/* Internal Notes */}
            <div className="bg-card rounded-xl border border-border p-6 shadow-sm space-y-4">
              <h4 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Notas Internas</h4>
              <textarea
                rows={4}
                placeholder="Observações que não aparecem no PDF da proposta..."
                className="w-full p-2 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm resize-none"
                value={formData.internalNotes}
                onChange={(e) => setFormData({...formData, internalNotes: e.target.value})}
              />
            </div>
          </div>

          {/* Right Column: Items Grid */}
          <div className="lg:col-span-2 space-y-6">
            <div
              className="bg-card rounded-xl border border-border shadow-sm overflow-hidden flex flex-col min-h-[600px]"
              data-tour="proposals-form-items"
            >
              <div className="p-4 border-b border-border bg-accent/30 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <h4 className="font-bold flex items-center gap-2">
                    <Package className="h-4 w-4" /> Proposta — Edição
                  </h4>
                  <div className="flex items-center gap-1 rounded-lg border border-border bg-card/40 p-1">
                    <button
                      type="button"
                      onClick={() => setFormTab("items")}
                      className={cn(
                        "px-3 py-1.5 rounded-md text-xs font-bold transition-colors",
                        formTab === "items"
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground"
                      )}
                    >
                      Itens
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormTab("indicators")}
                      className={cn(
                        "px-3 py-1.5 rounded-md text-xs font-bold transition-colors",
                        formTab === "indicators"
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground"
                      )}
                    >
                      Indicadores
                    </button>
                  </div>
                </div>
                {formTab === "items" ? (
                  <div className="flex items-center gap-2">
                    <div className="w-64">
                      <SearchableSelect
                        placeholder="+ Adicionar Produto..."
                        options={products.map((p) => ({
                          value: p.id,
                          label: `${p.sku} — ${p.name}`,
                          sublabel: p.type === "COMPONENT" ? "Componente" : "Produto",
                          searchTerms: `${p.sku} ${p.name}`,
                        }))}
                        value=""
                        onChange={(val) => val && addItem(val)}
                      />
                    </div>
                  </div>
                ) : null}
              </div>

              {formTab === "items" ? (
                <div className="flex-1 overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-accent/20 border-b border-border">
                        <th className="p-3 text-[10px] font-bold uppercase text-muted-foreground">Produto</th>
                        <th className="p-3 text-[10px] font-bold uppercase text-muted-foreground w-20">Qtd</th>
                        <th className="p-3 text-[10px] font-bold uppercase text-muted-foreground">Custo Unit.</th>
                        <th className="p-3 text-[10px] font-bold uppercase text-muted-foreground">Sugerido</th>
                        <th className="p-3 text-[10px] font-bold uppercase text-muted-foreground">Negociado</th>
                        <th className="p-3 text-[10px] font-bold uppercase text-muted-foreground w-20">Desc %</th>
                        <th
                          className="p-3 text-[10px] font-bold uppercase text-muted-foreground max-w-[120px]"
                          title="Margem líquida sobre faturamento bruto da linha, após impostos, comissão, frete e custo industrial (CIU do motor)."
                        >
                          Margem líq. %
                        </th>
                        <th className="p-3 text-[10px] font-bold uppercase text-muted-foreground text-right">Total Líq.</th>
                        <th className="p-3 text-[10px] font-bold uppercase text-muted-foreground text-center"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {formData.items?.map((item, idx) => (
                        <tr key={idx} className="hover:bg-accent/10 transition-colors group">
                          <td className="p-3">
                            <div className="max-w-[200px]">
                              <p className="text-xs font-bold truncate">{item.Product?.sku}</p>
                              <p className="text-[10px] text-muted-foreground truncate">{item.Product?.name}</p>
                            </div>
                          </td>
                          <td className="p-3">
                            <input
                              type="number"
                              step="0.00001"
                              className="w-full p-1 rounded border border-border bg-background text-xs outline-none"
                              value={item.quantity}
                              onChange={(e) => updateItem(idx, { quantity: parseFloat(e.target.value) || 0 })}
                            />
                          </td>
                          <td className="p-3 text-xs font-mono text-muted-foreground">
                            <CalculatedValue meta={item.calculationExplainability?.unitCost ?? null} hideIcon>
                              <span>
                                {safeNum(item.unitCost).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 5 })}
                              </span>
                            </CalculatedValue>
                          </td>
                          <td className="p-3 text-xs font-mono text-blue-600 font-medium">
                            <CalculatedValue meta={item.calculationExplainability?.suggestedPrice ?? null} hideIcon>
                              <span>
                                {safeNum(item.suggestedPrice).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 5 })}
                              </span>
                            </CalculatedValue>
                          </td>
                          <td className="p-3">
                            <input
                              type="number"
                              step="0.00001"
                              className="w-full p-1 rounded border border-border bg-background text-xs font-mono outline-none focus:ring-1 focus:ring-primary"
                              value={item.negotiatedPrice}
                              onChange={(e) => updateItem(idx, { negotiatedPrice: parseFloat(e.target.value) || 0 })}
                            />
                          </td>
                          <td className="p-3">
                            <input
                              type="number"
                              step="0.00001"
                              className="w-full p-1 rounded border border-border bg-background text-xs outline-none"
                              value={item.discountPerc}
                              onChange={(e) => updateItem(idx, { discountPerc: parseFloat(e.target.value) || 0 })}
                            />
                          </td>
                          <td className="p-3">
                            <CalculatedValue
                              hideIcon
                              meta={buildProposalLineMarginExplanation({
                                quantity: safeNum(item.quantity),
                                negotiatedPrice: safeNum(item.negotiatedPrice),
                                discountValue: safeNum(item.discountValue),
                                taxesValue: safeNum(item.taxesValue),
                                commissionValue: safeNum(item.commissionValue),
                                freightValue: safeNum(item.freightValue),
                                unitCost: safeNum(item.unitCost),
                                marginValue: safeNum(item.marginValue),
                                marginPerc: safeNum(item.marginPerc),
                              })}
                            >
                              <div
                                className={cn(
                                  "text-xs font-bold",
                                  safeNum(item.marginPerc) >= 20
                                    ? "text-green-600"
                                    : safeNum(item.marginPerc) >= 10
                                      ? "text-orange-600"
                                      : "text-red-600"
                                )}
                              >
                                {safeNum(item.marginPerc).toFixed(3)}%
                              </div>
                            </CalculatedValue>
                          </td>
                          <td className="p-3 text-right text-xs font-bold font-mono">
                            {(safeNum(item.quantity) * safeNum(item.negotiatedPrice) - safeNum(item.discountValue)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 })}
                          </td>
                          <td className="p-3 text-center">
                            <button 
                              onClick={() => removeItem(idx)}
                              className="p-1.5 rounded-md hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-all opacity-0 group-hover:opacity-100"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                      {(!formData.items || formData.items.length === 0) && (
                        <tr>
                          <td colSpan={9} className="p-12 text-center text-muted-foreground italic text-sm">
                            Nenhum produto adicionado. Use o seletor acima para começar.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto p-4">
                  <ProposalIndicatorsTab
                    proposalNumber={editingProposal?.number ?? null}
                    proposalTitle={formData.title ?? null}
                    proposalId={editingProposal?.id ?? null}
                    onOpenDetailed={() => setProposalIndicatorsDetailOpen(true)}
                    items={formData.items || []}
                    totals={{
                      totalGrossValue: totals.totalGross,
                      totalDiscount: totals.totalDiscount,
                      totalNetValue: totals.totalNet,
                      totalTaxes: totals.totalTaxes,
                      totalCommission: totals.totalComm,
                      totalFreight: totals.totalFreight,
                      totalMarginValue: totals.totalMarginValue,
                      totalMarginPerc: totals.totalMarginPerc,
                    }}
                  />
                </div>
              )}

              {/* Summary Footer */}
              <div className="p-6 bg-accent/30 border-t border-border grid grid-cols-2 md:grid-cols-4 gap-6">
                <div className="space-y-1">
                  <p className="text-[10px] font-bold text-muted-foreground uppercase">Valor Bruto Total</p>
                  <p className="text-lg font-bold font-mono">{totals.totalGross.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-bold text-muted-foreground uppercase">Descontos Concedidos</p>
                  <p className="text-lg font-bold font-mono text-red-600">-{totals.totalDiscount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-bold text-muted-foreground uppercase">Receita Líquida</p>
                  <p className="text-lg font-bold font-mono text-primary">{totals.totalNet.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
                </div>
                <div className="space-y-1 border-l border-border pl-6">
                  <p className="text-[10px] font-bold text-muted-foreground uppercase">Margem de Contribuição</p>
                  <div className="flex items-baseline gap-2">
                    <p className={cn(
                      "text-lg font-bold font-mono",
                      totals.totalMarginPerc >= 20 ? "text-green-600" : totals.totalMarginPerc >= 10 ? "text-orange-600" : "text-red-600"
                    )}>
                      {totals.totalMarginPerc.toFixed(3)}%
                    </p>
                    <span className="text-xs text-muted-foreground">({totals.totalMarginValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })})</span>
                  </div>
                </div>
              </div>
            </div>

            <ProposalIndicatorsDetailModal
              open={proposalIndicatorsDetailOpen}
              onClose={() => setProposalIndicatorsDetailOpen(false)}
              proposalNumber={editingProposal?.number ?? null}
              proposalTitle={formData.title ?? null}
              proposalId={editingProposal?.id ?? null}
              items={formData.items || []}
              totals={{
                totalGrossValue: totals.totalGross,
                totalDiscount: totals.totalDiscount,
                totalNetValue: totals.totalNet,
                totalTaxes: totals.totalTaxes,
                totalCommission: totals.totalComm,
                totalFreight: totals.totalFreight,
                totalMarginValue: totals.totalMarginValue,
                totalMarginPerc: totals.totalMarginPerc,
              }}
            />

            {/* General Notes for PDF */}
            <div className="bg-card rounded-xl border border-border p-6 shadow-sm space-y-4">
              <h4 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <Info className="h-4 w-4" /> Observações da Proposta (PDF)
              </h4>
              <textarea
                rows={4}
                placeholder="Condições especiais, validade, observações técnicas..."
                className="w-full p-2 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm resize-none"
                value={formData.notes}
                onChange={(e) => setFormData({...formData, notes: e.target.value})}
              />
            </div>
          </div>
        </div>

        <GuidedTour
          open={tourOpen}
          onClose={() => setTourOpen(false)}
          steps={PROPOSAL_TOUR_STEPS}
          tourName="Tour de Propostas"
        />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-tour="proposals-root">
      {/* List Header */}
      <div
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-4"
        data-tour="proposals-toolbar"
      >
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Buscar por número, cliente ou título..."
            className="w-full pl-10 pr-4 py-2 rounded-lg border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <TourHelpButton onClick={() => setTourOpen(true)} />
          <button
            onClick={handleCreateNew}
            className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg font-medium hover:opacity-90 transition-opacity text-sm"
          >
            <Plus className="h-4 w-4" />
            Nova Proposta
          </button>
        </div>
      </div>

      {/* Proposals List */}
      <div
        className="bg-card rounded-xl border border-border overflow-hidden shadow-sm"
        data-tour="proposals-table"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-accent/50 border-b border-border">
                <th className="p-4 font-semibold text-sm">Nº / Título</th>
                <th className="p-4 font-semibold text-sm">Cliente</th>
                <th className="p-4 font-semibold text-sm">Data</th>
                <th className="p-4 font-semibold text-sm">Valor Líquido</th>
                <th className="p-4 font-semibold text-sm">Margem</th>
                <th className="p-4 font-semibold text-sm">Status</th>
                <th className="p-4 font-semibold text-sm text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center">
                    <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
                    <p className="mt-2 text-sm text-muted-foreground">Carregando propostas...</p>
                  </td>
                </tr>
              ) : filteredProposals.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-muted-foreground">
                    Nenhuma proposta encontrada.
                  </td>
                </tr>
              ) : (
                filteredProposals.map((p) => (
                  <tr key={p.id} className="hover:bg-accent/30 transition-colors group">
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                          <FileText className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="font-bold text-sm">#{p.number}</p>
                          <p className="text-xs text-muted-foreground truncate max-w-[150px]">{p.title || "Sem título"}</p>
                        </div>
                      </div>
                    </td>
                    <td className="p-4">
                      <p className="text-sm font-medium">{p.Customer?.companyName}</p>
                      <p className="text-[10px] text-muted-foreground">{p.Customer?.taxId}</p>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Calendar className="h-3 w-3" /> {new Date(p.createdAt).toLocaleDateString('pt-BR')}
                      </div>
                    </td>
                    <td className="p-4 font-mono text-sm font-bold">
                      {Number(p.totalNetValue).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                    </td>
                    <td className="p-4">
                      <div className={cn(
                        "text-xs font-bold",
                        Number(p.totalMarginPerc) >= 20 ? "text-green-600" : Number(p.totalMarginPerc) >= 10 ? "text-orange-600" : "text-red-600"
                      )}>
                        {Number(p.totalMarginPerc).toFixed(3)}%
                      </div>
                    </td>
                    <td className="p-4">
                      <div className={cn(
                        "inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
                        STATUS_CONFIG[p.status]?.color
                      )}>
                        {STATUS_CONFIG[p.status]?.label}
                      </div>
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setAnalysisProposalId(p.id)}
                          className="p-2 rounded-md hover:bg-accent text-muted-foreground hover:text-emerald-600 transition-all"
                          title="Análise (dashboard)"
                        >
                          <LayoutDashboard className="h-4 w-4" />
                        </button>
                        <button 
                          onClick={() => handleEdit(p.id)}
                          className="p-2 rounded-md hover:bg-accent text-muted-foreground hover:text-primary transition-all"
                          title="Editar"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button 
                          className="p-2 rounded-md hover:bg-accent text-muted-foreground hover:text-blue-500 transition-all"
                          title="Gerar PDF"
                        >
                          <Printer className="h-4 w-4" />
                        </button>
                        <button 
                          onClick={() => handleDelete(p.id)}
                          className="p-2 rounded-md hover:bg-accent text-muted-foreground hover:text-red-500 transition-all"
                          title="Excluir"
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

      <GuidedTour
        open={tourOpen}
        onClose={() => setTourOpen(false)}
        steps={PROPOSAL_TOUR_STEPS}
        tourName="Tour de Propostas"
      />

      <ProposalAnalysisModal
        open={analysisProposalId !== null}
        proposalId={analysisProposalId}
        onClose={() => setAnalysisProposalId(null)}
        onEdit={handleEdit}
      />
    </div>
  );
};
