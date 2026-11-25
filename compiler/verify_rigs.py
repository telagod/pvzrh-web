#!/usr/bin/env python3
"""
Render compiled skeletal rigs + AnimationClips back to PNG using the exact
Unity Y-up -> Canvas/Pixi Y-down math used by UnityRigInstance.ts & UnityAnimator.ts.
Saves inspection sheet to scratch dir for visual verification.
"""

import json
import math
import os
import sys
from PIL import Image, ImageDraw

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
PUBLIC_DIR = os.path.join(ROOT_DIR, "pvz-web", "public")
ASSETS_DIR = os.path.join(PUBLIC_DIR, "assets")


def mul(M, N):
    a, b, c, d, e, f = M
    g, h, i, j, k, l = N
    return (
        a * g + c * h,
        b * g + d * h,
        a * i + c * j,
        b * i + d * j,
        a * k + c * l + e,
        b * k + d * l + f,
    )


def apply(M, x, y):
    return (M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5])


def sample_track_num(arr, clip, t, is_angle=False):
    if arr is None or len(arr) == 0:
        return None
    if len(arr) == 1:
        return float(arr[0])
    dur = clip["dur"]
    n = len(arr)
    f = max(0.0, min(1.0, t / dur)) * (n - 1) if dur > 0 else 0.0
    i0 = int(math.floor(f))
    i1 = min(n - 1, i0 + 1)
    a = f - i0
    v0, v1 = float(arr[i0]), float(arr[i1])
    if is_angle:
        diff = v1 - v0
        while diff > math.pi:
            diff -= 2 * math.pi
        while diff < -math.pi:
            diff += 2 * math.pi
        return v0 + diff * a
    return v0 * (1.0 - a) + v1 * a


def sample_track_step(arr, clip, t):
    if arr is None or len(arr) == 0:
        return None
    if len(arr) == 1:
        return arr[0]
    dur = clip["dur"]
    n = len(arr)
    f = max(0.0, min(1.0, t / dur)) * (n - 1) if dur > 0 else 0.0
    idx = min(n - 1, max(0, int(round(f))))
    return arr[idx]


def evaluate_pose(rig, base_clip_name=None, base_t=0.0, overlay_clip_name=None, overlay_t=0.0):
    state = []
    for n in rig["nodes"]:
        state.append({
            "x": n["x"],
            "y": n["y"],
            "rot": n["rot"],
            "sx": n["sx"],
            "sy": n["sy"],
            "a": n["a"],
            "sp": n["sp"],
            "al": n["al"],
            "fyRot": 1,
        })

    def apply_clip(cname, tm, force_additive=None):
        if not cname or cname not in rig["clips"]:
            return
        clip = rig["clips"][cname]
        is_add = clip.get("additive", False) if force_additive is None else force_additive
        nodes = rig["nodes"]
        for nid_s, tr in clip["tracks"].items():
            nid = int(nid_s)
            st = state[nid]
            rest = nodes[nid]
            if is_add:
                if nid != 0:
                    if "x" in tr:
                        st["x"] += sample_track_num(tr["x"], clip, tm) - rest["x"]
                    if "y" in tr:
                        st["y"] += sample_track_num(tr["y"], clip, tm) - rest["y"]
                if "rot" in tr:
                    st["rot"] += sample_track_num(tr["rot"], clip, tm, is_angle=True) - rest["rot"]
                if "sx" in tr:
                    v = sample_track_num(tr["sx"], clip, tm)
                    st["sx"] *= (v / rest["sx"]) if abs(rest["sx"]) > 1e-5 else v
                if "sy" in tr:
                    v = sample_track_num(tr["sy"], clip, tm)
                    st["sy"] *= (v / rest["sy"]) if abs(rest["sy"]) > 1e-5 else v
            else:
                if nid != 0:
                    if "x" in tr:
                        st["x"] = sample_track_num(tr["x"], clip, tm)
                    if "y" in tr:
                        st["y"] = sample_track_num(tr["y"], clip, tm)
                if "rot" in tr:
                    st["rot"] = sample_track_num(tr["rot"], clip, tm, is_angle=True)
                if "sx" in tr:
                    st["sx"] = sample_track_num(tr["sx"], clip, tm)
                if "sy" in tr:
                    st["sy"] = sample_track_num(tr["sy"], clip, tm)
            if "a" in tr:
                st["a"] = sample_track_step(tr["a"], clip, tm)
            if "sp" in tr:
                st["sp"] = sample_track_step(tr["sp"], clip, tm)
            if "al" in tr:
                st["al"] = sample_track_num(tr["al"], clip, tm)
            if "fyRot" in tr:
                st["fyRot"] = sample_track_step(tr["fyRot"], clip, tm)

    apply_clip(base_clip_name, base_t, force_additive=False)
    apply_clip(overlay_clip_name, overlay_t)
    return state


