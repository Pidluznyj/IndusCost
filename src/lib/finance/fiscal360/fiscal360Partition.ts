/**
 * Inteligência Fiscal 360° — conciliação e snapshot de UMA partição (empresa × competência). Função PURA.
 *
 * Entradas: fatos já materializados da partição (nunca fontes brutas). Saídas: itens de conciliação,
 * decisões de revisão sobre fatos de pagamento (possível duplicidade), pendências de qualidade e as
 * linhas de FiscalMonthlySnapshot / FiscalIntercompanySnapshot da partição.
 */
import {
  FISCAL360_ALL_TAXES,
  FISCAL360_RECONCILIATION_TOLERANCE,
  roundFiscal360,
} from "./fiscal360Constants.js";

export type PartitionDocTaxAggregate = {
  taxType: string;
  effect: string;
  operationClass: string;
  fiscalStatus: string;
  amount: number;
};

export type PartitionDocAggregate = {
  operationClass: string;
  fiscalStatus: string;
  xmlStatus: string;
  count: number;
  officialCount: number;
  officialRevenue: number;
  valorLiquido: number;
  vNF: number;
};

export type PartitionPaymentFact = {
  id: string;
  anchorKey: string;
  anchorType: string;
  guideId: string | null;
  apExternalId: number | null;
  companyCnpj: string;
  taxType: string;
  competenceMonth: string;
  dueDate: string | null;
  amountDue: number;
  paidAmount: number;
  openBalance: number;
  paidMonth: string | null;
  status: string;
  evidenceLevel: string;
  linkState: string;
  proofCount: number;
  hasBankMatch: boolean;
  flags: string[];
  countsInPaidTotals: boolean;
};

export type PartitionApurationLine = {
  periodId: string;
  periodStatus: string;
  taxType: string;
  nature: string;
  assessedAmount: number;
  creditsAmount: number;
  compensationsAmount: number;
  amountDue: number;
};

export type PartitionPendingAp = {
  apExternalId: number;
  suggestedTaxType: string | null;
  amountOriginal: number;
  confidence: string;
};

export type PartitionIntercompanyDoc = {
  recipientCnpj: string;
  count: number;
  documentValue: number;
  highlightedTax: number;
};

export type PartitionIntercompanyAp = {
  payerCnpj: string;
  count: number;
  amount: number;
  paid: number;
  open: number;
};

export type PartitionInput = {
  companyCnpj: string;
  month: string;
  docTaxes: PartitionDocTaxAggregate[];
  docs: PartitionDocAggregate[];
  /** Fatos de pagamento da competência. */
  payments: PartitionPaymentFact[];
  /** Fatos de pagamento (de qualquer competência) com mês de caixa = month. */
  cashPayments: PartitionPaymentFact[];
  /**
   * Universo para detectar duplicidade (mesma empresa): competência em ±1 mês e/ou mesmo mês de caixa dos
   * fatos desta partição. Padrão: só os fatos da competência.
   */
  pool?: PartitionPaymentFact[];
  apuration: PartitionApurationLine[];
  pendingAp: PartitionPendingAp[];
  intercompanyDocs: PartitionIntercompanyDoc[];
  intercompanyAp: PartitionIntercompanyAp[];
  /** Pares guia×AP marcados manualmente como obrigações distintas. */
  distinctPairs: Array<{ guideId: string; apExternalId: number }>;
  /** itemKeys com divergência aceita manualmente. */
  acceptedItemKeys: string[];
  openIssueCount: number;
};

export type ReconciliationItemDraft = {
  itemKey: string;
  companyCnpj: string;
  competenceMonth: string;
  taxType: string | null;
  checkType: string;
  status: "OK" | "DIVERGENT" | "MISSING" | "REVIEW" | "ACCEPTED";
  subjectType: string | null;
  subjectId: string | null;
  relatedType: string | null;
  relatedId: string | null;
  expectedAmount: number | null;
  actualAmount: number | null;
  difference: number | null;
  message: string;
  details: Record<string, unknown> | null;
};

