/**
 * Persistência idempotente do resumo/linhas fiscais da NF-e (camada A).
 */

import { Prisma, type PrismaClient } from "@prisma/client";
import { NOMUS_NFE_STATUS_CANCELLED } from "@/src/lib/nomusNfeClassification.js";
import {
  NFE_FISCAL_PARSER_VERSION,
  NFE_FISCAL_SOURCE,
  parseNfeFiscalXml,
  type NfeFiscalParseResult,
} from "@/src/lib/nfeFiscalXmlParser.js";

type PrismaLike = PrismaClient | Prisma.TransactionClient;

function money2(value: number | null | undefined): Prisma.Decimal | null {
  if (value == null || !Number.isFinite(value)) return null;
  return new Prisma.Decimal(value.toFixed(2));
}

function money4(value: number | null | undefined): Prisma.Decimal | null {
  if (value == null || !Number.isFinite(value)) return null;
  return new Prisma.Decimal(value.toFixed(4));
}

function rate6(value: number | null | undefined): Prisma.Decimal | null {
  if (value == null || !Number.isFinite(value)) return null;
  return new Prisma.Decimal(value.toFixed(6));
}

export type PersistNfeFiscalInput = {
  nomusNfeId: string;
  xmlRaw: string | null | undefined;
  /** Status Nomus (7 = cancelada). */
  status?: number | null;
  /** Force reparse even if xmlHash+parserVersion match. */
  force?: boolean;
};

export type PersistNfeFiscalResult = {
  skipped: boolean;
  reason?: string;
  summaryId: string | null;
  lineCount: number;
  parse: NfeFiscalParseResult;
};

export function isNomusNfeCancelledStatus(status: number | null | undefined): boolean {
  return status === NOMUS_NFE_STATUS_CANCELLED;
}

export async function persistNomusNfeFiscalFromXml(
  prisma: PrismaLike,
  input: PersistNfeFiscalInput
): Promise<PersistNfeFiscalResult> {
  const parse = parseNfeFiscalXml(input.xmlRaw);
  const isCancelled = isNomusNfeCancelledStatus(input.status);

  if (!input.force && parse.xmlHash) {
    const existing = await prisma.nomusNfeFiscalSummary.findUnique({
      where: { nomusNfeId: input.nomusNfeId },
      select: { id: true, xmlHash: true, parserVersion: true },
    });
    if (
      existing &&
      existing.xmlHash === parse.xmlHash &&
      existing.parserVersion === NFE_FISCAL_PARSER_VERSION
    ) {
      await prisma.nomusNfeFiscalSummary.update({
        where: { id: existing.id },
        data: { isCancelled },
      });
      const lineCount = await prisma.nomusNfeTaxLine.count({
        where: { nomusNfeId: input.nomusNfeId },
      });
      return {
        skipped: true,
        reason: "xmlHash+parserVersion unchanged",
        summaryId: existing.id,
        lineCount,
        parse,
      };
    }
  }

  const t = parse.totals;
  const summaryData = {
    parserVersion: parse.parserVersion,
    source: parse.source,
    xmlHash: parse.xmlHash,
    parsedAt: parse.parsedAt,
    isCancelled,
    finalidade: parse.finalidade,
    tpNF: parse.tpNF,
    vProd: money2(t.vProd),
    vDesc: money2(t.vDesc),
    vFrete: money2(t.vFrete),
    vSeg: money2(t.vSeg),
    vOutro: money2(t.vOutro),
    vII: money2(t.vII),
    vIPI: money2(t.vIPI),
    vIPIDevol: money2(t.vIPIDevol),
    vBC: money2(t.vBC),
    vICMS: money2(t.vICMS),
    vICMSDeson: money2(t.vICMSDeson),
    vBCST: money2(t.vBCST),
    vST: money2(t.vST),
    vFCP: money2(t.vFCP),
    vFCPST: money2(t.vFCPST),
    vFCPSTRet: money2(t.vFCPSTRet),
    vPIS: money2(t.vPIS),
    vCOFINS: money2(t.vCOFINS),
    vISS: money2(t.vISS),
    vTotTrib: money2(t.vTotTrib),
    vNF: money2(t.vNF),
    extensibleTotals:
      parse.extensibleTotals == null
        ? Prisma.JsonNull
        : (parse.extensibleTotals as Prisma.InputJsonValue),
    highlightedResidual: money2(parse.highlightedResidual),
    qualityAlert: parse.qualityAlert,
  };

  const summary = await prisma.nomusNfeFiscalSummary.upsert({
    where: { nomusNfeId: input.nomusNfeId },
    create: {
      nomusNfeId: input.nomusNfeId,
      ...summaryData,
    },
    update: summaryData,
  });

  await prisma.nomusNfeTaxLine.deleteMany({ where: { nomusNfeId: input.nomusNfeId } });

  if (parse.lines.length > 0) {
    await prisma.nomusNfeTaxLine.createMany({
      data: parse.lines.map((line) => ({
        nomusNfeId: input.nomusNfeId,
        summaryId: summary.id,
        lineKey: line.lineKey,
        taxType: String(line.taxType),
        scope: line.scope,
        itemNumber: line.itemNumber,
        baseAmount: money4(line.baseAmount),
        rate: rate6(line.rate),
        amount: money4(line.amount),
        cst: line.cst,
        csosn: line.csosn,
        cfop: line.cfop,
        ncm: line.ncm,
        metadata:
          line.metadata == null
            ? Prisma.JsonNull
            : (line.metadata as Prisma.InputJsonValue),
        source: line.source || NFE_FISCAL_SOURCE.XML,
        sourcePath: line.sourcePath,
        parsedAt: parse.parsedAt,
      })),
    });
  }

  return {
    skipped: false,
    summaryId: summary.id,
    lineCount: parse.lines.length,
    parse,
  };
}

export async function ensureNomusNfeFiscalPersisted(
  prisma: PrismaLike,
  args: {
    nomusNfeId: string;
    xmlRaw: string | null | undefined;
    status?: number | null;
    force?: boolean;
  }
): Promise<PersistNfeFiscalResult> {
  return persistNomusNfeFiscalFromXml(prisma, args);
}
