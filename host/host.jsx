// Lineup CEP — Host Script. All ExtendScript logic, called via CSInterface.evalScript().

#include "LST.js"

// ── Global clipboard state ────────────────────────────────────────────────────
var _anchorClipboard = null;   // { anchor: [x, y] }
var _easeClipboard   = null;   // array of { inType, outType, inEase, outEase }
var _easeClipboardType = null;
// Whether the copied layer is 3D — value/ease array LENGTH alone can't tell (a 2D layer's Scale can carry a vestigial Z entry).
var _easeClipboardIs3D = null;
var _markerClipboard = null;   // array of { relTime, comment, chapter, cuePointName, duration, frameTarget, label, protectedRegion, url, params }
var _markerClipboardSpan = 0;  // source's own total duration (layer out-in, or comp.duration) — lets the panel preview draw a rectangle for the whole layer, not just the span between the first/last marker

// ── Position helpers ──────────────────────────────────────────────────────────

function shiftPosition(posProp, dx, dy, is3D) {
    if (posProp.dimensionsSeparated) {
        var xp = posProp.getSeparationFollower(0);
        var yp = posProp.getSeparationFollower(1);
        if (xp.numKeys > 0) {
            for (var k = 1; k <= xp.numKeys; k++) xp.setValueAtKey(k, xp.keyValue(k) + dx);
        } else { xp.setValue(xp.value + dx); }
        if (yp.numKeys > 0) {
            for (var k = 1; k <= yp.numKeys; k++) yp.setValueAtKey(k, yp.keyValue(k) + dy);
        } else { yp.setValue(yp.value + dy); }
    } else if (posProp.numKeys > 0) {
        for (var k = 1; k <= posProp.numKeys; k++) {
            var v = posProp.keyValue(k);
            posProp.setValueAtKey(k, is3D ? [v[0]+dx, v[1]+dy, v[2]] : [v[0]+dx, v[1]+dy]);
        }
    } else {
        var v = posProp.value;
        posProp.setValue(is3D ? [v[0]+dx, v[1]+dy, v[2]] : [v[0]+dx, v[1]+dy]);
    }
}

function setPositionAt(posProp, newPos, t, is3D) {
    if (posProp.dimensionsSeparated) {
        var xp = posProp.getSeparationFollower(0);
        var yp = posProp.getSeparationFollower(1);
        if (xp.numKeys > 0) { xp.setValueAtTime(t, newPos[0]); } else { xp.setValue(newPos[0]); }
        if (yp.numKeys > 0) { yp.setValueAtTime(t, newPos[1]); } else { yp.setValue(newPos[1]); }
    } else if (posProp.numKeys > 0) {
        posProp.setValueAtTime(t, newPos);
    } else {
        posProp.setValue(newPos);
    }
}

function getZ(posProp) {
    if (posProp.dimensionsSeparated) return posProp.getSeparationFollower(2).value;
    return posProp.value[2];
}

function setZ(posProp, targetZ) {
    if (posProp.dimensionsSeparated) {
        var zp = posProp.getSeparationFollower(2);
        if (zp.numKeys > 0) {
            for (var k = 1; k <= zp.numKeys; k++) zp.setValueAtKey(k, targetZ);
        } else { zp.setValue(targetZ); }
    } else if (posProp.numKeys > 0) {
        for (var k = 1; k <= posProp.numKeys; k++) {
            var v = posProp.keyValue(k);
            posProp.setValueAtKey(k, [v[0], v[1], targetZ]);
        }
    } else {
        var v = posProp.value;
        posProp.setValue([v[0], v[1], targetZ]);
    }
}

// ── Bounds / anchor helpers ───────────────────────────────────────────────────

// A TextLayer with "Enable Per-character 3D" on (which any animator using a 3D property — Position
// Z, X/Y/Z Rotation, etc. — turns on automatically) makes sourceRectAtTime() return incorrect/stale
// bounds: AE's classic sourceRectAtTime is fundamentally a flat 2D box and can't represent characters
// an animator has moved off-plane through a camera, so it silently falls back to a wrong box instead
// of throwing — no exception for Anchor Point/Align/Distribute's own try/catch to ever see. Measuring
// with per-character 3D temporarily switched off sidesteps that broken fallback; the property is always
// restored, on both the success and error paths, so this never leaves the layer altered.
function sourceRectAtTimeSafe(layer, t, extents) {
    var forcedFlat = false;
    try {
        if ((layer instanceof TextLayer) && layer.threeDPerChar) {
            layer.threeDPerChar = false;
            forcedFlat = true;
        }
    } catch (e) { forcedFlat = false; }
    try {
        var r = layer.sourceRectAtTime(t, extents);
        if (forcedFlat) layer.threeDPerChar = true;
        return r;
    } catch (err) {
        if (forcedFlat) { try { layer.threeDPerChar = true; } catch (e2) {} }
        throw err;
    }
}

function getLayerCompBounds(layer, comp) {
    var r = sourceRectAtTimeSafe(layer, comp.time, false);
    var left = r.left, top = r.top, right = left + r.width, bottom = top + r.height;
    var p1 = LST.toComp(layer, [left,  top,    0]);
    var p2 = LST.toComp(layer, [right, top,    0]);
    var p3 = LST.toComp(layer, [right, bottom, 0]);
    var p4 = LST.toComp(layer, [left,  bottom, 0]);
    var xs = [p1[0], p2[0], p3[0], p4[0]];
    var ys = [p1[1], p2[1], p3[1], p4[1]];
    return {
        left:   Math.min.apply(null, xs), right:  Math.max.apply(null, xs),
        top:    Math.min.apply(null, ys), bottom: Math.max.apply(null, ys),
        width:  Math.max.apply(null, xs) - Math.min.apply(null, xs),
        height: Math.max.apply(null, ys) - Math.min.apply(null, ys)
    };
}

// loc is a row-major index into an n x n grid (n defaults to 3 for the original 9-cell grid's
// callers, which never pass it). Dividing by (n - 1) rather than a literal 2 is what generalizes
// this beyond 3x3 — 2 only happened to be correct there because n-1 === 2 for a 3-wide grid.
function anchorLocToPoint(loc, lw, lh, left, top, n) {
    n = n || 3;
    var denom = n - 1 || 1;
    return [left + (loc % n) * lw / denom, top + Math.floor(loc / n) * lh / denom];
}

function getSourceRect(layer, t, ignoreMasks) {
    if (ignoreMasks) return sourceRectAtTimeSafe(layer, t, false);
    var fullRect = sourceRectAtTimeSafe(layer, t, false);
    var mp;
    try { mp = layer.property("ADBE Mask Parade"); } catch(e) { return fullRect; }
    if (!mp || mp.numProperties === 0) return fullRect;
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, found = false;
    for (var i = 1; i <= mp.numProperties; i++) {
        try {
            var mask = mp.property(i);
            if (!mask.enabled) continue;
            var mode = mask.maskMode;
            if (mode === MaskMode.NONE || mode === MaskMode.SUBTRACT) continue;
            var shape = mask.property("ADBE Mask Shape").valueAtTime(t, false);
            var verts = shape.vertices, inT = shape.inTangents, outT = shape.outTangents;
            if (!verts || verts.length === 0) continue;
            for (var v = 0; v < verts.length; v++) {
                var vx = verts[v][0], vy = verts[v][1];
                if (vx < minX) minX = vx; if (vy < minY) minY = vy;
                if (vx > maxX) maxX = vx; if (vy > maxY) maxY = vy;
                if (outT && outT[v]) {
                    var ox = vx + outT[v][0], oy = vy + outT[v][1];
                    if (ox < minX) minX = ox; if (oy < minY) minY = oy;
                    if (ox > maxX) maxX = ox; if (oy > maxY) maxY = oy;
                }
                if (inT && inT[v]) {
                    var ix = vx + inT[v][0], iy = vy + inT[v][1];
                    if (ix < minX) minX = ix; if (iy < minY) minY = iy;
                    if (ix > maxX) maxX = ix; if (iy > maxY) maxY = iy;
                }
            }
            found = true;
        } catch(e) {}
    }
    if (!found || minX === Infinity) return fullRect;
    return { left: minX, top: minY, width: maxX - minX, height: maxY - minY };
}

function collapsePosition(layer) {
    var pos = layer.position;
    if (!pos.dimensionsSeparated) return;
    var x = pos.getSeparationFollower(0).value;
    var y = pos.getSeparationFollower(1).value;
    var z = layer.threeDLayer ? pos.getSeparationFollower(2).value : 0;
    pos.dimensionsSeparated = false;
    while (pos.numKeys > 0) pos.removeKey(1);
    pos.setValue(layer.threeDLayer ? [x, y, z] : [x, y]);
}

function fromComp(layer, compPoint) {
    var pos = layer.position.value;
    var anchor = layer.anchorPoint.value;
    var scale = layer.scale.value;
    var rotation = layer.rotation.value * (Math.PI / 180);
    if (layer.parent) compPoint = fromComp(layer.parent, compPoint);
    var dx = compPoint[0] - pos[0], dy = compPoint[1] - pos[1];
    var cos = Math.cos(-rotation), sin = Math.sin(-rotation);
    var rx = cos * dx - sin * dy, ry = sin * dx + cos * dy;
    return [rx / (scale[0] / 100) + anchor[0], ry / (scale[1] / 100) + anchor[1]];
}

// Inverse of fromComp — walks a local point up through the layer's transform and parent chain into comp space.
// Kept independent of LST.toComp since its offset param silently NaNs on plain arrays instead of subtracting componentwise.
function toComp(layer, localPoint) {
    var pos = layer.position.value;
    var anchor = layer.anchorPoint.value;
    var scale = layer.scale.value;
    var rotation = layer.rotation.value * (Math.PI / 180);
    var ux = (localPoint[0] - anchor[0]) * (scale[0] / 100);
    var uy = (localPoint[1] - anchor[1]) * (scale[1] / 100);
    var cos = Math.cos(rotation), sin = Math.sin(rotation);
    var rx = cos * ux - sin * uy, ry = sin * ux + cos * uy;
    var parentPoint = [rx + pos[0], ry + pos[1]];
    return layer.parent ? toComp(layer.parent, parentPoint) : parentPoint;
}

// Converts a delta from `ancestor`'s parent space into its own local space (rotate+scale only — position/anchor terms cancel for deltas).
function oneLevelDelta(ancestor, dx, dy) {
    var scale = ancestor.scale.value;
    var rotation = ancestor.rotation.value * (Math.PI / 180);
    var cos = Math.cos(-rotation), sin = Math.sin(-rotation);
    var rx = cos*dx - sin*dy, ry = sin*dx + cos*dy;
    return [rx / (scale[0]/100), ry / (scale[1]/100)];
}

// Converts a comp-space delta into a layer.position delta, walking the ancestor chain top-down.
// Needed because a comp-space pixel delta only equals a position-unit delta with no scaled/rotated parent (e.g. a rig null).
function compDeltaToPositionDelta(layer, dCompX, dCompY) {
    var chain = [];
    for (var p = layer.parent; p; p = p.parent) chain.push(p);
    var dx = dCompX, dy = dCompY;
    for (var i = chain.length - 1; i >= 0; i--) {
        var d = oneLevelDelta(chain[i], dx, dy);
        dx = d[0]; dy = d[1];
    }
    return [dx, dy];
}

function applyAnchorShift(layer, newAnchor) {
    var comp = app.project.activeItem;
    var t = comp.time;
    var is3D = layer.threeDLayer;
    var oldA = layer.anchorPoint.value;
    var dAx = newAnchor[0] - oldA[0];
    var dAy = newAnchor[1] - oldA[1];
    // Delta must be in parent space — use only this layer's own rotation/scale, not the full parent chain.
    var rot = layer.rotation.value * (Math.PI / 180);
    var sx  = layer.scale.value[0] / 100;
    var sy  = layer.scale.value[1] / 100;
    var cos = Math.cos(rot), sin = Math.sin(rot);
    var deltaX = (cos * dAx - sin * dAy) * sx;
    var deltaY = (sin * dAx + cos * dAy) * sy;
    if (layer.anchorPoint.numKeys > 0) {
        layer.anchorPoint.setValueAtTime(t, newAnchor);
    } else {
        layer.anchorPoint.setValue(newAnchor);
    }
    shiftPosition(layer.position, deltaX, deltaY, is3D);
}

function pasteAnchor(layer, newAnchor) {
    try {
        if (!layer) return;
        var newAnchorLocal = fromComp(layer, newAnchor);
        var oldAnchorLocal = layer.anchorPoint.value;
        var dAx = newAnchorLocal[0] - oldAnchorLocal[0];
        var dAy = newAnchorLocal[1] - oldAnchorLocal[1];
        // Delta must be in parent space — use only this layer's own rotation/scale, not the full parent chain.
        var rot = layer.rotation.value * (Math.PI / 180);
        var sx  = layer.scale.value[0] / 100;
        var sy  = layer.scale.value[1] / 100;
        var cos = Math.cos(rot), sin = Math.sin(rot);
        var deltaX = (cos * dAx - sin * dAy) * sx;
        var deltaY = (sin * dAx + cos * dAy) * sy;
        if (layer.anchorPoint.numKeys > 0) {
            for (var k = 1; k <= layer.anchorPoint.numKeys; k++) {
                var val = layer.anchorPoint.keyValue(k);
                var nv = [val[0] + dAx, val[1] + dAy];
                if (val.length > 2) nv.push(val[2]);
                layer.anchorPoint.setValueAtKey(k, nv);
            }
        } else {
            layer.anchorPoint.setValue(newAnchorLocal);
        }
        shiftPosition(layer.position, deltaX, deltaY, layer.threeDLayer);
    } catch (err) { alert("Anchor Paste ERROR:\n" + err.toString()); }
}

// ── KEYFRAME ALIGN ────────────────────────────────────────────────────────────
// Horizontal align redirects here when keyframes are selected; vertical align has no 1D-time equivalent so it never does.

// Collects every selected keyframe on ONE layer, grouped by property — {prop, indices}[].
// Factored out so the Stagger tool can reuse the same per-layer walk.
function lineup_collectLayerKeyGroups(layer) {
    var groups = [];
    var sel = layer.selectedProperties;
    if (!sel) return groups;
    for (var j = 0; j < sel.length; j++) {
        var prop = sel[j];
        if (!(prop instanceof Property) || prop.numKeys < 1) continue;
        var indices = [];
        for (var k = 1; k <= prop.numKeys; k++) {
            if (prop.keySelected(k)) indices.push(k);
        }
        if (indices.length > 0) groups.push({ prop: prop, indices: indices });
    }
    return groups;
}

// Collects every selected keyframe, grouped by property, across all selected
// layers — {prop, indices}[]. Shared by the align action and the lightweight
// poll the panel uses to swap the button icons live.
function lineup_collectSelectedKeyGroups(comp) {
    var groups = [];
    var layers = comp.selectedLayers;
    for (var i = 0; i < layers.length; i++) {
        groups = groups.concat(lineup_collectLayerKeyGroups(layers[i]));
    }
    return groups;
}

// Cheap poll target for the panel: "1" as soon as any keyframe is selected.
function lineup_hasSelectedKeyframes() {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return "0";
        return lineup_collectSelectedKeyGroups(comp).length > 0 ? "1" : "0";
    } catch (err) {
        return "0";
    }
}

// Cheap poll target for the Favorites bar's smart-stack switch: "1" if the actual selection includes a shape layer.
// Unlike lineup_shapeColorHudTargetLayers, this never falls back to "any shape layer in the comp".
function lineup_hasSelectedShapeLayer() {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return "0";
        var layers = comp.selectedLayers;
        for (var i = 0; i < layers.length; i++) {
            if (layers[i] instanceof ShapeLayer) return "1";
        }
        return "0";
    } catch (err) {
        return "0";
    }
}

// Captures a keyframe's value/interpolation/ease/spatial-tangent state before it's removed and recreated at a new time.
// Must run for EVERY keyframe in a batch BEFORE any are retimed — recreating one keyframe can silently flip an
// adjacent keyframe's interpolation as an AE-internal side effect, corrupting state read mid-loop.
function lineup_snapshotKey(prop, keyIndex) {
    var value   = prop.keyValue(keyIndex);
    var inType  = prop.keyInInterpolationType(keyIndex);
    var outType = prop.keyOutInterpolationType(keyIndex);
    // Ease is captured per side independently (not gated on both sides being Bezier) to handle mixed-interpolation keyframes correctly.
    var inIsBezier  = (inType  === KeyframeInterpolationType.BEZIER);
    var outIsBezier = (outType === KeyframeInterpolationType.BEZIER);
    var inEase = null, outEase = null, wasAutoBezier = false, wasContinuous = false;
    var inTan = null, outTan = null, isSpatial = false, wasSpatialContinuous = false, wasSpatialAutoBezier = false;

    if (inIsBezier)  { try { inEase  = prop.keyInTemporalEase(keyIndex); }  catch (e) {} }
    if (outIsBezier) { try { outEase = prop.keyOutTemporalEase(keyIndex); } catch (e) {} }
    if (inIsBezier && outIsBezier) {
        try { wasAutoBezier = prop.keyTemporalAutoBezier(keyIndex); } catch (e) {}
        try { wasContinuous = prop.keyTemporalContinuous(keyIndex); }  catch (e) {}
    }
    try {
        if (prop.isSpatial) {
            isSpatial = true;
            inTan  = prop.keyInSpatialTangent(keyIndex);
            outTan = prop.keyOutSpatialTangent(keyIndex);
            try { wasSpatialContinuous = prop.keySpatialContinuous(keyIndex); } catch (e) {}
            if (wasSpatialContinuous) { try { wasSpatialAutoBezier = prop.keySpatialAutoBezier(keyIndex); } catch (e) {} }
        }
    } catch (e) { isSpatial = false; }

    var roving = false;
    try { roving = prop.keyRoving(keyIndex); } catch (e) {}

    return {
        value: value, inType: inType, outType: outType,
        inIsBezier: inIsBezier, outIsBezier: outIsBezier,
        inEase: inEase, outEase: outEase,
        wasAutoBezier: wasAutoBezier, wasContinuous: wasContinuous,
        inTan: inTan, outTan: outTan, isSpatial: isSpatial,
        wasSpatialContinuous: wasSpatialContinuous, wasSpatialAutoBezier: wasSpatialAutoBezier,
        roving: roving
    };
}

// Applies a snapshot's interpolation/ease/spatial-tangent data to an
// EXISTING keyframe at keyIndex, without moving it or touching its value.
// Called from lineup_alignKeyframes' own final restore pass — run only
// after EVERY keyframe on a property has already been moved (see
// lineup_moveKeyOnly's comment) — both for keys that were themselves moved
// and for unmoved neighbors of a moved key (removeKey/setValueAtTime on ONE
// keyframe can silently flip the interpolation type of the keyframe right
// next to it, since the segment between two keys isn't purely one-sided
// internally). Reapplying this to a keyframe that was never actually
// altered is harmless — every call here targets that key's own existing
// in/out sides with its own original values.
function lineup_restoreKeySnapshot(prop, keyIndex, snap) {
    // Ease FIRST, interpolation type SECOND — setTemporalEaseAtKey force-
    // promotes both sides of a key to Bezier as a side effect, so applying
    // it after the real interpolation type would silently re-promote a
    // just-set Hold/Linear side back to Bezier (same ordering rule
    // applyPastedEase already uses, see its own comment for the full
    // explanation). setTemporalEaseAtKey requires a valid ease value for
    // BOTH sides even when only one side is actually Bezier, so whichever
    // side wasn't captured gets a constructed neutral placeholder — the
    // placeholder is harmless regardless of its exact values since the
    // interpolation-type call right after this overrides that side back
    // to Linear/Hold anyway, where ease doesn't apply.
    if (snap.wasAutoBezier) {
        try { prop.setTemporalAutoBezierAtKey(keyIndex, true); } catch (e) {}
    } else if (snap.inEase || snap.outEase) {
        var dimN = (snap.inEase || snap.outEase).length;
        var neutralEase = [];
        for (var ne = 0; ne < dimN; ne++) neutralEase.push(new KeyframeEase(0, 100 / 3));
        try { prop.setTemporalEaseAtKey(keyIndex, snap.inEase || neutralEase, snap.outEase || neutralEase); } catch (e) {}
        if (snap.inIsBezier && snap.outIsBezier) {
            try { prop.setTemporalContinuousAtKey(keyIndex, snap.wasContinuous); } catch (e) {}
        }
    }
    try { prop.setInterpolationTypeAtKey(keyIndex, snap.inType, snap.outType); } catch (e) {}

    if (snap.isSpatial) {
        try { prop.setSpatialTangentsAtKey(keyIndex, snap.inTan, snap.outTan); } catch (e) {}
        try { prop.setSpatialContinuousAtKey(keyIndex, snap.wasSpatialContinuous); } catch (e) {}
        if (snap.wasSpatialContinuous && snap.wasSpatialAutoBezier) {
            try { prop.setSpatialAutoBezierAtKey(keyIndex, true); } catch (e) {}
        }
    }
}

// Moves one keyframe to newTime WITHOUT restoring interpolation/ease/tangents yet — that's deferred to one final pass
// after EVERY keyframe on this property has moved, since restoring per-key immediately could let a sibling's move
// re-corrupt it. AE has no native "move keyframe time", so this removes and re-adds it, preserving value from snap.
function lineup_moveKeyOnly(prop, keyIndex, newTime, snap) {
    if (prop.keyTime(keyIndex) === newTime) return;
    if (snap.roving) return;

    prop.removeKey(keyIndex);
    prop.setValueAtTime(newTime, snap.value);
    // Not reselected here — done in one final pass after every key has moved (see lineup_alignKeyframes).
}

// Moves every key in `entries` ({prop, indices, delta}) by its own delta — a rigid per-property translation.
// Shared by lineup_alignKeyframes and lineup_staggerKeyframes; snapshots ALL keys (plus unselected neighbors, which
// AE can silently re-interpolate) before any retiming, moves them all, then restores interpolation/ease last.
function lineup_shiftKeyGroupsByDelta(entries) {
    var snapshotsByEntry = [];
    var neighborSnapsByEntry = [];
    for (var g = 0; g < entries.length; g++) {
        var prop = entries[g].prop;
        var indices = entries[g].indices;
        var snaps = [];
        var movedIndexSet = {};
        for (var i = 0; i < indices.length; i++) movedIndexSet[indices[i]] = true;
        for (var i = 0; i < indices.length; i++) {
            snaps.push(lineup_snapshotKey(prop, indices[i]));
        }
        snapshotsByEntry.push(snaps);

        var neighborSnaps = [];
        var neighborSeen = {};
        for (var i = 0; i < indices.length; i++) {
            var idx = indices[i];
            var prevIdx = idx - 1, nextIdx = idx + 1;
            if (prevIdx >= 1 && !movedIndexSet[prevIdx] && !neighborSeen[prevIdx]) {
                neighborSeen[prevIdx] = true;
                neighborSnaps.push({ time: prop.keyTime(prevIdx), snap: lineup_snapshotKey(prop, prevIdx) });
            }
            if (nextIdx <= prop.numKeys && !movedIndexSet[nextIdx] && !neighborSeen[nextIdx]) {
                neighborSeen[nextIdx] = true;
                neighborSnaps.push({ time: prop.keyTime(nextIdx), snap: lineup_snapshotKey(prop, nextIdx) });
            }
        }
        neighborSnapsByEntry.push(neighborSnaps);
    }

    var newTimesByEntry = [];
    for (var g = 0; g < entries.length; g++) {
        var prop = entries[g].prop;
        var indices = entries[g].indices;
        var delta = entries[g].delta;
        var origTimes = [];
        for (var i = 0; i < indices.length; i++) origTimes.push(prop.keyTime(indices[i]));

        // Rigid shift (not a collapse), so re-locating by ORIGINAL time via nearestKeyIndex stays correct as sibling moves shift indices.
        var newTimes = [];
        for (var i = 0; i < origTimes.length; i++) {
            var nt = origTimes[i] + delta;
            newTimes.push(nt);
            lineup_moveKeyOnly(prop, prop.nearestKeyIndex(origTimes[i]), nt, snapshotsByEntry[g][i]);
        }
        newTimesByEntry.push(newTimes);
    }

    for (var g = 0; g < entries.length; g++) {
        var prop = entries[g].prop;
        var newTimes = newTimesByEntry[g];
        var snaps = snapshotsByEntry[g];
        for (var i = 0; i < newTimes.length; i++) {
            if (snaps[i].roving) continue;
            var ni = prop.nearestKeyIndex(newTimes[i]);
            lineup_restoreKeySnapshot(prop, ni, snaps[i]);
        }
        var neighborSnaps = neighborSnapsByEntry[g];
        for (var i = 0; i < neighborSnaps.length; i++) {
            var nni = prop.nearestKeyIndex(neighborSnaps[i].time);
            lineup_restoreKeySnapshot(prop, nni, neighborSnaps[i].snap);
        }
    }

    for (var g = 0; g < entries.length; g++) {
        var prop = entries[g].prop;
        var newTimes = newTimesByEntry[g];
        for (var i = 0; i < newTimes.length; i++) {
            try { prop.setSelectedAtKey(prop.nearestKeyIndex(newTimes[i]), true); } catch (e) {}
        }
    }
}

// alignIdx: 0=left, 1=centerX, 2=right. Each property's selected keys form a bounding box; this moves that box's
// edge to comp.time (the playhead) and shifts every key in it by the same delta. alignToSelection is accepted for
// call-signature parity with lineup_align but unused — keyframe align always targets the playhead, never the selection/comp bounds.
function lineup_alignKeyframes(alignIdx, alignToSelection, comp, groups) {
    try {
        var allTimes = [];
        for (var g = 0; g < groups.length; g++) {
            var grp = groups[g];
            for (var i = 0; i < grp.indices.length; i++) allTimes.push(grp.prop.keyTime(grp.indices[i]));
        }
        if (allTimes.length === 0) return "ERROR: No keyframes selected";

        var target = comp.time;

        app.beginUndoGroup("Align Keyframes");

        var entries = [];
        for (var g = 0; g < groups.length; g++) {
            var prop = groups[g].prop;
            var indices = groups[g].indices;
            var origTimes = [];
            for (var i = 0; i < indices.length; i++) origTimes.push(prop.keyTime(indices[i]));

            var boxMin = Math.min.apply(Math, origTimes);
            var boxMax = Math.max.apply(Math, origTimes);
            var delta;
            if (alignIdx === 0)      delta = target - boxMin;
            else if (alignIdx === 2) delta = target - boxMax;
            else                     delta = target - (boxMin + boxMax) / 2;

            entries.push({ prop: prop, indices: indices, delta: delta });
        }

        lineup_shiftKeyGroupsByDelta(entries);

        app.endUndoGroup();
        return "ok";
    } catch (err) {
        try { app.endUndoGroup(); } catch (e) {}
        return "ERROR: " + err.toString();
    }
}

// ── KEYFRAME STAGGER ─────────────────────────────────────────────────────────
// Cascades selected keyframes across layers so each layer's block starts a bit later/earlier than the previous one.

// One row per layer with a selected keyframe, in Timeline stacking order — name, its keys' time span, and frameDuration for the Stagger popup.
function lineup_getStaggerLayerGroups() {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return "null";
        var layers = comp.selectedLayers;
        var rows = [];
        for (var i = 0; i < layers.length; i++) {
            var layer = layers[i];
            var groups = lineup_collectLayerKeyGroups(layer);
            if (groups.length === 0) continue;
            var minTime = Infinity, maxTime = -Infinity;
            for (var g = 0; g < groups.length; g++) {
                var prop = groups[g].prop, indices = groups[g].indices;
                for (var k = 0; k < indices.length; k++) {
                    var t = prop.keyTime(indices[k]);
                    if (t < minTime) minTime = t;
                    if (t > maxTime) maxTime = t;
                }
            }
            rows.push({
                layerIndex: layer.index, layerName: layer.name,
                minTime: minTime, maxTime: maxTime
            });
        }
        rows.sort(function(a, b) { return a.layerIndex - b.layerIndex; });
        return JSON.stringify({ layers: rows, frameDuration: comp.frameDuration });
    } catch (err) {
        return "null";
    }
}

// payloadJson: [{ layerIndex, offsetSeconds }, ...] from the Stagger popup. Groups are re-collected fresh (not
// reused from lineup_getStaggerLayerGroups) and every selected property on a layer gets the same delta, moving it as one block.
function lineup_staggerKeyframes(payloadJson) {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return "ERROR: No active composition";
        var payload;
        try { payload = JSON.parse(payloadJson); } catch (e) { return "ERROR: Invalid payload"; }
        if (!payload || !payload.length) return "ERROR: Nothing to stagger";

        var entries = [];
        for (var p = 0; p < payload.length; p++) {
            var layer;
            try { layer = comp.layer(payload[p].layerIndex); } catch (e) { layer = null; }
            if (!layer) continue;
            var groups = lineup_collectLayerKeyGroups(layer);
            for (var g = 0; g < groups.length; g++) {
                entries.push({ prop: groups[g].prop, indices: groups[g].indices, delta: payload[p].offsetSeconds });
            }
        }
        if (entries.length === 0) return "ERROR: No keyframes selected";

        app.beginUndoGroup("Stagger Keyframes");
        lineup_shiftKeyGroupsByDelta(entries);
        app.endUndoGroup();
        return "ok";
    } catch (err) {
        try { app.endUndoGroup(); } catch (e) {}
        return "ERROR: " + err.toString();
    }
}

// ── LAYER STAGGER ────────────────────────────────────────────────────────────
// Cascades each selected layer's startTime instead of retiming keyframes, so it works on layers with none.

// One row per selected layer, in Timeline stacking order — mirrors lineup_getStaggerLayerGroups's shape.
function lineup_getLayerStaggerGroups() {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return "null";
        var layers = comp.selectedLayers;
        var rows = [];
        for (var i = 0; i < layers.length; i++) {
            var layer = layers[i];
            rows.push({ layerIndex: layer.index, layerName: layer.name, startTime: layer.startTime });
        }
        rows.sort(function(a, b) { return a.layerIndex - b.layerIndex; });
        return JSON.stringify({ layers: rows, frameDuration: comp.frameDuration });
    } catch (err) {
        return "null";
    }
}

// payloadJson: [{ layerIndex, offsetSeconds }, ...], computed client-side same as lineup_staggerKeyframes's payload.
function lineup_staggerLayerStarts(payloadJson) {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return "ERROR: No active composition";
        var payload;
        try { payload = JSON.parse(payloadJson); } catch (e) { return "ERROR: Invalid payload"; }
        if (!payload || !payload.length) return "ERROR: Nothing to stagger";

        app.beginUndoGroup("Stagger Layer Starts");
        for (var p = 0; p < payload.length; p++) {
            var layer;
            try { layer = comp.layer(payload[p].layerIndex); } catch (e) { layer = null; }
            if (!layer) continue;
            layer.startTime = layer.startTime + payload[p].offsetSeconds;
        }
        app.endUndoGroup();
        return "ok";
    } catch (err) {
        try { app.endUndoGroup(); } catch (e) {}
        return "ERROR: " + err.toString();
    }
}

// ── SHAPE ALIGN ───────────────────────────────────────────────────────────────
// Redirects here when a shape Contents item is selected; walks the full ancestor-group + layer + parent transform chain to get comp-space bounds. 2D-only (assumes the layer isn't 3D-tilted).

var LINEUP_SHAPE_MATCHNAMES = {
    "ADBE Vector Group": 1,
    "ADBE Vector Shape - Rect": 1,
    "ADBE Vector Shape - Ellipse": 1,
    "ADBE Vector Shape - Star": 1,
    "ADBE Vector Shape - Group": 1 // Path
};

function lineup_collectSelectedShapeItems(comp) {
    var out = [];
    var layers = comp.selectedLayers;
    for (var i = 0; i < layers.length; i++) {
        var sel = layers[i].selectedProperties;
        if (!sel) continue;
        for (var j = 0; j < sel.length; j++) {
            var p = sel[j], mn;
            try { mn = p.matchName; } catch (e) { continue; }
            if (LINEUP_SHAPE_MATCHNAMES[mn]) out.push({ layer: layers[i], item: p });
        }
    }
    return out;
}

// Cheap poll target for the Grid Distribute picker — lets it guess a
// cols x rows shape sized to how many layers are actually selected instead
// of just repeating whatever was picked last time.
function lineup_getSelectedLayerCount() {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return "0";
        return String(comp.selectedLayers.length);
    } catch (err) {
        return "0";
    }
}

// Walks from a shape item up to (not including) the layer, collecting every ancestor "ADBE Vector Group", skipping the transform-less content-list wrappers between them.
function lineup_ancestorVectorGroups(item) {
    var groups = [];
    var cur = item;
    while (true) {
        var parent;
        try { parent = cur.propertyGroup(1); } catch (e) { break; }
        if (!parent) break;
        var mn;
        try { mn = parent.matchName; } catch (e) { mn = null; }
        if (mn === "ADBE Vector Group") groups.push(parent);
        else if (mn !== "ADBE Vectors Group" && mn !== "ADBE Root Vectors Group") break;
        cur = parent;
        if (mn === "ADBE Root Vectors Group") break; // next level up is the layer itself
    }
    return groups;
}

// Forward point transform through one Group's own transform (child-local ->
// this group's parent space): translate to anchor, scale, skew, rotate,
// translate to position — the same order AE's own Group Transform UI lists
// its properties in.
function lineup_vecTransformPoint(tg, x, y) {
    var anchor = tg.property("ADBE Vector Anchor").value;
    var position = tg.property("ADBE Vector Position").value;
    var scale = tg.property("ADBE Vector Scale").value;
    var skew = tg.property("ADBE Vector Skew").value;
    var skewAxis = tg.property("ADBE Vector Skew Axis").value;
    var rotation = tg.property("ADBE Vector Rotation").value;

    var px = x - anchor[0], py = y - anchor[1];
    px = px * (scale[0] / 100); py = py * (scale[1] / 100);
    if (skew) {
        var axisRad = skewAxis * Math.PI / 180;
        var ca = Math.cos(axisRad), sa = Math.sin(axisRad);
        var xr =  ca * px + sa * py;
        var yr = -sa * px + ca * py;
        xr = xr + yr * Math.tan(skew * Math.PI / 180);
        px = ca * xr - sa * yr;
        py = sa * xr + ca * yr;
    }
    var rad = rotation * Math.PI / 180;
    var cos = Math.cos(rad), sin = Math.sin(rad);
    var rx = cos * px - sin * py, ry = sin * px + cos * py;
    return [rx + position[0], ry + position[1]];
}

// Inverse LINEAR map only (no anchor/position — translation is irrelevant to
// how a delta transforms) — the delta-space counterpart of
// lineup_vecTransformPoint, same relationship oneLevelDelta has to LST.toComp.
function lineup_vecGroupInverseDelta(tg, dx, dy) {
    var scale = tg.property("ADBE Vector Scale").value;
    var skew = tg.property("ADBE Vector Skew").value;
    var skewAxis = tg.property("ADBE Vector Skew Axis").value;
    var rotation = tg.property("ADBE Vector Rotation").value;

    var rad = -rotation * Math.PI / 180;
    var cos = Math.cos(rad), sin = Math.sin(rad);
    var x = cos * dx - sin * dy, y = sin * dx + cos * dy;

    if (skew) {
        var axisRad = skewAxis * Math.PI / 180;
        var ca = Math.cos(axisRad), sa = Math.sin(axisRad);
        var xr =  ca * x + sa * y;
        var yr = -sa * x + ca * y;
        xr = xr - yr * Math.tan(skew * Math.PI / 180);
        x = ca * xr - sa * yr;
        y = sa * xr + ca * yr;
    }
    return [x / (scale[0] / 100 || 1), y / (scale[1] / 100 || 1)];
}

function lineup_transformBBoxThroughGroup(tg, box) {
    var c1 = lineup_vecTransformPoint(tg, box.left,  box.top);
    var c2 = lineup_vecTransformPoint(tg, box.right, box.top);
    var c3 = lineup_vecTransformPoint(tg, box.right, box.bottom);
    var c4 = lineup_vecTransformPoint(tg, box.left,  box.bottom);
    var xs = [c1[0], c2[0], c3[0], c4[0]], ys = [c1[1], c2[1], c3[1], c4[1]];
    return {
        left: Math.min.apply(null, xs), top: Math.min.apply(null, ys),
        right: Math.max.apply(null, xs), bottom: Math.max.apply(null, ys)
    };
}

