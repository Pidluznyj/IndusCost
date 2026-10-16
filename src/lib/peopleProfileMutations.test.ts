import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyCareerMovement,
  applyCompensationAdjustment,
  createEmployeeAbsence,
  createEpiDelivery,
  deleteCareerEvent,
  deleteCompensationAdjustment,
  deleteEmergencyContact,
  deleteEmployeeBenefit,
  deleteEmployeeDocument,
  deleteEmployeeNote,
  deleteEpiDelivery,
  deletePayrollComponentWithHistory,
  findLinkedHistoryEvent,
  recordPayrollComponentHistory,
  saveEmployeePhoto,
  updateCareerEvent,
  updateCompensationAdjustment,
  updateEmergencyContact,
  updateEmployeeAbsence,
  updateEmployeeNote,
  setEpiDeliveryStatus,
  createEpiDeliveryEvent,
  updateEpiDelivery,
} from "./peopleProfileMutations.server.ts";
import { PeopleProfileAccessError } from "./peopleProfileErrors.ts";

const EMP = "11111111-1111-4111-8111-111111111111";
const REC = "22222222-2222-4222-8222-222222222222";
const ROLE_OLD = "33333333-3333-4333-8333-333333333333";
const ROLE_NEW = "44444444-4444-4444-8444-444444444444";

type AnyArgs = Record<string, any>;

function fakePrisma(tx: Record<string, unknown>) {
  return {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tx),
  } as never;
}

/** Delegate que falha em qualquer acesso: prova que a mutação não toca o Employee. */
function untouchable(name: string) {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        throw new Error(`${name}.${String(prop)} não deveria ser chamado`);
      },
    }
  );
}

function expectAccessError(code: string, status: number) {
  return (err: unknown) => {
    assert.ok(err instanceof PeopleProfileAccessError, `esperava PeopleProfileAccessError: ${err}`);
    assert.equal(err.code, code);
    assert.equal(err.status, status);
    return true;
  };
}

async function captureAudit(fn: () => Promise<unknown>): Promise<string[]> {
  const lines: string[] = [];
  const original = console.info;
  console.info = (msg: unknown) => {
    lines.push(String(msg));
  };
  try {
    await fn();
  } finally {
    console.info = original;
  }
  return lines;
}

describe("applyCompensationAdjustment — concorrência", () => {
  it("409 quando o salário esperado diverge (lost update)", async () => {
    const prisma = {
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          employee: {
            findUnique: async () => ({
              id: "e1",
              salary: { toNumber: () => 2000 },
              roleId: "r1",
              Role: { name: "Op" },
            }),
            updateMany: async () => ({ count: 0 }),
          },
        };
        return fn(tx);
      },
    };
    await assert.rejects(
      () =>
        applyCompensationAdjustment(prisma as never, {
          employeeId: "11111111-1111-4111-8111-111111111111",
          expectedPreviousAmount: 2000,
          newAmount: 2200,
          type: "MERIT",
          effectiveDate: new Date("2026-05-01"),
          actorUserId: "u1",
        }),
      (err: unknown) => {
        assert.ok(err instanceof PeopleProfileAccessError);
        assert.equal(err.code, "SALARY_CONFLICT");
        assert.equal(err.status, 409);
        assert.ok(!String(err.message).includes("2000"));
        assert.ok(!String(err.message).includes("2200"));
        return true;
      }
    );
  });

  it("modo padrão continua 409 quando o salário atual difere do esperado", async () => {
    let updateManyCalled = false;
    const prisma = fakePrisma({
      employee: {
        findUnique: async () => ({
          id: EMP,
          salary: { toNumber: () => 2500 },
          roleId: "r1",
          Role: { name: "Op" },
        }),
        updateMany: async () => {
          updateManyCalled = true;
          return { count: 1 };
        },
      },
    });
    await assert.rejects(
      () =>
        applyCompensationAdjustment(prisma, {
          employeeId: EMP,
          expectedPreviousAmount: 2000,
          newAmount: 2200,
          type: "MERIT",
          effectiveDate: new Date("2026-05-01"),
        }),
      expectAccessError("SALARY_CONFLICT", 409)
    );
    assert.equal(updateManyCalled, false);
  });
});

describe("applyCompensationAdjustment — historicalOnly", () => {
  it("não lê nem altera Employee.salary e grava o valor anterior informado", async () => {
    let employeeSelect: AnyArgs | null = null;
    let historyData: AnyArgs | null = null;
    let adjustmentData: AnyArgs | null = null;
    const prisma = fakePrisma({
      employee: {
        findUnique: async (args: AnyArgs) => {
          employeeSelect = args.select;
          return { id: EMP };
        },
        update: async () => {
          throw new Error("employee.update não deveria ser chamado");
        },
        updateMany: async () => {
          throw new Error("employee.updateMany não deveria ser chamado");
        },
      },
      hrEmployeeHistory: {
        create: async (args: AnyArgs) => {
          historyData = args.data;
          return { id: "hist-1" };
        },
      },
      hrCompensationAdjustment: {
        create: async (args: AnyArgs) => {
          adjustmentData = args.data;
          return { id: "adj-1" };
        },
      },
    });
    const effectiveDate = new Date("2023-03-01");
    const lines = await captureAudit(async () => {
      const result = await applyCompensationAdjustment(prisma, {
        employeeId: EMP,
        historicalOnly: true,
        previousAmount: 1800,
        newAmount: 2000,
        type: "COLLECTIVE",
        effectiveDate,
        reason: "  Dissídio 2023  ",
        actorUserId: "u1",
      });
      assert.deepEqual(result, { adjustmentId: "adj-1", historyEventId: "hist-1", percentage: 11.11 });
    });

    assert.deepEqual(employeeSelect, { id: true });
    assert.equal(historyData?.eventType, "COMPENSATION_ADJUSTMENT");
    assert.equal(historyData?.effectiveDate, effectiveDate);
    assert.equal(historyData?.reason, "Dissídio 2023");
    assert.equal(adjustmentData?.previousAmount, 1800);
    assert.equal(adjustmentData?.newAmount, 2000);
    assert.equal(adjustmentData?.differenceAmount, 200);
    assert.equal(adjustmentData?.percentage, 11.11);
    assert.equal(adjustmentData?.type, "COLLECTIVE");
    assert.equal(adjustmentData?.historyEventId, "hist-1");
    assert.equal(adjustmentData?.effectiveDate, effectiveDate);

    const audit = lines.join("\n");
    assert.ok(audit.includes("employee.compensation.adjustment"));
    assert.ok(!audit.includes("1800"));
    assert.ok(!audit.includes("2000"));
  });

  it("valor anterior desconhecido → percentual e diferença nulos", async () => {
    let adjustmentData: AnyArgs | null = null;
    const prisma = fakePrisma({
      employee: { findUnique: async () => ({ id: EMP }) },
      hrEmployeeHistory: { create: async () => ({ id: "hist-1" }) },
      hrCompensationAdjustment: {
        create: async (args: AnyArgs) => {
          adjustmentData = args.data;
          return { id: "adj-1" };
        },
      },
    });
    const result = await applyCompensationAdjustment(prisma, {
      employeeId: EMP,
      historicalOnly: true,
      previousAmount: null,
      newAmount: 2000,
      type: "MERIT",
      effectiveDate: new Date("2022-01-01"),
    });
    assert.equal(result.percentage, null);
    assert.equal(adjustmentData?.previousAmount, null);
    assert.equal(adjustmentData?.differenceAmount, null);
  });

  it("recusa MANUAL_EDIT e valores inválidos (400)", async () => {
    const prisma = fakePrisma({ employee: untouchable("employee") });
    await assert.rejects(
      () =>
        applyCompensationAdjustment(prisma, {
          employeeId: EMP,
          historicalOnly: true,
          newAmount: 2000,
          type: "MANUAL_EDIT",
          effectiveDate: new Date("2022-01-01"),
        }),
      expectAccessError("INVALID_TYPE", 400)
    );
    await assert.rejects(
      () =>
        applyCompensationAdjustment(prisma, {
          employeeId: EMP,
          historicalOnly: true,
          previousAmount: -1,
          newAmount: 2000,
          type: "MERIT",
          effectiveDate: new Date("2022-01-01"),
        }),
      expectAccessError("INVALID_AMOUNT", 400)
    );
    await assert.rejects(
      () =>
        applyCompensationAdjustment(prisma, {
          employeeId: EMP,
          historicalOnly: true,
          newAmount: Number.NaN,
          type: "MERIT",
          effectiveDate: new Date("2022-01-01"),
        }),
      expectAccessError("INVALID_AMOUNT", 400)
    );
  });
});

