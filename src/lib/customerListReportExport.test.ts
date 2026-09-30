import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import * as XLSX from "xlsx";
import {
  CUSTOMER_LIST_EXPORT_MAX,
  CUSTOMER_LIST_PDF_MAX_ROWS,
  CUSTOMER_LIST_REPORT_TITLE,
  buildCustomerListReportAppliedFilters,
  buildCustomerListReportExportPdf,
  buildCustomerListReportExportSummary,
  buildCustomerListReportExportWorkbook,
  customerListReportExportFilename,
  customerListReportWorkbookToBytes,
  formatCustomerListExportCnpjScore,
  formatCustomerListExportOwner,
  formatCustomerListExportSalesBlock,
  mapCustomerListReportExportRow,
  type CustomerListReportExportPayload,
} from "./customerListReportExport.js";
import { buildCustomerListExportQuery } from "./customerListReportExportUi.js";
import {
  buildCustomerListReportCopyCode,
  serializeCustomerListReportFingerprintSource,
} from "./customerListReportPrintMeta.js";

const ROOT = join(import.meta.dirname, "..");

function payload(overrides: Partial<CustomerListReportExportPayload> = {}): CustomerListReportExportPayload {
  const rows = [
    mapCustomerListReportExportRow({
      companyName: "1 LINHA AGENCIA DE SERVICOS LTDA",
      tradeName: "FLASH SERVICOS",
      taxId: "12.345.678/0001-90",
      city: "Timbó",
      state: "SC",
      segment: "Transporte rodoviário",
      status: "ACTIVE",
      commercialOwnerName: "Josiane Aparecida Correa",
      cnpjRisk: {
        lookupId: "l1",
        score: 90,
        verdict: "VENDA LIBERADA",
        riskLevel: "BAIXO",
        saleRecommendation: null,
        source: "cnpj",
        fetchedAt: "2026-09-30T12:00:00.000Z",
        expiresAt: "2026-10-01T12:00:00.000Z",
        expired: false,
      },
      salesBlock: { blocked: false, reason: null },
    }),
    mapCustomerListReportExportRow({
      companyName: "ANDERSON TEIXEIRA MARCONDES",
      tradeName: "",
      taxId: "20.866.030/0001-00",
      city: "Americana",
      state: "SP",
      segment: "",
      status: "ACTIVE",
      commercialOwnerName: null,
      cnpjRisk: {
        lookupId: "l2",
        score: 71,
        verdict: "VENDA CONDICIONADA",
        riskLevel: "MEDIO",
        saleRecommendation: null,
        source: "cnpj",
        fetchedAt: "2026-09-29T12:00:00.000Z",
        expiresAt: "2026-09-30T12:00:00.000Z",
        expired: true,
      },
      salesBlock: { blocked: true, reason: "OVERDUE_BOLETO" },
    }),
  ];
  return {
    generatedAt: "2026-09-30T12:00:00.000Z",
    appliedFilters: buildCustomerListReportAppliedFilters({
      search: "linha",
      ownerKey: "none",
      ownerOptions: [],
    }),
    summary: buildCustomerListReportExportSummary(rows, rows.length),
    rows,
    copyControl: {
      copyCode: "CLT-20260930-ABCDEF12",
      fingerprint: "a".repeat(64),
      classification: "DOCUMENTO CONTROLADO — USO INTERNO E RESTRITO",
      emitterName: "Paulo Pidluznyj",
      emitterEmail: "paulo@grupolazarios.com.br",
      emitterUserId: "user-1",
    },
    ...overrides,
  };
}

