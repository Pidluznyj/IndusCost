/**
 * Política comercial viva: classifica mudança, congela o snapshot normativo
 * e impede publicar a POL-COM-001 enquanto o documento divergir do que o
 * IndusCost executa. Não copia percentual para uma segunda fonte de verdade.
 */

import { sha256Hex, stableStringify } from "./commercialPolicyRules.js";

export type NormativeImpact =
  | "POLICY_VERSION_REQUIRED"
  | "CONTROLLED_REFERENCE_CHANGED"
  | "OPERATIONAL_DATA"
  | "TEXTUAL_NORMATIVE_RULE";

export type IntegrityStatus =
  | "IN_SYNC"
  | "POLICY_UPDATE_REQUIRED"
  | "CONTROLLED_REFERENCE_CHANGED"
  | "INVALID_CONFIGURATION"
  | "POLICY_SYSTEM_MISMATCH"
  | "NOT_READY_FOR_PUBLICATION";

export type NormativeChangeKind =
  | "commission.matrix"
  | "commission.band"
  | "commission.releaseRule"
  | "commission.supervisorShare"
  | "portfolio.inactivityDays"
  | "portfolio.crmPreservation"
  | "crm.requiredRule"
  | "pricing.methodology"
  | "pricing.skuPrice"
  | "customer.responsible"
  | "customer.institutionalMembership"
  | "crm.contact"
  | "salesOrder.created"
  | "salesOrder.seller"
  | "campaign.instance"
  | "campaign.generalRule"
  | "coverage.rule"
  | "channel.sla"
  | "technical.nonNormative";

export type PolicyChange = {
  dependencyKey: string;
  humanLabel: string;
  policySection: string;
  oldValue: unknown;
  newValue: unknown;
  oldDisplayValue: string;
  newDisplayValue: string;
  reason: string;
  changedBy: string;
  changedAt: string;
  sourceVersionOld: string | null;
  sourceVersionNew: string | null;
  impact: NormativeImpact;
};

export type CommissionMatrixBand = {
  label: string;
  commissionPercent: number;
};

/** Alegação do documento recebido. Não é configuração do IndusCost. */
export const DOCUMENT_ANNEX_I_BANDS: CommissionMatrixBand[] = [
  { label: "Abaixo de 30%", commissionPercent: 0.01 },
  { label: "30% a 34,99%", commissionPercent: 0.01 },
  { label: "35% a 39,99%", commissionPercent: 0.02 },
  { label: "40% a 49,99%", commissionPercent: 0.03 },
  { label: "50% ou mais", commissionPercent: 0.04 },
];

export const DOCUMENT_DECLARED_VERSION = "1.0";
export const DOCUMENT_ANNEX_III_VERSION = "2.0";
export const DOCUMENT_SUPERVISOR_SHARE = 0.33;
export const DOCUMENT_INACTIVITY_DAYS = 90;

/**
 * Fatos confirmados no código. A matriz de margem do Anexo I não existe como
 * parâmetro. A rotina mensal de carteira (POL-COM-001 §11) remove o responsável
 * exclusivo após 90 dias sem PV com NF / Documento de Saída válido, salvo CRM
 * válido. O texto da POL-COM-001 v1.0 ainda fala em “PV aprovado”; essa
 * divergência exige nova versão da política. Os 33% do
 * supervisor não estão em CommissionSettings.
 */
export const SYSTEM_NORMATIVE_FACTS = {
  commissionMatrixParameterized: false,
  commissionMatrixSource: null as null,
  supervisorShareParameterized: false,
  portfolioInactivityRemovesResponsible: true,
  portfolioCrmEvidenceCanPreserveAssignment: true,
  portfolioSystemBehavior: "REVIEW_THEN_REMOVE_OR_PRESERVE" as const,
  coverageParameterized: false,
  channelSlaParameterized: false,
  sellerAttribution: "SALES_ORDER_NOMUS_SELLER" as const,
  institutionalRegistry: "CommissionCustomerExclusionRule" as const,
} as const;

