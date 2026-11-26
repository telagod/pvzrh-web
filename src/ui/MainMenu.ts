import { Application, Container, Sprite } from 'pixi.js';
import { assets, type AssetProgressCb } from '../assets/AssetLoader';
import { audio } from '../audio/AudioManager';
import { VIEW_H, VIEW_W } from '../engine/BoardEngine';
import {
  DIFFICULTY_LEVELS,
  clampDifficulty,
  formatDifficultyBadge,
  formatDifficultyFull,
  getDifficultyInfo,
} from '../save/difficulty';
import { saveManager } from '../save/SaveManager';
import type { ScreenId } from '../types/game';
import type { LevelTab } from './LevelSelect';

export interface MainMenuDeps {
  onNavigate: (screen: ScreenId, opts?: { tab?: LevelTab }) => void;
  onStartClassicAdventure: () => void;
  onStartSandbox: () => void;
}

/**
 * Authentic PvZ Fusion 4.1 Main Menu replicating Unity's `ui/prefabs/mainmenu` (1920x1080 scaled
 * 1:1 onto the 1066x600 stage): drifting clouds, bobbing Water + Endoflame sea pot, beach mound,
 * island Squalour, top-left WoodSign, recessed RecipeLevel copper tank behind GraveBackground,
 * gravestone mode plates with shadows & flowers, LowerButtons, corner stone pills, and 推荐关卡 sign.
 */
export class MainMenu {
  private readonly pixiHost: HTMLElement;
  private readonly uiRoot: HTMLElement;
  private readonly deps: MainMenuDeps;

  private app: Application | null = null;
  private clouds: Sprite[] = [];
  private waterSprite: Sprite | null = null;
  private waterBaseScaleX = 1;
  private waterBaseScaleY = 1;
  private endoflameSprite: Sprite | null = null;
  private squalourSprite: Sprite | null = null;
  private squalourBaseScaleX = 1;
  private squalourBaseScaleY = 1;
  private squalourJump = 0;
  private animElapsed = 0;
  private destroyed = false;

  private modalEl: HTMLElement | null = null;

  constructor(pixiHost: HTMLElement, uiRoot: HTMLElement, deps: MainMenuDeps) {
    this.pixiHost = pixiHost;
    this.uiRoot = uiRoot;
    this.deps = deps;
  }