export type SnapshotRowDraft = {
  companyCnpj: string;
  competenceMonth: string;
  taxType: string;
  highlightedAmount: number;
  highlightedMarketAmount: number;
  highlightedIntercompanyAmount: number;
  highlightedOtherAmount: number;
  stAmount: number;
  desoneratedAmount: number;
  informativeAmount: number;
  documentaryCreditAmount: number;
  assessedAmount: number;
  creditsAmount: number;
  retentionAmount: number;
  compensationAmount: number;
  apurationAmountDue: number;
  apurationStatus: "NONE" | "OPEN" | "CLOSED" | "MIXED";
  obligationAmountDue: number;
  paidAmount: number;
  paidProvenAmount: number;
  paidUnprovenAmount: number;
  paidDeclaredAmount: number;
  reviewAmount: number;
  paidByCashDateAmount: number;
  paidWithoutCashDateAmount: number;
  openBalance: number;
  officialRevenue: number;
  intercompanyRevenue: number;
  documentaryMovement: number;
  documentCount: number;
  officialDocumentCount: number;
  cancelledDocumentCount: number;
  missingXmlCount: number;
  paymentFactCount: number;
  pendingClassificationCount: number;
  pendingClassificationAmount: number;
  reconciliationOkCount: number;
  reconciliationItemCount: number;
  openIssueCount: number;
};

export type IntercompanyRowDraft = {
  issuerCnpj: string;
  recipientCnpj: string;
  competenceMonth: string;
  documentCount: number;
  documentValue: number;
  highlightedTaxAmount: number;
  apTitleCount: number;
  apAmount: number;
  apPaidAmount: number;
  apOpenAmount: number;
  divergenceAmount: number;
};

export type PaymentReviewUpdate = {
  id: string;
  countsInPaidTotals: boolean;
  reviewReason: string | null;
};

export type PartitionResult = {
  items: ReconciliationItemDraft[];
  paymentReviews: PaymentReviewUpdate[];
  /** Outras partições (mês de caixa) cujo total muda porque um fato mudou de situação de revisão. */
  affectedPartitions: Array<{ companyCnpj: string; month: string }>;
  snapshots: SnapshotRowDraft[];
  intercompany: IntercompanyRowDraft[];
};

const TOL = FISCAL360_RECONCILIATION_TOLERANCE;
const PROVEN = new Set(["DOCUMENTARY_PROOF", "BANK_MATCH"]);

function emptyRow(companyCnpj: string, month: string, taxType: string): SnapshotRowDraft {
  return {
    companyCnpj,
    competenceMonth: month,
    taxType,
    highlightedAmount: 0,
    highlightedMarketAmount: 0,
    highlightedIntercompanyAmount: 0,
    highlightedOtherAmount: 0,
    stAmount: 0,
    desoneratedAmount: 0,
    informativeAmount: 0,
    documentaryCreditAmount: 0,
    assessedAmount: 0,
    creditsAmount: 0,
    retentionAmount: 0,
    compensationAmount: 0,
    apurationAmountDue: 0,
    apurationStatus: "NONE",
    obligationAmountDue: 0,
    paidAmount: 0,
    paidProvenAmount: 0,
    paidUnprovenAmount: 0,
    paidDeclaredAmount: 0,
    reviewAmount: 0,
    paidByCashDateAmount: 0,
    paidWithoutCashDateAmount: 0,
    openBalance: 0,
    officialRevenue: 0,
    intercompanyRevenue: 0,
    documentaryMovement: 0,
    documentCount: 0,
    officialDocumentCount: 0,
    cancelledDocumentCount: 0,
    missingXmlCount: 0,
    paymentFactCount: 0,
    pendingClassificationCount: 0,
    pendingClassificationAmount: 0,
    reconciliationOkCount: 0,
    reconciliationItemCount: 0,
    openIssueCount: 0,
  };
}

const NUMERIC_KEYS = Object.keys(emptyRow("", "", "")).filter(
  (k) => typeof (emptyRow("", "", "") as Record<string, unknown>)[k] === "number"
) as Array<keyof SnapshotRowDraft>;

function monthIndex(month: string): number {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return y * 12 + (m - 1);
}

/**
 * Possível duplicidade: guia SEM AP com pagamento e título AP tributário SEM guia, mesma empresa e tributo,
 * competências a até 1 mês (ou mesmo mês de caixa) e valores equivalentes (±3%: juros/multa na guia).
 * Conta-se UMA vez: prevalece a evidência mais forte (comprovante/banco › baixa ERP › declarado); a outra fica em revisão.
 */
