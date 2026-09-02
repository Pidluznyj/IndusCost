/**
 * Sync canônico de Recebimentos Nomus (`GET /rest/recebimentos`) → `NomusReceivableReceipt`.
 *
 * Fonte oficial da COMPETÊNCIA da comissão (`dataRecebimento`). A baixa do
 * Contas a Receber (`dataBaixa` → `settlementDate`) segue intocada e continua
 * significando baixa administrativa.
 *
 * Uso:
 *   tsx scripts/nomusReceivableReceiptsSync.ts preview
 *   tsx scripts/nomusReceivableReceiptsSync.ts preview --page 1
 *   tsx scripts/nomusReceivableReceiptsSync.ts apply --maxPages 40
 *   tsx scripts/nomusReceivableReceiptsSync.ts apply --since 2026-01-01   (backfill)
 *
 * Rotina automática diária (full scan determinístico, sem `--since`):
 *   tsx scripts/nomusReceivableReceiptsSync.ts apply --maxPages 200 --json --require-full-scan
 *
 * `preview` NÃO grava nada. `apply` é explícito.
 * HTTP/retry/429/backoff/redaction vêm de `fetchNomusJson` — nenhum cliente paralelo.
 *
 * EXIT CODE: 0 só quando a execução é defensável. Falha de gravação sempre
 * derruba; varredura truncada derruba quando `--require-full-scan` foi pedido.
 * Ver `resolveReceiptsRunStatus` para o contrato completo.
 */

import "dotenv/config";
import { Prisma, PrismaClient } from "@prisma/client";
import {
  buildNomusUrl,
  describeNomusCredential,
  fetchNomusJson,
} from "@/src/lib/nomusRestClient.js";
import {
  isNomusReceiptMapFailure,
  isNomusReceiptMapSuccess,
  mapNomusReceivableReceiptPayload,
  type MappedNomusReceivableReceipt,
  type NomusReceiptMapReason,
} from "@/src/lib/nomus/nomusReceivableReceiptMapper.js";
import {
  assessReceiptsFullScan,
  buildReceiptsPageParams,
  computeReceiptsPaginationPlan,
  hasNextReceiptsPage,
  NOMUS_RECEIPTS_PAGE_SIZE,
  pageIsFullyBeforeSince,
  parseReceiptsSyncCli,
  pickReceiptsArray,
  resolveReceiptsRunStatus,
  type JsonObject,
  type ReceiptsSyncCliOptions,
} from "@/src/lib/nomus/nomusReceivableReceiptsSyncLogic.js";
import { toCivilDateKey } from "@/src/lib/financeCivilDate.js";

const prisma = new PrismaClient();
const LOG_PREFIX = "[nomus-receivable-receipts]";
const RESOURCE = "recebimentos";

function getRequiredEnv(name: string): string {
  const value = (process.env[name] ?? "").trim();
  if (!value) throw new Error(`Variável obrigatória ausente: ${name}`);
  return value;
}

async function fetchReceiptsPage(
  baseUrl: string,
  page: number
): Promise<{ payload: unknown; items: JsonObject[] }> {
  const url = buildNomusUrl(baseUrl, RESOURCE, buildReceiptsPageParams(page));
  const payload = await fetchNomusJson(url, {
    logPrefix: LOG_PREFIX,
    logContext: { recurso: RESOURCE, pagina: page },
  });
  const items = pickReceiptsArray(payload).filter(
    (item): item is JsonObject => !!item && typeof item === "object" && !Array.isArray(item)
  );
  return { payload, items };
}

type FetchResult = {
  pagesRead: number;
  recordsRead: number;
  rows: MappedNomusReceivableReceipt[];
  rejected: Array<{ externalId: number | null; reasons: NomusReceiptMapReason[] }>;
  duplicateExternalIds: number[];
  /**
   * Todo id devolvido pela origem nesta varredura — inclusive os rejeitados no
   * mapeamento. Um payload que passou a falhar a validação continua tendo sido
   * DEVOLVIDO pelo Nomus; tratá-lo como ausente geraria alarme falso na
   * reconciliação.
   */
  seenExternalIds: Set<number>;
  stoppedBecauseEmpty: boolean;
  stoppedBecauseNoNext: boolean;
  stoppedBecauseMaxPages: boolean;
  stoppedBecauseSince: boolean;
};

