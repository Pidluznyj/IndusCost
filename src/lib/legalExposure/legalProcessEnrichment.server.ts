/**
 * Orquestra enriquecimento por CNJ: oficiais, depois complementares, depois localizador.
 * Não inventa dado e não sobrescreve oficial não nulo.
 * Complementares pagas só disparam se habilitadas. Evidência persistida evita consulta a cada render.
 */

import { applyBatchToMemory } from "./legalExposureApply.js";
import { buildCaseDataCoverage } from "./legalExposureCoverage.js";
import { isPersistedSourceFresh } from "./legalExposureCoverageDiagnosis.js";
import { SOURCE_ATTEMPT_IDENTIFIER, type LegalProcessEnrichmentStep, type NormalizedSourceBatch } from "./legalExposureContracts.js";
import { buildExposureProcessSummary } from "./legalExposureExecutive.js";
import {
  isDatajudEnabled,
  isDjenEnabled,
  isEscavadorEnabled,
  isJusbrasilEnabled,
} from "./legalExposureFeatureFlags.js";
import { canonicalProcessKey, normalizeProcessNumber, sanitizePayload, stableHash } from "./legalExposureNormalization.js";
import type { LegalExposureMemory } from "./legalExposureStore.js";
import type { ExposureRunners } from "./legalExposureService.server.js";
import { inferTribunalAlias } from "./legalTribunalPublicRegistry.js";
import { fetchJusbrasilProcess } from "./sources/jusbrasil/jusbrasilClient.server.js";
import { runTribunalPublicLookup } from "./sources/tribunalPublic/tribunalPublicRunner.server.js";
import { runWebDiscoveryLocator } from "./sources/webDiscovery/webDiscoveryRunner.server.js";

export type EnrichmentStep = LegalProcessEnrichmentStep;

function caseIdsFor(memory: LegalExposureMemory, processNumber: string): string[] {
  const want = canonicalProcessKey(processNumber).ok
    ? canonicalProcessKey(processNumber).key
    : processNumber;
  return memory.cases
    .filter((row) => canonicalProcessKey(row.processNumberNormalized || row.processNumber, row.id).key === want)
    .map((row) => row.id);
}

function lastSeenForSource(memory: LegalExposureMemory, processNumber: string, source: NormalizedSourceBatch["source"]): string | null {
  const ids = new Set(caseIdsFor(memory, processNumber));
  const times = memory.evidences
    .filter(
      (row) =>
        ids.has(row.caseId) &&
        row.source === source &&
        row.sourceIdentifier !== SOURCE_ATTEMPT_IDENTIFIER
    )
    .map((row) => row.lastSeenAt);
  return times.sort().at(-1) ?? null;
}

export function persistSourceAttempt(
  memory: LegalExposureMemory,
  input: {
    processNumber: string;
    source: NormalizedSourceBatch["source"];
    now: string;
    createId: () => string;
    outcome: string;
    errorCode: string | null;
    message: string | null;
    publicUrl?: string | null;
    capabilities?: string[];
  }
): void {
  const caseId = caseIdsFor(memory, input.processNumber)[0];
  if (!caseId) return;
  const rawMetadata = sanitizePayload({
    kind: SOURCE_ATTEMPT_IDENTIFIER,
    outcome: input.outcome,
    errorCode: input.errorCode,
    message: input.message,
    publicUrl: input.publicUrl ?? null,
    capabilities: input.capabilities ?? [],
  });
  const existing = memory.evidences.find(
    (row) => row.caseId === caseId && row.source === input.source && row.sourceIdentifier === SOURCE_ATTEMPT_IDENTIFIER
  );
  if (!existing) {
    memory.evidences.push({
      id: input.createId(),
      caseId,
      source: input.source,
      sourceIdentifier: SOURCE_ATTEMPT_IDENTIFIER,
      confidence: "UNCONFIRMED",
      firstSeenAt: input.now,
      lastSeenAt: input.now,
      sourceUpdatedAt: input.now,
      rawMetadata,
      rawHash: stableHash(rawMetadata),
      createdAt: input.now,
      updatedAt: input.now,
    });
    return;
  }
  existing.lastSeenAt = input.now;
  existing.updatedAt = input.now;
  existing.rawMetadata = rawMetadata;
  existing.rawHash = stableHash(rawMetadata);
}

