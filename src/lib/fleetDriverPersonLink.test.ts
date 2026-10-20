import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseDriverInput, resolveDriverPersonLink } from "./fleetDriverOps.ts";
import { validateDriverImportRow } from "./fleetCsvImport.ts";
import { FleetBusinessError } from "./fleetErrors.ts";

const CPF_OK = "52998224725";
const CPF_OTHER = "11144477735";
const PERSON_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function fakeDb(persons: Array<{ id: string; status: string; cpfNormalized: string | null }>) {
  return {
    person: {
      async findMany(args: { where: { cpfNormalized?: string; status?: { not: string } } }) {
        return persons
          .filter((p) => p.cpfNormalized === args.where.cpfNormalized && p.status !== args.where.status?.not)
          .map((p) => ({ ...p, displayName: p.id, corporateEmail: null }));
      },
      async findUnique(args: { where: { id: string } }) {
        return persons.find((p) => p.id === args.where.id) ?? null;
      },
    },
  } as never;
}

describe("Frota — motorista: CPF com dígitos verificadores", () => {
  it("parseDriverInput recusa CPF com checksum inválido e aceita CPF válido com máscara", () => {
    assert.throws(() => parseDriverInput({ name: "M", cpf: "111.111.111-11" }), /dígitos verificadores/);
    assert.throws(() => parseDriverInput({ name: "M", cpf: "12345678901" }), /dígitos verificadores/);
    const ok = parseDriverInput({ name: "M", cpf: "529.982.247-25" });
    assert.equal(ok.cpf, CPF_OK);
  });

  it("CSV: linha com checksum inválido fica inválida; CPF válido passa", () => {
    const ctx = { seenCpfs: new Map<string, number>(), existingCpfs: new Map<string, string>(), allowUpdate: false, blockExpiredCnh: true };
    const bad = validateDriverImportRow({ name: "A", cpf: "12345678901" }, 2, ctx);
    assert.equal(bad.valid, false);
    assert.match(bad.errors.join(" "), /dígitos verificadores/);
    const good = validateDriverImportRow({ name: "B", cpf: CPF_OK }, 3, ctx);
    assert.equal(good.valid, true, good.errors.join(" "));
  });
});

describe("Frota — vínculo do motorista à Pessoa", () => {
  it("resolve pelo CPF quando há exatamente uma Pessoa; não cria Pessoa quando não há", async () => {
    assert.equal(await resolveDriverPersonLink(CPF_OK, null, fakeDb([{ id: PERSON_A, status: "ACTIVE", cpfNormalized: CPF_OK }])), PERSON_A);
    assert.equal(await resolveDriverPersonLink(CPF_OK, null, fakeDb([])), null);
  });

  it("mantém o vínculo existente e recusa CPF divergente como erro de negócio 409", async () => {
    const db = fakeDb([{ id: PERSON_A, status: "ACTIVE", cpfNormalized: CPF_OK }]);
    assert.equal(await resolveDriverPersonLink(CPF_OK, PERSON_A, db), PERSON_A);
    await assert.rejects(resolveDriverPersonLink(CPF_OTHER, PERSON_A, db), (e: unknown) => e instanceof FleetBusinessError && e.httpStatus === 409 && e.code === "PERSON_CPF_MISMATCH");
  });
});
