/**
 * Identidade canônica de pessoas comissionadas — puro (sem Prisma).
 * Reutiliza normalização de nomes do CRM.
 */

import { normalizeSearchString } from "@/src/lib/utils.js";

export type CommissionPersonIdentityType = "SELLER" | "REPRESENTATIVE" | "MANAGER" | "OTHER";

export type CommissionPersonIdentityRow = {
  id: string;
  nomusPersonId: number | null;
  name: string;
  type: CommissionPersonIdentityType | string;
  source: "NOMUS" | "MANUAL" | string;
  active: boolean;
  createdAt?: Date | string;
  linkedRecordCount?: number;
};

export type PersonImportFragment = {
  type: CommissionPersonIdentityType;
  nomusPersonId: number | null;
  name: string;
};

export type ConsolidatedImportCandidate = {
  type: CommissionPersonIdentityType;
  name: string;
  nomusPersonId: number | null;
  aliasNomusPersonIds: number[];
};

/** trim, uppercase sem acentos, espaços colapsados. */
export function normalizeCommissionPersonName(value: string | null | undefined): string {
  if (!value?.trim()) return "";
  return normalizeSearchString(value).replace(/\s+/g, " ").trim();
}

export function buildCommissionPersonNomusKey(
  type: string,
  nomusPersonId: number
): string {
  return `${type}:nomus:${nomusPersonId}`;
}

export function buildCommissionPersonNameKey(type: string, name: string): string | null {
  const normalized = normalizeCommissionPersonName(name);
  if (!normalized) return null;
  return `${type}:name:${normalized}`;
}

function pickBestDisplayName(names: string[]): string {
  let best = "";
  for (const raw of names) {
    const trimmed = raw.trim().replace(/\s+/g, " ");
    if (trimmed.length > best.length) best = trimmed;
  }
  return best;
}

/** Agrupa fragmentos de importação por type + nome normalizado (ou id isolado). */
export function consolidatePersonImportFragments(
  fragments: PersonImportFragment[]
): ConsolidatedImportCandidate[] {
  const buckets = new Map<string, PersonImportFragment[]>();

  for (const fragment of fragments) {
    const normalized = normalizeCommissionPersonName(fragment.name);
    const key = normalized
      ? `${fragment.type}:name:${normalized}`
      : fragment.nomusPersonId != null && fragment.nomusPersonId > 0
        ? `${fragment.type}:id:${fragment.nomusPersonId}`
        : null;
    if (!key) continue;
    const bucket = buckets.get(key) ?? [];
    bucket.push(fragment);
    buckets.set(key, bucket);
  }

  const results: ConsolidatedImportCandidate[] = [];
  for (const group of buckets.values()) {
    const ids = [
      ...new Set(
        group
          .map((g) => g.nomusPersonId)
          .filter((id): id is number => id != null && id > 0)
      ),
    ].sort((a, b) => a - b);

    results.push({
      type: group[0]!.type,
      name: pickBestDisplayName(group.map((g) => g.name)),
      nomusPersonId: ids[0] ?? null,
      aliasNomusPersonIds: ids.slice(1),
    });
  }

  return results;
}

/** Pontuação para escolher registro canônico: Nomus > Manual, com ID > sem ID, ativo > inativo. */
export function scoreCommissionPersonCanonical(row: CommissionPersonIdentityRow): number {
  let score = 0;
  if (row.source === "NOMUS") score += 100;
  if (row.nomusPersonId != null && row.nomusPersonId > 0) score += 50;
  if (row.active) score += 10;
  score += Math.min(row.linkedRecordCount ?? 0, 1000);
  return score;
}

export function pickCanonicalCommissionPerson<T extends CommissionPersonIdentityRow>(
  persons: T[]
): T | null {
  if (persons.length === 0) return null;
  if (persons.length === 1) return persons[0]!;

  return [...persons].sort((a, b) => {
    const scoreDiff = scoreCommissionPersonCanonical(b) - scoreCommissionPersonCanonical(a);
    if (scoreDiff !== 0) return scoreDiff;
    const aTime =
      a.createdAt instanceof Date
        ? a.createdAt.getTime()
        : a.createdAt
          ? new Date(a.createdAt).getTime()
          : 0;
    const bTime =
      b.createdAt instanceof Date
        ? b.createdAt.getTime()
        : b.createdAt
          ? new Date(b.createdAt).getTime()
          : 0;
    return aTime - bTime;
  })[0]!;
}

function identityKeysForPerson(person: CommissionPersonIdentityRow): string[] {
  const keys: string[] = [];
  if (person.nomusPersonId != null && person.nomusPersonId > 0) {
    keys.push(buildCommissionPersonNomusKey(person.type, person.nomusPersonId));
  }
  const nameKey = buildCommissionPersonNameKey(person.type, person.name);
  if (nameKey) keys.push(nameKey);
  return keys;
}

/** Agrupa pessoas que compartilham nomusPersonId ou nome normalizado equivalente. */
export function groupCommissionPersonsByIdentity<T extends CommissionPersonIdentityRow>(
  persons: T[]
): T[][] {
  const keyToIds = new Map<string, Set<string>>();
  const idToPerson = new Map<string, T>();

  for (const person of persons) {
    idToPerson.set(person.id, person);
    for (const key of identityKeysForPerson(person)) {
      const set = keyToIds.get(key) ?? new Set<string>();
      set.add(person.id);
      keyToIds.set(key, set);
    }
  }

  const parent = new Map<string, string>();
  function find(id: string): string {
    const p = parent.get(id);
    if (!p || p === id) return id;
    const root = find(p);
    parent.set(id, root);
    return root;
  }
  function union(a: string, b: string) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  }

  for (const person of persons) {
    parent.set(person.id, person.id);
  }

  for (const ids of keyToIds.values()) {
    const list = [...ids];
    for (let i = 1; i < list.length; i += 1) {
      union(list[0]!, list[i]!);
    }
  }

  const groups = new Map<string, T[]>();
  for (const person of persons) {
    const root = find(person.id);
    const bucket = groups.get(root) ?? [];
    bucket.push(person);
    groups.set(root, bucket);
  }

  return [...groups.values()].filter((g) => g.length > 0);
}

export function buildMergedPersonNotes(canonicalId: string, duplicateIds: string[]): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return `[mesclado em ${stamp}] Consolidado em ${canonicalId}. Duplicatas: ${duplicateIds.join(", ")}.`;
}
