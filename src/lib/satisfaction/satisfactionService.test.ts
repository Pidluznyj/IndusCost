/**
 * Serviços de Satisfação — campanha e superfície pública.
 *
 * Usa um Prisma falso em memória (o ambiente não tem banco). O foco é o
 * COMPORTAMENTO do serviço: idempotência de audiência e de submit, congelamento
 * do questionário na publicação, minimização do DTO público e recusa de
 * responder fora da janela.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSatisfactionCampaignService } from "./satisfactionCampaignService.server.js";
import {
  createSatisfactionPublicService,
  SATISFACTION_PUBLIC_SESSION_SCOPE,
} from "./satisfactionPublicService.server.js";
import { generateSatisfactionToken, hashSatisfactionToken } from "./satisfactionToken.js";

// ─── Prisma falso ───────────────────────────────────────────────────────────

type Row = Record<string, any>;

/** Coleção com o mínimo da API do Prisma que os serviços usam. */
function collection(seed: Row[] = []) {
  let rows = seed.map((r) => ({ ...r }));
  let autoId = rows.length;

  const matches = (row: Row, where: Row | undefined): boolean => {
    if (!where) return true;
    return Object.entries(where).every(([key, condition]) => {
      if (condition === null) return row[key] == null;
      if (condition instanceof Date) return row[key]?.getTime?.() === condition.getTime();
      if (typeof condition === "object") {
        if ("in" in condition) return (condition.in as unknown[]).includes(row[key]);
        if ("not" in condition) {
          return condition.not === null ? row[key] != null : row[key] !== condition.not;
        }
        if ("gt" in condition) return row[key] > condition.gt;
        if ("lte" in condition) return row[key] <= condition.lte;
        return true;
      }
      return row[key] === condition;
    });
  };

  const api = {
    get rows() {
      return rows;
    },
    async findUnique({ where }: { where: Row }) {
      const [key, value] = Object.entries(where)[0]!;
      return rows.find((r) => r[key] === value) ?? null;
    },
    async findFirst({ where }: { where?: Row } = {}) {
      return rows.find((r) => matches(r, where)) ?? null;
    },
    async findMany({ where }: { where?: Row } = {}) {
      return rows.filter((r) => matches(r, where));
    },
    async count({ where }: { where?: Row } = {}) {
      return rows.filter((r) => matches(r, where)).length;
    },
    async create({ data }: { data: Row }) {
      autoId += 1;
      const created = { id: data.id ?? `id-${autoId}`, ...data };
      rows.push(created);
      return created;
    },
    async createMany({
      data,
      skipDuplicates,
    }: {
      data: Row[];
      skipDuplicates?: boolean;
    }) {
      let count = 0;
      for (const item of data) {
        // Emula o UNIQUE (campaignId, customerId) / (campaignId, code).
        const duplicate = rows.some(
          (r) =>
            (item.customerId != null &&
              r.campaignId === item.campaignId &&
              r.customerId === item.customerId) ||
            (item.code != null && r.campaignId === item.campaignId && r.code === item.code)
        );
        if (duplicate && skipDuplicates) continue;
        autoId += 1;
        rows.push({ id: `id-${autoId}`, ...item });
        count += 1;
      }
      return { count };
    },
    async update({ where, data }: { where: Row; data: Row }) {
      const [key, value] = Object.entries(where)[0]!;
      const row = rows.find((r) => r[key] === value);
      if (!row) throw new Error("not found");
      for (const [field, next] of Object.entries(data)) {
        if (next && typeof next === "object" && "increment" in next) {
          row[field] = (row[field] ?? 0) + (next as Row).increment;
        } else if (next !== undefined) {
          row[field] = next;
        }
      }
      return row;
    },
    async updateMany({ where, data }: { where?: Row; data: Row }) {
      const affected = rows.filter((r) => matches(r, where));
      for (const row of affected) Object.assign(row, data);
      return { count: affected.length };
    },
    async deleteMany({ where }: { where?: Row } = {}) {
      const before = rows.length;
      rows = rows.filter((r) => !matches(r, where));
      return { count: before - rows.length };
    },
    async delete({ where }: { where: Row }) {
      const [key, value] = Object.entries(where)[0]!;
      rows = rows.filter((r) => r[key] !== value);
      return {};
    },
    async upsert({ where, create, update }: { where: Row; create: Row; update: Row }) {
      const compound = Object.values(where)[0] as Row;
      const existing = rows.find(
        (r) => r.responseId === compound.responseId && r.questionId === compound.questionId
      );
      if (existing) {
        Object.assign(existing, update);
        return existing;
      }
      autoId += 1;
      const created = { id: `id-${autoId}`, ...create };
      rows.push(created);
      return created;
    },
    async groupBy() {
      return [];
    },
  };
  return api;
}

function buildPrisma(seed: Record<string, Row[]> = {}) {
  const store = {
    satisfactionSurveyTemplate: collection(seed.templates ?? []),
    satisfactionSurveyQuestion: collection(seed.questions ?? []),
    satisfactionSurveyCampaign: collection(seed.campaigns ?? []),
    satisfactionSurveyCampaignQuestion: collection(seed.campaignQuestions ?? []),
    satisfactionSurveyInvitation: collection(seed.invitations ?? []),
    satisfactionSurveyAccessToken: collection(seed.tokens ?? []),
    satisfactionPublicSession: collection(seed.sessions ?? []),
    satisfactionSurveyResponse: collection(seed.responses ?? []),
    satisfactionSurveyAnswer: collection(seed.answers ?? []),
    satisfactionSurveyEvent: collection(seed.events ?? []),
    satisfactionImportBatch: collection([]),
    customer: collection(seed.customers ?? []),
    commercialAuditLog: collection([]),
  };
  const prisma = {
    ...store,
    async $transaction(fn: (tx: unknown) => Promise<unknown>) {
      return fn(prisma);
    },
    async $queryRaw() {
      return [];
    },
  };
  return prisma as any;
}

