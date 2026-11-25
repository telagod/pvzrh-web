import { Container, RenderLayer, Sprite } from 'pixi.js';
import type { LoadedRig, RigNode } from '../types/game';

export type RigPartGroup = 'armor1' | 'armor2' | 'head' | 'arm';

export interface RigVisualState {
  flash?: number;
  chilled?: boolean;
  frozen?: boolean;
  poisoned?: boolean;
  hypno?: boolean;
  ghostAlpha?: number;
}

const ARMOR1_RE = /(?:cone|bucket|helmet|hat|crown|armor|cap|visor|pot|pumpkin)/i;
const ARMOR2_RE = /(?:screendoor|paper|shield|door|ladder|trash|newspaper)/i;
const HEAD_RE = /(?:head|jaw|hair|glasses|pupils|eyebrow|tooth|ear|nose|eye)/i;
const ARM_RE = /(?:outerarm|rightarm|leftarm)/i;

function classifyNodeGroups(nodeName: string): Set<RigPartGroup> {
  const groups = new Set<RigPartGroup>();
  if (ARMOR1_RE.test(nodeName)) {
    groups.add('armor1');
  }
  if (ARMOR2_RE.test(nodeName)) {
    groups.add('armor2');
  }
  if (HEAD_RE.test(nodeName)) {
    groups.add('head');
  }
  if (ARM_RE.test(nodeName)) {
    groups.add('arm');
  }
  return groups;
}

/**
 * Instantiates a compiled Unity 2D skeletal rig in PixiJS 8 using a Transform
 * scene-graph hierarchy for bone matrices and a sortable `RenderLayer` for
 * exact global `sortingOrder` interleaving across parent-child bones.
 */
export class UnityRigInstance {
  readonly rig: LoadedRig;
  readonly container: Container;
  readonly anchorContainer: Container;
  readonly renderLayer: RenderLayer;
  readonly nodeContainers: Container[];
  readonly nodeSprites: (Sprite | null)[];

  private readonly baseTints: number[];
  private readonly isShadow: boolean[];
  private readonly nodeGroups: Set<RigPartGroup>[];
  private readonly hiddenGroups = new Set<RigPartGroup>();
  private readonly appliedSp: number[];
  private readonly appliedAl: number[];
  private shootCursor = 0;

  private visualTint = 0xffffff;
  private visualAlpha = 1;
  private destroyed = false;

  constructor(rig: LoadedRig) {
    this.rig = rig;
    this.container = new Container();
    this.anchorContainer = new Container();
    const [ax, ay] = rig.data.anchor ?? [0, 0];
    this.anchorContainer.position.set(-ax, -ay);

    this.renderLayer = new RenderLayer({ sortableChildren: true });
    this.container.addChild(this.anchorContainer);
    this.container.addChild(this.renderLayer);

    const nodes = rig.data.nodes;
    const count = nodes.length;
    this.nodeContainers = new Array<Container>(count);
    this.nodeSprites = new Array<Sprite | null>(count).fill(null);
    this.baseTints = new Array<number>(count).fill(0xffffff);
    this.isShadow = new Array<boolean>(count).fill(false);
    this.nodeGroups = new Array<Set<RigPartGroup>>(count);
    this.appliedSp = new Array<number>(count).fill(-2);
    this.appliedAl = new Array<number>(count).fill(-1);

    const ppu = rig.data.ppu || 100;

    for (let i = 0; i < count; i++) {
      const n: RigNode = nodes[i];
      const nc = new Container();
      nc.position.set(n.x * ppu, -n.y * ppu);
      nc.rotation = -n.rot;
      nc.scale.set(n.sx, n.sy);
      nc.visible = Boolean(n.a);

      if (n.parent < 0) {
        this.anchorContainer.addChild(nc);
      } else {
        this.nodeContainers[n.parent].addChild(nc);
      }
      this.nodeContainers[i] = nc;

      const nm = n.name || '';
      const shadowFlag = nm.toLowerCase() === 'shadow';
      this.isShadow[i] = shadowFlag;
      this.nodeGroups[i] = shadowFlag ? new Set() : classifyNodeGroups(nm);

      const baseTint = n.tint !== undefined ? n.tint : 0xffffff;
      this.baseTints[i] = baseTint;

      const needsSprite = n.sp >= 0 || rig.animatedSpNodes.has(i);
      if (needsSprite) {
        const tex = n.sp >= 0 ? rig.spriteTextures[n.sp] : rig.spriteTextures[0];
        if (tex) {
          const sp = new Sprite(tex);
          sp.zIndex = n.order * 100 + i;
          sp.tint = baseTint;
          nc.addChild(sp);
          this.renderLayer.attach(sp);
          this.nodeSprites[i] = sp;
          this.applySpriteFrame(i, n.sp, n.al);
        }
      }
    }
  }

