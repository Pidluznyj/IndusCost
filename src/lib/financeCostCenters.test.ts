import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  createFinancialCostCenter,
  FinanceCostCenterValidationError,
  isFinanceCostCenterListStatusAll,
  listFinancialCostCenters,
  normalizeFinanceCostCenterCode,
  parseFinanceCostCentersListQuery,
  parseFinanceCostCenterCreateBody,
  parseFinanceCostCenterUpdateBody,
  serializeFinanceCostCenter,
  updateFinancialCostCenter,
  wouldCreateCircularFinanceCostCenterParent,
  type FinanceCostCenterRecord,
  type FinanceCostCentersDeps,
} from "./financeCostCenters.js";

type MockState = {
  centers: FinanceCostCenterRecord[];
  activeRulesByCenterId: Map<string, number>;
  nextId: number;
};

function now(): Date {
  return new Date("2026-06-17T12:00:00.000Z");
}

function seedCenter(
  state: MockState,
  overrides: Partial<FinanceCostCenterRecord> = {}
): FinanceCostCenterRecord {
  const id = overrides.id ?? `cc-${state.nextId++}`;
  const row: FinanceCostCenterRecord = {
    id,
    code: overrides.code ?? `CC-${id}`,
    name: overrides.name ?? `Centro ${id}`,
    description: overrides.description ?? null,
    parentId: overrides.parentId ?? null,
    responsibleUserId: overrides.responsibleUserId ?? null,
    responsibleName: overrides.responsibleName ?? null,
    status: overrides.status ?? "ACTIVE",
    color: overrides.color ?? null,
    icon: overrides.icon ?? null,
    createdAt: overrides.createdAt ?? now(),
    updatedAt: overrides.updatedAt ?? now(),
  };
  state.centers.push(row);
  return row;
}

function createMockDeps(state: MockState): FinanceCostCentersDeps {
  return {
    listCenters: async (query) => {
      const rows = [...state.centers];
      if (query?.status && query.status !== "all") {
        return rows.filter((row) => row.status === query.status);
      }
      return rows.sort((a, b) => a.code.localeCompare(b.code));
    },
    findCenterById: async (id) => state.centers.find((row) => row.id === id) ?? null,
    findCenterByCode: async (code) => state.centers.find((row) => row.code === code) ?? null,
    createCenter: async (data) => {
      const row = seedCenter(state, {
        code: normalizeFinanceCostCenterCode(String(data.code)),
        name: String(data.name),
        description: (data.description as string | null) ?? null,
        parentId: (data.parentId as string | null) ?? null,
        responsibleUserId: (data.responsibleUserId as string | null) ?? null,
        responsibleName: (data.responsibleName as string | null) ?? null,
        status: (data.status as FinanceCostCenterRecord["status"]) ?? "ACTIVE",
        color: (data.color as string | null) ?? null,
        icon: (data.icon as string | null) ?? null,
      });
      return row;
    },
    updateCenter: async (id, data) => {
      const idx = state.centers.findIndex((row) => row.id === id);
      assert.ok(idx >= 0, "center not found");
      const current = state.centers[idx]!;
      const updated: FinanceCostCenterRecord = {
        ...current,
        code: (data.code as string | undefined) ?? current.code,
        name: (data.name as string | undefined) ?? current.name,
        description: (data.description as string | null | undefined) ?? current.description,
        parentId: (data.parentId as string | null | undefined) ?? current.parentId,
        responsibleUserId:
          (data.responsibleUserId as string | null | undefined) ?? current.responsibleUserId,
        responsibleName:
          (data.responsibleName as string | null | undefined) ?? current.responsibleName,
        status: (data.status as FinanceCostCenterRecord["status"] | undefined) ?? current.status,
        color: (data.color as string | null | undefined) ?? current.color,
        icon: (data.icon as string | null | undefined) ?? current.icon,
        updatedAt: now(),
      };
      state.centers[idx] = updated;
      return updated;
    },
    countActiveRulesForCenter: async (costCenterId) =>
      state.activeRulesByCenterId.get(costCenterId) ?? 0,
  };
}

function assertDtoHasNoUndefined(dto: ReturnType<typeof serializeFinanceCostCenter>): void {
  for (const [key, value] of Object.entries(dto)) {
    assert.notEqual(value, undefined, `${key} não deve ser undefined`);
    if (typeof value === "number") assert.ok(!Number.isNaN(value));
  }
}

