/**
 * Casos de uso do Exposure. Chamadas externas só pelos runners injetados,
 * que falham fechado quando a flag está desligada.
 */

import { randomUUID } from "node:crypto";
import { isValidCnpj } from "@/src/lib/companyCnpjFormat.js";
import { FINANCE_INTERNAL_GROUP_COMPANIES } from "@/src/lib/financeInternalGroupExclusions.js";
import { saveAppLocalFile } from "@/src/lib/appLocalFileStorage.js";
import { applyBatchToMemory } from "./legalExposureApply.js";
import type { LegalAliasType, LegalExposureSource, NormalizedSourceBatch } from "./legalExposureContracts.js";
import { LEGAL_ALIAS_TYPES } from "./legalExposureContracts.js";
import { publicSourceConfiguration, escavadorRefreshHours, isEscavadorEnabled, isJusbrasilEnabled, jusbrasilConfigured } from "./legalExposureFeatureFlags.js";
import { SOURCE_FRESHNESS_POLICY } from "./legalExposureHealth.js";
import {
  matchExposureGroupCompanies,
  OUTSIDE_GROUP_COMPANY_MESSAGE,
} from "./legalExposureEntityForm.js";
import { normalizeExposureCnpj, normalizeLegalName, normalizeProcessNumber, canonicalProcessKey, sanitizePayload } from "./legalExposureNormalization.js";
import { siblingAlertIds } from "./legalExposureFeedDedupe.js";
import { buildSourceOperations } from "./legalExposureSourceOperations.js";
import { integrationTargetOf } from "./legalExposureSourceSchedule.js";
import { buildDjenDiscoveryTerms, isLegalAliasType } from "./legalExposureDiscovery.js";
import {
  collectDatajudTargetsFromBatch,
  collectKnownCaseDatajudTargets,
  countSourceOutcomes,
  datajudTargetNeedsRefresh,
  emptyEntitySyncCounters,
  mergeDjenBatches,
  missingTribunalBatch,
  tagDiscoveryConfirmation,
  unionDatajudTargets,
  uniqueDiscoveredProcessCount,
  uniqueProcessNumbersFromBatch,
  type EntitySyncCounters,
} from "./legalExposurePipeline.js";
import { exposureAuditUserId } from "./legalExposureUuid.js";
import {
  buildExposureDashboard,
  caseTimeline,
  listAlerts,
  listCases,
  listCommunications,
  listEvents,
  sourceStatuses,
  type ExposureListQuery,
} from "./legalExposureReadModel.js";
import {
  buildExposureGroupReport,
  buildExposureProcessDossier,
} from "./legalExposureExecutive.js";
import type { LegalExposureRepository } from "./legalExposureRepository.server.js";
import type {
  ExposureAuditRecord,
  ExposureAliasRecord,
  ExposureEntityRecord,
  LegalExposureMemory,
} from "./legalExposureStore.js";

export class ExposureServiceError extends Error {
  constructor(
    message: string,
    readonly code: "NOT_FOUND" | "CONFLICT" | "VALIDATION"
  ) {
    super(message);
  }
}

export type ExposureRunners = {
  domicilio: () => Promise<NormalizedSourceBatch>;
  datajud: (input?: { processNumber?: string; tribunalAlias?: string }) => Promise<NormalizedSourceBatch>;
  djen: (input?: { nomeParte?: string; numeroProcesso?: string }) => Promise<NormalizedSourceBatch>;
  escavador?: (input?: { processNumber?: string }) => Promise<NormalizedSourceBatch>;
};

export type ExposureServiceDeps = {
  repository: LegalExposureRepository;
  runners?: ExposureRunners;
  now?: () => Date;
  createId?: () => string;
  recordIntegrationRun?: (input: {
    target: string;
    mode: string;
    status: string;
    summary: unknown;
    startedAt?: Date;
    finishedAt?: Date | null;
    durationMs?: number | null;
    command?: string;
  }) => Promise<string | void>;
  listIntegrationRuns?: (input?: { target?: string; take?: number }) => Promise<
    Array<{
      id: string;
      source: string;
      job: string | null;
      status: string;
      trigger: string | null;
      startedAt: string | null;
      finishedAt: string | null;
      durationMs: number | null;
      outcome: string | null;
      processesRequested: number | null;
      processesFound: number | null;
      movementsReceived: number | null;
      communicationsReceived: number | null;
      entitiesProcessed: number | null;
      errorCode: string | null;
      sanitizedError: string | null;
      externalCall: boolean | null;
    }>
  >;
  findRunningJob?: (target: string) => Promise<{ id: string; startedAt: Date | null } | null>;
  beginIntegrationRun?: (input: {
    target: string;
    mode: string;
    trigger: "SCHEDULED" | "MANUAL";
    job?: string;
  }) => Promise<{ id: string; startedAt: Date }>;
  finishIntegrationRun?: (input: {
    id: string;
    status: string;
    summary: Record<string, unknown>;
    startedAt: Date;
  }) => Promise<void>;
};

const TARGET: Record<string, string> = {
  DOMICILIO: "LEGAL_EXPOSURE_DOMICILIO",
  DATAJUD: "LEGAL_EXPOSURE_DATAJUD",
  DJEN: "LEGAL_EXPOSURE_DJEN",
  ESCAVADOR: "LEGAL_EXPOSURE_ESCAVADOR",
  TRIBUNAL_PUBLIC: "LEGAL_EXPOSURE_TRIBUNAL_PUBLIC",
  JUSBRASIL: "LEGAL_EXPOSURE_JUSBRASIL",
};

const sourceJobLocks = new Set<string>();

function disabledRunner(source: LegalExposureSource): NormalizedSourceBatch {
  return {
    source,
    outcome: "CONFIGURATION_ERROR",
    errorCode: "CONFIGURATION_ERROR",
    errorMessageSanitized: "Fonte desligada ou não configurada.",
    retryAfterSeconds: null,
    externalCall: false,
    cases: [],
    communications: [],
    candidates: [],
  };
}

