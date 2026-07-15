/**
 * Agregador oficial de vínculos do colaborador / Pessoa Canônica.
 * Consome FKs existentes — não inventa regras de comissão/carteira.
 */

import type { PrismaClient } from "@prisma/client";
import {
  CanonicalPersonError,
  classifyCustomerDocument,
  isPersonUuid,
  maskCpf,
  maskEmail,
} from "@/src/lib/canonicalPerson.js";
import {
  groupKeyForKind,
  SYSTEM_LINK_GROUP_ORDER,
  typeLabelForKind,
  type EmployeeSystemLinksAudit,
  type EmployeeSystemLinksDto,
  type SystemLinkCard,
  type SystemLinksViewerCaps,
} from "@/src/lib/employeeSystemLinks.js";

export type { SystemLinksViewerCaps };

function fmtDate(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const parsed = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString("pt-BR");
}

function statusBr(raw: string | boolean | null | undefined, fallback = "—"): string {
  if (raw === true || raw === "ACTIVE" || raw === "active") return "Ativo";
  if (raw === false || raw === "INACTIVE" || raw === "inactive") return "Inativo";
  if (typeof raw === "string" && raw.trim()) {
    const u = raw.toUpperCase();
    if (u === "PENDING") return "Pendente";
    if (u === "ACTIVE") return "Ativo";
    if (u === "INACTIVE") return "Inativo";
    return raw;
  }
  return fallback;
}

function card(
  partial: Omit<SystemLinkCard, "typeLabel"> & { typeLabel?: string }
): SystemLinkCard {
  return {
    ...partial,
    typeLabel: partial.typeLabel ?? typeLabelForKind(partial.kind),
  };
}

function buildDto(
  cards: SystemLinkCard[],
  meta: {
    employeeName: string;
    hasPerson: boolean;
    personDisplayName: string | null;
    personStatus: string | null;
    personOrigin: string | null;
  }
): EmployeeSystemLinksDto {
  const groups = SYSTEM_LINK_GROUP_ORDER.map((g) => ({
    groupKey: g.key,
    groupLabel: g.label,
    cards: cards.filter((c) => groupKeyForKind(c.kind) === g.key),
  })).filter((g) => g.cards.length > 0);

  const byGroup: Record<string, number> = {};
  for (const g of groups) byGroup[g.groupKey] = g.cards.length;

  return {
    ...meta,
    summary: {
      total: cards.length,
      withAlert: cards.filter((c) => c.alertTone !== "none").length,
      byGroup,
    },
    groups,
    emptyMessage:
      cards.length === 0
        ? meta.hasPerson
          ? "Nenhum outro vínculo encontrado para esta pessoa canônica."
          : "Colaborador sem pessoa canônica — só hierarquia RH local (quando houver)."
        : null,
  };
}

/**
 * Agregação pela ficha do colaborador (ponto de entrada da UI).
 */
