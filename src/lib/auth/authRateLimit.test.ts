/**
 * Rate limit do auth humano.
 *
 * Cobre o comportamento da janela e — igualmente importante — o que a feature
 * NÃO fez: não habilitou `trust proxy`, não passou a confiar em header
 * forjável e não encostou no limiter público da Satisfação.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  AUTH_RATE_LIMIT_RULES,
  AuthRateLimiter,
  authRateLimitedBody,
} from "./authRateLimit.js";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/**
 * Estes módulos EXPLICAM em comentário por que não confiam em header de proxy.
 * A asserção precisa olhar o CÓDIGO, não a prosa — senão a documentação correta
 * derrubaria o teste.
 */
function code(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("janela deslizante", () => {
  it("aplica o limite e devolve retryAfter", () => {
    const limiter = new AuthRateLimiter();
    const t0 = 1_000_000;
    for (let i = 0; i < AUTH_RATE_LIMIT_RULES.login.max; i += 1) {
      assert.equal(limiter.consume("login", "alguem@exemplo.test", t0).allowed, true);
    }
    const bloqueado = limiter.consume("login", "alguem@exemplo.test", t0);
    assert.equal(bloqueado.allowed, false);
    assert.ok(bloqueado.retryAfterSeconds > 0);
    assert.equal(authRateLimitedBody(bloqueado).code, "RATE_LIMITED");
  });

  it("a janela expira sozinha — não existe lockout permanente", () => {
    const limiter = new AuthRateLimiter();
    const t0 = 1_000_000;
    for (let i = 0; i < AUTH_RATE_LIMIT_RULES.login.max; i += 1) {
      limiter.consume("login", "alvo@exemplo.test", t0);
    }
    assert.equal(limiter.consume("login", "alvo@exemplo.test", t0).allowed, false);

    const depois = t0 + AUTH_RATE_LIMIT_RULES.login.windowMs + 1;
    assert.equal(
      limiter.peek("login", "alvo@exemplo.test", depois).allowed,
      true,
      "passada a janela, a identidade volta sozinha"
    );
  });

  it("sucesso limpa o histórico da identidade", () => {
    const limiter = new AuthRateLimiter();
    const t0 = 2_000_000;
    for (let i = 0; i < 4; i += 1) limiter.consume("login", "erra@exemplo.test", t0);
    limiter.clear("login", "erra@exemplo.test");
    assert.equal(limiter.peek("login", "erra@exemplo.test", t0).remaining, AUTH_RATE_LIMIT_RULES.login.max);
  });

  it("peek não consome — dá para negar antes de pagar o scrypt", () => {
    const limiter = new AuthRateLimiter();
    const t0 = 3_000_000;
    limiter.peek("login", "x@exemplo.test", t0);
    limiter.peek("login", "x@exemplo.test", t0);
    assert.equal(limiter.peek("login", "x@exemplo.test", t0).remaining, AUTH_RATE_LIMIT_RULES.login.max);
  });

  it("identidades e buckets são independentes", () => {
    const limiter = new AuthRateLimiter();
    const t0 = 4_000_000;
    for (let i = 0; i < AUTH_RATE_LIMIT_RULES.login.max; i += 1) {
      limiter.consume("login", "a@exemplo.test", t0);
    }
    assert.equal(limiter.peek("login", "a@exemplo.test", t0).allowed, false);
    assert.equal(limiter.peek("login", "b@exemplo.test", t0).allowed, true);
    assert.equal(limiter.peek("change-password", "a@exemplo.test", t0).allowed, true);
  });

  it("os limites são os desenhados para cada operação", () => {
    assert.deepEqual(AUTH_RATE_LIMIT_RULES.login, { windowMs: 15 * 60_000, max: 5 });
    assert.deepEqual(AUTH_RATE_LIMIT_RULES["change-password"], { windowMs: 15 * 60_000, max: 10 });
    assert.deepEqual(AUTH_RATE_LIMIT_RULES["admin-reset"], { windowMs: 10 * 60_000, max: 10 });
  });
});

describe("modelo de confiança de rede — o que NÃO foi feito", () => {
  it("o limiter não lê header nenhum — a chave é sempre identidade", () => {
    const src = code("src/lib/auth/authRateLimit.ts").toLowerCase();
    for (const proibido of ["x-forwarded-for", "x-real-ip", "cf-connecting-ip", "forwardedfor"]) {
      assert.equal(src.includes(proibido), false, `${proibido} não pode aparecer no código`);
    }
    // Nem sequer recebe um objeto de request: a API só aceita bucket + chave.
    assert.equal(src.includes("req."), false);
    assert.equal(src.includes("headers"), false);
  });

  it("a feature não habilita trust proxy em lugar nenhum", () => {
    const server = code("server.ts");
    assert.doesNotMatch(server, /app\.set\(\s*["']trust proxy["']/);
    assert.doesNotMatch(server, /app\.enable\(\s*["']trust proxy["']/);
    for (const rel of [
      "src/lib/auth/authRateLimit.ts",
      "src/lib/auth/passwordLifecycleRoutes.ts",
      "src/lib/auth/passwordChangeRequiredGuard.ts",
      "src/lib/auth/securityAudit.server.ts",
    ]) {
      assert.doesNotMatch(code(rel), /trust proxy/i, `${rel} não pode mexer em trust proxy`);
    }
  });

  it("a auditoria usa o peer do socket, nunca header forjável", () => {
    const src = code("src/lib/auth/securityAudit.server.ts");
    assert.match(src, /resolveAuditIpAddress\(socketAddress: unknown\)/);
    assert.doesNotMatch(src.toLowerCase(), /x-forwarded-for|cf-connecting-ip|x-real-ip/);
    // O único header consumido é o User-Agent, e ele é telemetria, não autorização.
    const rotas = code("src/lib/auth/passwordLifecycleRoutes.ts");
    assert.match(rotas, /req\.socket\?\.remoteAddress/);
    assert.doesNotMatch(rotas.toLowerCase(), /x-forwarded-for|cf-connecting-ip|x-real-ip/);
    // E no server.ts a auditoria de criação de usuário segue a mesma regra.
    assert.match(code("server.ts"), /resolveAuditIpAddress\(req\.socket\?\.remoteAddress\)/);
  });

  it("o limiter público da Satisfação não foi tocado", () => {
    const satisfaction = read("src/lib/satisfaction/satisfactionRateLimit.ts");
    // Continua sendo um módulo próprio, com as mesmas regras públicas.
    assert.match(satisfaction, /session: \{ windowMs: 60_000, max: 20 \}/);
    assert.match(satisfaction, /draft: \{ windowMs: 60_000, max: 60 \}/);
    assert.match(satisfaction, /submit: \{ windowMs: 300_000, max: 10 \}/);
    // E o limiter do auth humano não o importa nem o substitui.
    assert.doesNotMatch(code("src/lib/auth/authRateLimit.ts"), /satisfactionRateLimiter|from "[^"]*satisfaction/i);
  });
});

describe("sem estado persistente", () => {
  it("o limiter não escreve no banco (nada de failedLoginCount/lockedUntil)", () => {
    const src = code("src/lib/auth/authRateLimit.ts");
    assert.doesNotMatch(src, /prisma|@prisma\/client/i);
    assert.doesNotMatch(src, /failedLoginCount|lockedUntil|lockoutUntil/i);
  });

  it("o schema não ganhou coluna de bloqueio de conta", () => {
    const schema = read("prisma/schema.prisma");
    assert.doesNotMatch(schema, /failedLoginCount|lockedUntil|lockoutUntil|loginAttempts/i);
  });
});
