/**
 * Coleta read-only do Domicílio para UMA empresa, com a credencial dela.
 * Janelas de até 7 dias desde o checkpoint (com sobreposição), paginação completa
 * e releitura dos processos com comunicação ainda pendente.
 * Não chama a fonte com a flag desligada, sem conta para o CNPJ ou fora dos hosts oficiais.
 */

import type {
  DomicilioSyncStats,
  LegalQueryOutcome,
  NormalizedCaseObservation,
  NormalizedCommunicationObservation,
  NormalizedSourceBatch,
} from "../../legalExposureContracts.js";
import { isDomicilioEnabled, type LegalExposureEnv } from "../../legalExposureFeatureFlags.js";
import { normalizeProcessNumber } from "../../legalExposureNormalization.js";
import {
  domicilioBackfillDays,
  domicilioEndpoints,
  domicilioMaxPages,
  domicilioMinRequestIntervalMs,
  domicilioOverlapDays,
  domicilioReconcileMaxProcesses,
  findDomicilioAccountByCnpj,
} from "./domicilioAccounts.js";
import { DOMICILIO_PAGE_SIZE, domicilioSyncWindows, type DomicilioCommunicationQuery } from "./domicilioContracts.js";
import {
  fetchDomicilioInstitution,
  listDomicilioCommunicationsPage,
  type DomicilioClientContext,
  type DomicilioFailure,
} from "./domicilioMonitoringClient.server.js";

/** Amostra de recusas guardada por execução. */
const MAX_REJECTION_SAMPLES = 50;

function emptyStats(accountKey: string | null): DomicilioSyncStats {
  return {
    accountKey,
    tenantId: null,
    pagesFetched: 0,
    received: 0,
    rejectedRecipient: 0,
    invalid: 0,
    reconciledProcesses: 0,
    rejections: [],
  };
}

function failureBatch(
  input: {
    outcome: Exclude<LegalQueryOutcome, "SUCCESS" | "PARTIAL" | "NO_RESULTS">;
    message: string;
    externalCall: boolean;
    retryAfterSeconds?: number | null;
  },
  stats: DomicilioSyncStats
): NormalizedSourceBatch {
  return {
    source: "DOMICILIO",
    outcome: input.outcome,
    errorCode: input.outcome,
    errorMessageSanitized: input.message,
    retryAfterSeconds: input.retryAfterSeconds ?? null,
    externalCall: input.externalCall,
    cases: [],
    communications: [],
    candidates: [],
    domicilio: stats,
  };
}

export function disabledDomicilioBatch(
  message = "Domicílio desligado ou não configurado."
): NormalizedSourceBatch {
  return failureBatch({ outcome: "CONFIGURATION_ERROR", message, externalCall: false }, emptyStats(null));
}

type Collected = {
  communications: Map<string, NormalizedCommunicationObservation>;
  cases: Map<string, NormalizedCaseObservation>;
  stats: DomicilioSyncStats;
  pagesLeft: number;
};

/** Percorre todas as páginas de uma consulta. Devolve a falha que interrompeu, se houver. */
async function collectAllPages(
  context: DomicilioClientContext,
  tenantId: string,
  query: Omit<DomicilioCommunicationQuery, "page" | "size">,
  collected: Collected
): Promise<DomicilioFailure | "TRUNCATED" | null> {
  for (let page = 0; ; page += 1) {
    if (collected.pagesLeft <= 0) return "TRUNCATED";
    collected.pagesLeft -= 1;
    const result = await listDomicilioCommunicationsPage(context, tenantId, {
      ...query,
      page,
      size: DOMICILIO_PAGE_SIZE,
    });
    if (result.ok === false) return result;
    const { mapped } = result;
    collected.stats.pagesFetched += 1;
    collected.stats.received += mapped.communications.length + mapped.rejectedRecipient + mapped.invalid;
    collected.stats.rejectedRecipient += mapped.rejectedRecipient;
    collected.stats.invalid += mapped.invalid;
    for (const rejection of mapped.rejections) {
      if (collected.stats.rejections.length < MAX_REJECTION_SAMPLES) collected.stats.rejections.push(rejection);
    }
    for (const row of mapped.communications) collected.communications.set(row.sourceCommunicationId, row);
    for (const row of mapped.cases) {
      const key = normalizeProcessNumber(row.processNumber);
      if (key && !collected.cases.has(key)) collected.cases.set(key, row);
    }
    const totalPages = mapped.page?.totalPages ?? 0;
    if (page + 1 >= totalPages) return null;
  }
}

export type DomicilioSyncInput = {
  env?: LegalExposureEnv;
  fetchImpl?: typeof fetch;
  now?: Date;
  sleep?: (ms: number) => Promise<void>;
  /** Empresa monitorada. A conta é escolhida pelo CNPJ; sem conta não há chamada. */
  entity?: { cnpj: string };
  /** Fim da última janela coberta por inteiro (`lastFullSyncAt` da conexão). */
  checkpoint?: string | null;
  /** Processos da empresa com comunicação ainda pendente, do menos recentemente relido para o mais recente. */
  reconcileProcessNumbers?: readonly string[];
  /** Consulta pontual de um processo: não mexe no checkpoint. */
  numeroProcesso?: string;
};

