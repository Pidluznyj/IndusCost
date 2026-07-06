import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildCustomerIntelligenceCrm,
  buildCustomerIntelligenceCrmActions,
  CUSTOMER_INTELLIGENCE_CRM_NO_RECENT_CONTACT_DAYS,
  resolveCustomerIntelligenceRelationshipStatus,
} from "./customerIntelligenceCrm.js";
import type { CustomerIntelligenceActivityInput } from "./customerIntelligenceTypes.js";
import { CUSTOMER_INTELLIGENCE_VIEW_PERMISSIONS } from "./customerIntelligencePermissions.js";

const NOW = new Date("2026-06-17T12:00:00.000Z");
const CUSTOMER_ID = "11111111-1111-4111-8111-111111111111";

function baseActivity(
  overrides: Partial<CustomerIntelligenceActivityInput> & Pick<CustomerIntelligenceActivityInput, "id">
): CustomerIntelligenceActivityInput {
  return {
    activityType: "CALL",
    subject: "Ligação comercial",
    description: "Retorno sobre proposta",
    scheduledAt: null,
    completedAt: null,
    status: "OPEN",
    assignedTo: "Maria",
    contactDate: new Date("2026-05-01T10:00:00.000Z"),
    channel: "phone",
    outcome: "Cliente interessado",
    nextActionAt: null,
    nextActionDescription: null,
    createdAt: new Date("2026-05-01T10:00:00.000Z"),
    updatedAt: new Date("2026-05-01T10:00:00.000Z"),
    ...overrides,
  };
}

