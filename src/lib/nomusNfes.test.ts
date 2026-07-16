import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { NomusNfeBillingClassification } from "@prisma/client";
import {
  buildNfeDiscardCounts,
  computeMarketRevenueMonthlyTotals,
  evaluateNfeBillingDiscardReason,
  normalizeNomusBooleanInt,
  summarizeNfeBillingPreview,
} from "./nomusNfeBillingEligibility.js";
import {
  classifyNomusNfeBilling,
  computeNomusNfeFiscalFlags,
  isGroupCompanyCnpj,
  isLogisticsNature,
  NOMUS_NFE_STATUS_CANCELLED,
  NOMUS_NFE_XML_CUTOFF,
} from "./nomusNfeClassification.js";
import { mapNomusNfePayload, stableNomusNfePayloadHash } from "./nomusNfeMapper.js";
import {
  computeValorLiquido,
  parseNfeXmlContent,
} from "./nomusNfeXmlParser.js";
import {
  buildNfesPageParams,
  formatNfesSyncCutoffIso,
  hasNextNfesPage,
  parseNfesSyncCutoffDate,
  passesNfesSyncLocalFilter,
  pickNfesArray,
  resolveNfesSyncCutoffDate,
  shouldStopNfesPagination,
} from "./nomusNfesSyncLogic.js";
import { NOMUS_NFES_SYNC_CUTOFF_DATE } from "./nomusNfesSyncConstants.js";
import { buildNomusUrl, redactHeadersForLog } from "./nomusRestClient.js";

const SAMPLE_XML = `<?xml version="1.0"?>
<NFe xmlns="http://www.portalfiscal.inf.br/nfe">
  <infNFe>
    <ide>
      <natOp>VENDA MERCADO EXTERNO</natOp>
      <dhEmi>2025-06-15T10:00:00-03:00</dhEmi>
      <tpNF>1</tpNF>
    </ide>
    <dest><CNPJ>12345678000199</CNPJ></dest>
    <total><ICMSTot><vProd>1000.00</vProd><vDesc>50.00</vDesc><vNF>950.00</vNF></ICMSTot></total>
  </infNFe>
</NFe>`;

const JUNE_2026_XML = SAMPLE_XML.replace(
  "2025-06-15T10:00:00-03:00",
  "2026-06-10T14:30:00-03:00"
).replace("1000.00", "245000.00").replace("50.00", "0.00").replace("950.00", "245000.00");

const CUTOFF_DAY_XML = SAMPLE_XML.replace(
  "2025-06-15T10:00:00-03:00",
  "2025-01-01T08:00:00-03:00"
);

const LOGISTICS_XML = SAMPLE_XML.replace("VENDA MERCADO EXTERNO", "REMESSA PARA CONSERTO");

function baseRaw(overrides: Record<string, unknown> = {}) {
  return {
    id: 1001,
    numero: "123",
    status: 1,
    tipoOperacao: 1,
    isFornecedor: 0,
    ambiente: 1,
    dataProcessamento: "15/06/2025",
    xml: SAMPLE_XML,
    ...overrides,
  };
}

describe("nomusNfeXmlParser", () => {
  it("parseNfeXmlContent extracts fiscal fields", () => {
    const parsed = parseNfeXmlContent(SAMPLE_XML);
    assert.equal(parsed.natOp, "VENDA MERCADO EXTERNO");
    assert.equal(parsed.tpNF, 1);
    assert.equal(parsed.destCnpjCpf, "12345678000199");
    assert.equal(parsed.vProd, 1000);
    assert.equal(parsed.vDesc, 50);
    assert.equal(parsed.vNF, 950);
    assert.ok(parsed.dhEmi);
  });

  it("computeValorLiquido = vProd - vDesc", () => {
    assert.equal(computeValorLiquido(1000, 50), 950);
    assert.equal(computeValorLiquido(1000, null), 1000);
    assert.ok(!Number.isNaN(computeValorLiquido(1000, 50)!));
    assert.ok(Number.isFinite(computeValorLiquido(1000, 50)!));
  });

  it("invalid xml sets quality alert without throwing", () => {
    const parsed = parseNfeXmlContent("<invalid");
    assert.ok(parsed.qualityAlert);
  });
});

