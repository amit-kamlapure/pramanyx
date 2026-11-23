"use client";

/**
 * VegaChart.tsx — the React wrapper for the Vega runtime (Phase 1 spike).
 *
 * Deliberately compiles Vega-Lite → Vega and drives `vega.View` directly rather than
 * going through vega-embed. Two reasons, and both are the ladder from the design doc:
 * vega-embed adds an actions menu and opinions we would only have to undo, and
 * `vl.compile()` is exactly the tier-2 → tier-3 eject — a chart that needs raw Vega
 * starts from the compiled output of the spec it already had.
 *
 * Lifecycle mirrors EChart.tsx: dynamic import, ResizeObserver, theme-flip re-render,
 * dispose on unmount. The renderer is SVG so text wears the UI's own resolved font and
 * the output is inspectable in devtools; Phase 2 measures canvas for high row counts.
 */

import { useEffect, useRef, useState } from "react";
import { bandPaddingFor, withBandPadding } from "@/components/charts/vega/bandFit";
import { buildVegaConfig, buildVegaRuntimeConfig, readVegaTokens } from "@/components/charts/vega/config";
import { watchTheme } from "@/components/charts/vega/themeWatch";
import { clickedDatum } from "@/components/charts/selection";
import { HOVER_MARK, hoverHtml, hoverMetaOf } from "@/components/charts/vega/hoverTooltip";
import type { ChartInstance, PngOptions } from "@/lib/chartExport";

type VegaModules = {
  vega: typeof import("vega");
  vl: typeof import("vega-lite");
  tooltip: typeof import("vega-tooltip");
};

let modsP: Promise<VegaModules> | null = null;
function loadVega(): Promise<VegaModules> {
  if (!modsP) {
    modsP = Promise.all([import("vega"), import("vega-lite"), import("vega-tooltip")]).then(
      ([vega, vl, tooltip]) => ({ vega, vl, tooltip }),
    );
  }
  return modsP;
}

interface Props {
  /** A Vega-Lite spec — tier 1 from resolveVegaSpec, or a hand-authored tier-2 spec.
   *  When `tier` is 3 this is a RAW VEGA spec and skips the compiler entirely. */
  spec: Record<string, unknown>;
  /** 1 or 2 → Vega-Lite (compiled here). 3 → raw Vega, rendered as written. */
  tier?: 1 | 2 | 3;
  height?: number;
  className?: string;
  /** Called with the compiled Vega spec — the tier-3 starting point. */
  onCompiled?: (vegaSpec: unknown) => void;
  /** Click a mark to drill in — receives the datum behind it, same contract as EChart. */
  onSelect?: (datum: Record<string, unknown>) => void;
  /** A right click on a mark, with where the pointer is. */
  onContext?: (datum: Record<string, unknown>, at: { x: number; y: number }) => void;
  /** Hand an export handle back to the parent, same contract as EChart's onReady. */
  onReady?: (instance: ChartInstance) => void;
  /** Band fit (`bandFit.ts`): the distinct categories on a VERTICAL band axis and the bars in each,
   *  so the bars keep a readable thickness while the chart takes the whole row. 0/absent = no fit. */
  bands?: number;
  barsPerBand?: number;
}

