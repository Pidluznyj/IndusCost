import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyBatchMatrixAction,
  buildLargeSyntheticMatrixRows,
  buildPermissionMatrixRowsFromAdminTree,
  childActionPartial,
  draftFromAdminTree,
  filterPermissionMatrixRows,
  flattenVisibleMatrixRows,
  isMatrixDraftDirty,
  isParentViewBlocked,
  legacyFlagsFromMatrixDraftValues,
  resetMatrixDraft,
  setMatrixDraftAction,
  summarizeMatrixImpact,
  type PermissionMatrixDraft,
  type PermissionMatrixRow,
} from "./index.ts";
import type { EditableTreeNodeDto } from "@/src/lib/userPermissionsAdminClient";

function flags(v: boolean, e = false, m = false) {
  return { canView: v, canExecute: e, canManage: m };
}

function node(
  partial: Partial<EditableTreeNodeDto> & Pick<EditableTreeNodeDto, "key" | "label">
): EditableTreeNodeDto {
  return {
    description: "",
    type: "MENU",
    module: "finance",
    parentKey: null,
    roleFlags: flags(true),
    override: null,
    effectiveFlags: flags(true),
    children: [],
    ...partial,
  };
}

describe("permissionMatrixUi build", () => {
  it("marca ações não suportadas e preserva create só quando no contrato", () => {
    const tree = [
      node({
        key: "dashboard",
        label: "Dashboard",
        module: "dashboard",
        effectiveFlags: flags(true),
        roleFlags: flags(true),
      }),
    ];
    const rows = buildPermissionMatrixRowsFromAdminTree(tree);
    assert.equal(rows.length, 1);
    // create tipicamente unsupported no fallback 3-eixos se contrato não amarrar
    const createCell = rows[0].cells.create;
    assert.ok(createCell);
    if (!rows[0].supportedActions.includes("create")) {
      assert.equal(createCell.supported, false);
    }
    assert.ok(rows[0].cells.view.supported);
  });

  it("legacyFlagsFromMatrixDraftValues agrega eixos", () => {
    const f = legacyFlagsFromMatrixDraftValues({
      view: true,
      create: true,
      manage: false,
    });
    assert.equal(f.canView, true);
    assert.equal(f.canExecute, true);
    assert.equal(f.canManage, false);
  });
});

describe("permissionMatrixUi state", () => {
  const rows: PermissionMatrixRow[] = [
    {
      resourceKey: "parent",
      label: "Parent",
      description: "",
      type: "MENU",
      groupId: "g1",
      parentKey: null,
      depth: 0,
      supportedActions: ["view", "execute", "manage"],
      cells: {
        view: {
          action: "view",
          supported: true,
          allowed: true,
          source: "inherited",
          originLabel: "h",
        },
        create: {
          action: "create",
          supported: false,
          allowed: false,
          source: "unsupported",
          originLabel: "n/a",
        },
      },
      values: { view: true, execute: false, manage: false },
      inherited: { view: true, execute: false, manage: false },
      children: [
        {
          resourceKey: "child",
          label: "Child",
          description: "filho",
          type: "TAB",
          groupId: "g1",
          parentKey: "parent",
          depth: 1,
          supportedActions: ["view", "execute"],
          cells: {
            view: {
              action: "view",
              supported: true,
              allowed: true,
              source: "inherited",
              originLabel: "h",
            },
            create: {
              action: "create",
              supported: false,
              allowed: false,
              source: "unsupported",
              originLabel: "n/a",
            },
          },
          values: { view: true, execute: true },
          inherited: { view: true, execute: false },
          children: [],
        },
      ],
    },
  ];

  it("detecta parent bloqueado e mantém values do filho", () => {
    let draft: PermissionMatrixDraft = {
      parent: { view: false, execute: false, manage: false },
      child: { view: true, execute: true },
    };
    assert.equal(isParentViewBlocked(rows, "child", draft), true);
    draft = setMatrixDraftAction(draft, "child", "execute", false);
    assert.equal(draft.child.execute, false);
    assert.equal(draft.child.view, true);
  });

  it("seleção parcial nos filhos", () => {
    const draft: PermissionMatrixDraft = {
      parent: { view: true },
      child: { view: true },
    };
    // only one child — add second via mutation of structure: use synthetic
    const big = buildLargeSyntheticMatrixRows(1, 2);
    const d: PermissionMatrixDraft = {
      "mod.0": { view: true },
      "mod.0.item.0": { view: true },
      "mod.0.item.1": { view: false },
    };
    assert.equal(childActionPartial(big[0], "view", d), true);
  });

  it("allow / deny / inherited dirty + reset", () => {
    const baseline = draftFromAdminTree([
      node({
        key: "parent",
        label: "Parent",
        children: [
          node({
            key: "child",
            label: "Child",
            parentKey: "parent",
            type: "TAB",
            roleFlags: flags(true, true),
            effectiveFlags: flags(true, true),
          }),
        ],
      }),
    ]);
    let draft = resetMatrixDraft(baseline);
    assert.equal(isMatrixDraftDirty(draft, baseline), false);
    draft = setMatrixDraftAction(draft, "child", "view", false);
    assert.equal(isMatrixDraftDirty(draft, baseline), true);
    draft = resetMatrixDraft(baseline);
    assert.equal(isMatrixDraftDirty(draft, baseline), false);
  });

  it("batch allow/deny", () => {
    const draft = applyBatchMatrixAction(
      {
        parent: { view: false },
        child: { view: false },
      },
      rows,
      new Set(["parent", "child"]),
      "view",
      true
    );
    assert.equal(draft.parent.view, true);
    assert.equal(draft.child.view, true);
  });

  it("busca e filtro por grupo", () => {
    const large = buildLargeSyntheticMatrixRows(6, 4);
    const bySearch = filterPermissionMatrixRows(large, {
      search: "Item 2.1",
      groupId: "ALL",
    });
    assert.ok(bySearch.some((r) => r.resourceKey === "mod.2"));
    const byGroup = filterPermissionMatrixRows(large, {
      search: "",
      groupId: "group-1",
    });
    assert.ok(byGroup.every((r) => r.groupId === "group-1"));
  });

  it("flatten respeita expand/collapse (árvore grande)", () => {
    const large = buildLargeSyntheticMatrixRows(20, 25); // 520 nodes
    const collapsed = flattenVisibleMatrixRows(large, new Set());
    assert.equal(collapsed.length, 20);
    const oneOpen = flattenVisibleMatrixRows(large, new Set(["mod.0"]));
    assert.equal(oneOpen.length, 20 + 25);
    const impact = summarizeMatrixImpact(
      large,
      { "mod.0": { view: false } },
      { "mod.0": { view: true } }
    );
    assert.ok(impact.dirtyResourceCount >= 1);
  });
});
