import { Application, Container, Graphics, Sprite, Text, TextStyle } from 'pixi.js';
import { assets } from '../assets/AssetLoader';
import { audio } from '../audio/AudioManager';
import { ParticleSystem } from '../render/ParticleSystem';
import { UnityAnimator } from '../render/UnityAnimator';
import { UnityRigInstance } from '../render/UnityRigInstance';
import { clampDifficulty, getDifficultyInfo } from '../save/difficulty';
import { saveManager } from '../save/SaveManager';
import type {
  ActiveBossHudInfo,
  BoardCallbacks,
  BoardConfig,
  ConveyorCardState,
  DeckSlot,
  HudCardState,
  HudSnapshot,
  IzZombieCardState,
  LoadedRig,
  PlantBehavior,
  PlantDef,
  UnlockedToolsState,
  ZombieBehavior,
  ZombieDef,
} from '../types/game';
import { getPlantBehavior, getZombieBehavior } from './BehaviorRegistry';
import { fusionSystem } from './FusionSystem';
import { mapClientToCanvas } from '../utils/viewport';

export const VIEW_W = 1066;
export const VIEW_H = 600;
export const WORLD_W = 1400;
export const BOARD_X = 255;
export const CELL_W = 82.7;
export const COLS = 10;
export const UNITY_ENTITY_SCALE = 0.62;

const CAM_X_CHOOSER = 334;
const CAM_X_BATTLE = 135;

export interface TileSlotState {
  row: number;
  col: number;
  base: PlantInstance | null; // LilyPad or FlowerPot
  mains: PlantInstance[]; // up to 1 normal plant OR up to 3 stackable SmallPuff/SeaShroom
  pumpkin: PlantInstance | null;
  fly: PlantInstance | null;
  craterTimer: number;
  hasGrave: boolean;
}

interface PlantInstance {
  uid: number;
  plantId: number;
  def: PlantDef;
  beh: PlantBehavior;
  row: number;
  col: number;
  slotType: 'base' | 'main' | 'pumpkin' | 'fly';
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  atkTimer: number;
  prodTimer: number;
  armTimer: number;
  armed: boolean;
  chewTimer: number;
  flashTimer: number;
  burstLeft: number;
  burstTimer: number;
  burstTargetAngle: number;
  frost: number;
  frozenTimer: number;
  specialTimer: number;
  rig: UnityRigInstance | null;
  animator: UnityAnimator | null;
  container: Container;
  dead: boolean;
}

interface ZombieInstance {
  uid: number;
  zombieId: number;
  def: ZombieDef;
  beh: ZombieBehavior;
  row: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  a1Hp: number;
  a1Max: number;
  a2Hp: number;
  a2Max: number;
  chillTimer: number;
  freezeTimer: number;
  butterTimer: number;
  flashTimer: number;
  hypnotized: boolean;
  enraged: boolean;
  hasVaulted: boolean;
  headDropped: boolean;
  dying: boolean;
  dieTimer: number;
  biteTimer: number;
  jackTimer: number;
  wpIdx?: number;
  isPreviewOnly: boolean;
  previewWanderDir: number;
  rig: UnityRigInstance | null;
  animator: UnityAnimator | null;
  container: Container;
  hpBar: Graphics;
  lastHpBarKey: number;
  removed: boolean;
}

interface BulletInstance {
  x: number;
  y: number;
  vx: number;
  vy: number;
  gravity: number;
  targetX: number;
  targetY: number;
  row: number;
  kind: string;
  damage: number;
  pierceLeft: number;
  homing: boolean;
  lobbed: boolean;
  ignited: boolean;
  splashRadius: number;
  splashRatio: number;
  chillDur: number;
  freezeDur: number;
  butterDur: number;
  knockbackPx: number;
  hypnoOnHit: boolean;
  fromHypnoZombie?: boolean;
  hitIds: Set<number>;
  sprite: Sprite;
  shadow?: Graphics;
  life: number;
}

interface MowerInstance {
  row: number;
  x: number;
  y: number;
  kind: 'lawn' | 'pool' | 'roof';
  isWater: boolean;
  inWater: boolean;
  active: boolean;
  triggered: boolean;
  removed: boolean;
  rig: UnityRigInstance | null;
  animator: UnityAnimator | null;
  container: Container;
}

interface SunInstance {
  uid: number;
  x: number;
  y: number;
  vy: number;
  vx: number;
  targetY: number;
  value: number;
  life: number;
  collecting: boolean;
  collectT: number;
  startX: number;
  startY: number;
  container: Container;
  rig: UnityRigInstance | null;
  animator: UnityAnimator | null;
}

interface VaseInstance {
  uid: number;
  row: number;
  col: number;
  kind: 'plant' | 'mystery' | 'zombie';
  plantId?: number;
  zombieId?: number;
  sunBonus?: number;
  broken: boolean;
  sprite: Sprite;
  container: Container;
}

export class BoardEngine {
  readonly config: BoardConfig;
  private readonly callbacks: BoardCallbacks;
  private readonly hostEl: HTMLElement;

  private app: Application | null = null;
  private worldContainer = new Container();
  private bgLayer = new Container();
  private tileDecalLayer = new Container();
  private groundLayer = new Container();
  private entityLayer = new Container({ sortableChildren: true });
  private projectileLayer = new Container();
  private particleSys = new ParticleSystem();
  private fogLayer = new Container();
  private collectibleLayer = new Container();
  private screenOverlay = new Container();

  private tileGrid: TileSlotState[][] = [];
  private plants: PlantInstance[] = [];
  private zombies: ZombieInstance[] = [];
  private previewZombies: ZombieInstance[] = [];
  private bullets: BulletInstance[] = [];
  private mowers: MowerInstance[] = [];
  private suns: SunInstance[] = [];
  private vases: VaseInstance[] = [];

  private fogSprites: Sprite[] = [];
  private fogClearTimer = 0;

  private hoverGraphics = new Graphics();
  private fusionPreviewLabel: Text;

  private nextUid = 1;
  private camX = CAM_X_CHOOSER;
  private targetCamX = CAM_X_CHOOSER;
  private phase: HudSnapshot['phase'] = 'choosing';

  private sun = 150;
  private deckSlots: DeckSlot[] = [];
  private cardCooldowns: number[] = [];
  private selectedCardIndex = -1;
  private timeStopActive = false;
  private shovelActive = false;
  private gloveActive = false;
  private gloveMode: 'plant' | 'zombie' = 'plant';
  private gloveCooldownLeft = 0;
  private gloveHeldPlant: { plantId: number; hp: number; maxHp: number } | null = null;
  private gloveHeldZombie: ZombieInstance | null = null;
  private hammerActive = false;
  private hammerCooldownLeft = 0;
  private wheelbarrowActive = false;
  private wheelbarrowCooldownLeft = 0;
  private wheelbarrowStored: { plantId: number; hp: number; maxHp: number } | null = null;
  private fertilizerActive = false;
  private fertilizerCharges = 1;
  private fertilizerTimer = 70;

  private towerPathOverlay = new Graphics();
  private warmthOverlay = new Graphics();
  private warmthOverlayDirty = false;
  private fxOverlayLayer = new Container();
  private fadingBeams: { gfx: Graphics; life: number; maxLife: number }[] = [];
  private graveSprites = new Map<string, Sprite>();
  private towerRoadCells = new Set<string>();
  private towerLivesLeft = 10;
  private towerLivesMax = 10;
  private maliangInk = 100;

  private speed: 1 | 2 | 3 = 1;
  private autoCollect = false;

  private conveyorCards: ConveyorCardState[] = [];
  private conveyorTimer = 1.2;
  private conveyorPool: number[] = [];

  private endlessRound = 1;
  private endlessTotalWavesCleared = 0;

  private izBrains: { row: number; hp: number; eaten: boolean; sprite: Sprite }[] = [];
  private izOverlay = new Graphics();
  private izZombieIds: number[] = [];
  private izStallTimer = 0;

  private currentWave = 0;
  private waveTimer = 0;
  private waveBudgetRemaining = 0;
  private waveSpawnCooldown = 0;
  private currentWaveIsHuge = false;
  private pendingZombieSpawns = 0;
  private skySunTimer = 6.5;
  private totalSpawnedZombies = 0;
  private kills = 0;
  private fusions = 0;
  private elapsedSec = 0;

  private bannerText: string | null = null;
  private introTimer = 0;
  private bannerOverlaySprite: Sprite | null = null;
  private hugeWaveTimer = 0;
  private finalWaveTimer = 0;
  private hudEmitAcc = 0;

  private hoverTile: { row: number; col: number } | null = null;
  private destroyed = false;

  private readonly rows: number;
  private readonly cols: number;
  private readonly cellW: number;
  private readonly rowY0: number;
  private readonly cellH: number;
  private readonly unlockedTools: UnlockedToolsState;

  constructor(hostEl: HTMLElement, config: BoardConfig, callbacks: BoardCallbacks) {
    this.hostEl = hostEl;
    this.config = config;
    this.callbacks = callbacks;
    this.sun = config.initialSun;
    this.autoCollect = saveManager.current.autoCollect;
    this.unlockedTools = saveManager.getUnlockedTools(config);
    this.fertilizerCharges = this.unlockedTools.fertilizer ? (config.mode === 'sandbox' ? 9 : 1) : 0;
    if (config.towerConfig) {
      this.towerLivesLeft = config.towerConfig.maxLives;
      this.towerLivesMax = config.towerConfig.maxLives;
    }

    this.rows = config.scene.rows || 5;
    this.cols = config.mode === 'iz' ? 10 : 9;
    this.cellW = this.cols === 10 ? 74 : 82;
    if (this.rows >= 6) {
      this.rowY0 = 108;
      this.cellH = 82;
    } else {
      this.rowY0 = 88;
      this.cellH = 98;
    }

    if (config.conveyorMode) {
      const pool = (config.presetCards?.length ? config.presetCards : [0, 1, 2, 3, 13, 18]).filter((id) =>
        Boolean(assets.getPlant(id)),
      );
      this.conveyorPool = pool.length > 0 ? pool : [0, 2, 3, 13];
    }
    if (config.mode === 'iz' && config.izConfig) {
      const avail = Array.from(
        new Set(config.izConfig.availableZombies.filter((id) => Boolean(assets.getZombie(id)))),
      );
      this.izZombieIds = avail.length > 0 ? avail : [0, 2, 4];
    }

    for (let r = 0; r < this.rows; r++) {
      const rowArr: TileSlotState[] = [];
      for (let c = 0; c < this.cols; c++) {
        rowArr.push({
          row: r,
          col: c,
          base: null,
          mains: [],
          pumpkin: null,
          fly: null,
          craterTimer: 0,
          hasGrave: false,
        });
      }
      this.tileGrid.push(rowArr);
    }

    this.fusionPreviewLabel = new Text({
      text: '',
      style: new TextStyle({
        fontSize: 13,
        fontWeight: 'bold',
        fill: 0xfef08a,
        stroke: { color: 0x1e1b4b, width: 3 },
      }),
    });
    this.fusionPreviewLabel.anchor.set(0.5, 1);
    this.fusionPreviewLabel.visible = false;
  }

