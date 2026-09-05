/**
 * Funções puras do Pedido de Compra 360º.
 * Sem Prisma/Express. Não inventa vínculo fiscal/financeiro.
 */

import { normalizeAccountsPayableTitle } from "@/src/lib/financeAccountsPayableRules.js";
import { normalizeSupplierDocument, normalizeSupplierName } from "@/src/lib/financeSupplierIdentity.js";
import {
  mapNomusPurchaseOrderItemStatus,
  NOMUS_PURCHASE_ORDER_ITEM_STATUS_BY_CODE,
} from "./nomusPurchaseOrderClassifier.js";
import {
  asBoolean,
  asString,
  parseNomusBrDate,
  parseNomusOptionalMoney,
  pickFirstInt,
  pickFirstMoney,
  pickFirstString,
  toInt,
} from "./nomusPurchaseOrderParser.js";
import type { JsonObject } from "./nomusPurchaseOrderTypes.js";

export type PurchaseOrderRelationMethod =
  | "DIRECT_NOMUS_NFE"
  | "EXPLICIT_DOCUMENT_ENTRY_LINK"
  | "NFE_TO_AP"
  | "SUPPLIER_ALIAS"
  | "SUPPLIER_DOCUMENT"
  | "SUPPLIER_AP_IDENTITY"
  | "NAME_FALLBACK"
  | "UNRESOLVED";

export type PurchaseOrderRelationConfidence = "EXACT" | "HIGH" | "FALLBACK" | "UNRESOLVED";

export type PurchaseOrderFinancialStatus =
  | "PLANNED_ONLY"
  | "PARTIALLY_CONFIRMED"
  | "CONFIRMED"
  | "PARTIALLY_PAID"
  | "PAID"
  | "NO_FINANCIAL_DATA";

export type PlannedInstallment = {
  index: number;
  dueDate: Date | null;
  dueDateRaw: string | null;
  amount: number | null;
  paymentMethodId: number | null;
  bankAccountId: number | null;
  generatesAdvance: boolean | null;
};

export type DirectNfeRef = {
  externalId: number;
  number: string | null;
  series: string | null;
  key: string | null;
};

export type ResolvedPurchaseOrderSupplier = {
  nomusExternalId: number | null;
  nomusName: string | null;
  nomusDocument: string | null;
  resolvedName: string | null;
  resolvedDocument: string | null;
  financialSupplierId: string | null;
  matchMethod: PurchaseOrderRelationMethod;
  matchConfidence: PurchaseOrderRelationConfidence;
  matched: boolean;
  ambiguous: boolean;
  source: string;
};

export type SupplierResolutionInput = {
  supplierExternalId: number | null;
  supplierName: string | null;
  supplierTaxId: string | null;
  aliases: Array<{
    externalSupplierId: number | null;
    financialSupplierId: string;
    displayName: string | null;
    document: string | null;
    normalizedDocument: string | null;
    normalizedName: string | null;
  }>;
  documents: Array<{
    financialSupplierId: string;
    displayName: string | null;
    document: string | null;
    normalizedDocument: string | null;
  }>;
  apIdentities: Array<{
    personId: number | null;
    personName: string | null;
    personCnpj: string | null;
  }>;
  nameCandidates: Array<{
    financialSupplierId: string;
    displayName: string | null;
    normalizedName: string | null;
  }>;
};

export const TRANSPORT_MODALITY_LABELS: Record<number, string> = {
  0: "CIF / remetente",
  1: "FOB / destinatário",
  2: "Terceiros",
  3: "Transporte próprio remetente",
  4: "Transporte próprio destinatário",
  9: "Sem transporte",
};

export function transportModalityLabel(value: unknown): string | null {
  const code = toInt(value);
  if (code == null) return null;
  return TRANSPORT_MODALITY_LABELS[code] ?? `Modalidade ${code}`;
}

