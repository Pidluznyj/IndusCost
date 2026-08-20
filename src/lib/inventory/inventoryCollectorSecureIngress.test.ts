/**
 * FASE 3A — peer com reverse proxy local opt-in, fail-closed.
 *
 * O que está sob prova: o header dedicado só vale com flag ligada + socket
 * loopback + exatamente um IP válido; nenhum header genérico (XFF, X-Real-IP,
 * CF-Connecting-IP) participa em modo algum; e mesmo o header dedicado nunca
 * autoriza sozinho — WhoIs + Device Registry continuam decidindo.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  COLLECTOR_PEER_HEADER,
  isTrustedLocalProxyAddress,
  resolveCollectorPeerFromRequest,
} from "./collector/collectorProxyPeer.js";
import {
  COLLECTOR_DEVICE_CONTEXT_KEY,
  getCollectorDeviceContext,
  requireInventoryCollectorDevice,
} from "./collector/collectorDeviceAuth.server.js";

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

const TAILNET_PEER = "100.64.1.5";

function req(socket: string | null, headers: Record<string, string | string[]> = {}) {
  return { socket: { remoteAddress: socket }, headers };
}

// ---------------------------------------------------------------------------
// Resolução de peer (1–9)
// ---------------------------------------------------------------------------

describe("3A resolução de peer", () => {
  it("1. socket Tailscale direto continua funcionando — com e sem flag", () => {
    for (const trustLocalProxy of [false, true]) {
      assert.equal(
        resolveCollectorPeerFromRequest(req(`::ffff:${TAILNET_PEER}`), { trustLocalProxy }),
        TAILNET_PEER
      );
    }
  });

  it("2. flag OFF ignora o header dedicado mesmo em loopback", () => {
    const peer = resolveCollectorPeerFromRequest(
      req("127.0.0.1", { [COLLECTOR_PEER_HEADER]: TAILNET_PEER }),
      { trustLocalProxy: false }
    );
    // Sem a flag, o peer é o próprio loopback — que o WhoIs jamais autoriza.
    assert.equal(peer, "127.0.0.1");
  });

  it("3. flag ON + loopback + header com um IP válido resolve o peer", () => {
    for (const socket of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
      assert.equal(
        resolveCollectorPeerFromRequest(
          req(socket, { [COLLECTOR_PEER_HEADER]: ` ${TAILNET_PEER} ` }),
          { trustLocalProxy: true }
        ),
        TAILNET_PEER,
        socket
      );
    }
    // IPv6 do tailnet também.
    assert.equal(
      resolveCollectorPeerFromRequest(
        req("127.0.0.1", { [COLLECTOR_PEER_HEADER]: "FD7A:115C:A1E0::1" }),
        { trustLocalProxy: true }
      ),
      "fd7a:115c:a1e0::1"
    );
  });

  it("4. flag ON + socket externo: header é ignorado, peer = socket", () => {
    const peer = resolveCollectorPeerFromRequest(
      req(TAILNET_PEER, { [COLLECTOR_PEER_HEADER]: "100.64.9.9" }),
      { trustLocalProxy: true }
    );
    assert.equal(peer, TAILNET_PEER);
  });

  it("5/6. header múltiplo, malformado ou loopback → fail closed (null)", () => {
    const cases: Array<string | string[]> = [
      `${TAILNET_PEER}, 100.64.9.9`,
      [TAILNET_PEER, "100.64.9.9"],
      "",
      "   ",
      "not-an-ip",
      "100.64.1.5 extra",
      "127.0.0.1",
      "::1",
    ];
    for (const value of cases) {
      assert.equal(
        resolveCollectorPeerFromRequest(
          req("127.0.0.1", { [COLLECTOR_PEER_HEADER]: value }),
          { trustLocalProxy: true }
        ),
        null,
        JSON.stringify(value)
      );
    }
    // Header ausente em conexão loopback também nega — proxy legítimo sempre carimba.
    assert.equal(
      resolveCollectorPeerFromRequest(req("127.0.0.1"), { trustLocalProxy: true }),
      null
    );
  });

  it("7/8/9. XFF, X-Real-IP e CF-Connecting-IP nunca influenciam", () => {
    const forged = {
      "x-forwarded-for": "100.64.9.9",
      "x-real-ip": "100.64.9.9",
      "cf-connecting-ip": "100.64.9.9",
    };
    // Loopback + flag ON + só headers genéricos → NEGADO (não viram peer).
    assert.equal(
      resolveCollectorPeerFromRequest(req("127.0.0.1", forged), { trustLocalProxy: true }),
      null
    );
    // Socket externo: peer continua sendo o socket.
    assert.equal(
      resolveCollectorPeerFromRequest(req(TAILNET_PEER, forged), { trustLocalProxy: true }),
      TAILNET_PEER
    );
    assert.equal(
      resolveCollectorPeerFromRequest(req(TAILNET_PEER, forged), { trustLocalProxy: false }),
      TAILNET_PEER
    );
    // Estrutural: o módulo nem menciona os headers genéricos.
    const src = codeOnly(read("src/lib/inventory/collector/collectorProxyPeer.ts"));
    for (const h of ["x-forwarded-for", "x-real-ip", "cf-connecting-ip", "forwarded"]) {
      assert.equal(src.toLowerCase().includes(`"${h}"`), false, h);
    }
  });

  it("isTrustedLocalProxyAddress: só loopback, nada de faixa privada ampla", () => {
    assert.equal(isTrustedLocalProxyAddress("127.0.0.1"), true);
    assert.equal(isTrustedLocalProxyAddress("::1"), true);
    assert.equal(isTrustedLocalProxyAddress("::ffff:127.0.0.1"), true);
    assert.equal(isTrustedLocalProxyAddress("10.0.0.1"), false);
    assert.equal(isTrustedLocalProxyAddress("192.168.0.10"), false);
    assert.equal(isTrustedLocalProxyAddress(TAILNET_PEER), false);
    assert.equal(isTrustedLocalProxyAddress(null), false);
  });
});

// ---------------------------------------------------------------------------
// Middleware fim-a-fim (10–18)
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

function registryPrisma(devices: Array<Record<string, unknown>>) {
  return {
    inventoryCollectorDevice: {
      findUnique: async ({
        where,
      }: {
        where: { id?: string; tailscaleStableNodeId?: string };
      }) =>
        devices.find(
          (d) =>
            (where.id && d.id === where.id) ||
            (where.tailscaleStableNodeId &&
              d.tailscaleStableNodeId === where.tailscaleStableNodeId)
        ) ?? null,
      update: async () => devices[0],
    },
  };
}

const DEVICES = [
  { id: "dev-1", name: "Coletor 01", tailscaleStableNodeId: "nDEV1", active: true },
  { id: "dev-off", name: "Desativado", tailscaleStableNodeId: "nOFF", active: false },
];

function resolverFor(map: Record<string, { stableNodeId: string } | null>) {
  return {
    resolve: async (peer: string) =>
      (Object.prototype.hasOwnProperty.call(map, peer) ? map[peer] : null) as never,
  };
}

async function runAuth(options: {
  socket: string | null;
  headers?: Record<string, string | string[]>;
  trustLocalProxy?: boolean;
  whois?: Record<string, { stableNodeId: string } | null>;
  devices?: Array<Record<string, unknown>>;
}) {
  const middleware = requireInventoryCollectorDevice({
    prisma: registryPrisma(options.devices ?? DEVICES) as never,
    identityResolver: resolverFor(
      options.whois ?? {
        [TAILNET_PEER]: { stableNodeId: "nDEV1" },
        "100.64.3.3": { stableNodeId: "nOFF" },
      }
    ) as never,
    trustLocalProxy: options.trustLocalProxy,
  });
  const res = fakeRes();
  let nextCalled = false;
  await middleware(
    {
      socket: { remoteAddress: options.socket },
      headers: options.headers ?? {},
      body: {},
      query: {},
    } as never,
    res as never,
    () => {
      nextCalled = true;
    }
  );
  return { res, nextCalled };
}

describe("3A middleware fim-a-fim", () => {
  it("15/16/17/18. proxy local + device ativo → contexto DEVICE correto, sem login humano", async () => {
    const { res, nextCalled } = await runAuth({
      socket: "127.0.0.1",
      headers: { [COLLECTOR_PEER_HEADER]: TAILNET_PEER },
      trustLocalProxy: true,
    });
    assert.equal(nextCalled, true);
    assert.deepEqual(getCollectorDeviceContext(res as never), {
      actorType: "DEVICE",
      deviceId: "dev-1",
      userId: null,
    });
  });

  it("10. header dedicado não autoriza sem WhoIs — IP fora do tailnet nega", async () => {
    const { res, nextCalled } = await runAuth({
      socket: "127.0.0.1",
      headers: { [COLLECTOR_PEER_HEADER]: "192.0.2.55" },
      trustLocalProxy: true,
      whois: {}, // WhoIs não conhece ninguém
    });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
    assert.equal(res.locals[COLLECTOR_DEVICE_CONTEXT_KEY], undefined);
  });

  it("11/12. WhoIs falhando ou sem StableID → 403", async () => {
    for (const whois of [
      {},
      { [TAILNET_PEER]: null },
    ] as Array<Record<string, { stableNodeId: string } | null>>) {
      const { res, nextCalled } = await runAuth({
        socket: "127.0.0.1",
        headers: { [COLLECTOR_PEER_HEADER]: TAILNET_PEER },
        trustLocalProxy: true,
        whois,
      });
      assert.equal(nextCalled, false);
      assert.equal(res.statusCode, 403);
    }
  });

  it("13/14. device não registrado ou inativo → 403 mesmo via proxy", async () => {
    const notRegistered = await runAuth({
      socket: "127.0.0.1",
      headers: { [COLLECTOR_PEER_HEADER]: TAILNET_PEER },
      trustLocalProxy: true,
      devices: [],
    });
    assert.equal(notRegistered.res.statusCode, 403);

    const inactive = await runAuth({
      socket: "127.0.0.1",
      headers: { [COLLECTOR_PEER_HEADER]: "100.64.3.3" },
      trustLocalProxy: true,
    });
    assert.equal(inactive.res.statusCode, 403);
  });

  it("2C intacto: flag desligada = comportamento original (default dos deps)", async () => {
    // Direto do tailnet funciona…
    const direct = await runAuth({ socket: `::ffff:${TAILNET_PEER}` });
    assert.equal(direct.nextCalled, true);
    // …e loopback com header dedicado NÃO (flag off por default).
    const proxied = await runAuth({
      socket: "127.0.0.1",
      headers: { [COLLECTOR_PEER_HEADER]: TAILNET_PEER },
    });
    assert.equal(proxied.nextCalled, false);
    assert.equal(proxied.res.statusCode, 403);
  });

  it("spoof externo: header dedicado vindo de socket não-loopback não escolhe identidade", async () => {
    // Atacante no tailnet com device NÃO cadastrado tenta apontar para o peer
    // de um device válido via header: o peer continua sendo o socket dele.
    const { res, nextCalled } = await runAuth({
      socket: "100.64.9.9",
      headers: {
        [COLLECTOR_PEER_HEADER]: TAILNET_PEER,
        "x-forwarded-for": TAILNET_PEER,
        "x-real-ip": TAILNET_PEER,
        "cf-connecting-ip": TAILNET_PEER,
      },
      trustLocalProxy: true,
    });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
  });
});

// ---------------------------------------------------------------------------
// Estrutural / regressão (19–21)
// ---------------------------------------------------------------------------

describe("3A estrutural", () => {
  it("sem trust proxy global e sem env dentro do middleware", () => {
    const server = read("server.ts");
    assert.doesNotMatch(server, /set\(["']trust proxy["']/);
    const auth = codeOnly(read("src/lib/inventory/collector/collectorDeviceAuth.server.ts"));
    assert.doesNotMatch(auth, /process\.env/);
    // A flag vive no registro de rotas, com nome explícito e default off.
    const routes = read("src/lib/inventory/collector/collectorRoutes.server.ts");
    assert.match(routes, /INVENTORY_COLLECTOR_TRUST_LOCAL_PROXY/);
    assert.match(routes, /=== "1"/);
  });

  it("19. rotas administrativas continuam humanas; 21. QR/UI da Fase 3 preservados", () => {
    const human = read("src/lib/inventoryRoutes.ts");
    const idx = human.indexOf('"/api/inventory/collector-devices"');
    assert.ok(idx > 0);
    assert.match(human.slice(idx, idx + 300), /countApprove/);

    const scanner = read("src/components/inventory/collector/CollectorQrScanner.tsx");
    assert.match(scanner, /isSecureContext/);
    assert.match(scanner, /Conexão sem HTTPS/);
    assert.match(scanner, /collector-manual-qr/);
  });

  it("20. motor 2A–2D intocado nesta fase", () => {
    const app = read("src/lib/inventory/inventoryCountApplicationService.server.ts");
    assert.doesNotMatch(app, /trustLocalProxy|COLLECTOR_PEER_HEADER/);
    const contract = read("src/lib/inventory/collector/collectorQrContract.ts");
    assert.doesNotMatch(contract, /trustLocalProxy|proxy/i);
  });

  it("documentação operacional existe com template Nginx e rollback", () => {
    const doc = read("docs/stock-collector-secure-ingress.md");
    assert.match(doc, /X-IndusCost-Tailscale-Peer \$remote_addr/);
    assert.match(doc, /INVENTORY_COLLECTOR_TRUST_LOCAL_PROXY/);
    assert.match(doc, /tailscale cert/);
    assert.match(doc, /Rollback/);
    assert.match(doc, /listen 100\./);
    assert.doesNotMatch(doc, /proxy_add_x_forwarded_for para identidade DEVICE/);
  });
});
