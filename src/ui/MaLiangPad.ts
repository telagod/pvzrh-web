import { assets } from '../assets/AssetLoader';
import { audio } from '../audio/AudioManager';
import { mapClientToCanvas } from '../utils/viewport';

interface StrokePt {
  x: number;
  y: number;
}

const SHAPE_POOLS: Record<string, { label: string; ids: number[] }> = {
  circle: { label: '圆形', ids: [3, 1, 2, 13] },
  horiz: { label: '横线', ids: [0, 14, 18, 1005] },
  vert: { label: '竖线', ids: [21, 5, 16, 1109] },
  star: { label: '星芒', ids: [23, 249, 909, 901] },
  wave: { label: '波纹', ids: [10, 7, 26, 32] },
};

/**
 * Interactive drawing easel for `神笔马良` (`maliangMode`).
 * Captures pointer strokes on `<canvas>`, classifies shape geometry locally,
 * and invokes `onSummon(plantId, shapeLabel)` to inject a drawn card onto the conveyor belt.
 */
export class MaLiangPad {
  private readonly host: HTMLElement;
  private readonly onSummon: (plantId: number, shapeLabel: string) => boolean;

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private inkValEl!: HTMLElement;
  private inkFillEl!: HTMLElement;
  private hintEl!: HTMLElement;
  private drawing = false;
  private points: StrokePt[] = [];

  constructor(host: HTMLElement, onSummon: (plantId: number, shapeLabel: string) => boolean) {
    this.host = host;
    this.onSummon = onSummon;
    this.mount();
  }

  private mount(): void {
    this.host.innerHTML = `
      <div class="ml-pad" id="ml-pad">
        <div class="ml-hdr">
          <img src="assets/ui/modes/maliang_pen.webp" alt="" />
          <span>神笔画板</span>
          <strong id="ml-ink-val">100</strong>
        </div>
        <div class="ml-ink-track"><div class="ml-ink-fill" id="ml-ink-fill" style="width:100%"></div></div>
        <canvas class="ml-canvas" id="ml-canvas" width="156" height="114"></canvas>
        <div class="ml-presets">
          <button class="ml-chip" data-shape="circle" title="画圆: 坚果/向日葵/樱桃">○圆</button>
          <button class="ml-chip" data-shape="horiz" title="画横: 豌豆/三线/超樱">─横</button>
          <button class="ml-chip" data-shape="vert" title="画竖: 仙人掌/大嘴/狙击">│竖</button>
          <button class="ml-chip" data-shape="star" title="画星: 杨桃/剑仙/究极">✦星</button>
        </div>
        <div class="ml-actions">
          <button class="ml-btn clear" id="ml-clear">清空</button>
          <button class="ml-btn summon" id="ml-summon">成画召唤(35)</button>
        </div>
        <div class="ml-hint" id="ml-hint">绘制后点击成画召唤！</div>
      </div>
    `;

    this.canvas = this.host.querySelector('#ml-canvas')!;
    this.ctx = this.canvas.getContext('2d')!;
    this.inkValEl = this.host.querySelector('#ml-ink-val')!;
    this.inkFillEl = this.host.querySelector('#ml-ink-fill')!;
    this.hintEl = this.host.querySelector('#ml-hint')!;

    this.clearCanvas();
    this.bindEvents();
  }