export async function enrichLegalProcessByCnj(input: {
  memory: LegalExposureMemory;
  entityId: string;
  processNumber: string;
  tribunal?: string | null;
  system?: string | null;
  runners: ExposureRunners;
  now: string;
  createId: () => string;
  env?: NodeJS.ProcessEnv;
  force?: boolean;
}): Promise<{
  steps: EnrichmentStep[];
  coverageBefore: ReturnType<typeof buildCaseDataCoverage> | null;
  coverageAfter: ReturnType<typeof buildCaseDataCoverage> | null;
}> {
  const env = input.env ?? process.env;
  const processNumber = normalizeProcessNumber(input.processNumber) ?? input.processNumber;
  const before = buildExposureProcessSummary(input.memory, processNumber);
  const coverageBefore = before ? buildCaseDataCoverage({ item: before }) : null;
  const steps: EnrichmentStep[] = [];
  const nowDate = new Date(input.now);

  function cached(source: NormalizedSourceBatch["source"]): boolean {
    if (input.force) return false;
    return isPersistedSourceFresh({
      source,
      lastSeenAt: lastSeenForSource(input.memory, processNumber, source),
      now: nowDate,
    });
  }

  async function apply(batch: NormalizedSourceBatch, extra?: Partial<EnrichmentStep>) {
    const shouldApply =
      batch.outcome === "SUCCESS" || batch.outcome === "PARTIAL" || batch.outcome === "NO_RESULTS";
    if (shouldApply && batch.cases.length + batch.communications.length > 0) {
      applyBatchToMemory(input.memory, {
        entityId: input.entityId,
        batch,
        now: input.now,
        createId: input.createId,
      });
    }
    persistSourceAttempt(input.memory, {
      processNumber,
      source: batch.source,
      now: input.now,
      createId: input.createId,
      outcome: batch.outcome,
      errorCode: batch.errorCode,
      message: batch.errorMessageSanitized,
      publicUrl: extra?.publicUrl,
      capabilities: extra?.capabilities,
    });
    steps.push({
      source: batch.source,
      outcome: batch.outcome,
      errorCode: batch.errorCode,
      message: batch.errorMessageSanitized,
      applied: shouldApply && batch.cases.length + batch.communications.length > 0,
      ...extra,
    });
  }

  if (cached("DATAJUD")) {
    steps.push({
      source: "DATAJUD",
      outcome: "SUCCESS",
      errorCode: "CACHE_HIT",
      message: "Evidência DataJud persistida reutilizada. Sem nova consulta.",
      applied: false,
      cached: true,
    });
  } else if (isDatajudEnabled(env)) {
    await apply(
      await input.runners.datajud({
        processNumber,
        tribunalAlias: input.tribunal ?? inferTribunalAlias(processNumber) ?? "",
      })
    );
  } else {
    const step: EnrichmentStep = {
      source: "DATAJUD",
      outcome: "CONFIGURATION_ERROR",
      errorCode: "NOT_CONFIGURED",
      message: "DataJud desligado.",
      applied: false,
    };
    persistSourceAttempt(input.memory, { processNumber, now: input.now, createId: input.createId, ...step, source: "DATAJUD" });
    steps.push(step);
  }

  const tribunal = await runTribunalPublicLookup({
    processNumber,
    tribunal: input.tribunal,
    system: input.system,
  });
  persistSourceAttempt(input.memory, {
    processNumber,
    source: "TRIBUNAL_PUBLIC",
    now: input.now,
    createId: input.createId,
    outcome: tribunal.outcome,
    errorCode: tribunal.errorCode,
    message: tribunal.errorMessageSanitized,
    publicUrl: tribunal.publicUrl,
    capabilities: tribunal.capabilities,
  });
  steps.push({
    source: "TRIBUNAL_PUBLIC",
    outcome: tribunal.outcome,
    errorCode: tribunal.errorCode,
    message: tribunal.errorMessageSanitized,
    publicUrl: tribunal.publicUrl,
    capabilities: tribunal.capabilities,
    applied: false,
  });

  if (cached("DJEN")) {
    steps.push({
      source: "DJEN",
      outcome: "SUCCESS",
      errorCode: "CACHE_HIT",
      message: "Evidência DJEN persistida reutilizada. Sem nova consulta.",
      applied: false,
      cached: true,
    });
  } else if (isDjenEnabled(env)) {
    await apply(await input.runners.djen({ numeroProcesso: processNumber }));
  } else {
    const step: EnrichmentStep = {
      source: "DJEN",
      outcome: "CONFIGURATION_ERROR",
      errorCode: "NOT_CONFIGURED",
      message: "DJEN desligado.",
      applied: false,
    };
    persistSourceAttempt(input.memory, { processNumber, now: input.now, createId: input.createId, ...step, source: "DJEN" });
    steps.push(step);
  }

  if (cached("ESCAVADOR")) {
    steps.push({
      source: "ESCAVADOR",
      outcome: "SUCCESS",
      errorCode: "CACHE_HIT",
      message: "Evidência Escavador persistida reutilizada. Sem nova consulta paga.",
      applied: false,
      cached: true,
    });
  } else if (isEscavadorEnabled(env) && input.runners.escavador) {
    await apply(await input.runners.escavador({ processNumber }));
  } else {
    const step: EnrichmentStep = {
      source: "ESCAVADOR",
      outcome: "CONFIGURATION_ERROR",
      errorCode: "NOT_CONFIGURED",
      message: "Escavador desligado ou sem credencial. Nenhuma consulta paga disparada.",
      applied: false,
    };
    persistSourceAttempt(input.memory, { processNumber, now: input.now, createId: input.createId, ...step, source: "ESCAVADOR" });
    steps.push(step);
  }

  if (cached("JUSBRASIL")) {
    steps.push({
      source: "JUSBRASIL",
      outcome: "SUCCESS",
      errorCode: "CACHE_HIT",
      message: "Evidência Jusbrasil persistida reutilizada. Sem nova consulta paga.",
      applied: false,
      cached: true,
    });
  } else if (isJusbrasilEnabled(env)) {
    await apply(await fetchJusbrasilProcess({ env, processNumber }));
  } else {
    const step: EnrichmentStep = {
      source: "JUSBRASIL",
      outcome: "CONFIGURATION_ERROR",
      errorCode: "NOT_CONFIGURED",
      message: "Jusbrasil desligado por padrão. Nenhuma consulta paga disparada.",
      applied: false,
    };
    persistSourceAttempt(input.memory, { processNumber, now: input.now, createId: input.createId, ...step, source: "JUSBRASIL" });
    steps.push(step);
  }

  const locator = await runWebDiscoveryLocator({ env, processNumber });
  persistSourceAttempt(input.memory, {
    processNumber,
    source: "WEB_DISCOVERY",
    now: input.now,
    createId: input.createId,
    outcome: locator.outcome,
    errorCode: locator.errorCode,
    message: locator.errorMessageSanitized,
  });
  steps.push({
    source: "WEB_DISCOVERY",
    outcome: locator.outcome,
    errorCode: locator.errorCode,
    message: locator.errorMessageSanitized,
    applied: false,
  });

  const after = buildExposureProcessSummary(input.memory, processNumber);
  return {
    steps,
    coverageBefore,
    coverageAfter: after ? buildCaseDataCoverage({ item: after }) : null,
  };
}

export async function previewLegalProcessEnrichment(input: Parameters<typeof enrichLegalProcessByCnj>[0]): Promise<{
  steps: EnrichmentStep[];
  coverageBefore: ReturnType<typeof buildCaseDataCoverage> | null;
  coverageAfter: ReturnType<typeof buildCaseDataCoverage> | null;
}> {
  const clone = structuredClone(input.memory) as LegalExposureMemory;
  return enrichLegalProcessByCnj({ ...input, memory: clone, force: true });
}
