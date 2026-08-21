/**
 * FASE 3 — contrato QR, resolução QR→linha e leituras DEVICE.
 *
 * O QR é localizador, nunca credencial: os testes provam que ele não carrega
 * identidade, que o servidor revalida tudo e que as leituras do Collector
 * continuam atrás do deviceAuth fail-closed — login humano não participa.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import {
  buildCollectorQrText,
  parseCollectorQrText,
  QR_INVALID,
  QR_VERSION_UNSUPPORTED,
} from "./collector/collectorQrContract.js";
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

const ITEM = "11111111-1111-4111-8111-111111111111";
const WH = "22222222-2222-4222-8222-222222222222";
const LOC = "33333333-3333-4333-8333-333333333333";
const OTHER_WH = "44444444-4444-4444-8444-444444444444";
const SESSION = "55555555-5555-4555-8555-555555555555";
const LINE = "66666666-6666-4666-8666-666666666666";

// ---------------------------------------------------------------------------
// QR CONTRACT (1–8) + SECURITY do payload (33–36)
// ---------------------------------------------------------------------------

describe("F3 contrato QR", () => {
  it("1. payload válido faz roundtrip determinístico", () => {
    const text = buildCollectorQrText({ itemId: ITEM, warehouseId: WH, locationId: LOC });
    const parsed = parseCollectorQrText(text);
    assert.deepEqual(parsed, { v: 1, t: "inv-loc", itemId: ITEM, warehouseId: WH, locationId: LOC });
    // Sem endereço também é válido (saldo no nível do almoxarifado).
    const noLoc = parseCollectorQrText(buildCollectorQrText({ itemId: ITEM, warehouseId: WH }));
    assert.equal(noLoc.locationId, null);
  });

  it("2. versão desconhecida rejeita", () => {
    assert.throws(
      () => parseCollectorQrText(JSON.stringify({ v: 2, t: "inv-loc", itemId: ITEM, warehouseId: WH })),
      (e: unknown) => e instanceof InventoryValidationError && e.code === QR_VERSION_UNSUPPORTED
    );
  });

  it("3/4/5. itemId/warehouseId/locationId inválidos rejeitam", () => {
    for (const bad of [
      { v: 1, t: "inv-loc", itemId: "nao-uuid", warehouseId: WH },
      { v: 1, t: "inv-loc", itemId: ITEM, warehouseId: 42 },
      { v: 1, t: "inv-loc", itemId: ITEM, warehouseId: WH, locationId: "x" },
    ]) {
      assert.throws(
        () => parseCollectorQrText(JSON.stringify(bad)),
        (e: unknown) => e instanceof InventoryValidationError && e.code === QR_INVALID
      );
    }
  });

  it("7. payload malformado rejeita", () => {
    for (const bad of ["", "   ", "texto solto", "{corrompido", "[1,2]", "42", null, undefined]) {
      assert.throws(
        () => parseCollectorQrText(bad),
        (e: unknown) => e instanceof InventoryValidationError
      );
    }
  });

  it("8/33/34/35/36. campos extras não influenciam e QR nunca carrega identidade", () => {
    // Campos extras (inclusive maliciosos) são ignorados na identidade.
    const parsed = parseCollectorQrText(
      JSON.stringify({
        v: 1,
        t: "inv-loc",
        itemId: ITEM,
        warehouseId: WH,
        locationId: null,
        deviceId: "dev-do-mal",
        actorType: "SYSTEM",
        userId: "admin",
        tailscaleStableNodeId: "nFAKE",
        token: "abc",
      })
    );
    assert.deepEqual(Object.keys(parsed).sort(), ["itemId", "locationId", "t", "v", "warehouseId"]);

    // O QR gerado oficialmente não contém NADA além do localizador.
    const text = buildCollectorQrText({ itemId: ITEM, warehouseId: WH, locationId: LOC });
    for (const forbidden of ["deviceId", "actorType", "userId", "StableID", "stableNodeId", "token", "secret"]) {
      assert.equal(text.includes(forbidden), false, forbidden);
    }
  });
});

// ---------------------------------------------------------------------------
// Harness de rotas DEVICE (mock prisma + resolver mockado)
// ---------------------------------------------------------------------------

type Handler = (req: unknown, res: unknown, next: () => void) => unknown;

function createMock(options?: {
  sessionStatus?: string;
  lines?: Array<Record<string, unknown>>;
  itemStatus?: string;
  warehouseStatus?: string;
  locationStatus?: string;
  locationWarehouseId?: string;
}) {
  const state = {
    devices: [
      { id: "dev-1", name: "Coletor 01", tailscaleStableNodeId: "nDEV1", active: true, canManageCountSessions: true, canApplyCountAdjustments: true },
      { id: "dev-off", name: "Desativado", tailscaleStableNodeId: "nOFF", active: false },
    ],
    sessions: [
      {
        id: SESSION,
        code: "CF-F3",
        status: options?.sessionStatus ?? "COUNTING",
        warehouseId: WH,
        startedAt: new Date(),
        warehouse: { code: "ALM1", name: "Central" },
        lines: [{ countedQuantity: null }],
      },
    ],
    lines:
      options?.lines ??
      ([
        {
          id: LINE,
          sessionId: SESSION,
          itemId: ITEM,
          warehouseId: WH,
          locationId: LOC,
          version: 3,
          countedQuantity: null,
          generatedMovementId: null,
        },
      ] as Array<Record<string, unknown>>),
  };

  const prisma = {
    inventoryCollectorDevice: {
      findUnique: async ({ where }: { where: { id?: string; tailscaleStableNodeId?: string } }) =>
        state.devices.find(
          (d) =>
            (where.id && d.id === where.id) ||
            (where.tailscaleStableNodeId && d.tailscaleStableNodeId === where.tailscaleStableNodeId)
        ) ?? null,
      update: async () => state.devices[0],
    },
    inventoryCountSession: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        state.sessions.find((s) => s.id === where.id) ?? null,
      findMany: async ({ where }: { where: { status?: string } }) =>
        state.sessions.filter((s) => !where.status || s.status === where.status),
    },
    inventoryItem: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === ITEM
          ? {
              id: ITEM,
              status: options?.itemStatus ?? "ACTIVE",
              code: "MP-001",
              description: "Resina ABS",
              unit: "KG",
            }
          : null,
    },
    inventoryWarehouse: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === WH
          ? { id: WH, status: options?.warehouseStatus ?? "ACTIVE", code: "ALM1", name: "Central" }
          : null,
    },
    inventoryLocation: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === LOC
          ? {
              id: LOC,
              status: options?.locationStatus ?? "ACTIVE",
              code: "A-01",
              name: "Corredor A",
              warehouseId: options?.locationWarehouseId ?? WH,
            }
          : null,
    },
    inventoryCountLine: {
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        state.lines.filter(
          (l) =>
            l.sessionId === where.sessionId &&
            l.itemId === where.itemId &&
            l.warehouseId === where.warehouseId &&
            (l.locationId ?? null) === (where.locationId ?? null)
        ),
      findFirst: async () => null,
      updateMany: async () => ({ count: 0 }),
    },
  };

  return { prisma, state };
}

function buildApp(mock: ReturnType<typeof createMock>) {
  const routes: Record<string, Handler[]> = {};
  const app = {
    get(path: string, ...handlers: Handler[]) {
      routes[`GET ${path}`] = handlers;
    },
    post(path: string, ...handlers: Handler[]) {
      routes[`POST ${path}`] = handlers;
    },
    patch(path: string, ...handlers: Handler[]) {
      routes[`PATCH ${path}`] = handlers;
    },
  };
  const identityResolver = {
    resolve: async (peer: string) =>
      peer === "100.64.1.5"
        ? { stableNodeId: "nDEV1", nodeName: "c01", loginName: null }
        : peer === "100.64.3.3"
          ? { stableNodeId: "nOFF", nodeName: "off", loginName: null }
          : null,
  };
  registerInventoryCollectorRoutes(app as never, {
    prisma: mock.prisma as never,
    identityResolver,
  });
  return routes;
}

async function call(
  routes: Record<string, Handler[]>,
  key: string,
  options: { remoteAddress?: string; body?: unknown; params?: Record<string, string> } = {}
) {
  const handlers = routes[key];
  assert.ok(handlers, `rota ${key} não registrada`);
  const req = {
    socket: { remoteAddress: options.remoteAddress ?? "100.64.1.5" },
    headers: {},
    params: options.params ?? {},
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
    let next = false;
    await handler(req, res, () => {
      next = true;
    });
    if (!next && res.statusCode !== null && handler !== handlers[handlers.length - 1]) break;
  }
  return res;
}

const RESOLVE = "POST /api/inventory/collector/resolve-qr";
const SESSIONS = "GET /api/inventory/collector/count-sessions";
const CONTEXT = "GET /api/inventory/collector/context";

function qrText(locationId: string | null = LOC) {
  return buildCollectorQrText({ itemId: ITEM, warehouseId: WH, locationId });
}

// ---------------------------------------------------------------------------
// RESOLUTION (9–12) + WORKFLOW (27–32)
// ---------------------------------------------------------------------------

describe("F3 resolução QR → linha", () => {
  it("9. QR válido resolve a linha correta — CONTAGEM CEGA (sem saldo)", async () => {
    const mock = createMock();
    const res = await call(buildApp(mock), RESOLVE, {
      body: { sessionId: SESSION, qr: qrText() },
    });
    assert.equal(res.statusCode, null, JSON.stringify(res.body));
    const line = (res.body as { line: Record<string, unknown> }).line;
    assert.equal(line.lineId, LINE);
    assert.equal(line.expectedVersion, 3);
    assert.equal(line.itemCode, "MP-001");
    assert.equal(line.locationCode, "A-01");
    // Cegueira: nenhuma quantidade do sistema na resposta.
    for (const forbidden of ["systemQuantity", "countedQuantity", "differenceQuantity", "physicalQuantity"]) {
      assert.equal(forbidden in line, false, forbidden);
    }
    assert.equal(line.alreadyCounted, false);
  });

  it("10/27–32. sessão fora de COUNTING rejeita; COUNTING funciona", async () => {
    for (const status of ["OPEN", "WAITING_APPROVAL", "APPROVED", "ADJUSTED", "CANCELED"]) {
      const res = await call(buildApp(createMock({ sessionStatus: status })), RESOLVE, {
        body: { sessionId: SESSION, qr: qrText() },
      });
      assert.equal(res.statusCode, 400, status);
      assert.equal((res.body as { code: string }).code, "SESSION_LOCKED", status);
    }
  });

  it("11. combinação fora da sessão rejeita com QR_LINE_NOT_FOUND", async () => {
    const res = await call(buildApp(createMock({ lines: [] })), RESOLVE, {
      body: { sessionId: SESSION, qr: qrText() },
    });
    assert.equal(res.statusCode, 404);
    assert.equal((res.body as { code: string }).code, "QR_LINE_NOT_FOUND");
  });

  it("12. combinação ambígua NUNCA é escolhida silenciosamente", async () => {
    const dup = {
      id: LINE,
      sessionId: SESSION,
      itemId: ITEM,
      warehouseId: WH,
      locationId: LOC,
      version: 0,
      countedQuantity: null,
      generatedMovementId: null,
    };
    const res = await call(
      buildApp(createMock({ lines: [dup, { ...dup, id: "outra-linha" }] })),
      RESOLVE,
      { body: { sessionId: SESSION, qr: qrText() } }
    );
    assert.equal(res.statusCode, 409);
    assert.equal((res.body as { code: string }).code, "QR_AMBIGUOUS");
  });

  it("6. location de outro warehouse rejeita (QR_TARGET_NOT_FOUND)", async () => {
    const res = await call(buildApp(createMock({ locationWarehouseId: OTHER_WH })), RESOLVE, {
      body: { sessionId: SESSION, qr: qrText() },
    });
    assert.equal(res.statusCode, 404);
    assert.equal((res.body as { code: string }).code, "QR_TARGET_NOT_FOUND");
  });

  it("item/warehouse inativos rejeitam; QR de outro almoxarifado da sessão rejeita", async () => {
    for (const opts of [{ itemStatus: "INACTIVE" }, { warehouseStatus: "INACTIVE" }]) {
      const res = await call(buildApp(createMock(opts)), RESOLVE, {
        body: { sessionId: SESSION, qr: qrText() },
      });
      assert.equal(res.statusCode, 404, JSON.stringify(opts));
      assert.equal((res.body as { code: string }).code, "QR_TARGET_NOT_FOUND");
    }
    // QR aponta para almoxarifado diferente do da sessão.
    const wrong = await call(buildApp(createMock()), RESOLVE, {
      body: {
        sessionId: SESSION,
        qr: buildCollectorQrText({ itemId: ITEM, warehouseId: OTHER_WH, locationId: null }),
      },
    });
    assert.equal(wrong.statusCode, 400);
    assert.equal((wrong.body as { code: string }).code, "QR_WRONG_WAREHOUSE");
  });

  it("linha já ajustada rejeita com ADJUSTMENT_EXISTS", async () => {
    const res = await call(
      buildApp(
        createMock({
          lines: [
            {
              id: LINE,
              sessionId: SESSION,
              itemId: ITEM,
              warehouseId: WH,
              locationId: LOC,
              version: 1,
              countedQuantity: new Prisma.Decimal(10),
              generatedMovementId: "mov-1",
            },
          ],
        })
      ),
      RESOLVE,
      { body: { sessionId: SESSION, qr: qrText() } }
    );
    assert.equal(res.statusCode, 400);
    assert.equal((res.body as { code: string }).code, "ADJUSTMENT_EXISTS");
  });
});

// ---------------------------------------------------------------------------
// DEVICE READ (13–16) + SECURITY (37–40)
// ---------------------------------------------------------------------------

describe("F3 leituras DEVICE", () => {
  it("13. device ativo lê contexto e sessões COUNTING", async () => {
    const mock = createMock();
    const routes = buildApp(mock);
    const context = await call(routes, CONTEXT);
    assert.deepEqual(context.body, {
      device: {
        id: "dev-1",
        name: "Coletor 01",
        canManageCountSessions: true,
        canApplyCountAdjustments: true,
      },
    });

    const sessions = await call(routes, SESSIONS);
    const list = (sessions.body as { sessions: Array<Record<string, unknown>> }).sessions;
    assert.equal(list.length, 1);
    assert.equal(list[0].code, "CF-F3");
    assert.equal(list[0].totalLines, 1);
    // Nada além do mínimo operacional.
    for (const forbidden of ["stableNodeId", "tailscale", "lastSeenIp", "cost", "userId"]) {
      assert.equal(JSON.stringify(sessions.body).toLowerCase().includes(forbidden.toLowerCase()), false, forbidden);
    }
  });

  it("14/15. não registrado e inativo negam TODAS as leituras", async () => {
    const routes = buildApp(createMock());
    for (const remoteAddress of ["100.64.9.9", "100.64.3.3"]) {
      for (const key of [CONTEXT, SESSIONS]) {
        const res = await call(routes, key, { remoteAddress });
        assert.equal(res.statusCode, 403, `${key} ${remoteAddress}`);
      }
      const resolve = await call(routes, RESOLVE, {
        remoteAddress,
        body: { sessionId: SESSION, qr: qrText() },
      });
      assert.equal(resolve.statusCode, 403);
    }
  });

  it("16/40. login humano sozinho não libera Collector; admin continua humano", () => {
    const src = read("src/lib/inventory/collector/collectorRoutes.server.ts")
      .split("\n")
      .filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//") && !l.trim().startsWith("/*"))
      .join("\n");
    assert.doesNotMatch(src, /requireAppAuth/);
    assert.doesNotMatch(src, /requireResource/);
    // Rotas administrativas (registry/labels) continuam no fluxo humano.
    const human = read("src/lib/inventoryRoutes.ts");
    const labelsIdx = human.indexOf('"/api/inventory/count-labels"');
    assert.ok(labelsIdx > 0);
    assert.match(human.slice(labelsIdx, labelsIdx + 300), /countManage/);
  });

  it("37/38/39. namespace Collector DEVICE: finalize/apply autônomos; sem QR humano/approve", () => {
    const src = read("src/lib/inventory/collector/collectorRoutes.server.ts")
      .split("\n")
      .filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//"))
      .join("\n");
    // Autônomo: finalize + apply-adjustments no Collector (DEVICE).
    assert.match(src, /finalize/);
    assert.match(src, /apply-adjustments/);
    // Ainda exclusivos do fluxo humano: approve solto, cancel, start legado, labels.
    for (const forbidden of ["/approve", "/cancel", "count-labels", "buildCollectorQrText"]) {
      assert.equal(src.includes(forbidden), false, forbidden);
    }
    assert.doesNotMatch(src, /inventoryMovement/);
    assert.doesNotMatch(src, /buildCollectorQrText/);
  });
});

// ---------------------------------------------------------------------------
// REGRESSION (41–47)
// ---------------------------------------------------------------------------

describe("F3 regressão estrutural", () => {
  it("41/42/44/45. contagem continua passando SÓ por recordInventoryCount", () => {
    const src = read("src/lib/inventory/collector/collectorRoutes.server.ts")
      .split("\n")
      .filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//"))
      .join("\n");
    assert.match(src, /recordInventoryCount\(/);
    assert.doesNotMatch(src, /\$transaction/);
    assert.doesNotMatch(src, /inventoryCountObservation/);
    assert.doesNotMatch(src, /inventoryBalance\.(update|create|upsert)/);
    // Leituras de resolve não escrevem nada.
    assert.doesNotMatch(src, /inventoryCountLine\.update\b/);
  });

  it("43. 2C preservada — deviceAuth continua a única porta", () => {
    const src = read("src/lib/inventory/collector/collectorRoutes.server.ts");
    const registrations = src.match(/app\.(get|post|patch)\(/g) ?? [];
    assert.ok(registrations.length >= 9, `esperado ≥9 rotas DEVICE, veio ${registrations.length}`);
    assert.equal((src.match(/deviceAuth/g) ?? []).length >= registrations.length + 1, true);
  });

  it("46/47. Nomus e Material fora do Collector", () => {
    for (const file of [
      "src/lib/inventory/collector/collectorRoutes.server.ts",
      "src/lib/inventory/collector/collectorQrContract.ts",
      "src/components/inventory/collector/collectorCountFlow.ts",
      "src/components/inventory/collector/collectorClient.ts",
    ]) {
      const src = codeOnly(read(file));
      assert.doesNotMatch(src, /[Nn]omus/, file);
      assert.doesNotMatch(src, /Material\./, file);
    }
  });

  it("UI cega: página do Collector nunca renderiza saldo do sistema", () => {
    for (const file of [
      "src/components/inventory/collector/CollectorPage.tsx",
      "src/components/inventory/collector/collectorCountFlow.ts",
      "src/components/inventory/collector/collectorClient.ts",
    ]) {
      const src = codeOnly(read(file));
      assert.doesNotMatch(src, /systemQuantity/, file);
      assert.doesNotMatch(src, /physicalQuantity/, file);
    }
  });
});
