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
import { publicSourceConfiguration } from "./legalExposureFeatureFlags.js";
import {
  matchExposureGroupCompanies,
  OUTSIDE_GROUP_COMPANY_MESSAGE,
} from "./legalExposureEntityForm.js";
import { normalizeExposureCnpj, normalizeLegalName, normalizeProcessNumber, sanitizePayload } from "./legalExposureNormalization.js";
import { buildDjenDiscoveryTerms, isLegalAliasType } from "./legalExposureDiscovery.js";
import {
  collectDatajudTargetsFromBatch,
  collectKnownCaseDatajudTargets,
  countSourceOutcomes,
  emptyEntitySyncCounters,
  mergeDjenBatches,
  missingTribunalBatch,
  tagDiscoveryConfirmation,
  unionDatajudTargets,
  uniqueDiscoveredProcessCount,
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
  }) => Promise<void>;
};

const TARGET: Record<string, string> = {
  DOMICILIO: "LEGAL_EXPOSURE_DOMICILIO",
  DATAJUD: "LEGAL_EXPOSURE_DATAJUD",
  DJEN: "LEGAL_EXPOSURE_DJEN",
};

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

async function defaultRunners(): Promise<ExposureRunners> {
  const { runDomicilioSync } = await import("./sources/domicilio/domicilioSyncRunner.server.js");
  const { runDatajudSync } = await import("./sources/datajud/datajudSyncRunner.server.js");
  const { runDjenSync } = await import("./sources/djen/djenSyncRunner.server.js");
  return {
    domicilio: () => runDomicilioSync({}),
    datajud: (input) =>
      runDatajudSync({
        mode: "known-process",
        processNumber: input?.processNumber,
        tribunalAlias: input?.tribunalAlias ?? "",
      }),
    djen: (input) => runDjenSync(input ?? {}),
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
      const row = memory.cases.find((item) => item.id === id);
      if (!row) throw new ExposureServiceError("Processo não encontrado.", "NOT_FOUND");
      await deps.repository.appendAudit(
        buildAuditRecord(userId, "VIEW_CASE", { entityId: row.entityId, caseId: row.id }, {})
      );
      return {
        ...row,
        evidences: memory.evidences.filter((item) => item.caseId === id),
        parties: memory.parties.filter((item) => item.caseId === id),
      };
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
        alert.status = "ACKNOWLEDGED";
        alert.acknowledgedAt = now().toISOString();
        alert.acknowledgedByUserId = userId;
        audit(memory, userId, "ALERT_ACKNOWLEDGED", { entityId: alert.entityId }, { alertId: id });
      });
    },
    async resolveAlert(id: string, userId: string) {
      return mutate(userId, (memory) => {
        const alert = memory.alerts.find((row) => row.id === id);
        if (!alert) throw new ExposureServiceError("Alerta não encontrado.", "NOT_FOUND");
        alert.status = "RESOLVED";
        alert.resolvedAt = now().toISOString();
        alert.resolvedByUserId = userId;
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
      return {
        sources: sourceStatuses(memory, now()),
        configuration: publicSourceConfiguration(),
      };
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
      const runners = deps.runners ?? (await defaultRunners());
      const memory = await deps.repository.load();
      const pipelineAll = !input.source || input.source === "ALL";
      const wantsDjen = pipelineAll || input.source === "DJEN";
      const wantsDatajud = pipelineAll || input.source === "DATAJUD";
      const wantsDomicilio = pipelineAll || input.source === "DOMICILIO";
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
          }
          counters.djenQueries = djenPages.length;
          mergedDjen = mergeDjenBatches(djenPages);
          counters.uniqueProcessesDiscovered = uniqueDiscoveredProcessCount(mergedDjen);
          owned.push(mergedDjen);
          applyOwned(entity.id, mergedDjen);
        }

        if (wantsDatajud) {
          const discovered = pipelineAll || wantsDjen ? collectDatajudTargetsFromBatch(mergedDjen) : [];
          const known = collectKnownCaseDatajudTargets(memory, entity.id);
          let targets = unionDatajudTargets(discovered, known.targets);
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
              const batch = await runners.datajud({
                processNumber: target.processNumber,
                tribunalAlias: target.tribunalAlias,
              });
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

        Object.assign(counters, countSourceOutcomes(owned));
        summaryEntities.push({
          entityId: entity.id,
          legalName: entity.legalName,
          ...counters,
        });
      }

      audit(
        memory,
        userId,
        "MANUAL_SYNC",
        { entityId: input.entityId ?? null },
        { mode, source: input.source ?? "ALL", trigger }
      );
      await deps.repository.persist(memory);
      for (const batch of batches) {
        await deps.recordIntegrationRun?.({
          target: TARGET[batch.source] ?? batch.source,
          mode: mode === "apply" ? "APPLY" : "PREVIEW",
          status: batch.outcome,
          summary: {
            outcome: batch.outcome,
            externalCall: batch.externalCall,
            cases: batch.cases.length,
            communications: batch.communications.length,
            errorCode: batch.errorCode,
          },
        });
      }
      return {
        mode,
        trigger,
        externalCall: batches.some((batch) => batch.externalCall),
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
