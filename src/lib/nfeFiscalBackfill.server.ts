/**
 * Backfill fiscal NF-e (T03) — acesso Prisma (preview/apply/audit).
 * Escopo de escrita: apenas NomusNfeFiscalSummary + NomusNfeTaxLine.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { NOMUS_NFE_STATUS_CANCELLED } from "@/src/lib/nomusNfeClassification.js";
import {
  NFE_FISCAL_PARSER_VERSION,
} from "@/src/lib/nfeFiscalXmlParser.js";
import { ensureNomusNfeFiscalPersisted } from "@/src/lib/nfeFiscalPersist.js";
import {
  NFE_FISCAL_BACKFILL_ROLLBACK,
  NFE_FISCAL_BACKFILL_RISKS,
  aggregateHeaderTaxTotals,
  buildFindingsFromRows,
  classifyNfeFiscalBackfillRow,
  normalizeOrderCode,
  summarizeBackfillRows,
  type NfeFiscalBackfillApplyReport,
  type NfeFiscalBackfillCandidateInput,
  type NfeFiscalBackfillFilters,
  type NfeFiscalBackfillPreviewReport,
  type NfeFiscalBackfillRowResult,
} from "@/src/lib/nfeFiscalBackfill.js";

type PrismaLike = PrismaClient;

function decToNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "object" && value !== null && "toNumber" in value) {
    try {
      const n = (value as { toNumber: () => number }).toNumber();
      return Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseIsoDayStart(iso: string): Date {
  const d = new Date(`${iso.trim()}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`Data inválida: ${iso}`);
  return d;
}

function parseIsoDayEnd(iso: string): Date {
  const d = new Date(`${iso.trim()}T23:59:59.999Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`Data inválida: ${iso}`);
  return d;
}

export function buildNomusNfeFiscalBackfillWhere(
  filters: NfeFiscalBackfillFilters
): Prisma.NomusNfeWhereInput {
  const where: Prisma.NomusNfeWhereInput = {};
  const and: Prisma.NomusNfeWhereInput[] = [];

  if (filters.externalId != null) {
    and.push({ externalId: filters.externalId });
  }
  if (filters.afterExternalId != null) {
    and.push({ externalId: { gt: filters.afterExternalId } });
  }
  if (filters.nfeNumber) {
    and.push({ numero: filters.nfeNumber.trim() });
  }
  if (!filters.includeCancelled) {
    and.push({
      OR: [{ status: null }, { status: { not: NOMUS_NFE_STATUS_CANCELLED } }],
    });
  }
  if (filters.fromDate || filters.toDate) {
    const range: Prisma.DateTimeNullableFilter = {};
    if (filters.fromDate) range.gte = parseIsoDayStart(filters.fromDate);
    if (filters.toDate) range.lte = parseIsoDayEnd(filters.toDate);
    and.push({
      OR: [{ xmlDhEmi: range }, { dataProcessamento: range }],
    });
  }
  if (filters.customerQuery) {
    const q = filters.customerQuery.trim();
    const digits = q.replace(/\D/g, "");
    and.push({
      OR: [
        ...(digits.length >= 8 ? [{ xmlDestCnpjCpf: { contains: digits } }] : []),
        { xmlDestCnpjCpf: { contains: q, mode: "insensitive" as const } },
      ],
    });
  }

  if (and.length) where.AND = and;
  return where;
}

async function resolveOrderLinkedNfeIds(
  prisma: PrismaLike,
  orderCode: string
): Promise<string[]> {
  const code = orderCode.trim();
  const links = await prisma.salesOrderNfeLink.findMany({
    where: {
      OR: [
        { orderCode: { equals: code, mode: "insensitive" } },
        { orderCode: { contains: code.replace(/^PD\s*/i, ""), mode: "insensitive" } },
        {
          SalesOrder: {
            orderCode: { equals: code, mode: "insensitive" },
          },
        },
        {
          SalesOrder: {
            orderCode: { contains: code.replace(/^PD\s*/i, ""), mode: "insensitive" },
          },
        },
      ],
    },
    select: { nomusNfeId: true, nfeExternalId: true },
  });
  const byId = links.map((l) => l.nomusNfeId).filter((id): id is string => Boolean(id));
  if (byId.length) return [...new Set(byId)];

  const externalIds = [...new Set(links.map((l) => l.nfeExternalId))];
  if (!externalIds.length) return [];
  const nfes = await prisma.nomusNfe.findMany({
    where: { externalId: { in: externalIds } },
    select: { id: true },
  });
  return nfes.map((n) => n.id);
}

