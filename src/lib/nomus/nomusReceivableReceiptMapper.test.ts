import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isNomusReceiptMapFailure,
  isNomusReceiptMapSuccess,
  mapNomusReceivableReceiptPayload,
  parseNomusReceiptCivilDate,
  receiptNeedsWrite,
  stableNomusPayloadHash,
} from "./nomusReceivableReceiptMapper.js";

/** Payload real observado em `GET /rest/recebimentos` (CR 18011 / RECEIPT 11011). */
function livePayload(overrides: Record<string, unknown> = {}) {
  return {
    baixaContaReceber: true,
    codigo: "REC-11011",
    comentarios: null,
    dataCompetencia: "30/07/2026",
    dataHoraCriacao: "30/07/2026 14:02:11",
    dataModificacao: "03/08/2026 09:15:00",
    dataRecebimento: "30/07/2026",
    desconto: "0,00",
    descricaoLancamento: "Recebimento NF 7479",
    id: 11011,
    idClassificacaoFinanceira: 12,
    idContaBancaria: 3,
    idContaReceber: 18505,
    idEmpresa: 1,
    idFormaPagamento: 5,
    idPessoa: 200,
    idUsuarioCriador: 9,
    multaJuros: "0,00",
    nomeClassificacaoFinanceira: "Receita de Vendas",
    nomeContaBancaria: "Viacredi",
    nomeEmpresa: "KOPPETEL",
    nomeFormaPagamento: "Transferência Bancária",
    nomePessoa: "Cliente A",
    nomeUsuarioCriador: "integracao",
    taxaBancaria: "1,50",
    valorRecebido: "2.775,90",
    ...overrides,
  };
}

describe("nomusReceivableReceiptMapper", () => {
  it("mapeia o contrato live completo", () => {
    const result = mapNomusReceivableReceiptPayload(livePayload());
    assert.equal(isNomusReceiptMapSuccess(result), true);
    if (!isNomusReceiptMapSuccess(result)) return;

    const row = result.row;
    assert.equal(row.externalId, 11011);
    assert.equal(row.receivableExternalId, 18505);
    assert.equal(row.receiptDate.toISOString(), "2026-07-30T00:00:00.000Z");
    assert.equal(row.competenceDate?.toISOString(), "2026-07-30T00:00:00.000Z");
    assert.equal(row.closesReceivable, true);
    assert.equal(row.receivedAmount.toString(), "2775.9");
    assert.equal(row.bankFeeAmount?.toString(), "1.5");
    assert.equal(row.lateFeeInterestAmount?.toString(), "0");
    assert.equal(row.discountAmount?.toString(), "0");
    assert.equal(row.code, "REC-11011");
    assert.equal(row.description, "Recebimento NF 7479");
    assert.equal(row.financialClassificationName, "Receita de Vendas");
    assert.equal(row.createdByUserName, "integracao");
    assert.equal(row.payloadHash, stableNomusPayloadHash(livePayload()));
  });

  it("data civil não desloca por fuso: 31/07 continua 31/07", () => {
    assert.equal(
      parseNomusReceiptCivilDate("31/07/2026")?.toISOString(),
      "2026-07-31T00:00:00.000Z"
    );
    assert.equal(
      parseNomusReceiptCivilDate("01/08/2026")?.toISOString(),
      "2026-08-01T00:00:00.000Z"
    );
    assert.equal(
      parseNomusReceiptCivilDate("2026-07-31")?.toISOString(),
      "2026-07-31T00:00:00.000Z"
    );
    assert.equal(
      parseNomusReceiptCivilDate("31/07/2026 23:45:00")?.toISOString(),
      "2026-07-31T00:00:00.000Z"
    );
  });

  it("rejeita data civil inexistente", () => {
    assert.equal(parseNomusReceiptCivilDate("31/02/2026"), null);
    assert.equal(parseNomusReceiptCivilDate("00/07/2026"), null);
    assert.equal(parseNomusReceiptCivilDate(""), null);
    assert.equal(parseNomusReceiptCivilDate(null), null);
  });

  it("valida id, idContaReceber, dataRecebimento e valorRecebido", () => {
    const semId = mapNomusReceivableReceiptPayload(livePayload({ id: null }));
    assert.equal(isNomusReceiptMapFailure(semId), true);
    if (isNomusReceiptMapFailure(semId)) assert.ok(semId.reasons.includes("MISSING_EXTERNAL_ID"));

    const semCr = mapNomusReceivableReceiptPayload(livePayload({ idContaReceber: null }));
    assert.equal(isNomusReceiptMapFailure(semCr), true);
    if (isNomusReceiptMapFailure(semCr)) assert.ok(semCr.reasons.includes("MISSING_RECEIVABLE_EXTERNAL_ID"));

    const semData = mapNomusReceivableReceiptPayload(livePayload({ dataRecebimento: null }));
    assert.equal(isNomusReceiptMapFailure(semData), true);
    if (isNomusReceiptMapFailure(semData)) assert.ok(semData.reasons.includes("MISSING_RECEIPT_DATE"));

    const semValor = mapNomusReceivableReceiptPayload(livePayload({ valorRecebido: null }));
    assert.equal(isNomusReceiptMapFailure(semValor), true);
    if (isNomusReceiptMapFailure(semValor)) assert.ok(semValor.reasons.includes("INVALID_RECEIVED_AMOUNT"));
  });

  it("recebimento zerado é válido (evento existe, valor é zero)", () => {
    const result = mapNomusReceivableReceiptPayload(livePayload({ valorRecebido: "0,00" }));
    assert.equal(isNomusReceiptMapSuccess(result), true);
    if (isNomusReceiptMapSuccess(result)) assert.equal(result.row.receivedAmount.toString(), "0");
  });

  it("idempotência: só reescreve quando o payload muda na origem", () => {
    const first = mapNomusReceivableReceiptPayload(livePayload());
    assert.equal(isNomusReceiptMapSuccess(first), true);
    if (!isNomusReceiptMapSuccess(first)) return;

    assert.equal(receiptNeedsWrite(null, first.row), true);
    assert.equal(receiptNeedsWrite({ payloadHash: first.row.payloadHash }, first.row), false);

    // `dataModificacao` mudou na origem ⇒ mesmo externalId é ATUALIZADO, não duplicado.
    const modified = mapNomusReceivableReceiptPayload(
      livePayload({ dataModificacao: "10/08/2026 08:00:00" })
    );
    assert.equal(isNomusReceiptMapSuccess(modified), true);
    if (!isNomusReceiptMapSuccess(modified)) return;
    assert.equal(modified.row.externalId, first.row.externalId);
    assert.notEqual(modified.row.payloadHash, first.row.payloadHash);
    assert.equal(receiptNeedsWrite({ payloadHash: first.row.payloadHash }, modified.row), true);
  });

  it("payload não expõe status/deleted/cancelled — exclusão na origem não é inferida", () => {
    const payload = livePayload();
    for (const key of ["status", "deleted", "cancelado", "cancelled", "excluido"]) {
      assert.equal(key in payload, false, `campo inesperado no contrato: ${key}`);
    }
    assert.equal(isNomusReceiptMapSuccess(mapNomusReceivableReceiptPayload(payload)), true);
  });
});
