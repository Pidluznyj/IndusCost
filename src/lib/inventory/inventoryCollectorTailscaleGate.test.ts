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
import { requireInventoryCollectorDevice } from "./collector/collectorDeviceAuth.server.js";

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
