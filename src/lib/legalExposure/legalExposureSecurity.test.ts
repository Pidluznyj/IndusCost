import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { authorizeResourceAccess } from "@/src/lib/security/permissionGuards.js";
import type { AuthPermissionInput } from "@/src/lib/security/permissionSnapshot.js";
import { canAccessModule } from "@/src/lib/modulePermissions.js";
import { publicSourceConfiguration } from "./legalExposureFeatureFlags.js";
import { LEGAL_EXPOSURE_RESOURCES } from "./legalExposurePermissions.js";
import { assertReadOnlyLegalPath } from "./legalExposureHttp.js";
import { clearDomicilioTokenCacheForTests } from "./sources/domicilio/domicilioAuth.server.js";
import { runDomicilioSync } from "./sources/domicilio/domicilioSyncRunner.server.js";
import { runDatajudSync } from "./sources/datajud/datajudSyncRunner.server.js";
import { searchDjen } from "./sources/djen/djenClient.server.js";
import { listDomicilioCommunications } from "./sources/domicilio/domicilioMonitoringClient.server.js";

function auth(permissions: string[]): AuthPermissionInput {
  return {
    id: "user-1",
    role: "VIEWER",
    permissions,
    effectivePermissions: permissions,
    isActive: true,
  };
}

function checker(permissions: string[]) {
  const set = new Set(permissions);
  return {
    hasPermission: (key: string) => set.has(key),
    hasAnyPermission: (keys: string[]) => keys.some((key) => set.has(key)),
  };
}

describe("exposure permissions", () => {
  it("legal.exposure.view abre o módulo e a API", () => {
    assert.equal(canAccessModule("exposure", checker(["legal.exposure.view"])), true);
    assert.equal(
      authorizeResourceAccess(auth(["legal.exposure.view"]), LEGAL_EXPOSURE_RESOURCES.module, "view").ok,
      true
    );
  });

  it("settings, finance e employees sozinhos não abrem Exposure", () => {
    for (const permission of ["settings.view", "finance.view", "employees.view"]) {
      assert.equal(canAccessModule("exposure", checker([permission])), false, permission);
      const result = authorizeResourceAccess(auth([permission]), LEGAL_EXPOSURE_RESOURCES.module, "view");
      assert.equal(result.ok, false, permission);
      if (!result.ok) assert.equal(result.status, 403);
    }
  });

  it("sem permissão a API responde 403", () => {
    const result = authorizeResourceAccess(auth([]), LEGAL_EXPOSURE_RESOURCES.module, "view");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 403);
  });
});

describe("exposure science and secrets", () => {
  it("cliente do Domicílio não declara fluxo de ciência", () => {
    const dir = join(process.cwd(), "src/lib/legalExposure/sources/domicilio");
    const forbidden = [
      "openCommunication",
      "acknowledgeOfficialCommunication",
      "markAsRead",
      "inteiroTeor",
      "darCiencia",
    ];
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".ts")) continue;
      const text = readFileSync(join(dir, file), "utf8");
      for (const token of forbidden) {
        assert.equal(text.includes(token), false, `${file} contém ${token}`);
      }
      assert.equal(/method:\s*"PUT"/.test(text), false, file);
    }
    assert.throws(() => assertReadOnlyLegalPath("/api/v1/comunicacoes/ciencia"), /SCIENCE_FORBIDDEN/);
  });

  it("sync desligado não chama a rede", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return new Response("{}", { status: 200 });
    };
    const domicilio = await runDomicilioSync({ env: {}, fetchImpl });
    const datajud = await runDatajudSync({
      env: {
        LEGAL_EXPOSURE_ENABLED: "1",
        DATAJUD_ENABLED: "1",
        DATAJUD_CNPJ_DISCOVERY_ENABLED: "1",
        DATAJUD_BASE_URL: "https://fixture.invalid",
        DATAJUD_API_KEY: "super-secret-value",
      },
      fetchImpl,
      mode: "cnpj-discovery",
    });
    assert.equal(domicilio.externalCall, false);
    assert.equal(datajud.externalCall, false);
    assert.equal(datajud.errorCode, "DATAJUD_CNPJ_DISCOVERY_PENDING_PROBE");
    assert.equal(calls, 0);
    assert.equal(JSON.stringify(datajud).includes("super-secret-value"), false);
  });

  it("429 não entra em loop e não vaza segredo", async () => {
    clearDomicilioTokenCacheForTests();
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({ access_token: "tok-secreto", expires_in: 60 }), { status: 200 });
      }
      return new Response("{}", { status: 429, headers: { "retry-after": "12" } });
    };
    const env = {
      PDPJ_DOMICILIO_BASE_URL: "https://fixture.invalid",
      PDPJ_DOMICILIO_TOKEN_URL: "https://fixture.invalid/token",
      PDPJ_DOMICILIO_CLIENT_ID: "client",
      PDPJ_DOMICILIO_CLIENT_SECRET: "super-secret-value",
      PDPJ_DOMICILIO_ON_BEHALF_OF_CPF: "12345678909",
      PDPJ_DOMICILIO_COMMUNICATIONS_PATH: "/api/v1/comunicacoes",
    };
    const batch = await listDomicilioCommunications(
      { env, fetchImpl },
      { dataInicio: "2026-09-27T00:00:00.000Z", dataFim: "2026-09-29T00:00:00.000Z" }
    );
    assert.equal(batch.outcome, "RATE_LIMITED");
    assert.equal(batch.retryAfterSeconds, 12);
    assert.equal(calls, 2);
    const serialized = JSON.stringify(batch);
    assert.equal(serialized.includes("super-secret-value"), false);
    assert.equal(serialized.includes("tok-secreto"), false);
    assert.equal(serialized.includes("12345678909"), false);
  });

  it("configuração pública não devolve segredo", () => {
    const rows = publicSourceConfiguration({
      LEGAL_EXPOSURE_ENABLED: "0",
      PDPJ_DOMICILIO_CLIENT_SECRET: "super-secret-value",
      DATAJUD_API_KEY: "super-secret-value",
    });
    const serialized = JSON.stringify(rows);
    assert.equal(serialized.includes("super-secret-value"), false);
    assert.equal(rows.every((row) => typeof row.configured === "boolean"), true);
  });

  it("DJEN 429 respeita uma única tentativa", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return new Response("{}", { status: 429, headers: { "retry-after": "5" } });
    };
    const batch = await searchDjen({
      env: { DJEN_BASE_URL: "https://fixture.invalid" },
      fetchImpl,
      query: { nomeParte: "Industria Exemplo LTDA" },
    });
    assert.equal(calls, 1);
    assert.equal(batch.outcome, "RATE_LIMITED");
  });
});
