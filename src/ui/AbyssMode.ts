import { assets } from '../assets/AssetLoader';
import { audio } from '../audio/AudioManager';
import { makeDefaultAbyss, saveManager } from '../save/SaveManager';
import type { BattleModifiers, BoardConfig } from '../types/game';
import { escHtml, getCardFrameUrl, getGroundThumbUrl, getPlayablePlants } from './levelsCatalog';

export interface AbyssModeDeps {
  onBack: () => void;
  onStartBattle: (config: BoardConfig) => void;
}

export interface AbyssBuffSpec {
  minStage: number;
  id: string;
  name: string;
  desc: string;
  apply: (m: BattleModifiers) => void;
}

export const ABYSS_ZOMBIE_BUFFS: AbyssBuffSpec[] = [
  {
    minStage: 2,
    id: 'aby_hp1',
    name: '深渊侵蚀 I',
    desc: '第 2 层起生效：敌方僵尸生命值 +25%',
    apply: (m) => {
      m.zombieHpBonusMult = (m.zombieHpBonusMult ?? 1) * 1.25;
    },
  },
  {
    minStage: 4,
    id: 'aby_spd1',
    name: '迅捷阴影',
    desc: '第 4 层起生效：敌方僵尸行进速度 +15%',
    apply: (m) => {
      m.zombieSpeedBonusMult = (m.zombieSpeedBonusMult ?? 1) * 1.15;
    },
  },
  {
    minStage: 6,
    id: 'aby_arm1',
    name: '幽冥铁甲',
    desc: '第 6 层起生效：敌方僵尸护甲耐久 +45%',
    apply: (m) => {
      m.zombieArmorMult = (m.zombieArmorMult ?? 1) * 1.45;
    },
  },
  {
    minStage: 8,
    id: 'aby_hp2',
    name: '深渊侵蚀 II',
    desc: '第 8 层起生效：敌方僵尸生命值额外 +35%',
    apply: (m) => {
      m.zombieHpBonusMult = (m.zombieHpBonusMult ?? 1) * 1.35;
    },
  },
  {
    minStage: 10,
    id: 'aby_spd2',
    name: '虚空狂潮',
    desc: '第 10 层起生效：敌方僵尸移动速度再提升 +20%',
    apply: (m) => {
      m.zombieSpeedBonusMult = (m.zombieSpeedBonusMult ?? 1) * 1.2;
    },
  },
  {
    minStage: 12,
    id: 'aby_doom',
    name: '秘境支配者',
    desc: '第 12 层起生效：僵尸血量 +40% 且护甲 +40%（同时我方阳光收益 +30%）',
    apply: (m) => {
      m.zombieHpBonusMult = (m.zombieHpBonusMult ?? 1) * 1.4;
      m.zombieArmorMult = (m.zombieArmorMult ?? 1) * 1.4;
      m.sunGainMult = (m.sunGainMult ?? 1) * 1.3;
    },
  },
];

