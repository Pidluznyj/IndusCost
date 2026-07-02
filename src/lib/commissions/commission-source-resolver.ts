import type { Prisma } from "@prisma/client";
import { extractNomusLineExternalId } from "@/src/lib/salesOrderNomusSync.server.js";
import {
  NOMUS_NFE_SAIDA_TIPO_OPERACAO,
  NOMUS_NFE_STATUS_AUTHORIZED,
  NOMUS_NFE_STATUS_CANCELLED,
} from "@/src/lib/nomusNfeClassification.js";
import { decimalToNumber, roundMoney } from "./commission-money.js";
import type {
  CommissionLinkedNfeSource,
  CommissionOrderInstallmentForecast,
  CommissionOrderItemSource,
  CommissionOrderSourceBundle,
  CommissionOutputDocumentSource,
  CommissionReceivableSource,
  CommissionRepresentativeInfo,
  CommissionSellerInfo,
} from "./commission-types.js";

const EXIT_MOVEMENT_TYPES = new Set([
  "MANUAL_EXIT",
  "REQUISITION_EXIT",
  "PRODUCTION_EXIT",
  "LOSS",
  "SCRAP",
]);

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function toInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string") {
    const parsed = Number.parseInt(value.replace(/[^\d-]/g, ""), 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value.replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function parseDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  const br = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (br) {
    const d = new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1]));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const iso = new Date(value);
  return Number.isNaN(iso.getTime()) ? null : iso;
}

export function extractSellerFromOrder(input: {
  externalSellerId: number | null;
  responsible: string | null;
}): CommissionSellerInfo {
  return {
    nomusSellerId: input.externalSellerId,
    responsibleName: input.responsible?.trim() || null,
  };
}

export function extractRepresentativeFromNomusRaw(raw: unknown): CommissionRepresentativeInfo {
  const obj = asObject(raw);
  if (!obj) return { nomusRepresentativeId: null, name: null };

  let nomusRepresentativeId: number | null = null;
  for (const key of ["idPessoaRepresentante", "idRepresentante"] as const) {
    const id = toInt(obj[key]);
    if (id != null && id > 0) {
      nomusRepresentativeId = id;
      break;
    }
  }

  let name: string | null = null;
  for (const key of ["nomeRepresentante", "nomePessoaRepresentante"] as const) {
    const v = obj[key];
    if (typeof v === "string" && v.trim()) {
      name = v.trim();
      break;
    }
  }

  const repObj = asObject(obj.representante);
  if (repObj) {
    if (nomusRepresentativeId == null) {
      nomusRepresentativeId = toInt(repObj.id ?? repObj.idPessoa);
    }
    if (!name) {
      const rname = repObj.nome ?? repObj.nomePessoa ?? repObj.nomeRepresentante;
      if (typeof rname === "string" && rname.trim()) name = rname.trim();
    }
  }

  return { nomusRepresentativeId, name };
}

export function mapSalesOrderItemToSource(item: {
  id: string;
  productId: string;
  externalProductId: number | null;
  skuSnapshot: string;
  productNameSnapshot: string;
  quantity: Prisma.Decimal;
  negotiatedPrice: Prisma.Decimal;
  totalNetValue: Prisma.Decimal;
  notes: string | null;
  nomusRawLine?: JsonObject | null;
}): CommissionOrderItemSource {
  const raw = item.nomusRawLine ?? null;
  const quantity = decimalToNumber(item.quantity);
  const unitPrice = decimalToNumber(item.negotiatedPrice);
  const totalNet = decimalToNumber(item.totalNetValue);
  const discount = raw ? toNumber(raw.desconto ?? raw.valorDesconto) : 0;
  const surcharge = raw ? toNumber(raw.acrescimo ?? raw.valorAcrescimo) : 0;
  const computedNet = roundMoney(quantity * unitPrice - discount + surcharge);
  const itemNetAmount = totalNet > 0 ? totalNet : computedNet;

  let nomusOrderItemId: number | null = null;
  if (raw) nomusOrderItemId = extractNomusLineExternalId(raw);
  if (nomusOrderItemId == null && item.notes) {
    const m = item.notes.match(/\[nomus-line:(\d+)\]/);
    if (m) nomusOrderItemId = Number.parseInt(m[1], 10);
  }

  return {
    localItemId: item.id,
    localProductId: item.productId,
    nomusOrderItemId,
    nomusProductId: item.externalProductId,
    productCode: item.skuSnapshot,
    productName: item.productNameSnapshot,
    quantity,
    unitPrice,
    discount,
    surcharge,
    itemNetAmount,
  };
}

