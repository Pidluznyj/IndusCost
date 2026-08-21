/**
 * Importação histórica do Google Forms — parsing e idempotência.
 *
 * Provas centrais: a data histórica é preservada, nota inválida não vira
 * palpite, linha repetida é detectada pelo conteúdo (não pela posição) e o
 * artefato "Choose / Opção 1" não entra no questionário.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildRowFingerprint,
  findDuplicateFingerprints,
  isRowValid,
  mapHeaders,
  normalizeHeader,
  parseImportedDate,
  parseImportedRating,
  parseImportMatrix,
} from "./satisfactionImport.js";

/** Cabeçalho realista de uma exportação do Google Forms. */
const HEADERS = [
  "Carimbo de data/hora",
  "Cliente (nome da empresa)",
  "CNPJ",
  "Telefone/celular para contato",
  "Data",
  "Responsável pelo preenchimento",
  "Atendimento comercial e telefônico",
  "Tempo de resposta a cotações e Pedidos",
  "Cumprimento do prazo de entrega",
  "Conformidade do Pedido",
  "Qualidade do Produto",
  "Suporte Técnico",
  "Descreva aqui elogios ou pontos que em sua opinião, poderiam ser melhorados",
];

function row(overrides: Partial<Record<number, unknown>> = {}): unknown[] {
  const base: unknown[] = [
    "15/03/2025 14:32:07",
    "Metalúrgica Silva LTDA",
    "12.345.678/0001-90",
    "(11) 98888-7777",
    "14/03/2025",
    "João Souza",
    "5",
    "4",
    "3",
    "5",
    "5",
    "4",
    "Atendimento muito bom, prazo poderia melhorar.",
  ];
  for (const [index, value] of Object.entries(overrides)) {
    base[Number(index)] = value;
  }
  return base;
}

describe("mapeamento de cabeçalhos", () => {
  it("associa cada coluna ao código correto", () => {
    const mapped = mapHeaders(HEADERS);
    const byHeader = new Map(mapped.map((m) => [m.header, m.code]));
    assert.equal(byHeader.get("Carimbo de data/hora"), "__TIMESTAMP__");
    assert.equal(byHeader.get("Cliente (nome da empresa)"), "CUSTOMER_NAME");
    assert.equal(byHeader.get("CNPJ"), "TAX_ID");
    assert.equal(byHeader.get("Atendimento comercial e telefônico"), "COMMERCIAL_SERVICE");
    assert.equal(byHeader.get("Qualidade do Produto"), "PRODUCT_QUALITY");
    assert.equal(byHeader.get("Suporte Técnico"), "TECHNICAL_SUPPORT");
  });

  it('padrão específico ganha do genérico ("Qualidade do Produto" não vira "Suporte")', () => {
    const mapped = mapHeaders(["Qualidade do Produto", "Suporte Técnico"]);
    assert.equal(mapped[0]?.code, "PRODUCT_QUALITY");
    assert.equal(mapped[1]?.code, "TECHNICAL_SUPPORT");
  });

  it("cada código é atribuído no máximo uma vez", () => {
    const codes = mapHeaders(HEADERS)
      .map((m) => m.code)
      .filter(Boolean);
    assert.equal(new Set(codes).size, codes.length);
  });

  it("coluna desconhecida fica sem código, e isso é reportável", () => {
    const parsed = parseImportMatrix([[...HEADERS, "Choose"], [...row(), "Opção 1"]]);
    assert.ok(parsed.unmappedHeaders.includes("Choose"));
  });

  it('ELIMINATÓRIO: "Choose / Opção 1" não vira pergunta do questionário', () => {
    const parsed = parseImportMatrix([[...HEADERS, "Choose"], [...row(), "Opção 1"]]);
    const codes = parsed.headers.map((h) => h.code).filter(Boolean);
    assert.equal(
      codes.some((code) => /choose|opcao/i.test(String(code))),
      false
    );
    // E a linha continua válida: o artefato é ignorado, não invalida o registro.
    assert.equal(parsed.rows[0] && isRowValid(parsed.rows[0]), true);
  });
});

describe("leitura de nota", () => {
  it("aceita os formatos que o Google Forms exporta", () => {
    assert.equal(parseImportedRating(5), 5);
    assert.equal(parseImportedRating("5"), 5);
    assert.equal(parseImportedRating("5 - Excelente"), 5);
    assert.equal(parseImportedRating("Excelente"), 5);
    assert.equal(parseImportedRating("1 - Ruim"), 1);
    assert.equal(parseImportedRating("Regular"), 2);
  });

  it("ELIMINATÓRIO: valor fora da escala vira null, nunca um palpite", () => {
    for (const bad of ["0", "6", "", null, undefined, "sem resposta", "N/A", 7]) {
      assert.equal(parseImportedRating(bad), null, `deveria rejeitar ${String(bad)}`);
    }
  });
});

