import type { RigClip, RigTrack } from '../types/game';
import type { UnityRigInstance } from './UnityRigInstance';

interface EvalNodeState {
  x: number;
  y: number;
  rot: number;
  sx: number;
  sy: number;
  a: number;
  sp: number;
  al: number;
  fyRot: number;
}

interface OverlayLayerState {
  clip: RigClip;
  time: number;
  speed: number;
  loop: boolean;
}

function sampleNum(arr: number[], clip: RigClip, t: number, isAngle = false): number {
  const n = arr.length;
  if (n === 0) return 0;
  if (n === 1) return arr[0];
  const dur = clip.dur;
  const f = dur > 0 ? Math.max(0, Math.min(1, t / dur)) * (n - 1) : 0;
  const i0 = Math.floor(f);
  const i1 = Math.min(n - 1, i0 + 1);
  const a = f - i0;
  const v0 = arr[i0];
  const v1 = arr[i1];
  if (isAngle) {
    let diff = v1 - v0;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return v0 + diff * a;
  }
  return v0 + (v1 - v0) * a;
}

function sampleStep(arr: number[], clip: RigClip, t: number): number {
  const n = arr.length;
  if (n === 0) return 0;
  if (n === 1) return arr[0];
  const dur = clip.dur;
  const f = dur > 0 ? Math.max(0, Math.min(1, t / dur)) * (n - 1) : 0;
  const idx = Math.min(n - 1, Math.max(0, Math.round(f)));
  return arr[idx];
}

