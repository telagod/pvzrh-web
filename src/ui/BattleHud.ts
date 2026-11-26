import { assets } from '../assets/AssetLoader';
import { audio } from '../audio/AudioManager';
import type { BoardEngine } from '../engine/BoardEngine';
import { saveManager } from '../save/SaveManager';
import type { BoardConfig, HudSnapshot, PlantDef } from '../types/game';
import { bindHoverImages, escHtml, formatUnityRichText, getCardFrameUrl } from './levelsCatalog';
import { MaLiangPad } from './MaLiangPad';

export interface BattleHudDeps {
  config: BoardConfig;
  board: BoardEngine;
  hasNextLevel?: boolean;
  fromMainMenu?: boolean;
  customNextLabel?: string;
  customExitLabel?: string;
  onNextLevel?: () => void;
  onOpenAlmanac: () => void;
  onRestart: () => void;
  onExitToLevels: () => void;
  onExitToMenu: () => void;
}

/**
 * In-Game HUD matching PvZ Fusion visuals:
 * standard `seed_bank.webp`, Conveyor Belt (`conveyor_backdrop.webp` + `conveyor_belt.webp`),
 * I, Zombie (`almanac_zombie_window.webp` cards + Brain counter), `flagmeter_*` wave bar,
 * and `options_menuback.webp` dialogs.
 */
export class BattleHud {
  private readonly host: HTMLElement;
  private readonly deps: BattleHudDeps;

  private sunSlotEl!: HTMLElement;
  private sunEl!: HTMLElement;
  private seedBankWrap!: HTMLElement;
  private cardsEl!: HTMLElement;
  private conveyorWrap!: HTMLElement;
  private conveyorTrack!: HTMLElement;
  private toolsWrap!: HTMLElement;
  private cardEls: {
    btn: HTMLButtonElement;
    cdEl: HTMLElement;
    plantId: number;
  }[] = [];
  private izCardEls: {
    btn: HTMLButtonElement;
    zombieId: number;
  }[] = [];
  private conveyorElMap = new Map<number, HTMLButtonElement>();
  private shovelBtn!: HTMLButtonElement;
  private gloveBtn!: HTMLButtonElement;
  private gloveImgEl!: HTMLImageElement;
  private gloveHeldEl!: HTMLImageElement;
  private gloveLabelEl!: HTMLElement;
  private gloveSwitchBtn!: HTMLButtonElement;
  private timeStopBtn!: HTMLButtonElement;
  private hammerBtn!: HTMLButtonElement;
  private hammerCdEl!: HTMLElement;
  private wheelbarrowBtn!: HTMLButtonElement;
  private wheelbarrowHeldEl!: HTMLImageElement;
  private wheelbarrowCdEl!: HTMLElement;
  private wheelbarrowLblEl!: HTMLElement;
  private fertilizerBtn!: HTMLButtonElement;
  private fertilizerCountEl!: HTMLElement;
  private fertilizerTimerEl!: HTMLElement;
  private toolHintEl!: HTMLElement;
  private toolHintTextEl!: HTMLElement;
  private toolHintCancelBtn!: HTMLButtonElement;
  private bossBarEl!: HTMLElement;
  private bossPortEl!: HTMLImageElement;
  private bossNameEl!: HTMLElement;
  private bossHpFillEl!: HTMLElement;
  private bossArmorFillEl!: HTMLElement;
  private bossNumsEl!: HTMLElement;
  private modeBadgeEl!: HTMLElement;
  private maLiangPad: MaLiangPad | null = null;
  private speedBtn!: HTMLButtonElement;
  private autoBtn!: HTMLButtonElement;
  private muteBtn!: HTMLButtonElement;
  private waveFillEl!: HTMLElement;
  private waveHeadEl!: HTMLElement;
  private waveTextEl!: HTMLElement;
  private statsEl!: HTMLElement;
  private waveAlertEl!: HTMLElement;
  private toastContainer!: HTMLElement;
  private modalHost!: HTMLElement;

  private keyHandler: (e: KeyboardEvent) => void;
  private lastCardIdsKey = '';
  private lastIzIdsKey = '';

  constructor(host: HTMLElement, deps: BattleHudDeps) {
    this.host = host;
    this.deps = deps;
    this.keyHandler = (e) => this.handleKeyDown(e);
  }

