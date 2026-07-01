import type {
  CommissionCalculationRunMode,
  CommissionPaymentBatchStatus,
  CommissionPaymentScheduleSource,
  CommissionPaymentScheduleStatus,
  CommissionRecordOriginStage,
  CommissionRecordStatus,
  CommissionReleaseRule,
  CommissionRuleBeneficiaryType,
  CommissionRuleBaseType,
} from "@prisma/client";

export type {
  CommissionCalculationRunMode,
  CommissionPaymentBatchStatus,
  CommissionPaymentScheduleSource,
  CommissionPaymentScheduleStatus,
  CommissionRecordOriginStage,
  CommissionRecordStatus,
  CommissionReleaseRule,
  CommissionRuleBeneficiaryType,
  CommissionRuleBaseType,
};

/** Chaves em CommissionSettings (seed migration + runtime upsert). */
export const COMMISSION_SETTINGS_KEYS = {
  releaseDefaultRule: "release.default_rule",
  forecastEnabled: "forecast.enabled",
  outputDocumentSupersedesForecast: "output_document.supersedes_forecast",
  receivableAsDefinitiveReleaseSource: "receivable.definitive_release_source",
  paidCommissionBlockAutoChange: "paid_commission.block_auto_change",
  manualPaymentEnabled: "payment.manual_enabled",
  partialPaymentEnabled: "payment.partial_enabled",
  requireApprovalBeforePaid: "payment.require_approval_before_paid",
  auditOrderWithoutSeller: "audit.order_without_seller",
  auditOrderWithoutRepresentative: "audit.order_without_representative",
  auditNfeWithoutOutputDocument: "audit.nfe_without_output_document",
  auditNfeWithoutReceivable: "audit.nfe_without_receivable",
  auditPaidWithoutRelease: "audit.paid_without_release",
  calculateForSellers: "scope.calculate_sellers",
  calculateForRepresentatives: "scope.calculate_representatives",
  allowFixedPersonInRule: "scope.allow_fixed_person_in_rule",
} as const;

export type CommissionSettingsSnapshot = {
  releaseDefaultRule: CommissionReleaseRule;
  forecastEnabled: boolean;
  outputDocumentSupersedesForecast: boolean;
  receivableAsDefinitiveReleaseSource: boolean;
  paidCommissionBlockAutoChange: boolean;
  manualPaymentEnabled: boolean;
  partialPaymentEnabled: boolean;
  requireApprovalBeforePaid: boolean;
  auditOrderWithoutSeller: boolean;
  auditOrderWithoutRepresentative: boolean;
  auditNfeWithoutOutputDocument: boolean;
  auditNfeWithoutReceivable: boolean;
  auditPaidWithoutRelease: boolean;
  calculateForSellers: boolean;
  calculateForRepresentatives: boolean;
  allowFixedPersonInRule: boolean;
};

export type CommissionSettingsUpdateResult = CommissionSettingsSnapshot & {
  warnings: string[];
};

export type CommissionPeriodInput = {
  from?: Date;
  to?: Date;
  year?: number;
  month?: number;
};

export type CalculateCommissionsInput = CommissionPeriodInput & {
  mode: CommissionCalculationRunMode;
};

export type CommissionSellerInfo = {
  nomusSellerId: number | null;
  responsibleName: string | null;
};

export type CommissionRepresentativeInfo = {
  nomusRepresentativeId: number | null;
  name: string | null;
};

export type CommissionOrderInstallmentForecast = {
  installmentNumber: number;
  dueDate: Date | null;
  expectedAmount: number;
  paymentConditionExternalId: number | null;
};

export type CommissionOrderItemSource = {
  localItemId: string;
  nomusOrderItemId: number | null;
  nomusProductId: number | null;
  productCode: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  surcharge: number;
  itemNetAmount: number;
};

export type CommissionLinkedNfeSource = {
  nfeExternalId: number;
  nfeNumber: string | null;
  nfeStatus: number | null;
  tipoOperacao: number | null;
  dataProcessamento: Date | null;
  nfeValue: number;
  isAuthorized: boolean;
  isCancelled: boolean;
  isOutputOperation: boolean;
  nomusNfeLocalId: string | null;
};

export type CommissionOutputDocumentSource = {
  localMovementId: string;
  documentNumber: string | null;
  nfeExternalId: number | null;
  nfeNumber: string | null;
  salesOrderLocalId: string | null;
  movementDate: Date;
};

export type CommissionReceivableSource = {
  nomusReceivableId: number;
  nomusNfeId: number | null;
  installmentNumber: number | null;
  dueDate: Date | null;
  amountReceivable: number;
  amountReceived: number;
  balanceReceivable: number;
  settlementDate: Date | null;
};