describe("updateCompensationAdjustment / deleteCompensationAdjustment", () => {
  it("PATCH recalcula percentual/diferença e espelha o evento do histórico", async () => {
    let findWhere: AnyArgs | null = null;
    let adjustmentUpdate: AnyArgs | null = null;
    let historyUpdate: AnyArgs | null = null;
    const prisma = fakePrisma({
      employee: untouchable("employee"),
      hrCompensationAdjustment: {
        findFirst: async (args: AnyArgs) => {
          findWhere = args.where;
          return {
            id: REC,
            previousAmount: { toNumber: () => 2000 },
            newAmount: { toNumber: () => 2200 },
            historyEventId: "hist-9",
          };
        },
        updateMany: async (args: AnyArgs) => {
          adjustmentUpdate = args;
          return { count: 1 };
        },
      },
      hrEmployeeHistory: {
        updateMany: async (args: AnyArgs) => {
          historyUpdate = args;
          return { count: 1 };
        },
      },
    });

    const lines = await captureAudit(async () => {
      const result = await updateCompensationAdjustment(prisma, {
        employeeId: EMP,
        recordId: REC,
        patch: { newAmount: 2300, effectiveDate: "2024-05-01", reason: "Dissídio", notes: null },
        actorUserId: "u1",
      });
      assert.deepEqual(result, { id: REC });
    });

    assert.deepEqual(findWhere, { id: REC, employeeId: EMP });
    assert.deepEqual(adjustmentUpdate?.where, { id: REC, employeeId: EMP });
    assert.equal(adjustmentUpdate?.data.previousAmount, 2000);
    assert.equal(adjustmentUpdate?.data.newAmount, 2300);
    assert.equal(adjustmentUpdate?.data.percentage, 15);
    assert.equal(adjustmentUpdate?.data.differenceAmount, 300);
    assert.equal(adjustmentUpdate?.data.reason, "Dissídio");
    assert.equal(adjustmentUpdate?.data.notes, null);
    assert.equal(
      (adjustmentUpdate?.data.effectiveDate as Date).toISOString(),
      "2024-05-01T00:00:00.000Z"
    );

    assert.deepEqual(historyUpdate?.where, {
      id: "hist-9",
      employeeId: EMP,
      eventType: "COMPENSATION_ADJUSTMENT",
    });
    assert.equal(
      (historyUpdate?.data.effectiveDate as Date).toISOString(),
      "2024-05-01T00:00:00.000Z"
    );
    assert.equal(historyUpdate?.data.reason, "Dissídio");
    assert.equal(historyUpdate?.data.notes, null);

    const audit = lines.join("\n");
    assert.ok(audit.includes("employee.compensation.adjustment.update"));
    assert.ok(!audit.includes("2300"));
    assert.ok(!audit.includes("2200"));
  });

  it("PATCH só de tipo não mexe em valores nem no histórico; MANUAL_EDIT é aceito", async () => {
    let adjustmentUpdate: AnyArgs | null = null;
    const prisma = fakePrisma({
      hrCompensationAdjustment: {
        findFirst: async () => ({
          id: REC,
          previousAmount: 2000,
          newAmount: 2200,
          historyEventId: "hist-9",
        }),
        updateMany: async (args: AnyArgs) => {
          adjustmentUpdate = args;
          return { count: 1 };
        },
      },
      hrEmployeeHistory: untouchable("hrEmployeeHistory"),
    });
    await updateCompensationAdjustment(prisma, {
      employeeId: EMP,
      recordId: REC,
      patch: { type: "MANUAL_EDIT" },
    });
    assert.deepEqual(adjustmentUpdate?.data, { type: "MANUAL_EDIT" });
  });

  it("DELETE remove o reajuste e o evento vinculado, sem tocar o Employee", async () => {
    const deleted: AnyArgs[] = [];
    const prisma = fakePrisma({
      employee: untouchable("employee"),
      hrCompensationAdjustment: {
        findFirst: async () => ({ id: REC, historyEventId: "hist-9" }),
        deleteMany: async (args: AnyArgs) => {
          deleted.push({ model: "adjustment", where: args.where });
          return { count: 1 };
        },
      },
      hrEmployeeHistory: {
        deleteMany: async (args: AnyArgs) => {
          deleted.push({ model: "history", where: args.where });
          return { count: 1 };
        },
      },
    });
    const result = await deleteCompensationAdjustment(prisma, { employeeId: EMP, recordId: REC });
    assert.deepEqual(result, { ok: true });
    assert.deepEqual(deleted, [
      { model: "adjustment", where: { id: REC, employeeId: EMP } },
      {
        model: "history",
        where: { id: "hist-9", employeeId: EMP, eventType: "COMPENSATION_ADJUSTMENT" },
      },
    ]);
  });

  it("recordId inválido → 400 INVALID_ID antes de abrir transação", async () => {
    const prisma = {
      $transaction: async () => {
        throw new Error("não deveria abrir transação");
      },
    } as never;
    await assert.rejects(
      () => updateCompensationAdjustment(prisma, { employeeId: EMP, recordId: "abc", patch: {} }),
      expectAccessError("INVALID_ID", 400)
    );
  });
});

