/**
 * Fechamentos oficiais — leitura do ledger CLOSED (sem recálculo).
 */
import * as XLSX from "xlsx";
import { prisma } from "@/src/lib/prisma.js";
import type { CommissionAccessScope } from "./commissionAccessScope.js";
import { RECEIPT_CLOSING_SOURCE } from "./commissionReceiptClosing.js";
import { getReceiptClosingPage } from "./commissionReceiptClosingApi.server.js";
import {
  buildClosingSellerReport,
  buildClosingSellerSummaries,
  filterClosingSellerReportRows,
  mapClosingListItemFromPage,
  type CommissionClosingDetailPayload,
  type CommissionClosingListItem,
  type CommissionClosingSellerReport,
  type CommissionClosingSellerSummary,
} from "./commissionClosings.shared.js";
import { formatCommissionPeriodLabel } from "./commissionReceiptLineStatusLabels.js";
import { decimalToNumber } from "./commission-money.js";

export type ListCommissionClosingsQuery = {
  year: number | null;
  month: number | null;
  sellerId: string | "all";
  status: string | "all";
  search: string | null;
};

async function resolveUserDisplayNames(userIds: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(userIds.filter(Boolean))];
  const map = new Map<string, string>();
  if (unique.length === 0) return map;
  const users = await prisma.appUser.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true, email: true },
  });
  for (const u of users) {
    map.set(u.id, u.name?.trim() || u.email?.trim() || u.id);
  }
  return map;
}

async function resolveOwnCanonicalSellerIds(scope: CommissionAccessScope): Promise<Set<string>> {
  if (scope.dataScope !== "own" || scope.nomusSellerId == null) return new Set();
  const persons = await prisma.commissionPerson.findMany({
    where: { nomusPersonId: scope.nomusSellerId, type: "SELLER" },
    select: { id: true },
  });
  return new Set(persons.map((p) => p.id));
}

function sellerVisibleToScope(
  seller: CommissionClosingSellerSummary,
  scope: CommissionAccessScope,
  ownIds: Set<string>
): boolean {
  if (scope.dataScope !== "own") return true;
  if (seller.sellerId && ownIds.has(seller.sellerId)) return true;
  if (scope.sellerResponsibleName) {
    const name = scope.sellerResponsibleName.trim().toLowerCase();
    if (seller.sellerName.trim().toLowerCase() === name) return true;
  }
  return false;
}

export async function listCommissionClosings(
  query: ListCommissionClosingsQuery,
  scope: CommissionAccessScope
): Promise<{ items: CommissionClosingListItem[] }> {
  const where: {
    status?: string | { in: string[] };
    source: string;
    year?: number;
    month?: number;
  } = {
    source: RECEIPT_CLOSING_SOURCE,
  };

  if (query.status && query.status !== "all") {
    where.status = query.status.toUpperCase();
  } else {
    where.status = "CLOSED";
  }
  if (query.year != null) where.year = query.year;
  if (query.month != null) where.month = query.month;

  const closings = await prisma.commissionMonthlyClosing.findMany({
    where,
    orderBy: [{ year: "desc" }, { month: "desc" }, { closedAt: "desc" }],
    take: 120,
  });

  const nameMap = await resolveUserDisplayNames(
    closings.map((c) => c.closedBy).filter((id): id is string => Boolean(id))
  );
  const ownIds = await resolveOwnCanonicalSellerIds(scope);

  const items: CommissionClosingListItem[] = [];
  for (const row of closings) {
    const page = await getReceiptClosingPage(row.year, row.month);
    if (page.mode !== "CLOSED" || !page.closing) continue;

    const sellers = buildClosingSellerSummaries(page.lines).filter((s) =>
      sellerVisibleToScope(s, scope, ownIds)
    );

    if (query.sellerId && query.sellerId !== "all") {
      const match = sellers.some(
        (s) => s.sellerId === query.sellerId || s.sellerGroupKey === query.sellerId
      );
      if (!match) continue;
    }

    if (query.search?.trim()) {
      const needle = query.search.trim().toLowerCase();
      const inMeta =
        formatCommissionPeriodLabel(row.year, row.month).toLowerCase().includes(needle) ||
        (nameMap.get(row.closedBy ?? "") ?? "").toLowerCase().includes(needle);
      const inLines = page.lines.some((line) =>
        [line.orderCode, line.customerName, line.nfeNumber, line.receivableNumber, line.canonicalSellerName]
          .some((v) => v != null && String(v).toLowerCase().includes(needle))
      );
      if (!inMeta && !inLines) continue;
    }

    const item = mapClosingListItemFromPage(
      page,
      sellers.length,
      row.closedBy ? nameMap.get(row.closedBy) ?? row.closedBy : null
    );
    if (item) items.push(item);
  }

  return { items };
}