const V1_QUESTIONS = [
  { id: "q-quality", code: "PRODUCT_QUALITY", label: "Qualidade", type: "RATING", sortOrder: 1, required: true, scaleMin: 1, scaleMax: 5, helpText: null },
  { id: "q-delivery", code: "DELIVERY_DEADLINE", label: "Prazo", type: "RATING", sortOrder: 2, required: true, scaleMin: 1, scaleMax: 5, helpText: null },
  { id: "q-feedback", code: "OPEN_FEEDBACK", label: "Comentário", type: "TEXT", sortOrder: 3, required: true, scaleMin: null, scaleMax: null, helpText: null },
];

const OPEN_CAMPAIGN = {
  id: "camp-1",
  code: "SAT_2026",
  name: "Satisfação 2026",
  description: null,
  templateId: "tpl-1",
  status: "OPEN",
  opensAt: null,
  closesAt: null,
  referenceStart: new Date("2026-01-01T00:00:00Z"),
  referenceEnd: new Date("2026-12-31T00:00:00Z"),
  publishedAt: new Date("2026-02-01T00:00:00Z"),
  allowGeneralLink: false,
  questions: V1_QUESTIONS,
};

// ─── Campanha ───────────────────────────────────────────────────────────────

describe("campanha — audiência idempotente", () => {
  it("republicar a mesma audiência NÃO duplica convites", async () => {
    const prisma = buildPrisma({
      campaigns: [{ ...OPEN_CAMPAIGN, id: "camp-draft", status: "DRAFT", publishedAt: null }],
      customers: [
        { id: "cus-1", companyName: "Alfa", taxId: "1", CrmCustomerCommercialOwner: null },
        { id: "cus-2", companyName: "Beta", taxId: "2", CrmCustomerCommercialOwner: null },
      ],
    });
    const service = createSatisfactionCampaignService({ prisma });

    const first = await service.setCampaignAudience("camp-draft", ["cus-1", "cus-2"], "user");
    assert.equal(first.added, 2);
    assert.equal(first.total, 2);

    // Segundo clique / reenvio do mesmo formulário.
    const second = await service.setCampaignAudience("camp-draft", ["cus-1", "cus-2"], "user");
    assert.equal(second.added, 0, "nada novo deveria ser criado");
    assert.equal(second.total, 2, "a audiência não pode dobrar");
  });

  it("id repetido no mesmo payload conta uma vez só", async () => {
    const prisma = buildPrisma({
      campaigns: [{ ...OPEN_CAMPAIGN, id: "camp-draft", status: "DRAFT", publishedAt: null }],
      customers: [{ id: "cus-1", companyName: "Alfa", taxId: "1", CrmCustomerCommercialOwner: null }],
    });
    const service = createSatisfactionCampaignService({ prisma });
    const result = await service.setCampaignAudience(
      "camp-draft",
      ["cus-1", "cus-1", "cus-1"],
      "user"
    );
    assert.equal(result.total, 1);
  });

  it("audiência é recusada depois que a campanha sai do rascunho", async () => {
    const prisma = buildPrisma({ campaigns: [OPEN_CAMPAIGN], customers: [] });
    const service = createSatisfactionCampaignService({ prisma });
    await assert.rejects(
      () => service.setCampaignAudience("camp-1", ["cus-1"], "user"),
      /rascunho/i
    );
  });

  it("guarda snapshot do cliente sem criar cadastro paralelo", async () => {
    const prisma = buildPrisma({
      campaigns: [{ ...OPEN_CAMPAIGN, id: "camp-draft", status: "DRAFT", publishedAt: null }],
      customers: [
        {
          id: "cus-1",
          companyName: "Metalúrgica Alfa",
          taxId: "12345678000190",
          CrmCustomerCommercialOwner: { sellerExternalId: 7, sellerCanonicalName: "Ana" },
        },
      ],
    });
    const service = createSatisfactionCampaignService({ prisma });
    await service.setCampaignAudience("camp-draft", ["cus-1"], "user");

    const invitation = prisma.satisfactionSurveyInvitation.rows[0];
    assert.equal(invitation.customerId, "cus-1", "o vínculo é com o Customer oficial");
    assert.equal(invitation.customerNameSnapshot, "Metalúrgica Alfa");
    assert.equal(invitation.responsibleCommercialNameSnapshot, "Ana");
  });
});

