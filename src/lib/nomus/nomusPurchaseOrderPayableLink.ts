/**
 * Vínculo Pedido de Compra Nomus ↔ Contas a Pagar — regras PURAS (sem Prisma).
 *
 * Objetivo: dar baixa no Pedido de Compra conforme os títulos vão sendo
 * baixados no Contas a Pagar, sem inventar relação.
 *
 * O espelho do título (`NomusAccountsPayable`) NÃO carrega `idPedidoCompra`.
 * Por isso o vínculo é montado em CAMADAS, da mais forte para a mais fraca, e
 * as camadas fracas nunca se aplicam sozinhas — viram SUGESTÃO para confirmação
 * humana:
 *
 *  1. DIRECT_NOMUS_NFE (EXACT, automático)
 *     pedido.rawPayload.nfes[] → NomusNfe.externalId → título.sourceInvoiceId.
 *     É a regra que já existia no 360; preservada sem alteração.
 *  2. STOCK_DOCUMENT_PURCHASE_ORDER (EXACT, automático)
 *     documento de entrada de estoque cujo rawJson aponta `idPedidoCompra`
 *     deste pedido → idNfe → título.sourceInvoiceId. Caminho inverso do que o
 *     360 já usava só como evidência; cobre pedidos cujo payload não lista a NF.
 *  3. AP_DOCUMENT_NUMBER (EXACT, automático)
 *     título cujo `documentNumber` é EXATAMENTE o número do pedido
 *     (`orderNumber`) ou o `externalId` do pedido. Comparação estrita após
 *     normalização de zeros/espaços — nunca "contém", nunca parecido.
 *  4. INSTALLMENT_MATCH (SUGESTÃO, exige confirmação humana)
 *     parcela planejada × título do MESMO fornecedor e MESMA empresa, com
 *     mesmo valor e mesmo vencimento. Nunca vincula sozinha.
 *  5. MANUAL (confirmação humana explícita, com autor e data)
 *
 * Fornecedor igual, sozinho, NUNCA gera vínculo (regra preservada do 360).
 * A baixa continua sendo do Nomus: aqui só se lê `NomusAccountsPayable` pela
 * autoridade oficial `normalizeAccountsPayableTitle` (Contas a Pagar).
 */

import {
  normalizeAccountsPayableTitle,
  type NormalizedAccountsPayableTitle,
} from "@/src/lib/financeAccountsPayableRules.js";
import {
  classifyPurchaseOrderFinancialStatus,
  type PlannedInstallment,
  type PurchaseOrderFinancialStatus,
} from "./nomusPurchaseOrder360.js";

/* ------------------------------------------------------------------ *
 * Vocabulário
 * ------------------------------------------------------------------ */

export const PURCHASE_ORDER_PAYABLE_LINK_METHODS = [
  "DIRECT_NOMUS_NFE",
  "STOCK_DOCUMENT_PURCHASE_ORDER",
  "AP_DOCUMENT_NUMBER",
  "INSTALLMENT_MATCH",
  "MANUAL",
] as const;

export type PurchaseOrderPayableLinkMethod =
  (typeof PURCHASE_ORDER_PAYABLE_LINK_METHODS)[number];

/** Métodos que o servidor pode aplicar sozinho (chave oficial dos dois lados). */
export const PURCHASE_ORDER_PAYABLE_AUTOMATIC_METHODS: readonly PurchaseOrderPayableLinkMethod[] = [
  "DIRECT_NOMUS_NFE",
  "STOCK_DOCUMENT_PURCHASE_ORDER",
  "AP_DOCUMENT_NUMBER",
];

/** Métodos que só existem depois de um humano confirmar. */
export const PURCHASE_ORDER_PAYABLE_CONFIRMABLE_METHODS: readonly PurchaseOrderPayableLinkMethod[] = [
  "INSTALLMENT_MATCH",
  "MANUAL",
];

export type PurchaseOrderPayableLinkConfidence = "EXACT" | "CONFIRMED";

export const PURCHASE_ORDER_PAYABLE_LINK_METHOD_LABELS: Record<
  PurchaseOrderPayableLinkMethod,
  string
