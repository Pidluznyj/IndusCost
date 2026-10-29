/**
 * Inteligência Fiscal 360° — classificação determinística de títulos do Contas a Pagar.
 *
 * Princípios (não negociáveis):
 *  - A palavra "imposto" (ou qualquer token isolado) NUNCA basta para tornar um título tributo.
 *  - Só confiança HIGH vira `TAX`; MEDIUM/LOW viram `PENDING` (pendência de classificação com sugestão).
 *  - Evidências fortes: vínculo com guia fiscal, decisão manual, regra configurada e versionada,
 *    código de receita conhecido + contexto, ou órgão arrecadador + exatamente um tributo citado.
 *  - O resultado nunca altera o título no Nomus.
 *
 * Limitação real da fonte: a API de contas a pagar do Nomus não envia CNPJ do favorecido nem data
 * de baixa (docs/generated/nomus-accounts-payable-api-diagnostic.md). O CNPJ é usado quando existir.
 */
import {
  isIntercompanyPayable,
  normalizeFinancePersonText,
} from "@/src/lib/financeInternalGroupExclusions.js";
import { normalizeAccountsPayableTitle } from "@/src/lib/financeAccountsPayableRules.js";
import {
  FISCAL360_NO_MONTH,
  FISCAL360_RULE_VERSIONS,
  FISCAL360_UNKNOWN_COMPANY,
  fiscal360MonthOf,
  resolveFiscal360GroupCnpj,
  roundFiscal360,
} from "./fiscal360Constants.js";

export type FiscalApSourceRow = {
  id: string;
  externalId: number;
  classification: string | null;
  type: number | null;
  status: boolean | null;
  companyName: string | null;
  personName: string | null;
  personCnpj: string | null;
  description: string | null;
  comments: string | null;
  paymentMethodName: string | null;
  documentNumber: string | null;
  dueDate: Date | null;
  competenceDate: Date | null;
  settlementDate: Date | null;
  paymentDate: Date | null;
  amountPayable: number | null;
  amountPaid: number | null;
  balancePayable: number | null;
  suspendPayment: boolean | null;
  payloadHash: string | null;
  sourcePresenceStatus: string | null;
};

export type FiscalApTreasuryEvidence = {
  /** Data bancária mais recente de match MATCHED com alocação AP deste título. */
  paidDate: Date | null;
  matchedAmount: number;
  matchCount: number;
};

export type FiscalApGuideClaim = { guideId: string; taxType: string; source: "FK" | "DECISION" } | null;

export type FiscalApDecision = {
  id: string;
  decisionType: "AP_CONFIRM_TAX" | "AP_REJECT_TAX";
  taxType: string | null;
  revenueCode: string | null;
  competenceMonth: string | null;
};

/** Regra configurável (FiscalRuleVersion `fiscal360.ap-classification-rules`, status ACTIVE). */
export type FiscalApConfiguredRule = {
  id: string;
  field: "classification" | "personName" | "description" | "personCnpj";
  match: "equals" | "contains" | "startsWith";
  value: string;
  outcome: "TAX" | "NOT_TAX";
  taxType?: string | null;
  companyCnpj?: string | null;
};

export type FiscalApClassification = {
  classificationStatus: "TAX" | "NOT_TAX" | "PENDING";
  taxType: string | null;
  suggestedTaxType: string | null;
  revenueCode: string | null;
  confidence: "HIGH" | "MEDIUM" | "LOW" | "NONE";
  rule: string | null;
  evidence: Record<string, unknown>;
  manualDecisionId: string | null;
};

export type FiscalApTitleFactDraft = {
  apExternalId: number;
  apId: string;
  companyCnpj: string;
  companyName: string | null;
  personName: string | null;
  personCnpj: string | null;
  description: string | null;
  nomusClassification: string | null;
  documentNumber: string | null;
  dueDate: string | null;
  competenceDate: string | null;
  competenceMonth: string;
  amountOriginal: number;
  amountPaid: number;
  balance: number;
  effectiveStatus: "OPEN" | "SETTLED" | "CANCELLED" | "REMOVED_AT_SOURCE";
  settledWithoutCash: boolean;
  apPaymentDate: string | null;
  treasuryPaidDate: string | null;
  treasuryMatchedAmount: number | null;
  treasuryMatchCount: number;
  classification: FiscalApClassification;
  claimedByGuideId: string | null;
  isIntercompany: boolean;
  intercompanyCounterpartyCnpj: string | null;
  ruleVersion: string;
};

