import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSimulationLookupPrismaWhere,
  buildSimulationSearchHaystack,
  filterAndSerializeSimulationLookupRows,
  matchesSimulationSearchTokens,
  normalizeSimulationSearchText,
  serializeSimulationLookupRow,
  tokenizeSimulationSearchQuery,
  type SimulationLookupRecord,
} from "./projectsSimulationLookup.js";

function sampleSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    header: {
      simulationName: "Projeto Iris oficial",
      productName: "Torneira EGM 30 Iris",
      productSku: "333.33BET",
      createdAt: "2026-01-01T00:00:00.000Z",
      savedAt: "2026-01-02T00:00:00.000Z",
    },
    result: {
      costBase: 120.5,
      price: 150,
      marginPct: 19.6,
    },
    ...overrides,
  };
}

function sampleRow(overrides: Partial<SimulationLookupRecord> = {}): SimulationLookupRecord {
  return {
    id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    name: "Projeto Iris oficial",
    productName: "Torneira EGM 30 Iris",
    productSku: "333.33BET",
    status: "SAVED",
    notes: null,
    savedAt: new Date("2026-01-02T00:00:00.000Z"),
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    snapshot: sampleSnapshot(),
    ...overrides,
  };
}

describe("projectsSimulationLookup", () => {
  it("tokeniza consulta e normaliza case/accent", () => {
    assert.deepEqual(tokenizeSimulationSearchQuery("Projeto Íris"), ["projeto", "iris"]);
    assert.equal(normalizeSimulationSearchText("ÍRIS"), "iris");
  });

  it("monta haystack com colunas e snapshot.header", () => {
    const haystack = buildSimulationSearchHaystack(
      sampleRow({
        name: "Nome DB",
        snapshot: sampleSnapshot({
          header: {
            simulationName: "Projeto Iris",
            productName: "Produto final",
            productSku: "SKU-1",
          },
        }),
      })
    );
    assert.match(haystack, /Nome DB/);
    assert.match(haystack, /Projeto Iris/);
    assert.match(haystack, /Produto final/);
  });

  it("encontra Projeto Iris por nome da simulação", () => {
    const rows = [
      sampleRow({ id: "1", name: "Projeto Iris oficial" }),
      sampleRow({
        id: "2",
        name: "Torneira chopeira",
        productName: "Chopeira industrial X",
        snapshot: sampleSnapshot({
          header: {
            simulationName: "Torneira chopeira",
            productName: "Chopeira industrial X",
            productSku: "CHP-01",
          },
        }),
      }),
    ];
    const result = filterAndSerializeSimulationLookupRows(rows, "Projeto Iris");
    assert.equal(result.length, 1);
    assert.equal(result[0]?.name, "Projeto Iris oficial");
  });

  it("encontra por nome do produto final", () => {
    const rows = [
      sampleRow({
        id: "1",
        name: "Precificação v2",
        productName: "Torneira chopeira - Precificação estimativa inicial v2",
      }),
    ];
    const result = filterAndSerializeSimulationLookupRows(rows, "Torneira");
    assert.equal(result.length, 1);
    assert.equal(result[0]?.productName, "Torneira chopeira - Precificação estimativa inicial v2");
  });

  it("busca é case-insensitive", () => {
    const row = sampleRow({ name: "Projeto Iris" });
    assert.equal(matchesSimulationSearchTokens(row, tokenizeSimulationSearchQuery("projeto iris")), true);
    assert.equal(matchesSimulationSearchTokens(row, tokenizeSimulationSearchQuery("IRIS")), true);
  });

  it("não retorna vazio quando há snapshot salvo compatível", () => {
    const rows = [sampleRow({ name: "Projeto Iris" })];
    const result = filterAndSerializeSimulationLookupRows(rows, "iris");
    assert.equal(result.length, 1);
    assert.equal(result[0]?.status, "SAVED");
    assert.equal(result[0]?.selectable, true);
  });

  it("lista rascunho mas bloqueia seleção", () => {
    const serialized = serializeSimulationLookupRow(
      sampleRow({ status: "DRAFT", savedAt: null, name: "Projeto Iris cópia" })
    );
    assert.equal(serialized.status, "DRAFT");
    assert.equal(serialized.statusLabel, "Rascunho");
    assert.equal(serialized.selectable, false);
    assert.match(serialized.selectionBlockedReason ?? "", /rascunho/i);
  });

  it("lista salvo sem custo com aviso", () => {
    const serialized = serializeSimulationLookupRow(
      sampleRow({ snapshot: { header: { simulationName: "X", productName: "Y" }, result: {} } })
    );
    assert.equal(serialized.missingCost, true);
    assert.equal(serialized.selectable, false);
    assert.match(serialized.selectionBlockedReason ?? "", /custo/i);
  });

  it("usa custo e margem do snapshot", () => {
    const serialized = serializeSimulationLookupRow(sampleRow());
    assert.equal(serialized.unitCost, 120.5);
    assert.equal(serialized.totalCost, 150);
    assert.equal(serialized.margin, 19.6);
    assert.equal(serialized.source, "SIMULATION");
  });

  it("buildSimulationLookupPrismaWhere gera OR por token", () => {
    const where = buildSimulationLookupPrismaWhere("Projeto Iris");
    assert.ok(where?.OR);
    assert.ok((where?.OR?.length ?? 0) >= 2);
  });
});
