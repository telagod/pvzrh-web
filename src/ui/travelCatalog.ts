import { assets } from '../assets/AssetLoader';
import type { BattleModifiers, BoardConfig, TravelRunState } from '../types/game';

export interface TravelBuffDef {
  id: string;
  name: string;
  desc: string;
  kind: 'plant' | 'zombie';
  shopOnly?: boolean;
  shopCost?: number;
  iconPlantId?: number;
  iconZombieId?: number;
  apply: (m: BattleModifiers) => void;
}

export interface TravelUltimateDef {
  plantId: number;
  baseCost: number;
  tagline: string;
}

export interface TravelStageSpec {
  config: BoardConfig;
  iconPlantId: number;
  label: string;
  sceneId: number;
}

/** 7 official Travel Survival scenes × 3 rounds = 21 rounds. */
export const TRAVEL_SCENES: { sceneId: number; label: string; zombies: number[] }[] = [
  { sceneId: 0, label: '旅行：白天草坪', zombies: [0, 2, 3, 4, 5, 8, 9, 15, 24, 35] },
  { sceneId: 1, label: '旅行：黑夜草坪', zombies: [0, 2, 4, 7, 8, 10, 15, 24, 35] },
  { sceneId: 2, label: '旅行：泳池乐园', zombies: [0, 4, 12, 14, 17, 19, 20, 25, 35] },
  { sceneId: 3, label: '旅行：浓雾水域', zombies: [0, 4, 17, 24, 25, 26, 28, 35, 36] },
  { sceneId: 4, label: '旅行：屋顶决战', zombies: [0, 4, 15, 26, 31, 32, 33, 35, 36] },
  { sceneId: 18, label: '旅行：极寒雪原', zombies: [0, 4, 16, 18, 228, 35, 36] },
  { sceneId: 40, label: '旅行：深冬雪夜', zombies: [0, 4, 16, 18, 21, 24, 35, 36, 228] },
];