describe("financeCostCenters", () => {
  it("1. lista centros", async () => {
    const state: MockState = { centers: [], activeRulesByCenterId: new Map(), nextId: 1 };
    seedCenter(state, { code: "ADM", name: "Administrativo" });
    seedCenter(state, { code: "LOG", name: "Logística" });
    const deps = createMockDeps(state);
    const result = await listFinancialCostCenters(deps);
    assert.equal(result.items.length, 2);
    assert.equal(result.items[0]!.code, "ADM");
    result.items.forEach(assertDtoHasNoUndefined);
  });

  it("2. cria centro", async () => {
    const state: MockState = { centers: [], activeRulesByCenterId: new Map(), nextId: 1 };
    const deps = createMockDeps(state);
    const created = await createFinancialCostCenter(deps, {
      code: "mkt-01",
      name: "Marketing",
      description: "Despesas de marketing",
      color: "#336699",
    });
    assert.equal(created.code, "MKT-01");
    assert.equal(created.name, "Marketing");
    assert.equal(created.status, "ACTIVE");
    assert.equal(state.centers.length, 1);
    assertDtoHasNoUndefined(created);
  });

  it("3. não cria código duplicado", async () => {
    const state: MockState = { centers: [], activeRulesByCenterId: new Map(), nextId: 1 };
    const deps = createMockDeps(state);
    await createFinancialCostCenter(deps, { code: "ADM", name: "Admin" });
    await assert.rejects(
      () => createFinancialCostCenter(deps, { code: "adm", name: "Outro" }),
      (error: unknown) =>
        error instanceof FinanceCostCenterValidationError && error.code === "DUPLICATE_CODE"
    );
  });

  it("4. edita centro", async () => {
    const state: MockState = { centers: [], activeRulesByCenterId: new Map(), nextId: 1 };
    const deps = createMockDeps(state);
    const created = await createFinancialCostCenter(deps, { code: "OPS", name: "Operações" });
    const updated = await updateFinancialCostCenter(deps, created.id, {
      name: "Operações Industriais",
      responsibleName: "Paulo",
    });
    assert.equal(updated.name, "Operações Industriais");
    assert.equal(updated.responsibleName, "Paulo");
    assert.equal(updated.code, "OPS");
  });

  it("5. inativa centro", async () => {
    const state: MockState = { centers: [], activeRulesByCenterId: new Map(), nextId: 1 };
    const deps = createMockDeps(state);
    const created = await createFinancialCostCenter(deps, { code: "TMP", name: "Temporário" });
    const inactive = await updateFinancialCostCenter(deps, created.id, { status: "INACTIVE" });
    assert.equal(inactive.status, "INACTIVE");
  });

  it("5b. não inativa centro com regra ativa", async () => {
    const state: MockState = { centers: [], activeRulesByCenterId: new Map(), nextId: 1 };
    const deps = createMockDeps(state);
    const created = await createFinancialCostCenter(deps, { code: "RUL", name: "Com Regra" });
    state.activeRulesByCenterId.set(created.id, 2);
    await assert.rejects(
      () => updateFinancialCostCenter(deps, created.id, { status: "INACTIVE" }),
      (error: unknown) =>
        error instanceof FinanceCostCenterValidationError &&
        error.code === "ACTIVE_RULES_BLOCK_INACTIVATION"
    );
  });

  it("6. não cria hierarquia circular", async () => {
    const state: MockState = { centers: [], activeRulesByCenterId: new Map(), nextId: 1 };
    const deps = createMockDeps(state);
    const parent = await createFinancialCostCenter(deps, { code: "PARENT", name: "Pai" });
    const child = await createFinancialCostCenter(deps, {
      code: "CHILD",
      name: "Filho",
      parentId: parent.id,
    });
    assert.equal(
      wouldCreateCircularFinanceCostCenterParent(parent.id, child.id, state.centers),
      true
    );
    await assert.rejects(
      () => updateFinancialCostCenter(deps, parent.id, { parentId: child.id }),
      (error: unknown) =>
        error instanceof FinanceCostCenterValidationError && error.code === "CIRCULAR_PARENT"
    );
  });

  it("7. permissões aplicadas", () => {
    const routes = readFileSync(join(process.cwd(), "src/lib/financeCostCentersRoutes.ts"), "utf8");
    const server = readFileSync(join(process.cwd(), "server.ts"), "utf8");
    assert.match(routes, /FINANCE_COST_CENTERS_VIEW_PERMISSIONS/);
    assert.match(routes, /finance\.cost_centers\.view/);
    assert.match(routes, /FINANCE_COST_CENTERS_MANAGE_PERMISSIONS/);
    assert.match(routes, /finance\.cost_centers\.manage/);
    assert.match(routes, /\/api\/finance\/cost-centers/);
    assert.match(routes, /\/api\/finance\/cost-center-audit/);
    assert.match(routes, /FINANCE_COST_CENTER_AUDIT_VIEW_PERMISSIONS/);
    assert.match(server, /registerFinanceCostCentersRoutes/);
  });

  it("8. não altera AP", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/financeCostCenters.ts"), "utf8");
    assert.doesNotMatch(src, /nomusAccountsPayable\.update/);
    assert.doesNotMatch(src, /nomusAccountsPayable\.delete/);
    assert.doesNotMatch(src, /nomusAccountsPayable\.create/);
    assert.doesNotMatch(src, /AccountsPayableCostCenterAllocation\.create/);
  });

  it("9. não usa CostCenter produtivo", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/financeCostCenters.ts"), "utf8");
    const routes = readFileSync(join(process.cwd(), "src/lib/financeCostCentersRoutes.ts"), "utf8");
    assert.doesNotMatch(src, /prisma\.costCenter/);
    assert.doesNotMatch(routes, /\/api\/cost-centers/);
    assert.match(src, /prisma\.financialCostCenter/);
  });

  it("10. não retorna NaN/undefined", async () => {
    const state: MockState = { centers: [], activeRulesByCenterId: new Map(), nextId: 1 };
    const deps = createMockDeps(state);
    const created = await createFinancialCostCenter(deps, {
      code: "FIN",
      name: "Financeiro",
    });
    assertDtoHasNoUndefined(created);
    const listed = await listFinancialCostCenters(deps);
    listed.items.forEach(assertDtoHasNoUndefined);
  });

  it("11. listagem aceita status all/Todos/vazio sem erro", async () => {
    const state: MockState = { centers: [], activeRulesByCenterId: new Map(), nextId: 1 };
    seedCenter(state, { code: "A1", status: "ACTIVE" });
    seedCenter(state, { code: "I1", status: "INACTIVE" });
    const deps = createMockDeps(state);

    assert.deepEqual(parseFinanceCostCentersListQuery({}), { status: "all" });
    assert.deepEqual(parseFinanceCostCentersListQuery({ status: "" }), { status: "all" });
    assert.deepEqual(parseFinanceCostCentersListQuery({ status: "all" }), { status: "all" });
    assert.deepEqual(parseFinanceCostCentersListQuery({ status: "Todos" }), { status: "all" });
    assert.deepEqual(parseFinanceCostCentersListQuery({ status: "TODOS" }), { status: "all" });
    assert.ok(isFinanceCostCenterListStatusAll(undefined));
    assert.ok(isFinanceCostCenterListStatusAll(null));

    const all = await listFinancialCostCenters(deps, { status: "all" });
    assert.equal(all.items.length, 2);

    const empty = await listFinancialCostCenters(deps, parseFinanceCostCentersListQuery({ status: "" }));
    assert.equal(empty.items.length, 2);
  });

  it("12. listagem filtra ACTIVE e INACTIVE", async () => {
    const state: MockState = { centers: [], activeRulesByCenterId: new Map(), nextId: 1 };
    seedCenter(state, { code: "A1", status: "ACTIVE" });
    seedCenter(state, { code: "A2", status: "ACTIVE" });
    seedCenter(state, { code: "I1", status: "INACTIVE" });
    const deps = createMockDeps(state);

    const active = await listFinancialCostCenters(deps, { status: "ACTIVE" });
    assert.equal(active.items.length, 2);
    assert.ok(active.items.every((row) => row.status === "ACTIVE"));

    const inactive = await listFinancialCostCenters(deps, { status: "INACTIVE" });
    assert.equal(inactive.items.length, 1);
    assert.equal(inactive.items[0]!.status, "INACTIVE");
  });

  it("13. create/update rejeitam status inválido", async () => {
    assert.throws(
      () => parseFinanceCostCenterCreateBody({ code: "X", name: "Teste", status: "OPEN" }),
      (error: unknown) =>
        error instanceof FinanceCostCenterValidationError && error.code === "INVALID_STATUS"
    );

    assert.throws(
      () => parseFinanceCostCenterUpdateBody({ status: "Todos" }),
      (error: unknown) =>
        error instanceof FinanceCostCenterValidationError && error.code === "INVALID_STATUS"
    );

    assert.throws(
      () => parseFinanceCostCenterCreateBody({ code: "Z", name: "Z", status: "invalid" }),
      (error: unknown) =>
        error instanceof FinanceCostCenterValidationError && error.code === "INVALID_STATUS"
    );
  });
});
