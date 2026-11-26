import { assets } from '../assets/AssetLoader';
import { audio } from '../audio/AudioManager';
import type {
  AbyssRunState,
  BattleToolId,
  BoardConfig,
  GardenSaveState,
  SaveProfile,
  SaveStore,
  TravelRunState,
  UnlockedToolsState,
} from '../types/game';
import { clampDifficulty, DEFAULT_DIFFICULTY } from './difficulty';
import {
  evaluatePlantUnlocked,
  REWARD_TRACKED_PLANT_IDS,
  SUPER_CHALLENGE_UNLOCKS,
  TOOL_UNLOCK_RULES,
  TRACKED_UNLOCK_TOOLS,
} from './plantUnlocks';

const STORAGE_KEY = 'pvz_web_save_v1';

/** Base starter plant IDs unlocked from day 1 (PeaShooter + SunFlower). */
export const STARTER_PLANT_IDS: number[] = [0, 1];

export function makeDefaultGarden(): GardenSaveState {
  const now = Date.now();
  return {
    scene: 'day',
    goldWateringCan: false,
    fertilizerCount: 5,
    bugSprayCount: 5,
    phonographOwned: false,
    nextUid: 4,
    plants: [
      { uid: 1, slot: 0, plantId: 0, stage: 1, need: 'water', happyUntil: 0, lastCoinAt: now },
      { uid: 2, slot: 2, plantId: 1, stage: 2, need: 'fertilizer', happyUntil: 0, lastCoinAt: now },
      { uid: 3, slot: 5, plantId: 1000, stage: 1, need: 'water', happyUntil: 0, lastCoinAt: now, goldPot: true },
    ],
  };
}

export function makeDefaultTravel(): TravelRunState {
  return {
    active: false,
    mode: 'classic',
    round: 1,
    points: 500,
    plantBuffs: [],
    zombieBuffs: [],
    purchasedUltimates: [],
    pendingStage: 'battle',
    bestRound: 0,
    clearedTravelLevels: [],
  };
}

export function makeDefaultAbyss(): AbyssRunState {
  return {
    stage: 1,
    coins: 300,
    warehouse: [0, 1, 2, 3, 6, 13],
    zombieBuffs: [],
    bestStage: 0,
  };
}

function makeDefaultProfile(name = '戴夫的邻居'): SaveProfile {
  return {
    name,
    advLevel: 1,
    starMainCleared: [],
    starSubCleared: [],
    clearedChallenges: [],
    clearedIz: [],
    unlockAll: false,
    unlockedPlants: [...STARTER_PLANT_IDS],
    discoveredFusions: [],
    clearedExplore: [],
    bestSurvivalFlags: {},
    bestSurvivalRounds: {},
    lastDeck: [],
    difficulty: DEFAULT_DIFFICULTY,
    musicVolume: 0.55,
    soundVolume: 0.85,
    muted: false,
    autoCollect: false,
    coins: 1500,
    garden: makeDefaultGarden(),
    travel: makeDefaultTravel(),
    abyss: makeDefaultAbyss(),
  };
}

/**
 * Multi-profile save persistence backed by `localStorage`, plus bidirectional import/export
 * compatible with PvZ Fusion PC `playerData.json`.
 */
class SaveManager {
  private store: SaveStore;
  private migratedOnBoot = false;

  constructor() {
    this.store = this._load();
    if (this.migratedOnBoot) {
      this._save();
    }
    this._syncAudio();
  }

