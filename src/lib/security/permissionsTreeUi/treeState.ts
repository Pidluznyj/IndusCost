import type {
  PermissionTreeCounters,
  PermissionTreeDecision,
  PermissionTreeDecisions,
  PermissionTreeEffective,
  PermissionTreeFilterState,
  PermissionTreeNode,
} from "./types.ts";

export function collectPermissionTreeIds(
  nodes: readonly PermissionTreeNode[]
): string[] {
  const ids: string[] = [];
  const walk = (list: readonly PermissionTreeNode[]) => {
    for (const n of list) {
      ids.push(n.id);
      walk(n.children);
    }
  };
  walk(nodes);
  return ids;
}

export function collectExpandableIds(
  nodes: readonly PermissionTreeNode[]
): string[] {
  const ids: string[] = [];
  const walk = (list: readonly PermissionTreeNode[]) => {
    for (const n of list) {
      if (n.children.length > 0) ids.push(n.id);
      walk(n.children);
    }
  };
  walk(nodes);
  return ids;
}

export function getNodeDecision(
  decisions: PermissionTreeDecisions,
  id: string
): PermissionTreeDecision {
  return decisions[id] ?? "inherit";
}

export function resolvePermissionTreeEffective(
  decision: PermissionTreeDecision,
  baselineEffective: PermissionTreeEffective,
  parentEffective: PermissionTreeEffective | null
): PermissionTreeEffective {
  if (parentEffective === "denied") return "denied";
  if (decision === "allow") return "allowed";
  if (decision === "deny") return "denied";
  if (parentEffective === "allowed" && baselineEffective === "inherited") {
    return "allowed";
  }
  return baselineEffective;
}

export function mapPermissionTreeEffectives(
  nodes: readonly PermissionTreeNode[],
  decisions: PermissionTreeDecisions,
  parentEffective: PermissionTreeEffective | null = null
): Map<string, PermissionTreeEffective> {
  const map = new Map<string, PermissionTreeEffective>();
  const walk = (
    list: readonly PermissionTreeNode[],
    parent: PermissionTreeEffective | null
  ) => {
    for (const n of list) {
      const decision = getNodeDecision(decisions, n.id);
      const effective = resolvePermissionTreeEffective(
        decision,
        n.baselineEffective,
        parent
      );
      map.set(n.id, effective);
      walk(n.children, effective);
    }
  };
  walk(nodes, parentEffective);
  return map;
}

export function countPermissionTreeDecisions(
  nodes: readonly PermissionTreeNode[],
  decisions: PermissionTreeDecisions
): PermissionTreeCounters {
  let allowed = 0;
  let denied = 0;
  let inherited = 0;
  let total = 0;
  const walk = (list: readonly PermissionTreeNode[]) => {
    for (const n of list) {
      total += 1;
      const d = getNodeDecision(decisions, n.id);
      if (d === "allow") allowed += 1;
      else if (d === "deny") denied += 1;
      else inherited += 1;
      walk(n.children);
    }
  };
  walk(nodes);
  return { allowed, denied, inherited, total };
}

export function filterPermissionTreeNodes(
  nodes: readonly PermissionTreeNode[],
  filter: PermissionTreeFilterState
): PermissionTreeNode[] {
  const q = filter.search.trim().toLowerCase();
  if (!q) return nodes.map((n) => ({ ...n, children: n.children }));

  const apply = (list: readonly PermissionTreeNode[]): PermissionTreeNode[] => {
    const out: PermissionTreeNode[] = [];
    for (const n of list) {
      const children = apply(n.children);
      const selfMatch =
        n.label.toLowerCase().includes(q) ||
        n.resourceKey.toLowerCase().includes(q) ||
        n.originLabel.toLowerCase().includes(q);
      if (selfMatch || children.length > 0) {
        out.push({ ...n, children: selfMatch ? n.children : children });
      }
    }
    return out;
  };
  return apply(nodes);
}

export function setPermissionTreeDecision(
  decisions: PermissionTreeDecisions,
  id: string,
  decision: PermissionTreeDecision
): PermissionTreeDecisions {
  if (decision === "inherit") {
    if (!(id in decisions)) return decisions;
    const next = { ...decisions };
    delete next[id];
    return next;
  }
  return { ...decisions, [id]: decision };
}

export function expandAllPermissionTreeKeys(
  nodes: readonly PermissionTreeNode[]
): Set<string> {
  return new Set(collectExpandableIds(nodes));
}

export function collapseAllPermissionTreeKeys(): Set<string> {
  return new Set();
}

export function togglePermissionTreeExpanded(
  expanded: ReadonlySet<string>,
  id: string
): Set<string> {
  const next = new Set(expanded);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export function kindLabel(kind: PermissionTreeNode["kind"]): string {
  switch (kind) {
    case "module":
      return "Módulo";
    case "page":
      return "Página";
    case "tab":
      return "Aba";
    case "action":
      return "Ação";
    default:
      return kind;
  }
}

export function decisionLabel(decision: PermissionTreeDecision): string {
  switch (decision) {
    case "allow":
      return "Permitir";
    case "deny":
      return "Negar";
    default:
      return "Herdar";
  }
}

export function effectiveLabel(effective: PermissionTreeEffective): string {
  switch (effective) {
    case "allowed":
      return "Permitido";
    case "denied":
      return "Negado";
    default:
      return "Herdado";
  }
}
