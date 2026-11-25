import { Application, Container, Graphics, Sprite } from 'pixi.js';
import { assets } from '../assets/AssetLoader';
import { audio } from '../audio/AudioManager';
import { VIEW_H, VIEW_W } from '../engine/BoardEngine';
import { UnityAnimator } from '../render/UnityAnimator';
import { UnityRigInstance } from '../render/UnityRigInstance';
import { saveManager } from '../save/SaveManager';
import type { GardenNeed, GardenPlantSlot, GardenSaveState } from '../types/game';
import { escHtml } from './levelsCatalog';

export interface ZenGardenDeps {
  onBack: () => void;
}

type GardenTool = 'water' | 'fertilizer' | 'bugspray' | 'music' | 'glove' | 'sell';

const SLOT_COORDS: { x: number; y: number }[] = [
  { x: 210, y: 318 },
  { x: 428, y: 318 },
  { x: 646, y: 318 },
  { x: 864, y: 318 },
  { x: 210, y: 516 },
  { x: 428, y: 516 },
  { x: 646, y: 516 },
  { x: 864, y: 516 },
];

const SCENE_ORDER: GardenSaveState['scene'][] = ['day', 'morning', 'night', 'mushroom'];
const SCENE_META: Record<GardenSaveState['scene'], { label: string; tex: string }> = {
  day: { label: '阳光温室', tex: 'assets/ui/modes/garden_new.webp' },
  morning: { label: '晨曦花园', tex: 'assets/ui/modes/garden_morning.webp' },
  night: { label: '星夜暖棚', tex: 'assets/ui/modes/garden_night.webp' },
  mushroom: { label: '蘑菇园', tex: 'assets/ui/modes/garden_mushroom.webp' },
};

const STAGE_LABELS = ['幼苗', '成长', '含苞', '盛开'];
const STAGE_SCALES = [0.36, 0.48, 0.58, 0.68];

const NEED_BADGES: Record<GardenNeed, { emoji: string; label: string }> = {
  water: { emoji: '💧', label: '需要浇水' },
  fertilizer: { emoji: '🌿', label: '需要施肥' },
  bugspray: { emoji: '🪲', label: '需要除虫' },
  music: { emoji: '🎵', label: '渴望音乐' },
  happy: { emoji: '✨', label: '心情愉悦' },
};

const NORMAL_GARDEN_POOL = [0, 1, 2, 3, 5, 6, 7, 8, 9, 13, 14, 18, 23, 26, 28, 32, 1000, 1004, 1005];
const RARE_GARDEN_POOL = [901, 903, 904, 909, 911, 913, 914, 924, 927, 934, 300, 304];

interface RenderedPlantRig {
  uid: number;
  plantId: number;
  stage: number;
  goldPot: boolean;
  container: Container;
  rig: UnityRigInstance | null;
  animator: UnityAnimator | null;
}

interface DroppedCoin {
  id: number;
  kind: 'silver' | 'gold' | 'diamond';
  value: number;
  x: number;
  y: number;
}

/**
 * Interactive PvZ Fusion Zen Garden (`GardenUI`) with 4 greenhouse scenes, 8 potted live-rig
 * slots, Watering Can / Gold Watering Can / Fertilizer / Bug Spray / Phonograph / Glove / Sell
 * tools, clickable coin/diamond drops, and Crazy Dave's Garden Shop.
 */
export class ZenGarden {
  private readonly pixiHost: HTMLElement;
  private readonly uiRoot: HTMLElement;
  private readonly deps: ZenGardenDeps;

  private app: Application | null = null;
  private bgSprite: Sprite | null = null;
  private slotLayer = new Container();
  private renderedMap = new Map<number, RenderedPlantRig>();

  private activeTool: GardenTool = 'water';
  private gloveSourceUid: number | null = null;
  private toastMsg = '';
  private toastTimer = 0;
  private shopOpen = false;
  private droppedCoins: DroppedCoin[] = [];
  private nextDropId = 1;
  private dropAccum = 0;
  private animElapsed = 0;
  private destroyed = false;

