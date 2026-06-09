import { NomusNfeBillingClassification } from "@prisma/client";

/** CNPJs do grupo econômico (Power BI validado). */
export const NOMUS_NFE_GROUP_CNPJS = [
  "72569510000195",
  "14055501000180",
  "55717719000130",
] as const;

const LOGISTICS_KEYWORDS = [
  "REMESSA",
  "RETORNO",
  "DEVOLUCAO",
  "DEVOLUÇÃO",
  "AMOSTRA",
  "BRINDE",
  "CONSERTO",
] as const;

export const NOMUS_NFE_STATUS_CANCELLED = 7;
export const NOMUS_NFE_PRODUCTION_ENV = 1;
export const NOMUS_NFE_SAIDA_TIPO_OPERACAO = 1;
export const NOMUS_NFE_CLIENT_ISSUED = 0;
export const NOMUS_NFE_XML_SAIDA_TPNF = 1;

function normalizeNatOp(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function normalizeCnpj(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 11 ? digits : null;
}

export function isLogisticsNature(natOp: string | null | undefined): boolean {
  const normalized = normalizeNatOp(natOp);
  if (!normalized) return false;
  return LOGISTICS_KEYWORDS.some((kw) => normalized.includes(kw));
}

export function isGroupCompanyCnpj(cnpjCpf: string | null | undefined): boolean {
  const digits = normalizeCnpj(cnpjCpf);
  if (!digits) return false;
  return NOMUS_NFE_GROUP_CNPJS.some((g) => digits === g);
}

export function classifyNomusNfeBilling(input: {
  natOp: string | null;
  destCnpjCpf: string | null;
}): NomusNfeBillingClassification {
  if (isLogisticsNature(input.natOp)) {
    return NomusNfeBillingClassification.LOGISTICS_NOT_REVENUE;
  }
  if (isGroupCompanyCnpj(input.destCnpjCpf)) {
    return NomusNfeBillingClassification.INTERCOMPANY;
  }
  return NomusNfeBillingClassification.MARKET_REVENUE;
}

export function computeNomusNfeFiscalFlags(input: {
  status: number | null;
  tipoOperacao: number | null;
  isFornecedor: number | null;
  ambiente: number | null;
  xmlTpNF: number | null;
  billingClassification: NomusNfeBillingClassification;
}): { isFiscalBilling: boolean; isMarketSale: boolean } {
  const production = input.ambiente === NOMUS_NFE_PRODUCTION_ENV;
  const saida =
    input.tipoOperacao === NOMUS_NFE_SAIDA_TIPO_OPERACAO &&
    input.xmlTpNF === NOMUS_NFE_XML_SAIDA_TPNF;
  const clientIssued = input.isFornecedor === NOMUS_NFE_CLIENT_ISSUED;
  const notCancelled = input.status !== NOMUS_NFE_STATUS_CANCELLED;
  const market = input.billingClassification === NomusNfeBillingClassification.MARKET_REVENUE;

  const fiscalBase = production && saida && clientIssued && notCancelled;
  return {
    isFiscalBilling: fiscalBase,
    isMarketSale: fiscalBase && market,
  };
}
