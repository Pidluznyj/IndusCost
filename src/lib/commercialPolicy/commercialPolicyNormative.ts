/**
 * Política comercial viva: classifica mudança, congela o snapshot normativo,
 * reconcilia documento × sistema nos dois sentidos e impede publicar a
 * POL-COM-001 enquanto o documento divergir do que o IndusCost executa.
 *
 * A política NÃO é uma segunda fonte de verdade: a regra operacional continua
 * na sua fonte oficial (CommissionSettings, CommissionRule, rotina de
 * carteira). Aqui só se descreve, congela, versiona e evidencia.
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
  approval: string;
};

/** Anexo I da POL-COM-001 v1.0 como está no documento. Não é configuração do IndusCost. */
export const DOCUMENT_ANNEX_I_BANDS: CommissionMatrixBand[] = [
  { label: "Abaixo de 30,00%", commissionPercent: 0.01, approval: "Aprovação prévia da Diretoria" },
  { label: "30,00% a 34,99%", commissionPercent: 0.01, approval: "Aprovação prévia do Supervisor Comercial" },
  { label: "35,00% a 39,99%", commissionPercent: 0.02, approval: "Fluxo comercial ordinário" },
  { label: "40,00% a 49,99%", commissionPercent: 0.03, approval: "Fluxo comercial ordinário" },
  { label: "50,00% ou mais", commissionPercent: 0.04, approval: "Fluxo comercial ordinário" },
];

export const DOCUMENT_DECLARED_VERSION = "1.0";
/**
 * O DOCX oficial traz "versão 2.0" no Anexo III enquanto a capa diz 1.0
 * (DOCUMENT_INTERNAL_VERSION_MISMATCH). Por decisão registrada na tarefa de
 * publicação, a representação estruturada do IndusCost corrige o Anexo III
 * para 1.0; o fato de origem fica preservado aqui para a trilha de auditoria.
 */
export const DOCUMENT_SOURCE_ANNEX_III_VERSION = "2.0";
export const DOCUMENT_ANNEX_III_VERSION = "1.0";
export const DOCUMENT_SUPERVISOR_SHARE = 0.33;
export const DOCUMENT_INACTIVITY_DAYS = 90;

/**
 * Fatos confirmados no código. A matriz de margem do Anexo I não existe como
 * parâmetro (o motor usa CommissionRule.ratePercent por regra/faixa de
 * tabela de preço). A rotina de carteira (POL-COM-001 §11,
 * customerCommercialOwnerInactivity) remove o responsável exclusivo após 90
 * dias sem PV aprovado, salvo CRM estruturado válido. Os 33% do supervisor
 * não estão em CommissionSettings.
 */