  mount(): void {
    const isSandbox = this.deps.config.mode === 'sandbox';
    const isIz = this.deps.config.mode === 'iz';
    const isConv = Boolean(this.deps.config.conveyorMode);
    const hasTips = Boolean(formatUnityRichText(this.deps.config.tips));
    const buffLabels = this.deps.config.modifiers?.activeBuffLabels ?? [];

    this.host.innerHTML = `
      <div class="bh-shell" id="bh-shell" style="display:none">
        <div class="bh-top-row">
          <div class="bh-seedbank-official ${isIz ? 'is-iz' : ''}" id="bh-seedbank-wrap" style="${isConv ? 'display:none' : ''}">
            <img class="bh-bank-bg" src="assets/ui/seed_bank.webp" alt="" />
            <div class="bh-sun-slot" id="bh-sun-slot"><span id="bh-sun-val">150</span></div>
            <div class="bh-cards" id="bh-cards"></div>
          </div>

          <div class="bh-conveyor-wrap" id="bh-conveyor-wrap" style="${isConv ? '' : 'display:none'}">
            <img class="bh-conv-bg" src="assets/ui/conveyor_backdrop.webp" alt="" />
            <img class="bh-conv-belt" src="assets/ui/conveyor_belt.webp" alt="" />
            <div class="bh-conv-track" id="bh-conv-track"></div>
          </div>

          <div class="bh-tools" id="bh-tools" style="${isIz ? 'display:none' : ''}">
            <div class="bh-tool-unit">
              <button class="bh-tool-bank" id="bh-shovel" title="铲子 (Q)：铲除场上植物，无冷却">
                <img class="bank-bg" src="assets/ui/shovel_bank.webp" alt="" />
                <img class="tool-ico" src="assets/ui/shovel.webp" alt="铲子" />
              </button>
              <span class="bh-tool-cap">铲子</span>
            </div>

            <div class="bh-tool-unit">
              <button class="bh-tool-bank" id="bh-glove" title="融合手套 (E)：移动植物或僵尸；点击下方可切换 (V)">
                <img class="bank-bg" src="assets/ui/shovel_bank.webp" alt="" />
                <img class="tool-ico" id="bh-glove-img" src="assets/ui/glove.webp" alt="手套" />
                <img class="bh-tool-held-port" id="bh-glove-held" src="" alt="" style="display:none" />
                <span class="bh-tool-cd" id="bh-glove-cd"></span>
              </button>
              <button class="bh-tool-cap is-switch" id="bh-glove-switch" title="点击切换植物手套 / 僵尸手套 (快捷键 V)">植手⇄</button>
            </div>

            <div class="bh-tool-unit">
              <button class="bh-tool-bank" id="bh-hammer" title="大锤 (H)：60秒冷却，对小范围僵尸造成百万重击（首领 5000）">
                <img class="bank-bg" src="assets/ui/shovel_bank.webp" alt="" />
                <img class="tool-ico" src="assets/ui/modes/hammer.webp" alt="大锤" />
                <span class="bh-tool-cd" id="bh-hammer-cd"></span>
              </button>
              <span class="bh-tool-cap" id="bh-hammer-lbl">大锤</span>
            </div>

            <div class="bh-tool-unit">
              <button class="bh-tool-bank" id="bh-wheelbarrow" title="手推车 (B)：暂存 1 株植物（不触发生成/亡语），再次放下可重置冷却（30秒）">
                <img class="bank-bg" src="assets/ui/shovel_bank.webp" alt="" />
                <img class="tool-ico" src="assets/ui/modes/wheelbarrow.webp" alt="手推车" />
                <img class="bh-tool-held-port" id="bh-wb-held" src="" alt="" style="display:none" />
                <span class="bh-tool-cd" id="bh-wheelbarrow-cd"></span>
              </button>
              <span class="bh-tool-cap" id="bh-wheelbarrow-lbl">手推车</span>
            </div>

            <div class="bh-tool-unit">
              <button class="bh-tool-bank" id="bh-fertilizer" title="肥料 (F)：每70秒自动+1袋（上限5），恢复本格满血、解冻并立即结束蓄力/消化冷却">
                <img class="bank-bg" src="assets/ui/shovel_bank.webp" alt="" />
                <img class="tool-ico" src="assets/ui/modes/fertilizer_lv2.webp" alt="肥料" />
                <span class="bh-tool-recharge" id="bh-fert-timer">70s</span>
                <span class="bh-tool-count" id="bh-fert-count">×1</span>
              </button>
              <span class="bh-tool-cap">肥料</span>
            </div>
          </div>

          <div class="bh-ctrls">
            <button class="bh-stone-pill" id="bh-timestop" title="时停 (T)：切换 0.2 倍慢速，便于精细融合操作">时停</button>
            <button class="bh-stone-pill" id="bh-speed" title="切换倍速 (1x / 2x / 3x)">1x</button>
            <button class="bh-stone-pill" id="bh-auto" title="自动收集阳光">自动收</button>
            <button class="bh-stone-pill${audio.isMuted() ? ' muted' : ''}" id="bh-mute" title="开关声音">${audio.isMuted() ? '静音' : '声音'}</button>
            ${isSandbox ? '<button class="bh-stone-pill gold" id="bh-spawn-wave" title="立即生成一波测试僵尸">刷波</button>' : ''}
            ${buffLabels.length > 0 ? `<button class="bh-stone-pill gold bh-buff-pill" id="bh-buffs-btn" title="查看当前生效的词条加成与敌方词缀">词条(${buffLabels.length})</button>` : ''}
            ${hasTips ? '<button class="bh-stone-pill gold" id="bh-tips-btn" title="查看本关机制与提示">提示</button>' : ''}
            <button class="bh-stone-pill" id="bh-almanac" title="查看植物与僵尸图鉴">图鉴</button>
            <button class="bh-stone-pill" id="bh-tools-help" title="查看工具栏与快捷键说明">说明</button>
            <button class="bh-stone-pill" id="bh-pause" title="暂停与选项 (Space)">菜单</button>
          </div>
        </div>

        <div class="bh-boss-bar" id="bh-boss-bar" style="display:none">
          <img class="bh-boss-port" id="bh-boss-port" src="" alt="" />
          <div class="bh-boss-meta">
            <div class="bh-boss-top">
              <span class="bh-boss-name" id="bh-boss-name"></span>
              <span class="bh-boss-nums" id="bh-boss-nums"></span>
            </div>
            <div class="bh-boss-track">
              <div class="bh-boss-fill" id="bh-boss-hp-fill" style="width:100%"></div>
              <div class="bh-boss-armor" id="bh-boss-armor-fill" style="width:0%"></div>
            </div>
          </div>
        </div>

        <div class="bh-wave-alert" id="bh-wave-alert"></div>
        <div class="bh-toasts" id="bh-toasts"></div>
        <div id="bh-maliang-host"></div>

        <div class="bh-tool-hint" id="bh-tool-hint" style="display:none">
          <span id="bh-tool-hint-text"></span>
          <button class="bh-tool-hint-cancel" id="bh-tool-hint-cancel">取消</button>
        </div>

        <div class="bh-bottom-bar">
          <div class="bh-mode-badge" id="bh-mode-badge" style="display:none"></div>
          <div class="bh-level-name">${escHtml(this.deps.config.title)}</div>
          <div class="bh-stats" id="bh-stats">击杀 0 · 融合 0</div>
          <div class="bh-flagmeter">
            <img class="fm-bg" src="assets/ui/flagmeter_empty.webp" alt="" />
            <div class="fm-fill-wrap" id="bh-wave-fill">
              <img class="fm-fill" src="assets/ui/flagmeter_full.webp" alt="" />
            </div>
            <img class="fm-flag" src="assets/ui/flagmeter_flag.webp" alt="" />
            <img class="fm-head" id="bh-wave-head" src="assets/ui/flagmeter_head.webp" alt="" />
          </div>
          <span class="bh-wave-txt" id="bh-wave-text">准备中</span>
        </div>

        <div id="bh-modal-host"></div>
      </div>
    `;

    this.seedBankWrap = this.host.querySelector('#bh-seedbank-wrap')!;
    this.sunSlotEl = this.host.querySelector('#bh-sun-slot')!;
    this.sunEl = this.host.querySelector('#bh-sun-val')!;
    this.cardsEl = this.host.querySelector('#bh-cards')!;
    this.conveyorWrap = this.host.querySelector('#bh-conveyor-wrap')!;
    this.conveyorTrack = this.host.querySelector('#bh-conv-track')!;
    this.toolsWrap = this.host.querySelector('#bh-tools')!;
    this.shovelBtn = this.host.querySelector('#bh-shovel')!;
    this.gloveBtn = this.host.querySelector('#bh-glove')!;
    this.gloveImgEl = this.host.querySelector('#bh-glove-img')!;
    this.gloveHeldEl = this.host.querySelector('#bh-glove-held')!;
    this.gloveLabelEl = this.host.querySelector('#bh-glove-cd')!;
    this.gloveSwitchBtn = this.host.querySelector('#bh-glove-switch')!;
    this.timeStopBtn = this.host.querySelector('#bh-timestop')!;
    this.hammerBtn = this.host.querySelector('#bh-hammer')!;
    this.hammerCdEl = this.host.querySelector('#bh-hammer-cd')!;
    this.wheelbarrowBtn = this.host.querySelector('#bh-wheelbarrow')!;
    this.wheelbarrowHeldEl = this.host.querySelector('#bh-wb-held')!;
    this.wheelbarrowCdEl = this.host.querySelector('#bh-wheelbarrow-cd')!;
    this.wheelbarrowLblEl = this.host.querySelector('#bh-wheelbarrow-lbl')!;
    this.fertilizerBtn = this.host.querySelector('#bh-fertilizer')!;
    this.fertilizerCountEl = this.host.querySelector('#bh-fert-count')!;
    this.fertilizerTimerEl = this.host.querySelector('#bh-fert-timer')!;
    this.toolHintEl = this.host.querySelector('#bh-tool-hint')!;
    this.toolHintTextEl = this.host.querySelector('#bh-tool-hint-text')!;
    this.toolHintCancelBtn = this.host.querySelector('#bh-tool-hint-cancel')!;
    this.bossBarEl = this.host.querySelector('#bh-boss-bar')!;
    this.bossPortEl = this.host.querySelector('#bh-boss-port')!;
    this.bossNameEl = this.host.querySelector('#bh-boss-name')!;
    this.bossHpFillEl = this.host.querySelector('#bh-boss-hp-fill')!;
    this.bossArmorFillEl = this.host.querySelector('#bh-boss-armor-fill')!;
    this.bossNumsEl = this.host.querySelector('#bh-boss-nums')!;
    this.modeBadgeEl = this.host.querySelector('#bh-mode-badge')!;
    this.speedBtn = this.host.querySelector('#bh-speed')!;
    this.autoBtn = this.host.querySelector('#bh-auto')!;
    this.muteBtn = this.host.querySelector('#bh-mute')!;
    this.waveFillEl = this.host.querySelector('#bh-wave-fill')!;
    this.waveHeadEl = this.host.querySelector('#bh-wave-head')!;
    this.waveTextEl = this.host.querySelector('#bh-wave-text')!;
    this.statsEl = this.host.querySelector('#bh-stats')!;
    this.waveAlertEl = this.host.querySelector('#bh-wave-alert')!;
    this.toastContainer = this.host.querySelector('#bh-toasts')!;
    this.modalHost = this.host.querySelector('#bh-modal-host')!;

    this.shovelBtn.addEventListener('click', () => this.deps.board.toggleShovel());
    this.gloveBtn.addEventListener('click', () => this.deps.board.toggleGlove());
    this.gloveSwitchBtn.addEventListener('click', () => this.deps.board.toggleGloveMode());
    this.timeStopBtn.addEventListener('click', () => this.deps.board.toggleTimeStop());
    this.hammerBtn.addEventListener('click', () => this.deps.board.toggleHammer());
    this.wheelbarrowBtn.addEventListener('click', () => this.deps.board.toggleWheelbarrow());
    this.fertilizerBtn.addEventListener('click', () => this.deps.board.toggleFertilizer());
    this.toolHintCancelBtn.addEventListener('click', () => {
      const snap = this.deps.board.getSnapshot();
      const anyBoardTool =
        snap.shovelActive ||
        snap.gloveActive ||
        snap.hammerActive ||
        snap.wheelbarrowActive ||
        snap.fertilizerActive;
      if (!anyBoardTool && snap.timeStopActive) {
        this.deps.board.toggleTimeStop();
      } else {
        this.deps.board.cancelSelection();
      }
    });
    this.speedBtn.addEventListener('click', () => this.deps.board.toggleSpeed());
    this.autoBtn.addEventListener('click', () => this.deps.board.toggleAutoCollect());
    if (this.deps.config.maliangMode) {
      const mlHost = this.host.querySelector<HTMLElement>('#bh-maliang-host');
      if (mlHost) {
        this.maLiangPad = new MaLiangPad(mlHost, (pid) => this.deps.board.summonMaLiangPlant(pid, 35));
      }
    }
    this.muteBtn.addEventListener('click', () => {
      const next = !audio.isMuted();
      audio.applySettings(0.55, 0.85, next);
      this.muteBtn.textContent = next ? '静音' : '声音';
      this.muteBtn.classList.toggle('muted', next);
    });
    this.host.querySelector('#bh-almanac')?.addEventListener('click', () => this.deps.onOpenAlmanac());
    this.host.querySelector('#bh-tools-help')?.addEventListener('click', () => {
      this.deps.board.setPaused(true);
      this.showToolsHelpModal();
    });
    this.host.querySelector('#bh-spawn-wave')?.addEventListener('click', () => this.deps.board.spawnSandboxWave());
    this.host.querySelector('#bh-buffs-btn')?.addEventListener('click', () => {
      this.deps.board.setPaused(true);
      this.showBuffsModal();
    });
    this.host.querySelector('#bh-tips-btn')?.addEventListener('click', () => {
      this.deps.board.setPaused(true);
      this.showTipsModal();
    });
    this.host.querySelector('#bh-pause')?.addEventListener('click', () => {
      this.deps.board.setPaused(true);
      this.showPauseModal();
    });

    window.addEventListener('keydown', this.keyHandler);
  }

