import React, { useState, useRef, useEffect, useMemo, useLayoutEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Search, ChevronDown, X, Check } from "lucide-react";
import { cn, normalizeSearchString } from "@/src/lib/utils";
import { motion, AnimatePresence } from "motion/react";

export interface SelectOption {
  value: string;
  label: string;
  sublabel?: string;
  searchTerms?: string; // Additional terms to match against (e.g. SKU)
  /** Quando true, a opção aparece na lista mas não é selecionável. */
  disabled?: boolean;
}

interface SearchableSelectProps {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  emptyMessage?: string;
  /** Texto quando há value mas não há opção correspondente (ex.: registro removido) */
  unknownSelectionLabel?: string;
  className?: string;
  required?: boolean;
  disabled?: boolean;
  /** Placeholder do campo de busca dentro do dropdown */
  searchInputPlaceholder?: string;
  /** Valores de opção que permanecem sempre visíveis (ex.: opção “Todos”) quando há texto de busca */
  pinOptionValues?: string[];
  /** Altura máxima (px) da área rolável da lista (abaixo da busca), padrão ~300 */
  listMaxHeight?: number;
}

function optionSearchHaystack(opt: SelectOption): string {
  return [opt.label, opt.sublabel, opt.searchTerms].filter(Boolean).join(" ");
}