  constructor(pixiHost: HTMLElement, uiRoot: HTMLElement, deps: ZenGardenDeps) {
    this.pixiHost = pixiHost;
    this.uiRoot = uiRoot;
    this.deps = deps;
  }

  async mount(): Promise<void> {
    void audio.playBgm('Garden');
    this.renderDom();

    const app = new Application();
    await app.init({
      width: VIEW_W,
      height: VIEW_H,
      backgroundColor: 0x0f172a,
      antialias: true,
      preference: 'webgl',
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
    });

    if (this.destroyed) {
      app.destroy({ removeView: true }, { children: true, texture: false, textureSource: false });
      return;
    }

    this.app = app;
    app.canvas.style.width = '100%';
    app.canvas.style.height = '100%';
    app.canvas.style.display = 'block';
    this.pixiHost.appendChild(app.canvas);

    await Promise.allSettled([
      assets.loadTexture('assets/ui/modes/garden_new.webp'),
      assets.loadTexture('assets/ui/modes/garden_morning.webp'),
      assets.loadTexture('assets/ui/modes/garden_night.webp'),
      assets.loadTexture('assets/ui/modes/garden_mushroom.webp'),
      assets.loadTexture('assets/ui/modes/gold_pot.webp'),
      assets.loadTexture('assets/ui/modes/silver_pot.webp'),
    ]);
    if (this.destroyed) return;

    const bg = new Sprite(assets.getCachedTexture(SCENE_META[saveManager.current.garden.scene].tex));
    bg.width = VIEW_W;
    bg.height = VIEW_H;
    this.bgSprite = bg;

    app.stage.addChild(bg, this.slotLayer);
    await this.syncPixiPlants();
    this.seedInitialCoinIfHappy();
    this.renderDom();

    app.ticker.add((ticker) => {
      const dt = Math.min(0.05, ticker.deltaMS / 1000);
      this.tick(dt);
    });
  }

