import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { ACCOUNT_IDENTITY_WRITERS, employeePersonChangeDenial, evaluateAccountIdentityChange, hasConfirmedAccountIdentity } from "./accountIdentityLinkPolicy.ts";

const OWN = "actor";
const OTHER = "u-other";
const actors = {
  comum: { id: OWN, role: "VIEWER", elevated: false },
  rh: { id: OWN, role: "VIEWER", elevated: false },
  rhComElevacaoForjada: { id: OWN, role: "VIEWER", elevated: true },
  admin: { id: OWN, role: "ADMIN", elevated: false },
  adminElevado: { id: OWN, role: "ADMIN", elevated: true },
  superAdmin: { id: OWN, role: "SUPER_ADMIN", elevated: false },
  superAdminElevado: { id: OWN, role: "SUPER_ADMIN", elevated: true },
};
const codeOf = (r: ReturnType<typeof evaluateAccountIdentityChange>) => ("code" in r ? r.code : "OK");

describe("evaluateAccountIdentityChange — política única de identidade de conta", () => {
  it("a própria conta: só SUPER_ADMIN com step-up; os demais recebem SELF_LINK_FORBIDDEN (elevação de não-SA não conta)", () => {
    const own = (role: string) => ({ id: OWN, role });
    assert.equal(codeOf(evaluateAccountIdentityChange({ actor: actors.rh, account: own("VIEWER") })), "SELF_LINK_FORBIDDEN");
    assert.equal(codeOf(evaluateAccountIdentityChange({ actor: actors.rhComElevacaoForjada, account: own("VIEWER") })), "SELF_LINK_FORBIDDEN");
    assert.equal(codeOf(evaluateAccountIdentityChange({ actor: actors.admin, account: own("ADMIN") })), "SELF_LINK_FORBIDDEN");
    assert.equal(codeOf(evaluateAccountIdentityChange({ actor: actors.adminElevado, account: own("ADMIN") })), "SELF_LINK_FORBIDDEN");
    assert.equal(codeOf(evaluateAccountIdentityChange({ actor: actors.superAdmin, account: own("SUPER_ADMIN") })), "ADMIN_ELEVATION_REQUIRED");
    assert.equal(codeOf(evaluateAccountIdentityChange({ actor: actors.superAdminElevado, account: own("SUPER_ADMIN") })), "OK");
  });

  it("conta de outra pessoa: comum/RH/ADMIN regularizam conta comum; conta SUPER_ADMIN só SUPER_ADMIN elevado", () => {
    for (const a of [actors.comum, actors.rh, actors.admin, actors.superAdmin, actors.superAdminElevado]) {
      assert.equal(codeOf(evaluateAccountIdentityChange({ actor: a, account: { id: OTHER, role: "VIEWER" } })), "OK", a.role);
    }
    assert.equal(codeOf(evaluateAccountIdentityChange({ actor: actors.rh, account: { id: OTHER, role: "SUPER_ADMIN" } })), "SUPER_ADMIN_REQUIRED");
    assert.equal(codeOf(evaluateAccountIdentityChange({ actor: actors.adminElevado, account: { id: OTHER, role: "SUPER_ADMIN" } })), "SUPER_ADMIN_REQUIRED");
    assert.equal(codeOf(evaluateAccountIdentityChange({ actor: actors.superAdmin, account: { id: OTHER, role: "SUPER_ADMIN" } })), "ADMIN_ELEVATION_REQUIRED");
    assert.equal(codeOf(evaluateAccountIdentityChange({ actor: actors.superAdminElevado, account: { id: OTHER, role: "SUPER_ADMIN" } })), "OK");
  });

  it("sem ator identificado: recusa para qualquer conta (fail-closed), antes de olhar papel", () => {
    for (const actor of [null, undefined, { id: null, role: "SUPER_ADMIN", elevated: true }, { id: "", role: "ADMIN", elevated: false }]) {
      for (const role of ["VIEWER", "ADMIN", "SUPER_ADMIN"]) {
        assert.equal(codeOf(evaluateAccountIdentityChange({ actor, account: { id: OTHER, role } })), "ACTOR_REQUIRED", `${JSON.stringify(actor)} → ${role}`);
      }
    }
  });

  it("evidência sem prévia: só a mesma Pessoa canônica nos dois lados (e-mail sozinho nunca)", () => {
    assert.equal(hasConfirmedAccountIdentity({ accountPersonId: "p1", employeePersonId: "p1" }), true);
    assert.equal(hasConfirmedAccountIdentity({ accountPersonId: null, employeePersonId: "p1" }), false);
    assert.equal(hasConfirmedAccountIdentity({ accountPersonId: "p1", employeePersonId: null }), false);
    assert.equal(hasConfirmedAccountIdentity({ accountPersonId: null, employeePersonId: null }), false);
    assert.equal(hasConfirmedAccountIdentity({ accountPersonId: "p1", employeePersonId: "p2" }), false);
  });

  it("colaborador entrando na Pessoa de uma conta sem colaborador: permissão efetiva + política (nunca a própria conta)", () => {
    const denial = (actor: Parameters<typeof employeePersonChangeDenial>[0]["actor"], canManageAccountIdentity: boolean, affectedAccount: { id: string; role: string } | null) =>
      employeePersonChangeDenial({ actor, canManageAccountIdentity, affectedAccount })?.code ?? "OK";
    assert.equal(denial(actors.rh, false, null), "OK", "Pessoa sem conta: nada a decidir");
    assert.equal(denial(actors.rh, false, { id: OTHER, role: "VIEWER" }), "ACCOUNT_LINK_PERMISSION_REQUIRED");
    assert.equal(denial(actors.adminElevado, false, { id: OTHER, role: "VIEWER" }), "ACCOUNT_LINK_PERMISSION_REQUIRED", "papel não substitui a permissão efetiva");
    assert.equal(denial(actors.rh, true, { id: OWN, role: "VIEWER" }), "SELF_LINK_FORBIDDEN", "plantar a evidência na própria conta");
    assert.equal(denial(actors.rh, true, { id: OTHER, role: "SUPER_ADMIN" }), "SUPER_ADMIN_REQUIRED");
    assert.equal(denial(null, true, { id: OTHER, role: "VIEWER" }), "ACTOR_REQUIRED");
    assert.equal(denial(actors.rh, true, { id: OTHER, role: "VIEWER" }), "OK");
    assert.equal(denial(actors.superAdminElevado, true, { id: OWN, role: "SUPER_ADMIN" }), "OK");
  });
});

