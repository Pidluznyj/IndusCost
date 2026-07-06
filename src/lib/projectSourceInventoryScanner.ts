import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, posix } from "node:path";

export type SourceFileKind =
  | "frontend_component"
  | "backend_service"
  | "api_route"
  | "domain_rule"
  | "data_mapper"
  | "view_model"
  | "test"
  | "style"
  | "script"
  | "prisma_schema"
  | "migration"
  | "config"
  | "asset"
  | "unknown";

export type SourceLifecycleStatus =
  | "active"
  | "shared_active"
  | "test_only"
  | "legacy"
  | "deprecated"
  | "duplicate_candidate"
  | "replace_candidate"
  | "removal_candidate"
  | "unknown";

export type ProjectSourceAuditRisk = "ok" | "attention" | "risk" | "unknown";

export type ProjectSourceAuditRecommendation =
  | "keep"
  | "keep_shared"
  | "replace_with_standard"
  | "merge_with_existing"
  | "review_before_removal"
  | "candidate_for_removal"
  | "needs_tests"
  | "needs_owner_decision";

export type ProjectSourceInventoryEntry = {
  file: string;
  module: string;
  kind: SourceFileKind;
  lifecycleStatus: SourceLifecycleStatus;
  recommendation: ProjectSourceAuditRecommendation;
  importedByCount: number;
  importsCount: number;
  routes: string[];
  endpoints: string[];
  prismaModels: string[];
  dataSources: string[];
  relatedTests: string[];
  risk: ProjectSourceAuditRisk;
  reason: string;
  suggestedAction: string;
};

export type SourceDependencyAuditEntry = {
  file: string;
  kind: SourceFileKind;
  module: string;
  imports: string[];
  importedBy: string[];
  isEntrypoint: boolean;
  isTestOnly: boolean;
  isOrphanCandidate: boolean;
  hasFrontendBackendBoundaryRisk: boolean;
  notes: string[];
};

export type FrontendRouteAudit = {
  route: string;
  module: string;
  screenName: string;
  componentFiles: string[];
  isLinkedInNavigation: boolean;
  risk: "ok" | "attention" | "orphan";
};

export type BackendEndpointAudit = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  module: string;
  handlerFiles: string[];
  authRequired: boolean | null;
  permissions: string[];
  usedByFrontend: boolean | null;
  risk: "ok" | "attention" | "orphan" | "unknown";
};

export type ProjectModuleAuditSummary = {
  module: string;
  filesCount: number;
  activeCount: number;
  sharedCount: number;
  legacyCount: number;
  duplicateCandidatesCount: number;
  replaceCandidatesCount: number;
  removalCandidatesCount: number;
  riskCount: number;
  mainFiles: string[];
  recommendations: string[];
};

export type RefactorCandidateItem = {
  file: string;
  module: string;
  reason: string;
  suggestedReplacement?: string;
  risk: "low" | "medium" | "high";
  safeToRemoveNow: false;
};

const SCAN_ROOTS = [
  "src/lib",
  "src/components",
  "src/App.tsx",
  "src/main.tsx",
  "scripts",
  "server.ts",
  "prisma/schema.prisma",
  "vite.config.ts",
  "package.json",
] as const;

const ENTRYPOINTS = new Set([
  "server.ts",
  "src/App.tsx",
  "src/main.tsx",
  "vite.config.ts",
  "package.json",
  "prisma/schema.prisma",
]);

const STYLE_EXT = new Set([".css", ".scss"]);

export function normalizeRepoPath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
}

function walkDir(absDir: string, relBase: string, out: string[]): void {
  if (!existsSync(absDir)) return;
  for (const name of readdirSync(absDir)) {
    const abs = join(absDir, name);
    const rel = relBase ? `${relBase}/${name}` : name;
    const st = statSync(abs);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "dist" || name === ".git") continue;
      walkDir(abs, rel, out);
    } else if (/\.(ts|tsx|css|sh|mjs|json|prisma)$/i.test(name)) {
      out.push(normalizeRepoPath(rel));
    }
  }
}

