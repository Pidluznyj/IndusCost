/**
 * Consumidores do contato (timeline, cockpit, Gestão Geral, Cliente 360),
 * status e permissões. Numeração = lista de testes obrigatórios do spec.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { buildCustomerIntelligenceCrm } from "@/src/lib/customerIntelligenceCrm.js";
import { COMMERCIAL_PILOT_ENDPOINTS } from "@/src/lib/commercialAccess.js";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

/** Só código: comentários explicam a regra citando os termos proibidos. */
function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function routeBlock(server: string, signature: string): string {
  const start = server.indexOf(signature);
  assert.ok(start >= 0, `rota ausente: ${signature}`);
  const next = server.indexOf("\n  app.", start + signature.length);
  return server.slice(start, next < 0 ? undefined : next);
}

describe("29/30. timeline e histórico em português", () => {
  it("timeline da carteira usa o catálogo e mostra responsável comercial e quem registrou", () => {
    const src = codeOnly(read("src/components/CrmModule.tsx"));
    for (const needle of [
      "crmContactChannelLabel(activity.channel)",
      "crmContactReasonLabel(activity.reason)",
      "crmContactResultLabel(activity.outcome, activity.reason)",
      "crmNextActionLabel(activity.nextActionType)",
      "crmContactStatusLabel(status)",
    ]) {
      assert.ok(src.includes(needle), needle);
    }
    assert.match(src, /Responsável comercial/);
    assert.match(src, /Registrado por/);
    for (const raw of [
      "{displayLine(activity.channel)}",
      "{displayLine(activity.reason)}",
      "{displayLine(activity.outcome)}",
    ]) {
      assert.equal(src.includes(raw), false, raw);
    }
    // Nome fixo e campos editáveis de responsável/usuário saíram do contato.
    assert.doesNotMatch(src, /formAssignedTo|formCreatedByName|formStatus/);
    for (const rel of [
      "src/components/crm/CrmContactModal.tsx",
      "src/components/crm/crmContactForm.ts",
      "src/lib/commercial/crmContactRegistration.server.ts",
    ]) {
      assert.doesNotMatch(read(rel), /Comercial Lazarios/, rel);
    }
    assert.doesNotMatch(src, /\b(CHANNEL_OPTIONS|REASON_OPTIONS|STATUS_OPTIONS)\b/);
    assert.match(src, /<CrmContactModal/);
  });

  it("cockpit, Gestão Geral e Cliente 360 traduzem pelo catálogo", () => {
    const cockpit = codeOnly(read("src/components/crm/CrmCustomerAccountCockpit.tsx"));
    assert.match(cockpit, /crmNextActionSummary\(a\.nextActionType, a\.nextActionDescription\)/);
    assert.match(cockpit, /crmContactChannelLabel\(profile\?\.preferredChannel\)/);
    const lists = codeOnly(read("src/components/CrmManagementLists.tsx"));
    assert.match(lists, /\["Por canal", data\.activityBreakdown\.byChannel, crmContactChannelLabel\]/);
    assert.match(lists, /\["Por motivo", data\.activityBreakdown\.byReason, crmContactReasonLabel\]/);
    const tab = codeOnly(read("src/components/crm/customer-intelligence/CustomerIntelligenceCrmTab.tsx"));
    assert.match(tab, /crmActivityTypeLabel\(activity\.activityType\)/);
    assert.match(tab, /crmContactResultLabel\(activity\.outcome, activity\.activityType\)/);
    assert.match(tab, /crmContactStatusLabel\(task\.status\)/);
    assert.doesNotMatch(tab, /\{task\.status\}|\{activity\.activityType\}|\{activity\.outcome\}/);
  });

  it("Gestão Geral: 'Por responsável' não atribui o contato a quem registrou", () => {
    const service = read("src/lib/crmManagementDashboardService.ts");
    const responsible = service.slice(service.indexOf("SELECT 'responsible'"), service.indexOf("GROUP BY 2", service.indexOf("SELECT 'responsible'")));
    assert.match(responsible, /COALESCE\(NULLIF\(TRIM\(a\."assignedTo"\), ''\), 'Sem responsável'\)/);
    assert.doesNotMatch(responsible, /createdByName/);
  });

  it("Cliente 360: resultado estruturado vira rótulo e a tarefa leva a próxima ação", () => {
    const crm = buildCustomerIntelligenceCrm({
      customerId: "0f0f0f0f-0000-4000-8000-000000000001",
      commercialOwner: "Carla Mendes",
      activities: [
        {
          id: "a1",
          activityType: "PROPOSAL",
          subject: null,
          description: "Cliente pediu revisão do prazo.",
          scheduledAt: null,
          completedAt: null,
          status: "OPEN",
          assignedTo: "Carla Mendes",
          contactDate: new Date("2026-09-28T13:00:00.000Z"),
          channel: "WHATSAPP",
          outcome: "PROPOSAL_PRESENTED",
          nextActionAt: new Date("2026-10-02T13:00:00.000Z"),
          nextActionDescription: "Prazo 45 dias.",
          nextActionType: "SEND_PROPOSAL",
          createdAt: new Date("2026-09-28T13:05:00.000Z"),
          updatedAt: new Date("2026-09-28T13:05:00.000Z"),
        },
      ],
      crmProfile: null,
      hasPurchaseHistory: true,
      referenceDate: new Date("2026-09-29T12:00:00.000Z"),
    });
    assert.ok(crm.notes.some((note) => note.text.includes("Proposta apresentada")));
    assert.ok(crm.notes.every((note) => !note.text.includes("PROPOSAL_PRESENTED")));
    assert.equal(crm.tasks[0]?.nextActionType, "SEND_PROPOSAL");
    assert.equal(crm.activities[0]?.nextActionType, "SEND_PROPOSAL");
  });
});

