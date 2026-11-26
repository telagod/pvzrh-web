export const DEFAULT_DIFFICULTY = 2;
export const MIN_DIFFICULTY = 1;
export const MAX_DIFFICULTY = 5;

export type DifficultyLevel = 1 | 2 | 3 | 4 | 5;

export interface DifficultyInfo {
  level: DifficultyLevel;
  name: string;
  shortName: string;
  badge: string;
  color: string;
  isDefault?: boolean;
  hpScale: number;
  countScale: number;
  damageReduction: number;
  speedMult: number;
  summary: string;
}

/**
 * Official PvZ Fusion 4.1 5-tier adjustable difficulty (default level 2 · 普通模式).
 * Diff 4 grants 30% damage reduction (incl. ash) & +0.1x zombie speed;
 * Diff 5 grants 60% damage reduction, +0.2x zombie speed & 4-flag final-wave elite reinforcements.
 */
export const DIFFICULTY_LEVELS: readonly DifficultyInfo[] = [
  {
    level: 1,
    name: '简单模式',
    shortName: '简单',
    badge: '难度1·简单',
    color: '#4ade80',
    hpScale: 0.85,
    countScale: 0.72,
    damageReduction: 0,
    speedMult: 1.0,
    summary: '出怪较少、僵尸血量柔和，适合熟悉融合',
  },
  {
    level: 2,
    name: '普通模式',
    shortName: '普通',
    badge: '难度2·普通',
    color: '#fde047',
    isDefault: true,
    hpScale: 1.0,
    countScale: 1.0,
    damageReduction: 0,
    speedMult: 1.0,
    summary: '默认难度：标准出怪、血量与移速',
  },
  {
    level: 3,
    name: '困难模式',
    shortName: '困难',
    badge: '难度3·困难',
    color: '#fb923c',
    hpScale: 1.0,
    countScale: 1.3,
    damageReduction: 0,
    speedMult: 1.0,
    summary: '僵尸数量增多，波次节奏加快',
  },
  {
    level: 4,
    name: '极难模式',
    shortName: '极难',
    badge: '难度4·极难',
    color: '#f87171',
    hpScale: 1.0,
    countScale: 1.6,
    damageReduction: 0.3,
    speedMult: 1.1,
    summary: '高压出怪；僵尸 30% 减伤（含灰烬），移速 +10%',
  },
  {
    level: 5,
    name: '炼狱模式',
    shortName: '炼狱',
    badge: '难度5·炼狱',
    color: '#c084fc',
    hpScale: 1.0,
    countScale: 1.9,
    damageReduction: 0.6,
    speedMult: 1.2,
    summary: '极限尸潮；僵尸 60% 减伤、移速 +20%，4旗末波增援精英',
  },
];

export function clampDifficulty(val: unknown): DifficultyLevel {
  const n = typeof val === 'number' ? val : Number(val);
  if (!Number.isFinite(n)) return DEFAULT_DIFFICULTY;
  const rounded = Math.round(n);
  if (rounded <= MIN_DIFFICULTY) return 1;
  if (rounded >= MAX_DIFFICULTY) return 5;
  return rounded as DifficultyLevel;
}

export function getDifficultyInfo(level: unknown): DifficultyInfo {
  const lv = clampDifficulty(level);
  return DIFFICULTY_LEVELS[lv - 1];
}

export function formatDifficultyBadge(level: unknown): string {
  return getDifficultyInfo(level).badge;
}

export function formatDifficultyFull(level: unknown): string {
  const info = getDifficultyInfo(level);
  return info.isDefault ? `难度 ${info.level} · ${info.name}（默认）` : `难度 ${info.level} · ${info.name}`;
}
