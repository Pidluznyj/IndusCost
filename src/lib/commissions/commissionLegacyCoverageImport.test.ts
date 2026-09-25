/**
 * Importação da cobertura legada do Nomus: leitura tolerante do relatório e
 * associação determinística linha → título → recebimento (nunca no chute).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildLegacyCoverageRowsToCreate,
  countLegacyCoverageResults,
  matchLegacyCoverageRow,
  normalizeLegacyNfeNumber,
  parseLegacyCompetence,
  parseLegacyCoverageMatrix,
  parseLegacyDate,
  parseLegacyMoney,
  resolveLegacyCoverageHeaders,
  type LegacyCoverageImportRow,
  type LegacyMatchReceipt,
  type LegacyMatchReceivable,
} from "./commissionLegacyCoverageImport.js";
import {
  LEGACY_COVERAGE_IMPORT_CONFIRM,
  applyLegacyCoverageImport,
  hashLegacyCoverageFile,
  previewLegacyCoverageImport,
  readLegacyCoverageFile,
  type LegacyCoverageImportPlan,
} from "./commissionLegacyCoverageImport.server.js";

function row(partial: Partial<LegacyCoverageImportRow>): LegacyCoverageImportRow {
  return {
    rowNumber: 2,
    receivableExternalId: null,
    receiptExternalId: null,
    nfeNumber: null,
    customerName: null,
    amount: null,
    commissionAmount: null,
    competence: null,
    sellerName: null,
    installmentNumber: null,
    date: null,
    ...partial,
  };
}

function receivable(externalId: number, nf: string, customer: string, amount: number): LegacyMatchReceivable {
  return { externalId, sourceInvoiceNumber: nf, personName: customer, amountReceivable: amount };
}

function receipt(externalId: number, receivableExternalId: number, receiptDate: string, receivedAmount: number): LegacyMatchReceipt {
  return { externalId, receivableExternalId, receiptDate, receivedAmount };
}

function match(
  input: LegacyCoverageImportRow,
  context: {
    receivables?: LegacyMatchReceivable[];
    receipts?: LegacyMatchReceipt[];
    covered?: number[];
    claimed?: number[];
    reference?: { year: number; month: number };
  }
) {
  const receivables = context.receivables ?? [];
  const receipts = context.receipts ?? [];
  const byNfe = new Map<string, LegacyMatchReceivable[]>();
  for (const item of receivables) {
    const nf = normalizeLegacyNfeNumber(item.sourceInvoiceNumber);
    if (!nf) continue;
    byNfe.set(nf, [...(byNfe.get(nf) ?? []), item]);
  }
  const byReceivable = new Map<number, LegacyMatchReceipt[]>();
  for (const item of receipts) {
    byReceivable.set(item.receivableExternalId, [...(byReceivable.get(item.receivableExternalId) ?? []), item]);
  }
  return matchLegacyCoverageRow({
    row: input,
    reference: context.reference ?? { year: 2026, month: 9 },
    receivablesById: new Map(receivables.map((item) => [item.externalId, item])),
    receivablesByNfe: byNfe,
    receiptsByReceivable: byReceivable,
    coveredReceiptIds: new Set(context.covered ?? []),
    claimedReceiptIds: new Set(context.claimed ?? []),
  });
}

const ACQUAPER = receivable(19236, "7704", "ACQUAPER BEBEDOUROS E EQUIPAMENTOS LTDA", 499.35);
const ADNUSIA = receivable(19413, "7752", "ADNUSIA NOGUEIRA DE SOUZA NASCIMENTO", 365.3);

describe("importação da cobertura legada do Nomus — leitura", () => {
  it("normaliza cabeçalhos variados do relatório", () => {
    const headers = resolveLegacyCoverageHeaders([
      "Código da conta a receber",
      "NF-e",
      "Razão social",
      "Valor Duplicata",
      "Comissão calculada",
      "Competência",
      "Vendedor",
      "Parcela",
      "Data recebimento",
    ]);
    assert.deepEqual(headers, {
      receivableExternalId: 0,
      nfeNumber: 1,
      customerName: 2,
      amount: 3,
      commissionAmount: 4,
      competence: 5,
      sellerName: 6,
      installmentNumber: 7,
      date: 8,
    });
    assert.equal(resolveLegacyCoverageHeaders(["ID CR", "Nota", "Valor recebido", "Comissão"]).receivableExternalId, 0);
    assert.equal(resolveLegacyCoverageHeaders(["Conta a receber", "Valor"]).receivableExternalId, 0);
  });

  it("valores, datas e competências em formatos brasileiros e do Excel", () => {
    assert.equal(parseLegacyMoney("R$ 1.234,56"), 1234.56);
    assert.equal(parseLegacyMoney("1,234.56"), 1234.56);
    assert.equal(parseLegacyMoney("499,35"), 499.35);
    assert.equal(parseLegacyMoney(17.2), 17.2);
    assert.equal(parseLegacyMoney("(10,00)"), -10);
    assert.equal(parseLegacyMoney(""), null);
    assert.equal(parseLegacyDate("26/08/2026"), "2026-08-26");
    assert.equal(parseLegacyDate("2026-08-31"), "2026-08-31");
    assert.equal(parseLegacyDate(46260), "2026-08-26");
    assert.deepEqual(parseLegacyCompetence("09/2026"), { year: 2026, month: 9 });
    assert.deepEqual(parseLegacyCompetence("2026-09"), { year: 2026, month: 9 });
    assert.deepEqual(parseLegacyCompetence("set/2026"), { year: 2026, month: 9 });
  });

  it("acha o cabeçalho depois de linhas de título e ignora linhas vazias", () => {
    const parsed = parseLegacyCoverageMatrix([
      ["Relatório de comissões — setembro/2026"],
      [""],
      ["CR", "NF", "Cliente", "Valor", "Comissão"],
      [19236, "7704", "ACQUAPER", "499,35", "17,20"],
      ["", "", "", "", ""],
      [19413, "7752", "ADNUSIA", 365.3, 10],
    ]);
    assert.equal(parsed.headerRowNumber, 3);
    assert.equal(parsed.rows.length, 2);
    assert.equal(parsed.rows[0]!.receivableExternalId, 19236);
    assert.equal(parsed.rows[0]!.amount, 499.35);
    assert.equal(parsed.rows[0]!.commissionAmount, 17.2);
    assert.equal(parsed.rows[1]!.rowNumber, 6);
    assert.deepEqual(parseLegacyCoverageMatrix([["Cliente", "Total"]]).errors.length, 1);
  });

  it("aceita CSV (mesmo leitor do XLSX) e o hash identifica o arquivo", () => {
    const csv = Buffer.from("CR,NF,Valor,Comissão\n19236,7704,499.35,17.20\n", "utf8");
    const parsed = parseLegacyCoverageMatrix(readLegacyCoverageFile(csv));
    assert.equal(parsed.rows.length, 1);
    assert.equal(parsed.rows[0]!.receivableExternalId, 19236);
    assert.equal(parsed.rows[0]!.amount, 499.35);
    assert.equal(hashLegacyCoverageFile(csv), hashLegacyCoverageFile(Buffer.from(csv)));
    assert.notEqual(hashLegacyCoverageFile(csv), hashLegacyCoverageFile(Buffer.from(`${csv}\n`)));
  });
});

describe("importação da cobertura legada do Nomus — associação", () => {
  it("CR explícito com um recebimento → MATCHED por RECEIVABLE_ID (CR 19236)", () => {
    const result = match(row({ receivableExternalId: 19236, amount: 499.35, commissionAmount: 17.2 }), {
      receivables: [ACQUAPER],
      receipts: [receipt(90001, 19236, "2026-08-26", 499.35)],
    });
    assert.equal(result.status, "MATCHED");
    assert.equal(result.associationMethod, "RECEIVABLE_ID");
    assert.deepEqual(result.receiptExternalIds, [90001]);
  });

  it("sem CR: NF + valor + cliente → MATCHED (CR 19413)", () => {
    const result = match(row({ nfeNumber: "007752", customerName: "Adnusia Nogueira", amount: 365.3 }), {
      receivables: [ACQUAPER, ADNUSIA],
      receipts: [receipt(90002, 19413, "2026-08-31", 365.3)],
    });
    assert.equal(result.status, "MATCHED");
    assert.equal(result.receivableExternalId, 19413);
    assert.equal(result.associationMethod, "RECEIVABLE_AMOUNT_DATE");
  });

  it("NF com dois títulos compatíveis → AMBIGUOUS (nunca escolhe)", () => {
    const result = match(row({ nfeNumber: "8000", amount: 500 }), {
      receivables: [receivable(1, "8000", "CLIENTE", 500), receivable(2, "8000", "CLIENTE", 500)],
      receipts: [receipt(11, 1, "2026-08-10", 500), receipt(12, 2, "2026-09-10", 500)],
    });
    assert.equal(result.status, "AMBIGUOUS");
    assert.equal(result.receiptExternalIds.length, 0);
  });

  it("vários recebimentos: valor exato decide; valor igual ao total cobre todos; senão AMBIGUOUS", () => {
    const receipts = [receipt(21, 30000, "2026-08-05", 400), receipt(22, 30000, "2026-09-05", 600)];
    const receivables = [receivable(30000, "9000", "CLIENTE", 1000)];
    assert.deepEqual(match(row({ receivableExternalId: 30000, amount: 600 }), { receivables, receipts }).receiptExternalIds, [22]);
    assert.deepEqual(match(row({ receivableExternalId: 30000, amount: 1000 }), { receivables, receipts }).receiptExternalIds, [21, 22]);
    assert.equal(match(row({ receivableExternalId: 30000, amount: 700 }), { receivables, receipts }).status, "AMBIGUOUS");
    assert.equal(match(row({ receivableExternalId: 30000 }), { receivables, receipts }).status, "AMBIGUOUS");
  });

  it("recebimento parcial: A já coberto, B novo → só B é associado", () => {
    const result = match(row({ receivableExternalId: 30000, amount: 1000 }), {
      receivables: [receivable(30000, "9000", "CLIENTE", 1000)],
      receipts: [receipt(21, 30000, "2026-08-05", 400), receipt(22, 30000, "2026-09-05", 600)],
      covered: [21],
    });
    assert.equal(result.status, "MATCHED");
    assert.deepEqual(result.receiptExternalIds, [22]);
    assert.deepEqual(result.alreadyCoveredReceiptIds, [21]);
  });

  it("reimportação: tudo já coberto → ALREADY_COVERED; evento já usado por outra linha → AMBIGUOUS", () => {
    const context = {
      receivables: [ACQUAPER],
      receipts: [receipt(90001, 19236, "2026-08-26", 499.35)],
    };
    assert.equal(match(row({ receivableExternalId: 19236 }), { ...context, covered: [90001] }).status, "ALREADY_COVERED");
    assert.equal(match(row({ receivableExternalId: 19236 }), { ...context, claimed: [90001] }).status, "AMBIGUOUS");
  });

  it("só recebimentos até o fim da competência do relatório e antes do cutover", () => {
    const receivables = [receivable(40000, "9100", "CLIENTE", 1000)];
    // Relatório de agosto não cobre recebimento de setembro.
    assert.equal(
      match(row({ receivableExternalId: 40000 }), {
        receivables,
        receipts: [receipt(41, 40000, "2026-09-02", 1000)],
        reference: { year: 2026, month: 8 },
      }).status,
      "UNMATCHED"
    );
    // Recebimento pós-cutover nunca é coberto pelo Nomus.
    assert.equal(
      match(row({ receivableExternalId: 40000 }), {
        receivables,
        receipts: [receipt(42, 40000, "2026-10-02", 1000)],
      }).status,
      "UNMATCHED"
    );
  });

  it("CR inexistente → UNMATCHED; linha sem CR/NF → INVALID; contagens", () => {
    const unmatched = match(row({ receivableExternalId: 99999, amount: 10 }), {});
    const invalid = match(row({ customerName: "SEM CHAVE", amount: 10 }), {});
    assert.equal(unmatched.status, "UNMATCHED");
    assert.equal(invalid.status, "INVALID");
    const counts = countLegacyCoverageResults([unmatched, invalid]);
    assert.equal(counts.rowCount, 2);
    assert.equal(counts.unmatchedCount, 1);
    assert.equal(counts.invalidCount, 1);
  });

  it("cobertura por evento: comissão da linha rateada pelo valor (soma exata)", () => {
    const result = match(row({ receivableExternalId: 30000, amount: 1000, commissionAmount: 30.01 }), {
      receivables: [receivable(30000, "9000", "CLIENTE", 1000)],
      receipts: [receipt(21, 30000, "2026-08-05", 400), receipt(22, 30000, "2026-09-05", 600)],
    });
    const rows = buildLegacyCoverageRowsToCreate({
      results: [result],
      receiptsById: new Map([
        [21, receipt(21, 30000, "2026-08-05", 400)],
        [22, receipt(22, 30000, "2026-09-05", 600)],
      ]),
      reference: { year: 2026, month: 9 },
      filename: "nomus-09.xlsx",
    });
    assert.equal(rows.length, 2);
    assert.equal(rows[0]!.naturalMonth, 8);
    assert.equal(rows[1]!.naturalMonth, 9);
    assert.equal(rows[0]!.coveredMonth, 9);
    assert.equal(rows[0]!.legacyReference, "nomus-09.xlsx#L2");
    assert.equal(Math.round(((rows[0]!.coveredCommissionAmount ?? 0) + (rows[1]!.coveredCommissionAmount ?? 0)) * 100) / 100, 30.01);
  });
});

describe("importação da cobertura legada do Nomus — guardas", () => {
  it("competência do relatório a partir do cutover é recusada (fonte oficial passa a ser o IndusCost)", async () => {
    await assert.rejects(
      previewLegacyCoverageImport({} as never, {
        buffer: Buffer.from("CR,Valor\n1,10\n"),
        filename: "x.csv",
        reference: { year: 2026, month: 10 },
      }),
      /antes de 10\/2026/
    );
  });

  it("apply exige a frase de confirmação e arquivo válido — nada é gravado sem ela", async () => {
    const plan: LegacyCoverageImportPlan = {
      filename: "x.csv",
      fileHash: "hash",
      reference: { year: 2026, month: 9 },
      existingImportId: null,
      parseErrors: [],
      results: [],
      counts: countLegacyCoverageResults([]),
      coverageRows: [],
    };
    const untouched = {} as never;
    await assert.rejects(
      applyLegacyCoverageImport(untouched, plan, { importedBy: "tester", confirm: "sim" }),
      /IMPORTAR COBERTURA NOMUS/
    );
    await assert.rejects(
      applyLegacyCoverageImport(untouched, { ...plan, parseErrors: ["Cabeçalho não encontrado"] }, {
        importedBy: "tester",
        confirm: LEGACY_COVERAGE_IMPORT_CONFIRM,
      }),
      /Arquivo inválido/
    );
  });
});
