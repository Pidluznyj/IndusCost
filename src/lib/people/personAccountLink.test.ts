import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decideAttachAccount, emailsMatch, type AttachAccountInput } from "./personAccountLink.ts";

const P = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const admin = { id: "actor", role: "ADMIN", elevated: false };
const superElevated = { id: "actor", role: "SUPER_ADMIN", elevated: true };
const superPlain = { id: "actor", role: "SUPER_ADMIN", elevated: false };

function base(over: Partial<AttachAccountInput> = {}): AttachAccountInput {
  return {
    account: { id: "u1", role: "VIEWER", personId: null, employeeId: null, isActive: true, email: "x@empresa.com" },
    expected: {},
    target: { id: P, status: "ACTIVE", userIds: [] },
    employee: null,
    emailMismatch: false,
    confirmEmailMismatch: false,
    actor: admin,
    ...over,
  };
}

describe("decideAttachAccount — os 7 casos legados", () => {
  it("Gi/Joseane/Maria/Pedrinho: conta com colaborador, Pessoa ativa, e-mails iguais → LINK copiando a Pessoa do colaborador", () => {
    const r = decideAttachAccount(base({ account: { id: "u1", role: "SELLER", personId: null, employeeId: "e1", isActive: true, email: "gi@empresa.com" }, employee: { id: "e1", status: "ACTIVE", personId: P, appUserId: "u1", corporateEmail: "gi@empresa.com" } }));
    assert.deepEqual(r, { ok: true, kind: "LINK", fromPersonId: null, setEmployeeId: null, setEmployeePersonId: false, evidence: "EMAIL_EXACT", touchesSuperAdmin: false });
  });

  it("Leticia: e-mails divergentes não impedem o vínculo comprovado pelo colaborador, mas exigem confirmação explícita (evidência MANUAL)", () => {
    const input = base({ account: { id: "u1", role: "VIEWER", personId: null, employeeId: "e1", isActive: true, email: "leticia.pessoal@gmail.com" }, employee: { id: "e1", status: "ACTIVE", personId: P, appUserId: "u1", corporateEmail: "leticia@empresa.com" }, emailMismatch: true });
    const denied = decideAttachAccount(input);
    assert.equal("code" in denied ? denied.code : null, "EMAIL_MISMATCH_CONFIRMATION_REQUIRED");
    const ok = decideAttachAccount({ ...input, confirmEmailMismatch: true });
    assert.equal(ok.ok, true);
    assert.equal("evidence" in ok ? ok.evidence : null, "MANUAL");
  });

  it("Paulo (SUPER_ADMIN sem colaborador nem Pessoa): liga Pessoa + colaborador na mesma operação, só por SUPER_ADMIN elevado", () => {
    const input = base({ account: { id: "u1", role: "SUPER_ADMIN", personId: null, employeeId: null, isActive: true, email: "paulo@empresa.com" }, employee: { id: "e1", status: "ACTIVE", personId: P, appUserId: null, corporateEmail: "paulo@empresa.com" } });
    const byAdmin = decideAttachAccount({ ...input, actor: admin });
    assert.equal("code" in byAdmin ? byAdmin.code : null, "SUPER_ADMIN_REQUIRED");
    const noStepUp = decideAttachAccount({ ...input, actor: superPlain });
    assert.equal("code" in noStepUp ? noStepUp.code : null, "ADMIN_ELEVATION_REQUIRED");
    const ok = decideAttachAccount({ ...input, actor: superElevated });
    assert.deepEqual(ok, { ok: true, kind: "LINK", fromPersonId: null, setEmployeeId: "e1", setEmployeePersonId: false, evidence: "EMAIL_EXACT", touchesSuperAdmin: true });
  });

  it("Eduardo: Pessoa INACTIVE nunca recebe a conta em silêncio → TARGET_INACTIVE (reativar antes)", () => {
    const r = decideAttachAccount(base({ target: { id: P, status: "INACTIVE", userIds: [] }, employee: { id: "e1", status: "ACTIVE", personId: P, appUserId: null, corporateEmail: "x@empresa.com" } }));
    assert.equal("code" in r ? r.code : null, "TARGET_INACTIVE");
  });

  it("colaborador sem Pessoa: a regularização preenche employee.personId na mesma transação", () => {
    const r = decideAttachAccount(base({ account: { id: "u1", role: "VIEWER", personId: null, employeeId: "e1", isActive: true, email: "x@empresa.com" }, employee: { id: "e1", status: "ACTIVE", personId: null, appUserId: "u1", corporateEmail: "x@empresa.com" } }));
    assert.equal(r.ok, true);
    assert.equal("setEmployeePersonId" in r ? r.setEmployeePersonId : null, true);
  });

  it("conflitos: Pessoa já com outra conta, colaborador de outra Pessoa, colaborador já com outra conta, conta ligada a outro colaborador, colaborador desligado", () => {
    const codes = [
      decideAttachAccount(base({ target: { id: P, status: "ACTIVE", userIds: ["u9"] } })),
      decideAttachAccount(base({ employee: { id: "e1", status: "ACTIVE", personId: OTHER, appUserId: null, corporateEmail: null } })),
      decideAttachAccount(base({ employee: { id: "e1", status: "ACTIVE", personId: P, appUserId: "u9", corporateEmail: null } })),
      decideAttachAccount(base({ account: { id: "u1", role: "VIEWER", personId: null, employeeId: "e2", isActive: true, email: null }, employee: { id: "e1", status: "ACTIVE", personId: P, appUserId: null, corporateEmail: null } })),
      decideAttachAccount(base({ employee: { id: "e1", status: "INACTIVE", personId: P, appUserId: null, corporateEmail: null } })),
    ].map((r) => ("code" in r ? r.code : "OK"));
    assert.deepEqual(codes, ["TARGET_HAS_USER", "PERSON_MISMATCH", "EMPLOYEE_ALREADY_HAS_USER", "APPUSER_ALREADY_LINKED", "EMPLOYEE_INACTIVE"]);
  });

  it("estado esperado desatualizado → STALE; Pessoa MERGED → TARGET_MERGED; já vinculada → SAME", () => {
    assert.equal(("code" in (decideAttachAccount(base({ expected: { personId: OTHER } })) as { code: string }) && "STALE"), "STALE");
    const merged = decideAttachAccount(base({ target: { id: P, status: "MERGED", userIds: [] } }));
    assert.equal("code" in merged ? merged.code : null, "TARGET_MERGED");
    const same = decideAttachAccount(base({ account: { id: "u1", role: "VIEWER", personId: P, employeeId: null, isActive: true, email: null }, target: { id: P, status: "ACTIVE", userIds: ["u1"] } }));
    assert.equal("code" in same ? same.code : null, "SAME");
  });

  it("corrigir conta que aponta para outra Pessoa → RELINK com fromPersonId", () => {
    const r = decideAttachAccount(base({ account: { id: "u1", role: "VIEWER", personId: OTHER, employeeId: null, isActive: true, email: null } }));
    assert.equal(r.ok, true);
    assert.equal("kind" in r ? r.kind : null, "RELINK");
    assert.equal("fromPersonId" in r ? r.fromPersonId : null, OTHER);
  });
});

describe("emailsMatch", () => {
  it("compara sem caixa e sem espaços; vazio nunca casa", () => {
    assert.equal(emailsMatch(" A@X.com", "a@x.com "), true);
    assert.equal(emailsMatch("", ""), false);
    assert.equal(emailsMatch(null, "a@x.com"), false);
  });
});
