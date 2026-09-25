/**
 * Importação da cobertura legada do Nomus — acesso a dados.
 *
 *   preview (padrão): só leitura — associa as linhas e mostra o que seria coberto;
 *   apply: grava a importação + a cobertura NOMUS_LEGACY numa transação.
 *
 * Idempotente: mesmo arquivo (hash) não gera nova importação; recebimento já
 * coberto nunca é coberto de novo (índice único parcial no banco).
 */
import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";
import { decimalToNumber, toPrismaDecimal } from "./commission-money.js";
import { toCivilDateKey } from "../financeCivilDate.js";
import {
  COMMISSION_OFFICIAL_CUTOVER_YEAR_MONTH,
  compareCommissionYearMonth,
  formatCommissionYearMonthLabel,
  type CommissionYearMonth,
} from "./commissionCoverageCutover.js";
import {
  buildLegacyCoverageRowsToCreate,
  countLegacyCoverageResults,
  matchLegacyCoverageRow,
  normalizeLegacyNfeNumber,
  parseLegacyCoverageMatrix,
  type LegacyCoverageImportCounts,
  type LegacyCoverageRowResult,
  type LegacyCoverageRowToCreate,
  type LegacyMatchReceipt,
  type LegacyMatchReceivable,
} from "./commissionLegacyCoverageImport.js";

export const LEGACY_COVERAGE_IMPORT_CONFIRM = "IMPORTAR COBERTURA NOMUS";

export type LegacyCoverageDb = Pick<
  PrismaClient,
  | "commissionLegacyCoverageImport"
  | "commissionReceiptCoverage"
  | "nomusAccountsReceivable"
  | "nomusReceivableReceipt"
  | "$transaction"
>;

export type LegacyCoverageImportPlan = {
  filename: string;
  fileHash: string;
  reference: CommissionYearMonth;
  /** Importação existente com o mesmo arquivo (idempotência). */
  existingImportId: string | null;
  parseErrors: string[];
  results: LegacyCoverageRowResult[];
  counts: LegacyCoverageImportCounts;
  coverageRows: LegacyCoverageRowToCreate[];
};

/** XLSX ou CSV (a lib `xlsx` lê ambos) → matriz da primeira aba. */
export function readLegacyCoverageFile(buffer: Buffer): unknown[][] {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true, raw: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  return XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName]!, {
    header: 1,
    defval: "",
    blankrows: false,
    raw: true,
  });
}