describe("leitura de data", () => {
  it("entende dd/MM/yyyy com e sem hora", () => {
    const withTime = parseImportedDate("15/03/2025 14:32:07");
    assert.equal(withTime?.toISOString(), "2025-03-15T14:32:07.000Z");
    const onlyDate = parseImportedDate("14/03/2025");
    assert.equal(onlyDate?.toISOString(), "2025-03-14T00:00:00.000Z");
  });

  it("entende ISO e rejeita lixo", () => {
    assert.equal(parseImportedDate("2025-03-15T10:00:00Z")?.toISOString(), "2025-03-15T10:00:00.000Z");
    assert.equal(parseImportedDate("não é data"), null);
    assert.equal(parseImportedDate(""), null);
  });
});

describe("parse da planilha", () => {
  it("lê uma linha completa e válida", () => {
    const parsed = parseImportMatrix([HEADERS, row()]);
    assert.equal(parsed.rows.length, 1);
    const first = parsed.rows[0]!;
    assert.equal(isRowValid(first), true);
    assert.equal(first.declaredCompanyName, "Metalúrgica Silva LTDA");
    assert.equal(first.respondentName, "João Souza");
    assert.equal(first.ratings.PRODUCT_QUALITY, 5);
    assert.equal(first.ratings.DELIVERY_DEADLINE, 3);
  });

  it("ELIMINATÓRIO: preserva o instante histórico da submissão", () => {
    const parsed = parseImportMatrix([HEADERS, row()]);
    assert.equal(
      parsed.rows[0]?.originalSubmittedAt?.toISOString(),
      "2025-03-15T14:32:07.000Z",
      "a data do Google Forms não pode ser trocada pela data do import"
    );
  });

  it("linha em branco é ignorada", () => {
    const parsed = parseImportMatrix([HEADERS, row(), Array(HEADERS.length).fill("")]);
    assert.equal(parsed.rows.length, 1);
  });

  it("reporta obrigatórios ausentes sem descartar a linha", () => {
    const parsed = parseImportMatrix([HEADERS, row({ 1: "", 5: "" })]);
    const first = parsed.rows[0]!;
    assert.equal(isRowValid(first), false);
    assert.ok(first.issues.some((i) => i.includes("Cliente")));
    assert.ok(first.issues.some((i) => i.includes("Responsável")));
  });

  it("nota inválida é apontada linha a linha", () => {
    const parsed = parseImportMatrix([HEADERS, row({ 10: "nota errada" })]);
    const first = parsed.rows[0]!;
    assert.equal(first.ratings.PRODUCT_QUALITY, null);
    assert.ok(first.issues.some((i) => i.includes("PRODUCT_QUALITY")));
  });

  it("aponta pergunta obrigatória ausente na planilha inteira", () => {
    const withoutQuality = HEADERS.filter((h) => h !== "Qualidade do Produto");
    const parsed = parseImportMatrix([withoutQuality, row().filter((_, i) => i !== 10)]);
    assert.ok(parsed.missingQuestionCodes.includes("PRODUCT_QUALITY"));
  });
});

describe("impressão digital e duplicatas", () => {
  it("mesma linha gera a mesma impressão digital", () => {
    const parsed = parseImportMatrix([HEADERS, row(), row()]);
    assert.equal(parsed.rows[0]?.fingerprint, parsed.rows[1]?.fingerprint);
    assert.equal(findDuplicateFingerprints(parsed.rows).length, 1);
  });

  it("linha diferente gera impressão diferente", () => {
    const parsed = parseImportMatrix([HEADERS, row(), row({ 5: "Maria Lima" })]);
    assert.notEqual(parsed.rows[0]?.fingerprint, parsed.rows[1]?.fingerprint);
    assert.equal(findDuplicateFingerprints(parsed.rows).length, 0);
  });

  it("a impressão depende do CONTEÚDO, não da ordem no arquivo", () => {
    const direta = parseImportMatrix([HEADERS, row({ 5: "Ana" }), row({ 5: "Bruno" })]);
    const invertida = parseImportMatrix([HEADERS, row({ 5: "Bruno" }), row({ 5: "Ana" })]);
    assert.equal(direta.rows[0]?.fingerprint, invertida.rows[1]?.fingerprint);
    assert.equal(direta.rows[1]?.fingerprint, invertida.rows[0]?.fingerprint);
  });

  it("grafia diferente do mesmo cliente não gera duplicata falsa nem colisão", () => {
    const a = buildRowFingerprint({
      declaredCompanyName: "Metalúrgica Silva LTDA",
      declaredTaxId: "12.345.678/0001-90",
      respondentName: "João",
      originalSubmittedAt: new Date("2025-03-15T00:00:00Z"),
      ratings: { PRODUCT_QUALITY: 5 },
      openFeedback: "ok",
    });
    const b = buildRowFingerprint({
      declaredCompanyName: "metalurgica silva ltda",
      declaredTaxId: "12345678000190",
      respondentName: "joao",
      originalSubmittedAt: new Date("2025-03-15T00:00:00Z"),
      ratings: { PRODUCT_QUALITY: 5 },
      openFeedback: "ok",
    });
    assert.equal(a, b, "normalização deveria reconhecer o mesmo registro");
  });
});

describe("normalizeHeader", () => {
  it("remove acento, caixa e pontuação", () => {
    assert.equal(normalizeHeader("Suporte Técnico"), "suporte tecnico");
    assert.equal(normalizeHeader("  CNPJ/CPF  "), "cnpj cpf");
  });
});
