import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import {
  classifyStockDocumentItemsReliability,
  computeEstimatedTotalValue,
  dedupeMappedStockDocumentItems,
  deriveStockDocumentCancellation,
  extractStockDocumentNumber,
  inspectStockDocumentItemsArray,
  mapNomusStockDocumentItem,
  mapNomusStockDocumentPayload,
  normalizeStockDocumentHeader,
  parseNomusStockQuantity,
  parseNomusStockUnitValue,
  pickItensDocumentoEstoque,
  resolveStockDocumentTotalValue,
  stableNomusStockDocumentPayloadHash,
} from "./nomusStockDocumentsMapper.js";
import {
  buildStockDocumentsQuery,
  decideStockDocumentHeaderAction,
  decideStockDocumentItemsAction,
  isoDateToNomusBrDate,
  parseStockDocumentsSyncCli,
  planStockDocumentPersist,
  resolveStockDocumentsNomusEmissionWindow,
  resolveStockDocumentsNomusToBoundExclusive,
  resolveStockDocumentsSyncExitCode,
  shouldWriteStockDocuments,
  summarizeStockDocumentPersistPlans,
} from "./nomusStockDocumentsSyncLogic.js";
import { computeStockDocumentsIncrementalWindow } from "./nomusStockDocumentsSyncLifecycle.js";
import { addCivilDays } from "./financeCivilDate.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

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