describe("nomusNfeBillingEligibility", () => {
  it("normalizeNomusBooleanInt handles boolean/string/number", () => {
    assert.equal(normalizeNomusBooleanInt(true), 1);
    assert.equal(normalizeNomusBooleanInt(false), 0);
    assert.equal(normalizeNomusBooleanInt("true"), 1);
    assert.equal(normalizeNomusBooleanInt("false"), 0);
    assert.equal(normalizeNomusBooleanInt("1"), 1);
    assert.equal(normalizeNomusBooleanInt("0"), 0);
    assert.equal(normalizeNomusBooleanInt(1), 1);
    assert.equal(normalizeNomusBooleanInt(0), 0);
  });

  it("MARKET_REVENUE fiscalmente válida gera isMarketSale=true", () => {
    const mapped = mapNomusNfePayload(baseRaw());
    assert.equal(mapped.ok, true);
    if (!mapped.ok) return;
    assert.equal(mapped.row.billingClassification, NomusNfeBillingClassification.MARKET_REVENUE);
    assert.equal(mapped.row.isFiscalBilling, true);
    assert.equal(mapped.row.isMarketSale, true);
    assert.equal(evaluateNfeBillingDiscardReason(mapped.row), null);
  });

  it("MARKET_REVENUE com campos API ausentes ainda é market sale quando XML válido", () => {
    const mapped = mapNomusNfePayload(
      baseRaw({ tipoOperacao: undefined, isFornecedor: undefined, ambiente: undefined })
    );
    assert.equal(mapped.ok, true);
    if (!mapped.ok) return;
    assert.equal(mapped.row.isMarketSale, true);
  });

  it("status numérico e string são aceitos", () => {
    const numeric = mapNomusNfePayload(baseRaw({ status: 1 }));
    const stringStatus = mapNomusNfePayload(baseRaw({ status: "1" }));
    assert.equal(numeric.ok, true);
    assert.equal(stringStatus.ok, true);
    if (!numeric.ok || !stringStatus.ok) return;
    assert.equal(numeric.row.isMarketSale, true);
    assert.equal(stringStatus.row.isMarketSale, true);
  });

  it("ambiente numérico/string/ausente: só bloqueia quando explicitamente não produção", () => {
    const absent = mapNomusNfePayload(baseRaw({ ambiente: undefined }));
    const stringProd = mapNomusNfePayload(baseRaw({ ambiente: "1" }));
    const homolog = mapNomusNfePayload(baseRaw({ ambiente: 2 }));
    assert.equal(absent.ok, true);
    assert.equal(stringProd.ok, true);
    assert.equal(homolog.ok, true);
    if (!absent.ok || !stringProd.ok || !homolog.ok) return;
    assert.equal(absent.row.isMarketSale, true);
    assert.equal(stringProd.row.isMarketSale, true);
    assert.equal(homolog.row.isMarketSale, false);
    assert.equal(evaluateNfeBillingDiscardReason(homolog.row), "ambiente_nao_producao");
  });

  it("isFornecedor boolean/string/número: só bloqueia fornecedor explícito", () => {
    const boolFalse = mapNomusNfePayload(baseRaw({ isFornecedor: false }));
    const stringZero = mapNomusNfePayload(baseRaw({ isFornecedor: "0" }));
    const supplier = mapNomusNfePayload(baseRaw({ isFornecedor: true }));
    assert.equal(boolFalse.ok, true);
    assert.equal(stringZero.ok, true);
    assert.equal(supplier.ok, true);
    if (!boolFalse.ok || !stringZero.ok || !supplier.ok) return;
    assert.equal(boolFalse.row.isMarketSale, true);
    assert.equal(stringZero.row.isMarketSale, true);
    assert.equal(supplier.row.isMarketSale, false);
    assert.equal(evaluateNfeBillingDiscardReason(supplier.row), "fornecedor_entrada");
  });

  it("XML tpNF=1 é obrigatório para fiscal billing", () => {
    const entradaXml = SAMPLE_XML.replace("<tpNF>1</tpNF>", "<tpNF>0</tpNF>");
    const mapped = mapNomusNfePayload(baseRaw({ xml: entradaXml }));
    assert.equal(mapped.ok, true);
    if (!mapped.ok) return;
    assert.equal(mapped.row.isFiscalBilling, false);
    assert.equal(mapped.row.isMarketSale, false);
    assert.equal(evaluateNfeBillingDiscardReason(mapped.row), "tpnf_nao_saida");
  });

  it("dhEmi antes de 2025-01-01 descarta por data", () => {
    const oldXml = SAMPLE_XML.replace("2025-06-15", "2024-06-15");
    const mapped = mapNomusNfePayload(baseRaw({ xml: oldXml }));
    assert.equal(mapped.ok, true);
    if (!mapped.ok) return;
    assert.equal(mapped.row.isMarketSale, false);
    assert.equal(evaluateNfeBillingDiscardReason(mapped.row), "data_xml_antes_corte");
  });

  it("dhEmi em 2025-01-01 pode ser elegível", () => {
    const mapped = mapNomusNfePayload(baseRaw({ xml: CUTOFF_DAY_XML }));
    assert.equal(mapped.ok, true);
    if (!mapped.ok) return;
    assert.equal(mapped.row.isMarketSale, true);
    assert.equal(evaluateNfeBillingDiscardReason(mapped.row), null);
  });

  it("logística → isMarketSale=false", () => {
    const mapped = mapNomusNfePayload(baseRaw({ xml: LOGISTICS_XML }));
    assert.equal(mapped.ok, true);
    if (!mapped.ok) return;
    assert.equal(mapped.row.billingClassification, NomusNfeBillingClassification.LOGISTICS_NOT_REVENUE);
    assert.equal(mapped.row.isMarketSale, false);
    assert.equal(evaluateNfeBillingDiscardReason(mapped.row), "operacao_logistica");
  });

  it("grupo econômico → isMarketSale=false", () => {
    const groupXml = SAMPLE_XML.replace("12345678000199", "55717719000130");
    const mapped = mapNomusNfePayload(baseRaw({ xml: groupXml }));
    assert.equal(mapped.ok, true);
    if (!mapped.ok) return;
    assert.equal(mapped.row.billingClassification, NomusNfeBillingClassification.INTERCOMPANY);
    assert.equal(mapped.row.isMarketSale, false);
    assert.equal(evaluateNfeBillingDiscardReason(mapped.row), "grupo_economico");
  });

  it("cancelada → isMarketSale=false", () => {
    const mapped = mapNomusNfePayload(baseRaw({ status: NOMUS_NFE_STATUS_CANCELLED }));
    assert.equal(mapped.ok, true);
    if (!mapped.ok) return;
    assert.equal(mapped.row.isMarketSale, false);
    assert.equal(evaluateNfeBillingDiscardReason(mapped.row), "cancelada");
  });

  it("buildNfeDiscardCounts agrega motivos", () => {
    const rows = [1, 2, 3].map((id) => {
      const overrides =
        id === 2
          ? { id, xml: LOGISTICS_XML }
          : id === 3
            ? { id, status: NOMUS_NFE_STATUS_CANCELLED }
            : { id };
      const mapped = mapNomusNfePayload(baseRaw(overrides));
      assert.equal(mapped.ok, true);
      return mapped.ok ? mapped.row : null;
    }).filter((row): row is NonNullable<typeof row> => row != null);

    const counts = buildNfeDiscardCounts(rows, NOMUS_NFE_XML_CUTOFF);
    assert.equal(counts.operacao_logistica, 1);
    assert.equal(counts.cancelada, 1);
    assert.ok(Object.values(counts).every((n) => Number.isFinite(n)));
  });

  it("computeMarketRevenueMonthlyTotals sem NaN/Infinity", () => {
    const mapped = mapNomusNfePayload(baseRaw({ id: 99, xml: JUNE_2026_XML }));
    assert.equal(mapped.ok, true);
    if (!mapped.ok) return;
    const totals = computeMarketRevenueMonthlyTotals([mapped.row]);
    assert.equal(totals["2026-06"]?.count, 1);
    assert.equal(totals["2026-06"]?.total, 245000);
    assert.ok(Number.isFinite(totals["2026-06"]!.total));
  });

  it("summarizeNfeBillingPreview não tem mismatch MARKET_REVENUE elegível", () => {
    const mapped = mapNomusNfePayload(baseRaw());
    assert.equal(mapped.ok, true);
    if (!mapped.ok) return;
    const summary = summarizeNfeBillingPreview([mapped.row]);
    assert.equal(summary.marketRevenueEligible, 1);
    assert.equal(summary.marketRevenueFlagMismatches, 0);
  });
});