// Bounding box of one Contents item in its immediate parent's space, with that Group's own transform already applied — ready to union with sibling items.
function lineup_shapeItemBBoxInParentSpace(item) {
    var mn = item.matchName;
    if (mn === "ADBE Vector Shape - Rect" || mn === "ADBE Vector Shape - Ellipse") {
        var posName = (mn === "ADBE Vector Shape - Rect") ? "ADBE Vector Rect Position" : "ADBE Vector Ellipse Position";
        var sizeName = (mn === "ADBE Vector Shape - Rect") ? "ADBE Vector Rect Size" : "ADBE Vector Ellipse Size";
        var pos = item.property(posName).value, size = item.property(sizeName).value;
        return { left: pos[0]-size[0]/2, top: pos[1]-size[1]/2, right: pos[0]+size[0]/2, bottom: pos[1]+size[1]/2 };
    }
    if (mn === "ADBE Vector Shape - Star") {
        // Treated as its bounding circle (outer radius) — a safe superset, exact for Polygon type or a symmetric star.
        var pos = item.property("ADBE Vector Star Position").value;
        var r = item.property("ADBE Vector Star Outer Radius").value;
        return { left: pos[0]-r, top: pos[1]-r, right: pos[0]+r, bottom: pos[1]+r };
    }
    if (mn === "ADBE Vector Shape - Group") { // Path
        var shapeVal = item.property("ADBE Vector Shape").value;
        var verts = shapeVal.vertices, inT = shapeVal.inTangents, outT = shapeVal.outTangents;
        if (!verts || verts.length === 0) return null;
        var lf=Infinity, tp=Infinity, rt=-Infinity, bt=-Infinity;
        for (var v = 0; v < verts.length; v++) {
            // Include vertex+tangent as candidate points since tangent handles can pull the curve outside the vertex hull.
            var cands = [verts[v], [verts[v][0]+inT[v][0], verts[v][1]+inT[v][1]], [verts[v][0]+outT[v][0], verts[v][1]+outT[v][1]]];
            for (var c = 0; c < cands.length; c++) {
                var px = cands[c][0], py = cands[c][1];
                if (px<lf) lf=px; if (py<tp) tp=py; if (px>rt) rt=px; if (py>bt) bt=py;
            }
        }
        return { left: lf, top: tp, right: rt, bottom: bt };
    }
    if (mn === "ADBE Vector Group") {
        var childBox = lineup_shapeGroupContentsBBox(item.property("ADBE Vectors Group"));
        if (!childBox) return null;
        return lineup_transformBBoxThroughGroup(item.property("ADBE Vector Transform Group"), childBox);
    }
    return null;
}

function lineup_shapeGroupContentsBBox(contents) {
    var lf=Infinity, tp=Infinity, rt=-Infinity, bt=-Infinity, found=false;
    for (var i = 1; i <= contents.numProperties; i++) {
        var r;
        try { r = lineup_shapeItemBBoxInParentSpace(contents.property(i)); } catch (e) { r = null; }
        if (!r) continue;
        found = true;
        if (r.left<lf) lf=r.left; if (r.top<tp) tp=r.top;
        if (r.right>rt) rt=r.right; if (r.bottom>bt) bt=r.bottom;
    }
    return found ? { left:lf, top:tp, right:rt, bottom:bt } : null;
}

// Own-parent-space bbox, walked outward through every ancestor Group's own
// transform, landing in the same layer-content space sourceRectAtTime/masks
// use — from there LST.toComp (below) does the rest, same as layer align.
function lineup_shapeItemBBoxInLayerSpace(item) {
    var box = lineup_shapeItemBBoxInParentSpace(item);
    if (!box) return null;
    var ancestors = lineup_ancestorVectorGroups(item);
    for (var i = 0; i < ancestors.length; i++) {
        box = lineup_transformBBoxThroughGroup(ancestors[i].property("ADBE Vector Transform Group"), box);
    }
    return box;
}

function lineup_shapeItemCompBounds(layer, item) {
    var r = lineup_shapeItemBBoxInLayerSpace(item);
    if (!r) return null;
    var p1 = LST.toComp(layer, [r.left,  r.top,    0]);
    var p2 = LST.toComp(layer, [r.right, r.top,    0]);
    var p3 = LST.toComp(layer, [r.right, r.bottom, 0]);
    var p4 = LST.toComp(layer, [r.left,  r.bottom, 0]);
    var xs = [p1[0], p2[0], p3[0], p4[0]], ys = [p1[1], p2[1], p3[1], p4[1]];
    return {
        left: Math.min.apply(null, xs), right: Math.max.apply(null, xs),
        top: Math.min.apply(null, ys), bottom: Math.max.apply(null, ys),
        width: Math.max.apply(null, xs) - Math.min.apply(null, xs),
        height: Math.max.apply(null, ys) - Math.min.apply(null, ys)
    };
}

// Comp delta -> delta for this shape item's own position, walking lineup_shapeItemCompBounds' chain in reverse (outermost group first).
function lineup_compDeltaToShapeItemDelta(layer, item, dCompX, dCompY) {
    var d = compDeltaToPositionDelta(layer, dCompX, dCompY);
    d = oneLevelDelta(layer, d[0], d[1]);
    var ancestors = lineup_ancestorVectorGroups(item);
    for (var i = ancestors.length - 1; i >= 0; i--) {
        d = lineup_vecGroupInverseDelta(ancestors[i].property("ADBE Vector Transform Group"), d[0], d[1]);
    }
    return d;
}

function lineup_applyShapeVec2Delta(prop, dx, dy, offsetKeys, t) {
    if (offsetKeys && prop.numKeys > 0) {
        for (var k = 1; k <= prop.numKeys; k++) {
            var v = prop.keyValue(k);
            prop.setValueAtKey(k, [v[0]+dx, v[1]+dy]);
        }
        return;
    }
    var v = prop.value, nv = [v[0]+dx, v[1]+dy];
    if (prop.numKeys > 0) prop.setValueAtTime(t, nv); else prop.setValue(nv);
}

function lineup_applyShapePathDelta(pathProp, dx, dy, offsetKeys, t) {
    function shifted(shapeVal) {
        var s = new Shape();
        var verts = [];
        for (var i = 0; i < shapeVal.vertices.length; i++) verts.push([shapeVal.vertices[i][0]+dx, shapeVal.vertices[i][1]+dy]);
        s.vertices = verts;
        s.inTangents = shapeVal.inTangents;   // relative offsets, untouched by a rigid shift
        s.outTangents = shapeVal.outTangents;
        s.closed = shapeVal.closed;
        return s;
    }
    if (offsetKeys && pathProp.numKeys > 0) {
        for (var k = 1; k <= pathProp.numKeys; k++) pathProp.setValueAtKey(k, shifted(pathProp.keyValue(k)));
        return;
    }
    var nv = shifted(pathProp.value);
    if (pathProp.numKeys > 0) pathProp.setValueAtTime(t, nv); else pathProp.setValue(nv);
}

function lineup_shiftShapeItem(item, dx, dy, offsetKeys, t) {
    var mn = item.matchName;
    if (mn === "ADBE Vector Group") {
        lineup_applyShapeVec2Delta(item.property("ADBE Vector Transform Group").property("ADBE Vector Position"), dx, dy, offsetKeys, t);
    } else if (mn === "ADBE Vector Shape - Rect") {
        lineup_applyShapeVec2Delta(item.property("ADBE Vector Rect Position"), dx, dy, offsetKeys, t);
    } else if (mn === "ADBE Vector Shape - Ellipse") {
        lineup_applyShapeVec2Delta(item.property("ADBE Vector Ellipse Position"), dx, dy, offsetKeys, t);
    } else if (mn === "ADBE Vector Shape - Star") {
        lineup_applyShapeVec2Delta(item.property("ADBE Vector Star Position"), dx, dy, offsetKeys, t);
    } else if (mn === "ADBE Vector Shape - Group") {
        lineup_applyShapePathDelta(item.property("ADBE Vector Shape"), dx, dy, offsetKeys, t);
    }
}

// alignIdx: 0=left 1=centerX 2=right 3=top 4=centerY 5=bottom — mirrors
// lineup_align's own switch below exactly, just against shape bounds instead
// of layer bounds.
function lineup_alignShapes(alignIdx, alignToSelection, margin, usePercent, offsetKeys, comp, shapeItems) {
    try {
        var modes = ["left","centerX","right","top","centerY","bottom"];
        var labels = ["Align Left","Center Horizontal","Align Right","Align Top","Center Vertical","Align Bottom"];
        var mode = modes[alignIdx];

        var selRect = null;
        if (alignToSelection) {
            var lf=Infinity, tp=Infinity, rt=-Infinity, bt=-Infinity;
            for (var i = 0; i < shapeItems.length; i++) {
                var r = lineup_shapeItemCompBounds(shapeItems[i].layer, shapeItems[i].item);
                if (!r) continue;
                if (r.left<lf) lf=r.left; if (r.top<tp) tp=r.top;
                if (r.right>rt) rt=r.right; if (r.bottom>bt) bt=r.bottom;
            }
            selRect = { left:lf, top:tp, right:rt, bottom:bt, width:rt-lf, height:bt-tp };
        }

        app.beginUndoGroup("Align Shapes: " + labels[alignIdx]);
        var t = comp.time;
        for (var i = 0; i < shapeItems.length; i++) {
            var layer = shapeItems[i].layer, item = shapeItems[i].item;
            var rect = lineup_shapeItemCompBounds(layer, item);
            if (!rect) continue;
            var exr = selRect;
            if (exr) {
                rect = { left:rect.left-exr.left, right:rect.right-exr.left,
                         top:rect.top-exr.top, bottom:rect.bottom-exr.top,
                         width:rect.width, height:rect.height };
            }
            var mH = margin, mW = margin;
            if (usePercent) { mH = (margin/100)*comp.height; mW = (margin/100)*comp.width; }
            var cw = exr ? exr.width  : comp.width;
            var ch = exr ? exr.height : comp.height;

            var dCompX = 0, dCompY = 0;
            switch (mode) {
                case "left":    dCompX = mW - rect.left;                       break;
                case "right":   dCompX = (cw-mW) - rect.right;                 break;
                case "top":     dCompY = mH - rect.top;                        break;
                case "bottom":  dCompY = (ch-mH) - rect.bottom;               break;
                case "centerX": dCompX = (cw/2) - (rect.left + rect.width/2);  break;
                case "centerY": dCompY = (ch/2) - (rect.top  + rect.height/2); break;
            }
            var d = lineup_compDeltaToShapeItemDelta(layer, item, dCompX, dCompY);
            lineup_shiftShapeItem(item, d[0], d[1], offsetKeys, t);
        }
        app.endUndoGroup();
        return "ok";
    } catch (err) {
        try { app.endUndoGroup(); } catch (e) {}
        return "ERROR: " + err.toString();
    }
}

// ── SMART SELECT ──────────────────────────────────────────────────────────────
// Selects a property, finds + selects that SAME property everywhere it exists (selected layers, or whole comp), then reveals it in the Timeline.

// Walks a selected property UP via parentProperty to its owning Layer, collecting each level's matchName into an ordered chain
// (e.g. ["ADBE Effect Parade", "ADBE Gaussian Blur", "ADBE Gaussian Blur Blurriness"]). Returns a fail reason if unreadable.
function lineup_buildPropertyChain(prop) {
    var chain = [];
    var p = prop;
    var steps = 0;
    while (p) {
        steps++;
        if (steps > 30) return { fail: "loop-guard chain=" + chain.join(">") };
        var parent;
        try { parent = p.parentProperty; } catch (e) { parent = null; }
        if (!parent) {
            // No parentProperty means p is the layer itself — instanceof Layer isn't reliable here (fails for Shape layers).
            if (chain.length === 0) return { fail: "empty-chain" };
            return { layer: p, chain: chain };
        }
        var mn;
        try { mn = p.matchName; } catch (e) { return { fail: "matchName-throw: " + e.toString() + " chain=" + chain.join(">") }; }
        chain.unshift(mn);
        p = parent;
    }
    return { fail: "no-layer-found chain=" + chain.join(">") };
}

// Resolves a matchName chain against a DIFFERENT layer. The first link is a singular container (direct lookup); every
// link after that BRANCHES, following every child matching the expected name — so "every instance of that effect" works.
function lineup_findChainMatches(otherLayer, chain) {
    var results = [];
    if (!chain || !chain.length) return results;
    var root;
    try { root = otherLayer.property(chain[0]); } catch (e) { return results; }
    if (!root) return results;
    if (chain.length === 1) { results.push(root); return results; }

    function walk(group, idx) {
        var targetName = chain[idx];
        var isLast = (idx === chain.length - 1);
        var count;
        try { count = group.numProperties; } catch (e) { return; }
        for (var i = 1; i <= count; i++) {
            var p;
            try { p = group.property(i); } catch (e) { continue; }
            var mn;
            try { mn = p.matchName; } catch (e) { continue; }
            if (mn !== targetName) continue;
            if (isLast) results.push(p);
            else { try { walk(p, idx + 1); } catch (e) {} }
        }
    }
    walk(root, 1);
    return results;
}

function lineup_smartSelect() {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return "ERROR: No active composition";

        var rawSelectedLayers = comp.selectedLayers;

        // Gathered from whatever layers are selected (or every layer, if none are).
        var gatherLayers = rawSelectedLayers;
        if (!gatherLayers || !gatherLayers.length) {
            gatherLayers = [];
            for (var li = 1; li <= comp.numLayers; li++) gatherLayers.push(comp.layer(li));
        }

        // comp.selectedProperties only reflects the focused layer, so read each selected layer's own .selectedProperties instead.
        var selProps = [];
        for (var sl = 0; sl < gatherLayers.length; sl++) {
            var layerProps;
            try { layerProps = gatherLayers[sl].selectedProperties; } catch (e) { layerProps = null; }
            if (layerProps) for (var j = 0; j < layerProps.length; j++) selProps.push(layerProps[j]);
        }
        if (!selProps.length) {
            try { selProps = comp.selectedProperties || []; } catch (e) {}
        }
        if (!selProps.length) return "ERROR: Select a property first";
        var chains = [];
        var originIndices = {};
        for (var i = 0; i < selProps.length; i++) {
            var info = lineup_buildPropertyChain(selProps[i]);
            if (info.layer) {
                chains.push(info.chain);
                try { originIndices[info.layer.index] = true; } catch (e) {}
            }
        }
        if (!chains.length) return "ERROR: Select a property first";

        // Only treat the layer selection as an explicit scope when it includes a layer the properties didn't already come from.
        var extraLayerSelected = false;
        if (rawSelectedLayers && rawSelectedLayers.length) {
            for (var rl = 0; rl < rawSelectedLayers.length; rl++) {
                if (!originIndices[rawSelectedLayers[rl].index]) { extraLayerSelected = true; break; }
            }
        }

        var scopeLayers;
        if (extraLayerSelected) {
            scopeLayers = rawSelectedLayers;
        } else {
            scopeLayers = [];
            for (var li2 = 1; li2 <= comp.numLayers; li2++) scopeLayers.push(comp.layer(li2));
        }

        app.beginUndoGroup("Smart Select");
        lineup_deselectAllProps(scopeLayers);

        var matchCount = 0;
        for (var l = 0; l < scopeLayers.length; l++) {
            var layer = scopeLayers[l];
            for (var c = 0; c < chains.length; c++) {
                var matches = lineup_findChainMatches(layer, chains[c]);
                for (var m = 0; m < matches.length; m++) {
                    try { matches[m].selected = true; matchCount++; } catch (e) {}
                }
            }
        }
        if (matchCount > 0) lineup_revealInTimeline();
        app.endUndoGroup();
        return matchCount > 0 ? "ok" : "ERROR: No matching properties found";
    } catch (err) {
        try { app.endUndoGroup(); } catch (e) {}
        return "ERROR: " + err.toString();
    }
}

// ── SMART MERGE ────────────────────────────────────────────────────────────────
// Merges two or more selected effects of the same type into one, redirecting every referencing expression to the survivor first.

// Strips the "ADBE " prefix, for a readable error message only.
function lineup_effectFriendlyName(matchName) {
    return matchName.replace(/^ADBE\s+/, "");
}

// Regex-escapes a string for safe interpolation into a `new RegExp(...)`
// pattern (standard escaping of every regex metacharacter).
function lineup_reEscape(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Walks every property in the comp recursing structurally via propertyType (not a hardcoded group-name list), reaching
// Effects/Masks/Layer Styles/Text/shape Contents for free. Calls cb(layer, prop) for every leaf with an expression enabled.
function lineup_walkExpressionProps(comp, cb) {
    function walk(layer, prop) {
        var isLeaf;
        try { isLeaf = (prop.propertyType === PropertyType.PROPERTY); } catch (e) { return; }
        if (isLeaf) {
            var enabled;
            try { enabled = prop.expressionEnabled; } catch (e) { enabled = false; }
            if (enabled) { try { cb(layer, prop); } catch (e) {} }
            return;
        }
        var count;
        try { count = prop.numProperties; } catch (e) { return; }
        for (var i = 1; i <= count; i++) {
            var child;
            try { child = prop.property(i); } catch (e) { continue; }
            walk(layer, child);
        }
    }
    for (var li = 1; li <= comp.numLayers; li++) {
        var layer = comp.layer(li);
        var pcount;
        try { pcount = layer.numProperties; } catch (e) { continue; }
        for (var pi = 1; pi <= pcount; pi++) {
            var top;
            try { top = layer.property(pi); } catch (e) { continue; }
            walk(layer, top);
        }
    }
}

function lineup_smartMerge() {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return "ERROR: No active composition";

        var rawSelectedLayers = comp.selectedLayers;
        var gatherLayers = rawSelectedLayers;
        if (!gatherLayers || !gatherLayers.length) {
            gatherLayers = [];
            for (var li = 1; li <= comp.numLayers; li++) gatherLayers.push(comp.layer(li));
        }

        var selProps = [];
        for (var sl = 0; sl < gatherLayers.length; sl++) {
            var layerProps;
            try { layerProps = gatherLayers[sl].selectedProperties; } catch (e) { layerProps = null; }
            if (layerProps) for (var j = 0; j < layerProps.length; j++) selProps.push(layerProps[j]);
        }
        if (!selProps.length) {
            try { selProps = comp.selectedProperties || []; } catch (e) {}
        }
        if (!selProps.length) return "ERROR: Select two or more effects of the same type to merge (e.g. two Color Controls).";

        // Only direct effect headers qualify (chain exactly ["ADBE Effect Parade", "<matchName>"]); anything else is skipped.
        var candidates = [];
        for (var i = 0; i < selProps.length; i++) {
            var info = lineup_buildPropertyChain(selProps[i]);
            if (!info.layer || !info.chain || info.chain.length !== 2 || info.chain[0] !== "ADBE Effect Parade") continue;
            candidates.push({ layer: info.layer, effect: selProps[i], matchName: info.chain[1] });
        }
        if (candidates.length < 2) return "ERROR: Select two or more effects of the same type to merge (e.g. two Color Controls).";

        var refMatchName = candidates[0].matchName;
        for (var c = 1; c < candidates.length; c++) {
            if (candidates[c].matchName !== refMatchName) {
                return "ERROR: Selected effects aren't the same type (" + lineup_effectFriendlyName(refMatchName) + " vs " + lineup_effectFriendlyName(candidates[c].matchName) + ").";
            }
        }

        var survivor = candidates[0];
        var losers = candidates.slice(1);

        app.beginUndoGroup("Smart Merge");

        var survivorLayer = survivor.layer, survivorName = survivor.effect.name;
        var safeSurvivorName = survivorName.replace(/"/g, "\\\"");
        var safeSurvivorLayerName = survivorLayer.name.replace(/"/g, "\\\"");
        var qualifiedReplacement = "thisComp.layer(\"" + safeSurvivorLayerName + "\").effect(\"" + safeSurvivorName + "\")";
        var rewriteCount = 0;

        for (var lo = 0; lo < losers.length; lo++) {
            var loser = losers[lo];
            var loserLayer = loser.layer, loserName = loser.effect.name;
            var loserLayerIdx = loserLayer.index;
            var sameLayer = (loserLayerIdx === survivorLayer.index);

            var safeLoserName = lineup_reEscape(loserName);
            var safeLoserLayerName = lineup_reEscape(loserLayer.name);

            // Qualified reference, allowing thisLayer as an alternative — only valid when the referencing expression lives on that same layer.
            var qualifiedAnyRe = new RegExp(
                "(thisComp\\s*\\.\\s*layer\\s*\\(\\s*(?:\"" + safeLoserLayerName + "\"|'" + safeLoserLayerName + "'|" + loserLayerIdx + ")\\s*\\)|thisLayer)" +
                "\\s*\\.\\s*effect\\s*\\(\\s*(?:\"" + safeLoserName + "\"|'" + safeLoserName + "')\\s*\\)",
                "g"
            );
            // Same, without the thisLayer alternative — the only safe form to rewrite from an expression on a DIFFERENT layer.
            var qualifiedExplicitRe = new RegExp(
                "(thisComp\\s*\\.\\s*layer\\s*\\(\\s*(?:\"" + safeLoserLayerName + "\"|'" + safeLoserLayerName + "'|" + loserLayerIdx + ")\\s*\\))" +
                "\\s*\\.\\s*effect\\s*\\(\\s*(?:\"" + safeLoserName + "\"|'" + safeLoserName + "')\\s*\\)",
                "g"
            );
            // Bare effect("LoserName") with no layer qualifier — only valid when the expression lives on the loser's own layer.
            var bareRe = new RegExp(
                "(^|[^.\\w])effect\\s*\\(\\s*(?:\"" + safeLoserName + "\"|'" + safeLoserName + "')\\s*\\)",
                "g"
            );

            lineup_walkExpressionProps(comp, function(exprLayer, prop) {
                var expr;
                try { expr = prop.expression; } catch (e) { return; }
                if (!expr) return;

                var exprIsOnLoserLayer = (exprLayer.index === loserLayerIdx);
                var newExpr = expr.replace(exprIsOnLoserLayer ? qualifiedAnyRe : qualifiedExplicitRe, qualifiedReplacement);

                if (exprIsOnLoserLayer) {
                    var bareReplacement = sameLayer ? ("effect(\"" + safeSurvivorName + "\")") : qualifiedReplacement;
                    newExpr = newExpr.replace(bareRe, function(m, pre) { return pre + bareReplacement; });
                }

                if (newExpr !== expr) {
                    try { prop.expression = newExpr; rewriteCount++; } catch (e) {}
                }
            });
        }

        for (var r = 0; r < losers.length; r++) {
            try { losers[r].effect.remove(); } catch (e) {}
        }

        app.endUndoGroup();
        return "Merged " + candidates.length + " into \"" + survivorName + "\", updated " + rewriteCount + " expression" + (rewriteCount === 1 ? "" : "s");
    } catch (err) {
        try { app.endUndoGroup(); } catch (e) {}
        return "ERROR: " + err.toString();
    }
}

// ── SHAPE TOOLS ───────────────────────────────────────────────────────────────

// Command 2536, "RevealinTimeline" — stable numeric id that expands/scrolls the Timeline to the current selection.
// There's no scriptable "expanded" property; .selected=true alone doesn't twirl ancestor groups open.
function lineup_revealInTimeline() {
    try { app.executeCommand(2536); } catch (e) {}
}

// Clears each layer's current property selection before selecting something new, since .selected=true is purely additive.
// Snapshotted into a plain array first since selectedProperties may be a live view a mid-loop selected=false could shift.
function lineup_deselectAllProps(layers) {
    for (var i = 0; i < layers.length; i++) {
        var sel = layers[i].selectedProperties;
        if (!sel) continue;
        var copy = [];
        for (var j = 0; j < sel.length; j++) copy.push(sel[j]);
        for (var j = 0; j < copy.length; j++) {
            try { copy[j].selected = false; } catch (e) {}
        }
    }
}

// Selects the Path property of every free-form path shape in each selected shape layer; silently no-ops for non-shape layers or Rect/Ellipse/Star items.
function lineup_selectAllPaths() {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return "";
        var layers = comp.selectedLayers;
        if (!layers || layers.length === 0) return "";
        lineup_deselectAllProps(layers);
        var found = false;
        app.beginUndoGroup("Select All Paths");
        for (var i = 0; i < layers.length; i++) {
            var layer = layers[i];
            if (!(layer instanceof ShapeLayer)) continue;
            var root = layer.property("ADBE Root Vectors Group");
            if (!root) continue;
            if (lineup_selectPathsInVectorsGroup(root)) found = true;
        }
        if (found) lineup_revealInTimeline();
        app.endUndoGroup();
        return found ? "ok" : "";
    } catch (err) {
        try { app.endUndoGroup(); } catch (e) {}
        return "ERROR: " + err.toString();
    }
}

// Recursively walks a vector Contents list, selecting the Path property of every free-form path item. Returns true if anything was selected.
function lineup_selectPathsInVectorsGroup(contents) {
    var any = false;
    for (var i = 1; i <= contents.numProperties; i++) {
        var item = contents.property(i);
        var mn;
        try { mn = item.matchName; } catch (e) { continue; }
        if (mn === "ADBE Vector Group") {
            if (lineup_selectPathsInVectorsGroup(item.property("ADBE Vectors Group"))) any = true;
        } else if (mn === "ADBE Vector Shape - Group") {
            var pathProp = item.property("ADBE Vector Shape");
            if (pathProp) { pathProp.selected = true; any = true; }
        }
    }
    return any;
}

// Selects the Color property of every Fill or Stroke group across selected shape layers, depending on which matchNames are passed.
function lineup_selectAllColorProps(groupMatchName, colorMatchName, undoLabel) {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return "";
        var layers = comp.selectedLayers;
        if (!layers || layers.length === 0) return "";
        lineup_deselectAllProps(layers);
        var found = false;
        app.beginUndoGroup(undoLabel);
        for (var i = 0; i < layers.length; i++) {
            var layer = layers[i];
            if (!(layer instanceof ShapeLayer)) continue;
            var root = layer.property("ADBE Root Vectors Group");
            if (!root) continue;
            if (lineup_selectColorPropsInVectorsGroup(root, groupMatchName, colorMatchName)) found = true;
        }
        if (found) lineup_revealInTimeline();
        app.endUndoGroup();
        return found ? "ok" : "";
    } catch (err) {
        try { app.endUndoGroup(); } catch (e) {}
        return "ERROR: " + err.toString();
    }
}

function lineup_selectAllFillColors() {
    return lineup_selectAllColorProps("ADBE Vector Graphic - Fill", "ADBE Vector Fill Color", "Select All Fills");
}

function lineup_selectAllStrokeColors() {
    return lineup_selectAllColorProps("ADBE Vector Graphic - Stroke", "ADBE Vector Stroke Color", "Select All Strokes");
}

// Recursively walks a vector Contents list selecting `colorMatchName` off every `groupMatchName` item found. Returns true if anything was selected.
function lineup_selectColorPropsInVectorsGroup(contents, groupMatchName, colorMatchName) {
    var any = false;
    for (var i = 1; i <= contents.numProperties; i++) {
        var item = contents.property(i);
        var mn;
        try { mn = item.matchName; } catch (e) { continue; }
        if (mn === "ADBE Vector Group") {
            if (lineup_selectColorPropsInVectorsGroup(item.property("ADBE Vectors Group"), groupMatchName, colorMatchName)) any = true;
        } else if (mn === groupMatchName) {
            var colorProp = item.property(colorMatchName);
            if (colorProp) { colorProp.selected = true; any = true; }
        }
    }
    return any;
}

// Cycles every Stroke's Line Cap (Butt -> Round -> Projecting -> Butt) using the FIRST stroke found as the reference,
// normalizing all strokes to one consistent value. Line Join follows along (shared 1/2/3 index) unless capOnly is set.
function lineup_changeStrokeType(capOnly) {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return "";
        var layers = comp.selectedLayers;
        if (!layers || layers.length === 0) return "";
        var strokes = [];
        for (var i = 0; i < layers.length; i++) {
            if (!(layers[i] instanceof ShapeLayer)) continue;
            var root = layers[i].property("ADBE Root Vectors Group");
            if (root) lineup_collectStrokesInVectorsGroup(root, strokes);
        }
        if (!strokes.length) return "";

        var curCap = strokes[0].property("ADBE Vector Stroke Line Cap").value; // 1=Butt 2=Round 3=Projecting
        var nextCap = (curCap % 3) + 1;

        app.beginUndoGroup("Change Stroke Type");
        for (var i = 0; i < strokes.length; i++) {
            strokes[i].property("ADBE Vector Stroke Line Cap").setValue(nextCap);
            if (!capOnly) strokes[i].property("ADBE Vector Stroke Line Join").setValue(nextCap);
        }
        app.endUndoGroup();
        return "ok";
    } catch (err) {
        try { app.endUndoGroup(); } catch (e) {}
        return "ERROR: " + err.toString();
    }
}

// Recursively walks a vector Contents list, pushing every Stroke group
// ("ADBE Vector Graphic - Stroke") found into out, depth-first in the
// same child order AE lists them.
function lineup_collectStrokesInVectorsGroup(contents, out) {
    for (var i = 1; i <= contents.numProperties; i++) {
        var item = contents.property(i);
        var mn;
        try { mn = item.matchName; } catch (e) { continue; }
        if (mn === "ADBE Vector Group") {
            lineup_collectStrokesInVectorsGroup(item.property("ADBE Vectors Group"), out);
        } else if (mn === "ADBE Vector Graphic - Stroke") {
            out.push(item);
        }
    }
}

// ── SHAPE MERGE / EXPLODE ─────────────────────────────────────────────────────
// Clones shape content by VALUE (addProperty + copying leaf values) rather than AE Copy/Paste, which silently no-ops
// without Timeline focus. 2D layers only; keyframes are not reproduced, only current static values.

function lineup_selectOnlyLayer(comp, layer) {
    for (var i = 1; i <= comp.numLayers; i++) comp.layer(i).selected = false;
    layer.selected = true;
}

function lineup_selectOnlyLayers(comp, layersToSelect) {
    for (var i = 1; i <= comp.numLayers; i++) comp.layer(i).selected = false;
    for (var j = 0; j < layersToSelect.length; j++) layersToSelect[j].selected = true;
}

// A handful of stroke properties (taper start/end width, taper wave
// cycles, dashes, the materials group) have been observed to throw when
// set on a property that isn't independently addable/settable outside
// its normal authoring context — carried over from the reference
// implementation below, which hit this skipping them defensively rather
// than failing the whole clone over an edge-case stroke feature.
var LINEUP_SHAPE_CLONE_BLACKLIST = {
    "ADBE Vector Taper StartWidthPx": 1,
    "ADBE Vector Taper EndWidthPx": 1,
    "ADBE Vector Taper Wave Cycles": 1,
    "ADBE Vector Stroke Dashes": 1,
    "ADBE Vector Materials Group": 1
};

// Adds a property of `sourceItem`'s matchName into `targetGroup` and recursively copies its values. Returns null if not addable.
function lineup_cloneShapeItemInto(sourceItem, targetGroup) {
    var mn;
    try { mn = sourceItem.matchName; } catch (e) { return null; }
    if (!targetGroup.canAddProperty(mn)) return null;
    var clone;
    try { clone = targetGroup.addProperty(mn); } catch (e) { return null; }
    try { clone.name = sourceItem.name; } catch (e) {}
    lineup_copyPropertyTree(sourceItem, clone);
    return clone;
}

// NAMED_GROUP parents get matched-by-name children (found or added); INDEXED_GROUP parents (e.g. Contents lists) always
// addProperty a fresh sibling instead, since matching by name there would collapse multiple same-matchName siblings into one.
// typeof .setValue === 'function' tells a leaf (settable) property apart from a group still needing recursion.
function lineup_copyPropertyTree(source, target) {
    var indexed = (source.propertyType === PropertyType.INDEXED_GROUP);
    for (var i = 1; i <= source.numProperties; i++) {
        var srcChild = source.property(i);
        var mn;
        try { mn = srcChild.matchName; } catch (e) { continue; }

        try { if (!srcChild.enabled) continue; } catch (e) {}
        if (LINEUP_SHAPE_CLONE_BLACKLIST[mn]) continue;

        var tgtChild;
        if (indexed) {
            try { tgtChild = target.addProperty(mn); } catch (e) { continue; }
        } else {
            tgtChild = target.property(mn);
            if (!tgtChild) {
                try { tgtChild = target.addProperty(mn); } catch (e) { continue; }
            }
        }
        if (!tgtChild) continue;

        if (typeof srcChild.setValue === "function") {
            try { tgtChild.setValue(srcChild.value); } catch (e) {}
            continue;
        }
        if (srcChild.numProperties > 0) {
            lineup_copyPropertyTree(srcChild, tgtChild);
        }
    }
}

// Computes what `source`'s layer transform would need to be as a Vector Group inside `target`'s Contents, by round-tripping
// source's local origin and two unit axes through comp space and back into target's local space. Cross product of the
// mapped axes flips under mirrored/negative scale (which plain vector lengths would lose), so that sign folds into scaleY.
function lineup_layerRelativeTransform(source, target) {
    var originComp = toComp(source, [0, 0, 0]);
    var xComp = toComp(source, [100, 0, 0]);
    var yComp = toComp(source, [0, 100, 0]);

    var originLocal = fromComp(target, originComp);
    var xLocal = fromComp(target, xComp);
    var yLocal = fromComp(target, yComp);

    var vecX = [xLocal[0] - originLocal[0], xLocal[1] - originLocal[1]];
    var vecY = [yLocal[0] - originLocal[0], yLocal[1] - originLocal[1]];

    var rotation = Math.atan2(vecX[1], vecX[0]) * 180 / Math.PI;
    var scaleX = Math.sqrt(vecX[0] * vecX[0] + vecX[1] * vecX[1]);
    var scaleY = Math.sqrt(vecY[0] * vecY[0] + vecY[1] * vecY[1]);
    var cross = vecX[0] * vecY[1] - vecX[1] * vecY[0];
    if (cross < 0) scaleY = -scaleY;

    return { position: [originLocal[0], originLocal[1]], rotation: rotation, scale: [scaleX, scaleY] };
}

// Merges every selected shape layer into the FIRST selected (the survivor) — each other layer's Contents becomes a new
// Vector Group transformed to the same comp-space spot, then the source is deleted (or, with keepOriginals, disabled).
function lineup_mergeShapes(keepOriginals) {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return "";
        var layers = comp.selectedLayers;
        var shapeLayers = [];
        for (var i = 0; i < layers.length; i++) {
            if (layers[i] instanceof ShapeLayer) shapeLayers.push(layers[i]);
        }
        if (shapeLayers.length < 2) return "";

        var target = shapeLayers[0];
        app.beginUndoGroup("Merge Shapes");
        // Every source is fully merged in BEFORE any is removed — removing a layer invalidates other held Layer/PropertyGroup references.
        var toRemove = [];
        for (var i = 1; i < shapeLayers.length; i++) {
            var source = shapeLayers[i];
            var xform = lineup_layerRelativeTransform(source, target);

            // Re-fetched fresh each iteration — target.addProperty() on the previous iteration invalidates a cached PropertyGroup reference.
            var targetRoot = target.property("ADBE Root Vectors Group");

            // One new wrapper group per source layer, holding a clone of every top-level item, with one unified transform.
            var wrapGroup = targetRoot.addProperty("ADBE Vector Group");
            wrapGroup.name = source.name;
            var wrapContents = wrapGroup.property("ADBE Vectors Group");
            var srcRoot = source.property("ADBE Root Vectors Group");
            for (var p = 1; p <= srcRoot.numProperties; p++) {
                lineup_cloneShapeItemInto(srcRoot.property(p), wrapContents);
            }

            // Position/Rotation/Scale live under the group's own Transform Group, not as direct children of the group itself.
            var wrapTransform = wrapGroup.property("ADBE Vector Transform Group");
            wrapTransform.property("ADBE Vector Position").setValue(xform.position);
            wrapTransform.property("ADBE Vector Rotation").setValue(xform.rotation);
            wrapTransform.property("ADBE Vector Scale").setValue(xform.scale);

            toRemove.push(source);
        }
        for (var r = 0; r < toRemove.length; r++) {
            if (keepOriginals) toRemove[r].enabled = false;
            else toRemove[r].remove();
        }
        lineup_selectOnlyLayer(comp, target);
        app.endUndoGroup();
        return "ok";
    } catch (err) {
        try { app.endUndoGroup(); } catch (e) {}
        return "ERROR: " + err.toString();
    }
}

// Splits each selected shape layer with 2+ top-level Contents GROUPS into that many new layers, one per group (deep-cloned
// intact via lineup_cloneShapeItemInto). Only qualifies if EVERY top-level item is a Group — bare ungrouped siblings (e.g.
// a Merge Paths "Difference" combining root-level paths) are left alone since splitting them would break the merge.
function lineup_explodeShapes(keepOriginals) {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return "";
        var layers = comp.selectedLayers;
        var candidates = [];
        for (var i = 0; i < layers.length; i++) {
            if (!(layers[i] instanceof ShapeLayer)) continue;
            var root = layers[i].property("ADBE Root Vectors Group");
            if (!root || root.numProperties < 2) continue;

            var allGroups = true;
            for (var g = 1; g <= root.numProperties; g++) {
                var gmn;
                try { gmn = root.property(g).matchName; } catch (e) { gmn = null; }
                if (gmn !== "ADBE Vector Group") { allGroups = false; break; }
            }
            if (allGroups) candidates.push(layers[i]);
        }
        if (!candidates.length) return "";

        app.beginUndoGroup("Explode Shapes");
        // Every candidate is fully exploded before any original is removed — same reasoning as Merge Shapes above.
        var toRemove = [];
        var newLayers = [];
        for (var c = 0; c < candidates.length; c++) {
            var original = candidates[c];
            var root = original.property("ADBE Root Vectors Group");
            var items = [];
            for (var i = 1; i <= root.numProperties; i++) items.push(root.property(i));

            for (var i = 0; i < items.length; i++) {
                var item = items[i];
                var newLayer = comp.layers.addShape();
                newLayer.name = item.name || (original.name + " " + (i + 1));
                newLayer.threeDLayer = false;
                newLayer.anchorPoint.setValue(original.anchorPoint.value);
                newLayer.position.setValue(original.position.value);
                newLayer.scale.setValue(original.scale.value);
                newLayer.rotation.setValue(original.rotation.value);
                newLayer.opacity.setValue(original.opacity.value);
                newLayer.startTime = original.startTime;
                newLayer.inPoint = original.inPoint;
                newLayer.outPoint = original.outPoint;
                try { newLayer.parent = original.parent; } catch (e) {}

                lineup_cloneShapeItemInto(item, newLayer.property("ADBE Root Vectors Group"));
                newLayers.push(newLayer);
            }
            toRemove.push(original);
        }
        for (var r = 0; r < toRemove.length; r++) {
            if (keepOriginals) toRemove[r].enabled = false;
            else toRemove[r].remove();
        }
        lineup_selectOnlyLayers(comp, newLayers);
        app.endUndoGroup();
        return "ok";
    } catch (err) {
        try { app.endUndoGroup(); } catch (e) {}
        return "ERROR: " + err.toString();
    }
}

