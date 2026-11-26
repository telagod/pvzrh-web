#!/usr/bin/env python3
"""
Unity-to-Web Asset & Skeletal Animation Compiler for PvZ Fusion 4.1 (pvz-web).

Sources of truth:
  - 植物大战僵尸融合版4.1/PlantsVsZombiesRH_Data/il2cpp_data/Metadata/global-metadata.dat
  - 植物大战僵尸融合版4.1/GameAssembly.dll
  - 植物大战僵尸融合版4.1/PlantsVsZombiesRH_Data/data.unity3d
  - web/game/assets/audio/*.ogg (re-encoded to compact OGG if ffmpeg available)
  - web/game/assets/bg/*.png (converted to crisp WebP)

Outputs under pvz-web/public/assets/:
  - rigs/plants/p_<id>.json & p_<id>.webp     (2D bone rig + AnimationClips + WebP sprite atlas)
  - rigs/zombies/z_<id>.json & z_<id>.webp    (2D bone rig + AnimationClips + WebP sprite atlas)
  - rigs/common/<key>.json & <key>.webp       (lawnmower, poolcleaner, sun, bigsun, squalour)
  - portraits/plants/p_<id>.webp              (UI/card/almanac thumbnails)
  - portraits/zombies/z_<id>.webp             (UI/almanac thumbnails)
  - bullets/b_<id>.webp + sun/bigsun/bluesun/coin_gold/shadow.webp
  - bg/*.webp
  - ui/*.webp
  - audio/*.ogg + data/audio_manifest.json
  - data/catalog.json                         (plants, zombies, recipes, bullets, exploreLevels, izLevels, scenes)
"""

import argparse
import bisect
import concurrent.futures
import json
import math
import os
import re
import shutil
import struct
import subprocess
import sys
import time
import zlib

import UnityPy
from PIL import Image

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
PVZ_WEB_DIR = os.path.join(ROOT_DIR, "pvz-web")
GAME_DATA_DIR = os.path.join(ROOT_DIR, "植物大战僵尸融合版4.1")

DATA_UNITY = os.path.join(GAME_DATA_DIR, "PlantsVsZombiesRH_Data", "data.unity3d")
META_DAT = os.path.join(GAME_DATA_DIR, "PlantsVsZombiesRH_Data", "il2cpp_data", "Metadata", "global-metadata.dat")
GAME_DLL = os.path.join(GAME_DATA_DIR, "GameAssembly.dll")

LEGACY_AUDIO_DIR = os.path.join(ROOT_DIR, "web", "game", "assets", "audio")
LEGACY_BG_DIR = os.path.join(ROOT_DIR, "web", "game", "assets", "bg")

OUT_ASSETS = os.path.join(PVZ_WEB_DIR, "public", "assets")
OUT_RIGS_P = os.path.join(OUT_ASSETS, "rigs", "plants")
OUT_RIGS_Z = os.path.join(OUT_ASSETS, "rigs", "zombies")
OUT_RIGS_C = os.path.join(OUT_ASSETS, "rigs", "common")
OUT_PORTRAITS_P = os.path.join(OUT_ASSETS, "portraits", "plants")
OUT_PORTRAITS_Z = os.path.join(OUT_ASSETS, "portraits", "zombies")
OUT_BULLETS = os.path.join(OUT_ASSETS, "bullets")
OUT_BG = os.path.join(OUT_ASSETS, "bg")
OUT_UI = os.path.join(OUT_ASSETS, "ui")
OUT_AUDIO = os.path.join(OUT_ASSETS, "audio")
OUT_DATA = os.path.join(OUT_ASSETS, "data")

SAMPLE_FPS = 24
WORLD_PPU = 100.0
MAX_PART_DIM = 384

# Import already-verified binary decoders from tools/rebuild_game_data.py
sys.path.insert(0, os.path.join(ROOT_DIR, "tools"))
import rebuild_game_data as rgd  # noqa: E402


