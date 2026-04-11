import React, { useState, useRef, useEffect, useMemo } from "react";
import { Search, ChevronDown, X, Check } from "lucide-react";
import { cn, normalizeSearchString } from "@/src/lib/utils";
import { motion, AnimatePresence } from "motion/react";

export interface SelectOption {
  value: string;
  label: string;
  sublabel?: string;
  searchTerms?: string; // Additional terms to match against (e.g. SKU)
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
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedOption = useMemo(
    () => options.find((opt) => opt.value === value),
    [options, value]
  );

  const filteredOptions = useMemo(() => {
    if (!searchTerm.trim()) return options;
    const term = normalizeSearchString(searchTerm);
    return options.filter((opt) =>
      normalizeSearchString(optionSearchHaystack(opt)).includes(term)
    );
  }, [options, searchTerm]);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
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

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.98 }}
            animate={{ opacity: 1, y: 4, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.98 }}
            className="absolute z-[100] w-full bg-card rounded-xl border border-border shadow-2xl overflow-hidden backdrop-blur-md"
          >
            {/* Search Input */}
            <div className="p-2 border-b border-border bg-accent/30 flex items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground ml-2" />
              <input
                ref={inputRef}
                type="text"
                className="w-full bg-transparent border-none outline-none text-sm p-1.5"
                placeholder="Pesquisar..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onClick={(e) => e.stopPropagation()}
              />
              {searchTerm && (
                <button 
                  onClick={() => setSearchTerm("")}
                  className="p-1 hover:bg-accent rounded-full"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            {/* Options List */}
            <div className="max-h-[250px] overflow-y-auto p-1 py-1.5 custom-scrollbar">
              {filteredOptions.length === 0 ? (
                <div className="p-4 text-center text-xs text-muted-foreground italic">
                  {emptyMessage}
                </div>
              ) : (
                filteredOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      onChange(option.value);
                      setIsOpen(false);
                    }}
                    className={cn(
                      "w-full flex items-center justify-between p-2 rounded-lg text-left text-sm transition-colors group mb-0.5",
                      value === option.value 
                        ? "bg-primary text-primary-foreground font-bold" 
                        : "hover:bg-primary/10 text-foreground"
                    )}
                  >
                    <div className="flex flex-col min-w-0">
                      <span className="truncate">{option.label}</span>
                      {option.sublabel && (
                        <span className={cn(
                          "text-[10px] truncate leading-tight",
                          value === option.value ? "text-primary-foreground/80" : "text-muted-foreground"
                        )}>
                          {option.sublabel}
                        </span>
                      )}
                    </div>
                    {value === option.value && <Check className="h-4 w-4 flex-shrink-0 ml-2" />}
                  </button>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