export function parsePurchaseOrderPlannedInstallments(raw: unknown): PlannedInstallment[] {
  if (!raw || typeof raw !== "object") return [];
  const parcelas = (raw as JsonObject).parcelas;
  if (!Array.isArray(parcelas)) return [];
  return parcelas
    .filter((item): item is JsonObject => !!item && typeof item === "object" && !Array.isArray(item))
    .map((item, index) => ({
      index,
      dueDate: parseNomusBrDate(item.dataVencimento),
      dueDateRaw: asString(item.dataVencimento),
      amount: parseNomusOptionalMoney(item.valorParcela),
      paymentMethodId: toInt(item.idFormaPagamento),
      bankAccountId: toInt(item.idContaBancaria),
      generatesAdvance: asBoolean(item.geraAdiantamento),
    }));
}

export function sumPlannedInstallmentsTotal(installments: PlannedInstallment[]): number | null {
  let total = 0;
  let seen = false;
  for (const row of installments) {
    if (row.amount == null || !Number.isFinite(row.amount)) continue;
    total += row.amount;
    seen = true;
  }
  return seen ? Math.round(total * 100) / 100 : null;
}

export function extractDirectNomusNfeRefs(raw: unknown): DirectNfeRef[] {
  if (!raw || typeof raw !== "object") return [];
  const nfes = (raw as JsonObject).nfes;
  if (!Array.isArray(nfes) || nfes.length === 0) return [];
  const out: DirectNfeRef[] = [];
  for (const entry of nfes) {
    if (typeof entry === "number" || typeof entry === "string") {
      const id = toInt(entry);
      if (id != null) out.push({ externalId: id, number: null, series: null, key: null });
      continue;
    }
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const obj = entry as JsonObject;
    const id = pickFirstInt(obj, ["id", "idNfe", "externalId"]);
    if (id == null) continue;
    out.push({
      externalId: id,
      number: pickFirstString(obj, ["numero", "numeroNfe", "nNF"]),
      series: pickFirstString(obj, ["serie", "serieNfe"]),
      key: pickFirstString(obj, ["chave", "chaveAcesso"]),
    });
  }
  const seen = new Set<number>();
  return out.filter((row) => {
    if (seen.has(row.externalId)) return false;
    seen.add(row.externalId);
    return true;
  });
}

export function extractDocumentEntryPurchaseOrderId(raw: unknown): number | null {
  if (!raw || typeof raw !== "object") return null;
  return pickFirstInt(raw as JsonObject, ["idPedidoCompra", "idPedido", "pedidoCompraId"]);
}

export function extractPurchaseOrderHeaderFields(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const obj = raw as JsonObject;
  return {
    nomusId: toInt(obj.id),
    orderNumber: pickFirstString(obj, ["codigoPedido", "numero", "numeroPedido"]),
    companyId: toInt(obj.idEmpresa),
    purchaseOrderTypeId: toInt(obj.idTipoPedidoCompra),
    buyerPersonId: toInt(obj.idPessoaComprador),
    contactId: toInt(obj.idContato),
    supplierPersonId: toInt(obj.idPessoaFornecedor),
    carrierPersonId: toInt(obj.idPessoaTransportadora),
    entrySectorId: toInt(obj.idSetorEntrada),
    movementTypeId: toInt(obj.idTipoMovimentacao),
    paymentConditionId: toInt(obj.idCondicaoPagamento),
    paymentConditionText: pickFirstString(obj, ["condicaoPagamentoTexto", "condicaoPagamento"]),
    paymentMethodId: toInt(obj.idFormaPagamento),
    transportModality: toInt(obj.modalidadeTransporte),
    transportModalityLabel: transportModalityLabel(obj.modalidadeTransporte),
    issuedAt: pickFirstString(obj, ["dataEmissao"]),
    expectedAt: pickFirstString(obj, ["dataEntregaPadrao", "dataEntrega"]),
    freightAmount: pickFirstMoney(obj, ["valorTotalFrete", "valorFrete"]),
    insuranceAmount: pickFirstMoney(obj, ["valorTotalSeguro"]),
    otherExpensesAmount: pickFirstMoney(obj, ["valorTotalOutrasDespesasAcessorias"]),
    comments: pickFirstString(obj, ["observacoes"]),
    additionalFiscalInfo: pickFirstString(obj, ["infAdFisco"]),
    complementaryInfo: pickFirstString(obj, ["infCpl"]),
  };
}

