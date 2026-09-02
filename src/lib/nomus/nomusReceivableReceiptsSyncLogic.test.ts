import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildReceiptsPageParams,
  computeReceiptsPaginationPlan,
  hasNextReceiptsPage,
  NOMUS_RECEIPTS_PAGE_SIZE,
  normalizeSinceArgument,
  pageIsFullyBeforeSince,
  parseReceiptsSyncCli,
  pickReceiptsArray,
} from "./nomusReceivableReceiptsSyncLogic.js";

describe("nomusReceivableReceiptsSyncLogic", () => {
  it("preview é o default e apply precisa ser explícito", () => {
    assert.equal(parseReceiptsSyncCli([]).mode, "preview");
    assert.equal(parseReceiptsSyncCli(["preview"]).mode, "preview");
    assert.equal(parseReceiptsSyncCli(["apply"]).mode, "apply");
    assert.equal(parseReceiptsSyncCli(["--apply"]).mode, "apply");
  });

  it("envia apenas `pagina` — único parâmetro comprovado do endpoint", () => {
    assert.deepEqual(buildReceiptsPageParams(3), { pagina: "3" });
    assert.deepEqual(buildReceiptsPageParams(0), { pagina: "1" });
    assert.deepEqual(buildReceiptsPageParams(Number.NaN), { pagina: "1" });
  });

  it("respeita as 50 linhas por página da instalação", () => {
    assert.equal(NOMUS_RECEIPTS_PAGE_SIZE, 50);
    assert.equal(hasNextReceiptsPage([], 1, 50), true);
    assert.equal(hasNextReceiptsPage([], 1, 49), false);
    assert.equal(hasNextReceiptsPage([], 1, 0), false);
    assert.equal(hasNextReceiptsPage({ totalPaginas: 2 }, 2, 50), false);
    assert.equal(hasNextReceiptsPage({ hasMore: false }, 1, 50), false);
  });

  it("extrai a lista de recebimentos de formatos de envelope conhecidos", () => {
    assert.equal(pickReceiptsArray([{ id: 1 }]).length, 1);
    assert.equal(pickReceiptsArray({ recebimentos: [{ id: 1 }] }).length, 1);
    assert.equal(pickReceiptsArray({ data: { dados: [{ id: 1 }, { id: 2 }] } }).length, 2);
    assert.deepEqual(pickReceiptsArray(null), []);
  });

  it("plano de paginação suporta backfill histórico", () => {
    const options = parseReceiptsSyncCli(["apply", "--startPage", "5", "--maxPages", "40"]);
    assert.deepEqual(computeReceiptsPaginationPlan(options), { firstPage: 5, lastPage: 44 });

    const single = parseReceiptsSyncCli(["preview", "--page", "7"]);
    assert.equal(single.singlePage, 7);
    assert.deepEqual(computeReceiptsPaginationPlan(single), { firstPage: 7, lastPage: 7 });
  });

  it("--since aceita ISO e BR", () => {
    assert.equal(normalizeSinceArgument("2026-01-01"), "2026-01-01");
    assert.equal(normalizeSinceArgument("01/01/2026"), "2026-01-01");
    assert.equal(normalizeSinceArgument("janeiro"), null);
    assert.equal(parseReceiptsSyncCli(["apply", "--since", "01/06/2026"]).sinceCivilDate, "2026-06-01");
  });

  it("só encerra o backfill quando a página INTEIRA é anterior à janela", () => {
    assert.equal(pageIsFullyBeforeSince(["2026-05-30", "2026-05-29"], "2026-06-01"), true);
    // Um único item dentro da janela mantém a varredura — nada é descartado por item.
    assert.equal(pageIsFullyBeforeSince(["2026-05-30", "2026-06-02"], "2026-06-01"), false);
    assert.equal(pageIsFullyBeforeSince([null, null], "2026-06-01"), false);
    assert.equal(pageIsFullyBeforeSince(["2026-05-30"], null), false);
  });
});
