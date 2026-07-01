import type { CommissionsSettingsPayload } from "@/src/components/commissions/commissionsTypes";

export type SettingsFieldKey = keyof Omit<CommissionsSettingsPayload, "warnings">;

export type SettingsFieldDef = {
  key: SettingsFieldKey;
  label: string;
  description: string;
  type: "boolean" | "releaseRule";
  impactsCalculation?: boolean;
  strongWarningWhenFalse?: boolean;
};

export type SettingsSectionDef = {
  id: string;
  title: string;
  description: string;
  fields: SettingsFieldDef[];
};

export const COMMISSION_SETTINGS_SECTIONS: SettingsSectionDef[] = [
  {
    id: "calculation",
    title: "Cálculo",
    description: "Define como a comissão é prevista, confirmada e liberada.",
    fields: [
      {
        key: "forecastEnabled",
        label: "Calcular comissão prevista pelo Pedido de Venda",
        description:
          "Gera registros de previsão a partir do pedido antes da NF-e autorizada.",
        type: "boolean",
        impactsCalculation: true,
      },
      {
        key: "outputDocumentSupersedesForecast",
        label: "Substituir previsão por Documento de Saída após emissão",
        description:
          "Quando a NF-e/documento de saída é confirmado, a previsão do pedido é substituída.",
        type: "boolean",
        impactsCalculation: true,
      },
      {
        key: "receivableAsDefinitiveReleaseSource",
        label: "Usar Contas a Receber como fonte definitiva de liberação",
        description:
          "Somente recebimentos reais nas CR liberam comissão quando esta opção está ativa.",
        type: "boolean",
        impactsCalculation: true,
        strongWarningWhenFalse: true,
      },
      {
        key: "releaseDefaultRule",
        label: "Regra padrão de liberação",
        description: "Aplicada quando a regra de comissão não define liberação específica.",
        type: "releaseRule",
        impactsCalculation: true,
      },
    ],
  },
  {
    id: "payment",
    title: "Pagamento",
    description: "Controles do fluxo manual de pagamento ao comissionado.",
    fields: [
      {
        key: "manualPaymentEnabled",
        label: "Permitir pagamento manual de comissão",
        description: "Habilita criação de lotes de pagamento na tela Pagamentos.",
        type: "boolean",
      },
      {
        key: "paidCommissionBlockAutoChange",
        label: "Bloquear alteração automática de comissão já paga",
        description: "Impede recálculo de sobrescrever valores de comissões pagas.",
        type: "boolean",
        impactsCalculation: true,
      },
      {
        key: "partialPaymentEnabled",
        label: "Permitir pagamento parcial",
        description: "Permite marcar como pago um valor menor que o liberado no lote.",
        type: "boolean",
      },
      {
        key: "requireApprovalBeforePaid",
        label: "Exigir aprovação antes de marcar como pago",
        description: "Lotes precisam estar aprovados antes de registrar pagamento.",
        type: "boolean",
      },
    ],
  },
  {
    id: "audit",
    title: "Auditoria",
    description: "Quais inconsistências devem ser registradas automaticamente.",
    fields: [
      {
        key: "auditOrderWithoutSeller",
        label: "Gerar auditoria para pedido sem vendedor",
        description: "Issue quando o pedido não tem vendedor identificado.",
        type: "boolean",
      },
      {
        key: "auditOrderWithoutRepresentative",
        label: "Gerar auditoria para pedido sem representante",
        description: "Issue quando o representante não veio no payload Nomus.",
        type: "boolean",
      },
      {
        key: "auditNfeWithoutOutputDocument",
        label: "Gerar auditoria para NF-e sem Documento de Saída",
        description: "Issue para NF-e autorizada sem documento de saída local.",
        type: "boolean",
      },
      {
        key: "auditNfeWithoutReceivable",
        label: "Gerar auditoria para NF-e sem Contas a Receber",
        description: "Issue para NF-e sem títulos de CR vinculados.",
        type: "boolean",
      },
      {
        key: "auditPaidWithoutRelease",
        label: "Gerar auditoria para comissão paga sem liberação",
        description: "Issue crítica quando há pagamento sem valor liberado.",
        type: "boolean",
      },
    ],
  },
  {
    id: "scope",
    title: "Escopo",
    description: "Quem entra no cálculo automático de comissões.",
    fields: [
      {
        key: "calculateForSellers",
        label: "Calcular para vendedores",
        description: "Processa beneficiário SELLER nos pedidos.",
        type: "boolean",
        impactsCalculation: true,
      },
      {
        key: "calculateForRepresentatives",
        label: "Calcular para representantes",
        description: "Processa beneficiário REPRESENTATIVE nos pedidos.",
        type: "boolean",
        impactsCalculation: true,
      },
      {
        key: "allowFixedPersonInRule",
        label: "Permitir pessoa fixa na regra",
        description: "Permite criar regras com beneficiário FIXED_PERSON.",
        type: "boolean",
        impactsCalculation: true,
      },
    ],
  },
];

export const RELEASE_RULE_OPTIONS = [
  { value: "SALES_ORDER_CREATED", label: "Na criação do pedido" },
  { value: "OUTPUT_DOCUMENT_CREATED", label: "Na emissão do documento de saída" },
  { value: "FIRST_RECEIVABLE_PAID", label: "Após pagamento da primeira CR" },
  { value: "EACH_RECEIVABLE_PAID", label: "Proporcional a cada CR paga" },
] as const;

export function hasCalculationImpact(form: CommissionsSettingsPayload): boolean {
  return COMMISSION_SETTINGS_SECTIONS.some((section) =>
    section.fields.some(
      (field) => field.impactsCalculation && form[field.key] !== undefined
    )
  );
}

export function validateSettingsForm(form: CommissionsSettingsPayload): string | null {
  const hasCalculationSource =
    form.forecastEnabled ||
    form.outputDocumentSupersedesForecast ||
    form.receivableAsDefinitiveReleaseSource;
  if (!hasCalculationSource) {
    return "Pelo menos uma fonte de cálculo/liberação deve permanecer ativa.";
  }
  if (!form.calculateForSellers && !form.calculateForRepresentatives) {
    return "Ative o cálculo para vendedores ou representantes.";
  }
  const validRules = RELEASE_RULE_OPTIONS.map((o) => o.value);
  if (!validRules.includes(form.releaseDefaultRule as (typeof validRules)[number])) {
    return "Regra padrão de liberação inválida.";
  }
  return null;
}

export function buildReceivableWarning(form: CommissionsSettingsPayload): string | null {
  if (form.receivableAsDefinitiveReleaseSource) return null;
  return "Desativar Contas a Receber como fonte definitiva permite liberação antes do recebimento real. Revise regras, liberações e pagamentos com atenção.";
}

export function buildCalculationImpactWarning(_form: CommissionsSettingsPayload): string {
  return "Esta alteração impacta o cálculo de comissões. Reprocesse o período após salvar para refletir nos registros existentes.";
}