  /** Updates a single bone transform and optional sprite swap / alpha for the current frame. */
  applyNodeState(
    nid: number,
    x: number,
    y: number,
    rot: number,
    sx: number,
    sy: number,
    active: number,
    spIdx: number,
    alpha: number,
    fyRot: number,
  ): void {
    if (this.destroyed) {
      return;
    }
    const n = this.rig.data.nodes[nid];
    const nc = this.nodeContainers[nid];
    if (!n || !nc) {
      return;
    }
    const ppu = this.rig.data.ppu || 100;
    nc.position.set(x * ppu, -y * ppu);
    nc.rotation = -rot;
    nc.scale.set(sx * fyRot, sy);

    let groupHidden = false;
    if (this.hiddenGroups.size > 0) {
      for (const g of this.nodeGroups[nid]) {
        if (this.hiddenGroups.has(g)) {
          groupHidden = true;
          break;
        }
      }
    }
    nc.visible = Boolean(active) && !groupHidden;

    if (this.nodeSprites[nid]) {
      this.applySpriteFrame(nid, spIdx, alpha);
    }
  }

  private applySpriteFrame(nid: number, spIdx: number, alpha: number): void {
    const sprite = this.nodeSprites[nid];
    if (!sprite) {
      return;
    }
    const n = this.rig.data.nodes[nid];
    const ppu = this.rig.data.ppu || 100;
    const spMeta = spIdx >= 0 ? this.rig.data.sprites[spIdx] : undefined;

    if (!spMeta || !this.rig.spriteTextures[spIdx] || alpha <= 0.01) {
      sprite.visible = false;
      this.appliedSp[nid] = spIdx;
      return;
    }
    sprite.visible = true;

    if (this.appliedSp[nid] !== spIdx) {
      this.appliedSp[nid] = spIdx;
      sprite.texture = this.rig.spriteTextures[spIdx];
      sprite.anchor.set(spMeta.px, 1 - spMeta.py);
      const sx = (n.fx ? -1 : 1) * (ppu / spMeta.ppu);
      const sy = (n.fy ? -1 : 1) * (ppu / spMeta.ppu);
      sprite.scale.set(sx, sy);
    }

    const effAlpha = this.isShadow[nid] ? alpha : alpha * this.visualAlpha;
    if (Math.abs(this.appliedAl[nid] - effAlpha) > 0.005) {
      this.appliedAl[nid] = effAlpha;
      sprite.alpha = effAlpha;
    }
  }

  /** Shows or hides structural bone groups (armor1, armor2, head, arm). */
  setPartGroupVisible(group: RigPartGroup, visible: boolean): void {
    if (visible) {
      this.hiddenGroups.delete(group);
    } else {
      this.hiddenGroups.add(group);
    }
    for (let i = 0; i < this.nodeGroups.length; i++) {
      if (this.nodeGroups[i].has(group)) {
        const nc = this.nodeContainers[i];
        if (nc && !visible) {
          nc.visible = false;
        }
      }
    }
  }

  /** Sets visual tint/opacity modulation across non-shadow bones without mutating Shadow nodes. */
  setVisualState(state: RigVisualState): void {
    if (this.destroyed) {
      return;
    }
    let tint = 0xffffff;
    if ((state.flash ?? 0) > 0.05) {
      tint = 0xffe4e4;
    } else if (state.frozen) {
      tint = 0x7dd3fc;
    } else if (state.chilled) {
      tint = 0x93c5fd;
    } else if (state.poisoned) {
      tint = 0xc084fc;
    } else if (state.hypno) {
      tint = 0xf472b6;
    }

    const alpha = state.ghostAlpha ?? 1;
    if (tint === this.visualTint && Math.abs(alpha - this.visualAlpha) < 0.005) {
      return;
    }
    this.visualTint = tint;
    this.visualAlpha = alpha;

    for (let i = 0; i < this.nodeSprites.length; i++) {
      const sp = this.nodeSprites[i];
      if (!sp || this.isShadow[i]) {
        continue;
      }
      sp.tint = tint === 0xffffff ? this.baseTints[i] : multiplyTint(this.baseTints[i], tint);
      this.appliedAl[i] = -1;
    }
  }

  /** Hides or shows the rig's ground shadow node. */
  setShadowVisible(visible: boolean): void {
    for (let i = 0; i < this.isShadow.length; i++) {
      if (this.isShadow[i] && this.nodeSprites[i]) {
        this.nodeSprites[i]!.visible = visible;
      }
    }
  }

