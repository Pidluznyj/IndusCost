import React, { useEffect, useMemo, useState } from "react";
import { Hash, Loader2, Lock, MapPin, PenLine, Search, UserRound } from "lucide-react";
import { OverlayField, OverlayFieldGrid, OverlayInput, OverlaySection } from "@/src/components/ui/overlay";
import { fetchCertificateSigners, saveCertificateSettings } from "@/src/lib/competencies/competencyClient";
import {
  CERTIFICATE_ISSUE_PLACE,
  CERTIFICATE_SIGNER_MAX,
  formatCertificateNumber,
  parseCertificateSettingsBody,
  type CertificateSettingsDto,
  type CertificateSignerOptionDto,
} from "@/src/lib/competencies/trainingCertificate";
import { cn } from "@/src/lib/utils";
import { BTN_PRIMARY, BTN_SECONDARY } from "../competencyUi";

type Mode = "EMPLOYEE" | "MANUAL";

function formatDateTimeBr(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

/** Linha somente leitura: local fixo e numeração gerada pelo sistema. */
function LockedRow({ icon, label, value, hint, testId }: { icon: React.ReactNode; label: string; value: React.ReactNode; hint: string; testId?: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2.5" data-testid={testId}>
      <span className="mt-0.5 text-muted-foreground" aria-hidden>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="font-medium text-foreground">{value}</p>
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      </div>
      <Lock className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Não editável" />
    </div>
  );
}

/**
 * Assinatura e numeração (configuração única da empresa).
 * Quem assina: pessoa do sistema (nome e cargo do cadastro) ou digitado manualmente.
 * Local de emissão fixo (Curitiba – PR); numeração única, sequencial e não editável.
 */
export function CertificateSettingsSection({
  settings,
  companyName,
  hasLogo,
  canManage,
  busy,
  onSaved,
  onError,
  setBusy,
}: {
  settings: CertificateSettingsDto;
  companyName: string | null;
  hasLogo: boolean;
  canManage: boolean;
  busy: string | null;
  setBusy: (key: string | null) => void;
  onSaved: (message: string) => Promise<void> | void;
  onError: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState<Mode>("EMPLOYEE");
  const [signers, setSigners] = useState<CertificateSignerOptionDto[] | null>(null);
  const [signersError, setSignersError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [manualName, setManualName] = useState("");
  const [manualRole, setManualRole] = useState("");

  const startEdit = () => {
    setMode(settings.signerSource === "MANUAL" ? "MANUAL" : "EMPLOYEE");
    setEmployeeId(settings.signerEmployeeId);
    setManualName(settings.signerSource === "MANUAL" ? settings.signerName ?? "" : "");
    setManualRole(settings.signerSource === "MANUAL" ? settings.signerRole ?? "" : "");
    setQuery("");
    setEditing(true);
  };

  useEffect(() => {
    if (!editing || signers) return;
    const ac = new AbortController();
    fetchCertificateSigners(ac.signal)
      .then((r) => setSigners(r.signers))
      .catch((err) => !ac.signal.aborted && setSignersError(err instanceof Error ? err.message : "Não foi possível carregar as pessoas."));
    return () => ac.abort();
  }, [editing, signers]);

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("pt-BR");
    const list = signers ?? [];
    return q
      ? list.filter((s) => `${s.name} ${s.roleName ?? ""} ${s.departmentName ?? ""}`.toLocaleLowerCase("pt-BR").includes(q))
      : list;
  }, [signers, query]);
  const selected = signers?.find((s) => s.employeeId === employeeId) ?? null;

  const body = mode === "EMPLOYEE" ? { signerEmployeeId: employeeId } : { signerName: manualName, signerRole: manualRole };
  const check = parseCertificateSettingsBody(body);
  const canSave = check.ok && !(mode === "EMPLOYEE" && selected && !selected.roleName);

  const save = async () => {
    if (!check.ok || busy) return;
    setBusy("settings");
    try {
      await saveCertificateSettings(check.value);
      setEditing(false);
      await onSaved("Configuração dos certificados salva.");
    } catch (err) {
      onError(err instanceof Error && err.message ? err.message : "Não foi possível salvar a configuração.");
    } finally {
      setBusy(null);
    }
  };

  const year = new Date().getFullYear();
  const numbering = settings.numberPrefix
    ? `${formatCertificateNumber(settings.numberPrefix, year, 1)}, ${formatCertificateNumber(settings.numberPrefix, year, 2)}…`
    : "Gerada ao salvar (iniciais da empresa + ano + sequência)";

  return (
    <OverlaySection
      title="Assinatura e numeração"
      description="Configuração única para todos os certificados da empresa."
      actions={
        canManage && !editing ? (
          <button type="button" className={BTN_SECONDARY} onClick={startEdit} data-testid="certificate-settings-edit">
            {settings.signerName ? "Trocar quem assina" : "Configurar"}
          </button>
        ) : null
      }
    >
      <div className="space-y-3">
        {editing ? (
          <div className="space-y-3" data-testid="certificate-settings-form">
            <div className="inline-flex rounded-lg border border-border bg-muted/50 p-0.5" role="radiogroup" aria-label="Quem assina">
              {(
                [
                  ["EMPLOYEE", "Pessoa do sistema", <UserRound key="i" className="h-3.5 w-3.5" aria-hidden />],
                  ["MANUAL", "Digitar manualmente", <PenLine key="i" className="h-3.5 w-3.5" aria-hidden />],
                ] as const
              ).map(([value, label, icon]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={mode === value}
                  onClick={() => setMode(value)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                    mode === value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                  data-testid={`certificate-signer-mode-${value.toLowerCase()}`}
                >
                  {icon}
                  {label}
                </button>
              ))}
            </div>

            {mode === "EMPLOYEE" ? (
              <div className="rounded-lg border border-border" data-testid="certificate-signer-picker">
                <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                  <Search className="h-4 w-4 text-muted-foreground" aria-hidden />
                  <input
                    className="h-8 w-full bg-transparent text-sm outline-none"
                    placeholder="Buscar por nome, cargo ou departamento"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    aria-label="Buscar pessoa"
                    data-testid="certificate-signer-search"
                  />
                </div>
                {signersError ? (
                  <p className="px-3 py-3 text-sm text-rose-700">{signersError}</p>
                ) : !signers ? (
                  <p className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Carregando pessoas…
                  </p>
                ) : filtered.length === 0 ? (
                  <p className="px-3 py-3 text-sm text-muted-foreground">Nenhuma pessoa ativa encontrada.</p>
                ) : (
                  <ul className="max-h-56 overflow-y-auto py-1" role="listbox" aria-label="Pessoas">
                    {filtered.map((s) => {
                      const on = s.employeeId === employeeId;
                      return (
                        <li key={s.employeeId}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={on}
                            onClick={() => setEmployeeId(s.employeeId)}
                            className={cn(
                              "flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors",
                              on ? "bg-primary/10" : "hover:bg-muted",
                            )}
                            data-testid="certificate-signer-option"
                          >
                            <span className="min-w-0">
                              <span className={cn("block font-medium", on && "text-primary")}>{s.name}</span>
                              <span className="block text-xs text-muted-foreground">
                                {s.roleName ?? "Sem cargo no cadastro"}
                                {s.departmentName ? ` · ${s.departmentName}` : ""}
                              </span>
                            </span>
                            {on ? <span className="shrink-0 text-xs font-semibold text-primary">Selecionada</span> : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            ) : (
              <OverlayFieldGrid columns={2}>
                <OverlayField label="Quem assina" required>
                  {(fp) => (
                    <OverlayInput {...fp} value={manualName} maxLength={CERTIFICATE_SIGNER_MAX} onChange={(e) => setManualName(e.target.value)} data-testid="certificate-signer-name" />
                  )}
                </OverlayField>
                <OverlayField label="Cargo" required>
                  {(fp) => (
                    <OverlayInput {...fp} value={manualRole} maxLength={CERTIFICATE_SIGNER_MAX} onChange={(e) => setManualRole(e.target.value)} data-testid="certificate-signer-role" />
                  )}
                </OverlayField>
              </OverlayFieldGrid>
            )}

            {mode === "EMPLOYEE" && selected ? (
              <p className={cn("text-xs", selected.roleName ? "text-muted-foreground" : "text-amber-700")} data-testid="certificate-signer-selected">
                {selected.roleName
                  ? `Assinatura: ${selected.name} · ${selected.roleName} (cargo do cadastro)`
                  : "Esta pessoa não tem cargo no cadastro. Ajuste o cadastro ou use “Digitar manualmente”."}
              </p>
            ) : null}

            <div className="flex justify-end gap-2">
              <button type="button" className={BTN_SECONDARY} onClick={() => setEditing(false)} disabled={busy === "settings"}>
                Cancelar
              </button>
              <button type="button" className={BTN_PRIMARY} onClick={() => void save()} disabled={!canSave || Boolean(busy)} data-testid="certificate-settings-save">
                {busy === "settings" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                Salvar configuração
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-3 rounded-lg border border-border px-3 py-2.5" data-testid="certificate-settings-summary">
            <span className="mt-0.5 text-muted-foreground" aria-hidden>
              <UserRound className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-muted-foreground">Quem assina</p>
              {settings.signerInactive ? (
                <p className="font-medium text-amber-700">Pessoa selecionada não está mais ativa: troque quem assina.</p>
              ) : settings.signerName ? (
                <p className="font-medium">
                  {settings.signerName} · {settings.signerRole}
                  <span className="ml-1.5 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {settings.signerSource === "EMPLOYEE" ? "Cadastro" : "Manual"}
                  </span>
                </p>
              ) : (
                <p className="font-medium text-muted-foreground">Não configurado</p>
              )}
              {settings.updatedAt ? (
                <p className="text-[11px] text-muted-foreground">
                  Atualizado em {formatDateTimeBr(settings.updatedAt)}
                  {settings.updatedByName ? ` por ${settings.updatedByName}` : ""}
                </p>
              ) : null}
            </div>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <LockedRow
            icon={<MapPin className="h-4 w-4" />}
            label="Local de emissão"
            value={CERTIFICATE_ISSUE_PLACE}
            hint="Fixo para todos os certificados."
            testId="certificate-settings-place"
          />
          <LockedRow
            icon={<Hash className="h-4 w-4" />}
            label="Registro nº"
            value={<span className={settings.numberPrefix ? "font-mono" : undefined}>{numbering}</span>}
            hint="Único e sequencial por ano, gerado pelo sistema na emissão."
            testId="certificate-settings-numbering"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Empresa (Identidade Visual): <span className="font-medium text-foreground">{companyName ?? "Não cadastrada"}</span> ·{" "}
          {hasLogo ? "logo oficial Lazarios Koppetel" : "sem logo"}
        </p>
      </div>
    </OverlaySection>
  );
}
