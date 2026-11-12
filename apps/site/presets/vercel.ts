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
        canvas: "#f7f4f0",
        surface: "#ffffff",
        recessed: "#f1ebe5",
        ink: "#1b1714",
        "ink-secondary": "#544b43",
        "ink-muted": "#8a7f75",
        accent: "#b95412",
        "accent-dark": "#9a430d",
        "accent-bright": "#e8822c",
        line: "#e8e1da",
        live: "#2f8f4e",
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
        DEFAULT: "8px",
        sm: "6px",
        md: "10px",
        lg: "14px",
        xl: "18px",
        full: "9999px",
      },
      boxShadow: {
        border: "0 0 0 1px rgba(22,24,29,0.065), inset 0 1px 0 rgba(255,255,255,0.72)",
        "card-hover": "0 0 0 1px rgba(22,24,29,0.11), inset 0 1px 0 rgba(255,255,255,0.82)",
        header: "0 1px 0 rgba(22,24,29,0.08)",
        brand: "0 0 0 1px rgba(185,84,18,0.20), inset 0 1px 0 rgba(255,255,255,0.24)",
        "focus-ring": "0 0 0 2px #ffffff, 0 0 0 4px #b95412",
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
          [
            "icon-tile",
            "inline-flex items-center justify-center rounded-md bg-gradient-to-b from-white to-recessed/55 shadow-border",
          ],
          // buttons (ghost-first, per Vercel)
          [
            "btn",
            "inline-flex items-center justify-center gap-2 rounded text-sm font-medium transition-all duration-150 active:translate-y-px disabled:active:translate-y-0",
          ],
          [
            "btn-ghost",
            "btn px-3.5 py-1.5 text-ink-secondary hover:bg-line hover:text-ink focus:outline-none focus-visible:shadow-focus-ring",
          ],
          [
            "btn-primary",
            "btn bg-accent px-3.5 py-1.5 text-white shadow-brand hover:bg-accent-dark disabled:opacity-50",
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
            "h-8 rounded bg-recessed px-3 text-[13px] placeholder:text-ink-muted focus:bg-surface focus:outline-none focus-visible:shadow-focus-ring",
          ],
          // status indicator dot (size-2.5 ≈ 10px, Vercel's div.size-2.5)
          ["dot", "inline-block size-2.5 shrink-0 rounded-full"],
          ["dot-live", "dot bg-live"],
          ["dot-muted", "dot bg-ink-muted"],
        ]
      : [],
  };
});
