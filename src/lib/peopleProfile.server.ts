/**
 * Carregamento da ficha funcional — selects explícitos, sem include:* .
 * Nunca serializa salário sem permissão de valores.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import type { EmployeePermissionBag } from "./employeesPermissions.js";
import { logEmployeeHrAudit } from "./employeeHrAudit.js";
import {
  buildPeopleProfileCapabilities,
  canViewPeopleProfile,
} from "./peopleProfileCapabilities.js";
import { canAccessEmployeeRecord } from "./peopleProfileAccess.js";
import { loadDescendantEmployeeIds } from "./peopleProfileHierarchy.server.js";
import {
  compensationTypeLabel,
  formatElapsedSince,
  formatTenureLabel,
  historyEventLabel,
  pickLastAdjustment,
  pickLastPromotion,
  toIsoDateString,
} from "./peopleProfileKpis.js";
import {
  buildHistoryKeysetWhere,
  decodeHistoryCursor,
  encodeHistoryCursor,
  toHistoryEventDto,
} from "./peopleProfileHistory.js";
import { omitMonetaryFields } from "./peopleProfileSanitize.js";
import {
  HR_EMPLOYEE_STATUS_LABELS,
  PEOPLE_PROFILE_HISTORY_PAGE_SIZE,
  type HrEmployeeStatus,
  type PeopleHistoryEventDto,
  type PeopleProfileCapabilities,
  type PeopleProfileSummaryDto,
} from "./peopleProfileTypes.js";
import { formatContractType } from "./employeeHrUi.js";
import { formatCpfForDisplay, formatPhoneForDisplay, maskCpf, maskPhone } from "./employeePersonalHr.js";
import { PeopleProfileAccessError } from "./peopleProfileErrors.js";
import {
  overlayOfficialPayrollName,
  payrollIdFromHrBenefitCode,
} from "./peopleOfficialPayrollCatalog.js";

export { PeopleProfileAccessError };

const EMPLOYEE_SUMMARY_SELECT = {
  id: true,
  name: true,
  socialName: true,
  status: true,
  department: true,
  departmentId: true,
  costCenter: true,
  costCenterId: true,
  managerId: true,
  managerName: true,
  contractType: true,
  workSchedule: true,
  corporateEmail: true,
  classification: true,
  admissionDate: true,
  terminationDate: true,
  personId: true,
  photoStorageKey: true,
  monthlyHours: true,
  professionalNotes: true,
  updatedAt: true,
  createdAt: true,
  roleId: true,
  Role: { select: { id: true, name: true } },
  financialCostCenter: { select: { id: true, code: true, name: true, status: true } },
  orgDepartment: { select: { id: true, name: true, status: true } },
  manager: { select: { id: true, name: true, socialName: true, status: true } },
  person: { select: { id: true, displayName: true, socialName: true, status: true } },
} as const;

function displayStatus(status: string | null | undefined, terminationDate: Date | null): {
  status: string;
  label: string;
} {
  const raw = (status ?? "ACTIVE").toUpperCase();
  const mapped = raw === "INACTIVE" && terminationDate ? "TERMINATED" : raw;
  const known = mapped as HrEmployeeStatus;
  return {
    status: mapped,
    label: HR_EMPLOYEE_STATUS_LABELS[known] ?? mapped,
  };
}

function costCenterLabel(row: {
  financialCostCenter?: { code: string; name: string } | null;
  costCenter?: string | null;
}): string | null {
  if (row.financialCostCenter) {
    return `${row.financialCostCenter.code} — ${row.financialCostCenter.name}`;
  }
  const label = (row.costCenter ?? "").trim();
  return label || null;
}

function managerDisplay(row: {
  manager?: { name: string; socialName: string | null } | null;
  managerName?: string | null;
}): string | null {
  if (row.manager) return (row.manager.socialName ?? "").trim() || row.manager.name;
  const name = (row.managerName ?? "").trim();
  return name || null;
}

async function resolveActorNames(
  prisma: PrismaClient,
  userIds: Array<string | null | undefined>
): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return new Map();
  const users = await prisma.appUser.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
  });
  return new Map(users.map((u) => [u.id, u.name]));
}

export async function resolveProfileAccess(
  prisma: PrismaClient,
  input: {
    check: EmployeePermissionBag;
    actorEmployeeId: string | null;
    targetEmployeeId: string;
  }
): Promise<{
  capabilities: PeopleProfileCapabilities;
  managerId: string | null;
}> {
  if (!canViewPeopleProfile(input.check) && !input.actorEmployeeId) {
    throw new PeopleProfileAccessError("PROFILE_FORBIDDEN", "Sem permissão para ver a ficha.");
  }

  const target = await prisma.employee.findUnique({
    where: { id: input.targetEmployeeId },
    select: { id: true, managerId: true },
  });
  if (!target) {
    throw new PeopleProfileAccessError("NOT_FOUND", "Colaborador não encontrado.", 404);
  }

  const selfRecord = Boolean(input.actorEmployeeId && input.actorEmployeeId === target.id);
  const capabilities = buildPeopleProfileCapabilities(input.check, { selfRecord });
  let descendantIds: Set<string> | undefined;
  if (capabilities.accessScope === "DESCENDANTS" && input.actorEmployeeId) {
    descendantIds = new Set(await loadDescendantEmployeeIds(prisma, input.actorEmployeeId));
  }

  const allowed = canAccessEmployeeRecord({
    scope: capabilities.accessScope,
    actorEmployeeId: input.actorEmployeeId,
    targetEmployeeId: target.id,
    targetManagerId: target.managerId,
    descendantIds,
  });

  if (!allowed) {
    throw new PeopleProfileAccessError("PROFILE_SCOPE", "Fora do escopo hierárquico.");
  }

  return { capabilities, managerId: target.managerId };
}

/** Filtro de listagem: RH (ALL) não filtra; líder só vê a árvore. */
export async function buildVisibleEmployeeWhere(
  prisma: PrismaClient,
  input: { check: EmployeePermissionBag; actorEmployeeId: string | null }
): Promise<Prisma.EmployeeWhereInput | undefined> {
  const capabilities = buildPeopleProfileCapabilities(input.check, {
    selfRecord: false,
  });
  if (capabilities.accessScope === "ALL") return undefined;
  const actor = input.actorEmployeeId;
  if (!actor) return { id: { in: [] } };
  if (capabilities.accessScope === "SELF") return { id: actor };
  if (capabilities.accessScope === "DIRECT_REPORTS") {
    return { OR: [{ id: actor }, { managerId: actor }] };
  }
  if (capabilities.accessScope === "DESCENDANTS") {
    const ids = await loadDescendantEmployeeIds(prisma, actor);
    return { id: { in: [actor, ...ids] } };
  }
  return { id: { in: [] } };
}

