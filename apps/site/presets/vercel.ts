import { definePreset, type Preset } from "unocss";

export interface PresetVercelOptions {
  /** Register component shortcuts (card/btn/input/dot). Defaults to true. */
  shortcuts?: boolean;
}

/**
 * UnoCSS preset following Vercel's design language.
 *
 * Derived from the Vercel DESIGN.md tokens: a 4-stop achromatic palette with a
 * single interactive accent, shadows-as-borders, Geist type, and component
 * shortcuts so the dashboard reads like Vercel's Overview page.
 */
export const presetVercel = definePreset((options: PresetVercelOptions = {}): Preset => {
  const { shortcuts: enableShortcuts = true } = options;

  return {
    name: "vercel",
    theme: {
      colors: {
        canvas: "#fafafa",
        surface: "#ffffff",
        recessed: "#f2f2f2",
        ink: "#171717",
        "ink-secondary": "#4d4d4d",
        "ink-muted": "#8f8f8f",
        accent: "#0072f5",
        "accent-dark": "#005fcc",
        line: "#ebebeb",
        live: "#398e4a",
        "status-blue": "#0062d1",
        "status-cyan": "#52aeff",
        "status-teal": "#45dec5",
        "status-orange": "#ff990a",
        "status-red": "#e5484d",
        "status-pink": "#ea3e83",
      },
      fontFamily: {
        sans: '"Geist Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        mono: '"Geist Mono", ui-monospace, SFMono-Regular, "Roboto Mono", Menlo, monospace',
      },
      borderRadius: {
        DEFAULT: "6px",
        sm: "4px",
        md: "8px",
        lg: "12px",
        xl: "16px",
        full: "9999px",
      },
      boxShadow: {
        border: "0 0 0 1px rgba(0,0,0,0.08)",
        "card-hover": "0 0 0 1px rgba(0,0,0,0.08), 0 8px 16px -8px rgba(0,0,0,0.12)",
        header: "0 1px 0 0 rgba(0,0,0,0.10)",
        "focus-ring": "0 0 0 2px #ffffff, 0 0 0 4px #0072f5",
      },
      letterSpacing: {
        tight: "-0.02em",
        tighter: "-0.04em",
      },
    },
    shortcuts: enableShortcuts
      ? [
          // surfaces
          ["card", "rounded-lg bg-surface shadow-border"],
          // buttons (ghost-first, per Vercel)
          [
            "btn",
            "inline-flex items-center justify-center gap-2 rounded text-sm font-medium transition-colors",
          ],
          [
            "btn-ghost",
            "btn px-3.5 py-1.5 text-ink-secondary hover:bg-line hover:text-ink focus:outline-none focus-visible:shadow-focus-ring",
          ],
          [
            "btn-primary",
            "btn px-3.5 py-1.5 bg-ink text-white hover:bg-ink/85 disabled:opacity-50",
          ],
          [
            "btn-icon",
            "btn h-8 w-8 px-0 text-ink-muted hover:bg-line hover:text-ink focus:outline-none focus-visible:shadow-focus-ring",
          ],
          // form fields
          [
            "input",
            "h-8 rounded bg-surface px-3 text-[13px] shadow-border placeholder:text-ink-muted focus:outline-none focus-visible:shadow-focus-ring",
          ],
          [
            "input-search",
            "h-8 rounded bg-surface pl-8 pr-3 text-[13px] shadow-border placeholder:text-ink-muted focus:outline-none focus-visible:shadow-focus-ring",
          ],
          [
            "input-ghost",
            "h-8 rounded bg-recessed px-3 text-[13px] focus:outline-none focus:bg-surface",
          ],
          // status indicator dot (size-2.5 ≈ 10px, Vercel's div.size-2.5)
          ["dot", "inline-block size-2.5 shrink-0 rounded-full"],
          ["dot-live", "dot bg-live"],
          ["dot-muted", "dot bg-ink-muted"],
        ]
      : [],
  };
});
