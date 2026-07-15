/**
 * Pessoa canônica — busca federada e vínculos (server-only).
 */

import type { PrismaClient } from "@prisma/client";
import {
  applyFieldResolutions,
  CanonicalPersonError,
  classifyCustomerDocument,
  detectPersonFieldConflicts,
  isPersonUuid,
  isUnequivocalMatchEvidence,
  maskCpf,
  maskEmail,
  normalizeCpfLoose,
  normalizeEmailLoose,
  normalizePhone,
  type FieldConflict,
  type FieldResolutionChoice,
  type PersonFieldKey,
  type PersonIdentitySnapshot,
  type PersonLinkSourceKind,
} from "@/src/lib/canonicalPerson.js";
import {
  mapResolveItemToLegacyHit,
  resolvePeopleSearch,
} from "@/src/lib/canonicalPersonSearch.server.js";

export type PersonSearchHit = {
  key: string;
  personId: string | null;
  sourceKind: PersonLinkSourceKind;
  sourceId: string;
  displayName: string;
  socialName: string | null;
  emailMasked: string | null;
  email: string | null;
  originLabel: string;
  roles: string[];
  status: string;
  matchReason: "email" | "cpf" | "phone" | "name" | "person";
  podeVincular?: boolean;
  motivoBloqueio?: string | null;
  linkStatus?: string;
};

/**
 * Compat FE legado — delega ao motor unificado `resolvePeopleSearch`.
 */
export async function searchCanonicalPeople(
  prisma: PrismaClient,
  input: {
    q: string;
    limit?: number;
    canViewPii: boolean;
    excludeEmployeeId?: string | null;
  }
): Promise<PersonSearchHit[]> {
  const result = await resolvePeopleSearch(prisma, {
    q: input.q,
    page: 1,
    limit: Math.min(Math.max(input.limit ?? 20, 1), 40),
    canViewPii: input.canViewPii,
    excludeEmployeeId: input.excludeEmployeeId,
    includeInactive: false,
  });
  return result.items.map(mapResolveItemToLegacyHit);
}