async function fetchAllPages(
  baseUrl: string,
  options: ReceiptsSyncCliOptions
): Promise<FetchResult> {
  const { firstPage, lastPage } = computeReceiptsPaginationPlan(options);

  const byExternalId = new Map<number, MappedNomusReceivableReceipt>();
  const duplicateExternalIds: number[] = [];
  const rejected: FetchResult["rejected"] = [];
  const seenExternalIds = new Set<number>();
  let pagesRead = 0;
  let recordsRead = 0;
  let stoppedBecauseEmpty = false;
  let stoppedBecauseNoNext = false;
  let stoppedBecauseMaxPages = false;
  let stoppedBecauseSince = false;

  for (let page = firstPage; page <= lastPage; page += 1) {
    const { payload, items } = await fetchReceiptsPage(baseUrl, page);
    pagesRead += 1;
    recordsRead += items.length;

    const pageCivilDates: Array<string | null> = [];
    for (const item of items) {
      const mapped = mapNomusReceivableReceiptPayload(item);
      if (isNomusReceiptMapFailure(mapped)) {
        rejected.push({ externalId: mapped.externalId, reasons: mapped.reasons });
        // Rejeitado no mapeamento ainda assim foi devolvido pela origem.
        if (mapped.externalId != null) seenExternalIds.add(mapped.externalId);
        pageCivilDates.push(null);
        continue;
      }
      if (!isNomusReceiptMapSuccess(mapped)) continue;
      const row = mapped.row;
      seenExternalIds.add(row.externalId);
      pageCivilDates.push(toCivilDateKey(row.receiptDate));
      // `recebimentos.id` é a identidade do evento: nunca duplicar na mesma rodada.
      if (byExternalId.has(row.externalId)) {
        duplicateExternalIds.push(row.externalId);
      }
      byExternalId.set(row.externalId, row);
    }

    console.warn(`${LOG_PREFIX} página ${page} lida: ${items.length} registros.`);

    if (items.length === 0) {
      stoppedBecauseEmpty = true;
      break;
    }
    if (options.singlePage != null) {
      stoppedBecauseMaxPages = true;
      break;
    }
    if (pageIsFullyBeforeSince(pageCivilDates, options.sinceCivilDate)) {
      stoppedBecauseSince = true;
      break;
    }
    if (!hasNextReceiptsPage(payload, page, items.length, NOMUS_RECEIPTS_PAGE_SIZE)) {
      stoppedBecauseNoNext = true;
      break;
    }
    if (page === lastPage) stoppedBecauseMaxPages = true;
  }

  return {
    pagesRead,
    recordsRead,
    rows: [...byExternalId.values()],
    rejected,
    duplicateExternalIds: [...new Set(duplicateExternalIds)],
    seenExternalIds,
    stoppedBecauseEmpty,
    stoppedBecauseNoNext,
    stoppedBecauseMaxPages,
    stoppedBecauseSince,
  };
}

function buildPrismaData(
  row: MappedNomusReceivableReceipt,
  syncedAt: Date
): Prisma.NomusReceivableReceiptUncheckedCreateInput {
  return {
    externalId: row.externalId,
    receivableExternalId: row.receivableExternalId,
    receiptDate: row.receiptDate,
    competenceDate: row.competenceDate,
    closesReceivable: row.closesReceivable,
    receivedAmount: row.receivedAmount,
    bankFeeAmount: row.bankFeeAmount,
    lateFeeInterestAmount: row.lateFeeInterestAmount,
    discountAmount: row.discountAmount,
    code: row.code,
    description: row.description,
    comments: row.comments,
    companyId: row.companyId,
    companyName: row.companyName,
    personId: row.personId,
    personName: row.personName,
    bankAccountId: row.bankAccountId,
    bankAccountName: row.bankAccountName,
    paymentMethodId: row.paymentMethodId,
    paymentMethodName: row.paymentMethodName,
    financialClassificationId: row.financialClassificationId,
    financialClassificationName: row.financialClassificationName,
    createdByUserId: row.createdByUserId,
    createdByUserName: row.createdByUserName,
    createdAtNomus: row.createdAtNomus,
    modifiedAtNomus: row.modifiedAtNomus,
    rawPayload: row.rawPayload as Prisma.InputJsonValue,
    payloadHash: row.payloadHash,
    syncedAt,
  };
}

/**
 * Upsert idempotente por `externalId`.
 * Recebimento NÃO é imutável (o payload traz `dataModificacao`): quando o hash
 * muda, o mesmo evento é atualizado — nunca duplicado.
 */
