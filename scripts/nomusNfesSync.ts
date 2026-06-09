import "dotenv/config";
import { Prisma, PrismaClient } from "@prisma/client";
import {
  NFE_DISCARD_REASON_LABELS,
  summarizeNfeBillingPreview,
  type NfeDiscardReasonCode,
} from "@/src/lib/nomusNfeBillingEligibility.js";
import {
  persistNfesIntegrationRun,
  disconnectNfesIntegrationPrisma,
} from "@/src/lib/nomusNfesIntegrationRun.js";
import {
  buildNfesPageParams,
  computeNfesPaginationPlan,
  hasNextNfesPage,
  NOMUS_NFES_PAGE_SIZE,
  parseNfesSyncCli,
  pickNfesArray,
  resolveNfesSyncCutoffDate,
  type JsonObject,
} from "@/src/lib/nomusNfesSyncLogic.js";
import { mapNomusNfePayload, type MappedNomusNfe } from "@/src/lib/nomusNfeMapper.js";
import {
  buildNomusUrl,
  fetchNomusJson,
  redactHeadersForLog,
  redactNomusUrlForLog,
} from "@/src/lib/nomusRestClient.js";

const prisma = new PrismaClient();
const LOG_PREFIX = "[nomus-nfes]";

function getRequiredEnv(name: string): string {
  const value = (process.env[name] ?? "").trim();
  if (!value) throw new Error(`Variável obrigatória ausente: ${name}`);
  return value;
}

function toInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

async function fetchNfesPage(
  baseUrl: string,
  page: number,
  pageSize: number
): Promise<{ payload: unknown; items: JsonObject[] }> {
  const url = buildNomusUrl(baseUrl, "nfes", buildNfesPageParams(page, pageSize, process.env));
  const payload = await fetchNomusJson(url, { logPrefix: LOG_PREFIX });
  const items = pickNfesArray(payload).filter(
    (item): item is JsonObject => !!item && typeof item === "object" && !Array.isArray(item)
  );
  return { payload, items };
}

async function fetchAllPages(
  baseUrl: string,
  options: ReturnType<typeof parseNfesSyncCli>
): Promise<{
  pagesRead: number;
  recordsRead: number;
  rows: MappedNomusNfe[];
  mapErrors: number;
  mapErrorReasons: Record<string, number>;
  xmlQualityAlerts: number;
  cutoffDate: Date;
}> {
  const pageSize = Math.max(1, toInt(process.env.NOMUS_PAGE_SIZE) ?? NOMUS_NFES_PAGE_SIZE);
  const { firstPage, lastPage } = computeNfesPaginationPlan(options);
  const cutoffDate = resolveNfesSyncCutoffDate(options.incremental);

  const rows: MappedNomusNfe[] = [];
  const mapErrorReasons: Record<string, number> = {};
  let pagesRead = 0;
  let recordsRead = 0;
  let mapErrors = 0;
  let xmlQualityAlerts = 0;

  for (let page = firstPage; page <= lastPage; page += 1) {
    const { payload, items } = await fetchNfesPage(baseUrl, page, pageSize);
    pagesRead += 1;
    recordsRead += items.length;

    console.warn(`${LOG_PREFIX} página ${page} lida: ${items.length} registros.`);

    for (const item of items) {
      const mapped = mapNomusNfePayload(item);
      if (mapped.ok === false) {
        mapErrors += 1;
        for (const reason of mapped.reasons) {
          mapErrorReasons[reason] = (mapErrorReasons[reason] ?? 0) + 1;
        }
        continue;
      }
      if (mapped.row.xmlQualityAlert) {
        xmlQualityAlerts += 1;
      }
      rows.push(mapped.row);
    }

    if (!hasNextNfesPage(payload, page, items.length, pageSize)) break;
    if (options.singlePage != null) break;
  }

  return {
    pagesRead,
    recordsRead,
    rows,
    mapErrors,
    mapErrorReasons,
    xmlQualityAlerts,
    cutoffDate,
  };
}

function logDiscardBreakdown(
  discardCounts: Record<NfeDiscardReasonCode, number>,
  mapErrorReasons: Record<string, number>
): void {
  console.warn(`${LOG_PREFIX} ── Contadores de descarte (regra Power BI) ──`);
  for (const [code, label] of Object.entries(NFE_DISCARD_REASON_LABELS)) {
    const count = discardCounts[code as NfeDiscardReasonCode] ?? 0;
    if (count > 0) {
      console.warn(`${LOG_PREFIX}   ${label}: ${count}`);
    }
  }
  for (const [reason, count] of Object.entries(mapErrorReasons)) {
    if (count > 0) {
      console.warn(`${LOG_PREFIX}   Erro de mapeamento (${reason}): ${count}`);
    }
  }
}

