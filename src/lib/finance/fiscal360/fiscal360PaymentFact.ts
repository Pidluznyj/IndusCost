/**
 * Inteligência Fiscal 360° — obrigação de pagamento tributário (camada C), função PURA.
 *
 * Uma obrigação = uma linha, ancorada na guia (quando existe) ou no título AP tributário sem guia.
 * AP vinculado, comprovante e conciliação de Tesouraria são EVIDÊNCIAS da mesma obrigação:
 * o valor pago vem de UMA fonte só (AP vinculado › valor declarado na guia), nunca somado.
 */
import {
  FISCAL360_NO_MONTH,
  FISCAL360_RECONCILIATION_TOLERANCE,
  FISCAL360_RULE_VERSIONS,
  FISCAL360_UNKNOWN_COMPANY,
  fiscal360MonthOf,
  resolveFiscal360GroupCnpj,
  roundFiscal360,
  type Fiscal360PaymentStatus,
} from "./fiscal360Constants.js";

export type FiscalGuideSourceRow = {
  id: string;
  taxType: string;
  jurisdiction: string | null;
  revenueCode: string | null;
  guideType: string | null;
  guideNumber: string | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  dueDate: Date | null;
  assessedAmount: number;
  creditsAmount: number;
  compensationsAmount: number;
  interestAmount: number;
  fineAmount: number;
  amountDue: number;
  amountPaid: number;
  balanceDue: number;
  paidAt: Date | null;
  status: string;
  paymentAccount: string | null;
  accountsPayableExternalId: number | null;
  createdAt: Date;
  updatedAt: Date;
  periodCompanyName: string | null;
  proofCount: number;
};

/** Visão do título AP já materializado (FiscalApTitleFact) usada como evidência. */
export type FiscalApEvidence = {
  apExternalId: number;
  companyCnpj: string;
  amountOriginal: number;
  amountPaid: number;
  balance: number;
  effectiveStatus: string;
  settledWithoutCash: boolean;
  dueDate: string | null;
  apPaymentDate: string | null;
  treasuryPaidDate: string | null;
  treasuryMatchCount: number;
  /** Soma conciliada na Tesouraria (alocações AP do título). Conciliação parcial NÃO comprova o pagamento inteiro. */
  treasuryMatchedAmount?: number | null;
  bankAccountLabel?: string | null;
};

export type FiscalPaymentFactDraft = {
  anchorKey: string;
  anchorType: "GUIDE" | "AP_TITLE";
  guideId: string | null;
  apExternalId: number | null;
  companyCnpj: string;
  companyResolution: "PERIOD" | "AP" | "DECISION" | "UNKNOWN";
  taxType: string;
  jurisdiction: string | null;
  revenueCode: string | null;
  guideType: string | null;
  guideNumber: string | null;
  competenceMonth: string;
  periodStart: string | null;
  periodEnd: string | null;
  dueDate: string | null;
  amountOriginal: number;
  creditsAmount: number;
  compensationsAmount: number;
  interestAmount: number;
  fineAmount: number;
  amountDue: number;
  paidAmount: number;
  openBalance: number;
  paidAt: string | null;
  paidAtSource: "TREASURY" | "AP" | "GUIDE" | null;
  paidMonth: string | null;
  paymentAccount: string | null;
  proofCount: number;
  hasBankMatch: boolean;
  linkState: "GUIDE_ONLY" | "GUIDE_WITH_AP" | "AP_ONLY";
  apLinkSource: "FK" | "DECISION" | "NONE";
  paidSource: "AP_LINK" | "GUIDE_MANUAL" | "AP_TITLE" | "NONE";
  evidenceLevel: "NONE" | "MANUAL_DECLARED" | "ERP_SETTLEMENT" | "DOCUMENTARY_PROOF" | "BANK_MATCH";
  status: Fiscal360PaymentStatus;
  countsInPaidTotals: boolean;
  reviewReason: string | null;
  flags: string[];
  ruleVersion: string;
};

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return (typeof value === "string" ? value : value.toISOString()).slice(0, 10);
}

const SP_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });

/** Data civil (America/Sao_Paulo) de uma coluna timestamp: 21h30 BRT de 31/10 não vira 01/11 por causa do UTC. */
function civilDateSaoPaulo(value: Date): string {
  return SP_DATE.format(value);
}

