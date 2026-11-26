import { assets } from '../assets/AssetLoader';
import { audio } from '../audio/AudioManager';
import { saveManager } from '../save/SaveManager';
import type { BoardConfig, ExploreLevelDef, IzLevelEntry } from '../types/game';
import {
  bindHoverImages,
  buildExploreBoardConfig,
  buildIzBoardConfig,
  buildNightSnowExploreConfig,
  buildSandboxBoardConfig,
  CLASSIC_ADV_CARD_META,
  escHtml,
  EXPLORE_BASE_GROUPS,
  formatIzDisplayName,
  formatUnityRichText,
  getCardFrameUrl,
  getChallengeGroups,
  getGroundThumbUrl,
  getIzSortOrder,
  getSandboxSpecs,
  getStarChallengeLevels,
  getStarryAdventureChapters,
  getSurvivalPages,
  STAR_ADV_PAGE_CARDS,
} from './levelsCatalog';
import { buildMaLiangBoardConfig, buildStackerBoardConfig, getTowerDefenseLevels } from './towerCatalog';
import { getTravelGameStages } from './travelCatalog';

export type LevelTab =
  | 'adventure'
  | 'star_challenge'
  | 'challenge'
  | 'explore'
  | 'survival'
  | 'iz'
  | 'hot'
  | 'sandbox';

export interface LevelSelectDeps {
  initialTab: LevelTab;
  onBack: () => void;
  onSelectLevel: (cfg: BoardConfig) => void;
}

const CARD_XS = [50.0, 216.5, 383.1, 549.7, 716.2, 882.8];
const CHALLENGES_ROW_YS = [111.3, 255.6, 400.0];
const EXPLORE_ROW_YS = [132.0, 316.0];
const EXPLORE_PAGE_SIZE = 12;
const GRID_PAGE_SIZE = 18;

const DIFF_LABELS = ['简单模式', '普通模式', '困难模式', '极难模式', '炼狱模式'];

const IZ_GROUPS: { key: string; label: string; match: (ord: number) => boolean }[] = [
  { key: 'all', label: '全部关卡', match: () => true },
  { key: '1', label: '第一章 · 光茵荏苒', match: (o) => o >= 100 && o < 200 },
  { key: '2', label: '第二章 · 菇泛远影', match: (o) => o >= 200 && o < 300 },
  { key: '3', label: '第三章 · 推波助澜', match: (o) => o >= 300 && o < 400 },
  { key: '4', label: '第四章 · 磁荧流转', match: (o) => o >= 400 && o < 500 },
  { key: '5', label: '第五章 · 殊途同归', match: (o) => o >= 500 && o < 600 },
  { key: 'extra', label: '特别篇与B关', match: (o) => o >= 600 },
];

type ChallengeGroupKey = 'classic' | 'unlock' | 'flags' | 'minigames' | 'snow' | 'vasebreaker' | 'tower';
type AdvSubMenu = null | 'mission' | 'star' | 'help';

interface WindowCardSpec {
  left: number;
  top: number;
  sceneId: number;
  iconUrl: string;
  label: string;
  title: string;
  dataAttr: string;
  cleared?: boolean;
  locked?: boolean;
  starHalo?: boolean;
  useStarStyle?: boolean;
  difficultyStars?: number;
  badgeText?: string;
}

/**
 * 1:1 Unity Level Selector replicating official `advanturemenu`, `advanturemenu2`,
 * `challengemenu`, `exploremenu`, `survivalmenu`, `izmenu`, and `hotlevelmenu`.
 */
export class LevelSelect {
  private readonly uiRoot: HTMLElement;
  private readonly deps: LevelSelectDeps;

  private tab: LevelTab;
  private advChapterIndex = 0;
  private advSubMenu: AdvSubMenu = null;

  private challengeGroup: ChallengeGroupKey | null = null;
  private challengePage = 0;

  private exploreViewMode: 'pair' | 'browse' = 'pair';
  private expUpperGroupIdx = 0;
  private expLowerGroupIdx = 1;
  private expUpperPlantId: number | null = null;
  private expLowerPlantId: number | null = null;
  private expPairPage = 0;
  private exploreQuery = '';
  private exploreSceneFilter = 'all';
  private explorePage = 0;

  private survivalPage = 0;

  private izLevels: IzLevelEntry[] | null = null;
  private izLoading = false;
  private izGroupIdx = 0;
  private izPage = 0;

  private modalEl: HTMLElement | null = null;

  constructor(uiRoot: HTMLElement, deps: LevelSelectDeps) {
    this.uiRoot = uiRoot;
    this.deps = deps;
    this.tab = deps.initialTab;
    this.advChapterIndex = this.resolveInitialStarryChapter();
  }

  private resolveInitialStarryChapter(): number {
    const cleared = new Set(saveManager.current.starMainCleared);
    for (let ch = 1; ch <= 6; ch++) {
      for (let st = 1; st <= 6; st++) {
        if (!cleared.has(`star-main-${ch}-${st}`)) {
          return ch - 1;
        }
      }
    }
    return 5;
  }

  mount(): void {
    this.render();
  }

  private pickPlantIcon(preferredIds: number[], fallbackSeed = 0): string {
    for (const pid of preferredIds) {
      const p = assets.getPlant(pid);
      if (p?.portrait) return `assets/portraits/plants/${p.portrait}`;
    }
    const basePool = [0, 1, 2, 3, 4, 5, 6, 7, 12, 13, 14, 16, 18, 23, 26, 28, 32];
    const picked = assets.getPlant(basePool[Math.abs(fallbackSeed) % basePool.length]);
    return `assets/portraits/plants/${picked?.portrait ?? 'p_0.webp'}`;
  }

  private pickZombieIcon(preferredIds: number[]): string {
    for (const zid of preferredIds) {
      const z = assets.getZombie(zid);
      if (z?.portrait) return `assets/portraits/zombies/${z.portrait}`;
    }
    return 'assets/portraits/zombies/z_0.webp';
  }

  private renderWindowCard(c: WindowCardSpec): string {
    const groundUrl = getGroundThumbUrl(c.sceneId);
    const trimmedLabel = c.label.trim();
    const isMultiLine = trimmedLabel.includes('\n');
    const cls = [
      'ls-unity-card',
      c.useStarStyle ? 'star-card' : '',
      c.cleared ? 'cleared' : '',
      c.locked ? 'locked' : '',
    ]
      .filter(Boolean)
      .join(' ');
    const diffStarsHtml =
      c.difficultyStars && c.difficultyStars > 0
        ? `<div class="win-diff-stars" aria-label="难度${c.difficultyStars}星">${Array.from(
            { length: c.difficultyStars },
            () => '<img src="assets/ui/star_icon.webp" alt="" />',
          ).join('')}</div>`
        : '';
    return `
      <button
        class="${cls}"
        style="left:${c.left}px;top:${c.top}px"
        ${c.dataAttr}
        title="${escHtml(c.title)}"
        ${c.locked ? 'disabled' : ''}
      >
        ${c.starHalo ? '<img class="star-halo" src="assets/ui/star_frame.webp" alt="" />' : ''}
        <img class="win-ground" src="${groundUrl}" alt="" />
        <img class="win-icon" src="${c.iconUrl}" alt="" />
        <img class="win-frame" src="assets/ui/challenge_window.webp" data-base="assets/ui/challenge_window.webp" data-hl="assets/ui/challenge_window_hl.webp" alt="" />
        <span class="win-label${isMultiLine ? ' multiline' : ''}">${escHtml(trimmedLabel).replace(/\n/g, '<br/>')}</span>
        ${c.badgeText ? `<span class="win-badge">${escHtml(c.badgeText)}</span>` : ''}
        ${c.locked ? '<img class="win-lock" src="assets/ui/lock.webp" alt="锁定" />' : c.cleared ? '<img class="win-trophy" src="assets/ui/minigame_trophy.webp" alt="已通关" />' : ''}
        ${diffStarsHtml}
      </button>
    `;
  }

  /** Renders an un-cropped 1:1 Unity `StarButton` with crisp pill hitbox and hover glow. */
  private renderStarButton(unityLeft: number, label: string, attrs: string): string {
    return `
      <button class="ls-unity-star-btn" style="left:${(unityLeft + 31).toFixed(1)}px" ${attrs}>
        <img class="star-btn-art" src="assets/ui/star_button.webp" data-base="assets/ui/star_button.webp" data-hl="assets/ui/star_button_hl.webp" alt="" />
        <span>${escHtml(label)}</span>
      </button>
    `;
  }

  private render(): void {
    this.closeModal();
    const prof = saveManager.current;
    switch (this.tab) {
      case 'adventure':
        this.renderAdventure(prof.difficulty, prof.unlockAll, prof.starMainCleared, prof.starSubCleared);
        break;
      case 'star_challenge':
        this.renderStarChallenge(prof.difficulty, prof.clearedChallenges);
        break;
      case 'challenge':
        this.renderChallengeMenu(prof.difficulty, prof.unlockAll, prof.advLevel, prof.clearedChallenges);
        break;
      case 'explore':
        this.renderExplore(prof.difficulty, prof.clearedExplore);
        break;
      case 'survival':
        this.renderSurvival(prof.difficulty, prof.bestSurvivalRounds);
        break;
      case 'iz':
        this.renderIzMenu(prof.difficulty, prof.clearedIz);
        break;
      case 'hot':
        this.renderHotMenu(prof.difficulty, prof.clearedChallenges);
        break;
      case 'sandbox':
        this.renderSandboxGrid(prof.difficulty);
        break;
    }
  }

