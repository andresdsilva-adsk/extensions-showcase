// Thin React wrappers around the Weave web components, loaded from the public
// Forma design-system CDN. This is the framework-agnostic Weave track and does
// not depend on the Autodesk internal npm registry, so it builds anywhere.

import { useEffect, useRef, type ReactNode } from "react";

const WEAVE_BASE = "https://app.autodeskforma.eu/design-system/v2";
const loaded = new Set<string>();

function ensureBase(): void {
  if (loaded.has("base")) return;
  loaded.add("base");
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `${WEAVE_BASE}/forma/styles/base.css`;
  document.head.appendChild(link);
}

export function ensureWeaveComponent(componentPath: string): void {
  if (loaded.has(componentPath)) return;
  loaded.add(componentPath);
  ensureBase();
  const script = document.createElement("script");
  script.type = "module";
  script.src = `${WEAVE_BASE}/weave/components/${componentPath}`;
  document.head.appendChild(script);
}

export function ensureWeave(): void {
  ensureBase();
  ensureWeaveComponent("button/weave-button.js");
  ensureWeaveComponent("toggle/weave-toggle.js");
  ensureWeaveComponent("dropdown/weave-select.js");
  ensureWeaveComponent("banner/weave-banner.js");
  ensureWeaveComponent("progress/weave-progress.js");
}

interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
  variant?: "solid" | "flat" | "outlined" | "white" | "white-outlined";
  disabled?: boolean;
}

export function WeaveButton({
  children,
  onClick,
  variant = "solid",
  disabled,
}: ButtonProps) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !onClick) return;
    const handler = () => {
      if (!el.hasAttribute("disabled")) onClick();
    };
    el.addEventListener("click", handler);
    return () => el.removeEventListener("click", handler);
  }, [onClick]);

  return (
    <weave-button
      ref={ref}
      variant={variant}
      density="high"
      {...(disabled ? { disabled: true } : {})}
    >
      {children}
    </weave-button>
  );
}

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function WeaveToggle({ checked, onChange }: ToggleProps) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      onChange(Boolean(detail?.checked));
    };
    el.addEventListener("change", handler as EventListener);
    el.addEventListener("input", handler as EventListener);
    return () => {
      el.removeEventListener("change", handler as EventListener);
      el.removeEventListener("input", handler as EventListener);
    };
  }, [onChange]);

  useEffect(() => {
    const el = ref.current as (HTMLElement & { checked?: boolean }) | null;
    if (el) el.checked = checked;
  }, [checked]);

  return <weave-toggle ref={ref} {...(checked ? { checked: true } : {})} />;
}

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
}

export function WeaveSelect({ value, options, onChange }: SelectProps) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const next =
        typeof detail === "string" ? detail : detail?.value ?? detail?.text;
      if (next != null) onChange(String(next));
    };
    el.addEventListener("change", handler as EventListener);
    return () => el.removeEventListener("change", handler as EventListener);
  }, [onChange]);

  return (
    <weave-select ref={ref} density="high" value={value}>
      {options.map((opt) => (
        <weave-select-option
          key={opt.value}
          value={opt.value}
          {...(opt.value === value ? { selected: true } : {})}
        >
          {opt.label}
        </weave-select-option>
      ))}
    </weave-select>
  );
}

interface BannerProps {
  variant?: "info" | "success" | "warning" | "error";
  children: ReactNode;
}

export function WeaveBanner({ variant = "info", children }: BannerProps) {
  return (
    <weave-banner density="high" variant={variant}>
      {children}
    </weave-banner>
  );
}
