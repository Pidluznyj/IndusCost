/**
 * Cronograma de pagamento para exportação Comercial de Pedidos de Venda.
 * Espelha extração de parcelas previstas do Nomus (commission-source-resolver) sem import .server.
 */
import { formatFinanceCalculatedStatus } from "./financeAccountsReceivableFormat.js";

export const SALES_ORDER_PAYMENT_SOURCE_AR = "Títulos do Contas a Receber";
export const SALES_ORDER_PAYMENT_SOURCE_FORECAST = "Condição prevista do pedido";
export const SALES_ORDER_PAYMENT_NOT_INFORMED = "Não informado";
export const SALES_ORDER_PAYMENT_CASH_LABEL = "À vista";

export type SalesOrderListReceivableInput = {
  externalId: number;
  sourceInvoiceId: number | null;
  sourceInvoiceNumber: string | null;
  dueDate: Date | null;
  amountReceivable: number;
  amountReceived: number;
  balanceReceivable: number;
  settlementDate: Date | null;
};

export type SalesOrderListForecastInstallment = {
  installmentNumber: number;
  dueDate: Date | null;
  expectedAmount: number;
};

export type SalesOrderListPaymentLine = {
  installmentNumber: number;
  dueDate: Date | null;
  amount: number;
  statusLabel: string | null;
  settlementDate: Date | null;
  amountReceived: number | null;
  openBalance: number | null;
  nomusReceivableId: number | null;
  nfeDocument: string | null;
};

export type SalesOrderListPaymentSummary = {
  paymentConditionLabel: string;
  paymentSourceLabel: string;
  installmentCount: number;
  isCashPayment: boolean;
  firstDueDate: Date | null;
  lastDueDate: Date | null;
  scheduleText: string;
  totalTitlesAmount: number | null;
  financialStatusLabel: string | null;
  lines: SalesOrderListPaymentLine[];
};

export type SalesOrderListPaymentResolveInput = {
  paymentTerms: string | null;
  paymentMethod: string | null;
  issueDate: Date;
  totalNetValue: number;
  nomusRawResponse: unknown;
  nfeDocuments: string[];
  receivables: SalesOrderListReceivableInput[];
  referenceDate?: Date;
};

type JsonObject = Record<string, unknown>;

const INSTALLMENT_ARRAY_KEYS = [
  "parcelas",
  "condicaoPagamentoParcelas",
  "parcelasCondicaoPagamento",
  "titulosFinanceiros",
  "financeiroParcelas",
] as const;

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

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
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

function formatDateBr(value: Date | null): string {
  if (!value) return "—";
  return value.toLocaleDateString("pt-BR");
}

function formatMoneyBr(value: number): string {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function extractSalesOrderForecastInstallments(
  raw: unknown,
  _orderTotal: number,
  _issueDate: Date
): SalesOrderListForecastInstallment[] {
  const obj = asObject(raw);
  if (!obj) return [];

  for (const key of INSTALLMENT_ARRAY_KEYS) {
    const arr = obj[key];
    if (!Array.isArray(arr) || arr.length === 0) continue;
    const installments: SalesOrderListForecastInstallment[] = [];
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
      });
    }
    if (installments.length > 0) return installments;
  }

  return [];
}

function paymentTermsText(input: SalesOrderListPaymentResolveInput): string | null {
  const terms = input.paymentTerms?.trim();
  const method = input.paymentMethod?.trim();
  if (terms && method) return `${terms} · ${method}`;
  return terms || method || null;
}

function termsIndicateCash(paymentTerms: string | null): boolean {
  if (!paymentTerms?.trim()) return false;
  const normalized = paymentTerms
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return /\bvista\b/.test(normalized) || /\bavista\b/.test(normalized);
}

function daysBetween(a: Date, b: Date): number {
  const da = startOfDay(a).getTime();
  const db = startOfDay(b).getTime();
  return Math.round(Math.abs(da - db) / (24 * 60 * 60 * 1000));
}

function classifyReceivableStatus(
  row: Pick<
    SalesOrderListReceivableInput,
    "dueDate" | "balanceReceivable" | "settlementDate" | "amountReceivable" | "amountReceived"
  >,
  today: Date
): string {
  if (row.balanceReceivable <= 0 || row.settlementDate != null) return "settled";
  if (row.amountReceivable > 0 && roundMoney(row.amountReceived) >= roundMoney(row.amountReceivable)) {
    return "settled";
  }
  if (!row.dueDate) return "unknown";
  const due = startOfDay(row.dueDate);
  const t = startOfDay(today);
  if (due < t) return "overdue";
  if (due.getTime() === t.getTime()) return "dueToday";
  return "upcoming";
}

function aggregateFinancialStatus(lines: SalesOrderListPaymentLine[]): string | null {
  const labels = lines
    .map((line) => line.statusLabel)
    .filter((label): label is string => Boolean(label?.trim()));
  if (labels.length === 0) return null;
  const unique = [...new Set(labels)];
  if (unique.length === 1) return unique[0]!;
  return unique.join(" · ");
}

