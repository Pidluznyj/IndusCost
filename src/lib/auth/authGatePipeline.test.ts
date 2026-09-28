/**
 * Integração dos dois gates já existentes. Não cria regra nova:
 * senha primeiro, política só para SELLER depois disso.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import http from "node:http";
import express from "express";
import {
  createPasswordChangeRequiredGuard,
  resolveAuthenticatedAccessGate,
} from "./passwordChangeRequiredGuard.js";
import { createCommercialPolicyAcceptanceGuard } from "../commercialPolicy/commercialPolicyGuard.js";

const BUSINESS = [
  "/api/crm/customers",
  "/api/commissions/portfolio-outlook",
  "/api/admin/users",
  "/api/sales-orders",
  "/api/inventory/balances",
];

type State = {
  cookie: boolean;
  role: "SUPER_ADMIN" | "ADMIN" | "COMMERCIAL_MANAGER" | "VIEWER" | "SELLER";
  mustChangePassword: boolean;
  policyAccepted: boolean;
  policyPublished: boolean;
  sessionAlive: boolean;
};

function pending(state: State): boolean {
  return (
    state.sessionAlive &&
    !state.mustChangePassword &&
    state.role === "SELLER" &&
    state.policyPublished &&
    !state.policyAccepted
  );
}

async function start() {
  const state: State = {
    cookie: true,
    role: "SELLER",
    mustChangePassword: false,
    policyAccepted: true,
    policyPublished: true,
    sessionAlive: true,
  };
  const app = express();
  app.use(
    "/api",
    createPasswordChangeRequiredGuard({
      resolveMustChangePassword: async () => {
        if (!state.cookie || !state.sessionAlive) return null;
        return state.mustChangePassword;
      },
    })
  );
  app.use(
    "/api",
    createCommercialPolicyAcceptanceGuard({
      hasSessionCookie: () => state.cookie,
      resolvePending: async () => {
        if (!state.cookie || !state.sessionAlive) return null;
        if (state.mustChangePassword || state.role !== "SELLER") return false;
        return pending(state);
      },
    })
  );
  for (const path of BUSINESS) {
    app.get(path, (_req, res) => res.json({ ok: true }));
  }
  app.get("/api/commercial-policy/pending", (_req, res) => res.json({ ok: true }));
  app.post("/api/auth/logout", (_req, res) => res.json({ ok: true }));
  app.post("/api/auth/complete-password-change", (_req, res) => res.json({ ok: true }));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    state,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
    async hit(method: string, path: string) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        method,
        headers: state.cookie ? { cookie: "induscost_session=abc" } : {},
      });
      const text = await response.text();
      return { status: response.status, text };
    },
  };
}

describe("pipeline senha depois política", () => {
  it("matriz A–F e bypass de API", async () => {
    const ctx = await start();
    try {
      ctx.state.role = "SELLER";
      ctx.state.mustChangePassword = false;
      ctx.state.policyAccepted = true;
      assert.equal((await ctx.hit("GET", "/api/sales-orders")).status, 200);

      ctx.state.mustChangePassword = true;
      ctx.state.policyAccepted = false;
      const senhaAntes = await ctx.hit("GET", "/api/commercial-policy/pending");
      assert.equal(senhaAntes.status, 403);
      assert.match(senhaAntes.text, /PASSWORD_CHANGE_REQUIRED/);
      assert.doesNotMatch(senhaAntes.text, /POLICY_ACCEPTANCE_REQUIRED/);
      for (const path of BUSINESS) {
        const blocked = await ctx.hit("GET", path);
        assert.equal(blocked.status, 403, path);
        assert.match(blocked.text, /PASSWORD_CHANGE_REQUIRED/);
      }
      assert.equal((await ctx.hit("POST", "/api/auth/logout")).status, 200);
      assert.equal((await ctx.hit("POST", "/api/auth/complete-password-change")).status, 200);

      ctx.state.mustChangePassword = false;
      ctx.state.sessionAlive = true;
      const politica = await ctx.hit("GET", "/api/sales-orders");
      assert.equal(politica.status, 403);
      assert.match(politica.text, /POLICY_ACCEPTANCE_REQUIRED/);
      for (const path of BUSINESS) {
        assert.match((await ctx.hit("GET", path)).text, /POLICY_ACCEPTANCE_REQUIRED/);
      }
      assert.equal((await ctx.hit("GET", "/api/commercial-policy/pending")).status, 200);
      assert.equal((await ctx.hit("POST", "/api/auth/logout")).status, 200);

      ctx.state.policyAccepted = true;
      assert.equal((await ctx.hit("GET", "/api/crm/customers")).status, 200);

      ctx.state.mustChangePassword = true;
      ctx.state.policyAccepted = true;
      assert.match((await ctx.hit("GET", "/api/inventory/balances")).text, /PASSWORD_CHANGE_REQUIRED/);
      ctx.state.mustChangePassword = false;
      assert.equal((await ctx.hit("GET", "/api/inventory/balances")).status, 200);

      ctx.state.mustChangePassword = false;
      ctx.state.policyAccepted = false;
      assert.match((await ctx.hit("GET", "/api/commissions/portfolio-outlook")).text, /POLICY_ACCEPTANCE_REQUIRED/);

      for (const role of ["ADMIN", "SUPER_ADMIN", "COMMERCIAL_MANAGER", "VIEWER"] as const) {
        ctx.state.role = role;
        ctx.state.mustChangePassword = false;
        ctx.state.policyAccepted = false;
        assert.equal((await ctx.hit("GET", "/api/admin/users")).status, 200, role);
        ctx.state.mustChangePassword = true;
        assert.match((await ctx.hit("GET", "/api/admin/users")).text, /PASSWORD_CHANGE_REQUIRED/);
        assert.doesNotMatch((await ctx.hit("GET", "/api/commercial-policy/pending")).text, /POLICY_ACCEPTANCE_REQUIRED/);
      }
    } finally {
      await ctx.close();
    }
  });

  it("flag marcada com sessão aberta e nova versão bloqueiam o próximo request", async () => {
    const ctx = await start();
    try {
      ctx.state.role = "SELLER";
      ctx.state.mustChangePassword = false;
      ctx.state.policyAccepted = true;
      assert.equal((await ctx.hit("GET", "/api/sales-orders")).status, 200);
      ctx.state.mustChangePassword = true;
      assert.match((await ctx.hit("GET", "/api/sales-orders")).text, /PASSWORD_CHANGE_REQUIRED/);

      ctx.state.mustChangePassword = false;
      ctx.state.policyAccepted = true;
      assert.equal((await ctx.hit("GET", "/api/sales-orders")).status, 200);
      ctx.state.policyAccepted = false;
      ctx.state.policyPublished = true;
      assert.match((await ctx.hit("GET", "/api/sales-orders")).text, /POLICY_ACCEPTANCE_REQUIRED/);

      ctx.state.sessionAlive = false;
      const expired = await ctx.hit("GET", "/api/sales-orders");
      assert.equal(expired.status, 200);
      assert.doesNotMatch(expired.text, /PASSWORD_CHANGE_REQUIRED|POLICY_ACCEPTANCE_REQUIRED/);
    } finally {
      await ctx.close();
    }
  });

  it("a ordem da UI e do servidor é senha antes da política", () => {
    assert.equal(
      resolveAuthenticatedAccessGate({
        mustChangePassword: true,
        role: "SELLER",
        hasPendingCommercialPolicy: true,
      }),
      "PASSWORD_CHANGE_REQUIRED"
    );
    assert.equal(
      resolveAuthenticatedAccessGate({
        mustChangePassword: false,
        role: "ADMIN",
        hasPendingCommercialPolicy: true,
      }),
      "AUTHENTICATED"
    );
    const requireAuth = readFileSync(new URL("../../components/RequireAuth.tsx", import.meta.url), "utf8");
    const login = readFileSync(new URL("../../components/PublicLoginRoute.tsx", import.meta.url), "utf8");
    const server = readFileSync(new URL("../../../server.ts", import.meta.url), "utf8");
    assert.ok(
      requireAuth.indexOf("mustChangePassword") < requireAuth.indexOf("commercialPolicyAcceptanceRequired")
    );
    assert.ok(login.indexOf("mustChangePassword") < login.indexOf("commercialPolicyAcceptanceRequired"));
    assert.ok(
      server.indexOf("passwordChangeRequiredGuard") < server.indexOf("commercialPolicyAcceptanceGuard")
    );
  });
});