> = {
  DIRECT_NOMUS_NFE: "NF-e do pedido",
  STOCK_DOCUMENT_PURCHASE_ORDER: "Documento de entrada",
  AP_DOCUMENT_NUMBER: "Nº do pedido no título",
  INSTALLMENT_MATCH: "Parcela conferida",
  MANUAL: "Vínculo manual",
};

export function isAutomaticPurchaseOrderPayableMethod(
  method: string
): method is PurchaseOrderPayableLinkMethod {
  return (PURCHASE_ORDER_PAYABLE_AUTOMATIC_METHODS as readonly string[]).includes(method);
}

export function parsePurchaseOrderPayableLinkMethod(
  value: unknown
): PurchaseOrderPayableLinkMethod | null {
  const text = String(value ?? "").trim().toUpperCase();
  return (PURCHASE_ORDER_PAYABLE_LINK_METHODS as readonly string[]).includes(text)
    ? (text as PurchaseOrderPayableLinkMethod)
    : null;
}

export class PurchaseOrderPayableLinkError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly field?: string;

  constructor(code: string, message: string, httpStatus = 400, field?: string) {
    super(message);
    this.name = "PurchaseOrderPayableLinkError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.field = field;
  }
}

export const PURCHASE_ORDER_PAYABLE_LINK_REASON_MAX_LENGTH = 500;

export function normalizePurchaseOrderPayableLinkReason(raw: unknown, required: boolean): string | null {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) {
    if (!required) return null;
    throw new PurchaseOrderPayableLinkError(
      "PURCHASE_ORDER_PAYABLE_LINK_REASON_REQUIRED",
      "Informe o motivo do vínculo/desvínculo.",
      400,
      "reason"
    );
  }
  if (text.length > PURCHASE_ORDER_PAYABLE_LINK_REASON_MAX_LENGTH) {
    throw new PurchaseOrderPayableLinkError(
      "PURCHASE_ORDER_PAYABLE_LINK_REASON_TOO_LONG",
      `Motivo deve ter no máximo ${PURCHASE_ORDER_PAYABLE_LINK_REASON_MAX_LENGTH} caracteres.`,
      400,
      "reason"
    );
  }
  return text;
}

export const PURCHASE_ORDER_PAYABLE_LINK_HISTORY_ACTIONS = {
  linked: "PURCHASE_ORDER_PAYABLE_LINKED",
  unlinked: "PURCHASE_ORDER_PAYABLE_UNLINKED",
} as const;

/* ------------------------------------------------------------------ *
 * Identidade / normalização
 * ------------------------------------------------------------------ */

/** Só dígitos — para comparar documento/CNPJ sem depender de máscara. */
export function digitsOnly(value: string | null | undefined): string {
  return String(value ?? "").replace(/\D/g, "");
}

/**
 * Número de documento comparável: maiúsculas, sem separadores e sem zeros à
 * esquerda. "PC00476", "pc-00476" e "476" com prefixo igual continuam
 * comparáveis; textos diferentes continuam diferentes.
 */
export function normalizeDocumentNumber(value: string | null | undefined): string {
  const text = String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (!text) return "";
  const trimmed = text.replace(/^0+(?=\d)/, "");
  return trimmed || text;
}

