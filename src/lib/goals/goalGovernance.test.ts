/**
 * Metas (OKR) — P3: governança, versões do compromisso e auditoria.
 *
 * "72% em 10/06 era 72% de QUAL compromisso?" — estas provas garantem que a
 * resposta existe: versão inicial no nascimento, versão nova a cada mudança
 * relevante, histórico imutável, snapshots antigos com contexto preservado,
 * archive/delete coerentes com o histórico e DONE nunca inferido.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { createGoalService, type GoalActor } from "./goalService.server.js";
import { createFakeGoalDb } from "./goalServiceFakeDb.js";

const OWNER_GOAL = "11111111-1111-4111-8111-111111111111";
const MANAGER = "44444444-4444-4444-8444-444444444444";
const actorOwner: GoalActor = { userId: OWNER_GOAL, canManage: false };
const actorManager: GoalActor = { userId: MANAGER, canManage: true };

function krInput(overrides: Record<string, unknown> = {}) {
  return {
    title: "Resultado-chave",
    domain: "COMERCIAL" as const,
    trackingType: "INCREASE" as const,
    baseline: "0",
    target: "1000",
    unit: null,
    weight: "1",
    ownerAppUserId: OWNER_GOAL,
    rule: null,
    startDate: null,
    endDate: null,
    targetBasis: "MANUAL" as const,
    comparison: null,
    ...overrides,
  };
}

describe("versões do compromisso — nascimento e mudança", () => {
  it("todo KR nasce com a versão inicial (1, source CREATE) na MESMA transação", async () => {
    const db = createFakeGoalDb({
      userNames: new Map([[OWNER_GOAL, "Paulo"]]),
    });
    const goal = db.seedGoal();
    const service = createGoalService({ prisma: db.client });
    const dto = await service.createKeyResultWithQuotas(
      goal.id as string,
      krInput(),
      [],
      actorOwner
    );
    assert.equal(db.state.versions.length, 1);
    const v1 = db.state.versions[0]!;
    assert.equal(v1.version, 1);
    assert.equal(v1.source, "CREATE");
    assert.equal(v1.target, "1000");
    assert.equal(v1.actorUserId, OWNER_GOAL);
    assert.equal(v1.actorName, "Paulo");
    assert.equal(dto.configVersion, 1);
    assert.equal(dto.lastConfigChange, null, "versão inicial não é 'mudança'");
  });

  it("mudar o ALVO cria versão 2 (UPDATE) sem reescrever a versão 1; o DTO conta a história", async () => {
    const db = createFakeGoalDb({ userNames: new Map([[MANAGER, "Gestora"]]) });
    const goal = db.seedGoal();
    const service = createGoalService({ prisma: db.client });
    const created = await service.createKeyResultWithQuotas(
      goal.id as string,
      krInput(),
      [],
      actorOwner
    );

    const updated = await service.updateKeyResult(
      created.id,
      { target: "2000" },
      actorManager
    );

    assert.equal(db.state.versions.length, 2);
    const [v2, v1] = [...db.state.versions].sort(
      (a, b) => Number(b.version) - Number(a.version)
    );
    assert.equal(v1!.target, "1000", "versão antiga NUNCA é reescrita");
    assert.equal(v2!.version, 2);
    assert.equal(v2!.source, "UPDATE");
    assert.equal(v2!.target, "2000");
    assert.equal(updated.configVersion, 2);
    assert.ok(updated.lastConfigChange);
    assert.equal(updated.lastConfigChange!.actorName, "Gestora");
  });

  it("salvar SEM mudança relevante não duplica versão", async () => {
    const db = createFakeGoalDb();
    const goal = db.seedGoal();
    const service = createGoalService({ prisma: db.client });
    const created = await service.createKeyResultWithQuotas(
      goal.id as string,
      krInput(),
      [],
      actorOwner
    );
    const same = await service.updateKeyResult(
      created.id,
      { title: created.title },
      actorOwner
    );
    assert.equal(db.state.versions.length, 1, "nenhuma versão nova");
    assert.equal(same.configVersion, 1);
  });

  it("aparo de período pelo Objetivo pai gera versão SYSTEM com motivo", async () => {
    const db = createFakeGoalDb();
    const goal = db.seedGoal();
    const service = createGoalService({ prisma: db.client });
    await service.createKeyResultWithQuotas(
      goal.id as string,
      krInput({ startDate: "2026-07-01", endDate: "2026-12-31" }),
      [],
      actorOwner
    );
    // O Objetivo encolhe para o 1º semestre → o recorte do KR é aparado.
    await service.updateGoal(
      goal.id as string,
      { startDate: "2026-01-01", endDate: "2026-06-30" },
      actorManager
    );
    const system = db.state.versions.find((v) => v.source === "SYSTEM");
    assert.ok(system, "versão SYSTEM registrando o aparo");
    assert.equal(system!.version, 2);
    assert.match(String(system!.reason), /aparado/i);
  });
});

describe("snapshots antigos preservam o contexto", () => {
  it("progressRatio congelado NUNCA é recalculado com o alvo novo", async () => {
    const db = createFakeGoalDb();
    const goal = db.seedGoal();
    const kr = db.seedKr(goal.id as string, { target: "1000", achievedValue: "720" });
    db.seedSnapshot(kr.id as string, new Date("2026-06-10T00:00:00.000Z"), {
      achievedValue: "720",
      progressRatio: "0.720000",
    });
    const service = createGoalService({ prisma: db.client });
    // O alvo dobra DEPOIS do retrato de 10/06…
    await service.updateKeyResult(kr.id as string, { target: "2000" }, actorManager);
    // …e o histórico continua contando 72% — o compromisso da ÉPOCA.
    const snapshots = await service.listSnapshots(kr.id as string);
    assert.equal(snapshots.length, 1);
    assert.equal(snapshots[0]!.progressRatio, "0.720000");
  });
});

describe("auditoria de Goal e coerência de delete/archive", () => {
  it("mudança relevante do Goal (título/período/owner/status) entra na trilha", async () => {
    const db = createFakeGoalDb();
    const goal = db.seedGoal({ title: "Antes" });
    const service = createGoalService({ prisma: db.client });
    await service.updateGoal(goal.id as string, { title: "Depois" }, actorManager);
    const audit = db.state.audits.find(
      (a) => a.entityType === "GOAL" && a.action === "UPDATE"
    );
    assert.ok(audit, "trilha de auditoria do Goal");
    assert.equal((audit!.beforeJson as { title: string }).title, "Antes");
    assert.equal((audit!.afterJson as { title: string }).title, "Depois");
    assert.equal(audit!.actorUserId, MANAGER);
  });

  it("KR com MUDANÇA de compromisso não pode ser apagado fisicamente — vira archive", async () => {
    const db = createFakeGoalDb();
    const goal = db.seedGoal();
    const service = createGoalService({ prisma: db.client });
    const created = await service.createKeyResultWithQuotas(
      goal.id as string,
      krInput(),
      [],
      actorOwner
    );
    await service.updateKeyResult(created.id, { target: "5000" }, actorManager);
    const result = await service.deleteKeyResult(created.id, actorManager);
    assert.deepEqual(result, { deleted: false, archived: true });
    assert.equal(db.state.versions.length, 2, "archive PRESERVA as versões");
    assert.ok(db.state.krs.has(created.id), "KR arquivado continua existindo");
    assert.ok(db.state.audits.some((a) => a.action === "ARCHIVE"));
  });

  it("KR sem histórico (só a versão inicial, sem snapshot) segue apagável fisicamente", async () => {
    const db = createFakeGoalDb();
    const goal = db.seedGoal();
    const service = createGoalService({ prisma: db.client });
    const created = await service.createKeyResultWithQuotas(
      goal.id as string,
      krInput(),
      [],
      actorOwner
    );
    const result = await service.deleteKeyResult(created.id, actorManager);
    assert.deepEqual(result, { deleted: true, archived: false });
    assert.equal(db.state.krs.size, 0);
    // Versão inicial cai por cascade — só espelhava o que foi apagado.
    assert.equal(db.state.versions.length, 0);
    assert.ok(db.state.audits.some((a) => a.action === "DELETE"));
  });
});

describe("DONE é decisão humana — nunca inferido", () => {
  it("atingir/estourar o alvo NÃO muda o status do KR nem do Goal", async () => {
    const db = createFakeGoalDb({ ruleValue: () => "99999" });
    const goal = db.seedGoal();
    const service = createGoalService({ prisma: db.client });
    const dto = await service.createKeyResultWithQuotas(
      goal.id as string,
      krInput({
        rule: { entityKey: "SALES_ORDERS", metricKey: "SALES_NET_TOTAL", filters: [] },
        target: "1000",
      }),
      [],
      actorOwner
    );
    assert.equal(dto.progressPercent, 100, "estourou o alvo → 100% (clamp)");
    assert.equal(dto.status, "ACTIVE", "100% atingido ≠ encerrado");
    assert.equal(db.state.goals.get(goal.id as string)!.status, "ACTIVE");
  });

  it("fonte: o service nunca atribui DONE por conta própria", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, "goalService.server.ts"), "utf8");
    assert.ok(
      !/status:\s*"DONE"/.test(source),
      "nenhuma atribuição automática de DONE no service"
    );
  });
});

describe("job diário — resumo operacional", () => {
  it("devolve duração e contagens sem dado sensível; ARCHIVED/DONE ficam fora", async () => {
    const db = createFakeGoalDb({ ruleValue: () => "10" });
    const goal = db.seedGoal();
    db.seedKr(goal.id as string, { manualTracking: true });
    db.seedKr(goal.id as string, { title: "Arquivado", status: "ARCHIVED" });
    db.seedKr(goal.id as string, { title: "Concluído", status: "DONE" });
    const service = createGoalService({ prisma: db.client });
    const result = await service.runDailySnapshots(new Date());
    assert.equal(result.manualSnapshotted, 1, "só o ACTIVE entra");
    assert.equal(result.computed, 0);
    assert.ok(result.durationMs >= 0);
    assert.equal(result.failures.length, 0);
  });
});
