/**
 * Scanner + apply de backfill Person.
 * Apply só vincula (update personId). Não apaga nem funde registros.
 */

import type { PrismaClient } from "@prisma/client";
import { classifyCustomerDocument } from "@/src/lib/canonicalPerson.js";
import {
  buildPersonIndexes,
  classifyOrphanAgainstPersons,
  filterApplyCandidates,
  summarizeCandidates,
  type BackfillCandidate,
  type BackfillEntityKind,
  type OrphanEntityRow,
  type PersonIndexRow,
} from "@/src/lib/canonicalPersonBackfill.js";

export type BackfillScanOptions = {
  limitPerKind?: number;
  kinds?: BackfillEntityKind[];
};

export type BackfillScanReport = {
  generatedAt: string;
  mode: "dry-run";
  summary: ReturnType<typeof summarizeCandidates>;
  candidates: BackfillCandidate[];
  note: string;
};

export type BackfillApplyResult = {
  generatedAt: string;
  mode: "apply";
  attempted: number;
  linked: number;
  skippedAlreadyLinked: number;
  failed: Array<{ entityKind: string; entityId: string; error: string }>;
  linkedIds: Array<{ entityKind: string; entityId: string; personId: string }>;
};

const DEFAULT_LIMIT = 2000;
const ALL_KINDS: BackfillEntityKind[] = [
  "employee",
  "app_user",
  "commission_person",
  "fleet_driver",
  "customer_identity",
  "customer_contact",
];

async function loadPersonIndexRaw(prisma: PrismaClient) {
  return prisma.person.findMany({
    select: {
      id: true,
      displayName: true,
      corporateEmail: true,
      personalEmail: true,
      cpfNormalized: true,
      phoneNormalized: true,
      employees: { select: { id: true } },
      appUsers: { select: { id: true } },
      commissionPeople: { select: { id: true, nomusPersonId: true } },
    },
  });
}

/** Indexa nomusPersonId já ligado a Person (via CommissionPerson). */
function attachOfficialHints(
  indexes: ReturnType<typeof buildPersonIndexes>,
  peopleRaw: Awaited<ReturnType<typeof loadPersonIndexRaw>>,
  personById: Map<string, PersonIndexRow>
): void {
  for (const p of peopleRaw) {
    const row = personById.get(p.id);
    if (!row) continue;
    for (const cp of p.commissionPeople) {
      if (cp.nomusPersonId == null) continue;
      const key = `nomus:${cp.nomusPersonId}`;
      const list = indexes.byOfficialHint.get(key) ?? [];
      if (!list.some((x) => x.id === row.id)) list.push(row);
      indexes.byOfficialHint.set(key, list);
    }
  }
}

