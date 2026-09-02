/**
 * FASE 2D — contagem via DEVICE pela rota Collector.
 *
 * O que está sob teste: a rota DEVICE é somente uma porta de entrada para o
 * motor canônico recordInventoryCount. Identidade nasce server-side (2C),
 * CAS e idempotência da 2B valem inalterados, semântica temporal da 2A idem,
 * e o DEVICE não possui nenhuma ação supervisora.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import {
  COLLECTOR_FORBIDDEN_IDENTITY_FIELDS,
  COLLECTOR_IDENTITY_FIELD_REJECTED,
  COLLECTOR_OPERATION_ID_REQUIRED,
  parseCollectorCountBody,
} from "./collector/collectorCountContract.js";
import { registerInventoryCollectorRoutes } from "./collector/collectorRoutes.server.js";
import { InventoryValidationError } from "./inventoryTypes.js";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function codeOnly(source: string): string {
  return source
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return !t.startsWith("*") && !t.startsWith("/*") && !t.startsWith("//");
    })
    .join("\n");
}

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const LINE_ID = "22222222-2222-4222-8222-222222222222";

// ---------------------------------------------------------------------------
// Mock Prisma — sessões/linhas/saldos/observações/operações/audit + devices
// ---------------------------------------------------------------------------

function applyMockUpdate<T extends Record<string, unknown>>(
  row: T,
  data: Record<string, unknown>
): T {
  const next: Record<string, unknown> = { ...row };
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === "object" && "increment" in (value as object)) {
      next[key] = Number(next[key] ?? 0) + Number((value as { increment: number }).increment);
      continue;
    }
    next[key] = value;
  }
  return next as T;
}

function createCollectorMockPrisma(options?: {
  balanceQty?: number;
  systemQty?: number;
  sessionStatus?: string;
  devices?: Array<Record<string, unknown>>;
}) {
  const state = {
    sessions: [
      {
        id: SESSION_ID,
        code: "CF-2D",
        warehouseId: "wh-1",
        status: options?.sessionStatus ?? "COUNTING",
      } as Record<string, unknown> & { id: string; status: string },
    ],
    lines: [
      {
        id: LINE_ID,
        sessionId: SESSION_ID,
        itemId: "item-1",
        warehouseId: "wh-1",
        locationId: null,
        systemQuantity: new Prisma.Decimal(options?.systemQty ?? 100),
        countedQuantity: null as Prisma.Decimal | null,
        differenceQuantity: null as Prisma.Decimal | null,
        differencePercent: null as Prisma.Decimal | null,
        justification: null as string | null,
        generatedMovementId: null as string | null,
        version: 0,
        currentObservationId: null as string | null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    balances: [
      {
        id: "bal-1",
        itemId: "item-1",
        warehouseId: "wh-1",
        locationId: null,
        balanceKey: "wh-1",
        physicalQuantity: new Prisma.Decimal(options?.balanceQty ?? 100),
        reservedQuantity: new Prisma.Decimal(0),
        blockedQuantity: new Prisma.Decimal(0),
        quarantineQuantity: new Prisma.Decimal(0),
        availableQuantity: new Prisma.Decimal(options?.balanceQty ?? 100),
      },
    ],
    observations: [] as Array<Record<string, unknown> & { id: string }>,
    operations: [] as Array<Record<string, unknown>>,
    auditLogs: [] as Array<Record<string, unknown>>,
    devices: (options?.devices ?? [
      {
        id: "dev-1",
        name: "Coletor 01",
        tailscaleStableNodeId: "nDEV1",
        active: true,
        tailscaleNodeName: null,
        tailscaleLoginName: null,
      },
      {
        id: "dev-2",
        name: "Coletor 02",
        tailscaleStableNodeId: "nDEV2",
        active: true,
        tailscaleNodeName: null,
        tailscaleLoginName: null,
      },
      {
        id: "dev-off",
        name: "Coletor desativado",
        tailscaleStableNodeId: "nOFF",
        active: false,
        tailscaleNodeName: null,
        tailscaleLoginName: null,
      },
    ]) as Array<Record<string, unknown> & { id: string; active: boolean }>,
  };

  const tx = {
    inventoryCountSession: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        state.sessions.find((s) => s.id === where.id) ?? null,
    },
    inventoryCountLine: {
      findFirst: async ({ where }: { where: { id: string; sessionId?: string } }) =>
        state.lines.find(
          (l) => l.id === where.id && (where.sessionId === undefined || l.sessionId === where.sessionId)
        ) ?? null,
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; version?: number };
        data: Record<string, unknown>;
      }) => {
        const matches = state.lines.filter(
          (l) => l.id === where.id && (where.version === undefined || l.version === where.version)
        );
        for (const m of matches) {
          const idx = state.lines.findIndex((l) => l.id === m.id);
          state.lines[idx] = applyMockUpdate(state.lines[idx], data);
        }
        return { count: matches.length };
      },
    },
    inventoryBalance: {
      findUnique: async ({
        where,
      }: {
        where: { id?: string; itemId_balanceKey?: { itemId: string; balanceKey: string } };
      }) => {
        if (where.id) return state.balances.find((b) => b.id === where.id) ?? null;
        const key = where.itemId_balanceKey;
        if (!key) return null;
        return (
          state.balances.find((b) => b.itemId === key.itemId && b.balanceKey === key.balanceKey) ??
          null
        );
      },
    },
    inventoryCountObservation: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          ...data,
          id: `obs-${state.observations.length + 1}`,
          observedAt: new Date(),
          createdAt: new Date(),
        } as Record<string, unknown> & { id: string };
        state.observations.push(row);
        return row;
      },
    },
    inventoryCountOperation: {
      createMany: async ({
        data,
        skipDuplicates,
      }: {
        data: Array<Record<string, unknown>>;
        skipDuplicates?: boolean;
      }) => {
        let count = 0;
        for (const row of data) {
          const exists = state.operations.some((o) => o.operationId === row.operationId);
          if (exists && skipDuplicates) continue;
          state.operations.push({ id: `op-${state.operations.length + 1}`, ...row });
          count += 1;
        }
        return { count };
      },
      findUnique: async ({ where }: { where: { operationId: string } }) =>
        state.operations.find((o) => o.operationId === where.operationId) ?? null,
      update: async ({
        where,
        data,
      }: {
        where: { operationId: string };
        data: Record<string, unknown>;
      }) => {
        const idx = state.operations.findIndex((o) => o.operationId === where.operationId);
        state.operations[idx] = { ...state.operations[idx], ...data };
        return state.operations[idx];
      },
    },
    inventoryAuditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.auditLogs.push(data);
        return data;
      },
    },
    inventoryCollectorDevice: {
      findUnique: async ({
        where,
      }: {
        where: { id?: string; tailscaleStableNodeId?: string };
      }) => {
        if (where.id) return state.devices.find((d) => d.id === where.id) ?? null;
        return (
          state.devices.find(
            (d) => d.tailscaleStableNodeId === where.tailscaleStableNodeId
          ) ?? null
        );
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        const idx = state.devices.findIndex((d) => d.id === where.id);
        state.devices[idx] = { ...state.devices[idx], ...data };
        return state.devices[idx];
      },
    },
  };

  const snapshot = () => JSON.parse(
    JSON.stringify({
      lines: state.lines,
      observations: state.observations,
      operations: state.operations,
      auditLogs: state.auditLogs,
    })
  );
  const restore = (snap: ReturnType<typeof snapshot>) => {
    // Decimals viram string no JSON — suficiente para os cenários de rollback.
    state.lines.splice(0, state.lines.length, ...snap.lines);
    state.observations.splice(0, state.observations.length, ...snap.observations);
    state.operations.splice(0, state.operations.length, ...snap.operations);
    state.auditLogs.splice(0, state.auditLogs.length, ...snap.auditLogs);
  };

  const prisma = {
    $transaction: async (fn: (inner: typeof tx) => Promise<unknown>) => {
      const snap = snapshot();
      try {
        return await fn(tx);
      } catch (e) {
        restore(snap);
        throw e;
      }
    },
    ...tx,
  };

  return { prisma, state };
}

// ---------------------------------------------------------------------------
// Fake app + execução da cadeia middleware → handler
// ---------------------------------------------------------------------------

type Handler = (req: unknown, res: unknown, next: () => void) => unknown;

function buildCollectorApp(mock: ReturnType<typeof createCollectorMockPrisma>) {
  const registered: { method: string; path: string; handlers: Handler[] }[] = [];
  const app = {
    get(path: string, ...handlers: Handler[]) {
      registered.push({ method: "get", path, handlers });
    },
    post(path: string, ...handlers: Handler[]) {
      registered.push({ method: "post", path, handlers });
    },
    patch(path: string, ...handlers: Handler[]) {
      registered.push({ method: "patch", path, handlers });
    },
  };
  const identityResolver = {
    resolve: async (peer: string) =>
      peer === "100.64.1.5"
        ? { stableNodeId: "nDEV1", nodeName: "coletor-01", loginName: null }
        : peer === "100.64.2.2"
          ? { stableNodeId: "nDEV2", nodeName: "coletor-02", loginName: null }
          : peer === "100.64.3.3"
            ? { stableNodeId: "nOFF", nodeName: "coletor-off", loginName: null }
            : null,
  };
  registerInventoryCollectorRoutes(app as never, {
    prisma: mock.prisma as never,
    identityResolver,
  });
  return { registered };
}

type CallResult = { status: number | null; body: unknown };

async function callCollector(
  mock: ReturnType<typeof createCollectorMockPrisma>,
  options: {
    remoteAddress?: string | null;
    body?: unknown;
    sessionId?: string;
    lineId?: string;
    headers?: Record<string, string>;
  } = {}
): Promise<CallResult> {
  const { registered } = buildCollectorApp(mock);
  const countRoute = registered.find(
    (r) => r.method === "patch" && r.path.includes("/lines/:lineId")
  );
  assert.ok(countRoute, "rota PATCH de contagem não registrada");
  const { handlers } = countRoute;

  const req = {
    socket: { remoteAddress: options.remoteAddress ?? "100.64.1.5" },
    headers: options.headers ?? {},
    params: {
      sessionId: options.sessionId ?? SESSION_ID,
      lineId: options.lineId ?? LINE_ID,
    },
    body: options.body ?? {},
    query: {},
  };
  const res = {
    statusCode: null as number | null,
    body: null as unknown,
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

  for (const handler of handlers) {
    let nextCalled = false;
    await handler(req, res, () => {
      nextCalled = true;
    });
    if (!nextCalled && res.statusCode !== null && handler !== handlers[handlers.length - 1]) {
      break; // middleware negou
    }
  }
  return { status: res.statusCode, body: res.body };
}

function validBody(over: Record<string, unknown> = {}) {
  return {
    countedQuantity: 80,
    justification: null,
    expectedVersion: 0,
    operationId: "op-2d-1",
    ...over,
  };
}

function code(result: CallResult): string | undefined {
  return (result.body as { code?: string } | null)?.code;
}

// ---------------------------------------------------------------------------
// A. ROUTE / AUTH
// ---------------------------------------------------------------------------

describe("2D route/auth", () => {
  it("1/5. DEVICE ativo + identidade válida grava contagem — SEM login humano", async () => {
    const mock = createCollectorMockPrisma({ balanceQty: 80, systemQty: 100 });
    const result = await callCollector(mock, { body: validBody() });
    assert.equal(result.status, null, JSON.stringify(result.body)); // res.json sem status = 200
    assert.equal((result.body as { replayed: boolean }).replayed, false);
    assert.equal(mock.state.observations.length, 1);
  });

  it("2. node não registrado → 403 e nada chega ao motor", async () => {
    const mock = createCollectorMockPrisma();
    const result = await callCollector(mock, {
      remoteAddress: "100.64.9.9",
      body: validBody(),
    });
    assert.equal(result.status, 403);
    assert.equal(code(result), "COLLECTOR_DEVICE_UNAUTHORIZED");
    assert.equal(mock.state.observations.length, 0);
    assert.equal(mock.state.operations.length, 0);
  });

  it("3. device inativo → 403", async () => {
    const mock = createCollectorMockPrisma();
    const result = await callCollector(mock, {
      remoteAddress: "100.64.3.3",
      body: validBody(),
    });
    assert.equal(result.status, 403);
    assert.equal(mock.state.observations.length, 0);
  });

  it("4. WhoIs failure (peer desconhecido) → 403", async () => {
    const mock = createCollectorMockPrisma();
    const result = await callCollector(mock, { remoteAddress: "10.0.0.1", body: validBody() });
    assert.equal(result.status, 403);
  });

  it("6/7. login humano NÃO autoriza o namespace Collector (estrutural)", () => {
    const src = codeOnly(read("src/lib/inventory/collector/collectorRoutes.server.ts"));
    assert.doesNotMatch(src, /requireAppAuth/);
    assert.doesNotMatch(src, /requireResource/);
    assert.doesNotMatch(src, /getCurrentAppUser/);
    assert.match(src, /requireInventoryCollectorDevice/);
    // E o server.ts registra o Collector fora do objeto de guards humanos.
    const server = read("server.ts");
    assert.match(server, /registerInventoryCollectorRoutes\(app\);/);
  });

  it("8. namespace Collector expõe rotas DEVICE (legado + autônomo)", () => {
    const src = codeOnly(read("src/lib/inventory/collector/collectorRoutes.server.ts"));
    const registrations = src.match(/app\.(get|post|patch|put|delete)\(/g) ?? [];
    // Legado: context, count-sessions, resolve-qr, PATCH lines
    // Autônomo: active, POST sessions, items, count, finalize, apply-adjustments
    assert.ok(registrations.length >= 9, `esperado ≥9 rotas, veio ${registrations.length}`);
    assert.equal((src.match(/app\.patch\(/g) ?? []).length, 1, "uma única rota PATCH legada");
    assert.match(src, /finalize/);
    assert.match(src, /apply-adjustments/);
    assert.match(src, /recordInventoryCount/);
  });
});

// ---------------------------------------------------------------------------
// B. ACTOR
// ---------------------------------------------------------------------------

describe("2D actor", () => {
  it("9/10/11. Observation/Operation/Audit gravam DEVICE + deviceId interno + userId null", async () => {
    const mock = createCollectorMockPrisma({ balanceQty: 80, systemQty: 100 });
    await callCollector(mock, { body: validBody() });

    const obs = mock.state.observations[0];
    assert.equal(obs.actorType, "DEVICE");
    assert.equal(obs.deviceId, "dev-1");
    assert.equal(obs.userId, null);

    const op = mock.state.operations[0];
    assert.equal(op.actorType, "DEVICE");
    assert.equal(op.deviceId, "dev-1");
    assert.equal(op.userId, null);

    const audit = mock.state.auditLogs.find((a) => a.action === "COUNT_RECORDED");
    assert.ok(audit);
    assert.equal(audit.userId, null);
    assert.equal((audit.afterJson as Record<string, unknown>).actorType, "DEVICE");
    assert.equal((audit.afterJson as Record<string, unknown>).deviceId, "dev-1");
  });

  it("12/13/14. body com actorType/userId/deviceId/StableID é REJEITADO", async () => {
    const mock = createCollectorMockPrisma();
    for (const forged of [
      { actorType: "USER" },
      { userId: "admin" },
      { deviceId: "dev-2" },
      { tailscaleStableNodeId: "nDEV2" },
      { stableNodeId: "nDEV2" },
      { ip: "100.64.2.2" },
    ]) {
      const result = await callCollector(mock, { body: validBody(forged) });
      assert.equal(result.status, 400, JSON.stringify(forged));
      assert.equal(code(result), COLLECTOR_IDENTITY_FIELD_REJECTED);
    }
    assert.equal(mock.state.observations.length, 0);
  });

  it("contrato: expectedVersion e operationId obrigatórios no DEVICE", () => {
    assert.throws(
      () => parseCollectorCountBody({ countedQuantity: 10, operationId: "op" }),
      (e: unknown) =>
        e instanceof InventoryValidationError && e.code === "COUNT_LINE_VERSION_REQUIRED"
    );
    assert.throws(
      () => parseCollectorCountBody({ countedQuantity: 10, expectedVersion: 0 }),
      (e: unknown) =>
        e instanceof InventoryValidationError && e.code === COLLECTOR_OPERATION_ID_REQUIRED
    );
    // Lista de campos proibidos cobre as formas óbvias de identidade.
    assert.ok(COLLECTOR_FORBIDDEN_IDENTITY_FIELDS.includes("actorType"));
    assert.ok(COLLECTOR_FORBIDDEN_IDENTITY_FIELDS.includes("deviceId"));
    assert.ok(COLLECTOR_FORBIDDEN_IDENTITY_FIELDS.includes("tailscaleStableNodeId"));
  });
});

// ---------------------------------------------------------------------------
// C. CAS   /   D. IDEMPOTÊNCIA
// ---------------------------------------------------------------------------

describe("2D CAS", () => {
  it("15/19. expectedVersion correto grava e incrementa exatamente 1", async () => {
    const mock = createCollectorMockPrisma({ balanceQty: 80, systemQty: 100 });
    const result = await callCollector(mock, { body: validBody() });
    assert.equal((result.body as { result: { version: number } }).result.version, 1);
    assert.equal(mock.state.lines[0].version, 1);
  });

  it("16/17/18. expectedVersion antigo → 409 sem Observation nem Audit", async () => {
    const mock = createCollectorMockPrisma({ balanceQty: 80, systemQty: 100 });
    await callCollector(mock, { body: validBody() });
    const before = {
      observations: mock.state.observations.length,
      audits: mock.state.auditLogs.length,
    };
    const result = await callCollector(mock, {
      body: validBody({ countedQuantity: 79, justification: "x", operationId: "op-2d-2" }),
    });
    assert.equal(result.status, 409);
    assert.equal(code(result), "COUNT_LINE_VERSION_CONFLICT");
    assert.equal(mock.state.observations.length, before.observations);
    assert.equal(mock.state.auditLogs.length, before.audits);
    assert.equal(mock.state.lines[0].version, 1);
  });
});

describe("2D idempotência", () => {
  it("20/21/22/23. retry mesma chave/payload/device → replay sem novo efeito", async () => {
    const mock = createCollectorMockPrisma({ balanceQty: 80, systemQty: 100 });
    const first = await callCollector(mock, { body: validBody() });
    const second = await callCollector(mock, { body: validBody() });
    assert.equal((second.body as { replayed: boolean }).replayed, true);
    assert.deepEqual(
      (second.body as { result: unknown }).result,
      (first.body as { result: unknown }).result
    );
    assert.equal(mock.state.observations.length, 1);
    assert.equal(mock.state.lines[0].version, 1);
    assert.equal(
      mock.state.auditLogs.filter((a) => a.action === "COUNT_RECORDED").length,
      1
    );
  });

  it("24. mesma chave + payload diferente → 409", async () => {
    const mock = createCollectorMockPrisma({ balanceQty: 80, systemQty: 100 });
    await callCollector(mock, { body: validBody() });
    const result = await callCollector(mock, {
      body: validBody({ countedQuantity: 78, justification: "outra", expectedVersion: 1 }),
    });
    assert.equal(result.status, 409);
    assert.equal(code(result), "COUNT_OPERATION_IDEMPOTENCY_CONFLICT");
  });

  it("25. mesma chave usada por OUTRO device → conflito (deviceId compõe o request)", async () => {
    const mock = createCollectorMockPrisma({ balanceQty: 80, systemQty: 100 });
    await callCollector(mock, { body: validBody() });
    // dev-2, mesmo payload e mesma operationId: request hash difere pelo deviceId.
    const result = await callCollector(mock, {
      remoteAddress: "100.64.2.2",
      body: validBody(),
    });
    assert.equal(result.status, 409);
    assert.equal(code(result), "COUNT_OPERATION_IDEMPOTENCY_CONFLICT");
    assert.equal(mock.state.observations.length, 1);
    assert.equal(mock.state.lines[0].version, 1);
  });

  it("26. replay devolve o resultado ORIGINAL mesmo após recontagem posterior", async () => {
    const mock = createCollectorMockPrisma({ balanceQty: 80, systemQty: 100 });
    const first = await callCollector(mock, { body: validBody({ countedQuantity: 80 }) });
    // Recontagem legítima (nova chave, versão seguinte).
    await callCollector(mock, {
      body: validBody({ countedQuantity: 79, justification: "recontagem", expectedVersion: 1, operationId: "op-2d-2" }),
    });
    assert.equal(Number(mock.state.lines[0].countedQuantity), 79);
    // Retry atrasado da primeira operação.
    const replay = await callCollector(mock, { body: validBody({ countedQuantity: 80 }) });
    assert.equal((replay.body as { replayed: boolean }).replayed, true);
    const snapshot = (replay.body as { result: { countedQuantity: number; version: number } }).result;
    assert.equal(snapshot.countedQuantity, 80);
    assert.equal(snapshot.version, 1);
    assert.deepEqual(snapshot, (first.body as { result: unknown }).result);
  });
});

// ---------------------------------------------------------------------------
// E. TEMPORAL   /   F. WORKFLOW
// ---------------------------------------------------------------------------

describe("2D temporal", () => {
  it("27. movimento antes: expectedQuantity é o saldo sob lock, não o START", async () => {
    // START 100, saldo real 80 (movimento legítimo antes da contagem).
    const mock = createCollectorMockPrisma({ balanceQty: 80, systemQty: 100 });
    const result = await callCollector(mock, { body: validBody({ countedQuantity: 80 }) });
    const snapshot = (result.body as {
      result: { expectedQuantity: number; adjustmentDelta: number; differenceQuantity: number };
    }).result;
    assert.equal(snapshot.expectedQuantity, 80);
    assert.equal(snapshot.adjustmentDelta, 0);
    // differenceQuantity continua histórica contra o START.
    assert.equal(snapshot.differenceQuantity, -20);
  });

  it("DEVICE divergência sem texto: aceita e grava justificativa canônica", async () => {
    const mock = createCollectorMockPrisma({ balanceQty: 100, systemQty: 100 });
    const result = await callCollector(mock, {
      body: validBody({ countedQuantity: 90, justification: null }),
    });
    assert.ok((result.status ?? 200) < 400, JSON.stringify(result.body));
    assert.equal(mock.state.lines[0].justification, "Contagem física Collector");
    assert.equal(Number(mock.state.lines[0].countedQuantity), 90);
    assert.equal(Number(mock.state.observations[0].adjustmentDelta), -10);
  });

  it("28. movimento depois: delta da Observation vigente não é recalculado", async () => {
    const mock = createCollectorMockPrisma({ balanceQty: 100, systemQty: 100 });
    await callCollector(mock, {
      body: validBody({ countedQuantity: 95, justification: "falta" }),
    });
    // Saída legítima de 20 depois da contagem.
    mock.state.balances[0].physicalQuantity = new Prisma.Decimal(80);
    const obs = mock.state.observations[0];
    assert.equal(Number(obs.adjustmentDelta), -5);
    assert.equal(Number(obs.expectedQuantity), 100);
  });

  it("29/30. recontagem cria nova Observation e só a vigente vale", async () => {
    const mock = createCollectorMockPrisma({ balanceQty: 100, systemQty: 100 });
    await callCollector(mock, {
      body: validBody({ countedQuantity: 95, justification: "falta" }),
    });
    mock.state.balances[0].physicalQuantity = new Prisma.Decimal(90);
    await callCollector(mock, {
      body: validBody({ countedQuantity: 88, justification: "recontagem", expectedVersion: 1, operationId: "op-2d-2" }),
    });
    assert.equal(mock.state.observations.length, 2);
    assert.equal(Number(mock.state.observations[0].adjustmentDelta), -5);
    assert.equal(Number(mock.state.observations[1].adjustmentDelta), -2);
    assert.equal(mock.state.lines[0].currentObservationId, mock.state.observations[1].id);
  });
});

describe("2D workflow", () => {
  it("31–35. DEVICE só conta em COUNTING; demais status → SESSION_LOCKED", async () => {
    for (const status of ["OPEN", "WAITING_APPROVAL", "APPROVED", "ADJUSTED", "CANCELED"]) {
      const mock = createCollectorMockPrisma({ sessionStatus: status });
      const result = await callCollector(mock, { body: validBody() });
      assert.equal(result.status, 400, status);
      assert.equal(code(result), "SESSION_LOCKED", status);
      assert.equal(mock.state.observations.length, 0, status);
    }
    const counting = createCollectorMockPrisma({ balanceQty: 80, systemQty: 100 });
    const ok = await callCollector(counting, { body: validBody() });
    assert.equal(ok.status, null);
  });

  it("36–38. fluxo humano de finalize/approve/adjustments permanece; Collector também finaliza DEVICE", () => {
    const humanRoutes = read("src/lib/inventoryRoutes.ts");
    for (const action of ["finalize", "approve", "generate-adjustments"]) {
      const idx = humanRoutes.indexOf(`/api/inventory/count-sessions/:id/${action}`);
      assert.ok(idx > 0, action);
      const slice = humanRoutes.slice(idx, idx + 200);
      assert.match(slice, /countApprove|countManage/, action);
    }
    const collector = read("src/lib/inventory/collector/collectorRoutes.server.ts");
    assert.match(collector, /finalizeCollectorSession|count-sessions\/:id\/finalize/);
    assert.match(collector, /apply-adjustments/);
  });
});

// ---------------------------------------------------------------------------
// G. REGRESSÃO
// ---------------------------------------------------------------------------

describe("2D regressão", () => {
  it("39/40. rota humana continua USER com expectedVersion obrigatório", () => {
    const routes = read("src/lib/inventoryRoutes.ts");
    assert.match(routes, /actorType: "USER"/);
    assert.match(routes, /expectedVersion: input\.expectedVersion/);
    const validation = read("src/lib/inventory/inventoryCountValidation.ts");
    assert.match(validation, /COUNT_LINE_VERSION_REQUIRED/);
  });

  it("41/42/46. rota Collector delega ao motor canônico — zero lógica duplicada", () => {
    const src = read("src/lib/inventory/collector/collectorRoutes.server.ts");
    assert.match(src, /recordInventoryCount\(/);
    // Nada de transação/CAS/temporal próprios na rota.
    assert.doesNotMatch(src, /\$transaction/);
    assert.doesNotMatch(src, /updateMany/);
    assert.doesNotMatch(src, /inventoryCountObservation/);
    // Leituras (resolve-qr) são permitidas; ESCRITA fora do motor, nunca.
    assert.doesNotMatch(src, /inventoryCountLine\.(update|updateMany|create|upsert|delete)/);
    assert.doesNotMatch(src, /inventoryBalance/i);
    assert.doesNotMatch(src, /FOR UPDATE/);
    assert.doesNotMatch(src, /adjustmentDelta\s*=/);
  });

  it("43. 2C preservada — middleware e registry intocados nesta fase", () => {
    const auth = read("src/lib/inventory/collector/collectorDeviceAuth.server.ts");
    assert.match(auth, /tailscaleStableNodeId: identity\.stableNodeId/);
    assert.doesNotMatch(auth, /NODE_ENV/);
  });

  it("44/45. migrations Collector aditivas; Nomus e Material intocados na rota", () => {
    const migrations = readdirSync(join(process.cwd(), "prisma/migrations")).filter((d) =>
      /collector/i.test(d)
    );
    assert.deepEqual(migrations.sort(), [
      "20260819130000_inventory_collector_device_registry",
      "20260821140000_inventory_collector_device_autonomous_caps",
      "20260919120000_collector_device_enrollment",
    ]);
    // A allow-list sozinha não prova aditividade: cada migration do Collector
    // é lida e auditada (comentários fora, `ON DELETE` não é DML).
    for (const dir of migrations) {
      const sql = read(`prisma/migrations/${dir}/migration.sql`)
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n");
      assert.doesNotMatch(sql, /\bDROP\b/i, `${dir} contém DROP`);
      assert.doesNotMatch(sql, /\bTRUNCATE\b/i, `${dir} contém TRUNCATE`);
      assert.doesNotMatch(sql, /DELETE\s+FROM/i, `${dir} contém DELETE FROM`);
    }
    const collector = read("src/lib/inventory/collector/collectorRoutes.server.ts");
    assert.doesNotMatch(collector, /nomus/i);
    assert.doesNotMatch(collector, /material\.update/i);
  });

  it("paridade de status HTTP entre rota humana e Collector", () => {
    const human = read("src/lib/inventoryRoutes.ts");
    const collector = read("src/lib/inventory/collector/collectorRoutes.server.ts");
    // Ambos: version/idempotency conflict → 409; SESSION/LINE not found → 404.
    assert.match(human, /COUNT_LINE_VERSION_CONFLICT[\s\S]{0,800}\? 409/);
    assert.match(collector, /COUNT_LINE_VERSION_CONFLICT[\s\S]{0,200}409/);
    assert.match(collector, /SESSION_NOT_FOUND[\s\S]{0,400}404|404[\s\S]{0,400}SESSION_NOT_FOUND/);
    // Nenhum erro público com identidade Tailscale.
    assert.doesNotMatch(collector, /stableNodeId[\s\S]{0,40}json/i);
  });
});