export async function loadPeopleProfileSummary(
  prisma: PrismaClient,
  employeeId: string,
  capabilities: PeopleProfileCapabilities
): Promise<PeopleProfileSummaryDto> {
  const row = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: EMPLOYEE_SUMMARY_SELECT,
  });
  if (!row) {
    throw new PeopleProfileAccessError("NOT_FOUND", "Colaborador não encontrado.", 404);
  }

  const now = new Date();
  const [historyRows, adjustmentRows] = await Promise.all([
    prisma.hrEmployeeHistory.findMany({
      where: { employeeId },
      orderBy: [{ effectiveDate: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      take: 8,
      select: {
        id: true,
        eventType: true,
        effectiveDate: true,
        createdAt: true,
        previousRoleName: true,
        newRoleName: true,
        previousDepartment: true,
        newDepartment: true,
        previousManagerName: true,
        newManagerName: true,
      },
    }),
    prisma.hrCompensationAdjustment.findMany({
      where: { employeeId },
      orderBy: [{ effectiveDate: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      take: 1,
      select: {
        effectiveDate: true,
        percentage: true,
        type: true,
      },
    }),
  ]);

  const lastPromo = pickLastPromotion(
    historyRows.map((h) => ({
      eventType: h.eventType,
      effectiveDate: h.effectiveDate,
      newRoleName: h.newRoleName,
      previousRoleName: h.previousRoleName,
    }))
  );
  const lastAdj = pickLastAdjustment(
    adjustmentRows.map((a) => ({
      effectiveDate: a.effectiveDate,
      percentage: a.percentage != null ? Number(a.percentage) : null,
      type: a.type,
    }))
  );

  const situation = displayStatus(row.status, row.terminationDate);
  const tenureLabel = formatTenureLabel(row.admissionDate, now);
  const lastPromotionDate = lastPromo ? toIsoDateString(lastPromo.effectiveDate) : null;
  const lastAdjustmentDate = lastAdj ? toIsoDateString(lastAdj.effectiveDate) : null;
  const lastAdjustmentPercentage =
    lastAdj?.percentage != null && Number.isFinite(Number(lastAdj.percentage))
      ? Number(lastAdj.percentage)
      : null;

  const recentMovements = historyRows.slice(0, 5).map((h) => {
    const dto = toHistoryEventDto(
      {
        id: h.id,
        eventType: h.eventType,
        effectiveDate: h.effectiveDate,
        createdAt: h.createdAt,
        source: "USER",
        previousRoleName: h.previousRoleName,
        newRoleName: h.newRoleName,
        previousDepartment: h.previousDepartment,
        newDepartment: h.newDepartment,
        previousManagerName: h.previousManagerName,
        newManagerName: h.newManagerName,
      },
      { includeAmounts: false }
    );
    return {
      id: dto.id,
      eventType: dto.eventType,
      eventLabel: dto.eventLabel,
      effectiveDate: dto.effectiveDate,
      summary: dto.summary,
    };
  });

  const identityName = row.person?.displayName?.trim() || row.name;

  const dto: PeopleProfileSummaryDto = {
    identity: {
      employeeId: row.id,
      personId: row.personId,
      registrationId: row.id,
      fullName: identityName,
      socialName: row.socialName ?? row.person?.socialName ?? null,
      photoUrl: row.photoStorageKey ? `/api/employees/${row.id}/photo` : null,
      status: situation.status,
      statusLabel: situation.label,
      roleName: row.Role?.name ?? null,
      department: row.orgDepartment?.name ?? row.department ?? null,
      costCenterLabel: costCenterLabel(row),
      managerName: managerDisplay(row),
      managerId: row.managerId,
      contractType: row.contractType ? formatContractType(row.contractType) : null,
      workSchedule: row.workSchedule ?? (row.monthlyHours ? `${row.monthlyHours} h/mês` : null),
      corporateEmail: row.corporateEmail,
      classification: row.classification,
      updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
      updatedByName: null,
    },
    kpis: {
      admissionDate: toIsoDateString(row.admissionDate),
      tenureLabel,
      lastPromotionDate,
      lastPromotionLabel: lastPromo
        ? [lastPromo.previousRoleName, lastPromo.newRoleName].filter(Boolean).join(" → ") ||
          historyEventLabel("PROMOTION")
        : null,
      timeSinceLastPromotionLabel: formatElapsedSince(lastPromotionDate, now),
      lastAdjustmentDate,
      lastAdjustmentPercentage,
      lastAdjustmentType: lastAdj?.type ?? null,
      lastAdjustmentTypeLabel: compensationTypeLabel(lastAdj?.type ?? null),
      timeSinceLastAdjustmentLabel: formatElapsedSince(lastAdjustmentDate, now),
    },
    overview: {
      situation: situation.status,
      situationLabel: situation.label,
      roleName: row.Role?.name ?? null,
      department: row.orgDepartment?.name ?? row.department ?? null,
      costCenterLabel: costCenterLabel(row),
      managerName: managerDisplay(row),
      contractType: row.contractType ? formatContractType(row.contractType) : null,
      admissionDate: toIsoDateString(row.admissionDate),
      tenureLabel,
      lastPromotionDate,
      timeSinceLastPromotionLabel: formatElapsedSince(lastPromotionDate, now),
      lastAdjustmentDate,
      lastAdjustmentPercentage,
      timeSinceLastAdjustmentLabel: formatElapsedSince(lastAdjustmentDate, now),
      recentMovements,
    },
    capabilities,
  };

  return omitMonetaryFields(dto);
}

export async function loadPeopleProfessional(
  prisma: PrismaClient,
  employeeId: string
) {
  const row = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: {
      ...EMPLOYEE_SUMMARY_SELECT,
      professionalNotes: true,
    },
  });
  if (!row) throw new PeopleProfileAccessError("NOT_FOUND", "Colaborador não encontrado.", 404);
  const situation = displayStatus(row.status, row.terminationDate);
  return {
    employeeId: row.id,
    registrationId: row.id,
    fullName: row.name,
    socialName: row.socialName,
    roleName: row.Role?.name ?? null,
    department: row.orgDepartment?.name ?? row.department ?? null,
    costCenterLabel: costCenterLabel(row),
    managerName: managerDisplay(row),
    managerId: row.managerId,
    contractType: row.contractType ? formatContractType(row.contractType) : null,
    workSchedule: row.workSchedule ?? (row.monthlyHours ? `${row.monthlyHours} h/mês` : null),
    monthlyHours: row.monthlyHours,
    admissionDate: toIsoDateString(row.admissionDate),
    terminationDate: toIsoDateString(row.terminationDate),
    status: situation.status,
    statusLabel: situation.label,
    corporateEmail: row.corporateEmail,
    classification: row.classification,
    professionalNotes: row.professionalNotes,
    personId: row.personId,
  };
}

export async function loadPeoplePersonal(
  prisma: PrismaClient,
  employeeId: string,
  opts: { reveal: boolean }
) {
  const row = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: {
      id: true,
      name: true,
      socialName: true,
      cpf: true,
      rg: true,
      birthDate: true,
      phone: true,
      personalEmail: true,
      address: true,
      maritalStatus: true,
      city: true,
      state: true,
      zipCode: true,
      personId: true,
      person: {
        select: {
          id: true,
          displayName: true,
          socialName: true,
          personalEmail: true,
          cpfNormalized: true,
          phoneNormalized: true,
        },
      },
    },
  });
  if (!row) throw new PeopleProfileAccessError("NOT_FOUND", "Colaborador não encontrado.", 404);

  const cpf = row.cpf || row.person?.cpfNormalized || null;
  const phone = row.phone || row.person?.phoneNormalized || null;
  const personalEmail = row.personalEmail || row.person?.personalEmail || null;

  if (!opts.reveal) {
    return {
      employeeId: row.id,
      personId: row.personId,
      fullName: row.name,
      socialName: row.socialName,
      cpf: cpf ? maskCpf(cpf) : null,
      rg: null,
      birthDate: null,
      phone: phone ? maskPhone(phone) : null,
      personalEmail: personalEmail ? "***" : null,
      address: null,
      maritalStatus: null,
      city: null,
      state: null,
      zipCode: null,
      redacted: true,
    };
  }

  return {
    employeeId: row.id,
    personId: row.personId,
    fullName: row.person?.displayName || row.name,
    socialName: row.socialName ?? row.person?.socialName ?? null,
    cpf: formatCpfForDisplay(cpf),
    rg: row.rg,
    birthDate: toIsoDateString(row.birthDate),
    phone: formatPhoneForDisplay(phone),
    personalEmail,
    address: row.address,
    maritalStatus: row.maritalStatus,
    city: row.city,
    state: row.state,
    zipCode: row.zipCode,
    redacted: false,
  };
}