describe("eventos de carreira — correção e exclusão", () => {
  function historyPrisma(eventType: string, sink: { update?: AnyArgs; deleted?: AnyArgs }) {
    return fakePrisma({
      employee: untouchable("employee"),
      hrEmployeeHistory: {
        findFirst: async () => ({ id: REC, eventType }),
        updateMany: async (args: AnyArgs) => {
          sink.update = args;
          return { count: 1 };
        },
        deleteMany: async (args: AnyArgs) => {
          sink.deleted = args;
          return { count: 1 };
        },
      },
    });
  }

  it("PATCH recusa INITIAL_STATE e COMPENSATION_ADJUSTMENT com 409", async () => {
    for (const eventType of ["INITIAL_STATE", "COMPENSATION_ADJUSTMENT", "EPI_DELIVERY"]) {
      const sink: { update?: AnyArgs } = {};
      await assert.rejects(
        () =>
          updateCareerEvent(historyPrisma(eventType, sink), {
            employeeId: EMP,
            recordId: REC,
            patch: { reason: "x" },
          }),
        expectAccessError("HISTORY_EVENT_LOCKED", 409)
      );
      assert.equal(sink.update, undefined);
    }
  });

  it("a mensagem do reajuste aponta para a guia Remuneração", async () => {
    await assert.rejects(
      () =>
        updateCareerEvent(historyPrisma("COMPENSATION_ADJUSTMENT", {}), {
          employeeId: EMP,
          recordId: REC,
          patch: { reason: "x" },
        }),
      (err: unknown) => {
        assert.ok(err instanceof PeopleProfileAccessError);
        assert.ok(err.message.includes("Remuneração"));
        return true;
      }
    );
  });

  it("reclassificação só entre PROMOTION e ROLE_CHANGE", async () => {
    await assert.rejects(
      () =>
        updateCareerEvent(historyPrisma("DEPARTMENT_CHANGE", {}), {
          employeeId: EMP,
          recordId: REC,
          patch: { eventType: "PROMOTION" },
        }),
      expectAccessError("INVALID_EVENT_TYPE", 400)
    );
    await assert.rejects(
      () =>
        updateCareerEvent(historyPrisma("PROMOTION", {}), {
          employeeId: EMP,
          recordId: REC,
          patch: { eventType: "MANAGER_CHANGE" },
        }),
      expectAccessError("INVALID_EVENT_TYPE", 400)
    );

    const sink: { update?: AnyArgs } = {};
    const result = await updateCareerEvent(historyPrisma("ROLE_CHANGE", sink), {
      employeeId: EMP,
      recordId: REC,
      patch: { eventType: "PROMOTION", effectiveDate: "2021-02-01", notes: "  corrigido  " },
    });
    assert.deepEqual(result, { id: REC });
    assert.deepEqual(sink.update?.where, { id: REC, employeeId: EMP });
    assert.equal(sink.update?.data.eventType, "PROMOTION");
    assert.equal(sink.update?.data.notes, "corrigido");
    assert.equal(
      (sink.update?.data.effectiveDate as Date).toISOString(),
      "2021-02-01T00:00:00.000Z"
    );
  });

  it("mesmo tipo no corpo não é reclassificação (DEPARTMENT_CHANGE segue editável)", async () => {
    const sink: { update?: AnyArgs } = {};
    await updateCareerEvent(historyPrisma("DEPARTMENT_CHANGE", sink), {
      employeeId: EMP,
      recordId: REC,
      patch: { eventType: "DEPARTMENT_CHANGE", reason: "ajuste" },
    });
    assert.deepEqual(sink.update?.data, { reason: "ajuste" });
  });

  it("DELETE respeita a mesma trava e exclui evento editável", async () => {
    const locked: { deleted?: AnyArgs } = {};
    await assert.rejects(
      () => deleteCareerEvent(historyPrisma("INITIAL_STATE", locked), { employeeId: EMP, recordId: REC }),
      expectAccessError("HISTORY_EVENT_LOCKED", 409)
    );
    assert.equal(locked.deleted, undefined);

    const sink: { deleted?: AnyArgs } = {};
    const result = await deleteCareerEvent(historyPrisma("PROMOTION", sink), {
      employeeId: EMP,
      recordId: REC,
    });
    assert.deepEqual(result, { ok: true });
    assert.deepEqual(sink.deleted?.where, { id: REC, employeeId: EMP });
  });
});

describe("applyCareerMovement — modo padrão", () => {
  it("promoção sem departamento no corpo (rota manda null) não zera Employee.departmentId", async () => {
    let updateData: AnyArgs | null = null;
    const snapshotRow = {
      name: "Fulano",
      roleId: ROLE_OLD,
      department: "Fabricação",
      departmentId: "dep-1",
      costCenter: null,
      costCenterId: null,
      managerId: null,
      managerName: null,
      contractType: "CLT",
      workSchedule: null,
      status: "ACTIVE",
      salary: null,
      admissionDate: null,
      terminationDate: null,
      Role: { name: "Auxiliar" },
      manager: null,
    };
    const prisma = fakePrisma({
      employee: {
        findUnique: async () => snapshotRow,
        update: async (args: AnyArgs) => {
          updateData = args.data;
          return {};
        },
      },
      hrEmployeeHistory: { create: async () => ({ id: "hist-1" }) },
    });
    await applyCareerMovement(prisma, {
      employeeId: EMP,
      eventType: "PROMOTION",
      effectiveDate: new Date("2026-03-01"),
      newRoleId: ROLE_NEW,
      newDepartmentId: null,
      newCostCenterId: null,
      actorUserId: "u1",
    });
    assert.equal(updateData?.roleId, ROLE_NEW);
    assert.ok(!("departmentId" in (updateData ?? {})));
    assert.ok(!("costCenterId" in (updateData ?? {})));
  });
});

describe("applyCareerMovement — recordOnly", () => {
  it("grava só o histórico com nomes resolvidos, sem employee.update", async () => {
    let historyData: AnyArgs | null = null;
    const prisma = fakePrisma({
      employee: {
        findUnique: async () => ({ id: EMP }),
        update: async () => {
          throw new Error("employee.update não deveria ser chamado");
        },
      },
      role: {
        findUnique: async (args: AnyArgs) =>
          args.where.id === ROLE_OLD
            ? { id: ROLE_OLD, name: "Auxiliar" }
            : args.where.id === ROLE_NEW
              ? { id: ROLE_NEW, name: "Operador I" }
              : null,
      },
      hrEmployeeHistory: {
        create: async (args: AnyArgs) => {
          historyData = args.data;
          return { id: "hist-1" };
        },
      },
    });
    const effectiveDate = new Date("2020-06-01");
    const result = await applyCareerMovement(prisma, {
      employeeId: EMP,
      eventType: "PROMOTION",
      effectiveDate,
      recordOnly: true,
      previousRoleId: ROLE_OLD,
      newRoleId: ROLE_NEW,
      reason: "Promoção retroativa",
      actorUserId: "u1",
    });
    assert.deepEqual(result, { historyEventId: "hist-1" });
    assert.equal(historyData?.eventType, "PROMOTION");
    assert.equal(historyData?.effectiveDate, effectiveDate);
    assert.equal(historyData?.previousRoleId, ROLE_OLD);
    assert.equal(historyData?.previousRoleName, "Auxiliar");
    assert.equal(historyData?.newRoleId, ROLE_NEW);
    assert.equal(historyData?.newRoleName, "Operador I");
    assert.equal(historyData?.newManagerId, null);
  });

  it("resolve centro de custo no formato do lookup e gestor por nome social", async () => {
    let historyData: AnyArgs | null = null;
    const ccId = "55555555-5555-4555-8555-555555555555";
    const managerId = "66666666-6666-4666-8666-666666666666";
    const prisma = fakePrisma({
      employee: {
        findUnique: async (args: AnyArgs) =>
          args.where.id === EMP
            ? { id: EMP }
            : { id: managerId, name: "Maria de Souza", socialName: " Mari " },
      },
      financialCostCenter: {
        findUnique: async () => ({ id: ccId, code: "CC-10", name: "Usinagem" }),
      },
      hrEmployeeHistory: {
        create: async (args: AnyArgs) => {
          historyData = args.data;
          return { id: "hist-2" };
        },
      },
    });
    await applyCareerMovement(prisma, {
      employeeId: EMP,
      eventType: "COST_CENTER_CHANGE",
      effectiveDate: new Date("2021-01-01"),
      recordOnly: true,
      previousCostCenter: "Montagem",
      newCostCenterId: ccId,
      newManagerId: managerId,
    });
    assert.equal(historyData?.previousCostCenter, "Montagem");
    assert.equal(historyData?.previousCostCenterId, null);
    assert.equal(historyData?.newCostCenterId, ccId);
    assert.equal(historyData?.newCostCenter, "CC-10 — Usinagem");
    assert.equal(historyData?.newManagerName, "Mari");
  });

  it("PROMOTION/ROLE_CHANGE exigem newRoleId", async () => {
    const prisma = fakePrisma({
      employee: { findUnique: async () => ({ id: EMP }) },
      role: { findUnique: async () => null },
      hrEmployeeHistory: untouchable("hrEmployeeHistory"),
    });
    await assert.rejects(
      () =>
        applyCareerMovement(prisma, {
          employeeId: EMP,
          eventType: "ROLE_CHANGE",
          effectiveDate: new Date("2020-06-01"),
          recordOnly: true,
        }),
      expectAccessError("REQUIRED_FIELD", 400)
    );
  });
});

