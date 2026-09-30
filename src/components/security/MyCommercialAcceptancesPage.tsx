import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { COMMERCIAL_POLICY_ROUTE } from "@/src/components/RequireAuth";
import {
  downloadAuthenticatedFile,
  loadMyPolicyAcceptances,
  loadPendingPolicy,
  type PendingPolicy,
} from "@/src/lib/commercialPolicy/commercialPolicyClient";

type Acceptance = { id: string; acceptedAt: string; evidenceHash: string; policyContentHash: string };

export const MyCommercialAcceptancesPage: React.FC = () => {
  const navigate = useNavigate();
  const [rows, setRows] = useState<Acceptance[]>([]);
  const [pending, setPending] = useState<PendingPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([
      loadMyPolicyAcceptances(),
      // Perfil fora do público da política responde 403: não há pendência a mostrar.
      loadPendingPolicy().catch(() => null),
    ])
      .then(([mine, pendingResult]) => {
        if (!active) return;
        setRows(mine.acceptances);
        setPending(pendingResult?.pending ? pendingResult.version : null);
      })
      .catch(() => {
        if (active) setError("Não foi possível carregar seus aceites. Tente novamente.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-6">
      <h1 className="text-lg font-bold">Documentos e aceites</h1>
      <p className="text-sm text-muted-foreground">Política Comercial: o que falta você ler e aceitar e o que já foi assinado por você.</p>
      {loading ? <p className="text-sm text-muted-foreground">Carregando…</p> : null}
      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
      {pending ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950" data-testid="my-acceptances-pending">
          <p className="font-semibold">Aceite pendente — {pending.title}</p>
          <p className="mt-1 text-xs">
            Versão {pending.label ?? pending.version}, vigente a partir de {new Date(pending.effectiveFrom).toLocaleDateString("pt-BR")}. A leitura e o aceite são
            obrigatórios para continuar usando o sistema.
          </p>
          <button
            type="button"
            className="mt-3 inline-flex items-center justify-center rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
            onClick={() => navigate(COMMERCIAL_POLICY_ROUTE)}
          >
            Ler e aceitar a política
          </button>
        </div>
      ) : null}
      {!loading && !error && !pending && rows.length === 0 ? (
        <p className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground" data-testid="my-acceptances-empty">
          Nenhuma política publicada aguardando o seu aceite e nenhum aceite registrado. Quando uma versão da Política Comercial for publicada, ela será
          apresentada para leitura e aceite no seu próximo acesso.
        </p>
      ) : null}
      <ul className="space-y-3">
        {rows.map((row) => (
          <li key={row.id} className="rounded-xl border border-border bg-card p-4 text-sm">
            <p className="font-semibold">Política Comercial</p>
            <p className="text-xs text-muted-foreground">Aceita em {new Date(row.acceptedAt).toLocaleString("pt-BR")}</p>
            <p className="break-all text-[11px] text-muted-foreground">Pacote {row.evidenceHash}</p>
            <button
              type="button"
              className="mt-2 text-xs font-semibold text-primary"
              onClick={() => void downloadAuthenticatedFile(`/api/commercial-policy/acceptances/${row.id}/receipt`, `certificado-de-aceite-${row.id}.pdf`)}
            >
              Baixar certificado de aceite
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};