  async mount(onProgress?: AssetProgressCb): Promise<void> {
    await assets.preloadMainMenuAssets((r, d, c) => onProgress?.(r * 0.85, d, c));
    if (this.destroyed) return;

    onProgress?.(0.9, '正在初始化主菜单画布...');
    const app = new Application();
    await app.init({
      width: VIEW_W,
      height: VIEW_H,
      backgroundColor: 0x38bdf8,
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
      assets.loadTexture('assets/ui/ocean.webp'),
      assets.loadTexture('assets/ui/cloud.webp'),
      assets.loadTexture('assets/ui/water.webp'),
      assets.loadTexture('assets/ui/endoflame.webp'),
      assets.loadTexture('assets/ui/beach.webp'),
      assets.loadTexture('assets/ui/plantshadow.webp'),
      assets.loadTexture('assets/ui/squalour.webp'),
    ]);
    if (this.destroyed) return;

    const scene = new Container();
    app.stage.addChild(scene);

    const oceanTex = assets.getCachedTexture('assets/ui/ocean.webp');
    if (oceanTex) {
      const sp = new Sprite(oceanTex);
      sp.position.set(-51.9, -2.4);
      sp.width = 1153.9;
      sp.height = 522.4;
      scene.addChild(sp);
    }

    const cloudTex = assets.getCachedTexture('assets/ui/cloud.webp');
    if (cloudTex) {
      for (const startX of [5.0, 1184.2]) {
        const cl = new Sprite(cloudTex);
        cl.position.set(startX, 27.4);
        cl.width = 1065.5;
        cl.height = 168.0;
        cl.alpha = 0.94;
        scene.addChild(cl);
        this.clouds.push(cl);
      }
    }

    const waterTex = assets.getCachedTexture('assets/ui/water.webp');
    if (waterTex) {
      const wa = new Sprite(waterTex);
      wa.anchor.set(0.5);
      wa.position.set(175.4, 279.5);
      wa.width = 235.9;
      wa.height = 111.4;
      this.waterBaseScaleX = wa.scale.x;
      this.waterBaseScaleY = wa.scale.y;
      scene.addChild(wa);
      this.waterSprite = wa;
    }

    const endoTex = assets.getCachedTexture('assets/ui/endoflame.webp');
    if (endoTex) {
      const en = new Sprite(endoTex);
      en.anchor.set(0.5);
      en.position.set(189.2, 280.1);
      en.width = 121.5;
      en.height = 121.5;
      scene.addChild(en);
      this.endoflameSprite = en;
    }

    const beachTex = assets.getCachedTexture('assets/ui/beach.webp');
    if (beachTex) {
      const be = new Sprite(beachTex);
      be.position.set(-51.9, 479.7);
      be.width = 1153.9;
      be.height = 148.0;
      scene.addChild(be);
    }

    const shadowTex = assets.getCachedTexture('assets/ui/plantshadow.webp');
    if (shadowTex) {
      const sh = new Sprite(shadowTex);
      sh.anchor.set(0.5);
      sh.position.set(1039.8, 219.6);
      sh.width = 43.9;
      sh.height = 38.6;
      sh.scale.x = -Math.abs(sh.scale.x);
      scene.addChild(sh);
    }

    const squalourTex = assets.getCachedTexture('assets/ui/squalour.webp');
    if (squalourTex) {
      const sq = new Sprite(squalourTex);
      sq.anchor.set(0.5);
      sq.position.set(1039.8, 211.5);
      sq.width = 43.9;
      sq.height = 38.6;
      sq.scale.x = -Math.abs(sq.scale.x);
      this.squalourBaseScaleX = Math.abs(sq.scale.x);
      this.squalourBaseScaleY = Math.abs(sq.scale.y);
      sq.eventMode = 'static';
      sq.cursor = 'pointer';
      sq.on('pointerdown', () => {
        audio.unlock();
        this.squalourJump = 0.42;
        audio.playSfx(['SquashHmm', 'SquashHmm2'], 0.85, 220);
      });
      scene.addChild(sq);
      this.squalourSprite = sq;
    }

    app.ticker.add((ticker) => {
      const dt = Math.min(0.05, ticker.deltaMS / 1000);
      this.animElapsed += dt;
      const phase = (this.animElapsed / 2.0) * Math.PI * 2;
      const t01 = 0.5 * (1 - Math.cos(phase));

      for (const cl of this.clouds) {
        cl.x -= 22 * dt;
        if (cl.x + 1065.5 < -20) {
          cl.x += 2358.4;
        }
      }
      if (this.waterSprite) {
        this.waterSprite.scale.x = this.waterBaseScaleX * (1 + 0.11 * t01);
        this.waterSprite.scale.y = this.waterBaseScaleY;
        this.waterSprite.y = 279.5 + 4.4 * t01;
      }
      if (this.endoflameSprite) {
        this.endoflameSprite.y = 280.1 + 6.8 * t01;
      }
      if (this.squalourSprite) {
        if (this.squalourJump > 0) {
          this.squalourJump = Math.max(0, this.squalourJump - dt);
        }
        const jumpLift = this.squalourJump > 0 ? Math.sin((this.squalourJump / 0.42) * Math.PI) * 14 : 0;
        this.squalourSprite.scale.x = -this.squalourBaseScaleX * (1 + 0.09 * t01);
        this.squalourSprite.scale.y = this.squalourBaseScaleY * (1 - 0.06 * t01);
        this.squalourSprite.y = 211.5 + 5.9 * t01 - jumpLift;
      }
    });

    this.renderDom();
    app.render();
    void audio.playBgm('MainMenu');
    onProgress?.(1, '主菜单已就绪');
  }

  private resolveClassicAdventureBadge(): { advLevel: number; bigLv: number; smallLv: number } {
    const advLevel = Math.max(1, Math.min(45, Math.floor(saveManager.current.advLevel || 1)));
    const bigLv = Math.floor((advLevel - 1) / 9) + 1;
    const smallLv = ((advLevel - 1) % 9) + 1;
    return { advLevel, bigLv, smallLv };
  }

