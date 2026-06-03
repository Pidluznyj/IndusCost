/**
 * Smoke / E2E da Gestão de Frota via HTTP (API REST).
 *
 * Requer:
 * - DATABASE_URL (cleanup e sessão bootstrap opcional)
 * - Servidor IndusCost em execução (ex.: npm run dev)
 * - Confirmação explícita: --confirm="RODAR SMOKE FROTA"
 *
 * Autenticação (uma das opções):
 * - FLEET_SMOKE_EMAIL + FLEET_SMOKE_PASSWORD → POST /api/auth/login
 * - Sem credenciais: bootstrap de sessão via Prisma para usuário ativo com
 *   role SUPER_ADMIN ou permissão fleet.manage (somente ambiente controlado)
 *
 * Variáveis opcionais:
 * - FLEET_SMOKE_BASE_URL (padrão http://127.0.0.1:3000)
 * - FLEET_SMOKE_SKIP_CLEANUP=1 — mantém dados TESTE_FROTA_* no banco
 *
 * Uso: npm run test:fleet:smoke
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import {
  APP_SESSION_COOKIE_NAME,
  APP_SESSION_TTL_MS,
  createOpaqueSessionToken,
  hashSessionToken,
} from "../src/lib/appAuth.ts";

const CONFIRM = "RODAR SMOKE FROTA";
const PREFIX = "TESTE_FROTA_";

type Json = Record<string, unknown>;

type SmokeIds = {
  runTag: string;
  vehicleId?: string;
  driverId?: string;
  reservationId?: string;
  maintenanceId?: string;
  sessionId?: string;
  sessionToken?: string;
};

function hasConfirm(): boolean {
  return process.argv.includes(`--confirm=${CONFIRM}`);
}

function log(step: string, msg: string): void {
  console.warn(`[fleet-smoke] ${step}: ${msg}`);
}

function fail(msg: string): never {
  console.error(`[fleet-smoke] FALHA: ${msg}`);
  process.exit(1);
}

function baseUrl(): string {
  const raw = (process.env.FLEET_SMOKE_BASE_URL ?? "http://127.0.0.1:3000").trim();
  return raw.replace(/\/+$/, "");
}

function uniqueTag(): string {
  return `${Date.now().toString(36).toUpperCase()}`;
}

function uniqueCpf(): string {
  const n = Date.now() % 1_000_000_000;
  return String(100_000_000_00 + n).slice(0, 11);
}

function uniquePlate(tag: string): string {
  const suffix = tag.replace(/[^A-Z0-9]/gi, "").slice(-6);
  return `${PREFIX}${suffix}`.slice(0, 12);
}

class FleetApiClient {
  private cookie = "";

  constructor(private readonly origin: string) {}

  setSessionCookie(token: string): void {
    this.cookie = `${APP_SESSION_COOKIE_NAME}=${token}`;
  }

  async request(
    method: string,
    path: string,
    body?: unknown,
    expectStatus?: number
  ): Promise<{ status: number; json: Json }> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.cookie) headers.Cookie = this.cookie;
    let payload: string | undefined;
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const res = await fetch(`${this.origin}${path}`, { method, headers, body: payload });
    let json: Json = {};
    const text = await res.text();
    if (text) {
      try {
        json = JSON.parse(text) as Json;
      } catch {
        json = { error: text.slice(0, 500) };
      }
    }
    if (expectStatus != null && res.status !== expectStatus) {
      fail(
        `${method} ${path} — esperado HTTP ${expectStatus}, recebido ${res.status}: ${String(json.error ?? text).slice(0, 300)}`
      );
    }
    return { status: res.status, json };
  }

  async expectError(method: string, path: string, body?: unknown): Promise<void> {
    const { status, json } = await this.request(method, path, body);
    if (status < 400) {
      fail(`${method} ${path} — esperava erro 4xx, recebido ${status}: ${JSON.stringify(json)}`);
    }
  }
}

async function resolveSessionToken(prisma: PrismaClient): Promise<{
  token: string;
  sessionId: string;
  via: string;
}> {
  const email = (process.env.FLEET_SMOKE_EMAIL ?? "").trim();
  const password = process.env.FLEET_SMOKE_PASSWORD ?? "";
  const origin = baseUrl();

  if (email && password) {
    const res = await fetch(`${origin}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const text = await res.text();
    let json: Json = {};
    try {
      json = JSON.parse(text) as Json;
    } catch {
      /* */
    }
    if (!res.ok) {
      fail(`Login falhou (${res.status}): ${String(json.message ?? json.error ?? text)}`);
    }
    const cookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
    const line =
      cookies.find((c) => c.startsWith(`${APP_SESSION_COOKIE_NAME}=`)) ??
      res.headers.get("set-cookie") ??
      "";
    const match = line.match(new RegExp(`${APP_SESSION_COOKIE_NAME}=([^;]+)`));
    if (!match?.[1]) fail("Login OK mas cookie de sessão não retornado.");
    return { token: match[1], sessionId: "", via: `login ${email}` };
  }

  const users = await prisma.appUser.findMany({
    where: { isActive: true },
    orderBy: { lastLoginAt: "desc" },
    take: 100,
  });
  const actor =
    users.find((u) => u.role === "SUPER_ADMIN") ??
    users.find((u) => u.permissions.includes("fleet.manage"));
  if (!actor) {
    fail(
      "Nenhum usuário ativo com fleet.manage ou SUPER_ADMIN. Defina FLEET_SMOKE_EMAIL e FLEET_SMOKE_PASSWORD ou crie um usuário de homologação."
    );
  }

  const token = createOpaqueSessionToken();
  const expiresAt = new Date(Date.now() + APP_SESSION_TTL_MS);
  const session = await prisma.appSession.create({
    data: { userId: actor.id, tokenHash: hashSessionToken(token), expiresAt },
  });
  return { token, sessionId: session.id, via: `bootstrap ${actor.email}` };
}

