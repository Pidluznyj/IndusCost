/**
 * Repositório do Exposure. Não apaga fatos históricos.
 */

import { Prisma, type PrismaClient } from "@prisma/client";
import type { ExposureAuditRecord, LegalExposureMemory } from "./legalExposureStore.js";
import { createEmptyExposureMemory } from "./legalExposureStore.js";

export type LegalExposureRepository = {
  load(): Promise<LegalExposureMemory>;
  persist(next: LegalExposureMemory): Promise<void>;
  appendAudit(record: ExposureAuditRecord): Promise<void>;
};

export function createMemoryExposureRepository(
  initial: LegalExposureMemory = createEmptyExposureMemory()
): LegalExposureRepository & { snapshot(): LegalExposureMemory } {
  let current = initial;
  return {
    snapshot: () => current,
    async load() {
      return current;
    },
    async persist(next) {
      current = next;
    },
    async appendAudit(record) {
      current.audits.push(record);
    },
  };
}

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function date(value: string | null | undefined): Date | null {
  if (!value) return null;
  return new Date(value);
}

function persistTimestamps(row: { createdAt: string; updatedAt: string }) {
  return {
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

function json(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value == null) return Prisma.JsonNull;
  return value as Prisma.InputJsonValue;
}

export function createPrismaExposureRepository(prisma: PrismaClient): LegalExposureRepository {
  return {
    async load() {
      const [
        entities,
        aliases,
        connections,
        jurisdictions,
        cases,
        entityLinks,
        subjects,
        hearings,
        attorneys,
        evidences,
        parties,
        movements,
        communications,
        events,
        alerts,
        certificates,
        audits,
      ] = await Promise.all([
        prisma.legalExposureEntity.findMany(),
        prisma.legalExposureEntityAlias.findMany(),
        prisma.legalSourceConnection.findMany(),
        prisma.legalExposureJurisdiction.findMany(),
        prisma.legalCase.findMany(),
        prisma.legalCaseEntityLink.findMany(),
        prisma.legalCaseSubject.findMany(),
        prisma.legalCaseHearing.findMany(),
        prisma.legalCaseAttorney.findMany(),
        prisma.legalCaseSourceEvidence.findMany(),
        prisma.legalCaseParty.findMany(),
        prisma.legalCaseMovement.findMany(),
        prisma.legalCommunication.findMany(),
        prisma.legalExposureEvent.findMany(),
        prisma.legalExposureAlert.findMany(),
        prisma.legalCertificate.findMany(),
        prisma.legalExposureAuditLog.findMany(),
      ]);
      return {
        entities: entities.map((row) => ({
          ...row,
          tradeName: row.tradeName,
          state: row.state,
          city: row.city,
          domicilioTenantId: row.domicilioTenantId,
          lastSuccessfulSyncAt: iso(row.lastSuccessfulSyncAt),
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        })),
        aliases: aliases.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
        connections: connections.map((row) => ({
          ...row,
          lastAttemptAt: iso(row.lastAttemptAt),
          lastSuccessfulAt: iso(row.lastSuccessfulAt),
          lastFullSyncAt: iso(row.lastFullSyncAt),
          lastErrorAt: iso(row.lastErrorAt),
          sourceUpdatedAt: iso(row.sourceUpdatedAt),
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        })),
        jurisdictions: jurisdictions.map((row) => ({
          ...row,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        })),
        cases: cases.map((row) => ({
          ...row,
          claimValue: row.claimValue == null ? null : row.claimValue.toString(),
          filedAt: iso(row.filedAt),
          archivedAt: iso(row.archivedAt),
          firstSeenAt: row.firstSeenAt.toISOString(),
          lastSeenAt: row.lastSeenAt.toISOString(),
          sourceUpdatedAt: iso(row.sourceUpdatedAt),
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        })),
        entityLinks: entityLinks.map((row) => ({
          ...row,
          firstSeenAt: row.firstSeenAt.toISOString(),
          lastSeenAt: row.lastSeenAt.toISOString(),
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        })),
        subjects: subjects.map((row) => ({
          ...row,
          firstSeenAt: row.firstSeenAt.toISOString(),
          lastSeenAt: row.lastSeenAt.toISOString(),
        })),
        hearings: hearings.map((row) => ({
          ...row,
          scheduledAt: iso(row.scheduledAt),
          firstSeenAt: row.firstSeenAt.toISOString(),
        })),
        attorneys: attorneys.map((row) => ({
          ...row,
          firstSeenAt: row.firstSeenAt.toISOString(),
          lastSeenAt: row.lastSeenAt.toISOString(),
        })),
        evidences: evidences.map((row) => ({
          ...row,
          firstSeenAt: row.firstSeenAt.toISOString(),
          lastSeenAt: row.lastSeenAt.toISOString(),
          sourceUpdatedAt: iso(row.sourceUpdatedAt),
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        })),
        parties: parties.map((row) => ({
          ...row,
          firstSeenAt: row.firstSeenAt.toISOString(),
          lastSeenAt: row.lastSeenAt.toISOString(),
        })),
        movements: movements.map((row) => ({
          ...row,
          occurredAt: iso(row.occurredAt),
          firstSeenAt: row.firstSeenAt.toISOString(),
          createdAt: row.createdAt.toISOString(),
        })),
        communications: communications.map((row) => ({
          ...row,
          availableAt: iso(row.availableAt),
          detectedAt: row.detectedAt.toISOString(),
          scienceDeadlineAt: iso(row.scienceDeadlineAt),
          sourceScienceAt: iso(row.sourceScienceAt),
          officialContentOpenedAt: iso(row.officialContentOpenedAt),
          firstSeenAt: row.firstSeenAt.toISOString(),
          lastSeenAt: row.lastSeenAt.toISOString(),
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        })),
        events: events.map((row) => ({
          ...row,
          detectedAt: row.detectedAt.toISOString(),
          createdAt: row.createdAt.toISOString(),
        })),
        alerts: alerts.map((row) => ({
          ...row,
          createdAt: row.createdAt.toISOString(),
          acknowledgedAt: iso(row.acknowledgedAt),
          resolvedAt: iso(row.resolvedAt),
        })),
        certificates: certificates.map((row) => ({
          ...row,
          issuedAt: iso(row.issuedAt),
          validUntil: iso(row.validUntil),
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        })),
        audits: audits.map((row) => ({
          ...row,
          occurredAt: row.occurredAt.toISOString(),
          createdAt: row.createdAt.toISOString(),
        })),
      };
    },
    async persist(next) {
      await prisma.$transaction(async (tx) => {
        for (const row of next.entities) {
          const data = {
            cnpj: row.cnpj,
            legalName: row.legalName,
            tradeName: row.tradeName,
            active: row.active,
            state: row.state,
            city: row.city,
            monitorDomicilio: row.monitorDomicilio,
            monitorDatajud: row.monitorDatajud,
            monitorDjen: row.monitorDjen,
            monitorCertificates: row.monitorCertificates,
            domicilioTenantId: row.domicilioTenantId,
            lastSuccessfulSyncAt: date(row.lastSuccessfulSyncAt),
          };
          await tx.legalExposureEntity.upsert({
            where: { id: row.id },
            create: { id: row.id, ...data, ...persistTimestamps(row) },
            update: { ...data, updatedAt: new Date(row.updatedAt) },
          });
        }
        for (const row of next.aliases) {
          await tx.legalExposureEntityAlias.upsert({
            where: { id: row.id },
            create: {
              id: row.id,
              entityId: row.entityId,
              type: row.type,
              value: row.value,
              normalizedValue: row.normalizedValue,
              active: row.active,
              createdAt: new Date(row.createdAt),
            },
            update: { active: row.active, value: row.value, normalizedValue: row.normalizedValue, type: row.type },
          });
        }
        for (const row of next.connections) {
          const data = {
            environment: row.environment,
            enabled: row.enabled,
            status: row.status,
            lastAttemptAt: date(row.lastAttemptAt),
            lastSuccessfulAt: date(row.lastSuccessfulAt),
            lastFullSyncAt: date(row.lastFullSyncAt),
            lastErrorAt: date(row.lastErrorAt),
            lastErrorCode: row.lastErrorCode,
            lastErrorMessageSanitized: row.lastErrorMessageSanitized,
            sourceUpdatedAt: date(row.sourceUpdatedAt),
          };
          await tx.legalSourceConnection.upsert({
            where: { id: row.id },
            create: {
              id: row.id,
              entityId: row.entityId,
              source: row.source,
              ...data,
              ...persistTimestamps(row),
            },
            update: { ...data, updatedAt: new Date(row.updatedAt) },
          });
        }
        for (const row of next.jurisdictions) {
          await tx.legalExposureJurisdiction.upsert({
            where: { id: row.id },
            create: {
              id: row.id,
              entityId: row.entityId,
              tribunal: row.tribunal,
              enabled: row.enabled,
              priority: row.priority,
              createdAt: new Date(row.createdAt),
              updatedAt: new Date(row.updatedAt),
            },
            update: {
              enabled: row.enabled,
              priority: row.priority,
              tribunal: row.tribunal,
              updatedAt: new Date(row.updatedAt),
            },
          });
        }
        for (const row of next.cases) {
          const data = {
            processNumber: row.processNumber,
            processNumberNormalized: row.processNumberNormalized,
            tribunal: row.tribunal,
            jurisdiction: row.jurisdiction,
            degree: row.degree,
            courtUnit: row.courtUnit,
            classCode: row.classCode,
            className: row.className,
            filedAt: date(row.filedAt),
            currentStatus: row.currentStatus,
            entityPole: row.entityPole,
            systemName: row.systemName,
            area: row.area,
            claimValue: row.claimValue == null ? null : new Prisma.Decimal(row.claimValue),
            claimCurrency: row.claimCurrency,
            archivedAt: date(row.archivedAt),
            secrecy: row.secrecy,
            priority: row.priority,
            firstSeenAt: new Date(row.firstSeenAt),
            lastSeenAt: new Date(row.lastSeenAt),
            primarySource: row.primarySource,
            sourceUpdatedAt: date(row.sourceUpdatedAt),
          };
          await tx.legalCase.upsert({
            where: { id: row.id },
            create: { id: row.id, entityId: row.entityId, ...data, ...persistTimestamps(row) },
            update: { ...data, updatedAt: new Date(row.updatedAt) },
          });
        }
        for (const row of next.entityLinks) {
          if (!/^[0-9a-f-]{36}$/i.test(row.id)) continue;
          await tx.legalCaseEntityLink.upsert({
            where: { id: row.id },
            create: {
              id: row.id,
              caseId: row.caseId,
              entityId: row.entityId,
              pole: row.pole,
              confidence: row.confidence,
              firstSource: row.firstSource,
              lastSource: row.lastSource,
              firstSeenAt: new Date(row.firstSeenAt),
              lastSeenAt: new Date(row.lastSeenAt),
              ...persistTimestamps(row),
            },
            update: {
              pole: row.pole,
              confidence: row.confidence,
              lastSource: row.lastSource,
              lastSeenAt: new Date(row.lastSeenAt),
              updatedAt: new Date(row.updatedAt),
            },
          });
        }
        for (const row of next.subjects) {
          await tx.legalCaseSubject.upsert({
            where: { id: row.id },
            create: {
              ...row,
              firstSeenAt: new Date(row.firstSeenAt),
              lastSeenAt: new Date(row.lastSeenAt),
            },
            update: { lastSeenAt: new Date(row.lastSeenAt), isMain: row.isMain, fullPath: row.fullPath, code: row.code },
          });
        }
        for (const row of next.hearings) {
          await tx.legalCaseHearing.upsert({
            where: { id: row.id },
            create: {
              ...row,
              scheduledAt: date(row.scheduledAt),
              firstSeenAt: new Date(row.firstSeenAt),
            },
            update: {},
          });
        }
        for (const row of next.attorneys) {
          await tx.legalCaseAttorney.upsert({
            where: { id: row.id },
            create: {
              ...row,
              firstSeenAt: new Date(row.firstSeenAt),
              lastSeenAt: new Date(row.lastSeenAt),
            },
            update: { lastSeenAt: new Date(row.lastSeenAt) },
          });
        }
        for (const row of next.evidences) {
          await tx.legalCaseSourceEvidence.upsert({
            where: { id: row.id },
            create: {
              ...row,
              firstSeenAt: new Date(row.firstSeenAt),
              lastSeenAt: new Date(row.lastSeenAt),
              sourceUpdatedAt: date(row.sourceUpdatedAt),
              rawMetadata: json(row.rawMetadata),
              createdAt: new Date(row.createdAt),
              updatedAt: new Date(row.updatedAt),
            },
            update: {
              confidence: row.confidence,
              lastSeenAt: new Date(row.lastSeenAt),
              sourceUpdatedAt: date(row.sourceUpdatedAt),
              rawMetadata: json(row.rawMetadata),
              rawHash: row.rawHash,
              updatedAt: new Date(row.updatedAt),
            },
          });
        }
        for (const row of next.parties) {
          await tx.legalCaseParty.upsert({
            where: { id: row.id },
            create: {
              ...row,
              firstSeenAt: new Date(row.firstSeenAt),
              lastSeenAt: new Date(row.lastSeenAt),
            },
            update: { lastSeenAt: new Date(row.lastSeenAt), pole: row.pole },
          });
        }
        for (const row of next.movements) {
          await tx.legalCaseMovement.upsert({
            where: { id: row.id },
            create: {
              ...row,
              occurredAt: date(row.occurredAt),
              complements: json(row.complements),
              firstSeenAt: new Date(row.firstSeenAt),
              rawMetadata: json(row.rawMetadata),
              createdAt: new Date(row.createdAt),
            },
            update: {},
          });
        }
        for (const row of next.communications) {
          const data = {
            caseId: row.caseId,
            processNumber: row.processNumber,
            communicationType: row.communicationType,
            subject: row.subject,
            sourceStatus: row.sourceStatus,
            normalizedStatus: row.normalizedStatus,
            availableAt: date(row.availableAt),
            detectedAt: new Date(row.detectedAt),
            scienceDeadlineAt: date(row.scienceDeadlineAt),
            sourceScienceAt: date(row.sourceScienceAt),
            officialContentOpenedAt: date(row.officialContentOpenedAt),
            officialContentOpenedByUserId: row.officialContentOpenedByUserId,
            tribunal: row.tribunal,
            courtUnit: row.courtUnit,
            rawMetadata: json(row.rawMetadata),
            rawHash: row.rawHash,
            firstSeenAt: new Date(row.firstSeenAt),
            lastSeenAt: new Date(row.lastSeenAt),
          };
          await tx.legalCommunication.upsert({
            where: { id: row.id },
            create: {
              id: row.id,
              entityId: row.entityId,
              source: row.source,
              sourceCommunicationId: row.sourceCommunicationId,
              idempotencyKey: row.idempotencyKey,
              ...data,
              ...persistTimestamps(row),
            },
            update: { ...data, updatedAt: new Date(row.updatedAt) },
          });
        }
        for (const row of next.events) {
          await tx.legalExposureEvent.upsert({
            where: { id: row.id },
            create: {
              ...row,
              detectedAt: new Date(row.detectedAt),
              payload: json(row.payload),
              createdAt: new Date(row.createdAt),
            },
            update: {},
          });
        }
        for (const row of next.alerts) {
          await tx.legalExposureAlert.upsert({
            where: { id: row.id },
            create: {
              ...row,
              createdAt: new Date(row.createdAt),
              acknowledgedAt: date(row.acknowledgedAt),
              resolvedAt: date(row.resolvedAt),
            },
            update: {
              status: row.status,
              acknowledgedAt: date(row.acknowledgedAt),
              acknowledgedByUserId: row.acknowledgedByUserId,
              resolvedAt: date(row.resolvedAt),
              resolvedByUserId: row.resolvedByUserId,
            },
          });
        }
        for (const row of next.certificates) {
          const data = {
            type: row.type,
            tribunal: row.tribunal,
            issuedAt: date(row.issuedAt),
            validUntil: date(row.validUntil),
            result: row.result,
            verificationCode: row.verificationCode,
            fileStorageKey: row.fileStorageKey,
            originalFileName: row.originalFileName,
            notes: row.notes,
            registeredByUserId: row.registeredByUserId,
          };
          await tx.legalCertificate.upsert({
            where: { id: row.id },
            create: { id: row.id, entityId: row.entityId, ...data, ...persistTimestamps(row) },
            update: { ...data, updatedAt: new Date(row.updatedAt) },
          });
        }
        for (const row of next.audits) {
          await tx.legalExposureAuditLog.upsert({
            where: { id: row.id },
            create: {
              ...row,
              occurredAt: new Date(row.occurredAt),
              metadata: json(row.metadata),
              createdAt: new Date(row.createdAt),
            },
            update: {},
          });
        }
      });
    },
    async appendAudit(record) {
      await prisma.legalExposureAuditLog.create({
        data: {
          id: record.id,
          userId: record.userId,
          action: record.action,
          entityId: record.entityId,
          caseId: record.caseId,
          communicationId: record.communicationId,
          occurredAt: new Date(record.occurredAt),
          metadata: json(record.metadata),
          createdAt: new Date(record.createdAt),
        },
      });
    },
  };
}
