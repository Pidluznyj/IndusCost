/**
 * Tipos do endpoint GET /api/crm/customers/:customerId/intelligence
 */

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
  sku: string;
  name: string;
  type: string | null;
  quantity: number;
  revenue: number;
  ordersCount: number;
  lastPurchaseDate: string | null;
};

export type CustomerIntelligenceProductConcentration = {
  top1RevenueSharePercent: number | null;
  top3RevenueSharePercent: number | null;
  distinctProductsCount: number;
};

export type CustomerIntelligenceProductMix = {
  topByRevenue: CustomerIntelligenceProductRow[];
  topByQuantity: CustomerIntelligenceProductRow[];
  abandonedProducts: CustomerIntelligenceProductRow[];
  recurringProducts: CustomerIntelligenceProductRow[];
  concentration: CustomerIntelligenceProductConcentration;
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

export type CustomerIntelligenceFinancial = {
  receivableOpenAmount: number | null;
  overdueAmount: number | null;
  upcomingAmount: number | null;
  overdueTitlesCount: number | null;
  maxDaysOverdue: number | null;
  averageDaysOverdue: number | null;
  linkedByCnpj: boolean;
};

export type CustomerIntelligenceCrm = {
  lastContactAt: string | null;
  nextTaskAt: string | null;
  openTasksCount: number;
  overdueTasksCount: number;
  lastNotes: string[];
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
  contactDate: Date | null;
  createdAt: Date;
  status: string;
  nextActionAt: Date | null;
  description: string | null;
  subject: string | null;
  outcome: string | null;
};

export type CustomerIntelligenceArRowInput = {
  balanceReceivable: number;
  dueDate: Date | null;
  settlementDate: Date | null;
  amountReceivable: number;
  amountReceived: number;
  suspendCollection: boolean | null;
};

export type CustomerIntelligenceBuildInput = {
  customer: CustomerIntelligenceCustomerInput;
  orders: CustomerIntelligenceOrderInput[];
  activities: CustomerIntelligenceActivityInput[];
  arRows: CustomerIntelligenceArRowInput[];
  arLinkedByCnpj: boolean;
  filters: CustomerIntelligenceFilters;
  now?: Date;
};
