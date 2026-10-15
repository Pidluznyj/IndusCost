import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CompetencyMatrixResponse } from "@/src/lib/competencies/competencyTypes";
import { CompetencyMatrixFullscreen } from "./CompetencyMatrixFullscreen.tsx";
import { CompetencyMatrixGrid } from "./CompetencyMatrixGrid.tsx";
import { CompetencyMatrixTab } from "./CompetencyMatrixTab.tsx";
import { UNCATEGORIZED_MATRIX_GROUP } from "./competencyMatrixGroups.ts";

function cell(competencyId: string, level: 0 | 1 | 2 | 3 | 4) {
  return {
    competencyId,
    level,
    storedLevel: level,
    requiredLevel: null,
    belowMinimum: false,
    recycling: "VALID" as const,
    recyclingExpiresOn: null,
    version: 1,
    pending: null,
  };
}

function matrix(): CompetencyMatrixResponse {
  const competencies = [
    { id: "solda", name: "Solda de gabinete", category: "TECHNICAL", requiresRecycling: false, critical: false },
    { id: "nr", name: "NR-12", category: "SAFETY", requiresRecycling: false, critical: true },
    { id: "legado", name: "Ajuste antigo", category: "PLANILHA", requiresRecycling: false },
  ];
  return {
    asOf: "2026-10-15",
    competencies,
    rows: [
      {
        employeeId: "ana",
        employeeName: "Ana",
        positionId: null,
        positionName: null,
        writable: true,
        departmentId: "montagem",
        departmentName: "Montagem",
        linkedCompetencyIds: ["solda"],
        cells: [cell("solda", 2), cell("nr", 4), cell("legado", 1)],
      },
      {
        employeeId: "bia",
        employeeName: "Bia",
        positionId: null,
        positionName: null,
        writable: false,
        departmentId: "qualidade",
        departmentName: "Qualidade",
        linkedCompetencyIds: [],
        cells: [cell("solda", 3), cell("nr", 4), cell("legado", 0)],
      },
    ],
  };
}

const ready = { status: "ready" as const, data: matrix() };

describe("CompetencyMatrixGrid", () => {
  it("começa com categorias recolhidas, sem nível agregado e sem as colunas de competência", () => {
    const html = renderToStaticMarkup(
      <CompetencyMatrixGrid matrix={ready} canEdit expandedKeys={new Set()} onToggleGroup={() => undefined} onOpenCell={() => undefined} onRetry={() => undefined} />,
    );
    assert.match(html, /aria-expanded="false"/);
    assert.match(html, /competency-matrix-group-TECHNICAL/);
    assert.match(html, /Técnica \(1\)/);
    assert.match(html, /competency-matrix-group-collapsed/);
    assert.equal(html.includes("Solda de gabinete"), false);
    assert.equal(html.includes("competency-matrix-cell"), false);
    assert.equal(html.includes(">4<"), false);
  });

  it("expande só a categoria pedida e mantém a outra recolhida", () => {
    const html = renderToStaticMarkup(
      <CompetencyMatrixGrid
        matrix={ready}
        canEdit
        expandedKeys={new Set(["TECHNICAL", UNCATEGORIZED_MATRIX_GROUP])}
        onToggleGroup={() => undefined}
        onOpenCell={() => undefined}
        onRetry={() => undefined}
      />,
    );
    assert.match(html, /Solda de gabinete/);
    assert.match(html, /Ajuste antigo/);
    assert.equal(html.includes("NR-12"), false);
    assert.match(html, /competency-matrix-cell/);
    assert.match(html, /sticky left-0/);
    assert.match(html, /top-9/);
  });
});

describe("CompetencyMatrixFullscreen", () => {
  it("isola a grade num dialog de tela cheia, com filtros e sanfona", () => {
    const html = renderToStaticMarkup(
      <CompetencyMatrixFullscreen
        open
        onClose={() => undefined}
        matrix={ready}
        canEdit={false}
        expandedKeys={new Set()}
        onToggleGroup={() => undefined}
        onExpandAll={() => undefined}
        onCollapseAll={() => undefined}
        onOpenCell={() => undefined}
        onRetry={() => undefined}
        departmentId="montagem"
        departments={[{ id: "montagem", name: "Montagem" }]}
        shifts={["2"]}
        onDepartmentChange={() => undefined}
        onToggleShift={() => undefined}
        anchor={null}
      />,
    );
    assert.match(html, /role="dialog"/);
    assert.match(html, /aria-modal="true"/);
    assert.match(html, /Matriz de Competências/);
    assert.match(html, /Montagem/);
    assert.match(html, /Turno 2/);
    assert.match(html, /h-dvh/);
    assert.match(html, /min-h-0 min-w-0 flex-1 overflow-auto/);
    assert.match(html, /competency-matrix-expand-all/);
    assert.match(html, /competency-matrix-collapse-all/);
    assert.match(html, /competency-matrix-filter-department/);
    const scrollAt = html.indexOf("competency-matrix-scroll");
    const headerAt = html.indexOf("competency-matrix-fullscreen-title");
    assert.ok(headerAt >= 0 && scrollAt > headerAt);
  });
});

describe("CompetencyMatrixTab", () => {
  it("não desenha a grade na aba; a grade fica na modal", () => {
    const html = renderToStaticMarkup(
      <CompetencyMatrixTab
        matrix={ready}
        canEdit
        onSetLevel={async () => undefined}
        onRetry={() => undefined}
        departmentId=""
        departments={[]}
        shifts={[]}
        onDepartmentChange={() => undefined}
        onToggleShift={() => undefined}
        expandedKeys={[]}
        onExpandedKeysChange={() => undefined}
      />,
    );
    assert.match(html, /Abrir matriz em tela cheia/);
    assert.match(html, /2 colaboradores · 3 competências · 3 categorias/);
    assert.equal(html.includes("competency-matrix-grid"), false);
    assert.equal(html.includes("competency-matrix-scroll"), false);
  });
});