describe("buildCustomerIntelligenceCrm", () => {
  it("cliente com atividade mostra último contato via contactDate", () => {
    const crm = buildCustomerIntelligenceCrm({
      customerId: CUSTOMER_ID,
      commercialOwner: "Maria",
      activities: [baseActivity({ id: "a1" })],
      crmProfile: null,
      hasPurchaseHistory: true,
      referenceDate: NOW,
    });

    assert.equal(crm.lastContactAt, "2026-05-01T10:00:00.000Z");
    assert.ok(crm.daysSinceLastContact != null && crm.daysSinceLastContact >= 46);
    assert.equal(crm.relationshipStatus, "ativo");
    assert.equal(crm.activities.length, 1);
  });

  it("cliente sem atividade retorna sem histórico", () => {
    const crm = buildCustomerIntelligenceCrm({
      customerId: CUSTOMER_ID,
      commercialOwner: "Maria",
      activities: [],
      crmProfile: null,
      hasPurchaseHistory: false,
      referenceDate: NOW,
    });

    assert.equal(crm.relationshipStatus, "sem_historico");
    assert.equal(crm.lastContactAt, null);
    assert.equal(crm.openTasksCount, 0);
    assert.equal(crm.overdueTasksCount, 0);
    assert.ok(crm.dataQuality.warnings.some((w) => w.includes("Nenhuma CommercialActivity")));
  });

  it("tarefa vencida é contada", () => {
    const crm = buildCustomerIntelligenceCrm({
      customerId: CUSTOMER_ID,
      commercialOwner: "Maria",
      activities: [
        baseActivity({
          id: "overdue",
          nextActionAt: new Date("2026-06-01T10:00:00.000Z"),
          nextActionDescription: "Retornar ligação",
        }),
      ],
      crmProfile: null,
      hasPurchaseHistory: true,
      referenceDate: NOW,
    });

    assert.equal(crm.overdueTasksCount, 1);
    assert.equal(crm.relationshipStatus, "tarefa_vencida");
    assert.equal(crm.tasks[0]!.isOverdue, true);
  });

  it("próxima tarefa é a menor data futura", () => {
    const crm = buildCustomerIntelligenceCrm({
      customerId: CUSTOMER_ID,
      commercialOwner: "Maria",
      activities: [
        baseActivity({
          id: "later",
          nextActionAt: new Date("2026-07-01T10:00:00.000Z"),
        }),
        baseActivity({
          id: "sooner",
          subject: "Follow-up curto",
          nextActionAt: new Date("2026-06-20T10:00:00.000Z"),
        }),
      ],
      crmProfile: null,
      hasPurchaseHistory: true,
      referenceDate: NOW,
    });

    assert.equal(crm.nextTaskAt, "2026-06-20T10:00:00.000Z");
    assert.equal(crm.tasks[0]!.id, "sooner");
  });

  it("relationshipStatus reativação quando há compras e contato antigo", () => {
    const oldContact = new Date(NOW);
    oldContact.setDate(oldContact.getDate() - (CUSTOMER_INTELLIGENCE_CRM_NO_RECENT_CONTACT_DAYS + 5));

    const status = resolveCustomerIntelligenceRelationshipStatus({
      activitiesCount: 2,
      overdueTasksCount: 0,
      daysSinceLastContact: CUSTOMER_INTELLIGENCE_CRM_NO_RECENT_CONTACT_DAYS + 5,
      hasPurchaseHistory: true,
      hasExplicitContact: true,
    });

    assert.equal(status, "reativacao");

    const crm = buildCustomerIntelligenceCrm({
      customerId: CUSTOMER_ID,
      commercialOwner: "Maria",
      activities: [
        baseActivity({
          id: "old",
          contactDate: oldContact,
          status: "CLOSED",
        }),
      ],
      crmProfile: null,
      hasPurchaseHistory: true,
      referenceDate: NOW,
    });

    assert.equal(crm.relationshipStatus, "reativacao");
  });

  it("não usa createdAt como último contato quando contactDate ausente", () => {
    const crm = buildCustomerIntelligenceCrm({
      customerId: CUSTOMER_ID,
      commercialOwner: "Maria",
      activities: [
        baseActivity({
          id: "no-contact",
          contactDate: null,
          createdAt: new Date("2026-06-16T10:00:00.000Z"),
        }),
      ],
      crmProfile: null,
      hasPurchaseHistory: true,
      referenceDate: NOW,
    });

    assert.equal(crm.lastContactAt, null);
    assert.equal(crm.daysSinceLastContact, null);
    assert.equal(crm.relationshipStatus, "sem_contato_recente");
    assert.ok(
      crm.dataQuality.warnings.some((w) => w.includes("contactDate") && w.includes("pedidos"))
    );
  });

  it("não gera NaN/Infinity em dias sem contato", () => {
    const crm = buildCustomerIntelligenceCrm({
      customerId: CUSTOMER_ID,
      commercialOwner: "Maria",
      activities: [baseActivity({ id: "a1" })],
      crmProfile: null,
      hasPurchaseHistory: false,
      referenceDate: NOW,
    });

    assert.ok(crm.daysSinceLastContact != null);
    assert.ok(Number.isFinite(crm.daysSinceLastContact));
  });

  it("inclui notas do perfil CRM quando disponível", () => {
    const crm = buildCustomerIntelligenceCrm({
      customerId: CUSTOMER_ID,
      commercialOwner: "Maria",
      activities: [],
      crmProfile: {
        relationshipNotes: "Cliente prefere contato às terças.",
        relationshipLevel: "WARM",
        commercialTemperature: "MEDIUM",
      },
      hasPurchaseHistory: false,
      referenceDate: NOW,
    });

    assert.equal(crm.notes[0]!.source, "profile");
    assert.ok(crm.dataQuality.profileLoaded);
    assert.ok(crm.dataQuality.sources.includes("CrmCustomerProfile"));
  });

  it("ações incluem link CRM e botões desabilitados para escrita", () => {
    const actions = buildCustomerIntelligenceCrmActions(CUSTOMER_ID);
    const open = actions.find((a) => a.id === "open-crm");
    const register = actions.find((a) => a.id === "register-contact");

    assert.equal(open?.kind, "link");
    assert.ok(open?.href?.includes(CUSTOMER_ID));
    assert.equal(register?.kind, "disabled");
    assert.ok(register?.reason?.includes("crm.activities.create"));
  });
});

describe("customerIntelligenceCrm — permissões", () => {
  const routesSrc = readFileSync(
    join(process.cwd(), "src/lib/customerIntelligenceRoutes.ts"),
    "utf8"
  );

  it("permissoes de visualização alinhadas ao endpoint de inteligência", () => {
    assert.ok(routesSrc.includes("CUSTOMER_INTELLIGENCE_VIEW_PERMISSIONS"));
    const permissionsSrc = readFileSync(
      join(process.cwd(), "src/lib/customerIntelligencePermissions.ts"),
      "utf8"
    );
    for (const perm of CUSTOMER_INTELLIGENCE_VIEW_PERMISSIONS) {
      assert.ok(permissionsSrc.includes(perm));
    }
  });
});
