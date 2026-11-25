import type { SaveProfile } from '../types/game';

export interface PlantUnlockRule {
  hint: string;
  check: (p: SaveProfile) => boolean;
}

/** Exact Unity `SeedLibrary/NormalCards` sequence (Day -> Night -> Pool -> Fog -> Roof -> Snow). */
export const NORMAL_CARD_IDS: number[] = [
  0, 1, 2, 3, 4, 5, 256, 1027, 254,
  6, 7, 8, 9, 10, 11, 1070, 239,
  12, 13, 14, 15, 16, 17, 18, 1060, 253,
  19, 20, 21, 22, 23, 24, 25, 1067, 245,
  26, 27, 28, 29, 30, 31, 32, 1120, 244,
  35, 36, 33, 37, 38, 39, 233, 1247, 40, 41, 42, 43, 44,
];

/** Exact Unity `SeedLibrary/ColorfulCards` + `SpecialCardPlants` order. */
export const COLORFUL_CARD_IDS: number[] = [
  252, 249, 248, 243, 242, 241, 1109, 238, 237, 236, 235, 229, 227, 224, 225, 223, 222, 220, 34, 210,
];

/** Maps `PageUnlockChallenge` stage keys (`uch-*`) to the super plant unlocked on clear. */
export const SUPER_CHALLENGE_UNLOCKS: Record<string, number> = {
  'uch-1005': 1005,
  'uch-1013': 1013,
  'uch-1026': 1026,
  'uch-1046': 1046,
  'uch-1052': 1052,
  'uch-1059': 1059,
  'uch-1104': 1104,
  'uch-1110': 1110,
  'uch-1126': 1126,
  'uch-1148': 1148,
  'uch-1220': 1220,
  'uch-244': 244,
};

const NORMAL_SET = new Set(NORMAL_CARD_IDS);
const COLORFUL_SET = new Set(COLORFUL_CARD_IDS);

function hasStar(p: SaveProfile, key: string): boolean {
  return p.starMainCleared.includes(key) || p.starSubCleared.includes(key);
}

function hasChallenge(p: SaveProfile, ...keys: string[]): boolean {
  return keys.some((k) => p.clearedChallenges.includes(k));
}

function advOrStar(
  minAdv: number,
  starKey: string,
  hint: string,
  fusedId?: number,
): PlantUnlockRule {
  return {
    hint,
    check: (p) =>
      p.advLevel >= minAdv ||
      hasStar(p, starKey) ||
      (fusedId !== undefined && p.discoveredFusions.includes(fusedId)),
  };
}

function snowRule(chalKey: string, starKey: string, hint: string): PlantUnlockRule {
  return {
    hint,
    check: (p) => hasChallenge(p, chalKey) || hasStar(p, starKey),
  };
}

function superRule(chalKey: string, plantId: number, label: string): PlantUnlockRule {
  return {
    hint: `通关高级挑战「${label}」或合成发现解锁`,
    check: (p) => hasChallenge(p, chalKey) || p.discoveredFusions.includes(plantId),
  };
}

function customRule(hint: string, check: (p: SaveProfile) => boolean): PlantUnlockRule {
  return { hint, check };
}