// ── SPLIT TEXT ────────────────────────────────────────────────────────────────
// Splits each selected text layer into one new layer per character/word/line/paragraph, positioned via a scratch duplicate's
// Range Selector (Subtract mode, index-based) driving Scale to [0,0,100] so sourceRectAtTime() measures just that unit's
// true kerned bounds. Alt-click (keepOriginals) parents splits to a new null carrying the original's transform.
function lineup_addIsolatorAnimator(layer, rangeType2) {
    var animators = layer.property("ADBE Text Properties").property("ADBE Text Animators");
    var animator = animators.addProperty("ADBE Text Animator");
    animator.name = "Lineup Isolator";
    animator.property("ADBE Text Animator Properties").addProperty("ADBE Text Scale 3D").setValue([0, 0, 100]);

    var rangeSelector = animator.property("ADBE Text Selectors").addProperty("ADBE Text Selector");
    var advanced = rangeSelector.property("ADBE Text Range Advanced");
    advanced.property("ADBE Text Range Units").setValue(2);        // Index
    advanced.property("ADBE Text Range Type2").setValue(rangeType2);
    advanced.property("ADBE Text Selector Mode").setValue(2);      // Subtract — inverts so the index window is spared
    advanced.property("ADBE Text Selector Max Amount").setValue(100);

    rangeSelector.property("ADBE Text Index Start").setValue(0);
    rangeSelector.property("ADBE Text Index End").setValue(1);
    return rangeSelector.property("ADBE Text Index Offset");
}

function lineup_combineParagraphUnit(lines, rects) {
    var minLeft = rects[0].left, minTop = rects[0].top;
    var maxRight = rects[0].left + rects[0].width, maxBottom = rects[0].top + rects[0].height;
    for (var i = 1; i < rects.length; i++) {
        var r = rects[i];
        if (r.left < minLeft) minLeft = r.left;
        if (r.top < minTop) minTop = r.top;
        if (r.left + r.width > maxRight) maxRight = r.left + r.width;
        if (r.top + r.height > maxBottom) maxBottom = r.top + r.height;
    }
    return { text: lines.join("\r"), centerX: (minLeft + maxRight) / 2, centerY: (minTop + maxBottom) / 2 };
}

function lineup_splitTextUnits(scratch, str, mode, t) {
    var units = [];

    if (mode === "character") {
        var charOffset = lineup_addIsolatorAnimator(scratch, 2); // Characters Excluding Spaces
        var charIndex = 0;
        for (var c = 0; c < str.length; c++) {
            var ch = str.charAt(c);
            if (/\s/.test(ch)) continue;
            charOffset.setValue(charIndex);
            var cb = scratch.sourceRectAtTime(t, false);
            units.push({ text: ch, centerX: cb.left + cb.width / 2, centerY: cb.top + cb.height / 2 });
            charIndex++;
        }
    } else if (mode === "word") {
        var wordOffset = lineup_addIsolatorAnimator(scratch, 3); // Words
        var wordRe = /\S+/g, wm, wi = 0;
        while ((wm = wordRe.exec(str)) !== null) {
            wordOffset.setValue(wi);
            var wb = scratch.sourceRectAtTime(t, false);
            units.push({ text: wm[0], centerX: wb.left + wb.width / 2, centerY: wb.top + wb.height / 2 });
            wi++;
        }
    } else { // "line" or "paragraph" — paragraph groups line measurements between blank-line breaks
        var lineOffset = lineup_addIsolatorAnimator(scratch, 4); // Lines
        var allLines = str.split(/\r\n|\r|\n/);
        var lineRects = [];
        for (var li = 0; li < allLines.length; li++) {
            if (allLines[li].length > 0) {
                lineOffset.setValue(li);
                var lb = scratch.sourceRectAtTime(t, false);
                lineRects[li] = { left: lb.left, top: lb.top, width: lb.width, height: lb.height };
            } else {
                lineRects[li] = null;
            }
        }

        if (mode === "line") {
            for (var li2 = 0; li2 < allLines.length; li2++) {
                if (!lineRects[li2]) continue;
                var r = lineRects[li2];
                units.push({ text: allLines[li2], centerX: r.left + r.width / 2, centerY: r.top + r.height / 2 });
            }
        } else { // "paragraph"
            var paraLines = [], paraRects = [];
            for (var li3 = 0; li3 < allLines.length; li3++) {
                if (lineRects[li3]) {
                    paraLines.push(allLines[li3]);
                    paraRects.push(lineRects[li3]);
                } else if (paraLines.length) {
                    units.push(lineup_combineParagraphUnit(paraLines, paraRects));
                    paraLines = []; paraRects = [];
                }
            }
            if (paraLines.length) units.push(lineup_combineParagraphUnit(paraLines, paraRects));
        }
    }

    return units;
}

function lineup_createSplitControllerNull(comp, original) {
    var ctrl = comp.layers.addNull();
    ctrl.name = original.name + " Split Controller";
    ctrl.parent = original.parent;
    ctrl.anchorPoint.setValue(original.anchorPoint.value);
    ctrl.position.setValue(original.position.value);
    ctrl.scale.setValue(original.scale.value);
    ctrl.rotation.setValue(original.rotation.value);
    ctrl.opacity.setValue(original.opacity.value);
    ctrl.startTime = original.startTime;
    ctrl.inPoint = original.inPoint;
    ctrl.outPoint = original.outPoint;
    ctrl.moveBefore(original);
    return ctrl;
}

function lineup_splitText(mode, keepOriginals) {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return "";
        var t = comp.time;
        var layers = comp.selectedLayers;
        var candidates = [];
        for (var i = 0; i < layers.length; i++) {
            if (layers[i] instanceof TextLayer) candidates.push(layers[i]);
        }
        if (!candidates.length) return "";

        app.beginUndoGroup("Split Text");
        var toRemove = [];
        var newLayers = [];
        for (var c = 0; c < candidates.length; c++) {
            var original = candidates[c];
            var str = original.sourceText.value.text;
            if (!str.length) continue;

            var scratch = original.duplicate();
            scratch.name = "Split Text scratch";

            var units;
            try {
                units = lineup_splitTextUnits(scratch, str, mode, t);
            } finally {
                scratch.remove();
            }
            if (!units.length) continue;

            var ctrl = keepOriginals ? lineup_createSplitControllerNull(comp, original) : null;
            var created = [];

            for (var u = 0; u < units.length; u++) {
                var unit = units[u];
                var newLayer = original.duplicate();
                newLayer.name = unit.text.replace(/^\s+|\s+$/g, "") || unit.text;

                var newDoc = newLayer.sourceText.value;
                newDoc.text = unit.text;
                newLayer.sourceText.setValue(newDoc);

                if (ctrl) {
                    var oldAnchor = newLayer.anchorPoint.value;
                    var zeroAnchor = oldAnchor.length > 2 ? [0, 0, oldAnchor[2]] : [0, 0];
                    if (newLayer.anchorPoint.numKeys > 0) newLayer.anchorPoint.setValueAtTime(t, zeroAnchor);
                    else newLayer.anchorPoint.setValue(zeroAnchor);
                    newLayer.parent = ctrl;

                    var ownRect = newLayer.sourceRectAtTime(t, false);
                    var ownCenterX = ownRect.left + ownRect.width / 2;
                    var ownCenterY = ownRect.top + ownRect.height / 2;

                    var curPos = newLayer.position.dimensionsSeparated ? null : newLayer.position.value;
                    var newPos = [unit.centerX - ownCenterX, unit.centerY - ownCenterY];
                    if (curPos && curPos.length > 2) newPos.push(curPos[2]);
                    setPositionAt(newLayer.position, newPos, t, newLayer.threeDLayer);
                } else {
                    var targetComp = toComp(original, [unit.centerX, unit.centerY]);
                    var ownRect2 = newLayer.sourceRectAtTime(t, false);
                    var ownCenterLocal = [ownRect2.left + ownRect2.width / 2, ownRect2.top + ownRect2.height / 2];
                    var currentComp = toComp(newLayer, ownCenterLocal);
                    var dComp = [targetComp[0] - currentComp[0], targetComp[1] - currentComp[1]];
                    var dPos = compDeltaToPositionDelta(newLayer, dComp[0], dComp[1]);
                    shiftPosition(newLayer.position, dPos[0], dPos[1], newLayer.threeDLayer);
                }

                created.push(newLayer);
            }

            for (var r = created.length - 1; r >= 0; r--) created[r].moveBefore(original);
            newLayers = newLayers.concat(created);
            toRemove.push(original);
        }
        for (var rr = 0; rr < toRemove.length; rr++) {
            if (keepOriginals) toRemove[rr].enabled = false;
            else toRemove[rr].remove();
        }
        lineup_selectOnlyLayers(comp, newLayers);
        app.endUndoGroup();
        return "ok";
    } catch (err) {
        try { app.endUndoGroup(); } catch (e) {}
        return "ERROR: " + err.toString();
    }
}

// ── COLOR MANAGEMENT ─────────────────────────────────────────────────────────
// Scans the selected layers (every layer in the comp if nothing's
// selected) for every solid (non-gradient) color it can find — shape
// layer Fill/Stroke colors, a text layer's own character Fill/Stroke
// (Character panel), any effect parameter of type COLOR (Color
// Control, Fill, Tint, Change to Color, Drop Shadow, CC Light Sweep,
// Glow's "A & B Colors" mode, third-party plugins, anything — this is
// what makes the effect scan generic instead of a hardcoded list),
// and the same for any layer style (Stroke, Color Overlay, Drop Shadow,
// etc., again skipping Gradient Overlay). Gradients are always skipped —
// shape Gradient Fill/Stroke groups are simply never matched, and
// gradient-producing effects/styles are name-matched out (see
// lineup_isGradientColorSource). Every occurrence of the same color
// (compared with a small tolerance) is grouped together, then a single
// "Color Controller" null is created at the top of the layer stack with
// one Color Control effect per unique color found — named by an
// approximate description of the color itself (see lineup_baseColorName)
// — and every one of that color's original occurrences gets an
// expression linking it back to that effect's Color value, so the whole
// comp's palette can be retimed/recolored from one place afterward.

// Shape Gradient Fill/Stroke are simply never matched by name here (their
// matchNames differ from the plain Fill/Stroke ones below), and these two
// effect matchNames/name substrings cover the built-in gradient-producing
// effects and layer styles (Ramp, 4-Color Gradient, Gradient Overlay) —
// checked by matchName first (locale-independent) and by name as a
// fallback for anything else with "gradient" in its name (covers
// third-party gradient plugins too).
var LINEUP_GRADIENT_EFFECT_MATCHNAMES = { "ADBE Ramp": 1, "ADBE 4ColorGradient": 1 };

function lineup_isGradientColorSource(matchName, name) {
    if (LINEUP_GRADIENT_EFFECT_MATCHNAMES[matchName]) return true;
    var n = (name || "").toLowerCase();
    return n.indexOf("gradient") !== -1;
}

// Recursively walks a vector Contents list collecting every Fill/Stroke color into `slots` as { prop, value }; skips disabled groups.
function lineup_collectShapeColorSlots(contents, slots) {
    for (var i = 1; i <= contents.numProperties; i++) {
        var item = contents.property(i);
        var mn;
        try { mn = item.matchName; } catch (e) { continue; }
        if (mn === "ADBE Vector Group") {
            lineup_collectShapeColorSlots(item.property("ADBE Vectors Group"), slots);
        } else if (mn === "ADBE Vector Graphic - Fill" || mn === "ADBE Vector Graphic - Stroke") {
            try { if (!item.enabled) continue; } catch (e) {}
            var colorMatchName = (mn === "ADBE Vector Graphic - Fill") ? "ADBE Vector Fill Color" : "ADBE Vector Stroke Color";
            var colorProp = item.property(colorMatchName);
            if (colorProp) slots.push({ prop: colorProp, value: colorProp.value });
        }
        // Gradient Fill/Stroke and every other item type have no solid color of interest — skipped by not matching any branch above.
    }
}

// One level into every effect (all flat parameter lists, no deeper recursion needed) — any COLOR-typed parameter qualifies, regardless of effect.
function lineup_collectEffectColorSlots(effectsGroup, slots) {
    if (!effectsGroup) return;
    for (var i = 1; i <= effectsGroup.numProperties; i++) {
        var fx = effectsGroup.property(i);
        var mn, nm;
        try { mn = fx.matchName; } catch (e) { continue; }
        try { nm = fx.name; } catch (e) { nm = ""; }
        if (lineup_isGradientColorSource(mn, nm)) continue;
        try { if (!fx.enabled) continue; } catch (e) {}
        for (var p = 1; p <= fx.numProperties; p++) {
            var prop;
            try { prop = fx.property(p); } catch (e) { continue; }
            try {
                if (prop.propertyValueType === PropertyValueType.COLOR) {
                    slots.push({ prop: prop, value: prop.value });
                }
            } catch (e) {}
        }
    }
}

// Same idea as lineup_collectEffectColorSlots, one level into "ADBE Layer Styles" instead. Gradient Overlay is skipped by name match.
function lineup_collectLayerStyleColorSlots(layer, slots) {
    var styles;
    try { styles = layer.property("ADBE Layer Styles"); } catch (e) { return; }
    if (!styles) return;
    for (var i = 1; i <= styles.numProperties; i++) {
        var style;
        try { style = styles.property(i); } catch (e) { continue; }
        var mn, nm;
        try { mn = style.matchName; } catch (e) { continue; }
        try { nm = style.name; } catch (e) { nm = ""; }
        if (lineup_isGradientColorSource(mn, nm)) continue;
        try { if (!style.enabled) continue; } catch (e) {}
        var count;
        try { count = style.numProperties; } catch (e) { continue; }
        for (var p = 1; p <= count; p++) {
            var prop;
            try { prop = style.property(p); } catch (e) { continue; }
            try {
                if (prop.propertyValueType === PropertyValueType.COLOR) {
                    slots.push({ prop: prop, value: prop.value });
                }
            } catch (e) {}
        }
    }
}

// Every color-bearing property this tool manages on one layer: shape Fill/Stroke, plus effects and layer styles (any layer type).
function lineup_collectLayerColorSlots(layer, slots) {
    if (layer instanceof ShapeLayer) {
        var root;
        try { root = layer.property("ADBE Root Vectors Group"); } catch (e) { root = null; }
        if (root) lineup_collectShapeColorSlots(root, slots);
    }
    var fx;
    try { fx = layer.property("ADBE Effect Parade"); } catch (e) { fx = null; }
    if (fx) lineup_collectEffectColorSlots(fx, slots);
    lineup_collectLayerStyleColorSlots(layer, slots);
}

// A text layer's own character Fill/Stroke color, read off the whole TextDocument (AE has no per-character-range color access).
// Pushed as its own kind rather than a {prop,value} slot since fillColor/strokeColor need a re-expressed sourceText, not a direct .expression.
function lineup_collectTextColorSlots(layer, textSlots) {
    if (!(layer instanceof TextLayer)) return;
    var doc;
    try { doc = layer.sourceText.value; } catch (e) { return; }
    if (!doc) return;
    try { if (doc.applyFill) textSlots.push({ kind: "fill", layer: layer, value: doc.fillColor.concat([1]) }); } catch (e) {}
    try { if (doc.applyStroke) textSlots.push({ kind: "stroke", layer: layer, value: doc.strokeColor.concat([1]) }); } catch (e) {}
}

// Within ~1/255 per channel — enough to treat 8-bit-identical colors
// (however they got that way) as one, without falsely merging colors a
// human would actually tell apart.
function lineup_colorsApproxEqual(a, b) {
    var eps = 0.004;
    for (var i = 0; i < 4; i++) {
        var av = (i < a.length) ? a[i] : 1;
        var bv = (i < b.length) ? b[i] : 1;
        if (Math.abs(av - bv) > eps) return false;
    }
    return true;
}

// Standard RGB->HSL (0-1 in, h in degrees/0-1 s/l out) — used only to name
// each color, not to store or round-trip it.
function lineup_rgbToHsl(r, g, b) {
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var l = (max + min) / 2, d = max - min, h = 0, s = 0;
    if (d !== 0) {
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === r) h = ((g - b) / d) + (g < b ? 6 : 0);
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h *= 60;
    }
    return [h, s, l];
}

// The classic 12-step color-wheel names, matching how a person would describe these hues.
var LINEUP_HUE_NAMES = [
    "Red", "Red Orange", "Orange", "Yellow Orange", "Yellow", "Yellow Green",
    "Green", "Blue Green", "Blue", "Blue Violet", "Violet", "Red Violet"
];

// Gray detection uses raw chroma, not HSL saturation (which spikes near white/black); this remaps RGB hue to the artist's RYB-based 12-step wheel so e.g. RGB green (120°) reads as "Green" not "Yellow".
var LINEUP_RGB_TO_RYB_HUE_ANCHORS = [
    [0, 0], [60, 120], [120, 180], [180, 210], [240, 240], [300, 300], [360, 360]
];
function lineup_rgbHueToRybHue(h) {
    for (var i = 0; i < LINEUP_RGB_TO_RYB_HUE_ANCHORS.length - 1; i++) {
        var a = LINEUP_RGB_TO_RYB_HUE_ANCHORS[i], b = LINEUP_RGB_TO_RYB_HUE_ANCHORS[i + 1];
        if (h >= a[0] && h <= b[0]) {
            var f = (b[0] === a[0]) ? 0 : (h - a[0]) / (b[0] - a[0]);
            return a[1] + f * (b[1] - a[1]);
        }
    }
    return h;
}

function lineup_baseColorName(rgba) {
    var r = rgba[0], g = rgba[1], b = rgba[2];
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var d = max - min, l = (max + min) / 2;
    if (d < 0.06) {
        if (l > 0.90) return "White";
        if (l < 0.10) return "Black";
        if (l > 0.65) return "Light Gray";
        if (l < 0.35) return "Dark Gray";
        return "Gray";
    }
    var h;
    if (max === r) h = ((g - b) / d) + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    h = lineup_rgbHueToRybHue(h);
    var idx = Math.round(h / 30) % 12;
    if (idx < 0) idx += 12;
    return LINEUP_HUE_NAMES[idx];
}

// Groups -> [{ name, value, slots }], numbering duplicate hue names ("Red Orange 01"/"02", lightest first) but leaving a
// one-off grayscale name bare. existingNames lets numbering continue after a prior run instead of colliding with taken names.
function lineup_nameColorGroups(groups, existingNames) {
    existingNames = existingNames || [];
    var achromatic = { "White": 1, "Black": 1, "Gray": 1, "Light Gray": 1, "Dark Gray": 1 };
    var buckets = {};
    var baseNames = [];
    for (var i = 0; i < groups.length; i++) {
        var n = lineup_baseColorName(groups[i].value);
        baseNames.push(n);
        if (!buckets[n]) buckets[n] = [];
        buckets[n].push(i);
    }
    var finalNames = new Array(groups.length);
    for (var name in buckets) {
        if (!buckets.hasOwnProperty(name)) continue;
        var idxs = buckets[name];

        var existingMax = 0, bareNameTaken = false;
        for (var e = 0; e < existingNames.length; e++) {
            if (existingNames[e] === name) { bareNameTaken = true; continue; }
            if (existingNames[e].indexOf(name + " ") === 0) {
                var existingNum = parseInt(existingNames[e].substring(name.length + 1), 10);
                if (!isNaN(existingNum) && existingNum > existingMax) existingMax = existingNum;
            }
        }

        if (achromatic[name] && idxs.length === 1 && existingMax === 0 && !bareNameTaken) {
            finalNames[idxs[0]] = name;
            continue;
        }
        idxs.sort(function(a, b) {
            return lineup_rgbToHsl(groups[a].value[0], groups[a].value[1], groups[a].value[2])[2]
                 - lineup_rgbToHsl(groups[b].value[0], groups[b].value[1], groups[b].value[2])[2];
        });
        for (var k = 0; k < idxs.length; k++) {
            var num = existingMax + k + 1;
            var numStr = (num < 10) ? ("0" + num) : String(num);
            finalNames[idxs[k]] = name + " " + numStr;
        }
    }
    var out = [];
    for (var i = 0; i < groups.length; i++) {
        out.push({ name: finalNames[i], value: groups[i].value, slots: groups[i].slots });
    }
    return out;
}

function lineup_manageColors() {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return "";
        var selected = comp.selectedLayers;
        var targetLayers = [];
        if (selected && selected.length) {
            for (var i = 0; i < selected.length; i++) targetLayers.push(selected[i]);
        } else {
            for (var i = 1; i <= comp.numLayers; i++) targetLayers.push(comp.layer(i));
        }
        if (!targetLayers.length) return "";

        var slots = [];
        for (var i = 0; i < targetLayers.length; i++) {
            // Skip a prior run's own control null so re-running on "every layer" doesn't try to manage its colors.
            if (targetLayers[i].name === "Color Controller") continue;
            lineup_collectLayerColorSlots(targetLayers[i], slots);
            lineup_collectTextColorSlots(targetLayers[i], slots);
        }
        if (!slots.length) return "No colors found to manage.";

        var groups = [];
        for (var i = 0; i < slots.length; i++) {
            var v = slots[i].value;
            var found = null;
            for (var g = 0; g < groups.length; g++) {
                if (lineup_colorsApproxEqual(groups[g].value, v)) { found = groups[g]; break; }
            }
            if (found) found.slots.push(slots[i]);
            else groups.push({ value: v, slots: [slots[i]] });
        }
        app.beginUndoGroup("Color Management");

        // Reuse an existing "Color Controller" null rather than piling up redundant ones; existing effects are matched by value first.
        var nullLayer = null;
        for (var li = 1; li <= comp.numLayers; li++) {
            if (comp.layer(li).name === "Color Controller") { nullLayer = comp.layer(li); break; }
        }
        var effectsGroup, existingColors = [], existingNames = [];
        if (nullLayer) {
            effectsGroup = nullLayer.property("ADBE Effect Parade");
            for (var fi = 1; fi <= effectsGroup.numProperties; fi++) {
                var existingFx = effectsGroup.property(fi);
                var efxmn;
                try { efxmn = existingFx.matchName; } catch (e) { continue; }
                if (efxmn !== "ADBE Color Control") continue;
                existingColors.push({ effect: existingFx, value: existingFx.property(1).value });
                existingNames.push(existingFx.name);
            }
        } else {
            nullLayer = comp.layers.addNull();
            nullLayer.name = "Color Controller";
            nullLayer.moveToBeginning();
            effectsGroup = nullLayer.property("ADBE Effect Parade");
        }

        // Text fill/stroke slots can't take .expression directly; each records its resolved effect here for one combined sourceText expression built afterward.
        var textLinkInfo = [];

        var newGroups = [];
        var reusedCount = 0;
        for (var g = 0; g < groups.length; g++) {
            var grp = groups[g];
            var matched = null;
            for (var e = 0; e < existingColors.length; e++) {
                if (lineup_colorsApproxEqual(existingColors[e].value, grp.value)) { matched = existingColors[e]; break; }
            }
            if (!matched) { newGroups.push(grp); continue; }
            reusedCount++;
            var matchedExpr = 'thisComp.layer("Color Controller").effect("' + matched.effect.name.replace(/"/g, '\\"') + '")("Color")';
            for (var ms = 0; ms < grp.slots.length; ms++) {
                var mslot = grp.slots[ms];
                if (mslot.prop) { try { mslot.prop.expression = matchedExpr; } catch (e) {} }
                else textLinkInfo.push({ layer: mslot.layer, kind: mslot.kind, effectName: matched.effect.name });
            }
        }

        var namedNewGroups = lineup_nameColorGroups(newGroups, existingNames);
        for (var ng = 0; ng < namedNewGroups.length; ng++) {
            var newGrp = namedNewGroups[ng];
            var fx = effectsGroup.addProperty("ADBE Color Control");
            fx.name = newGrp.name;
            fx.property(1).setValue(newGrp.value);
            var newExpr = 'thisComp.layer("Color Controller").effect("' + newGrp.name.replace(/"/g, '\\"') + '")("Color")';
            for (var ns = 0; ns < newGrp.slots.length; ns++) {
                var nslot = newGrp.slots[ns];
                if (nslot.prop) { try { nslot.prop.expression = newExpr; } catch (e) {} }
                else textLinkInfo.push({ layer: nslot.layer, kind: nslot.kind, effectName: newGrp.name });
            }
        }

        // One combined sourceText expression per text layer, built on the Text Style API (setFillColor/setStrokeColor/setText) since expressions can't edit TextDocument fields directly.
        var textLayersDone = [];
        for (var ti = 0; ti < textLinkInfo.length; ti++) {
            var info = textLinkInfo[ti];
            var entry = null;
            for (var td = 0; td < textLayersDone.length; td++) {
                if (textLayersDone[td].layer === info.layer) { entry = textLayersDone[td]; break; }
            }
            if (!entry) { entry = { layer: info.layer, fillFx: null, strokeFx: null }; textLayersDone.push(entry); }
            if (info.kind === "fill") entry.fillFx = info.effectName;
            else entry.strokeFx = info.effectName;
        }
        for (var tl = 0; tl < textLayersDone.length; tl++) {
            var te = textLayersDone[tl];
            var lines = [];
            var chain = "text.sourceText.style";
            if (te.fillFx) {
                lines.push('var c = thisComp.layer("Color Controller").effect("' + te.fillFx.replace(/"/g, '\\"') + '")("Color");');
                chain += ".setFillColor([c[0], c[1], c[2]])";
            }
            if (te.strokeFx) {
                lines.push('var s = thisComp.layer("Color Controller").effect("' + te.strokeFx.replace(/"/g, '\\"') + '")("Color");');
                chain += ".setStrokeColor([s[0], s[1], s[2]])";
            }
            lines.push(chain + ".setText(value);");
            try { te.layer.sourceText.expression = lines.join("\n"); } catch (e) {}
        }

        app.endUndoGroup();
        var msg = "Added " + namedNewGroups.length + " color control" + (namedNewGroups.length === 1 ? "" : "s") + ".";
        if (reusedCount > 0) msg += " Linked " + reusedCount + " to existing color" + (reusedCount === 1 ? "" : "s") + ".";
        return msg;
    } catch (err) {
        try { app.endUndoGroup(); } catch (e) {}
        return "ERROR: " + err.toString();
    }
}

// ── SHAPE COLOR HUD ───────────────────────────────────────────────────────────
// Powers the Shape Tools widget's Fill/Stroke swatches + color gallery (see
// _pollShapeColorHud/_renderShapeColorHud in main.js) — a live, AE-Tools-panel-
// style summary of every shape layer's Fill/Stroke, scoped to the selected
// shape layers (or every shape layer in the comp if none are selected).
// Gradients are out of scope entirely — Gradient Fill/Stroke groups simply
// have different matchNames ("ADBE Vector Graphic - G-Fill"/"-G-Stroke") that
// are never matched below, same as Color Management's own scan. Effects and
// layer styles are also out of scope here (unlike Color Management) — this
// only looks at shape layers' own Fill/Stroke Contents groups, matching the
// AE Tools-panel widget it's modeled on.

function lineup_shapeColorHudTargetLayers(comp) {
    var selected = comp.selectedLayers;
    var layers = [];
    if (selected && selected.length) {
        for (var i = 0; i < selected.length; i++) {
            if (selected[i] instanceof ShapeLayer) layers.push(selected[i]);
        }
    } else {
        for (var i = 1; i <= comp.numLayers; i++) {
            if (comp.layer(i) instanceof ShapeLayer) layers.push(comp.layer(i));
        }
    }
    return layers;
}

// Recursively walks a vector Contents list collecting every solid Fill into
// `fillSlots` and every solid Stroke (color AND width together, since both
// live on the same "ADBE Vector Graphic - Stroke" item) into `strokeSlots` —
// same traversal shape as lineup_collectShapeColorSlots (Color Management,
// above), just keeping fill/stroke separate and capturing width, which that
// function has no need for. Disabled Fill/Stroke items are INCLUDED (not
// skipped) — the popup needs to see and toggle them (Solid/No Fill), so
// each slot carries its own `enabled` flag plus the item itself.
function lineup_collectFillStrokeSlots(contents, layerName, fillSlots, strokeSlots) {
    for (var i = 1; i <= contents.numProperties; i++) {
        var item = contents.property(i);
        var mn;
        try { mn = item.matchName; } catch (e) { continue; }
        if (mn === "ADBE Vector Group") {
            lineup_collectFillStrokeSlots(item.property("ADBE Vectors Group"), layerName, fillSlots, strokeSlots);
        } else if (mn === "ADBE Vector Graphic - Fill") {
            var fillEnabled = true;
            try { fillEnabled = !!item.enabled; } catch (e) {}
            var fillColor = item.property("ADBE Vector Fill Color");
            if (fillColor) fillSlots.push({ layerName: layerName, item: item, prop: fillColor, value: fillColor.value, enabled: fillEnabled });
        } else if (mn === "ADBE Vector Graphic - Stroke") {
            var strokeEnabled = true;
            try { strokeEnabled = !!item.enabled; } catch (e) {}
            var strokeColor = item.property("ADBE Vector Stroke Color");
            var strokeWidth = item.property("ADBE Vector Stroke Width");
            if (strokeColor && strokeWidth) {
                strokeSlots.push({
                    layerName: layerName, item: item,
                    colorProp: strokeColor, colorValue: strokeColor.value,
                    widthProp: strokeWidth, widthValue: strokeWidth.value,
                    enabled: strokeEnabled
                });
            }
        }
        // Gradient Fill/Stroke and every other item type simply aren't matched above — no color/width of interest there.
    }
}

function lineup_collectAllFillStrokeSlots(comp) {
    var layers = lineup_shapeColorHudTargetLayers(comp);
    var fillSlots = [], strokeSlots = [];
    for (var i = 0; i < layers.length; i++) {
        var root;
        try { root = layers[i].property("ADBE Root Vectors Group"); } catch (e) { root = null; }
        if (root) lineup_collectFillStrokeSlots(root, layers[i].name, fillSlots, strokeSlots);
    }
    return { fillSlots: fillSlots, strokeSlots: strokeSlots };
}

// { type: 'none' } | { type: 'color', value: [...] } | { type: 'mix' } — "mix" covers differing colors AND mixed on/off.
function lineup_summarizeColorSlots(slots, valueKey) {
    var anyEnabled = false, allEnabled = true, first = null, mixColor = false;
    for (var i = 0; i < slots.length; i++) {
        if (slots[i].enabled) {
            anyEnabled = true;
            if (first === null) first = slots[i][valueKey];
            else if (!lineup_colorsApproxEqual(first, slots[i][valueKey])) mixColor = true;
        } else {
            allEnabled = false;
        }
    }
    if (!anyEnabled) return { type: "none" };
    if (!allEnabled || mixColor) return { type: "mix" };
    return { type: "color", value: first };
}

// { type: 'none' } | { type: 'value', value: N } | { type: 'mix' } — same
// enabled-aware treatment as lineup_summarizeColorSlots, above.
function lineup_summarizeWidthSlots(slots) {
    var anyEnabled = false, allEnabled = true, first = null, mixWidth = false;
    for (var i = 0; i < slots.length; i++) {
        if (slots[i].enabled) {
            anyEnabled = true;
            if (first === null) first = slots[i].widthValue;
            else if (Math.abs(first - slots[i].widthValue) > 0.004) mixWidth = true;
        } else {
            allEnabled = false;
        }
    }
    if (!anyEnabled) return { type: "none" };
    if (!allEnabled || mixWidth) return { type: "mix" };
    return { type: "value", value: first };
}

// { type: 'all' } | { type: 'none' } | { type: 'mix' } — purely the on/off
// state across scope, independent of color/width, for the Solid/No Fill
// (or No Stroke) toggle's own active-state display.
function lineup_summarizeEnabled(slots) {
    if (!slots.length) return { type: "none" };
    var anyOn = false, anyOff = false;
    for (var i = 0; i < slots.length; i++) {
        if (slots[i].enabled) anyOn = true; else anyOff = true;
    }
    if (anyOn && anyOff) return { type: "mix" };
    return { type: anyOn ? "all" : "none" };
}

function lineup_getShapeColorHud() {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return JSON.stringify({ empty: true });

        var collected = lineup_collectAllFillStrokeSlots(comp);
        var fillSlots = collected.fillSlots, strokeSlots = collected.strokeSlots;

        var fills = [];
        for (var i = 0; i < fillSlots.length; i++) {
            fills.push({ layerName: fillSlots[i].layerName, value: fillSlots[i].value, enabled: fillSlots[i].enabled });
        }
        var strokes = [];
        for (var i = 0; i < strokeSlots.length; i++) {
            strokes.push({ layerName: strokeSlots[i].layerName, colorValue: strokeSlots[i].colorValue, widthValue: strokeSlots[i].widthValue, enabled: strokeSlots[i].enabled });
        }

        return JSON.stringify({
            fills: fills,
            strokes: strokes,
            fillSummary: lineup_summarizeColorSlots(fillSlots, "value"),
            fillEnabledSummary: lineup_summarizeEnabled(fillSlots),
            strokeColorSummary: lineup_summarizeColorSlots(strokeSlots, "colorValue"),
            strokeWidthSummary: lineup_summarizeWidthSlots(strokeSlots),
            strokeEnabledSummary: lineup_summarizeEnabled(strokeSlots)
        });
    } catch (e) {
        return "ERROR: " + e.toString();
    }
}

// Preserves the property's own existing array length instead of assuming one — setValue needs an array matching what's already there.
function lineup_shapeColorValueForProp(prop, r, g, b) {
    var cur = prop.value;
    return (cur && cur.length > 3) ? [r, g, b, cur[3]] : [r, g, b];
}

// Every setter below re-runs the same collection/indexing as the getter; all keyframe-aware (adds a key at current time rather than overwriting the animation).

function lineup_setShapeFillColorAll(r, g, b) {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return "";
        var fillSlots = lineup_collectAllFillStrokeSlots(comp).fillSlots;
        if (!fillSlots.length) return "";
        var t = comp.time;
        app.beginUndoGroup("Set Fill Color");
        for (var i = 0; i < fillSlots.length; i++) {
            var prop = fillSlots[i].prop;
            var v = lineup_shapeColorValueForProp(prop, r, g, b);
            if (prop.numKeys > 0) prop.setValueAtTime(t, v); else prop.setValue(v);
        }
        app.endUndoGroup();
        return "ok";
    } catch (e) {
        try { app.endUndoGroup(); } catch (e2) {}
        return "ERROR: " + e.toString();
    }
}

function lineup_setShapeFillColorAt(index, r, g, b) {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return "";
        var slot = lineup_collectAllFillStrokeSlots(comp).fillSlots[index];
        if (!slot) return "ERROR: That fill no longer exists — try reopening the popup.";
        var t = comp.time;
        app.beginUndoGroup("Set Fill Color");
        var v = lineup_shapeColorValueForProp(slot.prop, r, g, b);
        if (slot.prop.numKeys > 0) slot.prop.setValueAtTime(t, v); else slot.prop.setValue(v);
        app.endUndoGroup();
        return "ok";
    } catch (e) {
        try { app.endUndoGroup(); } catch (e2) {}
        return "ERROR: " + e.toString();
    }
}

function lineup_setShapeStrokeColorAll(r, g, b) {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return "";
        var strokeSlots = lineup_collectAllFillStrokeSlots(comp).strokeSlots;
        if (!strokeSlots.length) return "";
        var t = comp.time;
        app.beginUndoGroup("Set Stroke Color");
        for (var i = 0; i < strokeSlots.length; i++) {
            var prop = strokeSlots[i].colorProp;
            var v = lineup_shapeColorValueForProp(prop, r, g, b);
            if (prop.numKeys > 0) prop.setValueAtTime(t, v); else prop.setValue(v);
        }
        app.endUndoGroup();
        return "ok";
    } catch (e) {
        try { app.endUndoGroup(); } catch (e2) {}
        return "ERROR: " + e.toString();
    }
}

function lineup_setShapeStrokeColorAt(index, r, g, b) {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return "";
        var slot = lineup_collectAllFillStrokeSlots(comp).strokeSlots[index];
        if (!slot) return "ERROR: That stroke no longer exists — try reopening the popup.";
        var t = comp.time;
        app.beginUndoGroup("Set Stroke Color");
        var v = lineup_shapeColorValueForProp(slot.colorProp, r, g, b);
        if (slot.colorProp.numKeys > 0) slot.colorProp.setValueAtTime(t, v); else slot.colorProp.setValue(v);
        app.endUndoGroup();
        return "ok";
    } catch (e) {
        try { app.endUndoGroup(); } catch (e2) {}
        return "ERROR: " + e.toString();
    }
}

