import type { ProjectStructureLineRow } from "@/src/types/projects.js";

export type ProjectEngineeringTreeNode = {
  line: ProjectStructureLineRow | null;
  id: string;
  label: string;
  code: string;
  nodeType: "ROOT" | "PRODUCT" | "MATERIAL" | "PROCESS";
  children: ProjectEngineeringTreeNode[];
};

export function buildProjectEngineeringTree(
  root: { productId: string; sku: string; name: string },
  lines: ProjectStructureLineRow[]
): ProjectEngineeringTreeNode {
  const scoped = lines.filter(
    (l) =>
      l.snapshotRootProductId === root.productId ||
      l.notes?.includes(`snapshot:${root.productId}`)
  );
  const byParent = new Map<string | null, ProjectStructureLineRow[]>();
  for (const line of scoped) {
    const key = line.parentLineId;
    const bucket = byParent.get(key) ?? [];
    bucket.push(line);
    byParent.set(key, bucket);
  }
  for (const bucket of byParent.values()) {
    bucket.sort((a, b) => a.sortOrder - b.sortOrder);
  }

  const build = (parentId: string | null): ProjectEngineeringTreeNode[] => {
    const rows = byParent.get(parentId) ?? [];
    return rows.map((line) => {
      const isMaterial = line.lineType === "RAW_MATERIAL";
      const isProcess = line.lineType === "PROCESS" || line.unitSnapshot === "HH";
      const nodeType = isProcess ? "PROCESS" : isMaterial ? "MATERIAL" : "PRODUCT";
      return {
        line,
        id: line.id,
        label: line.descriptionSnapshot,
        code: line.descriptionSnapshot.split(" — ")[0] ?? line.descriptionSnapshot,
        nodeType,
        children: build(line.id),
      };
    });
  };

  return {
    line: null,
    id: root.productId,
    label: `${root.sku} — ${root.name}`,
    code: root.sku,
    nodeType: "ROOT",
    children: build(null),
  };
}
