import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSystemLinksViewerCaps,
  filterSystemLinkDto,
  groupKeyForKind,
  typeLabelForKind,
  type EmployeeSystemLinksDto,
  type SystemLinkCard,
} from "./employeeSystemLinks.ts";

function sampleCard(overrides: Partial<SystemLinkCard> = {}): SystemLinkCard {
  return {
    cardKey: "c1",
    kind: "commission_person",
    typeLabel: typeLabelForKind("commission_person"),
    entityLabel: "João Vendas",
    entitySubtitle: null,
    statusLabel: "Ativo",
    originLabel: "Comissões",
    asOfLabel: "01/01/2026",
    alert: null,
    alertTone: "none",
    action: {
      label: "Abrir Comissões",
      href: "/commissions",
      available: true,
      unavailableReason: null,
    },
    ...overrides,
  };
}

describe("employeeSystemLinks — caps", () => {
  it("admin vê módulos e auditoria", () => {
    const caps = buildSystemLinksViewerCaps({ role: "ADMIN", permissions: [] });
    assert.equal(caps.canViewUsers, true);
    assert.equal(caps.canViewCustomers, true);
    assert.equal(caps.canOpenAudit, true);
    assert.equal(caps.canViewPii, true);
  });

  it("RH só view sem comissões/clientes/frota", () => {
    const caps = buildSystemLinksViewerCaps({
      role: "USER",
      permissions: ["employees.view"],
    });
    assert.equal(caps.canViewEmployees, true);
    assert.equal(caps.canViewCommissions, false);
    assert.equal(caps.canViewCustomers, false);
    assert.equal(caps.canViewFleet, false);
    assert.equal(caps.canViewUsers, false);
    assert.equal(caps.canOpenAudit, false);
  });

  it("people.link.manage abre auditoria sem users.manage", () => {
    const caps = buildSystemLinksViewerCaps({
      permissions: ["employees.view", "people.link.manage"],
    });
    assert.equal(caps.canOpenAudit, true);
    assert.equal(caps.canManagePersonLink, true);
  });
});

describe("employeeSystemLinks — agrupamento e filtro", () => {
  it("groupKeyForKind mapeia comercial vs clientes", () => {
    assert.equal(groupKeyForKind("seller_alias"), "commercial");
    assert.equal(groupKeyForKind("portfolio_owner"), "commercial");
    assert.equal(groupKeyForKind("customer_contact"), "customers");
    assert.equal(groupKeyForKind("manager"), "hr");
  });

  it("filterSystemLinkDto filtra por texto e preserva vazios", () => {
    const dto: EmployeeSystemLinksDto = {
      employeeName: "Ana",
      hasPerson: true,
      personDisplayName: "Ana",
      personStatus: "Ativo",
      personOrigin: "RH",
      summary: {
        total: 2,
        withAlert: 1,
        byGroup: { commercial: 1, hr: 1 },
      },
      groups: [
        {
          groupKey: "commercial",
          groupLabel: "Comercial",
          cards: [sampleCard()],
        },
        {
          groupKey: "hr",
          groupLabel: "RH",
          cards: [
            sampleCard({
              cardKey: "m1",
              kind: "manager",
              typeLabel: "Gestor responsável",
              entityLabel: "Maria Gestora",
              alert: "Conflito demo",
              alertTone: "conflict",
            }),
          ],
        },
      ],
      emptyMessage: null,
    };

    const onlySeller = filterSystemLinkDto(dto, "vendas");
    assert.equal(onlySeller.summary.total, 1);
    assert.equal(onlySeller.groups.length, 1);
    assert.equal(onlySeller.groups[0].cards[0].entityLabel, "João Vendas");

    const none = filterSystemLinkDto(dto, "xyz-inexistente");
    assert.equal(none.summary.total, 0);
    assert.ok(none.emptyMessage?.includes("xyz-inexistente"));
  });
});