  private handleKeyDown(e: KeyboardEvent): void {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    const snap = this.deps.board.getSnapshot();
    if (snap.phase !== 'playing' && snap.phase !== 'paused') return;

    if (e.key >= '1' && e.key <= '9') {
      this.deps.board.setSelectedCard(Number(e.key) - 1);
    } else if (e.key === '0') {
      this.deps.board.setSelectedCard(9);
    } else if (e.key.toLowerCase() === 'q') {
      this.deps.board.toggleShovel();
    } else if (e.key.toLowerCase() === 'e') {
      this.deps.board.toggleGlove();
    } else if (e.key.toLowerCase() === 'v') {
      this.deps.board.toggleGloveMode();
    } else if (e.key.toLowerCase() === 't') {
      this.deps.board.toggleTimeStop();
    } else if (e.key.toLowerCase() === 'h') {
      this.deps.board.toggleHammer();
    } else if (e.key.toLowerCase() === 'b') {
      this.deps.board.toggleWheelbarrow();
    } else if (e.key.toLowerCase() === 'f') {
      this.deps.board.toggleFertilizer();
    } else if (e.code === 'Space' || e.key === 'Escape') {
      e.preventDefault();
      if (snap.phase === 'playing') {
        this.deps.board.setPaused(true);
        this.showPauseModal();
      } else {
        this.modalHost.innerHTML = '';
        this.deps.board.setPaused(false);
      }
    }
  }