/** Dia civil local `YYYY-MM-DD` — mesma convenção de datas civis do repo. */
export function civilDayKey(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Tolerância de centavo: valores monetários iguais para fim de conferência. */
export function sameMoney(a: number | null | undefined, b: number | null | undefined): boolean {
  if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= 0.005;
}

/* ------------------------------------------------------------------ *
 * Entrada
 * ------------------------------------------------------------------ */

export type PayableCandidateRow = {
  externalId: number;
  companyId: number | null;
  personId: number | null;
  personName: string | null;
  personCnpj: string | null;
  documentNumber: string | null;
  sourceInvoiceId: number | null;
  sourceInvoiceNumber: string | null;
  dueDate: Date | null;
  paymentDate: Date | null;
  settlementDate: Date | null;
  amountPayable: number | null;
  amountPaid: number | null;
  balancePayable: number | null;
  paymentMethodId: number | null;
  paymentMethodName: string | null;
  bankAccountId: number | null;
  description: string | null;
  comments: string | null;
  classification: string | null;
  nomusStatus: boolean | null;
  suspendPayment: boolean | null;
};

export type PurchaseOrderLinkIdentity = {
  id: string;
  externalId: number;
  orderNumber: string | null;
  companyId: number | null;
  supplierExternalId: number | null;
  supplierTaxId: string | null;
};

export type PersistedPayableLinkRow = {
  id: string;
  nomusPurchaseOrderId: string;
  payableExternalId: number;
  installmentIndex: number | null;
  method: string;
  confidence: string;
  evidence: string | null;
  reason: string | null;
  createdByUserId: string | null;
  createdByUserName: string | null;
  createdAt: Date;
};

/* ------------------------------------------------------------------ *
 * Camadas automáticas (chave oficial dos dois lados)
 * ------------------------------------------------------------------ */

export type AutomaticLinkResolution = {
  payableExternalId: number;
  method: PurchaseOrderPayableLinkMethod;
  evidence: string;
};

/**
 * Camadas 1–3. Cada uma exige uma chave oficial presente nos DOIS lados; a
 * ausência de chave nunca vira aproximação.
 *
 * @param invoiceIds NF-e ligadas ao pedido: `rawPayload.nfes[]` (camada 1) e
 *   NF-e de documentos de entrada que apontam este pedido (camada 2).
 */
export function resolveAutomaticPayableLinks(input: {
  order: PurchaseOrderLinkIdentity;
  payables: readonly PayableCandidateRow[];
  /** NF-e declaradas no próprio pedido. */
  directInvoiceIds: readonly number[];
  /** NF-e alcançadas por documento de entrada com idPedidoCompra deste pedido. */
  stockDocumentInvoiceIds: readonly number[];
}): AutomaticLinkResolution[] {
  const direct = new Set(input.directInvoiceIds);
  const viaStock = new Set(input.stockDocumentInvoiceIds);
  const orderKeys = new Set(
    [normalizeDocumentNumber(input.order.orderNumber), normalizeDocumentNumber(String(input.order.externalId))].filter(
      (key) => key.length > 0
    )
  );

  const resolved = new Map<number, AutomaticLinkResolution>();
  for (const payable of input.payables) {
    const invoiceId = payable.sourceInvoiceId;
    if (invoiceId != null && direct.has(invoiceId)) {
      resolved.set(payable.externalId, {
        payableExternalId: payable.externalId,
        method: "DIRECT_NOMUS_NFE",
        evidence: `NF-e ${invoiceId} declarada no pedido → título.sourceInvoiceId`,
      });
      continue;
    }
    if (invoiceId != null && viaStock.has(invoiceId)) {
      resolved.set(payable.externalId, {
        payableExternalId: payable.externalId,
        method: "STOCK_DOCUMENT_PURCHASE_ORDER",
        evidence: `Documento de entrada com idPedidoCompra ${input.order.externalId} → NF-e ${invoiceId} → título.sourceInvoiceId`,
      });
      continue;
    }
    const documentKey = normalizeDocumentNumber(payable.documentNumber);
    if (documentKey && orderKeys.has(documentKey) && isSameSupplier(input.order, payable)) {
      resolved.set(payable.externalId, {
        payableExternalId: payable.externalId,
        method: "AP_DOCUMENT_NUMBER",
        evidence: `título.documentNumber "${payable.documentNumber}" idêntico ao número do pedido`,
      });
    }
  }
  return [...resolved.values()].sort((a, b) => a.payableExternalId - b.payableExternalId);
}

/** Fornecedor igual por ID Nomus; sem ID, por CNPJ. Nunca por nome. */
export function isSameSupplier(
  order: Pick<PurchaseOrderLinkIdentity, "supplierExternalId" | "supplierTaxId">,
  payable: Pick<PayableCandidateRow, "personId" | "personCnpj">
): boolean {
  if (order.supplierExternalId != null && payable.personId != null) {
    return order.supplierExternalId === payable.personId;
  }
  const orderDoc = digitsOnly(order.supplierTaxId);
  const payableDoc = digitsOnly(payable.personCnpj);
  return orderDoc.length >= 11 && orderDoc === payableDoc;
}

/** Empresa igual quando ambos os lados informam; desconhecido não reprova. */
export function isSameCompany(
  order: Pick<PurchaseOrderLinkIdentity, "companyId">,
  payable: Pick<PayableCandidateRow, "companyId">
): boolean {
  if (order.companyId == null || payable.companyId == null) return true;
  return order.companyId === payable.companyId;
}

/* ------------------------------------------------------------------ *
 * Camada 4 — sugestão parcela × título (nunca automática)
 * ------------------------------------------------------------------ */

export type PayableLinkSuggestion = {
  payableExternalId: number;
  installmentIndex: number | null;
  method: "INSTALLMENT_MATCH";
  /** Sempre requer confirmação humana. */
  requiresConfirmation: true;
  matchedOn: {
    supplier: boolean;
    company: boolean;
    amount: boolean;
    dueDate: boolean;
    paymentMethod: boolean;
    bankAccount: boolean;
  };
  evidence: string;
  /** Título já vinculado a outro pedido — alerta de possível dupla contagem. */
  linkedToOtherOrder: boolean;
};

export type SuggestionInput = {
  order: PurchaseOrderLinkIdentity;
  installments: readonly PlannedInstallment[];
  payables: readonly PayableCandidateRow[];
  /** externalIds já vinculados a este pedido (automático ou confirmado). */
  alreadyLinkedPayableIds?: readonly number[];
  /** externalIds vinculados a QUALQUER outro pedido. */
  linkedElsewherePayableIds?: readonly number[];
};

/**
 * Sugere pares parcela × título. Exigências mínimas e não negociáveis:
 * mesmo fornecedor, mesma empresa, título não cancelado, valor idêntico e
 * vencimento idêntico (dia civil). Sem qualquer um destes, não há sugestão.
 * Forma de pagamento e conta bancária apenas reforçam a evidência.
 */
export function buildPayableLinkSuggestions(input: SuggestionInput): PayableLinkSuggestion[] {
  const already = new Set(input.alreadyLinkedPayableIds ?? []);
  const elsewhere = new Set(input.linkedElsewherePayableIds ?? []);
  const usedPayables = new Set<number>();
  const suggestions: PayableLinkSuggestion[] = [];

  const installments = [...input.installments].sort((a, b) => a.index - b.index);
  for (const installment of installments) {
    const installmentDay = civilDayKey(installment.dueDate);
    if (installmentDay == null || installment.amount == null) continue;

    const matches = input.payables
      .filter((payable) => !already.has(payable.externalId) && !usedPayables.has(payable.externalId))
      .filter((payable) => isSameSupplier(input.order, payable))
      .filter((payable) => isSameCompany(input.order, payable))
      .filter((payable) => !normalizePayable(payable).isCancelled)
      .filter((payable) => sameMoney(payable.amountPayable, installment.amount))
      .filter((payable) => civilDayKey(payable.dueDate) === installmentDay)
      .sort((a, b) => {
        const byMethod =
          Number(b.paymentMethodId === installment.paymentMethodId) -
          Number(a.paymentMethodId === installment.paymentMethodId);
        if (byMethod !== 0) return byMethod;
        const byAccount =
          Number(b.bankAccountId === installment.bankAccountId) -
          Number(a.bankAccountId === installment.bankAccountId);
        if (byAccount !== 0) return byAccount;
        return a.externalId - b.externalId;
      });

    const best = matches[0];
    if (!best) continue;
    usedPayables.add(best.externalId);
    const samePaymentMethod =
      installment.paymentMethodId != null && best.paymentMethodId === installment.paymentMethodId;
    const sameBankAccount =
      installment.bankAccountId != null && best.bankAccountId === installment.bankAccountId;
    suggestions.push({
      payableExternalId: best.externalId,
      installmentIndex: installment.index,
      method: "INSTALLMENT_MATCH",
      requiresConfirmation: true,
      matchedOn: {
        supplier: true,
        company: true,
        amount: true,
        dueDate: true,
        paymentMethod: samePaymentMethod,
        bankAccount: sameBankAccount,
      },
      evidence: [
        `parcela ${installment.index + 1}`,
        `vencimento ${installmentDay}`,
        `valor ${installment.amount.toFixed(2)}`,
        samePaymentMethod ? "forma de pagamento igual" : null,
        sameBankAccount ? "conta bancária igual" : null,
      ]
        .filter(Boolean)
        .join(" · "),
      linkedToOtherOrder: elsewhere.has(best.externalId),
    });
  }

  return suggestions;
}

/* ------------------------------------------------------------------ *
 * Reconciliação exibida na aba Financeiro
 * ------------------------------------------------------------------ */

function normalizePayable(payable: PayableCandidateRow): NormalizedAccountsPayableTitle {
  return normalizeAccountsPayableTitle({
    externalId: payable.externalId,
    dueDate: payable.dueDate,
    paymentDate: payable.paymentDate,
    settlementDate: payable.settlementDate,
    amountPayable: payable.amountPayable ?? 0,
    amountPaid: payable.amountPaid ?? 0,
    balancePayable: payable.balancePayable ?? 0,
    paymentMethodName: payable.paymentMethodName,
    description: payable.description,
    comments: payable.comments,
    classification: payable.classification,
    nomusStatus: payable.nomusStatus,
    suspendPayment: payable.suspendPayment,
  });
}

export type LinkedPayableView = {
  payableExternalId: number;
  installmentIndex: number | null;
  method: PurchaseOrderPayableLinkMethod;
  methodLabel: string;
  confidence: PurchaseOrderPayableLinkConfidence;
  evidence: string | null;
  /** Vínculo persistido (confirmado/automático materializado) — permite desvincular. */
  linkId: string | null;
  linkedByUserName: string | null;
  linkedAt: string | null;
  sourceInvoiceNumber: string | null;
  personName: string | null;
  dueDate: string | null;
  paymentDate: string | null;
  settlementDate: string | null;
  amountPayable: number;
  amountPaid: number;
  realizedAmount: number;
  openAmount: number;
  balancePayable: number | null;
  paymentMethodName: string | null;
  status: "OPEN" | "OVERDUE" | "SETTLED" | "CANCELLED" | "SUSPENDED";
  statusLabel: string;
  isSettled: boolean;
  linkedToOtherOrder: boolean;
};

export type ReconciledInstallmentView = {
  index: number;
  dueDate: string | null;
  dueDateRaw: string | null;
  amount: number | null;
  paymentMethodId: number | null;
  bankAccountId: number | null;
  generatesAdvance: boolean | null;
  /** Títulos vinculados a esta parcela. */
  payables: LinkedPayableView[];
  /** Sugestões pendentes de confirmação para esta parcela. */
  suggestions: PayableLinkSuggestion[];
  linkedAmount: number;
  paidAmount: number;
  openAmount: number;
  status: "UNLINKED" | "LINKED" | "PARTIALLY_PAID" | "PAID";
  statusLabel: string;
};

export type PurchaseOrderPayableReconciliation = {
  orderId: string;
  orderExternalId: number;
  orderNumber: string | null;
  installments: ReconciledInstallmentView[];
  /** Títulos vinculados que não pertencem a nenhuma parcela específica. */
  unassignedPayables: LinkedPayableView[];
  suggestions: PayableLinkSuggestion[];
  totals: {
    plannedAmount: number | null;
    plannedCount: number;
    linkedCount: number;
    linkedAmount: number;
    paidAmount: number;
    openAmount: number;
    /** Parcelas planejadas ainda sem título vinculado. */
    unlinkedInstallmentCount: number;
    suggestionCount: number;
  };
  financialStatus: PurchaseOrderFinancialStatus;
  /** Todos os títulos vinculados estão baixados → o pedido está quitado. */
  fullySettled: boolean;
  warnings: string[];
};

function payableStatus(
  normalized: NormalizedAccountsPayableTitle,
  payable: PayableCandidateRow,
  now: Date
): { status: LinkedPayableView["status"]; statusLabel: string } {
  if (normalized.isCancelled) return { status: "CANCELLED", statusLabel: "Cancelado" };
  if (normalized.isSettled) return { status: "SETTLED", statusLabel: "Baixado" };
  if (payable.suspendPayment === true) return { status: "SUSPENDED", statusLabel: "Suspenso" };
  if (normalized.dueDate && normalized.dueDate.getTime() < now.getTime()) {
    return { status: "OVERDUE", statusLabel: "Vencido" };
  }
  return { status: "OPEN", statusLabel: "Em aberto" };
}

function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function buildLinkedView(input: {
  payable: PayableCandidateRow;
  method: PurchaseOrderPayableLinkMethod;
  confidence: PurchaseOrderPayableLinkConfidence;
  evidence: string | null;
  installmentIndex: number | null;
  linkId: string | null;
  linkedByUserName: string | null;
  linkedAt: Date | null;
  linkedToOtherOrder: boolean;
  now: Date;
}): LinkedPayableView {
  const normalized = normalizePayable(input.payable);
  const { status, statusLabel } = payableStatus(normalized, input.payable, input.now);
  return {
    payableExternalId: input.payable.externalId,
    installmentIndex: input.installmentIndex,
    method: input.method,
    methodLabel: PURCHASE_ORDER_PAYABLE_LINK_METHOD_LABELS[input.method],
    confidence: input.confidence,
    evidence: input.evidence,
    linkId: input.linkId,
    linkedByUserName: input.linkedByUserName,
    linkedAt: toIso(input.linkedAt),
    sourceInvoiceNumber: input.payable.sourceInvoiceNumber,
    personName: input.payable.personName,
    dueDate: toIso(input.payable.dueDate),
    paymentDate: toIso(input.payable.paymentDate),
    settlementDate: toIso(input.payable.settlementDate),
    amountPayable: normalized.amountPayable,
    amountPaid: normalized.amountPaid,
    realizedAmount: normalized.realizedAmount,
    openAmount: normalized.openAmount,
    balancePayable: input.payable.balancePayable,
    paymentMethodName: input.payable.paymentMethodName,
    status,
    statusLabel,
    isSettled: normalized.isSettled,
    linkedToOtherOrder: input.linkedToOtherOrder,
  };
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function installmentStatus(input: {
  hasPayables: boolean;
  linkedAmount: number;
  paidAmount: number;
  allSettled: boolean;
}): { status: ReconciledInstallmentView["status"]; statusLabel: string } {
  if (!input.hasPayables) return { status: "UNLINKED", statusLabel: "Sem título vinculado" };
  if (input.allSettled) return { status: "PAID", statusLabel: "Baixada" };
  if (input.paidAmount > 0) return { status: "PARTIALLY_PAID", statusLabel: "Parcialmente paga" };
  return { status: "LINKED", statusLabel: "Título vinculado" };
}

export type ReconciliationInput = {
  order: PurchaseOrderLinkIdentity;
  installments: readonly PlannedInstallment[];
  plannedInstallmentsTotal: number | null;
  payables: readonly PayableCandidateRow[];
  automatic: readonly AutomaticLinkResolution[];
  persisted: readonly PersistedPayableLinkRow[];
  /** externalIds vinculados a outros pedidos (aviso de dupla contagem). */
  linkedElsewherePayableIds?: readonly number[];
  now?: Date;
};

/**
 * Monta a visão parcela × título. Vínculos persistidos vencem os automáticos
 * (o humano pode ter corrigido a parcela); títulos automáticos sem vínculo
 * persistido aparecem como EXACT, sem exigir ação.
 */
export function buildPurchaseOrderPayableReconciliation(
  input: ReconciliationInput
): PurchaseOrderPayableReconciliation {
  const now = input.now ?? new Date();
  const payableById = new Map(input.payables.map((row) => [row.externalId, row]));
  const elsewhere = new Set(input.linkedElsewherePayableIds ?? []);
  const warnings: string[] = [];

  const linked = new Map<number, LinkedPayableView>();

  for (const auto of input.automatic) {
    const payable = payableById.get(auto.payableExternalId);
    if (!payable) continue;
    linked.set(
      auto.payableExternalId,
      buildLinkedView({
        payable,
        method: auto.method,
        confidence: "EXACT",
        evidence: auto.evidence,
        installmentIndex: null,
        linkId: null,
        linkedByUserName: null,
        linkedAt: null,
        linkedToOtherOrder: elsewhere.has(auto.payableExternalId),
        now,
      })
    );
  }

  for (const row of input.persisted) {
    const payable = payableById.get(row.payableExternalId);
    if (!payable) {
      warnings.push(
        `Título ${row.payableExternalId} vinculado manualmente não está mais no espelho de Contas a Pagar.`
      );
      continue;
    }
    const method = parsePurchaseOrderPayableLinkMethod(row.method) ?? "MANUAL";
    linked.set(
      row.payableExternalId,
      buildLinkedView({
        payable,
        method,
        confidence: isAutomaticPurchaseOrderPayableMethod(method) ? "EXACT" : "CONFIRMED",
        evidence: row.evidence,
        installmentIndex: row.installmentIndex,
        linkId: row.id,
        linkedByUserName: row.createdByUserName,
        linkedAt: row.createdAt,
        linkedToOtherOrder: elsewhere.has(row.payableExternalId),
        now,
      })
    );
  }

  const linkedViews = [...linked.values()];
  const alreadyLinkedIds = linkedViews.map((row) => row.payableExternalId);
  const suggestions = buildPayableLinkSuggestions({
    order: input.order,
    installments: input.installments,
    payables: input.payables,
    alreadyLinkedPayableIds: alreadyLinkedIds,
    linkedElsewherePayableIds: input.linkedElsewherePayableIds,
  });

  const installments: ReconciledInstallmentView[] = [...input.installments]
    .sort((a, b) => a.index - b.index)
    .map((installment) => {
      const rows = linkedViews.filter((row) => row.installmentIndex === installment.index);
      // Cancelado continua visível na parcela, mas não soma nem conta como pendência.
      const active = rows.filter((row) => row.status !== "CANCELLED");
      const linkedAmount = roundMoney(active.reduce((sum, row) => sum + row.amountPayable, 0));
      const paidAmount = roundMoney(active.reduce((sum, row) => sum + row.realizedAmount, 0));
      const openAmount = roundMoney(active.reduce((sum, row) => sum + row.openAmount, 0));
      const allSettled = active.length > 0 && active.every((row) => row.isSettled);
      const { status, statusLabel } = installmentStatus({
        hasPayables: active.length > 0,
        linkedAmount,
        paidAmount,
        allSettled,
      });
      return {
        index: installment.index,
        dueDate: toIso(installment.dueDate),
        dueDateRaw: installment.dueDateRaw,
        amount: installment.amount,
        paymentMethodId: installment.paymentMethodId,
        bankAccountId: installment.bankAccountId,
        generatesAdvance: installment.generatesAdvance,
        payables: rows,
        suggestions: suggestions.filter((row) => row.installmentIndex === installment.index),
        linkedAmount,
        paidAmount,
        openAmount,
        status,
        statusLabel,
      };
    });

  const unassignedPayables = linkedViews
    .filter((row) => row.installmentIndex == null)
    .sort((a, b) => a.payableExternalId - b.payableExternalId);

  const activeLinks = linkedViews.filter((row) => row.status !== "CANCELLED");
  const linkedAmount = roundMoney(activeLinks.reduce((sum, row) => sum + row.amountPayable, 0));
  const paidAmount = roundMoney(activeLinks.reduce((sum, row) => sum + row.realizedAmount, 0));
  const openAmount = roundMoney(activeLinks.reduce((sum, row) => sum + row.openAmount, 0));
  const fullySettled = activeLinks.length > 0 && activeLinks.every((row) => row.isSettled);

  const financialStatus = classifyPurchaseOrderFinancialStatus({
    plannedCount: input.installments.length,
    plannedAmount: input.plannedInstallmentsTotal,
    confirmedCount: activeLinks.length,
    confirmedAmount: linkedAmount,
    allSettled: fullySettled,
    anyPaid: activeLinks.some((row) => row.realizedAmount > 0),
    anyOpen: activeLinks.some((row) => row.openAmount > 0),
  });

  for (const row of linkedViews) {
    if (row.linkedToOtherOrder) {
      warnings.push(
        `Título ${row.payableExternalId} também está vinculado a outro pedido — confira para não contar o pagamento duas vezes.`
      );
    }
  }
  if (
    input.plannedInstallmentsTotal != null &&
    activeLinks.length > 0 &&
    !sameMoney(linkedAmount, input.plannedInstallmentsTotal)
  ) {
    warnings.push(
      `Total vinculado (${linkedAmount.toFixed(2)}) difere do planejado no pedido (${input.plannedInstallmentsTotal.toFixed(2)}).`
    );
  }

  return {
    orderId: input.order.id,
    orderExternalId: input.order.externalId,
    orderNumber: input.order.orderNumber,
    installments,
    unassignedPayables,
    suggestions,
    totals: {
      plannedAmount: input.plannedInstallmentsTotal,
      plannedCount: input.installments.length,
      linkedCount: activeLinks.length,
      linkedAmount,
      paidAmount,
      openAmount,
      unlinkedInstallmentCount: installments.filter((row) => row.status === "UNLINKED").length,
      suggestionCount: suggestions.length,
    },
    financialStatus,
    fullySettled,
    warnings: [...new Set(warnings)],
  };
}

/* ------------------------------------------------------------------ *
 * Validação de entrada da confirmação (boundary HTTP)
 * ------------------------------------------------------------------ */

export type ConfirmPayableLinkPayload = {
  payableExternalId: number;
  installmentIndex: number | null;
  method: PurchaseOrderPayableLinkMethod;
  reason: string | null;
};

export function parseConfirmPayableLinkPayload(
  body: Record<string, unknown>,
  options: { installmentCount: number }
): ConfirmPayableLinkPayload {
  const rawId = body.payableExternalId;
  const payableExternalId =
    typeof rawId === "number" ? rawId : Number.parseInt(String(rawId ?? "").trim(), 10);
  if (!Number.isInteger(payableExternalId) || payableExternalId <= 0) {
    throw new PurchaseOrderPayableLinkError(
      "INVALID_PAYABLE_EXTERNAL_ID",
      "Título de Contas a Pagar inválido.",
      400,
      "payableExternalId"
    );
  }

  let installmentIndex: number | null = null;
  if (body.installmentIndex != null && String(body.installmentIndex).trim() !== "") {
    const parsed =
      typeof body.installmentIndex === "number"
        ? body.installmentIndex
        : Number.parseInt(String(body.installmentIndex), 10);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed >= options.installmentCount) {
      throw new PurchaseOrderPayableLinkError(
        "INVALID_INSTALLMENT_INDEX",
        "Parcela inexistente neste pedido.",
        400,
        "installmentIndex"
      );
    }
    installmentIndex = parsed;
  }

  const method = parsePurchaseOrderPayableLinkMethod(body.method ?? "MANUAL");
  if (!method || !PURCHASE_ORDER_PAYABLE_CONFIRMABLE_METHODS.includes(method)) {
    throw new PurchaseOrderPayableLinkError(
      "INVALID_LINK_METHOD",
      "Só é possível confirmar vínculo por parcela conferida ou manual.",
      400,
      "method"
    );
  }

  // MANUAL exige justificativa; INSTALLMENT_MATCH tem a evidência da conferência.
  const reason = normalizePurchaseOrderPayableLinkReason(body.reason, method === "MANUAL");
  return { payableExternalId, installmentIndex, method, reason };
}