export async function loadNfeFiscalBackfillCandidates(
  prisma: PrismaLike,
  filters: NfeFiscalBackfillFilters
): Promise<NfeFiscalBackfillCandidateInput[]> {
  const where = buildNomusNfeFiscalBackfillWhere(filters);

  if (filters.orderCode) {
    const ids = await resolveOrderLinkedNfeIds(prisma, filters.orderCode);
    if (!ids.length) return [];
    const and = Array.isArray(where.AND) ? [...where.AND] : where.AND ? [where.AND] : [];
    and.push({ id: { in: ids } });
    where.AND = and;
  }

  const rows = await prisma.nomusNfe.findMany({
    where,
    orderBy: { externalId: "asc" },
    take: filters.limit ?? undefined,
    select: {
      id: true,
      externalId: true,
      numero: true,
      chave: true,
      status: true,
      xmlRaw: true,
      xmlDhEmi: true,
      dataProcessamento: true,
      xmlDestCnpjCpf: true,
      xmlVNF: true,
      valorLiquido: true,
      fiscalSummary: {
        select: {
          xmlHash: true,
          parserVersion: true,
          isCancelled: true,
          highlightedResidual: true,
          vNF: true,
          vIPI: true,
          taxLines: {
            where: { scope: "HEADER" },
            select: { taxType: true },
          },
        },
      },
    },
  });

  if (!rows.length) return [];

  const externalIds = rows.map((r) => r.externalId);
  const nfeIds = rows.map((r) => r.id);

  const [links, crGroups] = await Promise.all([
    prisma.salesOrderNfeLink.findMany({
      where: {
        OR: [
          { nfeExternalId: { in: externalIds } },
          { nomusNfeId: { in: nfeIds } },
        ],
      },
      select: {
        nomusNfeId: true,
        nfeExternalId: true,
        salesOrderId: true,
        orderCode: true,
        SalesOrder: { select: { orderCode: true, totalNetValue: true } },
      },
    }),
    prisma.nomusAccountsReceivable.groupBy({
      by: ["sourceInvoiceId"],
      where: { sourceInvoiceId: { in: externalIds } },
      _count: { _all: true },
    }),
  ]);

  const crByExternal = new Map<number, number>();
  for (const g of crGroups) {
    if (g.sourceInvoiceId != null) crByExternal.set(g.sourceInvoiceId, g._count._all);
  }

  const linksByExternal = new Map<number, typeof links>();
  const linksByNomusId = new Map<string, typeof links>();
  for (const link of links) {
    const arrE = linksByExternal.get(link.nfeExternalId) ?? [];
    arrE.push(link);
    linksByExternal.set(link.nfeExternalId, arrE);
    if (link.nomusNfeId) {
      const arrN = linksByNomusId.get(link.nomusNfeId) ?? [];
      arrN.push(link);
      linksByNomusId.set(link.nomusNfeId, arrN);
    }
  }

  return rows.map((row) => {
    const rowLinks = [
      ...(linksByNomusId.get(row.id) ?? []),
      ...(linksByExternal.get(row.externalId) ?? []),
    ];
    const seen = new Set<string>();
    const orderLinks: NfeFiscalBackfillCandidateInput["orderLinks"] = [];
    for (const l of rowLinks) {
      const key = l.salesOrderId;
      if (seen.has(key)) continue;
      seen.add(key);
      orderLinks.push({
        salesOrderId: l.salesOrderId,
        orderCode: l.orderCode ?? l.SalesOrder.orderCode ?? null,
        orderNetValue: decToNumber(l.SalesOrder.totalNetValue),
      });
    }

    const summary = row.fiscalSummary;
    return {
      id: row.id,
      externalId: row.externalId,
      numero: row.numero,
      chave: row.chave,
      status: row.status,
      xmlRaw: row.xmlRaw,
      xmlDhEmi: row.xmlDhEmi,
      dataProcessamento: row.dataProcessamento,
      xmlDestCnpjCpf: row.xmlDestCnpjCpf,
      xmlVNF: decToNumber(row.xmlVNF),
      valorLiquido: decToNumber(row.valorLiquido),
      orderLinks,
      crCount: crByExternal.get(row.externalId) ?? 0,
      existingSummary: summary
        ? {
            xmlHash: summary.xmlHash,
            parserVersion: summary.parserVersion,
            isCancelled: summary.isCancelled,
            highlightedResidual: decToNumber(summary.highlightedResidual),
            vNF: decToNumber(summary.vNF),
            vIPI: decToNumber(summary.vIPI),
            headerTaxTypes: summary.taxLines.map((t) => t.taxType),
          }
        : null,
    };
  });
}

function findDuplicateChaves(
  candidates: readonly NfeFiscalBackfillCandidateInput[]
): Array<{ chave: string; externalIds: number[] }> {
  const map = new Map<string, number[]>();
  for (const c of candidates) {
    const chave = (c.chave ?? "").trim();
    if (!chave) continue;
    const arr = map.get(chave) ?? [];
    arr.push(c.externalId);
    map.set(chave, arr);
  }
  const out: Array<{ chave: string; externalIds: number[] }> = [];
  for (const [chave, externalIds] of map) {
    if (new Set(externalIds).size > 1) {
      out.push({ chave, externalIds: [...new Set(externalIds)] });
    }
  }
  return out;
}

