import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as XLSX from "xlsx";
import { parseCrmCustomReportRequest } from "./crmCustomReportCore.js";
import { exportCrmCustomReport, exportCrmReportsOperationalList } from "./crmReportsExportService.server.js";
import { loadCrmReportsOperational } from "./crmReportsOperationalService.server.js";
import type { CrmCustomReportRequest } from "./crmReportsTypes.js";
import {
  A,
  B,
  C,
  GLOBAL_SCOPE,
  NOW,
  OWN_GISLENE_SCOPE,
  baseDb,
  createFakeDataSource,
  mockAuth,
  request,
} from "./crmReportsService.fixtures.js";

// Fixtures compartilhadas (hoje = 11/09/2026 10:00). A exportação precisa
// sair do MESMO pipeline da tela: os testes comparam com o endpoint das listas.

const AUTH = mockAuth({ role: "COMMERCIAL_MANAGER" });
const GISLENE_AUTH = mockAuth({ permissions: ["crm.view", "crm.seller.own"], externalSellerId: 464 });

function csvText(body: string | Uint8Array): string {
  assert.equal(typeof body, "string");
  return body as string;
}

/** Linhas de dados do CSV (depois do cabeçalho da tabela). */
function csvDataRows(csv: string, headerStart: string): string[][] {
  const lines = csv.split("\r\n");
  const header = lines.findIndex((l) => l.startsWith(headerStart));
  assert.ok(header > 0, "cabeçalho da tabela presente");
  return lines.slice(header + 1).filter(Boolean).map((l) => l.split(";"));
}

function customSpec(body: Partial<CrmCustomReportRequest>) {
  const parsed = parseCrmCustomReportRequest({ dimensions: ["customer"], metrics: ["soldValue", "orders"], ...body });
  if (parsed.ok !== true) throw new Error(parsed.errors.join(" "));
  return parsed.spec;
}