describe("nomusNfeClassification", () => {
  it("classifies logistics nature", () => {
    assert.equal(isLogisticsNature("REMESSA DE MERCADORIA"), true);
    assert.equal(
      classifyNomusNfeBilling({ natOp: "DEVOLUCAO DE VENDA", destCnpjCpf: "123" }),
      NomusNfeBillingClassification.LOGISTICS_NOT_REVENUE
    );
  });

  it("classifies group CNPJ including SM", () => {
    assert.equal(isGroupCompanyCnpj("55.717.719/0001-30"), true);
    assert.equal(
      classifyNomusNfeBilling({ natOp: "VENDA", destCnpjCpf: "55717719000130" }),
      NomusNfeBillingClassification.INTERCOMPANY
    );
  });

  it("classifies market revenue", () => {
    assert.equal(
      classifyNomusNfeBilling({ natOp: "VENDA", destCnpjCpf: "99999999000100" }),
      NomusNfeBillingClassification.MARKET_REVENUE
    );
  });

  it("cancelled status is not market sale", () => {
    const flags = computeNomusNfeFiscalFlags({
      status: NOMUS_NFE_STATUS_CANCELLED,
      tipoOperacao: 1,
      isFornecedor: 0,
      ambiente: 1,
      xmlTpNF: 1,
      xmlDhEmi: new Date("2025-06-15"),
      billingClassification: NomusNfeBillingClassification.MARKET_REVENUE,
    });
    assert.equal(flags.isMarketSale, false);
  });

  it("tpNF != 1 is not fiscal billing", () => {
    const flags = computeNomusNfeFiscalFlags({
      status: 1,
      tipoOperacao: 1,
      isFornecedor: 0,
      ambiente: 1,
      xmlTpNF: 0,
      xmlDhEmi: new Date("2025-06-15"),
      billingClassification: NomusNfeBillingClassification.MARKET_REVENUE,
    });
    assert.equal(flags.isFiscalBilling, false);
  });

  it("ambiente != 1 is not fiscal billing", () => {
    const flags = computeNomusNfeFiscalFlags({
      status: 1,
      tipoOperacao: 1,
      isFornecedor: 0,
      ambiente: 2,
      xmlTpNF: 1,
      xmlDhEmi: new Date("2025-06-15"),
      billingClassification: NomusNfeBillingClassification.MARKET_REVENUE,
    });
    assert.equal(flags.isFiscalBilling, false);
  });
});

