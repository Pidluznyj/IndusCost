/**
 * Importação histórica (Google Forms) — parsing e mapeamento PUROS.
 *
 * Princípio: o importador não inventa dado. O que não vier no arquivo fica
 * ausente; o que vier ambíguo fica marcado para revisão humana. A data
 * histórica é preservada — jamais substituída pela data de execução do import.
 */

import crypto from "crypto";
import {
  isValidRating,
  normalizeCompanyNameKey,
  normalizeTaxIdDigits,
  SATISFACTION_RATING_LABELS,
  SATISFACTION_V1_OPEN_FEEDBACK_CODE,
  SATISFACTION_V1_RATING_CODES,
} from "./satisfactionContracts.js";

/** Coluna especial: instante original da submissão no Google Forms. */
export const IMPORT_TIMESTAMP_FIELD = "__TIMESTAMP__" as const;

/**
 * Padrões de cabeçalho → código de pergunta. Casamento por trecho
 * normalizado, tolerando variações de redação entre exportações.
 */
const HEADER_PATTERNS: ReadonlyArray<{ code: string; patterns: readonly string[] }> = [
  { code: IMPORT_TIMESTAMP_FIELD, patterns: ["carimbo de data", "timestamp", "data e hora"] },
  { code: "CUSTOMER_NAME", patterns: ["cliente", "nome da empresa", "empresa"] },
  { code: "TAX_ID", patterns: ["cnpj", "cpf", "cnpj/cpf"] },
  { code: "CONTACT_PHONE", patterns: ["telefone", "celular", "contato"] },
  { code: "SURVEY_DATE", patterns: ["data"] },
  { code: "RESPONDENT_NAME", patterns: ["responsavel pelo preenchimento", "responsavel"] },
  { code: "COMMERCIAL_SERVICE", patterns: ["atendimento comercial", "atendimento"] },
  {
    code: "QUOTE_ORDER_RESPONSE_TIME",
    patterns: ["tempo de resposta", "cotacoes", "cotacao"],
  },
  { code: "DELIVERY_DEADLINE", patterns: ["prazo de entrega", "cumprimento do prazo"] },
  { code: "ORDER_CONFORMITY", patterns: ["conformidade"] },
  { code: "PRODUCT_QUALITY", patterns: ["qualidade do produto", "qualidade"] },
  { code: "TECHNICAL_SUPPORT", patterns: ["suporte tecnico", "suporte"] },
  {
    code: SATISFACTION_V1_OPEN_FEEDBACK_CODE,
    patterns: ["elogios", "melhorados", "insatisfacao", "comentario", "observacao"],
  },
];

export function normalizeHeader(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036F]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export type SatisfactionHeaderMapping = {
  header: string;
  code: string | null;
};

/**
 * Mapeia cabeçalhos → códigos.
 *
 * A ordem de `HEADER_PATTERNS` importa: padrões específicos ("qualidade do
 * produto") vêm antes dos genéricos ("qualidade"), e cada código só é
 * atribuído uma vez — o cabeçalho mais específico ganha.
 */
export function mapHeaders(headers: readonly string[]): SatisfactionHeaderMapping[] {
  const used = new Set<string>();
  const result: SatisfactionHeaderMapping[] = headers.map((header) => ({ header, code: null }));

  // Duas passadas: primeiro casamento exato do padrão inteiro, depois parcial.
  for (const exactPass of [true, false]) {
    for (const { code, patterns } of HEADER_PATTERNS) {
      if (used.has(code)) continue;
      for (let i = 0; i < result.length; i += 1) {
        const entry = result[i]!;
        if (entry.code) continue;
        const normalized = normalizeHeader(entry.header);
        const hit = patterns.some((pattern) =>
          exactPass ? normalized === pattern : normalized.includes(pattern)
        );
        if (hit) {
          entry.code = code;
          used.add(code);
          break;
        }
      }
    }
  }

  return result;
}

/**
 * Lê a nota em qualquer das formas que o Google Forms exporta:
 * `5`, `"5"`, `"5 - Excelente"`, `"Excelente"`.
 * Fora disso devolve null — nunca chuta.
 */
export function parseImportedRating(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return isValidRating(raw) ? raw : null;
  const text = String(raw).trim();
  if (!text) return null;

  const leadingDigit = text.match(/^([1-5])\b/);
  if (leadingDigit) return Number(leadingDigit[1]);

  const normalized = normalizeHeader(text);
  for (const [value, label] of Object.entries(SATISFACTION_RATING_LABELS)) {
    if (normalizeHeader(label) === normalized) return Number(value);
  }
  return null;
}

/** Datas brasileiras (dd/MM/yyyy) e ISO. Ambíguo demais = null. */
export function parseImportedDate(raw: unknown): Date | null {
  if (raw == null) return null;
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw;
  const text = String(raw).trim();
  if (!text) return null;

  const br = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (br) {
    const [, d, m, y, hh, mm, ss] = br;
    const date = new Date(
      Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh ?? 0), Number(mm ?? 0), Number(ss ?? 0))
    );
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const iso = new Date(text);
  return Number.isNaN(iso.getTime()) ? null : iso;
}

