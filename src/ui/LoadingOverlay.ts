export interface LoadingShowOptions {
  title: string;
  detail?: string;
  ratio?: number;
  countText?: string;
  badge?: string;
}

function waitEagerImages(root: HTMLElement, maxMs: number): Promise<void> {
  const imgs = Array.from(root.querySelectorAll('img')).filter(
    (img) => img.getAttribute('loading') !== 'lazy' && img.getAttribute('src'),
  );
  const pending = imgs.map((img) => {
    if (img.complete && img.naturalWidth > 0) {
      return typeof img.decode === 'function' ? img.decode().catch(() => {}) : Promise.resolve();
    }
    return new Promise<void>((res) => {
      img.addEventListener('load', () => res(), { once: true });
      img.addEventListener('error', () => res(), { once: true });
    });
  });
  const frame = new Promise<void>((res) => requestAnimationFrame(() => res()));
  const deadline = new Promise<void>((res) => setTimeout(res, maxMs));
  return Promise.race([Promise.all([...pending, frame]).then(() => {}), deadline]);
}

export interface LoadingStateSnapshot {
  visible: boolean;
  ratio: number;
  title: string;
  detail: string;
  countText: string;
}

/**
 * Full-stage blocking PvZ-themed loading progress overlay preventing user
 * interaction until required on-demand assets are ready.
 */
export class LoadingOverlay {
  private readonly host: HTMLElement;
  private overlayEl!: HTMLElement;
  private badgeEl!: HTMLElement;
  private titleEl!: HTMLElement;
  private detailEl!: HTMLElement;
  private fillEl!: HTMLElement;
  private pctEl!: HTMLElement;
  private countEl!: HTMLElement;
  private tipEl!: HTMLElement;
  private errorBoxEl!: HTMLElement;
  private retryBtn!: HTMLButtonElement;

  private visible = false;
  private ratio = 0;
  private title = '';
  private detail = '';
  private countText = '';
  private sessionToken = 0;
  private onRetryCb: (() => void) | null = null;

  constructor(host: HTMLElement) {
    this.host = host;
    this.ensureDom();
  }

  private ensureDom(): void {
    this.host.innerHTML = `
      <div class="loading-overlay" id="loading-overlay" style="display:none" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
        <div class="load-card">
          <div class="load-head-row">
            <img class="load-sun" src="assets/bullets/sun.webp" alt="" />
            <span class="load-badge" id="loading-badge">按需加载</span>
          </div>
          <h2 id="loading-title">正在准备...</h2>
          <p class="load-detail" id="loading-detail">正在初始化...</p>
          <div class="load-bar-track">
            <div class="load-bar-fill" id="loading-bar-fill" style="width:0%"></div>
          </div>
          <div class="load-meta-row">
            <span id="loading-count"></span>
            <span id="loading-pct">0%</span>
          </div>
          <div class="load-tip" id="loading-tip">按需加载当前界面与本关所需素材，加载完成后自动进入</div>
          <div class="load-error-actions" id="loading-error-actions" style="display:none">
            <button class="btn-gold" id="loading-retry-btn" type="button">重新加载</button>
          </div>
        </div>
      </div>
    `;
    this.overlayEl = this.host.querySelector('#loading-overlay')!;
    this.badgeEl = this.host.querySelector('#loading-badge')!;
    this.titleEl = this.host.querySelector('#loading-title')!;
    this.detailEl = this.host.querySelector('#loading-detail')!;
    this.fillEl = this.host.querySelector('#loading-bar-fill')!;
    this.pctEl = this.host.querySelector('#loading-pct')!;
    this.countEl = this.host.querySelector('#loading-count')!;
    this.tipEl = this.host.querySelector('#loading-tip')!;
    this.errorBoxEl = this.host.querySelector('#loading-error-actions')!;
    this.retryBtn = this.host.querySelector('#loading-retry-btn')!;
    this.retryBtn.addEventListener('click', () => {
      this.onRetryCb?.();
    });
  }

  private applyVisuals(): void {
    const pct = Math.max(0, Math.min(100, Math.round(this.ratio * 100)));
    this.titleEl.textContent = this.title;
    this.detailEl.textContent = this.detail;
    this.fillEl.style.width = `${pct}%`;
    this.pctEl.textContent = `${pct}%`;
    this.countEl.textContent = this.countText;
    this.overlayEl.setAttribute('aria-valuenow', String(pct));
  }

  show(opts: LoadingShowOptions): void {
    this.sessionToken++;
    this.visible = true;
    this.ratio = Math.max(0, Math.min(1, opts.ratio ?? 0.02));
    this.title = opts.title;
    this.detail = opts.detail ?? '正在加载所需资源...';
    this.countText = opts.countText ?? '';
    this.onRetryCb = null;

    this.badgeEl.textContent = opts.badge ?? '按需加载';
    this.overlayEl.classList.remove('is-error', 'fade-out');
    this.errorBoxEl.style.display = 'none';
    this.tipEl.style.display = 'block';
    this.overlayEl.style.display = 'flex';
    document.body.dataset.loading = '1';
    this.applyVisuals();
  }

  update(ratio: number, detail?: string, countText?: string): void {
    if (!this.visible) return;
    const clamped = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : this.ratio));
    this.ratio = Math.max(this.ratio, clamped);
    if (detail !== undefined) this.detail = detail;
    if (countText !== undefined) this.countText = countText;
    this.applyVisuals();
  }

  async finish(doneLabel = '加载完成', waitRoot?: HTMLElement): Promise<void> {
    if (!this.visible) return;
    const token = this.sessionToken;
    this.ratio = 1;
    this.detail = doneLabel;
    this.applyVisuals();

    if (waitRoot) {
      await waitEagerImages(waitRoot, 600);
      if (token !== this.sessionToken || !this.visible) return;
    }

    await new Promise((r) => setTimeout(r, 110));
    if (token !== this.sessionToken || !this.visible) return;

    this.overlayEl.classList.add('fade-out');
    await new Promise((r) => setTimeout(r, 160));
    if (token !== this.sessionToken) return;

    this.visible = false;
    this.overlayEl.style.display = 'none';
    this.overlayEl.classList.remove('fade-out');
    document.body.dataset.loading = '0';
  }

  hideImmediate(): void {
    this.sessionToken++;
    this.visible = false;
    this.onRetryCb = null;
    this.overlayEl.style.display = 'none';
    this.overlayEl.classList.remove('fade-out', 'is-error');
    document.body.dataset.loading = '0';
  }

  showError(title: string, message: string, onRetry: () => void): void {
    this.sessionToken++;
    this.visible = true;
    this.title = title;
    this.detail = message;
    this.onRetryCb = onRetry;
    this.badgeEl.textContent = '加载失败';
    this.overlayEl.classList.remove('fade-out');
    this.overlayEl.classList.add('is-error');
    this.tipEl.style.display = 'none';
    this.errorBoxEl.style.display = 'flex';
    this.overlayEl.style.display = 'flex';
    document.body.dataset.loading = '1';
    this.applyVisuals();
  }

  isVisible(): boolean {
    return this.visible;
  }

  getState(): LoadingStateSnapshot {
    return {
      visible: this.visible,
      ratio: this.ratio,
      title: this.title,
      detail: this.detail,
      countText: this.countText,
    };
  }
}