export function detectFiscal360PossibleDuplicates(
  payments: PartitionPaymentFact[],
  distinctPairs: Array<{ guideId: string; apExternalId: number }>
): Array<{ keep: PartitionPaymentFact; review: PartitionPaymentFact }> {
  const distinct = new Set(distinctPairs.map((p) => `${p.guideId}|${p.apExternalId}`));
  const rank = (p: PartitionPaymentFact) =>
    PROVEN.has(p.evidenceLevel) ? 3 : p.evidenceLevel === "ERP_SETTLEMENT" ? 2 : p.evidenceLevel === "MANUAL_DECLARED" ? 1 : 0;
  const guides = payments
    .filter((p) => p.anchorType === "GUIDE" && p.linkState === "GUIDE_ONLY" && p.paidAmount > 0)
    .sort((a, b) => a.anchorKey.localeCompare(b.anchorKey));
  const aps = payments
    .filter((p) => p.anchorType === "AP_TITLE" && p.paidAmount > 0)
    .sort((a, b) => a.anchorKey.localeCompare(b.anchorKey));
  const usedAp = new Set<string>();
  const out: Array<{ keep: PartitionPaymentFact; review: PartitionPaymentFact }> = [];
  for (const g of guides) {
    const match = aps.find(
      (a) =>
        !usedAp.has(a.id) &&
        a.companyCnpj === g.companyCnpj &&
        a.taxType === g.taxType &&
        (Math.abs(monthIndex(a.competenceMonth) - monthIndex(g.competenceMonth)) <= 1 || (a.paidMonth != null && a.paidMonth === g.paidMonth)) &&
        Math.abs(a.paidAmount - g.paidAmount) <= Math.max(TOL, Math.max(a.paidAmount, g.paidAmount) * 0.03) &&
        !distinct.has(`${g.guideId}|${a.apExternalId}`)
    );
    if (!match) continue;
    usedAp.add(match.id);
    const guideWins = rank(g) > rank(match);
    out.push(guideWins ? { keep: g, review: match } : { keep: match, review: g });
  }
  return out;
}