function lineup_setShapeStrokeWidthAll(width) {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return "";
        var strokeSlots = lineup_collectAllFillStrokeSlots(comp).strokeSlots;
        if (!strokeSlots.length) return "";
        var t = comp.time;
        app.beginUndoGroup("Set Stroke Width");
        for (var i = 0; i < strokeSlots.length; i++) {
            var prop = strokeSlots[i].widthProp;
            if (prop.numKeys > 0) prop.setValueAtTime(t, width); else prop.setValue(width);
        }
        app.endUndoGroup();
        return "ok";
    } catch (e) {
        try { app.endUndoGroup(); } catch (e2) {}
        return "ERROR: " + e.toString();
    }
}

function lineup_setShapeStrokeWidthAt(index, width) {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return "";
        var slot = lineup_collectAllFillStrokeSlots(comp).strokeSlots[index];
        if (!slot) return "ERROR: That stroke no longer exists — try reopening the popup.";
        var t = comp.time;
        app.beginUndoGroup("Set Stroke Width");
        if (slot.widthProp.numKeys > 0) slot.widthProp.setValueAtTime(t, width); else slot.widthProp.setValue(width);
        app.endUndoGroup();
        return "ok";
    } catch (e) {
        try { app.endUndoGroup(); } catch (e2) {}
        return "ERROR: " + e.toString();
    }
}

// Toggles the Fill/Stroke item's own .enabled checkbox, not a color change — existing color/width just reappears if switched back on.
function lineup_setShapeFillEnabledAll(enabled) {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return "";
        var fillSlots = lineup_collectAllFillStrokeSlots(comp).fillSlots;
        if (!fillSlots.length) return "";
        app.beginUndoGroup("Set Fill Enabled");
        for (var i = 0; i < fillSlots.length; i++) {
            try { fillSlots[i].item.enabled = !!enabled; } catch (e) {}
        }
        app.endUndoGroup();
        return "ok";
    } catch (e) {
        try { app.endUndoGroup(); } catch (e2) {}
        return "ERROR: " + e.toString();
    }
}

function lineup_setShapeStrokeEnabledAll(enabled) {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return "";
        var strokeSlots = lineup_collectAllFillStrokeSlots(comp).strokeSlots;
        if (!strokeSlots.length) return "";
        app.beginUndoGroup("Set Stroke Enabled");
        for (var i = 0; i < strokeSlots.length; i++) {
            try { strokeSlots[i].item.enabled = !!enabled; } catch (e) {}
        }
        app.endUndoGroup();
        return "ok";
    } catch (e) {
        try { app.endUndoGroup(); } catch (e2) {}
        return "ERROR: " + e.toString();
    }
}

// ── ALIGN ─────────────────────────────────────────────────────────────────────
// alignIdx: 0=left 1=centerX 2=right 3=top 4=centerY 5=bottom. useKeyframeAlign: 0/1, omitted -> treated as 1.

function lineup_align(alignIdx, alignToSelection, margin, usePercent, offsetKeys, useKeyframeAlign) {
    try {
        if (useKeyframeAlign === undefined) useKeyframeAlign = 1;
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return "ERROR: No active composition";
        var layers = comp.selectedLayers;
        if (!layers || layers.length === 0) return "ERROR: No layers selected";

        if (alignIdx <= 2 && useKeyframeAlign) {
            var keyGroups = lineup_collectSelectedKeyGroups(comp);
            if (keyGroups.length > 0) return lineup_alignKeyframes(alignIdx, alignToSelection, comp, keyGroups);
        }

        var shapeItems = lineup_collectSelectedShapeItems(comp);
        if (shapeItems.length > 0) return lineup_alignShapes(alignIdx, alignToSelection, margin, usePercent, offsetKeys, comp, shapeItems);

        var modes  = ["left","centerX","right","top","centerY","bottom"];
        var labels = ["Align Left","Center Horizontal","Align Right","Align Top","Center Vertical","Align Bottom"];

        var selRect = null;
        if (alignToSelection) {
            var lf = Infinity, tp = Infinity, rt = -Infinity, bt = -Infinity;
            for (var i = 0; i < layers.length; i++) {
                var r = getLayerCompBounds(layers[i], comp);
                if (!r) continue;
                if (r.left < lf) lf = r.left; if (r.top  < tp) tp = r.top;
                if (r.right > rt) rt = r.right; if (r.bottom > bt) bt = r.bottom;
            }
            selRect = { left:lf, top:tp, right:rt, bottom:bt, width:rt-lf, height:bt-tp };
        }

        app.beginUndoGroup("Align: " + labels[alignIdx]);
        var mode = modes[alignIdx];

        for (var i = 0; i < layers.length; i++) {
            var layer = layers[i], is3D = layer.threeDLayer;
            var rect  = getLayerCompBounds(layer, comp);
            var exr   = selRect;

            if (exr) {
                rect = { left:rect.left-exr.left, right:rect.right-exr.left,
                         top:rect.top-exr.top, bottom:rect.bottom-exr.top,
                         width:rect.width, height:rect.height };
            }

            var mH = margin, mW = margin;
            if (usePercent) { mH = (margin/100)*comp.height; mW = (margin/100)*comp.width; }

            var cw = exr ? exr.width  : comp.width;
            var ch = exr ? exr.height : comp.height;

            var posProp = layer.position;
            var pos = posProp.value;
            var np  = is3D ? [pos[0],pos[1],pos[2]] : [pos[0],pos[1]];

            // Comp-space delta converted to a position-unit delta through the parent chain, so alignment stays correct under a scaled/rotated parent.
            var dCompX = 0, dCompY = 0;
            switch (mode) {
                case "left":    dCompX = mW - rect.left;                        break;
                case "right":   dCompX = (cw-mW) - rect.right;                 break;
                case "top":     dCompY = mH - rect.top;                         break;
                case "bottom":  dCompY = (ch-mH) - rect.bottom;                break;
                case "centerX": dCompX = (cw/2) - (rect.left + rect.width/2);  break;
                case "centerY": dCompY = (ch/2) - (rect.top  + rect.height/2); break;
            }
            var d0 = compDeltaToPositionDelta(layer, dCompX, dCompY);
            np[0] += d0[0]; np[1] += d0[1];

            // 3D layers with depth can be skewed by camera perspective (not modeled above) — refine iteratively by re-measuring bounds until it converges.
            if (is3D && Math.abs(pos[2]) > 0.01) {
                for (var iter = 0; iter < 5; iter++) {
                    if (posProp.dimensionsSeparated) {
                        posProp.getSeparationFollower(0).setValue(np[0]);
                        posProp.getSeparationFollower(1).setValue(np[1]);
                        posProp.getSeparationFollower(2).setValue(np[2]);
                    } else { posProp.setValue(np); }
                    var nr = getLayerCompBounds(layer, comp);
                    var eCompX = 0, eCompY = 0;
                    switch (mode) {
                        case "left":    eCompX = mW - nr.left; break;
                        case "right":   eCompX = (cw-mW) - nr.right; break;
                        case "top":     eCompY = mH - nr.top; break;
                        case "bottom":  eCompY = (ch-mH) - nr.bottom; break;
                        case "centerX": eCompX = (cw/2) - (nr.left + nr.width/2); break;
                        case "centerY": eCompY = (ch/2) - (nr.top  + nr.height/2); break;
                    }
                    if (Math.abs(eCompX) < 0.5 && Math.abs(eCompY) < 0.5) break;
                    var de = compDeltaToPositionDelta(layer, eCompX, eCompY);
                    np[0] += de[0]; np[1] += de[1];
                }
            }

            if (offsetKeys) {
                shiftPosition(posProp, np[0]-pos[0], np[1]-pos[1], is3D);
            } else {
                setPositionAt(posProp, np, comp.time, is3D);
            }
        }
        app.endUndoGroup();
        return "ok";
    } catch (err) {
        try { app.endUndoGroup(); } catch(e) {}
        return "ERROR: " + err.toString();
    }
}

// ── DISTRIBUTE ────────────────────────────────────────────────────────────────
// horizontal: 1=H 0=V, distMode: 0=comp 1=selection 2=keyLayer, spacing: px

function lineup_distribute(horizontal, distMode, spacing, offsetKeys) {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return "ERROR: No active composition";
        var layers = comp.selectedLayers;
        if (!layers || layers.length < 2) return "ERROR: Select at least 2 layers";
        var H = !!horizontal;

        app.beginUndoGroup("Distribute " + (H ? "Horizontal" : "Vertical"));

        // offsetKeys on: shift every keyframe by the delta (preserves existing motion).
        // offsetKeys off: snap only the value at the current time, like Align's default.
        function place(layer, dx, dy) {
            if (offsetKeys) {
                shiftPosition(layer.position, dx, dy, layer.threeDLayer);
            } else {
                var is3D = layer.threeDLayer, pos = layer.position.value;
                var np = is3D ? [pos[0]+dx, pos[1]+dy, pos[2]] : [pos[0]+dx, pos[1]+dy];
                setPositionAt(layer.position, np, comp.time, is3D);
            }
        }

        if (distMode === 2) {
            var kl = layers[0], kb = getLayerCompBounds(kl, comp);
            var kc = H ? kb.left + kb.width/2 : kb.top + kb.height/2;
            var bef = [], aft = [];
            for (var i = 1; i < layers.length; i++) {
                var b = getLayerCompBounds(layers[i], comp);
                var c = H ? b.left + b.width/2 : b.top + b.height/2;
                (c < kc ? bef : aft).push(layers[i]);
            }
            bef.sort(function(a,b){ var A=getLayerCompBounds(a,comp),B=getLayerCompBounds(b,comp); return H?B.left-A.left:B.top-A.top; });
            aft.sort(function(a,b){ var A=getLayerCompBounds(a,comp),B=getLayerCompBounds(b,comp); return H?A.left-B.left:A.top-B.top; });
            var edgeBef = H ? kb.left  : kb.top;
            var edgeAft = H ? kb.right : kb.bottom;
            for (var i = 0; i < bef.length; i++) {
                var l = bef[i], bd = getLayerCompBounds(l, comp);
                var sz = H ? bd.width : bd.height, ctr = H ? bd.left+bd.width/2 : bd.top+bd.height/2;
                var dlt = (edgeBef - spacing - sz/2) - ctr;
                place(l, H?dlt:0, H?0:dlt);
                edgeBef -= spacing + sz;
            }
            for (var i = 0; i < aft.length; i++) {
                var l = aft[i], bd = getLayerCompBounds(l, comp);
                var sz = H ? bd.width : bd.height, ctr = H ? bd.left+bd.width/2 : bd.top+bd.height/2;
                var dlt = (edgeAft + spacing + sz/2) - ctr;
                place(l, H?dlt:0, H?0:dlt);
                edgeAft += spacing + sz;
            }
        } else {
            var ld = [];
            for (var i = 0; i < layers.length; i++) {
                var b = getLayerCompBounds(layers[i], comp);
                var ctr  = H ? b.left + b.width/2  : b.top + b.height/2;
                var half = H ? b.width/2            : b.height/2;
                ld.push({ layer:layers[i], center:ctr, half:half });
            }
            ld.sort(function(a,b){ return a.center-b.center; });
            // mode 0: end layers flush against comp edges; mode 1: end layers stay put, middles distributed between them.
            var rStart = (distMode===0) ? ld[0].half                                              : ld[0].center;
            var rEnd   = (distMode===0) ? (H ? comp.width : comp.height) - ld[ld.length-1].half   : ld[ld.length-1].center;
            var step   = (rEnd - rStart) / (ld.length - 1);
            for (var i = 0; i < ld.length; i++) {
                var dlt = (rStart + step*i) - ld[i].center;
                place(ld[i].layer, H?dlt:0, H?0:dlt);
            }
        }

        app.endUndoGroup();
        return "ok";
    } catch (err) {
        try { app.endUndoGroup(); } catch(e) {}
        return "ERROR: " + err.toString();
    }
}

function lineup_zDistribute(distMode, spacing, zStart, zEnd, even, step) {
    if (zStart === undefined || zStart === null) zStart = 0;
    if (zEnd   === undefined || zEnd   === null) zEnd   = 1000;
    if (even   === undefined || even   === null) even   = 1;
    if (step   === undefined || step   === null) step   = 100;
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return "ERROR: No active composition";
        var layers = comp.selectedLayers;
        if (!layers || layers.length < 2) return "ERROR: Select at least 2 layers";
        for (var i = 0; i < layers.length; i++)
            if (!layers[i].threeDLayer) return "ERROR: All layers must be 3D. \"" + layers[i].name + "\" is not 3D.";

        app.beginUndoGroup("Distribute Z");

        if (distMode === 2) {
            var kz = getZ(layers[0].position), bef = [], aft = [];
            for (var i = 1; i < layers.length; i++)
                (getZ(layers[i].position) < kz ? bef : aft).push(layers[i]);
            bef.sort(function(a,b){ return getZ(b.position)-getZ(a.position); });
            aft.sort(function(a,b){ return getZ(a.position)-getZ(b.position); });
            for (var i = 0; i < bef.length; i++) setZ(bef[i].position, kz-(i+1)*spacing);
            for (var i = 0; i < aft.length; i++) setZ(aft[i].position, kz+(i+1)*spacing);
        } else {
            var data = [];
            for (var i = 0; i < layers.length; i++) data.push({ layer:layers[i], z:getZ(layers[i].position) });
            data.sort(function(a,b){ return a.z-b.z; });
            var zMin = (distMode===0)?zStart:data[0].z, zMax = (distMode===0)?zEnd:data[data.length-1].z, n=data.length;
            var rangeLen = zMax - zMin;
            for (var i = 0; i < n; i++) {
                var tz;
                if (even || step <= 0 || rangeLen <= 0) {
                    tz = (n===1) ? (zMin+zMax)/2 : zMin+(i/(n-1))*rangeLen;
                } else {
                    var numSlots = Math.floor(rangeLen / step) + 1;
                    tz = zMin + (i % numSlots) * step;
                }
                setZ(data[i].layer.position, tz);
            }
        }

        app.endUndoGroup();
        return "ok";
    } catch (err) {
        try { app.endUndoGroup(); } catch(e) {}
        return "ERROR: " + err.toString();
    }
}

function clearPositionKeys(layer) {
    try {
        var pos = layer.position;
        if (pos.dimensionsSeparated) {
            var xp = pos.getSeparationFollower(0), yp = pos.getSeparationFollower(1);
            while (xp.numKeys > 0) xp.removeKey(1);
            while (yp.numKeys > 0) yp.removeKey(1);
        } else {
            while (pos.numKeys > 0) pos.removeKey(1);
        }
    } catch(e) {}
}

function lineup_pathDistribute(distMode, spacing, rotate) {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return "ERROR: No active composition";
        var layers = comp.selectedLayers;
        if (!layers || layers.length < 2) return "ERROR: Select a shape layer as the topmost, then the layers to distribute.";
        var pathLayer = layers[0];
        if (!(pathLayer instanceof ShapeLayer)) return "ERROR: Topmost selected layer must be a shape layer.";

        function findShape(pg) {
            for (var i = 1; i <= pg.numProperties; i++) {
                try {
                    var p = pg.property(i);
                    if (p.matchName === "ADBE Vector Shape - Group") return p.property("ADBE Vector Shape").value;
                    try { if (p.numProperties > 0) { var f = findShape(p); if (f) return f; } } catch(e) {}
                } catch(e) {}
            }
            return null;
        }
        var shape = null;
        try { shape = findShape(pathLayer.property("ADBE Root Vectors Group")); } catch(e) {}
        if (!shape || !shape.vertices || shape.vertices.length < 2) return "ERROR: No bezier path found.";

        function bez(p0,p1,p2,p3,t) {
            var m=1-t;
            return [m*m*m*p0[0]+3*m*m*t*p1[0]+3*m*t*t*p2[0]+t*t*t*p3[0],
                    m*m*m*p0[1]+3*m*m*t*p1[1]+3*m*t*t*p2[1]+t*t*t*p3[1]];
        }
        var verts=shape.vertices, inT=shape.inTangents, outT=shape.outTangents;
        var n=verts.length, numSegs=shape.closed?n:n-1;
        var samples=[{len:0,pt:[verts[0][0],verts[0][1]]}], totalLen=0;
        for (var seg=0; seg<numSegs; seg++) {
            var i0=seg, i1=(seg+1)%n;
            var s0=verts[i0], s1b=[verts[i0][0]+outT[i0][0],verts[i0][1]+outT[i0][1]];
            var s2b=[verts[i1][0]+inT[i1][0],verts[i1][1]+inT[i1][1]], s3=verts[i1];
            for (var k=1; k<=100; k++) {
                var st=k/100, spt=bez(s0,s1b,s2b,s3,st);
                var sprev=samples[samples.length-1].pt;
                var sdx=spt[0]-sprev[0], sdy=spt[1]-sprev[1];
                totalLen+=Math.sqrt(sdx*sdx+sdy*sdy);
                samples.push({len:totalLen,pt:spt});
            }
        }
        function ptAt(progress) {
            if (totalLen===0) return [verts[0][0],verts[0][1]];
            var tgt=progress*totalLen;
            for (var si=1; si<samples.length; si++) {
                if (samples[si].len>=tgt) {
                    var a=samples[si-1],b=samples[si];
                    var frac=(b.len>a.len)?(tgt-a.len)/(b.len-a.len):0;
                    return [a.pt[0]+frac*(b.pt[0]-a.pt[0]),a.pt[1]+frac*(b.pt[1]-a.pt[1])];
                }
            }
            return samples[samples.length-1].pt;
        }
        function tanAt(progress) {
            var eps=0.005, p1=ptAt(Math.max(0,progress-eps)), p2=ptAt(Math.min(1,progress+eps));
            var c1=LST.toComp(pathLayer,[p1[0],p1[1],0]), c2=LST.toComp(pathLayer,[p2[0],p2[1],0]);
            return Math.atan2(c2[1]-c1[1],c2[0]-c1[0])*(180/Math.PI)+90;
        }
        function moveTo(layer, progress) {
            var ptL=ptAt(progress), ptC=LST.toComp(pathLayer,[ptL[0],ptL[1],0]);
            var bounds=getLayerCompBounds(layer,comp);
            var pos=layer.position, pv=pos.value, i3=layer.threeDLayer;
            var np=i3?[pv[0],pv[1],pv[2]]:[pv[0],pv[1]];
            np[0]+=ptC[0]-(bounds.left+bounds.width/2);
            np[1]+=ptC[1]-(bounds.top+bounds.height/2);
            if (pos.dimensionsSeparated) { collapsePosition(layer); layer.position.setValue(np); }
            else pos.setValue(np);
            return bounds;
        }

        var m = layers.length-1;
        app.beginUndoGroup("Path Distribute");

        for (var ai=1; ai<=m; ai++) {
            try { var ar=sourceRectAtTimeSafe(layers[ai],comp.time,false); applyAnchorShift(layers[ai],anchorLocToPoint(4,ar.width,ar.height,ar.left,ar.top)); } catch(e) {}
            clearPositionKeys(layers[ai]);
        }

        if (distMode===2) {
            var spc=spacing||0;
            if (spc===0) {
                var cur=0;
                for (var i=0; i<m; i++) {
                    var p=(totalLen>0)?(cur%totalLen)/totalLen:0;
                    var bd=moveTo(layers[i+1],p);
                    if (rotate) try { layers[i+1].rotation.setValue(tanAt(p)); } catch(e) {}
                    cur+=bd.width;
                }
            } else {
                for (var i=0; i<m; i++) {
                    var p=((i*spc)%100)/100;
                    moveTo(layers[i+1],p);
                    if (rotate) try { layers[i+1].rotation.setValue(tanAt(p)); } catch(e) {}
                }
            }
        } else {
            for (var i=0; i<m; i++) {
                var p=(m===1)?0:i/(m-1);
                moveTo(layers[i+1],p);
                if (rotate) try { layers[i+1].rotation.setValue(tanAt(p)); } catch(e) {}
            }
        }

        app.endUndoGroup();
        return "ok";
    } catch (err) {
        try { app.endUndoGroup(); } catch(e) {}
        return "ERROR: " + err.toString();
    }
}

// ── PATH RIG ──────────────────────────────────────────────────────────────────
// Live, expression-driven distribute-along-path. Unlike lineup_pathDistribute
// (which bakes static positions once), members here stay linked forever: each
// carries an "ADBE Layer Control" effect pointing at the controller (robust to
// renaming/reordering), and Position/Scale/Opacity expressions that re-scan the
// comp every frame for how many OTHER layers reference that same controller.
// Deleting or adding a member therefore redistributes everyone automatically —
// no re-run of this function needed except to add a brand-new member.

var PATHRIG_CONTROLLER_EFFECT     = "Path Rig Controller";
var PATHRIG_OFFSET_EFFECT         = "Path Rig Offset";
var PATHRIG_LAYER_OFFSET_EFFECT   = "Path Rig Layer Offset";
var PATHRIG_TAPER_SCALE_EFFECT    = "Path Rig Taper Scale";
var PATHRIG_TAPER_OPACITY_EFFECT  = "Path Rig Taper Opacity";
var PATHRIG_PATH_GROUP            = "Path Rig Path";
var PATHRIG_PATH_SHAPE            = "Path Rig Shape";

function pathRig_hasEffect(layer, name) {
    var fx;
    try { fx = layer.property("ADBE Effect Parade"); } catch (e) { return false; }
    if (!fx) return false;
    try { return !!fx.property(name); } catch (e) { return false; }
}

function pathRig_isController(layer) {
    if (!layer || !(layer instanceof ShapeLayer)) return false;
    return pathRig_hasEffect(layer, PATHRIG_OFFSET_EFFECT);
}

// True if `layer` already carries a "Path Rig Controller" Layer Control effect pointing at `controller`.
// Loops every effect (rather than a single named lookup) so a layer that's already a member of a
// DIFFERENT Path Rig — which would also have an effect with this exact name — isn't misread as a match.
function pathRig_isMemberOf(layer, controller) {
    var fx;
    try { fx = layer.property("ADBE Effect Parade"); } catch (e) { return false; }
    if (!fx) return false;
    for (var i = 1; i <= fx.numProperties; i++) {
        try {
            var e = fx.property(i);
            if (e.name === PATHRIG_CONTROLLER_EFFECT && e.property(1).value === controller.index) return true;
        } catch (e2) {}
    }
    return false;
}

// Depth-first search for the first bezier path ("ADBE Vector Shape - Group") anywhere under a shape
// layer's content tree, mirroring lineup_pathDistribute's own findShape — but returning the PROPERTY
// (so its name/ancestry can be walked) instead of just its baked Shape value.
function pathRig_findPathShapeProp(pg) {
    for (var i = 1; i <= pg.numProperties; i++) {
        try {
            var p = pg.property(i);
            if (p.matchName === "ADBE Vector Shape - Group") return p;
            if (p.matchName === "ADBE Vector Group") {
                var f = pathRig_findPathShapeProp(p.property("ADBE Vectors Group"));
                if (f) return f;
            }
        } catch (e) {}
    }
    return null;
}

// Resolves the controller's path property into a chain of content() names an expression can use to
// re-find it — e.g. ["Shape 1", "Path 1"] for content("Shape 1").content("Path 1").path — at any
// nesting depth, reusing lineup_ancestorVectorGroups (innermost ancestor first; reversed here).
function pathRig_getPathChain(controller) {
    var rootVecs;
    try { rootVecs = controller.property("ADBE Root Vectors Group"); } catch (e) { return null; }
    var shapeProp = pathRig_findPathShapeProp(rootVecs);
    if (!shapeProp) return null;
    var ancestors = lineup_ancestorVectorGroups(shapeProp);
    var chain = [];
    for (var i = ancestors.length - 1; i >= 0; i--) chain.push(ancestors[i].name);
    chain.push(shapeProp.name);
    return chain;
}

function pathRig_contentChainExpr(chain) {
    var s = "";
    for (var i = 0; i < chain.length; i++) s += '.content("' + String(chain[i]).replace(/"/g, '\\"') + '")';
    return s;
}

// Shared setup every Path Rig expression needs: resolve the controller, turn its Offset angle into a
// 0..1 cyclic phase (wrapping every 360°, so spinning the angle control endlessly cycles items along
// the path), read thisLayer's OWN individual "Path Rig Layer Offset" angle the same way (so each member
// can be nudged along the path independently of the shared rig placement), then live-count how many
// OTHER layers reference this same controller and rank thisLayer among them — this live count/rank, not
// anything baked at script time, is what makes deleting or adding a member redistribute everyone else
// automatically.
//
// On a CLOSED path, t=0 and t=1 are the same point, so spreading n items across
// rank/(n-1) — correct for an open path — would stack the first and last item on
// top of each other at that seam. Closed paths instead use rank/n, spacing every
// item evenly around the loop with no duplicated point.
//
// The wrap below (for the Offset control's cyclic phase) intentionally is NOT a
// plain "% 1": with the Offset control left at its default of 0, an open path's
// last member lands at t=1 exactly, and 1 % 1 === 0 in JS — which silently
// snapped the last member onto the first member's spot even with no offset
// applied at all. Rounding down instead (t - floor(t)) and only remapping an
// exact whole number to 1 (never to 0, unless it truly IS 0) keeps t=0 and t=1
// distinct at baseline while still wrapping correctly once the offset is used.
function pathRig_preamble(chain) {
    return [
        'var ctrl = effect("' + PATHRIG_CONTROLLER_EFFECT + '")(1);',
        'var offsetDeg = ctrl.effect("' + PATHRIG_OFFSET_EFFECT + '")(1);',
        'var cycleOffset = (((offsetDeg % 360) + 360) % 360) / 360;',
        'var layerOffsetDeg = effect("' + PATHRIG_LAYER_OFFSET_EFFECT + '")(1);',
        'var layerOffset = (((layerOffsetDeg % 360) + 360) % 360) / 360;',
        'var pathProp = ctrl' + pathRig_contentChainExpr(chain) + '.path;',
        'var pathClosed = pathProp.value.closed;',
        'var matches = [];',
        'for (var pi = 1; pi <= thisComp.numLayers; pi++) {',
        '    var L = thisComp.layer(pi);',
        '    try {',
        '        if (L.effect("' + PATHRIG_CONTROLLER_EFFECT + '")(1).index == ctrl.index) matches.push(L.index);',
        '    } catch (e) {}',
        '}',
        'matches.sort(function (a, b) { return a - b; });',
        'var n = matches.length;',
        'var rank = 0;',
        'for (var pk = 0; pk < n; pk++) { if (matches[pk] == thisLayer.index) { rank = pk; break; } }',
        'var t = pathClosed ? (n > 0 ? rank / n : 0) : (n > 1 ? rank / (n - 1) : 0.5);',
        'var tRaw = t + cycleOffset + layerOffset;',
        't = tRaw - Math.floor(tRaw);',
        'if (t === 0 && tRaw !== 0) t = 1;'
    ].join('\n');
}

function pathRig_positionExpression(chain) {
    return pathRig_preamble(chain) + '\n' +
        'var localPt = pathProp.pointOnPath(t, time);\n' +
        'var compPt = ctrl.toComp(localPt);\n' +
        'thisLayer.hasParent ? thisLayer.parent.fromComp(compPt) : compPt;';
}

// Symmetric falloff: unaffected at path center (t=0.5), most affected at the path's two ends —
// shared by both Taper Scale and Taper Opacity, just multiplying a different base property's value.
// A closed path has no real "ends" to taper toward, so tapering is a no-op there (edge stays 0).
function pathRig_taperExpression(chain, taperEffectName) {
    return pathRig_preamble(chain) + '\n' +
        'var edge = pathClosed ? 0 : Math.abs(t - 0.5) * 2;\n' +
        'var taper = Math.max(0, Math.min(1, ctrl.effect("' + taperEffectName + '")(1) / 100));\n' +
        'var factor = 1 - taper * edge;\n' +
        'value * factor;';
}

function pathRig_addControllerEffects(layer) {
    var effects = layer.property("ADBE Effect Parade");
    if (!pathRig_hasEffect(layer, PATHRIG_OFFSET_EFFECT)) {
        var offset = effects.addProperty("ADBE Angle Control");
        offset.name = PATHRIG_OFFSET_EFFECT;
    }
    if (!pathRig_hasEffect(layer, PATHRIG_TAPER_SCALE_EFFECT)) {
        var taperScale = effects.addProperty("ADBE Slider Control");
        taperScale.name = PATHRIG_TAPER_SCALE_EFFECT;
        taperScale.property(1).setValue(0);
    }
    if (!pathRig_hasEffect(layer, PATHRIG_TAPER_OPACITY_EFFECT)) {
        var taperOpacity = effects.addProperty("ADBE Slider Control");
        taperOpacity.name = PATHRIG_TAPER_OPACITY_EFFECT;
        taperOpacity.property(1).setValue(0);
    }
}

// Builds the default guide layer used when nothing path-like was selected: a thin horizontal red
// stroke, sized relative to the comp, centered — just a starting shape for the user to reshape/move.
function pathRig_createDefaultController(comp) {
    var shapeLayer = comp.layers.addShape();
    shapeLayer.name = "Path Rig Controller";
    shapeLayer.guideLayer = true;

    var w = Math.min(comp.width, comp.height) * 0.6;
    var rootVecs = shapeLayer.property("ADBE Root Vectors Group");
    var grp = rootVecs.addProperty("ADBE Vector Group");
    grp.name = PATHRIG_PATH_GROUP;
    var gc = grp.property("ADBE Vectors Group");

    var pathItem = gc.addProperty("ADBE Vector Shape - Group");
    pathItem.name = PATHRIG_PATH_SHAPE;
    var lineShape = new Shape();
    lineShape.vertices = [[-w / 2, 0], [w / 2, 0]];
    lineShape.inTangents = [[0, 0], [0, 0]];
    lineShape.outTangents = [[0, 0], [0, 0]];
    lineShape.closed = false;
    pathItem.property("ADBE Vector Shape").setValue(lineShape);

    var stroke = gc.addProperty("ADBE Vector Graphic - Stroke");
    stroke.property("ADBE Vector Stroke Color").setValue([1, 0, 0]);
    stroke.property("ADBE Vector Stroke Width").setValue(2);

    shapeLayer.position.setValue([comp.width / 2, comp.height / 2]);

    pathRig_addControllerEffects(shapeLayer);
    return shapeLayer;
}

// An already-selected shape layer becomes the controller in place: marked as a guide layer (so it
// never renders) and renamed so it reads clearly as part of the rig, but its path content is left
// exactly as the user drew it — only pathRig_getPathChain needs to know how to re-find it.
function pathRig_convertExistingToController(layer) {
    layer.guideLayer = true;
    if (!/\(Path Rig\)$/.test(layer.name)) layer.name = layer.name + " (Path Rig)";
    pathRig_addControllerEffects(layer);
    return layer;
}

function pathRig_attachMember(layer, controller) {
    var chain = pathRig_getPathChain(controller);
    if (!chain) throw new Error("Path Rig controller has no usable path.");

    var effects = layer.property("ADBE Effect Parade");
    var lc = effects.addProperty("ADBE Layer Control");
    lc.name = PATHRIG_CONTROLLER_EFFECT;
    lc.property(1).setValue(controller.index);

    // Each member gets its own Angle Control so it can be nudged along the path independently of the
    // shared rig placement — same "degrees / 360 = fraction of the path" convention as the controller's
    // own Offset control, just scoped to this one layer instead of shifting everyone at once.
    var layerOffset = effects.addProperty("ADBE Angle Control");
    layerOffset.name = PATHRIG_LAYER_OFFSET_EFFECT;

    collapsePosition(layer);
    var transform = layer.property("ADBE Transform Group");
    transform.property("ADBE Position").expression = pathRig_positionExpression(chain);
    transform.property("ADBE Scale").expression = pathRig_taperExpression(chain, PATHRIG_TAPER_SCALE_EFFECT);
    transform.property("ADBE Opacity").expression = pathRig_taperExpression(chain, PATHRIG_TAPER_OPACITY_EFFECT);
}

// Every layer in the comp currently wired to `controller`, regardless of what's selected right now.
function pathRig_getAllMembers(comp, controller) {
    var out = [];
    for (var i = 1; i <= comp.numLayers; i++) {
        var L = comp.layer(i);
        if (L !== controller && pathRig_isMemberOf(L, controller)) out.push(L);
    }
    return out;
}

function pathRig_sameLayerSet(a, b) {
    if (a.length !== b.length) return false;
    var idxA = {};
    for (var i = 0; i < a.length; i++) idxA[a[i].index] = true;
    for (var i = 0; i < b.length; i++) if (!idxA[b[i].index]) return false;
    return true;
}

function pathRig_teardownMember(layer) {
    try {
        var transform = layer.property("ADBE Transform Group");
        transform.property("ADBE Position").expression = "";
        transform.property("ADBE Scale").expression = "";
        transform.property("ADBE Opacity").expression = "";
    } catch (e) {}
    try {
        var fx = layer.property("ADBE Effect Parade");
        for (var i = fx.numProperties; i >= 1; i--) {
            var nm = fx.property(i).name;
            if (nm === PATHRIG_CONTROLLER_EFFECT || nm === PATHRIG_LAYER_OFFSET_EFFECT) fx.property(i).remove();
        }
    } catch (e) {}
}

// A controller still named exactly "Path Rig Controller" is one this tool created from scratch (never
// renamed by the user) — safe to delete outright, since it only ever existed as rig scaffolding. Any
// other name means it was the user's own shape layer before being converted, so it's kept: effects are
// stripped, guideLayer is cleared, and the " (Path Rig)" suffix this tool added is peeled back off.
function pathRig_teardownController(controller) {
    var wasCreatedByUs = (controller.name === "Path Rig Controller");
    if (wasCreatedByUs) {
        controller.remove();
        return;
    }
    try {
        var fx = controller.property("ADBE Effect Parade");
        for (var i = fx.numProperties; i >= 1; i--) {
            var nm = fx.property(i).name;
            if (nm === PATHRIG_OFFSET_EFFECT || nm === PATHRIG_TAPER_SCALE_EFFECT || nm === PATHRIG_TAPER_OPACITY_EFFECT) {
                fx.property(i).remove();
            }
        }
    } catch (e) {}
    controller.guideLayer = false;
    if (/ \(Path Rig\)$/.test(controller.name)) controller.name = controller.name.replace(/ \(Path Rig\)$/, "");
}

function pathRig_teardown(controller, members) {
    for (var i = 0; i < members.length; i++) pathRig_teardownMember(members[i]);
    pathRig_teardownController(controller);
}

function lineup_pathRigDistribute() {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return "ERROR: No active composition.";
        var sel = comp.selectedLayers;
        if (!sel || sel.length < 1) return "ERROR: Select a path (or the Path Rig controller plus layers to add) first.";

        app.beginUndoGroup("Path Rig Distribute");

        // An already-selected controller (from a prior run) always wins — everything else selected
        // alongside it is a candidate to ADD to that existing rig, not a fresh setup.
        var controller = null;
        for (var i = 0; i < sel.length; i++) {
            if (pathRig_isController(sel[i])) { controller = sel[i]; break; }
        }

        var candidates = [];
        if (controller) {
            for (var i = 0; i < sel.length; i++) if (sel[i] !== controller) candidates.push(sel[i]);

            // Selecting the controller plus EXACTLY its full current member set (no more, no fewer,
            // no un-attached extras) clears the rig instead of adding — the teardown counterpart to
            // building one up one layer at a time.
            var allMembers = pathRig_getAllMembers(comp, controller);
            if (pathRig_sameLayerSet(candidates, allMembers)) {
                pathRig_teardown(controller, allMembers);
                app.endUndoGroup();
                return "ok";
            }
        } else {
            var first = sel[0];
            var usableExisting = (first instanceof ShapeLayer) && pathRig_getPathChain(first);
            if (usableExisting) {
                controller = pathRig_convertExistingToController(first);
                for (var i = 1; i < sel.length; i++) candidates.push(sel[i]);
            } else {
                controller = pathRig_createDefaultController(comp);
                for (var i = 0; i < sel.length; i++) candidates.push(sel[i]);
            }
        }

        var added = 0;
        for (var i = 0; i < candidates.length; i++) {
            var L = candidates[i];
            if (!(L instanceof AVLayer) || L === controller) continue;
            if (pathRig_isMemberOf(L, controller)) continue;
            pathRig_attachMember(L, controller);
            added++;
        }

        app.endUndoGroup();
        if (added === 0) return "ERROR: Select the Path Rig controller plus at least one other layer to add.";
        return "ok";
    } catch (err) {
        try { app.endUndoGroup(); } catch (e) {}
        return "ERROR: " + err.toString();
    }
}

// ── ROUNDED MASK RIG ─────────────────────────────────────────────────────────
// Adds a plain reference-rectangle mask (mode None, freely draggable like any normal
// rect mask) plus a Corner Radius slider, then a second mask whose Mask Shape expression
// reads the reference rectangle's current bounds and rebuilds it as a rounded rect —
// so reshaping the reference rectangle keeps the rounded mask in sync.

// Finds the next unused mask name on a layer, appending " 2"/" 3"/... same as
// smartLink_createUniqueControl does for effect names.
function roundedMaskRig_uniqueMaskName(maskParade, baseName) {
    var name = baseName, suffix = 2;
    while (true) {
        var existing = null;
        try { existing = maskParade.property(name); } catch (e) {}
        if (!existing) return name;
        name = baseName + " " + suffix++;
    }
}

