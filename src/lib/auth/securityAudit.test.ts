/**
 * Auditoria de segurança — o que entra e, principalmente, o que NUNCA entra.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { SecurityAuditDb } from "./securityAudit.server.js";
import {
  SECURITY_AUDIT_EVENTS,
  isForbiddenAuditMetadataKey,
  isLoopbackOrUnspecifiedAddress,
  normalizeUserAgent,
  resolveAuditIpAddress,
  sanitizeSecurityAuditMetadata,
  writeSecurityAuditLog,
} from "./securityAudit.server.js";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

describe("eventos", () => {
  it("cobre os eventos mínimos exigidos", () => {
    assert.deepEqual(Object.keys(SECURITY_AUDIT_EVENTS).sort(), [
      "PASSWORD_CHANGED",
      "PASSWORD_FORCED_CHANGE_COMPLETED",
      "PASSWORD_RESET_BY_SUPER_ADMIN",
      "USER_INITIAL_PASSWORD_ASSIGNED",
    ]);
  });
});

describe("sanitização do metadata", () => {
  it("mantém metadados legítimos", () => {
    assert.deepEqual(
      sanitizeSecurityAuditMetadata({ source: "SELF_SERVICE", sessionsRevoked: 2 }),
      { source: "SELF_SERVICE", sessionsRevoked: 2 }
    );
  });

  it("descarta qualquer chave que cheire a segredo", () => {
    const sujo = {
      source: "ADMIN_RESET",
      password: "nao pode ir",
      newPassword: "nao pode ir",
      temporaryPassword: "nao pode ir",
      passwordHash: "scrypt:v1:...",
      senhaAntiga: "nao pode ir",
      tokenHash: "abc",
      sessionToken: "abc",
      salt: "abc",
      apiSecret: "abc",
      credentialBlob: "abc",
    };
    const limpo = sanitizeSecurityAuditMetadata(sujo);
    assert.deepEqual(limpo, { source: "ADMIN_RESET" });
    const dump = JSON.stringify(limpo);
    assert.equal(dump.includes("nao pode ir"), false);
  });

  it("reconhece as chaves proibidas por fragmento, sem enumerar variações", () => {
    for (const key of [
      "password",
      "NewPassword",
      "temporary_password",
      "passwordHash",
      "tokenHash",
      "refresh_token",
      "SALT",
      "clientSecret",
      "credential",
      "senha",
    ]) {
      assert.equal(isForbiddenAuditMetadataKey(key), true, `${key} deveria ser proibida`);
    }
    for (const key of ["source", "sessionsRevoked", "reason", "count"]) {
      assert.equal(isForbiddenAuditMetadataKey(key), false, `${key} é legítima`);
    }
  });

  it("aceita só escalares — objeto aninhado não pode esconder segredo em profundidade", () => {
    const limpo = sanitizeSecurityAuditMetadata({
      source: "SELF_SERVICE",
      aninhado: { password: "escondida" },
      lista: ["a", "b"],
      flag: true,
    });
    assert.deepEqual(limpo, { source: "SELF_SERVICE", flag: true });
  });

  it("metadata vazio ou totalmente filtrado vira null", () => {
    assert.equal(sanitizeSecurityAuditMetadata(null), null);
    assert.equal(sanitizeSecurityAuditMetadata({}), null);
    assert.equal(sanitizeSecurityAuditMetadata({ password: "x" }), null);
  });
});

describe("origem da requisição", () => {
  it("peer real de cliente é registrado e truncado", () => {
    assert.equal(resolveAuditIpAddress("192.168.0.10"), "192.168.0.10");
    assert.equal(resolveAuditIpAddress("203.0.113.7"), "203.0.113.7");
    assert.equal(resolveAuditIpAddress(undefined), null);
    assert.equal(resolveAuditIpAddress("   "), null);
    assert.equal(String(resolveAuditIpAddress("x".repeat(500))).length, 64);
  });

  it("peer de loopback vira null — atrás do proxy não é o IP do usuário", () => {
    // Nginx faz proxy_pass para 127.0.0.1:3000/3001 (ver
    // docs/stock-collector-secure-ingress.md), então o peer é o próprio host.
    // Gravar isso numa coluna "ipAddress" faria a auditoria mentir.
    for (const peer of ["127.0.0.1", "::ffff:127.0.0.1", "::1", "0.0.0.0", "::", "127.0.0.53"]) {
      assert.equal(resolveAuditIpAddress(peer), null, `${peer} deveria virar null`);
    }
  });

  it("normaliza IPv4 mapeado em IPv6 (dual-stack do Node)", () => {
    assert.equal(resolveAuditIpAddress("::ffff:192.168.100.5"), "192.168.100.5");
  });

  it("faixa privada NÃO é descartada: na LAN é o endereço real de quem acessou", () => {
    assert.equal(isLoopbackOrUnspecifiedAddress("192.168.100.5"), false);
    assert.equal(isLoopbackOrUnspecifiedAddress("10.0.0.9"), false);
    assert.equal(isLoopbackOrUnspecifiedAddress("127.0.0.1"), true);
    assert.equal(isLoopbackOrUnspecifiedAddress("::1"), true);
  });

  it("continua sem ler qualquer header de proxy", () => {
    const src = read("src/lib/auth/securityAudit.server.ts")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(src.toLowerCase(), /x-forwarded-for|cf-connecting-ip|x-real-ip|trust proxy/);
    assert.doesNotMatch(src, /req\.headers|request\.headers/);
  });

  it("User-Agent é truncado", () => {
    assert.equal(normalizeUserAgent(undefined), null);
    assert.equal(normalizeUserAgent("  "), null);
    assert.equal(String(normalizeUserAgent("u".repeat(9999))).length, 512);
  });
});

describe("escrita", () => {
  it("passa pelo sanitizador antes de persistir", async () => {
    const gravados: Record<string, unknown>[] = [];
    // Duplo mínimo: implementa apenas o create que a função chama. O cast
    // existe porque SecurityAuditDb é uma fatia do cliente Prisma gerado —
    // é escopo de teste, não silenciamento de erro em produção.
    const db = {
      securityAuditLog: {
        create: async (args: { data: Record<string, unknown> }) => {
          gravados.push(args.data);
          return {};
        },
      },
    } as unknown as SecurityAuditDb;
    await writeSecurityAuditLog(db, {
      eventType: SECURITY_AUDIT_EVENTS.PASSWORD_RESET_BY_SUPER_ADMIN,
      actorUserId: "super-1",
      targetUserId: "user-1",
      metadata: { source: "ADMIN_RESET", temporaryPassword: "vazamento" },
    });
    assert.equal(gravados.length, 1);
    assert.deepEqual(gravados[0].metadata, { source: "ADMIN_RESET" });
    assert.equal(JSON.stringify(gravados[0]).includes("vazamento"), false);
  });
});

describe("separação de domínio", () => {
  it("não reaproveita a tabela de auditoria de ACL", () => {
    // O comentário do módulo CITA PermissionAuditLog para explicar a decisão;
    // o que não pode existir é escrita nela.
    const src = read("src/lib/auth/securityAudit.server.ts");
    assert.doesNotMatch(src, /permissionAuditLog\s*[.:]/i);
    assert.doesNotMatch(src, /db\.permissionAuditLog/i);
    // E a tabela nova é aditiva: PermissionAuditLog segue existindo intacta.
    const schema = read("prisma/schema.prisma");
    assert.match(schema, /model PermissionAuditLog \{/);
    assert.match(schema, /model SecurityAuditLog \{/);
  });

  it("o modelo novo não tem coluna para senha, hash, salt ou token", () => {
    const schema = read("prisma/schema.prisma");
    const model = schema.slice(
      schema.indexOf("model SecurityAuditLog {"),
      schema.indexOf("model SecurityAuditLog {") + 1200
    );
    const bloco = model.slice(0, model.indexOf("\n}"));
    assert.doesNotMatch(bloco, /password|hash|salt|token|secret/i);
  });
});