export type NormativeSnapshot = {
  commissionMatrix: {
    parameterized: false;
    source: null;
    bands: null;
  };
  supervisorCommission: {
    parameterized: false;
    share: null;
  };
  commissionRelease: {
    parameterized: true;
    basis: string;
    mode: "PROPORTIONAL" | "FULL";
    source: "CommissionSettings";
  };
  portfolio: {
    parameterized: true;
    inactivityDays: number;
    crmEvidenceCanPreserveAssignment: true;
    systemBehavior: "REVIEW_THEN_REMOVE_OR_PRESERVE";
  };
  pricing: {
    parameterized: false;
    normativeVersionId: null;
  };
  customerClassification: {
    parameterized: true;
    registry: "CommissionCustomerExclusionRule";
    embeddedListInPolicy: false;
  };
  crm: {
    parameterized: false;
    materialRecordRequired: null;
  };
  sellerAttribution: {
    parameterized: true;
    rule: "SALES_ORDER_NOMUS_SELLER";
    separateFromCommercialResponsible: true;
  };
  coverage: { parameterized: false; kind: "TEXTUAL_NORMATIVE_RULE" };
  channelSla: { parameterized: false; kind: "TEXTUAL_NORMATIVE_RULE" };
};

export type ReleaseNormativeInput = {
  releaseDefaultRule: string;
  partialPaymentEnabled: boolean;
};

const DEPENDENCY_META: Record<
  NormativeChangeKind,
  { impact: NormativeImpact; section: string; label: string }
> = {
  "commission.matrix": { impact: "POLICY_VERSION_REQUIRED", section: "7 / Anexo I", label: "Matriz de comissão" },
  "commission.band": { impact: "POLICY_VERSION_REQUIRED", section: "7 / Anexo I", label: "Faixa de comissão" },
  "commission.releaseRule": { impact: "POLICY_VERSION_REQUIRED", section: "14", label: "Liberação da comissão" },
  "commission.supervisorShare": { impact: "POLICY_VERSION_REQUIRED", section: "12", label: "Remuneração do supervisor" },
  "portfolio.inactivityDays": { impact: "POLICY_VERSION_REQUIRED", section: "11", label: "Prazo de inatividade da carteira" },
  "portfolio.crmPreservation": { impact: "POLICY_VERSION_REQUIRED", section: "11", label: "Preservação por CRM" },
  "crm.requiredRule": { impact: "POLICY_VERSION_REQUIRED", section: "9", label: "Obrigatoriedade estrutural de CRM" },
  "pricing.methodology": { impact: "POLICY_VERSION_REQUIRED", section: "7", label: "Metodologia normativa de preço" },
  "pricing.skuPrice": { impact: "OPERATIONAL_DATA", section: "7", label: "Preço individual de SKU" },
  "customer.responsible": { impact: "OPERATIONAL_DATA", section: "10", label: "Responsável comercial do cliente" },
  "customer.institutionalMembership": {
    impact: "CONTROLLED_REFERENCE_CHANGED",
    section: "6",
    label: "Conta institucional específica",
  },
  "crm.contact": { impact: "OPERATIONAL_DATA", section: "9", label: "Contato de CRM" },
  "salesOrder.created": { impact: "OPERATIONAL_DATA", section: "7", label: "Pedido de venda" },
  "salesOrder.seller": { impact: "OPERATIONAL_DATA", section: "5", label: "Vendedor do pedido" },
  "campaign.instance": { impact: "CONTROLLED_REFERENCE_CHANGED", section: "13", label: "Campanha específica" },
  "campaign.generalRule": { impact: "POLICY_VERSION_REQUIRED", section: "13", label: "Regra geral de campanha" },
  "coverage.rule": { impact: "TEXTUAL_NORMATIVE_RULE", section: "8", label: "Cobertura" },
  "channel.sla": { impact: "TEXTUAL_NORMATIVE_RULE", section: "8", label: "SLA de canal" },
  "technical.nonNormative": { impact: "OPERATIONAL_DATA", section: "—", label: "Alteração técnica" },
};

export const COMMERCIAL_POLICY_DEPENDENCIES = (Object.keys(DEPENDENCY_META) as NormativeChangeKind[]).map(
  (key) => ({
    key,
    impact: DEPENDENCY_META[key].impact,
    section: DEPENDENCY_META[key].section,
    humanLabel: DEPENDENCY_META[key].label,
  })
);

export function classifyCommercialChange(kind: NormativeChangeKind): NormativeImpact {
  return DEPENDENCY_META[kind].impact;
}