describe("todas as rotas que mudam a identidade de conta usam a mesma política (guarda de fonte)", () => {
  const read = (f: string) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");

  it("Pessoas 360° (regularizar, corrigir, desvincular), cadastro de RH (vincular, desvincular) e propagação E4", () => {
    for (const file of ["src/lib/people/personAccountLink.ts", "src/lib/people/personLinkOps.server.ts", "src/lib/employeeUserLink.server.ts", "src/lib/canonicalPersonSync.server.ts"]) {
      const src = read(file);
      assert.match(src, /accountIdentityLinkPolicy\.js"/, `${file} importa a política única`);
      assert.doesNotMatch(src, /evaluateSuperAdminAccountOperation\(/, `${file} não reimplementa a guarda sozinho`);
    }
    const hr = read("src/lib/employeeUserLink.server.ts");
    assert.equal((hr.match(/assertAccountIdentityChangeAllowed\(opts, \{ id: /g) ?? []).length, 2, "vincular e desvincular checam a conta (id + papel)");
    assert.doesNotMatch(hr, /tx\.appUser\.update\(/, "gravação só por comparação-e-troca (updateMany)");
    const ops = read("src/lib/people/personLinkOps.server.ts");
    assert.equal((ops.match(/assertAccountOperationAllowed\(input\.actor, \{ id: entity\.id, role: entity\.role \}, input\.canManageAccountIdentity\)/g) ?? []).length, 2, "corrigir e desvincular conta exigem a permissão efetiva");
    assert.match(ops, /if \(kind === "employee"\) \{\n\s+\/\/ Colaborador entrando na Pessoa[^\n]*\n\s+const affectedAccount = await findAccountGainingEmployeeEvidence\(tx,/, "corrigir colaborador passa pela regra da evidência");
    const svc = read("src/lib/canonicalPersonService.server.ts");
    assert.match(svc, /const affectedAccount = await findAccountGainingEmployeeEvidence\(db, \{ fromPersonId, toPersonId: personId \}\);\n\s+const denial = employeePersonChangeDenial\(/, "cadastro do colaborador passa pela regra da evidência");
    assert.match(svc, /if \(source\.sourceKind === "app_user"\) throw accountRegularizationRequired\(\);/, "formulários nunca ligam conta");
    assert.doesNotMatch(svc, /appUser\.(update|updateMany|upsert)\(/, "o serviço de Pessoa não grava conta");
  });

  it("rotas: permissão efetiva resolvida pela sessão e repassada; regularizar e o RH com a guarda de vínculo com usuário", () => {
    const routes = read("src/lib/people/peopleRoutes.ts");
    assert.equal((routes.match(/canManageAccountIdentity: await canManageAccountIdentityOf\(req\),/g) ?? []).length, 2, "corrigir e desvincular recebem a permissão efetiva");
    assert.match(routes, /app\.post\("\/api\/people\/:id\/access\/attach", \.\.\.userLinkManageGuard,/);
    assert.match(routes, /const userLinkManageGuard = \[requireAppAuth, requireResource\(EMPLOYEES_RESOURCE_KEYS\.links, EMPLOYEES_ACTIONS\.manage\), requireResource\(EMPLOYEES_RESOURCE_KEYS\.userLink, EMPLOYEES_ACTIONS\.manage\)\];/);
    const lookup = read("src/lib/employeeLookupRoutes.ts");
    for (const route of ["link-user", "unlink-user"]) {
      assert.match(lookup, new RegExp(`"/api/employees/:id/${route}",\\n\\s+requireAppAuth,\\n\\s+requireResource\\(EMPLOYEES_RESOURCE_KEYS\\.userLink, EMPLOYEES_ACTIONS\\.manage\\),`), `RH ${route}`);
    }
    const server = read("server.ts");
    assert.match(server, /canManageAccountIdentity: \(req\) => allowsResourceOrHrEditor\(req, EMPLOYEES_RESOURCE_KEYS\.userLink, EMPLOYEES_ACTIONS\.manage\),/);
    assert.equal((server.match(/applyPersonLinkPlan\(tx, personPlan, accountIdentity\)/g) ?? []).length, 2, "POST e PUT do colaborador levam ator e permissão");
    assert.equal((server.match(/const accountIdentity = await resolveAccountIdentityContext\(req\);/g) ?? []).length, 2);
    assert.match(server, /if \(await hrEditorFallbackAllows\(req, resourceKey, action, decision\)\) \{\n\s+return next\(\);/, "guarda e decisão booleana usam a mesma régua");
    assert.match(server, /actor: accountIdentity\.actor,\n\s+canManageAccountIdentity: accountIdentity\.canManageAccountIdentity,\n\s+\}\);\n\s+return updated;/, "propagação E4 com o ator e a permissão efetiva da requisição");
  });

  it("concorrência: quem põe colaborador OU conta numa Pessoa trava a mesma chave antes de decidir", () => {
    const guard = read("src/lib/security/accountIdentityGuard.server.ts");
    assert.match(guard, /await lockPersonAccountLinks\(db, \[args\.fromPersonId, args\.toPersonId\]\);\n\s+const account = await db\.appUser\.findUnique/, "a checagem da evidência lê depois da trava");
    const ops = read("src/lib/people/personLinkOps.server.ts");
    assert.match(ops, /await lockPersonAccountLinks\(tx, \[entity\.personId, target\.id\]\);/, "corrigir conta");
    assert.match(ops, /await lockPersonAccountLinks\(tx, \[targetId\]\);\n\s+const ctx = await loadAttachContext/, "regularizar conta trava antes de ler os colaboradores");
    assert.match(ops, /linkEmployeeId: decision\.ok \? decision\.setEmployeeId : null/, "a prévia fixa o colaborador a ligar");
    assert.match(read("src/lib/canonicalPersonSync.server.ts"), /await lockPersonAccountLinks\(tx, \[user\.personId, args\.personId\]\);/, "propagação");
    assert.match(read("src/lib/adminUserCreation.server.ts"), /await lockPersonAccountLinks\(tx, \[personIdForUser\]\);/, "criação de conta pela Pessoa");
    assert.match(read("src/lib/employeeUserLink.server.ts"), /await lockPersonAccountLinks\(tx, \[emp\.personId\]\);/, "vínculo pelo RH");
  });

  it("registro formal: só os arquivos registrados gravam AppUser.employeeId/personId (novo escritor quebra este teste)", () => {
    const files: string[] = ["server.ts"];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
          if (name === "node_modules" || name === "dist") continue;
          walk(full);
        } else if (/\.(ts|tsx|mts|mjs|js)$/.test(name) && !/\.test\.(ts|tsx|mts)$/.test(name)) files.push(full.replace(/\\/g, "/"));
      }
    };
    ["src", "scripts"].forEach(walk);
    const writers = new Set<string>();
    for (const file of files) {
      const src = read(file);
      const re = /appUser\.(update|updateMany|create|upsert|createMany)\(/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        // Argumento da chamada (parênteses balanceados) → só os blocos de escrita (data/create/update).
        let depth = 0;
        let end = m.index + m[0].length - 1;
        for (; end < src.length; end++) {
          if (src[end] === "(") depth++;
          else if (src[end] === ")" && --depth === 0) break;
        }
        const call = src.slice(m.index, end);
        const blocks = [...call.matchAll(/\b(data|create|update)\s*:\s*\{/g)].map((b) => {
          let d = 0;
          let i = (b.index ?? 0) + b[0].length - 1;
          const start = i;
          for (; i < call.length; i++) {
            if (call[i] === "{") d++;
            else if (call[i] === "}" && --d === 0) break;
          }
          return call.slice(start, i + 1);
        });
        // Conservador: chave explícita, ou espalhamento (...x) num arquivo que fala dessas colunas.
        if (blocks.some((b) => /\b(employeeId|personId)\b/.test(b) || (/\.\.\.[A-Za-z_]/.test(b) && /\b(employeeId|personId)\b/.test(src)))) writers.add(file);
      }
      if (/UPDATE\s+"AppUser"\s+SET[^;]*"(employeeId|personId)"/i.test(src)) writers.add(file);
    }
    const registered = new Set<string>(ACCOUNT_IDENTITY_WRITERS.map((w) => w.file));
    assert.deepEqual([...writers].filter((f) => !registered.has(f)), [], "escritor fora do registro formal");
    assert.deepEqual([...registered].filter((f) => !writers.has(f)), [], "registro com arquivo que não grava mais (atualize o registro)");
    // A biblioteca sem chamador de produção continua sem chamador de produção.
    const callers = files.filter((f) => f !== "src/lib/canonicalPersonCore.server.ts" && /linkStage1RoleToPerson\(/.test(read(f)));
    assert.deepEqual(callers, [], "linkStage1RoleToPerson ganhou chamador de produção: passe-o pela política");
  });
});