# ---------------------------------------------------------------------------
# 1. IL2CPP v31 Class Inheritance Chain Extractor
# ---------------------------------------------------------------------------
def build_class_inheritance_map(meta_path):
    data = open(meta_path, "rb").read()
    hdr = struct.unpack_from("<64i", data, 0)
    str_off = hdr[6]
    td_off, td_sz = hdr[40], hdr[41]

    def rstr(idx):
        p = str_off + idx
        e = data.index(b"\x00", p)
        return data[p:e].decode("utf-8", errors="replace")

    byval_to_td = {}
    td_info = []
    for i in range(td_sz // 88):
        tb = td_off + i * 88
        ni, nsi, byval, _decl, parent = struct.unpack_from("<5i", data, tb)
        name = rstr(ni)
        ns = rstr(nsi)
        byval_to_td[byval] = i
        td_info.append((ns, name, parent))

    chains = {}
    for i, (ns, name, parent) in enumerate(td_info):
        if name.startswith("<") or "d__" in name or "__c" in name:
            continue
        key = f"{ns}.{name}" if ns else name
        chain = [key]
        cur = parent
        seen = {i}
        while cur in byval_to_td:
            pi = byval_to_td[cur]
            if pi in seen:
                break
            seen.add(pi)
            pns, ptn, ppar = td_info[pi]
            if ptn in ("MonoBehaviour", "Behaviour", "Component", "Object") and pns == "UnityEngine":
                break
            if ptn == "Object" and pns == "System":
                break
            chain.append(f"{pns}.{ptn}" if pns else ptn)
            cur = ppar
        if key not in chains or len(chain) > len(chains[key]):
            chains[key] = chain
    return chains


# ---------------------------------------------------------------------------
# 2. Unity AnimationClip Binary Sampler (Streamed + Dense + Constant + PPtr)
# ---------------------------------------------------------------------------
ATTR_IS_ACTIVE = 2086281974
ATTR_ENABLED = 3305885265
ATTR_SPRITE = 0
ATTR_COLOR_A = 304273561
ATTR_POS = 1
ATTR_QUAT = 2
ATTR_SCALE = 3
ATTR_EULER = 4


def parse_streamed_clip_curves(words):
    """Parse StreamedClip uint32 words into {curve_idx: [(time, c0, c1, c2, c3), ...]}."""
    if not words:
        return {}, []
    raw = struct.pack(f"<{len(words)}I", *words)
    pos = 0
    curves = {}
    times_by_curve = {}
    n = len(raw)
    while pos + 8 <= n:
        tm, cnt = struct.unpack_from("<fI", raw, pos)
        pos += 8
        for _ in range(cnt):
            if pos + 20 > n:
                break
            idx, c0, c1, c2, c3 = struct.unpack_from("<I4f", raw, pos)
            pos += 20
            curves.setdefault(idx, []).append((tm, c0, c1, c2, c3))
            times_by_curve.setdefault(idx, []).append(tm)
    return curves, times_by_curve


def sample_streamed(curves, times_by_curve, curve_idx, t):
    keys = curves.get(curve_idx)
    if not keys:
        return None
    ts = times_by_curve[curve_idx]
    i = bisect.bisect_right(ts, t) - 1
    if i < 0:
        i = 0
    kt, c0, c1, c2, c3 = keys[i]
    if kt < -1e30 or kt > 1e30:
        return c3
    dt = t - kt
    return ((c0 * dt + c1) * dt + c2) * dt + c3


def sample_dense(dc, curve_idx, t):
    fc = dc.get("m_FrameCount", 0)
    cc = dc.get("m_CurveCount", 0)
    arr = dc.get("m_SampleArray", ())
    if fc <= 0 or cc <= 0 or curve_idx >= cc or not arr:
        return None
    sr = dc.get("m_SampleRate", 60.0) or 60.0
    bt = dc.get("m_BeginTime", 0.0) or 0.0
    f = (t - bt) * sr
    if f <= 0.0:
        idx = curve_idx
        return arr[idx] if idx < len(arr) else None
    if f >= fc - 1:
        idx = (fc - 1) * cc + curve_idx
        return arr[idx] if idx < len(arr) else None
    i0 = int(math.floor(f))
    i1 = min(i0 + 1, fc - 1)
    alpha = f - i0
    p0 = i0 * cc + curve_idx
    p1 = i1 * cc + curve_idx
    if p1 >= len(arr):
        return arr[p0] if p0 < len(arr) else None
    return arr[p0] * (1.0 - alpha) + arr[p1] * alpha


def binding_channel_count(b):
    if b["typeID"] == 4:
        if b["attribute"] in (ATTR_POS, ATTR_SCALE, ATTR_EULER):
            return 3
        if b["attribute"] == ATTR_QUAT:
            return 4
    return 1


def compress_track(vals, eps=0.0005, decimals=4):
    if not vals:
        return None
    mn = min(vals)
    mx = max(vals)
    if mx - mn < eps:
        return [round(vals[0], decimals)]
    return [round(v, decimals) for v in vals]


def compress_int_track(vals):
    if not vals:
        return None
    first = vals[0]
    if all(v == first for v in vals):
        return [first]
    return vals


def decode_animation_clip(clip_sf, clip_obj, path_to_node_id, crc_to_node_id, resolve_obj, sprite_collector):
    """Compile one Unity AnimationClip into compact sampled tracks & events."""
    t = clip_obj.read_typetree()
    name = (t.get("m_Name") or "clip").strip()
    mc_wrap = t.get("m_MuscleClip", {})
    dur = float(mc_wrap.get("m_StopTime", 0.0) or 0.0)
    if dur <= 0.0:
        dur = 0.04
    loop_flag = mc_wrap.get("m_LoopTime", None)
    if loop_flag is None:
        nl = name.lower()
        loop = any(k in nl for k in ("idle", "walk", "swim", "fly", "move", "loop", "eat", "attack")) and (
            "die" not in nl and "shoot" not in nl and "death" not in nl
        )
    else:
        loop = bool(loop_flag)

    clip_data = mc_wrap.get("m_Clip", {}).get("data", {})
    sc = clip_data.get("m_StreamedClip", {})
    dc = clip_data.get("m_DenseClip", {})
    cc_arr = clip_data.get("m_ConstantClip", {}).get("data", ())
    sc_n = int(sc.get("curveCount", 0))
    dc_n = int(dc.get("m_CurveCount", 0))

    s_curves, s_times = parse_streamed_clip_curves(sc.get("data", ()))

    cbc = t.get("m_ClipBindingConstant", {})
    bindings = cbc.get("genericBindings", ())
    pptr_map = cbc.get("pptrCurveMapping", ())

    n_frames = max(2, int(round(dur * SAMPLE_FPS)) + 1)
    sample_times = [min(dur, (i / (n_frames - 1)) * dur) for i in range(n_frames)]

    def eval_float(ch_idx, tm):
        if ch_idx < sc_n:
            v = sample_streamed(s_curves, s_times, ch_idx, tm)
            return 0.0 if v is None else v
        if ch_idx < sc_n + dc_n:
            v = sample_dense(dc, ch_idx - sc_n, tm)
            return 0.0 if v is None else v
        ci = ch_idx - sc_n - dc_n
        if 0 <= ci < len(cc_arr):
            return float(cc_arr[ci])
        return 0.0

    # Resolve PPtr sprites upfront
    pptr_sprite_ids = []
    for p in pptr_map:
        _, sp_obj = resolve_obj(clip_sf, p.get("m_FileID", 0), p.get("m_PathID", 0))
        if sp_obj and sp_obj.type.name == "Sprite":
            sp_idx = sprite_collector(sp_obj)
            pptr_sprite_ids.append(sp_idx)
        else:
            pptr_sprite_ids.append(-1)

    node_tracks = {}  # node_id -> dict of channel arrays
    float_cursor = 0
    pptr_cursor = 0

    for b in bindings:
        ch_count = binding_channel_count(b)
        path_crc = b["path"] & 0xFFFFFFFF
        nid = crc_to_node_id.get(path_crc)

        if b.get("isPPtrCurve"):
            s_idx = sc_n + pptr_cursor
            pptr_cursor += ch_count
            if nid is not None and b["typeID"] == 212 and b["attribute"] == ATTR_SPRITE:
                vals = []
                for tm in sample_times:
                    raw_v = sample_streamed(s_curves, s_times, s_idx, tm)
                    if raw_v is None:
                        vals.append(-1)
                    else:
                        pi = int(round(raw_v))
                        vals.append(pptr_sprite_ids[pi] if 0 <= pi < len(pptr_sprite_ids) else -1)
                c = compress_int_track(vals)
                if c is not None:
                    node_tracks.setdefault(nid, {})["sp"] = c
            continue

        cur_ch = float_cursor
        float_cursor += ch_count

        if nid is None:
            continue

        tid = b["typeID"]
        attr = b["attribute"]

        if tid == 4 and attr == ATTR_POS:
            xs = [eval_float(cur_ch, tm) for tm in sample_times]
            ys = [eval_float(cur_ch + 1, tm) for tm in sample_times]
            nt = node_tracks.setdefault(nid, {})
            nt["x"] = compress_track(xs, eps=0.0002, decimals=4)
            nt["y"] = compress_track(ys, eps=0.0002, decimals=4)

        elif tid == 4 and attr == ATTR_SCALE:
            sxs = [eval_float(cur_ch, tm) for tm in sample_times]
            sys_ = [eval_float(cur_ch + 1, tm) for tm in sample_times]
            nt = node_tracks.setdefault(nid, {})
            nt["sx"] = compress_track(sxs, eps=0.0004, decimals=4)
            nt["sy"] = compress_track(sys_, eps=0.0004, decimals=4)

        elif tid == 4 and attr == ATTR_EULER:
            ezs = [eval_float(cur_ch + 2, tm) * (math.pi / 180.0) for tm in sample_times]
            eys = [eval_float(cur_ch + 1, tm) for tm in sample_times]
            nt = node_tracks.setdefault(nid, {})
            nt["rot"] = compress_track(ezs, eps=0.0005, decimals=4)
            # Detect Y-180 2D horizontal flip in Euler rotations
            if any(abs(abs(ey) - 180.0) < 30.0 for ey in eys):
                flips = [-1 if abs(abs(ey) - 180.0) < 30.0 else 1 for ey in eys]
                nt["fyRot"] = compress_int_track(flips)

        elif tid == 4 and attr == ATTR_QUAT:
            rots = []
            for tm in sample_times:
                qz = eval_float(cur_ch + 2, tm)
                qw = eval_float(cur_ch + 3, tm)
                r = 2.0 * math.atan2(qz, qw)
                if rots:
                    while r - rots[-1] > math.pi:
                        r -= 2.0 * math.pi
                    while r - rots[-1] < -math.pi:
                        r += 2.0 * math.pi
                rots.append(r)
            node_tracks.setdefault(nid, {})["rot"] = compress_track(rots, eps=0.0005, decimals=4)

        elif (tid == 1 and attr == ATTR_IS_ACTIVE) or (tid == 212 and attr == ATTR_ENABLED):
            acts = [1 if eval_float(cur_ch, tm) >= 0.5 else 0 for tm in sample_times]
            node_tracks.setdefault(nid, {})["a"] = compress_int_track(acts)

        elif tid == 212 and attr == ATTR_COLOR_A:
            als = [max(0.0, min(1.0, eval_float(cur_ch, tm))) for tm in sample_times]
            node_tracks.setdefault(nid, {})["al"] = compress_track(als, eps=0.002, decimals=3)

    events = []
    for ev in t.get("m_Events", ()):
        fn = (ev.get("functionName") or "").strip()
        if fn:
            events.append([round(float(ev.get("time", 0.0)), 4), fn])
    events.sort(key=lambda e: e[0])

    # Convert keys to str for JSON compactness
    tracks_out = {str(nid): tr for nid, tr in node_tracks.items() if tr}

    return {
        "name": name,
        "dur": round(dur, 4),
        "fps": SAMPLE_FPS,
        "frames": n_frames,
        "loop": loop,
        "events": events,
        "tracks": tracks_out,
    }


# ---------------------------------------------------------------------------
# 3. Sprite Trimming & Shelf Atlas Packer
# ---------------------------------------------------------------------------
def extract_trimmed_sprite(sp_obj):
    try:
        sp = sp_obj.read()
        im = sp.image
    except Exception:
        return None
    if im is None or im.width == 0 or im.height == 0:
        return None
    if im.mode != "RGBA":
        im = im.convert("RGBA")

    w0, h0 = im.size
    ppu0 = float(getattr(sp, "m_PixelsToUnits", 100.0) or 100.0)
    px0 = float(sp.m_Pivot.x)
    py0 = float(sp.m_Pivot.y)

    bbox = im.getbbox()
    if bbox:
        x0, y0, x1, y1 = bbox
        x0 = max(0, x0 - 1)
        y0 = max(0, y0 - 1)
        x1 = min(w0, x1 + 1)
        y1 = min(h0, y1 + 1)
        im = im.crop((x0, y0, x1, y1))
        w1, h1 = im.size
        px_pil = px0 * w0
        py_pil = (1.0 - py0) * h0
        px1 = (px_pil - x0) / w1
        py1 = 1.0 - (py_pil - y0) / h1
    else:
        im = Image.new("RGBA", (2, 2), (0, 0, 0, 0))
        w1, h1 = 2, 2
        px1, py1 = 0.5, 0.5

    if max(w1, h1) > MAX_PART_DIM:
        scale = MAX_PART_DIM / max(w1, h1)
        nw = max(1, int(round(w1 * scale)))
        nh = max(1, int(round(h1 * scale)))
        actual_scale = nw / w1
        im = im.resize((nw, nh), Image.LANCZOS)
        ppu1 = ppu0 * actual_scale
    else:
        ppu1 = ppu0

    return {
        "im": im,
        "w": im.width,
        "h": im.height,
        "px": round(px1, 5),
        "py": round(py1, 5),
        "ppu": round(ppu1, 3),
    }


def pack_atlas(sprite_items, pad=2, max_w=2048):
    """Shelf-pack sprite images into one RGBA atlas + metadata list."""
    if not sprite_items:
        atlas = Image.new("RGBA", (4, 4), (0, 0, 0, 0))
        return atlas, []

    indexed = sorted(enumerate(sprite_items), key=lambda x: (-x[1]["h"], -x[1]["w"]))
    # Estimate target width for roughly square atlas
    total_area = sum((s["w"] + pad) * (s["h"] + pad) for s in sprite_items)
    target_w = min(max_w, max(128, int(math.ceil(math.sqrt(total_area) * 1.15))))
    max_item_w = max(s["w"] + pad * 2 for s in sprite_items)
    atlas_w = min(max_w, max(target_w, max_item_w))

    placements = [None] * len(sprite_items)
    cur_x = pad
    cur_y = pad
    row_h = 0

    for orig_idx, item in indexed:
        w, h = item["w"], item["h"]
        if cur_x + w + pad > atlas_w:
            cur_x = pad
            cur_y += row_h + pad
            row_h = 0
        placements[orig_idx] = (cur_x, cur_y, w, h)
        cur_x += w + pad
        row_h = max(row_h, h)

    atlas_h = max(4, cur_y + row_h + pad)
    atlas = Image.new("RGBA", (atlas_w, atlas_h), (0, 0, 0, 0))
    meta = []
    for orig_idx, item in enumerate(sprite_items):
        x, y, w, h = placements[orig_idx]
        atlas.paste(item["im"], (x, y))
        meta.append({
            "x": x,
            "y": y,
            "w": w,
            "h": h,
            "px": item["px"],
            "py": item["py"],
            "ppu": item["ppu"],
        })
    return atlas, meta


# ---------------------------------------------------------------------------
# 4. Prefab Rig Compiler
# ---------------------------------------------------------------------------
PARTICLE_SKIP_RE = re.compile(r"(?:particle|vfx|trail|smoke|spark|glow_fx)", re.I)
SHOOT_PRIMARY_RE = re.compile(r"^(?:shoot\d*|shootpos\d*|firepos\d*|shoot_?\d+|.*_shoot\d*)$", re.I)
SHOOT_FALLBACK_RE = re.compile(r"^(?:.*_mouth\d*|mouth\d*)$", re.I)


def compute_rig_anchor(nodes, ppu, sprites=None):
    """Compute world-scaled ground contact anchor [ax, ay] in Pixi Y-down pixels from active Shadow node or sprite bounds."""
    if not nodes:
        return [0.0, 0.0]
    world_M = [None] * len(nodes)
    for i, n in enumerate(nodes):
        tx = n["x"] * ppu
        ty = -n["y"] * ppu
        r = -n["rot"]
        sx = n["sx"]
        sy = n["sy"]
        c, s = math.cos(r), math.sin(r)
        local_M = (c * sx, s * sx, -s * sy, c * sy, tx, ty)
        pid = n["parent"]
        if pid < 0:
            world_M[i] = local_M
        else:
            M = world_M[pid]
            a, b, c0, d, e, f = M
            g, h, i0, j, k, l = local_M
            world_M[i] = (
                a * g + c0 * h,
                b * g + d * h,
                a * i0 + c0 * j,
                b * i0 + d * j,
                a * k + c0 * l + e,
                b * k + d * l + f,
            )

    shadow_id = None
    candidates = [
        (0, n) for n in nodes if n.get("a") and n.get("parent") == 0 and (n.get("name") or "").lower() == "shadow" and n.get("sp", -1) >= 0
    ] + [
        (1, n) for n in nodes if n.get("a") and (n.get("name") or "").lower() == "shadow" and n.get("sp", -1) >= 0
    ] + [
        (2, n) for n in nodes if (n.get("name") or "").lower() == "shadow"
    ] + [
        (3, n) for n in nodes if "shadow" in (n.get("name") or "").lower()
    ]
    if candidates:
        shadow_id = candidates[0][1]["id"]

    if shadow_id is not None and world_M[shadow_id] is not None:
        ax = round(world_M[shadow_id][4], 2)
        ay = round(world_M[shadow_id][5], 2)
        if abs(ax) <= 300.0 and abs(ay) <= 350.0:
            return [ax, ay]

    # Fallback: bottom-center of active non-shadow sprites
    if sprites:
        min_x, max_x, max_y = 1e9, -1e9, -1e9
        for i, n in enumerate(nodes):
            sp_idx = n.get("sp", -1)
            if not n.get("a") or sp_idx < 0 or sp_idx >= len(sprites) or world_M[i] is None:
                continue
            if "shadow" in (n.get("name") or "").lower():
                continue
            sp = sprites[sp_idx]
            M = world_M[i]
            sscale_x = (-1.0 if n.get("fx") else 1.0) * (ppu / (sp["ppu"] or 100.0))
            sscale_y = (-1.0 if n.get("fy") else 1.0) * (ppu / (sp["ppu"] or 100.0))
            ox = -sp["px"] * sp["w"] * sscale_x
            oy = -(1.0 - sp["py"]) * sp["h"] * sscale_y
            corners = [
                (ox, oy),
                (ox + sp["w"] * sscale_x, oy),
                (ox + sp["w"] * sscale_x, oy + sp["h"] * sscale_y),
                (ox, oy + sp["h"] * sscale_y),
            ]
            for cx, cy in corners:
                wx = M[0] * cx + M[2] * cy + M[4]
                wy = M[1] * cx + M[3] * cy + M[5]
                min_x = min(min_x, wx)
                max_x = max(max_x, wx)
                max_y = max(max_y, wy)
        if max_x > min_x and max_y > -1e8:
            return [round((min_x + max_x) * 0.5, 2), round(max_y, 2)]

    return [0.0, 0.0]


def extract_clip_additive_map(act):
    """Return dict[clip_index -> bool] marking clips hosted on Additive AnimatorLayers."""
    additive_by_cid = {}
    ctrl = act.get("m_Controller", {})
    layers = [l.get("data", l) for l in ctrl.get("m_LayerArray", ())]
    sms = [s.get("data", s) for s in ctrl.get("m_StateMachineArray", ())]
    for lay in layers:
        sm_idx = lay.get("m_StateMachineIndex", -1)
        is_add = int(lay.get("(int&)m_LayerBlendingMode", 0) or 0) == 1
        if 0 <= sm_idx < len(sms):
            sm = sms[sm_idx]
            for st_w in sm.get("m_StateConstantArray", ()):
                st = st_w.get("data", st_w)
                for bt_w in st.get("m_BlendTreeConstantArray", ()):
                    bt = bt_w.get("data", bt_w)
                    for nd_w in bt.get("m_NodeArray", ()):
                        nd = nd_w.get("data", nd_w)
                        cid = nd.get("m_ClipID", -1)
                        if cid >= 0:
                            # Prefer False if referenced in base layer as well, else is_add
                            if cid not in additive_by_cid:
                                additive_by_cid[cid] = is_add
                            elif not is_add:
                                additive_by_cid[cid] = False
    return additive_by_cid


def normalize_clip_aliases(clips):
    """Ensure standard canonical aliases exist via exact match + fuzzy substring fallbacks."""
    alias_rules = [
        ("idle", ("idle", "idle1", "idle_1", "idle2")),
        ("shoot", ("shoot", "shoot1", "shoot2", "fire", "attack_shoot")),
        ("walk", ("walk", "walk1", "walk2", "move", "move_land")),
        ("attack", ("attack", "eat", "bite", "chomp")),
        ("die", ("die", "death", "die1")),
        ("attack_lose", ("attack_lose", "loseattack")),
        ("losewalk", ("losewalk", "losewalk2", "walk_lose")),
        ("swim", ("swim", "move_water", "idle_water")),
    ]
    for canon_name, candidates in alias_rules:
        if canon_name not in clips:
            for c in candidates:
                if c in clips:
                    clips[canon_name] = clips[c]
                    break

    keys = list(clips.keys())
    if "idle" not in clips:
        cand = next((k for k in keys if "idle" in k and "lose" not in k), None)
        if cand:
            clips["idle"] = clips[cand]
    if "walk" not in clips:
        cand = next((k for k in keys if ("walk" in k or "move" in k) and "lose" not in k and "die" not in k), None)
        if cand:
            clips["walk"] = clips[cand]
    if "attack" not in clips:
        cand = next((k for k in keys if any(w in k for w in ("attack", "eat", "bite", "chomp")) and "lose" not in k), None)
        if cand:
            clips["attack"] = clips[cand]
    if "die" not in clips:
        cand = next((k for k in keys if "die" in k or "death" in k), None)
        if cand:
            clips["die"] = clips[cand]
    if "shoot" not in clips:
        shoot_cands = [k for k in keys if "shoot" in k]
        if shoot_cands:
            best = next((k for k in shoot_cands if any(ev[1] == "AnimShoot" for ev in clips[k].get("events", ()))), shoot_cands[0])
            clips["shoot"] = clips[best]
    elif not any(ev[1] == "AnimShoot" for ev in clips["shoot"].get("events", ())):
        # e.g. ThreePeater has shoot1 (no event) & shoot2 (AnimShoot): promote eventful shoot clip if shoot lacks AnimShoot
        best = next((k for k in keys if "shoot" in k and any(ev[1] == "AnimShoot" for ev in clips[k].get("events", ()))), None)
        if best:
            clips["shoot"] = clips[best]


def extract_root_script_class(go_sf, go_obj, resolve_obj, inheritance_map):
    go = go_obj.read()
    best = None
    for c in go.m_Components:
        p = getattr(c, "component", c)
        csf, co = resolve_obj(go_sf, p.file_id, p.path_id)
        if not co or co.type.name != "MonoBehaviour":
            continue
        raw = co.get_raw_data()
        if len(raw) < 28:
            continue
        fid, pid = struct.unpack_from("<iq", raw, 16)
        _, mso = resolve_obj(csf, fid, pid)
        if not mso or mso.type.name != "MonoScript":
            continue
        ms = mso.read()
        if ms.m_AssemblyName != "Assembly-CSharp":
            continue
        cls_key = f"{ms.m_Namespace}.{ms.m_ClassName}" if ms.m_Namespace else ms.m_ClassName
        chain = inheritance_map.get(cls_key, [cls_key])
        if any(base in chain for base in ("Plant", "Zombie", "Entity", "Bullet", "LawnMower")):
            return cls_key, chain
        if best is None:
            best = (cls_key, chain)
    return best if best else ("", [])


def compile_prefab_rig(go_sf, go_obj, resolve_obj, out_json_path, out_webp_path, atlas_rel_url):
    """Compile a Unity GameObject prefab + AnimatorController into rig JSON + WebP atlas."""
    go = go_obj.read()
    root_tf_sf = None
    root_tf = None
    anim_ctrl_sf = None
    anim_ctrl_obj = None

    for c in go.m_Components:
        p = getattr(c, "component", c)
        csf, co = resolve_obj(go_sf, p.file_id, p.path_id)
        if not co:
            continue
        if co.type.name in ("Transform", "RectTransform") and root_tf is None:
            root_tf_sf, root_tf = csf, co
        elif co.type.name == "Animator" and anim_ctrl_obj is None:
            try:
                acp = co.read_typetree().get("m_Controller", {})
                acsf, aco = resolve_obj(csf, acp.get("m_FileID", 0), acp.get("m_PathID", 0))
                if aco:
                    anim_ctrl_sf, anim_ctrl_obj = acsf, aco
            except Exception:
                pass

    if root_tf is None:
        return None

    sprite_items = []
    sprite_key_to_idx = {}

    def collect_sprite(sp_obj):
        key = (sp_obj.assets_file.name if hasattr(sp_obj, "assets_file") else "", sp_obj.path_id)
        if key in sprite_key_to_idx:
            return sprite_key_to_idx[key]
        extracted = extract_trimmed_sprite(sp_obj)
        if extracted is None:
            sprite_key_to_idx[key] = -1
            return -1
        idx = len(sprite_items)
        sprite_items.append(extracted)
        sprite_key_to_idx[key] = idx
        return idx

    nodes = []
    path_to_node_id = {}
    crc_to_node_id = {}
    shoot_nodes = []

    def has_sprite_in_subtree(tf_sf, tf_o):
        t = tf_o.read()
        gsf, gobj = resolve_obj(tf_sf, t.m_GameObject.file_id, t.m_GameObject.path_id)
        if not gobj:
            return False
        g = gobj.read()
        for c in g.m_Components:
            p = getattr(c, "component", c)
            _, co = resolve_obj(gsf, p.file_id, p.path_id)
            if co and co.type.name == "SpriteRenderer":
                return True
        for ch in t.m_Children:
            csf, cho = resolve_obj(tf_sf, ch.file_id, ch.path_id)
            if cho and has_sprite_in_subtree(csf, cho):
                return True
        return False

    def walk(tf_sf, tf_o, parent_id, rel_path, depth, group_order_bias):
        tf = tf_o.read()
        gsf, gobj = resolve_obj(tf_sf, tf.m_GameObject.file_id, tf.m_GameObject.path_id)
        if not gobj:
            return
        g = gobj.read()
        nm = (g.m_Name or "").strip()
        cur_path = "" if depth == 0 else (f"{rel_path}/{nm}" if rel_path else nm)

        # Skip pure ParticleSystem VFX subtrees that carry no sprites and aren't Shoot markers
        has_ps = False
        sr_comp = None
        sg_order = None
        for c in g.m_Components:
            p = getattr(c, "component", c)
            csf, co = resolve_obj(gsf, p.file_id, p.path_id)
            if not co:
                continue
            if co.type.name == "SpriteRenderer" and sr_comp is None:
                sr_comp = (csf, co.read())
            elif co.type.name == "ParticleSystem":
                has_ps = True
            elif co.type.name == "SortingGroup":
                try:
                    sgt = co.read_typetree()
                    sg_order = int(sgt.get("m_SortingOrder", 0))
                except Exception:
                    pass

        is_shoot_marker = bool(SHOOT_PRIMARY_RE.match(nm))
        if depth > 0 and has_ps and sr_comp is None and not is_shoot_marker and not has_sprite_in_subtree(tf_sf, tf_o):
            return

        nid = len(nodes)
        q = tf.m_LocalRotation
        rot = 2.0 * math.atan2(float(q.z), float(q.w))
        lx = 0.0 if depth == 0 else float(tf.m_LocalPosition.x)
        ly = 0.0 if depth == 0 else float(tf.m_LocalPosition.y)
        sx = float(tf.m_LocalScale.x)
        sy = float(tf.m_LocalScale.y)
        active = 1 if getattr(g, "m_IsActive", True) else 0

        sp_idx = -1
        order = group_order_bias
        alpha = 1.0
        tint = 0xFFFFFF
        fx = 0
        fy = 0

        if sr_comp is not None:
            srsf, sr = sr_comp
            if not sr.m_Enabled:
                active = 0
            _, spo = resolve_obj(srsf, sr.m_Sprite.file_id, sr.m_Sprite.path_id)
            if spo and spo.type.name == "Sprite":
                sp_idx = collect_sprite(spo)
            sl = int(getattr(sr, "m_SortingLayerID", 0))
            so = int(getattr(sr, "m_SortingOrder", 0))
            # Normalize sorting layer hashes to small integers if non-zero
            sl_bias = 0 if sl == 0 else (10000 if (sl & 0xFFFFFFFF) != 0 else 0)
            order = group_order_bias + sl_bias + so
            col = getattr(sr, "m_Color", None)
            if col is not None:
                alpha = max(0.0, min(1.0, float(col.a)))
                r_i = max(0, min(255, int(round(col.r * 255))))
                g_i = max(0, min(255, int(round(col.g * 255))))
                b_i = max(0, min(255, int(round(col.b * 255))))
                tint = (r_i << 16) | (g_i << 8) | b_i
            fx = 1 if getattr(sr, "m_FlipX", False) else 0
            fy = 1 if getattr(sr, "m_FlipY", False) else 0

        if is_shoot_marker:
            shoot_nodes.append(nid)

        node = {
            "id": nid,
            "parent": parent_id,
            "name": nm,
            "x": round(lx, 5),
            "y": round(ly, 5),
            "rot": round(rot, 5),
            "sx": round(sx, 5),
            "sy": round(sy, 5),
            "a": active,
            "sp": sp_idx,
            "order": order,
            "al": round(alpha, 3),
            "fx": fx,
            "fy": fy,
        }
        if tint != 0xFFFFFF:
            node["tint"] = tint
        nodes.append(node)

        path_to_node_id[cur_path] = nid
        crc = 0 if cur_path == "" else (zlib.crc32(cur_path.encode("utf-8")) & 0xFFFFFFFF)
        crc_to_node_id[crc] = nid

        next_bias = group_order_bias + (sg_order * 100 if sg_order is not None else 0)
        for ch in tf.m_Children:
            csf, cho = resolve_obj(tf_sf, ch.file_id, ch.path_id)
            if cho and cho.type.name in ("Transform", "RectTransform"):
                walk(csf, cho, nid, cur_path, depth + 1, next_bias)

    walk(root_tf_sf, root_tf, -1, "", 0, 0)

    if not shoot_nodes:
        for n in nodes:
            nm_l = (n.get("name") or "").lower()
            if "overlay" not in nm_l and SHOOT_FALLBACK_RE.match(n.get("name") or ""):
                shoot_nodes.append(n["id"])

    # Compile AnimationClips from AnimatorController
    clips = {}
    if anim_ctrl_obj is not None:
        try:
            act = anim_ctrl_obj.read_typetree()
            additive_map = extract_clip_additive_map(act)
            for cid, clref in enumerate(act.get("m_AnimationClips", ())):
                clsf, clo = resolve_obj(anim_ctrl_sf, clref.get("m_FileID", 0), clref.get("m_PathID", 0))
                if not clo or clo.type.name != "AnimationClip":
                    continue
                compiled = decode_animation_clip(
                    clsf, clo, path_to_node_id, crc_to_node_id, resolve_obj, collect_sprite
                )
                compiled["additive"] = bool(additive_map.get(cid, False))
                key = compiled["name"].lower()
                if key not in clips or len(compiled["tracks"]) > len(clips[key]["tracks"]):
                    clips[key] = compiled
        except Exception:
            pass

    if not sprite_items:
        return None

    normalize_clip_aliases(clips)

    atlas_im, sprites_meta = pack_atlas(sprite_items)
    os.makedirs(os.path.dirname(out_webp_path), exist_ok=True)
    atlas_im.save(out_webp_path, format="WEBP", quality=88, method=4)

    rig_json = {
        "ppu": WORLD_PPU,
        "atlas": atlas_rel_url,
        "atlasW": atlas_im.width,
        "atlasH": atlas_im.height,
        "anchor": compute_rig_anchor(nodes, WORLD_PPU, sprites_meta),
        "shootNodes": shoot_nodes,
        "sprites": sprites_meta,
        "nodes": nodes,
        "clips": clips,
    }
    os.makedirs(os.path.dirname(out_json_path), exist_ok=True)
    with open(out_json_path, "w", encoding="utf-8") as f:
        json.dump(rig_json, f, ensure_ascii=False, separators=(",", ":"))

    return rig_json


def compile_static_sprite_rig(pil_im, out_json_path, out_webp_path, atlas_rel_url, scale=1.0):
    """Fallback single-node rig for entities without an animated GameObject prefab."""
    if pil_im is None:
        return None
    if pil_im.mode != "RGBA":
        pil_im = pil_im.convert("RGBA")
    atlas_im, meta = pack_atlas([{
        "im": pil_im,
        "w": pil_im.width,
        "h": pil_im.height,
        "px": 0.5,
        "py": 0.15,
        "ppu": 100.0,
    }])
    os.makedirs(os.path.dirname(out_webp_path), exist_ok=True)
    atlas_im.save(out_webp_path, format="WEBP", quality=88, method=4)
    rig_json = {
        "ppu": WORLD_PPU,
        "atlas": atlas_rel_url,
        "atlasW": atlas_im.width,
        "atlasH": atlas_im.height,
        "anchor": [0.0, 0.0],
        "shootNodes": [],
        "sprites": meta,
        "nodes": [
            {"id": 0, "parent": -1, "name": "root", "x": 0, "y": 0, "rot": 0, "sx": scale, "sy": scale, "a": 1, "sp": 0, "order": 1, "al": 1, "fx": 0, "fy": 0}
        ],
        "clips": {},
    }
    os.makedirs(os.path.dirname(out_json_path), exist_ok=True)
    with open(out_json_path, "w", encoding="utf-8") as f:
        json.dump(rig_json, f, ensure_ascii=False, separators=(",", ":"))
    return rig_json


# ---------------------------------------------------------------------------
# 5. Audio & Background & UI & Portrait Pipelines
# ---------------------------------------------------------------------------
def convert_audio_files():
    os.makedirs(OUT_AUDIO, exist_ok=True)
    if not os.path.isdir(LEGACY_AUDIO_DIR):
        return {}
    files = sorted(f for f in os.listdir(LEGACY_AUDIO_DIR) if f.lower().endswith(".ogg"))
    manifest = {}
    has_ffmpeg = shutil.which("ffmpeg") is not None

    def work(fname):
        src = os.path.join(LEGACY_AUDIO_DIR, fname)
        dst = os.path.join(OUT_AUDIO, fname)
        stem = os.path.splitext(fname)[0]
        if has_ffmpeg:
            # Transcode larger files to compact Vorbis q=3; small SFX copy/transcode cleanly
            src_sz = os.path.getsize(src)
            if src_sz > 80 * 1024:
                cmd = [
                    "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                    "-i", src, "-vn", "-c:a", "libvorbis", "-q:a", "3", dst,
                ]
                try:
                    subprocess.run(cmd, check=True, timeout=20)
                except Exception:
                    shutil.copy2(src, dst)
            else:
                shutil.copy2(src, dst)
        else:
            shutil.copy2(src, dst)
        return stem, f"assets/audio/{fname}"

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
        for stem, rel in ex.map(work, files):
            manifest[stem] = rel
    return manifest


def convert_bg_files():
    os.makedirs(OUT_BG, exist_ok=True)
    if not os.path.isdir(LEGACY_BG_DIR):
        return
    files = sorted(f for f in os.listdir(LEGACY_BG_DIR) if f.lower().endswith(".png"))

    def work(fname):
        src = os.path.join(LEGACY_BG_DIR, fname)
        out_name = os.path.splitext(fname)[0] + ".webp"
        dst = os.path.join(OUT_BG, out_name)
        im = Image.open(src).convert("RGBA")
        im.save(dst, format="WEBP", quality=88, method=4)

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
        list(ex.map(work, files))


def dir_size_mb(path):
    total = 0
    for r, _, fs in os.walk(path):
        for fn in fs:
            total += os.path.getsize(os.path.join(r, fn))
    return total / (1024 * 1024)


# ---------------------------------------------------------------------------
# 6. Main Compile Entry
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="Compile PvZ Fusion 4.1 Unity assets into pvz-web assets.")
    parser.add_argument("--skip-audio", action="store_true", help="Skip re-encoding audio if already generated")
    parser.add_argument("--skip-bg", action="store_true", help="Skip re-converting bg images")
    args = parser.parse_args()

    t0 = time.time()
    print("=== PvZ Fusion 4.1 -> pvz-web Asset & Skeletal Compiler ===")

    print("1. Parsing IL2CPP v31 metadata & GameAssembly.dll...")
    lits, enums = rgd.parse_il2cpp_metadata(META_DAT)
    inheritance_map = build_class_inheritance_map(META_DAT)
    plant_enum = enums["PlantType"]
    zombie_enum = enums["ZombieType"]
    bullet_enum = enums["BulletType"]

    read_lit = rgd.open_pe_lit_reader(GAME_DLL, lits)
    plant_res_paths = rgd.extract_plant_resource_paths(read_lit)
    raw_recipes = rgd.extract_mixdata_recipes()
    print(f"   PlantType={len(plant_enum)}, ZombieType={len(zombie_enum)}, MixData={len(raw_recipes)}, Classes={len(inheritance_map)}")

    print("2. Loading data.unity3d...")
    env = UnityPy.load(DATA_UNITY)
    bundle = list(env.files.values())[0]
    resolve_obj, render_go, render_rm_entry = rgd.make_bundle_resolver(bundle)

    rm_entries = {}
    all_sprites_by_name = {}
    text_assets = []
    for fname, sf in bundle.files.items():
        if not hasattr(sf, "objects"):
            continue
        for obj in sf.objects.values():
            t = obj.type.name
            if t == "ResourceManager":
                rm = obj.read()
                for k, pptr in rm.m_Container:
                    tsf, tobj = resolve_obj(sf, pptr.file_id, pptr.path_id)
                    if tobj:
                        rm_entries.setdefault(k.lower(), []).append((tsf, tobj))
            elif t == "Sprite":
                try:
                    sp = obj.read()
                    all_sprites_by_name.setdefault(sp.m_Name, []).append((fname, obj.path_id, sp))
                except Exception:
                    pass
            elif t == "TextAsset":
                text_assets.append(obj.read())

    # Prepare clean output directories
    clean_dirs = [OUT_RIGS_P, OUT_RIGS_Z, OUT_RIGS_C, OUT_PORTRAITS_P, OUT_PORTRAITS_Z, OUT_BULLETS, OUT_UI, OUT_DATA]
    if not args.skip_audio:
        clean_dirs.append(OUT_AUDIO)
    if not args.skip_bg:
        clean_dirs.append(OUT_BG)
    for d in clean_dirs:
        if os.path.isdir(d):
            shutil.rmtree(d)
        os.makedirs(d, exist_ok=True)

    # Parse LawnStrings, ZombieStrings, Explore levels, IZ levels
    lawn_list = []
    zombie_list = []
    explore_levels = {}
    iz_levels = []
    for t in text_assets:
        if t.m_Name == "LawnStrings":
            lawn_list = json.loads(t.m_Script.lstrip("\ufeff"))["plants"]
        elif t.m_Name == "ZombieStrings":
            zombie_list = json.loads(t.m_Script.lstrip("\ufeff"))["zombies"]
        elif t.m_Name.startswith("level") and re.match(r"^level\d+", t.m_Name):
            try:
                j = json.loads(t.m_Script.lstrip("\ufeff"))
            except Exception:
                continue
            lid = int(re.match(r"^level(\d+)", t.m_Name).group(1))
            hm = j.get("zombieHealthMultiplier", 1)
            sa = j.get("zombieSpeedAdder", 1)
            explore_levels[lid] = {
                "id": lid,
                "name": re.sub(r"^level\d+-?", "", t.m_Name) or f"关卡 {lid}",
                "sceneType": j.get("sceneType", 0),
                "maxWave": j.get("maxWave", 10) or 10,
                "zombies": j.get("zombiesToAppear", []),
                "prePlant": j.get("prePlant", []),
                "usePlant": j.get("usePlant", []),
                "convay": bool(j.get("convay", False)),
                "convayTimer": j.get("convayTimer", 5) or 5,
                "gloveCD": j.get("gloveCD", 10),
                "theSun": j.get("theSun", 150) or 150,
                "tips": rgd.clean_text(j.get("tips", "")),
                "zombieHealthMultiplier": hm if hm and hm > 0 else 1.0,
                "zombieSpeedAdder": sa if sa and sa > 0 else 1.0,
                "firstWaveCountdown": j.get("firstWaveCountdown", 0),
            }
        elif "customiz" in t.m_Name.lower():
            try:
                j = json.loads(t.m_Script.lstrip("\ufeff"))
                iz_levels.append({"name": t.m_Name, "data": j})
            except Exception:
                pass

    plant_so_by_en = {}
    plant_so_by_cn = {}
    zombie_so_by_en = {}
    zombie_so_by_cn = {}
    for k, ents in rm_entries.items():
        if k.startswith("data/plants/"):
            d = rgd.parse_plant_so(ents[0][1].get_raw_data())
            plant_so_by_en[d["en"].lower()] = d
            plant_so_by_cn[d["cn"]] = d
        elif k.startswith("data/zombies/"):
            d = rgd.parse_zombie_so(ents[0][1].get_raw_data())
            zombie_so_by_en[d["en"].lower()] = d
            zombie_so_by_cn[d["cn"]] = d

    # 3. Compile Plant Rigs & Portraits
    print("3. Compiling Plant skeletal rigs, AnimationClips & portraits...")
    lawn_by_id = {p["seedType"]: p for p in lawn_list}
    all_plant_ids = sorted(set(k for k in plant_enum if k >= 0) | set(lawn_by_id.keys()))
    plant_db = {}
    p_rig_ok = 0
    p_static_ok = 0
    p_clip_total = 0

    for pid in all_plant_ids:
        lp = lawn_by_id.get(pid, {})
        en = plant_enum.get(pid, "")
        cn = lp.get("name") or ""
        so = plant_so_by_en.get(en.lower()) if en else None
        if not so and cn:
            so = plant_so_by_cn.get(cn)
        if so and not en:
            en = so["en"]
        if not cn and so:
            cn = so["cn"]
        if not en:
            en = f"Plant_{pid}"
        if not cn:
            cn = en

        info = rgd.clean_text(lp.get("info", ""))
        intro = rgd.clean_text(lp.get("introduce", ""))
        cost_txt = rgd.clean_text(lp.get("cost", ""))

        cost = so["cost"] if so else 100
        cd = so["cd"] if so else 7.5
        hp = so["hp"] if so else 300
        dmg = so["dmg"] if so else 0
        atk_iv = so["atkIv"] if so else 0
        prod_iv = so["prodIv"] if so else 0
        layer = so["layer"] if so else "Default"
        tags = so["tags"] if so else []

        if not so and cost_txt:
            mc = re.search(r"花费：\s*(\d+)", cost_txt)
            if mc:
                cost = int(mc.group(1))
            mcd = re.search(r"冷却时间：\s*([\d.]+)", cost_txt)
            if mcd:
                cd = float(mcd.group(1))
        if not so and info:
            mhp = re.search(r"韧性：\s*(\d+)", info)
            if mhp:
                hp = int(mhp.group(1))
            mdmg = re.search(r"伤害：\s*(\d+)", info)
            if mdmg:
                dmg = int(mdmg.group(1))

        # Locate prefab GameObject & preview entry
        prefab_entry = None
        preview_entry = None
        if pid in plant_res_paths:
            base_path, pref_sfx, prev_sfx = plant_res_paths[pid]
            k_pref = f"{base_path}{pref_sfx}".lower()
            k_prev = f"{base_path}{prev_sfx}".lower()
            k_base = base_path.lower()
            for kc in (k_pref, k_base):
                if kc in rm_entries:
                    go_hit = next(((sf, o) for sf, o in rm_entries[kc] if o.type.name == "GameObject"), None)
                    if go_hit:
                        prefab_entry = go_hit
                        break
            for kc in (k_prev, k_pref, k_base):
                if kc in rm_entries:
                    preview_entry = rm_entries[kc]
                    break
        else:
            en_l = en.lower()
            if en_l and en_l != "nothing":
                for suffix in ("prefab", ""):
                    for k, ents in rm_entries.items():
                        if k.startswith("plants/") and k.endswith("/" + en_l + suffix):
                            go_hit = next(((sf, o) for sf, o in ents if o.type.name == "GameObject"), None)
                            if go_hit:
                                prefab_entry = go_hit
                                break
                    if prefab_entry:
                        break
                for suffix in ("preview", "prefab", ""):
                    for k, ents in rm_entries.items():
                        if k.startswith("plants/") and k.endswith("/" + en_l + suffix):
                            preview_entry = ents
                            break
                    if preview_entry:
                        break

        # Portrait thumbnail (WebP)
        portrait_im = render_rm_entry(preview_entry, max_dim=160, pad=2) if preview_entry else None
        portrait_file = ""
        if portrait_im is not None:
            portrait_file = f"p_{pid}.webp"
            portrait_im.save(os.path.join(OUT_PORTRAITS_P, portrait_file), format="WEBP", quality=88, method=4)

        # Skeletal Rig & Script Class
        script_class = ""
        base_chain = []
        has_rig = False
        rig_json_path = os.path.join(OUT_RIGS_P, f"p_{pid}.json")
        rig_webp_path = os.path.join(OUT_RIGS_P, f"p_{pid}.webp")
        atlas_url = f"assets/rigs/plants/p_{pid}.webp"

        if prefab_entry is not None:
            psf, pgo = prefab_entry
            script_class, base_chain = extract_root_script_class(psf, pgo, resolve_obj, inheritance_map)
            rig_res = compile_prefab_rig(psf, pgo, resolve_obj, rig_json_path, rig_webp_path, atlas_url)
            if rig_res is not None:
                has_rig = True
                p_rig_ok += 1
                p_clip_total += len(rig_res["clips"])

        if not has_rig and portrait_im is not None:
            rig_res = compile_static_sprite_rig(portrait_im, rig_json_path, rig_webp_path, atlas_url, scale=0.65)
            if rig_res is not None:
                has_rig = True
                p_static_ok += 1

        plant_db[pid] = {
            "id": pid,
            "en": en,
            "name": cn,
            "cost": cost,
            "cd": cd,
            "hp": hp,
            "dmg": dmg,
            "atkIv": atk_iv,
            "prodIv": prod_iv,
            "layer": layer,
            "tags": tags,
            "scriptClass": script_class,
            "baseChain": base_chain,
            "hasRig": has_rig,
            "portrait": portrait_file,
            "info": info,
            "intro": intro,
        }

    print(f"   Plants: total={len(plant_db)}, fullRigs={p_rig_ok}, staticFallback={p_static_ok}, clips={p_clip_total}")

    # 4. Compile Zombie Rigs & Portraits
    print("4. Compiling Zombie skeletal rigs, AnimationClips & portraits...")
    zstr_by_id = {z["theZombieType"]: z for z in zombie_list}
    all_zombie_ids = sorted(set(k for k in zombie_enum if k >= 0) | set(zstr_by_id.keys()))
    zombie_db = {}
    z_rig_ok = 0
    z_clip_total = 0

    for zid in all_zombie_ids:
        zs = zstr_by_id.get(zid, {})
        en = zombie_enum.get(zid, "")
        cn = zs.get("name") or ""
        so = zombie_so_by_en.get(en.lower()) if en else None
        if not so and cn:
            so = zombie_so_by_cn.get(cn)
        if so and not en:
            en = so["en"]
        if not cn and so:
            cn = so["cn"]
        if not en:
            en = f"Zombie_{zid}"
        if not cn:
            cn = en

        portrait_im = None
        if en.lower() != "nothing":
            zk = f"zombieimage/{en.lower()}"
            if zk in rm_entries:
                for _sf, obj in rm_entries[zk]:
                    if obj.type.name == "Sprite":
                        try:
                            portrait_im = rgd.optimize_pil(obj.read().image, max_dim=180, pad=2)
                            if portrait_im is not None:
                                break
                        except Exception:
                            pass

        portrait_file = ""
        if portrait_im is not None:
            portrait_file = f"z_{zid}.webp"
            portrait_im.save(os.path.join(OUT_PORTRAITS_Z, portrait_file), format="WEBP", quality=88, method=4)

        script_class = ""
        base_chain = []
        has_rig = False
        rig_json_path = os.path.join(OUT_RIGS_Z, f"z_{zid}.json")
        rig_webp_path = os.path.join(OUT_RIGS_Z, f"z_{zid}.webp")
        atlas_url = f"assets/rigs/zombies/z_{zid}.webp"

        z_pref_key = f"zombies/_prefab/{en.lower()}"
        if z_pref_key in rm_entries:
            go_hit = next(((sf, o) for sf, o in rm_entries[z_pref_key] if o.type.name == "GameObject"), None)
            if go_hit:
                zsf, zgo = go_hit
                script_class, base_chain = extract_root_script_class(zsf, zgo, resolve_obj, inheritance_map)
                rig_res = compile_prefab_rig(zsf, zgo, resolve_obj, rig_json_path, rig_webp_path, atlas_url)
                if rig_res is not None:
                    has_rig = True
                    z_rig_ok += 1
                    z_clip_total += len(rig_res["clips"])

        if not has_rig and portrait_im is not None:
            rig_res = compile_static_sprite_rig(portrait_im, rig_json_path, rig_webp_path, atlas_url, scale=0.65)
            if rig_res is not None:
                has_rig = True

        zombie_db[zid] = {
            "id": zid,
            "en": en,
            "name": cn,
            "hp": so["hp"] if so else 270,
            "a1": so["a1"] if so else 0,
            "a2": so["a2"] if so else 0,
            "atk": so["atk"] if so else 50,
            "val": so["val"] if so else 50,
            "tier": so["tier"] if so else 1,
            "tags": so["tags"] if so else [],
            "duck": so["duck"] if so else "Nothing",
            "scriptClass": script_class,
            "baseChain": base_chain,
            "hasRig": has_rig,
            "portrait": portrait_file,
            "info": rgd.clean_text(zs.get("info", "")),
            "intro": rgd.clean_text(zs.get("introduce", "")),
        }

    print(f"   Zombies: total={len(zombie_db)}, fullRigs={z_rig_ok}, clips={z_clip_total}")

    # 5. Compile Common Animated Rigs (LawnMower, PoolCleaner, Sun, BigSun, Squalour)
    print("5. Compiling common animated rigs (mower, sun, squalour)...")
    COMMON_SPECS = {
        "mower_lawn": "mower/lawn/lawnmowerprefab",
        "mower_pool": "mower/pool/poolcleanerprefab",
        "mower_roof": "mower/cleaner/cleanerprefab",
        "sun": "items/sun/sun",
        "bigsun": "items/sun/bigsun",
        "bluesun": "items/sun/bluesun",
        "squalour": "plants/squash/squalour/squalourprefab",
    }
    for key, rk in COMMON_SPECS.items():
        ents = rm_entries.get(rk, [])
        if not ents and key == "squalour":
            ents = rm_entries.get("plants/squash/squalour/squalour", [])
        go_hit = next(((sf, o) for sf, o in ents if o.type.name == "GameObject"), None)
        if go_hit:
            compile_prefab_rig(
                go_hit[0],
                go_hit[1],
                resolve_obj,
                os.path.join(OUT_RIGS_C, f"{key}.json"),
                os.path.join(OUT_RIGS_C, f"{key}.webp"),
                f"assets/rigs/common/{key}.webp",
            )

    # 6. Recipes, Bullets, UI Sprites, Backgrounds & Audio
    print("6. Exporting recipes, bullets, UI sprites, backgrounds & audio...")
    recipes = {}
    recipe_list = []
    seen_tuples = set()
    for a, b, res, is_sym in raw_recipes:
        if a == res or b == res:
            continue
        recipes.setdefault(f"{a}|{b}", res)
        if is_sym:
            recipes.setdefault(f"{b}|{a}", res)
        tup = (a, b, res, 0 if is_sym else 1)
        if tup not in seen_tuples:
            seen_tuples.add(tup)
            recipe_list.append(list(tup))

    bullet_en_to_id = {}
    for bid, bname in sorted(bullet_enum.items()):
        bullet_en_to_id[bname.lower()] = bid
        rk = f"bullet/prefabs/{bname.lower()}"
        if rk in rm_entries:
            im = render_rm_entry(rm_entries[rk], max_dim=96, pad=1)
            if im is not None:
                im.save(os.path.join(OUT_BULLETS, f"b_{bid}.webp"), format="WEBP", quality=88, method=4)

    for out_nm, rm_key in [
        ("sun.webp", "items/sun/sun"),
        ("bigsun.webp", "items/sun/bigsun"),
        ("bluesun.webp", "items/sun/bluesun"),
        ("coin_gold.webp", "image/coin_gold_dollar"),
        ("shadow.webp", "board/plantshadow"),
    ]:
        if rm_key in rm_entries:
            im = render_rm_entry(rm_entries[rm_key], max_dim=96, pad=2)
            if im is not None:
                im.save(os.path.join(OUT_BULLETS, out_nm), format="WEBP", quality=88, method=4)

    bullet_logical = {
        "pea": bullet_en_to_id.get("bullet_pea", 0),
        "snowpea": bullet_en_to_id.get("bullet_snowpea", 3),
        "firepea": bullet_en_to_id.get("bullet_firepea_orange", 5),
        "cherrypea": bullet_en_to_id.get("bullet_cherry", 1),
        "doompea": bullet_en_to_id.get("bullet_doom", 28),
        "hypnopea": bullet_en_to_id.get("bullet_hypnopea", 46),
        "ironpea": bullet_en_to_id.get("bullet_ironpea", 30),
        "sunpea": bullet_en_to_id.get("bullet_ultimatesun", bullet_en_to_id.get("bullet_normalsun", 57)),
        "cabbage": bullet_en_to_id.get("bullet_cabbage", 11),
        "kernel": bullet_en_to_id.get("bullet_kernal", 13),
        "butter": bullet_en_to_id.get("bullet_butter", 15),
        "melon": bullet_en_to_id.get("bullet_melon", 17),
        "wintermelon": bullet_en_to_id.get("bullet_wintermelon", 19),
        "star": bullet_en_to_id.get("bullet_star", 10),
        "redstar": bullet_en_to_id.get("bullet_redstar", 50),
        "ultimatestar": bullet_en_to_id.get("bullet_ultimatestar", 66),
        "cactus": bullet_en_to_id.get("bullet_cactus", 9),
        "puff": bullet_en_to_id.get("bullet_puff", 2),
        "fume": bullet_en_to_id.get("bullet_puff_big", bullet_en_to_id.get("bullet_puff", 2)),
        "potatobullet": bullet_en_to_id.get("bullet_potato", 25),
        "doombullet": bullet_en_to_id.get("bullet_doom_big", bullet_en_to_id.get("bullet_doom", 28)),
        "superfireball": bullet_en_to_id.get("bullet_supercherry", bullet_en_to_id.get("bullet_cherry", 1)),
    }

    UI_SPECS = {
        "ocean": ("ui/spirte/mainmenu3.0", "ocean"),
        "cloud": ("ui/spirte/mainmenu3.0", "cloud"),
        "water": ("ui/spirte/mainmenu3.0", "water"),
        "endoflame": ("ui/spirte/mainmenu3.0", "c"),
        "beach": ("ui/spirte/mainmenu3.0", "beach"),
        "grave": ("ui/spirte/mainmenu3.0", "grave"),
        "peifang": ("ui/spirte/mainmenu3.0", "peifang"),
        "peifang_1": ("ui/spirte/mainmenu3.0", "peifang_1"),
        "peifang_2": ("ui/spirte/mainmenu3.0", "peifang_2"),
        "peifang_h": ("ui/spirte/mainmenu3.0", "peifang_H"),
        "squalour": ("plants/squash/squalour/squalour", "Squalour"),
        "plantshadow": ("board/plantshadow", None),
        "woodsign1": ("ui/spirte/mainmenu/selectorscreen_woodsign1", None),
        "woodsign2": ("ui/spirte/mainmenu/selectorscreen_woodsign2", None),
        "woodsign2_press": ("ui/spirte/mainmenu/selectorscreen_woodsign2_press", None),
        "woodsign3": ("ui/spirte/mainmenu/selectorscreen_woodsign3", None),
        "flower1": ("ui/spirte/mainmenu/selectorscreen_flower1", None),
        "flower2": ("ui/spirte/mainmenu/selectorscreen_flower2", None),
        "flower3": ("ui/spirte/mainmenu/selectorscreen_flower3", None),
        "shadow_adventure": ("ui/spirte/mainmenu/selectorscreen_shadow_adventure", None),
        "shadow_survival": ("ui/spirte/mainmenu/selectorscreen_shadow_survival", None),
        "shadow_challenge": ("ui/spirte/mainmenu/selectorscreen_shadow_challenge", None),
        "shadow_zengarden": ("ui/spirte/mainmenu/selectorscreen_shadow_zengarden", None),
        "btn_adventure": ("ui/spirte/mainmenu/selectorscreen_adventure_button", None),
        "btn_adventure_hl": ("ui/spirte/mainmenu/selectorscreen_adventure_highlight", None),
        "btn_challenge": ("ui/spirte/mainmenu/selectorscreen_challenge_button", None),
        "btn_challenge_hl": ("ui/spirte/mainmenu/selectorscreen_challenge_highlight", None),
        "btn_iz": ("ui/spirte/mainmenu/selectorscreen_challenges_button", None),
        "btn_iz_hl": ("ui/spirte/mainmenu/selectorscreen_challenges_highlight", None),
        "btn_survival": ("ui/spirte/mainmenu/selectorscreen_vasebreaker_button", None),
        "btn_survival_hl": ("ui/spirte/mainmenu/selectorscreen_vasebreaker_highlight", None),
        "btn_mysterious": ("ui/spirte/mainmenu/mysterious", None),
        "btn_mysterious_hl": ("ui/spirte/mainmenu/mysterious_highlight", None),
        "btn_garden": ("ui/spirte/mainmenu/selectorscreen_zengarden", None),
        "btn_garden_hl": ("ui/spirte/mainmenu/selectorscreen_zengardenhighlight", None),
        "btn_travel": ("ui/spirte/mainmenu/travel", "3"),
        "btn_travel_hl": ("ui/spirte/mainmenu/travel", "2"),
        "btn_almanac": ("ui/spirte/mainmenu/selectorscreen_almanac", None),
        "btn_almanac_hl": ("ui/spirte/mainmenu/selectorscreen_almanachighlight", None),
        "btn_options": ("ui/spirte/mainmenu/selectorscreen_options1", None),
        "btn_options_hl": ("ui/spirte/mainmenu/selectorscreen_options2", None),
        "btn_help": ("ui/spirte/mainmenu/selectorscreen_help1", None),
        "btn_help_hl": ("ui/spirte/mainmenu/selectorscreen_help2", None),
        "btn_quit": ("ui/spirte/mainmenu/selectorscreen_quit1", None),
        "btn_quit_hl": ("ui/spirte/mainmenu/selectorscreen_quit2", None),
        "hotlevel_shadow": ("ui/spirte/推荐入口", "shadow"),
        "hotlevel_title": ("ui/spirte/推荐入口", "1"),
        "hotlevel_title_hl": ("ui/spirte/推荐入口", "2"),
        "button_flower": ("ui/spirte/mainmenu/button_flower", None),
        "zen_next": ("image/zen_nextgarden", None),
        "star_bg": ("ui/spirte/star/starbackground", None),
        "star_dots": ("ui/spirte/star/星光点点", None),
        "star_button": ("ui/spirte/star/starbutton", None),
        "star_button_hl": ("ui/spirte/star/starbutton_highlight", None),
        "star_arrow": ("ui/spirte/star/arrow", None),
        "star_icon": ("ui/spirte/star/xingxing", None),
        "star_frame": ("ui/spirte/star/starframe_highlight", None),
        "challenge_bg": ("ui/spirte/gamemenu/challenge_background", None),
        "challenge_window": ("ui/spirte/gamemenu/challenge_window", None),
        "challenge_window_hl": ("ui/spirte/gamemenu/challenge_window_highlight", None),
        "cat_adventure": ("image/levelicon/normaladvanture", None),
        "cat_challenge": ("image/levelicon/advanturechallenges", None),
        "cat_flags": ("image/levelicon/flagchallenges", None),
        "cat_minigames": ("image/levelicon/normalminigames", None),
        "minigame_trophy": ("ui/spirte/gamemenu/minigame_trophy", None),
        "trophy": ("board/award/trophy", None),
        "lock": ("ui/spirte/lock", None),
        "present": ("image/present", None),
        "ground_day": ("ui/img_almanac/almanac_groundday", None),
        "ground_night": ("ui/img_almanac/almanac_groundnight", None),
        "ground_pool": ("ui/img_almanac/almanac_groundpool", None),
        "ground_nightpool": ("ui/img_almanac/almanac_groundnightpool", None),
        "ground_roof": ("ui/img_almanac/almanac_groundroof", None),
        "ground_snow": ("image/almanac_groundsnow", None),
        "almanac_index_bg": ("ui/img_almanac/almanac_indexback", None),
        "almanac_plant_bg": ("ui/img_almanac/plant", None),
        "almanac_plant_card": ("ui/img_almanac/almanac_plantcard", None),
        "almanac_zombie_bg": ("ui/img_almanac/almanac_zombieback", None),
        "almanac_zombie_card": ("ui/img_almanac/almanac_zombiecard", None),
        "almanac_close": ("ui/img_almanac/almanac_closebutton", None),
        "almanac_close_hl": ("ui/img_almanac/almanac_closebuttonhighlight", None),
        "almanac_index_btn": ("ui/img_almanac/almanac_indexbutton", None),
        "almanac_index_btn_hl": ("ui/img_almanac/almanac_indexbuttonhighlight", None),
        "almanac_zombie_window": ("ui/img_almanac/almanac_zombiewindow", None),
        "almanac_zombie_window2": ("ui/img_almanac/almanac_zombiewindow2", None),
        "editbox": ("image/editbox", None),
        "seed_bank": ("board/seedbank", None),
        "sun_bank": ("board/sunbank", None),
        "seed_packet": ("ui/cards/seedpacket_back", None),
        "seed_packet_default": ("ui/cards/seedpacket_default", None),
        "seed_packet_night": ("ui/cards/seedpacket_night", None),
        "seed_packet_pool": ("ui/cards/seedpacket_pool", None),
        "seed_packet_nightpool": ("ui/cards/seedpacket_nightpool", None),
        "seed_packet_roof": ("ui/cards/seedpacket_roof", None),
        "seed_packet_snow": ("ui/cards/seedpacket_snow", None),
        "seed_packet_nightsnow": ("ui/cards/seedpacket_nightsnow", None),
        "seed_packet_colorful": ("ui/cards/seedpacket_colorful", None),
        "seed_packet_gold": ("ui/cards/seedpacket_gold", None),
        "seed_packet_purple": ("ui/cards/seedpacket_purple", None),
        "seed_packet_red": ("ui/cards/seedpacket_red", None),
        "seed_packet_white": ("ui/cards/seedpacket_white", None),
        "seed_chooser_bg": ("board/seedchooser_background", None),
        "seed_chooser_btn": ("board/seedchooser_button", None),
        "seed_chooser_btn_glow": ("board/seedchooser_button_glow", None),
        "seed_chooser_btn_disabled": ("board/seedchooser_button_disabled", None),
        "seed_chooser_btn2": ("ui/spirte/gamemenu/seedchooser_button2", None),
        "seed_chooser_btn2_glow": ("ui/spirte/gamemenu/seedchooser_button2_glow", None),
        "shovel_bank": ("board/shovelbank", None),
        "shovel": ("board/shovel", None),
        "glove": ("image/zen_gardenglove", None),
        "hammer": ("_other/hammer", None),
        "coin_bank": ("ui/spirte/coinbank", None),
        "conveyor_backdrop": ("image/conveyorbelt_backdrop", None),
        "conveyor_belt": ("image/conveyorbelt", None),
        "flagmeter_empty": ("board/flagmeter", "FlagMeter_0"),
        "flagmeter_full": ("board/flagmeter", "FlagMeter_1"),
        "flagmeter_head": ("board/flagmeterparts", "FlagMeterParts_0"),
        "flagmeter_pole": ("board/flagmeterparts", "FlagMeterParts_1"),
        "flagmeter_flag": ("board/flagmeterparts", "FlagMeterParts_2"),
        "flagmeter_progress": ("board/flagmeterlevelprogress", None),
        "start_ready": ("board/rsp/startready", None),
        "start_set": ("board/rsp/startset", None),
        "start_plant": ("board/rsp/startplant", None),
        "hugewave": ("board/rsp/hugewave", None),
        "finalwave": ("board/rsp/finalwave", None),
        "crater": ("griditem/crater/crater", None),
        "grave_obstacle": ("image/graves", "Graves_0"),
        "options_menuback": ("ui/spirte/menu/options_menuback", None),
        "options_sliderslot": ("ui/spirte/menu/options_sliderslot", None),
        "options_sliderknob2": ("ui/spirte/menu/options_sliderknob2", None),
        "options_backtogame": ("ui/spirte/menu/options_backtogamebutton0", None),
        "options_backtogame_hl": ("ui/spirte/menu/options_backtogamebutton2", None),
        "options_checkbox0": ("ui/spirte/menu/options_checkbox0", None),
        "options_checkbox1": ("ui/spirte/menu/options_checkbox1", None),
        "buttonsmall": ("ui/spirte/menu/buttonsmall", None),
        "buttonbig": ("ui/spirte/menu/buttonbig", None),
        "gameover": ("ui/spirte/menu/gameover", None),
    }

    for out_name, (rk, sp_name) in UI_SPECS.items():
        ents = rm_entries.get(rk.lower(), [])
        sps = [obj.read() for _sf, obj in ents if obj.type.name == "Sprite"]
        chosen = next((s for s in sps if s.m_Name == sp_name), None) if sp_name else (sps[0] if sps else None)
        if chosen is not None:
            try:
                im = chosen.image
                if im:
                    im.save(os.path.join(OUT_UI, f"{out_name}.webp"), format="WEBP", quality=90, method=4)
            except Exception:
                pass

    for dname in [
        "dialog_topleft", "dialog_topmiddle", "dialog_topright",
        "dialog_centerleft", "dialog_centermiddle", "dialog_centerright",
        "dialog_bottomleft", "dialog_bottommiddle", "dialog_bottomright",
        "dialog_header",
    ]:
        hits = all_sprites_by_name.get(dname, [])
        if hits:
            try:
                im = hits[0][2].image
                if im:
                    im.save(os.path.join(OUT_UI, f"{dname}.webp"), format="WEBP", quality=90, method=4)
            except Exception:
                pass

    for out_nm, rk in [("lawnmower.webp", "mower/cleaner/cleanerprefab"), ("poolcleaner.webp", "mower/pool/poolcleanerprefab")]:
        if rk in rm_entries:
            im = render_rm_entry(rm_entries[rk], max_dim=120, pad=2)
            if im is not None:
                im.save(os.path.join(OUT_UI, out_nm), format="WEBP", quality=90, method=4)

    if not args.skip_bg:
        convert_bg_files()

    audio_manifest = {}
    if not args.skip_audio:
        audio_manifest = convert_audio_files()
    else:
        for fn in sorted(os.listdir(OUT_AUDIO)):
            if fn.endswith(".ogg"):
                audio_manifest[os.path.splitext(fn)[0]] = f"assets/audio/{fn}"

    with open(os.path.join(OUT_DATA, "audio_manifest.json"), "w", encoding="utf-8") as f:
        json.dump(audio_manifest, f, ensure_ascii=False, separators=(",", ":"))

    scenes = {
        0:  {"id": 0,  "en": "Day",              "label": "白天草坪",     "bg": "Day_1400x600.webp",              "bgm": "Day",       "drumBgm": "Day_drum",       "rows": 5, "waterRows": [],           "cardStyle": "Default"},
        1:  {"id": 1,  "en": "Night",            "label": "黑夜草坪",     "bg": "Night_1400x600.webp",            "bgm": "Night",     "drumBgm": "Night_drum",     "rows": 5, "waterRows": [],           "night": True, "cardStyle": "Night"},
        2:  {"id": 2,  "en": "Pool",             "label": "泳池",         "bg": "Pool_1400x600.webp",             "bgm": "Pool",      "drumBgm": "Pool_drum",      "rows": 6, "waterRows": [2, 3],       "pool": True, "cardStyle": "Pool"},
        3:  {"id": 3,  "en": "NightPool",        "label": "浓雾泳池",     "bg": "NightPool_1400x600.webp",        "bgm": "Fog",       "drumBgm": "Fog_drum",       "rows": 6, "waterRows": [2, 3],       "pool": True, "night": True, "fog": True, "cardStyle": "NightPool"},
        4:  {"id": 4,  "en": "Roof",             "label": "屋顶",         "bg": "Roof_1400x600.webp",             "bgm": "Roof",      "drumBgm": "Roof_drum",      "rows": 5, "waterRows": [],           "roof": True, "cardStyle": "Roof"},
        5:  {"id": 5,  "en": "NightRoof",        "label": "黑夜屋顶",     "bg": "NightRoof_6_1400x600.webp",      "bgm": "Roof",      "drumBgm": "Roof_drum",      "rows": 5, "waterRows": [],           "roof": True, "night": True, "cardStyle": "Night"},
        6:  {"id": 6,  "en": "Day_6",            "label": "六行白天",     "bg": "Day_1400x600.webp",              "bgm": "Day",       "drumBgm": "Day_drum",       "rows": 6, "waterRows": [],           "cardStyle": "Default"},
        7:  {"id": 7,  "en": "Night_6",          "label": "六行黑夜",     "bg": "Night_1400x600.webp",            "bgm": "Night",     "drumBgm": "Night_drum",     "rows": 6, "waterRows": [],           "night": True, "cardStyle": "Night"},
        10: {"id": 10, "en": "Travel_roof",      "label": "六行屋顶",     "bg": "Roof_6_1400x600.webp",           "bgm": "Roof",      "drumBgm": "Roof_drum",      "rows": 6, "waterRows": [],           "roof": True, "cardStyle": "Roof"},
        12: {"id": 12, "en": "Travel_roof_dusk", "label": "黄昏屋顶",     "bg": "DuskRoof_6_1400x600.webp",       "bgm": "Roof",      "drumBgm": "Roof_drum",      "rows": 6, "waterRows": [],           "roof": True, "cardStyle": "Roof"},
        13: {"id": 13, "en": "Travel_roof_night","label": "黑夜六行屋顶", "bg": "NightRoof_6_1400x600.webp",      "bgm": "Roof",      "drumBgm": "Roof_drum",      "rows": 6, "waterRows": [],           "roof": True, "night": True, "cardStyle": "Night"},
        18: {"id": 18, "en": "Snow",             "label": "雪原",         "bg": "Snow_1400x600.webp",             "bgm": "Snow",      "drumBgm": "Snow_drum",      "rows": 5, "waterRows": [],           "snow": True, "cardStyle": "Snow"},
        20: {"id": 20, "en": "Snow_6",           "label": "六行雪原",     "bg": "Snow_6_1400x600.webp",           "bgm": "Snow",      "drumBgm": "Snow_drum",      "rows": 6, "waterRows": [],           "snow": True, "cardStyle": "Snow"},
        21: {"id": 21, "en": "ReversalPool",     "label": "反转泳池",     "bg": "ReversalPool_0000_land_1400x600.webp", "bgm": "Pool", "drumBgm": "Pool_drum",     "rows": 6, "waterRows": [0, 1, 4, 5], "pool": True, "night": True, "cardStyle": "NightPool"},
        22: {"id": 22, "en": "BigPool",          "label": "大泳池",       "bg": "BigPool_land_1400x600.webp",     "bgm": "Pool",      "drumBgm": "Pool_drum",      "rows": 6, "waterRows": [1, 2, 3, 4], "pool": True, "cardStyle": "Pool"},
        24: {"id": 24, "en": "River",            "label": "河道",         "bg": "Pool_1400x600.webp",             "bgm": "Pool",      "drumBgm": "Pool_drum",      "rows": 5, "waterRows": [2],          "pool": True, "cardStyle": "Pool"},
        28: {"id": 28, "en": "TreasureBeach",    "label": "沙滩",         "bg": "Pool_1400x600.webp",             "bgm": "Pool",      "drumBgm": "Pool_drum",      "rows": 5, "waterRows": [],           "cardStyle": "Pool"},
        29: {"id": 29, "en": "MidMap",           "label": "中庭",         "bg": "Day_1400x600.webp",              "bgm": "Day",       "drumBgm": "Day_drum",       "rows": 6, "waterRows": [],           "cardStyle": "Default"},
        30: {"id": 30, "en": "LavaBeach",        "label": "熔岩海滩",     "bg": "DuskRoof_6_1400x600.webp",       "bgm": "Roof",      "drumBgm": "Roof_drum",      "rows": 5, "waterRows": [],           "roof": True, "cardStyle": "Roof"},
        31: {"id": 31, "en": "NormalBeach",      "label": "海滩",         "bg": "Pool_1400x600.webp",             "bgm": "Pool",      "drumBgm": "Pool_drum",      "rows": 5, "waterRows": [],           "cardStyle": "Pool"},
        34: {"id": 34, "en": "RoofPool_night",   "label": "黑夜屋顶泳池", "bg": "NightPool_1400x600.webp",        "bgm": "RoofPool",  "drumBgm": "RoofPool_drum",  "rows": 6, "waterRows": [2, 3],       "pool": True, "night": True, "cardStyle": "NightPool"},
        40: {"id": 40, "en": "NightSnow",        "label": "黑夜雪原",     "bg": "NightSnow_2048x1024.webp",       "bgm": "NightSnow", "drumBgm": "NightSnow_drum", "rows": 5, "waterRows": [],           "night": True, "snow": True, "cardStyle": "NightSnow"},
    }

    catalog = {
        "version": "4.1",
        "plants": {str(k): v for k, v in plant_db.items()},
        "zombies": {str(k): v for k, v in zombie_db.items()},
        "recipes": recipes,
        "recipeList": recipe_list,
        "bullets": bullet_logical,
        "exploreLevels": list(sorted(explore_levels.values(), key=lambda x: x["id"])),
        "scenes": {str(k): v for k, v in scenes.items()},
    }

    with open(os.path.join(OUT_DATA, "catalog.json"), "w", encoding="utf-8") as f:
        json.dump(catalog, f, ensure_ascii=False, separators=(",", ":"))

    if iz_levels:
        with open(os.path.join(OUT_DATA, "iz_levels.json"), "w", encoding="utf-8") as f:
            json.dump(iz_levels, f, ensure_ascii=False, separators=(",", ":"))

    elapsed = time.time() - t0
    print(f"\n=== Compile finished in {elapsed:.1f}s ===")
    print(f"   catalog.json: {os.path.getsize(os.path.join(OUT_DATA, 'catalog.json')) / 1024:.1f} KB")
    print(f"   rigs/plants:  {dir_size_mb(OUT_RIGS_P):.2f} MB")
    print(f"   rigs/zombies: {dir_size_mb(OUT_RIGS_Z):.2f} MB")
    print(f"   portraits:    {dir_size_mb(os.path.join(OUT_ASSETS, 'portraits')):.2f} MB")
    print(f"   bg + ui:      {dir_size_mb(OUT_BG) + dir_size_mb(OUT_UI):.2f} MB")
    print(f"   audio:        {dir_size_mb(OUT_AUDIO):.2f} MB")
    print(f"   TOTAL ASSETS: {dir_size_mb(OUT_ASSETS):.2f} MB")


if __name__ == "__main__":
    main()
