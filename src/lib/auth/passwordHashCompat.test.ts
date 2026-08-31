/**
 * Compatibilidade do hash de senha — scrypt:v1 PERMANECE.
 *
 * Esta missão NÃO migra algoritmo. O teste existe para provar que nenhum
 * usuário existente perde acesso: hashes gravados antes da feature continuam
 * verificando, o formato persistido não mudou e não há segunda implementação
 * de scrypt no repositório.
 *
 * Senhas aqui são fictícias.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { hashPassword, verifyPassword } from "./appAuth.server.js";
import { generateTemporaryPassword } from "./passwordLifecycle.server.js";
import { validatePasswordPolicy } from "./passwordPolicy.js";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/**
 * Fixture CONGELADO no formato scrypt:v1 (salt de 16 bytes, keylen 64) — é o
 * mesmo formato que já está gravado em AppUser.passwordHash em produção.
 * Trocar algoritmo, salt length ou keylen faz este teste falhar ANTES de
 * qualquer usuário real perder o login.
 *
 * A senha correspondente é fictícia e existe apenas neste arquivo.
 */
const LEGACY_PASSWORD = "senha antiga do usuario";
const LEGACY_HASH =
  "scrypt:v1:SW5kdXNDb3N0Rml4dHVyZQ==:" +
  "/dxRftw1SsDNbSqUEb/ljmj2y2RG57BUA0iXrnVsLpBiTwHo0O6Jimpm/7d6jfATus5OAvsyuKGRBb8BJtHdzw==";

describe("hash — compatibilidade com o que já está no banco", () => {
  it("hash EXISTENTE (fixture scrypt:v1) continua verificando", async () => {
    assert.equal(await verifyPassword(LEGACY_PASSWORD, LEGACY_HASH), true);
  });

  it("hash existente rejeita a senha errada", async () => {
    assert.equal(await verifyPassword("senha errada aqui", LEGACY_HASH), false);
  });

  it("um hash gerado hoje verifica com a senha correta", async () => {
    const stored = await hashPassword(LEGACY_PASSWORD);
    assert.equal(await verifyPassword(LEGACY_PASSWORD, stored), true);
  });

  it("senha incorreta falha", async () => {
    const stored = await hashPassword(LEGACY_PASSWORD);
    assert.equal(await verifyPassword("senha errada aqui", stored), false);
  });

  it("o formato persistido continua scrypt:v1:<salt b64>:<derivado b64>", async () => {
    const stored = await hashPassword("uma senha qualquer");
    const parts = stored.split(":");
    assert.equal(parts.length, 4);
    assert.equal(parts[0], "scrypt");
    assert.equal(parts[1], "v1");
    assert.equal(Buffer.from(parts[2], "base64").length, 16, "salt de 16 bytes");
    assert.equal(Buffer.from(parts[3], "base64").length, 64, "derivado de 64 bytes");
  });

  it("o salt é aleatório: a mesma senha gera hashes diferentes", async () => {
    const a = await hashPassword("mesma senha aqui");
    const b = await hashPassword("mesma senha aqui");
    assert.notEqual(a, b);
    assert.equal(await verifyPassword("mesma senha aqui", a), true);
    assert.equal(await verifyPassword("mesma senha aqui", b), true);
  });

  it("hash malformado ou de outro algoritmo é rejeitado sem lançar", async () => {
    assert.equal(await verifyPassword("qualquer coisa", "argon2id$v=19$..."), false);
    assert.equal(await verifyPassword("qualquer coisa", "scrypt:v2:aa:bb"), false);
    assert.equal(await verifyPassword("qualquer coisa", ""), false);
  });

  it("NENHUM plaintext aparece no valor persistido", async () => {
    const password = "frase secreta do teste";
    const stored = await hashPassword(password);
    assert.equal(stored.includes(password), false);
    assert.equal(stored.includes("secreta"), false);
  });
});

describe("hash — nenhuma segunda implementação foi criada", () => {
  it("apenas appAuth.server.ts implementa scrypt para senha", () => {
    const server = read("src/lib/auth/appAuth.server.ts");
    assert.match(server, /promisify\(crypto\.scrypt\)/);

    // Os módulos novos consomem os helpers canônicos, não recriam crypto.scrypt.
    for (const rel of [
      "src/lib/auth/passwordLifecycle.server.ts",
      "src/lib/auth/passwordLifecycleRoutes.ts",
      "src/lib/auth/passwordPolicy.ts",
    ]) {
      assert.doesNotMatch(read(rel), /crypto\.scrypt/, `${rel} não pode reimplementar scrypt`);
    }
    assert.match(
      read("src/lib/auth/passwordLifecycle.server.ts"),
      /hashPassword as canonicalHashPassword/
    );
  });

  it("a feature não introduz Argon2/bcrypt nem rehash em massa", () => {
    const lifecycle = read("src/lib/auth/passwordLifecycle.server.ts");
    assert.doesNotMatch(lifecycle, /argon2|bcrypt/i);
    assert.doesNotMatch(lifecycle, /updateMany[\s\S]{0,200}passwordHash:\s*newPasswordHash[\s\S]{0,80}\}\s*,\s*where:\s*\{\s*\}/);
  });
});

describe("senha temporária gerada pelo sistema", () => {
  it("respeita a política central", () => {
    for (let i = 0; i < 25; i += 1) {
      assert.equal(validatePasswordPolicy(generateTemporaryPassword()).valid, true);
    }
  });

  it("é base64url (seguro para copiar/colar) e não se repete", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      const p = generateTemporaryPassword();
      assert.match(p, /^[A-Za-z0-9_-]+$/);
      assert.equal(seen.has(p), false, "senha temporária não pode repetir");
      seen.add(p);
    }
  });

  it("verifica corretamente contra o hash canônico", async () => {
    const temp = generateTemporaryPassword();
    const stored = await hashPassword(temp);
    assert.equal(await verifyPassword(temp, stored), true);
    assert.equal(await verifyPassword(`${temp}x`, stored), false);
  });
});
