/**
 * DTO — Inteligência tributária (T07).
 * Camadas A/B/C/D nunca misturadas sem identificação de fonte.
 */

export const FISCAL_TAX_INTEL_GROUP_BY = [
  "period",
  "taxType",
  "guide",
  "guideStatus",
  "jurisdiction",
  "customer",
  "order",
  "nfe",
  "product",
  "ncm",
  "cfop",
  "company",
] as const;

export type FiscalTaxIntelGroupBy = (typeof FISCAL_TAX_INTEL_GROUP_BY)[number];

export const FISCAL_TAX_INTEL_GROUP_BY_LABELS: Record<FiscalTaxIntelGroupBy, string> = {
  period: "Período",
  taxType: "Tributo",
  guide: "Guia",
  guideStatus: "Status de pagamento",
  jurisdiction: "Jurisdição / UF",
  customer: "Cliente",
  order: "Pedido",
  nfe: "NF-e",
  product: "Produto (item NF)",
  ncm: "NCM",
  cfop: "CFOP",
  company: "Empresa emissora",
};

export const FISCAL_TAX_INTEL_DRILL_LEVELS = [
  "period",
  "taxType",
  "guide",
  "nfe",
  "order",
] as const;

export type FiscalTaxIntelDrillLevel = (typeof FISCAL_TAX_INTEL_DRILL_LEVELS)[number];

/** Natureza da fonte por coluna — exibida na UI e no XLSX. */
export const FISCAL_TAX_INTEL_COLUMN_SOURCES = {
  highlightedAmount: {
    label: "Tributos destacados",
    source: "A · XML NF-e (HEADER)",
    nature: "DESTACADO_NF",
  },
  creditsAmount: {
    label: "Créditos",
    source: "B/C · Apuração / guia",
    nature: "CREDITO",
  },
  assessedAmount: {
    label: "Tributos apurados",
    source: "B · Fechamento / guia (assessed)",
    nature: "APURADO",
  },
  amountDue: {
    label: "Tributos devidos",
    source: "C · Guia (amountDue)",
    nature: "DEVIDO",
  },
  amountPaid: {
    label: "Tributos pagos",
    source: "C · Guia / AP Nomus (amountPaid)",
    nature: "PAGO",
  },
  interestAmount: {
    label: "Juros",
    source: "C · Guia",
    nature: "JUROS",
  },
  fineAmount: {
    label: "Multas",
    source: "C · Guia",
    nature: "MULTA",
  },
  guideBalanceDue: {
    label: "Saldo de guias",
    source: "C · Guia (balanceDue)",
    nature: "SALDO_GUIA",
  },
  allocatedAmount: {
    label: "Alocado gerencialmente",
    source: "D · FiscalAllocation",
    nature: "ALOCADO",
  },
  revenueBase: {
    label: "Base receita (produtos NF)",
    source: "A · vProd − vDesc (NFs válidas)",
    nature: "RECEITA",
  },
  highlightedVsAssessed: {
    label: "Diferença destacado − apurado",
    source: "Derivado A − B (identificado)",
    nature: "DIFF_A_B",
  },
  assessedVsPaid: {
    label: "Diferença apurado − pago",
    source: "Derivado B − C (identificado)",
    nature: "DIFF_B_C",
  },
  fiscalLoadOnRevenue: {
    label: "Carga fiscal sobre receita",
    source: "pago ÷ receita (C / A)",
    nature: "CARGA_RECEITA",
  },
} as const;

export type FiscalTaxIntelFilters = {
  periodStart: string;
  periodEnd: string;
  taxType?: string | null;
  jurisdiction?: string | null;
  guideStatus?: string | null;
  customerId?: string | null;
  salesOrderId?: string | null;
  groupBy: FiscalTaxIntelGroupBy;
};

export type FiscalTaxIntelKpis = {
  highlightedAmount: number;
  creditsAmount: number;
  assessedAmount: number;
  amountDue: number;
  amountPaid: number;
  interestAmount: number;
  fineAmount: number;
  guideBalanceDue: number;
  allocatedAmount: number;
  revenueBase: number;
  highlightedVsAssessed: number;
  assessedVsPaid: number;
  fiscalLoadOnRevenue: number | null;
  cancelledGuideCount: number;
  validGuideCount: number;
  nfeCount: number;
};