describe("customerListReportExport", () => {
  it("mapeia colunas da grade (score, responsável, status, bloqueio)", () => {
    const row = mapCustomerListReportExportRow({
      companyName: "ACME",
      tradeName: "Acme Shop",
      taxId: "00.000.000/0001-91",
      city: "Curitiba",
      state: "PR",
      segment: "Informática",
      status: "ACTIVE",
      commercialOwnerName: "  ",
      lastPurchaseAt: "2026-08-25T15:00:00.000Z",
      lastPurchaseStatus: "VALID",
      cnpjRisk: null,
      salesBlock: { blocked: true, reason: "FINANCIAL_IDENTITY_UNRESOLVED" },
    });
    assert.equal(row.companyName, "ACME");
    // Última compra: competência já resolvida pelo motor da rotina de 90 dias; "Nunca" sem faturamento válido.
    assert.equal(row.lastPurchase, "08/2026");
    assert.equal(mapCustomerListReportExportRow({ companyName: "X", lastPurchaseAt: null, lastPurchaseStatus: "NEVER_INVOICED" }).lastPurchase, "Nunca");
    assert.equal(mapCustomerListReportExportRow({ companyName: "X" }).lastPurchase, "Nunca");
    assert.equal(row.cnpjScore, "Sem consulta");
    assert.equal(row.commercialOwnerName, "Sem responsável");
    assert.equal(row.segment, "Informática");
    assert.equal(row.status, "Ativo");
    assert.equal(row.salesBlock, "Venda bloqueada — identidade financeira não validada");
    assert.equal(formatCustomerListExportOwner("Gislene Lima"), "Gislene Lima");
    assert.equal(formatCustomerListExportSalesBlock({ blocked: false, reason: null }), "");
    assert.match(formatCustomerListExportCnpjScore({
      lookupId: "x",
      score: 90,
      verdict: "VENDA LIBERADA",
      riskLevel: null,
      saleRecommendation: null,
      source: "cnpj",
      fetchedAt: "2026-09-30T12:00:00.000Z",
      expiresAt: "2026-10-01T12:00:00.000Z",
      expired: false,
    }), /90 · VENDA LIBERADA/);
  });

  it("filtros da tela entram na aba Filtros", () => {
    const filters = buildCustomerListReportAppliedFilters({
      search: "acme",
      ownerKey: "n:gislene lima",
      ownerOptions: [{ key: "n:gislene lima", name: "GISLENE LIMA" }],
    });
    assert.deepEqual(filters, [
      { label: "Busca", value: "acme" },
      { label: "Responsável comercial", value: "GISLENE LIMA" },
    ]);
    const empty = buildCustomerListReportAppliedFilters({
      search: "",
      ownerKey: "",
      ownerOptions: [],
    });
    assert.equal(empty[0]?.value, "Todos");
    assert.equal(empty[1]?.value, "Todos os responsáveis");
  });

  it("Excel tem Resumo, Clientes, Filtros e Confidencialidade", () => {
    const wb = buildCustomerListReportExportWorkbook(payload());
    const parsed = XLSX.read(customerListReportWorkbookToBytes(wb), { type: "array" });
    assert.deepEqual(parsed.SheetNames, ["Resumo", "Clientes", "Filtros", "Confidencialidade"]);
    const clientes = XLSX.utils.sheet_to_json<Record<string, unknown>>(parsed.Sheets.Clientes);
    assert.equal(clientes.length, 2);
    assert.equal(clientes[0]?.["Razão social"], "1 LINHA AGENCIA DE SERVICOS LTDA");
    assert.equal(clientes[0]?.["Score CNPJ"], "90 · VENDA LIBERADA");
    assert.equal(clientes[1]?.["Responsável comercial"], "Sem responsável");
    assert.equal(clientes[0]?.["Última compra"], "Nunca");
    assert.equal(Object.keys(clientes[0] ?? {}).indexOf("Última compra"), 5);
    assert.equal(clientes[1]?.["Bloqueio de venda"], "Venda bloqueada");
    assert.match(String(clientes[1]?.["Score CNPJ"]), /consulta vencida/);
    const filtros = XLSX.utils.sheet_to_json<Record<string, unknown>>(parsed.Sheets.Filtros);
    assert.equal(filtros[0]?.Filtro, "Busca");
    assert.equal(filtros[0]?.Valor, "linha");
    assert.equal(filtros[1]?.Valor, "Sem responsável");
    const resumo = XLSX.utils.sheet_to_json<Record<string, unknown>>(parsed.Sheets.Resumo);
    assert.equal(resumo[0]?.Valor, CUSTOMER_LIST_REPORT_TITLE);
    assert.equal(resumo.find((row) => row.Campo === "Código da cópia")?.Valor, "CLT-20260930-ABCDEF12");
    const confidentiality = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      parsed.Sheets.Confidencialidade
    );
    assert.match(String(confidentiality[0]?.Texto), /CONFIDENCIALIDADE/);
    assert.ok(confidentiality.some((row) => String(row.Texto).includes("não implica autorização")));
  });

  it("PDF de fallback carimba classificação, emitente e código da cópia", () => {
    const pdf = buildCustomerListReportExportPdf(payload()).toString("latin1");
    assert.match(pdf, /Relatorio de Clientes/);
    assert.match(pdf, /DOCUMENTO CONTROLADO/);
    assert.match(pdf, /CLT-20260930-ABCDEF12/);
    assert.match(pdf, /Paulo Pidluznyj/);
    assert.match(pdf, /Filtros aplicados/);
    assert.match(pdf, /Busca: linha/);
    assert.match(pdf, /1 LINHA AGENCIA DE SERVICOS LTDA/);
    assert.equal(CUSTOMER_LIST_PDF_MAX_ROWS, 40);
    assert.equal(CUSTOMER_LIST_EXPORT_MAX, 8_000);
  });

  it("código da cópia e fingerprint são determinísticos para prova de emissão", () => {
    const source = serializeCustomerListReportFingerprintSource({
      generatedAt: "2026-09-30T12:00:00.000Z",
      emitterUserId: "user-1",
      emitterEmail: "paulo@grupolazarios.com.br",
      filters: [{ label: "Busca", value: "acme" }],
      rowCount: 2,
      firstTaxId: "12.345.678/0001-90",
      lastTaxId: "20.866.030/0001-00",
    });
    assert.match(source, /paulo@grupolazarios.com.br/);
    assert.equal(
      buildCustomerListReportCopyCode(new Date(2026, 8, 30), "abcdef123456"),
      "CLT-20260930-ABCDEF12"
    );
  });

  it("query da tela não envia paginação (exporta o filtro inteiro)", () => {
    const query = buildCustomerListExportQuery({
      search: "  acme  ",
      commercialOwner: "none",
    });
    assert.equal(query, "search=acme&commercialOwner=none");
    assert.doesNotMatch(query, /page=/);
    assert.doesNotMatch(query, /limit=/);
    assert.equal(buildCustomerListExportQuery({}), "");
  });

  it("filename segue o padrão yyyy-mm-dd", () => {
    const date = new Date(2026, 8, 30);
    assert.equal(customerListReportExportFilename("xlsx", date), "clientes-relatorio-2026-09-30.xlsx");
    assert.equal(customerListReportExportFilename("pdf", date), "clientes-relatorio-2026-09-30.pdf");
  });

  it("loader reusa os mesmos filtros da listagem e ignora skip/take da página", () => {
    const server = readFileSync(join(ROOT, "lib/customerListReportExport.server.ts"), "utf8");
    assert.match(server, /parseCustomerListQuery/);
    assert.match(server, /prepareCommercialOwnerCustomerListFilter/);
    assert.match(server, /buildCustomerListWhere/);
    assert.match(server, /CUSTOMER_LIST_EXPORT_MAX/);
    assert.doesNotMatch(server, /list\.skip/);
    assert.doesNotMatch(server, /list\.limit/);
    assert.match(server, /attachCustomerCnpjRisk/);
    assert.match(server, /attachCustomerCommercialOwnerListFields/);
    assert.match(server, /attachCustomerSalesBlocks/);
    assert.match(server, /copyControl/);
    assert.match(server, /createHash\("sha256"\)/);
  });

  it("PDF da tela usa cabeçalho institucional, marca d'água e cópia controlada", () => {
    const page = readFileSync(join(ROOT, "components/CustomerModule.tsx"), "utf8");
    const doc = readFileSync(
      join(ROOT, "components/customers/CustomerListReportPrintDocument.tsx"),
      "utf8"
    );
    const css = readFileSync(
      join(ROOT, "components/customers/customer-list-report-print.css"),
      "utf8"
    );
    const routes = readFileSync(join(ROOT, "lib/customerListReportExportRoutes.ts"), "utf8");
    assert.match(page, /CustomerListReportPrintDocument/);
    assert.match(page, /getCustomerListReportPayloadUrl/);
    assert.match(page, /customers-print-route/);
    assert.match(page, /\/api\/branding-settings/);
    assert.match(doc, /PrintHeader/);
    assert.match(doc, /CUSTOMER_LIST_REPORT_WATERMARK/);
    assert.match(doc, /CUSTOMER_LIST_REPORT_PRINT_DISCLAIMER/);
    assert.match(doc, /copyControl\.copyCode/);
    assert.match(css, /A4 landscape/);
    assert.match(css, /customers-print-watermark/);
    assert.match(css, /table-header-group/);
    assert.match(routes, /app\.get\("\/api\/customers\/export-report"/);
  });

  it("rotas e botões da tela usam o mesmo par Excel/PDF", () => {
    const server = readFileSync(join(ROOT, "..", "server.ts"), "utf8");
    const routes = readFileSync(join(ROOT, "lib/customerListReportExportRoutes.ts"), "utf8");
    const page = readFileSync(join(ROOT, "components/CustomerModule.tsx"), "utf8");
    const access = readFileSync(join(ROOT, "lib/commercialAccess.ts"), "utf8");
    assert.match(server, /registerCustomerListReportExportRoutes/);
    assert.ok(
      server.indexOf("registerCustomerListReportExportRoutes") <
        server.indexOf('app.get("/api/customers/:id/commercial-360"')
    );
    assert.match(routes, /\/api\/customers\/export-report\.xlsx/);
    assert.match(routes, /\/api\/customers\/export-report\.pdf/);
    assert.match(routes, /COMMERCIAL_RESOURCE_KEYS\.customers/);
    assert.match(page, /canExportCustomerListReport/);
    assert.match(page, /allowExportReport/);
    assert.match(page, /data-testid="customers-export-report-xlsx"/);
    assert.match(page, /data-testid="customers-export-report-pdf"/);
    assert.match(routes, /CUSTOMER_LIST_EXPORT_FORBIDDEN/);
    assert.match(routes, /canExportCustomerListReport/);
    assert.match(page, /buildCustomerListExportQuery/);
    assert.match(page, /debouncedSearch/);
    assert.match(page, /ownerFilter/);
    assert.match(access, /\/api\/customers\/export-report\*/);
  });
});