const richDocumentoSaidaHeader = {
  id: 8451,
  numero: "DS-8451",
  idNfe: 7208,
  tipoDocumentoEstoque: "DocumentoSaida",
  data: "10/07/2026 09:00:00",
  dataMovimentacao: "11/07/2026 14:30:00",
  status: "Cancelado",
  dataCancelamento: "12/07/2026 10:00:00",
  motivoCancelamento: "Solicitação do cliente",
  valorTotal: "1.234,56",
  idPessoa: 501,
  nomeCliente: "Cliente Exemplo LTDA",
  idEmpresa: 2,
  razaoSocialEmpresa: "Empresa Emissora SA",
  condicaoPagamento: "28 DDL",
  itensDocumentoEstoque: [
    { id: 1, idProduto: 100, qtde: "1", valorUnitario: "100,00" },
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
    assert.equal(mapped.row.totalValueSource, "items_sum");
    assert.equal(Number(mapped.row.totalValue?.toString()), 108240);
    assert.equal(mapped.row.isCancelled, false);
    assert.equal(mapped.row.documentNumber, null);
    assert.ok(mapped.row.payloadHash.length === 64);
  });

  it("normaliza cabeçalho enriquecido (DS-03.3) sem inferência insegura", () => {
    const mapped = mapNomusStockDocumentPayload(richDocumentoSaidaHeader);
    assert.equal(mapped.ok, true);
    if (!mapped.ok) return;
    assert.equal(mapped.row.documentNumber, "DS-8451");
    assert.equal(mapped.row.statusRaw, "Cancelado");
    assert.equal(mapped.row.isCancelled, true);
    assert.ok(mapped.row.cancelledAt);
    assert.equal(mapped.row.cancellationReason, "Solicitação do cliente");
    assert.equal(mapped.row.totalValueSource, "raw");
    assert.equal(Number(mapped.row.totalValue?.toString()), 1234.56);
    assert.equal(mapped.row.personExternalId, 501);
    assert.equal(mapped.row.personName, "Cliente Exemplo LTDA");
    assert.equal(mapped.row.companyExternalId, 2);
    assert.equal(mapped.row.companyName, "Empresa Emissora SA");
    assert.ok(mapped.row.movementDate);
    assert.equal(mapped.row.movementDate!.getDate(), 11);
    assert.equal(mapped.row.paymentTermsRaw, "28 DDL");
    assert.equal(
      mapped.row.payloadHash,
      stableNomusStockDocumentPayloadHash(richDocumentoSaidaHeader)
    );
  });

  it("documentNumber fica null quando igual ao externalId", () => {
    assert.equal(extractStockDocumentNumber({ numero: "8451" }, 8451), null);
    assert.equal(extractStockDocumentNumber({ numero: "DS-1" }, 8451), "DS-1");
  });

  it("não marca cancelado sem evidência explícita", () => {
    const none = deriveStockDocumentCancellation({ id: 1 }, "Aberto");
    assert.equal(none.isCancelled, false);
    const byFlag = deriveStockDocumentCancellation({ cancelado: true }, null);
    assert.equal(byFlag.isCancelled, true);
  });

  it("totalValue usa soma dos itens quando raw não traz total", () => {
    const mapped = mapNomusStockDocumentPayload(sampleDocumentoSaida6937);
    assert.equal(mapped.ok, true);
    if (!mapped.ok) return;
    const resolved = resolveStockDocumentTotalValue(
      sampleDocumentoSaida6937,
      mapped.row.items
    );
    assert.equal(resolved.totalValueSource, "items_sum");
    assert.equal(Number(resolved.totalValue?.toString()), 108240);
  });

  it("campos ausentes do cabeçalho permanecem null", () => {
    const mapped = mapNomusStockDocumentPayload({
      id: 1,
      itensDocumentoEstoque: [],
    });
    assert.equal(mapped.ok, true);
    if (!mapped.ok) return;
    assert.equal(mapped.row.documentNumber, null);
    assert.equal(mapped.row.statusRaw, null);
    assert.equal(mapped.row.personExternalId, null);
    assert.equal(mapped.row.personName, null);
    assert.equal(mapped.row.companyExternalId, null);
    assert.equal(mapped.row.companyName, null);
    assert.equal(mapped.row.movementDate, null);
    assert.equal(mapped.row.paymentTermsRaw, null);
    assert.equal(mapped.row.totalValue, null);
    assert.equal(mapped.row.totalValueSource, null);
  });

  it("schema Prisma contém campos DS-03.3 do NomusStockDocument", () => {
    const schemaPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../prisma/schema.prisma"
    );
    const schema = readFileSync(schemaPath, "utf8");
    assert.match(schema, /model NomusStockDocument \{[\s\S]*documentNumber/);
    assert.match(schema, /model NomusStockDocument \{[\s\S]*payloadHash/);
    assert.match(schema, /model NomusStockDocument \{[\s\S]*presentInLastPayload/);
    assert.match(schema, /model NomusStockDocument \{[\s\S]*@@index\(\[documentNumber\]\)/);
    assert.doesNotMatch(schema, /model OutputDocument /);
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
    // DS-SYNC-03: --to inclusivo → dataEmissao<= próximo dia civil
    assert.equal(
      periodQuery,
      "dataEmissao>=01/07/2025;dataEmissao<=11/07/2026;tipoDocumentoEstoque==DocumentoSaida"
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

  describe("DS-SYNC-03 —to inclusivo → bound exclusivo Nomus", () => {
    it("mesmo dia: 2026-07-23 → bound efetivo 2026-07-24", () => {
      assert.equal(resolveStockDocumentsNomusToBoundExclusive("2026-07-23"), "2026-07-24");
      assert.equal(addCivilDays("2026-07-23", 1), "2026-07-24");
      const window = resolveStockDocumentsNomusEmissionWindow({
        from: "2026-07-23",
        to: "2026-07-23",
      });
      assert.equal(window.requestedToInclusive, "2026-07-23");
      assert.equal(window.nomusToBoundExclusive, "2026-07-24");
      assert.equal(
        buildStockDocumentsQuery({
          tipo: "DocumentoSaida",
          from: "2026-07-23",
          to: "2026-07-23",
        }),
        "dataEmissao>=23/07/2026;dataEmissao<=24/07/2026;tipoDocumentoEstoque==DocumentoSaida"
      );
    });

    it("virada de mês: 2026-07-31 → 2026-08-01", () => {
      assert.equal(resolveStockDocumentsNomusToBoundExclusive("2026-07-31"), "2026-08-01");
      assert.equal(
        buildStockDocumentsQuery({
          tipo: "DocumentoSaida",
          from: "2026-07-31",
          to: "2026-07-31",
        }),
        "dataEmissao>=31/07/2026;dataEmissao<=01/08/2026;tipoDocumentoEstoque==DocumentoSaida"
      );
    });

    it("virada de ano: 2026-12-31 → 2027-01-01", () => {
      assert.equal(resolveStockDocumentsNomusToBoundExclusive("2026-12-31"), "2027-01-01");
      assert.equal(
        buildStockDocumentsQuery({
          tipo: "DocumentoSaida",
          from: "2026-12-31",
          to: "2026-12-31",
        }),
        "dataEmissao>=31/12/2026;dataEmissao<=01/01/2027;tipoDocumentoEstoque==DocumentoSaida"
      );
    });

    it("intervalo com vários dias mantém from e incrementa só o to", () => {
      assert.equal(
        buildStockDocumentsQuery({
          tipo: "DocumentoSaida",
          from: "2026-07-20",
          to: "2026-07-23",
        }),
        "dataEmissao>=20/07/2026;dataEmissao<=24/07/2026;tipoDocumentoEstoque==DocumentoSaida"
      );
    });

    it("intervalo inválido (data) preserva erro oficial do CLI", () => {
      assert.throws(
        () =>
          parseStockDocumentsSyncCli([
            "preview",
            "--from=2026-07-32",
            "--to=2026-07-23",
          ]),
        /--from inválida/
      );
      assert.throws(
        () =>
          parseStockDocumentsSyncCli([
            "preview",
            "--from=2026-07-23",
            "--to=2026-02-30",
          ]),
        /--to inválida/
      );
    });

    it("janela incremental/checkpoint não pré-incrementa o to", () => {
      const window = computeStockDocumentsIncrementalWindow({
        checkpointTo: "2026-07-10",
        now: new Date("2026-07-17T15:00:00.000Z"),
        overlapDays: 7,
      });
      assert.equal(window.to, "2026-07-17");
      const emission = resolveStockDocumentsNomusEmissionWindow({
        from: window.from,
        to: window.to,
      });
      assert.equal(emission.requestedToInclusive, "2026-07-17");
      assert.equal(emission.nomusToBoundExclusive, "2026-07-18");
      const query = buildStockDocumentsQuery({
        tipo: "DocumentoSaida",
        from: window.from,
        to: window.to,
      });
      assert.match(query, /dataEmissao<=18\/07\/2026/);
      assert.doesNotMatch(query, /dataEmissao<=19\/07\/2026/);
    });

    it("sync por idNfe não altera query (sem from/to)", () => {
      assert.equal(
        buildStockDocumentsQuery({
          tipo: "DocumentoSaida",
          idNfe: 8721,
        }),
        "idNfe==8721;tipoDocumentoEstoque==DocumentoSaida"
      );
      assert.doesNotMatch(
        buildStockDocumentsQuery({
          tipo: "DocumentoSaida",
          idNfe: 8721,
        }),
        /dataEmissao/
      );
    });

    it("preview não habilita escrita (checkpoint/persistência)", () => {
      const preview = parseStockDocumentsSyncCli([
        "preview",
        "--from=2026-07-23",
        "--to=2026-07-23",
      ]);
      assert.equal(preview.mode, "preview");
      assert.equal(shouldWriteStockDocuments(preview.mode), false);
    });
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

describe("normalizeStockDocumentHeader (DS-03.4)", () => {
  it("normaliza payload completo do próprio documento", () => {
    const header = normalizeStockDocumentHeader(richDocumentoSaidaHeader);
    assert.equal(header.ok, true);
    if (!header.ok) return;
    assert.equal(header.header.documentNumber, "DS-8451");
    assert.equal(header.header.statusRaw, "Cancelado");
    assert.equal(header.header.isCancelled, true);
    assert.ok(header.header.cancelledAt);
    assert.equal(header.header.cancellationReason, "Solicitação do cliente");
    assert.equal(Number(header.header.totalValue?.toString()), 1234.56);
    assert.equal(header.header.personExternalId, 501);
    assert.equal(header.header.companyExternalId, 2);
    assert.equal(header.header.paymentTermsRaw, "28 DDL");
    assert.equal(header.header.rawJson, richDocumentoSaidaHeader);
  });

  it("payload parcial preserva nulls sem inventar valores", () => {
    const header = normalizeStockDocumentHeader({
      id: 10,
      idNfe: 99,
      tipoDocumentoEstoque: "DocumentoSaida",
    });
    assert.equal(header.ok, true);
    if (!header.ok) return;
    assert.equal(header.header.documentNumber, null);
    assert.equal(header.header.statusRaw, null);
    assert.equal(header.header.totalValue, null);
    assert.equal(header.header.personExternalId, null);
    assert.equal(header.header.companyExternalId, null);
    assert.equal(header.header.movementDate, null);
    assert.equal(header.header.paymentTermsRaw, null);
    assert.equal(header.header.isCancelled, false);
  });

  it("campos ausentes não viram zero", () => {
    const header = normalizeStockDocumentHeader({ id: 11 });
    assert.equal(header.ok, true);
    if (!header.ok) return;
    assert.equal(header.header.totalValue, null);
    assert.equal(header.header.totalValueSource, null);
  });

  it("valor zero explícito é preservado (não vira null)", () => {
    const header = normalizeStockDocumentHeader({
      id: 12,
      valorTotal: "0,00",
      itensDocumentoEstoque: [],
    });
    assert.equal(header.ok, true);
    if (!header.ok) return;
    assert.equal(header.header.totalValueSource, "raw");
    assert.equal(Number(header.header.totalValue?.toString()), 0);
  });

  it("documento cancelado com evidência explícita", () => {
    const header = normalizeStockDocumentHeader({
      id: 13,
      cancelado: true,
      dataCancelamento: "01/02/2026",
      motivoCancelamento: "Erro de emissão",
    });
    assert.equal(header.ok, true);
    if (!header.ok) return;
    assert.equal(header.header.isCancelled, true);
    assert.ok(header.header.cancelledAt);
    assert.equal(header.header.cancellationReason, "Erro de emissão");
  });

  it("data inválida vira null", () => {
    const header = normalizeStockDocumentHeader({
      id: 14,
      data: "não-é-data",
      dataMovimentacao: "99/99/9999",
    });
    assert.equal(header.ok, true);
    if (!header.ok) return;
    assert.equal(header.header.dataDocumento, null);
    assert.equal(header.header.movementDate, null);
  });

  it("cliente ausente permanece null (sem inferir de Pedido/NF)", () => {
    const header = normalizeStockDocumentHeader({
      id: 15,
      idNfe: 7208,
      // sem idPessoa / nomeCliente / pessoa
    });
    assert.equal(header.ok, true);
    if (!header.ok) return;
    assert.equal(header.header.personExternalId, null);
    assert.equal(header.header.personName, null);
  });

  it("empresa ausente permanece null", () => {
    const header = normalizeStockDocumentHeader({
      id: 16,
      idNfe: 7208,
    });
    assert.equal(header.ok, true);
    if (!header.ok) return;
    assert.equal(header.header.companyExternalId, null);
    assert.equal(header.header.companyName, null);
  });

  it("payloadHash é estável para o mesmo payload", () => {
    const a = stableNomusStockDocumentPayloadHash(richDocumentoSaidaHeader);
    const b = stableNomusStockDocumentPayloadHash(richDocumentoSaidaHeader);
    assert.equal(a, b);
    assert.equal(a.length, 64);
    const header = normalizeStockDocumentHeader(richDocumentoSaidaHeader);
    assert.equal(header.ok, true);
    if (!header.ok) return;
    assert.equal(header.header.payloadHash, a);
  });

  it("mudança real no payload altera o hash", () => {
    const base = { id: 20, status: "Aberto", valorTotal: "10,00" };
    const changed = { ...base, status: "Fechado" };
    const hashA = stableNomusStockDocumentPayloadHash(base);
    const hashB = stableNomusStockDocumentPayloadHash(changed);
    assert.notEqual(hashA, hashB);
  });

  it("plano unchanged só com payloadHash igual (presença/timestamps no sync)", () => {
    const mapped = mapNomusStockDocumentPayload(sampleDocumentoSaida6937);
    assert.equal(mapped.ok, true);
    if (!mapped.ok) return;

    const unchanged = planStockDocumentPersist(mapped.row, {
      externalId: mapped.row.externalId,
      payloadHash: mapped.row.payloadHash,
      itemCount: 3,
    });
    assert.equal(unchanged.action, "unchanged");
    assert.equal(unchanged.headerAction, "unchanged");
    assert.equal(unchanged.itemsAction, "ignore");

    const changed = planStockDocumentPersist(mapped.row, {
      externalId: mapped.row.externalId,
      payloadHash: "0".repeat(64),
      itemCount: 3,
    });
    assert.equal(changed.action, "update");
    assert.equal(changed.headerAction, "write");
    assert.equal(changed.itemsAction, "replace");
  });

  it("decideStockDocumentHeaderAction cobre create/update/unchanged", () => {
    assert.equal(
      decideStockDocumentHeaderAction({
        exists: false,
        existingPayloadHash: null,
        incomingPayloadHash: "abc",
      }).action,
      "create"
    );
    assert.equal(
      decideStockDocumentHeaderAction({
        exists: true,
        existingPayloadHash: "abc",
        incomingPayloadHash: "abc",
      }).action,
      "unchanged"
    );
    assert.equal(
      decideStockDocumentHeaderAction({
        exists: true,
        existingPayloadHash: "",
        incomingPayloadHash: "abc",
      }).reason,
      "HEADER_BACKFILL_HASH"
    );
  });
});
