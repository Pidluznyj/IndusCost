import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildImportPlan,
  conflictKey,
  importFingerprintSource,
  normalizeImportText,
  parseLevelCell,
  type ImportContext,
} from "./competencyImport";

const ctx = (): ImportContext => ({
  competencies: [
    { id: "c1", name: "Leitura de desenho técnico" },
    { id: "c2", name: "NR-12 Segurança em máquinas" },
  ],
  employees: [
    { id: "11111111-1111-4111-8111-111111111111", name: "Ana Ribeiro", writable: true },
    { id: "22222222-2222-4222-8222-222222222222", name: "José Silva", writable: true },
    { id: "33333333-3333-4333-8333-333333333333", name: "José Silva", writable: true },
    { id: "44444444-4444-4444-8444-444444444444", name: "Gestor", writable: false },
  ],
  levels: [
    { employeeId: "11111111-1111-4111-8111-111111111111", competencyId: "c1", level: 3, source: "MANUAL" },
    { employeeId: "11111111-1111-4111-8111-111111111111", competencyId: "c2", level: 2, source: "ASSESSMENT" },
  ],
});
const ANA = "11111111-1111-4111-8111-111111111111";
const JOSE_A = "22222222-2222-4222-8222-222222222222";
const HEADER = ["ID", "Colaborador", "Posto", "Leitura de desenho tecnico", "nr-12 segurança em máquinas", "Solda"];

describe("competencyImport — células", () => {
  it("aceita 0–4 e nomes de nível; vazio = null; resto inválido", () => {
    assert.equal(parseLevelCell(3), 3);
    assert.equal(parseLevelCell("2"), 2);
    assert.equal(parseLevelCell("4,0"), 4);
    assert.equal(parseLevelCell("proficiente"), 3);
    assert.equal(parseLevelCell("Em formação"), 1);
    assert.equal(parseLevelCell(0), 0);
    assert.equal(parseLevelCell(""), null);
    assert.equal(parseLevelCell(null), null);
    assert.equal(parseLevelCell("  "), null);
    assert.equal(parseLevelCell(5), undefined);
    assert.equal(parseLevelCell(2.5), undefined);
    assert.equal(parseLevelCell("ótimo"), undefined);
  });

  it("normaliza acentos, espaços e maiúsculas", () => {
    assert.equal(normalizeImportText("  NR-12  Segurança "), "nr-12 seguranca");
  });
});

