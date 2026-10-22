/**
 * Auditoria R1 — sobrealocação de comissão em PV com mais de uma NF-e (regras puras).
 *
 * Defeito do motor (documentado em docs/commissions/commission-360-view.md §7.1): cada
 * snapshot por NF-e grava a comissão INTEIRA do pedido e o scheduler a rateia só nos CRs
 * dessa NF-e. Este módulo MEDE a exposição; não corrige nada e não grava nada.
 *
 * Referências usadas (todas lidas de registros oficiais, nenhuma recalculada):
 * - Comissão original do pedido: comissão final de cada item nos snapshots ACTIVE, cada item
 *   UMA vez (itens com valores diferentes entre snapshots ⇒ comissão desconhecida, suspeita).
 * - Comissão atribuível ao faturado: comissão do item × quantidade faturada / quantidade pedida
 *   (SalesOrderItemFlowSnapshot). É a referência da auditoria, não um valor oficial.
 * - Alocado: comissão alocada nos schedules que o motor da Previsão considera válidos
 *   (versão vigente, um schedule por título; cliente excluído/sem vendedor = 0).
 * - Realizado: comissão dos recebimentos (motor da Previsão). Liberado: linhas de fechamentos
 *   CLOSED do título. Pago: só itens de lote PAID com vínculo comprovado ao título
 *   (CommissionPaymentSchedule do título ou mesmo CommissionRecord da linha do fechamento).
 *
 * Excesso do título = alocado − atribuível do título (atribuível do pedido rateado pelo nominal
 * dos títulos válidos). O excesso realizado/liberado/pago aplica a MESMA proporção ao realizado,
 * liberado e pago do título. Pagamento sem vínculo ao título nunca é estimado.
 */
import { roundMoney } from "./commission-money.shared.js";

export const R1_TOLERANCE = 0.01;
const NOMUS_NFE_STATUS_CANCELLED = 7;

export type R1SnapshotInput = {
  id: string;
  status: string;
  nfeId: number | null;
  totalFinalCommissionAmount: number;
  saleDate: string | null;
  canonicalSellerId: string | null;
  canonicalSellerName: string | null;
  rawSellerId: number | null;
  items: Array<{
    salesOrderItemId: string;
    productName: string | null;
    finalCommissionAmount: number;
    commissionRatePercent: number;
    marginPercent: number | null;
    status: string;
  }>;
};

export type R1TitleInput = {
  scheduleId: string;
  scheduleStatus: string;
  snapshotId: string;
  snapshotStatus: string;
  receivableId: number;
  nfeId: number | null;
  nominalAmount: number;
  dueDate: string | null;
  scheduledCommissionAmount: number;
  /** Linha oficial da Previsão: false = schedule anulado (versão substituída, duplicado, cancelado). */
  validInOutlook: boolean;
  /** Comissão alocada pelo motor da Previsão (0 para cliente excluído/sem vendedor). */
  outlookAllocated: number;
  realizedCommission: number;
};

export type R1ReleaseInput = {
  lineId: string;
  receivableId: number;
  closingId: string;
  competence: string;
  releasedCommissionAmount: number;
  commissionRecordId: string | null;
};

export type R1PaymentItemInput = {
  itemId: string;
  batchId: string;
  paymentDate: string | null;
  amountPaid: number;
  /** Título do CommissionPaymentSchedule do item (vínculo direto). */
  receivableId: number | null;
  commissionRecordId: string | null;
};

export type R1SellerBatchInput = {
  batchId: string;
  commissionPersonId: string;
  periodStart: string;
  periodEnd: string;
};

export type R1OrderInput = {
  salesOrderId: string;
  orderCode: string | null;
  orderStatus: string;
  customerName: string | null;
  nfes: Array<{ nfeId: number; number: string | null; status: number | null }>;
  snapshots: R1SnapshotInput[];
  flows: Array<{
    salesOrderItemId: string;
    orderedQuantity: number | null;
    shipTargetQuantity: number;
    invoicedQuantity: number;
    requiresProduction: boolean | null;
  }>;
  titles: R1TitleInput[];
  releases: R1ReleaseInput[];
  payments: R1PaymentItemInput[];
};

