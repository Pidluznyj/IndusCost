/**
 * Banco simulado + app Express de teste para Competências e Desenvolvimento.
 * Só os modelos do domínio existem; qualquer outro acesso falha (fronteira de domínio).
 */
import http from "node:http";
import { randomUUID } from "node:crypto";
import express, { type RequestHandler } from "express";
import type { CompetencyDb } from "./competency.server";
import { registerCompetencyRoutes } from "./competencyRoutes";
import type { PeopleAccessScope } from "../peopleProfileTypes";

type Row = Record<string, unknown> & { id: string };

const MODELS = [
  "employee",
  "hrDepartment",
  "hrDepartmentCompetency",
  "hrDepartmentCompetencyShift",
  "hrCompetency",
  "hrWorkPosition",
  "hrWorkPositionRequirement",
  "hrEmployeeWorkPosition",
  "hrEmployeeCompetencyLevel",
  "hrEmployeeCompetencyLevelHistory",
  "hrCompetencyAssessment",
  "hrCompetencyAssessmentItem",
  "hrTraining",
  "hrTrainingParticipant",
  "hrCompetencyImportBatch",
  "hrCompetencyLevelRequest",
  "hrTrainingCertificate",
  "hrTrainingCertificateSettings",
  "brandingSettings",
] as const;
export type FakeModel = (typeof MODELS)[number];

/** Cascatas do schema (onDelete: Cascade). */
const CASCADES: Partial<Record<FakeModel, { model: FakeModel; fk: string }[]>> = {
  hrCompetencyAssessment: [{ model: "hrCompetencyAssessmentItem", fk: "assessmentId" }],
  hrTraining: [{ model: "hrTrainingParticipant", fk: "trainingId" }],
  hrWorkPosition: [{ model: "hrWorkPositionRequirement", fk: "positionId" }],
  hrDepartmentCompetency: [{ model: "hrDepartmentCompetencyShift", fk: "departmentCompetencyId" }],
};

/** Defaults de coluna relevantes para as consultas. */
const DEFAULTS: Partial<Record<FakeModel, Record<string, unknown>>> = {
  hrEmployeeWorkPosition: { endedAt: null },
  hrTrainingParticipant: { completedAt: null },
  hrTraining: { completedAt: null, validityMonths: 0, status: "SCHEDULED", instructorName: null, syllabus: null },
  hrTrainingCertificate: { status: "ACTIVE", canceledAt: null, canceledByUserId: null, canceledByName: null, cancelReason: null },
  hrCompetencyAssessment: { status: "PENDING", averageLevel: null, completedAt: null, notes: null },
  hrCompetency: { status: "ACTIVE", sortOrder: 0, description: null, requiresRecycling: false, critical: false },
  hrEmployeeCompetencyLevel: { version: 1 },
  hrCompetencyLevelRequest: { status: "PENDING", decidedAt: null, decidedByUserId: null, decisionNote: null, importBatchId: null },
  hrWorkPosition: { status: "ACTIVE", departmentId: null },
  hrEmployeeCompetencyLevelHistory: { assessmentId: null, importBatchId: null, requestId: null },
  hrCompetencyImportBatch: { conflictAppliedCount: 0, summary: null },
  hrDepartmentCompetency: { appliesToAllShifts: true },
};

function matchValue(actual: unknown, cond: unknown): boolean {
  if (cond === null) return actual == null;
  if (cond instanceof Date) return actual instanceof Date && actual.getTime() === cond.getTime();
  if (typeof cond === "object" && cond !== null) {
    const c = cond as { in?: unknown[]; not?: unknown };
    if ("in" in c) return (c.in ?? []).includes(actual);
    if ("not" in c) return !matchValue(actual, c.not);
    throw new Error(`Operador de filtro não suportado no banco simulado: ${JSON.stringify(cond)}`);
  }
  return actual === cond;
}

function matches(row: Row, where?: Record<string, unknown>): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => matchValue(row[k], v));
}

export type FakeDb = {
  prisma: CompetencyDb;
  tables: Record<FakeModel, Row[]>;
  writes: { model: string; op: string }[];
  touched: Set<string>;
};

export function createFakeDb(): FakeDb {
  const tables = Object.fromEntries(MODELS.map((m) => [m, [] as Row[]])) as Record<FakeModel, Row[]>;
  const db: FakeDb = { prisma: null as unknown as CompetencyDb, tables, writes: [], touched: new Set() };
  const clone = <T>(v: T): T => structuredClone(v);

  function remove(model: FakeModel, where: Record<string, unknown>): number {
    const rows = tables[model];
    const gone = rows.filter((r) => matches(r, where));
    tables[model] = rows.filter((r) => !matches(r, where));
    for (const g of gone) for (const c of CASCADES[model] ?? []) remove(c.model, { [c.fk]: g.id });
    return gone.length;
  }

  const table = (model: FakeModel) => ({
    async findMany(args?: { where?: Record<string, unknown> }) {
      return tables[model].filter((r) => matches(r, args?.where)).map(clone);
    },
    async findUnique(args: { where: { id: string } }) {
      const row = tables[model].find((r) => r.id === args.where.id);
      return row ? clone(row) : null;
    },
    async findFirst(args?: { where?: Record<string, unknown> }) {
      const row = tables[model].find((r) => matches(r, args?.where));
      return row ? clone(row) : null;
    },
    async create(args: { data: Record<string, unknown> }) {
      db.writes.push({ model, op: "create" });
      const row = { id: randomUUID(), createdAt: new Date(), ...(DEFAULTS[model] ?? {}), ...clone(args.data) } as Row;
      tables[model].push(row);
      return clone(row);
    },
    async update(args: { where: { id: string }; data: Record<string, unknown> }) {
      db.writes.push({ model, op: "update" });
      const row = tables[model].find((r) => r.id === args.where.id);
      if (!row) throw Object.assign(new Error("not found"), { code: "P2025" });
      Object.assign(row, clone(args.data));
      return clone(row);
    },
    async updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }) {
      db.writes.push({ model, op: "updateMany" });
      const hit = tables[model].filter((r) => matches(r, args.where));
      hit.forEach((r) => Object.assign(r, clone(args.data)));
      return { count: hit.length };
    },
    async deleteMany(args: { where: Record<string, unknown> }) {
      db.writes.push({ model, op: "deleteMany" });
      return { count: remove(model, args.where) };
    },
  });

  const models: Record<string, unknown> = Object.fromEntries(MODELS.map((m) => [m, table(m)]));
  models.$transaction = async (fn: (tx: unknown) => Promise<unknown>) => {
    const snapshot = clone(tables);
    try {
      return await fn(db.prisma);
    } catch (error) {
      for (const m of MODELS) tables[m] = snapshot[m];
      throw error;
    }
  };
  db.prisma = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === "then") return undefined;
        db.touched.add(prop);
        if (!(prop in models)) throw new Error(`Fronteira de domínio: Competências não pode acessar o modelo «${prop}».`);
        return models[prop];
      },
    },
  ) as unknown as CompetencyDb;
  return db;
}

