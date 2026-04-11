// src/components/CustomerModule.tsx
import React, { useEffect, useState } from "react";
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
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { fetchJsonOk, fetchOk } from "@/src/lib/http";
import { Customer } from "@/src/types/commercial";
import { motion } from "motion/react";
import { DataImportDialog } from "./shared/DataImportDialog";
import { CustomerImportConfig } from "../lib/importer/CustomerConfig";
import { CustomerCommercial360 } from "./customers/CustomerCommercial360";

export const CustomerModule = () => {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [commercial360CustomerId, setCommercial360CustomerId] = useState<string | null>(null);

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

  const fetchData = async () => {
    setLoading(true);
    try {
      const data = await fetchJsonOk<Customer[]>("/api/customers");
      setCustomers(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Erro ao buscar clientes:", error);
      alert(error instanceof Error ? error.message : "Não foi possível carregar clientes.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleOpenModal = (customer?: Customer) => {
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

  const filteredCustomers = customers.filter(c => 
    (c.companyName ?? "").toLowerCase().includes(searchTerm.toLowerCase()) ||
    (c.taxId ?? "").includes(searchTerm) ||
    (c.tradeName?.toLowerCase() || "").includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
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

      {/* Table */}
      <div className="bg-card rounded-xl border border-border overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-accent/50 border-b border-border">
                <th className="p-4 font-semibold text-sm">Cliente</th>
                <th className="p-4 font-semibold text-sm">Documento</th>
                <th className="p-4 font-semibold text-sm">Contato</th>
                <th className="p-4 font-semibold text-sm">Localização</th>
                <th className="p-4 font-semibold text-sm">Status</th>
                <th className="p-4 font-semibold text-sm text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center">
                    <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
                    <p className="mt-2 text-sm text-muted-foreground">Carregando clientes...</p>
                  </td>
                </tr>
              ) : filteredCustomers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-muted-foreground">
                    Nenhum cliente encontrado.
                  </td>
                </tr>
              ) : (
                filteredCustomers.map((c) => (
                  <tr key={c.id} className="hover:bg-accent/30 transition-colors group">
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                          <Building2 className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="font-medium text-sm">{c.companyName}</p>
                          <p className="text-xs text-muted-foreground">{c.tradeName || "---"}</p>
                        </div>
                      </div>
                    </td>
                    <td className="p-4 text-sm font-mono">{c.taxId}</td>
                    <td className="p-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Mail className="h-3 w-3" /> {c.email || "---"}
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Phone className="h-3 w-3" /> {c.phone || "---"}
                        </div>
                      </div>
                    </td>
                    <td className="p-4">
                      <p className="text-xs font-medium">{c.city} - {c.state}</p>
                      <p className="text-[10px] text-muted-foreground">{c.segment || "Sem segmento"}</p>
                    </td>
                    <td className="p-4">
                      <div className={cn(
                        "inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
                        c.status === "ACTIVE" ? "bg-green-500/10 text-green-600" : "bg-red-500/10 text-red-600"
                      )}>
                        <div className={cn("h-1.5 w-1.5 rounded-full", c.status === "ACTIVE" ? "bg-green-600" : "bg-red-600")} />
                        {c.status === "ACTIVE" ? "Ativo" : "Inativo"}
                      </div>
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          title="Visão comercial do cliente"
                          onClick={() => setCommercial360CustomerId(c.id)}
                          className="p-2 rounded-md hover:bg-accent text-muted-foreground hover:text-primary transition-all"
                        >
                          <BarChart3 className="h-4 w-4" />
                        </button>
                        <button 
                          onClick={() => handleOpenModal(c)}
                          className="p-2 rounded-md hover:bg-accent text-muted-foreground hover:text-primary transition-all"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button 
                          onClick={() => handleDelete(c.id)}
                          className="p-2 rounded-md hover:bg-accent text-muted-foreground hover:text-red-500 transition-all"
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
                  <button
                    type="button"
                    onClick={() => setCommercial360CustomerId(editingCustomer.id)}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border border-border bg-background hover:bg-accent text-foreground transition-colors"
                  >
                    <BarChart3 className="h-4 w-4 text-primary" />
                    Visão comercial
                  </button>
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
          </motion.div>
        </div>
      )}
    </div>
  );
};
