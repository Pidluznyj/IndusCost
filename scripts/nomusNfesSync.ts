import "dotenv/config";
import { Prisma, PrismaClient } from "@prisma/client";
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
  passesNfesSyncLocalFilter,
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
  filteredOut: number;
  rows: MappedNomusNfe[];
  errors: number;
  xmlQualityAlerts: number;
}> {
  const pageSize = Math.max(1, toInt(process.env.NOMUS_PAGE_SIZE) ?? NOMUS_NFES_PAGE_SIZE);
  const { firstPage, lastPage } = computeNfesPaginationPlan(options);
  const cutoffDate = resolveNfesSyncCutoffDate(options.incremental);

  const rows: MappedNomusNfe[] = [];
  let pagesRead = 0;
  let recordsRead = 0;
  let filteredOut = 0;
  let errors = 0;
  let xmlQualityAlerts = 0;

  for (let page = firstPage; page <= lastPage; page += 1) {
    const { payload, items } = await fetchNfesPage(baseUrl, page, pageSize);
    pagesRead += 1;
    recordsRead += items.length;

    console.warn(`${LOG_PREFIX} página ${page} lida: ${items.length} registros.`);

    for (const item of items) {
      const filterResult = passesNfesSyncLocalFilter(item, cutoffDate);
      if (!filterResult.pass) {
        filteredOut += 1;
        continue;
      }

      const mapped = mapNomusNfePayload(item);
      if (!mapped.ok) {
        errors += 1;
        continue;
      }
      if (mapped.row.xmlQualityAlert) {
        xmlQualityAlerts += 1;
        console.warn(
          `${LOG_PREFIX} alerta XML externalId=${mapped.row.externalId}: ${mapped.row.xmlQualityAlert}`
        );
      }
      rows.push(mapped.row);
    }

    if (!hasNextNfesPage(payload, page, items.length, pageSize)) break;
    if (options.singlePage != null) break;
  }

  return { pagesRead, recordsRead, filteredOut, rows, errors, xmlQualityAlerts };
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
    filteredOut: 0,
    rows: [] as MappedNomusNfe[],
    errors: 0,
    xmlQualityAlerts: 0,
  };
  let applied: Awaited<ReturnType<typeof runApply>> | null = null;

  try {
    fetched = await fetchAllPages(baseUrl, options);
    const syncedAt = new Date();
    applied = options.mode === "apply" ? await runApply(fetched.rows, syncedAt) : null;
  } catch (error) {
    exitCode = 1;
    errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`${LOG_PREFIX} falha`, errorMessage);
  }

  const durationMs = Date.now() - startedMs;
  const finishedAt = new Date();

  const summary = {
    syncStrategy: options.syncStrategy,
    incremental: options.incremental,
    pagesRead: fetched.pagesRead,
    recordsRead: fetched.recordsRead,
    filteredOut: fetched.filteredOut,
    mapped: fetched.rows.length,
    mapErrors: fetched.errors,
    xmlQualityAlerts: fetched.xmlQualityAlerts,
    durationMs,
    ...(applied ?? {}),
  };

  console.warn(
    `${LOG_PREFIX} concluído em ${(durationMs / 1000).toFixed(1)}s — páginas=${summary.pagesRead} lidos=${summary.recordsRead} filtrados=${summary.filteredOut} mapeados=${summary.mapped} criados=${applied?.created ?? 0} atualizados=${applied?.updated ?? 0} inalterados=${applied?.unchanged ?? 0} erros=${(applied?.errors ?? 0) + summary.mapErrors}`
  );

  const payload = {
    mode: options.mode,
    summary,
    applied,
    preview: fetched.rows.slice(0, 5).map((row) => ({
      externalId: row.externalId,
      numero: row.numero,
      dataProcessamento: row.dataProcessamento?.toISOString() ?? null,
      xmlDhEmi: row.xmlDhEmi?.toISOString() ?? null,
      valorLiquido: row.valorLiquido?.toString() ?? null,
      billingClassification: row.billingClassification,
      isMarketSale: row.isMarketSale,
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
