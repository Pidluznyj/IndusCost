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
    const mockStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    };
    type GlobalWithWindow = typeof globalThis & { window?: { localStorage: typeof mockStorage } };
    const globalRef = globalThis as GlobalWithWindow;
    const originals = {
      global: globalRef.localStorage,
      window: globalRef.window,
    };
    Object.defineProperty(globalRef, "localStorage", {
      configurable: true,
      value: mockStorage,
    });
    globalRef.window = { localStorage: mockStorage };
    try {
      persistSidebarCollapsed(true);
      assert.equal(readStoredSidebarCollapsed(), true);
      persistSidebarCollapsed(false);
      assert.equal(readStoredSidebarCollapsed(), false);
      assert.equal(storage.get(SIDEBAR_COLLAPSED_STORAGE_KEY), "false");
    } finally {
      Object.defineProperty(globalRef, "localStorage", {
        configurable: true,
        value: originals.global,
      });
      if (originals.window === undefined) {
        delete globalRef.window;
      } else {
        globalRef.window = originals.window;
      }
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

  it("header exibe breadcrumb contextual em vez de título fixo Dashboard", () => {
    const layout = read("src/components/layout/Layout.tsx");
    assert.match(layout, /AppHeaderBreadcrumb/);
    assert.doesNotMatch(layout, /<h1 className="text-xl font-semibold[^"]*">Dashboard<\/h1>/);
  });

  it("botão mobile usa área de toque mínima 44px", () => {
    const layout = read("src/components/layout/Layout.tsx");
    assert.match(layout, /min-h-11 min-w-11/);
  });
});

describe("Sidebar.tsx — colapso e drawer", () => {
  it("usa contexto compartilhado para colapso desktop", () => {
    const sidebar = read("src/components/layout/Sidebar.tsx");
    assert.match(sidebar, /useSidebarLayout/);
    assert.match(sidebar, /desktopCollapsed/);
    assert.match(sidebar, /toggleDesktopCollapsed/);
    assert.doesNotMatch(sidebar, /useState\([^)]*\)[\s\S]{0,40}desktopCollapsed/s);
  });

  it("botão de recolher/expandir com acessibilidade", () => {
    const sidebar = read("src/components/layout/Sidebar.tsx");
    assert.match(sidebar, /Recolher menu lateral/);
    assert.match(sidebar, /Expandir menu lateral/);
    assert.match(sidebar, /title=\{isMobile \? "Fechar menu" : collapsed \? "Expandir menu" : "Recolher menu"\}/);
  });

  it("desktop colapsado usa rail com rótulos curtos e flyout por clique", () => {
    const sidebar = read("src/components/layout/Sidebar.tsx");
    assert.match(sidebar, /resolveSidebarAsideWidth/);
    assert.match(sidebar, /data-sidebar-collapsed=\{collapsed \? "true" : "false"\}/);
    assert.match(sidebar, /data-sidebar-collapsed-rail/);
    assert.match(sidebar, /sidebar-collapsed-short-label/);
    assert.match(sidebar, /SidebarCollapsedGroupButton/);
    assert.match(sidebar, /SidebarCollapsedFlyout/);
    assert.match(sidebar, /resolveModuleShortLabel/);
    assert.match(sidebar, /resolveNavigationGroupShortLabel/);
    assert.match(
      sidebar,
      /\{collapsed \? \([\s\S]*SidebarCollapsedGroupButton[\s\S]*\) : \([\s\S]*SidebarNavGroup/s
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

  it("fecha drawer mobile com tecla Escape", () => {
    const context = read("src/contexts/SidebarLayoutContext.tsx");
    assert.match(context, /event\.key === "Escape"/);
    assert.match(context, /setMobileOpen\(false\)/);
  });
});
