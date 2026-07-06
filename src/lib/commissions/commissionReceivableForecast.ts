/**
 * Previsão de comissão por vencimento de títulos em aberto (dueDate).
 * Lógica pura — reutiliza VisualAuditRow FORECAST sem recalcular comissão.
 */
import { roundMoney } from "./commission-money.js";
import {
  resolveReceivableUniqueKey,
  type VisualAuditRow,
} from "./commissionVisualAudit.js";

export type CommissionReceivableForecastQuery = {
  commissionPersonId?: string | null;
  customer?: string | null;
  orderCode?: string | null;
  nfeNumber?: string | null;
  nomusReceivableId?: number | null;
  receivableTitleStatus?: string | null;
  commissionStatus?: string | null;
  dueDateFrom?: Date | null;
  dueDateTo?: Date | null;
  onlyDivergences?: boolean;
  horizonMonths?: number | null;
};

export type ForecastBucketKind = "overdue" | "currentMonth" | "future";

export type ReceivableForecastDetailLine = {
  lineId: string;
  sellerId: string;
  sellerName: string;
  customerName: string | null;
  orderCode: string | null;
  nfeNumber: string | null;
  nomusReceivableId: number | null;
  installmentNumber: number | null;
  dueDate: string | null;
  dueMonthKey: string | null;
  openAmount: number;
  allocatedBaseAmount: number;
  expectedCommissionAmount: number;
  releasedCommissionAmount: number;
  forecastCommissionAmount: number;
  receivableTitleStatus: string;
  commissionStatus: string;
  bucket: ForecastBucketKind;
  alerts: string[];
};

export type ReceivableForecastMonthlyRow = {
  dueMonthKey: string;
  dueMonthLabelPt: string;
  openTitlesAmount: number;
  allocatedBaseAmount: number;
  forecastCommissionAmount: number;
  titleCount: number;
  sellerCount: number;
  bucket: ForecastBucketKind;
};

export type ReceivableForecastCards = {
  futureCommissionTotal: number;
  overdueCommissionTotal: number;
  futureTitlesAmountTotal: number;
  overdueTitlesAmountTotal: number;
  peakMonthKey: string | null;
  peakMonthLabelPt: string | null;
  peakMonthCommission: number;
  nextMonthKey: string | null;
  nextMonthLabelPt: string | null;
  nextMonthCommission: number;
  titleCount: number;
  sellerCount: number;
};

export type ReceivableForecastSummary = {
  cards: ReceivableForecastCards;
  monthly: ReceivableForecastMonthlyRow[];
  overdue: ReceivableForecastMonthlyRow[];
  currentMonth: ReceivableForecastMonthlyRow | null;
  futureMonths: ReceivableForecastMonthlyRow[];
  details: ReceivableForecastDetailLine[];
};

