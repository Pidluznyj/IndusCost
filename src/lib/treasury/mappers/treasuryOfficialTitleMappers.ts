/**
 * Mappers puros: rows Nomus AR/AP → Official*View (sem Prisma client).
 */

import { toCivilDateKey } from "@/src/lib/financeCivilDate.js";
import { formatTreasuryTimestampIso } from "../contracts/treasuryTimestamp.js";
import type {
  OfficialPayableView,
  OfficialReceivableView,
  OfficialTitleSourcePresenceStatus,
} from "../contracts/treasuryOfficialTitleContracts.js";
import { normalizeTreasuryMoneyString } from "../treasuryMoney.js";

export type OfficialTitleMoneyLike =
  | { toFixed(digits: number): string }
  | string
  | number
  | null
  | undefined;

export type OfficialNomusReceivableRow = {
  id: string;
  externalId: number;
  status: boolean | null;
  personId: number | null;
  personName: string | null;
  personCnpj: string | null;
  description: string | null;
  competenceDate: Date | null;
  dueDate: Date | null;
  amountReceivable: OfficialTitleMoneyLike;
  balanceReceivable: OfficialTitleMoneyLike;
  amountReceived: OfficialTitleMoneyLike;
  settlementDate: Date | null;
  bankAccountId?: number | null;
  sourceInvoiceId: number | null;
  sourceInvoiceNumber: string | null;
  sourcePresenceStatus: string;
  sourceRemovedAt: Date | null;
  syncedAt: Date;
  rawPayload?: unknown;
};

export type OfficialNomusPayableRow = {
  id: string;
  externalId: number;
  status: boolean | null;
  personId: number | null;
  personName: string | null;
  personCnpj: string | null;
  description: string | null;
  documentNumber: string | null;
  classification?: string | null;
  comments?: string | null;
  competenceDate: Date | null;
  dueDate: Date | null;
  scheduleDate?: Date | null;
  amountPayable: OfficialTitleMoneyLike;
  balancePayable: OfficialTitleMoneyLike;
  amountPaid: OfficialTitleMoneyLike;
  amountScheduled?: OfficialTitleMoneyLike;
  settlementDate: Date | null;
  paymentDate: Date | null;
  bankAccountId?: number | null;
  sourceInvoiceId: number | null;
  sourceInvoiceNumber: string | null;
  sourcePresenceStatus: string;
  sourceRemovedAt: Date | null;
  syncedAt: Date;
  rawPayload?: unknown;
};

function moneyOrNull(value: OfficialTitleMoneyLike): string | null {
  if (value == null || value === "") return null;
  try {
    if (typeof value === "string") return normalizeTreasuryMoneyString(value);
    if (typeof value === "number") {
      return normalizeTreasuryMoneyString(value.toFixed(2));
    }
    return normalizeTreasuryMoneyString(value.toFixed(2));
  } catch {
    return null;
  }
}

function moneyNumber(value: OfficialTitleMoneyLike): number {
  const m = moneyOrNull(value);
  if (m == null) return 0;
  return Number(m);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function toInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim()) {
    const n = Number(value.trim());
    return Number.isFinite(n) ? Math.trunc(n) : null;
  }
  return null;
}

function toString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t.length ? t : null;
}

/**
 * Parcela não existe como coluna tipada no stage Nomus.
 * Melhor esforço: rawPayload + heurística na descrição.
 */