export async function ensurePersonFromSource(
  prisma: PrismaClient,
  input: {
    sourceKind: PersonLinkSourceKind;
    sourceId: string;
  }
): Promise<{ id: string; displayName: string; created: boolean }> {
  if (!isPersonUuid(input.sourceId)) {
    throw new CanonicalPersonError("INVALID_SOURCE", "Origem inválida.");
  }

  if (input.sourceKind === "person") {
    const p = await prisma.person.findUnique({ where: { id: input.sourceId } });
    if (!p) throw new CanonicalPersonError("PERSON_NOT_FOUND", "Pessoa não encontrada.", 404);
    return { id: p.id, displayName: p.displayName, created: false };
  }

  if (input.sourceKind === "employee") {
    const e = await prisma.employee.findUnique({ where: { id: input.sourceId } });
    if (!e) throw new CanonicalPersonError("SOURCE_NOT_FOUND", "Colaborador não encontrado.", 404);
    if (e.personId) {
      const p = await prisma.person.findUniqueOrThrow({ where: { id: e.personId } });
      return { id: p.id, displayName: p.displayName, created: false };
    }
    const created = await prisma.person.create({
      data: {
        displayName: e.socialName?.trim() || e.name,
        socialName: e.socialName,
        corporateEmail: normalizeEmailLoose(e.corporateEmail),
        personalEmail: normalizeEmailLoose(e.personalEmail),
        cpfNormalized: normalizeCpfLoose(e.cpf),
        phoneNormalized: normalizePhone(e.phone),
        status: (e.status ?? "ACTIVE") === "INACTIVE" ? "INACTIVE" : "ACTIVE",
        origin: "EMPLOYEE",
      },
    });
    await prisma.employee.update({ where: { id: e.id }, data: { personId: created.id } });
    return { id: created.id, displayName: created.displayName, created: true };
  }

  if (input.sourceKind === "app_user") {
    const u = await prisma.appUser.findUnique({ where: { id: input.sourceId } });
    if (!u) throw new CanonicalPersonError("SOURCE_NOT_FOUND", "Usuário não encontrado.", 404);
    if (u.personId) {
      const p = await prisma.person.findUniqueOrThrow({ where: { id: u.personId } });
      return { id: p.id, displayName: p.displayName, created: false };
    }
    const created = await prisma.person.create({
      data: {
        displayName: u.name,
        corporateEmail: normalizeEmailLoose(u.email),
        status: u.isActive ? "ACTIVE" : "INACTIVE",
        origin: "APP_USER",
      },
    });
    await prisma.appUser.update({ where: { id: u.id }, data: { personId: created.id } });
    return { id: created.id, displayName: created.displayName, created: true };
  }

  if (input.sourceKind === "commission_person") {
    const c = await prisma.commissionPerson.findUnique({ where: { id: input.sourceId } });
    if (!c) throw new CanonicalPersonError("SOURCE_NOT_FOUND", "Pessoa comissionada não encontrada.", 404);
    if (c.personId) {
      const p = await prisma.person.findUniqueOrThrow({ where: { id: c.personId } });
      return { id: p.id, displayName: p.displayName, created: false };
    }
    const created = await prisma.person.create({
      data: {
        displayName: c.name,
        corporateEmail: normalizeEmailLoose(c.email),
        cpfNormalized: normalizeCpfLoose(c.document),
        status: c.active ? "ACTIVE" : "INACTIVE",
        origin: "COMMISSION",
      },
    });
    await prisma.commissionPerson.update({ where: { id: c.id }, data: { personId: created.id } });
    return { id: created.id, displayName: created.displayName, created: true };
  }

  if (input.sourceKind === "fleet_driver") {
    const d = await prisma.fleetDriver.findUnique({ where: { id: input.sourceId } });
    if (!d) throw new CanonicalPersonError("SOURCE_NOT_FOUND", "Motorista não encontrado.", 404);
    if (d.personId) {
      const p = await prisma.person.findUniqueOrThrow({ where: { id: d.personId } });
      return { id: p.id, displayName: p.displayName, created: false };
    }
    const created = await prisma.person.create({
      data: {
        displayName: d.name,
        corporateEmail: normalizeEmailLoose(d.email),
        cpfNormalized: normalizeCpfLoose(d.cpf),
        phoneNormalized: normalizePhone(d.phone),
        status: "ACTIVE",
        origin: "SYSTEM",
      },
    });
    await prisma.fleetDriver.update({ where: { id: d.id }, data: { personId: created.id } });
    return { id: created.id, displayName: created.displayName, created: true };
  }

  if (input.sourceKind === "customer_pf") {
    const c = await prisma.customer.findUnique({ where: { id: input.sourceId } });
    if (!c) throw new CanonicalPersonError("SOURCE_NOT_FOUND", "Cliente não encontrado.", 404);
    if (classifyCustomerDocument(c.taxId) !== "PF") {
      throw new CanonicalPersonError(
        "CUSTOMER_NOT_PF",
        "Somente cliente pessoa física pode vincular identidade a Person."
      );
    }
    if (c.personId) {
      const p = await prisma.person.findUniqueOrThrow({ where: { id: c.personId } });
      return { id: p.id, displayName: p.displayName, created: false };
    }
    const created = await prisma.person.create({
      data: {
        displayName: c.contactName?.trim() || c.companyName,
        corporateEmail: normalizeEmailLoose(c.email),
        cpfNormalized: normalizeCpfLoose(c.taxId),
        phoneNormalized: normalizePhone(c.phone),
        status: c.status === "INACTIVE" ? "INACTIVE" : "ACTIVE",
        origin: "SYSTEM",
      },
    });
    await prisma.customer.update({ where: { id: c.id }, data: { personId: created.id } });
    return { id: created.id, displayName: created.displayName, created: true };
  }

  throw new CanonicalPersonError("INVALID_SOURCE", "Tipo de origem não suportado.");
}

