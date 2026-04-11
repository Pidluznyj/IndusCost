import React, { useEffect, useState } from "react";
import { 
  Plus, 
  Search, 
  Edit2, 
  UserMinus, 
  UserCheck, 
  Filter,
  Download,
  X,
  Loader2,
  DollarSign,
  Clock,
  PieChart
} from "lucide-react";
import { cn, formatCurrency, formatNumber } from "@/src/lib/utils";
import { fetchJsonOk, fetchOk } from "@/src/lib/http";
import { Employee, Role, CreateEmployeeInput, PayrollComponent } from "@/src/types/employee";
import { motion } from "motion/react";

export const EmployeeModule = () => {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [payrollComponents, setPayrollComponents] = useState<PayrollComponent[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isComponentModalOpen, setIsComponentModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [viewingCosts, setViewingCosts] = useState<Employee | null>(null);

  // Form State
  const [formData, setFormData] = useState<CreateEmployeeInput>({
    name: "",
    roleId: "",
    department: "",
    costCenter: "",
    classification: "DIRETO",
    salary: 0,
    monthlyHours: 220,
    productivity: 100,
    componentIds: [],
  });

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
      setFormData({
        name: employee.name,
        roleId: employee.roleId,
        department: employee.department,
        costCenter: employee.costCenter,
        classification: employee.classification,
        salary: Number(employee.salary),
        monthlyHours: employee.monthlyHours,
        productivity: Number(employee.productivity),
        componentIds: employee.EmployeePayrollComponent.map(c => c.PayrollComponent.id),
      });
    } else {
      setEditingEmployee(null);
      setFormData({
        name: "",
        roleId: roles[0]?.id || "",
        department: "",
        costCenter: "",
        classification: "DIRETO",
        salary: 0,
        monthlyHours: 220,
        productivity: 100,
        componentIds: [],
      });
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

  const filteredEmployees = employees.filter(emp => 
    (emp.name ?? "").toLowerCase().includes(searchTerm.toLowerCase()) ||
    (emp.Role?.name ?? "").toLowerCase().includes(searchTerm.toLowerCase()) ||
    (emp.department ?? "").toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Buscar por nome, cargo ou setor..."
            className="w-full pl-10 pr-4 py-2 rounded-lg border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
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
            Novo Funcionário
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-card rounded-xl border border-border overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-accent/50 border-b border-border">
                <th className="p-4 font-semibold text-sm">Funcionário</th>
                <th className="p-4 font-semibold text-sm">Cargo / Setor</th>
                <th className="p-4 font-semibold text-sm">Salário Base</th>
                <th className="p-4 font-semibold text-sm">Custo Mensal Total</th>
                <th className="p-4 font-semibold text-sm text-center">Custo/Hora (Prod)</th>
                <th className="p-4 font-semibold text-sm">Status</th>
                <th className="p-4 font-semibold text-sm text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center">
                    <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
                    <p className="mt-2 text-sm text-muted-foreground">Carregando colaboradores...</p>
                  </td>
                </tr>
              ) : filteredEmployees.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-muted-foreground">
                    Nenhum funcionário encontrado.
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
                          <p className="text-xs text-muted-foreground">{emp.costCenter}</p>
                        </div>
                      </div>
                    </td>
                    <td className="p-4">
                      <p className="text-sm font-medium">{emp.Role.name}</p>
                      <p className="text-xs text-muted-foreground">{emp.department}</p>
                    </td>
                    <td className="p-4">
                      <p className="text-sm font-medium">{formatCurrency(emp.salary)}</p>
                      <p className="text-[10px] text-muted-foreground">{emp.monthlyHours}h/mês</p>
                    </td>
                    <td className="p-4">
                      <p className="text-sm font-bold text-primary">{formatCurrency(emp.costs?.totalMonthlyCost || 0)}</p>
                      <p className="text-[10px] text-muted-foreground">Total Empresa</p>
                    </td>
                    <td className="p-4 text-center">
                      <p className="text-sm font-bold">{formatCurrency(emp.costs?.costPerProductiveHour || 0, 5)}</p>
                      <p className="text-[10px] text-muted-foreground">{formatNumber(emp.productivity, 2)}% prod.</p>
                    </td>
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
                          onClick={() => setViewingCosts(emp)}
                          className="p-2 rounded-md hover:bg-accent text-muted-foreground hover:text-primary transition-all"
                          title="Ver Detalhes de Custo"
                        >
                          <DollarSign className="h-4 w-4" />
                        </button>
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
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-card w-full max-w-4xl rounded-2xl border border-border shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
          >
            <div className="p-6 border-b border-border flex items-center justify-between bg-accent/30">
              <h3 className="text-xl font-bold">{editingEmployee ? "Editar Funcionário" : "Novo Funcionário"}</h3>
              <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-accent rounded-full transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>
            
            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Basic Info */}
                <div className="space-y-4">
                  <h4 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Informações Básicas</h4>
                  <div className="grid grid-cols-1 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-muted-foreground uppercase">Nome Completo</label>
                      <input
                        required
                        type="text"
                        className="w-full p-2 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm"
                        value={formData.name}
                        onChange={(e) => setFormData({...formData, name: e.target.value})}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-muted-foreground uppercase">Cargo</label>
                        <select
                          className="w-full p-2 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm"
                          value={formData.roleId}
                          onChange={(e) => setFormData({...formData, roleId: e.target.value})}
                        >
                          {roles.map(role => (
                            <option key={role.id} value={role.id}>{role.name}</option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-muted-foreground uppercase">Setor</label>
                        <input
                          required
                          type="text"
                          className="w-full p-2 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm"
                          value={formData.department}
                          onChange={(e) => setFormData({...formData, department: e.target.value})}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-muted-foreground uppercase">Centro de Custo</label>
                        <input
                          required
                          type="text"
                          className="w-full p-2 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm"
                          value={formData.costCenter}
                          onChange={(e) => setFormData({...formData, costCenter: e.target.value})}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-muted-foreground uppercase">Classificação</label>
                        <select
                          className="w-full p-2 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm"
                          value={formData.classification}
                          onChange={(e) => setFormData({...formData, classification: e.target.value})}
                        >
                          <option value="DIRETO">Direto</option>
                          <option value="INDIRETO">Indireto</option>
                          <option value="APOIO">Apoio</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Financial Info */}
                <div className="space-y-4">
                  <h4 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Dados Financeiros</h4>
                  <div className="grid grid-cols-1 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-muted-foreground uppercase">Salário Base (R$)</label>
                      <input
                        required
                        type="number"
                        step="0.00001"
                        className="w-full p-2 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm"
                        value={formData.salary}
                        onChange={(e) => setFormData({...formData, salary: parseFloat(e.target.value)})}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-muted-foreground uppercase">Jornada (Horas)</label>
                        <input
                          required
                          type="number"
                          className="w-full p-2 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm"
                          value={formData.monthlyHours}
                          onChange={(e) => setFormData({...formData, monthlyHours: parseInt(e.target.value)})}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-muted-foreground uppercase">Produtividade (%)</label>
                        <input
                          required
                          type="number"
                          step="0.00001"
                          className="w-full p-2 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm"
                          value={formData.productivity}
                          onChange={(e) => setFormData({...formData, productivity: parseFloat(e.target.value)})}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Components Selection */}
              <div className="space-y-4">
                <h4 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Verbas e Encargos</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {payrollComponents.map(comp => (
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
                  {editingEmployee ? "Salvar Alterações" : "Cadastrar Funcionário"}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* Modal: Payroll Component Form */}
      {isComponentModalOpen && (
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
                  <select
                    className="w-full p-2 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm"
                    value={compFormData.type}
                    onChange={(e) => setCompFormData({...compFormData, type: e.target.value})}
                  >
                    <option value="BENEFIT">Benefício</option>
                    <option value="CHARGE">Encargo</option>
                    <option value="PROVISION">Provisão</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-muted-foreground uppercase">Cálculo</label>
                  <select
                    className="w-full p-2 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm"
                    value={compFormData.calculationType}
                    onChange={(e) => setCompFormData({...compFormData, calculationType: e.target.value})}
                  >
                    <option value="PERCENTAGE">Percentual (%)</option>
                    <option value="FIXED">Valor Fixo (R$)</option>
                  </select>
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

      {/* Modal: Cost Breakdown View */}
      {viewingCosts && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-card w-full max-w-2xl rounded-2xl border border-border shadow-2xl overflow-hidden"
          >
            <div className="p-6 border-b border-border flex items-center justify-between bg-primary text-primary-foreground">
              <div>
                <h3 className="text-xl font-bold">{viewingCosts.name}</h3>
                <p className="text-xs opacity-80">{viewingCosts.Role.name} • {viewingCosts.department}</p>
              </div>
              <button onClick={() => setViewingCosts(null)} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>
            
            <div className="p-8 space-y-8">
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-accent/50 border border-border">
                  <p className="text-[10px] font-bold text-muted-foreground uppercase mb-1">Custo Mensal Total</p>
                  <p className="text-2xl font-black text-primary">{formatCurrency(viewingCosts.costs?.totalMonthlyCost || 0)}</p>
                </div>
                <div className="p-4 rounded-xl bg-accent/50 border border-border">
                  <p className="text-[10px] font-bold text-muted-foreground uppercase mb-1">Custo Hora Produtiva</p>
                  <p className="text-2xl font-black text-primary">{formatCurrency(viewingCosts.costs?.costPerProductiveHour || 0, 5)}</p>
                </div>
              </div>

              <div className="space-y-4">
                <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground border-b border-border pb-2">Composição do Custo</h4>
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Salário Base</span>
                    <span className="font-bold">{formatCurrency(viewingCosts.costs?.salary || 0)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Total Benefícios</span>
                    <span className="font-bold text-green-600">{formatCurrency(viewingCosts.costs?.totalBenefits || 0)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Total Encargos</span>
                    <span className="font-bold text-orange-600">{formatCurrency(viewingCosts.costs?.totalCharges || 0)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Total Provisões (Férias/13º)</span>
                    <span className="font-bold text-blue-600">{formatCurrency(viewingCosts.costs?.totalProvisions || 0)}</span>
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-xl border border-dashed border-border bg-accent/20 flex items-center gap-4">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <Clock className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-xs font-bold">Eficiência Operacional</p>
                  <p className="text-sm text-muted-foreground">
                    Este colaborador produz <strong>{viewingCosts.costs?.productiveHours.toFixed(1)}h</strong> reais das {viewingCosts.monthlyHours}h contratadas.
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
};
