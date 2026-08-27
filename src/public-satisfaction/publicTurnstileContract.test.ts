/**
 * Contrato + loader + widget do Turnstile na pesquisa pública.
 *
 * Cobre o bug original (api.js nunca carregava) e a regressão dos links
 * `/r#TOKEN` — a correção não pode alterar geração/hash/path do convite.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PublicTurnstile } from "./PublicTurnstile.js";
import {
  TURNSTILE_COPY,
  canSubmitWithTurnstile,
  isSurveySubmitDisabled,
  publicFormJsonLooksSafe,
  shouldResetTurnstileAfterSubmit,
  turnstileIsRequired,
} from "./publicTurnstileContract.js";
import {
  TURNSTILE_SCRIPT_SRC,
  createTurnstileLoader,
  createTurnstileWidgetSlot,
  type TurnstileApi,
  type TurnstileLoaderRuntime,
  type TurnstileRenderOptions,
  type TurnstileScriptNode,
} from "./turnstileLoader.js";
import {
  SATISFACTION_PUBLIC_FORM_PATH,
  SATISFACTION_TOKEN_BYTES,
  buildSatisfactionPublicUrl,
  generateSatisfactionToken,
  hashSatisfactionToken,
  parseTokenFromFragment,
} from "../lib/satisfaction/satisfactionToken.js";
import { parseSubmitInput } from "../lib/satisfaction/satisfactionContracts.js";
import {
  resolveTurnstileConfig,
  toPublicTurnstileSiteKey,
  verifyTurnstileToken,
} from "../lib/satisfaction/satisfactionTurnstile.server.js";
import { isSatisfactionPublicPathAllowed } from "../lib/satisfaction/satisfactionPublicSurface.js";

const ROOT = process.cwd();
const SURVEY_APP_SRC = readFileSync(join(ROOT, "src/public-satisfaction/SurveyApp.tsx"), "utf8");
const PUBLIC_TURNSTILE_SRC = readFileSync(
  join(ROOT, "src/public-satisfaction/PublicTurnstile.tsx"),
  "utf8"
);
const LOADER_SRC = readFileSync(join(ROOT, "src/public-satisfaction/turnstileLoader.ts"), "utf8");
const HTML_SRC = readFileSync(join(ROOT, "satisfacao.html"), "utf8");
const MAIN_SRC = readFileSync(join(ROOT, "src/public-satisfaction/main.tsx"), "utf8");
const TOKEN_SRC = readFileSync(join(ROOT, "src/lib/satisfaction/satisfactionToken.ts"), "utf8");
const ROUTES_SRC = readFileSync(
  join(ROOT, "src/lib/satisfaction/satisfactionPublicRoutes.ts"),
  "utf8"
);
const HOMOLOG_NGINX = readFileSync(
  join(ROOT, "infra/satisfaction-homolog/nginx/induscost-satisfaction-homolog.conf"),
  "utf8"
);

function fakeApi(live: Set<string>): TurnstileApi {
  let n = 0;
  return {
    render(_host, _options) {
      const id = `w${++n}`;
      live.add(id);
      return id;
    },
    reset() {
      /* noop */
    },
    remove(id) {
      live.delete(id);
    },
  };
}

