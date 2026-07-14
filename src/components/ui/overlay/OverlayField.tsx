import React, { useId } from "react";
import { cn } from "@/src/lib/utils";
import {
  OVERLAY_LABEL,
  OVERLAY_LABEL_DENSE,
} from "@/src/lib/overlay/overlayTypography";

/** Densidade do label do campo. Ver `overlayTypography.ts`. */
export type OverlayFieldDensity = "default" | "dense";

export type OverlayFieldProps = {
  label: React.ReactNode;
  /** Marca o campo como obrigatório (mostra `*` no label). */
  required?: boolean;
  /** Descrição/ajuda abaixo do input. */
  description?: React.ReactNode;
  /** Mensagem de erro. Se presente, sobrescreve `description` e marca o input. */
  error?: React.ReactNode;
  /** Slot à direita do label (ex.: contador de caracteres, ajuda). */
  hint?: React.ReactNode;
  /**
   * Densidade: `dense` (uppercase 10px, para painéis analíticos) ou `default`
   * (font-medium sm, para forms de cadastro/edição).
   */
  density?: OverlayFieldDensity;
  /**
   * Renderer do controle. Recebe o `id` para vincular ao `<label htmlFor>`.
   * Deixe o control aceitar spread para `id`/`aria-*`.
   */
  children: (fieldProps: {
    id: string;
    "aria-describedby"?: string;
    "aria-invalid"?: boolean;
  }) => React.ReactNode;
  /** Tamanho em colunas dentro de um `<OverlayFieldGrid>` (1..4). */
  colSpan?: 1 | 2 | 3 | 4;
  className?: string;
  testId?: string;
};

const COL_SPAN: Record<NonNullable<OverlayFieldProps["colSpan"]>, string> = {
  1: "sm:col-span-1",
  2: "sm:col-span-2",
  3: "sm:col-span-3",
  4: "sm:col-span-4",
};

/**
 * Campo de formulário canônico para overlays. Cuida do `<label>`, `id`,
 * descrição, erro e vinculação `aria-*`. O renderer `children` deve aplicar
 * as props recebidas no controle real (input, select, textarea, custom).
 *
 * ```tsx
 * <OverlayField label="E-mail" required error={emailError}>
 *   {(p) => (
 *     <OverlayInput {...p} type="email" value={email} onChange={...} />
 *   )}
 * </OverlayField>
 * ```
 */
export function OverlayField({
  label,
  required = false,
  description,
  error,
  hint,
  density = "default",
  children,
  colSpan,
  className,
  testId,
}: OverlayFieldProps): JSX.Element {
  const controlId = useId();
  const descriptionId = description || error ? `${controlId}-desc` : undefined;
  const labelClass = density === "dense" ? OVERLAY_LABEL_DENSE : OVERLAY_LABEL;

  return (
    <div
      data-testid={testId}
      className={cn(
        "flex min-w-0 flex-col gap-1",
        colSpan && COL_SPAN[colSpan],
        className
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={controlId} className={labelClass}>
          {label}
          {required ? (
            <span className="ml-0.5 text-rose-500" aria-hidden="true">
              *
            </span>
          ) : null}
        </label>
        {hint ? <span className="text-[11px] text-muted-foreground">{hint}</span> : null}
      </div>
      {children({
        id: controlId,
        "aria-describedby": descriptionId,
        "aria-invalid": error ? true : undefined,
      })}
      {error ? (
        <p id={descriptionId} className="text-[11px] font-medium text-rose-600">
          {error}
        </p>
      ) : description ? (
        <p id={descriptionId} className="text-[11px] text-muted-foreground">
          {description}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Grid responsivo para agrupar `<OverlayField>`. 1 col mobile, N cols no `sm`.
 */
export function OverlayFieldGrid({
  children,
  columns = 2,
  className,
}: {
  children: React.ReactNode;
  columns?: 1 | 2 | 3 | 4;
  className?: string;
}): JSX.Element {
  const columnsClass: Record<number, string> = {
    1: "sm:grid-cols-1",
    2: "sm:grid-cols-2",
    3: "sm:grid-cols-3",
    4: "sm:grid-cols-4",
  };
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-3",
        columnsClass[columns],
        className
      )}
    >
      {children}
    </div>
  );
}