describe("IDOR — registro de outro colaborador", () => {
  it("DELETE de registro antigo de benefício alheio → 404 (where com id + employeeId)", async () => {
    let capturedWhere: unknown;
    const prisma = fakePrisma({
      hrEmployeeBenefit: {
        findFirst: async (args: AnyArgs) => {
          capturedWhere = args.where;
          return null;
        },
        deleteMany: async () => {
          throw new Error("não deveria excluir");
        },
      },
    });
    await assert.rejects(
      () => deleteEmployeeBenefit(prisma, { employeeId: EMP, recordId: REC }),
      expectAccessError("NOT_FOUND", 404)
    );
    assert.deepEqual(capturedWhere, { id: REC, employeeId: EMP });
  });

  it("DELETE de entrega de EPI (própria ou alheia) → 405 sem tocar o banco", async () => {
    const prisma = fakePrisma({ hrEpiDelivery: untouchable("hrEpiDelivery") });
    await assert.rejects(
      () => deleteEpiDelivery(prisma, { employeeId: EMP, recordId: REC }),
      expectAccessError("EPI_DELETE_NOT_ALLOWED", 405)
    );
  });

  it("cancelar entrega de EPI alheia → 404", async () => {
    let capturedWhere: unknown;
    const prisma = fakePrisma({
      hrEpiDelivery: {
        findFirst: async (args: AnyArgs) => {
          capturedWhere = args.where;
          return null;
        },
        updateMany: async () => {
          throw new Error("não deveria alterar");
        },
      },
    });
    await assert.rejects(
      () => setEpiDeliveryStatus(prisma, { employeeId: EMP, recordId: REC, action: "CANCEL", reason: "Lançamento duplicado" }),
      expectAccessError("NOT_FOUND", 404)
    );
    assert.deepEqual(capturedWhere, { id: REC, employeeId: EMP });
  });
});

describe("afastamentos — enums e espelho do histórico", () => {
  it("POST valida tipo e situação", async () => {
    const prisma = fakePrisma({ hrAbsence: untouchable("hrAbsence") });
    await assert.rejects(
      () =>
        createEmployeeAbsence(prisma, {
          employeeId: EMP,
          type: "SABBATICAL",
          startDate: new Date("2026-01-01"),
        }),
      expectAccessError("INVALID_TYPE", 400)
    );
    await assert.rejects(
      () =>
        createEmployeeAbsence(prisma, {
          employeeId: EMP,
          type: "VACATION",
          status: "DONE",
          startDate: new Date("2026-01-01"),
        }),
      expectAccessError("INVALID_STATUS", 400)
    );
  });

  it("PATCH de tipo/data sincroniza o evento vinculado por metadata", async () => {
    let historyUpdate: AnyArgs | null = null;
    const prisma = fakePrisma({
      hrAbsence: {
        findFirst: async () => ({
          id: REC,
          type: "VACATION",
          startDate: new Date("2026-01-05T00:00:00.000Z"),
          endDate: new Date("2026-01-20T00:00:00.000Z"),
          reason: null,
          notes: null,
        }),
        updateMany: async () => ({ count: 1 }),
        findMany: async () => [],
      },
      // Afastamento (não férias) valida as regras legais contra o vínculo do colaborador.
      employee: {
        findUnique: async () => ({
          status: "ACTIVE",
          admissionDate: new Date("2020-01-01T00:00:00.000Z"),
          terminationDate: null,
        }),
      },
      hrEmployeeHistory: {
        findFirst: async () => ({ id: "hist-abs" }),
        findMany: async () => {
          throw new Error("vínculo por metadata dispensa o casamento legado");
        },
        updateMany: async (args: AnyArgs) => {
          historyUpdate = args;
          return { count: 1 };
        },
      },
    });
    await updateEmployeeAbsence(prisma, {
      employeeId: EMP,
      recordId: REC,
      patch: {
        type: "SICK_LEAVE",
        startDate: "2026-01-06",
        status: "IN_PROGRESS",
        reason: "Atestado médico de 10 dias apresentado",
      },
    });
    assert.deepEqual(historyUpdate?.where, { id: "hist-abs", employeeId: EMP });
    assert.equal(historyUpdate?.data.eventType, "LEAVE_START");
    assert.equal(
      (historyUpdate?.data.effectiveDate as Date).toISOString(),
      "2026-01-06T00:00:00.000Z"
    );
    assert.equal(historyUpdate?.data.metadata, undefined);
  });

  it("PATCH de retorno não procura o evento de início e grava o retorno no histórico", async () => {
    let absenceUpdate: AnyArgs | null = null;
    let historyCreate: AnyArgs | null = null;
    const prisma = fakePrisma({
      hrAbsence: {
        findFirst: async () => ({
          id: REC,
          type: "VACATION",
          startDate: new Date("2026-01-05T00:00:00.000Z"),
          endDate: null,
          reason: null,
          notes: null,
        }),
        updateMany: async (args: AnyArgs) => {
          absenceUpdate = args;
          return { count: 1 };
        },
      },
      hrEmployeeHistory: {
        findFirst: async () => {
          throw new Error("retorno não sincroniza o evento de início");
        },
        findMany: async () => {
          throw new Error("retorno não sincroniza o evento de início");
        },
        create: async (args: AnyArgs) => {
          historyCreate = args;
          return { id: "hist-ret" };
        },
      },
    });
    await updateEmployeeAbsence(prisma, {
      employeeId: EMP,
      recordId: REC,
      patch: { status: "COMPLETED", actualReturn: "2026-01-21" },
    });
    assert.equal(absenceUpdate?.data.status, "COMPLETED");
    assert.equal(
      (absenceUpdate?.data.actualReturn as Date).toISOString(),
      "2026-01-21T00:00:00.000Z"
    );
    assert.equal(historyCreate?.data.eventType, "VACATION_END");
    assert.deepEqual(historyCreate?.data.metadata, { recordType: "absenceReturn", recordId: REC });
  });
});