export async function getCommissionClosingDetail(
  closingId: string,
  scope: CommissionAccessScope
): Promise<CommissionClosingDetailPayload | null> {
  const row = await prisma.commissionMonthlyClosing.findFirst({
    where: { id: closingId, status: "CLOSED", source: RECEIPT_CLOSING_SOURCE },
  });
  if (!row) return null;

  const page = await getReceiptClosingPage(row.year, row.month);
  if (page.mode !== "CLOSED" || !page.closing) return null;

  const nameMap = await resolveUserDisplayNames(row.closedBy ? [row.closedBy] : []);
  const ownIds = await resolveOwnCanonicalSellerIds(scope);
  const sellers = buildClosingSellerSummaries(page.lines).filter((s) =>
    sellerVisibleToScope(s, scope, ownIds)
  );
  const closingItem = mapClosingListItemFromPage(
    page,
    sellers.length,
    row.closedBy ? nameMap.get(row.closedBy) ?? row.closedBy : null
  );
  if (!closingItem) return null;

  return {
    closing: closingItem,
    cards: {
      totalReceivedAmount: page.cards.totalReceivedAmount,
      commissionBaseAmount: page.cards.commissionableBaseAmount,
      grossCommissionAmount: page.cards.grossCommissionAmount,
      excludedCommissionAmount: page.cards.excludedCommissionAmount,
      finalCommissionAmount: page.cards.finalCommissionAmount,
      sellerCount: sellers.length,
      titleCount: page.materializationSummary.totalReceivablesCount,
      criticalDivergence: page.criticalDivergence,
    },
    sellers,
  };
}

export async function getCommissionClosingSellerReport(
  closingId: string,
  sellerKey: string,
  scope: CommissionAccessScope,
  search: string | null = null
): Promise<CommissionClosingSellerReport | null> {
  const row = await prisma.commissionMonthlyClosing.findFirst({
    where: { id: closingId, status: "CLOSED", source: RECEIPT_CLOSING_SOURCE },
  });
  if (!row) return null;

  const page = await getReceiptClosingPage(row.year, row.month);
  if (page.mode !== "CLOSED" || !page.closing) return null;

  const decodedKey = decodeURIComponent(sellerKey);
  const nameMap = await resolveUserDisplayNames(row.closedBy ? [row.closedBy] : []);
  const report = buildClosingSellerReport(
    page.lines,
    decodedKey,
    page.closing,
    row.closedBy ? nameMap.get(row.closedBy) ?? row.closedBy : null
  );
  if (!report) return null;

  const ownIds = await resolveOwnCanonicalSellerIds(scope);
  const summaryAsSeller: CommissionClosingSellerSummary = {
    sellerGroupKey: report.seller.groupKey,
    sellerId: report.seller.id,
    sellerName: report.seller.displayName,
    titleCount: report.summary.titleCount,
    orderCount: report.summary.orderCount,
    customerCount: report.summary.customerCount,
    totalReceivedAmount: report.summary.totalReceivedAmount,
    commissionBaseAmount: report.summary.commissionBaseAmount,
    grossCommissionAmount: report.summary.grossCommissionAmount,
    excludedCommissionAmount: report.summary.excludedCommissionAmount,
    finalCommissionAmount: report.summary.finalCommissionAmount,
    averageRate: report.summary.averageRate,
    exceptionCount: report.summary.exceptionCount,
    primaryStatus: "COMMISSIONABLE",
    primaryStatusLabel: "Comissionável",
  };
  if (!sellerVisibleToScope(summaryAsSeller, scope, ownIds)) {
    return null;
  }

  if (search?.trim()) {
    return {
      ...report,
      rows: filterClosingSellerReportRows(report.rows, search),
    };
  }
  return report;
}