export function listAuditedSourceFiles(cwd = process.cwd()): string[] {
  const files: string[] = [];
  for (const root of SCAN_ROOTS) {
    const abs = join(cwd, root);
    if (!existsSync(abs)) continue;
    const st = statSync(abs);
    if (st.isFile()) {
      files.push(normalizeRepoPath(root));
    } else {
      walkDir(abs, root, files);
    }
  }
  return [...new Set(files)].sort();
}

export function inferSourceFileKind(file: string): SourceFileKind {
  const f = normalizeRepoPath(file);
  if (f.endsWith(".test.ts") || f.endsWith(".test.tsx")) return "test";
  if (STYLE_EXT.has(f.slice(f.lastIndexOf(".")))) return "style";
  if (f.startsWith("scripts/")) return "script";
  if (f === "prisma/schema.prisma") return "prisma_schema";
  if (f.includes("/prisma/migrations/")) return "migration";
  if (f === "package.json" || f === "vite.config.ts") return "config";
  if (f.endsWith("Routes.ts")) return "api_route";
  if (f.startsWith("src/components/")) return "frontend_component";
  if (f.includes("Export") || f.includes("export")) return "data_mapper";
  if (f.includes("Dashboard") || f.includes("ViewModel") || f.includes("viewModel")) {
    return "view_model";
  }
  if (
    f.includes("Rules") ||
    f.includes("rules") ||
    f.includes("Lifecycle") ||
    f.includes("Audit")
  ) {
    return "domain_rule";
  }
  if (f.startsWith("src/lib/")) return "backend_service";
  return "unknown";
}

export function inferSourceModule(file: string): string {
  const f = normalizeRepoPath(file);
  const base = f.split("/").pop() ?? f;

  if (f.startsWith("src/components/finance/")) return "Financeiro";
  if (f.startsWith("src/components/commercial/")) return "Comercial";
  if (f.startsWith("src/components/sales/")) return "Pedidos de Venda";
  if (f.startsWith("src/components/crm/")) return "CRM / Clientes";
  if (f.startsWith("src/components/customers/")) return "CRM / Clientes";
  if (f.startsWith("src/components/projects/")) return "Projetos";
  if (f.startsWith("src/components/fleet/")) return "Frota";
  if (f.startsWith("src/components/product/")) return "Produtos / Nomus";
  if (f.startsWith("src/components/contextual/")) return "Inteligência MP";
  if (f.startsWith("src/components/print/")) return "Print/PDF";
  if (f.startsWith("src/components/proposal/")) return "Propostas";
  if (f.startsWith("src/components/dashboard/")) return "Dashboard Executivo";
  if (f.startsWith("src/components/admin/")) return "Admin / Configurações";
  if (f.startsWith("src/components/layout/")) return "Utilitários compartilhados";
  if (f.startsWith("src/components/common/")) return "Utilitários compartilhados";
  if (f.startsWith("src/components/shared/")) return "Utilitários compartilhados";

  if (/^finance/i.test(base)) return "Financeiro";
  if (/^nomus/i.test(base)) return "Nomus Sync";
  if (/^fleet/i.test(base)) return "Frota";
  if (/^projects|^simulation/i.test(base)) return "Projetos";
  if (/^customer|^crm|^commercialActivity|^soldProduct|^adminSeller/i.test(base)) {
    return "CRM / Clientes";
  }
  if (/^salesOrder|^soldProduct|^salesProduct|^salesFunnel|^materialDemand/i.test(base)) {
    return "Pedidos de Venda";
  }
  if (/^executive|^salesFunnel/i.test(base)) return "Dashboard Executivo";
  if (/^print|^ProposalPrint|^SalesOrderPrint/i.test(base)) return "Print/PDF";
  if (/Audit/i.test(base)) return "Auditorias";
  if (/^accessProfiles|^modulePermissions|^adminUsers/i.test(base)) return "Admin / Configurações";
  if (f.startsWith("scripts/nomus") || f.includes("nomusSync")) return "Nomus Sync";
  if (f === "server.ts") return "Utilitários compartilhados";
  if (f.startsWith("src/lib/importer/")) return "Utilitários compartilhados";
  if (f.startsWith("src/lib/systemGuide/")) return "Utilitários compartilhados";
  if (/^pricing|^proposal|^openBook/i.test(base)) return "Projetos";
  if (f.startsWith("scripts/")) return "Scripts / Ops";
  return "Utilitários compartilhados";
}