export async function getEmployeeSystemLinks(
  prisma: PrismaClient,
  employeeId: string,
  caps: SystemLinksViewerCaps
): Promise<{ dto: EmployeeSystemLinksDto; audit: EmployeeSystemLinksAudit | null }> {
  if (!isPersonUuid(employeeId)) {
    throw new CanonicalPersonError("INVALID_ID", "ID de colaborador inválido.");
  }

  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: {
      id: true,
      name: true,
      socialName: true,
      status: true,
      department: true,
      personId: true,
      managerId: true,
      createdAt: true,
      updatedAt: true,
      manager: {
        select: { id: true, name: true, socialName: true, status: true, department: true },
      },
      directReports: {
        select: { id: true, name: true, socialName: true, status: true, department: true },
        take: 50,
        orderBy: { name: "asc" },
      },
      appUser: {
        select: { id: true, name: true, email: true, isActive: true, role: true, updatedAt: true },
      },
      person: {
        select: {
          id: true,
          displayName: true,
          status: true,
          origin: true,
          createdAt: true,
        },
      },
    },
  });
  if (!employee) {
    throw new CanonicalPersonError("EMPLOYEE_NOT_FOUND", "Colaborador não encontrado.", 404);
  }

  const cards: SystemLinkCard[] = [];
  const technicalRefs: EmployeeSystemLinksAudit["technicalRefs"] = [];

  const push = (
    c: SystemLinkCard,
    tech: { entityTable: string; entityId: string } | null
  ) => {
    cards.push(c);
    if (tech && caps.canOpenAudit) {
      technicalRefs.push({
        cardKey: c.cardKey,
        kind: c.kind,
        entityTable: tech.entityTable,
        entityId: tech.entityId,
      });
    }
  };

  // Este cadastro
  if (caps.canViewEmployees) {
    push(
      card({
        cardKey: `emp-self-${employee.id.slice(0, 8)}`,
        kind: "employee_self",
        entityLabel: employee.socialName?.trim() || employee.name,
        entitySubtitle: employee.department || null,
        statusLabel: statusBr(employee.status),
        originLabel: "Cadastro RH",
        asOfLabel: fmtDate(employee.updatedAt),
        alert: employee.personId
          ? null
          : "Sem pessoa canônica vinculada (legado ou pendente).",
        alertTone: employee.personId ? "none" : "warning",
        action: {
          label: "Abrir RH",
          href: "/employees",
          available: true,
          unavailableReason: null,
        },
      }),
      { entityTable: "Employee", entityId: employee.id }
    );
  }

  // Gestor
  if (caps.canViewEmployees && employee.manager) {
    const m = employee.manager;
    push(
      card({
        cardKey: `mgr-${m.id.slice(0, 8)}`,
        kind: "manager",
        entityLabel: m.socialName?.trim() || m.name,
        entitySubtitle: m.department || null,
        statusLabel: statusBr(m.status),
        originLabel: "Hierarquia RH",
        asOfLabel: null,
        alert: null,
        alertTone: "none",
        action: {
          label: "Ver em Pessoas / RH",
          href: "/employees",
          available: true,
          unavailableReason: null,
        },
      }),
      { entityTable: "Employee", entityId: m.id }
    );
  }

  // Diretos
  if (caps.canViewEmployees) {
    for (const r of employee.directReports) {
      push(
        card({
          cardKey: `rep-${r.id.slice(0, 8)}`,
          kind: "direct_report",
          entityLabel: r.socialName?.trim() || r.name,
          entitySubtitle: r.department || null,
          statusLabel: statusBr(r.status),
          originLabel: "Hierarquia RH",
          asOfLabel: null,
          alert: null,
          alertTone: "none",
          action: {
            label: "Ver em Pessoas / RH",
            href: "/employees",
            available: true,
            unavailableReason: null,
          },
        }),
        { entityTable: "Employee", entityId: r.id }
      );
    }
  }

  // AppUser 1:1 do colaborador
  if (employee.appUser) {
    const u = employee.appUser;
    if (caps.canViewUsers) {
      push(
        card({
          cardKey: `usr-${u.id.slice(0, 8)}`,
          kind: "app_user",
          entityLabel: u.name || "Usuário",
          entitySubtitle: caps.canViewPii ? u.email : maskEmail(u.email),
          statusLabel: u.isActive ? "Ativo" : "Inativo",
          originLabel: `Perfil ${u.role}`,
          asOfLabel: fmtDate(u.updatedAt),
          alert: null,
          alertTone: "none",
          action: {
            label: "Abrir Usuários",
            href: "/settings",
            available: caps.canViewUsers,
            unavailableReason: null,
          },
        }),
        { entityTable: "AppUser", entityId: u.id }
      );
    } else {
      push(
        card({
          cardKey: `usr-hidden`,
          kind: "app_user",
          entityLabel: "Usuário vinculado",
          entitySubtitle: "Detalhes restritos",
          statusLabel: u.isActive ? "Ativo" : "Inativo",
          originLabel: "Acesso ao sistema",
          asOfLabel: null,
          alert: "Sem permissão para ver dados de usuários.",
          alertTone: "warning",
          action: {
            label: "Abrir Usuários",
            href: null,
            available: false,
            unavailableReason: "Sem permissão users.manage / settings",
          },
        }),
        null
      );
    }
  }

  // Vínculos via Person
  if (employee.personId) {
    const personCards = await collectPersonLinkedCards(prisma, employee.personId, caps, {
      excludeEmployeeId: employee.id,
    });
    for (const { card: c, tech } of personCards) {
      push(c, tech);
    }
  }

  const dto = buildDto(cards, {
    employeeName: employee.socialName?.trim() || employee.name,
    hasPerson: Boolean(employee.personId),
    personDisplayName: employee.person?.displayName ?? null,
    personStatus: employee.person ? statusBr(employee.person.status) : null,
    personOrigin: employee.person?.origin ?? null,
  });

  const audit: EmployeeSystemLinksAudit | null = caps.canOpenAudit
    ? {
        employeeId: employee.id,
        personId: employee.personId,
        generatedAt: new Date().toISOString(),
        technicalRefs,
      }
    : null;

  return { dto, audit };
}