function formatDateBr(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("pt-BR");
}

function formatCurrencyBr(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function buildCommissionClosingSellerXlsx(report: CommissionClosingSellerReport): Buffer {
  const wb = XLSX.utils.book_new();
  const resumo = XLSX.utils.aoa_to_sheet([
    ["Relatório de Comissão — por vendedor"],
    ["Vendedor", report.seller.displayName],
    ["Período", report.closing.periodLabel],
    ["Status", report.closing.statusLabel],
    ["Fechado em", formatDateBr(report.closing.closedAt)],
    ["Fechado por", report.closing.closedByName ?? ""],
    ["Origem", "Ledger oficial de comissões"],
    [],
    ["Total recebido", report.summary.totalReceivedAmount],
    ["Base comissionável", report.summary.commissionBaseAmount],
    ["Comissão bruta", report.summary.grossCommissionAmount],
    ["Comissão excluída", report.summary.excludedCommissionAmount],
    ["Comissão final", report.summary.finalCommissionAmount],
    ["Títulos", report.summary.titleCount],
    ["Pedidos", report.summary.orderCount],
    ["Clientes", report.summary.customerCount],
    ["Percentual médio", report.summary.averageRate ?? ""],
  ]);
  XLSX.utils.book_append_sheet(wb, resumo, "Resumo");

  const analiticoRows = [
    [
      "Pedido",
      "Cliente",
      "NF",
      "CR",
      "Parcela",
      "Vencimento CR",
      "Data baixa",
      "Valor original CR",
      "Valor recebido bruto",
      "Valor pago a mais",
      "Base comissão",
      "Percentual comissão",
      "Comissão",
      "Status",
      "Motivo",
    ],
    ...report.rows.map((r) => [
      r.orderCode ?? "",
      r.customerName ?? "",
      r.nfeNumber ?? "",
      r.receivableNumber ?? "",
      r.installment ?? "",
      formatDateBr(r.receivableDueDate),
      formatDateBr(r.settlementDate),
      r.originalReceivableAmount ?? "",
      r.receivedGrossAmount,
      r.overpaidAmount,
      r.commissionBaseAmount,
      r.commissionRate,
      r.commissionAmount,
      r.statusLabel,
      r.reasonLabel ?? "",
    ]),
    [],
    [
      "TOTAL",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      report.totals.totalReceivedAmount,
      "",
      report.totals.commissionBaseAmount,
      "",
      report.totals.finalCommissionAmount,
      "",
      "",
    ],
  ];
  const analitico = XLSX.utils.aoa_to_sheet(analiticoRows);
  analitico["!autofilter"] = { ref: `A1:O${Math.max(report.rows.length + 1, 1)}` };
  XLSX.utils.book_append_sheet(wb, analitico, "Analítico");

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export function buildCommissionClosingSellerXlsxFilename(report: CommissionClosingSellerReport): string {
  const sellerSlug = report.seller.displayName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .slice(0, 40);
  return `comissao-fechamento-${report.closing.year}-${String(report.closing.month).padStart(2, "0")}-${sellerSlug || "vendedor"}.xlsx`;
}

/** Reexport helpers used by routes. */
export { formatCommissionPeriodLabel, decimalToNumber };