const IMPORT_RE =
  /(?:import|export)\s+(?:type\s+)?(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

export function parseSourceImports(content: string, fromFile: string): string[] {
  const imports = new Set<string>();
  let m: RegExpExecArray | null;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(content)) !== null) {
    const spec = m[1] ?? m[2];
    if (!spec || spec.startsWith("node:")) continue;
    if (spec.startsWith("@/")) {
      const normalized = normalizeRepoPath(spec.replace(/^@\//, "").replace(/^src\//, "src/"));
      imports.add(normalized);
      if (!normalized.endsWith(".ts") && !normalized.endsWith(".tsx")) {
        imports.add(`${normalized}.tsx`);
        imports.add(`${normalized}.ts`);
      }
      continue;
    }
    if (spec.startsWith(".")) {
      const dir = fromFile.includes("/") ? fromFile.slice(0, fromFile.lastIndexOf("/")) : "";
      const parts = `${dir}/${spec}`.split("/");
      const resolved: string[] = [];
      for (const p of parts) {
        if (p === "." || p === "") continue;
        if (p === "..") resolved.pop();
        else resolved.push(p);
      }
      let candidate = normalizeRepoPath(resolved.join("/"));
      const baseCandidate = candidate.replace(/\.(js|jsx|mjs|cjs)$/, "");
      if (!baseCandidate.endsWith(".ts") && !baseCandidate.endsWith(".tsx")) {
        for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
          const withExt = baseCandidate + ext;
          if (withExt.startsWith("src/") || withExt.startsWith("scripts/")) {
            imports.add(withExt);
          }
        }
      } else {
        imports.add(baseCandidate);
      }
    }
  }
  return [...imports];
}

