/** Ponte para o motor oficial GET /api/products/:id/cost-analysis (registrado no server). */
export type ProjectsOfficialProductCostAnalysis = {
  totalIndustrialCost?: number;
  costAnalysisPartial?: boolean;
  details?: {
    materials?: Array<{
      bomLineId?: string;
      unitCost?: number;
      excludedFromCost?: boolean;
    }>;
  };
};

export type ProjectsProductCostResolver = (
  productId: string
) => Promise<ProjectsOfficialProductCostAnalysis | null | { error: string }>;

let resolver: ProjectsProductCostResolver | null = null;

export function setProjectsProductCostResolver(fn: ProjectsProductCostResolver | null): void {
  resolver = fn;
}

export function getProjectsProductCostResolver(): ProjectsProductCostResolver | null {
  return resolver;
}