  update(snap: HudSnapshot): void {
    const shell = this.host.querySelector('#bh-shell') as HTMLElement | null;
    if (!shell) return;
    shell.style.display = snap.phase === 'choosing' ? 'none' : 'flex';
    if (snap.phase === 'choosing') return;

    this.seedBankWrap.style.display = snap.conveyorMode ? 'none' : 'flex';
    this.conveyorWrap.style.display = snap.conveyorMode ? 'block' : 'none';
    this.toolsWrap.style.display = snap.izMode ? 'none' : 'flex';
    this.sunSlotEl.style.display = snap.conveyorMode ? 'none' : 'flex';
    this.sunEl.textContent = snap.infiniteSun ? '∞' : String(snap.sun);

    if (snap.conveyorMode) {
      this.syncConveyorTrack(snap);
    } else if (snap.izMode) {
      const izKey = snap.izZombieCards.map((c) => c.zombieId).join(',');
      if (izKey !== this.lastIzIdsKey) {
        this.lastIzIdsKey = izKey;
        this.rebuildIzButtons(snap);
      }
      snap.izZombieCards.forEach((c, idx) => {
        const item = this.izCardEls[idx];
        if (!item) return;
        item.btn.classList.toggle('selected', idx === snap.selectedCardIndex);
        item.btn.classList.toggle('unaffordable', !c.affordable);
      });
    } else {
      const idsKey = snap.cards.map((c) => `${c.plantId}${c.isSubCard ? ':s' : ''}`).join(',');
      if (idsKey !== this.lastCardIdsKey) {
        this.lastCardIdsKey = idsKey;
        this.rebuildCardButtons(snap);
      }
      snap.cards.forEach((c, idx) => {
        const item = this.cardEls[idx];
        if (!item) return;
        item.btn.classList.toggle('selected', idx === snap.selectedCardIndex);
        item.btn.classList.toggle('unaffordable', !c.affordable);
        const pct = c.cooldownTotal > 0 ? Math.min(100, (c.cooldownLeft / c.cooldownTotal) * 100) : 0;
        item.cdEl.style.height = `${pct}%`;
      });
    }

    this.shovelBtn.classList.toggle('active', snap.shovelActive);
    this.gloveBtn.classList.toggle('active', snap.gloveActive);
    const hasGloveHeld = snap.gloveHoldingPlantId !== null || snap.gloveHoldingZombieId !== null;
    this.gloveBtn.classList.toggle('cooling', snap.gloveCooldownLeft > 0.1 && !hasGloveHeld);
    this.gloveBtn.classList.toggle('has-stored', hasGloveHeld);
    const targetGloveSrc = snap.gloveMode === 'zombie' ? 'assets/ui/modes/zombie_glove.webp' : 'assets/ui/glove.webp';
    if (!this.gloveImgEl.src.endsWith(targetGloveSrc)) {
      this.gloveImgEl.src = targetGloveSrc;
    }
    if (snap.gloveHoldingPlantId !== null) {
      const p = assets.getPlant(snap.gloveHoldingPlantId);
      const src = `assets/portraits/plants/${p?.portrait ?? `p_${snap.gloveHoldingPlantId}.webp`}`;
      if (!this.gloveHeldEl.src.endsWith(src)) this.gloveHeldEl.src = src;
      this.gloveHeldEl.style.display = 'block';
    } else if (snap.gloveHoldingZombieId !== null) {
      const z = assets.getZombie(snap.gloveHoldingZombieId);
      const src = `assets/portraits/zombies/${z?.portrait ?? `z_${snap.gloveHoldingZombieId}.webp`}`;
      if (!this.gloveHeldEl.src.endsWith(src)) this.gloveHeldEl.src = src;
      this.gloveHeldEl.style.display = 'block';
    } else {
      this.gloveHeldEl.style.display = 'none';
    }
    this.gloveSwitchBtn.textContent = snap.gloveMode === 'zombie' ? '僵手⇄' : '植手⇄';
    this.gloveSwitchBtn.classList.toggle('zombie-mode', snap.gloveMode === 'zombie');
    this.gloveLabelEl.textContent =
      hasGloveHeld ? '' : snap.gloveCooldownLeft > 0.1 ? `${Math.ceil(snap.gloveCooldownLeft)}s` : '';

    this.timeStopBtn.classList.toggle('active', snap.timeStopActive);
    this.timeStopBtn.classList.toggle('timestop-on', snap.timeStopActive);
    this.timeStopBtn.textContent = snap.timeStopActive ? '时停中' : '时停';

    this.hammerBtn.classList.toggle('active', snap.hammerActive);
    this.hammerBtn.classList.toggle('cooling', snap.hammerCooldownLeft > 0.1);
    this.hammerCdEl.textContent =
      snap.hammerCooldownLeft > 0.1 ? `${Math.ceil(snap.hammerCooldownLeft)}s` : '';

    this.wheelbarrowBtn.classList.toggle('active', snap.wheelbarrowActive);
    this.wheelbarrowBtn.classList.toggle(
      'cooling',
      snap.wheelbarrowCooldownLeft > 0.1 && snap.wheelbarrowStoredPlantId === null,
    );
    this.wheelbarrowBtn.classList.toggle('has-stored', snap.wheelbarrowStoredPlantId !== null);
    if (snap.wheelbarrowStoredPlantId !== null) {
      const p = assets.getPlant(snap.wheelbarrowStoredPlantId);
      const src = `assets/portraits/plants/${p?.portrait ?? `p_${snap.wheelbarrowStoredPlantId}.webp`}`;
      if (!this.wheelbarrowHeldEl.src.endsWith(src)) this.wheelbarrowHeldEl.src = src;
      this.wheelbarrowHeldEl.style.display = 'block';
      this.wheelbarrowCdEl.textContent = '';
      this.wheelbarrowLblEl.textContent = '待放';
      this.wheelbarrowLblEl.classList.add('stored');
    } else {
      this.wheelbarrowHeldEl.style.display = 'none';
      this.wheelbarrowCdEl.textContent =
        snap.wheelbarrowCooldownLeft > 0.1 ? `${Math.ceil(snap.wheelbarrowCooldownLeft)}s` : '';
      this.wheelbarrowLblEl.textContent = '手推车';
      this.wheelbarrowLblEl.classList.remove('stored');
    }

    this.fertilizerBtn.classList.toggle('active', snap.fertilizerActive);
    this.fertilizerBtn.classList.toggle('cooling', snap.fertilizerCharges <= 0);
    this.fertilizerCountEl.textContent = `×${snap.fertilizerCharges}`;
    if (snap.fertilizerCharges >= 5) {
      this.fertilizerTimerEl.style.display = 'none';
    } else {
      this.fertilizerTimerEl.style.display = 'inline-block';
      this.fertilizerTimerEl.textContent = `${snap.fertilizerNextSec}s`;
    }

    let hintText = '';
    let hintBtn = '';
    if (snap.shovelActive) {
      hintText = '铲子：点击草坪上的植物将其铲除';
      hintBtn = '取消';
    } else if (snap.gloveActive && snap.gloveHoldingName) {
      hintText = `植物手套已拿起【${snap.gloveHoldingName}】：点击目标格放置或融合`;
    } else if (snap.gloveActive && snap.gloveHoldingZombieName) {
      hintText = `僵尸手套已抓住【${snap.gloveHoldingZombieName}】：点击目标格放回`;
    } else if (snap.gloveActive && snap.gloveMode === 'plant') {
      hintText = '植物手套：点击植物拿起移动或融合（点「植手⇄」或按 V 切换僵尸手套）';
      hintBtn = '取消';
    } else if (snap.gloveActive && snap.gloveMode === 'zombie') {
      hintText = '僵尸手套：点击场上普通或魅惑僵尸抓取换行（首领免疫）';
      hintBtn = '取消';
    } else if (snap.hammerActive) {
      hintText = '大锤：点击僵尸密集处砸下百万范围伤害（首领 5000）';
      hintBtn = '取消';
    } else if (snap.wheelbarrowActive && snap.wheelbarrowStoredPlantName) {
      hintText = `手推车已暂存【${snap.wheelbarrowStoredPlantName}】：点击目标格放下或融合（重置技能冷却）`;
      hintBtn = '暂不放';
    } else if (snap.wheelbarrowActive) {
      hintText = '手推车：点击 1 株植物暂存车内（不触发亡语，放下时重置冷却）';
      hintBtn = '取消';
    } else if (snap.fertilizerActive) {
      hintText = '肥料：点击有植物的格子恢复满血、解冻并立即结束蓄力/消化冷却';
      hintBtn = '取消';
    } else if (snap.timeStopActive) {
      hintText = '时停已开启（全局 0.2 倍慢速，便于精细融合操作）';
      hintBtn = '关闭时停';
    }
    if (hintText) {
      this.toolHintTextEl.textContent = hintText;
      this.toolHintEl.style.display = 'flex';
      if (hintBtn) {
        this.toolHintCancelBtn.textContent = hintBtn;
        this.toolHintCancelBtn.style.display = 'inline-flex';
      } else {
        this.toolHintCancelBtn.style.display = 'none';
      }
    } else {
      this.toolHintEl.style.display = 'none';
    }

    if (this.maLiangPad) {
      this.maLiangPad.updateInk(snap.maliangInk);
    }

    if (snap.activeBoss) {
      this.bossBarEl.style.display = 'flex';
      const bossSrc = `assets/portraits/zombies/${snap.activeBoss.portrait}`;
      if (!this.bossPortEl.src.endsWith(bossSrc)) this.bossPortEl.src = bossSrc;
      this.bossNameEl.textContent = snap.activeBoss.name;
      const hpPct = Math.max(0, Math.min(100, (snap.activeBoss.hp / Math.max(1, snap.activeBoss.maxHp)) * 100));
      const armorPct = snap.activeBoss.armorMax > 0
        ? Math.max(0, Math.min(100, (snap.activeBoss.armor / snap.activeBoss.armorMax) * 100))
        : 0;
      this.bossHpFillEl.style.width = `${hpPct}%`;
      this.bossArmorFillEl.style.width = `${armorPct}%`;
      this.bossNumsEl.textContent = `${snap.activeBoss.hp}/${snap.activeBoss.maxHp}${snap.activeBoss.armor > 0 ? ` +护盾${snap.activeBoss.armor}` : ''}`;
    } else {
      this.bossBarEl.style.display = 'none';
    }

    if (snap.towerMode) {
      this.modeBadgeEl.style.display = 'inline-flex';
      this.modeBadgeEl.textContent = `🏰 生命 ${snap.towerLivesLeft}/${snap.towerLivesMax}`;
    } else if (snap.stackerMode) {
      this.modeBadgeEl.style.display = 'inline-flex';
      this.modeBadgeEl.textContent = '📚 叠叠乐模式';
    } else if (this.deps.config.scene.snow) {
      this.modeBadgeEl.style.display = 'inline-flex';
      this.modeBadgeEl.textContent = '❄️ 雪原温控 (火炬/向日葵解冻)';
    } else {
      this.modeBadgeEl.style.display = 'none';
    }

    this.speedBtn.textContent = `${snap.speed}x`;
    this.speedBtn.classList.toggle('active', snap.speed > 1);
    this.autoBtn.classList.toggle('active', snap.autoCollect);
    const muted = audio.isMuted();
    this.muteBtn.textContent = muted ? '静音' : '声音';
    this.muteBtn.classList.toggle('muted', muted);

    const pct = Math.round(snap.waveProgress * 100);
    this.waveFillEl.style.width = `${pct}%`;
    this.waveHeadEl.style.right = `${Math.max(4, pct * 1.1)}px`;

    if (snap.izMode) {
      this.waveTextEl.textContent = `大脑 ${snap.izBrainsLeft}/${snap.izBrainsTotal}`;
      this.statsEl.textContent = `太阳 ${snap.sun} · 已吃 ${snap.izBrainsTotal - snap.izBrainsLeft}/${snap.izBrainsTotal}`;
    } else if (snap.vaseMode) {
      this.waveTextEl.textContent = `🏺 剩余罐子 ${snap.vasesLeft}/${snap.vasesTotal}`;
      this.statsEl.textContent = `已砸 ${snap.vasesTotal - snap.vasesLeft}/${snap.vasesTotal} · 击杀 ${snap.kills}`;
    } else {
      this.waveTextEl.textContent =
        this.deps.config.mode === 'sandbox'
          ? `沙盒 · 击杀 ${snap.kills}`
          : snap.endlessRound > 0
            ? `第 ${snap.endlessRound} 轮 · 波次 ${snap.wave}/${snap.maxWaves}`
            : `波次 ${snap.wave}/${snap.maxWaves}`;
      this.statsEl.textContent = `击杀 ${snap.kills} · 融合 ${snap.fusions}`;
    }

    if (snap.finalWaveVisible) {
      this.waveAlertEl.innerHTML = `<img src="assets/ui/finalwave.webp" alt="最后一波" />`;
      this.waveAlertEl.style.display = 'flex';
    } else if (snap.hugeWaveVisible) {
      this.waveAlertEl.innerHTML = `<img src="assets/ui/hugewave.webp" alt="一大波僵尸正在接近" />`;
      this.waveAlertEl.style.display = 'flex';
    } else {
      this.waveAlertEl.style.display = 'none';
    }
  }