async function cleanupSmokeData(prisma: PrismaClient, ids: SmokeIds): Promise<void> {
  if (process.env.FLEET_SMOKE_SKIP_CLEANUP === "1") {
    log("cleanup", "FLEET_SMOKE_SKIP_CLEANUP=1 — dados mantidos no banco.");
    return;
  }

  const entityIds: string[] = [
    ids.vehicleId,
    ids.driverId,
    ids.reservationId,
    ids.maintenanceId,
  ].filter((x): x is string => Boolean(x));

  if (entityIds.length > 0) {
    await prisma.fleetAuditLog.deleteMany({ where: { entityId: { in: entityIds } } });
  }

  if (ids.vehicleId) {
    await prisma.fleetCost.deleteMany({ where: { vehicleId: ids.vehicleId } });
    await prisma.fleetMaintenance.deleteMany({ where: { vehicleId: ids.vehicleId } });
    await prisma.fleetVehicle.deleteMany({
      where: { id: ids.vehicleId, plate: { startsWith: PREFIX } },
    });
  }

  if (ids.driverId) {
    await prisma.fleetDriver.deleteMany({
      where: { id: ids.driverId, name: { startsWith: PREFIX } },
    });
  }

  if (ids.sessionId) {
    await prisma.appSession.deleteMany({ where: { id: ids.sessionId } });
  } else if (ids.sessionToken) {
    await prisma.appSession.deleteMany({
      where: { tokenHash: hashSessionToken(ids.sessionToken) },
    });
  }

  log("cleanup", `concluído (${ids.runTag})`);
}

async function assertServerReachable(origin: string): Promise<void> {
  try {
    const res = await fetch(`${origin}/api/auth/me`, { method: "GET" });
    if (res.status >= 500) fail(`Servidor respondeu HTTP ${res.status} em ${origin}`);
  } catch {
    fail(
      `Servidor não acessível em ${origin}. Inicie o backend (ex.: npm run dev) e confira FLEET_SMOKE_BASE_URL.`
    );
  }
}

