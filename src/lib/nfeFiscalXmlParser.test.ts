import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PD_02457_FISCAL, PD_02457_NFE_XML } from "./nfeFiscalFixtures.js";
import {
  NFE_FISCAL_PARSER_VERSION,
  NFE_TAX_SCOPE,
  computeHighlightedResidual,
  parseNfeFiscalXml,
  sumHeaderTaxAmount,
} from "./nfeFiscalXmlParser.js";

describe("nfeFiscalXmlParser — PD 02457 fixture", () => {
  it("produtos 3975, vNF 4104.19, IPI 129.19 — sem saldo financeiro", () => {
    const parsed = parseNfeFiscalXml(PD_02457_NFE_XML);
    assert.equal(parsed.parserVersion, NFE_FISCAL_PARSER_VERSION);
    assert.equal(parsed.source, "XML");
    assert.ok(parsed.xmlHash);
    assert.equal(parsed.totals.vProd, PD_02457_FISCAL.productsNet);
    assert.equal(parsed.totals.vDesc, 0);
    assert.equal(parsed.totals.vNF, PD_02457_FISCAL.vNF);
    assert.equal(parsed.totals.vIPI, PD_02457_FISCAL.ipi);
    assert.equal(sumHeaderTaxAmount(parsed.lines, "IPI"), PD_02457_FISCAL.ipi);
    assert.equal(parsed.highlightedResidual, 0);

    const productsNet = (parsed.totals.vProd ?? 0) - (parsed.totals.vDesc ?? 0);
    assert.equal(productsNet, 3975);
    assert.equal(
      Number((productsNet + (parsed.totals.vIPI ?? 0)).toFixed(2)),
      PD_02457_FISCAL.vNF
    );
    // Não inventar "saldo financeiro"
    assert.equal("financialBalance" in parsed, false);
  });

  it("não mistura HEADER e ITEM como tributos distintos na soma de exibição", () => {
    const parsed = parseNfeFiscalXml(PD_02457_NFE_XML);
    const headerIpi = parsed.lines.filter((l) => l.scope === NFE_TAX_SCOPE.HEADER && l.taxType === "IPI");
    const itemIpi = parsed.lines.filter((l) => l.scope === NFE_TAX_SCOPE.ITEM && l.taxType === "IPI");
    assert.equal(headerIpi.length, 1);
    assert.equal(itemIpi.length, 1);
    assert.equal(headerIpi[0]!.amount, 129.19);
    assert.equal(itemIpi[0]!.amount, 129.19);
    // Consumidor deve usar um escopo — soma dos dois seria duplicidade
    assert.notEqual(
      headerIpi[0]!.amount! + itemIpi[0]!.amount!,
      PD_02457_FISCAL.ipi
    );
  });
});

