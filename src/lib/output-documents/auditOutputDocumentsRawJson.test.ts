import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  accumulateRawJsonKeysFromPayload,
  buildPaymentTermsEvidence,
  buildRawJsonKeysSection,
  createRawJsonKeyAccumulatorMap,
  extractJsonKeyEntries,
  finalizeRawJsonKeyMatrix,
  hypothesizeFocusAreasForKey,
  identifyJsonValueType,
  limitExamples,
  maskCnpj,
  maskCpf,
  maskSensitiveIdentifier,
  sanitizeExampleValue,
} from "./auditOutputDocumentsRawJson.js";

describe("identifyJsonValueType / extractJsonKeyEntries", () => {
  it("identifica tipos básicos", () => {
    assert.equal(identifyJsonValueType(null), "null");
    assert.equal(identifyJsonValueType("x"), "string");
    assert.equal(identifyJsonValueType(1), "number");
    assert.equal(identifyJsonValueType(true), "boolean");
    assert.equal(identifyJsonValueType([]), "array");
    assert.equal(identifyJsonValueType({}), "object");
  });

  it("extrai chaves aninhadas com paths estáveis", () => {
    const entries = extractJsonKeyEntries({
      id: 8451,
      cliente: { cnpj: "12.345.678/0001-90", nome: "ACME" },
      condicaoPagamento: {
        parcelas: [{ numeroParcela: 1, dataVencimento: "01/08/2026", valor: "100,00" }],
      },
    });
    const keys = entries.map((e) => e.key);
    assert.ok(keys.includes("id"));
    assert.ok(keys.includes("cliente"));
    assert.ok(keys.includes("cliente.cnpj"));
    assert.ok(keys.includes("condicaoPagamento.parcelas"));
    assert.ok(keys.includes("condicaoPagamento.parcelas[0].valor"));
  });
});

describe("mascaramento e limitação de exemplos", () => {
  it("mascara CPF e CNPJ", () => {
    assert.equal(maskCpf("123.456.789-09"), "***.***.***-09");
    assert.equal(maskCpf("12345678909"), "***.***.***-09");
    assert.equal(maskCnpj("12.345.678/0001-90"), "**.***.***/****-90");
    assert.equal(maskCnpj("12345678000190"), "**.***.***/****-90");
  });

  it("mascara identificadores sensíveis em texto", () => {
    const masked = maskSensitiveIdentifier(
      "cliente 123.456.789-09 cnpj 12.345.678/0001-90 email joao.silva@example.com"
    );
    assert.ok(!masked.includes("123.456.789-09"));
    assert.ok(!masked.includes("12.345.678/0001-90"));
    assert.ok(masked.includes("***@example.com") || masked.includes("joa***@example.com"));
    assert.ok(!masked.includes("joao.silva@example.com"));
  });

  it("sanitiza exemplos sem dump de objeto completo", () => {
    const objExample = sanitizeExampleValue({ a: 1, b: 2, c: 3 });
    assert.match(objExample, /object keys=3/);
    assert.ok(!objExample.includes('"a"'));

    const cpfExample = sanitizeExampleValue("12345678909");
    assert.equal(cpfExample, "***.***.***-09");

    assert.deepEqual(limitExamples(["a", "b", "c", "d"], 2), ["a", "b"]);
    assert.deepEqual(limitExamples(["a"], 5), ["a"]);
  });
});

describe("hipóteses e matriz rawJson", () => {
  it("classifica focos como hipótese por nome da chave", () => {
    assert.ok(
      hypothesizeFocusAreasForKey("condicaoPagamento.parcelas").includes(
        "parcelas"
      )
    );
    assert.ok(
      hypothesizeFocusAreasForKey("condicaoPagamento").includes(
        "condicao_pagamento"
      )
    );
    assert.ok(hypothesizeFocusAreasForKey("idNfe").includes("nfe"));
    assert.ok(hypothesizeFocusAreasForKey("dataVencimento").includes("vencimentos"));
  });

  it("acumula matriz com percentual e exemplos limitados", () => {
    const acc = createRawJsonKeyAccumulatorMap();
    accumulateRawJsonKeysFromPayload(acc, {
      idNfe: 7208,
      condicaoPagamento: {
        formaPagamento: "boleto",
        parcelas: [{ valor: "10,00", dataVencimento: "01/01/2026" }],
      },
      cliente: { cnpj: "12345678000190" },
    });
    accumulateRawJsonKeysFromPayload(acc, {
      idNfe: 7209,
      status: "ativo",
    });

    const rows = finalizeRawJsonKeyMatrix(acc, 2);
    const idNfe = rows.find((r) => r.key === "idNfe");
    assert.ok(idNfe);
    assert.equal(idNfe!.appearances, 2);
    assert.equal(idNfe!.samplePercent, 100);
    assert.equal(idNfe!.classification, "hypothesis");

    const cnpj = rows.find((r) => r.key === "cliente.cnpj");
    assert.ok(cnpj);
    assert.ok(cnpj!.sanitizedExamples.some((ex) => ex.includes("****")));
    assert.ok(!cnpj!.sanitizedExamples.some((ex) => ex.includes("12345678000190")));

    const section = buildRawJsonKeysSection({
      sampleSize: 2,
      documentsScanned: 2,
      itemsScanned: 0,
      maxDepth: 8,
      rows,
    });
    assert.equal(section.keys.length, rows.length);
    assert.ok(section.focusHypotheses.some((f) => f.focus === "nfe" && f.matchingKeyCount > 0));

    const payment = buildPaymentTermsEvidence(rows, 2);
    assert.equal(payment.hypothesisOnly, true);
    assert.ok(payment.candidateKeys.length >= 1);
    assert.ok(
      payment.candidateKeys.some((k) => k.key.includes("condicaoPagamento"))
    );
  });
});
