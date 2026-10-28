import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { decideDemoQuery, decideLiveQuery, readRoleFileFromDisk, type RoleFileReader } from "./environmentGate.js";

const noFile: RoleFileReader = () => null;
const productionFile: RoleFileReader = () => "production\n";
const homologFile: RoleFileReader = () => "homologation";

const fullProduction: NodeJS.ProcessEnv = {
  INDUSCOST_OPERATIONAL_ROLE: "production",
  NODE_ENV: "production",
  LIKE_SERASA_LIVE_ENABLED: "1",
  LIKE_SERASA_DIRECT_DATA_TOKEN: "token-real",
};

describe("gate de ambiente da consulta real LIKE SERASA (fail-closed)", () => {
  const dir = mkdtempSync(join(tmpdir(), "like-serasa-gate-"));
  after(() => rmSync(dir, { recursive: true, force: true }));

  it("desenvolvimento sem token: bloqueado (papel não declarado)", () => {
    const decision = decideLiveQuery({ NODE_ENV: "development" }, noFile);
    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, "ROLE_UNDECLARED");
  });

  it("desenvolvimento com token configurado por engano: continua bloqueado", () => {
    const decision = decideLiveQuery({ NODE_ENV: "development", LIKE_SERASA_DIRECT_DATA_TOKEN: "x", LIKE_SERASA_LIVE_ENABLED: "1" }, noFile);
    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, "ROLE_UNDECLARED");
  });

  it("homologação com token presente: bloqueado pelo papel declarado", () => {
    const decision = decideLiveQuery(
      { INDUSCOST_OPERATIONAL_ROLE: "homologation", NODE_ENV: "production", LIKE_SERASA_LIVE_ENABLED: "1", LIKE_SERASA_DIRECT_DATA_TOKEN: "x" },
      productionFile
    );
    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, "ROLE_NOT_PRODUCTION");
  });

  it("homologação com NODE_ENV=production e tudo habilitado, mas sem atestação do servidor: bloqueado", () => {
    const decision = decideLiveQuery(fullProduction, noFile);
    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, "ATTESTATION_MISSING");
  });

  it("papel declarado production com atestação de homologação no servidor: bloqueado (divergência)", () => {
    const decision = decideLiveQuery(fullProduction, homologFile);
    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, "ATTESTATION_MISMATCH");
  });

  it("ambiente desconhecido (papel inválido): bloqueado", () => {
    const decision = decideLiveQuery({ ...fullProduction, INDUSCOST_OPERATIONAL_ROLE: "staging" }, productionFile);
    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, "ROLE_NOT_PRODUCTION");
  });

  it("produção atestada com a funcionalidade desabilitada: bloqueado", () => {
    const decision = decideLiveQuery({ ...fullProduction, LIKE_SERASA_LIVE_ENABLED: "0" }, productionFile);
    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, "FEATURE_DISABLED");
  });

  it("produção atestada e habilitada, sem token: bloqueado", () => {
    const decision = decideLiveQuery({ ...fullProduction, LIKE_SERASA_DIRECT_DATA_TOKEN: "" }, productionFile);
    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, "TOKEN_MISSING");
  });

  it("produção atestada sem NODE_ENV=production: bloqueado", () => {
    const decision = decideLiveQuery({ ...fullProduction, NODE_ENV: "development" }, productionFile);
    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, "NODE_ENV_NOT_PRODUCTION");
  });

  it("produção: papel declarado + atestação do servidor + NODE_ENV + habilitação + token = permitido", () => {
    const decision = decideLiveQuery(fullProduction, productionFile);
    assert.equal(decision.allowed, true);
    assert.equal(decision.reason, "OK");
  });

  it("a atestação vem de um arquivo do servidor (fora do Git): ausente, vazio ou ilegível = bloqueado", () => {
    const file = join(dir, "operational-role");
    assert.equal(readRoleFileFromDisk(file), null);
    writeFileSync(file, "   \n");
    assert.equal(readRoleFileFromDisk(file), null);
    writeFileSync(file, "production\n");
    assert.equal(readRoleFileFromDisk(file), "production");
    const env = { ...fullProduction, INDUSCOST_OPERATIONAL_ROLE_FILE: file };
    assert.equal(decideLiveQuery(env).allowed, true);
    writeFileSync(file, "homologation\n");
    assert.equal(decideLiveQuery(env).reason, "ATTESTATION_MISMATCH");
  });

  it("demonstração: só com LIKE_SERASA_DEMO_ENABLED e nunca quando o papel ou a atestação for production", () => {
    assert.deepEqual(decideDemoQuery({ NODE_ENV: "development" }, noFile), { allowed: false, reason: "DEMO_DISABLED" });
    assert.deepEqual(decideDemoQuery({ LIKE_SERASA_DEMO_ENABLED: "1" }, noFile), { allowed: true, reason: "OK" });
    assert.deepEqual(decideDemoQuery({ LIKE_SERASA_DEMO_ENABLED: "1", INDUSCOST_OPERATIONAL_ROLE: "homologation" }, noFile), { allowed: true, reason: "OK" });
    assert.deepEqual(decideDemoQuery({ LIKE_SERASA_DEMO_ENABLED: "1", INDUSCOST_OPERATIONAL_ROLE: "production" }, noFile), { allowed: false, reason: "PRODUCTION_ROLE" });
    assert.deepEqual(decideDemoQuery({ LIKE_SERASA_DEMO_ENABLED: "1" }, productionFile), { allowed: false, reason: "PRODUCTION_ROLE" });
  });
});