const PT_MONTHS = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function buildDueMonthKey(isoDate: string | null): string | null {
  if (!isoDate) return null;
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function formatDueMonthLabelPt(monthKey: string): string {
  const [y, m] = monthKey.split("-");
  const month = Number.parseInt(m ?? "0", 10);
  const name = PT_MONTHS[month - 1] ?? monthKey;
  return `${name}/${y}`;
}

export function currentMonthKey(ref: Date = new Date()): string {
  return `${ref.getUTCFullYear()}-${String(ref.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function nextMonthKey(ref: Date = new Date()): string {
  const d = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function classifyForecastBucket(
  row: Pick<VisualAuditRow, "dueDate" | "receivableTitleStatus">,
  ref: Date = new Date()
): ForecastBucketKind {
  if (row.receivableTitleStatus === "VENCIDO") return "overdue";
  const monthKey = currentMonthKey(ref);
  const dueKey = buildDueMonthKey(row.dueDate);
  if (!dueKey) return "future";
  if (dueKey < monthKey) return "overdue";
  if (dueKey === monthKey) return "currentMonth";
  return "future";
}

function aggregateMonthlyBucket(
  monthKey: string,
  rows: VisualAuditRow[]
): Omit<ReceivableForecastMonthlyRow, "dueMonthLabelPt"> {
  const receivableKeys = new Set<string>();
  const scheduleKeys = new Set<string>();
  const sellerKeys = new Set<string>();
  let openTitlesAmount = 0;
  let allocatedBaseAmount = 0;
  let forecastCommissionAmount = 0;

  for (const row of rows) {
    sellerKeys.add(row.commissionPersonId);
    const receivableKey = resolveReceivableUniqueKey(row);
    if (receivableKey && !receivableKeys.has(receivableKey)) {
      receivableKeys.add(receivableKey);
      openTitlesAmount = roundMoney(
        openTitlesAmount + roundMoney(row.openBalance > 0 ? row.openBalance : row.receivableAmount)
      );
    }
    const scheduleKey = row.scheduleId ?? row.lineId;
    if (!scheduleKeys.has(scheduleKey)) {
      scheduleKeys.add(scheduleKey);
      allocatedBaseAmount = roundMoney(allocatedBaseAmount + row.allocatedBaseAmount);
      forecastCommissionAmount = roundMoney(forecastCommissionAmount + row.commissionPending);
    }
  }

  const bucket = classifyForecastBucket(rows[0] ?? { dueDate: null, receivableTitleStatus: "EM_ABERTO" });

  return {
    dueMonthKey: monthKey,
    openTitlesAmount,
    allocatedBaseAmount,
    forecastCommissionAmount,
    titleCount: receivableKeys.size,
    sellerCount: sellerKeys.size,
    bucket,
  };
}

export function mapRowToForecastDetail(
  row: VisualAuditRow,
  ref: Date = new Date()
): ReceivableForecastDetailLine {
  const dueMonthKey = buildDueMonthKey(row.dueDate);
  return {
    lineId: row.lineId,
    sellerId: row.commissionPersonId,
    sellerName: row.commissionPersonName,
    customerName: row.customerName,
    orderCode: row.orderCode,
    nfeNumber: row.nfeNumber,
    nomusReceivableId: row.nomusReceivableId,
    installmentNumber: row.installmentNumber,
    dueDate: row.dueDate,
    dueMonthKey,
    openAmount: roundMoney(row.openBalance > 0 ? row.openBalance : row.receivableAmount),
    allocatedBaseAmount: row.allocatedBaseAmount,
    expectedCommissionAmount: row.commissionExpected,
    releasedCommissionAmount: row.commissionReleased,
    forecastCommissionAmount: row.commissionPending,
    receivableTitleStatus: row.receivableTitleStatus,
    commissionStatus: row.commissionStatus,
    bucket: classifyForecastBucket(row, ref),
    alerts: row.alertLabels,
  };
}

export function aggregateReceivableForecastFromRows(
  rows: VisualAuditRow[],
  query: CommissionReceivableForecastQuery = {},
  ref: Date = new Date()
): ReceivableForecastSummary {
  let filtered = rows.filter((row) => {
    if (row.receivableTitleStatus === "BAIXADO") return false;
    if (row.settlementDate) return false;
    if (row.commissionPending <= 0 && row.commissionExpected <= 0) return false;
    return true;
  });

  if (query.commissionPersonId) {
    filtered = filtered.filter((r) => r.commissionPersonId === query.commissionPersonId);
  }

  if (query.horizonMonths != null && query.horizonMonths > 0) {
    const horizonEnd = new Date(
      Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + query.horizonMonths, 0, 23, 59, 59, 999)
    );
    filtered = filtered.filter((r) => {
      if (!r.dueDate) return true;
      return new Date(r.dueDate).getTime() <= horizonEnd.getTime();
    });
  }

  const byMonth = new Map<string, VisualAuditRow[]>();
  for (const row of filtered) {
    const key = buildDueMonthKey(row.dueDate) ?? "sem-vencimento";
    const bucket = byMonth.get(key) ?? [];
    bucket.push(row);
    byMonth.set(key, bucket);
  }

  const monthly = [...byMonth.entries()]
    .map(([monthKey, monthRows]) => ({
      ...aggregateMonthlyBucket(monthKey, monthRows),
      dueMonthLabelPt:
        monthKey === "sem-vencimento" ? "Sem vencimento" : formatDueMonthLabelPt(monthKey),
    }))
    .sort((a, b) => a.dueMonthKey.localeCompare(b.dueMonthKey));

  const curKey = currentMonthKey(ref);
  const overdue = monthly.filter((m) => m.bucket === "overdue" || m.dueMonthKey < curKey);
  const currentMonth = monthly.find((m) => m.dueMonthKey === curKey) ?? null;
  const futureMonths = monthly.filter((m) => m.bucket === "future" && m.dueMonthKey > curKey);

  let futureCommissionTotal = 0;
  let overdueCommissionTotal = 0;
  let futureTitlesAmountTotal = 0;
  let overdueTitlesAmountTotal = 0;

  for (const m of monthly) {
    if (m.bucket === "overdue" || m.dueMonthKey < curKey) {
      overdueCommissionTotal = roundMoney(overdueCommissionTotal + m.forecastCommissionAmount);
      overdueTitlesAmountTotal = roundMoney(overdueTitlesAmountTotal + m.openTitlesAmount);
    } else if (m.bucket === "future" || m.dueMonthKey > curKey) {
      futureCommissionTotal = roundMoney(futureCommissionTotal + m.forecastCommissionAmount);
      futureTitlesAmountTotal = roundMoney(futureTitlesAmountTotal + m.openTitlesAmount);
    }
  }

  if (currentMonth) {
    futureCommissionTotal = roundMoney(
      futureCommissionTotal + currentMonth.forecastCommissionAmount
    );
    futureTitlesAmountTotal = roundMoney(
      futureTitlesAmountTotal + currentMonth.openTitlesAmount
    );
  }

  let peakMonth = monthly[0] ?? null;
  for (const m of monthly) {
    if (m.forecastCommissionAmount > (peakMonth?.forecastCommissionAmount ?? 0)) {
      peakMonth = m;
    }
  }

  const nxtKey = nextMonthKey(ref);
  const nextMonthRow = monthly.find((m) => m.dueMonthKey === nxtKey) ?? null;

  const globalReceivableKeys = new Set<string>();
  const globalSellerKeys = new Set<string>();
  for (const row of filtered) {
    globalSellerKeys.add(row.commissionPersonId);
    const rk = resolveReceivableUniqueKey(row);
    if (rk) globalReceivableKeys.add(rk);
  }

  const cards: ReceivableForecastCards = {
    futureCommissionTotal,
    overdueCommissionTotal,
    futureTitlesAmountTotal,
    overdueTitlesAmountTotal,
    peakMonthKey: peakMonth?.dueMonthKey ?? null,
    peakMonthLabelPt: peakMonth?.dueMonthLabelPt ?? null,
    peakMonthCommission: peakMonth?.forecastCommissionAmount ?? 0,
    nextMonthKey: nextMonthRow?.dueMonthKey ?? nxtKey,
    nextMonthLabelPt: nextMonthRow?.dueMonthLabelPt ?? formatDueMonthLabelPt(nxtKey),
    nextMonthCommission: nextMonthRow?.forecastCommissionAmount ?? 0,
    titleCount: globalReceivableKeys.size,
    sellerCount: globalSellerKeys.size,
  };

  return {
    cards,
    monthly,
    overdue,
    currentMonth,
    futureMonths,
    details: filtered.map((row) => mapRowToForecastDetail(row, ref)),
  };
}

function csvHeader(cards: ReceivableForecastCards): string[] {
  return [
    `# comissao_prevista_futura=${cards.futureCommissionTotal.toFixed(2)}`,
    `# comissao_vencida_pendente=${cards.overdueCommissionTotal.toFixed(2)}`,
    `# valor_titulos_futuros=${cards.futureTitlesAmountTotal.toFixed(2)}`,
    `# valor_titulos_vencidos=${cards.overdueTitlesAmountTotal.toFixed(2)}`,
  ];
}

