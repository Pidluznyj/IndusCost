import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapJusbrasilProcess, notConfiguredJusbrasilBatch } from "./jusbrasilMapper.js";

describe("jusbrasil mapper", () => {
  it("desligado devolve NOT_CONFIGURED", () => {
    assert.equal(notConfiguredJusbrasilBatch().errorCode, "NOT_CONFIGURED");
  });

  it("mapeia partes e não inventa campo ausente", () => {
    const mapped = mapJusbrasilProcess({
      numero: "0001234-56.2024.5.09.0001",
      classe: "Reclamação Trabalhista",
      partes: [{ nome: "João", polo: "ativo" }, { nome: "Koppetel", polo: "passivo" }],
      movs: [{ texto: "Distribuído", data: "2026-09-23" }],
    });
    assert.equal(mapped.cases[0]?.className, "Reclamação Trabalhista");
    assert.equal(mapped.cases[0]?.parties[0]?.pole, "ACTIVE");
    assert.equal(mapped.cases[0]?.attorneys?.length ?? 0, 0);
    assert.equal(mapped.cases[0]?.hearings?.length ?? 0, 0);
  });
});
