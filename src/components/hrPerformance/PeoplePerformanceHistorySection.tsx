import React, { useEffect, useState } from "react";
import { fetchEmployeePerformanceHistory, type EmployeeHistory } from "@/src/lib/hrPerformance/performanceClient";
import { CULTURE_BAND_LABELS, ELIGIBILITY_LABELS, PDI_STATUS_LABELS, UNCLASSIFIED_QUADRANT } from "@/src/lib/hrPerformance/performanceDomain";
import { usePerformanceFeature } from "./usePerformanceFeature";

/**
 * Seção da ficha (mesmo registro de Employee). Não substitui a avaliação de experiência e
 * não mostra ocorrência de conduta. Só resultado homologado; o cargo e o setor são os da
 * época do ciclo. Troca de metodologia entre ciclos fica sinalizada.
 */
export function PeoplePerformanceHistorySection({ employeeId }: { employeeId: string }) {
  const enabled = usePerformanceFeature();
  const [items, setItems] = useState<EmployeeHistory["cycles"]>([]);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (enabled !== true) return;
    void fetchEmployeePerformanceHistory(employeeId)
      .then((result) => setItems(result.cycles))
      .catch(() => setHidden(true));
  }, [enabled, employeeId]);
  if (enabled !== true || hidden) return null;
  return (
    <section className="mt-6 rounded-xl border border-border bg-card p-4" data-testid="people-performance-history">
      <h3 className="font-semibold">Desempenho, cultura e potencial</h3>
      <p className="text-xs text-muted-foreground">Somente ciclos homologados mostram resultado. Cargo e setor são os da época.</p>
      {items.length === 0 && <p className="mt-2 text-sm text-muted-foreground">Nenhum ciclo liberado para esta pessoa.</p>}
      <ul className="mt-3 flex flex-col gap-3">
        {items.map((item) => (
          <li key={item.cycleId} className="rounded-lg border border-border p-3 text-sm">
            <p className="font-medium">
              {item.cycleName} · {item.periodLabel}
            </p>
            <p className="text-xs text-muted-foreground">
              {item.roleName} · {item.departmentName} · líder {item.managerName ?? "—"} · {ELIGIBILITY_LABELS[item.eligibility as keyof typeof ELIGIBILITY_LABELS] ?? item.eligibility} · modelo v{item.modelVersion}
            </p>
            {item.quadrant ? (
              <p className="mt-1">
                {item.quadrant === UNCLASSIFIED_QUADRANT ? "Sem classificação" : item.quadrant} · técnico {item.technical ?? "—"} · potencial {item.potential ?? "—"} · cultura{" "}
                {CULTURE_BAND_LABELS[item.cultureBand as keyof typeof CULTURE_BAND_LABELS] ?? "—"}
              </p>
            ) : (
              <p className="mt-1 text-muted-foreground">Resultado ainda não homologado.</p>
            )}
            {item.comparableWithPrevious === false ? <p className="mt-1 text-xs text-amber-700">Metodologia diferente do ciclo anterior: não compare as médias.</p> : null}
            {item.feedback ? (
              <p className="mt-1">
                Ponto forte: {item.feedback.strength}. A desenvolver: {item.feedback.improvement}. Ciência: {item.feedback.acknowledgedAt ? "registrada" : "pendente"}. Concordância:{" "}
                {item.feedback.agreedAt ? "registrada" : "não registrada"}.
              </p>
            ) : null}
            {item.pdis.length ? (
              <p className="mt-1 text-xs text-muted-foreground">
                PDI: {item.pdis.map((p) => `${p.title} (${PDI_STATUS_LABELS[p.status as keyof typeof PDI_STATUS_LABELS] ?? p.status})`).join("; ")}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