export async function defaultRunners(): Promise<ExposureRunners> {
  const { runDomicilioSync } = await import("./sources/domicilio/domicilioSyncRunner.server.js");
  const { runDatajudSync } = await import("./sources/datajud/datajudSyncRunner.server.js");
  const { runDjenSync } = await import("./sources/djen/djenSyncRunner.server.js");
  const { runEscavadorSync } = await import("./sources/escavador/escavadorSyncRunner.server.js");
  return {
    domicilio: () => runDomicilioSync({}),
    datajud: (input) =>
      runDatajudSync({
        mode: "known-process",
        processNumber: input?.processNumber,
        tribunalAlias: input?.tribunalAlias ?? "",
      }),
    djen: (input) => runDjenSync(input ?? {}),
    escavador: (input) => runEscavadorSync({ processNumber: input?.processNumber }),
  };
}

function failClosedBatch(source: LegalExposureSource, message: string): NormalizedSourceBatch {
  return {
    source,
    outcome: "CONFIGURATION_ERROR",
    errorCode: "CONFIGURATION_ERROR",
    errorMessageSanitized: message,
    retryAfterSeconds: null,
    externalCall: false,
    cases: [],
    communications: [],
    candidates: [],
  };
}

function shouldApplyBatch(batch: NormalizedSourceBatch): boolean {
  return (
    batch.externalCall ||
    batch.outcome === "NO_RESULTS" ||
    batch.outcome === "SUCCESS" ||
    batch.outcome === "PARTIAL"
  );
}

export type ExposureSyncTrigger = "MANUAL" | "SCHEDULED";

const refreshingCases = new Set<string>();

