import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  formatSalesOrdersPaginationNote,
  readSalesOrdersPageCursor,
  resolveNextSalesOrdersPageCursor,
} from "./nomusSalesOrdersPaginationCursor.js";

describe("nomusSalesOrdersPaginationCursor", () => {
  it("lê cursor do arquivo quando válido", () => {
    assert.equal(
      readSalesOrdersPageCursor({
        cursorFile: "/tmp/cursor",
        defaultStartPage: 1,
        cursorContent: "696",
      }),
      696
    );
    assert.equal(
      readSalesOrdersPageCursor({
        cursorFile: "/tmp/cursor",
        defaultStartPage: 1,
        cursorContent: "",
      }),
      1
    );
  });

  it("reinicia cursor quando janela inteira vem vazia", () => {
    const next = resolveNextSalesOrdersPageCursor({
      startPage: 696,
      maxPages: 5,
      lastPageFetched: 696,
      totalPedidos: 0,
      stoppedBecauseEmpty: true,
      completedWindow: false,
    });
    assert.equal(next.nextStart, 1);
    assert.match(next.reason, /janela vazia/);
  });

  it("reinicia cursor ao atingir página vazia após dados", () => {
    const next = resolveNextSalesOrdersPageCursor({
      startPage: 4,
      maxPages: 5,
      lastPageFetched: 6,
      totalPedidos: 120,
      stoppedBecauseEmpty: true,
      completedWindow: false,
    });
    assert.equal(next.nextStart, 1);
  });

  it("avança cursor quando bloco completo retorna dados", () => {
    const next = resolveNextSalesOrdersPageCursor({
      startPage: 1,
      maxPages: 5,
      lastPageFetched: 5,
      totalPedidos: 500,
      stoppedBecauseEmpty: false,
      completedWindow: true,
    });
    assert.equal(next.nextStart, 6);
  });

  it("formata nota de paginação com cursor", () => {
    assert.equal(
      formatSalesOrdersPaginationNote({
        startPage: 691,
        maxPages: 5,
        cursorFile: "/tmp/induscost-nomus-sales-orders-page.cursor",
      }),
      "cursor rotativo /tmp/induscost-nomus-sales-orders-page.cursor: janela páginas 691..695"
    );
  });

  it("sync grava cursor somente após fetch", () => {
    const sync = readFileSync(
      join(process.cwd(), "scripts/nomusSalesOrdersSyncV1.ts"),
      "utf8"
    );
    assert.match(sync, /readSalesOrdersPaginationWindow/);
    assert.match(sync, /commitSalesOrdersPaginationCursor/);
    assert.match(sync, /resolveNextSalesOrdersPageCursor/);
    assert.doesNotMatch(sync, /resolveSalesOrdersPaginationWindow/);
    assert.doesNotMatch(sync, /nextStart = startPage \+ maxPages[\s\S]*writeFileSync\(cursorFile, String\(nextStart\)/);
  });
});