export type R1Classification = "SOBREALOCACAO_CONFIRMADA" | "ANTECIPACAO_FATURAMENTO_PARCIAL" | "SUSPEITA" | "SEM_EXCESSO";

export const R1_CLASSIFICATION_LABELS: Record<R1Classification, string> = {
  SOBREALOCACAO_CONFIRMADA: "Sobrealocação confirmada",
  ANTECIPACAO_FATURAMENTO_PARCIAL: "Antecipação por faturamento parcial",
  SUSPEITA: "Suspeita (dados insuficientes ou inconsistentes)",
  SEM_EXCESSO: "Sem excesso",
};

export type R1ItemRow = {
  salesOrderItemId: string;
  productName: string | null;
  /** Comissão do item; null = valores diferentes entre snapshots vigentes. */
  commission: number | null;
  ratePercent: number | null;
  marginPercent: number | null;
  orderedQuantity: number | null;
  invoicedQuantity: number | null;
  /** Comissão atribuível à quantidade faturada; null = sem fluxo ou comissão desconhecida. */
  invoicedCommission: number | null;
  stockFulfilled: boolean | null;
};

export type R1TitleRow = {
  receivableId: number;
  nfeId: number | null;
  scheduleId: string;
  snapshotId: string;
  valid: boolean;
  nominalAmount: number;
  allocated: number;
  attributable: number | null;
  excess: number | null;
  realized: number;
  realizedExcess: number | null;
  released: number;
  releasedExcess: number | null;
  paidProven: number;
  paidExcessProven: number | null;
  /** Liberado no título sem pagamento comprovado, mas com lote pago do vendedor na competência. */
  paymentNotAttributable: boolean;
};

export type R1OrderRow = {
  salesOrderId: string;
  orderCode: string | null;
  orderStatus: string;
  customerName: string | null;
  canonicalSellerId: string | null;
  sellerName: string;
  saleMonth: string | null;
  nfeCount: number;
  cancelledNfeCount: number;
  activeSnapshotCount: number;
  supersededSnapshotCount: number;
  distinctRates: number;
  stockFulfilledItems: number;
  /** Comissão original do pedido (cada item uma vez). null = snapshots vigentes divergentes. */
  orderCommission: number | null;
  /** Σ comissão dos snapshots ACTIVE (mostra a duplicação; nunca usado como referência). */
  activeSnapshotsCommission: number;
  invoicedCommission: number | null;
  fullyInvoiced: boolean | null;
  allocated: number;
  realized: number;
  released: number;
  paidProven: number;
  /** Alocado acima da comissão original (permanente, confirmado). */
  overAllocation: number | null;
  /** Alocado acima do atribuível ao faturado, mas dentro da comissão original. */
  anticipation: number | null;
  excessRealized: number | null;
  excessReleased: number | null;
  excessPaidProven: number | null;
  paymentNotAttributable: boolean;
  classification: R1Classification;
  reasons: string[];
  needsReview: boolean;
  items: R1ItemRow[];
  titles: R1TitleRow[];
};

function monthOf(day: string | null): string | null {
  return day && day.length >= 7 ? day.slice(0, 7) : null;
}

function isActive(status: string): boolean {
  return status === "ACTIVE";
}

