import { assets } from '../assets/AssetLoader';
import { audio } from '../audio/AudioManager';
import { fusionSystem } from '../engine/FusionSystem';
import {
  COLORFUL_CARD_IDS,
  getPlantUnlockHint,
  isColorfulCard,
  isNormalCard,
  NORMAL_CARD_IDS,
} from '../save/plantUnlocks';
import {
  DIFFICULTY_LEVELS,
  clampDifficulty,
  formatDifficultyBadge,
  formatDifficultyFull,
  getDifficultyInfo,
} from '../save/difficulty';
import { saveManager } from '../save/SaveManager';
import type { BoardConfig, DeckSlot, PlantDef } from '../types/game';
import {
  buildRecommendedDeck,
  escHtml,
  formatUnityRichText,
  getCardFrameUrl,
  getPlayablePlants,
} from './levelsCatalog';

export interface SeedChooserDeps {
  config: BoardConfig;
  initialDeck: DeckSlot[];
  roundLabel?: string;
  currentSun?: number;
  onDeckChange: (deck: DeckSlot[]) => void;
  onDifficultyChange?: (diff: number) => void;
  onStartBattle: () => void | Promise<void>;
  onExit: () => void;
}

const MAX_SLOTS = 12;

/**
 * Authentic PvZ Fusion Live-Lawn Seed Chooser backed by official `seed_bank.webp`,
 * `seed_chooser_bg.webp`, `seed_packet_*.webp` frames, and `seed_chooser_btn.webp`,
 * with recipe-constrained `本关配方` tab, `重选上次`, `出怪`, and multi-line `关卡提示`.
 */
export class SeedChooser {
  private readonly host: HTMLElement;
  private readonly deps: SeedChooserDeps;

  private selected: DeckSlot[];
  private tab: 'preset' | 'normal' | 'colorful' | 'discovered' | 'fused' | 'all';
  private query = '';
  private synergyHint = '';
  private highlightedIds = new Set<number>();
  private overlayMode: 'none' | 'zombies' | 'tips' = 'none';
  private starting = false;

  constructor(host: HTMLElement, deps: SeedChooserDeps) {
    this.host = host;
    this.deps = deps;
    this.selected = deps.initialDeck.slice(0, MAX_SLOTS).map((s) => ({ ...s }));
    this.tab = deps.config.restrictToPresetCards && deps.config.presetCards?.length ? 'preset' : 'normal';
  }

  mount(): void {
    this.render();
  }