/**
 * Códigos de receita federais (DARF) com mapeamento inequívoco.
 * Fonte normativa: tabela de códigos de receita da RFB (Sicalc / ADE Codac). Lista PARCIAL e versionada:
 * código ausente aqui não é inferido — o título fica pendente.
 */
export const FISCAL360_DARF_REVENUE_CODES: Record<string, string> = {
  "2172": "COFINS",
  "5856": "COFINS",
  "8109": "PIS",
  "6912": "PIS",
  "2089": "IRPJ",
  "2362": "IRPJ",
  "2372": "CSLL",
  "2484": "CSLL",
  "5952": "CSRF",
  "1708": "IRRF",
  "0561": "IRRF",
  "5123": "IPI",
};

const TAX_TOKENS: Array<{ taxType: string; patterns: RegExp[] }> = [
  { taxType: "ICMS_ST", patterns: [/\bICMS[\s-]*ST\b/, /\bSUBSTITUICAO TRIBUTARIA\b/, /\bGNRE\b/] },
  { taxType: "ICMS", patterns: [/\bICMS\b/] },
  { taxType: "IPI", patterns: [/\bIPI\b/] },
  { taxType: "PIS", patterns: [/\bPIS\b/, /\bPASEP\b/] },
  { taxType: "COFINS", patterns: [/\bCOFINS\b/] },
  { taxType: "IRPJ", patterns: [/\bIRPJ\b/] },
  { taxType: "CSLL", patterns: [/\bCSLL\b/] },
  { taxType: "IRRF", patterns: [/\bIRRF\b/] },
  { taxType: "ISS", patterns: [/\bISS\b/, /\bISSQN\b/] },
  { taxType: "INSS", patterns: [/\bINSS\b/, /\bGPS\b/, /\bCONTRIBUICAO PREVIDENCIARIA\b/] },
  { taxType: "FGTS", patterns: [/\bFGTS\b/, /\bGRF\b/] },
  { taxType: "SIMPLES", patterns: [/\bSIMPLES NACIONAL\b/, /\bDAS SIMPLES\b/] },
  { taxType: "CBS", patterns: [/\bCBS\b/] },
  { taxType: "IBS", patterns: [/\bIBS\b/] },
];

const AUTHORITY_NAME_PATTERNS = [
  /\bRECEITA FEDERAL\b/,
  /\bSECRETARIA DA RECEITA\b/,
  /\bMINISTERIO DA FAZENDA\b/,
  /\bSECRETARIA (DA|DE ESTADO DA) FAZENDA\b/,
  /\bSEFAZ\b/,
  /\bPREFEITURA\b/,
  /\bFAZENDA (NACIONAL|ESTADUAL|MUNICIPAL|PUBLICA)\b/,
  /\bPROCURADORIA GERAL DA FAZENDA\b/,
];

/** Raízes de CNPJ (8 dígitos) de órgãos arrecadadores com uso exclusivamente tributário. */
const AUTHORITY_CNPJ_ROOTS = new Set(["00394460" /* Secretaria da Receita Federal do Brasil */]);

const GENERIC_TAX_WORDS = /\b(IMPOSTOS?|TRIBUTOS?|DARF|GUIA DE RECOLHIMENTO)\b/;

const COMPETENCE_IN_TEXT =/\b(0[1-9]|1[0-2])[/.-](20\d{2})\b/;
const REVENUE_CODE_IN_TEXT = /\b(?:COD(?:IGO)?\.?\s*(?:DE\s*)?(?:RECEITA)?\s*:?\s*)?(\d{4})\b/g;

function norm(value: string | null | undefined): string {
  return normalizeFinancePersonText(value);
}