export function classifyCandidates(
  candidates: readonly NfeFiscalBackfillCandidateInput[],
  opts: { force: boolean; onlyMissing: boolean }
): NfeFiscalBackfillRowResult[] {
  return candidates.map((c) => classifyNfeFiscalBackfillRow(c, opts));
}

export async function previewNfeFiscalBackfill(
  prisma: PrismaLike,
  filters: NfeFiscalBackfillFilters
): Promise<NfeFiscalBackfillPreviewReport> {
  const candidates = await loadNfeFiscalBackfillCandidates(prisma, filters);
  const rows = classifyCandidates(candidates, {
    force: filters.force,
    onlyMissing: filters.onlyMissing,
  });
  const duplicateChaves = findDuplicateChaves(candidates);
  const findings = buildFindingsFromRows(rows, { duplicateChaves });
  const inventory = summarizeBackfillRows(rows);
  const taxTotalsHeader = aggregateHeaderTaxTotals(rows);
  let residualSum = 0;
  let residualCount = 0;
  const orderSet = new Set<string>();
  const watchOrders: Record<string, number> = {};

  for (const r of rows) {
    if (r.highlightedResidual != null && r.highlightedResidual > 0) {
      residualSum += r.highlightedResidual;
      residualCount += 1;
    }
    for (const oc of r.orderCodes) {
      orderSet.add(oc);
      const key = normalizeOrderCode(oc);
      if (r.watchOrderHit) watchOrders[key] = (watchOrders[key] ?? 0) + 1;
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    mode: "dry-run",
    parserVersion: NFE_FISCAL_PARSER_VERSION,
    filters,
    inventory,
    taxTotalsHeader,
    residualSum: Number(residualSum.toFixed(2)),
    residualCount,
    affectedOrderCodes: [...orderSet].sort(),
    watchOrders,
    findings,
    rows,
    risks: [...NFE_FISCAL_BACKFILL_RISKS],
    rollback: NFE_FISCAL_BACKFILL_ROLLBACK,
  };
}

export async function auditNfeFiscalBackfill(
  prisma: PrismaLike,
  filters: NfeFiscalBackfillFilters
): Promise<NfeFiscalBackfillPreviewReport> {
  const report = await previewNfeFiscalBackfill(prisma, filters);
  return {
    ...report,
    mode: "audit",
    findings: report.findings.filter((f) =>
      [
        "WATCH_ORDER",
        "NF_GT_ORDER",
        "TAX_NO_COMPOSITION",
        "NF_MULTI_ORDER",
        "CANCELLED_WITH_CR",
        "DUPLICATE_CHAVE",
        "MISSING_XML",
      ].includes(f.code)
    ),
  };
}

export async function applyNfeFiscalBackfill(
  prisma: PrismaLike,
  filters: NfeFiscalBackfillFilters
): Promise<NfeFiscalBackfillApplyReport> {
  const candidates = await loadNfeFiscalBackfillCandidates(prisma, filters);
  const classified = classifyCandidates(candidates, {
    force: filters.force,
    onlyMissing: filters.onlyMissing,
  });
  const actionable = classified.filter((r) => r.actionable && r.action === "persist");

  let persisted = 0;
  let skipped = classified.length - actionable.length;
  let errors = 0;
  const errorSamples: Array<{ externalId: number; message: string }> = [];
  const persistedNomusNfeIds: string[] = [];
  let lastExternalId: number | null = filters.afterExternalId;

  const batchSize = Math.max(1, filters.batchSize);

  for (let i = 0; i < actionable.length; i += batchSize) {
    const batch = actionable.slice(i, i + batchSize);
    for (const row of batch) {
      const candidate = candidates.find((c) => c.id === row.nomusNfeId);
      if (!candidate) {
        skipped += 1;
        continue;
      }
      try {
        await prisma.$transaction(async (tx) => {
          await ensureNomusNfeFiscalPersisted(tx, {
            nomusNfeId: candidate.id,
            xmlRaw: candidate.xmlRaw,
            status: candidate.status,
            force: filters.force,
          });
        });
        persisted += 1;
        persistedNomusNfeIds.push(candidate.id);
        lastExternalId = candidate.externalId;
      } catch (err) {
        errors += 1;
        if (errorSamples.length < 25) {
          errorSamples.push({
            externalId: candidate.externalId,
            message: err instanceof Error ? err.message : String(err),
          });
        }
        lastExternalId = candidate.externalId;
      }
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    mode: "apply",
    parserVersion: NFE_FISCAL_PARSER_VERSION,
    filters,
    attempted: actionable.length,
    persisted,
    skipped,
    errors,
    errorSamples,
    persistedNomusNfeIds,
    lastExternalId,
    risks: [...NFE_FISCAL_BACKFILL_RISKS],
    rollback: NFE_FISCAL_BACKFILL_ROLLBACK,
  };
}
