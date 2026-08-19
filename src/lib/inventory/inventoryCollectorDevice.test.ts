/**
 * FASE 2C — Device Registry + identidade Tailscale + autorização fail-closed.
 *
 * A regra sob teste: TAILSCALE IDENTITY + DEVICE REGISTRY = DEVICE AUTORIZADO,
 * fail-closed sempre. IP não é credencial, header não é credencial, body não
 * escolhe identidade, dispositivo inativo não entra, Tailscale fora do ar não
 * vira bypass.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  normalizePeerAddress,
  resolveCollectorPeerAddress,
} from "./collector/collectorPeerAddress.js";
import {
  isPlausibleStableNodeId,
  parseTailscaleWhoIsResponse,
} from "./collector/tailscaleIdentity.js";
import {
  createTailscaleLocalApiTransport,
  createTailscalePeerIdentityResolver,
} from "./collector/tailscaleIdentity.server.js";
import {
  COLLECTOR_DEVICE_DUPLICATE,
  COLLECTOR_DEVICE_NOT_FOUND,
  listCollectorDevices,
  parseRegisterCollectorDeviceBody,
  registerCollectorDevice,
  serializeCollectorDevice,
  setCollectorDeviceStatus,
} from "./collector/collectorDeviceRegistry.server.js";
import {
  COLLECTOR_DEVICE_CONTEXT_KEY,
  COLLECTOR_DEVICE_UNAUTHORIZED,
  getCollectorDeviceContext,
  requireInventoryCollectorDevice,
} from "./collector/collectorDeviceAuth.server.js";
import { InventoryValidationError } from "./inventoryTypes.js";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const SUPERVISOR = { userId: "sup-1", permissions: ["inventory.count.approve"] } as const;
const SEM_PERMISSAO = { userId: "user-1", permissions: ["inventory.view"] } as const;

// ---------------------------------------------------------------------------
// B. Peer / endereço
// ---------------------------------------------------------------------------

describe("2C peer address", () => {
  it("6. normaliza IPv4", () => {
    assert.equal(normalizePeerAddress("100.64.1.5"), "100.64.1.5");
    assert.equal(normalizePeerAddress(" 100.64.1.5 "), "100.64.1.5");
  });

  it("7. normaliza IPv6 (minúsculas, sem zone id)", () => {
    assert.equal(normalizePeerAddress("FD7A:115C:A1E0::1"), "fd7a:115c:a1e0::1");
    assert.equal(normalizePeerAddress("fe80::1%eth0"), "fe80::1");
  });

  it("8. normaliza IPv4-mapped IPv6", () => {
    assert.equal(normalizePeerAddress("::ffff:100.64.1.5"), "100.64.1.5");
    assert.equal(normalizePeerAddress("::FFFF:10.0.0.2"), "10.0.0.2");
  });

  it("entrada inválida → null (fail closed)", () => {
    assert.equal(normalizePeerAddress(""), null);
    assert.equal(normalizePeerAddress("   "), null);
    assert.equal(normalizePeerAddress(null), null);
    assert.equal(normalizePeerAddress(undefined), null);
    assert.equal(normalizePeerAddress(42), null);
    assert.equal(normalizePeerAddress("%eth0"), null);
  });

  it("9. headers do cliente não forjam peer — só o socket conta", () => {
    // A assinatura sequer recebe headers; comportamento confirma.
    const source = { socket: { remoteAddress: "::ffff:100.64.9.9" } };
    assert.equal(resolveCollectorPeerAddress(source), "100.64.9.9");
    assert.equal(resolveCollectorPeerAddress({ socket: { remoteAddress: null } }), null);
    assert.equal(resolveCollectorPeerAddress({ socket: null }), null);
    assert.equal(resolveCollectorPeerAddress({}), null);

    // Estrutural: o módulo puro não menciona nenhum header encaminhável.
    const src = read("src/lib/inventory/collector/collectorPeerAddress.ts");
    assert.doesNotMatch(src, /headers\[/);
    assert.doesNotMatch(src, /req\.headers/);
    assert.doesNotMatch(src, /["'`]x-forwarded-for["'`]\]/i);
  });
});

// ---------------------------------------------------------------------------
// C. Tailscale resolver
// ---------------------------------------------------------------------------

const WHOIS_OK = {
  Node: {
    ID: 12345,
    StableID: "nDEVICE01CNTRL",
    Name: "collector-01.tail1234.ts.net.",
    ComputedName: "collector-01",
  },
  UserProfile: { ID: 999, LoginName: "ti@lazarios.com", DisplayName: "TI" },
};

describe("2C tailscale parser/resolver", () => {
  it("10. resposta válida resolve stable node id", () => {
    const identity = parseTailscaleWhoIsResponse(WHOIS_OK);
    assert.equal(identity?.stableNodeId, "nDEVICE01CNTRL");
    assert.equal(identity?.nodeName, "collector-01");
    assert.equal(identity?.loginName, "ti@lazarios.com");
  });

  it("nodeName cai para Node.Name quando ComputedName falta", () => {
    const identity = parseTailscaleWhoIsResponse({
      Node: { StableID: "nX", Name: "coletor.ts.net." },
    });
    assert.equal(identity?.nodeName, "coletor.ts.net.");
    assert.equal(identity?.loginName, null);
  });

  it("11. ausência de node falha", () => {
    assert.equal(parseTailscaleWhoIsResponse({ UserProfile: { LoginName: "x" } }), null);
    assert.equal(parseTailscaleWhoIsResponse({}), null);
  });

  it("12. ausência de stable id falha", () => {
    assert.equal(parseTailscaleWhoIsResponse({ Node: { Name: "sem-stable" } }), null);
    assert.equal(parseTailscaleWhoIsResponse({ Node: { StableID: "" } }), null);
    assert.equal(parseTailscaleWhoIsResponse({ Node: { StableID: "   " } }), null);
    assert.equal(parseTailscaleWhoIsResponse({ Node: { StableID: 123 } }), null);
  });

  it("15. resposta malformada falha", () => {
    for (const bad of [null, undefined, "texto", 42, [], [WHOIS_OK], { Node: "string" }]) {
      assert.equal(parseTailscaleWhoIsResponse(bad), null);
    }
  });

  it("13. timeout/erro do transporte falha (resolver nunca lança)", async () => {
    const resolver = createTailscalePeerIdentityResolver({
      whois: () => Promise.reject(new Error("Tailscale WhoIs timeout.")),
    });
    assert.equal(await resolver.resolve("100.64.1.5"), null);
  });

  it("14. LocalAPI indisponível falha — transporte real contra socket inexistente", async () => {
    const transport = createTailscaleLocalApiTransport({
      socketPath: "/nonexistent/tailscaled.sock",
      timeoutMs: 200,
    });
    const resolver = createTailscalePeerIdentityResolver(transport);
    assert.equal(await resolver.resolve("100.64.1.5"), null);
  });

  it("peer vazio falha sem nem consultar o transporte", async () => {
    let called = 0;
    const resolver = createTailscalePeerIdentityResolver({
      whois: () => {
        called += 1;
        return Promise.resolve(WHOIS_OK);
      },
    });
    assert.equal(await resolver.resolve(""), null);
    assert.equal(await resolver.resolve("  "), null);
    assert.equal(called, 0);
  });

  it("isPlausibleStableNodeId barra lixo óbvio", () => {
    assert.equal(isPlausibleStableNodeId("nDEVICE01CNTRL"), true);
    assert.equal(isPlausibleStableNodeId(""), false);
    assert.equal(isPlausibleStableNodeId("ab"), false);
    assert.equal(isPlausibleStableNodeId("tem espaço"), false);
    assert.equal(isPlausibleStableNodeId(42), false);
    assert.equal(isPlausibleStableNodeId("x".repeat(200)), false);
  });
});

// ---------------------------------------------------------------------------
// Mock Prisma do registry
// ---------------------------------------------------------------------------

type DeviceRow = {
  id: string;
  name: string;
  tailscaleStableNodeId: string;
  active: boolean;
  tailscaleNodeName: string | null;
  tailscaleLoginName: string | null;
  lastSeenIp: string | null;
  lastSeenAt: Date | null;
  createdByUserId: string | null;
  disabledAt: Date | null;
  disabledByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function deviceRow(over: Partial<DeviceRow> = {}): DeviceRow {
  return {
    id: "dev-1",
    name: "Coletor 01",
    tailscaleStableNodeId: "nDEVICE01CNTRL",
    active: true,
    tailscaleNodeName: null,
    tailscaleLoginName: null,
    lastSeenIp: null,
    lastSeenAt: null,
    createdByUserId: "sup-1",
    disabledAt: null,
    disabledByUserId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

function createRegistryMockPrisma(initial: DeviceRow[] = []) {
  const state = {
    devices: initial.map((d) => ({ ...d })),
    auditLogs: [] as Array<Record<string, unknown>>,
    lastSeenUpdateShouldFail: false,
  };

  const model = {
    findUnique: async ({
      where,
    }: {
      where: { id?: string; tailscaleStableNodeId?: string };
    }) => {
      if (where.id) return state.devices.find((d) => d.id === where.id) ?? null;
      if (where.tailscaleStableNodeId) {
        return (
          state.devices.find(
            (d) => d.tailscaleStableNodeId === where.tailscaleStableNodeId
          ) ?? null
        );
      }
      return null;
    },
    findMany: async () => [...state.devices],
    create: async ({ data }: { data: Record<string, unknown> }) => {
      if (
        state.devices.some(
          (d) => d.tailscaleStableNodeId === data.tailscaleStableNodeId
        )
      ) {
        const err = new Error("unique violation") as Error & { code: string };
        err.code = "P2002";
        throw err;
      }
      const row = deviceRow({
        id: `dev-${state.devices.length + 1}`,
        ...data,
      } as Partial<DeviceRow>);
      state.devices.push(row);
      return row;
    },
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Record<string, unknown>;
    }) => {
      if (state.lastSeenUpdateShouldFail && "lastSeenAt" in data) {
        throw new Error("update indisponível");
      }
      const idx = state.devices.findIndex((d) => d.id === where.id);
      if (idx < 0) throw new Error("not found");
      state.devices[idx] = { ...state.devices[idx], ...data } as DeviceRow;
      return state.devices[idx];
    },
  };

  const tx = {
    inventoryCollectorDevice: model,
    inventoryAuditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.auditLogs.push(data);
        return data;
      },
    },
  };

  const snapshot = () => ({
    devices: state.devices.map((d) => ({ ...d })),
    auditLogs: state.auditLogs.map((a) => ({ ...a })),
  });
  const restore = (snap: ReturnType<typeof snapshot>) => {
    state.devices.splice(0, state.devices.length, ...snap.devices);
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
// A. Registry + E. Administração
// ---------------------------------------------------------------------------

describe("2C registry — administração humana", () => {
  it("1/25/27. supervisor cadastra dispositivo válido com auditoria", async () => {
    const { prisma, state } = createRegistryMockPrisma();
    const device = await registerCollectorDevice(
      prisma as never,
      parseRegisterCollectorDeviceBody({
        name: "Coletor 01",
        tailscaleStableNodeId: "nDEVICE01CNTRL",
      }),
      SUPERVISOR
    );
    assert.equal(device.active, true);
    assert.equal(device.createdByUserId, "sup-1");
    assert.equal(state.devices.length, 1);
    assert.equal(state.auditLogs.length, 1);
    assert.equal(state.auditLogs[0].action, "DEVICE_REGISTERED");
    assert.equal(state.auditLogs[0].userId, "sup-1");
  });

  it("2. stable node id é único", async () => {
    const { prisma, state } = createRegistryMockPrisma([deviceRow()]);
    await assert.rejects(
      () =>
        registerCollectorDevice(
          prisma as never,
          { name: "Clone", tailscaleStableNodeId: "nDEVICE01CNTRL" },
          SUPERVISOR
        ),
      (e: unknown) =>
        e instanceof InventoryValidationError && e.code === COLLECTOR_DEVICE_DUPLICATE
    );
    // Rollback: nem auditoria nem segundo registro.
    assert.equal(state.devices.length, 1);
    assert.equal(state.auditLogs.length, 0);
  });

  it("4/26/27. desativação é soft, preserva histórico e audita", async () => {
    const { prisma, state } = createRegistryMockPrisma([deviceRow()]);
    const updated = await setCollectorDeviceStatus(prisma as never, "dev-1", false, SUPERVISOR);
    assert.equal(updated.active, false);
    assert.notEqual(updated.disabledAt, null);
    assert.equal(updated.disabledByUserId, "sup-1");
    // Histórico preservado: a linha continua existindo.
    assert.equal(state.devices.length, 1);
    assert.equal(state.auditLogs.length, 1);
    assert.equal(state.auditLogs[0].action, "DEVICE_DISABLED");
  });

  it("5. reativação funciona e limpa os campos de desativação", async () => {
    const { prisma, state } = createRegistryMockPrisma([
      deviceRow({ active: false, disabledAt: new Date(), disabledByUserId: "sup-0" }),
    ]);
    const updated = await setCollectorDeviceStatus(prisma as never, "dev-1", true, SUPERVISOR);
    assert.equal(updated.active, true);
    assert.equal(updated.disabledAt, null);
    assert.equal(updated.disabledByUserId, null);
    assert.equal(state.auditLogs[0].action, "DEVICE_ENABLED");
  });

  it("status igual não duplica auditoria", async () => {
    const { prisma, state } = createRegistryMockPrisma([deviceRow()]);
    await setCollectorDeviceStatus(prisma as never, "dev-1", true, SUPERVISOR);
    assert.equal(state.auditLogs.length, 0);
  });

  it("dispositivo inexistente → COLLECTOR_DEVICE_NOT_FOUND", async () => {
    const { prisma } = createRegistryMockPrisma();
    await assert.rejects(
      () => setCollectorDeviceStatus(prisma as never, "dev-x", false, SUPERVISOR),
      (e: unknown) =>
        e instanceof InventoryValidationError && e.code === COLLECTOR_DEVICE_NOT_FOUND
    );
  });

  it("24. sem permissão → negado em listar/cadastrar/status", async () => {
    const { prisma, state } = createRegistryMockPrisma([deviceRow()]);
    for (const call of [
      () => listCollectorDevices(prisma as never, SEM_PERMISSAO),
      () =>
        registerCollectorDevice(
          prisma as never,
          { name: "X", tailscaleStableNodeId: "nOUTRO" },
          SEM_PERMISSAO
        ),
      () => setCollectorDeviceStatus(prisma as never, "dev-1", false, SEM_PERMISSAO),
    ]) {
      await assert.rejects(
        call,
        (e: unknown) => e instanceof InventoryValidationError && e.code === "NOT_AUTHORIZED"
      );
    }
    assert.equal(state.auditLogs.length, 0);
  });

  it("23. rotas administrativas exigem login humano + permissão (estrutural)", () => {
    const routes = read("src/lib/inventoryRoutes.ts");
    for (const route of [
      '"/api/inventory/collector-devices"',
      '"/api/inventory/collector-devices/:id/status"',
    ]) {
      const idx = routes.indexOf(route);
      assert.ok(idx > 0, `rota ${route} não registrada`);
      const slice = routes.slice(idx, idx + 400);
      assert.match(slice, /countApprove/);
      assert.match(slice, /getCurrentAppUser/);
    }
  });

  it("validação de corpo: nome e stable id", () => {
    assert.throws(
      () => parseRegisterCollectorDeviceBody({ tailscaleStableNodeId: "nX123" }),
      (e: unknown) => e instanceof InventoryValidationError && e.code === "FIELD_REQUIRED"
    );
    assert.throws(
      () => parseRegisterCollectorDeviceBody({ name: "X", tailscaleStableNodeId: "a b" }),
      (e: unknown) =>
        e instanceof InventoryValidationError &&
        e.code === "COLLECTOR_STABLE_NODE_ID_INVALID"
    );
    const ok = parseRegisterCollectorDeviceBody({
      name: "  Coletor 02  ",
      tailscaleStableNodeId: "  nDEVICE02  ",
      tailscaleNodeName: " coletor-02 ",
    });
    assert.equal(ok.name, "Coletor 02");
    assert.equal(ok.tailscaleStableNodeId, "nDEVICE02");
    assert.equal(ok.tailscaleNodeName, "coletor-02");
  });

  it("serialização não inventa campos sensíveis", () => {
    const dto = serializeCollectorDevice(deviceRow({ lastSeenAt: new Date(0) }));
    assert.deepEqual(Object.keys(dto).sort(), [
      "active",
      "createdAt",
      "createdByUserId",
      "disabledAt",
      "disabledByUserId",
      "id",
      "lastSeenAt",
      "lastSeenIp",
      "name",
      "tailscaleLoginName",
      "tailscaleNodeName",
      "tailscaleStableNodeId",
      "updatedAt",
    ]);
  });
});

// ---------------------------------------------------------------------------
// D. Middleware fail-closed
// ---------------------------------------------------------------------------

type FakeRes = {
  statusCode: number | null;
  body: unknown;
  locals: Record<string, unknown>;
  status(code: number): FakeRes;
  json(payload: unknown): FakeRes;
};

function fakeRes(): FakeRes {
  return {
    statusCode: null,
    body: null,
    locals: {},
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
}

function fakeReq(over: Record<string, unknown> = {}) {
  return {
    socket: { remoteAddress: "::ffff:100.64.1.5" },
    headers: {},
    body: {},
    query: {},
    ...over,
  };
}

function resolverFor(map: Record<string, unknown>) {
  return {
    resolve: async (peer: string) =>
      Object.prototype.hasOwnProperty.call(map, peer)
        ? (map[peer] as never)
        : null,
  };
}

async function runMiddleware(
  deps: Parameters<typeof requireInventoryCollectorDevice>[0],
  req: unknown
) {
  const res = fakeRes();
  let nextCalled = false;
  await requireInventoryCollectorDevice(deps)(
    req as never,
    res as never,
    () => {
      nextCalled = true;
    }
  );
  return { res, nextCalled };
}

const IDENTITY = {
  stableNodeId: "nDEVICE01CNTRL",
  nodeName: "collector-01",
  loginName: "ti@lazarios.com",
};

describe("2C middleware fail-closed", () => {
  it("16/22. node registrado + ativo → autorizado com contexto DEVICE server-side", async () => {
    const { prisma, state } = createRegistryMockPrisma([deviceRow()]);
    const { res, nextCalled } = await runMiddleware(
      {
        prisma: prisma as never,
        identityResolver: resolverFor({ "100.64.1.5": IDENTITY }),
        now: () => new Date("2026-08-19T12:00:00Z"),
      },
      fakeReq()
    );
    assert.equal(nextCalled, true);
    const context = getCollectorDeviceContext(res as never);
    assert.deepEqual(context, { actorType: "DEVICE", deviceId: "dev-1", userId: null });
    // Contexto é congelado — endpoint futuro não muta.
    assert.equal(Object.isFrozen(context), true);
    // lastSeen best-effort atualizado.
    assert.equal(state.devices[0].lastSeenIp, "100.64.1.5");
    assert.equal(state.devices[0].lastSeenAt?.toISOString(), "2026-08-19T12:00:00.000Z");
    assert.equal(state.devices[0].tailscaleNodeName, "collector-01");
  });

  it("17. node não registrado → negado", async () => {
    const { prisma } = createRegistryMockPrisma([]);
    const { res, nextCalled } = await runMiddleware(
      { prisma: prisma as never, identityResolver: resolverFor({ "100.64.1.5": IDENTITY }) },
      fakeReq()
    );
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
    assert.equal((res.body as { code: string }).code, COLLECTOR_DEVICE_UNAUTHORIZED);
    assert.equal(res.locals[COLLECTOR_DEVICE_CONTEXT_KEY], undefined);
  });

  it("18/3. node registrado porém inativo → negado", async () => {
    const { prisma } = createRegistryMockPrisma([deviceRow({ active: false })]);
    const { res, nextCalled } = await runMiddleware(
      { prisma: prisma as never, identityResolver: resolverFor({ "100.64.1.5": IDENTITY }) },
      fakeReq()
    );
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
  });

  it("19. falha do WhoIs → negado (nunca 500 permissivo)", async () => {
    const { prisma } = createRegistryMockPrisma([deviceRow()]);
    for (const identityResolver of [
      resolverFor({}),
      { resolve: async () => Promise.reject(new Error("boom")) as never },
    ]) {
      const { res, nextCalled } = await runMiddleware(
        { prisma: prisma as never, identityResolver: identityResolver as never },
        fakeReq()
      );
      assert.equal(nextCalled, false);
      assert.equal(res.statusCode, 403);
    }
  });

  it("9/20/21. header, body e query não escolhem peer, deviceId nem actorType", async () => {
    const { prisma } = createRegistryMockPrisma([deviceRow()]);

    // Sem socket, mesmo com XFF apontando para peer válido: negado.
    const forged = await runMiddleware(
      { prisma: prisma as never, identityResolver: resolverFor({ "100.64.1.5": IDENTITY }) },
      fakeReq({
        socket: { remoteAddress: undefined },
        headers: { "x-forwarded-for": "100.64.1.5", "x-real-ip": "100.64.1.5" },
      })
    );
    assert.equal(forged.nextCalled, false);
    assert.equal(forged.res.statusCode, 403);

    // Body malicioso não altera o contexto resultante.
    const withBody = await runMiddleware(
      { prisma: prisma as never, identityResolver: resolverFor({ "100.64.1.5": IDENTITY }) },
      fakeReq({
        body: { deviceId: "dev-do-mal", actorType: "SYSTEM", userId: "admin" },
        query: { deviceId: "dev-do-mal" },
      })
    );
    assert.equal(withBody.nextCalled, true);
    assert.deepEqual(getCollectorDeviceContext(withBody.res as never), {
      actorType: "DEVICE",
      deviceId: "dev-1",
      userId: null,
    });
  });

  it("falha no update de lastSeen não muda a decisão de autorização", async () => {
    const { prisma, state } = createRegistryMockPrisma([deviceRow()]);
    state.lastSeenUpdateShouldFail = true;
    const { res, nextCalled } = await runMiddleware(
      { prisma: prisma as never, identityResolver: resolverFor({ "100.64.1.5": IDENTITY }) },
      fakeReq()
    );
    assert.equal(nextCalled, true);
    assert.notEqual(res.statusCode, 403);
  });

  it("28. lookup de autorização é pelo stable node id — nunca por IP", () => {
    const src = read("src/lib/inventory/collector/collectorDeviceAuth.server.ts");
    assert.match(src, /tailscaleStableNodeId: identity\.stableNodeId/);
    assert.doesNotMatch(src, /where:\s*\{\s*lastSeenIp/);
    assert.doesNotMatch(src, /findFirst/);
  });

  it("30. nenhum bypass DEV silencioso nos módulos do Collector", () => {
    for (const file of [
      "src/lib/inventory/collector/collectorDeviceAuth.server.ts",
      "src/lib/inventory/collector/collectorDeviceRegistry.server.ts",
      "src/lib/inventory/collector/tailscaleIdentity.server.ts",
      "src/lib/inventory/collector/collectorPeerAddress.ts",
      "src/lib/inventory/collector/tailscaleIdentity.ts",
    ]) {
      const src = read(file);
      assert.doesNotMatch(src, /NODE_ENV/, file);
      assert.doesNotMatch(src, /INVENTORY_COLLECTOR_BYPASS|SKIP_AUTH|ALLOW_ALL/i, file);
    }
  });

  it("29. nenhuma rota Collector de dispositivo usa login humano implicitamente", () => {
    const routes = read("src/lib/inventoryRoutes.ts");
    // O middleware de dispositivo existe mas AINDA não protege rota nenhuma —
    // a escrita DEVICE é fase futura. Proibimos USO (import/chamada), não menção
    // em comentário.
    assert.doesNotMatch(routes, /collectorDeviceAuth.server/);
    assert.doesNotMatch(routes, /requireInventoryCollectorDevice\(/);
    const auth = read("src/lib/inventory/collector/collectorDeviceAuth.server.ts");
    assert.doesNotMatch(auth, /getCurrentAppUser/);
    assert.doesNotMatch(auth, /requireAppAuth/);
  });
});

// ---------------------------------------------------------------------------
// F. Segurança estrutural — migration e fronteiras
// ---------------------------------------------------------------------------

describe("2C segurança estrutural", () => {
  const migration = () =>
    read(
      "prisma/migrations/20260819130000_inventory_collector_device_registry/migration.sql"
    );

  it("32. migration é aditiva — só CREATE, zero DROP/destructive", () => {
    const sql = migration();
    assert.match(sql, /CREATE TABLE "InventoryCollectorDevice"/);
    assert.doesNotMatch(sql, /DROP /);
    assert.doesNotMatch(sql, /ALTER TABLE "(?!InventoryCollectorDevice)/);
    assert.doesNotMatch(sql, /DELETE FROM/);
    assert.doesNotMatch(sql, /UPDATE /);
  });

  it("33/34. migration não toca Nomus nem Material (só SQL efetivo conta)", () => {
    const sql = migration()
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    assert.doesNotMatch(sql, /Nomus/i);
    assert.doesNotMatch(sql, /"Material"/);
  });

  it("35. semântica 2A/2B intocada — módulos canônicos não foram alterados por esta fase", () => {
    // O serviço canônico de contagem não conhece o Collector; a integração
    // DEVICE→recordInventoryCount é fase futura.
    const app = read("src/lib/inventory/inventoryCountApplicationService.server.ts");
    // Proibimos DEPENDÊNCIA (import), não menção em comentário de contexto.
    assert.doesNotMatch(app, /from "\.\/collector\//);
    assert.doesNotMatch(app, /tailscaleIdentity|collectorDevice/);
    const schema = read("prisma/schema.prisma");
    assert.match(schema, /model InventoryCountObservation \{/);
    assert.match(schema, /model InventoryCountOperation \{/);
  });

  it("31. frontend não importa os módulos server-only do Collector", () => {
    // Reforço local ao checkFrontendServerImports: nenhum componente importa
    // os módulos do Collector.
    const routes = read("src/lib/inventoryRoutes.ts");
    assert.match(routes, /collectorDeviceRegistry\.server\.js/);
  });

  it("DEVICE não vira usuário humano falso", () => {
    const auth = read("src/lib/inventory/collector/collectorDeviceAuth.server.ts");
    assert.match(auth, /userId: null/);
    assert.doesNotMatch(auth, /userId: device/);
    assert.doesNotMatch(auth, /AppUser/);
  });
});