export async function createCanonicalPerson(
  prisma: PrismaClient,
  snapshot: PersonIdentitySnapshot,
  options?: { origin?: string; createdByUserId?: string | null }
): Promise<{ id: string; displayName: string }> {
  const { createPersonCore } = await import("@/src/lib/canonicalPersonCore.server.js");
  const created = await createPersonCore(prisma, {
    displayName: snapshot.displayName ?? "",
    socialName: snapshot.socialName,
    corporateEmail: snapshot.corporateEmail,
    personalEmail: snapshot.personalEmail,
    cpf: snapshot.cpfNormalized,
    phone: snapshot.phoneNormalized,
    origin: (options?.origin as "MANUAL" | "EMPLOYEE" | "APP_USER" | "COMMISSION" | "SYSTEM" | "BACKFILL") ?? "MANUAL",
    createdByUserId: options?.createdByUserId ?? null,
  });
  return { id: created.id, displayName: created.displayName };
}

export async function previewLinkEmployeeToPerson(
  prisma: PrismaClient,
  input: {
    personId?: string | null;
    sourceKind?: PersonLinkSourceKind | null;
    sourceId?: string | null;
    form: PersonIdentitySnapshot;
  }
): Promise<{
  personId: string;
  conflicts: FieldConflict[];
  person: PersonIdentitySnapshot;
}> {
  let personId = input.personId ?? null;
  if (!personId && input.sourceKind && input.sourceId) {
    const ensured = await ensurePersonFromSource(prisma, {
      sourceKind: input.sourceKind,
      sourceId: input.sourceId,
    });
    personId = ensured.id;
  }
  if (!personId || !isPersonUuid(personId)) {
    throw new CanonicalPersonError("PERSON_REQUIRED", "Selecione uma pessoa válida.");
  }
  const person = await prisma.person.findUnique({ where: { id: personId } });
  if (!person) throw new CanonicalPersonError("PERSON_NOT_FOUND", "Pessoa não encontrada.", 404);

  const personSnap: PersonIdentitySnapshot = {
    displayName: person.displayName,
    socialName: person.socialName,
    corporateEmail: person.corporateEmail,
    personalEmail: person.personalEmail,
    cpfNormalized: person.cpfNormalized,
    phoneNormalized: person.phoneNormalized,
  };
  const formSnap: PersonIdentitySnapshot = {
    displayName: input.form.displayName,
    socialName: input.form.socialName,
    corporateEmail: normalizeEmailLoose(input.form.corporateEmail),
    personalEmail: normalizeEmailLoose(input.form.personalEmail),
    cpfNormalized: normalizeCpfLoose(input.form.cpfNormalized),
    phoneNormalized: normalizePhone(input.form.phoneNormalized),
  };

  return {
    personId: person.id,
    conflicts: detectPersonFieldConflicts(formSnap, personSnap),
    person: personSnap,
  };
}

export async function resolveEmployeePersonIdForPersist(
  prisma: PrismaClient,
  input: {
    personId?: string | null;
    createNewPerson?: boolean;
    sourceKind?: PersonLinkSourceKind | null;
    sourceId?: string | null;
    form: PersonIdentitySnapshot & { name?: string | null; cpf?: string | null; phone?: string | null };
    fieldResolutions?: Partial<Record<PersonFieldKey, FieldResolutionChoice>>;
    existingEmployeeId?: string | null;
  }
): Promise<{
  personId: string | null;
  appliedForm: PersonIdentitySnapshot;
  conflicts: FieldConflict[];
}> {
  const formSnap: PersonIdentitySnapshot = {
    displayName: (input.form.displayName || input.form.name || "").trim() || null,
    socialName: input.form.socialName ?? null,
    corporateEmail: normalizeEmailLoose(input.form.corporateEmail),
    personalEmail: normalizeEmailLoose(input.form.personalEmail),
    cpfNormalized: normalizeCpfLoose(input.form.cpfNormalized ?? input.form.cpf),
    phoneNormalized: normalizePhone(input.form.phoneNormalized ?? input.form.phone),
  };

  // Vincular origem ou personId
  if (input.personId || (input.sourceKind && input.sourceId)) {
    const preview = await previewLinkEmployeeToPerson(prisma, {
      personId: input.personId,
      sourceKind: input.sourceKind,
      sourceId: input.sourceId,
      form: formSnap,
    });
    const unresolved = preview.conflicts.filter(
      (c) => !input.fieldResolutions?.[c.field]
    );
    if (unresolved.length > 0) {
      throw new CanonicalPersonError(
        "FIELD_CONFLICTS",
        "Há conflitos de dados com a pessoa selecionada. Resolva antes de salvar.",
        409,
        unresolved
      );
    }
    const other = await prisma.employee.findFirst({
      where: {
        personId: preview.personId,
        ...(input.existingEmployeeId ? { id: { not: input.existingEmployeeId } } : {}),
      },
      select: { id: true, name: true },
    });
    if (other) {
      throw new CanonicalPersonError(
        "PERSON_ALREADY_HAS_EMPLOYEE",
        `Esta pessoa já está vinculada ao colaborador "${other.name}".`,
        409
      );
    }
    const applied = applyFieldResolutions(
      formSnap,
      preview.person,
      input.fieldResolutions ?? {}
    );
    return {
      personId: preview.personId,
      appliedForm: applied,
      conflicts: preview.conflicts,
    };
  }

  if (input.createNewPerson === true) {
    const created = await createCanonicalPerson(prisma, formSnap);
    return {
      personId: created.id,
      appliedForm: formSnap,
      conflicts: [],
    };
  }

  return { personId: null, appliedForm: formSnap, conflicts: [] };
}

