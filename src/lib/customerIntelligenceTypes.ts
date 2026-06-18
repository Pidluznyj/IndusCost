/**
 * Tipos do endpoint GET /api/crm/customers/:customerId/intelligence
 */

import type { FinanceArDashboardRow } from "./financeAccountsReceivableDashboard.js";
import type { NomusArReportSyncCutoff } from "./financeNomusArReportFreshness.js";

export type CustomerIntelligenceTopN = 10 | 20 | 50 | "all";

export type CustomerIntelligenceCustomerType = "external" | "all";

export type CustomerIntelligenceFilters = {
  startDate: string | null;
  endDate: string | null;
  year: number | null;
  status: string | null;
  responsible: string | null;
  productId: string | null;
  minNetValue: number | null;
  maxNetValue: number | null;
  customerType: CustomerIntelligenceCustomerType;
  topN: CustomerIntelligenceTopN;
};

export type CustomerIntelligenceProfile = {
  id: string;
  code: string | null;
  name: string;
  legalName: string;
  cnpj: string | null;
  city: string | null;
  state: string | null;
  region: string | null;
  registrationDate: string | null;
  firstOrderDate: string | null;
  lastOrderDate: string | null;
  commercialOwner: string | null;
};

export type CustomerIntelligenceDataQuality = {
  warnings: string[];
  missingFields: string[];
  sources: string[];
};

export type CustomerIntelligenceCommercialSummary = {
  revenue: number;
  ordersCount: number;
  validOrdersCount: number;
  billedOrdersCount: number;
  openPortfolioAmount: number;
  averageTicket: number | null;
  averageMarginPercent: number | null;
  totalMarginAmount: number | null;
  lastOrderDate: string | null;
  daysSinceLastOrder: number | null;
  leadingProduct: {
    productId: string;
    sku: string;
    name: string;
    revenue: number;
  } | null;
};

export type CustomerIntelligenceYearBucket = {
  year: number;
  ordersCount: number;
  validOrdersCount: number;
  revenue: number;
  averageTicket: number | null;
  marginAmount: number | null;
  marginPercent: number | null;
  /** null quando ano anterior sem receita (sem base). */
  growthPercentVsPreviousYear: number | null;
};

export type CustomerIntelligenceMonthBucket = {
  year: number;
  month: number;
  label: string;
  ordersCount: number;
  revenue: number;
  averageTicket: number | null;
  marginAmount: number | null;
  marginPercent: number | null;
};

export type CustomerIntelligenceStrongMonth = {
  month: number;
  monthName: string;
  totalRevenue: number;
  ordersCount: number;
  /** Proporção de anos com compra neste mês (0–1); null se histórico insuficiente. */
  recurrenceScore: number | null;
  rankByRevenue: number;
  rankByQuantity: number;
};

export type CustomerIntelligenceSeasonalityMonth = {
  month: number;
  monthName: string;
  totalRevenue: number;
  ordersCount: number;
};

export type CustomerIntelligencePurchasesAnalysis = {
  bestYear: number | null;
  bestYearRevenue: number | null;
  declinedYear: number | null;
  declinedYearRevenue: number | null;
  referenceYear: number | null;
  referenceYearRevenue: number | null;
  growthPercentVsPreviousYear: number | null;
  growthStatus: "sem_base" | "growth" | "decline" | "stable" | "insufficient";
  trendReading: string | null;
};

export type CustomerIntelligencePurchaseHistory = {
  byYear: CustomerIntelligenceYearBucket[];
  byMonth: CustomerIntelligenceMonthBucket[];
  strongestMonths: CustomerIntelligenceStrongMonth[];
  analysis: CustomerIntelligencePurchasesAnalysis;
};

export type CustomerIntelligenceSeasonality = {
  strongestMonth: CustomerIntelligenceSeasonalityMonth | null;
  weakestMonth: CustomerIntelligenceSeasonalityMonth | null;
  activeMonthsCount: number;
  hasSeasonality: boolean;
  reading: string | null;
  peakMonths: CustomerIntelligenceStrongMonth[];
  lowMonths: CustomerIntelligenceStrongMonth[];
};

export type CustomerIntelligenceProductRow = {
  productId: string;
  productCode: string;
  productName: string;
  type: string | null;
  ordersCount: number;
  quantity: number;
  revenue: number;
  averageTicket: number | null;
  marginAmount: number | null;
  marginPercent: number | null;
  firstPurchaseDate: string | null;
  lastPurchaseDate: string | null;
  daysSinceLastPurchase: number | null;
  /** Participação na receita líquida do cliente no filtro (%). */
  shareOfCustomerRevenue: number | null;
  /** Confiança da leitura (ex.: abandono com pouca base). */
  confidence: "low" | "medium" | "high" | null;
};

