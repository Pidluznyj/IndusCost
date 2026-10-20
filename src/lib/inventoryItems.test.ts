import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  applyDefaultWarehousePolicyToForm,
  assertNoBalanceFieldsInPayload,
  createEmptyInventoryItemForm,
  describeDefaultWarehousePolicy,
  inventoryItemFormToPayload,
  validateInventoryItemForm,
} from "../components/inventory/inventoryItemForm.js";
import { formatInventoryItemType } from "../components/inventory/inventoryItemLabels.js";
import {
  normalizeInventoryItemListResponse,
  summarizeInventoryBalances,
} from "../components/inventory/inventoryItemPresentation.js";
import { resolveInventoryTabFromPath } from "../components/inventory/inventoryNavigation.js";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("inventoryItemForm", () => {
  it("9. valida campos obrigatórios", () => {
    const errors = validateInventoryItemForm(
      createEmptyInventoryItemForm({ unit: "" })
    );
    assert.ok(errors.code);
    assert.ok(errors.description);
    assert.ok(errors.itemType);
    assert.ok(errors.unit);
  });

  it("4. cria matéria-prima no formulário (payload); POST recusa órfão", () => {
    const payload = inventoryItemFormToPayload(
      createEmptyInventoryItemForm({
        code: "MP-001",
        description: "Aço laminado",
        itemType: "RAW_MATERIAL",
        unit: "KG",
      })
    );
    assert.equal(payload.itemType, "RAW_MATERIAL");
    assertNoBalanceFieldsInPayload(payload as Record<string, unknown>);
    const sheet = read("src/components/inventory/InventoryItemDetailSheet.tsx");
    assert.match(sheet, /hideRawMaterialType=\{isCreate\}/);
    assert.match(sheet, /InventoryAttachOfficialMaterialPanel/);
  });

  it("5. cria produto acabado", () => {
    const payload = inventoryItemFormToPayload(
      createEmptyInventoryItemForm({
        code: "PA-001",
        description: "Produto final",
        itemType: "FINISHED_PRODUCT",
        unit: "UN",
      })
    );
    assert.equal(payload.itemType, "FINISHED_PRODUCT");
  });

  it("6. cria suprimento administrativo", () => {
    const payload = inventoryItemFormToPayload(
      createEmptyInventoryItemForm({
        code: "ADM-001",
        description: "Papel A4",
        itemType: "ADMINISTRATIVE_SUPPLY",
        unit: "CX",
      })
    );
    assert.equal(payload.itemType, "ADMINISTRATIVE_SUPPLY");
  });

  it("rejeita custo negativo", () => {
    const errors = validateInventoryItemForm(
      createEmptyInventoryItemForm({
        code: "X",
        description: "Y",
        itemType: "RAW_MATERIAL",
        unit: "UN",
        averageCost: "-1",
      })
    );
    assert.ok(errors.averageCost);
  });

  it("7. payload de edição não inclui saldo", () => {
    const payload = inventoryItemFormToPayload(
      createEmptyInventoryItemForm({
        code: "MP-002",
        description: "Item",
        itemType: "RAW_MATERIAL",
        unit: "UN",
      })
    );
    assert.equal("physicalQuantity" in payload, false);
    assert.equal("availableQuantity" in payload, false);
  });
});

describe("inventoryItemPresentation", () => {
  it("1. normaliza lista de itens", () => {
    const list = normalizeInventoryItemListResponse({
      rows: [{ id: "1", code: "A", description: "Item A", itemType: "RAW_MATERIAL", unit: "UN" }],
      total: 1,
      page: 1,
      pageSize: 50,
      totalPages: 1,
    });
    assert.equal(list.rows.length, 1);
    assert.equal(list.rows[0]?.code, "A");
  });

  it("10. item sem saldo não quebra resumo", () => {
    const summary = summarizeInventoryBalances([], {
      status: "ACTIVE",
      minimumStock: 10,
      reorderPoint: 20,
    });
    assert.equal(summary.physicalQuantity, 0);
    assert.equal(summary.hasBalances, false);
    assert.ok(summary.operationalStatus);
  });

  it("lista vazia segura", () => {
    const list = normalizeInventoryItemListResponse(null);
    assert.deepEqual(list.rows, []);
    assert.equal(list.total, 0);
  });
});