describe("exportação das listas — mesmo spec, todas as páginas", () => {
  it("Atrasados para recompra: mesmas linhas/ordem da tela (sem paginação), metadados completos", async () => {
    const body = { views: { overdue: { severity: "ALL", sort: "DELAY_DESC" } }, pagination: { overdue: { limit: 1 } } };
    const screen = await loadCrmReportsOperational(createFakeDataSource(baseDb()).ds, GLOBAL_SCOPE, request(body), { now: NOW });
    const everything = await loadCrmReportsOperational(
      createFakeDataSource(baseDb()).ds,
      GLOBAL_SCOPE,
      request({ ...body, pagination: { overdue: { limit: 100 } } }),
      { now: NOW }
    );
    assert.equal(screen.overdueRepurchase.returned, 1);

    const { ds, calls } = createFakeDataSource(baseDb());
    const file = await exportCrmReportsOperationalList({
      ds,
      scope: GLOBAL_SCOPE,
      auth: AUTH,
      request: request(body),
      list: "overdue",
      format: "csv",
      options: { now: NOW },
    });
    assert.equal(file.filename, "crm-relatorio-atrasados-recompra-20260911-1000.csv");
    assert.equal(file.contentType, "text/csv; charset=utf-8");
    assert.equal(file.rowCount, screen.overdueRepurchase.total);

    const csv = csvText(file.body);
    const rows = csvDataRows(csv, "Cliente;CNPJ/CPF;Responsável Comercial;Vendedor do último pedido");
    assert.deepEqual(
      rows.map((r) => r[0]),
      everything.overdueRepurchase.rows.map((r) => r.displayName)
    );
    assert.match(csv, /^\uFEFF# Relatório: Atrasados para recompra\r\n/);
    assert.match(csv, /# Gerado em: 11\/09\/2026 10:00 /);
    assert.match(csv, /# Usuário: Test User <test@example\.com>/);
    assert.match(csv, /# Escopo: Global/);
    assert.match(csv, /# Fonte: Pedidos de Venda — .*NF, proposta, atividade e comissão não criam compra\./);
    assert.match(csv, /# Eixo de data: SalesOrder\.issueDate — dia civil local/);
    assert.match(csv, /# Motor de recompra: LAST_6_DISTINCT_PURCHASE_DAYS_MEAN_V1/);
    assert.match(csv, /# Filtro — Recorte \(lista\): /);
    assert.match(csv, /# Filtro — Ordenação \(lista\): /);
    assert.match(csv, new RegExp(`# Linhas exportadas: ${screen.overdueRepurchase.total}\\r\\n`));
    // Enriquecimento em lote (sem N+1): uma consulta de atividades para a lista inteira.
    assert.equal(calls.findActivities.length, 1);
    assert.equal(calls.findSalesOrders.length, 1);
  });

  it("Ciclo de recompra respeita a visão (situação) e não carrega vendedor à toa", async () => {
    const body = { views: { cadence: { statuses: ["INSUFFICIENT_HISTORY"] } } };
    const screen = await loadCrmReportsOperational(createFakeDataSource(baseDb()).ds, GLOBAL_SCOPE, request(body), { now: NOW });
    const { ds, calls } = createFakeDataSource(baseDb());
    const file = await exportCrmReportsOperationalList({
      ds,
      scope: GLOBAL_SCOPE,
      auth: AUTH,
      request: request(body),
      list: "cadence",
      format: "csv",
      options: { now: NOW },
    });
    const rows = csvDataRows(csvText(file.body), "Cliente;CNPJ/CPF;Responsável Comercial;Ocasiões analisadas");
    assert.deepEqual(rows.map((r) => r[0]), screen.repurchaseCadence.rows.map((r) => r.displayName));
    assert.deepEqual(rows.map((r) => r[0]), [C.companyName]);
    assert.ok(rows[0]!.includes("Sem cadência suficiente"));
    assert.match(csvText(file.body), /# Filtro — Situação \(lista\): Sem cadência suficiente/);
    assert.equal(calls.loadSellerIdentityContext, 0);
    assert.equal(calls.findActivities.length, 0);
  });

  it("XLSX da lista 1: abas de dados e metadados, valores numéricos", async () => {
    const file = await exportCrmReportsOperationalList({
      ds: createFakeDataSource(baseDb()).ds,
      scope: GLOBAL_SCOPE,
      auth: AUTH,
      request: request(),
      list: "recent",
      format: "xlsx",
      options: { now: NOW },
    });
    assert.equal(file.filename, "crm-relatorio-compraram-60d-20260911-1000.xlsx");
    const wb = XLSX.read(file.body as Uint8Array, { type: "array" });
    assert.deepEqual(wb.SheetNames, ["Relatório", "Metadados"]);
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Relatório"]!);
    assert.equal(rows.length, file.rowCount);
    const alfa = rows.find((r) => r["Cliente"] === "Alfa Ltda")!;
    assert.equal(typeof alfa["Venda 60d"], "number");
    assert.equal(alfa["Responsável Comercial"], "Gislene Lima");
    assert.match(String(alfa["Vendedor do último pedido"]), /JOSEANE/i);
  });
});

describe("exportação — segurança dos metadados", () => {
  it("cliente de outra carteira na seleção/filtro nunca tem nome ou CNPJ revelado", async () => {
    const file = await exportCrmReportsOperationalList({
      ds: createFakeDataSource(baseDb()).ds,
      scope: OWN_GISLENE_SCOPE,
      auth: GISLENE_AUTH,
      request: request({
        filters: { customerIds: [A.id, B.id], customerSelection: { mode: "EXCLUDE", customerIds: [B.id] } },
      }),
      list: "recent",
      format: "csv",
      options: { now: NOW },
    });
    const csv = csvText(file.body);
    assert.ok(!csv.includes(B.companyName), "nome de cliente fora da carteira vazou");
    assert.ok(!csv.includes(B.taxId), "CNPJ de cliente fora da carteira vazou");
    assert.match(csv, /# Cliente excluído: \(fora do universo — ignorado\)/);
    assert.match(csv, /# Filtro — Cliente: 2 cliente\(s\): Alfa Ltda — 11\.111\.111\/0001-01; \(fora do universo — ignorado\)/);
    assert.match(csv, /# Escopo: Carteira própria/);
  });

  it("filtro de Responsável Comercial: rótulo no global, 'Ignorado' na carteira própria", async () => {
    const body = { filters: { commercialOwner: { sellerIdentityKey: "joseane souza" } } };
    const global = await exportCrmReportsOperationalList({
      ds: createFakeDataSource(baseDb()).ds,
      scope: GLOBAL_SCOPE,
      auth: AUTH,
      request: request(body),
      list: "cadence",
      format: "csv",
      options: { now: NOW },
    });
    assert.match(csvText(global.body), /# Filtro — Responsável Comercial: Joseane Souza\r\n/);
    const own = await exportCrmReportsOperationalList({
      ds: createFakeDataSource(baseDb()).ds,
      scope: OWN_GISLENE_SCOPE,
      auth: GISLENE_AUTH,
      request: request(body),
      list: "cadence",
      format: "csv",
      options: { now: NOW },
    });
    assert.match(csvText(own.body), /# Filtro — Responsável Comercial: Ignorado — escopo de carteira própria/);
  });
});

describe("exportação do relatório personalizado", () => {
  it("todas as linhas (ignora a página) + total geral no rodapé, fora da contagem", async () => {
    const file = await exportCrmCustomReport({
      ds: createFakeDataSource(baseDb()).ds,
      scope: GLOBAL_SCOPE,
      auth: AUTH,
      spec: customSpec({ pagination: { limit: 1, offset: 0 } }),
      format: "csv",
      options: { now: NOW },
    });
    assert.equal(file.filename, "crm-relatorio-personalizado-20260911-1000.csv");
    assert.equal(file.rowCount, 4);
    const csv = csvText(file.body);
    const rows = csvDataRows(csv, "Cliente;CNPJ/CPF;Valor vendido;Pedidos");
    assert.deepEqual(rows, [
      ["Alfa Ltda", A.taxId, "3000,10", "3"],
      ["Beta SA", B.taxId, "1600,00", "2"],
      ["Gama Comércio", C.taxId, "750,00", "1"],
      ["Mu Presença", "11.111.111/0001-07", "200,00", "2"],
      ["Total geral", "", "5550,10", "8"],
    ]);
    assert.match(csv, /# Linhas exportadas: 4\r\n/);
    assert.match(csv, /# Filtro — Período \(emissão\): Histórico inteiro/);
    assert.match(csv, /# Filtro — Dimensões: Cliente/);
    assert.match(csv, /# Filtro — Métricas: Valor vendido, Pedidos/);
  });

  it("XLSX do personalizado com vendedor do pedido traz o ID Nomus em coluna própria", async () => {
    const file = await exportCrmCustomReport({
      ds: createFakeDataSource(baseDb()).ds,
      scope: GLOBAL_SCOPE,
      auth: AUTH,
      spec: customSpec({ dimensions: ["orderSeller"], metrics: ["soldValue", "customers"], groupBy: null }),
      format: "xlsx",
      options: { now: NOW },
    });
    const wb = XLSX.read(file.body as Uint8Array, { type: "array" });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Relatório"]!);
    const ids = rows.map((r) => r["ID Nomus do vendedor"]).filter(Boolean).sort();
    assert.deepEqual(ids, ["464", "501"]);
    const total = rows.find((r) => r["Vendedor do pedido"] === "Total geral")!;
    assert.equal(total["Valor vendido"], 5550.1);
    assert.equal(total["Clientes"], 4);
  });
});
