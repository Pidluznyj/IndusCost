/**
 * Satisfação — importação histórica do Google Forms (camada com I/O).
 *
 * Fluxo oficial: UPLOAD → PREVIEW → VALIDAÇÃO → APROVAÇÃO → APPLY → PÓS-VALIDAÇÃO.
 *
 * Garantias:
 *  - PREVIEW não escreve absolutamente nada (nem o lote).
 *  - APPLY é idempotente: `(importBatchId, importFingerprint)` é UNIQUE e o
 *    mesmo arquivo, reimportado, é detectado pelo hash do conteúdo.
 *  - `originalSubmittedAt` preserva o instante histórico; `submittedAt` guarda
 *    quando o registro entrou no IndusCost. As duas datas coexistem.
 *  - Cliente não identificado fica UNMATCHED para revisão — nunca é descartado
 *    nem "adivinhado".
 */

import crypto from "crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";
import {
  findDuplicateFingerprints,
  isRowValid,
  parseImportMatrix,
  type SatisfactionImportRow,
} from "./satisfactionImport.js";
import {
  normalizeCompanyNameKey,
  normalizeTaxIdDigits,
  SATISFACTION_V1_OPEN_FEEDBACK_CODE,
  SATISFACTION_V1_RATING_CODES,
} from "./satisfactionContracts.js";
import {
  recordSatisfactionAudit,
  SATISFACTION_AUDIT_ENTITIES,
} from "./satisfactionAudit.server.js";
import { SatisfactionDomainError } from "./satisfactionCampaignService.server.js";

export type SatisfactionImportPreview = {
  fileName: string;
  fileHash: string;
  rowsTotal: number;
  rowsValid: number;
  rowsInvalid: number;
  customersMatched: number;
  customersUnmatched: number;
  duplicatesInFile: number;
  alreadyImported: number;
  questionMapping: Array<{ header: string; questionCode: string | null }>;
  unmappedHeaders: string[];
  missingQuestionCodes: string[];
  ratingsInvalid: number;
  requiredMissing: number;
  sample: Array<{
    rowNumber: number;
    company: string | null;
    respondent: string | null;
    originalSubmittedAt: string | null;
    matched: boolean;
    issues: string[];
  }>;
};

export type SatisfactionImportApplyResult = {
  batchId: string;
  imported: number;
  skippedDuplicates: number;
  skippedInvalid: number;
  matched: number;
  unmatched: number;
};

function hashBuffer(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/** Lê CSV/XLSX numa matriz crua, sem interpretar tipos além do necessário. */
export function readWorkbookMatrix(buffer: Buffer): unknown[][] {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true, raw: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    blankrows: false,
    defval: null,
  });
}

