import { assets } from '../assets/AssetLoader';
import { fusionSystem } from '../engine/FusionSystem';
import { isNormalCard } from '../save/plantUnlocks';
import { saveManager } from '../save/SaveManager';
import type { BoardConfig, ExploreLevelDef, IzLevelEntry, PlantDef, VaseSpec } from '../types/game';
import { getTowerDefenseLevels } from './towerCatalog';

export interface StarryChapterSpec {
  chapter: number;
  title: string;
  starTitle: string;
  sceneId: number;
  mainLevels: BoardConfig[];
  subLevels: BoardConfig[];
}

export interface ChallengeGroupSpec {
  key: 'classic' | 'unlock' | 'flags' | 'minigames' | 'snow' | 'vasebreaker' | 'tower';
  title: string;
  iconPlantId: number;
  sceneId: number;
  levels: BoardConfig[];
}

export interface SurvivalCardSpec {
  config: BoardConfig;
  iconPlantId: number;
  label: string;
  isEndless: boolean;
}

export interface SandboxCardSpec {
  sid: number;
  label: string;
  pid: number;
}

export interface ExploreBaseGroup {
  key: string;
  label: string;
  pids: number[];
}

/** 5 classic plant chapters whose base×base pairings cover all 204 Explore recipes. */
export const EXPLORE_BASE_GROUPS: ExploreBaseGroup[] = [
  { key: 'day', label: '白天', pids: [0, 1, 2, 3, 4, 5] },
  { key: 'night', label: '黑夜', pids: [6, 7, 8, 9, 10, 11] },
  { key: 'pool', label: '泳池', pids: [12, 13, 14, 15, 16, 17, 18] },
  { key: 'fog', label: '浓雾', pids: [19, 20, 21, 22, 23, 24, 25] },
  { key: 'roof', label: '屋顶', pids: [26, 27, 28, 29, 30, 31, 32] },
];