export async function loadPeopleEmergency(
  prisma: PrismaClient,
  employeeId: string,
  opts: { reveal: boolean }
) {
  const row = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: {
      emergencyContactName: true,
      emergencyContactPhone: true,
      emergencyContactRelationship: true,
    },
  });
  if (!row) throw new PeopleProfileAccessError("NOT_FOUND", "Colaborador não encontrado.", 404);
  const extras = await prisma.hrEmergencyContact.findMany({
    where: { employeeId },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      relationship: true,
      phone: true,
      alternatePhone: true,
      priority: true,
      notes: true,
    },
  });

  if (!opts.reveal) {
    return {
      redacted: true,
      contacts: [] as typeof extras,
      hasContacts: Boolean(
        row.emergencyContactName || row.emergencyContactPhone || extras.length > 0
      ),
    };
  }

  const primary = row.emergencyContactName
    ? [
        {
          id: "primary",
          name: row.emergencyContactName,
          relationship: row.emergencyContactRelationship,
          phone: formatPhoneForDisplay(row.emergencyContactPhone),
          alternatePhone: null as string | null,
          priority: 1,
          notes: null as string | null,
        },
      ]
    : [];

  return {
    redacted: false,
    contacts: [
      ...primary,
      ...extras.map((c) => ({
        ...c,
        phone: formatPhoneForDisplay(c.phone),
        alternatePhone: c.alternatePhone ? formatPhoneForDisplay(c.alternatePhone) : null,
      })),
    ],
    hasContacts: primary.length + extras.length > 0,
  };
}