// Mask/effect names are user-editable strings and get embedded verbatim into the
// generated expression's string literals, so quotes/backslashes must be escaped.
function roundedMaskRig_buildExpression(refMaskName, sliderName) {
    var refEsc = refMaskName.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    var sliderEsc = sliderName.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return [
        'srcPath = thisLayer.mask("' + refEsc + '").maskPath;',
        'pts = srcPath.points();',
        'xs = []; ys = [];',
        'for (i = 0; i < pts.length; i++){ xs.push(pts[i][0]); ys.push(pts[i][1]); }',
        'left = Math.min.apply(null, xs);',
        'right = Math.max.apply(null, xs);',
        'top = Math.min.apply(null, ys);',
        'bottom = Math.max.apply(null, ys);',
        '',
        'w = right - left;',
        'h = bottom - top;',
        'cx = left + w/2;',
        'cy = top + h/2;',
        'hw = w/2; hh = h/2;',
        '',
        'maxR = Math.min(hw, hh);',
        'r = Math.max(0, Math.min(effect("' + sliderEsc + '")("Slider"), maxR));',
        '',
        'k = 0.5522847498;',
        'kr = r * k;',
        '',
        'pointsArr = [',
        '  [cx-hw+r, cy-hh],',
        '  [cx+hw-r, cy-hh],',
        '  [cx+hw,   cy-hh+r],',
        '  [cx+hw,   cy+hh-r],',
        '  [cx+hw-r, cy+hh],',
        '  [cx-hw+r, cy+hh],',
        '  [cx-hw,   cy+hh-r],',
        '  [cx-hw,   cy-hh+r]',
        '];',
        '',
        'inTans = [ [-kr,0],[0,0],[0,-kr],[0,0],[kr,0],[0,0],[0,kr],[0,0] ];',
        'outTans = [ [0,0],[kr,0],[0,0],[0,kr],[0,0],[-kr,0],[0,0],[0,-kr] ];',
        '',
        'createPath(pointsArr, inTans, outTans, true);'
    ].join('\n');
}

function lineup_addRoundedMaskRig() {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return "ERROR: No active composition.";
        var layers = comp.selectedLayers;
        if (!layers || layers.length === 0) return "ERROR: Select at least one layer first.";

        app.beginUndoGroup("Add Rounded Mask Rig");
        var applied = 0, skipped = 0;
        for (var i = 0; i < layers.length; i++) {
            var layer = layers[i];
            if (!(layer instanceof AVLayer)) { skipped++; continue; }

            var sliderResult = smartLink_createUniqueControl(layer, "slider", "Corner Radius");
            smartLink_getControlValueProperty(sliderResult.control, "slider").setValue(0);

            var maskParade = layer.property("ADBE Mask Parade");

            var refName = roundedMaskRig_uniqueMaskName(maskParade, "Rect Reference");
            var refMask = maskParade.addProperty("ADBE Mask Atom");
            refMask.name = refName;
            refMask.maskMode = MaskMode.NONE;

            var roundedName = roundedMaskRig_uniqueMaskName(maskParade, "Rounded Mask");
            var roundedMask = maskParade.addProperty("ADBE Mask Atom");
            roundedMask.name = roundedName;
            roundedMask.maskMode = MaskMode.ADD;
            roundedMask.property("ADBE Mask Shape").expression =
                roundedMaskRig_buildExpression(refName, sliderResult.name);

            applied++;
        }
        app.endUndoGroup();

        if (applied === 0) return "ERROR: Selected layer(s) don't support masks.";
        return "ok";
    } catch (err) {
        try { app.endUndoGroup(); } catch (e) {}
        return "ERROR: " + err.toString();
    }
}

function lineup_radialDistribute(distMode, spacing, radius, rotate) {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return "ERROR: No active composition";
        var layers = comp.selectedLayers;
        if (!layers || layers.length < 1) return "ERROR: Select at least one layer";
        if (isNaN(radius) || radius <= 0) return "ERROR: Enter a valid radius (px)";

        var m=layers.length, cx=comp.width/2, cy=comp.height/2;
        app.beginUndoGroup("Radial Distribute");

        for (var ai=0; ai<m; ai++) {
            try { var ar=sourceRectAtTimeSafe(layers[ai],comp.time,false); applyAnchorShift(layers[ai],anchorLocToPoint(4,ar.width,ar.height,ar.left,ar.top)); } catch(e) {}
            clearPositionKeys(layers[ai]);
        }

        function place(layer, angle) {
            var tx=cx+radius*Math.cos(angle), ty=cy+radius*Math.sin(angle);
            var bounds=getLayerCompBounds(layer,comp);
            var pos=layer.position, pv=pos.value, i3=layer.threeDLayer;
            var np=i3?[pv[0],pv[1],pv[2]]:[pv[0],pv[1]];
            np[0]+=tx-(bounds.left+bounds.width/2);
            np[1]+=ty-(bounds.top+bounds.height/2);
            if (pos.dimensionsSeparated) { collapsePosition(layer); layer.position.setValue(np); }
            else pos.setValue(np);
            if (rotate) { try { layer.rotation.setValue(Math.atan2(Math.cos(angle),-Math.sin(angle))*(180/Math.PI)+90); } catch(e) {} }
            return bounds;
        }

        if (distMode===2) {
            var spc=spacing||0;
            if (spc===0) {
                var cur=-Math.PI/2;
                for (var i=0; i<m; i++) { var bd=place(layers[i],cur); cur+=bd.width/radius; }
            } else {
                for (var i=0; i<m; i++) { var f=((i*spc)%100)/100; place(layers[i],-Math.PI/2+f*2*Math.PI); }
            }
        } else {
            for (var i=0; i<m; i++) place(layers[i],(i/m)*2*Math.PI-Math.PI/2);
        }

        app.endUndoGroup();
        return "ok";
    } catch (err) {
        try { app.endUndoGroup(); } catch(e) {}
        return "ERROR: " + err.toString();
    }
}

function lineup_gridDistribute(distMode, cols, rows, alignEdges, hPad, vPad) {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return "ERROR: No active composition";
        var layers = comp.selectedLayers;
        if (!layers || layers.length < 1) return "ERROR: Select at least 1 layer";

        cols = parseInt(cols, 10); if (isNaN(cols) || cols < 1) cols = 1;
        rows = parseInt(rows, 10); if (isNaN(rows) || rows < 1) rows = 1;
        hPad = parseFloat(hPad);
        vPad = parseFloat(vPad);
        var hPadOverride = !isNaN(hPad);
        var vPadOverride = !isNaN(vPad);

        var cLeft, cTop, cWidth, cHeight;
        if (distMode === 1) {
            var sl = Infinity, st = Infinity, sr = -Infinity, sb = -Infinity;
            for (var i = 0; i < layers.length; i++) {
                var b = getLayerCompBounds(layers[i], comp);
                if (b.left < sl) sl = b.left;  if (b.top  < st) st = b.top;
                if (b.right > sr) sr = b.right; if (b.bottom > sb) sb = b.bottom;
            }
            cLeft = sl; cTop = st; cWidth = sr - sl; cHeight = sb - st;
        } else {
            cLeft = 0; cTop = 0; cWidth = comp.width; cHeight = comp.height;
        }

        app.beginUndoGroup("Grid Distribute");
        var t = comp.time;

        var cells = [];
        for (var i = 0; i < layers.length; i++) {
            var idx = i % (cols * rows);
            cells.push({
                layer:  layers[i],
                bounds: getLayerCompBounds(layers[i], comp),
                col:    idx % cols,
                row:    Math.floor(idx / cols)
            });
        }

        var cellW = 0, cellH = 0, c, r, k;
        for (k = 0; k < cells.length; k++) {
            if (cells[k].bounds.width  > cellW) cellW = cells[k].bounds.width;
            if (cells[k].bounds.height > cellH) cellH = cells[k].bounds.height;
        }

        // Manual Gap overrides space cells by an exact pixel gap, re-centered on the comp/selection, taking precedence per axis.
        var colCX = [], rowCY = [];

        if (hPadOverride) {
            var gridW    = cols * cellW + (cols - 1) * hPad;
            var leftEdge = (cLeft + cWidth / 2) - gridW / 2;
            for (c = 0; c < cols; c++) colCX.push(leftEdge + cellW / 2 + c * (cellW + hPad));
        } else if (alignEdges) {
            for (c = 0; c < cols; c++) {
                colCX.push(cols > 1
                    ? cLeft + cellW / 2 + c * (cWidth  - cellW) / (cols - 1)
                    : cLeft + cWidth  / 2);
            }
        } else {
            var gapX = (cWidth - cols * cellW) / (cols + 1);
            for (c = 0; c < cols; c++) colCX.push(cLeft + gapX * (c + 1) + cellW * c + cellW / 2);
        }

        if (vPadOverride) {
            var gridH   = rows * cellH + (rows - 1) * vPad;
            var topEdge = (cTop + cHeight / 2) - gridH / 2;
            for (r = 0; r < rows; r++) rowCY.push(topEdge + cellH / 2 + r * (cellH + vPad));
        } else if (alignEdges) {
            for (r = 0; r < rows; r++) {
                rowCY.push(rows > 1
                    ? cTop + cellH / 2 + r * (cHeight - cellH) / (rows - 1)
                    : cTop + cHeight / 2);
            }
        } else {
            var gapY = (cHeight - rows * cellH) / (rows + 1);
            for (r = 0; r < rows; r++) rowCY.push(cTop + gapY * (r + 1) + cellH * r + cellH / 2);
        }

        for (k = 0; k < cells.length; k++) {
            var cell = cells[k];
            var pos    = cell.layer.position;
            var posVal = pos.value;
            var is3D   = cell.layer.threeDLayer;
            var newPos = is3D ? [posVal[0], posVal[1], posVal[2]] : [posVal[0], posVal[1]];
            newPos[0] += colCX[cell.col] - (cell.bounds.left + cell.bounds.width  / 2);
            newPos[1] += rowCY[cell.row] - (cell.bounds.top  + cell.bounds.height / 2);
            setPositionAt(pos, newPos, t, is3D);
        }

        app.endUndoGroup();
        return "ok";
    } catch (err) {
        try { app.endUndoGroup(); } catch(e) {}
        return "ERROR: " + err.toString();
    }
}

// ── SIZING ────────────────────────────────────────────────────────────────────
// mode: 0=Horizontal 1=Vertical 2=Both, sizeMode: 0=comp 1=selection 2=keyLayer, crop: 0=Stretch 1=Crop (proportional)

function lineup_sizeMatch(mode, sizeMode, crop, move) {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return "ERROR: No active composition";
        var layers = comp.selectedLayers;
        if (!layers || layers.length === 0) return "ERROR: No layers selected";

        var targetLayers = layers;
        var targetWidth, targetHeight, targetCenterX, targetCenterY;

        if (sizeMode === 0) {
            targetWidth   = comp.width;
            targetHeight  = comp.height;
            targetCenterX = comp.width  / 2;
            targetCenterY = comp.height / 2;
        } else if (sizeMode === 1) {
            var lf = Infinity, tp = Infinity, rt = -Infinity, bt = -Infinity;
            for (var i = 0; i < layers.length; i++) {
                var b = getLayerCompBounds(layers[i], comp);
                if (b.left   < lf) lf = b.left;
                if (b.top    < tp) tp = b.top;
                if (b.right  > rt) rt = b.right;
                if (b.bottom > bt) bt = b.bottom;
            }
            targetWidth   = rt - lf;
            targetHeight  = bt - tp;
            targetCenterX = (lf + rt) / 2;
            targetCenterY = (tp + bt) / 2;
        } else {
            if (layers.length < 2) return "ERROR: Select a key layer first, then the layers to resize";
            var kb = getLayerCompBounds(layers[0], comp);
            targetWidth   = kb.width;
            targetHeight  = kb.height;
            targetCenterX = kb.left + kb.width  / 2;
            targetCenterY = kb.top  + kb.height / 2;
            targetLayers  = layers.slice(1);
        }

        if (!(targetWidth > 0) || !(targetHeight > 0)) return "ERROR: Target has zero size";

        var t = comp.time;
        app.beginUndoGroup("Match Size");
        for (var i = 0; i < targetLayers.length; i++) {
            var layer = targetLayers[i];
            try {
                if (move) {
                    var cb  = getLayerCompBounds(layer, comp);
                    var ccx = cb.left + cb.width  / 2;
                    var ccy = cb.top  + cb.height / 2;
                    shiftPosition(layer.position, targetCenterX - ccx, targetCenterY - ccy, layer.threeDLayer);
                }

                var rect = sourceRectAtTimeSafe(layer, t, false);
                if (!(rect.width > 0) || !(rect.height > 0)) continue;

                var scaleProp = layer.scale;
                var sVal = scaleProp.value;
                var curW = rect.width  * (sVal[0] / 100);
                var curH = rect.height * (sVal[1] / 100);
                if (!(curW > 0) || !(curH > 0)) continue;

                var factorX = targetWidth  / curW;
                var factorY = targetHeight / curH;
                var newScaleX = sVal[0], newScaleY = sVal[1];

                if (mode === 0) {
                    newScaleX = sVal[0] * factorX;
                    if (crop) newScaleY = sVal[1] * factorX;
                } else if (mode === 1) {
                    newScaleY = sVal[1] * factorY;
                    if (crop) newScaleX = sVal[0] * factorY;
                } else {
                    if (crop) {
                        var factor = Math.max(factorX, factorY);
                        newScaleX = sVal[0] * factor;
                        newScaleY = sVal[1] * factor;
                    } else {
                        newScaleX = sVal[0] * factorX;
                        newScaleY = sVal[1] * factorY;
                    }
                }

                if (scaleProp.dimensionsSeparated) {
                    var xs = scaleProp.getSeparationFollower(0);
                    var ys = scaleProp.getSeparationFollower(1);
                    if (xs.numKeys > 0) xs.setValueAtTime(t, newScaleX); else xs.setValue(newScaleX);
                    if (ys.numKeys > 0) ys.setValueAtTime(t, newScaleY); else ys.setValue(newScaleY);
                } else {
                    var newVal = sVal.length > 2 ? [newScaleX, newScaleY, sVal[2]] : [newScaleX, newScaleY];
                    if (scaleProp.numKeys > 0) scaleProp.setValueAtTime(t, newVal); else scaleProp.setValue(newVal);
                }
            } catch (e) {}
        }
        app.endUndoGroup();
        return "ok";
    } catch (err) {
        try { app.endUndoGroup(); } catch(e) {}
        return "ERROR: " + err.toString();
    }
}

// ── ANCHOR POINT ─────────────────────────────────────────────────────────────
// loc: row-major index into an n x n grid (n=3: TL,TC,TR, ML,C,MR, BL,BC,BR — n=5 for the
// scroll-triggered fine grid, see _buildAnchor5x5Grid in main.js). anchorMode: 0=object 1=selection 2=comp

function lineup_anchorMove(loc, anchorMode, ignoreMasks, gridSize) {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem && comp.selectedLayers.length > 0)) return "ERROR: No layers selected";
        var n = gridSize || 3;
        var layers = comp.selectedLayers;

        var labels=["Top Left","Top Center","Top Right","Middle Left","Center","Middle Right","Bottom Left","Bottom Center","Bottom Right"];
        app.beginUndoGroup("Set Anchor: " + (labels[loc] || "Custom"));

        // Pre-compute combined selection bounding box for Selection mode
        var selMinX, selMinY, selMaxX, selMaxY;
        if (anchorMode === 1) {
            selMinX = Infinity; selMinY = Infinity; selMaxX = -Infinity; selMaxY = -Infinity;
            for (var i = 0; i < layers.length; i++) {
                var b = getLayerCompBounds(layers[i], comp);
                if (b.left   < selMinX) selMinX = b.left;
                if (b.top    < selMinY) selMinY = b.top;
                if (b.right  > selMaxX) selMaxX = b.right;
                if (b.bottom > selMaxY) selMaxY = b.bottom;
            }
        }

        for (var i=0; i<layers.length; i++) {
            var layer=layers[i], t=comp.time;
            if (anchorMode === 0) {
                // Object: snap within each layer's own source bounds
                var r=getSourceRect(layer, t, !!ignoreMasks);
                applyAnchorShift(layer, anchorLocToPoint(loc,r.width,r.height,r.left,r.top,n));
            } else if (anchorMode === 1) {
                // Selection: snap to position within combined bounding box of all selected layers
                pasteAnchor(layer, anchorLocToPoint(loc, selMaxX-selMinX, selMaxY-selMinY, selMinX, selMinY, n));
            } else {
                // Composition: snap to comp bounds
                pasteAnchor(layer, anchorLocToPoint(loc,comp.width,comp.height,0,0,n));
            }
        }
        app.endUndoGroup();
        return "ok";
    } catch (err) {
        try { app.endUndoGroup(); } catch(e) {}
        return "ERROR: " + err.toString();
    }
}

function lineup_anchorCopy() {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return "ERROR: No active composition";
        var layers = comp.selectedLayers;
        if (!layers || layers.length === 0) return "ERROR: No layers selected";
        if (layers.length > 1) return "ERROR: Select exactly 1 layer to copy anchor";
        var layer = layers[0];
        var anchorLocal = layer.anchorPoint.value.slice(0);
        var copAnchor   = LST.toComp(layer, anchorLocal);
        _anchorClipboard = { anchor: copAnchor };
        return "[" + Math.round(copAnchor[0]) + ", " + Math.round(copAnchor[1]) + "]";
    } catch (err) {
        return "ERROR: " + err.toString();
    }
}

function lineup_anchorPaste() {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return "ERROR: No active composition";
        var layers = comp.selectedLayers;
        if (!layers || layers.length === 0) return "ERROR: No layers selected";
        var anchor = _anchorClipboard ? _anchorClipboard.anchor : [comp.width/2, comp.height/2];
        app.beginUndoGroup("Paste Anchor");
        for (var i=0; i<layers.length; i++) pasteAnchor(layers[i], anchor);
        _anchorClipboard = null;
        app.endUndoGroup();
        return "ok";
    } catch (err) {
        try { app.endUndoGroup(); } catch(e) {}
        return "ERROR: " + err.toString();
    }
}

function lineup_anchorClear() { _anchorClipboard = null; return "ok"; }

// Single layer: its name plus " Null" (e.g. "Charlie" -> "Charlie Null"). Multiple: the longest name
// prefix they all share, trimmed of a trailing separator (" ", "_", "-", ":", "."), plus " Null" —
// e.g. "Arm_L01"/"Arm_R01" -> "Arm Null" — since that's almost always the meaningful "what is this a
// group of" part; anything too short to be meaningful (or no shared prefix at all, e.g. wholly
// unrelated layer names) falls back to a plain layer count, still suffixed the same way.
function summarizeLayerNames(names) {
    if (names.length === 0) return "Null";
    if (names.length === 1) return names[0] + " Null";
    var prefix = names[0];
    for (var i = 1; i < names.length && prefix.length > 0; i++) {
        var other = names[i], j = 0;
        while (j < prefix.length && j < other.length && prefix.charAt(j) === other.charAt(j)) j++;
        prefix = prefix.substring(0, j);
    }
    prefix = prefix.replace(/[\s_\-:.]+$/, "");
    return (prefix.length >= 2) ? (prefix + " Null") : (names.length + " Layers Null");
}

// Creates an empty shape layer standing in for a null at (x,y), placed just above the topmost of
// `layers`, and reparents all of `layers` onto it — inserting it INTO the existing chain rather than
// replacing it. A real Null Object is its own special layer type tied to the project it was created
// in, which is why it can't be copied into a different project; a ShapeLayer with a Rect path but no
// Fill/Stroke (same technique the Void plugin uses) is just a regular layer, so it copies/pastes
// across projects like anything else while behaving identically for parenting/transforms/expressions.
// The unpainted Rect gives it a real, centered bounding box to grab in the Composition viewport —
// without any geometry at all, AE has nothing to show/drag there, which is what made the very first
// version of this (truly empty, zero content) awkward to move by hand. Marked as a guide layer so it
// still renders nothing despite having geometry, same as a real null, and so this codebase's own
// existing null/guide-layer skip filters elsewhere (e.g. decompose) keep treating it as non-content.
//
// The new layer also adopts whatever the topmost layer was already parented to (layer -> oldParent
// becomes layer -> empty -> oldParent), unless that parent is itself one of the layers being
// reparented, which would create a cyclic parenting relationship AE won't allow — in that case the
// empty is just left unparented. It also takes its tag color from the topmost selected layer, its name
// from the selection (see summarizeLayerNames), and its in/out points from the earliest-in/latest-out
// of the selection, so it spans exactly the combined timeline range of what it's about to parent.
var NULL_STAND_IN_BOUNDS_RATIO = 0.1; // of the comp's shorter dimension, so it stays a square on non-square comps

function createNullInChain(comp, layers, x, y) {
    var nl = comp.layers.addShape();
    nl.guideLayer = true;

    var rootVecs = nl.property("ADBE Root Vectors Group");
    var boundsGroup = rootVecs.addProperty("ADBE Vector Group");
    boundsGroup.name = "Bounds";
    var rect = boundsGroup.property("ADBE Vectors Group").addProperty("ADBE Vector Shape - Rect");
    var boundsSize = Math.min(comp.width, comp.height) * NULL_STAND_IN_BOUNDS_RATIO;
    rect.property("ADBE Vector Rect Size").setValue([boundsSize, boundsSize]);
    rect.property("ADBE Vector Rect Position").setValue([0, 0]); // centered on the layer's own anchor/position — no Fill or Stroke added, so this never renders

    var names = [];
    for (var ni = 0; ni < layers.length; ni++) names.push(layers[ni].name);
    nl.name = summarizeLayerNames(names);
    nl.position.setValue([x, y]);

    if (layers.length > 0) {
        nl.label = layers[0].label; // layers[0] is the topmost-in-stack selected layer (see lineup_createNull's own Object-mode comment)

        var minIn = Infinity, maxOut = -Infinity;
        for (var bi = 0; bi < layers.length; bi++) {
            if (layers[bi].inPoint  < minIn)  minIn  = layers[bi].inPoint;
            if (layers[bi].outPoint > maxOut) maxOut = layers[bi].outPoint;
        }
        if (isFinite(minIn) && isFinite(maxOut) && maxOut > minIn) {
            // Whichever bound is moving OUTWARD from the null's default (full-comp-duration) span has
            // to be set first, else the transient in > out (or out < in) state throws.
            if (maxOut > nl.outPoint) { nl.outPoint = maxOut; nl.inPoint = minIn; }
            else { nl.inPoint = minIn; nl.outPoint = maxOut; }
        }
    }

    var topIdx = 1;
    for (var i = 0; i < layers.length; i++) { if (layers[i].index < topIdx || topIdx === 1) topIdx = layers[i].index; }

    var originalParent = layers.length > 0 ? layers[0].parent : null;
    if (originalParent) {
        for (var oi = 0; oi < layers.length; oi++) {
            if (layers[oi] === originalParent) { originalParent = null; break; }
        }
    }

    nl.moveToBeginning();
    if (topIdx > 1) nl.moveBefore(comp.layer(topIdx));
    if (originalParent) nl.parent = originalParent;
    for (var i = 0; i < layers.length; i++) layers[i].parent = nl;
    return nl;
}

function lineup_createNull(anchorMode) {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return "ERROR: No active composition";
        app.beginUndoGroup("Create Null");
        var layers = comp.selectedLayers;

        var x, y;
        if (_anchorClipboard) {
            x = _anchorClipboard.anchor[0]; y = _anchorClipboard.anchor[1];
        } else if (anchorMode === 0 && layers.length > 0) {
            // Object: center of the (topmost-in-timeline) selected layer's own bounds.
            var b = getLayerCompBounds(layers[0], comp);
            x = (b.left + b.right) / 2; y = (b.top + b.bottom) / 2;
        } else if (anchorMode === 1 && layers.length > 0) {
            // Selection: center of the combined bounding box of all selected layers.
            var minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
            for (var i=0; i<layers.length; i++) {
                var bb = getLayerCompBounds(layers[i], comp);
                if (bb.left   < minX) minX = bb.left;
                if (bb.top    < minY) minY = bb.top;
                if (bb.right  > maxX) maxX = bb.right;
                if (bb.bottom > maxY) maxY = bb.bottom;
            }
            x = (minX + maxX) / 2; y = (minY + maxY) / 2;
        } else {
            x = comp.width/2; y = comp.height/2;
        }

        createNullInChain(comp, layers, x, y);
        app.endUndoGroup();
        return "ok";
    } catch (err) {
        try { app.endUndoGroup(); } catch(e) {}
        return "ERROR: " + err.toString();
    }
}

// Right-click counterpart to lineup_anchorMove: instead of moving each selected layer's own anchor
// point to the clicked grid cell, drops a null at that same comp-space point and parents the
// selection to it — same anchorMode semantics (0=object 1=selection 2=comp), same n x n loc scheme.
function lineup_createNullAtAnchor(loc, gridSize, anchorMode, ignoreMasks) {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return "ERROR: No active composition";
        var layers = comp.selectedLayers;
        if (!layers || layers.length === 0) return "ERROR: No layers selected";

        var n = gridSize || 3;
        var x, y;
        if (anchorMode === 0) {
            // Object: anchor location within the topmost selected layer's own source bounds
            // (source-rect space, same as lineup_anchorMove's Object mode — convert to comp space).
            var layer0 = layers[0];
            var r = getSourceRect(layer0, comp.time, !!ignoreMasks);
            var localPt = anchorLocToPoint(loc, r.width, r.height, r.left, r.top, n);
            var compPt = LST.toComp(layer0, [localPt[0], localPt[1], 0]);
            x = compPt[0]; y = compPt[1];
        } else if (anchorMode === 1) {
            // Selection: anchor location within the combined bounding box of all selected layers.
            var minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
            for (var i=0; i<layers.length; i++) {
                var bb = getLayerCompBounds(layers[i], comp);
                if (bb.left   < minX) minX = bb.left;
                if (bb.top    < minY) minY = bb.top;
                if (bb.right  > maxX) maxX = bb.right;
                if (bb.bottom > maxY) maxY = bb.bottom;
            }
            var pt = anchorLocToPoint(loc, maxX-minX, maxY-minY, minX, minY, n);
            x = pt[0]; y = pt[1];
        } else {
            // Composition: anchor location within the comp bounds.
            var pt2 = anchorLocToPoint(loc, comp.width, comp.height, 0, 0, n);
            x = pt2[0]; y = pt2[1];
        }

        app.beginUndoGroup("Create Null At Anchor");
        createNullInChain(comp, layers, x, y);
        app.endUndoGroup();
        return "ok";
    } catch (err) {
        try { app.endUndoGroup(); } catch(e) {}
        return "ERROR: " + err.toString();
    }
}

// ── EASE COPY ─────────────────────────────────────────────────────────────────

// Resizes a KeyframeEase array to fit a differently-dimensioned target property (else setTemporalEaseAtKey throws).
// Broadcasts a 1-dim source across all target dims, otherwise pads/truncates by repeating the last value.
function adaptEaseDims(arr, dimN) {
    if (!arr || arr.length === 0 || !dimN || arr.length === dimN) return arr;
    var out = [];
    for (var d=0; d<dimN; d++) out.push(arr[d < arr.length ? d : arr.length-1]);
    return out;
}

// Elementwise (v2 - v1), for numbers or per-dimension arrays. Returns null (not 0) when either side is missing, so callers can tell "no delta" from "no change".
function valueDelta(v2, v1) {
    if (v2 === null || v2 === undefined || v1 === null || v1 === undefined) return null;
    if (v2 instanceof Array && v1 instanceof Array) {
        var out = [];
        for (var i=0; i<v2.length; i++) out.push(v2[i] - v1[i]);
        return out;
    }
    if (typeof v2 === "number" && typeof v1 === "number") return v2 - v1;
    return null;
}

// A copied ease's speed is signed to the source's direction of motion; pasted onto a segment moving the opposite way,
// it would ease toward the wrong direction, so per dimension the sign flips when source/target disagree. Influence is unaffected.
function directionalizeEase(easeArr, srcDelta, tgtDelta) {
    if (!easeArr || srcDelta === null || srcDelta === undefined || tgtDelta === null || tgtDelta === undefined) return easeArr;
    var s = (srcDelta instanceof Array) ? srcDelta : [srcDelta];
    var t = (tgtDelta instanceof Array) ? tgtDelta : [tgtDelta];
    var out = [];
    for (var d=0; d<easeArr.length; d++) {
        var sd = s[d < s.length ? d : s.length-1], td = t[d < t.length ? d : t.length-1];
        var flip = sd !== 0 && td !== 0 && ((sd < 0) !== (td < 0));
        out.push(flip ? new KeyframeEase(-easeArr[d].speed, easeArr[d].influence) : easeArr[d]);
    }
    return out;
}

// Order matters: setTemporalEaseAtKey force-promotes both sides to Bezier as a side effect, so it must run FIRST;
// the real interpolation type (possibly Hold/Linear) is (re)applied AFTER to undo that promotion. A null src side
// means "leave the target's current ease/type alone" (ease copy only captures sides bordering another copied keyframe).
function applyPastedEase(prop, keyIdx, src, tInDelta, tOutDelta) {
    var inType  = (src.inType  !== null && src.inType  !== undefined) ? src.inType  : prop.keyInInterpolationType(keyIdx);
    var outType = (src.outType !== null && src.outType !== undefined) ? src.outType : prop.keyOutInterpolationType(keyIdx);

    if (src.inEase || src.outEase) {
        var dimN = 0;
        try { dimN = prop.keyInTemporalEase(keyIdx).length; } catch (e) {}
        var inE  = src.inEase  ? directionalizeEase(adaptEaseDims(src.inEase,  dimN), src.inDelta,  tInDelta)
                                : prop.keyInTemporalEase(keyIdx);
        var outE = src.outEase ? directionalizeEase(adaptEaseDims(src.outEase, dimN), src.outDelta, tOutDelta)
                                : prop.keyOutTemporalEase(keyIdx);
        try { prop.setTemporalEaseAtKey(keyIdx, inE, outE); } catch (e) {}
    }
    prop.setInterpolationTypeAtKey(keyIdx, inType, outType);
}

function pluralize(count, singular, plural) { return count + " " + (count===1 ? singular : (plural || singular + "s")); }

function formatPasteSummary(easings, properties, layers) {
    if (easings === 0) return "No matching keyframe selection to paste onto";
    return pluralize(easings, "easing") + " pasted on " + pluralize(properties, "property", "properties")
        + " on " + pluralize(layers, "layer");
}

function lineup_easeCopy() {
    try {
        var comp = app.project.activeItem;
        if (!(comp instanceof CompItem)) return "ERROR: No active composition";
        var layers = comp.selectedLayers;

        function copyEaseArr(arr) {
            var out=[];
            for (var e=0; e<arr.length; e++) out.push(new KeyframeEase(arr[e].speed, arr[e].influence));
            return out;
        }
        // Only segments *between two copied keyframes* are a real "copied transition" — the first key's in-side and
        // last key's out-side border keyframes outside the copy, so those sides are left uncaptured (null).
        function collectEase(pg, out) {
            for (var i=1; i<=pg.numProperties; i++) {
                var p; try { p=pg.property(i); } catch(e){ continue; }
                if (p.propertyType===PropertyType.PROPERTY) {
                    if (p.numKeys>0 && p.selectedKeys.length>0) {
                        var sel=p.selectedKeys;
                        for (var k=0; k<sel.length; k++) {
                            var ki=sel[k];
                            var captureIn  = (k>0)              || sel.length===1;
                            var captureOut = (k<sel.length-1)   || sel.length===1;
                            var inT=null, outT=null, inE=null, outE=null, inDelta=null, outDelta=null;
                            var val=null; try { val=p.keyValue(ki); } catch(e) {}
                            var time=null; try { time=p.keyTime(ki); } catch(e) {}
                            if (captureIn) {
                                try { inT=p.keyInInterpolationType(ki); } catch(e) {}
                                try { inE=copyEaseArr(p.keyInTemporalEase(ki)); } catch(e) {}
                                if (k>0) { try { inDelta=valueDelta(val, p.keyValue(sel[k-1])); } catch(e) {} }
                            }
                            if (captureOut) {
                                try { outT=p.keyOutInterpolationType(ki); } catch(e) {}
                                try { outE=copyEaseArr(p.keyOutTemporalEase(ki)); } catch(e) {}
                                if (k<sel.length-1) { try { outDelta=valueDelta(p.keyValue(sel[k+1]), val); } catch(e) {} }
                            }
                            out.push({inType:inT, outType:outT, inEase:inE, outEase:outE, value:val, time:time, inDelta:inDelta, outDelta:outDelta});
                        }
                    }
                } else if (p.propertyType===PropertyType.NAMED_GROUP || p.propertyType===PropertyType.INDEXED_GROUP) {
                    collectEase(p, out);
                }
            }
        }

        var template = null, templateLayer = null;
        for (var l=0; l<layers.length; l++) {
            var res=[]; collectEase(layers[l], res);
            if (res.length > 0) { template=res; templateLayer=layers[l]; break; }
        }
        if (!template) return "";

        _easeClipboard     = template;
        _easeClipboardType = template[0].outType;
        _easeClipboardIs3D = !!(templateLayer && templateLayer.threeDLayer);
        var sym = (_easeClipboardType===KeyframeInterpolationType.HOLD)   ? "■"
                : (_easeClipboardType===KeyframeInterpolationType.LINEAR) ? "◆" : "⧗";
        return template.length + " " + sym;
    } catch (err) {
        return "ERROR: " + err.toString();
    }
}

// Grouped per-property (not flattened across the whole layer) so that pasting
// onto several properties at once — e.g. Position + Scale, each with the same
// number of selected keys as the clipboard — applies the template to each
// property independently instead of requiring the layer's total selected-key
// count to match n. Shared by both easePaste and easeValuePaste.
function collectEaseRefGroups(pg, out) {
    for (var i=1; i<=pg.numProperties; i++) {
        var p; try { p=pg.property(i); } catch(e){ continue; }
        if (p.propertyType===PropertyType.PROPERTY) {
            if (p.numKeys>0 && p.selectedKeys.length>0) {
                var sel=p.selectedKeys, grp=[];
                for (var k=0; k<sel.length; k++) grp.push({prop:p, keyIdx:sel[k]});
                out.push(grp);
            }
        } else if (p.propertyType===PropertyType.NAMED_GROUP || p.propertyType===PropertyType.INDEXED_GROUP) {
            collectEaseRefGroups(p, out);
        }
    }
}

// Snapshots each group's keyframe values up front, since re-reading live mid-paste would mix an already-pasted
// neighbor's new value with a not-yet-pasted one's old value and misdetect direction.
function snapshotEaseValues(targets) {
    var vals = [];
    for (var i=0; i<targets.length; i++) {
        try { vals.push(targets[i].prop.keyValue(targets[i].keyIdx)); } catch(e) { vals.push(null); }
    }
    return vals;
}

// The target's pre-paste value deltas bordering targets[t], compared against src's deltas for a direction mismatch (see directionalizeEase).
function targetEaseDeltas(origVals, t, src) {
    var outDelta=null, inDelta=null;
    if (src.outEase && t < origVals.length-1) outDelta = valueDelta(origVals[t+1], origVals[t]);
    if (src.inEase && t > 0) inDelta = valueDelta(origVals[t], origVals[t-1]);
    return { inDelta: inDelta, outDelta: outDelta };
}

function lineup_easePaste() {
    try {
        var comp = app.project.activeItem;
        if (!(comp instanceof CompItem)) return "ERROR: No active composition";
        if (!_easeClipboard) return "ERROR: No easing copied";
        var n=_easeClipboard.length, layers=comp.selectedLayers;

        var easingsPasted=0, propertiesPasted=0, layersPasted=0;
        app.beginUndoGroup("Paste Easing");
        for (var l=0; l<layers.length; l++) {
            var groups=[]; collectEaseRefGroups(layers[l], groups);
            var layerHit=false;
            for (var g=0; g<groups.length; g++) {
                var targets=groups[g];
                if (targets.length !== n) continue;
                var origVals = snapshotEaseValues(targets);
                for (var t=0; t<targets.length; t++) {
                    var ref=targets[t], src=_easeClipboard[t];
                    try {
                        var d = targetEaseDeltas(origVals, t, src);
                        applyPastedEase(ref.prop, ref.keyIdx, src, d.inDelta, d.outDelta);
                        easingsPasted++;
                    } catch(e) {}
                }
                propertiesPasted++;
                layerHit=true;
            }
            if (layerHit) layersPasted++;
        }
        app.endUndoGroup();
        return formatPasteSummary(easingsPasted, propertiesPasted, layersPasted);
    } catch (err) {
        try { app.endUndoGroup(); } catch(e) {}
        return "ERROR: " + err.toString();
    }
}

function lineup_easeClear() { _easeClipboard=null; _easeClipboardType=null; _easeClipboardIs3D=null; return "ok"; }