describe("33/34. status compatível e permissões preservadas", () => {
  it("33. 'Marcar como concluído' e a regra de follow-up aberto seguem iguais", () => {
    const src = codeOnly(read("src/components/CrmModule.tsx"));
    assert.match(src, /body: JSON\.stringify\(\{ status: "DONE" \}\)/);
    assert.match(src, /return u === "OPEN" \|\| u === "WAITING";/);
    const list = read("src/lib/crmCustomersList.ts");
    assert.match(list, /\["done", "closed", "cancelled", "canceled"\]/);
  });

  it("34. mesmas permissões: criar e o contexto do modal exigem crm.activities:create", () => {
    const server = codeOnly(read("server.ts"));
    const post = routeBlock(server, 'app.post("/api/customers/:customerId/commercial-activities"');
    assert.match(post, /requireResource\("commercial\.crm\.activities", "create"\)/);
    const context = routeBlock(server, 'app.get("/api/customers/:customerId/commercial-activities/context"');
    assert.match(context, /requireResource\("commercial\.crm\.activities", "create"\)/);
    const list = routeBlock(server, 'app.get("/api/customers/:customerId/commercial-activities"');
    assert.match(list, /requireResource\("commercial\.crm\.customer_360", "view"\)/);
    const patch = routeBlock(server, 'app.patch("/api/commercial-activities/:id"');
    assert.match(patch, /requireResource\("commercial\.crm\.activities", "update"\)/);
    assert.ok(
      COMMERCIAL_PILOT_ENDPOINTS.some(
        (e) =>
          e.method === "GET" &&
          e.path === "/api/customers/:id/commercial-activities/context" &&
          e.resourceKey === "commercial.crm.activities" &&
          e.action === "create"
      )
    );
  });

  it("31. edição (PATCH) não reescreve o responsável histórico do contato", () => {
    const server = codeOnly(read("server.ts"));
    const patch = routeBlock(server, 'app.patch("/api/commercial-activities/:id"');
    assert.match(patch, /"assignedTo" in body\) \{\s*return res\.status\(400\)/);
    assert.doesNotMatch(patch, /data\.assignedTo\s*=/);
    assert.doesNotMatch(patch, /createdByName|createdByUserId|commercialOwnerIdentityKey/);
  });

  it("4/6. a rota de criação não lê responsável, usuário nem status do payload", () => {
    const server = codeOnly(read("server.ts"));
    const post = routeBlock(server, 'app.post("/api/customers/:customerId/commercial-activities"');
    assert.doesNotMatch(post, /body\.(createdByName|createdByUserId|assignedTo|status)/);
    assert.match(post, /getCurrentAppUser\(req\)/);
    assert.match(post, /registerCrmContact\(prisma/);
    assert.doesNotMatch(post, /Comercial Lazarios/);
    assert.doesNotMatch(server, /CRM_COMMERCIAL_ACTIVITY_CREATED_BY_NAME_FALLBACK/);
  });
});