  async init(initialDeck: (number | DeckSlot)[], skipSeedChooser = false): Promise<void> {
    if (this.destroyed) return;

    const app = new Application();
    await app.init({
      width: VIEW_W,
      height: VIEW_H,
      backgroundColor: 0x0b1220,
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
    app.canvas.style.touchAction = 'none';
    this.hostEl.appendChild(app.canvas);

    this.worldContainer.addChild(
      this.bgLayer,
      this.tileDecalLayer,
      this.groundLayer,
      this.entityLayer,
      this.projectileLayer,
      this.fxOverlayLayer,
      this.particleSys.view,
      this.fogLayer,
      this.collectibleLayer,
    );
    app.stage.addChild(this.worldContainer, this.screenOverlay);

    this.tileDecalLayer.addChild(
      this.towerPathOverlay,
      this.warmthOverlay,
      this.izOverlay,
      this.hoverGraphics,
      this.fusionPreviewLabel,
    );

    const preloadPlants = new Set<number>([
      ...initialDeck.map((d) => (typeof d === 'number' ? d : d.plantId)),
      ...this.conveyorPool,
      ...this.config.prePlants.map((p) => p.thePlantType),
      ...(this.config.izConfig?.plants.map((p) => p.thePlantType) ?? []),
      ...(this.config.vasebreakerConfig?.vases
        .map((v) => v.plantId)
        .filter((id): id is number => id !== undefined) ?? []),
    ]);
    if (this.config.mode === 'iz') {
      preloadPlants.add(12);
    }
    const needGraves = this.shouldSpawnGraves();
    const preloadZombies = new Set<number>([
      ...this.config.allowedZombies,
      ...this.izZombieIds,
      ...(this.config.vasebreakerConfig?.vases
        .map((v) => v.zombieId)
        .filter((id): id is number => id !== undefined) ?? []),
    ]);
    await Promise.all([
      assets.preloadBattleAssets(
        [...preloadPlants],
        [...preloadZombies],
        this.config.scene.bg,
      ),
      this.config.mode === 'iz' ? assets.loadTexture('assets/ui/brain.webp') : Promise.resolve(null),
      ...(this.config.vasebreakerConfig
        ? [
            assets.loadTexture('assets/ui/modes/scary_pot_0.webp'),
            assets.loadTexture('assets/ui/modes/scary_pot_3.webp'),
            assets.loadTexture('assets/ui/modes/scary_pot_4.webp'),
          ]
        : []),
      ...(needGraves
        ? [
            assets.loadTexture('assets/ui/modes/grave_0.webp'),
            assets.loadTexture('assets/ui/modes/grave_1.webp'),
            assets.loadTexture('assets/ui/modes/grave_2.webp'),
            assets.loadTexture('assets/ui/modes/grave_3.webp'),
          ]
        : []),
      ...(this.config.towerConfig
        ? [
            assets.loadTexture('assets/ui/modes/tower_bush.webp'),
            assets.loadTexture('assets/ui/modes/tower_tree.webp'),
          ]
        : []),
    ]);
    if (this.destroyed) return;

    this.buildBackgroundAndFog();
    if (this.config.towerConfig) {
      this.buildTowerPathOverlay();
    }
    if (this.config.mode === 'iz') {
      this.buildIzBoardOverlay();
    } else if (this.config.mode !== 'vasebreaker' && this.config.mode !== 'tower') {
      await this.buildMowers();
    }
    await this.spawnPrePlants();
    if (needGraves) {
      this.buildGraves();
    }
    if (this.config.vasebreakerConfig) {
      this.buildVases();
    }
    this.setDeckSlots(initialDeck.map((d) => (typeof d === 'number' ? { plantId: d } : d)));

    this.bindInput(app.canvas);

    if (skipSeedChooser) {
      this.phase = 'playing';
      this.camX = CAM_X_BATTLE;
      this.targetCamX = CAM_X_BATTLE;
      this.waveTimer = Math.min(this.config.firstWaveDelay, 12);
      if (this.config.conveyorMode && !this.config.vasebreakerConfig && this.conveyorPool.length > 0) {
        this.pushConveyorCard(0.0);
        this.pushConveyorCard(0.14);
        this.conveyorTimer = Math.max(2.0, this.config.conveyorInterval || 5.0);
      }
      void audio.playBgm(this.config.scene.bgm || 'Day');
    } else {
      this.phase = 'choosing';
      this.camX = CAM_X_CHOOSER;
      this.targetCamX = CAM_X_CHOOSER;
      await this.spawnPreviewZombies();
      void audio.playBgm(this.config.scene.bgm || 'Day');
    }
    this.worldContainer.position.set(-this.camX, 0);

    app.ticker.add((ticker) => {
      const dt = Math.min(0.05, ticker.deltaMS / 1000);
      this.tick(dt);
    });

    this.emitHud();
  }

  private buildBackgroundAndFog(): void {
    const bgTex = assets.getCachedTexture(`assets/bg/${this.config.scene.bg}`);
    if (bgTex) {
      const sp = new Sprite(bgTex);
      sp.width = WORLD_W;
      sp.height = VIEW_H;
      this.bgLayer.addChild(sp);
    }

    if (this.config.scene.fog) {
      const fogTex =
        assets.getCachedTexture('assets/bg/fog_1680x190.webp') ||
        assets.getCachedTexture('assets/ui/cloud.webp');
      for (let r = 0; r < this.rows; r++) {
        for (let c = 6; c < this.cols; c++) {
          const cx = this.colCenterX(c);
          const cy = this.rowGroundY(r) - this.cellH * 0.45;
          if (fogTex) {
            const fsp = new Sprite(fogTex);
            fsp.anchor.set(0.5);
            fsp.position.set(cx, cy);
            fsp.width = 160;
            fsp.height = 140;
            fsp.alpha = 0.82;
            (fsp as unknown as { col: number; row: number }).col = c;
            (fsp as unknown as { col: number; row: number }).row = r;
            this.fogLayer.addChild(fsp);
            this.fogSprites.push(fsp);
          }
        }
      }
    }
  }

  private async buildMowers(): Promise<void> {
    if (this.config.mode === 'explore' && this.config.prePlants.length > 0 && this.config.conveyorMode) {
      return;
    }
    const waterRows = new Set(this.config.scene.waterRows);
    const isRoof = Boolean(this.config.scene.roof);
    const rowKinds: ('lawn' | 'pool' | 'roof')[] = [];
    for (let r = 0; r < this.rows; r++) {
      rowKinds.push(waterRows.has(r) ? 'pool' : isRoof ? 'roof' : 'lawn');
    }

    const needLawn = rowKinds.includes('lawn');
    const needPool = rowKinds.includes('pool');
    const needRoof = rowKinds.includes('roof');
    const [lawnRig, poolRig, roofRig] = await Promise.all([
      needLawn ? assets.loadCommonRig('mower_lawn') : Promise.resolve(null),
      needPool ? assets.loadCommonRig('mower_pool') : Promise.resolve(null),
      needRoof ? assets.loadCommonRig('mower_roof') : Promise.resolve(null),
    ]);

    for (let r = 0; r < this.rows; r++) {
      const kind = rowKinds[r];
      const isW = kind === 'pool';
      const rigData = kind === 'pool' ? (poolRig ?? lawnRig) : kind === 'roof' ? (roofRig ?? lawnRig) : lawnRig;
      const container = new Container();
      const x = BOARD_X - 32;
      const y = this.rowGroundY(r);
      container.position.set(x, y);
      container.scale.set(kind === 'pool' ? 0.66 : 0.56);
      this.groundLayer.addChild(container);

      let rig: UnityRigInstance | null = null;
      let animator: UnityAnimator | null = null;
      if (rigData) {
        rig = new UnityRigInstance(rigData);
        container.addChild(rig.container);
        if (kind !== 'lawn') {
          animator = new UnityAnimator(rig, 'idle_land');
        }
      }

      this.mowers.push({
        row: r,
        x,
        y,
        kind,
        isWater: isW,
        inWater: false,
        active: true,
        triggered: false,
        removed: false,
        rig,
        animator,
        container,
      });
    }
  }

  private buildIzBoardOverlay(): void {
    const iz = this.config.izConfig;
    if (!iz) return;
    const redX = BOARD_X + iz.redlineColumn * this.cellW;
    const topY = this.rowY0;
    const botY = this.rowY0 + this.rows * this.cellH;

    this.izOverlay.clear();
    this.izOverlay
      .rect(redX - 2, topY, 4, botY - topY)
      .fill({ color: 0xef4444, alpha: 0.78 });
    for (let y = topY; y < botY; y += 16) {
      this.izOverlay
        .rect(redX - 1, y, 2, 10)
        .fill({ color: 0xfecaca, alpha: 0.92 });
    }

    const brainTex = assets.getCachedTexture('assets/ui/brain.webp');
    this.izBrains = [];
    for (let r = 0; r < this.rows; r++) {
      const sp = new Sprite(brainTex);
      sp.anchor.set(0.5);
      sp.position.set(BOARD_X - 26, this.rowGroundY(r) - 26);
      sp.width = 40;
      sp.height = 40;
      this.groundLayer.addChild(sp);
      this.izBrains.push({ row: r, hp: 160, eaten: false, sprite: sp });
    }
  }

  private pushConveyorCard(initialProgress = 0.96): void {
    if (this.conveyorCards.length >= 10 || this.conveyorPool.length === 0) return;
    const pid = this.conveyorPool[Math.floor(Math.random() * this.conveyorPool.length)];
    this.conveyorCards.push({
      uid: this.nextUid++,
      plantId: pid,
      progress: initialProgress,
    });
  }

  private async spawnPrePlants(): Promise<void> {
    if (this.config.mode === 'iz' && this.config.izConfig) {
      const layerPriority = (pid: number): number => {
        const layer = assets.getPlant(pid)?.layer;
        if (layer === 'Pot' || layer === 'Lily') return 0;
        if (layer === 'Pumpkin') return 2;
        return 1;
      };
      const sorted = [...this.config.izConfig.plants].sort(
        (a, b) => layerPriority(a.thePlantType) - layerPriority(b.thePlantType),
      );
      const waterRows = this.config.scene.waterRows;
      for (const pp of sorted) {
        const col = Math.max(0, Math.min(this.cols - 1, pp.thePlantColumn));
        const row = Math.max(0, Math.min(this.rows - 1, pp.thePlantRow));
        const slot = this.tileGrid[row]?.[col];
        if (slot && waterRows.includes(row) && !slot.base && pp.theLilyType >= 0) {
          const lilyId = assets.getPlant(pp.theLilyType)?.layer === 'Lily' ? pp.theLilyType : 12;
          await this.placePlant(lilyId, row, col, true, 'base');
        }
        await this.placePlant(
          pp.thePlantType,
          row,
          col,
          true,
          undefined,
          pp.thePlantHealth > 0 ? pp.thePlantHealth : undefined,
        );
      }
      return;
    }

    for (const pp of this.config.prePlants) {
      const col = Math.max(0, Math.min(this.cols - 1, pp.theColumn));
      const row = Math.max(0, Math.min(this.rows - 1, pp.theRow));
      await this.placePlant(pp.thePlantType, row, col, true);
    }
  }

  private async spawnPreviewZombies(): Promise<void> {
    this.clearPreviewZombies();
    const pool = this.config.allowedZombies.length > 0 ? this.config.allowedZombies : [0, 2, 4];
    const count = Math.min(10, Math.max(5, pool.length + 2));
    for (let i = 0; i < count; i++) {
      const zid = pool[i % pool.length];
      const rigData = await assets.loadZombieRig(zid);
      if (this.destroyed || this.phase !== 'choosing') return;
      const zDef = assets.getZombie(zid) ?? assets.getZombie(0)!;
      const beh = getZombieBehavior(zid);
      const row = i % this.rows;
      const x = 1120 + Math.random() * 165;
      const y = 165 + (i / Math.max(1, count - 1)) * 365 + (Math.random() - 0.5) * 14;
      const container = new Container();
      container.position.set(x, y);
      container.scale.set(UNITY_ENTITY_SCALE);
      container.zIndex = y;
      this.entityLayer.addChild(container);

      let rig: UnityRigInstance | null = null;
      let animator: UnityAnimator | null = null;
      if (rigData) {
        rig = new UnityRigInstance(rigData);
        container.addChild(rig.container);
        animator = new UnityAnimator(rig, rigData.data.clips.idle ? 'idle' : 'walk');
        animator.playBase(rigData.data.clips.idle ? 'idle' : 'walk', true, Math.random() * 1.5);
      }

      this.previewZombies.push({
        uid: this.nextUid++,
        zombieId: zid,
        def: zDef,
        beh,
        row,
        x,
        y,
        hp: zDef.hp,
        maxHp: zDef.hp,
        a1Hp: zDef.a1,
        a1Max: zDef.a1,
        a2Hp: zDef.a2,
        a2Max: zDef.a2,
        chillTimer: 0,
        freezeTimer: 0,
        butterTimer: 0,
        flashTimer: 0,
        hypnotized: false,
        enraged: false,
        hasVaulted: false,
        headDropped: false,
        dying: false,
        dieTimer: 0,
        biteTimer: 0,
        jackTimer: 0,
        isPreviewOnly: true,
        previewWanderDir: Math.random() > 0.5 ? 1 : -1,
        rig,
        animator,
        container,
        hpBar: new Graphics(),
        lastHpBarKey: -1,
        removed: false,
      });
    }
  }

  private clearPreviewZombies(): void {
    for (const pz of this.previewZombies) {
      pz.rig?.destroy();
      pz.container.destroy({ children: true });
    }
    this.previewZombies.length = 0;
  }

  private shouldSpawnGraves(): boolean {
    if (
      this.config.mode === 'iz' ||
      this.config.mode === 'vasebreaker' ||
      this.config.mode === 'tower' ||
      this.config.mode === 'sandbox'
    ) {
      return false;
    }
    if (this.config.enableGraves !== undefined) return this.config.enableGraves;
    return Boolean((this.config.scene.night || this.config.scene.fog) && !this.config.scene.snow);
  }

  private buildGraves(): void {
    const candidates: { row: number; col: number }[] = [];
    for (let r = 0; r < this.rows; r++) {
      if (this.config.scene.waterRows.includes(r)) continue;
      for (let c = 5; c < this.cols; c++) {
        const slot = this.tileGrid[r]?.[c];
        if (!slot || slot.base || slot.mains.length > 0 || slot.hasGrave) continue;
        candidates.push({ row: r, col: c });
      }
    }
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    const chosen = candidates.slice(0, 4);
    chosen.forEach((pos, idx) => {
      const slot = this.tileGrid[pos.row][pos.col];
      slot.hasGrave = true;
      const tex =
        assets.getCachedTexture(`assets/ui/modes/grave_${idx % 4}.webp`) ||
        assets.getCachedTexture('assets/ui/modes/grave_0.webp');
      if (!tex) return;
      const sp = new Sprite(tex);
      sp.anchor.set(0.5, 0.92);
      const x = this.colCenterX(pos.col);
      const y = this.rowGroundY(pos.row);
      sp.position.set(x, y);
      sp.width = 72;
      sp.height = 76;
      sp.zIndex = y;
      this.entityLayer.addChild(sp);
      this.graveSprites.set(`${pos.row}|${pos.col}`, sp);
    });
  }

  private clearGraveAt(row: number, col: number): void {
    const key = `${row}|${col}`;
    const slot = this.tileGrid[row]?.[col];
    if (slot) slot.hasGrave = false;
    const sp = this.graveSprites.get(key);
    if (sp) {
      sp.destroy();
      this.graveSprites.delete(key);
    }
  }

  private buildTowerPathOverlay(): void {
    const wps = this.config.towerConfig?.waypoints ?? [];
    if (wps.length < 2) return;
    this.towerRoadCells.clear();

    for (let i = 0; i < wps.length - 1; i++) {
      const a = wps[i];
      const b = wps[i + 1];
      let r = a.row;
      let c = a.col;
      this.towerRoadCells.add(`${r}|${c}`);
      while (r !== b.row || c !== b.col) {
        if (r !== b.row) r += Math.sign(b.row - r);
        else if (c !== b.col) c += Math.sign(b.col - c);
        this.towerRoadCells.add(`${r}|${c}`);
      }
    }

    const g = this.towerPathOverlay;
    g.clear();
    for (const key of this.towerRoadCells) {
      const [rs, cs] = key.split('|');
      const r = Number(rs);
      const c = Number(cs);
      const x0 = BOARD_X + c * this.cellW;
      const y0 = this.rowY0 + r * this.cellH;
      g.roundRect(x0 + 4, y0 + 4, this.cellW - 8, this.cellH - 8, 10)
        .fill({ color: 0x78553a, alpha: 0.72 })
        .stroke({ width: 2.5, color: 0xd6b08c, alpha: 0.85 });
      g.circle(x0 + this.cellW * 0.5, y0 + this.cellH * 0.5, 5).fill({ color: 0xfde68a, alpha: 0.35 });
    }

    // Spawn & Base markers
    const startWp = wps[0];
    const endWp = wps[wps.length - 1];
    g.circle(this.colCenterX(startWp.col), this.rowGroundY(startWp.row) - this.cellH * 0.4, 20)
      .fill({ color: 0xef4444, alpha: 0.45 })
      .stroke({ width: 3, color: 0xfca5a5, alpha: 0.9 });
    g.circle(this.colCenterX(endWp.col), this.rowGroundY(endWp.row) - this.cellH * 0.4, 22)
      .fill({ color: 0x3b82f6, alpha: 0.5 })
      .stroke({ width: 3, color: 0x93c5fd, alpha: 0.95 });

    // Subtle bush/tree props off road
    const bushTex = assets.getCachedTexture('assets/ui/modes/tower_bush.webp');
    if (bushTex) {
      const props = [
        { r: 0, c: 0 },
        { r: this.rows - 1, c: 8 },
      ];
      for (const pr of props) {
        if (this.towerRoadCells.has(`${pr.r}|${pr.c}`)) continue;
        const sp = new Sprite(bushTex);
        sp.anchor.set(0.5, 0.9);
        sp.position.set(this.colCenterX(pr.c) - 18, this.rowGroundY(pr.r) - 6);
        sp.width = 48;
        sp.height = 48;
        sp.alpha = 0.82;
        this.groundLayer.addChild(sp);
      }
    }
  }

  private getEffectiveSlotCost(slotIdx: number): number {
    if (this.config.infiniteSun) return 0;
    const slot = this.deckSlots[slotIdx];
    if (!slot) return 100;
    const base = assets.getPlant(slot.plantId)?.cost ?? 100;
    const scaled = slot.isSubCard ? base * 2 : base;
    const discount = this.config.modifiers?.cardCostDiscount ?? 0;
    return discount > 0 ? Math.max(0, scaled - discount) : scaled;
  }

  private getEffectiveCardCd(plantId: number): number {
    if (this.config.zeroCooldown) return 0;
    const p = assets.getPlant(plantId);
    const baseCd = Math.max(1.5, p?.cd ?? 7.5);
    const cdMult = this.config.modifiers?.cardCdMult ?? 1;
    return Math.max(0.5, baseCd * cdMult);
  }

  private computePlantDamage(baseDamage: number, x?: number, y?: number): number {
    const dmgMult = this.config.modifiers?.plantDmgMult ?? 1;
    let out = Math.round(baseDamage * dmgMult);
    const critChance = this.config.modifiers?.critChance ?? 0;
    if (critChance > 0 && Math.random() < critChance) {
      out = Math.round(out * 1.75);
      if (x !== undefined && y !== undefined) {
        this.particleSys.emitSunSparkle(x, y - 24);
      }
    }
    return Math.max(1, out);
  }

  private applyLifesteal(dealt: number): void {
    const ratio = this.config.modifiers?.plantLifestealRatio ?? 0;
    if (ratio <= 0 || this.plants.length === 0) return;
    let lowest: PlantInstance | null = null;
    for (const p of this.plants) {
      if (!p.dead && p.hp < p.maxHp) {
        if (!lowest || p.hp / p.maxHp < lowest.hp / lowest.maxHp) lowest = p;
      }
    }
    if (lowest) {
      lowest.hp = Math.min(lowest.maxHp, lowest.hp + Math.min(120, Math.round(dealt * ratio * 0.25)));
    }
  }

  summonMaLiangPlant(plantId: number, inkCost = 35): boolean {
    if (!this.config.maliangMode || this.phase !== 'playing') return false;
    if (this.maliangInk < inkCost || this.conveyorCards.length >= 12) {
      audio.playSfx('Buzzer', 0.7, 100);
      return false;
    }
    this.maliangInk = Math.max(0, this.maliangInk - inkCost);
    this.conveyorCards.push({
      uid: this.nextUid++,
      plantId,
      progress: 0.96,
    });
    void assets.loadPlantRig(plantId);
    audio.playSfx(['Chime', 'Prize'], 0.85, 50);
    this.emitHud();
    return true;
  }

  private buildVases(): void {
    const specs = this.config.vasebreakerConfig?.vases ?? [];
    for (const v of specs) {
      if (v.row < 0 || v.row >= this.rows || v.col < 0 || v.col >= this.cols) continue;
      const texPath =
        v.kind === 'plant'
          ? 'assets/ui/modes/scary_pot_3.webp'
          : v.kind === 'zombie'
            ? 'assets/ui/modes/scary_pot_4.webp'
            : 'assets/ui/modes/scary_pot_0.webp';
      const tex =
        assets.getCachedTexture(texPath) || assets.getCachedTexture('assets/ui/modes/scary_pot_0.webp');
      const container = new Container();
      const x = this.colCenterX(v.col);
      const y = this.rowGroundY(v.row);
      container.position.set(x, y);
      container.zIndex = y + 1;

      const shadow = new Graphics();
      shadow.ellipse(0, -2, 24, 9).fill({ color: 0x000000, alpha: 0.34 });
      container.addChild(shadow);

      const sp = new Sprite(tex);
      sp.anchor.set(0.5, 0.92);
      sp.scale.set(0.76);
      container.addChild(sp);

      this.entityLayer.addChild(container);
      this.vases.push({
        uid: this.nextUid++,
        row: v.row,
        col: v.col,
        kind: v.kind,
        plantId: v.plantId,
        zombieId: v.zombieId,
        sunBonus: v.sunBonus,
        broken: false,
        sprite: sp,
        container,
      });
    }
  }

  private getUnbrokenVaseAt(row: number, col: number): VaseInstance | undefined {
    return this.vases.find((v) => !v.broken && v.row === row && v.col === col);
  }

  private smashVase(vase: VaseInstance, isChain = false): void {
    if (vase.broken || this.destroyed) return;
    vase.broken = true;
    vase.container.destroy({ children: true });

    const x = this.colCenterX(vase.col);
    const y = this.rowGroundY(vase.row);
    audio.playSfx(['VaseBreaking', 'Ceramic'], 0.9, 45);
    const tint = vase.kind === 'plant' ? 0x4ade80 : vase.kind === 'zombie' ? 0x991b1b : 0xb45309;
    this.particleSys.emitArmorDrop(x, y - 26, tint);

    if (vase.plantId !== undefined && this.conveyorCards.length < 12) {
      this.conveyorCards.push({
        uid: this.nextUid++,
        plantId: vase.plantId,
        progress: 0.96,
      });
      void assets.loadPlantRig(vase.plantId);
    }
    if (vase.zombieId !== undefined) {
      void this.spawnZombieAt(vase.zombieId, vase.row, x);
    }
    if (vase.sunBonus && vase.sunBonus > 0) {
      void this.spawnSun(x, y - 28, y + 6, vase.sunBonus, true);
    }

    if (!isChain && this.config.vasebreakerConfig?.chainReaction) {
      const dirs = [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ];
      for (const [dr, dc] of dirs) {
        const adj = this.getUnbrokenVaseAt(vase.row + dr, vase.col + dc);
        if (adj) {
          setTimeout(() => {
            if (!this.destroyed && this.phase === 'playing' && !adj.broken) {
              this.smashVase(adj, true);
            }
          }, 180);
          break;
        }
      }
    }

    this.emitHud();
  }

  setDeck(plantIds: number[]): void {
    this.setDeckSlots(plantIds.map((plantId) => ({ plantId })));
  }

  setDeckSlots(slots: DeckSlot[]): void {
    this.deckSlots = slots.map((s) => ({ ...s }));
    const cdMult = this.config.modifiers?.cardCdMult ?? 1;
    this.cardCooldowns = this.deckSlots.map((s) => {
      if (this.config.zeroCooldown) return 0;
      const p = assets.getPlant(s.plantId);
      return p && p.cd >= 15 ? Math.min(12, p.cd * 0.5 * cdMult) : 0;
    });
    for (const s of this.deckSlots) {
      void assets.loadPlantRig(s.plantId);
    }
    this.emitHud();
  }

  startBattle(): void {
    if (this.phase !== 'choosing') return;
    audio.unlock();
    this.phase = 'intro';
    this.targetCamX = CAM_X_BATTLE;
    this.introTimer = 0;
    this.waveTimer = this.config.firstWaveDelay;
    audio.playSfx('ReadySetPlant', 0.9, 100);
    this.emitHud();
  }

  setSelectedCard(idx: number): void {
    if (this.phase !== 'playing') return;
    if (idx === this.selectedCardIndex) {
      this.selectedCardIndex = -1;
      this.emitHud();
      return;
    }

    if (this.config.mode === 'iz') {
      const zid = this.izZombieIds[idx];
      if (zid === undefined) return;
      const cost = Math.max(25, assets.getZombie(zid)?.val || 50);
      if (this.sun < cost) {
        audio.playSfx('Buzzer', 0.65, 200);
        return;
      }
      this.selectedCardIndex = idx;
      audio.playSfx('SeedLift', 0.75, 40);
      this.emitHud();
      return;
    }

    if (this.config.conveyorMode || this.config.maliangMode) {
      if (idx >= 0 && idx < this.conveyorCards.length) {
        this.clearToolSelections();
        this.selectedCardIndex = idx;
        audio.playSfx('SeedLift', 0.75, 40);
      }
      this.emitHud();
      return;
    }

    if (idx >= 0 && idx < this.deckSlots.length) {
      const cd = this.cardCooldowns[idx] ?? 0;
      const cost = this.getEffectiveSlotCost(idx);
      if (cd > 0.05) {
        audio.playSfx('Buzzer', 0.65, 200);
        return;
      }
      if (!this.config.infiniteSun && this.sun < cost) {
        audio.playSfx('Buzzer', 0.65, 200);
        return;
      }
      this.clearToolSelections();
      this.selectedCardIndex = idx;
      audio.playSfx('SeedLift', 0.75, 40);
    }
    this.emitHud();
  }

  private clearToolSelections(): void {
    this.selectedCardIndex = -1;
    this.shovelActive = false;
    this.hammerActive = false;
    this.wheelbarrowActive = false;
    this.fertilizerActive = false;
    if (!this.gloveHeldPlant && !this.gloveHeldZombie) {
      this.gloveActive = false;
    }
  }

  toggleTimeStop(): void {
    if (this.phase !== 'playing') return;
    this.timeStopActive = !this.timeStopActive;
    audio.playSfx('Tap', 0.85, 50);
    this.emitHud();
  }

  toggleShovel(): void {
    if (this.phase !== 'playing' || !this.unlockedTools.shovel) return;
    const next = !this.shovelActive;
    this.clearToolSelections();
    this.shovelActive = next;
    if (next) {
      this.gloveActive = false;
      audio.playSfx('Shovel', 0.85, 60);
    }
    this.emitHud();
  }

  toggleGlove(): void {
    if (this.phase !== 'playing' || !this.unlockedTools.glove) return;
    if (this.gloveCooldownLeft > 0.05 && !this.gloveHeldPlant && !this.gloveHeldZombie) {
      audio.playSfx('Buzzer', 0.6, 200);
      return;
    }
    const next = !this.gloveActive;
    if (!next && (this.gloveHeldPlant || this.gloveHeldZombie)) {
      return;
    }
    this.clearToolSelections();
    this.gloveActive = next;
    if (next) {
      audio.playSfx('SeedLift', 0.8, 60);
    }
    this.emitHud();
  }

  toggleGloveMode(): void {
    if (this.phase !== 'playing' || !this.unlockedTools.glove) return;
    if (this.gloveHeldPlant || this.gloveHeldZombie) {
      audio.playSfx('Buzzer', 0.6, 120);
      return;
    }
    this.gloveMode = this.gloveMode === 'plant' ? 'zombie' : 'plant';
    audio.playSfx('Tap', 0.8, 50);
    this.emitHud();
  }

  toggleHammer(): void {
    if (this.phase !== 'playing' || !this.unlockedTools.hammer) return;
    if (this.hammerCooldownLeft > 0.05) {
      audio.playSfx('Buzzer', 0.6, 200);
      return;
    }
    const next = !this.hammerActive;
    this.clearToolSelections();
    this.hammerActive = next;
    if (next) audio.playSfx('SeedLift', 0.8, 60);
    this.emitHud();
  }

  toggleWheelbarrow(): void {
    if (this.phase !== 'playing' || !this.unlockedTools.wheelbarrow) return;
    if (this.wheelbarrowCooldownLeft > 0.05 && !this.wheelbarrowStored) {
      audio.playSfx('Buzzer', 0.6, 200);
      return;
    }
    const next = !this.wheelbarrowActive;
    this.clearToolSelections();
    this.wheelbarrowActive = next;
    if (next) audio.playSfx('SeedLift', 0.8, 60);
    this.emitHud();
  }

  toggleFertilizer(): void {
    if (this.phase !== 'playing' || !this.unlockedTools.fertilizer) return;
    if (this.fertilizerCharges <= 0) {
      audio.playSfx('Buzzer', 0.6, 200);
      return;
    }
    const next = !this.fertilizerActive;
    this.clearToolSelections();
    this.fertilizerActive = next;
    if (next) audio.playSfx('SeedLift', 0.8, 60);
    this.emitHud();
  }

  /** Cancels the active HUD card/tool selection (for touchscreens & HUD cancel button). */
  cancelSelection(): void {
    this.cancelActiveTool();
  }

  toggleSpeed(): void {
    this.speed = this.speed === 1 ? 2 : this.speed === 2 ? 3 : 1;
    audio.playSfx('Tap', 0.7, 40);
    this.emitHud();
  }

  toggleAutoCollect(): void {
    this.autoCollect = !this.autoCollect;
    saveManager.update({ autoCollect: this.autoCollect });
    audio.playSfx('ButtonClick', 0.7, 50);
    this.emitHud();
  }

  setPaused(paused: boolean): void {
    if (paused && this.phase === 'playing') {
      this.phase = 'paused';
      audio.playSfx('Pause', 0.8, 100);
    } else if (!paused && this.phase === 'paused') {
      this.phase = 'playing';
    }
    this.emitHud();
  }

  /** Updates battle difficulty live (e.g. from SeedChooser or PauseMenu). */
  setDifficulty(level: number): void {
    this.config.difficulty = clampDifficulty(level);
    this.emitHud();
  }

  /** Spawns a zombie immediately (used by Sandbox / E2E tests as well as waves). */
  async spawnZombieAt(zombieId: number, row?: number, startX?: number): Promise<void> {
    if (this.destroyed) return;
    const zDef = assets.getZombie(zombieId) ?? assets.getZombie(0);
    if (!zDef) return;
    const beh = getZombieBehavior(zombieId);

    const waterRows = this.config.scene.waterRows;
    const wps = this.config.mode === 'tower' ? this.config.towerConfig?.waypoints : undefined;
    const isTowerSpawn = Boolean(wps && wps.length >= 2 && row === undefined && startX === undefined);
    let targetRow = isTowerSpawn && wps ? wps[0].row : (row ?? Math.floor(Math.random() * this.rows));
    if (!isTowerSpawn) {
      if (beh.aquatic && waterRows.length > 0 && row === undefined) {
        targetRow = waterRows[Math.floor(Math.random() * waterRows.length)];
      } else if (!beh.aquatic && waterRows.includes(targetRow) && row === undefined) {
        const landRows = Array.from({ length: this.rows }, (_, i) => i).filter(
          (r) => !waterRows.includes(r),
        );
        if (landRows.length > 0) {
          targetRow = landRows[Math.floor(Math.random() * landRows.length)];
        }
      }
    }
    targetRow = Math.max(0, Math.min(this.rows - 1, targetRow));

    this.pendingZombieSpawns++;
    let rigData: LoadedRig | null = null;
    try {
      rigData = await assets.loadZombieRig(zombieId);
    } finally {
      this.pendingZombieSpawns = Math.max(0, this.pendingZombieSpawns - 1);
    }
    if (this.destroyed) return;

    const x =
      startX ??
      (isTowerSpawn && wps ? this.colCenterX(wps[0].col) + 28 : 1110 + Math.random() * 55);
    const y = this.rowGroundY(targetRow);
    const container = new Container();
    container.position.set(x, y);
    container.scale.set(UNITY_ENTITY_SCALE);
    container.zIndex = y + 2;
    this.entityLayer.addChild(container);

    let rig: UnityRigInstance | null = null;
    let animator: UnityAnimator | null = null;
    const hpScale =
      this.config.mode === 'iz'
        ? 1
        : this.config.zombieHpMult *
          (this.config.modifiers?.zombieHpBonusMult ?? 1) *
          getDifficultyInfo(this.config.difficulty).hpScale;
    const armorScale = hpScale * (this.config.modifiers?.zombieArmorMult ?? 1);
    const maxHp = Math.round(zDef.hp * hpScale);
    const leaderExtra =
      this.config.mode !== 'iz' && beh.isLeader && this.config.modifiers?.extraLeaderShield ? 500 : 0;
    const a1Max =
      Math.round(zDef.a1 * armorScale) +
      (this.config.mode !== 'iz' && beh.isLeader && zDef.a1 === 0 ? 100 : 0) +
      leaderExtra;
    const a2Max =
      Math.round(zDef.a2 * armorScale) +
      (this.config.mode !== 'iz' && beh.isLeader && zDef.a2 === 0 ? 250 : 0);

    const zInst: ZombieInstance = {
      uid: this.nextUid++,
      zombieId,
      def: zDef,
      beh,
      row: targetRow,
      x,
      y,
      hp: maxHp,
      maxHp,
      a1Hp: a1Max,
      a1Max,
      a2Hp: a2Max,
      a2Max,
      chillTimer: 0,
      freezeTimer: 0,
      butterTimer: 0,
      flashTimer: 0,
      hypnotized: false,
      enraged: false,
      hasVaulted: false,
      headDropped: false,
      dying: false,
      dieTimer: 0,
      biteTimer: 0,
      jackTimer: beh.explodeTimer,
      wpIdx: wps && wps.length >= 2 ? 1 : undefined,
      isPreviewOnly: false,
      previewWanderDir: 1,
      rig,
      animator,
      container,
      hpBar: new Graphics(),
      lastHpBarKey: -1,
      removed: false,
    };

    if (rigData) {
      rig = new UnityRigInstance(rigData);
      zInst.rig = rig;
      container.addChild(rig.container);
      const isWater = waterRows.includes(targetRow);
      const initClip = beh.flying && rigData.data.clips.fly
        ? 'fly'
        : isWater && rigData.data.clips.swim
          ? 'swim'
          : 'walk';
      animator = new UnityAnimator(rig, initClip);
      zInst.animator = animator;
      animator.onEvent = (fn) => {
        if (fn === 'PlayEatSound') {
          audio.playSfx(['Chomp', 'Chomp2', 'ChompSoft'], 0.72, 260);
        } else if (fn === 'PlayFallSound') {
          audio.playSfx(['ZombieFalling1', 'ZombieFalling2'], 0.68, 220);
        } else if (fn === 'AnimCrash') {
          audio.playSfx('GargantuarThump', 0.9, 200);
        } else if (fn === 'DestoryZombie') {
          zInst.dieTimer = Math.min(zInst.dieTimer, 0.25);
        }
      };
    }

    zInst.hpBar.position.set(0, -148);
    container.addChild(zInst.hpBar);
    this.zombies.push(zInst);
    this.totalSpawnedZombies++;
  }

  colCenterX(col: number): number {
    return BOARD_X + (col + 0.5) * this.cellW;
  }

  rowGroundY(row: number): number {
    return this.rowY0 + (row + 0.84) * this.cellH;
  }

  private screenToTile(screenX: number, screenY: number): { row: number; col: number } | null {
    const worldX = screenX + this.camX;
    const worldY = screenY;
    const col = Math.floor((worldX - BOARD_X) / this.cellW);
    const row = Math.floor((worldY - this.rowY0) / this.cellH);
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) {
      return null;
    }
    return { row, col };
  }

  private bindInput(canvas: HTMLCanvasElement): void {
    const mapPoint = (e: PointerEvent): { sx: number; sy: number } => {
      const pt = mapClientToCanvas(canvas, e.clientX, e.clientY, VIEW_W, VIEW_H);
      return { sx: pt.x, sy: pt.y };
    };

    const onMove = (e: PointerEvent) => {
      if (this.phase !== 'playing') {
        this.hoverTile = null;
        return;
      }
      const { sx, sy } = mapPoint(e);
      this.hoverTile = this.screenToTile(sx, sy);

      // Hover collection for dropped suns
      const wx = sx + this.camX;
      for (const s of this.suns) {
        if (!s.collecting && Math.hypot(s.x - wx, s.y - sy) < 42) {
          this.collectSun(s);
        }
      }
    };

    const onDown = (e: PointerEvent) => {
      audio.unlock();
      if (e.button === 2) {
        this.cancelActiveTool();
        return;
      }
      if (this.phase !== 'playing') return;

      const { sx, sy } = mapPoint(e);
      const wx = sx + this.camX;

      // Priority 1: Click sun before interacting with tiles
      for (const s of this.suns) {
        if (!s.collecting && Math.hypot(s.x - wx, s.y - sy) < 48) {
          this.collectSun(s);
          return;
        }
      }

      if (this.hammerActive) {
        this.useHammerAt(wx, sy);
        return;
      }

      if (this.gloveActive && this.gloveMode === 'zombie' && !this.gloveHeldZombie) {
        this.pickZombieWithGlove(wx, sy);
        return;
      }

      const tile = this.screenToTile(sx, sy);
      this.hoverTile = tile;
      if (!tile) {
        this.cancelActiveTool();
        return;
      }
      void this.handleTileClick(tile.row, tile.col);
    };

    const onContext = (e: MouseEvent) => {
      e.preventDefault();
      this.cancelActiveTool();
    };

    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('contextmenu', onContext);
  }

  private cancelActiveTool(): void {
    this.selectedCardIndex = -1;
    this.shovelActive = false;
    this.hammerActive = false;
    this.wheelbarrowActive = false;
    this.fertilizerActive = false;
    if (!this.gloveHeldPlant && !this.gloveHeldZombie) {
      this.gloveActive = false;
    }
    this.emitHud();
  }

  private useHammerAt(wx: number, sy: number): void {
    const r = 108;
    audio.playSfx(['Bonk', 'GargantuarThump'], 0.95, 50);
    this.particleSys.emitExplosion(wx, sy, r, 'cherry');
    for (const z of this.zombies) {
      if (z.removed || z.dying || z.hypnotized) continue;
      if (Math.hypot(z.x - wx, (z.y - 36) - sy) <= r) {
        const isHeavy = z.beh.isBoss || z.beh.isLeader;
        const dmg = isHeavy ? 5000 : 1000000;
        this.damageZombie(z, dmg, { ignoreShield: true, trueDamage: !isHeavy });
      }
    }
    this.hammerActive = false;
    const hmMult = this.config.modifiers?.hammerCdMult ?? 1;
    this.hammerCooldownLeft = this.config.zeroCooldown ? 0 : 60 * hmMult;
    this.emitHud();
  }

  private pickZombieWithGlove(wx: number, sy: number): void {
    let best: ZombieInstance | null = null;
    let bestD = 68;
    for (const z of this.zombies) {
      if (z.removed || z.dying) continue;
      const d = Math.hypot(z.x - wx, (z.y - 36) - sy);
      if (d < bestD) {
        bestD = d;
        best = z;
      }
    }
    if (!best || best.beh.isBoss || best.beh.isLeader) {
      audio.playSfx('Buzzer', 0.7, 150);
      return;
    }
    this.gloveHeldZombie = best;
    best.container.alpha = 0.65;
    audio.playSfx('SeedLift', 0.85, 40);
    this.emitHud();
  }

  private async handleTileClick(row: number, col: number): Promise<void> {
    const slot = this.tileGrid[row]?.[col];
    if (!slot) return;

    if (this.shovelActive) {
      const removed = this.removeTopPlantAt(slot);
      if (removed) {
        audio.playSfx('Plant2', 0.85, 40);
      }
      this.shovelActive = false;
      this.emitHud();
      return;
    }

    if (this.fertilizerActive && this.fertilizerCharges > 0) {
      const allHere: PlantInstance[] = [
        ...(slot.base ? [slot.base] : []),
        ...slot.mains,
        ...(slot.pumpkin ? [slot.pumpkin] : []),
        ...(slot.fly ? [slot.fly] : []),
      ];
      if (allHere.length === 0) {
        audio.playSfx('Buzzer', 0.6, 150);
        return;
      }
      for (const pl of allHere) {
        pl.hp = pl.maxHp;
        pl.frost = 0;
        pl.frozenTimer = 0;
        pl.chewTimer = 0;
        pl.specialTimer = 0;
        if (pl.beh.kind === 'mine') {
          pl.armTimer = 0;
          pl.armed = true;
        }
        if (pl.beh.kind === 'producer' || pl.beh.kind === 'shooter_producer') {
          void this.spawnSun(pl.x, pl.y - 26, pl.y + 8, pl.beh.sunAmount, true);
        }
      }
      this.fertilizerCharges -= 1;
      this.fertilizerActive = false;
      this.particleSys.emitSunSparkle(this.colCenterX(col), this.rowGroundY(row) - 24);
      audio.playSfx(['Fertilizer', 'PlantGrow'], 0.9, 50);
      this.emitHud();
      return;
    }

    if (this.wheelbarrowActive) {
      if (!this.wheelbarrowStored) {
        const cand = this.getTopPlantCandidate(slot);
        if (!cand || cand.plantId === 1151 || cand.plantId === 310) {
          audio.playSfx('Buzzer', 0.65, 180);
          return;
        }
        this.wheelbarrowStored = { plantId: cand.plantId, hp: cand.hp, maxHp: cand.maxHp };
        this.destroyPlantInstance(cand, slot);
        this.wheelbarrowActive = false;
        audio.playSfx('SeedLift', 0.85, 40);
        this.emitHud();
        return;
      }
      const res = await this.tryPlantOrFuse(this.wheelbarrowStored.plantId, row, col, {
        free: true,
        preserveExactHp: this.wheelbarrowStored.hp,
        suppressSpawnEffect: true,
      });
      if (res) {
        this.wheelbarrowStored = null;
        this.wheelbarrowActive = false;
        const wbCd = this.config.wheelbarrowCooldown ?? 30;
        this.wheelbarrowCooldownLeft = this.config.zeroCooldown ? 0 : wbCd;
        this.emitHud();
      } else {
        audio.playSfx('Buzzer', 0.65, 180);
      }
      return;
    }

    if (this.gloveActive) {
      if (this.gloveMode === 'zombie' && this.gloveHeldZombie) {
        const z = this.gloveHeldZombie;
        z.row = row;
        z.x = this.colCenterX(col);
        z.y = this.rowGroundY(row);
        z.container.position.set(z.x, z.y);
        z.container.zIndex = z.y + 2;
        z.container.alpha = 1;
        this.gloveHeldZombie = null;
        this.gloveActive = false;
        this.gloveCooldownLeft = this.config.zeroCooldown ? 0 : z.hypnotized ? 15 : 30;
        audio.playSfx('Plant', 0.85, 40);
        this.emitHud();
        return;
      }
      if (!this.gloveHeldPlant) {
        const picked = this.pickTopPlantAt(slot);
        if (picked) {
          this.gloveHeldPlant = {
            plantId: picked.plantId,
            hp: picked.hp,
            maxHp: picked.maxHp,
          };
          audio.playSfx('SeedLift', 0.8, 40);
          this.emitHud();
        } else {
          audio.playSfx('Buzzer', 0.5, 200);
        }
        return;
      }
      const movedId = this.gloveHeldPlant.plantId;
      const res = await this.tryPlantOrFuse(movedId, row, col, {
        free: true,
        preserveHpRatio: this.gloveHeldPlant.hp / Math.max(1, this.gloveHeldPlant.maxHp),
      });
      if (res) {
        const movedDef = assets.getPlant(movedId);
        const movedBeh = getPlantBehavior(movedId);
        const isFastGlove =
          movedDef?.layer === 'Lily' ||
          movedDef?.layer === 'Pot' ||
          movedDef?.layer === 'Fly' ||
          movedBeh.stackable3;
        const baseCd = this.config.gloveCooldown;
        this.gloveCooldownLeft = this.config.zeroCooldown
          ? 0
          : isFastGlove
            ? Math.round((baseCd / 3) * 10) / 10
            : baseCd;
        this.gloveHeldPlant = null;
        this.gloveActive = false;
        this.emitHud();
      } else {
        audio.playSfx('Buzzer', 0.6, 200);
      }
      return;
    }

    if (this.config.mode === 'iz' && this.config.izConfig) {
      if (this.selectedCardIndex >= 0) {
        const zid = this.izZombieIds[this.selectedCardIndex];
        if (zid === undefined) return;
        const cost = Math.max(25, assets.getZombie(zid)?.val || 50);
        if (col < this.config.izConfig.redlineColumn || this.sun < cost) {
          audio.playSfx('Buzzer', 0.65, 180);
          return;
        }
        this.sun = Math.max(0, this.sun - cost);
        this.selectedCardIndex = -1;
        this.izStallTimer = 0;
        void this.spawnZombieAt(zid, row, this.colCenterX(col));
        audio.playSfx(['Plant', 'Groan'], 0.85, 60);
        this.emitHud();
      }
      return;
    }

    if (this.selectedCardIndex >= 0) {
      const cardIdx = this.selectedCardIndex;
      if (this.config.conveyorMode || this.config.maliangMode) {
        const card = this.conveyorCards[cardIdx];
        if (!card) return;
        const ok = await this.tryPlantOrFuse(card.plantId, row, col, { free: true });
        if (ok) {
          this.conveyorCards.splice(cardIdx, 1);
          this.selectedCardIndex = -1;
          this.emitHud();
        } else {
          audio.playSfx('Buzzer', 0.65, 200);
        }
        return;
      }

      const slotDeck = this.deckSlots[cardIdx];
      if (!slotDeck) return;
      const plantId = slotDeck.plantId;
      const def = assets.getPlant(plantId);
      if (!def) return;

      const cost = this.getEffectiveSlotCost(cardIdx);
      if (!this.config.infiniteSun && this.sun < cost) {
        audio.playSfx('Buzzer', 0.7, 200);
        return;
      }

      const ok = await this.tryPlantOrFuse(plantId, row, col, { free: this.config.infiniteSun });
      if (ok) {
        if (!this.config.infiniteSun) {
          this.sun = Math.max(0, this.sun - cost);
        }
        this.cardCooldowns[cardIdx] = this.getEffectiveCardCd(plantId);
        this.selectedCardIndex = -1;
        this.emitHud();
      } else {
        audio.playSfx('Buzzer', 0.65, 200);
      }
      return;
    }

    if (this.config.vasebreakerConfig) {
      const vase = this.getUnbrokenVaseAt(row, col);
      if (vase) {
        this.smashVase(vase, false);
      }
    }
  }

  /** Evaluates whether planting `incomingId` on `(row, col)` fuses into a new plant or places normally. */
  private previewTileAction(
    incomingId: number,
    row: number,
    col: number,
  ):
    | { mode: 'fuse'; existing: PlantInstance; resultId: number }
    | { mode: 'place'; slotType: PlantInstance['slotType'] }
    | null {
    const slot = this.tileGrid[row]?.[col];
    const def = assets.getPlant(incomingId);
    if (!slot || !def || slot.craterTimer > 0) return null;
    if (this.getUnbrokenVaseAt(row, col)) return null;

    const beh = getPlantBehavior(incomingId);
    if (slot.hasGrave) {
      return beh.kind === 'gravebuster' ? { mode: 'place', slotType: 'main' } : null;
    }
    if (beh.kind === 'gravebuster') {
      return null;
    }
    if (
      this.towerRoadCells.has(`${row}|${col}`) &&
      beh.kind !== 'spike' &&
      beh.kind !== 'mine' &&
      beh.kind !== 'instant_bomb' &&
      beh.kind !== 'instant_row' &&
      beh.kind !== 'instant_doom' &&
      beh.kind !== 'instant_ice'
    ) {
      return null;
    }

    // 1. Check fusion against existing plants in priority: main -> pumpkin -> fly -> base
    const candidates: PlantInstance[] = [
      ...slot.mains,
      ...(slot.pumpkin ? [slot.pumpkin] : []),
      ...(slot.fly ? [slot.fly] : []),
      ...(slot.base ? [slot.base] : []),
    ];
    for (const ex of candidates) {
      const resId = fusionSystem.getFusionResult(ex.plantId, incomingId);
      if (resId !== null && assets.getPlant(resId)) {
        return { mode: 'fuse', existing: ex, resultId: resId };
      }
    }

    // 2. Normal placement rules
    const isWater = this.config.scene.waterRows.includes(row);
    const isRoof = Boolean(this.config.scene.roof);

    if (def.layer === 'Lily') {
      return isWater && !slot.base ? { mode: 'place', slotType: 'base' } : null;
    }
    if (def.layer === 'Pot') {
      return !isWater && !slot.base ? { mode: 'place', slotType: 'base' } : null;
    }
    if (def.layer === 'Fly') {
      return !slot.fly ? { mode: 'place', slotType: 'fly' } : null;
    }
    if (def.layer === 'Pumpkin') {
      if (isWater && !slot.base) return null;
      return !slot.pumpkin ? { mode: 'place', slotType: 'pumpkin' } : null;
    }

    // Standard Default layer plant
    if (beh.aquaticOnly) {
      return isWater && slot.mains.length === 0 ? { mode: 'place', slotType: 'main' } : null;
    }
    if (isWater && (!slot.base || assets.getPlant(slot.base.plantId)?.layer !== 'Lily')) {
      return null;
    }
    if (isRoof && (!slot.base || assets.getPlant(slot.base.plantId)?.layer !== 'Pot')) {
      return null;
    }
    if (this.config.stackerMode) {
      return slot.mains.length < 6 ? { mode: 'place', slotType: 'main' } : null;
    }
    if (beh.stackable3) {
      const canStack =
        slot.mains.length === 0 ||
        (slot.mains.length < 3 && slot.mains.every((m) => m.beh.stackable3));
      return canStack ? { mode: 'place', slotType: 'main' } : null;
    }
    return slot.mains.length === 0 ? { mode: 'place', slotType: 'main' } : null;
  }

  private async tryPlantOrFuse(
    plantId: number,
    row: number,
    col: number,
    opts?: {
      free?: boolean;
      preserveHpRatio?: number;
      preserveExactHp?: number;
      suppressSpawnEffect?: boolean;
    },
  ): Promise<boolean> {
    const slot = this.tileGrid[row]?.[col];
    if (!slot) return false;
    const action = this.previewTileAction(plantId, row, col);
    if (!action) return false;

    const x = this.colCenterX(col);
    const y = this.rowGroundY(row);

    if (action.mode === 'fuse') {
      const ex = action.existing;
      const parentADef = ex.def;
      const parentBDef = assets.getPlant(plantId)!;
      const resultDef = assets.getPlant(action.resultId)!;
      const targetSlotType = this.resolveSlotType(resultDef, ex.slotType);

      this.destroyPlantInstance(ex, slot);
      await this.placePlant(action.resultId, row, col, true, targetSlotType);

      this.fusions++;
      saveManager.recordFusion(action.resultId);
      this.particleSys.emitFusionBurst(x, y);
      audio.playSfx(['PlantGrow', 'Chime'], 0.9, 60);
      this.callbacks.onFusionToast(parentADef, parentBDef, resultDef);
      return true;
    }

    const placed = await this.placePlant(
      plantId,
      row,
      col,
      Boolean(opts?.suppressSpawnEffect),
      action.slotType,
    );
    if (placed && opts?.preserveExactHp !== undefined) {
      placed.hp = Math.max(10, Math.min(placed.maxHp, Math.round(opts.preserveExactHp)));
    } else if (placed && opts?.preserveHpRatio !== undefined) {
      placed.hp = Math.max(10, Math.round(placed.maxHp * opts.preserveHpRatio));
    }
    if (this.config.scene.waterRows.includes(row) && !slot.base) {
      this.particleSys.emitWaterSplash(x, y);
      audio.playSfx('PlantWater', 0.85, 50);
    } else {
      this.particleSys.emitPlantDirt(x, y);
      audio.playSfx(['Plant', 'Plant2'], 0.85, 40);
    }
    return true;
  }

  private resolveSlotType(def: PlantDef, fallback: PlantInstance['slotType']): PlantInstance['slotType'] {
    if (def.layer === 'Lily' || def.layer === 'Pot') return 'base';
    if (def.layer === 'Pumpkin') return 'pumpkin';
    if (def.layer === 'Fly') return 'fly';
    return fallback === 'base' ? 'main' : fallback;
  }

  private async placePlant(
    plantId: number,
    row: number,
    col: number,
    instantAction = false,
    forcedSlot?: PlantInstance['slotType'],
    overrideHp?: number,
  ): Promise<PlantInstance | null> {
    const slot = this.tileGrid[row]?.[col];
    const def = assets.getPlant(plantId);
    if (!slot || !def) return null;

    const beh = getPlantBehavior(plantId);
    const slotType = forcedSlot ?? this.resolveSlotType(def, 'main');
    const hpMult = this.config.modifiers?.plantHpMult ?? 1;
    const baseResolvedHp = overrideHp && overrideHp > 0 ? overrideHp : beh.maxHp;
    const resolvedHp = overrideHp && overrideHp > 0 ? baseResolvedHp : Math.max(1, Math.round(baseResolvedHp * hpMult));

    // Compute subtle offset when stacking up to 3 puffs or Stacker tower plants on one tile
    let offsetX = 0;
    let offsetY = 0;
    if (slotType === 'main' && this.config.stackerMode) {
      offsetY = -slot.mains.length * 16;
    } else if (slotType === 'main' && beh.stackable3) {
      const idx = slot.mains.length;
      if (idx === 1) {
        offsetX = -16;
        offsetY = -6;
      } else if (idx === 2) {
        offsetX = 16;
        offsetY = -3;
      }
    } else if (slotType === 'fly') {
      offsetY = -34;
    }

    const x = this.colCenterX(col) + offsetX;
    const y = this.rowGroundY(row) + offsetY;

    const container = new Container();
    container.position.set(x, y);
    container.scale.set(UNITY_ENTITY_SCALE);
    const stackBias = slotType === 'main' && this.config.stackerMode ? slot.mains.length * 4 : 0;
    const zBias = slotType === 'base' ? -8 : slotType === 'pumpkin' ? 6 : slotType === 'fly' ? 12 : 1 + stackBias;
    container.zIndex = this.rowGroundY(row) + zBias;
    this.entityLayer.addChild(container);

    const inst: PlantInstance = {
      uid: this.nextUid++,
      plantId,
      def,
      beh,
      row,
      col,
      slotType,
      x,
      y,
      hp: resolvedHp,
      maxHp: resolvedHp,
      atkTimer: beh.kind === 'shooter' || beh.kind === 'shooter_producer' ? 0.35 : beh.attackInterval * 0.4,
      prodTimer: beh.produceInterval * 0.35,
      armTimer: beh.kind === 'mine' ? 8.5 : beh.kind === 'gravebuster' ? 3.2 : 0,
      armed: beh.kind !== 'mine',
      chewTimer: 0,
      flashTimer: 0,
      burstLeft: 0,
      burstTimer: 0,
      burstTargetAngle: 0,
      frost: 0,
      frozenTimer: 0,
      specialTimer: beh.kind === 'magnet' ? 2.5 : 4.0,
      rig: null,
      animator: null,
      container,
      dead: false,
    };

    if (slotType === 'base') {
      slot.base = inst;
    } else if (slotType === 'pumpkin') {
      slot.pumpkin = inst;
    } else if (slotType === 'fly') {
      slot.fly = inst;
    } else {
      slot.mains.push(inst);
    }
    this.plants.push(inst);

    const rigData = await assets.loadPlantRig(plantId);
    if (!this.destroyed && !inst.dead && rigData) {
      const rig = new UnityRigInstance(rigData);
      inst.rig = rig;
      container.addChild(rig.container);
      const animator = new UnityAnimator(rig, 'idle');
      for (const hClip of ['head1', 'head2', 'head3']) {
        if (animator.hasClip(hClip) && animator.clips[hClip]?.additive) {
          animator.addAdditiveLoop(hClip, Math.random() * 0.5);
        }
      }
      inst.animator = animator;
      animator.onEvent = (fn) => {
        if (inst.dead) return;
        if (fn === 'AnimShoot') {
          this.firePlantProjectile(inst);
        } else if (fn === 'AnimGive') {
          this.spawnSun(inst.x + (Math.random() - 0.5) * 18, inst.y - 24, inst.y + 6, inst.beh.sunAmount, true);
        }
      };
    }

    if (!instantAction) {
      // Trigger immediate instant effects cleanly
      if (beh.kind === 'instant_bomb') {
        this.triggerBombPlant(inst, 'cherry');
      } else if (beh.kind === 'instant_row') {
        this.triggerRowJalapeno(inst);
      } else if (beh.kind === 'instant_doom') {
        this.triggerBombPlant(inst, 'doom');
      } else if (beh.kind === 'instant_ice') {
        this.triggerIceShroom(inst);
      } else if (beh.kind === 'blover') {
        this.triggerBlover(inst);
      }
    }

    return inst;
  }

  private removeTopPlantAt(slot: TileSlotState): boolean {
    const target = this.pickTopPlantAt(slot);
    return target !== null;
  }

  private getTopPlantCandidate(slot: TileSlotState): PlantInstance | null {
    if (slot.pumpkin) return slot.pumpkin;
    if (slot.fly) return slot.fly;
    if (slot.mains.length > 0) return slot.mains[slot.mains.length - 1];
    return slot.base;
  }

  private pickTopPlantAt(slot: TileSlotState): PlantInstance | null {
    const target = this.getTopPlantCandidate(slot);
    if (!target) return null;
    this.destroyPlantInstance(target, slot);
    return target;
  }

  private destroyPlantInstance(inst: PlantInstance, slotOpt?: TileSlotState): void {
    if (inst.dead) return;
    inst.dead = true;
    const slot = slotOpt ?? this.tileGrid[inst.row]?.[inst.col];
    if (slot) {
      if (slot.base === inst) slot.base = null;
      if (slot.pumpkin === inst) slot.pumpkin = null;
      if (slot.fly === inst) slot.fly = null;
      const idx = slot.mains.indexOf(inst);
      if (idx >= 0) slot.mains.splice(idx, 1);
    }
    const gIdx = this.plants.indexOf(inst);
    if (gIdx >= 0) this.plants.splice(gIdx, 1);
    if (this.config.mode === 'iz' && this.phase === 'playing' && this.config.izConfig) {
      const dropVal = this.config.izConfig.dropSunPerPlant;
      const isSunPlant =
        inst.beh.kind === 'producer' ||
        inst.beh.kind === 'shooter_producer' ||
        inst.def.name.includes('向日葵') ||
        inst.def.name.includes('阳光');
      if (dropVal > 0) {
        if (dropVal >= 25) {
          void this.spawnSun(inst.x, inst.y - 24, inst.y + 8, dropVal, true);
        } else {
          for (let k = 0; k < dropVal; k++) {
            void this.spawnSun(inst.x + (k - 1) * 14, inst.y - 24, inst.y + 8, 50, true);
          }
        }
      } else if (isSunPlant) {
        for (let k = 0; k < 4; k++) {
          void this.spawnSun(inst.x + (k - 1.5) * 12, inst.y - 26, inst.y + 8, 50, true);
        }
      }
    }
    inst.rig?.destroy();
    inst.container.destroy({ children: true });
  }

  private tick(rawDt: number): void {
    if (this.destroyed || !this.app) return;

    // Camera smooth ease works both in chooser->intro and pause
    if (Math.abs(this.camX - this.targetCamX) > 0.5) {
      this.camX += (this.targetCamX - this.camX) * Math.min(1, rawDt * 4.5);
      this.worldContainer.position.set(-Math.round(this.camX), 0);
    }

    if (this.phase === 'choosing') {
      for (const pz of this.previewZombies) {
        pz.animator?.update(rawDt);
        pz.x += pz.previewWanderDir * 5 * rawDt;
        if (pz.x < 1110) pz.previewWanderDir = 1;
        if (pz.x > 1295) pz.previewWanderDir = -1;
        pz.container.position.set(pz.x, pz.y);
      }
      return;
    }

    if (this.phase === 'intro') {
      this.updateIntro(rawDt);
      for (const p of this.plants) p.animator?.update(rawDt);
      for (const m of this.mowers) m.animator?.update(rawDt);
      return;
    }

    if (this.phase !== 'playing') {
      return;
    }

    const dt = rawDt * (this.timeStopActive ? 0.2 : this.speed);
    this.elapsedSec += dt;

    // Cooldowns & tool timers
    for (let i = 0; i < this.cardCooldowns.length; i++) {
      if (this.cardCooldowns[i] > 0) {
        this.cardCooldowns[i] = Math.max(0, this.cardCooldowns[i] - dt);
      }
    }
    if (this.gloveCooldownLeft > 0) {
      this.gloveCooldownLeft = Math.max(0, this.gloveCooldownLeft - dt);
    }
    if (this.hammerCooldownLeft > 0) {
      this.hammerCooldownLeft = Math.max(0, this.hammerCooldownLeft - dt);
    }
    if (this.wheelbarrowCooldownLeft > 0) {
      this.wheelbarrowCooldownLeft = Math.max(0, this.wheelbarrowCooldownLeft - dt);
    }
    if (this.unlockedTools.fertilizer && this.fertilizerCharges < 5) {
      this.fertilizerTimer -= dt;
      if (this.fertilizerTimer <= 0) {
        this.fertilizerTimer = 70;
        this.fertilizerCharges = Math.min(5, this.fertilizerCharges + 1);
        audio.playSfx('Chime', 0.72, 120);
      }
    }
    if (this.config.maliangMode) {
      this.maliangInk = Math.min(100, this.maliangInk + 14 * dt);
    }

    // Tile craters
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (this.tileGrid[r][c].craterTimer > 0) {
          this.tileGrid[r][c].craterTimer = Math.max(0, this.tileGrid[r][c].craterTimer - dt);
        }
      }
    }

