import { assets } from '../assets/AssetLoader';
import { fusionSystem } from './FusionSystem';
import type { BulletKind, PlantBehavior, PlantDef, ZombieBehavior, ZombieDef } from '../types/game';

const plantBehaviorCache = new Map<number, PlantBehavior>();
const zombieBehaviorCache = new Map<number, ZombieBehavior>();

function hasChain(p: PlantDef | ZombieDef, ...names: string[]): boolean {
  for (const n of names) {
    if (p.scriptClass === n || p.baseChain.includes(n)) {
      return true;
    }
  }
  return false;
}

function hasTag(p: PlantDef | ZombieDef, ...tags: string[]): boolean {
  for (const t of tags) {
    if (p.tags.includes(t)) {
      return true;
    }
  }
  return false;
}

function collectAncestorIds(plantId: number, depth = 0, out = new Set<number>()): Set<number> {
  if (depth > 4 || out.has(plantId)) {
    return out;
  }
  out.add(plantId);
  const parents = fusionSystem.getPrimaryParents(plantId);
  if (parents) {
    collectAncestorIds(parents[0], depth + 1, out);
    collectAncestorIds(parents[1], depth + 1, out);
  }
  return out;
}

function ancestorInfo(plantId: number): {
  ids: Set<number>;
  classes: Set<string>;
  tags: Set<string>;
  enNames: Set<string>;
} {
  const ids = collectAncestorIds(plantId);
  const classes = new Set<string>();
  const tags = new Set<string>();
  const enNames = new Set<string>();
  for (const id of ids) {
    const p = assets.getPlant(id);
    if (!p) continue;
    if (p.scriptClass) classes.add(p.scriptClass);
    for (const c of p.baseChain) classes.add(c);
    for (const t of p.tags) tags.add(t);
    if (p.en) enNames.add(p.en.toLowerCase());
  }
  return { ids, classes, tags, enNames };
}

function inferBulletKind(p: PlantDef, anc: ReturnType<typeof ancestorInfo>): BulletKind {
  const en = p.en.toLowerCase();
  const cls = p.scriptClass.toLowerCase();
  const hasFire = anc.tags.has('FirePlants') || anc.tags.has('TorchPlants') || anc.classes.has('Jalapeno') || anc.classes.has('TorchWood') || cls.includes('fire') || en.includes('fire');
  const hasIce = anc.tags.has('IcePlants') || anc.classes.has('IceShroom') || anc.classes.has('WinterMelon') || cls.includes('snow') || cls.includes('ice') || en.includes('snow') || en.includes('ice');
  const hasCherry = anc.ids.has(2) || anc.classes.has('CherryBomb') || cls.includes('cherry') || en.includes('cherry');
  const hasDoom = anc.ids.has(11) || anc.classes.has('DoomShroom') || cls.includes('doom') || en.includes('doom');
  const hasHypno = anc.ids.has(8) || cls.includes('hypno') || en.includes('hypno');
  const hasSun = anc.ids.has(1) || anc.classes.has('SunFlower') || cls.includes('sun') || en.includes('sun');
  const hasIron = anc.ids.has(4) || anc.ids.has(224) || cls.includes('iron') || cls.includes('bucket');

  if (hasChain(p, 'Melonpult') || cls.includes('melon')) {
    return hasIce ? 'wintermelon' : 'melon';
  }
  if (hasChain(p, 'Cornpult')) {
    return 'kernel';
  }
  if (hasChain(p, 'Cabbage')) {
    return 'cabbage';
  }
  if (hasChain(p, 'StarFruit')) {
    if (anc.ids.has(915) || p.cost >= 350) return 'ultimatestar';
    if (hasFire || hasCherry) return 'redstar';
    return 'star';
  }
  if (hasChain(p, 'Cactus')) {
    return 'cactus';
  }
  if (hasChain(p, 'SmallPuff', 'FumeShroom', 'GloomShroom')) {
    return 'puff';
  }
  if (hasDoom) return 'doompea';
  if (hasCherry) return 'cherrypea';
  if (hasIce) return 'snowpea';
  if (hasFire) return hasDoom ? 'superfireball' : 'firepea';
  if (hasHypno) return 'hypnopea';
  if (hasIron) return 'ironpea';
  if (hasSun) return 'sunpea';
  return 'pea';
}

