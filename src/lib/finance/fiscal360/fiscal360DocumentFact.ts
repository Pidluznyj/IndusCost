/**
 * Inteligência Fiscal 360° — fato normalizado por documento fiscal (camada A).
 *
 * Função PURA: recebe a linha de origem já carregada (NomusNfe + NomusNfeFiscalSummary persistidos)
 * e devolve o fato + tributos de cabeçalho. Não lê XML: o parse oficial já está persistido
 * (nfeFiscalPersist). `isOfficialBilling` e `competenceMonth` chegam calculados pelo SQL com
 * `fiscalNfeWhereSql` / `nfeCompetenceDateSql` — a regra oficial de faturamento não é reimplementada.
 */
import {
  FISCAL360_NO_MONTH,
  FISCAL360_RULE_VERSIONS,
  FISCAL360_UNKNOWN_COMPANY,
  isFiscal360Month,
  resolveFiscal360GroupCnpj,
  roundFiscal360,
  type Fiscal360OperationClass,
} from "./fiscal360Constants.js";

export const NOMUS_NFE_STATUS_AUTHORIZED_360 = 4;
export const NOMUS_NFE_STATUS_CANCELLED_360 = 7;

export type FiscalDocumentSummarySource = {
  parserVersion: string | null;
  source: string | null;
  xmlHash: string | null;
  isCancelled: boolean | null;
  finalidade: number | null;
  tpNF: number | null;
  vProd: number | null;
  vDesc: number | null;
  vNF: number | null;
  vBC: number | null;
  vICMS: number | null;
  vICMSDeson: number | null;
  vBCST: number | null;
  vST: number | null;
  vFCP: number | null;
  vFCPST: number | null;
  vIPI: number | null;
  vPIS: number | null;
  vCOFINS: number | null;
  vISS: number | null;
  vII: number | null;
  extensibleTotals: Record<string, number> | null;
};

export type FiscalDocumentSourceRow = {
  nomusNfeId: string;
  externalId: number;
  chave: string | null;
  numero: string | null;
  serie: string | null;
  status: number | null;
  cnpjEmitente: string | null;
  xmlDestCnpjCpf: string | null;
  xmlNatOp: string | null;
  xmlTpNF: number | null;
  isFornecedor: number | null;
  tipoOperacao: number | null;
  billingClassification: string | null;
  isMarketSale: boolean;
  /** Resultado de `fiscalNfeWhereSql("emissao")` avaliado no PostgreSQL. */
  isOfficialBilling: boolean;
  /** `to_char(nfeCompetenceDateSql("emissao"), 'YYYY-MM')` — mesma competência da DRE. */
  competenceMonth: string | null;
  issueDate: Date | string | null;
  valorLiquido: number | null;
  xmlVProd: number | null;
  xmlVDesc: number | null;
  xmlVNF: number | null;
  payloadHash: string | null;
  summary: FiscalDocumentSummarySource | null;
};

export type FiscalDocumentTaxDraft = {
  taxType: string;
  effect: "DEBIT" | "ST" | "DESONERATED" | "INFORMATIVE" | "DOCUMENTARY_CREDIT";
  baseAmount: number | null;
  amount: number;
  sourcePath: string;
};

export type FiscalDocumentFactDraft = {
  documentKind: "NFE";
  nomusNfeId: string;
  nomusExternalId: number;
  chave: string | null;
  numero: string | null;
  serie: string | null;
  companyCnpj: string;
  issuerCnpj: string | null;
  recipientCnpj: string | null;
  recipientGroupCnpj: string | null;
  issueDate: string | null;
  competenceMonth: string;
  natOp: string | null;
  tpNF: number | null;
  finalidade: number | null;
  nomusStatus: number | null;
  fiscalStatus: "AUTHORIZED" | "CANCELLED" | "OTHER";
  operationClass: Fiscal360OperationClass;
  billingClassification: string | null;
  isMarketSale: boolean;
  isOfficialBilling: boolean;
  officialRevenueAmount: number;
  valorLiquido: number | null;
  vProd: number | null;
  vDesc: number | null;
  vNF: number | null;
  highlightedTaxTotal: number;
  xmlStatus: "XML" | "PARTIAL" | "MISSING" | "NOT_PARSED";
  parserVersion: string | null;
  qualityFlags: string[];
  ruleVersion: string;
  taxes: FiscalDocumentTaxDraft[];
};

function digits(value: string | null | undefined): string | null {
  const d = (value ?? "").replace(/\D/g, "");
  return d.length > 0 ? d : null;
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase();
}

/**
 * Segregação para exibição (não decide receita). Faturamento oficial SEMPRE prevalece:
 * se o predicado canônico disse que é venda de mercado, a classe é MARKET_SALE.
 */