describe("nfeFiscalXmlParser — robustez", () => {
  it("XML ausente → MISSING sem throw", () => {
    const parsed = parseNfeFiscalXml(null);
    assert.equal(parsed.source, "MISSING");
    assert.equal(parsed.lines.length, 0);
    assert.ok(parsed.qualityAlert);
  });

  it("namespaces e ICMS00 / PIS / COFINS / IPI", () => {
    const xml = `<?xml version="1.0"?>
      <nfe:NFe xmlns:nfe="http://www.portalfiscal.inf.br/nfe">
        <nfe:infNFe>
          <nfe:ide><nfe:tpNF>1</nfe:tpNF><nfe:finNFe>1</nfe:finNFe></nfe:ide>
          <nfe:det nItem="1">
            <nfe:prod><nfe:NCM>12345678</nfe:NCM><nfe:CFOP>5101</nfe:CFOP><nfe:vProd>100.00</nfe:vProd></nfe:prod>
            <nfe:imposto>
              <nfe:ICMS><nfe:ICMS00><nfe:CST>00</nfe:CST><nfe:vBC>100.00</nfe:vBC><nfe:pICMS>18.00</nfe:pICMS><nfe:vICMS>18.00</nfe:vICMS></nfe:ICMS00></nfe:ICMS>
              <nfe:PIS><nfe:PISAliq><nfe:CST>01</nfe:CST><nfe:vPIS>1.65</nfe:vPIS></nfe:PISAliq></nfe:PIS>
              <nfe:COFINS><nfe:COFINSAliq><nfe:CST>01</nfe:CST><nfe:vCOFINS>7.60</nfe:vCOFINS></nfe:COFINSAliq></nfe:COFINS>
            </nfe:imposto>
          </nfe:det>
          <nfe:total><nfe:ICMSTot>
            <nfe:vProd>100.00</nfe:vProd><nfe:vDesc>0</nfe:vDesc>
            <nfe:vICMS>18.00</nfe:vICMS><nfe:vPIS>1.65</nfe:vPIS><nfe:vCOFINS>7.60</nfe:vCOFINS>
            <nfe:vNF>127.25</nfe:vNF>
          </nfe:ICMSTot></nfe:total>
        </nfe:infNFe>
      </nfe:NFe>`;
    const parsed = parseNfeFiscalXml(xml);
    assert.equal(parsed.totals.vICMS, 18);
    assert.equal(parsed.totals.vPIS, 1.65);
    assert.equal(parsed.totals.vCOFINS, 7.6);
    assert.ok(parsed.lines.some((l) => l.lineKey === "H:ICMS"));
    assert.ok(parsed.lines.some((l) => l.lineKey === "I:1:ICMS" && l.cst === "00"));
    assert.ok(parsed.lines.some((l) => l.lineKey === "I:1:PIS"));
  });

  it("ICMS-ST e FCP no grupo item", () => {
    const xml = `<NFe><infNFe>
      <ide><tpNF>1</tpNF><finNFe>1</finNFe></ide>
      <det nItem="1"><prod><CFOP>6401</CFOP><NCM>1</NCM></prod>
        <imposto><ICMS><ICMS10>
          <CST>10</CST><vBC>50</vBC><pICMS>12</pICMS><vICMS>6</vICMS>
          <vBCST>80</vBCST><pICMSST>18</pICMSST><vICMSST>14.40</vICMSST>
          <vFCP>1.00</vFCP>
        </ICMS10></ICMS></imposto>
      </det>
      <total><ICMSTot>
        <vProd>50</vProd><vICMS>6</vICMS><vST>14.40</vST><vFCP>1.00</vFCP><vNF>71.40</vNF>
      </ICMSTot></total>
    </infNFe></NFe>`;
    const parsed = parseNfeFiscalXml(xml);
    assert.equal(parsed.totals.vST, 14.4);
    assert.ok(parsed.lines.some((l) => l.taxType === "ICMS_ST" && l.scope === "ITEM"));
    assert.ok(parsed.lines.some((l) => l.taxType === "FCP" && l.scope === "ITEM"));
  });

  it("nota complementar (finNFe=2) e cancelamento não impedem parse", () => {
    const xml = `<NFe><infNFe>
      <ide><tpNF>1</tpNF><finNFe>2</finNFe></ide>
      <total><ICMSTot><vProd>10</vProd><vIPI>1</vIPI><vNF>11</vNF></ICMSTot></total>
    </infNFe></NFe>`;
    const parsed = parseNfeFiscalXml(xml);
    assert.equal(parsed.finalidade, 2);
    assert.equal(parsed.totals.vIPI, 1);
  });

  it("devolução finNFe=4", () => {
    const xml = `<NFe><infNFe>
      <ide><finNFe>4</finNFe><tpNF>0</tpNF></ide>
      <total><ICMSTot><vProd>100</vProd><vNF>100</vNF></ICMSTot></total>
    </infNFe></NFe>`;
    const parsed = parseNfeFiscalXml(xml);
    assert.equal(parsed.finalidade, 4);
    assert.equal(parsed.tpNF, 0);
  });

  it("IBS/CBS extensibleTotals + linha HEADER", () => {
    const xml = `<NFe><infNFe>
      <total><ICMSTot><vProd>10</vProd><vNF>12</vNF><vIBS>1.00</vIBS><vCBS>1.00</vCBS></ICMSTot></total>
    </infNFe></NFe>`;
    const parsed = parseNfeFiscalXml(xml);
    assert.equal(parsed.extensibleTotals?.vIBS, 1);
    assert.equal(parsed.extensibleTotals?.vCBS, 1);
    assert.ok(parsed.lines.some((l) => l.taxType === "IBS" && l.scope === "HEADER"));
  });

  it("computeHighlightedResidual com frete não vira imposto", () => {
    const residual = computeHighlightedResidual({
      vProd: 100,
      vDesc: 0,
      vFrete: 10,
      vSeg: 0,
      vOutro: 0,
      vII: 0,
      vIPI: 5,
      vIPIDevol: 0,
      vBC: null,
      vICMS: 0,
      vICMSDeson: 0,
      vBCST: null,
      vST: 0,
      vFCP: 0,
      vFCPST: 0,
      vFCPSTRet: 0,
      vPIS: 0,
      vCOFINS: 0,
      vISS: 0,
      vTotTrib: null,
      vNF: 115,
    });
    assert.equal(residual, 0);
  });

  it("unicidade de lineKey no resultado", () => {
    const parsed = parseNfeFiscalXml(PD_02457_NFE_XML);
    const keys = parsed.lines.map((l) => l.lineKey);
    assert.equal(keys.length, new Set(keys).size);
  });
});
