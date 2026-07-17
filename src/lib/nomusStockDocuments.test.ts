import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import {
  classifyStockDocumentItemsReliability,
  computeEstimatedTotalValue,
  dedupeMappedStockDocumentItems,
  inspectStockDocumentItemsArray,
  mapNomusStockDocumentItem,
  mapNomusStockDocumentPayload,
  parseNomusStockQuantity,
  parseNomusStockUnitValue,
  pickItensDocumentoEstoque,
} from "./nomusStockDocumentsMapper.js";
import {
  buildStockDocumentsQuery,
  decideStockDocumentItemsAction,
  isoDateToNomusBrDate,
  parseStockDocumentsSyncCli,
  planStockDocumentPersist,
  resolveStockDocumentsSyncExitCode,
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
    assert.equal(mapped.row.itemsReliability, "complete_with_items");
    assert.equal(mapped.row.itemsArray.present, true);
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

  it("classifica payload completo com itens", () => {
    const mapped = mapNomusStockDocumentPayload(sampleDocumentoSaida6937);
    assert.equal(mapped.ok, true);
    if (!mapped.ok) return;
    assert.equal(mapped.row.itemsReliability, "complete_with_items");
    assert.equal(mapped.row.items.length, 3);
  });

  it("classifica payload completo sem itens (array explícito vazio)", () => {
    const mapped = mapNomusStockDocumentPayload({
      id: 9001,
      idNfe: 1,
      tipoDocumentoEstoque: "DocumentoSaida",
      itensDocumentoEstoque: [],
    });
    assert.equal(mapped.ok, true);
    if (!mapped.ok) return;
    assert.equal(mapped.row.itemsArray.present, true);
    assert.equal(mapped.row.itemsArray.rawCount, 0);
    assert.equal(mapped.row.itemsReliability, "complete_empty");
    assert.equal(mapped.row.items.length, 0);
  });

  it("classifica payload parcial sem chave de itens", () => {
    const mapped = mapNomusStockDocumentPayload({
      id: 9002,
      idNfe: 2,
      tipoDocumentoEstoque: "DocumentoSaida",
      data: "01/01/2026",
    });
    assert.equal(mapped.ok, true);
    if (!mapped.ok) return;
    assert.equal(mapped.row.itemsArray.present, false);
    assert.equal(mapped.row.itemsReliability, "partial_absent_array");
    assert.equal(mapped.row.items.length, 0);
    assert.equal(inspectStockDocumentItemsArray(mapped.row.rawJson).present, false);
  });

  it("classifica payload parcial quando itens existem mas nenhum mapeia", () => {
    const mapped = mapNomusStockDocumentPayload({
      id: 9003,
      itensDocumentoEstoque: [{ id: 1, idProduto: 10 }, { id: 2, qtde: "x" }],
    });
    assert.equal(mapped.ok, true);
    if (!mapped.ok) return;
    assert.equal(mapped.row.itemsArray.present, true);
    assert.equal(mapped.row.itemsArray.rawCount, 2);
    assert.equal(mapped.row.itemsDiscardedCount, 2);
    assert.equal(mapped.row.itemsReliability, "partial_unmapped");
    assert.equal(mapped.row.items.length, 0);
  });

  it("rejeita payload inválido sem externalId", () => {
    const mapped = mapNomusStockDocumentPayload({
      idNfe: 99,
      itensDocumentoEstoque: [],
    });
    assert.equal(mapped.ok, false);
    if (mapped.ok) return;
    assert.deepEqual(mapped.reasons, ["MISSING_EXTERNAL_ID"]);
    assert.equal(mapped.externalId, null);
  });

  it("colapsa itens duplicados no mesmo payload (último vence)", () => {
    const mapped = mapNomusStockDocumentPayload({
      id: 9004,
      itensDocumentoEstoque: [
        { id: 10, idProduto: 1, qtde: "1", valorUnitario: "10,00" },
        { id: 10, idProduto: 1, qtde: "2", valorUnitario: "20,00" },
        { id: 11, idProduto: 2, qtde: "1", valorUnitario: "5,00" },
      ],
    });
    assert.equal(mapped.ok, true);
    if (!mapped.ok) return;
    assert.equal(mapped.row.itemsDuplicateCollapsedCount, 1);
    assert.equal(mapped.row.items.length, 2);
    const dup = mapped.row.items.find((item) => item.externalItemId === 10);
    assert.ok(dup);
    assert.equal(dup!.quantity.toString(), "2");
    assert.equal(dup!.unitValue.toString(), "20");
  });

  it("dedupeMappedStockDocumentItems colapsa fingerprint sem id", () => {
    const a = mapNomusStockDocumentItem({
      idProduto: 7,
      qtde: "1",
      valorUnitario: "3,00",
    });
    const b = mapNomusStockDocumentItem({
      idProduto: 7,
      qtde: "1",
      valorUnitario: "3,00",
    });
    assert.ok(a && b);
    const deduped = dedupeMappedStockDocumentItems([a!, b!]);
    assert.equal(deduped.duplicatesCollapsed, 1);
    assert.equal(deduped.items.length, 1);
  });
});