  private syncConveyorTrack(snap: HudSnapshot): void {
    const activeUids = new Set(snap.conveyorCards.map((c) => c.uid));
    for (const [uid, btn] of this.conveyorElMap.entries()) {
      if (!activeUids.has(uid)) {
        btn.remove();
        this.conveyorElMap.delete(uid);
      }
    }

    const sceneStyle = this.deps.config.scene.cardStyle;
    snap.conveyorCards.forEach((c, idx) => {
      let btn = this.conveyorElMap.get(c.uid);
      if (!btn) {
        const p = assets.getPlant(c.plantId);
        const frame = getCardFrameUrl(p, sceneStyle);
        btn = document.createElement('button');
        btn.className = 'pvz-packet bh-conv-card';
        btn.dataset.convUid = String(c.uid);
        btn.title = `${p?.name ?? ''} (传送带免阳光)`;
        btn.innerHTML = `
          <img class="pkt-frame" src="${frame}" alt="" />
          <img class="pkt-portrait" src="assets/portraits/plants/${p?.portrait ?? `p_${c.plantId}.webp`}" alt="" />
        `;
        btn.addEventListener('click', () => {
          const curIdx = this.deps.board
            .getSnapshot()
            .conveyorCards.findIndex((item) => item.uid === c.uid);
          if (curIdx >= 0) {
            this.deps.board.setSelectedCard(curIdx);
          }
        });
        this.conveyorTrack.appendChild(btn);
        this.conveyorElMap.set(c.uid, btn);
      }
      btn.style.left = `${Math.round(c.progress * 88 * 10) / 10}%`;
      btn.classList.toggle('selected', idx === snap.selectedCardIndex);
    });
  }

