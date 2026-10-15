import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { UNCATEGORIZED_MATRIX_GROUP, groupMatrixCompetencies } from "./competencyMatrixGroups.ts";

const item = (id: string, category: string) => ({ id, category });

describe("groupMatrixCompetencies", () => {
  it("segue a ordem do catálogo e junta o que não tem categoria oficial", () => {
    const groups = groupMatrixCompetencies([
      item("q1", "QUALITY"),
      item("fora", "MONTAGEM"),
      item("t1", "TECHNICAL"),
      item("q2", "QUALITY"),
      item("outro", ""),
      item("t2", "TECHNICAL"),
    ]);
    assert.deepEqual(
      groups.map((group) => ({ key: group.key, label: group.label, ids: group.competencies.map((competency) => competency.id) })),
      [
        { key: "QUALITY", label: "Qualidade", ids: ["q1", "q2"] },
        { key: UNCATEGORIZED_MATRIX_GROUP, label: "Sem categoria", ids: ["fora", "outro"] },
        { key: "TECHNICAL", label: "Técnica", ids: ["t1", "t2"] },
      ],
    );
  });

  it("não emite grupo vazio", () => {
    assert.deepEqual(groupMatrixCompetencies([]), []);
  });
});