const INSTALLMENT_ARRAY_KEYS = [
  "parcelas",
  "condicaoPagamentoParcelas",
  "parcelasCondicaoPagamento",
  "titulosFinanceiros",
  "financeiroParcelas",
] as const;

export function extractForecastInstallmentsFromNomusRaw(
  raw: unknown,
  orderTotal: number,
  issueDate: Date
): CommissionOrderInstallmentForecast[] {
  const obj = asObject(raw);
  if (!obj) {
    return [
      {
        installmentNumber: 1,
        dueDate: issueDate,
        expectedAmount: roundMoney(orderTotal),
        paymentConditionExternalId: toInt(obj?.idCondicaoPagamento),
      },
    ];
  }

  for (const key of INSTALLMENT_ARRAY_KEYS) {
    const arr = obj[key];
    if (!Array.isArray(arr) || arr.length === 0) continue;
    const installments: CommissionOrderInstallmentForecast[] = [];
    for (let i = 0; i < arr.length; i += 1) {
      const row = asObject(arr[i]);
      if (!row) continue;
      const amount = roundMoney(
        toNumber(row.valor ?? row.valorParcela ?? row.valorReceber ?? row.amount)
      );
      if (amount <= 0) continue;
      installments.push({
        installmentNumber: toInt(row.numeroParcela ?? row.parcela ?? row.numero) ?? i + 1,
        dueDate:
          parseDate(row.dataVencimento ?? row.vencimento ?? row.dueDate) ??
          parseDate(row.data) ??
          null,
        expectedAmount: amount,
        paymentConditionExternalId: toInt(
          row.idCondicaoPagamento ?? row.idFormaPagamento ?? obj.idCondicaoPagamento
        ),
      });
    }
    if (installments.length > 0) return installments;
  }

  const total = roundMoney(orderTotal);
  return [
    {
      installmentNumber: 1,
      dueDate: issueDate,
      expectedAmount: total,
      paymentConditionExternalId: toInt(obj.idCondicaoPagamento),
    },
  ];
}

export function mapLinkedNfeSource(input: {
  nfeExternalId: number;
  nfeNumber: string | null;
  nfeStatus: number | null;
  tipoOperacao: number | null;
  dataProcessamento: Date | null;
  nfeValue: number;
  nomusNfeLocalId: string | null;
}): CommissionLinkedNfeSource {
  const isCancelled = input.nfeStatus === NOMUS_NFE_STATUS_CANCELLED;
  const isAuthorized = input.nfeStatus === NOMUS_NFE_STATUS_AUTHORIZED;
  const isOutputOperation =
    input.tipoOperacao == null || input.tipoOperacao === NOMUS_NFE_SAIDA_TIPO_OPERACAO;
  return {
    nfeExternalId: input.nfeExternalId,
    nfeNumber: input.nfeNumber,
    nfeStatus: input.nfeStatus,
    tipoOperacao: input.tipoOperacao,
    dataProcessamento: input.dataProcessamento,
    nfeValue: roundMoney(input.nfeValue),
    isAuthorized,
    isCancelled,
    isOutputOperation,
    nomusNfeLocalId: input.nomusNfeLocalId,
  };
}

export function filterAuthorizedOutputNfes(nfes: CommissionLinkedNfeSource[]): CommissionLinkedNfeSource[] {
  return nfes.filter((n) => n.isAuthorized && n.isOutputOperation && !n.isCancelled);
}