  private rebuildIzButtons(snap: HudSnapshot): void {
    this.izCardEls = [];
    this.cardsEl.innerHTML = '';
    snap.izZombieCards.forEach((c, idx) => {
      const z = assets.getZombie(c.zombieId);
      const btn = document.createElement('button');
      btn.className = 'bh-iz-card';
      btn.title = `${z?.name ?? ''} (${c.cost} 阳光) [${idx < 9 ? idx + 1 : 0}]`;
      btn.innerHTML = `
        <img class="iz-frame" src="assets/ui/almanac_zombie_window.webp" alt="" />
        <img class="iz-port" src="assets/portraits/zombies/${z?.portrait || `z_${c.zombieId}.webp`}" alt="" />
        <span class="iz-cost">${c.cost}</span>
      `;
      btn.addEventListener('click', () => this.deps.board.setSelectedCard(idx));
      this.cardsEl.appendChild(btn);
      this.izCardEls.push({ btn, zombieId: c.zombieId });
    });
  }

  private rebuildCardButtons(snap: HudSnapshot): void {
    this.cardEls = [];
    this.cardsEl.innerHTML = '';
    const sceneStyle = this.deps.config.scene.cardStyle;
    snap.cards.forEach((c, idx) => {
      const p = assets.getPlant(c.plantId);
      const frame = getCardFrameUrl(p, sceneStyle);
      const btn = document.createElement('button');
      btn.className = `pvz-packet in-hud${c.isSubCard ? ' sub-card' : ''}`;
      btn.title = `${p?.name ?? ''}${c.isSubCard ? ' [副卡]' : ''} (${c.cost}) [${idx < 9 ? idx + 1 : 0}]`;
      btn.innerHTML = `
        <img class="pkt-frame" src="${frame}" alt="" />
        <img class="pkt-portrait" src="assets/portraits/plants/${p?.portrait ?? `p_${c.plantId}.webp`}" alt="" />
        ${c.isSubCard ? '<span class="pkt-sub-badge">副</span>' : ''}
        <span class="pkt-cost">${c.cost}</span>
        <div class="bh-card-cd"></div>
      `;
      btn.addEventListener('click', () => this.deps.board.setSelectedCard(idx));
      this.cardsEl.appendChild(btn);
      this.cardEls.push({
        btn,
        cdEl: btn.querySelector('.bh-card-cd')!,
        plantId: c.plantId,
      });
    });
  }