/** Comprovação bancária só vale se a Tesouraria cobre o valor pago (tolerância de centavos). */
function isBankProven(ap: FiscalApEvidence | null | undefined, paid: number): boolean {
  return Boolean(ap && ap.treasuryMatchCount > 0 && (ap.treasuryMatchedAmount ?? 0) >= paid - FISCAL360_RECONCILIATION_TOLERANCE);
}

function resolveStatus(input: {
  amountDue: number;
  paid: number;
  evidence: FiscalPaymentFactDraft["evidenceLevel"];
  dueDate: string | null;
}): Fiscal360PaymentStatus {
  const tol = FISCAL360_RECONCILIATION_TOLERANCE;
  if (input.amountDue <= 0 && input.paid <= 0) return "INSUFFICIENT_DATA";
  if (input.paid > 0 && input.paid >= input.amountDue - tol) {
    if (input.evidence === "DOCUMENTARY_PROOF" || input.evidence === "BANK_MATCH") return "PAID_PROVEN";
    if (input.evidence === "ERP_SETTLEMENT") return "PAID_ERP";
    return "PAID_DECLARED";
  }
  if (input.paid > 0) return "PARTIAL";
  if (!input.dueDate) return "INSUFFICIENT_DATA";
  // Persistido sem depender de "hoje": vencido é derivado na leitura (effectiveFiscal360PaymentStatus).
  return "OPEN";
}

/** Situação efetiva na data de referência (OPEN/PARTIAL/REVERSED com vencimento passado → OVERDUE). */
export function effectiveFiscal360PaymentStatus(
  status: string,
  dueDate: string | null,
  openBalance: number,
  today: string
): string {
  if (status === "OPEN" && dueDate && dueDate < today && openBalance > 0) return "OVERDUE";
  return status;
}

function resolvePaidAt(
  ap: FiscalApEvidence | null,
  guidePaidAt: Date | null
): { paidAt: string | null; source: FiscalPaymentFactDraft["paidAtSource"] } {
  if (ap?.treasuryPaidDate) return { paidAt: ap.treasuryPaidDate, source: "TREASURY" };
  if (ap?.apPaymentDate) return { paidAt: ap.apPaymentDate, source: "AP" };
  if (guidePaidAt) return { paidAt: civilDateSaoPaulo(guidePaidAt), source: "GUIDE" };
  return { paidAt: null, source: null };
}

/** Competência da guia/apuração = mês do FIM do período (apuração trimestral cai no mês de encerramento). */
export function fiscal360GuideCompetence(periodStart: Date | null, periodEnd: Date | null): string {
  return fiscal360MonthOf(periodEnd ?? periodStart) ?? FISCAL360_NO_MONTH;
}