async function collectPersonLinkedCards(
  prisma: PrismaClient,
  personId: string,
  caps: SystemLinksViewerCaps,
  opts: { excludeEmployeeId?: string }
): Promise<Array<{ card: SystemLinkCard; tech: { entityTable: string; entityId: string } | null }>> {
  const out: Array<{
    card: SystemLinkCard;
    tech: { entityTable: string; entityId: string } | null;
  }> = [];

  const person = await prisma.person.findUnique({
    where: { id: personId },
    include: {
      employees: {
        select: {
          id: true,
          name: true,
          socialName: true,
          status: true,
          department: true,
          updatedAt: true,
        },
      },
      appUsers: {
        select: {
          id: true,
          name: true,
          email: true,
          isActive: true,
          role: true,
          employeeId: true,
          updatedAt: true,
        },
      },
      commissionPeople: {
        select: {
          id: true,
          name: true,
          email: true,
          active: true,
          type: true,
          source: true,
          updatedAt: true,
          sellerAliases: {
            select: {
              id: true,
              rawSellerName: true,
              rawSellerId: true,
              status: true,
              source: true,
              updatedAt: true,
            },
            take: 20,
          },
        },
      },
      fleetDrivers: {
        select: {
          id: true,
          name: true,
          status: true,
          email: true,
          cpf: true,
          updatedAt: true,
        },
      },
      customersAsIdentity: {
        select: {
          id: true,
          companyName: true,
          taxId: true,
          status: true,
          email: true,
          updatedAt: true,
        },
      },
      customersAsContact: {
        select: {
          id: true,
          companyName: true,
          contactName: true,
          status: true,
          email: true,
          updatedAt: true,
        },
      },
    },
  });
  if (!person) return out;

  if (caps.canViewEmployees) {
    for (const e of person.employees) {
      if (opts.excludeEmployeeId && e.id === opts.excludeEmployeeId) continue;
      out.push({
        card: card({
          cardKey: `peer-${e.id.slice(0, 8)}`,
          kind: "employee_peer",
          entityLabel: e.socialName?.trim() || e.name,
          entitySubtitle: e.department || null,
          statusLabel: statusBr(e.status),
          originLabel: "Mesma pessoa canônica",
          asOfLabel: fmtDate(e.updatedAt),
          alert: "Mais de um colaborador aponta para a mesma Person.",
          alertTone: "conflict",
          action: {
            label: "Abrir RH",
            href: "/employees",
            available: true,
            unavailableReason: null,
          },
        }),
        tech: { entityTable: "Employee", entityId: e.id },
      });
    }
  }

  if (caps.canViewUsers) {
    for (const u of person.appUsers) {
      // Evita duplicar o AppUser 1:1 já listado pelo Employee atual
      if (opts.excludeEmployeeId && u.employeeId === opts.excludeEmployeeId) {
        continue;
      }
      out.push({
        card: card({
          cardKey: `pusr-${u.id.slice(0, 8)}`,
          kind: "app_user",
          entityLabel: u.name || "Usuário",
          entitySubtitle: caps.canViewPii ? u.email : maskEmail(u.email),
          statusLabel: u.isActive ? "Ativo" : "Inativo",
          originLabel: `Person · ${u.role}`,
          asOfLabel: fmtDate(u.updatedAt),
          alert:
            u.employeeId && opts.excludeEmployeeId && u.employeeId !== opts.excludeEmployeeId
              ? "Usuário vinculado a outro colaborador."
              : null,
          alertTone:
            u.employeeId && opts.excludeEmployeeId && u.employeeId !== opts.excludeEmployeeId
              ? "conflict"
              : "none",
          action: {
            label: "Abrir Usuários",
            href: "/settings",
            available: true,
            unavailableReason: null,
          },
        }),
        tech: { entityTable: "AppUser", entityId: u.id },
      });
    }
  } else if (person.appUsers.length > 0) {
    out.push({
      card: card({
        cardKey: "pusr-restricted",
        kind: "app_user",
        entityLabel: `${person.appUsers.length} usuário(s)`,
        entitySubtitle: "Detalhes restritos",
        statusLabel: "—",
        originLabel: "Person",
        asOfLabel: null,
        alert: "Sem permissão para ver usuários.",
        alertTone: "warning",
        action: {
          label: "Abrir Usuários",
          href: null,
          available: false,
          unavailableReason: "Sem permissão",
        },
      }),
      tech: null,
    });
  }

  if (caps.canViewCommissions) {
    for (const cp of person.commissionPeople) {
      out.push({
        card: card({
          cardKey: `cp-${cp.id.slice(0, 8)}`,
          kind: "commission_person",
          entityLabel: cp.name,
          entitySubtitle: caps.canViewPii ? cp.email : maskEmail(cp.email),
          statusLabel: cp.active ? "Ativo" : "Inativo",
          originLabel: `Comissões · ${cp.type} · ${cp.source}`,
          asOfLabel: fmtDate(cp.updatedAt),
          alert: null,
          alertTone: "none",
          action: {
            label: "Abrir Comissões",
            href: "/commissions",
            available: true,
            unavailableReason: null,
          },
        }),
        tech: { entityTable: "CommissionPerson", entityId: cp.id },
      });

      for (const alias of cp.sellerAliases) {
        out.push({
          card: card({
            cardKey: `alias-${alias.id.slice(0, 8)}`,
            kind: "seller_alias",
            entityLabel: alias.rawSellerName,
            entitySubtitle:
              alias.rawSellerId != null ? `ID Nomus ${alias.rawSellerId}` : null,
            statusLabel: statusBr(alias.status),
            originLabel: `Alias · ${alias.source}`,
            asOfLabel: fmtDate(alias.updatedAt),
            alert:
              alias.status !== "ACTIVE"
                ? "Alias inativo — não deve alimentar novos pedidos."
                : null,
            alertTone: alias.status !== "ACTIVE" ? "warning" : "none",
            action: {
              label: "Abrir Comissões",
              href: "/commissions",
              available: true,
              unavailableReason: null,
            },
          }),
          tech: { entityTable: "CommissionPersonAlias", entityId: alias.id },
        });
      }

      // Carteira CRM: donos cujo sellerExternalId casa com nomusPersonId desta CommissionPerson
      // (relação oficial de carteira ≠ comissão; só exibição).
      // Busca limitada pelo nome canônico / external id se disponível via aliases.
    }
  } else if (person.commissionPeople.length > 0) {
    out.push({
      card: card({
        cardKey: "cp-restricted",
        kind: "commission_person",
        entityLabel: `${person.commissionPeople.length} vínculo(s) comercial/comissão`,
        entitySubtitle: "Detalhes restritos",
        statusLabel: "—",
        originLabel: "Comissões",
        asOfLabel: null,
        alert: "Sem permissão para ver comissões.",
        alertTone: "warning",
        action: {
          label: "Abrir Comissões",
          href: null,
          available: false,
          unavailableReason: "Sem permissão commissions.view",
        },
      }),
      tech: null,
    });
  }

  // Carteira CRM + clientes (quando permitido)
  if (caps.canViewCustomers) {
    const cps = await prisma.commissionPerson.findMany({
      where: { personId },
      select: {
        nomusPersonId: true,
        name: true,
        sellerAliases: { select: { rawSellerId: true }, where: { status: "ACTIVE" } },
      },
    });
    const sellerIds = new Set<number>();
    for (const cp of cps) {
      if (cp.nomusPersonId != null) sellerIds.add(cp.nomusPersonId);
      for (const a of cp.sellerAliases) {
        if (a.rawSellerId != null) sellerIds.add(a.rawSellerId);
      }
    }
    if (sellerIds.size > 0) {
      const owners = await prisma.crmCustomerCommercialOwner.findMany({
        where: {
          isActive: true,
          sellerExternalId: { in: [...sellerIds] },
        },
        select: {
          id: true,
          sellerCanonicalName: true,
          sellerResponsibleName: true,
          sellerExternalId: true,
          updatedAt: true,
          Customer: { select: { id: true, companyName: true, status: true } },
        },
        take: 40,
      });
      for (const o of owners) {
        out.push({
          card: card({
            cardKey: `port-${o.id.slice(0, 8)}`,
            kind: "portfolio_owner",
            entityLabel: o.Customer.companyName,
            entitySubtitle:
              o.sellerCanonicalName || o.sellerResponsibleName || null,
            statusLabel: statusBr(o.Customer.status),
            originLabel: "Responsável da carteira (CRM)",
            asOfLabel: fmtDate(o.updatedAt),
            alert:
              "Relacionamento de carteira — não é vendedor comissionável do pedido.",
            alertTone: "warning",
            action: {
              label: "Abrir Clientes",
              href: "/customers",
              available: true,
              unavailableReason: null,
            },
          }),
          tech: { entityTable: "CrmCustomerCommercialOwner", entityId: o.id },
        });
      }
    }

    for (const c of person.customersAsIdentity) {
      out.push({
        card: card({
          cardKey: `cid-${c.id.slice(0, 8)}`,
          kind: "customer_identity",
          entityLabel: c.companyName,
          entitySubtitle: caps.canViewPii
            ? c.taxId
            : maskCpf(c.taxId) || classifyCustomerDocument(c.taxId),
          statusLabel: statusBr(c.status),
          originLabel: "Identidade do cliente PF",
          asOfLabel: fmtDate(c.updatedAt),
          alert: null,
          alertTone: "none",
          action: {
            label: "Abrir Clientes",
            href: "/customers",
            available: true,
            unavailableReason: null,
          },
        }),
        tech: { entityTable: "Customer", entityId: c.id },
      });
    }
    for (const c of person.customersAsContact) {
      out.push({
        card: card({
          cardKey: `cct-${c.id.slice(0, 8)}`,
          kind: "customer_contact",
          entityLabel: c.contactName || c.companyName,
          entitySubtitle: `Cliente: ${c.companyName}`,
          statusLabel: statusBr(c.status),
          originLabel: "Contato cadastral → Person",
          asOfLabel: fmtDate(c.updatedAt),
          alert: "Contato de cliente — não é identidade da empresa (PJ).",
          alertTone: "warning",
          action: {
            label: "Abrir Clientes",
            href: "/customers",
            available: true,
            unavailableReason: null,
          },
        }),
        tech: { entityTable: "Customer", entityId: c.id },
      });
    }
  } else if (
    person.customersAsIdentity.length + person.customersAsContact.length >
    0
  ) {
    out.push({
      card: card({
        cardKey: "cust-restricted",
        kind: "customer_contact",
        entityLabel: `${person.customersAsIdentity.length + person.customersAsContact.length} cliente(s)/contato(s)`,
        entitySubtitle: "Detalhes restritos",
        statusLabel: "—",
        originLabel: "Clientes",
        asOfLabel: null,
        alert: "Sem permissão para ver clientes.",
        alertTone: "warning",
        action: {
          label: "Abrir Clientes",
          href: null,
          available: false,
          unavailableReason: "Sem permissão customers.view",
        },
      }),
      tech: null,
    });
  }

  if (caps.canViewFleet) {
    for (const d of person.fleetDrivers) {
      out.push({
        card: card({
          cardKey: `drv-${d.id.slice(0, 8)}`,
          kind: "fleet_driver",
          entityLabel: d.name,
          entitySubtitle: caps.canViewPii
            ? d.email || d.cpf
            : maskEmail(d.email) || maskCpf(d.cpf),
          statusLabel: statusBr(d.status),
          originLabel: "Frota",
          asOfLabel: fmtDate(d.updatedAt),
          alert: null,
          alertTone: "none",
          action: {
            label: "Abrir Frota",
            href: "/fleet",
            available: true,
            unavailableReason: null,
          },
        }),
        tech: { entityTable: "FleetDriver", entityId: d.id },
      });
    }
  } else if (person.fleetDrivers.length > 0) {
    out.push({
      card: card({
        cardKey: "drv-restricted",
        kind: "fleet_driver",
        entityLabel: `${person.fleetDrivers.length} motorista(s)`,
        entitySubtitle: "Detalhes restritos",
        statusLabel: "—",
        originLabel: "Frota",
        asOfLabel: null,
        alert: "Sem permissão para ver frota.",
        alertTone: "warning",
        action: {
          label: "Abrir Frota",
          href: null,
          available: false,
          unavailableReason: "Sem permissão fleet.view",
        },
      }),
      tech: null,
    });
  }

  return out;
}

