import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  EXECUTIVE_ALERT_VARIANTS,
  executiveAlertBadgeClass,
  executiveAlertInlineTextClass,
  executiveAlertShellClass,
  frozenCostTraceToExecutiveVariant,
} from "./executiveAlertStyles.js";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("executiveAlertStyles", () => {
  it("attention usa paleta âmbar clara com fundo preservado no dark mode", () => {
    const tokens = EXECUTIVE_ALERT_VARIANTS.attention;
    assert.match(tokens.shell, /bg-\[#FFFBEB\]/);
    assert.match(tokens.shell, /dark:bg-\[#FFFBEB\]/);
    assert.match(tokens.shell, /border-\[#F59E0B\]/);
    assert.match(tokens.title, /#92400E/);
    assert.match(tokens.description, /#78350F/);
    assert.match(tokens.badge, /#FDE68A/);
    assert.match(tokens.panel, /bg-white/);
    assert.doesNotMatch(tokens.shell, /dark:bg-amber-950/);
    assert.doesNotMatch(tokens.shell, /dark:bg-slate-950/);
  });

  it("danger usa vermelho claro executivo", () => {
    const tokens = EXECUTIVE_ALERT_VARIANTS.danger;
    assert.match(tokens.shell, /bg-\[#FEF2F2\]/);
    assert.match(tokens.shell, /border-\[#FCA5A5\]/);
    assert.match(tokens.title, /#991B1B/);
  });

  it("success usa verde claro executivo", () => {
    const tokens = EXECUTIVE_ALERT_VARIANTS.success;
    assert.match(tokens.shell, /bg-\[#ECFDF5\]/);
    assert.match(tokens.shell, /#86EFAC/);
    assert.match(tokens.title, /#065F46/);
  });

  it("info usa cinza neutro claro", () => {
    const tokens = EXECUTIVE_ALERT_VARIANTS.info;
    assert.match(tokens.shell, /bg-\[#F8FAFC\]/);
    assert.match(tokens.shell, /border-\[#CBD5E1\]/);
    assert.match(tokens.description, /#334155/);
  });

  it("shell compacto e inline aplicam padding adequado", () => {
    assert.match(executiveAlertShellClass("attention", "compact"), /rounded-xl p-3/);
    assert.match(executiveAlertShellClass("attention", "inline"), /rounded-lg p-2/);
    assert.match(executiveAlertShellClass("attention", "default"), /rounded-2xl p-5/);
  });

  it("badge e texto inline reutilizam tokens da variante", () => {
    assert.match(executiveAlertBadgeClass("attention"), /#FDE68A/);
    assert.match(executiveAlertBadgeClass("attention"), /#92400E/);
    assert.match(executiveAlertInlineTextClass("attention"), /#78350F/);
    assert.match(executiveAlertInlineTextClass("attention"), /text-\[10px\]/);
  });

  it("mapeia status de custo congelado para variantes executivas", () => {
    assert.equal(frozenCostTraceToExecutiveVariant("ATUALIZADO"), "success");
    assert.equal(frozenCostTraceToExecutiveVariant("PENDENTE_PUBLICACAO"), "attention");
    assert.equal(frozenCostTraceToExecutiveVariant("CUSTO_DIVERGENTE"), "attention");
    assert.equal(frozenCostTraceToExecutiveVariant("SEM_CUSTO"), "info");
  });
});

describe("ExecutiveAlert component", () => {
  it("exporta seção com role status e suporte a variantes", () => {
    const src = read("src/components/ui/ExecutiveAlert.tsx");
    assert.match(src, /role="status"/);
    assert.match(src, /ExecutiveAlertBadge/);
    assert.match(src, /ExecutiveAlertPanel/);
    assert.match(src, /executiveAlertShellClass/);
  });
});

describe("product frozen cost grid alert", () => {
  it("listagem usa paleta executiva no alerta Custo divergente", () => {
    const mod = read("src/components/ProductModule.tsx");
    assert.match(mod, /frozen-cost-divergence-alert/);
    assert.match(mod, /executiveAlertInlineTextClass\("attention"\)/);
    assert.match(mod, /frozenCostTraceBadgeClass/);
    const divergenceIdx = mod.indexOf("frozen-cost-divergence-alert");
    assert.ok(divergenceIdx >= 0);
    const frozenCostSection = mod.slice(
      mod.lastIndexOf("frozenCostSummary", divergenceIdx),
      divergenceIdx + 800
    );
    assert.doesNotMatch(frozenCostSection, /text-amber-700 dark:text-amber-400/);
  });

  it("badge de custo congelado não usa fundos escuros no dark mode", () => {
    const display = read("src/lib/productFrozenCostDisplay.ts");
    assert.match(display, /executiveAlertBadgeClass/);
    assert.doesNotMatch(display, /dark:bg-amber-950/);
    assert.doesNotMatch(display, /dark:bg-orange-950/);
  });
});
