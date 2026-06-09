import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NomusNfeBillingClassification } from "@prisma/client";
import {
  classifyNomusNfeBilling,
  computeNomusNfeFiscalFlags,
  isGroupCompanyCnpj,
  isLogisticsNature,
  NOMUS_NFE_STATUS_CANCELLED,
} from "./nomusNfeClassification.js";
import { mapNomusNfePayload, stableNomusNfePayloadHash } from "./nomusNfeMapper.js";
import {
  computeValorLiquido,
  parseNfeXmlContent,
} from "./nomusNfeXmlParser.js";
import {
  buildNfesPageParams,
  hasNextNfesPage,
  passesNfesSyncLocalFilter,
  pickNfesArray,
  resolveNfesSyncCutoffDate,
  shouldStopNfesPagination,
} from "./nomusNfesSyncLogic.js";
import { buildNomusUrl, redactHeadersForLog } from "./nomusRestClient.js";

const SAMPLE_XML = `<?xml version="1.0"?>
<NFe xmlns="http://www.portalfiscal.inf.br/nfe">
  <infNFe>
    <ide>
      <natOp>VENDA MERCADO EXTERNO</natOp>
      <dhEmi>2024-06-15T10:00:00-03:00</dhEmi>
      <tpNF>1</tpNF>
    </ide>
    <dest><CNPJ>12345678000199</CNPJ></dest>
    <total><ICMSTot><vProd>1000.00</vProd><vDesc>50.00</vDesc><vNF>950.00</vNF></ICMSTot></total>
  </infNFe>
</NFe>`;

const LOGISTICS_XML = SAMPLE_XML.replace("VENDA MERCADO EXTERNO", "REMESSA PARA CONSERTO");

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
  });

  it("invalid xml sets quality alert without throwing", () => {
    const parsed = parseNfeXmlContent("<invalid");
    assert.ok(parsed.qualityAlert);
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
      billingClassification: NomusNfeBillingClassification.MARKET_REVENUE,
    });
    assert.equal(flags.isFiscalBilling, false);
  });
});

describe("nomusNfeMapper", () => {
  it("maps API payload with xml", () => {
    const raw = {
      id: 1001,
      numero: "123",
      status: 1,
      tipoOperacao: 1,
      isFornecedor: 0,
      ambiente: 1,
      dataProcessamento: "15/06/2024",
      xml: SAMPLE_XML,
    };
    const mapped = mapNomusNfePayload(raw);
    assert.equal(mapped.ok, true);
    if (!mapped.ok) return;
    assert.equal(mapped.row.externalId, 1001);
    assert.equal(mapped.row.valorLiquido?.toString(), "950");
    assert.equal(mapped.row.isMarketSale, true);
    assert.equal(stableNomusNfePayloadHash(raw).length, 64);
  });

  it("logistics xml is not market sale", () => {
    const mapped = mapNomusNfePayload({
      id: 2,
      status: 1,
      tipoOperacao: 1,
      isFornecedor: 0,
      ambiente: 1,
      xml: LOGISTICS_XML,
    });
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

  it("passesNfesSyncLocalFilter enforces production saída", () => {
    const cutoff = resolveNfesSyncCutoffDate(false);
    assert.equal(
      passesNfesSyncLocalFilter(
        { id: 1, tipoOperacao: 1, isFornecedor: 0, ambiente: 1, status: 1, dataProcessamento: "02/01/2024" },
        cutoff
      ).pass,
      true
    );
    assert.equal(
      passesNfesSyncLocalFilter({ id: 1, tipoOperacao: 0, ambiente: 1 }, cutoff).pass,
      false
    );
    assert.equal(
      passesNfesSyncLocalFilter({ id: 1, tipoOperacao: 1, ambiente: 2 }, cutoff).pass,
      false
    );
  });

  it("incremental cutoff is recent", () => {
    const cutoff = resolveNfesSyncCutoffDate(true, new Date("2026-05-28T12:00:00Z"));
    assert.ok(cutoff.getFullYear() >= 2026);
  });
});

describe("nomusRestClient security", () => {
  it("redactHeadersForLog hides authorization", () => {
    const redacted = redactHeadersForLog({ Authorization: "Bearer secret", Accept: "json" });
    assert.equal(redacted.Authorization, "***");
    assert.equal(redacted.Accept, "json");
  });

  it("buildNomusUrl for nfes without leaking auth", () => {
    const url = buildNomusUrl("https://api.example/rest/", "nfes", { pagina: "1" });
    assert.match(url.pathname, /nfes/);
    assert.equal(url.searchParams.get("pagina"), "1");
  });
});