export function extractInstallmentFromNomusRaw(raw: unknown, description: string | null): {
  installmentNumber: number | null;
  installmentLabel: string | null;
} {
  const obj = asRecord(raw);
  if (obj) {
    const n = toInt(
      obj.numeroParcela ??
        obj.parcela ??
        obj.nroParcela ??
        obj.installmentNumber ??
        obj.numeroDaParcela
    );
    if (n != null) {
      return {
        installmentNumber: n,
        installmentLabel: toString(obj.descricaoParcela) ?? `Parcela ${n}`,
      };
    }
  }
  if (description) {
    const m = /parcela\s*[:#-]?\s*(\d+)/i.exec(description);
    if (m) {
      const n = Number(m[1]);
      return { installmentNumber: n, installmentLabel: `Parcela ${n}` };
    }
  }
  return { installmentNumber: null, installmentLabel: null };
}

export function extractSalesOrderFromNomusRaw(raw: unknown): {
  salesOrderExternalId: number | null;
  salesOrderCode: string | null;
} {
  const obj = asRecord(raw);
  if (!obj) {
    return { salesOrderExternalId: null, salesOrderCode: null };
  }
  return {
    salesOrderExternalId: toInt(
      obj.idPedido ??
        obj.idPedidoVenda ??
        obj.pedidoId ??
        obj.salesOrderId ??
        obj.externalSalesOrderId
    ),
    salesOrderCode: toString(
      obj.numeroPedido ??
        obj.codigoPedido ??
        obj.pedido ??
        obj.salesOrderCode ??
        obj.orderCode
    ),
  };
}

/** Vendedor / responsável comercial — sem coluna tipada no stage AR. */
export function extractSellerFieldsFromNomusRaw(raw: unknown): {
  sellerName: string | null;
  commercialOwnerName: string | null;
} {
  const obj = asRecord(raw);
  if (!obj) {
    return { sellerName: null, commercialOwnerName: null };
  }
  return {
    sellerName: toString(
      obj.nomeVendedor ??
        obj.vendedor ??
        obj.sellerName ??
        obj.nomeVendedorResponsavel
    ),
    commercialOwnerName: toString(
      obj.responsavelComercial ??
        obj.nomeResponsavelComercial ??
        obj.commercialOwnerName ??
        obj.responsavel
    ),
  };
}

function deriveCancellation(
  sourcePresenceStatus: string,
  sourceRemovedAt: Date | null
): OfficialReceivableView["cancellation"] {
  const removed =
    sourcePresenceStatus === "MISSING_CONFIRMED" || sourceRemovedAt != null;
  return {
    isCancelledOrRemovedFromSource: removed,
    sourcePresenceStatus: sourcePresenceStatus as OfficialTitleSourcePresenceStatus,
    sourceRemovedAt: sourceRemovedAt
      ? formatTreasuryTimestampIso(sourceRemovedAt)
      : null,
  };
}

function deriveOfficialStatus(input: {
  status: boolean | null;
  openBalance: OfficialTitleMoneyLike;
  settledAmount: OfficialTitleMoneyLike;
  settlementDate: Date | null;
  sourcePresenceStatus: string;
}): OfficialReceivableView["officialStatus"] {
  const open = moneyNumber(input.openBalance);
  const settledAmt = moneyNumber(input.settledAmount);
  const isOpen = open > 0;
  const isSettled =
    open <= 0 ||
    input.status === true ||
    (settledAmt > 0 && input.settlementDate != null && open <= 0);
  return {
    nomusStatus: input.status,
    isOpen,
    isSettled,
    sourcePresenceStatus:
      input.sourcePresenceStatus as OfficialTitleSourcePresenceStatus,
  };
}

export function toOfficialReceivableView(
  row: OfficialNomusReceivableRow
): OfficialReceivableView {
  const installment = extractInstallmentFromNomusRaw(
    row.rawPayload,
    row.description
  );
  const order = extractSalesOrderFromNomusRaw(row.rawPayload);
  const openBalance = moneyOrNull(row.balanceReceivable);
  const settledAmount = moneyOrNull(row.amountReceived);

  return {
    id: row.id,
    externalId: row.externalId,
    installmentNumber: installment.installmentNumber,
    installmentLabel: installment.installmentLabel,
    counterparty: {
      personId: row.personId,
      name: row.personName,
      taxId: row.personCnpj,
      role: "CUSTOMER",
    },
    description: row.description,
    documentNumber: null,
    salesOrderExternalId: order.salesOrderExternalId,
    salesOrderCode: order.salesOrderCode,
    invoice: {
      externalId: row.sourceInvoiceId,
      number: row.sourceInvoiceNumber,
    },
    issuedOn: toCivilDateKey(row.competenceDate),
    dueDate: toCivilDateKey(row.dueDate),
    originalAmount: moneyOrNull(row.amountReceivable),
    openBalance,
    settlements: {
      settledAmount,
      settledAt: toCivilDateKey(row.settlementDate),
      paidAt: null,
    },
    cancellation: deriveCancellation(
      row.sourcePresenceStatus,
      row.sourceRemovedAt
    ),
    officialStatus: deriveOfficialStatus({
      status: row.status,
      openBalance: row.balanceReceivable,
      settledAmount: row.amountReceived,
      settlementDate: row.settlementDate,
      sourcePresenceStatus: row.sourcePresenceStatus,
    }),
    lastSyncedAt: formatTreasuryTimestampIso(row.syncedAt),
  };
}

export function toOfficialPayableView(
  row: OfficialNomusPayableRow
): OfficialPayableView {
  const installment = extractInstallmentFromNomusRaw(
    row.rawPayload,
    row.description
  );
  const order = extractSalesOrderFromNomusRaw(row.rawPayload);

  return {
    id: row.id,
    externalId: row.externalId,
    installmentNumber: installment.installmentNumber,
    installmentLabel: installment.installmentLabel,
    counterparty: {
      personId: row.personId,
      name: row.personName,
      taxId: row.personCnpj,
      role: "SUPPLIER",
    },
    description: row.description,
    documentNumber: row.documentNumber,
    classification: row.classification ?? null,
    comments: row.comments ?? null,
    nomusScheduleDate: toCivilDateKey(row.scheduleDate ?? null),
    nomusScheduledAmount: moneyOrNull(row.amountScheduled ?? null),
    salesOrderExternalId: order.salesOrderExternalId,
    salesOrderCode: order.salesOrderCode,
    invoice: {
      externalId: row.sourceInvoiceId,
      number: row.sourceInvoiceNumber,
    },
    issuedOn: toCivilDateKey(row.competenceDate),
    dueDate: toCivilDateKey(row.dueDate),
    originalAmount: moneyOrNull(row.amountPayable),
    openBalance: moneyOrNull(row.balancePayable),
    settlements: {
      settledAmount: moneyOrNull(row.amountPaid),
      settledAt: toCivilDateKey(row.settlementDate),
      paidAt: toCivilDateKey(row.paymentDate),
    },
    cancellation: deriveCancellation(
      row.sourcePresenceStatus,
      row.sourceRemovedAt
    ),
    officialStatus: deriveOfficialStatus({
      status: row.status,
      openBalance: row.balancePayable,
      settledAmount: row.amountPaid,
      settlementDate: row.settlementDate,
      sourcePresenceStatus: row.sourcePresenceStatus,
    }),
    lastSyncedAt: formatTreasuryTimestampIso(row.syncedAt),
  };
}