describe("competencyImport — plano", () => {
  it("casa colunas por nome sem acento e ignora desconhecidas", () => {
    const plan = buildImportPlan([HEADER, ["", "Ana Ribeiro", "Torno", 3, "", ""]], ctx());
    assert.equal(plan.fatal, null);
    assert.deepEqual(plan.columns.map((c) => c.kind), ["ID", "EMPLOYEE", "POSITION", "COMPETENCY", "COMPETENCY", "UNKNOWN"]);
    assert.equal(plan.summary.unknownColumns, 1);
  });

  it("célula vazia não altera; igual = sem alteração; maior = alteração", () => {
    const plan = buildImportPlan([HEADER, ["", "Ana Ribeiro", "", 4, ""]], ctx());
    assert.deepEqual(plan.changes, [{ employeeId: ANA, competencyId: "c1", from: 3, to: 4, conflict: null }]);
    assert.deepEqual([plan.summary.changes, plan.summary.empty], [1, 1]);
    const same = buildImportPlan([HEADER, ["", "Ana Ribeiro", "", 3, ""]], ctx());
    assert.deepEqual([same.summary.changes, same.summary.unchanged], [0, 1]);
  });

  it("conflitos: rebaixamento e nível vindo de avaliação; padrão é manter", () => {
    const sheet = [HEADER, ["", "Ana Ribeiro", "", 1, 4]];
    const plan = buildImportPlan(sheet, ctx());
    const kinds = plan.rows[0].cells.map((c) => [c.kind, c.conflictReason]);
    assert.deepEqual(kinds, [["CONFLICT", "DOWNGRADE"], ["CONFLICT", "ASSESSED"]]);
    assert.deepEqual([plan.summary.conflicts, plan.summary.changes], [2, 0]);
    const applied = buildImportPlan(sheet, ctx(), { conflictDecisions: { [conflictKey(ANA, "c1")]: "APPLY" } });
    assert.deepEqual(applied.changes, [{ employeeId: ANA, competencyId: "c1", from: 3, to: 1, conflict: "DOWNGRADE" }]);
    assert.equal(applied.summary.conflictsToApply, 1);
  });

  it("zero explícito é rebaixamento (conflito), não célula vazia", () => {
    const plan = buildImportPlan([HEADER, ["", "Ana Ribeiro", "", 0, ""]], ctx());
    assert.equal(plan.rows[0].cells[0].kind, "CONFLICT");
  });

  it("valor inválido é ignorado e contado", () => {
    const plan = buildImportPlan([HEADER, ["", "Ana Ribeiro", "", "excelente", 3]], ctx());
    assert.equal(plan.summary.invalid, 1);
    assert.equal(plan.rows[0].cells[0].kind, "INVALID");
    // c2 veio de avaliação: 3 vira conflito (padrão manter), nunca alteração silenciosa.
    assert.deepEqual([plan.summary.conflicts, plan.changes.length], [1, 0]);
  });

  it("conciliação: ID tem precedência; homônimo é ambíguo até a escolha; não encontrado pode ser associado", () => {
    const sheet = [
      HEADER,
      [ANA, "Nome errado", "", 4, ""],
      ["", "jose silva", "", 2, ""],
      ["", "Fulano", "", 2, ""],
    ];
    const plan = buildImportPlan(sheet, ctx());
    assert.deepEqual(plan.rows.map((r) => r.status), ["MATCHED", "AMBIGUOUS", "NOT_FOUND"]);
    assert.equal(plan.rows[1].candidates.length, 2);
    assert.equal(plan.summary.pendingRows, 2);
    const resolved = buildImportPlan(sheet, ctx(), { employeeChoices: { "3": JOSE_A, "4": "44444444-4444-4444-8444-444444444444" } });
    assert.deepEqual(resolved.rows.map((r) => r.status), ["MATCHED", "MATCHED", "OUT_OF_SCOPE"]);
    assert.equal(resolved.rows[1].chosen, true);
    // escolha fora dos candidatos não vale
    const bad = buildImportPlan(sheet, ctx(), { employeeChoices: { "3": ANA } });
    assert.equal(bad.rows[1].status, "AMBIGUOUS");
  });

  it("fora do escopo de escrita e linha repetida são ignoradas", () => {
    const plan = buildImportPlan([HEADER, ["", "Gestor", "", 4, ""], ["", "Ana Ribeiro", "", 4, ""], ["", "ana ribeiro", "", 1, ""]], ctx());
    assert.deepEqual(plan.rows.map((r) => r.status), ["OUT_OF_SCOPE", "MATCHED", "DUPLICATE_ROW"]);
    assert.equal(plan.summary.ignoredRows, 2);
    assert.deepEqual(plan.changes.map((c) => c.to), [4]);
  });

  it("erros fatais: vazia, sem coluna Colaborador, sem competência", () => {
    assert.match(buildImportPlan([], ctx()).fatal ?? "", /vazia/);
    assert.match(buildImportPlan([["Nome do funcionário", "Leitura de desenho técnico"]], ctx()).fatal ?? "", /Colaborador/);
    assert.match(buildImportPlan([["Colaborador", "Solda"]], ctx()).fatal ?? "", /competência/);
  });

  it("idempotência: aplicar o plano e reprocessar o mesmo arquivo não gera alterações", () => {
    const sheet = [HEADER, ["", "Ana Ribeiro", "", 4, 4]];
    const c = ctx();
    const first = buildImportPlan(sheet, c, { conflictDecisions: { [conflictKey(ANA, "c2")]: "APPLY" } });
    const after: ImportContext = {
      ...c,
      levels: c.levels.map((l) => {
        const ch = first.changes.find((x) => x.employeeId === l.employeeId && x.competencyId === l.competencyId);
        return ch ? { ...l, level: ch.to, source: "IMPORT" } : l;
      }),
    };
    const second = buildImportPlan(sheet, after);
    assert.deepEqual([second.summary.changes, second.summary.conflicts, second.summary.unchanged], [0, 0, 2]);
  });

  it("impressão digital muda se o nível atual mudar entre prévia e aplicação", () => {
    const sheet = [HEADER, ["", "Ana Ribeiro", "", 4, ""]];
    const c = ctx();
    const a = importFingerprintSource(c, buildImportPlan(sheet, c), "sha");
    const moved: ImportContext = { ...c, levels: c.levels.map((l) => (l.competencyId === "c1" ? { ...l, level: 2 } : l)) };
    const b = importFingerprintSource(moved, buildImportPlan(sheet, moved), "sha");
    assert.notEqual(a, b);
    assert.equal(a, importFingerprintSource(c, buildImportPlan(sheet, c), "sha"));
  });
});
