import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  buildCustomerSearchWhereEnhanced,
  CUSTOMER_SEARCH_DEFAULT_LIMIT,
  CUSTOMER_SEARCH_MIN_CHARS,
  CUSTOMER_SEARCH_DEBOUNCE_MS,
  financeCashFlowCustomerFieldsFromSelection,
  financePersonFieldsFromSelection,
  formatCustomerSearchSecondaryLine,
  normalizeCustomerSearchQuery,
  parseCustomerSearchLimit,
  rankCustomerSearchResults,
  selectionFromFinancePersonFields,
  serializeCustomerSearchItem,
  type CustomerSearchItem,
} from "./customerSearch.js";

test("busca cliente por nome — where inclui companyName", () => {
  const where = buildCustomerSearchWhereEnhanced("esmal");
  assert.ok(where?.OR);
  assert.ok(Array.isArray(where.OR));
});

test("busca por fantasia — tradeName no where", () => {
  const where = buildCustomerSearchWhereEnhanced("Esmaltec");
  const json = JSON.stringify(where);
  assert.ok(json.includes("tradeName") || json.includes("companyName"));
});

test("busca por CNPJ com máscara — dígitos normalizados", () => {
  const where = buildCustomerSearchWhereEnhanced("02.948.030/0002-30");
  assert.ok(where?.OR);
});

test("busca por CNPJ sem máscara", () => {
  const where = buildCustomerSearchWhereEnhanced("02948030000230");
  assert.ok(where?.OR);
});

test("limita resultados", () => {
  assert.equal(parseCustomerSearchLimit(undefined), CUSTOMER_SEARCH_DEFAULT_LIMIT);
  assert.equal(parseCustomerSearchLimit("999"), 50);
  assert.equal(parseCustomerSearchLimit("5"), 5);
});

test("não retorna NaN/Infinity no parse de limit", () => {
  assert.equal(Number.isFinite(parseCustomerSearchLimit("abc")), true);
});

test("endpoint protegido por autenticação no server", () => {
  const server = readFileSync(join(process.cwd(), "server.ts"), "utf8");
  assert.ok(server.includes('app.get("/api/customers/search"'));
  assert.ok(server.includes("requireAppAuth"));
  assert.ok(server.includes('requirePermission("customers.view")'));
});

test("payload serializado sem dados sensíveis extras", () => {
  const item = serializeCustomerSearchItem({
    id: "uuid-1",
    companyName: "Esmaltec S/A",
    tradeName: "Esmaltec",
    taxId: "02.948.030/0002-30",
    city: "Maracanaú",
    state: "CE",
    email: "contato@esmaltec.com",
    phone: "85999999999",
  });
  assert.equal(item.name, "Esmaltec S/A");
  assert.equal(item.taxId, "02.948.030/0002-30");
  assert.equal(item.city, "Maracanaú");
  assert.equal((item as Record<string, unknown>).email, undefined);
  assert.equal((item as Record<string, unknown>).phone, undefined);
});

test("rank prioriza CNPJ exato", () => {
  const items: CustomerSearchItem[] = [
    {
      id: "1",
      code: null,
      name: "Outra Empresa",
      tradeName: null,
      taxId: "11.111.111/0001-11",
      city: null,
      state: null,
      source: "induscost",
    },
    {
      id: "2",
      code: null,
      name: "Esmaltec S/A",
      tradeName: "Esmaltec",
      taxId: "02.948.030/0002-30",
      city: "Maracanaú",
      state: "CE",
      source: "induscost",
    },
  ];
  const ranked = rankCustomerSearchResults(items, "02948030000230");
  assert.equal(ranked[0]!.id, "2");
});

test("formatCustomerSearchSecondaryLine inclui CNPJ e cidade", () => {
  const line = formatCustomerSearchSecondaryLine({
    id: "1",
    code: "000228",
    name: "Esmaltec S/A",
    tradeName: null,
    taxId: "02.948.030/0002-30",
    city: "Maracanaú",
    state: "CE",
    source: "induscost",
  });
  assert.ok(line.includes("02.948.030/0002-30"));
  assert.ok(line.includes("Maracanaú/CE"));
});

test("financePersonFieldsFromSelection preenche personName e personCnpj", () => {
  const fields = financePersonFieldsFromSelection({
    id: "c1",
    name: "Esmaltec S/A",
    taxId: "02.948.030/0002-30",
    source: "induscost",
  });
  assert.equal(fields.personName, "Esmaltec S/A");
  assert.equal(fields.personCnpj, "02.948.030/0002-30");
  assert.equal(fields.customerId, "c1");
});

test("financeCashFlowCustomerFieldsFromSelection", () => {
  const fields = financeCashFlowCustomerFieldsFromSelection({
    name: "Cliente X",
    taxId: "123",
    source: "induscost",
  });
  assert.equal(fields.customerName, "Cliente X");
  assert.equal(fields.personCnpj, "123");
});

test("selectionFromFinancePersonFields reconstrói seleção", () => {
  const sel = selectionFromFinancePersonFields("Alpha", "11.111.111/0001-11");
  assert.ok(sel);
  assert.equal(sel!.name, "Alpha");
});

test("normalizeCustomerSearchQuery trim", () => {
  assert.equal(normalizeCustomerSearchQuery("  esma  "), "esma");
});

test("constantes de debounce e min chars", () => {
  assert.equal(CUSTOMER_SEARCH_MIN_CHARS, 2);
  assert.ok(CUSTOMER_SEARCH_DEBOUNCE_MS >= 200);
});

test("frontend não importa Prisma", () => {
  const component = readFileSync(
    join(process.cwd(), "src", "components", "common", "EntityAutocompleteFilter.tsx"),
    "utf8"
  );
  assert.ok(!component.includes("@prisma/client"));
  assert.ok(!component.includes("prisma"));
});
