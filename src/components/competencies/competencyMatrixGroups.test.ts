import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  UNCATEGORIZED_MATRIX_GROUP,
  groupMatrixColumns,
  type MatrixAssociation,
} from "./competencyMatrixGroups.ts";

const competency = (id: string, category: string) => ({ id, category });

const catalog = [
  competency("aud", "Auditoria Interna"),
  competency("info", "Informática"),
  competency("mon", "Montagem"),
  competency("inj", "Injeção"),
  competency("qua", "Qualidade"),
  competency("blank", "  "),
  competency("neg", "Negociação"),
  competency("e1", "Engenharia"),
  competency("e2", "Engenharia"),
  competency("e3", "Processo"),
  competency("e4", "Processo"),
  competency("e5", "Metrologia"),
  competency("e6", "Metrologia"),
  competency("oficial", "QUALITY"),
  competency("solta", "Expedição"),
  competency("vazia", ""),
];

function link(
  departmentId: string,
  departmentName: string,
  competencyId: string,
  shifts?: readonly string[],
): MatrixAssociation {
  return {
    departmentId,
    departmentName,
    competencyId,
    appliesToAllShifts: shifts == null,
    shifts: shifts ?? [],
  };
}

/** Comercial 4, Compras 4, Engenharia 6. Fabricação e Ferramentaria não têm vínculo. */
const associations: MatrixAssociation[] = [
  link("comercial", "Comercial", "inj"),
  link("comercial", "Comercial", "aud"),
  link("comercial", "Comercial", "mon"),
  link("comercial", "Comercial", "info", ["1"]),
  link("compras", "Compras", "aud"),
  link("compras", "Compras", "qua", ["3"]),
  link("compras", "Compras", "blank"),
  link("compras", "Compras", "neg"),
  link("engenharia", "Engenharia de produtos", "e1"),
  link("engenharia", "Engenharia de produtos", "e2"),
  link("engenharia", "Engenharia de produtos", "e3"),
  link("engenharia", "Engenharia de produtos", "e4"),
  link("engenharia", "Engenharia de produtos", "e5"),
  link("engenharia", "Engenharia de produtos", "e6"),
];

const ids = (key: string, groups = groupMatrixColumns(catalog, { mode: "department", associations })) =>
  groups.find((group) => group.key === key)?.columns.map((column) => column.competency.id) ?? null;

