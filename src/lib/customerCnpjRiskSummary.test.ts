/**
 * Score CNPJ no grid de Clientes — motor puro, carga em lote e contrato do grid.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import {
  CUSTOMER_CNPJ_RISK_NO_LOOKUP_LABEL,
  buildCustomerCnpjRiskSummary,
  customerCnpjRiskTone,
  formatCustomerCnpjRiskTagLabel,
  formatCustomerCnpjRiskTooltip,
  normalizeCustomerTaxIdsForLookup,
  pickLatestCustomerCnpjLookups,
  type CustomerCnpjLookupRow,
} from "./customerCnpjRiskSummary.js";
import { attachCustomerCnpjRisk, type CustomerCnpjRiskDb } from "./customerCnpjRiskSummary.server.js";

const NOW = new Date("2026-09-07T18:00:00Z");

function lookup(partial: Partial<CustomerCnpjLookupRow> & { id: string }): CustomerCnpjLookupRow {
  return {
    cnpj: "24494303000176",
    customerId: null,
    source: "brasilapi+publica.cnpj.ws",
    riskScore: 83,
    riskVerdict: "VENDA LIBERADA",
    riskDetails: { riskLevel: "Baixo", saleRecommendation: "Prazos comerciais convencionais." },
    fetchedAt: new Date("2026-09-07T12:00:00Z"),
    expiresAt: new Date("2026-09-08T12:00:00Z"),
    ...partial,
  };
}

const CUSTOMERS = [
  { id: "c1", taxId: "24.494.303/0001-76" },
  { id: "c2", taxId: "11.111.111/0001-11" },
  { id: "c3", taxId: "" },
];

describe("pickLatestCustomerCnpjLookups", () => {
  it("usa o vínculo explícito (customerId) e, sem vínculo, o CNPJ normalizado — nunca nome", () => {
    const lookups = [
      lookup({ id: "l1", customerId: "c1", riskScore: 70, riskVerdict: "VENDA CONDICIONADA" }),
      lookup({ id: "l2", customerId: null, cnpj: "11111111000111", riskScore: 40, riskVerdict: "APENAS PAGAMENTO ANTECIPADO" }),
    ];
    const map = pickLatestCustomerCnpjLookups(CUSTOMERS, lookups, NOW);
    assert.equal(map.get("c1")?.score, 70);
    assert.equal(map.get("c2")?.score, 40);
    assert.equal(map.get("c2")?.verdict, "APENAS PAGAMENTO ANTECIPADO");
    assert.equal(map.has("c3"), false);
  });

  it("vence a consulta mais recente por cliente; vínculo explícito tem precedência sobre CNPJ", () => {
    const lookups = [
      lookup({ id: "old", customerId: "c1", riskScore: 50, fetchedAt: new Date("2026-09-01T12:00:00Z") }),
      lookup({ id: "new", customerId: "c1", riskScore: 83, fetchedAt: new Date("2026-09-07T12:00:00Z") }),
      // consulta livre mais recente do mesmo CNPJ, sem vínculo: não passa na frente do vínculo
      lookup({ id: "free", customerId: null, riskScore: 10, riskVerdict: "VENDA BLOQUEADA", fetchedAt: new Date("2026-09-07T15:00:00Z") }),
    ];
    const map = pickLatestCustomerCnpjLookups(CUSTOMERS, lookups, NOW);
    assert.equal(map.get("c1")?.lookupId, "new");
    assert.equal(map.get("c1")?.score, 83);
  });

  it("empate de data resolve por ID (determinístico) e não inventa consulta para CNPJ ausente", () => {
    const same = new Date("2026-09-07T12:00:00Z");
    const lookups = [
      lookup({ id: "a", customerId: "c1", riskScore: 60, fetchedAt: same }),
      lookup({ id: "b", customerId: "c1", riskScore: 61, fetchedAt: same }),
    ];
    const map = pickLatestCustomerCnpjLookups(CUSTOMERS, lookups, NOW);
    assert.equal(map.get("c1")?.lookupId, "b");
    assert.deepEqual(pickLatestCustomerCnpjLookups(CUSTOMERS, [], NOW).size, 0);
  });

  it("resumo expõe score, veredito, risco/recomendação persistidos e TTL vencido", () => {
    const fresh = buildCustomerCnpjRiskSummary(lookup({ id: "l1" }), NOW);
    assert.equal(fresh.expired, false);
    assert.equal(fresh.riskLevel, "Baixo");
    assert.equal(fresh.saleRecommendation, "Prazos comerciais convencionais.");
    const stale = buildCustomerCnpjRiskSummary(
      lookup({ id: "l2", expiresAt: new Date("2026-09-06T12:00:00Z"), riskDetails: null }),
      NOW
    );
    assert.equal(stale.expired, true);
    assert.equal(stale.riskLevel, null);
    assert.equal(stale.saleRecommendation, null);
  });

  it("normaliza taxIds para a consulta em lote (só CNPJ de 14 dígitos, sem duplicar)", () => {
    assert.deepEqual(
      normalizeCustomerTaxIdsForLookup([
        { id: "a", taxId: "24.494.303/0001-76" },
        { id: "b", taxId: "24494303000176" },
        { id: "c", taxId: "123.456.789-00" },
        { id: "d", taxId: null },
      ]),
      ["24494303000176"]
    );
  });
});

describe("apresentação da tag", () => {
  it("cores seguem o veredito do painel Consulta CNPJ; desconhecido é neutro", () => {
    assert.equal(customerCnpjRiskTone("VENDA LIBERADA"), "released");
    assert.equal(customerCnpjRiskTone("VENDA CONDICIONADA"), "conditional");
    assert.equal(customerCnpjRiskTone("APENAS PAGAMENTO ANTECIPADO"), "advance");
    assert.equal(customerCnpjRiskTone("VENDA BLOQUEADA"), "blocked");
    assert.equal(customerCnpjRiskTone("outra coisa"), "unknown");
  });

  it("rótulo e tooltip só formatam o que foi persistido", () => {
    const risk = buildCustomerCnpjRiskSummary(lookup({ id: "l1" }), NOW);
    assert.equal(formatCustomerCnpjRiskTagLabel(risk), "83 · VENDA LIBERADA");
    const tooltip = formatCustomerCnpjRiskTooltip(risk);
    assert.match(tooltip, /Score 83\/100 · VENDA LIBERADA/);
    assert.match(tooltip, /Risco: Baixo — Prazos comerciais convencionais\./);
    assert.match(tooltip, /Fonte: brasilapi\+publica\.cnpj\.ws/);
    assert.doesNotMatch(tooltip, /vencida/);
    const stale = buildCustomerCnpjRiskSummary(lookup({ id: "l2", expiresAt: new Date("2026-09-01T00:00:00Z") }), NOW);
    assert.match(formatCustomerCnpjRiskTooltip(stale), /Consulta vencida/);
    assert.equal(CUSTOMER_CNPJ_RISK_NO_LOOKUP_LABEL, "Sem consulta");
  });
});

describe("carga em lote (server)", () => {
  function fakeDb(rows: CustomerCnpjLookupRow[]) {
    const calls: unknown[] = [];
    const db = {
      customerCnpjLookup: {
        findMany: async (args: unknown) => {
          calls.push(args);
          return rows;
        },
      },
    } as unknown as CustomerCnpjRiskDb;
    return { db, calls };
  }

  it("uma única consulta para a página inteira (sem N+1), por customerId OU CNPJ", async () => {
    const many = Array.from({ length: 120 }, (_, i) => ({ id: `c${i}`, taxId: `24.494.303/0001-76`, companyName: `Cliente ${i}` }));
    const { db, calls } = fakeDb([lookup({ id: "l1", customerId: "c5" })]);
    const enriched = await attachCustomerCnpjRisk(db, many, NOW);
    assert.equal(calls.length, 1);
    const where = (calls[0] as { where: { OR: unknown[] } }).where;
    assert.equal(where.OR.length, 2);
    assert.equal(enriched.length, 120);
    assert.equal(enriched[5]!.cnpjRisk?.score, 83);
    assert.equal(enriched[5]!.companyName, "Cliente 5");
    // todos os demais compartilham o mesmo CNPJ na fixture → recebem a mesma consulta pelo CNPJ
    assert.equal(enriched[0]!.cnpjRisk?.lookupId, "l1");
  });

  it("lista vazia não consulta; cliente sem consulta recebe null explícito", async () => {
    const { db, calls } = fakeDb([]);
    assert.deepEqual(await attachCustomerCnpjRisk(db, [], NOW), []);
    assert.equal(calls.length, 0);
    const enriched = await attachCustomerCnpjRisk(db, [{ id: "x", taxId: "00.000.000/0001-91" }], NOW);
    assert.equal(enriched[0]!.cnpjRisk, null);
  });

  it("o serviço só lê (select mínimo, sem rawJson) e nunca dispara consulta externa", () => {
    const source = readFileSync("src/lib/customerCnpjRiskSummary.server.ts", "utf8");
    assert.doesNotMatch(source, /rawJson: true|normalizedSummary: true|commercialInsights: true/);
    assert.doesNotMatch(source, /fetch\(|buildCompanyIntelligencePayload|aggregateCnpjIntelligence|\.create\(|\.update\(/);
  });
});

describe("grid de Clientes — contrato", () => {
  const module = readFileSync("src/components/CustomerModule.tsx", "utf8");
  const server = readFileSync("server.ts", "utf8");

  it("API paginada anexa cnpjRisk a cada cliente", () => {
    assert.match(server, /buildCustomerListResponse\(await attachCustomerCnpjRisk\(prisma, items\), meta\)/);
  });

  it("coluna Documento saiu; coluna Score CNPJ entrou com a tag", () => {
    const header = /<thead[\s\S]*?<\/thead>/.exec(module)![0];
    assert.doesNotMatch(header, />Documento</);
    assert.match(header, />Score CNPJ</);
    assert.match(module, /<CustomerCnpjRiskTag risk=\{c\.cnpjRisk\} onConsult=/);
    assert.doesNotMatch(module, /whitespace-nowrap">\{c\.taxId\}<\/td>/);
  });

  it("sem rolagem horizontal e sem quebra de linha: table-fixed, colgroup e truncate", () => {
    assert.match(module, /overflow-x-hidden overflow-y-auto max-h-\[min\(70vh,640px\)\]/);
    assert.doesNotMatch(module, /min-w-\[880px\]/);
    assert.match(module, /<table className="w-full table-fixed text-left border-collapse">/);
    const colgroup = /<colgroup>[\s\S]*?<\/colgroup>/.exec(module);
    assert.ok(colgroup, "colgroup ausente");
    assert.equal((colgroup[0].match(/<col[\s/]/g) ?? []).length, 6);
    const tableCell = /<td className="px-3 py-1\.5 whitespace-nowrap">\s*<CustomerCnpjRiskTag/.exec(module);
    assert.ok(tableCell, "célula da tag deve ser nowrap");
    // Nenhum max-w nas células: larguras vêm do colgroup.
    assert.doesNotMatch(module, /max-w-\[(220|180|160)px\]/);
  });
});
