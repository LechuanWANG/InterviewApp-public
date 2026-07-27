"use client";

import { type RefObject, useEffect, useRef } from "react";
import { assignTargets, samplePointsFromAlpha, stepToward } from "@/lib/home/particleField";

export type HomeBackdropMode = "idle" | "interview" | "consult";

type WordConfig = { text: string; tint: string };

// The words are latent in the field — hovering a card resolves the scattered
// prep into its outcome. Tints echo each card so the word "belongs" to it.
const WORDS: Record<Exclude<HomeBackdropMode, "idle">, WordConfig> = {
  interview: { text: "ACING", tint: "#9aa6ff" },
  consult: { text: "PLOTTING", tint: "#4ade9b" },
};

// Glyph alphabet for the drifting field: code punctuation + digits, biased so
// the letters of ACING / PLOTTING already float among the noise, plus the
// brand characters as a rare easter egg.
const GLYPHS = (
  "{}<>/=;+*·.0101" +
  "ACINGPLOTTING" +
  "</>{}=>;:" +
  "代面"
).split("");

const FONT_STACK = '"SF Mono", "JetBrains Mono", ui-monospace, Menlo, monospace';
const BASE_WORD_FONT = 92; // offscreen render size the glyph cloud is sampled at
const PARTICLE_COUNT = 230;

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  bvx: number; // base ambient drift, resumed once a glyph has returned home
  bvy: number;
  rx: number | null; // full-screen return target while the field re-forms
  ry: number | null;
  rs: number; // per-particle return easing speed (staggers the scatter)
  depth: number; // 0 = far/dim/small, 1 = near/bright/large
  size: number;
  glyph: string;
  // word-formation target, expressed as an offset from the word's center so it
  // survives scrolling/resizing of the destination zone:
  bx: number;
  by: number;
  assigned: boolean;
};