export type FiscalTaxIntelRow = {
  groupKey: string;
  groupLabel: string;
  groupBy: FiscalTaxIntelGroupBy;
  highlightedAmount: number;
  creditsAmount: number;
  assessedAmount: number;
  amountDue: number;
  amountPaid: number;
  interestAmount: number;
  fineAmount: number;
  guideBalanceDue: number;
  allocatedAmount: number;
  revenueBase: number;
  highlightedVsAssessed: number;
  assessedVsPaid: number;
  fiscalLoadOnRevenue: number | null;
  /** Drill keys */
  periodStart?: string | null;
  periodEnd?: string | null;
  taxType?: string | null;
  guideId?: string | null;
  nfeExternalId?: number | null;
  nomusNfeId?: string | null;
  salesOrderId?: string | null;
  orderCode?: string | null;
};

export type FiscalTaxIntelDrillNode = {
  level: FiscalTaxIntelDrillLevel;
  key: string;
  label: string;
  metrics: Pick<
    FiscalTaxIntelRow,
    | "highlightedAmount"
    | "assessedAmount"
    | "amountDue"
    | "amountPaid"
    | "allocatedAmount"
    | "guideBalanceDue"
  >;
  childrenCount: number;
  /** Params to request next drill level. */
  next?: {
    level: FiscalTaxIntelDrillLevel;
    periodStart?: string;
    periodEnd?: string;
    taxType?: string;
    guideId?: string;
    nfeExternalId?: number;
  };
};

export type FiscalTaxIntelPayload = {
  ok: true;
  generatedAt: string;
  filters: FiscalTaxIntelFilters;
  columnSources: typeof FISCAL_TAX_INTEL_COLUMN_SOURCES;
  disclaimer: string;
  kpis: FiscalTaxIntelKpis;
  rows: FiscalTaxIntelRow[];
  drill?: {
    level: FiscalTaxIntelDrillLevel;
    path: Array<{ level: string; key: string; label: string }>;
    nodes: FiscalTaxIntelDrillNode[];
  };
};

export function roundFiscalIntelMoney(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
}

export function computeFiscalLoadOnRevenue(
  amountPaid: number,
  revenueBase: number
): number | null {
  if (revenueBase <= 0.009) return null;
  return roundFiscalIntelMoney((amountPaid / revenueBase) * 100);
}

export function buildFiscalTaxIntelKpisFromParts(input: {
  highlightedAmount: number;
  creditsAmount: number;
  assessedAmount: number;
  amountDue: number;
  amountPaid: number;
  interestAmount: number;
  fineAmount: number;
  guideBalanceDue: number;
  allocatedAmount: number;
  revenueBase: number;
  cancelledGuideCount: number;
  validGuideCount: number;
  nfeCount: number;
}): FiscalTaxIntelKpis {
  const highlightedAmount = roundFiscalIntelMoney(input.highlightedAmount);
  const assessedAmount = roundFiscalIntelMoney(input.assessedAmount);
  const amountPaid = roundFiscalIntelMoney(input.amountPaid);
  const revenueBase = roundFiscalIntelMoney(input.revenueBase);
  return {
    highlightedAmount,
    creditsAmount: roundFiscalIntelMoney(input.creditsAmount),
    assessedAmount,
    amountDue: roundFiscalIntelMoney(input.amountDue),
    amountPaid,
    interestAmount: roundFiscalIntelMoney(input.interestAmount),
    fineAmount: roundFiscalIntelMoney(input.fineAmount),
    guideBalanceDue: roundFiscalIntelMoney(input.guideBalanceDue),
    allocatedAmount: roundFiscalIntelMoney(input.allocatedAmount),
    revenueBase,
    highlightedVsAssessed: roundFiscalIntelMoney(highlightedAmount - assessedAmount),
    assessedVsPaid: roundFiscalIntelMoney(assessedAmount - amountPaid),
    fiscalLoadOnRevenue: computeFiscalLoadOnRevenue(amountPaid, revenueBase),
    cancelledGuideCount: input.cancelledGuideCount,
    validGuideCount: input.validGuideCount,
    nfeCount: input.nfeCount,
  };
}

export function parseFiscalTaxIntelGroupBy(
  raw: unknown
): FiscalTaxIntelGroupBy {
  const v = String(raw ?? "taxType");
  if ((FISCAL_TAX_INTEL_GROUP_BY as readonly string[]).includes(v)) {
    return v as FiscalTaxIntelGroupBy;
  }
  return "taxType";
}
