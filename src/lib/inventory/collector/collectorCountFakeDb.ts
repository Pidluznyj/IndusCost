/**
 * Prisma em memória para os testes de contagem do Collector (sem DB).
 *
 * Superfície suficiente para rodar DE VERDADE: resolução de contexto, prepare,
 * população, reuso/criação de sessão, recordInventoryCount, finalize/approve,
 * generateInventoryCountAdjustments e o motor de movimentos — sem simular
 * regra nenhuma. Filtros não suportados lançam erro em vez de passar em
 * silêncio, e escritas em Product/Material/InventoryItem falham o teste.
 *
 * Só testes importam este módulo.
 */
import { Prisma } from "@prisma/client";
import { registerInventoryCollectorRoutes } from "./collectorRoutes.server.js";

type Row = Record<string, any>;

export const COLLECTOR_FAKE_DEVICE_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
export const COLLECTOR_FAKE_STABLE_NODE_ID = "nDEVCOLLECTOR1";

export type FakeWarehouseSeed = {
  id: string;
  code: string;
  name?: string;
  status?: "ACTIVE" | "INACTIVE";
};

export type FakeItemSeed = {
  id: string;
  code: string;
  description?: string;
  unit?: string;
  itemType: string;
  status?: "ACTIVE" | "INACTIVE";
  productId?: string | null;
  materialId?: string | null;
  controlsStock?: boolean;
  defaultWarehouseId?: string | null;
};

export type FakeBalanceSeed = {
  itemId: string;
  warehouseId: string;
  locationId?: string | null;
  physicalQuantity: number;
};

export type FakeSessionSeed = {
  id: string;
  code: string;
  warehouseId: string;
  status?: string;
  startedAt?: Date | null;
};

export type FakeLineSeed = {
  sessionId: string;
  itemId: string;
  warehouseId: string;
  locationId?: string | null;
  systemQuantity: number;
  countedQuantity?: number | null;
};

/** Setor configurável (InventoryStockSector) — só o motor STANDARD lê. */
export type FakeStockSectorSeed = {
  defaultCostCenterId?: string | null;
  id: string;
  code: string;
  name?: string;
  slug: string;
  status?: "ACTIVE" | "INACTIVE";
  strategy?: string;
  itemType?: string | null;
  sessionCodePrefix: string;
  warehouseId: string;
  allowsCounting?: boolean;
  allowsWithdrawal?: boolean;
};

export type FakeCostCenterSeed = { id: string; isActive?: boolean };

const dec = (value: unknown) =>
  value instanceof Prisma.Decimal ? value : new Prisma.Decimal(String(value ?? 0));

function balanceKey(warehouseId: string, locationId: string | null | undefined): string {
  return locationId ? `${warehouseId}:${locationId}` : warehouseId;
}

function matchScalar(actual: unknown, cond: unknown): boolean {
  if (cond === undefined) return true;
  if (cond === null) return actual == null;
  if (cond instanceof Prisma.Decimal) return actual != null && dec(actual).eq(cond);
  if (typeof cond === "object") {
    const c = cond as Row;
    if ("not" in c) return c.not === null ? actual != null : !matchScalar(actual, c.not);
    if ("in" in c) return (c.in as unknown[]).includes(actual);
    if ("notIn" in c) return !(c.notIn as unknown[]).includes(actual);
    if ("startsWith" in c) return String(actual ?? "").startsWith(String(c.startsWith));
    if ("contains" in c) {
      const insensitive = c.mode === "insensitive";
      const haystack = insensitive ? String(actual ?? "").toLowerCase() : String(actual ?? "");
      const needle = insensitive ? String(c.contains).toLowerCase() : String(c.contains);
      return haystack.includes(needle);
    }
    if ("equals" in c) return actual === c.equals;
    throw new Error(`fake: filtro não suportado ${JSON.stringify(cond)}`);
  }
  return actual === cond;
}