export type CommissionOrderSourceBundle = {
  localOrderId: string;
  nomusOrderId: number | null;
  orderCode: string;
  issueDate: Date;
  status: string;
  paymentTerms: string | null;
  paymentMethod: string | null;
  companyExternalId: number | null;
  customerExternalId: number | null;
  customerName: string | null;
  seller: CommissionSellerInfo;
  representative: CommissionRepresentativeInfo;
  items: CommissionOrderItemSource[];
  forecastInstallments: CommissionOrderInstallmentForecast[];
  linkedNfes: CommissionLinkedNfeSource[];
  authorizedOutputNfes: CommissionLinkedNfeSource[];
  outputDocumentsByNfeId: Map<number, CommissionOutputDocumentSource[]>;
  receivablesByNfeId: Map<number, CommissionReceivableSource[]>;
};

export type CommissionRuleMatchContext = {
  referenceDate: Date;
  order: CommissionOrderSourceBundle;
  item: CommissionOrderItemSource;
  beneficiaryType: CommissionRuleBeneficiaryType;
  nomusSellerId: number | null;
  nomusRepresentativeId: number | null;
  commissionPersonId: string | null;
};

export type CommissionActiveRule = {
  id: string;
  name: string;
  active: boolean;
  priority: number;
  beneficiaryType: CommissionRuleBeneficiaryType;
  fixedCommissionPersonId: string | null;
  ratePercent: number;
  baseType: CommissionRuleBaseType;
  releaseRule: CommissionReleaseRule;
  validFrom: Date | null;
  validTo: Date | null;
  conditions: Array<{
    id: string;
    companyExternalId: number | null;
    customerExternalId: number | null;
    customerUf: string | null;
    nomusSellerId: number | null;
    nomusRepresentativeId: number | null;
    productExternalId: number | null;
    productGroupExternalId: number | null;
    priceTableExternalId: number | null;
    paymentConditionExternalId: number | null;
    movementTypeExternalId: number | null;
    minOrderAmount: number | null;
    maxOrderAmount: number | null;
    minDiscountPercent: number | null;
    maxDiscountPercent: number | null;
  }>;
};

export type CommissionRuleMatchResult = {
  rule: CommissionActiveRule;
  ratePercent: number;
  releaseRule: CommissionReleaseRule;
  baseType: CommissionRuleBaseType;
};

export type CommissionRecordDraft = {
  calculationHash: string;
  originStage: CommissionRecordOriginStage;
  status: CommissionRecordStatus;
  nomusOrderId: number | null;
  orderCode: string | null;
  nomusOrderItemId: number | null;
  nomusProductId: number | null;
  productCode: string | null;
  productName: string | null;
  nomusNfeId: number | null;
  nfeNumber: string | null;
  nomusOutputDocumentId: number | null;
  nomusOutputDocumentItemId: number | null;
  commissionPersonId: string;
  nomusSellerId: number | null;
  nomusRepresentativeId: number | null;
  customerExternalId: number | null;
  customerName: string | null;
  companyExternalId: number | null;
  baseAmount: number;
  ratePercent: number;
  commissionAmount: number;
  releaseRule: CommissionReleaseRule;
  confirmedAt: Date | null;
  metadataJson: Record<string, unknown> | null;
};

export type CommissionPaymentScheduleDraft = {
  scheduleKey: string;
  source: CommissionPaymentScheduleSource;
  status: CommissionPaymentScheduleStatus;
  nomusOrderId: number | null;
  nomusNfeId: number | null;
  nomusReceivableId: number | null;
  installmentNumber: number | null;
  dueDate: Date | null;
  expectedAmount: number | null;
  receivableAmount: number | null;
  receivedAmount: number | null;
  openBalance: number | null;
  allocationPercent: number | null;
  commissionExpectedAmount: number;
  commissionReleasedAmount?: number;
};

export type CommissionAuditIssueDraft = {
  issueKey: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  type: import("@prisma/client").CommissionAuditIssueType;
  entityType: string;
  entityId: string | null;
  message: string;
  metadataJson: Record<string, unknown> | null;
};

export type CommissionSettingsAuditFlags = Pick<
  CommissionSettingsSnapshot,
  | "auditOrderWithoutSeller"
  | "auditOrderWithoutRepresentative"
  | "auditNfeWithoutOutputDocument"
  | "auditNfeWithoutReceivable"
  | "auditPaidWithoutRelease"
>;

export type CommissionCalculationSummary = {
  ordersEvaluated: number;
  nfeEvaluated: number;
  outputDocumentsEvaluated: number;
  receivablesEvaluated: number;
  commissionsCreated: number;
  commissionsUpdated: number;
  commissionsSuperseded: number;
  errorsCount: number;
  issuesCreated: number;
  errors: string[];
};