  private tick(dt: number): void {
    this.animElapsed += dt;
    for (const item of this.renderedMap.values()) {
      item.animator?.update(dt);
      const bob = Math.sin(this.animElapsed * 2.1 + item.uid) * (item.stage >= 3 ? 2.2 : 1.0);
      if (item.rig) {
        item.rig.container.y = -32 + bob;
      }
    }

    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) {
        this.toastMsg = '';
        const el = this.uiRoot.querySelector('#zg-toast');
        if (el) el.textContent = '';
      }
    }

    this.dropAccum += dt;
    if (this.dropAccum >= 4.0) {
      this.dropAccum = 0;
      const now = Date.now();
      const g = saveManager.current.garden;
      let dropped = false;
      for (const pl of g.plants) {
        if (this.droppedCoins.length >= 10) break;
        const alreadyOnSlot = this.droppedCoins.some(
          (c) => Math.abs(c.x - (SLOT_COORDS[pl.slot].x + 36)) < 25 && Math.abs(c.y - (SLOT_COORDS[pl.slot].y - 14)) < 25,
        );
        if (alreadyOnSlot) continue;
        if (pl.need === 'happy' || pl.stage >= 2) {
          if (now - pl.lastCoinAt >= 6500) {
            pl.lastCoinAt = now;
            this.spawnCoinAtSlot(pl.slot, pl.stage === 3 ? (pl.goldPot ? 'diamond' : 'gold') : 'silver');
            dropped = true;
          }
        }
      }
      if (dropped) {
        saveManager.setGarden(g);
        this.renderCoinsDom();
      }
    }
  }

  private seedInitialCoinIfHappy(): void {
    const g = saveManager.current.garden;
    if (g.plants.length > 0 && this.droppedCoins.length === 0) {
      const p0 = g.plants[Math.min(1, g.plants.length - 1)];
      this.spawnCoinAtSlot(p0.slot, p0.stage >= 2 ? 'gold' : 'silver');
    }
  }

  private spawnCoinAtSlot(slotIdx: number, kind: DroppedCoin['kind']): void {
    const pos = SLOT_COORDS[slotIdx];
    if (!pos) return;
    const value = kind === 'diamond' ? 150 : kind === 'gold' ? 50 : 25;
    this.droppedCoins.push({
      id: this.nextDropId++,
      kind,
      value,
      x: pos.x + 36,
      y: pos.y - 14,
    });
  }

  private async syncPixiPlants(): Promise<void> {
    if (!this.app || this.destroyed) return;
    const g = saveManager.current.garden;

    if (this.bgSprite) {
      const tex = assets.getCachedTexture(SCENE_META[g.scene].tex);
      if (tex) this.bgSprite.texture = tex;
    }

    const activeUids = new Set(g.plants.map((p) => p.uid));
    for (const [uid, rec] of this.renderedMap.entries()) {
      const latest = g.plants.find((p) => p.uid === uid);
      if (!latest || latest.plantId !== rec.plantId || latest.stage !== rec.stage || Boolean(latest.goldPot) !== rec.goldPot) {
        rec.rig?.destroy();
        rec.container.destroy({ children: true });
        this.renderedMap.delete(uid);
      }
    }

    for (const pl of g.plants) {
      const pos = SLOT_COORDS[pl.slot];
      if (!pos) continue;
      let rec = this.renderedMap.get(pl.uid);
      if (rec) {
        rec.container.position.set(pos.x, pos.y);
        continue;
      }

      const container = new Container();
      container.position.set(pos.x, pos.y);

      const shadow = new Graphics();
      shadow.ellipse(0, 6, 38, 12).fill({ color: 0x000000, alpha: 0.35 });
      container.addChild(shadow);

      const potTex = assets.getCachedTexture(
        pl.goldPot ? 'assets/ui/modes/gold_pot.webp' : 'assets/ui/modes/silver_pot.webp',
      );
      if (potTex) {
        const potSp = new Sprite(potTex);
        potSp.anchor.set(0.5, 0.88);
        potSp.width = 86;
        potSp.height = 89;
        container.addChild(potSp);
      }

      this.slotLayer.addChild(container);
      rec = {
        uid: pl.uid,
        plantId: pl.plantId,
        stage: pl.stage,
        goldPot: Boolean(pl.goldPot),
        container,
        rig: null,
        animator: null,
      };
      this.renderedMap.set(pl.uid, rec);

      const rigData = await assets.loadPlantRig(pl.plantId);
      if (this.destroyed || this.renderedMap.get(pl.uid) !== rec || !activeUids.has(pl.uid)) {
        continue;
      }
      if (rigData) {
        const rig = new UnityRigInstance(rigData);
        const sc = STAGE_SCALES[pl.stage] ?? 0.48;
        rig.container.scale.set(sc);
        rig.container.position.set(0, -32);
        container.addChild(rig.container);
        rec.rig = rig;
        rec.animator = new UnityAnimator(rig, 'idle');
      }
    }
  }

  private showToast(msg: string): void {
    this.toastMsg = msg;
    this.toastTimer = 2.6;
    const el = this.uiRoot.querySelector('#zg-toast');
    if (el) el.textContent = msg;
  }

  private renderDom(): void {
    const prof = saveManager.current;
    const g = prof.garden;
    const bySlot = new Map<number, GardenPlantSlot>();
    for (const pl of g.plants) bySlot.set(pl.slot, pl);

    const waterIcon = g.goldWateringCan
      ? 'assets/ui/modes/watering_can_gold.webp'
      : 'assets/ui/modes/watering_can.webp';

    const slotsHtml = SLOT_COORDS.map((pos, slotIdx) => {
      const pl = bySlot.get(slotIdx);
      if (!pl) {
        const canDrop = this.activeTool === 'glove' && this.gloveSourceUid !== null;
        return `
          <button
            class="zg-slot-btn empty ${canDrop ? 'glove-target' : ''}"
            style="left:${pos.x}px;top:${pos.y}px"
            data-zg-slot="${slotIdx}"
            title="${canDrop ? '点击将植物移入此花盆位' : '空花位（前往戴夫商店购买新植物）'}"
          >
            <span class="zg-empty-ring">${canDrop ? '📥 移入' : `空位 ${slotIdx + 1}`}</span>
          </button>
        `;
      }
      const pDef = assets.getPlant(pl.plantId);
      const nb = NEED_BADGES[pl.need];
      const moving = this.gloveSourceUid === pl.uid;
      return `
        <button
          class="zg-slot-btn occupied ${moving ? 'moving' : ''}"
          style="left:${pos.x}px;top:${pos.y}px"
          data-zg-slot="${slotIdx}"
          title="${escHtml(pDef?.name ?? '')} · ${STAGE_LABELS[pl.stage]} · ${nb.label}"
        >
          <span class="zg-need-bubble ${pl.need === 'happy' ? 'happy' : ''}">${nb.emoji} ${nb.label}</span>
          <span class="zg-plant-tag">${escHtml(pDef?.name ?? '')} · ${STAGE_LABELS[pl.stage]}</span>
        </button>
      `;
    }).join('');

    this.uiRoot.innerHTML = `
      <div class="zg-overlay">
        <div class="zg-topbar">
          <div class="zg-tools-bar">
            <button class="zg-tool-btn ${this.activeTool === 'water' ? 'active' : ''}" data-zg-tool="water" title="${g.goldWateringCan ? '黄金水壶（一次浇灌全部缺水植物）' : '水壶（浇水）'}">
              <img src="${waterIcon}" alt="水壶" />
              <span>${g.goldWateringCan ? '金水壶' : '浇水'}</span>
            </button>
            <button class="zg-tool-btn ${this.activeTool === 'fertilizer' ? 'active' : ''}" data-zg-tool="fertilizer" title="高级肥料（促进成长，点击商店可补充）">
              <img src="assets/ui/adv/Fertilizer.webp" alt="肥料" />
              <span>肥料×${g.fertilizerCount}</span>
            </button>
            <button class="zg-tool-btn ${this.activeTool === 'bugspray' ? 'active' : ''}" data-zg-tool="bugspray" title="杀虫剂（消灭害虫让植物愉悦）">
              <img src="assets/ui/modes/bug_spray.webp" alt="杀虫" />
              <span>杀虫×${g.bugSprayCount}</span>
            </button>
            <button class="zg-tool-btn ${this.activeTool === 'music' ? 'active' : ''} ${g.phonographOwned ? '' : 'dim'}" data-zg-tool="music" title="${g.phonographOwned ? '唱片机（播放音乐使植物掉落钻石）' : '唱片机（需先在戴夫商店购买）'}">
              <img src="assets/ui/modes/phonograph.webp" alt="唱片机" />
              <span>${g.phonographOwned ? '唱片机' : '未购买'}</span>
            </button>
            <button class="zg-tool-btn ${this.activeTool === 'glove' ? 'active' : ''}" data-zg-tool="glove" title="园艺手套（移动/交换盆栽位置）">
              <img src="assets/ui/modes/zen_glove.webp" alt="手套" />
              <span>移动</span>
            </button>
            <button class="zg-tool-btn ${this.activeTool === 'sell' ? 'active' : ''}" data-zg-tool="sell" title="出售植物换取金币（盛开金盆售价极高）">
              <img src="assets/ui/modes/zen_money_sign.webp" alt="出售" />
              <span>出售</span>
            </button>
          </div>

          <div class="zg-right-bar">
            <div class="zg-coin-pill">
              <img class="zg-coinbank-bg" src="assets/ui/modes/coinbank.webp" alt="" />
              <img class="zg-coin-ico" src="assets/ui/modes/coin_gold.webp" alt="" />
              <span id="zg-coin-val">${prof.coins}</span>
            </div>
            <button class="zg-action-pill gold" id="zg-open-shop">🛒 戴夫商店</button>
            <button class="zg-scene-btn" id="zg-next-scene" title="切换花园场景（当前：${SCENE_META[g.scene].label}）">
              <img src="assets/ui/modes/zen_next_garden.webp" alt="" />
              <span>${SCENE_META[g.scene].label}</span>
            </button>
            <button class="pvz-stone-btn sm" id="zg-back">
              <img src="assets/ui/buttonsmall.webp" alt="" />
              <span>返回</span>
            </button>
          </div>
        </div>

        <div class="zg-toast" id="zg-toast">${escHtml(this.toastMsg)}</div>
        <div class="zg-slots-layer">${slotsHtml}</div>
        <div class="zg-coins-layer" id="zg-coins-layer"></div>
        ${this.shopOpen ? this.renderShopModalHtml(prof.coins, g) : ''}
      </div>
    `;

    this.renderCoinsDom();
    this.bindEvents();
  }

  private renderCoinsDom(): void {
    const layer = this.uiRoot.querySelector('#zg-coins-layer');
    if (!layer) return;
    layer.innerHTML = this.droppedCoins
      .map((c) => {
        const icon =
          c.kind === 'diamond'
            ? 'assets/ui/modes/diamond.webp'
            : c.kind === 'gold'
              ? 'assets/ui/modes/coin_gold.webp'
              : 'assets/ui/modes/coin_silver.webp';
        return `
          <button class="zg-coin-drop ${c.kind}" style="left:${c.x}px;top:${c.y}px" data-zg-coin="${c.id}" title="点击拾取 +${c.value} 金币">
            <img src="${icon}" alt="" />
            <span>+${c.value}</span>
          </button>
        `;
      })
      .join('');

    layer.querySelectorAll<HTMLButtonElement>('[data-zg-coin]').forEach((b) => {
      b.addEventListener('click', () => {
        const id = Number(b.dataset.zgCoin);
        const idx = this.droppedCoins.findIndex((c) => c.id === id);
        if (idx < 0) return;
        const coin = this.droppedCoins[idx];
        this.droppedCoins.splice(idx, 1);
        saveManager.addCoins(coin.value);
        audio.playSfx(coin.kind === 'diamond' ? 'Diamond' : 'Coin', 0.85, 30);
        const coinValEl = this.uiRoot.querySelector('#zg-coin-val');
        if (coinValEl) coinValEl.textContent = String(saveManager.current.coins);
        this.showToast(`拾取 +${coin.value} 金币！`);
        this.renderCoinsDom();
      });
    });
  }

  private renderShopModalHtml(coins: number, g: GardenSaveState): string {
    return `
      <div class="pvz-modal-backdrop" id="zg-shop-backdrop">
        <div class="zg-shop-dialog">
          <div class="zg-shop-left">
            <img class="zg-shop-dave" src="assets/ui/modes/garden_store.webp" alt="戴夫商店" />
            <div class="zg-shop-coins">当前金币：<strong>${coins}</strong></div>
          </div>
          <div class="zg-shop-right">
            <div class="zg-shop-hdr">
              <span>🏡 疯狂戴夫的后花园杂货铺</span>
              <button class="btn-wood-sm" id="zg-shop-close">离开商店</button>
            </div>
            <div class="zg-shop-grid">
              <button class="zg-shop-item" data-zg-buy="sprout">
                <img src="assets/portraits/plants/p_0.webp" alt="" />
                <div><strong>随机植物盆栽</strong><span>随机获得常规或经典融合幼苗（共 8 盆位）</span></div>
                <em>300 金币</em>
              </button>
              <button class="zg-shop-item" data-zg-buy="rare_sprout">
                <img src="assets/portraits/plants/p_901.webp" alt="" />
                <div><strong>究极珍稀盆栽盲盒</strong><span>必得金盆盛放的强力究极植物</span></div>
                <em>800 金币</em>
              </button>
              <button class="zg-shop-item" data-zg-buy="fert5">
                <img src="assets/ui/adv/Fertilizer.webp" alt="" />
                <div><strong>高级肥料 ×5</strong><span>促使盆栽成长进入下一阶段</span></div>
                <em>150 金币</em>
              </button>
              <button class="zg-shop-item" data-zg-buy="spray5">
                <img src="assets/ui/modes/bug_spray.webp" alt="" />
                <div><strong>高级杀虫剂 ×5</strong><span>驱除害虫保持植株健康</span></div>
                <em>150 金币</em>
              </button>
              <button class="zg-shop-item ${g.goldWateringCan ? 'owned' : ''}" data-zg-buy="gold_can" ${g.goldWateringCan ? 'disabled' : ''}>
                <img src="assets/ui/modes/watering_can_gold.webp" alt="" />
                <div><strong>黄金水壶</strong><span>一键同时浇灌全部缺水植物</span></div>
                <em>${g.goldWateringCan ? '已拥有' : '1000 金币'}</em>
              </button>
              <button class="zg-shop-item ${g.phonographOwned ? 'owned' : ''}" data-zg-buy="phono" ${g.phonographOwned ? 'disabled' : ''}>
                <img src="assets/ui/modes/phonograph.webp" alt="" />
                <div><strong>黄金留声机</strong><span>播放音乐让盛开植物掉落钻石</span></div>
                <em>${g.phonographOwned ? '已拥有' : '600 金币'}</em>
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private bindEvents(): void {
    this.uiRoot.querySelector('#zg-back')?.addEventListener('click', () => {
      audio.playSfx('ButtonClick', 0.8, 40);
      this.deps.onBack();
    });

    this.uiRoot.querySelector('#zg-next-scene')?.addEventListener('click', () => {
      const cur = saveManager.current.garden;
      const idx = SCENE_ORDER.indexOf(cur.scene);
      const next = SCENE_ORDER[(idx + 1) % SCENE_ORDER.length];
      saveManager.updateGarden({ scene: next });
      audio.playSfx('Tap', 0.75, 40);
      void this.syncPixiPlants();
      this.renderDom();
    });

    this.uiRoot.querySelector('#zg-open-shop')?.addEventListener('click', () => {
      this.shopOpen = true;
      audio.playSfx('ButtonClick', 0.8, 40);
      this.renderDom();
    });

    this.uiRoot.querySelector('#zg-shop-close')?.addEventListener('click', () => {
      this.shopOpen = false;
      this.renderDom();
    });

    this.uiRoot.querySelectorAll<HTMLButtonElement>('[data-zg-tool]').forEach((b) => {
      b.addEventListener('click', () => {
        this.activeTool = b.dataset.zgTool as GardenTool;
        if (this.activeTool !== 'glove') this.gloveSourceUid = null;
        audio.playSfx('SeedLift', 0.75, 40);
        this.renderDom();
      });
    });

    this.uiRoot.querySelectorAll<HTMLButtonElement>('[data-zg-slot]').forEach((b) => {
      b.addEventListener('click', () => {
        void this.handleSlotClick(Number(b.dataset.zgSlot));
      });
    });

    this.uiRoot.querySelectorAll<HTMLButtonElement>('[data-zg-buy]').forEach((b) => {
      b.addEventListener('click', () => {
        void this.handleBuyItem(b.dataset.zgBuy!);
      });
    });
  }

  private async handleSlotClick(slotIdx: number): Promise<void> {
    const g = structuredClone(saveManager.current.garden) as GardenSaveState;
    const plIdx = g.plants.findIndex((p) => p.slot === slotIdx);

    if (this.activeTool === 'glove') {
      if (this.gloveSourceUid === null) {
        if (plIdx < 0) {
          audio.playSfx('Buzzer', 0.6, 120);
          return;
        }
        this.gloveSourceUid = g.plants[plIdx].uid;
        audio.playSfx('SeedLift', 0.8, 40);
        this.showToast('已拿起植物，请点击目标花盆位置');
        this.renderDom();
        return;
      }
      const src = g.plants.find((p) => p.uid === this.gloveSourceUid);
      if (!src) {
        this.gloveSourceUid = null;
        this.renderDom();
        return;
      }
      const prevSlot = src.slot;
      if (plIdx >= 0) {
        g.plants[plIdx].slot = prevSlot;
      }
      src.slot = slotIdx;
      this.gloveSourceUid = null;
      saveManager.setGarden(g);
      audio.playSfx('Plant', 0.85, 40);
      await this.syncPixiPlants();
      this.renderDom();
      return;
    }

    if (plIdx < 0) {
      audio.playSfx('Buzzer', 0.55, 120);
      this.showToast('空花盆：可点击右上角「戴夫商店」购买新植物！');
      return;
    }

    const pl = g.plants[plIdx];
    const pName = assets.getPlant(pl.plantId)?.name ?? '植物';

    if (this.activeTool === 'water') {
      const targets = g.goldWateringCan ? g.plants : [pl];
      let watered = 0;
      for (const item of targets) {
        if (item.need === 'water' || targets.length === 1) {
          item.need = item.stage < 3 ? 'fertilizer' : 'bugspray';
          item.happyUntil = Date.now() + 18000;
          this.spawnCoinAtSlot(item.slot, item.stage >= 2 ? 'gold' : 'silver');
          watered++;
        }
      }
      saveManager.setGarden(g);
      audio.playSfx('Watering', 0.9, 60);
      this.showToast(
        g.goldWateringCan ? `黄金水壶已浇灌 ${watered} 株植物！` : `已给「${pName}」浇水，记得及时施肥哦！`,
      );
      this.renderDom();
      return;
    }

    if (this.activeTool === 'fertilizer') {
      if (g.fertilizerCount <= 0) {
        audio.playSfx('Buzzer', 0.7, 120);
        this.showToast('肥料已用完！请前往「戴夫商店」补充。');
        return;
      }
      g.fertilizerCount -= 1;
      if (pl.stage < 3) {
        pl.stage = (pl.stage + 1) as 0 | 1 | 2 | 3;
      }
      pl.need = pl.stage === 3 ? (g.phonographOwned ? 'music' : 'happy') : 'bugspray';
      pl.happyUntil = Date.now() + 25000;
      this.spawnCoinAtSlot(pl.slot, pl.stage === 3 ? 'diamond' : 'gold');
      saveManager.setGarden(g);
      audio.playSfx(['Fertilizer', 'PlantGrow'], 0.9, 60);
      this.showToast(`「${pName}」成长为【${STAGE_LABELS[pl.stage]}】阶段！`);
      await this.syncPixiPlants();
      this.renderDom();
      return;
    }

    if (this.activeTool === 'bugspray') {
      if (g.bugSprayCount <= 0) {
        audio.playSfx('Buzzer', 0.7, 120);
        this.showToast('杀虫剂已用完！请前往「戴夫商店」补充。');
        return;
      }
      g.bugSprayCount -= 1;
      pl.need = 'happy';
      pl.happyUntil = Date.now() + 30000;
      this.spawnCoinAtSlot(pl.slot, 'gold');
      saveManager.setGarden(g);
      audio.playSfx('BugSpray', 0.9, 60);
      this.showToast(`已为「${pName}」驱虫，植物进入开心产币状态！`);
      this.renderDom();
      return;
    }

    if (this.activeTool === 'music') {
      if (!g.phonographOwned) {
        audio.playSfx('Buzzer', 0.7, 120);
        this.showToast('尚未拥有留声机！可在「戴夫商店」花费 600 金币购买。');
        return;
      }
      pl.need = 'happy';
      pl.happyUntil = Date.now() + 35000;
      this.spawnCoinAtSlot(pl.slot, 'diamond');
      saveManager.setGarden(g);
      audio.playSfx('Chime', 0.9, 60);
      this.showToast(`「${pName}」陶醉在音乐中，掉落了闪烁钻石！`);
      this.renderDom();
      return;
    }

    if (this.activeTool === 'sell') {
      const price = 150 + pl.stage * 220 + (pl.goldPot ? 350 : 0);
      g.plants.splice(plIdx, 1);
      saveManager.setGarden(g);
      saveManager.addCoins(price);
      audio.playSfx('Coin', 0.9, 60);
      this.showToast(`成功出售「${pName}」，获得 +${price} 金币！`);
      await this.syncPixiPlants();
      this.renderDom();
    }
  }

  private async handleBuyItem(itemKey: string): Promise<void> {
    const prof = saveManager.current;
    const g = structuredClone(prof.garden) as GardenSaveState;
    const findFreeSlot = () => {
      const used = new Set(g.plants.map((p) => p.slot));
      for (let i = 0; i < SLOT_COORDS.length; i++) {
        if (!used.has(i)) return i;
      }
      return -1;
    };

    if (itemKey === 'sprout' || itemKey === 'rare_sprout') {
      const isRare = itemKey === 'rare_sprout';
      const cost = isRare ? 800 : 300;
      const freeSlot = findFreeSlot();
      if (freeSlot < 0) {
        audio.playSfx('Buzzer', 0.7, 120);
        this.showToast('温室 8 个盆位已满，请先出售一株植物！');
        return;
      }
      if (prof.coins < cost) {
        audio.playSfx('Buzzer', 0.7, 120);
        this.showToast(`金币不足（需要 ${cost} 金币）`);
        return;
      }
      const candidates = (isRare ? RARE_GARDEN_POOL : NORMAL_GARDEN_POOL).filter((id) =>
        Boolean(assets.getPlant(id)?.hasRig),
      );
      const pid = candidates[Math.floor(Math.random() * candidates.length)] ?? 0;
      const uid = g.nextUid++;
      g.plants.push({
        uid,
        slot: freeSlot,
        plantId: pid,
        stage: isRare ? 1 : 0,
        need: 'water',
        happyUntil: 0,
        lastCoinAt: Date.now(),
        goldPot: isRare,
      });
      saveManager.addCoins(-cost);
      saveManager.setGarden(g);
      audio.playSfx(isRare ? 'Diamond' : 'Prize', 0.9, 60);
      this.shopOpen = false;
      this.showToast(`购入新盆栽「${assets.getPlant(pid)?.name ?? ''}」！记得浇水呵护！`);
      await this.syncPixiPlants();
      this.renderDom();
      return;
    }

    if (itemKey === 'fert5') {
      if (prof.coins < 150) {
        audio.playSfx('Buzzer', 0.7, 120);
        return;
      }
      saveManager.addCoins(-150);
      g.fertilizerCount += 5;
      saveManager.setGarden(g);
      audio.playSfx('Prize', 0.85, 50);
      this.showToast('购入高级肥料 ×5！');
      this.renderDom();
      return;
    }

    if (itemKey === 'spray5') {
      if (prof.coins < 150) {
        audio.playSfx('Buzzer', 0.7, 120);
        return;
      }
      saveManager.addCoins(-150);
      g.bugSprayCount += 5;
      saveManager.setGarden(g);
      audio.playSfx('Prize', 0.85, 50);
      this.showToast('购入高级杀虫剂 ×5！');
      this.renderDom();
      return;
    }

    if (itemKey === 'gold_can') {
      if (prof.coins < 1000 || g.goldWateringCan) {
        audio.playSfx('Buzzer', 0.7, 120);
        return;
      }
      saveManager.addCoins(-1000);
      g.goldWateringCan = true;
      saveManager.setGarden(g);
      audio.playSfx('Diamond', 0.9, 60);
      this.showToast('解锁黄金水壶！可一键浇灌全部植物！');
      this.renderDom();
      return;
    }

    if (itemKey === 'phono') {
      if (prof.coins < 600 || g.phonographOwned) {
        audio.playSfx('Buzzer', 0.7, 120);
        return;
      }
      saveManager.addCoins(-600);
      g.phonographOwned = true;
      saveManager.setGarden(g);
      audio.playSfx('Diamond', 0.9, 60);
      this.showToast('解锁黄金留声机！');
      this.renderDom();
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const rec of this.renderedMap.values()) {
      rec.rig?.destroy();
    }
    this.renderedMap.clear();
    if (this.app) {
      this.app.destroy(
        { removeView: true },
        { children: true, texture: false, textureSource: false },
      );
      this.app = null;
    }
    this.pixiHost.innerHTML = '';
    this.uiRoot.innerHTML = '';
  }
}