export function hashLegacyCoverageFile(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function assertReferenceBeforeCutover(reference: CommissionYearMonth): void {
  if (
    !Number.isInteger(reference.year) ||
    !Number.isInteger(reference.month) ||
    reference.month < 1 ||
    reference.month > 12
  ) {
    throw new Error("Competência de referência inválida (use --year e --month).");
  }
  if (compareCommissionYearMonth(reference, COMMISSION_OFFICIAL_CUTOVER_YEAR_MONTH) >= 0) {
    throw new Error(
      `A cobertura legada do Nomus vale só para competências antes de ${formatCommissionYearMonthLabel(
        COMMISSION_OFFICIAL_CUTOVER_YEAR_MONTH
      )} (fonte oficial passa a ser o IndusCost).`
    );
  }
}

/** Monta o plano (somente leitura). */
export async function previewLegacyCoverageImport(
  db: Omit<LegacyCoverageDb, "$transaction">,
  input: { buffer: Buffer; filename: string; reference: CommissionYearMonth }
): Promise<LegacyCoverageImportPlan> {
  assertReferenceBeforeCutover(input.reference);
  const fileHash = hashLegacyCoverageFile(input.buffer);
  const parsed = parseLegacyCoverageMatrix(readLegacyCoverageFile(input.buffer));

  const existing = await db.commissionLegacyCoverageImport.findUnique({
    where: { source_fileHash: { source: "NOMUS", fileHash } },
    select: { id: true },
  });

  const crIds = [
    ...new Set(parsed.rows.map((row) => row.receivableExternalId).filter((id): id is number => id != null)),
  ];
  const nfNumbers = [
    ...new Set(
      parsed.rows
        .filter((row) => row.receivableExternalId == null && row.nfeNumber)
        .map((row) => normalizeLegacyNfeNumber(row.nfeNumber))
        .filter((nf): nf is string => nf != null)
    ),
  ];

  const receivableSelect = {
    externalId: true,
    sourceInvoiceNumber: true,
    personName: true,
    amountReceivable: true,
  } satisfies Prisma.NomusAccountsReceivableSelect;
  const [byIdRows, byNfRows] = await Promise.all([
    crIds.length > 0
      ? db.nomusAccountsReceivable.findMany({ where: { externalId: { in: crIds } }, select: receivableSelect })
      : Promise.resolve([]),
    nfNumbers.length > 0
      ? db.nomusAccountsReceivable.findMany({
          // Número da NF pode vir com zeros à esquerda ou sufixo; filtra depois pelo normalizado.
          where: { OR: nfNumbers.map((nf) => ({ sourceInvoiceNumber: { contains: nf } })) },
          select: receivableSelect,
        })
      : Promise.resolve([]),
  ]);
  const toMatchReceivable = (row: (typeof byIdRows)[number]): LegacyMatchReceivable => ({
    externalId: row.externalId,
    sourceInvoiceNumber: row.sourceInvoiceNumber,
    personName: row.personName,
    amountReceivable: row.amountReceivable == null ? null : decimalToNumber(row.amountReceivable),
  });
  const receivablesById = new Map(byIdRows.map((row) => [row.externalId, toMatchReceivable(row)]));
  const receivablesByNfe = new Map<string, LegacyMatchReceivable[]>();
  for (const row of byNfRows) {
    const nf = normalizeLegacyNfeNumber(row.sourceInvoiceNumber);
    if (!nf || !nfNumbers.includes(nf)) continue;
    const list = receivablesByNfe.get(nf) ?? [];
    list.push(toMatchReceivable(row));
    receivablesByNfe.set(nf, list);
  }

  const receivableIds = [
    ...new Set([...byIdRows, ...byNfRows].map((row) => row.externalId)),
  ];
  const receiptRows =
    receivableIds.length > 0
      ? await db.nomusReceivableReceipt.findMany({
          where: { receivableExternalId: { in: receivableIds } },
          select: { externalId: true, receivableExternalId: true, receiptDate: true, receivedAmount: true },
          orderBy: [{ receiptDate: "asc" }, { externalId: "asc" }],
        })
      : [];
  const receiptsByReceivable = new Map<number, LegacyMatchReceipt[]>();
  const receiptsById = new Map<number, LegacyMatchReceipt>();
  for (const row of receiptRows) {
    const receiptDate = toCivilDateKey(row.receiptDate);
    if (!receiptDate) continue;
    const receipt: LegacyMatchReceipt = {
      externalId: row.externalId,
      receivableExternalId: row.receivableExternalId,
      receiptDate,
      receivedAmount: decimalToNumber(row.receivedAmount),
    };
    receiptsById.set(receipt.externalId, receipt);
    const list = receiptsByReceivable.get(receipt.receivableExternalId) ?? [];
    list.push(receipt);
    receiptsByReceivable.set(receipt.receivableExternalId, list);
  }

  const coveredRows =
    receiptsById.size > 0
      ? await db.commissionReceiptCoverage.findMany({
          where: { coverageStatus: "COVERED", receiptExternalId: { in: [...receiptsById.keys()] } },
          select: { receiptExternalId: true },
        })
      : [];
  const coveredReceiptIds = new Set(
    coveredRows.map((row) => row.receiptExternalId).filter((id): id is number => id != null)
  );

  const claimed = new Set<number>();
  const results: LegacyCoverageRowResult[] = [];
  for (const row of parsed.rows) {
    const result = matchLegacyCoverageRow({
      row,
      reference: input.reference,
      receivablesById,
      receivablesByNfe,
      receiptsByReceivable,
      coveredReceiptIds,
      claimedReceiptIds: claimed,
    });
    for (const id of [...result.receiptExternalIds, ...result.alreadyCoveredReceiptIds]) claimed.add(id);
    results.push(result);
  }

  return {
    filename: input.filename,
    fileHash,
    reference: input.reference,
    existingImportId: existing?.id ?? null,
    parseErrors: parsed.errors,
    results,
    counts: countLegacyCoverageResults(results),
    coverageRows: buildLegacyCoverageRowsToCreate({
      results,
      receiptsById,
      reference: input.reference,
      filename: input.filename,
    }),
  };
}

export type LegacyCoverageApplyResult = {
  importId: string;
  created: boolean;
  coverageCount: number;
};

/**
 * Grava a importação e a cobertura numa transação. Mesmo arquivo → devolve a
 * importação existente sem gravar nada. Corrida com outra cobertura do mesmo
 * recebimento → o índice único parcial aborta tudo (nada parcial).
 */
export async function applyLegacyCoverageImport(
  db: LegacyCoverageDb,
  plan: LegacyCoverageImportPlan,
  input: { importedBy: string; confirm: string; notes?: string | null }
): Promise<LegacyCoverageApplyResult> {
  if (input.confirm !== LEGACY_COVERAGE_IMPORT_CONFIRM) {
    throw new Error(`Confirmação obrigatória: --confirm "${LEGACY_COVERAGE_IMPORT_CONFIRM}"`);
  }
  if (plan.parseErrors.length > 0) {
    throw new Error(`Arquivo inválido: ${plan.parseErrors.join("; ")}`);
  }
  if (plan.existingImportId) {
    return { importId: plan.existingImportId, created: false, coverageCount: 0 };
  }
  try {
    return await db.$transaction(async (tx) => {
      const again = await tx.commissionLegacyCoverageImport.findUnique({
        where: { source_fileHash: { source: "NOMUS", fileHash: plan.fileHash } },
        select: { id: true },
      });
      if (again) return { importId: again.id, created: false, coverageCount: 0 };

      const record = await tx.commissionLegacyCoverageImport.create({
        data: {
          source: "NOMUS",
          referenceYear: plan.reference.year,
          referenceMonth: plan.reference.month,
          filename: plan.filename,
          fileHash: plan.fileHash,
          importedBy: input.importedBy,
          rowCount: plan.counts.rowCount,
          matchedCount: plan.counts.matchedCount,
          unmatchedCount: plan.counts.unmatchedCount + plan.counts.invalidCount,
          ambiguousCount: plan.counts.ambiguousCount,
          alreadyCoveredCount: plan.counts.alreadyCoveredCount,
          notes: input.notes ?? null,
          resultRowsJson: plan.results as unknown as Prisma.InputJsonValue,
        },
        select: { id: true },
      });

      if (plan.coverageRows.length > 0) {
        await tx.commissionReceiptCoverage.createMany({
          data: plan.coverageRows.map((row) => ({
            receiptExternalId: row.receiptExternalId,
            receivableExternalId: row.receivableExternalId,
            coverageSource: "NOMUS_LEGACY" as const,
            coverageStatus: "COVERED" as const,
            naturalReceiptDate: new Date(`${row.naturalReceiptDate}T00:00:00.000Z`),
            naturalYear: row.naturalYear,
            naturalMonth: row.naturalMonth,
            coveredYear: row.coveredYear,
            coveredMonth: row.coveredMonth,
            legacyReference: row.legacyReference,
            legacyImportId: record.id,
            coveredReceivedAmount: toPrismaDecimal(row.coveredReceivedAmount),
            coveredCommissionAmount:
              row.coveredCommissionAmount == null ? null : toPrismaDecimal(row.coveredCommissionAmount),
            associationMethod: row.associationMethod,
            notes: row.notes,
            createdBy: input.importedBy,
          })),
        });
      }
      return { importId: record.id, created: true, coverageCount: plan.coverageRows.length };
    });
  } catch (error) {
    if (error != null && typeof error === "object" && (error as { code?: string }).code === "P2002") {
      throw new Error(
        "Duplicidade bloqueada pelo banco: algum recebimento já tem cobertura ativa (ou o arquivo já foi importado). Rode o preview de novo."
      );
    }
    throw error;
  }
}
