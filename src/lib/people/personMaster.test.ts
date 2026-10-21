import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decidePersonStatusChange, maskedIdentityDiff, validatePersonIdentityInput } from "./personMaster.ts";

describe("validatePersonIdentityInput — Person é dona dos dados de identidade", () => {
  it("criação exige nome; normaliza CPF com checksum, e-mails e telefone", () => {
    const out = validatePersonIdentityInput({ displayName: "  Ana Souza ", cpf: "529.982.247-25", corporateEmail: " ANA@Empresa.com ", personalEmail: "", phone: "(11) 98888-7777", socialName: " " }, { partial: false });
    assert.equal(out.displayName, "Ana Souza");
    assert.equal(out.cpf, "52998224725");
    assert.equal(out.corporateEmail, "ana@empresa.com");
    assert.equal(out.personalEmail, null);
    assert.equal(out.socialName, null);
    assert.equal(out.phone, "11988887777");
  });

  it("nome vazio na criação → NAME_REQUIRED; na edição parcial o nome pode ficar de fora", () => {
    assert.throws(() => validatePersonIdentityInput({ displayName: "" }, { partial: false }), (e: { code: string }) => e.code === "NAME_REQUIRED");
    assert.deepEqual(validatePersonIdentityInput({ socialName: "Aninha" }, { partial: true }), { socialName: "Aninha" });
    assert.throws(() => validatePersonIdentityInput({ displayName: "   " }, { partial: true }), (e: { code: string }) => e.code === "NAME_REQUIRED");
  });

  it("CPF nunca é zerado em silêncio: tamanho errado ou checksum inválido → INVALID_CPF", () => {
    assert.throws(() => validatePersonIdentityInput({ displayName: "X", cpf: "1234567" }, { partial: false }), (e: { code: string }) => e.code === "INVALID_CPF");
    assert.throws(() => validatePersonIdentityInput({ displayName: "X", cpf: "111.111.111-11" }, { partial: false }), (e: { code: string }) => e.code === "INVALID_CPF");
    assert.equal(validatePersonIdentityInput({ cpf: "" }, { partial: true }).cpf, null, "vazio explícito apaga");
    assert.equal(validatePersonIdentityInput({ cpf: null }, { partial: true }).cpf, null);
  });

  it("e-mail inválido → INVALID_EMAIL; campos ausentes não entram no patch", () => {
    assert.throws(() => validatePersonIdentityInput({ corporateEmail: "sem-arroba" }, { partial: true }), (e: { code: string }) => e.code === "INVALID_EMAIL");
    const out = validatePersonIdentityInput({ displayName: "X" }, { partial: true });
    assert.deepEqual(Object.keys(out), ["displayName"]);
  });
});

describe("decidePersonStatusChange — inativar nunca desliga ninguém", () => {
  const none = { activeUsers: 0, activeEmployees: 0, activeDrivers: 0 };
  it("ACTIVE → INACTIVE só sem vínculos ativos", () => {
    assert.deepEqual(decidePersonStatusChange({ currentStatus: "ACTIVE", nextStatus: "inactive", activeLinks: none }), { ok: true, from: "ACTIVE", to: "INACTIVE" });
    const r = decidePersonStatusChange({ currentStatus: "ACTIVE", nextStatus: "INACTIVE", activeLinks: { activeUsers: 1, activeEmployees: 1, activeDrivers: 0 } });
    assert.equal(r.ok, false);
    assert.equal("code" in r ? r.code : null, "PERSON_HAS_ACTIVE_LINKS");
    assert.equal("details" in r ? r.details?.length : 0, 2);
  });
  it("INACTIVE → ACTIVE é sempre explícito; MERGED nunca muda; mesmo status recusado; valor inválido 400", () => {
    assert.equal(decidePersonStatusChange({ currentStatus: "INACTIVE", nextStatus: "ACTIVE", activeLinks: { activeUsers: 2, activeEmployees: 1, activeDrivers: 1 } }).ok, true);
    const merged = decidePersonStatusChange({ currentStatus: "MERGED", nextStatus: "ACTIVE", activeLinks: none });
    assert.equal("code" in merged ? merged.code : null, "PERSON_MERGED");
    const same = decidePersonStatusChange({ currentStatus: "ACTIVE", nextStatus: "ACTIVE", activeLinks: none });
    assert.equal("code" in same ? same.code : null, "SAME_STATUS");
    const bad = decidePersonStatusChange({ currentStatus: "ACTIVE", nextStatus: "DELETED", activeLinks: none });
    assert.equal("code" in bad ? bad.status : 0, 400);
  });
});

describe("maskedIdentityDiff — snapshot do evento sem PII em claro", () => {
  it("lista só os campos alterados, com CPF/e-mail/telefone mascarados", () => {
    const before = { displayName: "Ana", socialName: null, corporateEmail: "ana@x.com", personalEmail: null, cpfNormalized: "52998224725", phoneNormalized: "11988887777" };
    const after = { ...before, displayName: "Ana Souza", corporateEmail: "ana.souza@x.com", cpfNormalized: "11144477735" };
    const d = maskedIdentityDiff(before, after);
    assert.deepEqual(d.changed, ["displayName", "corporateEmail", "cpfNormalized"]);
    assert.equal(d.before.cpfNormalized, "***.***.247-25");
    assert.equal(d.after.cpfNormalized, "***.***.777-35");
    assert.equal(d.before.corporateEmail, "a***@x.com");
    assert.ok(!JSON.stringify(d).includes("52998224725"));
    assert.ok(!JSON.stringify(d).includes("ana@x.com"));
  });
});