describe("observações — regras da categoria RESTRITA", () => {
  function notePrisma(category: string, sink: { update?: AnyArgs; history?: AnyArgs; deleted?: AnyArgs }) {
    return fakePrisma({
      hrEmployeeNote: {
        findFirst: async () => ({
          id: REC,
          category,
          createdAt: new Date("2026-02-01T10:00:00.000Z"),
          createdByUserId: "u1",
        }),
        updateMany: async (args: AnyArgs) => {
          sink.update = args;
          return { count: 1 };
        },
        deleteMany: async (args: AnyArgs) => {
          sink.deleted = args;
          return { count: 1 };
        },
      },
      hrEmployeeHistory: {
        findFirst: async () => ({ id: "hist-note" }),
        updateMany: async (args: AnyArgs) => {
          sink.history = args;
          return { count: 1 };
        },
        deleteMany: async (args: AnyArgs) => {
          sink.history = args;
          return { count: 1 };
        },
      },
    });
  }

  it("linha RESTRITA sem permissão → 404 em PATCH e DELETE", async () => {
    const sink: { update?: AnyArgs; deleted?: AnyArgs } = {};
    await assert.rejects(
      () =>
        updateEmployeeNote(notePrisma("RESTRITA", sink), {
          employeeId: EMP,
          recordId: REC,
          patch: { body: "novo texto" },
          canViewRestrictedNotes: false,
        }),
      expectAccessError("NOT_FOUND", 404)
    );
    await assert.rejects(
      () =>
        deleteEmployeeNote(notePrisma("RESTRITA", sink), {
          employeeId: EMP,
          recordId: REC,
          canViewRestrictedNotes: false,
        }),
      expectAccessError("NOT_FOUND", 404)
    );
    assert.equal(sink.update, undefined);
    assert.equal(sink.deleted, undefined);
  });

  it("nova categoria RESTRITA sem permissão → 403", async () => {
    const sink: { update?: AnyArgs } = {};
    await assert.rejects(
      () =>
        updateEmployeeNote(notePrisma("GERAL", sink), {
          employeeId: EMP,
          recordId: REC,
          patch: { category: "RESTRITA" },
          canViewRestrictedNotes: false,
        }),
      expectAccessError("FORBIDDEN", 403)
    );
    assert.equal(sink.update, undefined);
  });

  it("com permissão mantém visibility em sincronia e espelha a categoria no histórico", async () => {
    const sink: { update?: AnyArgs; history?: AnyArgs } = {};
    const lines = await captureAudit(async () => {
      await updateEmployeeNote(notePrisma("GERAL", sink), {
        employeeId: EMP,
        recordId: REC,
        patch: { category: "RESTRITA", body: "  conteúdo sigiloso  " },
        canViewRestrictedNotes: true,
      });
    });
    assert.deepEqual(sink.update?.data, {
      category: "RESTRITA",
      visibility: "RESTRICTED",
      body: "conteúdo sigiloso",
    });
    assert.deepEqual(sink.history?.data, { notes: "RESTRITA" });
    assert.ok(!lines.join("\n").includes("sigiloso"));

    const back: { update?: AnyArgs } = {};
    await updateEmployeeNote(notePrisma("RESTRITA", back), {
      employeeId: EMP,
      recordId: REC,
      patch: { category: "RH" },
      canViewRestrictedNotes: true,
    });
    assert.deepEqual(back.update?.data, { category: "RH", visibility: "STANDARD" });
  });

  it("corpo vazio e categoria desconhecida → 400", async () => {
    await assert.rejects(
      () =>
        updateEmployeeNote(notePrisma("GERAL", {}), {
          employeeId: EMP,
          recordId: REC,
          patch: { body: "   " },
          canViewRestrictedNotes: true,
        }),
      expectAccessError("REQUIRED_FIELD", 400)
    );
    await assert.rejects(
      () =>
        updateEmployeeNote(notePrisma("GERAL", {}), {
          employeeId: EMP,
          recordId: REC,
          patch: { category: "SECRETA" },
          canViewRestrictedNotes: true,
        }),
      expectAccessError("INVALID_CATEGORY", 400)
    );
  });
});

describe("contatos de emergência", () => {
  it('id "primary" → 400 PRIMARY_CONTACT em PATCH e DELETE', async () => {
    const prisma = {
      $transaction: async () => {
        throw new Error("não deveria abrir transação");
      },
    } as never;
    await assert.rejects(
      () =>
        updateEmergencyContact(prisma, {
          employeeId: EMP,
          recordId: "primary",
          patch: { name: "Fulano" },
        }),
      expectAccessError("PRIMARY_CONTACT", 400)
    );
    await assert.rejects(
      () => deleteEmergencyContact(prisma, { employeeId: EMP, recordId: "primary" }),
      expectAccessError("PRIMARY_CONTACT", 400)
    );
  });

  it("valida prioridade 1..9 e nome obrigatório; auditoria sem telefone", async () => {
    let update: AnyArgs | null = null;
    const prisma = fakePrisma({
      hrEmergencyContact: {
        findFirst: async () => ({ id: REC }),
        updateMany: async (args: AnyArgs) => {
          update = args;
          return { count: 1 };
        },
      },
    });
    await assert.rejects(
      () => updateEmergencyContact(prisma, { employeeId: EMP, recordId: REC, patch: { priority: 10 } }),
      expectAccessError("INVALID_PRIORITY", 400)
    );
    await assert.rejects(
      () => updateEmergencyContact(prisma, { employeeId: EMP, recordId: REC, patch: { priority: 1.5 } }),
      expectAccessError("INVALID_PRIORITY", 400)
    );
    await assert.rejects(
      () => updateEmergencyContact(prisma, { employeeId: EMP, recordId: REC, patch: { name: "  " } }),
      expectAccessError("REQUIRED_FIELD", 400)
    );
    const lines = await captureAudit(async () => {
      await updateEmergencyContact(prisma, {
        employeeId: EMP,
        recordId: REC,
        patch: { phone: " (41) 99999-0000 ", priority: "3", relationship: "" },
      });
    });
    assert.deepEqual(update?.data, { phone: "(41) 99999-0000", relationship: null, priority: 3 });
    assert.ok(!lines.join("\n").includes("99999"));
  });
});