export async function getPersonSystemLinks(
  prisma: PrismaClient,
  personId: string,
  opts: { canViewPii: boolean }
) {
  const { getPersonSystemLinks: getLinks } = await import(
    "@/src/lib/employeeSystemLinks.server.js"
  );
  return getLinks(prisma, personId, opts);
}

export async function unlinkEmployeeFromPerson(
  prisma: PrismaClient,
  employeeId: string
): Promise<void> {
  if (!isPersonUuid(employeeId)) {
    throw new CanonicalPersonError("INVALID_ID", "ID inválido.");
  }
  await prisma.employee.update({
    where: { id: employeeId },
    data: { personId: null },
  });
  console.info(
    JSON.stringify({
      audit: "person.unlink_employee",
      employeeId,
      at: new Date().toISOString(),
    })
  );
}

/** Dry-run de correspondências inequívocas (e-mail/CPF). Não grava. */
export async function diagnoseUnequivocalPersonMatches(prisma: PrismaClient) {
  const report: Array<{
    kind: string;
    leftId: string;
    rightId: string;
    evidence: "email" | "cpf";
    autoLinkSafe: boolean;
  }> = [];

  const employees = await prisma.employee.findMany({
    where: { personId: null },
    select: {
      id: true,
      corporateEmail: true,
      personalEmail: true,
      cpf: true,
      name: true,
    },
    take: 2000,
  });
  const users = await prisma.appUser.findMany({
    where: { personId: null },
    select: { id: true, email: true, name: true },
    take: 2000,
  });

  for (const e of employees) {
    const emails = [e.corporateEmail, e.personalEmail]
      .map(normalizeEmailLoose)
      .filter(Boolean) as string[];
    const cpf = normalizeCpfLoose(e.cpf);
    for (const u of users) {
      const uEmail = normalizeEmailLoose(u.email);
      const emailExact = Boolean(uEmail && emails.includes(uEmail));
      const cpfExact = false; // AppUser sem CPF
      if (
        isUnequivocalMatchEvidence({ emailExact, cpfExact, nameOnly: false }) &&
        emailExact
      ) {
        report.push({
          kind: "employee↔app_user",
          leftId: e.id,
          rightId: u.id,
          evidence: "email",
          autoLinkSafe: true,
        });
      }
    }
  }

  return {
    scannedEmployees: employees.length,
    scannedUsers: users.length,
    unequivocalMatches: report,
    note: "Nome semelhante nunca é auto-link. CPF/e-mail exato apenas.",
  };
}

