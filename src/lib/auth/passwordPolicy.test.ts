/**
 * Política central de senha — comprimento e NADA de composição obrigatória.
 * Senhas destes testes são fictícias e existem só aqui.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  describePasswordPolicy,
  firstPasswordPolicyReason,
  validatePasswordPolicy,
} from "./passwordPolicy.js";
import {
  APP_PASSWORD_MIN_LENGTH,
  validatePasswordMin,
} from "./appAuth.shared.js";

describe("passwordPolicy — comprimento", () => {
  it("rejeita menos de 12 caracteres", () => {
    const r = validatePasswordPolicy("a".repeat(PASSWORD_MIN_LENGTH - 1));
    assert.equal(r.valid, false);
    assert.deepEqual(r.codes, ["TOO_SHORT"]);
  });

  it("aceita exatamente 12 caracteres", () => {
    assert.equal(validatePasswordPolicy("a".repeat(PASSWORD_MIN_LENGTH)).valid, true);
  });

  it("aceita 12+ caracteres", () => {
    assert.equal(validatePasswordPolicy("a".repeat(40)).valid, true);
  });

  it("aceita exatamente 128 caracteres", () => {
    assert.equal(validatePasswordPolicy("x".repeat(PASSWORD_MAX_LENGTH)).valid, true);
  });

  it("rejeita acima de 128 caracteres", () => {
    const r = validatePasswordPolicy("x".repeat(PASSWORD_MAX_LENGTH + 1));
    assert.equal(r.valid, false);
    assert.deepEqual(r.codes, ["TOO_LONG"]);
  });

  it("NÃO trunca silenciosamente: acima do máximo é erro, não corte", () => {
    const tooLong = "y".repeat(PASSWORD_MAX_LENGTH + 50);
    const r = validatePasswordPolicy(tooLong);
    assert.equal(r.valid, false);
    // a política não devolve senha nem versão "ajustada" — só o veredito
    assert.equal(Object.prototype.hasOwnProperty.call(r, "password"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(r, "value"), false);
  });

  it("rejeita string vazia e valor não-string", () => {
    assert.deepEqual(validatePasswordPolicy("").codes, ["NOT_A_STRING"]);
    assert.deepEqual(validatePasswordPolicy(undefined).codes, ["NOT_A_STRING"]);
    assert.deepEqual(validatePasswordPolicy(12345678901234).codes, ["NOT_A_STRING"]);
  });
});

describe("passwordPolicy — sem composição obrigatória", () => {
  it("aceita passphrase com espaços", () => {
    assert.equal(validatePasswordPolicy("cavalo bateria grampo azul").valid, true);
  });

  it("aceita caracteres especiais e acentos", () => {
    assert.equal(validatePasswordPolicy("çãõ#@!$%&*()__+áé").valid, true);
  });

  it("NÃO exige maiúscula", () => {
    assert.equal(validatePasswordPolicy("somente minusculas").valid, true);
  });

  it("NÃO exige número", () => {
    assert.equal(validatePasswordPolicy("sem numero aqui").valid, true);
  });

  it("NÃO exige símbolo", () => {
    assert.equal(validatePasswordPolicy("senha sem simbolo").valid, true);
  });

  it("aceita Unicode fora do BMP contando unidades UTF-16", () => {
    // 7 emojis = 14 unidades UTF-16 → passa dos 12 exigidos
    assert.equal(validatePasswordPolicy("🙂".repeat(7)).valid, true);
    assert.equal(validatePasswordPolicy("🙂".repeat(5)).valid, false);
  });
});

describe("passwordPolicy — fonte única", () => {
  it("validatePasswordMin (rota legada) delega para a política central", () => {
    assert.equal(validatePasswordMin("a".repeat(PASSWORD_MIN_LENGTH)), null);
    assert.notEqual(validatePasswordMin("a".repeat(PASSWORD_MIN_LENGTH - 1)), null);
    // o legado passou a herdar TAMBÉM o teto
    assert.notEqual(validatePasswordMin("a".repeat(PASSWORD_MAX_LENGTH + 1)), null);
  });

  it("APP_PASSWORD_MIN_LENGTH não é um segundo número", () => {
    assert.equal(APP_PASSWORD_MIN_LENGTH, PASSWORD_MIN_LENGTH);
    assert.equal(PASSWORD_MIN_LENGTH, 12);
  });

  it("firstPasswordPolicyReason devolve a primeira razão em pt-BR", () => {
    assert.match(String(firstPasswordPolicyReason("curta")), /no mínimo 12/);
    assert.equal(firstPasswordPolicyReason("senha bem grande"), null);
  });

  it("o texto de ajuda avisa que a senha NÃO expira", () => {
    assert.match(describePasswordPolicy(), /não expira/i);
  });
});

describe("passwordPolicy — ausência de expiração periódica", () => {
  it("o módulo não expõe nenhum conceito de validade/rotação por tempo", async () => {
    const mod = (await import("./passwordPolicy.js")) as Record<string, unknown>;
    const proibidos = [
      "passwordExpiresAt",
      "passwordExpirationDays",
      "passwordValidUntil",
      "passwordMaxAge",
      "mustChangePasswordEveryXDays",
      "lastPasswordReminderAt",
      "passwordRotationInterval",
    ];
    for (const nome of proibidos) {
      assert.equal(nome in mod, false, `${nome} não pode existir`);
    }
  });
});
