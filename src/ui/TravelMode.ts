import { assets } from '../assets/AssetLoader';
import { audio } from '../audio/AudioManager';
import { saveManager } from '../save/SaveManager';
import type { BoardConfig, TravelRunState } from '../types/game';
import { bindHoverImages, escHtml, getGroundThumbUrl } from './levelsCatalog';
import {
  buildTravelRunBoardConfig,
  getTravelAdventureStages,
  getTravelBuffById,
  getTravelChallengeStages,
  getTravelGameStages,
  TRAVEL_PLANT_BUFFS,
  TRAVEL_SCENES,
  TRAVEL_STORE_ULTIMATES,
  TRAVEL_ZOMBIE_BUFFS,
  type TravelBuffDef,
  type TravelStageSpec,
} from './travelCatalog';

export interface TravelModeDeps {
  onBack: () => void;
  onStartBattle: (config: BoardConfig) => void;
}

type TravelTab = 'survival' | 'adventure' | 'game' | 'challenge';

/**
 * Native PvZ Fusion Travel Mode (`MainMenu_travel`) featuring:
 * - 21-round Classic/Inferno/Cursed Travel Survival roguelike run
 * - Plant Buffs (植物词条), Zombie Buffs (僵尸词条), and Travel Store Ultimate Recipes (究极配方)
 * - Curated Travel Adventure, Travel Game (诸神/保龄球/超级随机), and Travel Challenge stages
 */
export class TravelMode {
  private readonly uiRoot: HTMLElement;
  private readonly deps: TravelModeDeps;

  private tab: TravelTab = 'survival';
  private modalEl: HTMLElement | null = null;
  private resetConfirm = false;

  constructor(uiRoot: HTMLElement, deps: TravelModeDeps) {
    this.uiRoot = uiRoot;
    this.deps = deps;
  }

  mount(): void {
    void audio.playBgm('MainMenu');
    this.render();
    this.resumePendingRewardFlow();
  }

  private resumePendingRewardFlow(): void {
    const trv = saveManager.current.travel;
    if (trv.pendingStage === 'pick_buff') {
      this.openBuffPickModal('plant');
    } else if (trv.pendingStage === 'pick_zombie_buff') {
      this.openBuffPickModal('zombie');
    } else if (trv.pendingStage === 'store') {
      this.openTravelStoreModal();
    }
  }

  private render(): void {
    this.closeModal();
    const prof = saveManager.current;
    const trv = prof.travel;
    const launchMap = new Map<string, BoardConfig>();

    let bodyHtml = '';
    if (this.tab === 'survival') {
      bodyHtml = this.renderSurvivalBody(trv);
    } else {
      const stages =
        this.tab === 'adventure'
          ? getTravelAdventureStages(prof.difficulty)
          : this.tab === 'game'
            ? getTravelGameStages(prof.difficulty)
            : getTravelChallengeStages(prof.difficulty);
      stages.forEach((s) => launchMap.set(s.config.levelKey, s.config));
      bodyHtml = this.renderStageGrid(stages, new Set(trv.clearedTravelLevels));
    }

    this.uiRoot.innerHTML = `
      <div class="trv-screen" style="background-image:url('assets/ui/star_bg.webp')">
        <img class="ls-star-dots" src="assets/ui/star_dots.webp" alt="" />

        <div class="trv-topbar">
          <button class="pvz-stone-btn sm" id="trv-back">
            <img src="assets/ui/buttonsmall.webp" alt="" />
            <span>返回菜单</span>
          </button>

          <div class="trv-title-wrap">
            <div class="trv-title">旅行模式</div>
            <div class="trv-sub">PvZ 融合版肉鸽征程 · 词条构筑与究极进化</div>
          </div>

          <div class="trv-pts-pill">
            <span>旅行积分</span>
            <strong id="trv-pts-val">${trv.points}</strong>
          </div>
        </div>

        <div class="trv-tabs">
          <button class="trv-tab-btn ${this.tab === 'survival' ? 'active' : ''}" data-trv-tab="survival">
            <img src="assets/ui/modes/travel_levels.webp" alt="" />
            <span>经典旅行 (21轮)</span>
          </button>
          <button class="trv-tab-btn ${this.tab === 'adventure' ? 'active' : ''}" data-trv-tab="adventure">
            <img src="assets/ui/modes/travel_experiences.webp" alt="" />
            <span>旅行冒险 (7)</span>
          </button>
          <button class="trv-tab-btn ${this.tab === 'game' ? 'active' : ''}" data-trv-tab="game">
            <img src="assets/ui/modes/travel_levels.webp" alt="" />
            <span>旅行游戏 (6)</span>
          </button>
          <button class="trv-tab-btn ${this.tab === 'challenge' ? 'active' : ''}" data-trv-tab="challenge">
            <img src="assets/ui/modes/travel_experiences.webp" alt="" />
            <span>旅行挑战 (4)</span>
          </button>
        </div>

        <div class="trv-body">${bodyHtml}</div>
      </div>
    `;

    bindHoverImages(this.uiRoot);
    this.uiRoot.querySelector('#trv-back')?.addEventListener('click', () => {
      audio.playSfx('ButtonClick', 0.8, 40);
      this.deps.onBack();
    });

    this.uiRoot.querySelectorAll<HTMLButtonElement>('[data-trv-tab]').forEach((b) => {
      b.addEventListener('click', () => {
        this.tab = b.dataset.trvTab as TravelTab;
        this.resetConfirm = false;
        audio.playSfx('Tap', 0.75, 40);
        this.render();
      });
    });

    this.bindSurvivalEvents();

    this.uiRoot.querySelectorAll<HTMLButtonElement>('[data-trv-launch]').forEach((b) => {
      b.addEventListener('click', () => {
        const cfg = launchMap.get(b.dataset.trvLaunch!);
        if (cfg) {
          audio.playSfx('GraveButton', 0.85, 50);
          this.deps.onStartBattle(cfg);
        }
      });
    });
  }