  /** ==================== 1. STARRY ADVENTURE (AdvantureMenu) ==================== */
  private renderAdventure(
    difficulty: number,
    unlockAll: boolean,
    starMainCleared: string[],
    starSubCleared: string[],
  ): void {
    const chapters = getStarryAdventureChapters(difficulty);
    this.advChapterIndex = Math.max(0, Math.min(chapters.length - 1, this.advChapterIndex));
    const ch = chapters[this.advChapterIndex];
    const mainSet = new Set(starMainCleared);
    const subSet = new Set(starSubCleared);

    if (this.advSubMenu) {
      this.renderAdvSubMenu(chapters, difficulty, unlockAll, mainSet, subSet, ch);
      return;
    }

    const pageVisual = STAR_ADV_PAGE_CARDS[this.advChapterIndex] ?? STAR_ADV_PAGE_CARDS[0];
    const launchMap = new Map<string, BoardConfig>();

    const mainCards: WindowCardSpec[] = ch.mainLevels.map((lvl, sIdx) => {
      const key = lvl.starMainKey!;
      const cleared = mainSet.has(key);
      const vis = pageVisual.main[sIdx];
      launchMap.set(key, lvl);
      return {
        left: CARD_XS[sIdx],
        top: 168.0,
        sceneId: vis?.groundSceneId ?? ch.sceneId,
        iconUrl: vis ? `assets/ui/adv/${vis.icon}.webp` : this.pickPlantIcon([0], sIdx),
        label: `第${sIdx + 1}关`,
        title: `${lvl.title} (${lvl.maxWaves}波)`,
        dataAttr: `data-launch-key="${key}"`,
        cleared,
        locked: false,
        starHalo: true,
        useStarStyle: true,
      };
    });

    let subCleared = 0;
    const sideCards: WindowCardSpec[] = ch.subLevels.map((lvl, sIdx) => {
      const key = lvl.starSubKey!;
      const cleared = subSet.has(key);
      if (cleared) subCleared++;
      const vis = pageVisual.sub[sIdx];
      launchMap.set(key, lvl);
      return {
        left: CARD_XS[sIdx],
        top: 384.7,
        sceneId: vis?.groundSceneId ?? lvl.scene.id,
        iconUrl: vis ? `assets/ui/adv/${vis.icon}.webp` : this.pickPlantIcon([3], sIdx),
        label: `支线${sIdx + 1}`,
        title: `${lvl.title} (${lvl.maxWaves}波)${lvl.tips ? ` — ${formatUnityRichText(lvl.tips)}` : ''}`,
        dataAttr: `data-launch-key="${key}"`,
        cleared,
        locked: false,
        starHalo: true,
        useStarStyle: true,
        difficultyStars: vis?.stars ?? 1,
      };
    });

    this.uiRoot.innerHTML = `
      <div class="ls-backdrop ls-star-mode" style="background-image:url('assets/ui/star_bg.webp')">
        <img class="ls-star-dots" src="assets/ui/star_dots.webp" alt="" />
        <div class="ls-star-hdr-shadow">${ch.starTitle}</div>
        <div class="ls-star-hdr-title">${ch.starTitle}</div>

        <div class="ls-star-sec-lbl" style="top:110px">主线关卡</div>
        <div class="ls-star-hairline" style="top:150px"></div>

        ${mainCards.map((c) => this.renderWindowCard(c)).join('')}

        ${
          this.advChapterIndex > 0
            ? `<button class="ls-unity-arrow prev" id="ls-prev-ch" title="上一章">
                <img src="assets/ui/star_arrow.webp" alt="上一章" />
                <span>上一章</span>
              </button>`
            : ''
        }
        ${
          this.advChapterIndex < chapters.length - 1
            ? `<button class="ls-unity-arrow next" id="ls-next-ch" title="下一章">
                <img src="assets/ui/star_arrow.webp" alt="下一章" />
                <span>下一章</span>
              </button>`
            : ''
        }

        <div class="ls-star-sec-lbl" style="top:324px">支线关卡</div>
        <img class="ls-star-sub-icon" src="assets/ui/star_icon.webp" alt="" />
        <div class="ls-star-sub-cnt">${subCleared}/6</div>
        <div class="ls-star-hairline" style="top:364.4px"></div>

        ${sideCards.map((c) => this.renderWindowCard(c)).join('')}

        ${this.renderStarButton(-16.1, '返回菜单', 'id="ls-back"')}
        ${this.renderStarButton(122.7, '任务奖励', 'id="ls-star-mission"')}
        ${this.renderStarButton(261.5, '星级奖励', 'id="ls-star-reward"')}
        ${this.renderStarButton(400.3, '星辉挑战', 'id="ls-star-challenge"')}
        ${this.renderStarButton(736.8, '切换难度', 'id="ls-diff-cycle"')}

        <button class="ls-star-meta ls-star-ch-readout" id="ls-star-help" title="查看难度介绍">章节难度：${ch.chapter * 2}</button>
        <div class="ls-star-meta ls-star-diff-readout">${DIFF_LABELS[difficulty - 1] ?? '普通模式'}</div>
      </div>
    `;

    this.bindCommonControls(launchMap);

    this.uiRoot.querySelector('#ls-prev-ch')?.addEventListener('click', () => {
      if (this.advChapterIndex > 0) {
        this.advChapterIndex -= 1;
        audio.playSfx('Tap', 0.75, 40);
        this.render();
      }
    });
    this.uiRoot.querySelector('#ls-next-ch')?.addEventListener('click', () => {
      if (this.advChapterIndex < chapters.length - 1) {
        this.advChapterIndex += 1;
        audio.playSfx('Tap', 0.75, 40);
        this.render();
      }
    });
    this.uiRoot.querySelector('#ls-star-challenge')?.addEventListener('click', () => {
      audio.playSfx('Tap', 0.75, 40);
      this.tab = 'star_challenge';
      this.render();
    });
    this.uiRoot.querySelector('#ls-star-mission')?.addEventListener('click', () => {
      audio.playSfx('ButtonClick', 0.8, 40);
      this.advSubMenu = 'mission';
      this.render();
    });
    this.uiRoot.querySelector('#ls-star-reward')?.addEventListener('click', () => {
      audio.playSfx('ButtonClick', 0.8, 40);
      this.advSubMenu = 'star';
      this.render();
    });
    this.uiRoot.querySelector('#ls-star-help')?.addEventListener('click', () => {
      audio.playSfx('ButtonClick', 0.8, 40);
      this.advSubMenu = 'help';
      this.render();
    });
  }

