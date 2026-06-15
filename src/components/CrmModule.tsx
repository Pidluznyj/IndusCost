// src/components/CrmModule.tsx — CRM Comercial: cockpit comercial, carteira, perfil e timeline.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Loader2,
  Search,
  Building2,
  Mail,
  Phone,
  MapPin,
  CalendarClock,
  MessageSquare,
  Plus,
  X,
  CheckCircle2,
  Clock,
  UserCircle,
  Pencil,
  Users,
  UserCheck,
  UserX,
  AlertTriangle,
  CalendarDays,
  Sparkles,
  Target,
  Lightbulb,
  History,
  Thermometer,
  Radio,
  MessageCircle,
  Video,
  Briefcase,
  Shield,
  ArrowRight,
  ListTodo,
  Info,
  TrendingUp,
  ShoppingCart,
  FileSpreadsheet,
  Package,
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { fetchJsonOk } from "@/src/lib/http";
import type {
  ManagementBreakdownItem,
  ManagementDashboardResponse,
  ManagementDashboardSummary,
  ManagementFollowUp,
  ManagementOpportunityCustomer,
  ManagementProposalWithoutFollowUp,
  ManagementRiskCustomer,
  ManagementTopCustomer,
} from "@/src/components/crmManagementTypes";

export type {
  ManagementBreakdownItem,
  ManagementDashboardResponse,
  ManagementDashboardSummary,
  ManagementFollowUp,
  ManagementOpportunityCustomer,
  ManagementProposalWithoutFollowUp,
  ManagementRiskCustomer,
  ManagementTopCustomer,
};
import { buildManagementKpiCards } from "@/src/components/crmManagementUi";
import { CrmManagementDashboardSection } from "@/src/components/CrmManagementDashboardSection";
import { CrmManagementLists } from "@/src/components/CrmManagementLists";
import type {
  SellerDashboardResponse,
  SellerDashboardSummary,
  SellerOption,
  SellerDashboardBySeller,
  SellerDashboardOrder,
  SellerDashboardProposalWithoutLinkedOrder,
} from "@/src/components/crmSellerDashboardTypes";

export type {
  SellerDashboardResponse,
  SellerDashboardSummary,
  SellerOption,
  SellerDashboardBySeller,
  SellerDashboardOrder,
  SellerDashboardProposalWithoutLinkedOrder,
};
import {
  SELLER_KEY_ALL,
  buildSellerKpiCards,
  buildSellerOptionKey,
  formatSellerOptionLabel,
  resolveSellerPeriodRange,
  type SellerPeriodPreset,
} from "@/src/components/crmSellerDashboardUi";
import { CrmSellerDashboardSection } from "@/src/components/CrmSellerDashboardSection";
import type { CrmSellerSubTabId } from "@/src/components/CrmSellerSubTabs";
import { CrmSellerDashboardLists } from "@/src/components/CrmSellerDashboardLists";
import {
  CrmCommercialManagementTabs,
  getDefaultCrmManagementTab,
  type CrmManagementTabId,
} from "@/src/components/CrmCommercialManagementTabs";
import { useAuth } from "@/src/contexts/AuthContext";
import {
  canAccessCrmAny,
  canAccessCrmGeneral,
  canAccessCrmSeller,
  canFilterAllCrmSellers,
  isCrmOwnSellerOnly,
  isCrmSellerLinked,
} from "@/src/lib/modulePermissions";
import { AccessDenied } from "@/src/components/AccessDenied";

type SellerDashboardLoadParams = {
  externalSellerId?: number;
  responsible?: string;
  dateFrom?: string;
  dateTo?: string;
};

/** Cliente normalizado vindo de GET /api/crm/customers. */
export type CrmCustomerListItem = {
  id: string;
  displayName: string;
  tradeName: string | null;
  taxId: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  address: string | null;
  lastContactAt: string | null;
  nextFollowUpAt: string | null;
  contactCount: number;
};

export type CrmCustomer = CrmCustomerListItem;

export type CrmCustomerListFilter =
  | "all"
  | "withoutContact30"
  | "withContact30"
  | "overdueFollowUp"
  | "upcomingFollowUp7";

type CrmCustomersApiResponse = {
  customers: CrmCustomerListItem[];
  pagination: { limit: number; offset: number; returned: number; hasMore: boolean };
};

export type CrmActivity = {
  id: string;
  activityType: string;
  subject: string | null;
  description: string | null;
  scheduledAt: string | null;
  completedAt: string | null;
  status: string;
  priority: number | null;
  assignedTo: string | null;
  closeReason: string | null;
  contactDate: string | null;
  channel: string | null;
  reason: string | null;
  outcome: string | null;
  nextActionAt: string | null;
  nextActionDescription: string | null;
  createdByName: string | null;
  createdByPhone: string | null;
  createdByEmail: string | null;
  createdAt: string;
  proposal: { number: number; title: string | null; status: string } | null;
};

type CrmDashboardBasic = {
  totalCustomers: number;
  customersWithContactLast30Days: number;
  customersWithoutContactLast30Days: number;
  overdueFollowUps: number;
  upcomingFollowUpsNext7Days: number;
};

/** GET /api/crm/customers/:customerId/commercial-intelligence (Fase 1H-B). */
type CommercialIntelSignal = {
  type: "RISK" | "OPPORTUNITY" | "INFO" | string;
  severity: "LOW" | "MEDIUM" | "HIGH" | string;
  title: string;
  description: string;
};

type CommercialIntelOrderLite = {
  id: string;
  orderCode: string | null;
  issueDate: string | null;
  status: string | null;
  totalNetValue: number;
};

type CommercialIntelOpenOrderLite = CommercialIntelOrderLite & {
  updatedAt: string;
  responsible: string | null;
  hasInvoicing: boolean;
};

type CommercialIntelNegotiationProposal = {
  id: string;
  number: number;
  title: string | null;
  status: string;
  totalNetValue: number;
  createdAt: string;
  updatedAt: string;
  responsible: string | null;
};

type CommercialIntelResponse = {
  customer: {
    id: string;
    displayName: string;
    taxId: string;
  };
  summary: {
    hasPurchaseHistory: boolean;
    daysSinceLastPurchase: number | null;
    hasOpenOrders: boolean;
    hasOrderWithoutFollowUp: boolean;
    hasOpenProposals?: boolean;
    hasProposalWithoutFollowUp?: boolean;
    riskLevel: "LOW" | "MEDIUM" | "HIGH" | string;
    nextSuggestedAction: string;
  };
  orders: {
    lastOrder: CommercialIntelOrderLite | null;
    lastOrders: CommercialIntelOrderLite[];
    totalPurchasedLast12Months: number;
    ordersLast12MonthsCount: number;
  };
  openOrders: {
    lastOrder: CommercialIntelOpenOrderLite | null;
    lastOpenOrder: CommercialIntelOpenOrderLite | null;
    latestOrders: CommercialIntelOpenOrderLite[];
    latestOpenOrders: CommercialIntelOpenOrderLite[];
    openOrdersCount: number;
    openOrdersValue: number;
    ordersWithoutFollowUpCount: number;
    ordersWithoutFollowUp: Array<{
      id: string;
      orderCode: string;
      status: string;
      totalNetValue: number;
      updatedAt: string;
      daysWithoutFollowUp: number;
    }>;
    followUpNote: string;
  };
  proposals?: {
    _deprecated: true;
    _note: string;
    negotiationCount: number;
    latestNegotiationProposals: CommercialIntelNegotiationProposal[];
  };
  signals: CommercialIntelSignal[];
};

type ActivitiesResponse = { activities: CrmActivity[] };

const CRM_LIST_LIMIT = 50;
const CRM_ACTIVITY_LIMIT = 50;
const CRM_AGENDA_BUCKET_LIMIT = 10;
const CRM_AGENDA_PREVIEW_COUNT = 3;

type CrmAgendaFilter = Exclude<CrmCustomerListFilter, "all">;

type CrmAgendaBuckets = Record<CrmAgendaFilter, CrmCustomerListItem[]>;

const CRM_AGENDA_CARDS: {
  filter: CrmAgendaFilter;
  title: string;
  description: string;
  emptyMessage: string;
  badgeLabel: string;
  badgeClass: string;
  countFromDashboard: (d: CrmDashboardBasic) => number;
  cardClass: string;
  icon: LucideIcon;
  iconClass: string;
}[] = [
  {
    filter: "overdueFollowUp",
    title: "Follow-ups atrasados",
    description: "Clientes com ação comercial vencida.",
    emptyMessage: "Nenhum follow-up atrasado.",
    badgeLabel: "Atrasado",
    badgeClass: "border-red-200 bg-red-50 text-red-900",
    countFromDashboard: (d) => d.overdueFollowUps,
    cardClass: "border-red-200/80 bg-gradient-to-br from-red-50/50 to-card",
    icon: AlertTriangle,
    iconClass: "text-red-700 bg-red-100",
  },
  {
    filter: "upcomingFollowUp7",
    title: "Próximos 7 dias",
    description: "Clientes com próxima ação agendada.",
    emptyMessage: "Nenhum follow-up agendado para os próximos 7 dias.",
    badgeLabel: "Próximos 7d",
    badgeClass: "border-sky-200 bg-sky-50 text-sky-900",
    countFromDashboard: (d) => d.upcomingFollowUpsNext7Days,
    cardClass: "border-sky-200/80 bg-gradient-to-br from-sky-50/60 to-card",
    icon: CalendarDays,
    iconClass: "text-sky-800 bg-sky-100",
  },
  {
    filter: "withoutContact30",
    title: "Sem contato há 30 dias",
    description: "Clientes sem contato comercial recente.",
    emptyMessage: "Nenhum cliente pendente neste filtro.",
    badgeLabel: "Sem contato",
    badgeClass: "border-amber-200 bg-amber-50 text-amber-900",
    countFromDashboard: (d) => d.customersWithoutContactLast30Days,
    cardClass: "border-amber-200/80 bg-gradient-to-br from-amber-50/50 to-card",
    icon: UserX,
    iconClass: "text-amber-800 bg-amber-100",
  },
  {
    filter: "withContact30",
    title: "Com contato recente",
    description: "Clientes trabalhados nos últimos 30 dias.",
    emptyMessage: "Nenhum contato recente registrado.",
    badgeLabel: "Recente",
    badgeClass: "border-emerald-200 bg-emerald-50 text-emerald-900",
    countFromDashboard: (d) => d.customersWithContactLast30Days,
    cardClass: "border-emerald-200/80 bg-gradient-to-br from-emerald-50/50 to-card",
    icon: UserCheck,
    iconClass: "text-emerald-800 bg-emerald-100",
  },
];

const CHANNEL_OPTIONS = [
  "WHATSAPP",
  "PHONE",
  "EMAIL",
  "MEETING",
  "VISIT",
  "VIDEO_CALL",
  "OTHER",
] as const;

const REASON_OPTIONS = [
  "PROSPECTION",
  "FOLLOW_UP",
  "PROPOSAL",
  "NEGOTIATION",
  "POST_SALE",
  "REACTIVATION",
  "COMPLAINT",
  "RELATIONSHIP",
  "OTHER",
] as const;

const STATUS_OPTIONS = ["DONE", "OPEN", "WAITING", "CANCELLED"] as const;

export type CrmCustomerProfile = {
  id: string;
  customerId: string;
  preferredChannel: string | null;
  bestContactTime: string | null;
  contactFrequency: string | null;
  communicationStyle: string | null;
  commercialProfile: string | null;
  buyingMotivation: string | null;
  commonObjections: string | null;
  relationshipLevel: string | null;
  commercialTemperature: string | null;
  interests: string | null;
  favoriteTeam: string | null;
  importantDates: string | null;
  personalPreferences: string | null;
  avoidTopics: string | null;
  relationshipNotes: string | null;
  informationSource: string | null;
  sensitivityLevel: string;
  lastConfirmedAt: string | null;
  updatedByName: string | null;
  createdAt: string;
  updatedAt: string;
};

type CrmProfileApiResponse = {
  customer: { id: string; displayName: string; taxId: string };
  profile: CrmCustomerProfile | null;
};

type ProfileFormState = {
  preferredChannel: string;
  bestContactTime: string;
  contactFrequency: string;
  communicationStyle: string;
  commercialProfile: string;
  buyingMotivation: string;
  commonObjections: string;
  relationshipLevel: string;
  commercialTemperature: string;
  interests: string;
  favoriteTeam: string;
  importantDates: string;
  personalPreferences: string;
  avoidTopics: string;
  relationshipNotes: string;
  informationSource: string;
  sensitivityLevel: string;
  lastConfirmedAt: string;
  updatedByName: string;
};

const PROFILE_CHANNEL_OPTIONS = [
  "WHATSAPP",
  "PHONE",
  "EMAIL",
  "MEETING",
  "VISIT",
  "VIDEO_CALL",
  "OTHER",
] as const;

const PROFILE_CONTACT_FREQUENCY_OPTIONS = [
  "Semanal",
  "Quinzenal",
  "Mensal",
  "A cada 30 dias",
  "A cada 60 dias",
  "Sob demanda",
] as const;

const PROFILE_COMMERCIAL_PROFILE_OPTIONS = [
  "Compra recorrente",
  "Cliente estratégico",
  "Reativação",
  "Novo cliente",
  "Sensível a preço",
  "Sensível a prazo",
  "Técnico/detalhista",
] as const;

const PROFILE_RELATIONSHIP_LEVEL_OPTIONS = [
  "NOVO",
  "ATIVO",
  "ESTRATEGICO",
  "EM_RISCO",
  "INATIVO",
  "REATIVACAO",
] as const;

const PROFILE_TEMPERATURE_OPTIONS = ["FRIO", "MORNO", "QUENTE"] as const;

