import React, { useEffect, useMemo, useRef, useState } from "react";
import { SearchableSelect } from "@/src/components/shared/SearchableSelect";
import { fetchJsonOk } from "@/src/lib/http";

export type SimulationProductOption = {
  id: string;
  sku: string;
  name: string;
  type?: string | null;
};

const SEARCH_DEBOUNCE_MS = 280;
const MIN_CHARS = 2;

type Props = {
  value: string;
  onChange: (value: string, option: SimulationProductOption | null) => void;
  /** Rótulo do item já selecionado (a lista só carrega sob busca). */
  selected?: SimulationProductOption | null;
  placeholder?: string;
  disabled?: boolean;
};

/**
 * Seletor de produto/componente com busca no servidor (sem carregar custo de todos os itens).
 * Debounce + AbortController + guarda de corrida: só a resposta da busca mais recente é usada.
 */
export function SimulationProductSelect({ value, onChange, selected, placeholder, disabled }: Props) {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<SimulationProductOption[]>([]);
  const [searching, setSearching] = useState(false);
  const requestSeq = useRef(0);

  useEffect(() => {
    const q = term.trim();
    if (q.length < MIN_CHARS) {
      requestSeq.current += 1;
      setResults([]);
      setSearching(false);
      return;
    }
    const seq = ++requestSeq.current;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const payload = (await fetchJsonOk(
          `/api/simulations/product-options?q=${encodeURIComponent(q)}`,
          { signal: controller.signal }
        )) as { items?: SimulationProductOption[] };
        if (seq === requestSeq.current) setResults(Array.isArray(payload?.items) ? payload.items : []);
      } catch {
        if (seq === requestSeq.current) setResults([]);
      } finally {
        if (seq === requestSeq.current) setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [term]);

  const options = useMemo(() => {
    const byId = new Map<string, SimulationProductOption>();
    if (selected?.id) byId.set(selected.id, selected);
    for (const item of results) byId.set(item.id, item);
    return [...byId.values()].map((p) => ({
      value: p.id,
      label: `${p.sku} — ${p.name}`,
      sublabel: p.type === "COMPONENT" ? "Componente cadastrado" : "Produto cadastrado",
      searchTerms: `${p.sku} ${p.name}`,
    }));
  }, [results, selected]);

  return (
    <SearchableSelect
      placeholder={placeholder ?? "Digite SKU ou nome..."}
      searchInputPlaceholder="Digite ao menos 2 caracteres..."
      emptyMessage={
        term.trim().length < MIN_CHARS ? "Digite SKU ou nome para buscar." : "Nenhum item encontrado."
      }
      options={options}
      value={value}
      disabled={disabled}
      remoteSearch
      searching={searching}
      onSearchTermChange={setTerm}
      onChange={(val) => {
        const option = results.find((p) => p.id === val) ?? (selected?.id === val ? selected : null);
        onChange(val, option ?? null);
      }}
    />
  );
}
