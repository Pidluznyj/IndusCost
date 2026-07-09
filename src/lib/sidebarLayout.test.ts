import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  parseStoredSidebarCollapsed,
  persistSidebarCollapsed,
  readStoredSidebarCollapsed,
  resolveSidebarAsideWidth,
  serializeSidebarCollapsed,
  SIDEBAR_COLLAPSED_STORAGE_KEY,
  SIDEBAR_LAYOUT_WIDTH_COLLAPSED,
  SIDEBAR_LAYOUT_WIDTH_EXPANDED,
  SIDEBAR_MOBILE_MEDIA_QUERY,
} from "./sidebarLayout.js";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("sidebarLayout", () => {
  it("parseia estado colapsado do localStorage", () => {
    assert.equal(parseStoredSidebarCollapsed(null), false);
    assert.equal(parseStoredSidebarCollapsed(undefined), false);
    assert.equal(parseStoredSidebarCollapsed("true"), true);
    assert.equal(parseStoredSidebarCollapsed("false"), false);
    assert.equal(parseStoredSidebarCollapsed(serializeSidebarCollapsed(true)), true);
    assert.equal(parseStoredSidebarCollapsed(serializeSidebarCollapsed(false)), false);
    assert.equal(parseStoredSidebarCollapsed("{invalid"), false);
  });

  it("serializa boolean para localStorage", () => {
    assert.equal(serializeSidebarCollapsed(true), "true");
    assert.equal(serializeSidebarCollapsed(false), "false");
  });

  it("resolve largura da sidebar por viewport e colapso", () => {
    assert.equal(
      resolveSidebarAsideWidth({ isMobile: true, desktopCollapsed: true }),
      SIDEBAR_LAYOUT_WIDTH_EXPANDED
    );
    assert.equal(
      resolveSidebarAsideWidth({ isMobile: false, desktopCollapsed: false }),
      SIDEBAR_LAYOUT_WIDTH_EXPANDED
    );
    assert.equal(
      resolveSidebarAsideWidth({ isMobile: false, desktopCollapsed: true }),
      SIDEBAR_LAYOUT_WIDTH_COLLAPSED
    );
  });

  it("chave de storage documentada", () => {
    assert.equal(SIDEBAR_COLLAPSED_STORAGE_KEY, "induscost.sidebar.collapsed");
  });

  it("persiste e recupera colapso no localStorage", () => {
    const storage = new Map<string, string>();
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          storage.set(key, value);
        },
      },
    });
    try {
      persistSidebarCollapsed(true);
      assert.equal(readStoredSidebarCollapsed(), true);
      persistSidebarCollapsed(false);
      assert.equal(readStoredSidebarCollapsed(), false);
      assert.equal(storage.get(SIDEBAR_COLLAPSED_STORAGE_KEY), "false");
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: original,
      });
    }
  });
});

describe("Layout.tsx — recolhimento do menu lateral", () => {
  it("envolve o shell com SidebarLayoutProvider", () => {
    const layout = read("src/components/layout/Layout.tsx");
    assert.match(layout, /SidebarLayoutProvider/);
    assert.match(layout, /<LayoutShell \/>/);
  });

  it("área principal ocupa largura disponível com min-w-0", () => {
    const layout = read("src/components/layout/Layout.tsx");
    assert.match(layout, /<main className="flex-1 flex flex-col h-full min-w-0/);
  });

  it("mobile: backdrop fecha drawer ao clicar fora", () => {
    const layout = read("src/components/layout/Layout.tsx");
    assert.match(layout, /SidebarMobileBackdrop/);
    assert.match(layout, /closeMobileSidebar/);
    assert.match(layout, /aria-label="Fechar menu lateral"/);
    assert.match(layout, /fixed inset-0 z-20 bg-black\/40 lg:hidden/);
  });

  it("mobile: botão no header abre o menu lateral", () => {
    const layout = read("src/components/layout/Layout.tsx");
    assert.match(layout, /openMobileSidebar/);
    assert.match(layout, /aria-label="Abrir menu lateral"/);
    assert.match(layout, /PanelLeft/);
    assert.match(layout, /\{isMobile \? \(/);
  });

  it("header global permanece com ticker, Nomus e usuário", () => {
    const layout = read("src/components/layout/Layout.tsx");
    assert.match(layout, /MarketHeaderTicker/);
    assert.match(layout, /Sistema Online/);
    assert.match(layout, /Última sincronia com o Nomus/);
    assert.match(layout, /formatRoleLabel/);
  });
});

describe("Sidebar.tsx — colapso e drawer", () => {
  it("usa contexto compartilhado em vez de useState local", () => {
    const sidebar = read("src/components/layout/Sidebar.tsx");
    assert.match(sidebar, /useSidebarLayout/);
    assert.match(sidebar, /toggleDesktopCollapsed/);
    assert.doesNotMatch(sidebar, /useState\(false\).*collapsed/s);
  });

  it("botão de recolher/expandir com acessibilidade", () => {
    const sidebar = read("src/components/layout/Sidebar.tsx");
    assert.match(sidebar, /Recolher menu lateral/);
    assert.match(sidebar, /Expandir menu lateral/);
    assert.match(sidebar, /title=\{isMobile \? "Fechar menu" : collapsed \? "Expandir menu" : "Recolher menu"\}/);
  });

  it("desktop colapsado mantém ícones via flatAccessibleItems", () => {
    const sidebar = read("src/components/layout/Sidebar.tsx");
    assert.match(sidebar, /resolveSidebarAsideWidth/);
    assert.match(sidebar, /data-sidebar-collapsed=\{collapsed \? "true" : "false"\}/);
    assert.match(
      sidebar,
      /\{collapsed \? \([\s\S]*flatAccessibleItems[\s\S]*\) : \([\s\S]*SidebarNavGroup/s
    );
  });

  it("mobile usa drawer fixo com translate e fecha ao navegar", () => {
    const sidebar = read("src/components/layout/Sidebar.tsx");
    assert.match(sidebar, /data-sidebar-mobile-open/);
    assert.match(sidebar, /translate-x-0/);
    assert.match(sidebar, /-translate-x-full/);
    assert.match(sidebar, /closeMobileSidebar/);
    assert.match(sidebar, /\[location\.pathname, isMobile, closeMobileSidebar\]/);
  });
});

describe("SidebarLayoutContext — viewport mobile", () => {
  it("usa media query alinhada ao breakpoint lg", () => {
    const context = read("src/contexts/SidebarLayoutContext.tsx");
    assert.match(context, /SIDEBAR_MOBILE_MEDIA_QUERY/);
    assert.equal(SIDEBAR_MOBILE_MEDIA_QUERY, "(max-width: 1023px)");
    assert.match(context, /persistSidebarCollapsed/);
    assert.match(context, /readStoredSidebarCollapsed/);
  });
});