describe("nomusStockDocumentsSyncLogic — decisão de itens", () => {
  it("payload completo com itens → replace", () => {
    const mapped = mapNomusStockDocumentPayload(sampleDocumentoSaida6937);
    assert.equal(mapped.ok, true);
    if (!mapped.ok) return;
    const decision = decideStockDocumentItemsAction({
      reliability: mapped.row.itemsReliability,
      existingItemCount: 3,
    });
    assert.equal(decision.action, "replace");
    assert.equal(decision.reason, "ITEMS_ARRAY_COMPLETE");

    const plan = planStockDocumentPersist(mapped.row, new Set([7951]), 3);
    assert.equal(plan.action, "update");
    assert.equal(plan.itemsAction, "replace");
    assert.equal(plan.itemCount, 3);
  });

  it("payload completo sem itens → replace (limpa itens)", () => {
    const mapped = mapNomusStockDocumentPayload({
      id: 9001,
      itensDocumentoEstoque: [],
    });
    assert.equal(mapped.ok, true);
    if (!mapped.ok) return;
    const decision = decideStockDocumentItemsAction({
      reliability: mapped.row.itemsReliability,
      existingItemCount: 5,
    });
    assert.equal(decision.action, "replace");
    assert.equal(decision.reason, "ITEMS_ARRAY_EXPLICITLY_EMPTY");
  });

  it("payload parcial sem itens preserva itens existentes", () => {
    const mapped = mapNomusStockDocumentPayload({
      id: 9002,
      idNfe: 2,
      tipoDocumentoEstoque: "DocumentoSaida",
    });
    assert.equal(mapped.ok, true);
    if (!mapped.ok) return;
    assert.equal(mapped.row.itemsReliability, "partial_absent_array");

    const decision = decideStockDocumentItemsAction({
      reliability: mapped.row.itemsReliability,
      existingItemCount: 4,
    });
    assert.equal(decision.action, "preserve");
    assert.equal(decision.reason, "UNRELIABLE_ITEMS_PAYLOAD_PRESERVE_EXISTING");

    const plan = planStockDocumentPersist(mapped.row, new Set([9002]), 4);
    assert.equal(plan.itemsAction, "preserve");
    assert.equal(plan.existingItemCount, 4);
  });

  it("payload parcial sem itens existentes → ignore (nada a apagar)", () => {
    const mapped = mapNomusStockDocumentPayload({ id: 9005 });
    assert.equal(mapped.ok, true);
    if (!mapped.ok) return;
    const decision = decideStockDocumentItemsAction({
      reliability: mapped.row.itemsReliability,
      existingItemCount: 0,
    });
    assert.equal(decision.action, "ignore");
  });

  it("payload inválido → ignore", () => {
    const decision = decideStockDocumentItemsAction({
      reliability: "invalid",
      existingItemCount: 2,
    });
    assert.equal(decision.action, "ignore");
    assert.equal(decision.reason, "INVALID_PAYLOAD");
  });

  it("segunda execução idempotente mantém replace no payload completo", () => {
    const mapped = mapNomusStockDocumentPayload(sampleDocumentoSaida6937);
    assert.equal(mapped.ok, true);
    if (!mapped.ok) return;

    const first = planStockDocumentPersist(mapped.row, new Set([7951]), 3);
    const second = planStockDocumentPersist(mapped.row, new Set([7951]), 3);
    assert.equal(first.itemsAction, "replace");
    assert.equal(second.itemsAction, "replace");
    assert.equal(first.itemCount, second.itemCount);
    assert.deepEqual(
      { action: first.action, itemsAction: first.itemsAction, itemCount: first.itemCount },
      { action: second.action, itemsAction: second.itemsAction, itemCount: second.itemCount }
    );
  });

  it("resumo separa itens a substituir dos preservados", () => {
    const complete = mapNomusStockDocumentPayload(sampleDocumentoSaida6937);
    const partial = mapNomusStockDocumentPayload({ id: 9002 });
    assert.equal(complete.ok && partial.ok, true);
    if (!complete.ok || !partial.ok) return;

    const plans = [
      planStockDocumentPersist(complete.row, new Set([7951]), 3),
      planStockDocumentPersist(partial.row, new Set([9002]), 4),
    ];
    const summary = summarizeStockDocumentPersistPlans(plans);
    assert.equal(summary.itemsToWrite, 3);
    assert.equal(summary.itemsToPreserve, 4);
    assert.equal(summary.partialPayloads, 1);
  });

  it("classifyStockDocumentItemsReliability cobre os quatro casos", () => {
    assert.equal(
      classifyStockDocumentItemsReliability({
        itemsArrayPresent: true,
        rawItemCount: 2,
        mappedItemCount: 2,
      }),
      "complete_with_items"
    );
    assert.equal(
      classifyStockDocumentItemsReliability({
        itemsArrayPresent: true,
        rawItemCount: 0,
        mappedItemCount: 0,
      }),
      "complete_empty"
    );
    assert.equal(
      classifyStockDocumentItemsReliability({
        itemsArrayPresent: false,
        rawItemCount: 0,
        mappedItemCount: 0,
      }),
      "partial_absent_array"
    );
    assert.equal(
      classifyStockDocumentItemsReliability({
        itemsArrayPresent: true,
        rawItemCount: 2,
        mappedItemCount: 0,
      }),
      "partial_unmapped"
    );
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
    assert.equal(isoDateToNomusBrDate("2026-07-10"), "10/07/2026");
    const periodQuery = buildStockDocumentsQuery({
      tipo: "DocumentoSaida",
      from: "2025-07-01",
      to: "2026-07-10",
    });
    assert.equal(
      periodQuery,
      "dataEmissao>=01/07/2025;dataEmissao<=10/07/2026;tipoDocumentoEstoque==DocumentoSaida"
    );
    assert.ok(!periodQuery.includes("data>="));
    assert.ok(!periodQuery.includes("data<="));
    assert.ok(!periodQuery.includes("data=ge="));
    assert.ok(!periodQuery.includes("data=le="));
    assert.ok(!/(^|;)data(>=|<=|=ge=|=le=)/.test(periodQuery));
    assert.equal(
      buildStockDocumentsQuery({
        tipo: "DocumentoSaida",
        idNfe: 6937,
      }),
      "idNfe==6937;tipoDocumentoEstoque==DocumentoSaida"
    );
  });

  it("preview não habilita escrita", () => {
    assert.equal(shouldWriteStockDocuments("preview"), false);
    assert.equal(shouldWriteStockDocuments("apply"), true);
  });

  it("exit code ≠ 0 com erros ou payloads inválidos", () => {
    assert.equal(resolveStockDocumentsSyncExitCode({ errors: 0, invalidPayloads: 0 }), 0);
    assert.equal(resolveStockDocumentsSyncExitCode({ errors: 1, invalidPayloads: 0 }), 1);
    assert.equal(resolveStockDocumentsSyncExitCode({ errors: 0, invalidPayloads: 2 }), 1);
  });
});
