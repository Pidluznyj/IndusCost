// src/components/CustomerModule.tsx
import React, { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { 
  Plus, 
  Search, 
  Edit2, 
  Trash2, 
  X,
  Loader2,
  Building2,
  Mail,
  Phone,
  MapPin,
  Globe,
  CheckCircle2,
  Download,
  BarChart3,
  SearchCheck,
  Sparkles,
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { buildCustomerIntelligencePath } from "@/src/lib/customerIntelligenceNavigation";
import { fetchJsonOk, fetchOk } from "@/src/lib/http";
import { Customer } from "@/src/types/commercial";
import { motion } from "motion/react";
import { DataImportDialog } from "./shared/DataImportDialog";
import { CustomerImportConfig } from "../lib/importer/CustomerConfig";
import { CustomerCommercial360 } from "./customers/CustomerCommercial360";
import { CustomerCommercialOwnerTab } from "./customers/CustomerCommercialOwnerTab";
import { CustomerCnpjIntelligencePanel } from "./customers/CustomerCnpjIntelligencePanel";
import { GuidedTour } from "@/src/components/tour/GuidedTour";
import { TourHelpButton } from "@/src/components/tour/TourHelpButton";
import { CUSTOMER_TOUR_STEPS } from "@/src/tours/customerTourSteps";
import { formatCustomerListRange } from "@/src/lib/customerListQuery";

type CustomerListMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

const CUSTOMER_PAGE_SIZE = 20;

type CustomerFormTab = "cadastro" | "commercial-owner";

const STICKY_ACTIONS =
  "sticky right-0 z-10 bg-card group-hover:bg-accent/30 shadow-[-6px_0_8px_-6px_rgba(0,0,0,0.12)]";
const STICKY_ACTIONS_HEAD = "sticky right-0 z-20 bg-accent/80 backdrop-blur-sm shadow-[-6px_0_8px_-6px_rgba(0,0,0,0.08)]";

export const CustomerModule = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<CustomerListMeta | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [commercial360CustomerId, setCommercial360CustomerId] = useState<string | null>(null);
  const [intelligenceOpen, setIntelligenceOpen] = useState(false);
  const [intelligenceCustomerId, setIntelligenceCustomerId] = useState<string | null>(null);
  const [intelligenceCnpj, setIntelligenceCnpj] = useState("");
  const [tourOpen, setTourOpen] = useState(false);
  const [formTab, setFormTab] = useState<CustomerFormTab>("cadastro");

  // Form State
  const [formData, setFormData] = useState<Partial<Customer>>({
    companyName: "",
    tradeName: "",
    taxId: "",
    stateTaxId: "",
    contactName: "",
    email: "",
    phone: "",
    address: "",
    city: "",
    state: "",
    zipCode: "",
    country: "Brasil",
    segment: "",
    notes: "",
    status: "ACTIVE"
  });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams();
      q.set("page", String(page));
      q.set("limit", String(CUSTOMER_PAGE_SIZE));
      if (debouncedSearch) q.set("search", debouncedSearch);
      const data = await fetchJsonOk<{
        items?: Customer[];
        customers?: Customer[];
        page?: number;
        limit?: number;
        total?: number;
        totalPages?: number;
      }>(`/api/customers?${q}`);
      const items = Array.isArray(data.items)
        ? data.items
        : Array.isArray(data.customers)
          ? data.customers
          : [];
      setCustomers(items);
      setPagination({
        page: data.page ?? page,
        limit: data.limit ?? CUSTOMER_PAGE_SIZE,
        total: data.total ?? items.length,
        totalPages: data.totalPages ?? 1,
      });
    } catch (error) {
      console.error("Erro ao buscar clientes:", error);
      alert(error instanceof Error ? error.message : "Não foi possível carregar clientes.");
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const handleOpenModal = (customer?: Customer) => {
    setFormTab("cadastro");
    if (customer) {
      setEditingCustomer(customer);
      setFormData(customer);
    } else {
      setEditingCustomer(null);
      setFormData({
        companyName: "",
        tradeName: "",
        taxId: "",
        stateTaxId: "",
        contactName: "",
        email: "",
        phone: "",
        address: "",
        city: "",
        state: "",
        zipCode: "",
        country: "Brasil",
        segment: "",
        notes: "",
        status: "ACTIVE"
      });
    }
    setIsModalOpen(true);
  };

  useEffect(() => {
    const editId = searchParams.get("edit")?.trim();
    if (!editId || loading) return;
    const found = customers.find((c) => c.id === editId);
    const clearEditParam = () => {
      const next = new URLSearchParams(searchParams);
      next.delete("edit");
      setSearchParams(next, { replace: true });
    };
    if (found) {
      handleOpenModal(found);
      clearEditParam();
      return;
    }
    void fetchJsonOk<{ customer: Customer }>(
      `/api/customers/${encodeURIComponent(editId)}/commercial-360`
    )
      .then(({ customer }) => {
        handleOpenModal(customer);
        clearEditParam();
      })
      .catch(() => {
        /* cliente não encontrado — ignora */
      });
  }, [searchParams, customers, loading, setSearchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const method = editingCustomer ? "PUT" : "POST";
    const url = editingCustomer ? `/api/customers/${editingCustomer.id}` : "/api/customers";

    try {
      await fetchJsonOk(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      setIsModalOpen(false);
      fetchData();
    } catch (error) {
      console.error("Erro ao salvar cliente:", error);
      alert(error instanceof Error ? error.message : "Não foi possível salvar o cliente.");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Tem certeza que deseja excluir este cliente?")) return;
    try {
      await fetchOk(`/api/customers/${id}`, { method: "DELETE" });
      fetchData();
    } catch (error) {
      console.error("Erro ao excluir cliente:", error);
      alert(error instanceof Error ? error.message : "Não foi possível excluir o cliente.");
    }
  };

  const openCnpjLookup = (opts?: { customer?: Customer | null; cnpj?: string }) => {
    setIntelligenceCustomerId(opts?.customer?.id ?? null);
    setIntelligenceCnpj(opts?.customer?.taxId ?? opts?.cnpj ?? "");
    setIntelligenceOpen(true);
  };

  const listRows = customers;

  return (
    <div className="space-y-6" data-tour="customers-root">
      {/* Header Actions */}
      <div
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-4"
        data-tour="customers-toolbar"
      >
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Buscar por razão social, nome fantasia ou CNPJ..."
            className="w-full pl-10 pr-4 py-2 rounded-lg border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-3">
          <TourHelpButton onClick={() => setTourOpen(true)} />
          <button
            type="button"
            onClick={() => openCnpjLookup()}
            className="flex items-center gap-2 bg-accent text-accent-foreground px-4 py-2 rounded-lg font-medium hover:opacity-90 transition-opacity text-sm"
          >
            <SearchCheck className="h-4 w-4" />
            Consultar CNPJ
          </button>
          <button 
            onClick={() => setIsImportOpen(true)}
            className="flex items-center gap-2 bg-accent text-accent-foreground px-4 py-2 rounded-lg font-medium hover:opacity-90 transition-opacity text-sm"
          >
            <Download className="h-4 w-4" />
            Importar
          </button>
          <button 
            onClick={() => handleOpenModal()}
            className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg font-medium hover:opacity-90 transition-opacity text-sm"
          >
            <Plus className="h-4 w-4" />
            Novo Cliente
          </button>
        </div>
      </div>

      {/* Import Dialog */}
      <DataImportDialog 
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        onSuccess={fetchData}
        config={CustomerImportConfig}
        templateUrl="/api/customers/import/template"
        previewUrl="/api/customers/import/preview"
        confirmUrl="/api/customers/import/confirm"
      />

      <CustomerCommercial360
        open={commercial360CustomerId != null}
        customerId={commercial360CustomerId}
        onClose={() => setCommercial360CustomerId(null)}
      />

      <CustomerCnpjIntelligencePanel
        open={intelligenceOpen}
        onClose={() => setIntelligenceOpen(false)}
        stacked={isModalOpen}
        customerId={intelligenceCustomerId}
        initialCnpj={intelligenceCnpj}
        onCustomerUpdated={fetchData}
        onCreatePrefill={(draft) => {
          setEditingCustomer(null);
          setFormData({ ...formData, ...draft, country: draft.country ?? "Brasil", status: draft.status ?? "ACTIVE" });
          setIsModalOpen(true);
        }}
        onOpenExistingCustomer={(id) => {
          const existing = customers.find((c) => c.id === id);
          if (existing) handleOpenModal(existing);
          else {
            setIntelligenceCustomerId(id);
            setIntelligenceOpen(true);
          }
        }}
      />

      {/* Table */}
      <div
        className="bg-card rounded-xl border border-border overflow-hidden shadow-sm flex flex-col"
        data-tour="customers-table"
      >
        <div className="overflow-x-auto overflow-y-auto max-h-[min(70vh,640px)]">
          <table className="w-full min-w-[880px] text-left border-collapse">
            <thead className="sticky top-0 z-30">
              <tr className="bg-accent/80 backdrop-blur-sm border-b border-border">
                <th className="px-3 py-2 font-semibold text-xs whitespace-nowrap">Cliente</th>
                <th className="px-3 py-2 font-semibold text-xs whitespace-nowrap">Documento</th>
                <th className="px-3 py-2 font-semibold text-xs whitespace-nowrap max-w-[180px]">Contato</th>
                <th className="px-3 py-2 font-semibold text-xs whitespace-nowrap max-w-[160px]">Localização</th>
                <th className="px-3 py-2 font-semibold text-xs whitespace-nowrap">Status</th>
                <th className={cn("px-3 py-2 font-semibold text-xs text-right whitespace-nowrap", STICKY_ACTIONS_HEAD)}>
                  Ações
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto text-primary" />
                    <p className="mt-2 text-xs text-muted-foreground">Carregando clientes...</p>
                  </td>
                </tr>
              ) : listRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-sm text-muted-foreground">
                    Nenhum cliente encontrado.
                  </td>
                </tr>
              ) : (
                listRows.map((c) => (
                  <tr key={c.id} className="hover:bg-accent/30 transition-colors group">
                    <td className="px-3 py-1.5 max-w-[220px]">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="h-7 w-7 shrink-0 rounded-md bg-primary/10 flex items-center justify-center text-primary">
                          <Building2 className="h-3.5 w-3.5" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-xs truncate" title={c.companyName}>
                            {c.companyName}
                          </p>
                          <p className="text-[11px] text-muted-foreground truncate" title={c.tradeName ?? undefined}>
                            {c.tradeName || "—"}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-1.5 text-xs font-mono whitespace-nowrap">{c.taxId}</td>
                    <td className="px-3 py-1.5 max-w-[180px]">
                      <div className="space-y-0.5 min-w-0">
                        <div className="flex items-center gap-1 text-[11px] text-muted-foreground min-w-0">
                          <Mail className="h-3 w-3 shrink-0" />
                          <span className="truncate" title={c.email ?? undefined}>
                            {c.email || "—"}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 text-[11px] text-muted-foreground min-w-0">
                          <Phone className="h-3 w-3 shrink-0" />
                          <span className="truncate" title={c.phone ?? undefined}>
                            {c.phone || "—"}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-1.5 max-w-[160px]">
                      <p className="text-[11px] font-medium truncate" title={`${c.city ?? ""} - ${c.state ?? ""}`}>
                        {c.city || "—"} - {c.state || "—"}
                      </p>
                      <p className="text-[10px] text-muted-foreground truncate" title={c.segment ?? undefined}>
                        {c.segment || "Sem segmento"}
                      </p>
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      <div
                        className={cn(
                          "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider",
                          c.status === "ACTIVE" ? "bg-green-500/10 text-green-600" : "bg-red-500/10 text-red-600"
                        )}
                      >
                        <div
                          className={cn(
                            "h-1.5 w-1.5 rounded-full",
                            c.status === "ACTIVE" ? "bg-green-600" : "bg-red-600"
                          )}
                        />
                        {c.status === "ACTIVE" ? "Ativo" : "Inativo"}
                      </div>
                    </td>
                    <td className={cn("px-2 py-1.5 text-right whitespace-nowrap", STICKY_ACTIONS)}>
                      <div className="flex items-center justify-end gap-0.5">
                        <button
                          type="button"
                          title="Consulta CNPJ"
                          onClick={() => openCnpjLookup({ customer: c })}
                          className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-primary transition-all"
                        >
                          <SearchCheck className="h-3.5 w-3.5" />
                        </button>
                        <Link
                          to={buildCustomerIntelligencePath(c.id)}
                          title="Inteligência do Cliente"
                          className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-primary transition-all"
                        >
                          <Sparkles className="h-3.5 w-3.5" />
                        </Link>
                        <button
                          type="button"
                          title="Visão comercial do cliente"
                          onClick={() => setCommercial360CustomerId(c.id)}
                          className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-primary transition-all"
                        >
                          <BarChart3 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          title="Editar cliente"
                          onClick={() => handleOpenModal(c)}
                          className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-primary transition-all"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          title="Excluir cliente"
                          onClick={() => handleDelete(c.id)}
                          className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-red-500 transition-all"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {pagination && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2 text-xs text-muted-foreground">
            <span>
              {formatCustomerListRange(pagination)}
              {pagination.totalPages > 1 ? ` · Página ${pagination.page} de ${pagination.totalPages}` : ""}
            </span>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                className="rounded-md border border-border px-2.5 py-1 disabled:opacity-50 hover:bg-accent"
                disabled={loading || pagination.page <= 1}
                onClick={() => setPage(1)}
              >
                Primeira
              </button>
              <button
                type="button"
                className="rounded-md border border-border px-2.5 py-1 disabled:opacity-50 hover:bg-accent"
                disabled={loading || pagination.page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Anterior
              </button>
              <button
                type="button"
                className="rounded-md border border-border px-2.5 py-1 disabled:opacity-50 hover:bg-accent"
                disabled={loading || pagination.page >= pagination.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Próxima
              </button>
              <button
                type="button"
                className="rounded-md border border-border px-2.5 py-1 disabled:opacity-50 hover:bg-accent"
                disabled={loading || pagination.page >= pagination.totalPages}
                onClick={() => setPage(pagination.totalPages)}
              >
                Última
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modal: Customer Form */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-card w-full max-w-4xl rounded-2xl border border-border shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
          >
            <div className="p-6 border-b border-border flex items-center justify-between gap-3 bg-accent/30">
              <h3 className="text-xl font-bold">{editingCustomer ? "Editar Cliente" : "Novo Cliente"}</h3>
              <div className="flex items-center gap-2 shrink-0">
                {editingCustomer && (
                  <>
                    <button
                      type="button"
                      onClick={() => openCnpjLookup({ customer: editingCustomer })}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border border-border bg-background hover:bg-accent text-foreground transition-colors"
                    >
                      <SearchCheck className="h-4 w-4 text-primary" />
                      Consulta CNPJ
                    </button>
                    <button
                      type="button"
                      onClick={() => setCommercial360CustomerId(editingCustomer.id)}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border border-border bg-background hover:bg-accent text-foreground transition-colors"
                    >
                      <BarChart3 className="h-4 w-4 text-primary" />
                      Visão comercial
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="p-2 hover:bg-accent rounded-full transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {editingCustomer ? (
              <div className="px-6 pt-4 border-b border-border flex gap-1">
                <button
                  type="button"
                  onClick={() => setFormTab("cadastro")}
                  className={cn(
                    "px-4 py-2 text-sm font-medium rounded-t-lg border border-b-0 transition-colors",
                    formTab === "cadastro"
                      ? "bg-card border-border text-foreground"
                      : "bg-transparent border-transparent text-muted-foreground hover:text-foreground"
                  )}
                >
                  Dados cadastrais
                </button>
                <button
                  type="button"
                  onClick={() => setFormTab("commercial-owner")}
                  className={cn(
                    "px-4 py-2 text-sm font-medium rounded-t-lg border border-b-0 transition-colors",
                    formTab === "commercial-owner"
                      ? "bg-card border-border text-foreground"
                      : "bg-transparent border-transparent text-muted-foreground hover:text-foreground"
                  )}
                >
                  Responsável Comercial
                </button>
              </div>
            ) : null}
            
            {formTab === "commercial-owner" && editingCustomer ? (
              <div className="flex-1 overflow-y-auto p-6">
                <CustomerCommercialOwnerTab customerId={editingCustomer.id} />
              </div>
            ) : (
            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Basic Info */}
                <div className="space-y-4">
                  <h4 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                    <Building2 className="h-4 w-4" /> Identificação
                  </h4>
                  <div className="grid grid-cols-1 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-muted-foreground uppercase">Razão Social</label>
                      <input
                        required
                        type="text"
                        className="w-full p-2 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm"
                        value={formData.companyName}
                        onChange={(e) => setFormData({...formData, companyName: e.target.value})}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-muted-foreground uppercase">Nome Fantasia</label>
                      <input
                        type="text"
                        className="w-full p-2 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm"
                        value={formData.tradeName}
                        onChange={(e) => setFormData({...formData, tradeName: e.target.value})}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-muted-foreground uppercase">CNPJ / CPF</label>
                        <input
                          required
                          type="text"
                          className="w-full p-2 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm font-mono"
                          value={formData.taxId}
                          onChange={(e) => setFormData({...formData, taxId: e.target.value})}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-muted-foreground uppercase">Insc. Estadual</label>
                        <input
                          type="text"
                          className="w-full p-2 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm font-mono"
                          value={formData.stateTaxId}
                          onChange={(e) => setFormData({...formData, stateTaxId: e.target.value})}
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-muted-foreground uppercase">Segmento</label>
                      <input
                        type="text"
                        placeholder="Ex: Automotivo, Alimentos, etc."
                        className="w-full p-2 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm"
                        value={formData.segment}
                        onChange={(e) => setFormData({...formData, segment: e.target.value})}
                      />
                    </div>
                  </div>
                </div>

                {/* Contact & Address */}
                <div className="space-y-4">
                  <h4 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                    <Mail className="h-4 w-4" /> Contato e Endereço
                  </h4>
                  <div className="grid grid-cols-1 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-muted-foreground uppercase">Nome do Contato</label>
                      <input
                        type="text"
                        className="w-full p-2 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm"
                        value={formData.contactName}
                        onChange={(e) => setFormData({...formData, contactName: e.target.value})}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-muted-foreground uppercase">E-mail</label>
                        <input
                          type="email"
                          className="w-full p-2 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm"
                          value={formData.email}
                          onChange={(e) => setFormData({...formData, email: e.target.value})}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-muted-foreground uppercase">Telefone</label>
                        <input
                          type="text"
                          className="w-full p-2 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm"
                          value={formData.phone}
                          onChange={(e) => setFormData({...formData, phone: e.target.value})}
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-muted-foreground uppercase">Endereço Completo</label>
                      <input
                        type="text"
                        className="w-full p-2 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm"
                        value={formData.address}
                        onChange={(e) => setFormData({...formData, address: e.target.value})}
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="col-span-1 space-y-1.5">
                        <label className="text-xs font-bold text-muted-foreground uppercase">CEP</label>
                        <input
                          type="text"
                          className="w-full p-2 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm font-mono"
                          value={formData.zipCode}
                          onChange={(e) => setFormData({...formData, zipCode: e.target.value})}
                        />
                      </div>
                      <div className="col-span-1 space-y-1.5">
                        <label className="text-xs font-bold text-muted-foreground uppercase">Cidade</label>
                        <input
                          type="text"
                          className="w-full p-2 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm"
                          value={formData.city}
                          onChange={(e) => setFormData({...formData, city: e.target.value})}
                        />
                      </div>
                      <div className="col-span-1 space-y-1.5">
                        <label className="text-xs font-bold text-muted-foreground uppercase">Estado (UF)</label>
                        <input
                          type="text"
                          maxLength={2}
                          className="w-full p-2 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm uppercase"
                          value={formData.state}
                          onChange={(e) => setFormData({...formData, state: e.target.value})}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground uppercase">Observações Comerciais</label>
                <textarea
                  rows={3}
                  className="w-full p-2 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm resize-none"
                  value={formData.notes}
                  onChange={(e) => setFormData({...formData, notes: e.target.value})}
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-6 border-t border-border">
                <button 
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-6 py-2 rounded-lg font-medium hover:bg-accent transition-colors text-sm"
                >
                  Cancelar
                </button>
                <button 
                  type="submit"
                  className="px-8 py-2 rounded-lg font-bold bg-primary text-primary-foreground hover:opacity-90 transition-opacity text-sm"
                >
                  {editingCustomer ? "Salvar Alterações" : "Cadastrar Cliente"}
                </button>
              </div>
            </form>
            )}
          </motion.div>
        </div>
      )}

      <GuidedTour
        open={tourOpen}
        onClose={() => setTourOpen(false)}
        steps={CUSTOMER_TOUR_STEPS}
        tourName="Tour de Clientes"
      />
    </div>
  );
};