const ABYSS_STAGE_META: {
  sid: number;
  label: string;
  waves: number;
  zombies: number[];
  iconPid: number;
  elite?: boolean;
}[] = [
  { sid: 0, label: '第 1 层 · 林间初探', waves: 6, zombies: [0, 2, 3, 4], iconPid: 0 },
  { sid: 1, label: '第 2 层 · 幽夜微光', waves: 7, zombies: [0, 2, 4, 7, 8], iconPid: 6 },
  { sid: 2, label: '第 3 层 · 碧波秘沼', waves: 8, zombies: [0, 4, 12, 17, 19], iconPid: 12 },
  { sid: 3, label: '第 4 层 · 迷雾深处', waves: 8, zombies: [0, 4, 17, 24, 25], iconPid: 23 },
  { sid: 4, label: '第 5 层 · 暮色高台 [首领]', waves: 10, zombies: [0, 4, 15, 26, 31, 35], iconPid: 32, elite: true },
  { sid: 6, label: '第 6 层 · 六路试炼', waves: 10, zombies: [0, 2, 4, 5, 8, 9, 24], iconPid: 14 },
  { sid: 7, label: '第 7 层 · 暗夜狂想', waves: 10, zombies: [0, 4, 8, 10, 15, 24, 35], iconPid: 7 },
  { sid: 22, label: '第 8 层 · 浊流狂澜', waves: 12, zombies: [0, 4, 14, 17, 19, 20, 35], iconPid: 16 },
  { sid: 18, label: '第 9 层 · 冰原断崖', waves: 12, zombies: [0, 4, 16, 18, 228, 35], iconPid: 36 },
  { sid: 40, label: '第 10 层 · 永夜寒宫 [首领]', waves: 12, zombies: [0, 4, 16, 18, 21, 35, 36], iconPid: 904, elite: true },
  { sid: 21, label: '第 11 层 · 倒影裂隙', waves: 14, zombies: [0, 4, 14, 19, 20, 25, 35], iconPid: 19 },
  { sid: 34, label: '第 12 层 · 星夜屋池', waves: 14, zombies: [0, 4, 15, 24, 26, 31, 35, 36], iconPid: 909 },
  { sid: 3, label: '第 13 层 · 混沌浓雾', waves: 14, zombies: [0, 8, 9, 24, 25, 26, 35, 36], iconPid: 913 },
  { sid: 18, label: '第 14 层 · 绝境冰渊', waves: 15, zombies: [0, 4, 18, 21, 24, 35, 36, 228], iconPid: 914 },
  { sid: 40, label: '第 15 层 · 深渊终焉 [终极]', waves: 16, zombies: [0, 4, 9, 14, 18, 21, 24, 35, 36, 228], iconPid: 300, elite: true },
];

export function computeAbyssModifiers(stage: number): BattleModifiers {
  const m: BattleModifiers = {
    zombieHpBonusMult: 1,
    zombieSpeedBonusMult: 1,
    zombieArmorMult: 1,
    sunGainMult: 1,
    activeBuffLabels: [],
  };
  for (const b of ABYSS_ZOMBIE_BUFFS) {
    if (stage >= b.minStage) {
      b.apply(m);
      m.activeBuffLabels!.push(`💀 ${b.name}：${b.desc}`);
    }
  }
  return m;
}

export function buildAbyssStageBoardConfig(
  stage: number,
  warehouse: number[],
  difficulty: number,
): BoardConfig {
  const idx = Math.max(0, Math.min(ABYSS_STAGE_META.length - 1, stage - 1));
  const spec = ABYSS_STAGE_META[idx];
  const scene = assets.getScene(spec.sid) ?? assets.getScene(0)!;
  const rewardCoins = 150 + stage * 30;
  return {
    mode: 'abyss',
    levelKey: `abyss-stage-${stage}`,
    title: `冒险秘境 · ${spec.label}`,
    subtitle: `${scene.label} · 通关赏金 ${rewardCoins} 星币`,
    scene,
    initialSun: 250 + Math.min(250, stage * 20),
    maxWaves: spec.waves,
    firstWaveDelay: 10,
    allowedZombies: spec.zombies,
    prePlants: [],
    presetCards: warehouse.length > 0 ? [...warehouse] : [0, 1, 2, 3, 6, 13],
    restrictToPresetCards: true,
    gloveCooldown: 8,
    difficulty: Math.min(5, Math.max(difficulty, stage >= 8 ? 3 : difficulty)),
    zombieHpMult: 1 + idx * 0.08,
    zombieSpeedMult: 1,
    modifiers: computeAbyssModifiers(stage),
    abyssStage: stage,
    tips: `冒险秘境仅可使用【植物仓库】中抽取到的植物（可在秘境大厅抽取扩展阵容）。当前仓库共有 ${warehouse.length} 种植物！`,
  };
}

interface DrawResult {
  plantId: number;
  tier: 'common' | 'fusion' | 'ultimate';
  isDuplicate: boolean;
  refundCoins: number;
}

/**
 * Native PvZ Fusion `AbyssMenu` (神秘模式 / 冒险秘境) roguelike gacha expedition:
 * 15 escalating stages, Warehouse deck restriction, weighted Plant Gacha Lottery,
 * escalating Abyss Zombie Buffs viewer, and two-step Run Reset.
 */
export class AbyssMode {
  private readonly uiRoot: HTMLElement;
  private readonly deps: AbyssModeDeps;

  private modalEl: HTMLElement | null = null;
  private resetConfirm = false;

  constructor(uiRoot: HTMLElement, deps: AbyssModeDeps) {
    this.uiRoot = uiRoot;
    this.deps = deps;
  }

