import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { AlertCircle, Loader2 } from "lucide-react";
import { buildPublicReservationLinkApiUrl } from "@/src/lib/fleetPublicReservationLink";

type ResolveResponse = {
  targetUrl?: string;
  error?: string;
};

function slugFromLocation(pathname: string, sub?: string): string {
  const trimmed = pathname.replace(/^\/+|\/+$/g, "");
  if (sub) {
    const head = trimmed.split("/")[0] ?? "";
    return head ? `${head}/${sub}` : sub;
  }
  return trimmed;
}

export function FleetPublicReservationShortLinkPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { sub } = useParams<{ sub?: string }>();

  const slug = useMemo(
    () => slugFromLocation(location.pathname, sub),
    [location.pathname, sub]
  );

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function resolve() {
      if (!slug) {
        setErrorMsg("Link inválido.");
        setLoading(false);
        return;
      }

      setLoading(true);
      setErrorMsg(null);

      try {
        const res = await fetch(buildPublicReservationLinkApiUrl(slug));
        const body = (await res.json().catch(() => ({}))) as ResolveResponse;

        if (cancelled) return;

        if (res.ok && body.targetUrl?.startsWith("/public/fleet/reservation/")) {
          navigate(body.targetUrl, { replace: true });
          return;
        }

        if (res.status === 403) {
          setErrorMsg(body.error?.trim() || "Solicitação pública desativada.");
        } else if (res.status === 404) {
          setErrorMsg(body.error?.trim() || "Link não encontrado.");
        } else if (res.status === 400) {
          setErrorMsg(body.error?.trim() || "Slug inválido.");
        } else {
          setErrorMsg(body.error?.trim() || "Não foi possível abrir o link de reserva.");
        }
        setLoading(false);
      } catch {
        if (!cancelled) {
          setErrorMsg("Erro de conexão. Tente novamente.");
          setLoading(false);
        }
      }
    }

    void resolve();
    return () => {
      cancelled = true;
    };
  }, [slug, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-slate-50">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-700" />
        <p className="text-sm text-slate-600">Abrindo reserva pública…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-slate-50 p-6">
      <AlertCircle className="h-10 w-10 text-amber-600" />
      <h1 className="text-lg font-semibold text-slate-900">Reserva pública</h1>
      <p className="text-sm text-slate-700 text-center max-w-md">{errorMsg}</p>
      <p className="text-xs text-slate-500 text-center max-w-sm">
        Este link não exige login no ERP. Login é necessário apenas para a equipe interna consultar
        ou aprovar solicitações.
      </p>
    </div>
  );
}
