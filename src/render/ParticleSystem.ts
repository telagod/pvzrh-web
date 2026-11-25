import { Graphics } from 'pixi.js';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  gravity: number;
  life: number;
  maxLife: number;
  size: number;
  endSize: number;
  color: number;
  alpha: number;
  shape: 'circle' | 'rect' | 'ring';
  rot: number;
  vrot: number;
}

const MAX_PARTICLES = 360;

/**
 * Pooled single-`Graphics` particle system rendering impacts, explosions,
 * golden fusion bursts, sun sparkles, and flying zombie armor chunks in one batched draw.
 */
export class ParticleSystem {
  readonly view = new Graphics();
  private readonly active: Particle[] = [];
  private overwriteIdx = 0;
  private hadParticles = false;

  private spawn(p: Particle): void {
    this.hadParticles = true;
    if (this.active.length >= MAX_PARTICLES) {
      this.active[this.overwriteIdx] = p;
      this.overwriteIdx = (this.overwriteIdx + 1) % MAX_PARTICLES;
      return;
    }
    this.active.push(p);
  }

  emitSplat(x: number, y: number, color: number, count = 6): void {
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 40 + Math.random() * 110;
      this.spawn({
        x,
        y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - 35,
        gravity: 340,
        life: 0,
        maxLife: 0.25 + Math.random() * 0.2,
        size: 3 + Math.random() * 3.5,
        endSize: 0.5,
        color,
        alpha: 0.95,
        shape: 'circle',
        rot: 0,
        vrot: 0,
      });
    }
  }

  emitExplosion(x: number, y: number, radius: number, theme: 'fire' | 'ice' | 'doom' | 'cherry'): void {
    const palette =
      theme === 'ice'
        ? [0xe0f2fe, 0x7dd3fc, 0x38bdf8]
        : theme === 'doom'
          ? [0x9333ea, 0x6b21a8, 0xfef08a, 0x1e1b4b]
          : [0xfef08a, 0xf97316, 0xef4444, 0xfb923c];

    this.spawn({
      x,
      y,
      vx: 0,
      vy: 0,
      gravity: 0,
      life: 0,
      maxLife: 0.42,
      size: 16,
      endSize: Math.max(70, radius * 0.85),
      color: theme === 'ice' ? 0xbae6fd : theme === 'doom' ? 0xc084fc : 0xfbbf24,
      alpha: 0.85,
      shape: 'ring',
      rot: 0,
      vrot: 0,
    });

    const count = theme === 'doom' ? 38 : 26;
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 70 + Math.random() * Math.max(140, radius * 1.4);
      this.spawn({
        x: x + (Math.random() - 0.5) * 24,
        y: y + (Math.random() - 0.5) * 24,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - 60,
        gravity: theme === 'ice' ? 120 : -35,
        life: 0,
        maxLife: 0.4 + Math.random() * 0.45,
        size: 5 + Math.random() * 10,
        endSize: 1,
        color: palette[i % palette.length],
        alpha: 0.95,
        shape: 'circle',
        rot: 0,
        vrot: 0,
      });
    }
  }

  emitFusionBurst(x: number, y: number): void {
    for (let r = 0; r < 2; r++) {
      this.spawn({
        x,
        y: y - 24,
        vx: 0,
        vy: 0,
        gravity: 0,
        life: r * -0.06,
        maxLife: 0.55,
        size: 10,
        endSize: r === 0 ? 78 : 54,
        color: r === 0 ? 0xfacc15 : 0xfef08a,
        alpha: 0.95,
        shape: 'ring',
        rot: 0,
        vrot: 0,
      });
    }
    for (let i = 0; i < 20; i++) {
      const ang = (i / 20) * Math.PI * 2 + Math.random() * 0.2;
      const spd = 45 + Math.random() * 95;
      this.spawn({
        x: x + (Math.random() - 0.5) * 20,
        y: y - 20,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - 45,
        gravity: 160,
        life: 0,
        maxLife: 0.45 + Math.random() * 0.35,
        size: 4 + Math.random() * 4,
        endSize: 0.5,
        color: i % 2 === 0 ? 0xfde047 : 0xffffff,
        alpha: 1,
        shape: i % 3 === 0 ? 'rect' : 'circle',
        rot: Math.random() * Math.PI,
        vrot: (Math.random() - 0.5) * 10,
      });
    }
  }

  emitArmorDrop(x: number, y: number, color: number, count = 1): void {
    for (let i = 0; i < count; i++) {
      this.spawn({
        x: x + (Math.random() - 0.5) * 14,
        y: y - 55,
        vx: 25 + Math.random() * 45,
        vy: -150 - Math.random() * 70,
        gravity: 560,
        life: 0,
        maxLife: 0.72,
        size: 11 + Math.random() * 5,
        endSize: 10,
        color,
        alpha: 0.98,
        shape: 'rect',
        rot: Math.random() * Math.PI,
        vrot: (Math.random() > 0.5 ? 1 : -1) * (6 + Math.random() * 6),
      });
    }
  }

  emitSunSparkle(x: number, y: number): void {
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2;
      this.spawn({
        x,
        y,
        vx: Math.cos(ang) * 55,
        vy: Math.sin(ang) * 55,
        gravity: 0,
        life: 0,
        maxLife: 0.32,
        size: 4,
        endSize: 0.5,
        color: 0xfef08a,
        alpha: 0.95,
        shape: 'circle',
        rot: 0,
        vrot: 0,
      });
    }
  }

  emitPlantDirt(x: number, y: number): void {
    for (let i = 0; i < 10; i++) {
      const ang = -Math.PI * 0.15 - Math.random() * Math.PI * 0.7;
      const spd = 40 + Math.random() * 75;
      this.spawn({
        x: x + (Math.random() - 0.5) * 28,
        y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        gravity: 420,
        life: 0,
        maxLife: 0.35 + Math.random() * 0.15,
        size: 3.5 + Math.random() * 3,
        endSize: 1.5,
        color: i % 2 === 0 ? 0x78350f : 0x92400e,
        alpha: 0.9,
        shape: 'rect',
        rot: Math.random() * Math.PI,
        vrot: (Math.random() - 0.5) * 8,
      });
    }
  }

  emitWaterSplash(x: number, y: number): void {
    for (let i = 0; i < 10; i++) {
      const ang = -Math.PI * 0.15 - Math.random() * Math.PI * 0.7;
      const spd = 50 + Math.random() * 85;
      this.spawn({
        x: x + (Math.random() - 0.5) * 20,
        y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        gravity: 420,
        life: 0,
        maxLife: 0.38,
        size: 3 + Math.random() * 3.5,
        endSize: 1,
        color: i % 2 === 0 ? 0xbae6fd : 0x38bdf8,
        alpha: 0.92,
        shape: 'circle',
        rot: 0,
        vrot: 0,
      });
    }
  }

  update(dt: number): void {
    const g = this.view;
    if (this.active.length === 0) {
      if (this.hadParticles) {
        g.clear();
        this.hadParticles = false;
      }
      return;
    }
    g.clear();
    this.hadParticles = true;

    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      p.life += dt;
      if (p.life < 0) {
        continue;
      }
      if (p.life >= p.maxLife) {
        const lastIdx = this.active.length - 1;
        if (i !== lastIdx) {
          this.active[i] = this.active[lastIdx];
        }
        this.active.pop();
        continue;
      }
      const u = p.life / p.maxLife;
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vrot * dt;

      const curSize = p.size + (p.endSize - p.size) * u;
      const curAlpha = p.alpha * (1 - u * u);
      if (curAlpha <= 0.01) {
        continue;
      }

      if (p.shape === 'circle') {
        g.circle(p.x, p.y, curSize).fill({ color: p.color, alpha: curAlpha });
      } else if (p.shape === 'ring') {
        g.circle(p.x, p.y, curSize).stroke({
          width: Math.max(1.5, 5 * (1 - u)),
          color: p.color,
          alpha: curAlpha,
        });
      } else {
        const c = Math.cos(p.rot) * curSize * 0.55;
        const s = Math.sin(p.rot) * curSize * 0.55;
        g.poly([
          p.x - c + s,
          p.y - s - c,
          p.x + c + s,
          p.y + s - c,
          p.x + c - s,
          p.y + s + c,
          p.x - c - s,
          p.y - s + c,
        ]).fill({ color: p.color, alpha: curAlpha });
      }
    }
  }

  clear(): void {
    this.active.length = 0;
    this.overwriteIdx = 0;
    this.hadParticles = false;
    this.view.clear();
  }
}