  showFusionToast(parentA: PlantDef, parentB: PlantDef, result: PlantDef): void {
    const el = document.createElement('div');
    el.className = 'bh-toast';
    el.innerHTML = `✨ 融合成功：<span>${escHtml(parentA.name)}</span> + <span>${escHtml(parentB.name)}</span> → <strong>${escHtml(result.name)}</strong>`;
    this.toastContainer.appendChild(el);
    setTimeout(() => {
      el.classList.add('fade-out');
      setTimeout(() => el.remove(), 350);
    }, 2400);
  }

  private showBuffsModal(): void {
    const labels = this.deps.config.modifiers?.activeBuffLabels ?? [];
    const listHtml =
      labels.length > 0
        ? labels.map((l) => `<div class="bh-buff-row">${escHtml(l)}</div>`).join('')
        : '<div class="bh-buff-row">暂无额外词条加成。</div>';
    this.modalHost.innerHTML = `
      <div class="pvz-modal-backdrop">
        <div class="pvz-tomb-dialog">
          <img class="pvz-tomb-bg" src="assets/ui/options_menuback.webp" alt="" />
          <div class="pvz-tomb-inner">
            <div class="pvz-tomb-hdr">本局生效词条 (${labels.length})</div>
            <div class="help-text">${listHtml}</div>
            <button class="pvz-tomb-done-btn" id="bm-resume">
              <img src="assets/ui/options_backtogame.webp" data-base="assets/ui/options_backtogame.webp" data-hl="assets/ui/options_backtogame_hl.webp" alt="继续游戏" />
              <span>继续游戏</span>
            </button>
          </div>
        </div>
      </div>
    `;
    bindHoverImages(this.modalHost);
    this.modalHost.querySelector('#bm-resume')?.addEventListener('click', () => {
      this.modalHost.innerHTML = '';
      this.deps.board.setPaused(false);
    });
  }

  private showToolsHelpModal(): void {
    this.modalHost.innerHTML = `
      <div class="pvz-modal-backdrop">
        <div class="pvz-tomb-dialog">
          <img class="pvz-tomb-bg" src="assets/ui/options_menuback.webp" alt="" />
          <div class="pvz-tomb-inner">
            <div class="pvz-tomb-hdr">战斗工具与快捷键说明</div>
            <div class="help-text">
              <p><strong>铲子 (Q)</strong>：铲除场上植物，无冷却。</p>
              <p><strong>植物 / 僵尸手套 (E · 点「植手⇄」或 V 切换)</strong>：移动植物（密植/载体/飞行类仅 1/3 冷却）或抓取普通/魅惑僵尸换行（首领免疫，冷却 30s / 魅惑 15s）。</p>
              <p><strong>大锤 (H)</strong>：60 秒冷却，对小范围僵尸造成百万重击（首领 5000）。</p>
              <p><strong>手推车 (B)</strong>：暂存 1 株植物进车内且不触发生成/亡语；再次放下时保留血量并重置技能/属性冷却，随后进入 30 秒冷却（不能收纳机械坚果）。</p>
              <p><strong>肥料 (F)</strong>：每 70 秒自动补充 1 袋（上限 5），恢复本格满血、解冻并立即结束地雷/吞咽/磁石等蓄力冷却。</p>
              <p><strong>时停 (T)</strong>：切换全局 0.2 倍慢速，方便精准操作与极限融合。</p>
              <p><strong>其它快捷</strong>：<code>1-9/0</code> 选卡 · <code>Space</code> 暂停 · <code>右键</code> 取消选中。</p>
            </div>
            <button class="pvz-tomb-done-btn" id="thm-resume">
              <img src="assets/ui/options_backtogame.webp" data-base="assets/ui/options_backtogame.webp" data-hl="assets/ui/options_backtogame_hl.webp" alt="返回游戏" />
              <span>返回游戏</span>
            </button>
          </div>
        </div>
      </div>
    `;
    bindHoverImages(this.modalHost);
    this.modalHost.querySelector('#thm-resume')?.addEventListener('click', () => {
      this.modalHost.innerHTML = '';
      this.deps.board.setPaused(false);
    });
  }

  private showTipsModal(): void {
    const txt = formatUnityRichText(this.deps.config.tips) || '暂无额外提示。';
    this.modalHost.innerHTML = `
      <div class="pvz-modal-backdrop">
        <div class="pvz-tomb-dialog">
          <img class="pvz-tomb-bg" src="assets/ui/options_menuback.webp" alt="" />
          <div class="pvz-tomb-inner">
            <div class="pvz-tomb-hdr">本关机制提示</div>
            <div class="help-text">${escHtml(txt).replace(/\n/g, '<br/>')}</div>
            <button class="pvz-tomb-done-btn" id="tm-resume">
              <img src="assets/ui/options_backtogame.webp" data-base="assets/ui/options_backtogame.webp" data-hl="assets/ui/options_backtogame_hl.webp" alt="继续游戏" />
              <span>继续游戏</span>
            </button>
          </div>
        </div>
      </div>
    `;
    bindHoverImages(this.modalHost);
    this.modalHost.querySelector('#tm-resume')?.addEventListener('click', () => {
      this.modalHost.innerHTML = '';
      this.deps.board.setPaused(false);
    });
  }