  private render(): void {
    const { config, roundLabel, currentSun } = this.deps;
    const allPlayable = getPlayablePlants();
    const isFreePool = config.mode === 'sandbox' || saveManager.current.unlockAll;
    const hasPreset = Boolean(config.presetCards && config.presetCards.length > 0);
    const hasTips = Boolean(formatUnityRichText(config.tips));
    const unlockedNormalCnt = NORMAL_CARD_IDS.filter((id) => saveManager.isPlantUnlocked(id, config)).length;
    const unlockedColorfulCnt = COLORFUL_CARD_IDS.filter((id) => saveManager.isPlantUnlocked(id, config)).length;
    const discoveredCnt = allPlayable.filter(
      (p) => !isNormalCard(p.id) && !isColorfulCard(p.id) && saveManager.isPlantUnlocked(p.id, config),
    ).length;
    const hasLastDeck = saveManager.current.lastDeck.some(
      (id) => Boolean(assets.getPlant(id)) && saveManager.isPlantUnlocked(id, config),
    );
    const formattedTips = formatUnityRichText(config.tips);
    const shortTip = formattedTips.split('\n').filter(Boolean).pop() ?? '';

    const stagePrefix = roundLabel
      ? `${escHtml(roundLabel)} · `
      : config.adventureIndex
        ? `第 ${Math.floor((config.adventureIndex - 1) / 9) + 1}-${((config.adventureIndex - 1) % 9) + 1} 关 · `
        : config.mode === 'abyss'
          ? `冒险秘境第 ${config.abyssStage ?? 1} 层 · `
          : config.mode === 'travel' && config.travelMeta?.round
            ? `经典旅行第 ${config.travelMeta.round} 轮 · `
            : '';

    const isStrictAbyss = config.mode === 'abyss' && !saveManager.current.unlockAll;
    const presetTabLabel =
      config.mode === 'abyss'
        ? '秘境仓库'
        : config.mode === 'travel' && config.travelMeta?.isRunRound
          ? '究极配方'
          : '本关配方';

    const curDiff = clampDifficulty(config.difficulty);
    const diffInfo = getDifficultyInfo(curDiff);

    this.host.innerHTML = `
      <div class="sc-shell">
        <div class="sc-top-bar">
          <div class="sc-bank-official">
            <img class="sc-bank-bg" src="assets/ui/seed_bank.webp" alt="" />
            <div class="sc-sun-slot">
              <span>${config.infiniteSun ? '∞' : (currentSun ?? config.initialSun)}</span>
            </div>
            <div class="sc-slots" id="sc-slots"></div>
          </div>
          ${
            config.mode === 'iz'
              ? ''
              : `<div class="sc-diff-picker" id="sc-diff-picker" data-diff="${curDiff}" title="${escHtml(formatDifficultyFull(curDiff) + '：' + diffInfo.summary)}">
                  <div class="sc-diff-label" id="sc-diff-label">${formatDifficultyBadge(curDiff)}</div>
                  <div class="sc-diff-btns">
                    ${DIFFICULTY_LEVELS.map(
                      (d) =>
                        `<button type="button" class="sc-diff-btn${d.level === curDiff ? ' active' : ''}${d.isDefault ? ' is-default' : ''}" data-sc-diff="${d.level}" title="${escHtml(formatDifficultyFull(d.level) + '：' + d.summary)}">${d.level}</button>`,
                    ).join('')}
                  </div>
                </div>`
          }
          <button class="pvz-stone-btn sm" id="sc-exit">
            <img src="assets/ui/buttonsmall.webp" alt="" />
            <span>返回</span>
          </button>
        </div>

        <div class="sc-main-row">
          <div class="sc-board-official">
            <img class="sc-board-bg" src="assets/ui/seed_chooser_bg.webp" alt="" />
            <div class="sc-board-inner">
              <div class="sc-board-title">
                ${stagePrefix}选择你的植物 (${this.selected.length}/${MAX_SLOTS})
              </div>

              <div class="sc-toolbar">
                ${
                  hasPreset
                    ? `<button class="sc-mini-tab ${this.tab === 'preset' ? 'active' : ''}" data-sc-tab="preset">${presetTabLabel}</button>`
                    : ''
                }
                ${
                  isStrictAbyss
                    ? ''
                    : `<button class="sc-mini-tab ${this.tab === 'normal' ? 'active' : ''}" data-sc-tab="normal">常规(${unlockedNormalCnt}/${NORMAL_CARD_IDS.length})</button>
                       <button class="sc-mini-tab ${this.tab === 'colorful' ? 'active' : ''}" data-sc-tab="colorful">彩卡(${unlockedColorfulCnt}/${COLORFUL_CARD_IDS.length})</button>
                       ${
                         isFreePool
                           ? `<button class="sc-mini-tab ${this.tab === 'fused' ? 'active' : ''}" data-sc-tab="fused">融合</button>
                              <button class="sc-mini-tab ${this.tab === 'all' ? 'active' : ''}" data-sc-tab="all">全部(${allPlayable.length})</button>`
                           : `<button class="sc-mini-tab ${this.tab === 'discovered' ? 'active' : ''}" data-sc-tab="discovered">已发现(${discoveredCnt})</button>`
                       }`
                }
                <input id="sc-search" type="search" value="${escHtml(this.query)}" placeholder="搜索植物..." />
                <button class="sc-mini-tab" id="sc-recommend">推荐</button>
                ${hasLastDeck ? `<button class="sc-mini-tab" id="sc-lastdeck">重选上次</button>` : ''}
                <button class="sc-mini-tab ${this.overlayMode === 'zombies' ? 'active' : ''}" id="sc-zombies-btn">出怪</button>
                ${
                  hasTips
                    ? `<button class="sc-mini-tab ${this.overlayMode === 'tips' ? 'active' : ''}" id="sc-tips-btn">关卡提示</button>`
                    : ''
                }
                <button class="sc-mini-tab" id="sc-clear">清空</button>
              </div>

              <div class="sc-grid" id="sc-grid"></div>

              <div class="sc-synergy-line" id="sc-synergy-hint">
                ${this.synergyHint || (shortTip ? `💡 ${escHtml(shortTip)}` : '点击卡片选入卡槽，悬停可查看实时融合搭配')}
              </div>

              <div class="sc-footer">
                <button class="sc-rock-official" id="sc-start" ${this.selected.length === 0 ? 'disabled' : ''}>
                  <img
                    src="${this.selected.length === 0 ? 'assets/ui/seed_chooser_btn_disabled.webp' : 'assets/ui/seed_chooser_btn.webp'}"
                    data-base="assets/ui/seed_chooser_btn.webp"
                    data-hl="assets/ui/seed_chooser_btn_glow.webp"
                    alt="一起摇滚吧"
                  />
                  <span>一起摇滚吧!</span>
                </button>
              </div>

              ${this.renderOverlay(formattedTips)}
            </div>
          </div>
        </div>
      </div>
    `;

    this.renderSlots();
    this.renderPool();

    const startImg = this.host.querySelector<HTMLImageElement>('#sc-start img');
    if (startImg && this.selected.length > 0) {
      startImg.parentElement?.addEventListener('pointerenter', () => {
        startImg.src = startImg.dataset.hl!;
      });
      startImg.parentElement?.addEventListener('pointerleave', () => {
        startImg.src = startImg.dataset.base!;
      });
    }

    this.host.querySelector('#sc-exit')?.addEventListener('click', () => {
      audio.playSfx('ButtonClick', 0.8, 40);
      this.deps.onExit();
    });
    const diffPicker = this.host.querySelector<HTMLElement>('#sc-diff-picker');
    const diffLabel = this.host.querySelector<HTMLElement>('#sc-diff-label');
    const diffBtns = this.host.querySelectorAll<HTMLButtonElement>('[data-sc-diff]');
    diffBtns.forEach((b) => {
      b.addEventListener('click', () => {
        const next = clampDifficulty(b.dataset.scDiff);
        const info = getDifficultyInfo(next);
        audio.playSfx('Tap', 0.7, 35);
        this.deps.config.difficulty = next;
        this.deps.onDifficultyChange?.(next);
        if (diffPicker) {
          diffPicker.dataset.diff = String(next);
          diffPicker.title = `${formatDifficultyFull(next)}：${info.summary}`;
        }
        if (diffLabel) diffLabel.textContent = formatDifficultyBadge(next);
        diffBtns.forEach((btn) => btn.classList.toggle('active', Number(btn.dataset.scDiff) === next));
      });
    });
    this.host.querySelectorAll<HTMLButtonElement>('[data-sc-tab]').forEach((b) => {
      b.addEventListener('click', () => {
        this.tab = b.dataset.scTab as typeof this.tab;
        this.overlayMode = 'none';
        this.render();
      });
    });
    this.host.querySelector<HTMLInputElement>('#sc-search')?.addEventListener('input', (e) => {
      this.query = (e.target as HTMLInputElement).value.trim().toLowerCase();
      this.renderPool();
    });
    this.host.querySelector('#sc-recommend')?.addEventListener('click', () => {
      this.selected = buildRecommendedDeck(this.deps.config, MAX_SLOTS).map((plantId) => ({ plantId }));
      audio.playSfx('SelectCard', 0.75, 40);
      this.deps.onDeckChange(this.selected);
      this.render();
    });
    this.host.querySelector('#sc-lastdeck')?.addEventListener('click', () => {
      const prev = saveManager.current.lastDeck.filter(
        (id) => Boolean(assets.getPlant(id)) && saveManager.isPlantUnlocked(id, this.deps.config),
      );
      if (prev.length > 0) {
        this.selected = prev.slice(0, MAX_SLOTS).map((plantId) => ({ plantId }));
        audio.playSfx('SelectCard', 0.75, 40);
        this.deps.onDeckChange(this.selected);
        this.render();
      }
    });
    this.host.querySelector('#sc-zombies-btn')?.addEventListener('click', () => {
      this.overlayMode = this.overlayMode === 'zombies' ? 'none' : 'zombies';
      audio.playSfx('Tap', 0.7, 35);
      this.render();
    });
    this.host.querySelector('#sc-tips-btn')?.addEventListener('click', () => {
      this.overlayMode = this.overlayMode === 'tips' ? 'none' : 'tips';
      audio.playSfx('Tap', 0.7, 35);
      this.render();
    });
    this.host.querySelector('#sc-ov-close')?.addEventListener('click', () => {
      this.overlayMode = 'none';
      this.render();
    });
    this.host.querySelector('#sc-clear')?.addEventListener('click', () => {
      this.selected = [];
      this.deps.onDeckChange(this.selected);
      this.render();
    });
    this.host.querySelector('#sc-start')?.addEventListener('click', () => {
      if (this.selected.length === 0 || this.starting) return;
      this.starting = true;
      saveManager.setLastDeck(this.selected.map((s) => s.plantId));
      audio.playSfx('GraveButton', 0.9, 60);
      Promise.resolve(this.deps.onStartBattle()).finally(() => {
        this.starting = false;
      });
    });
  }