/** Avalia um PV. Puro: não lê banco, não grava nada. */
export function auditR1Order(order: R1OrderInput, sellerBatches: readonly R1SellerBatchInput[] = []): R1OrderRow {
  const reasons: string[] = [];
  const active = order.snapshots.filter((snap) => isActive(snap.status));
  const superseded = order.snapshots.filter((snap) => !isActive(snap.status));
  const head = [...active].sort((a, b) => ((a.saleDate ?? "") < (b.saleDate ?? "") ? 1 : -1))[0] ?? null;

  // Comissão original: cada item uma vez entre os snapshots vigentes.
  const itemsById = new Map<string, { values: Set<number>; rates: Set<number>; margin: number | null; productName: string | null }>();
  for (const snap of active) {
    for (const item of snap.items) {
      const entry = itemsById.get(item.salesOrderItemId) ?? { values: new Set<number>(), rates: new Set<number>(), margin: item.marginPercent, productName: item.productName };
      entry.values.add(roundMoney(item.finalCommissionAmount));
      entry.rates.add(item.commissionRatePercent);
      itemsById.set(item.salesOrderItemId, entry);
    }
  }
  const flowById = new Map(order.flows.map((flow) => [flow.salesOrderItemId, flow]));
  const items: R1ItemRow[] = [...itemsById.entries()].map(([id, entry]) => {
    const commission = entry.values.size === 1 ? [...entry.values][0]! : null;
    const flow = flowById.get(id);
    const ordered = flow?.orderedQuantity ?? null;
    const invoiced = flow ? Math.max(0, flow.invoicedQuantity) : null;
    const invoicedCommission =
      commission != null && ordered != null && ordered > 0 && invoiced != null
        ? roundMoney((commission * Math.min(invoiced, ordered)) / ordered)
        : null;
    return {
      salesOrderItemId: id,
      productName: entry.productName,
      commission,
      ratePercent: entry.rates.size === 1 ? [...entry.rates][0]! : null,
      marginPercent: entry.margin,
      orderedQuantity: ordered,
      invoicedQuantity: invoiced,
      invoicedCommission,
      stockFulfilled: flow ? flow.requiresProduction === false : null,
    };
  });
  const orderCommission = items.length > 0 && items.every((item) => item.commission != null)
    ? roundMoney(items.reduce((sum, item) => sum + item.commission!, 0))
    : null;
  if (active.length === 0) reasons.push("Sem snapshot vigente do pedido.");
  if (items.some((item) => item.commission == null)) reasons.push("Snapshots vigentes com comissões diferentes para o mesmo item.");
  const invoicedCommission = items.length > 0 && items.every((item) => item.invoicedCommission != null)
    ? roundMoney(items.reduce((sum, item) => sum + item.invoicedCommission!, 0))
    : null;
  if (orderCommission != null && invoicedCommission == null) reasons.push("Sem quantidade faturada oficial (fluxo do item) para algum item.");
  const fullyInvoiced = order.flows.length > 0 && items.length > 0
    ? items.every((item) => {
        const flow = flowById.get(item.salesOrderItemId);
        return flow != null && flow.invoicedQuantity + 1e-9 >= flow.shipTargetQuantity;
      })
    : null;

  const cancelledNfes = new Set(order.nfes.filter((nfe) => nfe.status === NOMUS_NFE_STATUS_CANCELLED).map((nfe) => nfe.nfeId));
  if (cancelledNfes.size > 0 && cancelledNfes.size < order.nfes.length) reasons.push("NF-e cancelada e outra NF-e válida no mesmo pedido (possível substituição).");

  // Títulos.
  const releasesByTitle = new Map<number, R1ReleaseInput[]>();
  const seenLines = new Set<string>();
  for (const line of order.releases) {
    if (seenLines.has(line.lineId)) continue;
    seenLines.add(line.lineId);
    const list = releasesByTitle.get(line.receivableId) ?? [];
    list.push(line);
    releasesByTitle.set(line.receivableId, list);
  }
  const recordToTitle = new Map<string, number>();
  for (const line of order.releases) if (line.commissionRecordId) recordToTitle.set(line.commissionRecordId, line.receivableId);
  const paidByTitle = new Map<number, number>();
  const seenItems = new Set<string>();
  for (const item of order.payments) {
    if (seenItems.has(item.itemId)) continue;
    seenItems.add(item.itemId);
    const title = item.receivableId ?? (item.commissionRecordId ? recordToTitle.get(item.commissionRecordId) ?? null : null);
    if (title == null) continue;
    paidByTitle.set(title, roundMoney((paidByTitle.get(title) ?? 0) + Math.max(0, item.amountPaid)));
  }

  const validTitles = order.titles.filter((title) => title.validInOutlook);
  const validNominal = validTitles.reduce((sum, title) => sum + Math.max(0, title.nominalAmount), 0);
  const allocated = roundMoney(validTitles.reduce((sum, title) => sum + Math.max(0, title.outlookAllocated), 0));
  const reference = invoicedCommission ?? (fullyInvoiced ? orderCommission : null);
  const sellerId = head?.canonicalSellerId ?? null;

  const titles: R1TitleRow[] = order.titles.map((title) => {
    const releases = releasesByTitle.get(title.receivableId) ?? [];
    const released = roundMoney(releases.reduce((sum, line) => sum + Math.max(0, line.releasedCommissionAmount), 0));
    const paidProven = paidByTitle.get(title.receivableId) ?? 0;
    const valid = title.validInOutlook;
    const allocatedTitle = valid ? Math.max(0, title.outlookAllocated) : 0;
    const attributable =
      valid && reference != null && validNominal > 0 ? roundMoney((reference * Math.max(0, title.nominalAmount)) / validNominal) : valid ? null : 0;
    const excess = attributable == null ? null : roundMoney(Math.max(0, allocatedTitle - attributable));
    const ratio = excess != null && allocatedTitle > 0 ? excess / allocatedTitle : excess == null ? null : 0;
    const competences = new Set(releases.map((line) => line.competence));
    const paymentNotAttributable =
      released > R1_TOLERANCE &&
      paidProven <= R1_TOLERANCE &&
      sellerId != null &&
      sellerBatches.some(
        (batch) =>
          batch.commissionPersonId === sellerId &&
          [...competences].some((month) => batch.periodStart.slice(0, 7) <= month && batch.periodEnd.slice(0, 7) >= month)
      );
    return {
      receivableId: title.receivableId,
      nfeId: title.nfeId,
      scheduleId: title.scheduleId,
      snapshotId: title.snapshotId,
      valid,
      nominalAmount: roundMoney(title.nominalAmount),
      allocated: roundMoney(allocatedTitle),
      attributable,
      excess,
      realized: roundMoney(title.realizedCommission),
      realizedExcess: ratio == null ? null : roundMoney(title.realizedCommission * ratio),
      released,
      releasedExcess: ratio == null ? null : roundMoney(released * ratio),
      paidProven: roundMoney(paidProven),
      paidExcessProven: ratio == null ? null : roundMoney(paidProven * ratio),
      paymentNotAttributable,
    };
  });
  if (order.titles.some((title) => title.validInOutlook && title.nfeId != null && cancelledNfes.has(title.nfeId))) {
    reasons.push("Schedule válido em título de NF-e cancelada.");
  }

  const sumNullable = (pick: (row: R1TitleRow) => number | null) =>
    titles.some((row) => row.valid && pick(row) == null) ? null : roundMoney(titles.reduce((sum, row) => sum + (pick(row) ?? 0), 0));
  const overAllocation = orderCommission == null ? null : roundMoney(Math.max(0, allocated - orderCommission));
  const anticipation =
    orderCommission == null || reference == null ? null : roundMoney(Math.max(0, Math.min(allocated, orderCommission) - reference));
  const excessRealized = sumNullable((row) => row.realizedExcess);
  const excessReleased = sumNullable((row) => row.releasedExcess);
  const excessPaidProven = sumNullable((row) => row.paidExcessProven);
  const paymentNotAttributable = titles.some((row) => row.paymentNotAttributable);

  const suspicious =
    reasons.some((reason) => /comissões diferentes|Schedule válido em título de NF-e cancelada|Sem snapshot vigente/.test(reason)) ||
    (orderCommission != null && reference == null && allocated > R1_TOLERANCE);
  const classification: R1Classification =
    overAllocation != null && overAllocation > R1_TOLERANCE
      ? "SOBREALOCACAO_CONFIRMADA"
      : suspicious
        ? "SUSPEITA"
        : anticipation != null && anticipation > R1_TOLERANCE
          ? "ANTECIPACAO_FATURAMENTO_PARCIAL"
          : "SEM_EXCESSO";
  if (classification === "SOBREALOCACAO_CONFIRMADA") {
    reasons.unshift(`Alocado ${allocated.toFixed(2)} acima da comissão do pedido ${orderCommission!.toFixed(2)}.`);
  }
  if (paymentNotAttributable) reasons.push("Pagamento não atribuível ao PV: há lote pago do vendedor na competência, sem vínculo ao título.");

  return {
    salesOrderId: order.salesOrderId,
    orderCode: order.orderCode,
    orderStatus: order.orderStatus,
    customerName: order.customerName,
    canonicalSellerId: sellerId,
    sellerName: head?.canonicalSellerName?.trim() || (head?.rawSellerId != null ? `Vendedor Nomus ${head.rawSellerId}` : "Sem vendedor"),
    saleMonth: monthOf(head?.saleDate ?? null),
    nfeCount: order.nfes.length,
    cancelledNfeCount: cancelledNfes.size,
    activeSnapshotCount: active.length,
    supersededSnapshotCount: superseded.length,
    distinctRates: new Set(items.map((item) => item.ratePercent).filter((rate) => rate != null)).size,
    stockFulfilledItems: items.filter((item) => item.stockFulfilled === true).length,
    orderCommission,
    activeSnapshotsCommission: roundMoney(active.reduce((sum, snap) => sum + snap.totalFinalCommissionAmount, 0)),
    invoicedCommission,
    fullyInvoiced,
    allocated,
    realized: roundMoney(titles.reduce((sum, row) => sum + (row.valid ? row.realized : 0), 0)),
    released: roundMoney(titles.reduce((sum, row) => sum + row.released, 0)),
    paidProven: roundMoney(titles.reduce((sum, row) => sum + row.paidProven, 0)),
    overAllocation,
    anticipation,
    excessRealized,
    excessReleased,
    excessPaidProven,
    paymentNotAttributable,
    classification,
    reasons,
    needsReview: classification !== "SEM_EXCESSO" || paymentNotAttributable,
    items,
    titles,
  };
}

