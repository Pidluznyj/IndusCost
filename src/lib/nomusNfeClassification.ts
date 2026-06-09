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
export const NOMUS_NFE_XML_CUTOFF = new Date("2024-01-01T00:00:00");

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
  xmlDhEmi: Date | null;
  billingClassification: NomusNfeBillingClassification;
}): { isFiscalBilling: boolean; isMarketSale: boolean } {
  const market = input.billingClassification === NomusNfeBillingClassification.MARKET_REVENUE;

  // Power BI: XML é fonte primária para saída e data de emissão.
  const xmlSaida = input.xmlTpNF === NOMUS_NFE_XML_SAIDA_TPNF;
  const xmlDateOk =
    input.xmlDhEmi != null && input.xmlDhEmi.getTime() >= NOMUS_NFE_XML_CUTOFF.getTime();
  const notCancelled = input.status !== NOMUS_NFE_STATUS_CANCELLED;

  // Campos da API só bloqueiam quando explicitamente inválidos — ausência não descarta.
  const production =
    input.ambiente == null || input.ambiente === NOMUS_NFE_PRODUCTION_ENV;
  const clientIssued =
    input.isFornecedor == null || input.isFornecedor === NOMUS_NFE_CLIENT_ISSUED;
  const apiSaida =
    input.tipoOperacao == null || input.tipoOperacao === NOMUS_NFE_SAIDA_TIPO_OPERACAO;

  const fiscalBase = xmlSaida && xmlDateOk && notCancelled && production && clientIssued && apiSaida;
  return {
    isFiscalBilling: fiscalBase,
    isMarketSale: fiscalBase && market,
  };
}