export function buildImportGraph(
  files: string[],
  cwd = process.cwd()
): Map<string, { imports: string[]; importedBy: string[] }> {
  const graph = new Map<string, { imports: string[]; importedBy: string[] }>();
  for (const f of files) {
    graph.set(f, { imports: [], importedBy: [] });
  }
  for (const file of files) {
    const abs = join(cwd, file);
    if (!existsSync(abs)) continue;
    let content = "";
    try {
      content = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const imports = parseSourceImports(content, file);
    const node = graph.get(file);
    if (!node) continue;
    node.imports = imports;
    for (const imp of imports) {
      const targets = [imp, imp.replace(/\.js$/, ".ts"), imp.replace(/\.js$/, ".tsx")];
      for (const t of targets) {
        const target = graph.get(t);
        if (target && !target.importedBy.includes(file)) {
          target.importedBy.push(file);
        }
      }
    }
  }
  return graph;
}

export type CuratedSourceOverride = Partial<
  Pick<
    ProjectSourceInventoryEntry,
    | "lifecycleStatus"
    | "recommendation"
    | "risk"
    | "reason"
    | "suggestedAction"
    | "routes"
    | "endpoints"
    | "prismaModels"
    | "dataSources"
    | "module"
    | "kind"
  >
> & { suggestedReplacement?: string };

export const CURATED_SOURCE_OVERRIDES: Record<string, CuratedSourceOverride> = {
  "server.ts": {
    lifecycleStatus: "shared_active",
    recommendation: "keep_shared",
    risk: "risk",
    reason: "Monólito Express com milhares de rotas inline + registrars modulares.",
    suggestedAction: "Não refatorar em massa; extrair domínios gradualmente com testes.",
    dataSources: ["Prisma", "Express"],
  },
  "src/lib/prisma.ts": {
    lifecycleStatus: "shared_active",
    recommendation: "keep_shared",
    risk: "risk",
    reason: "Cliente Prisma único do backend.",
    suggestedAction: "Manter; nunca importar no frontend.",
    prismaModels: ["*"],
  },
  "src/lib/customerCommercialProposalLegacy.ts": {
    lifecycleStatus: "deprecated",
    recommendation: "replace_with_standard",
    risk: "attention",
    module: "CRM / Clientes",
    reason: "Motor comercial legado baseado em Proposal; SalesOrder é fonte principal.",
    suggestedAction: "Migrar consumidores restantes para customerCommercialSalesOrderView.",
    suggestedReplacement: "src/lib/customerCommercialSalesOrderView.ts",
  },
  "src/lib/financeDataAuditCopy.ts": {
    lifecycleStatus: "duplicate_candidate",
    recommendation: "merge_with_existing",
    risk: "attention",
    reason: "Cópia paralela de financeDataAudit — possível drift.",
    suggestedAction: "Revisar diff e consolidar em financeDataAudit.ts.",
    suggestedReplacement: "src/lib/financeDataAudit.ts",
  },
  "src/lib/materialDemandPlannedRealizedAuditCopy.ts": {
    lifecycleStatus: "duplicate_candidate",
    recommendation: "merge_with_existing",
    risk: "attention",
    reason: "Cópia paralela do audit de matéria-prima.",
    suggestedAction: "Consolidar com materialDemandPlannedRealizedAudit.ts.",
    suggestedReplacement: "src/lib/materialDemandPlannedRealizedAudit.ts",
  },
  "src/lib/systemDataLineageAudit.ts": {
    lifecycleStatus: "shared_active",
    recommendation: "keep_shared",
    risk: "ok",
    module: "Auditorias",
    reason: "Matriz canônica funcionalidade → fonte de dados.",
    suggestedAction: "Manter e expandir conforme novos módulos.",
  },
  "src/lib/hardcodedBusinessDataAudit.ts": {
    lifecycleStatus: "shared_active",
    recommendation: "keep_shared",
    risk: "ok",
    module: "Auditorias",
    reason: "Scanner de hardcode de negócio em produção.",
    suggestedAction: "Manter; rodar via npm run audit:data-lineage.",
  },
  "src/lib/printPdfAudit.ts": {
    lifecycleStatus: "shared_active",
    recommendation: "keep_shared",
    risk: "ok",
    module: "Auditorias",
    reason: "Registro de prints/PDFs e conformidade visual.",
    suggestedAction: "Manter; rodar via npm run audit:print-pdf.",
  },
  "src/components/sales/SalesOrderManagementPage.tsx": {
    lifecycleStatus: "active",
    recommendation: "keep",
    module: "Pedidos de Venda",
    routes: ["/sales-orders/management"],
    risk: "ok",
    reason: "Tela ativa de Gestão de Pedidos de Venda.",
    suggestedAction: "Manter; evoluir sem carregar inteligência pesada na listagem.",
  },
  "src/lib/salesOrderIntelligenceRoutes.ts": {
    lifecycleStatus: "active",
    recommendation: "keep",
    module: "Pedidos de Venda",
    endpoints: ["/api/sales-orders/management", "/api/sales-orders/:id/intelligence"],
    risk: "ok",
    reason: "Endpoints de gestão e inteligência do pedido.",
    suggestedAction: "Manter; não alterar sync Nomus.",
  },
  "src/lib/financeAccountsReceivableDashboard.ts": {
    lifecycleStatus: "active",
    recommendation: "keep",
    module: "Financeiro",
    risk: "risk",
    reason: "Motor canônico de Contas a Receber.",
    suggestedAction: "Não duplicar cálculo; alterações exigem test:finance:accounts-receivable.",
    prismaModels: ["NomusAccountsReceivable"],
    dataSources: ["Nomus AR sync"],
  },
  "src/lib/financeAccountsPayableDashboard.ts": {
    lifecycleStatus: "active",
    recommendation: "keep",
    module: "Financeiro",
    risk: "risk",
    reason: "Motor canônico de Contas a Pagar.",
    suggestedAction: "Não duplicar cálculo; alterações exigem test:finance:accounts-payable.",
    prismaModels: ["NomusAccountsPayable"],
  },
  "src/lib/financeCashFlowDashboard.ts": {
    lifecycleStatus: "active",
    recommendation: "keep",
    module: "Financeiro",
    risk: "risk",
    reason: "Motor canônico de Fluxo de Caixa derivado de AR/AP.",
    suggestedAction: "Manter derivação; não inventar títulos.",
  },
  "src/lib/financeBillingDashboard.ts": {
    lifecycleStatus: "active",
    recommendation: "keep",
    module: "Financeiro",
    risk: "risk",
    reason: "Motor canônico de Faturamento.",
    suggestedAction: "Manter; depende de NomusNfe e SalesOrder.",
    prismaModels: ["NomusNfe", "SalesOrder"],
  },
  "src/lib/financeExecutiveReport.ts": {
    lifecycleStatus: "active",
    recommendation: "keep",
    module: "Financeiro",
    routes: ["/finance/executive-report"],
    endpoints: ["/api/finance/executive-report"],
    risk: "risk",
    reason: "Relatório Presidencial — composição de motores financeiros.",
    suggestedAction: "Alterações exigem test:finance:executive-report.",
  },
};

function inferPrismaModels(content: string): string[] {
  const models = new Set<string>();
  const re = /prisma\.(\w+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (m[1] && m[1] !== "client") models.add(m[1]);
  }
  return [...models];
}

function inferDataSources(content: string, prismaModels: string[]): string[] {
  const sources = new Set<string>();
  if (prismaModels.length) sources.add("Prisma");
  if (/nomus/i.test(content)) sources.add("Nomus API/sync");
  if (/nomusRawResponse/i.test(content)) sources.add("nomusRawResponse");
  if (/fetchJsonOk|fetch\(/i.test(content)) sources.add("HTTP interno");
  if (/mock|fixture|stub/i.test(content) && !/\.test\./i.test(content)) {
    sources.add("mock (verificar)");
  }
  return [...sources];
}

function defaultRecommendation(
  lifecycle: SourceLifecycleStatus
): ProjectSourceAuditRecommendation {
  switch (lifecycle) {
    case "shared_active":
      return "keep_shared";
    case "legacy":
    case "deprecated":
      return "replace_with_standard";
    case "duplicate_candidate":
      return "merge_with_existing";
    case "replace_candidate":
      return "replace_with_standard";
    case "removal_candidate":
      return "review_before_removal";
    case "test_only":
      return "keep";
    case "unknown":
      return "needs_owner_decision";
    default:
      return "keep";
  }
}

function classifyLifecycle(
  file: string,
  importedByCount: number,
  override?: CuratedSourceOverride
): SourceLifecycleStatus {
  if (override?.lifecycleStatus) return override.lifecycleStatus;
  if (file.endsWith(".test.ts") || file.endsWith(".test.tsx")) return "test_only";
  if (ENTRYPOINTS.has(file)) return "shared_active";
  if (file.endsWith("Module.tsx")) return "active";
  if (file.startsWith("src/components/") && importedByCount === 0) {
    // Componentes podem ser lazy-loaded — marcar atenção, não remoção direta
    return "active";
  }
  if (file.includes("Legacy") || file.includes("legacy")) return "legacy";
  if (file.includes("Copy.ts") && !file.endsWith(".test.ts")) return "duplicate_candidate";
  if (/@deprecated/i.test(readFileSafe(file))) return "deprecated";
  if (importedByCount === 0 && !file.startsWith("scripts/") && !file.endsWith(".css")) {
    if (file.endsWith("Routes.ts") || file === "server.ts") return "active";
    return "removal_candidate";
  }
  if (importedByCount >= 3) return "shared_active";
  return "active";
}

function readFileSafe(file: string, cwd = process.cwd()): string {
  try {
    return readFileSync(join(cwd, file), "utf8");
  } catch {
    return "";
  }
}

function relatedTestsFor(file: string, allFiles: string[]): string[] {
  const base = file.replace(/\.(ts|tsx)$/, "");
  return allFiles.filter(
    (f) =>
      f.endsWith(".test.ts") || f.endsWith(".test.tsx")
        ? f.startsWith(base) || f.includes(base.split("/").pop() ?? "")
        : false
  ).filter((f) => f.includes(base.split("/").pop() ?? "___"));
}

export function extractFrontendRoutesFromApp(cwd = process.cwd()): FrontendRouteAudit[] {
  const appPath = join(cwd, "src/App.tsx");
  if (!existsSync(appPath)) return [];
  const content = readFileSync(appPath, "utf8");
  const routes: FrontendRouteAudit[] = [];
  const pathRe = /path="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = pathRe.exec(content)) !== null) {
    const route = m[1];
    if (!route || route === "*") continue;
    const module = route.startsWith("/finance")
      ? "Financeiro"
      : route.startsWith("/sales-orders") || route.includes("sold-products")
        ? "Pedidos de Venda"
        : route.startsWith("/crm") || route.startsWith("/customers")
          ? "CRM / Clientes"
          : route.startsWith("/projects")
            ? "Projetos"
            : route.startsWith("/fleet")
              ? "Frota"
              : route.startsWith("/products")
                ? "Produtos / Nomus"
                : route === "dashboard"
                  ? "Dashboard Executivo"
                  : "Utilitários compartilhados";
    routes.push({
      route: route.startsWith("/") ? route : `/${route}`,
      module,
      screenName: route,
      componentFiles: ["src/App.tsx"],
      isLinkedInNavigation: content.includes(`to="${route}`) || content.includes(`to="/${route.replace(/^\//, "")}`),
      risk: "ok",
    });
  }
  return routes;
}

export function extractBackendEndpoints(cwd = process.cwd()): BackendEndpointAudit[] {
  const endpoints: BackendEndpointAudit[] = [];
  const libDir = join(cwd, "src/lib");
  if (!existsSync(libDir)) return endpoints;

  const routeFiles = readdirSync(libDir).filter((f) => f.endsWith("Routes.ts"));
  for (const rf of routeFiles) {
    const file = `src/lib/${rf}`;
    const content = readFileSync(join(cwd, file), "utf8");
    const module = inferSourceModule(file);
    const epRe = /app\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/gi;
    let m: RegExpExecArray | null;
    while ((m = epRe.exec(content)) !== null) {
      const method = m[1].toUpperCase() as BackendEndpointAudit["method"];
      endpoints.push({
        method,
        path: m[2],
        module,
        handlerFiles: [file],
        authRequired: /requireAppAuth|requirePermission|requireAnyPermission/.test(content),
        permissions: [],
        usedByFrontend: null,
        risk: "ok",
      });
    }
  }
  return endpoints;
}

export function buildProjectSourceInventory(cwd = process.cwd()): {
  files: string[];
  inventory: ProjectSourceInventoryEntry[];
  dependencies: SourceDependencyAuditEntry[];
  moduleSummaries: ProjectModuleAuditSummary[];
  frontendRoutes: FrontendRouteAudit[];
  backendEndpoints: BackendEndpointAudit[];
} {
  const files = listAuditedSourceFiles(cwd);
  const graph = buildImportGraph(files, cwd);
  const testFiles = files.filter((f) => f.endsWith(".test.ts") || f.endsWith(".test.tsx"));

  const inventory: ProjectSourceInventoryEntry[] = files.map((file) => {
    const node = graph.get(file) ?? { imports: [], importedBy: [] };
    const override = CURATED_SOURCE_OVERRIDES[file];
    const kind = override?.kind ?? inferSourceFileKind(file);
    const module = override?.module ?? inferSourceModule(file);
    const lifecycle = classifyLifecycle(file, node.importedBy.length, override);
    const content = readFileSafe(file, cwd);
    const prismaModels = override?.prismaModels ?? inferPrismaModels(content);
    const dataSources = override?.dataSources ?? inferDataSources(content, prismaModels);
    const recommendation = override?.recommendation ?? defaultRecommendation(lifecycle);
    const relatedTests = testFiles.filter((t) => {
      const stem = file.replace(/\.(ts|tsx)$/, "").split("/").pop() ?? "";
      return t.includes(stem) && t.endsWith(".test.ts");
    });

    let risk: ProjectSourceAuditRisk = override?.risk ?? "ok";
    if (content.includes("@prisma/client") && file.startsWith("src/components/")) {
      risk = "risk";
    }
    if (lifecycle === "removal_candidate") risk = "attention";
    if (lifecycle === "legacy" || lifecycle === "deprecated") risk = "attention";

    const reason =
      override?.reason ??
      (lifecycle === "removal_candidate"
        ? "Sem importadores detectados — pode ser entrypoint dinâmico ou órfão."
        : lifecycle === "test_only"
          ? "Arquivo de teste."
          : `Usado por ${node.importedBy.length} arquivo(s).`);

    const suggestedAction =
      override?.suggestedAction ??
      (lifecycle === "removal_candidate"
        ? "Revisar manualmente antes de qualquer remoção."
        : "Manter até nova rodada de limpeza.");

    return {
      file,
      module,
      kind,
      lifecycleStatus: lifecycle,
      recommendation,
      importedByCount: node.importedBy.length,
      importsCount: node.imports.length,
      routes: override?.routes ?? [],
      endpoints: override?.endpoints ?? [],
      prismaModels,
      dataSources,
      relatedTests: relatedTests.slice(0, 5),
      risk,
      reason,
      suggestedAction,
    };
  });

  const dependencies: SourceDependencyAuditEntry[] = files.map((file) => {
    const node = graph.get(file) ?? { imports: [], importedBy: [] };
    const content = readFileSafe(file, cwd);
    const notes: string[] = [];
    const isTestOnly = file.endsWith(".test.ts") || file.endsWith(".test.tsx");
    const hasBoundary =
      file.startsWith("src/components/") &&
      (content.includes("@prisma/client") || /from ["'].*prisma/.test(content));
    if (hasBoundary) notes.push("Frontend importa Prisma — violação de fronteira.");
    return {
      file,
      kind: inferSourceFileKind(file),
      module: inferSourceModule(file),
      imports: node.imports,
      importedBy: node.importedBy,
      isEntrypoint: ENTRYPOINTS.has(file),
      isTestOnly,
      isOrphanCandidate:
        node.importedBy.length === 0 && !isTestOnly && !ENTRYPOINTS.has(file) && !file.endsWith(".css"),
      hasFrontendBackendBoundaryRisk: hasBoundary,
      notes,
    };
  });

  const moduleSummaries = buildModuleSummaries(inventory);
  const frontendRoutes = extractFrontendRoutesFromApp(cwd);
  const backendEndpoints = extractBackendEndpoints(cwd);

  return { files, inventory, dependencies, moduleSummaries, frontendRoutes, backendEndpoints };
}

export function buildModuleSummaries(
  inventory: ProjectSourceInventoryEntry[]
): ProjectModuleAuditSummary[] {
  const byModule = new Map<string, ProjectSourceInventoryEntry[]>();
  for (const entry of inventory) {
    const list = byModule.get(entry.module) ?? [];
    list.push(entry);
    byModule.set(entry.module, list);
  }

  return [...byModule.entries()]
    .map(([module, entries]) => {
      const mainFiles = entries
        .filter((e) => e.lifecycleStatus === "active" || e.lifecycleStatus === "shared_active")
        .sort((a, b) => b.importedByCount - a.importedByCount)
        .slice(0, 8)
        .map((e) => e.file);

      const recommendations: string[] = [];
      const dup = entries.filter((e) => e.lifecycleStatus === "duplicate_candidate").length;
      const rem = entries.filter((e) => e.lifecycleStatus === "removal_candidate").length;
      const leg = entries.filter((e) => e.lifecycleStatus === "legacy" || e.lifecycleStatus === "deprecated").length;
      if (dup > 0) recommendations.push(`Revisar ${dup} candidato(s) a duplicação.`);
      if (rem > 0) recommendations.push(`${rem} arquivo(s) sem importador — validar antes de remover.`);
      if (leg > 0) recommendations.push(`${leg} legado(s)/deprecated — planejar substituição.`);

      return {
        module,
        filesCount: entries.length,
        activeCount: entries.filter((e) => e.lifecycleStatus === "active").length,
        sharedCount: entries.filter((e) => e.lifecycleStatus === "shared_active").length,
        legacyCount: leg,
        duplicateCandidatesCount: dup,
        replaceCandidatesCount: entries.filter((e) => e.lifecycleStatus === "replace_candidate" || e.recommendation === "replace_with_standard").length,
        removalCandidatesCount: rem,
        riskCount: entries.filter((e) => e.risk === "risk" || e.risk === "attention").length,
        mainFiles,
        recommendations,
      };
    })
    .sort((a, b) => b.filesCount - a.filesCount);
}

export function buildRefactorCandidates(inventory: ProjectSourceInventoryEntry[]): {
  replaceCandidates: RefactorCandidateItem[];
  duplicateCandidates: RefactorCandidateItem[];
  removalCandidates: RefactorCandidateItem[];
  needsOwnerDecision: RefactorCandidateItem[];
} {
  const toItem = (e: ProjectSourceInventoryEntry): RefactorCandidateItem => ({
    file: e.file,
    module: e.module,
    reason: e.reason,
    suggestedReplacement: CURATED_SOURCE_OVERRIDES[e.file]?.suggestedReplacement,
    risk:
      e.risk === "risk" ? "high" : e.risk === "attention" ? "medium" : ("low" as const),
    safeToRemoveNow: false as const,
  });

  return {
    replaceCandidates: inventory
      .filter(
        (e) =>
          e.lifecycleStatus === "legacy" ||
          e.lifecycleStatus === "deprecated" ||
          e.lifecycleStatus === "replace_candidate" ||
          e.recommendation === "replace_with_standard"
      )
      .map(toItem),
    duplicateCandidates: inventory
      .filter((e) => e.lifecycleStatus === "duplicate_candidate")
      .map(toItem),
    removalCandidates: inventory
      .filter((e) => e.lifecycleStatus === "removal_candidate")
      .map(toItem),
    needsOwnerDecision: inventory
      .filter((e) => e.lifecycleStatus === "unknown" || e.recommendation === "needs_owner_decision")
      .map(toItem),
  };
}

export function summarizeInventoryStatus(inventory: ProjectSourceInventoryEntry[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const e of inventory) {
    counts[e.lifecycleStatus] = (counts[e.lifecycleStatus] ?? 0) + 1;
  }
  return counts;
}

export function summarizeInventoryRecommendations(
  inventory: ProjectSourceInventoryEntry[]
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const e of inventory) {
    counts[e.recommendation] = (counts[e.recommendation] ?? 0) + 1;
  }
  return counts;
}

export function getTopReviewCandidates(
  inventory: ProjectSourceInventoryEntry[],
  limit = 15
): ProjectSourceInventoryEntry[] {
  const priority = (e: ProjectSourceInventoryEntry): number => {
    let score = 0;
    if (e.risk === "risk") score += 100;
    if (e.risk === "attention") score += 50;
    if (e.lifecycleStatus === "removal_candidate") score += 30;
    if (e.lifecycleStatus === "duplicate_candidate") score += 25;
    if (e.lifecycleStatus === "legacy" || e.lifecycleStatus === "deprecated") score += 20;
    return score;
  };
  return [...inventory]
    .filter(
      (e) =>
        e.lifecycleStatus !== "test_only" &&
        (e.risk !== "ok" ||
          e.lifecycleStatus === "removal_candidate" ||
          e.lifecycleStatus === "duplicate_candidate" ||
          e.lifecycleStatus === "legacy" ||
          e.lifecycleStatus === "deprecated")
    )
    .sort((a, b) => priority(b) - priority(a))
    .slice(0, limit);
}

export function assertModuleSummariesFinite(summaries: ProjectModuleAuditSummary[]): boolean {
  for (const s of summaries) {
    const nums = [
      s.filesCount,
      s.activeCount,
      s.sharedCount,
      s.legacyCount,
      s.duplicateCandidatesCount,
      s.replaceCandidatesCount,
      s.removalCandidatesCount,
      s.riskCount,
    ];
    if (!nums.every((n) => Number.isFinite(n))) return false;
  }
  return true;
}