  /**
   * Computes muzzle offset in local world pixels relative to `this.container` `(0, 0)`,
   * cycling through `shootNodes` when plants have multiple mouths/barrels.
   */
  getShootOffset(): { dx: number; dy: number } {
    const sns = this.rig.data.shootNodes;
    if (!sns || sns.length === 0) {
      return { dx: 26, dy: -42 };
    }
    const nid = sns[this.shootCursor % sns.length];
    this.shootCursor++;
    const nc = this.nodeContainers[nid];
    if (!nc) {
      return { dx: 26, dy: -42 };
    }

    // Walk up hierarchy to container space without requiring a full stage render pass
    let lx = 0;
    let ly = 0;
    let cur: Container | null = nc;
    while (cur && cur !== this.container) {
      const cos = Math.cos(cur.rotation);
      const sin = Math.sin(cur.rotation);
      const sx = cur.scale.x;
      const sy = cur.scale.y;
      const nx = (cos * sx * lx - sin * sy * ly) + cur.position.x;
      const ny = (sin * sx * lx + cos * sy * ly) + cur.position.y;
      lx = nx;
      ly = ny;
      cur = cur.parent;
    }
    return { dx: lx, dy: ly };
  }

  /**
   * Computes current visual bounding box of all visible non-shadow sprites
   * in `this.container` pixel coordinates (used by Almanac auto-fit & previews).
   */
  computeLocalBounds(): { minX: number; maxX: number; minY: number; maxY: number; width: number; height: number } {
    const nodes = this.rig.data.nodes;
    const count = nodes.length;
    const mats: [number, number, number, number, number, number][] = new Array(count);

    // Base matrix includes anchorContainer offset
    const [ax, ay] = this.rig.data.anchor ?? [0, 0];
    const rootAnc: [number, number, number, number, number, number] = [1, 0, 0, 1, -ax, -ay];

    for (let i = 0; i < count; i++) {
      const nc = this.nodeContainers[i];
      const cos = Math.cos(nc.rotation);
      const sin = Math.sin(nc.rotation);
      const sx = nc.scale.x;
      const sy = nc.scale.y;
      const loc: [number, number, number, number, number, number] = [
        cos * sx,
        sin * sx,
        -sin * sy,
        cos * sy,
        nc.position.x,
        nc.position.y,
      ];
      const pid = nodes[i].parent;
      const pm = pid < 0 ? rootAnc : mats[pid];
      mats[i] = [
        pm[0] * loc[0] + pm[2] * loc[1],
        pm[1] * loc[0] + pm[3] * loc[1],
        pm[0] * loc[2] + pm[2] * loc[3],
        pm[1] * loc[2] + pm[3] * loc[3],
        pm[0] * loc[4] + pm[2] * loc[5] + pm[4],
        pm[1] * loc[4] + pm[3] * loc[5] + pm[5],
      ];
    }

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    const ppu = this.rig.data.ppu || 100;

    for (let i = 0; i < count; i++) {
      if (this.isShadow[i] || !this.nodeContainers[i].visible) continue;
      // Check ancestors visible
      let cur = nodes[i].parent;
      let vis = true;
      while (cur >= 0) {
        if (!this.nodeContainers[cur].visible) {
          vis = false;
          break;
        }
        cur = nodes[cur].parent;
      }
      if (!vis) continue;

      const spIdx = this.appliedSp[i] >= 0 ? this.appliedSp[i] : nodes[i].sp;
      if (spIdx < 0 || spIdx >= this.rig.data.sprites.length) continue;
      const sp = this.rig.data.sprites[spIdx];
      const n = nodes[i];
      const spSx = (n.fx ? -1 : 1) * (ppu / (sp.ppu || 100));
      const spSy = (n.fy ? -1 : 1) * (ppu / (sp.ppu || 100));
      const x0 = -sp.px * sp.w * spSx;
      const y0 = -(1 - sp.py) * sp.h * spSy;
      const x1 = x0 + sp.w * spSx;
      const y1 = y0 + sp.h * spSy;
      const M = mats[i];
      const pts: [number, number][] = [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
      ];
      for (const [px, py] of pts) {
        const wx = M[0] * px + M[2] * py + M[4];
        const wy = M[1] * px + M[3] * py + M[5];
        if (wx < minX) minX = wx;
        if (wx > maxX) maxX = wx;
        if (wy < minY) minY = wy;
        if (wy > maxY) maxY = wy;
      }
    }

    if (!Number.isFinite(minX)) {
      return { minX: -40, maxX: 40, minY: -80, maxY: 0, width: 80, height: 80 };
    }
    return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.renderLayer.detachAll();
    this.container.destroy({ children: true });
  }
}

function multiplyTint(a: number, b: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round((ar * br) / 255);
  const g = Math.round((ag * bg) / 255);
  const bl = Math.round((ab * bb) / 255);
  return (r << 16) | (g << 8) | bl;
}
