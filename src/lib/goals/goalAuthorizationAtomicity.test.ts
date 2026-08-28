/**
 * Metas (OKR) — P0-B: autorização por objeto, atomicidade e estado canônico
 * da medição, provados contra um banco FAKE em memória com transações que
 * revertem de verdade (snapshot do estado antes, restauração no throw).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PrismaClient } from "@prisma/client";
import {
  canActorEditGoal,
  canActorEditKeyResult,
  canActorTouchInitiative,
  createGoalService,
  sanitizeGoalMeasurementError,
  GoalDomainError,
  type GoalActor,
} from "./goalService.server.js";
import { GoalContractError } from "./goalContracts.js";

const OWNER_GOAL = "11111111-1111-4111-8111-111111111111";
const OWNER_KR = "22222222-2222-4222-8222-222222222222";
const STRANGER = "33333333-3333-4333-8333-333333333333";
const MANAGER = "44444444-4444-4444-8444-444444444444";

const actorOwnerGoal: GoalActor = { userId: OWNER_GOAL, canManage: false };
const actorOwnerKr: GoalActor = { userId: OWNER_KR, canManage: false };
const actorStranger: GoalActor = { userId: STRANGER, canManage: false };
const actorManager: GoalActor = { userId: MANAGER, canManage: true };

const VALID_RULE = { entityKey: "SALES_ORDERS", metricKey: "SALES_NET_TOTAL", filters: [] };

// ─── Fake DB ────────────────────────────────────────────────────────────────

import { createFakeGoalDb } from "./goalServiceFakeDb.js";

const createFakeDb = createFakeGoalDb;

function krCreateInput(overrides: Record<string, unknown> = {}) {
  return {
    title: "Indicador novo",
    domain: "COMERCIAL" as const,
    trackingType: "INCREASE" as const,
    baseline: "0",
    target: "1000",
    unit: null,
    weight: "1",
    ownerAppUserId: OWNER_KR,
    rule: null,
    startDate: null,
    endDate: null,
    targetBasis: "MANUAL" as const,
    comparison: null,
    ...overrides,
  };
}

// ─── Política pura ──────────────────────────────────────────────────────────

describe("autorização por objeto — política pura", () => {
  const goal = { ownerAppUserId: OWNER_GOAL };
  const kr = { ownerAppUserId: OWNER_KR, goal };

  it("Goal: dono edita o próprio; não relacionado (mesmo com update) não; manage sempre", () => {
    assert.equal(canActorEditGoal(actorOwnerGoal, goal), true);
    assert.equal(canActorEditGoal(actorStranger, goal), false);
    assert.equal(canActorEditGoal(actorOwnerKr, goal), false);
    assert.equal(canActorEditGoal(actorManager, goal), true);
  });

  it("KR: dono do KR OU dono do Goal pai; não relacionado não; manage sempre", () => {
    assert.equal(canActorEditKeyResult(actorOwnerKr, kr), true);
    assert.equal(canActorEditKeyResult(actorOwnerGoal, kr), true);
    assert.equal(canActorEditKeyResult(actorStranger, kr), false);
    assert.equal(canActorEditKeyResult(actorManager, kr), true);
  });

  it("iniciativa: owners/manage sempre; assignee só no fluxo operacional (nunca excluir)", () => {
    const links = {
      goalOwnerAppUserId: OWNER_GOAL,
      keyResultOwnerAppUserId: OWNER_KR,
      assigneeAppUserId: STRANGER,
    };
    assert.equal(canActorTouchInitiative(actorOwnerGoal, links, { allowAssignee: false }), true);
    assert.equal(canActorTouchInitiative(actorOwnerKr, links, { allowAssignee: false }), true);
    assert.equal(canActorTouchInitiative(actorManager, links, { allowAssignee: false }), true);
    // Assignee: atualizar (fluxo) sim; excluir não.
    assert.equal(canActorTouchInitiative(actorStranger, links, { allowAssignee: true }), true);
    assert.equal(canActorTouchInitiative(actorStranger, links, { allowAssignee: false }), false);
    // Sem vínculo nenhum: nada.
    const unrelated = { ...links, assigneeAppUserId: null };
    assert.equal(canActorTouchInitiative(actorStranger, unrelated, { allowAssignee: true }), false);
  });
});

describe("autorização por objeto — aplicada pelo service (acesso direto à API bloqueado)", () => {
  it("updateGoal: não relacionado com update → FORBIDDEN; dono e manage passam", async () => {
    const db = createFakeDb();
    const goal = db.seedGoal();
    const service = createGoalService({ prisma: db.client });

    await assert.rejects(
      () => service.updateGoal(goal.id as string, { title: "Hack" }, actorStranger),
      (e: unknown) => e instanceof GoalDomainError && e.code === "FORBIDDEN"
    );
    assert.equal(db.state.goals.get(goal.id as string)!.title, "Objetivo");

    const byOwner = await service.updateGoal(goal.id as string, { title: "Do dono" }, actorOwnerGoal);
    assert.equal(byOwner.title, "Do dono");
    const byManager = await service.updateGoal(goal.id as string, { title: "Do gestor" }, actorManager);
    assert.equal(byManager.title, "Do gestor");
  });

  it("updateKeyResult: dono do KR pode; dono do Goal pode; estranho não", async () => {
    const db = createFakeDb();
    const goal = db.seedGoal();
    const kr = db.seedKr(goal.id as string);
    const service = createGoalService({ prisma: db.client });

    await assert.rejects(
      () => service.updateKeyResult(kr.id as string, { title: "Hack" }, actorStranger),
      (e: unknown) => e instanceof GoalDomainError && e.code === "FORBIDDEN"
    );
    const byKrOwner = await service.updateKeyResult(kr.id as string, { title: "KR owner" }, actorOwnerKr);
    assert.equal(byKrOwner.title, "KR owner");
    const byGoalOwner = await service.updateKeyResult(
      kr.id as string,
      { title: "Goal owner" },
      actorOwnerGoal
    );
    assert.equal(byGoalOwner.title, "Goal owner");
  });

  it("valor manual e quotas seguem a mesma política do KR; sem ator (job interno) segue permitido", async () => {
    const db = createFakeDb();
    const goal = db.seedGoal();
    const kr = db.seedKr(goal.id as string);
    const service = createGoalService({ prisma: db.client });

    await assert.rejects(
      () => service.setAchievedValue(kr.id as string, { achievedValue: "10" }, undefined, actorStranger),
      (e: unknown) => e instanceof GoalDomainError && e.code === "FORBIDDEN"
    );
    await assert.rejects(
      () => service.setQuotas(kr.id as string, [], actorStranger),
      (e: unknown) => e instanceof GoalDomainError && e.code === "FORBIDDEN"
    );
    const ok = await service.setAchievedValue(
      kr.id as string,
      { achievedValue: "10" },
      undefined,
      actorOwnerKr
    );
    assert.equal(ok.achievedValue, "10");
    // Chamador interno (scripts/jobs) sem ator não é bloqueado.
    const internal = await service.setAchievedValue(kr.id as string, { achievedValue: "20" });
    assert.equal(internal.achievedValue, "20");
  });

  it("deleteGoal/deleteKeyResult com ator exigem manage", async () => {
    const db = createFakeDb();
    const goal = db.seedGoal();
    const kr = db.seedKr(goal.id as string);
    const service = createGoalService({ prisma: db.client });
    await assert.rejects(
      () => service.deleteKeyResult(kr.id as string, actorOwnerGoal),
      (e: unknown) => e instanceof GoalDomainError && e.code === "FORBIDDEN"
    );
    await assert.rejects(
      () => service.deleteGoal(goal.id as string, actorOwnerGoal),
      (e: unknown) => e instanceof GoalDomainError && e.code === "FORBIDDEN"
    );
  });
});

// ─── Atomicidade ────────────────────────────────────────────────────────────

describe("transações — nada fica parcialmente aplicado", () => {
  it("período do Goal: falha no aparo dos KRs desfaz TAMBÉM o update do Goal", async () => {
    const db = createFakeDb({ failOnKrUpdateMany: () => true });
    const goal = db.seedGoal();
    const service = createGoalService({ prisma: db.client });

    await assert.rejects(() =>
      service.updateGoal(
        goal.id as string,
        { title: "Novo título", startDate: "2026-03-01", endDate: "2026-06-30" },
        actorOwnerGoal
      )
    );
    const after = db.state.goals.get(goal.id as string)!;
    assert.equal(after.title, "Objetivo", "título não pode ficar aplicado");
    assert.equal(
      (after.startDate as Date).toISOString().slice(0, 10),
      "2026-01-01",
      "período não pode ficar aplicado"
    );
  });

  it("sucesso: Goal + aparo + releitura coerentes na mesma transação", async () => {
    const db = createFakeDb();
    const goal = db.seedGoal();
    const service = createGoalService({ prisma: db.client });
    const dto = await service.updateGoal(
      goal.id as string,
      { startDate: "2026-02-01", endDate: "2026-11-30" },
      actorManager
    );
    assert.equal(dto.startDate, "2026-02-01");
    assert.equal(dto.endDate, "2026-11-30");
  });

  it("criação KR + quotas: quota inválida (Σ > alvo) → indicador NÃO nasce", async () => {
    const db = createFakeDb();
    const goal = db.seedGoal();
    const service = createGoalService({ prisma: db.client });
    await assert.rejects(
      () =>
        service.createKeyResultWithQuotas(
          goal.id as string,
          krCreateInput(),
          [{ assignedAppUserId: OWNER_KR, quotaValue: "2000" }],
          actorOwnerGoal
        ),
      (e: unknown) => e instanceof GoalDomainError && e.code === "VALIDATION_ERROR"
    );
    assert.equal(db.state.krs.size, 0, "nenhum KR pode ter sido criado");
    assert.equal(db.state.quotas.length, 0);
  });

  it("criação KR + quotas: falha na GRAVAÇÃO da quota desfaz o KR (rollback real)", async () => {
    const db = createFakeDb({ failOnQuotaCreate: () => true });
    const goal = db.seedGoal();
    const service = createGoalService({ prisma: db.client });
    await assert.rejects(() =>
      service.createKeyResultWithQuotas(
        goal.id as string,
        krCreateInput(),
        [{ assignedAppUserId: OWNER_KR, quotaValue: "100" }],
        actorOwnerGoal
      )
    );
    assert.equal(db.state.krs.size, 0, "KR órfão não pode sobreviver ao rollback");
    assert.equal(db.state.quotas.length, 0);
  });

  it("sucesso: KR + quotas nascem juntos e coerentes", async () => {
    const db = createFakeDb();
    const goal = db.seedGoal();
    const service = createGoalService({ prisma: db.client });
    const dto = await service.createKeyResultWithQuotas(
      goal.id as string,
      krCreateInput(),
      [
        { assignedAppUserId: OWNER_KR, quotaValue: "400" },
        { assignedAppUserId: STRANGER, quotaValue: "600" },
      ],
      actorOwnerGoal
    );
    assert.equal(db.state.krs.size, 1);
    assert.equal(db.state.quotas.length, 2);
    assert.equal(dto.quotas.length, 2);
    assert.equal(dto.measurementStatus, "MANUAL");
  });

  it("estranho não cria indicador no objetivo alheio", async () => {
    const db = createFakeDb();
    const goal = db.seedGoal();
    const service = createGoalService({ prisma: db.client });
    await assert.rejects(
      () =>
        service.createKeyResultWithQuotas(goal.id as string, krCreateInput(), [], actorStranger),
      (e: unknown) => e instanceof GoalDomainError && e.code === "FORBIDDEN"
    );
  });
});

// ─── Estado canônico da medição ─────────────────────────────────────────────

describe("medição — MANUAL/PENDING/OK/ERROR sem ambiguidade", () => {
  it("automático: primeira medição com sucesso → OK, timestamp, valor do motor", async () => {
    const db = createFakeDb({ ruleValue: () => "750" });
    const goal = db.seedGoal();
    const service = createGoalService({ prisma: db.client });
    const dto = await service.createKeyResultWithQuotas(
      goal.id as string,
      krCreateInput({ rule: VALID_RULE }),
      [],
      actorOwnerGoal
    );
    assert.equal(dto.measurementStatus, "OK");
    assert.equal(dto.achievedValue, "750");
    assert.ok(dto.lastMeasurementAt, "última leitura válida registrada");
    assert.equal(dto.lastMeasurementError, null);
    assert.equal(dto.firstMeasurementFailed, undefined);
  });

  it("automático: primeira medição FALHA → ERROR + mensagem sanitizada; valor segue a baseline (não é zero medido)", async () => {
    const db = createFakeDb({ ruleFails: () => true });
    const goal = db.seedGoal();
    const service = createGoalService({ prisma: db.client });
    const dto = await service.createKeyResultWithQuotas(
      goal.id as string,
      krCreateInput({ rule: VALID_RULE, baseline: "100", target: "1000" }),
      [],
      actorOwnerGoal
    );
    assert.equal(dto.measurementStatus, "ERROR");
    assert.equal(dto.firstMeasurementFailed, true);
    assert.equal(dto.achievedValue, "100", "baseline preservada — nunca zero inventado");
    assert.ok(dto.lastMeasurementError, "mensagem de falha registrada");
    assert.equal(dto.lastMeasurementAt, null, "sem leitura válida ainda");
  });

  it("automático com medição BLOQUEADA (lock) → permanece PENDING", async () => {
    const db = createFakeDb({ locked: () => false });
    const goal = db.seedGoal();
    const service = createGoalService({ prisma: db.client });
    const dto = await service.createKeyResultWithQuotas(
      goal.id as string,
      krCreateInput({ rule: VALID_RULE }),
      [],
      actorOwnerGoal
    );
    assert.equal(dto.measurementStatus, "PENDING");
    assert.equal(dto.firstMeasurementFailed, true);
  });

  it("refresh que FALHA após valor válido: mantém o valor anterior, status ERROR; sucesso posterior limpa o erro", async () => {
    let fail = true;
    const db = createFakeDb({ ruleFails: () => fail, ruleValue: () => "900" });
    const goal = db.seedGoal();
    const kr = db.seedKr(goal.id as string, {
      manualTracking: false,
      ruleJson: VALID_RULE,
      achievedValue: "500",
      measurementStatus: "OK",
      lastMeasurementAt: new Date("2026-08-27T12:00:00.000Z"),
    });
    const service = createGoalService({ prisma: db.client });

    await assert.rejects(
      () => service.refreshKeyResult(kr.id as string),
      (e: unknown) => e instanceof GoalDomainError && e.code === "MEASUREMENT_FAILED"
    );
    const afterFail = db.state.krs.get(kr.id as string)!;
    assert.equal(afterFail.achievedValue, "500", "último valor VÁLIDO preservado");
    assert.equal(afterFail.measurementStatus, "ERROR");
    assert.ok(afterFail.lastMeasurementError);

    fail = false;
    const ok = await service.refreshKeyResult(kr.id as string);
    assert.equal(ok.achievedValue, "900");
    assert.equal(ok.measurementStatus, "OK");
    assert.equal(ok.lastMeasurementError, null);
  });

  it("dois refreshs concorrentes: o segundo recebe BUSY e NADA é medido duas vezes", async () => {
    const db = createFakeDb({ locked: () => false });
    const goal = db.seedGoal();
    const kr = db.seedKr(goal.id as string, {
      manualTracking: false,
      ruleJson: VALID_RULE,
      achievedValue: "500",
      measurementStatus: "OK",
    });
    const service = createGoalService({ prisma: db.client });
    await assert.rejects(
      () => service.refreshKeyResult(kr.id as string),
      (e: unknown) => e instanceof GoalDomainError && e.code === "BUSY"
    );
    const after = db.state.krs.get(kr.id as string)!;
    assert.equal(after.achievedValue, "500");
    assert.equal(after.measurementStatus, "OK", "BUSY não é falha de medição");
  });

  it("job diário usa a MESMA semântica (OK/ERROR) e o snapshot diário é idempotente", async () => {
    const db = createFakeDb({ ruleValue: () => "321" });
    const goal = db.seedGoal();
    db.seedKr(goal.id as string, { manualTracking: false, ruleJson: VALID_RULE });
    db.seedKr(goal.id as string, { title: "Manual", manualTracking: true });
    const service = createGoalService({ prisma: db.client });

    const now = new Date("2026-08-28T15:00:00.000Z");
    const first = await service.runDailySnapshots(now);
    assert.equal(first.computed, 1);
    assert.equal(first.manualSnapshotted, 1);
    assert.equal(first.failures.length, 0);
    const snapshotCountAfterFirst = db.state.snapshots.size;

    // Reexecutar o job no MESMO dia não duplica retratos (upsert).
    const second = await service.runDailySnapshots(now);
    assert.equal(second.computed, 1);
    assert.equal(db.state.snapshots.size, snapshotCountAfterFirst);

    const autoKr = [...db.state.krs.values()].find((k) => k.manualTracking === false)!;
    const manualKr = [...db.state.krs.values()].find((k) => k.manualTracking === true)!;
    assert.equal(autoKr.measurementStatus, "OK");
    assert.equal(manualKr.measurementStatus, "MANUAL");
  });

  it("job diário: falha de um KR vira failure sanitizada + estado ERROR, sem parar os demais", async () => {
    const db = createFakeDb({ ruleFails: () => true });
    const goal = db.seedGoal();
    const auto = db.seedKr(goal.id as string, {
      manualTracking: false,
      ruleJson: VALID_RULE,
      achievedValue: "42",
    });
    db.seedKr(goal.id as string, { title: "Manual", manualTracking: true });
    const service = createGoalService({ prisma: db.client });
    const result = await service.runDailySnapshots(new Date());
    assert.equal(result.computed, 0);
    assert.equal(result.manualSnapshotted, 1, "o manual seguiu apesar da falha do automático");
    assert.equal(result.failures.length, 1);
    assert.ok(!/SELECT|s3cr3t|pg_shadow/i.test(result.failures[0]!.message));
    const after = db.state.krs.get(auto.id as string)!;
    assert.equal(after.measurementStatus, "ERROR");
    assert.equal(after.achievedValue, "42", "valor anterior preservado");
  });
});

// ─── Sanitização ────────────────────────────────────────────────────────────

describe("sanitização do erro de medição", () => {
  it("erros de domínio/contrato preservam a frase pt-BR; erro cru NUNCA vaza SQL/segredo", () => {
    assert.equal(
      sanitizeGoalMeasurementError(new GoalDomainError("VALIDATION_ERROR", "Regra inválida.")),
      "Regra inválida."
    );
    assert.equal(
      sanitizeGoalMeasurementError(new GoalContractError("Campo obrigatório.")),
      "Campo obrigatório."
    );
    const dirty = sanitizeGoalMeasurementError(
      new Error("FATAL: SELECT passwd FROM pg_shadow -- token=abc123")
    );
    assert.ok(!/SELECT|pg_shadow|token|abc123/i.test(dirty));
    assert.ok(dirty.length > 0 && dirty.length <= 300);
  });

  it("erro persistido no fake nunca contém o texto cru do banco", async () => {
    const db = createFakeDb({ ruleFails: () => true });
    const goal = db.seedGoal();
    const kr = db.seedKr(goal.id as string, {
      manualTracking: false,
      ruleJson: VALID_RULE,
    });
    const service = createGoalService({ prisma: db.client });
    await assert.rejects(() => service.refreshKeyResult(kr.id as string));
    const stored = String(db.state.krs.get(kr.id as string)!.lastMeasurementError);
    assert.ok(!/SELECT|pg_shadow|s3cr3t|ECONNREFUSED/i.test(stored));
  });
});
