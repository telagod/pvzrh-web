import { assets } from '../assets/AssetLoader';

/**
 * WebAudio API engine with gesture unlock, looping BGM crossfade,
 * decoded AudioBuffer LRU-friendly cache, and per-SFX cooldown throttling
 * so volley shooters never distort or clip.
 */
class AudioManager {
  private ctx: AudioContext | null = null;
  private bgmGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;

  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly loading = new Map<string, Promise<AudioBuffer | null>>();
  private readonly lastSfxAt = new Map<string, number>();

  private currentBgmKey: string | null = null;
  private currentBgmSource: AudioBufferSourceNode | null = null;
  private pendingBgm: { key: string; loop: boolean } | null = null;

  private bgmVol = 0.55;
  private sfxVol = 0.85;
  private muted = false;
  private unlocked = false;

  constructor() {
    if (typeof window !== 'undefined') {
      const unlockHandler = () => this.unlock();
      window.addEventListener('pointerdown', unlockHandler, { passive: true });
      window.addEventListener('keydown', unlockHandler, { passive: true });
    }
  }

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') {
      return null;
    }
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) {
        return null;
      }
      this.ctx = new AudioCtx();
      this.bgmGain = this.ctx.createGain();
      this.sfxGain = this.ctx.createGain();
      this.bgmGain.connect(this.ctx.destination);
      this.sfxGain.connect(this.ctx.destination);
      this._syncGains();
    }
    return this.ctx;
  }

  unlock(): void {
    const ctx = this.ensureContext();
    if (!ctx) {
      return;
    }
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    this.unlocked = true;
    if (this.pendingBgm && !this.currentBgmSource) {
      const { key, loop } = this.pendingBgm;
      void this.playBgm(key, loop);
    }
  }

  applySettings(bgmVol: number, sfxVol: number, muted: boolean): void {
    this.bgmVol = Math.max(0, Math.min(1, bgmVol));
    this.sfxVol = Math.max(0, Math.min(1, sfxVol));
    this.muted = muted;
    this._syncGains();
  }

  isMuted(): boolean {
    return this.muted;
  }

  private _syncGains(): void {
    if (!this.ctx || !this.bgmGain || !this.sfxGain) {
      return;
    }
    const now = this.ctx.currentTime;
    this.bgmGain.gain.setTargetAtTime(this.muted ? 0 : this.bgmVol, now, 0.04);
    this.sfxGain.gain.setTargetAtTime(this.muted ? 0 : this.sfxVol, now, 0.02);
  }

  private resolveKey(key: string): string | null {
    const manifest = assets.audioManifest;
    if (manifest[key]) {
      return key;
    }
    const lower = key.toLowerCase();
    for (const k of Object.keys(manifest)) {
      if (k.toLowerCase() === lower) {
        return k;
      }
    }
    return null;
  }

  private async loadBuffer(rawKey: string): Promise<AudioBuffer | null> {
    const key = this.resolveKey(rawKey);
    if (!key) {
      return null;
    }
    const cached = this.buffers.get(key);
    if (cached) {
      // Touch for LRU order
      this.buffers.delete(key);
      this.buffers.set(key, cached);
      return cached;
    }
    const inflight = this.loading.get(key);
    if (inflight) {
      return inflight;
    }
    const ctx = this.ensureContext();
    if (!ctx) {
      return null;
    }
    const url = assets.audioManifest[key];
    const task = (async (): Promise<AudioBuffer | null> => {
      try {
        const res = await fetch(url);
        if (!res.ok) {
          return null;
        }
        const ab = await res.arrayBuffer();
        const decoded = await ctx.decodeAudioData(ab);
        this.buffers.delete(key);
        this.buffers.set(key, decoded);
        this.trimBuffers();
        return decoded;
      } catch {
        return null;
      } finally {
        this.loading.delete(key);
      }
    })();
    this.loading.set(key, task);
    return task;
  }

  /** Caps decoded PCM memory across long multi-scene sessions (up to 3 BGM stems & 48 SFX). */
  private trimBuffers(): void {
    const bgmKeys: string[] = [];
    const sfxKeys: string[] = [];
    for (const [k, buf] of this.buffers.entries()) {
      if (buf.duration > 15) bgmKeys.push(k);
      else sfxKeys.push(k);
    }
    let bgmExcess = bgmKeys.length - 3;
    for (const k of bgmKeys) {
      if (bgmExcess <= 0) break;
      if (k === this.currentBgmKey) continue;
      this.buffers.delete(k);
      bgmExcess--;
    }
    let sfxExcess = sfxKeys.length - 48;
    for (const k of sfxKeys) {
      if (sfxExcess <= 0) break;
      this.buffers.delete(k);
      sfxExcess--;
    }
  }

  async playBgm(key: string, loop = true): Promise<void> {
    const resolved = this.resolveKey(key) ?? key;
    if (this.currentBgmKey === resolved && this.currentBgmSource) {
      return;
    }
    this.pendingBgm = { key: resolved, loop };
    const ctx = this.ensureContext();
    if (!ctx || (!this.unlocked && ctx.state === 'suspended')) {
      return;
    }
    this.stopBgm(true);
    this.currentBgmKey = resolved;
    const buf = await this.loadBuffer(resolved);
    if (!buf || this.currentBgmKey !== resolved || !this.bgmGain) {
      return;
    }
    try {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = loop;
      src.connect(this.bgmGain);
      src.start();
      this.currentBgmSource = src;
      src.onended = () => {
        if (this.currentBgmSource === src) {
          this.currentBgmSource = null;
        }
      };
    } catch {
      // Ignore autoplay errors until user interaction unlocks context
    }
  }

  stopBgm(keepPending = false): void {
    if (!keepPending) {
      this.pendingBgm = null;
    }
    this.currentBgmKey = null;
    if (this.currentBgmSource) {
      try {
        this.currentBgmSource.stop();
        this.currentBgmSource.disconnect();
      } catch {
        // Ignore already stopped
      }
      this.currentBgmSource = null;
    }
  }

  playSfx(keyOrList: string | string[], volume = 1.0, cooldownMs = 55): void {
    if (this.muted || this.sfxVol <= 0.001) {
      return;
    }
    const ctx = this.ensureContext();
    if (!ctx || ctx.state === 'suspended') {
      return;
    }
    const key = Array.isArray(keyOrList)
      ? keyOrList[Math.floor(Math.random() * keyOrList.length)]
      : keyOrList;
    if (!key) {
      return;
    }
    const nowMs = performance.now();
    const cooldownKey = Array.isArray(keyOrList) ? keyOrList[0] : key;
    const prev = this.lastSfxAt.get(cooldownKey) ?? 0;
    if (nowMs - prev < cooldownMs) {
      return;
    }
    this.lastSfxAt.set(cooldownKey, nowMs);

    void this.loadBuffer(key).then((buf) => {
      if (!buf || !this.ctx || !this.sfxGain || this.muted) {
        return;
      }
      try {
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        src.playbackRate.value = 0.96 + Math.random() * 0.08;
        const g = this.ctx.createGain();
        g.gain.value = Math.max(0, Math.min(1.5, volume));
        src.connect(g);
        g.connect(this.sfxGain);
        src.start();
      } catch {
        // Ignore transient WebAudio scheduling errors
      }
    });
  }
}

export const audio = new AudioManager();