  private showPauseModal(): void {
    const p = saveManager.current;
    const isEndless = Boolean(this.deps.config.endless);
    this.modalHost.innerHTML = `
      <div class="pvz-modal-backdrop">
        <div class="pvz-tomb-dialog pause">
          <img class="pvz-tomb-bg" src="assets/ui/options_menuback.webp" alt="" />
          <div class="pvz-tomb-inner col-btns opts-body">
            <div class="pvz-tomb-hdr">游戏暂停</div>
            <label class="opt-row">
              <span>音乐音量</span>
              <input id="pm-bgm" type="range" min="0" max="100" value="${Math.round(p.musicVolume * 100)}" />
            </label>
            <label class="opt-row">
              <span>音效音量</span>
              <input id="pm-sfx" type="range" min="0" max="100" value="${Math.round(p.soundVolume * 100)}" />
            </label>
            <button class="btn-wood-big" id="pm-almanac">查看图鉴</button>
            <button class="btn-wood-big" id="pm-restart">重新开始本关</button>
            ${isEndless ? '<button class="btn-wood-big gold" id="pm-settle">结算当前无尽记录</button>' : ''}
            <button class="btn-wood-big" id="pm-levels">返回关卡选择</button>
            <button class="btn-wood-big" id="pm-menu">返回主菜单</button>
            <button class="pvz-tomb-done-btn" id="pm-resume">
              <img src="assets/ui/options_backtogame.webp" data-base="assets/ui/options_backtogame.webp" data-hl="assets/ui/options_backtogame_hl.webp" alt="返回游戏" />
              <span>返回游戏</span>
            </button>
          </div>
        </div>
      </div>
    `;
    bindHoverImages(this.modalHost);
    const syncAudio = () => {
      const bgm = Number(this.modalHost.querySelector<HTMLInputElement>('#pm-bgm')?.value ?? 55) / 100;
      const sfx = Number(this.modalHost.querySelector<HTMLInputElement>('#pm-sfx')?.value ?? 85) / 100;
      saveManager.update({ musicVolume: bgm, soundVolume: sfx });
    };
    this.modalHost.querySelector('#pm-bgm')?.addEventListener('input', syncAudio);
    this.modalHost.querySelector('#pm-sfx')?.addEventListener('input', syncAudio);
    this.modalHost.querySelector('#pm-almanac')?.addEventListener('click', () => {
      this.modalHost.innerHTML = '';
      this.deps.onOpenAlmanac();
    });
    this.modalHost.querySelector('#pm-settle')?.addEventListener('click', () => {
      this.modalHost.innerHTML = '';
      this.deps.board.finishEndlessAndSettle();
    });
    this.modalHost.querySelector('#pm-resume')?.addEventListener('click', () => {
      this.modalHost.innerHTML = '';
      this.deps.board.setPaused(false);
    });
    this.modalHost.querySelector('#pm-restart')?.addEventListener('click', () => this.deps.onRestart());
    this.modalHost.querySelector('#pm-levels')?.addEventListener('click', () => this.deps.onExitToLevels());
    this.modalHost.querySelector('#pm-menu')?.addEventListener('click', () => this.deps.onExitToMenu());
  }

  showEndModal(
    won: boolean,
    stats: { kills: number; fusions: number; elapsedSec: number; wavesCleared: number },
    newlyUnlocked: number[] = [],
  ): void {
    const isIz = this.deps.config.mode === 'iz';
    const isVase = this.deps.config.mode === 'vasebreaker';
    const hdr = isIz
      ? won
        ? '🧠 大脑全部吃光！破阵成功'
        : '💀 阳光耗尽，破阵失败'
      : isVase
        ? won
          ? '🏺 罐子全部击碎！闯关胜利'
          : '💀 僵尸吃掉了你的脑子'
        : won
          ? '🏆 关卡胜利！'
          : '💀 僵尸吃掉了你的脑子';

    const canNext = Boolean(won && this.deps.hasNextLevel && this.deps.onNextLevel);
    const nextLabel = this.deps.customNextLabel ?? '下一关';
    const backLabel = this.deps.customExitLabel ?? (this.deps.fromMainMenu ? '返回主菜单' : '返回选关');
    const unlockedHtml =
      won && newlyUnlocked.length > 0
        ? `<div class="bh-unlock-banner">
            <div class="bh-unlock-title">🎉 解锁新植物</div>
            <div class="bh-unlock-list">
              ${newlyUnlocked
                .map((pid) => {
                  const p = assets.getPlant(pid);
                  if (!p) return '';
                  return `<div class="bh-unlock-item"><img src="assets/portraits/plants/${p.portrait}" alt="${escHtml(p.name)}" /><span>${escHtml(p.name)}</span></div>`;
                })
                .join('')}
            </div>
          </div>`
        : '';

    this.modalHost.innerHTML = `
      <div class="pvz-modal-backdrop">
        <div class="pvz-tomb-dialog end-modal">
          <img class="pvz-tomb-bg" src="assets/ui/options_menuback.webp" alt="" />
          <div class="pvz-tomb-inner">
            <div class="pvz-tomb-hdr">${hdr}</div>
            <div class="bh-end-hero ${unlockedHtml ? 'has-unlock' : ''}">
              <img class="${won ? 'bh-trophy-img' : 'bh-gameover-img'}" src="assets/ui/${won ? 'trophy.webp' : 'gameover.webp'}" alt="" />
              ${unlockedHtml}
            </div>
            <div class="bh-end-stats">
              <div>${isIz ? '植物阵' : isVase ? '破罐' : '波次'}：<strong>${isVase ? `${this.deps.config.vasebreakerConfig?.vases.length ?? 0}` : stats.wavesCleared}</strong></div>
              <div>击杀：<strong>${stats.kills}</strong></div>
              <div>融合：<strong>${stats.fusions}</strong></div>
              <div>耗时：<strong>${stats.elapsedSec}s</strong></div>
            </div>
            <div class="bh-end-sec-row">
              ${canNext ? '<button class="btn-wood-big" id="em-retry">再玩一次</button>' : ''}
              <button class="btn-wood-big" id="em-levels">${escHtml(backLabel)}</button>
            </div>
            <button class="pvz-tomb-done-btn" id="${canNext ? 'em-next' : 'em-retry'}">
              <img src="assets/ui/options_backtogame.webp" data-base="assets/ui/options_backtogame.webp" data-hl="assets/ui/options_backtogame_hl.webp" alt="${escHtml(canNext ? nextLabel : '再玩一次')}" />
              <span>${escHtml(canNext ? nextLabel : '再玩一次')}</span>
            </button>
          </div>
        </div>
      </div>
    `;
    bindHoverImages(this.modalHost);
    this.modalHost.querySelector('#em-next')?.addEventListener('click', () => {
      this.deps.onNextLevel?.();
    });
    this.modalHost.querySelector('#em-retry')?.addEventListener('click', () => this.deps.onRestart());
    this.modalHost.querySelector('#em-levels')?.addEventListener('click', () => {
      if (this.deps.fromMainMenu) this.deps.onExitToMenu();
      else this.deps.onExitToLevels();
    });
  }

  destroy(): void {
    window.removeEventListener('keydown', this.keyHandler);
    this.maLiangPad?.destroy();
    this.maLiangPad = null;
    this.conveyorElMap.clear();
    this.host.innerHTML = '';
  }
}