/** Converts Unity rich-text tips (`<size=...>`, `<color=...>`, `<u>`) to clean readable plain text. */
export function formatUnityRichText(raw?: string): string {
  if (!raw) return '';
  return raw
    .replace(/<size=[^>]*>|<\/size>/gi, '')
    .replace(/<color=[^>]*>|<\/color>/gi, '')
    .replace(/<\/?u>|<\/?b>|<\/?i>/gi, '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Returns clean display title for an `iz_levels.json` entry like `101CustomIZ1：光茵荏苒`. */
export function formatIzDisplayName(rawName: string): string {
  const cleaned = rawName.replace(/^\d{3}CustomIZ/i, '').replace(/^[：:]/, '').trim();
  return cleaned || rawName;
}

/** Extracts numeric sort order (`101..706`) from an IZ level filename. */
export function getIzSortOrder(rawName: string): number {
  const m = rawName.match(/^(\d+)/);
  return m ? Number(m[1]) : 9999;
}

function makeSceneConfig(
  mode: BoardConfig['mode'],
  levelKey: string,
  title: string,
  subtitle: string,
  sceneId: number,
  difficulty: number,
  opts: Partial<BoardConfig> = {},
): BoardConfig {
  const scene = assets.getScene(sceneId) ?? assets.getScene(0)!;
  return {
    mode,
    levelKey,
    title,
    subtitle,
    scene,
    initialSun: 150,
    maxWaves: 10,
    firstWaveDelay: 18,
    allowedZombies: [0, 2, 4, 7],
    prePlants: [],
    gloveCooldown: 10,
    difficulty,
    zombieHpMult: 1,
    zombieSpeedMult: 1,
    ...opts,
  };
}

/**
 * Authentic Starry Adventure campaign (`AdvantureMenu`):
 * 6 chapters × (6 Main Stages + 6 Side Quests) = 72 stages.
 */
export function getStarryAdventureChapters(difficulty: number): StarryChapterSpec[] {
  const defs: {
    ch: number;
    title: string;
    starTitle: string;
    sceneId: number;
    mainZombies: number[][];
    subSpecs: { name: string; waves: number; sun: number; zombies: number[]; preset?: number[]; hp?: number; spd?: number; tips: string }[];
  }[] = [
    {
      ch: 1,
      title: '第一章 · 白天草坪',
      starTitle: '星辉：白天',
      sceneId: 0,
      mainZombies: [
        [0, 2],
        [0, 2, 1],
        [0, 2, 3, 4],
        [0, 2, 3, 4, 5],
        [0, 2, 3, 4, 7, 8],
        [0, 2, 3, 4, 5, 7, 8, 23],
      ],
      subSpecs: [
        { name: '支线1 · 樱桃初试', waves: 10, sun: 250, zombies: [0, 2, 3, 4], preset: [0, 1, 2, 3, 1000, 1001], tips: '利用樱桃豌豆与爆裂防线快速清理路障与铁桶集群。' },
        { name: '支线2 · 坚果阵列', waves: 12, sun: 300, zombies: [0, 2, 4, 8, 9], preset: [0, 1, 3, 4, 1004, 1027], hp: 1.1, tips: '橄榄球与铁门来袭！用土豆坚果配合双发输出。' },
        { name: '支线3 · 礼盒惊喜', waves: 12, sun: 250, zombies: [0, 2, 3, 5, 21], preset: [0, 1, 2, 13, 16], tips: '读报二爷与套娃僵尸混编，备好窝瓜与樱桃。' },
        { name: '支线4 · 疾风骤雨', waves: 14, sun: 300, zombies: [0, 3, 4, 5, 9], spd: 1.15, tips: '撑杆与橄榄球移动加快，前排请及时补防。' },
        { name: '支线5 · 炽焰火线', waves: 14, sun: 350, zombies: [0, 2, 4, 8, 18, 23], preset: [0, 1, 14, 18, 1005], tips: '用火炬树桩点燃全线豌豆火力，拦截冰车。' },
        { name: '支线6 · 星辉白昼决战', waves: 16, sun: 400, zombies: [0, 2, 3, 4, 8, 9, 35], preset: [0, 1, 2, 3, 18, 1005], tips: '巨人僵尸首度登场！善用爆发融合与手套换位。' },
      ],
    },
    {
      ch: 2,
      title: '第二章 · 黑夜草坪',
      starTitle: '星辉：黑夜',
      sceneId: 1,
      mainZombies: [
        [0, 2, 5],
        [0, 2, 4, 5, 8],
        [0, 2, 4, 7, 8, 15],
        [0, 2, 4, 8, 15, 24],
        [0, 2, 4, 7, 15, 24, 23],
        [0, 2, 4, 7, 15, 24, 35],
      ],
      subSpecs: [
        { name: '支线1 · 孢子齐鸣', waves: 10, sun: 200, zombies: [0, 2, 5, 8], preset: [6, 7, 9, 31], tips: '黑夜无天降阳光，以免费小喷菇与大喷菇配合魅惑控场。' },
        { name: '支线2 · 魅惑狂欢', waves: 12, sun: 250, zombies: [0, 2, 4, 5, 9, 10], preset: [6, 7, 8, 3, 1012], tips: '舞王与橄榄球来袭，魅惑最强前排反戈一击！' },
        { name: '支线3 · 寒霜降临', waves: 12, sun: 250, zombies: [0, 2, 4, 15, 24], preset: [6, 7, 10, 1034, 1037], tips: '玩偶匣炸弹威胁大，用寒冰菇与冰喷减缓脚步。' },
        { name: '支线4 · 学者之夜', waves: 14, sun: 300, zombies: [0, 4, 8, 15, 24], preset: [6, 7, 8, 11, 25], tips: '学者僵尸护甲厚重，配合磁力与毁灭菇清理战线。' },
        { name: '支线5 · 暗夜极速', waves: 14, sun: 300, zombies: [0, 3, 5, 10, 24], spd: 1.15, tips: '撑杆舞王与小丑快速逼近，需稳固多线孢子网。' },
        { name: '支线6 · 星辉黑夜决战', waves: 16, sun: 400, zombies: [0, 4, 8, 15, 24, 35], tips: '黑夜终章支线，巨人领衔进攻，做好防爆准备。' },
      ],
    },
    {
      ch: 3,
      title: '第三章 · 泳池乐园',
      starTitle: '星辉：泳池',
      sceneId: 2,
      mainZombies: [
        [0, 2, 17],
        [0, 2, 4, 17, 19],
        [0, 2, 4, 17, 19, 1],
        [0, 2, 4, 17, 19, 20],
        [0, 2, 4, 7, 17, 19, 25],
        [0, 2, 4, 7, 17, 19, 20, 35],
      ],
      subSpecs: [
        { name: '支线1 · 睡莲涟漪', waves: 12, sun: 300, zombies: [0, 2, 11, 12, 17], preset: [1, 12, 13, 14, 15], tips: '善用睡莲扩展水路阵地，缠绕水草克制潜水。' },
        { name: '支线2 · 海豚竞速', waves: 14, sun: 300, zombies: [0, 2, 13, 17, 19, 14], preset: [1, 12, 14, 15, 17], spd: 1.1, tips: '海豚骑士与机械海豚极快，水路请提前布防。' },
        { name: '支线3 · 火爆水浪', waves: 14, sun: 350, zombies: [0, 4, 17, 19, 20, 27], preset: [1, 12, 14, 16, 18], tips: '三叉戟与白鲸骑士来势汹汹，融合火炬水路清场。' },
        { name: '支线4 · 三线交响', waves: 14, sun: 400, zombies: [0, 4, 9, 17, 19, 25], preset: [1, 12, 14, 18, 22], tips: '兼顾气球僵尸防空与水路多行覆盖。' },
        { name: '支线5 · 地刺钢铁', waves: 16, sun: 350, zombies: [0, 4, 16, 18, 19, 20], hp: 1.15, tips: '冰车与雪橇车出没，地刺系列是最可靠屏障。' },
        { name: '支线6 · 星辉泳池决战', waves: 16, sun: 450, zombies: [0, 4, 14, 19, 20, 27, 35], tips: '水陆全明星压境，请构筑完整究极/超级融合防线。' },
      ],
    },
    {
      ch: 4,
      title: '第四章 · 浓雾之夜',
      starTitle: '星辉：浓雾',
      sceneId: 3,
      mainZombies: [
        [0, 2, 17, 25],
        [0, 2, 4, 17, 24, 25],
        [0, 2, 4, 17, 19, 25, 28],
        [0, 2, 4, 8, 17, 24, 25, 29],
        [0, 2, 4, 7, 17, 25, 28, 32],
        [0, 2, 4, 15, 17, 25, 26, 36],
      ],
      subSpecs: [
        { name: '支线1 · 雾灯破晓', waves: 12, sun: 300, zombies: [0, 2, 17, 19, 25], preset: [6, 12, 19, 20, 21, 22], tips: '路灯花能驱散 3×3 浓雾，三叶草可吹散气球并短暂清雾。' },
        { name: '支线2 · 星夜流萤', waves: 14, sun: 300, zombies: [0, 4, 17, 25, 28], preset: [6, 12, 20, 22, 23, 24], tips: '注意矿工从后排掘进！用杨桃与南瓜守护后方。' },
        { name: '支线3 · 磁暴防空', waves: 14, sun: 350, zombies: [0, 4, 24, 25, 26, 29], preset: [6, 12, 20, 21, 25], tips: '飞艇与铁桶气球大量现身，强化对空火力与磁力吸铁。' },
        { name: '支线4 · 小丑惊魂', waves: 14, sun: 350, zombies: [0, 4, 15, 24, 28, 30], hp: 1.1, tips: '小丑王与矿工夹击，备好南瓜外壳与控场植物。' },
        { name: '支线5 · 迷雾深潜', waves: 16, sun: 400, zombies: [0, 4, 14, 17, 25, 26, 32], tips: '跳跳僵尸与机械海豚双路奇袭，保持防线层次。' },
        { name: '支线6 · 星辉浓雾决战', waves: 16, sun: 450, zombies: [0, 4, 15, 25, 26, 28, 36], tips: '浓雾终章，红眼巨人携手飞艇压境，全力迎战！' },
      ],
    },
    {
      ch: 5,
      title: '第五章 · 屋顶决战',
      starTitle: '星辉：屋顶',
      sceneId: 4,
      mainZombies: [
        [0, 2, 4, 32],
        [0, 2, 4, 32, 33],
        [0, 2, 4, 7, 32, 33],
        [0, 2, 4, 8, 31, 32, 33],
        [0, 2, 4, 7, 31, 33, 34],
        [0, 2, 4, 15, 26, 31, 35, 36],
      ],
      subSpecs: [
        { name: '支线1 · 屋檐投手', waves: 12, sun: 300, zombies: [0, 2, 4, 32, 33], preset: [1, 26, 27, 28, 30, 32], tips: '屋顶必须先种花盆！投手无视斜坡地形直接越过障碍。' },
        { name: '支线2 · 护伞奇兵', waves: 14, sun: 350, zombies: [0, 4, 31, 32, 33, 45], preset: [1, 26, 27, 28, 30, 32], tips: '蹦极与投篮车频发，用叶子保护伞保住核心阵列。' },
        { name: '支线3 · 大蒜分流', waves: 14, sun: 350, zombies: [0, 4, 29, 31, 33, 34], preset: [1, 27, 28, 29, 32], tips: '扶梯与瓜跳僵尸敏捷难缠，大蒜配合西瓜集中火力。' },
        { name: '支线4 · 重炮轰鸣', waves: 16, sun: 400, zombies: [0, 4, 15, 31, 33, 35], hp: 1.15, tips: '投篮车与巨人联手进攻，保护伞与高伤西瓜不可或缺。' },
        { name: '支线5 · 屋顶空降', waves: 16, sun: 400, zombies: [0, 4, 26, 31, 34, 45], spd: 1.1, tips: '空中飞艇与蹦极双重空降压迫防线。' },
        { name: '支线6 · 星辉屋顶决战', waves: 16, sun: 500, zombies: [0, 4, 15, 21, 31, 35, 36, 39], tips: '屋顶终战！红眼机械巨人统帅精锐压上天台。' },
      ],
    },
    {
      ch: 6,
      title: '第六章 · 极寒雪原',
      starTitle: '星辉：雪原',
      sceneId: 18,
      mainZombies: [
        [0, 2, 84, 51],
        [0, 4, 84, 49, 50],
        [0, 4, 16, 18, 49, 55],
        [0, 4, 16, 18, 47, 56],
        [0, 4, 18, 35, 38, 56],
        [0, 4, 18, 21, 26, 36, 39],
      ],
      subSpecs: [
        { name: '支线1 · 云杉初露', waves: 12, sun: 350, zombies: [0, 2, 84, 51, 55], preset: [1, 35, 36, 38, 39, 40], tips: '雪原新植物云杉弓手与冬笋路障协防冰原僵尸。' },
        { name: '支线2 · 松炉融雪', waves: 14, sun: 350, zombies: [0, 4, 49, 50, 55, 62], preset: [1, 35, 36, 18, 1223], tips: '小松炉可悬空提供热力与火力支援！' },
        { name: '支线3 · 冰车狂潮', waves: 14, sun: 400, zombies: [0, 4, 16, 18, 47, 53], preset: [1, 17, 36, 39, 40], tips: '雪橇车与雪人飞碟来袭，地刺与雪棘草防线顶住！' },
        { name: '支线4 · 雪兽咆哮', waves: 16, sun: 450, zombies: [0, 4, 47, 56, 57, 62], hp: 1.15, tips: '雪兽王带领极寒兽群强袭，务必备好穿甲火力。' },
        { name: '支线5 · 冰河风暴', waves: 16, sun: 450, zombies: [0, 4, 18, 38, 53, 57], spd: 1.15, tips: '高机动雪原精锐部队连番冲击，小心减员。' },
        { name: '支线6 · 星辉雪原决战', waves: 16, sun: 550, zombies: [0, 4, 18, 21, 36, 39, 228], tips: '极寒终极挑战！究极雪原女皇携巨人部队总攻！' },
      ],
    },
  ];

  return defs.map((d) => {
    const mainLevels: BoardConfig[] = d.mainZombies.map((zList, sIdx) => {
      const waves = 6 + sIdx * 2 + (d.ch > 2 ? 2 : 0);
      return makeSceneConfig(
        'adventure',
        `star-main-${d.ch}-${sIdx + 1}`,
        `${d.starTitle} · 第${sIdx + 1}关`,
        `${d.title} 主线第 ${sIdx + 1} 关 · 共 ${waves} 波`,
        d.sceneId,
        difficulty,
        {
          initialSun: d.ch >= 5 ? 250 : 150,
          maxWaves: Math.min(18, waves),
          firstWaveDelay: 18,
          allowedZombies: zList,
          starMainKey: `star-main-${d.ch}-${sIdx + 1}`,
        },
      );
    });

    const subLevels: BoardConfig[] = d.subSpecs.map((sub, sIdx) =>
      makeSceneConfig(
        'adventure',
        `star-sub-${d.ch}-${sIdx + 1}`,
        `${d.starTitle} · ${sub.name}`,
        `${d.title} 支线第 ${sIdx + 1} 关 · 共 ${sub.waves} 波`,
        d.sceneId,
        difficulty,
        {
          initialSun: sub.sun,
          maxWaves: sub.waves,
          firstWaveDelay: 16,
          allowedZombies: sub.zombies,
          presetCards: sub.preset,
          zombieHpMult: sub.hp ?? 1,
          zombieSpeedMult: sub.spd ?? 1,
          tips: sub.tips,
          starSubKey: `star-sub-${d.ch}-${sIdx + 1}`,
        },
      ),
    );

    return {
      chapter: d.ch,
      title: d.title,
      starTitle: d.starTitle,
      sceneId: d.sceneId,
      mainLevels,
      subLevels,
    };
  });
}

export interface StarAdvCardVisual {
  groundSceneId: number;
  icon: string;
  stars?: number;
}

/**
 * Exact 1:1 Unity `AdvantureMenu` Page1..Page6 visual ground & icon metadata.
 * `groundSceneId` maps Unity thumbnail backgrounds (`0`=Day, `1`=Night, `2`=Pool,
 * `3`=NightPool, `4`=Roof, `18`=Snow).
 */
export const STAR_ADV_PAGE_CARDS: Record<
  number,
  { main: StarAdvCardVisual[]; sub: StarAdvCardVisual[] }
> = {
  0: {
    main: [
      { groundSceneId: 0, icon: 'PeaShooter' },
      { groundSceneId: 0, icon: 'SunFlower' },
      { groundSceneId: 0, icon: 'CherryBomb' },
      { groundSceneId: 0, icon: 'WallNut' },
      { groundSceneId: 0, icon: 'PotatoMine' },
      { groundSceneId: 0, icon: 'Chomper' },
    ],
    sub: [
      { groundSceneId: 0, icon: 'WallNut', stars: 1 },
      { groundSceneId: 0, icon: 'PeaShooterZombie', stars: 2 },
      { groundSceneId: 0, icon: 'SunFlower', stars: 3 },
      { groundSceneId: 0, icon: 'Present', stars: 3 },
      { groundSceneId: 0, icon: 'CherryPaperZombie', stars: 4 },
      { groundSceneId: 0, icon: 'DollDiamond', stars: 5 },
    ],
  },
  1: {
    main: [
      { groundSceneId: 1, icon: 'SmallPuff' },
      { groundSceneId: 1, icon: 'FumeShroom' },
      { groundSceneId: 1, icon: 'HypnoShroom' },
      { groundSceneId: 1, icon: 'ScaredyShroom' },
      { groundSceneId: 1, icon: 'IceShroom' },
      { groundSceneId: 1, icon: 'DoomShroom' },
    ],
    sub: [
      { groundSceneId: 1, icon: 'Hammer', stars: 1 },
      { groundSceneId: 1, icon: 'DancePolZombie', stars: 2 },
      { groundSceneId: 1, icon: 'ZombieNoteSmall', stars: 3 },
      { groundSceneId: 1, icon: 'PresentZ', stars: 3 },
      { groundSceneId: 1, icon: 'JacksonZombie', stars: 4 },
      { groundSceneId: 1, icon: 'ElitePaperZombie', stars: 5 },
    ],
  },
  2: {
    main: [
      { groundSceneId: 2, icon: 'LilyPad_body' },
      { groundSceneId: 0, icon: 'Squash' },
      { groundSceneId: 0, icon: 'ThreePeater' },
      { groundSceneId: 2, icon: 'Tanglekelp' },
      { groundSceneId: 0, icon: 'Jalapeno' },
      { groundSceneId: 0, icon: 'Caltrop' },
    ],
    sub: [
      { groundSceneId: 0, icon: 'FootballZombie', stars: 1 },
      { groundSceneId: 0, icon: 'Dolphinrider', stars: 2 },
      { groundSceneId: 0, icon: 'TorchWood', stars: 3 },
      { groundSceneId: 0, icon: 'ZombieNoteSmall', stars: 3 },
      { groundSceneId: 0, icon: 'DriverZombie', stars: 4 },
      { groundSceneId: 0, icon: 'SnowDolphinrider', stars: 5 },
    ],
  },
  3: {
    main: [
      { groundSceneId: 3, icon: 'seashroom' },
      { groundSceneId: 1, icon: 'Plantern' },
      { groundSceneId: 1, icon: 'Cactus' },
      { groundSceneId: 1, icon: 'Blover' },
      { groundSceneId: 1, icon: 'Starfruit' },
      { groundSceneId: 1, icon: 'Pumpkin' },
    ],
    sub: [
      { groundSceneId: 3, icon: 'SeaLantern', stars: 1 },
      { groundSceneId: 1, icon: 'BalloonZombie', stars: 2 },
      { groundSceneId: 1, icon: 'Magnetshroom', stars: 3 },
      { groundSceneId: 1, icon: 'ZombieNoteSmall', stars: 3 },
      { groundSceneId: 1, icon: 'JackboxZombie', stars: 4 },
      { groundSceneId: 1, icon: 'SuperJackboxZombie', stars: 5 },
    ],
  },
  4: {
    main: [
      { groundSceneId: 0, icon: 'Cabbagepult' },
      { groundSceneId: 4, icon: 'Pot' },
      { groundSceneId: 0, icon: 'Cornpult' },
      { groundSceneId: 0, icon: 'Garlic' },
      { groundSceneId: 0, icon: 'Umbrellaleaf' },
      { groundSceneId: 0, icon: 'Marigold' },
    ],
    sub: [
      { groundSceneId: 0, icon: 'BungiZombie', stars: 1 },
      { groundSceneId: 0, icon: 'CatapultZombie', stars: 2 },
      { groundSceneId: 0, icon: 'Melonpult', stars: 3 },
      { groundSceneId: 0, icon: 'ZombieNoteSmall', stars: 3 },
      { groundSceneId: 0, icon: 'Gargantuar', stars: 4 },
      { groundSceneId: 0, icon: 'RedGargantuar', stars: 5 },
    ],
  },
  5: {
    main: [
      { groundSceneId: 18, icon: 'PineFurnace' },
      { groundSceneId: 18, icon: 'SpruceShooter' },
      { groundSceneId: 18, icon: 'Shulkflower' },
      { groundSceneId: 18, icon: 'IceLotus' },
      { groundSceneId: 18, icon: 'WaterAloes' },
      { groundSceneId: 18, icon: 'Bamboo' },
    ],
    sub: [
      { groundSceneId: 18, icon: 'SpruceShooter', stars: 1 },
      { groundSceneId: 18, icon: 'SunFlower', stars: 2 },
      { groundSceneId: 18, icon: 'PenguinZombie', stars: 3 },
      { groundSceneId: 18, icon: 'ZombieNoteSmall', stars: 3 },
      { groundSceneId: 18, icon: 'UltimateSnowZombie', stars: 4 },
      { groundSceneId: 18, icon: 'SnowGunZombie', stars: 5 },
    ],
  },
};

/** Exact 1:1 Unity `PageAdvantureLevel` visual ground & icon metadata for Lv1..Lv45. */
export const CLASSIC_ADV_CARD_META: { groundSceneId: number; icon: string }[] = [
  // Page 1 (1..18)
  { groundSceneId: 0, icon: 'PeaShooter' },
  { groundSceneId: 0, icon: 'CherryBomb' },
  { groundSceneId: 0, icon: 'WallNut' },
  { groundSceneId: 0, icon: 'Zen_GardenGlove' },
  { groundSceneId: 0, icon: 'PotatoMine' },
  { groundSceneId: 0, icon: 'Chomper' },
  { groundSceneId: 0, icon: 'Present' },
  { groundSceneId: 0, icon: 'Zombie_bucket1' },
  { groundSceneId: 0, icon: 'Tallnut_body' },
  { groundSceneId: 1, icon: 'SmallPuff' },
  { groundSceneId: 1, icon: 'FumeShroom' },
  { groundSceneId: 1, icon: 'HypnoShroom' },
  { groundSceneId: 1, icon: 'Fertilizer' },
  { groundSceneId: 1, icon: 'ScaredyShroom' },
  { groundSceneId: 1, icon: 'IceShroom' },
  { groundSceneId: 1, icon: 'DoomShroom' },
  { groundSceneId: 1, icon: 'PresentZ' },
  { groundSceneId: 1, icon: 'GloomShroom' },
  // Page 2 (19..36)
  { groundSceneId: 2, icon: 'LilyPad_body' },
  { groundSceneId: 0, icon: 'Squash' },
  { groundSceneId: 0, icon: 'ThreePeater' },
  { groundSceneId: 2, icon: 'Tanglekelp' },
  { groundSceneId: 0, icon: 'Jalapeno' },
  { groundSceneId: 0, icon: 'Caltrop' },
  { groundSceneId: 0, icon: 'TorchWood' },
  { groundSceneId: 0, icon: 'SpikeRock' },
  { groundSceneId: 0, icon: 'ZombieNoteSmall' },
  { groundSceneId: 3, icon: 'SeaShroom' },
  { groundSceneId: 1, icon: 'Plantern' },
  { groundSceneId: 0, icon: 'Cactus' },
  { groundSceneId: 0, icon: 'Hammer' },
  { groundSceneId: 0, icon: 'Blover' },
  { groundSceneId: 0, icon: 'Starfruit' },
  { groundSceneId: 0, icon: 'Pumpkin' },
  { groundSceneId: 1, icon: 'Magnetshroom' },
  { groundSceneId: 0, icon: 'ZombieNoteSmall' },
  // Page 3 (37..45)
  { groundSceneId: 0, icon: 'Cabbagepult' },
  { groundSceneId: 4, icon: 'Pot' },
  { groundSceneId: 0, icon: 'Cornpult' },
  { groundSceneId: 0, icon: 'Garlic' },
  { groundSceneId: 0, icon: 'Umbrellaleaf' },
  { groundSceneId: 0, icon: 'Marigold' },
  { groundSceneId: 0, icon: 'Melonpult' },
  { groundSceneId: 0, icon: 'CobCannon' },
  { groundSceneId: 0, icon: 'ZombieNoteSmall' },
];

/**
 * 14 Starry Challenge stages matching Unity `AdvantureMenu2` prefab (`43430`):
 * Row 1: 随机模式, 僵尸海, 你能挖掉它吗, 你挖不掉它, 别踩红线, 随机挑战
 * Row 2: 究极樱桃射手, 究极樱桃战神, 超级随机模式, 究极大喷菇, 星辉无尽：泳池, 究极杨桃大帝
 * Row 3: 究极忧郁菇, 究极投手
 */
export function getStarChallengeLevels(
  difficulty: number,
): { config: BoardConfig; label: string; iconPlantId: number; iconName: string; groundSceneId: number }[] {
  const poolZ = [0, 2, 4, 5, 7, 8, 9, 15, 17, 19, 21, 24, 25, 26, 35, 36];
  const dayZ = [0, 2, 3, 4, 5, 7, 8, 9, 15, 21, 24, 35];
  const specs: {
    key: string;
    label: string;
    sid: number;
    groundSceneId: number;
    pid: number;
    iconName: string;
    sun: number;
    waves: number;
    zombies: number[];
    preset?: number[];
    hp?: number;
    spd?: number;
    endless?: boolean;
    wavesPerRound?: number;
    tips: string;
  }[] = [
    { key: 'sc-random', label: '随机模式', sid: 0, groundSceneId: 0, pid: 23, iconName: 'Present', sun: 350, waves: 16, zombies: dayZ, tips: '混合高阶僵尸随机波次，请灵活使用融合阵容应对。' },
    { key: 'sc-horde', label: '僵尸海', sid: 0, groundSceneId: 0, pid: 16, iconName: 'RedGargantuar', sun: 500, waves: 20, zombies: [0, 2, 3, 4, 5, 8, 9, 23], spd: 1.15, tips: '超密集尸潮！善用范围溅射与樱桃/辣椒融合清场。' },
    { key: 'sc-grave', label: '你能挖掉它吗', sid: 1, groundSceneId: 1, pid: 11, iconName: 'Gravebuster', sun: 300, waves: 14, zombies: [0, 2, 4, 8, 15, 24], preset: [6, 7, 8, 11, 1012, 1026], tips: '夜幕厚甲战线，多路孢子与毁灭系配合突破。' },
    { key: 'sc-pit', label: '你挖不掉它', sid: 1, groundSceneId: 3, pid: 3, iconName: 'seashroom', sun: 400, waves: 14, zombies: [0, 4, 8, 9, 15, 35], preset: [6, 7, 3, 1027, 1039, 1151], hp: 1.2, tips: '防线耐久考验，高坚果系与持续输出缺一不可。' },
    { key: 'sc-redline', label: '别踩红线', sid: 4, groundSceneId: 0, pid: 32, iconName: 'SuperPolevaulter', sun: 450, waves: 16, zombies: [0, 3, 4, 25, 31, 32, 33], spd: 1.2, tips: '跳跳与撑杆高速突进，守住前段防线！' },
    { key: 'sc-randchal', label: '随机挑战', sid: 3, groundSceneId: 0, pid: 22, iconName: 'Present', sun: 450, waves: 16, zombies: poolZ, tips: '浓雾水陆混合随机军团，兼顾照明、防空与水域控制。' },
    { key: 'sc-exp-gatling', label: '星辉体验\n究极樱桃射手', sid: 0, groundSceneId: 0, pid: 901, iconName: 'UltimateGatling', sun: 1000, waves: 14, zombies: [0, 4, 8, 9, 15, 35, 36], preset: [901, 1005, 1, 3, 18, 0, 2, 1052], hp: 1.3, tips: '体验「究极樱桃射手」的爆炸樱桃连射清场威力！' },
    { key: 'sc-exp-chomper', label: '星辉体验\n究极樱桃战神', sid: 0, groundSceneId: 0, pid: 903, iconName: 'UltimateChomper', sun: 1000, waves: 14, zombies: [0, 4, 8, 9, 21, 35, 36], preset: [903, 1013, 1, 3, 5, 2, 1005], hp: 1.3, tips: '体验「究极樱桃战神」前排承伤与吞噬反伤的统治力！' },
    { key: 'sc-superrand', label: '超级随机模式', sid: 2, groundSceneId: 0, pid: 14, iconName: 'Present', sun: 600, waves: 20, zombies: [...poolZ, 38, 39], hp: 1.25, tips: '全类型高阶与机械僵尸随机混编！' },
    { key: 'sc-exp-fume', label: '星辉体验\n究极大喷菇', sid: 1, groundSceneId: 1, pid: 904, iconName: 'FinalFume', sun: 1000, waves: 14, zombies: [0, 4, 8, 15, 24, 35, 36], preset: [904, 1046, 6, 7, 10, 11, 3], hp: 1.3, tips: '体验「究极大喷菇」全线穿透与冻结减速威能！' },
    { key: 'sc-pool-endless', label: '星辉无尽：泳池', sid: 2, groundSceneId: 2, pid: 14, iconName: 'LilyPad_body', sun: 600, waves: 10, zombies: poolZ, endless: true, wavesPerRound: 10, tips: '星辉无尽模式：每 10 波为一轮，轮间保留阵型并可重选卡牌！' },
    { key: 'sc-exp-star', label: '星辉体验\n究极杨桃大帝', sid: 3, groundSceneId: 1, pid: 909, iconName: 'UltimateStar', sun: 1000, waves: 14, zombies: poolZ, preset: [909, 1104, 1, 12, 20, 22, 23, 25], hp: 1.3, tips: '体验「究极杨桃大帝」五向星陨追击一切地面与空中目标！' },
    { key: 'sc-exp-gloom', label: '星辉体验\n究极忧郁菇', sid: 2, groundSceneId: 1, pid: 910, iconName: 'IceDoomGloom', sun: 1000, waves: 14, zombies: [0, 4, 14, 17, 19, 20, 35, 36], preset: [910, 1046, 1, 12, 7, 10, 24], hp: 1.3, tips: '体验「究极忧郁菇」范围高压孢子毁灭周遭尸潮！' },
    { key: 'sc-exp-melon', label: '星辉体验\n究极投手', sid: 4, groundSceneId: 1, pid: 914, iconName: 'UltimateMelon', sun: 1000, waves: 14, zombies: [0, 4, 15, 26, 31, 33, 35, 36], preset: [914, 1126, 1, 27, 26, 28, 30, 32], hp: 1.3, tips: '体验「究极投手」屋顶重炮倾泻与多重控制！' },
  ];

  return specs.map((s) => ({
    label: s.label,
    iconPlantId: s.pid,
    iconName: s.iconName,
    groundSceneId: s.groundSceneId,
    config: makeSceneConfig(
      'challenge',
      s.key,
      `星辉挑战 · ${s.label.replace(/\n/g, ' ')}`,
      s.endless ? '无尽轮次挑战 · 保留阵型重选卡' : `共 ${s.waves} 波 · 星辉试炼`,
      s.sid,
      difficulty,
      {
        initialSun: s.sun,
        maxWaves: s.waves,
        allowedZombies: s.zombies,
        presetCards: s.preset,
        zombieHpMult: s.hp ?? 1,
        zombieSpeedMult: s.spd ?? 1,
        endless: s.endless,
        wavesPerRound: s.wavesPerRound,
        tips: s.tips,
        challengeKey: s.key,
      },
    ),
  }));
}

/**
 * Classic 45-stage PvZ Campaign (`ChallengeMenu -> PageAdvantureLevel`):
 * 5 classic terrains × 9 stages (Lv1..Lv45).
 */
export function getClassicAdventureLevels(difficulty: number): BoardConfig[] {
  const terrains: { name: string; sid: number; z: number[][] }[] = [
    {
      name: '白天',
      sid: 0,
      z: [
        [0], [0, 2], [0, 2, 3], [0, 2, 3, 4], [0, 2, 4, 5],
        [0, 2, 3, 4, 5], [0, 2, 3, 4, 8], [0, 2, 4, 5, 8, 9], [0, 2, 4, 7, 8, 9, 23],
      ],
    },
    {
      name: '黑夜',
      sid: 1,
      z: [
        [0, 2], [0, 2, 5], [0, 2, 4, 5], [0, 2, 4, 8], [0, 2, 4, 8, 9],
        [0, 4, 8, 10, 15], [0, 4, 8, 15, 24], [0, 4, 7, 15, 24], [0, 4, 8, 15, 24, 35],
      ],
    },
    {
      name: '泳池',
      sid: 2,
      z: [
        [0, 2, 11, 17], [0, 2, 12, 17, 19], [0, 2, 4, 17, 19], [0, 2, 4, 13, 17, 19], [0, 4, 16, 17, 19],
        [0, 4, 17, 19, 20], [0, 4, 14, 17, 19, 20], [0, 4, 14, 19, 20, 25], [0, 4, 14, 19, 20, 27, 35],
      ],
    },
    {
      name: '浓雾',
      sid: 3,
      z: [
        [0, 2, 17, 25], [0, 2, 4, 17, 25], [0, 4, 17, 24, 25], [0, 4, 17, 25, 28], [0, 4, 17, 25, 28, 29],
        [0, 4, 19, 24, 25, 30], [0, 4, 15, 25, 26, 28], [0, 4, 15, 25, 26, 32], [0, 4, 15, 25, 26, 36],
      ],
    },
    {
      name: '屋顶',
      sid: 4,
      z: [
        [0, 2, 4, 32], [0, 2, 4, 32, 33], [0, 4, 31, 32, 33], [0, 4, 31, 33, 45], [0, 4, 29, 31, 33],
        [0, 4, 15, 31, 33, 34], [0, 4, 15, 26, 31, 35], [0, 4, 15, 26, 31, 35, 36], [0, 4, 15, 21, 31, 35, 36, 39],
      ],
    },
  ];

  const out: BoardConfig[] = [];
  let idx = 1;
  terrains.forEach((t, tIdx) => {
    t.z.forEach((zList, sIdx) => {
      const advNum = idx++;
      const waves = Math.min(18, 4 + sIdx * 2 + (tIdx >= 2 ? 2 : 0));
      out.push(
        makeSceneConfig(
          'adventure',
          `classic-adv-${advNum}`,
          `经典冒险 · 第${advNum}关 (${t.name})`,
          `经典第 ${tIdx + 1}-${sIdx + 1} 关 · 共 ${waves} 波`,
          t.sid,
          difficulty,
          {
            initialSun: advNum === 1 ? 150 : tIdx >= 4 ? 250 : 150,
            maxWaves: waves,
            firstWaveDelay: 18,
            allowedZombies: zList,
            adventureIndex: advNum,
          },
        ),
      );
    });
  });
  return out;
}

/**
 * 7 official Unity `PageScaryPot` Vasebreaker stages:
 * 砸罐子, 砸罐子2, 连锁反应, PVP砸罐子, 不走寻常路, 绝对火力, 有内鬼.
 */
function buildDeterministicVases(
  rows: number,
  cols: number[],
  plantIds: number[],
  zombieIds: number[],
  seed: number,
  guaranteeFrontGreen = 5,
): VaseSpec[] {
  const coords: { row: number; col: number }[] = [];
  for (const col of cols) {
    for (let row = 0; row < rows; row++) {
      coords.push({ row, col });
    }
  }
  const items: Omit<VaseSpec, 'row' | 'col'>[] = [];
  plantIds.forEach((pid, idx) => {
    items.push({
      kind: idx < guaranteeFrontGreen ? 'plant' : 'mystery',
      plantId: pid,
      sunBonus: idx % 4 === 0 ? 25 : 0,
    });
  });
  zombieIds.forEach((zid, idx) => {
    items.push({
      kind: zid >= 15 && idx % 3 === 0 ? 'zombie' : 'mystery',
      zombieId: zid,
    });
  });

  // Deterministic LCG shuffle separately on front green pots (kept easy/plant) & remaining pots
  let s = seed >>> 0;
  const rnd = () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const restItems = items.slice(guaranteeFrontGreen);
  for (let i = restItems.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [restItems[i], restItems[j]] = [restItems[j], restItems[i]];
  }
  const ordered = [...items.slice(0, guaranteeFrontGreen), ...restItems];
  return coords.slice(0, ordered.length).map((pos, idx) => ({
    row: pos.row,
    col: pos.col,
    ...ordered[idx],
  }));
}

export function getVasebreakerLevels(difficulty: number): BoardConfig[] {
  const specs: {
    key: string;
    name: string;
    sid: number;
    seed: number;
    cols: number[];
    plants: number[];
    zombies: number[];
    chainReaction?: boolean;
    prePlants?: { thePlantType: number; theColumn: number; theRow: number }[];
    tips: string;
  }[] = [
    {
      key: 'vase-102',
      name: '砸罐子',
      sid: 1,
      seed: 102,
      cols: [4, 5, 6, 7],
      plants: [0, 0, 13, 4, 3, 6, 6, 5, 8, 0, 13, 3],
      zombies: [0, 0, 2, 2, 0, 4, 0, 35],
      tips: '绿色罐子必开植物卡牌，棕色神秘罐可能开出植物或僵尸。点击任意罐子砸开并消灭全部僵尸即可过关！',
    },
    {
      key: 'vase-103',
      name: '砸罐子2',
      sid: 1,
      seed: 103,
      cols: [3, 4, 5, 6, 7],
      plants: [0, 6, 7, 13, 3, 2, 4, 8, 10, 0, 7, 6, 3, 13, 5],
      zombies: [0, 0, 2, 2, 4, 5, 8, 0, 4, 35],
      tips: '更多小喷菇与大喷菇登场，利用融合与魅惑化解铁桶及巨人压力！',
    },
    {
      key: 'vase-104',
      name: '连锁反应',
      sid: 1,
      seed: 104,
      cols: [3, 4, 5, 6, 7],
      plants: [2, 0, 13, 3, 16, 4, 8, 7, 14, 0, 2, 3, 5, 13, 24],
      zombies: [0, 2, 4, 5, 8, 9, 2, 4, 15, 35],
      chainReaction: true,
      tips: '【连锁反应】砸开一个罐子会顺带引碎相邻的另一枚罐子！用好樱桃与辣椒一次性清场！通关可解锁【汉堡王】。',
    },
    {
      key: 'vase-105',
      name: 'PVP砸罐子',
      sid: 0,
      seed: 105,
      cols: [3, 4, 5, 6, 7],
      plants: [0, 2, 18, 3, 13, 14, 23, 28, 32, 0, 16, 5, 17, 24, 3],
      zombies: [0, 2, 3, 4, 5, 8, 9, 15, 4, 35],
      tips: '白天草坪对决！收集植物阵容搭配火炬树桩与重火力突破高强度尸潮。',
    },
    {
      key: 'vase-175',
      name: '不走寻常路',
      sid: 0,
      seed: 175,
      cols: [2, 3, 5, 6, 7, 8],
      plants: [23, 0, 3, 13, 2, 18, 4, 16, 5, 14, 24, 17, 32, 28],
      zombies: [0, 2, 3, 4, 5, 8, 9, 24, 2, 35],
      tips: '纵横交错的非对称罐阵，注意前排罐子开出僵尸时的缓冲空间！通关可解锁【惊喜黄金罐子】。',
    },
    {
      key: 'vase-176',
      name: '绝对火力',
      sid: 2,
      seed: 176,
      cols: [4, 5, 6, 7],
      plants: [901, 14, 18, 23, 32, 2, 16, 3, 15, 909, 914, 13, 24, 1005],
      zombies: [0, 4, 8, 9, 14, 19, 20, 4, 35, 36],
      prePlants: [
        { thePlantType: 12, theColumn: 2, theRow: 2 },
        { thePlantType: 12, theColumn: 3, theRow: 2 },
        { thePlantType: 12, theColumn: 2, theRow: 3 },
        { thePlantType: 12, theColumn: 3, theRow: 3 },
      ],
      tips: '泳池决战！绿色与神秘罐中藏有究极植物与高火力融合前体，迎战重装军团与红眼巨人！',
    },
    {
      key: 'vase-177',
      name: '有内鬼',
      sid: 1,
      seed: 177,
      cols: [3, 4, 5, 6, 7],
      plants: [8, 8, 8, 10, 11, 2, 13, 3, 7, 6, 0, 904, 16, 8, 24],
      zombies: [0, 4, 5, 8, 9, 15, 21, 24, 35, 36],
      tips: '大量魅惑菇混入罐阵，巧用魅惑反打巨人与橄榄球僵尸！',
    },
  ];

  return specs.map((sp) => {
    const scene = assets.getScene(sp.sid) ?? assets.getScene(1)!;
    const rows = scene.rows || 5;
    const vases = buildDeterministicVases(rows, sp.cols, sp.plants, sp.zombies, sp.seed);
    return makeSceneConfig(
      'vasebreaker',
      sp.key,
      `砸罐子 · ${sp.name}`,
      `共 ${vases.length} 个罐子${sp.chainReaction ? ' · 连锁碎裂' : ''}`,
      sp.sid,
      difficulty,
      {
        initialSun: 50,
        maxWaves: 1,
        firstWaveDelay: 999,
        allowedZombies: Array.from(new Set(sp.zombies)),
        prePlants: sp.prePlants ?? [],
        conveyorMode: true,
        gloveCooldown: 8,
        tips: sp.tips,
        challengeKey: sp.key,
        vasebreakerConfig: {
          vases,
          chainReaction: sp.chainReaction,
        },
      },
    );
  });
}

/**
 * Challenge Menu Sub-Groups matching Unity `ChallengeMenu`:
 * 高级挑战 (`PageUnlockChallenge`, 12), 十旗挑战 (`PageFlagChallenge`, 12),
 * 迷你游戏 (`PageMiniGames` playable selection, 12), 冒险的时光 (`PageNewAdvantureLevel`, 9),
 * 砸罐子 (`PageScaryPot`, 7).
 */
export function getChallengeGroups(
  difficulty: number,
): Record<'classic' | 'unlock' | 'flags' | 'minigames' | 'snow' | 'vasebreaker' | 'tower', ChallengeGroupSpec> {
  const unlockSpecs: { key: string; name: string; sid: number; pid: number; zombies: number[]; preset: number[] }[] = [
    { key: 'uch-1005', name: '超级樱桃射手\n挑战关卡', sid: 0, pid: 1005, zombies: [0, 4, 8, 9, 15, 35], preset: [1005, 0, 1, 2, 3, 18] },
    { key: 'uch-1013', name: '超级大嘴花\n挑战关卡', sid: 0, pid: 1013, zombies: [0, 4, 8, 9, 21, 35], preset: [1013, 1, 2, 3, 5, 13] },
    { key: 'uch-1026', name: '超级魅惑菇\n挑战关卡', sid: 1, pid: 1026, zombies: [0, 4, 8, 9, 10, 15, 24], preset: [1026, 6, 7, 8, 10, 11] },
    { key: 'uch-1046', name: '超级大喷菇\n挑战关卡', sid: 1, pid: 1046, zombies: [0, 4, 8, 15, 24, 35], preset: [1046, 6, 7, 10, 11, 25] },
    { key: 'uch-1052', name: '超级火炬\n挑战关卡', sid: 0, pid: 1052, zombies: [0, 4, 9, 16, 18, 35], preset: [1052, 0, 1, 14, 16, 18] },
    { key: 'uch-1059', name: '超级窝草\n挑战关卡', sid: 2, pid: 1059, zombies: [0, 4, 14, 17, 19, 20, 35], preset: [1059, 1, 12, 13, 15, 18] },
    { key: 'uch-1104', name: '超级杨桃\n挑战关卡', sid: 3, pid: 1104, zombies: [0, 4, 17, 25, 26, 28, 36], preset: [1104, 6, 12, 20, 22, 23] },
    { key: 'uch-1110', name: '超级南瓜\n挑战关卡', sid: 3, pid: 1110, zombies: [0, 4, 24, 25, 28, 30, 35], preset: [1110, 6, 12, 20, 24, 25] },
    { key: 'uch-1126', name: '超级投手\n挑战关卡', sid: 4, pid: 1126, zombies: [0, 4, 26, 31, 32, 33, 35], preset: [1126, 1, 26, 27, 28, 32] },
    { key: 'uch-1148', name: '超级伞\n挑战关卡', sid: 4, pid: 1148, zombies: [0, 4, 31, 33, 34, 45, 36], preset: [1148, 1, 27, 28, 30, 32] },
    { key: 'uch-1220', name: '超级云杉射手\n挑战关卡', sid: 18, pid: 1220, zombies: [0, 4, 16, 18, 49, 50, 56], preset: [1220, 1, 35, 36, 39, 40] },
    { key: 'uch-244', name: '融合洋芋\n挑战关卡', sid: 18, pid: 244, zombies: [0, 4, 18, 47, 56, 57, 36], preset: [244, 1, 36, 38, 39, 40] },
  ];

  const flagSpecs: { key: string; name: string; sid: number; pid: number; zombies: number[]; spd?: number; hp?: number }[] = [
    { key: 'flg-13', name: '十旗挑战\n白天', sid: 0, pid: 0, zombies: [0, 2, 3, 4, 5, 8, 9, 23, 35] },
    { key: 'flg-14', name: '十旗挑战\n植物僵尸', sid: 0, pid: 18, zombies: [0, 2, 4, 8, 9, 15, 24, 35], hp: 1.15 },
    { key: 'flg-15', name: '十旗挑战\n随机植物', sid: 0, pid: 1, zombies: [0, 2, 4, 7, 8, 9, 21, 35] },
    { key: 'flg-16', name: '十旗挑战\n随机僵尸', sid: 0, pid: 2, zombies: [0, 2, 4, 7, 9, 15, 21, 24, 35, 36] },
    { key: 'flg-17', name: '十旗挑战\n全员随机', sid: 0, pid: 16, zombies: [0, 4, 8, 9, 15, 21, 24, 35, 36], hp: 1.2 },
    { key: 'flg-18', name: '十旗挑战\n黑夜', sid: 1, pid: 7, zombies: [0, 2, 4, 7, 8, 10, 15, 24, 35] },
    { key: 'flg-26', name: '十旗挑战\n胆小菇之梦', sid: 1, pid: 9, zombies: [0, 2, 4, 5, 8, 15, 24] },
    { key: 'flg-27', name: '十旗挑战\n黑夜舞会', sid: 1, pid: 8, zombies: [0, 4, 6, 7, 10, 15, 24] },
    { key: 'flg-33', name: '十旗挑战\n泳池', sid: 2, pid: 14, zombies: [0, 2, 4, 14, 17, 19, 20, 27, 35] },
    { key: 'flg-57', name: '十旗挑战\n浓雾', sid: 3, pid: 23, zombies: [0, 2, 4, 17, 24, 25, 26, 28, 36] },
    { key: 'flg-68', name: '十旗挑战\n等价交换', sid: 2, pid: 31, zombies: [0, 4, 9, 15, 19, 20, 35], hp: 1.15 },
    { key: 'flg-87', name: '十旗挑战\n屋顶', sid: 4, pid: 32, zombies: [0, 4, 15, 26, 31, 32, 33, 35, 36] },
  ];

  const miniSpecs: { key: string; name: string; sid: number; pid: number; sun: number; waves: number; zombies: number[]; spd?: number; hp?: number; preset?: number[]; tips: string }[] = [
    { key: 'mg-25', name: '胆小菇之梦', sid: 1, pid: 9, sun: 300, waves: 12, zombies: [0, 2, 4, 8, 15], preset: [9, 6, 7, 8, 3], tips: '以胆小菇为主力的夜战，用坚果护住胆小菇避免退缩！' },
    { key: 'mg-28', name: '撑杆舞会', sid: 0, pid: 3, sun: 350, waves: 14, zombies: [0, 3, 6, 7, 91], spd: 1.15, tips: '撑杆家族与舞王撑杆齐聚，备好高坚果与阻挡植物！' },
    { key: 'mg-30', name: '二爷战争', sid: 0, pid: 1005, sun: 500, waves: 15, zombies: [5, 59, 82, 104], hp: 1.15, tips: '全员读报二爷来袭！破报后暴走移速极快，请注意控场！' },
    { key: 'mg-34', name: '泳池激斗', sid: 2, pid: 15, sun: 400, waves: 14, zombies: [11, 12, 13, 14, 17, 19, 27], tips: '水上高强度混战，水草与三线射手协同守水路。' },
    { key: 'mg-37', name: '套娃', sid: 0, pid: 2, sun: 350, waves: 14, zombies: [0, 21, 22, 23], tips: '套娃僵尸被击破后会不断分裂出下级单位！' },
    { key: 'mg-38', name: '排山倒海', sid: 0, pid: 14, sun: 1500, waves: 15, zombies: [0, 2, 4, 8, 9, 35, 36], tips: '高阳光高强度对抗，尽情构筑多排顶级融合阵容！' },
    { key: 'mg-43', name: '谁能笑到最后', sid: 2, pid: 18, sun: 5000, waves: 15, zombies: [0, 4, 8, 9, 17, 19, 20, 35], tips: '开局充裕阳光一次摆好持久防线，挺过 15 波！' },
    { key: 'mg-44', name: '空袭', sid: 3, pid: 22, sun: 400, waves: 14, zombies: [0, 25, 26, 29, 250], tips: '大量气球与飞艇空降！备好三叶草与仙人掌/杨桃对空！' },
    { key: 'mg-62', name: '巨人之怒', sid: 0, pid: 11, sun: 600, waves: 16, zombies: [0, 35, 36, 37, 38, 39], hp: 1.1, tips: '全员巨人军团推进，重炮与秒杀融合不可或缺！' },
    { key: 'mg-125', name: '僵尸快跑', sid: 0, pid: 1034, sun: 400, waves: 14, zombies: [0, 2, 3, 4, 9, 19], spd: 1.45, tips: '全体僵尸移速大幅提升！优先布置寒冰减速体系！' },
    { key: 'mg-137', name: '大河奔流', sid: 22, pid: 12, sun: 450, waves: 16, zombies: [11, 12, 13, 14, 17, 19, 27], tips: '大型四行泳池激战，水域控制决定胜负。' },
    { key: 'mg-143', name: '雪原女皇的复仇', sid: 18, pid: 36, sun: 600, waves: 16, zombies: [84, 47, 49, 50, 56, 57, 228], hp: 1.2, tips: '迎战究极雪原女皇统帅的冰原大军！' },
  ];

  const snowLevels: BoardConfig[] = Array.from({ length: 9 }, (_, i) => {
    const zPools = [
      [0, 2, 84, 51],
      [0, 2, 84, 49, 55],
      [0, 4, 16, 49, 50, 55],
      [0, 4, 16, 18, 47, 62],
      [0, 4, 18, 47, 53, 56],
      [0, 4, 18, 53, 56, 57],
      [0, 4, 18, 35, 56, 57],
      [0, 4, 18, 36, 38, 57],
      [0, 4, 18, 36, 39, 57, 228],
    ];
    const waves = 8 + i;
    return makeSceneConfig(
      'challenge',
      `snow-adv-${i + 1}`,
      `冒险的时光 · 雪原第 ${i + 1} 关`,
      `极寒雪原第 ${i + 1}/9 关 · 共 ${waves} 波`,
      18,
      difficulty,
      {
        initialSun: 200 + i * 25,
        maxWaves: waves,
        allowedZombies: zPools[i],
        presetCards: [1, 35, 36, 38, 39, 40, 1220, 1223],
        challengeKey: `snow-adv-${i + 1}`,
      },
    );
  });

  return {
    classic: {
      key: 'classic',
      title: '经典冒险',
      iconPlantId: 0,
      sceneId: 0,
      levels: getClassicAdventureLevels(difficulty),
    },
    unlock: {
      key: 'unlock',
      title: '高级挑战',
      iconPlantId: 1005,
      sceneId: 0,
      levels: unlockSpecs.map((u) =>
        makeSceneConfig(
          'challenge',
          u.key,
          u.name.replace(/\n/g, ' '),
          '共 16 波 · 高级植物试炼',
          u.sid,
          difficulty,
          {
            initialSun: 500,
            maxWaves: 16,
            allowedZombies: u.zombies,
            presetCards: u.preset,
            zombieHpMult: 1.15,
            tips: `重点发挥【${u.name.split('\n')[0]}】的融合特性通关挑战！`,
            challengeKey: u.key,
          },
        ),
      ),
    },
    flags: {
      key: 'flags',
      title: '十旗挑战',
      iconPlantId: 2,
      sceneId: 0,
      levels: flagSpecs.map((f) =>
        makeSceneConfig(
          'challenge',
          f.key,
          f.name.replace(/\n/g, ' · '),
          '十面旗帜 · 共 20 波高强度车轮战',
          f.sid,
          difficulty,
          {
            initialSun: 400,
            maxWaves: 20,
            allowedZombies: f.zombies,
            zombieHpMult: f.hp ?? 1,
            zombieSpeedMult: f.spd ?? 1,
            challengeKey: f.key,
          },
        ),
      ),
    },
    minigames: {
      key: 'minigames',
      title: '迷你游戏',
      iconPlantId: 13,
      sceneId: 2,
      levels: miniSpecs.map((m) =>
        makeSceneConfig(
          'challenge',
          m.key,
          `迷你游戏 · ${m.name}`,
          `共 ${m.waves} 波 · 特色机制挑战`,
          m.sid,
          difficulty,
          {
            initialSun: m.sun,
            maxWaves: m.waves,
            allowedZombies: m.zombies,
            presetCards: m.preset,
            zombieHpMult: m.hp ?? 1,
            zombieSpeedMult: m.spd ?? 1,
            tips: m.tips,
            challengeKey: m.key,
          },
        ),
      ),
    },
    snow: {
      key: 'snow',
      title: '冒险的时光',
      iconPlantId: 36,
      sceneId: 18,
      levels: snowLevels,
    },
    vasebreaker: {
      key: 'vasebreaker',
      title: '砸罐子',
      iconPlantId: 3,
      sceneId: 1,
      levels: getVasebreakerLevels(difficulty),
    },
    tower: {
      key: 'tower',
      title: '经典塔防',
      iconPlantId: 352,
      sceneId: 0,
      levels: getTowerDefenseLevels(difficulty),
    },
  };
}

/**
 * Authentic 2-page 21-level Survival Menu matching Unity `SurvivalMenu` (`43422`):
 * Page 1 (18 levels) + Page 2 (3 levels).
 * Endless modes set `endless: true` so every 10 waves loops into inter-round SeedChooser with preserved plants!
 */
export function getSurvivalPages(difficulty: number): [SurvivalCardSpec[], SurvivalCardSpec[]] {
  const landZ = [0, 2, 4, 7, 15, 24, 25, 31, 35, 36];
  const poolZ = [0, 2, 4, 7, 14, 15, 17, 19, 20, 25, 27, 35, 36];
  const roofZ = [0, 2, 4, 7, 15, 26, 31, 32, 33, 34, 35, 36];
  const snowZ = [0, 4, 16, 18, 47, 49, 50, 56, 57, 36, 39];

  const mk = (
    key: string,
    label: string,
    sid: number,
    pid: number,
    tier: 'normal' | 'hard' | 'endless',
    opts: { sun?: number; hp?: number; spd?: number; diffDelta?: number; zombies?: number[]; tips?: string } = {},
  ): SurvivalCardSpec => {
    const d = Math.max(1, Math.min(5, difficulty + (opts.diffDelta ?? (tier === 'hard' ? 1 : 0))));
    const waves = tier === 'normal' ? 10 : tier === 'hard' ? 20 : 10;
    const isEndless = tier === 'endless';
    const zPool =
      opts.zombies ??
      (sid === 18 ? snowZ : sid === 4 ? roofZ : assets.getScene(sid)?.pool ? poolZ : landZ);

    return {
      label,
      iconPlantId: pid,
      isEndless,
      config: makeSceneConfig(
        'survival',
        key,
        `生存模式 · ${label}`,
        isEndless ? '无限轮次 · 每 10 波保留阵型重选卡' : `${waves} 波攻防挑战`,
        sid,
        d,
        {
          initialSun: opts.sun ?? (isEndless ? 500 : 250),
          maxWaves: waves,
          endless: isEndless,
          wavesPerRound: isEndless ? 10 : undefined,
          allowedZombies: zPool,
          gloveCooldown: 8,
          zombieHpMult: opts.hp ?? 1,
          zombieSpeedMult: opts.spd ?? 1,
          tips: opts.tips,
        },
      ),
    };
  };

  const page1: SurvivalCardSpec[] = [
    mk('sur-day', '白天', 0, 0, 'normal'),
    mk('sur-night', '黑夜', 1, 6, 'normal'),
    mk('sur-pool', '泳池', 2, 12, 'normal'),
    mk('sur-day-hard', '白天：困难', 0, 1005, 'hard', { hp: 1.15 }),
    mk('sur-night-hard', '黑夜：困难', 1, 7, 'hard', { hp: 1.15 }),
    mk('sur-pool-hard', '泳池：困难', 2, 14, 'hard', { hp: 1.15 }),
    mk('sur-pool-endless', '泳池：无尽', 2, 16, 'endless'),
    mk('sur-revpool-endless', '反转泳池：无尽', 21, 19, 'endless', { tips: '反转泳池：上下边路为水路，中间 2 行是陆地！' }),
    mk('sur-night-endless', '黑夜：无尽', 1, 11, 'endless'),
    mk('sur-day-endless', '白天：无尽', 0, 1, 'endless'),
    mk('sur-fog-endless', '浓雾：无尽', 3, 23, 'endless'),
    mk('sur-roof-endless', '屋顶：无尽', 4, 32, 'endless'),
    mk('sur-roof', '屋顶', 4, 27, 'normal'),
    mk('sur-roof-hard', '屋顶：困难', 4, 30, 'hard', { hp: 1.15 }),
    mk('sur-fog', '浓雾', 3, 20, 'normal'),
    mk('sur-fog-hard', '浓雾：困难', 3, 25, 'hard', { hp: 1.15 }),
    mk('sur-snow-endless', '雪原：无尽', 18, 36, 'endless'),
    mk('sur-pool-crisis', '泳池无尽：危机', 2, 901, 'endless', {
      sun: 600,
      hp: 1.25,
      spd: 1.15,
      diffDelta: 1,
      tips: '危机变体：僵尸血量与移速全面加强的高压无尽！',
    }),
  ];

  const page2: SurvivalCardSpec[] = [
    mk('sur-bigpool-endless', '大型泳池：无尽', 22, 14, 'endless', { tips: '大型泳池：中间 4 行全部为水域，合理利用睡莲！' }),
    mk('sur-roofpool-endless', '屋顶泳池：无尽', 34, 23, 'endless', { tips: '夜间屋顶与双水路并存的复合战场！' }),
    mk('sur-pool-chill', '泳池无尽：安逸', 2, 1034, 'endless', {
      sun: 1000,
      hp: 0.8,
      spd: 0.9,
      diffDelta: -1,
      tips: '安逸变体：充裕开局阳光且僵尸削弱，适合休闲实验阵容！',
    }),
  ];

  return [page1, page2];
}

export function buildExploreBoardConfig(lvl: ExploreLevelDef, difficulty: number): BoardConfig {
  const scene = assets.getScene(lvl.sceneType) ?? assets.getScene(0)!;
  return {
    mode: 'explore',
    levelKey: `explore-${lvl.id}`,
    title: `探索 · ${lvl.name}`,
    subtitle: `${scene.label} · 共 ${lvl.maxWave || 20} 波${lvl.convay ? ' · 传送带' : ''}`,
    scene,
    initialSun: Math.max(150, lvl.theSun || 150),
    maxWaves: Math.max(5, lvl.maxWave || 20),
    firstWaveDelay: Math.min(20, Math.max(6, lvl.firstWaveCountdown || 12)),
    nextWaveInterval: lvl.nextWaveInterval || 25,
    allowedZombies: lvl.zombies.length > 0 ? lvl.zombies : [0, 2, 4, 7],
    prePlants: lvl.prePlant ?? [],
    presetCards: lvl.usePlant && lvl.usePlant.length > 0 ? lvl.usePlant : undefined,
    restrictToPresetCards: !lvl.convay && Boolean(lvl.usePlant && lvl.usePlant.length > 0),
    gloveCooldown: lvl.gloveCD > 0 ? lvl.gloveCD : 10,
    difficulty,
    zombieHpMult: lvl.zombieHealthMultiplier || 1,
    zombieSpeedMult: lvl.zombieSpeedAdder || 1,
    conveyorMode: Boolean(lvl.convay),
    conveyorInterval: lvl.convayTimer || 5.0,
    tips: lvl.tips,
    exploreId: lvl.id,
  };
}

/** Builds a BoardConfig for a genuine unpacked `iz_levels.json` entry. */
export function buildIzBoardConfig(entry: IzLevelEntry, difficulty: number): BoardConfig {
  const d = entry.data;
  const scene = assets.getScene(d.sceneType) ?? assets.getScene(25) ?? assets.getScene(0)!;
  const label = formatIzDisplayName(entry.name);
  const avail = Array.from(
    new Set(
      (d.zombietTypes ?? []).filter((zid) => Boolean(assets.getZombie(zid))),
    ),
  );
  return {
    mode: 'iz',
    levelKey: `iz-${entry.name}`,
    title: `解谜 · ${label}`,
    subtitle: `${scene.label} · 我是僵尸`,
    scene,
    initialSun: Math.max(50, d.theSun || 150),
    maxWaves: 1,
    firstWaveDelay: 999,
    allowedZombies: avail.length > 0 ? avail : [0, 2, 4],
    prePlants: [],
    gloveCooldown: 0,
    difficulty,
    zombieHpMult: 1,
    zombieSpeedMult: 1,
    tips: d.tips,
    izConfig: {
      name: entry.name,
      redlineColumn: Math.max(1, Math.min(9, d.redlineColumn || 5)),
      dropSunPerPlant: d.dropSunPerPlant || 0,
      availableZombies: avail.length > 0 ? avail : [0, 2, 4],
      plants: d.plants ?? [],
    },
  };
}

/** Playable snow-night side stage + playable HotLevel specials. */
export function buildNightSnowExploreConfig(difficulty: number): BoardConfig {
  return makeSceneConfig(
    'challenge',
    'hot-nightsnow',
    '冒险支线 · 雪夜',
    '极寒黑夜雪原 · 16 波精锐攻防',
    40,
    difficulty,
    {
      initialSun: 450,
      maxWaves: 16,
      allowedZombies: [0, 4, 16, 18, 49, 50, 56, 57, 228],
      presetCards: [1, 35, 36, 38, 39, 40, 1220, 1223],
      tips: '来自《推荐关卡》的雪夜支线：善用雪原植物与小松炉照明/热力防御极寒军团！',
      challengeKey: 'hot-nightsnow',
    },
  );
}

/** Fixed scene IDs matching `catalog.scenes` (no swapped sid 22/21 vs 6/7). */
export function getSandboxSpecs(): SandboxCardSpec[] {
  return [
    { sid: 0, label: '白天草坪', pid: 0 },
    { sid: 1, label: '黑夜草坪', pid: 6 },
    { sid: 2, label: '泳池乐园', pid: 12 },
    { sid: 3, label: '浓雾泳池', pid: 19 },
    { sid: 4, label: '屋顶决战', pid: 27 },
    { sid: 18, label: '极寒雪原', pid: 36 },
    { sid: 6, label: '六行白天', pid: 1 },
    { sid: 7, label: '六行黑夜', pid: 8 },
    { sid: 22, label: '大型泳池', pid: 14 },
    { sid: 21, label: '反转泳池', pid: 16 },
    { sid: 34, label: '黑夜屋顶泳池', pid: 23 },
    { sid: 40, label: '黑夜雪原', pid: 38 },
  ];
}

export function buildSandboxBoardConfig(sceneId: number): BoardConfig {
  const scene = assets.getScene(sceneId) ?? assets.getScene(0)!;
  return {
    mode: 'sandbox',
    levelKey: `sandbox-${sceneId}`,
    title: `自由沙盒 · ${scene.label}`,
    subtitle: '无限阳光 · 零冷却 · 全植物融合测试',
    scene,
    initialSun: 9990,
    infiniteSun: true,
    zeroCooldown: true,
    maxWaves: 99,
    firstWaveDelay: 999,
    allowedZombies: [0, 2, 4, 5, 7, 8, 15, 17, 25, 35],
    prePlants: [],
    gloveCooldown: 0,
    difficulty: 2,
    zombieHpMult: 1,
    zombieSpeedMult: 1,
  };
}

/** Filters out virtual UI slots and entity-less helper items from catalog plants. */
export function getPlayablePlants(): PlantDef[] {
  return Object.values(assets.catalog.plants)
    .filter(
      (p) =>
        p.hasRig &&
        Boolean(p.portrait) &&
        !p.tags.includes('VirtualPlants') &&
        p.cost >= 0 &&
        p.scriptClass !== 'MixedPlant',
    )
    .sort((a, b) => a.id - b.id);
}

/** Returns true if the plant is part of Unity's SeedLibrary `NormalCards` base roster. */
export function isBasePlant(id: number): boolean {
  return isNormalCard(id);
}

/** Picks a smart balanced starter deck suited to the target scene and preset recipe cards, honoring plant unlocks. */
export function buildRecommendedDeck(board: BoardConfig, limit = 10): number[] {
  const base = [0, 1, 2, 3, 4, 13, 18, 14, 16, 17];
  const extras: number[] = [];
  if (board.scene.pool) extras.push(12, 15, 19);
  if (board.scene.roof) extras.push(27, 26, 32);
  if (board.scene.fog) extras.push(20, 22);
  if (board.scene.night) extras.push(6, 7, 9, 10);

  const combined = [...(board.presetCards ?? []), ...extras, ...base];
  const out: number[] = [];
  const playableSet = new Set(getPlayablePlants().map((p) => p.id));
  for (const pid of combined) {
    if (playableSet.has(pid) && saveManager.isPlantUnlocked(pid, board) && !out.includes(pid)) {
      out.push(pid);
      if (out.length >= limit) break;
    }
  }
  if (out.length === 0) {
    for (const pid of [0, 1]) {
      if (playableSet.has(pid)) out.push(pid);
    }
  }
  return out;
}

/** Returns the authentic PvZRH SeedPacket card background texture for a plant/scene. */
export function getCardFrameUrl(plant?: PlantDef, sceneCardStyle?: string): string {
  if (plant) {
    if (plant.tags.includes('UltimatePlants') || plant.cost >= 400) {
      return 'assets/ui/seed_packet_purple.webp';
    }
    if (plant.tags.includes('WhiteCardPlants')) {
      return 'assets/ui/seed_packet_white.webp';
    }
    if (plant.tags.includes('SpecialCardPlants')) {
      return 'assets/ui/seed_packet_colorful.webp';
    }
    if (plant.id >= 1000) {
      if (plant.tags.includes('FirePlants')) {
        return 'assets/ui/seed_packet_red.webp';
      }
      return 'assets/ui/seed_packet_gold.webp';
    }
    if (plant.layer === 'Lily' || plant.tags.includes('WaterPlants') || plant.tags.includes('KelpPlants')) {
      return 'assets/ui/seed_packet_pool.webp';
    }
    if (plant.layer === 'Pot') {
      return 'assets/ui/seed_packet_roof.webp';
    }
  }
  switch (sceneCardStyle) {
    case 'Night':
      return 'assets/ui/seed_packet_night.webp';
    case 'Pool':
      return 'assets/ui/seed_packet_pool.webp';
    case 'NightPool':
      return 'assets/ui/seed_packet_nightpool.webp';
    case 'Roof':
    case 'Travel_roof':
      return 'assets/ui/seed_packet_roof.webp';
    case 'Snow':
      return 'assets/ui/seed_packet_snow.webp';
    case 'NightSnow':
      return 'assets/ui/seed_packet_nightsnow.webp';
    default:
      return 'assets/ui/seed_packet_default.webp';
  }
}

/** Maps a PvZRH sceneId to its authentic Almanac/LevelSelect thumbnail ground texture. */
export function getGroundThumbUrl(sceneId: number): string {
  switch (sceneId) {
    case 0:
    case 6:
    case 25:
      return 'assets/ui/ground_day.webp';
    case 1:
    case 7:
      return 'assets/ui/ground_night.webp';
    case 2:
    case 22:
      return 'assets/ui/ground_pool.webp';
    case 3:
    case 21:
    case 34:
      return 'assets/ui/ground_nightpool.webp';
    case 4:
    case 5:
    case 10:
    case 12:
    case 13:
      return 'assets/ui/ground_roof.webp';
    case 18:
    case 20:
    case 40:
      return 'assets/ui/ground_snow.webp';
    default:
      return `assets/bg/${assets.getScene(sceneId)?.bg ?? 'Day_1400x600.webp'}`;
  }
}

/** Wires hover swap (`data-base` <-> `data-hl`) onto any button/container holding an `<img data-hl>`. */
export function bindHoverImages(root: ParentNode): void {
  root.querySelectorAll<HTMLImageElement>('img[data-hl]').forEach((img) => {
    const parent = img.parentElement;
    if (!parent) return;
    parent.addEventListener('pointerenter', () => {
      if (img.dataset.hl) img.src = img.dataset.hl;
    });
    parent.addEventListener('pointerleave', () => {
      if (img.dataset.base) img.src = img.dataset.base;
    });
  });
}

export function escHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] || ch));
}