describe("campanha — publicação congela o questionário", () => {
  it("copia as perguntas do template para o snapshot da campanha", async () => {
    const prisma = buildPrisma({
      campaigns: [
        {
          ...OPEN_CAMPAIGN,
          id: "camp-draft",
          status: "DRAFT",
          publishedAt: null,
          template: { questions: V1_QUESTIONS },
        },
      ],
      invitations: [{ id: "inv-1", campaignId: "camp-draft", revokedAt: null, accessTokens: [] }],
    });
    const service = createSatisfactionCampaignService({ prisma });

    const result = await service.publishCampaign("camp-draft", "user");
    assert.equal(result.questionCount, 3);

    const snapshot = prisma.satisfactionSurveyCampaignQuestion.rows;
    assert.deepEqual(
      snapshot.map((q: Row) => q.code).sort(),
      ["DELIVERY_DEADLINE", "OPEN_FEEDBACK", "PRODUCT_QUALITY"]
    );
    assert.equal(prisma.satisfactionSurveyCampaign.rows[0].status, "OPEN");
  });

  it("publicar duas vezes não duplica snapshot nem emite token extra", async () => {
    const prisma = buildPrisma({
      campaigns: [
        {
          ...OPEN_CAMPAIGN,
          id: "camp-draft",
          status: "DRAFT",
          publishedAt: null,
          template: { questions: V1_QUESTIONS },
        },
      ],
      invitations: [{ id: "inv-1", campaignId: "camp-draft", revokedAt: null, accessTokens: [] }],
    });
    const service = createSatisfactionCampaignService({ prisma });

    await service.publishCampaign("camp-draft", "user");
    const questionsAfterFirst = prisma.satisfactionSurveyCampaignQuestion.rows.length;
    const tokensAfterFirst = prisma.satisfactionSurveyAccessToken.rows.length;

    // A campanha agora está OPEN: a máquina de estados recusa republicar.
    await assert.rejects(() => service.publishCampaign("camp-draft", "user"), /Transição/i);
    assert.equal(prisma.satisfactionSurveyCampaignQuestion.rows.length, questionsAfterFirst);
    assert.equal(prisma.satisfactionSurveyAccessToken.rows.length, tokensAfterFirst);
  });

  it("token individual é gravado só como hash", async () => {
    const prisma = buildPrisma({
      campaigns: [
        {
          ...OPEN_CAMPAIGN,
          id: "camp-draft",
          status: "DRAFT",
          publishedAt: null,
          template: { questions: V1_QUESTIONS },
        },
      ],
      invitations: [{ id: "inv-1", campaignId: "camp-draft", revokedAt: null, accessTokens: [] }],
    });
    const service = createSatisfactionCampaignService({ prisma });
    await service.publishCampaign("camp-draft", "user");

    const token = prisma.satisfactionSurveyAccessToken.rows[0];
    assert.ok(token, "deveria emitir token para o convite");
    assert.match(token.tokenHash, /^[0-9a-f]{64}$/);
    assert.equal(
      Object.keys(token).some((k) => /^token$/i.test(k)),
      false,
      "não pode existir coluna com o token em claro"
    );
  });

  it("não publica campanha sem audiência e sem link geral", async () => {
    const prisma = buildPrisma({
      campaigns: [
        {
          ...OPEN_CAMPAIGN,
          id: "camp-vazia",
          status: "DRAFT",
          publishedAt: null,
          allowGeneralLink: false,
          template: { questions: V1_QUESTIONS },
        },
      ],
    });
    const service = createSatisfactionCampaignService({ prisma });
    await assert.rejects(() => service.publishCampaign("camp-vazia", "user"), /cliente/i);
  });
});

describe("campanha — exclusão protege o histórico", () => {
  it("rascunho virgem pode ser excluído", async () => {
    const prisma = buildPrisma({
      campaigns: [
        {
          ...OPEN_CAMPAIGN,
          id: "camp-draft",
          status: "DRAFT",
          publishedAt: null,
          _count: { invitations: 0, responses: 0 },
        },
      ],
    });
    const service = createSatisfactionCampaignService({ prisma });
    await service.deleteCampaign("camp-draft", "user");
    assert.equal(prisma.satisfactionSurveyCampaign.rows.length, 0);
  });

  it("ELIMINATÓRIO: campanha com resposta NÃO pode ser apagada", async () => {
    const prisma = buildPrisma({
      campaigns: [
        {
          ...OPEN_CAMPAIGN,
          id: "camp-com-historico",
          status: "DRAFT",
          publishedAt: null,
          _count: { invitations: 3, responses: 2 },
        },
      ],
    });
    const service = createSatisfactionCampaignService({ prisma });
    await assert.rejects(
      () => service.deleteCampaign("camp-com-historico", "user"),
      /rascunho sem convites/i
    );
    assert.equal(prisma.satisfactionSurveyCampaign.rows.length, 1);
  });
});