  /** Renders native Unity `AdvantureMissionMenu`, `AdvantureStarMenu`, and `AdvantureHelpMenu`. */
  private renderAdvSubMenu(
    chapters: ReturnType<typeof getStarryAdventureChapters>,
    difficulty: number,
    unlockAll: boolean,
    mainSet: Set<string>,
    subSet: Set<string>,
    currentChapter: ReturnType<typeof getStarryAdventureChapters>[number],
  ): void {
    const totalStars = mainSet.size + subSet.size;

    if (this.advSubMenu === 'mission') {
      const rows = chapters
        .map((c, idx) => {
          const m = c.mainLevels.filter((l) => mainSet.has(l.starMainKey!)).length;
          const s = c.subLevels.filter((l) => subSet.has(l.starSubKey!)).length;
          const allDone = m === 6 && s === 6;
          return `
            <div class="ls-star-mission-row ${allDone ? 'done' : ''}">
              <div class="ls-star-mission-info">
                <strong>${escHtml(c.starTitle)} · ${escHtml(c.title)}</strong>
                <span>主线通关 ${m}/6 · 支线通关 ${s}/6</span>
              </div>
              <button class="ls-star-pill-btn" data-jump-ch="${idx}">${allDone ? '已领奖 · 进入' : '前往挑战'}</button>
            </div>
          `;
        })
        .join('');

      this.uiRoot.innerHTML = `
        <div class="ls-backdrop ls-star-mode" style="background-image:url('assets/ui/star_bg.webp')">
          <img class="ls-star-dots" src="assets/ui/star_dots.webp" alt="" />
          <div class="ls-star-hdr-shadow">任务奖励</div>
          <div class="ls-star-hdr-title">任务奖励</div>

          <div class="ls-star-subpanel">
            <div class="ls-star-subpanel-lead">完成各章主线（6关）与支线（6关）星辉挑战，累计已通关 ${mainSet.size}/36 主线 · ${subSet.size}/36 支线</div>
            <div class="ls-star-mission-list">${rows}</div>
          </div>

          ${this.renderStarButton(-16.1, '返回菜单', 'id="ls-sub-back"')}
        </div>
      `;

      bindHoverImages(this.uiRoot);
      this.uiRoot.querySelector('#ls-sub-back')?.addEventListener('click', () => {
        audio.playSfx('ButtonClick', 0.8, 40);
        this.advSubMenu = null;
        this.render();
      });
      this.uiRoot.querySelectorAll<HTMLButtonElement>('[data-jump-ch]').forEach((b) => {
        b.addEventListener('click', () => {
          this.advChapterIndex = Number(b.dataset.jumpCh) || 0;
          this.advSubMenu = null;
          audio.playSfx('Tap', 0.75, 40);
          this.render();
        });
      });
      return;
    }

    if (this.advSubMenu === 'star') {
      const milestones = [
        { need: 6, title: '星辉初耀 · 初始阳光加成', desc: '全星辉章节开放畅玩，前排植物稳固成型' },
        { need: 18, title: '繁星阵列 · 高阶融合通行', desc: '解锁全图鉴融合路线实战演练指引' },
        { need: 36, title: '星穹大师 · 星辉挑战历练', desc: '累计半数星辉，迎战 14 关星辉究极体验' },
        { need: 72, title: '星海之巅 · 全章完美制霸', desc: '制霸六章 36 主线 + 36 支线全部关卡' },
      ];
      const tiersHtml = milestones
        .map((m) => {
          const reached = totalStars >= m.need;
          return `
            <div class="ls-star-mission-row ${reached ? 'done' : ''}">
              <div class="ls-star-mission-info">
                <strong>${escHtml(m.title)}（${m.need}★）</strong>
                <span>${escHtml(m.desc)}</span>
              </div>
              <span class="ls-star-tier-state">${reached ? '已达成' : `差 ${m.need - totalStars}★`}</span>
            </div>
          `;
        })
        .join('');

      this.uiRoot.innerHTML = `
        <div class="ls-backdrop ls-star-mode" style="background-image:url('assets/ui/star_bg.webp')">
          <img class="ls-star-dots" src="assets/ui/star_dots.webp" alt="" />
          <div class="ls-star-hdr-shadow">星星奖励</div>
          <div class="ls-star-hdr-title">星星奖励</div>

          <div class="ls-star-top-badge">
            <img src="assets/ui/star_icon.webp" alt="" />
            <span>${totalStars}/72</span>
          </div>

          <div class="ls-star-subpanel">
            <div class="ls-star-subpanel-lead">当前累计星辉：${totalStars} / 72 星 · 全解锁状态：${unlockAll ? '已开启' : '按进度'}</div>
            <div class="ls-star-mission-list">${tiersHtml}</div>
            <div class="ls-star-subpanel-actions">
              <button class="ls-star-pill-btn" id="ls-star-unlock-toggle">${unlockAll ? '关闭一键全解锁' : '一键解锁全关卡'}</button>
            </div>
          </div>

          ${this.renderStarButton(-16.1, '返回菜单', 'id="ls-sub-back"')}
          ${this.renderStarButton(736.8, '重置奖励', 'id="ls-star-reset" data-confirm="0"')}
        </div>
      `;

      bindHoverImages(this.uiRoot);
      this.uiRoot.querySelector('#ls-sub-back')?.addEventListener('click', () => {
        audio.playSfx('ButtonClick', 0.8, 40);
        this.advSubMenu = null;
        this.render();
      });
      this.uiRoot.querySelector('#ls-star-unlock-toggle')?.addEventListener('click', () => {
        saveManager.update({ unlockAll: !unlockAll });
        audio.playSfx('Tap', 0.75, 40);
        this.render();
      });
      const resetBtn = this.uiRoot.querySelector<HTMLButtonElement>('#ls-star-reset');
      resetBtn?.addEventListener('click', () => {
        if (resetBtn.dataset.confirm !== '1') {
          resetBtn.dataset.confirm = '1';
          const span = resetBtn.querySelector('span');
          if (span) span.textContent = '确认重置';
          return;
        }
        saveManager.resetProgress();
        this.advChapterIndex = 0;
        this.advSubMenu = null;
        audio.playSfx('ButtonClick', 0.8, 40);
        this.render();
      });
      return;
    }

    // AdvantureHelpMenu (难度介绍)
    this.uiRoot.innerHTML = `
      <div class="ls-backdrop ls-chal-mode" style="background-image:url('assets/ui/challenge_bg.webp')">
        <div class="ls-chal-arch-title">难度介绍</div>

        <div class="ls-star-help-scroll">
          <h3>当前章节：${escHtml(currentChapter.starTitle)}（章节难度：${currentChapter.chapter * 2}）</h3>
          <p><strong>章节难度说明</strong>：星辉冒险共分六章（白天 2 · 黑夜 4 · 泳池 6 · 浓雾 8 · 屋顶 10 · 雪原 12），章节推进与支线星级（1★ ~ 5★）越高，出怪节奏与高阶僵尸比例越紧凑。</p>
          <hr />
          <p><strong>1. 简单模式</strong>：僵尸生命与攻速较柔和，适合熟悉融合配方与节奏。</p>
          <p><strong>2. 普通模式</strong>（当前：${difficulty === 2 ? '使用中' : '可选'}）：标准平衡数值，贴合原版冒险推进体验。</p>
          <p><strong>3. 困难模式</strong>：波次节奏加快、精英单位更早登场，建议充分利用双融合。</p>
          <p><strong>4. 极难模式</strong>：高血量与高压尸潮并存，需要合理搭配经济与控场植物。</p>
          <p><strong>5. 炼狱模式</strong>：极限强度挑战，面向成型究极融合阵容的高手玩家。</p>
        </div>

        <button class="ls-unity-foot-btn" id="ls-sub-back" style="left:21px;top:559px">
          <img src="assets/ui/seed_chooser_btn2.webp" data-base="assets/ui/seed_chooser_btn2.webp" data-hl="assets/ui/seed_chooser_btn2_glow.webp" alt="" />
          <span>返回菜单</span>
        </button>
      </div>
    `;

    bindHoverImages(this.uiRoot);
    this.uiRoot.querySelector('#ls-sub-back')?.addEventListener('click', () => {
      audio.playSfx('ButtonClick', 0.8, 40);
      this.advSubMenu = null;
      this.render();
    });
  }

  /** ==================== 2. STARRY CHALLENGES (AdvantureMenu2) ==================== */
  private renderStarChallenge(difficulty: number, clearedChallenges: string[]): void {
    const list = getStarChallengeLevels(difficulty);
    const clearedSet = new Set(clearedChallenges);
    const launchMap = new Map<string, BoardConfig>();
    const cards: WindowCardSpec[] = list.map((item, idx) => {
      launchMap.set(item.config.levelKey, item.config);
      return {
        left: CARD_XS[idx % 6],
        top: CHALLENGES_ROW_YS[Math.floor(idx / 6)],
        sceneId: item.groundSceneId,
        iconUrl: `assets/ui/adv/${item.iconName}.webp`,
        label: item.label,
        title: `${item.config.title} — ${item.config.tips ?? ''}`,
        dataAttr: `data-launch-key="${item.config.levelKey}"`,
        cleared: clearedSet.has(item.config.levelKey),
        locked: false,
        starHalo: true,
        useStarStyle: true,
      };
    });

    this.uiRoot.innerHTML = `
      <div class="ls-backdrop ls-star-mode" style="background-image:url('assets/ui/star_bg.webp')">
        <img class="ls-star-dots" src="assets/ui/star_dots.webp" alt="" />
        <div class="ls-star-hdr-shadow">星辉挑战</div>
        <div class="ls-star-hdr-title">星辉挑战</div>
        ${cards.map((c) => this.renderWindowCard(c)).join('')}

        ${this.renderStarButton(-16.1, '返回菜单', 'id="ls-back"')}
        ${this.renderStarButton(122.7, '返回冒险', 'data-tab="adventure"')}
        ${this.renderStarButton(736.8, '切换难度', 'id="ls-diff-cycle"')}
        <div class="ls-star-meta ls-star-ch-readout">星辉试炼 · 14 关</div>
        <div class="ls-star-meta ls-star-diff-readout">${DIFF_LABELS[difficulty - 1] ?? '普通模式'}</div>
      </div>
    `;

    this.bindCommonControls(launchMap);
  }

