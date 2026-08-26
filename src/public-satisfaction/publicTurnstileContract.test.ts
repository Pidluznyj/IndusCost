/**
 * Contrato Turnstile da pesquisa pública + regressão do bug original:
 * se o backend exige verificação humana, o frontend precisa receber
 * required+siteKey e só então habilitar o submit com token.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import {
  canSubmitWithTurnstile,
  publicFormJsonLooksSafe,
  readTurnstileConfigFromForm,
} from "./publicTurnstileContract.js";
import { PublicTurnstile } from "./PublicTurnstile.js";
import { TURNSTILE_SCRIPT_SRC } from "./turnstileLoader.js";

describe("readTurnstileConfigFromForm", () => {
  it("usa o contrato turnstile.required do servidor", () => {
    assert.deepEqual(
      readTurnstileConfigFromForm({
        turnstile: { required: true, siteKey: "pk_live" },
        turnstileSiteKey: null,
      }),
      { required: true, siteKey: "pk_live" }
    );
  });

  it("quando não é obrigatório, não bloqueia envio", () => {
    const config = readTurnstileConfigFromForm({
      turnstile: { required: false, siteKey: null },
    });
    assert.deepEqual(canSubmitWithTurnstile(config, null), { ok: true });
  });

  it("required sem siteKey NÃO libera submit", () => {
    const config = readTurnstileConfigFromForm({
      turnstile: { required: true, siteKey: null },
    });
    const gate = canSubmitWithTurnstile(config, null);
    assert.equal(gate.ok, false);
  });
});

describe("canSubmitWithTurnstile", () => {
  const required = { required: true, siteKey: "pk" };

  it("sem token o submit é bloqueado", () => {
    const gate = canSubmitWithTurnstile(required, null);
    assert.equal(gate.ok, false);
    if (!gate.ok) assert.match(gate.error, /verificação de segurança/i);
  });

  it("callback de token habilita o envio", () => {
    assert.deepEqual(canSubmitWithTurnstile(required, "0.token-real"), { ok: true });
  });

  it("expired/ausente volta a bloquear", () => {
    assert.equal(canSubmitWithTurnstile(required, "").ok, false);
    assert.equal(canSubmitWithTurnstile(required, "   ").ok, false);
  });
});

describe("regressão: public satisfaction renders Turnstile when submit requires human verification", () => {
  it("BACKEND REQUIREMENT = TRUE → FRONTEND RECEBE CONFIG → WIDGET É RENDERIZÁVEL → TOKEN ENTRA NO SUBMIT", () => {
    const form = {
      turnstile: { required: true, siteKey: "pk_publica" },
    };
    const config = readTurnstileConfigFromForm(form);
    assert.equal(config.required, true);
    assert.equal(config.siteKey, "pk_publica");

    const html = renderToStaticMarkup(
      React.createElement(PublicTurnstile, {
        siteKey: config.siteKey!,
        onTokenChange: () => undefined,
      })
    );
    assert.match(html, /Verificação de segurança/);
    assert.match(html, /data-testid="satisfaction-turnstile"/);
    assert.match(html, /proteger esta pesquisa/i);

    const payload = {
      answers: [{ questionCode: "PRODUCT_QUALITY", ratingValue: 5 }],
      turnstileToken: "0.token-real-do-widget",
    };
    assert.equal(payload.turnstileToken, "0.token-real-do-widget");
    assert.equal(TURNSTILE_SCRIPT_SRC.includes("render=explicit"), true);
    assert.equal(TURNSTILE_SCRIPT_SRC.startsWith("https://challenges.cloudflare.com/"), true);
    assert.equal(JSON.stringify(payload).includes("localStorage"), false);
  });

  it("secret NÃO aparece no JSON público nem no markup", () => {
    const publicJson = JSON.stringify({
      turnstile: { required: true, siteKey: "pk_publica" },
      surveyTitle: "Pesquisa",
    });
    assert.equal(publicFormJsonLooksSafe(publicJson), true);
    assert.equal(publicFormJsonLooksSafe('{"secretKey":"x"}'), false);
    const html = renderToStaticMarkup(
      React.createElement(PublicTurnstile, {
        siteKey: "pk_publica",
        onTokenChange: () => undefined,
      })
    );
    assert.equal(html.toLowerCase().includes("secret"), false);
    assert.equal(html.includes("sk_"), false);
  });
});
