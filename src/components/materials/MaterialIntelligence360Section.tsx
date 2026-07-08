import React from "react";
import { cn } from "@/src/lib/utils";

type Props = {
  id: string;
  title: string;
  description: string;
  children?: React.ReactNode;
  className?: string;
};

export function MaterialIntelligence360Section({
  id,
  title,
  description,
  children,
  className,
}: Props) {
  return (
    <section
      className={cn(
        "rounded-xl border border-border bg-card p-5 space-y-3",
        className
      )}
      aria-labelledby={`material-intelligence-360-${id}-heading`}
      data-testid={`material-intelligence-360-section-${id}`}
    >
      <header className="space-y-0.5">
        <h4
          id={`material-intelligence-360-${id}-heading`}
          className="text-sm font-semibold text-foreground"
        >
          {title}
        </h4>
        <p className="text-xs text-muted-foreground">{description}</p>
      </header>
      {children}
    </section>
  );
}

type PlaceholderProps = {
  id: string;
  title: string;
  description: string;
  message: string;
  icon?: React.ReactNode;
};

export function MaterialIntelligence360SectionPlaceholder({
  id,
  title,
  description,
  message,
  icon,
}: PlaceholderProps) {
  return (
    <MaterialIntelligence360Section id={id} title={title} description={description}>
      <div
        className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 px-4 py-8 text-center"
        data-testid={`material-intelligence-360-placeholder-${id}`}
      >
        {icon ? <div className="mb-2 text-muted-foreground opacity-60">{icon}</div> : null}
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
    </MaterialIntelligence360Section>
  );
}