  private renderOverlay(formattedTips: string): string {
    if (this.overlayMode === 'none') return '';
    if (this.overlayMode === 'zombies') {
      const list = Array.from(new Set(this.deps.config.allowedZombies));
      return `
        <div class="sc-info-popover">
          <div class="sc-ov-hdr">
            <span>本关出怪一览 (${list.length} 种)</span>
            <button class="sc-mini-tab" id="sc-ov-close">关闭</button>
          </div>
          <div class="sc-ov-zgrid">
            ${list
              .map((zid) => {
                const z = assets.getZombie(zid);
                if (!z) return '';
                return `
                  <div class="sc-ov-zitem">
                    <img src="assets/portraits/zombies/${z.portrait || `z_${zid}.webp`}" alt="" />
                    <span>${escHtml(z.name)}</span>
                  </div>
                `;
              })
              .join('')}
          </div>
        </div>
      `;
    }
    return `
      <div class="sc-info-popover">
        <div class="sc-ov-hdr">
          <span>关卡说明与提示</span>
          <button class="sc-mini-tab" id="sc-ov-close">关闭</button>
        </div>
        <div class="sc-ov-tips">${escHtml(formattedTips).replace(/\n/g, '<br/>')}</div>
      </div>
    `;
  }

  private renderSlots(): void {
    const slotsEl = this.host.querySelector('#sc-slots')!;
    const sceneStyle = this.deps.config.scene.cardStyle;
    const items: string[] = [];
    for (let i = 0; i < MAX_SLOTS; i++) {
      const slot = this.selected[i];
      if (!slot) {
        items.push(`<div class="pvz-slot-empty"><img src="assets/ui/seed_packet_back.webp" alt="" /></div>`);
      } else {
        const pid = slot.plantId;
        const p = assets.getPlant(pid);
        const frame = getCardFrameUrl(p, sceneStyle);
        const hl = this.highlightedIds.has(pid) ? 'fusion-glow' : '';
        const cost = slot.isSubCard ? (p?.cost ?? 0) * 2 : (p?.cost ?? 0);
        items.push(`
          <button class="pvz-packet in-bank ${hl} ${slot.isSubCard ? 'sub-card' : ''}" data-slot-idx="${i}" title="${escHtml(p?.name ?? '')}${slot.isSubCard ? ' (副卡 · 双倍耗阳 · 独立冷却)' : ''}">
            <img class="pkt-frame" src="${frame}" alt="" />
            <img class="pkt-portrait" src="assets/portraits/plants/${p?.portrait}" alt="" />
            ${slot.isSubCard ? '<span class="pkt-sub-badge">副</span>' : ''}
            <span class="pkt-cost">${cost}</span>
          </button>
        `);
      }
    }
    slotsEl.innerHTML = items.join('');
    slotsEl.querySelectorAll<HTMLButtonElement>('[data-slot-idx]').forEach((b) => {
      b.addEventListener('click', () => {
        const idx = Number(b.dataset.slotIdx);
        if (idx >= 0 && idx < this.selected.length) {
          this.selected.splice(idx, 1);
          audio.playSfx('Tap2', 0.65, 40);
          this.deps.onDeckChange(this.selected);
          this.render();
        }
      });
    });
  }