// ── Ease preview data (live curve/speed graph) ──────────────────────────────
// Plain-object projection of _easeClipboard for the panel to draw from — deliberately not the real KeyframeEase
// instances Paste uses, since the panel has no access to the KeyframeInterpolationType enum to compare against.
function _easeTypeStr(t) {
    if (t === KeyframeInterpolationType.HOLD) return "hold";
    if (t === KeyframeInterpolationType.LINEAR) return "linear";
    return "bezier";
}
function _easeArrToPlain(arr) {
    if (!arr) return null;
    var out = [];
    for (var i = 0; i < arr.length; i++) out.push({ speed: arr[i].speed, influence: arr[i].influence });
    return out;
}
function lineup_easeGetClipboard() {
    if (!_easeClipboard) return "null";
    try {
        var out = [];
        for (var i = 0; i < _easeClipboard.length; i++) {
            var e = _easeClipboard[i];
            out.push({
                time: e.time,
                value: e.value,
                inType: _easeTypeStr(e.inType),
                outType: _easeTypeStr(e.outType),
                inEase: _easeArrToPlain(e.inEase),
                outEase: _easeArrToPlain(e.outEase)
            });
        }
        return JSON.stringify({ keys: out, is3D: !!_easeClipboardIs3D });
    } catch (err) {
        return "null";
    }
}

// ── MARKER CONTROLS ──────────────────────────────────────────────────────────
// Scope follows the same selection-driven convention as Ease Copy: selected layer(s) are
// the read/write target; with nothing selected, the active comp's own markers are used instead.
// Times are stored relative to the source's own start (a layer's inPoint, or 0 for a comp) and
// re-anchored to the target's start on paste, so markers stay meaningful across layers/comps of
// different lengths and positions in time.

function lineup_markerCopy() {
    try {
        var comp = app.project.activeItem;
        if (!(comp instanceof CompItem)) return "ERROR: No active composition";

        var layers = comp.selectedLayers;
        var srcProp = null, anchor = 0, span = 0;

        if (layers.length > 0) {
            for (var i = 0; i < layers.length; i++) {
                var prop = null;
                try { prop = layers[i].marker; } catch (e) {}
                if (prop && prop.numKeys > 0) {
                    srcProp = prop; anchor = layers[i].inPoint;
                    span = layers[i].outPoint - layers[i].inPoint;
                    break;
                }
            }
        } else {
            var compProp = comp.markerProperty;
            if (compProp && compProp.numKeys > 0) { srcProp = compProp; anchor = 0; span = comp.duration; }
        }
        if (!srcProp) return "";

        var out = [];
        for (var k = 1; k <= srcProp.numKeys; k++) {
            var v = srcProp.keyValue(k);
            var entry = {
                relTime: srcProp.keyTime(k) - anchor,
                comment: v.comment, chapter: v.chapter, cuePointName: v.cuePointName,
                duration: v.duration, frameTarget: v.frameTarget, url: v.url,
                label: v.label, protectedRegion: v.protectedRegion
            };
            try { entry.params = v.getParameters(); } catch (e) { entry.params = null; }
            out.push(entry);
        }

        _markerClipboard = out;
        _markerClipboardSpan = span;
        return pluralize(out.length, "marker");
    } catch (err) {
        return "ERROR: " + err.toString();
    }
}

function lineup_markerPaste(append) {
    try {
        var comp = app.project.activeItem;
        if (!(comp instanceof CompItem)) return "ERROR: No active composition";
        if (!_markerClipboard || _markerClipboard.length === 0) return "ERROR: No markers copied";

        var layers = comp.selectedLayers;
        var targets = []; // { prop, anchor }
        if (layers.length > 0) {
            for (var i = 0; i < layers.length; i++) {
                var prop = null;
                try { prop = layers[i].marker; } catch (e) {}
                if (prop) targets.push({ prop: prop, anchor: layers[i].inPoint });
            }
        } else {
            targets.push({ prop: comp.markerProperty, anchor: 0 });
        }
        if (targets.length === 0) return "ERROR: Selected layer(s) don't support markers";

        var pasted = 0;
        app.beginUndoGroup("Paste Markers");
        try {
            for (var t = 0; t < targets.length; t++) {
                var prop = targets[t].prop, anchor = targets[t].anchor;
                if (!append) {
                    for (var k = prop.numKeys; k >= 1; k--) { try { prop.removeKey(k); } catch (e) {} }
                }
                for (var c = 0; c < _markerClipboard.length; c++) {
                    var e = _markerClipboard[c];
                    var mv = new MarkerValue(e.comment || "");
                    try { mv.chapter = e.chapter || ""; } catch (ex) {}
                    try { mv.cuePointName = e.cuePointName || ""; } catch (ex) {}
                    try { mv.duration = e.duration || 0; } catch (ex) {}
                    try { mv.frameTarget = e.frameTarget || ""; } catch (ex) {}
                    try { mv.url = e.url || ""; } catch (ex) {}
                    try { if (e.label !== undefined && e.label !== null) mv.label = e.label; } catch (ex) {}
                    try { mv.protectedRegion = !!e.protectedRegion; } catch (ex) {}
                    try { if (e.params) mv.setParameters(e.params); } catch (ex) {}
                    try { prop.setValueAtTime(Math.max(0, anchor + e.relTime), mv); pasted++; } catch (ex) {}
                }
            }
        } catch (err) {
            app.endUndoGroup();
            return "ERROR: " + err.toString();
        }
        app.endUndoGroup();

        return pluralize(pasted, "marker") + " pasted on " +
            (layers.length > 0 ? pluralize(targets.length, "layer") : "composition");
    } catch (err) {
        try { app.endUndoGroup(); } catch (e2) {}
        return "ERROR: " + err.toString();
    }
}

function lineup_markerClear() { _markerClipboard = null; _markerClipboardSpan = 0; return "ok"; }

// Plain-object projection of _markerClipboard for the panel's live preview strip — params omitted, it's a purely visual readout (comment/label/duration/relTime), not a paste round-trip.
// Also reports the CURRENT paste target (scope/layerCount) fresh on every call — independent of
// the clipboard itself, which describes what was copied, not what Paste would apply it to right
// now. Lets the panel's Paste button show whether it'll land on the comp or on layer(s), and stay
// accurate as the user's Project/Timeline selection changes while the panel's just sitting open.
function lineup_markerGetClipboard() {
    if (!_markerClipboard) return "null";
    try {
        var out = [];
        for (var i = 0; i < _markerClipboard.length; i++) {
            var e = _markerClipboard[i];
            out.push({ relTime: e.relTime, duration: e.duration || 0, comment: e.comment || "", label: e.label || 0 });
        }

        var scope = "comp", layerCount = 0;
        try {
            var comp = app.project.activeItem;
            if (comp instanceof CompItem) {
                layerCount = comp.selectedLayers.length;
                if (layerCount > 0) scope = "layer";
            }
        } catch (e) {}

        return JSON.stringify({ markers: out, span: _markerClipboardSpan || 0, scope: scope, layerCount: layerCount });
    } catch (err) {
        return "null";
    }
}

// AE's own default influence (33.33%) stretched a bit further for a gentler ease.
var LINEUP_BEZIER_DEFAULT_INFLUENCE = 45;

// zeroVelocity=true: speed always 0 (like AE's Easy Ease). Otherwise: speed is the average of incoming/outgoing velocity
// (0 if they disagree in sign — a peak/valley). Spatial properties get exactly ONE KeyframeEase (magnitude of velocity,
// always non-negative) since AE's spatial temporal ease is a single along-path scalar; non-spatial gets one signed speed per dimension.
function _lineup_bezierDefaultEase(prop, k, isSpatial, zeroVelocity) {
    if (zeroVelocity) {
        if (isSpatial) return [new KeyframeEase(0, LINEUP_BEZIER_DEFAULT_INFLUENCE)];
        var val0 = prop.keyValue(k);
        var dims0 = (val0 instanceof Array) ? val0.length : 1;
        var arr0 = [];
        for (var d0 = 0; d0 < dims0; d0++) arr0.push(new KeyframeEase(0, LINEUP_BEZIER_DEFAULT_INFLUENCE));
        return arr0;
    }

    var hasPrev = k > 1, hasNext = k < prop.numKeys;
    var thisVal = prop.keyValue(k), thisTime = prop.keyTime(k);
    var prevVal, prevTime, nextVal, nextTime;
    if (hasPrev) { prevVal = prop.keyValue(k - 1); prevTime = prop.keyTime(k - 1); }
    if (hasNext) { nextVal = prop.keyValue(k + 1); nextTime = prop.keyTime(k + 1); }
    var valDims = (thisVal instanceof Array) ? thisVal.length : 1;

    if (isSpatial) {
        var inMag = null, outMag = null;
        if (hasPrev) {
            var dtIn0 = thisTime - prevTime;
            if (dtIn0 !== 0) {
                var sumSqIn = 0;
                for (var di = 0; di < valDims; di++) {
                    var tvi = (valDims > 1) ? thisVal[di] : thisVal;
                    var pvi = (valDims > 1) ? prevVal[di] : prevVal;
                    var dvi = (tvi - pvi) / dtIn0;
                    sumSqIn += dvi * dvi;
                }
                inMag = Math.sqrt(sumSqIn);
            }
        }
        if (hasNext) {
            var dtOut0 = nextTime - thisTime;
            if (dtOut0 !== 0) {
                var sumSqOut = 0;
                for (var doi = 0; doi < valDims; doi++) {
                    var tvo = (valDims > 1) ? thisVal[doi] : thisVal;
                    var nvo = (valDims > 1) ? nextVal[doi] : nextVal;
                    var dvo = (nvo - tvo) / dtOut0;
                    sumSqOut += dvo * dvo;
                }
                outMag = Math.sqrt(sumSqOut);
            }
        }
        var magSpeed;
        if (inMag !== null && outMag !== null) magSpeed = (inMag + outMag) / 2;
        else if (inMag !== null) magSpeed = inMag;
        else if (outMag !== null) magSpeed = outMag;
        else magSpeed = 0;
        return [new KeyframeEase(magSpeed, LINEUP_BEZIER_DEFAULT_INFLUENCE)];
    }

    var arr = [];
    for (var d = 0; d < valDims; d++) {
        var tv = (valDims > 1) ? thisVal[d] : thisVal;
        var inVel = null, outVel = null;
        if (hasPrev) {
            var pv = (valDims > 1) ? prevVal[d] : prevVal;
            var dtIn = thisTime - prevTime;
            if (dtIn !== 0) inVel = (tv - pv) / dtIn;
        }
        if (hasNext) {
            var nv = (valDims > 1) ? nextVal[d] : nextVal;
            var dtOut = nextTime - thisTime;
            if (dtOut !== 0) outVel = (nv - tv) / dtOut;
        }
        var speed;
        if (inVel !== null && outVel !== null) {
            if (inVel !== 0 && outVel !== 0 && (inVel < 0) !== (outVel < 0)) speed = 0;
            else speed = (inVel + outVel) / 2;
        }
        else if (inVel !== null) speed = inVel;
        else if (outVel !== null) speed = outVel;
        else speed = 0;
        arr.push(new KeyframeEase(speed, LINEUP_BEZIER_DEFAULT_INFLUENCE));
    }
    return arr;
}

// Backs the quick-swap interpolation buttons for every selected keyframe. kind: "hold"/"linear"/"bezier"/"autobezier"/"continuousbezier"
// (Auto/Continuous are real Bezier plus a flag). setTemporalEaseAtKey must run BEFORE setInterpolationTypeAtKey, since it
// force-promotes both sides to Bezier as a side effect — same ordering issue as applyPastedEase above.
var LINEUP_INTERP_LABELS = { hold: "Hold", linear: "Linear", bezier: "Bezier", autobezier: "Auto Bezier", continuousbezier: "Continuous Bezier" };
function lineup_setKeyframeInterpolation(kind, zeroVelocity) {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return "";
        var groups = lineup_collectSelectedKeyGroups(comp);
        if (!groups.length) return "No keyframes selected.";

        app.beginUndoGroup("Set Keyframe Interpolation");
        var count = 0;
        for (var g = 0; g < groups.length; g++) {
            var prop = groups[g].prop, indices = groups[g].indices;
            for (var i = 0; i < indices.length; i++) {
                var k = indices[i];
                try {
                    if (kind === "hold") {
                        prop.setInterpolationTypeAtKey(k, KeyframeInterpolationType.HOLD, KeyframeInterpolationType.HOLD);
                    } else if (kind === "linear") {
                        prop.setInterpolationTypeAtKey(k, KeyframeInterpolationType.LINEAR, KeyframeInterpolationType.LINEAR);
                    } else if (kind === "autobezier") {
                        // Auto-Bezier computes its own ease once the flag is on — no ease to set by hand, ordering doesn't matter.
                        prop.setInterpolationTypeAtKey(k, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
                        try { prop.setTemporalAutoBezierAtKey(k, true); } catch (e2) {}
                    } else if (kind === "continuousbezier") {
                        // Re-applied again after setTemporalContinuousAtKey, since turning Continuous on triggers AE's own ease recompute that can overwrite a genuine 0 velocity.
                        var ne3 = null, isSpatial3 = false;
                        try {
                            try { isSpatial3 = prop.isSpatial; } catch (eSp3) {}
                            ne3 = _lineup_bezierDefaultEase(prop, k, isSpatial3, zeroVelocity);
                            prop.setTemporalEaseAtKey(k, ne3, ne3);
                        } catch (e2) {}
                        prop.setInterpolationTypeAtKey(k, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
                        try { prop.setTemporalAutoBezierAtKey(k, false); } catch (e2) {}
                        try { prop.setTemporalContinuousAtKey(k, true); } catch (e2) {}
                        if (ne3) { try { prop.setTemporalEaseAtKey(k, ne3, ne3); } catch (e2) {} }
                    } else { // plain "bezier"
                        try {
                            var isSpatial = false;
                            try { isSpatial = prop.isSpatial; } catch (eSp) {}
                            var ne = _lineup_bezierDefaultEase(prop, k, isSpatial, zeroVelocity);
                            prop.setTemporalEaseAtKey(k, ne, ne);
                        } catch (e2) {}
                        prop.setInterpolationTypeAtKey(k, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
                        try { prop.setTemporalAutoBezierAtKey(k, false); } catch (e2) {}
                        try { prop.setTemporalContinuousAtKey(k, false); } catch (e2) {}
                    }
                    count++;
                } catch (e) {}
            }
        }
        app.endUndoGroup();
        if (!count) return "Couldn't set interpolation on the selected keyframes.";
        return "Set " + count + " keyframe" + (count === 1 ? "" : "s") + " to " + (LINEUP_INTERP_LABELS[kind] || kind) + ".";
    } catch (err) {
        try { app.endUndoGroup(); } catch (e) {}
        return "ERROR: " + err.toString();
    }
}

// ── AUTO CROP ─────────────────────────────────────────────────────────────────

function saveMaskShapes(layer) {
    var saved = [];
    var mp;
    try { mp = layer.property("ADBE Mask Parade"); } catch(e) { return saved; }
    if (!mp || mp.numProperties === 0) return saved;
    for (var mi = 1; mi <= mp.numProperties; mi++) {
        try {
            var sp = mp.property(mi).property("ADBE Mask Shape");
            var entry = { prop: sp, keys: [] };
            if (sp.numKeys > 0) {
                for (var k = 1; k <= sp.numKeys; k++)
                    entry.keys.push({ index: k, shape: sp.keyValue(k) });
            } else {
                entry.keys.push({ index: 0, shape: sp.value });
            }
            saved.push(entry);
        } catch(e) {}
    }
    return saved;
}

function restoreMaskShapes(saved, dx, dy) {
    for (var mi = 0; mi < saved.length; mi++) {
        var entry = saved[mi];
        for (var ki = 0; ki < entry.keys.length; ki++) {
            try {
                var sh = entry.keys[ki].shape;
                var nv = [];
                for (var v = 0; v < sh.vertices.length; v++)
                    nv.push([sh.vertices[v][0] + dx, sh.vertices[v][1] + dy]);
                sh.vertices = nv;
                if (entry.keys[ki].index === 0) {
                    entry.prop.setValue(sh);
                } else {
                    entry.prop.setValueAtKey(entry.keys[ki].index, sh);
                }
            } catch(e) {}
        }
    }
}

function applyCropBounds(precompLayer, minX, minY, maxX, maxY, padding, expandBeyond, compensateMasks) {
    var innerComp = precompLayer.source;
    var padMinX = minX - padding, padMinY = minY - padding;
    var padMaxX = maxX + padding, padMaxY = maxY + padding;
    if (!expandBeyond) {
        padMinX = Math.max(0, padMinX); padMinY = Math.max(0, padMinY);
        padMaxX = Math.min(innerComp.width, padMaxX); padMaxY = Math.min(innerComp.height, padMaxY);
    }
    var cropL = Math.floor(padMinX), cropT = Math.floor(padMinY);
    var cropW = Math.ceil(padMaxX) - cropL, cropH = Math.ceil(padMaxY) - cropT;
    if (cropW < 1) cropW = 1;
    if (cropH < 1) cropH = 1;
    if (cropL === 0 && cropT === 0 && cropW === innerComp.width && cropH === innerComp.height) return;

    var anchorBefore = precompLayer.anchorPoint.value.slice(0);
    var savedMasks = compensateMasks ? saveMaskShapes(precompLayer) : [];

    for (var i = 1; i <= innerComp.numLayers; i++) {
        var layer = innerComp.layer(i);
        if (layer.parent !== null) continue;
        try { shiftPosition(layer.position, -cropL, -cropT, layer.threeDLayer); } catch(e) {}
    }

    innerComp.width = cropW;
    innerComp.height = cropH;

    // AE auto-rescales outer-layer masks on resize — restore from pre-resize snapshot.
    if (compensateMasks) restoreMaskShapes(savedMasks, -cropL, -cropT);

    try {
        var anchorProp = precompLayer.anchorPoint;
        if (anchorProp.numKeys > 0) {
            for (var k = 1; k <= anchorProp.numKeys; k++) {
                var av = anchorProp.keyValue(k);
                var na = [av[0] - cropL, av[1] - cropT];
                if (av.length > 2) na.push(av[2]);
                anchorProp.setValueAtKey(k, na);
            }
        } else {
            anchorProp.setValue([anchorBefore[0] - cropL, anchorBefore[1] - cropT]);
        }
    } catch(e) {}
}

function lineup_autoCrop(padding, expandBeyond) {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return "ERROR: No active composition";
        var layers = comp.selectedLayers;
        if (!layers || layers.length === 0) return "ERROR: No layers selected";
        for (var i = 0; i < layers.length; i++) {
            if (!(layers[i].source && layers[i].source instanceof CompItem))
                return "ERROR: \"" + layers[i].name + "\" is not a precomp";
        }
        var processed = [];
        app.beginUndoGroup("Auto Crop");
        for (var i = 0; i < layers.length; i++) {
            var src = layers[i].source, done = false;
            for (var j = 0; j < processed.length; j++) { if (processed[j] === src) { done = true; break; } }
            if (done) continue;
            var innerComp = src, t = innerComp.time;
            var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, found = false;
            for (var li = 1; li <= innerComp.numLayers; li++) {
                var layer = innerComp.layer(li);
                try { if (layer instanceof CameraLayer || layer instanceof LightLayer) continue; } catch(e) {}
                try { if (layer.nullLayer || layer.adjustmentLayer || layer.guideLayer) continue; } catch(e) {}
                if (!layer.enabled || t < layer.inPoint || t >= layer.outPoint) continue;
                try {
                    var rect = getLayerCompBounds(layer, innerComp);
                    if (!rect) continue;
                    if (rect.left < minX) minX = rect.left; if (rect.top < minY) minY = rect.top;
                    if (rect.right > maxX) maxX = rect.right; if (rect.bottom > maxY) maxY = rect.bottom;
                    found = true;
                } catch(e) {}
            }
            if (!found) { app.endUndoGroup(); return "ERROR: No visible content in \"" + innerComp.name + "\" at current time"; }
            applyCropBounds(layers[i], minX, minY, maxX, maxY, padding || 0, expandBeyond || false, true);
            processed.push(src);
        }
        app.endUndoGroup();
        return "ok";
    } catch (err) {
        try { app.endUndoGroup(); } catch(e) {}
        return "ERROR: " + err.toString();
    }
}

function lineup_maskCrop(padding, expandBeyond) {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return "ERROR: No active composition";
        var layers = comp.selectedLayers;
        if (!layers || layers.length === 0) return "ERROR: No layers selected";
        for (var i = 0; i < layers.length; i++) {
            if (!(layers[i].source && layers[i].source instanceof CompItem))
                return "ERROR: \"" + layers[i].name + "\" is not a precomp";
        }
        var processed = [];
        app.beginUndoGroup("Mask Crop");
        for (var i = 0; i < layers.length; i++) {
            var src = layers[i].source, done = false;
            for (var j = 0; j < processed.length; j++) { if (processed[j] === src) { done = true; break; } }
            if (done) continue;
            var maskProp;
            try { maskProp = layers[i].property("ADBE Mask Parade"); } catch(e) {}
            if (!maskProp || maskProp.numProperties === 0) { app.endUndoGroup(); return "ERROR: No masks on \"" + layers[i].name + "\""; }
            var targetMask = null;
            for (var mi = 1; mi <= maskProp.numProperties; mi++) {
                try { var m = maskProp.property(mi); if (m.enabled && m.maskMode === MaskMode.ADD) { targetMask = m; break; } } catch(e) {}
            }
            if (!targetMask) { app.endUndoGroup(); return "ERROR: No enabled Add mask on \"" + layers[i].name + "\""; }
            var shape = targetMask.property("ADBE Mask Shape").valueAtTime(comp.time, false);
            var verts = shape.vertices, inT = shape.inTangents, outT = shape.outTangents;
            if (!verts || verts.length === 0) { app.endUndoGroup(); return "ERROR: Mask on \"" + layers[i].name + "\" has no vertices"; }
            var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (var v = 0; v < verts.length; v++) {
                var vx = verts[v][0], vy = verts[v][1];
                if (vx < minX) minX = vx; if (vy < minY) minY = vy;
                if (vx > maxX) maxX = vx; if (vy > maxY) maxY = vy;
                if (outT && outT[v]) { var ox=vx+outT[v][0],oy=vy+outT[v][1]; if(ox<minX)minX=ox;if(oy<minY)minY=oy;if(ox>maxX)maxX=ox;if(oy>maxY)maxY=oy; }
                if (inT  && inT[v])  { var ix=vx+inT[v][0], iy=vy+inT[v][1]; if(ix<minX)minX=ix;if(iy<minY)minY=iy;if(ix>maxX)maxX=ix;if(iy>maxY)maxY=iy; }
            }
            applyCropBounds(layers[i], minX, minY, maxX, maxY, padding || 0, expandBeyond || false, true);
            try { targetMask.remove(); } catch(e) {}
            processed.push(src);
        }
        app.endUndoGroup();
        return "ok";
    } catch (err) {
        try { app.endUndoGroup(); } catch(e) {}
        return "ERROR: " + err.toString();
    }
}

function lineup_cropMaxArea(padding, expandBeyond) {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return "ERROR: No active composition";
        var layers = comp.selectedLayers;
        if (!layers || layers.length === 0) return "ERROR: No layers selected";
        for (var i = 0; i < layers.length; i++) {
            if (!(layers[i].source && layers[i].source instanceof CompItem))
                return "ERROR: \"" + layers[i].name + "\" is not a precomp";
        }
        var processed = [];
        app.beginUndoGroup("Crop Max Area");
        for (var i = 0; i < layers.length; i++) {
            var src = layers[i].source, done = false;
            for (var j = 0; j < processed.length; j++) { if (processed[j] === src) { done = true; break; } }
            if (done) continue;

            var innerComp = src, origTime = innerComp.time;
            var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, found = false;

            for (var li = 1; li <= innerComp.numLayers; li++) {
                var layer = innerComp.layer(li);
                try { if (layer instanceof CameraLayer || layer instanceof LightLayer) continue; } catch(e) {}
                try { if (layer.nullLayer || layer.adjustmentLayer || layer.guideLayer) continue; } catch(e) {}
                if (!layer.enabled) continue;

                var tProps = [];
                try {
                    var pos = layer.position;
                    if (pos.dimensionsSeparated) {
                        var dims = layer.threeDLayer ? 3 : 2;
                        for (var d = 0; d < dims; d++) tProps.push(pos.getSeparationFollower(d));
                    } else { tProps.push(pos); }
                } catch(e) {}
                try { tProps.push(layer.anchorPoint); } catch(e) {}
                try { tProps.push(layer.scale);       } catch(e) {}
                try { tProps.push(layer.rotation);    } catch(e) {}
                if (layer.threeDLayer) {
                    try { tProps.push(layer.orientation); } catch(e) {}
                    try { tProps.push(layer.xRotation);   } catch(e) {}
                    try { tProps.push(layer.yRotation);   } catch(e) {}
                }

                for (var pi = 0; pi < tProps.length; pi++) {
                    try {
                        if (tProps[pi].expressionEnabled) {
                            innerComp.time = origTime;
                            app.endUndoGroup();
                            return "ERROR: \"" + layer.name + "\" has an expression on a transform — max area crop cannot be calculated";
                        }
                    } catch(e) {}
                }

                var seenTimes = {}, timesArr = [];
                var tKey, tVal;
                tVal = layer.inPoint;
                if (tVal >= layer.inPoint && tVal < layer.outPoint) {
                    tKey = Math.round(tVal * 10000) + "";
                    if (!seenTimes[tKey]) { seenTimes[tKey] = true; timesArr.push(tVal); }
                }
                for (var pi = 0; pi < tProps.length; pi++) {
                    try {
                        var tp = tProps[pi];
                        for (var k = 1; k <= tp.numKeys; k++) {
                            tVal = tp.keyTime(k);
                            if (tVal >= layer.inPoint && tVal < layer.outPoint) {
                                tKey = Math.round(tVal * 10000) + "";
                                if (!seenTimes[tKey]) { seenTimes[tKey] = true; timesArr.push(tVal); }
                            }
                        }
                    } catch(e) {}
                }

                timesArr.sort(function(a, b) { return a - b; });
                var withMids = timesArr.slice();
                for (var ti = 0; ti < timesArr.length - 1; ti++)
                    withMids.push((timesArr[ti] + timesArr[ti + 1]) / 2);
                withMids.sort(function(a, b) { return a - b; });

                for (var ti = 0; ti < withMids.length; ti++) {
                    var st = withMids[ti];
                    if (st < layer.inPoint || st >= layer.outPoint) continue;
                    try {
                        innerComp.time = st;
                        var rect = getLayerCompBounds(layer, innerComp);
                        if (!rect) continue;
                        if (rect.left < minX) minX = rect.left; if (rect.top < minY) minY = rect.top;
                        if (rect.right > maxX) maxX = rect.right; if (rect.bottom > maxY) maxY = rect.bottom;
                        found = true;
                    } catch(e) {}
                }
            }

            innerComp.time = origTime;
            if (!found) { app.endUndoGroup(); return "ERROR: No visible content in \"" + innerComp.name + "\""; }
            applyCropBounds(layers[i], minX, minY, maxX, maxY, padding || 0, expandBeyond || false, true);
            processed.push(src);
        }
        app.endUndoGroup();
        return "ok";
    } catch (err) {
        try { app.endUndoGroup(); } catch(e) {}
        return "ERROR: " + err.toString();
    }
}

// ── DECOMPOSE ─────────────────────────────────────────────────────────────────

function lineup_decompose() {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return "ERROR: No active composition";
        var layers = comp.selectedLayers;
        if (!layers || layers.length === 0) return "ERROR: Select one or more precomp layers to decompose";
        for (var i = 0; i < layers.length; i++) {
            if (!(layers[i].source && layers[i].source instanceof CompItem))
                return "ERROR: \"" + layers[i].name + "\" is not a precomp — select only precomp layers";
        }

        function copyTransformProp(src, dst) {
            try {
                if (src.expressionEnabled && src.expression !== "") {
                    try { dst.expression = src.expression; } catch(e) {}
                    return;
                }
                if (src.numKeys === 0) { dst.setValue(src.value); return; }
                for (var k = 1; k <= src.numKeys; k++) {
                    var t = src.keyTime(k), v = src.keyValue(k);
                    var ki = src.keyInInterpolationType(k), ko = src.keyOutInterpolationType(k);
                    var idx = dst.addKey(t);
                    dst.setValueAtKey(idx, v);
                    dst.setInterpolationTypeAtKey(idx, ki, ko);
                    try { dst.setTemporalEaseAtKey(idx, src.keyInTemporalEase(k), src.keyOutTemporalEase(k)); } catch(e) {}
                    try { if (src.isSpatial) dst.setSpatialTangentsAtKey(idx, src.keyInSpatialTangent(k), src.keyOutSpatialTangent(k)); } catch(e) {}
                }
            } catch(e) {}
        }

        function decomposePrecomp(precompLayer, outerComp) {
            var innerComp = precompLayer.source;
            var innerW = innerComp.width, innerH = innerComp.height;
            var is3D = precompLayer.threeDLayer;
            var innerLayerCount = innerComp.numLayers;

            var infos = [];
            for (var j = 1; j <= innerLayerCount; j++) {
                var il = innerComp.layer(j);
                infos.push({ innerIdx: j, parentIdx: il.parent ? il.parent.index : 0 });
            }

            var layerMap = {};
            for (var j = innerLayerCount; j >= 1; j--) {
                innerComp.layer(j).copyToComp(outerComp);
                layerMap[j] = outerComp.layer(1);
            }

            var shapeLayer = outerComp.layers.addShape();
            shapeLayer.name = precompLayer.name;
            shapeLayer.label = precompLayer.label;
            shapeLayer.threeDLayer = is3D;
            shapeLayer.inPoint = precompLayer.inPoint;
            shapeLayer.outPoint = precompLayer.outPoint;
            shapeLayer.startTime = precompLayer.startTime;
            shapeLayer.blendingMode = precompLayer.blendingMode;

            var rootVecs = shapeLayer.property("ADBE Root Vectors Group");
            var grp = rootVecs.addProperty("ADBE Vector Group");
            grp.name = "Bounds";
            var gc = grp.property("ADBE Vectors Group");
            var rect = gc.addProperty("ADBE Vector Shape - Rect");
            rect.property("ADBE Vector Rect Size").setValue([innerW, innerH]);
            rect.property("ADBE Vector Rect Position").setValue([innerW / 2, innerH / 2]);
            var rectFill = gc.addProperty("ADBE Vector Graphic - Fill");
            rectFill.property("ADBE Vector Fill Opacity").setValue(0);

            var pt = precompLayer.transform, st = shapeLayer.transform;
            st.anchorPoint.setValue(pt.anchorPoint.value);
            st.position.setValue(pt.position.value);
            st.scale.setValue(pt.scale.value);
            st.rotation.setValue(pt.rotation.value);
            st.opacity.setValue(pt.opacity.value);
            if (is3D) {
                try { st.xRotation.setValue(pt.xRotation.value); } catch(e) {}
                try { st.yRotation.setValue(pt.yRotation.value); } catch(e) {}
                try { st.zRotation.setValue(pt.zRotation.value); } catch(e) {}
                try { st.orientation.setValue(pt.orientation.value); } catch(e) {}
            }

            shapeLayer.guideLayer = true;

            function snapProp(p) {
                if (p.expressionEnabled && p.expression) return { expr: p.expression };
                if (p.numKeys > 0) {
                    var ks = [];
                    for (var k = 1; k <= p.numKeys; k++)
                        ks.push({ t: p.keyTime(k), v: p.keyValue(k),
                                  ki: p.keyInInterpolationType(k), ko: p.keyOutInterpolationType(k) });
                    return { keys: ks };
                }
                var v = p.value;
                return { value: (v && v.slice) ? v.slice(0) : v };
            }
            function restoreSnap(p, d) {
                try {
                    if (d.expr !== undefined) { p.expression = d.expr; p.expressionEnabled = true; return; }
                    while (p.numKeys > 0) p.removeKey(1);
                    if (d.keys) {
                        for (var k = 0; k < d.keys.length; k++) {
                            var kd = d.keys[k], idx = p.addKey(kd.t);
                            p.setValueAtKey(idx, kd.v);
                            p.setInterpolationTypeAtKey(idx, kd.ki, kd.ko);
                        }
                    } else { p.setValue(d.value); }
                } catch(e) {}
            }

            var posSnaps = [];
            for (var j = 0; j < infos.length; j++) {
                var sl2 = layerMap[infos[j].innerIdx], sp = sl2.position;
                var sn = { sep: sp.dimensionsSeparated };
                if (sn.sep) {
                    sn.x = snapProp(sp.getSeparationFollower(0));
                    sn.y = snapProp(sp.getSeparationFollower(1));
                    try { if (sl2.threeDLayer) sn.z = snapProp(sp.getSeparationFollower(2)); } catch(e) {}
                } else {
                    sn.data = snapProp(sp);
                }
                posSnaps.push(sn);
            }

            for (var j = 0; j < infos.length; j++) {
                if (infos[j].parentIdx !== 0 && layerMap[infos[j].parentIdx])
                    layerMap[infos[j].innerIdx].parent = layerMap[infos[j].parentIdx];
            }
            for (var j = 0; j < infos.length; j++) {
                if (infos[j].parentIdx === 0)
                    layerMap[infos[j].innerIdx].parent = shapeLayer;
            }

            for (var j = 0; j < posSnaps.length; j++) {
                var rl2 = layerMap[infos[j].innerIdx], rp = rl2.position, rs = posSnaps[j];
                if (rs.sep && rp.dimensionsSeparated) {
                    restoreSnap(rp.getSeparationFollower(0), rs.x);
                    restoreSnap(rp.getSeparationFollower(1), rs.y);
                    try { if (rs.z) restoreSnap(rp.getSeparationFollower(2), rs.z); } catch(e) {}
                } else if (!rs.sep && !rp.dimensionsSeparated) {
                    restoreSnap(rp, rs.data);
                }
            }

            copyTransformProp(pt.anchorPoint, st.anchorPoint);
            copyTransformProp(pt.position,    st.position);
            copyTransformProp(pt.scale,       st.scale);
            copyTransformProp(pt.rotation,    st.rotation);
            copyTransformProp(pt.opacity,     st.opacity);
            if (is3D) {
                try { copyTransformProp(pt.xRotation,   st.xRotation);   } catch(e) {}
                try { copyTransformProp(pt.yRotation,   st.yRotation);   } catch(e) {}
                try { copyTransformProp(pt.zRotation,   st.zRotation);   } catch(e) {}
                try { copyTransformProp(pt.orientation, st.orientation); } catch(e) {}
            }

            try {
                var srcFx = precompLayer.property("ADBE Effect Parade");
                if (srcFx && srcFx.numProperties > 0) {
                    var dstFx = shapeLayer.property("ADBE Effect Parade");
                    for (var ei = 1; ei <= srcFx.numProperties; ei++) {
                        try {
                            var fx = srcFx.property(ei);
                            if (fx.matchName !== "ADBE Geometry2") continue;
                            var newFx = dstFx.addProperty("ADBE Geometry2");
                            if (!newFx) continue;
                            newFx.name = fx.name;
                            for (var pi = 1; pi <= fx.numProperties; pi++) {
                                try { copyTransformProp(fx.property(pi), newFx.property(pi)); } catch(e) {}
                            }
                        } catch(e) {}
                    }
                }
            } catch(e) {}

            precompLayer.remove();
        }

        // Process highest index first so lower indices remain stable
        var sorted = [];
        for (var i = 0; i < layers.length; i++) sorted.push(layers[i]);
        sorted.sort(function(a, b) { return b.index - a.index; });

        app.beginUndoGroup("Decompose Precomp");
        for (var i = 0; i < sorted.length; i++) {
            decomposePrecomp(sorted[i], comp);
        }
        app.endUndoGroup();
        return "ok";
    } catch (err) {
        try { app.endUndoGroup(); } catch(e) {}
        return "ERROR: " + err.toString();
    }
}

// ── DUPLICATE COMP (DEEP) ─────────────────────────────────────────────────────
// Recursively duplicates a comp and every nested precomp inside it (versioned names, shared dedup); operates on selected precomp layers or Project panel selection.

function lineup_duplicateCompDeep() {
    try {
        var proj = app.project;

        function nameExists(name) {
            for (var i = 1; i <= proj.numItems; i++) {
                try { if (proj.item(i).name === name) return true; } catch(e) {}
            }
            return false;
        }

        function versionedName(baseName) {
            var m = baseName.match(/^(.*)_(\d+)$/);
            var base = m ? m[1] : baseName;
            var n = m ? parseInt(m[2], 10) + 1 : 2;
            var candidate;
            do { candidate = base + "_" + n; n++; } while (nameExists(candidate));
            return candidate;
        }

        function deepDup(comp, cloneMap) {
            if (cloneMap[comp.id]) return cloneMap[comp.id];
            var dup = comp.duplicate();
            dup.name = versionedName(comp.name);
            try { dup.parentFolder = comp.parentFolder; } catch(e) {}
            cloneMap[comp.id] = dup;
            for (var li = 1; li <= dup.numLayers; li++) {
                var layer = dup.layer(li);
                if (!(layer instanceof AVLayer)) continue;
                var src = layer.source;
                if (src && src instanceof CompItem) {
                    var newSrc = deepDup(src, cloneMap);
                    if (newSrc !== src) layer.replaceSource(newSrc, false);
                }
            }
            return dup;
        }

        var activeComp = proj.activeItem;
        var precompLayers = [];
        if (activeComp && activeComp instanceof CompItem) {
            var sel = activeComp.selectedLayers;
            for (var i = 0; i < sel.length; i++) {
                if (sel[i] instanceof AVLayer && sel[i].source && sel[i].source instanceof CompItem)
                    precompLayers.push(sel[i]);
            }
        }

        var messages = [];

        if (precompLayers.length > 0) {
            app.beginUndoGroup("Duplicate Comp (Deep)");
            for (var i = 0; i < precompLayers.length; i++) {
                var cloneMap = {};
                var origName = precompLayers[i].source.name;
                var newTop = deepDup(precompLayers[i].source, cloneMap);
                precompLayers[i].replaceSource(newTop, false);
                messages.push('"' + origName + '" -> "' + newTop.name + '"');
            }
            app.endUndoGroup();
        } else {
            var roots = [];
            for (var i = 0; i < proj.selection.length; i++) {
                if (proj.selection[i] instanceof CompItem) roots.push(proj.selection[i]);
            }
            if (roots.length === 0)
                return "ERROR: Select a precomp layer in the timeline, or select one or more comps in the Project panel.";

            app.beginUndoGroup("Duplicate Comp (Deep)");
            for (var i = 0; i < roots.length; i++) {
                var cloneMap = {};
                var newTop = deepDup(roots[i], cloneMap);
                messages.push('"' + roots[i].name + '" -> "' + newTop.name + '"');
            }
            app.endUndoGroup();
        }

        return "Duplicated " + messages.join(", ");
    } catch (err) {
        try { app.endUndoGroup(); } catch(e) {}
        return "ERROR: " + err.toString();
    }
}