  private _load(): SaveStore {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<SaveStore>;
        if (parsed && parsed.profiles && typeof parsed.activeName === 'string') {
          const isLegacyV1 = !parsed.version || parsed.version < 2;
          const needsV3Upgrade = !parsed.version || parsed.version < 3;
          if (needsV3Upgrade) this.migratedOnBoot = true;
          const active = parsed.profiles[parsed.activeName]
            ? parsed.activeName
            : Object.keys(parsed.profiles)[0] || '戴夫的邻居';
          const normalized: Record<string, SaveProfile> = {};
          for (const [k, v] of Object.entries(parsed.profiles)) {
            const def = makeDefaultProfile(v?.name || k);
            const disc = Array.isArray(v?.discoveredFusions) ? v.discoveredFusions : [];
            const unlocked = isLegacyV1
              ? Array.from(new Set([...STARTER_PLANT_IDS, ...disc]))
              : Array.isArray(v?.unlockedPlants)
                ? v.unlockedPlants
                : [...STARTER_PLANT_IDS];
            const defGarden = makeDefaultGarden();
            const rawGarden = v?.garden as Partial<GardenSaveState> | undefined;
            const garden: GardenSaveState = {
              ...defGarden,
              ...(rawGarden ?? {}),
              plants: Array.isArray(rawGarden?.plants) ? rawGarden.plants : defGarden.plants,
            };
            const defTravel = makeDefaultTravel();
            const rawTravel = v?.travel as Partial<TravelRunState> | undefined;
            const travel: TravelRunState = {
              ...defTravel,
              ...(rawTravel ?? {}),
              plantBuffs: Array.isArray(rawTravel?.plantBuffs) ? rawTravel.plantBuffs : [],
              zombieBuffs: Array.isArray(rawTravel?.zombieBuffs) ? rawTravel.zombieBuffs : [],
              purchasedUltimates: Array.isArray(rawTravel?.purchasedUltimates)
                ? rawTravel.purchasedUltimates
                : [],
              clearedTravelLevels: Array.isArray(rawTravel?.clearedTravelLevels)
                ? rawTravel.clearedTravelLevels
                : [],
            };
            const defAbyss = makeDefaultAbyss();
            const rawAbyss = v?.abyss as Partial<AbyssRunState> | undefined;
            const abyss: AbyssRunState = {
              ...defAbyss,
              ...(rawAbyss ?? {}),
              warehouse:
                Array.isArray(rawAbyss?.warehouse) && rawAbyss.warehouse.length > 0
                  ? rawAbyss.warehouse
                  : defAbyss.warehouse,
              zombieBuffs: Array.isArray(rawAbyss?.zombieBuffs) ? rawAbyss.zombieBuffs : [],
            };
            normalized[k] = {
              ...def,
              ...v,
              name: v?.name || k,
              unlockedPlants: unlocked,
              discoveredFusions: disc,
              starMainCleared: Array.isArray(v?.starMainCleared) ? v.starMainCleared : [],
              starSubCleared: Array.isArray(v?.starSubCleared) ? v.starSubCleared : [],
              clearedChallenges: Array.isArray(v?.clearedChallenges) ? v.clearedChallenges : [],
              clearedIz: Array.isArray(v?.clearedIz) ? v.clearedIz : [],
              bestSurvivalRounds:
                v?.bestSurvivalRounds && typeof v.bestSurvivalRounds === 'object'
                  ? v.bestSurvivalRounds
                  : {},
              lastDeck: Array.isArray(v?.lastDeck) ? v.lastDeck : [],
              difficulty: clampDifficulty(v?.difficulty),
              coins: typeof v?.coins === 'number' && Number.isFinite(v.coins) ? Math.max(0, v.coins) : def.coins,
              garden,
              travel,
              abyss,
            };
          }
          if (!normalized[active]) {
            normalized[active] = makeDefaultProfile(active);
          }
          return { version: 3, activeName: active, profiles: normalized };
        }
      }
    } catch {
      // Corrupted localStorage -> reset cleanly
    }
    const def = makeDefaultProfile('戴夫的邻居');
    return { version: 3, activeName: def.name, profiles: { [def.name]: def } };
  }

  private _save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.store));
    } catch {
      // Ignore quota errors
    }
  }

  private _syncAudio(): void {
    const p = this.current;
    audio.applySettings(p.musicVolume, p.soundVolume, p.muted);
  }

  get current(): SaveProfile {
    return this.store.profiles[this.store.activeName];
  }

  listProfiles(): SaveProfile[] {
    return Object.values(this.store.profiles);
  }

  switchProfile(name: string): void {
    const clean = name.trim();
    if (!clean) {
      return;
    }
    if (!this.store.profiles[clean]) {
      this.store.profiles[clean] = makeDefaultProfile(clean);
    }
    this.store.activeName = clean;
    this._save();
    this._syncAudio();
  }

  deleteProfile(name: string): void {
    const keys = Object.keys(this.store.profiles);
    if (keys.length <= 1 || !this.store.profiles[name]) {
      return;
    }
    delete this.store.profiles[name];
    if (this.store.activeName === name) {
      this.store.activeName = Object.keys(this.store.profiles)[0];
    }
    this._save();
    this._syncAudio();
  }

  update(patch: Partial<SaveProfile>): void {
    const nextPatch =
      patch.difficulty !== undefined ? { ...patch, difficulty: clampDifficulty(patch.difficulty) } : patch;
    Object.assign(this.current, nextPatch);
    this._save();
    this._syncAudio();
  }

  recordFusion(plantId: number): void {
    const prof = this.current;
    if (!prof.discoveredFusions.includes(plantId)) {
      prof.discoveredFusions.push(plantId);
    }
    if (!prof.unlockedPlants.includes(plantId)) {
      prof.unlockedPlants.push(plantId);
    }
    this._save();
  }

  recordAdventureWin(advIndex: number): void {
    const prof = this.current;
    if (advIndex >= prof.advLevel && prof.advLevel < 45) {
      prof.advLevel = Math.min(45, advIndex + 1);
    }
    this._save();
  }

  recordStarMainWin(key: string): void {
    const prof = this.current;
    if (!prof.starMainCleared.includes(key)) {
      prof.starMainCleared.push(key);
      this._save();
    }
  }

  recordStarSubWin(key: string): void {
    const prof = this.current;
    if (!prof.starSubCleared.includes(key)) {
      prof.starSubCleared.push(key);
      this._save();
    }
  }

  recordChallengeWin(key: string): void {
    const prof = this.current;
    let dirty = false;
    if (!prof.clearedChallenges.includes(key)) {
      prof.clearedChallenges.push(key);
      dirty = true;
    }
    const rewardPlant = SUPER_CHALLENGE_UNLOCKS[key];
    if (rewardPlant !== undefined && !prof.unlockedPlants.includes(rewardPlant)) {
      prof.unlockedPlants.push(rewardPlant);
      dirty = true;
    }
    if (dirty) {
      this._save();
    }
  }

  recordIzWin(name: string): void {
    const prof = this.current;
    if (!prof.clearedIz.includes(name)) {
      prof.clearedIz.push(name);
      this._save();
    }
  }

  recordExploreWin(exploreId: number): void {
    const prof = this.current;
    if (!prof.clearedExplore.includes(exploreId)) {
      prof.clearedExplore.push(exploreId);
      this._save();
    }
  }

  recordSurvivalFlags(sceneId: number, flags: number): void {
    const prof = this.current;
    const prev = prof.bestSurvivalFlags[sceneId] ?? 0;
    if (flags > prev) {
      prof.bestSurvivalFlags[sceneId] = flags;
      this._save();
    }
  }

  recordSurvivalRound(levelKey: string, roundsCompleted: number): void {
    const prof = this.current;
    const prev = prof.bestSurvivalRounds[levelKey] ?? 0;
    if (roundsCompleted > prev) {
      prof.bestSurvivalRounds[levelKey] = roundsCompleted;
      this._save();
    }
  }

  setLastDeck(deck: number[]): void {
    this.current.lastDeck = deck.slice(0, 12);
    this._save();
  }

  addCoins(delta: number): void {
    this.current.coins = Math.max(0, Math.round((this.current.coins ?? 0) + delta));
    this._save();
  }

  updateGarden(patch: Partial<GardenSaveState>): void {
    this.current.garden = { ...this.current.garden, ...patch };
    this._save();
  }

  setGarden(next: GardenSaveState): void {
    this.current.garden = next;
    this._save();
  }

  setTravel(next: TravelRunState): void {
    this.current.travel = next;
    this._save();
  }

  recordTravelLevelWin(key: string): void {
    const trv = this.current.travel;
    if (!trv.clearedTravelLevels.includes(key)) {
      trv.clearedTravelLevels.push(key);
      this._save();
    }
  }

  setAbyss(next: AbyssRunState): void {
    this.current.abyss = next;
    this._save();
  }

  unlockAllLevels(): void {
    const prof = this.current;
    prof.advLevel = 45;
    prof.unlockAll = true;
    prof.unlockedPlants = this.getAllCatalogPlantIds();
    this._save();
  }

  resetProgress(): void {
    const prof = this.current;
    prof.advLevel = 1;
    prof.unlockAll = false;
    prof.unlockedPlants = [...STARTER_PLANT_IDS];
    prof.starMainCleared = [];
    prof.starSubCleared = [];
    prof.clearedChallenges = [];
    prof.clearedExplore = [];
    prof.clearedIz = [];
    prof.bestSurvivalFlags = {};
    prof.bestSurvivalRounds = {};
    prof.lastDeck = [];
    prof.coins = 1500;
    prof.garden = makeDefaultGarden();
    prof.travel = makeDefaultTravel();
    prof.abyss = makeDefaultAbyss();
    this._save();
  }

  isPlantUnlocked(plantId: number, board?: BoardConfig): boolean {
    if (board?.mode === 'sandbox') {
      return true;
    }
    if (board?.presetCards?.includes(plantId)) {
      return true;
    }
    if (board?.mode === 'travel' && this.current.travel.purchasedUltimates.includes(plantId)) {
      return true;
    }
    return evaluatePlantUnlocked(plantId, this.current);
  }

  getUnlockedPlantSet(): Set<number> {
    const out = new Set<number>();
    const prof = this.current;
    for (const id of REWARD_TRACKED_PLANT_IDS) {
      if (evaluatePlantUnlocked(id, prof)) {
        out.add(id);
      }
    }
    for (const id of prof.discoveredFusions) {
      out.add(id);
    }
    return out;
  }

  getUnlockedToolIds(): Set<BattleToolId> {
    const out = new Set<BattleToolId>();
    const prof = this.current;
    for (const id of TRACKED_UNLOCK_TOOLS) {
      if (TOOL_UNLOCK_RULES[id].check(prof)) {
        out.add(id);
      }
    }
    return out;
  }

  getUnlockedTools(board?: BoardConfig): UnlockedToolsState {
    if (board?.mode === 'iz') {
      return { shovel: false, glove: false, hammer: false, wheelbarrow: false, fertilizer: false };
    }
    if (board?.mode === 'sandbox') {
      return { shovel: true, glove: true, hammer: true, wheelbarrow: true, fertilizer: true };
    }
    const prof = this.current;
    const out: UnlockedToolsState = {
      shovel: TOOL_UNLOCK_RULES.shovel.check(prof),
      glove: TOOL_UNLOCK_RULES.glove.check(prof),
      hammer: TOOL_UNLOCK_RULES.hammer.check(prof),
      wheelbarrow: TOOL_UNLOCK_RULES.wheelbarrow.check(prof),
      fertilizer: TOOL_UNLOCK_RULES.fertilizer.check(prof),
    };
    if (board?.mode === 'explore') {
      out.glove = true;
      const tips = board.tips ?? '';
      if (tips.includes('手推车')) out.wheelbarrow = true;
      if (tips.includes('锤子') || tips.includes('重锤') || tips.includes('大锤')) out.hammer = true;
      if (tips.includes('肥料')) out.fertilizer = true;
    }
    if (board?.forceUnlockTools) {
      Object.assign(out, board.forceUnlockTools);
    }
    return out;
  }

  getAllCatalogPlantIds(): number[] {
    try {
      return Object.keys(assets.catalog.plants).map((k) => Number(k));
    } catch {
      return [...STARTER_PLANT_IDS];
    }
  }

  /**
   * Imports either a web-exported profile JSON or a PC `playerData.json` save file.
   */
  importProfileJson(text: string): { ok: boolean; message: string } {
    try {
      const raw = JSON.parse(text) as Record<string, unknown>;
      if (!raw || typeof raw !== 'object') {
        return { ok: false, message: '存档文件不是有效的 JSON 对象。' };
      }
      const rawName = String(raw.userName ?? raw.name ?? this.current.name).trim() || '导入存档';
      const prof = makeDefaultProfile(rawName);

      const adv = Number(raw.advLevel ?? raw.adventureLevel ?? raw.currentAdvLevel ?? prof.advLevel);
      if (Number.isFinite(adv) && adv >= 1) {
        prof.advLevel = Math.min(45, Math.floor(adv));
      }
      if (typeof raw.unlockAll === 'boolean') {
        prof.unlockAll = raw.unlockAll;
      }
      if (Array.isArray(raw.unlockedPlants)) {
        const ids = raw.unlockedPlants.map((x) => Number(x)).filter((x) => Number.isFinite(x));
        prof.unlockedPlants = Array.from(new Set([...STARTER_PLANT_IDS, ...ids]));
      }
      if (Array.isArray(raw.discoveredFusions)) {
        prof.discoveredFusions = raw.discoveredFusions.map((x) => Number(x)).filter((x) => Number.isFinite(x));
      }
      if (Array.isArray(raw.clearedExplore)) {
        prof.clearedExplore = raw.clearedExplore.map((x) => Number(x)).filter((x) => Number.isFinite(x));
      } else if (Array.isArray(raw.clearedLevels)) {
        prof.clearedExplore = raw.clearedLevels.map((x) => Number(x)).filter((x) => Number.isFinite(x));
      }
      if (raw.bestSurvivalFlags && typeof raw.bestSurvivalFlags === 'object') {
        const out: Record<number, number> = {};
        for (const [k, v] of Object.entries(raw.bestSurvivalFlags as Record<string, unknown>)) {
          if (Number.isFinite(Number(v))) {
            out[Number(k)] = Number(v);
          }
        }
        prof.bestSurvivalFlags = out;
      }
      if (Array.isArray(raw.starMainCleared)) {
        prof.starMainCleared = raw.starMainCleared.map(String);
      }
      if (Array.isArray(raw.starSubCleared)) {
        prof.starSubCleared = raw.starSubCleared.map(String);
      }
      if (Array.isArray(raw.clearedChallenges)) {
        prof.clearedChallenges = raw.clearedChallenges.map(String);
      }
      if (Array.isArray(raw.clearedIz)) {
        prof.clearedIz = raw.clearedIz.map(String);
      }
      if (raw.bestSurvivalRounds && typeof raw.bestSurvivalRounds === 'object') {
        const outR: Record<string, number> = {};
        for (const [k, v] of Object.entries(raw.bestSurvivalRounds as Record<string, unknown>)) {
          if (Number.isFinite(Number(v))) {
            outR[k] = Number(v);
          }
        }
        prof.bestSurvivalRounds = outR;
      }
      if (Array.isArray(raw.lastDeck)) {
        prof.lastDeck = raw.lastDeck.map((x) => Number(x)).filter((x) => Number.isFinite(x));
      }
      const diff = Number(raw.difficulty ?? raw.theDifficulty);
      if (Number.isFinite(diff)) {
        prof.difficulty = clampDifficulty(diff);
      }
      const mv = Number(raw.musicVolume);
      if (Number.isFinite(mv)) {
        prof.musicVolume = Math.max(0, Math.min(1, mv));
      }
      const sv = Number(raw.soundVolume);
      if (Number.isFinite(sv)) {
        prof.soundVolume = Math.max(0, Math.min(1, sv));
      }
      if (typeof raw.muted === 'boolean') {
        prof.muted = raw.muted;
      }
      if (typeof raw.autoCollect === 'boolean') {
        prof.autoCollect = raw.autoCollect;
      }

      this.store.profiles[prof.name] = prof;
      this.store.activeName = prof.name;
      this._save();
      this._syncAudio();
      return { ok: true, message: `已成功导入存档「${prof.name}」（冒险第 ${prof.advLevel} 关）。` };
    } catch (err) {
      return { ok: false, message: `解析 JSON 失败: ${(err as Error).message}` };
    }
  }

  /** Exports active profile in PC-compatible `playerData.json` format. */
  exportProfileJson(): string {
    const p = this.current;
    const payload = {
      format: 'pvzrh-web-4.1',
      userName: p.name,
      advLevel: p.advLevel,
      starMainCleared: p.starMainCleared,
      starSubCleared: p.starSubCleared,
      clearedChallenges: p.clearedChallenges,
      clearedIz: p.clearedIz,
      unlockAll: p.unlockAll,
      unlockedPlants: p.unlockedPlants,
      discoveredFusions: p.discoveredFusions,
      clearedExplore: p.clearedExplore,
      bestSurvivalFlags: p.bestSurvivalFlags,
      bestSurvivalRounds: p.bestSurvivalRounds,
      lastDeck: p.lastDeck,
      difficulty: p.difficulty,
      musicVolume: p.musicVolume,
      soundVolume: p.soundVolume,
      muted: p.muted,
      autoCollect: p.autoCollect,
      exportedAt: new Date().toISOString(),
    };
    return JSON.stringify(payload, null, 2);
  }
}

export const saveManager = new SaveManager();
