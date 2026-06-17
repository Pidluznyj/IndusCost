import React from "react";

export function ExecutiveNarrativeBox({
  title,
  body,
}: {
  title?: string;
  body: string;
}) {
  return (
    <div className="finance-executive-narrative-box">
      {title ? <h3 className="finance-executive-narrative-title">{title}</h3> : null}
      <p className="finance-executive-reading">{body}</p>
    </div>
  );
}