export function buildFiscal360Partition(input: PartitionInput): PartitionResult {
  const { companyCnpj, month } = input;
  const items: ReconciliationItemDraft[] = [];
  const accepted = new Set(input.acceptedItemKeys);
  const push = (item: Omit<ReconciliationItemDraft, "companyCnpj" | "competenceMonth">) => {
    // Chave única por partição: uma obrigação que muda de empresa/competência não colide com o item antigo.
    const itemKey = `${companyCnpj}:${month}|${item.itemKey}`;
    const status = item.status !== "OK" && accepted.has(itemKey) ? "ACCEPTED" : item.status;
    items.push({ ...item, itemKey, status, companyCnpj, competenceMonth: month });
  };

  // 1) Revisão de duplicidades e vínculos duplicados (decide o que entra no total pago).
  const duplicates = detectFiscal360PossibleDuplicates(input.pool ?? input.payments, input.distinctPairs);
  const reviewById = new Map<string, string>();
  for (const { keep, review } of duplicates) {
    reviewById.set(
      review.id,
      `Possível duplicidade com ${keep.anchorKey} — conta uma vez; confirme o vínculo ou marque como obrigações distintas.`
    );
    // O item de conciliação pertence à partição de competência do fato em revisão (evita itens repetidos).
    if (review.competenceMonth !== month) continue;
    push({
      itemKey: `POSSIBLE_DUPLICATE:${[keep.anchorKey, review.anchorKey].sort().join("|")}`,
      taxType: keep.taxType,
      checkType: "POSSIBLE_DUPLICATE",
      status: "REVIEW",
      subjectType: "PAYMENT_FACT",
      subjectId: review.anchorKey,
      relatedType: "PAYMENT_FACT",
      relatedId: keep.anchorKey,
      expectedAmount: keep.paidAmount,
      actualAmount: review.paidAmount,
      difference: roundFiscal360(review.paidAmount - keep.paidAmount),
      message: "Mesma obrigação aparenta estar na guia e em título AP sem vínculo.",
      details: { keep: keep.anchorKey, review: review.anchorKey },
    });
  }
  const paymentReviews: PaymentReviewUpdate[] = [];
  const affectedPartitions: Array<{ companyCnpj: string; month: string }> = [];
  const counts = new Map<string, boolean>();
  for (const p of input.payments) {
    const dupLink = p.flags.includes("DUPLICATE_AP_LINK");
    const reason = reviewById.get(p.id) ?? (dupLink ? "Título AP já vinculado a outra guia — pagamento não contado nesta guia." : null);
    const shouldCount = !reason;
    counts.set(p.id, shouldCount);
    // Só grava o que muda; duplicidade resolvida volta a contar com motivo limpo.
    if (shouldCount !== p.countsInPaidTotals || reviewById.has(p.id)) {
      paymentReviews.push({ id: p.id, countsInPaidTotals: shouldCount, reviewReason: reason });
      // O total de CAIXA do mês de pagamento depende deste flag: a partição de caixa precisa ser recalculada.
      if (shouldCount !== p.countsInPaidTotals && p.paidMonth && p.paidMonth !== month) {
        affectedPartitions.push({ companyCnpj: p.companyCnpj, month: p.paidMonth });
      }
    }
  }

  // 2) Checagens por obrigação.
  for (const p of input.payments) {
    if (p.status === "CANCELLED") continue;
    if (p.flags.includes("DUPLICATE_AP_LINK")) {
      push({
        itemKey: `DUPLICATE_AP_LINK:${p.anchorKey}`,
        taxType: p.taxType,
        checkType: "DUPLICATE_AP_LINK",
        status: "REVIEW",
        subjectType: "PAYMENT_FACT",
        subjectId: p.anchorKey,
        relatedType: null,
        relatedId: null,
        expectedAmount: null,
        actualAmount: null,
        difference: null,
        message: "O título AP desta guia já é evidência de outra guia.",
        details: null,
      });
    }
    if (p.anchorType === "GUIDE") {
      push({
        itemKey: `GUIDE_VS_AP:${p.anchorKey}`,
        taxType: p.taxType,
        checkType: p.linkState === "GUIDE_WITH_AP" ? "GUIDE_VS_AP" : "GUIDE_WITHOUT_AP",
        status: p.linkState === "GUIDE_WITH_AP" ? (p.flags.includes("GUIDE_PAID_DIFFERS_FROM_AP") ? "DIVERGENT" : "OK") : "MISSING",
        subjectType: "PAYMENT_FACT",
        subjectId: p.anchorKey,
        relatedType: p.apExternalId != null ? "AP_TITLE" : null,
        relatedId: p.apExternalId != null ? String(p.apExternalId) : null,
        expectedAmount: p.amountDue,
        actualAmount: p.paidAmount,
        difference: roundFiscal360(p.paidAmount - p.amountDue),
        message:
          p.linkState === "GUIDE_WITH_AP"
            ? "Guia vinculada a título do contas a pagar."
            : "Guia sem título correspondente no contas a pagar.",
        details: null,
      });
    } else {
      push({
        itemKey: `AP_TAX_WITHOUT_GUIDE:${p.anchorKey}`,
        taxType: p.taxType,
        checkType: "AP_TAX_WITHOUT_GUIDE",
        status: "REVIEW",
        subjectType: "PAYMENT_FACT",
        subjectId: p.anchorKey,
        relatedType: "AP_TITLE",
        relatedId: p.apExternalId != null ? String(p.apExternalId) : null,
        expectedAmount: p.amountDue,
        actualAmount: p.paidAmount,
        difference: null,
        message: "Título tributário identificado no AP sem guia cadastrada.",
        details: null,
      });
    }
    if (p.apExternalId != null) {
      const settled = p.paidAmount >= p.amountDue - TOL && p.paidAmount > 0;
      push({
        itemKey: `AP_VS_SETTLEMENT:${p.anchorKey}`,
        taxType: p.taxType,
        checkType: "AP_VS_SETTLEMENT",
        status: settled ? "OK" : p.paidAmount > 0 ? "REVIEW" : "MISSING",
        subjectType: "PAYMENT_FACT",
        subjectId: p.anchorKey,
        relatedType: "AP_TITLE",
        relatedId: String(p.apExternalId),
        expectedAmount: p.amountDue,
        actualAmount: p.paidAmount,
        difference: roundFiscal360(p.paidAmount - p.amountDue),
        message: settled ? "Baixa registrada no AP." : p.paidAmount > 0 ? "Baixa parcial no AP." : "Sem baixa no AP.",
        details: null,
      });
    }
    if (p.paidAmount > 0) {
      const proven = PROVEN.has(p.evidenceLevel);
      push({
        itemKey: `SETTLEMENT_VS_PROOF:${p.anchorKey}`,
        taxType: p.taxType,
        checkType: "SETTLEMENT_VS_PROOF",
        status: proven ? "OK" : "REVIEW",
        subjectType: "PAYMENT_FACT",
        subjectId: p.anchorKey,
        relatedType: null,
        relatedId: null,
        expectedAmount: null,
        actualAmount: p.paidAmount,
        difference: null,
        message: proven ? "Pagamento com comprovante ou conciliação bancária." : "Pagamento sem comprovante documental.",
        details: { evidenceLevel: p.evidenceLevel },
      });
    }
  }

  // 3) Apuração × guias por tributo; competência sem fechamento; créditos.
  const taxes = new Set<string>();
  for (const l of input.apuration) taxes.add(l.taxType);
  for (const p of input.payments) taxes.add(p.taxType);
  const apurationByTax = new Map<string, PartitionApurationLine[]>();
  for (const l of input.apuration) {
    const arr = apurationByTax.get(l.taxType) ?? [];
    arr.push(l);
    apurationByTax.set(l.taxType, arr);
  }
  const docCreditByTax = new Map<string, number>();
  for (const t of input.docTaxes) {
    if (t.effect === "DOCUMENTARY_CREDIT" && t.fiscalStatus === "AUTHORIZED") {
      docCreditByTax.set(t.taxType, (docCreditByTax.get(t.taxType) ?? 0) + t.amount);
    }
  }
  for (const taxType of [...taxes].sort()) {
    const lines = apurationByTax.get(taxType) ?? [];
    const guideDue = roundFiscal360(
      input.payments
        .filter((p) => p.taxType === taxType && p.anchorType === "GUIDE" && p.status !== "CANCELLED")
        .reduce((s, p) => s + p.amountDue, 0)
    );
    if (lines.length > 0) {
      const apurationDue = roundFiscal360(lines.reduce((s, l) => s + l.amountDue, 0));
      const diff = roundFiscal360(guideDue - apurationDue);
      push({
        itemKey: `APURATION_VS_GUIDE:${companyCnpj}:${month}:${taxType}`,
        taxType,
        checkType: "APURATION_VS_GUIDE",
        status: Math.abs(diff) <= TOL ? "OK" : guideDue === 0 ? "MISSING" : "DIVERGENT",
        subjectType: "APURATION",
        subjectId: `${companyCnpj}:${month}:${taxType}`,
        relatedType: null,
        relatedId: null,
        expectedAmount: apurationDue,
        actualAmount: guideDue,
        difference: diff,
        message:
          Math.abs(diff) <= TOL
            ? "Valor devido apurado coincide com as guias."
            : guideDue === 0
              ? "Tributo apurado sem guia emitida."
              : "Valor das guias difere do apurado.",
        details: { periods: [...new Set(lines.map((l) => l.periodId))] },
      });
      const credits = roundFiscal360(lines.reduce((s, l) => s + l.creditsAmount, 0));
      if (credits > 0) {
        const docCredits = roundFiscal360(docCreditByTax.get(taxType) ?? 0);
        push({
          itemKey: `CREDITS_UNRECONCILED:${companyCnpj}:${month}:${taxType}`,
          taxType,
          checkType: "CREDITS_UNRECONCILED",
          status: Math.abs(credits - docCredits) <= TOL ? "OK" : "REVIEW",
          subjectType: "APURATION",
          subjectId: `${companyCnpj}:${month}:${taxType}`,
          relatedType: null,
          relatedId: null,
          expectedAmount: credits,
          actualAmount: docCredits,
          difference: roundFiscal360(docCredits - credits),
          message: "Créditos da apuração × créditos documentais de entradas (creditabilidade não presumida).",
          details: null,
        });
      }
    }
    const closed = lines.length > 0 && lines.every((l) => l.periodStatus === "CLOSED");
    const hasGuides = input.payments.some((p) => p.taxType === taxType && p.anchorType === "GUIDE");
    if (hasGuides && !closed) {
      push({
        itemKey: `COMPETENCE_WITHOUT_CLOSING:${companyCnpj}:${month}:${taxType}`,
        taxType,
        checkType: "COMPETENCE_WITHOUT_CLOSING",
        status: "MISSING",
        subjectType: "APURATION",
        subjectId: `${companyCnpj}:${month}:${taxType}`,
        relatedType: null,
        relatedId: null,
        expectedAmount: null,
        actualAmount: guideDue,
        difference: null,
        message: lines.length === 0 ? "Competência com guia, sem apuração cadastrada." : "Apuração da competência não fechada.",
        details: null,
      });
    }
  }
  if (input.pendingAp.length > 0) {
    push({
      itemKey: `PENDING_CLASSIFICATION:${companyCnpj}:${month}`,
      taxType: null,
      checkType: "PENDING_CLASSIFICATION",
      status: "REVIEW",
      subjectType: "PARTITION",
      subjectId: `${companyCnpj}:${month}`,
      relatedType: null,
      relatedId: null,
      expectedAmount: null,
      actualAmount: roundFiscal360(input.pendingAp.reduce((s, a) => s + a.amountOriginal, 0)),
      difference: null,
      message: `${input.pendingAp.length} título(s) do AP aguardando classificação tributária.`,
      details: { apExternalIds: input.pendingAp.slice(0, 50).map((a) => a.apExternalId) },
    });
  }

  // 4) Snapshot por tributo + linha "*".
  const rows = new Map<string, SnapshotRowDraft>();
  const row = (taxType: string) => {
    let r = rows.get(taxType);
    if (!r) {
      r = emptyRow(companyCnpj, month, taxType);
      rows.set(taxType, r);
    }
    return r;
  };
  for (const t of input.docTaxes) {
    if (t.fiscalStatus !== "AUTHORIZED") continue;
    const r = row(t.taxType);
    if (t.effect === "DEBIT") {
      r.highlightedAmount += t.amount;
      if (t.operationClass === "MARKET_SALE") r.highlightedMarketAmount += t.amount;
      else if (t.operationClass === "INTERCOMPANY") r.highlightedIntercompanyAmount += t.amount;
      else r.highlightedOtherAmount += t.amount;
    } else if (t.effect === "ST") r.stAmount += t.amount;
    else if (t.effect === "DESONERATED") r.desoneratedAmount += t.amount;
    else if (t.effect === "INFORMATIVE") r.informativeAmount += t.amount;
    else if (t.effect === "DOCUMENTARY_CREDIT") r.documentaryCreditAmount += t.amount;
  }
  const periodStatuses = new Map<string, Set<string>>();
  for (const l of input.apuration) {
    const r = row(l.taxType);
    r.assessedAmount += l.assessedAmount;
    r.creditsAmount += l.creditsAmount;
    r.compensationAmount += l.compensationsAmount;
    if (l.nature === "RETENTION") r.retentionAmount += l.amountDue || l.assessedAmount;
    r.apurationAmountDue += l.amountDue;
    const set = periodStatuses.get(l.taxType) ?? new Set<string>();
    set.add(l.periodStatus);
    periodStatuses.set(l.taxType, set);
  }
  for (const [taxType, set] of periodStatuses) {
    row(taxType).apurationStatus = set.size > 1 ? "MIXED" : set.has("CLOSED") ? "CLOSED" : "OPEN";
  }
  for (const p of input.payments) {
    const r = row(p.taxType);
    r.paymentFactCount += 1;
    if (p.status === "CANCELLED") continue;
    // Obrigação em revisão (duplicada) não conta devido, saldo nem pago: a outra evidência a representa.
    if (!counts.get(p.id)) {
      if (p.paidAmount > 0) r.reviewAmount += p.paidAmount;
      continue;
    }
    r.obligationAmountDue += p.amountDue;
    r.openBalance += p.openBalance;
    if (p.paidAmount <= 0) continue;
    r.paidAmount += p.paidAmount;
    if (PROVEN.has(p.evidenceLevel)) r.paidProvenAmount += p.paidAmount;
    else if (p.evidenceLevel === "ERP_SETTLEMENT") r.paidUnprovenAmount += p.paidAmount;
    else r.paidDeclaredAmount += p.paidAmount;
    if (!p.paidMonth) r.paidWithoutCashDateAmount += p.paidAmount;
  }
  for (const p of input.cashPayments) {
    if (p.status === "CANCELLED" || p.paidAmount <= 0 || p.paidMonth !== month) continue;
    // Revisão vem da partição de competência; aqui só respeitamos o flag persistido.
    const countsHere = p.competenceMonth === month ? counts.get(p.id) ?? p.countsInPaidTotals : p.countsInPaidTotals;
    if (!countsHere) continue;
    row(p.taxType).paidByCashDateAmount += p.paidAmount;
  }
  for (const a of input.pendingAp) {
    if (a.suggestedTaxType) {
      const r = row(a.suggestedTaxType);
      r.pendingClassificationCount += 1;
      r.pendingClassificationAmount += a.amountOriginal;
    }
  }
  for (const item of items) {
    if (!item.taxType) continue;
    const r = row(item.taxType);
    r.reconciliationItemCount += 1;
    if (item.status === "OK" || item.status === "ACCEPTED") r.reconciliationOkCount += 1;
  }

  const total = emptyRow(companyCnpj, month, FISCAL360_ALL_TAXES);
  for (const r of rows.values()) {
    for (const key of NUMERIC_KEYS) {
      if (key === "pendingClassificationCount" || key === "pendingClassificationAmount") continue;
      if (key === "reconciliationItemCount" || key === "reconciliationOkCount") continue;
      (total[key] as number) += r[key] as number;
    }
  }
  const statuses = new Set([...periodStatuses.values()].flatMap((s) => [...s]));
  total.apurationStatus = statuses.size === 0 ? "NONE" : statuses.size > 1 ? "MIXED" : statuses.has("CLOSED") ? "CLOSED" : "OPEN";
  total.pendingClassificationCount = input.pendingAp.length;
  total.pendingClassificationAmount = input.pendingAp.reduce((s, a) => s + a.amountOriginal, 0);
  total.reconciliationItemCount = items.length;
  total.reconciliationOkCount = items.filter((i) => i.status === "OK" || i.status === "ACCEPTED").length;
  total.openIssueCount = input.openIssueCount;
  for (const d of input.docs) {
    total.documentCount += d.count;
    total.officialDocumentCount += d.officialCount;
    total.officialRevenue += d.officialRevenue;
    if (d.fiscalStatus === "CANCELLED") total.cancelledDocumentCount += d.count;
    if (d.xmlStatus !== "XML") total.missingXmlCount += d.count;
    if (d.fiscalStatus === "AUTHORIZED") {
      total.documentaryMovement += d.vNF;
      if (d.operationClass === "INTERCOMPANY") total.intercompanyRevenue += d.valorLiquido || d.vNF;
    }
  }

  const snapshots = [...[...rows.values()].sort((a, b) => a.taxType.localeCompare(b.taxType)), total].map((r) => {
    const out = { ...r };
    for (const key of NUMERIC_KEYS) {
      if (key.endsWith("Count")) continue;
      (out[key] as number) = roundFiscal360(out[key] as number);
    }
    return out;
  });

  // 5) Intercompany (partição do emitente).
  const pairs = new Map<string, IntercompanyRowDraft>();
  const pair = (recipient: string) => {
    let p = pairs.get(recipient);
    if (!p) {
      p = {
        issuerCnpj: companyCnpj,
        recipientCnpj: recipient,
        competenceMonth: month,
        documentCount: 0,
        documentValue: 0,
        highlightedTaxAmount: 0,
        apTitleCount: 0,
        apAmount: 0,
        apPaidAmount: 0,
        apOpenAmount: 0,
        divergenceAmount: 0,
      };
      pairs.set(recipient, p);
    }
    return p;
  };
  for (const d of input.intercompanyDocs) {
    const p = pair(d.recipientCnpj);
    p.documentCount += d.count;
    p.documentValue += d.documentValue;
    p.highlightedTaxAmount += d.highlightedTax;
  }
  for (const a of input.intercompanyAp) {
    const p = pair(a.payerCnpj);
    p.apTitleCount += a.count;
    p.apAmount += a.amount;
    p.apPaidAmount += a.paid;
    p.apOpenAmount += a.open;
  }
  const intercompany = [...pairs.values()]
    .sort((a, b) => a.recipientCnpj.localeCompare(b.recipientCnpj))
    .map((p) => ({
      ...p,
      documentValue: roundFiscal360(p.documentValue),
      highlightedTaxAmount: roundFiscal360(p.highlightedTaxAmount),
      apAmount: roundFiscal360(p.apAmount),
      apPaidAmount: roundFiscal360(p.apPaidAmount),
      apOpenAmount: roundFiscal360(p.apOpenAmount),
      divergenceAmount: roundFiscal360(p.documentValue - p.apAmount),
    }));

  return { items, paymentReviews, affectedPartitions, snapshots, intercompany };
}