async function runApply(rows: MappedNomusReceivableReceipt[], syncedAt: Date) {
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let errors = 0;
  const affectedReceivableIds: number[] = [];

  for (const row of rows) {
    try {
      const existing = await prisma.nomusReceivableReceipt.findUnique({
        where: { externalId: row.externalId },
        select: { id: true, payloadHash: true },
      });
      const data = buildPrismaData(row, syncedAt);

      if (!existing) {
        await prisma.nomusReceivableReceipt.create({ data });
        created += 1;
        affectedReceivableIds.push(row.receivableExternalId);
        continue;
      }

      if (existing.payloadHash === row.payloadHash) {
        await prisma.nomusReceivableReceipt.update({
          where: { externalId: row.externalId },
          data: { syncedAt },
        });
        unchanged += 1;
        continue;
      }

      await prisma.nomusReceivableReceipt.update({
        where: { externalId: row.externalId },
        data,
      });
      updated += 1;
      affectedReceivableIds.push(row.receivableExternalId);
    } catch (error) {
      errors += 1;
      console.error(
        `${LOG_PREFIX} falha ao gravar recebimento ${row.externalId}: ${
          error instanceof Error ? error.message : "erro desconhecido"
        }`
      );
    }
  }

  return {
    created,
    updated,
    unchanged,
    errors,
    affectedReceivableIds: [...new Set(affectedReceivableIds)],
  };
}

/** Cobertura do vínculo determinístico `idContaReceber` → `NomusAccountsReceivable`. */
async function reportUnlinkedReceipts(rows: MappedNomusReceivableReceipt[]) {
  const receivableIds = [...new Set(rows.map((row) => row.receivableExternalId))];
  if (receivableIds.length === 0) {
    return { linked: 0, unlinked: 0, unlinkedReceivableIds: [] as number[] };
  }
  const known = await prisma.nomusAccountsReceivable.findMany({
    where: { externalId: { in: receivableIds } },
    select: { externalId: true },
  });
  const knownSet = new Set(known.map((row) => row.externalId));
  const unlinkedReceivableIds = receivableIds.filter((id) => !knownSet.has(id));
  const linked = rows.filter((row) => knownSet.has(row.receivableExternalId)).length;
  return {
    linked,
    unlinked: rows.length - linked,
    unlinkedReceivableIds: unlinkedReceivableIds.sort((a, b) => a - b),
  };
}

/**
 * Auditoria de ausência: recebimentos que existem localmente e NÃO apareceram
 * na varredura da origem.
 *
 * Só faz sentido com prova de varredura completa — numa varredura truncada,
 * "não apareceu" significa apenas "não chegamos lá", e o alarme seria falso.
 *
 * NUNCA apaga, nunca marca estorno, nunca mexe em comissão. O endpoint
 * `/rest/recebimentos` não expõe `deleted`, `cancelled` nem status de estorno,
 * então não existe contrato documental que prove semântica de exclusão. Sem
 * esse contrato, apagar um recebimento seria inventar um fato financeiro.
 * O que se faz aqui é contar, amostrar e deixar rastro auditável.
 */
async function auditReceiptsMissingInSource(seenExternalIds: Set<number>): Promise<{
  localTotal: number;
  missing: number[];
}> {
  const local = await prisma.nomusReceivableReceipt.findMany({
    select: { externalId: true },
  });
  const missing = local
    .map((row) => row.externalId)
    .filter((externalId) => !seenExternalIds.has(externalId))
    .sort((a, b) => a - b);
  return { localTotal: local.length, missing };
}

function summarizeCivilRange(rows: MappedNomusReceivableReceipt[]): {
  min: string | null;
  max: string | null;
} {
  const keys = rows
    .map((row) => toCivilDateKey(row.receiptDate))
    .filter((key): key is string => key != null)
    .sort();
  return { min: keys[0] ?? null, max: keys[keys.length - 1] ?? null };
}