describe("campanha — exclusão LÓGICA (só SUPER_ADMIN)", () => {
  function seedForSoftDelete() {
    return buildPrisma({
      campaigns: [{ ...OPEN_CAMPAIGN, deletedAt: null }],
      tokens: [
        { id: "tok-a", campaignId: "camp-1", status: "ACTIVE", revokedAt: null },
        { id: "tok-r", campaignId: "camp-1", status: "REVOKED", revokedAt: new Date("2026-01-01T00:00:00Z") },
        { id: "tok-outra", campaignId: "camp-2", status: "ACTIVE", revokedAt: null },
      ],
      sessions: [
        { id: "sess-aberta", campaignId: "camp-1", revokedAt: null },
        { id: "sess-outra", campaignId: "camp-2", revokedAt: null },
      ],
    });
  }

  it("marca deletedAt/deletedByUserId e NÃO apaga nada do banco", async () => {
    const prisma = seedForSoftDelete();
    const service = createSatisfactionCampaignService({ prisma });

    const deleted = await service.softDeleteCampaign("camp-1", "user-admin");
    assert.deepEqual(deleted, { id: "camp-1", code: "SAT_2026", name: "Satisfação 2026" });

    const row = prisma.satisfactionSurveyCampaign.rows[0];
    assert.ok(row.deletedAt instanceof Date, "deletedAt preenchido");
    assert.equal(row.deletedByUserId, "user-admin");
    // ELIMINATÓRIO: exclusão lógica preserva TUDO — nenhuma linha some.
    assert.equal(prisma.satisfactionSurveyCampaign.rows.length, 1);
    assert.equal(prisma.satisfactionSurveyAccessToken.rows.length, 3);
    assert.equal(prisma.satisfactionPublicSession.rows.length, 2);
  });

  it("revoga tokens ATIVOS e sessões abertas SÓ da campanha excluída", async () => {
    const prisma = seedForSoftDelete();
    const service = createSatisfactionCampaignService({ prisma });
    await service.softDeleteCampaign("camp-1", "user-admin");

    const byId = (id: string) =>
      prisma.satisfactionSurveyAccessToken.rows.find((r: Row) => r.id === id)!;
    assert.equal(byId("tok-a").status, "REVOKED");
    assert.ok(byId("tok-a").revokedAt, "token ativo ganhou revokedAt");
    // Já revogado não é reprocessado; campanha alheia intocada.
    assert.equal(
      byId("tok-r").revokedAt.getTime(),
      new Date("2026-01-01T00:00:00Z").getTime()
    );
    assert.equal(byId("tok-outra").status, "ACTIVE");

    const sess = (id: string) =>
      prisma.satisfactionPublicSession.rows.find((r: Row) => r.id === id)!;
    assert.ok(sess("sess-aberta").revokedAt, "sessão pública encerrada");
    assert.equal(sess("sess-outra").revokedAt, null, "outra campanha intocada");
  });

  it("registra auditoria DELETED sem apagar a trilha", async () => {
    const prisma = seedForSoftDelete();
    const service = createSatisfactionCampaignService({ prisma });
    await service.softDeleteCampaign("camp-1", "user-admin");
    const audit = prisma.commercialAuditLog.rows.at(-1);
    assert.equal(audit.entityType, "SATISFACTION_CAMPAIGN");
    assert.equal(audit.action, "DELETED");
    assert.match(String(audit.newValue), /exclusão lógica/);
  });

  it("excluir de novo (ou id inexistente) → NOT_FOUND", async () => {
    const prisma = seedForSoftDelete();
    const service = createSatisfactionCampaignService({ prisma });
    await service.softDeleteCampaign("camp-1", "user-admin");
    await assert.rejects(
      () => service.softDeleteCampaign("camp-1", "user-admin"),
      /não encontrada/i
    );
    await assert.rejects(
      () => service.softDeleteCampaign("nao-existe", "user-admin"),
      /não encontrada/i
    );
  });

  it("some das telas: listCampaigns filtra e getCampaign devolve 404", async () => {
    const prisma = buildPrisma({
      campaigns: [
        { ...OPEN_CAMPAIGN, deletedAt: null, _count: { invitations: 0, responses: 0 } },
        {
          ...OPEN_CAMPAIGN,
          id: "camp-excluida",
          code: "SAT_OLD",
          deletedAt: new Date(),
          _count: { invitations: 0, responses: 0 },
        },
      ],
    });
    const service = createSatisfactionCampaignService({ prisma });

    const { rows, total } = await service.listCampaigns({
      page: 1,
      pageSize: 25,
      status: null,
      search: null,
      allowedCustomerIds: null,
    });
    assert.equal(total, 1);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, "camp-1", "só a campanha viva aparece no grid");

    await assert.rejects(() => service.getCampaign("camp-excluida"), /não encontrada/i);
  });

  it("link de campanha excluída PARA de funcionar (troca de token recusada)", async () => {
    const { prisma, token } = seedForPublic({ campaign: { deletedAt: new Date() } });
    const service = createSatisfactionPublicService({ prisma });
    const result = await service.exchangeToken(token);
    assert.equal(result.ok, false);
    assert.equal((result as { reason: string }).reason, "REVOKED");
    assert.equal(prisma.satisfactionPublicSession.rows.length, 0, "nenhuma sessão criada");
  });
});

// ─── Superfície pública ─────────────────────────────────────────────────────

function seedForPublic(overrides: { campaign?: Row; invitation?: Row } = {}) {
  const generated = generateSatisfactionToken();
  const campaign = { ...OPEN_CAMPAIGN, ...overrides.campaign };
  const invitation = {
    id: "inv-1",
    campaignId: campaign.id,
    customerId: "cus-1",
    customerNameSnapshot: "Metalúrgica Alfa",
    customerTaxIdSnapshot: "12345678000190",
    revokedAt: null,
    completedAt: null,
    startedAt: null,
    firstOpenedAt: null,
    ...overrides.invitation,
  };
  const prisma = buildPrisma({
    campaigns: [campaign],
    invitations: [invitation],
    tokens: [
      {
        id: "tok-1",
        campaignId: campaign.id,
        invitationId: invitation.id,
        kind: "INDIVIDUAL",
        tokenHash: generated.tokenHash,
        tokenPrefix: generated.tokenPrefix,
        status: "ACTIVE",
        expiresAt: null,
        revokedAt: null,
        campaign,
        invitation,
      },
    ],
  });
  return { prisma, token: generated.token, campaign, invitation };
}

describe("superfície pública — troca de token", () => {
  it("token válido cria sessão de escopo restrito", async () => {
    const { prisma, token } = seedForPublic();
    const service = createSatisfactionPublicService({ prisma });

    const result = await service.exchangeToken(token);
    assert.equal(result.ok, true);

    const session = prisma.satisfactionPublicSession.rows[0];
    assert.equal(session.scope, SATISFACTION_PUBLIC_SESSION_SCOPE);
    assert.equal(session.campaignId, "camp-1");
    // ELIMINATÓRIO: a sessão guarda hash, não o token da sessão em claro.
    assert.match(session.tokenHash, /^[0-9a-f]{64}$/);
    assert.notEqual(session.tokenHash, (result as { sessionToken: string }).sessionToken);
  });

  it("marca a abertura do convite (funil)", async () => {
    const { prisma, token } = seedForPublic();
    const service = createSatisfactionPublicService({ prisma });
    await service.exchangeToken(token);
    assert.ok(prisma.satisfactionSurveyInvitation.rows[0].firstOpenedAt);
    assert.equal(prisma.satisfactionSurveyEvent.rows[0].type, "OPENED");
  });

  it("token malformado é recusado sem tocar o banco", async () => {
    const { prisma } = seedForPublic();
    const service = createSatisfactionPublicService({ prisma });
    const result = await service.exchangeToken("curto-demais");
    assert.deepEqual(result, {
      ok: false,
      reason: "INVALID",
      message: "Link inválido.",
    });
    assert.equal(prisma.satisfactionPublicSession.rows.length, 0);
  });

  it("convite já concluído devolve ALREADY_ANSWERED", async () => {
    const { prisma, token } = seedForPublic({
      invitation: { completedAt: new Date("2026-03-01T00:00:00Z") },
    });
    const service = createSatisfactionPublicService({ prisma });
    const result = await service.exchangeToken(token);
    assert.equal((result as { reason: string }).reason, "ALREADY_ANSWERED");
  });

  it("campanha encerrada recusa a troca", async () => {
    const { prisma, token } = seedForPublic({ campaign: { status: "CLOSED" } });
    const service = createSatisfactionPublicService({ prisma });
    const result = await service.exchangeToken(token);
    assert.equal((result as { reason: string }).reason, "CLOSED");
  });

  it("token revogado é bloqueado", async () => {
    const { prisma, token } = seedForPublic();
    prisma.satisfactionSurveyAccessToken.rows[0].status = "REVOKED";
    prisma.satisfactionSurveyAccessToken.rows[0].revokedAt = new Date();
    const service = createSatisfactionPublicService({ prisma });
    const result = await service.exchangeToken(token);
    assert.equal((result as { reason: string }).reason, "REVOKED");
  });
});

