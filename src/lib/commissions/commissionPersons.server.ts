import {
  Prisma,
  type CommissionPersonSource,
  type CommissionPersonType,
  type CommissionRuleBeneficiaryType,
} from "@prisma/client";
import { prisma } from "@/src/lib/prisma.js";
import {
  extractRepresentativeFromNomusRaw,
  extractSellerFromOrder,
} from "./commission-source-resolver.js";
import type { CommissionPersonWriteInput } from "./commissionApiValidation.js";
import { CommissionValidationError } from "./commissionApiValidation.js";
import type { CommissionPersonsQuery } from "./commissionQuery.js";
import { paginatedMeta } from "./commissionQuery.js";
import { consolidateSellerRowFragments } from "@/src/lib/crmSellerIdentityConsolidation.js";
import { consolidatePersonImportFragments } from "./commissionPersonIdentity.js";
import {
  findExistingCommissionPerson,
  upsertCommissionPersonFromImport,
} from "./commissionPersonResolution.server.js";

export { CommissionValidationError };

type PersonRow = {
  id: string;
  nomusPersonId: number | null;
  name: string;
  type: string;
  source: string;
  email: string | null;
  document: string | null;
  active: boolean;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CommissionPersonListItem = ReturnType<typeof serializePerson> & {
  linkedRulesCount: number;
  hasCommissionInPeriod: boolean;
};

export type CommissionPersonsCards = {
  totalCount: number;
  activeSellersCount: number;
  activeRepresentativesCount: number;
  withoutActiveRuleCount: number;
  withCommissionInPeriodCount: number;
};

export type CommissionPersonsPagePayload = {
  cards: CommissionPersonsCards;
  rows: CommissionPersonListItem[];
  items: CommissionPersonListItem[];
  pagination: ReturnType<typeof paginatedMeta>;
};

export type CommissionPersonsImportResult = {
  ordersScanned: number;
  created: number;
  updated: number;
  skippedNoName: number;
  skippedNoNomusId: number;
  unchanged: number;
};

function serializePerson(row: PersonRow) {
  return {
    id: row.id,
    nomusPersonId: row.nomusPersonId,
    name: row.name,
    type: row.type,
    source: row.source,
    email: row.email,
    document: row.document,
    active: row.active,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function assertUniqueNomusPerson(
  nomusPersonId: number | null | undefined,
  type: CommissionPersonType,
  excludeId?: string
) {
  if (nomusPersonId == null) return;
  const existing = await prisma.commissionPerson.findFirst({
    where: {
      nomusPersonId,
      type,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
  });
  if (existing) {
    throw new CommissionValidationError(
      "DUPLICATE",
      `Já existe uma pessoa do tipo ${type} com ID Nomus ${nomusPersonId}.`
    );
  }
}

function buildPersonWhere(query: CommissionPersonsQuery): Prisma.CommissionPersonWhereInput {
  const and: Prisma.CommissionPersonWhereInput[] = [];
  if (query.active != null) and.push({ active: query.active });
  if (query.type) and.push({ type: query.type as CommissionPersonType });
  if (query.source) and.push({ source: query.source as CommissionPersonSource });
  if (query.search) {
    const search = query.search.trim();
    const or: Prisma.CommissionPersonWhereInput[] = [
      { name: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
      { document: { contains: search, mode: "insensitive" } },
    ];
    const asInt = Number.parseInt(search, 10);
    if (Number.isFinite(asInt) && Number.isInteger(asInt)) {
      or.push({ nomusPersonId: asInt });
    }
    and.push({ OR: or });
  }
  if (and.length === 0) return {};
  if (and.length === 1) return and[0]!;
  return { AND: and };
}

function resolveRecordPeriod(query: CommissionPersonsQuery): { from: Date; to: Date } {
  if (query.from && query.to) {
    return { from: query.from, to: query.to };
  }
  if (query.year != null && query.month != null) {
    return {
      from: new Date(Date.UTC(query.year, query.month - 1, 1)),
      to: new Date(Date.UTC(query.year, query.month, 0, 23, 59, 59, 999)),
    };
  }
  if (query.year != null) {
    return {
      from: new Date(Date.UTC(query.year, 0, 1)),
      to: new Date(Date.UTC(query.year, 11, 31, 23, 59, 59, 999)),
    };
  }
  const year = new Date().getUTCFullYear();
  return {
    from: new Date(Date.UTC(year, 0, 1)),
    to: new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999)),
  };
}

function beneficiaryMatchesPerson(
  beneficiaryType: CommissionRuleBeneficiaryType,
  personType: CommissionPersonType,
  fixedCommissionPersonId: string | null,
  personId: string
): boolean {
  if (fixedCommissionPersonId === personId) return true;
  if (beneficiaryType === "SELLER" && personType === "SELLER") return true;
  if (beneficiaryType === "REPRESENTATIVE" && personType === "REPRESENTATIVE") return true;
  return false;
}

function personHasActiveRule(
  person: { id: string; type: CommissionPersonType },
  activeRules: Array<{
    beneficiaryType: CommissionRuleBeneficiaryType;
    fixedCommissionPersonId: string | null;
  }>
): boolean {
  return activeRules.some((rule) =>
    beneficiaryMatchesPerson(rule.beneficiaryType, person.type, rule.fixedCommissionPersonId, person.id)
  );
}

function countLinkedRules(
  person: { id: string; type: CommissionPersonType },
  activeRules: Array<{
    id: string;
    beneficiaryType: CommissionRuleBeneficiaryType;
    fixedCommissionPersonId: string | null;
  }>
): number {
  return activeRules.filter((rule) =>
    beneficiaryMatchesPerson(rule.beneficiaryType, person.type, rule.fixedCommissionPersonId, person.id)
  ).length;
}

export async function listCommissionPersonsPage(
  query: CommissionPersonsQuery
): Promise<CommissionPersonsPagePayload> {
  const where = buildPersonWhere(query);
  const period = resolveRecordPeriod(query);

  const [allForCards, total, pageRows, activeRules, commissionPersonIdsInPeriod] =
    await Promise.all([
      prisma.commissionPerson.findMany({
        where,
        select: { id: true, type: true, active: true },
      }),
      prisma.commissionPerson.count({ where }),
      prisma.commissionPerson.findMany({
        where,
        orderBy: [{ active: "desc" }, { name: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.commissionRule.findMany({
        where: { active: true },
        select: { id: true, beneficiaryType: true, fixedCommissionPersonId: true },
      }),
      prisma.commissionRecord.findMany({
        where: {
          calculatedAt: { gte: period.from, lte: period.to },
        },
        select: { commissionPersonId: true },
        distinct: ["commissionPersonId"],
      }),
    ]);

  const commissionInPeriodSet = new Set(
    commissionPersonIdsInPeriod.map((r) => r.commissionPersonId)
  );

  const cards: CommissionPersonsCards = {
    totalCount: allForCards.length,
    activeSellersCount: allForCards.filter((p) => p.active && p.type === "SELLER").length,
    activeRepresentativesCount: allForCards.filter(
      (p) => p.active && p.type === "REPRESENTATIVE"
    ).length,
    withoutActiveRuleCount: allForCards.filter(
      (p) => p.active && !personHasActiveRule(p, activeRules)
    ).length,
    withCommissionInPeriodCount: allForCards.filter((p) =>
      commissionInPeriodSet.has(p.id)
    ).length,
  };

  const rows: CommissionPersonListItem[] = pageRows.map((row) => ({
    ...serializePerson(row),
    linkedRulesCount: countLinkedRules(row, activeRules),
    hasCommissionInPeriod: commissionInPeriodSet.has(row.id),
  }));

  return {
    cards,
    rows,
    items: rows,
    pagination: paginatedMeta(total, query.page, query.pageSize),
  };
}

/** Compatível com dropdowns que consomem apenas items + pagination. */
export async function listCommissionPersons(query: CommissionPersonsQuery) {
  const payload = await listCommissionPersonsPage(query);
  return { items: payload.items, pagination: payload.pagination };
}

export async function createCommissionPerson(input: CommissionPersonWriteInput) {
  await assertUniqueNomusPerson(input.nomusPersonId, input.type);
  const equivalent = await findExistingCommissionPerson(prisma, {
    type: input.type,
    nomusPersonId: input.nomusPersonId,
    name: input.name,
  });
  if (equivalent) {
    throw new CommissionValidationError(
      "DUPLICATE",
      `Já existe uma pessoa equivalente (${equivalent.name}). Use o registro existente ou edite-o.`
    );
  }
  const row = await prisma.commissionPerson.create({
    data: {
      name: input.name,
      type: input.type,
      source: input.source ?? "MANUAL",
      nomusPersonId: input.nomusPersonId ?? null,
      email: input.email ?? null,
      document: input.document ?? null,
      notes: input.notes ?? null,
      active: input.active ?? true,
    },
  });
  return serializePerson(row);
}

export async function updateCommissionPerson(
  id: string,
  input: Partial<CommissionPersonWriteInput>
) {
  const existing = await prisma.commissionPerson.findUnique({ where: { id } });
  if (!existing) {
    throw new CommissionValidationError("NOT_FOUND", "Pessoa comissionada não encontrada.");
  }
  const nextType = input.type ?? existing.type;
  const nextNomusId =
    input.nomusPersonId !== undefined ? input.nomusPersonId : existing.nomusPersonId;
  await assertUniqueNomusPerson(nextNomusId, nextType, id);

  const row = await prisma.commissionPerson.update({
    where: { id },
    data: {
      name: input.name,
      type: input.type,
      source: input.source,
      nomusPersonId: input.nomusPersonId,
      email: input.email,
      document: input.document,
      notes: input.notes,
      active: input.active,
    },
  });
  return serializePerson(row);
}

export async function toggleCommissionPersonActive(id: string) {
  const existing = await prisma.commissionPerson.findUnique({ where: { id } });
  if (!existing) {
    throw new CommissionValidationError("NOT_FOUND", "Pessoa comissionada não encontrada.");
  }
  const row = await prisma.commissionPerson.update({
    where: { id },
    data: { active: !existing.active },
  });
  return serializePerson(row);
}

type ImportCandidate = {
  type: CommissionPersonType;
  nomusPersonId: number | null;
  name: string;
  aliasNomusPersonIds: number[];
};

function collectCandidatesFromOrders(
  orders: Array<{
    externalSellerId: number | null;
    nomusSellerName: string | null;
    nomusRawResponse: unknown;
  }>
): { candidates: Map<string, ImportCandidate>; skippedNoName: number; skippedNoNomusId: number } {
  const candidates = new Map<string, ImportCandidate>();
  let skippedNoName = 0;
  let skippedNoNomusId = 0;

  const sellerRows: Array<{
    external_seller_id: number | null;
    responsible: string | null;
    orders_count: number;
  }> = [];

  const repFragments: Array<{
    type: CommissionPersonType;
    nomusPersonId: number | null;
    name: string;
  }> = [];

  for (const order of orders) {
    const seller = extractSellerFromOrder({
      externalSellerId: order.externalSellerId,
      nomusSellerName: order.nomusSellerName,
    });
    if (seller.nomusSellerId != null || seller.responsibleName) {
      sellerRows.push({
        external_seller_id: seller.nomusSellerId,
        responsible: seller.responsibleName,
        orders_count: 1,
      });
    }

    const rep = extractRepresentativeFromNomusRaw(order.nomusRawResponse);
    if (rep.nomusRepresentativeId != null && rep.nomusRepresentativeId > 0) {
      if (rep.name) {
        repFragments.push({
          type: "REPRESENTATIVE",
          nomusPersonId: rep.nomusRepresentativeId,
          name: rep.name,
        });
      } else {
        skippedNoName += 1;
      }
    } else if (order.nomusRawResponse != null) {
      const raw = order.nomusRawResponse;
      if (typeof raw === "object" && raw !== null) {
        const obj = raw as Record<string, unknown>;
        const hasRepHint =
          obj.idPessoaRepresentante != null ||
          obj.idRepresentante != null ||
          obj.representante != null;
        if (hasRepHint) skippedNoNomusId += 1;
      }
    }
  }

  for (const consolidated of consolidateSellerRowFragments(sellerRows)) {
    if (!consolidated.displayName) {
      skippedNoName += 1;
      continue;
    }
    const ids = consolidated.externalSellerIds;
    const primaryId = ids[0] ?? null;
    if (primaryId == null) {
      skippedNoNomusId += 1;
      continue;
    }
    candidates.set(`SELLER:${consolidated.sellerIdentityKey}`, {
      type: "SELLER",
      nomusPersonId: primaryId,
      name: consolidated.displayName,
      aliasNomusPersonIds: ids.slice(1),
    });
  }

  for (const rep of consolidatePersonImportFragments(repFragments)) {
    if (!rep.name) {
      skippedNoName += 1;
      continue;
    }
    if (rep.nomusPersonId == null) {
      skippedNoNomusId += 1;
      continue;
    }
    const key = `REPRESENTATIVE:${rep.nomusPersonId}:${rep.name}`;
    candidates.set(key, {
      type: "REPRESENTATIVE",
      nomusPersonId: rep.nomusPersonId,
      name: rep.name,
      aliasNomusPersonIds: rep.aliasNomusPersonIds,
    });
  }

  return { candidates, skippedNoName, skippedNoNomusId };
}

async function applyImportCandidates(
  candidates: Map<string, ImportCandidate>,
  ordersScanned: number
): Promise<CommissionPersonsImportResult> {
  let created = 0;
  let updated = 0;
  let unchanged = 0;

  for (const candidate of candidates.values()) {
    const result = await upsertCommissionPersonFromImport(prisma, {
      type: candidate.type,
      nomusPersonId: candidate.nomusPersonId,
      name: candidate.name,
      aliasNomusPersonIds: candidate.aliasNomusPersonIds,
      source: "NOMUS",
    });

    if (result.action === "created") created += 1;
    else if (result.action === "updated" || result.action === "reactivated") updated += 1;
    else unchanged += 1;
  }

  return {
    ordersScanned,
    created,
    updated,
    skippedNoName: 0,
    skippedNoNomusId: 0,
    unchanged,
  };
}

function buildPersonImportOrderWhere(period?: {
  from: Date;
  to: Date;
}): Prisma.SalesOrderWhereInput {
  const sellerOrRep: Prisma.SalesOrderWhereInput = {
    OR: [{ externalSellerId: { not: null } }, { nomusRawResponse: { not: Prisma.DbNull } }],
  };
  if (!period) return sellerOrRep;
  return {
    AND: [sellerOrRep, { issueDate: { gte: period.from, lte: period.to } }],
  };
}

async function loadOrdersForPersonImport(period?: { from: Date; to: Date }) {
  return prisma.salesOrder.findMany({
    where: buildPersonImportOrderWhere(period),
    select: {
      externalSellerId: true,
      nomusSellerName: true,
      responsible: true,
      nomusRawResponse: true,
    },
  });
}

export type CommissionPersonCandidatePreview = {
  type: CommissionPersonType;
  nomusPersonId: number;
  name: string;
  exists: boolean;
  existingId: string | null;
  wouldCreate: boolean;
  wouldUpdate: boolean;
};

export type CommissionPersonsPeriodPreview = CommissionPersonsImportResult & {
  candidates: CommissionPersonCandidatePreview[];
};

async function buildPersonPeriodPreview(
  orders: Awaited<ReturnType<typeof loadOrdersForPersonImport>>
): Promise<CommissionPersonsPeriodPreview> {
  const { candidates, skippedNoName, skippedNoNomusId } = collectCandidatesFromOrders(orders);

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  const candidateRows: CommissionPersonCandidatePreview[] = [];

  for (const candidate of candidates.values()) {
    const existing = await findExistingCommissionPerson(prisma, {
      type: candidate.type,
      nomusPersonId: candidate.nomusPersonId,
      name: candidate.name,
      aliasNomusPersonIds: candidate.aliasNomusPersonIds,
    });

    let wouldCreate = false;
    let wouldUpdate = false;
    if (!existing) {
      created += 1;
      wouldCreate = true;
    } else if (
      existing.source === "NOMUS" &&
      candidate.name &&
      existing.name !== candidate.name
    ) {
      updated += 1;
      wouldUpdate = true;
    } else if (!existing.active) {
      updated += 1;
      wouldUpdate = true;
    } else {
      unchanged += 1;
    }

    candidateRows.push({
      type: candidate.type,
      nomusPersonId: candidate.nomusPersonId ?? 0,
      name: candidate.name,
      exists: Boolean(existing),
      existingId: existing?.id ?? null,
      wouldCreate,
      wouldUpdate,
    });
  }

  return {
    ordersScanned: orders.length,
    created,
    updated,
    skippedNoName,
    skippedNoNomusId,
    unchanged,
    candidates: candidateRows.sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
  };
}

export async function previewCommissionPersonsForPeriod(period: {
  from: Date;
  to: Date;
}): Promise<CommissionPersonsPeriodPreview> {
  const orders = await loadOrdersForPersonImport(period);
  return buildPersonPeriodPreview(orders);
}

export async function previewCommissionPersonsFromOrders(): Promise<CommissionPersonsImportResult> {
  const orders = await loadOrdersForPersonImport();
  const preview = await buildPersonPeriodPreview(orders);
  const { candidates: _c, ...result } = preview;
  return result;
}

export async function importCommissionPersonsForPeriod(period: {
  from: Date;
  to: Date;
}): Promise<CommissionPersonsImportResult> {
  const orders = await loadOrdersForPersonImport(period);
  const { candidates, skippedNoName, skippedNoNomusId } = collectCandidatesFromOrders(orders);
  const result = await applyImportCandidates(candidates, orders.length);
  return { ...result, skippedNoName, skippedNoNomusId };
}

export async function importCommissionPersonsFromOrders(): Promise<CommissionPersonsImportResult> {
  const orders = await loadOrdersForPersonImport();
  const { candidates, skippedNoName, skippedNoNomusId } = collectCandidatesFromOrders(orders);
  const result = await applyImportCandidates(candidates, orders.length);
  return { ...result, skippedNoName, skippedNoNomusId };
}
