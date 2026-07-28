import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appendStockTabletSearchPages,
  assertStockTabletListItemHasNoCostFields,
  buildMaterialStockTabletSearchUrl,
  fetchMaterialStockTabletSearch,
  hasMoreStockTabletPages,
  isMaterialStockSearchAbortError,
  MATERIAL_STOCK_LIST_FILTERS,
  MATERIAL_STOCK_LIST_PAGE_SIZE,
  resolvePreservedStockSelection,
  shouldAutoSelectFirstStockItem,
  summarizeStockListDescription,
} from "./materialStockTabletSearchClient.js";
import type { MaterialStockTabletListItem } from "./materialStockTabletTypes.js";

function row(
  id: string,
  overrides: Partial<MaterialStockTabletListItem> = {}
): MaterialStockTabletListItem {
  return {
    id,
    code: `MP-${id}`,
    description: "Material",
    unit: "kg",
    currentQuantity: 10,
    contingencyQuantity: null,
    minimumQuantity: null,
    recommendedQuantity: null,
    stockStatus: "NAO_CONFIGURADO",
    lastStockConferenceAt: null,
    lastStockConferenceUser: null,
    stockConferenceVersion: 1,
    updatedAt: null,
    ...overrides,
  };
}

describe("materialStockTabletSearchClient — URL e filtros", () => {
  it("busca rápida monta q + ativos + página", () => {
    const url = buildMaterialStockTabletSearchUrl({
      q: "aço",
      page: 1,
      pageSize: MATERIAL_STOCK_LIST_PAGE_SIZE,
    });
    const parsed = new URL(url, "http://local.test");
    assert.equal(parsed.pathname, "/api/materials/stock-tablet/search");
    assert.equal(parsed.searchParams.get("materialStatus"), "ACTIVE");
    assert.equal(parsed.searchParams.get("q"), "aço");
    assert.equal(parsed.searchParams.get("page"), "1");
    assert.doesNotMatch(url, /currentCost|landedCost/);
  });

  it("filtros mapeiam stockStatus, missingLevels e staleConference", () => {
    assert.match(
      buildMaterialStockTabletSearchUrl({ filter: "CRITICO" }),
      /stockStatus=CRITICO/
    );
    assert.match(
      buildMaterialStockTabletSearchUrl({ filter: "ATENCAO" }),
      /stockStatus=ATENCAO/
    );
    assert.match(
      buildMaterialStockTabletSearchUrl({ filter: "EMERGENCIA" }),
      /stockStatus=EMERGENCIA/
    );
    assert.match(
      buildMaterialStockTabletSearchUrl({ filter: "SEM_ESTOQUE" }),
      /stockStatus=SEM_ESTOQUE/
    );
    assert.match(
      buildMaterialStockTabletSearchUrl({ filter: "MISSING_LEVELS" }),
      /missingLevels=true/
    );
    assert.match(
      buildMaterialStockTabletSearchUrl({ filter: "STALE_CONFERENCE" }),
      /staleConference=true/
    );
    assert.doesNotMatch(
      buildMaterialStockTabletSearchUrl({ filter: "ALL" }),
      /stockStatus=|missingLevels=|staleConference=/
    );
    assert.equal(MATERIAL_STOCK_LIST_FILTERS[0]?.label, "Todos");
  });
});

describe("materialStockTabletSearchClient — paginação e seleção", () => {
  it("paginação indica mais resultados e faz append sem duplicar", () => {
    assert.equal(
      hasMoreStockTabletPages({
        page: 1,
        totalPages: 3,
        loadedCount: 30,
        total: 75,
      }),
      true
    );
    assert.equal(
      hasMoreStockTabletPages({
        page: 3,
        totalPages: 3,
        loadedCount: 75,
        total: 75,
      }),
      false
    );
    const merged = appendStockTabletSearchPages(
      [row("1"), row("2")],
      [row("2"), row("3")]
    );
    assert.deepEqual(
      merged.map((r) => r.id),
      ["1", "2", "3"]
    );
  });

  it("preserva seleção quando possível; auto-select só em split sem deep link", () => {
    assert.equal(
      resolvePreservedStockSelection("2", [row("1"), row("2")]),
      "2"
    );
    assert.equal(resolvePreservedStockSelection("9", [row("1")]), null);
    assert.equal(
      shouldAutoSelectFirstStockItem({
        layoutMode: "split",
        routeMaterialId: null,
        rows: [row("a"), row("b")],
        alreadyAutoSelected: false,
      }),
      "a"
    );
    assert.equal(
      shouldAutoSelectFirstStockItem({
        layoutMode: "stacked",
        routeMaterialId: null,
        rows: [row("a")],
        alreadyAutoSelected: false,
      }),
      null
    );
    assert.equal(
      shouldAutoSelectFirstStockItem({
        layoutMode: "split",
        routeMaterialId: "x",
        rows: [row("a")],
        alreadyAutoSelected: false,
      }),
      null
    );
  });
});

describe("materialStockTabletSearchClient — cancelamento e custos", () => {
  it("reconhece AbortError e não aceita campos de custo na lista", () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    assert.equal(isMaterialStockSearchAbortError(abort), true);
    assert.equal(isMaterialStockSearchAbortError(new Error("rede")), false);

    const clean = assertStockTabletListItemHasNoCostFields({
      id: "1",
      code: "MP",
      currentQuantity: 1,
    });
    assert.deepEqual(clean, []);
    const dirty = assertStockTabletListItemHasNoCostFields({
      id: "1",
      currentCost: 10,
      landedCost: 11,
    });
    assert.ok(dirty.includes("currentCost"));
    assert.ok(dirty.includes("landedCost"));
  });

  it("resume descrição longa", () => {
    const long = "A".repeat(100);
    const summary = summarizeStockListDescription(long, 20);
    assert.ok(summary.endsWith("…"));
    assert.ok(summary.length <= 20);
  });
});

describe("materialStockTabletSearchClient — contrato ativo/inativo", () => {
  it("URL sempre força materialStatus=ACTIVE (inativo ausente por padrão)", () => {
    const url = buildMaterialStockTabletSearchUrl({ q: "x", filter: "ALL" });
    assert.match(url, /materialStatus=ACTIVE/);
    assert.doesNotMatch(url, /materialStatus=INACTIVE|materialStatus=ALL/);
  });
});

describe("materialStockTabletSearchClient — fetch abort e rede", () => {
  it("cancelamento de request propaga AbortError e não aplica resultado antigo", async () => {
    const originalFetch = globalThis.fetch;
    let sawSignal = false;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      sawSignal = Boolean(init?.signal);
      return await new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("The operation was aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    }) as typeof fetch;
    try {
      const controller = new AbortController();
      const pending = fetchMaterialStockTabletSearch({
        q: "nova",
        signal: controller.signal,
      });
      controller.abort();
      await assert.rejects(pending, (err: unknown) => isMaterialStockSearchAbortError(err));
      assert.equal(sawSignal, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("erro de rede sobe mensagem sem campos de custo", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    try {
      await assert.rejects(
        () => fetchMaterialStockTabletSearch({ q: "x" }),
        (err: unknown) => err instanceof TypeError && /fetch/i.test(String(err.message))
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
