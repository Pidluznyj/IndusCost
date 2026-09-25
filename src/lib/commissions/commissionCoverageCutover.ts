/**
 * Cutover oficial da comissão Nomus → IndusCost e janela de reconciliação legada.
 * ÚNICO lugar com essas datas — nenhum outro módulo deve hardcodar o corte.
 *
 *   até 30/09/2026 → fonte oficial histórica = Nomus
 *   a partir de 01/10/2026 → fonte oficial = IndusCost
 *
 * Competência natural continua sendo `NomusReceivableReceipt.receiptDate` (dia civil).
 * Módulo puro (sem Prisma/rede), seguro para frontend; comparações por DIA CIVIL.
 */
import { toCivilDateKey } from "../financeCivilDate.js";

/** Primeiro dia em que o IndusCost é a fonte oficial de fechamento de comissão. */
export const COMMISSION_OFFICIAL_CUTOVER_DATE = "2026-10-01";

/**
 * Início da janela de reconciliação legada: recebimentos antes desta data nunca
 * viram pendência automática (histórico do Nomus). Ago/set de 2026 são verificados
 * contra a cobertura importada do Nomus para capturar limbos da transição.
 */
export const COMMISSION_LEGACY_RECONCILIATION_START_DATE = "2026-08-01";

export type CommissionReceiptCutoverPeriod =
  | "LEGACY_OUTSIDE_RECONCILIATION_WINDOW"
  | "LEGACY_RECONCILIATION_WINDOW"
  | "POST_CUTOVER";

export type CommissionYearMonth = { year: number; month: number };

function yearMonthOf(civilKey: string): CommissionYearMonth {
  return { year: Number(civilKey.slice(0, 4)), month: Number(civilKey.slice(5, 7)) };
}

/** Competência (ano/mês) em que o IndusCost passa a ser a fonte oficial. */
export const COMMISSION_OFFICIAL_CUTOVER_YEAR_MONTH: CommissionYearMonth = yearMonthOf(
  COMMISSION_OFFICIAL_CUTOVER_DATE
);

/** Primeira competência (ano/mês) da janela de reconciliação legada. */
export const COMMISSION_LEGACY_RECONCILIATION_START_YEAR_MONTH: CommissionYearMonth = yearMonthOf(
  COMMISSION_LEGACY_RECONCILIATION_START_DATE
);

/** Chave comparável `YYYY-MM`. */
export function formatCommissionYearMonthKey(value: CommissionYearMonth): string {
  return `${String(value.year).padStart(4, "0")}-${String(value.month).padStart(2, "0")}`;
}

/** `MM/AAAA` para telas e relatórios. */
export function formatCommissionYearMonthLabel(value: CommissionYearMonth): string {
  return `${String(value.month).padStart(2, "0")}/${value.year}`;
}

export function compareCommissionYearMonth(a: CommissionYearMonth, b: CommissionYearMonth): number {
  return a.year === b.year ? a.month - b.month : a.year - b.year;
}

/** Competência natural (ano/mês) de um recebimento pelo dia civil. */
export function resolveReceiptNaturalYearMonth(
  receiptDate: Date | string | null | undefined
): CommissionYearMonth | null {
  const key = toCivilDateKey(receiptDate);
  return key ? yearMonthOf(key) : null;
}

/** Recebimento antes do cutover (Nomus é a fonte oficial da sua competência)? */
export function isReceiptBeforeCommissionCutover(
  receiptDate: Date | string | null | undefined
): boolean {
  const key = toCivilDateKey(receiptDate);
  return key != null && key < COMMISSION_OFFICIAL_CUTOVER_DATE;
}

/**
 * Em que regime o recebimento está:
 *   - antes de 01/08/2026 → histórico fora da janela (nunca pendência automática);
 *   - 01/08/2026 a 30/09/2026 → janela de reconciliação (verificar cobertura Nomus);
 *   - a partir de 01/10/2026 → IndusCost controla integralmente.
 * Data inválida é tratada como fora da janela (conservador: não vira pendência).
 */