async function loadOrphans(
  prisma: PrismaClient,
  kinds: BackfillEntityKind[],
  limit: number
): Promise<OrphanEntityRow[]> {
  const out: OrphanEntityRow[] = [];

  if (kinds.includes("employee")) {
    const rows = await prisma.employee.findMany({
      where: { personId: null },
      select: {
        id: true,
        name: true,
        socialName: true,
        corporateEmail: true,
        personalEmail: true,
        cpf: true,
        phone: true,
      },
      take: limit,
      orderBy: { createdAt: "asc" },
    });
    for (const e of rows) {
      out.push({
        kind: "employee",
        id: e.id,
        label: e.socialName?.trim() || e.name,
        emails: [e.corporateEmail, e.personalEmail],
        cpf: e.cpf,
        phone: e.phone,
        officialId: null,
        name: e.name,
      });
    }
  }

  if (kinds.includes("app_user")) {
    const rows = await prisma.appUser.findMany({
      where: { personId: null },
      select: { id: true, name: true, email: true },
      take: limit,
      orderBy: { createdAt: "asc" },
    });
    for (const u of rows) {
      out.push({
        kind: "app_user",
        id: u.id,
        label: u.name || u.email,
        emails: [u.email],
        cpf: null,
        phone: null,
        officialId: null,
        name: u.name,
      });
    }
  }

  if (kinds.includes("commission_person")) {
    const rows = await prisma.commissionPerson.findMany({
      where: { personId: null },
      select: {
        id: true,
        name: true,
        email: true,
        document: true,
        nomusPersonId: true,
      },
      take: limit,
      orderBy: { createdAt: "asc" },
    });
    for (const c of rows) {
      out.push({
        kind: "commission_person",
        id: c.id,
        label: c.name,
        emails: [c.email],
        cpf: c.document,
        phone: null,
        officialId: c.nomusPersonId != null ? `nomus:${c.nomusPersonId}` : null,
        name: c.name,
      });
    }
  }

  if (kinds.includes("fleet_driver")) {
    const rows = await prisma.fleetDriver.findMany({
      where: { personId: null },
      select: { id: true, name: true, email: true, cpf: true, phone: true },
      take: limit,
      orderBy: { createdAt: "asc" },
    });
    for (const d of rows) {
      out.push({
        kind: "fleet_driver",
        id: d.id,
        label: d.name,
        emails: [d.email],
        cpf: d.cpf,
        phone: d.phone,
        officialId: null,
        name: d.name,
      });
    }
  }

  if (kinds.includes("customer_identity") || kinds.includes("customer_contact")) {
    const orFilter: Array<{ personId?: null; contactPersonId?: null }> = [];
    if (kinds.includes("customer_identity")) orFilter.push({ personId: null });
    if (kinds.includes("customer_contact")) orFilter.push({ contactPersonId: null });
    const rows = await prisma.customer.findMany({
      where: { OR: orFilter },
      select: {
        id: true,
        companyName: true,
        contactName: true,
        taxId: true,
        email: true,
        phone: true,
        personId: true,
        contactPersonId: true,
      },
      take: limit * 2,
      orderBy: { createdAt: "asc" },
    });
    for (const c of rows) {
      const kindDoc = classifyCustomerDocument(c.taxId);
      if (
        kinds.includes("customer_identity") &&
        !c.personId &&
        kindDoc === "PF"
      ) {
        out.push({
          kind: "customer_identity",
          id: c.id,
          label: c.companyName,
          emails: [c.email],
          cpf: c.taxId,
          phone: c.phone,
          officialId: null,
          name: c.companyName,
        });
      }
      if (kinds.includes("customer_contact") && !c.contactPersonId) {
        out.push({
          kind: "customer_contact",
          id: c.id,
          label: c.contactName || c.companyName,
          emails: [c.email],
          cpf: null,
          phone: c.phone,
          officialId: null,
          name: c.contactName,
        });
      }
    }
  }

  return out;
}

export async function scanCanonicalPersonBackfill(
  prisma: PrismaClient,
  opts: BackfillScanOptions = {}
): Promise<BackfillScanReport> {
  const limit = Math.min(Math.max(opts.limitPerKind ?? DEFAULT_LIMIT, 1), 5000);
  const kinds = opts.kinds?.length ? opts.kinds : ALL_KINDS;

  const rawPeople = await loadPersonIndexRaw(prisma);
  const personRows: PersonIndexRow[] = rawPeople.map((p) => ({
    id: p.id,
    displayName: p.displayName,
    corporateEmail: p.corporateEmail,
    personalEmail: p.personalEmail,
    cpfNormalized: p.cpfNormalized,
    phoneNormalized: p.phoneNormalized,
    linkedEmployeeIds: p.employees.map((e) => e.id),
    linkedAppUserIds: p.appUsers.map((u) => u.id),
  }));
  const personById = new Map(personRows.map((p) => [p.id, p]));
  const indexes = buildPersonIndexes(personRows);
  attachOfficialHints(indexes, rawPeople, personById);

  const orphans = await loadOrphans(prisma, kinds, limit);
  const candidates = orphans.map((o) => classifyOrphanAgainstPersons(o, indexes));

  return {
    generatedAt: new Date().toISOString(),
    mode: "dry-run",
    summary: summarizeCandidates(candidates),
    candidates,
    note:
      "Dry-run. Apply só vincula unequivocal+autoLinkSafe a Person existente. Nome/telefone não auto-link. Contatos de cliente não aplicam.",
  };
}

