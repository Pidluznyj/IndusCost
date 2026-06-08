import "dotenv/config";
import { Prisma, PrismaClient } from "@prisma/client";
import {
  persistAccountsPayableIntegrationRun,
  disconnectAccountsPayableIntegrationPrisma,
} from "@/src/lib/nomusAccountsPayableIntegrationRun.js";
import {
  buildAccountsPayablePageParams,
  computePaginationPlan,
  hasNextAccountsPayablePage,
  NOMUS_ACCOUNTS_PAYABLE_PAGE_SIZE,
  parseAccountsPayableSyncCli,
  pickAccountsPayableArray,
  type JsonObject,
} from "@/src/lib/nomusAccountsPayableSyncLogic.js";
import {
  mapNomusAccountsPayablePayload,
  type MappedNomusAccountsPayable,
} from "@/src/lib/nomusAccountsPayableMapper.js";
import {
  buildNomusUrl,
  fetchNomusJson,
  redactHeadersForLog,
  redactNomusUrlForLog,
} from "@/src/lib/nomusRestClient.js";

const prisma = new PrismaClient();
const LOG_PREFIX = "[nomus-accounts-payable]";

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

async function fetchAccountsPayablePage(
  baseUrl: string,
  page: number,
  pageSize: number
): Promise<{ payload: unknown; items: JsonObject[] }> {
  const url = buildNomusUrl(
    baseUrl,
    "contasPagar",
    buildAccountsPayablePageParams(page, pageSize, process.env)
  );
  const payload = await fetchNomusJson(url, { logPrefix: LOG_PREFIX });
  const items = pickAccountsPayableArray(payload).filter(
    (item): item is JsonObject => !!item && typeof item === "object" && !Array.isArray(item)
  );
  return { payload, items };
}

async function fetchAllPages(
  baseUrl: string,
  options: ReturnType<typeof parseAccountsPayableSyncCli>
): Promise<{ pagesRead: number; recordsRead: number; rows: MappedNomusAccountsPayable[]; errors: number }> {
  const pageSize =
    Math.max(1, toInt(process.env.NOMUS_PAGE_SIZE) ?? NOMUS_ACCOUNTS_PAYABLE_PAGE_SIZE);
  const { firstPage, lastPage } = computePaginationPlan(options);

  const rows: MappedNomusAccountsPayable[] = [];
  let pagesRead = 0;
  let recordsRead = 0;
  let errors = 0;

  for (let page = firstPage; page <= lastPage; page += 1) {
    const { payload, items } = await fetchAccountsPayablePage(baseUrl, page, pageSize);
    pagesRead += 1;
    recordsRead += items.length;

    console.warn(`${LOG_PREFIX} página ${page} lida: ${items.length} registros.`);

    for (const item of items) {
      const mapped = mapNomusAccountsPayablePayload(item);
      if (!mapped.ok) {
        errors += 1;
        continue;
      }
      rows.push(mapped.row);
    }

    if (!hasNextAccountsPayablePage(payload, page, items.length, pageSize)) break;
    if (options.singlePage != null) break;
  }

  return { pagesRead, recordsRead, rows, errors };
}

function buildPrismaData(row: MappedNomusAccountsPayable, syncedAt: Date) {
  return {
    externalId: row.externalId,
    classification: row.classification,
    type: row.type,
    status: row.status,
    companyId: row.companyId,
    companyName: row.companyName,
    personId: row.personId,
    personName: row.personName,
    personCnpj: row.personCnpj,
    personPhone: row.personPhone,
    bankAccountId: row.bankAccountId,
    bankAccountName: row.bankAccountName,
    paymentMethodId: row.paymentMethodId,
    paymentMethodName: row.paymentMethodName,
    dueDate: row.dueDate,
    competenceDate: row.competenceDate,
    scheduleDate: row.scheduleDate,
    createdAtNomus: row.createdAtNomus,
    modifiedAtNomus: row.modifiedAtNomus,
    settlementDate: row.settlementDate,
    paymentDate: row.paymentDate,
    amountPayable: row.amountPayable,
    amountScheduled: row.amountScheduled,
    amountPaid: row.amountPaid,
    balancePayable: row.balancePayable,
    description: row.description,
    comments: row.comments,
    documentNumber: row.documentNumber,
    sourceInvoiceId: row.sourceInvoiceId,
    sourceInvoiceNumber: row.sourceInvoiceNumber,
    suspendPayment: row.suspendPayment,
    lateFeePercent: row.lateFeePercent,
    monthlyInterestRate: row.monthlyInterestRate,
    lateFeeCalculationType: row.lateFeeCalculationType,
    lateInterestType: row.lateInterestType,
    rawPayload: row.rawPayload as Prisma.InputJsonValue,
    payloadHash: row.payloadHash,
    syncedAt,
  };
}

async function runApply(rows: MappedNomusAccountsPayable[], syncedAt: Date) {
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let errors = 0;

  for (const row of rows) {
    try {
      const data = buildPrismaData(row, syncedAt);
      const existing = await prisma.nomusAccountsPayable.findUnique({
        where: { externalId: row.externalId },
        select: { id: true, payloadHash: true },
      });

      if (!existing) {
        await prisma.nomusAccountsPayable.create({ data });
        created += 1;
        continue;
      }

      if (existing.payloadHash === row.payloadHash) {
        await prisma.nomusAccountsPayable.update({
          where: { externalId: row.externalId },
          data: { syncedAt },
        });
        unchanged += 1;
        continue;
      }

      await prisma.nomusAccountsPayable.update({
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
  const options = parseAccountsPayableSyncCli(process.argv.slice(2));
  const baseUrl = getRequiredEnv("NOMUS_BASE_URL");
  const runnerLogFile = (process.env.NOMUS_AP_RUNNER_LOG ?? "").trim() || null;

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

  const sampleUrl = buildNomusUrl(baseUrl, "contasPagar", { pagina: "1" });
  console.warn(`${LOG_PREFIX} endpoint=${redactNomusUrlForLog(sampleUrl)}`);

  let exitCode = 0;
  let errorMessage: string | null = null;

  let fetched = { pagesRead: 0, recordsRead: 0, rows: [] as MappedNomusAccountsPayable[], errors: 0 };
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
    mapped: fetched.rows.length,
    mapErrors: fetched.errors,
    durationMs,
    ...(applied ?? {}),
  };

  console.warn(
    `${LOG_PREFIX} concluído em ${(durationMs / 1000).toFixed(1)}s — páginas=${summary.pagesRead} lidos=${summary.recordsRead} mapeados=${summary.mapped} criados=${applied?.created ?? 0} atualizados=${applied?.updated ?? 0} inalterados=${applied?.unchanged ?? 0} erros=${(applied?.errors ?? 0) + summary.mapErrors}`
  );

  const payload = {
    mode: options.mode,
    summary,
    applied,
    preview: fetched.rows.slice(0, 5).map((row) => ({
      externalId: row.externalId,
      personName: row.personName,
      dueDate: row.dueDate?.toISOString() ?? null,
      balancePayable: row.balancePayable?.toString() ?? null,
      status: row.status,
      payloadHash: row.payloadHash.slice(0, 12),
    })),
  };

  console.log(JSON.stringify(payload, null, 2));

  if (options.mode === "apply") {
    await persistAccountsPayableIntegrationRun({
      mode: "apply",
      startedAt: runStartedAt,
      finishedAt,
      durationMs,
      exitCode,
      logFile: runnerLogFile,
      command: "sync:nomus:accounts-payable:apply",
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
    await disconnectAccountsPayableIntegrationPrisma();
  });
