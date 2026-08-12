import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  NOMUS_CUSTOMER_SYNCED_FIELDS,
  buildNomusCustomerSnapshot,
  mergeNomusCustomerUpdate,
} from "./nomusCustomerMerge.js";

const SNAPSHOT = {
  companyName: "Metalurgica Alfa Ltda",
  tradeName: "Alfa",
  contactName: "Joao",
  email: "joao@alfa.com.br",
  phone: "11999990000",
  city: "Sao Paulo",
  state: "SP",
  status: "ACTIVE",
};

describe("mergeNomusCustomerUpdate — preservação de edições locais", () => {
  it("edição local (ours != base) é PRESERVADA mesmo com Nomus enviando outro valor", () => {
    const result = mergeNomusCustomerUpdate({
      current: { ...SNAPSHOT, email: "comercial@alfa.com.br" }, // usuário editou
      incoming: { ...SNAPSHOT, email: "financeiro@alfa.com.br" }, // Nomus mudou também
      lastSnapshot: SNAPSHOT,
    });
    assert.equal(result.data.email, undefined, "email local não é sobrescrito");
    assert.deepEqual(result.preservedFields, ["email"]);
    assert.deepEqual(result.changedFields, []);
  });

  it("campo não editado (ours == base) é atualizado com o valor novo do Nomus", () => {
    const result = mergeNomusCustomerUpdate({
      current: { ...SNAPSHOT },
      incoming: { ...SNAPSHOT, phone: "11888887777" },
      lastSnapshot: SNAPSHOT,
    });
    assert.equal(result.data.phone, "11888887777");
    assert.deepEqual(result.changedFields, ["phone"]);
    assert.deepEqual(result.preservedFields, []);
  });

  it("campo local vazio é preenchido pelo Nomus (fill)", () => {
    const result = mergeNomusCustomerUpdate({
      current: { ...SNAPSHOT, contactName: null },
      incoming: { ...SNAPSHOT, contactName: "Maria" },
      lastSnapshot: SNAPSHOT,
    });
    assert.equal(result.data.contactName, "Maria");
  });

  it("Nomus com campo vazio NUNCA apaga valor local", () => {
    const result = mergeNomusCustomerUpdate({
      current: { ...SNAPSHOT },
      incoming: { ...SNAPSHOT, email: null, phone: "  " },
      lastSnapshot: SNAPSHOT,
    });
    assert.equal(result.data.email, undefined);
    assert.equal(result.data.phone, undefined);
    assert.deepEqual(result.changedFields, []);
  });

  it("sem snapshot (primeira rodada pós-migração) é fill-only: não sobrescreve nada não-vazio", () => {
    const result = mergeNomusCustomerUpdate({
      current: {
        companyName: "Nome Editado No IndusCost",
        email: null,
        phone: "1130303030",
      },
      incoming: {
        companyName: "Nome Vindo Do Nomus",
        email: "novo@cliente.com",
        phone: "1140404040",
      },
      lastSnapshot: null,
    });
    assert.equal(result.data.companyName, undefined, "não-vazio preservado sem base");
    assert.equal(result.data.phone, undefined, "não-vazio preservado sem base");
    assert.equal(result.data.email, "novo@cliente.com", "vazio é preenchido");
    assert.ok(result.preservedFields.includes("companyName"));
    assert.ok(result.preservedFields.includes("phone"));
  });

  it("status inativado localmente nunca é reativado pelo sync", () => {
    const result = mergeNomusCustomerUpdate({
      current: { ...SNAPSHOT, status: "INACTIVE" }, // usuário inativou
      incoming: { ...SNAPSHOT, status: "ACTIVE" },
      lastSnapshot: SNAPSHOT, // snapshot era ACTIVE
    });
    assert.equal(result.data.status, undefined, "INACTIVE local preservado");
    assert.deepEqual(result.preservedFields, ["status"]);
  });

  it("valores iguais não geram escrita (update mínimo, idempotente)", () => {
    const result = mergeNomusCustomerUpdate({
      current: { ...SNAPSHOT },
      incoming: { ...SNAPSHOT },
      lastSnapshot: SNAPSHOT,
    });
    assert.deepEqual(result.data, {});
    assert.deepEqual(result.changedFields, []);
    assert.deepEqual(result.preservedFields, []);
  });

  it("determinístico: mesma entrada ⇒ mesma saída", () => {
    const input = {
      current: { ...SNAPSHOT, city: "Campinas" },
      incoming: { ...SNAPSHOT, city: "Jundiai", state: null },
      lastSnapshot: SNAPSHOT,
    };
    assert.deepEqual(mergeNomusCustomerUpdate(input), mergeNomusCustomerUpdate(input));
  });

  it("notes e campos complementares estão FORA do vocabulário sincronizado", () => {
    const fields: readonly string[] = NOMUS_CUSTOMER_SYNCED_FIELDS;
    for (const forbidden of [
      "notes",
      "address",
      "zipCode",
      "segment",
      "commercialNotes",
      "relationshipStatus",
      "accountOwner",
      "personId",
      "contactPersonId",
    ]) {
      assert.ok(!fields.includes(forbidden), `${forbidden} nunca pode ser sincronizado`);
    }
  });

  it("snapshot canônico normaliza vazios para null e cobre todos os campos", () => {
    const snapshot = buildNomusCustomerSnapshot({
      companyName: "  Alfa  ",
      email: "   ",
    });
    assert.equal(snapshot.companyName, "Alfa");
    assert.equal(snapshot.email, null);
    for (const field of NOMUS_CUSTOMER_SYNCED_FIELDS) {
      assert.ok(field in snapshot);
    }
  });

  it("trava de regressão: o script do sync usa o merge e não escreve mais notes", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const scriptSource = readFileSync(
      join(here, "../../scripts/nomusCustomersSyncV1.ts"),
      "utf8"
    );
    assert.ok(
      scriptSource.includes("mergeNomusCustomerUpdate"),
      "runApply precisa passar pelo merge de 3 vias"
    );
    assert.ok(
      scriptSource.includes("buildNomusCustomerSnapshot"),
      "runApply precisa persistir o snapshot base do merge"
    );
    assert.ok(
      !/notes\s*:/.test(scriptSource),
      "o sync NUNCA pode voltar a escrever em notes (destruía anotações do usuário)"
    );
  });
});