export function mapReceivableSource(row: {
  externalId: number;
  sourceInvoiceId: number | null;
  dueDate: Date | null;
  amountReceivable: Prisma.Decimal | null;
  amountReceived: Prisma.Decimal | null;
  balanceReceivable: Prisma.Decimal | null;
  settlementDate: Date | null;
}): CommissionReceivableSource {
  return {
    nomusReceivableId: row.externalId,
    nomusNfeId: row.sourceInvoiceId,
    installmentNumber: null,
    dueDate: row.dueDate,
    amountReceivable: decimalToNumber(row.amountReceivable),
    amountReceived: decimalToNumber(row.amountReceived),
    balanceReceivable: decimalToNumber(row.balanceReceivable),
    settlementDate: row.settlementDate,
  };
}

export function mapOutputDocumentSource(row: {
  id: string;
  documentNumber: string | null;
  nfeId: string | null;
  nfeNumber: string | null;
  salesOrderId: string | null;
  movementDate: Date;
  movementType: string;
}, nfeExternalId: number | null): CommissionOutputDocumentSource | null {
  if (!EXIT_MOVEMENT_TYPES.has(row.movementType)) return null;
  return {
    localMovementId: row.id,
    documentNumber: row.documentNumber,
    nfeExternalId,
    nfeNumber: row.nfeNumber,
    salesOrderLocalId: row.salesOrderId,
    movementDate: row.movementDate,
  };
}

export function indexReceivablesByNfeId(
  receivables: CommissionReceivableSource[]
): Map<number, CommissionReceivableSource[]> {
  const map = new Map<number, CommissionReceivableSource[]>();
  for (const ar of receivables) {
    if (ar.nomusNfeId == null) continue;
    const list = map.get(ar.nomusNfeId) ?? [];
    list.push(ar);
    map.set(ar.nomusNfeId, list);
  }
  for (const [key, list] of map) {
    list.sort((a, b) => {
      const da = a.dueDate?.getTime() ?? 0;
      const db = b.dueDate?.getTime() ?? 0;
      return da - db;
    });
    list.forEach((row, idx) => {
      row.installmentNumber = idx + 1;
    });
    map.set(key, list);
  }
  return map;
}

export function assembleOrderSourceBundle(input: {
  localOrderId: string;
  nomusOrderId: number | null;
  orderCode: string;
  issueDate: Date;
  status: string;
  paymentTerms: string | null;
  paymentMethod: string | null;
  companyExternalId: number | null;
  externalCustomerId: number | null;
  customerName: string | null;
  externalSellerId: number | null;
  responsible: string | null;
  totalNetValue: number;
  nomusRawResponse: unknown;
  items: CommissionOrderItemSource[];
  linkedNfes: CommissionLinkedNfeSource[];
  outputDocumentsByNfeId: Map<number, CommissionOutputDocumentSource[]>;
  receivablesByNfeId: Map<number, CommissionReceivableSource[]>;
}): CommissionOrderSourceBundle {
  const seller = extractSellerFromOrder({
    externalSellerId: input.externalSellerId,
    responsible: input.responsible,
  });
  const representative = extractRepresentativeFromNomusRaw(input.nomusRawResponse);
  const authorizedOutputNfes = filterAuthorizedOutputNfes(input.linkedNfes);
  return {
    localOrderId: input.localOrderId,
    nomusOrderId: input.nomusOrderId,
    orderCode: input.orderCode,
    issueDate: input.issueDate,
    status: input.status,
    paymentTerms: input.paymentTerms,
    paymentMethod: input.paymentMethod,
    companyExternalId: input.companyExternalId,
    customerExternalId: input.externalCustomerId,
    customerName: input.customerName,
    seller,
    representative,
    items: input.items,
    forecastInstallments: extractForecastInstallmentsFromNomusRaw(
      input.nomusRawResponse,
      input.totalNetValue,
      input.issueDate
    ),
    linkedNfes: input.linkedNfes,
    authorizedOutputNfes,
    outputDocumentsByNfeId: input.outputDocumentsByNfeId,
    receivablesByNfeId: input.receivablesByNfeId,
  };
}