  private renderDom(): void {
    const prof = saveManager.current;
    const { advLevel, bigLv, smallLv } = this.resolveClassicAdventureBadge();

    this.uiRoot.innerHTML = `
      <div class="mm-overlay">
        <!-- Top-Left Official WoodSign Profile Board -->
        <img class="mm-nameboard" src="assets/ui/woodsign1.webp" alt="" />
        <div class="mm-player-name" id="mm-player-name">${this.escape(prof.name)}</div>
        <button class="mm-setname" id="mm-profile-btn" title="切换档案 / 导入导出 playerData.json">
          <img src="assets/ui/woodsign2.webp" data-base="assets/ui/woodsign2.webp" data-hl="assets/ui/woodsign2_press.webp" alt="如果这不是你的存档，请点我" />
        </button>
        <img class="mm-nameboard2" src="assets/ui/woodsign3.webp" alt="" />

        <!-- Recipe Tank (strictly behind GraveBackground per Unity prefab hierarchy) -->
        <img class="mm-peifang-light2" src="assets/ui/peifang_1.webp" alt="" />
        <img class="mm-peifang-light" src="assets/ui/peifang_2.webp" alt="" />
        <button class="mm-peifang-btn" id="mm-btn-peifang" title="配方与探索关卡 (204关)">
          <img src="assets/ui/peifang.webp" data-base="assets/ui/peifang.webp" data-hl="assets/ui/peifang_h.webp" alt="配方关卡" />
        </button>

        <!-- Grave Background Mound & Bottom Flowers -->
        <img class="mm-grave-bg" src="assets/ui/grave.webp" alt="" />
        <img class="mm-flower f1" src="assets/ui/flower2.webp" alt="" />
        <img class="mm-flower f2" src="assets/ui/flower1.webp" alt="" />
        <img class="mm-flower f3" src="assets/ui/flower3.webp" alt="" />

        <!-- Gravestone Mode Buttons & Matching Static Shadows -->
        <img class="mm-gshadow adv" src="assets/ui/shadow_adventure.webp" alt="" />
        <img class="mm-gshadow chl" src="assets/ui/shadow_survival.webp" alt="" />
        <img class="mm-gshadow iz" src="assets/ui/shadow_challenge.webp" alt="" />
        <img class="mm-gshadow sur" src="assets/ui/shadow_zengarden.webp" alt="" />

        <button class="mm-gbtn adv" id="mm-btn-adv" title="冒险模式 · 第 ${bigLv}-${smallLv} 关（第 ${advLevel}/45 关，点击直接开始）">
          <img src="assets/ui/btn_adventure.webp" data-base="assets/ui/btn_adventure.webp" data-hl="assets/ui/btn_adventure_hl.webp" alt="冒险模式" />
          <span class="mm-adv-big">${bigLv}</span>
          <span class="mm-adv-small">${smallLv}</span>
        </button>
        <button class="mm-gbtn chl" id="mm-btn-exp" title="挑战模式 (经典冒险 / 高级挑战 / 十旗 / 迷你游戏 / 自定义)">
          <img src="assets/ui/btn_challenge.webp" data-base="assets/ui/btn_challenge.webp" data-hl="assets/ui/btn_challenge_hl.webp" alt="挑战模式" />
        </button>
        <button class="mm-gbtn iz" id="mm-btn-sandbox" title="解谜模式 · 我是僵尸 (92关原版关卡)">
          <img src="assets/ui/btn_iz.webp" data-base="assets/ui/btn_iz.webp" data-hl="assets/ui/btn_iz_hl.webp" alt="解谜模式" />
        </button>
        <button class="mm-gbtn sur" id="mm-btn-sur" title="生存模式 (普通 / 困难 / 无尽轮次 · 21关)">
          <img src="assets/ui/btn_survival.webp" data-base="assets/ui/btn_survival.webp" data-hl="assets/ui/btn_survival_hl.webp" alt="生存模式" />
        </button>

        <!-- LowerButtons (Unity order: Travel, Almanac, mysterious, Garden, Options, Help, Exit) -->
        <button class="mm-lbtn travel" id="mm-btn-travel" title="旅行模式 (21轮肉鸽生存 / 旅行冒险 / 旅行游戏 / 旅行挑战)">
          <img src="assets/ui/btn_travel.webp" data-base="assets/ui/btn_travel.webp" data-hl="assets/ui/btn_travel_hl.webp" alt="旅行" />
        </button>
        <button class="mm-lbtn almanac" id="mm-btn-almanac" title="图鉴索引 (植物 / 僵尸)">
          <img src="assets/ui/btn_almanac.webp" data-base="assets/ui/btn_almanac.webp" data-hl="assets/ui/btn_almanac_hl.webp" alt="图鉴" />
        </button>
        <button class="mm-lbtn mysterious" id="mm-btn-mysterious" title="冒险秘境 · 肉鸽抽卡攀层挑战">
          <img src="assets/ui/btn_mysterious.webp" data-base="assets/ui/btn_mysterious.webp" data-hl="assets/ui/btn_mysterious_hl.webp" alt="神秘" />
        </button>
        <button class="mm-lbtn garden" id="mm-btn-garden" title="禅境花园 · 培育植物与戴夫商店">
          <img src="assets/ui/btn_garden.webp" data-base="assets/ui/btn_garden.webp" data-hl="assets/ui/btn_garden_hl.webp" alt="禅境花园" />
        </button>
        <button class="mm-lbtn options" id="mm-btn-options" title="选项">
          <img src="assets/ui/btn_options.webp" data-base="assets/ui/btn_options.webp" data-hl="assets/ui/btn_options_hl.webp" alt="选项" />
        </button>
        <button class="mm-lbtn help" id="mm-btn-help" title="玩法说明">
          <img src="assets/ui/btn_help.webp" data-base="assets/ui/btn_help.webp" data-hl="assets/ui/btn_help_hl.webp" alt="帮助" />
        </button>
        <button class="mm-lbtn quit" id="mm-btn-quit" title="本地存档已保存说明">
          <img src="assets/ui/btn_quit.webp" data-base="assets/ui/btn_quit.webp" data-hl="assets/ui/btn_quit_hl.webp" alt="退出" />
        </button>

        <!-- Bottom-Right Stone Pills -->
        <button class="mm-small-stone difficulty" id="mm-btn-diff" data-diff="${clampDifficulty(prof.difficulty)}" title="当前：${formatDifficultyFull(prof.difficulty)} — 点击切换难度 (1-5)">
          <img src="assets/ui/buttonsmall.webp" alt="" />
          <span>${formatDifficultyBadge(prof.difficulty)}</span>
        </button>
        <button class="mm-small-stone update" id="mm-btn-update" title="查看 Web 移植版说明">
          <img src="assets/ui/buttonsmall.webp" alt="" />
          <span>更新公告</span>
        </button>
        <button class="mm-small-stone setting" id="mm-btn-settings" title="选项设置">
          <img src="assets/ui/buttonsmall.webp" alt="" />
          <span>设置</span>
        </button>

        <!-- Bottom-Left Official 推荐关卡 Wood Sign -> HotLevelMenu -->
        <img class="mm-hot-shadow" src="assets/ui/hotlevel_shadow.webp" alt="" />
        <button class="mm-hot-btn" id="mm-quick-sandbox" title="推荐关卡 (特色推荐与自由沙盒入口)">
          <img src="assets/ui/hotlevel_title.webp" data-base="assets/ui/hotlevel_title.webp" data-hl="assets/ui/hotlevel_title_hl.webp" alt="推荐关卡" />
        </button>

        <!-- Bottom Attribution Row -->
        <div class="mm-info2">植物大战僵尸融合版 4.1 · 原作作者：蓝飘飘fly</div>
        <div class="mm-info4">画师：机鱼吐司 · 纯 Web 移植版</div>
      </div>
    `;

    this.uiRoot.querySelectorAll<HTMLImageElement>('img[data-hl]').forEach((img) => {
      const parent = img.parentElement;
      if (!parent) return;
      parent.addEventListener('pointerenter', () => {
        img.src = img.dataset.hl!;
      });
      parent.addEventListener('pointerleave', () => {
        img.src = img.dataset.base!;
      });
    });

    const openTab = (tab: LevelTab) => {
      audio.playSfx('GraveButton', 0.85, 50);
      this.deps.onNavigate('levels', { tab });
    };
    const openOptions = () => {
      audio.playSfx('ButtonClick', 0.85, 50);
      this.openOptionsModal();
    };

    this.uiRoot.querySelector('#mm-btn-adv')?.addEventListener('click', () => {
      audio.playSfx('GraveButton', 0.85, 50);
      this.deps.onStartClassicAdventure();
    });
    this.uiRoot.querySelector('#mm-btn-exp')?.addEventListener('click', () => openTab('challenge'));
    this.uiRoot.querySelector('#mm-btn-sandbox')?.addEventListener('click', () => openTab('iz'));
    this.uiRoot.querySelector('#mm-btn-sur')?.addEventListener('click', () => openTab('survival'));
    this.uiRoot.querySelector('#mm-btn-peifang')?.addEventListener('click', () => openTab('explore'));
    this.uiRoot.querySelector('#mm-quick-sandbox')?.addEventListener('click', () => openTab('hot'));

    this.uiRoot.querySelector('#mm-btn-travel')?.addEventListener('click', () => {
      audio.playSfx('GraveButton', 0.85, 50);
      this.deps.onNavigate('travel');
    });
    this.uiRoot.querySelector('#mm-btn-mysterious')?.addEventListener('click', () => {
      audio.playSfx('GraveButton', 0.85, 50);
      this.deps.onNavigate('abyss');
    });
    this.uiRoot.querySelector('#mm-btn-garden')?.addEventListener('click', () => {
      audio.playSfx('GraveButton', 0.85, 50);
      this.deps.onNavigate('garden');
    });

    this.uiRoot.querySelector('#mm-btn-almanac')?.addEventListener('click', () => {
      audio.playSfx('ButtonClick', 0.85, 50);
      this.deps.onNavigate('almanac');
    });
    this.uiRoot.querySelector('#mm-btn-options')?.addEventListener('click', openOptions);
    this.uiRoot.querySelector('#mm-btn-settings')?.addEventListener('click', openOptions);
    const diffBtn = this.uiRoot.querySelector<HTMLButtonElement>('#mm-btn-diff');
    diffBtn?.addEventListener('click', () => {
      const next = (clampDifficulty(saveManager.current.difficulty) % 5) + 1;
      saveManager.update({ difficulty: next });
      audio.playSfx('Tap', 0.8, 40);
      diffBtn.dataset.diff = String(next);
      diffBtn.title = `当前：${formatDifficultyFull(next)} — 点击切换难度 (1-5)`;
      const sp = diffBtn.querySelector('span');
      if (sp) sp.textContent = formatDifficultyBadge(next);
    });
    this.uiRoot.querySelector('#mm-btn-help')?.addEventListener('click', () => {
      audio.playSfx('ButtonClick', 0.85, 50);
      this.openHelpModal();
    });
    this.uiRoot.querySelector('#mm-btn-update')?.addEventListener('click', () => {
      audio.playSfx('ButtonClick', 0.85, 50);
      this.openUpdateInfoModal();
    });
    this.uiRoot.querySelector('#mm-btn-quit')?.addEventListener('click', () => {
      audio.playSfx('ButtonClick', 0.85, 50);
      this.openQuitInfoModal();
    });
    this.uiRoot.querySelector('#mm-profile-btn')?.addEventListener('click', () => {
      audio.playSfx('ButtonClick', 0.85, 50);
      this.openProfileModal();
    });
  }

