import { Application, Graphics, Sprite } from 'pixi.js';
import { assets } from '../assets/AssetLoader';
import { audio } from '../audio/AudioManager';
import { fusionSystem } from '../engine/FusionSystem';
import { UnityAnimator } from '../render/UnityAnimator';
import { UnityRigInstance } from '../render/UnityRigInstance';
import { getPlantUnlockHint } from '../save/plantUnlocks';
import { saveManager } from '../save/SaveManager';
import type { PlantDef, ZombieDef } from '../types/game';
import { bindHoverImages, escHtml, getCardFrameUrl, getPlayablePlants, isBasePlant } from './levelsCatalog';

const PREV_W = 196;
const PREV_H = 196;

type AlmanacFilter =
  | 'all'
  | 'base'
  | 'fused'
  | 'super'
  | 'ultimate'
  | 'white'
  | 'colorful'
  | 'water'
  | 'fly'
  | 'nut'
  | 'magnet'
  | 'z_ulti';

/**
 * 1:1 Unity Almanac (`almanacmenu`, `almanacplantmenu`, `almanaczombiemenu`) featuring
 * the official Index entry screen, cutout detail card layering, expanded tag categories,
 * flanking flower prev/next nav, and bottom official rail.
 */
export class Almanac {
  private readonly uiRoot: HTMLElement;
  private readonly onClose: () => void;

  private view: 'index' | 'plants' | 'zombies' = 'index';
  private filterTag: AlmanacFilter = 'all';
  private query = '';
  private selectedPlantId = 0;
  private selectedZombieId = 0;

  private previewHost: HTMLElement | null = null;
  private previewApp: Application | null = null;
  private bgGroundSprite: Sprite | null = null;
  private curRig: UnityRigInstance | null = null;
  private curAnimator: UnityAnimator | null = null;
  private clipToken = 0;
  private destroyed = false;

  constructor(
    uiRoot: HTMLElement,
    onClose: () => void,
    initialPlantId?: number,
    initialView: 'index' | 'plants' | 'zombies' = 'index',
  ) {
    this.uiRoot = uiRoot;
    this.onClose = onClose;
    this.view = initialView;
    if (initialPlantId !== undefined) {
      this.selectedPlantId = initialPlantId;
      this.view = 'plants';
    }
  }

  async mount(): Promise<void> {
    await Promise.allSettled([
      assets.loadTexture('assets/ui/ground_day.webp'),
      assets.loadTexture('assets/ui/ground_night.webp'),
      assets.loadTexture('assets/ui/ground_pool.webp'),
      assets.loadTexture('assets/ui/ground_roof.webp'),
    ]);
    if (this.destroyed) return;
    await this.enterView(this.view);
  }

  private destroyPreview(): void {
    this.curRig?.destroy();
    this.curRig = null;
    this.curAnimator = null;
    this.bgGroundSprite = null;
    if (this.previewApp) {
      this.previewApp.destroy(
        { removeView: true },
        { children: true, texture: false, textureSource: false },
      );
      this.previewApp = null;
    }
    this.previewHost = null;
  }

  private async enterView(nextView: 'index' | 'plants' | 'zombies'): Promise<void> {
    this.view = nextView;
    this.filterTag = 'all';
    if (this.view === 'index') {
      this.destroyPreview();
      this.renderIndex();
      return;
    }
    if (!this.previewApp || !this.uiRoot.querySelector('#alm-canvas-host')) {
      this.destroyPreview();
      this.renderShell();
      await this.initPreviewApp();
    }
    await this.refreshListAndDetail();
  }

