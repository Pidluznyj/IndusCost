/**
 * Estado puro da matriz: expand, busca, filtro, seleção, parcial, dirty, impacto.
 */

import { permissionMatrixActionLabel } from "./actions.ts";
import type {
  PermissionMatrixActionId,
  PermissionMatrixDraft,
  PermissionMatrixFilterState,
  PermissionMatrixImpactSummary,
  PermissionMatrixRow,
} from "./types.ts";

export function collectMatrixKeys(rows: readonly PermissionMatrixRow[]): string[] {
  const keys: string[] = [];
  const walk = (list: readonly PermissionMatrixRow[]) => {
    for (const r of list) {
      keys.push(r.resourceKey);
      walk(r.children);
    }
  };
  walk(rows);
  return keys;
}

export function collectGroupIds(rows: readonly PermissionMatrixRow[]): string[] {
  const set = new Set<string>();
  const walk = (list: readonly PermissionMatrixRow[]) => {
    for (const r of list) {
      set.add(r.groupId);
      walk(r.children);
    }
  };
  walk(rows);
  return [...set].sort();
}

export function filterPermissionMatrixRows(
  rows: readonly PermissionMatrixRow[],
  filter: PermissionMatrixFilterState
): PermissionMatrixRow[] {
  const q = filter.search.trim().toLowerCase();

  const apply = (list: readonly PermissionMatrixRow[]): PermissionMatrixRow[] => {
    const out: PermissionMatrixRow[] = [];
    for (const r of list) {
      const children = apply(r.children);
      const groupOk = filter.groupId === "ALL" || r.groupId === filter.groupId;
      if (!groupOk) {
        if (children.length > 0) out.push({ ...r, children });
        continue;
      }
      if (!q) {
        out.push({ ...r, children: r.children });
        continue;
      }
      const selfMatch =
        r.label.toLowerCase().includes(q) ||
        r.resourceKey.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q);
      if (selfMatch || children.length > 0) {
        out.push({ ...r, children: selfMatch ? r.children : children });
      }
    }
    return out;
  };

  return apply(rows);
}

export function flattenVisibleMatrixRows(
  rows: readonly PermissionMatrixRow[],
  expanded: ReadonlySet<string>
): PermissionMatrixRow[] {
  const out: PermissionMatrixRow[] = [];
  const walk = (list: readonly PermissionMatrixRow[]) => {
    for (const r of list) {
      out.push(r);
      if (r.children.length > 0 && expanded.has(r.resourceKey)) {
        walk(r.children);
      }
    }
  };
  walk(rows);
  return out;
}

export function expandAllKeys(rows: readonly PermissionMatrixRow[]): Set<string> {
  return new Set(
    collectMatrixKeys(rows).filter((key) => {
      // só pais: keys that appear as parentKey
      return true;
    })
  );
}

export function expandParentKeys(rows: readonly PermissionMatrixRow[]): Set<string> {
  const parents = new Set<string>();
  const walk = (list: readonly PermissionMatrixRow[]) => {
    for (const r of list) {
      if (r.children.length > 0) parents.add(r.resourceKey);
      walk(r.children);
    }
  };
  walk(rows);
  return parents;
}

