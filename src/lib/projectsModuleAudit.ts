export type ProjectsModuleFeatureCategory =
  | "project_crud"
  | "simulated_product"
  | "bom"
  | "labor"
  | "cost"
  | "mold"
  | "official_snapshot"
  | "permissions"
  | "reporting";

export type ProjectsModuleFeatureStatus =
  | "implemented"
  | "partial"
  | "missing"
  | "unknown";

export type ProjectsModuleFeatureAudit = {
  id: string;
  name: string;
  category: ProjectsModuleFeatureCategory;
  status: ProjectsModuleFeatureStatus;
  files: string[];
  endpoints: string[];
  models: string[];
  description: string;
  limitations: string[];
  recommendedNextStep: string;
};

export const PROJECTS_MODULE_FEATURE_AUDIT: ProjectsModuleFeatureAudit[] = [
  {
    id: "project-crud",
    name: "CRUD de projetos",
    category: "project_crud",
    status: "implemented",
    files: [
      "src/lib/projectsService.ts",
      "src/lib/projectsRoutes.ts",
      "src/components/ProjectsModule.tsx",
    ],
    endpoints: [
      "GET /api/projects",
      "GET /api/projects/:id",
      "POST /api/projects",
      "PATCH /api/projects/:id",
      "DELETE /api/projects/:id",
    ],
    models: ["Project", "ProjectVersion"],
    description:
      "Criação, listagem, edição e exclusão (SUPER_ADMIN) de projetos com versão corrente.",
    limitations: [
      "Exclusão restrita a SUPER_ADMIN.",
      "Cliente/responsável podem ser texto livre ou lookup.",
    ],
    recommendedNextStep: "Adicionar duplicar projeto e filtros avançados na listagem.",
  },
  {
    id: "project-dashboard",
    name: "Dashboard de projetos",
    category: "project_crud",
    status: "implemented",
    files: ["src/lib/projectsDashboard.ts", "src/components/ProjectsModule.tsx"],
    endpoints: ["GET /api/projects/dashboard"],
    models: ["Project"],
    description: "Resumo executivo da carteira de projetos na listagem.",
    limitations: ["Métricas limitadas ao que projectsDashboard expõe."],
    recommendedNextStep: "Evoluir KPIs por status, tipo e valor estimado.",
  },
  {
    id: "simulated-product",
    name: "Produto simulado do projeto",
    category: "simulated_product",
    status: "partial",
    files: [
      "src/lib/projectsService.ts",
      "src/components/projects/ProjectSimulatedProductWorkspace.tsx",
      "src/components/projects/ProjectSimulatedProductFormModal.tsx",
    ],
    endpoints: [
      "POST /api/projects/:id/simulated-products",
      "PATCH /api/projects/:id/simulated-products/:simulatedProductId",
      "DELETE /api/projects/:id/simulated-products/:simulatedProductId",
    ],
    models: ["ProjectSimulatedProduct"],
    description:
      "Produto simulado vinculado a versão do projeto; workspace com abas de composição e custo.",
    limitations: [
      "PROJECTS_BLOCK_IN_PROJECT_PRODUCT_CREATION bloqueia criação in-project via API.",
      "Fluxo preferido: Simulações → adicionar referência ao projeto.",
    ],
    recommendedNextStep: "Unificar UX entre Simulações e workspace do produto simulado.",
  },
  {
    id: "simulated-item",
    name: "Itens/componentes simulados",
    category: "simulated_product",
    status: "implemented",
    files: [
      "src/lib/projectsGuidedFlow.ts",
      "src/components/projects/ProjectSimulatedItemFormModal.tsx",
      "src/components/projects/ProjectItemsTab.tsx",
    ],
    endpoints: [
      "POST /api/projects/:id/simulated-items",
      "PATCH /api/projects/:id/simulated-items/:simulatedItemId",
      "DELETE /api/projects/:id/simulated-items/:simulatedItemId",
    ],
    models: ["ProjectSimulatedItem"],
    description:
      "Materiais, componentes, embalagens, serviços e outros custos como itens simulados.",
    limitations: ["Sem conversão automática para cadastro oficial."],
    recommendedNextStep: "Melhorar referência cruzada entre itens simulados na árvore.",
  },
  {
    id: "official-snapshot",
    name: "Importação snapshot produto oficial",
    category: "official_snapshot",
    status: "implemented",
    files: [
      "src/lib/projectsProductSnapshot.ts",
      "src/lib/projectsProductEngineeringSnapshot.ts",
      "src/lib/projectSimulationMode.ts",
    ],
    endpoints: [
      "GET /api/projects/lookup/products/:productId/snapshot",
      "GET /api/projects/lookup/products/:productId/engineering-snapshot",
      "POST /api/projects/:id/import-product-snapshot",
    ],
    models: ["ProjectStructureLine"],
    description:
      "Lê Product/BOM/Routing oficial e grava linhas ProjectStructureLine sem alterar cadastro.",
    limitations: [
      "Dois formatos: snapshot plano (preview) e engineering tree (persistência).",
      "Custo oficial depende de getProductCostAnalysis injetado.",
    ],
    recommendedNextStep: "Documentar diff visual oficial vs simulado na UI.",
  },
  {
    id: "structure-bom",
    name: "Estrutura/BOM simulada",
    category: "bom",
    status: "implemented",
    files: [
      "src/lib/projectsStructureLineBuilder.ts",
      "src/lib/projectsEngineeringCostRollup.ts",
      "src/components/projects/ProjectStructureLineModal.tsx",
      "src/components/projects/ProjectEngineeringTreePanel.tsx",
    ],
    endpoints: [
      "POST /api/projects/:id/structure-lines",
      "PATCH /api/projects/:id/structure-lines/:lineId",
      "DELETE /api/projects/:id/structure-lines/:lineId",
      "DELETE /api/projects/:id/structure-snapshot/:snapshotRootProductId",
    ],
    models: ["ProjectStructureLine"],
    description:
      "Linhas com tipos RAW_MATERIAL, COMPONENT, PROCESS, MOLD_AMORTIZATION etc.; hierarquia parent/child.",
    limitations: [
      "Rollup de custo pode ficar incompleto se faltar custo em linha filha.",
      "Árvore complexa para usuários não técnicos.",
    ],
    recommendedNextStep: "Validações de quantidade/unidade na criação de linha.",
  },
  {
    id: "labor-process",
    name: "Processos / hora-homem (HH)",
    category: "labor",
    status: "implemented",
    files: [
      "src/lib/projectsUiUtils.ts",
      "src/components/projects/ProjectLaborLineModal.tsx",
    ],
    endpoints: ["POST /api/projects/:id/structure-lines", "PATCH /api/projects/:id/structure-lines/:lineId"],
    models: ["ProjectStructureLine"],
    description:
      "HH modelada como ProjectStructureLine lineType=PROCESS, sourceType=MANUAL, unit=HH.",
    limitations: [
      "Não existe modelo ProjectLaborLine separado.",
      "Importação de roteiro oficial gera linhas PROCESS com snapshots.",
    ],
    recommendedNextStep: "Import seletivo de processos oficiais sem reimportar BOM inteira.",
  },
  {
    id: "mold-cost",
    name: "Custos de molde",
    category: "mold",
    status: "implemented",
    files: [
      "src/lib/projectsMoldCostLines.ts",
      "src/components/projects/ProjectMoldFormModal.tsx",
      "src/components/projects/ProjectGuidedMoldModal.tsx",
    ],
    endpoints: [
      "POST /api/projects/:id/molds",
      "PATCH /api/projects/:id/molds/:moldId",
      "DELETE /api/projects/:id/molds/:moldId",
    ],
    models: ["ProjectMold"],
    description:
      "Moldes com modos CHARGED_SEPARATELY, AMORTIZED_IN_PRODUCT, etc.; amortização por quantidade.",
    limitations: ["Ciclo/cavidades não entram automaticamente no custo unitário industrial."],
    recommendedNextStep: "Vincular molde a produto simulado específico na UI.",
  },
  {
    id: "other-costs",
    name: "Outros custos",
    category: "cost",
    status: "implemented",
    files: [
      "src/lib/projectsOtherCostGroups.ts",
      "src/components/projects/ProjectOtherCostsModal.tsx",
    ],
    endpoints: [
      "POST /api/projects/:id/simulated-items",
      "PATCH /api/projects/:id/simulated-items/:simulatedItemId",
    ],
    models: ["ProjectSimulatedItem"],
    description:
      "Outros custos via ProjectSimulatedItem (não há model ProjectOtherCost); grupos TOOLING, OUTSOURCED, etc.",
    limitations: ["Sem model dedicado ProjectOtherCost; parsing por notas/grupos."],
    recommendedNextStep: "Considerar model dedicado se volume de outros custos crescer.",
  },
  {
    id: "cost-calculation",
    name: "Cálculo de custo simulado",
    category: "cost",
    status: "implemented",
    files: [
      "src/lib/projectsCalculations.ts",
      "src/lib/projectsService.ts",
      "src/lib/projectsEngineeringCostRollup.ts",
      "src/components/projects/ProjectCostSimulation.tsx",
    ],
    endpoints: ["GET /api/projects/:id", "GET /api/projects/:id/versions/:versionId"],
    models: ["ProjectVersion", "ProjectStructureLine", "ProjectMold"],
    description:
      "buildCostBreakdown agrega MP, componentes, serviços/HH, embalagem, molde amortizado; recalculateAndPersistVersionCosts.",
    limitations: [
      "Impostos/margem fiscal em módulo pricing separado.",
      "Não há orçamento PDF export.",
    ],
    recommendedNextStep: "Totalizadores por produto simulado na aba Custos.",
  },
  {
    id: "cost-amortization",
    name: "Amortização de custos (molde/outros)",
    category: "cost",
    status: "implemented",
    files: [
      "src/lib/projectsCostAmortization.ts",
      "src/lib/projectsCostAmortizationService.ts",
      "src/components/projects/ProjectCostAmortizationModal.tsx",
    ],
    endpoints: [
      "GET /api/projects/:id/cost-amortizations",
      "PUT /api/projects/:id/cost-amortizations",
      "DELETE /api/projects/:id/cost-amortizations/:sourceType/:sourceId",
    ],
    models: ["ProjectCostAmortization", "ProjectCostAmortizationAllocation"],
    description: "Distribui custo de molde/outros entre alvos com percentual e custo unitário final.",
    limitations: ["Configuração manual; status INCOMPLETE se alvos sem custo base."],
    recommendedNextStep: "Assistente guiado para amortização em lote.",
  },
  {
    id: "pricing",
    name: "Precificação / margem / preço sugerido",
    category: "cost",
    status: "partial",
    files: [
      "src/lib/projectsPricing.ts",
      "src/lib/projectsPricingService.ts",
      "src/components/projects/ProjectPricingSection.tsx",
    ],
    endpoints: ["GET /api/projects/:id/pricing", "PUT /api/projects/:id/pricing"],
    models: ["ProjectPricingConfig", "ProjectPricingItem"],
    description:
      "Preço sugerido por margem; itens com regra fiscal opcional; status NO_COST/PENDING/CALCULATED.",
    limitations: [
      "Integração fiscal depende de TaxRule.",
      "Não gera proposta comercial automaticamente.",
    ],
    recommendedNextStep: "Exportar pricing para módulo Comercial/Propostas.",
  },
  {
    id: "official-isolation",
    name: "Isolamento do cadastro oficial",
    category: "official_snapshot",
    status: "implemented",
    files: [
      "src/lib/projectSimulationMode.ts",
      "src/lib/projectsSimulationIsolation.test.ts",
      "src/components/projects/ProjectSimulationBanner.tsx",
    ],
    endpoints: [],
    models: ["ProjectStructureLine"],
    description:
      "BLOCKED_OFFICIAL_WRITE_PATTERNS e isOfficialProductWriteFetch impedem PATCH em /api/products.",
    limitations: [
      "projects.approve e projects.convert existem mas conversão está desabilitada.",
    ],
    recommendedNextStep: "Auditoria periódica de rotas que possam gravar Product/BOM.",
  },
  {
    id: "permissions",
    name: "Permissões do módulo",
    category: "permissions",
    status: "partial",
    files: ["src/lib/projectsPermissions.ts", "src/lib/permissionCatalog.ts"],
    endpoints: [],
    models: [],
    description: "projects.view, projects.manage, projects.approve, projects.convert no catálogo.",
    limitations: [
      "approve/convert não usados nas rotas.",
      "Delete só SUPER_ADMIN, não permission granular.",
    ],
    recommendedNextStep: "Aplicar projects.approve em workflow de status.",
  },
  {
    id: "intake-form",
    name: "Ficha de Abertura de Projeto",
    category: "reporting",
    status: "implemented",
    files: [
      "src/lib/projectsIntakeQuickForm.ts",
      "src/lib/projectsIntakeForm.ts",
      "src/lib/projectsIntakeSpreadsheet.ts",
      "src/components/projects/ProjectIntakeQuickFormDocument.tsx",
      "src/components/projects/ProjectIntakeFormDocument.tsx",
      "src/components/projects/ProjectIntakeFormPage.tsx",
      "src/components/projects/ProjectIntakeActions.tsx",
      "src/project-intake-form-print.css",
      "docs/projects/PROJECT_INTAKE_SPREADSHEET.md",
    ],
    endpoints: ["GET /api/projects/:id"],
    models: ["Project", "ProjectVersion", "ProjectSimulatedProduct", "ProjectStructureLine", "ProjectMold"],
    description:
      "Ficha rápida de estimativa (principal), ficha completa (dossiê) e planilha modelo XLSX para abertura de projeto.",
    limitations: [
      "Formulário somente leitura/impressão — edição digital em versão futura.",
      "Importação da planilha ainda não implementada.",
      "Sem PDF server-side.",
    ],
    recommendedNextStep: "Formulário digital editável com checklist de pendências.",
  },
  {
    id: "executive-report",
    name: "Relatório executivo do projeto",
    category: "reporting",
    status: "implemented",
    files: [
      "src/lib/projectsExecutiveReport.ts",
      "src/components/projects/ProjectExecutiveReportPage.tsx",
    ],
    endpoints: [],
    models: ["Project", "ProjectVersion"],
    description: "Página /projects/:id/report com visão executiva e impressão.",
    limitations: ["Não é PDF server-side; depende de print CSS."],
    recommendedNextStep: "Export PDF server-side opcional.",
  },
  {
    id: "simulation-references",
    name: "Referências de simulações externas",
    category: "simulated_product",
    status: "implemented",
    files: [
      "src/lib/projectsSimulationRefs.ts",
      "src/lib/projectsSimulationItemService.ts",
      "src/components/projects/ProjectsGoToSimulationsCallout.tsx",
    ],
    endpoints: [
      "GET /api/projects/lookup/simulations",
      "POST /api/projects/:id/simulation-references",
    ],
    models: ["ProjectStructureLine", "ProjectSimulatedProduct"],
    description: "Vincula simulações do módulo Simulações ao projeto sem criar produto in-project.",
    limitations: ["Fluxo entre módulos pode confundir usuário novo."],
    recommendedNextStep: "Onboarding na aba Início explicando Simulações vs Projeto.",
  },
  {
    id: "documents-history",
    name: "Documentos e histórico",
    category: "project_crud",
    status: "partial",
    files: [
      "src/components/projects/ProjectDocuments.tsx",
      "src/components/projects/ProjectHistory.tsx",
      "src/components/projects/ProjectTimeline.tsx",
    ],
    endpoints: [],
    models: ["ProjectVersion"],
    description: "Abas Documentos e Histórico na navegação guiada.",
    limitations: ["Anexos e audit trail completos não verificados em model dedicado."],
    recommendedNextStep: "Persistir anexos e log de alterações por versão.",
  },
];
