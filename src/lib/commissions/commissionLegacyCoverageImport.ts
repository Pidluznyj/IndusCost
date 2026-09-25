/**
 * Importação da cobertura legada do Nomus (relatório de comissão até o cutover).
 * Parte pura: leitura tolerante do arquivo (XLSX/CSV já convertido em matriz) e
 * associação linha → título (CR) → eventos de recebimento.
 *
 * Ordem de confiabilidade: id do recebimento (se o arquivo trouxer) > CR explícito >
 * NF + valor (+ cliente). Com vários recebimentos no título, só associa quando o
 * valor determina o(s) evento(s); caso contrário AMBIGUOUS — nunca escolhe no chute.
 */
import { roundMoney } from "./commission-money.shared.js";
import {
  COMMISSION_OFFICIAL_CUTOVER_DATE,
  formatCommissionYearMonthLabel,
  resolveReceiptNaturalYearMonth,
  type CommissionYearMonth,
} from "./commissionCoverageCutover.js";
import type { CommissionCoverageAssociationMethod } from "./commissionReceiptCoverage.shared.js";

export type LegacyCoverageField =
  | "receivableExternalId"
  | "receiptExternalId"
  | "nfeNumber"
  | "customerName"
  | "amount"
  | "commissionAmount"
  | "competence"
  | "sellerName"
  | "installmentNumber"
  | "date";

/** Sinônimos de cabeçalho (normalizados: minúsculo, sem acento, só letras/números). */
export const LEGACY_COVERAGE_HEADER_SYNONYMS: Record<LegacyCoverageField, string[]> = {
  receivableExternalId: [
    "cr",
    "id cr",
    "conta a receber",
    "codigo da conta a receber",
    "cod conta a receber",
    "id conta a receber",
    "id conta receber",
    "conta receber",
    "titulo",
    "id titulo",
  ],
  receiptExternalId: ["id recebimento", "recebimento id", "codigo recebimento", "id do recebimento"],
  nfeNumber: ["nf", "nfe", "nf e", "nota", "nota fiscal", "numero nf", "numero da nf", "n nf", "documento"],
  customerName: ["cliente", "razao social", "nome do cliente", "pessoa"],
  amount: [
    "valor",
    "valor duplicata",
    "valor da duplicata",
    "valor recebido",
    "valor do titulo",
    "valor titulo",
    "valor base",
    "base",
  ],
  commissionAmount: ["comissao", "comissao calculada", "valor comissao", "valor da comissao", "comissao r"],
  competence: ["competencia", "mes", "periodo", "mes referencia", "referencia"],
  sellerName: ["vendedor", "representante", "vendedor responsavel"],
  installmentNumber: ["parcela", "numero parcela", "n parcela"],
  date: ["data", "data recebimento", "data de recebimento", "recebido em", "data pagamento", "data baixa"],
};

export function normalizeLegacyHeader(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Mapa campo → índice da coluna a partir da linha de cabeçalho. */
export function resolveLegacyCoverageHeaders(headerRow: readonly unknown[]): Partial<Record<LegacyCoverageField, number>> {
  const normalized = headerRow.map(normalizeLegacyHeader);
  const map: Partial<Record<LegacyCoverageField, number>> = {};
  for (const [field, synonyms] of Object.entries(LEGACY_COVERAGE_HEADER_SYNONYMS) as Array<
    [LegacyCoverageField, string[]]
  >) {
    const index = normalized.findIndex((header) => synonyms.includes(header));
    if (index >= 0) map[field] = index;
  }
  return map;
}

/** "R$ 1.234,56" / "1234,56" / "1,234.56" / 1234.56 → número (null se vazio/inválido). */
export function parseLegacyMoney(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? roundMoney(value) : null;
  let text = String(value ?? "").trim();
  if (!text) return null;
  const negative = /^-|\(.*\)$/.test(text);
  text = text.replace(/[^0-9.,]/g, "");
  if (!text) return null;
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  if (lastComma > lastDot) {
    text = text.replace(/\./g, "").replace(",", ".");
  } else if (lastDot > lastComma && lastComma >= 0) {
    text = text.replace(/,/g, "");
  } else if (lastComma >= 0 && lastDot < 0) {
    text = text.replace(",", ".");
  }
  const n = Number(text);
  if (!Number.isFinite(n)) return null;
  return roundMoney(negative ? -n : n);
}

function parseInteger(value: unknown): number | null {
  if (typeof value === "number") return Number.isInteger(value) && value > 0 ? value : null;
  const text = String(value ?? "").trim().replace(/\.0+$/, "");
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Data em dd/mm/aaaa, aaaa-mm-dd ou serial do Excel → `YYYY-MM-DD`. */
export function parseLegacyDate(value: unknown): string | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number" && value > 20000 && value < 80000) {
    const ms = Date.UTC(1899, 11, 30) + Math.round(value) * 86400000;
    return new Date(ms).toISOString().slice(0, 10);
  }
  const text = String(value ?? "").trim();
  let match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(text);
  if (match) return `${match[3]}-${match[2]!.padStart(2, "0")}-${match[1]!.padStart(2, "0")}`;
  match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  return null;
}