describe("inventoryItems UI", () => {
  it("1. InventoryItemsTab lista via API", () => {
    const tab = read("src/components/inventory/InventoryItemsTab.tsx");
    assert.match(tab, /\/api\/inventory\/items/);
    assert.match(tab, /inventory-items-table/);
  });

  it("2. filtro por busca", () => {
    const tab = read("src/components/inventory/InventoryItemsTab.tsx");
    assert.match(tab, /search/);
    assert.match(tab, /inventory-items-search/);
  });

  it("3. filtro por tipo", () => {
    const tab = read("src/components/inventory/InventoryItemsTab.tsx");
    assert.match(tab, /itemType/);
    assert.match(tab, /inventory-items-filter-type/);
  });

  it("7. formulário não edita saldo", () => {
    const payload = inventoryItemFormToPayload(
      createEmptyInventoryItemForm({
        code: "X",
        description: "Y",
        itemType: "RAW_MATERIAL",
        unit: "UN",
      })
    );
    assertNoBalanceFieldsInPayload(payload as Record<string, unknown>);
    const fields = read("src/components/inventory/inventoryItemForm.ts");
    const formFieldsSection = fields.match(/export type InventoryItemFormState = \{[\s\S]*?\};/)
      ?.[0] ?? "";
    assert.doesNotMatch(formFieldsSection, /physicalQuantity/);
    const sheet = read("src/components/inventory/InventoryItemDetailSheet.tsx");
    assert.match(sheet, /movimenta/);
    assert.match(sheet, /inventory-item-balance-summary/);
  });

  it("8. inativação via PATCH status", () => {
    const sheet = read("src/components/inventory/InventoryItemDetailSheet.tsx");
    assert.match(sheet, /\/status/);
    assert.match(sheet, /INACTIVE/);
    assert.doesNotMatch(sheet, /DELETE/);
    assert.doesNotMatch(sheet, /\.delete\(/);
  });

  it("tipos em português", () => {
    assert.equal(formatInventoryItemType("RAW_MATERIAL"), "Matéria-prima");
    assert.equal(formatInventoryItemType("FINISHED_PRODUCT"), "Produto acabado");
    assert.equal(formatInventoryItemType("ADMINISTRATIVE_SUPPLY"), "Suprimento administrativo");
  });

  it("9. sem import server-only", () => {
    const files = [
      "src/components/inventory/InventoryItemsTab.tsx",
      "src/components/inventory/InventoryItemDetailSheet.tsx",
      "src/components/inventory/inventoryItemForm.ts",
    ];
    for (const file of files) {
      const src = read(file);
      assert.doesNotMatch(src, /inventoryService\.server/);
      assert.doesNotMatch(src, /@prisma\/client/);
      assert.doesNotMatch(src, /lib\/prisma/);
    }
  });
});

describe("inventory routes items", () => {
  it("App.tsx rota /inventory/items", () => {
    const app = read("src/App.tsx");
    assert.match(app, /path="inventory\/items"/);
    assert.match(app, /initialTab="items"/);
  });

  it("aba items ativa sem comingSoon", () => {
    const nav = read("src/components/inventory/inventoryNavigation.ts");
    const itemsBlock = nav.match(/id: "items"[\s\S]*?\n  },/)?.[0] ?? "";
    assert.match(itemsBlock, /id: "items"/);
    assert.doesNotMatch(itemsBlock, /comingSoon: true/);
    assert.equal(resolveInventoryTabFromPath("/inventory/items"), "items");
  });

  it("InventoryModule renderiza aba items", () => {
    const mod = read("src/components/InventoryModule.tsx");
    assert.match(mod, /InventoryItemsTab/);
    assert.match(mod, /tab === "items"/);
  });
});

