import React from "react";
import { X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { Proposal, ProposalItem } from "@/src/types/commercial";
import { ProposalIndicatorsTab } from "@/src/components/proposal/ProposalIndicatorsTab";

type Props = {
  open: boolean;
  onClose: () => void;
  proposalNumber?: number | null;
  proposalTitle?: string | null;
  proposalId?: string | null;
  items: ProposalItem[];
  totals: Pick<
    Proposal,
    | "totalGrossValue"
    | "totalDiscount"
    | "totalNetValue"
    | "totalTaxes"
    | "totalCommission"
    | "totalFreight"
    | "totalMarginValue"
    | "totalMarginPerc"
  >;
};

export function ProposalIndicatorsDetailModal({
  open,
  onClose,
  proposalNumber,
  proposalTitle,
  proposalId,
  items,
  totals,
}: Props) {
  return (
    <AnimatePresence>
      {open ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm"
          onClick={onClose}
          role="presentation"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 12 }}
            transition={{ duration: 0.2 }}
            className="bg-card w-full max-w-[96vw] max-h-[94vh] rounded-2xl border border-border shadow-2xl flex flex-col overflow-hidden"
            role="dialog"
            aria-modal="true"
            aria-labelledby="proposal-indicators-detail-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-border bg-accent/40 flex items-start justify-between gap-3 shrink-0">
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary/80">Proposta</p>
                <h2 id="proposal-indicators-detail-title" className="text-lg font-bold leading-tight mt-1">
                  Análise detalhada de indicadores
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                  {proposalNumber ? `Proposta #${proposalNumber}` : "Proposta em edição"}
                  {proposalTitle && String(proposalTitle).trim() ? ` · ${proposalTitle}` : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-2 rounded-full hover:bg-accent transition-colors"
                aria-label="Fechar"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              <ProposalIndicatorsTab
                mode="detailed"
                proposalNumber={proposalNumber}
                proposalTitle={proposalTitle}
                proposalId={proposalId}
                items={items}
                totals={totals}
              />
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
