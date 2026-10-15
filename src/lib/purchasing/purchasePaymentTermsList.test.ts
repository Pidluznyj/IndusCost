import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { applyPaymentTermsListFilters, parseNomusPurchaseOrderListFilters } from "../nomus/nomusPurchaseOrderQuery.js";
import { parsePaymentTermsPeriod, parsePaymentTermsTargetInput } from "./purchasePaymentTermsAnalysis.server.js";
import type { PaymentTermsCellDto } from "./purchasePaymentTermsAnalysis.js";

const cell = (pmpDays: number | null, belowTarget: boolean | null = null): PaymentTermsCellDto => ({
  status: pmpDays == null ? "NOT_IDENTIFIED" : "IDENTIFIED",
  label: pmpDays == null ? "Não identificado" : `${pmpDays} dias`,
  pmpDays,
  reasonLabel: null,
  baseDate: "2026-10-01",
  installmentCount: 1,
  warnings: [],
  bucket: pmpDays == null ? "NOT_IDENTIFIED" : pmpDays >= 60 ? "D60_89" : "D30_59",
  gapDays: null,
  belowTarget,
});

describe("Grid Pedidos Nomus — Prazo de Pagamento", () => {
  const rows = [
    { id: "a", paymentTerms: cell(45, true) },
    { id: "b", paymentTerms: cell(null) },
    { id: "c", paymentTerms: cell(65, false) },
  ];

  it("ordena pelo PMP com não identificados ao final", () => {
    assert.deepEqual(applyPaymentTermsListFilters(rows, { sort: "pmp_desc" }).map((r) => r.id), ["c", "a", "b"]);
    assert.deepEqual(applyPaymentTermsListFilters(rows, { sort: "pmp_asc" }).map((r) => r.id), ["a", "c", "b"]);
  });

  it("filtra faixa, não identificados e meta", () => {
    assert.deepEqual(applyPaymentTermsListFilters(rows, { paymentTermsBucket: "NOT_IDENTIFIED" }).map((r) => r.id), ["b"]);
    assert.deepEqual(applyPaymentTermsListFilters(rows, { paymentTermsTarget: "BELOW" }).map((r) => r.id), ["a"]);
    assert.deepEqual(applyPaymentTermsListFilters(rows, { paymentTermsTarget: "MEETS" }).map((r) => r.id), ["c"]);
  });

  it("parâmetros da URL; filtro financeiro existente continua", () => {
    const f = parseNomusPurchaseOrderListFilters({ paymentTermsBucket: "d30_59", paymentTermsTarget: "abaixo", sort: "pmp_desc", financialStatus: "PAGO" });
    assert.equal(f.paymentTermsBucket, "D30_59");
    assert.equal(f.paymentTermsTarget, "BELOW");
    assert.equal(f.sort, "pmp_desc");
    assert.equal(f.financialStatus, "PAID");
    assert.equal(parseNomusPurchaseOrderListFilters({ sort: "x", paymentTermsBucket: "nada" }).sort, null);
  });

  it("coluna Financeiro substituída por Prazo de Pagamento; demais colunas preservadas", () => {
    const table = readFileSync("src/components/purchases/NomusPurchaseOrderListTable.tsx", "utf8");
    assert.doesNotMatch(table, /<th>Financeiro<\/th>/);
    assert.match(table, /Prazo de Pagamento/);
    for (const col of ["Pedido", "Fornecedor", "Comprador", "Emissão", "Entrega", "Situação", "NF", "Itens", "Ações"]) {
      assert.match(table, new RegExp(`<th[^>]*>${col}</th>`));
    }
    assert.match(table, /Total planejado/);
    const moduleSrc = readFileSync("src/components/NomusPurchaseOrderModule.tsx", "utf8");
    assert.match(moduleSrc, /FINANCIAL_OPTIONS/, "filtro de situação financeira preservado");
  });
});

describe("Meta e período", () => {
  it("meta: vazio remove; inteiros 0–365; demais recusados", () => {
    assert.deepEqual(parsePaymentTermsTargetInput(""), { ok: true, value: null });
    assert.deepEqual(parsePaymentTermsTargetInput(60), { ok: true, value: 60 });
    assert.deepEqual(parsePaymentTermsTargetInput("45"), { ok: true, value: 45 });
    for (const bad of [-1, 366, 30.5, "abc", true]) assert.equal(parsePaymentTermsTargetInput(bad).ok, false);
  });

  it("período padrão = mês corrente; datas inválidas recusadas", () => {
    assert.deepEqual(parsePaymentTermsPeriod({}, new Date(2026, 9, 15)), { from: "2026-10-01", to: "2026-10-15" });
    assert.ok("error" in parsePaymentTermsPeriod({ from: "2026-10-10", to: "2026-10-01" }));
    assert.ok("error" in parsePaymentTermsPeriod({ from: "10/10/2026" }));
  });

  it("rotas: leitura com guard de Compras; meta só com ação gerencial (approve)", () => {
    const routes = readFileSync("src/lib/purchasing/purchasePaymentTermsRoutes.ts", "utf8");
    assert.match(routes, /OPERATIONS_ACTIONS\.view/);
    assert.match(routes, /app\.put\(`\$\{PURCHASE_PAYMENT_TERMS_API_PATH\}\/settings`, \.\.\.manage/);
    assert.match(routes, /OPERATIONS_ACTIONS\.approve/);
    const server = readFileSync("server.ts", "utf8");
    assert.match(server, /registerPurchasePaymentTermsRoutes\(app/);
  });
});
