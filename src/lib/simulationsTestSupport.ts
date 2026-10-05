/**
 * Suporte de teste do módulo Simulações: Prisma em memória restrito aos modelos que o
 * domínio pode tocar. Qualquer acesso a outro modelo (custo oficial, preço, tabela) lança
 * erro — é o guarda-corpo de fronteira usado pelos testes de rota.
 */
import http from "node:http";
import express from "express";
import type { RequestHandler } from "express";
import type { PrismaClient } from "@prisma/client";
import type { EffectiveProductProductionCostResult } from "./productionCostVersioning.js";
import { registerSimulationsRoutes } from "./simulationsRoutes.js";

export const TEST_IDS = {
  product: "11111111-1111-4111-8111-111111111111",
  productNoPublished: "22222222-2222-4222-8222-222222222222",
  taxRule: "33333333-3333-4333-8333-333333333333",
  material: "44444444-4444-4444-8444-444444444444",
  user: "55555555-5555-4555-8555-555555555555",
  version: "66666666-6666-4666-8666-666666666666",
  missing: "99999999-9999-4999-8999-999999999999",
} as const;

type Row = Record<string, unknown> & { id: string };

export type FakeDb = {
  prisma: PrismaClient;
  tables: {
    simulation: Row[];
    newProductSimulation: Row[];
    projectSimulatedItem: Row[];
  };
  /** Operações de escrita executadas, por modelo. */
  writes: Array<{ model: string; op: string }>;
  /** Modelos acessados (leitura ou escrita). */
  touched: Set<string>;
  failNext: { model: string; op: string; error: unknown } | null;
};

let seq = 0;
function nextId(): string {
  seq += 1;
  return `aaaaaaaa-aaaa-4aaa-8aaa-${String(seq).padStart(12, "0")}`;
}

function matches(row: Row, where: Record<string, unknown> | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, cond]) => {
    if (cond && typeof cond === "object" && !Array.isArray(cond) && !(cond instanceof Date)) {
      const c = cond as Record<string, unknown>;
      if ("in" in c) return (c.in as unknown[]).includes(row[key]);
      if ("contains" in c) return String(row[key] ?? "").includes(String(c.contains));
      return true;
    }
    return row[key] === cond;
  });
}

function mutableTable(db: FakeDb, model: keyof FakeDb["tables"]) {
  const rows = db.tables[model];
  const guard = (op: string) => {
    if (db.failNext && db.failNext.model === model && db.failNext.op === op) {
      const error = db.failNext.error;
      db.failNext = null;
      throw error;
    }
  };
  return {
    async findMany(args?: { where?: Record<string, unknown> }) {
      guard("findMany");
      return rows.filter((r) => matches(r, args?.where)).map((r) => ({ ...r }));
    },
    async findUnique(args: { where: { id: string } }) {
      guard("findUnique");
      const row = rows.find((r) => r.id === args.where.id);
      return row ? { ...row } : null;
    },
    async findFirst(args?: { where?: Record<string, unknown> }) {
      guard("findFirst");
      const row = rows.find((r) => matches(r, args?.where));
      return row ? { ...row } : null;
    },
    async create(args: { data: Record<string, unknown> }) {
      guard("create");
      db.writes.push({ model, op: "create" });
      const row: Row = { id: nextId(), createdAt: new Date(), archivedAt: null, ...structuredClone(args.data) };
      rows.push(row);
      return { ...row };
    },
    async update(args: { where: { id: string }; data: Record<string, unknown> }) {
      guard("update");
      db.writes.push({ model, op: "update" });
      const row = rows.find((r) => r.id === args.where.id);
      if (!row) throw Object.assign(new Error("not found"), { code: "P2025" });
      Object.assign(row, structuredClone(args.data));
      return { ...row };
    },
    async updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }) {
      guard("updateMany");
      db.writes.push({ model, op: "updateMany" });
      const hit = rows.filter((r) => matches(r, args.where));
      hit.forEach((row) => Object.assign(row, structuredClone(args.data)));
      return { count: hit.length };
    },
    async deleteMany(args: { where: Record<string, unknown> }) {
      guard("deleteMany");
      db.writes.push({ model, op: "deleteMany" });
      const before = rows.length;
      const keep = rows.filter((r) => !matches(r, args.where));
      rows.length = 0;
      rows.push(...keep);
      return { count: before - keep.length };
    },
  };
}

