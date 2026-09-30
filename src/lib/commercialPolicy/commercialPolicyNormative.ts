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
import { parsePolicyChapters } from "./policyDocumentFormat.js";
import { isCommissionMatrixHeader } from "./policyAutoFields.js";

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

/**
 * Anexo I do DOCX ORIGINAL da POL-COM-001 (degraus por faixa de Margem Oficial).
 * Registro histórico: a candidata v1.0 não usa mais esta tabela — o Anexo I
 * mostra os níveis comerciais da Formação de Preço (o sistema é a fonte da
 * verdade). Continua servindo para auditar conteúdos que ainda tragam degraus.
 */
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
 * Faixa comercial da Formação de Preço (Atacado / Varejo 1–3): margem-alvo e
 * comissão gravadas na versão PUBLICADA e vigente da tabela de preço. É o que
 * o motor de comissão lê quando a regra ativa é "Faixa comercial".
 */
export type SystemCommissionTier = {
  code: string;
  name: string;
  marginPercent: number;
  commissionPercent: number;
};

/** Matriz lida das fontes oficiais (tabelas de preço publicadas + regras de comissão). */
export type CommissionMatrixInput = {
  tiers: SystemCommissionTier[];
  /** Comissão paga quando o preço vendido fica abaixo do Atacado. */
  outOfTableCommissionPercent: number;
  /** Existe regra de comissão ativa do tipo "Faixa comercial" (COMMERCIAL_PRICE_TIER). */
  engineRuleActive: boolean;
};

/**
 * Fatos confirmados no código. A matriz de comissão vem da Formação de Preço
 * (margem-alvo e comissão por tabela publicada), lida em runtime; o motor
 * interpola o percentual entre níveis pelo preço vendido. A rotina de carteira (POL-COM-001 §11,
 * customerCommercialOwnerInactivity) remove o responsável exclusivo após 90
 * dias sem NF / Documento de Saída válido, salvo CRM estruturado válido; cliente
 * nunca faturado não é removido. Os 33% do supervisor são regra empresarial
 * apurada por processo administrativo, fora do motor (decisão de 30/09/2026).
 */
export const SYSTEM_NORMATIVE_FACTS = {
  commissionMatrixSource: "PriceTableVersion publicada (Formação de Preço): margem-alvo e comissão por tabela",
  commissionEngineSource: "regra de comissão \"Faixa comercial\" → PriceTableItem.commissionPerc das tabelas publicadas, interpolado pelo preço vendido",
  supervisorShareParameterized: false,
  portfolioInactivityRemovesResponsible: true,
  portfolioCrmEvidenceCanPreserveAssignment: true,
  portfolioSystemBehavior: "REVIEW_THEN_REMOVE_OR_PRESERVE" as const,
  portfolioInactivitySource: "customerCommercialOwnerInactivity (NF / Documento de Saída válido + CRM estruturado)",
  portfolioInactivityClock: "LAST_VALID_INVOICE" as const,
  coverageParameterized: false,
  channelSlaParameterized: false,
  sellerAttribution: "SALES_ORDER_NOMUS_SELLER" as const,
  institutionalRegistry: "CommissionCustomerExclusionRule" as const,
  electronicGateAudience: "SELLER" as const,
} as const;

