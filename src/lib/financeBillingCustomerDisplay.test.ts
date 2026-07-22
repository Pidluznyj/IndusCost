import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  extractNomusNfeDestNameFromXml,
  formatFinanceBillingCustomerDocument,
  resolveFinanceBillingCustomerDisplayName,
} from "./financeBillingCustomerDisplay.js";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("financeBillingCustomerDisplay", () => {
  it("prioriza nome do Customer sobre CNPJ", () => {
    assert.equal(
      resolveFinanceBillingCustomerDisplayName({
        tradeName: "Britânia",
        companyName: "Britania Eletrodomesticos SA",
        xmlDestCnpjCpf: "60878889000128",
      }),
      "Britânia"
    );
    assert.equal(
      resolveFinanceBillingCustomerDisplayName({
        companyName: "Britania Eletrodomesticos SA",
        xmlDestCnpjCpf: "60878889000128",
      }),
      "Britania Eletrodomesticos SA"
    );
  });

  it("usa xNome do XML quando não há Customer", () => {
    assert.equal(
      resolveFinanceBillingCustomerDisplayName({
        xmlDestName: "ESMALTEC S/A",
        xmlDestCnpjCpf: "60878889000128",
      }),
      "ESMALTEC S/A"
    );
  });

  it("formata CNPJ/CPF para exibição secundária", () => {
    assert.equal(
      formatFinanceBillingCustomerDocument("60878889000128"),
      "60.878.889/0001-28"
    );
    assert.equal(
      formatFinanceBillingCustomerDocument("12345678901"),
      "123.456.789-01"
    );
  });

  it("extrai xNome do bloco dest no XML", () => {
    const xml = `<dest><CNPJ>60878889000128</CNPJ><xNome>ESMALTEC S/A</xNome></dest>`;
    assert.equal(extractNomusNfeDestNameFromXml(xml), "ESMALTEC S/A");
  });

  it("dashboard/listagem não usam CNPJ como único rótulo de cliente", () => {
    const dash = read("src/lib/financeBillingNfeDashboard.ts");
    assert.match(dash, /LEFT JOIN "Customer"/);
    assert.match(dash, /tradeName/);
    assert.doesNotMatch(
      dash,
      /COALESCE\("xmlDestCnpjCpf", '—'\) AS customer_name/
    );
    const ui = read("src/components/finance/billing/FinanceBillingNfeDetailsTable.tsx");
    assert.match(ui, /row\.customerName/);
    assert.doesNotMatch(ui, /\{row\.xmlDestCnpjCpf \?\? "—"\}/);
  });

  it("SQL de xNome no dashboard evita escapes JS \\s\\S inválidos no PostgreSQL", () => {
    const dash = read("src/lib/financeBillingNfeDashboard.ts");
    assert.match(dash, /nfeXmlDestNameSql/);
    assert.match(dash, /NFE_XML_DEST_XNOME_REGEXP/);
    assert.doesNotMatch(dash, /\[\\\\s\\\\S\]/);
    assert.match(dash, /'is'/);
  });
});
