import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  formatSyncCardDateTime,
  formatSyncDurationMs,
  formatSyncIntOrDash,
} from "./nomusSyncCardFormat";

const ROOT = process.cwd();

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

describe("nomusSyncCardFormat", () => {
  it("divide data e hora para cards executivos", () => {
    const result = formatSyncCardDateTime("2026-07-08T15:38:21.000Z");
    assert.ok(result.value.length > 0);
    assert.ok(result.subtitle && result.subtitle.length > 0);
    assert.notEqual(result.value, "—");
    assert.doesNotMatch(result.value, /,/, "data não deve incluir vírgula com hora no valor principal");
  });

  it("retorna traço para data inválida", () => {
    assert.deepEqual(formatSyncCardDateTime(null), { value: "—" });
    assert.deepEqual(formatSyncCardDateTime("invalid"), { value: "—" });
  });

  it("formata duração legível", () => {
    assert.equal(formatSyncDurationMs(47 * 60 * 1000 + 13 * 1000), "47m 13s");
    assert.equal(formatSyncDurationMs(null), "—");
  });

  it("formata inteiros ou traço", () => {
    assert.equal(formatSyncIntOrDash(12), "12");
    assert.equal(formatSyncIntOrDash(undefined), "—");
  });
});

describe("nomusSyncMetricCards visual", () => {
  const CSS = "src/components/admin/nomus-sync-metric-cards.css";

  it("CSS executivo Nomus existe", () => {
    assert.ok(existsSync(join(ROOT, CSS)));
  });

  it("CSS evita font-weight 800 e tamanhos gigantes", () => {
    const css = read(CSS);
    assert.match(css, /font-weight:\s*600/);
    assert.doesNotMatch(css, /font-weight:\s*800/);
    assert.doesNotMatch(css, /text-4xl|text-5xl|font-black/);
  });

  it("CSS trata logs longos e datas", () => {
    const css = read(CSS);
    assert.match(css, /metric-card-value--wrap/);
    assert.match(css, /white-space:\s*nowrap/);
  });

  it("adminUi expõe grid executivo Nomus", () => {
    const adminUi = read("src/components/admin/adminUi.tsx");
    assert.match(adminUi, /nomusSyncMetrics/);
    assert.match(adminUi, /NOMUS_SYNC_METRIC_GRID_CLASS/);
    assert.match(adminUi, /nomus-sync-metric-cards\.css/);
  });

  it("cards Nomus usam nomusSyncMetrics", () => {
    for (const file of [
      "src/components/NomusDailySyncCard.tsx",
      "src/components/NomusAccountsPayableSyncCard.tsx",
      "src/components/NomusAccountsReceivableSyncCard.tsx",
    ]) {
      const src = read(file);
      assert.match(src, /nomusSyncMetrics/, `${file} deve usar nomusSyncMetrics`);
      assert.match(src, /nomus-sync-status-panel/, `${file} deve usar painel de status suave`);
    }
  });

  it("status diário usa badge suave", () => {
    const types = read("src/lib/nomusDailySyncStatusTypes.ts");
    assert.match(types, /bg-green-50\/80/);
    assert.doesNotMatch(types, /bg-green-100 text-green-900/);
  });
});