  /** ==================== 3. CHALLENGE MENU (ChallengeMenu) ==================== */
  private renderChallengeMenu(
    difficulty: number,
    unlockAll: boolean,
    advLevel: number,
    clearedChallenges: string[],
  ): void {
    const groups = getChallengeGroups(difficulty);
    const clearedSet = new Set(clearedChallenges);
    const launchMap = new Map<string, BoardConfig>();

    if (!this.challengeGroup) {
      const indexCards: {
        label: string;
        sid: number;
        pid: number;
        iconUrl?: string;
        action?: string;
        group?: ChallengeGroupKey;
        locked?: boolean;
        tip: string;
      }[] = [
        { label: '经典冒险', sid: 0, pid: 0, iconUrl: 'assets/ui/cat_adventure.webp', group: 'classic', tip: '原版 45 关经典冒险战役 (白天 / 黑夜 / 泳池 / 浓雾 / 屋顶)' },
        { label: '高级挑战', sid: 0, pid: 1005, iconUrl: 'assets/ui/cat_challenge.webp', group: 'unlock', tip: '12 关超级融合植物试炼 (PageUnlockChallenge)' },
        { label: '十旗挑战', sid: 2, pid: 2, iconUrl: 'assets/ui/cat_flags.webp', group: 'flags', tip: '12 关十面旗帜高强度攻防挑战 (PageFlagChallenge)' },
        { label: '迷你游戏', sid: 1, pid: 13, iconUrl: 'assets/ui/cat_minigames.webp', group: 'minigames', tip: '13 关经典融合版迷你游戏精选（含手推车挑战）' },
        { label: '冒险的时光', sid: 18, pid: 36, group: 'snow', tip: '极寒雪原 9 关特别冒险 (PageNewAdvantureLevel)' },
        { label: '星辉冒险\n雪原更新', sid: 18, pid: 35, action: 'go-star', tip: '前往星辉冒险（含第六章雪原）' },
        { label: '超级自定义\n(自由沙盒)', sid: 6, pid: 14, action: 'go-sandbox', tip: '12 种地形自由测试全图鉴融合阵型' },
        { label: '砸罐子', sid: 1, pid: 3, iconUrl: 'assets/ui/modes/scary_pot_1.webp', group: 'vasebreaker', tip: '原版 7 关砸罐子挑战（砸罐子 / 连锁反应 / 绝对火力 / 有内鬼等）' },
        { label: '经典塔防', sid: 0, pid: 352, group: 'tower', tip: '原版 8 关经典塔防 + 2 关塔防无尽（通第 8 关解锁狙击射手）' },
      ];

      const cardsHtml = indexCards
        .map((c, idx) =>
          this.renderWindowCard({
            left: CARD_XS[idx % 6],
            top: CHALLENGES_ROW_YS[Math.floor(idx / 6)],
            sceneId: c.sid,
            iconUrl: c.iconUrl ?? this.pickPlantIcon([c.pid], idx),
            label: c.label,
            title: c.tip,
            dataAttr: c.group ? `data-ch-grp="${c.group}"` : c.action ? `data-ch-act="${c.action}"` : '',
            locked: c.locked,
          }),
        )
        .join('');

      this.uiRoot.innerHTML = `
        <div class="ls-backdrop ls-chal-mode" style="background-image:url('assets/ui/challenge_bg.webp')">
          <div class="ls-chal-arch-title">挑战模式</div>
          ${cardsHtml}

          <button class="ls-unity-foot-btn" id="ls-back" style="left:21px;top:559px">
            <img src="assets/ui/seed_chooser_btn2.webp" data-base="assets/ui/seed_chooser_btn2.webp" data-hl="assets/ui/seed_chooser_btn2_glow.webp" alt="" />
            <span>返回菜单</span>
          </button>
          <button class="ls-unity-foot-btn" id="ls-diff-cycle" style="left:898px;top:559px" title="点击切换难度">
            <img src="assets/ui/seed_chooser_btn2.webp" data-base="assets/ui/seed_chooser_btn2.webp" data-hl="assets/ui/seed_chooser_btn2_glow.webp" alt="" />
            <span>${DIFF_LABELS[difficulty - 1] ?? '普通模式'}</span>
          </button>
        </div>
      `;

      this.bindCommonControls(launchMap);
      this.uiRoot.querySelectorAll<HTMLButtonElement>('[data-ch-grp]').forEach((b) => {
        b.addEventListener('click', () => {
          this.challengeGroup = (b.dataset.chGrp as ChallengeGroupKey) ?? null;
          this.challengePage = 0;
          audio.playSfx('GraveButton', 0.85, 50);
          this.render();
        });
      });
      this.uiRoot.querySelectorAll<HTMLButtonElement>('[data-ch-act]').forEach((b) => {
        b.addEventListener('click', () => {
          audio.playSfx('GraveButton', 0.85, 50);
          if (b.dataset.chAct === 'go-star') {
            this.advSubMenu = null;
            this.tab = 'adventure';
          } else if (b.dataset.chAct === 'go-sandbox') {
            this.tab = 'sandbox';
          }
          this.render();
        });
      });
      return;
    }

    const grp = groups[this.challengeGroup];
    const totalPages = Math.max(1, Math.ceil(grp.levels.length / GRID_PAGE_SIZE));
    this.challengePage = Math.max(0, Math.min(totalPages - 1, this.challengePage));
    const slice = grp.levels.slice(
      this.challengePage * GRID_PAGE_SIZE,
      (this.challengePage + 1) * GRID_PAGE_SIZE,
    );

    const cardsHtml = slice
      .map((cfg, idx) => {
        launchMap.set(cfg.levelKey, cfg);
        const isClassic = this.challengeGroup === 'classic';
        const advNum = cfg.adventureIndex ?? 1;
        const unlocked = !isClassic || unlockAll || advNum <= advLevel;
        const cleared = isClassic ? advNum < advLevel : clearedSet.has(cfg.levelKey);
        const iconPid = cfg.presetCards?.[0] ?? grp.iconPlantId;
        const classicMeta = isClassic ? CLASSIC_ADV_CARD_META[advNum - 1] : undefined;
        const isVase = this.challengeGroup === 'vasebreaker';
        const cardLabel = isClassic
          ? `第${advNum}关`
          : this.challengeGroup === 'snow'
            ? `雪原：第${(this.challengePage * GRID_PAGE_SIZE) + idx + 1}关`
            : isVase
              ? cfg.title.replace(/^砸罐子 · /, '').slice(0, 12)
              : this.challengeGroup === 'tower'
                ? cfg.title.replace(/^经典塔防 · /, '').slice(0, 12)
                : cfg.title.replace(/^迷你游戏 · |^挑战关卡 · /, '').slice(0, 12);

        return this.renderWindowCard({
          left: CARD_XS[idx % 6],
          top: CHALLENGES_ROW_YS[Math.floor(idx / 6)],
          sceneId: classicMeta?.groundSceneId ?? cfg.scene.id,
          iconUrl: classicMeta
            ? `assets/ui/adv/${classicMeta.icon}.webp`
            : cfg.levelKey === 'mg-wheelbarrow'
              ? 'assets/ui/modes/wheelbarrow.webp'
              : isVase
                ? `assets/ui/modes/scary_pot_${idx % 2 === 0 ? 1 : 3}.webp`
                : this.pickPlantIcon([iconPid], idx + advNum),
          label: cardLabel,
          title: `${cfg.title}${isVase ? '' : ` (${cfg.maxWaves}波)`}${cfg.tips ? ` — ${formatUnityRichText(cfg.tips)}` : ''}`,
          dataAttr: `data-launch-key="${cfg.levelKey}"`,
          cleared,
          locked: !unlocked,
        });
      })
      .join('');

    this.uiRoot.innerHTML = `
      <div class="ls-backdrop ls-chal-mode" style="background-image:url('assets/ui/challenge_bg.webp')">
        <div class="ls-chal-arch-title">${grp.title}</div>
        ${cardsHtml}

        <button class="ls-unity-foot-btn" id="ls-back" style="left:21px;top:559px">
          <img src="assets/ui/seed_chooser_btn2.webp" data-base="assets/ui/seed_chooser_btn2.webp" data-hl="assets/ui/seed_chooser_btn2_glow.webp" alt="" />
          <span>返回菜单</span>
        </button>
        <button class="ls-unity-foot-btn" id="ls-ch-idx" style="left:176px;top:559px">
          <img src="assets/ui/seed_chooser_btn2.webp" data-base="assets/ui/seed_chooser_btn2.webp" data-hl="assets/ui/seed_chooser_btn2_glow.webp" alt="" />
          <span>回到索引</span>
        </button>
        ${
          totalPages > 1
            ? `
            <button class="ls-unity-foot-btn sm" id="ls-ch-prev" style="left:360px;top:559px" ${this.challengePage === 0 ? 'disabled' : ''}>
              <img src="assets/ui/seed_chooser_btn2.webp" data-base="assets/ui/seed_chooser_btn2.webp" data-hl="assets/ui/seed_chooser_btn2_glow.webp" alt="" />
              <span>上一页</span>
            </button>
            <div class="ls-exp-page-txt" style="left:466px;top:562px">${this.challengePage + 1}/${totalPages}</div>
            <button class="ls-unity-foot-btn sm" id="ls-ch-next" style="left:562px;top:559px" ${this.challengePage >= totalPages - 1 ? 'disabled' : ''}>
              <img src="assets/ui/seed_chooser_btn2.webp" data-base="assets/ui/seed_chooser_btn2.webp" data-hl="assets/ui/seed_chooser_btn2_glow.webp" alt="" />
              <span>下一页</span>
            </button>`
            : ''
        }
        <button class="ls-unity-foot-btn" id="ls-diff-cycle" style="left:898px;top:559px" title="点击切换难度">
          <img src="assets/ui/seed_chooser_btn2.webp" data-base="assets/ui/seed_chooser_btn2.webp" data-hl="assets/ui/seed_chooser_btn2_glow.webp" alt="" />
          <span>${DIFF_LABELS[difficulty - 1] ?? '普通模式'}</span>
        </button>
      </div>
    `;

    this.bindCommonControls(launchMap);
    this.uiRoot.querySelector('#ls-ch-idx')?.addEventListener('click', () => {
      this.challengeGroup = null;
      audio.playSfx('Tap', 0.75, 40);
      this.render();
    });
    this.uiRoot.querySelector('#ls-ch-prev')?.addEventListener('click', () => {
      if (this.challengePage > 0) {
        this.challengePage -= 1;
        audio.playSfx('Tap', 0.75, 40);
        this.render();
      }
    });
    this.uiRoot.querySelector('#ls-ch-next')?.addEventListener('click', () => {
      if (this.challengePage < totalPages - 1) {
        this.challengePage += 1;
        audio.playSfx('Tap', 0.75, 40);
        this.render();
      }
    });
  }

  /** ==================== 4. EXPLORE MENU (ExploreMenu Dual-Row Pairing + Full Browse) ==================== */
  private getExploreLevelsByPair(upperGroupIdx: number, lowerGroupIdx: number, upperPid: number | null, lowerPid: number | null): ExploreLevelDef[] {
    const uSet = new Set(upperPid !== null ? [upperPid] : EXPLORE_BASE_GROUPS[upperGroupIdx].pids);
    const lSet = new Set(lowerPid !== null ? [lowerPid] : EXPLORE_BASE_GROUPS[lowerGroupIdx].pids);
    const expMap = new Map<number, ExploreLevelDef>();
    for (const e of assets.catalog.exploreLevels) expMap.set(e.id, e);

    const matched: ExploreLevelDef[] = [];
    const seen = new Set<number>();
    for (const [a, b, res] of assets.catalog.recipeList) {
      if (seen.has(res)) continue;
      const lvl = expMap.get(res);
      if (!lvl) continue;
      if ((uSet.has(a) && lSet.has(b)) || (uSet.has(b) && lSet.has(a))) {
        seen.add(res);
        matched.push(lvl);
      }
    }
    return matched.sort((a, b) => a.id - b.id);
  }

