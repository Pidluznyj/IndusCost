import React from "react";
import { X, GitCompareArrows } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { NomusBomApplyPlan } from "@/src/lib/nomusBomApplyPlan";

export type NomusBomPartialSkuPickerModalProps = {
  open: boolean;
  onClose: () => void;
  searchTerm: string;
  plans: NomusBomApplyPlan[];
  onViewAnalysis: (plan: NomusBomApplyPlan) => void;
};

export const NomusBomPartialSkuPickerModal: React.FC<NomusBomPartialSkuPickerModalProps> = ({
  open,
  onClose,
  searchTerm,
  plans,
  onViewAnalysis,
}) => {
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[55] flex items-center justify-center p-3 sm:p-4 bg-background/70 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="nomus-partial-sku-picker-title"
            className="bg-card w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden rounded-2xl border border-border shadow-2xl"
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            onClick={(e) => e.stopPropagation()}
          >
            <motion.div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
              <motion.div>
                <h3 id="nomus-partial-sku-picker-title" className="text-sm font-bold">
                  Selecione o produto
                </h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Encontramos mais de um produto para{" "}
                  <span className="font-semibold">{searchTerm}</span>. Selecione qual deseja analisar.
                </p>
              </motion.div>
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 rounded-lg hover:bg-accent shrink-0"
                aria-label="Fechar"
              >
                <X className="h-4 w-4" />
              </button>
            </motion.div>

            <motion.div className="flex-1 overflow-y-auto p-3 space-y-2">
              {plans.map((plan) => {
                const cls = plan.classification;
                return (
                  <motion.div
                    key={plan.parentCode}
                    className="rounded-xl border border-border bg-background p-3 flex flex-col sm:flex-row sm:items-center gap-3"
                  >
                    <motion.div className="min-w-0 flex-1">
                      <p className="font-bold text-sm">{plan.parentCode}</p>
                      {plan.parentDescription ? (
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                          {plan.parentDescription}
                        </p>
                      ) : null}
                      <p className="text-[10px] text-muted-foreground mt-1">
                        {cls.actionClass.replace(/_/g, " ")} · Risco {cls.riskLevel}
                      </p>
                    </motion.div>
                    <button
                      type="button"
                      onClick={() => onViewAnalysis(plan)}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs font-semibold text-primary hover:bg-primary/10 shrink-0"
                    >
                      <GitCompareArrows className="h-3.5 w-3.5" />
                      Ver análise
                    </button>
                  </motion.div>
                );
              })}
            </motion.div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
};