export const TRAVEL_PLANT_BUFFS: TravelBuffDef[] = [
  {
    id: 'pb_dmg1',
    name: '强力子弹',
    desc: '我方所有植物与爆炸伤害提升 +25%',
    kind: 'plant',
    iconPlantId: 0,
    apply: (m) => {
      m.plantDmgMult = (m.plantDmgMult ?? 1) * 1.25;
    },
  },
  {
    id: 'pb_dmg2',
    name: '超载火力',
    desc: '我方所有植物伤害额外提升 +40%',
    kind: 'plant',
    iconPlantId: 1005,
    apply: (m) => {
      m.plantDmgMult = (m.plantDmgMult ?? 1) * 1.4;
    },
  },
  {
    id: 'pb_spd1',
    name: '极速连射',
    desc: '射手、喷菇与投手攻速提升 +22%',
    kind: 'plant',
    iconPlantId: 23,
    apply: (m) => {
      m.plantAtkSpeedMult = (m.plantAtkSpeedMult ?? 1) * 1.22;
    },
  },
  {
    id: 'pb_hp1',
    name: '钢铁防线',
    desc: '所有植物最大生命值提升 +45%',
    kind: 'plant',
    iconPlantId: 3,
    apply: (m) => {
      m.plantHpMult = (m.plantHpMult ?? 1) * 1.45;
    },
  },
  {
    id: 'pb_sun1',
    name: '双倍光合',
    desc: '收集任意阳光获得的数值 +40%',
    kind: 'plant',
    iconPlantId: 1,
    apply: (m) => {
      m.sunGainMult = (m.sunGainMult ?? 1) * 1.4;
    },
  },
  {
    id: 'pb_cost1',
    name: '精打细算',
    desc: '全卡组植物种植消耗降低 25 点阳光',
    kind: 'plant',
    iconPlantId: 6,
    apply: (m) => {
      m.cardCostDiscount = (m.cardCostDiscount ?? 0) + 25;
    },
  },
  {
    id: 'pb_cd1',
    name: '全息制冷',
    desc: '植物卡牌冷却时间缩短 25%',
    kind: 'plant',
    iconPlantId: 10,
    apply: (m) => {
      m.cardCdMult = (m.cardCdMult ?? 1) * 0.75;
    },
  },
  {
    id: 'pb_crit1',
    name: '精准暴击',
    desc: '植物攻击获得 +25% 暴击率（1.75 倍暴伤）',
    kind: 'plant',
    iconPlantId: 21,
    apply: (m) => {
      m.critChance = (m.critChance ?? 0) + 0.25;
    },
  },
  {
    id: 'pb_glv',
    name: '灵巧手套',
    desc: '融合手套冷却减半，开局初始阳光额外 +150',
    kind: 'plant',
    iconPlantId: 245,
    apply: () => {
      // Handled directly when building BoardConfig (initialSun + gloveCooldown)
    },
  },
  {
    id: 'pb_synergy',
    name: '连携共鸣',
    desc: '【商店限定】全植物伤害 +35% 且攻速 +15%',
    kind: 'plant',
    shopOnly: true,
    shopCost: 1100,
    iconPlantId: 901,
    apply: (m) => {
      m.plantDmgMult = (m.plantDmgMult ?? 1) * 1.35;
      m.plantAtkSpeedMult = (m.plantAtkSpeedMult ?? 1) * 1.15;
    },
  },
  {
    id: 'pb_shrink',
    name: '缩小射线',
    desc: '【商店限定】敌方僵尸血量 -20% 且移速 -12%',
    kind: 'plant',
    shopOnly: true,
    shopCost: 1200,
    iconPlantId: 904,
    apply: (m) => {
      m.zombieHpBonusMult = (m.zombieHpBonusMult ?? 1) * 0.8;
      m.zombieSpeedBonusMult = (m.zombieSpeedBonusMult ?? 1) * 0.88;
    },
  },
  {
    id: 'pb_chrono',
    name: '时光加速',
    desc: '【商店限定】卡牌冷却再降 35% 且阳光收益 +30%',
    kind: 'plant',
    shopOnly: true,
    shopCost: 1000,
    iconPlantId: 909,
    apply: (m) => {
      m.cardCdMult = (m.cardCdMult ?? 1) * 0.65;
      m.sunGainMult = (m.sunGainMult ?? 1) * 1.3;
    },
  },
  {
    id: 'pb_lifesteal',
    name: '吸血光环',
    desc: '植物造成伤害时按 35% 比例治疗场上血量最低的友方植物',
    kind: 'plant',
    iconPlantId: 903,
    apply: (m) => {
      m.plantLifestealRatio = (m.plantLifestealRatio ?? 0) + 0.35;
    },
  },
  {
    id: 'pb_hammer',
    name: '雷神重锤',
    desc: '局内重锤工具冷却时间减半，更快定点砸溃重甲僵尸',
    kind: 'plant',
    iconPlantId: 310,
    apply: (m) => {
      m.hammerCdMult = (m.hammerCdMult ?? 1) * 0.5;
    },
  },
  {
    id: 'pb_overclock',
    name: '火力超频',
    desc: '全体植物攻击速度再提升 +30%',
    kind: 'plant',
    iconPlantId: 301,
    apply: (m) => {
      m.plantAtkSpeedMult = (m.plantAtkSpeedMult ?? 1) * 1.3;
    },
  },
  {
    id: 'pb_sunburst',
    name: '烈日狂潮',
    desc: '太阳生产与拾取阳光收益 +45%',
    kind: 'plant',
    iconPlantId: 304,
    apply: (m) => {
      m.sunGainMult = (m.sunGainMult ?? 1) * 1.45;
    },
  },
  {
    id: 'pb_bargain',
    name: '终极减费',
    desc: '所有种植卡牌额外减少 50 阳光消耗',
    kind: 'plant',
    iconPlantId: 954,
    apply: (m) => {
      m.cardCostDiscount = (m.cardCostDiscount ?? 0) + 50;
    },
  },
  {
    id: 'pb_crit2',
    name: '致命星陨',
    desc: '植物暴击率再 +30%（叠加高额暴击期望）',
    kind: 'plant',
    iconPlantId: 311,
    apply: (m) => {
      m.critChance = (m.critChance ?? 0) + 0.3;
    },
  },
  {
    id: 'pb_titan',
    name: '泰坦堡垒',
    desc: '全体植物最大生命值大幅提升 +55%',
    kind: 'plant',
    iconPlantId: 308,
    apply: (m) => {
      m.plantHpMult = (m.plantHpMult ?? 1) * 1.55;
    },
  },
  {
    id: 'pb_execution',
    name: '究极裁决',
    desc: '【商店限定】植物伤害 +40% 且暴击率 +15%',
    kind: 'plant',
    shopOnly: true,
    shopCost: 1300,
    iconPlantId: 300,
    apply: (m) => {
      m.plantDmgMult = (m.plantDmgMult ?? 1) * 1.4;
      m.critChance = (m.critChance ?? 0) + 0.15;
    },
  },
];

