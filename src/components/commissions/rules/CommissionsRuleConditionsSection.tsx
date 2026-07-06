import React from "react";
import { Plus, Trash2 } from "lucide-react";
import type { CommissionsRuleConditionItem } from "@/src/components/commissions/commissionsTypes";

export const EMPTY_RULE_CONDITION: CommissionsRuleConditionItem = {
  customerExternalId: null,
  customerUf: null,
  productExternalId: null,
  productGroupExternalId: null,
  nomusSellerId: null,
  nomusRepresentativeId: null,
  paymentConditionExternalId: null,
  minOrderAmount: null,
  maxOrderAmount: null,
  minDiscountPercent: null,
  maxDiscountPercent: null,
};

const fieldClass =
  "w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-sm text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30";

type Props = {
  open: boolean;
  onToggle: () => void;
  conditions: CommissionsRuleConditionItem[];
  onChange: (next: CommissionsRuleConditionItem[]) => void;
};

function parseOptionalNumber(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function ConditionRow({
  condition,
  index,
  onChange,
  onRemove,
}: {
  condition: CommissionsRuleConditionItem;
  index: number;
  onChange: (next: CommissionsRuleConditionItem) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-[#374151]">Condição {index + 1}</span>
        <button
          type="button"
          onClick={onRemove}
          className="inline-flex items-center gap-1 text-xs text-red-600 hover:text-red-700"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Remover
        </button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-xs text-[#6B7280]">Cliente (ID Nomus)</span>
          <input
            type="number"
            className={fieldClass}
            value={condition.customerExternalId ?? ""}
            onChange={(e) =>
              onChange({ ...condition, customerExternalId: parseOptionalNumber(e.target.value) })
            }
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-[#6B7280]">UF do cliente</span>
          <input
            className={fieldClass}
            maxLength={2}
            value={condition.customerUf ?? ""}
            onChange={(e) =>
              onChange({ ...condition, customerUf: e.target.value.trim().toUpperCase() || null })
            }
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-[#6B7280]">Produto (ID Nomus)</span>
          <input
            type="number"
            className={fieldClass}
            value={condition.productExternalId ?? ""}
            onChange={(e) =>
              onChange({ ...condition, productExternalId: parseOptionalNumber(e.target.value) })
            }
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-[#6B7280]">Grupo de produto (ID Nomus)</span>
          <input
            type="number"
            className={fieldClass}
            value={condition.productGroupExternalId ?? ""}
            onChange={(e) =>
              onChange({
                ...condition,
                productGroupExternalId: parseOptionalNumber(e.target.value),
              })
            }
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-[#6B7280]">Vendedor Nomus (ID)</span>
          <input
            type="number"
            className={fieldClass}
            value={condition.nomusSellerId ?? ""}
            onChange={(e) =>
              onChange({ ...condition, nomusSellerId: parseOptionalNumber(e.target.value) })
            }
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-[#6B7280]">Representante Nomus (ID)</span>
          <input
            type="number"
            className={fieldClass}
            value={condition.nomusRepresentativeId ?? ""}
            onChange={(e) =>
              onChange({
                ...condition,
                nomusRepresentativeId: parseOptionalNumber(e.target.value),
              })
            }
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-[#6B7280]">Condição de pagamento (ID Nomus)</span>
          <input
            type="number"
            className={fieldClass}
            value={condition.paymentConditionExternalId ?? ""}
            onChange={(e) =>
              onChange({
                ...condition,
                paymentConditionExternalId: parseOptionalNumber(e.target.value),
              })
            }
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-[#6B7280]">Valor mínimo do pedido</span>
          <input
            type="number"
            step="0.01"
            className={fieldClass}
            value={condition.minOrderAmount ?? ""}
            onChange={(e) =>
              onChange({ ...condition, minOrderAmount: parseOptionalNumber(e.target.value) })
            }
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-[#6B7280]">Valor máximo do pedido</span>
          <input
            type="number"
            step="0.01"
            className={fieldClass}
            value={condition.maxOrderAmount ?? ""}
            onChange={(e) =>
              onChange({ ...condition, maxOrderAmount: parseOptionalNumber(e.target.value) })
            }
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-[#6B7280]">Desconto mínimo (%)</span>
          <input
            type="number"
            step="0.01"
            className={fieldClass}
            value={condition.minDiscountPercent ?? ""}
            onChange={(e) =>
              onChange({ ...condition, minDiscountPercent: parseOptionalNumber(e.target.value) })
            }
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-[#6B7280]">Desconto máximo (%)</span>
          <input
            type="number"
            step="0.01"
            className={fieldClass}
            value={condition.maxDiscountPercent ?? ""}
            onChange={(e) =>
              onChange({ ...condition, maxDiscountPercent: parseOptionalNumber(e.target.value) })
            }
          />
        </label>
      </div>
    </div>
  );
}

export function CommissionsRuleConditionsSection({
  open,
  onToggle,
  conditions,
  onChange,
}: Props) {
  return (
    <div className="rounded-lg border border-[#E5E7EB]">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold text-[#111827]"
      >
        Condições avançadas
        <span className="text-xs font-normal text-[#6B7280]">
          {conditions.length} condição(ões)
        </span>
      </button>
      {open ? (
        <div className="space-y-3 border-t border-[#E5E7EB] px-4 py-3">
          <p className="text-xs text-[#6B7280]">
            Filtros opcionais para restringir quando a regra se aplica. Deixe em branco para
            aplicar genericamente.
          </p>
          {conditions.map((condition, index) => (
            <ConditionRow
              key={index}
              condition={condition}
              index={index}
              onChange={(next) => {
                const copy = [...conditions];
                copy[index] = next;
                onChange(copy);
              }}
              onRemove={() => onChange(conditions.filter((_, i) => i !== index))}
            />
          ))}
          <button
            type="button"
            onClick={() => onChange([...conditions, { ...EMPTY_RULE_CONDITION }])}
            className="inline-flex items-center gap-1 rounded-lg border border-dashed border-[#CBD5E1] px-3 py-2 text-xs font-medium text-[#374151] hover:bg-[#F9FAFB]"
          >
            <Plus className="h-3.5 w-3.5" />
            Adicionar condição
          </button>
        </div>
      ) : null}
    </div>
  );
}
