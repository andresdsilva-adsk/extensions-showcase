import type React from "react";

// Type declarations for the Weave web components used as custom JSX elements.
type WeaveBase = React.HTMLAttributes<HTMLElement> & {
  ref?: React.Ref<HTMLElement>;
  density?: "high" | "medium";
  disabled?: boolean;
  checked?: boolean;
  value?: string;
  variant?: string;
  selected?: boolean;
};

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "weave-button": WeaveBase & { iconposition?: string; type?: string };
      "weave-toggle": WeaveBase;
      "weave-select": WeaveBase;
      "weave-select-option": WeaveBase;
      "weave-banner": WeaveBase;
      "weave-progress": WeaveBase & { value?: string };
    }
  }
}

export {};
