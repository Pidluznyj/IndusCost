/**
 * Metas (OKR) — banco FAKE em memória para testes do service.
 *
 * Transações revertem DE VERDADE (snapshot do estado antes, restauração no
 * throw) — é o que permite provar atomicidade e rollback sem Postgres.
 * Usado por goalAuthorizationAtomicity.test.ts e goalGovernance.test.ts.
 * NÃO importar fora de teste.
 */

import type { PrismaClient } from "@prisma/client";

export type FakeGoalDbHooks = {
  /** false → advisory lock negado (medição concorrente). */
  locked?: () => boolean;
  /** true → a query da REGRA falha com erro "sujo" (SQL/segredo). */
  ruleFails?: () => boolean;
  /** Valor devolvido pela regra. */
  ruleValue?: () => string;
  failOnKrUpdateMany?: () => boolean;
  failOnQuotaCreate?: () => boolean;
  /** Nomes de usuário por id (resolveActorName). */
  userNames?: Map<string, string>;
};

type Row = Record<string, unknown>;

export function createFakeGoalDb(hooks: FakeGoalDbHooks = {}) {
  const state = {
    goals: new Map<string, Row>(),
    krs: new Map<string, Row>(),
    quotas: [] as Row[],
    snapshots: new Map<string, Row>(),
    versions: [] as Row[],
    audits: [] as Row[],
  };
  let seq = 0;
  const newId = () => {
    seq += 1;
    return `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
  };

  const snapshotState = () => ({
    goals: new Map([...state.goals].map(([k, v]) => [k, { ...v }])),
    krs: new Map([...state.krs].map(([k, v]) => [k, { ...v }])),
    quotas: state.quotas.map((q) => ({ ...q })),
    snapshots: new Map([...state.snapshots].map(([k, v]) => [k, { ...v }])),
    versions: state.versions.map((v) => ({ ...v })),
    audits: state.audits.map((a) => ({ ...a })),
  });
  const restoreState = (backup: ReturnType<typeof snapshotState>) => {
    state.goals = backup.goals;
    state.krs = backup.krs;
    state.quotas = backup.quotas;
    state.snapshots = backup.snapshots;
    state.versions = backup.versions;
    state.audits = backup.audits;
  };

  const versionsFor = (krId: string) =>
    state.versions
      .filter((v) => v.keyResultId === krId)
      .sort((a, b) => Number(b.version) - Number(a.version));

  const krWithIncludes = (kr: Row) => ({
    ...kr,
    owner: null,
    quotas: state.quotas
      .filter((q) => q.keyResultId === kr.id)
      .map((q) => ({ ...q, assignee: null })),
    versions: versionsFor(kr.id as string)
      .slice(0, 1)
      .map((v) => ({
        version: v.version,
        source: v.source,
        createdAt: v.createdAt,
        actorName: v.actorName ?? null,
      })),
  });
  const goalWithIncludes = (goal: Row) => ({
    ...goal,
    owner: null,
    keyResults: [...state.krs.values()]
      .filter((kr) => kr.goalId === goal.id)
      .map(krWithIncludes),
    initiatives: [],
  });

  const dateFieldMatches = (value: unknown, cond: Record<string, Date>) => {
    if (!(value instanceof Date)) return false;
    if (cond.lt) return value.getTime() < cond.lt.getTime();
    if (cond.gt) return value.getTime() > cond.gt.getTime();
    return false;
  };
  const krMatchesDateWhere = (kr: Row, where: Row): boolean => {
    if (where.goalId && kr.goalId !== where.goalId) return false;
    for (const field of ["startDate", "endDate"] as const) {
      const cond = where[field] as Record<string, Date> | undefined;
      if (cond && !dateFieldMatches(kr[field], cond)) return false;
    }
    return true;
  };

  const client: Record<string, unknown> = {
    appUser: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const name = hooks.userNames?.get(where.id);
        return name ? { name } : null;
      },
    },
    goal: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const goal = state.goals.get(where.id);
        return goal ? goalWithIncludes(goal) : null;
      },
      update: async ({ where, data }: { where: { id: string }; data: Row }) => {
        const goal = state.goals.get(where.id);
        if (!goal) throw new Error("not found");
        Object.assign(goal, data, { updatedAt: new Date() });
        return goalWithIncludes(goal);
      },
    },
    goalKeyResult: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const kr = state.krs.get(where.id);
        if (!kr) return null;
        const goal = state.goals.get(kr.goalId as string)!;
        return { ...krWithIncludes(kr), goal: { ...goal } };
      },
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const kr = state.krs.get(where.id);
        if (!kr) throw new Error("not found");
        return krWithIncludes(kr);
      },
      findMany: async ({ where }: { where?: Row } = {}) => {
        let rows = [...state.krs.values()];
        if (where?.goalId) rows = rows.filter((kr) => kr.goalId === where.goalId);
        if (where?.title) rows = rows.filter((kr) => kr.title === where.title);
        if (where?.status === "ACTIVE") rows = rows.filter((kr) => kr.status === "ACTIVE");
        if (Array.isArray(where?.OR)) {
          rows = rows.filter((kr) =>
            (where!.OR as Row[]).some((cond) =>
              krMatchesDateWhere(kr, { ...cond, goalId: where!.goalId })
            )
          );
        }
        return rows.map((kr) => ({
          ...krWithIncludes(kr),
          goal: { ...state.goals.get(kr.goalId as string)! },
        }));
      },
      create: async ({ data }: { data: Row }) => {
        const id = newId();
        const row: Row = {
          id,
          status: "ACTIVE",
          achievedValue: data.achievedValue ?? "0",
          measurementStatus: "MANUAL",
          lastMeasurementAt: null,
          lastMeasurementError: null,
          startDate: null,
          endDate: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        state.krs.set(id, row);
        return { ...row };
      },
      update: async ({ where, data }: { where: { id: string }; data: Row }) => {
        const kr = state.krs.get(where.id);
        if (!kr) throw new Error("not found");
        Object.assign(kr, data, { updatedAt: new Date() });
        return krWithIncludes(kr);
      },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        if (hooks.failOnKrUpdateMany?.()) {
          throw new Error("simulated updateMany failure");
        }
        let count = 0;
        for (const kr of state.krs.values()) {
          if (!krMatchesDateWhere(kr, where)) continue;
          if (where.status && typeof where.status === "object") {
            const not = (where.status as { not?: string }).not;
            if (not && kr.status === not) continue;
          }
          Object.assign(kr, data);
          count += 1;
        }
        return { count };
      },
      delete: async ({ where }: { where: { id: string } }) => {
        const kr = state.krs.get(where.id);
        if (!kr) throw new Error("not found");
        state.krs.delete(where.id);
        // Cascade das versões (como no banco real).
        state.versions = state.versions.filter((v) => v.keyResultId !== where.id);
        return kr;
      },
      deleteMany: async ({ where }: { where: { goalId?: string } }) => {
        for (const [id, kr] of [...state.krs]) {
          if (!where.goalId || kr.goalId === where.goalId) {
            state.krs.delete(id);
            state.versions = state.versions.filter((v) => v.keyResultId !== id);
          }
        }
        return { count: 0 };
      },
    },
    goalKeyResultQuota: {
      create: async ({ data }: { data: Row }) => {
        if (hooks.failOnQuotaCreate?.()) {
          throw new Error("simulated quota failure");
        }
        const row = { id: newId(), ...data };
        state.quotas.push(row);
        return { ...row };
      },
      deleteMany: async ({ where }: { where: { keyResultId?: string; keyResult?: { goalId: string } } }) => {
        state.quotas = state.quotas.filter((q) => {
          if (where.keyResultId) return q.keyResultId !== where.keyResultId;
          if (where.keyResult?.goalId) {
            const kr = state.krs.get(q.keyResultId as string);
            return kr?.goalId !== where.keyResult.goalId;
          }
          return true;
        });
        return { count: 0 };
      },
    },
    goalKeyResultVersion: {
      create: async ({ data }: { data: Row }) => {
        const row = { id: newId(), createdAt: new Date(), ...data };
        state.versions.push(row);
        return { ...row };
      },
      count: async ({ where }: { where: Row }) => {
        return state.versions.filter((v) => {
          if (where.keyResultId && v.keyResultId !== where.keyResultId) return false;
          const krWhere = where.keyResult as { goalId?: string } | undefined;
          if (krWhere?.goalId) {
            const kr = state.krs.get(v.keyResultId as string);
            if (kr?.goalId !== krWhere.goalId) return false;
          }
          const versionCond = where.version as { gt?: number } | undefined;
          if (versionCond?.gt != null && !(Number(v.version) > versionCond.gt)) return false;
          return true;
        }).length;
      },
    },
    goalAuditLog: {
      create: async ({ data }: { data: Row }) => {
        const row = { id: newId(), createdAt: new Date(), ...data };
        state.audits.push(row);
        return { ...row };
      },
    },
    goalInitiative: {
      findUnique: async () => null,
      deleteMany: async () => ({ count: 0 }),
    },
    goalKeyResultSnapshot: {
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { keyResultId_snapshotDate: { keyResultId: string; snapshotDate: Date } };
        create: Row;
        update: Row;
      }) => {
        const key = `${where.keyResultId_snapshotDate.keyResultId}|${where.keyResultId_snapshotDate.snapshotDate.toISOString()}`;
        const existing = state.snapshots.get(key);
        if (existing) Object.assign(existing, update);
        else state.snapshots.set(key, { ...create });
        return state.snapshots.get(key);
      },
      count: async ({ where }: { where: Row }) => {
        const krId = where?.keyResultId as string | undefined;
        const goalId = (where?.keyResult as { goalId?: string } | undefined)?.goalId;
        return [...state.snapshots.values()].filter((s) => {
          if (krId) return s.keyResultId === krId;
          if (goalId) {
            const kr = state.krs.get(s.keyResultId as string);
            return kr?.goalId === goalId;
          }
          return true;
        }).length;
      },
      findMany: async ({ where }: { where: { keyResultId: string } }) =>
        [...state.snapshots.values()]
          .filter((s) => s.keyResultId === where.keyResultId)
          .sort(
            (a, b) =>
              (a.snapshotDate as Date).getTime() - (b.snapshotDate as Date).getTime()
          ),
    },
    $queryRaw: async (first: unknown) => {
      const text = Array.isArray(first)
        ? (first as string[]).join("?")
        : String(
            (first as { sql?: string; strings?: string[] })?.sql ??
              (first as { strings?: string[] })?.strings?.join("?") ??
              first
          );
      if (text.includes("pg_try_advisory_xact_lock")) {
        return [{ locked: hooks.locked ? hooks.locked() : true }];
      }
      if (hooks.ruleFails?.()) {
        throw new Error(
          "connect ECONNREFUSED — SELECT secret FROM pg_shadow WHERE passwd='s3cr3t'"
        );
      }
      return [{ value: hooks.ruleValue ? hooks.ruleValue() : "500" }];
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const backup = snapshotState();
      try {
        return await fn(client);
      } catch (err) {
        restoreState(backup);
        throw err;
      }
    },
  };

  const seedGoal = (overrides: Row = {}) => {
    const id = newId();
    const row: Row = {
      id,
      title: "Objetivo",
      description: null,
      startDate: new Date("2026-01-01T00:00:00.000Z"),
      endDate: new Date("2026-12-31T00:00:00.000Z"),
      status: "ACTIVE",
      ownerAppUserId: "11111111-1111-4111-8111-111111111111",
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
    state.goals.set(id, row);
    return row;
  };
  const seedKr = (goalId: string, overrides: Row = {}) => {
    const id = newId();
    const row: Row = {
      id,
      goalId,
      title: "Indicador",
      domain: "COMERCIAL",
      trackingType: "INCREASE",
      baseline: "0",
      target: "1000",
      achievedValue: "0",
      unit: null,
      weight: "1",
      ownerAppUserId: "22222222-2222-4222-8222-222222222222",
      manualTracking: true,
      ruleJson: null,
      measurementStatus: "MANUAL",
      lastMeasurementAt: null,
      lastMeasurementError: null,
      status: "ACTIVE",
      startDate: null,
      endDate: null,
      targetBasis: "MANUAL",
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
    state.krs.set(id, row);
    return row;
  };
  const seedSnapshot = (keyResultId: string, snapshotDate: Date, overrides: Row = {}) => {
    const key = `${keyResultId}|${snapshotDate.toISOString()}`;
    const row: Row = {
      keyResultId,
      snapshotDate,
      achievedValue: "100",
      progressRatio: "0.100000",
      source: "MANUAL",
      createdAt: new Date(),
      ...overrides,
    };
    state.snapshots.set(key, row);
    return row;
  };

  return {
    client: client as unknown as PrismaClient,
    state,
    seedGoal,
    seedKr,
    seedSnapshot,
  };
}
