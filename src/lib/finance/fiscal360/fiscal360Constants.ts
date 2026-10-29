/**
 * Inteligência Fiscal 360° — constantes, versões de regra e identidade das empresas.
 * Client-safe (sem Prisma, sem node:*). Fonte única do grupo: financeInternalGroupExclusions.
 */
import {
  FINANCE_INTERNAL_GROUP_COMPANIES,
  isEconomicGroupName,
  normalizeFinanceCnpj,
  normalizeFinancePersonText,
} from "@/src/lib/financeInternalGroupExclusions";

export const FISCAL360_UNKNOWN_COMPANY = "UNKNOWN" as const;
export const FISCAL360_NO_MONTH = "0000-00" as const;
/** Linha de snapshot com totais do documento (receita, contagens) — não é um tributo. */
export const FISCAL360_ALL_TAXES = "*" as const;

/**
 * Versões das regras. Mudar uma versão invalida SOMENTE os fatos que dependem dela
 * (documento não é reprocessado quando muda o classificador AP ou a projeção).
 */
export const FISCAL360_RULE_VERSIONS = {
  document: "fiscal360.document@2026-10-29.1",
  apClassifier: "fiscal360.ap-classifier@2026-10-29.1",
  payment: "fiscal360.payment@2026-10-29.1",
  snapshot: "fiscal360.snapshot@2026-10-29.1",
  forecast: "fiscal360.forecast@2026-10-29.1",
} as const;

export type Fiscal360RuleKind = keyof typeof FISCAL360_RULE_VERSIONS;

/** Chave de FiscalRuleVersion com as regras configuráveis do classificador AP. */
export const FISCAL360_AP_RULES_KEY = "fiscal360.ap-classification-rules" as const;
/** Chave de FiscalRuleVersion com parâmetros tributários por CNPJ (projeção paramétrica). */
export const FISCAL360_TAX_PARAMS_KEY = "fiscal360.tax-parameters" as const;
/** Chave de FiscalRuleVersion com regras da reforma tributária (IBS/CBS/IS). */
export const FISCAL360_REFORM_KEY = "fiscal360.tax-reform" as const;

export const FISCAL360_JOB_TYPES = {
  materializeDocument: "MATERIALIZE_DOCUMENT",
  materializeApTitle: "MATERIALIZE_AP_TITLE",
  materializeGuide: "MATERIALIZE_GUIDE",
  rebuildPartition: "REBUILD_PARTITION",
  rebuildForecast: "REBUILD_FORECAST",
} as const;
export type Fiscal360JobType = (typeof FISCAL360_JOB_TYPES)[keyof typeof FISCAL360_JOB_TYPES];

export const FISCAL360_JOB_PRIORITY: Record<Fiscal360JobType, number> = {
  MATERIALIZE_DOCUMENT: 10,
  MATERIALIZE_AP_TITLE: 10,
  MATERIALIZE_GUIDE: 20,
  REBUILD_PARTITION: 50,
  REBUILD_FORECAST: 80,
};