export function extractPurchaseOrderItemFields(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const obj = raw as JsonObject;
  const status = mapNomusPurchaseOrderItemStatus(obj.status);
  return {
    lineCode: asString(obj.item),
    productExternalId: toInt(obj.idProduto),
    orderedQuantity: parseNomusOptionalMoney(obj.quantidade),
    unitPrice: parseNomusOptionalMoney(obj.valorUnitario),
    unitId: toInt(obj.idUnidadeMedida),
    entrySectorId: toInt(obj.idSetorEntrada),
    financialClassificationId: toInt(obj.idClassificacaoFinanceira),
    movementTypeId: toInt(obj.idTipoMovimentacao),
    discountPercent: parseNomusOptionalMoney(obj.percentualDesconto),
    discountAmount: parseNomusOptionalMoney(obj.valorDesconto),
    surchargePercent: parseNomusOptionalMoney(obj.percentualAcrescimo),
    surchargeAmount: parseNomusOptionalMoney(obj.valorAcrescimo),
    deliveryDate: asString(obj.dataEntrega),
    comments: asString(obj.observacoes),
    itemStatusCode: status.code,
    itemStatusKey: status.key,
    itemStatusLabel: status.label,
  };
}

export function resolvePurchaseOrderSupplier(
  input: SupplierResolutionInput
): ResolvedPurchaseOrderSupplier {
  const unresolved = (): ResolvedPurchaseOrderSupplier => ({
    nomusExternalId: input.supplierExternalId,
    nomusName: input.supplierName,
    nomusDocument: input.supplierTaxId,
    resolvedName: input.supplierName,
    resolvedDocument: input.supplierTaxId,
    financialSupplierId: null,
    matchMethod: "UNRESOLVED",
    matchConfidence: "UNRESOLVED",
    matched: false,
    ambiguous: false,
    source: "pedido",
  });

  const exactAliases = input.aliases.filter(
    (row) =>
      input.supplierExternalId != null && row.externalSupplierId === input.supplierExternalId
  );
  if (exactAliases.length === 1) {
    const alias = exactAliases[0];
    return {
      nomusExternalId: input.supplierExternalId,
      nomusName: input.supplierName ?? alias.displayName,
      nomusDocument: input.supplierTaxId ?? alias.document,
      resolvedName: alias.displayName ?? input.supplierName,
      resolvedDocument: alias.document ?? input.supplierTaxId,
      financialSupplierId: alias.financialSupplierId,
      matchMethod: "SUPPLIER_ALIAS",
      matchConfidence: "EXACT",
      matched: true,
      ambiguous: false,
      source: "FinancialSupplierAlias.externalSupplierId",
    };
  }
  if (exactAliases.length > 1) {
    return { ...unresolved(), ambiguous: true, source: "FinancialSupplierAlias.externalSupplierId" };
  }

  const normalizedDoc = normalizeSupplierDocument(input.supplierTaxId);
  if (normalizedDoc) {
    const docs = input.documents.filter((row) => row.normalizedDocument === normalizedDoc);
    if (docs.length === 1) {
      const doc = docs[0];
      return {
        nomusExternalId: input.supplierExternalId,
        nomusName: input.supplierName,
        nomusDocument: input.supplierTaxId ?? doc.document,
        resolvedName: doc.displayName ?? input.supplierName,
        resolvedDocument: doc.document ?? input.supplierTaxId,
        financialSupplierId: doc.financialSupplierId,
        matchMethod: "SUPPLIER_DOCUMENT",
        matchConfidence: "EXACT",
        matched: true,
        ambiguous: false,
        source: "FinancialSupplier.normalizedDocument",
      };
    }
    if (docs.length > 1) {
      return { ...unresolved(), ambiguous: true, source: "FinancialSupplier.normalizedDocument" };
    }
  }

  const apHits = input.apIdentities.filter(
    (row) => input.supplierExternalId != null && row.personId === input.supplierExternalId
  );
  if (apHits.length > 0) {
    const name = apHits.find((row) => row.personName)?.personName ?? input.supplierName;
    const document = apHits.find((row) => row.personCnpj)?.personCnpj ?? input.supplierTaxId;
    return {
      nomusExternalId: input.supplierExternalId,
      nomusName: name,
      nomusDocument: document,
      resolvedName: name,
      resolvedDocument: document,
      financialSupplierId: null,
      matchMethod: "SUPPLIER_AP_IDENTITY",
      matchConfidence: "HIGH",
      matched: true,
      ambiguous: false,
      source: "NomusAccountsPayable.personId",
    };
  }

  const normalizedName = normalizeSupplierName(input.supplierName);
  if (normalizedName) {
    const names = input.nameCandidates.filter((row) => row.normalizedName === normalizedName);
    if (names.length === 1) {
      const name = names[0];
      return {
        nomusExternalId: input.supplierExternalId,
        nomusName: input.supplierName,
        nomusDocument: input.supplierTaxId,
        resolvedName: name.displayName ?? input.supplierName,
        resolvedDocument: input.supplierTaxId,
        financialSupplierId: name.financialSupplierId,
        matchMethod: "NAME_FALLBACK",
        matchConfidence: "FALLBACK",
        matched: true,
        ambiguous: false,
        source: "FinancialSupplier.normalizedName",
      };
    }
    if (names.length > 1) {
      return { ...unresolved(), ambiguous: true, source: "FinancialSupplier.normalizedName" };
    }
  }

  return unresolved();
}