export async function getCustomerPeopleLinks(
  prisma: PrismaClient,
  customerId: string,
  opts: { canViewPii: boolean }
) {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    include: {
      person: true,
      contactPerson: true,
      CrmCustomerCommercialOwner: true,
    },
  });
  if (!customer) throw new CanonicalPersonError("CUSTOMER_NOT_FOUND", "Cliente não encontrado.", 404);

  const docKind = classifyCustomerDocument(customer.taxId);

  const otherCustomersWithSamePerson = customer.personId
    ? await prisma.customer.findMany({
        where: { personId: customer.personId, id: { not: customer.id } },
        select: { id: true, companyName: true, taxId: true },
        take: 10,
      })
    : [];

  const contactPersonOtherCustomers = customer.contactPersonId
    ? await prisma.customer.findMany({
        where: { contactPersonId: customer.contactPersonId, id: { not: customer.id } },
        select: { id: true, companyName: true },
        take: 10,
      })
    : [];

  const orders = await prisma.salesOrder.findMany({
    where: { customerId },
    select: {
      id: true,
      orderCode: true,
      externalSellerId: true,
      nomusSellerName: true,
      responsible: true,
      issueDate: true,
    },
    orderBy: { issueDate: "desc" },
    take: 200,
  });

  const sellerMap = new Map<
    string,
    {
      type: "vendedor_pedido_nomus";
      externalSellerId: number | null;
      nomusSellerName: string | null;
      displayName: string;
      orderCount: number;
      sampleOrderCodes: string[];
      note: string;
    }
  >();
  for (const o of orders) {
    const name =
      (o.nomusSellerName || "").trim() ||
      (o.externalSellerId != null ? `Vendedor ID ${o.externalSellerId}` : "");
    if (!name && o.externalSellerId == null) continue;
    const key =
      o.externalSellerId != null
        ? `id:${o.externalSellerId}`
        : `name:${name.toLowerCase()}`;
    const existing = sellerMap.get(key);
    if (existing) {
      existing.orderCount += 1;
      if (existing.sampleOrderCodes.length < 3 && o.orderCode) {
        existing.sampleOrderCodes.push(o.orderCode);
      }
    } else {
      sellerMap.set(key, {
        type: "vendedor_pedido_nomus",
        externalSellerId: o.externalSellerId,
        nomusSellerName: o.nomusSellerName,
        displayName: (o.nomusSellerName || "").trim() || name || "—",
        orderCount: 1,
        sampleOrderCodes: o.orderCode ? [o.orderCode] : [],
        note:
          "Vendedor do Pedido de Venda Nomus — relacionamento comercial, não identidade do cliente nem responsável da carteira.",
      });
    }
  }

  return {
    customerId: customer.id,
    documentKind: docKind,
    identity: {
      canLinkPerson: docKind === "PF",
      personId: customer.personId,
      person: customer.person
        ? {
            id: customer.person.id,
            displayName: customer.person.displayName,
            status: customer.person.status,
            email: opts.canViewPii
              ? customer.person.corporateEmail || customer.person.personalEmail
              : maskEmail(
                  customer.person.corporateEmail || customer.person.personalEmail
                ),
            cpfMasked: maskCpf(customer.person.cpfNormalized),
          }
        : null,
      alsoLinkedCustomers: otherCustomersWithSamePerson.map((c) => ({
        id: c.id,
        companyName: c.companyName,
      })),
      note:
        docKind === "PF"
          ? "Identidade: o cliente PF é (ou pode ser) a mesma Pessoa Canônica."
          : "Cliente PJ não possui identidade Person.",
    },
    relationshipLinks: {
      commercialOwner: customer.CrmCustomerCommercialOwner
        ? {
            type: "responsável_carteira",
            sellerResponsibleName: customer.CrmCustomerCommercialOwner.sellerResponsibleName,
            sellerCanonicalName: customer.CrmCustomerCommercialOwner.sellerCanonicalName,
            sellerExternalId: customer.CrmCustomerCommercialOwner.sellerExternalId,
            isActive: customer.CrmCustomerCommercialOwner.isActive,
            note:
              "Responsável da carteira (CRM) — relacionamento. Não é vendedor comissionável do pedido.",
          }
        : null,
      contactSnapshot: {
        type: "contato_cadastral",
        contactName: customer.contactName,
        email: opts.canViewPii ? customer.email : maskEmail(customer.email),
        phone: opts.canViewPii ? customer.phone : customer.phone ? "***" : null,
        note: "Snapshot cadastral do cliente (campos denormalizados).",
      },
      contactPerson: {
        canLink: true,
        personId: customer.contactPersonId,
        person: customer.contactPerson
          ? {
              id: customer.contactPerson.id,
              displayName: customer.contactPerson.displayName,
              status: customer.contactPerson.status,
              email: opts.canViewPii
                ? customer.contactPerson.corporateEmail ||
                  customer.contactPerson.personalEmail
                : maskEmail(
                    customer.contactPerson.corporateEmail ||
                      customer.contactPerson.personalEmail
                  ),
              }
          : null,
        alsoContactOfCustomers: contactPersonOtherCustomers,
        note:
          "Contato externo apontando para Pessoa Canônica. Em PJ, não confunde com a empresa.",
      },
      orderSellers: [...sellerMap.values()],
      accountOwner: customer.accountOwner
        ? {
            type: "gestor_conta_texto",
            value: customer.accountOwner,
            note: "Texto legado accountOwner — não é Person nem carteira CRM.",
          }
        : null,
    },
  };
}

