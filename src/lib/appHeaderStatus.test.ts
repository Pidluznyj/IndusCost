import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  formatHeaderDateTimeCompact,
  formatHeaderNextNomusRunCompact,
  formatHeaderNomusSyncCompact,
  formatHeaderNomusSyncFull,
  formatHeaderSyncStatusLabel,
  resolveHeaderSyncStatusClass,
  resolveNextNomusRunAt,
} from "./appHeaderStatus.js";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("appHeaderStatus — formatação", () => {
  it("labels e classes de status Nomus", () => {
    assert.equal(formatHeaderSyncStatusLabel("SUCCESS"), "Sucesso");
    assert.equal(formatHeaderSyncStatusLabel("FAILED"), "Falha");
    assert.equal(resolveHeaderSyncStatusClass("SUCCESS"), "text-green-600");
    assert.equal(resolveHeaderSyncStatusClass("FAILED"), "text-red-600");
  });

  it("compacta data/hora para dd/mm HH:mm", () => {
    assert.equal(formatHeaderDateTimeCompact("09/07/2026, 10:20:00"), "09/07 10:20");
    assert.equal(formatHeaderDateTimeCompact("—"), "—");
    const date = new Date(2026, 6, 9, 10, 20, 0);
    assert.equal(formatHeaderDateTimeCompact(date), "09/07 10:20");
  });

  it("gera textos full e compactos de sincronização", () => {
    assert.match(
      formatHeaderNomusSyncFull({ lastSyncAt: "09/07/2026, 10:20:00", statusLabel: "Sucesso" }),
      /Última sincronia com o Nomus/
    );
    assert.equal(
      formatHeaderNomusSyncCompact({ lastSyncAt: "09/07/2026, 10:20:00", statusLabel: "Sucesso" }),
      "Nomus: 09/07 10:20 (Sucesso)"
    );
    assert.match(formatHeaderNextNomusRunCompact("09/07/2026, 11:17:00"), /Próx\.: 09\/07 11:17/);
  });

  it("resolve próxima execução no minuto :17", () => {
    const before = resolveNextNomusRunAt(new Date(2026, 6, 9, 10, 10, 0));
    assert.equal(before.getMinutes(), 17);
    assert.equal(before.getHours(), 10);
    const after = resolveNextNomusRunAt(new Date(2026, 6, 9, 10, 20, 0));
    assert.equal(after.getMinutes(), 17);
    assert.equal(after.getHours(), 11);
  });
});

describe("AppHeaderBar — layout responsivo", () => {
  it("header bar agrupa indicadores por breakpoint", () => {
    const bar = read("src/components/layout/AppHeaderBar.tsx");
    assert.match(bar, /data-app-header-bar/);
    assert.match(bar, /MarketHeaderTicker/);
    assert.match(bar, /AppHeaderStatusMenu/);
    assert.match(bar, /hidden lg:flex/);
    assert.match(bar, /lg:hidden/);
    assert.match(bar, /data-header-nomus-sync="compact"/);
    assert.match(bar, /data-header-nomus-sync="full"/);
    assert.match(bar, /data-header-user-avatar/);
    assert.match(bar, /AppHeaderBreadcrumb/);
    assert.match(bar, /min-w-0/);
  });

  it("versão compacta de Nomus e Online sem remover essenciais", () => {
    const bar = read("src/components/layout/AppHeaderBar.tsx");
    assert.match(bar, /OnlineBadge compact/);
    assert.match(bar, /formatHeaderNomusSyncCompact/);
    assert.match(bar, /Última sincronia com o Nomus/);
    assert.match(bar, /Sistema Online/);
  });

  it("menu Status aparece abaixo de lg e usa clique, não hover", () => {
    const menu = read("src/components/layout/AppHeaderStatusMenu.tsx");
    assert.match(menu, /app-header-status-menu-trigger/);
    assert.match(menu, /aria-expanded=\{open\}/);
    assert.match(menu, /onClick=\{\(\) => setOpen/);
    assert.match(menu, /event\.key === "Escape"/);
    assert.doesNotMatch(menu, /onMouseEnter/);
    assert.match(menu, /min-h-11/);
  });
});

describe("Layout.tsx — header responsivo", () => {
  it("usa AppHeaderBar e mantém fetch Nomus", () => {
    const layout = read("src/components/layout/Layout.tsx");
    assert.match(layout, /AppHeaderBar/);
    assert.match(layout, /fetchJsonOk/);
    assert.match(layout, /\/api\/settings\/nomus-sync\/logs/);
    assert.match(layout, /openMobileSidebar/);
  });

  it("sidebar recolhida não quebra área principal", () => {
    const layout = read("src/components/layout/Layout.tsx");
    assert.match(layout, /<main className="flex-1 flex flex-col h-full min-w-0/);
  });
});