export function buildReceivableForecastMonthlyCsv(summary: ReceivableForecastSummary): string {
  const lines: string[] = [
    ...csvHeader(summary.cards),
    "",
    "mes_vencimento,valor_titulos_aberto,base_comissionavel,comissao_prevista,titulos,vendedores,faixa",
  ];
  for (const m of summary.monthly) {
    lines.push(
      [
        `"${m.dueMonthLabelPt.replace(/"/g, '""')}"`,
        m.openTitlesAmount.toFixed(2),
        m.allocatedBaseAmount.toFixed(2),
        m.forecastCommissionAmount.toFixed(2),
        m.titleCount,
        m.sellerCount,
        m.bucket,
      ].join(",")
    );
  }
  return lines.join("\n");
}

export function buildReceivableForecastDetailCsv(summary: ReceivableForecastSummary): string {
  const lines: string[] = [
    ...csvHeader(summary.cards),
    "",
    "vendedor,cliente,pedido,nf,cr,vencimento,valor_aberto,base_rateada,comissao_prevista,status_titulo,faixa",
  ];
  for (const d of summary.details) {
    lines.push(
      [
        `"${d.sellerName.replace(/"/g, '""')}"`,
        `"${(d.customerName ?? "").replace(/"/g, '""')}"`,
        d.orderCode ?? "",
        d.nfeNumber ?? "",
        d.nomusReceivableId ?? "",
        d.dueDate?.slice(0, 10) ?? "",
        d.openAmount.toFixed(2),
        d.allocatedBaseAmount.toFixed(2),
        d.forecastCommissionAmount.toFixed(2),
        d.receivableTitleStatus,
        d.bucket,
      ].join(",")
    );
  }
  return lines.join("\n");
}
