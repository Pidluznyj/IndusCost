import { CircleHelp } from "lucide-react";
import { cn } from "@/src/lib/utils";

export function TourHelpButton({
  onClick,
  className,
  label = "Como usar",
}: {
  onClick: () => void;
  className?: string;
  /** Texto do botão (acessível e visível) */
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium border border-border bg-card hover:bg-accent text-foreground shrink-0",
        className
      )}
      aria-label={`Abrir tour guiado: ${label}`}
    >
      <CircleHelp className="h-4 w-4 text-primary" aria-hidden />
      {label}
    </button>
  );
}