export type R1Totals = {
  ordersExamined: number;
  ordersWithMultipleNfes: number;
  ordersConfirmed: number;
  ordersAnticipation: number;
  ordersSuspect: number;
  confirmedOrderCommission: number;
  confirmedAllocated: number;
  confirmedOverAllocation: number;
  excessRealized: number;
  excessReleased: number;
  excessPaidProven: number;
  anticipationAmount: number;
  ordersPaymentNotAttributable: number;
  ordersNeedingReview: number;
};

function emptyTotals(): R1Totals {
  return {
    ordersExamined: 0,
    ordersWithMultipleNfes: 0,
    ordersConfirmed: 0,
    ordersAnticipation: 0,
    ordersSuspect: 0,
    confirmedOrderCommission: 0,
    confirmedAllocated: 0,
    confirmedOverAllocation: 0,
    excessRealized: 0,
    excessReleased: 0,
    excessPaidProven: 0,
    anticipationAmount: 0,
    ordersPaymentNotAttributable: 0,
    ordersNeedingReview: 0,
  };
}

function addToTotals(totals: R1Totals, row: R1OrderRow): void {
  totals.ordersExamined += 1;
  if (row.nfeCount - row.cancelledNfeCount > 1) totals.ordersWithMultipleNfes += 1;
  if (row.classification === "SOBREALOCACAO_CONFIRMADA") {
    totals.ordersConfirmed += 1;
    totals.confirmedOrderCommission = roundMoney(totals.confirmedOrderCommission + (row.orderCommission ?? 0));
    totals.confirmedAllocated = roundMoney(totals.confirmedAllocated + row.allocated);
    totals.confirmedOverAllocation = roundMoney(totals.confirmedOverAllocation + (row.overAllocation ?? 0));
  }
  if (row.classification === "ANTECIPACAO_FATURAMENTO_PARCIAL") {
    totals.ordersAnticipation += 1;
    totals.anticipationAmount = roundMoney(totals.anticipationAmount + (row.anticipation ?? 0));
  }
  if (row.classification === "SUSPEITA") totals.ordersSuspect += 1;
  // Excesso por estágio: só pedidos confirmados (as suspeitas ficam separadas).
  if (row.classification === "SOBREALOCACAO_CONFIRMADA") {
    totals.excessRealized = roundMoney(totals.excessRealized + (row.excessRealized ?? 0));
    totals.excessReleased = roundMoney(totals.excessReleased + (row.excessReleased ?? 0));
    totals.excessPaidProven = roundMoney(totals.excessPaidProven + (row.excessPaidProven ?? 0));
  }
  if (row.paymentNotAttributable) totals.ordersPaymentNotAttributable += 1;
  if (row.needsReview) totals.ordersNeedingReview += 1;
}