  private openProfileModal(): void {
    this.closeModal();
    const profiles = saveManager.listProfiles();
    const cur = saveManager.current;
    const modal = document.createElement('div');
    modal.className = 'pvz-modal-backdrop';
    modal.innerHTML = `
      <div class="pvz-tomb-dialog">
        <img class="pvz-tomb-bg" src="assets/ui/options_menuback.webp" alt="" />
        <div class="pvz-tomb-inner">
          <div class="pvz-tomb-hdr">玩家档案 & 存档导入/导出</div>
          <div class="pvz-profile-list">
            ${profiles
              .map(
                (p) => `
              <div class="pvz-profile-item ${p.name === cur.name ? 'active' : ''}">
                <div>
                  <strong>${this.escape(p.name)}</strong>
                  <span class="muted">冒险第 ${p.advLevel} 关 · 已发现融合 ${p.discoveredFusions.length} 种</span>
                </div>
                <div class="row-actions">
                  ${p.name !== cur.name ? `<button class="btn-wood-sm" data-switch="${this.escape(p.name)}">切换</button>` : '<span class="tag-active">当前</span>'}
                  ${profiles.length > 1 ? `<button class="btn-wood-sm danger" data-del="${this.escape(p.name)}">删除</button>` : ''}
                </div>
              </div>
            `,
              )
              .join('')}
          </div>

          <div class="pvz-inline-form">
            <input id="m-new-name" type="text" placeholder="输入新玩家名字..." maxlength="16" />
            <button class="btn-wood-sm" id="m-create">新建/切换</button>
          </div>

          <div class="pvz-io-row">
            <label class="btn-wood-sm file-lbl">
              导入 playerData.json
              <input id="m-import-file" type="file" accept=".json,application/json" hidden />
            </label>
            <button class="btn-wood-sm" id="m-export-btn">导出 playerData.json</button>
          </div>
          <div id="m-io-msg" class="pvz-io-msg"></div>

          <button class="pvz-tomb-done-btn" id="m-close">
            <img src="assets/ui/options_backtogame.webp" alt="确定" />
            <span>确定返回</span>
          </button>
        </div>
      </div>
    `;
    this.uiRoot.appendChild(modal);
    this.modalEl = modal;

    modal.querySelector('#m-close')?.addEventListener('click', () => this.closeModal());
    modal.querySelectorAll<HTMLButtonElement>('[data-switch]').forEach((b) => {
      b.addEventListener('click', () => {
        saveManager.switchProfile(b.dataset.switch!);
        this.closeModal();
        this.renderDom();
      });
    });
    modal.querySelectorAll<HTMLButtonElement>('[data-del]').forEach((b) => {
      b.addEventListener('click', () => {
        saveManager.deleteProfile(b.dataset.del!);
        this.openProfileModal();
        this.renderDom();
      });
    });
    modal.querySelector('#m-create')?.addEventListener('click', () => {
      const inp = modal.querySelector<HTMLInputElement>('#m-new-name')!;
      if (inp.value.trim()) {
        saveManager.switchProfile(inp.value.trim());
        this.closeModal();
        this.renderDom();
      }
    });
    modal.querySelector<HTMLInputElement>('#m-import-file')?.addEventListener('change', async (ev) => {
      const f = (ev.target as HTMLInputElement).files?.[0];
      if (!f) return;
      const text = await f.text();
      const res = saveManager.importProfileJson(text);
      const msgEl = modal.querySelector('#m-io-msg')!;
      msgEl.textContent = res.message;
      if (res.ok) this.renderDom();
    });
    modal.querySelector('#m-export-btn')?.addEventListener('click', () => {
      const blob = new Blob([saveManager.exportProfileJson()], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'playerData.json';
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  private openOptionsModal(): void {
    this.closeModal();
    const p = saveManager.current;
    const curDiff = clampDifficulty(p.difficulty);
    const diffInfo = getDifficultyInfo(curDiff);
    const modal = document.createElement('div');
    modal.className = 'pvz-modal-backdrop';
    modal.innerHTML = `
      <div class="pvz-tomb-dialog">
        <img class="pvz-tomb-bg" src="assets/ui/options_menuback.webp" alt="" />
        <div class="pvz-tomb-inner opts-body">
          <div class="pvz-tomb-hdr">游戏选项</div>
          <label class="opt-row">
            <span>音乐音量</span>
            <input id="o-bgm" type="range" min="0" max="100" value="${Math.round(p.musicVolume * 100)}" />
          </label>
          <label class="opt-row">
            <span>音效音量</span>
            <input id="o-sfx" type="range" min="0" max="100" value="${Math.round(p.soundVolume * 100)}" />
          </label>
          <div class="opt-diff-block">
            <div class="opt-diff-hdr">
              <span>游戏难度</span>
              <span class="opt-diff-val" id="o-diff-val" data-diff="${curDiff}">${formatDifficultyFull(curDiff)}</span>
            </div>
            <input id="o-diff" type="range" min="1" max="5" step="1" value="${curDiff}" />
            <div class="opt-diff-pills">
              ${DIFFICULTY_LEVELS.map(
                (d) =>
                  `<button type="button" class="opt-diff-pill${d.level === curDiff ? ' active' : ''}${d.isDefault ? ' is-default' : ''}" data-set-diff="${d.level}" title="${this.escape(d.summary)}">${d.level} ${d.shortName}</button>`,
              ).join('')}
            </div>
            <div class="opt-diff-desc" id="o-diff-desc">${this.escape(diffInfo.summary)}</div>
          </div>
          <label class="opt-check">
            <input id="o-mute" type="checkbox" ${p.muted ? 'checked' : ''} />
            <span>静音所有声音</span>
          </label>
          <label class="opt-check">
            <input id="o-auto" type="checkbox" ${p.autoCollect ? 'checked' : ''} />
            <span>自动拾取阳光</span>
          </label>
          <label class="opt-check">
            <input id="o-unlock" type="checkbox" ${p.unlockAll ? 'checked' : ''} />
            <span>解锁全关卡与植物</span>
          </label>
          <div class="pvz-io-row">
            <button class="btn-wood-sm" id="o-unlock-all-btn" data-confirm="0">一键通关/解锁全部</button>
            <button class="btn-wood-sm danger" id="o-reset-btn" data-confirm="0">重置所有进度</button>
          </div>
          <button class="pvz-tomb-done-btn" id="o-close">
            <img src="assets/ui/options_backtogame.webp" alt="完成" />
            <span>确定保存</span>
          </button>
        </div>
      </div>
    `;
    this.uiRoot.appendChild(modal);
    this.modalEl = modal;

    const diffSlider = modal.querySelector<HTMLInputElement>('#o-diff')!;
    const diffValEl = modal.querySelector<HTMLElement>('#o-diff-val')!;
    const diffDescEl = modal.querySelector<HTMLElement>('#o-diff-desc')!;
    const diffPills = modal.querySelectorAll<HTMLButtonElement>('[data-set-diff]');

    const applyDiffUi = (val: unknown) => {
      const next = clampDifficulty(val);
      const info = getDifficultyInfo(next);
      diffSlider.value = String(next);
      diffValEl.dataset.diff = String(next);
      diffValEl.textContent = formatDifficultyFull(next);
      diffDescEl.textContent = info.summary;
      diffPills.forEach((btn) => {
        btn.classList.toggle('active', Number(btn.dataset.setDiff) === next);
      });
      return next;
    };

    const sync = () => {
      const nextDiff = applyDiffUi(diffSlider.value);
      saveManager.update({
        musicVolume: Number(modal.querySelector<HTMLInputElement>('#o-bgm')!.value) / 100,
        soundVolume: Number(modal.querySelector<HTMLInputElement>('#o-sfx')!.value) / 100,
        difficulty: nextDiff,
        muted: modal.querySelector<HTMLInputElement>('#o-mute')!.checked,
        autoCollect: modal.querySelector<HTMLInputElement>('#o-auto')!.checked,
        unlockAll: modal.querySelector<HTMLInputElement>('#o-unlock')!.checked,
      });
    };
    modal.querySelectorAll('input').forEach((el) => {
      el.addEventListener('input', sync);
      el.addEventListener('change', sync);
    });
    diffPills.forEach((btn) => {
      btn.addEventListener('click', () => {
        const next = applyDiffUi(btn.dataset.setDiff);
        audio.playSfx('Tap', 0.75, 35);
        saveManager.update({ difficulty: next });
      });
    });

    const bindTwoStepConfirm = (sel: string, confirmText: string, action: () => void) => {
      const btn = modal.querySelector<HTMLButtonElement>(sel);
      btn?.addEventListener('click', () => {
        if (btn.dataset.confirm !== '1') {
          btn.dataset.confirm = '1';
          btn.textContent = confirmText;
          return;
        }
        action();
        this.closeModal();
        this.renderDom();
      });
    };
    bindTwoStepConfirm('#o-unlock-all-btn', '再按一次确认全解锁', () => saveManager.unlockAllLevels());
    bindTwoStepConfirm('#o-reset-btn', '再按一次确认重置', () => saveManager.resetProgress());

    modal.querySelector('#o-close')?.addEventListener('click', () => {
      sync();
      this.closeModal();
      this.renderDom();
    });
  }

  private showInfoModal(title: string, bodyHtml: string, buttonText: string): void {
    this.closeModal();
    const modal = document.createElement('div');
    modal.className = 'pvz-modal-backdrop';
    modal.innerHTML = `
      <div class="pvz-tomb-dialog">
        <img class="pvz-tomb-bg" src="assets/ui/options_menuback.webp" alt="" />
        <div class="pvz-tomb-inner">
          <div class="pvz-tomb-hdr">${this.escape(title)}</div>
          <div class="help-text">${bodyHtml}</div>
          <button class="pvz-tomb-done-btn" id="m-info-close">
            <img src="assets/ui/options_backtogame.webp" alt="关闭" />
            <span>${this.escape(buttonText)}</span>
          </button>
        </div>
      </div>
    `;
    this.uiRoot.appendChild(modal);
    this.modalEl = modal;
    modal.querySelector('#m-info-close')?.addEventListener('click', () => this.closeModal());
  }

  private openHelpModal(): void {
    this.showInfoModal(
      '操作与融合指南',
      `
        <p><strong>融合种植</strong>：选中植物卡点击兼容格子即可二合一融合；传送带关卡免阳光直接出卡。</p>
        <p><strong>战斗工具逐步解锁</strong>：<strong>铲子</strong>(<code>Q</code>) 与 <strong>时停</strong>(<code>T</code>) 初始可用；<strong>植物/僵尸手套</strong>(<code>E</code>，<code>V</code>切换) 需通关冒险第 4 关(1-4)；<strong>肥料</strong>(<code>F</code>) 需通关冒险第 13 关(2-4)；<strong>大锤</strong>(<code>H</code>) 需通关冒险第 31 关(4-4)；<strong>手推车</strong>(<code>B</code>) 需通关挑战-迷你游戏「手推车挑战」解锁（自由沙盒全可用）。</p>
        <p><strong>我是僵尸（解谜模式）</strong>：共 92 关原版数据，在红线右侧投放僵尸吃光左侧 5 枚大脑即可获胜。</p>
        <p><strong>其它快捷键</strong>：<code>1-9/0</code> 选卡 · <code>Space</code> 暂停 · <code>右键</code> 取消选中。</p>
      `,
      '知道了',
    );
  }

  private openUpdateInfoModal(): void {
    this.showInfoModal(
      '融合版 4.1 · 纯 Web 端移植说明',
      `
        <p><strong>1:1 原版视觉</strong>：解包官方 <code>data.unity3d</code> 贴图、骨骼动画、音效与关卡数据在浏览器纯前端运行。</p>
        <p><strong>全模式上线</strong>：经典冒险 45 关与植物解锁、星辉冒险/挑战、配方探索(204关)、生存/无尽(21关)、我是僵尸(92关)，以及最新移植的<strong>砸罐子(7关)</strong>、<strong>旅行模式(词条/商店/诸神)</strong>、<strong>禅境花园</strong>与<strong>冒险秘境(抽卡攀层)</strong>！</p>
        <p><strong>作者致谢</strong>：原作作者 蓝飘飘fly · 画师 机鱼吐司。</p>
      `,
      '确定',
    );
  }

  private openQuitInfoModal(): void {
    this.showInfoModal(
      '本地存档已自动保存',
      `
        <p>浏览器端无需手动退出：所有通关进度、融合图鉴发现记录与音量设置已实时保存至当前浏览器本地存储。</p>
        <p>如需迁移存档，可点击左上角木牌<strong>“如果这不是你的存档，请点我！”</strong>导入或导出 <code>playerData.json</code>。</p>
      `,
      '继续游玩',
    );
  }

  private closeModal(): void {
    if (this.modalEl) {
      this.modalEl.remove();
      this.modalEl = null;
    }
  }

  private escape(s: string): string {
    return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] || ch));
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.closeModal();
    this.clouds.length = 0;
    this.waterSprite = null;
    this.endoflameSprite = null;
    this.squalourSprite = null;
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