  private renderExplore(difficulty: number, clearedExplore: number[]): void {
    const totalCleared = assets.catalog.exploreLevels.filter((l) => clearedExplore.includes(l.id)).length;

    if (this.exploreViewMode === 'pair') {
      const uGroup = EXPLORE_BASE_GROUPS[this.expUpperGroupIdx];
      const lGroup = EXPLORE_BASE_GROUPS[this.expLowerGroupIdx];
      const matched = this.getExploreLevelsByPair(
        this.expUpperGroupIdx,
        this.expLowerGroupIdx,
        this.expUpperPlantId,
        this.expLowerPlantId,
      );
      const pairPageSize = 6;
      const totalPairPages = Math.max(1, Math.ceil(matched.length / pairPageSize));
      this.expPairPage = Math.max(0, Math.min(totalPairPages - 1, this.expPairPage));
      const shown = matched.slice(this.expPairPage * pairPageSize, (this.expPairPage + 1) * pairPageSize);

      const renderBasePacketRow = (pids: number[], selectedPid: number | null, attr: string) =>
        pids
          .map((pid) => {
            const p = assets.getPlant(pid);
            if (!p) return '';
            const act = selectedPid === pid ? 'selected' : '';
            return `
              <button class="pvz-packet ls-pair-pkt ${act}" ${attr}="${pid}" title="${escHtml(p.name)}">
                <img class="pkt-frame" src="${getCardFrameUrl(p)}" alt="" />
                <img class="pkt-portrait" src="assets/portraits/plants/${p.portrait}" alt="${escHtml(p.name)}" />
                <span class="pkt-cost">${p.cost}</span>
              </button>
            `;
          })
          .join('');

      const resultCards = shown
        .map((l, idx) => {
          const sc = assets.getScene(l.sceneType);
          const shortName = l.name.length > 7 ? `${l.name.slice(0, 7)}…` : l.name;
          return this.renderWindowCard({
            left: CARD_XS[idx % 6],
            top: 392,
            sceneId: l.sceneType,
            iconUrl: this.pickPlantIcon([l.id], l.id),
            label: shortName,
            title: `${l.name} (#${l.id} · ${sc?.label ?? '草坪'} · ${l.maxWave}波 · 阳光${l.theSun}${l.convay ? ' · 传送带' : ''})`,
            dataAttr: `data-exp-id="${l.id}"`,
            cleared: clearedExplore.includes(l.id),
          });
        })
        .join('');

      this.uiRoot.innerHTML = `
        <div class="ls-backdrop ls-explore-mode" style="background-image:url('assets/bg/Day_1400x600.webp')">
          <img class="ls-exp-beam top" src="assets/ui/seed_chooser_btn.webp" alt="" />
          <img class="ls-exp-beam bot" src="assets/ui/seed_chooser_btn.webp" alt="" />

          <div class="ls-exp-title" style="left:315px;width:436px">
            配方探索 · ${uGroup.label} × ${lGroup.label} (${matched.length}关)
          </div>

          <div class="ls-exp-trophy-cnt">
            <img src="assets/ui/minigame_trophy.webp" alt="" />
            <span>${totalCleared}/${assets.catalog.exploreLevels.length}</span>
          </div>

          <!-- Upper base plant group strip -->
          <div class="ls-exp-pair-strip" style="top:96px">
            <button class="ls-pair-grp-arrow" id="ls-exp-up-prev" title="切换上一组植物">‹</button>
            <div class="ls-pair-grp-tag">${uGroup.label}</div>
            <div class="ls-pair-pkts">${renderBasePacketRow(uGroup.pids, this.expUpperPlantId, 'data-up-pid')}</div>
            <button class="ls-pair-grp-arrow" id="ls-exp-up-next" title="切换下一组植物">›</button>
          </div>

          <!-- Lower base plant group strip -->
          <div class="ls-exp-pair-strip" style="top:216px">
            <button class="ls-pair-grp-arrow" id="ls-exp-lo-prev" title="切换上一组植物">‹</button>
            <div class="ls-pair-grp-tag">${lGroup.label}</div>
            <div class="ls-pair-pkts">${renderBasePacketRow(lGroup.pids, this.expLowerPlantId, 'data-lo-pid')}</div>
            <button class="ls-pair-grp-arrow" id="ls-exp-lo-next" title="切换下一组植物">›</button>
          </div>

          <div class="ls-exp-pair-hint">
            已筛选 ${matched.length} 个融合关卡（点击上下两排基础植物交叉配对，再点下方卡片开战）
            ${
              totalPairPages > 1
                ? `<button class="ls-pair-pg-btn" id="ls-pair-prev" ${this.expPairPage === 0 ? 'disabled' : ''}>◀</button>
                   <span>${this.expPairPage + 1}/${totalPairPages}</span>
                   <button class="ls-pair-pg-btn" id="ls-pair-next" ${this.expPairPage >= totalPairPages - 1 ? 'disabled' : ''}>▶</button>`
                : ''
            }
          </div>

          ${
            shown.length > 0
              ? resultCards
              : '<div class="ls-exp-pair-empty">当前选中的两种植物暂无直接配方关卡，请换一组搭配或点击“清除选择”</div>'
          }

          <button class="ls-unity-foot-btn" id="ls-back" style="left:22px;top:551px">
            <img src="assets/ui/seed_chooser_btn2.webp" data-base="assets/ui/seed_chooser_btn2.webp" data-hl="assets/ui/seed_chooser_btn2_glow.webp" alt="" />
            <span>返回菜单</span>
          </button>
          <button class="ls-unity-foot-btn" id="ls-exp-clear-pair" style="left:174px;top:551px">
            <img src="assets/ui/seed_chooser_btn2.webp" data-base="assets/ui/seed_chooser_btn2.webp" data-hl="assets/ui/seed_chooser_btn2_glow.webp" alt="" />
            <span>清除选择</span>
          </button>
          <button class="ls-unity-foot-btn" id="ls-exp-quick" style="left:326px;top:551px" title="随机进入一个还没有通过的配方探索关卡">
            <img src="assets/ui/seed_chooser_btn2.webp" data-base="assets/ui/seed_chooser_btn2.webp" data-hl="assets/ui/seed_chooser_btn2_glow.webp" alt="" />
            <span>快速开始</span>
          </button>
          <button class="ls-unity-foot-btn" id="ls-exp-mode-toggle" style="left:478px;top:551px">
            <img src="assets/ui/seed_chooser_btn2.webp" data-base="assets/ui/seed_chooser_btn2.webp" data-hl="assets/ui/seed_chooser_btn2_glow.webp" alt="" />
            <span>全部204关</span>
          </button>
          <button class="ls-unity-foot-btn" id="ls-diff-cycle" style="left:904px;top:551px" title="点击切换难度">
            <img src="assets/ui/seed_chooser_btn2.webp" data-base="assets/ui/seed_chooser_btn2.webp" data-hl="assets/ui/seed_chooser_btn2_glow.webp" alt="" />
            <span>${DIFF_LABELS[difficulty - 1] ?? '普通模式'}</span>
          </button>
        </div>
      `;

      this.bindCommonControls();
      const cycleGrp = (which: 'up' | 'lo', delta: number) => {
        const len = EXPLORE_BASE_GROUPS.length;
        if (which === 'up') {
          this.expUpperGroupIdx = (this.expUpperGroupIdx + delta + len) % len;
          this.expUpperPlantId = null;
        } else {
          this.expLowerGroupIdx = (this.expLowerGroupIdx + delta + len) % len;
          this.expLowerPlantId = null;
        }
        this.expPairPage = 0;
        audio.playSfx('Tap', 0.75, 40);
        this.render();
      };
      this.uiRoot.querySelector('#ls-exp-up-prev')?.addEventListener('click', () => cycleGrp('up', -1));
      this.uiRoot.querySelector('#ls-exp-up-next')?.addEventListener('click', () => cycleGrp('up', 1));
      this.uiRoot.querySelector('#ls-exp-lo-prev')?.addEventListener('click', () => cycleGrp('lo', -1));
      this.uiRoot.querySelector('#ls-exp-lo-next')?.addEventListener('click', () => cycleGrp('lo', 1));

      this.uiRoot.querySelectorAll<HTMLButtonElement>('[data-up-pid]').forEach((b) => {
        b.addEventListener('click', () => {
          const pid = Number(b.dataset.upPid);
          this.expUpperPlantId = this.expUpperPlantId === pid ? null : pid;
          this.expPairPage = 0;
          audio.playSfx('SelectCard', 0.7, 35);
          this.render();
        });
      });
      this.uiRoot.querySelectorAll<HTMLButtonElement>('[data-lo-pid]').forEach((b) => {
        b.addEventListener('click', () => {
          const pid = Number(b.dataset.loPid);
          this.expLowerPlantId = this.expLowerPlantId === pid ? null : pid;
          this.expPairPage = 0;
          audio.playSfx('SelectCard', 0.7, 35);
          this.render();
        });
      });
      this.uiRoot.querySelector('#ls-pair-prev')?.addEventListener('click', () => {
        if (this.expPairPage > 0) {
          this.expPairPage -= 1;
          this.render();
        }
      });
      this.uiRoot.querySelector('#ls-pair-next')?.addEventListener('click', () => {
        if (this.expPairPage < totalPairPages - 1) {
          this.expPairPage += 1;
          this.render();
        }
      });
      this.uiRoot.querySelector('#ls-exp-clear-pair')?.addEventListener('click', () => {
        this.expUpperPlantId = null;
        this.expLowerPlantId = null;
        this.expPairPage = 0;
        audio.playSfx('Tap', 0.75, 40);
        this.render();
      });
      this.uiRoot.querySelector('#ls-exp-quick')?.addEventListener('click', () => {
        const uncleared = assets.catalog.exploreLevels.filter((l) => !clearedExplore.includes(l.id));
        const pool = uncleared.length > 0 ? uncleared : assets.catalog.exploreLevels;
        const pick = pool[Math.floor(Math.random() * pool.length)];
        if (pick) {
          audio.playSfx('GraveButton', 0.85, 50);
          this.deps.onSelectLevel(buildExploreBoardConfig(pick, difficulty));
        }
      });
      this.uiRoot.querySelector('#ls-exp-mode-toggle')?.addEventListener('click', () => {
        this.exploreViewMode = 'browse';
        audio.playSfx('Tap', 0.75, 40);
        this.render();
      });
      this.bindExploreCards(difficulty);
      return;
    }

    // Browse mode: dynamically collect ONLY scenes that have >= 1 Explore level (no empty tabs!)
    const sceneCounts = new Map<number, number>();
    for (const l of assets.catalog.exploreLevels) {
      sceneCounts.set(l.sceneType, (sceneCounts.get(l.sceneType) ?? 0) + 1);
    }
    const dynamicTerrains: { key: string; label: string; bg: string }[] = [
      { key: 'all', label: `全部探索 (${assets.catalog.exploreLevels.length})`, bg: 'Day_1400x600.webp' },
      ...Array.from(sceneCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([sid, cnt]) => {
          const sc = assets.getScene(sid);
          return {
            key: String(sid),
            label: `${sc?.label ?? `地形${sid}`} (${cnt})`,
            bg: sc?.bg ?? 'Day_1400x600.webp',
          };
        }),
    ];

    const terrainIdx = Math.max(0, dynamicTerrains.findIndex((t) => t.key === this.exploreSceneFilter));
    const terrain = dynamicTerrains[terrainIdx];
    const q = this.exploreQuery.toLowerCase();

    const filtered = assets.catalog.exploreLevels.filter((l) => {
      if (terrain.key !== 'all' && String(l.sceneType) !== terrain.key) return false;
      if (q && !l.name.toLowerCase().includes(q) && !String(l.id).includes(q)) return false;
      return true;
    });

    const totalPages = Math.max(1, Math.ceil(filtered.length / EXPLORE_PAGE_SIZE));
    this.explorePage = Math.max(0, Math.min(totalPages - 1, this.explorePage));
    const pageItems = filtered.slice(
      this.explorePage * EXPLORE_PAGE_SIZE,
      (this.explorePage + 1) * EXPLORE_PAGE_SIZE,
    );
    const clearedFiltered = filtered.filter((l) => clearedExplore.includes(l.id)).length;

    const cardsHtml = pageItems
      .map((l, idx) => {
        const col = idx % 6;
        const row = Math.floor(idx / 6);
        const sc = assets.getScene(l.sceneType);
        const shortName = l.name.length > 7 ? `${l.name.slice(0, 7)}…` : l.name;
        return this.renderWindowCard({
          left: CARD_XS[col],
          top: EXPLORE_ROW_YS[row],
          sceneId: l.sceneType,
          iconUrl: this.pickPlantIcon([l.id, 1000 + (l.id % 45)], l.id),
          label: shortName,
          title: `${l.name} (#${l.id} · ${sc?.label ?? '草坪'} · ${l.maxWave}波 · 阳光${l.theSun}${l.convay ? ' · 传送带' : ''})`,
          dataAttr: `data-exp-id="${l.id}"`,
          cleared: clearedExplore.includes(l.id),
        });
      })
      .join('');

    this.uiRoot.innerHTML = `
      <div class="ls-backdrop ls-explore-mode" style="background-image:url('assets/bg/${terrain.bg}')">
        <img class="ls-exp-beam top" src="assets/ui/seed_chooser_btn.webp" alt="" />
        <img class="ls-exp-beam bot" src="assets/ui/seed_chooser_btn.webp" alt="" />

        <button class="ls-exp-terrain-arrow prev" id="ls-exp-scene-prev" title="切换上一个地形">
          <img src="assets/ui/zen_next.webp" alt="上一地形" />
        </button>
        <div class="ls-exp-title">配方探索 · ${terrain.label}</div>
        <button class="ls-exp-terrain-arrow next" id="ls-exp-scene-next" title="切换下一个地形">
          <img src="assets/ui/zen_next.webp" alt="下一地形" />
        </button>

        <div class="ls-exp-trophy-cnt">
          <img src="assets/ui/minigame_trophy.webp" alt="" />
          <span>${clearedFiltered}/${filtered.length}</span>
        </div>

        <div id="ls-exp-grid">${cardsHtml}</div>

        <button class="ls-unity-foot-btn" id="ls-back" style="left:22px;top:551px">
          <img src="assets/ui/seed_chooser_btn2.webp" data-base="assets/ui/seed_chooser_btn2.webp" data-hl="assets/ui/seed_chooser_btn2_glow.webp" alt="" />
          <span>返回菜单</span>
        </button>
        <button class="ls-unity-foot-btn" id="ls-exp-mode-toggle" style="left:172px;top:551px">
          <img src="assets/ui/seed_chooser_btn2.webp" data-base="assets/ui/seed_chooser_btn2.webp" data-hl="assets/ui/seed_chooser_btn2_glow.webp" alt="" />
          <span>配对选关</span>
        </button>
        <button class="ls-unity-foot-btn" id="ls-exp-quick" style="left:322px;top:551px">
          <img src="assets/ui/seed_chooser_btn2.webp" data-base="assets/ui/seed_chooser_btn2.webp" data-hl="assets/ui/seed_chooser_btn2_glow.webp" alt="" />
          <span>快速开始</span>
        </button>

        <input class="ls-exp-search" id="ls-exp-q" type="search" value="${escHtml(this.exploreQuery)}" placeholder="搜索名称或ID..." />

        <button class="ls-unity-foot-btn sm" id="ls-exp-prev" style="left:682px;top:551px" ${this.explorePage === 0 ? 'disabled' : ''}>
          <img src="assets/ui/seed_chooser_btn2.webp" data-base="assets/ui/seed_chooser_btn2.webp" data-hl="assets/ui/seed_chooser_btn2_glow.webp" alt="" />
          <span>上一页</span>
        </button>
        <div class="ls-exp-page-txt">${this.explorePage + 1}/${totalPages}</div>
        <button class="ls-unity-foot-btn sm" id="ls-exp-next" style="left:904px;top:551px" ${this.explorePage >= totalPages - 1 ? 'disabled' : ''}>
          <img src="assets/ui/seed_chooser_btn2.webp" data-base="assets/ui/seed_chooser_btn2.webp" data-hl="assets/ui/seed_chooser_btn2_glow.webp" alt="" />
          <span>下一页</span>
        </button>
      </div>
    `;

    this.bindCommonControls();

    const stepTerrain = (delta: number) => {
      const nextIdx = (terrainIdx + delta + dynamicTerrains.length) % dynamicTerrains.length;
      this.exploreSceneFilter = dynamicTerrains[nextIdx].key;
      this.explorePage = 0;
      audio.playSfx('Tap', 0.75, 40);
      this.render();
    };
    this.uiRoot.querySelector('#ls-exp-scene-prev')?.addEventListener('click', () => stepTerrain(-1));
    this.uiRoot.querySelector('#ls-exp-scene-next')?.addEventListener('click', () => stepTerrain(1));
    this.uiRoot.querySelector('#ls-exp-prev')?.addEventListener('click', () => {
      if (this.explorePage > 0) {
        this.explorePage -= 1;
        audio.playSfx('Tap', 0.75, 40);
        this.render();
      }
    });
    this.uiRoot.querySelector('#ls-exp-next')?.addEventListener('click', () => {
      if (this.explorePage < totalPages - 1) {
        this.explorePage += 1;
        audio.playSfx('Tap', 0.75, 40);
        this.render();
      }
    });
    this.uiRoot.querySelector('#ls-exp-mode-toggle')?.addEventListener('click', () => {
      this.exploreViewMode = 'pair';
      audio.playSfx('Tap', 0.75, 40);
      this.render();
    });
    this.uiRoot.querySelector('#ls-exp-quick')?.addEventListener('click', () => {
      const uncleared = filtered.filter((l) => !clearedExplore.includes(l.id));
      const pool = uncleared.length > 0 ? uncleared : filtered;
      const pick = pool[Math.floor(Math.random() * pool.length)];
      if (pick) {
        audio.playSfx('GraveButton', 0.85, 50);
        this.deps.onSelectLevel(buildExploreBoardConfig(pick, difficulty));
      }
    });

    const searchInput = this.uiRoot.querySelector<HTMLInputElement>('#ls-exp-q');
    searchInput?.addEventListener('input', (e) => {
      this.exploreQuery = (e.target as HTMLInputElement).value.trim();
      this.explorePage = 0;
      const val = (e.target as HTMLInputElement).value;
      const pos = (e.target as HTMLInputElement).selectionStart ?? val.length;
      this.render();
      const restored = this.uiRoot.querySelector<HTMLInputElement>('#ls-exp-q');
      if (restored) {
        restored.focus();
        restored.setSelectionRange(pos, pos);
      }
    });

    this.bindExploreCards(difficulty);
  }