  private renderPool(): void {
    const gridEl = this.host.querySelector('#sc-grid')!;
    const sceneStyle = this.deps.config.scene.cardStyle;
    const list = this.filterPlants(getPlayablePlants());

    gridEl.innerHTML = list
      .map((p) => {
        const unlocked = saveManager.isPlantUnlocked(p.id, this.deps.config);
        const mainPicked = unlocked && this.selected.some((s) => s.plantId === p.id && !s.isSubCard);
        const subPicked = unlocked && this.selected.some((s) => s.plantId === p.id && s.isSubCard);
        const picked = mainPicked || subPicked;
        const canFuseWithDeck = unlocked && this.selected.some((s) => fusionSystem.canFuse(s.plantId, p.id));
        const frame = getCardFrameUrl(p, sceneStyle);
        const lockHint = unlocked ? '' : getPlantUnlockHint(p.id);
        return `
          <button
            class="pvz-packet in-pool ${picked ? 'picked' : ''} ${subPicked ? 'sub-picked' : ''} ${unlocked ? '' : 'locked'} ${canFuseWithDeck && !picked ? 'synergy-ready' : ''}"
            data-pool-pid="${p.id}"
            title="${escHtml(p.name)} (${p.cost})${subPicked ? ' [已带主+副卡]' : mainPicked && isNormalCard(p.id) && p.id !== 11 ? ' [再点一次添加2倍消耗副卡]' : ''}${unlocked ? '' : ` · 未解锁：${escHtml(lockHint)}`}"
          >
            <img class="pkt-frame" src="${frame}" alt="" />
            <img class="pkt-portrait" src="assets/portraits/plants/${p.portrait}" loading="lazy" alt="${escHtml(p.name)}" />
            ${subPicked ? '<span class="pkt-sub-badge">主+副</span>' : ''}
            <span class="pkt-cost">${p.cost}</span>
            ${unlocked ? '' : '<img class="pkt-lock" src="assets/ui/lock.webp" alt="未解锁" />'}
          </button>
        `;
      })
      .join('');

    gridEl.querySelectorAll<HTMLButtonElement>('[data-pool-pid]').forEach((b) => {
      const pid = Number(b.dataset.poolPid);
      b.addEventListener('click', () => {
        if (!saveManager.isPlantUnlocked(pid, this.deps.config)) {
          const p = assets.getPlant(pid);
          audio.playSfx('Buzzer', 0.65, 120);
          const hintEl = this.host.querySelector('#sc-synergy-hint');
          if (hintEl) hintEl.textContent = `🔒 ${p?.name ?? ''}：${getPlantUnlockHint(pid)}`;
          return;
        }
        const p = assets.getPlant(pid);
        const hasMain = this.selected.some((s) => s.plantId === pid && !s.isSubCard);
        const hasSub = this.selected.some((s) => s.plantId === pid && s.isSubCard);
        let hintOverride = '';
        if (!hasMain) {
          if (this.selected.length < MAX_SLOTS) {
            this.selected.push({ plantId: pid });
          } else {
            audio.playSfx('Buzzer', 0.6, 150);
            return;
          }
        } else if (!hasSub && isNormalCard(pid) && pid !== 11 && this.selected.length < MAX_SLOTS) {
          this.selected.push({ plantId: pid, isSubCard: true });
          hintOverride = `✨ 已添加「${p?.name ?? ''}」副卡（消耗 ${(p?.cost ?? 0) * 2} 阳光，独立冷却）`;
        } else {
          this.selected = this.selected.filter((s) => s.plantId !== pid);
        }
        audio.playSfx('SelectCard', 0.75, 35);
        this.deps.onDeckChange(this.selected);
        this.render();
        if (hintOverride) {
          const hintEl = this.host.querySelector('#sc-synergy-hint');
          if (hintEl) hintEl.textContent = hintOverride;
        }
      });

      b.addEventListener('pointerenter', () => this.updateSynergyHover(pid));
      b.addEventListener('pointerleave', () => {
        this.highlightedIds.clear();
        this.synergyHint = '';
        this.renderSlots();
        const hintEl = this.host.querySelector('#sc-synergy-hint');
        if (hintEl) hintEl.textContent = '点击卡片选入卡槽，基础白卡再点可加副卡（2倍阳光独立冷却）';
      });
    });
  }