export const TRAVEL_ZOMBIE_BUFFS: TravelBuffDef[] = [
  {
    id: 'zb_hp1',
    name: '坚韧行军',
    desc: '所有僵尸基础血量 +30%',
    kind: 'zombie',
    iconZombieId: 4,
    apply: (m) => {
      m.zombieHpBonusMult = (m.zombieHpBonusMult ?? 1) * 1.3;
    },
  },
  {
    id: 'zb_spd1',
    name: '狂暴冲锋',
    desc: '僵尸行进速度提升 +18%',
    kind: 'zombie',
    iconZombieId: 9,
    apply: (m) => {
      m.zombieSpeedBonusMult = (m.zombieSpeedBonusMult ?? 1) * 1.18;
    },
  },
  {
    id: 'zb_arm1',
    name: '重装铁甲',
    desc: '路障/铁桶/防具护甲耐久 +50%',
    kind: 'zombie',
    iconZombieId: 8,
    apply: (m) => {
      m.zombieArmorMult = (m.zombieArmorMult ?? 1) * 1.5;
    },
  },
  {
    id: 'zb_hp2',
    name: '不屈尸潮',
    desc: '僵尸总体生命值 +50%',
    kind: 'zombie',
    iconZombieId: 35,
    apply: (m) => {
      m.zombieHpBonusMult = (m.zombieHpBonusMult ?? 1) * 1.5;
    },
  },
  {
    id: 'zb_spd2',
    name: '极速突袭',
    desc: '僵尸突进速度再提升 +28%',
    kind: 'zombie',
    iconZombieId: 3,
    apply: (m) => {
      m.zombieSpeedBonusMult = (m.zombieSpeedBonusMult ?? 1) * 1.28;
    },
  },
  {
    id: 'zb_boss',
    name: '领袖降临',
    desc: '领袖压迫感：僵尸血量 +35% 且防具护甲 +35%',
    kind: 'zombie',
    iconZombieId: 36,
    apply: (m) => {
      m.zombieHpBonusMult = (m.zombieHpBonusMult ?? 1) * 1.35;
      m.zombieArmorMult = (m.zombieArmorMult ?? 1) * 1.35;
    },
  },
  {
    id: 'zb_leader_shield',
    name: '领袖圣盾',
    desc: '领袖与 BOSS 僵尸获得额外 +500 点护甲保护',
    kind: 'zombie',
    iconZombieId: 43,
    apply: (m) => {
      m.extraLeaderShield = true;
    },
  },
  {
    id: 'zb_iron_march',
    name: '钢铁洪流',
    desc: '敌方全体僵尸一/二类防具耐久额外 +45%',
    kind: 'zombie',
    iconZombieId: 204,
    apply: (m) => {
      m.zombieArmorMult = (m.zombieArmorMult ?? 1) * 1.45;
    },
  },
  {
    id: 'zb_frenzy',
    name: '狂暴尸潮',
    desc: '僵尸移速 +25% 且生命值 +15%',
    kind: 'zombie',
    iconZombieId: 203,
    apply: (m) => {
      m.zombieSpeedBonusMult = (m.zombieSpeedBonusMult ?? 1) * 1.25;
      m.zombieHpBonusMult = (m.zombieHpBonusMult ?? 1) * 1.15;
    },
  },
  {
    id: 'zb_apocalypse',
    name: '末日降临',
    desc: '全僵尸生命值 +40% 且防具护甲 +25%',
    kind: 'zombie',
    iconZombieId: 212,
    apply: (m) => {
      m.zombieHpBonusMult = (m.zombieHpBonusMult ?? 1) * 1.4;
      m.zombieArmorMult = (m.zombieArmorMult ?? 1) * 1.25;
    },
  },
];

