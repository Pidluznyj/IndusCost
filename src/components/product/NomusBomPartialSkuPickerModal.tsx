import React from "react";
import { NomusParentCodePickerModal } from "@/src/components/product/NomusParentCodePickerModal";
import type { NomusBomApplyPlan } from "@/src/lib/nomusBomApplyPlan";
import type { NomusParentCodeOption } from "@/src/lib/nomusParentCodeOptionsTypes";

export type NomusBomPartialSkuPickerModalProps = {
  open: boolean;
  onClose: () => void;
  searchTerm: string;
  plans: NomusBomApplyPlan[];
  onViewAnalysis: (plan: NomusBomApplyPlan) => void;
};

function planToOption(plan: NomusBomApplyPlan): NomusParentCodeOption {
  return {
    parentCode: plan.parentCode,
    parentDescription: plan.parentDescription ?? null,
    indusProductId: plan.indusProductId ?? null,
    nomusLinesCount: plan.selectedNomusList?.linesCount ?? 0,
    selectedListName: plan.selectedNomusList?.listaMateriaisNome ?? null,
  };
}

export const NomusBomPartialSkuPickerModal: React.FC<NomusBomPartialSkuPickerModalProps> = ({
  open,
  onClose,
  searchTerm,
  plans,
  onViewAnalysis,
}) => {
  const options = plans.map(planToOption);
  const planByCode = new Map(plans.map((p) => [p.parentCode, p]));

  return (
    <NomusParentCodePickerModal
      open={open}
      onClose={onClose}
      search={searchTerm}
      options={options}
      title="Selecione o produto"
      description={`Encontramos mais de um produto para "${searchTerm}". Selecione qual deseja analisar.`}
      selectLabel="Ver análise"
      onSelect={(option) => {
        const plan = planByCode.get(option.parentCode);
        if (plan) onViewAnalysis(plan);
      }}
    />
  );
};