export function createCollectorCountFakeDb(seed: {
  warehouses: FakeWarehouseSeed[];
  items: FakeItemSeed[];
  balances?: FakeBalanceSeed[];
  sessions?: FakeSessionSeed[];
  lines?: FakeLineSeed[];
  sectors?: FakeStockSectorSeed[];
  costCenters?: FakeCostCenterSeed[];
}) {
  // Ids no formato UUID: as rotas do Collector validam UUID antes do serviço.
  let seq = 0;
  const nextId = (_kind: string) =>
    `${(seq += 1).toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`;

  const state = {
    warehouses: seed.warehouses.map((w) => ({
      name: w.code,
      status: "ACTIVE",
      allowsMovements: true,
      ...w,
    })) as Row[],
    items: seed.items.map((item) => ({
      description: item.code,
      unit: "UN",
      status: "ACTIVE",
      productId: null,
      materialId: null,
      controlsStock: true,
      controlsLocation: false,
      allowsReservation: true,
      allowsBlock: true,
      materialCodeSnapshot: null,
      materialDescriptionSnapshot: null,
      lastKnownCost: null,
      averageCost: null,
      defaultWarehouseId: null,
      ...item,
    })) as Row[],
    balances: (seed.balances ?? []).map((b) => ({
      id: nextId("balance"),
      itemId: b.itemId,
      warehouseId: b.warehouseId,
      locationId: b.locationId ?? null,
      balanceKey: balanceKey(b.warehouseId, b.locationId),
      physicalQuantity: dec(b.physicalQuantity),
      reservedQuantity: dec(0),
      blockedQuantity: dec(0),
      quarantineQuantity: dec(0),
      availableQuantity: dec(b.physicalQuantity),
    })) as Row[],
    sessions: (seed.sessions ?? []).map((s) => ({
      status: "COUNTING",
      startedAt: new Date("2026-09-01T10:00:00Z"),
      responsibleUserId: null,
      notes: null,
      ...s,
    })) as Row[],
    lines: [] as Row[],
    observations: [] as Row[],
    movements: [] as Row[],
    auditLogs: [] as Row[],
    rawQueries: [] as string[],
    /** Leituras de Material — o fluxo de produto nunca deve ler o cadastro de MP. */
    materialReads: 0,
    /** Pilha de cada escrita de saldo: prova de QUEM escreveu (só o motor pode). */
    balanceWriteStacks: [] as string[],
    /** Escritas por modelo.método — prova de "não cria / não edita". */
    writes: [] as string[],
    sectors: (seed.sectors ?? []).map((s) => ({
      name: s.code,
      status: "ACTIVE",
      strategy: "STANDARD",
      itemType: null,
      allowsCounting: true,
      allowsWithdrawal: false,
      defaultCostCenterId: null,
      ...s,
    })) as Row[],
    costCenters: (seed.costCenters ?? []).map((c) => ({ isActive: true, ...c })) as Row[],
    withdrawals: [] as Row[],
    /** Toda chamada modelo.método, na ordem — prova de ausência de N+1. */
    queries: [] as string[],
  };

  const newLine = (data: Row): Row => ({
    id: nextId("line"),
    locationId: null,
    countedQuantity: null,
    differenceQuantity: null,
    differencePercent: null,
    justification: null,
    generatedMovementId: null,
    version: 0,
    currentObservationId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...data,
    systemQuantity: dec(data.systemQuantity),
  });
  for (const line of seed.lines ?? []) {
    state.lines.push(
      newLine({
        ...line,
        locationId: line.locationId ?? null,
        countedQuantity: line.countedQuantity == null ? null : dec(line.countedQuantity),
      })
    );
  }

  const byId = (rows: Row[], id: unknown) => rows.find((r) => r.id === id) ?? null;
  const RELATIONS: Record<string, Record<string, [string, (row: Row) => unknown]>> = {
    item: { defaultWarehouse: ["warehouse", (r) => r.defaultWarehouseId] },
    balance: {
      item: ["item", (r) => r.itemId],
      warehouse: ["warehouse", (r) => r.warehouseId],
    },
    line: { item: ["item", (r) => r.itemId] },
    session: {},
    warehouse: {},
  };
  const tableOf = (model: string): Row[] =>
    model === "item" ? state.items : model === "warehouse" ? state.warehouses : [];

  function matchRow(model: string, row: Row, where: Row | undefined): boolean {
    for (const [key, cond] of Object.entries(where ?? {})) {
      if (cond === undefined) continue;
      if (key === "OR") {
        if (!(cond as Row[]).some((w) => matchRow(model, row, w))) return false;
        continue;
      }
      if (key === "AND") {
        if (!(cond as Row[]).every((w) => matchRow(model, row, w))) return false;
        continue;
      }
      // Relação 1:N item → saldos (pertencimento por saldo no almoxarifado).
      if (model === "item" && key === "balances") {
        const some = (cond as Row).some as Row | undefined;
        if (!some) throw new Error("fake: item.balances só suporta { some }");
        const has = state.balances.some(
          (b) => b.itemId === row.id && matchRow("balance", b, some)
        );
        if (!has) return false;
        continue;
      }
      const relation = RELATIONS[model]?.[key];
      if (relation) {
        const [target, fk] = relation;
        const related = byId(tableOf(target), fk(row));
        if (!related) return false;
        const inner = (cond as Row).is ?? cond;
        if (!matchRow(target, related, inner as Row)) return false;
        continue;
      }
      if (!matchScalar(row[key], cond)) return false;
    }
    return true;
  }

  const forbidden = (name: string) => async () => {
    state.writes.push(name);
    throw new Error(`fake: escrita proibida ${name}`);
  };

  function distinctRows(rows: Row[], fields: string[] | undefined): Row[] {
    if (!fields?.length) return rows;
    const seen = new Set<string>();
    return rows.filter((row) => {
      const key = fields.map((f) => String(row[f])).join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  const inventoryWarehouse = {
    findMany: async (args: Row = {}) =>
      state.warehouses.filter((w) => matchRow("warehouse", w, args.where)),
    findUnique: async (args: Row) => byId(state.warehouses, args.where.id),
    count: async (args: Row = {}) =>
      state.warehouses.filter((w) => matchRow("warehouse", w, args.where)).length,
  };

  // Relações sempre anexadas: select/include são ignorados (campos extras não
  // mudam o resultado de quem lê).
  const joinItem = (item: Row): Row => ({
    ...item,
    defaultWarehouse: byId(state.warehouses, item.defaultWarehouseId),
  });
  const joinBalance = (balance: Row): Row => ({
    ...balance,
    item: byId(state.items, balance.itemId),
    warehouse: byId(state.warehouses, balance.warehouseId),
    location: null,
  });

  const inventoryItem = {
    findMany: async (args: Row = {}) => {
      let rows = distinctRows(
        state.items.filter((item) => matchRow("item", item, args.where)),
        args.distinct
      );
      if (JSON.stringify(args.orderBy ?? null).includes('"code"')) {
        rows = [...rows].sort((a, b) => String(a.code).localeCompare(String(b.code)));
      }
      const skip = typeof args.skip === "number" ? args.skip : 0;
      const end = typeof args.take === "number" ? skip + args.take : undefined;
      return rows.slice(skip, end).map(joinItem);
    },
    findUnique: async (args: Row) => {
      const row = byId(state.items, args.where.id);
      return row ? joinItem(row) : null;
    },
    findFirst: async (args: Row = {}) => {
      const row = state.items.find((item) => matchRow("item", item, args.where));
      return row ? joinItem(row) : null;
    },
    count: async (args: Row = {}) =>
      state.items.filter((item) => matchRow("item", item, args.where)).length,
    create: forbidden("inventoryItem.create"),
    createMany: forbidden("inventoryItem.createMany"),
    update: forbidden("inventoryItem.update"),
    updateMany: forbidden("inventoryItem.updateMany"),
    upsert: forbidden("inventoryItem.upsert"),
  };

  const inventoryBalance = {
    findMany: async (args: Row = {}) =>
      distinctRows(
        state.balances.filter((b) => matchRow("balance", b, args.where)),
        args.distinct
      ).map(joinBalance),
    findUnique: async (args: Row) => {
      const where = args.where as Row;
      if (where.id) return byId(state.balances, where.id);
      const key = where.itemId_balanceKey as { itemId: string; balanceKey: string };
      return (
        state.balances.find((b) => b.itemId === key.itemId && b.balanceKey === key.balanceKey) ??
        null
      );
    },
    findFirst: async (args: Row = {}) =>
      state.balances.find((b) => matchRow("balance", b, args.where)) ?? null,
    count: async (args: Row = {}) =>
      state.balances.filter((b) => matchRow("balance", b, args.where)).length,
    create: async (args: Row) => {
      state.writes.push("inventoryBalance.create");
      state.balanceWriteStacks.push(new Error().stack ?? "");
      const row: Row = { id: nextId("balance"), ...args.data };
      state.balances.push(row);
      return row;
    },
    update: async (args: Row) => {
      state.writes.push("inventoryBalance.update");
      state.balanceWriteStacks.push(new Error().stack ?? "");
      const row = byId(state.balances, args.where.id);
      if (!row) throw new Error("fake: saldo não encontrado");
      Object.assign(row, args.data);
      return row;
    },
    updateMany: forbidden("inventoryBalance.updateMany"),
    upsert: forbidden("inventoryBalance.upsert"),
    delete: forbidden("inventoryBalance.delete"),
  };

  const joinSession = (session: Row, include: Row | undefined): Row => {
    if (!include) return session;
    return {
      ...session,
      ...(include.warehouse ? { warehouse: byId(state.warehouses, session.warehouseId) } : {}),
      ...(include.lines
        ? { lines: state.lines.filter((line) => line.sessionId === session.id) }
        : {}),
    };
  };
  const byStartedDesc = (a: Row, b: Row) =>
    (b.startedAt?.getTime?.() ?? Number.MAX_SAFE_INTEGER) -
    (a.startedAt?.getTime?.() ?? Number.MAX_SAFE_INTEGER);

  const inventoryCountSession = {
    findMany: async (args: Row = {}) => {
      const rows = state.sessions
        .filter((s) => matchRow("session", s, args.where))
        .sort(byStartedDesc);
      const limited = typeof args.take === "number" ? rows.slice(0, args.take) : rows;
      return limited.map((s) => joinSession(s, args.include));
    },
    findFirst: async (args: Row = {}) => {
      const row = state.sessions
        .filter((s) => matchRow("session", s, args.where))
        .sort(byStartedDesc)[0];
      return row ? joinSession(row, args.include) : null;
    },
    findUnique: async (args: Row) => {
      const row = byId(state.sessions, args.where.id);
      return row ? joinSession(row, args.include) : null;
    },
    count: async (args: Row = {}) =>
      state.sessions.filter((s) => matchRow("session", s, args.where)).length,
    create: async (args: Row) => {
      state.writes.push("inventoryCountSession.create");
      const row: Row = { id: nextId("session"), ...args.data };
      state.sessions.push(row);
      return row;
    },
    update: async (args: Row) => {
      state.writes.push("inventoryCountSession.update");
      const row = byId(state.sessions, args.where.id);
      if (!row) throw new Error("fake: sessão não encontrada");
      Object.assign(row, args.data);
      return row;
    },
  };

  const joinLine = (line: Row): Row => ({
    ...line,
    item: byId(state.items, line.itemId),
    currentObservation: byId(state.observations, line.currentObservationId),
    location: null,
  });
  const sortLines = (rows: Row[], orderBy: unknown): Row[] => {
    const wantsItemCode = JSON.stringify(orderBy ?? null).includes('"code"');
    if (!wantsItemCode) return rows;
    return [...rows].sort((a, b) =>
      String(byId(state.items, a.itemId)?.code).localeCompare(String(byId(state.items, b.itemId)?.code))
    );
  };

  const applyLineData = (line: Row, data: Row) => {
    for (const [key, value] of Object.entries(data)) {
      if (key === "version" && value && typeof value === "object" && "increment" in value) {
        line.version = Number(line.version) + Number((value as Row).increment);
      } else {
        line[key] = value;
      }
    }
  };

  const inventoryCountLine = {
    count: async (args: Row = {}) =>
      state.lines.filter((l) => matchRow("line", l, args.where)).length,
    groupBy: async (args: Row) => {
      if (JSON.stringify(args.by) !== JSON.stringify(["sessionId"])) {
        throw new Error("fake: groupBy só por sessionId");
      }
      const groups = new Map<string, number>();
      for (const line of state.lines.filter((l) => matchRow("line", l, args.where))) {
        groups.set(line.sessionId, (groups.get(line.sessionId) ?? 0) + 1);
      }
      return [...groups].map(([sessionId, n]) => ({ sessionId, _count: { _all: n } }));
    },
    createMany: async (args: Row) => {
      state.writes.push("inventoryCountLine.createMany");
      const data = args.data as Row[];
      for (const row of data) state.lines.push(newLine(row));
      return { count: data.length };
    },
    findMany: async (args: Row = {}) =>
      sortLines(
        state.lines.filter((l) => matchRow("line", l, args.where)),
        args.orderBy
      ).map(joinLine),
    findFirst: async (args: Row = {}) => {
      const row = state.lines.find((l) => matchRow("line", l, args.where));
      return row ? joinLine(row) : null;
    },
    update: async (args: Row) => {
      state.writes.push("inventoryCountLine.update");
      const row = byId(state.lines, args.where.id);
      if (!row) throw new Error("fake: linha não encontrada");
      applyLineData(row, args.data);
      return row;
    },
    updateMany: async (args: Row) => {
      state.writes.push("inventoryCountLine.updateMany");
      const rows = state.lines.filter((l) => matchRow("line", l, args.where));
      for (const row of rows) applyLineData(row, args.data);
      return { count: rows.length };
    },
  };

  const operations: Row[] = [];
  const inventoryCountOperation = {
    createMany: async (args: Row) => {
      let count = 0;
      for (const row of args.data as Row[]) {
        if (operations.some((o) => o.operationId === row.operationId)) continue;
        operations.push({ ...row });
        count += 1;
      }
      return { count };
    },
    findUnique: async (args: Row) =>
      operations.find((o) => o.operationId === args.where.operationId) ?? null,
    update: async (args: Row) => {
      const row = operations.find((o) => o.operationId === args.where.operationId);
      if (row) Object.assign(row, args.data);
      return row;
    },
  };

  const devices: Row[] = [
    {
      id: COLLECTOR_FAKE_DEVICE_ID,
      name: "Coletor 01",
      tailscaleStableNodeId: COLLECTOR_FAKE_STABLE_NODE_ID,
      tailscaleNodeName: null,
      tailscaleLoginName: null,
      active: true,
      canManageCountSessions: true,
      canApplyCountAdjustments: true,
    },
  ];

  const client: Row = {
    inventoryCollectorDevice: {
      findUnique: async (args: Row) =>
        devices.find((d) =>
          args.where.id
            ? d.id === args.where.id
            : d.tailscaleStableNodeId === args.where.tailscaleStableNodeId
        ) ?? null,
      update: async (args: Row) => {
        const row = devices.find((d) => d.id === args.where.id);
        if (row) Object.assign(row, args.data);
        return row;
      },
    },
    $queryRaw: async (strings: TemplateStringsArray) => {
      state.rawQueries.push(Array.from(strings).join("?"));
      return [{ locked: "" }];
    },
    inventoryWarehouse,
    inventoryItem,
    inventoryBalance,
    inventoryCountSession,
    inventoryCountLine,
    inventoryCountOperation,
    inventoryCountObservation: {
      create: async (args: Row) => {
        const row: Row = { id: nextId("observation"), ...args.data };
        state.observations.push(row);
        return row;
      },
    },
    inventoryLocation: { findUnique: async () => null },
    inventoryMovement: {
      findFirst: async (args: Row = {}) =>
        state.movements.find((m) => matchRow("movement", m, args.where)) ?? null,
      create: async (args: Row) => {
        state.writes.push("inventoryMovement.create");
        const row: Row = { id: nextId("movement"), createdAt: new Date(), ...args.data };
        state.movements.push(row);
        return row;
      },
    },
    inventoryAuditLog: {
      create: async (args: Row) => {
        const row: Row = { id: nextId("audit"), ...args.data };
        state.auditLogs.push(row);
        return row;
      },
    },
    // Foto best-effort do valor de MP após ajustes: leitura vazia, sem escrita em Material.
    material: {
      findMany: async () => {
        state.materialReads += 1;
        return [];
      },
      create: forbidden("material.create"),
      update: forbidden("material.update"),
      updateMany: forbidden("material.updateMany"),
    },
    materialStockValueSnapshot: { create: async () => ({ id: nextId("snapshot") }) },
    product: {
      create: forbidden("product.create"),
      update: forbidden("product.update"),
      updateMany: forbidden("product.updateMany"),
      upsert: forbidden("product.upsert"),
    },
    inventoryStockSector: {
      findUnique: async (args: Row) => {
        const where = args.where as Row;
        const field = ["id", "slug", "code", "sessionCodePrefix"].find((f) => where[f] != null);
        if (!field) throw new Error("fake: inventoryStockSector.findUnique sem chave única");
        const row = state.sectors.find((s) => s[field] === where[field]);
        if (!row) return null;
        return args.include?.warehouse
          ? { ...row, warehouse: byId(state.warehouses, row.warehouseId) }
          : row;
      },
      findMany: async (args: Row = {}) =>
        state.sectors.filter((s) => matchRow("sector", s, args.where)),
      create: forbidden("inventoryStockSector.create"),
      update: forbidden("inventoryStockSector.update"),
    },
    costCenter: {
      findUnique: async (args: Row) => byId(state.costCenters, args.where.id),
    },
    inventoryCollectorWithdrawal: {
      findUnique: async (args: Row) =>
        state.withdrawals.find((w) => w.operationId === args.where.operationId) ?? null,
      create: async (args: Row) => {
        if (state.withdrawals.some((w) => w.operationId === args.data.operationId)) {
          throw new Prisma.PrismaClientKnownRequestError("Unique constraint", {
            code: "P2002",
            clientVersion: Prisma.prismaVersion.client,
            meta: { target: ["operationId"] },
          });
        }
        state.writes.push("inventoryCollectorWithdrawal.create");
        const row: Row = { id: nextId("withdrawal"), ...args.data };
        state.withdrawals.push(row);
        return row;
      },
    },
  };
  // Registro de consultas: cada chamada modelo.método entra em state.queries.
  for (const [model, table] of Object.entries(client)) {
    if (!table || typeof table !== "object") continue;
    for (const [method, fn] of Object.entries(table as Row)) {
      if (typeof fn !== "function") continue;
      (table as Row)[method] = (...args: unknown[]) => {
        state.queries.push(`${model}.${method}`);
        return (fn as (...a: unknown[]) => unknown)(...args);
      };
    }
  }
  // Transação com rollback das tabelas de dados: erro dentro dela não deixa
  // sessão, linha, saldo ou movimento pela metade (como no PostgreSQL).
  const TX_TABLES = [
    "sessions",
    "lines",
    "balances",
    "movements",
    "observations",
    "withdrawals",
  ] as const;
  client.$transaction = async (fn: (tx: unknown) => Promise<unknown>) => {
    const snapshot = TX_TABLES.map((table) => state[table].map((row) => ({ ...row })));
    try {
      return await fn(client);
    } catch (e) {
      TX_TABLES.forEach((table, i) => {
        state[table].splice(0, state[table].length, ...snapshot[i]!);
      });
      throw e;
    }
  };

  const balanceOf = (itemId: string, warehouseId: string, locationId: string | null = null) => {
    const row = state.balances.find(
      (b) => b.itemId === itemId && b.balanceKey === balanceKey(warehouseId, locationId)
    );
    return row ? Number(dec(row.physicalQuantity)) : null;
  };

  // client: entra onde o código espera PrismaClient; rawClient: acesso direto no teste.
  return { client: client as never, rawClient: client, state, balanceOf };
}

const FAKE_PEER = "100.64.1.5";
type RouteHandler = (req: unknown, res: unknown, next: () => void) => unknown;

/**
 * Executa uma rota REAL do Collector (deviceAuth → handler) sobre o fake, com o
 * dispositivo padrão autenticado pela identidade Tailscale simulada.
 */
export async function callCollectorRoute(
  client: unknown,
  method: "get" | "post",
  path: string,
  opts: {
    query?: Record<string, string>;
    body?: Record<string, unknown>;
    params?: Record<string, string>;
  } = {}
): Promise<{ status: number; body: any }> {
  const registered: { method: string; path: string; handlers: RouteHandler[] }[] = [];
  const register =
    (m: string) =>
    (p: string, ...handlers: RouteHandler[]) => {
      registered.push({ method: m, path: p, handlers });
    };
  registerInventoryCollectorRoutes(
    { get: register("get"), post: register("post"), patch: register("patch") } as never,
    {
      prisma: client as never,
      identityResolver: {
        resolve: async (peer: string) =>
          peer === FAKE_PEER
            ? { stableNodeId: COLLECTOR_FAKE_STABLE_NODE_ID, nodeName: "coletor-01", loginName: null }
            : null,
      } as never,
      trustLocalProxy: false,
    }
  );
  const route = registered.find((r) => r.method === method && r.path === path);
  if (!route) throw new Error(`fake: rota ${method.toUpperCase()} ${path} não registrada`);
  const req = {
    socket: { remoteAddress: FAKE_PEER },
    headers: {},
    params: opts.params ?? {},
    query: opts.query ?? {},
    body: opts.body ?? {},
  };
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    locals: {} as Record<string, unknown>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  for (const handler of route.handlers) {
    let nextCalled = false;
    await handler(req, res, () => {
      nextCalled = true;
    });
    if (!nextCalled) break;
  }
  return { status: res.statusCode, body: res.body };
}