  private bindExploreCards(difficulty: number): void {
    this.uiRoot.querySelectorAll<HTMLButtonElement>('[data-exp-id]').forEach((b) => {
      b.addEventListener('click', () => {
        const found = assets.getExploreLevel(Number(b.dataset.expId));
        if (found) {
          audio.playSfx('GraveButton', 0.85, 50);
          this.deps.onSelectLevel(buildExploreBoardConfig(found, difficulty));
        }
      });
    });
  }

  /** ==================== 5. SURVIVAL MENU (SurvivalMenu 2 Pages / 21 Levels) ==================== */
  private renderSurvival(difficulty: number, bestSurvivalRounds: Record<string, number>): void {
    const pages = getSurvivalPages(difficulty);
    this.survivalPage = Math.max(0, Math.min(pages.length - 1, this.survivalPage));
    const pageList = pages[this.survivalPage];
    const launchMap = new Map<string, BoardConfig>();

    const cards = pageList.map((spec, idx) => {
      launchMap.set(spec.config.levelKey, spec.config);
      const rounds = bestSurvivalRounds[spec.config.levelKey] ?? 0;
      return this.renderWindowCard({
        left: CARD_XS[idx % 6],
        top: CHALLENGES_ROW_YS[Math.floor(idx / 6)],
        sceneId: spec.config.scene.id,
        iconUrl: this.pickPlantIcon([spec.iconPlantId], idx),
        label: spec.label,
        title: `${spec.config.title} · ${spec.config.subtitle}${spec.config.tips ? ` — ${spec.config.tips}` : ''}`,
        dataAttr: `data-launch-key="${spec.config.levelKey}"`,
        badgeText: spec.isEndless && rounds > 0 ? `${rounds}轮` : undefined,
        cleared: !spec.isEndless && rounds > 0,
      });
    });

    this.uiRoot.innerHTML = `
      <div class="ls-backdrop ls-chal-mode" style="background-image:url('assets/ui/challenge_bg.webp')">
        <div class="ls-chal-arch-title">生存模式</div>
        ${cards.join('')}

        <button class="ls-unity-foot-btn" id="ls-back" style="left:21px;top:559px">
          <img src="assets/ui/seed_chooser_btn2.webp" data-base="assets/ui/seed_chooser_btn2.webp" data-hl="assets/ui/seed_chooser_btn2_glow.webp" alt="" />
          <span>返回菜单</span>
        </button>
        <button class="ls-unity-foot-btn sm" id="ls-sur-prev" style="left:360px;top:559px" ${this.survivalPage === 0 ? 'disabled' : ''}>
          <img src="assets/ui/seed_chooser_btn2.webp" data-base="assets/ui/seed_chooser_btn2.webp" data-hl="assets/ui/seed_chooser_btn2_glow.webp" alt="" />
          <span>上一页</span>
        </button>
        <div class="ls-exp-page-txt" style="left:466px;top:562px">${this.survivalPage + 1}/${pages.length}</div>
        <button class="ls-unity-foot-btn sm" id="ls-sur-next" style="left:562px;top:559px" ${this.survivalPage >= pages.length - 1 ? 'disabled' : ''}>
          <img src="assets/ui/seed_chooser_btn2.webp" data-base="assets/ui/seed_chooser_btn2.webp" data-hl="assets/ui/seed_chooser_btn2_glow.webp" alt="" />
          <span>下一页</span>
        </button>
        <button class="ls-unity-foot-btn" id="ls-diff-cycle" style="left:898px;top:559px" title="点击切换难度">
          <img src="assets/ui/seed_chooser_btn2.webp" data-base="assets/ui/seed_chooser_btn2.webp" data-hl="assets/ui/seed_chooser_btn2_glow.webp" alt="" />
          <span>${DIFF_LABELS[difficulty - 1] ?? '普通模式'}</span>
        </button>
      </div>
    `;

    this.bindCommonControls(launchMap);
    this.uiRoot.querySelector('#ls-sur-prev')?.addEventListener('click', () => {
      if (this.survivalPage > 0) {
        this.survivalPage -= 1;
        audio.playSfx('Tap', 0.75, 40);
        this.render();
      }
    });
    this.uiRoot.querySelector('#ls-sur-next')?.addEventListener('click', () => {
      if (this.survivalPage < pages.length - 1) {
        this.survivalPage += 1;
        audio.playSfx('Tap', 0.75, 40);
        this.render();
      }
    });
  }