  mount(): void {
    void audio.playBgm('MainMenu');
    this.render();
  }

  private render(): void {
    this.closeModal();
    const prof = saveManager.current;
    const aby = prof.abyss;
    const activeBuffs = ABYSS_ZOMBIE_BUFFS.filter((b) => aby.stage >= b.minStage);

    const cardsHtml = ABYSS_STAGE_META.map((spec, idx) => {
      const stageNum = idx + 1;
      const unlocked = prof.unlockAll || stageNum <= aby.stage;
      const cleared = stageNum < aby.stage || stageNum <= aby.bestStage;
      const isCurrent = stageNum === aby.stage;
      const pDef = assets.getPlant(spec.iconPid);
      const reward = 150 + stageNum * 30;
      return `
        <button
          class="aby-stage-card ${unlocked ? '' : 'locked'} ${cleared ? 'cleared' : ''} ${isCurrent ? 'current' : ''} ${spec.elite ? 'elite' : ''}"
          data-aby-stage="${stageNum}"
          ${unlocked ? '' : 'disabled'}
          title="${escHtml(spec.label)} · ${spec.waves} 波 · 通关奖励 ${reward} 秘境星币"
        >
          <img class="aby-sc-ground" src="${getGroundThumbUrl(spec.sid)}" alt="" />
          <img class="aby-sc-icon" src="assets/portraits/plants/${pDef?.portrait ?? 'p_0.webp'}" alt="" />
          <span class="aby-sc-num">第${stageNum}层</span>
          <span class="aby-sc-reward">+${reward}币</span>
          <div class="aby-sc-title">${escHtml(spec.label.replace(/^第\s*\d+\s*层\s*·\s*/, ''))}</div>
          ${!unlocked ? '<img class="aby-sc-lock" src="assets/ui/lock.webp" alt="未解锁" />' : cleared ? '<img class="aby-sc-trophy" src="assets/ui/minigame_trophy.webp" alt="已通关" />' : ''}
        </button>
      `;
    }).join('');

    this.uiRoot.innerHTML = `
      <div class="aby-screen" style="background-image:url('assets/ui/challenge_bg.webp')">
        <div class="aby-topbar">
          <button class="pvz-stone-btn sm" id="aby-back">
            <img src="assets/ui/buttonsmall.webp" alt="" />
            <span>返回菜单</span>
          </button>

          <div class="aby-title-wrap">
            <div class="aby-title">冒险秘境 · 当前第 ${aby.stage} 层</div>
            <div class="aby-sub">最高纪录：第 ${aby.bestStage} 层 · 仓库 ${aby.warehouse.length} 株植物 · 生效词条 ${activeBuffs.length} 条</div>
          </div>

          <div class="aby-coin-pill">
            <img src="assets/ui/modes/diamond_ticket.webp" alt="" />
            <span>星币 <strong id="aby-coin-val">${aby.coins}</strong></span>
          </div>
        </div>

        <div class="aby-grid">${cardsHtml}</div>

        <div class="aby-footer">
          <button class="btn-wood-big gold" id="aby-lottery">🎲 植物抽奖</button>
          <button class="btn-wood-big" id="aby-storage">📦 植物仓库 (${aby.warehouse.length})</button>
          <button class="btn-wood-big" id="aby-buffs">💀 僵尸词条 (${activeBuffs.length})</button>
          <button class="btn-wood-big danger" id="aby-reset">${this.resetConfirm ? '⚠ 确认重置秘境?' : '🔄 重置秘境'}</button>
        </div>
      </div>
    `;

    this.uiRoot.querySelector('#aby-back')?.addEventListener('click', () => {
      audio.playSfx('ButtonClick', 0.8, 40);
      this.deps.onBack();
    });

    this.uiRoot.querySelectorAll<HTMLButtonElement>('[data-aby-stage]').forEach((b) => {
      b.addEventListener('click', () => {
        const stage = Number(b.dataset.abyStage);
        audio.playSfx('GraveButton', 0.85, 50);
        const curAby = saveManager.current.abyss;
        this.deps.onStartBattle(
          buildAbyssStageBoardConfig(stage, curAby.warehouse, saveManager.current.difficulty),
        );
      });
    });

    this.uiRoot.querySelector('#aby-lottery')?.addEventListener('click', () => {
      audio.playSfx('ButtonClick', 0.8, 40);
      this.openLotteryModal([]);
    });

    this.uiRoot.querySelector('#aby-storage')?.addEventListener('click', () => {
      audio.playSfx('ButtonClick', 0.8, 40);
      this.openWarehouseModal();
    });

    this.uiRoot.querySelector('#aby-buffs')?.addEventListener('click', () => {
      audio.playSfx('ButtonClick', 0.8, 40);
      this.openBuffsModal();
    });

    this.uiRoot.querySelector('#aby-reset')?.addEventListener('click', () => {
      if (!this.resetConfirm) {
        this.resetConfirm = true;
        audio.playSfx('Tap', 0.75, 40);
        this.render();
        return;
      }
      this.resetConfirm = false;
      const fresh = makeDefaultAbyss();
      fresh.bestStage = saveManager.current.abyss.bestStage;
      saveManager.setAbyss(fresh);
      audio.playSfx('Buzzer', 0.65, 80);
      this.render();
    });
  }