/** "09/2026", "2026-09", "set/2026" → competência. */
export function parseLegacyCompetence(value: unknown): CommissionYearMonth | null {
  const text = normalizeLegacyHeader(value);
  let match = /^(\d{1,2}) (\d{4})$/.exec(text);
  if (match) return { year: Number(match[2]), month: Number(match[1]) };
  match = /^(\d{4}) (\d{1,2})$/.exec(text);
  if (match) return { year: Number(match[1]), month: Number(match[2]) };
  const months = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  match = /^([a-z]{3})[a-z]* (\d{4})$/.exec(text);
  if (match) {
    const index = months.indexOf(match[1]!);
    if (index >= 0) return { year: Number(match[2]), month: index + 1 };
  }
  return null;
}

export type LegacyCoverageImportRow = {
  /** Linha no arquivo (1 = primeira linha da planilha). */
  rowNumber: number;
  receivableExternalId: number | null;
  receiptExternalId: number | null;
  nfeNumber: string | null;
  customerName: string | null;
  amount: number | null;
  commissionAmount: number | null;
  competence: CommissionYearMonth | null;
  sellerName: string | null;
  installmentNumber: number | null;
  date: string | null;
};

export type LegacyCoverageParseResult = {
  headerRowNumber: number | null;
  headers: Partial<Record<LegacyCoverageField, number>>;
  rows: LegacyCoverageImportRow[];
  errors: string[];
};

/**
 * Matriz (linhas × colunas) → linhas de cobertura. Procura o cabeçalho nas 30
 * primeiras linhas: exige (CR ou NF) e Valor. Linhas totalmente vazias são ignoradas.
 */
export function parseLegacyCoverageMatrix(matrix: readonly (readonly unknown[])[]): LegacyCoverageParseResult {
  let headerIndex = -1;
  let headers: Partial<Record<LegacyCoverageField, number>> = {};
  for (let i = 0; i < Math.min(matrix.length, 30); i += 1) {
    const candidate = resolveLegacyCoverageHeaders(matrix[i] ?? []);
    const hasKey = candidate.receivableExternalId != null || candidate.nfeNumber != null;
    if (hasKey && candidate.amount != null) {
      headerIndex = i;
      headers = candidate;
      break;
    }
  }
  if (headerIndex < 0) {
    return {
      headerRowNumber: null,
      headers: {},
      rows: [],
      errors: ["Cabeçalho não encontrado: o arquivo precisa ter as colunas CR (ou NF) e Valor."],
    };
  }
  const cell = (row: readonly unknown[], field: LegacyCoverageField) =>
    headers[field] != null ? row[headers[field]!] : undefined;
  const text = (value: unknown) => {
    const t = String(value ?? "").trim();
    return t ? t : null;
  };
  const rows: LegacyCoverageImportRow[] = [];
  for (let i = headerIndex + 1; i < matrix.length; i += 1) {
    const row = matrix[i] ?? [];
    if (row.every((value) => String(value ?? "").trim() === "")) continue;
    rows.push({
      rowNumber: i + 1,
      receivableExternalId: parseInteger(cell(row, "receivableExternalId")),
      receiptExternalId: parseInteger(cell(row, "receiptExternalId")),
      nfeNumber: text(cell(row, "nfeNumber")),
      customerName: text(cell(row, "customerName")),
      amount: parseLegacyMoney(cell(row, "amount")),
      commissionAmount: parseLegacyMoney(cell(row, "commissionAmount")),
      competence: parseLegacyCompetence(cell(row, "competence")),
      sellerName: text(cell(row, "sellerName")),
      installmentNumber: parseInteger(cell(row, "installmentNumber")),
      date: parseLegacyDate(cell(row, "date")),
    });
  }
  return { headerRowNumber: headerIndex + 1, headers, rows, errors: [] };
}

