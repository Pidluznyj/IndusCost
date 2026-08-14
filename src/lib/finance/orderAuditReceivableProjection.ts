/**
 * FASE 2C — mapper PURO de `NomusAccountsReceivable` → `OrderFullAuditReceivable`.
 *
 * Era o laço `for (const r of arRows)` inline de `loadOrderFullAuditUncached`.
 * Foi extraído para que o auditor 360º e o loader leve do Fluxo de Caixa
 * projetem os CRs pela MESMA regra: status financeiro, alertas por linha,
 * parcela lida da descrição, saldo com tolerância e dedup por externalId.
 *
 * FONTE OFICIAL: `NomusAccountsReceivable`. Este módulo não cria verdade
 * financeira nova — só reorganiza o que já era feito.
 *
 * CAMPOS EXIGIDOS PELA PARIDADE (documentados porque vão além do mínimo que o
 * Fluxo de Caixa consome, mas são necessários para o mapper produzir o MESMO
 * objeto que o audit produz hoje):
 *   - `comments`        → fallback do parser de parcela e campo `comments`
 *   - `createdAtNomus`  → `issueDate`
 *   - `scheduleDate` / `amountScheduled` → campos homônimos
 *   - `rawPayload`      → único caminho para `paymentTermsText`
 * Sem eles o mapper divergiria do audit, que é exatamente o que a extração
 * existe para impedir.
 *
 * Sem Prisma. Sem I/O.
 */

import type { OrderFullAuditReceivable } from "@/src/lib/finance/orderFullAuditClient.js";
import {
  decimalToNumber,
  readNomusRawString,
  toIso,
} from "@/src/lib/finance/orderAuditItemProjection.js";

export const RECEIVABLE_MONEY_TOLERANCE = 0.01;

/** Campos de `NomusAccountsReceivable` lidos pelo mapper. */
export type OrderAuditReceivableSource = {
  id?: string | null;
  externalId: number;
  companyName?: string | null;
  personName?: string | null;
  personCnpj?: string | null;
  description?: string | null;
  comments?: string | null;
  sourceInvoiceId?: number | null;
  sourceInvoiceNumber?: string | null;
  createdAtNomus?: Date | string | null;
  dueDate?: Date | null;
  competenceDate?: Date | string | null;
  scheduleDate?: Date | string | null;
  settlementDate?: Date | string | null;
  amountReceivable?: unknown;
  amountScheduled?: unknown;
  amountReceived?: unknown;
  balanceReceivable?: unknown;
  paymentMethodName?: string | null;
  bankAccountName?: string | null;
  rawPayload?: unknown;
};

/** Recorte da NF usado para decorar o CR (vem do mapa de NFs do chamador). */
export type ReceivableLinkedNfe = {
  numero?: string | null;
  statusLabel?: string | null;
  isCanceled?: boolean;
};

export type ProjectOrderAuditReceivablesInput = {
  rows: ReadonlyArray<OrderAuditReceivableSource>;
  /** NF por `externalId` — o audit passa seu mapa enriquecido. */
  nfeByExternalId?: ReadonlyMap<number, ReceivableLinkedNfe>;
  /** "Agora" da avaliação de vencido/dias em atraso. */
  referenceDate: Date;
};

/**
 * Parcela a partir da descrição/comentário.
 * Padrões aceitos: "1/3", "Parcela 2/4", "Parc 1 de 3".
 */
export function parseReceivableInstallment(desc: string | null | undefined): {
  current: number | null;
  total: number | null;
} {
  if (!desc) return { current: null, total: null };
  const match = /(\d{1,3})\s*(?:\/|\s+de\s+)\s*(\d{1,3})/i.exec(desc) ?? null;
  if (!match) return { current: null, total: null };
  const cur = Number(match[1]);
  const tot = Number(match[2]);
  if (!Number.isFinite(cur) || !Number.isFinite(tot) || tot < cur) {
    return { current: null, total: null };
  }
  return { current: cur, total: tot };
}

/**
 * Dedup oficial: por `receivableExternalId`, **último vence**.
 *
 * É o comportamento do `new Map(...)` que já existia — a última linha com o
 * mesmo externalId sobrescreve as anteriores, e a ordem final é a de PRIMEIRA
 * aparição de cada chave. Não é "correção de duplicidade": é o retrato do que
 * o sistema faz hoje.
 */
export function dedupOrderAuditReceivables(
  receivables: ReadonlyArray<OrderFullAuditReceivable>
): OrderFullAuditReceivable[] {
  return [
    ...new Map(receivables.map((r) => [r.receivableExternalId, r])).values(),
  ];
}