export type R1Summary = {
  totals: R1Totals;
  bySeller: Array<{ key: string; sellerName: string; totals: R1Totals }>;
  byMonth: Array<{ month: string; totals: R1Totals }>;
};

/** Consolidado geral, por vendedor e por mês da venda. Pedidos sem comissão nem alocação ficam fora. */
export function summarizeR1Audit(rows: readonly R1OrderRow[]): R1Summary {
  const totals = emptyTotals();
  const sellers = new Map<string, { sellerName: string; totals: R1Totals }>();
  const months = new Map<string, R1Totals>();
  for (const row of rows) {
    if ((row.orderCommission ?? 0) <= R1_TOLERANCE && row.allocated <= R1_TOLERANCE && row.classification !== "SUSPEITA") continue;
    addToTotals(totals, row);
    const key = row.canonicalSellerId ?? `nome:${row.sellerName}`;
    const seller = sellers.get(key) ?? { sellerName: row.sellerName, totals: emptyTotals() };
    addToTotals(seller.totals, row);
    sellers.set(key, seller);
    const month = row.saleMonth ?? "sem-data";
    const bucket = months.get(month) ?? emptyTotals();
    addToTotals(bucket, row);
    months.set(month, bucket);
  }
  return {
    totals,
    bySeller: [...sellers.entries()]
      .map(([key, value]) => ({ key, ...value }))
      .sort((a, b) => b.totals.confirmedOverAllocation - a.totals.confirmedOverAllocation || a.sellerName.localeCompare(b.sellerName, "pt-BR")),
    byMonth: [...months.entries()].map(([month, value]) => ({ month, totals: value })).sort((a, b) => (a.month < b.month ? -1 : 1)),
  };
}