export type ConfirmedPayableSnapshot = {
  externalId: number;
  sourceInvoiceId: number | null;
  sourceInvoiceNumber: string | null;
  personId: number | null;
  personName: string | null;
  personCnpj: string | null;
  dueDate: Date | null;
  paymentDate: Date | null;
  settlementDate: Date | null;
  amountPayable: number | null;
  amountPaid: number | null;
  balancePayable: number | null;
  paymentMethodName: string | null;
  description: string | null;
  comments: string | null;
  classification: string | null;
  nomusStatus: boolean | null;
  suspendPayment: boolean | null;
};

export function summarizeConfirmedPayables(rows: ConfirmedPayableSnapshot[]): {
  count: number;
  confirmedAmount: number;
  paidAmount: number;
  openAmount: number;
  allSettled: boolean;
  anyPaid: boolean;
  anyOpen: boolean;
  hasBoletoDocument: false;
} {
  let confirmedAmount = 0;
  let paidAmount = 0;
  let openAmount = 0;
  let allSettled = rows.length > 0;
  let anyPaid = false;
  let anyOpen = false;
  for (const row of rows) {
    const normalized = normalizeAccountsPayableTitle({
      externalId: row.externalId,
      dueDate: row.dueDate,
      paymentDate: row.paymentDate,
      settlementDate: row.settlementDate,
      amountPayable: row.amountPayable ?? 0,
      amountPaid: row.amountPaid ?? 0,
      balancePayable: row.balancePayable ?? 0,
      paymentMethodName: row.paymentMethodName,
      description: row.description,
      comments: row.comments,
      classification: row.classification,
      nomusStatus: row.nomusStatus,
      suspendPayment: row.suspendPayment,
    });
    confirmedAmount += normalized.amountPayable;
    paidAmount += normalized.realizedAmount;
    openAmount += normalized.openAmount;
    if (!normalized.isSettled) allSettled = false;
    if (normalized.realizedAmount > 0) anyPaid = true;
    if (normalized.isOpen) anyOpen = true;
  }
  return {
    count: rows.length,
    confirmedAmount: Math.round(confirmedAmount * 100) / 100,
    paidAmount: Math.round(paidAmount * 100) / 100,
    openAmount: Math.round(openAmount * 100) / 100,
    allSettled,
    anyPaid,
    anyOpen,
    hasBoletoDocument: false,
  };
}

