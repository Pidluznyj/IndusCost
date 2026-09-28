import React, { useEffect, useState } from "react";
import { downloadAuthenticatedFile, loadMyPolicyAcceptances } from "@/src/lib/commercialPolicy/commercialPolicyClient";

export const MyCommercialAcceptancesPage: React.FC = () => {
  const [rows, setRows] = useState<Array<{ id: string; acceptedAt: string; evidenceHash: string; policyContentHash: string }>>([]);

  useEffect(() => {
    void loadMyPolicyAcceptances().then((data) => setRows(data.acceptances));
  }, []);

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-6">
      <h1 className="text-lg font-bold">Documentos e aceites</h1>
      <p className="text-sm text-muted-foreground">Política Comercial assinada por você.</p>
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum aceite registrado.</p> : null}
      <ul className="space-y-3">
        {rows.map((row) => (
          <li key={row.id} className="rounded-xl border border-border bg-card p-4 text-sm">
            <p className="font-semibold">Política Comercial</p>
            <p className="text-xs text-muted-foreground">Aceita em {new Date(row.acceptedAt).toLocaleString("pt-BR")}</p>
            <p className="break-all text-[11px] text-muted-foreground">Pacote {row.evidenceHash}</p>
            <button
              type="button"
              className="mt-2 text-xs font-semibold text-primary"
              onClick={() => void downloadAuthenticatedFile(`/api/commercial-policy/acceptances/${row.id}/receipt`, `aceite-${row.id}.pdf`)}
            >
              Baixar comprovante
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};