export const SYSTEM_NORMATIVE_FACTS = {
  commissionMatrixParameterized: false,
  commissionMatrixSource: null as null,
  commissionEngineSource: "CommissionRule.ratePercent (regra/faixa de tabela de preço)",
  supervisorShareParameterized: false,
  portfolioInactivityRemovesResponsible: true,
  portfolioCrmEvidenceCanPreserveAssignment: true,
  portfolioSystemBehavior: "REVIEW_THEN_REMOVE_OR_PRESERVE" as const,
  portfolioInactivitySource: "customerCommercialOwnerInactivity (PV SENT_TO_NOMUS + CRM estruturado)",
  coverageParameterized: false,
  channelSlaParameterized: false,
  sellerAttribution: "SALES_ORDER_NOMUS_SELLER" as const,
  institutionalRegistry: "CommissionCustomerExclusionRule" as const,
  electronicGateAudience: "SELLER" as const,
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

/** Seções da POL-COM-001 v1.0 (numeração do documento oficial). */
export const POLICY_SECTIONS = {
  classification: "5",
  base: "6",
  matrix: "7 / Anexo I",
  coverage: "8",
  campaigns: "9 / Anexo II",
  portfolio: "10",
  inactivity: "11",
  transfer: "12",
  supervisor: "14",
  payment: "16",
  records: "19",
  crm: "20",
  forbidden: "22",
  confidentiality: "23",
  revision: "25",
} as const;

const DEPENDENCY_META: Record<
  NormativeChangeKind,
  { impact: NormativeImpact; section: string; label: string }
> = {
  "commission.matrix": { impact: "POLICY_VERSION_REQUIRED", section: POLICY_SECTIONS.matrix, label: "Matriz de comissão" },
  "commission.band": { impact: "POLICY_VERSION_REQUIRED", section: POLICY_SECTIONS.matrix, label: "Faixa de comissão" },
  "commission.releaseRule": { impact: "POLICY_VERSION_REQUIRED", section: POLICY_SECTIONS.payment, label: "Liberação da comissão" },
  "commission.supervisorShare": { impact: "POLICY_VERSION_REQUIRED", section: POLICY_SECTIONS.supervisor, label: "Remuneração do supervisor" },
  "portfolio.inactivityDays": { impact: "POLICY_VERSION_REQUIRED", section: POLICY_SECTIONS.inactivity, label: "Prazo de inatividade da carteira" },
  "portfolio.crmPreservation": { impact: "POLICY_VERSION_REQUIRED", section: POLICY_SECTIONS.inactivity, label: "Preservação por CRM" },
  "crm.requiredRule": { impact: "POLICY_VERSION_REQUIRED", section: POLICY_SECTIONS.crm, label: "Obrigatoriedade estrutural de CRM" },
  "pricing.methodology": { impact: "POLICY_VERSION_REQUIRED", section: POLICY_SECTIONS.matrix, label: "Metodologia normativa de preço" },
  "pricing.skuPrice": { impact: "OPERATIONAL_DATA", section: POLICY_SECTIONS.matrix, label: "Preço individual de SKU" },
  "customer.responsible": { impact: "OPERATIONAL_DATA", section: POLICY_SECTIONS.portfolio, label: "Responsável comercial do cliente" },
  "customer.institutionalMembership": {
    impact: "CONTROLLED_REFERENCE_CHANGED",
    section: POLICY_SECTIONS.classification,
    label: "Conta institucional específica",
  },
  "crm.contact": { impact: "OPERATIONAL_DATA", section: POLICY_SECTIONS.crm, label: "Contato de CRM" },
  "salesOrder.created": { impact: "OPERATIONAL_DATA", section: POLICY_SECTIONS.matrix, label: "Pedido de venda" },
  "salesOrder.seller": { impact: "OPERATIONAL_DATA", section: POLICY_SECTIONS.classification, label: "Vendedor do pedido" },
  "campaign.instance": { impact: "CONTROLLED_REFERENCE_CHANGED", section: POLICY_SECTIONS.campaigns, label: "Campanha específica" },
  "campaign.generalRule": { impact: "POLICY_VERSION_REQUIRED", section: POLICY_SECTIONS.campaigns, label: "Regra geral de campanha" },
  "coverage.rule": { impact: "TEXTUAL_NORMATIVE_RULE", section: POLICY_SECTIONS.coverage, label: "Cobertura" },
  "channel.sla": { impact: "TEXTUAL_NORMATIVE_RULE", section: POLICY_SECTIONS.coverage, label: "SLA de canal" },
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

/** ÚNICO ponto de classificação de impacto de uma mudança normativa/operacional. */
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

/* ------------------------------------------------------------------ */
/*  Integridade documento × sistema                                     */
/* ------------------------------------------------------------------ */

/**
 * BLOCKING: o documento exige comportamento objetivo e o sistema executa
 * outra coisa. WARNING: diferença de parametrização/processo sem falsidade
 * operacional direta. INFORMATIONAL: diferença documental não operacional.
 */
export type FindingSeverity = "BLOCKING" | "WARNING" | "INFORMATIONAL";

export type FindingCategory =
  | "DOCUMENTO"
  | "MATRIZ_COMISSAO"
  | "SUPERVISOR"
  | "LIBERACAO"
  | "CARTEIRA"
  | "ABRANGENCIA"
  | "COBERTURA"
  | "CAMPANHA"
  | "CLASSIFICACAO";

export type PrePublishFinding = {
  code: string;
  category: FindingCategory;
  policySection: string;
  severity: FindingSeverity;
  /** Derivado: só BLOCKING impede a publicação. */
  blocking: boolean;
  document: string;
  system: string;
  action: string;
};

export type ReconciliationStatus =
  | "ALINHADO"
  | "PARCIAL"
  | "TEXTO_NORMATIVO"
  | "PROCESSO_MANUAL"
  | "DIVERGENTE"
  | "NÃO_IMPLEMENTADO";

export type ReconciliationRow = {
  section: string;
  rule: string;
  implementation: string;
  status: ReconciliationStatus;
  severity: FindingSeverity | null;
  action: string;
  findingCode: string | null;
};

const RECEIVABLE_RELEASE_BASES = new Set(["EACH_RECEIVABLE_PAID"]);

function releaseIsProportionalToReceipt(snapshot: NormativeSnapshot): "ALIGNED" | "FULL_ONLY" | "MISMATCH" {
  if (!RECEIVABLE_RELEASE_BASES.has(snapshot.commissionRelease.basis)) return "MISMATCH";
  return snapshot.commissionRelease.mode === "PROPORTIONAL" ? "ALIGNED" : "FULL_ONLY";
}

function finding(input: Omit<PrePublishFinding, "blocking">): PrePublishFinding {
  return { ...input, blocking: input.severity === "BLOCKING" };
}

/**
 * Auditoria de publicação da POL-COM-001 v1.0 — documento → sistema e
 * sistema → documento. `current` é o snapshot normativo lido das fontes
 * oficiais (CommissionSettings etc.); sem ele, a liberação não é conferida
 * e vira WARNING explícito, nunca "alinhado" por omissão.
 */
export function auditPolCom001Publication(
  content: string,
  current?: NormativeSnapshot | null
): {
  ready: boolean;
  status: "NOT_READY_FOR_PUBLICATION" | "READY";
  findings: PrePublishFinding[];
  blockers: number;
  warnings: number;
  informational: number;
} {
  const findings: PrePublishFinding[] = [];

  if (content.includes("versão 2.0")) {
    findings.push(
      finding({
        code: "DECLARED_VERSION_MISMATCH",
        category: "DOCUMENTO",
        policySection: "Capa / Anexo III",
        severity: "BLOCKING",
        document: `Capa ${DOCUMENT_DECLARED_VERSION}; o teor ainda cita "versão 2.0".`,
        system: "A versão publicada precisa ser a mesma declarada em todo o teor (POL-COM-001 versão 1.0).",
        action: "Corrigir a representação estruturada para versão 1.0 antes de publicar.",
      })
    );
  }
  findings.push(
    finding({
      code: "DOCUMENT_INTERNAL_VERSION_MISMATCH",
      category: "DOCUMENTO",
      policySection: "Capa / Anexo III",
      severity: "INFORMATIONAL",
      document: `DOCX de origem: capa = ${DOCUMENT_DECLARED_VERSION}; Anexo III (Termo de Ciência) = ${DOCUMENT_SOURCE_ANNEX_III_VERSION}.`,
      system: `Representação oficial estruturada corrigida para versão ${DOCUMENT_ANNEX_III_VERSION} no Anexo III, por autorização registrada; nenhuma outra regra alterada.`,
      action: "Registrar a correção no relatório de publicação e na cópia controlada.",
    })
  );
  findings.push(
    finding({
      code: "COMMISSION_MATRIX_NOT_PARAMETERIZED",
      category: "MATRIZ_COMISSAO",
      policySection: POLICY_SECTIONS.matrix,
      severity: "BLOCKING",
      document: "Anexo I: comissão por faixa de Margem Oficial — abaixo de 30% = 1,00% (Diretoria); 30%–34,99% = 1,00% (Supervisor); 35%–39,99% = 2,00%; 40%–49,99% = 3,00%; 50,00% ou mais = 4,00%.",
      system: `Sem matriz de margem parametrizada. O motor executa ${SYSTEM_NORMATIVE_FACTS.commissionEngineSource}, não estas faixas.`,
      action: "Parametrizar a matriz por Margem Oficial no motor de comissão (ou revisar formalmente o Anexo I) antes de publicar.",
    })
  );
  findings.push(
    finding({
      code: "SUPERVISOR_SHARE_NOT_PARAMETERIZED",
      category: "SUPERVISOR",
      policySection: POLICY_SECTIONS.supervisor,
      severity: "BLOCKING",
      document: "Supervisor Comercial recebe 33% das comissões elegíveis dos Vendedores do time; parcela adicional, sem carteira própria e sem base em conta institucional sem comissão do vendedor.",
      system: "CommissionSettings não possui percentual de supervisor nem vínculo vendedor → supervisor para apuração.",
      action: "Parametrizar a remuneração do supervisor (33%, adicional) e o vínculo de time antes de publicar.",
    })
  );
  findings.push(
    finding({
      code: "PORTFOLIO_INACTIVITY_CONNECTED",
      category: "CARTEIRA",
      policySection: POLICY_SECTIONS.inactivity,
      severity: "INFORMATIONAL",
      document: "90 dias corridos sem novo Pedido de Venda aprovado = gatilho de revisão; com registro material válido no CRM o Responsável Comercial pode ser preservado; sem ele, a exclusividade é retirada automaticamente.",
      system: `${SYSTEM_NORMATIVE_FACTS.portfolioInactivitySource}: último SalesOrder SENT_TO_NOMUS (issueDate), preservação por CRM estruturado (PORTFOLIO_REVIEW_PRESERVED), baixa com INACTIVITY_90_DAYS e histórico em CrmCustomerPortfolioReview. Não usa faturamento, NF, CR ou AR.`,
      action: "Nenhuma. Manter a rotina como fonte oficial da regra da Seção 11.",
    })
  );

  if (!current) {
    findings.push(
      finding({
        code: "COMMISSION_RELEASE_UNVERIFIED",
        category: "LIBERACAO",
        policySection: POLICY_SECTIONS.payment,
        severity: "WARNING",
        document: "Comissões apuradas mensalmente e liberadas proporcionalmente à liquidação das parcelas pelo cliente.",
        system: "Snapshot normativo atual não informado nesta auditoria; a regra de liberação (CommissionSettings) não foi conferida.",
        action: "Auditar com o snapshot atual antes de publicar.",
      })
    );
  } else {
    const release = releaseIsProportionalToReceipt(current);
    findings.push(
      finding({
        code:
          release === "ALIGNED"
            ? "COMMISSION_RELEASE_ALIGNED"
            : release === "FULL_ONLY"
              ? "COMMISSION_RELEASE_NOT_PROPORTIONAL"
              : "COMMISSION_RELEASE_MISMATCH",
        category: "LIBERACAO",
        policySection: POLICY_SECTIONS.payment,
        severity: release === "ALIGNED" ? "INFORMATIONAL" : release === "FULL_ONLY" ? "WARNING" : "BLOCKING",
        document: "Comissões apuradas mensalmente e, quando permitido, liberadas proporcionalmente à liquidação dos valores devidos pelo cliente, parcela a parcela.",
        system: `CommissionSettings: base ${current.commissionRelease.basis}, modo ${current.commissionRelease.mode === "PROPORTIONAL" ? "proporcional ao recebimento" : "só com liquidação integral"}.`,
        action:
          release === "ALIGNED"
            ? "Nenhuma. Regra de liberação alinhada à Seção 16."
            : release === "FULL_ONLY"
              ? "Habilitar liberação proporcional (partialPaymentEnabled) ou revisar formalmente a Seção 16."
              : "Voltar a base de liberação para recebimento do cliente ou revisar formalmente a Seção 16 antes de publicar.",
      })
    );
  }

  findings.push(
    finding({
      code: "ELECTRONIC_GATE_AUDIENCE",
      category: "ABRANGENCIA",
      policySection: "2",
      severity: "WARNING",
      document: "Abrangência normativa: Vendedores, Executivos de Contas, Consultores Comerciais, funções equivalentes e a Supervisão Comercial. O documento não promete que todos assinam pelo sistema.",
      system: `O aceite eletrônico obrigatório cobre apenas o perfil ${SYSTEM_NORMATIVE_FACTS.electronicGateAudience}; os demais abrangidos assinam pelo Anexo III (termo físico) ou por decisão futura de ampliar o gate.`,
      action: "Decisão explícita da Diretoria/Administração sobre ampliar o gate; não bloqueia a publicação.",
    })
  );
  findings.push(
    finding({
      code: "COVERAGE_MANUAL_PROCESS",
      category: "COBERTURA",
      policySection: POLICY_SECTIONS.coverage,
      severity: "INFORMATIONAL",
      document: "Evento de Cobertura, ausência programada/não programada, venda iniciada × nova demanda, recorrentes/OEM, retorno do responsável, guarda-chuva, canais institucionais, SLA e solução de divergências (Seção 8 e Anexo IV).",
      system: "Regras de conduta e atribuição registradas no CRM (responsável comercial, contatos e propostas com registro material); não há automação que decida cobertura — processo manual controlado com rastreabilidade.",
      action: "Nenhuma para publicar: o documento não afirma execução automática. Manter o registro no CRM.",
    })
  );
  findings.push(
    finding({
      code: "CAMPAIGN_CONTROLLED_REFERENCE",
      category: "CAMPANHA",
      policySection: POLICY_SECTIONS.campaigns,
      severity: "INFORMATIONAL",
      document: "Campanha ou condição específica só vale com identificação, versão, vigência, escopo, alçada e comunicação prévia (Anexo II).",
      system: "Campanha específica é referência controlada (CONTROLLED_REFERENCE_CHANGED); a regra geral de campanhas é texto normativo e sua alteração abre revisão da política.",
      action: "Nenhuma para publicar.",
    })
  );
  findings.push(
    finding({
      code: "CUSTOMER_CLASSIFICATION_CONNECTED",
      category: "CLASSIFICACAO",
      policySection: POLICY_SECTIONS.classification,
      severity: "INFORMATIONAL",
      document: "Todo cliente é Cliente Comercial Comissionável ou Conta Institucional Não Comissionável, registrado no cadastro mestre.",
      system: `Registro oficial: ${SYSTEM_NORMATIVE_FACTS.institutionalRegistry} (Exceções por cliente do módulo de Comissões); a lista não é embutida na política.`,
      action: "Nenhuma para publicar.",
    })
  );

  const blockers = findings.filter((item) => item.severity === "BLOCKING").length;
  const warnings = findings.filter((item) => item.severity === "WARNING").length;
  const informational = findings.filter((item) => item.severity === "INFORMATIONAL").length;
  return {
    ready: blockers === 0,
    status: blockers === 0 ? "READY" : "NOT_READY_FOR_PUBLICATION",
    findings,
    blockers,
    warnings,
    informational,
  };
}

/** Publicação só é impedida por BLOCKING; WARNING e INFORMATIONAL não impedem. */
export function evaluatePublicationReadiness(findings: readonly PrePublishFinding[]): {
  ready: boolean;
  status: "NOT_READY_FOR_PUBLICATION" | "READY";
} {
  const blocked = findings.some((item) => item.severity === "BLOCKING");
  return { ready: !blocked, status: blocked ? "NOT_READY_FOR_PUBLICATION" : "READY" };
}

/** Matriz de reconciliação seção × regra × implementação (Ver divergências). */
export function buildPolCom001ReconciliationMatrix(current: NormativeSnapshot | null): ReconciliationRow[] {
  const audit = auditPolCom001Publication("", current);
  const byCode = new Map(audit.findings.map((item) => [item.code, item]));
  const release = byCode.get("COMMISSION_RELEASE_ALIGNED") ?? byCode.get("COMMISSION_RELEASE_NOT_PROPORTIONAL") ?? byCode.get("COMMISSION_RELEASE_MISMATCH") ?? byCode.get("COMMISSION_RELEASE_UNVERIFIED");
  return [
    {
      section: "Capa / Anexo III",
      rule: "Código POL-COM-001, versão 1.0 em todo o teor",
      implementation: "Capa 1.0; Anexo III corrigido de 2.0 para 1.0 na representação estruturada e na cópia controlada.",
      status: "ALINHADO",
      severity: "INFORMATIONAL",
      action: "Registrar a correção no relatório.",
      findingCode: "DOCUMENT_INTERNAL_VERSION_MISMATCH",
    },
    {
      section: POLICY_SECTIONS.classification,
      rule: "Cliente Comercial Comissionável × Conta Institucional Não Comissionável",
      implementation: "CommissionCustomerExclusionRule (Exceções por cliente) — registro oficial, fora do texto.",
      status: "ALINHADO",
      severity: "INFORMATIONAL",
      action: "Nenhuma.",
      findingCode: "CUSTOMER_CLASSIFICATION_CONNECTED",
    },
    {
      section: POLICY_SECTIONS.base,
      rule: "Base de cálculo: valor líquido comissionável do Item de Venda, sem impostos/frete conforme a regra",
      implementation: "Motor de comissão por item (commissionOrderCalculation) sobre o Pedido de Venda oficial.",
      status: "PARCIAL",
      severity: null,
      action: "Conferir na homologação a base exata contra a Seção 6.",
      findingCode: null,
    },
    {
      section: POLICY_SECTIONS.matrix,
      rule: "Matriz por Margem Oficial (Anexo I: 1% / 1% / 2% / 3% / 4%) e alçadas abaixo de 35%",
      implementation: "CommissionRule.ratePercent por regra/faixa de tabela de preço; sem faixa de margem e sem alçada automática.",
      status: "DIVERGENTE",
      severity: "BLOCKING",
      action: "Parametrizar a matriz por margem (ou revisar o Anexo I) antes de publicar.",
      findingCode: "COMMISSION_MATRIX_NOT_PARAMETERIZED",
    },
    {
      section: POLICY_SECTIONS.coverage,
      rule: "Cobertura, ausência, venda iniciada × nova demanda, recorrentes/OEM, retorno, guarda-chuva, canais institucionais, SLA",
      implementation: "Registro material no CRM (responsável, contatos, propostas); sem automação de atribuição.",
      status: "PROCESSO_MANUAL",
      severity: "INFORMATIONAL",
      action: "Nenhuma para publicar; o documento não promete execução automática.",
      findingCode: "COVERAGE_MANUAL_PROCESS",
    },
    {
      section: POLICY_SECTIONS.campaigns,
      rule: "Campanha só com identificação, vigência, escopo, alçada e comunicação prévia",
      implementation: "Campanha específica = referência controlada; regra geral = texto normativo.",
      status: "TEXTO_NORMATIVO",
      severity: "INFORMATIONAL",
      action: "Nenhuma para publicar.",
      findingCode: "CAMPAIGN_CONTROLLED_REFERENCE",
    },
    {
      section: POLICY_SECTIONS.portfolio,
      rule: "Carteira é ativo da empresa; Responsável Comercial é atribuição, não propriedade",
      implementation: "CrmCustomerCommercialOwner (dono manual ativo) separado do vendedor do pedido (SALES_ORDER_NOMUS_SELLER).",
      status: "ALINHADO",
      severity: null,
      action: "Nenhuma.",
      findingCode: null,
    },
    {
      section: POLICY_SECTIONS.inactivity,
      rule: "90 dias sem novo PV aprovado → revisão; CRM material válido preserva; sem CRM, retirada automática da exclusividade",
      implementation: SYSTEM_NORMATIVE_FACTS.portfolioInactivitySource + ", job agendado, histórico em CrmCustomerPortfolioReview.",
      status: "ALINHADO",
      severity: "INFORMATIONAL",
      action: "Nenhuma.",
      findingCode: "PORTFOLIO_INACTIVITY_CONNECTED",
    },
    {
      section: POLICY_SECTIONS.supervisor,
      rule: "Supervisor recebe 33% das comissões elegíveis do time; parcela adicional",
      implementation: "Não parametrizado em CommissionSettings; sem vínculo de time.",
      status: "NÃO_IMPLEMENTADO",
      severity: "BLOCKING",
      action: "Parametrizar 33% adicional e o vínculo vendedor → supervisor antes de publicar.",
      findingCode: "SUPERVISOR_SHARE_NOT_PARAMETERIZED",
    },
    {
      section: POLICY_SECTIONS.payment,
      rule: "Apuração mensal; liberação proporcional à liquidação das parcelas",
      implementation: release?.system ?? "Não conferido.",
      status: release?.severity === "INFORMATIONAL" ? "ALINHADO" : release?.severity === "WARNING" ? "PARCIAL" : "DIVERGENTE",
      severity: release?.severity ?? "WARNING",
      action: release?.action ?? "Auditar com o snapshot atual.",
      findingCode: release?.code ?? null,
    },
    {
      section: "2",
      rule: "Abrangência: vendedores, executivos, consultores, equivalentes e supervisão",
      implementation: "Gate eletrônico obrigatório só para SELLER; demais abrangidos pelo termo físico (Anexo III).",
      status: "PARCIAL",
      severity: "WARNING",
      action: "Decidir explicitamente a ampliação do gate; não bloqueia.",
      findingCode: "ELECTRONIC_GATE_AUDIENCE",
    },
    {
      section: POLICY_SECTIONS.forbidden,
      rule: "Condutas vedadas (Seção 22) integrais no documento, na prévia, no PDF e no aceite",
      implementation: "Texto integral no snapshot estruturado; questionário cobre a seção.",
      status: "TEXTO_NORMATIVO",
      severity: null,
      action: "Nenhuma.",
      findingCode: null,
    },
    {
      section: POLICY_SECTIONS.confidentiality,
      rule: "Documento controlado, uso interno e restrito; acesso eletrônico não o torna público",
      implementation: "Acesso só autenticado; cópia controlada com marca d'água, destinatário e código; sem rota pública.",
      status: "ALINHADO",
      severity: null,
      action: "Nenhuma.",
      findingCode: null,
    },
    {
      section: POLICY_SECTIONS.revision,
      rule: "Revisão por nova versão formal, com descrição do que mudou, aprovação, vigência e comunicação; sem efeito retroativo",
      implementation: "Versões imutáveis, snapshot normativo + changeset com hash, rascunho único por revisão, effectiveFrom prospectivo, novo aceite por versão.",
      status: "ALINHADO",
      severity: null,
      action: "Nenhuma.",
      findingCode: null,
    },
  ];
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

/** Sistema → documento: o rascunho descreve o estado atual? */
export function compareDraftToCurrentNormativeState(input: {
  draftSnapshotHash: string | null;
  current: NormativeSnapshot;
}): "DRAFT_IN_SYNC" | "DRAFT_STALE" | "DRAFT_WITHOUT_SNAPSHOT" {
  if (!input.draftSnapshotHash) return "DRAFT_WITHOUT_SNAPSHOT";
  return normativeSnapshotHash(input.current) === input.draftSnapshotHash ? "DRAFT_IN_SYNC" : "DRAFT_STALE";
}

/* ------------------------------------------------------------------ */
/*  Revisão normativa (rascunho da próxima versão)                      */
/* ------------------------------------------------------------------ */

/** Aplica ao snapshot só o que possui fonte operacional oficial; regra não parametrizada fica só no changeset. */
export function applyNormativeChangeToSnapshot(
  snapshot: NormativeSnapshot,
  kind: NormativeChangeKind,
  newValue: unknown
): NormativeSnapshot {
  const next = structuredClone(snapshot);
  if (kind === "commission.releaseRule" && typeof newValue === "string") {
    next.commissionRelease.basis = newValue;
  }
  if (kind === "portfolio.inactivityDays" && typeof newValue === "number" && Number.isFinite(newValue)) {
    next.portfolio.inactivityDays = newValue;
  }
  return next;
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
  /** Rascunho pendente: as mudanças novas são agregadas a ele, nunca sobrescritas. */
  existingDraft?: { changeSet: PolicyChange[]; snapshot: NormativeSnapshot | null } | null;
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
  const nextLabel = nextRevisionLabel(input.currentLabel);
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
    sourceVersionNew: nextLabel,
    impact: meta.impact,
  };
  const previous = input.existingDraft?.changeSet ?? [];
  const sameChange = previous.some(
    (item) =>
      item.dependencyKey === change.dependencyKey &&
      stableStringify(item.newValue) === stableStringify(change.newValue) &&
      stableStringify(item.oldValue) === stableStringify(change.oldValue)
  );
  const baseSnapshot = input.existingDraft?.snapshot ?? input.currentSnapshot;
  const nextSnapshot = applyNormativeChangeToSnapshot(baseSnapshot, input.kind, input.newValue);
  const changeSet = sameChange
    ? previous
    : [...previous.filter((item) => item.dependencyKey !== change.dependencyKey), change];
  const hash = changeSetHash(changeSet);
  return {
    impact: meta.impact,
    draftRequired: true,
    duplicate: sameChange || input.existingDraftChangeSetHash === hash,
    nextLabel,
    changeSet,
    changeSetHash: hash,
    snapshot: sameChange ? baseSnapshot : nextSnapshot,
    snapshotHash: normativeSnapshotHash(sameChange ? baseSnapshot : nextSnapshot),
  };
}

export function nextRevisionLabel(current: string): string {
  const trimmed = current.trim();
  const dotted = /^(\d+)\.(\d+)$/.exec(trimmed);
  if (dotted) return `${dotted[1]}.${Number(dotted[2]) + 1}`;
  if (/^\d+$/.test(trimmed)) return `${trimmed}.1`;
  return trimmed;
}

export function formatWhatChanged(changes: PolicyChange[], nextLabel: string, previousLabel: string): string[] {
  if (changes.length === 0) return ["Sem alteração normativa nesta versão."];
  const lines = [`POLÍTICA COMERCIAL ${nextLabel}`, `Alterações desde a versão ${previousLabel}`];
  for (const change of changes) {
    lines.push(
      `${change.humanLabel} (Seção ${change.policySection})`,
      `Anterior: ${change.oldDisplayValue}`,
      `Novo: ${change.newDisplayValue}`
    );
  }
  return lines;
}

/** Seções cujo texto precisa de revisão assistida quando o changeset as toca. */
export function sectionsAffectedByChanges(changes: readonly PolicyChange[]): string[] {
  return [...new Set(changes.map((change) => change.policySection))];
}

export function questionsForRevision<T extends { id: string }>(
  questions: T[],
  changes: PolicyChange[]
): T[] {
  if (changes.length === 0) return questions;
  const sections = new Set(changes.map((change) => change.policySection));
  const focused = questions.filter((question) => {
    if (sections.has(POLICY_SECTIONS.matrix) || sections.has(POLICY_SECTIONS.payment)) {
      return question.id === "q-historico" || question.id === "q-noventa" || question.id === "q-matriz";
    }
    if (sections.has(POLICY_SECTIONS.inactivity)) return question.id === "q-noventa" || question.id === "q-carteira";
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
