import React, { useEffect, useState } from "react";
import { 
  Cpu, 
  Plus, 
  Search, 
  Edit2, 
  Trash2, 
  X,
  Loader2,
  Settings,
  Save,
  AlertCircle,
  Activity,
  Zap,
  Clock
} from "lucide-react";
import { cn, formatCurrency, formatNumber } from "@/src/lib/utils";
import { motion, AnimatePresence } from "motion/react";

interface MachineCostComponent {
  id?: string;
  name: string;
  monthlyEstimatedCost: number;
}

interface Machine {
  id: string;
  code: string;
  name: string;
  acquisitionValue: number;
  residualValue: number;
  usefulLifeMonths: number;
  MachineCostComponent: MachineCostComponent[];
}

export const MachineModule = () => {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingMachine, setEditingMachine] = useState<Machine | null>(null);

  const [formData, setFormData] = useState({
    code: "",
    name: "",
    acquisitionValue: 0,
    residualValue: 0,
    usefulLifeMonths: 120,
    components: [] as MachineCostComponent[],
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/machines");
      setMachines(await res.json());
    } catch (error) {
      console.error("Erro ao buscar máquinas:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleOpenModal = (machine?: Machine) => {
    if (machine) {
      setEditingMachine(machine);
      setFormData({
        code: machine.code,
        name: machine.name,
        acquisitionValue: Number(machine.acquisitionValue),
        residualValue: Number(machine.residualValue),
        usefulLifeMonths: machine.usefulLifeMonths,
        components: machine.MachineCostComponent.map(c => ({ ...c, monthlyEstimatedCost: Number(c.monthlyEstimatedCost) })),
      });
    } else {
      setEditingMachine(null);
      setFormData({
        code: "",
        name: "",
        acquisitionValue: 0,
        residualValue: 0,
        usefulLifeMonths: 120,
        components: [
          { name: "Manutenção Preventiva", monthlyEstimatedCost: 0 },
          { name: "Energia Elétrica Estimada", monthlyEstimatedCost: 0 },
        ],
      });
    }
    setIsModalOpen(true);
  };

  const addComponent = () => {
    setFormData({
      ...formData,
      components: [...formData.components, { name: "", monthlyEstimatedCost: 0 }]
    });
  };

  const removeComponent = (index: number) => {
    const newComponents = [...formData.components];
    newComponents.splice(index, 1);
    setFormData({ ...formData, components: newComponents });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const method = editingMachine ? "PUT" : "POST";
    const url = editingMachine ? `/api/machines/${editingMachine.id}` : "/api/machines";

    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      if (res.ok) {
        setIsModalOpen(false);
        fetchData();
      }
    } catch (error) {
      console.error("Erro ao salvar máquina:", error);
    }
  };

  const handleDelete = async (machine: Machine) => {
    if (!window.confirm(`Tem certeza que deseja excluir esta máquina?\n(${machine.name})`)) return;
    
    try {
      const res = await fetch(`/api/machines/${machine.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const errorData = await res.json();
        window.alert(errorData.message || "Erro ao excluir máquina.");
        return;
      }
      fetchData();
    } catch (error) {
      console.error("Erro ao deletar máquina:", error);
      window.alert("Erro de conexão ao tentar excluir máquina.");
    }
  };

  const calculateHM = (machine: Machine) => {
    const dep = (Number(machine.acquisitionValue) - Number(machine.residualValue)) / (machine.usefulLifeMonths || 1);
    const other = machine.MachineCostComponent.reduce((acc, c) => acc + Number(c.monthlyEstimatedCost), 0);
    return (dep + other) / 176; // Base 176h/mês
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Buscar máquina ou código..."
            className="w-full pl-10 pr-4 py-2 rounded-lg border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <button 
          onClick={() => handleOpenModal()}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg font-medium hover:opacity-90 transition-opacity text-sm"
        >
          <Plus className="h-4 w-4" />
          Nova Máquina
        </button>
      </div>

      {loading ? (
        <div className="p-12 text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {machines.filter(m => m.name.toLowerCase().includes(searchTerm.toLowerCase()) || m.code.toLowerCase().includes(searchTerm.toLowerCase())).map((machine) => {
            const hm = calculateHM(machine);
            return (
              <motion.div 
                key={machine.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-card rounded-2xl border border-border overflow-hidden shadow-sm hover:shadow-md transition-all group"
              >
                <div className="p-5 border-b border-border bg-accent/30 flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                      <Cpu className="h-6 w-6" />
                    </div>
                    <div>
                      <h3 className="font-bold text-sm">{machine.name}</h3>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{machine.code}</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => handleOpenModal(machine)}
                      className="p-2 rounded-lg hover:bg-background text-muted-foreground hover:text-primary transition-colors"
                      title="Editar"
                    >
                      <Edit2 className="h-4 w-4" />
                    </button>
                    <button 
                      onClick={() => handleDelete(machine)}
                      className="p-2 rounded-lg hover:bg-background text-muted-foreground hover:text-red-500 transition-colors"
                      title="Excluir"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                
                <div className="p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Clock className="h-4 w-4" />
                      <span className="text-xs">Custo Hora-Máquina</span>
                    </div>
                    <span className="text-lg font-black text-primary">{formatCurrency(hm, 5)}</span>
                  </div>

                  <div className="grid grid-cols-2 gap-4 pt-2 border-t border-border">
                    <div>
                      <p className="text-[10px] font-bold text-muted-foreground uppercase">Depreciação</p>
                      <p className="text-sm font-bold">{formatCurrency((Number(machine.acquisitionValue) - Number(machine.residualValue)) / machine.usefulLifeMonths)}/mês</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold text-muted-foreground uppercase">Outros Custos</p>
                      <p className="text-sm font-bold">{formatCurrency(machine.MachineCostComponent.reduce((acc, c) => acc + Number(c.monthlyEstimatedCost), 0))}/mês</p>
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
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
              className="bg-card w-full max-w-2xl rounded-2xl border border-border shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-6 border-b border-border flex items-center justify-between bg-accent/30">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                    <Cpu className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold">{editingMachine ? "Editar Máquina" : "Nova Máquina"}</h3>
                    <p className="text-xs text-muted-foreground">Configure os parâmetros de custo e depreciação.</p>
                  </div>
                </div>
                <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-accent rounded-full transition-colors">
                  <X className="h-5 w-5" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase">Código</label>
                    <input
                      required
                      type="text"
                      className="w-full p-3 rounded-xl border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none"
                      value={formData.code}
                      onChange={(e) => setFormData({...formData, code: e.target.value})}
                      placeholder="Ex: CNC-01"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase">Nome da Máquina</label>
                    <input
                      required
                      type="text"
                      className="w-full p-3 rounded-xl border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none"
                      value={formData.name}
                      onChange={(e) => setFormData({...formData, name: e.target.value})}
                      placeholder="Ex: Torno CNC Romi"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase">Valor Aquisição</label>
                    <input
                      required
                      type="number"
                      step="0.00001"
                      className="w-full p-3 rounded-xl border border-border bg-background outline-none"
                      value={formData.acquisitionValue}
                      onChange={(e) => setFormData({...formData, acquisitionValue: parseFloat(e.target.value)})}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase">Valor Residual</label>
                    <input
                      required
                      type="number"
                      step="0.00001"
                      className="w-full p-3 rounded-xl border border-border bg-background outline-none"
                      value={formData.residualValue}
                      onChange={(e) => setFormData({...formData, residualValue: parseFloat(e.target.value)})}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase">Vida Útil (Meses)</label>
                    <input
                      required
                      type="number"
                      className="w-full p-3 rounded-xl border border-border bg-background outline-none"
                      value={formData.usefulLifeMonths}
                      onChange={(e) => setFormData({...formData, usefulLifeMonths: parseInt(e.target.value)})}
                    />
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between border-b border-border pb-2">
                    <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-2">
                      <Zap className="h-3 w-3" /> Custos Operacionais Mensais
                    </h4>
                    <button 
                      type="button"
                      onClick={addComponent}
                      className="text-[10px] font-bold text-primary hover:underline flex items-center gap-1"
                    >
                      <Plus className="h-3 w-3" /> Adicionar Custo
                    </button>
                  </div>

                  <div className="space-y-3">
                    {formData.components.map((comp, idx) => (
                      <div key={idx} className="grid grid-cols-12 gap-3 p-3 rounded-xl border border-border bg-accent/5 items-end">
                        <div className="col-span-7 space-y-1.5">
                          <label className="text-[10px] font-bold text-muted-foreground uppercase">Descrição do Custo</label>
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
                          />
                        </div>
                        <div className="col-span-4 space-y-1.5">
                          <label className="text-[10px] font-bold text-muted-foreground uppercase">Valor Mensal (R$)</label>
                          <input
                            required
                            type="number"
                            step="0.00001"
                            className="w-full p-2 rounded-lg border border-border bg-background text-xs outline-none"
                            value={comp.monthlyEstimatedCost}
                            onChange={(e) => {
                              const newComps = [...formData.components];
                              newComps[idx].monthlyEstimatedCost = parseFloat(e.target.value);
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
                    Salvar Máquina
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