  private openLotteryModal(results: DrawResult[], statusMsg = ''): void {
    this.closeModal();
    const aby = saveManager.current.abyss;

    const resultHtml =
      results.length > 0
        ? `<div class="aby-draw-results">
            ${results
              .map((r) => {
                const p = assets.getPlant(r.plantId);
                const tierLabel = r.tier === 'ultimate' ? '究极金卡' : r.tier === 'fusion' ? '高阶融合' : '经典战力';
                return `
                  <div class="aby-draw-card ${r.tier}">
                    <img class="aby-dc-frame" src="assets/ui/modes/frame_diamond.webp" alt="" />
                    <img class="aby-dc-port" src="assets/portraits/plants/${p?.portrait ?? 'p_0.webp'}" alt="" />
                    <div class="aby-dc-tier">${tierLabel}</div>
                    <div class="aby-dc-name">${escHtml(p?.name ?? '')}</div>
                    <div class="aby-dc-state">${r.isDuplicate ? `重复 +${r.refundCoins}币` : '✨ 新入仓库!'}</div>
                  </div>
                `;
              })
              .join('')}
          </div>`
        : `<div class="aby-draw-splash">
            <img src="assets/ui/modes/diamond_ticket.webp" alt="抽奖券" />
            <p>使用秘境星币抽取植物加入【秘境仓库】！</p>
            <p class="muted">概率：55% 基础植物 · 30% 融合植物 · 15% 超级/究极植物（重复返还 40 星币）</p>
          </div>`;

    const modal = document.createElement('div');
    modal.className = 'pvz-modal-backdrop';
    modal.innerHTML = `
      <div class="trv-modal-panel wide">
        <div class="trv-modal-hdr">
          <span>🎲 秘境植物补给站 · 秘境星币：<strong id="aby-lot-coins">${aby.coins}</strong></span>
          <button class="btn-wood-sm" id="aby-lot-close">返回秘境</button>
        </div>
        ${statusMsg ? `<div class="aby-lot-msg">${escHtml(statusMsg)}</div>` : ''}
        ${resultHtml}
        <div class="aby-lot-actions">
          <button class="btn-wood-big gold" id="aby-draw-1">单抽补给 (100 星币)</button>
          <button class="btn-wood-big gold" id="aby-draw-3">三连抽补给 (260 星币)</button>
        </div>
      </div>
    `;
    this.uiRoot.appendChild(modal);
    this.modalEl = modal;

    modal.querySelector('#aby-lot-close')?.addEventListener('click', () => this.render());
    modal.querySelector('#aby-draw-1')?.addEventListener('click', () => this.performDraws(1, 100));
    modal.querySelector('#aby-draw-3')?.addEventListener('click', () => this.performDraws(3, 260));
  }