export type NormativeSnapshot = {
  commissionMatrix:
    | { parameterized: false; source: null; bands: null }
    | {
        parameterized: true;
        source: "PriceTableVersion";
        bands: SystemCommissionTier[];
        outOfTableCommissionPercent: number;
        rateMethod: "INTERPOLATED_BY_SALE_PRICE";
        engineRuleActive: boolean;
      };
  supervisorCommission: {
    /** O IndusCost não calcula a parcela do Supervisor. */
    parameterized: false;
    calculationMode: "MANUAL_EXTERNAL_PROCESS";
    /** Percentual que a Política estabelece (fração); mudar exige nova versão. */
    documentedShare: number;
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
    /** Referência do prazo: última NF / Documento de Saída válido vinculado a PV. */
    inactivityClock: "LAST_VALID_INVOICE";
    crmEvidenceCanPreserveAssignment: true;
    /** Cliente nunca faturado não é removido por esta rotina. */
    neverInvoicedRemoved: false;
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
  release: ReleaseNormativeInput,
  /** Matriz lida da Formação de Preço; nula quando não há as quatro tabelas publicadas. */
  matrix: CommissionMatrixInput | null = null
): NormativeSnapshot {
  return {
    commissionMatrix: matrix
      ? {
          parameterized: true,
          source: "PriceTableVersion",
          // Só o que é normativo entra no snapshot: republicar a tabela com as mesmas margens e comissões não muda o hash.
          bands: matrix.tiers.map((tier) => ({
            code: tier.code,
            name: tier.name,
            marginPercent: tier.marginPercent,
            commissionPercent: tier.commissionPercent,
          })),
          outOfTableCommissionPercent: matrix.outOfTableCommissionPercent,
          rateMethod: "INTERPOLATED_BY_SALE_PRICE",
          engineRuleActive: matrix.engineRuleActive,
        }
      : { parameterized: false, source: null, bands: null },
    supervisorCommission: {
      parameterized: false,
      calculationMode: "MANUAL_EXTERNAL_PROCESS",
      documentedShare: DOCUMENT_SUPERVISOR_SHARE,
    },
    commissionRelease: {
      parameterized: true,
      basis: release.releaseDefaultRule,
      mode: release.partialPaymentEnabled ? "PROPORTIONAL" : "FULL",
      source: "CommissionSettings",
    },
    portfolio: {
      parameterized: true,
      inactivityDays: DOCUMENT_INACTIVITY_DAYS,
      inactivityClock: SYSTEM_NORMATIVE_FACTS.portfolioInactivityClock,
      crmEvidenceCanPreserveAssignment: true,
      neverInvoicedRemoved: false,
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
    return [
      "Anexo I vinculado à Formação de Preço no snapshot desta versão:",
      ...snapshot.commissionMatrix.bands.map(
        (band) => `${band.name}: margem ${formatPercent(band.marginPercent)} → comissão ${formatPercent(band.commissionPercent)}`
      ),
    ];
  }
  return ["Anexo I: sem níveis comerciais publicados na Formação de Preço quando esta versão foi congelada."];
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

/** Quem resolve e onde: o painel transforma isso em "o que fazer / onde fazer". */
export type FindingResolution = {
  owner: "SISTEMA" | "DOCUMENTO" | "DECISÃO" | "PROCESSO";
  where: string;
  steps: string[];
};

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
  resolution: FindingResolution;
};

const RESOLUTIONS: Record<string, FindingResolution> = {
  DECLARED_VERSION_MISMATCH: {
    owner: "DOCUMENTO",
    where: "Administração › Configurações › Políticas e aceites › Conteúdo da política (editor do rascunho, Anexo III)",
    steps: ["Abrir o rascunho no editor de conteúdo.", "Corrigir toda menção a \"versão 2.0\" para \"versão 1.0\".", "Salvar o rascunho e conferir de novo em \"Ver divergências\"."],
  },
  DOCUMENT_INTERNAL_VERSION_MISMATCH: {
    owner: "DOCUMENTO",
    where: "Relatório de publicação (docs/) e cópia controlada",
    steps: ["Nada a fazer no sistema: a correção do Anexo III para 1.0 já está na representação estruturada.", "Manter o registro desta correção no relatório de publicação."],
  },
  COMMISSION_MATRIX_NOT_PARAMETERIZED: {
    owner: "SISTEMA",
    where: "Comercial › Formação de Preço › Tabelas a gerar",
    steps: [
      "Gerar os DRAFTs comerciais das quatro tabelas (Atacado, Varejo 1, Varejo 2 e Varejo 3) informando a margem e a comissão de cada uma.",
      "Publicar as quatro versões geradas.",
      "Reabrir esta tela: a matriz é lida das tabelas publicadas a cada abertura.",
    ],
  },
  COMMISSION_MATRIX_MISMATCH: {
    owner: "DOCUMENTO",
    where: "Editor de conteúdo (Anexo I)",
    steps: [
      "Corrigir a Matriz de Referência do Anexo I para os níveis publicados na Formação de Preço, ou deixar a linha em branco para o sistema preenchê-la com o snapshot da versão.",
      "Não alterar a Formação de Preço só para coincidir com o texto: o sistema é a fonte da verdade.",
    ],
  },
  COMMISSION_MATRIX_ENGINE_RULE_INACTIVE: {
    owner: "SISTEMA",
    where: "Comissões › Regras de comissão",
    steps: ["Criar ou ativar uma regra com tipo de cálculo \"Faixa comercial\" para que o motor leia as tabelas da Formação de Preço."],
  },
  COMMISSION_MATRIX_INTERPOLATED: {
    owner: "DOCUMENTO",
    where: "Editor de conteúdo (Seção 7 / Anexo I)",
    steps: [
      "Reescrever a Seção 7 e o Anexo I: níveis comerciais de referência e interpolação linear entre eles pelo preço praticado, mínimo abaixo do Atacado e teto no Varejo 3.",
      "Não converter o motor para degrau: a política segue o motor.",
    ],
  },
  COMMISSION_MATRIX_ALIGNED: { owner: "DECISÃO", where: "—", steps: ["Nada a fazer."] },
  APPROVAL_AUTHORITY_MANUAL_PROCESS: {
    owner: "DECISÃO",
    where: "Diretoria / Supervisão Comercial",
    steps: ["Manter a aprovação prévia por alçada como processo manual registrado.", "Não bloqueia a publicação."],
  },
  SUPERVISOR_SHARE_MANUAL_PROCESS: {
    owner: "PROCESSO",
    where: "Administração / Diretoria — processo administrativo externo ao motor de comissões",
    steps: [
      "Nenhuma ação técnica obrigatória para publicação.",
      "Manter o cálculo administrativo dos 33% documentado enquanto não houver decisão de automatização.",
    ],
  },
  PORTFOLIO_INACTIVITY_MISMATCH: {
    owner: "DOCUMENTO",
    where: "Editor de conteúdo (Seção 11)",
    steps: [
      "Reescrever a Seção 11 conforme a rotina real: 90 dias corridos desde o último faturamento válido (nota fiscal / Documento de Saída), com preservação por registro válido no CRM e sem remoção de cliente nunca faturado.",
      "Não alterar a rotina de carteira: o sistema é a fonte da verdade.",
      "A pendência some quando o texto descrever a rotina; não há como marcá-la como resolvida manualmente.",
    ],
  },
  PORTFOLIO_INACTIVITY_ALIGNED: { owner: "DECISÃO", where: "—", steps: ["Nada a fazer."] },
  COMMISSION_RELEASE_UNVERIFIED: {
    owner: "SISTEMA",
    where: "Banco / Comissões › Configurações",
    steps: ["Reabrir esta tela com o banco disponível: a regra de liberação é lida de CommissionSettings."],
  },
  COMMISSION_RELEASE_ALIGNED: { owner: "DECISÃO", where: "—", steps: ["Nada a fazer."] },
  COMMISSION_RELEASE_NOT_PROPORTIONAL: {
    owner: "SISTEMA",
    where: "Comissões › Configurações › Liberação (pagamento proporcional)",
    steps: ["Habilitar a liberação proporcional ao recebimento", "ou revisar a Seção 16 no editor de conteúdo (nova versão)."],
  },
  COMMISSION_RELEASE_MISMATCH: {
    owner: "SISTEMA",
    where: "Comissões › Configurações › Liberação (regra padrão)",
    steps: ["Voltar a base de liberação para o recebimento do cliente (a mudança abre o rascunho de revisão automaticamente)", "ou revisar a Seção 16 no editor de conteúdo (nova versão)."],
  },
  ELECTRONIC_GATE_AUDIENCE: {
    owner: "DECISÃO",
    where: "Diretoria / Administração",
    steps: ["Decidir se executivos, consultores e supervisão também assinarão pelo sistema (ampliação do gate) ou pelo Anexo III em papel.", "Não bloqueia a publicação."],
  },
  COVERAGE_MANUAL_PROCESS: { owner: "DECISÃO", where: "CRM (registro de cobertura, contatos e propostas)", steps: ["Nada a fazer para publicar."] },
  CAMPAIGN_CONTROLLED_REFERENCE: { owner: "DECISÃO", where: "—", steps: ["Nada a fazer para publicar."] },
  CUSTOMER_CLASSIFICATION_CONNECTED: { owner: "DECISÃO", where: "Comissões › Exceções por cliente", steps: ["Nada a fazer para publicar."] },
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

function finding(input: Omit<PrePublishFinding, "blocking" | "resolution">): PrePublishFinding {
  return {
    ...input,
    blocking: input.severity === "BLOCKING",
    resolution: RESOLUTIONS[input.code] ?? { owner: "DECISÃO", where: "—", steps: [input.action] },
  };
}

function formatPercent(value: number): string {
  return `${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

function parsePercent(text: string): number | null {
  const match = /(\d+(?:[.,]\d+)?)\s*%/.exec(text);
  return match ? Number(match[1].replace(",", ".")) : null;
}

export type DocumentMatrixBand = {
  label: string;
  /** Início da faixa de margem (%); nulo na faixa "Abaixo de X". */
  marginFrom: number | null;
  commissionPercent: number;
  approval: string;
};

/** Nível comercial escrito por extenso no Anexo I (só quando a tabela não é a do snapshot). */
export type DocumentMatrixLevel = { name: string; marginPercent: number; commissionPercent: number };

export type DocumentCommissionMatrix = {
  /**
   * SNAPSHOT: a tabela "Nível comercial" tem a linha em branco, preenchida na
   * exibição com a matriz congelada no snapshot da versão — documento e sistema
   * mostram os mesmos valores por construção.
   * LEVELS: a tabela "Nível comercial" traz os valores escritos.
   * STEP_BANDS: tabela antiga por faixa de Margem Oficial (DOCX original).
   */
  form: "SNAPSHOT" | "LEVELS" | "STEP_BANDS";
  levels: DocumentMatrixLevel[];
  /** Comissão escrita para preço abaixo do menor nível (só em LEVELS). */
  belowLowestCommissionPercent: number | null;
  bands: DocumentMatrixBand[];
  /** Alçadas de aprovação escritas no Anexo I. */
  approvals: Array<{ label: string; approval: string }>;
  /** A Seção 7 / Anexo I descreve a interpolação entre níveis pelo PREÇO praticado. */
  describesInterpolation: boolean;
};

/**
 * Matriz do Anexo I como está escrita no conteúdo auditado. Sem tabela
 * (conteúdo vazio ou texto plano), vale a matriz em degraus do DOCX original.
 */
export function readDocumentCommissionMatrix(content: string): DocumentCommissionMatrix {
  const chapters = parsePolicyChapters(content).filter((chapter) => /^(7\.|ANEXO I\b)/i.test(chapter.title.trim()));
  const tables = chapters.flatMap((chapter) => chapter.blocks).filter((block) => block.type === "table");
  const text = chapters
    .flatMap((chapter) => chapter.blocks)
    .map((block) => (block.type === "paragraph" || block.type === "bullet" ? block.text : ""))
    .join(" ");
  // O motor interpola pelo preço vendido: o texto só está alinhado se disser as duas coisas.
  const describesInterpolation = /interpola/i.test(text) && /pre[çc]o/i.test(text);

  const approvalTable = tables.find(
    (block) => block.type === "table" && /margem oficial/i.test(block.rows[0]?.[0] ?? "") && /al[çc]ada/i.test(block.rows[0]?.[block.rows[0].length - 1] ?? "")
  );
  const approvals =
    approvalTable && approvalTable.type === "table"
      ? approvalTable.rows.slice(1).map((row) => ({ label: row[0] ?? "", approval: row[row.length - 1] ?? "" }))
      : DOCUMENT_ANNEX_I_BANDS.map((band) => ({ label: band.label, approval: band.approval }));

  const levelTable = tables.find((block) => block.type === "table" && isCommissionMatrixHeader(block.rows[0]));
  if (levelTable && levelTable.type === "table") {
    const written = levelTable.rows.slice(1).flatMap((row): Array<DocumentMatrixLevel & { below: boolean }> => {
      const commissionPercent = parsePercent(row[2] ?? "");
      if (commissionPercent === null) return [];
      const below = /abaixo/i.test(row[0] ?? "");
      const marginPercent = parsePercent(row[1] ?? "");
      if (!below && marginPercent === null) return [];
      return [{ name: (row[0] ?? "").trim(), marginPercent: marginPercent ?? 0, commissionPercent, below }];
    });
    const levels = written.filter((row) => !row.below).map(({ below: _below, ...level }) => level);
    return {
      form: levels.length === 0 ? "SNAPSHOT" : "LEVELS",
      levels,
      belowLowestCommissionPercent: written.find((row) => row.below)?.commissionPercent ?? null,
      bands: [],
      approvals,
      describesInterpolation,
    };
  }

  const stepTable = tables.find(
    (block) => block.type === "table" && /margem oficial/i.test(block.rows[0]?.[0] ?? "") && /comiss/i.test(block.rows[0]?.[1] ?? "")
  );
  const rows: Array<[string, string, string]> =
    stepTable && stepTable.type === "table"
      ? stepTable.rows.slice(1).map((row) => [row[0] ?? "", row[1] ?? "", row[2] ?? ""])
      : DOCUMENT_ANNEX_I_BANDS.map((band) => [band.label, formatPercent(band.commissionPercent * 100), band.approval]);
  const bands = rows.flatMap(([label, commission, approval]): DocumentMatrixBand[] => {
    const margin = parsePercent(label);
    const commissionPercent = parsePercent(commission);
    if (margin === null || commissionPercent === null) return [];
    return [{ label, marginFrom: /abaixo/i.test(label) ? null : margin, commissionPercent, approval }];
  });
  return { form: "STEP_BANDS", levels: [], belowLowestCommissionPercent: null, bands, approvals, describesInterpolation };
}

const sameNumber = (a: number, b: number) => Math.abs(a - b) < 0.005;

/**
 * Anexo I × Formação de Preço. O sistema é a fonte da verdade: os níveis
 * comerciais publicados (margem e comissão de referência) e a interpolação
 * linear pelo preço praticado. O documento está alinhado quando mostra os
 * mesmos níveis e descreve a interpolação pelo preço. Nada é marcado à mão.
 */
function auditCommissionMatrix(content: string, current: NormativeSnapshot | null): PrePublishFinding[] {
  const document = readDocumentCommissionMatrix(content);
  const base = { category: "MATRIZ_COMISSAO" as const, policySection: POLICY_SECTIONS.matrix };
  const matrix = current?.commissionMatrix;
  const documentText =
    document.form === "SNAPSHOT"
      ? "Anexo I: Matriz de Referência com os níveis comerciais do snapshot normativo da versão (margem e comissão de referência de cada nível)."
      : document.form === "LEVELS"
        ? `Anexo I: níveis comerciais de referência — ${document.levels.map((level) => `${level.name}: margem ${formatPercent(level.marginPercent)} → comissão ${formatPercent(level.commissionPercent)}`).join("; ")}.`
        : `Anexo I: comissão por faixa de Margem Oficial — ${document.bands.map((band) => `${band.label} = ${formatPercent(band.commissionPercent)}`).join("; ")}.`;

  if (!matrix || !matrix.parameterized) {
    return [
      finding({
        ...base,
        code: "COMMISSION_MATRIX_NOT_PARAMETERIZED",
        severity: "BLOCKING",
        document: documentText,
        system: current
          ? "A Formação de Preço não tem as quatro tabelas comerciais (Atacado, Varejo 1, Varejo 2 e Varejo 3) publicadas e vigentes com margem-alvo e comissão únicas por tabela; sem elas não há matriz para o Anexo I."
          : "Snapshot normativo atual não informado nesta auditoria; as tabelas publicadas da Formação de Preço não foram lidas.",
        action: "Gerar e publicar as quatro tabelas comerciais na Formação de Preço; o Anexo I mostra o que estiver publicado.",
      }),
    ];
  }

  const tiers = [...matrix.bands].sort((a, b) => a.marginPercent - b.marginPercent);
  const systemText = `Formação de Preço (tabelas publicadas): ${tiers.map((tier) => `${tier.name} — margem ${formatPercent(tier.marginPercent)} → comissão ${formatPercent(tier.commissionPercent)}`).join("; ")}; preço abaixo do Atacado → ${formatPercent(matrix.outOfTableCommissionPercent)}; entre dois níveis, interpolação linear pelo preço vendido; a partir do Varejo 3, o percentual do Varejo 3.`;
  const findings: PrePublishFinding[] = [];

  const differences: string[] = [];
  if (document.form === "LEVELS") {
    const levels = [...document.levels].sort((a, b) => a.marginPercent - b.marginPercent);
    if (levels.length !== tiers.length) {
      differences.push(`o Anexo I tem ${levels.length} nível(is) e a Formação de Preço tem ${tiers.length} tabela(s)`);
    } else {
      levels.forEach((level, index) => {
        const tier = tiers[index]!;
        if (!sameNumber(level.marginPercent, tier.marginPercent)) {
          differences.push(`nível "${level.name}" tem margem ${formatPercent(level.marginPercent)} e a tabela ${tier.name} tem margem ${formatPercent(tier.marginPercent)}`);
        }
        if (!sameNumber(level.commissionPercent, tier.commissionPercent)) {
          differences.push(`nível "${level.name}" paga ${formatPercent(level.commissionPercent)} e a tabela ${tier.name} paga ${formatPercent(tier.commissionPercent)}`);
        }
      });
    }
    if (document.belowLowestCommissionPercent !== null && !sameNumber(document.belowLowestCommissionPercent, matrix.outOfTableCommissionPercent)) {
      differences.push(`preço abaixo da tabela paga ${formatPercent(document.belowLowestCommissionPercent)} no Anexo I e ${formatPercent(matrix.outOfTableCommissionPercent)} no motor`);
    }
  } else if (document.form === "STEP_BANDS") {
    const below = document.bands.find((band) => band.marginFrom === null);
    const stepped = document.bands.filter((band) => band.marginFrom !== null).sort((a, b) => (a.marginFrom ?? 0) - (b.marginFrom ?? 0));
    if (stepped.length !== tiers.length) {
      differences.push(`o Anexo I tem ${stepped.length} faixa(s) a partir de uma margem mínima e a Formação de Preço tem ${tiers.length} tabela(s)`);
    } else {
      stepped.forEach((band, index) => {
        const tier = tiers[index]!;
        if (!sameNumber(band.marginFrom ?? 0, tier.marginPercent)) {
          differences.push(`faixa "${band.label}" começa em ${formatPercent(band.marginFrom ?? 0)} e a tabela ${tier.name} tem margem ${formatPercent(tier.marginPercent)}`);
        }
        if (!sameNumber(band.commissionPercent, tier.commissionPercent)) {
          differences.push(`faixa "${band.label}" paga ${formatPercent(band.commissionPercent)} e a tabela ${tier.name} paga ${formatPercent(tier.commissionPercent)}`);
        }
      });
    }
    if (below && !sameNumber(below.commissionPercent, matrix.outOfTableCommissionPercent)) {
      differences.push(`"${below.label}" paga ${formatPercent(below.commissionPercent)} e o motor paga ${formatPercent(matrix.outOfTableCommissionPercent)} abaixo do Atacado`);
    }
  }

  if (differences.length > 0) {
    findings.push(
      finding({
        ...base,
        code: "COMMISSION_MATRIX_MISMATCH",
        severity: "BLOCKING",
        document: documentText,
        system: `${systemText} Diferenças: ${differences.join("; ")}.`,
        action: "Ajustar o Anexo I da política candidata para os níveis publicados na Formação de Preço (o sistema é a fonte da verdade).",
      })
    );
  } else if (!matrix.engineRuleActive) {
    findings.push(
      finding({
        ...base,
        code: "COMMISSION_MATRIX_ENGINE_RULE_INACTIVE",
        severity: "BLOCKING",
        document: documentText,
        system: `${systemText} Porém não há regra de comissão ativa do tipo "Faixa comercial": o motor não está lendo estas tabelas.`,
        action: "Ativar em Comissões › Regras uma regra do tipo \"Faixa comercial\" antes de publicar.",
      })
    );
  } else if (document.form === "STEP_BANDS" || !document.describesInterpolation) {
    findings.push(
      finding({
        ...base,
        code: "COMMISSION_MATRIX_INTERPOLATED",
        severity: "BLOCKING",
        document:
          document.form === "STEP_BANDS"
            ? `${documentText} O texto descreve faixas em degrau: toda a faixa paga o mesmo percentual.`
            : `${documentText} A Seção 7 e o Anexo I não descrevem a interpolação entre níveis pelo preço praticado.`,
        system: `${systemText} Ex.: um item vendido no meio do caminho entre os preços de ${tiers[0]?.name ?? "Atacado"} e ${tiers[1]?.name ?? "Varejo 1"} recebe ${formatPercent(((tiers[0]?.commissionPercent ?? 0) + (tiers[1]?.commissionPercent ?? 0)) / 2)}.`,
        action: "Reescrever a Seção 7 e o Anexo I da política candidata: níveis de referência e interpolação linear pelo preço praticado, como o motor calcula.",
      })
    );
  } else {
    findings.push(
      finding({
        ...base,
        code: "COMMISSION_MATRIX_ALIGNED",
        severity: "INFORMATIONAL",
        document: `${documentText} A Seção 7 descreve a interpolação linear entre níveis pelo preço praticado, o mínimo abaixo do Atacado e o teto no Varejo 3.`,
        system: systemText,
        action: "Nenhuma. A política descreve o motor de comissão do IndusCost.",
      })
    );
  }

  findings.push(
    finding({
      ...base,
      code: "APPROVAL_AUTHORITY_MANUAL_PROCESS",
      severity: "WARNING",
      document: `Alçadas do Anexo I: ${document.approvals.filter((row) => /aprova/i.test(row.approval)).map((row) => `${row.label} — ${row.approval}`).join("; ") || "aprovação prévia para margens baixas"}.`,
      system: "O IndusCost não bloqueia nem registra a aprovação prévia por alçada no Pedido de Venda; a autorização é processo manual da Diretoria / Supervisão.",
      action: "Manter a aprovação por alçada como processo manual registrado, ou desenvolver o bloqueio no Pedido de Venda; não bloqueia a publicação.",
    })
  );
  return findings;
}

/** Percentual do Supervisor escrito na Seção 14 (fração); nulo se o texto não o trouxer. */
export function readDocumentSupervisorShare(content: string): number | null {
  const chapter = parsePolicyChapters(content).find((item) => /^14\./.test(item.title.trim()));
  const text = (chapter?.blocks ?? []).map((block) => ("text" in block ? block.text : "")).join(" ");
  const percent = parsePercent(text);
  return percent === null ? null : percent / 100;
}

/**
 * Supervisor: regra empresarial válida, apurada por processo administrativo
 * FORA do motor do IndusCost (decisão de 30/09/2026). Não é erro nem bloqueio;
 * a auditoria só registra que o sistema não calcula a parcela.
 */
function auditSupervisorShare(content: string, current: NormativeSnapshot | null): PrePublishFinding {
  const share = readDocumentSupervisorShare(content) ?? current?.supervisorCommission.documentedShare ?? DOCUMENT_SUPERVISOR_SHARE;
  const shareText = `${Math.round(share * 100)}%`;
  return finding({
    code: "SUPERVISOR_SHARE_MANUAL_PROCESS",
    category: "SUPERVISOR",
    policySection: POLICY_SECTIONS.supervisor,
    severity: "INFORMATIONAL",
    document: `A Política estabelece ${shareText} das comissões elegíveis dos Vendedores do time para o Supervisor Comercial, como parcela adicional suportada pela empresa, sem reduzir a comissão do Vendedor.`,
    system: "A remuneração do Supervisor é apurada por processo administrativo externo ao motor de comissões do IndusCost. O sistema não calcula nem fecha essa parcela.",
    action: "Nenhuma ação técnica obrigatória para publicação. Manter cálculo administrativo documentado enquanto não houver decisão de automatização.",
  });
}

export type DocumentInactivityRule = {
  days: number | null;
  /** Referência do prazo descrita na Seção 11. */
  clock: "LAST_VALID_INVOICE" | "APPROVED_SALES_ORDER" | "UNKNOWN";
  /** O texto diz que o CRM válido pode preservar o Responsável Comercial. */
  crmCanPreserve: boolean;
  /** O texto diz que cliente sem faturamento não é desvinculado só por esta rotina. */
  neverInvoicedKept: boolean;
};

/** Regra de inatividade como está escrita na Seção 11 do conteúdo auditado. */
export function readDocumentInactivityRule(content: string): DocumentInactivityRule {
  const chapter = parsePolicyChapters(content).find((item) => /^11\./.test(item.title.trim()));
  const text = (chapter?.blocks ?? []).map((block) => ("text" in block ? block.text : "")).join(" ");
  const days = /(\d+)\s+dias corridos/i.exec(text);
  const byOrder = /dias corridos sem novo Pedido de Venda aprovado/i.test(text);
  const byInvoice = /faturamento v[áa]lido/i.test(text) && /nota fiscal|documento de sa[íi]da/i.test(text);
  return {
    days: days ? Number(days[1]) : null,
    clock: byOrder ? "APPROVED_SALES_ORDER" : byInvoice ? "LAST_VALID_INVOICE" : "UNKNOWN",
    crmCanPreserve: /registro v[áa]lido/i.test(text) && /CRM/.test(text),
    neverInvoicedKept: /sem hist[óo]rico de faturamento v[áa]lido n[ãa]o ser[ãa]o automaticamente desvinculados/i.test(text),
  };
}

/**
 * Carteira: o sistema é a fonte da verdade — 90 dias corridos desde a última
 * NF / Documento de Saída válido, preservação por CRM estruturado e cliente
 * nunca faturado não removido. A Seção 11 precisa dizer o mesmo.
 */
function auditPortfolioInactivity(content: string, current: NormativeSnapshot | null): PrePublishFinding {
  const document = readDocumentInactivityRule(content);
  const systemDays = current?.portfolio.inactivityDays ?? DOCUMENT_INACTIVITY_DAYS;
  const systemText = `${SYSTEM_NORMATIVE_FACTS.portfolioInactivitySource}: ${systemDays} dias corridos desde a última NF / Documento de Saída válido vinculado a Pedido de Venda (NF cancelada, devolução e transferência não contam; PV sem faturamento não reinicia; cada NF válida reinicia, mesmo em faturamento parcial). CRM estruturado válido preserva o responsável; atualização técnica, registro genérico ou artificial não. Cliente nunca faturado não é removido por esta rotina.`;
  const differences: string[] = [];
  if (document.clock === "APPROVED_SALES_ORDER") differences.push('o texto conta o prazo de "novo Pedido de Venda aprovado"; a rotina conta do último faturamento válido');
  else if (document.clock === "UNKNOWN") differences.push("a Seção 11 não diz que o prazo é contado do último faturamento válido (nota fiscal / Documento de Saída)");
  if (document.days !== null && document.days !== systemDays) differences.push(`o texto fala em ${document.days} dias e a rotina usa ${systemDays}`);
  if (document.days === null) differences.push("a Seção 11 não informa o prazo em dias corridos");
  if (!document.crmCanPreserve) differences.push("o texto não prevê a preservação por registro válido no CRM");
  if (!document.neverInvoicedKept) differences.push("o texto não diz que cliente sem faturamento válido não é desvinculado só por esta rotina");

  const base = { category: "CARTEIRA" as const, policySection: POLICY_SECTIONS.inactivity };
  if (differences.length > 0) {
    return finding({
      ...base,
      code: "PORTFOLIO_INACTIVITY_MISMATCH",
      severity: "BLOCKING",
      document:
        document.clock === "APPROVED_SALES_ORDER"
          ? `${document.days ?? "?"} dias corridos sem novo Pedido de Venda aprovado = gatilho de revisão; com registro material válido no CRM o Responsável Comercial pode ser preservado; sem ele, a exclusividade é retirada automaticamente.`
          : `Seção 11 em desacordo com a rotina: ${differences.join("; ")}.`,
      system: `${systemText} Diferenças: ${differences.join("; ")}.`,
      action: "Reescrever a Seção 11 da política candidata conforme a rotina real (o sistema é a fonte da verdade); não alterar a rotina.",
    });
  }
  return finding({
    ...base,
    code: "PORTFOLIO_INACTIVITY_ALIGNED",
    severity: "INFORMATIONAL",
    document: `${document.days} dias corridos desde o último Faturamento Válido (nota fiscal ou Documento de Saída válido); registro válido no CRM pode preservar o Responsável Comercial; cliente sem histórico de faturamento não é desvinculado só por esta rotina.`,
    system: systemText,
    action: "Nenhuma. A Seção 11 descreve a rotina de carteira do IndusCost.",
  });
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
  findings.push(...auditCommissionMatrix(content, current ?? null));
  findings.push(auditSupervisorShare(content, current ?? null));
  findings.push(auditPortfolioInactivity(content, current ?? null));

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

function byCodeOf(findings: readonly PrePublishFinding[], code: string): PrePublishFinding | undefined {
  return findings.find((item) => item.code === code);
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
export function buildPolCom001ReconciliationMatrix(current: NormativeSnapshot | null, content = ""): ReconciliationRow[] {
  const audit = auditPolCom001Publication(content, current);
  const inactivity = audit.findings.find((item) => item.code.startsWith("PORTFOLIO_INACTIVITY_"));
  const supervisor = byCodeOf(audit.findings, "SUPERVISOR_SHARE_MANUAL_PROCESS");
  const byCode = new Map(audit.findings.map((item) => [item.code, item]));
  const matrix = audit.findings.find((item) => item.code.startsWith("COMMISSION_MATRIX_"));
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
      rule: "Matriz de Referência (Anexo I): níveis comerciais da Formação de Preço, com interpolação linear pelo preço praticado",
      implementation: matrix?.system ?? "Não conferido.",
      status: matrix?.code === "COMMISSION_MATRIX_ALIGNED" ? "ALINHADO" : matrix?.code === "COMMISSION_MATRIX_NOT_PARAMETERIZED" ? "NÃO_IMPLEMENTADO" : "DIVERGENTE",
      severity: matrix?.severity ?? "BLOCKING",
      action: matrix?.action ?? "Auditar com o snapshot atual.",
      findingCode: matrix?.code ?? null,
    },
    {
      section: `${POLICY_SECTIONS.matrix} (alçadas)`,
      rule: "Alçadas: aprovação prévia da Diretoria / Supervisor para margem abaixo de 35%",
      implementation: "Sem bloqueio nem registro automático da aprovação no Pedido de Venda.",
      status: "PROCESSO_MANUAL",
      severity: "WARNING",
      action: "Manter como processo manual registrado; não bloqueia.",
      findingCode: byCode.has("APPROVAL_AUTHORITY_MANUAL_PROCESS") ? "APPROVAL_AUTHORITY_MANUAL_PROCESS" : null,
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
      rule: "90 dias corridos desde o último faturamento válido → revisão; CRM válido preserva; sem CRM, retirada automática; nunca faturado não é removido",
      implementation: inactivity?.system ?? "Não conferido.",
      status: inactivity?.code === "PORTFOLIO_INACTIVITY_ALIGNED" ? "ALINHADO" : "DIVERGENTE",
      severity: inactivity?.severity ?? "BLOCKING",
      action: inactivity?.action ?? "Auditar com o conteúdo da política.",
      findingCode: inactivity?.code ?? null,
    },
    {
      section: POLICY_SECTIONS.supervisor,
      rule: "Supervisor recebe 33% das comissões elegíveis do time; parcela adicional",
      implementation: supervisor?.system ?? "Processo administrativo externo ao motor de comissões.",
      status: "PROCESSO_MANUAL",
      severity: "INFORMATIONAL",
      action: supervisor?.action ?? "Nenhuma ação técnica obrigatória para publicação.",
      findingCode: "SUPERVISOR_SHARE_MANUAL_PROCESS",
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
  // Cálculo continua manual; o que muda é a regra aceita pelo vendedor.
  if (kind === "commission.supervisorShare" && typeof newValue === "number" && Number.isFinite(newValue)) {
    next.supervisorCommission.documentedShare = newValue;
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