export function buildFiscal360GuidePaymentFact(
  guide: FiscalGuideSourceRow,
  ctx: {
    ap: FiscalApEvidence | null;
    apLinkSource: "FK" | "DECISION" | "NONE";
    /** Outra guia ganhou o título AP (duplicidade de vínculo). */
    apClaimLost: boolean;
    companyDecisionCnpj: string | null;
  }
): FiscalPaymentFactDraft {
  const flags: string[] = [];
  const ap = ctx.apClaimLost ? null : ctx.ap;
  const periodCnpj = resolveFiscal360GroupCnpj({ name: guide.periodCompanyName });
  let companyCnpj: string = FISCAL360_UNKNOWN_COMPANY;
  let companyResolution: FiscalPaymentFactDraft["companyResolution"] = "UNKNOWN";
  if (ctx.companyDecisionCnpj) {
    companyCnpj = ctx.companyDecisionCnpj;
    companyResolution = "DECISION";
  } else if (periodCnpj) {
    companyCnpj = periodCnpj;
    companyResolution = "PERIOD";
  } else if (ap && ap.companyCnpj !== FISCAL360_UNKNOWN_COMPANY) {
    companyCnpj = ap.companyCnpj;
    companyResolution = "AP";
  } else {
    flags.push("GUIDE_COMPANY_UNKNOWN");
  }
  if (ap && periodCnpj && ap.companyCnpj !== FISCAL360_UNKNOWN_COMPANY && ap.companyCnpj !== periodCnpj) {
    flags.push("AP_COMPANY_DIFFERS_FROM_PERIOD");
  }
  if (ctx.apClaimLost) flags.push("DUPLICATE_AP_LINK");

  const amountDue = roundFiscal360(guide.amountDue > 0 ? guide.amountDue : ap?.amountOriginal ?? 0);
  let paid = 0;
  let paidSource: FiscalPaymentFactDraft["paidSource"] = "NONE";
  let evidence: FiscalPaymentFactDraft["evidenceLevel"] = "NONE";
  if (ap) {
    if (ap.effectiveStatus === "CANCELLED" || ap.effectiveStatus === "REMOVED_AT_SOURCE") {
      flags.push(ap.effectiveStatus === "CANCELLED" ? "AP_CANCELLED" : "AP_REMOVED_AT_SOURCE");
    } else {
      paid = ap.amountPaid;
      paidSource = "AP_LINK";
      if (ap.settledWithoutCash && paid <= 0) flags.push("SETTLED_WITHOUT_CASH");
    }
    if (Math.abs(guide.amountPaid - ap.amountPaid) > FISCAL360_RECONCILIATION_TOLERANCE && guide.amountPaid > 0) {
      flags.push("GUIDE_PAID_DIFFERS_FROM_AP");
    }
  } else if (guide.amountPaid > 0) {
    paid = guide.amountPaid;
    paidSource = "GUIDE_MANUAL";
  }
  if (paid > 0) {
    if (ap && ap.treasuryMatchCount > 0 && !isBankProven(ap, paid)) flags.push("PARTIAL_BANK_MATCH");
    evidence = isBankProven(ap, paid)
      ? "BANK_MATCH"
      : guide.proofCount > 0
        ? "DOCUMENTARY_PROOF"
        : paidSource === "AP_LINK"
          ? "ERP_SETTLEMENT"
          : "MANUAL_DECLARED";
  }

  let status: Fiscal360PaymentStatus;
  let openBalance: number;
  if (guide.status === "CANCELLED") {
    status = "CANCELLED";
    paid = 0;
    paidSource = "NONE";
    evidence = "NONE";
    openBalance = 0;
  } else if (guide.status === "REVERSED") {
    // Estorno: a obrigação volta a ficar aberta; o pagamento original não é contado nem duplicado.
    status = "REVERSED";
    paid = 0;
    paidSource = "NONE";
    evidence = "NONE";
    openBalance = amountDue;
  } else {
    paid = roundFiscal360(paid);
    openBalance = roundFiscal360(Math.max(0, amountDue - paid));
    status = resolveStatus({ amountDue, paid, evidence, dueDate: iso(guide.dueDate) ?? ap?.dueDate ?? null });
  }

  const paidInfo = paid > 0 ? resolvePaidAt(ap, guide.paidAt) : { paidAt: null, source: null };
  if (paid > 0 && !paidInfo.paidAt) flags.push("NO_CASH_DATE");

  return {
    anchorKey: `GUIDE:${guide.id}`,
    anchorType: "GUIDE",
    guideId: guide.id,
    apExternalId: ap ? ap.apExternalId : null,
    companyCnpj,
    companyResolution,
    taxType: guide.taxType.trim().toUpperCase(),
    jurisdiction: guide.jurisdiction,
    revenueCode: guide.revenueCode,
    guideType: guide.guideType,
    guideNumber: guide.guideNumber,
    competenceMonth: fiscal360GuideCompetence(guide.periodStart, guide.periodEnd),
    periodStart: iso(guide.periodStart),
    periodEnd: iso(guide.periodEnd),
    dueDate: iso(guide.dueDate) ?? ap?.dueDate ?? null,
    amountOriginal: roundFiscal360(guide.assessedAmount),
    creditsAmount: roundFiscal360(guide.creditsAmount),
    compensationsAmount: roundFiscal360(guide.compensationsAmount),
    interestAmount: roundFiscal360(guide.interestAmount),
    fineAmount: roundFiscal360(guide.fineAmount),
    amountDue,
    paidAmount: paid,
    openBalance,
    paidAt: paidInfo.paidAt,
    paidAtSource: paidInfo.source,
    paidMonth: paidInfo.paidAt ? paidInfo.paidAt.slice(0, 7) : null,
    paymentAccount: guide.paymentAccount ?? ap?.bankAccountLabel ?? null,
    proofCount: guide.proofCount,
    hasBankMatch: Boolean(ap?.treasuryMatchCount),
    linkState: ap ? "GUIDE_WITH_AP" : "GUIDE_ONLY",
    apLinkSource: ap ? ctx.apLinkSource : "NONE",
    paidSource,
    evidenceLevel: evidence,
    status,
    countsInPaidTotals: !ctx.apClaimLost,
    reviewReason: ctx.apClaimLost ? "Título AP já vinculado a outra guia — pagamento não contado nesta guia." : null,
    flags,
    ruleVersion: FISCAL360_RULE_VERSIONS.payment,
  };
}