  private performDraws(count: number, totalCost: number): void {
    const aby = { ...saveManager.current.abyss, warehouse: [...saveManager.current.abyss.warehouse] };
    if (aby.coins < totalCost) {
      audio.playSfx('Buzzer', 0.7, 100);
      this.openLotteryModal([], `星币不足（需要 ${totalCost} 星币，通关秘境关卡可大量获取）`);
      return;
    }

    const playable = getPlayablePlants();
    const commonPool = playable.filter((p) => p.id < 50 && !p.tags.includes('UltimatePlants'));
    const fusionPool = playable.filter((p) => p.id >= 1000 && !p.tags.includes('UltimatePlants'));
    const ultimatePool = playable.filter((p) => p.tags.includes('UltimatePlants') || (p.id >= 900 && p.id < 1000));

    aby.coins -= totalCost;
    const out: DrawResult[] = [];
    for (let i = 0; i < count; i++) {
      const roll = Math.random();
      const tier: DrawResult['tier'] = roll < 0.15 ? 'ultimate' : roll < 0.45 ? 'fusion' : 'common';
      const pool =
        tier === 'ultimate' && ultimatePool.length > 0
          ? ultimatePool
          : tier === 'fusion' && fusionPool.length > 0
            ? fusionPool
            : commonPool;
      const picked = pool[Math.floor(Math.random() * pool.length)] ?? playable[0];
      const dup = aby.warehouse.includes(picked.id);
      if (!dup) {
        aby.warehouse.push(picked.id);
      } else {
        aby.coins += 40;
      }
      out.push({ plantId: picked.id, tier, isDuplicate: dup, refundCoins: dup ? 40 : 0 });
    }

    saveManager.setAbyss(aby);
    audio.playSfx(out.some((x) => x.tier === 'ultimate') ? 'Diamond' : 'Prize', 0.9, 50);
    this.openLotteryModal(out, `成功抽取 ${count} 次！仓库现共有 ${aby.warehouse.length} 种可用植物。`);
  }

  private openWarehouseModal(): void {
    this.closeModal();
    const aby = saveManager.current.abyss;
    const sceneStyle = 'Day';

    const modal = document.createElement('div');
    modal.className = 'pvz-modal-backdrop';
    modal.innerHTML = `
      <div class="trv-modal-panel wide">
        <div class="trv-modal-hdr">
          <span>📦 冒险秘境 · 植物仓库 (${aby.warehouse.length} 种)</span>
          <button class="btn-wood-sm" id="aby-wh-close">关闭</button>
        </div>
        <div class="aby-wh-grid">
          ${aby.warehouse
            .map((pid) => {
              const p = assets.getPlant(pid);
              if (!p) return '';
              return `
                <div class="aby-wh-item" title="${escHtml(p.name)} · ${p.cost} 阳光">
                  <div class="pvz-packet in-pool">
                    <img class="pkt-frame" src="${getCardFrameUrl(p, sceneStyle)}" alt="" />
                    <img class="pkt-portrait" src="assets/portraits/plants/${p.portrait}" alt="" />
                    <span class="pkt-cost">${p.cost}</span>
                  </div>
                  <span>${escHtml(p.name)}</span>
                </div>
              `;
            })
            .join('')}
        </div>
      </div>
    `;
    this.uiRoot.appendChild(modal);
    this.modalEl = modal;
    modal.querySelector('#aby-wh-close')?.addEventListener('click', () => this.closeModal());
  }

  private openBuffsModal(): void {
    this.closeModal();
    const stage = saveManager.current.abyss.stage;
    const modal = document.createElement('div');
    modal.className = 'pvz-modal-backdrop';
    modal.innerHTML = `
      <div class="trv-modal-panel wide" style="background-image:linear-gradient(rgba(15,23,42,0.88),rgba(15,23,42,0.92)), url('assets/ui/modes/abyss_buff_bank.webp'); background-size:cover">
        <div class="trv-modal-hdr">
          <span>💀 深渊僵尸词条（当前第 ${stage} 层）</span>
          <button class="btn-wood-sm" id="aby-bf-close">关闭</button>
        </div>
        <div class="aby-buff-list">
          ${ABYSS_ZOMBIE_BUFFS.map((b) => {
            const active = stage >= b.minStage;
            return `
              <div class="aby-buff-row ${active ? 'active' : 'future'}">
                <div>
                  <strong>${active ? '✅' : '🔒'} ${escHtml(b.name)}</strong>
                  <span>${escHtml(b.desc)}</span>
                </div>
                <em>${active ? '生效中' : `第 ${b.minStage} 层激活`}</em>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
    this.uiRoot.appendChild(modal);
    this.modalEl = modal;
    modal.querySelector('#aby-bf-close')?.addEventListener('click', () => this.closeModal());
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