export const TRAVEL_STORE_ULTIMATES: TravelUltimateDef[] = [
  { plantId: 901, baseCost: 1400, tagline: '多发爆裂樱桃弹连射清场' },
  { plantId: 909, baseCost: 1300, tagline: '追踪星陨覆盖全屏空中与地面' },
  { plantId: 913, baseCost: 1200, tagline: '32000 超高韧性黑曜石钢铁防线' },
  { plantId: 914, baseCost: 1500, tagline: '重型溅射融合西瓜炮击' },
  { plantId: 903, baseCost: 1350, tagline: '强力吞噬与近战范围爆伤' },
  { plantId: 911, baseCost: 1250, tagline: '护盾与激光反击一体化南瓜' },
  { plantId: 904, baseCost: 1100, tagline: '整行高频穿透寒冰/高伤孢子' },
  { plantId: 924, baseCost: 1000, tagline: '大规模魅惑高阶僵尸倒戈' },
  { plantId: 927, baseCost: 1700, tagline: '超级重装加特林连续火力压制' },
  { plantId: 934, baseCost: 1450, tagline: '阳光与重炮全屏打击卷心菜' },
  { plantId: 300, baseCost: 1650, tagline: '剑气纵横全图收割究极剑仙杨桃' },
  { plantId: 304, baseCost: 1400, tagline: '高额产阳兼备炽阳轰炸火力' },
];

const BUFF_BY_ID = new Map<string, TravelBuffDef>(
  [...TRAVEL_PLANT_BUFFS, ...TRAVEL_ZOMBIE_BUFFS].map((b) => [b.id, b]),
);

export function getTravelBuffById(id: string): TravelBuffDef | undefined {
  return BUFF_BY_ID.get(id);
}

/** Computes runtime battle modifiers combining all active Travel buffs + per-round HP scaling. */
export function computeTravelModifiers(run: TravelRunState): BattleModifiers {
  const m: BattleModifiers = {
    plantDmgMult: 1,
    plantHpMult: 1,
    plantAtkSpeedMult: 1,
    sunGainMult: 1,
    cardCostDiscount: 0,
    cardCdMult: 1,
    critChance: 0,
    zombieHpBonusMult: 1,
    zombieSpeedBonusMult: 1,
    zombieArmorMult: 1,
    hammerCdMult: 1,
    plantLifestealRatio: 0,
    extraLeaderShield: false,
    activeBuffLabels: [],
  };

  if (run.mode === 'cursed') {
    m.plantHpMult = 0.68;
    m.zombieHpBonusMult = 1.45;
    m.sunGainMult = 3.0;
    m.activeBuffLabels!.push('⚡ 诅咒规则：植物承伤加倍 / 僵尸硬度提升 / 阳光获取 ×3');
  } else if (run.mode === 'inferno') {
    m.zombieHpBonusMult = 1.15;
    m.activeBuffLabels!.push('🔥 炼狱规则：僵尸血量 +15% & 双重词条对抗');
  }

  for (const id of run.plantBuffs) {
    const b = BUFF_BY_ID.get(id);
    if (b) {
      b.apply(m);
      m.activeBuffLabels!.push(`🌿 ${b.name}：${b.desc}`);
    }
  }
  for (const id of run.zombieBuffs) {
    const b = BUFF_BY_ID.get(id);
    if (b) {
      b.apply(m);
      m.activeBuffLabels!.push(`🧟 ${b.name}：${b.desc}`);
    }
  }

  const perRoundScale = (run.round - 1) * (run.mode === 'cursed' ? 0.32 : run.mode === 'inferno' ? 0.28 : 0.2);
  if (perRoundScale > 0) {
    m.activeBuffLabels!.unshift(`📈 第 ${run.round}/21 轮尸潮强化：僵尸额外 +${Math.round(perRoundScale * 100)}% 血量`);
  }

  return m;
}

