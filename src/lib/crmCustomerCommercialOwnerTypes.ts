export type CommercialOwnerAssignmentSource = "MANUAL" | "NOMUS_INFERRED" | "NONE";

export type ResolvedCustomerCommercialOwner = {
  source: CommercialOwnerAssignmentSource;
  sellerCanonicalName: string | null;
  sellerResponsibleName: string | null;
  sellerExternalId: number | null;
  sellerIdentityKey: string | null;
  sellerAliasExternalIds: number[];
  confidence: "HIGH" | "MEDIUM" | null;
  updatedAt: string | null;
  updatedByName: string | null;
};

export type CommercialOwnerAuditEntry = {
  performedAt: string;
  performedBy: string | null;
  previousLabel: string | null;
  newLabel: string | null;
  action: string;
};

export type ActiveCommercialSellerOption = {
  canonicalName: string;
  canonicalExternalSellerId: number | null;
  aliasExternalSellerIds: number[];
  sellerIdentityKey: string;
  responsible: string | null;
  confidence: "HIGH" | "MEDIUM";
  ordersCount: number;
  totalAmount: number;
  active: boolean;
  sublabel: string;
  optionKey: string;
};

export type CustomerCommercialOwnerPayload = {
  customerId: string;
  customerName: string;
  canEdit: boolean;
  owner: ResolvedCustomerCommercialOwner;
  manualAssignment: ResolvedCustomerCommercialOwner | null;
  inferredFromNomus: ResolvedCustomerCommercialOwner | null;
  auditHistory: CommercialOwnerAuditEntry[];
};