describe("EPI — entregas do catálogo, substituição e cancelamento", () => {
  const ITEM = "55555555-5555-4555-8555-555555555555";
  const PREV = "66666666-6666-4666-8666-666666666666";
  const TODAY = "2026-10-16";
  const catalogItem = (over: AnyArgs = {}) => ({
    id: ITEM,
    code: "EPI-0007",
    description: "Protetor auricular plug",
    type: "EPI",
    caNumber: "5745",
    unit: "PAIR",
    replacementDays: 180,
    active: true,
    ...over,
  });
  function deliveryPrisma(sink: AnyArgs, over: AnyArgs = {}) {
    return fakePrisma({
      employee: { findUnique: async () => ({ status: over.employeeStatus ?? "ACTIVE" }) },
      hrEpiItem: { findUnique: async () => catalogItem(over.item) },
      appUser: { findUnique: async () => ({ name: "Analista de RH" }) },
      hrEpiDeliveryEvent: {
        create: async (args: AnyArgs) => {
          sink.event = args.data;
          return { id: "ev-1", ...args.data };
        },
      },
      hrEpiDelivery: {
        create: async (args: AnyArgs) => {
          sink.created = args.data;
          sink.items = [...(sink.items ?? []), args.data];
          return { id: REC, ...args.data };
        },
        findFirst: async () => over.previous ?? null,
        updateMany: async (args: AnyArgs) => {
          sink.updates = [...(sink.updates ?? []), args];
          return { count: over.updateCount ?? 1 };
        },
      },
      hrEmployeeHistory: {
        create: async (args: AnyArgs) => {
          sink.history = args.data;
          return { id: "hist-epi" };
        },
      },
    });
  }

  it("grava o retrato do item, o responsável autenticado e calcula a próxima troca", async () => {
    const sink: AnyArgs = {};
    await createEpiDelivery(deliveryPrisma(sink), {
      employeeId: EMP,
      todayIso: TODAY,
      actorUserId: "77777777-7777-4777-8777-777777777777",
      body: { itemId: ITEM, deliveredOn: "2026-10-16", quantity: 2 },
    });
    assert.equal(sink.created.itemCode, "EPI-0007");
    assert.equal(sink.created.item, "Protetor auricular plug");
    assert.equal(sink.created.itemCaNumber, "5745");
    assert.equal(sink.created.itemUnit, "PAIR");
    assert.equal(sink.created.replacementDays, 180);
    assert.equal((sink.created.replacementDueDate as Date).toISOString().slice(0, 10), "2027-04-14");
    assert.equal((sink.created.deliveredAt as Date).toISOString(), "2026-10-16T12:00:00.000Z");
    assert.equal(sink.created.responsibleName, "Analista de RH");
    assert.equal(sink.created.replacementAdjustReason, null);
    assert.deepEqual(sink.history.metadata, { recordType: "epiDelivery", recordId: REC });
    assert.equal(sink.history.notes, "EPI-0007 · Protetor auricular plug");
  });

  it("evento com vários itens: um evento, um registro por item, prazos independentes", async () => {
    const sink: AnyArgs = {};
    const result = await createEpiDeliveryEvent(deliveryPrisma(sink), {
      employeeId: EMP,
      todayIso: TODAY,
      body: {
        deliveredOn: "2026-10-16",
        notes: "Integração da célula 4",
        items: [
          { itemId: ITEM, quantity: 1 },
          { itemId: ITEM, quantity: 2, replacementDays: 90, adjustReason: "Uso em ambiente com óleo" },
        ],
      },
    });
    assert.equal(sink.event.notes, "Integração da célula 4");
    assert.equal((sink.event.deliveredAt as Date).toISOString(), "2026-10-16T12:00:00.000Z");
    assert.equal(sink.items.length, 2);
    assert.ok(sink.items.every((i: AnyArgs) => i.eventId === "ev-1"));
    assert.equal((sink.items[0].replacementDueDate as Date).toISOString().slice(0, 10), "2027-04-14");
    assert.equal((sink.items[1].replacementDueDate as Date).toISOString().slice(0, 10), "2027-01-14");
    assert.equal(result.deliveries.length, 2);
  });

  it("evento: sem itens, item repetido na substituição ou item inválido recusam tudo", async () => {
    const make = (body: AnyArgs) => createEpiDeliveryEvent(deliveryPrisma({}), { employeeId: EMP, todayIso: TODAY, body });
    await assert.rejects(() => make({ deliveredOn: TODAY, items: [] }), expectAccessError("INVALID_EPI_DELIVERY", 400));
    await assert.rejects(
      () => make({ deliveredOn: TODAY, items: [{ itemId: ITEM, replacesDeliveryId: PREV }, { itemId: ITEM, replacesDeliveryId: PREV }] }),
      expectAccessError("INVALID_EPI_DELIVERY", 400)
    );
    const sink: AnyArgs = {};
    await assert.rejects(
      () =>
        createEpiDeliveryEvent(deliveryPrisma(sink), {
          employeeId: EMP,
          todayIso: TODAY,
          body: { deliveredOn: TODAY, items: [{ itemId: ITEM }, { itemId: ITEM, quantity: 0 }] },
        }),
      (err: unknown) => err instanceof PeopleProfileAccessError && err.status === 400 && /Item 2/.test(err.message)
    );
  });

  it("item sem prazo: entrega válida, sem troca programada", async () => {
    const sink: AnyArgs = {};
    await createEpiDelivery(deliveryPrisma(sink, { item: { replacementDays: null } }), {
      employeeId: EMP,
      todayIso: TODAY,
      body: { itemId: ITEM, deliveredOn: "2026-10-10" },
    });
    assert.equal(sink.created.replacementDays, null);
    assert.equal(sink.created.replacementDueDate, null);
  });

  it("valida quantidade, data futura, item inativo, desligado e prazo ajustado sem justificativa", async () => {
    const create = (body: AnyArgs, over: AnyArgs = {}) =>
      createEpiDelivery(deliveryPrisma({}, over), { employeeId: EMP, todayIso: TODAY, body: { itemId: ITEM, deliveredOn: TODAY, ...body } });
    await assert.rejects(() => create({ quantity: 0 }), expectAccessError("INVALID_EPI_DELIVERY", 400));
    await assert.rejects(() => create({ quantity: 1.5 }), expectAccessError("INVALID_EPI_DELIVERY", 400));
    await assert.rejects(() => create({ deliveredOn: "2026-10-17" }), expectAccessError("INVALID_EPI_DELIVERY", 400));
    await assert.rejects(() => create({}, { item: { active: false } }), expectAccessError("EPI_ITEM_INACTIVE", 400));
    await assert.rejects(() => create({}, { employeeStatus: "INACTIVE" }), expectAccessError("EMPLOYEE_TERMINATED", 409));
    await assert.rejects(() => create({ replacementDays: 90 }), expectAccessError("INVALID_EPI_DELIVERY", 400));
    await assert.rejects(() => create({ replacementDueDate: "2027-01-01" }), expectAccessError("INVALID_EPI_DELIVERY", 400));
  });

  it("prazo ajustado com justificativa é aceito e registrado", async () => {
    const sink: AnyArgs = {};
    await createEpiDelivery(deliveryPrisma(sink), {
      employeeId: EMP,
      todayIso: TODAY,
      body: { itemId: ITEM, deliveredOn: "2026-10-16", replacementDays: 90, adjustReason: "Uso em ambiente com óleo, troca mais frequente" },
    });
    assert.equal(sink.created.replacementDays, 90);
    assert.equal((sink.created.replacementDueDate as Date).toISOString().slice(0, 10), "2027-01-14");
    assert.match(sink.created.replacementAdjustReason, /óleo/);
  });

  it("substituição: encerra a vigente como Substituído com guarda de concorrência", async () => {
    const sink: AnyArgs = {};
    const previous = { id: PREV, deliveredAt: new Date("2026-04-20T12:00:00.000Z"), status: "ACTIVE" };
    await createEpiDelivery(deliveryPrisma(sink, { previous }), {
      employeeId: EMP,
      todayIso: TODAY,
      body: { itemId: ITEM, deliveredOn: "2026-10-16", replacesDeliveryId: PREV },
    });
    const [upd] = sink.updates;
    assert.deepEqual(upd.where, { id: PREV, employeeId: EMP, status: "ACTIVE", replacedByDeliveryId: null });
    assert.equal(upd.data.status, "REPLACED");
    assert.equal(upd.data.replacedByDeliveryId, REC);
    assert.match(sink.history.notes, /substituição/);
  });

  it("substituição perde a corrida (já substituída) → 409 e a transação desfaz", async () => {
    const previous = { id: PREV, deliveredAt: new Date("2026-04-20T12:00:00.000Z"), status: "ACTIVE" };
    await assert.rejects(
      () =>
        createEpiDelivery(deliveryPrisma({}, { previous, updateCount: 0 }), {
          employeeId: EMP,
          todayIso: TODAY,
          body: { itemId: ITEM, deliveredOn: "2026-10-16", replacesDeliveryId: PREV },
        }),
      expectAccessError("EPI_NOT_ACTIVE", 409)
    );
    await assert.rejects(
      () =>
        createEpiDelivery(deliveryPrisma({}, { previous: { ...previous, status: "CANCELLED" } }), {
          employeeId: EMP,
          todayIso: TODAY,
          body: { itemId: ITEM, deliveredOn: "2026-10-16", replacesDeliveryId: PREV },
        }),
      expectAccessError("EPI_NOT_ACTIVE", 409)
    );
  });

  it("cancelar exige motivo; cancelar uma substituição devolve a anterior a Vigente", async () => {
    const updates: AnyArgs[] = [];
    let historyUpdate: AnyArgs | null = null;
    const prisma = fakePrisma({
      hrEpiDelivery: {
        findFirst: async () => ({
          id: REC,
          item: "Protetor auricular plug",
          itemCode: "EPI-0007",
          deliveredAt: new Date("2026-10-16T12:00:00.000Z"),
          status: "ACTIVE",
          replaces: { id: PREV },
        }),
        updateMany: async (args: AnyArgs) => {
          updates.push(args);
          return { count: 1 };
        },
      },
      hrEmployeeHistory: {
        findFirst: async () => ({ id: "hist-epi" }),
        updateMany: async (args: AnyArgs) => {
          historyUpdate = args;
          return { count: 1 };
        },
      },
    });
    await assert.rejects(
      () => setEpiDeliveryStatus(prisma, { employeeId: EMP, recordId: REC, action: "CANCEL", reason: "erro" }),
      expectAccessError("INVALID_REASON", 400)
    );
    const result = await setEpiDeliveryStatus(prisma, {
      employeeId: EMP,
      recordId: REC,
      action: "CANCEL",
      reason: "Lançado no colaborador errado",
    });
    assert.equal(result.status, "CANCELLED");
    assert.equal(updates[0].where.status, "ACTIVE");
    assert.equal(updates[0].data.status, "CANCELLED");
    assert.deepEqual(updates[1].where, { id: PREV, employeeId: EMP, status: "REPLACED", replacedByDeliveryId: REC });
    assert.equal(updates[1].data.status, "ACTIVE");
    assert.equal(result.restoredDeliveryId, PREV);
    assert.match(historyUpdate?.data.notes, /cancelada: Lançado no colaborador errado/);
  });

  it("encerrar/cancelar só a partir de Vigente", async () => {
    const prisma = fakePrisma({
      hrEpiDelivery: {
        findFirst: async () => ({ id: REC, item: "Botina", deliveredAt: new Date(), status: "REPLACED", replaces: null }),
        updateMany: async () => ({ count: 0 }),
      },
    });
    await assert.rejects(
      () => setEpiDeliveryStatus(prisma, { employeeId: EMP, recordId: REC, action: "CLOSE", reason: "Colaborador mudou de função" }),
      expectAccessError("EPI_NOT_ACTIVE", 409)
    );
  });

  it("entrega não é excluída fisicamente", async () => {
    await assert.rejects(
      () => deleteEpiDelivery(fakePrisma({ hrEpiDelivery: untouchable("hrEpiDelivery") }), { employeeId: EMP, recordId: REC }),
      expectAccessError("EPI_DELETE_NOT_ALLOWED", 405)
    );
  });

  it("retificação de entrega do catálogo: item imutável; cancelada não muda; prazo diferente exige justificativa", async () => {
    const row = (over: AnyArgs = {}) => ({
      id: REC,
      item: "Protetor auricular plug",
      itemCode: "EPI-0007",
      itemId: ITEM,
      deliveredAt: new Date("2026-10-16T12:00:00.000Z"),
      quantity: 1,
      size: null,
      notes: null,
      status: "ACTIVE",
      replacementDays: 180,
      replacementDueDate: new Date("2027-04-14T00:00:00.000Z"),
      eventId: "ev-1",
      catalogItem: { replacementDays: 180 },
      ...over,
    });
    const updates: AnyArgs[] = [];
    const eventUpdates: AnyArgs[] = [];
    const prismaFor = (r: AnyArgs) =>
      fakePrisma({
        hrEpiDelivery: {
          findFirst: async () => r,
          count: async () => 1,
          updateMany: async (args: AnyArgs) => {
            updates.push(args);
            return { count: 1 };
          },
        },
        hrEpiDeliveryEvent: { updateMany: async (args: AnyArgs) => ({ count: (eventUpdates.push(args), 1) }) },
        hrEmployeeHistory: { findFirst: async () => ({ id: "h" }), updateMany: async () => ({ count: 1 }) },
      });
    await assert.rejects(
      () => updateEpiDelivery(prismaFor(row()), { employeeId: EMP, recordId: REC, todayIso: TODAY, patch: { itemId: PREV } }),
      expectAccessError("EPI_ITEM_IMMUTABLE", 400)
    );
    await assert.rejects(
      () => updateEpiDelivery(prismaFor(row({ status: "CANCELLED" })), { employeeId: EMP, recordId: REC, todayIso: TODAY, patch: { quantity: 2 } }),
      expectAccessError("EPI_CANCELLED", 409)
    );
    await assert.rejects(
      () => updateEpiDelivery(prismaFor(row()), { employeeId: EMP, recordId: REC, todayIso: TODAY, patch: { replacementDueDate: "2027-01-10" } }),
      expectAccessError("INVALID_EPI_DELIVERY", 400)
    );
    // Data já ajustada (com justificativa gravada): corrigir outro campo não exige nova justificativa.
    await updateEpiDelivery(
      prismaFor(row({ replacementDueDate: new Date("2027-01-01T00:00:00.000Z"), replacementAdjustReason: "Desgaste acelerado na linha 3" })),
      { employeeId: EMP, recordId: REC, todayIso: TODAY, patch: { notes: "Entregue no vestiário" } }
    );
    const kept = updates[updates.length - 1];
    assert.equal((kept.data.replacementDueDate as Date).toISOString().slice(0, 10), "2027-01-01");
    assert.equal(kept.data.replacementAdjustReason, "Desgaste acelerado na linha 3");
    await updateEpiDelivery(prismaFor(row()), {
      employeeId: EMP,
      recordId: REC,
      todayIso: TODAY,
      patch: { quantity: 3, deliveredOn: "2026-10-15" },
    });
    const last = updates[updates.length - 1];
    assert.equal(last.data.quantity, 3);
    // Evento de um item: a data do evento acompanha.
    assert.equal((eventUpdates[eventUpdates.length - 1].data.deliveredAt as Date).toISOString(), "2026-10-15T12:00:00.000Z");
    // Mudou a data da entrega: a próxima troca é recalculada pelo prazo aplicado.
    assert.equal((last.data.replacementDueDate as Date).toISOString().slice(0, 10), "2027-04-13");
  });

  it("PATCH em linha legada (texto livre) sincroniza o evento e grava o vínculo", async () => {
    let historyUpdate: AnyArgs | null = null;
    const prisma = fakePrisma({
      hrEpiDelivery: {
        findFirst: async () => ({
          id: REC,
          item: "Botina",
          itemId: null,
          status: "ACTIVE",
          deliveredAt: new Date("2025-03-10T00:00:00.000Z"),
        }),
        updateMany: async () => ({ count: 1 }),
      },
      hrEmployeeHistory: {
        findFirst: async () => null,
        findMany: async () => [{ id: "hist-legacy", metadata: null }],
        updateMany: async (args: AnyArgs) => {
          historyUpdate = args;
          return { count: 1 };
        },
      },
    });
    await updateEpiDelivery(prisma, {
      employeeId: EMP,
      recordId: REC,
      todayIso: TODAY,
      patch: { item: "Botina de segurança", returnedAt: "2025-09-01" },
    });
    assert.deepEqual(historyUpdate?.where, { id: "hist-legacy", employeeId: EMP });
    assert.equal(historyUpdate?.data.notes, "Botina de segurança");
    assert.deepEqual(historyUpdate?.data.metadata, { recordType: "epiDelivery", recordId: REC });
  });
});