    // Conveyor belt progression (plus revealed cards tray in Vasebreaker / MaLiang)
    if (this.config.conveyorMode) {
      const step = this.config.vasebreakerConfig ? 0.088 : 0.1;
      for (let i = 0; i < this.conveyorCards.length; i++) {
        const card = this.conveyorCards[i];
        const targetPos = i * step;
        if (card.progress > targetPos) {
          card.progress = Math.max(targetPos, card.progress - dt * 0.28);
        } else {
          card.progress = targetPos;
        }
      }
      if (!this.config.vasebreakerConfig && !this.config.maliangMode) {
        this.conveyorTimer -= dt;
        if (this.conveyorTimer <= 0) {
          this.conveyorTimer = Math.max(2.0, this.config.conveyorInterval || 5.0);
          if (this.conveyorCards.length < 10) {
            this.pushConveyorCard(0.96);
          }
        }
      }
    }

    // Sky sun (disabled in night, conveyor, tower, and IZ scenes)
    if (!this.config.scene.night && !this.config.conveyorMode && this.config.mode !== 'iz') {
      this.skySunTimer -= dt;
      if (this.skySunTimer <= 0) {
        this.skySunTimer = 8.5 + Math.random() * 4.0;
        const sx = BOARD_X + 45 + Math.random() * (this.cellW * (this.cols - 1));
        const ty = 175 + Math.random() * 340;
        void this.spawnSun(sx, -25, ty, 25, false);
      }
    }