function dateOnly(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function matchesRule(rule: FiscalApConfiguredRule, row: FiscalApSourceRow): boolean {
  const field =
    rule.field === "classification"
      ? row.classification
      : rule.field === "personName"
        ? row.personName
        : rule.field === "personCnpj"
          ? (row.personCnpj ?? "").replace(/\D/g, "")
          : row.description;
  const haystack = rule.field === "personCnpj" ? field ?? "" : norm(field);
  const needle = rule.field === "personCnpj" ? rule.value.replace(/\D/g, "") : norm(rule.value);
  if (!haystack || !needle) return false;
  if (rule.match === "equals") return haystack === needle;
  if (rule.match === "startsWith") return haystack.startsWith(needle);
  return haystack.includes(needle);
}

function detectTokens(text: string): string[] {
  const found = new Set<string>();
  for (const { taxType, patterns } of TAX_TOKENS) {
    if (patterns.some((p) => p.test(text))) found.add(taxType);
  }
  // ICMS-ST também casa ICMS: manter só o mais específico.
  if (found.has("ICMS_ST")) found.delete("ICMS");
  return [...found];
}

function detectRevenueCodes(text: string): string[] {
  if (!/\bDARF\b|\bCOD(IGO)?\b|\bRECEITA\b/.test(text)) return [];
  const codes = new Set<string>();
  for (const m of text.matchAll(REVENUE_CODE_IN_TEXT)) {
    const code = m[1]!;
    if (FISCAL360_DARF_REVENUE_CODES[code]) codes.add(code);
  }
  return [...codes];
}

export function classifyFiscal360ApTitle(
  row: FiscalApSourceRow,
  ctx: {
    guideClaim: FiscalApGuideClaim;
    decision: FiscalApDecision | null;
    rules: FiscalApConfiguredRule[];
  }
): FiscalApClassification {
  const base = { revenueCode: null as string | null, manualDecisionId: null as string | null };

  if (ctx.decision?.decisionType === "AP_REJECT_TAX") {
    return {
      ...base,
      classificationStatus: "NOT_TAX",
      taxType: null,
      suggestedTaxType: null,
      confidence: "HIGH",
      rule: "MANUAL_REJECT",
      evidence: { decisionId: ctx.decision.id },
      manualDecisionId: ctx.decision.id,
    };
  }
  if (ctx.decision?.decisionType === "AP_CONFIRM_TAX" && ctx.decision.taxType) {
    return {
      classificationStatus: "TAX",
      taxType: ctx.decision.taxType,
      suggestedTaxType: null,
      revenueCode: ctx.decision.revenueCode,
      confidence: "HIGH",
      rule: "MANUAL_CONFIRM",
      evidence: { decisionId: ctx.decision.id, competenceMonth: ctx.decision.competenceMonth },
      manualDecisionId: ctx.decision.id,
    };
  }
  if (ctx.guideClaim) {
    return {
      ...base,
      classificationStatus: "TAX",
      taxType: ctx.guideClaim.taxType,
      suggestedTaxType: null,
      confidence: "HIGH",
      rule: ctx.guideClaim.source === "FK" ? "GUIDE_LINK" : "GUIDE_LINK_DECISION",
      evidence: { guideId: ctx.guideClaim.guideId },
    };
  }

  for (const rule of ctx.rules) {
    if (!matchesRule(rule, row)) continue;
    if (rule.outcome === "NOT_TAX") {
      return {
        ...base,
        classificationStatus: "NOT_TAX",
        taxType: null,
        suggestedTaxType: null,
        confidence: "HIGH",
        rule: `CONFIGURED:${rule.id}`,
        evidence: { field: rule.field, value: rule.value },
      };
    }
    if (rule.taxType) {
      return {
        ...base,
        classificationStatus: "TAX",
        taxType: rule.taxType,
        suggestedTaxType: null,
        confidence: "HIGH",
        rule: `CONFIGURED:${rule.id}`,
        evidence: { field: rule.field, value: rule.value },
      };
    }
  }

  const classText = norm(row.classification);
  const descText = norm([row.description, row.comments, row.documentNumber].filter(Boolean).join(" "));
  const personText = norm(row.personName);
  const allText = `${classText} ${descText}`;
  const cnpjRoot = (row.personCnpj ?? "").replace(/\D/g, "").slice(0, 8);
  const authority =
    AUTHORITY_CNPJ_ROOTS.has(cnpjRoot) || AUTHORITY_NAME_PATTERNS.some((p) => p.test(personText));
  const tokens = detectTokens(allText);
  const codes = detectRevenueCodes(allText);
  const codeTaxes = [...new Set(codes.map((c) => FISCAL360_DARF_REVENUE_CODES[c]!))];
  const evidence: Record<string, unknown> = {
    authority,
    tokens,
    revenueCodes: codes,
    tokenSource: tokens.length ? (detectTokens(classText).length ? "classification" : "description") : null,
  };

  // Código de receita conhecido + (órgão arrecadador OU tributo citado coerente) = evidência forte.
  if (codeTaxes.length === 1 && (authority || tokens.includes(codeTaxes[0]!) || /\bDARF\b/.test(allText))) {
    return {
      ...base,
      classificationStatus: "TAX",
      taxType: codeTaxes[0]!,
      suggestedTaxType: null,
      revenueCode: codes[0]!,
      confidence: "HIGH",
      rule: "DARF_REVENUE_CODE",
      evidence,
    };
  }
  // Órgão arrecadador + exatamente um tributo citado.
  if (authority && tokens.length === 1) {
    return {
      ...base,
      classificationStatus: "TAX",
      taxType: tokens[0]!,
      suggestedTaxType: null,
      confidence: "HIGH",
      rule: "AUTHORITY_AND_SINGLE_TAX",
      evidence,
    };
  }
  if (tokens.length === 1 && detectTokens(classText).length === 1) {
    return {
      ...base,
      classificationStatus: "PENDING",
      taxType: null,
      suggestedTaxType: tokens[0]!,
      confidence: "MEDIUM",
      rule: "NOMUS_CLASSIFICATION_TOKEN",
      evidence,
    };
  }
  if (tokens.length >= 1 || authority || codeTaxes.length > 1) {
    return {
      ...base,
      classificationStatus: "PENDING",
      taxType: null,
      suggestedTaxType: tokens.length === 1 ? tokens[0]! : codeTaxes.length === 1 ? codeTaxes[0]! : null,
      confidence: "LOW",
      rule: tokens.length > 1 || codeTaxes.length > 1 ? "AMBIGUOUS_TAX_TOKENS" : authority ? "AUTHORITY_WITHOUT_TAX" : "DESCRIPTION_TOKEN",
      evidence,
    };
  }
  // Palavra genérica ("imposto", "tributo", "guia de recolhimento") nunca basta: vira pendência de classificação.
  if (GENERIC_TAX_WORDS.test(allText)) {
    return {
      ...base,
      classificationStatus: "PENDING",
      taxType: null,
      suggestedTaxType: null,
      confidence: "LOW",
      rule: "GENERIC_TAX_WORD",
      evidence: { ...evidence, genericWord: true },
    };
  }
  return {
    ...base,
    classificationStatus: "NOT_TAX",
    taxType: null,
    suggestedTaxType: null,
    confidence: "NONE",
    rule: null,
    evidence,
  };
}

/** Competência tributária do título: "MM/AAAA" citado no texto › competência AP › vencimento. */
export function resolveFiscal360ApCompetence(
  row: FiscalApSourceRow,
  decisionMonth: string | null
): { month: string; source: "DECISION" | "TEXT" | "AP_COMPETENCE" | "DUE_DATE" | "NONE" } {
  if (decisionMonth) return { month: decisionMonth, source: "DECISION" };
  const text = norm([row.description, row.comments].filter(Boolean).join(" "));
  const m = COMPETENCE_IN_TEXT.exec(text);
  if (m) return { month: `${m[2]}-${m[1]}`, source: "TEXT" };
  if (row.competenceDate) return { month: fiscal360MonthOf(row.competenceDate), source: "AP_COMPETENCE" };
  if (row.dueDate) return { month: fiscal360MonthOf(row.dueDate), source: "DUE_DATE" };
  return { month: FISCAL360_NO_MONTH, source: "NONE" };
}

export function buildFiscal360ApTitleFact(
  row: FiscalApSourceRow,
  ctx: {
    guideClaim: FiscalApGuideClaim;
    decision: FiscalApDecision | null;
    rules: FiscalApConfiguredRule[];
    treasury: FiscalApTreasuryEvidence | null;
  }
): FiscalApTitleFactDraft {
  const normalized = normalizeAccountsPayableTitle({
    externalId: row.externalId,
    classification: row.classification,
    description: row.description,
    comments: row.comments,
    paymentMethodName: row.paymentMethodName,
    dueDate: row.dueDate,
    paymentDate: row.paymentDate,
    settlementDate: row.settlementDate,
    amountPayable: row.amountPayable,
    amountPaid: row.amountPaid,
    balancePayable: row.balancePayable,
    suspendPayment: row.suspendPayment,
  } as Parameters<typeof normalizeAccountsPayableTitle>[0]);
  const removed = row.sourcePresenceStatus === "MISSING_CONFIRMED";
  const effectiveStatus = removed ? "REMOVED_AT_SOURCE" : normalized.effectiveStatus;
  const classification = classifyFiscal360ApTitle(row, ctx);
  const competence = resolveFiscal360ApCompetence(
    row,
    ctx.decision?.decisionType === "AP_CONFIRM_TAX" ? ctx.decision.competenceMonth : null
  );
  classification.evidence = { ...classification.evidence, competenceSource: competence.source };
  const intercompany = isIntercompanyPayable({
    companyName: row.companyName,
    personName: row.personName,
    personCnpj: row.personCnpj,
  });
  // Título entre empresas do grupo (reembolso, repasse) nunca vira pagamento tributário por inferência:
  // o recolhimento real é da própria empresa. Só decisão manual ou vínculo explícito com guia o promovem.
  if (intercompany && classification.classificationStatus === "TAX" && !classification.manualDecisionId && !ctx.guideClaim) {
    classification.suggestedTaxType = classification.taxType;
    classification.taxType = null;
    classification.classificationStatus = "PENDING";
    classification.confidence = "LOW";
    classification.rule = "INTERCOMPANY_TITLE";
    classification.evidence = { ...classification.evidence, intercompany: true };
  }
  return {
    apExternalId: row.externalId,
    apId: row.id,
    companyCnpj: resolveFiscal360GroupCnpj({ name: row.companyName }) ?? FISCAL360_UNKNOWN_COMPANY,
    companyName: row.companyName,
    personName: row.personName,
    personCnpj: row.personCnpj,
    description: row.description,
    nomusClassification: row.classification,
    documentNumber: row.documentNumber,
    dueDate: dateOnly(row.dueDate),
    competenceDate: dateOnly(row.competenceDate),
    competenceMonth: competence.month,
    amountOriginal: roundFiscal360(normalized.amountPayable),
    // Baixa sem numerário/forçada não é desembolso: fica sinalizada, não conta como pago.
    // Baixa sem numerário/forçada não é desembolso, mesmo com valor baixado: nunca conta como pago.
    amountPaid: normalized.isCancelled || normalized.isSpecialWriteOff ? 0 : roundFiscal360(normalized.cashRealizedAmount),
    balance: normalized.isCancelled || removed ? 0 : roundFiscal360(Math.max(0, row.balancePayable ?? 0)),
    effectiveStatus,
    settledWithoutCash: normalized.isSpecialWriteOff,
    apPaymentDate: dateOnly(row.paymentDate ?? row.settlementDate),
    treasuryPaidDate: dateOnly(ctx.treasury?.paidDate ?? null),
    treasuryMatchedAmount: ctx.treasury ? roundFiscal360(ctx.treasury.matchedAmount) : null,
    treasuryMatchCount: ctx.treasury?.matchCount ?? 0,
    classification,
    claimedByGuideId: ctx.guideClaim?.guideId ?? null,
    isIntercompany: intercompany,
    intercompanyCounterpartyCnpj: intercompany
      ? resolveFiscal360GroupCnpj({ cnpj: row.personCnpj, name: row.personName })
      : null,
    ruleVersion: FISCAL360_RULE_VERSIONS.apClassifier,
  };
}
