import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { 
  Plus, 
  Search, 
  Edit2, 
  UserMinus, 
  UserCheck, 
  X,
  Loader2,
  PieChart,
  Info,
  Settings,
  Eye,
  EyeOff,
  User
} from "lucide-react";
import { cn, formatCurrency, formatNumber } from "@/src/lib/utils";
import { fetchJsonOk, fetchOk } from "@/src/lib/http";
import { Employee, Role, CreateEmployeeInput, PayrollComponent } from "@/src/types/employee";
import {
  CONTRACT_TYPE_OPTIONS,
  createEmptyEmployeeForm,
  displayText,
  employeeToFormData,
  formatContractType,
  formatEmployeeDate,
} from "@/src/lib/employeeHrUi";
import { motion } from "motion/react";
import { SearchableSelect } from "./shared/SearchableSelect";
import { GuidedTour } from "@/src/components/tour/GuidedTour";
import { TourHelpButton } from "@/src/components/tour/TourHelpButton";
import { EMPLOYEE_TOUR_STEPS } from "@/src/tours/employeeTourSteps";
import { useAuth } from "@/src/contexts/AuthContext";

const EMPLOYEE_CLASSIFICATION_OPTIONS = [
  { value: "DIRETO", label: "Direto", searchTerms: "DIRETO direto" },
  { value: "INDIRETO", label: "Indireto", searchTerms: "INDIRETO indireto" },
  { value: "APOIO", label: "Apoio", searchTerms: "APOIO apoio" },
];

const PAYROLL_TYPE_OPTIONS = [
  { value: "BENEFIT", label: "Benefício", searchTerms: "BENEFIT beneficio benefício" },
  { value: "CHARGE", label: "Encargo", searchTerms: "CHARGE encargo" },
  { value: "PROVISION", label: "Provisão", searchTerms: "PROVISION provisão provisao" },
];

const PAYROLL_CALC_OPTIONS = [
  { value: "PERCENTAGE", label: "Percentual (%)", searchTerms: "PERCENTAGE percentual" },
  { value: "FIXED", label: "Valor Fixo (R$)", searchTerms: "FIXED fixo" },
];

const INPUT_CLASS =
  "w-full p-2 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm";

const TEXTAREA_CLASS =
  "w-full p-2 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm min-h-[88px] resize-y";

