/**
 * Testes da resolução do atributo Secure do cookie de sessão.
 * Em HTTP de LAN o cookie NÃO pode ser Secure (senão o navegador não o envia).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveCookieSecure } from "./appSessionCookie.js";

test("HTTP simples (sem proxy/env) => secure false", () => {
  assert.equal(resolveCookieSecure({}), false);
  assert.equal(resolveCookieSecure({ requestSecure: false }), false);
  assert.equal(resolveCookieSecure({ forwardedProto: "http" }), false);
});

test("APP_COOKIE_SECURE força o valor", () => {
  assert.equal(resolveCookieSecure({ forcedSecure: "1" }), true);
  assert.equal(resolveCookieSecure({ forcedSecure: "true" }), true);
  assert.equal(resolveCookieSecure({ forcedSecure: "0", requestSecure: true }), false);
  assert.equal(resolveCookieSecure({ forcedSecure: "false", forwardedProto: "https" }), false);
});

test("HTTPS direto ou via proxy => secure true", () => {
  assert.equal(resolveCookieSecure({ requestSecure: true }), true);
  assert.equal(resolveCookieSecure({ forwardedProto: "https" }), true);
  assert.equal(resolveCookieSecure({ forwardedProto: ["https", "http"] }), true);
  assert.equal(resolveCookieSecure({ forwardedProto: "https, http" }), true);
});