export function createLegalExposureService(deps: ExposureServiceDeps) {
  const now = () => (deps.now ? deps.now() : new Date());
  const createId = deps.createId ?? (() => randomUUID());

  async function mutate(userId: string | null, change: (memory: LegalExposureMemory) => void) {
    const memory = await deps.repository.load();
    change(memory);
    await deps.repository.persist(memory);
    return memory;
  }

  function buildAuditRecord(
    userId: string | null,
    action: ExposureAuditRecord["action"],
    refs: { entityId?: string | null; caseId?: string | null; communicationId?: string | null },
    metadata: unknown
  ): ExposureAuditRecord {
    const timestamp = now().toISOString();
    return {
      id: createId(),
      userId: exposureAuditUserId(userId),
      action,
      entityId: refs.entityId ?? null,
      caseId: refs.caseId ?? null,
      communicationId: refs.communicationId ?? null,
      occurredAt: timestamp,
      metadata: sanitizePayload(metadata),
      createdAt: timestamp,
    };
  }

  function audit(
    memory: LegalExposureMemory,
    userId: string | null,
    action: ExposureAuditRecord["action"],
    refs: { entityId?: string | null; caseId?: string | null; communicationId?: string | null },
    metadata: unknown
  ) {
    memory.audits.push(buildAuditRecord(userId, action, refs, metadata));
  }

  return {
    async dashboard() {
      const memory = await deps.repository.load();
      return buildExposureDashboard(memory, now());
    },
    async listEntities() {
      const memory = await deps.repository.load();
      return memory.entities.map(publicEntity);
    },
    async listGroupCompanies() {
      const memory = await deps.repository.load();
      return matchExposureGroupCompanies(FINANCE_INTERNAL_GROUP_COMPANIES, memory.entities);
    },
    async createEntity(input: {
      cnpj: string;
      legalName: string;
      tradeName?: string | null;
      state?: string | null;
      city?: string | null;
    }, userId: string) {
      const cnpj = normalizeExposureCnpj(input.cnpj);
      if (!cnpj || !isValidCnpj(cnpj)) {
        throw new ExposureServiceError("CNPJ inválido.", "VALIDATION");
      }
      if (!FINANCE_INTERNAL_GROUP_COMPANIES.some((company) => company.cnpj === cnpj)) {
        throw new ExposureServiceError(OUTSIDE_GROUP_COMPANY_MESSAGE, "VALIDATION");
      }
      if (!input.legalName?.trim()) {
        throw new ExposureServiceError("Razão social obrigatória.", "VALIDATION");
      }
      const memory = await deps.repository.load();
      if (memory.entities.some((row) => row.cnpj === cnpj)) {
        throw new ExposureServiceError("CNPJ já monitorado.", "CONFLICT");
      }
      const timestamp = now().toISOString();
      const entity: ExposureEntityRecord = {
        id: createId(),
        cnpj,
        legalName: input.legalName.trim(),
        tradeName: input.tradeName?.trim() || null,
        active: true,
        state: input.state?.trim() || null,
        city: input.city?.trim() || null,
        monitorDomicilio: true,
        monitorDatajud: true,
        monitorDjen: true,
        monitorCertificates: true,
        domicilioTenantId: null,
        lastSuccessfulSyncAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      memory.entities.push(entity);
      memory.aliases.push({
        id: createId(),
        entityId: entity.id,
        type: "LEGAL_NAME",
        value: entity.legalName,
        normalizedValue: normalizeLegalName(entity.legalName),
        active: true,
        createdAt: timestamp,
      });
      audit(memory, userId, "ENTITY_CREATED", { entityId: entity.id }, { cnpj });
      await deps.repository.persist(memory);
      return publicEntity(entity);
    },
    async updateEntity(id: string, input: Partial<{
      legalName: string;
      tradeName: string | null;
      active: boolean;
      state: string | null;
      city: string | null;
      monitorDomicilio: boolean;
      monitorDatajud: boolean;
      monitorDjen: boolean;
      monitorCertificates: boolean;
      domicilioTenantId: string | null;
    }>, userId: string) {
      const memory = await deps.repository.load();
      const entity = memory.entities.find((row) => row.id === id);
      if (!entity) throw new ExposureServiceError("Empresa não encontrada.", "NOT_FOUND");
      const wasActive = entity.active;
      if (input.legalName != null) entity.legalName = input.legalName.trim();
      if (input.tradeName !== undefined) entity.tradeName = input.tradeName;
      if (input.active != null) entity.active = input.active;
      if (input.state !== undefined) entity.state = input.state;
      if (input.city !== undefined) entity.city = input.city;
      if (input.monitorDomicilio != null) entity.monitorDomicilio = input.monitorDomicilio;
      if (input.monitorDatajud != null) entity.monitorDatajud = input.monitorDatajud;
      if (input.monitorDjen != null) entity.monitorDjen = input.monitorDjen;
      if (input.monitorCertificates != null) entity.monitorCertificates = input.monitorCertificates;
      if (input.domicilioTenantId !== undefined) entity.domicilioTenantId = input.domicilioTenantId;
      entity.updatedAt = now().toISOString();
      audit(
        memory,
        userId,
        wasActive && entity.active === false ? "ENTITY_DISABLED" : "ENTITY_UPDATED",
        { entityId: entity.id },
        { active: entity.active }
      );
      await deps.repository.persist(memory);
      return publicEntity(entity);
    },
    async listAliases(entityId: string) {
      const memory = await deps.repository.load();
      const entity = memory.entities.find((row) => row.id === entityId);
      if (!entity) throw new ExposureServiceError("Empresa não encontrada.", "NOT_FOUND");
      return memory.aliases.filter((row) => row.entityId === entityId).map(publicAlias);
    },
    async createAlias(
      entityId: string,
      input: { value: string; type: string },
      userId: string
    ) {
      if (!isLegalAliasType(input.type)) {
        throw new ExposureServiceError(
          `Tipo de alias inválido. Use: ${LEGAL_ALIAS_TYPES.join(", ")}.`,
          "VALIDATION"
        );
      }
      const value = String(input.value ?? "").trim();
      if (!value) throw new ExposureServiceError("Valor do alias obrigatório.", "VALIDATION");
      const normalizedValue = normalizeLegalName(value);
      if (!normalizedValue) throw new ExposureServiceError("Valor do alias obrigatório.", "VALIDATION");
      const memory = await deps.repository.load();
      const entity = memory.entities.find((row) => row.id === entityId);
      if (!entity) throw new ExposureServiceError("Empresa não encontrada.", "NOT_FOUND");
      const duplicate = memory.aliases.find(
        (row) => row.entityId === entityId && row.active && row.normalizedValue === normalizedValue
      );
      if (duplicate) {
        throw new ExposureServiceError("Alias já cadastrado para esta empresa.", "CONFLICT");
      }
      const timestamp = now().toISOString();
      const inactiveSame = memory.aliases.find(
        (row) =>
          row.entityId === entityId &&
          row.type === input.type &&
          row.normalizedValue === normalizedValue &&
          !row.active
      );
      if (inactiveSame) {
        inactiveSame.value = value;
        inactiveSame.active = true;
        audit(memory, userId, "ENTITY_UPDATED", { entityId }, { operation: "ALIAS_CREATED", aliasId: inactiveSame.id });
        await deps.repository.persist(memory);
        return publicAlias(inactiveSame);
      }
      const alias = {
        id: createId(),
        entityId,
        type: input.type,
        value,
        normalizedValue,
        active: true,
        createdAt: timestamp,
      };
      memory.aliases.push(alias);
      audit(memory, userId, "ENTITY_UPDATED", { entityId }, { operation: "ALIAS_CREATED", aliasId: alias.id });
      await deps.repository.persist(memory);
      return publicAlias(alias);
    },
    async updateAlias(
      id: string,
      input: { value?: string; type?: string; active?: boolean },
      userId: string
    ) {
      const memory = await deps.repository.load();
      const alias = memory.aliases.find((row) => row.id === id);
      if (!alias) throw new ExposureServiceError("Alias não encontrado.", "NOT_FOUND");
      const entity = memory.entities.find((row) => row.id === alias.entityId);
      if (!entity) throw new ExposureServiceError("Empresa não encontrada.", "NOT_FOUND");
      const nextType = input.type != null ? input.type : alias.type;
      if (!isLegalAliasType(nextType)) {
        throw new ExposureServiceError(
          `Tipo de alias inválido. Use: ${LEGAL_ALIAS_TYPES.join(", ")}.`,
          "VALIDATION"
        );
      }
      const nextValue = input.value != null ? String(input.value).trim() : alias.value;
      if (!nextValue) throw new ExposureServiceError("Valor do alias obrigatório.", "VALIDATION");
      const nextNormalized = normalizeLegalName(nextValue);
      if (!nextNormalized) throw new ExposureServiceError("Valor do alias obrigatório.", "VALIDATION");
      const nextActive = input.active != null ? Boolean(input.active) : alias.active;
      if (nextActive) {
        const duplicate = memory.aliases.find(
          (row) =>
            row.id !== alias.id &&
            row.entityId === alias.entityId &&
            row.active &&
            row.normalizedValue === nextNormalized
        );
        if (duplicate) {
          throw new ExposureServiceError("Alias já cadastrado para esta empresa.", "CONFLICT");
        }
      }
      const disabling = alias.active && nextActive === false;
      alias.type = nextType;
      alias.value = nextValue;
      alias.normalizedValue = nextNormalized;
      alias.active = nextActive;
      audit(
        memory,
        userId,
        "ENTITY_UPDATED",
        { entityId: alias.entityId },
        {
          operation: disabling ? "ALIAS_DISABLED" : "ALIAS_UPDATED",
          aliasId: alias.id,
          active: alias.active,
        }
      );
      await deps.repository.persist(memory);
      return publicAlias(alias);
    },
    async listCases(query: ExposureListQuery) {
      return listCases(await deps.repository.load(), query);
    },
    async getCase(id: string, userId: string) {
      const memory = await deps.repository.load();
      const dossier = buildExposureProcessDossier(memory, id);
      if (!dossier) throw new ExposureServiceError("Processo não encontrado.", "NOT_FOUND");
      await deps.repository.appendAudit(
        buildAuditRecord(userId, "VIEW_CASE", { entityId: dossier.entityId, caseId: dossier.id }, {})
      );
      return dossier;
    },
    async timeline(id: string, query: ExposureListQuery, userId: string) {
      const memory = await deps.repository.load();
      const row = memory.cases.find((item) => item.id === id);
      if (!row) throw new ExposureServiceError("Processo não encontrado.", "NOT_FOUND");
      await deps.repository.appendAudit(
        buildAuditRecord(userId, "VIEW_CASE", { entityId: row.entityId, caseId: id }, { timeline: true })
      );
      return caseTimeline(memory, id, query);
    },
    async listCommunications(query: ExposureListQuery, userId: string) {
      const memory = await deps.repository.load();
      await deps.repository.appendAudit(
        buildAuditRecord(userId, "VIEW_COMMUNICATION_METADATA", {}, {})
      );
      return listCommunications(memory, query);
    },
    async listEvents(query: ExposureListQuery) {
      return listEvents(await deps.repository.load(), query);
    },
    async listAlerts(query: ExposureListQuery) {
      return listAlerts(await deps.repository.load(), query);
    },
    async acknowledgeAlert(id: string, userId: string) {
      return mutate(userId, (memory) => {
        const alert = memory.alerts.find((row) => row.id === id);
        if (!alert) throw new ExposureServiceError("Alerta não encontrado.", "NOT_FOUND");
        const ids = siblingAlertIds(memory, id);
        for (const siblingId of ids) {
          const sibling = memory.alerts.find((row) => row.id === siblingId);
          if (!sibling || sibling.status === "RESOLVED") continue;
          sibling.status = "ACKNOWLEDGED";
          sibling.acknowledgedAt = now().toISOString();
          sibling.acknowledgedByUserId = userId;
        }
        audit(memory, userId, "ALERT_ACKNOWLEDGED", { entityId: alert.entityId }, { alertId: id });
      });
    },
    async resolveAlert(id: string, userId: string) {
      return mutate(userId, (memory) => {
        const alert = memory.alerts.find((row) => row.id === id);
        if (!alert) throw new ExposureServiceError("Alerta não encontrado.", "NOT_FOUND");
        const ids = siblingAlertIds(memory, id);
        for (const siblingId of ids) {
          const sibling = memory.alerts.find((row) => row.id === siblingId);
          if (!sibling) continue;
          sibling.status = "RESOLVED";
          sibling.resolvedAt = now().toISOString();
          sibling.resolvedByUserId = userId;
        }
        audit(memory, userId, "ALERT_RESOLVED", { entityId: alert.entityId }, { alertId: id });
      });
    },
    async listCertificates(entityId?: string | null) {
      const memory = await deps.repository.load();
      return memory.certificates
        .filter((row) => !entityId || row.entityId === entityId)
        .map((row) => ({
          id: row.id,
          entityId: row.entityId,
          type: row.type,
          tribunal: row.tribunal,
          issuedAt: row.issuedAt,
          validUntil: row.validUntil,
          result: row.result,
          verificationCode: row.verificationCode,
          originalFileName: row.originalFileName,
          notes: row.notes,
          registeredByUserId: row.registeredByUserId,
          createdAt: row.createdAt,
        }));
    },
    async registerCertificate(input: {
      entityId: string;
      type: "TRT_LABOR_CASES" | "CNDT" | "OTHER";
      tribunal?: string | null;
      issuedAt?: string | null;
      validUntil?: string | null;
      result?: "NEGATIVE" | "POSITIVE" | "POSITIVE_WITH_EFFECTS_OF_NEGATIVE" | "UNKNOWN";
      verificationCode?: string | null;
      notes?: string | null;
      originalFileName?: string | null;
      contentBase64?: string | null;
    }, userId: string) {
      const memory = await deps.repository.load();
      const entity = memory.entities.find((row) => row.id === input.entityId);
      if (!entity) throw new ExposureServiceError("Empresa não encontrada.", "NOT_FOUND");
      let fileStorageKey: string | null = null;
      if (input.contentBase64) {
        const buffer = Buffer.from(input.contentBase64, "base64");
        if (buffer.byteLength > 8 * 1024 * 1024) {
          throw new ExposureServiceError("Arquivo acima de 8 MB.", "VALIDATION");
        }
        const saved = await saveAppLocalFile({
          namespace: "legal-exposure-certificates",
          entityId: input.entityId,
          originalFileName: input.originalFileName || "certidao.pdf",
          buffer,
        });
        fileStorageKey = saved.storageKey;
      }
      const timestamp = now().toISOString();
      const certificate = {
        id: createId(),
        entityId: input.entityId,
        type: input.type,
        tribunal: input.tribunal ?? null,
        issuedAt: input.issuedAt ?? null,
        validUntil: input.validUntil ?? null,
        result: input.result ?? "UNKNOWN",
        verificationCode: input.verificationCode ?? null,
        fileStorageKey,
        originalFileName: input.originalFileName ?? null,
        notes: input.notes ?? null,
        registeredByUserId: userId,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      memory.certificates.push(certificate);
      memory.events.push({
        id: createId(),
        eventKey: `CERTIFICATE_REGISTERED:${certificate.id}`,
        entityId: input.entityId,
        caseId: null,
        communicationId: null,
        source: input.type === "CNDT" ? "CNDT" : "TRT_CERTIFICATE",
        eventType: "CERTIFICATE_REGISTERED",
        severity: "INFO",
        detectedAt: timestamp,
        payload: sanitizePayload({ type: input.type, result: certificate.result }),
        payloadHash: certificate.id,
        createdAt: timestamp,
      });
      audit(memory, userId, fileStorageKey ? "CERTIFICATE_UPLOAD" : "CERTIFICATE_UPDATE", {
        entityId: input.entityId,
      }, { certificateId: certificate.id, type: input.type });
      await deps.repository.persist(memory);
      return { id: certificate.id, fileStorageKey: certificate.fileStorageKey };
    },
    async sourceStatus() {
      const memory = await deps.repository.load();
      const runs = (await deps.listIntegrationRuns?.({ take: 50 })) ?? [];
      return {
        sources: sourceStatuses(memory, now()),
        configuration: publicSourceConfiguration(),
        operations: buildSourceOperations({ memory, now: now(), runs }),
        healthCheckExternalCall: false as const,
      };
    },
    async sourceRuns(source: string) {
      const target = integrationTargetOf(source.replace(/^LEGAL_EXPOSURE_/, ""));
      return (await deps.listIntegrationRuns?.({ target, take: 50 })) ?? [];
    },
    async sync(input: {
      source?: LegalExposureSource | "ALL";
      mode?: "preview" | "apply";
      entityId?: string;
      processNumber?: string;
      trigger?: ExposureSyncTrigger;
    }, userId: string | null) {
      const mode = input.mode === "apply" ? "apply" : "preview";
      const trigger: ExposureSyncTrigger = input.trigger === "SCHEDULED" ? "SCHEDULED" : "MANUAL";
      const jobKey = String(input.source ?? "ALL");
      if (sourceJobLocks.has(jobKey)) {
        throw new ExposureServiceError("Execução já em andamento.", "CONFLICT");
      }
      const runningTarget = TARGET[jobKey] ?? (jobKey === "ALL" ? "LEGAL_EXPOSURE_ALL" : integrationTargetOf(jobKey));
      const already = await deps.findRunningJob?.(runningTarget);
      if (already?.startedAt && Date.now() - already.startedAt.getTime() < 45 * 60 * 1000) {
        throw new ExposureServiceError("Execução já em andamento.", "CONFLICT");
      }
      sourceJobLocks.add(jobKey);
      const startedAt = now();
      const liveRun = await deps.beginIntegrationRun?.({
        target: runningTarget,
        mode: mode === "apply" ? "APPLY" : "PREVIEW",
        trigger,
        job: jobKey,
      });
      try {
      const runners = deps.runners ?? (await defaultRunners());
      const memory = await deps.repository.load();
      const pipelineAll = !input.source || input.source === "ALL";
      const wantsDjen = pipelineAll || input.source === "DJEN";
      const wantsDatajud = pipelineAll || input.source === "DATAJUD";
      const wantsDomicilio = pipelineAll || input.source === "DOMICILIO";
      const wantsEscavador = pipelineAll || input.source === "ESCAVADOR";
      const wantsTribunal = input.source === "TRIBUNAL_PUBLIC";
      const wantsJusbrasil = input.source === "JUSBRASIL";
      const scopedProcessNumber = input.entityId ? input.processNumber?.trim() || "" : "";

      let entities: ExposureEntityRecord[];
      if (input.entityId) {
        const entity = memory.entities.find((row) => row.id === input.entityId);
        if (!entity) throw new ExposureServiceError("Empresa não encontrada.", "NOT_FOUND");
        if (!entity.active) throw new ExposureServiceError("Empresa inativa.", "VALIDATION");
        entities = [entity];
      } else {
        entities = memory.entities.filter((row) => row.active);
      }

      const batches: NormalizedSourceBatch[] = [];
      const summaryEntities: Array<EntitySyncCounters & { entityId: string; legalName: string }> = [];
      const datajudHttpCache = new Map<string, NormalizedSourceBatch>();
      const escavadorHttpCache = new Map<string, NormalizedSourceBatch>();

      function applyOwned(entityId: string, batch: NormalizedSourceBatch) {
        if (mode === "apply" && shouldApplyBatch(batch)) {
          applyBatchToMemory(memory, {
            entityId,
            batch,
            now: now().toISOString(),
            createId,
          });
        }
        batches.push(batch);
      }

      for (const entity of entities) {
        const counters = emptyEntitySyncCounters();
        const owned: NormalizedSourceBatch[] = [];
        let mergedDjen: NormalizedSourceBatch | null = null;

        if (wantsDjen) {
          const djenPages: NormalizedSourceBatch[] = [];
          const before = {
            cases: memory.cases.length,
            links: memory.entityLinks.length,
            communications: memory.communications.length,
            parties: memory.parties.length,
            attorneys: memory.attorneys.length,
            hearings: memory.hearings.length,
          };
          if (scopedProcessNumber) {
            djenPages.push(await runners.djen({ numeroProcesso: scopedProcessNumber }));
            counters.discoveryTermsConsulted = [];
          } else {
            const terms = buildDjenDiscoveryTerms({
              legalName: entity.legalName,
              tradeName: entity.tradeName,
              aliases: memory.aliases.filter((row) => row.entityId === entity.id),
            });
            counters.discoveryTermsConsulted = terms.map((term) => term.value);
            if (terms.length === 0) {
              djenPages.push(failClosedBatch("DJEN", "DJEN exige nomeParte ou numeroProcesso."));
            } else {
              for (const term of terms) {
                const page = tagDiscoveryConfirmation(
                  await runners.djen({ nomeParte: term.value }),
                  term.trust
                );
                djenPages.push(page);
              }
            }
            const discovered = uniqueProcessNumbersFromBatch(mergeDjenBatches(djenPages));
            for (const cnj of discovered) {
              djenPages.push(await runners.djen({ numeroProcesso: cnj }));
            }
          }
          counters.djenQueries = djenPages.length;
          mergedDjen = mergeDjenBatches(djenPages);
          counters.uniqueProcessesDiscovered = uniqueDiscoveredProcessCount(mergedDjen);
          counters.pagesFetched = mergedDjen.pagination?.pagesFetched ?? djenPages.length;
          counters.itemsFetched = mergedDjen.pagination?.itemsFetched ?? mergedDjen.communications.length;
          counters.truncated = Boolean(mergedDjen.pagination?.truncated);
          owned.push(mergedDjen);
          applyOwned(entity.id, mergedDjen);
          counters.newProcesses = Math.max(0, memory.cases.length - before.cases);
          counters.existingProcesses = Math.max(0, counters.uniqueProcessesDiscovered - counters.newProcesses);
          counters.newEntityLinks = Math.max(0, memory.entityLinks.length - before.links);
          counters.newCommunications = Math.max(0, memory.communications.length - before.communications);
          counters.newParties = Math.max(0, memory.parties.length - before.parties);
          counters.newAttorneys = Math.max(0, memory.attorneys.length - before.attorneys);
          counters.newHearings = Math.max(0, memory.hearings.length - before.hearings);
        }

        if (wantsDatajud) {
          const discovered = pipelineAll || wantsDjen ? collectDatajudTargetsFromBatch(mergedDjen) : [];
          const known = collectKnownCaseDatajudTargets(memory, entity.id);
          let targets = unionDatajudTargets(discovered, known.targets);
          if (!pipelineAll && !scopedProcessNumber) {
            targets = targets.filter((target) =>
              datajudTargetNeedsRefresh(memory, target.processNumber, now().getTime())
            );
          }
          if (scopedProcessNumber) {
            const knownProcess = normalizeProcessNumber(scopedProcessNumber);
            targets = knownProcess
              ? targets.filter((target) => target.processNumber === knownProcess)
              : [];
            if (knownProcess && targets.length === 0) {
              const fromScope = known.targets.filter((target) => target.processNumber === knownProcess);
              targets = fromScope;
            }
          }
          counters.datajudTargets = targets.length;
          counters.knownProcessesRefreshed = targets.filter((target) => target.origin === "KNOWN_CASE").length;
          if (targets.length === 0 && known.skippedWithoutTribunal.length > 0) {
            const skipped = missingTribunalBatch(known.skippedWithoutTribunal[0]!.processNumber);
            owned.push(skipped);
            applyOwned(entity.id, skipped);
          } else if (targets.length === 0) {
            const empty = failClosedBatch("DATAJUD", "DataJud exige número de processo conhecido.");
            owned.push(empty);
            applyOwned(entity.id, empty);
          } else {
            for (const skipped of known.skippedWithoutTribunal) {
              const batch = missingTribunalBatch(skipped.processNumber);
              owned.push(batch);
              applyOwned(entity.id, batch);
            }
            for (const target of targets) {
              const cacheKey = `${target.processNumber}:${target.tribunalAlias}`;
              let batch = datajudHttpCache.get(cacheKey);
              if (!batch) {
                batch = await runners.datajud({
                  processNumber: target.processNumber,
                  tribunalAlias: target.tribunalAlias,
                });
                datajudHttpCache.set(cacheKey, batch);
              }
              owned.push(batch);
              applyOwned(entity.id, batch);
            }
          }
        }

        if (wantsDomicilio) {
          const domicilio = await runners.domicilio();
          owned.push(domicilio);
          applyOwned(entity.id, domicilio);
        }

        if (wantsEscavador && runners.escavador) {
          const refreshHours = escavadorRefreshHours();
          const linkedCaseIds = new Set(
            memory.entityLinks.filter((row) => row.entityId === entity.id).map((row) => row.caseId)
          );
          const processes = new Map<string, string>();
          for (const row of memory.cases) {
            if (row.entityId !== entity.id && !linkedCaseIds.has(row.id)) continue;
            const canon = canonicalProcessKey(row.processNumberNormalized || row.processNumber, row.id);
            if (!canon.ok) continue;
            processes.set(canon.key, canon.key);
          }
          const scoped = normalizeProcessNumber(scopedProcessNumber);
          for (const processNumber of processes.keys()) {
            if (scoped && processNumber !== scoped) continue;
            const caseIds = memory.cases
              .filter((row) => canonicalProcessKey(row.processNumberNormalized || row.processNumber, row.id).key === processNumber)
              .map((row) => row.id);
            const lastEscavador = memory.evidences
              .filter((row) => caseIds.includes(row.caseId) && row.source === "ESCAVADOR")
              .map((row) => Date.parse(row.lastSeenAt))
              .sort((a, b) => b - a)[0];
            const stale =
              lastEscavador == null ||
              now().getTime() - lastEscavador > refreshHours * 60 * 60 * 1000;
            if (!scoped && !stale) continue;
            let batch = escavadorHttpCache.get(processNumber);
            if (!batch) {
              batch = await runners.escavador({ processNumber });
              escavadorHttpCache.set(processNumber, batch);
            }
            owned.push(batch);
            applyOwned(entity.id, batch);
          }
        }

        Object.assign(counters, countSourceOutcomes(owned));
        summaryEntities.push({
          entityId: entity.id,
          legalName: entity.legalName,
          ...counters,
        });
      }

      if (wantsTribunal || wantsJusbrasil) {
        const unique = new Map<
          string,
          { entityId: string; tribunal: string | null; system: string | null; caseIds: string[] }
        >();
        for (const row of memory.cases) {
          const canon = canonicalProcessKey(row.processNumberNormalized || row.processNumber, row.id);
          if (!canon.ok) continue;
          const existing = unique.get(canon.key);
          if (existing) {
            existing.caseIds.push(row.id);
            continue;
          }
          unique.set(canon.key, {
            entityId: row.entityId,
            tribunal: row.tribunal,
            system: row.systemName,
            caseIds: [row.id],
          });
        }
        const scoped = normalizeProcessNumber(scopedProcessNumber);
        function staleFor(source: LegalExposureSource, caseIds: string[]): boolean {
          const last = memory.evidences
            .filter((row) => caseIds.includes(row.caseId) && row.source === source)
            .map((row) => Date.parse(row.lastSeenAt))
            .sort((a, b) => b - a)[0];
          return last == null || now().getTime() - last > SOURCE_FRESHNESS_POLICY[source].staleAfterMs;
        }
        if (wantsTribunal) {
          const { runTribunalPublicLookup } = await import("./sources/tribunalPublic/tribunalPublicRunner.server.js");
          const seenTribunal = new Set<string>();
          for (const [processNumber, meta] of unique) {
            if (scoped && processNumber !== scoped) continue;
            const tribunalKey = `${meta.tribunal ?? ""}:${meta.system ?? ""}`;
            if (seenTribunal.has(tribunalKey)) continue;
            seenTribunal.add(tribunalKey);
            const batch = await runTribunalPublicLookup({
              processNumber,
              tribunal: meta.tribunal,
              system: meta.system,
            });
            applyOwned(meta.entityId, batch);
          }
        }
        if (wantsJusbrasil) {
          const { fetchJusbrasilProcess } = await import("./sources/jusbrasil/jusbrasilClient.server.js");
          if (!isJusbrasilEnabled() || !jusbrasilConfigured()) {
            const batch = await fetchJusbrasilProcess({ processNumber: scoped || [...unique.keys()][0] || "" });
            const entityId = [...unique.values()][0]?.entityId ?? entities[0]?.id;
            if (entityId) applyOwned(entityId, batch);
          } else {
            for (const [processNumber, meta] of unique) {
              if (scoped && processNumber !== scoped) continue;
              if (!scoped && !staleFor("JUSBRASIL", meta.caseIds)) continue;
              const batch = await fetchJusbrasilProcess({ processNumber });
              applyOwned(meta.entityId, batch);
            }
          }
        }
      }

      audit(
        memory,
        userId,
        "MANUAL_SYNC",
        { entityId: input.entityId ?? null },
        { mode, source: input.source ?? "ALL", trigger }
      );
      await deps.repository.persist(memory);
      const finishedAt = now();
      const durationMs = Math.max(0, finishedAt.getTime() - startedAt.getTime());
      const bySource = new Map<string, NormalizedSourceBatch[]>();
      for (const batch of batches) {
        const list = bySource.get(batch.source) ?? [];
        list.push(batch);
        bySource.set(batch.source, list);
      }
      for (const [source, sourceBatches] of bySource) {
        const worst = sourceBatches.find((row) => row.outcome === "RATE_LIMITED")
          ?? sourceBatches.find((row) => row.outcome !== "SUCCESS" && row.outcome !== "NO_RESULTS" && row.outcome !== "PARTIAL")
          ?? sourceBatches.find((row) => row.outcome === "PARTIAL")
          ?? sourceBatches[0];
        const processesFound = new Set(
          sourceBatches.flatMap((row) => row.cases.map((item) => normalizeProcessNumber(item.processNumber) ?? item.processNumber))
        ).size;
        const summary = {
          trigger,
          job: source,
          outcome: worst?.outcome ?? "SUCCESS",
          externalCall: sourceBatches.some((row) => row.externalCall),
          processesRequested: datajudHttpCache.size || processesFound,
          processesFound,
          communicationsReceived: sourceBatches.reduce((sum, row) => sum + row.communications.length, 0),
          movementsReceived: sourceBatches.reduce((sum, row) => sum + row.cases.reduce((inner, item) => inner + (item.movements?.length ?? 0), 0), 0),
          entitiesProcessed: summaryEntities.length,
          errorCode: worst?.errorCode ?? null,
          sanitizedError: worst?.errorMessageSanitized ?? null,
        };
        if (liveRun && source === jobKey) {
          await deps.finishIntegrationRun?.({
            id: liveRun.id,
            status: worst?.outcome ?? "SUCCESS",
            summary,
            startedAt: liveRun.startedAt,
          });
        } else {
          await deps.recordIntegrationRun?.({
            target: TARGET[source] ?? source,
            mode: mode === "apply" ? "APPLY" : "PREVIEW",
            status: worst?.outcome ?? "SUCCESS",
            startedAt,
            finishedAt,
            durationMs,
            command: `${trigger}:${source}`,
            summary,
          });
        }
      }
      if (liveRun && jobKey === "ALL") {
        await deps.finishIntegrationRun?.({
          id: liveRun.id,
          status: batches.some((row) => row.outcome === "RATE_LIMITED")
            ? "RATE_LIMITED"
            : batches.every((row) => row.outcome === "SUCCESS" || row.outcome === "NO_RESULTS" || row.outcome === "PARTIAL")
              ? "SUCCESS"
              : "PARTIAL",
          summary: {
            trigger,
            job: "ALL",
            outcome: "SUCCESS",
            externalCall: batches.some((row) => row.externalCall),
            entitiesProcessed: summaryEntities.length,
            processesRequested: datajudHttpCache.size,
            processesFound: datajudHttpCache.size,
          },
          startedAt: liveRun.startedAt,
        });
      }
      return {
        mode,
        trigger,
        externalCall: batches.some((batch) => batch.externalCall),
        durationMs,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        uniqueDatajudTargets: datajudHttpCache.size,
        batches: batches.map((batch) => ({
          source: batch.source,
          outcome: batch.outcome,
          externalCall: batch.externalCall,
          errorCode: batch.errorCode,
          errorMessageSanitized: batch.errorMessageSanitized,
          retryAfterSeconds: batch.retryAfterSeconds,
          cases: batch.cases.length,
          communications: batch.communications.length,
        })),
        summary: { entities: summaryEntities },
      };
      } catch (error) {
        if (liveRun) {
          await deps.finishIntegrationRun?.({
            id: liveRun.id,
            status: "FAILED",
            summary: { trigger, job: jobKey, outcome: "FAILED", sanitizedError: "Falha na execução." },
            startedAt: liveRun.startedAt,
          });
        }
        throw error;
      } finally {
        sourceJobLocks.delete(jobKey);
      }
    },
    async testConnection(source: LegalExposureSource, input?: { entityId?: string }) {
      const started = Date.now();
      const runners = deps.runners ?? (await defaultRunners());
      const memory = await deps.repository.load();
      if (source === "DJEN") {
        const entity = input?.entityId
          ? memory.entities.find((row) => row.id === input.entityId && row.active)
          : memory.entities.find((row) => row.active);
        const nomeParte = entity?.legalName.trim() ?? "";
        const batch = nomeParte
          ? await runners.djen({ nomeParte })
          : failClosedBatch("DJEN", "DJEN exige nomeParte ou numeroProcesso.");
        return {
          source,
          success: batch.outcome === "SUCCESS" || batch.outcome === "NO_RESULTS" || batch.outcome === "PARTIAL",
          latencyMs: Date.now() - started,
          timestamp: now().toISOString(),
          sanitizedError: batch.errorMessageSanitized,
          externalCall: batch.externalCall,
          connectivityTest: nomeParte ? "RUN" : "NOT_RUN_NO_ENTITY",
        };
      }
      if (source === "DATAJUD") {
        const entity = input?.entityId
          ? memory.entities.find((row) => row.id === input.entityId && row.active)
          : memory.entities.find((row) => row.active);
        const known = entity ? collectKnownCaseDatajudTargets(memory, entity.id).targets[0] : undefined;
        if (!known) {
          return {
            source,
            success: true,
            latencyMs: Date.now() - started,
            timestamp: now().toISOString(),
            sanitizedError: null,
            externalCall: false,
            connectivityTest: "NOT_RUN_NO_KNOWN_PROCESS",
          };
        }
        const batch = await runners.datajud({
          processNumber: known.processNumber,
          tribunalAlias: known.tribunalAlias,
        });
        return {
          source,
          success: batch.outcome === "SUCCESS" || batch.outcome === "NO_RESULTS" || batch.outcome === "PARTIAL",
          latencyMs: Date.now() - started,
          timestamp: now().toISOString(),
          sanitizedError: batch.errorMessageSanitized,
          externalCall: batch.externalCall,
          connectivityTest: "RUN",
        };
      }
      if (source === "ESCAVADOR") {
        if (!isEscavadorEnabled() || !runners.escavador) {
          return {
            source,
            success: false,
            latencyMs: Date.now() - started,
            timestamp: now().toISOString(),
            sanitizedError: "Escavador desligado ou não configurado.",
            externalCall: false,
            connectivityTest: "NOT_CONFIGURED",
          };
        }
        const entity = input?.entityId
          ? memory.entities.find((row) => row.id === input.entityId && row.active)
          : memory.entities.find((row) => row.active);
        const known = entity ? memory.cases.find((row) => row.entityId === entity.id) : undefined;
        if (!known) {
          return {
            source,
            success: true,
            latencyMs: Date.now() - started,
            timestamp: now().toISOString(),
            sanitizedError: null,
            externalCall: false,
            connectivityTest: "NOT_RUN_NO_KNOWN_PROCESS",
          };
        }
        const batch = await runners.escavador({ processNumber: known.processNumberNormalized });
        return {
          source,
          success: batch.outcome === "SUCCESS" || batch.outcome === "NO_RESULTS" || batch.outcome === "PARTIAL",
          latencyMs: Date.now() - started,
          timestamp: now().toISOString(),
          sanitizedError: batch.errorMessageSanitized,
          externalCall: batch.externalCall,
          connectivityTest: "RUN",
        };
      }
      const batch = source === "DOMICILIO" ? await runners.domicilio() : disabledRunner(source);
      return {
        source,
        success: batch.outcome === "SUCCESS" || batch.outcome === "NO_RESULTS",
        latencyMs: Date.now() - started,
        timestamp: now().toISOString(),
        sanitizedError: batch.errorMessageSanitized,
        externalCall: batch.externalCall,
        connectivityTest: "RUN",
      };
    },
    async refreshCase(id: string, userId: string) {
      if (refreshingCases.has(id)) {
        throw new ExposureServiceError("Atualização deste processo já está em andamento.", "CONFLICT");
      }
      const memory = await deps.repository.load();
      const row = memory.cases.find((item) => item.id === id);
      if (!row) throw new ExposureServiceError("Processo não encontrado.", "NOT_FOUND");
      refreshingCases.add(id);
      try {
        return await this.sync(
          {
            entityId: row.entityId,
            processNumber: row.processNumberNormalized,
            source: "ALL",
            mode: "apply",
            trigger: "MANUAL",
          },
          userId
        );
      } finally {
        refreshingCases.delete(id);
      }
    },
    async completeCaseData(id: string, userId: string) {
      if (refreshingCases.has(id)) {
        throw new ExposureServiceError("Atualização deste processo já está em andamento.", "CONFLICT");
      }
      const memory = await deps.repository.load();
      const row = memory.cases.find((item) => item.id === id);
      if (!row) throw new ExposureServiceError("Processo não encontrado.", "NOT_FOUND");
      refreshingCases.add(id);
      try {
        const runners = deps.runners ?? (await defaultRunners());
        const { enrichLegalProcessByCnj } = await import("./legalProcessEnrichment.server.js");
        const timestamp = now().toISOString();
        const result = await enrichLegalProcessByCnj({
          memory,
          entityId: row.entityId,
          processNumber: row.processNumberNormalized,
          tribunal: row.tribunal,
          system: row.systemName,
          runners,
          now: timestamp,
          createId,
        });
        audit(
          memory,
          userId,
          "MANUAL_SYNC",
          { entityId: row.entityId, caseId: id },
          { kind: "COMPLETE_DATA", processNumber: row.processNumberNormalized, steps: result.steps }
        );
        await deps.repository.persist(memory);
        const dossier = buildExposureProcessDossier(memory, id);
        if (!dossier) throw new ExposureServiceError("Processo não encontrado.", "NOT_FOUND");
        return {
          steps: result.steps,
          coverageBefore: result.coverageBefore,
          coverageAfter: result.coverageAfter ?? dossier.coverage ?? null,
          dossier,
        };
      } finally {
        refreshingCases.delete(id);
      }
    },
    async groupReport(entityId: string | null, userId: string) {
      const memory = await deps.repository.load();
      await deps.repository.appendAudit(
        buildAuditRecord(userId, "VIEW_CASE", { entityId }, { report: "GROUP" })
      );
      return buildExposureGroupReport(memory, entityId);
    },
  };
}

function publicEntity(entity: ExposureEntityRecord) {
  return {
    id: entity.id,
    cnpj: entity.cnpj,
    legalName: entity.legalName,
    tradeName: entity.tradeName,
    active: entity.active,
    state: entity.state,
    city: entity.city,
    monitorDomicilio: entity.monitorDomicilio,
    monitorDatajud: entity.monitorDatajud,
    monitorDjen: entity.monitorDjen,
    monitorCertificates: entity.monitorCertificates,
    domicilioTenantId: entity.domicilioTenantId,
    lastSuccessfulSyncAt: entity.lastSuccessfulSyncAt,
  };
}

function publicAlias(alias: ExposureAliasRecord) {
  return {
    id: alias.id,
    entityId: alias.entityId,
    type: alias.type,
    value: alias.value,
    normalizedValue: alias.normalizedValue,
    active: alias.active,
    createdAt: alias.createdAt,
  };
}