export const TEST_USER_ID = "00000000-0000-4000-8000-0000000000aa";
export const TEST_USER_NAME = "Usuária do RH";

export function seedEmployee(db: FakeDb, name: string, extra: Record<string, unknown> = {}): string {
  const id = randomUUID();
  db.tables.employee.push({ id, name, status: "ACTIVE", departmentId: null, ...extra });
  return id;
}

export function seedDepartment(db: FakeDb, name: string): string {
  const id = randomUUID();
  db.tables.hrDepartment.push({ id, name, status: "ACTIVE" });
  return id;
}

export type CompetencyTestApp = {
  baseUrl: string;
  db: FakeDb;
  /** Liga/desliga a feature flag do módulo. */
  setEnabled: (next: boolean) => void;
  /** Troca as permissões ("resourceKey:action" ou "all") para as próximas requisições. */
  setGranted: (next: readonly string[] | "all") => void;
  /** Troca o usuário da sessão (ex.: aprovador ≠ solicitante). */
  setUser: (userId: string) => void;
  /** Troca o escopo do ator para as próximas requisições. */
  setScope: (scope: { accessScope: PeopleAccessScope; actorEmployeeId: string | null }) => void;
  guardCalls: { resource: string; action?: string }[];
  close: () => Promise<void>;
};

/** Árvore abaixo do gestor pelo `managerId` do banco simulado (equivalente à CTE de produção). */
export function fakeDescendantIds(db: FakeDb, managerId: string): string[] {
  const out: string[] = [];
  const queue = [managerId];
  const seen = new Set([managerId]);
  while (queue.length) {
    const current = queue.shift()!;
    for (const e of db.tables.employee) {
      if (e.managerId === current && !seen.has(e.id)) {
        seen.add(e.id);
        out.push(e.id);
        queue.push(e.id);
      }
    }
  }
  return out;
}

/**
 * @param granted grants "resourceKey:action"; default = tudo liberado.
 * @param scope escopo hierárquico do ator; default = RH (ALL). Pode ser trocado entre requisições.
 */
export async function startCompetencyTestApp(options: {
  granted?: readonly string[] | "all";
  authenticated?: boolean;
  db?: FakeDb;
  now?: Date;
  scope?: { accessScope: PeopleAccessScope; actorEmployeeId: string | null };
  /** Feature flag do módulo (padrão: ligada nos testes). */
  enabled?: boolean;
} = {}): Promise<CompetencyTestApp> {
  const db = options.db ?? createFakeDb();
  const guardCalls: CompetencyTestApp["guardCalls"] = [];
  let granted = options.granted ?? "all";
  let scope = options.scope ?? { accessScope: "ALL" as PeopleAccessScope, actorEmployeeId: null };
  let currentUserId = TEST_USER_ID;
  let enabled = options.enabled ?? true;
  const requireAppAuth: RequestHandler = (_req, res, next) => {
    if (options.authenticated === false) {
      res.status(401).json({ error: "UNAUTHORIZED" });
      return;
    }
    next();
  };
  const app = express();
  app.use(express.json());
  registerCompetencyRoutes(
    app,
    {
      requireAppAuth,
      requireResource: (resource, action) => {
        guardCalls.push({ resource, action });
        return (_req, res, next) => {
          if (granted !== "all" && !granted.includes(`${resource}:${action ?? "view"}`)) {
            res.status(403).json({ error: "FORBIDDEN" });
            return;
          }
          next();
        };
      },
      getCurrentAppUser: async () => ({ id: currentUserId, name: TEST_USER_NAME }),
      getScopeInput: async () => scope,
      canApprove: async () => granted === "all" || granted.includes("admin.employees.competencies.approvals:manage"),
    },
    {
      prisma: db.prisma,
      now: () => options.now ?? new Date("2026-10-15T15:00:00.000Z"),
      loadDescendantIds: async (managerId) => fakeDescendantIds(db, managerId),
      isEnabled: () => enabled,
    },
  );
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr !== "object") throw new Error("no address");
  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    db,
    setScope: (next) => {
      scope = next;
    },
    setUser: (userId) => {
      currentUserId = userId;
    },
    setGranted: (next) => {
      granted = next;
    },
    setEnabled: (next) => {
      enabled = next;
    },
    guardCalls,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

export async function requestJson(
  app: CompetencyTestApp,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${app.baseUrl}${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json };
}