export function buildCurrentCommercialPolicyNormativeSnapshot(
  release: ReleaseNormativeInput
): NormativeSnapshot {
  return {
    commissionMatrix: { parameterized: false, source: null, bands: null },
    supervisorCommission: { parameterized: false, share: null },
    commissionRelease: {
      parameterized: true,
      basis: release.releaseDefaultRule,
      mode: release.partialPaymentEnabled ? "PROPORTIONAL" : "FULL",
      source: "CommissionSettings",
    },
    portfolio: {
      parameterized: true,
      inactivityDays: DOCUMENT_INACTIVITY_DAYS,
      crmEvidenceCanPreserveAssignment: true,
      systemBehavior: SYSTEM_NORMATIVE_FACTS.portfolioSystemBehavior,
    },
    pricing: { parameterized: false, normativeVersionId: null },
    customerClassification: {
      parameterized: true,
      registry: SYSTEM_NORMATIVE_FACTS.institutionalRegistry,
      embeddedListInPolicy: false,
    },
    crm: { parameterized: false, materialRecordRequired: null },
    sellerAttribution: {
      parameterized: true,
      rule: SYSTEM_NORMATIVE_FACTS.sellerAttribution,
      separateFromCommercialResponsible: true,
    },
    coverage: { parameterized: false, kind: "TEXTUAL_NORMATIVE_RULE" },
    channelSla: { parameterized: false, kind: "TEXTUAL_NORMATIVE_RULE" },
  };
}

export function normativeSnapshotHash(snapshot: NormativeSnapshot): string {
  return sha256Hex(stableStringify(snapshot));
}

export function changeSetHash(changes: PolicyChange[]): string {
  return sha256Hex(stableStringify(changes));
}

export function blockedNormativeCommissionSettingChanges(
  current: ReleaseNormativeInput & { receivableAsDefinitiveReleaseSource?: boolean },
  next: ReleaseNormativeInput & { receivableAsDefinitiveReleaseSource?: boolean }
): string[] {
  const blocked: string[] = [];
  if (current.releaseDefaultRule !== next.releaseDefaultRule) blocked.push("releaseDefaultRule");
  if (current.partialPaymentEnabled !== next.partialPaymentEnabled) blocked.push("partialPaymentEnabled");
  if (current.receivableAsDefinitiveReleaseSource !== next.receivableAsDefinitiveReleaseSource) {
    blocked.push("receivableAsDefinitiveReleaseSource");
  }
  return blocked;
}

export function renderCommissionMatrixLines(snapshot: NormativeSnapshot): string[] {
  if (snapshot.commissionMatrix.parameterized) {
    return ["Anexo I vinculado ao snapshot desta versão."];
  }
  return ["Anexo I: matriz normativa não parametrizada no IndusCost. O texto congelado desta versão permanece o documento."];
}

export type PrePublishFinding = {
  code: string;
  blocking: boolean;
  document: string;
  system: string;
};

export function auditPolCom001Publication(content: string): {
  ready: boolean;
  status: "NOT_READY_FOR_PUBLICATION" | "READY";
  findings: PrePublishFinding[];
} {
  const findings: PrePublishFinding[] = [];
  if (content.includes("versão 2.0")) {
    findings.push({
      code: "DECLARED_VERSION_MISMATCH",
      blocking: true,
      document: `Capa ${DOCUMENT_DECLARED_VERSION}; Anexo III cita versão ${DOCUMENT_ANNEX_III_VERSION}.`,
      system: "A versão publicada precisa ser a mesma declarada no teor.",
    });
  }
  findings.push({
    code: "COMMISSION_MATRIX_NOT_PARAMETERIZED",
    blocking: true,
    document: "Anexo I: 50% ou mais = 4,00%.",
    system: "Sem matriz de margem em CommissionSettings. O motor usa CommissionRule.ratePercent por regra, não estas faixas.",
  });
  findings.push({
    code: "SUPERVISOR_SHARE_NOT_PARAMETERIZED",
    blocking: true,
    document: "Supervisor recebe 33% das comissões elegíveis do time.",
    system: "CommissionSettings não possui percentual de supervisor.",
  });
  findings.push({
    code: "PORTFOLIO_INACTIVITY_MISMATCH",
    blocking: true,
    document: "90 dias corridos sem novo Pedido de Venda aprovado e sem CRM válido removem o responsável exclusivo.",
    system:
      "Rotina mensal customerCommercialOwnerInactivity: relógio = última NF / Documento de Saída válido (SalesOrderNfeLink → NomusNfe status 4, não cancelada, xmlDhEmi/dataProcessamento; NomusStockDocument não cancelado). SENT_TO_NOMUS + issueDate não reinicia. NEVER_INVOICED não remove. Preservação por CRM estruturado (sem Proposal.updatedAt sozinho). Baixa INACTIVITY_90_DAYS. Exige POLICY_VERSION_REQUIRED até republicar a §11.",
  });
  findings.push({
    code: "ELECTRONIC_GATE_AUDIENCE",
    blocking: true,
    document: "A abrangência material inclui funções comerciais e supervisão.",
    system: "O gate eletrônico obriga apenas o perfil SELLER. O texto original não foi alterado; a publicação exige ajuste documental explícito.",
  });
  const blocking = findings.some((item) => item.blocking);
  return {
    ready: !blocking,
    status: blocking ? "NOT_READY_FOR_PUBLICATION" : "READY",
    findings,
  };
}