function sortLines(lines: SalesOrderListPaymentLine[]): SalesOrderListPaymentLine[] {
  return [...lines].sort((a, b) => {
    const da = a.dueDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const db = b.dueDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
    if (da !== db) return da - db;
    return a.installmentNumber - b.installmentNumber;
  });
}

function dueRange(lines: SalesOrderListPaymentLine[]): {
  firstDueDate: Date | null;
  lastDueDate: Date | null;
} {
  const dated = lines.map((line) => line.dueDate).filter((d): d is Date => d != null);
  if (dated.length === 0) return { firstDueDate: null, lastDueDate: null };
  dated.sort((a, b) => a.getTime() - b.getTime());
  return { firstDueDate: dated[0]!, lastDueDate: dated[dated.length - 1]! };
}

export function formatSalesOrderListPaymentScheduleText(
  lines: SalesOrderListPaymentLine[],
  options?: { isCashPayment?: boolean }
): string {
  if (options?.isCashPayment) return SALES_ORDER_PAYMENT_CASH_LABEL;
  if (lines.length === 0) return SALES_ORDER_PAYMENT_NOT_INFORMED;

  if (lines.length === 1) {
    const line = lines[0]!;
    return `1x ${formatMoneyBr(line.amount)} em ${formatDateBr(line.dueDate)}`;
  }

  const parts = lines.map(
    (line) => `${formatDateBr(line.dueDate)} ${formatMoneyBr(line.amount)}`
  );
  return `${lines.length}x: ${parts.join("; ")}`;
}

function detectCashPayment(
  input: SalesOrderListPaymentResolveInput,
  lines: SalesOrderListPaymentLine[]
): boolean {
  if (termsIndicateCash(input.paymentTerms)) return true;
  if (lines.length !== 1) return false;
  const line = lines[0]!;
  if (!line.dueDate) return false;
  return daysBetween(line.dueDate, input.issueDate) <= 0;
}

function buildReceivableLines(
  receivables: SalesOrderListReceivableInput[],
  referenceDate: Date
): SalesOrderListPaymentLine[] {
  const unique = new Map<number, SalesOrderListReceivableInput>();
  for (const row of receivables) {
    if (!unique.has(row.externalId)) unique.set(row.externalId, row);
  }
  const sorted = [...unique.values()].sort((a, b) => {
    const da = a.dueDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const db = b.dueDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return da - db;
  });

  return sorted.map((row, index) => {
    const status = classifyReceivableStatus(row, referenceDate);
    return {
      installmentNumber: index + 1,
      dueDate: row.dueDate,
      amount: roundMoney(row.amountReceivable),
      statusLabel: formatFinanceCalculatedStatus(status),
      settlementDate: row.settlementDate,
      amountReceived: roundMoney(row.amountReceived),
      openBalance: roundMoney(row.balanceReceivable),
      nomusReceivableId: row.externalId,
      nfeDocument: row.sourceInvoiceNumber?.trim() || null,
    };
  });
}

function buildForecastLines(
  installments: SalesOrderListForecastInstallment[]
): SalesOrderListPaymentLine[] {
  return installments.map((inst) => ({
    installmentNumber: inst.installmentNumber,
    dueDate: inst.dueDate,
    amount: inst.expectedAmount,
    statusLabel: null,
    settlementDate: null,
    amountReceived: null,
    openBalance: null,
    nomusReceivableId: null,
    nfeDocument: null,
  }));
}

function hasMeaningfulForecast(installments: SalesOrderListForecastInstallment[]): boolean {
  return installments.length > 0;
}

export function resolveSalesOrderListPaymentSummary(
  input: SalesOrderListPaymentResolveInput
): SalesOrderListPaymentSummary {
  const referenceDate = input.referenceDate ?? new Date();
  const termsLabel = paymentTermsText(input);

  const receivableCandidates = input.receivables.filter(
    (row) => row.amountReceivable > 0 || row.balanceReceivable > 0
  );

  let paymentSourceLabel = SALES_ORDER_PAYMENT_NOT_INFORMED;
  let lines: SalesOrderListPaymentLine[] = [];

  if (receivableCandidates.length > 0) {
    paymentSourceLabel = SALES_ORDER_PAYMENT_SOURCE_AR;
    lines = buildReceivableLines(receivableCandidates, referenceDate);
  } else {
    const forecast = extractSalesOrderForecastInstallments(
      input.nomusRawResponse,
      input.totalNetValue,
      input.issueDate
    );
    if (hasMeaningfulForecast(forecast)) {
      paymentSourceLabel = SALES_ORDER_PAYMENT_SOURCE_FORECAST;
      lines = buildForecastLines(forecast);
    } else if (termsIndicateCash(input.paymentTerms)) {
      lines = [
        {
          installmentNumber: 1,
          dueDate: input.issueDate,
          amount: roundMoney(input.totalNetValue),
          statusLabel: null,
          settlementDate: null,
          amountReceived: null,
          openBalance: null,
          nomusReceivableId: null,
          nfeDocument: null,
        },
      ];
      paymentSourceLabel = SALES_ORDER_PAYMENT_SOURCE_FORECAST;
    }
  }

  lines = sortLines(lines);
  const isCashPayment = detectCashPayment(input, lines);
  const scheduleText = formatSalesOrderListPaymentScheduleText(lines, { isCashPayment });
  const { firstDueDate, lastDueDate } = dueRange(lines);
  const totalTitlesAmount =
    lines.length > 0 ? roundMoney(lines.reduce((sum, line) => sum + line.amount, 0)) : null;

  let paymentConditionLabel = termsLabel ?? SALES_ORDER_PAYMENT_NOT_INFORMED;
  if (isCashPayment) {
    paymentConditionLabel = termsLabel ?? SALES_ORDER_PAYMENT_CASH_LABEL;
  } else if (!termsLabel && lines.length === 1 && paymentSourceLabel !== SALES_ORDER_PAYMENT_NOT_INFORMED) {
    paymentConditionLabel = "Parcela única";
  }

  return {
    paymentConditionLabel,
    paymentSourceLabel,
    installmentCount: lines.length,
    isCashPayment,
    firstDueDate,
    lastDueDate,
    scheduleText,
    totalTitlesAmount,
    financialStatusLabel: aggregateFinancialStatus(lines),
    lines,
  };
}

