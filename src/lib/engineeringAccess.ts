/**
 * Engenharia — matriz de acesso (P19).
 * Actions do contrato apenas — preservar BOM, custos, Nomus engineering, cotações MI.
 */

export const ENGINEERING_RESOURCE_KEYS = {
  home: "engineering",
  products: "engineering.products",
  productsTabInfo: "engineering.products.tab.info",
  productsTabBom: "engineering.products.tab.bom",
  productsTabRouting: "engineering.products.tab.routing",
  productsTabTree: "engineering.products.tab.tree",
  productsTabCost: "engineering.products.tab.cost",
  productsTabComposition: "engineering.products.tab.composition",
  transformationSimulator: "engineering.transformation_simulator",
  materials: "engineering.materials",
  marketIntelligence: "engineering.materials.market_intelligence",
  marketIntelligenceHome: "engineering.materials.market_intelligence.home",
  marketIntelligenceMaterial360: "engineering.materials.market_intelligence.material_360",
  marketIntelligenceQuotes: "engineering.materials.market_intelligence.quotes",
  simulations: "engineering.simulations",
  projects: "engineering.projects",
  projectsDetail: "engineering.projects.detail",
} as const;

export const ENGINEERING_ACTIONS = {
  view: "view",
  create: "create",
  update: "update",
  delete: "delete",
  export: "export",
  manage: "manage",
  approve: "approve",
  execute: "execute",
} as const;

export const ENGINEERING_PILOT_ENDPOINTS = [
  { method: "GET", path: "/api/products", resourceKey: "engineering.products", action: "view" },
  { method: "POST", path: "/api/products", resourceKey: "engineering.products", action: "create" },
  { method: "PUT", path: "/api/products/:id", resourceKey: "engineering.products", action: "update" },
  { method: "DELETE", path: "/api/products/:id", resourceKey: "engineering.products", action: "delete" },
  { method: "GET", path: "/api/products/:id/bom*", resourceKey: "engineering.products.tab.bom", action: "view" },
  { method: "GET", path: "/api/products/:id/tree*", resourceKey: "engineering.products.tab.tree", action: "view" },
  { method: "GET", path: "/api/products/:id/cost*", resourceKey: "engineering.products.tab.cost", action: "view" },
  { method: "POST", path: "/api/nomus/bom-*", resourceKey: "engineering.products", action: "update" },
  { method: "POST", path: "/api/nomus/engineering-sync*", resourceKey: "engineering.products", action: "update" },

  { method: "GET", path: "/api/transformation-simulator*", resourceKey: "engineering.transformation_simulator", action: "view" },

  { method: "GET", path: "/api/materials", resourceKey: "engineering.materials", action: "view" },
  { method: "POST", path: "/api/materials", resourceKey: "engineering.materials", action: "update" },
  { method: "PUT", path: "/api/materials/:id", resourceKey: "engineering.materials", action: "update" },
  {
    method: "GET",
    path: "/api/materials/stock-tablet/search",
    resourceKey: "engineering.materials",
    action: "view",
  },
  {
    method: "POST",
    path: "/api/materials/stock-tablet/conference",
    resourceKey: "engineering.materials",
    action: "update",
  },

  { method: "GET", path: "/api/materials/market-intelligence*", resourceKey: "engineering.materials.market_intelligence", action: "view" },
  { method: "GET", path: "/api/materials/:id/market*", resourceKey: "engineering.materials.market_intelligence.material_360", action: "view" },
  { method: "POST", path: "/api/materials/*/quotes*", resourceKey: "engineering.materials.market_intelligence.quotes", action: "update" },
  { method: "POST", path: "/api/materials/*/quotes/*/approve*", resourceKey: "engineering.materials.market_intelligence.quotes", action: "approve" },

  { method: "GET", path: "/api/simulations*", resourceKey: "engineering.simulations", action: "view" },
  { method: "POST", path: "/api/simulations*", resourceKey: "engineering.simulations", action: "create" },
  { method: "GET", path: "/api/new-product-simulations*", resourceKey: "engineering.simulations", action: "view" },
  { method: "POST", path: "/api/new-product-simulations*", resourceKey: "engineering.simulations", action: "create" },

  { method: "GET", path: "/api/projects", resourceKey: "engineering.projects", action: "view" },
  { method: "POST", path: "/api/projects", resourceKey: "engineering.projects", action: "manage" },
  { method: "GET", path: "/api/projects/:id", resourceKey: "engineering.projects.detail", action: "view" },
  { method: "PUT", path: "/api/projects/:id", resourceKey: "engineering.projects.detail", action: "manage" },
] as const;

export const ENGINEERING_FORBIDDEN_BLEED_KEYS = [
  "costs.view",
  "finance.view",
  "finance.accountsPayable.view",
  "crm.view",
] as const;