  private renderIndex(): void {
    const plantCnt = getPlayablePlants().length;
    const zombieCnt = Object.keys(assets.catalog.zombies).length;
    this.uiRoot.innerHTML = `
      <div class="alm-backdrop is-index-mode" style="background-image:url('assets/ui/almanac_index_bg.webp')">
        <div class="alm-header-title">图鉴——索引</div>

        <div class="alm-index-card-pair">
          <div class="alm-index-col">
            <img class="alm-index-preview" src="assets/portraits/plants/p_0.webp" alt="植物" />
            <button class="alm-index-enter-btn" id="alm-idx-plants">
              <img src="assets/ui/almanac_index_btn.webp" data-base="assets/ui/almanac_index_btn.webp" data-hl="assets/ui/almanac_index_btn_hl.webp" alt="" />
              <span>查看植物 (${plantCnt})</span>
            </button>
          </div>

          <div class="alm-index-col">
            <img class="alm-index-preview" src="assets/portraits/zombies/z_0.webp" alt="僵尸" />
            <button class="alm-index-enter-btn" id="alm-idx-zombies">
              <img src="assets/ui/almanac_index_btn.webp" data-base="assets/ui/almanac_index_btn.webp" data-hl="assets/ui/almanac_index_btn_hl.webp" alt="" />
              <span>查看僵尸 (${zombieCnt})</span>
            </button>
          </div>
        </div>

        <div class="alm-index-note">
          当前已收录 ${plantCnt} 种可参战植物 · ${zombieCnt} 种僵尸（含 600+ 种实时融合配方图谱）
        </div>

        <button class="alm-close-official" id="alm-close" style="right:36px;bottom:22px;position:absolute" title="关闭图鉴">
          <img src="assets/ui/almanac_close.webp" data-base="assets/ui/almanac_close.webp" data-hl="assets/ui/almanac_close_hl.webp" alt="关闭" />
          <span>关闭</span>
        </button>
      </div>
    `;
    bindHoverImages(this.uiRoot);
    this.uiRoot.querySelector('#alm-idx-plants')?.addEventListener('click', () => {
      audio.playSfx('GraveButton', 0.8, 40);
      void this.enterView('plants');
    });
    this.uiRoot.querySelector('#alm-idx-zombies')?.addEventListener('click', () => {
      audio.playSfx('GraveButton', 0.8, 40);
      void this.enterView('zombies');
    });
    this.uiRoot.querySelector('#alm-close')?.addEventListener('click', () => {
      audio.playSfx('ButtonClick', 0.8, 40);
      this.onClose();
    });
  }