/** Compat: endpoint legado /api/people/:id/links → DTO executivo filtrado. */
export async function getPersonSystemLinks(
  prisma: PrismaClient,
  personId: string,
  opts: { canViewPii: boolean } & Partial<SystemLinksViewerCaps>
) {
  if (!isPersonUuid(personId)) {
    throw new CanonicalPersonError("INVALID_PERSON_ID", "ID de pessoa inválido.");
  }
  const person = await prisma.person.findUnique({
    where: { id: personId },
    select: { id: true, displayName: true, status: true, origin: true },
  });
  if (!person) throw new CanonicalPersonError("PERSON_NOT_FOUND", "Pessoa não encontrada.", 404);

  const caps: SystemLinksViewerCaps = {
    canViewPii: opts.canViewPii,
    canViewUsers: opts.canViewUsers ?? true,
    canViewCommissions: opts.canViewCommissions ?? true,
    canViewCustomers: opts.canViewCustomers ?? true,
    canViewFleet: opts.canViewFleet ?? true,
    canViewEmployees: opts.canViewEmployees ?? true,
    canOpenAudit: opts.canOpenAudit ?? false,
    canManagePersonLink: opts.canManagePersonLink ?? false,
  };

  const collected = await collectPersonLinkedCards(prisma, personId, caps, {});
  const cards = collected.map((c) => c.card);
  const dto = buildDto(cards, {
    employeeName: person.displayName,
    hasPerson: true,
    personDisplayName: person.displayName,
    personStatus: statusBr(person.status),
    personOrigin: person.origin,
  });

  return {
    person: {
      id: person.id,
      displayName: person.displayName,
      status: person.status,
      origin: person.origin,
    },
    /** Formato legado (arrays por chave) — mantido para não quebrar consumidores antigos. */
    links: await legacyLinksBuckets(prisma, personId, opts.canViewPii),
    executive: dto,
  };
}