/**
 * Maps a plant's real Unity `scriptClass`, `baseChain`, `tags`, `layer`, ScriptableObject
 * numeric stats, and `MixData` parent ancestry into structured gameplay behavior.
 */
export function getPlantBehavior(plantId: number): PlantBehavior {
  const cached = plantBehaviorCache.get(plantId);
  if (cached) {
    return cached;
  }
  const p = assets.getPlant(plantId);
  if (!p) {
    return makeDefaultBehavior();
  }

  const anc = ancestorInfo(plantId);
  const cls = p.scriptClass;
  const enL = p.en.toLowerCase();
  const infoL = (p.info || '').toLowerCase();

  const b: PlantBehavior = {
    kind: 'passive',
    bulletKind: inferBulletKind(p, anc),
    shotCount: 1,
    lanes: 'single',
    damage: p.dmg > 0 ? p.dmg : 20,
    attackInterval: p.atkIv > 0 ? p.atkIv : 1.5,
    rangeCols: 10,
    sunAmount: 25,
    produceInterval: p.prodIv > 0 ? p.prodIv : 25,
    maxHp: p.hp > 0 ? p.hp : 300,
    thornsDamage: 0,
    regenPerSec: 0,
    chillDur: anc.tags.has('IcePlants') ? 4 : 0,
    freezeDur: 0,
    butterDur: 0,
    splashRadius: 0,
    splashRatio: 0,
    knockbackPx: 0,
    hypnoOnHit: anc.ids.has(8) || cls.toLowerCase().includes('hypno'),
    sunOnHit: false,
    stackable3: hasTag(p, 'PuffPlants') || p.id === 6 || p.id === 19 || anc.ids.has(6),
    tallBlock: hasTag(p, 'TallNutPlants') || hasChain(p, 'TallNut', 'TallNutFootball', 'HolographicPlant'),
    nocturnalSleep: false,
    aquaticOnly: p.layer === 'Lily' || hasTag(p, 'WaterPlants', 'KelpPlants') || p.id === 19,
    explodeRadius: 155,
    explodeDamage: p.dmg >= 600 ? p.dmg : 1800,
    triggerRangePx: 42,
    isHeatSource:
      p.id === 35 ||
      p.id === 18 ||
      p.id === 16 ||
      p.id === 254 ||
      p.id === 902 ||
      p.id === 304 ||
      hasTag(p, 'TorchPlants', 'FirePlants') ||
      hasChain(p, 'TorchWood', 'AdvancedFurnuce'),
    isUltimateSpecial:
      p.id === 909 || p.id === 300 || p.id === 311
        ? 'star_rain'
        : p.id === 911 || p.id === 946
          ? 'laser'
          : p.id === 904
            ? 'frost_fume'
            : p.id === 903
              ? 'cherry_god'
              : p.id === 913 || p.id === 308
                ? 'obsidian_wall'
                : p.id === 304 || p.id === 954
                  ? 'solar_beam'
                  : p.id === 924
                    ? 'hypno_pulse'
                    : p.id === 901 || p.id === 301
                      ? 'cherry_gatling'
                      : undefined,
  };

  // Multi-shot overrides from real class & ancestry (not Chinese guesses)
  if (enL.includes('gatling') || cls.toLowerCase().includes('gatling')) {
    b.shotCount = 4;
  } else if (enL.includes('repeater') || cls.toLowerCase().includes('repeater') || anc.classes.has('SplitPea')) {
    b.shotCount = 2;
  }
  if (anc.ids.has(14) || hasChain(p, 'ThreePeater')) {
    b.lanes = 'three';
  } else if (hasChain(p, 'StarFruit', 'SwordStarfruit')) {
    b.lanes = 'five';
  } else if (hasChain(p, 'CattailGirl') || enL.includes('cattail') || cls.toLowerCase().includes('cattail')) {
    b.lanes = 'homing';
  } else if (hasChain(p, 'Thrower', 'Cabbage', 'Cornpult', 'Melonpult', 'WaterAloes')) {
    b.lanes = 'lob';
    if (p.atkIv <= 0) b.attackInterval = 2.9;
  } else if (hasChain(p, 'FumeShroom', 'GloomShroom') || cls.toLowerCase().includes('fume')) {
    b.lanes = 'pierce_all';
    b.rangeCols = 4.5;
  } else if (hasChain(p, 'SmallPuff')) {
    b.lanes = 'pierce_short';
    b.rangeCols = 3.5;
  }

  // Splash & secondary bullet effects
  if (b.bulletKind === 'melon' || b.bulletKind === 'wintermelon') {
    b.splashRadius = 90;
    b.splashRatio = 0.45;
  } else if (b.bulletKind === 'cherrypea' || b.bulletKind === 'firepea' || b.bulletKind === 'superfireball') {
    b.splashRadius = 75;
    b.splashRatio = 0.5;
  } else if (b.bulletKind === 'doompea') {
    b.splashRadius = 110;
    b.splashRatio = 0.65;
  }
  if (b.bulletKind === 'snowpea' || b.bulletKind === 'wintermelon') {
    b.chillDur = 4.5;
  }
  if (b.bulletKind === 'ironpea') {
    b.knockbackPx = 10;
  }

  // Sun-nut & Thorn-nut fusion traits
  if (hasTag(p, 'WallNutPlants') || hasChain(p, 'WallNut', 'BigWallNut', 'Bamboo')) {
    if (anc.ids.has(1) || anc.classes.has('SunFlower')) {
      b.sunOnHit = true;
    }
    if (anc.ids.has(17) || anc.classes.has('Caltrop') || anc.classes.has('Thorns')) {
      b.thornsDamage = 40;
    }
    if (anc.ids.has(2) || anc.ids.has(16)) {
      b.thornsDamage = Math.max(b.thornsDamage, 35);
    }
    if (p.hp >= 8000 || cls.toLowerCase().includes('obsidian') || cls.toLowerCase().includes('diamond')) {
      b.regenPerSec = 25;
    }
  }

  // Determine primary archetype `kind` from concrete Unity scriptClass / baseChain
  const isShooter = hasChain(p, 'Shooter', 'Attacker', 'Thrower', 'CobCannon') || p.atkIv > 0;
  const isProducer =
    hasChain(p, 'Producer', 'SunFlower', 'TwinFlower', 'Marigold', 'FireSunshroom') || p.prodIv > 0;

  if (p.layer === 'Lily' || hasChain(p, 'LilyPad')) {
    b.kind = isProducer ? 'producer' : isShooter ? 'shooter' : 'lilypad';
    b.aquaticOnly = true;
  } else if (p.layer === 'Pot' || hasChain(p, 'Pot', 'XXSPot')) {
    b.kind = isProducer ? 'producer' : isShooter ? 'shooter' : 'flowerpot';
  } else if (p.layer === 'Pumpkin' || hasChain(p, 'Pumpkin')) {
    b.kind = isShooter ? 'shooter' : 'pumpkin';
    b.thornsDamage = anc.ids.has(17) || anc.classes.has('Caltrop') ? 35 : 0;
  } else if (hasChain(p, 'CherryBomb', 'CherryJalapeno') && !isShooter) {
    b.kind = cls === 'CherryJalapeno' ? 'instant_row' : 'instant_bomb';
    b.explodeRadius = 175;
    b.explodeDamage = p.dmg >= 300 ? p.dmg : 1800;
  } else if (hasChain(p, 'Jalapeno') && !isShooter) {
    b.kind = 'instant_row';
    b.explodeDamage = 1800;
  } else if (hasChain(p, 'DoomShroom') && !isShooter) {
    b.kind = 'instant_doom';
    b.explodeRadius = 290;
    b.explodeDamage = 1800;
    if (hasTag(p, 'IcePlants')) {
      b.freezeDur = 4.5;
      b.chillDur = 12;
    }
  } else if (hasChain(p, 'IceShroom') && !isShooter) {
    b.kind = 'instant_ice';
    b.freezeDur = 4.5;
    b.chillDur = 15;
    b.explodeDamage = Math.max(40, p.dmg);
  } else if (hasChain(p, 'PotatoMine') && !isShooter) {
    b.kind = 'mine';
    b.explodeRadius = 115;
    b.explodeDamage = p.dmg >= 600 ? p.dmg : 1800;
  } else if (hasChain(p, 'Squash')) {
    b.kind = 'squash';
    b.explodeRadius = 110;
    b.explodeDamage = p.dmg >= 600 ? p.dmg : 1800;
  } else if (hasChain(p, 'Chomper')) {
    b.kind = 'chomper';
    b.explodeDamage = Math.max(1800, p.dmg);
  } else if (hasChain(p, 'Caltrop', 'Thorns')) {
    b.kind = 'spike';
    b.damage = p.dmg > 0 ? p.dmg : 20;
    b.attackInterval = p.atkIv > 0 ? p.atkIv : 1.0;
  } else if (hasChain(p, 'TorchWood', 'AdvancedFurnuce')) {
    b.kind = isShooter ? 'shooter' : 'torch';
  } else if (hasChain(p, 'Garlic')) {
    b.kind = 'garlic';
  } else if (hasChain(p, 'Plantern')) {
    b.kind = isShooter ? 'shooter' : 'plantern';
  } else if (hasChain(p, 'Blover')) {
    b.kind = 'blover';
  } else if (hasChain(p, 'Magnetshroom', 'MagnetBox')) {
    b.kind = 'magnet';
  } else if (hasChain(p, 'Tanglekelp')) {
    b.kind = 'kelp';
    b.aquaticOnly = true;
  } else if (hasChain(p, 'Umbrellaleaf')) {
    b.kind = isShooter ? 'shooter' : 'umbrella';
  } else if (hasChain(p, 'Gravebuster')) {
    b.kind = 'gravebuster';
  } else if (p.id === 8 || enL === 'hypnoshroom') {
    b.kind = 'hypno';
    b.hypnoOnHit = true;
  } else if (isShooter && isProducer) {
    b.kind = 'shooter_producer';
  } else if (isShooter) {
    b.kind = 'shooter';
  } else if (isProducer) {
    b.kind = 'producer';
    b.sunAmount = cls.includes('Twin') || cls.includes('Painting') || p.cost >= 125 ? 50 : 25;
  } else if (hasTag(p, 'WallNutPlants', 'BigNutPlants') || hasChain(p, 'WallNut', 'BigWallNut', 'Bamboo', 'BucketPlant', 'HolographicPlant', 'FrozenPear')) {
    b.kind = 'wall';
  } else {
    b.kind = 'passive';
  }

  // Fallback for plants like SunShroom hybrids whose prodIv is stored in atkIv slot (e.g. BigSunShroom atkIv=20)
  if ((cls.includes('SunShroom') || enL.includes('sunshroom')) && p.prodIv <= 0 && p.atkIv >= 15) {
    b.kind = 'producer';
    b.produceInterval = p.atkIv;
    b.sunAmount = p.id === 351 ? 50 : 25;
  }

  // Note sunflower doubles
  if (infoL.includes('一次产生两颗') || infoL.includes('双倍阳光') || hasChain(p, 'TwinFlower')) {
    b.sunAmount = 50;
  }

  plantBehaviorCache.set(plantId, b);
  return b;
}