async function main(): Promise<void> {
  if (!hasConfirm()) {
    console.error(`[fleet-smoke] Abortado. Informe --confirm="${CONFIRM}"`);
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.warn("[fleet-smoke] SKIP: DATABASE_URL não definida.");
    return;
  }

  const tag = uniqueTag();
  const ids: SmokeIds = { runTag: tag };
  const prisma = new PrismaClient();
  const api = new FleetApiClient(baseUrl());

  const origin = baseUrl();
  log("init", `tag=${tag} base=${origin}`);
  await assertServerReachable(origin);

  try {
    const session = await resolveSessionToken(prisma);
    api.setSessionCookie(session.token);
    ids.sessionId = session.sessionId || undefined;
    ids.sessionToken = session.token;
    log("auth", session.via);

    const me = await api.request("GET", "/api/auth/me", undefined, 200);
    if (me.json.authenticated !== true) fail("Sessão inválida após autenticação.");

    const plate = uniquePlate(tag);
    const driverName = `${PREFIX}MOTORISTA_${tag}`;
    const cpf = uniqueCpf();

    const start = new Date();
    start.setDate(start.getDate() + 2);
    start.setHours(10, 0, 0, 0);
    const end = new Date(start);
    end.setHours(end.getHours() + 4);

    // 1. Veículo
    const vRes = await api.request(
      "POST",
      "/api/fleet/vehicles",
      {
        plate,
        brand: "Teste",
        model: "Smoke API",
        origin: "OWNED",
        currentKm: 1000,
        initialKm: 1000,
        notes: `${PREFIX}script ${tag}`,
      },
      201
    );
    ids.vehicleId = String((vRes.json.vehicle as Json)?.id ?? "");
    if (!ids.vehicleId) fail("Veículo criado sem id.");
    log("1", `veículo ${plate} (${ids.vehicleId})`);

    // 2. Motorista
    const dRes = await api.request(
      "POST",
      "/api/fleet/drivers",
      {
        name: driverName,
        cpf,
        cnhCategory: "B",
        cnhExpirationDate: new Date(Date.now() + 400 * 86400000).toISOString().slice(0, 10),
        status: "AUTHORIZED",
        notes: `${PREFIX}script ${tag}`,
      },
      201
    );
    ids.driverId = String((dRes.json.driver as Json)?.id ?? "");
    if (!ids.driverId) fail("Motorista criado sem id.");
    log("2", `motorista ${driverName}`);

    // 3. Reserva válida
    const rRes = await api.request(
      "POST",
      "/api/fleet/reservations",
      {
        vehicleId: ids.vehicleId,
        driverId: ids.driverId,
        startDateTime: start.toISOString(),
        endDateTime: end.toISOString(),
        destination: `${PREFIX}destino`,
        reason: "Smoke API",
      },
      201
    );
    ids.reservationId = String((rRes.json.reservation as Json)?.id ?? "");
    if (!ids.reservationId) fail("Reserva criada sem id.");
    log("3", `reserva ${ids.reservationId}`);

    // 4. Conflito
    await api.expectError("POST", "/api/fleet/reservations", {
      vehicleId: ids.vehicleId,
      driverId: ids.driverId,
      startDateTime: start.toISOString(),
      endDateTime: end.toISOString(),
      destination: `${PREFIX}conflito`,
    });
    log("4", "reserva conflitante bloqueada");

    // 5. Aprovar
    const appr = await api.request(
      "PATCH",
      `/api/fleet/reservations/${ids.reservationId}/approve`,
      {},
      200
    );
    const apprStatus = (appr.json.reservation as Json)?.status;
    if (apprStatus !== "APPROVED") fail(`Aprovação: status=${String(apprStatus)}`);
    log("5", "reserva aprovada");

    // 6. Retirada
    const co = await api.request(
      "POST",
      `/api/fleet/reservations/${ids.reservationId}/checkout`,
      { checkoutKm: 1000, checkoutFuelLevel: "CHEIO" },
      200
    );
    const usageStatus = (co.json.usage as Json)?.status;
    if (!usageStatus) fail("Checkout sem usage.");
    log("6", `retirada status=${String(usageStatus)}`);

    // 7. Devolução
    await api.request(
      "POST",
      `/api/fleet/reservations/${ids.reservationId}/checkin`,
      { checkinKm: 1250, checkinFuelLevel: "3/4" },
      200
    );
    log("7", "devolução registrada");

    // 8. Km atualizado
    const vGet = await api.request("GET", `/api/fleet/vehicles/${ids.vehicleId}`, undefined, 200);
    const currentKm = Number((vGet.json.vehicle as Json)?.currentKm);
    if (currentKm !== 1250) fail(`Km esperado 1250, obtido ${currentKm}`);
    log("8", `km atual=${currentKm}`);

    // 9. Manutenção bloqueante
    const mRes = await api.request(
      "POST",
      "/api/fleet/maintenances",
      {
        vehicleId: ids.vehicleId,
        description: `${PREFIX}bloqueio ${tag}`,
        maintenanceType: "CORRETIVA",
        priority: "CRITICA",
        blocksVehicle: true,
      },
      201
    );
    ids.maintenanceId = String((mRes.json.maintenance as Json)?.id ?? "");
    const vBlocked = await api.request("GET", `/api/fleet/vehicles/${ids.vehicleId}`, undefined, 200);
    const blockedStatus = String((vBlocked.json.vehicle as Json)?.status ?? "");
    if (!["BLOCKED", "MAINTENANCE"].includes(blockedStatus)) {
      fail(`Veículo deveria estar bloqueado, status=${blockedStatus}`);
    }
    log("9", `manutenção bloqueante status veículo=${blockedStatus}`);

    // 10. Não reservável
    await api.expectError("POST", "/api/fleet/reservations", {
      vehicleId: ids.vehicleId,
      driverId: ids.driverId,
      startDateTime: new Date(Date.now() + 5 * 86400000).toISOString(),
      endDateTime: new Date(Date.now() + 5 * 86400000 + 7200000).toISOString(),
      destination: `${PREFIX}bloqueado`,
    });
    const avail = await api.request(
      "GET",
      `/api/fleet/availability?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`,
      undefined,
      200
    );
    const vehicles = (avail.json.vehicles as unknown[]) ?? [];
    if (vehicles.some((row) => (row as Json)?.id === ids.vehicleId)) {
      fail("Veículo bloqueado não deveria aparecer em disponibilidade.");
    }
    log("10", "veículo não reservável confirmado");

    // 11. Concluir manutenção (libera veículo)
    await api.request("POST", `/api/fleet/maintenances/${ids.maintenanceId}/start`, {}, 200);
    await api.request(
      "POST",
      `/api/fleet/maintenances/${ids.maintenanceId}/complete`,
      {
        finalValue: 0,
        generateCost: false,
        currentKm: 1250,
        servicePerformed: `${PREFIX}serviço`,
        releaseVehicle: true,
      },
      200
    );
    const vFree = await api.request("GET", `/api/fleet/vehicles/${ids.vehicleId}`, undefined, 200);
    const freeStatus = String((vFree.json.vehicle as Json)?.status ?? "");
    if (freeStatus === "BLOCKED" || freeStatus === "MAINTENANCE") {
      fail(`Veículo deveria estar liberado após manutenção, status=${freeStatus}`);
    }
    log("11", `manutenção concluída, veículo=${freeStatus}`);

    // 12. Dashboard
    const dash = await api.request("GET", "/api/fleet/dashboard", undefined, 200);
    const cards = dash.json.cards as Json | undefined;
    const totalVehicles = Number(cards?.totalVehicles ?? 0);
    if (totalVehicles < 1) fail("Dashboard sem veículos.");
    log("12", `dashboard totalVehicles=${totalVehicles}`);

    console.warn(`[fleet-smoke] OK — ${tag} placa ${plate}`);
  } finally {
    await cleanupSmokeData(prisma, ids).catch((e) => {
      console.error("[fleet-smoke] cleanup falhou:", e);
      process.exitCode = 1;
    });
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("[fleet-smoke] FALHA", e);
  process.exit(1);
});
