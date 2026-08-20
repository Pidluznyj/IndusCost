/**
 * FASE 2C — resolvedor de identidade Tailscale (server-only).
 *
 * Fala com o LocalAPI do tailscaled do HOST via unix socket — nada de shell,
 * nada de parsing de texto de terminal, nada de segredo hardcoded. O transporte
 * é injetável: testes usam transporte mockado; o gate real usa o socket.
 *
 * FAIL CLOSED em tudo: LocalAPI indisponível, timeout, HTTP != 200, JSON
 * inválido, node ausente ou sem StableID → identidade null → acesso negado.
 */
import http from "node:http";
import {
  parseTailscaleWhoIsResponse,
  type TailscalePeerIdentity,
} from "./tailscaleIdentity.js";

/** Socket padrão do tailscaled em Linux (o servidor roda Linux). */
export const TAILSCALE_LOCALAPI_SOCKET_DEFAULT = "/var/run/tailscale/tailscaled.sock";

/** Timeout curto: autorização não pode ficar pendurada atrás do LocalAPI. */
export const TAILSCALE_WHOIS_TIMEOUT_MS_DEFAULT = 1500;

/** Transporte injetável: recebe o endereço do peer, devolve o JSON cru do WhoIs. */
export type TailscaleWhoIsTransport = {
  whois(peerAddress: string): Promise<unknown>;
};

export type TailscalePeerIdentityResolver = {
  resolve(peerAddress: string): Promise<TailscalePeerIdentity | null>;
};

/**
 * Transporte real: GET /localapi/v0/whois?addr=<ip> no unix socket do
 * tailscaled. O LocalAPI aceita o IP puro (netip.ParseAddr) nas versões
 * correntes; o Host header é o exigido pelo protocolo do LocalAPI.
 */
export function createTailscaleLocalApiTransport(options?: {
  socketPath?: string;
  timeoutMs?: number;
}): TailscaleWhoIsTransport {
  const socketPath = options?.socketPath?.trim() || TAILSCALE_LOCALAPI_SOCKET_DEFAULT;
  const timeoutMs = options?.timeoutMs ?? TAILSCALE_WHOIS_TIMEOUT_MS_DEFAULT;

  return {
    whois(peerAddress: string): Promise<unknown> {
      return new Promise((resolve, reject) => {
        const request = http.request(
          {
            socketPath,
            path: `/localapi/v0/whois?addr=${encodeURIComponent(peerAddress)}`,
            method: "GET",
            headers: { Host: "local-tailscaled.sock" },
            timeout: timeoutMs,
          },
          (response) => {
            const chunks: Buffer[] = [];
            response.on("data", (chunk: Buffer) => chunks.push(chunk));
            response.on("end", () => {
              if (response.statusCode !== 200) {
                reject(
                  new Error(`Tailscale WhoIs HTTP ${response.statusCode ?? "sem status"}`)
                );
                return;
              }
              try {
                resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
              } catch {
                reject(new Error("Tailscale WhoIs devolveu JSON inválido."));
              }
            });
          }
        );
        request.on("timeout", () => {
          request.destroy(new Error("Tailscale WhoIs timeout."));
        });
        request.on("error", (error) => reject(error));
        request.end();
      });
    },
  };
}

/**
 * Resolver canônico. Toda exceção do transporte vira identidade null — o
 * chamador (middleware) transforma null em acesso negado. Nunca lança para
 * cima: indisponibilidade do Tailscale não pode virar 500 com stack trace,
 * e jamais vira bypass.
 */
export function createTailscalePeerIdentityResolver(
  transport: TailscaleWhoIsTransport
): TailscalePeerIdentityResolver {
  return {
    async resolve(peerAddress: string): Promise<TailscalePeerIdentity | null> {
      if (!peerAddress?.trim()) return null;
      try {
        const payload = await transport.whois(peerAddress.trim());
        return parseTailscaleWhoIsResponse(payload);
      } catch {
        return null;
      }
    },
  };
}