  /** ==================== 6. IZ MENU (IZMenu 92 Official I, Zombie Levels) ==================== */
  private renderIzMenu(difficulty: number, clearedIz: string[]): void {
    if (!this.izLevels && !this.izLoading) {
      this.izLoading = true;
      void assets.loadIzLevels().then((list) => {
        this.izLevels = [...list].sort((a, b) => getIzSortOrder(a.name) - getIzSortOrder(b.name));
        this.izLoading = false;
        if (this.tab === 'iz') this.render();
      });
    }

    if (!this.izLevels) {
      this.uiRoot.innerHTML = `
        <div class="ls-backdrop ls-chal-mode" style="background-image:url('assets/ui/challenge_bg.webp')">
          <div class="ls-chal-arch-title">解谜模式</div>
          <div class="ls-iz-loading">正在加载我是僵尸官方关卡库（92 关）...</div>
          <button class="ls-unity-foot-btn" id="ls-back" style="left:21px;top:559px">
            <img src="assets/ui/seed_chooser_btn2.webp" data-base="assets/ui/seed_chooser_btn2.webp" data-hl="assets/ui/seed_chooser_btn2_glow.webp" alt="" />
            <span>返回菜单</span>
          </button>
        </div>
      `;
      this.bindCommonControls();
      return;
    }

    const grp = IZ_GROUPS[this.izGroupIdx] ?? IZ_GROUPS[0];
    const filtered = this.izLevels.filter((e) => grp.match(getIzSortOrder(e.name)));
    const totalPages = Math.max(1, Math.ceil(filtered.length / GRID_PAGE_SIZE));
    this.izPage = Math.max(0, Math.min(totalPages - 1, this.izPage));
    const slice = filtered.slice(this.izPage * GRID_PAGE_SIZE, (this.izPage + 1) * GRID_PAGE_SIZE);
    const clearedSet = new Set(clearedIz);
    const launchMap = new Map<string, BoardConfig>();

    const cardsHtml = slice
      .map((entry, idx) => {
        const cfg = buildIzBoardConfig(entry, difficulty);
        launchMap.set(cfg.levelKey, cfg);
        const label = formatIzDisplayName(entry.name);
        const shortLabel = label.length > 9 ? `${label.slice(0, 9)}…` : label;
        const firstZ = entry.data.zombietTypes[0] ?? 0;
        return this.renderWindowCard({
          left: CARD_XS[idx % 6],
          top: CHALLENGES_ROW_YS[Math.floor(idx / 6)],
          sceneId: cfg.scene.id,
          iconUrl: this.pickZombieIcon([firstZ, 0]),
          label: shortLabel,
          title: `${label} · 初始阳光 ${entry.data.theSun} · 红线第${entry.data.redlineColumn}列 · ${entry.data.plants.length}株防守植物`,
          dataAttr: `data-launch-key="${cfg.levelKey}"`,
          cleared: clearedSet.has(entry.name),
          badgeText: `☀${entry.data.theSun}`,
        });
      })
      .join('');

    this.uiRoot.innerHTML = `
      <div class="ls-backdrop ls-chal-mode" style="background-image:url('assets/ui/challenge_bg.webp')">
        <div class="ls-chal-arch-title">解谜模式 · ${grp.label}</div>
        ${cardsHtml}

        <button class="ls-unity-foot-btn" id="ls-back" style="left:21px;top:559px">
          <img src="assets/ui/seed_chooser_btn2.webp" data-base="assets/ui/seed_chooser_btn2.webp" data-hl="assets/ui/seed_chooser_btn2_glow.webp" alt="" />
          <span>返回菜单</span>
        </button>
        <button class="ls-unity-foot-btn" id="ls-iz-grp" style="left:176px;top:559px">
          <img src="assets/ui/seed_chooser_btn2.webp" data-base="assets/ui/seed_chooser_btn2.webp" data-hl="assets/ui/seed_chooser_btn2_glow.webp" alt="" />
          <span>切换关卡组</span>
        </button>
        <button class="ls-unity-foot-btn sm" id="ls-iz-prev" style="left:410px;top:559px" ${this.izPage === 0 ? 'disabled' : ''}>
          <img src="assets/ui/seed_chooser_btn2.webp" data-base="assets/ui/seed_chooser_btn2.webp" data-hl="assets/ui/seed_chooser_btn2_glow.webp" alt="" />
          <span>上一页</span>
        </button>
        <div class="ls-exp-page-txt" style="left:516px;top:562px">${this.izPage + 1}/${totalPages}</div>
        <button class="ls-unity-foot-btn sm" id="ls-iz-next" style="left:612px;top:559px" ${this.izPage >= totalPages - 1 ? 'disabled' : ''}>
          <img src="assets/ui/seed_chooser_btn2.webp" data-base="assets/ui/seed_chooser_btn2.webp" data-hl="assets/ui/seed_chooser_btn2_glow.webp" alt="" />
          <span>下一页</span>
        </button>
        <div class="ls-iz-cnt-pill">已通关 ${clearedIz.length}/92</div>
      </div>
    `;

    this.bindCommonControls(launchMap);
    this.uiRoot.querySelector('#ls-iz-grp')?.addEventListener('click', () => {
      this.izGroupIdx = (this.izGroupIdx + 1) % IZ_GROUPS.length;
      this.izPage = 0;
      audio.playSfx('Tap', 0.75, 40);
      this.render();
    });
    this.uiRoot.querySelector('#ls-iz-prev')?.addEventListener('click', () => {
      if (this.izPage > 0) {
        this.izPage -= 1;
        audio.playSfx('Tap', 0.75, 40);
        this.render();
      }
    });
    this.uiRoot.querySelector('#ls-iz-next')?.addEventListener('click', () => {
      if (this.izPage < totalPages - 1) {
        this.izPage += 1;
        audio.playSfx('Tap', 0.75, 40);
        this.render();
      }
    });
  }

