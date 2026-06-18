import React from "react";

export function ExecutiveNarrativeBullets({
  title,
  bullets,
  emptyMessage = "Sem leitura executiva para os filtros aplicados.",
}: {
  title?: string;
  bullets: string[];
  emptyMessage?: string;
}) {
  if (bullets.length === 0) {
    return (
      <div className="finance-executive-narrative-box">
        {title ? <h3 className="finance-executive-narrative-title">{title}</h3> : null}
        <p className="finance-executive-reading">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="finance-executive-narrative-box" data-testid="executive-narrative-bullets">
      {title ? <h3 className="finance-executive-narrative-title">{title}</h3> : null}
      <ul className="finance-executive-narrative-bullets">
        {bullets.map((bullet) => (
          <li key={bullet}>{bullet}</li>
        ))}
      </ul>
    </div>
  );
}