export function toggleExpandedKey(
  expanded: ReadonlySet<string>,
  key: string
): Set<string> {
  const next = new Set(expanded);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

export function toggleSelectedKey(
  selected: ReadonlySet<string>,
  key: string
): Set<string> {
  const next = new Set(selected);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

export function findMatrixRow(
  rows: readonly PermissionMatrixRow[],
  resourceKey: string
): PermissionMatrixRow | null {
  for (const r of rows) {
    if (r.resourceKey === resourceKey) return r;
    const hit = findMatrixRow(r.children, resourceKey);
    if (hit) return hit;
  }
  return null;
}

/** Ancestrais com Ver negado → parent bloqueado (filhos mantêm valores). */
export function isParentViewBlocked(
  rows: readonly PermissionMatrixRow[],
  resourceKey: string,
  draft: PermissionMatrixDraft
): boolean {
  const row = findMatrixRow(rows, resourceKey);
  if (!row || !row.parentKey) return false;
  let parentKey: string | null = row.parentKey;
  while (parentKey) {
    const parent = findMatrixRow(rows, parentKey);
    if (!parent) break;
    const view =
      draft[parent.resourceKey]?.view ??
      parent.values.view ??
      false;
    if (!view) return true;
    parentKey = parent.parentKey;
  }
  return false;
}

export function childActionPartial(
  row: PermissionMatrixRow,
  action: PermissionMatrixActionId,
  draft: PermissionMatrixDraft
): boolean | null {
  if (row.children.length === 0) return null;
  let sawTrue = false;
  let sawFalse = false;
  const walk = (list: readonly PermissionMatrixRow[]) => {
    for (const c of list) {
      if (c.cells[action]?.supported !== false && c.supportedActions.includes(action)) {
        const v = draft[c.resourceKey]?.[action] ?? c.values[action] ?? false;
        if (v) sawTrue = true;
        else sawFalse = true;
      }
      walk(c.children);
    }
  };
  walk(row.children);
  if (sawTrue && sawFalse) return true;
  return null;
}

/**
 * Atualiza uma ação sem apagar config dos filhos.
 * View desligada no nó não zera values dos filhos.
 */
export function setMatrixDraftAction(
  draft: PermissionMatrixDraft,
  resourceKey: string,
  action: PermissionMatrixActionId,
  allowed: boolean,
  options?: { cascadeChildren?: boolean; rows?: readonly PermissionMatrixRow[] }
): PermissionMatrixDraft {
  const next: PermissionMatrixDraft = {
    ...draft,
    [resourceKey]: { ...(draft[resourceKey] ?? {}), [action]: allowed },
  };
  if (action === "view" && allowed) {
    // noop
  }
  if (options?.cascadeChildren && options.rows) {
    const row = findMatrixRow(options.rows, resourceKey);
    if (row) {
      const walk = (list: readonly PermissionMatrixRow[]) => {
        for (const c of list) {
          if (c.supportedActions.includes(action)) {
            next[c.resourceKey] = {
              ...(next[c.resourceKey] ?? {}),
              [action]: allowed,
            };
          }
          walk(c.children);
        }
      };
      walk(row.children);
    }
  }
  return next;
}

export function applyBatchMatrixAction(
  draft: PermissionMatrixDraft,
  rows: readonly PermissionMatrixRow[],
  selectedKeys: ReadonlySet<string>,
  action: PermissionMatrixActionId,
  allowed: boolean
): PermissionMatrixDraft {
  let next = draft;
  for (const key of selectedKeys) {
    const row = findMatrixRow(rows, key);
    if (!row) continue;
    if (!row.supportedActions.includes(action)) continue;
    if (isParentViewBlocked(rows, key, next) && action !== "view") {
      // ainda permite editar (manter config), mas batch respect: skip execute-like
      // Spec: manter configuração dos filhos; batch can still set values.
    }
    next = setMatrixDraftAction(next, key, action, allowed);
  }
  return next;
}

export function resetMatrixDraft(
  baseline: PermissionMatrixDraft
): PermissionMatrixDraft {
  const out: PermissionMatrixDraft = {};
  for (const [k, v] of Object.entries(baseline)) {
    out[k] = { ...v };
  }
  return out;
}

export function isMatrixDraftDirty(
  draft: PermissionMatrixDraft,
  baseline: PermissionMatrixDraft
): boolean {
  const keys = new Set([...Object.keys(draft), ...Object.keys(baseline)]);
  for (const key of keys) {
    const a = draft[key] ?? {};
    const b = baseline[key] ?? {};
    const actions = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const action of actions) {
      if (Boolean(a[action]) !== Boolean(b[action])) return true;
    }
  }
  return false;
}

export function summarizeMatrixImpact(
  rows: readonly PermissionMatrixRow[],
  draft: PermissionMatrixDraft,
  baseline: PermissionMatrixDraft
): PermissionMatrixImpactSummary {
  let dirtyResourceCount = 0;
  let grantedCount = 0;
  let deniedCount = 0;
  let unchangedCount = 0;
  let parentBlockedCount = 0;
  let unsupportedCellCount = 0;
  const changedLabels: string[] = [];

  const walk = (list: readonly PermissionMatrixRow[]) => {
    for (const r of list) {
      if (isParentViewBlocked(rows, r.resourceKey, draft)) {
        parentBlockedCount += 1;
      }
      for (const action of Object.keys(r.cells)) {
        if (!r.cells[action]?.supported) unsupportedCellCount += 1;
      }
      const d = draft[r.resourceKey] ?? r.values;
      const b = baseline[r.resourceKey] ?? r.inherited;
      let dirty = false;
      for (const action of r.supportedActions) {
        const dv = Boolean(d[action]);
        const bv = Boolean(b[action]);
        if (dv !== bv) {
          dirty = true;
          if (dv) grantedCount += 1;
          else deniedCount += 1;
        } else {
          unchangedCount += 1;
        }
      }
      if (dirty) {
        dirtyResourceCount += 1;
        if (changedLabels.length < 12) changedLabels.push(r.label);
      }
      walk(r.children);
    }
  };
  walk(rows);

  return {
    dirtyResourceCount,
    grantedCount,
    deniedCount,
    unchangedCount,
    parentBlockedCount,
    unsupportedCellCount,
    changedLabels,
  };
}

export function formatImpactSummaryHuman(
  summary: PermissionMatrixImpactSummary
): string {
  if (summary.dirtyResourceCount === 0) {
    return "Sem alterações pendentes.";
  }
  const sample = summary.changedLabels.length
    ? ` Ex.: ${summary.changedLabels.slice(0, 3).join(", ")}`
    : "";
  return `${summary.dirtyResourceCount} recurso(s) alterado(s); +${summary.grantedCount} concessão(ões), −${summary.deniedCount} negação(ões).${sample}`;
}

export function permissionMatrixCellAriaLabel(args: {
  resourceLabel: string;
  action: PermissionMatrixActionId;
  supported: boolean;
  allowed: boolean;
  source: string;
}): string {
  if (!args.supported) {
    return `${args.resourceLabel}: ${permissionMatrixActionLabel(args.action)} não aplicável`;
  }
  const state = args.allowed ? "permitido" : "negado";
  return `${args.resourceLabel}: ${permissionMatrixActionLabel(args.action)} ${state} (${args.source})`;
}

/** Gera árvore sintética grande para testes de performance. */
export function buildLargeSyntheticMatrixRows(
  moduleCount: number,
  childrenPerModule: number
): PermissionMatrixRow[] {
  const rows: PermissionMatrixRow[] = [];
  for (let m = 0; m < moduleCount; m++) {
    const moduleKey = `mod.${m}`;
    const children: PermissionMatrixRow[] = [];
    for (let c = 0; c < childrenPerModule; c++) {
      const key = `${moduleKey}.item.${c}`;
      const supported = ["view", "execute", "manage"] as const;
      const cells: PermissionMatrixRow["cells"] = {};
      const values: Record<string, boolean> = {};
      const inherited: Record<string, boolean> = {};
      for (const a of ["view", "create", "update", "delete", "export", "execute", "manage"] as const) {
        const ok = (supported as readonly string[]).includes(a);
        values[a] = ok && a === "view";
        inherited[a] = values[a];
        cells[a] = {
          action: a,
          supported: ok,
          allowed: values[a],
          source: ok ? "inherited" : "unsupported",
          originLabel: ok ? "Herdado" : "n/a",
        };
      }
      children.push({
        resourceKey: key,
        label: `Item ${m}.${c}`,
        description: `desc ${key}`,
        type: "TAB",
        groupId: `group-${m % 3}`,
        parentKey: moduleKey,
        depth: 1,
        supportedActions: [...supported],
        cells,
        values,
        inherited,
        children: [],
      });
    }
    const supported = ["view", "execute", "manage"] as const;
    const cells: PermissionMatrixRow["cells"] = {};
    const values: Record<string, boolean> = { view: true, execute: false, manage: false };
    const inherited = { ...values };
    for (const a of ["view", "create", "update", "delete", "export", "execute", "manage"] as const) {
      const ok = (supported as readonly string[]).includes(a);
      cells[a] = {
        action: a,
        supported: ok,
        allowed: Boolean(values[a]),
        source: ok ? "inherited" : "unsupported",
        originLabel: ok ? "Herdado" : "n/a",
      };
    }
    rows.push({
      resourceKey: moduleKey,
      label: `Módulo ${m}`,
      description: "",
      type: "MENU",
      groupId: `group-${m % 3}`,
      parentKey: null,
      depth: 0,
      supportedActions: [...supported],
      cells,
      values,
      inherited,
      children,
    });
  }
  return rows;
}
