import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyEvaluatorIdentity, isEvaluatorUsable } from "./evaluatorIdentity.ts";

const E = "employee-1";
const P = "person-1";
const active = { id: P, status: "ACTIVE", employeeIds: [E] };

describe("classifyEvaluatorIdentity — identidade operacional = conta ativa ligada ao colaborador", () => {
  it("caso 1: conta ativa com employeeId → LINKED (único estado utilizável)", () => {
    const r = classifyEvaluatorIdentity({ employeeId: E, employee: { id: E, personId: P }, directAccount: { id: "u1", isActive: true }, person: active, personAccount: { id: "u1", isActive: true, employeeId: E } });
    assert.equal(r.status, "LINKED");
    assert.equal(isEvaluatorUsable(r), true);
  });

  it("caso 2 (conta legada): conta ativa da mesma Pessoa sem employeeId → ACCOUNT_NOT_LINKED, NÃO utilizável até regularizar", () => {
    const r = classifyEvaluatorIdentity({ employeeId: E, employee: { id: E, personId: P }, directAccount: null, person: active, personAccount: { id: "u-sa", isActive: true, employeeId: null } });
    assert.deepEqual([r.status, r.accountId, r.personId], ["ACCOUNT_NOT_LINKED", "u-sa", P]);
    assert.equal(isEvaluatorUsable(r), false, "identidade canônica coincidente não concede acesso");
  });

  it("caso 3: conta inativa (ligada ou da Pessoa) → ACCOUNT_INACTIVE", () => {
    assert.equal(classifyEvaluatorIdentity({ employeeId: E, employee: { id: E, personId: P }, directAccount: { id: "u1", isActive: false }, person: active, personAccount: null }).status, "ACCOUNT_INACTIVE");
    assert.equal(classifyEvaluatorIdentity({ employeeId: E, employee: { id: E, personId: P }, directAccount: null, person: active, personAccount: { id: "u1", isActive: false, employeeId: null } }).status, "ACCOUNT_INACTIVE");
  });

  it("caso 4: sem conta (com ou sem Pessoa) → NO_ACCOUNT; nunca cria conta", () => {
    assert.equal(classifyEvaluatorIdentity({ employeeId: E, employee: { id: E, personId: P }, directAccount: null, person: active, personAccount: null }).status, "NO_ACCOUNT");
    assert.equal(classifyEvaluatorIdentity({ employeeId: E, employee: { id: E, personId: null }, directAccount: null, person: null, personAccount: null }).status, "NO_ACCOUNT");
    assert.equal(classifyEvaluatorIdentity({ employeeId: E, employee: null, directAccount: null, person: null, personAccount: null }).status, "NO_ACCOUNT");
  });

  it("caso 5: conta da Pessoa ligada a outro colaborador, ou Pessoa com dois colaboradores → IDENTITY_CONFLICT (sem escolha arbitrária)", () => {
    assert.equal(classifyEvaluatorIdentity({ employeeId: E, employee: { id: E, personId: P }, directAccount: null, person: active, personAccount: { id: "u1", isActive: true, employeeId: "outro" } }).status, "IDENTITY_CONFLICT");
    assert.equal(classifyEvaluatorIdentity({ employeeId: E, employee: { id: E, personId: P }, directAccount: null, person: { ...active, employeeIds: [E, "e2"] }, personAccount: { id: "u1", isActive: true, employeeId: null } }).status, "IDENTITY_CONFLICT");
  });

  it("caso 6: Pessoa MERGED ou INACTIVE → PERSON_NOT_ACTIVE (nenhum vínculo novo para Pessoa unificada)", () => {
    for (const status of ["MERGED", "INACTIVE", "NEEDS_REVIEW"]) {
      const r = classifyEvaluatorIdentity({ employeeId: E, employee: { id: E, personId: P }, directAccount: null, person: { ...active, status }, personAccount: { id: "u1", isActive: true, employeeId: null } });
      assert.equal(r.status, "PERSON_NOT_ACTIVE", status);
    }
  });

  it("vínculo direto prevalece sobre a Pessoa (conta ligada continua funcionando mesmo com legado na Pessoa)", () => {
    const r = classifyEvaluatorIdentity({ employeeId: E, employee: { id: E, personId: P }, directAccount: { id: "u1", isActive: true }, person: { ...active, status: "INACTIVE" }, personAccount: null });
    assert.equal(r.status, "LINKED");
  });
});

describe("uma só identidade operacional no servidor (guarda de fonte)", () => {
  it("loadScope lê authUser.employeeId e a prontidão usa o resolvedor que exige conta ativa ligada; nenhuma escrita no caminho", async () => {
    const { readFileSync } = await import("node:fs");
    const server = readFileSync("server.ts", "utf8");
    const scope = server.slice(server.indexOf("    loadScope: async (req) => {"), server.indexOf("    loadEmployees: async (ids) => {", server.indexOf("    loadScope: async (req) => {")));
    assert.match(scope, /const actorEmployeeId = \(authUser as \{ employeeId\?: string \| null \} \| null\)\?\.employeeId \?\? null;/);
    assert.doesNotMatch(scope, /personId/, "Minha equipe não usa identidade canônica como autorização");
    assert.match(server, /loadLinkedEmployeeIds: \(employeeIds\) => loadLinkedEvaluatorIds\(prisma, employeeIds\)/);
    assert.match(server, /loadEvaluatorIdentities: \(employeeIds\) => loadEvaluatorIdentities\(prisma, employeeIds\)/);
    const loader = readFileSync("src/lib/hrPerformance/evaluatorIdentity.server.ts", "utf8");
    assert.doesNotMatch(loader, /\.(update|updateMany|create|upsert|delete)\(/, "o resolvedor é somente leitura");
  });
});