export function comparePublishedPolicyToCurrentNormativeState(input: {
  publishedHash: string | null;
  current: NormativeSnapshot;
  publicationAuditBlocking: boolean;
}): IntegrityStatus {
  if (input.publicationAuditBlocking) return "POLICY_SYSTEM_MISMATCH";
  if (!input.publishedHash) return "INVALID_CONFIGURATION";
  const currentHash = normativeSnapshotHash(input.current);
  if (currentHash !== input.publishedHash) return "POLICY_UPDATE_REQUIRED";
  return "IN_SYNC";
}

export function planPolicyRevision(input: {
  kind: NormativeChangeKind;
  currentLabel: string;
  currentSnapshot: NormativeSnapshot;
  oldValue: unknown;
  newValue: unknown;
  oldDisplayValue: string;
  newDisplayValue: string;
  reason: string;
  changedBy: string;
  changedAt: string;
  existingDraftChangeSetHash?: string | null;
}): {
  impact: NormativeImpact;
  draftRequired: boolean;
  duplicate: boolean;
  nextLabel: string | null;
  changeSet: PolicyChange[];
  changeSetHash: string | null;
  snapshot: NormativeSnapshot;
  snapshotHash: string;
} {
  const meta = DEPENDENCY_META[input.kind];
  const snapshotHash = normativeSnapshotHash(input.currentSnapshot);
  if (meta.impact !== "POLICY_VERSION_REQUIRED") {
    return {
      impact: meta.impact,
      draftRequired: false,
      duplicate: false,
      nextLabel: null,
      changeSet: [],
      changeSetHash: null,
      snapshot: input.currentSnapshot,
      snapshotHash,
    };
  }
  const nextSnapshot = structuredClone(input.currentSnapshot);
  if (input.kind === "commission.releaseRule" && typeof input.newValue === "string") {
    nextSnapshot.commissionRelease.basis = input.newValue;
  }
  const change: PolicyChange = {
    dependencyKey: input.kind,
    humanLabel: meta.label,
    policySection: meta.section,
    oldValue: input.oldValue,
    newValue: input.newValue,
    oldDisplayValue: input.oldDisplayValue,
    newDisplayValue: input.newDisplayValue,
    reason: input.reason,
    changedBy: input.changedBy,
    changedAt: input.changedAt,
    sourceVersionOld: input.currentLabel,
    sourceVersionNew: nextRevisionLabel(input.currentLabel),
    impact: meta.impact,
  };
  const changeSet = [change];
  const hash = changeSetHash(changeSet);
  return {
    impact: meta.impact,
    draftRequired: true,
    duplicate: input.existingDraftChangeSetHash === hash,
    nextLabel: nextRevisionLabel(input.currentLabel),
    changeSet,
    changeSetHash: hash,
    snapshot: nextSnapshot,
    snapshotHash: normativeSnapshotHash(nextSnapshot),
  };
}

export function nextRevisionLabel(current: string): string {
  const match = /^(\d+)\.(\d+)$/.exec(current.trim());
  if (!match) return current;
  return `${match[1]}.${Number(match[2]) + 1}`;
}