export async function loadPeopleEpi(prisma: PrismaClient, employeeId: string) {
  const row = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: {
      shirtSize: true,
      pantsSize: true,
      jacketSize: true,
      gloveSize: true,
      shoeSize: true,
      epiNotes: true,
    },
  });
  if (!row) throw new PeopleProfileAccessError("NOT_FOUND", "Colaborador não encontrado.", 404);
  const deliveries = await prisma.hrEpiDelivery.findMany({
    where: { employeeId },
    orderBy: { deliveredAt: "desc" },
    take: 50,
    select: {
      id: true,
      item: true,
      deliveredAt: true,
      quantity: true,
      size: true,
      validUntil: true,
      responsibleName: true,
      returnedAt: true,
      notes: true,
      createdByUserId: true,
    },
  });
  const names = await resolveActorNames(
    prisma,
    deliveries.map((d) => d.createdByUserId)
  );
  return {
    sizes: row,
    deliveries: deliveries.map((d) => ({
      ...d,
      deliveredAt: d.deliveredAt.toISOString(),
      validUntil: d.validUntil ? d.validUntil.toISOString() : null,
      returnedAt: d.returnedAt ? d.returnedAt.toISOString() : null,
      createdByName: d.createdByUserId ? names.get(d.createdByUserId) ?? null : null,
    })),
  };
}