  private renderSurvivalBody(trv: TravelRunState): string {
    const round = Math.max(1, Math.min(21, trv.round || 1));
    const sceneIdx = Math.floor((round - 1) / 3) % TRAVEL_SCENES.length;
    const sc = TRAVEL_SCENES[sceneIdx];
    const modeLabel =
      trv.mode === 'cursed' ? '诅咒难度' : trv.mode === 'inferno' ? '炼狱难度' : '经典旅行';
    const hpBoost = Math.round((round - 1) * (trv.mode === 'cursed' ? 32 : trv.mode === 'inferno' ? 28 : 20));

    const pBuffHtml =
      trv.plantBuffs.length > 0
        ? trv.plantBuffs
            .map((id) => {
              const b = getTravelBuffById(id);
              return b ? `<span class="trv-buff-chip plant" title="${escHtml(b.desc)}">🌿 ${escHtml(b.name)}</span>` : '';
            })
            .join('')
        : '<span class="trv-empty-txt">尚未选取植物词条（每通关 1 轮可三选一或换取 1000 积分）</span>';

    const zBuffHtml =
      trv.zombieBuffs.length > 0
        ? trv.zombieBuffs
            .map((id) => {
              const b = getTravelBuffById(id);
              return b ? `<span class="trv-buff-chip zombie" title="${escHtml(b.desc)}">🧟 ${escHtml(b.name)}</span>` : '';
            })
            .join('')
        : '<span class="trv-empty-txt">暂无僵尸词条（炼狱/诅咒难度每轮附加敌方词条）</span>';

    const ultHtml =
      trv.purchasedUltimates.length > 0
        ? trv.purchasedUltimates
            .map((pid) => {
              const p = assets.getPlant(pid);
              if (!p) return '';
              return `<div class="trv-ult-item" title="${escHtml(p.name)}"><img src="assets/portraits/plants/${p.portrait}" alt="" /><span>${escHtml(p.name)}</span></div>`;
            })
            .join('')
        : '<span class="trv-empty-txt">尚未在旅行商店购入究极配方</span>';

    return `
      <div class="trv-run-layout">
        <div class="trv-run-left">
          <div class="trv-mode-switch">
            <button class="trv-diff-pill ${trv.mode === 'classic' ? 'active' : ''}" data-trv-mode="classic">普通旅行</button>
            <button class="trv-diff-pill ${trv.mode === 'inferno' ? 'active' : ''}" data-trv-mode="inferno">炼狱难度</button>
            <button class="trv-diff-pill ${trv.mode === 'cursed' ? 'active' : ''}" data-trv-mode="cursed">诅咒难度</button>
          </div>

          <div class="trv-stage-banner" style="background-image:url('${getGroundThumbUrl(sc.sceneId)}')">
            <div class="trv-stage-overlay">
              <div class="trv-round-badge">${modeLabel} · 第 ${round}/21 轮</div>
              <div class="trv-scene-name">${escHtml(sc.label)}</div>
              <div class="trv-scene-meta">僵尸强化 +${hpBoost}% HP · 历史最高第 ${trv.bestRound} 轮</div>
            </div>
          </div>

          <div class="trv-run-actions">
            <button class="btn-wood-big gold" id="trv-start-round">出发 · 第 ${round} 轮</button>
            <button class="btn-wood-big" id="trv-open-store">旅行商店</button>
            <button class="btn-wood-big danger" id="trv-reset-run">${this.resetConfirm ? '确认重置本轮?' : '重置征程'}</button>
          </div>
        </div>

        <div class="trv-run-right">
          <div class="trv-panel-box">
            <h4>🌿 我方植物词条 (${trv.plantBuffs.length})</h4>
            <div class="trv-chip-wrap">${pBuffHtml}</div>
          </div>
          <div class="trv-panel-box">
            <h4>🧟 敌方僵尸词条 (${trv.zombieBuffs.length})</h4>
            <div class="trv-chip-wrap">${zBuffHtml}</div>
          </div>
          <div class="trv-panel-box">
            <h4>💎 已购究极植物配方 (${trv.purchasedUltimates.length})</h4>
            <div class="trv-ult-grid">${ultHtml}</div>
          </div>
        </div>
      </div>
    `;
  }