export type LegacyMatchReceivable = {
  externalId: number;
  sourceInvoiceNumber: string | null;
  personName: string | null;
  amountReceivable: number | null;
};

export type LegacyMatchReceipt = {
  externalId: number;
  receivableExternalId: number;
  /** `YYYY-MM-DD`. */
  receiptDate: string;
  receivedAmount: number;
};

export type LegacyCoverageRowStatus =
  | "MATCHED"
  | "ALREADY_COVERED"
  | "AMBIGUOUS"
  | "UNMATCHED"
  | "INVALID";

export type LegacyCoverageRowResult = {
  rowNumber: number;
  status: LegacyCoverageRowStatus;
  receivableExternalId: number | null;
  /** Eventos novos a cobrir por esta linha. */
  receiptExternalIds: number[];
  /** Eventos que já tinham cobertura COVERED (reimportação idempotente). */
  alreadyCoveredReceiptIds: number[];
  associationMethod: CommissionCoverageAssociationMethod | null;
  message: string;
  input: {
    cr: number | null;
    nf: string | null;
    customer: string | null;
    amount: number | null;
    commission: number | null;
  };
};

const MONEY_TOLERANCE = 0.01;

function sameMoney(a: number | null | undefined, b: number | null | undefined): boolean {
  return a != null && b != null && Math.abs(a - b) <= MONEY_TOLERANCE;
}

export function normalizeLegacyNfeNumber(value: string | null | undefined): string | null {
  const digits = String(value ?? "").replace(/\D/g, "").replace(/^0+/, "");
  return digits || null;
}

function sameCustomer(a: string | null, b: string | null): boolean {
  if (!a || !b) return true;
  const x = normalizeLegacyHeader(a);
  const y = normalizeLegacyHeader(b);
  return x === y || x.includes(y) || y.includes(x);
}

function sum(receipts: readonly LegacyMatchReceipt[]): number {
  return roundMoney(receipts.reduce((total, receipt) => total + receipt.receivedAmount, 0));
}