async function legacyLinksBuckets(
  prisma: PrismaClient,
  personId: string,
  canViewPii: boolean
) {
  const person = await prisma.person.findUnique({
    where: { id: personId },
    include: {
      employees: {
        select: { id: true, name: true, socialName: true, status: true, department: true },
      },
      appUsers: {
        select: { id: true, name: true, email: true, isActive: true, role: true },
      },
      commissionPeople: {
        select: { id: true, name: true, email: true, active: true, type: true },
      },
      fleetDrivers: {
        select: { id: true, name: true, status: true, email: true, cpf: true },
      },
      customersAsIdentity: {
        select: {
          id: true,
          companyName: true,
          contactName: true,
          taxId: true,
          status: true,
          email: true,
        },
      },
      customersAsContact: {
        select: {
          id: true,
          companyName: true,
          contactName: true,
          taxId: true,
          status: true,
          email: true,
        },
      },
    },
  });
  if (!person) return {};
  return {
    employees: person.employees,
    appUsers: person.appUsers.map((u) => ({
      ...u,
      email: canViewPii ? u.email : maskEmail(u.email),
    })),
    commissionPeople: person.commissionPeople.map((c) => ({
      ...c,
      email: canViewPii ? c.email : maskEmail(c.email),
    })),
    fleetDrivers: person.fleetDrivers.map((d) => ({
      ...d,
      email: canViewPii ? d.email : maskEmail(d.email),
      cpf: canViewPii ? d.cpf : maskCpf(d.cpf),
    })),
    customers: person.customersAsIdentity.map((c) => ({
      ...c,
      email: canViewPii ? c.email : maskEmail(c.email),
      taxId: canViewPii ? c.taxId : maskCpf(c.taxId),
      documentKind: classifyCustomerDocument(c.taxId),
      linkRole: "identity",
    })),
    customerContacts: person.customersAsContact.map((c) => ({
      ...c,
      email: canViewPii ? c.email : maskEmail(c.email),
      taxId: canViewPii ? c.taxId : maskCpf(c.taxId),
      linkRole: "contact",
    })),
  };
}