async function resolvePersonTargetId(
  prisma: PrismaClient,
  input: {
    personId?: string | null;
    sourceKind?: PersonLinkSourceKind | null;
    sourceId?: string | null;
    createNewFromContact?: boolean;
    customer: {
      id: string;
      contactName: string | null;
      companyName: string;
      email: string | null;
      phone: string | null;
      taxId: string;
    };
  }
): Promise<string> {
  if (input.personId) {
    if (!isPersonUuid(input.personId)) {
      throw new CanonicalPersonError("INVALID_PERSON", "Pessoa inválida.");
    }
    const p = await prisma.person.findUnique({ where: { id: input.personId } });
    if (!p) throw new CanonicalPersonError("PERSON_NOT_FOUND", "Pessoa não encontrada.", 404);
    return p.id;
  }
  if (input.sourceKind && input.sourceId) {
    const ensured = await ensurePersonFromSource(prisma, {
      sourceKind: input.sourceKind,
      sourceId: input.sourceId,
    });
    return ensured.id;
  }
  if (input.createNewFromContact) {
    const created = await createCanonicalPerson(
      prisma,
      {
        displayName: input.customer.contactName?.trim() || input.customer.companyName,
        personalEmail: normalizeEmailLoose(input.customer.email),
        corporateEmail: null,
        cpfNormalized:
          classifyCustomerDocument(input.customer.taxId) === "PF"
            ? normalizeCpfLoose(input.customer.taxId)
            : null,
        phoneNormalized: normalizePhone(input.customer.phone),
      },
      { origin: "SYSTEM" }
    );
    return created.id;
  }
  throw new CanonicalPersonError(
    "PERSON_REQUIRED",
    "Informe personId, origem da busca ou createNewFromContact."
  );
}

/**
 * Vincula identidade Person ↔ Customer (somente PF).
 * Não altera responsável da carteira nem vendedor de pedido.
 */
