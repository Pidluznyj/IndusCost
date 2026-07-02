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
import { AppAlert } from "@/src/components/shared/AppAlert";
import { BrandingSettingsPanel } from "@/src/components/BrandingSettingsPanel";
import { AdminUsersModule } from "@/src/components/AdminUsersModule";
import { AccessProfilesModule } from "@/src/components/AccessProfilesModule";
import { NomusDailySyncCard } from "@/src/components/NomusDailySyncCard";
import { NomusAccountsReceivableSyncCard } from "@/src/components/NomusAccountsReceivableSyncCard";
import { NomusAccountsPayableSyncCard } from "@/src/components/NomusAccountsPayableSyncCard";
import { SalesMarginNomusConfigPanel } from "@/src/components/settings/SalesMarginNomusConfigPanel";
import { useAuth } from "@/src/contexts/AuthContext";
import {
  canAccessSettingsSection,
  canManageUsers,
  canViewAccessProfiles,
} from "@/src/lib/modulePermissions";

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

type NomusSyncStatus = "SUCCESS" | "FAILED" | "SKIPPED" | "UNKNOWN";
type NomusSyncKind = "runner" | "sync";
type NomusSyncMode = "apply" | "dry";
type NomusSyncTarget =
  | "customers"
  | "products"
  | "proposals"
  | "sales-orders"
  | "accounts-receivable"
  | "accounts-payable";
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

type PriceTableVersionSummary = {
  productsRead?: unknown;
  itemsCreated?: unknown;
  itemsSkipped?: unknown;
  errors?: unknown;
  warnings?: unknown;
};

type PriceTableVersionView = {
  id: string;
  priceTableId: string;
  taxRuleId?: string | null;
  versionNumber: number;
  status: string;
  generatedAt?: string | null;
  publishedAt?: string | null;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  notes?: string | null;
  createdBy?: string | null;
  approvedBy?: string | null;
  generationSummaryJson?: PriceTableVersionSummary | null;
  createdAt: string;
  updatedAt: string;
};

type PriceTableView = {
  id: string;
  code: string;
  name: string;
  defaultMarginPct: number;
  status: string;
  createdAt: string;
  updatedAt: string;
  latestPublishedVersion?: PriceTableVersionView | null;
  latestDraftVersion?: PriceTableVersionView | null;
  versions?: PriceTableVersionView[];
};

type PriceTableVersionItemView = {
  sku?: string | null;
  productName?: string | null;
  frozenTotalCost?: number | string | null;
  frozenMaterialCost?: number | string | null;
  frozenHhCost?: number | string | null;
  frozenHmCost?: number | string | null;
  frozenTaxCost?: number | string | null;
  frozenOtherCost?: number | string | null;
  marginPct?: number | string | null;
  salePrice?: number | string | null;
};

type PriceTableVersionItemsResponse = {
  version: PriceTableVersionView;
  table: PriceTableView;
  summary?: PriceTableVersionSummary | null;
  pagination?: {
    page?: number;
    limit?: number;
    total?: number;
    totalPages?: number;
  };
  items?: PriceTableVersionItemView[];
};

type TaxRuleLite = {
  id: string;
  name: string;
  status?: string | null;
  TaxComponent?: Array<{ percentage?: number | string | null }>;
};

type DraftGenerationSummary = {
  productsRead: number;
  itemsCreated: number;
  itemsSkipped: number;
  errorsCount: number;
  warningsCount: number;
};

type PublishBlockState = {
  reason: "ERRORS" | "WARNINGS";
  count: number;
  message: string;
};