export function createFakeDb(options: {
  pricing?: { desiredMargin: number; commission: number; otherVariables: number; freightOut: number; taxPct: number } | null;
} = {}): FakeDb {
  const pricing =
    options.pricing === undefined
      ? { desiredMargin: 20, commission: 3, otherVariables: 0, freightOut: 0, taxPct: 18 }
      : options.pricing;
  const products: Row[] = [
    { id: TEST_IDS.product, sku: "610.01AA", name: "Produto real", type: "PRODUCT", status: "ACTIVE" },
    { id: TEST_IDS.productNoPublished, sku: "700.02BB", name: "Sem publicado", type: "COMPONENT", status: "ACTIVE" },
  ];
  const materials: Row[] = [
    {
      id: TEST_IDS.material,
      code: "MP-001",
      description: "Polipropileno",
      unit: "kg",
      currentCost: 9,
      freight: 1,
      standardLoss: 0,
    },
  ];
  const db: FakeDb = {
    prisma: null as unknown as PrismaClient,
    tables: { simulation: [], newProductSimulation: [], projectSimulatedItem: [] },
    writes: [],
    touched: new Set(),
    failNext: null,
  };
  const readOnly = (rows: Row[]) => ({
    async findUnique(args: { where: { id: string } }) {
      return rows.find((r) => r.id === args.where.id) ?? null;
    },
    async findMany(args?: { where?: Record<string, unknown> }) {
      return rows.filter((r) => matches(r, args?.where));
    },
  });
  const models: Record<string, unknown> = {
    product: readOnly(products),
    material: readOnly(materials),
    taxRule: {
      async findUnique(args: { where: { id: string } }) {
        if (args.where.id !== TEST_IDS.taxRule) return null;
        return { name: "Venda SP", TaxComponent: [{ percentage: 12 }, { percentage: 6 }] };
      },
    },
    productPricing: {
      // Somente leitura: a fachada não expõe create/update/upsert de propósito.
      async findUnique(args: { where: { productId_taxRuleId: { productId: string; taxRuleId: string } } }) {
        const key = args.where.productId_taxRuleId;
        if (!pricing || key.taxRuleId !== TEST_IDS.taxRule) return null;
        return {
          desiredMargin: pricing.desiredMargin,
          commission: pricing.commission,
          otherVariables: pricing.otherVariables,
          freightOut: pricing.freightOut,
          TaxRule: { name: "Venda SP", TaxComponent: [{ percentage: pricing.taxPct }] },
        };
      },
    },
    simulation: mutableTable(db, "simulation"),
    newProductSimulation: mutableTable(db, "newProductSimulation"),
    projectSimulatedItem: mutableTable(db, "projectSimulatedItem"),
  };
  db.prisma = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === "then") return undefined;
        db.touched.add(prop);
        if (!(prop in models)) {
          throw new Error(`Fronteira de domínio: Simulações não pode acessar o modelo «${prop}».`);
        }
        return models[prop];
      },
    }
  ) as unknown as PrismaClient;
  return db;
}

/** Análise do motor (LIVE): MP 1,00 + HH 0,20 + HM 0,10 = 1,30, com processo próprio detalhado. */
export function liveAnalysis(overrides: Partial<{ mp: number; hh: number; hm: number; transform: number; setup: number }> = {}) {
  const mp = overrides.mp ?? 1;
  const hh = overrides.hh ?? 0.2;
  const hm = overrides.hm ?? 0.1;
  const total = hh + hm;
  const setup = overrides.setup ?? 0.06;
  const transform = overrides.transform ?? total - setup;
  return {
    productId: TEST_IDS.product,
    sku: "610.01AA",
    name: "Produto real",
    totalMaterialCost: mp,
    totalHH_Unit: hh,
    totalHM_Unit: hm,
    totalCIF_Unit: 0,
    totalOPEX_Unit: 0,
    totalIndustrialCost: mp + hh + hm,
    costAnalysisPartial: false,
    details: {
      processBreakdown: [
        {
          source: "STANDARD_PROCESS",
          total,
          laborCost: hh,
          machineCost: hm,
          calculationDetails: { unitTransform: transform, setupCost: setup },
        },
      ],
    },
  };
}

