/**
 * PERM-39 — bloqueia conteúdo negado, modal com OK, só então redireciona.
 */

import React, { useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/src/contexts/AuthContext";
import { NoPermissionsGranted } from "@/src/components/NoPermissionsGranted";
import {
  Overlay,
  OverlayBody,
  OverlayFooter,
  OverlayHeader,
} from "@/src/components/ui/overlay";
import { navigationAccessContextFromAuth } from "@/src/lib/resourceNavigationAccess";
import {
  UNAUTHORIZED_ACCESS_MESSAGE,
  resolveUnauthorizedAccessOutcome,
} from "@/src/lib/unauthorizedAccess";

export type UnauthorizedAccessGateProps = {
  intendedPath?: string;
  /** Aba/seção negada (módulo pode ainda ter view). */
  forceDenied?: boolean;
};

export function UnauthorizedAccessGate({
  intendedPath,
  forceDenied = false,
}: UnauthorizedAccessGateProps): React.ReactElement | null {
  const auth = useAuth();
  const location = useLocation();
  const ctx = navigationAccessContextFromAuth(auth);
  const path = intendedPath ?? location.pathname;
  const outcome = resolveUnauthorizedAccessOutcome({
    ctx,
    pathname: path,
    forceDenied,
  });
  const [acknowledged, setAcknowledged] = useState(false);

  if (outcome.kind === "pending" || outcome.kind === "allowed") {
    return null;
  }

  if (outcome.kind === "no_access") {
    return <NoPermissionsGranted />;
  }

  if (acknowledged) {
    return (
      <Navigate
        to={outcome.fallbackPath}
        replace
        state={{ from: path }}
      />
    );
  }

  return (
    <>
      <div
        className="min-h-[40vh]"
        data-testid="unauthorized-access-blocked"
        aria-hidden
      />
      <Overlay
        open
        onClose={() => {
          /* só o OK confirma — sem dismiss silencioso */
        }}
        dismissOnBackdrop={false}
        dismissOnEsc={false}
        size="sm"
        ariaLabelledBy="unauthorized-access-title"
        testId="unauthorized-access-modal"
      >
        <OverlayHeader
          titleId="unauthorized-access-title"
          title="Acesso não autorizado"
        />
        <OverlayBody>
          <p
            className="text-sm text-foreground leading-relaxed"
            data-testid="unauthorized-access-message"
          >
            {UNAUTHORIZED_ACCESS_MESSAGE}
          </p>
        </OverlayBody>
        <OverlayFooter align="end">
          <button
            type="button"
            data-testid="unauthorized-access-ok"
            className="inline-flex items-center justify-center rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
            onClick={() => setAcknowledged(true)}
          >
            OK
          </button>
        </OverlayFooter>
      </Overlay>
    </>
  );
}
