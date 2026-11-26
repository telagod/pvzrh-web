import './styles.css';
import { assets } from './assets/AssetLoader';
import { BoardEngine } from './engine/BoardEngine';
import { fusionSystem } from './engine/FusionSystem';
import { clampDifficulty } from './save/difficulty';
import { saveManager } from './save/SaveManager';
import type { BattleToolId, BoardConfig, DeckSlot, ScreenId } from './types/game';
import type { Almanac } from './ui/Almanac';
import { BattleHud } from './ui/BattleHud';
import type { LevelTab } from './ui/LevelSelect';
import { LoadingOverlay } from './ui/LoadingOverlay';
import { MainMenu } from './ui/MainMenu';
import { SeedChooser } from './ui/SeedChooser';
import { getTowerDefenseLevels } from './ui/towerCatalog';
import { tryLockLandscape } from './utils/viewport';
import {
  buildIzBoardConfig,
  buildRecommendedDeck,
  buildSandboxBoardConfig,
  getClassicAdventureLevels,
  getIzSortOrder,
  getStarryAdventureChapters,
  getVasebreakerLevels,
} from './ui/levelsCatalog';

class PvzWebApp {
  private readonly stageShell = document.getElementById('stage-shell')!;
  private readonly pixiRoot = document.getElementById('pixi-root')!;
  private readonly uiRoot = document.getElementById('ui-root')!;
  private readonly loading = new LoadingOverlay(document.getElementById('loading-root')!);

  private screen: ScreenId = 'menu';
  private navToken = 0;
  private activeCleanup: (() => void) | null = null;
  private battleAlmanacOverlay: Almanac | null = null;
  private activeBoard: BoardEngine | null = null;

  async boot(): Promise<void> {
    this.bindProportionalUiScaler();
    this.exposeDebugHandle();
    this.loading.show({
      title: '植物大战僵尸 · 融合版 4.1',
      detail: '正在连接资源...',
      ratio: 0.02,
      badge: '首次启动',
    });
    try {
      await assets.init((ratio, detail, countText) =>
        this.loading.update(0.02 + ratio * 0.43, detail, countText),
      );
      await assets.preloadMainMenuAssets((ratio, detail, countText) =>
        this.loading.update(0.45 + ratio * 0.45, detail, countText),
      );
      await this.openMainMenu({ managedLoader: true });
      await this.loading.finish('欢迎回来！', this.uiRoot);
    } catch (err) {
      this.loading.showError('资源加载失败', (err as Error).message, () => location.reload());
    }
  }

