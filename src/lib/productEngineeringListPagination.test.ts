import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildProductEngineeringPagination,
  formatProductEngineeringDisplayRange,
  paginateProductEngineeringItems,
  PRODUCT_ENGINEERING_PAGE_SIZE,
  shouldShowProductEngineeringPagination,
} from "./productEngineeringListPagination.js";
import { filterProductEngineeringListItems } from "./productEngineeringListFilters.js";

const item = (over: Record<string, unknown> = {}) => ({
  id: String(over.id ?? "p-1"),
  name: String(over.name ?? "Produto"),
  sku: String(over.sku ?? "SKU-1"),
  status: String(over.status ?? "ACTIVE"),
  ...over,
});

describe("paginação da grade de Engenharia", () => {
  it("página padrão é de 20 itens", () => {
    assert.equal(PRODUCT_ENGINEERING_PAGE_SIZE, 20);
    const pagination = buildProductEngineeringPagination(137, 1);
    assert.equal(pagination.pageSize, 20);
    assert.equal(pagination.totalPages, 7);
  });

  it("fatia exatamente a página pedida", () => {
    const items = Array.from({ length: 45 }, (_, i) => i + 1);
    const page2 = paginateProductEngineeringItems(
      items,
      buildProductEngineeringPagination(items.length, 2)
    );
    assert.equal(page2.length, 20);
    assert.equal(page2[0], 21);
    assert.equal(page2[19], 40);

    const page3 = paginateProductEngineeringItems(
      items,
      buildProductEngineeringPagination(items.length, 3)
    );
    assert.equal(page3.length, 5, "última página traz o resto");
  });

  it("página fora do intervalo é grampeada — nunca devolve tela vazia", () => {
    const pagination = buildProductEngineeringPagination(3, 9);
    assert.equal(pagination.page, 1);
    assert.equal(pagination.totalPages, 1);
    assert.equal(paginateProductEngineeringItems([1, 2, 3], pagination).length, 3);
  });

  it("lista vazia continua com uma página", () => {
    const pagination = buildProductEngineeringPagination(0, 1);
    assert.equal(pagination.totalPages, 1);
    assert.equal(pagination.total, 0);
    assert.equal(shouldShowProductEngineeringPagination(pagination.totalPages), false);
  });

  it("controles só aparecem com mais de uma página", () => {
    assert.equal(shouldShowProductEngineeringPagination(1), false);
    assert.equal(shouldShowProductEngineeringPagination(2), true);
  });

  it("rodapé mostra faixa, total filtrado e página", () => {
    assert.equal(
      formatProductEngineeringDisplayRange(buildProductEngineeringPagination(137, 2), 200),
      "Exibindo 21–40 de 137 item(ns) (filtrado de 200) · Página 2 de 7."
    );
    assert.equal(
      formatProductEngineeringDisplayRange(buildProductEngineeringPagination(12, 1), 12),
      "Exibindo 12 item(ns)."
    );
    assert.equal(
      formatProductEngineeringDisplayRange(buildProductEngineeringPagination(0, 1), 80),
      "Exibindo 0 de 80 item(ns)."
    );
  });
});

/**
 * O comportamento que o negócio pediu: buscar NÃO é buscar na página — a
 * busca varre a lista inteira e só depois o resultado é paginado.
 */
describe("busca varre todas as páginas, não só a visível", () => {
  const items = Array.from({ length: 45 }, (_, i) =>
    item({ id: `p-${i}`, name: `Produto ${i}`, sku: `SKU-${i}` })
  );

  it("item que estaria na última página é encontrado pela busca", () => {
    const alvo = items[44]!;
    // Sem busca, o alvo está fora da primeira página.
    const semBusca = paginateProductEngineeringItems(
      items,
      buildProductEngineeringPagination(items.length, 1)
    );
    assert.ok(!semBusca.some((i) => i.id === alvo.id));

    // Filtra ANTES de paginar — é assim que a tela monta a lista.
    const filtrados = filterProductEngineeringListItems(items as never, {
      search: "SKU-44",
      status: "",
      ciu: "",
      engineering: "",
    });
    const comBusca = paginateProductEngineeringItems(
      filtrados,
      buildProductEngineeringPagination(filtrados.length, 1)
    );
    assert.equal(comBusca.length, 1);
    assert.equal((comBusca[0] as { id: string }).id, alvo.id);
  });

  it("o total paginado é o total FILTRADO, não o da base", () => {
    const filtrados = filterProductEngineeringListItems(items as never, {
      search: "Produto 4",
      status: "",
      ciu: "",
      engineering: "",
    });
    const pagination = buildProductEngineeringPagination(filtrados.length, 1);
    assert.equal(pagination.total, filtrados.length);
    assert.ok(pagination.total < items.length);
  });
});

/**
 * Trava de regressão da tela: a grade tem que paginar DEPOIS de filtrar, e a
 * seleção em lote continua valendo para todos os itens filtrados.
 */
describe("ProductModule — fiação da paginação na tela", () => {
  const src = readFileSync(
    join(process.cwd(), "src/components/ProductModule.tsx"),
    "utf8"
  );

  it("renderiza a PÁGINA, não a lista filtrada inteira", () => {
    assert.match(src, /pagedItems\.map\(/);
    assert.ok(
      !/\bfilteredItems\.map\(\(item: ProductWithCostSummary\)/.test(src),
      "corpo da tabela não pode renderizar a lista inteira"
    );
  });

  it("pagina a partir da lista JÁ filtrada (busca varre tudo)", () => {
    assert.match(src, /paginateProductEngineeringItems\(\s*filteredItems/);
    assert.match(src, /buildProductEngineeringPagination\(filteredItems\.length/);
  });

  it("volta para a primeira página quando busca/filtro/segmento mudam", () => {
    assert.match(src, /setListPage\(1\)/);
    assert.match(src, /appliedSearch,[\s\S]{0,200}engineeringSegment,/);
  });

  it("seleção em lote continua sobre todos os filtrados, não só a página", () => {
    assert.match(src, /selectedIds\.length === filteredItems\.length/);
    assert.match(src, /todas as páginas/);
  });

  it("controles de página existem na tela", () => {
    assert.match(src, /data-testid="product-engineering-pagination"/);
    assert.match(src, /shouldShowProductEngineeringPagination/);
  });
});