  private bindEvents(): void {
    const getPos = (e: PointerEvent): StrokePt =>
      mapClientToCanvas(this.canvas, e.clientX, e.clientY, this.canvas.width, this.canvas.height);

    this.canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.canvas.setPointerCapture(e.pointerId);
      this.drawing = true;
      const pt = getPos(e);
      this.points.push(pt);
      this.ctx.beginPath();
      this.ctx.moveTo(pt.x, pt.y);
    });

    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.drawing) return;
      const pt = getPos(e);
      this.points.push(pt);
      this.ctx.lineTo(pt.x, pt.y);
      this.ctx.strokeStyle = '#fde047';
      this.ctx.lineWidth = 4;
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';
      this.ctx.stroke();
    });

    const endStroke = () => {
      this.drawing = false;
    };
    this.canvas.addEventListener('pointerup', endStroke);
    this.canvas.addEventListener('pointercancel', endStroke);

    this.host.querySelector('#ml-clear')?.addEventListener('click', () => {
      this.clearCanvas();
      audio.playSfx('Tap2', 0.65, 40);
    });

    this.host.querySelector('#ml-summon')?.addEventListener('click', () => {
      if (this.points.length < 3) {
        this.hintEl.textContent = '请先在画布绘一笔或点上方图形！';
        audio.playSfx('Buzzer', 0.65, 80);
        return;
      }
      const shapeKey = this.classifyPoints(this.points);
      this.triggerSummon(shapeKey);
    });

    this.host.querySelectorAll<HTMLButtonElement>('[data-shape]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.shape || 'circle';
        this.drawPresetPreview(key);
        this.triggerSummon(key);
      });
    });
  }

  private drawPresetPreview(shapeKey: string): void {
    this.clearCanvas();
    const c = this.ctx;
    c.strokeStyle = '#fde047';
    c.lineWidth = 4;
    c.beginPath();
    if (shapeKey === 'circle') {
      c.arc(78, 57, 34, 0, Math.PI * 2);
      this.points = [{ x: 44, y: 23 }, { x: 112, y: 91 }, { x: 44, y: 23 }];
    } else if (shapeKey === 'horiz') {
      c.moveTo(22, 57);
      c.lineTo(134, 57);
      this.points = [{ x: 22, y: 57 }, { x: 134, y: 57 }];
    } else if (shapeKey === 'vert') {
      c.moveTo(78, 16);
      c.lineTo(78, 98);
      this.points = [{ x: 78, y: 16 }, { x: 78, y: 98 }];
    } else {
      for (let i = 0; i <= 5; i++) {
        const ang = (i * 2 * Math.PI * 2) / 5 - Math.PI / 2;
        const px = 78 + Math.cos(ang) * 36;
        const py = 57 + Math.sin(ang) * 36;
        if (i === 0) c.moveTo(px, py);
        else c.lineTo(px, py);
        this.points.push({ x: px, y: py });
      }
    }
    c.stroke();
  }

  private triggerSummon(shapeKey: string): void {
    const spec = SHAPE_POOLS[shapeKey] ?? SHAPE_POOLS.wave;
    const pid = spec.ids[Math.floor(Math.random() * spec.ids.length)];
    const ok = this.onSummon(pid, spec.label);
    if (ok) {
      const name = assets.getPlant(pid)?.name ?? '神秘植物';
      this.hintEl.textContent = `✨「${spec.label}」→ ${name}`;
      this.clearCanvas();
    } else {
      this.hintEl.textContent = '墨水不足(需35)或传送带已满！';
    }
  }

  private classifyPoints(pts: StrokePt[]): string {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let pathLen = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
      if (i > 0) pathLen += Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y);
    }
    const w = Math.max(4, maxX - minX);
    const h = Math.max(4, maxY - minY);
    const diag = Math.hypot(w, h);
    const startEnd = Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y);

    if (pathLen / Math.max(1, diag) > 2.65) return 'star';
    if (w > h * 1.8) return 'horiz';
    if (h > w * 1.8) return 'vert';
    if (startEnd < diag * 0.45 && w / h >= 0.5 && w / h <= 1.9) return 'circle';
    return 'wave';
  }

  private clearCanvas(): void {
    this.points = [];
    this.ctx.fillStyle = '#1e293b';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(4, 4, this.canvas.width - 8, this.canvas.height - 8);
  }

  updateInk(ink: number): void {
    const val = Math.max(0, Math.min(100, Math.round(ink)));
    this.inkValEl.textContent = `${val}/100`;
    this.inkFillEl.style.width = `${val}%`;
  }

  destroy(): void {
    this.host.innerHTML = '';
  }
}
