import { useCallback, useEffect, useRef, useState } from "react";
import { fetchFiscal360 } from "@/src/lib/finance/fiscal360/fiscal360Client";

/**
 * Busca um recurso materializado da 360°. Troca de filtro → nova leitura de agregados indexados
 * (nunca recálculo). `refreshKey` muda apenas quando o usuário pede "Atualizar".
 */
export type Fiscal360ResourceState<T> = { data: T | null; loading: boolean; error: string | null; reload: () => void };

export function useFiscal360Resource<T>(path: string | null, query: string, refreshKey: number): Fiscal360ResourceState<T> {
  const [data, setData]: [T | null, (v: T | null) => void] = useState<T | null>(null);
  const [loading, setLoading]: [boolean, (v: boolean) => void] = useState(false);
  const [error, setError]: [string | null, (v: string | null) => void] = useState<string | null>(null);
  const seq: { current: number } = useRef(0);
  const [localTick, setLocalTick]: [number, (fn: (t: number) => number) => void] = useState(0);

  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    const current = ++seq.current;
    setLoading(true);
    setError(null);
    fetchFiscal360<T>(path, query, controller.signal)
      .then((d) => {
        if (current === seq.current) setData(d);
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted || current !== seq.current) return;
        setError(e instanceof Error ? e.message : "Falha ao carregar.");
      })
      .finally(() => {
        if (current === seq.current) setLoading(false);
      });
    return () => controller.abort();
  }, [path, query, refreshKey, localTick]);

  const reload = useCallback(() => setLocalTick((t) => t + 1), []);
  return { data, loading, error, reload };
}