export function VegaChart({ spec, tier = 1, height = 300, className, onCompiled, onSelect, onContext, onReady, bands, barsPerBand }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<{ finalize: () => void } | null>(null);
  const onCompiledRef = useRef(onCompiled);
  onCompiledRef.current = onCompiled;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onContextRef = useRef(onContext);
  onContextRef.current = onContext;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const [themeTick, setThemeTick] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Drawn again whenever the page turns light or dark (`themeWatch.ts`, one rule for every chart, the coworker's too) —
  // the config is rebuilt from tokens on every flip, which keeps a STORED spec following the token layer.
  useEffect(() => watchTheme(() => setThemeTick((t) => t + 1)), []);

  useEffect(() => {
    let cancelled = false;
    let ro: ResizeObserver | undefined;
    let raf = 0;

    loadVega()
      .then(({ vega, vl, tooltip }) => {
        if (cancelled || !containerRef.current) return;
        const el = containerRef.current;
        const tokens = readVegaTokens(el);
        // Tier 3 skips the Vega-Lite compiler, which is ALSO what applies the theme — so it
        // needs the same tokens in Vega's own config shape, or an ejected chart quietly
        // reverts to Vega's built-in blues and stops following the token layer.
        const config = tier === 3 ? buildVegaRuntimeConfig(tokens) : buildVegaConfig(tokens);

        /**
         * Size is compiled INTO the spec rather than pushed into the view's signals.
         *
         * This is not a style preference — it is the one behaviour that made the first
         * render wrong. With autosize "fit", a Vega-Lite spec whose band axis is discrete
         * derives its own height from the band STEP (8 categories ≈ 177px) and ignores
         * `view.height()` entirely, so a horizontal bar rendered 177px tall inside a 412px
         * container while a line chart, whose axes are continuous, sized correctly. Giving
         * the spec explicit width/height makes both cases obey the container.
         *
         * The cost is a recompile per resize instead of a signal update. That cost is
         * exactly what Phase 2 has to measure against ECharts' `resize()`.
         */
        const render = () => {
          if (cancelled || !el.isConnected) return;
          const w = el.clientWidth;
          if (w <= 0) return;
          try {
            const fit = tier === 3 ? null : bandPaddingFor(w, bands ?? 0, barsPerBand ?? 1);
            const sized = withBandPadding({ ...spec, width: w, height }, fit);
            // vl.compile() IS the tier-3 eject: its output is a valid raw Vega spec. A spec
            // that is ALREADY tier 3 is parsed as written.
            const runtime = tier === 3
              ? vega.parse(sized as Parameters<typeof vega.parse>[0], config as Parameters<typeof vega.parse>[1])
              : vega.parse(vl.compile(sized as unknown as Parameters<typeof vl.compile>[0], { config }).spec);
            onCompiledRef.current?.(sized);
            viewRef.current?.finalize();
            const view = new vega.View(runtime, { renderer: "svg", container: el, hover: true });
            // A line's hover rule writes its own tooltip: the date and every series there, largest first, each beside
            // its line's colour (`hoverTooltip.ts`). Every other mark's tooltip is vega-tooltip's own table. Both wear
            // the app's surface (`.aug-theme`, globals.css), not vega-tooltip's white box.
            const hover = tier === 3 ? null : hoverMetaOf(spec);
            const colorOf = (series: string): string | null => {
              try {
                const scale = view.scale("color") as ((v: string) => unknown) | undefined;
                const c = scale ? scale(series) : config.line && typeof config.line === "object"
                  ? (config.line as { color?: unknown }).color : null;
                return typeof c === "string" ? c : tokens.palette[0] ?? null;
              } catch { return tokens.palette[0] ?? null; }
            };
            view.tooltip(new tooltip.Handler({
              theme: "aug",
              formatTooltip: (value, valueToHtml, maxDepth, baseURL) =>
                hover && value && typeof value === "object" && (value as Record<string, unknown>)[HOVER_MARK]
                  ? hoverHtml(value as Record<string, unknown>, hover, colorOf, valueToHtml)
                  : tooltip.formatValue(value, valueToHtml, maxDepth, baseURL),
            }).call);
            viewRef.current = view;

            view.addEventListener("click", (_e: unknown, item: unknown) => {
              // only a mark answers a click (the board study §6.2: a click filters a dashboard)
              const datum = clickedDatum(item);
              if (datum) onSelectRef.current?.(datum);
            });
            view.addEventListener("contextmenu", (e: unknown, item: unknown) => {
              const datum = clickedDatum(item);
              if (!datum || !onContextRef.current) return;
              const pointer = e as MouseEvent;
              pointer.preventDefault();
              onContextRef.current(datum, { x: pointer.clientX, y: pointer.clientY });
            });

            /**
             * PNG export. Vega's own toImageURL() honours the spec background, which is
             * transparent by design so the chart sits on whatever card holds it — a
             * transparent PNG reads as broken anywhere it is pasted. So: render to a
             * canvas, then composite it over the requested background.
             */
            onReadyRef.current?.({
              getDataURL: async (o?: PngOptions) => {
                const scale = o?.pixelRatio ?? 2;
                const src = await view.toCanvas(scale);
                const out = document.createElement("canvas");
                out.width = src.width;
                out.height = src.height;
                const ctx = out.getContext("2d");
                if (!ctx) return "";
                if (o?.backgroundColor) {
                  ctx.fillStyle = o.backgroundColor;
                  ctx.fillRect(0, 0, out.width, out.height);
                }
                ctx.drawImage(src, 0, 0);
                return out.toDataURL(o?.type === "jpeg" ? "image/jpeg" : "image/png");
              },
            });

            void view.runAsync();
            setError(null);
          } catch (e: unknown) {
            setError(e instanceof Error ? e.message : String(e));
          }
        };

        render();
        ro = new ResizeObserver(() => {
          cancelAnimationFrame(raf);
          raf = requestAnimationFrame(render);
        });
        ro.observe(el);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      ro?.disconnect();
      viewRef.current?.finalize();
      viewRef.current = null;
    };
  }, [spec, tier, height, themeTick, bands, barsPerBand]);

  if (error) {
    return (
      <div className={className} style={{ height }}>
        <pre className="aug-fs-ui" style={{ whiteSpace: "pre-wrap", padding: "0.5rem", margin: 0 }}>{error}</pre>
      </div>
    );
  }
  return <div ref={containerRef} className={className} style={{ width: "100%", height }} />;
}