export const SearchableSelect: React.FC<SearchableSelectProps> = ({
  options,
  value,
  onChange,
  placeholder = "Selecione uma opção...",
  emptyMessage = "Nenhum resultado encontrado.",
  unknownSelectionLabel = "Seleção não disponível na lista atual",
  className,
  required = false,
  disabled = false,
  searchInputPlaceholder = "Pesquisar...",
  pinOptionValues,
  listMaxHeight = 300,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dropdownBox, setDropdownBox] = useState({
    top: 0,
    left: 0,
    width: 0,
    maxHeight: 250,
  });

  const updateDropdownPosition = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const spaceBelow = viewportHeight - r.bottom - 12;
    const spaceAbove = r.top - 12;
    const preferredMaxHeight = Math.min(Math.max(280, listMaxHeight), 360);
    const openUpward = spaceBelow < 180 && spaceAbove > spaceBelow;
    const safeMaxHeight = Math.max(
      120,
      Math.min(preferredMaxHeight, openUpward ? spaceAbove : spaceBelow)
    );
    setDropdownBox({
      top: openUpward ? Math.max(8, r.top - safeMaxHeight - 4) : r.bottom + 4,
      left: r.left,
      width: r.width,
      maxHeight: safeMaxHeight,
    });
  }, [listMaxHeight]);

  const selectedOption = useMemo(
    () => options.find((opt) => opt.value === value),
    [options, value]
  );

  const filteredOptions = useMemo(() => {
    const pinSet = new Set(pinOptionValues ?? []);
    const pinned = pinSet.size > 0 ? options.filter((o) => pinSet.has(o.value)) : [];
    const unpinned = pinSet.size > 0 ? options.filter((o) => !pinSet.has(o.value)) : options;

    if (!searchTerm.trim()) {
      return options;
    }
    const term = normalizeSearchString(searchTerm);
    const matchedUnpinned = unpinned.filter((opt) =>
      normalizeSearchString(optionSearchHaystack(opt)).includes(term)
    );
    if (!pinSet.size) {
      return matchedUnpinned;
    }
    const pinnedValues = new Set(pinned.map((p) => p.value));
    return [...pinned, ...matchedUnpinned.filter((m) => !pinnedValues.has(m.value))];
  }, [options, searchTerm, pinOptionValues]);

  useLayoutEffect(() => {
    if (!isOpen) return;
    updateDropdownPosition();
    const onScrollOrResize = () => updateDropdownPosition();
    window.addEventListener("resize", onScrollOrResize);
    document.addEventListener("scroll", onScrollOrResize, true);
    return () => {
      window.removeEventListener("resize", onScrollOrResize);
      document.removeEventListener("scroll", onScrollOrResize, true);
    };
  }, [isOpen, updateDropdownPosition]);

  // Close on click outside (inclui painel em portal no body)
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const t = event.target as Node;
      if (containerRef.current?.contains(t)) return;
      if (dropdownRef.current?.contains(t)) return;
      setIsOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") setIsOpen(false);
    if (e.key === "Tab") setIsOpen(false);
    if (e.key === "Enter" && !isOpen) {
      setIsOpen(true);
      e.preventDefault();
    }
  };

  useEffect(() => {
    if (isOpen) {
      setSearchTerm("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  return (
    <div 
      className={cn("relative w-full", className, disabled && "opacity-50 pointer-events-none")} 
      ref={containerRef}
      onKeyDown={handleKeyDown}
    >
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        className={cn(
          "w-full flex items-center justify-between p-2 rounded-lg border bg-background transition-all outline-none text-left text-sm",
          isOpen ? "border-primary ring-2 ring-primary/20" : "border-border hover:border-primary/50",
          !selectedOption && "text-muted-foreground"
        )}
      >
        <span className="truncate">
          {selectedOption
            ? selectedOption.label
            : value
              ? unknownSelectionLabel
              : placeholder}
        </span>
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", isOpen && "rotate-180")} />
      </button>

      {/* Actual hidden select for form compatibility if needed */}
      <select 
        value={value} 
        onChange={(e) => onChange(e.target.value)} 
        required={required} 
        className="sr-only" 
        tabIndex={-1}
      >
        <option value="">{placeholder}</option>
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>

      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {isOpen && (
              <motion.div
                initial={{ opacity: 0, y: -10, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.98 }}
                transition={{ duration: 0.15 }}
                style={{
                  position: "fixed",
                  top: dropdownBox.top,
                  left: dropdownBox.left,
                  width: dropdownBox.width,
                  zIndex: 10000,
                }}
                className="bg-card rounded-xl border border-border shadow-2xl overflow-hidden backdrop-blur-md"
              >
                <div ref={dropdownRef}>
                {/* Search Input */}
                <div className="p-2 border-b border-border bg-accent/30 flex items-center gap-2">
                  <Search className="h-4 w-4 text-muted-foreground ml-2" />
                  <input
                    ref={inputRef}
                    type="text"
                    className="w-full bg-transparent border-none outline-none text-sm p-1.5"
                    placeholder={searchInputPlaceholder}
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                  />
                  {searchTerm && (
                    <button
                      type="button"
                      onClick={() => setSearchTerm("")}
                      className="p-1 hover:bg-accent rounded-full"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>

                {/* Options List */}
                <div
                  className="overflow-y-auto p-1 py-1.5 custom-scrollbar"
                  style={{ maxHeight: dropdownBox.maxHeight }}
                >
                  {filteredOptions.length === 0 ? (
                    <div className="p-4 text-center text-xs text-muted-foreground italic">
                      {emptyMessage}
                    </div>
                  ) : (
                    filteredOptions.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        disabled={option.disabled === true}
                        aria-disabled={option.disabled === true}
                        title={option.disabled ? option.sublabel ?? "Opção indisponível" : undefined}
                        onClick={() => {
                          if (option.disabled) return;
                          onChange(option.value);
                          setIsOpen(false);
                        }}
                        className={cn(
                          "w-full flex items-center justify-between p-2 rounded-lg text-left text-sm transition-colors group mb-0.5",
                          option.disabled
                            ? "cursor-not-allowed opacity-50 text-muted-foreground hover:bg-transparent"
                            : value === option.value
                              ? "bg-primary text-primary-foreground font-bold"
                              : "hover:bg-primary/10 text-foreground"
                        )}
                      >
                        <div className="flex flex-col min-w-0">
                          <span className="truncate">{option.label}</span>
                          {option.sublabel && (
                            <span
                              className={cn(
                                "text-[10px] truncate leading-tight",
                                value === option.value && !option.disabled
                                  ? "text-primary-foreground/80"
                                  : "text-muted-foreground"
                              )}
                            >
                              {option.sublabel}
                            </span>
                          )}
                        </div>
                        {value === option.value && !option.disabled && (
                          <Check className="h-4 w-4 flex-shrink-0 ml-2" />
                        )}
                      </button>
                    ))
                  )}
                </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </div>
  );
};
