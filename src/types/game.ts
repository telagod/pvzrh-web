import type { Texture } from 'pixi.js';

/** Trimmed sprite rectangle & normalized Unity pivot inside a rig's WebP atlas. */
export interface RigSprite {
  x: number;
  y: number;
  w: number;
  h: number;
  px: number;
  py: number;
  ppu: number;
}

/** Static prefab node in a compiled Unity Transform + SpriteRenderer hierarchy. */
export interface RigNode {
  id: number;
  parent: number;
  name: string;
  x: number;
  y: number;
  rot: number;
  sx: number;
  sy: number;
  a: number;
  sp: number;
  order: number;
  al: number;
  fx: number;
  fy: number;
  tint?: number;
}

/** Sampled keyframe channels for one node in an AnimationClip. */
export interface RigTrack {
  x?: number[];
  y?: number[];
  rot?: number[];
  sx?: number[];
  sy?: number[];
  a?: number[];
  sp?: number[];
  al?: number[];
  fyRot?: number[];
}

export type RigEventTuple = [time: number, functionName: string];

/** Compiled Unity AnimationClip sampled at `fps`. */
export interface RigClip {
  name: string;
  dur: number;
  fps: number;
  frames: number;
  loop: boolean;
  additive?: boolean;
  events: RigEventTuple[];
  tracks: Record<string, RigTrack>;
}

/** Complete compiled 2D skeletal rig JSON. */
export interface RigData {
  ppu: number;
  atlas: string;
  atlasW: number;
  atlasH: number;
  anchor: [number, number];
  shootNodes: number[];
  sprites: RigSprite[];
  nodes: RigNode[];
  clips: Record<string, RigClip>;
}

/** Hydrated rig ready for instant instantiation in PixiJS 8. */
export interface LoadedRig {
  key: string;
  data: RigData;
  atlasTexture: Texture;
  spriteTextures: Texture[];
  animatedSpNodes: Set<number>;
}

export type PlantLayer = 'Default' | 'Pot' | 'Fly' | 'Pumpkin' | 'Lily';

export interface PlantDef {
  id: number;
  en: string;
  name: string;
  cost: number;
  cd: number;
  hp: number;
  dmg: number;
  atkIv: number;
  prodIv: number;
  layer: PlantLayer | string;
  tags: string[];
  scriptClass: string;
  baseChain: string[];
  hasRig: boolean;
  portrait?: string | null;
  info?: string;
  intro?: string;
}

export interface ZombieDef {
  id: number;
  en: string;
  name: string;
  hp: number;
  a1: number;
  a2: number;
  atk: number;
  val: number;
  tier: number;
  tags: string[];
  duck?: string;
  scriptClass: string;
  baseChain: string[];
  hasRig: boolean;
  portrait?: string | null;
  info?: string;
  intro?: string;
}

export interface ExplorePrePlant {
  thePlantType: number;
  theColumn: number;
  theRow: number;
}

export interface ExploreLevelDef {
  id: number;
  name: string;
  sceneType: number;
  maxWave: number;
  zombies: number[];
  prePlant: ExplorePrePlant[];
  usePlant: number[];
  convay: boolean;
  convayTimer: number;
  gloveCD: number;
  theSun: number;
  tips: string;
  zombieHealthMultiplier: number;
  zombieSpeedAdder: number;
  firstWaveCountdown: number;
  nextWaveInterval?: number;
}

export interface IzPrePlant {
  thePlantColumn: number;
  thePlantRow: number;
  thePlantType: number;
  thePlantHealth: number;
  theLilyType: number;
}

export interface IzLevelData {
  plants: IzPrePlant[];
  theSun: number;
  zombietTypes: number[];
  dropSunPerPlant: number;
  recommendDifficulty: number;
  redlineColumn: number;
  sceneType: number;
  tips: string;
}

export interface IzLevelEntry {
  name: string;
  data: IzLevelData;
}

export interface SceneDef {
  id: number;
  en: string;
  label: string;
  bg: string;
  bgm: string;
  drumBgm: string;
  rows: number;
  waterRows: number[];
  night?: boolean;
  pool?: boolean;
  fog?: boolean;
  roof?: boolean;
  snow?: boolean;
  cardStyle: string;
}

export interface CatalogData {
  version: string;
  plants: Record<string, PlantDef>;
  zombies: Record<string, ZombieDef>;
  recipes: Record<string, number>;
  recipeList: [a: number, b: number, result: number, tier: number][];
  bullets: Record<string, number>;
  exploreLevels: ExploreLevelDef[];
  scenes: Record<string, SceneDef>;
}

export type AudioManifest = Record<string, string>;

export type BulletKind =
  | 'pea'
  | 'snowpea'
  | 'firepea'
  | 'cherrypea'
  | 'doompea'
  | 'hypnopea'
  | 'ironpea'
  | 'sunpea'
  | 'cabbage'
  | 'kernel'
  | 'butter'
  | 'melon'
  | 'wintermelon'
  | 'star'
  | 'redstar'
  | 'ultimatestar'
  | 'cactus'
  | 'puff'
  | 'fume'
  | 'potatobullet'
  | 'doombullet'
  | 'superfireball';

