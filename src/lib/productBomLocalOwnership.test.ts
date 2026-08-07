import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createBomOwnershipResolver,
  isParentNomusControlled,
  type PreviousBomLineOwnership,
} from "./productBomLocalOwnership";

const nomusLine = (materialId: string): PreviousBomLineOwnership => ({
  materialId,
  childProductId: null,
  sourceSystem: "NOMUS",
  isNomusControlled: true,
  localException: false,
  lastNomusSyncAt: new Date("2026-08-01T00:00:00Z"),
  nomusComponentCode: `CODE-${materialId}`,
});

const localExceptionLine = (childProductId: string): PreviousBomLineOwnership => ({
  materialId: null,
  childProductId,
  sourceSystem: "INDUSCOST",
  isNomusControlled: false,
  localException: true,
  lastNomusSyncAt: null,
  nomusComponentCode: null,
});

describe("createBomOwnershipResolver — reescrita local de ProductBOM", () => {
  it("B09: linha NOVA em produto Nomus-controlled nasce localException=true", () => {
    const resolver = createBomOwnershipResolver({
      previousLines: [],
      parentIsNomusControlled: true,
    });
    const own = resolver.resolve({ materialId: "mat-nova" });
    assert.equal(own.localException, true);
    assert.equal(own.sourceSystem, "INDUSCOST");
    assert.equal(own.isNomusControlled, false);
  });

  it("linha NOVA em produto local nasce INDUSCOST sem exceção", () => {
    const resolver = createBomOwnershipResolver({
      previousLines: [],
      parentIsNomusControlled: false,
    });
    const own = resolver.resolve({ materialId: "mat-nova" });
    assert.equal(own.localException, false);
    assert.equal(own.sourceSystem, "INDUSCOST");
  });

  it("B10/B11: reescrever a estrutura preserva ownership Nomus da linha existente", () => {
    const resolver = createBomOwnershipResolver({
      previousLines: [nomusLine("mat-1")],
      parentIsNomusControlled: true,
    });
    const own = resolver.resolve({ materialId: "mat-1" });
    assert.equal(own.isNomusControlled, true);
    assert.equal(own.sourceSystem, "NOMUS");
    assert.equal(own.localException, false);
    assert.equal(own.nomusComponentCode, "CODE-mat-1");
    assert.ok(own.lastNomusSyncAt instanceof Date);
  });

  it("B05/B06/B07: salvar a composição não apaga a exceção local (Furação/Montagem sobrevivem ao próximo sync)", () => {
    const resolver = createBomOwnershipResolver({
      previousLines: [localExceptionLine("furacao-id"), nomusLine("mat-1")],
      parentIsNomusControlled: true,
    });
    const furacao = resolver.resolve({ childProductId: "furacao-id" });
    assert.equal(furacao.localException, true);
    const mp = resolver.resolve({ materialId: "mat-1" });
    assert.equal(mp.isNomusControlled, true);
  });

  it("duplicatas do mesmo vínculo consomem em ordem (FIFO), excedente vira linha nova", () => {
    const resolver = createBomOwnershipResolver({
      previousLines: [nomusLine("mat-1")],
      parentIsNomusControlled: true,
    });
    const first = resolver.resolve({ materialId: "mat-1" });
    assert.equal(first.isNomusControlled, true);
    const second = resolver.resolve({ materialId: "mat-1" });
    assert.equal(second.isNomusControlled, false);
    assert.equal(second.localException, true);
  });

  it("linha anterior local sem exceção em produto local mantém como estava", () => {
    const prev: PreviousBomLineOwnership = {
      materialId: "mat-2",
      childProductId: null,
      sourceSystem: null,
      isNomusControlled: false,
      localException: false,
      lastNomusSyncAt: null,
      nomusComponentCode: null,
    };
    const resolver = createBomOwnershipResolver({
      previousLines: [prev],
      parentIsNomusControlled: false,
    });
    const own = resolver.resolve({ materialId: "mat-2" });
    assert.equal(own.sourceSystem, null);
    assert.equal(own.localException, false);
  });
});

describe("isParentNomusControlled", () => {
  it("controla por flag ou por sourceSystem NOMUS", () => {
    assert.equal(isParentNomusControlled({ isNomusControlled: true }), true);
    assert.equal(isParentNomusControlled({ sourceSystem: "NOMUS" }), true);
    assert.equal(isParentNomusControlled({ isNomusControlled: false, sourceSystem: "INDUSCOST" }), false);
    assert.equal(isParentNomusControlled({}), false);
  });
});
