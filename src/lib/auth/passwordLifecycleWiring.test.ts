/**
 * Fiação da feature no server.ts e no frontend, e as regressões que ela NÃO
 * pode causar.
 *
 * Os testes de comportamento (guard, rotas, E2E) provam a lógica. Este arquivo
 * prova o que só se vê no arquivo montado: ordem de registro do middleware,
 * ausência de rota duplicada de reset, superfícies alheias intactas.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PASSWORD_CHANGE_ALLOWED_ROUTES } from "./passwordChangeRequiredGuard.js";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const server = read("server.ts");

/**
 * Alguns módulos DOCUMENTAM em comentário o que deliberadamente não fazem
 * ("nunca em localStorage..."). Asserção de ausência tem de olhar o código.
 */
function code(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("server.ts — guard montado antes das rotas de negócio", () => {
  it("o middleware existe e resolve o estado a partir da sessão", () => {
    assert.match(server, /createPasswordChangeRequiredGuard\(\{/);
    assert.match(server, /resolveMustChangePassword:/);
    // Reaproveita o contexto quando outro guard já resolveu.
    assert.match(server, /if \(request\.appAuth\) return request\.appAuth\.mustChangePassword === true;/);
  });

  it("a resolução do guard NÃO tem efeito colateral sobre a sessão (P21)", () => {
    // Recorte exato do bloco do guard: da declaração até o app.use que o monta.
    // Comentários fora — o bloco EXPLICA por que não chama readAppSession, e a
    // asserção precisa olhar o código.
    const inicio = server.indexOf("const passwordChangeRequiredGuard =");
    const fim = server.indexOf('app.use("/api", (req, res, next) => {', inicio);
    assert.ok(inicio > 0 && fim > inicio, "não achei o bloco do guard");
    const bloco = server
      .slice(inicio, fim)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

    // readAppSession REVOGA sessão com permissionsVersion obsoleta. Se o guard
    // o chamasse, mataria a sessão que /api/auth/sync-session-permissions
    // precisa encontrar viva — o refresh de ACL viraria logout.
    assert.doesNotMatch(bloco, /readAppSession/, "o guard não pode chamar readAppSession");
    assert.doesNotMatch(bloco, /revokeAppSession/, "o guard não pode revogar sessão");
    assert.doesNotMatch(bloco, /\.update\(|updateMany\(|\.create\(/, "o guard não pode escrever");
    // A leitura é um findFirst enxuto, só para obter o booleano.
    assert.match(bloco, /prisma\.appSession\.findFirst\(\{/);
    assert.match(bloco, /select: \{ user: \{ select: \{ isActive: true, mustChangePassword: true \} \} \}/);

    // E a rota de sync continua com o lookup direto que a protege do stale-check.
    const sync = server.slice(
      server.indexOf('app.post("/api/auth/sync-session-permissions"'),
      server.indexOf('app.post("/api/auth/sync-session-permissions"') + 1500
    );
    assert.match(sync, /prisma\.appSession\.findFirst\(\{/);
    assert.match(sync, /permissionsVersionAtIssue: session\.user\.permissionsVersion/);
  });

  it("é montado em /api ANTES de login, auth e rotas de negócio", () => {
    const mount = server.indexOf('app.use("/api", (req, res, next) => {\r\n    passwordChangeRequiredGuard');
    const mountLf = server.indexOf('app.use("/api", (req, res, next) => {\n    passwordChangeRequiredGuard');
    const guardIdx = mount >= 0 ? mount : mountLf;
    assert.ok(guardIdx > 0, "guard precisa estar montado em /api");

    for (const rota of [
      'app.post("/api/auth/login"',
      'app.post("/api/auth/logout"',
      'app.get("/api/auth/me"',
      'app.get("/api/auth/permissions-version"',
      'app.post("/api/admin/users"',
    ]) {
      const idx = server.indexOf(rota);
      assert.ok(idx > 0, `rota ${rota} deveria existir`);
      assert.ok(idx > guardIdx, `${rota} precisa ser registrada DEPOIS do guard`);
    }
  });

  it("as únicas rotas /api registradas antes do guard estão na whitelist", () => {
    const guardIdx = server.search(/app\.use\("\/api", \(req, res, next\) => \{\s*passwordChangeRequiredGuard/);
    assert.ok(guardIdx > 0);
    const antes = server.slice(0, guardIdx);

    const rotas = [...antes.matchAll(/app\.(get|post|put|patch|delete)\(\s*"(\/api[^"]*)"/g)].map(
      (m) => `${m[1].toUpperCase()} ${m[2]}`
    );
    const permitidas = new Set(
      PASSWORD_CHANGE_ALLOWED_ROUTES.map((r) => `${r.method} ${r.path}`)
    );
    for (const rota of rotas) {
      assert.ok(
        permitidas.has(rota),
        `${rota} é registrada antes do guard e NÃO está na whitelist — ela escaparia do bloqueio`
      );
    }
  });

  it("a Satisfação pública continua registrada antes de tudo (fora do alcance do guard)", () => {
    const satisfaction = server.indexOf("registerSatisfactionPublicRoutes(app);");
    const guardIdx = server.search(/passwordChangeRequiredGuard\(req, res, next\)/);
    assert.ok(satisfaction > 0 && guardIdx > satisfaction);
  });
});

describe("server.ts — reset administrativo sem duplicação", () => {
  it("existe exatamente UMA rota de reset, e ela vive no módulo do ciclo de senha", () => {
    assert.doesNotMatch(
      server,
      /app\.post\(\s*"\/api\/admin\/users\/:id\/reset-password"/,
      "a rota antiga do server.ts não pode coexistir com a do módulo"
    );
    assert.match(server, /registerPasswordLifecycleRoutes\(app, \{/);
    const rotas = read("src/lib/auth/passwordLifecycleRoutes.ts");
    assert.match(rotas, /adminResetPassword: "\/api\/admin\/users\/:id\/reset-password"/);
  });

  it("o reset exige SUPER_ADMIN no backend, além do guard de permissão", () => {
    const rotas = read("src/lib/auth/passwordLifecycleRoutes.ts");
    assert.match(rotas, /deps\.requireAdminUsersManage/);
    assert.match(rotas, /auth\.role !== "SUPER_ADMIN"/);
  });

  it("o guard de usuários continua sendo o mesmo já existente", () => {
    assert.match(server, /requireAdminUsersManage: requireUsersManageOrBootstrap/);
    assert.match(server, /const requireUsersManageOrBootstrap = requireBootstrapOrResource\(/);
  });
});

describe("server.ts — criação de usuário e login", () => {
  it("a credencial inicial nasce temporária e auditada, na mesma transação", () => {
    const inicio = server.indexOf('app.post("/api/admin/users"');
    const fim = server.indexOf('app.get("/api/admin/users/:id"', inicio);
    const rota = server.slice(inicio, fim > inicio ? fim : inicio + 8000);
    assert.match(rota, /mustChangePassword: true/);
    assert.match(rota, /passwordChangedAt: new Date\(\)/);
    assert.match(rota, /prisma\.\$transaction\(async \(tx\) => \{/);
    assert.match(rota, /SECURITY_AUDIT_EVENTS\.USER_INITIAL_PASSWORD_ASSIGNED/);
    // Continua consumindo a política central, não uma regra própria.
    assert.match(rota, /validatePasswordMin\(password\)/);
  });

  it("o login limita por identidade, limpa no sucesso e não enumera contas", () => {
    const inicio = server.indexOf('app.post("/api/auth/login"');
    const fim = server.indexOf('app.post("/api/auth/logout"', inicio);
    const rota = server.slice(inicio, fim);
    assert.match(rota, /authRateLimiter\.peek\("login", loginRateKey\)/);
    // Conta a falha tanto para e-mail inexistente quanto para senha errada.
    assert.equal((rota.match(/authRateLimiter\.consume\("login", loginRateKey\)/g) ?? []).length, 2);
    assert.match(rota, /authRateLimiter\.clear\("login", loginRateKey\)/);
    // Mensagem genérica preservada nos dois caminhos.
    assert.equal((rota.match(/E-mail ou senha inválidos\./g) ?? []).length, 2);
  });

  it("login com troca pendente NÃO é negado — a sessão restrita precisa nascer", () => {
    const inicio = server.indexOf('app.post("/api/auth/login"');
    const fim = server.indexOf('app.post("/api/auth/logout"', inicio);
    const rota = server.slice(inicio, fim);
    assert.doesNotMatch(rota, /mustChangePassword/, "o login não pode barrar por troca pendente");
  });
});

describe("DTO /api/auth/me", () => {
  it("expõe mustChangePassword e passwordChangedAt", () => {
    const shared = read("src/lib/auth/appAuth.shared.ts");
    const serverAuth = read("src/lib/auth/appAuth.server.ts");
    assert.match(shared, /mustChangePassword: boolean;/);
    assert.match(shared, /passwordChangedAt: string \| null;/);
    assert.match(serverAuth, /mustChangePassword:\s*\r?\n?\s*\(user as AppUser/);
  });

  it("não expõe passwordHash nem nada de sessão", () => {
    const serverAuth = read("src/lib/auth/appAuth.server.ts");
    const dto = serverAuth.slice(
      serverAuth.indexOf("export function toSafeAppUser"),
      serverAuth.indexOf("export function toAppAuthContext")
    );
    assert.doesNotMatch(dto, /passwordHash/);
    assert.doesNotMatch(dto, /tokenHash/);
    assert.doesNotMatch(dto, /\bsalt\b/);
  });
});

describe("regressão — superfícies que não podem ter sido tocadas", () => {
  it("Collector: device-auth e sessão autônoma seguem sem cookie humano", () => {
    const deviceAuth = read("src/lib/inventory/collector/collectorDeviceAuth.server.ts");
    assert.doesNotMatch(deviceAuth, /mustChangePassword|passwordChangeRequiredGuard/);
    assert.doesNotMatch(deviceAuth, /induscost_session/);
    const autonoma = read("src/lib/inventory/collector/collectorAutonomousSession.server.ts");
    assert.doesNotMatch(autonoma, /mustChangePassword|passwordChangeRequiredGuard/);
  });

  it("Satisfação pública não conhece a feature", () => {
    const publicas = read("src/lib/satisfaction/satisfactionPublicRoutes.ts");
    assert.doesNotMatch(publicas, /mustChangePassword|passwordChangeRequiredGuard|authRateLimiter/);
  });

  it("o guard não vira middleware global exigindo AppUser", () => {
    const guard = read("src/lib/auth/passwordChangeRequiredGuard.ts");
    // Sem cookie humano ele devolve o controle imediatamente.
    assert.match(guard, /if \(!hasSessionCookie\) return next\(\);/);
    // E nunca responde 401: autenticar continua sendo responsabilidade do guard de rota.
    assert.doesNotMatch(guard, /status\(401\)/);
  });

  it("a sessão não mudou de TTL, de flags nem de mecanismo", () => {
    const shared = read("src/lib/auth/appAuth.shared.ts");
    assert.match(shared, /APP_SESSION_TTL_MS = 1000 \* 60 \* 60 \* 12/);
    assert.match(shared, /APP_SESSION_COOKIE_NAME = "induscost_session"/);
    assert.match(server, /httpOnly: true,\r?\n\s*sameSite: "lax",/);
    // Nada de JWT nem de segundo sistema de sessão.
    for (const rel of [
      "src/lib/auth/passwordLifecycle.server.ts",
      "src/lib/auth/passwordLifecycleRoutes.ts",
      "src/lib/auth/passwordChangeRequiredGuard.ts",
    ]) {
      assert.doesNotMatch(read(rel), /jsonwebtoken|jwt\.sign|sessionVersion/i);
    }
  });

  it("permissionsVersion não foi transformado em passwordVersion", () => {
    const lifecycle = read("src/lib/auth/passwordLifecycle.server.ts");
    // Só é LIDO para carimbar a sessão nova; nunca incrementado por troca de senha.
    assert.match(lifecycle, /permissionsVersionAtIssue: args\.user\.permissionsVersion/);
    assert.doesNotMatch(lifecycle, /permissionsVersion:\s*\{\s*increment/);
    assert.doesNotMatch(lifecycle, /bumpPermissionsVersion/);
  });

  it("nenhum campo de expiração periódica de senha entrou no schema", () => {
    const schema = read("prisma/schema.prisma");
    for (const proibido of [
      "passwordExpiresAt",
      "passwordExpirationDays",
      "passwordValidUntil",
      "passwordMaxAge",
      "mustChangePasswordEveryXDays",
      "lastPasswordReminderAt",
      "passwordRotationInterval",
    ]) {
      assert.doesNotMatch(schema, new RegExp(proibido), `${proibido} não pode existir`);
    }
  });

  it('a feature não trouxe "esqueci minha senha", MFA nem histórico de senhas', () => {
    for (const rel of [
      "src/lib/auth/passwordLifecycle.server.ts",
      "src/lib/auth/passwordLifecycleRoutes.ts",
      "src/lib/auth/passwordPolicy.ts",
      "src/lib/auth/passwordChangeRequiredGuard.ts",
    ]) {
      const src = read(rel);
      assert.doesNotMatch(src, /passwordResetToken|passwordResetExpiresAt|forgot-password/i);
      assert.doesNotMatch(src, /totp|webauthn|passkey|\bmfa\b|\b2fa\b/i);
      assert.doesNotMatch(src, /passwordHistory|previousPasswords/i);
      assert.doesNotMatch(src, /nodemailer|smtp/i);
    }
    const schema = read("prisma/schema.prisma");
    assert.doesNotMatch(schema, /passwordResetToken|passwordHistory|totpSecret/i);
  });
});

describe("frontend — UX sem virar autoridade", () => {
  it("RequireAuth desvia para a troca obrigatória", () => {
    const requireAuth = read("src/components/RequireAuth.tsx");
    assert.match(requireAuth, /authUser\?\.mustChangePassword/);
    assert.match(requireAuth, /PASSWORD_CHANGE_ROUTE = "\/security\/change-password"/);
    assert.match(requireAuth, /<Navigate to=\{PASSWORD_CHANGE_ROUTE\} replace \/>/);
  });

  it("a rota fica fora do Layout e fora do gate de ACL", () => {
    const app = read("src/App.tsx");
    const rota = app.indexOf('path="/security/change-password"');
    const aclGate = app.indexOf("<Route element={<RequirePathViewAccess />}>");
    assert.ok(rota > 0);
    assert.ok(rota < aclGate, "a tela precisa abrir mesmo com a ACL bloqueada");
  });

  it("a senha nunca é guardada em storage nem vai para a URL", () => {
    for (const rel of [
      "src/components/security/PasswordChangePage.tsx",
      "src/lib/auth/passwordLifecycleClient.ts",
      "src/components/AdminUsersModule.tsx",
    ]) {
      const src = code(rel);
      assert.doesNotMatch(src, /localStorage|sessionStorage/);
      assert.doesNotMatch(src, /\?password=|&password=/);
    }
  });

  it("o formulário usa autocomplete correto e permite gerenciador de senhas", () => {
    const page = read("src/components/security/PasswordChangePage.tsx");
    assert.match(page, /autoComplete="current-password"/);
    assert.match(page, /autoComplete="new-password"/);
    // Nada de bloquear colar.
    assert.doesNotMatch(page, /onPaste/);
    assert.match(page, /Mostrar senha|Ocultar senha/);
  });

  it("o erro é tratado por CÓDIGO, não por texto da mensagem", () => {
    const client = read("src/lib/auth/passwordLifecycleClient.ts");
    assert.match(client, /switch \(code\)/);
    const page = read("src/components/security/PasswordChangePage.tsx");
    assert.match(page, /err instanceof HttpError \? err\.code : undefined/);
    assert.doesNotMatch(page, /message\.includes\(/);
  });

  it("o reset do admin não pede senha digitada e mostra a temporária uma vez", () => {
    const admin = read("src/components/AdminUsersModule.tsx");
    assert.match(admin, /requestAdminResetPassword\(selectedId\)/);
    assert.match(admin, /authUser\?\.role === "SUPER_ADMIN"/);
    assert.match(admin, /setResetTemporaryPassword\(null\)/);
    assert.match(admin, /Esta senha será exibida somente agora/);
    // O modal antigo pedia a senha ao administrador; não pode mais existir.
    assert.doesNotMatch(admin, /placeholder="Nova senha"/);
    assert.doesNotMatch(admin, /placeholder="Confirmar senha"/);
  });

  it("não existe UI de validade/expiração de senha", () => {
    for (const rel of [
      "src/components/security/PasswordChangePage.tsx",
      "src/components/AdminUsersModule.tsx",
    ]) {
      const src = read(rel);
      assert.doesNotMatch(src, /validade da senha|expira em|dias para expirar/i);
    }
    // E a tela informa explicitamente que não expira.
    assert.match(
      read("src/components/security/PasswordChangePage.tsx"),
      /não expira por tempo/
    );
  });
});
