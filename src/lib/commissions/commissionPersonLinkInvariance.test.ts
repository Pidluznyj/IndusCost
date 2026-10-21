/**
 * Comissões × Pessoa canônica: vincular/corrigir o `personId` de uma pessoa comissionada não
 * toca em regras, registros, lotes, aliases, ids Nomus nem valores — só no campo `personId`.
 * E a mesclagem de cadastros (dedupe) nunca agrupa por nome.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { relinkEntity } from "@/src/lib/people/personLinkOps.server.ts";
import { groupCommissionPersonsByIdentity } from "./commissionPersonIdentity.ts";
import { parseCommissionPersonCreateBody, parseCommissionPersonUpdateBody } from "./commissionApiValidation.ts";

const PERSON_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PERSON_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CP = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function fakePrisma(log: Array<{ model: string; op: string; args: unknown }>) {
  const personRow = { id: PERSON_A, displayName: "Ana", status: "ACTIVE", cpfNormalized: "52998224725", corporateEmail: null, employees: [], appUsers: [], fleetDrivers: [], commissionPeople: [], customersAsIdentity: [], customersAsContact: [] };
  const commissionRow = { id: CP, name: "Ana Vendedora", personId: PERSON_B, document: "529.982.247-25", email: null, type: "SELLER", nomusPersonId: 77 };
  const models: Record<string, Record<string, (args: unknown) => Promise<unknown>>> = {
    person: {
      findUnique: async () => personRow,
      findUniqueOrThrow: async () => ({ cpfNormalized: personRow.cpfNormalized, corporateEmail: null }),
    },
    commissionPerson: {
      findUnique: async () => commissionRow,
      updateMany: async (args) => {
        log.push({ model: "commissionPerson", op: "updateMany", args });
        return { count: 1 };
      },
    },
    personLinkEvent: {
      create: async (args) => {
        log.push({ model: "personLinkEvent", op: "create", args });
        return { id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" };
      },
    },
  };
  const tx = new Proxy({} as Record<string, unknown>, {
    get(_t, model: string) {
      if (model === "then") return undefined;
      if (model === "$executeRaw") return async () => 0;
      const m = models[model];
      if (!m) throw new Error(`modelo tocado indevidamente durante o vínculo: ${model}`);
      return new Proxy({}, { get: (_x, op: string) => (args: unknown) => (m[op] ?? (() => { throw new Error(`operação inesperada ${model}.${op}`); }))(args) });
    },
  });
  return { $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx) } as never;
}

describe("vincular pessoa comissionada à Pessoa não altera dados de comissão", () => {
  it("só `commissionPerson.personId` muda (comparação-e-troca) e um evento é gravado", async () => {
    const log: Array<{ model: string; op: string; args: unknown }> = [];
    const result = await relinkEntity(fakePrisma(log), {
      targetPersonId: PERSON_A,
      entityKind: "commission_person",
      entityId: CP,
      expectedCurrentPersonId: PERSON_B,
      reason: "CPF confirmado igual",
      actor: { id: null, name: "teste" },
    });
    assert.equal(result.kind, "RELINK");
    const updates = log.filter((l) => l.op === "updateMany");
    assert.equal(updates.length, 1);
    const args = updates[0]!.args as { where: Record<string, unknown>; data: Record<string, unknown> };
    assert.deepEqual(Object.keys(args.data), ["personId"]);
    assert.deepEqual(args.where, { id: CP, personId: PERSON_B });
    assert.ok(!log.some((l) => ["commissionRecord", "commissionRule", "commissionPaymentBatch", "commissionPersonAlias"].includes(l.model)));
    const ev = log.find((l) => l.model === "personLinkEvent")!.args as { data: { evidence: string; eventKind: string } };
    assert.equal(ev.data.eventKind, "RELINKED");
    assert.equal(ev.data.evidence, "CPF_EXACT");
  });
});

describe("dedupe de comissionáveis: nome nunca funde cadastros", () => {
  const rows = [
    { id: "1", nomusPersonId: null, name: "JOSE DA SILVA", type: "SELLER", source: "MANUAL", active: true },
    { id: "2", nomusPersonId: null, name: "José da Silva", type: "SELLER", source: "MANUAL", active: true },
    { id: "3", nomusPersonId: 10, name: "Outro", type: "SELLER", source: "NOMUS", active: true },
    { id: "4", nomusPersonId: 10, name: "Outro (dup)", type: "SELLER", source: "NOMUS", active: true },
  ];
  it("com nameKeys=false, homônimos ficam separados e só o mesmo nomusPersonId agrupa", () => {
    const groups = groupCommissionPersonsByIdentity(rows, { nameKeys: false }).map((g) => g.map((r) => r.id).sort());
    assert.ok(groups.some((g) => g.join() === "3,4"));
    assert.ok(groups.some((g) => g.join() === "1"));
    assert.ok(groups.some((g) => g.join() === "2"));
  });
  it("o padrão (resolução de leitura) continua agrupando por nome", () => {
    const groups = groupCommissionPersonsByIdentity(rows).map((g) => g.map((r) => r.id).sort());
    assert.ok(groups.some((g) => g.join() === "1,2"));
  });
});

describe("API de pessoa comissionada aceita personId opcional", () => {
  it("create: ausente = resolver pelo CPF; null = sem vínculo; uuid inválido = erro", () => {
    assert.equal(parseCommissionPersonCreateBody({ name: "X", type: "SELLER" }).personId, undefined);
    assert.equal(parseCommissionPersonCreateBody({ name: "X", type: "SELLER", personId: null }).personId, null);
    assert.equal(parseCommissionPersonCreateBody({ name: "X", type: "SELLER", personId: PERSON_A }).personId, PERSON_A);
    assert.throws(() => parseCommissionPersonCreateBody({ name: "X", type: "SELLER", personId: "abc" }), /personId inválido/);
  });
  it("update: só envia personId quando informado", () => {
    assert.ok(!("personId" in parseCommissionPersonUpdateBody({ name: "Y" })));
    assert.equal(parseCommissionPersonUpdateBody({ personId: "" }).personId, null);
  });
});