  private renderStageGrid(stages: TravelStageSpec[], cleared: Set<string>): string {
    return `
      <div class="trv-grid">
        ${stages
          .map((s) => {
            const p = assets.getPlant(s.iconPlantId);
            const icon = p?.portrait ? `assets/portraits/plants/${p.portrait}` : 'assets/portraits/plants/p_0.webp';
            const done = cleared.has(s.config.levelKey);
            return `
              <button class="trv-stage-card ${done ? 'cleared' : ''}" data-trv-launch="${escHtml(s.config.levelKey)}" title="${escHtml(s.config.tips ?? '')}">
                <img class="trv-sc-ground" src="${getGroundThumbUrl(s.sceneId)}" alt="" />
                <img class="trv-sc-icon" src="${icon}" alt="" />
                <div class="trv-sc-name">${escHtml(s.label)}</div>
                <div class="trv-sc-sub">${escHtml(s.config.subtitle ?? '')}</div>
                ${done ? '<img class="trv-sc-trophy" src="assets/ui/minigame_trophy.webp" alt="已通关" />' : ''}
              </button>
            `;
          })
          .join('')}
      </div>
    `;
  }

  private bindSurvivalEvents(): void {
    this.uiRoot.querySelectorAll<HTMLButtonElement>('[data-trv-mode]').forEach((b) => {
      b.addEventListener('click', () => {
        const mode = b.dataset.trvMode as TravelRunState['mode'];
        const trv = { ...saveManager.current.travel, mode };
        saveManager.setTravel(trv);
        audio.playSfx('Tap', 0.75, 40);
        this.render();
      });
    });

    this.uiRoot.querySelector('#trv-start-round')?.addEventListener('click', () => {
      const trv = saveManager.current.travel;
      if (trv.pendingStage === 'pick_buff') {
        this.openBuffPickModal('plant');
        return;
      }
      if (trv.pendingStage === 'pick_zombie_buff') {
        this.openBuffPickModal('zombie');
        return;
      }
      audio.playSfx('GraveButton', 0.85, 50);
      if (!trv.active) {
        saveManager.setTravel({ ...trv, active: true });
      }
      this.deps.onStartBattle(buildTravelRunBoardConfig(saveManager.current.travel, saveManager.current.difficulty));
    });

    this.uiRoot.querySelector('#trv-open-store')?.addEventListener('click', () => {
      audio.playSfx('ButtonClick', 0.8, 40);
      this.openTravelStoreModal();
    });

    this.uiRoot.querySelector('#trv-reset-run')?.addEventListener('click', () => {
      if (!this.resetConfirm) {
        this.resetConfirm = true;
        audio.playSfx('Tap', 0.75, 40);
        this.render();
        return;
      }
      this.resetConfirm = false;
      const prev = saveManager.current.travel;
      saveManager.setTravel({
        active: false,
        mode: prev.mode,
        round: 1,
        points: 500,
        plantBuffs: [],
        zombieBuffs: [],
        purchasedUltimates: [],
        pendingStage: 'battle',
        bestRound: prev.bestRound,
        clearedTravelLevels: prev.clearedTravelLevels,
      });
      audio.playSfx('Buzzer', 0.65, 80);
      this.render();
    });
  }