export const EmployeeModule = () => {
  const auth = useAuth();
  const canEdit = auth.hasPermission("employees.edit");
  const canAccessOperationalSettings = auth.hasAnyPermission([
    "settings.operational.view",
    "settings.operational.manage",
    "settings.view",
  ]);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [payrollComponents, setPayrollComponents] = useState<PayrollComponent[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [listClassificationFilter, setListClassificationFilter] = useState<"" | CreateEmployeeInput["classification"]>("");
  const [listStatusFilter, setListStatusFilter] = useState<"" | "ACTIVE" | "INACTIVE">("");
  const [showLegacyEstimates, setShowLegacyEstimates] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [isComponentModalOpen, setIsComponentModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [viewingEmployee, setViewingEmployee] = useState<Employee | null>(null);

  // Form State
  const [formData, setFormData] = useState<CreateEmployeeInput>(createEmptyEmployeeForm());

  const [compFormData, setCompFormData] = useState({
    name: "",
    type: "BENEFIT",
    calculationType: "PERCENTAGE",
    value: 0,
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const [empData, roleData, compData] = await Promise.all([
        fetchJsonOk<Employee[]>("/api/employees"),
        fetchJsonOk<Role[]>("/api/roles"),
        fetchJsonOk<PayrollComponent[]>("/api/payroll-components"),
      ]);
      setEmployees(Array.isArray(empData) ? empData : []);
      setRoles(Array.isArray(roleData) ? roleData : []);
      setPayrollComponents(Array.isArray(compData) ? compData : []);
    } catch (error) {
      console.error("Erro ao buscar dados:", error);
      alert(error instanceof Error ? error.message : "Não foi possível carregar colaboradores.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleOpenModal = (employee?: Employee) => {
    if (employee) {
      setEditingEmployee(employee);
      setFormData(employeeToFormData(employee));
    } else {
      setEditingEmployee(null);
      setFormData(createEmptyEmployeeForm(roles[0]?.id || ""));
    }
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const method = editingEmployee ? "PUT" : "POST";
    const url = editingEmployee ? `/api/employees/${editingEmployee.id}` : "/api/employees";

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
      alert(error instanceof Error ? error.message : "Não foi possível salvar o colaborador.");
    }
  };

  const handleComponentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await fetchJsonOk("/api/payroll-components", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(compFormData),
      });
      setIsComponentModalOpen(false);
      fetchData();
    } catch (error) {
      console.error("Erro ao salvar componente:", error);
      alert(error instanceof Error ? error.message : "Não foi possível salvar o componente de folha.");
    }
  };

  const toggleComponent = (id: string) => {
    const current = formData.componentIds || [];
    if (current.includes(id)) {
      setFormData({ ...formData, componentIds: current.filter(c => c !== id) });
    } else {
      setFormData({ ...formData, componentIds: [...current, id] });
    }
  };

  const toggleStatus = async (id: string, currentStatus: string) => {
    const newStatus = currentStatus === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    try {
      await fetchOk(`/api/employees/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      fetchData();
    } catch (error) {
      console.error("Erro ao alterar status:", error);
      alert(error instanceof Error ? error.message : "Não foi possível alterar o status.");
    }
  };

  const filteredEmployees = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return employees.filter((emp) => {
      if (listClassificationFilter && emp.classification !== listClassificationFilter) return false;
      if (listStatusFilter && emp.status !== listStatusFilter) return false;
      if (!q) return true;
      return (
        (emp.name ?? "").toLowerCase().includes(q) ||
        (emp.socialName ?? "").toLowerCase().includes(q) ||
        (emp.Role?.name ?? "").toLowerCase().includes(q) ||
        (emp.department ?? "").toLowerCase().includes(q)
      );
    });
  }, [employees, searchTerm, listClassificationFilter, listStatusFilter]);

  const clearListFilters = () => {
    setSearchTerm("");
    setListClassificationFilter("");
    setListStatusFilter("");
  };

  const tableColSpan = 6 + (showLegacyEstimates ? 3 : 0);

  return (
    <div className="space-y-6" data-tour="employees-root">
      <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 flex gap-3 items-start">
        <Info className="h-5 w-5 text-primary shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">Módulo administrativo de Pessoas/RH</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            As informações desta tela não alteram o CIU, o custo dos produtos, o HH global, roteiros de produção,
            formação de preço ou integrações Nomus.
          </p>
        </div>
      </div>

      {canAccessOperationalSettings && (
        <div className="rounded-xl border border-dashed border-border bg-card px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Cargos e verbas (estrutura legada/operacional)</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Cargos e verbas globais continuam em Configurações → Operacional. Alterações lá podem impactar
              roteiros e cálculos industriais existentes.
            </p>
          </div>
          <Link
            to="/settings"
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-background hover:bg-accent transition-colors text-sm font-medium shrink-0"
          >
            <Settings className="h-4 w-4" />
            Abrir Configurações
          </Link>
        </div>
      )}

      {/* Header Actions */}
      <div
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-4"
        data-tour="employees-toolbar"
      >
        <div className="flex-1 flex flex-col gap-2">
          <div className="flex flex-col lg:flex-row lg:items-center gap-2">
            <div className="relative flex-1 max-w-md min-w-[260px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Buscar por nome, cargo ou setor..."
                className="w-full pl-10 pr-4 py-2 rounded-lg border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>

            <select
              className="min-w-[170px] rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none"
              value={listClassificationFilter}
              onChange={(e) => setListClassificationFilter(e.target.value as any)}
            >
              <option value="">Todas as classificações</option>
              {EMPLOYEE_CLASSIFICATION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>

            <select
              className="min-w-[150px] rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none"
              value={listStatusFilter}
              onChange={(e) => setListStatusFilter(e.target.value as any)}
            >
              <option value="">Todos os status</option>
              <option value="ACTIVE">Ativo</option>
              <option value="INACTIVE">Inativo</option>
            </select>

            <button
              type="button"
              onClick={clearListFilters}
              disabled={!searchTerm.trim() && !listClassificationFilter && !listStatusFilter}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card hover:bg-accent transition-colors text-sm font-medium disabled:opacity-50 disabled:hover:bg-card"
              title="Limpar filtros"
            >
              <X className="h-4 w-4" />
              Limpar
            </button>
          </div>

          <p className="text-xs text-muted-foreground">
            Exibindo <span className="font-bold text-foreground">{filteredEmployees.length}</span> de{" "}
            <span className="font-bold text-foreground">{employees.length}</span> colaborador(es).
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <TourHelpButton onClick={() => setTourOpen(true)} />
          <button
            type="button"
            onClick={() => setShowLegacyEstimates((v) => !v)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card hover:bg-accent transition-colors text-sm font-medium"
            title="Mostrar ou ocultar colunas de estimativa legada"
          >
            {showLegacyEstimates ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            {showLegacyEstimates ? "Ocultar estimativas" : "Mostrar estimativas"}
          </button>
          {canEdit && (
            <>
              <button 
                onClick={() => setIsComponentModalOpen(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-card hover:bg-accent transition-colors text-sm font-medium"
              >
                <PieChart className="h-4 w-4" />
                Configurar Verbas
              </button>
              <button 
                onClick={() => handleOpenModal()}
                className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg font-medium hover:opacity-90 transition-opacity text-sm"
              >
                <Plus className="h-4 w-4" />
                Novo Colaborador
              </button>
            </>
          )}
        </div>
      </div>

      {/* Table */}
      <div
        className="bg-card rounded-xl border border-border overflow-hidden shadow-sm"
        data-tour="employees-table"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-accent/50 border-b border-border">
                <th className="p-4 font-semibold text-sm">Colaborador</th>
                <th className="p-4 font-semibold text-sm">Cargo / Setor</th>
                <th className="p-4 font-semibold text-sm">Contrato</th>
                <th className="p-4 font-semibold text-sm">Admissão</th>
                {showLegacyEstimates && (
                  <>
                    <th className="p-4 font-semibold text-sm text-muted-foreground">Ref. salarial</th>
                    <th className="p-4 font-semibold text-sm text-muted-foreground">Estimativa mensal</th>
                    <th className="p-4 font-semibold text-sm text-muted-foreground text-center">Estimativa /h prod.</th>
                  </>
                )}
                <th className="p-4 font-semibold text-sm">Status</th>
                <th className="p-4 font-semibold text-sm text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={tableColSpan} className="p-8 text-center">
                    <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
                    <p className="mt-2 text-sm text-muted-foreground">Carregando colaboradores...</p>
                  </td>
                </tr>
              ) : filteredEmployees.length === 0 ? (
                <tr>
                  <td colSpan={tableColSpan} className="p-8 text-center text-muted-foreground">
                    Nenhum colaborador encontrado.
                  </td>
                </tr>
              ) : (
                filteredEmployees.map((emp) => (
                  <tr key={emp.id} className="hover:bg-accent/30 transition-colors group">
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary text-xs">
                          {emp.name.split(" ").map(n => n[0]).join("").substring(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium text-sm">{emp.name}</p>
                          {emp.socialName?.trim() && (
                            <p className="text-xs text-muted-foreground">Apelido: {emp.socialName}</p>
                          )}
                          <p className="text-xs text-muted-foreground">{emp.costCenter}</p>
                        </div>
                      </div>
                    </td>
                    <td className="p-4">
                      <p className="text-sm font-medium">{emp.Role.name}</p>
                      <p className="text-xs text-muted-foreground">{emp.department}</p>
                    </td>
                    <td className="p-4">
                      <p className="text-sm">{formatContractType(emp.contractType)}</p>
                    </td>
                    <td className="p-4">
                      <p className="text-sm">{formatEmployeeDate(emp.admissionDate)}</p>
                    </td>
                    {showLegacyEstimates && (
                      <>
                        <td className="p-4">
                          <p className="text-sm text-muted-foreground">{formatCurrency(emp.salary)}</p>
                          <p className="text-[10px] text-muted-foreground">{emp.monthlyHours}h/mês · ref. admin.</p>
                        </td>
                        <td className="p-4">
                          <p className="text-sm text-muted-foreground">{formatCurrency(emp.costs?.totalMonthlyCost || 0)}</p>
                          <p className="text-[10px] text-muted-foreground">Estimativa legada</p>
                        </td>
                        <td className="p-4 text-center">
                          <p className="text-sm text-muted-foreground">{formatCurrency(emp.costs?.costPerProductiveHour || 0, 5)}</p>
                          <p className="text-[10px] text-muted-foreground">{formatNumber(emp.productivity, 2)}% prod.</p>
                        </td>
                      </>
                    )}
                    <td className="p-4">
                      <div className={cn(
                        "inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
                        emp.status === "ACTIVE" ? "bg-green-500/10 text-green-600" : "bg-red-500/10 text-red-600"
                      )}>
                        <div className={cn("h-1.5 w-1.5 rounded-full", emp.status === "ACTIVE" ? "bg-green-600" : "bg-red-600")} />
                        {emp.status === "ACTIVE" ? "Ativo" : "Inativo"}
                      </div>
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button 
                          onClick={() => setViewingEmployee(emp)}
                          className="p-2 rounded-md hover:bg-accent text-muted-foreground hover:text-primary transition-all"
                          title="Ver ficha do colaborador"
                        >
                          <User className="h-4 w-4" />
                        </button>
                        {canEdit && (
                          <>
                            <button 
                              onClick={() => handleOpenModal(emp)}
                              className="p-2 rounded-md hover:bg-accent text-muted-foreground hover:text-primary transition-all"
                              title="Editar"
                            >
                              <Edit2 className="h-4 w-4" />
                            </button>
                            <button 
                              onClick={() => toggleStatus(emp.id, emp.status)}
                              className={cn(
                                "p-2 rounded-md hover:bg-accent transition-all",
                                emp.status === "ACTIVE" ? "text-red-500" : "text-green-500"
                              )}
                              title={emp.status === "ACTIVE" ? "Inativar" : "Ativar"}
                            >
                              {emp.status === "ACTIVE" ? <UserMinus className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Employee Form */}
      {isModalOpen && canEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-card w-full max-w-4xl rounded-2xl border border-border shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
          >
            <div className="p-6 border-b border-border flex items-center justify-between bg-accent/30">
              <h3 className="text-xl font-bold">{editingEmployee ? "Editar Colaborador" : "Novo Colaborador"}</h3>
              <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-accent rounded-full transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>
            
            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
              <p className="text-xs text-muted-foreground rounded-lg border border-border bg-muted/30 px-3 py-2">
                Dados pessoais e administrativos devem ser acessados apenas por pessoas autorizadas do RH.
              </p>

              <div className="space-y-4 rounded-xl border border-border p-5 bg-background">
                <h4 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">1. Dados profissionais</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5 md:col-span-2">
                    <label className="text-xs font-bold text-muted-foreground uppercase">Nome completo</label>
                    <input required type="text" className={INPUT_CLASS} value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} />
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <label className="text-xs font-bold text-muted-foreground uppercase">Nome social / apelido</label>
                    <input type="text" className={INPUT_CLASS} value={formData.socialName ?? ""} onChange={(e) => setFormData({ ...formData, socialName: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase">Cargo</label>
                    <SearchableSelect required placeholder="Selecione o cargo..." options={roles.map((role) => ({ value: role.id, label: role.name, searchTerms: role.name }))} value={formData.roleId} onChange={(v) => setFormData({ ...formData, roleId: v })} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase">Departamento / setor</label>
                    <input required type="text" className={INPUT_CLASS} value={formData.department} onChange={(e) => setFormData({ ...formData, department: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase">Centro de custo</label>
                    <input required type="text" className={INPUT_CLASS} value={formData.costCenter} onChange={(e) => setFormData({ ...formData, costCenter: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase">Classificação</label>
                    <SearchableSelect required placeholder="Classificação..." options={EMPLOYEE_CLASSIFICATION_OPTIONS} value={formData.classification} onChange={(v) => setFormData({ ...formData, classification: v })} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase">Tipo de contrato</label>
                    <SearchableSelect placeholder="Tipo de contrato..." options={CONTRACT_TYPE_OPTIONS} value={formData.contractType ?? ""} onChange={(v) => setFormData({ ...formData, contractType: v })} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase">Gestor responsável</label>
                    <input type="text" className={INPUT_CLASS} value={formData.managerName ?? ""} onChange={(e) => setFormData({ ...formData, managerName: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase">Data de admissão</label>
                    <input type="date" className={INPUT_CLASS} value={formData.admissionDate ?? ""} onChange={(e) => setFormData({ ...formData, admissionDate: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase">Data de desligamento</label>
                    <input type="date" className={INPUT_CLASS} value={formData.terminationDate ?? ""} onChange={(e) => setFormData({ ...formData, terminationDate: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase">Status</label>
                    <select className={INPUT_CLASS} value={formData.status ?? "ACTIVE"} onChange={(e) => setFormData({ ...formData, status: e.target.value as CreateEmployeeInput["status"] })}>
                      <option value="ACTIVE">Ativo</option>
                      <option value="INACTIVE">Inativo</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="space-y-4 rounded-xl border border-border p-5 bg-background">
                <h4 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">2. Dados pessoais</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase">CPF</label>
                    <input type="text" className={INPUT_CLASS} value={formData.cpf ?? ""} onChange={(e) => setFormData({ ...formData, cpf: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase">RG</label>
                    <input type="text" className={INPUT_CLASS} value={formData.rg ?? ""} onChange={(e) => setFormData({ ...formData, rg: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase">Data de nascimento</label>
                    <input type="date" className={INPUT_CLASS} value={formData.birthDate ?? ""} onChange={(e) => setFormData({ ...formData, birthDate: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase">Telefone</label>
                    <input type="tel" className={INPUT_CLASS} value={formData.phone ?? ""} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} />
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <label className="text-xs font-bold text-muted-foreground uppercase">E-mail pessoal</label>
                    <input type="email" className={INPUT_CLASS} value={formData.personalEmail ?? ""} onChange={(e) => setFormData({ ...formData, personalEmail: e.target.value })} />
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <label className="text-xs font-bold text-muted-foreground uppercase">Endereço</label>
                    <textarea className={TEXTAREA_CLASS} value={formData.address ?? ""} onChange={(e) => setFormData({ ...formData, address: e.target.value })} />
                  </div>
                </div>
              </div>

              <div className="space-y-4 rounded-xl border border-border p-5 bg-background">
                <h4 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">3. Contato de emergência</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5 md:col-span-2">
                    <label className="text-xs font-bold text-muted-foreground uppercase">Nome</label>
                    <input type="text" className={INPUT_CLASS} value={formData.emergencyContactName ?? ""} onChange={(e) => setFormData({ ...formData, emergencyContactName: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase">Telefone</label>
                    <input type="tel" className={INPUT_CLASS} value={formData.emergencyContactPhone ?? ""} onChange={(e) => setFormData({ ...formData, emergencyContactPhone: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase">Grau / relação</label>
                    <input type="text" className={INPUT_CLASS} value={formData.emergencyContactRelationship ?? ""} onChange={(e) => setFormData({ ...formData, emergencyContactRelationship: e.target.value })} />
                  </div>
                </div>
              </div>

              <div className="space-y-4 rounded-xl border border-border p-5 bg-background">
                <h4 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">4. EPI / Uniformes</h4>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase">Camiseta / camisa</label>
                    <input type="text" className={INPUT_CLASS} value={formData.shirtSize ?? ""} onChange={(e) => setFormData({ ...formData, shirtSize: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase">Calça</label>
                    <input type="text" className={INPUT_CLASS} value={formData.pantsSize ?? ""} onChange={(e) => setFormData({ ...formData, pantsSize: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase">Jaqueta / blusa</label>
                    <input type="text" className={INPUT_CLASS} value={formData.jacketSize ?? ""} onChange={(e) => setFormData({ ...formData, jacketSize: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase">Luva</label>
                    <input type="text" className={INPUT_CLASS} value={formData.gloveSize ?? ""} onChange={(e) => setFormData({ ...formData, gloveSize: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase">Calçado / bota</label>
                    <input type="text" className={INPUT_CLASS} value={formData.shoeSize ?? ""} onChange={(e) => setFormData({ ...formData, shoeSize: e.target.value })} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-muted-foreground uppercase">Observações de EPI / uniforme</label>
                  <textarea className={TEXTAREA_CLASS} value={formData.epiNotes ?? ""} onChange={(e) => setFormData({ ...formData, epiNotes: e.target.value })} />
                </div>
              </div>

              <div className="space-y-4 rounded-xl border border-border p-5 bg-muted/20">
                <div>
                  <h4 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">5. Referência administrativa</h4>
                  <p className="text-xs text-muted-foreground mt-1">
                    Valores exibidos apenas para referência administrativa. Não alteram automaticamente o custo industrial ou CIU.
                  </p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase">Referência salarial (R$)</label>
                    <input required type="number" step="0.00001" className={INPUT_CLASS} value={formData.salary} onChange={(e) => setFormData({ ...formData, salary: parseFloat(e.target.value) })} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase">Jornada (horas/mês)</label>
                    <input required type="number" className={INPUT_CLASS} value={formData.monthlyHours} onChange={(e) => setFormData({ ...formData, monthlyHours: parseInt(e.target.value, 10) })} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase">Produtividade (%)</label>
                    <input required type="number" step="0.00001" className={INPUT_CLASS} value={formData.productivity} onChange={(e) => setFormData({ ...formData, productivity: parseFloat(e.target.value) })} />
                  </div>
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-bold text-muted-foreground uppercase">Verbas / benefícios legados</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {payrollComponents.map((comp) => (
                      <div
                        key={comp.id}
                        onClick={() => toggleComponent(comp.id)}
                        className={cn(
                          "p-3 rounded-xl border cursor-pointer transition-all flex items-center justify-between",
                          formData.componentIds?.includes(comp.id)
                            ? "bg-primary/5 border-primary shadow-sm"
                            : "bg-background border-border hover:border-primary/50"
                        )}
                      >
                        <div>
                          <p className="text-xs font-bold">{comp.name}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {comp.calculationType === "PERCENTAGE" ? `${comp.value}%` : formatCurrency(comp.value)}
                          </p>
                        </div>
                        <div className={cn(
                          "h-4 w-4 rounded-full border flex items-center justify-center",
                          formData.componentIds?.includes(comp.id) ? "bg-primary border-primary" : "border-border"
                        )}>
                          {formData.componentIds?.includes(comp.id) && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="space-y-4 rounded-xl border border-border p-5 bg-background">
                <h4 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">6. Observações</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase">Observações profissionais</label>
                    <textarea className={TEXTAREA_CLASS} value={formData.professionalNotes ?? ""} onChange={(e) => setFormData({ ...formData, professionalNotes: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase">Observações administrativas</label>
                    <textarea className={TEXTAREA_CLASS} value={formData.adminNotes ?? ""} onChange={(e) => setFormData({ ...formData, adminNotes: e.target.value })} />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2 border-t border-border">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-6 py-2 rounded-lg font-medium hover:bg-accent transition-colors text-sm">
                  Cancelar
                </button>
                <button type="submit" className="px-8 py-2 rounded-lg font-bold bg-primary text-primary-foreground hover:opacity-90 transition-opacity text-sm">
                  {editingEmployee ? "Salvar alterações" : "Cadastrar colaborador"}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* Modal: Payroll Component Form */}
      {isComponentModalOpen && canEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-card w-full max-md rounded-2xl border border-border shadow-2xl overflow-hidden"
          >
            <div className="p-6 border-b border-border flex items-center justify-between bg-accent/30">
              <h3 className="text-lg font-bold">Nova Verba / Encargo</h3>
              <button onClick={() => setIsComponentModalOpen(false)} className="p-2 hover:bg-accent rounded-full transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>
            
            <form onSubmit={handleComponentSubmit} className="p-6 space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground uppercase">Descrição</label>
                <input
                  required
                  type="text"
                  className="w-full p-2 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm"
                  value={compFormData.name}
                  onChange={(e) => setCompFormData({...compFormData, name: e.target.value})}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-muted-foreground uppercase">Tipo</label>
                  <SearchableSelect
                    placeholder="Tipo..."
                    options={PAYROLL_TYPE_OPTIONS}
                    value={compFormData.type}
                    onChange={(v) => setCompFormData({ ...compFormData, type: v })}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-muted-foreground uppercase">Cálculo</label>
                  <SearchableSelect
                    placeholder="Cálculo..."
                    options={PAYROLL_CALC_OPTIONS}
                    value={compFormData.calculationType}
                    onChange={(v) => setCompFormData({ ...compFormData, calculationType: v })}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground uppercase">Valor</label>
                <input
                  required
                  type="number"
                  step="0.00001"
                  className="w-full p-2 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm"
                  value={compFormData.value}
                  onChange={(e) => setCompFormData({...compFormData, value: parseFloat(e.target.value)})}
                />
              </div>
              <button 
                type="submit"
                className="w-full py-2.5 mt-4 rounded-lg font-bold bg-primary text-primary-foreground hover:opacity-90 transition-opacity text-sm"
              >
                Salvar Componente
              </button>
            </form>
          </motion.div>
        </div>
      )}

      {/* Modal: Ficha do colaborador */}
      {viewingEmployee && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-card w-full max-w-3xl rounded-2xl border border-border shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
          >
            <div className="p-6 border-b border-border flex items-center justify-between bg-accent/40">
              <div>
                <h3 className="text-xl font-bold">{viewingEmployee.name}</h3>
                <p className="text-xs text-muted-foreground">
                  {viewingEmployee.socialName?.trim() ? `${viewingEmployee.socialName} · ` : ""}
                  {viewingEmployee.Role.name} · {viewingEmployee.department}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => {
                      setViewingEmployee(null);
                      handleOpenModal(viewingEmployee);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-background hover:bg-accent text-sm font-medium"
                  >
                    <Edit2 className="h-4 w-4" />
                    Editar
                  </button>
                )}
                <button onClick={() => setViewingEmployee(null)} className="p-2 hover:bg-accent rounded-full transition-colors">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            
            <div className="p-6 space-y-5 overflow-y-auto">
              <p className="text-xs text-muted-foreground rounded-lg border border-border bg-muted/30 px-3 py-2">
                Dados pessoais e administrativos devem ser acessados apenas por pessoas autorizadas do RH.
              </p>

              <div className="space-y-3 rounded-xl border border-border p-4">
                <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Dados profissionais</h4>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><p className="text-muted-foreground text-xs">Nome social / apelido</p><p className="font-medium">{displayText(viewingEmployee.socialName)}</p></div>
                  <div><p className="text-muted-foreground text-xs">Cargo</p><p className="font-medium">{viewingEmployee.Role.name}</p></div>
                  <div><p className="text-muted-foreground text-xs">Departamento</p><p className="font-medium">{displayText(viewingEmployee.department)}</p></div>
                  <div><p className="text-muted-foreground text-xs">Centro de custo</p><p className="font-medium">{displayText(viewingEmployee.costCenter)}</p></div>
                  <div><p className="text-muted-foreground text-xs">Classificação</p><p className="font-medium">{displayText(viewingEmployee.classification)}</p></div>
                  <div><p className="text-muted-foreground text-xs">Tipo de contrato</p><p className="font-medium">{formatContractType(viewingEmployee.contractType)}</p></div>
                  <div><p className="text-muted-foreground text-xs">Admissão</p><p className="font-medium">{formatEmployeeDate(viewingEmployee.admissionDate)}</p></div>
                  <div><p className="text-muted-foreground text-xs">Desligamento</p><p className="font-medium">{formatEmployeeDate(viewingEmployee.terminationDate)}</p></div>
                  <div><p className="text-muted-foreground text-xs">Gestor responsável</p><p className="font-medium">{displayText(viewingEmployee.managerName)}</p></div>
                  <div>
                    <p className="text-muted-foreground text-xs">Status</p>
                    <div className={cn(
                      "inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider mt-1",
                      viewingEmployee.status === "ACTIVE" ? "bg-green-500/10 text-green-600" : "bg-red-500/10 text-red-600"
                    )}>
                      {viewingEmployee.status === "ACTIVE" ? "Ativo" : "Inativo"}
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-3 rounded-xl border border-border p-4">
                <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Dados pessoais</h4>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><p className="text-muted-foreground text-xs">CPF</p><p className="font-medium">{displayText(viewingEmployee.cpf)}</p></div>
                  <div><p className="text-muted-foreground text-xs">RG</p><p className="font-medium">{displayText(viewingEmployee.rg)}</p></div>
                  <div><p className="text-muted-foreground text-xs">Nascimento</p><p className="font-medium">{formatEmployeeDate(viewingEmployee.birthDate)}</p></div>
                  <div><p className="text-muted-foreground text-xs">Telefone</p><p className="font-medium">{displayText(viewingEmployee.phone)}</p></div>
                  <div className="col-span-2"><p className="text-muted-foreground text-xs">E-mail pessoal</p><p className="font-medium">{displayText(viewingEmployee.personalEmail)}</p></div>
                  <div className="col-span-2"><p className="text-muted-foreground text-xs">Endereço</p><p className="font-medium whitespace-pre-wrap">{displayText(viewingEmployee.address)}</p></div>
                </div>
              </div>

              <div className="space-y-3 rounded-xl border border-border p-4">
                <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Contato de emergência</h4>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="col-span-2"><p className="text-muted-foreground text-xs">Nome</p><p className="font-medium">{displayText(viewingEmployee.emergencyContactName)}</p></div>
                  <div><p className="text-muted-foreground text-xs">Telefone</p><p className="font-medium">{displayText(viewingEmployee.emergencyContactPhone)}</p></div>
                  <div><p className="text-muted-foreground text-xs">Grau / relação</p><p className="font-medium">{displayText(viewingEmployee.emergencyContactRelationship)}</p></div>
                </div>
              </div>

              <div className="space-y-3 rounded-xl border border-border p-4">
                <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">EPI / Uniformes</h4>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                  <div><p className="text-muted-foreground text-xs">Camiseta / camisa</p><p className="font-medium">{displayText(viewingEmployee.shirtSize)}</p></div>
                  <div><p className="text-muted-foreground text-xs">Calça</p><p className="font-medium">{displayText(viewingEmployee.pantsSize)}</p></div>
                  <div><p className="text-muted-foreground text-xs">Jaqueta / blusa</p><p className="font-medium">{displayText(viewingEmployee.jacketSize)}</p></div>
                  <div><p className="text-muted-foreground text-xs">Luva</p><p className="font-medium">{displayText(viewingEmployee.gloveSize)}</p></div>
                  <div><p className="text-muted-foreground text-xs">Calçado / bota</p><p className="font-medium">{displayText(viewingEmployee.shoeSize)}</p></div>
                </div>
                {viewingEmployee.epiNotes?.trim() && (
                  <div className="text-sm">
                    <p className="text-muted-foreground text-xs">Observações</p>
                    <p className="font-medium whitespace-pre-wrap">{viewingEmployee.epiNotes}</p>
                  </div>
                )}
              </div>

              <div className="space-y-3 rounded-xl border border-border p-4 bg-muted/20">
                <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Referência administrativa</h4>
                <p className="text-xs text-muted-foreground">
                  Valores exibidos apenas para referência administrativa. Não alteram automaticamente o custo industrial ou CIU.
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 rounded-lg bg-background border border-border">
                    <p className="text-[10px] font-bold text-muted-foreground uppercase mb-1">Estimativa mensal</p>
                    <p className="text-lg font-semibold">{formatCurrency(viewingEmployee.costs?.totalMonthlyCost || 0)}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-background border border-border">
                    <p className="text-[10px] font-bold text-muted-foreground uppercase mb-1">Estimativa /h produtiva</p>
                    <p className="text-lg font-semibold">{formatCurrency(viewingEmployee.costs?.costPerProductiveHour || 0, 5)}</p>
                  </div>
                </div>
                <div className="space-y-2 pt-1 text-sm">
                  <div className="flex items-center justify-between"><span className="text-muted-foreground">Referência salarial</span><span>{formatCurrency(viewingEmployee.costs?.salary || 0)}</span></div>
                  <div className="flex items-center justify-between"><span className="text-muted-foreground">Jornada mensal</span><span>{viewingEmployee.monthlyHours}h</span></div>
                  <div className="flex items-center justify-between"><span className="text-muted-foreground">Produtividade</span><span>{formatNumber(viewingEmployee.productivity, 2)}%</span></div>
                  <div className="flex items-center justify-between"><span className="text-muted-foreground">Benefícios (estimativa)</span><span className="text-green-600">{formatCurrency(viewingEmployee.costs?.totalBenefits || 0)}</span></div>
                  <div className="flex items-center justify-between"><span className="text-muted-foreground">Encargos (estimativa)</span><span className="text-orange-600">{formatCurrency(viewingEmployee.costs?.totalCharges || 0)}</span></div>
                  <div className="flex items-center justify-between"><span className="text-muted-foreground">Provisões (estimativa)</span><span className="text-blue-600">{formatCurrency(viewingEmployee.costs?.totalProvisions || 0)}</span></div>
                </div>
                <div className="pt-2">
                  <p className="text-xs font-bold text-muted-foreground uppercase mb-2">Verbas vinculadas</p>
                  {viewingEmployee.EmployeePayrollComponent.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nenhuma verba vinculada.</p>
                  ) : (
                    <ul className="space-y-1 text-sm">
                      {viewingEmployee.EmployeePayrollComponent.map((c) => (
                        <li key={c.PayrollComponent.id} className="flex justify-between gap-2">
                          <span>{c.PayrollComponent.name}</span>
                          <span className="text-muted-foreground text-xs">{c.PayrollComponent.type}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              {(viewingEmployee.professionalNotes?.trim() || viewingEmployee.adminNotes?.trim()) && (
                <div className="space-y-3 rounded-xl border border-border p-4">
                  <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Observações</h4>
                  {viewingEmployee.professionalNotes?.trim() && (
                    <div className="text-sm">
                      <p className="text-muted-foreground text-xs">Profissionais</p>
                      <p className="font-medium whitespace-pre-wrap">{viewingEmployee.professionalNotes}</p>
                    </div>
                  )}
                  {viewingEmployee.adminNotes?.trim() && (
                    <div className="text-sm">
                      <p className="text-muted-foreground text-xs">Administrativas</p>
                      <p className="font-medium whitespace-pre-wrap">{viewingEmployee.adminNotes}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}

      <GuidedTour
        open={tourOpen}
        onClose={() => setTourOpen(false)}
        steps={EMPLOYEE_TOUR_STEPS}
        tourName="Tour de Pessoas / RH"
      />
    </div>
  );
};
