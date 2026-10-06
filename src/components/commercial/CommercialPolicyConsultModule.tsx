import React, { useEffect, useMemo, useState } from "react";
import { AccessDenied } from "@/src/components/AccessDenied";
import { CommercialPolicyReader } from "@/src/components/security/CommercialPolicyReader";
import { useAuth } from "@/src/contexts/AuthContext";
import {
  downloadAuthenticatedFile,
  loadCurrentCommercialPolicy,
  type PendingPolicy,
} from "@/src/lib/commercialPolicy/commercialPolicyClient";
import { canConsultCommercialPolicy } from "@/src/lib/commercialPolicy/commercialPolicyConsultAccess";
import { parsePolicyChapters } from "@/src/lib/commercialPolicy/policyDocumentFormat";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "empty" }
  | {
      status: "ready";
      version: PendingPolicy;
      myAcceptance: { id: string; acceptedAt: string; evidenceHash: string } | null;
      signer: { name: string; email: string; role: string; jobTitle?: string | null } | null;
    };

/**
 * Consulta institucional da Política Comercial vigente.
 * Somente leitura: conteúdo e PDF vêm da mesma fonte oficial do aceite.
 */
export function CommercialPolicyConsultModule() {
  const auth = useAuth();
  const canView = canConsultCommercialPolicy(auth.authUser);

  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;
    setState({ status: "loading" });
    void loadCurrentCommercialPolicy()
      .then((body) => {
        if (cancelled) return;
        if (!body.version) {
          setState({ status: "empty" });
          return;
        }
        setState({
          status: "ready",
          version: body.version,
          myAcceptance: body.myAcceptance,
          signer: body.signer ?? null,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message =
          error instanceof Error ? error.message : "Não foi possível carregar a política vigente.";
        setState({ status: "error", message });
      });
    return () => {
      cancelled = true;
    };
  }, [canView]);

  const chapters = useMemo(() => {
    if (state.status !== "ready") return [];
    return parsePolicyChapters(state.version.content);
  }, [state]);

  if (!canView) {
    return <AccessDenied intendedPath="/commercial/policy" />;
  }

  if (state.status === "loading") {
    return (
      <div className="flex min-h-[40vh] items-center justify-center px-4 py-10 text-sm text-muted-foreground">
        Carregando política vigente…
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{state.message}</p>
      </div>
    );
  }

  if (state.status === "empty") {
    return (
      <div className="mx-auto max-w-3xl space-y-2 px-4 py-10">
        <h1 className="text-xl font-semibold text-foreground">Política Comercial</h1>
        <p className="text-sm text-muted-foreground">Não há política comercial publicada vigente no momento.</p>
      </div>
    );
  }

  const { version, myAcceptance, signer } = state;
  const label = version.label ?? String(version.version);
  const vigencia = new Date(version.effectiveFrom).toLocaleDateString("pt-BR");
  const publicada = version.publishedAt
    ? new Date(version.publishedAt).toLocaleString("pt-BR")
    : "—";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <section className="border-b border-border bg-card px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Política Comercial
            </p>
            <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
              Política Comercial vigente
            </h1>
            <p className="text-sm text-muted-foreground">
              Versão {label} · Vigente desde {vigencia}
              {version.publishedAt ? ` · Última publicação: ${publicada}` : ""}
            </p>
            {myAcceptance ? (
              <p className="text-xs text-emerald-800">
                Seu aceite desta versão foi registrado em{" "}
                {new Date(myAcceptance.acceptedAt).toLocaleString("pt-BR")}.
              </p>
            ) : null}
          </div>
          <p className="max-w-sm text-xs leading-relaxed text-muted-foreground sm:text-right">
            Documento oficial controlado. Somente consulta — sem edição, publicação ou alteração de
            vigência nesta tela.
          </p>
        </div>
      </section>

      {chapters.length > 0 ? (
        <CommercialPolicyReader
          mode="consult"
          chapters={chapters}
          title={version.title}
          versionLabel={label}
          effectiveFrom={version.effectiveFrom}
          publishedAt={version.publishedAt}
          approver={version.approver ?? null}
          commissionMatrix={version.commissionMatrix ?? null}
          signer={signer}
          acceptance={
            myAcceptance
              ? {
                  id: myAcceptance.id,
                  acceptedAt: myAcceptance.acceptedAt,
                  evidenceHash: myAcceptance.evidenceHash,
                }
              : null
          }
          onGeneratePdf={() =>
            void downloadAuthenticatedFile(
              `/api/commercial-policy/versions/${version.id}/document`,
              "POL-COM-001-copia-controlada.pdf"
            )
          }
        />
      ) : (
        <div className="mx-auto max-w-3xl px-4 py-10">
          <p className="text-sm text-muted-foreground">
            A versão vigente não possui conteúdo estruturado para leitura.
          </p>
        </div>
      )}

      <footer className="border-t border-border bg-card px-4 py-3 text-xs text-muted-foreground sm:px-6">
        <div className="mx-auto flex max-w-7xl flex-wrap gap-x-4 gap-y-1">
          <span>Documento oficial</span>
          <span>Versão {label}</span>
          <span>Vigência: {vigencia}</span>
          <span>Última publicação: {publicada}</span>
          <span className="break-all">SHA-256 {version.contentHash}</span>
        </div>
      </footer>
    </div>
  );
}