  private renderShell(): void {
    const isZ = this.view === 'zombies';
    const bgUrl = !isZ ? 'assets/ui/almanac_plant_bg.webp' : 'assets/ui/almanac_zombie_bg.webp';
    this.uiRoot.innerHTML = `
      <div class="alm-backdrop ${isZ ? 'is-zombie-mode' : 'is-plant-mode'}" id="alm-backdrop" style="background-image:url('${bgUrl}')">
        <div class="alm-header-title" id="alm-header-title">${isZ ? '图鉴——僵尸' : '图鉴——植物'}</div>

        <div class="alm-sidebar" id="alm-plant-sidebar"></div>

        <div class="alm-grid-pane" id="alm-grid-pane">
          <div class="alm-grid" id="alm-grid"></div>
        </div>

        <button class="alm-flower-nav prev" id="alm-prev-entry" title="上一个">
          <img src="assets/ui/button_flower.webp" alt="上一个" />
          <span>‹</span>
        </button>
        <button class="alm-flower-nav next" id="alm-next-entry" title="下一个">
          <img src="assets/ui/button_flower.webp" alt="下一个" />
          <span>›</span>
        </button>

        <div class="alm-right-card ${isZ ? 'is-zombie' : 'is-plant'}" id="alm-right-card">
          <div class="alm-preview-cutout" id="alm-canvas-host"></div>
          <img class="alm-card-bg" id="alm-card-bg" src="assets/ui/almanac_${isZ ? 'zombie' : 'plant'}_card.webp" alt="" />
          <div class="alm-clip-bar" id="alm-clip-bar"></div>
          <div class="alm-card-title" id="alm-card-title"></div>
          <div class="alm-info-parchment" id="alm-info-scroll"></div>
        </div>

        <div class="alm-bottom-rail">
          <button class="alm-idx-btn" id="alm-back-index" title="返回图鉴索引">
            <img src="assets/ui/almanac_index_btn.webp" data-base="assets/ui/almanac_index_btn.webp" data-hl="assets/ui/almanac_index_btn_hl.webp" alt="" />
            <span>返回索引</span>
          </button>
          <button class="alm-idx-btn ${!isZ ? 'active' : ''}" id="alm-tab-plants">
            <img src="assets/ui/almanac_index_btn${!isZ ? '_hl' : ''}.webp" data-base="assets/ui/almanac_index_btn.webp" data-hl="assets/ui/almanac_index_btn_hl.webp" alt="" />
            <span>植物图鉴 (${getPlayablePlants().length})</span>
          </button>
          <button class="alm-idx-btn ${isZ ? 'active' : ''}" id="alm-tab-zombies">
            <img src="assets/ui/almanac_index_btn${isZ ? '_hl' : ''}.webp" data-base="assets/ui/almanac_index_btn.webp" data-hl="assets/ui/almanac_index_btn_hl.webp" alt="" />
            <span>僵尸图鉴 (${Object.keys(assets.catalog.zombies).length})</span>
          </button>

          <div class="alm-zombie-filters" id="alm-zombie-filters"></div>

          <input class="alm-search" id="alm-search" type="search" placeholder="搜索名称 / 英文 / ID..." />

          <button class="alm-close-official" id="alm-close" title="关闭图鉴">
            <img src="assets/ui/almanac_close.webp" data-base="assets/ui/almanac_close.webp" data-hl="assets/ui/almanac_close_hl.webp" alt="关闭" />
            <span>关闭</span>
          </button>
        </div>
      </div>
    `;

    this.previewHost = this.uiRoot.querySelector('#alm-canvas-host');
    bindHoverImages(this.uiRoot);

    this.uiRoot.querySelector('#alm-close')?.addEventListener('click', () => {
      audio.playSfx('ButtonClick', 0.8, 40);
      this.onClose();
    });
    this.uiRoot.querySelector('#alm-back-index')?.addEventListener('click', () => {
      audio.playSfx('Tap', 0.7, 40);
      void this.enterView('index');
    });
    this.uiRoot.querySelector('#alm-tab-plants')?.addEventListener('click', () => {
      this.view = 'plants';
      this.filterTag = 'all';
      audio.playSfx('Tap', 0.7, 40);
      void this.refreshListAndDetail();
    });
    this.uiRoot.querySelector('#alm-tab-zombies')?.addEventListener('click', () => {
      this.view = 'zombies';
      this.filterTag = 'all';
      audio.playSfx('Tap', 0.7, 40);
      void this.refreshListAndDetail();
    });
    this.uiRoot.querySelector<HTMLInputElement>('#alm-search')?.addEventListener('input', (e) => {
      this.query = (e.target as HTMLInputElement).value.trim().toLowerCase();
      this.renderGrid();
    });
    this.uiRoot.querySelector('#alm-prev-entry')?.addEventListener('click', () => this.stepEntry(-1));
    this.uiRoot.querySelector('#alm-next-entry')?.addEventListener('click', () => this.stepEntry(1));
  }

  private stepEntry(delta: -1 | 1): void {
    audio.playSfx('SelectCard', 0.7, 40);
    if (this.view === 'plants') {
      const list = this.getFilteredPlants();
      if (!list.length) return;
      const curIdx = Math.max(0, list.findIndex((p) => p.id === this.selectedPlantId));
      const next = list[(curIdx + delta + list.length) % list.length];
      this.selectedPlantId = next.id;
    } else {
      const list = this.getFilteredZombies();
      if (!list.length) return;
      const curIdx = Math.max(0, list.findIndex((z) => z.id === this.selectedZombieId));
      const next = list[(curIdx + delta + list.length) % list.length];
      this.selectedZombieId = next.id;
    }
    this.renderGrid();
    void this.renderDetail();
  }