export function createSatisfactionImportService(deps: { prisma: PrismaClient }) {
  const { prisma } = deps;

  /**
   * Correspondência em lote, sem N+1: carrega os candidatos numa consulta e
   * casa em memória por CNPJ (identidade forte) e, em seguida, por nome
   * normalizado — desde que resolva para exatamente UM cliente.
   */
  async function matchCustomers(
    rows: readonly SatisfactionImportRow[]
  ): Promise<Map<number, string>> {
    const taxIds = new Set<string>();
    const nameKeys = new Set<string>();
    for (const row of rows) {
      const digits = normalizeTaxIdDigits(row.declaredTaxId);
      if (digits) taxIds.add(digits);
      const nameKey = normalizeCompanyNameKey(row.declaredCompanyName);
      if (nameKey) nameKeys.add(nameKey);
    }

    const customers = await prisma.customer.findMany({
      select: { id: true, companyName: true, taxId: true },
    });

    const byTaxId = new Map<string, string[]>();
    const byNameKey = new Map<string, string[]>();
    for (const customer of customers) {
      const digits = normalizeTaxIdDigits(customer.taxId);
      if (digits) {
        byTaxId.set(digits, [...(byTaxId.get(digits) ?? []), customer.id]);
      }
      const nameKey = normalizeCompanyNameKey(customer.companyName);
      if (nameKey) {
        byNameKey.set(nameKey, [...(byNameKey.get(nameKey) ?? []), customer.id]);
      }
    }

    const matches = new Map<number, string>();
    for (const row of rows) {
      const digits = normalizeTaxIdDigits(row.declaredTaxId);
      if (digits) {
        const hit = byTaxId.get(digits);
        if (hit?.length === 1) {
          matches.set(row.rowNumber, hit[0]!);
          continue;
        }
      }
      const nameKey = normalizeCompanyNameKey(row.declaredCompanyName);
      if (nameKey) {
        const hit = byNameKey.get(nameKey);
        // Ambiguidade não vira palpite: fica UNMATCHED para revisão humana.
        if (hit?.length === 1) matches.set(row.rowNumber, hit[0]!);
      }
    }
    return matches;
  }

  async function loadCampaignForImport(campaignId: string) {
    const campaign = await prisma.satisfactionSurveyCampaign.findUnique({
      where: { id: campaignId },
      select: {
        id: true,
        status: true,
        questions: { select: { id: true, code: true, type: true } },
      },
    });
    if (!campaign) throw new SatisfactionDomainError("Pesquisa não encontrada.", "NOT_FOUND");
    if (campaign.questions.length === 0) {
      throw new SatisfactionDomainError(
        "Publique a pesquisa antes de importar: o questionário ainda não foi congelado.",
        "INVALID_STATE"
      );
    }
    return campaign;
  }

  return {
    /** PREVIEW — não escreve nada, nem o lote. */
    async previewImport(
      campaignId: string,
      buffer: Buffer,
      fileName: string
    ): Promise<SatisfactionImportPreview> {
      await loadCampaignForImport(campaignId);

      const fileHash = hashBuffer(buffer);
      const parsed = parseImportMatrix(readWorkbookMatrix(buffer));
      const duplicates = findDuplicateFingerprints(parsed.rows);
      const matches = await matchCustomers(parsed.rows);

      const alreadyImported = await prisma.satisfactionSurveyResponse.count({
        where: {
          campaignId,
          importFingerprint: { in: parsed.rows.map((r) => r.fingerprint) },
        },
      });

      const ratingsInvalid = parsed.rows.reduce(
        (acc, row) =>
          acc + SATISFACTION_V1_RATING_CODES.filter((code) => row.ratings[code] == null).length,
        0
      );
      const requiredMissing = parsed.rows.reduce(
        (acc, row) =>
          acc +
          row.issues.filter((issue) => issue.includes("obrigatório")).length,
        0
      );

      const validRows = parsed.rows.filter(isRowValid);

      return {
        fileName,
        fileHash,
        rowsTotal: parsed.rows.length,
        rowsValid: validRows.length,
        rowsInvalid: parsed.rows.length - validRows.length,
        customersMatched: parsed.rows.filter((r) => matches.has(r.rowNumber)).length,
        customersUnmatched: parsed.rows.filter((r) => !matches.has(r.rowNumber)).length,
        duplicatesInFile: duplicates.length,
        alreadyImported,
        questionMapping: parsed.headers.map((h) => ({
          header: h.header,
          questionCode: h.code,
        })),
        unmappedHeaders: parsed.unmappedHeaders,
        missingQuestionCodes: parsed.missingQuestionCodes,
        ratingsInvalid,
        requiredMissing,
        sample: parsed.rows.slice(0, 20).map((row) => ({
          rowNumber: row.rowNumber,
          company: row.declaredCompanyName,
          respondent: row.respondentName,
          originalSubmittedAt: row.originalSubmittedAt
            ? row.originalSubmittedAt.toISOString()
            : null,
          matched: matches.has(row.rowNumber),
          issues: row.issues,
        })),
      };
    },

    /**
     * APPLY — só linhas válidas, em lotes, dentro de transação.
     * Reimportar o mesmo arquivo não duplica: o UNIQUE
     * (importBatchId, importFingerprint) e a checagem por campanha barram.
     */
    async applyImport(
      campaignId: string,
      buffer: Buffer,
      fileName: string,
      userId: string | null
    ): Promise<SatisfactionImportApplyResult> {
      const campaign = await loadCampaignForImport(campaignId);

      const fileHash = hashBuffer(buffer);
      const parsed = parseImportMatrix(readWorkbookMatrix(buffer));
      const matches = await matchCustomers(parsed.rows);

      const questionByCode = new Map(campaign.questions.map((q) => [q.code, q]));

      // Fingerprints já presentes NA CAMPANHA — vale entre lotes diferentes.
      const existing = await prisma.satisfactionSurveyResponse.findMany({
        where: {
          campaignId,
          importFingerprint: { in: parsed.rows.map((r) => r.fingerprint) },
        },
        select: { importFingerprint: true },
      });
      const alreadyPresent = new Set(
        existing.map((e) => e.importFingerprint).filter((f): f is string => Boolean(f))
      );

      const batch = await prisma.satisfactionImportBatch.create({
        data: {
          campaignId,
          fileName,
          fileHash,
          status: "PREVIEWED",
          createdByUserId: userId,
        },
        select: { id: true },
      });

      const seen = new Set<string>();
      let imported = 0;
      let skippedDuplicates = 0;
      let skippedInvalid = 0;
      let matchedCount = 0;

      const pending = parsed.rows.filter((row) => {
        if (!isRowValid(row)) {
          skippedInvalid += 1;
          return false;
        }
        if (alreadyPresent.has(row.fingerprint) || seen.has(row.fingerprint)) {
          skippedDuplicates += 1;
          return false;
        }
        seen.add(row.fingerprint);
        return true;
      });

      // Lotes pequenos: transação curta, sem segurar conexão por minutos.
      const CHUNK = 50;
      for (let offset = 0; offset < pending.length; offset += CHUNK) {
        const chunk = pending.slice(offset, offset + CHUNK);
        await prisma.$transaction(async (tx) => {
          for (const row of chunk) {
            const customerId = matches.get(row.rowNumber) ?? null;
            if (customerId) matchedCount += 1;

            const response = await tx.satisfactionSurveyResponse.create({
              data: {
                campaignId,
                customerId,
                customerMatchStatus: customerId ? "MATCHED" : "UNMATCHED",
                source: "GOOGLE_FORMS_IMPORT",
                status: "SUBMITTED",
                respondentName: row.respondentName,
                respondentPhone: row.respondentPhone,
                declaredCompanyName: row.declaredCompanyName,
                declaredTaxId: row.declaredTaxId,
                declaredDate: row.surveyDate,
                // A data histórica é preservada; submittedAt marca a entrada
                // no IndusCost. Nunca sobrescrevemos uma pela outra.
                originalSubmittedAt: row.originalSubmittedAt,
                submittedAt: row.originalSubmittedAt ?? row.surveyDate,
                importBatchId: batch.id,
                importFingerprint: row.fingerprint,
                version: 1,
              },
              select: { id: true },
            });

            const answers: Prisma.SatisfactionSurveyAnswerCreateManyInput[] = [];
            for (const code of SATISFACTION_V1_RATING_CODES) {
              const question = questionByCode.get(code);
              const rating = row.ratings[code];
              // Sem nota = sem linha. Nunca zero.
              if (!question || rating == null) continue;
              answers.push({
                responseId: response.id,
                questionId: question.id,
                ratingValue: rating,
              });
            }
            const feedbackQuestion = questionByCode.get(SATISFACTION_V1_OPEN_FEEDBACK_CODE);
            if (feedbackQuestion && row.openFeedback) {
              answers.push({
                responseId: response.id,
                questionId: feedbackQuestion.id,
                textValue: row.openFeedback,
              });
            }
            if (answers.length > 0) {
              await tx.satisfactionSurveyAnswer.createMany({
                data: answers,
                skipDuplicates: true,
              });
            }
            imported += 1;
          }
        });
      }

      await prisma.satisfactionImportBatch.update({
        where: { id: batch.id },
        data: {
          status: "APPLIED",
          appliedAt: new Date(),
          statsJson: {
            imported,
            skippedDuplicates,
            skippedInvalid,
            matched: matchedCount,
            unmatched: imported - matchedCount,
            rowsTotal: parsed.rows.length,
          },
        },
      });

      await recordSatisfactionAudit(prisma, {
        entityType: SATISFACTION_AUDIT_ENTITIES.import,
        entityId: batch.id,
        action: "IMPORT_APPLIED",
        newValue: `arquivo ${fileName} / importadas ${imported} / duplicadas ${skippedDuplicates} / invalidas ${skippedInvalid}`,
        performedBy: userId,
      });

      return {
        batchId: batch.id,
        imported,
        skippedDuplicates,
        skippedInvalid,
        matched: matchedCount,
        unmatched: imported - matchedCount,
      };
    },
  };
}

export type SatisfactionImportService = ReturnType<typeof createSatisfactionImportService>;
