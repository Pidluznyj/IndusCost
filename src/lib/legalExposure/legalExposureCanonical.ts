/**
 * Identidade canônica por CNJ. Duplicatas físicas históricas não são apagadas.
 */

import type { LegalCasePole, LegalEvidenceConfidence, LegalExposureSource } from "./legalExposureContracts.js";
import { canonicalProcessKey, resolveProcessIndexKey } from "./legalExposureNormalization.js";
import type {
  ExposureCaseRecord,
  ExposureEntityLinkRecord,
  LegalExposureMemory,
} from "./legalExposureStore.js";

export function pickCanonicalCase(cases: ExposureCaseRecord[]): ExposureCaseRecord | null {
  if (cases.length === 0) return null;
  return [...cases].sort((left, right) => {
    const created = Date.parse(left.createdAt) - Date.parse(right.createdAt);
    if (created !== 0) return created;
    return left.id.localeCompare(right.id);
  })[0] ?? null;
}

export function casesForProcess(
  memory: LegalExposureMemory,
  processNumberNormalized: string
): ExposureCaseRecord[] {
  const want = resolveProcessIndexKey(processNumberNormalized);
  return memory.cases.filter(
    (row) => canonicalProcessKey(row.processNumberNormalized || row.processNumber, row.id).key === want
  );
}

