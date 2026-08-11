/**
 * Saúde da BOM efetiva — detecção de componente Product INATIVO na composição.
 *
 * Regra oficial (missão BOM_INACTIVE_COMPONENT):
 *   - Um Product ACTIVE cuja BOM efetiva contém um Product componente
 *     INACTIVE recebe pendência de engenharia BOM_INACTIVE_COMPONENT.
 *   - O status cadastral do pai NUNCA é alterado por esta regra —
 *     Product.status ≠ saúde de engenharia.
 *   - Novo custo oficial não deve ser gerado/publicado enquanto a pendência
 *     existir; histórico publicado permanece intacto.
 *
 * BOM efetiva: espelha EXATAMENTE o que `getProductCostAnalysis` percorre —
 * todas as linhas de ProductBOM do pai (Material ou childProduct). O model
 * local NÃO possui versão/vigência/status de linha/opcional/substituto
 * (CODE_CONFIRMED no schema); a única noção de opcional existe no lado Nomus
 * de PRICING (nomusEffectivePricingBom), que não alimenta o motor industrial.
 * Portanto: mesma composição que custeia = mesma composição que valida.
 *
 * Módulo PURO: sem Prisma/IO — o grafo é carregado em lote pelo
 * `productBomHealth.server.ts` (uma query por nível de profundidade, sem N+1).
 */

export const BOM_INACTIVE_COMPONENT_CODE = "BOM_INACTIVE_COMPONENT" as const;

export const BOM_INACTIVE_COMPONENT_TITLE = "Composição contém componente inativo";

export const BOM_INACTIVE_COMPONENT_DESCRIPTION =
  "Um ou mais componentes da composição vigente deste produto estão inativos. " +
  "Revise a engenharia antes de gerar ou publicar um novo custo.";

/** Nó do grafo de BOM carregado em lote (Product + filhos diretos). */
export type ProductBomGraphNode = {
  id: string;
  sku: string;
  name: string;
  status: string | null;
  /** childProductId de cada linha da BOM efetiva (linhas de Material não entram — fora do escopo). */
  childProductIds: string[];
};

export type ProductBomGraph = ReadonlyMap<string, ProductBomGraphNode>;

export type ProductBomHealthPathStep = { productId: string; sku: string };

export type ProductBomHealthIssue = {
  code: typeof BOM_INACTIVE_COMPONENT_CODE;
  severity: "BLOCKING";
  productId: string;
  productSku: string;
  componentId: string;
  componentSku: string;
  componentName: string;
  componentStatus: string;
  /** Profundidade do componente inativo (1 = filho direto). */
  level: number;
  /** Caminho raiz → componente inativo, ex.: 620.01 → 314.20AA → 314.19AA. */
  path: ProductBomHealthPathStep[];
};

export type ProductBomHealthResult = {
  ok: boolean;
  productId: string;
  productSku: string | null;
  issues: ProductBomHealthIssue[];
};

/** Máximo de caminhos distintos reportados por componente inativo (diagnóstico legível, sem explosão). */
const MAX_PATHS_PER_COMPONENT = 5;
/** Guarda-corpo de profundidade (além da proteção de ciclo por caminho). */
const MAX_DEPTH = 30;

function isInactiveStatus(status: string | null): boolean {
  return (status ?? "ACTIVE").trim().toUpperCase() === "INACTIVE";
}

export function formatBomHealthPath(path: ProductBomHealthPathStep[]): string {
  return path.map((p) => p.sku).join(" → ");
}

/**
 * Análise pura e recursiva sobre o grafo pré-carregado.
 * - Detecta componente Product INACTIVE em QUALQUER profundidade.
 * - Proteção contra ciclos: um nó não é revisitado dentro do mesmo caminho
 *   (A → B → C → A para sem loop, igual ao pathStack do motor de custo).
 * - Determinístico: percorre filhos na ordem carregada; caminhos distintos
 *   para o mesmo componente são reportados até MAX_PATHS_PER_COMPONENT.
 */
export function analyzeProductBomHealthFromGraph(
  rootProductId: string,
  graph: ProductBomGraph
): ProductBomHealthResult {
  const root = graph.get(rootProductId);
  if (!root) {
    return { ok: true, productId: rootProductId, productSku: null, issues: [] };
  }

  const issues: ProductBomHealthIssue[] = [];
  const pathsPerComponent = new Map<string, number>();
  const seenPathKeys = new Set<string>();

  const walk = (
    nodeId: string,
    path: ProductBomHealthPathStep[],
    onPath: Set<string>
  ): void => {
    if (path.length > MAX_DEPTH) return;
    const node = graph.get(nodeId);
    if (!node) return;

    for (const childId of node.childProductIds) {
      if (onPath.has(childId)) continue; // ciclo — não revisita no mesmo caminho
      const child = graph.get(childId);
      if (!child) continue; // referência órfã — já tratada pelo motor como CHILD_NOT_FOUND

      const childStep = { productId: child.id, sku: child.sku };
      const childPath = [...path, childStep];

      if (isInactiveStatus(child.status)) {
        const reported = pathsPerComponent.get(child.id) ?? 0;
        const pathKey = childPath.map((p) => p.productId).join(">");
        if (reported < MAX_PATHS_PER_COMPONENT && !seenPathKeys.has(pathKey)) {
          seenPathKeys.add(pathKey);
          pathsPerComponent.set(child.id, reported + 1);
          issues.push({
            code: BOM_INACTIVE_COMPONENT_CODE,
            severity: "BLOCKING",
            productId: root.id,
            productSku: root.sku,
            componentId: child.id,
            componentSku: child.sku,
            componentName: child.name,
            componentStatus: (child.status ?? "INACTIVE").trim().toUpperCase(),
            level: childPath.length - 1,
            path: childPath,
          });
        }
        // Continua descendo: subárvore de um inativo pode conter OUTROS inativos
        // relevantes para o diagnóstico completo.
      }

      onPath.add(childId);
      walk(childId, childPath, onPath);
      onPath.delete(childId);
    }
  };

  const rootStep = { productId: root.id, sku: root.sku };
  walk(root.id, [rootStep], new Set([root.id]));

  return {
    ok: issues.length === 0,
    productId: root.id,
    productSku: root.sku,
    issues,
  };
}

/** Mensagem funcional de bloqueio para um produto (resumo legível). */
export function buildBomHealthBlockMessage(result: ProductBomHealthResult): string {
  if (result.ok || result.issues.length === 0) return "";
  const distinct = new Map<string, ProductBomHealthIssue>();
  for (const issue of result.issues) {
    if (!distinct.has(issue.componentId)) distinct.set(issue.componentId, issue);
  }
  const parts = [...distinct.values()].map((issue) => {
    const pathLabel =
      issue.level > 1 ? ` (caminho: ${formatBomHealthPath(issue.path)})` : "";
    return `Componente ${issue.componentSku} está inativo${pathLabel}`;
  });
  return `${BOM_INACTIVE_COMPONENT_TITLE}: ${parts.join("; ")}.`;
}