function logMarketRevenueByMonth(
  marketRevenueByMonth: Record<string, { count: number; total: number }>
): void {
  const months = Object.keys(marketRevenueByMonth).sort();
  if (months.length === 0) {
    console.warn(`${LOG_PREFIX} ── MARKET_REVENUE por mês: nenhum título elegível ──`);
    return;
  }
  console.warn(`${LOG_PREFIX} ── MARKET_REVENUE (isMarketSale=true) por mês ──`);
  for (const month of months) {
    const bucket = marketRevenueByMonth[month]!;
    console.warn(
      `${LOG_PREFIX}   ${month}: ${bucket.count} NF-e · R$ ${bucket.total.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    );
  }
  const june2026 = marketRevenueByMonth["2026-06"];
  if (june2026) {
    console.warn(
      `${LOG_PREFIX} ► Jun/2026 esperado (nova regra): ${june2026.count} NF-e · R$ ${june2026.total.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    );
  }
}

function buildPrismaData(row: MappedNomusNfe, syncedAt: Date) {
  return {
    externalId: row.externalId,
    chave: row.chave,
    numero: row.numero,
    serie: row.serie,
    status: row.status,
    tipoOperacao: row.tipoOperacao,
    tipoEmissao: row.tipoEmissao,
    finalidade: row.finalidade,
    isFornecedor: row.isFornecedor,
    ambiente: row.ambiente,
    cnpjEmitente: row.cnpjEmitente,
    protocolo: row.protocolo,
    recibo: row.recibo,
    dataProcessamento: row.dataProcessamento,
    horaProcessamento: row.horaProcessamento,
    xmlRaw: row.xmlRaw,
    xmlCancelamento: row.xmlCancelamento,
    justificativaCancelamento: row.justificativaCancelamento,
    xmlNatOp: row.xmlNatOp,
    xmlDhEmi: row.xmlDhEmi,
    xmlTpNF: row.xmlTpNF,
    xmlDestCnpjCpf: row.xmlDestCnpjCpf,
    xmlVProd: row.xmlVProd,
    xmlVDesc: row.xmlVDesc,
    xmlVNF: row.xmlVNF,
    valorLiquido: row.valorLiquido,
    billingClassification: row.billingClassification,
    isFiscalBilling: row.isFiscalBilling,
    isMarketSale: row.isMarketSale,
    xmlQualityAlert: row.xmlQualityAlert,
    rawPayload: row.rawPayload as Prisma.InputJsonValue,
    payloadHash: row.payloadHash,
    syncedAt,
  };
}

async function runApply(rows: MappedNomusNfe[], syncedAt: Date) {
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let errors = 0;

  for (const row of rows) {
    try {
      const data = buildPrismaData(row, syncedAt);
      const existing = await prisma.nomusNfe.findUnique({
        where: { externalId: row.externalId },
        select: { id: true, payloadHash: true },
      });

      if (!existing) {
        await prisma.nomusNfe.create({ data });
        created += 1;
        continue;
      }

      if (existing.payloadHash === row.payloadHash) {
        await prisma.nomusNfe.update({
          where: { externalId: row.externalId },
          data: { syncedAt },
        });
        unchanged += 1;
        continue;
      }

      await prisma.nomusNfe.update({
        where: { externalId: row.externalId },
        data,
      });
      updated += 1;
    } catch {
      errors += 1;
    }
  }

  return { created, updated, unchanged, errors };
}

async function main(): Promise<void> {
  const runStartedAt = new Date();
  const startedMs = Date.now();
  const options = parseNfesSyncCli(process.argv.slice(2));
  const baseUrl = getRequiredEnv("NOMUS_BASE_URL");
  const runnerLogFile = (process.env.NOMUS_NFE_RUNNER_LOG ?? "").trim() || null;

  const headers = redactHeadersForLog(
    Object.fromEntries(
      Object.entries(process.env)
        .filter(([key]) => key.startsWith("NOMUS_") && !key.includes("VALUE") && !key.includes("TOKEN"))
        .map(([key, value]) => [key, value ?? ""])
    )
  );

  console.warn(
    `${LOG_PREFIX} modo=${options.mode} incremental=${options.incremental} strategy=${options.syncStrategy} startPage=${options.startPage} maxPages=${options.maxPages}`
  );
  console.warn(`${LOG_PREFIX} auth headers (redigidos): ${JSON.stringify(headers)}`);

  const sampleUrl = buildNomusUrl(baseUrl, "nfes", { pagina: "1" });
  console.warn(`${LOG_PREFIX} endpoint=${redactNomusUrlForLog(sampleUrl)}`);

  let exitCode = 0;
  let errorMessage: string | null = null;

  let fetched = {
    pagesRead: 0,
    recordsRead: 0,
    rows: [] as MappedNomusNfe[],
    mapErrors: 0,
    mapErrorReasons: {} as Record<string, number>,
    xmlQualityAlerts: 0,
    cutoffDate: resolveNfesSyncCutoffDate(options.incremental),
  };
  let applied: Awaited<ReturnType<typeof runApply>> | null = null;
  let billingPreview = {
    discardCounts: {} as Record<NfeDiscardReasonCode, number>,
    marketRevenueEligible: 0,
    marketRevenueByMonth: {} as Record<string, { count: number; total: number }>,
    marketRevenueFlagMismatches: 0,
  };

  try {
    fetched = await fetchAllPages(baseUrl, options);
    billingPreview = summarizeNfeBillingPreview(fetched.rows, fetched.cutoffDate);

    logDiscardBreakdown(billingPreview.discardCounts, fetched.mapErrorReasons);
    logMarketRevenueByMonth(billingPreview.marketRevenueByMonth);

    if (billingPreview.marketRevenueFlagMismatches > 0) {
      console.warn(
        `${LOG_PREFIX} ⚠ ${billingPreview.marketRevenueFlagMismatches} NF-e MARKET_REVENUE elegíveis com isMarketSale=false (verificar flags)`
      );
    }

    const syncedAt = new Date();
    applied = options.mode === "apply" ? await runApply(fetched.rows, syncedAt) : null;
  } catch (error) {
    exitCode = 1;
    errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`${LOG_PREFIX} falha`, errorMessage);
  }

  const durationMs = Date.now() - startedMs;
  const finishedAt = new Date();
  const filteredOut = fetched.recordsRead - fetched.rows.length - fetched.mapErrors;

  const summary = {
    syncStrategy: options.syncStrategy,
    incremental: options.incremental,
    cutoffDate: fetched.cutoffDate.toISOString(),
    pagesRead: fetched.pagesRead,
    recordsRead: fetched.recordsRead,
    mapped: fetched.rows.length,
    filteredOut,
    mapErrors: fetched.mapErrors,
    mapErrorReasons: fetched.mapErrorReasons,
    xmlQualityAlerts: fetched.xmlQualityAlerts,
    discardCounts: billingPreview.discardCounts,
    marketRevenueEligible: billingPreview.marketRevenueEligible,
    marketRevenueByMonth: billingPreview.marketRevenueByMonth,
    marketRevenueFlagMismatches: billingPreview.marketRevenueFlagMismatches,
    durationMs,
    ...(applied ?? {}),
  };

  console.warn(
    `${LOG_PREFIX} concluído em ${(durationMs / 1000).toFixed(1)}s — páginas=${summary.pagesRead} lidos=${summary.recordsRead} mapeados=${summary.mapped} filtrados=${summary.filteredOut} erros_map=${summary.mapErrors} market_revenue_elegíveis=${summary.marketRevenueEligible} criados=${applied?.created ?? 0} atualizados=${applied?.updated ?? 0} inalterados=${applied?.unchanged ?? 0} erros_apply=${applied?.errors ?? 0}`
  );

  const payload = {
    mode: options.mode,
    summary,
    applied,
    preview: fetched.rows.slice(0, 5).map((row) => ({
      externalId: row.externalId,
      numero: row.numero,
      status: row.status,
      dataProcessamento: row.dataProcessamento?.toISOString() ?? null,
      xmlDhEmi: row.xmlDhEmi?.toISOString() ?? null,
      xmlTpNF: row.xmlTpNF,
      valorLiquido: row.valorLiquido?.toString() ?? null,
      billingClassification: row.billingClassification,
      isFiscalBilling: row.isFiscalBilling,
      isMarketSale: row.isMarketSale,
      xmlQualityAlert: row.xmlQualityAlert,
      payloadHash: row.payloadHash.slice(0, 12),
    })),
  };

  console.log(JSON.stringify(payload, null, 2));

  if (options.mode === "apply") {
    await persistNfesIntegrationRun({
      mode: "apply",
      startedAt: runStartedAt,
      finishedAt,
      durationMs,
      exitCode,
      logFile: runnerLogFile,
      command: "sync:nomus:nfes:apply",
      summary,
      applied,
      errorMessage,
    });
  }

  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
}

main()
  .catch((error) => {
    console.error(`${LOG_PREFIX} falha`, error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await disconnectNfesIntegrationPrisma();
  });