export function derivedEntityLinks(memory: LegalExposureMemory): ExposureEntityLinkRecord[] {
  const out: ExposureEntityLinkRecord[] = [...memory.entityLinks];
  const seen = new Set(out.map((row) => `${row.caseId}:${row.entityId}`));
  for (const legalCase of memory.cases) {
    const key = `${legalCase.id}:${legalCase.entityId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: `legacy-link:${legalCase.id}:${legalCase.entityId}`,
      caseId: legalCase.id,
      entityId: legalCase.entityId,
      pole: legalCase.entityPole,
      confidence: "CONFIRMED",
      firstSource: legalCase.primarySource,
      lastSource: legalCase.primarySource,
      firstSeenAt: legalCase.firstSeenAt,
      lastSeenAt: legalCase.lastSeenAt,
      createdAt: legalCase.createdAt,
      updatedAt: legalCase.updatedAt,
    });
  }
  return out;
}

export function upsertEntityLink(
  memory: LegalExposureMemory,
  input: {
    caseId: string;
    entityId: string;
    pole: LegalCasePole;
    source: LegalExposureSource;
    now: string;
    createId: () => string;
    confidence?: LegalEvidenceConfidence;
  }
): ExposureEntityLinkRecord {
  const existing = memory.entityLinks.find(
    (row) => row.caseId === input.caseId && row.entityId === input.entityId
  );
  if (existing) {
    existing.lastSeenAt = input.now;
    existing.lastSource = input.source;
    existing.updatedAt = input.now;
    if (input.pole !== "UNKNOWN" && existing.pole === "UNKNOWN") existing.pole = input.pole;
    if (input.confidence) existing.confidence = input.confidence;
    return existing;
  }
  const row: ExposureEntityLinkRecord = {
    id: input.createId(),
    caseId: input.caseId,
    entityId: input.entityId,
    pole: input.pole,
    confidence: input.confidence ?? "CONFIRMED",
    firstSource: input.source,
    lastSource: input.source,
    firstSeenAt: input.now,
    lastSeenAt: input.now,
    createdAt: input.now,
    updatedAt: input.now,
  };
  memory.entityLinks.push(row);
  return row;
}

export function resolveCanonicalCaseGroup(
  memory: LegalExposureMemory,
  processNumberNormalized: string
): {
  canonicalCase: ExposureCaseRecord | null;
  caseIds: string[];
  entityLinks: ExposureEntityLinkRecord[];
} {
  const siblings = casesForProcess(memory, processNumberNormalized);
  const canonicalCase = pickCanonicalCase(siblings);
  const caseIds = siblings.map((row) => row.id);
  const idSet = new Set(caseIds);
  const entityLinks = derivedEntityLinks(memory).filter((row) => idSet.has(row.caseId));
  const unique = new Map<string, ExposureEntityLinkRecord>();
  for (const link of entityLinks) {
    const current = unique.get(link.entityId);
    if (!current) {
      unique.set(link.entityId, link);
      continue;
    }
    if (current.pole === "UNKNOWN" && link.pole !== "UNKNOWN") unique.set(link.entityId, link);
  }
  return { canonicalCase, caseIds, entityLinks: [...unique.values()] };
}

export function previewCanonicalGroups(memory: LegalExposureMemory) {
  const byProcess = new Map<string, ExposureCaseRecord[]>();
  const invalidProcessNumbers: Array<{ caseId: string; processNumber: string; reason: string }> = [];
  for (const row of memory.cases) {
    const canon = canonicalProcessKey(row.processNumberNormalized || row.processNumber, row.id);
    if (!canon.ok) {
      invalidProcessNumbers.push({
        caseId: row.id,
        processNumber: row.processNumber || row.processNumberNormalized,
        reason: canon.reason,
      });
    }
    const list = byProcess.get(canon.key) ?? [];
    list.push(row);
    byProcess.set(canon.key, list);
  }
  const entityById = new Map(memory.entities.map((row) => [row.id, row]));
  const groups = [...byProcess.entries()].map(([processNumberNormalized, siblings]) => {
    const group = resolveCanonicalCaseGroup(memory, processNumberNormalized);
    const caseIdSet = new Set(group.caseIds);
    const companies = group.entityLinks.map((link) => {
      const entity = entityById.get(link.entityId);
      return {
        entityId: link.entityId,
        legalName: entity?.legalName ?? "",
        pole: link.pole,
      };
    });
    return {
      processNumberNormalized,
      processNumber: group.canonicalCase?.processNumber ?? siblings[0]?.processNumber ?? "",
      physicalCaseCount: siblings.length,
      caseIds: group.caseIds,
      entityIds: group.entityLinks.map((row) => row.entityId),
      companies,
      evidenceCount: memory.evidences.filter((row) => caseIdSet.has(row.caseId)).length,
      movementCount: memory.movements.filter((row) => caseIdSet.has(row.caseId)).length,
      communicationCount: memory.communications.filter((row) => row.caseId && caseIdSet.has(row.caseId)).length,
      eventCount: memory.events.filter((row) => row.caseId && caseIdSet.has(row.caseId)).length,
      partyCount: memory.parties.filter((row) => caseIdSet.has(row.caseId)).length,
    };
  });
  const duplicated = groups.filter((row) => row.physicalCaseCount > 1);
  const pending = missingLegacyEntityLinks(memory);
  return {
    physicalCases: memory.cases.length,
    uniqueCnj: groups.length,
    uniqueProcesses: groups.length,
    duplicateCnjGroups: duplicated.length,
    entityLinksExisting: memory.entityLinks.length,
    entityLinksToCreate: pending.length,
    casesWithoutEntity: memory.cases.filter((row) => !row.entityId).length,
    casesWithoutNormalizedNumber: memory.cases.filter((row) => !row.processNumberNormalized).length,
    validCnjCases: memory.cases.filter((row) => canonicalProcessKey(row.processNumberNormalized || row.processNumber, row.id).ok).length,
    uniqueCanonicalCnj: groups.filter((row) => !String(row.processNumberNormalized).startsWith("invalid:")).length,
    invalidProcessNumbers: invalidProcessNumbers.length,
    invalidProcessNumberRows: invalidProcessNumbers,
    movements: memory.movements.length,
    evidences: memory.evidences.length,
    communications: memory.communications.length,
    duplicatedProcesses: duplicated.map((row) => ({
      processNumber: row.processNumber,
      processNumberNormalized: row.processNumberNormalized,
      physicalCases: row.physicalCaseCount,
      companies: row.companies,
      caseIds: row.caseIds,
      evidenceCount: row.evidenceCount,
      movementCount: row.movementCount,
      communicationCount: row.communicationCount,
      eventCount: row.eventCount,
      partyCount: row.partyCount,
    })),
    groups,
  };
}

export function missingLegacyEntityLinks(memory: LegalExposureMemory): Array<{
  caseId: string;
  entityId: string;
  pole: LegalCasePole;
  source: LegalExposureSource;
  firstSeenAt: string;
  lastSeenAt: string;
}> {
  const existing = new Set(memory.entityLinks.map((row) => `${row.caseId}:${row.entityId}`));
  const missing: Array<{
    caseId: string;
    entityId: string;
    pole: LegalCasePole;
    source: LegalExposureSource;
    firstSeenAt: string;
    lastSeenAt: string;
  }> = [];
  for (const legalCase of memory.cases) {
    if (!legalCase.entityId) continue;
    const key = `${legalCase.id}:${legalCase.entityId}`;
    if (existing.has(key)) continue;
    existing.add(key);
    missing.push({
      caseId: legalCase.id,
      entityId: legalCase.entityId,
      pole: legalCase.entityPole,
      source: legalCase.primarySource,
      firstSeenAt: legalCase.firstSeenAt,
      lastSeenAt: legalCase.lastSeenAt,
    });
  }
  return missing;
}

export function applyCanonicalEntityLinks(
  memory: LegalExposureMemory,
  createId: () => string,
  now = new Date().toISOString()
): { created: number; skipped: number } {
  const pending = missingLegacyEntityLinks(memory);
  for (const row of pending) {
    memory.entityLinks.push({
      id: createId(),
      caseId: row.caseId,
      entityId: row.entityId,
      pole: row.pole,
      confidence: "CONFIRMED",
      firstSource: row.source,
      lastSource: row.source,
      firstSeenAt: row.firstSeenAt,
      lastSeenAt: row.lastSeenAt,
      createdAt: now,
      updatedAt: now,
    });
  }
  return { created: pending.length, skipped: memory.cases.length - pending.length };
}
