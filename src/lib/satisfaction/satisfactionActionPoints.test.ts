/**
 * Satisfação — action points: contrato puro e regras do serviço (Prisma fake).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canManageActionPoints,
  isActionPointOverdue,
  parseActionPointInput,
  parseDateOnly,
} from "./satisfactionActionPoints.js";
import { SatisfactionContractError } from "./satisfactionContracts.js";
import { createSatisfactionActionPointService } from "./satisfactionActionPointService.server.js";
import { SatisfactionDomainError } from "./satisfactionCampaignService.server.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";

const validBody = {
  responsibleUserId: USER_ID,
  actionPlan: "Visitar o cliente e revisar o prazo de entrega.",
  dueDate: "2026-11-15",
};

describe("action point — contrato", () => {
  it("só pesquisa encerrada ou arquivada tem action points", () => {
    assert.equal(canManageActionPoints("CLOSED"), true);
    assert.equal(canManageActionPoints("ARCHIVED"), true);
    assert.equal(canManageActionPoints("OPEN"), false);
    assert.equal(canManageActionPoints("DRAFT"), false);
    assert.equal(canManageActionPoints("SCHEDULED"), false);
  });

  it("aplica os padrões: prioridade média e situação aberta", () => {
    const input = parseActionPointInput(validBody);
    assert.equal(input.priority, "MEDIUM");
    assert.equal(input.status, "OPEN");
    assert.equal(input.dueDate.toISOString(), "2026-11-15T00:00:00.000Z");
    assert.equal(input.rootCause, null);
    assert.equal(input.customerFeedbackAt, null);
  });

  it("exige responsável, plano de ação e data limite", () => {
    for (const field of ["responsibleUserId", "actionPlan", "dueDate"] as const) {
      assert.throws(
        () => parseActionPointInput({ ...validBody, [field]: "" }),
        (err: unknown) => err instanceof SatisfactionContractError && err.field === field
      );
    }
  });

  it("rejeita data inexistente e formato fora de AAAA-MM-DD", () => {
    assert.equal(parseDateOnly("2026-02-30"), null);
    assert.equal(parseDateOnly("15/11/2026"), null);
    assert.equal(parseDateOnly("2026-11-15T10:00:00Z"), null);
  });

  it("concluir exige o resultado da ação", () => {
    assert.throws(
      () => parseActionPointInput({ ...validBody, status: "DONE" }),
      (err: unknown) => err instanceof SatisfactionContractError && err.field === "resultNotes"
    );
    const done = parseActionPointInput({
      ...validBody,
      status: "DONE",
      resultNotes: "Prazo renegociado.",
    });
    assert.equal(done.status, "DONE");
  });

  it("atraso: prazo vencido só conta enquanto não concluído/cancelado", () => {
    const today = "2026-11-16";
    assert.equal(isActionPointOverdue({ status: "OPEN", dueDate: "2026-11-15" }, today), true);
    assert.equal(
      isActionPointOverdue({ status: "IN_PROGRESS", dueDate: "2026-11-16" }, today),
      false
    );
    assert.equal(isActionPointOverdue({ status: "DONE", dueDate: "2026-11-01" }, today), false);
    assert.equal(
      isActionPointOverdue({ status: "CANCELLED", dueDate: "2026-11-01" }, today),
      false
    );
  });
});

function fakePrisma(overrides: {
  campaignStatus?: string;
  rating?: number;
  customerId?: string | null;
  userActive?: boolean;
}) {
  const upserts: unknown[] = [];
  const prisma = {
    satisfactionSurveyAnswer: {
      findUnique: async () => ({
        id: "answer-1",
        ratingValue: overrides.rating ?? 1,
        response: {
          status: "SUBMITTED",
          customerId: overrides.customerId === undefined ? "cust-1" : overrides.customerId,
          campaign: { id: "camp-1", status: overrides.campaignStatus ?? "CLOSED", deletedAt: null },
        },
        actionPoint: null,
      }),
    },
    appUser: {
      findUnique: async () => ({
        id: USER_ID,
        name: "Maria",
        isActive: overrides.userActive ?? true,
      }),
    },
    satisfactionActionPoint: {
      upsert: async (args: { create: Record<string, unknown> }) => {
        upserts.push(args);
        return {
          id: "ap-1",
          ...args.create,
          updatedAt: new Date("2026-11-01T12:00:00Z"),
        };
      },
    },
    commercialAuditLog: { create: async () => ({}) },
  };
  return { prisma: prisma as never, upserts };
}

describe("action point — serviço", () => {
  const input = parseActionPointInput(validBody);
  const context = { userId: "u-1", allowedCustomerIds: null };

  it("cria o action point de um ponto de atenção de pesquisa encerrada", async () => {
    const { prisma, upserts } = fakePrisma({});
    const service = createSatisfactionActionPointService({ prisma });
    const saved = await service.saveActionPoint("answer-1", input, context);
    assert.equal(upserts.length, 1);
    assert.equal(saved.responsibleName, "Maria");
    assert.equal(saved.dueDate, "2026-11-15");
    assert.equal(saved.status, "OPEN");
    assert.equal(saved.completedAt, null);
  });

  it("pesquisa ainda aberta recusa action point (LOCKED)", async () => {
    const { prisma, upserts } = fakePrisma({ campaignStatus: "OPEN" });
    const service = createSatisfactionActionPointService({ prisma });
    await assert.rejects(
      service.saveActionPoint("answer-1", input, context),
      (err: unknown) => err instanceof SatisfactionDomainError && err.code === "LOCKED"
    );
    assert.equal(upserts.length, 0);
  });

  it("nota não crítica não é ponto de atenção", async () => {
    const { prisma } = fakePrisma({ rating: 3 });
    const service = createSatisfactionActionPointService({ prisma });
    await assert.rejects(
      service.saveActionPoint("answer-1", input, context),
      (err: unknown) => err instanceof SatisfactionDomainError && err.code === "NOT_FOUND"
    );
  });

  it("vendedor restrito não registra action point de cliente fora da carteira", async () => {
    const { prisma, upserts } = fakePrisma({});
    const service = createSatisfactionActionPointService({ prisma });
    await assert.rejects(
      service.saveActionPoint("answer-1", input, { userId: "u-1", allowedCustomerIds: ["outro"] }),
      (err: unknown) => err instanceof SatisfactionDomainError && err.code === "FORBIDDEN"
    );
    assert.equal(upserts.length, 0);
  });

  it("responsável inativo é recusado na criação", async () => {
    const { prisma } = fakePrisma({ userActive: false });
    const service = createSatisfactionActionPointService({ prisma });
    await assert.rejects(
      service.saveActionPoint("answer-1", input, context),
      (err: unknown) => err instanceof SatisfactionDomainError && err.code === "INVALID_STATE"
    );
  });

  it("concluir grava a data de conclusão", async () => {
    const { prisma } = fakePrisma({});
    const service = createSatisfactionActionPointService({
      prisma,
      now: () => new Date("2026-11-10T15:00:00Z"),
    });
    const saved = await service.saveActionPoint(
      "answer-1",
      parseActionPointInput({ ...validBody, status: "DONE", resultNotes: "Resolvido." }),
      context
    );
    assert.equal(saved.completedAt, "2026-11-10T15:00:00.000Z");
    assert.equal(saved.overdue, false);
  });
});