export function buildTravelRunBoardConfig(run: TravelRunState, difficulty: number): BoardConfig {
  const round = Math.max(1, Math.min(21, run.round || 1));
  const sceneIdx = Math.floor((round - 1) / 3) % TRAVEL_SCENES.length;
  const spec = TRAVEL_SCENES[sceneIdx];
  const scene = assets.getScene(spec.sceneId) ?? assets.getScene(0)!;
  const mods = computeTravelModifiers(run);
  const perRoundHpMult = 1 + (round - 1) * (run.mode === 'cursed' ? 0.32 : run.mode === 'inferno' ? 0.28 : 0.2);
  const hasGloveBuff = run.plantBuffs.includes('pb_glv');
  const maxWaves = Math.min(14, 6 + Math.floor(round / 2));

  return {
    mode: 'travel',
    levelKey: `travel-run-${run.mode}-r${round}`,
    title: `经典旅行 · 第 ${round}/21 轮`,
    subtitle: `${spec.label} · ${maxWaves} 波`,
    scene,
    initialSun: (hasGloveBuff ? 400 : 250) + (round >= 5 ? 100 : 0),
    maxWaves,
    firstWaveDelay: 10,
    allowedZombies: spec.zombies,
    prePlants: [],
    presetCards: run.purchasedUltimates.length > 0 ? [...run.purchasedUltimates] : undefined,
    gloveCooldown: hasGloveBuff ? 5 : 10,
    difficulty: run.mode === 'classic' ? difficulty : Math.max(difficulty, 4),
    zombieHpMult: perRoundHpMult,
    zombieSpeedMult: run.mode === 'cursed' ? 1.12 : 1,
    modifiers: mods,
    travelMeta: { isRunRound: true, round, mode: run.mode },
    tips: `第 ${round} 轮（共 21 轮）：过关可领取强力植物词条与旅行积分，用于旅行商店解锁究极配方！`,
  };
}

export function getTravelAdventureStages(difficulty: number): TravelStageSpec[] {
  return TRAVEL_SCENES.map((sc, idx) => {
    const scene = assets.getScene(sc.sceneId) ?? assets.getScene(0)!;
    const pid = [0, 7, 14, 23, 32, 36, 38][idx] ?? 0;
    return {
      label: sc.label,
      iconPlantId: pid,
      sceneId: sc.sceneId,
      config: {
        mode: 'travel',
        levelKey: `trv-adv-${idx + 1}`,
        title: `旅行冒险 · ${sc.label}`,
        subtitle: `12 波巡礼战役`,
        scene,
        initialSun: 300,
        maxWaves: 12,
        firstWaveDelay: 10,
        allowedZombies: sc.zombies,
        prePlants: [],
        gloveCooldown: 8,
        difficulty,
        zombieHpMult: 1.1 + idx * 0.08,
        zombieSpeedMult: 1,
        modifiers: {
          plantDmgMult: 1.15,
          activeBuffLabels: [`🌿 旅行加护：全植物伤害 +15%`],
        },
        tips: `旅行冒险第 ${idx + 1} 站，携 15% 伤害增幅征战 ${scene.label}！`,
      },
    };
  });
}

