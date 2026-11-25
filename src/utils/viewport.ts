/** Returns true when mobile portrait viewport is CSS-rotated 90deg clockwise into landscape. */
export function isForceLandscape(): boolean {
  return typeof document !== 'undefined' && document.body.classList.contains('force-landscape');
}

/**
 * Maps browser client pointer coordinates onto an HTML5 `<canvas>` logical coordinate system,
 * compensating for 90deg clockwise CSS portrait-to-landscape rotation when active.
 */
export function mapClientToCanvas(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
  logicalW: number,
  logicalH: number,
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const normScreenX = (clientX - rect.left) / Math.max(1, rect.width);
  const normScreenY = (clientY - rect.top) / Math.max(1, rect.height);
  if (isForceLandscape()) {
    return {
      x: normScreenY * logicalW,
      y: (1 - normScreenX) * logicalH,
    };
  }
  return {
    x: normScreenX * logicalW,
    y: normScreenY * logicalH,
  };
}

/** Attempts native Screen Orientation API lock (silently ignored when fullscreen is not active). */
export function tryLockLandscape(): void {
  try {
    const orientation = (
      screen as unknown as {
        orientation?: { lock?: (o: string) => Promise<void> };
      }
    ).orientation;
    orientation?.lock?.('landscape')?.catch(() => {});
  } catch {
    // Unsupported or requires fullscreen on this platform
  }
}