function csvCell(value: unknown): string {
  let raw = value == null ? "" : typeof value === "number" ? value.toFixed(2).replace(".", ",") : typeof value === "boolean" ? (value ? "sim" : "não") : String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(raw)) raw = `'${raw}`;
  return /[;"\r\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

function csv(header: string[], rows: unknown[][]): string {
  return `﻿${[header.map(csvCell).join(";"), ...rows.map((row) => row.map(csvCell).join(";"))].join("\n")}`;
}

/** CSV por pedido (separador ;, seguro para Excel). */
export function buildR1OrdersCsv(rows: readonly R1OrderRow[]): string {
  return csv(
    [
      "Id do PV", "Código do PV", "Situação do PV", "Vendedor", "Cliente", "Mês da venda", "NF-e", "NF-e canceladas",
      "Snapshots ativos", "Snapshots substituídos", "Percentuais distintos", "Itens por estoque", "Comissão original",
      "Σ snapshots ativos", "Atribuível ao faturado", "Totalmente faturado", "Alocado em schedules", "Realizado", "Liberado",
      "Pago comprovado", "Excesso de alocação", "Antecipação", "Excesso realizado", "Excesso liberado", "Excesso pago comprovado",
      "Pagamento não atribuível ao PV", "Classificação", "Revisar", "Motivos",
    ],
    rows.map((row) => [
      row.salesOrderId, row.orderCode, row.orderStatus, row.sellerName, row.customerName, row.saleMonth, String(row.nfeCount),
      String(row.cancelledNfeCount), String(row.activeSnapshotCount), String(row.supersededSnapshotCount), String(row.distinctRates),
      String(row.stockFulfilledItems), row.orderCommission, row.activeSnapshotsCommission, row.invoicedCommission, row.fullyInvoiced,
      row.allocated, row.realized, row.released, row.paidProven, row.overAllocation, row.anticipation, row.excessRealized,
      row.excessReleased, row.excessPaidProven, row.paymentNotAttributable ? "Pagamento não atribuível ao PV" : "",
      R1_CLASSIFICATION_LABELS[row.classification], row.needsReview, row.reasons.join(" "),
    ])
  );
}

/** CSV por título (alocação financeira de cada CR do pedido). */
export function buildR1TitlesCsv(rows: readonly R1OrderRow[]): string {
  return csv(
    [
      "Código do PV", "Título", "NF-e", "Schedule", "Snapshot", "Válido", "Nominal", "Alocado", "Atribuível", "Excesso",
      "Realizado", "Excesso realizado", "Liberado", "Excesso liberado", "Pago comprovado", "Excesso pago comprovado",
      "Pagamento não atribuível ao PV",
    ],
    rows.flatMap((row) =>
      row.titles.map((title) => [
        row.orderCode ?? row.salesOrderId, String(title.receivableId), title.nfeId == null ? "" : String(title.nfeId), title.scheduleId,
        title.snapshotId, title.valid, title.nominalAmount, title.allocated, title.attributable, title.excess, title.realized,
        title.realizedExcess, title.released, title.releasedExcess, title.paidProven, title.paidExcessProven,
        title.paymentNotAttributable ? "Pagamento não atribuível ao PV" : "",
      ])
    )
  );
}

/** CSV por item (comissão do item, percentual, margem e parte atribuível ao faturado). */
export function buildR1ItemsCsv(rows: readonly R1OrderRow[]): string {
  return csv(
    ["Código do PV", "Item", "Produto", "Comissão do item", "Percentual", "Margem", "Qtd. pedida", "Qtd. faturada", "Comissão atribuível ao faturado", "Atendido por estoque"],
    rows.flatMap((row) =>
      row.items.map((item) => [
        row.orderCode ?? row.salesOrderId, item.salesOrderItemId, item.productName, item.commission,
        item.ratePercent == null ? "divergente" : `${item.ratePercent}%`, item.marginPercent == null ? "" : `${item.marginPercent}%`,
        item.orderedQuantity == null ? "" : String(item.orderedQuantity), item.invoicedQuantity == null ? "" : String(item.invoicedQuantity),
        item.invoicedCommission, item.stockFulfilled == null ? "" : item.stockFulfilled,
      ])
    )
  );
}

const SUMMARY_HEADER = [
  "Pedidos examinados", "Múltiplas NF-e", "Sobrealocação confirmada", "Comissão original (confirmados)", "Alocado (confirmados)",
  "Excesso alocado", "Excesso realizado", "Excesso liberado", "Excesso pago comprovado", "Pagamento não atribuível ao PV",
  "Antecipação (pedidos)", "Antecipação (valor)", "Suspeitos", "Revisar",
];

function summaryCells(totals: R1Totals): unknown[] {
  return [
    String(totals.ordersExamined), String(totals.ordersWithMultipleNfes), String(totals.ordersConfirmed), totals.confirmedOrderCommission,
    totals.confirmedAllocated, totals.confirmedOverAllocation, totals.excessRealized, totals.excessReleased, totals.excessPaidProven,
    String(totals.ordersPaymentNotAttributable), String(totals.ordersAnticipation), totals.anticipationAmount, String(totals.ordersSuspect),
    String(totals.ordersNeedingReview),
  ];
}

export function buildR1SellerCsv(summary: R1Summary): string {
  return csv(["Vendedor", ...SUMMARY_HEADER], summary.bySeller.map((row) => [row.sellerName, ...summaryCells(row.totals)]));
}

export function buildR1MonthCsv(summary: R1Summary): string {
  return csv(["Mês da venda", ...SUMMARY_HEADER], [
    ...summary.byMonth.map((row) => [row.month, ...summaryCells(row.totals)]),
    ["Total", ...summaryCells(summary.totals)],
  ]);
}
