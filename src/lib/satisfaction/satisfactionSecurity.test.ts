/**
 * Segurança do link público: token, Turnstile e rate limit.
 *
 * Invariantes sob prova: o token tem entropia real, nunca é persistido em
 * claro, não usa id sequencial, viaja no fragmento da URL; o Turnstile é
 * validado no servidor e o bypass de teste NÃO funciona em produção.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSatisfactionPublicUrl,
  evaluateTokenUsability,
  generatePublicSessionToken,
  generateSatisfactionToken,
  hashSatisfactionToken,
  isWellFormedSatisfactionToken,
  parseTokenFromFragment,
  safeEqualHash,
  SATISFACTION_TOKEN_BYTES,
} from "./satisfactionToken.js";
import {
  assertPublicFormDtoHasNoSecrets,
  isMisconfiguredForProduction,
  resolveTurnstileConfig,
  toPublicTurnstileDto,
  verifyTurnstileToken,
} from "./satisfactionTurnstile.server.js";
import {
  resolveRateLimitKey,
  SatisfactionRateLimiter,
  SATISFACTION_RATE_LIMIT_RULES,
} from "./satisfactionRateLimit.js";

describe("token do link público", () => {
  it("usa 256 bits de entropia", () => {
    assert.equal(SATISFACTION_TOKEN_BYTES, 32);
    const { token } = generateSatisfactionToken();
    // base64url de 32 bytes = 43 caracteres sem padding.
    assert.equal(token.length, 43);
  });

  it("tokens são únicos entre si", () => {
    const tokens = new Set(Array.from({ length: 500 }, () => generateSatisfactionToken().token));
    assert.equal(tokens.size, 500);
  });

  it("ELIMINATÓRIO: o que vai para o banco é hash, nunca o token em claro", () => {
    const { token, tokenHash } = generateSatisfactionToken();
    assert.notEqual(tokenHash, token);
    assert.equal(tokenHash.length, 64, "sha256 hex tem 64 caracteres");
    assert.match(tokenHash, /^[0-9a-f]{64}$/);
    assert.equal(tokenHash.includes(token), false);
  });

  it("hash é determinístico e sensível a qualquer mudança", () => {
    assert.equal(hashSatisfactionToken("abc"), hashSatisfactionToken("abc"));
    assert.notEqual(hashSatisfactionToken("abc"), hashSatisfactionToken("abd"));
  });

  it("prefixo de suporte não revela o token", () => {
    const { token, tokenPrefix } = generateSatisfactionToken();
    assert.equal(tokenPrefix.length, 8);
    assert.equal(token.startsWith(tokenPrefix), true);
    assert.ok(tokenPrefix.length < token.length / 4, "prefixo curto demais para reconstruir");
  });

  it("comparação de hash é em tempo constante e correta", () => {
    const h = hashSatisfactionToken("x");
    assert.equal(safeEqualHash(h, h), true);
    assert.equal(safeEqualHash(h, hashSatisfactionToken("y")), false);
    assert.equal(safeEqualHash(h, "curto"), false);
  });

  it("rejeita formato que nem parece token, sem custo de banco", () => {
    assert.equal(isWellFormedSatisfactionToken("123"), false);
    assert.equal(isWellFormedSatisfactionToken(""), false);
    assert.equal(isWellFormedSatisfactionToken(42), false);
    assert.equal(isWellFormedSatisfactionToken("a".repeat(200)), false);
    assert.equal(isWellFormedSatisfactionToken("tok/com+chars=invalidos!!"), false);
    assert.equal(isWellFormedSatisfactionToken(generateSatisfactionToken().token), true);
  });

  it("ELIMINATÓRIO: o token viaja no FRAGMENTO, não em path nem query", () => {
    const { token } = generateSatisfactionToken();
    const url = buildSatisfactionPublicUrl(token, "https://satisfacao.exemplo.com.br");
    assert.equal(url, `https://satisfacao.exemplo.com.br/r#${token}`);

    const [beforeFragment] = url.split("#");
    assert.equal(
      beforeFragment?.includes(token),
      false,
      "o token não pode aparecer na parte enviada ao servidor"
    );
    assert.equal(url.includes("?"), false, "nada de query string com segredo");
  });

  it("a URL pública não expõe nenhum id interno", () => {
    const url = buildSatisfactionPublicUrl(generateSatisfactionToken().token, "https://x.com");
    assert.equal(/customerId|campaignId|invitationId|survey=|id=/.test(url), false);
  });

  it("lê o token do fragmento nos dois formatos aceitos", () => {
    const { token } = generateSatisfactionToken();
    assert.equal(parseTokenFromFragment(`#${token}`), token);
    assert.equal(parseTokenFromFragment(`#token=${token}`), token);
    assert.equal(parseTokenFromFragment("#lixo"), null);
    assert.equal(parseTokenFromFragment(""), null);
    assert.equal(parseTokenFromFragment(null), null);
  });

  it("token de sessão pública também nasce hasheado", () => {
    const { token, tokenHash } = generatePublicSessionToken();
    assert.notEqual(token, tokenHash);
    assert.match(tokenHash, /^[0-9a-f]{64}$/);
  });
});

describe("estado de usabilidade do token", () => {
  const now = new Date("2026-06-15T12:00:00Z");

  it("ativo e dentro da validade é usável", () => {
    assert.deepEqual(
      evaluateTokenUsability({ status: "ACTIVE", expiresAt: null, revokedAt: null }, now),
      { usable: true }
    );
  });

  it("revogado é bloqueado, mesmo com status desatualizado", () => {
    assert.deepEqual(
      evaluateTokenUsability({ status: "ACTIVE", expiresAt: null, revokedAt: now }, now),
      { usable: false, reason: "REVOKED" }
    );
  });

  it("expirado pelo relógio vence o campo status", () => {
    assert.deepEqual(
      evaluateTokenUsability(
        { status: "ACTIVE", expiresAt: new Date("2026-01-01T00:00:00Z"), revokedAt: null },
        now
      ),
      { usable: false, reason: "EXPIRED" }
    );
  });

  it("token inexistente é INVALID", () => {
    assert.deepEqual(evaluateTokenUsability(null, now), { usable: false, reason: "INVALID" });
  });
});

describe("Turnstile", () => {
  it("com segredo configurado a proteção é obrigatória (fail-closed)", () => {
    const config = resolveTurnstileConfig({
      SATISFACTION_TURNSTILE_SECRET_KEY: "segredo",
    } as NodeJS.ProcessEnv);
    assert.equal(config.mode, "required");
  });

  it("sem segredo não há como validar — modo desligado", () => {
    assert.equal(resolveTurnstileConfig({} as NodeJS.ProcessEnv).mode, "disabled");
  });

  it("DTO público informa required + siteKey e NUNCA serializa o secret", () => {
    const config = resolveTurnstileConfig({
      SATISFACTION_TURNSTILE_SITE_KEY: "pk_publica",
      SATISFACTION_TURNSTILE_SECRET_KEY: "sk_nunca_vazar",
    } as NodeJS.ProcessEnv);
    const dto = toPublicTurnstileDto(config);
    assert.deepEqual(dto, { required: true, siteKey: "pk_publica" });
    const serialized = JSON.stringify({ turnstile: dto, surveyTitle: "Pesquisa" });
    assertPublicFormDtoHasNoSecrets(serialized);
    assert.equal(serialized.includes("sk_nunca_vazar"), false);
  });

  it("Turnstile obrigatório sem siteKey não inventa chave — e não vaza secret", () => {
    const config = resolveTurnstileConfig({
      SATISFACTION_TURNSTILE_SECRET_KEY: "sk_nunca_vazar",
    } as NodeJS.ProcessEnv);
    const dto = toPublicTurnstileDto(config);
    assert.equal(dto.required, true);
    assert.equal(dto.siteKey, null);
    assertPublicFormDtoHasNoSecrets(JSON.stringify(dto));
  });

  it("produção sem site key pública também é desvio", () => {
    const env = {
      NODE_ENV: "production",
      SATISFACTION_TURNSTILE_SECRET_KEY: "sk",
    } as NodeJS.ProcessEnv;
    assert.equal(isMisconfiguredForProduction(resolveTurnstileConfig(env), env), true);
  });

  it("produção sem proteção é sinalizada como desvio de configuração", () => {
    const env = { NODE_ENV: "production" } as NodeJS.ProcessEnv;
    assert.equal(isMisconfiguredForProduction(resolveTurnstileConfig(env), env), true);
  });

  it("ELIMINATÓRIO: o bypass de teste NÃO funciona em produção", () => {
    const config = resolveTurnstileConfig({
      NODE_ENV: "production",
      SATISFACTION_TURNSTILE_SECRET_KEY: "segredo",
      SATISFACTION_TURNSTILE_DEV_BYPASS: "1",
    } as NodeJS.ProcessEnv);
    assert.equal(config.devBypassEnabled, false, "bypass jamais pode ligar em produção");
    assert.equal(config.mode, "required");
  });

  it("o bypass só existe fora de produção e quando explicitamente ligado", () => {
    const ligado = resolveTurnstileConfig({
      NODE_ENV: "development",
      SATISFACTION_TURNSTILE_SECRET_KEY: "segredo",
      SATISFACTION_TURNSTILE_DEV_BYPASS: "1",
    } as NodeJS.ProcessEnv);
    assert.equal(ligado.devBypassEnabled, true);

    const desligado = resolveTurnstileConfig({
      NODE_ENV: "development",
      SATISFACTION_TURNSTILE_SECRET_KEY: "segredo",
    } as NodeJS.ProcessEnv);
    assert.equal(desligado.devBypassEnabled, false);
  });

  it("token ausente é rejeitado quando a proteção é obrigatória", async () => {
    const config = resolveTurnstileConfig({
      SATISFACTION_TURNSTILE_SECRET_KEY: "segredo",
    } as NodeJS.ProcessEnv);
    const result = await verifyTurnstileToken(null, config, async () => {
      throw new Error("não deveria chamar a rede");
    });
    assert.deepEqual(result, { ok: false, reason: "MISSING_TOKEN" });
  });

  it("siteverify aprovando libera o submit", async () => {
    const config = resolveTurnstileConfig({
      SATISFACTION_TURNSTILE_SECRET_KEY: "segredo",
    } as NodeJS.ProcessEnv);
    const result = await verifyTurnstileToken("tok", config, async () => ({
      ok: true,
      json: async () => ({ success: true }),
    }));
    assert.deepEqual(result, { ok: true, skipped: false });
  });

  it("siteverify reprovando bloqueia o submit", async () => {
    const config = resolveTurnstileConfig({
      SATISFACTION_TURNSTILE_SECRET_KEY: "segredo",
    } as NodeJS.ProcessEnv);
    const result = await verifyTurnstileToken("tok", config, async () => ({
      ok: true,
      json: async () => ({ success: false, "error-codes": ["invalid-input-response"] }),
    }));
    assert.deepEqual(result, { ok: false, reason: "REJECTED" });
  });

  it("indisponibilidade da rede NÃO vira permissão", async () => {
    const config = resolveTurnstileConfig({
      SATISFACTION_TURNSTILE_SECRET_KEY: "segredo",
    } as NodeJS.ProcessEnv);
    const result = await verifyTurnstileToken("tok", config, async () => {
      throw new Error("timeout");
    });
    assert.deepEqual(result, { ok: false, reason: "UNAVAILABLE" });
  });

  it("DTO público informa required + siteKey e NUNCA serializa o secret", () => {
    const config = resolveTurnstileConfig({
      SATISFACTION_TURNSTILE_SITE_KEY: "pk_publica",
      SATISFACTION_TURNSTILE_SECRET_KEY: "sk_nunca_vazar",
    } as NodeJS.ProcessEnv);
    const dto = toPublicTurnstileDto(config);
    assert.deepEqual(dto, { required: true, siteKey: "pk_publica" });
    const serialized = JSON.stringify({ turnstile: dto, surveyTitle: "Pesquisa" });
    assertPublicFormDtoHasNoSecrets(serialized);
    assert.equal(serialized.includes("sk_nunca_vazar"), false);
    assert.equal(serialized.toLowerCase().includes("secret"), false);
  });

  it("DTO público com Turnstile obrigatório sem siteKey não libera o widget — e não vaza secret", () => {
    const config = resolveTurnstileConfig({
      SATISFACTION_TURNSTILE_SECRET_KEY: "sk_nunca_vazar",
    } as NodeJS.ProcessEnv);
    const dto = toPublicTurnstileDto(config);
    assert.equal(dto.required, true);
    assert.equal(dto.siteKey, null);
    assertPublicFormDtoHasNoSecrets(JSON.stringify(dto));
  });

  it("produção sem site key pública também é desvio", () => {
    const env = {
      NODE_ENV: "production",
      SATISFACTION_TURNSTILE_SECRET_KEY: "sk",
    } as NodeJS.ProcessEnv;
    assert.equal(isMisconfiguredForProduction(resolveTurnstileConfig(env), env), true);
  });

  it("o segredo nunca aparece no resultado devolvido", async () => {
    const config = resolveTurnstileConfig({
      SATISFACTION_TURNSTILE_SECRET_KEY: "SEGREDO-SUPER-SENSIVEL",
    } as NodeJS.ProcessEnv);
    const result = await verifyTurnstileToken("tok", config, async () => {
      throw new Error("falhou com SEGREDO-SUPER-SENSIVEL no texto");
    });
    assert.equal(JSON.stringify(result).includes("SEGREDO"), false);
  });
});

describe("rate limit", () => {
  it("libera dentro do limite e bloqueia ao estourar", () => {
    const limiter = new SatisfactionRateLimiter();
    const max = SATISFACTION_RATE_LIMIT_RULES.submit.max;
    const t0 = 1_000_000;

    for (let i = 0; i < max; i += 1) {
      assert.equal(limiter.check("submit", "1.2.3.4", t0).allowed, true, `tentativa ${i + 1}`);
    }
    const blocked = limiter.check("submit", "1.2.3.4", t0);
    assert.equal(blocked.allowed, false);
    assert.ok(blocked.retryAfterSeconds > 0);
  });

  it("a janela desliza — depois do tempo, libera de novo", () => {
    const limiter = new SatisfactionRateLimiter();
    const rule = SATISFACTION_RATE_LIMIT_RULES.submit;
    const t0 = 2_000_000;
    for (let i = 0; i < rule.max; i += 1) limiter.check("submit", "ip", t0);
    assert.equal(limiter.check("submit", "ip", t0).allowed, false);
    assert.equal(limiter.check("submit", "ip", t0 + rule.windowMs + 1).allowed, true);
  });

  it("chaves e buckets são independentes — um cliente não afeta o outro", () => {
    const limiter = new SatisfactionRateLimiter();
    const t0 = 3_000_000;
    for (let i = 0; i < SATISFACTION_RATE_LIMIT_RULES.submit.max; i += 1) {
      limiter.check("submit", "ip-a", t0);
    }
    assert.equal(limiter.check("submit", "ip-a", t0).allowed, false);
    assert.equal(limiter.check("submit", "ip-b", t0).allowed, true);
    assert.equal(limiter.check("draft", "ip-a", t0).allowed, true);
  });

  it("limites são generosos para o cliente legítimo", () => {
    // Uma pesquisa curta: abrir, salvar rascunho algumas vezes, enviar.
    assert.ok(SATISFACTION_RATE_LIMIT_RULES.draft.max >= 30);
    assert.ok(SATISFACTION_RATE_LIMIT_RULES.session.max >= 10);
    assert.ok(SATISFACTION_RATE_LIMIT_RULES.submit.max >= 3);
  });

  it("X-Forwarded-For só é considerado com proxy confiável", () => {
    const input = { socketAddress: "10.0.0.1", forwardedFor: "203.0.113.9, 70.41.3.18" };
    assert.equal(resolveRateLimitKey(input, { trustProxy: true }), "203.0.113.9");
    assert.equal(resolveRateLimitKey(input, { trustProxy: false }), "10.0.0.1");
  });

  it("sem origem identificável a chave é estável, não vazia", () => {
    assert.equal(resolveRateLimitKey({}, { trustProxy: false }), "unknown");
  });
});