  /** ==================== 7. HOT LEVEL MENU (HotLevelMenu) ==================== */
  private renderHotMenu(difficulty: number, clearedChallenges: string[]): void {
    const launchMap = new Map<string, BoardConfig>();
    const snowNight = buildNightSnowExploreConfig(difficulty);
    const surPages = getSurvivalPages(difficulty);
    const poolCrisis = surPages[0].find((s) => s.config.levelKey === 'sur-pool-crisis')!.config;
    const starEndless = getStarChallengeLevels(difficulty).find((s) => s.config.levelKey === 'sc-pool-endless')!.config;
    const superCherry = getChallengeGroups(difficulty).unlock.levels[0];
    const godsMode = getTravelGameStages(difficulty).find((g) => g.config.levelKey === 'trv-gods')!.config;
    const stackerCfg = buildStackerBoardConfig(difficulty);
    const maliangCfg = buildMaLiangBoardConfig(difficulty);
    const towerFirstCfg = getTowerDefenseLevels(difficulty)[0];

    launchMap.set(snowNight.levelKey, snowNight);
    launchMap.set(poolCrisis.levelKey, poolCrisis);
    launchMap.set(starEndless.levelKey, starEndless);
    launchMap.set(superCherry.levelKey, superCherry);
    launchMap.set(godsMode.levelKey, godsMode);
    launchMap.set(stackerCfg.levelKey, stackerCfg);
    launchMap.set(maliangCfg.levelKey, maliangCfg);
    launchMap.set(towerFirstCfg.levelKey, towerFirstCfg);

    const cards: WindowCardSpec[] = [
      { left: CARD_XS[0], top: CHALLENGES_ROW_YS[0], sceneId: 40, iconUrl: this.pickPlantIcon([36]), label: '冒险支线：雪夜', title: snowNight.title, dataAttr: `data-launch-key="${snowNight.levelKey}"`, cleared: clearedChallenges.includes(snowNight.levelKey) },
      { left: CARD_XS[1], top: CHALLENGES_ROW_YS[0], sceneId: 6, iconUrl: this.pickPlantIcon([14]), label: '超级自定义关卡', title: '前往自由沙盒12地形任选测试', dataAttr: 'data-tab="sandbox"' },
      { left: CARD_XS[2], top: CHALLENGES_ROW_YS[0], sceneId: 2, iconUrl: this.pickPlantIcon([901]), label: '泳池无尽：危机', title: poolCrisis.title, dataAttr: `data-launch-key="${poolCrisis.levelKey}"` },
      { left: CARD_XS[3], top: CHALLENGES_ROW_YS[0], sceneId: 2, iconUrl: this.pickPlantIcon([16]), label: '星辉无尽：泳池', title: starEndless.title, dataAttr: `data-launch-key="${starEndless.levelKey}"` },
      { left: CARD_XS[4], top: CHALLENGES_ROW_YS[0], sceneId: 0, iconUrl: this.pickPlantIcon([1005]), label: '超级樱桃射手\n挑战关卡', title: superCherry.title, dataAttr: `data-launch-key="${superCherry.levelKey}"`, cleared: clearedChallenges.includes(superCherry.levelKey) },
      { left: CARD_XS[5], top: CHALLENGES_ROW_YS[0], sceneId: 25, iconUrl: this.pickZombieIcon([0]), label: '我是僵尸 1-1\n光茵荏苒', title: '立即进入我是僵尸官方首关', dataAttr: 'data-hot-iz1="1"' },
      { left: CARD_XS[0], top: CHALLENGES_ROW_YS[1], sceneId: 4, iconUrl: this.pickPlantIcon([249, 909]), label: '诸神进化', title: godsMode.tips ?? godsMode.title, dataAttr: `data-launch-key="${godsMode.levelKey}"`, cleared: saveManager.current.travel.clearedTravelLevels.includes(godsMode.levelKey) },
      { left: CARD_XS[1], top: CHALLENGES_ROW_YS[1], sceneId: 0, iconUrl: this.pickPlantIcon([3, 24]), label: '超级叠叠乐', title: stackerCfg.tips ?? stackerCfg.title, dataAttr: `data-launch-key="${stackerCfg.levelKey}"`, cleared: clearedChallenges.includes(stackerCfg.levelKey) },
      { left: CARD_XS[2], top: CHALLENGES_ROW_YS[1], sceneId: 0, iconUrl: 'assets/ui/modes/maliang_pen.webp', label: '神笔马良', title: maliangCfg.tips ?? maliangCfg.title, dataAttr: `data-launch-key="${maliangCfg.levelKey}"`, cleared: clearedChallenges.includes(maliangCfg.levelKey) },
      { left: CARD_XS[3], top: CHALLENGES_ROW_YS[1], sceneId: 0, iconUrl: this.pickPlantIcon([352]), label: '塔防模式', title: towerFirstCfg.tips ?? towerFirstCfg.title, dataAttr: `data-launch-key="${towerFirstCfg.levelKey}"`, cleared: clearedChallenges.includes(towerFirstCfg.levelKey) },
    ];

    this.uiRoot.innerHTML = `
      <div class="ls-backdrop ls-chal-mode" style="background-image:url('assets/ui/challenge_bg.webp')">
        <div class="ls-chal-arch-title">推荐关卡</div>
        ${cards.map((c) => this.renderWindowCard(c)).join('')}

        <button class="ls-unity-foot-btn" id="ls-back" style="left:21px;top:559px">
          <img src="assets/ui/seed_chooser_btn2.webp" data-base="assets/ui/seed_chooser_btn2.webp" data-hl="assets/ui/seed_chooser_btn2_glow.webp" alt="" />
          <span>返回菜单</span>
        </button>
        <button class="ls-unity-foot-btn" id="ls-diff-cycle" style="left:898px;top:559px" title="点击切换难度">
          <img src="assets/ui/seed_chooser_btn2.webp" data-base="assets/ui/seed_chooser_btn2.webp" data-hl="assets/ui/seed_chooser_btn2_glow.webp" alt="" />
          <span>${DIFF_LABELS[difficulty - 1] ?? '普通模式'}</span>
        </button>
      </div>
    `;

    this.bindCommonControls(launchMap);
    this.uiRoot.querySelector('[data-hot-iz1]')?.addEventListener('click', async () => {
      const list = await assets.loadIzLevels();
      const first = list.find((x) => x.name.startsWith('101')) ?? list[0];
      if (first) {
        audio.playSfx('GraveButton', 0.85, 50);
        this.deps.onSelectLevel(buildIzBoardConfig(first, difficulty));
      }
    });
  }

  /** ==================== 8. SANDBOX GRID (Fixed Scene IDs) ==================== */
  private renderSandboxGrid(difficulty: number): void {
    const launchMap = new Map<string, BoardConfig>();
    const specs = getSandboxSpecs();
    const cards = specs.map((s, idx) => {
      const cfg = buildSandboxBoardConfig(s.sid);
      launchMap.set(cfg.levelKey, cfg);
      return this.renderWindowCard({
        left: CARD_XS[idx % 6],
        top: CHALLENGES_ROW_YS[Math.floor(idx / 6)],
        sceneId: s.sid,
        iconUrl: this.pickPlantIcon([s.pid], s.sid),
        label: s.label,
        title: `自由沙盒 · ${s.label} (${assets.getScene(s.sid)?.rows ?? 5}行)`,
        dataAttr: `data-launch-key="${cfg.levelKey}"`,
      });
    });

    this.uiRoot.innerHTML = `
      <div class="ls-backdrop ls-chal-mode" style="background-image:url('assets/ui/challenge_bg.webp')">
        <div class="ls-chal-arch-title">自由沙盒</div>
        ${cards.join('')}

        <button class="ls-unity-foot-btn" id="ls-back" style="left:21px;top:559px">
          <img src="assets/ui/seed_chooser_btn2.webp" data-base="assets/ui/seed_chooser_btn2.webp" data-hl="assets/ui/seed_chooser_btn2_glow.webp" alt="" />
          <span>返回菜单</span>
        </button>
        <button class="ls-unity-foot-btn" data-tab="challenge" style="left:176px;top:559px">
          <img src="assets/ui/seed_chooser_btn2.webp" data-base="assets/ui/seed_chooser_btn2.webp" data-hl="assets/ui/seed_chooser_btn2_glow.webp" alt="" />
          <span>返回挑战</span>
        </button>
        <button class="ls-unity-foot-btn" id="ls-diff-cycle" style="left:898px;top:559px" title="点击切换难度">
          <img src="assets/ui/seed_chooser_btn2.webp" data-base="assets/ui/seed_chooser_btn2.webp" data-hl="assets/ui/seed_chooser_btn2_glow.webp" alt="" />
          <span>${DIFF_LABELS[difficulty - 1] ?? '普通模式'}</span>
        </button>
      </div>
    `;

    this.bindCommonControls(launchMap);
  }

  private bindCommonControls(launchMap?: Map<string, BoardConfig>): void {
    bindHoverImages(this.uiRoot);
    this.uiRoot.querySelector('#ls-back')?.addEventListener('click', () => {
      audio.playSfx('ButtonClick', 0.8, 40);
      this.deps.onBack();
    });
    this.uiRoot.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => {
      b.addEventListener('click', () => {
        this.tab = b.dataset.tab as LevelTab;
        if (this.tab === 'challenge') this.challengeGroup = null;
        if (this.tab === 'adventure') this.advSubMenu = null;
        audio.playSfx('Tap', 0.75, 40);
        this.render();
      });
    });
    this.uiRoot.querySelector('#ls-diff-cycle')?.addEventListener('click', () => {
      const next = (saveManager.current.difficulty % 5) + 1;
      saveManager.update({ difficulty: next });
      audio.playSfx('Tap', 0.75, 40);
      this.render();
    });
    if (launchMap) {
      this.uiRoot.querySelectorAll<HTMLButtonElement>('[data-launch-key]').forEach((b) => {
        b.addEventListener('click', () => {
          const cfg = launchMap.get(b.dataset.launchKey!);
          if (cfg) {
            audio.playSfx('GraveButton', 0.85, 50);
            this.deps.onSelectLevel(cfg);
          }
        });
      });
    }
  }

  private openTombModal(title: string, bodyHtml: string, btnLabel: string): HTMLElement {
    this.closeModal();
    const modal = document.createElement('div');
    modal.className = 'pvz-modal-backdrop';
    modal.innerHTML = `
      <div class="pvz-tomb-dialog">
        <img class="pvz-tomb-bg" src="assets/ui/options_menuback.webp" alt="" />
        <div class="pvz-tomb-inner">
          <div class="pvz-tomb-hdr">${escHtml(title)}</div>
          <div class="help-text">${bodyHtml}</div>
          <button class="pvz-tomb-done-btn" id="ls-m-close">
            <img src="assets/ui/options_backtogame.webp" alt="确定" />
            <span>${escHtml(btnLabel)}</span>
          </button>
        </div>
      </div>
    `;
    this.uiRoot.appendChild(modal);
    this.modalEl = modal;
    modal.querySelector('#ls-m-close')?.addEventListener('click', () => this.closeModal());
    return modal;
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
