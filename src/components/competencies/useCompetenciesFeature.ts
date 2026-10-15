/**
 * Status da feature flag do módulo (uma consulta por sessão de página; falha = desligado).
 */
import { useEffect, useState } from "react";
import { fetchCompetenciesFeatureStatus } from "@/src/lib/competencies/competencyClient";

let cached: Promise<boolean> | null = null;

export function loadCompetenciesFeature(): Promise<boolean> {
  if (!cached) {
    cached = fetchCompetenciesFeatureStatus()
      .then((s) => s.enabled === true)
      .catch(() => {
        cached = null; // tenta de novo na próxima montagem
        return false;
      });
  }
  return cached;
}

/** null = carregando; true/false = status do servidor. */
export function useCompetenciesFeature(active = true): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    void loadCompetenciesFeature().then((v) => alive && setEnabled(v));
    return () => {
      alive = false;
    };
  }, [active]);
  return active ? enabled : false;
}