export const PLANT_UNLOCK_RULES: Record<number, PlantUnlockRule> = {
  // Starter
  0: { hint: '初始解锁（冒险 1-1 可用）', check: () => true },
  1: { hint: '初始解锁（冒险 1-1 可用）', check: () => true },

  // Day (1-1 .. 1-9)
  2: advOrStar(2, 'star-main-1-1', '通关冒险 1-1 解锁'),
  3: advOrStar(3, 'star-main-1-2', '通关冒险 1-2 解锁'),
  4: advOrStar(5, 'star-main-1-4', '通关冒险 1-4 解锁'),
  5: advOrStar(6, 'star-main-1-5', '通关冒险 1-5 解锁'),
  256: advOrStar(7, 'star-sub-1-4', '通关冒险 1-6 或星辉 1-支线4 解锁'),
  1027: advOrStar(9, 'star-main-1-6', '通关冒险 1-8 或局内双坚果融合解锁', 1027),
  254: advOrStar(10, 'star-main-1-6', '通关冒险 1-9（白天完结）解锁'),
  6: advOrStar(10, 'star-main-1-6', '通关冒险 1-9（白天完结）解锁'),

  // Night (2-1 .. 2-9)
  7: advOrStar(11, 'star-main-2-1', '通关冒险 2-1 解锁'),
  8: advOrStar(12, 'star-main-2-2', '通关冒险 2-2 解锁'),
  9: advOrStar(14, 'star-main-2-3', '通关冒险 2-4 解锁'),
  10: advOrStar(15, 'star-main-2-4', '通关冒险 2-5 解锁'),
  11: advOrStar(16, 'star-main-2-5', '通关冒险 2-6 解锁'),
  1070: advOrStar(18, 'star-main-2-6', '通关冒险 2-8 或合成发现解锁', 1070),
  239: advOrStar(19, 'star-main-2-6', '通关冒险 2-9（黑夜完结）解锁'),
  12: advOrStar(19, 'star-main-2-6', '通关冒险 2-9（黑夜完结）解锁'),

  // Pool (3-1 .. 3-9)
  13: advOrStar(20, 'star-main-3-1', '通关冒险 3-1 解锁'),
  14: advOrStar(21, 'star-main-3-2', '通关冒险 3-2 解锁'),
  15: advOrStar(22, 'star-main-3-3', '通关冒险 3-3 解锁'),
  16: advOrStar(23, 'star-main-3-4', '通关冒险 3-4 解锁'),
  17: advOrStar(24, 'star-main-3-5', '通关冒险 3-5 解锁'),
  18: advOrStar(25, 'star-sub-3-3', '通关冒险 3-6 或星辉 3-支线3 解锁'),
  1060: advOrStar(26, 'star-main-3-6', '通关冒险 3-7 或合成发现解锁', 1060),
  253: advOrStar(28, 'star-main-3-6', '通关冒险 3-9（泳池完结）解锁'),
  19: advOrStar(28, 'star-main-3-6', '通关冒险 3-9（泳池完结）解锁'),

  // Fog (4-1 .. 4-9)
  20: advOrStar(29, 'star-main-4-1', '通关冒险 4-1 解锁'),
  21: advOrStar(30, 'star-main-4-2', '通关冒险 4-2 解锁'),
  22: advOrStar(32, 'star-main-4-3', '通关冒险 4-4 解锁'),
  23: advOrStar(33, 'star-main-4-4', '通关冒险 4-5 解锁'),
  24: advOrStar(34, 'star-main-4-5', '通关冒险 4-6 解锁'),
  25: advOrStar(35, 'star-sub-4-3', '通关冒险 4-7 或星辉 4-支线3 解锁'),
  1067: advOrStar(36, 'star-main-4-6', '通关冒险 4-8 或合成发现解锁', 1067),
  245: advOrStar(37, 'star-main-4-6', '通关冒险 4-9（浓雾完结）解锁'),
  26: advOrStar(37, 'star-main-4-6', '通关冒险 4-9（浓雾完结）解锁'),
  27: advOrStar(37, 'star-main-4-6', '通关冒险 4-9（浓雾完结）解锁'),

  // Roof (5-1 .. 5-9)
  28: advOrStar(39, 'star-main-5-2', '通关冒险 5-2 解锁'),
  29: advOrStar(40, 'star-main-5-3', '通关冒险 5-3 解锁'),
  30: advOrStar(41, 'star-main-5-4', '通关冒险 5-4 解锁'),
  31: advOrStar(42, 'star-main-5-5', '通关冒险 5-5 解锁'),
  32: advOrStar(43, 'star-sub-5-3', '通关冒险 5-6 或星辉 5-支线3 解锁'),
  1120: advOrStar(44, 'star-main-5-6', '通关冒险 5-7 或合成发现解锁', 1120),
  244: customRule(
    '通关冒险 5-8 或高级挑战「融合洋芋」解锁',
    (p) => p.advLevel >= 45 || hasChallenge(p, 'uch-244'),
  ),

  // Snow (`冒险的时光` / `星辉：雪原`)
  35: snowRule('snow-adv-1', 'star-main-6-1', '通关「冒险的时光」第 1 关或星辉 6-1 解锁'),
  36: snowRule('snow-adv-2', 'star-main-6-2', '通关「冒险的时光」第 2 关或星辉 6-2 解锁'),
  33: snowRule('snow-adv-3', 'star-main-6-3', '通关「冒险的时光」第 3 关或星辉 6-3 解锁'),
  37: snowRule('snow-adv-4', 'star-main-6-4', '通关「冒险的时光」第 4 关或星辉 6-4 解锁'),
  38: snowRule('snow-adv-5', 'star-main-6-5', '通关「冒险的时光」第 5 关或星辉 6-5 解锁'),
  39: snowRule('snow-adv-6', 'star-main-6-6', '通关「冒险的时光」第 6 关或星辉 6-6 解锁'),
  233: snowRule('snow-adv-7', 'star-sub-6-1', '通关「冒险的时光」第 7 关或星辉 6-支线1 解锁'),
  40: snowRule('snow-adv-7', 'star-sub-6-1', '通关「冒险的时光」第 7 关或星辉 6-支线1 解锁'),
  41: snowRule('snow-adv-8', 'star-sub-6-3', '通关「冒险的时光」第 8 关或星辉 6-支线3 解锁'),
  42: snowRule('snow-adv-8', 'star-sub-6-3', '通关「冒险的时光」第 8 关或星辉 6-支线3 解锁'),
  1247: snowRule('snow-adv-9', 'star-sub-6-6', '通关「冒险的时光」第 9 关或星辉 6-支线6 解锁'),
  43: snowRule('snow-adv-9', 'star-sub-6-6', '通关「冒险的时光」第 9 关或星辉 6-支线6 解锁'),
  44: snowRule('snow-adv-9', 'star-sub-6-6', '通关「冒险的时光」第 9 关或星辉 6-支线6 解锁'),

  // Colorful Special Cards (`ColorfulCards` + `SpecialCardPlants`)
  252: customRule('通关迷你游戏「泳池激斗」或任意 2 个挑战关卡解锁', (p) => hasChallenge(p, 'mg-34') || p.clearedChallenges.length >= 2),
  249: customRule('通关星辉挑战「究极杨桃大帝」、旅行游戏「诸神」或星辉 4-支线5 解锁', (p) => hasChallenge(p, 'sc-exp-star') || hasStar(p, 'star-sub-4-5') || p.travel.clearedTravelLevels.includes('trv-gods')),
  248: customRule('通关十旗挑战「泳池」或累计通关 5 个探索关卡解锁', (p) => hasChallenge(p, 'flg-33') || p.clearedExplore.length >= 5),
  243: customRule('通关砸罐子「连锁反应」、迷你游戏「二爷战争」或发现 10 种融合解锁', (p) => hasChallenge(p, 'vase-104', 'mg-30') || p.discoveredFusions.length >= 10),
  242: customRule('通关旅行生存第 3 轮、高级挑战「超级火炬」或星辉 1-支线5 解锁', (p) => hasChallenge(p, 'uch-1052') || hasStar(p, 'star-sub-1-5') || p.travel.bestRound >= 3 || p.travel.clearedTravelLevels.includes('trv-survival')),
  241: customRule('通关迷你游戏「僵尸快跑」或星辉 6-4 解锁', (p) => hasChallenge(p, 'mg-125') || hasStar(p, 'star-main-6-4')),
  1109: customRule('通关星辉挑战「究极樱桃射手」、经典塔防第 8 关或合成发现解锁', (p) => hasChallenge(p, 'sc-exp-gatling', 'td-8') || p.discoveredFusions.includes(1109)),
  238: customRule('通关十旗挑战「白天」或累计通关 3 个探索关卡解锁', (p) => hasChallenge(p, 'flg-13') || p.clearedExplore.length >= 3),
  237: customRule('通关「冒险的时光」第 5 关或推荐关卡「雪夜」解锁', (p) => hasChallenge(p, 'snow-adv-5', 'hot-nightsnow')),
  236: customRule('通关「冒险的时光」第 3 关或「雪原女皇的复仇」解锁', (p) => hasChallenge(p, 'snow-adv-3', 'mg-143')),
  235: customRule('通关迷你游戏「空袭」或十旗挑战「浓雾」解锁', (p) => hasChallenge(p, 'mg-44', 'flg-57')),
  229: customRule('通关星辉挑战「随机模式」或「随机挑战」解锁', (p) => hasChallenge(p, 'sc-random', 'sc-randchal')),
  227: customRule('通关旅行游戏「超级随机：模仿」、6 个星辉支线或「超级随机模式」解锁', (p) => p.starSubCleared.length >= 6 || hasChallenge(p, 'sc-superrand') || p.travel.clearedTravelLevels.includes('trv-superrand')),
  224: customRule('通关十旗挑战「植物僵尸」或「撑杆舞会」解锁', (p) => hasChallenge(p, 'flg-14', 'mg-28')),
  225: customRule('通关十旗挑战「全员随机」或「巨人之怒」解锁', (p) => hasChallenge(p, 'flg-17', 'mg-62')),
  223: customRule('通关「冒险的时光」第 6 关或星辉 6-支线2 解锁', (p) => hasChallenge(p, 'snow-adv-6') || hasStar(p, 'star-sub-6-2')),
  222: customRule('通关迷你游戏「排山倒海」或十旗挑战「屋顶」解锁', (p) => hasChallenge(p, 'mg-38', 'flg-87')),
  220: customRule('通关砸罐子（不走寻常路/绝对火力/有内鬼）、「谁能笑到最后」或星辉无尽泳池解锁', (p) => hasChallenge(p, 'vase-175', 'vase-176', 'vase-177', 'mg-43', 'sc-pool-endless')),
  34: customRule('通关「胆小菇之梦」或十旗「胆小菇之梦」解锁', (p) => hasChallenge(p, 'mg-25', 'flg-26')),
  210: customRule('累计发现 5 种融合或通关任意 1 个探索关卡解锁', (p) => p.discoveredFusions.length >= 5 || p.clearedExplore.length >= 1),

  // Super Challenge (`PageUnlockChallenge`)
  1005: superRule('uch-1005', 1005, '超级樱桃射手'),
  1013: superRule('uch-1013', 1013, '超级大嘴花'),
  1026: superRule('uch-1026', 1026, '超级魅惑菇'),
  1046: superRule('uch-1046', 1046, '超级大喷菇'),
  1052: superRule('uch-1052', 1052, '超级火炬'),
  1059: superRule('uch-1059', 1059, '超级窝草'),
  1104: superRule('uch-1104', 1104, '超级杨桃'),
  1110: superRule('uch-1110', 1110, '超级南瓜'),
  1126: superRule('uch-1126', 1126, '超级投手'),
  1148: superRule('uch-1148', 1148, '超级伞'),
  1220: superRule('uch-1220', 1220, '超级云杉射手'),
};

export const REWARD_TRACKED_PLANT_IDS: number[] = Array.from(
  new Set([
    ...NORMAL_CARD_IDS,
    ...COLORFUL_CARD_IDS,
    ...Object.values(SUPER_CHALLENGE_UNLOCKS),
  ]),
);

export function isNormalCard(id: number): boolean {
  return NORMAL_SET.has(id);
}

export function isColorfulCard(id: number): boolean {
  return COLORFUL_SET.has(id);
}

export function evaluatePlantUnlocked(id: number, prof: SaveProfile): boolean {
  if (prof.unlockAll) return true;
  const rule = PLANT_UNLOCK_RULES[id];
  if (rule) {
    return rule.check(prof) || prof.discoveredFusions.includes(id);
  }
  return prof.discoveredFusions.includes(id) || prof.unlockedPlants.includes(id);
}

export function getPlantUnlockHint(id: number): string {
  return (
    PLANT_UNLOCK_RULES[id]?.hint ??
    '局内通过对应配方融合发现后解锁（或在自由沙盒直接使用）'
  );
}