  private updateSynergyHover(pid: number): void {
    const p = assets.getPlant(pid);
    if (!saveManager.isPlantUnlocked(pid, this.deps.config)) {
      this.highlightedIds.clear();
      this.renderSlots();
      const hintEl = this.host.querySelector('#sc-synergy-hint');
      if (hintEl) hintEl.textContent = `🔒 ${p?.name ?? ''}：${getPlantUnlockHint(pid)}`;
      return;
    }
    this.highlightedIds.clear();
    const combos: string[] = [];
    for (const s of this.selected) {
      const sid = s.plantId;
      const resId = fusionSystem.getFusionResult(sid, pid);
      if (resId !== null) {
        this.highlightedIds.add(sid);
        const sDef = assets.getPlant(sid);
        const rDef = assets.getPlant(resId);
        if (sDef && rDef) combos.push(`+${sDef.name}→${rDef.name}`);
      }
    }
    this.renderSlots();
    const hintEl = this.host.querySelector('#sc-synergy-hint');
    if (hintEl) {
      const subTip =
        isNormalCard(pid) && pid !== 11 && this.selected.some((s) => s.plantId === pid && !s.isSubCard) && !this.selected.some((s) => s.plantId === pid && s.isSubCard)
          ? ' · 再点可添副卡(2x耗阳)'
          : '';
      hintEl.textContent = combos.length
        ? `⚡ ${p?.name ?? ''} 可融合: ${combos.slice(0, 3).join(' / ')}${subTip}`
        : `${p?.name ?? ''} · ${p?.cost ?? 0} 阳光 · ${fusionSystem.getRecipesUsing(pid).length} 种衍生融合${subTip}`;
    }
  }