describe("inventoryItemForm · almoxarifado padrão (política do tipo)", () => {
  const WH_ADM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const WH_EPI = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const option = (warehouseId: string, code: string) => ({
    sectorId: "5ec70000-0000-4000-8000-000000000001",
    sectorCode: code,
    sectorName: code,
    warehouseId,
    warehouseCode: code,
    warehouseName: code,
  });
  const fixed = {
    itemType: "ADMINISTRATIVE_SUPPLY",
    mode: "SECTOR_FIXED" as const,
    options: [option(WH_ADM, "ADMINISTRATIVO")],
    defaultWarehouseId: WH_ADM,
    locked: true,
    editable: true,
  };

  it("1. payload do cadastro leva almoxarifado e endereço padrão (null quando vazios)", () => {
    const empty = inventoryItemFormToPayload(
      createEmptyInventoryItemForm({ code: "ADM-INF-037", description: "Pilha A23 12V", itemType: "ADMINISTRATIVE_SUPPLY", unit: "UN" })
    );
    assert.equal(empty.defaultWarehouseId, null);
    assert.equal(empty.defaultLocationId, null);
    const filled = inventoryItemFormToPayload(
      createEmptyInventoryItemForm({ code: "X", description: "Y", itemType: "ADMINISTRATIVE_SUPPLY", unit: "UN", defaultWarehouseId: WH_ADM })
    );
    assert.equal(filled.defaultWarehouseId, WH_ADM);
    assertNoBalanceFieldsInPayload(filled as Record<string, unknown>);
  });

  it("5. endereço sem almoxarifado é erro de formulário", () => {
    const errors = validateInventoryItemForm(
      createEmptyInventoryItemForm({ code: "X", description: "Y", itemType: "PPE", unit: "UN", defaultLocationId: "10000000-0000-4000-8000-000000000001" })
    );
    assert.ok(errors.defaultLocationId);
  });

  it("2. tipo com setor único: o formulário preenche e trava o almoxarifado; trocar de tipo limpa o endereço", () => {
    const form = createEmptyInventoryItemForm({ itemType: "ADMINISTRATIVE_SUPPLY" });
    const applied = applyDefaultWarehousePolicyToForm(form, fixed);
    assert.equal(applied.defaultWarehouseId, WH_ADM);
    assert.equal(applyDefaultWarehousePolicyToForm(applied, fixed), applied, "sem mudança → mesma referência");
    const withLocation = { ...applied, defaultLocationId: "10000000-0000-4000-8000-000000000001" };
    const switched = applyDefaultWarehousePolicyToForm(withLocation, { ...fixed, itemType: "PPE", options: [option(WH_EPI, "EPI")], defaultWarehouseId: WH_EPI });
    assert.equal(switched.defaultWarehouseId, WH_EPI);
    assert.equal(switched.defaultLocationId, "");
  });

  it("vários setores: mantém escolha válida, limpa escolha fora das opções; MP limpa; livre não mexe", () => {
    const choice = { ...fixed, mode: "SECTOR_CHOICE" as const, options: [option(WH_ADM, "A"), option(WH_EPI, "B")], defaultWarehouseId: null, locked: false };
    assert.equal(applyDefaultWarehousePolicyToForm(createEmptyInventoryItemForm({ defaultWarehouseId: WH_EPI }), choice).defaultWarehouseId, WH_EPI);
    assert.equal(applyDefaultWarehousePolicyToForm(createEmptyInventoryItemForm({ defaultWarehouseId: "outro" }), choice).defaultWarehouseId, "");
    const official = { ...fixed, mode: "OFFICIAL_LINK" as const, options: [], defaultWarehouseId: null, editable: false };
    assert.equal(applyDefaultWarehousePolicyToForm(createEmptyInventoryItemForm({ defaultWarehouseId: WH_ADM }), official).defaultWarehouseId, "");
    const free = { ...fixed, mode: "FREE" as const, options: [], defaultWarehouseId: null, locked: false };
    assert.equal(applyDefaultWarehousePolicyToForm(createEmptyInventoryItemForm({ defaultWarehouseId: WH_EPI }), free).defaultWarehouseId, WH_EPI);
    assert.match(describeDefaultWarehousePolicy(fixed) ?? "", /ADMINISTRATIVO/);
    assert.match(describeDefaultWarehousePolicy(choice) ?? "", /mais de um setor/);
  });

  it("ficha: campos de almoxarifado/endereço padrão e consulta da política por tipo", () => {
    const sheet = read("src/components/inventory/InventoryItemDetailSheet.tsx");
    assert.match(sheet, /inventory-item-form-default-warehouse/);
    assert.match(sheet, /inventory-item-form-default-location/);
    assert.match(sheet, /\/api\/inventory\/items\/default-warehouse-policy\?/);
    assert.match(sheet, /applyDefaultWarehousePolicyToForm/);
    assert.match(sheet, /disabled=\{readOnly \|\| locked/);
    assert.match(sheet, /warehouses\?pageSize=200&status=ACTIVE/);
  });
});