  private bindProportionalUiScaler(): void {
    const syncScale = () => {
      const vw = Math.round(window.visualViewport?.width ?? window.innerWidth);
      const vh = Math.round(window.visualViewport?.height ?? window.innerHeight);
      document.documentElement.style.setProperty('--vw', `${vw}px`);
      document.documentElement.style.setProperty('--vh', `${vh}px`);
      const isPortrait = vh > vw;
      const hasCoarse =
        typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
      const hasFine =
        typeof window.matchMedia === 'function' && window.matchMedia('(pointer: fine)').matches;
      const isMobileUA = /Android|iPhone|iPod|Mobile|HarmonyOS|MicroMessenger/i.test(navigator.userAgent);
      const isTouchPhone = (hasCoarse && !hasFine) || isMobileUA;
      document.body.classList.toggle('force-landscape', isPortrait && isTouchPhone);

      const updateUiVar = () => {
        const w = this.stageShell.clientWidth || 1066;
        this.stageShell.style.setProperty('--ui-scale', String(w / 1066));
      };
      updateUiVar();
      requestAnimationFrame(updateUiVar);
    };
    syncScale();
    tryLockLandscape();
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => {
        const w = this.stageShell.clientWidth || 1066;
        this.stageShell.style.setProperty('--ui-scale', String(w / 1066));
      }).observe(this.stageShell);
    }
    window.addEventListener('resize', syncScale);
    window.addEventListener('orientationchange', syncScale);
    window.visualViewport?.addEventListener('resize', syncScale);
    window.addEventListener(
      'pointerdown',
      () => {
        if (
          document.body.classList.contains('force-landscape') ||
          /Android|iPhone|iPod|Mobile|HarmonyOS/i.test(navigator.userAgent)
        ) {
          tryLockLandscape();
        }
      },
      { passive: true },
    );
  }

  private teardownCurrent(keepLoader = false): void {
    this.navToken++;
    if (!keepLoader) {
      this.loading.hideImmediate();
    }
    const prevScreen = this.screen;
    if (this.battleAlmanacOverlay) {
      this.battleAlmanacOverlay.destroy();
      this.battleAlmanacOverlay = null;
    }
    if (this.activeCleanup) {
      this.activeCleanup();
      this.activeCleanup = null;
    }
    this.activeBoard = null;
    if (prevScreen === 'battle' || prevScreen === 'almanac') {
      assets.trimCaches();
    }
  }

  private resolveOriginTab(config: BoardConfig): LevelTab {
    if (config.challengeKey?.startsWith('sc-')) return 'star_challenge';
    if (config.challengeKey === 'hot-nightsnow' || config.challengeKey === 'hot-stacker' || config.challengeKey === 'hot-maliang') return 'hot';
    if (config.adventureIndex || config.mode === 'tower') return 'challenge';
    if (config.mode === 'challenge' || config.mode === 'vasebreaker') return 'challenge';
    if (config.mode === 'explore') return 'explore';
    if (config.mode === 'survival') return 'survival';
    if (config.mode === 'iz') return 'iz';
    if (config.mode === 'sandbox') return 'sandbox';
    return 'adventure';
  }

  private async launchNextLevel(
    config: BoardConfig,
    opts?: { launchedFromMenu?: boolean },
  ): Promise<void> {
    const diff = saveManager.current.difficulty;
    if (config.mode === 'travel' && config.travelMeta?.isRunRound) {
      this.openTravel();
      return;
    }
    if (config.mode === 'abyss' && config.abyssStage) {
      if (config.abyssStage < 15) {
        const { buildAbyssStageBoardConfig } = await import('./ui/AbyssMode');
        this.startBattle(
          buildAbyssStageBoardConfig(config.abyssStage + 1, saveManager.current.abyss.warehouse, diff),
          opts,
        );
      } else {
        this.openAbyss();
      }
      return;
    }
    if (config.mode === 'tower') {
      const list = getTowerDefenseLevels(diff).filter((t) => !t.endless);
      const i = list.findIndex((t) => t.levelKey === config.levelKey);
      if (i >= 0 && i + 1 < list.length) {
        this.startBattle(list[i + 1], opts);
      }
      return;
    }
    if (config.mode === 'vasebreaker') {
      const list = getVasebreakerLevels(diff);
      const i = list.findIndex((l) => l.levelKey === config.levelKey);
      if (i >= 0 && i + 1 < list.length) {
        this.startBattle(list[i + 1], opts);
      }
      return;
    }
    if (config.starMainKey) {
      const list = getStarryAdventureChapters(diff).flatMap((c) => c.mainLevels);
      const i = list.findIndex((l) => l.starMainKey === config.starMainKey);
      if (i >= 0 && i + 1 < list.length) {
        this.startBattle(list[i + 1], opts);
      }
      return;
    }
    if (config.starSubKey) {
      const list = getStarryAdventureChapters(diff).flatMap((c) => c.subLevels);
      const i = list.findIndex((l) => l.starSubKey === config.starSubKey);
      if (i >= 0 && i + 1 < list.length) {
        this.startBattle(list[i + 1], opts);
      }
      return;
    }
    if (config.adventureIndex) {
      const list = getClassicAdventureLevels(diff);
      const next = list.find((l) => l.adventureIndex === config.adventureIndex! + 1);
      if (next) this.startBattle(next, opts);
      return;
    }
    if (config.izConfig) {
      const rawList = await assets.loadIzLevels();
      const sorted = [...rawList].sort((a, b) => getIzSortOrder(a.name) - getIzSortOrder(b.name));
      const i = sorted.findIndex((e) => e.name === config.izConfig!.name);
      if (i >= 0 && i + 1 < sorted.length) {
        this.startBattle(buildIzBoardConfig(sorted[i + 1], diff), opts);
      }
    }
  }

  async openMainMenu(opts?: { managedLoader?: boolean }): Promise<void> {
    this.teardownCurrent(Boolean(opts?.managedLoader));
    this.screen = 'menu';
    const token = this.navToken;
    const needBlockingLoad = !opts?.managedLoader && assets.hasUncachedMainMenuAssets();
    if (needBlockingLoad) {
      this.loading.show({
        title: '正在返回主菜单...',
        detail: '正在准备主菜单场景贴图...',
        ratio: 0.08,
      });
    }
    const mm = new MainMenu(this.pixiRoot, this.uiRoot, {
      onNavigate: (scr, navOpts) => {
        if (scr === 'levels') this.openLevelSelect(navOpts?.tab ?? 'adventure');
        else if (scr === 'almanac') this.openAlmanac('index');
        else if (scr === 'garden') this.openGarden();
        else if (scr === 'travel') this.openTravel();
        else if (scr === 'abyss') this.openAbyss();
      },
      onStartClassicAdventure: () => {
        const advLv = Math.max(1, Math.min(45, Math.floor(saveManager.current.advLevel || 1)));
        const list = getClassicAdventureLevels(saveManager.current.difficulty);
        const cfg = list[advLv - 1] ?? list[0];
        this.startBattle(cfg, { launchedFromMenu: true });
      },
      onStartSandbox: () => this.startBattle(buildSandboxBoardConfig(0)),
    });
    this.activeCleanup = () => mm.destroy();
    try {
      await mm.mount((r, d, c) => {
        if (token !== this.navToken) return;
        if (opts?.managedLoader) {
          this.loading.update(0.9 + r * 0.1, d, c);
        } else if (needBlockingLoad) {
          this.loading.update(0.08 + r * 0.92, d, c);
        }
      });
      if (token !== this.navToken) return;
      if (needBlockingLoad) {
        await this.loading.finish('主菜单已就绪', this.uiRoot);
      }
    } catch (err) {
      if (token === this.navToken && (opts?.managedLoader || needBlockingLoad)) {
        this.loading.showError('主菜单加载失败', (err as Error).message, () => {
          void this.openMainMenu();
        });
      }
    }
  }

  openLevelSelect(tab: LevelTab = 'adventure'): void {
    this.teardownCurrent();
    this.screen = 'levels';
    const token = this.navToken;
    this.loading.show({
      title: tab === 'iz' ? '正在打开解谜模式 · 我是僵尸' : '正在打开选关界面',
      detail: tab === 'iz' ? '正在按需加载我是僵尸关卡库...' : '正在准备关卡列表...',
      ratio: 0.15,
    });
    void (async () => {
      try {
        const modPromise = import('./ui/LevelSelect');
        const izPromise = tab === 'iz' ? assets.loadIzLevels() : Promise.resolve([]);
        const [{ LevelSelect }] = await Promise.all([modPromise, izPromise]);
        if (token !== this.navToken) return;
        this.loading.update(0.8, '正在渲染选关界面...');
        const ls = new LevelSelect(this.uiRoot, {
          initialTab: tab,
          onBack: () => void this.openMainMenu(),
          onSelectLevel: (cfg) => this.startBattle(cfg),
        });
        this.activeCleanup = () => ls.destroy();
        ls.mount();
        await this.loading.finish('选关界面已就绪');
      } catch (err) {
        if (token === this.navToken) {
          this.loading.showError('选关加载失败', (err as Error).message, () => this.openLevelSelect(tab));
        }
      }
    })();
  }

  openAlmanac(initialView: 'index' | 'plants' = 'index'): void {
    this.teardownCurrent();
    this.screen = 'almanac';
    const token = this.navToken;
    this.loading.show({
      title: '正在打开融合图鉴',
      detail: '正在加载图鉴模块与展示台...',
      ratio: 0.1,
    });
    void (async () => {
      try {
        const { Almanac } = await import('./ui/Almanac');
        if (token !== this.navToken) return;
        this.loading.update(0.3, '正在加载图鉴展示台素材...');
        const alm = new Almanac(this.uiRoot, () => void this.openMainMenu(), undefined, initialView);
        this.activeCleanup = () => alm.destroy();
        await alm.mount((r, d, c) => {
          if (token === this.navToken) this.loading.update(0.3 + r * 0.7, d, c);
        });
        if (token !== this.navToken) return;
        await this.loading.finish('图鉴已就绪');
      } catch (err) {
        if (token === this.navToken) {
          this.loading.showError('图鉴加载失败', (err as Error).message, () => this.openAlmanac(initialView));
        }
      }
    })();
  }

  openGarden(): void {
    this.teardownCurrent();
    this.screen = 'garden';
    const token = this.navToken;
    this.loading.show({
      title: '正在进入禅境花园',
      detail: '正在加载温室模块...',
      ratio: 0.08,
    });
    void (async () => {
      try {
        const { ZenGarden } = await import('./ui/ZenGarden');
        if (token !== this.navToken) return;
        this.loading.update(0.22, '正在按需加载温室与盆栽动画...');
        const zg = new ZenGarden(this.pixiRoot, this.uiRoot, {
          onBack: () => void this.openMainMenu(),
        });
        this.activeCleanup = () => zg.destroy();
        await zg.mount((r, d, c) => {
          if (token === this.navToken) this.loading.update(0.22 + r * 0.78, d, c);
        });
        if (token !== this.navToken) return;
        await this.loading.finish('禅境花园已就绪', this.uiRoot);
      } catch (err) {
        if (token === this.navToken) {
          this.loading.showError('禅境花园加载失败', (err as Error).message, () => this.openGarden());
        }
      }
    })();
  }

  openTravel(): void {
    this.teardownCurrent();
    this.screen = 'travel';
    const token = this.navToken;
    this.loading.show({
      title: '正在前往旅行模式',
      detail: '正在加载旅行模式与词条数据...',
      ratio: 0.25,
    });
    void (async () => {
      try {
        const { TravelMode } = await import('./ui/TravelMode');
        if (token !== this.navToken) return;
        this.loading.update(0.85, '正在进入旅行大厅...');
        const trv = new TravelMode(this.uiRoot, {
          onBack: () => void this.openMainMenu(),
          onStartBattle: (cfg) => this.startBattle(cfg),
        });
        this.activeCleanup = () => trv.destroy();
        trv.mount();
        await this.loading.finish('旅行模式已就绪');
      } catch (err) {
        if (token === this.navToken) {
          this.loading.showError('旅行模式加载失败', (err as Error).message, () => this.openTravel());
        }
      }
    })();
  }

  openAbyss(): void {
    this.teardownCurrent();
    this.screen = 'abyss';
    const token = this.navToken;
    this.loading.show({
      title: '正在前往冒险秘境',
      detail: '正在加载秘境仓库与关卡配置...',
      ratio: 0.25,
    });
    void (async () => {
      try {
        const { AbyssMode } = await import('./ui/AbyssMode');
        if (token !== this.navToken) return;
        this.loading.update(0.85, '正在进入秘境准备室...');
        const aby = new AbyssMode(this.uiRoot, {
          onBack: () => void this.openMainMenu(),
          onStartBattle: (cfg) => this.startBattle(cfg),
        });
        this.activeCleanup = () => aby.destroy();
        aby.mount();
        await this.loading.finish('冒险秘境已就绪');
      } catch (err) {
        if (token === this.navToken) {
          this.loading.showError('冒险秘境加载失败', (err as Error).message, () => this.openAbyss());
        }
      }
    })();
  }

  startBattle(config: BoardConfig, opts?: { launchedFromMenu?: boolean }): void {
    this.teardownCurrent();
    this.screen = 'battle';
    const token = this.navToken;

    this.loading.show({
      title: config.title,
      detail: '正在按需加载本关场景与素材...',
      ratio: 0.03,
    });

    const seedContainer = document.createElement('div');
    const hudContainer = document.createElement('div');
    const almanacOverlayHost = document.createElement('div');
    this.uiRoot.append(hudContainer, seedContainer, almanacOverlayHost);

    let deck: DeckSlot[] = buildRecommendedDeck(config, 10).map((plantId) => ({ plantId }));
    let hud: BattleHud | null = null;
    let chooser: SeedChooser | null = null;

    const exitToOrigin = () => {
      if (opts?.launchedFromMenu) void this.openMainMenu();
      else if (config.mode === 'travel') this.openTravel();
      else if (config.mode === 'abyss') this.openAbyss();
      else this.openLevelSelect(this.resolveOriginTab(config));
    };

    const handleStartBattle = async () => {
      const deckIds = deck.map((s) => s.plantId);
      const baseIds = Array.from(new Set([...deckIds, ...config.prePlants.map((p) => p.thePlantType)]));
      const fusionResults = new Set<number>();
      for (let i = 0; i < baseIds.length; i++) {
        for (let j = i; j < baseIds.length; j++) {
          const resId = fusionSystem.getFusionResult(baseIds[i], baseIds[j]);
          if (resId !== null) fusionResults.add(resId);
        }
      }
      const uncached = assets.getUncachedPlantRigIds([...deckIds, ...fusionResults]);
      if (uncached.length > 0) {
        this.loading.show({
          title: config.title,
          detail: '正在加载已选植物与融合动画...',
          ratio: 0.06,
          countText: `0 / ${uncached.length}`,
        });
        await assets.preloadPlantRigs(uncached, (r, d, c) => {
          if (token === this.navToken) this.loading.update(0.06 + r * 0.94, d, c);
        });
        if (token !== this.navToken) return;
        await this.loading.finish('植物就绪，准备开战！');
      }
      if (token !== this.navToken) return;
      board.startBattle();
    };

    const mountChooser = (roundLabel?: string, currentSun?: number) => {
      chooser?.destroy();
      chooser = new SeedChooser(seedContainer, {
        config,
        initialDeck: deck,
        roundLabel,
        currentSun,
        onDeckChange: (next) => {
          deck = next;
          board.setDeckSlots(next);
        },
        onDifficultyChange: (next) => {
          const d = clampDifficulty(next);
          saveManager.update({ difficulty: d });
          config.difficulty = d;
          board.setDifficulty(d);
        },
        onStartBattle: handleStartBattle,
        onExit: exitToOrigin,
      });
      chooser.mount();
    };

    const board = new BoardEngine(this.pixiRoot, config, {
      onHudUpdate: (snap) => {
        hud?.update(snap);
        if (snap.phase !== 'choosing' && chooser) {
          chooser.destroy();
          chooser = null;
        }
      },
      onFusionToast: (a, b, r) => hud?.showFusionToast(a, b, r),
      onEndlessRoundComplete: (nextRound, stats) => {
        mountChooser(`第 ${nextRound} 轮`, stats.sun);
      },
      onGameEnd: (won, stats) => {
        let newlyUnlocked: number[] = [];
        let newlyUnlockedTools: BattleToolId[] = [];
        if (won) {
          const beforeUnlock = saveManager.getUnlockedPlantSet();
          const beforeTools = saveManager.getUnlockedToolIds();
          saveManager.addCoins(120);
          if (config.adventureIndex) saveManager.recordAdventureWin(config.adventureIndex);
          if (config.starMainKey) saveManager.recordStarMainWin(config.starMainKey);
          if (config.starSubKey) saveManager.recordStarSubWin(config.starSubKey);
          if (config.challengeKey) saveManager.recordChallengeWin(config.challengeKey);
          if (config.exploreId) saveManager.recordExploreWin(config.exploreId);
          if (config.izConfig) saveManager.recordIzWin(config.izConfig.name);
          if (config.mode === 'survival') {
            saveManager.recordSurvivalFlags(config.scene.id, stats.wavesCleared);
            if (!config.endless) saveManager.recordSurvivalRound(config.levelKey, 1);
          }
          if (config.mode === 'travel') {
            if (config.travelMeta?.isRunRound) {
              const trv = { ...saveManager.current.travel };
              const rd = config.travelMeta.round ?? trv.round;
              const ptsGain = (600 + rd * 150) * (trv.mode === 'cursed' ? 2 : 1);
              trv.points += ptsGain;
              trv.bestRound = Math.max(trv.bestRound, rd);
              trv.round = rd >= 21 ? 1 : rd + 1;
              trv.pendingStage = 'pick_buff';
              saveManager.setTravel(trv);
              if (rd >= 21) saveManager.recordTravelLevelWin('trv-survival');
            } else {
              saveManager.recordTravelLevelWin(config.levelKey);
            }
          }
          if (config.mode === 'abyss' && config.abyssStage) {
            void import('./ui/AbyssMode').then(({ ABYSS_ZOMBIE_BUFFS }) => {
              const aby = { ...saveManager.current.abyss };
              const reward = 150 + config.abyssStage! * 30;
              aby.coins += reward;
              aby.bestStage = Math.max(aby.bestStage, config.abyssStage!);
              if (config.abyssStage! >= aby.stage && aby.stage < 15) {
                aby.stage = config.abyssStage! + 1;
              }
              aby.zombieBuffs = ABYSS_ZOMBIE_BUFFS.filter((b) => aby.stage >= b.minStage).map((b) => b.id);
              saveManager.setAbyss(aby);
            });
          }
          const afterUnlock = saveManager.getUnlockedPlantSet();
          newlyUnlocked = [...afterUnlock].filter((id) => !beforeUnlock.has(id));
          const afterTools = saveManager.getUnlockedToolIds();
          newlyUnlockedTools = [...afterTools].filter((id) => !beforeTools.has(id));
        }
        hud?.showEndModal(won, stats, newlyUnlocked, newlyUnlockedTools);
      },
    });
    this.activeBoard = board;

    const vaseList = config.mode === 'vasebreaker' ? getVasebreakerLevels(saveManager.current.difficulty) : [];
    const hasNextVase =
      config.mode === 'vasebreaker' &&
      vaseList.findIndex((l) => l.levelKey === config.levelKey) >= 0 &&
      vaseList.findIndex((l) => l.levelKey === config.levelKey) + 1 < vaseList.length;

    const towerList = config.mode === 'tower' && !config.endless ? getTowerDefenseLevels(saveManager.current.difficulty).filter((t) => !t.endless) : [];
    const towerIdx = towerList.findIndex((t) => t.levelKey === config.levelKey);
    const hasNextTower = towerIdx >= 0 && towerIdx + 1 < towerList.length;

    const hasNextLevel = Boolean(
      (config.mode === 'travel' && config.travelMeta?.isRunRound) ||
        (config.mode === 'abyss' && config.abyssStage && config.abyssStage < 15) ||
        hasNextVase ||
        hasNextTower ||
        (config.starMainKey && config.starMainKey !== 'star-main-6-6') ||
        (config.starSubKey && config.starSubKey !== 'star-sub-6-6') ||
        (config.adventureIndex && config.adventureIndex < 45) ||
        config.izConfig,
    );

    const customNextLabel =
      config.mode === 'travel' && config.travelMeta?.isRunRound
        ? '选择词条 / 继续旅行'
        : config.mode === 'abyss'
          ? '挑战下一层'
          : undefined;
    const customExitLabel =
      config.mode === 'travel'
        ? '返回旅行大厅'
        : config.mode === 'abyss'
          ? '返回冒险秘境'
          : undefined;

    hud = new BattleHud(hudContainer, {
      config,
      board,
      hasNextLevel,
      fromMainMenu: Boolean(opts?.launchedFromMenu),
      customNextLabel,
      customExitLabel,
      onNextLevel: () => void this.launchNextLevel(config, opts),
      onOpenAlmanac: () => {
        if (this.battleAlmanacOverlay) return;
        board.setPaused(true);
        const token = this.navToken;
        void import('./ui/Almanac').then(({ Almanac }) => {
          if (token !== this.navToken || this.battleAlmanacOverlay) return;
          const overlay = new Almanac(
            almanacOverlayHost,
            () => {
              overlay.destroy();
              this.battleAlmanacOverlay = null;
              board.setPaused(false);
            },
            undefined,
            'plants',
          );
          this.battleAlmanacOverlay = overlay;
          void overlay.mount();
        });
      },
      onRestart: () => this.startBattle(config, opts),
      onExitToLevels: () => {
        if (config.mode === 'travel') this.openTravel();
        else if (config.mode === 'abyss') this.openAbyss();
        else this.openLevelSelect(this.resolveOriginTab(config));
      },
      onExitToMenu: () => void this.openMainMenu(),
    });
    hud.mount();

    const skipChooser = Boolean(
      config.conveyorMode || config.maliangMode || config.mode === 'iz' || config.mode === 'vasebreaker',
    );

    this.activeCleanup = () => {
      chooser?.destroy();
      hud?.destroy();
      board.destroy();
      this.uiRoot.innerHTML = '';
    };

    void (async () => {
      try {
        await board.init(deck, skipChooser, (r, d, c) => {
          if (token === this.navToken) this.loading.update(0.03 + r * 0.97, d, c);
        });
        if (token !== this.navToken) return;
        if (!skipChooser) {
          mountChooser();
        }
        await this.loading.finish('关卡素材已就绪', this.uiRoot);
      } catch (err) {
        if (token === this.navToken) {
          this.loading.showError('关卡加载失败', (err as Error).message, () => this.startBattle(config, opts));
        }
      }
    })();
  }

  private exposeDebugHandle(): void {
    const win = window as unknown as {
      __pvzApp?: {
        getScreen: () => ScreenId;
        getMetrics: () => unknown;
        spawnSandboxWave: () => void;
      };
    };
    win.__pvzApp = {
      getScreen: () => this.screen,
      getMetrics: () => ({
        screen: this.screen,
        loading: this.loading.getState(),
        board: this.activeBoard?.getDebugMetrics() ?? null,
        hud: this.activeBoard?.getSnapshot() ?? null,
      }),
      spawnSandboxWave: () => this.activeBoard?.spawnSandboxWave(),
    };
  }
}

const appInstance = new PvzWebApp();
void appInstance.boot();