describe("superfície pública — DTO do formulário", () => {
  it("ELIMINATÓRIO: não vaza id interno, customerId nem dado financeiro", async () => {
    const { prisma, token } = seedForPublic();
    prisma.satisfactionSurveyCampaign.rows[0].questions = V1_QUESTIONS;
    const service = createSatisfactionPublicService({ prisma });

    const session = await service.exchangeToken(token);
    const sessionToken = (session as { sessionToken: string }).sessionToken;
    const form = await service.getForm(sessionToken, null);
    assert.equal(form.ok, true);

    const serialized = JSON.stringify((form as { form: unknown }).form);
    for (const forbidden of ["cus-1", "camp-1", "inv-1", "customerId", "invitationId", "templateId"]) {
      assert.equal(
        serialized.includes(forbidden),
        false,
        `DTO público vazou "${forbidden}"`
      );
    }
  });

  it("a identidade da pergunta é o code, sem id de banco", async () => {
    const { prisma, token } = seedForPublic();
    prisma.satisfactionSurveyCampaign.rows[0].questions = V1_QUESTIONS;
    const service = createSatisfactionPublicService({ prisma });
    const session = await service.exchangeToken(token);
    const form = await service.getForm(
      (session as { sessionToken: string }).sessionToken,
      null
    );
    const questions = (form as any).form.questions as Array<Record<string, unknown>>;
    assert.ok(questions.every((q) => typeof q.code === "string"));
    assert.ok(questions.every((q) => !("id" in q)), "pergunta não pode carregar id interno");
  });

  it("entrega a escala rotulada — o cliente não precisa memorizar", async () => {
    const { prisma, token } = seedForPublic();
    prisma.satisfactionSurveyCampaign.rows[0].questions = V1_QUESTIONS;
    const service = createSatisfactionPublicService({ prisma });
    const session = await service.exchangeToken(token);
    const form = await service.getForm(
      (session as { sessionToken: string }).sessionToken,
      null
    );
    assert.deepEqual((form as any).form.ratingScale, [
      { value: 1, label: "Ruim" },
      { value: 2, label: "Regular" },
      { value: 3, label: "Bom" },
      { value: 4, label: "Ótimo" },
      { value: 5, label: "Excelente" },
    ]);
  });

  it("sessão inexistente não devolve formulário", async () => {
    const { prisma } = seedForPublic();
    const service = createSatisfactionPublicService({ prisma });
    const form = await service.getForm("sessao-que-nao-existe", null);
    assert.equal(form.ok, false);
  });

  it("DTO do formulário público expõe turnstile.required/siteKey e não serializa secret", async () => {
    const { prisma, token } = seedForPublic();
    prisma.satisfactionSurveyCampaign.rows[0].questions = V1_QUESTIONS;
    const service = createSatisfactionPublicService({ prisma });
    const session = await service.exchangeToken(token);
    const result = await service.getForm((session as { sessionToken: string }).sessionToken, {
      required: true,
      siteKey: "pk_publica",
    });
    assert.equal(result.ok, true);
    const form = (result as { form: { turnstile: { required: boolean; siteKey: string | null } } }).form;
    assert.deepEqual(form.turnstile, { required: true, siteKey: "pk_publica" });
    const serialized = JSON.stringify(form);
    assert.equal(serialized.includes("pk_publica"), true);
    assert.equal(serialized.toLowerCase().includes("secret"), false);
  });
});