export function classifyFiscal360Operation(row: {
  isOfficialBilling: boolean;
  billingClassification: string | null;
  natOp: string | null;
  tpNF: number | null;
  isFornecedor: number | null;
  finalidade: number | null;
}): Fiscal360OperationClass {
  if (row.isOfficialBilling) return "MARKET_SALE";
  if (row.tpNF === 0 || row.isFornecedor === 1) return "INBOUND";
  if (row.billingClassification === "INTERCOMPANY") return "INTERCOMPANY";
  const nat = normalizeText(row.natOp);
  if (row.finalidade === 4 || nat.includes("DEVOLU")) return "DEVOLUCAO";
  if (nat.includes("RETORNO")) return "RETORNO";
  if (nat.includes("REMESSA")) return "REMESSA";
  if (nat.includes("BONIFIC") || nat.includes("BRINDE") || nat.includes("AMOSTRA")) return "BONIFICACAO";
  return "OTHER_MOVEMENT";
}

function amountOrNull(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return roundFiscal360(value);
}

/**
 * Tributos de cabeçalho a partir do resumo persistido (ICMSTot / IBSCBSTot / ISTot).
 * Efeitos nunca somados entre si: ST, desonerado e informativos ficam separados do DEBIT.
 * Documento de entrada: valores viram DOCUMENTARY_CREDIT (crédito documental, creditabilidade não confirmada).
 */
export function buildFiscal360HeaderTaxes(
  summary: FiscalDocumentSummarySource,
  inbound: boolean
): FiscalDocumentTaxDraft[] {
  const out: FiscalDocumentTaxDraft[] = [];
  const push = (
    taxType: string,
    effect: FiscalDocumentTaxDraft["effect"],
    amount: number | null,
    path: string,
    base: number | null = null
  ) => {
    const value = amountOrNull(amount);
    if (value == null || Math.abs(value) < 0.005) return;
    const resolvedEffect = inbound && effect === "DEBIT" ? "DOCUMENTARY_CREDIT" : effect;
    out.push({ taxType, effect: resolvedEffect, amount: value, baseAmount: amountOrNull(base), sourcePath: path });
  };
  push("ICMS", "DEBIT", summary.vICMS, "ICMSTot/vICMS", summary.vBC);
  push("ICMS_ST", "ST", summary.vST, "ICMSTot/vST", summary.vBCST);
  push("ICMS_DESON", "DESONERATED", summary.vICMSDeson, "ICMSTot/vICMSDeson");
  push("FCP", "DEBIT", summary.vFCP, "ICMSTot/vFCP");
  push("FCP_ST", "ST", summary.vFCPST, "ICMSTot/vFCPST");
  push("IPI", "DEBIT", summary.vIPI, "ICMSTot/vIPI");
  push("PIS", "DEBIT", summary.vPIS, "ICMSTot/vPIS");
  push("COFINS", "DEBIT", summary.vCOFINS, "ICMSTot/vCOFINS");
  push("ISS", "DEBIT", summary.vISS, "ISSQNtot/vISS");
  push("II", "DEBIT", summary.vII, "ICMSTot/vII");
  // Reforma tributária: tags documentais em 2026 são informativas (sem exigibilidade confirmada).
  // Só uma FiscalRuleVersion ATIVA de fiscal360.tax-reform poderia mudar isso — nunca retroativamente.
  const ext = summary.extensibleTotals ?? {};
  for (const [tag, path, taxType] of [
    ["vIBS", "IBSCBSTot/vIBS", "IBS"],
    ["vCBS", "IBSCBSTot/vCBS", "CBS"],
    ["vIS", "ISTot/vIS", "IS"],
  ] as const) {
    const raw = ext[tag];
    if (typeof raw === "number") push(taxType, "INFORMATIVE", raw, path);
  }
  return out;
}

