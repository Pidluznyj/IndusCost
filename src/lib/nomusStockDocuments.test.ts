import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import {
  computeEstimatedTotalValue,
  mapNomusStockDocumentPayload,
  parseNomusStockQuantity,
  parseNomusStockUnitValue,
  pickItensDocumentoEstoque,
} from "./nomusStockDocumentsMapper.js";
import {
  buildStockDocumentsQuery,
  isoDateToNomusBrDate,
  parseStockDocumentsSyncCli,
  planStockDocumentPersist,
  shouldWriteStockDocuments,
  summarizeStockDocumentPersistPlans,
} from "./nomusStockDocumentsSyncLogic.js";

const sampleDocumentoSaida6937 = {
  id: 7951,
  idNfe: 6937,
  tipoDocumentoEstoque: "DocumentoSaida",
  data: "13/05/2026 08:10:33",
  itensDocumentoEstoque: [
    { id: 1, idProduto: 456, qtde: "3.000", valorUnitario: "4,92" },
    { id: 2, idProduto: 452, qtde: "9.000", valorUnitario: "4,92" },
    { id: 3, idProduto: 455, qtde: "10.000", valorUnitario: "4,92" },
  ],
};

describe("nomusStockDocumentsMapper", () => {
  it("normaliza quantidade BR 3.000 => 3000", () => {
    assert.equal(parseNomusStockQuantity("3.000"), 3000);
    assert.equal(parseNomusStockQuantity("9.000"), 9000);
    assert.equal(parseNomusStockQuantity(3000), 3000);
  });

  it("normaliza valorUnitario BR 4,92 => 4.92", () => {
    assert.equal(parseNomusStockUnitValue("4,92"), 4.92);
    assert.equal(parseNomusStockUnitValue("5,86"), 5.86);
  });

  it("calcula estimatedTotalValue = quantity * unitValue", () => {
    assert.equal(computeEstimatedTotalValue(3000, 4.92), 14760);
    assert.equal(computeEstimatedTotalValue(10000, 4.92), 49200);
  });

  it("parseia itensDocumentoEstoque do documento 7951 / NF 6937", () => {
    assert.equal(pickItensDocumentoEstoque(sampleDocumentoSaida6937).length, 3);
    const mapped = mapNomusStockDocumentPayload(sampleDocumentoSaida6937);
    assert.equal(mapped.ok, true);
    if (!mapped.ok) return;
    assert.equal(mapped.row.externalId, 7951);
    assert.equal(mapped.row.idNfe, 6937);
    assert.equal(mapped.row.tipoDocumentoEstoque, "DocumentoSaida");
    assert.ok(mapped.row.dataDocumento);
    assert.equal(mapped.row.dataDocumento!.getFullYear(), 2026);
    assert.equal(mapped.row.dataDocumento!.getMonth(), 4);
    assert.equal(mapped.row.dataDocumento!.getDate(), 13);
    assert.equal(mapped.row.items.length, 3);
    assert.equal(mapped.row.items[0]!.externalProductId, 456);
    assert.equal(mapped.row.items[0]!.quantity.toString(), "3000");
    assert.equal(mapped.row.items[0]!.unitValue.toString(), "4.92");
    assert.equal(mapped.row.items[0]!.estimatedTotalValue.toString(), "14760");
    const total = mapped.row.items.reduce(
      (sum, item) => sum.add(item.estimatedTotalValue),
      new Prisma.Decimal(0)
    );
    assert.equal(total.toString(), "108240");
    assert.equal(typeof mapped.row.rawJson.id, "number");
  });
});

describe("nomusStockDocumentsSyncLogic", () => {
  it("parse CLI preview por padrão e apply explícito", () => {
    const preview = parseStockDocumentsSyncCli([
      "--from=2025-07-01",
      "--to=2026-07-10",
      "--tipo=DocumentoSaida",
    ]);
    assert.equal(preview.mode, "preview");
    assert.equal(shouldWriteStockDocuments(preview.mode), false);

    const apply = parseStockDocumentsSyncCli([
      "apply",
      "--from=2025-07-01",
      "--to=2026-07-10",
    ]);
    assert.equal(apply.mode, "apply");
    assert.equal(shouldWriteStockDocuments(apply.mode), true);
  });

  it("monta query RSQL por período e por idNfe", () => {
    assert.equal(isoDateToNomusBrDate("2025-07-01"), "01/07/2025");
    assert.equal(
      buildStockDocumentsQuery({
        tipo: "DocumentoSaida",
        from: "2025-07-01",
        to: "2026-07-10",
      }),
      "tipoDocumentoEstoque==DocumentoSaida;data=ge=01/07/2025;data=le=10/07/2026"
    );
    assert.equal(
      buildStockDocumentsQuery({
        tipo: "DocumentoSaida",
        idNfe: 6937,
      }),
      "idNfe==6937;tipoDocumentoEstoque==DocumentoSaida"
    );
  });

  it("plano apply é upsert idempotente com replace de itens", () => {
    const mapped = mapNomusStockDocumentPayload(sampleDocumentoSaida6937);
    assert.equal(mapped.ok, true);
    if (!mapped.ok) return;

    const createPlan = planStockDocumentPersist(mapped.row, new Set());
    assert.equal(createPlan.action, "create");
    assert.equal(createPlan.replaceItems, true);
    assert.equal(createPlan.itemCount, 3);

    const updatePlan = planStockDocumentPersist(mapped.row, new Set([7951]));
    assert.equal(updatePlan.action, "update");
    assert.equal(updatePlan.replaceItems, true);

    const summary = summarizeStockDocumentPersistPlans([createPlan, updatePlan]);
    assert.equal(summary.documentsToCreate, 1);
    assert.equal(summary.documentsToUpdate, 1);
    assert.equal(summary.itemsToWrite, 6);
  });

  it("preview não habilita escrita", () => {
    assert.equal(shouldWriteStockDocuments("preview"), false);
    assert.equal(shouldWriteStockDocuments("apply"), true);
  });
});