describe("nomusNfeMapper", () => {
  it("maps API payload with xml", () => {
    const raw = baseRaw();
    const mapped = mapNomusNfePayload(raw);
    assert.equal(mapped.ok, true);
    if (!mapped.ok) return;
    assert.equal(mapped.row.externalId, 1001);
    assert.equal(mapped.row.valorLiquido?.toString(), "950");
    assert.equal(mapped.row.isMarketSale, true);
    assert.equal(stableNomusNfePayloadHash(raw).length, 64);
  });

  it("logistics xml is not market sale", () => {
    const mapped = mapNomusNfePayload(baseRaw({ id: 2, xml: LOGISTICS_XML }));
    assert.equal(mapped.ok, true);
    if (!mapped.ok) return;
    assert.equal(mapped.row.billingClassification, NomusNfeBillingClassification.LOGISTICS_NOT_REVENUE);
    assert.equal(mapped.row.isMarketSale, false);
  });
});

describe("nomusNfesSyncLogic", () => {
  it("pickNfesArray reads nfes array", () => {
    const rows = pickNfesArray({ nfes: [{ id: 1 }] });
    assert.equal(rows.length, 1);
  });

  it("pagination helpers", () => {
    assert.equal(shouldStopNfesPagination(0), true);
    assert.equal(hasNextNfesPage({ totalPaginas: 3 }, 1, 50), true);
    assert.equal(hasNextNfesPage({ totalPaginas: 3 }, 3, 50), false);
  });

  it("buildNfesPageParams uses pagina", () => {
    assert.deepEqual(buildNfesPageParams(2, 50), { pagina: "2" });
  });

  it("passesNfesSyncLocalFilter legado ainda rejeita entrada explícita", () => {
    const cutoff = resolveNfesSyncCutoffDate(false);
    assert.equal(
      passesNfesSyncLocalFilter(
        { id: 1, tipoOperacao: 1, isFornecedor: 0, ambiente: 1, status: 1, dataProcessamento: "02/01/2025" },
        cutoff
      ).pass,
      true
    );
    assert.equal(
      passesNfesSyncLocalFilter({ id: 1, tipoOperacao: 0, ambiente: 1 }, cutoff).pass,
      false
    );
  });

  it("cutoff padrão é 2025-01-01", () => {
    assert.equal(NOMUS_NFES_SYNC_CUTOFF_DATE, "2025-01-01");
    assert.equal(formatNfesSyncCutoffIso(resolveNfesSyncCutoffDate()), "2025-01-01");
    assert.equal(NOMUS_NFE_XML_CUTOFF.toISOString().slice(0, 10), "2025-01-01");
  });

  it("NOMUS_NFE_INCREMENTAL=1 usa 2025-01-01, não janela de 60 dias", () => {
    const cutoff = resolveNfesSyncCutoffDate(true, new Date("2026-05-28T12:00:00Z"));
    assert.equal(formatNfesSyncCutoffIso(cutoff), "2025-01-01");
    assert.notEqual(cutoff.getMonth(), 2);
  });

  it("NOMUS_NFE_INCREMENTAL=0 usa 2025-01-01", () => {
    const cutoff = resolveNfesSyncCutoffDate(false);
    assert.equal(formatNfesSyncCutoffIso(cutoff), "2025-01-01");
  });

  it("NOMUS_NFE_CUTOFF_DATE override por env", () => {
    const cutoff = parseNfesSyncCutoffDate({ NOMUS_NFE_CUTOFF_DATE: "2026-03-01" });
    assert.equal(formatNfesSyncCutoffIso(cutoff), "2026-03-01");
  });

  it("buildNfesPageParams não envia filtro de data à API", () => {
    assert.deepEqual(buildNfesPageParams(1, 50), { pagina: "1" });
    assert.ok(!Object.keys(buildNfesPageParams(1, 50)).some((k) => k.includes("data") || k.includes("corte")));
  });
});