function createFakeRuntime(opts?: { api?: TurnstileApi; failScript?: boolean }): {
  runtime: TurnstileLoaderRuntime;
  inserted: string[];
  emitLoad: () => void;
  emitError: () => void;
  setApi: (api: TurnstileApi | undefined) => void;
} {
  let api = opts?.api;
  const scripts = new Map<string, TurnstileScriptNode & { emit: (type: string) => void }>();
  const inserted: string[] = [];

  function node(src: string) {
    const key = src;
    const existing = scripts.get(key);
    if (existing) return existing;
    const localListeners: Record<string, Array<() => void>> = { load: [], error: [] };
    const script: TurnstileScriptNode & { emit: (type: string) => void } = {
      src,
      dataset: {},
      addEventListener(type, listener) {
        (localListeners[type] ??= []).push(listener);
      },
      removeEventListener(type, listener) {
        localListeners[type] = (localListeners[type] ?? []).filter((fn) => fn !== listener);
      },
      remove() {
        scripts.delete(key);
      },
      emit(type) {
        for (const fn of localListeners[type] ?? []) fn();
      },
    };
    scripts.set(key, script);
    return script;
  }

  const runtime: TurnstileLoaderRuntime = {
    getApi: () => api,
    queryScript: (src) => scripts.get(src) ?? null,
    createAndInsertScript: (src) => {
      inserted.push(src);
      return node(src);
    },
    setTimeout: (fn, ms) => {
      // Timeouts longos (12s) não disparam sozinhos — senão o loader
      // rejeitaria antes do load/error. O settle curto executa na hora.
      if (ms < 1_000) {
        fn();
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }
      return 0 as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout: () => undefined,
  };

  return {
    runtime,
    inserted,
    emitLoad: () => scripts.get(TURNSTILE_SCRIPT_SRC)?.emit("load"),
    emitError: () => scripts.get(TURNSTILE_SCRIPT_SRC)?.emit("error"),
    setApi: (next) => {
      api = next;
    },
  };
}

describe("public satisfaction loads and renders Turnstile before protected submit", () => {
  it("A. siteKey presente → componente Turnstile é renderizado", () => {
    assert.equal(turnstileIsRequired("pk_live"), true);
    const html = renderToStaticMarkup(
      React.createElement(PublicTurnstile, {
        siteKey: "pk_live",
        onTokenChange: () => undefined,
      })
    );
    assert.match(html, /data-testid="satisfaction-turnstile"/);
    assert.match(html, /Verificação de segurança/);
    assert.match(html, /proteger esta pesquisa contra envios automatizados/i);
    assert.match(SURVEY_APP_SRC, /<PublicTurnstile/);
    assert.match(SURVEY_APP_SRC, /turnstileSiteKey/);
  });

  it("B. siteKey null → widget não aparece e o submit existente continua válido", () => {
    assert.equal(turnstileIsRequired(null), false);
    assert.deepEqual(canSubmitWithTurnstile(null, null), { ok: true });
    assert.equal(isSurveySubmitDisabled({ submitting: false, siteKey: null, token: null }), false);
    assert.equal(SURVEY_APP_SRC.includes('activeForm.turnstileSiteKey ?'), true);
  });

  it("C. script ainda não carregado → botão fica bloqueado", () => {
    assert.equal(
      isSurveySubmitDisabled({ submitting: false, siteKey: "pk", token: null }),
      true
    );
    const html = renderToStaticMarkup(
      React.createElement(PublicTurnstile, {
        siteKey: "pk",
        onTokenChange: () => undefined,
      })
    );
    assert.match(html, new RegExp(TURNSTILE_COPY.loading.replace(/\./g, "\\.")));
  });

  it("D. script carregado → turnstile.render() uma única vez por slot vivo", () => {
    const live = new Set<string>();
    const api = fakeApi(live);
    const captured: TurnstileRenderOptions[] = [];
    const wrapping: TurnstileApi = {
      render(host, options) {
        captured.push(options);
        return api.render(host, options);
      },
      reset: api.reset,
      remove: api.remove,
    };
    const slot = createTurnstileWidgetSlot();
    const host = {} as HTMLElement;
    slot.mount(wrapping, host, {
      sitekey: "pk",
      callback: () => undefined,
    });
    assert.equal(slot.renderCount(), 1);
    assert.equal(live.size, 1);
    assert.equal(captured.length, 1);
  });

  it("E. callback(token) → VERIFIED e botão habilitado", () => {
    let token: string | null = null;
    const api: TurnstileApi = {
      render(_host, options) {
        options.callback("0.token-real");
        return "w1";
      },
      reset() {},
      remove() {},
    };
    const slot = createTurnstileWidgetSlot();
    slot.mount(api, {} as HTMLElement, {
      sitekey: "pk",
      callback: (value) => {
        token = value;
      },
    });
    assert.equal(token, "0.token-real");
    assert.deepEqual(canSubmitWithTurnstile("pk", token), { ok: true });
    assert.equal(isSurveySubmitDisabled({ submitting: false, siteKey: "pk", token }), false);
  });

  it("F. expired-callback → token removido e botão bloqueado", () => {
    let token: string | null = "0.token-real";
    const api: TurnstileApi = {
      render(_host, options) {
        options["expired-callback"]?.();
        return "w1";
      },
      reset() {},
      remove() {},
    };
    createTurnstileWidgetSlot().mount(api, {} as HTMLElement, {
      sitekey: "pk",
      callback: () => undefined,
      "expired-callback": () => {
        token = null;
      },
    });
    assert.equal(token, null);
    assert.equal(canSubmitWithTurnstile("pk", token).ok, false);
    assert.equal(TURNSTILE_COPY.expired, "A verificação expirou. Valide novamente.");
  });

  it("G. error-callback → token removido e botão bloqueado", () => {
    let token: string | null = "0.token-real";
    const api: TurnstileApi = {
      render(_host, options) {
        options["error-callback"]?.();
        return "w1";
      },
      reset() {},
      remove() {},
    };
    createTurnstileWidgetSlot().mount(api, {} as HTMLElement, {
      sitekey: "pk",
      callback: () => undefined,
      "error-callback": () => {
        token = null;
      },
    });
    assert.equal(token, null);
    assert.equal(canSubmitWithTurnstile("pk", token).ok, false);
    assert.equal(
      TURNSTILE_COPY.error,
      "Não foi possível carregar a verificação de segurança. Tente novamente."
    );
  });

  it("H. submit envia o token real no campo turnstileToken", () => {
    const parsed = parseSubmitInput({
      answers: [],
      idempotencyKey: "k1",
      turnstileToken: "0.token-real-do-widget",
    });
    assert.equal(parsed.turnstileToken, "0.token-real-do-widget");
    assert.match(SURVEY_APP_SRC, /turnstileToken,/);
    assert.equal(SURVEY_APP_SRC.includes("cf-turnstile-response"), false);
    assert.equal(SURVEY_APP_SRC.includes("className=\"cf-turnstile\""), false);
  });

  it("I. token nunca aparece em storage/URL", () => {
    const surfaces = [SURVEY_APP_SRC, PUBLIC_TURNSTILE_SRC, LOADER_SRC].join("\n");
    assert.equal(/localStorage\.setItem/i.test(surfaces), false);
    assert.equal(/sessionStorage\.setItem/i.test(surfaces), false);
    assert.equal(/indexedDB/i.test(surfaces), false);
    assert.equal(/document\.cookie/i.test(surfaces) && /turnstile/i.test(surfaces), false);
    assert.equal(HTML_SRC.includes("turnstileToken"), false);
    assert.equal(SURVEY_APP_SRC.includes("history.pushState"), false);
  });

  it("J. StrictMode/remount não deixa dois widgets vivos", () => {
    const live = new Set<string>();
    const api = fakeApi(live);
    const slot = createTurnstileWidgetSlot();
    const host = {} as HTMLElement;
    const opts: TurnstileRenderOptions = { sitekey: "pk", callback: () => undefined };
    slot.mount(api, host, opts);
    slot.unmount(api);
    slot.mount(api, host, opts);
    assert.equal(slot.renderCount(), 2);
    assert.equal(live.size, 1, "após remount só um widget pode existir");
  });

  it("K. backend continua rejeitando MISSING_TOKEN", async () => {
    const config = resolveTurnstileConfig({
      SATISFACTION_TURNSTILE_SECRET_KEY: "segredo",
    } as NodeJS.ProcessEnv);
    const result = await verifyTurnstileToken(null, config, async () => {
      throw new Error("não deveria chamar a rede");
    });
    assert.deepEqual(result, { ok: false, reason: "MISSING_TOKEN" });
  });

  it("L. backend continua rejeitando REJECTED", async () => {
    const config = resolveTurnstileConfig({
      SATISFACTION_TURNSTILE_SECRET_KEY: "segredo",
    } as NodeJS.ProcessEnv);
    const result = await verifyTurnstileToken("tok", config, async () => ({
      ok: true,
      json: async () => ({ success: false }),
    }));
    assert.deepEqual(result, { ok: false, reason: "REJECTED" });
  });

  it("M. backend continua fail-closed em UNAVAILABLE", async () => {
    const config = resolveTurnstileConfig({
      SATISFACTION_TURNSTILE_SECRET_KEY: "segredo",
    } as NodeJS.ProcessEnv);
    const result = await verifyTurnstileToken("tok", config, async () => {
      throw new Error("timeout");
    });
    assert.deepEqual(result, { ok: false, reason: "UNAVAILABLE" });
  });

  it("N. ALREADY_ANSWERED continua sucesso lógico — sem segunda resposta", () => {
    assert.equal(shouldResetTurnstileAfterSubmit("ALREADY_ANSWERED"), false);
    assert.equal(shouldResetTurnstileAfterSubmit("ok"), false);
    assert.equal(shouldResetTurnstileAfterSubmit("TURNSTILE"), true);
    assert.equal(shouldResetTurnstileAfterSubmit("VALIDATION"), true);
    assert.match(SURVEY_APP_SRC, /reason === "ALREADY_ANSWERED"/);
    assert.match(SURVEY_APP_SRC, /setPhase\(\{ kind: "done" \}\)/);
  });

  it("O. links pré-existentes não são invalidados — mesmo /r#TOKEN", () => {
    const { token, tokenHash } = generateSatisfactionToken();
    assert.equal(SATISFACTION_PUBLIC_FORM_PATH, "/r");
    assert.equal(
      buildSatisfactionPublicUrl(token, "https://satisfacao.exemplo.com.br"),
      `https://satisfacao.exemplo.com.br/r#${token}`
    );
    assert.equal(hashSatisfactionToken(token), tokenHash);
    assert.equal(parseTokenFromFragment(`#${token}`), token);
    assert.equal(TOKEN_SRC.includes("crypto.randomBytes(SATISFACTION_TOKEN_BYTES)"), true);
    assert.equal(SATISFACTION_TOKEN_BYTES, 32);
    assert.equal(TOKEN_SRC.includes("sha256"), true);
  });
});

describe("script loader idempotente", () => {
  it("carrega api.js?render=explicit uma única vez", async () => {
    const live = new Set<string>();
    const fake = createFakeRuntime();
    const loader = createTurnstileLoader(fake.runtime);
    const pending = loader.load();
    fake.setApi(fakeApi(live));
    fake.emitLoad();
    await pending;
    const second = await loader.load();
    assert.ok(second);
    assert.equal(fake.inserted.length, 1);
    assert.equal(fake.inserted[0], TURNSTILE_SCRIPT_SRC);
    assert.equal(TURNSTILE_SCRIPT_SRC.includes("render=explicit"), true);
    assert.equal(TURNSTILE_SCRIPT_SRC.startsWith("https://challenges.cloudflare.com/"), true);
  });

  it("se a API já existe, não insere outro script", async () => {
    const fake = createFakeRuntime({ api: fakeApi(new Set()) });
    const loader = createTurnstileLoader(fake.runtime);
    await loader.load();
    assert.equal(fake.inserted.length, 0);
  });

  it("onerror rejeita e permite nova tentativa", async () => {
    const fake = createFakeRuntime();
    const loader = createTurnstileLoader(fake.runtime);
    const pending = loader.load();
    fake.emitError();
    await assert.rejects(pending, /script-error/);
    const retry = loader.load();
    fake.setApi(fakeApi(new Set()));
    fake.emitLoad();
    await retry;
  });
});

describe("site key pública e secret", () => {
  it("DTO público recebe siteKey e NUNCA o secret", () => {
    const config = resolveTurnstileConfig({
      SATISFACTION_TURNSTILE_SITE_KEY: "pk_publica",
      SATISFACTION_TURNSTILE_SECRET_KEY: "sk_nunca_vazar",
    } as NodeJS.ProcessEnv);
    assert.equal(toPublicTurnstileSiteKey(config), "pk_publica");
    const serialized = JSON.stringify({
      turnstileSiteKey: toPublicTurnstileSiteKey(config),
      surveyTitle: "Pesquisa",
    });
    assert.equal(publicFormJsonLooksSafe(serialized), true);
    assert.equal(serialized.includes("sk_nunca_vazar"), false);
    assert.equal(serialized.toLowerCase().includes("secret"), false);
  });

  it("MODE=disabled não envia siteKey — homologação não tenta o widget", () => {
    const config = resolveTurnstileConfig({
      SATISFACTION_TURNSTILE_MODE: "disabled",
      SATISFACTION_TURNSTILE_SITE_KEY: "pk_publica",
      SATISFACTION_TURNSTILE_SECRET_KEY: "sk",
    } as NodeJS.ProcessEnv);
    assert.equal(config.mode, "disabled");
    assert.equal(toPublicTurnstileSiteKey(config), null);
  });

  it("HTML público não embute o script — o loader React carrega explicitamente", () => {
    assert.equal(HTML_SRC.includes("challenges.cloudflare.com"), false);
    assert.match(MAIN_SRC, /SurveyApp/);
    assert.match(MAIN_SRC, /StrictMode/);
  });
});

describe("Public Host Guard e nginx de homologação preservados", () => {
  it("guard continua bloqueando login/auth/customers no host público", () => {
    const prod = { allowDevAssets: false };
    for (const path of ["/login", "/api/auth/me", "/api/customers", "/api/admin"]) {
      assert.equal(isSatisfactionPublicPathAllowed(path, prod), false, path);
    }
    assert.equal(isSatisfactionPublicPathAllowed("/r", prod), true);
    assert.equal(isSatisfactionPublicPathAllowed("/api/public/satisfaction/submit", prod), true);
  });

  it("este commit de aplicação NÃO abre a CSP de homologação", () => {
    assert.match(HOMOLOG_NGINX, /Turnstile está DESABILITADO/);
    assert.equal(HOMOLOG_NGINX.includes("challenges.cloudflare.com"), true);
    const cspLines = HOMOLOG_NGINX.split("\n").filter((line) =>
      line.includes("Content-Security-Policy")
    );
    for (const line of cspLines) {
      assert.equal(
        line.includes("challenges.cloudflare.com"),
        false,
        "nginx de homologação não deve liberar Turnstile neste commit"
      );
    }
  });

  it("autosave PATCH /draft não envia turnstileToken", () => {
    const draftStart = SURVEY_APP_SRC.indexOf("/api/public/satisfaction/draft");
    assert.ok(draftStart >= 0);
    const draftBody = SURVEY_APP_SRC.slice(draftStart, draftStart + 450);
    assert.match(draftBody, /method: "PATCH"/);
    assert.match(draftBody, /expectedVersion/);
    assert.equal(draftBody.includes("turnstileToken"), false);
    assert.match(ROUTES_SRC, /verifyTurnstile\(input\.turnstileToken/);
    assert.match(ROUTES_SRC, /app\.patch\("\/api\/public\/satisfaction\/draft"/);
  });
});
