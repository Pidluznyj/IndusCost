/**
 * FASE 2C — GATE REAL da infraestrutura Tailscale local.
 *
 * Executa SOMENTE quando explicitamente habilitado:
 *
 *   INVENTORY_COLLECTOR_TAILSCALE_GATE=1 \
 *   node --import ./node_modules/tsx/dist/loader.mjs --test \
 *     src/lib/inventory/inventoryCollectorTailscaleGate.test.ts
 *
 * Opcional: TAILSCALE_LOCALAPI_SOCKET aponta o socket do tailscaled
 * (default /var/run/tailscale/tailscaled.sock).
 *
 * O gate NÃO usa banco de dados, NÃO usa DATABASE_URL, NÃO toca produção e
 * NÃO exige um segundo dispositivo: o peer consultado é o PRÓPRIO node do
 * servidor (self), obtido do LocalAPI /status. O que ele prova:
 *
 *   1. LocalAPI acessível no host;
 *   2. WhoIs de um peer conhecido devolve identidade com StableID;
 *   3. o parser real interpreta a resposta real;
 *   4. a identidade NÃO deriva do IP (StableID != IP);
 *   5. dispositivo não cadastrado seria negado (registry em memória);
 *   6. falha do resolver é fail-closed (IP fora do tailnet → null).
 *
 * A autorização com transporte mockado (35 casos) vive em
 * inventoryCollectorDevice.test.ts — separada deste gate, como planejado.
 */
import assert from "node:assert/strict";
import http from "node:http";
import { describe, it } from "node:test";
import {
  createTailscaleLocalApiTransport,
  createTailscalePeerIdentityResolver,
  TAILSCALE_LOCALAPI_SOCKET_DEFAULT,
} from "./collector/tailscaleIdentity.server.js";
import {
  getCollectorDeviceContext,
  requireInventoryCollectorDevice,
} from "./collector/collectorDeviceAuth.server.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const GATE_ENV = "INVENTORY_COLLECTOR_TAILSCALE_GATE";
const enabled = process.env[GATE_ENV] === "1";
const gate = enabled
  ? false
  : `TAILSCALE_GATE_PENDING — defina ${GATE_ENV}=1 no servidor com tailscaled para executar`;

const socketPath =
  process.env.TAILSCALE_LOCALAPI_SOCKET?.trim() || TAILSCALE_LOCALAPI_SOCKET_DEFAULT;

