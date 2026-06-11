export type ProjectType =
  | "NEW_PRODUCT"
  | "NEW_COMPONENT"
  | "MOLD"
  | "PRODUCT_CHANGE"
  | "PRODUCT_WITH_NEW_COMPONENT"
  | "FULL_DEVELOPMENT"
  | "QUICK_ESTIMATE";

export type ProjectStatus =
  | "DRAFT"
  | "TECHNICAL_ANALYSIS"
  | "WAITING_QUOTATION"
  | "WAITING_INTERNAL_APPROVAL"
  | "SENT_TO_CUSTOMER"
  | "NEGOTIATION"
  | "APPROVED"
  | "REJECTED"
  | "CANCELLED"
  | "CONVERTED";

export type ProjectSimulatedItemType =
  | "RAW_MATERIAL"
  | "COMPONENT"
  | "FINISHED_PRODUCT"
  | "PACKAGING"
  | "SERVICE"
  | "MOLD"
  | "TOOLING"
  | "OUTSOURCED_PROCESS"
  | "OTHER";

export type ProjectStructureSourceType =
  | "EXISTING_PRODUCT"
  | "EXISTING_MATERIAL"
  | "SIMULATED_ITEM"
  | "MANUAL";

export type ProjectStructureLineType =
  | "RAW_MATERIAL"
  | "COMPONENT"
  | "PACKAGING"
  | "SERVICE"
  | "PROCESS"
  | "MOLD_AMORTIZATION"
  | "OTHER";

export type ProjectMoldChargeMode =
  | "CHARGED_SEPARATELY"
  | "AMORTIZED_IN_PRODUCT"
  | "PARTIALLY_ABSORBED"
  | "INTERNAL_INVESTMENT";

export type ProjectMoldOwnership = "CUSTOMER" | "COMPANY" | "SHARED" | "UNDEFINED";

export type ProjectListRow = {
  id: string;
  code: string;
  title: string;
  customerName: string;
  projectType: ProjectType;
  status: ProjectStatus;
  commercialOwner: string | null;
  technicalOwner: string | null;
  estimatedValue: number | null;
  marginPercent: number | null;
  updatedAt: string;
};

export type ProjectListResponse = {
  rows: ProjectListRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type ProjectVersionRow = {
  id: string;
  versionNumber: number;
  title: string | null;
  status: ProjectStatus;
  isCurrent: boolean;
  unitCost: number | null;
  suggestedPrice: number | null;
  marginPercent: number | null;
  createdAt: string;
  updatedAt: string;
};

export type ProjectSimulatedProductRow = {
  id: string;
  provisionalCode: string | null;
  description: string;
  unit: string;
  estimatedWeight: number | null;
  expectedVolume: number | null;
  batchSize: number | null;
  notes: string | null;
};

export type ProjectSimulatedItemRow = {
  id: string;
  provisionalCode: string | null;
  description: string;
  itemType: ProjectSimulatedItemType;
  unit: string;
  estimatedUnitCost: number | null;
  quotedUnitCost: number | null;
  supplierName: string | null;
  leadTimeDays: number | null;
  estimatedWeight: number | null;
  lossPercent: number | null;
  requiresQuotation: boolean;
  requiresEngineeringReview: boolean;
  canBecomeOfficial: boolean;
  notes: string | null;
};

export type ProjectStructureLineRow = {
  id: string;
  simulatedProductId: string | null;
  parentLineId: string | null;
  level: number | null;
  treePath: string | null;
  snapshotRootProductId: string | null;
  lineType: ProjectStructureLineType;
  sourceType: ProjectStructureSourceType;
  existingProductId: string | null;
  existingMaterialId: string | null;
  simulatedItemId: string | null;
  sourceOfficialBomId: string | null;
  sourceOfficialRoutingId: string | null;
  descriptionSnapshot: string;
  unitSnapshot: string;
  quantity: number;
  lossPercent: number | null;
  officialQuantitySnapshot: number | null;
  officialLossPercentSnapshot: number | null;
  officialUnitCostSnapshot: number | null;
  unitCostSnapshot: number;
  totalCost: number;
  costSource: string | null;
  isChangedFromOfficial: boolean;
  isMissingCost: boolean;
  countsInSimulatedProductCost: boolean;
  supplierNameSnapshot: string | null;
  notes: string | null;
  sortOrder: number;
};

export type ProjectMoldRow = {
  id: string;
  name: string;
  moldType: string | null;
  cavities: number | null;
  estimatedLifeCycles: number | null;
  supplierName: string | null;
  constructionCost: number;
  maintenanceCost: number | null;
  changeCost: number | null;
  leadTimeDays: number | null;
  chargeMode: ProjectMoldChargeMode;
  amortizationQuantity: number | null;
  amortizedCostPerUnit: number | null;
  ownership: ProjectMoldOwnership;
  notes: string | null;
};

export type ProjectCostBreakdown = {
  rawMaterialCost: number;
  componentCost: number;
  serviceCost: number;
  packagingCost: number;
  separateMoldCost: number;
  amortizedMoldCostPerUnit: number;
  unitCost: number;
  targetMarginPercent: number | null;
  suggestedPrice: number | null;
  markupPercent: number | null;
  targetPrice: number | null;
  priceGap: number | null;
};

export type ProjectAlert = {
  code: string;
  message: string;
  severity: "info" | "warning" | "error";
};

export type ProjectDetail = {
  id: string;
  code: string;
  title: string;
  customerName: string;
  customerDocument: string | null;
  description: string | null;
  projectType: ProjectType;
  status: ProjectStatus;
  commercialOwner: string | null;
  technicalOwner: string | null;
  expectedMonthlyVolume: number | null;
  targetPrice: number | null;
  targetMarginPercent: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  currentVersion: ProjectVersionRow | null;
  versions: ProjectVersionRow[];
  simulatedProducts: ProjectSimulatedProductRow[];
  simulatedItems: ProjectSimulatedItemRow[];
  structureLines: ProjectStructureLineRow[];
  molds: ProjectMoldRow[];
  costBreakdown: ProjectCostBreakdown;
  alerts: ProjectAlert[];
  conversionAvailable: false;
};

export type ProjectDashboardPayload = {
  openCount: number;
  waitingEngineeringCount: number;
  waitingQuotationCount: number;
  sentToCustomerCount: number;
  approvedCount: number;
  potentialValue: number;
  moldInvestment: number;
  averageMarginPercent: number | null;
  statusCounts: Record<ProjectStatus, number>;
  recentProjects: ProjectListRow[];
};