export function buildFiscal360ApPaymentFact(
  ap: FiscalApEvidence & {
    taxType: string;
    revenueCode: string | null;
    competenceMonth: string;
    documentNumber: string | null;
  },
): FiscalPaymentFactDraft {
  const flags: string[] = [];
  let paid = 0;
  let evidence: FiscalPaymentFactDraft["evidenceLevel"] = "NONE";
  let status: Fiscal360PaymentStatus;
  let openBalance = 0;
  const amountDue = roundFiscal360(ap.amountOriginal);
  if (ap.companyCnpj === FISCAL360_UNKNOWN_COMPANY) flags.push("AP_COMPANY_UNKNOWN");
  if (ap.effectiveStatus === "CANCELLED") {
    status = "CANCELLED";
  } else if (ap.settledWithoutCash && ap.amountPaid <= 0) {
    flags.push("SETTLED_WITHOUT_CASH");
    status = "INSUFFICIENT_DATA";
  } else {
    paid = roundFiscal360(ap.amountPaid);
    openBalance = roundFiscal360(ap.balance);
    if (paid > 0) {
      if (ap.treasuryMatchCount > 0 && !isBankProven(ap, paid)) flags.push("PARTIAL_BANK_MATCH");
      evidence = isBankProven(ap, paid) ? "BANK_MATCH" : "ERP_SETTLEMENT";
    }
    status = resolveStatus({ amountDue, paid, evidence, dueDate: ap.dueDate });
  }
  const paidInfo = paid > 0 ? resolvePaidAt(ap, null) : { paidAt: null, source: null };
  if (paid > 0 && !paidInfo.paidAt) flags.push("NO_CASH_DATE");
  return {
    anchorKey: `AP:${ap.apExternalId}`,
    anchorType: "AP_TITLE",
    guideId: null,
    apExternalId: ap.apExternalId,
    companyCnpj: ap.companyCnpj,
    companyResolution: ap.companyCnpj === FISCAL360_UNKNOWN_COMPANY ? "UNKNOWN" : "AP",
    taxType: ap.taxType,
    jurisdiction: null,
    revenueCode: ap.revenueCode,
    guideType: null,
    guideNumber: ap.documentNumber,
    competenceMonth: ap.competenceMonth,
    periodStart: null,
    periodEnd: null,
    dueDate: ap.dueDate,
    amountOriginal: amountDue,
    creditsAmount: 0,
    compensationsAmount: 0,
    interestAmount: 0,
    fineAmount: 0,
    amountDue,
    paidAmount: paid,
    openBalance,
    paidAt: paidInfo.paidAt,
    paidAtSource: paidInfo.source,
    paidMonth: paidInfo.paidAt ? paidInfo.paidAt.slice(0, 7) : null,
    paymentAccount: ap.bankAccountLabel ?? null,
    proofCount: 0,
    hasBankMatch: ap.treasuryMatchCount > 0,
    linkState: "AP_ONLY",
    apLinkSource: "NONE",
    paidSource: paid > 0 ? "AP_TITLE" : "NONE",
    evidenceLevel: evidence,
    status,
    countsInPaidTotals: true,
    reviewReason: null,
    flags,
    ruleVersion: FISCAL360_RULE_VERSIONS.payment,
  };
}

/** Partições (empresa × mês) afetadas por um fato: competência e mês de caixa. */
export function fiscal360PaymentPartitions(
  fact: Pick<FiscalPaymentFactDraft, "companyCnpj" | "competenceMonth" | "paidMonth"> | null | undefined
): Array<{ companyCnpj: string; month: string }> {
  if (!fact) return [];
  const out = [{ companyCnpj: fact.companyCnpj, month: fact.competenceMonth }];
  if (fact.paidMonth && fact.paidMonth !== fact.competenceMonth) {
    out.push({ companyCnpj: fact.companyCnpj, month: fact.paidMonth });
  }
  return out;
}