export function getTravelGameStages(difficulty: number): TravelStageSpec[] {
  const poolZ = [0, 2, 4, 5, 8, 9, 15, 17, 19, 20, 24, 25, 35, 36];
  const mk = (
    key: string,
    label: string,
    sid: number,
    pid: number,
    opts: Partial<BoardConfig>,
  ): TravelStageSpec => {
    const scene = assets.getScene(sid) ?? assets.getScene(0)!;
    return {
      label,
      iconPlantId: pid,
      sceneId: sid,
      config: {
        mode: 'travel',
        levelKey: key,
        title: `旅行游戏 · ${label}`,
        subtitle: opts.subtitle ?? `${scene.label} · 特色模式`,
        scene,
        initialSun: opts.initialSun ?? 500,
        maxWaves: opts.maxWaves ?? 14,
        firstWaveDelay: 10,
        allowedZombies: opts.allowedZombies ?? poolZ,
        prePlants: opts.prePlants ?? [],
        presetCards: opts.presetCards,
        restrictToPresetCards: opts.restrictToPresetCards,
        conveyorMode: opts.conveyorMode,
        conveyorInterval: opts.conveyorInterval,
        gloveCooldown: opts.gloveCooldown ?? 6,
        difficulty,
        zombieHpMult: opts.zombieHpMult ?? 1.2,
        zombieSpeedMult: opts.zombieSpeedMult ?? 1,
        modifiers: opts.modifiers,
        tips: opts.tips,
      },
    };
  };

  return [
    mk('trv-gods', '诸神', 4, 249, {
      initialSun: 800,
      maxWaves: 14,
      gloveCooldown: 0,
      presetCards: [249, 300, 901, 909, 913, 914, 927, 934, 1, 3],
      tips: '【诸神模式】手套无冷却！携究极杨桃与剑仙杨桃迎战高阶尸潮，通关可解锁【剑仙杨桃】！',
      modifiers: {
        plantAtkSpeedMult: 1.25,
        sunGainMult: 1.5,
        activeBuffLabels: ['⚔️ 诸神之力：植物攻速 +25%，阳光获取 +50%，手套无冷却！'],
      },
    }),
    mk('trv-guard', '旅行：守护', 0, 913, {
      initialSun: 600,
      maxWaves: 16,
      prePlants: [
        { thePlantType: 913, theColumn: 5, theRow: 1 },
        { thePlantType: 913, theColumn: 5, theRow: 3 },
      ],
      presetCards: [913, 1, 3, 18, 24, 901, 903, 911],
      tips: '前场预设究极黑曜石高坚果！配合融合输出守住阵地 16 波！',
      modifiers: {
        plantHpMult: 1.35,
        activeBuffLabels: ['🛡️ 守护契约：所有植物血量 +35%'],
      },
    }),
    mk('trv-bowling', '阳光保龄球', 0, 3, {
      initialSun: 500,
      maxWaves: 12,
      conveyorMode: true,
      conveyorInterval: 2.6,
      presetCards: [3, 13, 2, 16, 1004, 1005],
      tips: '【保龄球狂欢】高速传送带源源不断派发坚果、窝瓜、樱桃与辣椒碾压尸潮！',
    }),
    mk('trv-superrand', '超级随机：模仿', 2, 245, {
      initialSun: 650,
      maxWaves: 16,
      presetCards: [245, 227, 1, 12, 901, 909, 914, 924],
      tips: '全随机水陆混战！通关即可解锁【模仿者】与【钻石模仿者】！',
      modifiers: {
        cardCdMult: 0.7,
        activeBuffLabels: ['🎭 模仿幻象：卡牌冷却 -30%'],
      },
    }),
    mk('trv-cycle', '旅行：轮回', 1, 904, {
      initialSun: 550,
      maxWaves: 16,
      presetCards: [904, 910, 6, 7, 8, 10, 11, 25],
      tips: '黑夜轮回激战：全喷菇与磁力体系暴击输出！',
      modifiers: {
        critChance: 0.3,
        plantDmgMult: 1.2,
        activeBuffLabels: ['🌙 夜幕轮回：植物伤害 +20%，暴击率 +30%'],
      },
    }),
    mk('trv-wheat', '大麦之战', 18, 303, {
      initialSun: 700,
      maxWaves: 14,
      presetCards: [303, 1, 35, 36, 901, 913, 934],
      tips: '极寒雪原百变大麦决战，灵活运用融合奇迹防线！',
      modifiers: {
        sunGainMult: 1.35,
        activeBuffLabels: ['🌾 大麦祝福：阳光获取 +35%'],
      },
    }),
  ];
}

