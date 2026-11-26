import { ImageSource, Rectangle, Texture } from 'pixi.js';
import type {
  AudioManifest,
  CatalogData,
  ExploreLevelDef,
  IzLevelEntry,
  LoadedRig,
  PlantDef,
  RigData,
  SceneDef,
  ZombieDef,
} from '../types/game';

/**
 * Lazy, Promise-deduplicated loader and texture slicer for compiled PvZ Fusion 4.1 assets.
 * Only `catalog.json` and `audio_manifest.json` load at startup (~1.15 MB); rigs, portraits,
 * backgrounds, and Web Audio tracks stream on demand with bounded memory footprint.
 */
class AssetLoader {
  private _catalog: CatalogData | null = null;
  private _audioManifest: AudioManifest | null = null;
  private _initPromise: Promise<void> | null = null;

  private readonly _texCache = new Map<string, Texture>();
  private readonly _texPromises = new Map<string, Promise<Texture | null>>();
  private readonly _rigCache = new Map<string, LoadedRig>();
  private readonly _rigPromises = new Map<string, Promise<LoadedRig | null>>();
  private _izLevelsCache: IzLevelEntry[] | null = null;

  /** Initializes static catalog metadata & audio index once. */
  async init(onProgress?: (ratio: number, label: string) => void): Promise<void> {
    if (this._catalog && this._audioManifest) {
      onProgress?.(1, '就绪');
      return;
    }
    if (this._initPromise) {
      return this._initPromise;
    }
    this._initPromise = (async () => {
      onProgress?.(0.15, '正在加载融合图鉴与配方库...');
      const [catRes, audRes] = await Promise.all([
        fetch('assets/data/catalog.json'),
        fetch('assets/data/audio_manifest.json'),
      ]);
      if (!catRes.ok) {
        throw new Error(`Failed to fetch catalog.json (${catRes.status})`);
      }
      onProgress?.(0.55, '正在解析植物、僵尸与关卡数据...');
      this._catalog = (await catRes.json()) as CatalogData;
      this._audioManifest = audRes.ok ? ((await audRes.json()) as AudioManifest) : {};
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

  /** Loads an image into a GPU-backed PixiJS 8 Texture using createImageBitmap for low overhead. */
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
        const res = await fetch(relUrl);
        if (!res.ok) {
          return null;
        }
        const blob = await res.blob();
        let tex: Texture;
        if (typeof createImageBitmap === 'function') {
          const bmp = await createImageBitmap(blob);
          const src = new ImageSource({ resource: bmp, alphaMode: 'premultiply-alpha-on-upload' });
          tex = new Texture({ source: src });
        } else {
          const objUrl = URL.createObjectURL(blob);
          const img = new Image();
          img.src = objUrl;
          await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = () => reject(new Error(`Image decode failed: ${relUrl}`));
          });
          URL.revokeObjectURL(objUrl);
          tex = Texture.from(img);
        }
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

  /** Preloads rigs, bullets, common objects, and background for a smooth stutter-free level. */
  async preloadBattleAssets(
    plantIds: number[],
    zombieIds: number[],
    sceneBg: string,
  ): Promise<void> {
    const tasks: Promise<unknown>[] = [];
    const seenP = new Set<number>();
    for (const pid of plantIds) {
      if (!seenP.has(pid)) {
        seenP.add(pid);
        tasks.push(this.loadPlantRig(pid));
      }
    }
    const seenZ = new Set<number>();
    for (const zid of zombieIds) {
      if (!seenZ.has(zid)) {
        seenZ.add(zid);
        tasks.push(this.loadZombieRig(zid));
      }
    }
    tasks.push(
      this.loadCommonRig('mower_lawn'),
      this.loadCommonRig('mower_pool'),
      this.loadCommonRig('sun'),
      this.loadCommonRig('bigsun'),
      this.loadCommonRig('bluesun'),
      this.loadTexture(`assets/bg/${sceneBg}`),
      this.loadTexture('assets/bullets/sun.webp'),
      this.loadTexture('assets/bullets/bigsun.webp'),
      this.loadTexture('assets/bullets/bluesun.webp'),
      this.loadTexture('assets/bullets/shadow.webp'),
      this.loadTexture('assets/ui/start_ready.webp'),
      this.loadTexture('assets/ui/start_set.webp'),
      this.loadTexture('assets/ui/start_plant.webp'),
      this.loadTexture('assets/ui/hugewave.webp'),
      this.loadTexture('assets/ui/finalwave.webp'),
      this.loadTexture('assets/ui/grave.webp'),
      this.loadTexture('assets/ui/crater.webp'),
    );
    if (this._catalog) {
      const seenB = new Set<number>();
      for (const bid of Object.values(this._catalog.bullets)) {
        if (!seenB.has(bid)) {
          seenB.add(bid);
          tasks.push(this.loadTexture(`assets/bullets/b_${bid}.webp`));
        }
      }
    }
    await Promise.allSettled(tasks);
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
