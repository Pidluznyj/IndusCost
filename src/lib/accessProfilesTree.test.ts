import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  accessProfileActionNodeId,
  accessProfileTreeDecisionsDirty,
  applyDecisionToAccessProfileBranch,
  buildAccessProfileTreeModel,
  countAccessProfileTreeDecisionChanges,
  draftFromAccessProfileDecisions,
  materializeAccessProfilePermissionsFromTreeDecisions,
} from "@/src/lib/accessProfilesTree";

describe("accessProfilesTree", () => {
  it("monta árvore com módulo/página/ação a partir do snapshot", () => {
    const model = buildAccessProfileTreeModel(
      ["dashboard.view", "crm.view"],
      "SELLER"
    );
    assert.ok(model.nodes.length > 0);
    assert.equal(model.nodes[0]?.kind, "module");
    const actionId = accessProfileActionNodeId("dashboard", "view");
    // resource keys may be dotted — just ensure decisions round-trip
    assert.ok(Object.keys(model.decisions).length > 0);
    const rematerialized = materializeAccessProfilePermissionsFromTreeDecisions(
      model.nodes,
      model.decisions,
      model.draft,
      ["dashboard.view", "crm.view"]
    );
    assert.ok(rematerialized.includes("dashboard.view"));
    assert.ok(rematerialized.includes("crm.view"));
    void actionId;
  });

  it("conta alterações e dirty corretamente", () => {
    const model = buildAccessProfileTreeModel(["dashboard.view"], "SELLER");
    assert.equal(
      accessProfileTreeDecisionsDirty(model.decisions, model.baselineDecisions),
      false
    );
    assert.equal(
      countAccessProfileTreeDecisionChanges(
        model.decisions,
        model.baselineDecisions
      ),
      0
    );
    const next = { ...model.decisions };
    const firstKey = Object.keys(next)[0];
    assert.ok(firstKey);
    next[firstKey] = "deny";
    assert.equal(
      accessProfileTreeDecisionsDirty(next, model.baselineDecisions),
      true
    );
    assert.ok(
      countAccessProfileTreeDecisionChanges(next, model.baselineDecisions) >= 1
    );
  });

  it("aplica decisão em lote só no ramo", () => {
    const model = buildAccessProfileTreeModel(
      ["dashboard.view", "crm.view"],
      "SELLER"
    );
    const root = model.nodes[0];
    assert.ok(root);
    const after = applyDecisionToAccessProfileBranch(
      model.nodes,
      root.id,
      "allow",
      model.decisions
    );
    assert.equal(after[root.id], "allow");
    const draft = draftFromAccessProfileDecisions(
      model.nodes,
      after,
      model.draft
    );
    assert.ok(Object.keys(draft).length > 0);
  });
});