export type CustomerIntelligenceProductConcentration = {
  top1RevenueSharePercent: number | null;
  top3RevenueSharePercent: number | null;
  top5RevenueSharePercent: number | null;
  distinctProductsCount: number;
};

export type CustomerIntelligenceProductOpportunityKind =
  | "offer_again"
  | "recurring_late"
  | "low_mix"
  | "concentrated_revenue"
  | "cross_sell"
  | "up_sell";

export type CustomerIntelligenceProductOpportunity = {
  kind: CustomerIntelligenceProductOpportunityKind;
  severity: "LOW" | "MEDIUM" | "HIGH";
  title: string;
  description: string;
  productId: string | null;
  productCode: string | null;
  productName: string | null;
  confidence: "low" | "medium" | "high" | null;
};

export type CustomerIntelligenceProductMix = {
  topByRevenue: CustomerIntelligenceProductRow[];
  topByQuantity: CustomerIntelligenceProductRow[];
  topByMargin: CustomerIntelligenceProductRow[];
  abandonedProducts: CustomerIntelligenceProductRow[];
  recurringProducts: CustomerIntelligenceProductRow[];
  newProducts: CustomerIntelligenceProductRow[];
  concentration: CustomerIntelligenceProductConcentration;
  productOpportunities: CustomerIntelligenceProductOpportunity[];
};

export type CustomerIntelligenceRepurchaseStatus =
  | "INSUFICIENTE"
  | "DENTRO_JANELA"
  | "PROXIMA"
  | "ATRASADO";

export type CustomerIntelligenceRepurchase = {
  status: CustomerIntelligenceRepurchaseStatus;
  averageDaysBetweenOrders: number | null;
  medianDaysBetweenOrders: number | null;
  estimatedNextPurchaseDate: string | null;
  daysOverExpected: number | null;
  confidence: "low" | "medium" | "high" | null;
  detail: string | null;
};

export type CustomerIntelligenceFinancialTitleStatus =
  | "open"
  | "overdue"
  | "dueToday"
  | "upcoming"
  | "settled"
  | "suspended"
  | "unknown";

export type CustomerIntelligenceFinancialTitle = {
  externalId: number;
  description: string | null;
  dueDate: string | null;
  balanceReceivable: number;
  amountReceivable: number;
  amountReceived: number;
  sourceInvoiceNumber: string | null;
  daysOverdue: number;
  status: CustomerIntelligenceFinancialTitleStatus;
  /** Título futuro sem NF — entra como previsão na visão gerencial. */
  isForecast: boolean;
};

export type CustomerIntelligenceFinancialAgingBucket = {
  key: string;
  label: string;
  amount: number;
  count: number;
};

export type CustomerIntelligenceFinancialPaymentHistoryRow = {
  externalId: number;
  description: string | null;
  dueDate: string | null;
  settlementDate: string | null;
  amountReceived: number;
};

export type CustomerIntelligenceFinancialDataQuality = {
  linkedByCnpj: boolean;
  linkMethod: "cnpj" | "none";
  warnings: string[];
  staleExcludedCount: number;
  overdueWithoutFiscalExcludedCount: number;
  syncCutoffAt: string | null;
  fiscalBackingNote: string;
};

export type CustomerIntelligenceFinancialStatus =
  | "unlinked"
  | "healthy"
  | "open"
  | "overdue"
  | "no_titles";

export type CustomerIntelligenceFinancial = {
  receivableOpenAmount: number | null;
  overdueAmount: number | null;
  upcomingAmount: number | null;
  openTitlesCount: number | null;
  overdueTitlesCount: number | null;
  maxDaysOverdue: number | null;
  averageDaysOverdue: number | null;
  nextDueDate: string | null;
  agingBuckets: CustomerIntelligenceFinancialAgingBucket[];
  openTitles: CustomerIntelligenceFinancialTitle[];
  overdueTitles: CustomerIntelligenceFinancialTitle[];
  paymentHistory: CustomerIntelligenceFinancialPaymentHistoryRow[];
  dataQuality: CustomerIntelligenceFinancialDataQuality;
  linkedByCnpj: boolean;
  financialStatus: CustomerIntelligenceFinancialStatus;
  riskAlert: string | null;
};

export type CustomerIntelligenceRelationshipStatus =
  | "ativo"
  | "sem_contato_recente"
  | "tarefa_vencida"
  | "reativacao"
  | "sem_historico";