export interface PlantBehavior {
  kind:
    | 'shooter'
    | 'producer'
    | 'shooter_producer'
    | 'wall'
    | 'mine'
    | 'instant_bomb'
    | 'instant_row'
    | 'instant_doom'
    | 'instant_ice'
    | 'squash'
    | 'chomper'
    | 'torch'
    | 'spike'
    | 'lilypad'
    | 'flowerpot'
    | 'pumpkin'
    | 'garlic'
    | 'plantern'
    | 'blover'
    | 'magnet'
    | 'hypno'
    | 'kelp'
    | 'umbrella'
    | 'gravebuster'
    | 'passive';
  bulletKind: BulletKind;
  shotCount: number;
  lanes: 'single' | 'three' | 'five' | 'homing' | 'pierce_short' | 'pierce_all' | 'lob';
  damage: number;
  attackInterval: number;
  rangeCols: number;
  sunAmount: number;
  produceInterval: number;
  maxHp: number;
  thornsDamage: number;
  regenPerSec: number;
  chillDur: number;
  freezeDur: number;
  butterDur: number;
  splashRadius: number;
  splashRatio: number;
  knockbackPx: number;
  hypnoOnHit: boolean;
  sunOnHit: boolean;
  stackable3: boolean;
  tallBlock: boolean;
  nocturnalSleep: boolean;
  aquaticOnly: boolean;
  explodeRadius: number;
  explodeDamage: number;
  triggerRangePx: number;
  isHeatSource?: boolean;
  isUltimateSpecial?: string;
}

export interface ZombieBehavior {
  speedPxPerSec: number;
  biteDps: number;
  armor1Type: 'none' | 'cone' | 'bucket' | 'metal' | 'ice';
  armor2Type: 'none' | 'door' | 'paper' | 'trash';
  canVault: boolean;
  canPogo: boolean;
  flying: boolean;
  aquatic: boolean;
  gargantuar: boolean;
  vehicle: boolean;
  explodeTimer: number;
  enrageOnArmor2Break: boolean;
  isBoss: boolean;
  isLeader: boolean;
}

export interface BattleModifiers {
  plantDmgMult?: number;
  plantHpMult?: number;
  plantAtkSpeedMult?: number;
  sunGainMult?: number;
  cardCostDiscount?: number;
  cardCdMult?: number;
  critChance?: number;
  zombieHpBonusMult?: number;
  zombieSpeedBonusMult?: number;
  zombieArmorMult?: number;
  hammerCdMult?: number;
  plantLifestealRatio?: number;
  extraLeaderShield?: boolean;
  activeBuffLabels?: string[];
}

export interface DeckSlot {
  plantId: number;
  isSubCard?: boolean;
}

export interface TowerWaypoint {
  row: number;
  col: number;
}

export interface TowerConfig {
  waypoints: TowerWaypoint[];
  maxLives: number;
}

export interface VaseSpec {
  row: number;
  col: number;
  kind: 'plant' | 'mystery' | 'zombie';
  plantId?: number;
  zombieId?: number;
  sunBonus?: number;
}

export interface VasebreakerConfig {
  vases: VaseSpec[];
  chainReaction?: boolean;
}

export interface BoardConfig {
  mode: 'adventure' | 'explore' | 'survival' | 'sandbox' | 'challenge' | 'iz' | 'vasebreaker' | 'travel' | 'abyss' | 'tower';
  levelKey: string;
  title: string;
  subtitle?: string;
  scene: SceneDef;
  initialSun: number;
  infiniteSun?: boolean;
  zeroCooldown?: boolean;
  maxWaves: number;
  firstWaveDelay: number;
  nextWaveInterval?: number;
  allowedZombies: number[];
  prePlants: ExplorePrePlant[];
  presetCards?: number[];
  restrictToPresetCards?: boolean;
  gloveCooldown: number;
  difficulty: number; // 1..5
  zombieHpMult: number;
  zombieSpeedMult: number;
  conveyorMode?: boolean;
  conveyorInterval?: number;
  endless?: boolean;
  wavesPerRound?: number;
  tips?: string;
  adventureIndex?: number;
  starMainKey?: string;
  starSubKey?: string;
  challengeKey?: string;
  exploreId?: number;
  modifiers?: BattleModifiers;
  vasebreakerConfig?: VasebreakerConfig;
  towerConfig?: TowerConfig;
  stackerMode?: boolean;
  maliangMode?: boolean;
  enableGraves?: boolean;
  travelMeta?: {
    isRunRound?: boolean;
    round?: number;
    mode?: 'classic' | 'inferno' | 'cursed';
  };
  abyssStage?: number;
  izConfig?: {
    name: string;
    redlineColumn: number;
    dropSunPerPlant: number;
    availableZombies: number[];
    plants: IzPrePlant[];
  };
}