  private async initPreviewApp(): Promise<void> {
    if (!this.previewHost || this.destroyed) return;
    const app = new Application();
    await app.init({
      width: PREV_W,
      height: PREV_H,
      backgroundColor: 0x1e293b,
      antialias: true,
      preference: 'webgl',
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
    });
    if (this.destroyed) {
      app.destroy({ removeView: true }, { children: true, texture: false, textureSource: false });
      return;
    }
    this.previewApp = app;
    app.canvas.style.width = '100%';
    app.canvas.style.height = '100%';
    app.canvas.style.display = 'block';
    this.previewHost.appendChild(app.canvas);

    const gTex = assets.getCachedTexture('assets/ui/ground_day.webp');
    if (gTex) {
      const sp = new Sprite(gTex);
      sp.width = PREV_W;
      sp.height = PREV_H;
      app.stage.addChild(sp);
      this.bgGroundSprite = sp;
    } else {
      const bg = new Graphics();
      bg.rect(0, 0, PREV_W, PREV_H).fill(0x28562b);
      app.stage.addChild(bg);
    }

    app.ticker.add((ticker) => {
      const dt = Math.min(0.05, ticker.deltaMS / 1000);
      this.curAnimator?.update(dt);
    });
  }

  private async refreshListAndDetail(): Promise<void> {
    if (this.view === 'index') return;
    const isZ = this.view === 'zombies';
    const backdrop = this.uiRoot.querySelector<HTMLElement>('#alm-backdrop');
    if (backdrop) {
      backdrop.style.backgroundImage = `url('${
        isZ ? 'assets/ui/almanac_zombie_bg.webp' : 'assets/ui/almanac_plant_bg.webp'
      }')`;
      backdrop.classList.toggle('is-zombie-mode', isZ);
      backdrop.classList.toggle('is-plant-mode', !isZ);
    }

    const hdrTitle = this.uiRoot.querySelector('#alm-header-title');
    if (hdrTitle) hdrTitle.textContent = isZ ? '图鉴——僵尸' : '图鉴——植物';

    const gridPane = this.uiRoot.querySelector<HTMLElement>('#alm-grid-pane');
    const sidebar = this.uiRoot.querySelector<HTMLElement>('#alm-plant-sidebar')!;
    const zFilters = this.uiRoot.querySelector<HTMLElement>('#alm-zombie-filters')!;
    gridPane?.classList.toggle('is-zombie', isZ);

    const rightCard = this.uiRoot.querySelector<HTMLElement>('#alm-right-card');
    const cardBg = this.uiRoot.querySelector<HTMLImageElement>('#alm-card-bg');
    if (rightCard && cardBg) {
      rightCard.classList.toggle('is-zombie', isZ);
      rightCard.classList.toggle('is-plant', !isZ);
      cardBg.src = isZ ? 'assets/ui/almanac_zombie_card.webp' : 'assets/ui/almanac_plant_card.webp';
    }

    const pTabBtn = this.uiRoot.querySelector<HTMLButtonElement>('#alm-tab-plants');
    const zTabBtn = this.uiRoot.querySelector<HTMLButtonElement>('#alm-tab-zombies');
    pTabBtn?.classList.toggle('active', !isZ);
    zTabBtn?.classList.toggle('active', isZ);
    const pImg = pTabBtn?.querySelector('img');
    const zImg = zTabBtn?.querySelector('img');
    if (pImg) {
      const pSrc = !isZ ? 'assets/ui/almanac_index_btn_hl.webp' : 'assets/ui/almanac_index_btn.webp';
      pImg.src = pSrc;
      pImg.dataset.base = pSrc;
    }
    if (zImg) {
      const zSrc = isZ ? 'assets/ui/almanac_index_btn_hl.webp' : 'assets/ui/almanac_index_btn.webp';
      zImg.src = zSrc;
      zImg.dataset.base = zSrc;
    }

    if (!isZ) {
      const allPlants = getPlayablePlants();
      const baseCnt = allPlants.filter((p) => isBasePlant(p.id)).length;
      const fusedCnt = allPlants.length - baseCnt;

      const chips: [AlmanacFilter, string][] = [
        ['all', `全部 (${allPlants.length})`],
        ['base', `基础 (${baseCnt})`],
        ['fused', `融合 (${fusedCnt})`],
        ['super', '超级植物'],
        ['ultimate', '究极植物'],
        ['white', '白卡植物'],
        ['colorful', '彩卡植物'],
        ['water', '水生植物'],
        ['fly', '飞行植物'],
        ['nut', '坚果植物'],
        ['magnet', '磁力植物'],
      ];
      sidebar.style.display = 'flex';
      zFilters.style.display = 'none';
      sidebar.innerHTML = `
        <div class="alm-cat-title">分类查询</div>
        ${chips
          .map(([k, lbl]) => {
            const act = this.filterTag === k;
            const tex = act ? 'assets/ui/seed_chooser_btn2_glow.webp' : 'assets/ui/seed_chooser_btn2.webp';
            return `
              <button class="alm-cat-btn ${act ? 'active' : ''}" data-f="${k}">
                <img src="${tex}" data-base="${tex}" data-hl="assets/ui/seed_chooser_btn2_glow.webp" alt="" />
                <span>${lbl}</span>
              </button>
            `;
          })
          .join('')}
      `;
    } else {
      const chips: [AlmanacFilter, string][] = [
        ['all', '全部僵尸'],
        ['z_ulti', '究极/高阶'],
        ['water', '水生僵尸'],
        ['fly', '空中僵尸'],
      ];
      sidebar.style.display = 'none';
      zFilters.style.display = 'flex';
      zFilters.innerHTML = chips
        .map(([k, lbl]) => {
          const act = this.filterTag === k;
          const tex = act ? 'assets/ui/seed_chooser_btn2_glow.webp' : 'assets/ui/seed_chooser_btn2.webp';
          return `
            <button class="alm-z-filter-btn ${act ? 'active' : ''}" data-f="${k}">
              <img src="${tex}" data-base="${tex}" data-hl="assets/ui/seed_chooser_btn2_glow.webp" alt="" />
              <span>${lbl}</span>
            </button>
          `;
        })
        .join('');
    }

    this.uiRoot.querySelectorAll<HTMLButtonElement>('[data-f]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.filterTag = btn.dataset.f as AlmanacFilter;
        audio.playSfx('Tap', 0.7, 35);
        void this.refreshListAndDetail();
      });
    });
    bindHoverImages(this.uiRoot);

    this.renderGrid();
    await this.renderDetail();
  }

  private getFilteredPlants(): PlantDef[] {
    return getPlayablePlants().filter((p) => {
      if (this.filterTag === 'base' && !isBasePlant(p.id)) return false;
      if (this.filterTag === 'fused' && isBasePlant(p.id)) return false;
      if (this.filterTag === 'super' && !p.name.includes('超级') && !p.tags.includes('RedPlant')) return false;
      if (
        this.filterTag === 'ultimate' &&
        !p.name.includes('究极') &&
        !p.tags.includes('PurplePlants') &&
        !p.tags.includes('UltimatePlants')
      )
        return false;
      if (this.filterTag === 'white' && !p.tags.includes('WhiteCardPlants')) return false;
      if (this.filterTag === 'colorful' && !p.tags.includes('SpecialCardPlants')) return false;
      if (
        this.filterTag === 'water' &&
        p.layer !== 'Lily' &&
        !p.tags.includes('WaterPlants') &&
        !p.tags.includes('LilyPlants') &&
        !p.tags.includes('KelpPlants')
      )
        return false;
      if (this.filterTag === 'fly' && p.layer !== 'Fly' && !p.tags.includes('FlyingPlants')) return false;
      if (this.filterTag === 'nut' && !p.tags.includes('WallNutPlants') && !p.tags.includes('TallNutPlants'))
        return false;
      if (this.filterTag === 'magnet' && !p.tags.includes('MagnetPlants')) return false;
      if (this.query) {
        const hay = `${p.id} ${p.name} ${p.en} ${p.scriptClass}`.toLowerCase();
        if (!hay.includes(this.query)) return false;
      }
      return true;
    });
  }

  private getFilteredZombies(): ZombieDef[] {
    return Object.values(assets.catalog.zombies)
      .filter((z) => {
        if (
          this.filterTag === 'z_ulti' &&
          !z.tags.includes('UltimateZombie') &&
          !z.tags.includes('BossZombies') &&
          !z.tags.includes('EliteZombie')
        )
          return false;
        if (this.filterTag === 'water' && !z.tags.includes('WaterZombie')) return false;
        if (this.filterTag === 'fly' && !z.tags.includes('IsAirZombie') && !z.tags.includes('IsAirShipZombie')) return false;
        if (this.query) {
          const hay = `${z.id} ${z.name} ${z.en} ${z.scriptClass}`.toLowerCase();
          if (!hay.includes(this.query)) return false;
        }
        return true;
      })
      .sort((a, b) => a.id - b.id);
  }

  private renderGrid(): void {
    const gridEl = this.uiRoot.querySelector('#alm-grid')!;
    if (this.view === 'plants') {
      const list = this.getFilteredPlants();
      gridEl.innerHTML = list
        .map(
          (p) => `
          <button class="pvz-packet in-almanac ${p.id === this.selectedPlantId ? 'active' : ''}" data-id="${p.id}" title="${escHtml(p.name)} (#${p.id})">
            <img class="pkt-frame" src="${getCardFrameUrl(p)}" alt="" />
            <img class="pkt-portrait" src="assets/portraits/plants/${p.portrait}" loading="lazy" alt="${escHtml(p.name)}" />
            <span class="pkt-cost">${p.cost}</span>
          </button>
        `,
        )
        .join('');
    } else {
      const list = this.getFilteredZombies();
      gridEl.innerHTML = list
        .map(
          (z) => `
          <button class="alm-z-card ${z.id === this.selectedZombieId ? 'active' : ''}" data-id="${z.id}" title="${escHtml(z.name)} (#${z.id})">
            <img class="alm-z-frame" src="assets/ui/almanac_zombie_window.webp" alt="" />
            <img class="alm-z-port" src="assets/portraits/zombies/${z.portrait || `z_${z.id}.webp`}" loading="lazy" alt="${escHtml(z.name)}" />
            <img class="alm-z-hl" src="assets/ui/almanac_zombie_window2.webp" alt="" />
            <span class="alm-z-tier">T${z.tier}</span>
            <span class="alm-z-name">${escHtml(z.name)}</span>
          </button>
        `,
        )
        .join('');
    }

    gridEl.querySelectorAll<HTMLButtonElement>('[data-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = Number(btn.dataset.id);
        audio.playSfx('SelectCard', 0.7, 40);
        if (this.view === 'plants') this.selectedPlantId = id;
        else this.selectedZombieId = id;
        gridEl.querySelectorAll('.active').forEach((x) => x.classList.remove('active'));
        btn.classList.add('active');
        void this.renderDetail();
      });
    });
  }

  /** Auto-scales & centers any rig cleanly inside the square cutout window above nameplate. */
  private mountPreviewRig(rInst: UnityRigInstance, anim: UnityAnimator, isPlant: boolean): void {
    if (!this.previewApp) return;
    anim.evaluateAndApply();
    const bounds = rInst.computeLocalBounds();
    const padX = 24;
    const padTop = 18;
    const padBot = isPlant ? 52 : 40;
    const maxW = PREV_W - padX * 2;
    const maxH = PREV_H - padTop - padBot;
    const scale = Math.min(1.16, Math.max(0.28, Math.min(maxW / Math.max(20, bounds.width), maxH / Math.max(20, bounds.height))));

    const cxLocal = (bounds.minX + bounds.maxX) * 0.5;
    const bx = PREV_W * 0.5 - cxLocal * scale;
    const by = PREV_H - padBot - bounds.maxY * scale + 6;

    rInst.container.scale.set(scale);
    rInst.container.position.set(bx, by);
    this.previewApp.stage.addChild(rInst.container);
  }

  private updatePreviewBackdrop(isWater: boolean, isRoof: boolean): void {
    if (!this.bgGroundSprite) return;
    const key = isWater
      ? 'assets/ui/ground_pool.webp'
      : isRoof
        ? 'assets/ui/ground_roof.webp'
        : 'assets/ui/ground_day.webp';
    const t = assets.getCachedTexture(key);
    if (t) this.bgGroundSprite.texture = t;
  }

  private async renderDetail(): Promise<void> {
    const tok = ++this.clipToken;
    const clipBar = this.uiRoot.querySelector('#alm-clip-bar')!;
    const titleEl = this.uiRoot.querySelector('#alm-card-title')!;
    const infoEl = this.uiRoot.querySelector('#alm-info-scroll')!;

    this.curRig?.destroy();
    this.curRig = null;
    this.curAnimator = null;

    if (this.view === 'plants') {
      const p = assets.getPlant(this.selectedPlantId) ?? assets.getPlant(0)!;
      const producedBy = fusionSystem.getRecipesProducing(p.id);
      const usesIn = fusionSystem.getRecipesUsing(p.id);

      this.updatePreviewBackdrop(p.layer === 'Lily' || p.tags.includes('WaterPlants'), p.layer === 'Pot');
      titleEl.innerHTML = `<span>${escHtml(p.name)}</span><small>#${p.id}</small>`;

      const parentHtml = producedBy.length
        ? `<div class="alm-sec"><h4>🔮 合成配方</h4><div class="alm-recipes">
            ${producedBy
              .slice(0, 5)
              .map((r) => {
                const pa = assets.getPlant(r.a);
                const pb = assets.getPlant(r.b);
                return `<div class="alm-formula">${this.chipBtn(pa)} <span>+</span> ${this.chipBtn(pb)} <span>→</span> <strong>${escHtml(p.name)}</strong></div>`;
              })
              .join('')}
          </div></div>`
        : '';

      const nextHtml = usesIn.length
        ? `<div class="alm-sec"><h4>✨ 可参与融合 (${usesIn.length} 种)</h4><div class="alm-recipes">
            ${usesIn
              .slice(0, 12)
              .map((r) => {
                const other = r.a === p.id ? assets.getPlant(r.b) : assets.getPlant(r.a);
                const res = assets.getPlant(r.result);
                if (!other || !res) return '';
                return `<div class="alm-formula"><span>+</span> ${this.chipBtn(other)} <span>→</span> ${this.chipBtn(res)}</div>`;
              })
              .join('')}
          </div></div>`
        : '';

      const unlocked = saveManager.isPlantUnlocked(p.id);
      const unlockTagHtml = unlocked
        ? '<div class="alm-unlock-tag unlocked">✓ 已解锁 · 可在选卡/实战中使用</div>'
        : `<div class="alm-unlock-tag locked">🔒 解锁条件：${escHtml(getPlantUnlockHint(p.id))}</div>`;

      infoEl.innerHTML = `
        <div class="alm-subline">${escHtml(p.en)} · ${escHtml(p.scriptClass || 'Plant')}</div>
        ${unlockTagHtml}
        <div class="alm-mini-stats">
          <span>☀️ ${p.cost}</span>
          <span>⏱ ${p.cd}s</span>
          <span>❤️ ${p.hp}</span>
          <span>⚔️ ${p.dmg}</span>
          ${p.atkIv > 0 ? `<span>🔥 ${p.atkIv}s</span>` : ''}
          ${p.prodIv > 0 ? `<span>🌻 ${p.prodIv}s</span>` : ''}
        </div>
        ${p.info ? `<div class="alm-parchment-lore">${escHtml(p.info).replace(/\n/g, '<br/>')}</div>` : ''}
        ${p.intro ? `<div class="alm-parchment-lore italic">${escHtml(p.intro).replace(/\n/g, '<br/>')}</div>` : ''}
        ${parentHtml}
        ${nextHtml}
      `;

      infoEl.querySelectorAll<HTMLButtonElement>('[data-jump-plant]').forEach((btn) => {
        btn.addEventListener('click', () => {
          this.selectedPlantId = Number(btn.dataset.jumpPlant);
          audio.playSfx('SelectCard', 0.75, 40);
          this.renderGrid();
          void this.renderDetail();
        });
      });

      const rigData = await assets.loadPlantRig(p.id);
      if (this.destroyed || tok !== this.clipToken || !this.previewApp || !rigData) {
        clipBar.innerHTML = '';
        return;
      }

      const rInst = new UnityRigInstance(rigData);
      const initClip = rigData.data.clips.idle ? 'idle' : Object.keys(rigData.data.clips)[0];
      const anim = new UnityAnimator(rInst, initClip);
      for (const hClip of ['head1', 'head2', 'head3']) {
        if (anim.hasClip(hClip) && anim.clips[hClip]?.additive) {
          anim.addAdditiveLoop(hClip, 0);
        }
      }
      this.mountPreviewRig(rInst, anim, true);
      this.curRig = rInst;
      this.curAnimator = anim;
      this.renderClipButtons(clipBar, Object.keys(rigData.data.clips), anim, true);
    } else {
      const z = assets.getZombie(this.selectedZombieId) ?? assets.getZombie(0)!;
      this.updatePreviewBackdrop(z.tags.includes('WaterZombie'), false);
      titleEl.innerHTML = `<span>${escHtml(z.name)}</span><small>#${z.id}</small>`;

      infoEl.innerHTML = `
        <div class="alm-subline">${escHtml(z.en)} · ${escHtml(z.scriptClass)} · T${z.tier}</div>
        <div class="alm-mini-stats">
          <span>❤️ ${z.hp}</span>
          ${z.a1 > 0 ? `<span>🪖 ${z.a1}</span>` : ''}
          ${z.a2 > 0 ? `<span>🛡 ${z.a2}</span>` : ''}
          <span>🦷 ${z.atk}</span>
          <span>⚖️ ${z.val}</span>
        </div>
        ${z.info ? `<div class="alm-parchment-lore">${escHtml(z.info).replace(/\n/g, '<br/>')}</div>` : ''}
        ${z.intro ? `<div class="alm-parchment-lore italic">${escHtml(z.intro).replace(/\n/g, '<br/>')}</div>` : ''}
      `;

      const rigData = await assets.loadZombieRig(z.id);
      if (this.destroyed || tok !== this.clipToken || !this.previewApp || !rigData) {
        clipBar.innerHTML = '';
        return;
      }

      const rInst = new UnityRigInstance(rigData);
      const defClip = rigData.data.clips.walk
        ? 'walk'
        : rigData.data.clips.fly
          ? 'fly'
          : rigData.data.clips.idle
            ? 'idle'
            : Object.keys(rigData.data.clips)[0];
      const anim = new UnityAnimator(rInst, defClip);
      this.mountPreviewRig(rInst, anim, false);
      this.curRig = rInst;
      this.curAnimator = anim;
      this.renderClipButtons(clipBar, Object.keys(rigData.data.clips), anim, false);
    }
  }

  private renderClipButtons(
    host: Element,
    clipNames: string[],
    anim: UnityAnimator,
    isPlant: boolean,
  ): void {
    const shown = clipNames.slice(0, 5);
    host.innerHTML = shown
      .map(
        (cn) =>
          `<button class="alm-clip-pill ${anim.baseClip?.name.toLowerCase() === cn ? 'active' : ''}" data-clip="${cn}">${cn}</button>`,
      )
      .join('');

    host.querySelectorAll<HTMLButtonElement>('[data-clip]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cn = btn.dataset.clip!;
        if (isPlant && cn !== 'idle' && anim.hasClip('idle')) {
          anim.playBase('idle', true);
          anim.playOverlay(cn, 1);
        } else if (cn === 'die' || cn === 'death') {
          anim.playBase(cn, false, 0, true);
        } else {
          anim.clearOverlay();
          anim.playBase(cn, true, 0, true);
        }
        host.querySelectorAll('.alm-clip-pill.active').forEach((x) => x.classList.remove('active'));
        btn.classList.add('active');
      });
    });
  }

  private chipBtn(p?: PlantDef): string {
    if (!p) return '';
    return `<button class="alm-jump-chip" data-jump-plant="${p.id}">
      ${p.portrait ? `<img src="assets/portraits/plants/${p.portrait}" alt="" />` : ''}
      <span>${escHtml(p.name)}</span>
    </button>`;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.destroyPreview();
    this.uiRoot.innerHTML = '';
  }
}