def render_rig_frame(rig_json_rel, base_clip=None, base_t=0.0, overlay_clip=None, overlay_t=0.0, size=(240, 260), origin=(120, 220), zoom=1.6):
    rig = json.load(open(os.path.join(ASSETS_DIR, rig_json_rel), "r", encoding="utf-8"))
    atlas = Image.open(os.path.join(PUBLIC_DIR, rig["atlas"])).convert("RGBA")
    ppu = rig["ppu"]
    state = evaluate_pose(rig, base_clip, base_t, overlay_clip, overlay_t)

    # Compute world matrices & effective active state
    n_count = len(rig["nodes"])
    world_M = [None] * n_count
    eff_active = [False] * n_count

    for i, n in enumerate(rig["nodes"]):
        st = state[i]
        tx = st["x"] * ppu
        ty = -st["y"] * ppu
        r = -st["rot"]
        sx = st["sx"] * st["fyRot"]
        sy = st["sy"]
        c, s = math.cos(r), math.sin(r)
        local_M = (c * sx, s * sx, -s * sy, c * sy, tx, ty)
        pid = n["parent"]
        if pid < 0:
            world_M[i] = local_M
            eff_active[i] = bool(st["a"])
        else:
            world_M[i] = mul(world_M[pid], local_M)
            eff_active[i] = eff_active[pid] and bool(st["a"])

    ax, ay = rig.get("anchor", [0.0, 0.0])
    canvas_M = (zoom, 0.0, 0.0, zoom, float(origin[0]), float(origin[1]))
    view_M = mul(canvas_M, (1.0, 0.0, 0.0, 1.0, -float(ax), -float(ay)))
    draw_list = []
    for i, n in enumerate(rig["nodes"]):
        if not eff_active[i]:
            continue
        sp_idx = state[i]["sp"]
        al = state[i]["al"]
        if sp_idx < 0 or sp_idx >= len(rig["sprites"]) or al <= 0.02:
            continue
        draw_list.append((n["order"], i, sp_idx, al, n))

    draw_list.sort(key=lambda e: (e[0], e[1]))
    out = Image.new("RGBA", size, (24, 34, 46, 255))

    for _ord, nid, sp_idx, al, n in draw_list:
        sp = rig["sprites"][sp_idx]
        crop = atlas.crop((sp["x"], sp["y"], sp["x"] + sp["w"], sp["y"] + sp["h"]))
        if al < 0.99:
            r_b, g_b, b_b, a_b = crop.split()
            a_b = a_b.point(lambda v: int(v * al))
            crop = Image.merge("RGBA", (r_b, g_b, b_b, a_b))
        sp_sx = (-1.0 if n["fx"] else 1.0) * (ppu / sp["ppu"])
        sp_sy = (-1.0 if n["fy"] else 1.0) * (ppu / sp["ppu"])
        sprite_ax = sp["px"] * sp["w"]
        sprite_ay = (1.0 - sp["py"]) * sp["h"]
        S = (sp_sx, 0.0, 0.0, sp_sy, -sprite_ax * sp_sx, -sprite_ay * sp_sy)
        T = mul(view_M, mul(world_M[nid], S))
        a, b, c, d, e, f = T
        det = a * d - b * c
        if abs(det) < 1e-10:
            continue
        ia, ib = d / det, -b / det
        ic, id_ = -c / det, a / det
        ie, if_ = -(ia * e + ic * f), -(ib * e + id_ * f)
        warped = crop.transform(size, Image.AFFINE, (ia, ic, ie, ib, id_, if_), resample=Image.BICUBIC)
        out.alpha_composite(warped)

    draw = ImageDraw.Draw(out)
    # Mark root origin (green) and shootNodes (red)
    draw.ellipse((origin[0] - 3, origin[1] - 3, origin[0] + 3, origin[1] + 3), fill=(74, 222, 128, 255))
    for sn in rig.get("shootNodes", []):
        wx, wy = apply(mul(view_M, world_M[sn]), 0, 0)
        draw.ellipse((wx - 4, wy - 4, wx + 4, wy + 4), fill=(248, 113, 113, 255))

    return out


def main():
    out_dir = sys.argv[1] if len(sys.argv) > 1 else "/tmp"
    os.makedirs(out_dir, exist_ok=True)

    panels = [
        ("p0_idle_0.0", render_rig_frame("rigs/plants/p_0.json", "idle", 0.0)),
        ("p0_idle+shoot_0.67", render_rig_frame("rigs/plants/p_0.json", "idle", 0.67, "shoot", 0.667)),
        ("p1_sunflower_0.0", render_rig_frame("rigs/plants/p_1.json", "idle", 0.0)),
        ("p1_sunflower_1.0", render_rig_frame("rigs/plants/p_1.json", "idle", 1.0)),
        ("z0_walk_0.0", render_rig_frame("rigs/zombies/z_0.json", "walk", 0.0, size=(240, 280), origin=(120, 240), zoom=1.45)),
        ("z0_walk_0.9", render_rig_frame("rigs/zombies/z_0.json", "walk", 0.9, size=(240, 280), origin=(120, 240), zoom=1.45)),
        ("z0_attack_0.6", render_rig_frame("rigs/zombies/z_0.json", "attack", 0.6, size=(240, 280), origin=(120, 240), zoom=1.45)),
        ("z0_die_1.1", render_rig_frame("rigs/zombies/z_0.json", "die", 1.1, size=(240, 280), origin=(120, 240), zoom=1.45)),
    ]

    sheet = Image.new("RGBA", (240 * 4, 280 * 2), (16, 22, 30, 255))
    draw = ImageDraw.Draw(sheet)
    for idx, (label, im) in enumerate(panels):
        col = idx % 4
        row = idx // 4
        x0, y0 = col * 240, row * 280
        sheet.paste(im, (x0, y0))
        draw.text((x0 + 8, y0 + 8), label, fill=(240, 248, 255, 255))

    out_path = os.path.join(out_dir, "rig_verify_sheet.png")
    sheet.save(out_path)
    print(f"Saved verification sheet: {out_path} ({sheet.size[0]}x{sheet.size[1]})")


if __name__ == "__main__":
    main()