describe("superfície pública — submit", () => {
  const validAnswers = [
    { questionCode: "PRODUCT_QUALITY", ratingValue: 5 },
    { questionCode: "DELIVERY_DEADLINE", ratingValue: 3 },
    { questionCode: "OPEN_FEEDBACK", textValue: "tudo certo" },
  ];

  async function openSession() {
    const seeded = seedForPublic();
    seeded.prisma.satisfactionSurveyCampaign.rows[0].questions = V1_QUESTIONS;
    const service = createSatisfactionPublicService({ prisma: seeded.prisma });
    const session = await service.exchangeToken(seeded.token);
    return {
      ...seeded,
      service,
      sessionToken: (session as { sessionToken: string }).sessionToken,
    };
  }

  it("grava resposta, marca convite concluído e registra evento", async () => {
    const { prisma, service, sessionToken } = await openSession();
    const result = await service.submit(sessionToken, {
      answers: validAnswers,
      respondentName: "João",
      respondentPhone: "11999999999",
      declaredCompanyName: null,
      declaredTaxId: null,
      idempotencyKey: "chave-1",
      turnstileToken: null,
    });

    assert.equal(result.ok, true);
    assert.equal(prisma.satisfactionSurveyResponse.rows.length, 1);
    assert.equal(prisma.satisfactionSurveyResponse.rows[0].status, "SUBMITTED");
    assert.ok(prisma.satisfactionSurveyInvitation.rows[0].completedAt);
    assert.ok(
      prisma.satisfactionSurveyEvent.rows.some((e: Row) => e.type === "SUBMITTED")
    );
  });

  it("ELIMINATÓRIO: duplo submit NÃO cria segunda resposta", async () => {
    const { prisma, service, sessionToken } = await openSession();
    const payload = {
      answers: validAnswers,
      respondentName: "João",
      respondentPhone: null,
      declaredCompanyName: null,
      declaredTaxId: null,
      idempotencyKey: "chave-unica",
      turnstileToken: null,
    };

    const first = await service.submit(sessionToken, payload);
    const second = await service.submit(sessionToken, payload);

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(
      (second as { alreadySubmitted: boolean }).alreadySubmitted,
      true,
      "o segundo envio deve ser idempotente"
    );
    assert.equal(
      prisma.satisfactionSurveyResponse.rows.length,
      1,
      "não pode existir uma segunda resposta"
    );
    assert.equal(
      (first as { responseId: string }).responseId,
      (second as { responseId: string }).responseId
    );
  });

  it("ELIMINATÓRIO: nota não respondida não vira linha com zero", async () => {
    const { prisma, service, sessionToken } = await openSession();
    await service.submit(sessionToken, {
      answers: validAnswers,
      respondentName: "João",
      respondentPhone: null,
      declaredCompanyName: null,
      declaredTaxId: null,
      idempotencyKey: "k",
      turnstileToken: null,
    });
    for (const answer of prisma.satisfactionSurveyAnswer.rows) {
      assert.notEqual(answer.ratingValue, 0);
    }
  });

  it("recusa submissão sem pergunta obrigatória", async () => {
    const { prisma, service, sessionToken } = await openSession();
    const result = await service.submit(sessionToken, {
      answers: [{ questionCode: "PRODUCT_QUALITY", ratingValue: 5 }],
      respondentName: null,
      respondentPhone: null,
      declaredCompanyName: null,
      declaredTaxId: null,
      idempotencyKey: null,
      turnstileToken: null,
    });
    assert.equal(result.ok, false);
    assert.equal((result as { reason: string }).reason, "VALIDATION");
    assert.equal(prisma.satisfactionSurveyResponse.rows.length, 0, "nada pode ser gravado");
  });

  it("recusa nota fora da escala", async () => {
    const { prisma, service, sessionToken } = await openSession();
    const result = await service.submit(sessionToken, {
      answers: [
        { questionCode: "PRODUCT_QUALITY", ratingValue: 9 },
        { questionCode: "DELIVERY_DEADLINE", ratingValue: 3 },
        { questionCode: "OPEN_FEEDBACK", textValue: "x" },
      ],
      respondentName: null,
      respondentPhone: null,
      declaredCompanyName: null,
      declaredTaxId: null,
      idempotencyKey: null,
      turnstileToken: null,
    });
    assert.equal(result.ok, false);
    assert.equal(prisma.satisfactionSurveyResponse.rows.length, 0);
  });

  it("sem sessão válida não grava nada", async () => {
    const { prisma, service } = await openSession();
    const result = await service.submit("token-invalido", {
      answers: validAnswers,
      respondentName: null,
      respondentPhone: null,
      declaredCompanyName: null,
      declaredTaxId: null,
      idempotencyKey: null,
      turnstileToken: null,
    });
    assert.equal(result.ok, false);
    assert.equal(prisma.satisfactionSurveyResponse.rows.length, 0);
  });
});

describe("superfície pública — rascunho", () => {
  it("salva parcial, não exige obrigatórias e NÃO marca como SUBMITTED", async () => {
    const seeded = seedForPublic();
    seeded.prisma.satisfactionSurveyCampaign.rows[0].questions = V1_QUESTIONS;
    const service = createSatisfactionPublicService({ prisma: seeded.prisma });
    const session = await service.exchangeToken(seeded.token);
    const sessionToken = (session as { sessionToken: string }).sessionToken;

    const result = await service.saveDraft(sessionToken, {
      answers: [{ questionCode: "PRODUCT_QUALITY", ratingValue: 4 }],
      respondentName: "Parcial",
      respondentPhone: null,
      expectedVersion: null,
    });

    assert.equal(result.ok, true);
    const response = seeded.prisma.satisfactionSurveyResponse.rows[0];
    assert.equal(response.status, "DRAFT", "rascunho nunca nasce SUBMITTED");
    assert.ok(seeded.prisma.satisfactionSurveyInvitation.rows[0].startedAt);
  });

  it("versão desatualizada é recusada em vez de sobrescrever (CAS)", async () => {
    const seeded = seedForPublic();
    seeded.prisma.satisfactionSurveyCampaign.rows[0].questions = V1_QUESTIONS;
    const service = createSatisfactionPublicService({ prisma: seeded.prisma });
    const session = await service.exchangeToken(seeded.token);
    const sessionToken = (session as { sessionToken: string }).sessionToken;

    await service.saveDraft(sessionToken, {
      answers: [{ questionCode: "PRODUCT_QUALITY", ratingValue: 4 }],
      respondentName: null,
      respondentPhone: null,
      expectedVersion: null,
    });

    const stale = await service.saveDraft(sessionToken, {
      answers: [{ questionCode: "PRODUCT_QUALITY", ratingValue: 1 }],
      respondentName: null,
      respondentPhone: null,
      expectedVersion: 0,
    });

    assert.equal(stale.ok, false);
    assert.equal((stale as { reason: string }).reason, "VERSION_CONFLICT");
    const answer = seeded.prisma.satisfactionSurveyAnswer.rows[0];
    assert.equal(answer.ratingValue, 4, "a gravação velha não pode sobrescrever a nova");
  });
});