function lastDayKey(value: CommissionYearMonth): string {
  const day = new Date(Date.UTC(value.year, value.month, 0)).getUTCDate();
  return `${String(value.year).padStart(4, "0")}-${String(value.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Associa UMA linha do relatório. `claimedReceiptIds` evita que duas linhas do mesmo
 * arquivo cubram o mesmo evento; `coveredReceiptIds` torna a reimportação idempotente.
 */
export function matchLegacyCoverageRow(input: {
  row: LegacyCoverageImportRow;
  reference: CommissionYearMonth;
  receivablesById: ReadonlyMap<number, LegacyMatchReceivable>;
  receivablesByNfe: ReadonlyMap<string, readonly LegacyMatchReceivable[]>;
  receiptsByReceivable: ReadonlyMap<number, readonly LegacyMatchReceipt[]>;
  coveredReceiptIds: ReadonlySet<number>;
  claimedReceiptIds: ReadonlySet<number>;
}): LegacyCoverageRowResult {
  const { row } = input;
  const base = {
    rowNumber: row.rowNumber,
    receivableExternalId: null as number | null,
    receiptExternalIds: [] as number[],
    alreadyCoveredReceiptIds: [] as number[],
    associationMethod: null as CommissionCoverageAssociationMethod | null,
    input: {
      cr: row.receivableExternalId,
      nf: row.nfeNumber,
      customer: row.customerName,
      amount: row.amount,
      commission: row.commissionAmount,
    },
  };
  const result = (
    status: LegacyCoverageRowStatus,
    message: string,
    extra: Partial<typeof base> = {}
  ): LegacyCoverageRowResult => ({ ...base, ...extra, status, message });

  if (row.receivableExternalId == null && !row.nfeNumber && row.receiptExternalId == null) {
    return result("INVALID", "Linha sem CR, NF ou id de recebimento.");
  }

  // 1) Título.
  let receivable: LegacyMatchReceivable | null = null;
  let method: CommissionCoverageAssociationMethod = "RECEIVABLE_ID";
  if (row.receivableExternalId != null) {
    receivable = input.receivablesById.get(row.receivableExternalId) ?? null;
    if (!receivable) {
      return result("UNMATCHED", `CR ${row.receivableExternalId} não encontrado no Contas a Receber.`);
    }
  } else if (row.nfeNumber) {
    const nf = normalizeLegacyNfeNumber(row.nfeNumber);
    const byNf = nf ? input.receivablesByNfe.get(nf) ?? [] : [];
    const compatible = byNf.filter((candidate) => {
      if (!sameCustomer(candidate.personName, row.customerName)) return false;
      if (row.amount == null) return true;
      if (sameMoney(candidate.amountReceivable, row.amount)) return true;
      return (input.receiptsByReceivable.get(candidate.externalId) ?? []).some((receipt) =>
        sameMoney(receipt.receivedAmount, row.amount)
      );
    });
    if (compatible.length === 0) {
      return result("UNMATCHED", `Nenhum título da NF ${row.nfeNumber} compatível com valor/cliente.`);
    }
    if (compatible.length > 1) {
      return result(
        "AMBIGUOUS",
        `NF ${row.nfeNumber}: ${compatible.length} títulos compatíveis — informe o CR no arquivo.`
      );
    }
    receivable = compatible[0]!;
    method = "RECEIVABLE_AMOUNT_DATE";
  }

  // 2) Eventos elegíveis: recebidos até o fim da competência do relatório e antes do cutover.
  const limit = lastDayKey(input.reference);
  const allReceipts = receivable ? input.receiptsByReceivable.get(receivable.externalId) ?? [] : [];
  const eligible = allReceipts.filter(
    (receipt) => receipt.receiptDate <= limit && receipt.receiptDate < COMMISSION_OFFICIAL_CUTOVER_DATE
  );
  const receivableId = receivable?.externalId ?? null;
  if (row.receiptExternalId != null) {
    const found = allReceipts.find((receipt) => receipt.externalId === row.receiptExternalId);
    if (!found || !eligible.includes(found)) {
      return result(
        "UNMATCHED",
        `Recebimento ${row.receiptExternalId} não encontrado para o título até ${formatCommissionYearMonthLabel(input.reference)} (ou posterior ao cutover).`,
        { receivableExternalId: receivableId }
      );
    }
    return finalize([found], "RECEIPT_ID");
  }
  if (eligible.length === 0) {
    const onlyPost = allReceipts.length > 0;
    return result(
      "UNMATCHED",
      onlyPost
        ? `Título ${receivableId} sem recebimento até ${formatCommissionYearMonthLabel(input.reference)} antes do cutover.`
        : `Título ${receivableId} sem recebimento registrado.`,
      { receivableExternalId: receivableId }
    );
  }

  const available = eligible.filter((receipt) => !input.claimedReceiptIds.has(receipt.externalId));
  if (available.length === 0) {
    return result("AMBIGUOUS", "Todos os recebimentos do título já foram associados a outra linha do arquivo.", {
      receivableExternalId: receivableId,
    });
  }
  if (available.length === 1) return finalize(available, method);

  // Vários eventos: só com determinação pelo valor.
  if (row.amount != null) {
    const exact = available.filter((receipt) => sameMoney(receipt.receivedAmount, row.amount));
    if (exact.length === 1) return finalize(exact, "RECEIVABLE_AMOUNT_DATE");
    const inReference = available.filter((receipt) => {
      const natural = resolveReceiptNaturalYearMonth(receipt.receiptDate);
      return natural?.year === input.reference.year && natural?.month === input.reference.month;
    });
    if (inReference.length > 0 && sameMoney(sum(inReference), row.amount)) {
      return finalize(inReference, "RECEIVABLE_AMOUNT_DATE");
    }
    if (sameMoney(sum(available), row.amount)) return finalize(available, "RECEIVABLE_AMOUNT_DATE");
  }
  return result(
    "AMBIGUOUS",
    `Título ${receivableId} com ${available.length} recebimentos e valor que não determina quais — não coberto automaticamente.`,
    { receivableExternalId: receivableId }
  );

  function finalize(
    receipts: readonly LegacyMatchReceipt[],
    association: CommissionCoverageAssociationMethod
  ): LegacyCoverageRowResult {
    const fresh = receipts.filter((receipt) => !input.coveredReceiptIds.has(receipt.externalId));
    const covered = receipts.filter((receipt) => input.coveredReceiptIds.has(receipt.externalId));
    if (fresh.length === 0) {
      return result("ALREADY_COVERED", "Recebimento(s) já cobertos — reimportação sem efeito.", {
        receivableExternalId: receivableId,
        alreadyCoveredReceiptIds: covered.map((receipt) => receipt.externalId),
        associationMethod: association,
      });
    }
    return result(
      "MATCHED",
      covered.length > 0
        ? `${fresh.length} recebimento(s) associado(s); ${covered.length} já coberto(s).`
        : `${fresh.length} recebimento(s) associado(s).`,
      {
        receivableExternalId: receivableId,
        receiptExternalIds: fresh.map((receipt) => receipt.externalId).sort((a, b) => a - b),
        alreadyCoveredReceiptIds: covered.map((receipt) => receipt.externalId),
        associationMethod: association,
      }
    );
  }
}

export type LegacyCoverageRowToCreate = {
  receiptExternalId: number;
  receivableExternalId: number;
  naturalReceiptDate: string;
  naturalYear: number;
  naturalMonth: number;
  coveredYear: number;
  coveredMonth: number;
  legacyReference: string;
  coveredReceivedAmount: number;
  coveredCommissionAmount: number | null;
  associationMethod: CommissionCoverageAssociationMethod;
  notes: string;
};

/** Cobertura NOMUS_LEGACY por evento; comissão da linha rateada pelo valor recebido. */
export function buildLegacyCoverageRowsToCreate(input: {
  results: readonly LegacyCoverageRowResult[];
  receiptsById: ReadonlyMap<number, LegacyMatchReceipt>;
  reference: CommissionYearMonth;
  filename: string;
}): LegacyCoverageRowToCreate[] {
  const out: LegacyCoverageRowToCreate[] = [];
  for (const result of input.results) {
    if (result.status !== "MATCHED" || result.receivableExternalId == null) continue;
    const receipts = result.receiptExternalIds
      .map((id) => input.receiptsById.get(id))
      .filter((receipt): receipt is LegacyMatchReceipt => receipt != null);
    const total = sum(receipts);
    let allocated = 0;
    receipts.forEach((receipt, index) => {
      const natural = resolveReceiptNaturalYearMonth(receipt.receiptDate);
      if (!natural) return;
      const commission = result.input.commission;
      let share: number | null = null;
      if (commission != null) {
        share =
          index === receipts.length - 1
            ? roundMoney(commission - allocated)
            : total > 0
              ? roundMoney((commission * receipt.receivedAmount) / total)
              : 0;
        allocated = roundMoney(allocated + share);
      }
      out.push({
        receiptExternalId: receipt.externalId,
        receivableExternalId: result.receivableExternalId!,
        naturalReceiptDate: receipt.receiptDate,
        naturalYear: natural.year,
        naturalMonth: natural.month,
        coveredYear: input.reference.year,
        coveredMonth: input.reference.month,
        legacyReference: `${input.filename}#L${result.rowNumber}`,
        coveredReceivedAmount: receipt.receivedAmount,
        coveredCommissionAmount: share,
        associationMethod: result.associationMethod ?? "RECEIVABLE_ID",
        notes: `Relatório Nomus ${formatCommissionYearMonthLabel(input.reference)} — ${result.message}`,
      });
    });
  }
  return out.sort((a, b) => a.receiptExternalId - b.receiptExternalId);
}

export type LegacyCoverageImportCounts = {
  rowCount: number;
  matchedCount: number;
  unmatchedCount: number;
  ambiguousCount: number;
  alreadyCoveredCount: number;
  invalidCount: number;
};

export function countLegacyCoverageResults(results: readonly LegacyCoverageRowResult[]): LegacyCoverageImportCounts {
  const counts: LegacyCoverageImportCounts = {
    rowCount: results.length,
    matchedCount: 0,
    unmatchedCount: 0,
    ambiguousCount: 0,
    alreadyCoveredCount: 0,
    invalidCount: 0,
  };
  for (const result of results) {
    if (result.status === "MATCHED") counts.matchedCount += 1;
    else if (result.status === "UNMATCHED") counts.unmatchedCount += 1;
    else if (result.status === "AMBIGUOUS") counts.ambiguousCount += 1;
    else if (result.status === "ALREADY_COVERED") counts.alreadyCoveredCount += 1;
    else counts.invalidCount += 1;
  }
  return counts;
}
