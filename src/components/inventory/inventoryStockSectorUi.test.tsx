/**
 * Estoque → Setores / Collector — tela administrativa.
 *
 * Helpers puros do formulário + render estático (renderToStaticMarkup, na
 * convenção do repo: sem jsdom) da tabela e da prévia de população.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { register } from "node:module";
import { before, describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StockSectorPopulationPreview } from "./InventoryStockSectorFormSheet";
import {
  applyStockSectorName,
  createEmptyStockSectorForm,
  isStockSectorFormValid,
  LEGACY_STOCK_SECTOR_ROWS,
  stockSectorCollectorPath,
  stockSectorFormFromRow,
  stockSectorFormToCreatePayload,
  stockSectorFormToUpdatePayload,
  suggestStockSectorCode,
  suggestStockSectorPrefix,
  suggestStockSectorSlug,
  validateStockSectorForm,
  type StockSectorFormOptions,
  type StockSectorRow,
} from "./inventoryStockSectorForm";
import {
  getVisibleInventoryTabs,
  resolveInventoryTabFromPath,
} from "./inventoryNavigation";
import { INVENTORY_UI_TABS } from "@/src/lib/moduleTabResources";

// A aba importa o diálogo de QR, que importa CSS. O runner `tsx --test` não
// carrega .css: registramos um loader que devolve módulo vazio e importamos os
// componentes dinamicamente (mesma convenção de InventoryCollectorSectorQrSection.test).
register(
  `data:text/javascript,${encodeURIComponent(
    'export async function load(url, context, next) { if (url.endsWith(".css")) return { format: "module", source: "", shortCircuit: true }; return next(url, context); }'
  )}`,
  import.meta.url
);

let InventoryStockSectorsTable: typeof import("./InventoryStockSectorsTab.js").InventoryStockSectorsTable;
let stockSectorQrFileName: typeof import("./InventoryStockSectorQrDialog.js").stockSectorQrFileName;

before(async () => {
  InventoryStockSectorsTable = (await import("./InventoryStockSectorsTab.js")).InventoryStockSectorsTable;
  stockSectorQrFileName = (await import("./InventoryStockSectorQrDialog.js")).stockSectorQrFileName;
});

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const OPTIONS: StockSectorFormOptions = {
  strategies: ["STANDARD"],
  itemTypes: [
    { itemType: "ADMINISTRATIVE_SUPPLY", requiresCostCenter: true },
    { itemType: "PACKAGING", requiresCostCenter: false },
  ],
  warehouses: [{ id: "wh-adm", code: "ADMINISTRATIVO", name: "Administrativo" }],
  costCenters: [{ id: "cc-adm", code: "ADM", name: "Administrativo" }],
};

const ADMINISTRATIVO: StockSectorRow = {
  id: "sector-1",
  code: "ADMINISTRATIVO",
  name: "Estoque Administrativo",
  slug: "administrativo",
  status: "ACTIVE",
  warehouseId: "wh-adm",
  strategy: "STANDARD",
  itemType: "ADMINISTRATIVE_SUPPLY",
  sessionCodePrefix: "ADM",
  allowsCounting: true,
  allowsWithdrawal: true,
  defaultCostCenterId: "cc-adm",
  warehouse: { id: "wh-adm", code: "ADMINISTRATIVO", name: "Administrativo", status: "ACTIVE" },
  defaultCostCenter: { id: "cc-adm", code: "ADM", name: "Administrativo", isActive: true },
};

function validAdmForm() {
  return {
    ...applyStockSectorName(createEmptyStockSectorForm(), "Administrativo"),
    code: "ADMINISTRATIVO",
    itemType: "ADMINISTRATIVE_SUPPLY",
    warehouseId: "wh-adm",
    defaultCostCenterId: "cc-adm",
  };
}

describe("setores · formulário (puro)", () => {
  it("1. o nome sugere código, slug e prefixo — até o usuário editar à mão", () => {
    assert.equal(suggestStockSectorCode("Estoque Administrativo"), "ESTOQUE_ADMINISTRATIVO");
    assert.equal(suggestStockSectorSlug("Estoque Administrativo"), "estoque-administrativo");
    assert.equal(suggestStockSectorSlug("  Manutenção / Peças "), "manutencao-pecas");
    assert.equal(suggestStockSectorPrefix("Administrativo"), "ADM");
    assert.equal(suggestStockSectorPrefix("EPI"), "EPI");
    // Prefixos dos setores fixos nunca são sugeridos.
    assert.equal(suggestStockSectorPrefix("MP"), "");
    assert.equal(suggestStockSectorPrefix("Paletes"), "PAL");
    assert.equal(suggestStockSectorPrefix("CP Geral"), "CPG");

    let form = applyStockSectorName(createEmptyStockSectorForm(), "EPI");
    assert.deepEqual([form.code, form.slug, form.sessionCodePrefix], ["EPI", "epi", "EPI"]);
    form = { ...form, slug: "epis", touched: { ...form.touched, slug: true } };
    form = applyStockSectorName(form, "Equipamentos");
    assert.equal(form.slug, "epis", "slug editado à mão é preservado");
    assert.equal(form.code, "EQUIPAMENTOS");
  });

  it("2. validação: campos obrigatórios, reservados e centro de custo", () => {
    const empty = validateStockSectorForm(createEmptyStockSectorForm(), OPTIONS, "create");
    for (const field of ["name", "code", "slug", "sessionCodePrefix", "itemType", "warehouseId"] as const) {
      assert.ok(empty[field], `${field} deveria acusar erro`);
    }
    assert.equal(isStockSectorFormValid(validateStockSectorForm(validAdmForm(), OPTIONS, "create")), true);

    const noCostCenter = validateStockSectorForm(
      { ...validAdmForm(), defaultCostCenterId: "" },
      OPTIONS,
      "create"
    );
    assert.match(noCostCenter.defaultCostCenterId ?? "", /centro de custo/i);
    // Tipo que não exige centro de custo passa sem ele.
    assert.equal(
      validateStockSectorForm(
        { ...validAdmForm(), itemType: "PACKAGING", defaultCostCenterId: "" },
        OPTIONS,
        "create"
      ).defaultCostCenterId,
      undefined
    );

    for (const [patch, field] of [
      [{ code: "RAW_MATERIAL" }, "code"],
      [{ slug: "raw-material" }, "slug"],
      [{ slug: "produto-acabado" }, "slug"],
      [{ sessionCodePrefix: "MP" }, "sessionCodePrefix"],
      [{ sessionCodePrefix: "ABCDE" }, "sessionCodePrefix"],
      [{ slug: "Com Espaço" }, "slug"],
    ] as const) {
      const errors = validateStockSectorForm({ ...validAdmForm(), ...patch }, OPTIONS, "create");
      assert.ok(errors[field], `${JSON.stringify(patch)} deveria ser recusado`);
    }

    const noOps = validateStockSectorForm(
      { ...validAdmForm(), allowsCounting: false, allowsWithdrawal: false },
      OPTIONS,
      "create"
    );
    assert.ok(noOps.operations);
  });

  it("3. payload de criação: almoxarifado existente OU novo, nunca os dois", () => {
    const existing = stockSectorFormToCreatePayload(validAdmForm()) as Record<string, unknown>;
    assert.equal(existing.warehouseId, "wh-adm");
    assert.equal("newWarehouse" in existing, false);
    assert.equal(existing.strategy, "STANDARD");
    assert.equal(existing.code, "ADMINISTRATIVO");
    assert.equal(existing.slug, "administrativo");
    assert.equal(existing.sessionCodePrefix, "ADM");
    assert.equal(existing.defaultCostCenterId, "cc-adm");

    const created = stockSectorFormToCreatePayload({
      ...validAdmForm(),
      warehouseMode: "new",
      newWarehouseCode: " epi ",
      newWarehouseName: " Almoxarifado de EPI ",
    }) as Record<string, unknown>;
    assert.equal("warehouseId" in created, false);
    assert.deepEqual(created.newWarehouse, {
      code: "EPI",
      name: "Almoxarifado de EPI",
      description: null,
    });

    const newWarehouseErrors = validateStockSectorForm(
      { ...validAdmForm(), warehouseMode: "new", warehouseId: "" },
      OPTIONS,
      "create"
    );
    assert.ok(newWarehouseErrors.newWarehouseCode);
    assert.ok(newWarehouseErrors.newWarehouseName);
    assert.equal(newWarehouseErrors.warehouseId, undefined);
  });

  it("4. payload de edição leva só o que mudou e nunca o código", () => {
    const form = stockSectorFormFromRow(ADMINISTRATIVO);
    assert.deepEqual(stockSectorFormToUpdatePayload(form, ADMINISTRATIVO), {});
    const patch = stockSectorFormToUpdatePayload(
      { ...form, name: "Adm", allowsWithdrawal: false, code: "OUTRO" },
      ADMINISTRATIVO
    );
    assert.deepEqual(patch, { name: "Adm", allowsWithdrawal: false });
    assert.equal(stockSectorCollectorPath("administrativo"), "/collector/sector/administrativo");
  });
});

describe("setores · tela (render estático)", () => {
  const noop = () => {};

  it("5. lista: colunas pedidas, setor configurável com ações, setores fixos protegidos", () => {
    const html = renderToStaticMarkup(
      <InventoryStockSectorsTable
        rows={[ADMINISTRATIVO]}
        legacyRows={LEGACY_STOCK_SECTOR_ROWS}
        canManage
        busyId={null}
        onQr={noop}
        onEdit={noop}
        onToggleStatus={noop}
      />
    );
    for (const column of [
      "Nome",
      "Código",
      "Almoxarifado",
      "Tipo de item",
      "Strategy",
      "Contagem",
      "Retirada",
      "Status",
      "QR",
      "Ações",
    ]) {
      assert.match(html, new RegExp(`<th[^>]*>${column}</th>`), `coluna ${column}`);
    }
    assert.match(html, /Estoque Administrativo/);
    assert.match(html, /Suprimento administrativo/);
    assert.match(html, /stock-sector-edit-ADMINISTRATIVO/);
    assert.match(html, /stock-sector-toggle-ADMINISTRATIVO/);
    assert.match(html, /stock-sector-qr-ADMINISTRATIVO/);

    for (const legacy of ["RAW_MATERIAL", "COMPONENT", "FINISHED_PRODUCT"]) {
      assert.match(html, new RegExp(`stock-sector-legacy-${legacy}`));
      assert.doesNotMatch(html, new RegExp(`stock-sector-edit-${legacy}`));
      assert.doesNotMatch(html, new RegExp(`stock-sector-toggle-${legacy}`));
    }
    assert.equal(html.match(/Protegido/g)?.length, 3);
    assert.equal(html.match(/Fixo do sistema/g)?.length, 3);
  });

  it("6. sem permissão de gestão não há editar/inativar; setor inativo não emite QR", () => {
    const html = renderToStaticMarkup(
      <InventoryStockSectorsTable
        rows={[{ ...ADMINISTRATIVO, status: "INACTIVE" }]}
        legacyRows={[]}
        canManage={false}
        busyId={null}
        onQr={noop}
        onEdit={noop}
        onToggleStatus={noop}
      />
    );
    assert.doesNotMatch(html, /stock-sector-edit-/);
    assert.doesNotMatch(html, /stock-sector-toggle-/);
    assert.match(html, /Inativo/);
    assert.match(html, /<button[^>]*disabled=""[^>]*data-testid="stock-sector-qr-ADMINISTRATIVO"/);
  });

  it("7. prévia: N itens, aviso claro com zero, e almoxarifado novo", () => {
    const some = renderToStaticMarkup(
      <StockSectorPopulationPreview
        preview={{ status: "ready", eligibleItems: 311 }}
        newWarehouse={false}
      />
    );
    assert.match(some, /Itens que este setor irá enxergar: 311/);

    const zero = renderToStaticMarkup(
      <StockSectorPopulationPreview
        preview={{ status: "ready", eligibleItems: 0 }}
        newWarehouse={false}
      />
    );
    assert.match(zero, /Itens que este setor irá enxergar: 0/);
    assert.match(zero, /amber/, "zero itens é aviso, não sucesso");
    assert.match(zero, /não poderá ser iniciada/);

    const fresh = renderToStaticMarkup(
      <StockSectorPopulationPreview preview={{ status: "idle" }} newWarehouse />
    );
    assert.match(fresh, /Almoxarifado novo/);
  });
});

describe("setores · navegação e fronteiras da tela", () => {
  it("8. aba Setores / Collector existe no Estoque, com rota e permissão de almoxarifados", () => {
    const tab = getVisibleInventoryTabs().find((t) => t.id === "stockSectors");
    assert.equal(tab?.label, "Setores / Collector");
    assert.equal(resolveInventoryTabFromPath("/inventory/stock-sectors"), "stockSectors");
    assert.equal(
      INVENTORY_UI_TABS.find((t) => t.id === "stockSectors")?.resourceKey,
      "operations.inventory.warehouses"
    );
    assert.match(read("src/App.tsx"), /path="inventory\/stock-sectors"/);
    const mod = read("src/components/InventoryModule.tsx");
    assert.match(mod, /tab === "stockSectors"/);
    assert.match(mod, /\/inventory\/stock-sectors/);
  });

  it("9. a tela não fala com o banco nem monta a URL do QR", () => {
    for (const file of [
      "src/components/inventory/InventoryStockSectorsTab.tsx",
      "src/components/inventory/InventoryStockSectorFormSheet.tsx",
      "src/components/inventory/InventoryStockSectorQrDialog.tsx",
      "src/components/inventory/inventoryStockSectorForm.ts",
    ]) {
      const source = read(file);
      assert.doesNotMatch(source, /@prisma\/client/, file);
      assert.doesNotMatch(source, /\.server(\.js)?"/, file);
      assert.doesNotMatch(source, /window\.location\.origin|location\.host/, file);
    }
    const dialog = read("src/components/inventory/InventoryStockSectorQrDialog.tsx");
    assert.match(dialog, /buildCollectorSectorQrEndpoint/);
    assert.match(dialog, /Copiar link/);
    assert.match(dialog, /Baixar imagem/);
    assert.match(dialog, /CollectorSectorQrPrintSheet/);
    assert.match(dialog, /status: "config"/, "erro de base pública aparece, sem URL inventada");
    assert.equal(stockSectorQrFileName("administrativo"), "qr-setor-administrativo.png");
    assert.equal(stockSectorQrFileName("RAW_MATERIAL"), "qr-setor-raw-material.png");
  });

  it("10. a prévia é pedida ao servidor (COUNT), não calculada com itens na tela", () => {
    const sheet = read("src/components/inventory/InventoryStockSectorFormSheet.tsx");
    assert.match(sheet, /\/api\/inventory\/stock-sectors\/preview/);
    assert.doesNotMatch(sheet, /\/api\/inventory\/items/);
    const tab = read("src/components/inventory/InventoryStockSectorsTab.tsx");
    assert.match(tab, /\/api\/inventory\/stock-sectors\/form-options/);
    assert.match(tab, /Novo setor/);
  });
});
