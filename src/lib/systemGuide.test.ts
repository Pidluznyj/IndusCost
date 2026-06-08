import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  SYSTEM_GUIDE_SECTIONS,
  SYSTEM_WIKI_GLOSSARY,
  SYSTEM_WIKI_MODULE_CARDS,
} from "@/src/lib/systemGuide";

function entryBlob(entry: {
  title: string;
  objective: string;
  features: string[];
  businessRules?: string[];
  notes?: string[];
  tags?: string[];
}) {
  return [
    entry.title,
    entry.objective,
    ...(entry.features ?? []),
    ...(entry.businessRules ?? []),
    ...(entry.notes ?? []),
    ...(entry.tags ?? []),
  ]
    .join(" ")
    .toLowerCase();
}

describe("systemGuide wiki", () => {
  it("has required module sections", () => {
    const anchors = SYSTEM_GUIDE_SECTIONS.map((s) => s.anchor);
    for (const required of [
      "dashboard",
      "engenharia",
      "gestao-frota",
      "financeiro",
      "integracao-nomus",
      "glossario",
    ]) {
      assert.ok(anchors.includes(required), `missing section ${required}`);
    }
  });

  it("fleet section documents checklist and public reservation", () => {
    const fleet = SYSTEM_GUIDE_SECTIONS.find((s) => s.anchor === "gestao-frota");
    const publicRes = SYSTEM_GUIDE_SECTIONS.find((s) => s.anchor === "frota-reserva-publica");
    const checklist = SYSTEM_GUIDE_SECTIONS.find((s) => s.anchor === "frota-checklist-qr");
    assert.ok(fleet && fleet.entries.length > 0);
    assert.ok(publicRes && publicRes.entries.length > 0);
    assert.ok(checklist && checklist.entries.length > 0);
  });

  it("engineering section covers CIU analysis", () => {
    const eng = SYSTEM_GUIDE_SECTIONS.find((s) => s.anchor === "engenharia");
    const blob = eng?.entries.map((e) => entryBlob(e)).join(" ") ?? "";
    assert.ok(blob.includes("ciu"));
    assert.ok(blob.includes("duplicação") || blob.includes("duplicidade"));
  });

  it("glossary includes BOM and CIU", () => {
    const terms = SYSTEM_WIKI_GLOSSARY.map((t) => t.term);
    assert.ok(terms.includes("BOM"));
    assert.ok(terms.includes("CIU"));
    assert.ok(terms.length >= 20);
  });

  it("module cards link to real section anchors", () => {
    const anchors = new Set(SYSTEM_GUIDE_SECTIONS.map((s) => s.anchor));
    for (const card of SYSTEM_WIKI_MODULE_CARDS) {
      assert.ok(anchors.has(card.sectionAnchor), `card ${card.id} -> ${card.sectionAnchor}`);
    }
  });

  it("SystemGuideModule renders wiki UI elements", () => {
    const ui = readFileSync(
      join(process.cwd(), "src", "components", "SystemGuideModule.tsx"),
      "utf8"
    );
    assert.ok(ui.includes("Manual do Sistema IndusCost"));
    assert.ok(ui.includes("Nenhum conteúdo encontrado para sua busca"));
    assert.ok(ui.includes("Glossário"));
    assert.ok(ui.includes("SYSTEM_WIKI_MODULE_CARDS"));
  });

  it("systemGuideContent re-exports from systemGuide package", () => {
    const barrel = readFileSync(
      join(process.cwd(), "src", "lib", "systemGuideContent.ts"),
      "utf8"
    );
    assert.ok(barrel.includes('from "@/src/lib/systemGuide"'));
  });
});