export function classifyPurchaseOrderFinancialStatus(input: {
  plannedCount: number;
  plannedAmount?: number | null;
  confirmedCount: number;
  confirmedAmount?: number | null;
  allSettled: boolean;
  anyPaid: boolean;
  anyOpen: boolean;
}): PurchaseOrderFinancialStatus {
  if (input.confirmedCount === 0) {
    return input.plannedCount > 0 ? "PLANNED_ONLY" : "NO_FINANCIAL_DATA";
  }
  if (input.allSettled) return "PAID";
  if (input.anyPaid && input.anyOpen) return "PARTIALLY_PAID";
  const plannedAmount = input.plannedAmount ?? null;
  const confirmedAmount = input.confirmedAmount ?? null;
  if (
    input.plannedCount > 0 &&
    plannedAmount != null &&
    confirmedAmount != null &&
    confirmedAmount + 0.005 < plannedAmount
  ) {
    return "PARTIALLY_CONFIRMED";
  }
  return "CONFIRMED";
}

export function isBoletoPaymentMethod(name: string | null | undefined): boolean {
  return /boleto/i.test(name ?? "");
}

export function purchaseOrderFinancialStatusLabel(status: PurchaseOrderFinancialStatus): string {
  switch (status) {
    case "PLANNED_ONLY":
      return "Planejado";
    case "PARTIALLY_CONFIRMED":
      return "Parcialmente confirmado";
    case "CONFIRMED":
      return "Confirmado";
    case "PARTIALLY_PAID":
      return "Parcial pago";
    case "PAID":
      return "Pago";
    default:
      return "Sem vínculo";
  }
}

export function formatSupplierDisplayName(input: {
  resolvedName: string | null;
  nomusName: string | null;
  supplierExternalId: number | null;
}): string {
  return (
    input.resolvedName?.trim() ||
    input.nomusName?.trim() ||
    (input.supplierExternalId != null ? `Fornecedor Nomus #${input.supplierExternalId}` : "Fornecedor não identificado")
  );
}

export type LinkedNomusNfeSnapshot = {
  externalId: number;
  number: string | null;
  series: string | null;
  key: string | null;
  issuedAt: Date | null;
  processedAt: Date | null;
  issuerDocument: string | null;
  status: number | null;
  operationType: number | null;
  amount: number | null;
  canceled: boolean;
  foundLocally: boolean;
  relationMethod: "DIRECT_NOMUS_NFE";
  confidence: "EXACT";
};

export type PurchaseOrderRelationEvidence = {
  method: PurchaseOrderRelationMethod;
  confidence: PurchaseOrderRelationConfidence;
  source: string;
  detail: string;
};

export type PurchaseOrderFinancialBundle = {
  plannedInstallments: PlannedInstallment[];
  plannedInstallmentsTotal: number | null;
  plannedInstallmentsCount: number;
  invoices: LinkedNomusNfeSnapshot[];
  confirmedPayables: ConfirmedPayableSnapshot[];
  payableSummary: ReturnType<typeof summarizeConfirmedPayables>;
  financialStatus: PurchaseOrderFinancialStatus;
  relationEvidence: PurchaseOrderRelationEvidence[];
};