export function resolveReceiptCutoverPeriod(
  receiptDate: Date | string | null | undefined
): CommissionReceiptCutoverPeriod {
  const key = toCivilDateKey(receiptDate);
  if (!key || key < COMMISSION_LEGACY_RECONCILIATION_START_DATE) {
    return "LEGACY_OUTSIDE_RECONCILIATION_WINDOW";
  }
  if (key < COMMISSION_OFFICIAL_CUTOVER_DATE) return "LEGACY_RECONCILIATION_WINDOW";
  return "POST_CUTOVER";
}

/** Fechamento oficial no IndusCost só existe a partir da competência do cutover. */
export function isCompetenceOfficialInIndusCost(year: number, month: number): boolean {
  return compareCommissionYearMonth({ year, month }, COMMISSION_OFFICIAL_CUTOVER_YEAR_MONTH) >= 0;
}

const MONTH_NAMES_PT = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

/** "outubro/2026". */
export function formatCommissionYearMonthLongLabel(value: CommissionYearMonth): string {
  return `${MONTH_NAMES_PT[value.month - 1] ?? String(value.month)}/${value.year}`;
}

/** Último dia em que o Nomus é a fonte oficial ("30/09/2026"). */
export const COMMISSION_LAST_NOMUS_OFFICIAL_DAY_LABEL = new Date(
  Date.parse(`${COMMISSION_OFFICIAL_CUTOVER_DATE}T00:00:00.000Z`) - 86_400_000
)
  .toISOString()
  .slice(0, 10)
  .split("-")
  .reverse()
  .join("/");

/** "01/10/2026". */
export const COMMISSION_OFFICIAL_CUTOVER_DAY_LABEL = COMMISSION_OFFICIAL_CUTOVER_DATE.split("-")
  .reverse()
  .join("/");

/**
 * Código determinístico do bloqueio de fechamento, pagamento ou reprocesso oficial
 * de competência anterior ao cutover (histórico oficial do Nomus).
 */
export const COMMISSION_PERIOD_BEFORE_INDUSCOST_CUTOVER = "COMMISSION_PERIOD_BEFORE_INDUSCOST_CUTOVER";

/** Data (dia civil) em que o IndusCost já é a fonte oficial (>= cutover)? Inválida = não. */
export function isCommissionDateOfficialInIndusCost(value: Date | string | null | undefined): boolean {
  const key = toCivilDateKey(value);
  return key != null && key >= COMMISSION_OFFICIAL_CUTOVER_DATE;
}

/** Mensagem única do bloqueio de pagamento de período anterior ao cutover. */
export const COMMISSION_PRE_CUTOVER_PAYMENT_BLOCKED_REASON =
  "Este período pertence ao histórico oficial do Nomus. Pagamentos de comissão pelo IndusCost valem a partir de " +
  `${formatCommissionYearMonthLongLabel(COMMISSION_OFFICIAL_CUTOVER_YEAR_MONTH)}.`;

/** Mensagem única do bloqueio de fechamento antes do cutover. */
export const COMMISSION_PRE_CUTOVER_CLOSING_BLOCKED_REASON =
  "Este período pertence ao histórico oficial do Nomus. O IndusCost passou a ser a fonte oficial de " +
  `fechamento em ${formatCommissionYearMonthLongLabel(COMMISSION_OFFICIAL_CUTOVER_YEAR_MONTH)}.`;

/* ------------------------------------------------------------------ */
/*  Autoridade dos relatórios: documento oficial × espelho técnico     */
/* ------------------------------------------------------------------ */

/** Quem emite o relatório OFICIAL de comissão da competência. */
export type CommissionReportingSource = "NOMUS" | "INDUSCOST";

/** O que o IndusCost produz para a competência. */
export type CommissionReportDocumentType = "LEGACY_TECHNICAL_MIRROR" | "INDUSCOST_OFFICIAL";