export function formatWhatChanged(changes: PolicyChange[], nextLabel: string, previousLabel: string): string[] {
  if (changes.length === 0) return ["Sem alteração normativa nesta versão."];
  const lines = [`POLÍTICA COMERCIAL ${nextLabel}`, `Alterações desde a versão ${previousLabel}`];
  for (const change of changes) {
    lines.push(change.humanLabel, `Anterior: ${change.oldDisplayValue}`, `Novo: ${change.newDisplayValue}`);
  }
  return lines;
}

export function questionsForRevision<T extends { id: string }>(
  questions: T[],
  changes: PolicyChange[]
): T[] {
  if (changes.length === 0) return questions;
  const sections = new Set(changes.map((change) => change.policySection));
  const focused = questions.filter((question) => {
    if (sections.has("7 / Anexo I") || sections.has("14")) {
      return question.id === "q-historico" || question.id === "q-noventa";
    }
    if (sections.has("11")) return question.id === "q-noventa" || question.id === "q-carteira";
    return true;
  });
  return focused.length > 0 ? focused : questions;
}

export function canApplyNormativeValue(input: {
  policyStatus: "DRAFT" | "PUBLISHED" | "RETIRED";
  effectiveFrom: Date;
  now: Date;
}): boolean {
  return input.policyStatus === "PUBLISHED" && input.effectiveFrom.getTime() <= input.now.getTime();
}

export function buildTransitionSnapshot(input: {
  asOf: string;
  release: ReleaseNormativeInput;
  institutionalCustomerIds?: string[];
  openOpportunityIds?: string[];
}): {
  asOf: string;
  commissionMatrix: null;
  institutionalRegistry: "CommissionCustomerExclusionRule";
  institutionalCustomerIds: string[];
  openOpportunityIds: string[];
  releaseBasis: string;
  coverage: "NOT_YET_SYSTEM_PARAMETERIZED";
  channelSla: "NOT_YET_SYSTEM_PARAMETERIZED";
} {
  return {
    asOf: input.asOf,
    commissionMatrix: null,
    institutionalRegistry: "CommissionCustomerExclusionRule",
    institutionalCustomerIds: input.institutionalCustomerIds ?? [],
    openOpportunityIds: input.openOpportunityIds ?? [],
    releaseBasis: input.release.releaseDefaultRule,
    coverage: "NOT_YET_SYSTEM_PARAMETERIZED",
    channelSla: "NOT_YET_SYSTEM_PARAMETERIZED",
  };
}

export const POLICY_SYSTEM_MATRIX = [
  { section: "7 / Anexo I", rule: "Faixas de comissão", source: "Não parametrizado", type: "NORMATIVE", versionable: false, impact: "POLICY_VERSION_REQUIRED", status: "POLICY_SYSTEM_MISMATCH" },
  { section: "12", rule: "33% do supervisor", source: "Não parametrizado", type: "NORMATIVE", versionable: false, impact: "POLICY_VERSION_REQUIRED", status: "POLICY_SYSTEM_MISMATCH" },
  { section: "11", rule: "90 dias e CRM", source: "customerCommercialOwnerInactivity (NF/DS válido + CRM estruturado; documento v1.0 ainda cita PV aprovado)", type: "NORMATIVE", versionable: true, impact: "POLICY_VERSION_REQUIRED", status: "POLICY_SYSTEM_MISMATCH" },
  { section: "14", rule: "Liberação por recebimento", source: "CommissionSettings.release.default_rule", type: "NORMATIVE", versionable: true, impact: "POLICY_VERSION_REQUIRED", status: "CONNECTED" },
  { section: "5", rule: "Vendedor do pedido", source: "salesOrder.nomusSeller", type: "NORMATIVE", versionable: false, impact: "POLICY_VERSION_REQUIRED", status: "CONNECTED" },
  { section: "6", rule: "Conta institucional", source: "CommissionCustomerExclusionRule", type: "CONTROLLED_REFERENCE", versionable: true, impact: "CONTROLLED_REFERENCE_CHANGED", status: "CONNECTED" },
  { section: "8", rule: "Cobertura", source: "Texto da política", type: "TEXTUAL_NORMATIVE", versionable: false, impact: "TEXTUAL_NORMATIVE_RULE", status: "TEXT_ONLY" },
  { section: "8", rule: "SLA de canal", source: "Texto da política", type: "TEXTUAL_NORMATIVE", versionable: false, impact: "TEXTUAL_NORMATIVE_RULE", status: "TEXT_ONLY" },
] as const;
