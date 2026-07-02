import type { CommissionPersonSource, CommissionPersonType, Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import {
  buildMergedPersonNotes,
  groupCommissionPersonsByIdentity,
  normalizeCommissionPersonName,
  pickCanonicalCommissionPerson,
  type CommissionPersonIdentityRow,
} from "./commissionPersonIdentity.js";

type DbClient = Pick<PrismaClient, "commissionPerson">;

export type CommissionPersonLookupInput = {
  type: CommissionPersonType;
  nomusPersonId?: number | null;
  name: string;
  aliasNomusPersonIds?: number[];
};

export type CommissionPersonUpsertInput = CommissionPersonLookupInput & {
  source?: CommissionPersonSource;
};

export type CommissionPersonUpsertResult = {
  personId: string;
  action: "created" | "updated" | "unchanged" | "reactivated";
};

async function loadPersonsForNameMatch(
  db: DbClient,
  type: CommissionPersonType,
  normalizedName: string
) {
  const rows = await db.commissionPerson.findMany({ where: { type } });
  return rows.filter((row) => normalizeCommissionPersonName(row.name) === normalizedName);
}

export async function findExistingCommissionPerson(
  db: DbClient,
  input: CommissionPersonLookupInput
): Promise<Awaited<ReturnType<DbClient["commissionPerson"]["findFirst"]>> | null> {
  const aliasIds = input.aliasNomusPersonIds ?? [];
  const nomusIds = [
    ...new Set(
      [input.nomusPersonId, ...aliasIds].filter(
        (id): id is number => id != null && Number.isInteger(id) && id > 0
      )
    ),
  ];

  for (const nomusPersonId of nomusIds) {
    const byNomus = await db.commissionPerson.findFirst({
      where: { type: input.type, nomusPersonId },
    });
    if (byNomus) return byNomus;
  }

  const normalized = normalizeCommissionPersonName(input.name);
  if (!normalized) return null;

  const byName = await loadPersonsForNameMatch(db, input.type, normalized);
  if (byName.length === 0) return null;

  return pickCanonicalCommissionPerson(byName);
}

export async function reassignCommissionPersonForeignKeys(
  tx: Prisma.TransactionClient,
  fromPersonId: string,
  toPersonId: string
): Promise<{ records: number; batches: number; rules: number }> {
  const records = await tx.commissionRecord.updateMany({
    where: { commissionPersonId: fromPersonId },
    data: { commissionPersonId: toPersonId },
  });
  const batches = await tx.commissionPaymentBatch.updateMany({
    where: { commissionPersonId: fromPersonId },
    data: { commissionPersonId: toPersonId },
  });
  const rules = await tx.commissionRule.updateMany({
    where: { fixedCommissionPersonId: fromPersonId },
    data: { fixedCommissionPersonId: toPersonId },
  });
  return {
    records: records.count,
    batches: batches.count,
    rules: rules.count,
  };
}

export async function mergeCommissionPersonIntoCanonical(
  tx: Prisma.TransactionClient,
  duplicateId: string,
  canonicalId: string
): Promise<{ records: number; batches: number; rules: number }> {
  if (duplicateId === canonicalId) {
    return { records: 0, batches: 0, rules: 0 };
  }
  return reassignCommissionPersonForeignKeys(tx, duplicateId, canonicalId);
}

export async function upsertCommissionPersonFromImport(
  db: DbClient,
  input: CommissionPersonUpsertInput
): Promise<CommissionPersonUpsertResult> {
  const source: CommissionPersonSource = input.source ?? "NOMUS";
  const existing = await findExistingCommissionPerson(db, input);

  if (existing) {
    const updates: Prisma.CommissionPersonUpdateInput = {};
    let changed = false;

    if (!existing.active) {
      updates.active = true;
      changed = true;
    }

    if (
      input.nomusPersonId != null &&
      input.nomusPersonId > 0 &&
      existing.nomusPersonId == null
    ) {
      updates.nomusPersonId = input.nomusPersonId;
      updates.source = "NOMUS";
      changed = true;
    }

    if (input.name.trim() && existing.name !== input.name.trim()) {
      if (existing.source === "NOMUS" || source === "NOMUS") {
        updates.name = input.name.trim();
        changed = true;
      }
    }

    if (Object.keys(updates).length > 0) {
      const row = await db.commissionPerson.update({
        where: { id: existing.id },
        data: updates,
      });
      return {
        personId: row.id,
        action: !existing.active ? "reactivated" : "updated",
      };
    }

    return { personId: existing.id, action: "unchanged" };
  }

  if (input.nomusPersonId == null || input.nomusPersonId <= 0) {
    throw new Error("Não é possível criar pessoa comissionada Nomus sem nomusPersonId.");
  }

  const created = await db.commissionPerson.create({
    data: {
      name: input.name.trim(),
      type: input.type,
      nomusPersonId: input.nomusPersonId,
      source,
      active: true,
    },
  });
  return { personId: created.id, action: "created" };
}

export async function resolveOrUpsertCommissionPerson(
  db: DbClient,
  input: {
    beneficiaryType: "SELLER" | "REPRESENTATIVE" | "FIXED_PERSON";
    fixedPersonId?: string | null;
    nomusPersonId?: number | null;
    name: string;
  }
): Promise<string | null> {
  if (input.beneficiaryType === "FIXED_PERSON" && input.fixedPersonId) {
    const existing = await db.commissionPerson.findFirst({
      where: { id: input.fixedPersonId },
      select: { id: true, active: true },
    });
    if (!existing) return null;
    if (!existing.active) {
      await db.commissionPerson.update({
        where: { id: existing.id },
        data: { active: true },
      });
    }
    return existing.id;
  }

  const personType: CommissionPersonType =
    input.beneficiaryType === "REPRESENTATIVE"
      ? "REPRESENTATIVE"
      : input.beneficiaryType === "SELLER"
        ? "SELLER"
        : "OTHER";

  const existing = await findExistingCommissionPerson(db, {
    type: personType,
    nomusPersonId: input.nomusPersonId,
    name: input.name,
  });

  if (existing) {
    if (!existing.active) {
      await db.commissionPerson.update({
        where: { id: existing.id },
        data: { active: true },
      });
    }
    return existing.id;
  }

  const created = await db.commissionPerson.create({
    data: {
      name: input.name.trim() || "Comissionado",
      type: personType,
      source: input.nomusPersonId != null && input.nomusPersonId > 0 ? "NOMUS" : "MANUAL",
      nomusPersonId:
        input.nomusPersonId != null && input.nomusPersonId > 0 ? input.nomusPersonId : null,
      active: true,
    },
    select: { id: true },
  });
  return created.id;
}

export type CommissionPersonDedupeGroup = {
  canonical: CommissionPersonIdentityRow & { id: string };
  duplicates: Array<CommissionPersonIdentityRow & { id: string }>;
  fkCounts: Array<{ duplicateId: string; records: number; batches: number; rules: number }>;
};

export async function previewCommissionPersonDedupe(
  db: Pick<PrismaClient, "commissionPerson" | "commissionRecord" | "commissionPaymentBatch" | "commissionRule">
): Promise<{
  totalBefore: number;
  groups: CommissionPersonDedupeGroup[];
  totalAfter: number;
}> {
  const persons = await db.commissionPerson.findMany({
    orderBy: [{ type: "asc" }, { name: "asc" }],
  });

  const recordCounts = await db.commissionRecord.groupBy({
    by: ["commissionPersonId"],
    _count: { _all: true },
  });
  const recordCountMap = new Map(
    recordCounts.map((row) => [row.commissionPersonId, row._count._all])
  );

  const enriched = persons.map((p) => ({
    ...p,
    linkedRecordCount: recordCountMap.get(p.id) ?? 0,
  }));

  const grouped = groupCommissionPersonsByIdentity(enriched).filter((g) => g.length > 1);
  const groups: CommissionPersonDedupeGroup[] = [];

  for (const group of grouped) {
    const canonical = pickCanonicalCommissionPerson(group)!;
    const duplicates = group.filter((p) => p.id !== canonical.id);
    const fkCounts: CommissionPersonDedupeGroup["fkCounts"] = [];

    for (const dup of duplicates) {
      const [records, batches, rules] = await Promise.all([
        db.commissionRecord.count({ where: { commissionPersonId: dup.id } }),
        db.commissionPaymentBatch.count({ where: { commissionPersonId: dup.id } }),
        db.commissionRule.count({ where: { fixedCommissionPersonId: dup.id } }),
      ]);
      fkCounts.push({ duplicateId: dup.id, records, batches, rules });
    }

    groups.push({ canonical, duplicates, fkCounts });
  }

  const mergedCount = groups.reduce((sum, g) => sum + g.duplicates.length, 0);
  return {
    totalBefore: persons.length,
    groups: groups.sort((a, b) => a.canonical.name.localeCompare(b.canonical.name, "pt-BR")),
    totalAfter: persons.length - mergedCount,
  };
}

export async function applyCommissionPersonDedupe(
  db: PrismaClient
): Promise<{
  totalBefore: number;
  totalAfter: number;
  merged: number;
  fkReassigned: { records: number; batches: number; rules: number };
}> {
  const preview = await previewCommissionPersonDedupe(db);
  let merged = 0;
  let records = 0;
  let batches = 0;
  let rules = 0;

  for (const group of preview.groups) {
    await db.$transaction(async (tx) => {
      for (const dup of group.duplicates) {
        const moved = await mergeCommissionPersonIntoCanonical(tx, dup.id, group.canonical.id);
        records += moved.records;
        batches += moved.batches;
        rules += moved.rules;

        await tx.commissionPerson.update({
          where: { id: dup.id },
          data: {
            active: false,
            notes: buildMergedPersonNotes(
              group.canonical.id,
              group.duplicates.map((d) => d.id)
            ),
          },
        });
        merged += 1;
      }

      const canonicalUpdates: Prisma.CommissionPersonUpdateInput = { active: true };
      if (
        group.canonical.nomusPersonId == null &&
        group.duplicates.some((d) => d.nomusPersonId != null)
      ) {
        const nomusId = group.duplicates.find((d) => d.nomusPersonId != null)?.nomusPersonId;
        if (nomusId != null) {
          canonicalUpdates.nomusPersonId = nomusId;
          canonicalUpdates.source = "NOMUS";
        }
      }
      await tx.commissionPerson.update({
        where: { id: group.canonical.id },
        data: canonicalUpdates,
      });
    });
  }

  return {
    totalBefore: preview.totalBefore,
    totalAfter: preview.totalAfter,
    merged,
    fkReassigned: { records, batches, rules },
  };
}
