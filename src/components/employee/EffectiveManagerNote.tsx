import type { EffectiveManagerView } from "@/src/lib/orgHierarchy";

/**
 * Superior hierárquico calculado pela estrutura organizacional (líderes de unidade).
 * Somente leitura: muda quando muda a liderança das unidades em Estrutura organizacional.
 */
export function EffectiveManagerNote({ view }: { view: EffectiveManagerView | null }) {
  if (!view) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
        Superior hierárquico ainda não calculado. Recarregue a lista de pessoas.
      </div>
    );
  }
  const resolved = view.status === "RESOLVED" && view.managerName;
  const top = view.status === "TOP";
  const tone = resolved || top ? "border-border bg-muted/30" : "border-amber-300 bg-amber-50/80 text-amber-950";
  return (
    <div className={`space-y-1.5 rounded-lg border px-3 py-2.5 text-xs ${tone}`} data-testid="effective-manager">
      <p>
        <span className="font-semibold text-foreground">Superior hierárquico: </span>
        <span className={resolved ? "font-semibold text-foreground" : ""}>
          {resolved ? view.managerName : top ? "nenhum (topo da estrutura)" : "Não definido"}
        </span>
      </p>
      {resolved ? (
        <p className="text-muted-foreground">
          <span className="font-semibold">Origem: </span>
          {view.unitLabel && view.source !== "EXPLICIT_MANAGER" ? `${view.unitLabel} → ${view.sourceLabel.toLowerCase()}` : view.sourceLabel}
        </p>
      ) : (
        <p className={top ? "text-muted-foreground" : ""}>
          <span className="font-semibold">{top ? "Origem: " : "Motivo: "}</span>
          {view.message}
        </p>
      )}
      {view.candidates.length > 0 ? (
        <ul className="list-disc pl-4">
          {view.candidates.map((c) => (
            <li key={`${c.managerId ?? "topo"}-${c.via}`}>
              {c.managerName ?? "topo"} — pela {c.via}
            </li>
          ))}
        </ul>
      ) : null}
      {view.warnings.map((w) => (
        <p key={w} className="text-amber-800">
          {w}
        </p>
      ))}
      <p className="text-[11px] text-muted-foreground">
        Calculado pela estrutura organizacional. Para mudar, ajuste a liderança das unidades em Estrutura organizacional.
      </p>
    </div>
  );
}
