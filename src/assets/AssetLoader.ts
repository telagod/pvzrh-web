import { ImageSource, Rectangle, Texture } from 'pixi.js';
import type {
  AudioManifest,
  BoardConfig,
  CatalogData,
  ExploreLevelDef,
  IzLevelEntry,
  LoadedRig,
  PlantDef,
  RigData,
  SceneDef,
  UnlockedToolsState,
  ZombieDef,
} from '../types/game';

export type AssetProgressCb = (ratio: number, detail: string, countText?: string) => void;

interface BatchLoadTask {
  key: string;
  label: string;
  run: () => Promise<unknown>;
}

const MAIN_MENU_PIXI_URLS: readonly string[] = [
  'assets/ui/ocean.webp',
  'assets/ui/cloud.webp',
  'assets/ui/water.webp',
  'assets/ui/endoflame.webp',
  'assets/ui/beach.webp',
  'assets/ui/plantshadow.webp',
  'assets/ui/squalour.webp',
];

const MAIN_MENU_DOM_URLS: readonly string[] = [
  'assets/ui/woodsign1.webp',
  'assets/ui/woodsign2.webp',
  'assets/ui/woodsign3.webp',
  'assets/ui/peifang_1.webp',
  'assets/ui/peifang_2.webp',
  'assets/ui/peifang.webp',
  'assets/ui/grave.webp',
  'assets/ui/flower1.webp',
  'assets/ui/flower2.webp',
  'assets/ui/flower3.webp',
  'assets/ui/shadow_adventure.webp',
  'assets/ui/shadow_survival.webp',
  'assets/ui/shadow_challenge.webp',
  'assets/ui/shadow_zengarden.webp',
  'assets/ui/btn_adventure.webp',
  'assets/ui/btn_challenge.webp',
  'assets/ui/btn_iz.webp',
  'assets/ui/btn_survival.webp',
  'assets/ui/btn_travel.webp',
  'assets/ui/btn_almanac.webp',
  'assets/ui/btn_mysterious.webp',
  'assets/ui/btn_garden.webp',
  'assets/ui/btn_options.webp',
  'assets/ui/btn_help.webp',
  'assets/ui/btn_quit.webp',
  'assets/ui/buttonsmall.webp',
  'assets/ui/hotlevel_shadow.webp',
  'assets/ui/hotlevel_title.webp',
];

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(fallback);
      }
    }, ms);
    promise.then(
      (val) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(val);
        }
      },
      () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(fallback);
        }
      },
    );
  });
}

/**
 * Lazy, Promise-deduplicated loader and texture slicer for compiled PvZ Fusion 4.1 assets.
 * Only `catalog.json`, `audio_manifest.json`, and Main Menu visuals load at startup;
 * battle scenes, plant/zombie rigs, portraits, and Web Audio tracks stream on demand per level.
 */
class AssetLoader {
  private _catalog: CatalogData | null = null;
  private _audioManifest: AudioManifest | null = null;
  private _initPromise: Promise<void> | null = null;

  private readonly _texCache = new Map<string, Texture>();
  private readonly _texPromises = new Map<string, Promise<Texture | null>>();
  private readonly _rigCache = new Map<string, LoadedRig>();
  private readonly _rigPromises = new Map<string, Promise<LoadedRig | null>>();
  private readonly _domImgCache = new Set<string>();
  private readonly _domImgPromises = new Map<string, Promise<boolean>>();
  private _izLevelsCache: IzLevelEntry[] | null = null;
  private _restorePromise: Promise<void> | null = null;
  private _lastRestoreAt = 0;