export function projectOrderAuditReceivables(
  input: ProjectOrderAuditReceivablesInput
): OrderFullAuditReceivable[] {
  const referenceMs = input.referenceDate.getTime();
  const TOL = RECEIVABLE_MONEY_TOLERANCE;
  const receivables: OrderFullAuditReceivable[] = [];

  for (const r of input.rows) {
    const amountReceivable = decimalToNumber(r.amountReceivable) ?? 0;
    const amountScheduled = decimalToNumber(r.amountScheduled);
    const amountReceived = decimalToNumber(r.amountReceived) ?? 0;
    const balance =
      decimalToNumber(r.balanceReceivable) ??
      Math.max(0, amountReceivable - amountReceived);
    const isReceived = balance <= TOL && amountReceived > TOL;
    const isPartial = amountReceived > TOL && balance > TOL;
    const isOverdue =
      !isReceived &&
      balance > TOL &&
      r.dueDate != null &&
      r.dueDate.getTime() < referenceMs;
    const daysOverdue =
      r.dueDate != null && !isReceived
        ? Math.floor((referenceMs - r.dueDate.getTime()) / (1000 * 60 * 60 * 24))
        : null;
    const installment = parseReceivableInstallment(
      r.description ?? r.comments ?? null
    );
    // Referência oficial para "Abrir no Contas a Receber". Prioriza número da NF
    // (o filtro `search` do CR aceita string livre); fallback: externalId do CR.
    const searchRef =
      r.sourceInvoiceNumber?.trim() ||
      (r.sourceInvoiceId != null ? String(r.sourceInvoiceId) : "") ||
      String(r.externalId);

    const linkedNfe =
      r.sourceInvoiceId != null
        ? input.nfeByExternalId?.get(r.sourceInvoiceId)
        : undefined;
    const linkedNfeIsCanceled = linkedNfe?.isCanceled === true;
    const status: OrderFullAuditReceivable["status"] = isReceived
      ? "RECEIVED"
      : isPartial
        ? "PARTIALLY_RECEIVED"
        : isOverdue
          ? "OVERDUE"
          : balance > TOL
            ? "OPEN"
            : "UNKNOWN";

    const alertsForLine: string[] = [];
    if (!isReceived && balance > TOL) alertsForLine.push("RECEIVABLE_OPEN");
    if (isOverdue) alertsForLine.push("RECEIVABLE_OVERDUE");
    if (r.sourceInvoiceId == null) alertsForLine.push("RECEIVABLE_WITHOUT_NFE");
    if (r.dueDate == null) alertsForLine.push("RECEIVABLE_WITHOUT_DUE_DATE");
    if (amountReceived - amountReceivable > TOL) {
      alertsForLine.push("RECEIPT_GREATER_THAN_RECEIVABLE");
    }
    if (isPartial && Math.abs(amountReceivable - amountReceived - balance) > TOL) {
      alertsForLine.push("PARTIAL_RECEIPT_WITH_INCONSISTENT_BALANCE");
    }
    if (linkedNfeIsCanceled) {
      alertsForLine.push("CANCELED_NFE_WITH_RECEIVABLE");
      if (status === "RECEIVED" || status === "PARTIALLY_RECEIVED") {
        alertsForLine.push("RECEIVED_CR_LINKED_TO_CANCELED_NFE");
      }
    }

    receivables.push({
      receivableExternalId: r.externalId,
      receivableId: r.id ?? null,
      companyName: r.companyName ?? null,
      personName: r.personName ?? null,
      personCnpj: r.personCnpj ?? null,
      description: r.description ?? null,
      sourceInvoiceId: r.sourceInvoiceId ?? null,
      sourceInvoiceNumber: r.sourceInvoiceNumber ?? null,
      issueDate: toIso(r.createdAtNomus),
      dueDate: toIso(r.dueDate),
      competenceDate: toIso(r.competenceDate),
      scheduleDate: toIso(r.scheduleDate),
      settlementDate: toIso(r.settlementDate),
      amountReceivable,
      amountScheduled,
      amountReceived,
      balanceReceivable: balance,
      installmentNumber: installment.current,
      totalInstallments: installment.total,
      paymentTermsText: readNomusRawString(r.rawPayload, [
        "condicaoPagamento",
        "descricaoCondicaoPagamento",
        "paymentTerms",
        "textoCondicaoPagamento",
      ]),
      paymentMethodName: r.paymentMethodName ?? null,
      bankAccountName: r.bankAccountName ?? null,
      comments: r.comments ?? null,
      status,
      receivableIsReceived: status === "RECEIVED",
      daysOverdue,
      linkedNfeExternalIds: r.sourceInvoiceId != null ? [r.sourceInvoiceId] : [],
      linkedNfeNumber: linkedNfe?.numero ?? r.sourceInvoiceNumber ?? null,
      linkedNfeStatusLabel: linkedNfe?.statusLabel ?? null,
      linkedNfeIsCanceled,
      hasCanceledNfeLink: linkedNfeIsCanceled,
      origin: r.sourceInvoiceId != null ? "SOURCE_INVOICE" : "UNKNOWN",
      linkOrigin: r.sourceInvoiceId != null ? "SOURCE_INVOICE" : "UNKNOWN",
      alerts: alertsForLine,
      searchReference: searchRef,
    } as unknown as OrderFullAuditReceivable);
  }

  return receivables;
}
