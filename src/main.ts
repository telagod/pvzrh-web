import './styles.css';
import { assets } from './assets/AssetLoader';
import { BoardEngine } from './engine/BoardEngine';
import { saveManager } from './save/SaveManager';
import type { BoardConfig, DeckSlot, ScreenId } from './types/game';
import type { Almanac } from './ui/Almanac';
import { BattleHud } from './ui/BattleHud';
import type { LevelTab } from './ui/LevelSelect';
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

  private screen: ScreenId = 'menu';
  private navToken = 0;
  private activeCleanup: (() => void) | null = null;
  private battleAlmanacOverlay: Almanac | null = null;
  private activeBoard: BoardEngine | null = null;

  async boot(): Promise<void> {
    this.bindProportionalUiScaler();
    this.showBootLoader(0.08, '正在连接资源...');
    try {
      await assets.init((ratio, label) => this.showBootLoader(ratio, label));
      this.openMainMenu();
      this.exposeDebugHandle();
    } catch (err) {
      this.uiRoot.innerHTML = `
        <div class="boot-overlay">
          <div class="boot-card error">
            <h2>资源加载失败</h2>
            <p>${(err as Error).message}</p>
            <button class="btn-gold" onclick="location.reload()">重新加载</button>
          </div>
        </div>
      `;
    }
  }

  private bindProportionalUiScaler(): void {
    const syncScale = () => {
      const vw = Math.round(window.visualViewport?.width ?? window.innerWidth);
      const vh = Math.round(window.visualViewport?.height ?? window.innerHeight);
      document.documentElement.style.setProperty('--vw', `${vw}px`);
      document.documentElement.style.setProperty('--vh', `${vh}px`);
      const isPortrait = vh > vw;
      const isMobileLike =
        (typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches) ||
        navigator.maxTouchPoints > 0 ||
        vw <= 900;
      document.body.classList.toggle('force-landscape', isPortrait && isMobileLike);

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
        if (document.body.classList.contains('force-landscape') || navigator.maxTouchPoints > 0) {
          tryLockLandscape();
        }
      },
      { passive: true },
    );
  }

  private showBootLoader(ratio: number, label: string): void {
    const pct = Math.max(5, Math.min(100, Math.round(ratio * 100)));
    this.uiRoot.innerHTML = `
      <div class="boot-overlay">
        <div class="boot-card">
          <img class="boot-sun" src="assets/bullets/sun.webp" alt="Sun" />
          <h1>植物大战僵尸 · 融合版 4.1</h1>
          <p>${label}</p>
          <div class="boot-bar"><div class="boot-bar-fill" style="width:${pct}%"></div></div>
        </div>
      </div>
    `;
  }

  private teardownCurrent(): void {
    this.navToken++;
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

  openMainMenu(): void {
    this.teardownCurrent();
    this.screen = 'menu';
    const mm = new MainMenu(this.pixiRoot, this.uiRoot, {
      onNavigate: (scr, opts) => {
        if (scr === 'levels') this.openLevelSelect(opts?.tab ?? 'adventure');
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
    void mm.mount();
  }

  openLevelSelect(tab: LevelTab = 'adventure'): void {
    this.teardownCurrent();
    this.screen = 'levels';
    const token = this.navToken;
    void import('./ui/LevelSelect').then(({ LevelSelect }) => {
      if (token !== this.navToken) return;
      const ls = new LevelSelect(this.uiRoot, {
        initialTab: tab,
        onBack: () => this.openMainMenu(),
        onSelectLevel: (cfg) => this.startBattle(cfg),
      });
      this.activeCleanup = () => ls.destroy();
      ls.mount();
    });
  }

  openAlmanac(initialView: 'index' | 'plants' = 'index'): void {
    this.teardownCurrent();
    this.screen = 'almanac';
    const token = this.navToken;
    void import('./ui/Almanac').then(({ Almanac }) => {
      if (token !== this.navToken) return;
      const alm = new Almanac(this.uiRoot, () => this.openMainMenu(), undefined, initialView);
      this.activeCleanup = () => alm.destroy();
      void alm.mount();
    });
  }

  openGarden(): void {
    this.teardownCurrent();
    this.screen = 'garden';
    const token = this.navToken;
    void import('./ui/ZenGarden').then(({ ZenGarden }) => {
      if (token !== this.navToken) return;
      const zg = new ZenGarden(this.pixiRoot, this.uiRoot, {
        onBack: () => this.openMainMenu(),
      });
      this.activeCleanup = () => zg.destroy();
      void zg.mount();
    });
  }

  openTravel(): void {
    this.teardownCurrent();
    this.screen = 'travel';
    const token = this.navToken;
    void import('./ui/TravelMode').then(({ TravelMode }) => {
      if (token !== this.navToken) return;
      const trv = new TravelMode(this.uiRoot, {
        onBack: () => this.openMainMenu(),
        onStartBattle: (cfg) => this.startBattle(cfg),
      });
      this.activeCleanup = () => trv.destroy();
      trv.mount();
    });
  }

  openAbyss(): void {
    this.teardownCurrent();
    this.screen = 'abyss';
    const token = this.navToken;
    void import('./ui/AbyssMode').then(({ AbyssMode }) => {
      if (token !== this.navToken) return;
      const aby = new AbyssMode(this.uiRoot, {
        onBack: () => this.openMainMenu(),
        onStartBattle: (cfg) => this.startBattle(cfg),
      });
      this.activeCleanup = () => aby.destroy();
      aby.mount();
    });
  }

  startBattle(config: BoardConfig, opts?: { launchedFromMenu?: boolean }): void {
    this.teardownCurrent();
    this.screen = 'battle';

    const seedContainer = document.createElement('div');
    const hudContainer = document.createElement('div');
    const almanacOverlayHost = document.createElement('div');
    this.uiRoot.append(hudContainer, seedContainer, almanacOverlayHost);

    let deck: DeckSlot[] = buildRecommendedDeck(config, 10).map((plantId) => ({ plantId }));
    let hud: BattleHud | null = null;
    let chooser: SeedChooser | null = null;

    const exitToOrigin = () => {
      if (opts?.launchedFromMenu) this.openMainMenu();
      else if (config.mode === 'travel') this.openTravel();
      else if (config.mode === 'abyss') this.openAbyss();
      else this.openLevelSelect(this.resolveOriginTab(config));
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
        onStartBattle: () => board.startBattle(),
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
        if (won) {
          const beforeUnlock = saveManager.getUnlockedPlantSet();
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
        }
        hud?.showEndModal(won, stats, newlyUnlocked);
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
      onExitToMenu: () => this.openMainMenu(),
    });
    hud.mount();

    const skipChooser = Boolean(
      config.conveyorMode || config.maliangMode || config.mode === 'iz' || config.mode === 'vasebreaker',
    );
    if (!skipChooser) {
      mountChooser();
    }

    this.activeCleanup = () => {
      chooser?.destroy();
      hud?.destroy();
      board.destroy();
      this.uiRoot.innerHTML = '';
    };

    void board.init(deck, skipChooser);
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
        board: this.activeBoard?.getDebugMetrics() ?? null,
        hud: this.activeBoard?.getSnapshot() ?? null,
      }),
      spawnSandboxWave: () => this.activeBoard?.spawnSandboxWave(),
    };
  }
}

const appInstance = new PvzWebApp();
void appInstance.boot();