// ── ORGANIZE PROJECT ──────────────────────────────────────────────────────────

function lineup_organizeProject() {
    try {
        var proj = app.project;

        function propSig(prop) {
            function vStr(v) {
                if (typeof v === 'number') return "" + Math.round(v * 1000);
                var s = "";
                for (var i = 0; i < v.length; i++) { if (i) s += ","; s += Math.round(v[i] * 1000); }
                return s;
            }
            try {
                if (prop.dimensionsSeparated) {
                    var sig = "sep:";
                    for (var d = 0; d <= 2; d++) {
                        try { sig += propSig(prop.getSeparationFollower(d)) + "|"; } catch(e) { break; }
                    }
                    return sig;
                }
                if (prop.numKeys === 0) return "=" + vStr(prop.value);
                var s = "";
                for (var k = 1; k <= prop.numKeys; k++) {
                    s += Math.round(prop.keyTime(k) * 10000) + ":" + vStr(prop.keyValue(k)) + ";";
                }
                return s;
            } catch(e) { return "?"; }
        }

        function fingerprint(comp) {
            var s = comp.name + "|" + comp.width + "|" + comp.height + "|" +
                    Math.round(comp.frameRate * 1000) + "|" +
                    Math.round(comp.duration * 10000) + "|" +
                    comp.numLayers;
            for (var i = 1; i <= comp.numLayers; i++) {
                try {
                    var layer = comp.layer(i);
                    var src = layer.source ? layer.source.name : ("@" + layer.matchName);
                    s += "|" + layer.name + "~" + src +
                         "~" + Math.round(layer.inPoint  * 1000) +
                         "~" + Math.round(layer.outPoint * 1000);
                } catch(e) { s += "|?"; }
            }
            return s;
        }

        function identical(a, b) {
            if (a === b) return true;
            if (a.name !== b.name || a.width !== b.width || a.height !== b.height) return false;
            if (Math.abs(a.frameRate - b.frameRate) > 0.0001) return false;
            if (Math.abs(a.duration  - b.duration)  > 0.001)  return false;
            if (a.numLayers !== b.numLayers) return false;
            var bA = a.bgColor, bB = b.bgColor;
            if (Math.round(bA[0]*255) !== Math.round(bB[0]*255) ||
                Math.round(bA[1]*255) !== Math.round(bB[1]*255) ||
                Math.round(bA[2]*255) !== Math.round(bB[2]*255)) return false;
            for (var i = 1; i <= a.numLayers; i++) {
                try {
                    var la = a.layer(i), lb = b.layer(i);
                    if (la.name !== lb.name || la.matchName !== lb.matchName) return false;
                    if (la.enabled !== lb.enabled || la.blendingMode !== lb.blendingMode) return false;
                    if (Math.abs(la.inPoint   - lb.inPoint)   > 0.001) return false;
                    if (Math.abs(la.outPoint  - lb.outPoint)  > 0.001) return false;
                    if (Math.abs(la.startTime - lb.startTime) > 0.001) return false;
                    var sA = la.source ? la.source.name : null;
                    var sB = lb.source ? lb.source.name : null;
                    if (sA !== sB) return false;
                    var ta = la.transform, tb = lb.transform;
                    if (propSig(ta.anchorPoint) !== propSig(tb.anchorPoint)) return false;
                    if (propSig(ta.position)    !== propSig(tb.position))    return false;
                    if (propSig(ta.scale)       !== propSig(tb.scale))       return false;
                    if (propSig(ta.rotation)    !== propSig(tb.rotation))    return false;
                    if (propSig(ta.opacity)     !== propSig(tb.opacity))     return false;
                    var eA = la.property("ADBE Effect Parade");
                    var eB = lb.property("ADBE Effect Parade");
                    if (eA.numProperties !== eB.numProperties) return false;
                    for (var e = 1; e <= eA.numProperties; e++) {
                        if (eA.property(e).matchName !== eB.property(e).matchName) return false;
                    }
                } catch(e) { return false; }
            }
            return true;
        }

        function replaceUsages(target, canon) {
            for (var i = 1; i <= proj.numItems; i++) {
                try {
                    var item = proj.item(i);
                    if (!(item instanceof CompItem) || item === target || item === canon) continue;
                    for (var j = 1; j <= item.numLayers; j++) {
                        try {
                            if (item.layer(j).source === target) item.layer(j).replaceSource(canon, false);
                        } catch(e) {}
                    }
                } catch(e) {}
            }
        }

        app.beginUndoGroup("Organize Project");
        var totalMerged = 0;

        // Consolidate duplicate footage items and solids
        var footageMerged = 0;
        var fileBuckets = {}, solidBuckets = {};
        for (var i = 1; i <= proj.numItems; i++) {
            try {
                var fi = proj.item(i);
                if (!(fi instanceof FootageItem)) continue;
                var fs = fi.mainSource;
                if (!fs) continue;
                if (fs instanceof FileSource) {
                    try {
                        var fk = "F|" + fs.file.absoluteURI;
                        if (!fileBuckets[fk]) fileBuckets[fk] = [];
                        fileBuckets[fk].push(fi);
                    } catch(e) {}
                } else if (fs instanceof SolidSource) {
                    var sk = "S|" + fi.width + "|" + fi.height + "|" +
                             Math.round(fs.color[0]*255) + "|" +
                             Math.round(fs.color[1]*255) + "|" +
                             Math.round(fs.color[2]*255);
                    if (!solidBuckets[sk]) solidBuckets[sk] = [];
                    solidBuckets[sk].push(fi);
                }
            } catch(e) {}
        }
        function mergeFootageBuckets(bkts) {
            for (var bk in bkts) {
                if (!bkts.hasOwnProperty(bk)) continue;
                var grp = bkts[bk];
                if (grp.length < 2) continue;
                var dead = {};
                for (var j = 1; j < grp.length; j++) {
                    if (dead[j]) continue;
                    replaceUsages(grp[j], grp[0]);
                    grp[j].remove();
                    dead[j] = true;
                    footageMerged++;
                }
            }
        }
        mergeFootageBuckets(fileBuckets);
        mergeFootageBuckets(solidBuckets);

        // Consolidate duplicate compositions (multi-pass)
        var changed = true;
        while (changed) {
            changed = false;
            var comps = [];
            for (var i = 1; i <= proj.numItems; i++) {
                try { if (proj.item(i) instanceof CompItem) comps.push(proj.item(i)); } catch(e) {}
            }
            if (comps.length < 2) break;

            var buckets = {};
            for (var i = 0; i < comps.length; i++) {
                var key = "K|" + fingerprint(comps[i]);
                if (!buckets[key]) buckets[key] = [];
                buckets[key].push(comps[i]);
            }
            for (var key in buckets) {
                if (!buckets.hasOwnProperty(key)) continue;
                var grp = buckets[key];
                if (grp.length < 2) continue;
                var dead = {};
                for (var i = 0; i < grp.length; i++) {
                    if (dead[i]) continue;
                    for (var j = i + 1; j < grp.length; j++) {
                        if (dead[j]) continue;
                        if (identical(grp[i], grp[j])) {
                            replaceUsages(grp[j], grp[i]);
                            grp[j].remove();
                            dead[j] = true;
                            totalMerged++;
                            changed = true;
                        }
                    }
                }
            }
        }

        app.endUndoGroup();

        var parts = [];
        if (footageMerged > 0) parts.push(footageMerged + " footage item" + (footageMerged === 1 ? "" : "s"));
        if (totalMerged   > 0) parts.push(totalMerged   + " composition"  + (totalMerged   === 1 ? "" : "s"));
        return parts.length > 0 ? "Merged " + parts.join(" and ") + "." : "No duplicates found.";
    } catch (err) {
        try { app.endUndoGroup(); } catch(e) {}
        return "ERROR: " + err.toString();
    }
}

// ── PROJECT STRUCTURE ─────────────────────────────────────────────────────────

// Extension -> target-bucket key. Only file types AE can hold as a FootageItem are listed; anything else is left where it is.
var STRUCTURE_EXT_MAP = {
    psd:"PSD", psb:"PSD",
    ai:"AI", eps:"AI",
    jpg:"IMG", jpeg:"IMG", png:"IMG", gif:"IMG", bmp:"IMG", tif:"IMG", tiff:"IMG",
    tga:"IMG", webp:"IMG", svg:"IMG", exr:"IMG", dpx:"IMG", hdr:"IMG",
    mov:"FOOTAGE", mp4:"FOOTAGE", avi:"FOOTAGE", mxf:"FOOTAGE", mkv:"FOOTAGE",
    wmv:"FOOTAGE", m4v:"FOOTAGE", webm:"FOOTAGE", mpg:"FOOTAGE", mpeg:"FOOTAGE",
    m2v:"FOOTAGE", r3d:"FOOTAGE", braw:"FOOTAGE",
    wav:"AUDIO", mp3:"AUDIO", aif:"AUDIO", aiff:"AUDIO", m4a:"AUDIO", wma:"AUDIO",
    ogg:"AUDIO", flac:"AUDIO",
    c4d:"C4D"
};

function itemsInFolder(folder) {
    var out = [];
    for (var i = 1; i <= app.project.numItems; i++) {
        var it = app.project.item(i);
        try { if (it.parentFolder === folder) out.push(it); } catch(e) {}
    }
    return out;
}

function findChildFolder(parent, name) {
    var kids = itemsInFolder(parent);
    for (var i = 0; i < kids.length; i++) {
        if (kids[i] instanceof FolderItem && kids[i].name === name) return kids[i];
    }
    return null;
}

function footageExt(fi) {
    try {
        var fs = fi.mainSource;
        if (fs && fs instanceof FileSource && fs.file) {
            var m = fs.file.name.match(/\.([a-zA-Z0-9]+)$/);
            if (m) return m[1].toLowerCase();
        }
    } catch(e) {}
    return null;
}

// Folders only carry an explicit "role" when created as one of the built-ins; everything else is matched here by name/keyword instead.
var STRUCTURE_ROLE_NAME_MAP = {
    precomps:"precomps", precomp:"precomps",
    psd:"psd", psds:"psd",
    ai:"ai",
    images:"images", image:"images", stills:"images", still:"images",
    footage:"footage", video:"footage", videos:"footage",
    audio:"audio", sfx:"audio", sound:"audio",
    c4d_scenes:"c4d", c4d:"c4d",
    ae_projects:"imported", imported:"imported"
};

function structureRoleKey(name) {
    return name.toLowerCase()
        .replace(/^\d+[.\-_\s]*/, "")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
}

// Walks a parsed preset tree, creating/reusing folders under `parent` by exact name match (idempotent re-apply).
// Depth-0 folders go into topFolders; each folder's role (explicit or name-inferred) is recorded into roleFolders.
function buildStructureTree(nodes, parent, roleFolders, topFolders, isTop) {
    for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i], name = (n && n.name ? String(n.name) : "");
        if (!name) continue;
        var folder = findChildFolder(parent, name);
        if (!folder) {
            folder = app.project.items.addFolder(name);
            folder.parentFolder = parent;
        }
        if (isTop) topFolders.push(folder);
        var role = n.role || STRUCTURE_ROLE_NAME_MAP[structureRoleKey(name)];
        if (role && !roleFolders[role]) roleFolders[role] = folder;
        if (n.children && n.children.length) buildStructureTree(n.children, folder, roleFolders, topFolders, false);
    }
}

function lineup_configureProjectStructure(treeJson, breakStructure) {
    try {
        var tree;
        try { tree = JSON.parse(treeJson); } catch(e) { return "ERROR: Invalid structure data."; }
        if (!tree || !tree.length) return "ERROR: This preset has no folders — add at least one before applying.";

        app.beginUndoGroup("Configure Project Structure");

        var roleFolders = {}, topFolders = [];
        buildStructureTree(tree, app.project.rootFolder, roleFolders, topFolders, true);

        var fPre    = roleFolders.precomps;
        var fAeProj = roleFolders.imported;
        var DEST = {
            PSD: roleFolders.psd, AI: roleFolders.ai, IMG: roleFolders.images,
            FOOTAGE: roleFolders.footage, AUDIO: roleFolders.audio, C4D: roleFolders.c4d
        };

        function sortItem(it) {
            if (it instanceof CompItem) {
                if (!fPre) return false;
                it.parentFolder = fPre; return true;
            }
            if (it instanceof FootageItem) {
                var ext = footageExt(it), cat = ext ? STRUCTURE_EXT_MAP[ext] : null;
                if (!cat || !DEST[cat]) return false;
                it.parentFolder = DEST[cat];
                return true;
            }
            return false;
        }

        // Recursively pulls Comp/Footage items out of a foreign folder tree, sorting each into its proper bucket and deleting emptied folders.
        // Unclassifiable items are left in place (and their folder un-deleted) rather than silently dropped.
        function unpackFolder(folder) {
            var count = 0, kids = itemsInFolder(folder);
            for (var i = 0; i < kids.length; i++) {
                var kid = kids[i];
                if (kid instanceof FolderItem) count += unpackFolder(kid);
                else if (sortItem(kid)) count++;
            }
            try { if (itemsInFolder(folder).length === 0) folder.remove(); } catch(e) {}
            return count;
        }

        var topItems = itemsInFolder(app.project.rootFolder);
        var foreignFolders = [];
        for (var i = 0; i < topItems.length; i++) {
            var it = topItems[i];
            if (it instanceof FolderItem) {
                var known = false;
                for (var s = 0; s < topFolders.length; s++) if (topFolders[s] === it) { known = true; break; }
                if (!known) foreignFolders.push(it);
            }
        }

        var brokenCount = 0, movedFolders = 0, leftFolders = 0;
        if (breakStructure) {
            for (var i = 0; i < foreignFolders.length; i++) brokenCount += unpackFolder(foreignFolders[i]);
        } else if (fAeProj) {
            for (var i = 0; i < foreignFolders.length; i++) { foreignFolders[i].parentFolder = fAeProj; movedFolders++; }
        } else {
            leftFolders = foreignFolders.length;
        }

        var movedComps = 0, movedAssets = 0;
        var rootItems = itemsInFolder(app.project.rootFolder);
        for (var i = 0; i < rootItems.length; i++) {
            var it = rootItems[i];
            if (it instanceof FolderItem) continue;
            if (sortItem(it)) { if (it instanceof CompItem) movedComps++; else movedAssets++; }
        }

        app.endUndoGroup();

        var sortedTotal = movedComps + movedAssets + brokenCount;
        if (sortedTotal === 0 && foreignFolders.length === 0) {
            return "Created folder structure — nothing loose to sort.";
        }
        var msg = "Sorted " + pluralize(sortedTotal, "item") + " into folders";
        if (breakStructure) {
            if (foreignFolders.length > 0) msg += "; broke apart " + pluralize(foreignFolders.length, "existing folder");
        } else if (movedFolders > 0) {
            msg += "; moved " + pluralize(movedFolders, "existing folder") + " into the imported folder";
        } else if (leftFolders > 0) {
            msg += "; left " + pluralize(leftFolders, "existing folder") + " as-is (this preset has no \"imported\" folder)";
        }
        return msg;
    } catch (err) {
        try { app.endUndoGroup(); } catch(e) {}
        return "ERROR: " + err.toString();
    }
}

// ── SMART LINK ─────────────────────────────────────────────────────────────────
// Adds an expression-control effect per selected property, on the layer itself if the selection is single-layer, or
// on one shared new null (seeded from the first layer, others offset-baked) if it spans multiple layers. Re-clicking
// linked properties tears the link down; clicking a controller null alone tears down the whole thing.

// Effect Parade children share one matchName per effect type, so the effect's own (unique) name is used at that level instead; every level below stays on matchName.
function smartLink_getPropertyPath(prop) {
    var path = [];
    var current = prop;
    while (current) {
        var parent;
        try { parent = current.parentProperty; } catch (e) { parent = null; }
        if (!parent) break;
        if (parent.matchName === "ADBE Effect Parade") {
            path.unshift(current.name);
        } else if (current.matchName) {
            path.unshift(current.matchName);
        }
        current = parent;
    }
    return path;
}

function smartLink_getPropertyByPath(layer, path) {
    var current = layer;
    for (var i = 0; i < path.length; i++) {
        try {
            current = current.property(path[i]);
            if (!current) return null;
        } catch (e) { return null; }
    }
    return current;
}

function smartLink_getLayerFromProperty(prop) {
    var current = prop;
    var maxIterations = 20;
    for (var i = 0; i < maxIterations; i++) {
        if (!current) return null;
        if (current.containingComp !== undefined) return current;
        try { current = current.parentProperty; } catch (e) { return null; }
    }
    return null;
}

// Descriptive control/display name with just enough hierarchy to disambiguate
// (e.g. "Ellipse 1 - Color" instead of just "Color"), capped to the last two
// meaningful parts so it doesn't run on for deeply nested shape properties.
function smartLink_buildDisplayName(prop) {
    var nameParts = [];
    var propName = prop.name;
    try {
        var current = prop.parentProperty;
        var depth = 0, maxDepth = 10;
        while (current && depth < maxDepth) {
            if (current.containingComp !== undefined) break;
            var name = current.name;
            var matchName = current.matchName || "";
            if (matchName === "ADBE Root Vectors Group" ||
                matchName === "ADBE Transform Group" ||
                matchName === "ADBE Effect Parade" ||
                matchName === "ADBE MTrackers" ||
                matchName === "ADBE Vectors Group" ||
                matchName === "ADBE Vector Materials Group" ||
                name === "Contents" || name === "Transform" || name === "Effects") {
                current = current.parentProperty;
                depth++;
                continue;
            }
            if (name && name !== propName) nameParts.unshift(name);
            current = current.parentProperty;
            depth++;
        }
    } catch (e) {}
    nameParts.push(propName);
    if (nameParts.length > 2) nameParts = nameParts.slice(-2);
    return nameParts.join(" - ");
}

// Which expression-control type + heuristics for dropdown/angle/checkbox
// properties that don't map cleanly onto propertyValueType alone.
function smartLink_getControlType(prop, layer) {
    var valueType = prop.propertyValueType;
    var matchName = prop.matchName || "";
    var propName = prop.name || "";

    // Dropdown Menu Control effects can't be recreated with matching menu items via scripting, so they're not linkable.
    if (matchName.indexOf("Dropdown") !== -1 || matchName.indexOf("-Menu") !== -1 || propName === "Menu") {
        try {
            var ddParent = prop.parentProperty;
            if (ddParent && ddParent.matchName === "ADBE Dropdown Control") return "unsupported_dropdown";
        } catch (e) {}
    }

    // Effect dropdown params are OneD values representing menu selections, heuristically detected by a small integer value + menu-ish name.
    if (valueType === PropertyValueType.OneD) {
        try {
            var val = prop.value;
            if (val === Math.floor(val) && val >= 1 && val <= 20) {
                var lowerName = propName.toLowerCase(), lowerMatch = matchName.toLowerCase();
                if (lowerName.indexOf("mode") !== -1 || lowerName.indexOf("type") !== -1 ||
                    lowerName.indexOf("method") !== -1 || lowerName.indexOf("quality") !== -1 ||
                    lowerName.indexOf("channel") !== -1 || lowerName.indexOf("displacement") !== -1 ||
                    lowerName.indexOf("pinning") !== -1 || lowerName.indexOf("antialiasing") !== -1 ||
                    lowerMatch.indexOf("popup") !== -1 || lowerMatch.indexOf("menu") !== -1) {
                    return "unsupported_dropdown";
                }
            }
        } catch (e) {}
    }

    switch (valueType) {
        case PropertyValueType.TwoD:
        case PropertyValueType.TwoD_SPATIAL:
            return "point";
        case PropertyValueType.ThreeD:
        case PropertyValueType.ThreeD_SPATIAL:
            // Position/Anchor Point/Scale report as 3D even on 2D layers — only treat it as 3D if the layer itself is.
            var isTransformProp = (matchName.indexOf("ADBE Position") !== -1 ||
                                    matchName.indexOf("ADBE Anchor Point") !== -1 ||
                                    matchName.indexOf("ADBE Scale") !== -1);
            if (isTransformProp && layer) {
                try { if (!layer.threeDLayer) return "point"; } catch (e) {}
            }
            return "point3d";
        case PropertyValueType.COLOR:
            return "color";
    }

    if (valueType === PropertyValueType.OneD || valueType === PropertyValueType.CUSTOM_VALUE) {
        try {
            var units = prop.unitsText;
            if (units && (units.indexOf("°") !== -1 || units.toLowerCase().indexOf("deg") !== -1)) return "angle";
        } catch (e) {}

        var matchNameLower = matchName.toLowerCase();
        if (matchNameLower.indexOf("rotate") !== -1 || matchNameLower.indexOf("angle") !== -1 ||
            matchNameLower.indexOf("phase") !== -1 || matchNameLower.indexOf("direction") !== -1 ||
            matchNameLower.indexOf("shear angle") !== -1 || matchNameLower.indexOf("skew") !== -1) {
            return "angle";
        }

        var propNameLower = propName.toLowerCase();
        if (propNameLower.indexOf("rotation") !== -1 || propNameLower.indexOf("angle") !== -1 ||
            propNameLower.indexOf("phase") !== -1 || propNameLower.indexOf("direction") !== -1 ||
            propNameLower.indexOf("skew") !== -1) {
            return "angle";
        }

        try {
            var val2 = prop.value;
            if ((val2 === 0 || val2 === 1) &&
                (propNameLower.indexOf("enable") !== -1 || propNameLower.indexOf("on/off") !== -1 ||
                 propNameLower.indexOf("visible") !== -1 || propNameLower.indexOf("show") !== -1 ||
                 propNameLower.indexOf("hide") !== -1)) {
                return "checkbox";
            }
        } catch (e) {}

        return "slider";
    }

    return "slider";
}

function smartLink_collectKeyframes(prop) {
    var keyframes = [];
    if (!prop.canVaryOverTime || prop.numKeys === 0) return keyframes;
    for (var k = 1; k <= prop.numKeys; k++) {
        var keyData = { time: prop.keyTime(k), value: prop.keyValue(k) };
        try {
            keyData.inInterpolationType = prop.keyInInterpolationType(k);
            keyData.outInterpolationType = prop.keyOutInterpolationType(k);
        } catch (e) {}
        try {
            if (keyData.inInterpolationType === KeyframeInterpolationType.BEZIER ||
                keyData.outInterpolationType === KeyframeInterpolationType.BEZIER) {
                keyData.inTemporalEase = prop.keyInTemporalEase(k);
                keyData.outTemporalEase = prop.keyOutTemporalEase(k);
            }
        } catch (e) {}
        keyframes.push(keyData);
    }
    return keyframes;
}

// 3D source value onto a 2D Point control just drops the Z.
function smartLink_convertValueForControl(value, controlType) {
    if (value === undefined || value === null) return value;
    if (controlType === "point" && value instanceof Array && value.length >= 3) {
        return [value[0], value[1]];
    }
    return value;
}

// Once a property is expression-linked its own keyframes are dead weight —
// the expression alone drives the value now, and any animation worth
// keeping already got copied onto the new control by smartLink_applyKeyframes.
function smartLink_stripKeyframes(prop) {
    try { while (prop.numKeys > 0) prop.removeKey(1); } catch (e) {}
}

// Ease must be set BEFORE interpolation type — same reason as lineup_setKeyframeInterpolation: setTemporalEaseAtKey
// force-promotes both sides to Bezier as a side effect, so setting it after the type gets overwritten.
function smartLink_applyKeyframes(controlProp, keyframes, controlType) {
    if (!keyframes || !keyframes.length) return;
    for (var k = 0; k < keyframes.length; k++) {
        var keyData = keyframes[k];
        var keyIndex = controlProp.addKey(keyData.time);

        try {
            controlProp.setValueAtKey(keyIndex, smartLink_convertValueForControl(keyData.value, controlType));
        } catch (e) { continue; }

        var inType = keyData.inInterpolationType, outType = keyData.outInterpolationType;
        var isBezier = (inType === KeyframeInterpolationType.BEZIER || outType === KeyframeInterpolationType.BEZIER);

        if (isBezier && keyData.inTemporalEase && keyData.outTemporalEase) {
            var inEase = keyData.inTemporalEase, outEase = keyData.outTemporalEase;
            // A spatial source can hand back a 3-dimension ease even for a 2D Point control target — trim to match.
            if (controlType === "point") {
                if (inEase.length > 2) inEase = [inEase[0], inEase[1]];
                if (outEase.length > 2) outEase = [outEase[0], outEase[1]];
            }
            try { controlProp.setTemporalEaseAtKey(keyIndex, inEase, outEase); } catch (e) {}
        }

        if (inType !== undefined && outType !== undefined) {
            try { controlProp.setInterpolationTypeAtKey(keyIndex, inType, outType); } catch (e) {}
        }
    }
}

function smartLink_addControl(layer, controlType, controlName) {
    var effects = layer.property("ADBE Effect Parade");
    var control = null;
    switch (controlType) {
        case "slider":   control = effects.addProperty("ADBE Slider Control"); break;
        case "point":    control = effects.addProperty("ADBE Point Control"); break;
        case "point3d":  control = effects.addProperty("ADBE Point3D Control"); break;
        case "color":    control = effects.addProperty("ADBE Color Control"); break;
        case "angle":    control = effects.addProperty("ADBE Angle Control"); break;
        case "checkbox": control = effects.addProperty("ADBE Checkbox Control"); break;
        default:         control = effects.addProperty("ADBE Slider Control");
    }
    if (control) control.name = controlName;
    return control;
}

// Adds a new control on hostLayer named baseName, appending " 2"/" 3"/... if
// that name's already taken on this layer (existing controls, whether from a
// past Smart Link or something else entirely, are never overwritten/reused).
function smartLink_createUniqueControl(hostLayer, controlType, baseName) {
    var effects = hostLayer.property("ADBE Effect Parade");
    var controlName = baseName;
    var existingControl = null;
    try { existingControl = effects.property(controlName); } catch (e) {}
    if (existingControl) {
        var suffix = 2;
        while (effects.property(controlName + " " + suffix)) suffix++;
        controlName = controlName + " " + suffix;
    }
    var control = smartLink_addControl(hostLayer, controlType, controlName);
    return control ? { control: control, name: controlName } : null;
}

function smartLink_createSharedNull(comp, baseName) {
    var nullName = baseName, sfx = 2, taken = true;
    while (taken) {
        taken = false;
        for (var li = 1; li <= comp.numLayers; li++) {
            if (comp.layer(li).name === nullName) { nullName = baseName + " " + sfx++; taken = true; break; }
        }
    }
    var nullLayer = comp.layers.addNull();
    nullLayer.name = nullName;
    return nullLayer;
}

function smartLink_getControlValueProperty(control, controlType) {
    switch (controlType) {
        case "slider":   return control.property("ADBE Slider Control-0001");
        case "point":    return control.property("ADBE Point Control-0001");
        case "point3d":  return control.property("ADBE Point3D Control-0001");
        case "color":    return control.property("ADBE Color Control-0001");
        case "angle":    return control.property("ADBE Angle Control-0001");
        case "checkbox": return control.property("ADBE Checkbox Control-0001");
        default:         return control.property(1);
    }
}

// Index (1), for localization support; quotes in names are escaped since they're built from user-editable layer/property names.
// hostLayerName is only passed for a shared-null control, since a bare effect("X")(1) only resolves against the CURRENT layer.
function smartLink_buildExpression(controlName, hostLayerName) {
    var safeName = controlName.replace(/"/g, '\\"');
    if (hostLayerName) {
        return 'thisComp.layer("' + hostLayerName.replace(/"/g, '\\"') + '").effect("' + safeName + '")(1)';
    }
    return 'effect("' + safeName + '")(1)';
}

// A shared control's non-base layers bake their own value in as a fixed offset from the base's, rather than snapping to match it.
function smartLink_buildOffsetExpr(ownValue, baseValue, controlType) {
    var own = smartLink_convertValueForControl(ownValue, controlType);
    var base = smartLink_convertValueForControl(baseValue, controlType);
    if (own === undefined || base === undefined) return "";
    if (typeof own === "number" && typeof base === "number") return " + " + (own - base);
    if (!(own instanceof Array) || !(base instanceof Array)) return "";
    var diff = [];
    for (var d = 0; d < own.length; d++) diff.push(own[d] - (base[d] || 0));
    return " + [" + diff.join(",") + "]";
}

// Detects whether a property's expression links it to a Smart Link control, resolving both the same-layer and
// shared-null forms smartLink_buildExpression produces. Returns { hostLayer, controllerName } or null; tolerates a trailing offset.
function smartLink_resolveLinkedControl(comp, prop, ownerLayer) {
    if (!prop.expression || prop.expression.length === 0) return null;
    var expr = prop.expression;
    var OFFSET_TAIL = '(?:\\s*\\+\\s*(?:-?[\\d.]+|\\[[^\\]]*\\]))?$';

    var crossMatch = expr.match(new RegExp('^thisComp\\.layer\\("([^"]+)"\\)\\.effect\\("([^"]+)"\\)\\(1\\)' + OFFSET_TAIL));
    if (crossMatch) {
        var hostLayer = null;
        try { hostLayer = comp.layer(crossMatch[1]); } catch (e) {}
        if (!hostLayer) return null;
        return { hostLayer: hostLayer, controllerName: crossMatch[2] };
    }

    var sameMatch = expr.match(new RegExp('^effect\\("([^"]+)"\\)\\(1\\)' + OFFSET_TAIL));
    if (sameMatch) {
        if (!ownerLayer) return null;
        return { hostLayer: ownerLayer, controllerName: sameMatch[1] };
    }

    var legacyMatch = expr.match(/^effect\("([^"]+)"\)\("(?:Slider|Point|3D Point|Color|Angle|Checkbox)"\)$/);
    if (legacyMatch && ownerLayer) return { hostLayer: ownerLayer, controllerName: legacyMatch[1] };

    return null;
}

// Before deleting a control effect during remove-mode, confirm nothing OTHER
// than the properties already being unlinked this run still points at it —
// a shared control on a Smart Link null can easily have more consumers than
// whatever's currently selected, and deleting it out from under them would
// leave their expression pointing at nothing.
function smartLink_controllerStillReferenced(comp, hostLayer, controllerName) {
    var found = false;
    lineup_walkExpressionProps(comp, function (l, p) {
        if (found) return;
        var link = smartLink_resolveLinkedControl(comp, p, l);
        if (link && link.hostLayer.index === hostLayer.index && link.controllerName === controllerName) found = true;
    });
    return found;
}

function smartLink_detectRemoveMode(comp, selectedProps) {
    if (!selectedProps || selectedProps.length === 0) return null;
    var propsToUnlink = [];

    for (var i = 0; i < selectedProps.length; i++) {
        var prop = selectedProps[i];
        if (prop.propertyType !== PropertyType.PROPERTY) return null;
        if (!prop.canSetExpression) return null;

        var ownerLayer = smartLink_getLayerFromProperty(prop);
        if (!ownerLayer) return null;

        var link = smartLink_resolveLinkedControl(comp, prop, ownerLayer);
        if (!link) return null;

        var effects = link.hostLayer.property("ADBE Effect Parade");
        if (!effects) return null;
        var controlEffect = effects.property(link.controllerName);
        if (!controlEffect) return null;

        propsToUnlink.push({ prop: prop, layer: link.hostLayer, controllerName: link.controllerName, controlEffect: controlEffect });
    }

    if (propsToUnlink.length === 0) return null;
    return { propsToUnlink: propsToUnlink };
}

function smartLink_executeRemoveMode(comp, removeData) {
    var propsToUnlink = removeData.propsToUnlink;
    app.beginUndoGroup("Smart Link - Remove");
    try {
        var removedCount = 0;
        var controlsToRemove = [];

        for (var i = 0; i < propsToUnlink.length; i++) {
            var data = propsToUnlink[i];
            data.prop.expression = "";
            removedCount++;

            var alreadyTracked = false;
            for (var j = 0; j < controlsToRemove.length; j++) {
                if (controlsToRemove[j].layer.index === data.layer.index &&
                    controlsToRemove[j].controllerName === data.controllerName) {
                    alreadyTracked = true;
                    break;
                }
            }
            if (!alreadyTracked) controlsToRemove.push({ layer: data.layer, controllerName: data.controllerName });
        }

        // Effects are looked up fresh here since references can go stale once other effects on the same layer are removed.
        var keptShared = 0;
        for (var k = 0; k < controlsToRemove.length; k++) {
            var control = controlsToRemove[k];
            if (smartLink_controllerStillReferenced(comp, control.layer, control.controllerName)) {
                keptShared++;
                continue;
            }
            try {
                var effects = control.layer.property("ADBE Effect Parade");
                var effectToRemove = effects && effects.property(control.controllerName);
                if (effectToRemove) effectToRemove.remove();
            } catch (removeErr) {}
        }

        app.endUndoGroup();
        var removeMsg = "Removed " + pluralize(removedCount, "Smart Link");
        if (keptShared > 0) removeMsg += " (kept " + pluralize(keptShared, "shared control") + " still in use elsewhere)";
        return removeMsg;
    } catch (err) {
        try { app.endUndoGroup(); } catch (e) {}
        return "ERROR: " + err.toString();
    }
}

// A null carrying at least one effect is treated as a controller null: selecting just it and clicking Smart Link tears it down.
function smartLink_isControllerNull(layer) {
    if (!layer.nullLayer) return false;
    var effects;
    try { effects = layer.property("ADBE Effect Parade"); } catch (e) { return false; }
    if (!effects) return false;
    try { return effects.numProperties > 0; } catch (e) { return false; }
}

function smartLink_teardownControllerNull(comp, nullLayers) {
    app.beginUndoGroup("Smart Link - Remove Null");
    try {
        var nullIndexSet = {};
        for (var n = 0; n < nullLayers.length; n++) nullIndexSet[nullLayers[n].index] = true;

        var unlinkedCount = 0;
        lineup_walkExpressionProps(comp, function (l, p) {
            var link = smartLink_resolveLinkedControl(comp, p, l);
            if (link && nullIndexSet[link.hostLayer.index]) {
                try { p.expression = ""; unlinkedCount++; } catch (e) {}
            }
        });

        for (var d = 0; d < nullLayers.length; d++) {
            try { nullLayers[d].remove(); } catch (e) {}
        }

        app.endUndoGroup();
        return "Removed " + pluralize(unlinkedCount, "expression") + " and deleted " + pluralize(nullLayers.length, "null");
    } catch (err) {
        try { app.endUndoGroup(); } catch (e) {}
        return "ERROR: " + err.toString();
    }
}

function lineup_smartLink() {
    var comp = app.project.activeItem;
    if (!(comp && comp instanceof CompItem)) return "ERROR: No active composition";

    var selectedProps = comp.selectedProperties;
    var selectedLayers = comp.selectedLayers;

    // Selecting a controller null alone and clicking Smart Link tears the whole thing down instead.
    if ((!selectedProps || selectedProps.length === 0) && selectedLayers && selectedLayers.length > 0) {
        var nullsToRemove = [];
        for (var nl = 0; nl < selectedLayers.length; nl++) {
            if (smartLink_isControllerNull(selectedLayers[nl])) nullsToRemove.push(selectedLayers[nl]);
        }
        if (nullsToRemove.length > 0) return smartLink_teardownControllerNull(comp, nullsToRemove);
    }

    var removeMode = smartLink_detectRemoveMode(comp, selectedProps);
    if (removeMode) return smartLink_executeRemoveMode(comp, removeMode);

    // A null layer included alongside the property selection designates itself as the target for new controls.
    var targetNull = null;
    if (selectedLayers) {
        for (var sl = 0; sl < selectedLayers.length; sl++) {
            if (selectedLayers[sl].nullLayer) { targetNull = selectedLayers[sl]; break; }
        }
    }

    // PHASE 1: collect what to link before anything is modified, since adding effects later can invalidate property references.
    var propertyData = [];
    var skippedDropdowns = [];

    if (selectedProps && selectedProps.length > 0) {
        for (var i = 0; i < selectedProps.length; i++) {
            var prop = selectedProps[i];
            if (!prop.canSetExpression) continue;
            if (prop.expression && prop.expression.length > 0) continue;

            var layer = smartLink_getLayerFromProperty(prop);
            if (!layer) continue;

            var path = smartLink_getPropertyPath(prop);
            if (path.length === 0) continue;

            var controlType = smartLink_getControlType(prop, layer);
            if (controlType === "unsupported_dropdown") {
                skippedDropdowns.push(prop.name);
                continue;
            }

            var keyframes = smartLink_collectKeyframes(prop);
            var currentValue;
            try { currentValue = prop.value; } catch (valueErr) { continue; }

            propertyData.push({
                layer: layer,
                propertyPath: path,
                propertyName: prop.name,
                displayName: smartLink_buildDisplayName(prop),
                controlType: controlType,
                currentValue: currentValue,
                keyframes: keyframes
            });
        }
    }

    // Nothing valid selected but whole layers are — auto-add their standard transform properties instead.
    if (propertyData.length === 0 && selectedLayers && selectedLayers.length > 0) {
        var transformProps = [
            { matchName: "ADBE Anchor Point", name: "Anchor Point" },
            { matchName: "ADBE Position", name: "Position" },
            { matchName: "ADBE Scale", name: "Scale" },
            { matchName: "ADBE Rotate Z", name: "Rotation" },
            { matchName: "ADBE Opacity", name: "Opacity" }
        ];

        for (var j = 0; j < selectedLayers.length; j++) {
            var selLayer = selectedLayers[j];
            for (var t = 0; t < transformProps.length; t++) {
                var transformPath = ["ADBE Transform Group", transformProps[t].matchName];
                var testProp = smartLink_getPropertyByPath(selLayer, transformPath);
                if (!testProp || !testProp.canSetExpression) continue;
                if (testProp.expression && testProp.expression.length > 0) continue;

                var tControlType = smartLink_getControlType(testProp, selLayer);
                var tKeyframes = smartLink_collectKeyframes(testProp);
                var tCurrentValue;
                try { tCurrentValue = testProp.value; } catch (valueErr) { continue; }

                propertyData.push({
                    layer: selLayer,
                    propertyPath: transformPath,
                    propertyName: testProp.name,
                    displayName: selLayer.name + " - " + transformProps[t].name,
                    controlType: tControlType,
                    currentValue: tCurrentValue,
                    keyframes: tKeyframes
                });
            }
        }
    }

    if (propertyData.length === 0) {
        if (skippedDropdowns.length > 0) return "ERROR: Dropdown menu properties can't be linked (" + skippedDropdowns.join(", ") + ")";
        return "ERROR: Select a property (Rotation, Opacity, Position, an effect's Color/Angle/Point/Slider, ...) or select whole layers to auto-link their transform properties.";
    }

    // Multiple distinct layers involved → controls move onto one shared null instead of scattering across source layers.
    var layerIndexSet = {};
    var distinctLayerCount = 0;
    for (var dl = 0; dl < propertyData.length; dl++) {
        var dlIdx = propertyData[dl].layer.index;
        if (!layerIndexSet[dlIdx]) { layerIndexSet[dlIdx] = true; distinctLayerCount++; }
    }
    var useSharedNull = !!targetNull || distinctLayerCount > 1;

    app.beginUndoGroup("Smart Link");
    var addedCount = 0;
    var failedCount = 0;
    var nullName = null;

    try {
        if (useSharedNull) {
            var sharedNull = targetNull || smartLink_createSharedNull(comp, "Smart Link Controller");
            nullName = sharedNull.name;

            // Group by matching property so the same property selected on 2+ layers shares one control.
            var groups = {}, groupOrder = [];
            for (var g = 0; g < propertyData.length; g++) {
                var gd = propertyData[g];
                var key = gd.propertyPath.join(">") + "::" + gd.controlType;
                if (!groups[key]) { groups[key] = []; groupOrder.push(key); }
                groups[key].push(gd);
            }

            for (var go = 0; go < groupOrder.length; go++) {
                var entries = groups[groupOrder[go]];
                var base = entries[0];

                var created = smartLink_createUniqueControl(sharedNull, base.controlType, base.displayName);
                if (!created) { failedCount += entries.length; continue; }

                var controlValueProp = smartLink_getControlValueProperty(created.control, base.controlType);
                if (controlValueProp) {
                    if (base.keyframes && base.keyframes.length > 0) {
                        smartLink_applyKeyframes(controlValueProp, base.keyframes, base.controlType);
                    } else if (base.currentValue !== undefined) {
                        try { controlValueProp.setValue(smartLink_convertValueForControl(base.currentValue, base.controlType)); } catch (e) {}
                    }
                }

                var baseExpr = smartLink_buildExpression(created.name, sharedNull.name);

                for (var e2 = 0; e2 < entries.length; e2++) {
                    var entry = entries[e2];
                    var entryProp = smartLink_getPropertyByPath(entry.layer, entry.propertyPath);
                    if (!entryProp) { failedCount++; continue; }

                    var finalExpr = baseExpr;
                    if (e2 > 0) {
                        finalExpr += smartLink_buildOffsetExpr(entry.currentValue, base.currentValue, base.controlType);
                    }

                    try {
                        entryProp.expression = finalExpr;
                        entryProp.expressionEnabled = true;
                        smartLink_stripKeyframes(entryProp);
                        addedCount++;
                    } catch (e) {
                        failedCount++;
                    }
                }
            }
        } else {
            for (var p = 0; p < propertyData.length; p++) {
                var data = propertyData[p];
                var layer2 = data.layer;

                var targetProp = smartLink_getPropertyByPath(layer2, data.propertyPath);
                if (!targetProp) { failedCount++; continue; }

                var created2 = smartLink_createUniqueControl(layer2, data.controlType, data.displayName);
                if (!created2) { failedCount++; continue; }

                var controlValueProp2 = smartLink_getControlValueProperty(created2.control, data.controlType);
                if (controlValueProp2) {
                    if (data.keyframes && data.keyframes.length > 0) {
                        smartLink_applyKeyframes(controlValueProp2, data.keyframes, data.controlType);
                    } else if (data.currentValue !== undefined) {
                        try { controlValueProp2.setValue(smartLink_convertValueForControl(data.currentValue, data.controlType)); } catch (e) {}
                    }
                }

                // Adding the control effect can invalidate the earlier property reference, so it's re-fetched fresh.
                targetProp = smartLink_getPropertyByPath(layer2, data.propertyPath);
                if (!targetProp) { failedCount++; continue; }

                try {
                    targetProp.expression = smartLink_buildExpression(created2.name);
                    targetProp.expressionEnabled = true;
                    smartLink_stripKeyframes(targetProp);
                    addedCount++;
                } catch (e) {
                    failedCount++;
                }
            }
        }
    } catch (error) {
        app.endUndoGroup();
        return "ERROR: " + error.message;
    }

    app.endUndoGroup();

    var msg = "Linked " + pluralize(addedCount, "property", "properties");
    if (nullName) msg += ' to "' + nullName + '"';
    if (failedCount > 0) msg += " (" + failedCount + " failed)";
    if (skippedDropdowns.length > 0) msg += " — skipped " + pluralize(skippedDropdowns.length, "dropdown");
    return msg;
}

// ── GET COMP SIZE ─────────────────────────────────────────────────────────────

function lineup_getCompSize() {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return "1920,1080";
        return comp.width + "," + comp.height;
    } catch(e) { return "1920,1080"; }
}

// ── LAYER SORT ────────────────────────────────────────────────────────────────

function lineup_sortLayers(propIdx, axisIdx, descend, groupNull) {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem))
            return "ERROR: No active composition";
        var layers = comp.selectedLayers;
        if (!layers || layers.length < 2)
            return "ERROR: Select at least 2 layers to sort";

        function getSortValue(layer) {
            try {
                if (propIdx === 0) {
                    var pos = layer.position;
                    if (pos.dimensionsSeparated)
                        return pos.getSeparationFollower(axisIdx).value;
                    return pos.value[axisIdx];
                } else if (propIdx === 1) {
                    return layer.rotation.value;
                } else {
                    return layer.scale.value[0];
                }
            } catch(e) { return 0; }
        }

        var layerData = [];
        for (var i = 0; i < layers.length; i++) {
            layerData.push({ layer: layers[i], value: getSortValue(layers[i]), origIndex: layers[i].index });
        }
        layerData.sort(function(a, b) {
            return descend ? b.value - a.value : a.value - b.value;
        });

        var topIndex = layerData[0].origIndex;
        for (var i = 1; i < layerData.length; i++) {
            if (layerData[i].origIndex < topIndex) topIndex = layerData[i].origIndex;
        }

        app.beginUndoGroup("Sort Layers");
        if (topIndex === 1) {
            layerData[0].layer.moveToBeginning();
        } else {
            layerData[0].layer.moveAfter(comp.layer(topIndex - 1));
        }
        for (var i = 1; i < layerData.length; i++) {
            layerData[i].layer.moveAfter(layerData[i - 1].layer);
        }

        if (groupNull) {
            var nullLayer = comp.layers.addNull();
            nullLayer.name = "Sort Group";
            nullLayer.position.setValue([comp.width / 2, comp.height / 2]);
            nullLayer.moveBefore(layerData[0].layer);
            for (var i = 0; i < layerData.length; i++) {
                layerData[i].layer.parent = nullLayer;
            }
        }

        app.endUndoGroup();
        return "ok";
    } catch (err) {
        try { app.endUndoGroup(); } catch(e) {}
        return "ERROR: " + err.toString();
    }
}