type HubSection = "globals" | "branding" | "operational" | "nomusSync" | "priceTables" | "integrations" | "security" | "system";
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
    id: "branding",
    title: "Identidade Visual",
    description: "Logos, cores e dados institucionais usados na proposta ao cliente.",
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
    id: "priceTables",
    title: "Tabelas de Preço Comerciais",
    description: "Gerencie versões comerciais de preço por canal, com custos e margens congelados.",
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
    title: "Usuários e Permissões",
    description: "Cadastro de usuários, perfis e permissões por tela do IndusCost.",
    status: "operational",
    note: "Operacional hoje",
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
  const auth = useAuth();
  const canManageUsersPerm = canManageUsers(auth);
  const canViewAccessProfilesPerm = canViewAccessProfiles(auth);
  const canViewSettings = auth.hasPermission("settings.view");
  const canRunNomusDailySync = auth.hasPermission("settings.nomus.sync");
  const [securitySubTab, setSecuritySubTab] = useState<"users" | "accessProfiles">("users");
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
  const [globalsLoadError, setGlobalsLoadError] = useState<string | null>(null);
  const [activeHubSection, setActiveHubSection] = useState<HubSection>("globals");

  const visibleHubSections = React.useMemo(
    () =>
      HUB_SECTIONS.filter((section) => canAccessSettingsSection(section.id, auth)),
    [auth]
  );

  useEffect(() => {
    if (!visibleHubSections.some((s) => s.id === activeHubSection)) {
      const first = visibleHubSections[0]?.id;
      if (first) setActiveHubSection(first);
    }
  }, [activeHubSection, visibleHubSections]);
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
  const [priceTables, setPriceTables] = useState<PriceTableView[]>([]);
  const [priceTablesLoading, setPriceTablesLoading] = useState(false);
  const [priceTablesError, setPriceTablesError] = useState<string | null>(null);
  const [selectedPriceTableId, setSelectedPriceTableId] = useState<string>("");
  const [selectedPriceTableVersionId, setSelectedPriceTableVersionId] = useState<string>("");
  const [priceTableItemsPage, setPriceTableItemsPage] = useState(1);
  const [priceTableItemsLoading, setPriceTableItemsLoading] = useState(false);
  const [priceTableItemsError, setPriceTableItemsError] = useState<string | null>(null);
  const [priceTableItems, setPriceTableItems] = useState<PriceTableVersionItemView[]>([]);
  const [priceTableItemsPagination, setPriceTableItemsPagination] = useState({
    page: 1,
    limit: 50,
    total: 0,
    totalPages: 1,
  });
  const [draftModalOpen, setDraftModalOpen] = useState(false);
  const [taxRulesLoading, setTaxRulesLoading] = useState(false);
  const [taxRulesError, setTaxRulesError] = useState<string | null>(null);
  const [taxRules, setTaxRules] = useState<TaxRuleLite[]>([]);
  const [selectedTaxRuleId, setSelectedTaxRuleId] = useState<string>("");
  const [draftNotes, setDraftNotes] = useState("");
  const [draftConfirmChecked, setDraftConfirmChecked] = useState(false);
  const [draftSubmitting, setDraftSubmitting] = useState(false);
  const [draftFeedbackError, setDraftFeedbackError] = useState<string | null>(null);
  const [draftFeedbackSuccess, setDraftFeedbackSuccess] = useState<string | null>(null);
  const [draftGenerationSummary, setDraftGenerationSummary] = useState<DraftGenerationSummary | null>(null);
  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const [publishEffectiveFrom, setPublishEffectiveFrom] = useState("");
  const [publishApprovedBy, setPublishApprovedBy] = useState("");
  const [publishConfirmChecked, setPublishConfirmChecked] = useState(false);
  const [publishForceConfirmChecked, setPublishForceConfirmChecked] = useState(false);
  const [publishSubmitting, setPublishSubmitting] = useState(false);
  const [publishFeedbackError, setPublishFeedbackError] = useState<string | null>(null);
  const [publishFeedbackSuccess, setPublishFeedbackSuccess] = useState<string | null>(null);
  const [publishForceRequired, setPublishForceRequired] = useState(false);
  const [publishBlockState, setPublishBlockState] = useState<PublishBlockState | null>(null);
  const [suppressAutoVersionSelect, setSuppressAutoVersionSelect] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    setGlobalsLoadError(null);
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
      setGlobalsLoadError(
        error instanceof Error ? error.message : "Não foi possível carregar configurações."
      );
    } finally {
      setLoading(false);
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

  const loadPriceTables = async (options?: { keepSelection?: boolean; preferredVersionId?: string | null }) => {
    setPriceTablesLoading(true);
    setPriceTablesError(null);
    try {
      const rows = await fetchJsonOk<PriceTableView[]>("/api/price-tables");
      const list = Array.isArray(rows) ? rows : [];
      const prevTableId = selectedPriceTableId;
      const prevVersionId = selectedPriceTableVersionId;
      setPriceTables(list);
      const keepSelection = options?.keepSelection === true;
      setSelectedPriceTableId((prev) => {
        if (keepSelection && prev && list.some((t) => t.id === prev)) return prev;
        return list[0]?.id ?? "";
      });
      if (!keepSelection) {
        setSelectedPriceTableVersionId("");
        setSuppressAutoVersionSelect(false);
        setPriceTableItems([]);
        setPriceTableItemsError(null);
        setPriceTableItemsPage(1);
      } else if (options?.preferredVersionId) {
        setSelectedPriceTableVersionId(options.preferredVersionId);
        setSuppressAutoVersionSelect(false);
        setPriceTableItemsPage(1);
      } else {
        const tableAfterRefresh = list.find((t) => t.id === prevTableId) ?? null;
        const versionStillExists = !!getDisplayVersions(tableAfterRefresh).some((v) => v.id === prevVersionId);
        if (!versionStillExists) {
          setSelectedPriceTableVersionId("");
          setSuppressAutoVersionSelect(true);
          setPriceTableItems([]);
          setPriceTableItemsError(null);
        }
      }
    } catch (error) {
      setPriceTables([]);
      setPriceTablesError(error instanceof Error ? error.message : "Não foi possível carregar as tabelas de preço.");
    } finally {
      setPriceTablesLoading(false);
    }
  };

  useEffect(() => {
    if (activeHubSection !== "priceTables") return;
    loadPriceTables();
  }, [activeHubSection]);

  const formatDateTimeSafe = (value: string | null | undefined): string => {
    if (!value) return "—";
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return "—";
    return dt.toLocaleString("pt-BR");
  };

  const formatPercentSafe = (value: unknown): string => {
    const n = Number(value);
    if (!Number.isFinite(n)) return "—";
    return `${formatNumber(n, 2)}%`;
  };

  const formatCurrencySafe = (value: unknown): string => {
    const n = Number(value);
    if (!Number.isFinite(n)) return "—";
    return formatCurrency(n, 2);
  };

  const asSummaryCounts = (summary?: PriceTableVersionSummary | null): { errors: number; warnings: number; itemsCreated: number | null } => {
    if (!summary || typeof summary !== "object") return { errors: 0, warnings: 0, itemsCreated: null };
    const errors = Array.isArray(summary.errors) ? summary.errors.length : 0;
    const warnings = Array.isArray(summary.warnings) ? summary.warnings.length : 0;
    const itemsCreatedRaw = Number(summary.itemsCreated);
    const itemsCreated = Number.isFinite(itemsCreatedRaw) ? itemsCreatedRaw : null;
    return { errors, warnings, itemsCreated };
  };

  const getDisplayVersions = (table: PriceTableView | null): PriceTableVersionView[] => {
    if (!table) return [];
    const raw = Array.isArray(table.versions) ? table.versions : [];
    const source = raw.length > 0 ? raw : [table.latestPublishedVersion, table.latestDraftVersion].filter(Boolean) as PriceTableVersionView[];
    const dedup = new Map<string, PriceTableVersionView>();
    for (const v of source) {
      const byId = typeof v?.id === "string" && v.id.trim() ? `id:${v.id}` : null;
      const key = byId ?? `vs:${String(v?.versionNumber ?? "")}:${String(v?.status ?? "")}`;
      if (!dedup.has(key)) dedup.set(key, v);
    }
    return Array.from(dedup.values()).sort((a, b) => Number(b.versionNumber) - Number(a.versionNumber));
  };

  const normalizeIssuePreview = (
    raw: unknown,
    fallbackMessage: string
  ): { productCode: string; warningOrErrorCode: string; message: string }[] => {
    if (!Array.isArray(raw)) return [];
    return raw.slice(0, 5).map((entry) => {
      const o = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
      const productCode = [o.sku, o.productName]
        .map((v) => (typeof v === "string" && v.trim() ? v.trim() : ""))
        .find((v) => v.length > 0) || "—";
      const warningOrErrorCode = [o.code, o.reason, o.errorCode]
        .map((v) => (typeof v === "string" && v.trim() ? v.trim() : ""))
        .find((v) => v.length > 0) || "—";
      const message = typeof o.message === "string" && o.message.trim() ? o.message.trim() : fallbackMessage;
      return { productCode, warningOrErrorCode, message };
    });
  };

  const isPublishedPilotVersion = (table: PriceTableView): boolean => {
    const published = table.latestPublishedVersion;
    if (!published) return false;
    if (published.id === "151a3cbf-ce7c-435c-97ff-7758015db6bf") return true;
    if (table.id === "6a50aa2a-36ad-4a5f-9cbc-9f548264d308") {
      const counts = asSummaryCounts(published.generationSummaryJson ?? null);
      if (counts.itemsCreated !== null && counts.itemsCreated <= 2) return true;
    }
    return false;
  };

  const selectedPriceTable = priceTables.find((t) => t.id === selectedPriceTableId) ?? null;
  const selectedPriceTableVersions = getDisplayVersions(selectedPriceTable);
  const selectedTaxRulesActive = taxRules.filter((r) => String(r.status ?? "ACTIVE").toUpperCase() === "ACTIVE");
  const selectedPriceTableVersion = selectedPriceTableVersions.find((v) => v.id === selectedPriceTableVersionId) ?? null;
  const selectedVersionSummaryCounts = asSummaryCounts(selectedPriceTableVersion?.generationSummaryJson ?? null);
  const selectedVersionSummaryRaw =
    selectedPriceTableVersion?.generationSummaryJson && typeof selectedPriceTableVersion.generationSummaryJson === "object"
      ? (selectedPriceTableVersion.generationSummaryJson as Record<string, unknown>)
      : null;
  const selectedVersionWarningsPreview = normalizeIssuePreview(
    selectedVersionSummaryRaw?.warnings,
    "Aviso de geração identificado. Revise esta versão antes de publicar."
  );
  const selectedVersionErrorsPreview = normalizeIssuePreview(
    selectedVersionSummaryRaw?.errors,
    "Erro de geração identificado. Revise esta versão antes de publicar."
  );
  const selectedVersionItemsCount =
    selectedPriceTableVersionId && selectedPriceTableVersion?.id === selectedPriceTableVersionId
      ? priceTableItemsPagination.total
      : selectedVersionSummaryCounts.itemsCreated ?? null;
  const selectedVersionCanPublish =
    selectedPriceTableVersion?.status === "DRAFT" &&
    selectedVersionSummaryCounts.errors === 0 &&
    (selectedVersionItemsCount == null || Number(selectedVersionItemsCount) > 0);

  const openGenerateDraftModal = async () => {
    if (!selectedPriceTable) return;
    setDraftFeedbackError(null);
    setDraftFeedbackSuccess(null);
    setDraftGenerationSummary(null);
    setDraftNotes("");
    setDraftConfirmChecked(false);
    setSelectedTaxRuleId("");
    setDraftModalOpen(true);
    setTaxRulesLoading(true);
    setTaxRulesError(null);
    try {
      const rows = await fetchJsonOk<TaxRuleLite[]>("/api/tax-rules");
      const list = Array.isArray(rows) ? rows : [];
      setTaxRules(list);
      const firstActive = list.find((r) => String(r.status ?? "ACTIVE").toUpperCase() === "ACTIVE");
      setSelectedTaxRuleId(firstActive?.id ?? "");
    } catch (error) {
      setTaxRules([]);
      setTaxRulesError(error instanceof Error ? error.message : "Não foi possível carregar regras fiscais.");
    } finally {
      setTaxRulesLoading(false);
    }
  };

  const closeGenerateDraftModal = () => {
    if (draftSubmitting) return;
    setDraftModalOpen(false);
  };

  const handleGenerateDraftSubmit = async () => {
    if (!selectedPriceTable) return;
    if (!selectedTaxRuleId) {
      setDraftFeedbackError("Selecione uma regra fiscal ativa para gerar a DRAFT.");
      return;
    }
    if (!draftConfirmChecked) {
      setDraftFeedbackError("Confirme explicitamente a geração da nova versão DRAFT antes de continuar.");
      return;
    }
    setDraftSubmitting(true);
    setDraftFeedbackError(null);
    setDraftFeedbackSuccess(null);
    setDraftGenerationSummary(null);
    try {
      const payload = await fetchJsonOk<{
        version?: { id?: string; versionNumber?: number };
        summary?: {
          productsRead?: unknown;
          itemsCreated?: unknown;
          itemsSkipped?: unknown;
          errors?: unknown[];
          warnings?: unknown[];
        };
      }>(`/api/price-tables/${selectedPriceTable.id}/versions/generate-draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taxRuleId: selectedTaxRuleId,
          includeAllActiveProducts: true,
          notes: draftNotes.trim() || null,
        }),
      });

      const summaryRaw = payload?.summary ?? {};
      const errorsCount = Array.isArray(summaryRaw.errors) ? summaryRaw.errors.length : 0;
      const warningsCount = Array.isArray(summaryRaw.warnings) ? summaryRaw.warnings.length : 0;
      const summaryNormalized: DraftGenerationSummary = {
        productsRead: Number(summaryRaw.productsRead) || 0,
        itemsCreated: Number(summaryRaw.itemsCreated) || 0,
        itemsSkipped: Number(summaryRaw.itemsSkipped) || 0,
        errorsCount,
        warningsCount,
      };
      setDraftGenerationSummary(summaryNormalized);
      setDraftFeedbackSuccess(
        errorsCount > 0 || warningsCount > 0
          ? "Nova versão DRAFT gerada. Revise warnings/erros antes de qualquer publicação."
          : "Nova versão DRAFT gerada com sucesso."
      );

      const preferredVersionId = typeof payload?.version?.id === "string" ? payload.version.id : null;
      await loadPriceTables({ keepSelection: true, preferredVersionId });
    } catch (error) {
      setDraftFeedbackError(error instanceof Error ? error.message : "Não foi possível gerar a versão DRAFT.");
    } finally {
      setDraftSubmitting(false);
    }
  };

  const openPublishModal = () => {
    if (!selectedPriceTableVersion) return;
    setPublishModalOpen(true);
    setPublishEffectiveFrom("");
    setPublishApprovedBy("");
    setPublishConfirmChecked(false);
    setPublishForceConfirmChecked(false);
    setPublishSubmitting(false);
    setPublishFeedbackError(null);
    setPublishFeedbackSuccess(null);
    setPublishForceRequired(false);
    if (selectedVersionSummaryCounts.errors > 0) {
      setPublishBlockState({
        reason: "ERRORS",
        count: selectedVersionSummaryCounts.errors,
        message:
          "Esta versão possui erros de geração e não pode ser publicada. Gere uma nova DRAFT corrigida ou revise os produtos com erro.",
      });
    } else {
      setPublishBlockState(null);
    }
  };

  const closePublishModal = () => {
    if (publishSubmitting) return;
    setPublishModalOpen(false);
  };

  const parseErrorPayload = async (res: Response): Promise<Record<string, unknown>> => {
    try {
      const ct = res.headers.get("content-type");
      if (ct?.includes("application/json")) {
        const data = (await res.json()) as unknown;
        return data && typeof data === "object" ? (data as Record<string, unknown>) : {};
      }
    } catch {
      // ignore parse error
    }
    return {};
  };

  const handlePublishSubmit = async (forcePublishWithWarnings: boolean) => {
    if (!selectedPriceTableVersion || !selectedPriceTable) return;
    if (selectedPriceTableVersion.status !== "DRAFT") {
      setPublishFeedbackError("Apenas versões DRAFT podem ser publicadas.");
      return;
    }
    if (selectedVersionSummaryCounts.errors > 0) {
      setPublishBlockState({
        reason: "ERRORS",
        count: selectedVersionSummaryCounts.errors,
        message:
          "Esta versão possui erros de geração e não pode ser publicada. Gere uma nova DRAFT corrigida ou revise os produtos com erro.",
      });
      return;
    }
    if (!publishConfirmChecked) {
      setPublishFeedbackError("Confirme explicitamente a publicação da versão DRAFT antes de continuar.");
      return;
    }
    if (forcePublishWithWarnings && !publishForceConfirmChecked) {
      setPublishFeedbackError("Confirme explicitamente que aceita publicar mesmo com warnings.");
      return;
    }

    setPublishSubmitting(true);
    setPublishFeedbackError(null);
    setPublishFeedbackSuccess(null);
    try {
      const bodyPayload = {
        effectiveFrom: publishEffectiveFrom ? new Date(publishEffectiveFrom).toISOString() : undefined,
        approvedBy: publishApprovedBy.trim() || null,
        forcePublishWithWarnings,
      };
      const res = await fetch(`/api/price-table-versions/${selectedPriceTableVersion.id}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyPayload),
      });

      if (!res.ok) {
        const payload = await parseErrorPayload(res);
        const msg = typeof payload.error === "string" && payload.error.trim() ? payload.error.trim() : `Erro HTTP ${res.status}`;
        const warningsCount = Number(payload.warningsCount);
        const errorsCount = Number(payload.errorsCount);
        if (
          res.status === 409 &&
          (msg.toLowerCase().includes("warnings") || (Number.isFinite(warningsCount) && warningsCount > 0))
        ) {
          setPublishForceRequired(true);
          setPublishBlockState({
            reason: "WARNINGS",
            count: Number.isFinite(warningsCount) ? warningsCount : selectedVersionSummaryCounts.warnings,
            message:
              "O backend bloqueou a publicação porque existem warnings. Revise os avisos antes de continuar ou confirme a publicação forçada.",
          });
          return;
        }
        if (
          msg.toLowerCase().includes("errors") ||
          (Number.isFinite(errorsCount) && errorsCount > 0)
        ) {
          setPublishBlockState({
            reason: "ERRORS",
            count: Number.isFinite(errorsCount) ? errorsCount : selectedVersionSummaryCounts.errors,
            message:
              "Esta versão possui erros de geração e não pode ser publicada. Gere uma nova DRAFT corrigida ou revise os produtos com erro.",
          });
          return;
        }
        setPublishFeedbackError(msg);
        return;
      }

      const payload = (await res.json()) as {
        archivedVersionsCount?: unknown;
        warningsAccepted?: unknown;
        version?: { id?: string };
      };
      const archivedVersionsCount = Number(payload.archivedVersionsCount);
      const warningsAccepted = payload.warningsAccepted === true;
      const preferredVersionId =
        payload?.version && typeof payload.version.id === "string" ? payload.version.id : selectedPriceTableVersion.id;

      setPublishFeedbackSuccess(
        `Versão publicada com sucesso. Versões arquivadas: ${
          Number.isFinite(archivedVersionsCount) ? archivedVersionsCount : 0
        }${warningsAccepted ? " (warnings aceitos)." : "."}`
      );
      setPublishForceRequired(false);
      setPublishForceConfirmChecked(false);
      setPublishBlockState(null);

      await loadPriceTables({ keepSelection: true, preferredVersionId });
    } catch (error) {
      setPublishFeedbackError(error instanceof Error ? error.message : "Não foi possível publicar a versão.");
    } finally {
      setPublishSubmitting(false);
    }
  };

  useEffect(() => {
    if (activeHubSection !== "priceTables") return;
    if (!selectedPriceTable) {
      setSelectedPriceTableVersionId("");
      return;
    }
    const fallbackVersion =
      selectedPriceTable.latestPublishedVersion?.id ||
      selectedPriceTable.latestDraftVersion?.id ||
      selectedPriceTableVersions[0]?.id ||
      "";
    setSelectedPriceTableVersionId((prev) => {
      if (suppressAutoVersionSelect) return prev;
      if (prev && selectedPriceTableVersions.some((v) => v.id === prev)) return prev;
      return fallbackVersion;
    });
    if (suppressAutoVersionSelect) return;
    setPriceTableItemsPage(1);
  }, [activeHubSection, selectedPriceTableId, selectedPriceTable, selectedPriceTableVersions, suppressAutoVersionSelect]);

  useEffect(() => {
    if (activeHubSection !== "priceTables") return;
    if (!selectedPriceTableVersionId) {
      setPriceTableItems([]);
      setPriceTableItemsError(null);
      return;
    }
    const loadItems = async () => {
      setPriceTableItemsLoading(true);
      setPriceTableItemsError(null);
      try {
        const params = new URLSearchParams();
        params.set("page", String(priceTableItemsPage));
        params.set("limit", "50");
        const payload = await fetchJsonOk<PriceTableVersionItemsResponse>(
          `/api/price-table-versions/${selectedPriceTableVersionId}/items?${params.toString()}`
        );
        setPriceTableItems(Array.isArray(payload.items) ? payload.items : []);
        const p = payload.pagination ?? {};
        setPriceTableItemsPagination({
          page: Number.isFinite(Number(p.page)) ? Number(p.page) : priceTableItemsPage,
          limit: Number.isFinite(Number(p.limit)) ? Number(p.limit) : 50,
          total: Number.isFinite(Number(p.total)) ? Number(p.total) : 0,
          totalPages: Number.isFinite(Number(p.totalPages)) ? Math.max(1, Number(p.totalPages)) : 1,
        });
      } catch (error) {
        setPriceTableItems([]);
        setPriceTableItemsError(error instanceof Error ? error.message : "Não foi possível carregar os itens da versão.");
      } finally {
        setPriceTableItemsLoading(false);
      }
    };
    loadItems();
  }, [activeHubSection, selectedPriceTableVersionId, priceTableItemsPage]);

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
        {visibleHubSections.map((section) => (
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
              {globalsLoadError ? (
                <AppAlert variant="destructive" title="Não foi possível carregar parâmetros globais">
                  {globalsLoadError}
                </AppAlert>
              ) : null}
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

              <SalesMarginNomusConfigPanel />
            </div>
          )}

          {activeHubSection === "branding" && (
            <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
              <BrandingSettingsPanel />
            </div>
          )}

          {activeHubSection === "nomusSync" && (
            <div className="rounded-2xl border border-border bg-card p-6 space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-bold">Logs de Sincronização Nomus</h3>
                  <p className="text-sm text-muted-foreground">
                    Monitoramento das sincronizações Nomus: clientes, produtos, propostas, pedidos de venda e contas a receber.
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Somente leitura na tabela. Pedidos e contas a receber costumam rodar a cada 2 horas; demais destinos conforme
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

              <NomusDailySyncCard
                canRun={canRunNomusDailySync}
                onLogsRefresh={() => setNomusReloadSeq((prev) => prev + 1)}
              />

              <NomusAccountsReceivableSyncCard
                canRun={canRunNomusDailySync}
                onLogsRefresh={() => setNomusReloadSeq((prev) => prev + 1)}
              />

              <NomusAccountsPayableSyncCard
                canRun={canRunNomusDailySync}
                onLogsRefresh={() => setNomusReloadSeq((prev) => prev + 1)}
              />

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
                          "min-w-0 rounded-xl border p-4 flex flex-col gap-2 min-h-[200px]",
                          t.health === "OK" && "border-green-200 bg-green-50/40",
                          t.health === "WARNING" && "border-amber-200 bg-amber-50/40",
                          t.health === "FAILED" && "border-red-200 bg-red-50/40",
                          t.health === "STALE" && "border-orange-200 bg-orange-50/40",
                          t.health === "NO_DATA" && "border-border bg-card/50"
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-xs font-bold uppercase text-muted-foreground">{t.label}</p>
                            <p className="mt-0.5 text-sm font-semibold break-words [overflow-wrap:anywhere]">{t.message}</p>
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
                          <p className="rounded-lg bg-amber-100/80 px-2 py-1.5 text-xs text-amber-900 break-words [overflow-wrap:anywhere]">
                            {t.warning}
                          </p>
                        ) : null}
                        {t.lastRun ? (
                          <div className="space-y-0.5 text-xs text-muted-foreground break-words [overflow-wrap:anywhere]">
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
                  <option value="accounts-receivable">Target: Contas a receber</option>
                  <option value="accounts-payable">Target: Contas a pagar</option>
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

          {activeHubSection === "priceTables" && (
            <div className="rounded-2xl border border-border bg-card p-6 space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-bold">Tabelas de Preço Comerciais</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Visualização administrativa das tabelas e versões congeladas de preço (somente leitura).
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-700">
                    <Info className="h-3.5 w-3.5" />
                    Modo leitura
                  </span>
                  <button
                    type="button"
                    disabled={!selectedPriceTable || priceTablesLoading}
                    onClick={() => void openGenerateDraftModal()}
                    className="inline-flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/10 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Gerar nova DRAFT
                  </button>
                  <button
                    type="button"
                    disabled={priceTablesLoading}
                    onClick={() => void loadPriceTables({ keepSelection: true })}
                    className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold hover:bg-accent disabled:opacity-50"
                  >
                    <RefreshCw className={cn("h-3.5 w-3.5", priceTablesLoading && "animate-spin")} />
                    Atualizar dados
                  </button>
                </div>
              </div>

              {priceTablesLoading ? (
                <div className="p-8 text-center">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto text-primary" />
                </div>
              ) : priceTablesError ? (
                <AppAlert variant="destructive" title="Falha ao carregar tabelas de preço">
                  {priceTablesError}
                </AppAlert>
              ) : priceTables.length === 0 ? (
                <AppAlert variant="info" title="Sem tabelas cadastradas">
                  Nenhuma tabela de preço foi encontrada no momento.
                </AppAlert>
              ) : (
                <>
                  {priceTables.some((t) => isPublishedPilotVersion(t)) && (
                    <AppAlert variant="warning" title="Versão piloto/incompleta identificada">
                      Atenção: a versão publicada atual é piloto/incompleta e contém apenas uma amostra de produtos. Ela
                      ainda não deve ser tratada como tabela comercial oficial completa.
                    </AppAlert>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                    {priceTables.map((table) => {
                      const selected = selectedPriceTableId === table.id;
                      const latestReference = table.latestDraftVersion ?? table.latestPublishedVersion ?? null;
                      const latestCounts = asSummaryCounts(latestReference?.generationSummaryJson ?? null);
                      return (
                        <button
                          key={table.id}
                          type="button"
                          onClick={() => {
                            setSuppressAutoVersionSelect(false);
                            setSelectedPriceTableId(table.id);
                          }}
                          className={cn(
                            "text-left rounded-xl border p-4 space-y-2 transition-all min-w-0",
                            selected ? "border-primary bg-primary/5 shadow-sm" : "border-border bg-card hover:border-primary/40"
                          )}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-bold truncate">{table.name || "—"}</p>
                              <p className="text-xs text-muted-foreground">{table.code || "—"}</p>
                            </div>
                            <span className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold bg-slate-100 text-slate-700">
                              {table.status || "—"}
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground space-y-1">
                            <p>Margem padrão: <span className="font-semibold text-foreground">{formatPercentSafe(table.defaultMarginPct)}</span></p>
                            <p>
                              Versões conhecidas:{" "}
                              <span className="font-semibold text-foreground">{getDisplayVersions(table).length}</span>
                            </p>
                            <p>
                              Publicada:{" "}
                              <span className="font-semibold text-foreground">
                                {table.latestPublishedVersion ? `v${table.latestPublishedVersion.versionNumber}` : "—"}
                              </span>
                            </p>
                            <p>
                              Draft:{" "}
                              <span className="font-semibold text-foreground">
                                {table.latestDraftVersion ? `v${table.latestDraftVersion.versionNumber}` : "—"}
                              </span>
                            </p>
                            <p>
                              Erros/Avisos (últ. geração):{" "}
                              <span className="font-semibold text-foreground">
                                {latestCounts.errors}/{latestCounts.warnings}
                              </span>
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {selectedPriceTable && (
                    <div className="rounded-xl border border-border bg-card/40 p-4 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h4 className="text-sm font-bold">Versões — {selectedPriceTable.name || "—"}</h4>
                        <div className="w-full sm:w-72">
                          <SearchableSelect
                            options={priceTables.map((t) => ({
                              value: t.id,
                              label: `${t.name || "—"} (${t.code || "—"})`,
                              searchTerms: `${t.code || ""} ${t.name || ""}`,
                            }))}
                            value={selectedPriceTableId}
                            onChange={(v) => {
                              setSuppressAutoVersionSelect(false);
                              setSelectedPriceTableId(v);
                            }}
                            placeholder="Selecionar tabela..."
                            emptyMessage="Nenhuma tabela encontrada."
                            className="text-xs"
                          />
                        </div>
                      </div>

                      {selectedPriceTable.latestPublishedVersion ? null : (
                        <AppAlert variant="info" density="compact" title="Sem versão publicada">
                          Esta tabela ainda não possui versão publicada.
                        </AppAlert>
                      )}

                      {selectedPriceTable.latestDraftVersion ? null : (
                        <AppAlert variant="info" density="compact" title="Sem versão DRAFT">
                          Esta tabela não possui versão draft no momento.
                        </AppAlert>
                      )}

                      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                        <h5 className="text-sm font-bold">Resumo da geração (versão selecionada)</h5>
                        {!selectedPriceTableVersion ? (
                          <p className="text-sm text-muted-foreground">Selecione uma versão para visualizar o resumo de geração.</p>
                        ) : !selectedVersionSummaryRaw ? (
                          <p className="text-sm text-muted-foreground">Resumo de geração não disponível para esta versão.</p>
                        ) : (
                          <>
                            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
                              <div className="rounded-lg border border-border bg-background px-3 py-2">
                                <p className="text-[10px] uppercase font-bold text-muted-foreground">Produtos lidos</p>
                                <p className="font-semibold">{Number.isFinite(Number(selectedVersionSummaryRaw.productsRead)) ? Number(selectedVersionSummaryRaw.productsRead) : "—"}</p>
                              </div>
                              <div className="rounded-lg border border-border bg-background px-3 py-2">
                                <p className="text-[10px] uppercase font-bold text-muted-foreground">Itens criados</p>
                                <p className="font-semibold">{selectedVersionSummaryCounts.itemsCreated ?? "—"}</p>
                              </div>
                              <div className="rounded-lg border border-border bg-background px-3 py-2">
                                <p className="text-[10px] uppercase font-bold text-muted-foreground">Itens ignorados</p>
                                <p className="font-semibold">{Number.isFinite(Number(selectedVersionSummaryRaw.itemsSkipped)) ? Number(selectedVersionSummaryRaw.itemsSkipped) : "—"}</p>
                              </div>
                              <div className="rounded-lg border border-border bg-background px-3 py-2">
                                <p className="text-[10px] uppercase font-bold text-muted-foreground">Warnings</p>
                                <p className="font-semibold">{selectedVersionSummaryCounts.warnings}</p>
                              </div>
                              <div className="rounded-lg border border-border bg-background px-3 py-2">
                                <p className="text-[10px] uppercase font-bold text-muted-foreground">Errors</p>
                                <p className="font-semibold">{selectedVersionSummaryCounts.errors}</p>
                              </div>
                            </div>

                            {selectedVersionWarningsPreview.length > 0 && (
                              <div className="space-y-2">
                                <p className="text-xs font-bold uppercase tracking-wide text-amber-700">Prévia de warnings</p>
                                <div className="space-y-2">
                                  {selectedVersionWarningsPreview.map((w, idx) => (
                                    <div key={`warn-${idx}`} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs">
                                      <p><span className="font-semibold">Produto:</span> {w.productCode || "—"}</p>
                                      <p><span className="font-semibold">Código:</span> {w.warningOrErrorCode || "—"}</p>
                                      <p><span className="font-semibold">Mensagem:</span> {w.message || "—"}</p>
                                    </div>
                                  ))}
                                  {selectedVersionSummaryCounts.warnings > selectedVersionWarningsPreview.length && (
                                    <p className="text-xs text-muted-foreground">
                                      Existem mais {selectedVersionSummaryCounts.warnings - selectedVersionWarningsPreview.length} avisos não exibidos.
                                    </p>
                                  )}
                                </div>
                              </div>
                            )}

                            {selectedVersionErrorsPreview.length > 0 && (
                              <div className="space-y-2">
                                <p className="text-xs font-bold uppercase tracking-wide text-red-700">Prévia de errors</p>
                                <div className="space-y-2">
                                  {selectedVersionErrorsPreview.map((e, idx) => (
                                    <div key={`err-${idx}`} className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs">
                                      <p><span className="font-semibold">Produto:</span> {e.productCode || "—"}</p>
                                      <p><span className="font-semibold">Código:</span> {e.warningOrErrorCode || "—"}</p>
                                      <p><span className="font-semibold">Mensagem:</span> {e.message || "—"}</p>
                                    </div>
                                  ))}
                                  {selectedVersionSummaryCounts.errors > selectedVersionErrorsPreview.length && (
                                    <p className="text-xs text-muted-foreground">
                                      Existem mais {selectedVersionSummaryCounts.errors - selectedVersionErrorsPreview.length} erros não exibidos.
                                    </p>
                                  )}
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </div>

                      {selectedPriceTableVersions.length === 0 ? (
                        <p className="text-sm text-muted-foreground">Nenhuma versão registrada para esta tabela.</p>
                      ) : (
                        <div className="overflow-x-auto rounded-xl border border-border">
                          <table className="w-full text-left border-collapse">
                            <thead>
                              <tr className="bg-accent/30 border-b border-border">
                                <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide">Versão</th>
                                <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide">Status</th>
                                <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide">Criada em</th>
                                <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide">Publicada em</th>
                                <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide">Vigência inicial</th>
                                <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide">Aprovado por</th>
                                <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide">Erros</th>
                                <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide">Warnings</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                              {selectedPriceTableVersions.map((version) => {
                                const counts = asSummaryCounts(version.generationSummaryJson ?? null);
                                const isSelectedVersion = selectedPriceTableVersionId === version.id;
                                return (
                                  <tr
                                    key={version.id}
                                    onClick={() => {
                                      setSuppressAutoVersionSelect(false);
                                      setSelectedPriceTableVersionId(version.id);
                                      setPriceTableItemsPage(1);
                                    }}
                                    className={cn(
                                      "hover:bg-accent/20 cursor-pointer",
                                      isSelectedVersion && "bg-primary/5"
                                    )}
                                  >
                                    <td className="px-3 py-2 text-sm font-semibold">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setSuppressAutoVersionSelect(false);
                                          setSelectedPriceTableVersionId(version.id);
                                          setPriceTableItemsPage(1);
                                        }}
                                        className={cn(
                                          "underline-offset-2 hover:underline",
                                          isSelectedVersion && "text-primary"
                                        )}
                                      >
                                        v{version.versionNumber}
                                      </button>
                                    </td>
                                    <td className="px-3 py-2 text-xs">
                                      <span
                                        className={cn(
                                          "inline-flex rounded-full px-2 py-0.5 font-bold",
                                          version.status === "PUBLISHED" && "bg-green-100 text-green-700",
                                          version.status === "DRAFT" && "bg-amber-100 text-amber-700",
                                          version.status === "ARCHIVED" && "bg-slate-100 text-slate-700",
                                          !["PUBLISHED", "DRAFT", "ARCHIVED"].includes(version.status) &&
                                            "bg-slate-100 text-slate-700"
                                        )}
                                      >
                                        {version.status || "—"}
                                      </span>
                                    </td>
                                    <td className="px-3 py-2 text-sm">{formatDateTimeSafe(version.createdAt)}</td>
                                    <td className="px-3 py-2 text-sm">{formatDateTimeSafe(version.publishedAt)}</td>
                                    <td className="px-3 py-2 text-sm">{formatDateTimeSafe(version.effectiveFrom)}</td>
                                    <td className="px-3 py-2 text-sm">{version.approvedBy?.trim() ? version.approvedBy : "—"}</td>
                                    <td className="px-3 py-2 text-sm">{counts.errors}</td>
                                    <td className="px-3 py-2 text-sm">{counts.warnings}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}

                      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h5 className="text-sm font-bold">Itens da versão selecionada</h5>
                          <div className="flex items-center gap-2">
                            {selectedPriceTableVersionId ? (
                              <span className="text-xs text-muted-foreground">
                                Página {priceTableItemsPagination.page} de {priceTableItemsPagination.totalPages}
                              </span>
                            ) : null}
                            {selectedPriceTableVersion ? (
                              <button
                                type="button"
                                onClick={openPublishModal}
                                disabled={!selectedVersionCanPublish}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-green-300 bg-green-50 px-3 py-1.5 text-xs font-semibold text-green-700 hover:bg-green-100 disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                <Save className="h-3.5 w-3.5" />
                                Publicar versão
                              </button>
                            ) : null}
                          </div>
                        </div>

                        {selectedPriceTableVersion && selectedPriceTableVersion.status !== "DRAFT" ? (
                          <AppAlert variant="info" density="compact" title="Publicação indisponível">
                            Apenas versões DRAFT podem ser publicadas nesta etapa.
                          </AppAlert>
                        ) : null}

                        {selectedPriceTableVersion && selectedVersionSummaryCounts.errors > 0 ? (
                          <AppAlert variant="destructive" density="compact" title="Versão bloqueada por erros">
                            Esta versão possui erros de geração e não pode ser publicada. Gere uma nova DRAFT corrigida ou
                            revise os produtos com erro.
                          </AppAlert>
                        ) : null}

                        {selectedPriceTableVersion &&
                        selectedVersionSummaryCounts.errors === 0 &&
                        selectedVersionItemsCount != null &&
                        Number(selectedVersionItemsCount) <= 0 ? (
                          <AppAlert variant="warning" density="compact" title="Versão sem itens criados">
                            Esta DRAFT não possui itens criados e não pode ser publicada.
                          </AppAlert>
                        ) : null}

                        {selectedPriceTableVersionId === "151a3cbf-ce7c-435c-97ff-7758015db6bf" && (
                          <AppAlert variant="warning" density="compact" title="Versão piloto/incompleta">
                            Atenção: esta versão é piloto/incompleta e possui apenas uma amostra de produtos.
                          </AppAlert>
                        )}

                        {!selectedPriceTableVersionId ? (
                          <AppAlert variant="info" density="compact" title="Nenhuma versão selecionada">
                            Selecione uma versão acima para visualizar os itens congelados.
                          </AppAlert>
                        ) : priceTableItemsLoading ? (
                          <div className="p-6 text-center">
                            <Loader2 className="h-5 w-5 animate-spin mx-auto text-primary" />
                          </div>
                        ) : priceTableItemsError ? (
                          <AppAlert variant="destructive" density="compact" title="Erro ao carregar itens">
                            {priceTableItemsError}
                          </AppAlert>
                        ) : priceTableItems.length === 0 ? (
                          <AppAlert variant="info" density="compact" title="Versão sem itens">
                            Esta versão não possui itens de tabela para exibição.
                          </AppAlert>
                        ) : (
                          <>
                            <div className="overflow-x-auto rounded-xl border border-border">
                              <table className="w-full text-left border-collapse">
                                <thead>
                                  <tr className="bg-accent/30 border-b border-border">
                                    <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide">SKU</th>
                                    <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide">Produto</th>
                                    <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide">Custo total</th>
                                    <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide">MP</th>
                                    <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide">HH</th>
                                    <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide">HM</th>
                                    <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide">Imposto</th>
                                    <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide">Outros</th>
                                    <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide">Margem</th>
                                    <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide">Preço venda</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-border">
                                  {priceTableItems.map((item, idx) => (
                                    <tr key={`${item.sku ?? "item"}-${idx}`} className="hover:bg-accent/20">
                                      <td className="px-3 py-2 text-sm">{item.sku?.trim() ? item.sku : "—"}</td>
                                      <td className="px-3 py-2 text-sm">{item.productName?.trim() ? item.productName : "—"}</td>
                                      <td className="px-3 py-2 text-sm">{formatCurrencySafe(item.frozenTotalCost)}</td>
                                      <td className="px-3 py-2 text-sm">{formatCurrencySafe(item.frozenMaterialCost)}</td>
                                      <td className="px-3 py-2 text-sm">{formatCurrencySafe(item.frozenHhCost)}</td>
                                      <td className="px-3 py-2 text-sm">{formatCurrencySafe(item.frozenHmCost)}</td>
                                      <td className="px-3 py-2 text-sm">{formatCurrencySafe(item.frozenTaxCost)}</td>
                                      <td className="px-3 py-2 text-sm">{formatCurrencySafe(item.frozenOtherCost)}</td>
                                      <td className="px-3 py-2 text-sm">{formatPercentSafe(item.marginPct)}</td>
                                      <td className="px-3 py-2 text-sm font-semibold">{formatCurrencySafe(item.salePrice)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>

                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <p className="text-xs text-muted-foreground">
                                Total de itens: <span className="font-semibold text-foreground">{priceTableItemsPagination.total}</span>
                              </p>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  disabled={priceTableItemsPagination.page <= 1 || priceTableItemsLoading}
                                  onClick={() => setPriceTableItemsPage((prev) => Math.max(1, prev - 1))}
                                  className="px-3 py-1.5 rounded-lg border border-border text-xs font-semibold hover:bg-accent disabled:opacity-50"
                                >
                                  Anterior
                                </button>
                                <button
                                  type="button"
                                  disabled={
                                    priceTableItemsPagination.page >= priceTableItemsPagination.totalPages ||
                                    priceTableItemsLoading
                                  }
                                  onClick={() =>
                                    setPriceTableItemsPage((prev) => Math.min(priceTableItemsPagination.totalPages, prev + 1))
                                  }
                                  className="px-3 py-1.5 rounded-lg border border-border text-xs font-semibold hover:bg-accent disabled:opacity-50"
                                >
                                  Próximo
                                </button>
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {activeHubSection === "security" && (
            <div className="rounded-2xl border border-border bg-card p-6 space-y-4">
              <div className="flex flex-wrap gap-2 border-b border-border pb-3">
                <button
                  type="button"
                  onClick={() => setSecuritySubTab("users")}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-xs font-semibold",
                    securitySubTab === "users"
                      ? "bg-primary text-primary-foreground"
                      : "border border-border hover:bg-accent"
                  )}
                >
                  Usuários
                </button>
                {canViewAccessProfilesPerm ? (
                  <button
                    type="button"
                    onClick={() => setSecuritySubTab("accessProfiles")}
                    className={cn(
                      "rounded-lg px-3 py-1.5 text-xs font-semibold",
                      securitySubTab === "accessProfiles"
                        ? "bg-primary text-primary-foreground"
                        : "border border-border hover:bg-accent"
                    )}
                  >
                    Perfis de Acesso
                  </button>
                ) : null}
              </div>
              {securitySubTab === "users" ? <AdminUsersModule /> : <AccessProfilesModule />}
            </div>
          )}

          {(activeHubSection === "integrations" || activeHubSection === "system") && (
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

      <AnimatePresence>
        {draftModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              className="bg-card w-full max-w-2xl rounded-2xl border border-border shadow-2xl overflow-hidden"
            >
              <div className="p-5 border-b border-border bg-accent/30 flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-bold">Gerar nova versão DRAFT</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Esta ação cria uma nova versão DRAFT e não publica automaticamente.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeGenerateDraftModal}
                  disabled={draftSubmitting}
                  className="p-2 rounded-full hover:bg-accent transition-colors disabled:opacity-50"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="p-5 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                  <div className="rounded-lg border border-border bg-background px-3 py-2">
                    <p className="text-[10px] uppercase font-bold text-muted-foreground">Tabela selecionada</p>
                    <p className="font-semibold">{selectedPriceTable?.name || "—"}</p>
                    <p className="text-xs text-muted-foreground">{selectedPriceTable?.code || "—"}</p>
                  </div>
                  <div className="rounded-lg border border-border bg-background px-3 py-2">
                    <p className="text-[10px] uppercase font-bold text-muted-foreground">Margem padrão</p>
                    <p className="font-semibold">{formatPercentSafe(selectedPriceTable?.defaultMarginPct)}</p>
                  </div>
                </div>

                <AppAlert variant="warning" density="compact" title="Antes de gerar">
                  A geração usará os produtos ativos. Produtos sem custo válido podem ser ignorados. A versão criada ficará
                  em DRAFT para revisão posterior.
                </AppAlert>

                {taxRulesLoading ? (
                  <div className="p-4 text-center">
                    <Loader2 className="h-5 w-5 animate-spin mx-auto text-primary" />
                  </div>
                ) : taxRulesError ? (
                  <AppAlert variant="destructive" density="compact" title="Erro ao carregar regras fiscais">
                    {taxRulesError}
                  </AppAlert>
                ) : selectedTaxRulesActive.length === 0 ? (
                  <AppAlert variant="info" density="compact" title="Nenhuma regra fiscal ativa disponível">
                    Cadastre ou ative uma regra fiscal antes de gerar uma tabela de preço.
                  </AppAlert>
                ) : (
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Regra fiscal ativa</label>
                    <SearchableSelect
                      options={selectedTaxRulesActive.map((rule) => ({
                        value: rule.id,
                        label: rule.name || "—",
                        searchTerms: `${rule.name || ""} ${rule.status || ""}`,
                        sublabel: `${Array.isArray(rule.TaxComponent) ? rule.TaxComponent.length : 0} componente(s) fiscal(is)`,
                      }))}
                      value={selectedTaxRuleId}
                      onChange={setSelectedTaxRuleId}
                      placeholder="Selecionar regra fiscal..."
                      emptyMessage="Nenhuma regra fiscal encontrada."
                    />
                  </div>
                )}

                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Observações (opcional)</label>
                  <textarea
                    value={draftNotes}
                    onChange={(e) => setDraftNotes(e.target.value)}
                    rows={3}
                    className="w-full p-2.5 rounded-lg border border-border bg-background text-sm resize-none"
                    placeholder="Ex.: Geração de revisão comercial do mês."
                    disabled={draftSubmitting}
                  />
                </div>

                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={draftConfirmChecked}
                    onChange={(e) => setDraftConfirmChecked(e.target.checked)}
                    disabled={draftSubmitting}
                    className="mt-0.5"
                  />
                  <span>
                    Confirmo que desejo gerar uma nova versão DRAFT para esta tabela usando os produtos ativos e a regra
                    fiscal selecionada.
                  </span>
                </label>

                {draftFeedbackError && (
                  <AppAlert variant="destructive" density="compact" title="Não foi possível gerar a DRAFT">
                    {draftFeedbackError}
                  </AppAlert>
                )}

                {draftFeedbackSuccess && (
                  <AppAlert variant="success" density="compact" title="Geração concluída">
                    <div className="space-y-1">
                      <p>{draftFeedbackSuccess}</p>
                      {draftGenerationSummary && (
                        <p className="text-xs">
                          Produtos lidos: {draftGenerationSummary.productsRead} | Itens criados: {draftGenerationSummary.itemsCreated} |
                          Itens ignorados: {draftGenerationSummary.itemsSkipped} | Warnings: {draftGenerationSummary.warningsCount} |
                          Errors: {draftGenerationSummary.errorsCount}
                        </p>
                      )}
                    </div>
                  </AppAlert>
                )}
              </div>

              <div className="p-4 border-t border-border flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={closeGenerateDraftModal}
                  disabled={draftSubmitting}
                  className="px-4 py-2 rounded-lg border border-border text-sm hover:bg-accent disabled:opacity-50"
                >
                  Fechar
                </button>
                <button
                  type="button"
                  onClick={() => void handleGenerateDraftSubmit()}
                  disabled={draftSubmitting || !selectedTaxRuleId || !draftConfirmChecked || selectedTaxRulesActive.length === 0}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-50"
                >
                  {draftSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Gerar DRAFT
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {publishModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              className="bg-card w-full max-w-2xl rounded-2xl border border-border shadow-2xl overflow-hidden"
            >
              <div className="p-5 border-b border-border bg-accent/30 flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-bold">Publicar versão DRAFT</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    A publicação arquiva a versão vigente anterior da mesma tabela/regra fiscal e não recalcula preços.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closePublishModal}
                  disabled={publishSubmitting}
                  className="p-2 rounded-full hover:bg-accent transition-colors disabled:opacity-50"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="p-5 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                  <div className="rounded-lg border border-border bg-background px-3 py-2">
                    <p className="text-[10px] uppercase font-bold text-muted-foreground">Tabela</p>
                    <p className="font-semibold">{selectedPriceTable?.name || "—"}</p>
                    <p className="text-xs text-muted-foreground">{selectedPriceTable?.code || "—"}</p>
                  </div>
                  <div className="rounded-lg border border-border bg-background px-3 py-2">
                    <p className="text-[10px] uppercase font-bold text-muted-foreground">Versão selecionada</p>
                    <p className="font-semibold">
                      {selectedPriceTableVersion ? `v${selectedPriceTableVersion.versionNumber}` : "—"}
                    </p>
                    <p className="text-xs text-muted-foreground">Status: {selectedPriceTableVersion?.status || "—"}</p>
                  </div>
                  <div className="rounded-lg border border-border bg-background px-3 py-2">
                    <p className="text-[10px] uppercase font-bold text-muted-foreground">Itens</p>
                    <p className="font-semibold">
                      {selectedVersionItemsCount != null && Number.isFinite(Number(selectedVersionItemsCount))
                        ? String(selectedVersionItemsCount)
                        : "—"}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border bg-background px-3 py-2">
                    <p className="text-[10px] uppercase font-bold text-muted-foreground">Warnings / Errors</p>
                    <p className="font-semibold">
                      {selectedVersionSummaryCounts.warnings} / {selectedVersionSummaryCounts.errors}
                    </p>
                  </div>
                </div>

                <AppAlert variant="info" density="compact" title="Regra de publicação">
                  Esta ação publica a versão DRAFT como vigente. A versão publicada anterior da mesma tabela/regra fiscal
                  será arquivada conforme validações do backend.
                </AppAlert>

                {selectedVersionSummaryCounts.warnings > 0 && selectedVersionSummaryCounts.errors === 0 && (
                  <AppAlert variant="warning" density="compact" title="Esta versão possui warnings">
                    A primeira tentativa será enviada sem force. Se o backend bloquear por warnings (409), você poderá
                    confirmar explicitamente a publicação com warnings.
                  </AppAlert>
                )}

                {publishBlockState?.reason === "ERRORS" && (
                  <AppAlert variant="destructive" density="compact" title="Publicação bloqueada por erros">
                    {publishBlockState.message}
                  </AppAlert>
                )}

                {publishBlockState?.reason === "WARNINGS" && (
                  <AppAlert variant="warning" density="compact" title="Warnings detectados">
                    {publishBlockState.message}
                  </AppAlert>
                )}

                {publishForceRequired && selectedVersionWarningsPreview.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-bold uppercase tracking-wide text-amber-700">Prévia de warnings</p>
                    <div className="space-y-2">
                      {selectedVersionWarningsPreview.map((w, idx) => (
                        <div key={`pub-warn-${idx}`} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs">
                          <p><span className="font-semibold">Produto:</span> {w.productCode || "—"}</p>
                          <p><span className="font-semibold">Código:</span> {w.warningOrErrorCode || "—"}</p>
                          <p><span className="font-semibold">Mensagem:</span> {w.message || "—"}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                      Início de vigência (opcional)
                    </label>
                    <input
                      type="datetime-local"
                      value={publishEffectiveFrom}
                      onChange={(e) => setPublishEffectiveFrom(e.target.value)}
                      disabled={publishSubmitting || publishBlockState?.reason === "ERRORS"}
                      className="w-full p-2.5 rounded-lg border border-border bg-background text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                      Aprovado por (opcional)
                    </label>
                    <input
                      type="text"
                      value={publishApprovedBy}
                      onChange={(e) => setPublishApprovedBy(e.target.value)}
                      disabled={publishSubmitting || publishBlockState?.reason === "ERRORS"}
                      className="w-full p-2.5 rounded-lg border border-border bg-background text-sm"
                      placeholder="Ex.: Gerência Comercial"
                    />
                  </div>
                </div>

                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={publishConfirmChecked}
                    onChange={(e) => setPublishConfirmChecked(e.target.checked)}
                    disabled={publishSubmitting || publishBlockState?.reason === "ERRORS"}
                    className="mt-0.5"
                  />
                  <span>Confirmo que revisei esta versão DRAFT e desejo publicá-la como versão vigente.</span>
                </label>

                {publishForceRequired && (
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={publishForceConfirmChecked}
                      onChange={(e) => setPublishForceConfirmChecked(e.target.checked)}
                      disabled={publishSubmitting}
                      className="mt-0.5"
                    />
                    <span>Estou ciente dos warnings e autorizo a publicação mesmo assim.</span>
                  </label>
                )}

                {publishFeedbackError && (
                  <AppAlert variant="destructive" density="compact" title="Falha na publicação">
                    {publishFeedbackError}
                  </AppAlert>
                )}

                {publishFeedbackSuccess && (
                  <AppAlert variant="success" density="compact" title="Publicação concluída">
                    {publishFeedbackSuccess}
                  </AppAlert>
                )}
              </div>

              <div className="p-4 border-t border-border flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={closePublishModal}
                  disabled={publishSubmitting}
                  className="px-4 py-2 rounded-lg border border-border text-sm hover:bg-accent disabled:opacity-50"
                >
                  Fechar
                </button>
                <button
                  type="button"
                  onClick={() => void handlePublishSubmit(publishForceRequired)}
                  disabled={
                    publishSubmitting ||
                    publishBlockState?.reason === "ERRORS" ||
                    !publishConfirmChecked ||
                    (publishForceRequired && !publishForceConfirmChecked) ||
                    selectedPriceTableVersion?.status !== "DRAFT"
                  }
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-semibold hover:bg-green-700 disabled:opacity-50"
                >
                  {publishSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {publishForceRequired ? "Publicar com warnings" : "Publicar versão"}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

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