export const FISCAL360_JOB_STATUSES = ["PENDING", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"] as const;
export type Fiscal360JobStatus = (typeof FISCAL360_JOB_STATUSES)[number];

/** Tributos conhecidos (extensível — reforma via IBS/CBS/IS). */
export const FISCAL360_TAX_TYPES = [
  "ICMS",
  "ICMS_ST",
  "ICMS_DESON",
  "FCP",
  "FCP_ST",
  "IPI",
  "PIS",
  "COFINS",
  "ISS",
  "II",
  "IRPJ",
  "CSLL",
  "IRRF",
  "CSRF",
  "INSS",
  "FGTS",
  "SIMPLES",
  "IBS",
  "CBS",
  "IS",
  "OTHER",
] as const;
export type Fiscal360TaxType = (typeof FISCAL360_TAX_TYPES)[number];

export const FISCAL360_TAX_LABELS: Record<string, string> = {
  ICMS: "ICMS",
  ICMS_ST: "ICMS-ST",
  ICMS_DESON: "ICMS desonerado",
  FCP: "FCP",
  FCP_ST: "FCP-ST",
  IPI: "IPI",
  PIS: "PIS",
  COFINS: "COFINS",
  ISS: "ISS",
  II: "II",
  IRPJ: "IRPJ",
  CSLL: "CSLL",
  IRRF: "IRRF",
  CSRF: "PIS/COFINS/CSLL retidos",
  INSS: "INSS",
  FGTS: "FGTS",
  SIMPLES: "Simples Nacional",
  IBS: "IBS",
  CBS: "CBS",
  IS: "Imposto Seletivo",
  OTHER: "Outros",
  "*": "Todos",
};

export const FISCAL360_OPERATION_CLASSES = [
  "MARKET_SALE",
  "INTERCOMPANY",
  "REMESSA",
  "RETORNO",
  "DEVOLUCAO",
  "BONIFICACAO",
  "OTHER_MOVEMENT",
  "INBOUND",
] as const;
export type Fiscal360OperationClass = (typeof FISCAL360_OPERATION_CLASSES)[number];

export const FISCAL360_OPERATION_LABELS: Record<Fiscal360OperationClass, string> = {
  MARKET_SALE: "Venda de mercado",
  INTERCOMPANY: "Intercompany",
  REMESSA: "Remessa",
  RETORNO: "Retorno",
  DEVOLUCAO: "Devolução",
  BONIFICACAO: "Bonificação/brinde",
  OTHER_MOVEMENT: "Outras movimentações",
  INBOUND: "Entrada",
};

export const FISCAL360_PAYMENT_STATUSES = [
  "OPEN",
  "OVERDUE",
  "PARTIAL",
  "PAID_ERP",
  "PAID_PROVEN",
  "PAID_DECLARED",
  "REVERSED",
  "CANCELLED",
  "INSUFFICIENT_DATA",
] as const;
export type Fiscal360PaymentStatus = (typeof FISCAL360_PAYMENT_STATUSES)[number];

export const FISCAL360_PAYMENT_STATUS_LABELS: Record<Fiscal360PaymentStatus, string> = {
  OPEN: "Obrigação em aberto",
  OVERDUE: "Obrigação vencida",
  PARTIAL: "Pagamento parcial",
  PAID_ERP: "Baixa registrada no ERP",
  PAID_PROVEN: "Pagamento comprovado",
  PAID_DECLARED: "Pagamento declarado (sem AP/comprovante)",
  REVERSED: "Pagamento estornado",
  CANCELLED: "Guia/título cancelado",
  INSUFFICIENT_DATA: "Dados insuficientes",
};

export const FISCAL360_EVIDENCE_LABELS: Record<string, string> = {
  NONE: "Sem evidência de pagamento",
  MANUAL_DECLARED: "Declarado manualmente na guia",
  ERP_SETTLEMENT: "Baixa no Contas a Pagar (Nomus)",
  DOCUMENTARY_PROOF: "Comprovante anexado",
  BANK_MATCH: "Conciliação bancária (Tesouraria)",
};

export const FISCAL360_LINK_STATE_LABELS: Record<string, string> = {
  GUIDE_ONLY: "Guia identificada (sem AP)",
  GUIDE_WITH_AP: "Guia vinculada ao AP",
  AP_ONLY: "Título identificado (sem guia)",
};

export const FISCAL360_CHECK_LABELS: Record<string, string> = {
  APURATION_VS_GUIDE: "Apuração × guia",
  GUIDE_VS_AP: "Guia × contas a pagar",
  AP_VS_SETTLEMENT: "Contas a pagar × baixa",
  SETTLEMENT_VS_PROOF: "Baixa × comprovante",
  GUIDE_WITHOUT_AP: "Guia sem vínculo com AP",
  AP_TAX_WITHOUT_GUIDE: "Título tributário sem guia",
  POSSIBLE_DUPLICATE: "Possível pagamento duplicado",
  DUPLICATE_AP_LINK: "Título AP vinculado a mais de uma guia",
  COMPETENCE_WITHOUT_CLOSING: "Competência sem fechamento",
  CREDITS_UNRECONCILED: "Créditos não conciliados",
  PENDING_CLASSIFICATION: "Títulos pendentes de classificação",
};

/** Tolerância monetária de conciliação (centavos e arredondamentos de guia). */
export const FISCAL360_RECONCILIATION_TOLERANCE = 1;

export type Fiscal360Company = {
  cnpj: string;
  displayCnpj: string;
  shortName: string;
  name: string;
};

export const FISCAL360_COMPANIES: readonly Fiscal360Company[] = FINANCE_INTERNAL_GROUP_COMPANIES.map((c) => ({
  cnpj: c.cnpj,
  displayCnpj: c.displayCnpj,
  shortName: c.aliases[0] === "SM" ? "SM" : c.aliases[0].charAt(0) + c.aliases[0].slice(1).toLowerCase(),
  name: c.name,
}));

export function fiscal360CompanyLabel(cnpj: string | null | undefined): string {
  if (!cnpj || cnpj === FISCAL360_UNKNOWN_COMPANY) return "Empresa não identificada";
  const company = FISCAL360_COMPANIES.find((c) => c.cnpj === cnpj);
  return company ? company.shortName : cnpj;
}

/** CNPJ (14 dígitos) de empresa do grupo por CNPJ ou nome canônico; null quando externo/desconhecido. */
export function resolveFiscal360GroupCnpj(input: {
  cnpj?: string | null;
  name?: string | null;
}): string | null {
  const digits = normalizeFinanceCnpj(input.cnpj);
  if (digits) {
    const byCnpj = FINANCE_INTERNAL_GROUP_COMPANIES.find((c) => c.cnpj === digits);
    if (byCnpj) return byCnpj.cnpj;
  }
  const name = normalizeFinancePersonText(input.name);
  if (!name || !isEconomicGroupName(name)) return null;
  if (name.includes("LAZARIOS")) return FINANCE_INTERNAL_GROUP_COMPANIES[0].cnpj;
  if (name.includes("KOPPETEL")) return FINANCE_INTERNAL_GROUP_COMPANIES[1].cnpj;
  return FINANCE_INTERNAL_GROUP_COMPANIES[2].cnpj;
}

export function isFiscal360Month(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function fiscal360MonthOf(value: Date | string | null | undefined): string {
  if (!value) return FISCAL360_NO_MONTH;
  const iso = typeof value === "string" ? value : value.toISOString();
  const month = iso.slice(0, 7);
  return isFiscal360Month(month) ? month : FISCAL360_NO_MONTH;
}

export function fiscal360MonthRange(from: string, to: string): string[] {
  if (!isFiscal360Month(from) || !isFiscal360Month(to) || from > to) return [];
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number) as [number, number];
  const [ty, tm] = to.split("-").map(Number) as [number, number];
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    if (out.length > 240) break;
  }
  return out;
}

export function addFiscal360Months(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const total = y * 12 + (m - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

export function roundFiscal360(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

export function fiscal360PartitionKey(companyCnpj: string, month: string): string {
  return `${companyCnpj}:${month}`;
}
