import { assets } from '../assets/AssetLoader';
import type { BoardConfig, TowerWaypoint } from '../types/game';

const TOWER_BASE_PLANTS = [350, 351, 352, 353, 355, 357, 359, 362, 363, 364, 365, 367];
const TOWER_ZOMBIES_LAND = [0, 2, 4, 7, 8, 9, 15, 21, 24, 35];
const TOWER_ZOMBIES_POOL = [0, 2, 4, 14, 17, 19, 20, 24, 35];
const TOWER_ZOMBIES_SNOW = [0, 4, 16, 18, 47, 49, 50, 56, 57];

interface TowerLevelSpec {
  key: string;
  title: string;
  sceneId: number;
  maxWaves: number;
  sun: number;
  endless?: boolean;
  waypoints: TowerWaypoint[];
  zombies: number[];
  tips: string;
}

const TOWER_SPECS: TowerLevelSpec[] = [
  {
    key: 'td-1',
    title: '经典塔防 · 第1关 (初守)',
    sceneId: 0,
    maxWaves: 10,
    sun: 400,
    waypoints: [
      { row: 1, col: 8 },
      { row: 1, col: 5 },
      { row: 3, col: 5 },
      { row: 3, col: 2 },
      { row: 2, col: 2 },
      { row: 2, col: 0 },
    ],
    zombies: [0, 2, 4, 7, 8],
    tips: '【经典塔防】僵尸仅沿青石行军路径前进并直扑基地大门！在道路两侧高地布置[塔防]炮台，360° 全向索敌拦截！',
  },
  {
    key: 'td-2',
    title: '经典塔防 · 第2关 (蜿蜒)',
    sceneId: 0,
    maxWaves: 12,
    sun: 425,
    waypoints: [
      { row: 0, col: 8 },
      { row: 0, col: 6 },
      { row: 4, col: 6 },
      { row: 4, col: 3 },
      { row: 1, col: 3 },
      { row: 1, col: 0 },
    ],
    zombies: [0, 2, 4, 7, 8, 9, 21],
    tips: '长 S 形折返路线！利用拐角高地配置超级樱桃炮台与寒冰忧郁菇打出多段集火伤害。',
  },
  {
    key: 'td-3',
    title: '经典塔防 · 第3关 (夜幕)',
    sceneId: 1,
    maxWaves: 12,
    sun: 450,
    waypoints: [
      { row: 4, col: 8 },
      { row: 4, col: 5 },
      { row: 0, col: 5 },
      { row: 0, col: 2 },
      { row: 3, col: 2 },
      { row: 3, col: 0 },
    ],
    zombies: TOWER_ZOMBIES_LAND,
    tips: '夜幕降临！善用塔防阳光大蘑菇与胆大菇快速积攒经济，构建纵深火力网。',
  },
  {
    key: 'td-4',
    title: '经典塔防 · 第4关 (回廊)',
    sceneId: 1,
    maxWaves: 14,
    sun: 475,
    waypoints: [
      { row: 2, col: 8 },
      { row: 2, col: 6 },
      { row: 0, col: 6 },
      { row: 0, col: 2 },
      { row: 4, col: 2 },
      { row: 4, col: 0 },
    ],
    zombies: TOWER_ZOMBIES_LAND,
    tips: '上下对称双折返走廊，中心第 1~3 行高地是绝佳的双向覆盖炮位！',
  },
  {
    key: 'td-5',
    title: '经典塔防 · 第5关 (水路)',
    sceneId: 2,
    maxWaves: 14,
    sun: 500,
    waypoints: [
      { row: 1, col: 8 },
      { row: 1, col: 5 },
      { row: 4, col: 5 },
      { row: 4, col: 2 },
      { row: 2, col: 2 },
      { row: 2, col: 0 },
    ],
    zombies: TOWER_ZOMBIES_POOL,
    tips: '泳池地形六行地图！搭配[塔防]睡莲在中央水道展开全向覆盖防线。',
  },
  {
    key: 'td-6',
    title: '经典塔防 · 第6关 (迷雾)',
    sceneId: 3,
    maxWaves: 15,
    sun: 525,
    waypoints: [
      { row: 0, col: 8 },
      { row: 0, col: 5 },
      { row: 5, col: 5 },
      { row: 5, col: 2 },
      { row: 3, col: 2 },
      { row: 3, col: 0 },
    ],
    zombies: [0, 4, 17, 19, 24, 25, 26, 28, 36],
    tips: '浓雾弥漫且伴有空中气球部队！寒冰三叶草与毁灭杨桃可全屏压制来敌。',
  },
  {
    key: 'td-7',
    title: '经典塔防 · 第7关 (天台)',
    sceneId: 4,
    maxWaves: 16,
    sun: 550,
    waypoints: [
      { row: 4, col: 8 },
      { row: 4, col: 6 },
      { row: 1, col: 6 },
      { row: 1, col: 3 },
      { row: 3, col: 3 },
      { row: 3, col: 0 },
    ],
    zombies: [0, 4, 15, 26, 31, 32, 33, 35, 36],
    tips: '屋顶天台高强度防守战！猪笼草迫击炮与毁灭杨桃是清理高血量梯子与巨人的主力。',
  },
  {
    key: 'td-8',
    title: '经典塔防 · 第8关 (绝境)',
    sceneId: 18,
    maxWaves: 18,
    sun: 650,
    waypoints: [
      { row: 2, col: 8 },
      { row: 2, col: 6 },
      { row: 0, col: 6 },
      { row: 0, col: 3 },
      { row: 4, col: 3 },
      { row: 4, col: 1 },
      { row: 1, col: 1 },
      { row: 1, col: 0 },
    ],
    zombies: TOWER_ZOMBIES_SNOW,
    tips: '雪原终极决战！记得在炮台旁种植温热植物（如小松炉/火炬）防止冰冻，通关即解锁【狙击射手】！',
  },
  {
    key: 'td-endless-1',
    title: '塔防无尽 · 白昼防线',
    sceneId: 0,
    maxWaves: 10,
    sun: 650,
    endless: true,
    waypoints: [
      { row: 1, col: 8 },
      { row: 1, col: 6 },
      { row: 4, col: 6 },
      { row: 4, col: 3 },
      { row: 0, col: 3 },
      { row: 0, col: 1 },
      { row: 2, col: 1 },
      { row: 2, col: 0 },
    ],
    zombies: [0, 2, 4, 8, 9, 15, 24, 35, 36, 43],
    tips: '【塔防无尽】每 10 波一轮递增，挑战最长塔防坚守波数！',
  },
  {
    key: 'td-endless-2',
    title: '塔防无尽 · 永夜守望',
    sceneId: 1,
    maxWaves: 10,
    sun: 750,
    endless: true,
    waypoints: [
      { row: 3, col: 8 },
      { row: 3, col: 6 },
      { row: 0, col: 6 },
      { row: 0, col: 4 },
      { row: 4, col: 4 },
      { row: 4, col: 1 },
      { row: 2, col: 1 },
      { row: 2, col: 0 },
    ],
    zombies: [0, 4, 8, 9, 10, 15, 24, 35, 36, 204],
    tips: '【永夜塔防无尽】夜战精英僵尸无尽涌入，构筑满配究极塔防阵型吧！',
  },
];