// ── BATCH COMP SETTINGS ─────────────────────────────────────────────────────────

function hasExpression(posProp) {
    if (posProp.dimensionsSeparated) {
        for (var d = 0; d < 3; d++) {
            try { if (posProp.getSeparationFollower(d).expressionEnabled) return true; } catch (e) {}
        }
        return false;
    }
    try { return !!posProp.expressionEnabled; } catch (e) { return false; }
}

function positionIs3D(posProp) {
    if (posProp.dimensionsSeparated) {
        try { posProp.getSeparationFollower(2); return true; } catch (e) { return false; }
    }
    return posProp.value.length === 3;
}

// Replicates Adobe's built-in "Scale Composition.jsx" sample script: parents every
// currently-unparented layer to a temporary 3D null, scales the null (and any camera
// zooms) by the resize factor, then removes the null — AE's native "dejump on unparent"
// bakes the correct compensating position/scale/rotation into every layer for us.
function scaleCompContentProportionally(comp, factorX, factorY) {
    var factorZ = (factorX + factorY) / 2;

    var nullLayer = comp.layers.addNull();
    nullLayer.threeDLayer = true;
    nullLayer.position.setValue([0, 0, 0]);

    for (var li = 1; li <= comp.numLayers; li++) {
        var layer = comp.layer(li);
        var wasLocked = layer.locked;
        layer.locked = false;
        if (layer !== nullLayer && !layer.parent) layer.parent = nullLayer; // falsy check — comes back as undefined, not null, when unset
        layer.locked = wasLocked;
    }

    for (var li = 1; li <= comp.numLayers; li++) {
        var layer = comp.layer(li);
        if (layer.matchName !== "ADBE Camera Layer") continue;
        var zoom = layer.zoom;
        if (zoom.numKeys === 0) {
            zoom.setValue(zoom.value * factorZ);
        } else {
            for (var k = 1; k <= zoom.numKeys; k++) zoom.setValueAtKey(k, zoom.keyValue(k) * factorZ);
        }
    }

    var nullScale = nullLayer.scale.value;
    nullLayer.scale.setValue([nullScale[0] * factorX, nullScale[1] * factorY, nullScale[2] * factorZ]);

    nullLayer.remove(); // dejumps every child layer's transform to compensate
}

// Recursively collects every comp used as a layer source inside the given root
// comps (and inside those, etc) — backs the "Also update nested compositions" option.
function collectNestedComps(rootComps) {
    var seen = {}, all = [], queue = [];
    for (var i = 0; i < rootComps.length; i++) {
        seen[rootComps[i].id] = true;
        all.push(rootComps[i]);
        queue.push(rootComps[i]);
    }
    while (queue.length > 0) {
        var c = queue.shift();
        for (var li = 1; li <= c.numLayers; li++) {
            var layer = c.layer(li);
            if (!(layer instanceof AVLayer)) continue;
            var src = layer.source;
            if (src && src instanceof CompItem && !seen[src.id]) {
                seen[src.id] = true;
                all.push(src);
                queue.push(src);
            }
        }
    }
    return all;
}

// Captures every keyframe on a leaf property, then rebuilds them at frame-rounded times (ExtendScript has no "move keyframe" call).
function snapLeafKeyframes(prop, frameDur) {
    var n = prop.numKeys;
    if (n === 0) return;

    var data = [];
    var anyChanged = false;
    for (var k = 1; k <= n; k++) {
        var t       = prop.keyTime(k);
        var snapped = Math.round(t / frameDur) * frameDur;
        if (Math.abs(snapped - t) > 1e-6) anyChanged = true;
        var item = { time: snapped, value: prop.keyValue(k) };
        try { item.inInterp   = prop.keyInInterpolationType(k); } catch (e) {}
        try { item.outInterp  = prop.keyOutInterpolationType(k); } catch (e) {}
        try { item.inEase     = prop.keyInTemporalEase(k); } catch (e) {}
        try { item.outEase    = prop.keyOutTemporalEase(k); } catch (e) {}
        try { item.autoBezier = prop.keySpatialAutoBezier(k); } catch (e) {}
        try { item.continuous = prop.keySpatialContinuous(k); } catch (e) {}
        try { item.inTangent  = prop.keyInSpatialTangent(k); } catch (e) {}
        try { item.outTangent = prop.keyOutSpatialTangent(k); } catch (e) {}
        try { item.roving     = prop.keyRoving(k); } catch (e) {}
        data.push(item);
    }
    if (!anyChanged) return;

    for (var k = n; k >= 1; k--) prop.removeKey(k);
    for (var i = 0; i < data.length; i++) prop.setValueAtTime(data[i].time, data[i].value);

    for (var i = 0; i < data.length; i++) {
        var idx = prop.nearestKeyIndex(data[i].time);
        if (data[i].inInterp !== undefined && data[i].outInterp !== undefined) {
            try { prop.setInterpolationTypeAtKey(idx, data[i].inInterp, data[i].outInterp); } catch (e) {}
        }
        // Gated on the captured interpolation type (not just truthiness) since setTemporalEaseAtKey on a Linear/Hold key would force-promote it to Bezier.
        if (data[i].inInterp === KeyframeInterpolationType.BEZIER &&
            data[i].outInterp === KeyframeInterpolationType.BEZIER &&
            data[i].inEase && data[i].outEase) {
            try { prop.setTemporalEaseAtKey(idx, data[i].inEase, data[i].outEase); } catch (e) {}
        }
        if (data[i].autoBezier !== undefined) { try { prop.setSpatialAutoBezierAtKey(idx, data[i].autoBezier); } catch (e) {} }
        if (data[i].continuous !== undefined) { try { prop.setSpatialContinuousAtKey(idx, data[i].continuous); } catch (e) {} }
        // Auto-Bezier tangents are recomputed by AE from the snapped spacing; forcing back pre-snap values would kink the curve.
        if (!data[i].autoBezier && data[i].inTangent && data[i].outTangent) {
            try { prop.setSpatialTangentsAtKey(idx, data[i].inTangent, data[i].outTangent); } catch (e) {}
        }
        if (data[i].roving) { try { prop.setRovingAtKey(idx, true); } catch (e) {} }
    }
}

function snapPropertyTreeKeyframes(prop, frameDur) {
    if (prop.propertyType === PropertyType.PROPERTY) {
        if (prop.dimensionsSeparated) {
            var dims = prop.value.length;
            for (var d = 0; d < dims; d++) {
                try { snapLeafKeyframes(prop.getSeparationFollower(d), frameDur); } catch (e) {}
            }
        } else if (prop.numKeys > 0) {
            snapLeafKeyframes(prop, frameDur);
        }
    } else {
        for (var i = 1; i <= prop.numProperties; i++) {
            try { snapPropertyTreeKeyframes(prop.property(i), frameDur); } catch (e) {}
        }
    }
}

function snapCompKeyframesToFrames(comp) {
    var frameDur = comp.frameDuration;
    for (var li = 1; li <= comp.numLayers; li++) {
        var layer = comp.layer(li);
        for (var pi = 1; pi <= layer.numProperties; pi++) {
            try { snapPropertyTreeKeyframes(layer.property(pi), frameDur); } catch (e) {}
        }
    }
}

// Rounds each layer's in/out points to the new frame rate. Order matters: AE rejects a write that would momentarily put inPoint >= outPoint.
function snapLayerInOutToFrames(comp) {
    var frameDur = comp.frameDuration;
    for (var li = 1; li <= comp.numLayers; li++) {
        var layer = comp.layer(li);
        try {
            var newIn  = Math.round(layer.inPoint  / frameDur) * frameDur;
            var newOut = Math.round(layer.outPoint / frameDur) * frameDur;
            if (newOut <= newIn) newOut = newIn + frameDur;
            if (Math.abs(newIn - layer.inPoint) < 1e-6 && Math.abs(newOut - layer.outPoint) < 1e-6) continue;

            if (newIn < layer.outPoint) {
                layer.inPoint  = newIn;
                layer.outPoint = newOut;
            } else {
                layer.outPoint = newOut;
                layer.inPoint  = newIn;
            }
        } catch (e) {}
    }
}

// Only un-parented layers are shifted directly — a parented descendant already inherits its parent's shift through the parenting transform.
function applyBatchSettingsToComp(comp, s, warnings) {
    if (s.applyDims) {
        var oldW = comp.width, oldH = comp.height;
        if (s.scaleContent && (s.width !== oldW || s.height !== oldH)) {
            scaleCompContentProportionally(comp, s.width / oldW, s.height / oldH);
            comp.width  = s.width;
            comp.height = s.height;
        } else {
            comp.width  = s.width;
            comp.height = s.height;
            var dx = (s.width - oldW) / 2, dy = (s.height - oldH) / 2;
            if (dx !== 0 || dy !== 0) {
                for (var li = 1; li <= comp.numLayers; li++) {
                    var layer = comp.layer(li);
                    if (layer.parent) continue; // falsy check — comes back as undefined, not null, when unset
                    var pos = layer.position;
                    if (hasExpression(pos)) {
                        warnings.push(layer.name + " — position has an expression");
                        continue;
                    }
                    try { shiftPosition(pos, dx, dy, positionIs3D(pos)); } catch (e) {}
                }
            }
        }
    }
    if (s.applyPAR)   { comp.pixelAspect = s.pixelAspect; }
    if (s.applyRes)   { comp.resolutionFactor = [s.resolutionFactor, s.resolutionFactor]; }
    if (s.applyDur)   { comp.duration = s.duration; }
    if (s.applyStart) { comp.displayStartTime = s.startTime; }
    if (s.applyFR) {
        comp.frameRate = s.frameRate;
        if (s.snapKeyframes) {
            snapCompKeyframesToFrames(comp);
            snapLayerInOutToFrames(comp);
        }
    }
}

// Always succeeds, even with nothing selected, so the panel can show "No comp selected" instead of being blocked.
function lineup_getBatchCompSettingsSeed() {
    try {
        var proj = app.project;
        var comps = [];
        for (var i = 0; i < proj.selection.length; i++) {
            if (proj.selection[i] instanceof CompItem) comps.push(proj.selection[i]);
        }
        var seed = comps.length > 0 ? comps[0] : null; // top selected comp in the Project panel

        var width = 1920, height = 1080, par = 1, fr = 30, res = 1, dur = 5, start = 0;
        if (seed) {
            width  = seed.width;
            height = seed.height;
            par    = seed.pixelAspect;
            fr     = seed.frameRate;
            res    = seed.resolutionFactor ? seed.resolutionFactor[0] : 1;
            dur    = seed.duration;
            start  = seed.displayStartTime;
        }

        var names = [];
        for (var i = 0; i < comps.length; i++) names.push(comps[i].name.replace(/\|/g, "/"));

        return [comps.length, width, height, par, fr, res, dur, start].join(",") + "|" + names.join("|");
    } catch (e) { return "ERROR: " + e.toString(); }
}

function lineup_batchApplyCompSettings(
    applyDims, width, height, scaleContent,
    applyPAR, pixelAspect,
    applyFR, frameRate, snapKeyframes,
    applyRes, resolutionFactor,
    applyDur, duration,
    applyStart, startTime,
    includeNested,
    excludedIndices
) {
    try {
        var proj = app.project;
        var allComps = [];
        for (var i = 0; i < proj.selection.length; i++) {
            if (proj.selection[i] instanceof CompItem) allComps.push(proj.selection[i]);
        }
        if (allComps.length === 0) return "ERROR: Select at least one composition in the Project panel.";

        // Indices (into allComps) the user removed from the batch via the panel's per-row remove button.
        var excluded = {};
        if (excludedIndices) {
            var exParts = String(excludedIndices).split(",");
            for (var i = 0; i < exParts.length; i++) {
                var exIdx = parseInt(exParts[i], 10);
                if (!isNaN(exIdx)) excluded[exIdx] = true;
            }
        }
        var comps = [];
        for (var i = 0; i < allComps.length; i++) {
            if (!excluded[i]) comps.push(allComps[i]);
        }
        if (comps.length === 0) return "ERROR: No compositions left to apply to — all were removed from the list.";

        var s = {
            applyDims: !!applyDims, width: width, height: height, scaleContent: !!scaleContent,
            applyPAR: !!applyPAR, pixelAspect: pixelAspect,
            applyFR: !!applyFR, frameRate: frameRate, snapKeyframes: !!snapKeyframes,
            applyRes: !!applyRes, resolutionFactor: resolutionFactor,
            applyDur: !!applyDur, duration: duration,
            applyStart: !!applyStart, startTime: startTime,
            includeNested: !!includeNested
        };

        var targets  = s.includeNested ? collectNestedComps(comps) : comps;
        var warnings = [];

        app.beginUndoGroup("Batch Composition Settings");
        try {
            for (var i = 0; i < targets.length; i++) applyBatchSettingsToComp(targets[i], s, warnings);
        } catch (err) {
            app.endUndoGroup();
            return "ERROR: " + err.toString();
        }
        app.endUndoGroup();

        if (warnings.length > 0) {
            var shown = warnings.slice(0, 12).join(" | ");
            var extra = warnings.length > 12 ? " …and " + (warnings.length - 12) + " more." : "";
            return "WARN:Done, but couldn't shift these (expression-driven — check manually): " + shown + extra;
        }
        return "ok";
    } catch (e) {
        try { app.endUndoGroup(); } catch (e2) {}
        return "ERROR: " + e.toString();
    }
}

// ── BATCH RENAME ─────────────────────────────────────────────────────────────
// Seeded from Batch Comp Settings' own seed call rather than a separate one, since both filter proj.selection identically.

// Spreadsheet-style column letters: 1 -> A, 2 -> B, … 26 -> Z, 27 -> AA, …
function numberToLetters(num) {
    var s = "";
    while (num > 0) {
        var rem = (num - 1) % 26;
        s = String.fromCharCode(65 + rem) + s;
        num = Math.floor((num - 1) / 26);
    }
    return s;
}

function lineup_batchRenameComps(pattern, start, orderIndices) {
    try {
        var proj = app.project;
        var allComps = [];
        for (var i = 0; i < proj.selection.length; i++) {
            if (proj.selection[i] instanceof CompItem) allComps.push(proj.selection[i]);
        }
        if (allComps.length === 0) return "ERROR: Select at least one composition in the Project panel.";
        if (!pattern) return "ERROR: Enter a name pattern.";

        // orderIndices is a CSV of indices into allComps in the panel's (possibly reordered/trimmed) order, which drives the numbering.
        var order = [];
        if (orderIndices) {
            var parts = String(orderIndices).split(",");
            for (var i = 0; i < parts.length; i++) {
                var idx = parseInt(parts[i], 10);
                if (!isNaN(idx) && allComps[idx]) order.push(idx);
            }
        }
        if (order.length === 0) return "ERROR: No compositions left to rename — all were removed from the list.";

        var startNum = parseInt(start, 10);
        if (isNaN(startNum)) startNum = 1;

        app.beginUndoGroup("Batch Rename Compositions");
        try {
            for (var pos = 0; pos < order.length; pos++) {
                var num      = startNum + pos;
                var letterPos = pos + 1; // [A] always starts at A, independent of Start-at
                // Replace every [#]/[##]/[###]… run with the index zero-padded to the # count, and [A] with a letter by position.
                var newName = pattern.replace(/\[#+\]/g, function (m) {
                    var width = m.length - 2;
                    var s = String(num);
                    while (s.length < width) s = "0" + s;
                    return s;
                });
                newName = newName.replace(/\[A\]/g, numberToLetters(letterPos));
                allComps[order[pos]].name = newName;
            }
        } catch (err) {
            app.endUndoGroup();
            return "ERROR: " + err.toString();
        }
        app.endUndoGroup();
        return "ok";
    } catch (e) {
        try { app.endUndoGroup(); } catch (e2) {}
        return "ERROR: " + e.toString();
    }
}

// ── COMP EXPORT ──────────────────────────────────────────────────────────────

// Always succeeds, even unsaved/nothing selected, returning the project's folder/base filename (empty if unsaved) for the panel's suggested save name.
function lineup_getCompExportSeed() {
    try {
        var proj  = app.project;
        var names = [];
        for (var i = 0; i < proj.selection.length; i++) {
            if (proj.selection[i] instanceof CompItem) names.push(proj.selection[i].name.replace(/\|/g, "/"));
        }

        var folderPath = proj.file ? proj.file.parent.fsName.replace(/\|/g, "/") : "";
        var projBase   = proj.file ? proj.file.name.replace(/\.aep$/i, "").replace(/\|/g, "/") : "";

        return folderPath + "|" + projBase + "|" + names.join("|");
    } catch (e) { return "ERROR: " + e.toString(); }
}

// Native Save dialog (same call on Mac and Windows — ExtendScript's File object
// always shows the OS's own file picker). Returns "" if the user cancels.
function lineup_pickExportLocation(defaultPath) {
    try {
        var seed = defaultPath ? new File(defaultPath) : new File(Folder.myDocuments.fsName + "/Untitled_export.aep");
        var picked = seed.saveDlg("Save Reduced Project As", "After Effects Project:*.aep");
        if (!picked) return "";
        var path = picked.fsName;
        if (!/\.aep$/i.test(path)) path += ".aep";
        return path;
    } catch (e) { return "ERROR: " + e.toString(); }
}

// Combines Save + Save As + Reduce Project: saves in place, duplicates to a new file, strips it to just the chosen
// comps (asset links stay put, nothing copied/collected), saves that, and leaves it open as the active project.
function lineup_exportReducedProject(exportPath, excludedIndices) {
    try {
        var proj = app.project;
        if (!proj.file) return "ERROR: Save this project at least once before exporting a reduced copy.";
        if (!exportPath) return "ERROR: Choose a save location first.";

        var allComps = [];
        for (var i = 0; i < proj.selection.length; i++) {
            if (proj.selection[i] instanceof CompItem) allComps.push(proj.selection[i]);
        }
        if (allComps.length === 0) return "ERROR: Select at least one composition in the Project panel.";

        // Indices (into allComps) the user removed from the batch via the panel's per-row remove button.
        var excluded = {};
        if (excludedIndices) {
            var exParts = String(excludedIndices).split(",");
            for (var i = 0; i < exParts.length; i++) {
                var exIdx = parseInt(exParts[i], 10);
                if (!isNaN(exIdx)) excluded[exIdx] = true;
            }
        }
        var comps = [];
        for (var i = 0; i < allComps.length; i++) {
            if (!excluded[i]) comps.push(allComps[i]);
        }
        if (comps.length === 0) return "ERROR: No compositions left to export — all were removed from the list.";

        proj.save();                      // persist the original project as-is first
        proj.save(new File(exportPath));  // duplicate to the new file
        proj.reduceProject(comps);
        proj.save();                      // persist the reduction to the new file

        return "ok";
    } catch (e) {
        return "ERROR: " + e.toString();
    }
}

// ── Spellcheck ────────────────────────────────────────────────────────────────

function spellcheck_getComps(idsJson) {
    try {
        var comps = [];
        if (idsJson && idsJson !== "null" && idsJson !== "") {
            var ids = JSON.parse(idsJson);
            for (var ii = 0; ii < ids.length; ii++) {
                for (var n = 1; n <= app.project.numItems; n++) {
                    var item = app.project.item(n);
                    if ((item instanceof CompItem) && item.id === ids[ii]) { comps.push(item); break; }
                }
            }
        } else {
            for (var n = 1; n <= app.project.numItems; n++) {
                var item = app.project.item(n);
                if (item instanceof CompItem) comps.push(item);
            }
        }
        if (comps.length === 0) return JSON.stringify([]);

        var result = [];
        for (var c = 0; c < comps.length; c++) {
            var comp = comps[c];
            var layers = [];
            for (var i = 1; i <= comp.numLayers; i++) {
                var layer = comp.layer(i);
                if (!(layer instanceof TextLayer)) continue;
                var srcText = layer.property("ADBE Text Properties").property("ADBE Text Document");
                var texts = [];
                if (srcText.numKeys > 0) {
                    for (var k = 1; k <= srcText.numKeys; k++) {
                        texts.push({ text: srcText.keyValue(k).text, keyIndex: k, time: srcText.keyTime(k) });
                    }
                } else {
                    texts.push({ text: srcText.value.text, keyIndex: 0, time: layer.inPoint });
                }
                layers.push({ index: i, name: layer.name, inPoint: layer.inPoint, texts: texts });
            }
            result.push({ id: comp.id, name: comp.name, fps: comp.frameRate, label: comp.label, layers: layers });
        }
        return JSON.stringify(result);
    } catch (e) {
        return "ERROR:" + e.message;
    }
}

function spellcheck_goto(compId, layerIndex, time) {
    try {
        var comp = null;
        var cid  = parseInt(compId, 10);
        for (var n = 1; n <= app.project.numItems; n++) {
            var item = app.project.item(n);
            if ((item instanceof CompItem) && item.id === cid) { comp = item; break; }
        }
        if (!comp) return "ERROR:Comp not found.";
        comp.openInViewer();
        for (var i = 1; i <= comp.numLayers; i++) comp.layer(i).selected = false;
        var layer = comp.layer(parseInt(layerIndex, 10));
        layer.selected = true;
        comp.time = parseFloat(time);
        return "OK";
    } catch (e) {
        return "ERROR:" + e.message;
    }
}

var _spellLastCompId = null;

function spellcheck_getState() {
    try {
        var result = { activeCompId: null, selectedCompIds: [], lastCompId: _spellLastCompId };
        var active = app.project.activeItem;
        if (active instanceof CompItem) {
            result.activeCompId = active.id;
            _spellLastCompId    = active.id;
            result.lastCompId   = active.id;
        }
        var sel = app.project.selection;
        if (sel) {
            for (var i = 0; i < sel.length; i++) {
                if (sel[i] instanceof CompItem) result.selectedCompIds.push(sel[i].id);
            }
        }
        return JSON.stringify(result);
    } catch (e) { return "ERROR:" + e.message; }
}

// ── Find & Replace ────────────────────────────────────────────────────────────

function _frApply(text, lq, query, repl, mode, invert) {
    var lText = text.toLowerCase();
    var idx, result, si, fi;

    if (!invert) {
        if (mode === 'contains') {
            if (lText.indexOf(lq) === -1) return null;
            result = ''; si = 0; fi = lText.indexOf(lq, 0);
            while (fi !== -1) {
                result += text.slice(si, fi) + repl;
                si = fi + lq.length;
                fi = lText.indexOf(lq, si);
            }
            return result + text.slice(si);
        }
        if (mode === 'starts') {
            if (lText.indexOf(lq) !== 0) return null;
            return repl + text.slice(query.length);
        }
        if (mode === 'ends') {
            idx = lText.length - lq.length;
            if (idx < 0 || lText.lastIndexOf(lq) !== idx) return null;
            return text.slice(0, text.length - query.length) + repl;
        }
    } else {
        if (mode === 'starts') {
            if (lText.indexOf(lq) === 0) return null;
            return query + text;
        }
        if (mode === 'ends') {
            idx = lText.length - lq.length;
            if (idx >= 0 && lText.lastIndexOf(lq) === idx) return null;
            return text + query;
        }
    }
    return null;
}

function find_replace(paramsJson) {
    try {
        app.beginUndoGroup("Find & Replace");
        var p      = JSON.parse(paramsJson);
        var query  = p.query  || '';
        var repl   = (p.repl !== undefined && p.repl !== null) ? p.repl : '';
        var mode   = p.mode   || 'contains';
        var invert = !!p.invert;
        var ids    = p.ids    || null;
        var lq     = query.toLowerCase();
        var count      = 0;
        var layerSet   = {};
        var layerCount = 0;
        var n, item, c, i, k, comp, layer, srcText, td, newText, layerKey;

        if (!query || (invert && mode === 'contains')) {
            app.endUndoGroup();
            return JSON.stringify({ count: 0 });
        }

        var comps = [];
        if (ids && ids.length) {
            for (var ii = 0; ii < ids.length; ii++) {
                for (n = 1; n <= app.project.numItems; n++) {
                    item = app.project.item(n);
                    if ((item instanceof CompItem) && item.id === ids[ii]) { comps.push(item); break; }
                }
            }
        } else {
            for (n = 1; n <= app.project.numItems; n++) {
                item = app.project.item(n);
                if (item instanceof CompItem) comps.push(item);
            }
        }

        for (c = 0; c < comps.length; c++) {
            comp = comps[c];
            for (i = 1; i <= comp.numLayers; i++) {
                layer = comp.layer(i);
                if (!(layer instanceof TextLayer)) continue;
                srcText = layer.property("ADBE Text Properties").property("ADBE Text Document");
                layerKey = comp.id + ':' + i;
                if (srcText.numKeys > 0) {
                    for (k = 1; k <= srcText.numKeys; k++) {
                        td      = srcText.keyValue(k);
                        newText = _frApply(td.text, lq, query, repl, mode, invert);
                        if (newText !== null) {
                            td.text = newText; srcText.setValueAtKey(k, td); count++;
                            if (!layerSet[layerKey]) { layerSet[layerKey] = true; layerCount++; }
                        }
                    }
                } else {
                    td      = srcText.value;
                    newText = _frApply(td.text, lq, query, repl, mode, invert);
                    if (newText !== null) {
                        td.text = newText; srcText.setValue(td); count++;
                        if (!layerSet[layerKey]) { layerSet[layerKey] = true; layerCount++; }
                    }
                }
            }
        }

        app.endUndoGroup();
        return JSON.stringify({ count: count, layers: layerCount });
    } catch (e) {
        try { app.endUndoGroup(); } catch (e2) {}
        return 'ERROR:' + e.message;
    }
}

// ── ACTIVITY TRACKING ─────────────────────────────────────────────────────────
// Read-only snapshot for the Trophy tab's gamification poll — no ExtendScript event exists for "a keyframe was added" etc.,
// so the panel diffs these raw totals itself on a timer. Keyframe count reads comp.selectedProperties (the Timeline's
// already-highlighted rows) rather than walking every property of every selected layer, to keep a 3-second poll cheap.
function lineup_getActivitySnapshot() {
    var proj = app.project;
    var projectId = proj.file ? proj.file.fsName : "__unsaved__";

    var layerCount = 0;
    for (var i = 1; i <= proj.numItems; i++) {
        try { if (proj.item(i) instanceof CompItem) layerCount += proj.item(i).numLayers; } catch (e) {}
    }

    var comp = proj.activeItem;
    var isComp = comp && comp instanceof CompItem;
    var compId = isComp ? comp.id : -1;
    // Playhead position — not scored, just a cheap extra activity signal for the Trophy timer's inactivity check.
    var currentTime = isComp ? comp.time : -1;

    var selected = isComp ? comp.selectedLayers : [];
    var selIndices = [];
    for (var s = 0; s < selected.length; s++) {
        try { selIndices.push(selected[s].index); } catch (e) {}
    }
    selIndices.sort(function (a, b) { return a - b; });
    var selectionId = selIndices.join(',');

    // matchName (falling back to name) is stable per property, sorted so the identity string ignores AE's per-tick ordering.
    var keyframeCount = 0;
    var propIds = [];
    var selectedProps = isComp ? comp.selectedProperties : [];
    for (var p = 0; p < selectedProps.length; p++) {
        var prop;
        try { prop = selectedProps[p]; } catch (e) { continue; }
        if (!prop || prop.propertyType !== PropertyType.PROPERTY) continue;
        try { if (prop.numKeys) keyframeCount += prop.numKeys; } catch (e) {}
        try { propIds.push(prop.matchName || prop.name); } catch (e) {}
    }
    propIds.sort();
    var propSelectionId = propIds.join(',');

    // Effects Applied stat: a flat per-layer effect count (no sub-property walk), scoped to selected layers.
    var fxCount = 0;
    for (var s2 = 0; s2 < selected.length; s2++) {
        try {
            var fxGroup = selected[s2].property("ADBE Effect Parade");
            if (fxGroup) fxCount += fxGroup.numProperties;
        } catch (e) {}
    }

    // numItems backs up compId as a project-switch signal in main.js — comp.id
    // is only unique within a single project, so a freshly opened project's
    // active comp can coincidentally reuse the previous project's id.
    return JSON.stringify({
        projectId: projectId,
        compId: compId,
        numItems: proj.numItems,
        selectionId: selectionId,
        propSelectionId: propSelectionId,
        currentTime: currentTime,
        layerCount: layerCount,
        keyframeCount: keyframeCount,
        fxCount: fxCount
    });
}