export async function loadPeopleBenefits(
  prisma: PrismaClient,
  employeeId: string,
  opts: { includeAmounts: boolean }
) {
  const rows = await prisma.hrEmployeeBenefit.findMany({
    where: { employeeId },
    orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
    include: {
      benefit: { select: { id: true, code: true, name: true, category: true, isFinancial: true } },
    },
  });
  const payrollIds = [
    ...new Set(
      rows
        .map((row) => payrollIdFromHrBenefitCode(row.benefit.code))
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const payrollRows =
    payrollIds.length > 0
      ? await prisma.payrollComponent.findMany({
          where: { id: { in: payrollIds } },
          select: { id: true, name: true, type: true, calculationType: true },
        })
      : [];
  const payrollById = new Map(payrollRows.map((row) => [row.id, row]));
  return rows.map((row) => {
    const official = overlayOfficialPayrollName({
      code: row.benefit.code,
      fallbackName: row.benefit.name,
      fallbackCategory: row.benefit.category,
      payrollById,
    });
    const dto: Record<string, unknown> = {
      id: row.id,
      benefitId: row.benefitId,
      code: row.benefit.code,
      name: official.name,
      category: official.category,
      typeLabel: official.typeLabel,
      status: row.status,
      startDate: row.startDate.toISOString(),
      endDate: row.endDate ? row.endDate.toISOString() : null,
      planName: row.planName,
      notes: row.notes,
      isFinancial: row.benefit.isFinancial,
    };
    if (opts.includeAmounts && row.benefit.isFinancial) {
      dto.amount = row.amount != null ? Number(row.amount) : null;
    }
    return dto;
  });
}

export async function loadPeopleAbsences(prisma: PrismaClient, employeeId: string) {
  const rows = await prisma.hrAbsence.findMany({
    where: { employeeId },
    orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
    take: 100,
  });
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    startDate: row.startDate.toISOString(),
    endDate: row.endDate ? row.endDate.toISOString() : null,
    expectedReturn: row.expectedReturn ? row.expectedReturn.toISOString() : null,
    actualReturn: row.actualReturn ? row.actualReturn.toISOString() : null,
    status: row.status,
    reason: row.reason,
    notes: row.notes,
    documentId: row.documentId,
  }));
}

export async function loadPeopleNotes(
  prisma: PrismaClient,
  employeeId: string,
  opts: { includeRestricted: boolean }
) {
  const row = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { professionalNotes: true, adminNotes: true },
  });
  if (!row) throw new PeopleProfileAccessError("NOT_FOUND", "Colaborador não encontrado.", 404);

  const where = opts.includeRestricted
    ? { employeeId }
    : { employeeId, NOT: { category: "RESTRITA" } };

  const notesRaw = await prisma.hrEmployeeNote.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      category: true,
      body: true,
      visibility: true,
      createdAt: true,
      createdByUserId: true,
    },
  });
  const notes = opts.includeRestricted
    ? notesRaw
    : notesRaw.filter((n) => n.category !== "RESTRITA");
  const names = await resolveActorNames(
    prisma,
    notes.map((n) => n.createdByUserId)
  );
  return {
    legacy: {
      professionalNotes: row.professionalNotes,
      adminNotes: opts.includeRestricted ? row.adminNotes : null,
      adminNotesRedacted: !opts.includeRestricted && Boolean(row.adminNotes),
    },
    notes: notes.map((n) => ({
      ...n,
      createdAt: n.createdAt.toISOString(),
      createdByName: n.createdByUserId ? names.get(n.createdByUserId) ?? null : null,
    })),
  };
}