export function buildFiscal360DocumentFact(row: FiscalDocumentSourceRow): FiscalDocumentFactDraft {
  const summary = row.summary;
  const issuerCnpj = digits(row.cnpjEmitente);
  const recipientCnpj = digits(row.xmlDestCnpjCpf);
  const issuerGroup = resolveFiscal360GroupCnpj({ cnpj: issuerCnpj });
  const recipientGroup = resolveFiscal360GroupCnpj({ cnpj: recipientCnpj });
  const tpNF = row.xmlTpNF ?? summary?.tpNF ?? null;
  const finalidade = summary?.finalidade ?? null;
  const inbound = tpNF === 0 || row.isFornecedor === 1;
  // Empresa responsável: emitente do grupo; em entrada emitida por terceiro, o destinatário do grupo.
  const companyCnpj = (inbound ? (recipientGroup ?? issuerGroup) : issuerGroup) ?? FISCAL360_UNKNOWN_COMPANY;

  const cancelled = row.status === NOMUS_NFE_STATUS_CANCELLED_360 || summary?.isCancelled === true;
  const fiscalStatus = cancelled
    ? "CANCELLED"
    : row.status === NOMUS_NFE_STATUS_AUTHORIZED_360
      ? "AUTHORIZED"
      : "OTHER";

  const operationClass = classifyFiscal360Operation({
    isOfficialBilling: row.isOfficialBilling,
    billingClassification: row.billingClassification,
    natOp: row.xmlNatOp,
    tpNF,
    isFornecedor: row.isFornecedor,
    finalidade,
  });

  const xmlStatus: FiscalDocumentFactDraft["xmlStatus"] = !summary
    ? "NOT_PARSED"
    : summary.source === "XML"
      ? "XML"
      : summary.source === "PARTIAL"
        ? "PARTIAL"
        : "MISSING";

  const taxes = summary ? buildFiscal360HeaderTaxes(summary, inbound) : [];
  // Tributos de documento cancelado continuam rastreáveis, mas nunca somam como destacado efetivo.
  const highlightedTaxTotal =
    fiscalStatus === "AUTHORIZED"
      ? roundFiscal360(taxes.filter((t) => t.effect === "DEBIT").reduce((s, t) => s + t.amount, 0))
      : 0;

  const qualityFlags: string[] = [];
  if (xmlStatus === "NOT_PARSED") qualityFlags.push("XML_NOT_PARSED");
  if (xmlStatus === "MISSING") qualityFlags.push("XML_MISSING");
  if (xmlStatus === "PARTIAL") qualityFlags.push("XML_PARTIAL");
  if (summary && xmlStatus === "XML" && taxes.length === 0 && fiscalStatus === "AUTHORIZED" && !inbound) {
    qualityFlags.push("NO_HEADER_TAXES");
  }
  if (companyCnpj === FISCAL360_UNKNOWN_COMPANY) qualityFlags.push("COMPANY_UNKNOWN");
  const competenceMonth = isFiscal360Month(row.competenceMonth) ? row.competenceMonth : FISCAL360_NO_MONTH;
  if (competenceMonth === FISCAL360_NO_MONTH) qualityFlags.push("NO_COMPETENCE_DATE");
  const nat = normalizeText(row.xmlNatOp);
  if (row.isOfficialBilling && (nat.includes("BONIFIC") || nat.includes("BRINDE"))) {
    qualityFlags.push("BONIFICATION_IN_OFFICIAL_BILLING");
  }
  if (row.billingClassification === "INTERCOMPANY" && !recipientGroup) {
    qualityFlags.push("INTERCOMPANY_RECIPIENT_NOT_RESOLVED");
  }

  const issueDate =
    row.issueDate == null
      ? null
      : (typeof row.issueDate === "string" ? row.issueDate : row.issueDate.toISOString()).slice(0, 10);

  return {
    documentKind: "NFE",
    nomusNfeId: row.nomusNfeId,
    nomusExternalId: row.externalId,
    chave: row.chave,
    numero: row.numero,
    serie: row.serie,
    companyCnpj,
    issuerCnpj,
    recipientCnpj,
    recipientGroupCnpj: recipientGroup,
    issueDate,
    competenceMonth,
    natOp: row.xmlNatOp,
    tpNF,
    finalidade,
    nomusStatus: row.status,
    fiscalStatus,
    operationClass,
    billingClassification: row.billingClassification,
    isMarketSale: row.isMarketSale,
    isOfficialBilling: row.isOfficialBilling,
    officialRevenueAmount: row.isOfficialBilling ? roundFiscal360(row.valorLiquido ?? 0) : 0,
    valorLiquido: amountOrNull(row.valorLiquido),
    vProd: amountOrNull(summary?.vProd ?? row.xmlVProd),
    vDesc: amountOrNull(summary?.vDesc ?? row.xmlVDesc),
    vNF: amountOrNull(summary?.vNF ?? row.xmlVNF),
    highlightedTaxTotal,
    xmlStatus,
    parserVersion: summary?.parserVersion ?? null,
    qualityFlags,
    ruleVersion: FISCAL360_RULE_VERSIONS.document,
    taxes,
  };
}

/** Campos que, se mudarem, exigem rematerializar o documento (entrada do sourceHash). */
export function fiscal360DocumentHashInput(row: FiscalDocumentSourceRow): unknown[] {
  const s = row.summary;
  return [
    row.payloadHash,
    row.status,
    row.cnpjEmitente,
    row.xmlDestCnpjCpf,
    row.xmlNatOp,
    row.xmlTpNF,
    row.isFornecedor,
    row.billingClassification,
    row.isMarketSale,
    row.isOfficialBilling,
    row.competenceMonth,
    row.valorLiquido,
    s ? [s.parserVersion, s.source, s.xmlHash, s.isCancelled, s.finalidade] : null,
  ];
}
