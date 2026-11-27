import type { Application } from 'pixi.js';
import { assets } from '../assets/AssetLoader';

interface RenderGroupLike {
  structureDidChange?: boolean;
  renderGroupChildren?: RenderGroupLike[];
}

interface StageLike {
  renderGroup?: RenderGroupLike;
}

interface RendererLike {
  gl?: WebGLRenderingContext;
  resetState?: () => void;
}

function isContextLost(app: Application): boolean {
  const renderer = app.renderer as unknown as RendererLike | undefined;
  return renderer?.gl?.isContextLost?.() === true;
}

function markRenderGroupDirty(rg: RenderGroupLike | undefined): void {
  if (!rg) return;
  rg.structureDidChange = true;
  if (rg.renderGroupChildren) {
    for (const child of rg.renderGroupChildren) {
      markRenderGroupDirty(child);
    }
  }
}

/**
 * Attaches WebGL context loss/restoration and tab-visibility recovery handlers
 * to a PixiJS Application so switching browser tabs never leaves blank textures.
 */
export function attachPixiRecovery(app: Application): () => void {
  const canvas = app.canvas;
  let disposed = false;
  let pausedByLoss = false;
  let wasHidden = typeof document !== 'undefined' ? document.hidden : false;
  let rafId = 0;

  const scheduleFollowUpRender = () => {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      if (disposed || isContextLost(app)) return;
      try {
        app.render();
      } catch {
        // Ignore transient render errors during teardown
      }
    });
  };

  const refreshAndRender = async (forceRestore: boolean): Promise<void> => {
    if (disposed || isContextLost(app)) return;
    await assets.restoreAllTextures(forceRestore);
    if (disposed || isContextLost(app)) return;

    const renderer = app.renderer as unknown as RendererLike | undefined;
    renderer?.resetState?.();
    markRenderGroupDirty((app.stage as unknown as StageLike | undefined)?.renderGroup);

    if (!app.ticker.started) {
      app.ticker.start();
    }
    try {
      app.render();
    } catch {
      // Ignore transient render errors
    }
    scheduleFollowUpRender();
  };

  const onContextLost = (e: Event) => {
    e.preventDefault();
    if (disposed) return;
    if (app.ticker.started) {
      pausedByLoss = true;
      app.ticker.stop();
    }
  };

  const onContextRestored = () => {
    if (disposed) return;
    pausedByLoss = false;
    void refreshAndRender(true);
  };

  const onVisibilityChange = () => {
    if (disposed) return;
    if (document.hidden) {
      wasHidden = true;
      return;
    }
    if (wasHidden) {
      wasHidden = false;
      if (!pausedByLoss && !isContextLost(app)) {
        void refreshAndRender(false);
      }
    }
  };

  const onPageShow = (e: PageTransitionEvent) => {
    if (disposed) return;
    if ((e.persisted || !document.hidden) && !pausedByLoss && !isContextLost(app)) {
      void refreshAndRender(false);
    }
  };

  canvas.addEventListener('webglcontextlost', onContextLost, false);
  canvas.addEventListener('webglcontextrestored', onContextRestored, false);
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pageshow', onPageShow);

  return () => {
    disposed = true;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    canvas.removeEventListener('webglcontextlost', onContextLost, false);
    canvas.removeEventListener('webglcontextrestored', onContextRestored, false);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('pageshow', onPageShow);
  };
}
