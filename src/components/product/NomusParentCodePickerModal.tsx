import React from "react";
import { Check, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { NomusParentCodeOption } from "@/src/lib/nomusParentCodeOptionsTypes";

export type NomusParentCodePickerModalProps = {
  open: boolean;
  onClose: () => void;
  search: string;
  options: NomusParentCodeOption[];
  onSelect: (option: NomusParentCodeOption) => void;
  title?: string;
  description?: string;
  selectLabel?: string;
};

export const NomusParentCodePickerModal: React.FC<NomusParentCodePickerModalProps> = ({
  open,
  onClose,
  search,
  options,
  onSelect,
  title = "Selecione o produto",
  description,
  selectLabel = "Selecionar",
}) => {
  const bodyText =
    description ??
    `Encontramos mais de um produto para "${search}". Selecione qual deseja usar.`;

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
            aria-labelledby="nomus-parent-code-picker-title"
            className="bg-card w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden rounded-2xl border border-border shadow-2xl"
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
              <div>
                <h3 id="nomus-parent-code-picker-title" className="text-sm font-bold">
                  {title}
                </h3>
                <p className="text-xs text-muted-foreground mt-1">{bodyText}</p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 rounded-lg hover:bg-accent shrink-0"
                aria-label="Fechar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {options.map((option) => (
                <div
                  key={option.parentCode}
                  className="rounded-xl border border-border bg-background p-3 flex flex-col sm:flex-row sm:items-center gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-sm">{option.parentCode}</p>
                    {option.parentDescription ? (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                        {option.parentDescription}
                      </p>
                    ) : null}
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {option.nomusLinesCount} linha(s) Nomus
                      {option.selectedListName ? ` · Lista ${option.selectedListName}` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onSelect(option)}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs font-semibold text-primary hover:bg-primary/10 shrink-0"
                  >
                    <Check className="h-3.5 w-3.5" />
                    {selectLabel}
                  </button>
                </div>
              ))}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
};
