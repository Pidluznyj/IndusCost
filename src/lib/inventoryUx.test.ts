import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { appendQueryIfPresent, hasAnyFilter } from "../components/inventory/inventoryFilterUtils.js";
import { INVENTORY_EMPTY } from "../components/inventory/inventoryEmptyStates.js";
import {
  formatInventoryApiError,
  INVENTORY_BALANCE_GLOSSARY,
  INVENTORY_BALANCE_COLUMN_TOOLTIPS,
} from "../components/inventory/inventoryUi.js";
import { safeTrim } from "./safeTrim.js";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const TAB_FILES = [
  "src/components/inventory/InventoryDashboardTab.tsx",
  "src/components/inventory/InventoryItemsTab.tsx",
  "src/components/inventory/InventoryWarehousesTab.tsx",
  "src/components/inventory/InventoryBalancesTab.tsx",
  "src/components/inventory/InventoryMovementsTab.tsx",
  "src/components/inventory/InventoryCountsTab.tsx",
  "src/components/inventory/InventoryReservationsTab.tsx",
  "src/components/inventory/InventoryAuditTab.tsx",
  "src/components/InventoryModule.tsx",
];

describe("inventoryUx", () => {
  it("1. todas as abas carregam no InventoryModule", () => {
    const mod = read("src/components/InventoryModule.tsx");
    for (const fragment of [
      "InventoryDashboardTab",
      "InventoryItemsTab",
      "InventoryWarehousesTab",
      "InventoryBalancesTab",
      "InventoryMovementsTab",
      "InventoryCountsTab",
      "InventoryReservationsTab",
      "InventoryAuditTab",
      'tab === "reservations"',
      'tab === "audit"',
    ]) {
      assert.match(mod, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });

  it("2. estados vazios definidos e usados nas abas", () => {
    assert.equal(INVENTORY_EMPTY.noItemsRegistered.title, "Sem itens cadastrados");
    assert.equal(INVENTORY_EMPTY.noWarehousesRegistered.title, "Sem almoxarifados cadastrados");
    assert.equal(INVENTORY_EMPTY.noMovementsInPeriod.title, "Sem movimentações no período");
    assert.equal(INVENTORY_EMPTY.noBalancesForFilter.title, "Sem saldos para o filtro selecionado");
    assert.equal(INVENTORY_EMPTY.noCountsOpen.title, "Nenhuma conferência aberta");
    assert.equal(INVENTORY_EMPTY.noReservationsActive.title, "Nenhuma reserva ativa");
    assert.equal(INVENTORY_EMPTY.noAuditEntries.title, "Sem eventos de auditoria");

    for (const file of TAB_FILES.filter((f) => f !== "src/components/InventoryModule.tsx")) {
      const src = read(file);
      assert.match(src, /INVENTORY_EMPTY|InventoryEmptyState/, `${file} deve usar estados vazios`);
    }
  });

  it("3. filtros aceitam valores vazios sem quebrar", () => {
    const q = new URLSearchParams();
    appendQueryIfPresent(q, "search", undefined);
    appendQueryIfPresent(q, "search", null);
    appendQueryIfPresent(q, "search", "");
    appendQueryIfPresent(q, "search", "   ");
    assert.equal(q.has("search"), false);

    appendQueryIfPresent(q, "family", "MP");
    assert.equal(q.get("family"), "MP");

    assert.equal(hasAnyFilter(["", undefined, null, false]), false);
    assert.equal(hasAnyFilter(["", "x"]), true);
    assert.equal(hasAnyFilter([true]), true);
  });

  it("4. abas de listagem não usam .trim() direto em filtros", () => {
    const filterTabs = [
      "src/components/inventory/InventoryItemsTab.tsx",
      "src/components/inventory/InventoryWarehousesTab.tsx",
      "src/components/inventory/InventoryBalancesTab.tsx",
      "src/components/inventory/InventoryMovementsTab.tsx",
      "src/components/inventory/InventoryAuditTab.tsx",
    ];
    for (const file of filterTabs) {
      const src = read(file);
      assert.doesNotMatch(src, /if \(search\.trim\(\)\)/, `${file} não deve usar search.trim()`);
      assert.doesNotMatch(src, /if \(family\.trim\(\)\)/, `${file} não deve usar family.trim()`);
      assert.match(src, /appendQueryIfPresent/, `${file} deve usar appendQueryIfPresent`);
    }
  });

  it("5. tabelas com scroll horizontal e truncate", () => {
    const ui = read("src/components/inventory/inventoryUi.tsx");
    assert.match(ui, /min-w-\[640px\]/);
    assert.match(ui, /truncate/);
    assert.match(ui, /InventoryTableScroll/);

    for (const file of TAB_FILES.filter((f) => f !== "src/components/InventoryModule.tsx")) {
      const src = read(file);
      assert.match(
        src,
        /InventoryTableScroll|overflow-x-auto/,
        `${file} deve permitir scroll horizontal`
      );
    }
  });

  it("6. status visual com badges", () => {
    const ui = read("src/components/inventory/inventoryUi.tsx");
    assert.match(ui, /InventoryOperationalStatusBadge/);

    const items = read("src/components/inventory/InventoryItemsTab.tsx");
    assert.match(items, /rounded-full/);

    const counts = read("src/components/inventory/InventoryCountsTab.tsx");
    assert.match(counts, /CountStatusBadge|rounded-full/);
  });

  it("7. tooltips e glossário de saldos", () => {
    assert.equal(INVENTORY_BALANCE_GLOSSARY.length, 5);
    assert.ok(INVENTORY_BALANCE_COLUMN_TOOLTIPS["Disponível"]?.includes("utilizável"));

    const balances = read("src/components/inventory/InventoryBalancesTab.tsx");
    assert.match(balances, /InventoryBalanceGlossary/);
    assert.match(balances, /InventoryBalanceColumnHeader/);

    const dash = read("src/components/inventory/InventoryDashboardTab.tsx");
    assert.match(dash, /InventoryBalanceGlossary/);
  });

  it("8. erros amigáveis sem stack trace", () => {
    assert.equal(formatInventoryApiError(undefined, "Falha."), "Falha.");
    assert.equal(formatInventoryApiError(new Error("  "), "Falha."), "Falha.");
    assert.equal(formatInventoryApiError(new Error("Rede indisponível"), "Falha."), "Rede indisponível");

    const errorTabs = TAB_FILES.filter(
      (f) =>
        f !== "src/components/inventory/InventoryDashboardTab.tsx" &&
        f !== "src/components/InventoryModule.tsx"
    );
    for (const file of errorTabs) {
      const src = read(file);
      assert.match(src, /InventoryErrorBanner|formatInventoryApiError/, `${file} trata erros`);
      assert.doesNotMatch(src, /stack/i, `${file} não deve exibir stack`);
    }
  });

  it("9. safeTrim cobre undefined para filtros", () => {
    assert.equal(safeTrim(undefined), "");
    assert.equal(safeTrim(null), "");
    assert.equal(safeTrim("  ok  "), "ok");
  });

  it("10. saldos com local, mínimo, segurança e alertas", () => {
    const balances = read("src/components/inventory/InventoryBalancesTab.tsx");
    assert.match(balances, /inventory-balances-filter-location/);
    assert.match(balances, /Mínimo/);
    assert.match(balances, /Segurança/);
    assert.match(balances, /inventory-balances-alerts/);
    assert.match(balances, /safetyStock/);
  });

  it("11. estorno autorizado no detalhe da movimentação", () => {
    const sheet = read("src/components/inventory/InventoryMovementFormSheet.tsx");
    assert.match(sheet, /movements\/\$\{movement\.id\}\/reverse/);
    assert.match(sheet, /inventory-movement-reverse-confirm/);
    assert.doesNotMatch(sheet, /Estorno automático ainda não disponível/);
  });

  it("12. dashboard KPIs fazem drill-down", () => {
    const dash = read("src/components/inventory/InventoryDashboardTab.tsx");
    assert.match(dash, /\/inventory\/balances\?belowMinimum=1/);
    assert.match(dash, /\/inventory\/reservations/);
    assert.match(dash, /inventory-kpi-below-minimum/);
  });
});