export function buildPurchaseOrderFinancialBundle(input: {
  rawPayload: unknown;
  invoices: LinkedNomusNfeSnapshot[];
  confirmedPayables: ConfirmedPayableSnapshot[];
}): PurchaseOrderFinancialBundle {
  const plannedInstallments = parsePurchaseOrderPlannedInstallments(input.rawPayload);
  const plannedInstallmentsTotal = sumPlannedInstallmentsTotal(plannedInstallments);
  const payableSummary = summarizeConfirmedPayables(input.confirmedPayables);
  const financialStatus = classifyPurchaseOrderFinancialStatus({
    plannedCount: plannedInstallments.length,
    plannedAmount: plannedInstallmentsTotal,
    confirmedCount: payableSummary.count,
    confirmedAmount: payableSummary.confirmedAmount,
    allSettled: payableSummary.allSettled,
    anyPaid: payableSummary.anyPaid,
    anyOpen: payableSummary.anyOpen,
  });
  const relationEvidence: PurchaseOrderRelationEvidence[] = [];
  if (input.invoices.length > 0) {
    relationEvidence.push({
      method: "DIRECT_NOMUS_NFE",
      confidence: "EXACT",
      source: "rawPayload.nfes",
      detail: `${input.invoices.length} NF-e com ID Nomus explícito`,
    });
  } else {
    relationEvidence.push({
      method: "UNRESOLVED",
      confidence: "UNRESOLVED",
      source: "rawPayload.nfes",
      detail: "Nenhuma NF-e vinculada foi identificada pelos dados disponíveis.",
    });
  }
  if (input.confirmedPayables.length > 0) {
    relationEvidence.push({
      method: "NFE_TO_AP",
      confidence: "EXACT",
      source: "NomusAccountsPayable.sourceInvoiceId",
      detail: `${input.confirmedPayables.length} título(s) com sourceInvoiceId da NF vinculada`,
    });
  }
  return {
    plannedInstallments,
    plannedInstallmentsTotal,
    plannedInstallmentsCount: plannedInstallments.length,
    invoices: input.invoices,
    confirmedPayables: input.confirmedPayables,
    payableSummary,
    financialStatus,
    relationEvidence,
  };
}

export function lastInvoiceNumberFromLinks(invoices: LinkedNomusNfeSnapshot[]): string | null {
  for (let i = invoices.length - 1; i >= 0; i -= 1) {
    const number = invoices[i]?.number?.trim();
    if (number) return number;
  }
  return null;
}

export function matchesPurchaseOrderFiscalFilter(
  invoiceCount: number,
  filter: "WITH_NFE" | "WITHOUT_NFE" | null | undefined
): boolean {
  if (!filter) return true;
  return filter === "WITH_NFE" ? invoiceCount > 0 : invoiceCount === 0;
}

export type NomusPurchaseOrderListRowDto = {
  id: string;
  externalId: number;
  orderNumber: string | null;
  supplierExternalId: number | null;
  supplierName: string | null;
  supplierTaxId: string | null;
  supplierResolvedName: string | null;
  supplierMatched: boolean;
  supplierMatchMethod: PurchaseOrderRelationMethod;
  buyerPersonId: number | null;
  statusRaw: string | null;
  canceled: boolean | null;
  stage: string;
  issuedAt: string | null;
  expectedAt: string | null;
  itemCount: number;
  plannedInstallmentsTotal: number | null;
  plannedInstallmentsCount: number;
  invoiceCount: number;
  lastInvoiceNumber: string | null;
  financialStatus: PurchaseOrderFinancialStatus;
  payableCount: number;
  confirmedAmount: number;
  paidAmount: number;
  openAmount: number;
  overdue: boolean;
  open: boolean;
  syncedAt: string;
};

export function matchesPurchaseOrderFinancialFilter(
  status: PurchaseOrderFinancialStatus,
  filter: PurchaseOrderFinancialStatus | null | undefined
): boolean {
  if (!filter) return true;
  return status === filter;
}

export function summarizeItemStatuses(codes: Array<number | null | undefined>): Record<string, number> {
  const counts: Record<string, number> = {
    waitingRelease: 0,
    released: 0,
    partial: 0,
    received: 0,
    receivedWithCut: 0,
    canceled: 0,
    returnedPartial: 0,
    returnedFull: 0,
    unknown: 0,
  };
  for (const code of codes) {
    switch (code) {
      case 1:
        counts.waitingRelease += 1;
        break;
      case 2:
        counts.released += 1;
        break;
      case 3:
        counts.partial += 1;
        break;
      case 4:
        counts.received += 1;
        break;
      case 5:
        counts.receivedWithCut += 1;
        break;
      case 6:
        counts.canceled += 1;
        break;
      case 7:
        counts.returnedPartial += 1;
        break;
      case 8:
        counts.returnedFull += 1;
        break;
      default:
        counts.unknown += 1;
    }
  }
  return counts;
}

export { NOMUS_PURCHASE_ORDER_ITEM_STATUS_BY_CODE };