const PROFILE_SENSITIVITY_OPTIONS = ["NORMAL", "ATTENTION", "SENSITIVE_AVOID"] as const;

const PROFILE_UPDATED_BY_DEFAULT = "Comercial Lazarios";

const EMPTY_PROFILE_FORM: ProfileFormState = {
  preferredChannel: "WHATSAPP",
  bestContactTime: "",
  contactFrequency: "",
  communicationStyle: "",
  commercialProfile: "",
  buyingMotivation: "",
  commonObjections: "",
  relationshipLevel: "",
  commercialTemperature: "",
  interests: "",
  favoriteTeam: "",
  importantDates: "",
  personalPreferences: "",
  avoidTopics: "",
  relationshipNotes: "",
  informationSource: "",
  sensitivityLevel: "NORMAL",
  lastConfirmedAt: "",
  updatedByName: PROFILE_UPDATED_BY_DEFAULT,
};

function strField(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

/** Nome exibido: prioriza campos reais do IndusCost (`companyName`, `tradeName`, …). */
export function getCustomerDisplayName(customer: CrmCustomer): string {
  const row = customer as unknown as Record<string, unknown>;
  const keys = [
    "displayName",
    "companyName",
    "tradeName",
    "legalName",
    "corporateName",
    "name",
    "nome",
    "razaoSocial",
    "nomeFantasia",
    "customerName",
  ] as const;
  for (const k of keys) {
    const s = strField(row[k]);
    if (s) return s;
  }
  const doc = getCustomerTaxId(customer);
  if (doc !== "—") return doc;
  return "Cliente sem nome";
}

export function getCustomerTaxId(customer: CrmCustomer): string {
  const row = customer as unknown as Record<string, unknown>;
  const keys = ["taxId", "cnpj", "cnpjCpf", "document", "taxDocument", "cpf"] as const;
  for (const k of keys) {
    const s = strField(row[k]);
    if (s) return s;
  }
  return "—";
}

function displayLine(v: unknown): string {
  const s = strField(v);
  return s || "—";
}

function formatCityState(city: unknown, state: unknown): string {
  const c = strField(city);
  const s = strField(state);
  if (c && s) return `${c} / ${s}`;
  if (c) return c;
  if (s) return s;
  return "—";
}

function parseActivityDate(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function formatDateShortPt(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatIntelCurrency(value: unknown): string {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(n)) {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(0);
  }
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
}

function formatNumberPt(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("pt-BR");
}

/** Texto específico do KPI “dias desde última compra” na inteligência (0 = “0 dias”). */
function formatIntelDaysSinceLastPurchase(value: number | null): string {
  if (value === null) return "—";
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "0 dias";
  if (value === 1) return "1 dia";
  return `${value} dias`;
}

function formatCommercialStatusLabel(raw: string | null | undefined): string {
  if (raw === null || raw === undefined || raw === "") return "—";
  const u = String(raw).trim();
  const proposalLabels: Record<string, string> = {
    DRAFT: "Rascunho",
    ANALYSIS: "Em análise",
    SENT: "Enviada",
    APPROVED: "Aprovada",
    REJECTED: "Rejeitada",
    EXPIRED: "Expirada",
    CANCELED: "Cancelada",
    CANCELLED: "Cancelada",
  };
  const orderLabels: Record<string, string> = {
    DRAFT: "Rascunho",
    READY_TO_SEND: "Pronto para envio",
    SENT_TO_NOMUS: "Enviado ao Nomus",
    CANCELLED: "Cancelado",
    ERROR: "Erro",
  };
  return proposalLabels[u] ?? orderLabels[u] ?? displayLine(u.replace(/_/g, " "));
}

function clampMessage(msg: string, max = 220): string {
  const t = msg.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

function formatDateTimePt(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function datetimeLocalNow(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function datetimeLocalToIso(value: string): string | undefined {
  if (!value.trim()) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

function sortActivitiesDesc(a: CrmActivity, b: CrmActivity): number {
  const ac = parseActivityDate(a.contactDate) || parseActivityDate(a.createdAt);
  const bc = parseActivityDate(b.contactDate) || parseActivityDate(b.createdAt);
  if (bc !== ac) return bc - ac;
  return parseActivityDate(b.createdAt) - parseActivityDate(a.createdAt);
}

function statusIsOpenLike(s: string): boolean {
  const u = s.trim().toUpperCase();
  return u === "OPEN" || u === "WAITING";
}

function channelBadgeClass(channel: string | null): string {
  return getActivityChannelIcon(channel).badgeClass;
}

type CockpitTab = "timeline" | "profile";

type ChannelVisual = {
  Icon: LucideIcon;
  dotClass: string;
  badgeClass: string;
};

function getActivityChannelIcon(channel: string | null): ChannelVisual {
  const c = (channel ?? "").toUpperCase();
  if (c === "WHATSAPP") {
    return {
      Icon: MessageCircle,
      dotClass: "bg-emerald-100 text-emerald-700 border-emerald-200",
      badgeClass: "bg-emerald-100 text-emerald-800 border-emerald-200",
    };
  }
  if (c === "PHONE") {
    return {
      Icon: Phone,
      dotClass: "bg-sky-100 text-sky-700 border-sky-200",
      badgeClass: "bg-sky-100 text-sky-800 border-sky-200",
    };
  }
  if (c === "VIDEO_CALL") {
    return {
      Icon: Video,
      dotClass: "bg-cyan-100 text-cyan-800 border-cyan-200",
      badgeClass: "bg-cyan-100 text-cyan-800 border-cyan-200",
    };
  }
  if (c === "EMAIL") {
    return {
      Icon: Mail,
      dotClass: "bg-indigo-100 text-indigo-800 border-indigo-200",
      badgeClass: "bg-indigo-100 text-indigo-800 border-indigo-200",
    };
  }
  if (c === "MEETING") {
    return {
      Icon: Briefcase,
      dotClass: "bg-amber-100 text-amber-900 border-amber-200",
      badgeClass: "bg-amber-100 text-amber-900 border-amber-200",
    };
  }
  if (c === "VISIT") {
    return {
      Icon: MapPin,
      dotClass: "bg-orange-100 text-orange-900 border-orange-200",
      badgeClass: "bg-orange-100 text-orange-900 border-orange-200",
    };
  }
  return {
    Icon: MessageSquare,
    dotClass: "bg-slate-100 text-slate-700 border-slate-200",
    badgeClass: "bg-muted text-muted-foreground border-border",
  };
}

function getActivityStatusBadge(status: string): { label: string; className: string } {
  const u = status.trim().toUpperCase();
  if (u === "DONE") {
    return { label: "Concluído", className: "bg-emerald-50 text-emerald-800 border-emerald-200" };
  }
  if (u === "OPEN") {
    return { label: "Aberto", className: "bg-sky-50 text-sky-800 border-sky-200" };
  }
  if (u === "WAITING") {
    return { label: "Aguardando", className: "bg-amber-50 text-amber-900 border-amber-200" };
  }
  if (u === "CANCELLED" || u === "CANCELED") {
    return { label: "Cancelado", className: "bg-slate-100 text-slate-600 border-slate-200" };
  }
  return {
    label: displayLine(status),
    className: "bg-muted/80 text-muted-foreground border-border",
  };
}

function isActivityFollowUpOverdue(activity: CrmActivity): boolean {
  if (!activity.nextActionAt) return false;
  const u = activity.status.trim().toUpperCase();
  if (u === "DONE" || u === "CANCELLED" || u === "CANCELED") return false;
  return parseActivityDate(activity.nextActionAt) < Date.now();
}

function isoToDateInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function dateInputToIso(value: string): string | null {
  const t = value.trim();
  if (!t) return null;
  const d = new Date(`${t}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function profileToForm(profile: CrmCustomerProfile | null): ProfileFormState {
  if (!profile) return { ...EMPTY_PROFILE_FORM };
  return {
    preferredChannel: profile.preferredChannel ?? "WHATSAPP",
    bestContactTime: profile.bestContactTime ?? "",
    contactFrequency: profile.contactFrequency ?? "",
    communicationStyle: profile.communicationStyle ?? "",
    commercialProfile: profile.commercialProfile ?? "",
    buyingMotivation: profile.buyingMotivation ?? "",
    commonObjections: profile.commonObjections ?? "",
    relationshipLevel: profile.relationshipLevel ?? "",
    commercialTemperature: profile.commercialTemperature ?? "",
    interests: profile.interests ?? "",
    favoriteTeam: profile.favoriteTeam ?? "",
    importantDates: profile.importantDates ?? "",
    personalPreferences: profile.personalPreferences ?? "",
    avoidTopics: profile.avoidTopics ?? "",
    relationshipNotes: profile.relationshipNotes ?? "",
    informationSource: profile.informationSource ?? "",
    sensitivityLevel: profile.sensitivityLevel || "NORMAL",
    lastConfirmedAt: isoToDateInput(profile.lastConfirmedAt),
    updatedByName: profile.updatedByName?.trim() || PROFILE_UPDATED_BY_DEFAULT,
  };
}

function sensitivityLabel(value: string | null | undefined): string {
  const u = String(value ?? "").trim().toUpperCase();
  if (u === "ATTENTION") return "Atenção";
  if (u === "SENSITIVE_AVOID") return "Evitar abordagem sensível";
  return "Normal";
}

type ApproachGuideBlocks = {
  empty: boolean;
  howToApproach: string | null;
  highlight: string | null;
  attention: string | null;
};

function buildApproachGuideBlocks(profile: CrmCustomerProfile | null): ApproachGuideBlocks {
  if (!profile) {
    return { empty: true, howToApproach: null, highlight: null, attention: null };
  }
  const channel = strField(profile.preferredChannel);
  const style = strField(profile.communicationStyle);
  let howToApproach: string | null = null;
  if (channel && style) {
    howToApproach = `Entrar por ${channel}, com comunicação ${style.toLowerCase()}, retomando o último contexto comercial.`;
  } else if (channel) {
    howToApproach = `Entrar por ${channel}, retomando o último contexto comercial.`;
  }
  const highlight = strField(profile.buyingMotivation) || null;
  const attention = strField(profile.commonObjections) || null;
  return {
    empty: !howToApproach && !highlight && !attention,
    howToApproach,
    highlight,
    attention,
  };
}

function temperatureBadgeClass(temp: string | null | undefined): string {
  const u = String(temp ?? "").trim().toUpperCase();
  if (u === "FRIO") return "bg-slate-100 text-slate-700 border-slate-200";
  if (u === "MORNO") return "bg-amber-100 text-amber-900 border-amber-200";
  if (u === "QUENTE") return "bg-emerald-100 text-emerald-800 border-emerald-200";
  return "bg-muted/80 text-muted-foreground border-border";
}

function hasProfileFieldValue(v: unknown): boolean {
  return strField(v).length > 0;
}

function ProfileDetailRow({ label, value }: { label: string; value: unknown }) {
  if (!hasProfileFieldValue(value)) return null;
  return (
    <div className="min-w-0 py-1">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium text-foreground break-words mt-0.5">{displayLine(value)}</dd>
    </div>
  );
}

function ProfileBlockSection({
  title,
  icon: Icon,
  emptyHint = "Ainda sem dados registrados.",
  children,
}: {
  title: string;
  icon?: LucideIcon;
  emptyHint?: string;
  children: React.ReactNode;
}) {
  const childArray = React.Children.toArray(children).filter(Boolean);
  if (childArray.length === 0) {
    return (
      <div className="rounded-xl border border-border/60 bg-muted/15 p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-2 text-muted-foreground">
          {Icon ? <Icon className="h-4 w-4 shrink-0" /> : null}
          <h4 className="text-sm font-bold text-foreground">{title}</h4>
        </div>
        <p className="text-sm text-muted-foreground">{emptyHint}</p>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-border/60 bg-card/80 p-5 shadow-sm space-y-4">
      <div className="flex items-center gap-2">
        {Icon ? (
          <div className="rounded-lg bg-primary/10 p-2 text-primary shrink-0">
            <Icon className="h-4 w-4" />
          </div>
        ) : null}
        <h4 className="text-sm font-bold text-foreground">{title}</h4>
      </div>
      <dl className="grid gap-2 sm:grid-cols-2">{children}</dl>
    </div>
  );
}

function StatChip({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  accent?: string;
}) {
  return (
    <div className={cn("rounded-xl border border-border/80 bg-background/80 p-4 shadow-sm", accent)}>
      <div className="flex items-center gap-2 text-muted-foreground mb-2">
        <Icon className="h-4 w-4 shrink-0" />
        <span className="text-[11px] font-semibold uppercase tracking-wide">{label}</span>
      </div>
      <p className="text-sm font-bold text-foreground leading-snug">{value}</p>
    </div>
  );
}

function ApproachGuideCard({ guide, hasProfile }: { guide: ApproachGuideBlocks; hasProfile: boolean }) {
  return (
    <div className="rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/8 via-card to-card p-6 shadow-sm space-y-5">
      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-primary/15 p-2.5 text-primary shrink-0">
          <Lightbulb className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-foreground">Guia rápido para abordagem</h3>
          <p className="text-sm text-muted-foreground">Orientações práticas para o próximo contato.</p>
        </div>
      </div>
      {!hasProfile || guide.empty ? (
        <p className="text-sm text-muted-foreground rounded-xl border border-dashed border-border bg-muted/20 px-4 py-3">
          Complete o perfil de relacionamento para orientar melhor os próximos contatos.
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-border/80 bg-background/90 p-4 space-y-2">
            <div className="flex items-center gap-2 text-primary">
              <Target className="h-4 w-4 shrink-0" />
              <span className="text-[11px] font-bold uppercase tracking-wide">Como abordar</span>
            </div>
            <p className="text-sm font-medium text-foreground leading-relaxed">
              {guide.howToApproach ?? "Defina canal e estilo no perfil."}
            </p>
          </div>
          <div className="rounded-xl border border-border/80 bg-background/90 p-4 space-y-2">
            <div className="flex items-center gap-2 text-emerald-700">
              <Sparkles className="h-4 w-4 shrink-0" />
              <span className="text-[11px] font-bold uppercase tracking-wide">O que destacar</span>
            </div>
            <p className="text-sm font-medium text-foreground leading-relaxed">
              {guide.highlight ?? "Registre motivação de compra no perfil."}
            </p>
          </div>
          <div className="rounded-xl border border-border/80 bg-background/90 p-4 space-y-2">
            <div className="flex items-center gap-2 text-amber-800">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span className="text-[11px] font-bold uppercase tracking-wide">Ponto de atenção</span>
            </div>
            <p className="text-sm font-medium text-foreground leading-relaxed">
              {guide.attention ?? "Registre objeções comuns no perfil."}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function ActivityStatusBadge({ activity }: { activity: CrmActivity }) {
  const statusBadge = getActivityStatusBadge(activity.status);
  const overdue = isActivityFollowUpOverdue(activity);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span
        className={cn(
          "text-[10px] uppercase font-bold px-2.5 py-1 rounded-full border",
          statusBadge.className
        )}
      >
        {statusBadge.label}
      </span>
      {overdue ? (
        <span className="text-[10px] uppercase font-bold px-2.5 py-1 rounded-full border bg-red-50 text-red-800 border-red-200">
          Atrasado
        </span>
      ) : null}
    </div>
  );
}

type CommercialTimelineItemProps = {
  activity: CrmActivity;
  isLast: boolean;
  onMarkDone: (activity: CrmActivity) => void | Promise<void>;
};

const CommercialTimelineItem: React.FC<CommercialTimelineItemProps> = ({
  activity,
  isLast,
  onMarkDone,
}) => {
  const channel = getActivityChannelIcon(activity.channel);
  const ChannelIcon = channel.Icon;
  return (
    <li className="relative pl-10 pb-8 last:pb-0">
      {!isLast ? (
        <span className="absolute left-[15px] top-10 bottom-0 w-0.5 bg-slate-200" aria-hidden />
      ) : null}
      <div
        className={cn(
          "absolute left-0 top-1 z-10 flex h-8 w-8 items-center justify-center rounded-full border shadow-sm",
          channel.dotClass
        )}
      >
        <ChannelIcon className="h-4 w-4" />
      </div>
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <span className="text-sm font-bold text-foreground tabular-nums">
              {formatDateTimePt(activity.contactDate ?? activity.createdAt)}
            </span>
            <span
              className={cn(
                "text-[10px] uppercase font-bold px-2.5 py-1 rounded-full border",
                channel.badgeClass
              )}
            >
              {displayLine(activity.channel)}
            </span>
            <span className="text-[10px] uppercase font-semibold px-2.5 py-1 rounded-full border border-border bg-muted/50 text-muted-foreground">
              {displayLine(activity.reason)}
            </span>
            <ActivityStatusBadge activity={activity} />
          </div>
          {statusIsOpenLike(activity.status) ? (
            <button
              type="button"
              onClick={() => onMarkDone(activity)}
              className="text-xs font-semibold rounded-xl border border-border px-3 py-1.5 hover:bg-accent shrink-0"
            >
              Marcar como concluído
            </button>
          ) : null}
        </div>
        {activity.subject ? (
          <p className="text-base font-semibold text-foreground">{displayLine(activity.subject)}</p>
        ) : null}
        {activity.description ? (
          <p className="text-sm text-muted-foreground whitespace-pre-wrap break-words leading-relaxed">
            {displayLine(activity.description)}
          </p>
        ) : null}
        <div className="grid gap-3 text-sm sm:grid-cols-2 pt-2 border-t border-border/80">
          <p>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground block mb-0.5">
              Resultado
            </span>
            <span className="font-medium">{displayLine(activity.outcome)}</span>
          </p>
          <p>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground block mb-0.5">
              Responsável
            </span>
            <span className="font-medium">{displayLine(activity.assignedTo)}</span>
          </p>
          {(activity.nextActionAt || activity.nextActionDescription) && (
            <p className="sm:col-span-2 flex items-start gap-2 rounded-xl bg-muted/30 border border-border/60 px-3 py-2">
              <Clock className="h-4 w-4 text-primary mt-0.5 shrink-0" />
              <span>
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground block">
                  Próxima ação
                </span>
                <span className="font-medium">
                  {activity.nextActionAt ? formatDateTimePt(activity.nextActionAt) : "—"}
                  {activity.nextActionDescription
                    ? ` — ${displayLine(activity.nextActionDescription)}`
                    : ""}
                </span>
              </span>
            </p>
          )}
        </div>
      </div>
    </li>
  );
};

function intelRiskBadgeClasses(level: string): string {
  const u = level.toUpperCase();
  if (u === "HIGH") return "border-rose-300 bg-rose-50 text-rose-950";
  if (u === "MEDIUM") return "border-amber-300 bg-amber-50 text-amber-950";
  return "border-emerald-300 bg-emerald-50 text-emerald-950";
}

function intelRiskLevelLabelPt(level: string): string {
  const u = level.toUpperCase();
  if (u === "HIGH") return "Alto";
  if (u === "MEDIUM") return "Médio";
  return "Baixo";
}

function intelSeverityBadgeClasses(severity: string): string {
  const u = severity.toUpperCase();
  if (u === "HIGH") return "border-rose-200 bg-rose-50 text-rose-900";
  if (u === "MEDIUM") return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function intelSeverityLabelPt(severity: string): string {
  const u = severity.toUpperCase();
  if (u === "HIGH") return "Alta";
  if (u === "MEDIUM") return "Média";
  return "Baixa";
}

function intelSignalSurfaceClass(signal: CommercialIntelSignal): string {
  const ty = String(signal.type ?? "").toUpperCase();
  const sev = String(signal.severity ?? "").toUpperCase();
  if (ty === "RISK" || sev === "HIGH") {
    return "border-red-200/90 bg-gradient-to-br from-red-50/80 to-card";
  }
  if (ty === "OPPORTUNITY") {
    return "border-emerald-200/90 bg-gradient-to-br from-emerald-50/50 to-card";
  }
  return "border-sky-100/90 bg-gradient-to-br from-sky-50/40 to-card";
}

function SignalRowIcon({ signal }: { signal: CommercialIntelSignal }) {
  const ty = String(signal.type ?? "").toUpperCase();
  if (ty === "OPPORTUNITY") {
    return (
      <div className="rounded-lg bg-emerald-100 p-2 text-emerald-800 shrink-0">
        <TrendingUp className="h-4 w-4" />
      </div>
    );
  }
  if (ty === "INFO") {
    return (
      <div className="rounded-lg bg-sky-100 p-2 text-sky-800 shrink-0">
        <Info className="h-4 w-4" />
      </div>
    );
  }
  return (
    <div className="rounded-lg bg-rose-100 p-2 text-rose-800 shrink-0">
      <AlertTriangle className="h-4 w-4" />
    </div>
  );
}

function CommercialIntelBoard({
  loading,
  error,
  intel,
  onRetry,
}: {
  loading: boolean;
  error: string | null;
  intel: CommercialIntelResponse | null;
  onRetry: () => void;
}) {
  if (loading) {
    return (
      <section
        className="rounded-2xl border border-dashed border-primary/25 bg-gradient-to-br from-primary/5 to-card p-6 shadow-sm"
        aria-busy="true"
        aria-label="Inteligência comercial"
      >
        <div className="flex flex-col items-center justify-center gap-3 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          Carregando inteligência comercial…
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="rounded-2xl border border-amber-200 bg-amber-50/90 p-6 shadow-sm space-y-4">
        <div>
          <h3 className="text-lg font-bold text-amber-950">Inteligência comercial</h3>
          <p className="text-sm text-amber-900/85 mt-1">
            Não foi possível carregar a inteligência comercial deste cliente.
          </p>
          <p className="text-xs text-amber-900/70 mt-2">{clampMessage(error, 180)}</p>
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center justify-center rounded-xl border border-amber-400/60 bg-card px-4 py-2 text-sm font-semibold text-foreground hover:bg-amber-100/50"
        >
          Tentar novamente
        </button>
      </section>
    );
  }

  if (!intel) return null;

  const { summary, orders, openOrders, proposals: preSalesBlock, signals } = intel;
  const lastThreeOrders = openOrders.latestOrders.slice(0, 3);
  const lastThreeOpenOrders = openOrders.latestOpenOrders.slice(0, 3);
  const negotiationProposals = preSalesBlock?.latestNegotiationProposals?.slice(0, 3) ?? [];

  return (
    <section className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/5 via-card to-card p-6 sm:p-7 shadow-sm space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3 min-w-0">
          <div className="rounded-xl bg-primary/12 p-2.5 text-primary shrink-0">
            <FileSpreadsheet className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h3 className="text-lg font-bold text-foreground">Inteligência comercial</h3>
            <p className="text-sm text-muted-foreground mt-0.5 leading-relaxed">
              Pedidos, carteira e sinais comerciais calculados a partir dos dados do IndusCost.
            </p>
          </div>
        </div>
        <span
          className={cn(
            "self-start rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-wide shrink-0",
            intelRiskBadgeClasses(summary.riskLevel)
          )}
        >
          Risco {intelRiskLevelLabelPt(summary.riskLevel)}
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <div className="rounded-xl border border-border/70 bg-card/80 p-4 space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Última compra
          </p>
          {orders.lastOrder ? (
            <div className="space-y-1 text-sm">
              <p className="font-bold text-foreground">
                {displayLine(orders.lastOrder.orderCode)}
              </p>
              <p className="text-muted-foreground">
                {formatDateShortPt(orders.lastOrder.issueDate)}
                <span className="text-foreground font-medium">
                  {" "}
                  · {formatIntelCurrency(orders.lastOrder.totalNetValue)}
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                {formatCommercialStatusLabel(orders.lastOrder.status)}
              </p>
            </div>
          ) : (
            <p className="text-sm font-medium text-muted-foreground">Sem compra registrada</p>
          )}
        </div>

        <div className="rounded-xl border border-border/70 bg-card/80 p-4 space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Dias sem compra
          </p>
          <p className="text-lg font-bold tabular-nums text-foreground">
            {formatIntelDaysSinceLastPurchase(summary.daysSinceLastPurchase)}
          </p>
        </div>

        <div className="rounded-xl border border-border/70 bg-card/80 p-4 space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Total comprado (12 meses)
          </p>
          <p className="text-lg font-bold text-foreground">{formatIntelCurrency(orders.totalPurchasedLast12Months)}</p>
          <p className="text-xs text-muted-foreground">
            {orders.ordersLast12MonthsCount} pedido(s) no período
          </p>
        </div>

        <div className="rounded-xl border border-border/70 bg-card/80 p-4 space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Pedidos em carteira
          </p>
          <p className="text-lg font-bold tabular-nums text-foreground">{openOrders.openOrdersCount}</p>
          <p className="text-sm text-muted-foreground">
            Valor em carteira:{" "}
            <span className="font-semibold text-foreground">{formatIntelCurrency(openOrders.openOrdersValue)}</span>
          </p>
        </div>

        <div
          className={cn(
            "rounded-xl border p-4 space-y-2",
            openOrders.ordersWithoutFollowUpCount > 0
              ? "border-rose-200 bg-rose-50/50"
              : "border-border/70 bg-card/80"
          )}
        >
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Pedidos sem follow-up
          </p>
          <p className="text-lg font-bold tabular-nums text-foreground">
            {openOrders.ordersWithoutFollowUpCount}
          </p>
          {openOrders.ordersWithoutFollowUpCount > 0 ? (
            <p className="text-xs font-semibold text-rose-900">Ação comercial recomendada</p>
          ) : (
            <p className="text-xs text-muted-foreground">Nenhuma pendência neste critério</p>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-primary/25 bg-primary/5 px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">Próxima ação sugerida</p>
        <p className="text-sm font-medium text-foreground mt-1.5 leading-relaxed">
          {displayLine(summary.nextSuggestedAction)}
        </p>
      </div>

      <div>
        <p className="text-sm font-bold text-foreground mb-2">Sinais comerciais</p>
        {signals.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">Nenhum sinal comercial crítico identificado.</p>
        ) : (
          <ul className="space-y-2">
            {signals.map((s, idx) => (
              <li
                key={`${idx}-${s.title.slice(0, 32)}`}
                className={cn("rounded-xl border p-4 flex gap-3", intelSignalSurfaceClass(s))}
              >
                <SignalRowIcon signal={s} />
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-bold text-foreground">{displayLine(s.title)}</p>
                    <span
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase",
                        intelSeverityBadgeClasses(s.severity)
                      )}
                    >
                      {intelSeverityLabelPt(s.severity)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">{displayLine(s.description)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-border/60 bg-muted/10 p-4">
          <div className="flex items-center gap-2 mb-3">
            <ShoppingCart className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm font-bold text-foreground">Últimos pedidos</p>
          </div>
          {lastThreeOrders.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum pedido válido encontrado.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {lastThreeOrders.map((o) => (
                <li key={o.id} className="rounded-lg border border-border/50 bg-card/70 px-3 py-2">
                  <span className="font-semibold text-foreground">{displayLine(o.orderCode)}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    · {formatDateShortPt(o.issueDate)} · {formatIntelCurrency(o.totalNetValue)}
                  </span>
                  <span className="block text-[11px] text-muted-foreground mt-0.5">
                    {formatCommercialStatusLabel(o.status)}
                    {o.hasInvoicing ? " · Faturado" : " · Em carteira"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-border/60 bg-muted/10 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Package className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm font-bold text-foreground">Carteira aberta</p>
          </div>
          {lastThreeOpenOrders.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum pedido em carteira no momento.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {lastThreeOpenOrders.map((o) => (
                <li key={o.id} className="rounded-lg border border-border/50 bg-card/70 px-3 py-2">
                  <span className="font-semibold text-foreground">{displayLine(o.orderCode)}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    · {formatIntelCurrency(o.totalNetValue)} · {formatCommercialStatusLabel(o.status)}
                  </span>
                  <span className="block text-[11px] text-muted-foreground mt-0.5">
                    Atualizado {formatDateShortPt(o.updatedAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {negotiationProposals.length > 0 ? (
        <div className="rounded-xl border border-dashed border-muted-foreground/30 bg-muted/5 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm font-bold text-foreground">Pré-venda / propostas em negociação</p>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            Referência auxiliar de orçamentos — não compõe pipeline principal nem saúde comercial.
          </p>
          <ul className="space-y-2 text-sm">
            {negotiationProposals.map((p) => (
              <li key={p.id} className="rounded-lg border border-border/40 bg-card/60 px-3 py-2">
                <span className="font-semibold text-foreground">
                  {typeof p.number === "number" && Number.isFinite(p.number)
                    ? `#${p.number}`
                    : strField(p.title) || "Proposta"}
                </span>
                <span className="text-muted-foreground">
                  {" "}
                  · {formatCommercialStatusLabel(p.status)} · {formatIntelCurrency(p.totalNetValue)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function CockpitTabs({
  active,
  onChange,
}: {
  active: CockpitTab;
  onChange: (tab: CockpitTab) => void;
}) {
  const tabs: { id: CockpitTab; label: string; description: string }[] = [
    {
      id: "timeline",
      label: "Histórico Comercial",
      description: "Contatos, follow-ups e interações registradas.",
    },
    {
      id: "profile",
      label: "Dossiê do Cliente",
      description: "Perfil de relacionamento, preferências e guia de abordagem.",
    },
  ];
  return (
    <div className="rounded-2xl border border-border/80 bg-muted/30 p-1.5 grid gap-1.5 sm:grid-cols-2">
      {tabs.map((tab) => {
        const isActive = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={cn(
              "rounded-xl px-4 py-3 text-left transition-all w-full",
              isActive
                ? "bg-card shadow-sm border border-primary/25 ring-1 ring-primary/15"
                : "border border-transparent text-muted-foreground hover:bg-card/70 hover:text-foreground"
            )}
          >
            <span className={cn("text-sm font-bold block", isActive ? "text-foreground" : "")}>
              {tab.label}
            </span>
            <span className="text-xs mt-0.5 block leading-snug opacity-90">{tab.description}</span>
          </button>
        );
      })}
    </div>
  );
}

function CustomerListBadges({ customer }: { customer: CrmCustomerListItem }) {
  const hasContact = Boolean(customer.lastContactAt);
  const hasFutureFollowUp =
    customer.nextFollowUpAt != null &&
    parseActivityDate(customer.nextFollowUpAt) > Date.now();
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {!hasContact ? (
        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-900">
          Sem contato
        </span>
      ) : (
        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-900">
          Com histórico
        </span>
      )}
      {hasFutureFollowUp ? (
        <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-bold uppercase text-sky-900">
          Follow-up futuro
        </span>
      ) : null}
    </div>
  );
}

function ProfileFormField({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1", className)}>
      <label className="text-xs font-semibold uppercase text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

const inputClass =
  "w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary";
const textareaClass =
  "w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary";
const modalInputClass =
  "w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary";
const modalTextareaClass =
  "w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary";

const CRM_FILTER_CHIPS: { value: CrmCustomerListFilter; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "withoutContact30", label: "Sem contato 30d" },
  { value: "withContact30", label: "Com contato 30d" },
  { value: "overdueFollowUp", label: "Follow-up atrasado" },
  { value: "upcomingFollowUp7", label: "Próximos 7d" },
];

const EMPTY_AGENDA_BUCKETS: CrmAgendaBuckets = {
  overdueFollowUp: [],
  upcomingFollowUp7: [],
  withoutContact30: [],
  withContact30: [],
};

function formatAgendaCustomerMeta(customer: CrmCustomerListItem): string {
  const last = customer.lastContactAt
    ? `Último: ${formatDateShortPt(customer.lastContactAt)}`
    : "Sem contato";
  const next = customer.nextFollowUpAt
    ? ` · Próx.: ${formatDateShortPt(customer.nextFollowUpAt)}`
    : "";
  return `${last}${next}`;
}

async function fetchAgendaBucket(filter: CrmAgendaFilter): Promise<CrmCustomerListItem[]> {
  const params = new URLSearchParams();
  params.set("filter", filter);
  params.set("limit", String(CRM_AGENDA_BUCKET_LIMIT));
  params.set("offset", "0");
  const data = await fetchJsonOk<CrmCustomersApiResponse>(`/api/crm/customers?${params.toString()}`);
  return Array.isArray(data?.customers) ? data.customers : [];
}

type AgendaCommercialCardProps = {
  config: (typeof CRM_AGENDA_CARDS)[number];
  customers: CrmCustomerListItem[];
  count: number | undefined;
  isFilterActive: boolean;
  onApplyFilter: () => void;
  onSelectCustomer: (customer: CrmCustomerListItem) => void;
};

const AgendaCommercialCard: React.FC<AgendaCommercialCardProps> = ({
  config,
  customers,
  count,
  isFilterActive,
  onApplyFilter,
  onSelectCustomer,
}) => {
  const Icon = config.icon;
  const preview = customers.slice(0, CRM_AGENDA_PREVIEW_COUNT);

  return (
    <div
      className={cn(
        "rounded-2xl border p-4 shadow-sm flex flex-col gap-3 min-h-[220px] transition-shadow",
        config.cardClass,
        isFilterActive && "ring-2 ring-primary/30 shadow-md"
      )}
    >
      <button
        type="button"
        onClick={onApplyFilter}
        className="text-left flex flex-col gap-2 group"
      >
        <div className="flex items-start justify-between gap-2">
          <div className={cn("rounded-xl p-2 shrink-0", config.iconClass)}>
            <Icon className="h-4 w-4" />
          </div>
          <span className="text-2xl font-bold tabular-nums text-foreground leading-none">
            {typeof count === "number" ? count : "—"}
          </span>
        </div>
        <div>
          <p className="text-sm font-bold text-foreground leading-snug">{config.title}</p>
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{config.description}</p>
        </div>
      </button>

      <div className="flex-1 space-y-1.5 min-h-[72px]">
        {preview.length === 0 ? (
          <p className="text-xs text-muted-foreground italic py-2">{config.emptyMessage}</p>
        ) : (
          preview.map((customer) => (
            <button
              key={customer.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSelectCustomer(customer);
              }}
              className="w-full text-left rounded-lg border border-border/70 bg-background/80 px-2.5 py-2 hover:border-primary/40 hover:bg-accent/30 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-semibold text-foreground line-clamp-1">
                  {getCustomerDisplayName(customer)}
                </p>
                <span
                  className={cn(
                    "shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase",
                    config.badgeClass
                  )}
                >
                  {config.badgeLabel}
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground tabular-nums mt-0.5">
                {getCustomerTaxId(customer) !== "—" ? getCustomerTaxId(customer) : "—"}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">
                {formatAgendaCustomerMeta(customer)}
              </p>
            </button>
          ))
        )}
      </div>

      <button
        type="button"
        onClick={onApplyFilter}
        className={cn(
          "inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors w-full",
          isFilterActive
            ? "border-primary bg-primary/10 text-primary"
            : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
        )}
      >
        {isFilterActive ? "Filtro ativo" : "Aplicar filtro"}
        <ArrowRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
};

export const CrmModule = () => {
  const [dashboard, setDashboard] = useState<CrmDashboardBasic | null>(null);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(true);

  const [customers, setCustomers] = useState<CrmCustomerListItem[]>([]);
  const [customersLoading, setCustomersLoading] = useState(true);
  const [customersError, setCustomersError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [searchApplied, setSearchApplied] = useState("");
  const [crmCustomerFilter, setCrmCustomerFilter] = useState<CrmCustomerListFilter>("all");
  const [listHasMore, setListHasMore] = useState(false);

  const [agendaLoading, setAgendaLoading] = useState(true);
  const [agendaError, setAgendaError] = useState<string | null>(null);
  const [agendaBuckets, setAgendaBuckets] = useState<CrmAgendaBuckets>(EMPTY_AGENDA_BUCKETS);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activities, setActivities] = useState<CrmActivity[]>([]);
  const [activitiesLoading, setActivitiesLoading] = useState(false);
  const [activitiesError, setActivitiesError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalSaving, setModalSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [formContactDate, setFormContactDate] = useState(datetimeLocalNow);
  const [formChannel, setFormChannel] = useState<string>("WHATSAPP");
  const [formReason, setFormReason] = useState<string>("FOLLOW_UP");
  const [formSubject, setFormSubject] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formOutcome, setFormOutcome] = useState("");
  const [formStatus, setFormStatus] = useState<string>("DONE");
  const [formAssignedTo, setFormAssignedTo] = useState("Comercial Lazarios");
  const [formCreatedByName, setFormCreatedByName] = useState("Comercial Lazarios");
  const [formCreatedByPhone, setFormCreatedByPhone] = useState("");
  const [formCreatedByEmail, setFormCreatedByEmail] = useState("");
  const [formNextActionAt, setFormNextActionAt] = useState("");
  const [formNextActionDescription, setFormNextActionDescription] = useState("");

  const [selectedCustomerProfile, setSelectedCustomerProfile] = useState<CrmCustomerProfile | null>(
    null
  );
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileFormError, setProfileFormError] = useState<string | null>(null);
  const [profileForm, setProfileForm] = useState<ProfileFormState>({ ...EMPTY_PROFILE_FORM });
  const [activeCockpitTab, setActiveCockpitTab] = useState<CockpitTab>("timeline");

  const [commercialIntel, setCommercialIntel] = useState<CommercialIntelResponse | null>(null);
  const [commercialIntelLoading, setCommercialIntelLoading] = useState(false);
  const [commercialIntelError, setCommercialIntelError] = useState<string | null>(null);

  const [managementDashboard, setManagementDashboard] =
    useState<ManagementDashboardResponse | null>(null);
  const [managementDashboardLoading, setManagementDashboardLoading] = useState(true);
  const [managementDashboardError, setManagementDashboardError] = useState<string | null>(null);

  const auth = useAuth();
  const canCrmGeneral = canAccessCrmGeneral(auth);
  const canCrmSeller = canAccessCrmSeller(auth);
  const canCrmAny = canAccessCrmAny(auth);
  const canFilterAllSellers = canFilterAllCrmSellers(auth);
  const isOwnSellerOnly = isCrmOwnSellerOnly(auth);
  const sellerNotLinked =
    isOwnSellerOnly && auth.authUser != null && !isCrmSellerLinked(auth.authUser);

  const [activeCrmManagementTab, setActiveCrmManagementTab] = useState<CrmManagementTabId>(
    () => getDefaultCrmManagementTab(auth) ?? "general"
  );

  useEffect(() => {
    if (!canCrmAny) return;
    if (activeCrmManagementTab === "general" && !canCrmGeneral) {
      setActiveCrmManagementTab("seller");
      return;
    }
    if (activeCrmManagementTab === "seller" && !canCrmSeller) {
      setActiveCrmManagementTab("general");
    }
  }, [activeCrmManagementTab, canCrmAny, canCrmGeneral, canCrmSeller]);
  const [sellerDashboard, setSellerDashboard] = useState<SellerDashboardResponse | null>(null);
  const [sellerDashboardLoading, setSellerDashboardLoading] = useState(true);
  const [sellerDashboardError, setSellerDashboardError] = useState<string | null>(null);
  const [selectedSellerKey, setSelectedSellerKey] = useState(SELLER_KEY_ALL);
  const [sellerOptions, setSellerOptions] = useState<SellerOption[]>([]);
  const [sellerPeriodPreset, setSellerPeriodPreset] = useState<SellerPeriodPreset>("all");
  const [sellerDateFrom, setSellerDateFrom] = useState("");
  const [sellerDateTo, setSellerDateTo] = useState("");
  const [activeSellerSubTab, setActiveSellerSubTab] = useState<CrmSellerSubTabId>("dashboard");

  const loadManagementDashboard = useCallback(async () => {
    setManagementDashboardLoading(true);
    setManagementDashboardError(null);
    try {
      const data = await fetchJsonOk<ManagementDashboardResponse>(
        "/api/crm/management-dashboard"
      );
      setManagementDashboard(data);
    } catch (e) {
      setManagementDashboard(null);
      setManagementDashboardError(
        clampMessage(
          e instanceof Error
            ? e.message
            : "Não foi possível carregar o dashboard gerencial comercial."
        )
      );
    } finally {
      setManagementDashboardLoading(false);
    }
  }, []);

  const loadSellerDashboard = useCallback(async (params?: SellerDashboardLoadParams) => {
    if (sellerNotLinked) {
      setSellerDashboard(null);
      setSellerDashboardLoading(false);
      setSellerDashboardError(null);
      return;
    }
    setSellerDashboardLoading(true);
    setSellerDashboardError(null);
    try {
      const searchParams = new URLSearchParams();
      if (!isOwnSellerOnly) {
        if (params?.externalSellerId !== null && params?.externalSellerId !== undefined) {
          searchParams.set("externalSellerId", String(params.externalSellerId));
        } else if (params?.responsible?.trim()) {
          searchParams.set("responsible", params.responsible.trim());
        }
      }
      if (params?.dateFrom?.trim()) {
        searchParams.set("dateFrom", params.dateFrom.trim());
      }
      if (params?.dateTo?.trim()) {
        searchParams.set("dateTo", params.dateTo.trim());
      }
      const qs = searchParams.toString();
      const data = await fetchJsonOk<SellerDashboardResponse>(
        `/api/crm/seller-dashboard${qs ? `?${qs}` : ""}`
      );
      setSellerDashboard(data);
      const isUnfiltered =
        params?.externalSellerId === undefined &&
        !params?.responsible?.trim() &&
        !params?.dateFrom?.trim() &&
        !params?.dateTo?.trim();
      if (canFilterAllSellers && isUnfiltered && Array.isArray(data.sellerOptions)) {
        setSellerOptions(data.sellerOptions);
      } else if (isOwnSellerOnly) {
        setSellerOptions([]);
      }
    } catch (e) {
      setSellerDashboard(null);
      setSellerDashboardError(
        clampMessage(
          e instanceof Error
            ? e.message
            : "Não foi possível carregar a gestão por vendedor."
        )
      );
    } finally {
      setSellerDashboardLoading(false);
    }
  }, [canFilterAllSellers, isOwnSellerOnly, sellerNotLinked]);

  const buildSellerDashboardParams = useCallback(
    (overrides?: {
      sellerKey?: string;
      periodPreset?: SellerPeriodPreset;
      dateFrom?: string;
      dateTo?: string;
    }): SellerDashboardLoadParams | null => {
      const sellerKey = overrides?.sellerKey ?? selectedSellerKey;
      const preset = overrides?.periodPreset ?? sellerPeriodPreset;
      const customFrom = overrides?.dateFrom ?? sellerDateFrom;
      const customTo = overrides?.dateTo ?? sellerDateTo;

      const params: SellerDashboardLoadParams = {};

      if (!isOwnSellerOnly && sellerKey !== SELLER_KEY_ALL) {
        const opt = sellerOptions.find((o) => buildSellerOptionKey(o) === sellerKey);
        if (opt?.externalSellerId !== null && opt?.externalSellerId !== undefined) {
          params.externalSellerId = opt.externalSellerId;
        } else if (opt?.responsible?.trim()) {
          params.responsible = opt.responsible.trim();
        }
      }

      const range = resolveSellerPeriodRange(preset, customFrom, customTo);
      if (range === null) return null;
      if (range.dateFrom) params.dateFrom = range.dateFrom;
      if (range.dateTo) params.dateTo = range.dateTo;

      return params;
    },
    [
      isOwnSellerOnly,
      selectedSellerKey,
      sellerOptions,
      sellerPeriodPreset,
      sellerDateFrom,
      sellerDateTo,
    ]
  );

  const reloadSellerDashboard = useCallback(() => {
    const params = buildSellerDashboardParams();
    if (params === null) return;
    void loadSellerDashboard(params);
  }, [buildSellerDashboardParams, loadSellerDashboard]);

  const handleSellerChange = useCallback(
    (key: string) => {
      setSelectedSellerKey(key);
      const params = buildSellerDashboardParams({ sellerKey: key });
      if (params === null) return;
      void loadSellerDashboard(params);
    },
    [buildSellerDashboardParams, loadSellerDashboard]
  );

  const handleSellerPeriodPresetChange = useCallback(
    (preset: SellerPeriodPreset) => {
      setSellerPeriodPreset(preset);
      if (preset === "custom") return;
      const params = buildSellerDashboardParams({ periodPreset: preset });
      if (params === null) return;
      void loadSellerDashboard(params);
    },
    [buildSellerDashboardParams, loadSellerDashboard]
  );

  const handleApplySellerCustomPeriod = useCallback(() => {
    const params = buildSellerDashboardParams({
      periodPreset: "custom",
      dateFrom: sellerDateFrom,
      dateTo: sellerDateTo,
    });
    if (params === null) return;
    void loadSellerDashboard(params);
  }, [buildSellerDashboardParams, loadSellerDashboard, sellerDateFrom, sellerDateTo]);

  const loadDashboard = useCallback(async () => {
    setDashboardLoading(true);
    setDashboardError(null);
    try {
      const data = await fetchJsonOk<CrmDashboardBasic>("/api/crm/dashboard/basic");
      setDashboard(data);
    } catch (e) {
      setDashboard(null);
      setDashboardError(e instanceof Error ? e.message : "Não foi possível carregar os indicadores.");
    } finally {
      setDashboardLoading(false);
    }
  }, []);

  const loadAgendaBuckets = useCallback(async () => {
    setAgendaLoading(true);
    setAgendaError(null);
    try {
      const [overdueFollowUp, upcomingFollowUp7, withoutContact30, withContact30] =
        await Promise.all([
          fetchAgendaBucket("overdueFollowUp"),
          fetchAgendaBucket("upcomingFollowUp7"),
          fetchAgendaBucket("withoutContact30"),
          fetchAgendaBucket("withContact30"),
        ]);
      setAgendaBuckets({ overdueFollowUp, upcomingFollowUp7, withoutContact30, withContact30 });
    } catch (e) {
      setAgendaBuckets(EMPTY_AGENDA_BUCKETS);
      setAgendaError(
        e instanceof Error ? e.message : "Não foi possível carregar a agenda comercial."
      );
    } finally {
      setAgendaLoading(false);
    }
  }, []);

  const loadCrmCustomers = useCallback(
    async (search: string, filter: CrmCustomerListFilter, offset: number) => {
      setCustomersLoading(true);
      setCustomersError(null);
      try {
        const params = new URLSearchParams();
        const q = search.trim();
        if (q) params.set("search", q);
        params.set("limit", String(CRM_LIST_LIMIT));
        params.set("offset", String(offset));
        params.set("filter", filter);
        const data = await fetchJsonOk<CrmCustomersApiResponse>(`/api/crm/customers?${params.toString()}`);
        const list = Array.isArray(data?.customers) ? data.customers : [];
        setCustomers(list);
        setListHasMore(Boolean(data?.pagination?.hasMore));
        setSelectedId((prev) => {
          if (!prev) return null;
          return list.some((c) => c.id === prev) ? prev : null;
        });
      } catch (e) {
        setCustomers([]);
        setListHasMore(false);
        const raw = e instanceof Error ? e.message : "Não foi possível carregar a lista de clientes.";
        setCustomersError(clampMessage(raw));
      } finally {
        setCustomersLoading(false);
      }
    },
    []
  );

  const loadActivities = useCallback(async (customerId: string) => {
    setActivitiesLoading(true);
    setActivitiesError(null);
    try {
      const res = await fetchJsonOk<ActivitiesResponse>(
        `/api/customers/${customerId}/commercial-activities?limit=${CRM_ACTIVITY_LIMIT}`
      );
      const raw = Array.isArray(res?.activities) ? res.activities : [];
      setActivities([...raw].sort(sortActivitiesDesc));
    } catch (e) {
      setActivities([]);
      setActivitiesError(e instanceof Error ? e.message : "Não foi possível carregar os contatos.");
    } finally {
      setActivitiesLoading(false);
    }
  }, []);

  const loadProfile = useCallback(async (customerId: string) => {
    setProfileLoading(true);
    setProfileError(null);
    try {
      const res = await fetchJsonOk<CrmProfileApiResponse>(
        `/api/crm/customers/${customerId}/profile`
      );
      setSelectedCustomerProfile(res.profile ?? null);
    } catch (e) {
      setSelectedCustomerProfile(null);
      setProfileError(
        clampMessage(
          e instanceof Error ? e.message : "Não foi possível carregar o perfil de relacionamento."
        )
      );
    } finally {
      setProfileLoading(false);
    }
  }, []);

  const loadCommercialIntel = useCallback(async (customerId: string) => {
    setCommercialIntelLoading(true);
    setCommercialIntelError(null);
    try {
      const data = await fetchJsonOk<CommercialIntelResponse>(
        `/api/crm/customers/${customerId}/commercial-intelligence`
      );
      setCommercialIntel(data);
    } catch (e) {
      setCommercialIntel(null);
      setCommercialIntelError(
        clampMessage(
          e instanceof Error
            ? e.message
            : "Não foi possível carregar a inteligência comercial deste cliente."
        )
      );
    } finally {
      setCommercialIntelLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
    void loadManagementDashboard();
    if (canCrmSeller && !sellerNotLinked) {
      void loadSellerDashboard();
    }
    void loadAgendaBuckets();
    void loadCrmCustomers("", "all", 0);
  }, [
    canCrmSeller,
    loadDashboard,
    loadManagementDashboard,
    loadSellerDashboard,
    loadAgendaBuckets,
    loadCrmCustomers,
    sellerNotLinked,
  ]);

  useEffect(() => {
    if (!selectedId) {
      setActivities([]);
      setActivitiesError(null);
      setSelectedCustomerProfile(null);
      setProfileError(null);
      setCommercialIntel(null);
      setCommercialIntelError(null);
      setCommercialIntelLoading(false);
      return;
    }
    setCommercialIntel(null);
    setCommercialIntelError(null);
    setActiveCockpitTab("timeline");
    void loadActivities(selectedId);
    void loadProfile(selectedId);
    void loadCommercialIntel(selectedId);
  }, [selectedId, loadActivities, loadProfile, loadCommercialIntel]);

  const openFollowUpSummary = useMemo(() => {
    const now = Date.now();
    let open = 0;
    let overdue = 0;
    for (const a of activities) {
      if (!statusIsOpenLike(a.status)) continue;
      open += 1;
      if (a.nextActionAt && parseActivityDate(a.nextActionAt) < now) overdue += 1;
    }
    return { open, overdue };
  }, [activities]);

  const selectedCustomer = useMemo(
    () => (selectedId ? customers.find((c) => c.id === selectedId) ?? null : null),
    [customers, selectedId]
  );

  const sheetStats = useMemo(() => {
    if (!activities.length) {
      return { lastContact: "—", nextFollowUp: "—", nextFollowUpDetail: "—", total: 0 };
    }
    const now = Date.now();
    let last = 0;
    for (const a of activities) {
      const t = parseActivityDate(a.contactDate) || parseActivityDate(a.createdAt);
      if (t > last) last = t;
    }
    const lastContact = last ? formatDateTimePt(new Date(last).toISOString()) : "—";

    let best: CrmActivity | null = null;
    let bestT = Infinity;
    for (const a of activities) {
      const t = parseActivityDate(a.nextActionAt);
      if (t > now && t < bestT) {
        bestT = t;
        best = a;
      }
    }
    const nextFollowUp = best?.nextActionAt ? formatDateTimePt(best.nextActionAt) : "—";
    const nextFollowUpDetail = best?.nextActionDescription
      ? displayLine(best.nextActionDescription)
      : "—";

    return { lastContact, nextFollowUp, nextFollowUpDetail, total: activities.length };
  }, [activities]);

  const approachGuide = useMemo(
    () => buildApproachGuideBlocks(selectedCustomerProfile),
    [selectedCustomerProfile]
  );

  const heroTemperature = selectedCustomerProfile?.commercialTemperature ?? null;
  const heroChannel = selectedCustomerProfile?.preferredChannel ?? null;

  const openProfileModal = () => {
    setProfileFormError(null);
    setProfileForm(profileToForm(selectedCustomerProfile));
    setProfileModalOpen(true);
  };

  const updateProfileForm = <K extends keyof ProfileFormState>(key: K, value: ProfileFormState[K]) => {
    setProfileForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedId) {
      setProfileFormError("Selecione um cliente na lista.");
      return;
    }
    setProfileSaving(true);
    setProfileFormError(null);
    try {
      const body: Record<string, string | null> = {
        preferredChannel: profileForm.preferredChannel.trim(),
        bestContactTime: profileForm.bestContactTime.trim(),
        contactFrequency: profileForm.contactFrequency.trim(),
        communicationStyle: profileForm.communicationStyle.trim(),
        commercialProfile: profileForm.commercialProfile.trim(),
        buyingMotivation: profileForm.buyingMotivation.trim(),
        commonObjections: profileForm.commonObjections.trim(),
        relationshipLevel: profileForm.relationshipLevel.trim(),
        commercialTemperature: profileForm.commercialTemperature.trim(),
        interests: profileForm.interests.trim(),
        favoriteTeam: profileForm.favoriteTeam.trim(),
        importantDates: profileForm.importantDates.trim(),
        personalPreferences: profileForm.personalPreferences.trim(),
        avoidTopics: profileForm.avoidTopics.trim(),
        relationshipNotes: profileForm.relationshipNotes.trim(),
        informationSource: profileForm.informationSource.trim(),
        sensitivityLevel: profileForm.sensitivityLevel,
        lastConfirmedAt: dateInputToIso(profileForm.lastConfirmedAt),
        updatedByName: profileForm.updatedByName.trim() || PROFILE_UPDATED_BY_DEFAULT,
      };
      const res = await fetchJsonOk<CrmProfileApiResponse>(
        `/api/crm/customers/${selectedId}/profile`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      setSelectedCustomerProfile(res.profile ?? null);
      setProfileModalOpen(false);
      setToast("Perfil salvo com sucesso.");
      window.setTimeout(() => setToast(null), 4000);
    } catch (err) {
      setProfileFormError(
        clampMessage(err instanceof Error ? err.message : "Falha ao salvar o perfil.")
      );
    } finally {
      setProfileSaving(false);
    }
  };

  const openModal = () => {
    setModalError(null);
    setFormContactDate(datetimeLocalNow());
    setFormChannel("WHATSAPP");
    setFormReason("FOLLOW_UP");
    setFormSubject("");
    setFormDescription("");
    setFormOutcome("");
    setFormStatus("DONE");
    setFormAssignedTo("Comercial Lazarios");
    setFormCreatedByName("Comercial Lazarios");
    setFormCreatedByPhone("");
    setFormCreatedByEmail("");
    setFormNextActionAt("");
    setFormNextActionDescription("");
    setModalOpen(true);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchInput.trim();
    setSearchApplied(q);
    void loadCrmCustomers(q, crmCustomerFilter, 0);
  };

  const applyCustomerFilter = (next: CrmCustomerListFilter) => {
    setCrmCustomerFilter(next);
    void loadCrmCustomers(searchApplied, next, 0);
  };

  const selectCustomerFromAgenda = useCallback(
    async (customer: CrmCustomerListItem, filter: CrmAgendaFilter) => {
      if (filter !== crmCustomerFilter) {
        setCrmCustomerFilter(filter);
        await loadCrmCustomers(searchApplied, filter, 0);
      }
      setCustomers((prev) =>
        prev.some((c) => c.id === customer.id) ? prev : [customer, ...prev]
      );
      setSelectedId(customer.id);
    },
    [crmCustomerFilter, searchApplied, loadCrmCustomers]
  );

  const selectCustomerById = useCallback(
    (customerId: string, meta?: { displayName?: string; taxId?: string }) => {
      const existing = customers.find((c) => c.id === customerId);
      if (existing) {
        setSelectedId(customerId);
      } else {
        const stub: CrmCustomerListItem = {
          id: customerId,
          displayName: meta?.displayName?.trim() || "Cliente",
          tradeName: null,
          taxId: meta?.taxId?.trim() || "—",
          email: null,
          phone: null,
          city: null,
          state: null,
          address: null,
          lastContactAt: null,
          nextFollowUpAt: null,
          contactCount: 0,
        };
        setCustomers((prev) => (prev.some((c) => c.id === customerId) ? prev : [stub, ...prev]));
        setSelectedId(customerId);
      }
      if (activeCrmManagementTab === "seller") {
        setActiveSellerSubTab("portfolio");
      }
    },
    [customers, activeCrmManagementTab]
  );

  const handleSaveContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedId) {
      setModalError("Selecione um cliente na lista.");
      return;
    }
    const subject = formSubject.trim();
    const description = formDescription.trim();
    if (!subject && !description) {
      setModalError("Informe assunto ou descrição.");
      return;
    }
    const contactIso = datetimeLocalToIso(formContactDate);
    if (!contactIso) {
      setModalError("Data do contato inválida.");
      return;
    }
    const nextIso = formNextActionAt.trim() ? datetimeLocalToIso(formNextActionAt) : undefined;
    if (formNextActionAt.trim() && !nextIso) {
      setModalError("Data da próxima ação inválida.");
      return;
    }

    setModalSaving(true);
    setModalError(null);
    try {
      const body: Record<string, unknown> = {
        contactDate: contactIso,
        channel: formChannel,
        reason: formReason,
        subject: subject || undefined,
        description: description || undefined,
        outcome: formOutcome.trim() || undefined,
        status: formStatus,
        assignedTo: formAssignedTo.trim() || undefined,
        createdByName: formCreatedByName.trim() || "Comercial Lazarios",
        createdByPhone: formCreatedByPhone.trim() || undefined,
        createdByEmail: formCreatedByEmail.trim() || undefined,
        nextActionAt: nextIso,
        nextActionDescription: formNextActionDescription.trim() || undefined,
      };
      await fetchJsonOk(`/api/customers/${selectedId}/commercial-activities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setModalOpen(false);
      setToast("Contato registrado com sucesso.");
      window.setTimeout(() => setToast(null), 4000);
      await loadActivities(selectedId);
      await loadCommercialIntel(selectedId);
      await loadManagementDashboard();
      await loadDashboard();
      await loadAgendaBuckets();
      await loadCrmCustomers(searchApplied, crmCustomerFilter, 0);
    } catch (err) {
      setModalError(err instanceof Error ? err.message : "Falha ao salvar o contato.");
    } finally {
      setModalSaving(false);
    }
  };

  const handleMarkDone = async (activity: CrmActivity) => {
    if (!statusIsOpenLike(activity.status)) return;
    try {
      await fetchJsonOk(`/api/commercial-activities/${activity.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "DONE" }),
      });
      setToast("Contato marcado como concluído.");
      window.setTimeout(() => setToast(null), 3500);
      if (selectedId) await loadActivities(selectedId);
      if (selectedId) await loadCommercialIntel(selectedId);
      await loadManagementDashboard();
      await loadDashboard();
      await loadAgendaBuckets();
      await loadCrmCustomers(searchApplied, crmCustomerFilter, 0);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Não foi possível atualizar o contato.");
    }
  };

  const managementKpiCards = useMemo(
    () =>
      buildManagementKpiCards(
        managementDashboard?.summary,
        formatNumberPt,
        formatIntelCurrency
      ),
    [managementDashboard?.summary]
  );

  const sellerKpiCards = useMemo(
    () =>
      buildSellerKpiCards(sellerDashboard?.summary, formatNumberPt, formatIntelCurrency),
    [sellerDashboard?.summary]
  );

  const sellerDisplayName = useMemo(() => {
    if (isOwnSellerOnly || selectedSellerKey === SELLER_KEY_ALL) return null;
    const opt = sellerOptions.find((o) => buildSellerOptionKey(o) === selectedSellerKey);
    if (opt) return formatSellerOptionLabel(opt);
    if (sellerDashboard?.filters?.responsible?.trim()) {
      return sellerDashboard.filters.responsible.trim();
    }
    if (
      sellerDashboard?.filters?.externalSellerId !== null &&
      sellerDashboard?.filters?.externalSellerId !== undefined
    ) {
      return `Vendedor ID ${sellerDashboard.filters.externalSellerId}`;
    }
    return null;
  }, [isOwnSellerOnly, selectedSellerKey, sellerOptions, sellerDashboard?.filters]);

  const showCustomerPortfolioGrid =
    activeCrmManagementTab === "general" ||
    (activeCrmManagementTab === "seller" && canCrmSeller && activeSellerSubTab === "portfolio");

  const dashboardCards: {
    label: string;
    description: string;
    value: number | undefined;
    icon: LucideIcon;
    cardClass: string;
    iconClass: string;
  }[] = [
    {
      label: "Total de clientes",
      description: "Carteira cadastrada no sistema",
      value: dashboard?.totalCustomers,
      icon: Users,
      cardClass: "border-slate-200/80 bg-gradient-to-br from-slate-50 to-card",
      iconClass: "text-slate-600 bg-slate-100",
    },
    {
      label: "Com contato 30 dias",
      description: "Relacionamento ativo no mês",
      value: dashboard?.customersWithContactLast30Days,
      icon: UserCheck,
      cardClass: "border-emerald-200/80 bg-gradient-to-br from-emerald-50/80 to-card",
      iconClass: "text-emerald-700 bg-emerald-100",
    },
    {
      label: "Sem contato 30 dias",
      description: "Precisam de reativação",
      value: dashboard?.customersWithoutContactLast30Days,
      icon: UserX,
      cardClass: "border-amber-200/80 bg-gradient-to-br from-amber-50/80 to-card",
      iconClass: "text-amber-800 bg-amber-100",
    },
    {
      label: "Follow-ups atrasados",
      description: "Ações pendentes vencidas",
      value: dashboard?.overdueFollowUps,
      icon: AlertTriangle,
      cardClass: "border-red-200/80 bg-gradient-to-br from-red-50/60 to-card",
      iconClass: "text-red-700 bg-red-100",
    },
    {
      label: "Próximos follow-ups 7 dias",
      description: "Agenda da semana",
      value: dashboard?.upcomingFollowUpsNext7Days,
      icon: CalendarDays,
      cardClass: "border-sky-200/80 bg-gradient-to-br from-sky-50/80 to-card",
      iconClass: "text-sky-800 bg-sky-100",
    },
  ];

  const heroTemperatureLabel = heroTemperature ? displayLine(heroTemperature) : "—";
  const heroChannelLabel = heroChannel ? displayLine(heroChannel) : "—";

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-10 pb-4" data-tour="crm-root">
      {toast ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          {toast}
        </div>
      ) : null}

      <section className="space-y-8" aria-label="Gestão comercial">
        {!canCrmAny ? (
          <AccessDenied moduleId="crm-commercial" />
        ) : (
          <>
        <CrmCommercialManagementTabs
          activeTab={activeCrmManagementTab}
          onTabChange={setActiveCrmManagementTab}
        />

        {activeCrmManagementTab === "general" && canCrmGeneral ? (
          <>
            <CrmManagementDashboardSection
              data={managementDashboard}
              loading={managementDashboardLoading}
              error={managementDashboardError}
              kpiCards={managementKpiCards}
              onReload={() => void loadManagementDashboard()}
              formatDateTimePt={formatDateTimePt}
            >
              {managementDashboard ? (
                <CrmManagementLists
                  data={managementDashboard}
                  onSelectCustomer={selectCustomerById}
                  formatDateTimePt={formatDateTimePt}
                  formatDateShortPt={formatDateShortPt}
                  formatIntelCurrency={formatIntelCurrency}
                  formatNumberPt={formatNumberPt}
                  formatIntelDaysSinceLastPurchase={formatIntelDaysSinceLastPurchase}
                  formatCommercialStatusLabel={formatCommercialStatusLabel}
                  displayLine={displayLine}
                />
              ) : null}
            </CrmManagementDashboardSection>

            <section className="space-y-4">
        <div>
          <h3 className="text-lg font-bold text-foreground">Indicadores da carteira</h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            Visão rápida do relacionamento e da agenda comercial.
          </p>
        </div>
        {dashboardLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando indicadores…
          </div>
        ) : dashboardError ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {dashboardError}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            {dashboardCards.map((card) => {
              const Icon = card.icon;
              return (
                <div
                  key={card.label}
                  className={cn(
                    "rounded-2xl border p-5 shadow-sm flex flex-col gap-3 min-h-[132px]",
                    card.cardClass
                  )}
                >
                  <div className={cn("rounded-xl p-2.5 w-fit shrink-0", card.iconClass)}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-3xl font-bold tabular-nums leading-none text-foreground">
                      {typeof card.value === "number" ? card.value : "—"}
                    </p>
                    <p className="text-sm font-semibold text-foreground mt-2 leading-snug">{card.label}</p>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{card.description}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="space-y-4" aria-labelledby="crm-agenda-heading">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-primary/10 p-2.5 text-primary shrink-0">
            <ListTodo className="h-5 w-5" />
          </div>
          <div>
            <h3 id="crm-agenda-heading" className="text-lg font-bold text-foreground">
              Agenda comercial
            </h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              Priorize follow-ups atrasados, próximos contatos e clientes sem contato recente.
            </p>
          </div>
        </div>
        {agendaLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground rounded-2xl border border-dashed border-border bg-muted/20 px-4 py-6">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando agenda comercial…
          </div>
        ) : agendaError ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Não foi possível carregar a agenda comercial.
            {agendaError !== "Não foi possível carregar a agenda comercial." ? (
              <span className="block text-xs mt-1 opacity-80">{agendaError}</span>
            ) : null}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {CRM_AGENDA_CARDS.map((card) => (
              <AgendaCommercialCard
                key={card.filter}
                config={card}
                customers={agendaBuckets[card.filter]}
                count={dashboard ? card.countFromDashboard(dashboard) : undefined}
                isFilterActive={crmCustomerFilter === card.filter}
                onApplyFilter={() => applyCustomerFilter(card.filter)}
                onSelectCustomer={(customer) => {
                  void selectCustomerFromAgenda(customer, card.filter);
                }}
              />
            ))}
          </div>
        )}
      </section>
          </>
        ) : activeCrmManagementTab === "seller" && canCrmSeller ? (
          <CrmSellerDashboardSection
            data={sellerDashboard}
            loading={sellerDashboardLoading}
            error={sellerDashboardError}
            kpiCards={sellerKpiCards}
            showSellerFilter={canFilterAllSellers}
            ownScopeOnly={isOwnSellerOnly}
            sellerNotLinked={sellerNotLinked}
            sellerOptions={sellerOptions}
            selectedSellerKey={selectedSellerKey}
            onSellerChange={handleSellerChange}
            periodPreset={sellerPeriodPreset}
            onPeriodPresetChange={handleSellerPeriodPresetChange}
            dateFrom={sellerDateFrom}
            dateTo={sellerDateTo}
            onDateFromChange={setSellerDateFrom}
            onDateToChange={setSellerDateTo}
            onApplyCustomPeriod={handleApplySellerCustomPeriod}
            onReload={reloadSellerDashboard}
            formatDateTimePt={formatDateTimePt}
            activeSubTab={activeSellerSubTab}
            onSubTabChange={setActiveSellerSubTab}
            sellerDisplayName={sellerDisplayName}
          >
            {sellerDashboard && activeSellerSubTab === "dashboard" ? (
              <CrmSellerDashboardLists
                data={sellerDashboard}
                onSelectCustomer={selectCustomerById}
                formatDateShortPt={formatDateShortPt}
                formatDateTimePt={formatDateTimePt}
                formatIntelCurrency={formatIntelCurrency}
                formatCommercialStatusLabel={formatCommercialStatusLabel}
                displayLine={displayLine}
              />
            ) : null}
          </CrmSellerDashboardSection>
        ) : null}
          </>
        )}
      </section>

      {showCustomerPortfolioGrid ? (
      <div className="grid gap-8 lg:grid-cols-[minmax(360px,420px)_minmax(0,1fr)]">
        <aside className="min-w-0">
          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-5">
            <div>
              <h3 className="text-lg font-bold text-foreground">Carteira de clientes</h3>
              <p className="text-sm text-muted-foreground mt-0.5">
                {activeCrmManagementTab === "seller"
                  ? "Busque e filtre os clientes do vendedor para abrir o cockpit comercial."
                  : "Busque e filtre a carteira para abrir o cockpit do cliente."}
              </p>
            </div>
            <form onSubmit={handleSearch} className="space-y-3">
              <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Buscar
              </label>
              <div className="relative">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Buscar por nome, fantasia, CNPJ, e-mail ou telefone..."
                  className="w-full pl-11 pr-3 py-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/25"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                />
              </div>
              <button
                type="submit"
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
              >
                <Search className="h-4 w-4" />
                Buscar
              </button>
            </form>

            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Filtros rápidos
              </p>
              <div className="flex flex-wrap gap-2">
                {CRM_FILTER_CHIPS.map((chip) => (
                  <button
                    key={chip.value}
                    type="button"
                    onClick={() => applyCustomerFilter(chip.value)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                      crmCustomerFilter === chip.value
                        ? "border-primary bg-primary/15 text-primary ring-2 ring-primary/25 shadow-sm"
                        : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    )}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            </div>

            {customersLoading ? (
              <div className="rounded-xl border border-dashed border-border bg-muted/20 p-8 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                Buscando clientes…
              </div>
            ) : customersError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                {customersError}
              </div>
            ) : customers.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-muted/20 p-8 text-center">
                <p className="text-sm font-semibold text-foreground">Nenhum cliente encontrado</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Nenhum cliente encontrado para os filtros informados.
                </p>
              </div>
            ) : (
              <ul className="space-y-2 max-h-[min(560px,58vh)] overflow-y-auto pr-1">
                {customers.map((c) => {
                  const active = c.id === selectedId;
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(c.id)}
                        className={cn(
                          "w-full text-left rounded-xl border px-4 py-3.5 transition-all",
                          active
                            ? "border-primary bg-primary/10 shadow-sm ring-1 ring-primary/20"
                            : "border-border/80 bg-background hover:border-primary/30 hover:bg-accent/40"
                        )}
                      >
                        <p className="font-semibold text-sm text-foreground leading-snug line-clamp-2">
                          {getCustomerDisplayName(c)}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1 tabular-nums">
                          {getCustomerTaxId(c) !== "—" ? getCustomerTaxId(c) : "Documento não informado"}
                        </p>
                        {formatCityState(c.city, c.state) !== "—" ? (
                          <p className="text-xs text-muted-foreground mt-1">{formatCityState(c.city, c.state)}</p>
                        ) : null}
                        <p className="text-[11px] text-muted-foreground mt-2">
                          Último contato:{" "}
                          <span className="font-medium text-foreground">
                            {formatDateShortPt(c.lastContactAt)}
                          </span>
                        </p>
                        <CustomerListBadges customer={c} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {!customersLoading && !customersError && listHasMore ? (
              <p className="text-[11px] text-muted-foreground text-center pt-1">
                Há mais resultados. Refine a busca ou use filtros.
              </p>
            ) : null}
          </div>
        </aside>

        <main className="space-y-6 min-w-0">
          {!selectedCustomer ? (
            <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-12 text-center">
              <UserCircle className="h-12 w-12 text-muted-foreground/50 mx-auto mb-4" />
              <p className="text-base font-semibold text-foreground">Selecione um cliente da carteira</p>
              <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
                Selecione um cliente da carteira para visualizar o cockpit comercial.
              </p>
            </div>
          ) : (
            <>
              <div className="rounded-2xl border border-border bg-card p-6 sm:p-8 shadow-sm space-y-6">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="flex items-start gap-4 min-w-0">
                    <div className="rounded-xl bg-primary/10 p-3 text-primary shrink-0">
                      <Building2 className="h-6 w-6" />
                    </div>
                    <div className="min-w-0 space-y-1">
                      <h2 className="text-2xl sm:text-3xl font-bold leading-tight break-words text-foreground">
                        {getCustomerDisplayName(selectedCustomer)}
                      </h2>
                      {strField(selectedCustomer.tradeName) ? (
                        <p className="text-sm text-muted-foreground">
                          Fantasia: {displayLine(selectedCustomer.tradeName)}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={openModal}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
                    >
                      <Plus className="h-4 w-4" />
                      Novo contato
                    </button>
                    <button
                      type="button"
                      onClick={openProfileModal}
                      disabled={profileLoading}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-background px-4 py-2.5 text-sm font-semibold hover:bg-accent disabled:opacity-60"
                    >
                      <Pencil className="h-4 w-4" />
                      {selectedCustomerProfile ? "Editar perfil" : "Criar perfil"}
                    </button>
                  </div>
                </div>

                <dl className="grid gap-4 sm:grid-cols-2 text-sm">
                  <div>
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">CNPJ / CPF</dt>
                    <dd className="font-semibold mt-1">{getCustomerTaxId(selectedCustomer)}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Telefone</dt>
                    <dd className="font-semibold mt-1 flex items-center gap-1.5">
                      <Phone className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      {displayLine(selectedCustomer.phone)}
                    </dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">E-mail</dt>
                    <dd className="font-semibold mt-1 flex items-center gap-1.5 break-all">
                      <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      {displayLine(selectedCustomer.email)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Cidade / UF</dt>
                    <dd className="font-semibold mt-1 flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      {formatCityState(selectedCustomer.city, selectedCustomer.state)}
                    </dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Endereço</dt>
                    <dd className="font-semibold mt-1 break-words">{displayLine(selectedCustomer.address)}</dd>
                  </div>
                </dl>

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5 pt-2 border-t border-border">
                  <StatChip label="Último contato" value={sheetStats.lastContact} icon={History} />
                  <StatChip label="Próximo follow-up" value={sheetStats.nextFollowUp} icon={CalendarClock} />
                  <StatChip label="Total de contatos" value={String(sheetStats.total)} icon={MessageSquare} />
                  <div className="rounded-xl border border-border/80 bg-background/80 p-4 shadow-sm">
                    <div className="flex items-center gap-2 text-muted-foreground mb-2">
                      <Thermometer className="h-4 w-4 shrink-0" />
                      <span className="text-[11px] font-semibold uppercase tracking-wide">Temperatura</span>
                    </div>
                    {heroTemperature ? (
                      <span
                        className={cn(
                          "inline-flex rounded-full border px-2.5 py-1 text-xs font-bold uppercase",
                          temperatureBadgeClass(heroTemperature)
                        )}
                      >
                        {heroTemperatureLabel}
                      </span>
                    ) : (
                      <p className="text-sm font-bold text-foreground">—</p>
                    )}
                  </div>
                  <StatChip label="Canal preferido" value={heroChannelLabel} icon={Radio} />
                </div>
              </div>

              <CommercialIntelBoard
                loading={commercialIntelLoading}
                error={commercialIntelError}
                intel={commercialIntel}
                onRetry={() => {
                  if (selectedId) void loadCommercialIntel(selectedId);
                }}
              />

              <CockpitTabs active={activeCockpitTab} onChange={setActiveCockpitTab} />

              {activeCockpitTab === "timeline" ? (
                <section className="space-y-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h3 className="text-lg font-bold text-foreground">Linha do tempo comercial</h3>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        Esteira cronológica de contatos e follow-ups.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={openModal}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 shrink-0"
                    >
                      <Plus className="h-4 w-4" />
                      Novo contato
                    </button>
                  </div>

                  {(openFollowUpSummary.open > 0 || openFollowUpSummary.overdue > 0) && (
                    <div className="flex flex-wrap gap-2">
                      {openFollowUpSummary.open > 0 ? (
                        <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-900">
                          {openFollowUpSummary.open} follow-up(s) em aberto
                        </span>
                      ) : null}
                      {openFollowUpSummary.overdue > 0 ? (
                        <span className="rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold text-red-800">
                          {openFollowUpSummary.overdue} atrasado(s)
                        </span>
                      ) : null}
                    </div>
                  )}

                  {activitiesLoading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground py-10 justify-center rounded-2xl border border-dashed border-border bg-muted/20">
                      <Loader2 className="h-5 w-5 animate-spin text-primary" />
                      Carregando contatos…
                    </div>
                  ) : activitiesError ? (
                    <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
                      {activitiesError}
                    </div>
                  ) : activities.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-10 text-center">
                      <MessageSquare className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
                      <p className="text-sm font-semibold text-foreground">Nenhum contato registrado</p>
                      <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
                        Nenhum contato registrado. Comece registrando o primeiro contato comercial deste cliente.
                      </p>
                      <button
                        type="button"
                        onClick={openModal}
                        className="mt-4 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
                      >
                        <Plus className="h-4 w-4" />
                        Registrar primeiro contato
                      </button>
                    </div>
                  ) : (
                    <ul className="relative space-y-0 pl-1">
                      {activities.map((a, index) => (
                        <CommercialTimelineItem
                          key={a.id}
                          activity={a}
                          isLast={index === activities.length - 1}
                          onMarkDone={handleMarkDone}
                        />
                      ))}
                    </ul>
                  )}
                </section>
              ) : (
                <section className="space-y-5">
                  <ApproachGuideCard
                    guide={approachGuide}
                    hasProfile={Boolean(selectedCustomerProfile)}
                  />

                  <div className="rounded-2xl border border-border bg-card p-6 shadow-sm space-y-5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <UserCircle className="h-5 w-5 text-primary shrink-0" />
                        <h3 className="text-lg font-bold">Perfil de relacionamento</h3>
                      </div>
                      <button
                        type="button"
                        onClick={openProfileModal}
                        disabled={profileLoading}
                        className="inline-flex items-center justify-center gap-2 shrink-0 rounded-xl border border-border bg-background px-4 py-2 text-sm font-semibold hover:bg-accent disabled:opacity-60"
                      >
                        <Pencil className="h-4 w-4" />
                        {selectedCustomerProfile ? "Editar perfil" : "Criar perfil"}
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground rounded-xl border border-border/60 bg-muted/30 px-4 py-3 leading-relaxed">
                      Registre apenas informações úteis para melhorar o atendimento comercial. Evite dados
                      sensíveis, íntimos ou desnecessários.
                    </p>
                    {profileLoading ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
                        <Loader2 className="h-5 w-5 animate-spin text-primary" />
                        Carregando perfil…
                      </div>
                    ) : profileError ? (
                      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                        {profileError}
                      </div>
                    ) : !selectedCustomerProfile ? (
                      <div className="rounded-xl border border-dashed border-border bg-muted/20 p-6 text-center">
                        <p className="text-sm text-muted-foreground">
                          Nenhum perfil de relacionamento registrado. Cadastre preferências e informações
                          comerciais para orientar melhor o atendimento.
                        </p>
                        <button
                          type="button"
                          onClick={openProfileModal}
                          className="mt-3 inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-semibold hover:bg-accent"
                        >
                          <Pencil className="h-4 w-4" />
                          Criar perfil
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <ProfileBlockSection title="Canais & Comunicação" icon={Radio}>
                          <ProfileDetailRow label="Canal preferido" value={selectedCustomerProfile.preferredChannel} />
                          <ProfileDetailRow label="Melhor horário" value={selectedCustomerProfile.bestContactTime} />
                          <ProfileDetailRow label="Frequência de contato" value={selectedCustomerProfile.contactFrequency} />
                          <ProfileDetailRow label="Estilo de comunicação" value={selectedCustomerProfile.communicationStyle} />
                        </ProfileBlockSection>
                        <ProfileBlockSection title="Posicionamento Comercial" icon={Target}>
                          <ProfileDetailRow label="Perfil comercial" value={selectedCustomerProfile.commercialProfile} />
                          <ProfileDetailRow label="Motivação de compra" value={selectedCustomerProfile.buyingMotivation} />
                          <ProfileDetailRow label="Objeções comuns" value={selectedCustomerProfile.commonObjections} />
                          <ProfileDetailRow label="Nível de relacionamento" value={selectedCustomerProfile.relationshipLevel} />
                          <ProfileDetailRow label="Temperatura comercial" value={selectedCustomerProfile.commercialTemperature} />
                        </ProfileBlockSection>
                        <ProfileBlockSection title="Preferências e Afinidades" icon={Sparkles}>
                          <ProfileDetailRow label="Interesses" value={selectedCustomerProfile.interests} />
                          <ProfileDetailRow label="Time / hobby" value={selectedCustomerProfile.favoriteTeam} />
                          <ProfileDetailRow label="Datas importantes" value={selectedCustomerProfile.importantDates} />
                          <ProfileDetailRow label="Preferências pessoais" value={selectedCustomerProfile.personalPreferences} />
                          <ProfileDetailRow label="Assuntos a evitar" value={selectedCustomerProfile.avoidTopics} />
                        </ProfileBlockSection>
                        <ProfileBlockSection title="Governança dos Dados" icon={Shield}>
                          <ProfileDetailRow label="Fonte da informação" value={selectedCustomerProfile.informationSource} />
                          <ProfileDetailRow label="Sensibilidade" value={sensitivityLabel(selectedCustomerProfile.sensitivityLevel)} />
                          <ProfileDetailRow label="Última confirmação" value={formatDateShortPt(selectedCustomerProfile.lastConfirmedAt)} />
                          <ProfileDetailRow label="Atualizado por" value={selectedCustomerProfile.updatedByName} />
                          <ProfileDetailRow label="Notas de relacionamento" value={selectedCustomerProfile.relationshipNotes} />
                        </ProfileBlockSection>
                      </div>
                    )}
                  </div>
                </section>
              )}

            </>
          )}
        </main>
      </div>
      ) : null}

      {/* Modal perfil de relacionamento */}
      {profileModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-4xl max-h-[92vh] flex flex-col rounded-2xl border border-border bg-card shadow-xl overflow-hidden"
          >
            <div className="flex items-center justify-between border-b border-border px-5 py-4 sticky top-0 bg-card z-10">
              <h4 className="text-lg font-bold">Perfil de relacionamento</h4>
              <button
                type="button"
                onClick={() => !profileSaving && setProfileModalOpen(false)}
                className="rounded-lg p-2 hover:bg-accent text-muted-foreground"
                aria-label="Fechar"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSaveProfile} className="flex flex-col min-h-0 flex-1"><div className="p-5 space-y-6 overflow-y-auto flex-1 max-h-[calc(92vh-8rem)]">
              {profileFormError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                  {profileFormError}
                </div>
              ) : null}
              <p className="text-xs text-muted-foreground rounded-xl border border-border/60 bg-muted/30 px-4 py-3 leading-relaxed">
                Registre apenas informações úteis para melhorar o atendimento comercial. Evite dados
                sensíveis, íntimos ou desnecessários.
              </p>

              <fieldset className="rounded-xl border border-border/60 bg-muted/10 p-4 space-y-4">
                <legend className="text-sm font-bold text-foreground px-1">Canais & Comunicação</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  <ProfileFormField label="Canal preferido">
                    <select
                      value={profileForm.preferredChannel}
                      onChange={(e) => updateProfileForm("preferredChannel", e.target.value)}
                      className={inputClass}
                    >
                      {PROFILE_CHANNEL_OPTIONS.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  </ProfileFormField>
                  <ProfileFormField label="Melhor horário">
                    <input
                      value={profileForm.bestContactTime}
                      onChange={(e) => updateProfileForm("bestContactTime", e.target.value)}
                      className={inputClass}
                      placeholder="Ex.: Fim da tarde"
                    />
                  </ProfileFormField>
                  <ProfileFormField label="Frequência de contato">
                    <select
                      value={profileForm.contactFrequency}
                      onChange={(e) => updateProfileForm("contactFrequency", e.target.value)}
                      className={inputClass}
                    >
                      <option value="">—</option>
                      {PROFILE_CONTACT_FREQUENCY_OPTIONS.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  </ProfileFormField>
                  <ProfileFormField label="Estilo de comunicação" className="sm:col-span-2">
                    <textarea
                      value={profileForm.communicationStyle}
                      onChange={(e) => updateProfileForm("communicationStyle", e.target.value)}
                      rows={3}
                      className={textareaClass}
                      placeholder="Ex.: Objetivo, prefere mensagens curtas"
                    />
                  </ProfileFormField>
                </div>
              </fieldset>

              <fieldset className="rounded-xl border border-border/60 bg-muted/10 p-4 space-y-4">
                <legend className="text-sm font-bold text-foreground px-1">Posicionamento Comercial</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  <ProfileFormField label="Perfil comercial">
                    <select
                      value={profileForm.commercialProfile}
                      onChange={(e) => updateProfileForm("commercialProfile", e.target.value)}
                      className={inputClass}
                    >
                      <option value="">—</option>
                      {PROFILE_COMMERCIAL_PROFILE_OPTIONS.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  </ProfileFormField>
                  <ProfileFormField label="Nível de relacionamento">
                    <select
                      value={profileForm.relationshipLevel}
                      onChange={(e) => updateProfileForm("relationshipLevel", e.target.value)}
                      className={inputClass}
                    >
                      <option value="">—</option>
                      {PROFILE_RELATIONSHIP_LEVEL_OPTIONS.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  </ProfileFormField>
                  <ProfileFormField label="Temperatura comercial">
                    <select
                      value={profileForm.commercialTemperature}
                      onChange={(e) => updateProfileForm("commercialTemperature", e.target.value)}
                      className={inputClass}
                    >
                      <option value="">—</option>
                      {PROFILE_TEMPERATURE_OPTIONS.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  </ProfileFormField>
                  <ProfileFormField label="Motivação de compra" className="sm:col-span-2">
                    <textarea
                      value={profileForm.buyingMotivation}
                      onChange={(e) => updateProfileForm("buyingMotivation", e.target.value)}
                      rows={3}
                      className={textareaClass}
                    />
                  </ProfileFormField>
                  <ProfileFormField label="Objeções comuns" className="sm:col-span-2">
                    <textarea
                      value={profileForm.commonObjections}
                      onChange={(e) => updateProfileForm("commonObjections", e.target.value)}
                      rows={3}
                      className={textareaClass}
                    />
                  </ProfileFormField>
                </div>
              </fieldset>

              <fieldset className="rounded-xl border border-border/60 bg-muted/10 p-4 space-y-4">
                <legend className="text-sm font-bold text-foreground px-1">
                  Preferências e Afinidades
                </legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  <ProfileFormField label="Interesses" className="sm:col-span-2">
                    <textarea
                      value={profileForm.interests}
                      onChange={(e) => updateProfileForm("interests", e.target.value)}
                      rows={3}
                      className={textareaClass}
                    />
                  </ProfileFormField>
                  <ProfileFormField label="Time / hobby">
                    <input
                      value={profileForm.favoriteTeam}
                      onChange={(e) => updateProfileForm("favoriteTeam", e.target.value)}
                      className={inputClass}
                    />
                  </ProfileFormField>
                  <ProfileFormField label="Datas importantes">
                    <input
                      value={profileForm.importantDates}
                      onChange={(e) => updateProfileForm("importantDates", e.target.value)}
                      className={inputClass}
                    />
                  </ProfileFormField>
                  <ProfileFormField label="Preferências pessoais permitidas" className="sm:col-span-2">
                    <textarea
                      value={profileForm.personalPreferences}
                      onChange={(e) => updateProfileForm("personalPreferences", e.target.value)}
                      rows={3}
                      className={textareaClass}
                    />
                  </ProfileFormField>
                  <ProfileFormField label="Assuntos a evitar" className="sm:col-span-2">
                    <textarea
                      value={profileForm.avoidTopics}
                      onChange={(e) => updateProfileForm("avoidTopics", e.target.value)}
                      rows={3}
                      className={textareaClass}
                    />
                  </ProfileFormField>
                </div>
              </fieldset>

              <fieldset className="rounded-xl border border-border/60 bg-muted/10 p-4 space-y-4">
                <legend className="text-sm font-bold text-foreground px-1">Governança dos Dados</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  <ProfileFormField label="Fonte da informação">
                    <input
                      value={profileForm.informationSource}
                      onChange={(e) => updateProfileForm("informationSource", e.target.value)}
                      className={inputClass}
                    />
                  </ProfileFormField>
                  <ProfileFormField label="Sensibilidade">
                    <select
                      value={profileForm.sensitivityLevel}
                      onChange={(e) => updateProfileForm("sensitivityLevel", e.target.value)}
                      className={inputClass}
                    >
                      {PROFILE_SENSITIVITY_OPTIONS.map((o) => (
                        <option key={o} value={o}>
                          {sensitivityLabel(o)}
                        </option>
                      ))}
                    </select>
                  </ProfileFormField>
                  <ProfileFormField label="Última confirmação">
                    <input
                      type="date"
                      value={profileForm.lastConfirmedAt}
                      onChange={(e) => updateProfileForm("lastConfirmedAt", e.target.value)}
                      className={inputClass}
                    />
                  </ProfileFormField>
                  <ProfileFormField label="Atualizado por">
                    <input
                      value={profileForm.updatedByName}
                      onChange={(e) => updateProfileForm("updatedByName", e.target.value)}
                      className={inputClass}
                    />
                  </ProfileFormField>
                  <ProfileFormField label="Notas de relacionamento" className="sm:col-span-2">
                    <textarea
                      value={profileForm.relationshipNotes}
                      onChange={(e) => updateProfileForm("relationshipNotes", e.target.value)}
                      rows={5}
                      className={textareaClass}
                    />
                  </ProfileFormField>
                </div>
              </fieldset>
              </div>
              <div className="flex justify-end gap-2 p-5 border-t border-border bg-card shrink-0">
                <button
                  type="button"
                  disabled={profileSaving}
                  onClick={() => setProfileModalOpen(false)}
                  className="rounded-xl border border-border px-4 py-2.5 text-sm font-semibold hover:bg-accent disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={profileSaving}
                  className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
                >
                  {profileSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Salvar perfil
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* Modal novo contato */}
      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-3xl max-h-[92vh] flex flex-col rounded-2xl border border-border bg-card shadow-xl overflow-hidden"
          >
            <div className="flex items-center justify-between border-b border-border px-5 py-4 shrink-0">
              <h4 className="text-lg font-bold">Novo contato</h4>
              <button
                type="button"
                onClick={() => !modalSaving && setModalOpen(false)}
                className="rounded-lg p-2 hover:bg-accent text-muted-foreground"
                aria-label="Fechar"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSaveContact} className="flex flex-col flex-1 min-h-0">
              <div className="p-5 space-y-6 overflow-y-auto flex-1">
                {modalError ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                    {modalError}
                  </div>
                ) : null}
                <p className="text-xs text-muted-foreground rounded-xl border border-border/60 bg-muted/30 px-4 py-3 leading-relaxed">
                  Registre apenas informações úteis para o atendimento comercial. Evite dados sensíveis,
                  íntimos ou desnecessários.
                </p>
                <div className="rounded-xl border border-border/60 bg-muted/10 p-4 space-y-4">
                  <h5 className="text-sm font-bold text-foreground">Dados do contato</h5>
                  <ProfileFormField label="Data do contato">
                    <input
                      type="datetime-local"
                      required
                      value={formContactDate}
                      onChange={(e) => setFormContactDate(e.target.value)}
                      className={modalInputClass}
                    />
                  </ProfileFormField>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <ProfileFormField label="Canal">
                      <select
                        value={formChannel}
                        onChange={(e) => setFormChannel(e.target.value)}
                        className={modalInputClass}
                      >
                        {CHANNEL_OPTIONS.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    </ProfileFormField>
                    <ProfileFormField label="Motivo">
                      <select
                        value={formReason}
                        onChange={(e) => setFormReason(e.target.value)}
                        className={modalInputClass}
                      >
                        {REASON_OPTIONS.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    </ProfileFormField>
                  </div>
                  <ProfileFormField label="Status">
                    <select
                      value={formStatus}
                      onChange={(e) => setFormStatus(e.target.value)}
                      className={modalInputClass}
                    >
                      {STATUS_OPTIONS.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  </ProfileFormField>
                  <ProfileFormField label="Responsável">
                    <input
                      value={formAssignedTo}
                      onChange={(e) => setFormAssignedTo(e.target.value)}
                      className={modalInputClass}
                    />
                  </ProfileFormField>
                  <ProfileFormField label="Registrado por">
                    <input
                      value={formCreatedByName}
                      onChange={(e) => setFormCreatedByName(e.target.value)}
                      className={modalInputClass}
                    />
                  </ProfileFormField>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <ProfileFormField label="Telefone (opcional)">
                      <input
                        value={formCreatedByPhone}
                        onChange={(e) => setFormCreatedByPhone(e.target.value)}
                        className={modalInputClass}
                      />
                    </ProfileFormField>
                    <ProfileFormField label="E-mail (opcional)">
                      <input
                        value={formCreatedByEmail}
                        onChange={(e) => setFormCreatedByEmail(e.target.value)}
                        className={modalInputClass}
                      />
                    </ProfileFormField>
                  </div>
                </div>
                <div className="rounded-xl border border-border/60 bg-muted/10 p-4 space-y-4">
                  <h5 className="text-sm font-bold text-foreground">Resumo da conversa</h5>
                  <ProfileFormField label="Assunto">
                    <input
                      value={formSubject}
                      onChange={(e) => setFormSubject(e.target.value)}
                      className={modalInputClass}
                      placeholder="Resumo curto"
                    />
                  </ProfileFormField>
                  <ProfileFormField label="Descrição / observações">
                    <textarea
                      value={formDescription}
                      onChange={(e) => setFormDescription(e.target.value)}
                      rows={5}
                      className={modalTextareaClass}
                      placeholder="Detalhes do contato"
                    />
                  </ProfileFormField>
                </div>
                <div className="rounded-xl border border-border/60 bg-muted/10 p-4 space-y-3">
                  <h5 className="text-sm font-bold text-foreground">Resultado</h5>
                  <ProfileFormField label="Resultado do contato">
                    <input
                      value={formOutcome}
                      onChange={(e) => setFormOutcome(e.target.value)}
                      className={modalInputClass}
                    />
                  </ProfileFormField>
                </div>
                <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-4">
                  <h5 className="text-sm font-bold text-foreground">Próxima ação</h5>
                  <ProfileFormField label="Data da próxima ação">
                    <input
                      type="datetime-local"
                      value={formNextActionAt}
                      onChange={(e) => setFormNextActionAt(e.target.value)}
                      className={modalInputClass}
                    />
                  </ProfileFormField>
                  <ProfileFormField label="Descrição da próxima ação">
                    <input
                      value={formNextActionDescription}
                      onChange={(e) => setFormNextActionDescription(e.target.value)}
                      className={modalInputClass}
                    />
                  </ProfileFormField>
                </div>
              </div>
              <div className="flex justify-end gap-2 p-5 border-t border-border bg-card shrink-0">
                <button
                  type="button"
                  disabled={modalSaving}
                  onClick={() => setModalOpen(false)}
                  className="rounded-xl border border-border px-4 py-2.5 text-sm font-semibold hover:bg-accent disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={modalSaving}
                  className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
                >
                  {modalSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Salvar contato
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
};