async function main() {
  const options = parseReceiptsSyncCli(process.argv.slice(2));
  const baseUrl = getRequiredEnv("NOMUS_BASE_URL");
  const syncedAt = new Date();

  const credential = describeNomusCredential(
    process.env.NOMUS_TOKEN ?? process.env.NOMUS_AUTH_HEADER_VALUE
  );
  console.warn(
    `${LOG_PREFIX} modo=${options.mode} startPage=${options.startPage} maxPages=${options.maxPages}` +
      `${options.sinceCivilDate ? ` since=${options.sinceCivilDate}` : ""}` +
      `${options.requireFullScan ? " requireFullScan=1" : ""}` +
      ` credencial={presente:${credential.present},len:${credential.length},hash12:${credential.hash12}}`
  );

  const fetched = await fetchAllPages(baseUrl, options);
  const civilRange = summarizeCivilRange(fetched.rows);
  const linkage = await reportUnlinkedReceipts(fetched.rows);
  const fullScan = assessReceiptsFullScan({
    startPage: options.startPage,
    singlePage: options.singlePage,
    sinceCivilDate: options.sinceCivilDate,
    stoppedBecauseEmpty: fetched.stoppedBecauseEmpty,
    stoppedBecauseNoNext: fetched.stoppedBecauseNoNext,
    stoppedBecauseMaxPages: fetched.stoppedBecauseMaxPages,
    stoppedBecauseSince: fetched.stoppedBecauseSince,
  });

  const summary: Record<string, unknown> = {
    modo: options.mode,
    paginas_lidas: fetched.pagesRead,
    registros_lidos: fetched.recordsRead,
    recebimentos_validos: fetched.rows.length,
    recebimentos_rejeitados: fetched.rejected.length,
    ids_duplicados_na_rodada: fetched.duplicateExternalIds.length,
    data_recebimento_min: civilRange.min,
    data_recebimento_max: civilRange.max,
    vinculados_ao_cr_local: linkage.linked,
    sem_cr_local: linkage.unlinked,
    sem_cr_local_ids: linkage.unlinkedReceivableIds.slice(0, 50),
    parou_por_pagina_vazia: fetched.stoppedBecauseEmpty,
    parou_por_fim_da_paginacao: fetched.stoppedBecauseNoNext,
    parou_por_max_paginas: fetched.stoppedBecauseMaxPages,
    parou_por_since: fetched.stoppedBecauseSince,
    varredura_completa: fullScan.complete,
    exigiu_varredura_completa: options.requireFullScan,
  };

  if (!fullScan.complete) {
    summary.varredura_bloqueios = fullScan.blockers;
  }

  if (fetched.rejected.length > 0) {
    const reasonCounts = new Map<string, number>();
    for (const item of fetched.rejected) {
      for (const reason of item.reasons) {
        reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
      }
    }
    summary.motivos_rejeicao = Object.fromEntries(reasonCounts);
  }

  let writeErrors = 0;
  if (options.mode === "apply") {
    const applied = await runApply(fetched.rows, syncedAt);
    writeErrors = applied.errors;
    summary.criados = applied.created;
    summary.atualizados = applied.updated;
    summary.inalterados = applied.unchanged;
    summary.erros_gravacao = applied.errors;
    summary.titulos_afetados = applied.affectedReceivableIds.length;
  } else {
    summary.preview_sem_gravacao = true;
  }

  // Ausência só é avaliada quando a varredura provou cobrir a origem inteira.
  let missingInSource = 0;
  summary.reconciliacao_avaliada = fullScan.complete;
  if (fullScan.complete) {
    const audit = await auditReceiptsMissingInSource(fetched.seenExternalIds);
    missingInSource = audit.missing.length;
    summary.recebimentos_locais = audit.localTotal;
    summary.ausentes_na_origem = missingInSource;
    summary.ausentes_na_origem_ids = audit.missing.slice(0, 50);
    if (missingInSource > 0) {
      console.warn(
        `${LOG_PREFIX} ALERTA: ${missingInSource} recebimento(s) existem localmente e NÃO ` +
          `apareceram na varredura completa da origem. NENHUM foi apagado ou alterado. ` +
          `Amostra: ${JSON.stringify(audit.missing.slice(0, 50))}`
      );
    }
  }

  const outcome = resolveReceiptsRunStatus({
    requireFullScan: options.requireFullScan,
    failOnMissing: options.failOnMissing,
    fullScanComplete: fullScan.complete,
    blockers: fullScan.blockers,
    writeErrors,
    missingInSource,
  });
  summary.status = outcome.status;
  summary.exit_code = outcome.exitCode;
  if (outcome.reasons.length > 0) summary.status_motivos = outcome.reasons;

  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    for (const [key, value] of Object.entries(summary)) {
      console.log(`${key}=${Array.isArray(value) ? JSON.stringify(value) : String(value)}`);
    }
  }

  if (outcome.exitCode !== 0) {
    console.error(
      `${LOG_PREFIX} status=${outcome.status} — ${outcome.reasons.join("; ")}`
    );
    process.exitCode = outcome.exitCode;
  }
}

main()
  .catch((error) => {
    console.error(`${LOG_PREFIX} falhou:`, error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