export type SatisfactionImportRow = {
  rowNumber: number;
  originalSubmittedAt: Date | null;
  declaredCompanyName: string | null;
  declaredTaxId: string | null;
  respondentPhone: string | null;
  respondentName: string | null;
  surveyDate: Date | null;
  ratings: Record<string, number | null>;
  openFeedback: string | null;
  /** Impede que o mesmo registro entre duas vezes no mesmo lote. */
  fingerprint: string;
  issues: string[];
};

/**
 * Impressão digital estável da linha. Baseada no CONTEÚDO de negócio, não na
 * posição: reordenar o arquivo não gera duplicata nova.
 */
export function buildRowFingerprint(input: {
  declaredCompanyName: string | null;
  declaredTaxId: string | null;
  respondentName: string | null;
  originalSubmittedAt: Date | null;
  ratings: Record<string, number | null>;
  openFeedback: string | null;
}): string {
  const parts = [
    normalizeCompanyNameKey(input.declaredCompanyName) ?? "",
    normalizeTaxIdDigits(input.declaredTaxId) ?? "",
    normalizeHeader(input.respondentName ?? ""),
    input.originalSubmittedAt ? input.originalSubmittedAt.toISOString() : "",
    SATISFACTION_V1_RATING_CODES.map((code) => `${code}:${input.ratings[code] ?? ""}`).join("|"),
    normalizeHeader(input.openFeedback ?? "").slice(0, 200),
  ];
  return crypto.createHash("sha256").update(parts.join("§"), "utf8").digest("hex");
}

export type SatisfactionImportParseResult = {
  headers: SatisfactionHeaderMapping[];
  rows: SatisfactionImportRow[];
  unmappedHeaders: string[];
  missingQuestionCodes: string[];
};

/**
 * Converte a matriz do arquivo em linhas de domínio.
 * Não escreve nada e não decide nada sobre o banco — só interpreta.
 */
export function parseImportMatrix(
  matrix: readonly (readonly unknown[])[]
): SatisfactionImportParseResult {
  if (matrix.length === 0) {
    return { headers: [], rows: [], unmappedHeaders: [], missingQuestionCodes: [] };
  }

  const rawHeaders = (matrix[0] ?? []).map((cell) => String(cell ?? "").trim());
  const headers = mapHeaders(rawHeaders);
  const codeToIndex = new Map<string, number>();
  headers.forEach((entry, index) => {
    if (entry.code) codeToIndex.set(entry.code, index);
  });

  const cell = (row: readonly unknown[], code: string): unknown => {
    const index = codeToIndex.get(code);
    return index == null ? null : row[index];
  };

  const rows: SatisfactionImportRow[] = [];
  for (let i = 1; i < matrix.length; i += 1) {
    const raw = matrix[i] ?? [];
    const isBlank = raw.every((value) => value == null || String(value).trim() === "");
    if (isBlank) continue;

    const issues: string[] = [];
    const ratings: Record<string, number | null> = {};
    for (const code of SATISFACTION_V1_RATING_CODES) {
      const value = parseImportedRating(cell(raw, code));
      ratings[code] = value;
      if (value == null) issues.push(`Nota ausente ou inválida em ${code}.`);
    }

    const declaredCompanyName = String(cell(raw, "CUSTOMER_NAME") ?? "").trim() || null;
    const respondentName = String(cell(raw, "RESPONDENT_NAME") ?? "").trim() || null;
    const openFeedback = String(cell(raw, SATISFACTION_V1_OPEN_FEEDBACK_CODE) ?? "").trim() || null;
    const originalSubmittedAt = parseImportedDate(cell(raw, IMPORT_TIMESTAMP_FIELD));
    const surveyDate = parseImportedDate(cell(raw, "SURVEY_DATE"));

    if (!declaredCompanyName) issues.push("Cliente (nome da empresa) é obrigatório.");
    if (!respondentName) issues.push("Responsável pelo preenchimento é obrigatório.");
    if (!openFeedback) issues.push("Comentário é obrigatório no questionário histórico.");

    const row: SatisfactionImportRow = {
      rowNumber: i + 1,
      originalSubmittedAt,
      declaredCompanyName,
      declaredTaxId: String(cell(raw, "TAX_ID") ?? "").trim() || null,
      respondentPhone: String(cell(raw, "CONTACT_PHONE") ?? "").trim() || null,
      respondentName,
      surveyDate,
      ratings,
      openFeedback,
      fingerprint: "",
      issues,
    };
    row.fingerprint = buildRowFingerprint(row);
    rows.push(row);
  }

  const requiredCodes = [...SATISFACTION_V1_RATING_CODES, SATISFACTION_V1_OPEN_FEEDBACK_CODE];
  return {
    headers,
    rows,
    unmappedHeaders: headers.filter((h) => !h.code).map((h) => h.header),
    missingQuestionCodes: requiredCodes.filter((code) => !codeToIndex.has(code)),
  };
}

/** Duplicatas DENTRO do próprio arquivo (mesma linha repetida). */
export function findDuplicateFingerprints(rows: readonly SatisfactionImportRow[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.fingerprint)) duplicates.add(row.fingerprint);
    seen.add(row.fingerprint);
  }
  return [...duplicates];
}

export function isRowValid(row: SatisfactionImportRow): boolean {
  return row.issues.length === 0;
}