async function linkOne(
  prisma: PrismaClient,
  c: BackfillCandidate
): Promise<"linked" | "skipped"> {
  const personId = c.targetPersonId!;
  switch (c.entityKind) {
    case "employee": {
      const cur = await prisma.employee.findUnique({
        where: { id: c.entityId },
        select: { personId: true },
      });
      if (!cur) throw new Error("Employee não encontrado.");
      if (cur.personId === personId) return "skipped";
      if (cur.personId) throw new Error("Já possui personId diferente.");
      await prisma.employee.update({
        where: { id: c.entityId },
        data: { personId },
      });
      return "linked";
    }
    case "app_user": {
      const cur = await prisma.appUser.findUnique({
        where: { id: c.entityId },
        select: { personId: true },
      });
      if (!cur) throw new Error("AppUser não encontrado.");
      if (cur.personId === personId) return "skipped";
      if (cur.personId) throw new Error("Já possui personId diferente.");
      await prisma.appUser.update({
        where: { id: c.entityId },
        data: { personId },
      });
      return "linked";
    }
    case "commission_person": {
      const cur = await prisma.commissionPerson.findUnique({
        where: { id: c.entityId },
        select: { personId: true },
      });
      if (!cur) throw new Error("CommissionPerson não encontrado.");
      if (cur.personId === personId) return "skipped";
      if (cur.personId) throw new Error("Já possui personId diferente.");
      await prisma.commissionPerson.update({
        where: { id: c.entityId },
        data: { personId },
      });
      return "linked";
    }
    case "fleet_driver": {
      const cur = await prisma.fleetDriver.findUnique({
        where: { id: c.entityId },
        select: { personId: true },
      });
      if (!cur) throw new Error("FleetDriver não encontrado.");
      if (cur.personId === personId) return "skipped";
      if (cur.personId) throw new Error("Já possui personId diferente.");
      await prisma.fleetDriver.update({
        where: { id: c.entityId },
        data: { personId },
      });
      return "linked";
    }
    case "customer_identity": {
      const cur = await prisma.customer.findUnique({
        where: { id: c.entityId },
        select: { personId: true },
      });
      if (!cur) throw new Error("Customer não encontrado.");
      if (cur.personId === personId) return "skipped";
      if (cur.personId) throw new Error("Já possui personId diferente.");
      await prisma.customer.update({
        where: { id: c.entityId },
        data: { personId },
      });
      return "linked";
    }
    default:
      throw new Error(`Tipo ${c.entityKind} não elegível para apply.`);
  }
}

/**
 * Aplica apenas candidatos unequivocal. Transação por lote; falha parcial
 * continua no próximo item (não aborta o lote inteiro após erro unitário).
 */
export async function applyCanonicalPersonBackfill(
  prisma: PrismaClient,
  opts: BackfillScanOptions & { batchSize?: number } = {}
): Promise<BackfillApplyResult> {
  const scan = await scanCanonicalPersonBackfill(prisma, opts);
  const todo = filterApplyCandidates(scan.candidates);
  const batchSize = Math.min(Math.max(opts.batchSize ?? 50, 1), 200);

  const result: BackfillApplyResult = {
    generatedAt: new Date().toISOString(),
    mode: "apply",
    attempted: todo.length,
    linked: 0,
    skippedAlreadyLinked: 0,
    failed: [],
    linkedIds: [],
  };

  // Uma transação por item: falha parcial não derruba o lote; idempotente.
  for (let i = 0; i < todo.length; i += batchSize) {
    const chunk = todo.slice(i, i + batchSize);
    for (const c of chunk) {
      try {
        await prisma.$transaction(async (tx) => {
          const status = await linkOne(tx as unknown as PrismaClient, c);
          if (status === "skipped") {
            result.skippedAlreadyLinked += 1;
          } else {
            result.linked += 1;
            result.linkedIds.push({
              entityKind: c.entityKind,
              entityId: c.entityId,
              personId: c.targetPersonId!,
            });
          }
        });
        if (result.linkedIds.some((x) => x.entityId === c.entityId)) {
          console.info(
            JSON.stringify({
              audit: "person.backfill.link",
              entityKind: c.entityKind,
              entityId: c.entityId,
              personId: c.targetPersonId,
              evidence: c.evidence,
              at: new Date().toISOString(),
            })
          );
        }
      } catch (err) {
        result.failed.push({
          entityKind: c.entityKind,
          entityId: c.entityId,
          error: err instanceof Error ? err.message : "erro",
        });
      }
    }
  }

  return result;
}

/** Compat API legada de diagnóstico. */
export async function diagnoseUnequivocalPersonMatchesViaBackfill(
  prisma: PrismaClient
) {
  const report = await scanCanonicalPersonBackfill(prisma, {
    kinds: ["employee", "app_user", "commission_person", "fleet_driver", "customer_identity"],
    limitPerKind: 2000,
  });
  const unequivocal = filterApplyCandidates(report.candidates);
  return {
    scannedEmployees: report.summary.scannedByKind.employee ?? 0,
    scannedUsers: report.summary.scannedByKind.app_user ?? 0,
    unequivocalMatches: unequivocal.map((c) => ({
      kind: `${c.entityKind}→person`,
      leftId: c.entityId,
      rightId: c.targetPersonId,
      evidence: c.evidence[0] === "cpf" ? "cpf" : "email",
      autoLinkSafe: c.autoLinkSafe,
    })),
    summary: report.summary,
    note: report.note,
  };
}
