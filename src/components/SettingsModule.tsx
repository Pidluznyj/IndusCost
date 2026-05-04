import React, { useEffect, useState } from "react";
import {
  Settings,
  Plus,
  Edit2,
  X,
  Loader2,
  Briefcase,
  CreditCard,
  Save,
  AlertCircle,
  CheckCircle2,
  FileText,
  RefreshCw,
  Info,
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

type ProductionHourCalcForm = {
  simulationName: string;
  payrollCostMonth: string;
  payrollCostComment: string;
  energyCostMonth: string;
  energyCostComment: string;
  otherProductiveCostsMonth: string;
  otherProductiveCostsComment: string;
  productiveHoursMonth: string;
  productiveHoursComment: string;
  notes: string;
};

type ProductionHourCostSimulationRow = {
  id: string;
  name: string;
  payrollCostMonth: number | string;
  payrollCostComment?: string | null;
  energyCostMonth: number | string;
  energyCostComment?: string | null;
  otherProductiveCostsMonth: number | string;
  otherProductiveCostsComment?: string | null;
  productiveHoursMonth: number | string;
  productiveHoursComment?: string | null;
  payrollCostPerHour: number | string;
  energyCostPerHour: number | string;
  otherCostPerHour: number | string;
  totalProductionHourCost: number | string;
  formulaText: string;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
};

type NomusSyncStatus = "SUCCESS" | "FAILED" | "SKIPPED" | "UNKNOWN";
type NomusSyncKind = "runner" | "sync";
type NomusSyncMode = "apply" | "dry";
type NomusSyncTarget = "customers" | "products" | "proposals" | "sales-orders";
type NomusIntegrationHealthState = "OK" | "FAILED" | "STALE" | "WARNING" | "NO_DATA";

type NomusHealthLastRun = {
  mode: string;
  kind: string | null;
  status: NomusSyncStatus;
  success: boolean | null;
  exitCode: number | null;
  ordersRead: number | null;
  eligibleCount: number | null;
  blockedCount: number | null;
  createdCount: number | null;
  updatedCount: number | null;
  itemsCreated: number | null;
  errorMessage: string | null;
  logFile: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
};

type NomusHealthTargetRow = {
  target: NomusSyncTarget;
  label: string;
  lastRun: NomusHealthLastRun | null;
  health: NomusIntegrationHealthState;
  message: string;
  warning: string | null;
};

type NomusHealthResponse = { targets: NomusHealthTargetRow[] };

type NomusSyncLogSummary = {
  fileName: string;
  kind: NomusSyncKind;
  target: NomusSyncTarget;
  mode: NomusSyncMode;
  status: NomusSyncStatus;
  success: boolean | null;
  exitCode: number | null;
  createdAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  sizeBytes: number;
  modifiedAt: string;
  command: string | null;
  metrics: {
    eligibleCount: number | null;
    blockedCount: number | null;
    created: number | null;
    updated: number | null;
    itemsCreated: number | null;
    pageRead: number | null;
    ordersRead: number | null;
    startPage: number | null;
    maxPages: number | null;
    lastPage: number | null;
  };
  blockedReasons: Record<string, number>;
};

type NomusSyncLogDetail = {
  fileName: string;
  sizeBytes: number;
  modifiedAt: string;
  summary: NomusSyncLogSummary | null;
  content: string;
};

type HubSection = "globals" | "operational" | "nomusSync" | "integrations" | "security" | "system";
type OperationalSubTab = "roles" | "payroll";

const HUB_SECTIONS: Array<{
  id: HubSection;
  title: string;
  description: string;
  status: "operational" | "future";
  note: string;
}> = [
  {
    id: "globals",
    title: "Gerais / Parâmetros Globais",
    description: "Parâmetros corporativos usados nos cálculos do sistema.",
    status: "operational",
    note: "Operacional hoje",
  },
  {
    id: "operational",
    title: "Estrutura Operacional",
    description: "Cargos, salários, encargos e benefícios da operação.",
    status: "operational",
    note: "Operacional hoje",
  },
  {
    id: "nomusSync",
    title: "Logs de Sincronização Nomus",
    description: "Monitoramento das sincronizações Nomus: clientes, produtos, propostas e pedidos de venda.",
    status: "operational",
    note: "Operacional hoje",
  },
  {
    id: "integrations",
    title: "Integrações",
    description: "Conexões externas e sincronizações com sistemas terceiros.",
    status: "future",
    note: "Em preparação",
  },
  {
    id: "security",
    title: "Segurança e Acesso",
    description: "Bootstrap admin, login e permissionamento em etapas futuras.",
    status: "future",
    note: "Em preparação",
  },
  {
    id: "system",
    title: "Sistema",
    description: "Operação técnica, saúde do ambiente e manutenção.",
    status: "future",
    note: "Em preparação",
  },
];

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
  const [activeHubSection, setActiveHubSection] = useState<HubSection>("globals");
  const [activeOperationalTab, setActiveOperationalTab] = useState<OperationalSubTab>("roles");
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
  const [productionHourCalcForm, setProductionHourCalcForm] = useState<ProductionHourCalcForm>({
    simulationName: "",
    payrollCostMonth: "",
    payrollCostComment: "",
    energyCostMonth: "0",
    energyCostComment: "",
    otherProductiveCostsMonth: "",
    otherProductiveCostsComment: "",
    productiveHoursMonth: "0",
    productiveHoursComment: "",
    notes: "",
  });
  const [savedSimulations, setSavedSimulations] = useState<ProductionHourCostSimulationRow[]>([]);
  const [simulationsLoading, setSimulationsLoading] = useState(false);
  const [simulationSaving, setSimulationSaving] = useState(false);
  const [simulationError, setSimulationError] = useState<string | null>(null);
  const [selectedSimulation, setSelectedSimulation] = useState<ProductionHourCostSimulationRow | null>(null);
  const [nomusLogs, setNomusLogs] = useState<NomusSyncLogSummary[]>([]);
  const [nomusLogsLoading, setNomusLogsLoading] = useState(false);
  const [nomusLogsError, setNomusLogsError] = useState<string | null>(null);
  const [nomusHealth, setNomusHealth] = useState<NomusHealthResponse | null>(null);
  const [nomusHealthError, setNomusHealthError] = useState<string | null>(null);
  const [nomusTargetFilter, setNomusTargetFilter] = useState<"all" | NomusSyncTarget>("all");
  const [nomusModeFilter, setNomusModeFilter] = useState<"all" | NomusSyncMode>("all");
  const [nomusKindFilter, setNomusKindFilter] = useState<"all" | NomusSyncKind>("all");
  const [nomusStatusFilter, setNomusStatusFilter] = useState<"all" | NomusSyncStatus>("all");
  const [nomusLimit, setNomusLimit] = useState<25 | 50 | 100>(50);
  const [nomusDetailLoadingFile, setNomusDetailLoadingFile] = useState<string | null>(null);
  const [nomusSelectedDetail, setNomusSelectedDetail] = useState<NomusSyncLogDetail | null>(null);
  const [nomusReloadSeq, setNomusReloadSeq] = useState(0);

  const fetchData = async () => {
    setLoading(true);
    setSimulationsLoading(true);
    try {
      const [rolesData, componentsData, config, simulationsData] = await Promise.all([
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
        fetchJsonOk<ProductionHourCostSimulationRow[]>("/api/settings/production-hour-cost-simulations"),
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
      setProductionHourCalcForm((prev) => ({
        simulationName: prev.simulationName,
        payrollCostMonth: prev.payrollCostMonth,
        payrollCostComment: prev.payrollCostComment,
        energyCostMonth: String(config.values.energyCost ?? 0),
        energyCostComment: prev.energyCostComment,
        otherProductiveCostsMonth: prev.otherProductiveCostsMonth,
        otherProductiveCostsComment: prev.otherProductiveCostsComment,
        productiveHoursMonth: String(config.values.factoryHours ?? 0),
        productiveHoursComment: prev.productiveHoursComment,
        notes: prev.notes,
      }));
      setSavedSimulations(Array.isArray(simulationsData) ? simulationsData : []);
    } catch (error) {
      console.error("Erro ao buscar configurações:", error);
      alert(error instanceof Error ? error.message : "Não foi possível carregar configurações.");
    } finally {
      setLoading(false);
      setSimulationsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (activeHubSection !== "nomusSync") return;
    const load = async () => {
      setNomusLogsLoading(true);
      setNomusLogsError(null);
      setNomusHealthError(null);
      try {
        const params = new URLSearchParams();
        params.set("limit", String(nomusLimit));
        params.set("target", nomusTargetFilter);
        params.set("mode", nomusModeFilter);
        params.set("kind", nomusKindFilter);
        params.set("status", nomusStatusFilter);
        const logsUrl = `/api/settings/nomus-sync/logs?${params.toString()}`;
        const [logsResult, healthResult] = await Promise.allSettled([
          fetchJsonOk<NomusSyncLogSummary[]>(logsUrl),
          fetchJsonOk<NomusHealthResponse>("/api/integrations/nomus/health"),
        ]);
        if (logsResult.status === "fulfilled") {
          const data = logsResult.value;
          setNomusLogs(Array.isArray(data) ? data : []);
          setNomusLogsError(null);
        } else {
          setNomusLogs([]);
          setNomusLogsError(
            logsResult.reason instanceof Error
              ? logsResult.reason.message
              : "Não foi possível carregar os logs Nomus."
          );
        }
        if (healthResult.status === "fulfilled") {
          const healthData = healthResult.value;
          setNomusHealth(healthData && Array.isArray(healthData.targets) ? healthData : null);
          setNomusHealthError(null);
        } else {
          setNomusHealth(null);
          setNomusHealthError(
            healthResult.reason instanceof Error
              ? healthResult.reason.message
              : "Não foi possível carregar o painel de saúde Nomus."
          );
        }
      } catch (error) {
        setNomusLogsError(error instanceof Error ? error.message : "Não foi possível carregar os logs Nomus.");
        setNomusLogs([]);
        setNomusHealthError(error instanceof Error ? error.message : "Não foi possível carregar o painel de saúde Nomus.");
        setNomusHealth(null);
      } finally {
        setNomusLogsLoading(false);
      }
    };
    load();
  }, [activeHubSection, nomusLimit, nomusTargetFilter, nomusModeFilter, nomusKindFilter, nomusStatusFilter, nomusReloadSeq]);

  const formatDateTimeSafe = (value: string | null | undefined): string => {
    if (!value) return "—";
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return "—";
    return dt.toLocaleString("pt-BR");
  };

  const formatDurationMs = (value: number | null | undefined): string => {
    const totalMs = Number(value);
    if (!Number.isFinite(totalMs) || totalMs < 0) return "—";
    const totalSec = Math.floor(totalMs / 1000);
    const mm = Math.floor(totalSec / 60);
    const ss = totalSec % 60;
    return `${mm}m ${ss}s`;
  };

  const formatIntOrDash = (value: number | null | undefined): string => {
    const n = Number(value);
    return Number.isFinite(n) ? String(Math.trunc(n)) : "—";
  };

  const statusBadgeClass = (status: NomusSyncStatus): string =>
    status === "SUCCESS"
      ? "bg-green-100 text-green-700"
      : status === "FAILED"
      ? "bg-red-100 text-red-700"
      : status === "SKIPPED"
      ? "bg-slate-100 text-slate-700"
      : "bg-amber-100 text-amber-700";

  const nomusHealthBadgeLabel = (health: NomusIntegrationHealthState): string => {
    switch (health) {
      case "OK":
        return "OK";
      case "WARNING":
        return "Atenção";
      case "FAILED":
        return "Falha";
      case "STALE":
        return "Atrasado";
      case "NO_DATA":
        return "Sem dados";
      default:
        return health;
    }
  };

  const nomusHealthBadgeClass = (health: NomusIntegrationHealthState): string => {
    switch (health) {
      case "OK":
        return "bg-green-100 text-green-800";
      case "WARNING":
        return "bg-amber-100 text-amber-900";
      case "FAILED":
        return "bg-red-100 text-red-800";
      case "STALE":
        return "bg-orange-100 text-orange-900";
      case "NO_DATA":
        return "bg-slate-100 text-slate-700";
      default:
        return "bg-slate-100 text-slate-700";
    }
  };

  const nomusHealthRuleSummary = (health: NomusIntegrationHealthState): string => {
    const rules: Record<NomusIntegrationHealthState, string> = {
      OK: "Última execução apply finalizou com SUCCESS, sem falha de exit code e dentro do prazo esperado para o destino.",
      WARNING:
        "Última execução terminou sem falha explícita, mas há avisos (ex.: SKIPPED, bloqueios relevantes ou status a revisar). Consulte o último log.",
      FAILED: "Última execução apply falhou (status FAILED, success false ou exit code diferente de zero).",
      STALE:
        "A última execução bem-sucedida está fora do prazo: pedidos de venda ~2 horas; clientes, produtos e propostas ~24 horas.",
      NO_DATA: "Ainda não há registro de execução apply deste destino no IntegrationRun.",
    };
    return rules[health] ?? rules.NO_DATA;
  };

  const loadNomusLogDetail = async (fileName: string) => {
    setNomusDetailLoadingFile(fileName);
    try {
      const detail = await fetchJsonOk<NomusSyncLogDetail>(`/api/settings/nomus-sync/logs/${encodeURIComponent(fileName)}`);
      setNomusSelectedDetail(detail);
    } catch (error) {
      setNomusLogsError(error instanceof Error ? error.message : "Não foi possível carregar detalhe do log.");
    } finally {
      setNomusDetailLoadingFile(null);
    }
  };

  const handleOpenModal = (item?: any) => {
    if (item) {
      setEditingItem(item);
      if (activeOperationalTab === "roles") {
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
    const endpoint = activeOperationalTab === "roles" ? "/api/roles" : "/api/payroll-components";
    const method = editingItem ? "PUT" : "POST";
    const url = editingItem ? `${endpoint}/${editingItem.id}` : endpoint;
    const body = activeOperationalTab === "roles" ? roleForm : componentForm;

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

  const calcToNumberOrZero = (value: string): number => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  };

  const numericFromUnknown = (value: number | string | null | undefined): number => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  };

  const formatDateTime = (value: string): string => {
    if (!value) return "—";
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return "—";
    return dt.toLocaleString("pt-BR");
  };

  const calcPayrollMonth = calcToNumberOrZero(productionHourCalcForm.payrollCostMonth);
  const calcEnergyMonth = calcToNumberOrZero(productionHourCalcForm.energyCostMonth);
  const calcOtherCostsMonth = calcToNumberOrZero(productionHourCalcForm.otherProductiveCostsMonth);
  const calcHoursMonth = calcToNumberOrZero(productionHourCalcForm.productiveHoursMonth);
  const canCalculateProductionHour = calcHoursMonth > 0;

  const productionHourSimulation = canCalculateProductionHour
    ? {
        payrollPerHour: calcPayrollMonth / calcHoursMonth,
        energyPerHour: calcEnergyMonth / calcHoursMonth,
        otherCostsPerHour: calcOtherCostsMonth / calcHoursMonth,
        totalPerHour: (calcPayrollMonth + calcEnergyMonth + calcOtherCostsMonth) / calcHoursMonth,
      }
    : null;

  const handleClearProductionHourSimulation = () => {
    setProductionHourCalcForm({
      simulationName: "",
      payrollCostMonth: "",
      payrollCostComment: "",
      energyCostMonth: "",
      energyCostComment: "",
      otherProductiveCostsMonth: "",
      otherProductiveCostsComment: "",
      productiveHoursMonth: "",
      productiveHoursComment: "",
      notes: "",
    });
    setSelectedSimulation(null);
    setSimulationError(null);
  };

  const loadSimulationIntoCalculator = (simulation: ProductionHourCostSimulationRow) => {
    setProductionHourCalcForm({
      simulationName: simulation.name ?? "",
      payrollCostMonth: String(numericFromUnknown(simulation.payrollCostMonth)),
      payrollCostComment: simulation.payrollCostComment ?? "",
      energyCostMonth: String(numericFromUnknown(simulation.energyCostMonth)),
      energyCostComment: simulation.energyCostComment ?? "",
      otherProductiveCostsMonth: String(numericFromUnknown(simulation.otherProductiveCostsMonth)),
      otherProductiveCostsComment: simulation.otherProductiveCostsComment ?? "",
      productiveHoursMonth: String(numericFromUnknown(simulation.productiveHoursMonth)),
      productiveHoursComment: simulation.productiveHoursComment ?? "",
      notes: simulation.notes ?? "",
    });
    setSelectedSimulation(simulation);
  };

  const handleSaveProductionHourSimulation = async () => {
    const simulationName = productionHourCalcForm.simulationName.trim();
    if (!simulationName) {
      setSimulationError("Informe o nome da simulação.");
      return;
    }
    if (!canCalculateProductionHour || !productionHourSimulation) {
      setSimulationError("Informe horas produtivas válidas para salvar a simulação.");
      return;
    }

    setSimulationSaving(true);
    setSimulationError(null);
    try {
      await fetchJsonOk("/api/settings/production-hour-cost-simulations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: simulationName,
          payrollCostMonth: calcPayrollMonth,
          payrollCostComment: productionHourCalcForm.payrollCostComment.trim(),
          energyCostMonth: calcEnergyMonth,
          energyCostComment: productionHourCalcForm.energyCostComment.trim(),
          otherProductiveCostsMonth: calcOtherCostsMonth,
          otherProductiveCostsComment: productionHourCalcForm.otherProductiveCostsComment.trim(),
          productiveHoursMonth: calcHoursMonth,
          productiveHoursComment: productionHourCalcForm.productiveHoursComment.trim(),
          notes: productionHourCalcForm.notes.trim(),
        }),
      });
      const updated = await fetchJsonOk<ProductionHourCostSimulationRow[]>(
        "/api/settings/production-hour-cost-simulations"
      );
      setSavedSimulations(Array.isArray(updated) ? updated : []);
    } catch (error) {
      setSimulationError(error instanceof Error ? error.message : "Não foi possível salvar a simulação.");
    } finally {
      setSimulationSaving(false);
    }
  };

  const handleDeleteSimulation = async (id: string) => {
    const confirmed = window.confirm("Deseja realmente excluir esta simulação?");
    if (!confirmed) return;
    setSimulationError(null);
    try {
      await fetchOk(`/api/settings/production-hour-cost-simulations/${id}`, { method: "DELETE" });
      const updated = await fetchJsonOk<ProductionHourCostSimulationRow[]>(
        "/api/settings/production-hour-cost-simulations"
      );
      setSavedSimulations(Array.isArray(updated) ? updated : []);
      if (selectedSimulation?.id === id) {
        setSelectedSimulation(null);
      }
    } catch (error) {
      setSimulationError(error instanceof Error ? error.message : "Não foi possível excluir a simulação.");
    }
  };

  const handleViewSimulationDetails = async (id: string) => {
    setSimulationError(null);
    try {
      const detail = await fetchJsonOk<ProductionHourCostSimulationRow>(
        `/api/settings/production-hour-cost-simulations/${id}`
      );
      setSelectedSimulation(detail);
    } catch (error) {
      setSimulationError(error instanceof Error ? error.message : "Não foi possível carregar detalhes da simulação.");
    }
  };

  return (
    <div className="space-y-6" data-tour="settings-root">
      <section className="rounded-2xl border border-border bg-card/40 p-6 space-y-4">
        <div className="flex flex-col gap-2">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary/80">Administração do Sistema</p>
          <h3 className="text-2xl font-bold tracking-tight">Hub Administrativo de Configurações</h3>
          <p className="text-sm text-muted-foreground max-w-3xl">
            Centralize parâmetros operacionais e prepare a evolução para integração, segurança e governança do
            sistema. Funcionalidades futuras aparecem de forma explícita e sem simulação de operação.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-1 font-semibold text-green-700">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Áreas operacionais ativas
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 font-semibold text-amber-700">
            <AlertCircle className="h-3.5 w-3.5" />
            Áreas futuras em preparação
          </span>
        </div>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3" data-tour="settings-subtabs">
        {HUB_SECTIONS.map((section) => (
          <button
            key={section.id}
            type="button"
            onClick={() => setActiveHubSection(section.id)}
            className={cn(
              "rounded-xl border text-left p-4 transition-all",
              activeHubSection === section.id
                ? "border-primary bg-primary/5 shadow-sm"
                : "border-border bg-card hover:border-primary/40"
            )}
          >
            <div className="flex items-center justify-between gap-3 mb-1">
              <h4 className="text-sm font-bold">{section.title}</h4>
              <span
                className={cn(
                  "text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full",
                  section.status === "operational" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
                )}
              >
                {section.note}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">{section.description}</p>
          </button>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4" data-tour="settings-toolbar">
        <div
          className="flex items-center gap-2 text-xs sm:text-sm font-medium text-muted-foreground border border-border rounded-lg px-3 py-2 bg-card/40"
        >
          <Settings className="h-4 w-4 text-primary" />
          <span>
            Área atual:{" "}
            <span className="text-foreground font-semibold">
              {HUB_SECTIONS.find((s) => s.id === activeHubSection)?.title}
            </span>
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <TourHelpButton onClick={() => setTourOpen(true)} />
          {activeHubSection === "operational" && (
            <button
              onClick={() => handleOpenModal()}
              className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg font-medium hover:opacity-90 transition-opacity text-sm"
            >
              <Plus className="h-4 w-4" />
              {activeOperationalTab === "roles" ? "Novo Cargo" : "Novo Componente"}
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="p-12 text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
        </div>
      ) : (
        <div data-tour="settings-main-panel" className="space-y-4">
          {activeHubSection === "operational" && (
            <>
              <div className="rounded-xl border border-border bg-card/40 p-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setActiveOperationalTab("roles")}
                  className={cn(
                    "px-4 py-2 rounded-lg text-sm font-bold transition-all relative",
                    activeOperationalTab === "roles"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  )}
                >
                  Cargos e Salários
                </button>
                <button
                  type="button"
                  onClick={() => setActiveOperationalTab("payroll")}
                  className={cn(
                    "px-4 py-2 rounded-lg text-sm font-bold transition-all relative",
                    activeOperationalTab === "payroll"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  )}
                >
                  Encargos e Benefícios
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {activeOperationalTab === "roles"
                  ? roles.map((role) => (
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
                              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                                {role.monthlyHours}h mensais
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              type="button"
                              onClick={() => handleOpenModal(role)}
                              className="p-1.5 rounded-lg hover:bg-background text-muted-foreground hover:text-primary transition-colors"
                            >
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
                  : components.map((comp) => (
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
                              <p
                                className={cn(
                                  "text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full inline-block mt-1",
                                  comp.type === "BENEFIT"
                                    ? "bg-green-100 text-green-700"
                                    : comp.type === "CHARGE"
                                    ? "bg-blue-100 text-blue-700"
                                    : "bg-orange-100 text-orange-700"
                                )}
                              >
                                {comp.type === "BENEFIT" ? "Benefício" : comp.type === "CHARGE" ? "Encargo" : "Provisão"}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              type="button"
                              onClick={() => handleOpenModal(comp)}
                              className="p-1.5 rounded-lg hover:bg-background text-muted-foreground hover:text-primary transition-colors"
                            >
                              <Edit2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                        <div className="p-5">
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-muted-foreground">Valor / Alíquota</span>
                            <span className="text-lg font-black text-primary">
                              {comp.calculationType === "PERCENTAGE"
                                ? `${formatNumber(comp.value)}%`
                                : formatCurrency(comp.value)}
                            </span>
                          </div>
                          <div className="mt-2 text-[10px] text-muted-foreground italic">
                            {comp.calculationType === "PERCENTAGE"
                              ? "Calculado sobre o salário base"
                              : "Valor fixo mensal"}
                          </div>
                        </div>
                      </motion.div>
                    ))}
              </div>
            </>
          )}

          {activeHubSection === "globals" && (
            <div className="bg-card rounded-2xl border border-border overflow-hidden shadow-sm p-6">
              <div className="mb-6 space-y-1">
                <h3 className="text-lg font-bold">Parâmetros Globais da Empresa</h3>
                <p className="text-sm text-muted-foreground">
                  Configurações reais já conectadas ao backend atual para cálculo industrial e gerencial.
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                    Custo de Energia (R$ / mês)
                  </label>
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
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                    Horas Máquina Disponíveis
                  </label>
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
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                    Capacidade Fabril Total
                  </label>
                  <input
                    type="number"
                    step="0.00001"
                    value={globalForm.factoryHours}
                    onChange={(e) => setGlobalForm({ ...globalForm, factoryHours: Number(e.target.value) })}
                    className="w-full p-3 bg-background border border-border rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all outline-none"
                    placeholder="Ex: 8448"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Horas mensais totais alocadas p/ rateio de CIF e OPEX.
                  </p>
                </div>
                <div className="space-y-1.5 p-4 rounded-2xl bg-primary/5 border border-primary/10 lg:col-span-1">
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-bold text-primary uppercase tracking-wider">
                      Override Custo HH (R$/h)
                    </label>
                    <span
                      className={cn(
                        "text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase",
                        globals.hhSource === "MANUAL" ? "bg-orange-100 text-orange-700" : "bg-blue-100 text-blue-700"
                      )}
                    >
                      {globals.hhSource === "MANUAL" ? "Manual Ativo" : "Automático"}
                    </span>
                  </div>
                  <input
                    type="number"
                    step="0.00001"
                    value={globalForm.hhOverride}
                    onChange={(e) =>
                      setGlobalForm({ ...globalForm, hhOverride: e.target.value === "" ? "" : Number(e.target.value) })
                    }
                    className="w-full p-3 bg-background border border-primary/20 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all outline-none font-bold text-primary placeholder:font-normal placeholder:text-muted-foreground/50"
                    placeholder={`Automático: ${formatCurrency(globals.calculatedHh, 5)}/h`}
                  />
                  <p className="text-[10px] text-muted-foreground">
                    {globalForm.hhOverride === "" || globalForm.hhOverride === 0
                      ? `Usando cálculo automático da folha: ${formatCurrency(globals.calculatedHh, 5)}/h`
                      : "Sobrescrevendo cálculo automático com valor manual."}
                  </p>
                </div>
              </div>
              <div className="mt-6 flex justify-end">
                <button
                  type="button"
                  onClick={handleSaveGlobals}
                  className="bg-primary text-primary-foreground px-6 py-2.5 rounded-xl font-bold hover:opacity-90 transition-opacity"
                >
                  Salvar Parâmetros
                </button>
              </div>

              <div className="mt-8 pt-6 border-t border-border space-y-5">
                <div className="space-y-1">
                  <h4 className="text-lg font-bold">Calculadora de Valor Hora de Produção</h4>
                  <p className="text-sm text-muted-foreground">
                    Simule o custo total por hora produtiva somando folha, energia e outros custos mensais.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                    Nome da simulação
                  </label>
                  <input
                    type="text"
                    value={productionHourCalcForm.simulationName}
                    onChange={(e) =>
                      setProductionHourCalcForm((prev) => ({ ...prev, simulationName: e.target.value }))
                    }
                    className="w-full p-3 bg-background border border-border rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all outline-none"
                    placeholder="Ex: Cenário Abril/2026 - Turno atual"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                      Custo folha produção (R$ / mês)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={productionHourCalcForm.payrollCostMonth}
                      onChange={(e) =>
                        setProductionHourCalcForm((prev) => ({ ...prev, payrollCostMonth: e.target.value }))
                      }
                      className="w-full p-3 bg-background border border-border rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all outline-none"
                      placeholder="80000"
                    />
                    <textarea
                      value={productionHourCalcForm.payrollCostComment}
                      onChange={(e) =>
                        setProductionHourCalcForm((prev) => ({ ...prev, payrollCostComment: e.target.value }))
                      }
                      rows={2}
                      className="w-full p-2.5 bg-background border border-border rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all outline-none text-sm"
                      placeholder="Origem/comentário do custo folha"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                      Custo energia (R$ / mês)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={productionHourCalcForm.energyCostMonth}
                      onChange={(e) =>
                        setProductionHourCalcForm((prev) => ({ ...prev, energyCostMonth: e.target.value }))
                      }
                      className="w-full p-3 bg-background border border-border rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all outline-none"
                      placeholder="5000"
                    />
                    <textarea
                      value={productionHourCalcForm.energyCostComment}
                      onChange={(e) =>
                        setProductionHourCalcForm((prev) => ({ ...prev, energyCostComment: e.target.value }))
                      }
                      rows={2}
                      className="w-full p-2.5 bg-background border border-border rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all outline-none text-sm"
                      placeholder="Origem/comentário do custo energia"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                      Outros custos produtivos (R$ / mês)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={productionHourCalcForm.otherProductiveCostsMonth}
                      onChange={(e) =>
                        setProductionHourCalcForm((prev) => ({ ...prev, otherProductiveCostsMonth: e.target.value }))
                      }
                      className="w-full p-3 bg-background border border-border rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all outline-none"
                      placeholder="12000"
                    />
                    <textarea
                      value={productionHourCalcForm.otherProductiveCostsComment}
                      onChange={(e) =>
                        setProductionHourCalcForm((prev) => ({
                          ...prev,
                          otherProductiveCostsComment: e.target.value,
                        }))
                      }
                      rows={2}
                      className="w-full p-2.5 bg-background border border-border rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all outline-none text-sm"
                      placeholder="Origem/comentário de outros custos produtivos"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                      Horas produtivas disponíveis no mês
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={productionHourCalcForm.productiveHoursMonth}
                      onChange={(e) =>
                        setProductionHourCalcForm((prev) => ({ ...prev, productiveHoursMonth: e.target.value }))
                      }
                      className="w-full p-3 bg-background border border-border rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all outline-none"
                      placeholder="8448"
                    />
                    <textarea
                      value={productionHourCalcForm.productiveHoursComment}
                      onChange={(e) =>
                        setProductionHourCalcForm((prev) => ({ ...prev, productiveHoursComment: e.target.value }))
                      }
                      rows={2}
                      className="w-full p-2.5 bg-background border border-border rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all outline-none text-sm"
                      placeholder="Origem/comentário das horas produtivas"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                  <div className="rounded-xl border border-border bg-card/40 p-4">
                    <p className="text-xs text-muted-foreground uppercase font-bold">Parcela folha por hora</p>
                    <p className="text-lg font-bold mt-1">
                      {canCalculateProductionHour
                        ? formatCurrency(productionHourSimulation?.payrollPerHour ?? 0, 2)
                        : "—"}
                    </p>
                  </div>
                  <div className="rounded-xl border border-border bg-card/40 p-4">
                    <p className="text-xs text-muted-foreground uppercase font-bold">Parcela energia por hora</p>
                    <p className="text-lg font-bold mt-1">
                      {canCalculateProductionHour
                        ? formatCurrency(productionHourSimulation?.energyPerHour ?? 0, 2)
                        : "—"}
                    </p>
                  </div>
                  <div className="rounded-xl border border-border bg-card/40 p-4">
                    <p className="text-xs text-muted-foreground uppercase font-bold">Parcela outros custos por hora</p>
                    <p className="text-lg font-bold mt-1">
                      {canCalculateProductionHour
                        ? formatCurrency(productionHourSimulation?.otherCostsPerHour ?? 0, 2)
                        : "—"}
                    </p>
                  </div>
                  <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
                    <p className="text-xs text-primary uppercase font-bold">Valor hora total de produção</p>
                    <p className="text-xl font-black mt-1 text-primary">
                      {canCalculateProductionHour
                        ? formatCurrency(productionHourSimulation?.totalPerHour ?? 0, 2)
                        : "—"}
                    </p>
                  </div>
                </div>

                {!canCalculateProductionHour && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    Informe as horas produtivas para calcular.
                  </div>
                )}

                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">
                    Valor hora = (Folha + Energia + Outros custos) ÷ Horas produtivas
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Esta calculadora é apenas uma simulação gerencial. Ela não altera automaticamente os parâmetros
                    usados nos cálculos reais do sistema.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                    Observações gerais da simulação
                  </label>
                  <textarea
                    value={productionHourCalcForm.notes}
                    onChange={(e) => setProductionHourCalcForm((prev) => ({ ...prev, notes: e.target.value }))}
                    rows={3}
                    className="w-full p-3 bg-background border border-border rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all outline-none"
                    placeholder="Premissas, justificativas e contexto gerencial da simulação"
                  />
                </div>

                {simulationError && (
                  <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {simulationError}
                  </div>
                )}

                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={handleSaveProductionHourSimulation}
                    disabled={simulationSaving}
                    className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-60"
                  >
                    {simulationSaving ? "Salvando..." : "Salvar Simulação"}
                  </button>
                  <button
                    type="button"
                    onClick={handleClearProductionHourSimulation}
                    className="px-4 py-2 rounded-lg border border-border bg-background text-sm font-medium hover:bg-accent transition-colors"
                  >
                    Limpar simulação
                  </button>
                </div>

                <div className="pt-6 border-t border-border space-y-3">
                  <h5 className="text-base font-bold">Simulações salvas</h5>
                  <div className="overflow-x-auto rounded-xl border border-border">
                    <table className="w-full min-w-[900px] text-sm">
                      <thead className="bg-accent/30">
                        <tr>
                          <th className="px-3 py-2 text-left font-semibold">Nome</th>
                          <th className="px-3 py-2 text-right font-semibold">Valor hora total</th>
                          <th className="px-3 py-2 text-right font-semibold">Horas produtivas</th>
                          <th className="px-3 py-2 text-right font-semibold">Custo folha</th>
                          <th className="px-3 py-2 text-right font-semibold">Custo energia</th>
                          <th className="px-3 py-2 text-right font-semibold">Outros custos</th>
                          <th className="px-3 py-2 text-left font-semibold">Criado em</th>
                          <th className="px-3 py-2 text-left font-semibold">Ações</th>
                        </tr>
                      </thead>
                      <tbody>
                        {simulationsLoading ? (
                          <tr>
                            <td className="px-3 py-3 text-muted-foreground" colSpan={8}>
                              Carregando simulações...
                            </td>
                          </tr>
                        ) : savedSimulations.length === 0 ? (
                          <tr>
                            <td className="px-3 py-3 text-muted-foreground" colSpan={8}>
                              Nenhuma simulação salva.
                            </td>
                          </tr>
                        ) : (
                          savedSimulations.map((simulation) => (
                            <tr key={simulation.id} className="border-t border-border">
                              <td className="px-3 py-2">{simulation.name}</td>
                              <td className="px-3 py-2 text-right">
                                {formatCurrency(numericFromUnknown(simulation.totalProductionHourCost), 2)}
                              </td>
                              <td className="px-3 py-2 text-right">
                                {formatNumber(numericFromUnknown(simulation.productiveHoursMonth), 2)}
                              </td>
                              <td className="px-3 py-2 text-right">
                                {formatCurrency(numericFromUnknown(simulation.payrollCostMonth), 2)}
                              </td>
                              <td className="px-3 py-2 text-right">
                                {formatCurrency(numericFromUnknown(simulation.energyCostMonth), 2)}
                              </td>
                              <td className="px-3 py-2 text-right">
                                {formatCurrency(numericFromUnknown(simulation.otherProductiveCostsMonth), 2)}
                              </td>
                              <td className="px-3 py-2">{formatDateTime(simulation.createdAt)}</td>
                              <td className="px-3 py-2">
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => handleViewSimulationDetails(simulation.id)}
                                    className="px-2 py-1 rounded border border-border text-xs hover:bg-accent"
                                  >
                                    Ver detalhes
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteSimulation(simulation.id)}
                                    className="px-2 py-1 rounded border border-red-300 text-red-700 text-xs hover:bg-red-50"
                                  >
                                    Excluir
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

                {selectedSimulation && (
                  <div className="rounded-xl border border-border bg-card/40 p-4 space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-bold">Detalhes da simulação</p>
                        <p className="text-xs text-muted-foreground">{selectedSimulation.name}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => loadSimulationIntoCalculator(selectedSimulation)}
                        className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-bold hover:opacity-90"
                      >
                        Carregar na calculadora
                      </button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="font-semibold">Folha</p>
                        <p>{formatCurrency(numericFromUnknown(selectedSimulation.payrollCostMonth), 2)}</p>
                        <p className="text-xs text-muted-foreground">{selectedSimulation.payrollCostComment ?? "—"}</p>
                      </div>
                      <div>
                        <p className="font-semibold">Energia</p>
                        <p>{formatCurrency(numericFromUnknown(selectedSimulation.energyCostMonth), 2)}</p>
                        <p className="text-xs text-muted-foreground">{selectedSimulation.energyCostComment ?? "—"}</p>
                      </div>
                      <div>
                        <p className="font-semibold">Outros custos</p>
                        <p>{formatCurrency(numericFromUnknown(selectedSimulation.otherProductiveCostsMonth), 2)}</p>
                        <p className="text-xs text-muted-foreground">
                          {selectedSimulation.otherProductiveCostsComment ?? "—"}
                        </p>
                      </div>
                      <div>
                        <p className="font-semibold">Horas produtivas</p>
                        <p>{formatNumber(numericFromUnknown(selectedSimulation.productiveHoursMonth), 2)}</p>
                        <p className="text-xs text-muted-foreground">{selectedSimulation.productiveHoursComment ?? "—"}</p>
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground whitespace-pre-line">{selectedSimulation.formulaText}</div>
                    <div className="text-xs text-muted-foreground">{selectedSimulation.notes ?? "Sem observações."}</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeHubSection === "nomusSync" && (
            <div className="rounded-2xl border border-border bg-card p-6 space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-bold">Logs de Sincronização Nomus</h3>
                  <p className="text-sm text-muted-foreground">
                    Monitoramento das sincronizações Nomus: clientes, produtos, propostas e pedidos de venda.
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Somente leitura. Pedidos de venda costumam rodar a cada hora (ex.: minuto 17); demais destinos conforme
                    agendamento do ambiente.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setNomusReloadSeq((prev) => prev + 1)}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm hover:bg-accent"
                >
                  <RefreshCw className="h-4 w-4" />
                  Atualizar lista
                </button>
              </div>

              {nomusHealthError && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  {nomusHealthError}
                </div>
              )}

              {nomusHealth && nomusHealth.targets.length > 0 ? (
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">Saúde por destino</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                    {nomusHealth.targets.map((t) => (
                      <div
                        key={t.target}
                        className={cn(
                          "rounded-xl border p-4 flex flex-col gap-2 min-h-[200px]",
                          t.health === "OK" && "border-green-200 bg-green-50/40",
                          t.health === "WARNING" && "border-amber-200 bg-amber-50/40",
                          t.health === "FAILED" && "border-red-200 bg-red-50/40",
                          t.health === "STALE" && "border-orange-200 bg-orange-50/40",
                          t.health === "NO_DATA" && "border-border bg-card/50"
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-xs font-bold uppercase text-muted-foreground">{t.label}</p>
                            <p className="text-sm font-semibold mt-0.5">{t.message}</p>
                          </div>
                          <span
                            className={cn(
                              "shrink-0 inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold",
                              nomusHealthBadgeClass(t.health)
                            )}
                          >
                            {nomusHealthBadgeLabel(t.health)}
                          </span>
                        </div>
                        {t.warning ? (
                          <p className="text-xs text-amber-900 bg-amber-100/80 rounded-lg px-2 py-1.5">{t.warning}</p>
                        ) : null}
                        {t.lastRun ? (
                          <div className="text-xs text-muted-foreground space-y-0.5">
                            <p>
                              <span className="font-semibold text-foreground">Última apply:</span>{" "}
                              {formatDateTimeSafe(t.lastRun.finishedAt ?? t.lastRun.createdAt)}
                            </p>
                            <p>
                              Criados / Atualiz. / Bloq.: {formatIntOrDash(t.lastRun.createdCount)} /{" "}
                              {formatIntOrDash(t.lastRun.updatedCount)} / {formatIntOrDash(t.lastRun.blockedCount)}
                            </p>
                            <p>Duração: {formatDurationMs(t.lastRun.durationMs)}</p>
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">Nenhuma execução apply registrada.</p>
                        )}
                        <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
                          <details className="group text-xs">
                            <summary className="list-none cursor-pointer inline-flex items-center gap-1 text-primary font-medium hover:underline [&::-webkit-details-marker]:hidden">
                              <Info className="h-3.5 w-3.5 shrink-0" />
                              Regras do indicador
                            </summary>
                            <div className="mt-2 rounded-lg border border-border bg-background p-2 text-muted-foreground leading-snug space-y-2">
                              <p>
                                <span className="font-semibold text-foreground">Este cartão ({nomusHealthBadgeLabel(t.health)}):</span>{" "}
                                {nomusHealthRuleSummary(t.health)}
                              </p>
                              <p className="text-[11px] border-t border-border pt-2">
                                OK: última apply SUCCESS no prazo. Atenção: avisos ou bloqueios relevantes. Falha: última
                                apply falhou. Atrasado: SUCCESS fora do prazo. Sem dados: sem apply registrada.
                              </p>
                            </div>
                          </details>
                          <button
                            type="button"
                            onClick={() => {
                              setNomusTargetFilter(t.target);
                              setNomusReloadSeq((prev) => prev + 1);
                            }}
                            className="text-xs font-semibold text-primary hover:underline"
                          >
                            Ver detalhes na tabela
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
                <select
                  value={nomusTargetFilter}
                  onChange={(e) => setNomusTargetFilter(e.target.value as "all" | NomusSyncTarget)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                >
                  <option value="all">Target: Todos</option>
                  <option value="customers">Target: Clientes</option>
                  <option value="products">Target: Produtos</option>
                  <option value="proposals">Target: Propostas</option>
                  <option value="sales-orders">Target: Pedidos de venda</option>
                </select>
                <select
                  value={nomusModeFilter}
                  onChange={(e) => setNomusModeFilter(e.target.value as "all" | NomusSyncMode)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                >
                  <option value="all">Modo: Todos</option>
                  <option value="apply">Modo: Apply</option>
                  <option value="dry">Modo: Dry</option>
                </select>
                <select
                  value={nomusKindFilter}
                  onChange={(e) => setNomusKindFilter(e.target.value as "all" | NomusSyncKind)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                >
                  <option value="all">Tipo: Todos</option>
                  <option value="runner">Tipo: Runner</option>
                  <option value="sync">Tipo: Sync</option>
                </select>
                <select
                  value={nomusStatusFilter}
                  onChange={(e) => setNomusStatusFilter(e.target.value as "all" | NomusSyncStatus)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                >
                  <option value="all">Status: Todos</option>
                  <option value="SUCCESS">Status: Success</option>
                  <option value="FAILED">Status: Failed</option>
                  <option value="UNKNOWN">Status: Unknown</option>
                  <option value="SKIPPED">Status: Skipped</option>
                </select>
                <select
                  value={String(nomusLimit)}
                  onChange={(e) => setNomusLimit(Number(e.target.value) as 25 | 50 | 100)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                >
                  <option value="25">Limite: 25</option>
                  <option value="50">Limite: 50</option>
                  <option value="100">Limite: 100</option>
                </select>
              </div>

              {nomusLogsError && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{nomusLogsError}</div>
              )}

              <p className="text-xs text-muted-foreground">
                A lista prioriza o horário do registro no banco (<span className="font-mono">IntegrationRun.createdAt</span>
                ), quando existir; caso contrário, usa a conclusão do arquivo ou a data de modificação do log.
              </p>

              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full min-w-[1280px] text-sm">
                  <thead className="bg-accent/30">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold">Conclusão (arquivo)</th>
                      <th className="px-3 py-2 text-left font-semibold">Registro</th>
                      <th className="px-3 py-2 text-left font-semibold">Tipo</th>
                      <th className="px-3 py-2 text-left font-semibold">Modo</th>
                      <th className="px-3 py-2 text-left font-semibold">Target</th>
                      <th className="px-3 py-2 text-left font-semibold">Status</th>
                      <th className="px-3 py-2 text-right font-semibold">Duração</th>
                      <th className="px-3 py-2 text-right font-semibold">Exit code</th>
                      <th className="px-3 py-2 text-right font-semibold">Criados</th>
                      <th className="px-3 py-2 text-right font-semibold">Atualizados</th>
                      <th className="px-3 py-2 text-right font-semibold">Bloqueados</th>
                      <th className="px-3 py-2 text-left font-semibold">Arquivo</th>
                      <th className="px-3 py-2 text-left font-semibold">Ação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {nomusLogsLoading ? (
                      <tr>
                        <td className="px-3 py-3 text-muted-foreground" colSpan={13}>
                          Carregando logs...
                        </td>
                      </tr>
                    ) : nomusLogs.length === 0 ? (
                      <tr>
                        <td className="px-3 py-3 text-muted-foreground" colSpan={13}>
                          Nenhum log encontrado para os filtros aplicados.
                        </td>
                      </tr>
                    ) : (
                      nomusLogs.map((log) => (
                        <tr key={log.fileName} className="border-t border-border">
                          <td className="px-3 py-2">{formatDateTimeSafe(log.finishedAt ?? log.modifiedAt)}</td>
                          <td className="px-3 py-2 text-xs">{formatDateTimeSafe(log.createdAt)}</td>
                          <td className="px-3 py-2">{log.kind}</td>
                          <td className="px-3 py-2">{log.mode}</td>
                          <td className="px-3 py-2">{log.target}</td>
                          <td className="px-3 py-2">
                            <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-bold", statusBadgeClass(log.status))}>
                              {log.status}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right">{formatDurationMs(log.durationMs)}</td>
                          <td className="px-3 py-2 text-right">{formatIntOrDash(log.exitCode)}</td>
                          <td className="px-3 py-2 text-right">{formatIntOrDash(log.metrics.created)}</td>
                          <td className="px-3 py-2 text-right">{formatIntOrDash(log.metrics.updated)}</td>
                          <td className="px-3 py-2 text-right">{formatIntOrDash(log.metrics.blockedCount)}</td>
                          <td className="px-3 py-2 font-mono text-xs max-w-[280px] truncate" title={log.fileName}>
                            {log.fileName}
                          </td>
                          <td className="px-3 py-2">
                            <button
                              type="button"
                              onClick={() => loadNomusLogDetail(log.fileName)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-border text-xs hover:bg-accent"
                            >
                              <FileText className="h-3.5 w-3.5" />
                              {nomusDetailLoadingFile === log.fileName ? "Carregando..." : "Ver detalhes"}
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {nomusSelectedDetail && (
                <div className="rounded-xl border border-border bg-card/40 p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold">Detalhe do log</p>
                      <p className="text-xs text-muted-foreground font-mono break-all">{nomusSelectedDetail.fileName}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => navigator.clipboard.writeText(nomusSelectedDetail.content).catch(() => null)}
                      className="px-3 py-1.5 rounded-lg border border-border text-xs hover:bg-accent"
                    >
                      Copiar log
                    </button>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                    <div className="rounded-lg border border-border bg-background px-3 py-2">
                      <p className="text-[10px] uppercase text-muted-foreground font-bold">Elegíveis</p>
                      <p className="text-sm font-semibold">{formatIntOrDash(nomusSelectedDetail.summary?.metrics?.eligibleCount)}</p>
                    </div>
                    <div className="rounded-lg border border-border bg-background px-3 py-2">
                      <p className="text-[10px] uppercase text-muted-foreground font-bold">Bloqueados</p>
                      <p className="text-sm font-semibold">{formatIntOrDash(nomusSelectedDetail.summary?.metrics?.blockedCount)}</p>
                    </div>
                    <div className="rounded-lg border border-border bg-background px-3 py-2">
                      <p className="text-[10px] uppercase text-muted-foreground font-bold">Criados</p>
                      <p className="text-sm font-semibold">{formatIntOrDash(nomusSelectedDetail.summary?.metrics?.created)}</p>
                    </div>
                    <div className="rounded-lg border border-border bg-background px-3 py-2">
                      <p className="text-[10px] uppercase text-muted-foreground font-bold">Atualizados</p>
                      <p className="text-sm font-semibold">{formatIntOrDash(nomusSelectedDetail.summary?.metrics?.updated)}</p>
                    </div>
                    <div className="rounded-lg border border-border bg-background px-3 py-2">
                      <p className="text-[10px] uppercase text-muted-foreground font-bold">Itens criados</p>
                      <p className="text-sm font-semibold">{formatIntOrDash(nomusSelectedDetail.summary?.metrics?.itemsCreated)}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                    <div>
                      <p className="font-semibold">Status</p>
                      <p>{nomusSelectedDetail.summary?.status ?? "—"}</p>
                    </div>
                    <div>
                      <p className="font-semibold">Exit code</p>
                      <p>{formatIntOrDash(nomusSelectedDetail.summary?.exitCode)}</p>
                    </div>
                    <div>
                      <p className="font-semibold">Duração</p>
                      <p>{formatDurationMs(nomusSelectedDetail.summary?.durationMs)}</p>
                    </div>
                  </div>
                  <div className="text-sm">
                    <p className="font-semibold mb-1">Motivos de bloqueio</p>
                    {Object.keys(nomusSelectedDetail.summary?.blockedReasons ?? {}).length === 0 ? (
                      <p className="text-muted-foreground">Sem motivos de bloqueio registrados.</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(nomusSelectedDetail.summary?.blockedReasons ?? {}).map(([reason, qty]) => (
                          <span key={reason} className="rounded-full border border-border px-2 py-0.5 text-xs">
                            {reason}: {formatIntOrDash(Number(qty))}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <pre className="max-h-96 overflow-auto rounded-lg border border-border bg-background p-3 text-xs leading-relaxed whitespace-pre-wrap">
                    {nomusSelectedDetail.content || "Sem conteúdo disponível."}
                  </pre>
                </div>
              )}
            </div>
          )}

          {(activeHubSection === "integrations" ||
            activeHubSection === "security" ||
            activeHubSection === "system") && (
            <div className="rounded-2xl border border-border bg-card p-6 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-bold">{HUB_SECTIONS.find((s) => s.id === activeHubSection)?.title}</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    {HUB_SECTIONS.find((s) => s.id === activeHubSection)?.description}
                  </p>
                </div>
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">
                  <AlertCircle className="h-3.5 w-3.5" />
                  Em preparação
                </span>
              </div>
              <div className="rounded-xl border border-dashed border-border bg-accent/20 p-4">
                {activeHubSection === "integrations" && (
                  <p className="text-sm text-muted-foreground">
                    Integrações como Nomus e conectores externos serão habilitadas em etapa futura, com contrato técnico
                    e validação operacional antes de liberar edição nesta tela.
                  </p>
                )}
                {activeHubSection === "security" && (
                  <p className="text-sm text-muted-foreground">
                    Bootstrap de administrador, login e permissionamento ainda não estão implementados neste projeto.
                    Esta seção prepara o ponto de encaixe para as próximas etapas sem simular funcionalidades.
                  </p>
                )}
                {activeHubSection === "system" && (
                  <p className="text-sm text-muted-foreground">
                    Indicadores de saúde, jobs, logs e manutenção sistêmica serão incluídos em fases futuras conforme a
                    evolução operacional do ambiente.
                  </p>
                )}
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
                      {editingItem ? "Editar" : "Novo"} {activeOperationalTab === "roles" ? "Cargo" : "Componente"}
                    </h3>
                  </div>
                </div>
                <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-accent rounded-full transition-colors">
                  <X className="h-5 w-5" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="p-6 space-y-4">
                {activeOperationalTab === "roles" ? (
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