export type CustomerIntelligenceCrmActivity = {
  id: string;
  activityType: string;
  subject: string | null;
  description: string | null;
  status: string;
  contactDate: string | null;
  scheduledAt: string | null;
  completedAt: string | null;
  nextActionAt: string | null;
  nextActionDescription: string | null;
  channel: string | null;
  outcome: string | null;
  assignedTo: string | null;
  createdAt: string;
  isOverdue: boolean;
};

export type CustomerIntelligenceCrmTask = {
  id: string;
  subject: string | null;
  nextActionAt: string;
  nextActionDescription: string | null;
  assignedTo: string | null;
  status: string;
  isOverdue: boolean;
};

export type CustomerIntelligenceCrmNote = {
  text: string;
  source: "activity" | "profile";
  recordedAt: string | null;
};

export type CustomerIntelligenceCrmActionKind = "link" | "disabled";

export type CustomerIntelligenceCrmAction = {
  id: string;
  label: string;
  kind: CustomerIntelligenceCrmActionKind;
  href: string | null;
  reason: string | null;
};

export type CustomerIntelligenceCrmDataQuality = {
  sources: string[];
  warnings: string[];
  activitiesLoaded: number;
  profileLoaded: boolean;
};

export type CustomerIntelligenceCrm = {
  commercialOwner: string | null;
  lastContactAt: string | null;
  lastActivityAt: string | null;
  nextTaskAt: string | null;
  openTasksCount: number;
  overdueTasksCount: number;
  daysSinceLastContact: number | null;
  activities: CustomerIntelligenceCrmActivity[];
  tasks: CustomerIntelligenceCrmTask[];
  notes: CustomerIntelligenceCrmNote[];
  relationshipStatus: CustomerIntelligenceRelationshipStatus;
  dataQuality: CustomerIntelligenceCrmDataQuality;
  actions: CustomerIntelligenceCrmAction[];
};

export type CustomerIntelligenceOpportunity = {
  type: "RISK" | "OPPORTUNITY" | "INFO";
  severity: "LOW" | "MEDIUM" | "HIGH";
  title: string;
  description: string;
};

export type CustomerIntelligenceReport = {
  customer: CustomerIntelligenceProfile;
  filters: CustomerIntelligenceFilters;
  dataQuality: CustomerIntelligenceDataQuality;
  commercialSummary: CustomerIntelligenceCommercialSummary;
  history: CustomerIntelligencePurchaseHistory;
  seasonality: CustomerIntelligenceSeasonality;
  products: CustomerIntelligenceProductMix;
  repurchase: CustomerIntelligenceRepurchase;
  financial: CustomerIntelligenceFinancial;
  crm: CustomerIntelligenceCrm;
  opportunities: CustomerIntelligenceOpportunity[];
  executiveNarrative: string[];
};

/** Linha de pedido normalizada para o assembler (SalesOrder + itens). */
export type CustomerIntelligenceOrderInput = {
  id: string;
  orderCode: string;
  status: string;
  issueDate: Date;
  updatedAt: Date;
  responsible: string | null;
  totalNetValue: unknown;
  totalMarginValue: unknown;
  totalMarginPerc: unknown;
  hasInvoicing: boolean;
  items: Array<{
    productId: string;
    quantity: unknown;
    totalNetValue: unknown;
    marginValue?: unknown;
    marginPerc?: unknown;
    Product?: {
      id: string;
      sku: string;
      name: string;
      type: string | null;
    } | null;
  }>;
};

export type CustomerIntelligenceCustomerInput = {
  id: string;
  companyName: string;
  tradeName: string | null;
  taxId: string;
  city: string | null;
  state: string | null;
  accountOwner: string | null;
  createdAt: Date;
};

export type CustomerIntelligenceActivityInput = {
  id: string;
  activityType: string;
  subject: string | null;
  description: string | null;
  scheduledAt: Date | null;
  completedAt: Date | null;
  status: string;
  assignedTo: string | null;
  contactDate: Date | null;
  channel: string | null;
  outcome: string | null;
  nextActionAt: Date | null;
  nextActionDescription: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CustomerIntelligenceCrmProfileInput = {
  relationshipNotes: string | null;
  relationshipLevel: string | null;
  commercialTemperature: string | null;
} | null;

export type CustomerIntelligenceBuildInput = {
  customer: CustomerIntelligenceCustomerInput;
  orders: CustomerIntelligenceOrderInput[];
  activities: CustomerIntelligenceActivityInput[];
  crmProfile: CustomerIntelligenceCrmProfileInput;
  arRows: FinanceArDashboardRow[];
  arSyncCutoff: NomusArReportSyncCutoff | null;
  arLinkedByCnpj: boolean;
  filters: CustomerIntelligenceFilters;
  now?: Date;
};