describe("groupMatrixColumns por departamento", () => {
  it("abre uma sanfona por departamento com vínculo e omite os vazios", () => {
    const groups = groupMatrixColumns(catalog, { mode: "department", associations });
    assert.deepEqual(
      groups.map((group) => group.label),
      ["Comercial", "Compras", "Engenharia de produtos", "Sem departamento"],
    );
    assert.equal(groups.some((group) => group.label === "Fabricação" || group.label === "Ferramentaria"), false);
    assert.deepEqual(ids("department:comercial", groups), ["aud", "info", "mon", "inj"]);
    assert.deepEqual(ids("department:compras", groups), ["aud", "qua", "blank", "neg"]);
    assert.equal(ids("department:engenharia", groups)?.length, 6);
  });

  it("repete a competência compartilhada com o mesmo objeto e chaves de coluna diferentes", () => {
    const groups = groupMatrixColumns(catalog, { mode: "department", associations });
    const comercial = groups[0]?.columns.find((column) => column.competency.id === "aud");
    const compras = groups[1]?.columns.find((column) => column.competency.id === "aud");
    assert.ok(comercial && compras);
    assert.equal(comercial.competency, compras.competency);
    assert.equal(comercial.competency.id, compras.competency.id);
    assert.notEqual(comercial.columnKey, compras.columnKey);
    const keys = groups.flatMap((group) => group.columns.map((column) => column.columnKey));
    assert.equal(new Set(keys).size, keys.length);
  });

  it("mantém competência sem departamento quando o filtro é Todos", () => {
    const groups = groupMatrixColumns(catalog, { mode: "department", associations, departmentId: "", shifts: [] });
    const loose = groups.find((group) => group.label === "Sem departamento");
    assert.deepEqual(loose?.columns.map((column) => column.competency.id), ["oficial", "solta", "vazia"]);
  });

  it("no departamento Compras mostra só as competências aplicáveis a ele", () => {
    const groups = groupMatrixColumns(catalog, { mode: "department", associations, departmentId: "compras" });
    assert.deepEqual(groups.map((group) => group.label), ["Compras"]);
    assert.deepEqual(ids("department:compras", groups), ["aud", "qua", "blank", "neg"]);
    assert.equal(groups.some((group) => group.columns.some((column) => column.competency.id === "solta")), false);
    assert.equal(groups.some((group) => group.columns.some((column) => column.competency.id === "info")), false);
  });

  it("departamento sem competência não gera sanfona", () => {
    assert.deepEqual(
      groupMatrixColumns(catalog, { mode: "department", associations, departmentId: "fabricacao" }),
      [],
    );
  });

  it("respeita turno específico e associação a todos os turnos", () => {
    const turno3 = groupMatrixColumns(catalog, { mode: "department", associations, shifts: ["3"] });
    assert.deepEqual(ids("department:comercial", turno3), ["aud", "mon", "inj"]);
    assert.equal(ids("department:comercial", turno3)?.includes("info"), false);
    assert.deepEqual(ids("department:compras", turno3), ["aud", "qua", "blank", "neg"]);
    assert.ok(ids("department:unassigned", turno3)?.includes("info"));
    const todos = groupMatrixColumns(catalog, { mode: "department", associations, shifts: [] });
    assert.ok(ids("department:comercial", todos)?.includes("info"));
  });

  it("não perde competência que a matriz ainda enviou ao filtrar o turno", () => {
    const groups = groupMatrixColumns(catalog, { mode: "department", associations, shifts: ["1"] });
    const shown = new Set(groups.flatMap((group) => group.columns.map((column) => column.competency.id)));
    for (const item of catalog) assert.equal(shown.has(item.id), true, item.id);
  });
});

describe("groupMatrixColumns por categoria", () => {
  it("preserva o texto gravado e reserva Sem categoria ao valor vazio", () => {
    const groups = groupMatrixColumns(catalog, { mode: "category", associations });
    assert.deepEqual(
      groups.map((group) => ({ key: group.key, label: group.label })),
      [
        { key: "category:Auditoria Interna", label: "Auditoria Interna" },
        { key: "category:Informática", label: "Informática" },
        { key: "category:Montagem", label: "Montagem" },
        { key: "category:Injeção", label: "Injeção" },
        { key: "category:Qualidade", label: "Qualidade" },
        { key: `category:${UNCATEGORIZED_MATRIX_GROUP}`, label: "Sem categoria" },
        { key: "category:Negociação", label: "Negociação" },
        { key: "category:Engenharia", label: "Engenharia" },
        { key: "category:Processo", label: "Processo" },
        { key: "category:Metrologia", label: "Metrologia" },
        { key: "category:QUALITY", label: "Qualidade" },
        { key: "category:Expedição", label: "Expedição" },
      ],
    );
    const uncategorized = groups.find((group) => group.label === "Sem categoria");
    assert.deepEqual(uncategorized?.columns.map((column) => column.competency.id), ["blank", "vazia"]);
    assert.equal(groups.filter((group) => group.label === "Qualidade").length, 2);
  });

  it("no departamento escolhido só agrupa as competências aplicáveis", () => {
    const groups = groupMatrixColumns(catalog, {
      mode: "category",
      associations,
      departmentId: "compras",
      shifts: ["3"],
    });
    assert.deepEqual(groups.map((group) => group.label), ["Auditoria Interna", "Qualidade", "Sem categoria", "Negociação"]);
    assert.equal(groups.some((group) => group.label === "Informática"), false);
  });

  it("não emite grupo vazio", () => {
    assert.deepEqual(groupMatrixColumns([], { mode: "department", associations }), []);
    assert.deepEqual(groupMatrixColumns([], { mode: "category" }), []);
  });
});