  private openBuffPickModal(kind: 'plant' | 'zombie'): void {
    this.closeModal();
    const trv = saveManager.current.travel;
    const pool =
      kind === 'plant'
        ? TRAVEL_PLANT_BUFFS.filter((b) => !b.shopOnly && !trv.plantBuffs.includes(b.id))
        : TRAVEL_ZOMBIE_BUFFS.filter((b) => !trv.zombieBuffs.includes(b.id));

    const sourceList = pool.length > 0 ? pool : kind === 'plant' ? TRAVEL_PLANT_BUFFS.slice(0, 3) : TRAVEL_ZOMBIE_BUFFS.slice(0, 3);
    const shuffled = [...sourceList].sort(() => Math.random() - 0.5).slice(0, 3);

    const modal = document.createElement('div');
    modal.className = 'pvz-modal-backdrop';
    modal.innerHTML = `
      <div class="trv-modal-panel">
        <div class="trv-modal-hdr">
          ${kind === 'plant' ? '🌿 过关奖励 · 请选择 1 项植物词条' : '🧟 炼狱诅咒 · 必须选择 1 项僵尸词条'}
        </div>
        <div class="trv-buff-choices">
          ${shuffled
            .map((b: TravelBuffDef) => {
              const icon = b.iconPlantId !== undefined
                ? `assets/portraits/plants/${assets.getPlant(b.iconPlantId)?.portrait ?? 'p_0.webp'}`
                : `assets/portraits/zombies/${assets.getZombie(b.iconZombieId ?? 0)?.portrait ?? 'z_0.webp'}`;
              return `
                <button class="trv-choice-card ${kind}" data-pick-buff="${b.id}">
                  <img src="${icon}" alt="" />
                  <strong>${escHtml(b.name)}</strong>
                  <span>${escHtml(b.desc)}</span>
                </button>
              `;
            })
            .join('')}
        </div>
        <div class="trv-modal-foot">
          ${
            kind === 'plant'
              ? '<button class="btn-wood-big gold" id="trv-skip-buff">放弃选取 · 领取 +1000 积分</button>'
              : '<span class="trv-empty-txt">炼狱与诅咒难度不可跳过僵尸词条</span>'
          }
        </div>
      </div>
    `;
    this.uiRoot.appendChild(modal);
    this.modalEl = modal;

    modal.querySelectorAll<HTMLButtonElement>('[data-pick-buff]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.pickBuff!;
        const cur = { ...saveManager.current.travel };
        if (kind === 'plant') {
          if (!cur.plantBuffs.includes(id)) cur.plantBuffs = [...cur.plantBuffs, id];
          cur.pendingStage = cur.mode === 'classic' ? 'battle' : 'pick_zombie_buff';
        } else {
          if (!cur.zombieBuffs.includes(id)) cur.zombieBuffs = [...cur.zombieBuffs, id];
          cur.pendingStage = 'battle';
        }
        saveManager.setTravel(cur);
        audio.playSfx('Chime', 0.85, 60);
        this.render();
        if (cur.pendingStage === 'pick_zombie_buff') {
          this.openBuffPickModal('zombie');
        }
      });
    });

    modal.querySelector('#trv-skip-buff')?.addEventListener('click', () => {
      const cur = { ...saveManager.current.travel };
      cur.points += 1000;
      cur.pendingStage = cur.mode === 'classic' ? 'battle' : 'pick_zombie_buff';
      saveManager.setTravel(cur);
      audio.playSfx('Coin', 0.85, 60);
      this.render();
      if (cur.pendingStage === 'pick_zombie_buff') {
        this.openBuffPickModal('zombie');
      }
    });
  }

  private openTravelStoreModal(): void {
    this.closeModal();
    const trv = saveManager.current.travel;
    const priceScale = trv.mode === 'cursed' ? 1.5 : 1;
    const shopBuffs = TRAVEL_PLANT_BUFFS.filter((b) => b.shopOnly);

    const modal = document.createElement('div');
    modal.className = 'pvz-modal-backdrop';
    modal.innerHTML = `
      <div class="trv-modal-panel wide">
        <div class="trv-modal-hdr">
          <span>🛒 旅行商店 · 积分：<strong id="trv-store-pts">${trv.points}</strong></span>
          <button class="btn-wood-sm" id="trv-store-close">关闭商店</button>
        </div>

        <div class="trv-store-sec">
          <h4>✨ 商店限定强化词条</h4>
          <div class="trv-store-grid">
            ${shopBuffs
              .map((b) => {
                const owned = trv.plantBuffs.includes(b.id);
                const cost = Math.round((b.shopCost ?? 1000) * priceScale);
                const port = assets.getPlant(b.iconPlantId ?? 901)?.portrait ?? 'p_901.webp';
                return `
                  <button class="trv-store-item ${owned ? 'owned' : ''}" data-buy-buff="${b.id}" data-cost="${cost}" ${owned ? 'disabled' : ''}>
                    <img src="assets/portraits/plants/${port}" alt="" />
                    <div class="trv-si-info">
                      <strong>${escHtml(b.name)}</strong>
                      <span>${escHtml(b.desc)}</span>
                    </div>
                    <span class="trv-si-price">${owned ? '已拥有' : `${cost} 积分`}</span>
                  </button>
                `;
              })
              .join('')}
          </div>
        </div>

        <div class="trv-store-sec">
          <h4>🔥 局内究极植物配方（购买后在经典旅行选卡「究极配方」栏立即可用）</h4>
          <div class="trv-store-grid">
            ${TRAVEL_STORE_ULTIMATES.map((u) => {
              const p = assets.getPlant(u.plantId);
              if (!p) return '';
              const owned = trv.purchasedUltimates.includes(u.plantId);
              const cost = Math.round(u.baseCost * priceScale);
              return `
                <button class="trv-store-item ${owned ? 'owned' : ''}" data-buy-ult="${u.plantId}" data-cost="${cost}" ${owned ? 'disabled' : ''}>
                  <img src="assets/portraits/plants/${p.portrait}" alt="" />
                  <div class="trv-si-info">
                    <strong>${escHtml(p.name)}</strong>
                    <span>${escHtml(u.tagline)}</span>
                  </div>
                  <span class="trv-si-price">${owned ? '已解锁' : `${cost} 积分`}</span>
                </button>
              `;
            }).join('')}
          </div>
        </div>
      </div>
    `;
    this.uiRoot.appendChild(modal);
    this.modalEl = modal;

    modal.querySelector('#trv-store-close')?.addEventListener('click', () => {
      if (saveManager.current.travel.pendingStage === 'store') {
        saveManager.setTravel({ ...saveManager.current.travel, pendingStage: 'battle' });
      }
      this.render();
    });

    modal.querySelectorAll<HTMLButtonElement>('[data-buy-buff]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.buyBuff!;
        const cost = Number(btn.dataset.cost);
        const cur = { ...saveManager.current.travel };
        if (cur.points < cost || cur.plantBuffs.includes(id)) {
          audio.playSfx('Buzzer', 0.7, 100);
          return;
        }
        cur.points -= cost;
        cur.plantBuffs = [...cur.plantBuffs, id];
        saveManager.setTravel(cur);
        audio.playSfx('Prize', 0.85, 60);
        this.openTravelStoreModal();
      });
    });

    modal.querySelectorAll<HTMLButtonElement>('[data-buy-ult]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const pid = Number(btn.dataset.buyUlt);
        const cost = Number(btn.dataset.cost);
        const cur = { ...saveManager.current.travel };
        if (cur.points < cost || cur.purchasedUltimates.includes(pid)) {
          audio.playSfx('Buzzer', 0.7, 100);
          return;
        }
        cur.points -= cost;
        cur.purchasedUltimates = [...cur.purchasedUltimates, pid];
        saveManager.setTravel(cur);
        audio.playSfx('Diamond', 0.85, 60);
        this.openTravelStoreModal();
      });
    });
  }

  private closeModal(): void {
    if (this.modalEl) {
      this.modalEl.remove();
      this.modalEl = null;
    }
  }

  destroy(): void {
    this.closeModal();
    this.uiRoot.innerHTML = '';
  }
}
