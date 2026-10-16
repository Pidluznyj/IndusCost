import React, { useEffect, useState } from "react";
import { fetchEmployeePerformanceHistory } from "@/src/lib/hrPerformance/performanceClient";
import { usePerformanceFeature } from "./usePerformanceFeature";

/** Seção da ficha. Não substitui a avaliação de experiência e não mostra ocorrência. */
export function PeoplePerformanceHistorySection({ employeeId }: { employeeId: string }) {
  const enabled = usePerformanceFeature();
  const [items, setItems] = useState<Awaited<ReturnType<typeof fetchEmployeePerformanceHistory>>["cycles"]>([]);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (enabled !== true) return;
    void fetchEmployeePerformanceHistory(employeeId)
      .then((result) => setItems(result.cycles))
      .catch(() => setHidden(true));
  }, [enabled, employeeId]);
  if (enabled !== true || hidden) return null;
  return (
    <section className="mt-6 rounded-xl border border-border bg-card p-4">
      <h3 className="font-semibold">Desempenho, cultura e potencial</h3>
      {items.length === 0 && <p className="mt-2 text-sm text-muted-foreground">Nenhum ciclo liberado para esta pessoa.</p>}
      <ul className="mt-3 flex flex-col gap-3">
        {items.map((item) => (
          <li key={`${item.cycleName}-${item.periodLabel}`} className="text-sm">
            <p className="font-medium">{item.cycleName} · {item.periodLabel}</p>
            <p className="text-muted-foreground">{item.roleName} · {item.departmentName} · {item.eligibility}</p>
            {item.quadrant && <p>Resultado homologado: {item.quadrant}. Cultura: {item.cultureBand}</p>}
            {item.feedback && (
              <p>Ponto forte: {item.feedback.strength}. A desenvolver: {item.feedback.improvement}. Ciência: {item.feedback.acknowledgedAt ? "registrada" : "pendente"}. Concordância: {item.feedback.agreedAt ? "registrada" : "não exigida"}.</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