function makeDefaultBehavior(): PlantBehavior {
  return {
    kind: 'passive',
    bulletKind: 'pea',
    shotCount: 1,
    lanes: 'single',
    damage: 20,
    attackInterval: 1.5,
    rangeCols: 10,
    sunAmount: 25,
    produceInterval: 25,
    maxHp: 300,
    thornsDamage: 0,
    regenPerSec: 0,
    chillDur: 0,
    freezeDur: 0,
    butterDur: 0,
    splashRadius: 0,
    splashRatio: 0,
    knockbackPx: 0,
    hypnoOnHit: false,
    sunOnHit: false,
    stackable3: false,
    tallBlock: false,
    nocturnalSleep: false,
    aquaticOnly: false,
    explodeRadius: 150,
    explodeDamage: 1800,
    triggerRangePx: 42,
  };
}

/**
 * Maps a zombie's real Unity `scriptClass`, `baseChain`, `a1`/`a2` armor, and `tags`
 * into clean movement, armor, and special-mechanic properties.
 */
export function getZombieBehavior(zombieId: number): ZombieBehavior {
  const cached = zombieBehaviorCache.get(zombieId);
  if (cached) {
    return cached;
  }
  const z = assets.getZombie(zombieId);
  if (!z) {
    return {
      speedPxPerSec: 21,
      biteDps: 80,
      armor1Type: 'none',
      armor2Type: 'none',
      canVault: false,
      canPogo: false,
      flying: false,
      aquatic: false,
      gargantuar: false,
      vehicle: false,
      explodeTimer: 0,
      enrageOnArmor2Break: false,
      isBoss: false,
      isLeader: false,
    };
  }

  const cls = z.scriptClass;
  const enL = z.en.toLowerCase();

  let speed = 21;
  if (hasChain(z, 'ZombieFootball') || cls.includes('Football')) {
    speed = 42;
  } else if (hasChain(z, 'PolevaulterZombie') || cls.includes('Polevaulter')) {
    speed = 38;
  } else if (hasChain(z, 'DolphinriderZ', 'SnowDolphinrider')) {
    speed = 34;
  } else if (hasChain(z, 'JackboxZombie', 'SuperJackboxZombie')) {
    speed = 34;
  } else if (hasChain(z, 'PogoZombie', 'SuperPogoZombie')) {
    speed = 32;
  } else if (hasChain(z, 'FlagZombie')) {
    speed = 26;
  } else if (hasChain(z, 'DriverZombie', 'SuperDriverZombie', 'CatapultZombie')) {
    speed = 24;
  } else if (hasChain(z, 'Gargantuar', 'IronGargantuar')) {
    speed = 18;
  } else if (hasTag(z, 'IsAirShipZombie')) {
    speed = 19;
  }

  let armor1Type: ZombieBehavior['armor1Type'] = 'none';
  if (z.a1 > 0) {
    if (cls.includes('Cone') || enL.includes('cone')) {
      armor1Type = 'cone';
    } else if (cls.includes('Ice') || enL.includes('ice')) {
      armor1Type = 'ice';
    } else if (cls.includes('Bucket') || cls.includes('Football') || enL.includes('iron') || enL.includes('bucket') || z.a1 >= 700) {
      armor1Type = 'bucket';
    } else {
      armor1Type = 'cone';
    }
  }

  let armor2Type: ZombieBehavior['armor2Type'] = 'none';
  if (z.a2 > 0) {
    if (cls.includes('Paper') || enL.includes('paper')) {
      armor2Type = 'paper';
    } else if (cls.includes('Trash') || enL.includes('trash')) {
      armor2Type = 'trash';
    } else {
      armor2Type = 'door';
    }
  }

  const isBoss = hasTag(z, 'BossZombies') || z.hp >= 15000;
  const isLeader = hasTag(z, 'UltimateZombie', 'EliteZombie') || isBoss;

  const beh: ZombieBehavior = {
    speedPxPerSec: speed,
    biteDps: Math.max(50, z.atk || 50) * 1.4,
    armor1Type,
    armor2Type,
    canVault: hasChain(z, 'PolevaulterZombie') || cls.includes('Polevaulter'),
    canPogo: hasChain(z, 'PogoZombie', 'SuperPogoZombie'),
    flying: hasTag(z, 'IsAirZombie', 'IsAirShipZombie') || cls.includes('Balloon') || cls.includes('Kirov'),
    aquatic: hasTag(z, 'WaterZombie') || cls.includes('Snorkle') || cls.includes('Dolphin') || cls.includes('Submarine'),
    gargantuar: hasTag(z, 'IsGargantuar') || hasChain(z, 'Gargantuar', 'IronGargantuar'),
    vehicle: hasTag(z, 'IsDriverZombie') || hasChain(z, 'DriverZombie', 'SuperDriverZombie', 'CatapultZombie'),
    explodeTimer: hasChain(z, 'JackboxZombie', 'SuperJackboxZombie') ? 10 + Math.random() * 8 : 0,
    enrageOnArmor2Break: armor2Type === 'paper',
    isBoss,
    isLeader,
  };

  zombieBehaviorCache.set(zombieId, beh);
  return beh;
}