    // Fade laser / solar beams
    for (let i = this.fadingBeams.length - 1; i >= 0; i--) {
      const fb = this.fadingBeams[i];
      fb.life -= rawDt;
      if (fb.life <= 0) {
        fb.gfx.destroy();
        this.fadingBeams.splice(i, 1);
      } else {
        fb.gfx.alpha = fb.life / fb.maxLife;
      }
    }

    this.updateFog(dt);
    this.updateSnowWarmth(dt);
    if (this.config.mode === 'iz') {
      this.updateIzStall(dt);
    } else {
      this.updateWaves(dt);
    }
    this.updatePlants(dt);
    this.updateZombies(dt);
    this.updateBullets(dt);
    this.updateMowers(dt);
    this.updateSuns(dt);
    this.updateHoverDecal(rawDt);
    this.particleSys.update(dt);

    if (this.hugeWaveTimer > 0) {
      this.hugeWaveTimer = Math.max(0, this.hugeWaveTimer - rawDt);
    }
    if (this.finalWaveTimer > 0) {
      this.finalWaveTimer = Math.max(0, this.finalWaveTimer - rawDt);
    }

    this.hudEmitAcc += rawDt;
    if (this.hudEmitAcc >= 0.08) {
      this.hudEmitAcc = 0;
      this.emitHud();
    }
  }

  private updateIntro(rawDt: number): void {
    this.introTimer += rawDt;
    const stageIdx = this.introTimer < 0.7 ? 0 : this.introTimer < 1.35 ? 1 : 2;
    const keys = ['assets/ui/start_ready.webp', 'assets/ui/start_set.webp', 'assets/ui/start_plant.webp'];
    const labels = ['准备…', '安放…', '开始种植!'];
    this.bannerText = labels[stageIdx];

    const tex = assets.getCachedTexture(keys[stageIdx]);
    if (tex) {
      if (!this.bannerOverlaySprite) {
        this.bannerOverlaySprite = new Sprite(tex);
        this.bannerOverlaySprite.anchor.set(0.5);
        this.bannerOverlaySprite.position.set(VIEW_W * 0.5, VIEW_H * 0.48);
        this.screenOverlay.addChild(this.bannerOverlaySprite);
      } else if (this.bannerOverlaySprite.texture !== tex) {
        this.bannerOverlaySprite.texture = tex;
      }
    }

    if (this.introTimer >= 2.05) {
      this.clearPreviewZombies();
      this.bannerOverlaySprite?.destroy();
      this.bannerOverlaySprite = null;
      this.bannerText = null;
      this.phase = 'playing';
      this.emitHud();
    }
  }

  private updateFog(dt: number): void {
    if (!this.config.scene.fog || this.fogSprites.length === 0) return;
    if (this.fogClearTimer > 0) {
      this.fogClearTimer = Math.max(0, this.fogClearTimer - dt);
    }
    const litCells = new Set<string>();
    for (const p of this.plants) {
      if (p.beh.kind === 'plantern' || p.beh.kind === 'torch') {
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            litCells.add(`${p.row + dr}|${p.col + dc}`);
          }
        }
      }
    }
    for (const sp of this.fogSprites) {
      const meta = sp as unknown as { col: number; row: number };
      const clear = this.fogClearTimer > 0 || litCells.has(`${meta.row}|${meta.col}`);
      const targetA = clear ? 0.06 : 0.84;
      sp.alpha += (targetA - sp.alpha) * Math.min(1, dt * 4);
    }
  }

  private updateIzStall(dt: number): void {
    if (this.phase !== 'playing') return;
    if (this.izBrains.length > 0 && this.izBrains.every((b) => b.eaten)) {
      this.finishBattle(true);
      return;
    }
    const aliveZombies = this.zombies.filter((z) => !z.removed && !z.dying).length;
    const minCost =
      this.izZombieIds.length > 0
        ? Math.min(...this.izZombieIds.map((zid) => Math.max(25, assets.getZombie(zid)?.val || 50)))
        : 50;
    if (aliveZombies === 0 && this.suns.length === 0 && this.sun < minCost) {
      this.izStallTimer += dt;
      if (this.izStallTimer >= 1.8) {
        this.finishBattle(false);
      }
    } else {
      this.izStallTimer = 0;
    }
  }

  private updateWaves(dt: number): void {
    if (this.config.mode === 'sandbox' || this.config.mode === 'iz') {
      return;
    }
    if (this.config.mode === 'vasebreaker' && this.config.vasebreakerConfig) {
      const aliveHostiles = this.zombies.filter((z) => !z.dying && !z.hypnotized && !z.removed).length;
      if (this.vases.length > 0 && this.vases.every((v) => v.broken) && aliveHostiles === 0) {
        this.finishBattle(true);
      }
      return;
    }
    const maxWaves = Math.max(1, this.config.maxWaves);

    // Staggered budget-based zombie spawning (must run even during Final Wave!)
    if (this.waveBudgetRemaining > 0) {
      this.waveSpawnCooldown -= dt;
      if (this.waveSpawnCooldown <= 0) {
        const zId = this.pickZombieForWave(this.waveBudgetRemaining);
        const costVal = Math.max(50, assets.getZombie(zId)?.val ?? 50);
        this.waveBudgetRemaining -= costVal;
        if (this.waveBudgetRemaining < 50) {
          this.waveBudgetRemaining = 0;
        }
        void this.spawnZombieAt(zId);
        this.waveSpawnCooldown = this.currentWaveIsHuge
          ? 0.55 + Math.random() * 0.45
          : 1.2 + Math.random() * 0.9;
      }
    }

    const aliveHostiles = this.zombies.filter((z) => !z.dying && !z.hypnotized && !z.removed).length;

    if (this.currentWave >= maxWaves) {
      if (aliveHostiles === 0 && this.pendingZombieSpawns === 0 && this.waveBudgetRemaining <= 0) {
        if (this.config.endless) {
          this.endlessTotalWavesCleared += this.currentWave;
          saveManager.recordSurvivalRound(this.config.levelKey, this.endlessRound);
          this.endlessRound += 1;
          this.currentWave = 0;
          this.waveBudgetRemaining = 0;
          this.waveSpawnCooldown = 0;
          this.currentWaveIsHuge = false;
          this.phase = 'choosing';
          this.targetCamX = CAM_X_CHOOSER;
          this.selectedCardIndex = -1;
          this.shovelActive = false;
          this.gloveActive = false;
          this.gloveHeldPlant = null;
          void this.spawnPreviewZombies();
          audio.playSfx('Chime', 0.9, 100);
          this.emitHud();
          this.callbacks.onEndlessRoundComplete?.(this.endlessRound, {
            kills: this.kills,
            fusions: this.fusions,
            sun: Math.round(this.sun),
          });
          return;
        }
        this.finishBattle(true);
      }
      return;
    }

    // Early-clear breather when current wave zombies are all defeated
    if (
      this.currentWave > 0 &&
      aliveHostiles === 0 &&
      this.pendingZombieSpawns === 0 &&
      this.waveBudgetRemaining <= 0 &&
      this.waveTimer > 4
    ) {
      this.waveTimer = 4.0;
    }

    this.waveTimer -= dt;
    if (this.waveTimer <= 0) {
      this.currentWave++;
      const isHuge = this.currentWave === maxWaves || (maxWaves >= 10 && this.currentWave % 10 === 0);
      const isFinal = this.currentWave === maxWaves;

      if (this.currentWave === 1) {
        audio.playSfx('Awooga', 0.9, 500);
      }
      if (isFinal) {
        this.finalWaveTimer = 2.8;
        audio.playSfx('FinalWave', 0.95, 500);
      } else if (isHuge) {
        this.hugeWaveTimer = 2.6;
        audio.playSfx('HugeWave', 0.9, 500);
      }

      const diffMult = getDifficultyInfo(this.config.difficulty).countScale;
      const roundScale = this.config.endless ? 1 + (this.endlessRound - 1) * 0.4 : 1;
      const totalWaveNum = (this.endlessRound - 1) * maxWaves + this.currentWave;
      this.currentWaveIsHuge = isHuge;
      const isLv1 = this.config.adventureIndex === 1;

      if (totalWaveNum === 1 && !isHuge) {
        this.waveBudgetRemaining = this.config.difficulty >= 4 ? 75 : 50;
      } else if (totalWaveNum === 2 && !isHuge) {
        this.waveBudgetRemaining = Math.round((isLv1 ? 50 : 75) * diffMult);
      } else {
        const rawBase = isLv1
          ? Math.round((totalWaveNum === 3 ? 100 : 120) * diffMult)
          : Math.round((30 + totalWaveNum * 32 + Math.max(0, totalWaveNum - 5) * 14) * diffMult * roundScale);
        this.waveBudgetRemaining = Math.round(rawBase * (isHuge ? (isLv1 ? 1.85 : 2.1) : 1));
      }

      if (isFinal) {
        this.waveTimer = 32;
      } else if (this.config.nextWaveInterval) {
        this.waveTimer = Math.max(
          12,
          Math.min(35, this.config.nextWaveInterval - Math.max(0, this.config.difficulty - 2) * 1.5),
        );
      } else {
        this.waveTimer = Math.max(16, 25 - Math.max(0, this.config.difficulty - 2) * 2);
      }

      this.waveSpawnCooldown = 0;
      if (isHuge && this.config.allowedZombies.includes(1)) {
        this.waveBudgetRemaining = Math.max(0, this.waveBudgetRemaining - 50);
        this.waveSpawnCooldown = 0.7;
        void this.spawnZombieAt(1);
      }

      // Remaining tombstones summon ambush zombies on huge waves
      if (isHuge && this.graveSprites.size > 0) {
        const ambushPool = [0, 2, 4];
        for (const key of this.graveSprites.keys()) {
          const [rStr, cStr] = key.split('|');
          const gr = Number(rStr);
          const gc = Number(cStr);
          const gx = this.colCenterX(gc);
          const zid = ambushPool[Math.floor(Math.random() * ambushPool.length)];
          void this.spawnZombieAt(zid, gr, gx);
          this.particleSys.emitArmorDrop(gx, this.rowGroundY(gr), 0x64748b);
        }
      }

      // Wave >= 10 Huge Wave spawns a Leader / Boss zombie (non-tower)
      if (isHuge && this.currentWave >= 10 && this.config.mode !== 'tower') {
        const bossCandidates = this.config.allowedZombies.filter((id) => {
          const b = getZombieBehavior(id);
          return b.isLeader || b.isBoss;
        });
        const bossId =
          bossCandidates.length > 0
            ? bossCandidates[Math.floor(Math.random() * bossCandidates.length)]
            : 43;
        void this.spawnZombieAt(bossId);
        audio.playSfx('Siren', 0.85, 400);
      }

      // Official Difficulty 5 (炼狱): >= 4-flag levels spawn final-wave elite reinforcements
      if (isFinal && this.config.difficulty >= 5 && maxWaves >= 40 && this.config.mode !== 'tower') {
        const adv45Cleared = saveManager.current.unlockAll || saveManager.current.advLevel >= 45;
        const reinforceIds = adv45Cleared ? [201, 204, 203] : [43];
        for (const eid of reinforceIds) {
          if (assets.getZombie(eid)) {
            void this.spawnZombieAt(eid);
          }
        }
      }
      this.emitHud();
    }
  }

  private pickZombieForWave(budgetLeft?: number): number {
    const pool = this.config.allowedZombies.length > 0 ? this.config.allowedZombies : [0, 2, 4];
    const totalWaveNum = (this.endlessRound - 1) * Math.max(1, this.config.maxWaves) + this.currentWave;
    const progress = this.currentWave / Math.max(1, this.config.maxWaves);
    const maxTier =
      totalWaveNum <= 1
        ? 1
        : totalWaveNum === 2
          ? 2
          : Math.min(10, Math.max(2, Math.ceil(progress * 10) + (this.config.difficulty >= 4 ? 1 : 0)));

    let eligible = pool.filter((id) => (assets.getZombie(id)?.tier ?? 1) <= maxTier);
    if (eligible.length === 0) {
      const minTier = Math.min(...pool.map((id) => assets.getZombie(id)?.tier ?? 1));
      eligible = pool.filter((id) => (assets.getZombie(id)?.tier ?? 1) === minTier);
    }

    if (budgetLeft !== undefined) {
      const affordable = eligible.filter((id) => Math.max(50, assets.getZombie(id)?.val ?? 50) <= budgetLeft);
      if (affordable.length > 0) {
        eligible = affordable;
      } else {
        let cheapestId = eligible[0];
        let cheapestCost = Infinity;
        for (const id of eligible) {
          const c = Math.max(50, assets.getZombie(id)?.val ?? 50);
          if (c < cheapestCost) {
            cheapestCost = c;
            cheapestId = id;
          }
        }
        return cheapestId;
      }
    }

    return eligible[Math.floor(Math.random() * eligible.length)];
  }

  private emitFadingBeam(x1: number, y1: number, x2: number, y2: number, color: number, width = 7): void {
    const g = new Graphics();
    g.moveTo(x1, y1).lineTo(x2, y2).stroke({ width, color, alpha: 0.92 });
    g.moveTo(x1, y1).lineTo(x2, y2).stroke({ width: width * 0.4, color: 0xffffff, alpha: 0.95 });
    this.fxOverlayLayer.addChild(g);
    this.fadingBeams.push({ gfx: g, life: 0.28, maxLife: 0.28 });
  }

  private updateSnowWarmth(dt: number): void {
    const g = this.warmthOverlay;
    if (!this.config.scene.snow) {
      if (this.warmthOverlayDirty) {
        g.clear();
        this.warmthOverlayDirty = false;
      }
      return;
    }
    g.clear();
    this.warmthOverlayDirty = true;

    const heatSources = this.plants.filter((p) => !p.dead && p.beh.isHeatSource);
    for (const h of heatSources) {
      const cy = this.rowY0 + (h.row + 0.5) * this.cellH;
      const cx = this.colCenterX(h.col);
      g.circle(cx, cy, this.cellW * 1.45).fill({ color: 0xfb923c, alpha: 0.14 });
      g.circle(cx, cy, this.cellW * 0.95).stroke({ width: 1.5, color: 0xfdba74, alpha: 0.32 });
    }

    for (const p of this.plants) {
      if (p.dead) continue;
      if (p.beh.isHeatSource || p.beh.chillDur > 0 || p.beh.freezeDur > 0) {
        p.frost = 0;
        p.frozenTimer = 0;
        continue;
      }
      const warmed = heatSources.some((h) => Math.abs(h.row - p.row) <= 1 && Math.abs(h.col - p.col) <= 1);
      if (warmed) {
        p.frost = Math.max(0, p.frost - 28 * dt);
        if (p.frozenTimer > 0) p.frozenTimer = Math.max(0, p.frozenTimer - dt * 2);
      } else {
        p.frost = Math.min(100, p.frost + 5.5 * dt);
        if (p.frost >= 100 && p.frozenTimer <= 0) {
          p.frozenTimer = 6.0;
          p.frost = 35;
          audio.playSfx('Frozen', 0.45, 200);
        }
      }
      if (p.frozenTimer > 0) {
        g.roundRect(p.x - 24, p.y - 54, 48, 52, 8)
          .fill({ color: 0x38bdf8, alpha: 0.28 })
          .stroke({ width: 2, color: 0xe0f2fe, alpha: 0.78 });
      } else if (p.frost > 25) {
        g.roundRect(p.x - 18, p.y - 6, 36 * (p.frost / 100), 4, 2).fill({ color: 0x7dd3fc, alpha: 0.85 });
      }
    }
  }

  private updatePlants(dt: number): void {
    for (let i = this.plants.length - 1; i >= 0; i--) {
      const p = this.plants[i];
      if (p.dead) continue;

      if (p.frozenTimer > 0) {
        p.frozenTimer = Math.max(0, p.frozenTimer - dt);
      }
      const plantDt = p.frozenTimer > 0 ? 0 : p.frost >= 50 ? dt * 0.55 : dt;

      p.animator?.update(plantDt);
      if (p.flashTimer > 0) {
        p.flashTimer = Math.max(0, p.flashTimer - dt);
      }
      if (p.beh.regenPerSec > 0 && p.hp < p.maxHp) {
        p.hp = Math.min(p.maxHp, p.hp + p.beh.regenPerSec * dt);
      }
      p.rig?.setVisualState({
        flash: p.flashTimer,
        frozen: p.frozenTimer > 0,
        chilled: p.frost >= 50,
        ghostAlpha: p.slotType === 'pumpkin' ? 0.85 : 1,
      });

      // Handle burst shots (Repeater / Gatling)
      if (p.burstLeft > 0) {
        p.burstTimer -= plantDt;
        if (p.burstTimer <= 0) {
          p.burstLeft--;
          p.burstTimer = 0.14;
          this.spawnShotVolley(p, false);
        }
      }

      // Producer logic
      if (p.beh.kind === 'producer' || p.beh.kind === 'shooter_producer') {
        p.prodTimer -= plantDt;
        if (p.prodTimer <= 0) {
          p.prodTimer = p.beh.produceInterval;
          const usedAnim = p.animator?.hasClip('produce') && p.animator.clipHasEvent('produce', 'AnimGive');
          if (usedAnim && p.animator) {
            p.animator.playOverlay('produce', 1);
          } else {
            this.spawnSun(p.x + (Math.random() - 0.5) * 18, p.y - 34, p.y + 8, p.beh.sunAmount, true);
          }
        }
      }

      // Gravebuster devours tombstone then drops +50 sun
      if (p.beh.kind === 'gravebuster') {
        p.armTimer -= plantDt;
        if (p.armTimer <= 0) {
          this.clearGraveAt(p.row, p.col);
          void this.spawnSun(p.x, p.y - 24, p.y + 8, 50, true);
          this.particleSys.emitSunSparkle(p.x, p.y - 24);
          audio.playSfx('Chime', 0.8, 120);
          this.destroyPlantInstance(p);
          continue;
        }
      }

      // Magnet-shroom strips metal armor (bucket/helmet/door) within 3.5 cols
      if (p.beh.kind === 'magnet') {
        p.specialTimer -= plantDt;
        if (p.specialTimer <= 0) {
          const maxRange = 3.5 * this.cellW;
          const tgt = this.zombies.find(
            (z) =>
              !z.removed &&
              !z.dying &&
              !z.hypnotized &&
              Math.hypot(z.x - p.x, z.y - p.y) <= maxRange &&
              ((z.a2Hp > 0 && z.beh.armor2Type === 'door') ||
                (z.a1Hp > 0 && (z.beh.armor1Type === 'bucket' || z.beh.armor1Type === 'metal'))),
          );
          if (tgt) {
            p.specialTimer = 6.5;
            if (tgt.a2Hp > 0 && tgt.beh.armor2Type === 'door') {
              tgt.a2Hp = 0;
              tgt.rig?.setPartGroupVisible('armor2', false);
            } else {
              tgt.a1Hp = 0;
              tgt.rig?.setPartGroupVisible('armor1', false);
            }
            this.emitFadingBeam(p.x, p.y - 34, tgt.x, tgt.y - 38, 0x38bdf8, 4);
            this.particleSys.emitArmorDrop(tgt.x, tgt.y, 0x94a3b8);
            audio.playSfx(['Magnetshroom', 'ShieldHit'], 0.8, 120);
          } else {
            p.specialTimer = 1.0;
          }
        }
      }

      // Ultimate plant signature specials
      if (p.beh.isUltimateSpecial) {
        p.specialTimer -= plantDt;
        if (p.specialTimer <= 0) {
          const kind = p.beh.isUltimateSpecial;
          if (kind === 'star_rain') {
            p.specialTimer = 4.2;
            const hostiles = this.zombies.filter((z) => !z.removed && !z.dying && !z.hypnotized);
            for (let k = 0; k < Math.min(6, hostiles.length); k++) {
              const tgt = hostiles[k];
              const dx = tgt.x - p.x;
              const dy = tgt.y - 38 - (p.y - 44);
              const len = Math.max(1, Math.hypot(dx, dy));
              this.spawnBullet({
                p,
                sx: p.x + (k - 2.5) * 14,
                sy: p.y - 54,
                vx: (dx / len) * 440,
                vy: (dy / len) * 440,
                row: -1,
                lobbed: false,
                homing: true,
              });
            }
          } else if (kind === 'solar_beam') {
            p.specialTimer = 5.5;
            const hasRowEnemy = this.zombies.some((z) => !z.removed && !z.dying && !z.hypnotized && z.row === p.row);
            if (hasRowEnemy) {
              this.emitFadingBeam(p.x + 20, p.y - 38, WORLD_W - 20, p.y - 38, 0xfde047, 12);
              for (const z of this.zombies) {
                if (!z.removed && !z.dying && !z.hypnotized && z.row === p.row && z.x >= p.x - 10) {
                  this.damageZombie(z, this.computePlantDamage(180, z.x, z.y), { ignoreShield: true });
                }
              }
              void this.spawnSun(p.x, p.y - 34, p.y + 8, 50, true);
            } else {
              p.specialTimer = 1.5;
            }
          } else if (kind === 'hypno_pulse') {
            p.specialTimer = 6.0;
            const tgt = this.zombies.find(
              (z) =>
                !z.removed &&
                !z.dying &&
                !z.hypnotized &&
                !z.beh.isBoss &&
                !z.beh.isLeader &&
                Math.hypot(z.x - p.x, z.y - p.y) <= this.cellW * 2.6,
            );
            if (tgt) {
              this.emitFadingBeam(p.x, p.y - 32, tgt.x, tgt.y - 36, 0xe879f9, 8);
              this.damageZombie(tgt, 20, { hypno: true });
            } else {
              p.specialTimer = 1.2;
            }
          } else if (kind === 'cherry_god') {
            p.specialTimer = 3.2;
            const near = this.zombies.some(
              (z) => !z.removed && !z.dying && !z.hypnotized && Math.hypot(z.x - p.x, z.y - p.y) <= this.cellW * 1.9,
            );
            if (near) {
              this.particleSys.emitExplosion(p.x, p.y - 26, this.cellW * 1.9, 'fire');
              audio.playSfx('CherryBomb', 0.72, 180);
              for (const z of this.zombies) {
                if (!z.removed && !z.dying && !z.hypnotized && Math.hypot(z.x - p.x, z.y - p.y) <= this.cellW * 1.9) {
                  this.damageZombie(z, this.computePlantDamage(260, z.x, z.y), { ignoreShield: true });
                }
              }
            } else {
              p.specialTimer = 1.0;
            }
          } else if (kind === 'frost_fume') {
            p.specialTimer = 4.5;
            const targets = this.zombies.filter(
              (z) => !z.removed && !z.dying && !z.hypnotized && z.row === p.row && z.x >= p.x - 10,
            );
            if (targets.length > 0) {
              this.emitFadingBeam(p.x + 24, p.y - 32, Math.min(WORLD_W - 20, p.x + 5 * this.cellW), p.y - 32, 0x38bdf8, 18);
              for (const z of targets) {
                this.damageZombie(z, this.computePlantDamage(140, z.x, z.y), {
                  ignoreShield: true,
                  chillDur: 5.0,
                  freezeDur: 1.5,
                });
              }
            } else {
              p.specialTimer = 1.2;
            }
          } else if (kind === 'obsidian_wall') {
            p.specialTimer = 4.0;
            for (const ally of this.plants) {
              if (!ally.dead && Math.abs(ally.row - p.row) <= 1 && Math.abs(ally.col - p.col) <= 1) {
                ally.hp = Math.min(ally.maxHp, ally.hp + 120);
              }
            }
            for (const z of this.zombies) {
              if (!z.removed && !z.dying && !z.hypnotized && Math.hypot(z.x - p.x, z.y - p.y) <= this.cellW * 1.3) {
                this.damageZombie(z, this.computePlantDamage(100, z.x, z.y), { ignoreShield: true });
              }
            }
          } else if (kind === 'laser') {
            p.specialTimer = 2.8;
            const targets = this.zombies.filter(
              (z) => !z.removed && !z.dying && !z.hypnotized && z.row === p.row && z.x >= p.x - 10,
            );
            if (targets.length > 0) {
              this.emitFadingBeam(p.x + 26, p.y - 40, WORLD_W - 20, p.y - 40, 0x22d3ee, 9);
              for (const z of targets) {
                this.damageZombie(z, this.computePlantDamage(300, z.x, z.y), { ignoreShield: true });
              }
            } else {
              p.specialTimer = 0.8;
            }
          }
        }
      }

      // Mine arming & trigger
      if (p.beh.kind === 'mine') {
        if (!p.armed) {
          p.armTimer -= plantDt;
          if (p.armTimer <= 0) {
            p.armed = true;
            this.particleSys.emitSunSparkle(p.x, p.y - 24);
          }
        } else {
          const hit = this.findNearestHostileInRow(p.row, p.x, 42);
          if (hit) {
            this.triggerBombPlant(p, 'cherry');
            continue;
          }
        }
      }

      // Squash leap smash
      if (p.beh.kind === 'squash') {
        const hit = this.findNearestHostileInRow(p.row, p.x, 78);
        if (hit) {
          audio.playSfx(['SquashHmm', 'SquashHmm2'], 0.9, 100);
          p.x = hit.x;
          p.y = hit.y;
          this.triggerBombPlant(p, 'cherry');
          continue;
        }
      }

      // Chomper devour (Boss / Leader immune to instant swallow -> capped at 600 dmg)
      if (p.beh.kind === 'chomper') {
        if (p.chewTimer > 0) {
          p.chewTimer = Math.max(0, p.chewTimer - plantDt);
        } else {
          const hit = this.zombies.find(
            (z) => !z.removed && !z.dying && !z.hypnotized && z.row === p.row && z.x >= p.x - 10 && z.x <= p.x + 88,
          );
          if (hit) {
            audio.playSfx('BigChomp', 0.95, 100);
            if (hit.beh.isBoss || hit.beh.isLeader) {
              this.damageZombie(hit, this.computePlantDamage(600, hit.x, hit.y), { ignoreShield: true });
            } else if (hit.beh.gargantuar || hit.beh.vehicle) {
              this.damageZombie(hit, this.computePlantDamage(400, hit.x, hit.y), { ignoreShield: true });
            } else {
              this.damageZombie(hit, 99999, { ignoreShield: true, trueDamage: true });
            }
            p.chewTimer = 18;
            p.animator?.playOverlay('attack', 1);
          }
        }
      }

      // Spike / Caltrop continuous ground damage
      if (p.beh.kind === 'spike') {
        p.atkTimer -= plantDt;
        if (p.atkTimer <= 0) {
          const atkSpd = this.config.modifiers?.plantAtkSpeedMult ?? 1;
          p.atkTimer = p.beh.attackInterval / Math.max(0.2, atkSpd);
          for (const z of this.zombies) {
            if (!z.removed && !z.dying && !z.hypnotized && !z.beh.flying && z.row === p.row && Math.abs(z.x - p.x) < 42) {
              this.damageZombie(z, this.computePlantDamage(p.beh.damage, z.x, z.y), { ignoreShield: true });
            }
          }
        }
      }

      // Tangle Kelp aquatic pull (Boss / Leader immune -> capped at 600 dmg)
      if (p.beh.kind === 'kelp') {
        const hit = this.findNearestHostileInRow(p.row, p.x, 52);
        if (hit) {
          this.particleSys.emitWaterSplash(hit.x, hit.y);
          audio.playSfx('ZombieSplash', 0.9, 100);
          const isHeavy = hit.beh.isBoss || hit.beh.isLeader;
          const dmg = isHeavy ? this.computePlantDamage(600, hit.x, hit.y) : 99999;
          this.damageZombie(hit, dmg, { ignoreShield: true, trueDamage: !isHeavy });
          this.destroyPlantInstance(p);
          continue;
        }
      }

      // Shooter attack cycle
      if (p.beh.kind === 'shooter' || p.beh.kind === 'shooter_producer') {
        p.atkTimer -= plantDt;
        if (p.atkTimer <= 0 && this.hasShooterTarget(p)) {
          const atkSpd = this.config.modifiers?.plantAtkSpeedMult ?? 1;
          p.atkTimer = p.beh.attackInterval / Math.max(0.2, atkSpd);
          if (p.beh.lanes === 'three' && p.animator?.hasClip('shoot2')) {
            p.animator.playOverlay('shoot1', 1);
            p.animator.playOverlay('shoot2', 1);
            p.animator.playOverlay('shoot3', 1);
            if (!p.animator.clipHasEvent('shoot2', 'AnimShoot')) {
              this.firePlantProjectile(p);
            }
          } else {
            const hasShootClip = p.animator?.hasClip('shoot');
            if (hasShootClip && p.animator) {
              p.animator.playOverlay('shoot', 1);
              if (!p.animator.clipHasEvent('shoot', 'AnimShoot')) {
                this.firePlantProjectile(p);
              }
            } else {
              this.firePlantProjectile(p);
            }
          }
        }
      }
    }
  }

  private hasShooterTarget(p: PlantInstance): boolean {
    const maxDist = p.beh.rangeCols * this.cellW;
    const isTower = this.config.mode === 'tower';
    for (const z of this.zombies) {
      if (z.removed || z.dying || z.hypnotized) continue;
      if (isTower) {
        if (Math.hypot(z.x - p.x, z.y - p.y) <= Math.max(maxDist, this.cellW * 3.8)) return true;
        continue;
      }
      if (p.beh.lanes === 'homing' || p.beh.lanes === 'five') return true;
      if (p.beh.lanes === 'three') {
        if (Math.abs(z.row - p.row) <= 1 && z.x >= p.x - 10 && z.x <= WORLD_W - 20) return true;
      } else if (z.row === p.row && z.x >= p.x - 10 && z.x <= Math.min(WORLD_W - 20, p.x + maxDist)) {
        return true;
      }
    }
    return false;
  }

  private firePlantProjectile(p: PlantInstance): void {
    this.spawnShotVolley(p, true);
    if (p.beh.shotCount > 1) {
      p.burstLeft = p.beh.shotCount - 1;
      p.burstTimer = 0.14;
    }
  }

  private spawnShotVolley(p: PlantInstance, playSound: boolean): void {
    const off = p.rig ? p.rig.getShootOffset() : { dx: 26, dy: -46 };
    const sc = p.rig ? p.container.scale.x : UNITY_ENTITY_SCALE;
    const sx = p.x + off.dx * sc;
    const sy = p.y + off.dy * sc;

    if (playSound) {
      const sfxKey =
        p.beh.lanes === 'pierce_all'
          ? 'Fume'
          : p.beh.lanes === 'pierce_short'
            ? 'Puff'
            : p.beh.lanes === 'lob'
              ? 'Throw'
              : 'Throw2';
      audio.playSfx(sfxKey, 0.52, 70);
    }

    if (this.config.mode === 'tower' && p.beh.lanes !== 'five' && p.beh.lanes !== 'homing') {
      const tgt = this.findNearestHostileAnywhere(p.x, p.y - 34);
      const dx = tgt ? tgt.x - sx : 1;
      const dy = tgt ? (tgt.y - 38) - sy : 0;
      const len = Math.max(1, Math.hypot(dx, dy));
      const spd = 470;
      this.spawnBullet({
        p,
        sx,
        sy,
        vx: (dx / len) * spd,
        vy: (dy / len) * spd,
        row: -1,
        lobbed: false,
      });
      return;
    }

    if (p.beh.lanes === 'three') {
      for (const dr of [-1, 0, 1]) {
        const tr = p.row + dr;
        if (tr >= 0 && tr < this.rows) {
          this.spawnBullet({
            p,
            sx,
            sy: sy + dr * this.cellH * 0.25,
            vx: 430,
            vy: dr * (this.cellH / 0.35),
            row: tr,
            lobbed: false,
          });
        }
      }
      return;
    }

    if (p.beh.lanes === 'five') {
      const angles = [0, Math.PI, -Math.PI * 0.5, -Math.PI * 0.22, Math.PI * 0.22];
      for (const ang of angles) {
        this.spawnBullet({
          p,
          sx: p.x,
          sy: p.y - 36,
          vx: Math.cos(ang) * 410,
          vy: Math.sin(ang) * 410,
          row: -1,
          lobbed: false,
        });
      }
      return;
    }

    if (p.beh.lanes === 'homing') {
      this.spawnBullet({ p, sx, sy, vx: 380, vy: -40, row: p.row, lobbed: false, homing: true });
      return;
    }

    if (p.beh.lanes === 'lob') {
      const target = this.findFurthestOrNearestHostileInRow(p.row, p.x);
      const tx = target ? Math.max(p.x + 60, target.x - 16) : p.x + 360;
      const ty = this.rowGroundY(p.row) - 34;
      const flightT = Math.max(0.45, Math.min(0.95, Math.abs(tx - sx) / 480));
      const g = 880;
      const vx = (tx - sx) / flightT;
      const vy = (ty - sy - 0.5 * g * flightT * flightT) / flightT;
      this.spawnBullet({ p, sx, sy, vx, vy, gravity: g, tx, ty, row: p.row, lobbed: true });
      return;
    }

    if (p.beh.lanes === 'pierce_short' || p.beh.lanes === 'pierce_all') {
      this.spawnBullet({
        p,
        sx,
        sy,
        vx: 470,
        vy: 0,
        row: p.row,
        lobbed: false,
        pierce: p.beh.lanes === 'pierce_all' ? 99 : 1,
        lifeMax: (p.beh.rangeCols * this.cellW) / 470,
      });
      return;
    }

    this.spawnBullet({ p, sx, sy, vx: 440, vy: 0, row: p.row, lobbed: false });
  }

  private spawnBullet(params: {
    p: PlantInstance;
    sx: number;
    sy: number;
    vx: number;
    vy: number;
    row: number;
    lobbed: boolean;
    homing?: boolean;
    gravity?: number;
    tx?: number;
    ty?: number;
    pierce?: number;
    lifeMax?: number;
  }): void {
    const { p } = params;
    let kind = p.beh.bulletKind;
    let butterDur = p.beh.butterDur;
    if (kind === 'kernel' && Math.random() < 0.25) {
      kind = 'butter';
      butterDur = 4.0;
    }
    const url = assets.getBulletTextureUrl(kind);
    const tex =
      assets.getCachedTexture(url) || assets.getCachedTexture(assets.getBulletTextureUrl('pea'));
    const sprite = new Sprite(tex);
    sprite.anchor.set(0.5);
    sprite.position.set(params.sx, params.sy);
    // Keep bullets cleanly sized (~22-34px)
    if (tex && tex.width > 0) {
      const targetDim = kind.includes('melon') ? 34 : kind === 'firepea' || kind === 'doompea' ? 30 : 24;
      const sc = targetDim / Math.max(tex.width, tex.height);
      sprite.scale.set(sc);
    }
    this.projectileLayer.addChild(sprite);

    const b: BulletInstance = {
      x: params.sx,
      y: params.sy,
      vx: params.vx,
      vy: params.vy,
      gravity: params.gravity ?? 0,
      targetX: params.tx ?? params.sx + 400,
      targetY: params.ty ?? params.sy,
      row: params.row,
      kind,
      damage: this.computePlantDamage(
        kind === 'butter' ? Math.max(40, p.beh.damage * 2) : p.beh.damage,
        params.sx,
        params.sy,
      ),
      pierceLeft: params.pierce ?? 1,
      homing: Boolean(params.homing),
      lobbed: params.lobbed,
      ignited: false,
      splashRadius: p.beh.splashRadius,
      splashRatio: p.beh.splashRatio,
      chillDur: p.beh.chillDur,
      freezeDur: p.beh.freezeDur,
      butterDur,
      knockbackPx: p.beh.knockbackPx,
      hypnoOnHit: p.beh.hypnoOnHit,
      hitIds: new Set<number>(),
      sprite,
      life: params.lifeMax ?? 4.5,
    };
    this.bullets.push(b);
  }

  private updateBullets(dt: number): void {
    const rowBuckets: ZombieInstance[][] = Array.from({ length: this.rows }, () => []);
    const allHostiles: ZombieInstance[] = [];
    for (const z of this.zombies) {
      if (z.removed || z.dying || z.hypnotized) continue;
      allHostiles.push(z);
      if (z.row >= 0 && z.row < this.rows) {
        rowBuckets[z.row].push(z);
      }
    }

    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.life -= dt;
      if (b.life <= 0) {
        this.removeBulletAt(i);
        continue;
      }

      if (b.homing) {
        const tgt = this.findNearestHostileAnywhere(b.x, b.y);
        if (tgt) {
          const dx = tgt.x - b.x;
          const dy = (tgt.y - 42) - b.y;
          const len = Math.max(1, Math.hypot(dx, dy));
          b.vx = (dx / len) * 420;
          b.vy = (dy / len) * 420;
        }
      }

      b.vy += b.gravity * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;

      // ThreePeater settles nicely into its target row line
      if (!b.lobbed && b.row >= 0 && b.vy !== 0) {
        const desiredY = this.rowGroundY(b.row) - 44;
        if ((b.vy > 0 && b.y >= desiredY) || (b.vy < 0 && b.y <= desiredY)) {
          b.y = desiredY;
          b.vy = 0;
        }
      }

      b.sprite.position.set(b.x, b.y);
      if (b.kind.includes('star') || b.lobbed) {
        b.sprite.rotation += dt * 7;
      }

      if (b.x < -60 || b.x > WORLD_W + 60 || b.y < -120 || b.y > VIEW_H + 80) {
        this.removeBulletAt(i);
        continue;
      }

      // Torchwood ignites passing peas
      if (!b.ignited && !b.lobbed && (b.kind === 'pea' || b.kind === 'snowpea')) {
        const col = Math.floor((b.x - BOARD_X) / this.cellW);
        if (col >= 0 && col < this.cols && b.row >= 0 && b.row < this.rows) {
          const slot = this.tileGrid[b.row][col];
          const hasTorch = slot.mains.some((m) => m.beh.kind === 'torch');
          if (hasTorch) {
            b.ignited = true;
            if (b.kind === 'snowpea') {
              b.kind = 'pea';
              b.chillDur = 0;
            } else {
              b.kind = 'firepea';
              b.damage *= 2;
              b.splashRadius = 70;
              b.splashRatio = 0.45;
              const fireTex = assets.getCachedTexture(assets.getBulletTextureUrl('firepea'));
              if (fireTex) b.sprite.texture = fireTex;
              audio.playSfx(['FirePea', 'Ignite'], 0.55, 80);
            }
          }
        }
      }

      // Lobbed landing
      if (b.lobbed && b.vy > 0 && b.y >= b.targetY) {
        this.applyBulletImpact(b, null, rowBuckets, allHostiles);
        this.removeBulletAt(i);
        continue;
      }
      if (b.lobbed) {
        continue;
      }

      // Straight/homing collision against zombies (row-bucketed)
      const candidates = b.row >= 0 && b.row < this.rows ? rowBuckets[b.row] : allHostiles;
      let hitTarget: ZombieInstance | null = null;
      for (const z of candidates) {
        if (z.removed || z.dying || b.hitIds.has(z.uid)) continue;
        if (Math.abs(z.x - b.x) < 28 && Math.abs((z.y - 45) - b.y) < 58) {
          hitTarget = z;
          break;
        }
      }
      if (hitTarget) {
        b.hitIds.add(hitTarget.uid);
        this.applyBulletImpact(b, hitTarget, rowBuckets, allHostiles);
        b.pierceLeft--;
        if (b.pierceLeft <= 0) {
          this.removeBulletAt(i);
        }
      }
    }
  }

  private applyBulletImpact(
    b: BulletInstance,
    direct: ZombieInstance | null,
    rowBuckets: ZombieInstance[][],
    allHostiles: ZombieInstance[],
  ): void {
    const ignoreShield = b.lobbed || b.pierceLeft > 1 || b.kind === 'puff' || b.kind === 'fume';
    const directCandidates = b.row >= 0 && b.row < this.rows ? rowBuckets[b.row] : allHostiles;
    const targetList = direct
      ? [direct]
      : directCandidates.filter(
          (z) =>
            !z.removed &&
            !z.dying &&
            (b.row < 0
              ? Math.hypot(z.x - b.x, z.y - 36 - b.y) < 44
              : Math.abs(z.x - b.x) < 42),
        );

    for (const tgt of targetList) {
      this.damageZombie(tgt, b.damage, {
        ignoreShield,
        chillDur: b.chillDur,
        freezeDur: b.freezeDur,
        butterDur: b.butterDur,
        knockbackPx: b.knockbackPx,
        hypno: b.hypnoOnHit,
      });
    }

    if (b.splashRadius > 0) {
      const spDmg = Math.max(10, Math.round(b.damage * b.splashRatio));
      for (const z of allHostiles) {
        if (z === direct || z.removed || z.dying) continue;
        if (Math.hypot(z.x - b.x, z.y - b.y) <= b.splashRadius) {
          this.damageZombie(z, spDmg, { chillDur: b.chillDur });
        }
      }
    }

    const splatColor =
      b.kind === 'snowpea' || b.kind === 'wintermelon'
        ? 0x7dd3fc
        : b.kind === 'firepea' || b.kind === 'cherrypea'
          ? 0xfb923c
          : b.kind === 'doompea' || b.kind === 'hypnopea'
            ? 0xc084fc
            : 0x86efac;
    this.particleSys.emitSplat(b.x, b.y, splatColor, 5);
    audio.playSfx(['Splat', 'Splat2', 'Splat3'], 0.42, 65);
  }

  private removeBulletAt(idx: number): void {
    const b = this.bullets[idx];
    b.sprite.destroy();
    b.shadow?.destroy();
    this.bullets.splice(idx, 1);
  }

  private damageZombie(
    z: ZombieInstance,
    amount: number,
    opts?: {
      ignoreShield?: boolean;
      trueDamage?: boolean;
      chillDur?: number;
      freezeDur?: number;
      butterDur?: number;
      knockbackPx?: number;
      hypno?: boolean;
    },
  ): void {
    if (z.removed || z.dying) return;
    z.flashTimer = 0.08;
    if (opts?.chillDur) z.chillTimer = Math.max(z.chillTimer, opts.chillDur);
    if (opts?.freezeDur) z.freezeTimer = Math.max(z.freezeTimer, opts.freezeDur);
    if (opts?.butterDur) z.butterTimer = Math.max(z.butterTimer, opts.butterDur);
    if (opts?.knockbackPx) z.x = Math.min(WORLD_W - 20, z.x + opts.knockbackPx);
    if (opts?.hypno && !z.beh.gargantuar && !z.beh.vehicle && !z.beh.isBoss && !z.beh.isLeader && !z.hypnotized) {
      z.hypnotized = true;
      z.container.scale.x = -Math.abs(z.container.scale.x);
      audio.playSfx('MindControlled', 0.85, 100);
      return;
    }

    let rem = amount;
    const dr = getDifficultyInfo(this.config.difficulty).damageReduction;
    if (dr > 0 && this.config.mode !== 'iz' && !z.hypnotized && !opts?.trueDamage) {
      rem = Math.max(1, rem * (1 - dr));
    }
    if (!opts?.ignoreShield && z.a2Hp > 0) {
      const absorbed = Math.min(z.a2Hp, rem);
      z.a2Hp -= absorbed;
      rem -= absorbed;
      if (z.a2Hp <= 0) {
        z.rig?.setPartGroupVisible('armor2', false);
        this.particleSys.emitArmorDrop(z.x, z.y, z.beh.armor2Type === 'paper' ? 0xf1f5f9 : 0x64748b);
        audio.playSfx(z.beh.armor2Type === 'paper' ? 'NewspaperRip' : 'ShieldHit', 0.75, 100);
        if (z.beh.enrageOnArmor2Break) {
          z.enraged = true;
          audio.playSfx(['NewspaperRargh', 'NewspaperRargh2'], 0.85, 200);
          if (z.animator?.hasClip('losepaper')) {
            z.animator.playBaseOneShot('losepaper', z.animator.hasClip('walk2') ? 'walk2' : 'walk');
          }
        }
      }
    }

    if (rem > 0 && z.a1Hp > 0) {
      const absorbed = Math.min(z.a1Hp, rem);
      z.a1Hp -= absorbed;
      rem -= absorbed;
      if (z.a1Hp <= 0) {
        z.rig?.setPartGroupVisible('armor1', false);
        this.particleSys.emitArmorDrop(z.x, z.y, z.beh.armor1Type === 'cone' ? 0xf97316 : 0x94a3b8);
        audio.playSfx(z.beh.armor1Type === 'cone' ? 'PlasticHit' : 'ShieldHit2', 0.7, 100);
      }
    }

    if (rem > 0) {
      this.applyLifesteal(rem);
      z.hp -= rem;
      if (z.hp <= z.maxHp * 0.35 && !z.headDropped) {
        z.headDropped = true;
        z.rig?.setPartGroupVisible('head', false);
        this.particleSys.emitArmorDrop(z.x, z.y, 0x84a98c);
      }
      if (z.hp <= 0) {
        this.killZombie(z);
      }
    }
  }

  private killZombie(z: ZombieInstance): void {
    if (z.dying || z.removed) return;
    if (this.gloveHeldZombie === z) {
      this.gloveHeldZombie = null;
    }
    z.dying = true;
    z.hpBar.visible = false;
    this.kills++;
    z.animator?.clearOverlay(true);
    if (z.animator?.hasClip('die')) {
      z.animator.playBase('die', false, 0, true);
      z.dieTimer = Math.max(0.45, z.animator.baseClip?.dur ?? 1.25);
    } else {
      z.dieTimer = 0.25;
    }
  }

  private updateZombies(dt: number): void {
    for (let i = this.zombies.length - 1; i >= 0; i--) {
      const z = this.zombies[i];
      if (z.removed) {
        this.zombies.splice(i, 1);
        continue;
      }

      if (z.flashTimer > 0) z.flashTimer = Math.max(0, z.flashTimer - dt);
      if (z.chillTimer > 0) z.chillTimer = Math.max(0, z.chillTimer - dt);
      if (z.freezeTimer > 0) z.freezeTimer = Math.max(0, z.freezeTimer - dt);
      if (z.butterTimer > 0) z.butterTimer = Math.max(0, z.butterTimer - dt);

      const frozen = z.freezeTimer > 0 || z.butterTimer > 0;
      const speedScale = frozen ? 0 : z.chillTimer > 0 ? 0.5 : 1;
      if (z.animator) {
        z.animator.baseSpeed = speedScale * (z.enraged ? 1.8 : 1);
        z.animator.update(dt);
      }

      z.rig?.setVisualState({
        flash: z.flashTimer,
        frozen: z.freezeTimer > 0,
        chilled: z.chillTimer > 0,
        hypno: z.hypnotized,
      });

      if (z.dying) {
        z.dieTimer -= dt;
        if (z.dieTimer <= 0.3) {
          z.container.alpha = Math.max(0, z.dieTimer / 0.3);
        }
        if (z.dieTimer <= 0) {
          z.removed = true;
          z.rig?.destroy();
          z.container.destroy({ children: true });
          this.zombies.splice(i, 1);
        }
        continue;
      }

      // Draw crisp small HP bar above damaged zombies
      this.redrawZombieHpBar(z);

      // Jack-in-the-box explosion timer
      if (z.jackTimer > 0 && !z.hypnotized) {
        z.jackTimer -= dt;
        if (z.jackTimer <= 0) {
          this.particleSys.emitExplosion(z.x, z.y - 30, 145, 'fire');
          audio.playSfx('Explosion', 0.9, 100);
          for (const p of [...this.plants]) {
            if (Math.hypot(p.x - z.x, p.y - z.y) <= 145) {
              this.destroyPlantInstance(p);
            }
          }
          this.killZombie(z);
          continue;
        }
      }

      if (frozen) continue;

      if (z.hypnotized) {
        // Hypnotized zombie marches right and fights hostile zombies in row
        const enemy = this.zombies.find(
          (o) => !o.removed && !o.dying && !o.hypnotized && o.row === z.row && Math.abs(o.x - z.x) < 42,
        );
        if (enemy) {
          z.animator?.playBase('attack', true);
          z.biteTimer -= dt;
          if (z.biteTimer <= 0) {
            z.biteTimer = 0.4;
            this.damageZombie(enemy, 35, { ignoreShield: true });
            this.damageZombie(z, 25, { ignoreShield: true });
          }
        } else {
          z.animator?.playBase('walk', true);
          z.x += z.beh.speedPxPerSec * this.config.zombieSpeedMult * speedScale * dt;
          z.container.position.set(z.x, z.y);
          if (z.x > WORLD_W + 40) {
            z.removed = true;
            z.rig?.destroy();
            z.container.destroy({ children: true });
            this.zombies.splice(i, 1);
          }
        }
        continue;
      }

      // Check plant blockage in same row (flying zombies skip non-tall ground plants!)
      const targetPlant = this.findBiteTargetPlant(z);
      if (targetPlant) {
        if (z.beh.canVault && !z.hasVaulted && !targetPlant.beh.tallBlock) {
          z.hasVaulted = true;
          z.x = targetPlant.x - 56;
          z.container.position.set(z.x, z.y);
          audio.playSfx('PoleVault', 0.8, 120);
          continue;
        }
        if (z.beh.vehicle) {
          // Vehicle crushes standard plants instantly unless Caltrop/Bamboo/TallNut
          if (targetPlant.beh.kind === 'spike') {
            this.killZombie(z);
            this.destroyPlantInstance(targetPlant);
          } else {
            this.destroyPlantInstance(targetPlant);
          }
          continue;
        }

        const atkClip =
          z.enraged && z.animator?.hasClip('attack2')
            ? 'attack2'
            : z.headDropped && z.animator?.hasClip('attack_lose')
              ? 'attack_lose'
              : 'attack';
        z.animator?.playBase(atkClip, true);

        const biteAmt = z.beh.biteDps * dt;
        targetPlant.hp -= biteAmt;
        targetPlant.flashTimer = 0.08;

        if (targetPlant.beh.kind === 'hypno') {
          z.hypnotized = true;
          z.container.scale.x = -Math.abs(z.container.scale.x);
          audio.playSfx('MindControlled', 0.9, 100);
          this.destroyPlantInstance(targetPlant);
          continue;
        }
        if (targetPlant.beh.kind === 'garlic') {
          const newRow = z.row === 0 ? 1 : z.row === this.rows - 1 ? this.rows - 2 : z.row + (Math.random() > 0.5 ? 1 : -1);
          z.row = newRow;
          z.y = this.rowGroundY(newRow);
          z.container.position.set(z.x, z.y);
          z.container.zIndex = z.y + 2;
          audio.playSfx(['Yuck', 'Yuck2'], 0.75, 150);
        }
        if (targetPlant.beh.thornsDamage > 0) {
          z.biteTimer -= dt;
          if (z.biteTimer <= 0) {
            z.biteTimer = 0.5;
            this.damageZombie(z, targetPlant.beh.thornsDamage * 0.5, { ignoreShield: true });
          }
        }
        if (targetPlant.beh.sunOnHit) {
          z.biteTimer -= dt;
          if (z.biteTimer <= 0) {
            z.biteTimer = 0.8;
            this.spawnSun(targetPlant.x, targetPlant.y - 30, targetPlant.y + 6, 15, true);
          }
        }
        if (targetPlant.hp <= 0) {
          this.destroyPlantInstance(targetPlant);
        }
      } else if (this.config.mode === 'iz' && z.x <= BOARD_X - 6) {
        const brain = this.izBrains[z.row];
        if (brain && !brain.eaten) {
          const eatClip = z.animator?.hasClip('attack') ? 'attack' : 'eat';
          z.animator?.playBase(eatClip, true);
          brain.hp -= 140 * dt;
          if (brain.hp <= 0) {
            brain.eaten = true;
            brain.sprite.visible = false;
            audio.playSfx('Chomp', 0.9, 80);
            this.particleSys.emitFusionBurst(brain.sprite.x, brain.sprite.y);
            z.removed = true;
            z.rig?.destroy();
            z.container.destroy({ children: true });
            if (this.izBrains.every((b) => b.eaten)) {
              this.finishBattle(true);
              return;
            }
          }
        } else {
          z.removed = true;
          z.rig?.destroy();
          z.container.destroy({ children: true });
        }
      } else if (this.config.mode === 'tower' && this.config.towerConfig && z.wpIdx !== undefined) {
        const wps = this.config.towerConfig.waypoints;
        const tgt = wps[z.wpIdx];
        const walkClip =
          z.beh.flying && z.animator?.hasClip('fly')
            ? 'fly'
            : z.enraged && z.animator?.hasClip('walk2')
              ? 'walk2'
              : z.headDropped && z.animator?.hasClip('losewalk')
                ? 'losewalk'
                : 'walk';
        z.animator?.playBase(walkClip, true);
        const zSpdMult = this.config.modifiers?.zombieSpeedBonusMult ?? 1;
        const diffSpdMult = getDifficultyInfo(this.config.difficulty).speedMult;
        const spd =
          z.beh.speedPxPerSec * this.config.zombieSpeedMult * zSpdMult * diffSpdMult * speedScale * (z.enraged ? 2.2 : 1);
        if (tgt) {
          const tx = this.colCenterX(tgt.col);
          const ty = this.rowGroundY(tgt.row);
          const dx = tx - z.x;
          const dy = ty - z.y;
          const dist = Math.hypot(dx, dy);
          const step = Math.max(16, spd * 1.35) * dt;
          if (dist <= step) {
            z.x = tx;
            z.y = ty;
            z.row = tgt.row;
            z.wpIdx++;
          } else {
            z.x += (dx / dist) * step;
            z.y += (dy / dist) * step;
            z.row = Math.max(0, Math.min(this.rows - 1, Math.floor((z.y - this.rowY0) / this.cellH)));
          }
          if (dx !== 0) {
            z.container.scale.x = dx > 0 ? -Math.abs(z.container.scale.x) : Math.abs(z.container.scale.x);
          }
          z.container.position.set(z.x, z.y);
          z.container.zIndex = z.y + 2;
        }
        if (!tgt || z.wpIdx >= wps.length) {
          this.towerLivesLeft = Math.max(0, this.towerLivesLeft - (z.beh.isBoss || z.beh.isLeader ? 3 : 1));
          audio.playSfx('Buzzer', 0.85, 80);
          z.removed = true;
          z.rig?.destroy();
          z.container.destroy({ children: true });
          this.zombies.splice(i, 1);
          this.emitHud();
          if (this.towerLivesLeft <= 0) {
            this.finishBattle(false);
            return;
          }
        }
      } else {
        const isWater = this.config.scene.waterRows.includes(z.row);
        const walkClip =
          z.beh.flying && z.animator?.hasClip('fly')
            ? 'fly'
            : z.enraged && z.animator?.hasClip('walk2')
              ? 'walk2'
              : isWater && z.animator?.hasClip('swim')
                ? 'swim'
                : z.headDropped && z.animator?.hasClip('losewalk')
                  ? 'losewalk'
                  : 'walk';
        z.animator?.playBase(walkClip, true);
        const zSpdMult = this.config.modifiers?.zombieSpeedBonusMult ?? 1;
        const diffSpdMult = this.config.mode === 'iz' ? 1 : getDifficultyInfo(this.config.difficulty).speedMult;
        const spd =
          z.beh.speedPxPerSec * this.config.zombieSpeedMult * zSpdMult * diffSpdMult * speedScale * (z.enraged ? 2.2 : 1);
        z.x -= spd * dt;
        z.container.position.set(z.x, z.y);

        // Trigger row mower or lose house (non-IZ)
        if (this.config.mode !== 'iz' && z.x <= BOARD_X - 18) {
          const mower = this.mowers[z.row];
          if (mower && mower.active && !mower.triggered && !mower.removed) {
            mower.triggered = true;
            if (mower.kind === 'lawn') {
              if (!mower.animator && mower.rig) {
                mower.animator = new UnityAnimator(mower.rig, 'move');
              } else {
                const clip = mower.animator?.hasClip('move') ? 'move' : 'walk';
                mower.animator?.playBase(clip, true);
              }
            } else {
              mower.animator?.playBase('move_land', true);
            }
            audio.playSfx(mower.isWater ? 'PoolCleaner' : 'LawnMower', 0.95, 100);
          } else if (z.x <= BOARD_X - 75) {
            this.finishBattle(false);
            return;
          }
        }
      }
    }
  }

  private findBiteTargetPlant(z: ZombieInstance): PlantInstance | null {
    if (this.config.mode === 'tower') return null;
    const col = Math.floor((z.x - BOARD_X) / this.cellW);
    if (col < 0 || col >= this.cols) return null;
    const slot = this.tileGrid[z.row]?.[col];
    if (!slot) return null;
    if (z.beh.flying) {
      if (slot.fly) return slot.fly;
      for (const m of slot.mains) {
        if (m.beh.tallBlock) return m;
      }
      return null;
    }
    if (slot.pumpkin) return slot.pumpkin;
    if (slot.mains.length > 0) {
      const m = slot.mains[slot.mains.length - 1];
      if (m.beh.kind !== 'spike') return m;
    }
    return null;
  }

  private redrawZombieHpBar(z: ZombieInstance): void {
    const curTotal = Math.max(0, z.hp) + Math.max(0, z.a1Hp) + Math.max(0, z.a2Hp);
    const maxTotal = z.maxHp + z.a1Max + z.a2Max;
    const key = curTotal >= maxTotal || maxTotal <= 0 ? -2 : Math.round(curTotal);
    if (key === z.lastHpBarKey) {
      return;
    }
    z.lastHpBarKey = key;
    const g = z.hpBar;
    g.clear();
    if (key === -2) {
      return;
    }
    const ratio = Math.max(0, Math.min(1, curTotal / maxTotal));
    const w = 36;
    g.rect(-w / 2, 0, w, 5).fill({ color: 0x0f172a, alpha: 0.78 });
    const barColor = ratio > 0.5 ? 0x22c55e : ratio > 0.25 ? 0xfacc15 : 0xef4444;
    g.rect(-w / 2 + 1, 1, (w - 2) * ratio, 3).fill(barColor);
  }

  private updateMowers(dt: number): void {
    for (const m of this.mowers) {
      if (m.removed) continue;
      if (m.kind !== 'lawn' || m.triggered) {
        m.animator?.update(dt);
      }
      if (!m.triggered) continue;

      m.x += 460 * dt;
      m.container.position.set(m.x, m.y);
      if (m.kind === 'pool' && !m.inWater && m.x >= BOARD_X + 8) {
        m.inWater = true;
        m.animator?.playBase('move_water', true);
      }
      for (const z of this.zombies) {
        if (!z.removed && !z.dying && !z.hypnotized && z.row === m.row && Math.abs(z.x - m.x) < 55) {
          this.killZombie(z);
        }
      }
      if (m.x > WORLD_W + 60) {
        m.removed = true;
        m.rig?.destroy();
        m.container.destroy({ children: true });
      }
    }
  }

  private triggerBombPlant(inst: PlantInstance, theme: 'cherry' | 'doom'): void {
    const r = inst.beh.explodeRadius;
    const dmg = this.computePlantDamage(inst.beh.explodeDamage, inst.x, inst.y);
    this.particleSys.emitExplosion(inst.x, inst.y - 26, r, theme);
    audio.playSfx(theme === 'doom' ? 'DoomShroom' : 'CherryBomb', 0.95, 80);

    for (const z of this.zombies) {
      if (!z.removed && !z.dying && !z.hypnotized && Math.hypot(z.x - inst.x, z.y - inst.y) <= r) {
        this.damageZombie(z, dmg, {
          ignoreShield: true,
          chillDur: inst.beh.chillDur,
          freezeDur: inst.beh.freezeDur,
        });
      }
    }
    if (theme === 'doom') {
      const slot = this.tileGrid[inst.row]?.[inst.col];
      if (slot) slot.craterTimer = 60;
    }
    this.destroyPlantInstance(inst);
  }

  private triggerRowJalapeno(inst: PlantInstance): void {
    const dmg = this.computePlantDamage(inst.beh.explodeDamage, inst.x, inst.y);
    audio.playSfx('Jalapeno', 0.95, 80);
    for (let cx = BOARD_X + 35; cx <= WORLD_W - 60; cx += 65) {
      this.particleSys.emitExplosion(cx, inst.y - 24, 95, 'fire');
    }
    for (const z of this.zombies) {
      if (!z.removed && !z.dying && !z.hypnotized && z.row === inst.row) {
        z.chillTimer = 0;
        z.freezeTimer = 0;
        this.damageZombie(z, dmg, { ignoreShield: true });
      }
    }
    this.destroyPlantInstance(inst);
  }

  private triggerIceShroom(inst: PlantInstance): void {
    const dmg = this.computePlantDamage(inst.beh.explodeDamage, inst.x, inst.y);
    audio.playSfx('Frozen', 0.95, 80);
    this.particleSys.emitExplosion(inst.x, inst.y - 26, 260, 'ice');
    for (const z of this.zombies) {
      if (!z.removed && !z.dying && !z.hypnotized) {
        this.damageZombie(z, dmg, {
          ignoreShield: true,
          freezeDur: inst.beh.freezeDur || 4.5,
          chillDur: inst.beh.chillDur || 12,
        });
      }
    }
    this.destroyPlantInstance(inst);
  }

  private triggerBlover(inst: PlantInstance): void {
    audio.playSfx('Blover', 0.95, 80);
    this.fogClearTimer = 22;
    for (const z of this.zombies) {
      if (!z.removed && !z.dying && !z.hypnotized && z.beh.flying) {
        this.killZombie(z);
      }
    }
    this.destroyPlantInstance(inst);
  }

  private async spawnSun(
    x: number,
    y: number,
    targetY: number,
    value: number,
    arcPop: boolean,
  ): Promise<void> {
    const key = value >= 50 ? 'bigsun' : value >= 35 ? 'bluesun' : 'sun';
    const rigData = await assets.loadCommonRig(key);
    if (this.destroyed) return;

    const container = new Container();
    container.position.set(x, y);
    this.collectibleLayer.addChild(container);

    let rig: UnityRigInstance | null = null;
    let animator: UnityAnimator | null = null;
    if (rigData) {
      rig = new UnityRigInstance(rigData);
      container.addChild(rig.container);
      animator = new UnityAnimator(rig, 'solar');
      const sunScale = value >= 50 ? 0.8 : value !== 25 ? 0.56 : 0.68;
      container.scale.set(sunScale);
    } else {
      const tex = assets.getCachedTexture(`assets/bullets/${key}.webp`);
      if (tex) {
        const sp = new Sprite(tex);
        sp.anchor.set(0.5);
        container.addChild(sp);
      }
      container.scale.set(0.68);
    }

    this.suns.push({
      uid: this.nextUid++,
      x,
      y,
      vx: arcPop ? (Math.random() - 0.5) * 44 : 0,
      vy: arcPop ? -135 : 52,
      targetY,
      value,
      life: 10,
      collecting: false,
      collectT: 0,
      startX: x,
      startY: y,
      container,
      rig,
      animator,
    });
  }

  private collectSun(s: SunInstance): void {
    if (s.collecting) return;
    s.collecting = true;
    s.collectT = 0;
    s.startX = s.x;
    s.startY = s.y;
    audio.playSfx('Points', 0.72, 45);
  }

  private updateSuns(dt: number): void {
    for (let i = this.suns.length - 1; i >= 0; i--) {
      const s = this.suns[i];
      s.animator?.update(dt);

      if (this.autoCollect && !s.collecting && s.life < 9.35) {
        this.collectSun(s);
      }

      if (s.collecting) {
        s.collectT += dt * 2.4;
        const t = Math.min(1, s.collectT);
        const ease = 1 - Math.pow(1 - t, 3);
        const goalX = this.camX + 52;
        const goalY = 34;
        s.x = s.startX + (goalX - s.startX) * ease;
        s.y = s.startY + (goalY - s.startY) * ease;
        s.container.position.set(s.x, s.y);
        s.container.scale.set(0.68 * (1 - ease * 0.45));
        if (t >= 1) {
          const sunMult = this.config.modifiers?.sunGainMult ?? 1;
          const gained = Math.max(5, Math.round(s.value * sunMult));
          this.sun = Math.min(9990, this.sun + gained);
          this.particleSys.emitSunSparkle(goalX, goalY);
          s.rig?.destroy();
          s.container.destroy({ children: true });
          this.suns.splice(i, 1);
          this.emitHud();
        }
        continue;
      }

      if (s.vx !== 0) {
        s.vy += 380 * dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        if (s.y >= s.targetY && s.vy > 0) {
          s.y = s.targetY;
          s.vx = 0;
          s.vy = 0;
        }
      } else if (s.y < s.targetY) {
        s.y = Math.min(s.targetY, s.y + s.vy * dt);
      }

      s.container.position.set(s.x, s.y);
      s.life -= dt;
      if (s.life <= 1.2) {
        s.container.alpha = Math.max(0, s.life / 1.2);
      }
      if (s.life <= 0) {
        s.rig?.destroy();
        s.container.destroy({ children: true });
        this.suns.splice(i, 1);
      }
    }
  }

  private updateHoverDecal(rawDt: number): void {
    const g = this.hoverGraphics;
    g.clear();
    this.fusionPreviewLabel.visible = false;

    if (this.phase !== 'playing' || !this.hoverTile) return;
    const { row, col } = this.hoverTile;
    const x0 = BOARD_X + col * this.cellW;
    const y0 = this.rowY0 + row * this.cellH;
    const cx = x0 + this.cellW / 2;
    const pulse = 0.65 + 0.35 * Math.sin(performance.now() * 0.008);

    if (this.config.mode === 'iz' && this.config.izConfig) {
      if (this.selectedCardIndex >= 0) {
        const zid = this.izZombieIds[this.selectedCardIndex];
        const zDef = assets.getZombie(zid);
        const allowed = col >= this.config.izConfig.redlineColumn;
        g.rect(x0 + 2, y0 + 2, this.cellW - 4, this.cellH - 4)
          .fill({ color: allowed ? 0x4ade80 : 0xef4444, alpha: allowed ? 0.22 : 0.2 })
          .stroke({ width: 2.5, color: allowed ? 0x86efac : 0xf87171, alpha: 0.9 });
        this.fusionPreviewLabel.text = allowed
          ? `🧟 投放: ${zDef?.name ?? ''}`
          : '需在红线右侧投放';
        this.fusionPreviewLabel.position.set(cx, y0 - 4);
        this.fusionPreviewLabel.visible = true;
      }
      return;
    }

    if (this.shovelActive) {
      g.rect(x0 + 2, y0 + 2, this.cellW - 4, this.cellH - 4)
        .fill({ color: 0xef4444, alpha: 0.16 })
        .stroke({ width: 2.5, color: 0xf87171, alpha: 0.85 });
      return;
    }

    if (this.hammerActive) {
      g.circle(cx, y0 + this.cellH / 2, this.cellW * 1.15)
        .fill({ color: 0xf97316, alpha: 0.14 * pulse })
        .stroke({ width: 2.5, color: 0xfb923c, alpha: 0.9 });
      this.fusionPreviewLabel.text = '点击重锤范围';
      this.fusionPreviewLabel.position.set(cx, y0 - 4);
      this.fusionPreviewLabel.visible = true;
      return;
    }

    if (this.wheelbarrowActive && !this.wheelbarrowStored) {
      const slot = this.tileGrid[row]?.[col];
      const cand = slot ? this.getTopPlantCandidate(slot) : null;
      const blocked = Boolean(cand && (cand.plantId === 1151 || cand.plantId === 310));
      const color = blocked ? 0xef4444 : 0x10b981;
      const strokeColor = blocked ? 0xf87171 : 0x34d399;
      g.rect(x0 + 2, y0 + 2, this.cellW - 4, this.cellH - 4)
        .fill({ color, alpha: cand ? 0.22 * pulse : 0.08 })
        .stroke({ width: 2.5, color: strokeColor, alpha: 0.9 });
      this.fusionPreviewLabel.text = blocked
        ? '不可收纳机械坚果'
        : cand
          ? `收纳：${cand.def.name}`
          : '点击有植物的格子收纳';
      this.fusionPreviewLabel.position.set(cx, y0 - 4);
      this.fusionPreviewLabel.visible = true;
      return;
    }

    if (this.fertilizerActive) {
      g.rect(x0 + 2, y0 + 2, this.cellW - 4, this.cellH - 4)
        .fill({ color: 0xa3e635, alpha: 0.22 * pulse })
        .stroke({ width: 2.5, color: 0xd9f99d, alpha: 0.95 });
      this.fusionPreviewLabel.text = '点击施肥回血并结束蓄力';
      this.fusionPreviewLabel.position.set(cx, y0 - 4);
      this.fusionPreviewLabel.visible = true;
      return;
    }

    if (this.gloveActive && this.gloveHeldZombie) {
      g.rect(x0 + 2, y0 + 2, this.cellW - 4, this.cellH - 4)
        .fill({ color: 0xa855f7, alpha: 0.18 * pulse })
        .stroke({ width: 2.5, color: 0xd8b4fe, alpha: 0.9 });
      this.fusionPreviewLabel.text = `移动僵尸 → 第${row + 1}行`;
      this.fusionPreviewLabel.position.set(cx, y0 - 4);
      this.fusionPreviewLabel.visible = true;
      return;
    }

    const activeId =
      (this.wheelbarrowActive ? this.wheelbarrowStored?.plantId ?? null : null) ??
      this.gloveHeldPlant?.plantId ??
      (this.selectedCardIndex >= 0
        ? this.config.conveyorMode
          ? this.conveyorCards[this.selectedCardIndex]?.plantId ?? null
          : this.deckSlots[this.selectedCardIndex]?.plantId ?? null
        : null);

    if (activeId === null) {
      const hoverVase = this.config.vasebreakerConfig ? this.getUnbrokenVaseAt(row, col) : undefined;
      if (hoverVase) {
        g.rect(x0 + 2, y0 + 2, this.cellW - 4, this.cellH - 4)
          .fill({ color: 0xf59e0b, alpha: 0.22 * pulse })
          .stroke({ width: 2.5, color: 0xfde047, alpha: 0.95 });
        this.fusionPreviewLabel.text = '🏺 点击砸罐';
        this.fusionPreviewLabel.position.set(cx, y0 - 4);
        this.fusionPreviewLabel.visible = true;
        return;
      }
      if (this.gloveActive && !this.gloveHeldPlant) {
        g.rect(x0 + 2, y0 + 2, this.cellW - 4, this.cellH - 4).stroke({
          width: 2,
          color: this.gloveMode === 'zombie' ? 0xc084fc : 0x38bdf8,
          alpha: 0.75,
        });
      }
      return;
    }

    const preview = this.previewTileAction(activeId, row, col);
    if (!preview) {
      g.rect(x0 + 2, y0 + 2, this.cellW - 4, this.cellH - 4).fill({ color: 0xef4444, alpha: 0.14 });
      return;
    }

    if (preview.mode === 'fuse') {
      const targetDef = assets.getPlant(preview.resultId);
      g.rect(x0 + 2, y0 + 2, this.cellW - 4, this.cellH - 4)
        .fill({ color: 0xfacc15, alpha: 0.24 * pulse })
        .stroke({ width: 3, color: 0xfde047, alpha: 0.95 });
      this.fusionPreviewLabel.text = `⚡ 融合 → ${targetDef?.name ?? ''}`;
      this.fusionPreviewLabel.position.set(cx, y0 - 4);
      this.fusionPreviewLabel.visible = true;
    } else {
      g.rect(x0 + 2, y0 + 2, this.cellW - 4, this.cellH - 4)
        .fill({ color: 0x4ade80, alpha: 0.14 + rawDt * 0 })
        .stroke({ width: 2, color: 0x86efac, alpha: 0.8 });
    }
  }

  private findNearestHostileInRow(row: number, x: number, maxDist: number): ZombieInstance | null {
    let best: ZombieInstance | null = null;
    let bestD = maxDist;
    for (const z of this.zombies) {
      if (z.removed || z.dying || z.hypnotized || z.row !== row) continue;
      const d = Math.abs(z.x - x);
      if (d <= bestD) {
        bestD = d;
        best = z;
      }
    }
    return best;
  }

  private findFurthestOrNearestHostileInRow(row: number, x: number): ZombieInstance | null {
    let best: ZombieInstance | null = null;
    for (const z of this.zombies) {
      if (z.removed || z.dying || z.hypnotized || z.row !== row || z.x < x - 12) continue;
      if (!best || z.x < best.x) best = z;
    }
    return best;
  }

  private findNearestHostileAnywhere(x: number, y: number): ZombieInstance | null {
    let best: ZombieInstance | null = null;
    let bestD = Infinity;
    for (const z of this.zombies) {
      if (z.removed || z.dying || z.hypnotized) continue;
      const d = Math.hypot(z.x - x, (z.y - 40) - y);
      if (d < bestD) {
        bestD = d;
        best = z;
      }
    }
    return best;
  }

  getEndlessRound(): number {
    return this.endlessRound;
  }

  finishEndlessAndSettle(): void {
    const completedRounds = Math.max(0, this.endlessRound - 1);
    if (completedRounds > 0) {
      saveManager.recordSurvivalRound(this.config.levelKey, completedRounds);
    }
    this.finishBattle(true);
  }

  private finishBattle(won: boolean): void {
    if (this.phase === 'won' || this.phase === 'lost') return;
    this.phase = won ? 'won' : 'lost';
    audio.stopBgm();
    audio.playSfx(won ? 'winmusic' : 'LoseMusic', 0.9, 100);
    this.emitHud();
    this.callbacks.onGameEnd(won, {
      kills: this.kills,
      fusions: this.fusions,
      elapsedSec: Math.round(this.elapsedSec),
      wavesCleared: this.endlessTotalWavesCleared + this.currentWave,
    });
  }

  getSnapshot(): HudSnapshot {
    const isIz = this.config.mode === 'iz';
    const isConv = Boolean(this.config.conveyorMode);
    const isVase = Boolean(this.config.vasebreakerConfig);

    const cards: HudCardState[] =
      isIz || isConv
        ? []
        : this.deckSlots.map((slot, idx) => {
            const effCost = this.getEffectiveSlotCost(idx);
            const effCdTotal = this.getEffectiveCardCd(slot.plantId);
            const cdLeft = this.cardCooldowns[idx] ?? 0;
            return {
              plantId: slot.plantId,
              isSubCard: Boolean(slot.isSubCard),
              cost: effCost,
              cooldownLeft: cdLeft,
              cooldownTotal: effCdTotal,
              affordable: cdLeft <= 0.05 && (this.config.infiniteSun || this.sun >= effCost),
            };
          });

    const izZombieCards: IzZombieCardState[] = isIz
      ? this.izZombieIds.map((zid) => {
          const cost = Math.max(25, assets.getZombie(zid)?.val || 50);
          return {
            zombieId: zid,
            cost,
            affordable: this.sun >= cost,
          };
        })
      : [];

    const izBrainsTotal = this.izBrains.length || this.rows;
    const izBrainsLeft = isIz ? this.izBrains.filter((b) => !b.eaten).length : 0;
    const vasesTotal = isVase ? this.vases.length : 0;
    const vasesLeft = isVase ? this.vases.filter((v) => !v.broken).length : 0;
    const waveProg = isIz
      ? (izBrainsTotal - izBrainsLeft) / Math.max(1, izBrainsTotal)
      : isVase
        ? (vasesTotal - vasesLeft) / Math.max(1, vasesTotal)
        : Math.min(1, this.currentWave / Math.max(1, this.config.maxWaves));

    let activeBoss: ActiveBossHudInfo | null = null;
    for (const z of this.zombies) {
      if (z.removed || z.dying || z.hypnotized) continue;
      if (!z.beh.isBoss && !z.beh.isLeader) continue;
      if (!activeBoss || (z.beh.isBoss && z.hp > activeBoss.hp)) {
        activeBoss = {
          name: z.def.name,
          portrait: z.def.portrait || `z_${z.zombieId}.webp`,
          hp: Math.max(0, Math.round(z.hp)),
          maxHp: z.maxHp,
          armor: Math.max(0, Math.round(z.a1Hp + z.a2Hp)),
          armorMax: z.a1Max + z.a2Max,
        };
      }
    }

    return {
      phase: this.phase,
      mode: this.config.mode,
      difficulty: clampDifficulty(this.config.difficulty),
      sun: Math.round(this.sun),
      infiniteSun: Boolean(this.config.infiniteSun),
      wave: this.currentWave,
      maxWaves: this.config.maxWaves,
      waveProgress: waveProg,
      cards,
      selectedCardIndex: this.selectedCardIndex,
      conveyorMode: isConv,
      conveyorCards: isConv ? this.conveyorCards.map((c) => ({ ...c })) : [],
      endlessRound: this.config.endless ? this.endlessRound : 0,
      izMode: isIz,
      izBrainsLeft,
      izBrainsTotal,
      izZombieCards,
      vaseMode: isVase,
      vasesLeft,
      vasesTotal,
      towerMode: this.config.mode === 'tower',
      towerLivesLeft: this.towerLivesLeft,
      towerLivesMax: this.towerLivesMax,
      stackerMode: Boolean(this.config.stackerMode),
      maliangMode: Boolean(this.config.maliangMode),
      maliangInk: Math.round(this.maliangInk),
      activeBoss,
      activeBuffLabels: this.config.modifiers?.activeBuffLabels ?? [],
      unlockedTools: { ...this.unlockedTools },
      timeStopActive: this.timeStopActive,
      shovelActive: this.shovelActive,
      gloveActive: this.gloveActive,
      gloveMode: this.gloveMode,
      gloveCooldownLeft: this.gloveCooldownLeft,
      gloveHoldingName: this.gloveHeldPlant
        ? assets.getPlant(this.gloveHeldPlant.plantId)?.name ?? null
        : null,
      gloveHoldingPlantId: this.gloveHeldPlant?.plantId ?? null,
      gloveHoldingZombieName: this.gloveHeldZombie ? this.gloveHeldZombie.def.name : null,
      gloveHoldingZombieId: this.gloveHeldZombie?.zombieId ?? null,
      hammerActive: this.hammerActive,
      hammerCooldownLeft: this.hammerCooldownLeft,
      wheelbarrowActive: this.wheelbarrowActive,
      wheelbarrowCooldownLeft: this.wheelbarrowCooldownLeft,
      wheelbarrowStoredPlantId: this.wheelbarrowStored?.plantId ?? null,
      wheelbarrowStoredPlantName: this.wheelbarrowStored
        ? assets.getPlant(this.wheelbarrowStored.plantId)?.name ?? null
        : null,
      fertilizerActive: this.fertilizerActive,
      fertilizerCharges: this.fertilizerCharges,
      fertilizerNextSec: this.fertilizerCharges >= 5 ? 0 : Math.ceil(this.fertilizerTimer),
      speed: this.speed,
      autoCollect: this.autoCollect,
      bannerText: this.bannerText,
      hugeWaveVisible: this.hugeWaveTimer > 0,
      finalWaveVisible: this.finalWaveTimer > 0,
      kills: this.kills,
      fusions: this.fusions,
      elapsedSec: Math.round(this.elapsedSec),
    };
  }

  private emitHud(): void {
    this.callbacks.onHudUpdate(this.getSnapshot());
  }

  /** Spawns a small test wave immediately (used in Sandbox mode). */
  spawnSandboxWave(): void {
    if (this.phase !== 'playing') return;
    const pool = this.config.allowedZombies.length > 0 ? this.config.allowedZombies : [0, 2, 4];
    for (let r = 0; r < this.rows; r++) {
      const zid = pool[r % pool.length];
      void this.spawnZombieAt(zid, r, 1090 + Math.random() * 55);
    }
    audio.playSfx('Awooga', 0.85, 300);
  }

  /** Returns all compatible tiles for the currently held card or glove plant (for UI hints). */
  getDebugMetrics(): { plants: number; zombies: number; bullets: number; fps: number } {
    return {
      plants: this.plants.length,
      zombies: this.zombies.length,
      bullets: this.bullets.length,
      fps: this.app ? Math.round(this.app.ticker.FPS) : 0,
    };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clearPreviewZombies();
    for (const p of this.plants) p.rig?.destroy();
    for (const z of this.zombies) z.rig?.destroy();
    for (const m of this.mowers) m.rig?.destroy();
    for (const s of this.suns) s.rig?.destroy();
    for (const v of this.vases) v.container.destroy({ children: true });
    for (const sp of this.graveSprites.values()) sp.destroy();
    for (const fb of this.fadingBeams) fb.gfx.destroy();
    this.graveSprites.clear();
    this.fadingBeams.length = 0;
    this.plants.length = 0;
    this.zombies.length = 0;
    this.mowers.length = 0;
    this.suns.length = 0;
    this.vases.length = 0;
    this.bullets.length = 0;
    this.particleSys.clear();
    if (this.app) {
      this.app.destroy(
        { removeView: true },
        { children: true, texture: false, textureSource: false },
      );
      this.app = null;
    }
    this.hostEl.innerHTML = '';
  }
}