export interface HudCardState {
  plantId: number;
  isSubCard?: boolean;
  cost: number;
  cooldownLeft: number;
  cooldownTotal: number;
  affordable: boolean;
}

export interface ConveyorCardState {
  uid: number;
  plantId: number;
  progress: number;
}

export interface IzZombieCardState {
  zombieId: number;
  cost: number;
  affordable: boolean;
}

export interface ActiveBossHudInfo {
  name: string;
  portrait: string;
  hp: number;
  maxHp: number;
  armor: number;
  armorMax: number;
}

export interface HudSnapshot {
  phase: 'choosing' | 'intro' | 'playing' | 'paused' | 'won' | 'lost';
  mode: BoardConfig['mode'];
  sun: number;
  infiniteSun: boolean;
  wave: number;
  maxWaves: number;
  waveProgress: number; // 0..1
  cards: HudCardState[];
  selectedCardIndex: number;
  conveyorMode: boolean;
  conveyorCards: ConveyorCardState[];
  endlessRound: number;
  izMode: boolean;
  izBrainsLeft: number;
  izBrainsTotal: number;
  izZombieCards: IzZombieCardState[];
  vaseMode: boolean;
  vasesLeft: number;
  vasesTotal: number;
  towerMode: boolean;
  towerLivesLeft: number;
  towerLivesMax: number;
  stackerMode: boolean;
  maliangMode: boolean;
  maliangInk: number;
  activeBoss: ActiveBossHudInfo | null;
  activeBuffLabels: string[];
  timeStopActive: boolean;
  shovelActive: boolean;
  gloveActive: boolean;
  gloveMode: 'plant' | 'zombie';
  gloveCooldownLeft: number;
  gloveHoldingName: string | null;
  gloveHoldingZombieName: string | null;
  hammerActive: boolean;
  hammerCooldownLeft: number;
  wheelbarrowActive: boolean;
  wheelbarrowCooldownLeft: number;
  wheelbarrowStoredPlantId: number | null;
  fertilizerActive: boolean;
  fertilizerCharges: number;
  fertilizerNextSec: number;
  speed: 1 | 2 | 3;
  autoCollect: boolean;
  bannerText: string | null;
  hugeWaveVisible: boolean;
  finalWaveVisible: boolean;
  kills: number;
  fusions: number;
  elapsedSec: number;
}

export interface BoardCallbacks {
  onHudUpdate: (snap: HudSnapshot) => void;
  onFusionToast: (parentA: PlantDef, parentB: PlantDef, result: PlantDef) => void;
  onEndlessRoundComplete?: (nextRound: number, stats: { kills: number; fusions: number; sun: number }) => void;
  onGameEnd: (won: boolean, stats: { kills: number; fusions: number; elapsedSec: number; wavesCleared: number }) => void;
}

export type ScreenId = 'menu' | 'levels' | 'almanac' | 'battle' | 'garden' | 'travel' | 'abyss';

export type GardenNeed = 'water' | 'fertilizer' | 'bugspray' | 'music' | 'happy';

export interface GardenPlantSlot {
  uid: number;
  slot: number;
  plantId: number;
  stage: 0 | 1 | 2 | 3;
  need: GardenNeed;
  happyUntil: number;
  lastCoinAt: number;
  goldPot?: boolean;
}

export interface GardenSaveState {
  scene: 'day' | 'morning' | 'night' | 'mushroom';
  goldWateringCan: boolean;
  fertilizerCount: number;
  bugSprayCount: number;
  phonographOwned: boolean;
  nextUid: number;
  plants: GardenPlantSlot[];
}

export interface TravelRunState {
  active: boolean;
  mode: 'classic' | 'inferno' | 'cursed';
  round: number;
  points: number;
  plantBuffs: string[];
  zombieBuffs: string[];
  purchasedUltimates: number[];
  pendingStage: 'battle' | 'pick_buff' | 'pick_zombie_buff' | 'store';
  bestRound: number;
  clearedTravelLevels: string[];
}

export interface AbyssRunState {
  stage: number;
  coins: number;
  warehouse: number[];
  zombieBuffs: string[];
  bestStage: number;
}

export interface SaveProfile {
  name: string;
  advLevel: number; // 1..45
  starMainCleared: string[];
  starSubCleared: string[];
  clearedChallenges: string[];
  clearedIz: string[];
  unlockAll: boolean;
  unlockedPlants: number[];
  discoveredFusions: number[];
  clearedExplore: number[];
  bestSurvivalFlags: Record<number, number>;
  bestSurvivalRounds: Record<string, number>;
  lastDeck: number[];
  difficulty: number;
  musicVolume: number;
  soundVolume: number;
  muted: boolean;
  autoCollect: boolean;
  coins: number;
  garden: GardenSaveState;
  travel: TravelRunState;
  abyss: AbyssRunState;
}

export interface SaveStore {
  version: number;
  activeName: string;
  profiles: Record<string, SaveProfile>;
}
