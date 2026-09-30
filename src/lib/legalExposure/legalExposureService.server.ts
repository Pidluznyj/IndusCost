/**
 * Casos de uso do Exposure. Chamadas externas só pelos runners injetados,
 * que falham fechado quando a flag está desligada.
 */

import { randomUUID } from "node:crypto";
import { isValidCnpj } from "@/src/lib/companyCnpjFormat.js";
import { FINANCE_INTERNAL_GROUP_COMPANIES } from "@/src/lib/financeInternalGroupExclusions.js";
import { saveAppLocalFile } from "@/src/lib/appLocalFileStorage.js";
import { applyBatchToMemory } from "./legalExposureApply.js";
import type { LegalExposureSource, NormalizedSourceBatch } from "./legalExposureContracts.js";
import { publicSourceConfiguration } from "./legalExposureFeatureFlags.js";
import {
  matchExposureGroupCompanies,
  OUTSIDE_GROUP_COMPANY_MESSAGE,
} from "./legalExposureEntityForm.js";
import { normalizeExposureCnpj, normalizeLegalName, sanitizePayload } from "./legalExposureNormalization.js";
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

export function createLegalExposureService(deps: ExposureServiceDeps) {
  const now = () => (deps.now ? deps.now() : new Date());
  const createId = deps.createId ?? (() => randomUUID());

  async function mutate(userId: string | null, change: (memory: LegalExposureMemory) => void) {
    const memory = await deps.repository.load();
    change(memory);
    await deps.repository.persist(memory);
    return memory;
  }

  function audit(
    memory: LegalExposureMemory,
    userId: string | null,
    action: ExposureAuditRecord["action"],
    refs: { entityId?: string | null; caseId?: string | null; communicationId?: string | null },
    metadata: unknown
  ) {
    memory.audits.push({
      id: createId(),
      userId,
      action,
      entityId: refs.entityId ?? null,
      caseId: refs.caseId ?? null,
      communicationId: refs.communicationId ?? null,
      occurredAt: now().toISOString(),
      metadata: sanitizePayload(metadata),
      createdAt: now().toISOString(),
    });
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
    async listCases(query: ExposureListQuery) {
      return listCases(await deps.repository.load(), query);
    },
    async getCase(id: string, userId: string) {
      const memory = await deps.repository.load();
      const row = memory.cases.find((item) => item.id === id);
      if (!row) throw new ExposureServiceError("Processo não encontrado.", "NOT_FOUND");
      audit(memory, userId, "VIEW_CASE", { entityId: row.entityId, caseId: row.id }, {});
      await deps.repository.persist(memory);
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
      audit(memory, userId, "VIEW_CASE", { entityId: row.entityId, caseId: id }, { timeline: true });
      await deps.repository.persist(memory);
      return caseTimeline(memory, id, query);
    },
    async listCommunications(query: ExposureListQuery, userId: string) {
      const memory = await deps.repository.load();
      audit(memory, userId, "VIEW_COMMUNICATION_METADATA", {}, {});
      await deps.repository.persist(memory);
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
    }, userId: string) {
      const mode = input.mode === "apply" ? "apply" : "preview";
      const runners = deps.runners ?? (await defaultRunners());
      const memory = await deps.repository.load();
      const selected = input.source && input.source !== "ALL" ? [input.source] : (["DOMICILIO", "DATAJUD", "DJEN"] as const);
      const batches: NormalizedSourceBatch[] = [];
      for (const source of selected) {
        if (source === "DOMICILIO") batches.push(await runners.domicilio());
        if (source === "DATAJUD") {
          const aliases = [
            ...new Set(
              memory.jurisdictions
                .filter((row) => row.enabled && (!input.entityId || row.entityId === input.entityId))
                .map((row) => row.tribunal)
            ),
          ];
          const targets = aliases.length > 0 ? aliases : [""];
          for (const tribunalAlias of targets) {
            batches.push(await runners.datajud({ processNumber: input.processNumber, tribunalAlias }));
          }
        }
        if (source === "DJEN") batches.push(await runners.djen({ numeroProcesso: input.processNumber }));
      }
      audit(memory, userId, "MANUAL_SYNC", { entityId: input.entityId ?? null }, { mode, source: input.source ?? "ALL" });
      if (mode === "apply") {
        const entities = memory.entities.filter((row) => row.active && (!input.entityId || row.id === input.entityId));
        for (const entity of entities) {
          for (const batch of batches) {
            if (batch.externalCall || batch.outcome === "NO_RESULTS" || batch.outcome === "SUCCESS" || batch.outcome === "PARTIAL") {
              applyBatchToMemory(memory, {
                entityId: entity.id,
                batch,
                now: now().toISOString(),
                createId,
              });
            }
          }
        }
      }
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
      };
    },
    async testConnection(source: LegalExposureSource) {
      const started = Date.now();
      const runners = deps.runners ?? (await defaultRunners());
      const batch =
        source === "DOMICILIO"
          ? await runners.domicilio()
          : source === "DATAJUD"
            ? await runners.datajud()
            : source === "DJEN"
              ? await runners.djen()
              : disabledRunner(source);
      return {
        source,
        success: batch.outcome === "SUCCESS" || batch.outcome === "NO_RESULTS",
        latencyMs: Date.now() - started,
        timestamp: now().toISOString(),
        sanitizedError: batch.errorMessageSanitized,
        externalCall: batch.externalCall,
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