export async function runDomicilioSync(input: DomicilioSyncInput): Promise<NormalizedSourceBatch> {
  const env = input.env ?? process.env;
  if (!isDomicilioEnabled(env) || !input.entity) return disabledDomicilioBatch();
  const endpoints = domicilioEndpoints(env);
  if (!endpoints) {
    return disabledDomicilioBatch("Endereços do Domicílio ausentes ou fora dos domínios oficiais.");
  }
  const account = findDomicilioAccountByCnpj(env, input.entity.cnpj);
  if (!account) return disabledDomicilioBatch("Sem credencial do Domicílio configurada para este CNPJ.");

  const now = input.now ?? new Date();
  const context: DomicilioClientContext = {
    account,
    endpoints,
    deps: {
      fetchImpl: input.fetchImpl ?? fetch,
      minRequestIntervalMs: domicilioMinRequestIntervalMs(env),
      sleep: input.sleep,
    },
  };
  const collected: Collected = {
    communications: new Map(),
    cases: new Map(),
    stats: emptyStats(account.key),
    pagesLeft: domicilioMaxPages(env),
  };

  const identity = await fetchDomicilioInstitution(context);
  if (identity.ok === false) {
    return failureBatch(
      {
        outcome: identity.outcome,
        message: identity.errorMessageSanitized,
        externalCall: identity.externalCall,
        retryAfterSeconds: identity.retryAfterSeconds,
      },
      collected.stats
    );
  }
  const tenantId = identity.institution.tenantId;
  collected.stats.tenantId = tenantId;

  const scopedProcess = normalizeProcessNumber(input.numeroProcesso);
  const windows = scopedProcess
    ? []
    : domicilioSyncWindows({
        now,
        checkpoint: input.checkpoint ?? null,
        backfillDays: domicilioBackfillDays(env),
        overlapMs: domicilioOverlapDays(env) * 24 * 60 * 60 * 1000,
      });

  let interruption: DomicilioFailure | "TRUNCATED" | null = null;
  if (scopedProcess) {
    interruption = await collectAllPages(context, tenantId, { numeroProcesso: scopedProcess }, collected);
  }
  for (const window of windows) {
    if (interruption) break;
    interruption = await collectAllPages(context, tenantId, window, collected);
  }
  const windowsRead = !scopedProcess && interruption == null;

  if (!interruption && !scopedProcess) {
    const reconcile = [...new Set((input.reconcileProcessNumbers ?? []).map((row) => normalizeProcessNumber(row)))]
      .filter((row): row is string => Boolean(row))
      .slice(0, domicilioReconcileMaxProcesses(env));
    for (const numeroProcesso of reconcile) {
      interruption = await collectAllPages(context, tenantId, { numeroProcesso }, collected);
      if (interruption) break;
      collected.stats.reconciledProcesses += 1;
    }
  }

  const communications = [...collected.communications.values()];
  const cases = [...collected.cases.values()];
  if (interruption && interruption !== "TRUNCATED" && communications.length === 0) {
    return failureBatch(
      {
        outcome: interruption.outcome,
        message: interruption.errorMessageSanitized,
        externalCall: true,
        retryAfterSeconds: interruption.retryAfterSeconds,
      },
      collected.stats
    );
  }

  // Registro fora do contrato (sem identificador ou sem destinatário válido) não foi gravado:
  // a janela não conta como coberta e o checkpoint fica onde estava, para o item ser relido.
  const invalidRecords = collected.stats.invalid > 0;
  const windowsComplete = windowsRead && !invalidRecords;
  const partial = Boolean(interruption) || invalidRecords;

  return {
    source: "DOMICILIO",
    outcome: partial ? "PARTIAL" : communications.length === 0 ? "NO_RESULTS" : "SUCCESS",
    errorCode: interruption
      ? interruption === "TRUNCATED"
        ? "TRUNCATED"
        : interruption.outcome
      : invalidRecords
        ? "INVALID_RECORDS"
        : null,
    errorMessageSanitized: interruption
      ? interruption === "TRUNCATED"
        ? "Coleta interrompida no limite de páginas; o restante fica para a próxima execução."
        : interruption.errorMessageSanitized
      : invalidRecords
        ? `${collected.stats.invalid} registro(s) do Domicílio fora do contrato não foram gravados; o período será relido.`
        : null,
    retryAfterSeconds: interruption && interruption !== "TRUNCATED" ? interruption.retryAfterSeconds : null,
    externalCall: true,
    cases,
    communications,
    candidates: [],
    // O checkpoint só avança quando todas as janelas foram lidas até a última página.
    coverage: scopedProcess
      ? undefined
      : {
          windowStart: windows[0]?.dataInicio ?? null,
          windowEnd: now.toISOString(),
          complete: windowsComplete,
        },
    domicilio: collected.stats,
  };
}
