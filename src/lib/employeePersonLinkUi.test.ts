import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyCompatibleFill,
  applyPersonConflictChoice,
  clearPersonSelection,
  createNewPersonSelection,
  hasActivePersonLink,
  proposeCompatiblePersonFill,
  selectionFromResolveHit,
} from "./employeePersonLinkUi.ts";

describe("employeePersonLinkUi — fill sem sobrescrever", () => {
  it("preenche só campos vazios", () => {
    const { fillable, conflicts } = proposeCompatiblePersonFill(
      {
        name: "",
        socialName: "",
        corporateEmail: "ja@x.com",
        personalEmail: "",
        cpf: "",
        phone: "",
      },
      {
        displayName: "Ana",
        socialName: "Aninha",
        corporateEmail: "outra@x.com",
        personalEmail: "p@x.com",
        cpfNormalized: "12345678909",
        phoneNormalized: "1199999",
      }
    );
    assert.equal(fillable.name, "Ana");
    assert.equal(fillable.socialName, "Aninha");
    assert.equal(fillable.personalEmail, "p@x.com");
    assert.equal(fillable.cpf, "12345678909");
    assert.equal(fillable.corporateEmail, undefined);
    assert.ok(conflicts.some((c) => c.field === "corporateEmail"));
  });

  it("applyCompatibleFill não toca campos omitidos", () => {
    const next = applyCompatibleFill(
      { name: "X", socialName: "", corporateEmail: "a@x.com" },
      { socialName: "Y" }
    );
    assert.equal(next.name, "X");
    assert.equal(next.socialName, "Y");
    assert.equal(next.corporateEmail, "a@x.com");
  });

  it("applyPersonConflictChoice espelha no formulário", () => {
    const next = applyPersonConflictChoice(
      { name: "Form", corporateEmail: "f@x.com" },
      "displayName",
      "Pessoa"
    );
    assert.equal(next.name, "Pessoa");
  });
});

describe("employeePersonLinkUi — seleção", () => {
  it("personId / origem / criar nova", () => {
    assert.deepEqual(selectionFromResolveHit({
      personId: "p1",
      sourceKind: "employee",
      sourceEntityId: "e1",
    }), {
      personId: "p1",
      personSourceKind: null,
      personSourceId: null,
      createNewPerson: false,
    });
    assert.deepEqual(selectionFromResolveHit({
      personId: null,
      sourceKind: "app_user",
      sourceEntityId: "u1",
    }), {
      personId: null,
      personSourceKind: "app_user",
      personSourceId: "u1",
      createNewPerson: false,
    });
    assert.equal(createNewPersonSelection().createNewPerson, true);
    assert.equal(hasActivePersonLink(createNewPersonSelection()), false);
    assert.equal(clearPersonSelection({ keepWithoutPerson: true }).createNewPerson, false);
  });
});