export type SalesOrderListPaymentOpeningRow = {
  orderCode: string;
  customerName: string;
  sellerName: string;
  nfeDocument: string;
  paymentSourceLabel: string;
  installmentNumber: number;
  dueDate: string;
  amount: number;
  statusLabel: string;
  settlementDate: string;
  amountReceived: number | "";
  openBalance: number | "";
};

export function buildSalesOrderListPaymentOpeningRows(input: {
  orderCode: string;
  customerName: string;
  sellerName: string;
  nfeDocument: string;
  payment: SalesOrderListPaymentSummary;
}): SalesOrderListPaymentOpeningRow[] {
  if (input.payment.lines.length === 0) {
    return [
      {
        orderCode: input.orderCode,
        customerName: input.customerName,
        sellerName: input.sellerName,
        nfeDocument: input.nfeDocument,
        paymentSourceLabel: input.payment.paymentSourceLabel,
        installmentNumber: 0,
        dueDate: "",
        amount: 0,
        statusLabel: SALES_ORDER_PAYMENT_NOT_INFORMED,
        settlementDate: "",
        amountReceived: "",
        openBalance: "",
      },
    ];
  }

  return input.payment.lines.map((line) => ({
    orderCode: input.orderCode,
    customerName: input.customerName,
    sellerName: input.sellerName,
    nfeDocument: line.nfeDocument || input.nfeDocument,
    paymentSourceLabel: input.payment.paymentSourceLabel,
    installmentNumber: line.installmentNumber,
    dueDate: formatDateBr(line.dueDate),
    amount: line.amount,
    statusLabel: line.statusLabel ?? "—",
    settlementDate: formatDateBr(line.settlementDate),
    amountReceived: line.amountReceived ?? "",
    openBalance: line.openBalance ?? "",
  }));
}

export function buildSalesOrderListPaymentReportSummary(input: {
  payments: SalesOrderListPaymentSummary[];
}): {
  cashOrdersCount: number;
  installmentOrdersCount: number;
  noPaymentInfoCount: number;
  withRealTitlesCount: number;
  withForecastOnlyCount: number;
  reportFirstDueDate: Date | null;
  reportLastDueDate: Date | null;
  totalTitlesAmount: number;
} {
  let cashOrdersCount = 0;
  let installmentOrdersCount = 0;
  let noPaymentInfoCount = 0;
  let withRealTitlesCount = 0;
  let withForecastOnlyCount = 0;
  let totalTitlesAmount = 0;
  const allDueDates: Date[] = [];

  for (const payment of input.payments) {
    if (payment.paymentSourceLabel === SALES_ORDER_PAYMENT_SOURCE_AR) withRealTitlesCount += 1;
    if (payment.paymentSourceLabel === SALES_ORDER_PAYMENT_SOURCE_FORECAST) withForecastOnlyCount += 1;
    if (payment.scheduleText === SALES_ORDER_PAYMENT_NOT_INFORMED) noPaymentInfoCount += 1;
    else if (payment.isCashPayment) cashOrdersCount += 1;
    else if (payment.installmentCount > 1) installmentOrdersCount += 1;

    if (payment.totalTitlesAmount != null) totalTitlesAmount += payment.totalTitlesAmount;
    if (payment.firstDueDate) allDueDates.push(payment.firstDueDate);
    if (payment.lastDueDate) allDueDates.push(payment.lastDueDate);
  }

  allDueDates.sort((a, b) => a.getTime() - b.getTime());

  return {
    cashOrdersCount,
    installmentOrdersCount,
    noPaymentInfoCount,
    withRealTitlesCount,
    withForecastOnlyCount,
    reportFirstDueDate: allDueDates[0] ?? null,
    reportLastDueDate: allDueDates.length > 0 ? allDueDates[allDueDates.length - 1]! : null,
    totalTitlesAmount: roundMoney(totalTitlesAmount),
  };
}