describe("superfície pública — identificação vinda do cadastro (link individual)", () => {
  /** Questionário com os campos de identificação do V1, além dos avaliativos. */
  const IDENTITY_QUESTIONS = [
    { id: "q-name", code: "CUSTOMER_NAME", label: "Cliente", type: "SHORT_TEXT", sortOrder: 1, required: true, scaleMin: null, scaleMax: null, helpText: null },
    { id: "q-tax", code: "TAX_ID", label: "CNPJ", type: "TAX_ID", sortOrder: 2, required: false, scaleMin: null, scaleMax: null, helpText: null },
    { id: "q-resp", code: "RESPONDENT_NAME", label: "Responsável", type: "SHORT_TEXT", sortOrder: 3, required: true, scaleMin: null, scaleMax: null, helpText: null },
    ...V1_QUESTIONS.map((q, i) => ({ ...q, sortOrder: 4 + i })),
  ];

  async function openIdentitySession() {
    const seeded = seedForPublic();
    seeded.prisma.satisfactionSurveyCampaign.rows[0].questions = IDENTITY_QUESTIONS;
    const service = createSatisfactionPublicService({ prisma: seeded.prisma });
    const session = await service.exchangeToken(seeded.token);
    return {
      ...seeded,
      service,
      sessionToken: (session as { sessionToken: string }).sessionToken,
    };
  }

  it("getForm devolve o prefill travado com nome e CNPJ do snapshot", async () => {
    const { service, sessionToken } = await openIdentitySession();
    const form = await service.getForm(sessionToken, null);
    assert.equal(form.ok, true);
    const prefill = (form as any).form.identificationPrefill as Array<{
      questionCode: string;
      textValue: string;
      locked: boolean;
    }>;
    assert.deepEqual(
      prefill.map((p) => [p.questionCode, p.textValue, p.locked]),
      [
        ["CUSTOMER_NAME", "Metalúrgica Alfa", true],
        ["TAX_ID", "12345678000190", true],
      ]
    );
  });

  it("ELIMINATÓRIO: adulterar o nome da empresa no submit é DESCARTADO — grava o snapshot", async () => {
    const { prisma, service, sessionToken } = await openIdentitySession();
    const result = await service.submit(sessionToken, {
      answers: [
        // Cliente tenta se passar por outra empresa via devtools:
        { questionCode: "CUSTOMER_NAME", textValue: "Empresa Falsa LTDA" },
        { questionCode: "TAX_ID", textValue: "99999999999999" },
        { questionCode: "RESPONDENT_NAME", textValue: "João" },
        { questionCode: "PRODUCT_QUALITY", ratingValue: 5 },
        { questionCode: "DELIVERY_DEADLINE", ratingValue: 4 },
        { questionCode: "OPEN_FEEDBACK", textValue: "ok" },
      ],
      respondentName: "João",
      respondentPhone: "11999990000",
      declaredCompanyName: null,
      declaredTaxId: null,
      idempotencyKey: "k-tamper",
      turnstileToken: null,
    });
    assert.equal(result.ok, true);

    const byQuestion = new Map(
      prisma.satisfactionSurveyAnswer.rows.map((a: Record<string, unknown>) => [
        a.questionId,
        a,
      ])
    );
    assert.equal(
      (byQuestion.get("q-name") as { textValue: string }).textValue,
      "Metalúrgica Alfa",
      "o nome gravado deve vir do cadastro, não do payload"
    );
    assert.equal(
      (byQuestion.get("q-tax") as { textValue: string }).textValue,
      "12345678000190",
      "o CNPJ gravado deve vir do cadastro, não do payload"
    );
  });

  it("cliente NÃO precisa enviar nome/CNPJ no link individual — required satisfeito pelo cadastro", async () => {
    const { prisma, service, sessionToken } = await openIdentitySession();
    const result = await service.submit(sessionToken, {
      answers: [
        // Só o que o cliente realmente preenche:
        { questionCode: "RESPONDENT_NAME", textValue: "Maria" },
        { questionCode: "PRODUCT_QUALITY", ratingValue: 5 },
        { questionCode: "DELIVERY_DEADLINE", ratingValue: 5 },
        { questionCode: "OPEN_FEEDBACK", textValue: "excelente" },
      ],
      respondentName: "Maria",
      respondentPhone: "11888887777",
      declaredCompanyName: null,
      declaredTaxId: null,
      idempotencyKey: "k-minimal",
      turnstileToken: null,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    const name = prisma.satisfactionSurveyAnswer.rows.find(
      (a: Record<string, unknown>) => a.questionId === "q-name"
    ) as { textValue: string };
    assert.equal(name.textValue, "Metalúrgica Alfa");
  });

  it("o rascunho também recebe a identidade do cadastro (retomada consistente)", async () => {
    const { prisma, service, sessionToken } = await openIdentitySession();
    const result = await service.saveDraft(sessionToken, {
      answers: [{ questionCode: "PRODUCT_QUALITY", ratingValue: 3 }],
      respondentName: null,
      respondentPhone: null,
      expectedVersion: null,
    });
    assert.equal(result.ok, true);
    const name = prisma.satisfactionSurveyAnswer.rows.find(
      (a: Record<string, unknown>) => a.questionId === "q-name"
    ) as { textValue: string } | undefined;
    assert.equal(name?.textValue, "Metalúrgica Alfa");
  });

  it("link geral NÃO tem prefill — o cliente se identifica", async () => {
    const seeded = seedForPublic();
    seeded.prisma.satisfactionSurveyCampaign.rows[0].questions = IDENTITY_QUESTIONS;
    // Token geral: sem convite.
    seeded.prisma.satisfactionSurveyAccessToken.rows[0].invitationId = null;
    seeded.prisma.satisfactionSurveyAccessToken.rows[0].invitation = null;
    seeded.prisma.satisfactionSurveyAccessToken.rows[0].kind = "GENERAL";
    const service = createSatisfactionPublicService({ prisma: seeded.prisma });
    const session = await service.exchangeToken(seeded.token);
    const form = await service.getForm(
      (session as { sessionToken: string }).sessionToken,
      null
    );
    assert.equal(form.ok, true);
    assert.deepEqual((form as any).form.identificationPrefill, []);
    assert.equal((form as any).form.requiresSelfIdentification, true);
  });
});

describe("superfície pública — identidade visual no formulário", () => {
  const LOGO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";

  async function openWithBranding(brandingRows: Record<string, unknown>[]) {
    const seeded = seedForPublic();
    seeded.prisma.satisfactionSurveyCampaign.rows[0].questions = V1_QUESTIONS;
    (seeded.prisma as Record<string, any>).brandingSettings = {
      findFirst: async () => brandingRows[0] ?? null,
    };
    const service = createSatisfactionPublicService({ prisma: seeded.prisma });
    const session = await service.exchangeToken(seeded.token);
    return service.getForm((session as { sessionToken: string }).sessionToken, null);
  }

  it("logo expandida do cadastro viaja no DTO como data URL", async () => {
    const form = await openWithBranding([
      { systemExpandedLogoDataUrl: LOGO, companyName: "Lazarios Koppetel" },
    ]);
    assert.equal(form.ok, true);
    assert.deepEqual((form as any).form.branding, {
      logoDataUrl: LOGO,
      companyName: "Lazarios Koppetel",
    });
  });

  it("ELIMINATÓRIO: valor que não é data:image/* é descartado (nunca vira src)", async () => {
    for (const bad of [
      "javascript:alert(1)",
      "https://externo.exemplo.com/logo.png",
      "data:text/html;base64,PHNjcmlwdD4=",
    ]) {
      const form = await openWithBranding([
        { systemExpandedLogoDataUrl: bad, companyName: "X" },
      ]);
      assert.equal(form.ok, true);
      assert.equal(
        (form as any).form.branding.logoDataUrl,
        null,
        `valor inseguro aceito: ${bad}`
      );
    }
  });

  it("sem branding configurado (ou consulta falhando) o formulário abre normalmente", async () => {
    // seedForPublic não tem a collection brandingSettings — a consulta lança
    // e o fail-soft precisa segurar.
    const seeded = seedForPublic();
    seeded.prisma.satisfactionSurveyCampaign.rows[0].questions = V1_QUESTIONS;
    const service = createSatisfactionPublicService({ prisma: seeded.prisma });
    const session = await service.exchangeToken(seeded.token);
    const form = await service.getForm(
      (session as { sessionToken: string }).sessionToken,
      null
    );
    assert.equal(form.ok, true, "a logo nunca pode impedir o formulário de abrir");
    assert.deepEqual((form as any).form.branding, {
      logoDataUrl: null,
      companyName: null,
    });
  });
});

describe("responsável comercial — nome pelo motor oficial, nunca o placeholder", () => {
  it('detecta os placeholders reais ("Vendedor ID 464" etc.)', async () => {
    const { isSellerPlaceholderName } = await import(
      "./satisfactionSellerDisplay.server.js"
    );
    assert.equal(isSellerPlaceholderName("Vendedor ID 464"), true);
    assert.equal(isSellerPlaceholderName("vendedor id 7"), true);
    assert.equal(isSellerPlaceholderName("Vendedor Nomus não mapeado: ID 464"), true);
    // Nomes legítimos nunca podem ser tratados como placeholder:
    assert.equal(isSellerPlaceholderName("Ana Vendedora"), false);
    assert.equal(isSellerPlaceholderName("Carlos ID Silva"), false);
    assert.equal(isSellerPlaceholderName(null), false);
  });

  it("resolve pelo motor oficial quando o vendedor está mapeado; placeholder vira null quando não está", async () => {
    const { resolveSatisfactionResponsibleNames } = await import(
      "./satisfactionSellerDisplay.server.js"
    );
    const prisma = {
      commissionPerson: {
        findMany: async () => [
          {
            id: "cp-1",
            nomusPersonId: 464,
            name: "Ana Vendedora",
            type: "SELLER",
            source: "NOMUS",
            active: true,
            createdAt: new Date("2025-01-01"),
            _count: { commissionRecords: 0 },
          },
        ],
      },
      commissionPersonAlias: { findMany: async () => [] },
    } as never;

    const mapped = {
      responsibleCommercialIdSnapshot: 464,
      responsibleCommercialNameSnapshot: "Vendedor ID 464",
    };
    const unmapped = {
      responsibleCommercialIdSnapshot: 999,
      responsibleCommercialNameSnapshot: "Vendedor ID 999",
    };
    const legacyName = {
      responsibleCommercialIdSnapshot: null,
      responsibleCommercialNameSnapshot: "Carlos Antigo",
    };

    const names = await resolveSatisfactionResponsibleNames(prisma, [
      mapped,
      unmapped,
      legacyName,
    ]);

    assert.equal(
      names.get(mapped),
      "Ana Vendedora",
      "mapeado: o motor oficial vence o snapshot placeholder"
    );
    assert.equal(
      names.get(unmapped),
      null,
      'não mapeado: "Vendedor ID 999" nunca aparece como nome — a UI mostra "—"'
    );
    assert.equal(
      names.get(legacyName),
      "Carlos Antigo",
      "snapshot legítimo continua valendo quando não há id para resolver"
    );
  });

  it("falha ao carregar o contexto não derruba a listagem (cai no snapshot)", async () => {
    const { resolveSatisfactionResponsibleNames } = await import(
      "./satisfactionSellerDisplay.server.js"
    );
    const prisma = {
      commissionPerson: { findMany: async () => { throw new Error("db off"); } },
      commissionPersonAlias: { findMany: async () => [] },
    } as never;
    const row = {
      responsibleCommercialIdSnapshot: 464,
      responsibleCommercialNameSnapshot: "Nome Legitimo Salvo",
    };
    const names = await resolveSatisfactionResponsibleNames(prisma, [row]);
    assert.equal(names.get(row), "Nome Legitimo Salvo");
  });
});
