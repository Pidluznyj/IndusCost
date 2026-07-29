import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  CUSTOMER_SEARCH_DEBOUNCE_MS,
  CUSTOMER_SEARCH_MIN_CHARS,
} from "./customerSearch.js";

test("EntityAutocompleteFilter — debounce configurável", () => {
  const src = readFileSync(
    join(process.cwd(), "src", "components", "common", "EntityAutocompleteFilter.tsx"),
    "utf8"
  );
  assert.ok(src.includes("debounceMs"));
  assert.ok(src.includes("setTimeout"));
  assert.equal(CUSTOMER_SEARCH_DEBOUNCE_MS, 300);
});

test("EntityAutocompleteFilter — estados loading e empty", () => {
  const src = readFileSync(
    join(process.cwd(), "src", "components", "common", "EntityAutocompleteFilter.tsx"),
    "utf8"
  );
  assert.ok(src.includes("Buscando"));
  assert.ok(src.includes("Nenhum resultado encontrado"));
  assert.ok(src.includes(`Digite ao menos`));
  assert.ok(src.includes("Erro ao buscar"));
  assert.ok(src.includes("absolute z-50"));
});

test("EntityAutocompleteFilter — seleção e limpar", () => {
  const src = readFileSync(
    join(process.cwd(), "src", "components", "common", "EntityAutocompleteFilter.tsx"),
    "utf8"
  );
  assert.ok(src.includes("onChange(item.selection)"));
  assert.ok(src.includes("onClear"));
  assert.ok(src.includes("Limpar"));
});

test("EntityAutocompleteFilter — title com CNPJ", () => {
  const src = readFileSync(
    join(process.cwd(), "src", "components", "common", "EntityAutocompleteFilter.tsx"),
    "utf8"
  );
  assert.ok(src.includes("selectionTitle"));
  assert.ok(src.includes("title={inputTitle}"));
});

test("CustomerAutocompleteFilter — usa endpoint search", () => {
  const src = readFileSync(
    join(process.cwd(), "src", "components", "common", "CustomerAutocompleteFilter.tsx"),
    "utf8"
  );
  assert.ok(src.includes("/api/customers/search"));
  assert.equal(CUSTOMER_SEARCH_MIN_CHARS, 2);
});

test("CustomerAutocompleteFilter — resultados formatados primary/secondary", () => {
  const src = readFileSync(
    join(process.cwd(), "src", "components", "common", "CustomerAutocompleteFilter.tsx"),
    "utf8"
  );
  assert.ok(src.includes("primaryLabel"));
  assert.ok(src.includes("secondaryLabel"));
  assert.ok(src.includes("formatCustomerSearchSecondaryLine"));
});

test("EntityAutocompleteFilter — teclado setas e enter", () => {
  const src = readFileSync(
    join(process.cwd(), "src", "components", "common", "EntityAutocompleteFilter.tsx"),
    "utf8"
  );
  assert.ok(src.includes("ArrowDown"));
  assert.ok(src.includes("ArrowUp"));
  assert.ok(src.includes("Escape"));
});