export async function loadPeopleDocuments(prisma: PrismaClient, employeeId: string) {
  const rows = await prisma.hrEmployeeDocument.findMany({
    where: { employeeId },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      documentType: true,
      displayName: true,
      originalFileName: true,
      mimeType: true,
      fileSize: true,
      issuedAt: true,
      expiresAt: true,
      notes: true,
      uploadedByUserId: true,
      createdAt: true,
    },
  });
  const names = await resolveActorNames(
    prisma,
    rows.map((r) => r.uploadedByUserId)
  );
  return {
    items: rows.map((r) => ({
      ...r,
      issuedAt: r.issuedAt ? r.issuedAt.toISOString() : null,
      expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
      uploadedByName: r.uploadedByUserId ? names.get(r.uploadedByUserId) ?? null : null,
      downloadUrl: `/api/employees/${employeeId}/documents/${r.id}/download`,
    })),
    nextCursor: null,
  };
}

export async function loadPeopleCompensation(
  prisma: PrismaClient,
  employeeId: string,
  opts: { includeValues: boolean; actorUserId?: string | null }
) {
  const current = opts.includeValues
    ? await prisma.employee.findUnique({
        where: { id: employeeId },
        select: { salary: true, monthlyHours: true },
      })
    : await prisma.employee.findUnique({
        where: { id: employeeId },
        select: { monthlyHours: true },
      });
  if (!current) throw new PeopleProfileAccessError("NOT_FOUND", "Colaborador não encontrado.", 404);

  const rows = await prisma.hrCompensationAdjustment.findMany({
    where: { employeeId },
    orderBy: [{ effectiveDate: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    take: 50,
    select: {
      id: true,
      effectiveDate: true,
      registeredAt: true,
      type: true,
      percentage: true,
      reason: true,
      notes: true,
      createdByUserId: true,
      ...(opts.includeValues
        ? { previousAmount: true, newAmount: true, differenceAmount: true }
        : {}),
    },
  });
  const names = await resolveActorNames(
    prisma,
    rows.map((r) => r.createdByUserId)
  );

  if (opts.includeValues) {
    logEmployeeHrAudit({
      event: "employee.compensation.view_values",
      actorUserId: opts.actorUserId,
      employeeId,
      details: { count: rows.length },
    });
  }

  const items = rows.map((row) => {
    const dto: Record<string, unknown> = {
      id: row.id,
      effectiveDate: row.effectiveDate.toISOString(),
      registeredAt: row.registeredAt.toISOString(),
      type: row.type,
      typeLabel: compensationTypeLabel(row.type),
      percentage: row.percentage != null ? Number(row.percentage) : null,
      reason: row.reason,
      notes: row.notes,
      createdByUserId: row.createdByUserId,
      createdByName: row.createdByUserId ? names.get(row.createdByUserId) ?? null : null,
    };
    if (opts.includeValues) {
      const money = row as typeof row & {
        previousAmount?: unknown;
        newAmount?: unknown;
        differenceAmount?: unknown;
      };
      dto.previousAmount = money.previousAmount != null ? Number(money.previousAmount) : null;
      dto.newAmount = money.newAmount != null ? Number(money.newAmount) : null;
      dto.differenceAmount =
        money.differenceAmount != null ? Number(money.differenceAmount) : null;
    }
    return dto;
  });

  const result: Record<string, unknown> = {
    monthlyHours: current.monthlyHours,
    items,
  };
  if (opts.includeValues && "salary" in current) {
    result.currentSalary = current.salary != null ? Number(current.salary) : null;
  }
  return result;
}

export async function loadPeopleHistoryPage(
  prisma: PrismaClient,
  employeeId: string,
  opts: { includeAmounts: boolean; cursor?: string | null; limit?: number }
): Promise<{ items: PeopleHistoryEventDto[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(opts.limit ?? PEOPLE_PROFILE_HISTORY_PAGE_SIZE, 1), 200);
  const cursor = decodeHistoryCursor(opts.cursor);
  const keyset = buildHistoryKeysetWhere(cursor);

  const rows = await prisma.hrEmployeeHistory.findMany({
    where: {
      employeeId,
      ...(keyset ?? {}),
    },
    orderBy: [{ effectiveDate: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  });

  const compensationByEvent = new Map<
    string,
    { percentage: number | null; previousAmount: number | null; newAmount: number | null; differenceAmount: number | null }
  >();
  const compensationIds = rows
    .filter((r) => r.eventType === "COMPENSATION_ADJUSTMENT")
    .map((r) => r.id);
  if (compensationIds.length > 0) {
    const adjustments = await prisma.hrCompensationAdjustment.findMany({
      where: { employeeId, historyEventId: { in: compensationIds } },
      select: {
        historyEventId: true,
        percentage: true,
        ...(opts.includeAmounts
          ? { previousAmount: true, newAmount: true, differenceAmount: true }
          : {}),
      },
    });
    for (const adj of adjustments) {
      if (!adj.historyEventId) continue;
      compensationByEvent.set(adj.historyEventId, {
        percentage: adj.percentage != null ? Number(adj.percentage) : null,
        previousAmount:
          opts.includeAmounts && "previousAmount" in adj && adj.previousAmount != null
            ? Number(adj.previousAmount)
            : null,
        newAmount:
          opts.includeAmounts && "newAmount" in adj && adj.newAmount != null
            ? Number(adj.newAmount)
            : null,
        differenceAmount:
          opts.includeAmounts && "differenceAmount" in adj && adj.differenceAmount != null
            ? Number(adj.differenceAmount)
            : null,
      });
    }
  }

  const names = await resolveActorNames(
    prisma,
    rows.map((r) => r.createdByUserId)
  );

  const mapped = rows.map((row) => {
    const money = compensationByEvent.get(row.id);
    return toHistoryEventDto(
      {
        id: row.id,
        eventType: row.eventType,
        effectiveDate: row.effectiveDate,
        createdAt: row.createdAt,
        source: row.source,
        reason: row.reason,
        notes: row.notes,
        previousRoleName: row.previousRoleName,
        newRoleName: row.newRoleName,
        previousDepartment: row.previousDepartment,
        newDepartment: row.newDepartment,
        previousCostCenter: row.previousCostCenter,
        newCostCenter: row.newCostCenter,
        previousManagerName: row.previousManagerName,
        newManagerName: row.newManagerName,
        previousContractType: row.previousContractType,
        newContractType: row.newContractType,
        previousWorkSchedule: row.previousWorkSchedule,
        newWorkSchedule: row.newWorkSchedule,
        previousStatus: row.previousStatus,
        newStatus: row.newStatus,
        createdByUserId: row.createdByUserId,
        createdByName: row.createdByUserId ? names.get(row.createdByUserId) ?? null : null,
        percentage: money?.percentage ?? null,
        previousAmount: money?.previousAmount ?? null,
        newAmount: money?.newAmount ?? null,
        differenceAmount: money?.differenceAmount ?? null,
      },
      { includeAmounts: opts.includeAmounts }
    );
  });

  const hasMore = mapped.length > limit;
  const items = hasMore ? mapped.slice(0, limit) : mapped;
  const last = items[items.length - 1];

  return {
    items,
    nextCursor:
      hasMore && last
        ? encodeHistoryCursor({
            id: last.id,
            effectiveDate: last.effectiveDate,
            createdAt: last.createdAt,
          })
        : null,
  };
}

export async function loadPeopleCareer(prisma: PrismaClient, employeeId: string) {
  const page = await loadPeopleHistoryPage(prisma, employeeId, {
    includeAmounts: false,
    limit: 100,
  });
  const careerTypes = new Set([
    "INITIAL_STATE",
    "ADMISSION",
    "PROMOTION",
    "ROLE_CHANGE",
    "DEPARTMENT_CHANGE",
    "COST_CENTER_CHANGE",
    "MANAGER_CHANGE",
    "CONTRACT_CHANGE",
    "WORK_SCHEDULE_CHANGE",
    "TERMINATION",
    "REHIRE",
  ]);
  return {
    items: page.items.filter((item) => careerTypes.has(item.eventType)),
  };
}