export function createFakeEngine(analysis: unknown = liveAnalysis()) {
  const calls: string[] = [];
  return {
    calls,
    engine: {
      async initAnalysisCache() {
        return { globalHhCost: 60, energyCost: 4400, workingHours: 220, hhSource: "AUTO" } as never;
      },
      async getProductCostAnalysis(productId: string) {
        calls.push(productId);
        return productId === TEST_IDS.missing ? null : analysis;
      },
      isCostAnalysisFailure(x: unknown): x is { error: string; message?: string } {
        return Boolean(x && typeof x === "object" && "error" in (x as object));
      },
    },
  };
}

/** Custo PUBLISHED: MP 1,20 + HH 0,30 + HM 0,20 = 1,70. */
export function publishedCost(productId: string): EffectiveProductProductionCostResult {
  if (productId !== TEST_IDS.product) {
    return { status: "SEM_CUSTO", productId, referenceDate: new Date("2026-10-05T00:00:00Z") };
  }
  return {
    status: "OK",
    productId,
    unitProductionCost: 1.7,
    costTableVersionId: TEST_IDS.version,
    costTableItemId: "77777777-7777-4777-8777-777777777777",
    effectiveDate: new Date("2026-10-01T00:00:00Z"),
    versionName: "Custo de produção 2026-10 (rev. 2)",
    versionCode: "2026-10",
    revision: 2,
    publishedAt: new Date("2026-10-02T12:00:00Z"),
    currency: "BRL",
    breakdown: { materialCost: 1.2, processCost: 0, laborCost: 0.3, machineCost: 0.2, overheadCost: 0, otherCost: 0 },
    calculationSnapshot: null,
  };
}

export type TestApp = {
  baseUrl: string;
  db: FakeDb;
  guardCalls: Array<{ resource: string; action?: string }>;
  engineCalls: string[];
  publishedReads: string[];
  close: () => Promise<void>;
};

export async function startSimulationsTestApp(options: {
  /** Ações concedidas ao usuário de teste (default: todas). */
  grantedActions?: readonly string[];
  authenticated?: boolean;
  db?: FakeDb;
  analysis?: unknown;
} = {}): Promise<TestApp> {
  const db = options.db ?? createFakeDb();
  const { engine, calls } = createFakeEngine(options.analysis);
  const granted = options.grantedActions ?? ["view", "create", "update", "delete"];
  const guardCalls: TestApp["guardCalls"] = [];
  const publishedReads: string[] = [];
  const requireAppAuth: RequestHandler = (_req, res, next) => {
    if (options.authenticated === false) {
      res.status(401).json({ error: "UNAUTHORIZED" });
      return;
    }
    next();
  };
  const app = express();
  app.use(express.json());
  registerSimulationsRoutes(
    app,
    {
      requireAppAuth,
      requireResource: (resource, action) => {
        guardCalls.push({ resource, action });
        return (_req, res, next) => {
          if (!granted.includes(action ?? "view")) {
            res.status(403).json({ error: "FORBIDDEN" });
            return;
          }
          next();
        };
      },
      getCurrentAppUser: async () => ({ id: TEST_IDS.user, name: "Usuária da Sessão" }),
    },
    {
      prisma: db.prisma,
      engine,
      now: () => new Date("2026-10-05T15:00:00.000Z"),
      compute: {
        getEffectiveCost: async (_db, productId) => {
          publishedReads.push(productId);
          return publishedCost(productId);
        },
      },
    }
  );
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr !== "object") throw new Error("no address");
  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    db,
    guardCalls,
    engineCalls: calls,
    publishedReads,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

export async function requestJson(
  app: TestApp,
  method: string,
  path: string,
  body?: unknown
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