describe("nomusNfesSync preview script", () => {
  it("preview não usa pré-filtro passesNfesSyncLocalFilter", () => {
    const script = readFileSync(join(process.cwd(), "scripts", "nomusNfesSync.ts"), "utf8");
    assert.ok(!script.includes("passesNfesSyncLocalFilter"));
    assert.ok(script.includes("summarizeNfeBillingPreview"));
    assert.ok(script.includes("discardCounts"));
    assert.ok(script.includes("marketRevenueByMonth"));
  });

  it("preview só persiste em modo apply", () => {
    const script = readFileSync(join(process.cwd(), "scripts", "nomusNfesSync.ts"), "utf8");
    assert.ok(script.includes('options.mode === "apply" ? await runApply'));
    assert.ok(script.includes('mode: "apply"'));
  });
});

describe("nomusRestClient security", () => {
  it("redactHeadersForLog hides authorization", () => {
    const redacted = redactHeadersForLog({ Authorization: "Bearer secret", Accept: "json" });
    assert.equal(redacted.Authorization, "<redigido>");
    assert.equal(redacted.Accept, "json");
  });

  it("buildNomusUrl for nfes without leaking auth", () => {
    const url = buildNomusUrl("https://api.example/rest/", "nfes", { pagina: "1" });
    assert.match(url.pathname, /nfes/);
    assert.equal(url.searchParams.get("pagina"), "1");
  });

  it("sync script não expõe XML bruto no preview JSON", () => {
    const script = readFileSync(join(process.cwd(), "scripts", "nomusNfesSync.ts"), "utf8");
    const previewBlock = script.slice(script.indexOf("preview: fetched.rows"));
    assert.ok(!previewBlock.includes("xmlRaw"));
    assert.ok(!previewBlock.includes("rawPayload"));
    assert.ok(!previewBlock.includes("xml:"));
  });
});