export async function linkCustomerIdentityPerson(
  prisma: PrismaClient,
  customerId: string,
  input: {
    personId?: string | null;
    sourceKind?: PersonLinkSourceKind | null;
    sourceId?: string | null;
    createNewFromContact?: boolean;
    fieldResolutions?: Partial<Record<PersonFieldKey, FieldResolutionChoice>>;
  }
) {
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) throw new CanonicalPersonError("CUSTOMER_NOT_FOUND", "Cliente não encontrado.", 404);
  if (classifyCustomerDocument(customer.taxId) !== "PF") {
    throw new CanonicalPersonError(
      "CUSTOMER_NOT_PF",
      "Somente cliente pessoa física pode vincular identidade a Person."
    );
  }

  const personId = await resolvePersonTargetId(prisma, {
    ...input,
    customer,
  });

  const person = await prisma.person.findUniqueOrThrow({ where: { id: personId } });
  const formSnap: PersonIdentitySnapshot = {
    displayName: customer.contactName?.trim() || customer.companyName,
    personalEmail: normalizeEmailLoose(customer.email),
    corporateEmail: null,
    cpfNormalized: normalizeCpfLoose(customer.taxId),
    phoneNormalized: normalizePhone(customer.phone),
  };
  const personSnap: PersonIdentitySnapshot = {
    displayName: person.displayName,
    socialName: person.socialName,
    corporateEmail: person.corporateEmail,
    personalEmail: person.personalEmail,
    cpfNormalized: person.cpfNormalized,
    phoneNormalized: person.phoneNormalized,
  };
  const conflicts = detectPersonFieldConflicts(formSnap, personSnap);
  if (conflicts.length > 0) {
    const unresolved = conflicts.filter((c) => !input.fieldResolutions?.[c.field]);
    if (unresolved.length > 0) {
      throw new CanonicalPersonError(
        "FIELD_CONFLICTS",
        "Há conflitos entre o cadastro do cliente e a pessoa. Resolva campo a campo.",
        409,
        unresolved
      );
    }
    // Resoluções informadas — apenas vincula; não reescreve Person nem snapshot neste endpoint.
    void applyFieldResolutions(formSnap, personSnap, input.fieldResolutions ?? {});
  }

  const updated = await prisma.customer.update({
    where: { id: customerId },
    data: { personId },
    select: { id: true, personId: true },
  });

  console.info(
    JSON.stringify({
      audit: "customer.person_identity.link",
      customerId,
      personId,
      at: new Date().toISOString(),
    })
  );

  return {
    ok: true,
    customerId: updated.id,
    personId: updated.personId,
    person: { id: person.id, displayName: person.displayName },
  };
}

export async function unlinkCustomerIdentityPerson(
  prisma: PrismaClient,
  customerId: string
) {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { id: true, personId: true },
  });
  if (!customer) throw new CanonicalPersonError("CUSTOMER_NOT_FOUND", "Cliente não encontrado.", 404);
  if (!customer.personId) {
    return { ok: true, customerId, personId: null };
  }
  await prisma.customer.update({
    where: { id: customerId },
    data: { personId: null },
  });
  console.info(
    JSON.stringify({
      audit: "customer.person_identity.unlink",
      customerId,
      previousPersonId: customer.personId,
      at: new Date().toISOString(),
      note: "Person não é apagada — histórico preservado.",
    })
  );
  return { ok: true, customerId, personId: null };
}

/**
 * Vincula contato cadastral → Person (PF ou PJ).
 * Em PJ isto NÃO define identidade da empresa.
 */
export async function linkCustomerContactPerson(
  prisma: PrismaClient,
  customerId: string,
  input: {
    personId?: string | null;
    sourceKind?: PersonLinkSourceKind | null;
    sourceId?: string | null;
    createNewFromContact?: boolean;
  }
) {
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) throw new CanonicalPersonError("CUSTOMER_NOT_FOUND", "Cliente não encontrado.", 404);

  const personId = await resolvePersonTargetId(prisma, {
    ...input,
    customer,
  });
  const person = await prisma.person.findUniqueOrThrow({ where: { id: personId } });

  await prisma.customer.update({
    where: { id: customerId },
    data: { contactPersonId: personId },
  });

  console.info(
    JSON.stringify({
      audit: "customer.contact_person.link",
      customerId,
      personId,
      documentKind: classifyCustomerDocument(customer.taxId),
      at: new Date().toISOString(),
    })
  );

  return {
    ok: true,
    customerId,
    contactPersonId: personId,
    person: { id: person.id, displayName: person.displayName },
  };
}

export async function unlinkCustomerContactPerson(
  prisma: PrismaClient,
  customerId: string
) {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { id: true, contactPersonId: true },
  });
  if (!customer) throw new CanonicalPersonError("CUSTOMER_NOT_FOUND", "Cliente não encontrado.", 404);
  if (!customer.contactPersonId) {
    return { ok: true, customerId, contactPersonId: null };
  }
  await prisma.customer.update({
    where: { id: customerId },
    data: { contactPersonId: null },
  });
  console.info(
    JSON.stringify({
      audit: "customer.contact_person.unlink",
      customerId,
      previousContactPersonId: customer.contactPersonId,
      at: new Date().toISOString(),
      note: "Person não é apagada.",
    })
  );
  return { ok: true, customerId, contactPersonId: null };
}