  private async fetchJsonWithProgress<T>(
    url: string,
    onBytes?: (loaded: number, total: number) => void,
  ): Promise<T> {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to fetch ${url} (${res.status})`);
    }
    const contentLength = Number(res.headers.get('content-length') || 0);
    const reader = res.body?.getReader();
    if (!reader) {
      return (await res.json()) as T;
    }
    const chunks: Uint8Array[] = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        received += value.byteLength;
        onBytes?.(received, contentLength);
      }
    }
    const totalLen = chunks.reduce((acc, c) => acc + c.byteLength, 0);
    const merged = new Uint8Array(totalLen);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const text = new TextDecoder().decode(merged);
    return JSON.parse(text) as T;
  }

  /** Initializes static catalog metadata & audio index once with streaming byte progress. */
  async init(onProgress?: AssetProgressCb): Promise<void> {
    if (this._catalog && this._audioManifest) {
      onProgress?.(1, '资源索引就绪');
      return;
    }
    if (this._initPromise) {
      return this._initPromise;
    }
    this._initPromise = (async () => {
      onProgress?.(0.05, '正在下载融合图鉴与配方索引...', '0 KB');
      const audioPromise = fetch('assets/data/audio_manifest.json')
        .then((r) => (r.ok ? (r.json() as Promise<AudioManifest>) : ({} as AudioManifest)))
        .catch(() => ({} as AudioManifest));

      const catalog = await this.fetchJsonWithProgress<CatalogData>(
        'assets/data/catalog.json',
        (loaded, total) => {
          if (total > 0) {
            const frac = Math.min(1, loaded / total);
            onProgress?.(
              0.08 + frac * 0.77,
              '正在下载融合图鉴与配方库...',
              `${formatBytes(loaded)} / ${formatBytes(total)}`,
            );
          } else {
            onProgress?.(
              0.45,
              '正在下载融合图鉴与配方库...',
              `已接收 ${formatBytes(loaded)}`,
            );
          }
        },
      );
      onProgress?.(0.88, '正在解析植物、僵尸与音频索引...');
      this._catalog = catalog;
      this._audioManifest = await audioPromise;
      onProgress?.(1, '资源索引就绪');
    })();
    return this._initPromise;
  }

  get catalog(): CatalogData {
    if (!this._catalog) {
      throw new Error('AssetLoader not initialized');
    }
    return this._catalog;
  }

  get audioManifest(): AudioManifest {
    return this._audioManifest ?? {};
  }

  getPlant(id: number): PlantDef | undefined {
    return this._catalog?.plants[String(id)];
  }

  getZombie(id: number): ZombieDef | undefined {
    return this._catalog?.zombies[String(id)];
  }

  getScene(id: number): SceneDef | undefined {
    return this._catalog?.scenes[String(id)] ?? this._catalog?.scenes['0'];
  }

  getExploreLevel(id: number): ExploreLevelDef | undefined {
    return this._catalog?.exploreLevels.find((l) => l.id === id);
  }

  getPlantPortraitUrl(id: number): string | null {
    const p = this.getPlant(id);
    if (p?.portrait) {
      return `assets/portraits/plants/${p.portrait}`;
    }
    return null;
  }

  getZombiePortraitUrl(id: number): string | null {
    const z = this.getZombie(id);
    if (z?.portrait) {
      return `assets/portraits/zombies/${z.portrait}`;
    }
    return null;
  }

  getBulletTextureUrl(logicalKey: string): string {
    const id = this._catalog?.bullets[logicalKey] ?? 0;
    return `assets/bullets/b_${id}.webp`;
  }

  /** Synchronously returns an already-loaded Texture if present in memory. */
  getCachedTexture(relUrl: string): Texture | undefined {
    return this._texCache.get(relUrl);
  }

  /** Returns whether a DOM <img> asset has already been decoded into browser cache. */
  isImageCached(relUrl: string): boolean {
    return this._domImgCache.has(relUrl);
  }

  /** Preloads & decodes a DOM image asset once so UI elements appear without pop-in. */
  preloadImage(relUrl: string, timeoutMs = 12000): Promise<boolean> {
    if (this._domImgCache.has(relUrl)) {
      return Promise.resolve(true);
    }
    const inflight = this._domImgPromises.get(relUrl);
    if (inflight) {
      return inflight;
    }
    const rawTask = new Promise<boolean>((resolve) => {
      const img = new Image();
      const finish = (ok: boolean) => {
        if (ok) this._domImgCache.add(relUrl);
        resolve(ok);
      };
      img.onload = () => {
        if (typeof img.decode === 'function') {
          img.decode().then(
            () => finish(true),
            () => finish(true),
          );
        } else {
          finish(true);
        }
      };
      img.onerror = () => finish(false);
      img.src = relUrl;
    });
    const guarded = withTimeout(rawTask, timeoutMs, false).finally(() => {
      this._domImgPromises.delete(relUrl);
    });
    this._domImgPromises.set(relUrl, guarded);
    return guarded;
  }

  private decodeHtmlImage(relUrl: string, timeoutMs = 15000): Promise<HTMLImageElement | null> {
    const raw = new Promise<HTMLImageElement | null>((resolve) => {
      const img = new Image();
      img.decoding = 'async';
      const finish = (ok: boolean) => {
        resolve(ok && img.naturalWidth > 0 ? img : null);
      };
      img.onload = () => {
        if (typeof img.decode === 'function') {
          img.decode().then(
            () => finish(true),
            () => finish(true),
          );
        } else {
          finish(true);
        }
      };
      img.onerror = () => finish(false);
      img.src = relUrl;
    });
    return withTimeout(raw, timeoutMs, null);
  }

  /**
   * Loads an image via a durable CPU-backed HTMLImageElement so PixiJS can cleanly
   * re-upload textures after browser tab switches or WebGL context loss.
   */
  loadTexture(relUrl: string): Promise<Texture | null> {
    const cached = this._texCache.get(relUrl);
    if (cached) {
      // Touch for LRU order
      this._texCache.delete(relUrl);
      this._texCache.set(relUrl, cached);
      return Promise.resolve(cached);
    }
    const inflight = this._texPromises.get(relUrl);
    if (inflight) {
      return inflight;
    }
    const task = (async (): Promise<Texture | null> => {
      try {
        const img = await this.decodeHtmlImage(relUrl);
        if (!img) {
          return null;
        }
        const src = new ImageSource({
          resource: img,
          alphaMode: 'premultiply-alpha-on-upload',
        });
        // PixiJS ImageSource defaults autoGarbageCollect to true inside its constructor;
        // pin cached textures explicitly since trimCaches() handles memory bounds.
        src.autoGarbageCollect = false;
        const tex = new Texture({ source: src });
        this._texCache.set(relUrl, tex);
        return tex;
      } catch {
        return null;
      } finally {
        this._texPromises.delete(relUrl);
      }
    })();
    this._texPromises.set(relUrl, task);
    return task;
  }

  /**
   * Restores and forces re-upload of all cached GPU textures after tab switches or
   * WebGL context restoration. Shared rig atlas sources automatically cover sub-frame sprites.
   */
  restoreAllTextures(force = false): Promise<void> {
    if (this._restorePromise) {
      return this._restorePromise;
    }
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (!force && now - this._lastRestoreAt < 120) {
      return Promise.resolve();
    }
    const job = (async () => {
      try {
        const entries = [...this._texCache.entries()];
        for (const [url, tex] of entries) {
          if (tex.destroyed || tex.source.destroyed) continue;
          const src = tex.source;
          const res = src.resource as unknown;
          if (res instanceof HTMLImageElement && res.complete && res.naturalWidth > 0) {
            if (typeof res.decode === 'function') {
              await res.decode().catch(() => {});
            }
          } else {
            const fresh = await this.decodeHtmlImage(url);
            if (fresh) {
              src.resource = fresh;
            }
          }
          src.autoGarbageCollect = false;
          try {
            src.unload();
          } catch {
            // Safe no-op if already unloaded or context lost
          }
        }
        this._lastRestoreAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
      } finally {
        this._restorePromise = null;
      }
    })();
    this._restorePromise = job;
    return job;
  }

  loadPlantRig(id: number): Promise<LoadedRig | null> {
    const p = this.getPlant(id);
    if (p && !p.hasRig) {
      return Promise.resolve(null);
    }
    return this._loadRig(`plant:${id}`, `assets/rigs/plants/p_${id}.json`);
  }

  loadZombieRig(id: number): Promise<LoadedRig | null> {
    const z = this.getZombie(id);
    if (z && !z.hasRig) {
      return Promise.resolve(null);
    }
    return this._loadRig(`zombie:${id}`, `assets/rigs/zombies/z_${id}.json`);
  }

  loadCommonRig(
    name: 'mower_lawn' | 'mower_pool' | 'mower_roof' | 'sun' | 'bigsun' | 'bluesun' | 'squalour',
  ): Promise<LoadedRig | null> {
    return this._loadRig(`common:${name}`, `assets/rigs/common/${name}.json`);
  }

  getCachedRig(key: string): LoadedRig | undefined {
    return this._rigCache.get(key);
  }

  private _loadRig(key: string, jsonUrl: string): Promise<LoadedRig | null> {
    const cached = this._rigCache.get(key);
    if (cached) {
      // Touch for LRU order
      this._rigCache.delete(key);
      this._rigCache.set(key, cached);
      return Promise.resolve(cached);
    }
    const inflight = this._rigPromises.get(key);
    if (inflight) {
      return inflight;
    }
    const task = (async (): Promise<LoadedRig | null> => {
      try {
        const res = await fetch(jsonUrl);
        if (!res.ok) {
          return null;
        }
        const data = (await res.json()) as RigData;
        const atlasTex = await this.loadTexture(data.atlas);
        if (!atlasTex) {
          return null;
        }
        const spriteTextures = data.sprites.map(
          (sp) =>
            new Texture({
              source: atlasTex.source,
              frame: new Rectangle(sp.x, sp.y, sp.w, sp.h),
            }),
        );
        const animatedSpNodes = new Set<number>();
        for (const clip of Object.values(data.clips)) {
          for (const [nidStr, track] of Object.entries(clip.tracks)) {
            if (track.sp && track.sp.length > 0) {
              animatedSpNodes.add(Number(nidStr));
            }
          }
        }
        const loaded: LoadedRig = {
          key,
          data,
          atlasTexture: atlasTex,
          spriteTextures,
          animatedSpNodes,
        };
        this._rigCache.set(key, loaded);
        return loaded;
      } catch {
        return null;
      } finally {
        this._rigPromises.delete(key);
      }
    })();
    this._rigPromises.set(key, task);
    return task;
  }

  async loadIzLevels(): Promise<IzLevelEntry[]> {
    if (this._izLevelsCache) {
      return this._izLevelsCache;
    }
    try {
      const res = await fetch('assets/data/iz_levels.json');
      if (!res.ok) {
        return [];
      }
      this._izLevelsCache = (await res.json()) as IzLevelEntry[];
      return this._izLevelsCache;
    } catch {
      return [];
    }
  }

  private async runBatchWithProgress(
    tasks: BatchLoadTask[],
    onProgress?: AssetProgressCb,
    concurrency = 6,
  ): Promise<void> {
    const deduped: BatchLoadTask[] = [];
    const seen = new Set<string>();
    for (const t of tasks) {
      if (!seen.has(t.key)) {
        seen.add(t.key);
        deduped.push(t);
      }
    }
    const total = deduped.length;
    if (total === 0) {
      onProgress?.(1, '所需资源已缓存就绪', '0 / 0');
      return;
    }
    let cursor = 0;
    let done = 0;
    onProgress?.(0, deduped[0].label, `0 / ${total}`);

    const worker = async () => {
      while (true) {
        const idx = cursor++;
        if (idx >= total) break;
        const item = deduped[idx];
        await withTimeout(item.run(), 15000, null);
        done++;
        onProgress?.(done / total, item.label, `${done} / ${total}`);
      }
    };

    const workerCount = Math.min(concurrency, total);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
  }

  hasUncachedMainMenuAssets(): boolean {
    return (
      MAIN_MENU_PIXI_URLS.some((u) => !this._texCache.has(u)) ||
      MAIN_MENU_DOM_URLS.some((u) => !this._domImgCache.has(u))
    );
  }

  /** Preloads ONLY Main Menu assets on demand (zero battle backgrounds or entity rigs). */
  async preloadMainMenuAssets(onProgress?: AssetProgressCb): Promise<void> {
    const tasks: BatchLoadTask[] = [];
    for (const url of MAIN_MENU_PIXI_URLS) {
      if (!this._texCache.has(url)) {
        tasks.push({ key: `tex:${url}`, label: '正在加载主菜单贴图...', run: () => this.loadTexture(url) });
      }
    }
    for (const url of MAIN_MENU_DOM_URLS) {
      if (!this._domImgCache.has(url)) {
        tasks.push({ key: `dom:${url}`, label: '正在加载主菜单界面...', run: () => this.preloadImage(url) });
      }
    }
    await this.runBatchWithProgress(tasks, onProgress, 6);
  }

  /** Returns uncached plant IDs that actually have animated rigs. */
  getUncachedPlantRigIds(plantIds: number[]): number[] {
    const out: number[] = [];
    const seen = new Set<number>();
    for (const pid of plantIds) {
      if (seen.has(pid)) continue;
      seen.add(pid);
      const p = this.getPlant(pid);
      if (p && !p.hasRig) continue;
      if (!this._rigCache.has(`plant:${pid}`)) {
        out.push(pid);
      }
    }
    return out;
  }

  /** Preloads ONLY the specified uncached plant rigs (and their portraits) with live progress. */
  async preloadPlantRigs(plantIds: number[], onProgress?: AssetProgressCb): Promise<void> {
    const tasks: BatchLoadTask[] = [];
    for (const pid of plantIds) {
      const p = this.getPlant(pid);
      const name = p?.name ?? `植物 #${pid}`;
      if ((!p || p.hasRig) && !this._rigCache.has(`plant:${pid}`)) {
        tasks.push({
          key: `prig:${pid}`,
          label: `正在加载植物动画：${name}`,
          run: () => this.loadPlantRig(pid),
        });
      }
      if (p?.portrait) {
        const portUrl = `assets/portraits/plants/${p.portrait}`;
        if (!this._domImgCache.has(portUrl)) {
          tasks.push({
            key: `dom:${portUrl}`,
            label: `正在加载植物头像：${name}`,
            run: () => this.preloadImage(portUrl),
          });
        }
      }
    }
    await this.runBatchWithProgress(tasks, onProgress, 6);
  }

  /**
   * Strictly on-demand level loader: loads ONLY the active scene background, active row mowers,
   * mode props, HUD images, initial plant rigs, and allowed zombie rigs for the chosen level.
   */
  async preloadLevelEntryAssets(opts: {
    config: BoardConfig;
    initialPlantIds: number[];
    zombieIds: number[];
    skipSeedChooser: boolean;
    needGraves: boolean;
    visiblePortraitPlantIds?: number[];
    unlockedTools?: Partial<UnlockedToolsState>;
    onProgress?: AssetProgressCb;
  }): Promise<void> {
    const { config, initialPlantIds, zombieIds, skipSeedChooser, needGraves } = opts;
    const tasks: BatchLoadTask[] = [];
    const addTex = (url: string, label: string) => {
      if (!this._texCache.has(url)) {
        tasks.push({ key: `tex:${url}`, label, run: () => this.loadTexture(url) });
      }
    };
    const addDom = (url: string, label: string) => {
      if (!this._domImgCache.has(url)) {
        tasks.push({ key: `dom:${url}`, label, run: () => this.preloadImage(url) });
      }
    };
    const addCommon = (
      name: 'mower_lawn' | 'mower_pool' | 'mower_roof' | 'sun' | 'bigsun' | 'bluesun' | 'squalour',
      label: string,
    ) => {
      if (!this._rigCache.has(`common:${name}`)) {
        tasks.push({ key: `crig:${name}`, label, run: () => this.loadCommonRig(name) });
      }
    };

    // 1. Active scene background & fog
    addTex(`assets/bg/${config.scene.bg}`, `正在加载场景：${config.scene.label}`);
    if (config.scene.fog) {
      addTex('assets/bg/fog_1680x190.webp', '正在加载迷雾特效...');
    }

    // 2. Scene-specific row mowers only
    const skipMowers =
      config.mode === 'iz' ||
      config.mode === 'vasebreaker' ||
      config.mode === 'tower' ||
      (config.mode === 'explore' && config.prePlants.length > 0 && Boolean(config.conveyorMode));
    if (!skipMowers) {
      const rows = config.scene.rows || 5;
      const waterSet = new Set(config.scene.waterRows);
      let hasLandRow = false;
      for (let r = 0; r < rows; r++) {
        if (!waterSet.has(r)) {
          hasLandRow = true;
          break;
        }
      }
      if (hasLandRow && !config.scene.roof) addCommon('mower_lawn', '正在加载草坪割草机...');
      if (waterSet.size > 0) addCommon('mower_pool', '正在加载泳池清理车...');
      if (hasLandRow && config.scene.roof) addCommon('mower_roof', '正在加载屋顶清扫车...');
    }

    // 3. Mode-specific textures
    if (config.mode === 'iz') addTex('assets/ui/brain.webp', '正在加载脑子目标贴图...');
    if (config.vasebreakerConfig) {
      addTex('assets/ui/modes/scary_pot_0.webp', '正在加载罐子贴图...');
      addTex('assets/ui/modes/scary_pot_3.webp', '正在加载罐子贴图...');
      addTex('assets/ui/modes/scary_pot_4.webp', '正在加载罐子贴图...');
    }
    if (needGraves) {
      addTex('assets/ui/modes/grave_0.webp', '正在加载墓碑贴图...');
      addTex('assets/ui/modes/grave_1.webp', '正在加载墓碑贴图...');
      addTex('assets/ui/modes/grave_2.webp', '正在加载墓碑贴图...');
      addTex('assets/ui/modes/grave_3.webp', '正在加载墓碑贴图...');
    }
    if (config.towerConfig) {
      addTex('assets/ui/modes/tower_bush.webp', '正在加载塔防路线贴图...');
      addTex('assets/ui/modes/tower_tree.webp', '正在加载塔防路线贴图...');
    }

    // 4. Shared battle core rigs, banners, bullets, and HUD DOM images
    addCommon('sun', '正在加载阳光与战斗界面...');
    addCommon('bigsun', '正在加载阳光与战斗界面...');
    addCommon('bluesun', '正在加载阳光与战斗界面...');
    for (const u of [
      'assets/bullets/sun.webp',
      'assets/bullets/bigsun.webp',
      'assets/bullets/bluesun.webp',
      'assets/bullets/shadow.webp',
      'assets/ui/start_ready.webp',
      'assets/ui/start_set.webp',
      'assets/ui/start_plant.webp',
      'assets/ui/hugewave.webp',
      'assets/ui/finalwave.webp',
      'assets/ui/grave.webp',
      'assets/ui/crater.webp',
    ]) {
      addTex(u, '正在加载战斗特效与提示贴图...');
    }
    if (this._catalog) {
      const seenB = new Set<number>();
      for (const bid of Object.values(this._catalog.bullets)) {
        if (!seenB.has(bid)) {
          seenB.add(bid);
          addTex(`assets/bullets/b_${bid}.webp`, '正在加载子弹贴图...');
        }
      }
    }

    const hudDomUrls = [
      'assets/ui/seed_bank.webp',
      'assets/ui/shovel_bank.webp',
      'assets/ui/shovel.webp',
      'assets/ui/flagmeter_empty.webp',
      'assets/ui/flagmeter_full.webp',
      'assets/ui/flagmeter_flag.webp',
      'assets/ui/flagmeter_head.webp',
      'assets/ui/buttonsmall.webp',
    ];
    if (!skipSeedChooser) {
      hudDomUrls.push('assets/ui/seed_chooser_bg.webp', 'assets/ui/seed_chooser_btn.webp');
    }
    if (config.conveyorMode) {
      hudDomUrls.push('assets/ui/conveyor_backdrop.webp', 'assets/ui/conveyor_belt.webp');
    }
    if (opts.unlockedTools?.glove) hudDomUrls.push('assets/ui/glove.webp');
    if (opts.unlockedTools?.hammer) hudDomUrls.push('assets/ui/modes/hammer.webp');
    if (opts.unlockedTools?.wheelbarrow) hudDomUrls.push('assets/ui/modes/wheelbarrow.webp');
    if (opts.unlockedTools?.fertilizer) hudDomUrls.push('assets/ui/modes/fertilizer_lv2.webp');
    for (const u of hudDomUrls) {
      addDom(u, '正在加载战斗栏 UI...');
    }

    // 5. Level plant rigs & visible portraits
    const seenP = new Set<number>();
    for (const pid of initialPlantIds) {
      if (seenP.has(pid)) continue;
      seenP.add(pid);
      const p = this.getPlant(pid);
      if ((!p || p.hasRig) && !this._rigCache.has(`plant:${pid}`)) {
        tasks.push({
          key: `prig:${pid}`,
          label: `正在加载植物动画：${p?.name ?? `#${pid}`}`,
          run: () => this.loadPlantRig(pid),
        });
      }
      if (p?.portrait) {
        addDom(`assets/portraits/plants/${p.portrait}`, `正在加载植物头像：${p.name}`);
      }
    }
    for (const pid of (opts.visiblePortraitPlantIds ?? []).slice(0, 24)) {
      const p = this.getPlant(pid);
      if (p?.portrait) {
        addDom(`assets/portraits/plants/${p.portrait}`, `正在加载选卡图标：${p.name}`);
      }
    }

    // 6. Level zombie rigs & portraits
    const seenZ = new Set<number>();
    for (const zid of zombieIds) {
      if (seenZ.has(zid)) continue;
      seenZ.add(zid);
      const z = this.getZombie(zid);
      if ((!z || z.hasRig) && !this._rigCache.has(`zombie:${zid}`)) {
        tasks.push({
          key: `zrig:${zid}`,
          label: `正在加载僵尸动画：${z?.name ?? `#${zid}`}`,
          run: () => this.loadZombieRig(zid),
        });
      }
      if (z?.portrait) {
        addDom(`assets/portraits/zombies/${z.portrait}`, `正在加载僵尸头像：${z.name}`);
      }
    }

    await this.runBatchWithProgress(tasks, opts.onProgress, 6);
  }

  /** Preloads ONLY the active greenhouse backdrop, pots, toolbar icons, and currently potted plant rigs. */
  async preloadZenGardenAssets(
    activeSceneTex: string,
    plantIds: number[],
    onProgress?: AssetProgressCb,
  ): Promise<void> {
    const tasks: BatchLoadTask[] = [];
    for (const u of [activeSceneTex, 'assets/ui/modes/gold_pot.webp', 'assets/ui/modes/silver_pot.webp']) {
      if (!this._texCache.has(u)) {
        tasks.push({ key: `tex:${u}`, label: '正在加载温室场景...', run: () => this.loadTexture(u) });
      }
    }
    for (const u of [
      'assets/ui/modes/watering_can.webp',
      'assets/ui/modes/watering_can_gold.webp',
      'assets/ui/adv/Fertilizer.webp',
      'assets/ui/modes/bug_spray.webp',
      'assets/ui/modes/phonograph.webp',
      'assets/ui/modes/zen_glove.webp',
      'assets/ui/modes/zen_money_sign.webp',
      'assets/ui/modes/coinbank.webp',
      'assets/ui/modes/coin_gold.webp',
      'assets/ui/modes/coin_silver.webp',
      'assets/ui/modes/diamond.webp',
      'assets/ui/modes/zen_next_garden.webp',
      'assets/ui/buttonsmall.webp',
    ]) {
      if (!this._domImgCache.has(u)) {
        tasks.push({ key: `dom:${u}`, label: '正在加载花园工具栏...', run: () => this.preloadImage(u) });
      }
    }
    for (const pid of plantIds) {
      const p = this.getPlant(pid);
      if ((!p || p.hasRig) && !this._rigCache.has(`plant:${pid}`)) {
        tasks.push({
          key: `prig:${pid}`,
          label: `正在加载花园植物：${p?.name ?? `#${pid}`}`,
          run: () => this.loadPlantRig(pid),
        });
      }
    }
    await this.runBatchWithProgress(tasks, onProgress, 6);
  }

  /** Preloads Almanac base backgrounds on demand before opening Almanac. */
  async preloadAlmanacAssets(onProgress?: AssetProgressCb): Promise<void> {
    const tasks: BatchLoadTask[] = [];
    for (const u of [
      'assets/ui/ground_day.webp',
      'assets/ui/ground_night.webp',
      'assets/ui/ground_pool.webp',
      'assets/ui/ground_roof.webp',
    ]) {
      if (!this._texCache.has(u)) {
        tasks.push({ key: `tex:${u}`, label: '正在加载图鉴展示台...', run: () => this.loadTexture(u) });
      }
    }
    if (!this._domImgCache.has('assets/ui/almanac_index_bg.webp')) {
      tasks.push({
        key: 'dom:assets/ui/almanac_index_bg.webp',
        label: '正在加载图鉴索引界面...',
        run: () => this.preloadImage('assets/ui/almanac_index_bg.webp'),
      });
    }
    await this.runBatchWithProgress(tasks, onProgress, 6);
  }

  /** Backward-compatible helper delegating to minimal battle preloading. */
  async preloadBattleAssets(
    plantIds: number[],
    zombieIds: number[],
    sceneBg: string,
  ): Promise<void> {
    const tasks: BatchLoadTask[] = [
      ...plantIds.map((pid) => ({
        key: `prig:${pid}`,
        label: '正在加载植物动画...',
        run: () => this.loadPlantRig(pid),
      })),
      ...zombieIds.map((zid) => ({
        key: `zrig:${zid}`,
        label: '正在加载僵尸动画...',
        run: () => this.loadZombieRig(zid),
      })),
      { key: `tex:assets/bg/${sceneBg}`, label: '正在加载场景背景...', run: () => this.loadTexture(`assets/bg/${sceneBg}`) },
    ];
    await this.runBatchWithProgress(tasks, undefined, 6);
  }

  /**
   * LRU eviction keeping common rigs, UI/bullet textures, and retained rig atlases pinned
   * while bounding long-session WebGL VRAM growth.
   */
  trimCaches(maxRigs = 80, maxTextures = 160): void {
    const nonCommonKeys: string[] = [];
    for (const k of this._rigCache.keys()) {
      if (!k.startsWith('common:')) {
        nonCommonKeys.push(k);
      }
    }
    const rigExcess = nonCommonKeys.length - maxRigs;
    if (rigExcess > 0) {
      for (let i = 0; i < rigExcess; i++) {
        const key = nonCommonKeys[i];
        const rig = this._rigCache.get(key);
        this._rigCache.delete(key);
        if (rig) {
          for (const st of rig.spriteTextures) {
            st.destroy(false);
          }
          rig.atlasTexture.destroy(true);
          this._texCache.delete(rig.data.atlas);
        }
      }
    }

    if (this._texCache.size > maxTextures) {
      const pinnedUrls = new Set<string>();
      for (const rig of this._rigCache.values()) {
        pinnedUrls.add(rig.data.atlas);
      }
      for (const [url, tex] of [...this._texCache.entries()]) {
        if (this._texCache.size <= maxTextures) break;
        if (
          pinnedUrls.has(url) ||
          url.startsWith('assets/ui/') ||
          url.startsWith('assets/bullets/')
        ) {
          continue;
        }
        this._texCache.delete(url);
        tex.destroy(true);
      }
    }
  }
}

export const assets = new AssetLoader();