/** GET simples no LocalAPI — usado só pelo gate para descobrir o self. */
function localApiGet(path: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        socketPath,
        path,
        method: "GET",
        headers: { Host: "local-tailscaled.sock" },
        timeout: 3000,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (c: Buffer) => chunks.push(c));
        response.on("end", () => {
          if (response.statusCode !== 200) {
            reject(new Error(`LocalAPI ${path} → HTTP ${response.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch {
            reject(new Error(`LocalAPI ${path} devolveu JSON inválido.`));
          }
        });
      }
    );
    request.on("timeout", () => request.destroy(new Error("LocalAPI timeout")));
    request.on("error", reject);
    request.end();
  });
}

function log(label: string, payload: unknown): void {
  console.log(`[OP-10 2C TAILSCALE GATE] ${label}: ${JSON.stringify(payload)}`);
}

describe("2C gate — Tailscale LocalAPI real", { skip: gate }, () => {
  it("LocalAPI acessível e self identificado", async () => {
    const status = (await localApiGet("/localapi/v0/status")) as {
      Self?: { TailscaleIPs?: string[]; ID?: string };
      BackendState?: string;
    };
    log("status", {
      backendState: status.BackendState,
      selfIps: status.Self?.TailscaleIPs,
    });
    assert.equal(status.BackendState, "Running", "tailscaled precisa estar Running");
    assert.ok(
      Array.isArray(status.Self?.TailscaleIPs) && status.Self.TailscaleIPs.length > 0,
      "self sem TailscaleIPs"
    );
  });

  it("WhoIs do self devolve StableID e o parser real interpreta", async () => {
    const status = (await localApiGet("/localapi/v0/status")) as {
      Self?: { TailscaleIPs?: string[] };
    };
    const selfIp = status.Self?.TailscaleIPs?.find((ip) => ip.includes("."));
    assert.ok(selfIp, "self sem IPv4 no tailnet");

    const resolver = createTailscalePeerIdentityResolver(
      createTailscaleLocalApiTransport({ socketPath })
    );
    const identity = await resolver.resolve(selfIp);
    log("whois self", identity);

    assert.ok(identity, "WhoIs do self não resolveu identidade");
    assert.ok(identity.stableNodeId.length >= 4, "StableID ausente/curto demais");
    // Identidade NÃO deriva do IP.
    assert.notEqual(identity.stableNodeId, selfIp);
    assert.doesNotMatch(identity.stableNodeId, /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/);
  });

  it("dispositivo NÃO cadastrado é negado mesmo com identidade Tailscale válida", async () => {
    const status = (await localApiGet("/localapi/v0/status")) as {
      Self?: { TailscaleIPs?: string[] };
    };
    const selfIp = status.Self?.TailscaleIPs?.find((ip) => ip.includes("."));
    assert.ok(selfIp);

    // Registry em memória VAZIO: identidade real, cadastro nenhum → 403.
    const emptyRegistry = {
      inventoryCollectorDevice: {
        findUnique: async () => null,
        update: async () => {
          throw new Error("não deve atualizar");
        },
      },
    };
    const middleware = requireInventoryCollectorDevice({
      prisma: emptyRegistry as never,
      identityResolver: createTailscalePeerIdentityResolver(
        createTailscaleLocalApiTransport({ socketPath })
      ),
    });

    let nextCalled = false;
    let statusCode: number | null = null;
    let body: unknown = null;
    await middleware(
      { socket: { remoteAddress: selfIp }, headers: {} } as never,
      {
        locals: {},
        status(code: number) {
          statusCode = code;
          return this;
        },
        json(payload: unknown) {
          body = payload;
          return this;
        },
      } as never,
      () => {
        nextCalled = true;
      }
    );
    log("não cadastrado", { nextCalled, statusCode, body });
    assert.equal(nextCalled, false);
    assert.equal(statusCode, 403);
  });

  /** Registry em memória: o Registry em PG real já foi provado nos gates DB-D1..D6. */
  function inMemoryRegistry(
    devices: Array<{ id: string; name: string; tailscaleStableNodeId: string; active: boolean }>
  ) {
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
        update: async ({ where }: { where: { id: string } }) =>
          devices.find((d) => d.id === where.id) ?? devices[0],
      },
    };
  }

  async function selfIpv4(): Promise<string> {
    const status = (await localApiGet("/localapi/v0/status")) as {
      Self?: { TailscaleIPs?: string[] };
    };
    const ip = status.Self?.TailscaleIPs?.find((x) => x.includes("."));
    assert.ok(ip, "self sem IPv4 no tailnet");
    return ip;
  }

  async function runRealAuth(options: {
    registry: ReturnType<typeof inMemoryRegistry>;
    socket: string | null;
    headers?: Record<string, string>;
  }) {
    const middleware = requireInventoryCollectorDevice({
      prisma: options.registry as never,
      identityResolver: createTailscalePeerIdentityResolver(
        createTailscaleLocalApiTransport({ socketPath })
      ),
    });
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
    let nextCalled = false;
    await middleware(
      { socket: { remoteAddress: options.socket }, headers: options.headers ?? {} } as never,
      res as never,
      () => {
        nextCalled = true;
      }
    );
    return { res, nextCalled };
  }

  it("PROVAS 4–7 — self com StableID REAL registrado+ativo → contexto DEVICE canônico", async () => {
    const selfIp = await selfIpv4();
    const resolver = createTailscalePeerIdentityResolver(
      createTailscaleLocalApiTransport({ socketPath })
    );
    const identity = await resolver.resolve(selfIp);
    assert.ok(identity, "WhoIs do self não resolveu");

    const registry = inMemoryRegistry([
      {
        id: "dev-gate-self",
        name: "Gate 2C",
        tailscaleStableNodeId: identity.stableNodeId,
        active: true,
      },
    ]);
    const { res, nextCalled } = await runRealAuth({ registry, socket: selfIp });
    log("provas 4-7", {
      nextCalled,
      context: getCollectorDeviceContext(res as never),
    });
    assert.equal(nextCalled, true, "device ativo com StableID real precisa ser reconhecido");
    assert.deepEqual(getCollectorDeviceContext(res as never), {
      actorType: "DEVICE",
      deviceId: "dev-gate-self",
      userId: null,
    });
  });

  it("PROVA 9 — mesmo StableID real, porém inativo → DENY", async () => {
    const selfIp = await selfIpv4();
    const resolver = createTailscalePeerIdentityResolver(
      createTailscaleLocalApiTransport({ socketPath })
    );
    const identity = await resolver.resolve(selfIp);
    assert.ok(identity);

    const registry = inMemoryRegistry([
      {
        id: "dev-gate-self",
        name: "Gate 2C",
        tailscaleStableNodeId: identity.stableNodeId,
        active: false,
      },
    ]);
    const { res, nextCalled } = await runRealAuth({ registry, socket: selfIp });
    log("prova 9", { nextCalled, statusCode: res.statusCode });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
  });

  it("PROVA 3 — StableID nunca vem de header do cliente (Tailscale real)", async () => {
    const selfIp = await selfIpv4();
    const resolver = createTailscalePeerIdentityResolver(
      createTailscaleLocalApiTransport({ socketPath })
    );
    const identity = await resolver.resolve(selfIp);
    assert.ok(identity);

    const forgedHeaders = {
      "x-induscost-tailscale-peer": "100.99.99.99",
      "x-forwarded-for": "100.99.99.99",
      "x-real-ip": "100.99.99.99",
    };

    // Registry contém APENAS um StableID falso "apontado" pelos headers: se
    // headers valessem, autorizaria. Identidade sai do socket → self não está
    // no registry → DENY.
    const fakeOnly = inMemoryRegistry([
      { id: "dev-fake", name: "Fake", tailscaleStableNodeId: "nFAKE-HEADER", active: true },
    ]);
    const denied = await runRealAuth({
      registry: fakeOnly,
      socket: selfIp,
      headers: forgedHeaders,
    });
    log("prova 3 — headers forjados", {
      nextCalled: denied.nextCalled,
      statusCode: denied.res.statusCode,
    });
    assert.equal(denied.nextCalled, false);
    assert.equal(denied.res.statusCode, 403);

    // E com o self registrado, os mesmos headers forjados não mudam o contexto.
    const selfRegistry = inMemoryRegistry([
      {
        id: "dev-gate-self",
        name: "Gate 2C",
        tailscaleStableNodeId: identity.stableNodeId,
        active: true,
      },
    ]);
    const authorized = await runRealAuth({
      registry: selfRegistry,
      socket: selfIp,
      headers: forgedHeaders,
    });
    assert.equal(authorized.nextCalled, true);
    assert.deepEqual(getCollectorDeviceContext(authorized.res as never), {
      actorType: "DEVICE",
      deviceId: "dev-gate-self",
      userId: null,
    });
  });

  it("PROVAS 11/12 — auth DEVICE sem identidade humana e sem QR", () => {
    const auth = readFileSync(
      join(process.cwd(), "src/lib/inventory/collector/collectorDeviceAuth.server.ts"),
      "utf8"
    );
    assert.doesNotMatch(auth, /getCurrentAppUser|requireAppAuth|AppUser/);
    assert.doesNotMatch(auth, /parseCollectorQrText|QrContract|qrText/);
  });

  it("IP fora do tailnet é fail-closed (resolver → null)", async () => {
    const resolver = createTailscalePeerIdentityResolver(
      createTailscaleLocalApiTransport({ socketPath })
    );
    // TEST-NET-1: nunca é peer do tailnet.
    const identity = await resolver.resolve("192.0.2.55");
    log("ip fora do tailnet", { identity });
    assert.equal(identity, null);
  });
});