/**
 * Autoridade do relatório da competência. Não confundir com cobertura (quem PAGOU
 * um recebimento): um recebimento de 08/2026 pode estar coberto pelo Nomus em
 * 09/2026 e a reconstrução de agosto continua não oficial.
 */
export type CommissionReportingAuthority = {
  year: number;
  month: number;
  source: CommissionReportingSource;
  /** O IndusCost é a fonte oficial (fechamento, relatório e pagamento oficiais). */
  officialInIndusCost: boolean;
  /** Competência do histórico oficial do Nomus (antes do cutover). */
  isLegacyPeriod: boolean;
  /** Início oficial do IndusCost (`YYYY-MM-DD`). */
  cutoverDate: string;
  documentType: CommissionReportDocumentType;
};

/**
 * Fonte oficial do relatório de comissão da competência — ÚNICO ponto de decisão
 * para telas, exportações e bloqueios. Competência inválida é tratada como
 * histórico (conservador: nunca vira documento oficial).
 */
export function getCommissionReportingAuthority(year: number, month: number): CommissionReportingAuthority {
  const valid = Number.isInteger(year) && Number.isInteger(month) && month >= 1 && month <= 12;
  const official = valid && isCompetenceOfficialInIndusCost(year, month);
  return {
    year,
    month,
    source: official ? "INDUSCOST" : "NOMUS",
    officialInIndusCost: official,
    isLegacyPeriod: !official,
    cutoverDate: COMMISSION_OFFICIAL_CUTOVER_DATE,
    documentType: official ? "INDUSCOST_OFFICIAL" : "LEGACY_TECHNICAL_MIRROR",
  };
}

/** Autoridade de um intervalo de competências (relatórios de vários meses). */
export type CommissionRangeReportingAuthority = {
  /** NOMUS / INDUSCOST quando o intervalo é de uma só fonte; MIXED quando cruza o cutover. */
  source: CommissionReportingSource | "MIXED";
  /** Só é documento oficial IndusCost quando TODAS as competências são >= cutover. */
  officialInIndusCost: boolean;
  includesLegacyPeriod: boolean;
  cutoverDate: string;
  documentType: CommissionReportDocumentType;
};

export function getCommissionReportingAuthorityForRange(
  from: CommissionYearMonth,
  to: CommissionYearMonth
): CommissionRangeReportingAuthority {
  const first = getCommissionReportingAuthority(from.year, from.month);
  const last = getCommissionReportingAuthority(to.year, to.month);
  const officialInIndusCost = first.officialInIndusCost && last.officialInIndusCost;
  return {
    source: officialInIndusCost ? "INDUSCOST" : last.officialInIndusCost ? "MIXED" : "NOMUS",
    officialInIndusCost,
    includesLegacyPeriod: first.isLegacyPeriod || last.isLegacyPeriod,
    cutoverDate: COMMISSION_OFFICIAL_CUTOVER_DATE,
    documentType: officialInIndusCost ? "INDUSCOST_OFFICIAL" : "LEGACY_TECHNICAL_MIRROR",
  };
}