function wrapAngleDelta(delta: number): number {
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

/**
 * Multi-layer Unity `AnimationClip` evaluator supporting:
 * - Looping or one-shot base clips (with automatic return clip e.g. `shoot -> idle`, `losepaper -> walk2`),
 * - Exact Unity Additive layer blending (`sampled - rest`) for overlays (`shoot` over swaying `idle`)
 *   and persistent parallel additive loops (`ThreePeater` `head1/2/3`),
 * - Root-motion translation suppression on bone 0 and `m_Events` dispatching.
 */
export class UnityAnimator {
  readonly rig: UnityRigInstance;
  readonly clips: Record<string, RigClip>;
  private readonly restStates: EvalNodeState[];
  private readonly workStates: EvalNodeState[];

  baseClip: RigClip | null = null;
  baseTime = 0;
  baseSpeed = 1;
  baseLoop = true;
  baseFinished = false;
  private baseReturnClip: string | null = null;

  private readonly overlays: OverlayLayerState[] = [];
  onEvent?: (fnName: string, clipName: string) => void;

  constructor(rig: UnityRigInstance, initialClip?: string) {
    this.rig = rig;
    this.clips = rig.rig.data.clips;
    this.restStates = rig.rig.data.nodes.map((n) => ({
      x: n.x,
      y: n.y,
      rot: n.rot,
      sx: n.sx,
      sy: n.sy,
      a: n.a,
      sp: n.sp,
      al: n.al,
      fyRot: 1,
    }));
    this.workStates = this.restStates.map((s) => ({ ...s }));

    if (initialClip && this.clips[initialClip.toLowerCase()]) {
      this.playBase(initialClip, true, Math.random() * 0.6);
    } else if (this.clips.idle) {
      this.playBase('idle', true, Math.random() * 0.6);
    } else {
      const firstKey = Object.keys(this.clips)[0];
      if (firstKey) {
        this.playBase(firstKey, true, Math.random() * 0.4);
      }
    }
    this.evaluateAndApply();
  }

  hasClip(name: string): boolean {
    return Boolean(this.clips[name.toLowerCase()]);
  }

  clipHasEvent(clipName: string, fnName: string): boolean {
    const clip = this.clips[clipName.toLowerCase()];
    if (!clip) return false;
    return clip.events.some((ev) => ev[1] === fnName);
  }

  /** Switches or restarts the base animation layer cleanly. */
  playBase(name: string, loop = true, startOffset = 0, forceRestart = false): boolean {
    const clip = this.clips[name.toLowerCase()];
    if (!clip) return false;
    if (!forceRestart && this.baseClip === clip && this.baseLoop === loop && this.baseReturnClip === null) {
      return true;
    }
    this.baseClip = clip;
    this.baseLoop = loop;
    this.baseFinished = false;
    this.baseReturnClip = null;
    this.baseTime = clip.dur > 0 ? startOffset % clip.dur : 0;
    return true;
  }

  /** Plays a non-looping base-layer animation and transitions cleanly back to `returnClip` when finished. */
  playBaseOneShot(name: string, returnClip = 'idle', speed = 1): boolean {
    const clip = this.clips[name.toLowerCase()];
    if (!clip) return false;
    this.baseClip = clip;
    this.baseLoop = false;
    this.baseFinished = false;
    this.baseSpeed = speed;
    this.baseTime = 0;
    this.baseReturnClip = this.hasClip(returnClip) ? returnClip : null;
    this.fireEventsBetween(clip, -0.0001, 0);
    return true;
  }

  /**
   * Plays an attack/action animation: if the clip came from a Unity Additive layer,
   * blends additively on top of `baseClip`; otherwise runs cleanly as a base-layer one-shot returning to `idle`.
   */
  playOverlay(name: string, speed = 1, returnClip = 'idle'): boolean {
    const clip = this.clips[name.toLowerCase()];
    if (!clip) return false;

    if (!clip.additive) {
      return this.playBaseOneShot(name, returnClip, speed);
    }

    // Replace existing one-shot instance of the same clip if retriggered
    const idx = this.overlays.findIndex((o) => !o.loop && o.clip === clip);
    const layer: OverlayLayerState = { clip, time: 0, speed, loop: false };
    if (idx >= 0) {
      this.overlays[idx] = layer;
    } else {
      this.overlays.push(layer);
    }
    this.fireEventsBetween(clip, -0.0001, 0);
    return true;
  }

  /** Starts a continuous additive loop layer (e.g. `ThreePeater` `head1/head2/head3`). */
  addAdditiveLoop(name: string, startOffset = 0): boolean {
    const clip = this.clips[name.toLowerCase()];
    if (!clip) return false;
    if (this.overlays.some((o) => o.loop && o.clip === clip)) return true;
    this.overlays.push({
      clip,
      time: clip.dur > 0 ? startOffset % clip.dur : 0,
      speed: 1,
      loop: true,
    });
    return true;
  }

  clearOverlay(clearLoops = false): void {
    if (clearLoops) {
      this.overlays.length = 0;
    } else {
      for (let i = this.overlays.length - 1; i >= 0; i--) {
        if (!this.overlays[i].loop) {
          this.overlays.splice(i, 1);
        }
      }
    }
  }

  seek(timeSec: number): void {
    if (!this.baseClip) return;
    const dur = this.baseClip.dur;
    this.baseTime = dur > 0 ? Math.max(0, Math.min(dur, timeSec)) : 0;
    this.evaluateAndApply();
  }

  update(dt: number): void {
    if (dt <= 0) return;

    if (this.baseClip && !this.baseFinished) {
      const prev = this.baseTime;
      const dur = Math.max(0.016, this.baseClip.dur);
      let next = prev + dt * this.baseSpeed;
      if (this.baseLoop) {
        if (next >= dur) {
          this.fireEventsBetween(this.baseClip, prev, dur);
          next = next % dur;
          this.fireEventsBetween(this.baseClip, -0.0001, next);
        } else {
          this.fireEventsBetween(this.baseClip, prev, next);
        }
        this.baseTime = next;
      } else if (next >= dur) {
        this.fireEventsBetween(this.baseClip, prev, dur + 0.001);
        const ret = this.baseReturnClip;
        if (ret) {
          this.baseReturnClip = null;
          this.baseSpeed = 1;
          this.playBase(ret, true, 0, true);
        } else {
          this.baseTime = dur;
          this.baseFinished = true;
        }
      } else {
        this.fireEventsBetween(this.baseClip, prev, next);
        this.baseTime = next;
      }
    }

    for (let i = this.overlays.length - 1; i >= 0; i--) {
      const ov = this.overlays[i];
      const prev = ov.time;
      const dur = Math.max(0.016, ov.clip.dur);
      let next = prev + dt * ov.speed;
      if (ov.loop) {
        if (next >= dur) {
          this.fireEventsBetween(ov.clip, prev, dur);
          next = next % dur;
          this.fireEventsBetween(ov.clip, -0.0001, next);
        } else {
          this.fireEventsBetween(ov.clip, prev, next);
        }
        ov.time = next;
      } else if (next >= dur) {
        this.fireEventsBetween(ov.clip, prev, dur + 0.001);
        this.overlays.splice(i, 1);
      } else {
        this.fireEventsBetween(ov.clip, prev, next);
        ov.time = next;
      }
    }

    this.evaluateAndApply();
  }

  private fireEventsBetween(clip: RigClip, t0: number, t1: number): void {
    if (!this.onEvent || clip.events.length === 0) return;
    for (const [evTime, fnName] of clip.events) {
      if (evTime > t0 && evTime <= t1) {
        this.onEvent(fnName, clip.name);
      }
    }
  }

  private applyClipTrack(clip: RigClip, tm: number, asAdditive: boolean): void {
    for (const nidStr of Object.keys(clip.tracks)) {
      const nid = Number(nidStr);
      const st = this.workStates[nid];
      const rest = this.restStates[nid];
      if (!st || !rest) continue;
      const tr: RigTrack = clip.tracks[nidStr];

      if (asAdditive) {
        if (nid !== 0) {
          if (tr.x) st.x += sampleNum(tr.x, clip, tm) - rest.x;
          if (tr.y) st.y += sampleNum(tr.y, clip, tm) - rest.y;
        }
        if (tr.rot) {
          st.rot += wrapAngleDelta(sampleNum(tr.rot, clip, tm, true) - rest.rot);
        }
        if (tr.sx) {
          const v = sampleNum(tr.sx, clip, tm);
          st.sx *= Math.abs(rest.sx) > 1e-5 ? v / rest.sx : v;
        }
        if (tr.sy) {
          const v = sampleNum(tr.sy, clip, tm);
          st.sy *= Math.abs(rest.sy) > 1e-5 ? v / rest.sy : v;
        }
      } else {
        if (nid !== 0) {
          if (tr.x) st.x = sampleNum(tr.x, clip, tm);
          if (tr.y) st.y = sampleNum(tr.y, clip, tm);
        }
        if (tr.rot) st.rot = sampleNum(tr.rot, clip, tm, true);
        if (tr.sx) st.sx = sampleNum(tr.sx, clip, tm);
        if (tr.sy) st.sy = sampleNum(tr.sy, clip, tm);
      }

      if (tr.a) st.a = sampleStep(tr.a, clip, tm);
      if (tr.sp) st.sp = sampleStep(tr.sp, clip, tm);
      if (tr.al) st.al = sampleNum(tr.al, clip, tm);
      if (tr.fyRot) st.fyRot = sampleStep(tr.fyRot, clip, tm);
    }
  }

  evaluateAndApply(): void {
    const nCount = this.restStates.length;
    for (let i = 0; i < nCount; i++) {
      const r = this.restStates[i];
      const w = this.workStates[i];
      w.x = r.x;
      w.y = r.y;
      w.rot = r.rot;
      w.sx = r.sx;
      w.sy = r.sy;
      w.a = r.a;
      w.sp = r.sp;
      w.al = r.al;
      w.fyRot = r.fyRot;
    }
    if (this.baseClip) {
      this.applyClipTrack(this.baseClip, this.baseTime, false);
    }
    for (const ov of this.overlays) {
      this.applyClipTrack(ov.clip, ov.time, Boolean(ov.clip.additive));
    }
    for (let i = 0; i < nCount; i++) {
      const w = this.workStates[i];
      this.rig.applyNodeState(i, w.x, w.y, w.rot, w.sx, w.sy, w.a, w.sp, w.al, w.fyRot);
    }
  }
}