export function getTravelChallengeStages(difficulty: number): TravelStageSpec[] {
  const hardZ = [0, 4, 8, 9, 14, 15, 18, 21, 24, 26, 35, 36];
  const mk = (
    key: string,
    label: string,
    sid: number,
    pid: number,
    hp: number,
    spd: number,
    mods: BattleModifiers,
    tips: string,
  ): TravelStageSpec => {
    const scene = assets.getScene(sid) ?? assets.getScene(0)!;
    return {
      label,
      iconPlantId: pid,
      sceneId: sid,
      config: {
        mode: 'travel',
        levelKey: key,
        title: `旅行挑战 · ${label}`,
        subtitle: `${scene.label} · 16 波高难挑战`,
        scene,
        initialSun: 650,
        maxWaves: 16,
        firstWaveDelay: 8,
        allowedZombies: hardZ,
        prePlants: [],
        presetCards: [901, 903, 909, 913, 914, 1, 3, 12],
        gloveCooldown: 6,
        difficulty: Math.max(difficulty, 4),
        zombieHpMult: hp,
        zombieSpeedMult: spd,
        modifiers: mods,
        tips,
      },
    };
  };

  return [
    mk(
      'trv-inferno',
      '旅行：炼狱',
      1,
      902,
      1.6,
      1.15,
      {
        plantDmgMult: 1.35,
        zombieArmorMult: 1.4,
        activeBuffLabels: ['🔥 炼狱试炼：植物伤害 +35% / 僵尸血量 +60% / 护甲 +40%'],
      },
      '正面迎战炼狱级增幅尸潮，充分发挥究极融合输出！',
    ),
    mk(
      'trv-inf-rand',
      '炼狱随机模式',
      3,
      927,
      1.55,
      1.18,
      {
        cardCdMult: 0.65,
        critChance: 0.25,
        activeBuffLabels: ['🌀 炼狱随机：卡牌冷却 -35%，暴击率 +25%，僵尸速度 +18%'],
      },
      '浓雾水域全随机高配僵军来袭！',
    ),
    mk(
      'trv-obsidian',
      '黑曜石巨人的复仇',
      4,
      925,
      1.8,
      1.05,
      {
        plantHpMult: 1.8,
        plantDmgMult: 1.4,
        activeBuffLabels: ['🪨 巨像对决：植物血量 +80%，伤害 +40%，迎战重甲巨人潮！'],
      },
      '巨人军团倾巢而出，用黑曜石防御与爆裂重炮碾碎防线外敌人！',
    ),
    mk(
      'trv-evo',
      '旅行：进化',
      18,
      300,
      2.0,
      1.1,
      {
        plantDmgMult: 1.5,
        plantAtkSpeedMult: 1.3,
        sunGainMult: 1.5,
        activeBuffLabels: ['🌟 究极进化：植物伤害 +50%、攻速 +30%、产阳 +50%；僵尸韧性 ×2！'],
      },
      '依照原版规则，僵尸韧性全面翻倍！解锁究极战力完成终极进化试炼！',
    ),
  ];
}