type Comet = { x: number; y: number; vx: number; vy: number; len: number; life: number; max: number };

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export default function HomeBackdrop({
  mode,
  zoneRef,
}: {
  mode: HomeBackdropMode;
  zoneRef?: RefObject<HTMLElement | null>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const modeRef = useRef<HomeBackdropMode>(mode);
  const staticRenderRef = useRef<((m: HomeBackdropMode) => void) | null>(null);

  // Keep the engine reading the latest mode without tearing down the rAF loop.
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  // Reduced-motion path: no animation loop, just redraw a static frame on change.
  useEffect(() => {
    staticRenderRef.current?.(mode);
  }, [mode]);

  useEffect(() => {
    const canvasEl = canvasRef.current;
    if (!canvasEl) return;
    const context = canvasEl.getContext("2d");
    if (!context) return;
    // Non-null aliases so the nested render closures keep the narrowed types.
    const canvas = canvasEl;
    const ctx = context;

    const reducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let cssW = 1;
    let cssH = 1;
    let bgGradient: CanvasGradient | null = null;

    const particles: Particle[] = [];
    const comets: Comet[] = [];

    // Smoothed pointer for depth parallax, in [-1, 1] from center.
    let pointerX = 0;
    let pointerY = 0;
    let pointerTX = 0;
    let pointerTY = 0;

    // Word-formation state.
    let formMode: HomeBackdropMode = "idle";
    let formProgress = 0;
    let activeWord: WordConfig | null = null;
    let wordTextWidth = 0; // measured at BASE_WORD_FONT

    function rand(lo: number, hi: number): number {
      return lo + Math.random() * (hi - lo);
    }

    function makeParticle(): Particle {
      const depth = Math.random() ** 1.4; // bias toward far/dim for a deep field
      const bvx = rand(-7, 7);
      const bvy = rand(-7, 7);
      return {
        x: Math.random() * cssW,
        y: Math.random() * cssH,
        vx: bvx,
        vy: bvy,
        bvx,
        bvy,
        rx: null,
        ry: null,
        rs: 0,
        depth,
        size: lerp(8, 19, depth),
        glyph: GLYPHS[(Math.random() * GLYPHS.length) | 0],
        bx: 0,
        by: 0,
        assigned: false,
      };
    }

    function buildParticles() {
      particles.length = 0;
      for (let i = 0; i < PARTICLE_COUNT; i++) particles.push(makeParticle());
    }

    function buildBackground() {
      const g = ctx.createLinearGradient(0, 0, cssW * 0.4, cssH);
      g.addColorStop(0, "#02060f");
      g.addColorStop(0.55, "#040a18");
      g.addColorStop(1, "#01040c");
      bgGradient = g;
    }

    function resize() {
      const rect = canvas.getBoundingClientRect();
      const nextW = Math.max(1, rect.width);
      const nextH = Math.max(1, rect.height);
      const ratioX = cssW > 1 ? nextW / cssW : 1;
      const ratioY = cssH > 1 ? nextH / cssH : 1;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      canvas.width = Math.round(nextW * dpr);
      canvas.height = Math.round(nextH * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      if (particles.length === 0) {
        cssW = nextW;
        cssH = nextH;
        buildParticles();
      } else {
        for (const p of particles) {
          p.x *= ratioX;
          p.y *= ratioY;
        }
        cssW = nextW;
        cssH = nextH;
      }
      buildBackground();
    }

    // Sample a word into centered offset points and assign particles to them.
    function buildWord(m: Exclude<HomeBackdropMode, "idle">) {
      const cfg = WORDS[m];
      const off = document.createElement("canvas");
      const octx = off.getContext("2d");
      if (!octx) return;

      const font = `700 ${BASE_WORD_FONT}px ${FONT_STACK}`;
      octx.font = font;
      const metrics = octx.measureText(cfg.text);
      wordTextWidth = metrics.width;
      const padX = BASE_WORD_FONT * 0.4;
      const padY = BASE_WORD_FONT * 0.55;
      off.width = Math.ceil(wordTextWidth + padX * 2);
      off.height = Math.ceil(BASE_WORD_FONT + padY * 2);

      octx.font = font;
      octx.fillStyle = "#fff";
      octx.textAlign = "center";
      octx.textBaseline = "middle";
      octx.fillText(cfg.text, off.width / 2, off.height / 2);

      const data = octx.getImageData(0, 0, off.width, off.height).data;
      const step = 4;
      let points = samplePointsFromAlpha(data, off.width, off.height, step, 130);
      // Center points around (0,0) so they map cleanly onto the live zone.
      for (const pt of points) {
        pt.x -= off.width / 2;
        pt.y -= off.height / 2;
      }
      // Shuffle and cap to the particle budget.
      for (let i = points.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        [points[i], points[j]] = [points[j], points[i]];
      }
      const cap = Math.min(points.length, particles.length, 250);
      points = points.slice(0, cap);

      const sources = particles.map((p) => ({ x: p.x, y: p.y }));
      const assignment = assignTargets(sources, points);
      for (const p of particles) p.assigned = false;
      for (let t = 0; t < assignment.length; t++) {
        const idx = assignment[t];
        if (idx < 0) continue;
        const p = particles[idx];
        p.assigned = true;
        p.bx = points[t].x;
        p.by = points[t].y;
      }
      activeWord = cfg;
    }

    function releaseParticles() {
      // Scatter each word glyph to a fresh random spot across the WHOLE screen
      // and ease it there, so the field re-forms its initial full-screen drift
      // rather than collapsing into a cluster. Staggered speeds keep it organic.
      for (const p of particles) {
        if (p.assigned) {
          p.assigned = false;
          p.rx = Math.random() * cssW;
          p.ry = Math.random() * cssH;
          p.rs = rand(2.6, 3.8);
        }
      }
    }

    // Where the word should land on screen (the de-bordered "updates" zone),
    // plus the scale that fits it there. Falls back to lower-center.
    function wordPlacement(): { cx: number; cy: number; scale: number } {
      let cx = cssW / 2;
      let cy = cssH * 0.74;
      let zoneW = cssW * 0.6;
      const zone = zoneRef?.current;
      if (zone) {
        const zr = zone.getBoundingClientRect();
        const cr = canvas.getBoundingClientRect();
        cx = zr.left - cr.left + zr.width / 2;
        cy = zr.top - cr.top + zr.height / 2;
        zoneW = zr.width;
      }
      const maxW = Math.min(zoneW * 0.96, cssW * 0.84);
      const desiredFont = clamp(cssW * 0.05, 30, 62);
      const scale = wordTextWidth > 0 ? Math.min(desiredFont / BASE_WORD_FONT, maxW / wordTextWidth) : 0.4;
      return { cx, cy, scale };
    }

    function spawnComet() {
      const fromLeft = Math.random() < 0.5;
      const y = rand(cssH * 0.1, cssH * 0.9);
      const speed = rand(180, 320);
      comets.push({
        x: fromLeft ? -40 : cssW + 40,
        y,
        vx: fromLeft ? speed : -speed,
        vy: rand(-30, 30),
        len: rand(60, 140),
        life: 0,
        max: rand(1.6, 2.8),
      });
    }

    function drawNetwork(progress: number) {
      const near = particles.filter((p) => p.depth > 0.55 && !p.assigned);
      const maxDist = 132;
      const maxDistSq = maxDist * maxDist;
      const alphaScale = 1 - progress * 0.85;
      if (alphaScale <= 0.02) return;
      ctx.lineWidth = 1;
      for (let i = 0; i < near.length; i++) {
        const a = near[i];
        for (let j = i + 1; j < near.length; j++) {
          const b = near[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dsq = dx * dx + dy * dy;
          if (dsq > maxDistSq) continue;
          const t = 1 - Math.sqrt(dsq) / maxDist;
          ctx.strokeStyle = `rgba(56,189,248,${(t * 0.22 * alphaScale).toFixed(3)})`;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }

    function drawComets(dt: number) {
      for (let i = comets.length - 1; i >= 0; i--) {
        const c = comets[i];
        c.life += dt;
        c.x += c.vx * dt;
        c.y += c.vy * dt;
        const fade = clamp(1 - c.life / c.max, 0, 1);
        if (fade <= 0 || c.x < -200 || c.x > cssW + 200) {
          comets.splice(i, 1);
          continue;
        }
        const dir = Math.sign(c.vx) || 1;
        const tailX = c.x - dir * c.len;
        const grad = ctx.createLinearGradient(tailX, c.y, c.x, c.y);
        grad.addColorStop(0, "rgba(103,232,249,0)");
        grad.addColorStop(1, `rgba(165,243,252,${(0.5 * fade).toFixed(3)})`);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(tailX, c.y);
        ctx.lineTo(c.x, c.y);
        ctx.stroke();
      }
    }

    function drawHudFrame() {
      const m = 26;
      const len = 22;
      ctx.strokeStyle = "rgba(56,189,248,0.16)";
      ctx.lineWidth = 1;
      const corners: Array<[number, number, number, number]> = [
        [m, m, 1, 1],
        [cssW - m, m, -1, 1],
        [m, cssH - m, 1, -1],
        [cssW - m, cssH - m, -1, -1],
      ];
      for (const [x, y, sx, sy] of corners) {
        ctx.beginPath();
        ctx.moveTo(x + sx * len, y);
        ctx.lineTo(x, y);
        ctx.lineTo(x, y + sy * len);
        ctx.stroke();
      }
    }

    function drawScanSweep(time: number) {
      const period = 9;
      const phase = (time % period) / period;
      const y = phase * cssH;
      const band = ctx.createLinearGradient(0, y - 60, 0, y + 60);
      band.addColorStop(0, "rgba(56,189,248,0)");
      band.addColorStop(0.5, "rgba(56,189,248,0.05)");
      band.addColorStop(1, "rgba(56,189,248,0)");
      ctx.fillStyle = band;
      ctx.fillRect(0, y - 60, cssW, 120);
    }

    function drawParticles(place: { cx: number; cy: number; scale: number }, progress: number, dt: number, animate: boolean) {
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const dimUnassigned = 1 - progress * 0.5;

      for (const p of particles) {
        if (p.assigned) {
          const tx = place.cx + p.bx * place.scale;
          const ty = place.cy + p.by * place.scale;
          if (animate) {
            p.x = stepToward(p.x, tx, 9, dt);
            p.y = stepToward(p.y, ty, 9, dt);
          } else {
            p.x = tx;
            p.y = ty;
          }
        } else {
          // Unassigned: either easing back to a fresh full-screen home after a
          // word dissolved, or just drifting in the ambient field.
          if (p.rx !== null && p.ry !== null) {
            if (animate) {
              p.x = stepToward(p.x, p.rx, p.rs, dt);
              p.y = stepToward(p.y, p.ry, p.rs, dt);
              if (Math.abs(p.x - p.rx) < 6 && Math.abs(p.y - p.ry) < 6) {
                p.rx = null;
                p.ry = null;
                p.vx = p.bvx;
                p.vy = p.bvy;
              }
            } else {
              // Reduced motion: snap straight to the scattered home.
              p.x = p.rx;
              p.y = p.ry;
              p.rx = null;
              p.ry = null;
              p.vx = p.bvx;
              p.vy = p.bvy;
            }
          } else if (animate) {
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            const margin = 30;
            if (p.x < -margin) p.x = cssW + margin;
            else if (p.x > cssW + margin) p.x = -margin;
            if (p.y < -margin) p.y = cssH + margin;
            else if (p.y > cssH + margin) p.y = -margin;
          }
        }

        const px = p.x + pointerX * p.depth * 16;
        const py = p.y + pointerY * p.depth * 16;

        let alpha: number;
        let color: string;
        if (p.assigned) {
          alpha = lerp(0.5, 0.95, p.depth) * (0.4 + 0.6 * progress);
          color = `rgba(186,230,253,${alpha.toFixed(3)})`;
        } else {
          alpha = lerp(0.16, 0.82, p.depth) * dimUnassigned;
          // far -> core cyan, near -> bright cyan
          const r = Math.round(lerp(45, 125, p.depth));
          const g = Math.round(lerp(160, 230, p.depth));
          const b = Math.round(lerp(220, 248, p.depth));
          color = `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
        }
        ctx.fillStyle = color;
        ctx.font = `${p.assigned ? 600 : 500} ${p.size.toFixed(1)}px ${FONT_STACK}`;
        ctx.fillText(p.glyph, px, py);
      }
    }

    function drawWordText(place: { cx: number; cy: number; scale: number }, progress: number) {
      if (!activeWord) return;
      const alpha = clamp((progress - 0.5) / 0.42, 0, 1);
      if (alpha <= 0) return;
      const font = BASE_WORD_FONT * place.scale;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `700 ${font.toFixed(1)}px ${FONT_STACK}`;
      ctx.shadowColor = activeWord.tint;
      ctx.shadowBlur = 22 * progress;
      ctx.fillStyle = activeWord.tint;
      ctx.fillText(activeWord.text, place.cx, place.cy);
      // crisp second pass without the heavy blur
      ctx.shadowBlur = 0;
      ctx.globalAlpha = alpha * 0.9;
      ctx.fillStyle = "rgba(240,253,255,0.92)";
      ctx.fillText(activeWord.text, place.cx, place.cy);
      ctx.restore();
    }

    function syncFormState() {
      const desired = modeRef.current;
      if (desired !== formMode) {
        formMode = desired;
        if (desired === "idle") {
          releaseParticles();
        } else {
          buildWord(desired);
        }
      }
    }

    function paint(time: number, dt: number, animate: boolean) {
      syncFormState();
      const targetProgress = formMode === "idle" ? 0 : 1;
      // Dissolve (-> idle) eases a touch faster than formation, matching the
      // quicker glyph scatter on mouse-out while leaving the build-up intact.
      const progressSmoothing = targetProgress === 0 ? 8.5 : 6;
      formProgress = animate
        ? stepToward(formProgress, targetProgress, progressSmoothing, dt)
        : targetProgress;
      if (!animate && formMode === "idle") activeWord = null;
      else if (formProgress < 0.02 && formMode === "idle") activeWord = null;

      if (bgGradient) {
        ctx.fillStyle = bgGradient;
        ctx.fillRect(0, 0, cssW, cssH);
      }

      const place = activeWord ? wordPlacement() : { cx: 0, cy: 0, scale: 0 };

      drawHudFrame();
      if (animate) drawScanSweep(time);
      drawNetwork(formProgress);
      if (animate) drawComets(dt);
      drawParticles(place, formProgress, dt, animate);
      drawWordText(place, formProgress);
    }

    // ---- lifecycle ----------------------------------------------------------
    resize();

    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => resize()) : null;
    if (ro) ro.observe(canvas);
    else window.addEventListener("resize", resize);

    function onPointerMove(e: PointerEvent) {
      pointerTX = clamp((e.clientX / window.innerWidth) * 2 - 1, -1, 1);
      pointerTY = clamp((e.clientY / window.innerHeight) * 2 - 1, -1, 1);
    }

    let raf = 0;
    let last = 0;
    let cometClock = 0;

    const loop = (now: number) => {
      const t = now / 1000;
      let dt = last ? t - last : 0;
      last = t;
      dt = clamp(dt, 0, 0.05); // guard against tab-switch / first-frame jumps

      pointerX = stepToward(pointerX, pointerTX, 4, dt);
      pointerY = stepToward(pointerY, pointerTY, 4, dt);

      cometClock += dt;
      if (cometClock > 2.4 && comets.length < 2 && Math.random() < 0.4) {
        spawnComet();
        cometClock = 0;
      }

      paint(t, dt, true);
      raf = window.requestAnimationFrame(loop);
    };

    function startLoop() {
      if (raf) return;
      last = 0;
      raf = window.requestAnimationFrame(loop);
    }

    if (reducedMotion) {
      // No animation loop. Render a static field; redraw on mode change.
      staticRenderRef.current = (m: HomeBackdropMode) => {
        modeRef.current = m;
        paint(0, 0, false);
      };
      paint(0, 0, false);
    } else {
      window.addEventListener("pointermove", onPointerMove, { passive: true });
      paint(0, 0, true); // draw the first frame now so the mount never flashes blank
      startLoop();
    }

    function onVisibility() {
      if (document.hidden) {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        last = 0;
      } else if (!reducedMotion) {
        startLoop();
      }
    }
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      if (ro) ro.disconnect();
      else window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("visibilitychange", onVisibility);
      staticRenderRef.current = null;
    };
  }, [zoneRef]);

  return <canvas ref={canvasRef} className="home-backdrop-canvas" aria-hidden="true" />;
}