export function getTowerDefenseLevels(difficulty: number): BoardConfig[] {
  return TOWER_SPECS.map((spec) => {
    const scene = assets.getScene(spec.sceneId) ?? assets.getScene(0)!;
    const isPool = scene.waterRows.length > 0;
    const presetCards = isPool ? [...TOWER_BASE_PLANTS, 366] : [...TOWER_BASE_PLANTS];
    if (spec.sceneId === 18) {
      presetCards.unshift(35, 36);
    }
    return {
      mode: 'tower',
      levelKey: spec.key,
      challengeKey: spec.key,
      title: spec.title,
      subtitle: `${scene.label} · ${spec.endless ? '无尽轮次' : `${spec.maxWaves}波`}`,
      scene,
      initialSun: spec.sun,
      maxWaves: spec.maxWaves,
      firstWaveDelay: 10,
      nextWaveInterval: 18,
      allowedZombies: spec.zombies,
      prePlants: [],
      presetCards,
      gloveCooldown: 3,
      difficulty,
      zombieHpMult: spec.endless ? 1.1 : 1.0,
      zombieSpeedMult: 1.0,
      endless: spec.endless,
      towerConfig: {
        waypoints: spec.waypoints,
        maxLives: 10,
      },
      tips: spec.tips,
    };
  });
}

export function buildStackerBoardConfig(difficulty: number): BoardConfig {
  const scene = assets.getScene(0) ?? Object.values(assets.catalog.scenes)[0];
  return {
    mode: 'challenge',
    levelKey: 'hot-stacker',
    challengeKey: 'hot-stacker',
    title: '热门挑战 · 超级叠叠乐',
    subtitle: '无限同格叠种 · 多重火力共振',
    scene,
    initialSun: 500,
    maxWaves: 14,
    firstWaveDelay: 12,
    allowedZombies: [0, 2, 4, 7, 8, 9, 15, 21, 24, 35, 36],
    prePlants: [],
    presetCards: [0, 1, 2, 3, 5, 13, 14, 18, 23, 24],
    gloveCooldown: 2,
    difficulty,
    zombieHpMult: 1.15,
    zombieSpeedMult: 1.0,
    stackerMode: true,
    tips: '【超级叠叠乐】同一格不再限制种植数量！可在同格无限垂直叠加多种植物（可触发融合时仍优先融合），构建多层超级防线！',
  };
}

export function buildMaLiangBoardConfig(difficulty: number): BoardConfig {
  const scene = assets.getScene(0) ?? Object.values(assets.catalog.scenes)[0];
  return {
    mode: 'challenge',
    levelKey: 'hot-maliang',
    challengeKey: 'hot-maliang',
    title: '热门挑战 · 神笔马良',
    subtitle: '手绘图形蘸墨召唤 · 笔下生花',
    scene,
    initialSun: 0,
    maxWaves: 12,
    firstWaveDelay: 14,
    conveyorMode: true,
    prePlants: [],
    presetCards: [0, 1, 2, 3, 14, 18, 23, 1005],
    allowedZombies: [0, 2, 4, 7, 8, 9, 15, 24, 35],
    gloveCooldown: 4,
    difficulty,
    zombieHpMult: 1.0,
    zombieSpeedMult: 1.0,
    maliangMode: true,
    tips: '【神笔马良】在左侧画板自由勾勒图形（圆形→向日葵/坚果/炸弹，横线→直线射手，竖线→仙人掌/大嘴花/狙击，星芒→杨桃/究极），消耗 35 墨水即可将画作凝结成卡牌送入传送带！',
  };
}