describe("findLinkedHistoryEvent", () => {
  it("sem legacy não tenta o casamento exato", async () => {
    const db = {
      hrEmployeeHistory: {
        findFirst: async () => null,
        findMany: async () => {
          throw new Error("não deveria consultar o legado");
        },
      },
    };
    const found = await findLinkedHistoryEvent(db as never, {
      employeeId: EMP,
      recordType: "note",
      recordId: REC,
    });
    assert.equal(found, null);
  });
});

describe("documentos e foto", () => {
  it("DELETE de documento remove a linha e o evento (janela legada pelo createdAt)", async () => {
    let legacyWhere: AnyArgs | null = null;
    const deleted: string[] = [];
    const createdAt = new Date("2026-04-01T12:00:00.000Z");
    const prisma = fakePrisma({
      hrEmployeeDocument: {
        findFirst: async () => ({
          id: REC,
          displayName: "ASO admissional",
          storageKey: `hremployeedocs/${EMP}/00000000-inexistente.pdf`,
          createdAt,
          uploadedByUserId: "u1",
        }),
        deleteMany: async () => {
          deleted.push("document");
          return { count: 1 };
        },
      },
      hrEpiDeliveryReceipt: { count: async () => 0 },
      hrEmployeeHistory: {
        findFirst: async () => null,
        findMany: async (args: AnyArgs) => {
          legacyWhere = args.where;
          return [{ id: "hist-doc", metadata: null }];
        },
        deleteMany: async (args: AnyArgs) => {
          deleted.push(`history:${args.where.id}`);
          return { count: 1 };
        },
      },
    });
    const result = await deleteEmployeeDocument(prisma, { employeeId: EMP, recordId: REC });
    assert.deepEqual(result, { ok: true });
    assert.deepEqual(deleted, ["history:hist-doc", "document"]);
    assert.deepEqual(legacyWhere?.eventType, { in: ["DOCUMENT_ADDED"] });
    assert.equal(legacyWhere?.notes, "ASO admissional");
    assert.equal(legacyWhere?.createdByUserId, "u1");
    assert.ok(legacyWhere?.effectiveDate.gte.getTime() < createdAt.getTime());
    assert.ok(legacyWhere?.effectiveDate.lte.getTime() > createdAt.getTime());
  });

  it("documento que é comprovante de entrega de EPI não é excluído → 409", async () => {
    const prisma = fakePrisma({
      hrEmployeeDocument: {
        findFirst: async () => ({ id: REC, displayName: "Ficha EPI", storageKey: "k", createdAt: new Date(), uploadedByUserId: null }),
        deleteMany: async () => {
          throw new Error("não deveria excluir");
        },
      },
      hrEpiDeliveryReceipt: { count: async (args: AnyArgs) => (args.where.documentId === REC ? 1 : 0) },
      hrEmployeeHistory: untouchable("hrEmployeeHistory"),
    });
    await assert.rejects(
      () => deleteEmployeeDocument(prisma, { employeeId: EMP, recordId: REC }),
      expectAccessError("DOCUMENT_IN_USE", 409)
    );
  });

  it("foto que não é JPEG/PNG/WebP → 400 antes de gravar arquivo ou banco", async () => {
    const prisma = {
      $transaction: async () => {
        throw new Error("não deveria abrir transação");
      },
    } as never;
    await assert.rejects(
      () =>
        saveEmployeePhoto({
          prisma,
          employeeId: EMP,
          buffer: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>"),
        }),
      expectAccessError("INVALID_PHOTO", 400)
    );
  });
});