/** Textos únicos dos avisos de período histórico (tela, exportação e impressão). */
export const COMMISSION_LEGACY_REPORT_TEXT = {
  bannerTitle: "HISTÓRICO PRÉ-INDUSCOST — NÃO OFICIAL",
  bannerBody:
    `Até ${COMMISSION_LAST_NOMUS_OFFICIAL_DAY_LABEL}, o relatório oficial de comissões era emitido pelo Nomus. ` +
    "Os valores apresentados nesta tela são uma reconstrução técnica do IndusCost para consulta e auditoria " +
    "e podem diferir do relatório oficial utilizado para pagamento.",
  officialSourceLine: "Fonte oficial deste período: Nomus",
  screenTitle: "Espelho técnico de comissões",
  screenSubtitle: "Reconstrução técnica — período Nomus",
  documentTitle: "ESPELHO TÉCNICO DE COMISSÕES — NÃO OFICIAL",
  documentMarker: "RELATÓRIO NÃO OFICIAL",
  pageMarker: "NÃO OFICIAL — PERÍODO NOMUS",
  sheetMarker: "Documento não oficial — fonte oficial: Nomus",
  documentTypeLabel: "ESPELHO TÉCNICO",
  officialSourceValue: "NOMUS",
  generatedBy: "INDUSCOST",
  fileNotice:
    `Este arquivo foi reconstruído pelo IndusCost para fins de consulta e auditoria. Até ${COMMISSION_LAST_NOMUS_OFFICIAL_DAY_LABEL}, ` +
    "os relatórios oficiais de comissão eram emitidos pelo Nomus. Os valores deste arquivo podem divergir do " +
    "relatório oficial utilizado para pagamento.",
  printNotice: "Reconstrução técnica gerada pelo IndusCost",
  printNotProof: "NÃO utilizar como comprovante oficial de comissão.",
  exportButton: "Exportar espelho técnico",
  printButton: "Imprimir espelho técnico",
  exportTooltip:
    "Este período possui o Nomus como fonte oficial. O arquivo gerado pelo IndusCost é apenas para consulta e auditoria.",
  confirmTitle: "TENHO CIÊNCIA",
  confirmBody: [
    "Este período é anterior ao início oficial dos fechamentos de comissão pelo IndusCost.",
    `Até ${COMMISSION_LAST_NOMUS_OFFICIAL_DAY_LABEL}, a fonte oficial era o Nomus.`,
    "O documento que será gerado é uma reconstrução técnica e NÃO substitui o relatório oficial do Nomus nem " +
      "deve ser utilizado como comprovante de pagamento de comissão.",
  ],
  confirmAction: "Entendi — exportar espelho técnico",
  sellerContext: "Consulta histórica — fonte oficial Nomus",
  reconstructedValue: "Valor reconstruído pelo IndusCost",
  officialValue: "Valor oficial IndusCost",
  reconstructedTag: "Reconstruído",
} as const;

/** Prefixo dos arquivos de espelho técnico (nunca parecem documento oficial). */
export const COMMISSION_TECHNICAL_MIRROR_FILE_PREFIX = "espelho-tecnico-comissoes";

/** Nome de arquivo do espelho técnico (nunca parece documento oficial). */
export function buildCommissionTechnicalMirrorFilename(
  year: number,
  month: number,
  extension: "xlsx" | "csv" | "pdf",
  suffix?: string | null
): string {
  const key = `${year}-${String(month).padStart(2, "0")}`;
  const extra = suffix ? `-${suffix}` : "";
  return `${COMMISSION_TECHNICAL_MIRROR_FILE_PREFIX}-${key}${extra}-induscost.${extension}`;
}

/** Meses civis de `from` até `to` (inclusive), em ordem. */
export function listCommissionYearMonths(
  from: CommissionYearMonth,
  to: CommissionYearMonth
): CommissionYearMonth[] {
  const out: CommissionYearMonth[] = [];
  let cursor = { ...from };
  while (compareCommissionYearMonth(cursor, to) <= 0) {
    out.push({ ...cursor });
    cursor = cursor.month === 12 ? { year: cursor.year + 1, month: 1 } : { year: cursor.year, month: cursor.month + 1 };
  }
  return out;
}

/** Competência imediatamente anterior. */
export function previousCommissionYearMonth(value: CommissionYearMonth): CommissionYearMonth {
  return value.month === 1 ? { year: value.year - 1, month: 12 } : { year: value.year, month: value.month - 1 };
}

/** Limites UTC [início, fim exclusivo) de uma data civil `YYYY-MM-DD` até outra. */
export function civilDateToUtcDate(civilKey: string): Date {
  return new Date(`${civilKey}T00:00:00.000Z`);
}

/** Primeiro dia (UTC, coluna DATE) da competência. */
export function firstDayOfCompetenceUtc(value: CommissionYearMonth): Date {
  return new Date(Date.UTC(value.year, value.month - 1, 1));
}