  private filterPlants(all: PlantDef[]): PlantDef[] {
    const matchesQuery = (p: PlantDef) =>
      !this.query || `${p.id} ${p.name} ${p.en}`.toLowerCase().includes(this.query);
    const byId = new Map(all.map((p) => [p.id, p]));
    const presetList = this.deps.config.presetCards ?? [];
    const presetSet = new Set(presetList);

    if (this.tab === 'preset' && presetSet.size > 0) {
      const orderMap = new Map<number, number>();
      presetList.forEach((id, idx) => {
        if (!orderMap.has(id)) orderMap.set(id, idx);
      });
      return all
        .filter((p) => presetSet.has(p.id) && matchesQuery(p))
        .sort((a, b) => (orderMap.get(a.id) ?? 999) - (orderMap.get(b.id) ?? 999));
    }

    if (this.tab === 'normal') {
      return NORMAL_CARD_IDS.map((id) => byId.get(id))
        .filter((p): p is PlantDef => Boolean(p))
        .filter(matchesQuery);
    }

    if (this.tab === 'colorful') {
      return COLORFUL_CARD_IDS.map((id) => byId.get(id))
        .filter((p): p is PlantDef => Boolean(p))
        .filter(matchesQuery);
    }

    if (this.tab === 'discovered') {
      return all.filter(
        (p) =>
          !isNormalCard(p.id) &&
          !isColorfulCard(p.id) &&
          saveManager.isPlantUnlocked(p.id, this.deps.config) &&
          matchesQuery(p),
      );
    }

    if (this.tab === 'fused') {
      return all.filter((p) => !isNormalCard(p.id) && matchesQuery(p));
    }

    return all.filter(matchesQuery);
  }

  destroy(): void {
    this.host.innerHTML = '';
  }
}
