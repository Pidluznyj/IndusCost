import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertPersonLinkable,
  planOperationalPersonLink,
  resolvePersonByCpf,
  suggestPersonsForIdentity,
} from "./personIdentityResolve.server.ts";

type Row = { id: string; displayName: string; status: string; cpfNormalized: string | null; corporateEmail: string | null; personalEmail?: string | null; mergedIntoPersonId?: string | null; createdAt?: Date };

/** CPFs com dígitos verificadores válidos (fictícios). */
const CPF_A = "52998224725";
const CPF_B = "11144477735";

function fakeDb(rows: Row[]) {
  return {
    person: {
      async findMany(args: { where: Record<string, unknown>; take?: number }) {
        const w = args.where as { cpfNormalized?: string; status?: { not: string }; OR?: Array<Record<string, { equals: string }>> };
        return rows.filter((r) => {
          if (w.status?.not && r.status === w.status.not) return false;
          if (w.cpfNormalized !== undefined && r.cpfNormalized !== w.cpfNormalized) return false;
          if (w.OR) {
            return w.OR.some((cond) => {
              const [field, v] = Object.entries(cond)[0]!;
              const value = (r as Record<string, unknown>)[field];
              return typeof value === "string" && value.toLowerCase() === v.equals.toLowerCase();
            });
          }
          return true;
        });
      },
      async findUnique(args: { where: { id: string } }) {
        return rows.find((r) => r.id === args.where.id) ?? null;
      },
    },
  } as never;
}

const A: Row = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", displayName: "Ana", status: "ACTIVE", cpfNormalized: CPF_A, corporateEmail: "ana@x.test" };
const A2: Row = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab", displayName: "Ana (dup)", status: "ACTIVE", cpfNormalized: CPF_A, corporateEmail: null };
const MERGED: Row = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac", displayName: "Ana (unificada)", status: "MERGED", cpfNormalized: CPF_A, corporateEmail: null, mergedIntoPersonId: A.id };
const B: Row = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", displayName: "Bia", status: "ACTIVE", cpfNormalized: CPF_B, corporateEmail: "bia@x.test" };

describe("resolvePersonByCpf — CPF validado é a única evidência que vincula sozinha", () => {
  it("exatamente uma Pessoa não unificada com o CPF → vincula", async () => {
    const r = await resolvePersonByCpf(fakeDb([A, MERGED, B]), "529.982.247-25");
    assert.equal(r.personId, A.id);
    assert.equal(r.ambiguous, false);
    assert.equal(r.candidates.length, 1);
  });

  it("Pessoa MERGED nunca conta", async () => {
    const r = await resolvePersonByCpf(fakeDb([MERGED]), CPF_A);
    assert.equal(r.personId, null);
    assert.equal(r.ambiguous, false);
  });

  it("duas Pessoas com o mesmo CPF → ambíguo, não escolhe sozinho", async () => {
    const r = await resolvePersonByCpf(fakeDb([A, A2]), CPF_A);
    assert.equal(r.personId, null);
    assert.equal(r.ambiguous, true);
    assert.equal(r.candidates.length, 2);
  });

  it("CPF com dígitos verificadores inválidos não consulta nem vincula", async () => {
    const r = await resolvePersonByCpf(fakeDb([{ ...A, cpfNormalized: "11111111111" }]), "11111111111");
    assert.equal(r.personId, null);
    assert.equal(r.candidates.length, 0);
  });

  it("candidatos saem mascarados (sem CPF nem e-mail em claro)", async () => {
    const r = await resolvePersonByCpf(fakeDb([A]), CPF_A);
    assert.notEqual(r.candidates[0]!.cpfMasked, CPF_A);
    assert.ok(r.candidates[0]!.cpfMasked?.includes("***"));
    assert.notEqual(r.candidates[0]!.emailMasked, "ana@x.test");
  });
});

describe("suggestPersonsForIdentity — e-mail é só sugestão", () => {
  it("retorna por CPF (forte) e por e-mail (fraca) separados, sem repetir", async () => {
    const r = await suggestPersonsForIdentity(fakeDb([A, B]), { cpf: CPF_A, email: "ANA@x.test" });
    assert.equal(r.cpfValid, true);
    assert.deepEqual(r.byCpf.map((c) => c.id), [A.id]);
    assert.deepEqual(r.byEmail, []);
    const r2 = await suggestPersonsForIdentity(fakeDb([A, B]), { email: "bia@x.test" });
    assert.deepEqual(r2.byCpf, []);
    assert.deepEqual(r2.byEmail.map((c) => [c.id, c.evidence]), [[B.id, "EMAIL_EXACT"]]);
  });

  it("documento que não é CPF válido → cpfValid=false e nenhuma sugestão por CPF", async () => {
    const r = await suggestPersonsForIdentity(fakeDb([A]), { cpf: "12345" });
    assert.equal(r.cpfValid, false);
    assert.deepEqual(r.byCpf, []);
  });
});

describe("assertPersonLinkable", () => {
  it("Pessoa inexistente → 404; unificada → 409; ativa → ok", async () => {
    await assert.rejects(assertPersonLinkable(fakeDb([]), A.id), (e: { code: string; status: number }) => e.code === "PERSON_NOT_FOUND" && e.status === 404);
    await assert.rejects(assertPersonLinkable(fakeDb([MERGED]), MERGED.id), (e: { code: string; status: number }) => e.code === "PERSON_MERGED" && e.status === 409);
    const ok = await assertPersonLinkable(fakeDb([A]), A.id);
    assert.equal(ok.id, A.id);
  });
});

describe("planOperationalPersonLink — nunca sobrescreve vínculo existente", () => {
  it("sem vínculo atual: resolve pelo CPF", async () => {
    const r = await planOperationalPersonLink(fakeDb([A]), { cpf: CPF_A, currentPersonId: null });
    assert.deepEqual(r, { personId: A.id, reason: "RESOLVED_BY_CPF" });
  });

  it("sem vínculo e sem Pessoa com o CPF: fica sem vínculo (não cria Pessoa)", async () => {
    const r = await planOperationalPersonLink(fakeDb([B]), { cpf: CPF_A, currentPersonId: null });
    assert.deepEqual(r, { personId: null, reason: "NONE" });
  });

  it("vínculo atual com o mesmo CPF: mantém", async () => {
    const r = await planOperationalPersonLink(fakeDb([A]), { cpf: CPF_A, currentPersonId: A.id });
    assert.deepEqual(r, { personId: A.id, reason: "KEPT" });
  });

  it("vínculo atual com CPF diferente do novo: recusa (409) em vez de religar em silêncio", async () => {
    await assert.rejects(
      planOperationalPersonLink(fakeDb([A, B]), { cpf: CPF_B, currentPersonId: A.id }),
      (e: { code: string; status: number }) => e.code === "PERSON_CPF_MISMATCH" && e.status === 409
    );
  });
});