describe("recordPayrollComponentHistory — verbas marcadas no cadastro", () => {
  it("grava BENEFIT_CHANGE por verba incluída/removida, com nome e vínculo por metadata", async () => {
    const created: AnyArgs[] = [];
    // Chamada dentro do PUT com o tx já aberto: recebe o cliente direto, sem $transaction.
    const prisma = {
      payrollComponent: {
        findMany: async (args: AnyArgs) => {
          assert.deepEqual(args.where, { id: { in: ["pc-vr", "pc-fgts"] } });
          return [
            { id: "pc-vr", name: "Vale Refeição" },
            { id: "pc-fgts", name: "FGTS" },
          ];
        },
      },
      hrEmployeeHistory: {
        create: async (args: AnyArgs) => {
          created.push(args.data);
          return { id: `hist-${created.length}` };
        },
      },
    } as never;
    const effectiveDate = new Date("2026-09-22T12:00:00.000Z");
    const count = await recordPayrollComponentHistory(prisma, {
      employeeId: EMP,
      previousIds: ["pc-fgts", "pc-inss"],
      nextIds: ["pc-inss", "pc-vr"],
      actorUserId: "u1",
      effectiveDate,
    });
    assert.equal(count, 2);
    assert.deepEqual(
      created.map((d) => [d.eventType, d.notes, d.metadata]),
      [
        ["BENEFIT_CHANGE", "Vale Refeição incluído", { recordType: "payrollComponent", recordId: "pc-vr" }],
        ["BENEFIT_CHANGE", "FGTS removido", { recordType: "payrollComponent", recordId: "pc-fgts" }],
      ]
    );
    assert.equal(created[0].effectiveDate, effectiveDate);
    assert.equal(created[0].createdByUserId, "u1");
  });

  it("sem mudança não consulta nem grava nada", async () => {
    const prisma = {
      payrollComponent: untouchable("payrollComponent"),
      hrEmployeeHistory: untouchable("hrEmployeeHistory"),
    } as never;
    assert.equal(
      await recordPayrollComponentHistory(prisma, {
        employeeId: EMP,
        previousIds: ["pc-vr"],
        nextIds: ["pc-vr"],
      }),
      0
    );
  });
});
describe("deletePayrollComponentWithHistory — excluir verba do cadastro oficial", () => {
  const PC = "55555555-5555-4555-8555-555555555555";
  const EMP_B = "66666666-6666-4666-8666-666666666666";

  it("registra a remoção no histórico de cada colaborador e exclui a verba", async () => {
    const history: AnyArgs[] = [];
    let deleted: AnyArgs | null = null;
    const prisma = fakePrisma({
      payrollComponent: {
        findUnique: async (args: AnyArgs) => {
          assert.deepEqual(args.where, { id: PC });
          return { id: PC, name: "Vale Refeição" };
        },
        delete: async (args: AnyArgs) => {
          deleted = args.where;
          return { id: PC };
        },
      },
      employeePayrollComponent: {
        findMany: async (args: AnyArgs) => {
          assert.deepEqual(args.where, { payrollComponentId: PC });
          return [{ employeeId: EMP }, { employeeId: EMP_B }];
        },
      },
      hrEmployeeHistory: {
        create: async (args: AnyArgs) => {
          history.push(args.data);
          return { id: `h${history.length}` };
        },
      },
    });
    const result = await deletePayrollComponentWithHistory(prisma, {
      payrollComponentId: PC,
      actorUserId: "root",
    });
    assert.deepEqual(result, { name: "Vale Refeição", affectedEmployees: 2 });
    assert.deepEqual(deleted, { id: PC });
    assert.deepEqual(
      history.map((h) => [h.employeeId, h.eventType, h.notes, h.reason, h.createdByUserId]),
      [
        [EMP, "BENEFIT_CHANGE", "Vale Refeição removido", "Verba excluída do cadastro oficial", "root"],
        [EMP_B, "BENEFIT_CHANGE", "Vale Refeição removido", "Verba excluída do cadastro oficial", "root"],
      ]
    );
    assert.deepEqual(history[0].metadata, { recordType: "payrollComponent", recordId: PC });
  });

  it("sem colaboradores: só exclui", async () => {
    let deleted = false;
    const prisma = fakePrisma({
      payrollComponent: {
        findUnique: async () => ({ id: PC, name: "FGTS" }),
        delete: async () => {
          deleted = true;
          return { id: PC };
        },
      },
      employeePayrollComponent: { findMany: async () => [] },
      hrEmployeeHistory: untouchable("hrEmployeeHistory"),
    });
    const result = await deletePayrollComponentWithHistory(prisma, { payrollComponentId: PC });
    assert.equal(result.affectedEmployees, 0);
    assert.equal(deleted, true);
  });

  it("verba inexistente → 404 sem excluir nada; id inválido → 400 antes do banco", async () => {
    const prisma = fakePrisma({
      payrollComponent: {
        findUnique: async () => null,
        delete: async () => {
          throw new Error("não deveria excluir");
        },
      },
      employeePayrollComponent: untouchable("employeePayrollComponent"),
    });
    await assert.rejects(
      () => deletePayrollComponentWithHistory(prisma, { payrollComponentId: PC }),
      expectAccessError("NOT_FOUND", 404)
    );
    await assert.rejects(
      () =>
        deletePayrollComponentWithHistory(untouchable("prisma") as never, {
          payrollComponentId: "nao-e-uuid",
        }),
      expectAccessError("INVALID_ID", 400)
    );
  });

  it("server.ts: exclusão da verba exige SUPER_ADMIN e passa pela função com histórico", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../../server.ts", import.meta.url), "utf8");
    const start = src.indexOf('app.delete("/api/payroll-components/:id"');
    assert.ok(start > 0);
    const route = src.slice(start, src.indexOf("});", src.indexOf("deletePayrollComponentWithHistory(prisma", start)) + 3);
    assert.ok(route.includes('authUser.role !== "SUPER_ADMIN"'));
    assert.ok(route.includes("deletePayrollComponentWithHistory(prisma"));
    assert.ok(!route.includes("prisma.payrollComponent.delete("));
  });
});
