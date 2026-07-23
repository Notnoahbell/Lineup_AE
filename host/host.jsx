// Lineup CEP — Host Script
// All ExtendScript logic. Called via CSInterface.evalScript() from the HTML panel.
// #include paths are relative to this file (host/).

#include "LST.js"

// ── Global clipboard state ────────────────────────────────────────────────────
var _anchorClipboard = null;   // { anchor: [x, y] }
var _easeClipboard   = null;   // array of { inType, outType, inEase, outEase }
var _easeClipboardType = null;

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

function getLayerCompBounds(layer, comp) {
    var r = layer.sourceRectAtTime(comp.time, false);
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

function anchorLocToPoint(loc, lw, lh, left, top) {
    return [left + (loc % 3) * lw / 2, top + Math.floor(loc / 3) * lh / 2];
}

function getSourceRect(layer, t, ignoreMasks) {
    if (ignoreMasks) return layer.sourceRectAtTime(t, false);
    var fullRect = layer.sourceRectAtTime(t, false);
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

// The exact inverse of fromComp above — a point in `layer`'s own local
// space, walked back UP through its own transform and then its parent
// chain, into true comp space. (AE's ExtendScript Layer object has no
// toComp/fromComp of its own — those only exist inside expressions — and
// LST.toComp's offset param (see LST.js) does `offset -= value` on plain
// arrays, which silently NaNs instead of subtracting componentwise, so
// this stays independent of it rather than risk the same bug.)
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

// Linear (rotation+scale) part of what fromComp applies at one ancestor level —
// converts a delta expressed in `ancestor`'s PARENT space into a delta expressed
// in `ancestor`'s OWN local space. For a delta (as opposed to a point), the
// position/anchor terms in fromComp's per-level math cancel out, leaving just
// the rotate+scale part.
function oneLevelDelta(ancestor, dx, dy) {
    var scale = ancestor.scale.value;
    var rotation = ancestor.rotation.value * (Math.PI / 180);
    var cos = Math.cos(-rotation), sin = Math.sin(-rotation);
    var rx = cos*dx - sin*dy, ry = sin*dx + cos*dy;
    return [rx / (scale[0]/100), ry / (scale[1]/100)];
}

// Converts a delta in true comp space into the delta that should be added to
// layer.position (which lives in layer.parent's local space, or comp space with
// no parent) to move the layer by that much on screen — the position-delta
// counterpart of fromComp's point conversion. This is what makes Align correct
// under a scaled/rotated parent (a null, a rig, ...): a comp-space pixel delta
// only equals a position-unit delta when there's no parent, or an unscaled/
// unrotated one. Walks the ancestor chain top-down, applying each ancestor's own
// rotation/scale in turn — same recursion order as fromComp, but starting one
// level up (at layer.parent), since position is unaffected by the layer's OWN
// rotation/scale/anchor.
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
    // Delta must be in parent space — use only this layer's own rotation/scale
    // (not the full parent chain) to convert from local to parent space.
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
        // Delta must be in parent space — use only this layer's own rotation/scale
        // (not the full parent chain) to convert from local to parent space.
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
// Horizontal align (left/centerX/right) redirects here whenever keyframes are
// selected on a selected layer's properties, instead of moving layer position —
// there's no sensible "vertical align" for a 1D time axis, so top/centerY/bottom
// always fall through to the normal position-align path below.

// Collects every selected keyframe, grouped by property, across all selected
// layers — {prop, indices}[]. Shared by the align action and the lightweight
// poll the panel uses to swap the button icons live.
function lineup_collectSelectedKeyGroups(comp) {
    var groups = [];
    var layers = comp.selectedLayers;
    for (var i = 0; i < layers.length; i++) {
        var sel = layers[i].selectedProperties;
        if (!sel) continue;
        for (var j = 0; j < sel.length; j++) {
            var prop = sel[j];
            if (!(prop instanceof Property) || prop.numKeys < 1) continue;
            var indices = [];
            for (var k = 1; k <= prop.numKeys; k++) {
                if (prop.keySelected(k)) indices.push(k);
            }
            if (indices.length > 0) groups.push({ prop: prop, indices: indices });
        }
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

// Cheap poll target for the Favorites bar's smart-stack switch: "1" as soon
// as the selection includes a shape layer. Unlike lineup_shapeColorHudTargetLayers
// (which falls back to every shape layer in the comp when nothing's
// selected, for the HUD's own display purposes), this only ever looks at
// the actual selection — an empty selection is "0", not "there happen to
// be shape layers in this comp."
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

// Moves one keyframe to newTime, preserving value/interpolation/ease/spatial
// tangents as best it can. AE has no "move this keyframe's time" call, so this
// removes and re-adds it — best-effort restoration is wrapped per-field so a
// failure to restore a cosmetic (ease/tangent) detail doesn't lose the move.
function lineup_retimeKey(prop, keyIndex, newTime) {
    if (prop.keyTime(keyIndex) === newTime) return;
    try { if (prop.keyRoving(keyIndex)) return; } catch (e) {}

    var value   = prop.keyValue(keyIndex);
    var inType  = prop.keyInInterpolationType(keyIndex);
    var outType = prop.keyOutInterpolationType(keyIndex);
    // Ease/auto-bezier/continuous only mean anything (and are only readable
    // as meaningful) when BOTH sides are Bezier — restoring them on a
    // Linear/Hold key is what was silently flipping it back to Bezier, since
    // setTemporalEaseAtKey only makes sense for — and forces — a Bezier key.
    var bothBezier = (inType === KeyframeInterpolationType.BEZIER && outType === KeyframeInterpolationType.BEZIER);
    var inEase = null, outEase = null, wasAutoBezier = false, wasContinuous = false;
    var inTan = null, outTan = null, isSpatial = false, wasSpatialContinuous = false, wasSpatialAutoBezier = false;

    if (bothBezier) {
        try { inEase  = prop.keyInTemporalEase(keyIndex); }  catch (e) {}
        try { outEase = prop.keyOutTemporalEase(keyIndex); } catch (e) {}
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

    prop.removeKey(keyIndex);
    prop.setValueAtTime(newTime, value);
    var ni = prop.nearestKeyIndex(newTime);

    try { prop.setInterpolationTypeAtKey(ni, inType, outType); } catch (e) {}

    if (bothBezier) {
        if (wasAutoBezier) {
            // Auto-Bezier computes its own ease from the surrounding keys —
            // just flip the flag back on rather than fighting it with the
            // stale explicit values captured above.
            try { prop.setTemporalAutoBezierAtKey(ni, true); } catch (e) {}
        } else if (inEase && outEase) {
            try { prop.setTemporalEaseAtKey(ni, inEase, outEase); } catch (e) {}
            try { prop.setTemporalContinuousAtKey(ni, wasContinuous); } catch (e) {}
        }
    }

    if (isSpatial) {
        try { prop.setSpatialTangentsAtKey(ni, inTan, outTan); } catch (e) {}
        try { prop.setSpatialContinuousAtKey(ni, wasSpatialContinuous); } catch (e) {}
        if (wasSpatialContinuous && wasSpatialAutoBezier) {
            try { prop.setSpatialAutoBezierAtKey(ni, true); } catch (e) {}
        }
    }
    // Not reselected here — removeKey/setValueAtTime on a LATER key of this
    // same property can clear selection on keys already processed, so
    // reselection happens in one final pass after every key has moved (see
    // lineup_alignKeyframes below) instead of per-key here.
}

function lineup_roundToFrame(t, frameDuration) {
    return Math.round(t / frameDuration) * frameDuration;
}

// alignIdx here is always 0 (left), 1 (centerX) or 2 (right).
// Each property's own selected keys form a bounding box [earliest, latest]
// (a single selected key is just a zero-width box). Left/Center/Right moves
// that box's left/center/right edge to a shared target, then shifts every
// key in the box by the SAME delta — a rigid translation, so relative
// timing and easing between the keys is untouched no matter how many are
// selected on that property. The target itself is shared across every
// property being aligned (mirroring how position-align shares one anchor
// across layers): Selection mode uses the earliest/playhead/latest time
// found anywhere in the whole selection; Composition mode uses the
// playhead/comp's center frame/comp's last frame.
function lineup_alignKeyframes(alignIdx, alignToSelection, comp, groups) {
    try {
        var allTimes = [];
        for (var g = 0; g < groups.length; g++) {
            var grp = groups[g];
            for (var i = 0; i < grp.indices.length; i++) allTimes.push(grp.prop.keyTime(grp.indices[i]));
        }
        if (allTimes.length === 0) return "ERROR: No keyframes selected";

        var target;
        if (alignIdx === 0) {
            target = alignToSelection ? Math.min.apply(Math, allTimes) : comp.time;
        } else if (alignIdx === 2) {
            target = alignToSelection ? Math.max.apply(Math, allTimes) : (comp.duration - comp.frameDuration);
        } else {
            target = alignToSelection ? comp.time : lineup_roundToFrame(comp.duration / 2, comp.frameDuration);
        }

        app.beginUndoGroup("Align Keyframes");
        var newTimesByGroup = [];
        for (var g = 0; g < groups.length; g++) {
            var prop = groups[g].prop;
            var origTimes = [];
            for (var i = 0; i < groups[g].indices.length; i++) origTimes.push(prop.keyTime(groups[g].indices[i]));

            var boxMin = Math.min.apply(Math, origTimes);
            var boxMax = Math.max.apply(Math, origTimes);
            var delta;
            if (alignIdx === 0)      delta = target - boxMin;
            else if (alignIdx === 2) delta = target - boxMax;
            else                     delta = target - (boxMin + boxMax) / 2;

            // Each key ends up at its own distinct new time (a rigid shift,
            // not a collapse onto one point), so — unlike a collapse — no
            // two originally-selected keys on this property can land on the
            // same time and collide; re-locating by ORIGINAL time via
            // nearestKeyIndex right before moving each one is still what
            // keeps this correct as sibling moves shift indices around.
            var newTimes = [];
            for (var i = 0; i < origTimes.length; i++) {
                var nt = origTimes[i] + delta;
                newTimes.push(nt);
                lineup_retimeKey(prop, prop.nearestKeyIndex(origTimes[i]), nt);
            }
            newTimesByGroup.push(newTimes);
        }
        // Reselect every shifted key at its own new time — the whole box
        // moved together rather than collapsing onto one point, so (unlike
        // before) there can be several surviving keys per property to
        // reselect, not just one. Done last since AE can clear a property's
        // keyframe selection as a side effect of the removeKey/
        // setValueAtTime calls above. Deliberately does not set
        // prop.selected — that selects the whole property, which in turn
        // marks every keyframe on it selected, not just the moved ones.
        for (var g = 0; g < groups.length; g++) {
            var prop = groups[g].prop;
            var newTimes = newTimesByGroup[g];
            for (var i = 0; i < newTimes.length; i++) {
                try { prop.setSelectedAtKey(prop.nearestKeyIndex(newTimes[i]), true); } catch (e) {}
            }
        }
        app.endUndoGroup();
        return "ok";
    } catch (err) {
        try { app.endUndoGroup(); } catch (e) {}
        return "ERROR: " + err.toString();
    }
}

// ── SHAPE ALIGN ───────────────────────────────────────────────────────────────
// All 6 buttons redirect here whenever a shape-layer Contents item (a Group,
// or a Rect/Ellipse/Star/Path directly) is selected on a selected layer —
// unlike keyframes, shapes have real width/height, so vertical align applies
// same as horizontal. Each item's own bounding box lives in whatever
// coordinate space its immediate parent (a nested Group, or the layer itself)
// defines, so getting it into comp space — and an align delta back down to
// that item's own position — means walking the FULL chain: every ancestor
// Group's own transform (position/anchor/scale/skew/rotation), then the
// layer's own transform, then the layer's parent chain (reusing
// compDeltaToPositionDelta/oneLevelDelta/LST.toComp for that last stretch,
// same as plain layer align already does).
// Caveat: the 2D-only math here (no camera-perspective correction, unlike
// getLayerCompBounds' 3D refinement loop) assumes the layer itself isn't
// 3D-tilted — fine for the vast majority of (2D) shape layers.

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

function lineup_hasSelectedShapeItems() {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return "0";
        return lineup_collectSelectedShapeItems(comp).length > 0 ? "1" : "0";
    } catch (err) {
        return "0";
    }
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

// Walks from a shape item up to (but not including) the layer, collecting
// every ancestor "ADBE Vector Group" it's nested inside — immediate parent
// group first, outward. Skips over the plain "ADBE Vectors Group"/"ADBE Root
// Vectors Group" content-list wrappers that sit between groups (they carry
// no transform of their own).
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

// Bounding box of one Contents item, in whatever space its immediate parent
// (a Group's own Contents list, or the layer's root Contents) defines — a
// Group's own transform is already applied here (via
// lineup_transformBBoxThroughGroup), so the result is ready to union with
// sibling items in that same parent space.
function lineup_shapeItemBBoxInParentSpace(item) {
    var mn = item.matchName;
    if (mn === "ADBE Vector Shape - Rect" || mn === "ADBE Vector Shape - Ellipse") {
        var posName = (mn === "ADBE Vector Shape - Rect") ? "ADBE Vector Rect Position" : "ADBE Vector Ellipse Position";
        var sizeName = (mn === "ADBE Vector Shape - Rect") ? "ADBE Vector Rect Size" : "ADBE Vector Ellipse Size";
        var pos = item.property(posName).value, size = item.property(sizeName).value;
        return { left: pos[0]-size[0]/2, top: pos[1]-size[1]/2, right: pos[0]+size[0]/2, bottom: pos[1]+size[1]/2 };
    }
    if (mn === "ADBE Vector Shape - Star") {
        // Treated as its bounding circle (outer radius) rather than the exact
        // rotated star/polygon envelope — a safe superset, and exact for the
        // common case of Type = Polygon or a symmetric star.
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
            // Tangent handles can pull a bezier segment's curve outside the
            // vertex hull — including vertex+tangent as candidate points
            // keeps this a safe (if not perfectly tight) superset.
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

// Comp delta -> the delta to add to this shape item's own position, walking
// the same chain as lineup_shapeItemCompBounds in reverse: ancestor-layer
// chain, the layer's own transform, then every ancestor Group's own
// transform (outermost group first, mirroring compDeltaToPositionDelta's
// own top-down ancestor walk).
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

// ── SHAPE TOOLS ───────────────────────────────────────────────────────────────

// Command 2536, "RevealinTimeline" — a numeric executeCommand id (stable
// across UI languages, unlike a findMenuCommandId string lookup) that
// expands/scrolls the Timeline to whatever's currently selected. There is
// no scriptable "expanded" property on a layer or property group at all
// (confirmed against the AE scripting community — selecting a property
// via .selected=true does NOT by itself twirl its ancestor groups open in
// the Timeline panel), so this is the only way to actually satisfy
// "expand the layer so you can see what's selected" rather than just
// leaving the selection correct-but-invisible. Wrapped in its own
// try/catch since executeCommand can throw if the Timeline isn't the
// relevant frontmost context for some reason — that's not worth failing
// the whole selection over.
function lineup_revealInTimeline() {
    try { app.executeCommand(2536); } catch (e) {}
}

// Clears whatever's currently selected on each of these layers' own
// property tree before selecting something new. .selected=true is purely
// additive — none of the three selection modes below cleared anything
// previously selected on their own, so e.g. selecting Fills right after
// selecting Path just added the Fill color to that still-selected Path
// instead of replacing it. Each mode is meant to be exclusive (only ITS
// OWN target properties end up selected), hence clearing first here.
// Snapshotted into a plain array before deselecting since
// selectedProperties may be a live view that a mid-loop selected=false
// could otherwise shift under our own iteration.
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

// Selects the Path property ("ADBE Vector Shape", inside a free-form
// "ADBE Vector Shape - Group" item) of every path-based shape in each
// selected shape layer. Silently does nothing (no error toast) for a
// selected layer that isn't a shape layer, or a shape layer with no
// path-based shapes inside it — Rect/Ellipse/Star items have no single
// equivalent "Path" property to select, so they're left alone too.
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

// Recursively walks a vector Contents list (the root "ADBE Root Vectors
// Group" itself, or a nested Group's own "ADBE Vectors Group") selecting
// the Path property of every free-form path item found. Returns true if
// anything was selected.
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

// Selects the Color property of every Fill ("ADBE Vector Graphic - Fill" ->
// "ADBE Vector Fill Color") or Stroke ("ADBE Vector Graphic - Stroke" ->
// "ADBE Vector Stroke Color") group across every selected shape layer,
// depending on which matchNames are passed — the two exported entry
// points below just fix those. Same silent-no-op behavior as
// lineup_selectAllPaths for anything that doesn't apply.
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

// Recursively walks a vector Contents list selecting `colorMatchName` off
// every `groupMatchName` item found (Fill/Stroke groups are direct
// Contents children, siblings of shape items and nested Groups, same
// level lineup_selectPathsInVectorsGroup/lineup_collectStrokesInVectorsGroup
// already walk). Returns true if anything was selected.
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

// Cycles every Stroke's Line Cap (Butt -> Round -> Projecting -> Butt)
// across all selected shape layers, using the FIRST stroke found (in
// traversal order — layer selection order, then depth-first through each
// layer's own Contents) as the reference for which value comes next, then
// applies that same new value to every stroke found — normalizing any
// layers/shapes that currently differ into one consistent state rather
// than cycling each independently. Line Join comes along for the ride
// (Butt->Miter, Round->Round, Projecting->Bevel all share the same
// underlying index, 1/2/3, so the join just gets set to the same new
// value as the cap) unless capOnly is truthy, in which case only the cap
// changes and each stroke's own existing join is left untouched. Silently
// does nothing if no selected layer has a stroke.
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
// PropertyGroup has no scriptable "move to a different layer" method —
// duplicate()/addProperty() only ever operate within their own existing
// parent. The first version of this moved content across layers via AE's
// own Copy/Paste (app.executeCommand) — the commonly-cited technique for
// this exact problem, but it turned out to silently no-op when invoked
// from a CEP panel script: Copy/Paste's behavior depends on the Timeline
// actually having focus the way it does during real interactive use,
// which a script triggered from an external panel never gives it —
// producing the right NUMBER of new layers but every one empty. Rebuilt
// below to clone shape content by VALUE instead (addProperty + copying
// each leaf property's current value across, recursively), which has no
// dependency on clipboard/panel-focus state at all. 2D layers only
// (matches Shape Align's own scope) — no 3D tilt/camera correction.
// Keyframes on any per-shape or per-layer property are NOT reproduced,
// only each layer's/item's current static values, per the "ignore
// keyframes for now" scope.

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

// Adds a new property of the same matchName as `sourceItem` into
// `targetGroup` (addProperty creates it with AE's own default structure
// for that type) and copies every one of its values across from source,
// recursively. Returns the new clone, or null if this matchName couldn't
// be added (some properties genuinely aren't independently addable —
// skipped rather than failing the whole clone).
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

// Mirrors the copyProperties() approach from a published, field-tested
// "Explode Shape Layer" script, with one correction: that reference
// (and an earlier version of this function) matched every child by name —
// target.property(matchName) — on the theory that a freshly-added parent's
// fixed sub-properties (a Path item's own Shape/Direction, a Transform
// Group's Position/Rotation/..., a single Fill's Color/Opacity) already
// exist and just need finding, while an empty Contents-list child comes
// back null and gets added fresh, with no need to tell the two cases
// apart. That holds for NAMED_GROUP parents (each named child appears
// exactly once), but a repeatable/orderable INDEXED_GROUP parent — a
// shape's own Contents ("ADBE Vectors Group"/"ADBE Root Vectors Group") or
// a Group's own Contents — can hold several SIBLINGS with the identical
// matchName (e.g. two "ADBE Vector Shape - Group" paths under one Merge
// Paths). Matching those by name found the first path's already-cloned
// property again on the second path's turn, overwriting it in place
// instead of adding a second one — silently collapsing N paths/fills/
// groups down to whichever was copied last. INDEXED_GROUP parents now
// always addProperty a fresh sibling per source child instead.
// typeof .setValue === 'function' is how a leaf (settable) property is
// told apart from a group still needing its own recursion.
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

// Where `source`'s own layer transform (position/rotation/scale, current
// values only) would need to sit if expressed as a Vector Group's own
// transform living inside `target`'s Contents, so pasting source's
// content there and applying this renders at the same comp-space spot.
// Derived by round-tripping source's local origin and two unit axes
// through comp space (via this file's own toComp/fromComp pair, above —
// AE's ExtendScript Layer object has no such methods of its own; those
// only exist inside expressions, evaluated by the expression engine, not
// the host-script object model) and back into target's local space —
// same idea as lineup_vecTransformPoint elsewhere in this file, just one
// level up (layers instead of shape groups), and layers have no skew to
// account for. The signed area (cross product) of the two mapped axes
// flips under a mirrored/negative scale, which plain vector lengths would
// otherwise lose, so that sign gets folded into scaleY.
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

// Merges every selected shape layer into the FIRST one selected (which
// survives) — every other selected shape layer's whole Contents becomes
// one new Vector Group inside the survivor, transformed to land in
// exactly the same comp-space spot/rotation/scale it had as its own
// layer, then the emptied source layer is deleted (or, with
// keepOriginals, just switched off — see lineup_explodeShapes below for
// the same choice). No-op (silently, no error) with fewer than 2 shape
// layers selected.
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
        // Every source is fully merged in BEFORE any of them are removed —
        // removing a layer can invalidate other Layer/PropertyGroup object
        // references already held on other layers in the same comp, which
        // is exactly what broke merging a 3rd+ selected layer: source #2's
        // own reference (captured into shapeLayers up front, same as
        // source #1's) had already gone stale by the time its turn came,
        // right after source #1's mid-loop .remove() call.
        var toRemove = [];
        for (var i = 1; i < shapeLayers.length; i++) {
            var source = shapeLayers[i];
            var xform = lineup_layerRelativeTransform(source, target);

            // Re-fetched fresh every iteration rather than cached once
            // above the loop — target.addProperty() on the previous
            // iteration can invalidate a PropertyGroup reference obtained
            // before that mutation, which is what threw "null is not an
            // object" merging a 3rd layer even after deferring removal.
            var targetRoot = target.property("ADBE Root Vectors Group");

            // One new wrapper group per source layer, holding a clone of
            // every one of its top-level items — a single unified
            // transform (xform) then goes on the wrapper regardless of
            // how many items source actually had.
            var wrapGroup = targetRoot.addProperty("ADBE Vector Group");
            wrapGroup.name = source.name;
            var wrapContents = wrapGroup.property("ADBE Vectors Group");
            var srcRoot = source.property("ADBE Root Vectors Group");
            for (var p = 1; p <= srcRoot.numProperties; p++) {
                lineup_cloneShapeItemInto(srcRoot.property(p), wrapContents);
            }

            // Position/Rotation/Scale live under the group's own Transform
            // Group, not as direct children of the group itself (same
            // pattern as lineup_transformBBoxThroughGroup/
            // lineup_applyShapeVec2Delta elsewhere in this file) —
            // wrapGroup.property("ADBE Vector Position") is null, and
            // .setValue on that is exactly what threw "null is not an
            // object" here.
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

// Splits every selected shape layer that has 2+ top-level Contents GROUPS
// ("ADBE Vector Group") into that many separate new shape layers, one per
// group — each group is moved over whole, with everything nested inside it
// (paths, Fill/Stroke, Merge Paths, Trim Paths, Repeaters, sub-groups...)
// intact, since lineup_cloneShapeItemInto deep-clones the whole property
// tree of whatever single item it's given. A layer only qualifies if EVERY
// one of its top-level Contents items is itself a Group — if any top-level
// item is a bare Path/Fill/Stroke/Merge Paths/etc. sitting ungrouped
// alongside others (e.g. two paths combined by a Merge Paths "Difference"
// set directly at the root, like a hand-drawn letter "O"), that layer is
// left alone entirely rather than explode it: those raw siblings only
// render correctly together (Merge Paths only merges paths that are its
// own siblings within the same Contents list), so splitting them one item
// per layer would silently break the merge and drop pieces — group them
// yourself first (Cmd/Ctrl+G) if you want to explode that content later.
// Each new layer's own transform is just a direct copy of the ORIGINAL
// layer's (position/rotation/scale/anchor/opacity/parent/timing), since the
// group itself is moved over unchanged; the original layer's transform
// composed with the group's own (unchanged) internal transform is what
// rendered it before, and that's exactly reproduced by giving the new layer
// that same outer transform. The original layer is then deleted — or, with
// keepOriginals, kept but switched off (its Video/eye toggle turned off)
// instead, so nothing is lost. Every new layer created ends up selected
// (and nothing else), regardless of how many original layers were
// exploded. No-op (silently) if no selected shape layer qualifies.
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
        // Every candidate is fully exploded into its new layers BEFORE any
        // original is removed — same reasoning as Merge Shapes above:
        // removing a layer can invalidate other, already-captured Layer
        // object references (here, the rest of `candidates`), so all the
        // removals are deferred to their own pass at the end instead of
        // being interleaved mid-loop.
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
// Splits each selected text layer into one new layer per character, word,
// line, or paragraph — a real split (each new layer's own source text is
// just that unit), positioned to land exactly where that unit rendered in
// the original.
//
// Position comes from a scratch duplicate carrying a temporary Text
// Animator: one Range Selector, set to select by index with its Mode set
// to Subtract — which inverts it, so a sliding one-unit-wide index window
// is what's left alone while everything else gets selected — driving a
// Scale property down to [0,0,100]. Everything outside the current unit
// collapses to nothing, so sourceRectAtTime() on the whole (still fully
// intact) layer reduces to just that one unit's real, correctly
// kerned/wrapped/justified bounds, straight from After Effects' own text
// engine rather than reconstructed from measuring substrings (which loses
// kerning context at whatever boundary got cut).
//
// Alt-click (keepOriginals) parents every split layer to one new null
// carrying the original's own Anchor Point/Position/Scale/Rotation/
// Opacity, resets each split layer's own anchor to [0,0], and sets its
// Position directly to (that unit's measured center) minus (the new
// layer's own natural center, measured fresh once its text is set) —
// since a layer anchored at [0,0] renders its local origin exactly at
// Position, this lands its content's own center on the target regardless
// of where the content's natural local origin happens to sit, with no
// assumption that two different layers share a coordinate frame. Only
// the null needs to account for the original's transform this way — the
// split layers themselves just do plain 2D placement in the null's space.
//
// Without Alt, there's no null: each split layer keeps the original's own
// anchor/position/scale/rotation/parent untouched, and gets nudged by a
// comp-space delta instead — toComp() gives the true comp-space point the
// unit measured at and the point the layer's own (now-shrunk) content
// currently renders at, and compDeltaToPositionDelta()/shiftPosition()
// turn the difference into a Position adjustment that already accounts
// for the layer's own rotation/scale and its parent chain.
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

// Recursively walks a vector Contents list (same traversal shape as
// lineup_selectColorPropsInVectorsGroup above) collecting every Fill/
// Stroke color it finds into `slots` as { prop, value }. Disabled Fill/
// Stroke groups are skipped — an off color isn't worth managing.
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
        // Gradient Fill/Stroke ("ADBE Vector Graphic - G-Fill"/"-G-Stroke")
        // and every other item type (shapes, Transform, Merge/Trim Paths,
        // Repeater, ...) have no solid color of interest — skipped by
        // simply not matching any branch above.
    }
}

// One level deep into every effect on `effectsGroup` (built-in and
// third-party effects are all flat parameter lists — no deeper recursion
// needed) — any parameter whose propertyValueType is COLOR is a color
// control regardless of which effect it belongs to, which is what lets
// this catch "any other examples of color selection" without needing to
// name every effect by hand.
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

// Same idea as lineup_collectEffectColorSlots, one level into "ADBE Layer
// Styles" instead of "ADBE Effect Parade" — Gradient Overlay is skipped
// the same way (name match), everything else (Stroke, Color Overlay,
// Drop Shadow, Inner/Outer Glow's flat-color mode, ...) is fair game.
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

// Every color-bearing property this tool manages on one layer: shape
// Fill/Stroke (shape layers only), plus effects and layer styles (every
// layer type — a text or solid layer with a Fill or Color Control effect
// on it is just as manageable as a shape layer's own Fill).
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

// A text layer's own character Fill/Stroke color (Character panel, not an
// effect/layer style) — read off the whole TextDocument rather than a
// scriptable Property, since AE's scripting API has no per-character-range
// color access; this manages the document's single overall fill/stroke
// color, same "whole thing, not mixed ranges" scope Split Text's own
// caveats elsewhere in this file already accept. Pushed as its own kind
// (not a {prop,value} slot) because a real Property can just get its
// .expression set directly, but fillColor/strokeColor are plain fields on
// the TextDocument value — linking one means re-expressing the whole
// sourceText, which lineup_manageColors below builds once per affected
// layer after grouping (a layer with both a managed fill AND stroke needs
// exactly one combined expression, not two competing ones).
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

// The classic 12-step color-wheel names — matches how a person would
// describe these hues (Red Orange, Blue Green, ...), not a numeric value.
var LINEUP_HUE_NAMES = [
    "Red", "Red Orange", "Orange", "Yellow Orange", "Yellow", "Yellow Green",
    "Green", "Blue Green", "Blue", "Blue Violet", "Violet", "Red Violet"
];

// Low-chroma colors get a lightness-based grayscale name instead of a hue
// name (a barely-tinted near-white shouldn't read as "Blue") — White/
// Black only for the very ends, Light/Dark Gray for the rest, so distinct
// grays still get distinct names without needing a number. Deliberately
// checked against raw max-min channel spread rather than HSL's own
// saturation (lineup_rgbToHsl's `s`) — s's denominator shrinks toward 0 as
// lightness approaches either extreme, so a practically-white color with
// a one-part-in-a-hundred blue tint (e.g. [0.97,0.97,0.98]) computes an
// artificially high s and got named "Blue" instead of "White" before this
// used chroma directly.
// LINEUP_HUE_NAMES (Red, Red Orange, Orange, ... ) is the familiar
// artist's 12-step wheel, built around RYB primaries (Red/Yellow/Blue
// 120° apart) — NOT the same wheel plain RGB hue math measures (Red/
// Green/Blue 120° apart). Mapped straight through with no correction, a
// saturated pure green (RGB hue 120°) lands on "Yellow" instead of
// "Green", since 120° is where the RGB wheel puts green but the RYB-named
// wheel puts yellow. This piecewise-linear remap (anchored at the 6
// primary/secondary hues both wheels agree are red/orange-ish/yellow/
// green/cyan-ish/blue/magenta-ish, even if at different degrees) corrects
// the six broad chunks so each of LINEUP_HUE_NAMES's 12 slices lines up
// with the color a person would actually call by that name.
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

// Groups -> [{ name, value, slots }], numbering every hue-based name that
// has more than one distinct color sharing it ("Red Orange 01"/"Red
// Orange 02", lightest first) while leaving a one-off grayscale name bare
// ("White", not "White 01") — matching how someone would actually label
// these in the Effects panel.
// existingNames (optional — an already-live Color Controller's current
// effect names) lets numbering continue where a PRIOR run left off
// instead of restarting at 01 and colliding with names that are already
// taken — e.g. re-running this on a different batch of layers that
// happens to turn up a second, distinct "Red Orange" should get "Red
// Orange 02", not another "Red Orange 01".
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
            // Skip a prior run's own control null so re-running this on
            // "every layer in the comp" doesn't try to manage its colors.
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

        // Reuse an existing "Color Controller" null rather than always
        // creating a new one — running this again (on the same layers, a
        // different selection, or the whole comp) shouldn't pile up
        // redundant nulls. Its EXISTING Color Control effects are read
        // first so every newly-found color can be matched against them by
        // value: a match reuses that effect (and whatever name the user
        // may have already given it) instead of adding a duplicate: only
        // genuinely new colors get a new effect appended to the same null.
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

        // Text fill/stroke slots can't take an .expression directly (see
        // lineup_collectTextColorSlots) — each one just records which
        // controller effect it resolved to here, and every affected text
        // layer gets exactly one combined sourceText expression built from
        // this list afterward, once every group (matched AND new) has been
        // resolved.
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

        // One combined sourceText expression per affected text layer, built
        // on the Text Style expression API (sourceText.style / setFillColor
        // / setStrokeColor / setText) rather than editing a TextDocument's
        // fillColor/strokeColor fields directly — After Effects expressions
        // don't support Array.prototype.slice, and setFillColor/
        // setStrokeColor is the documented way to change a style's color
        // while setText(value) reapplies it to the property's own actual
        // text content. Overrides only whichever of fill/stroke this run
        // actually linked (leaving the other, if unmanaged, exactly as it
        // already is, since style starts from the CURRENT style).
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
        // Gradient Fill/Stroke ("ADBE Vector Graphic - G-Fill"/"-G-Stroke") and
        // every other item type (shapes, Transform, Merge/Trim Paths, Repeater,
        // ...) simply aren't matched above — no color/width of interest there.
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

// { type: 'none' } | { type: 'color', value: [...] } | { type: 'mix' } — folds
// each slot's own enabled state in: "none" means nothing in scope is actually
// on, "mix" covers both differing colors AND a mix of on/off, "color" only
// when every slot is enabled and shares the same value.
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

// Preserves the property's own existing dimensionality/alpha instead of
// assuming one — AE shape Fill/Stroke colors are commonly [r,g,b] (opacity
// is its own separate property), but setValue on a color property generally
// needs an array matching whatever length it already has, not a guessed one.
function lineup_shapeColorValueForProp(prop, r, g, b) {
    var cur = prop.value;
    return (cur && cur.length > 3) ? [r, g, b, cur[3]] : [r, g, b];
}

// Every setter below re-runs the exact same collection as the getter above
// and indexes into the same flat array — deterministic as long as the shape
// tree hasn't changed since the HUD/popup last polled (a short-lived window
// in practice: the popup is a static snapshot until closed and reopened —
// see main.js). All keyframe-aware: a keyframed property gets a new keyframe
// at the current time instead of having its whole animation overwritten.

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

// Solid Fill/Stroke <-> No Fill/No Stroke — toggles the Fill/Stroke item's
// own .enabled (the same on/off checkbox AE's own Contents panel shows),
// not a color change, so the property's existing color/width is left alone
// and just reappears if the item is switched back on later.
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
// alignIdx: 0=left 1=centerX 2=right 3=top 4=centerY 5=bottom
// alignToSelection: 1=selection bounds 0=comp
// margin: number, usePercent: 0/1, offsetKeys: 0/1
// useKeyframeAlign: 0/1 — the panel's own keyframe-align override toggle
// (see #keyAlignCheck/_keyAlignEffective in main.js), checked by default
// whenever keyframes are selected; unchecking it (while keyframes are still
// selected) forces normal position alignment instead. Omitted entirely ->
// treated as 1, matching the old always-on behavior.

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

            // Comp-space delta Align wants to close, converted to a position-unit
            // delta through this layer's parent chain (see compDeltaToPositionDelta)
            // — this is what keeps alignment correct under a scaled/rotated parent
            // (a null, a rig, ...) instead of assuming 1 position unit always equals
            // 1 comp pixel.
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

            // 3D layers with real depth can additionally be skewed by camera
            // perspective, which compDeltaToPositionDelta doesn't model (it's the
            // parent chain's linear rotation+scale only) — refine by re-measuring
            // the actual bounding rect and correcting the residual the same way
            // until it converges.
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
            // mode 0: end layers flush against comp edges (shift rStart/rEnd inward by each end layer's half-size)
            // mode 1: end layers stay put, middles distributed by center between them
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
            try { var ar=layers[ai].sourceRectAtTime(comp.time,false); applyAnchorShift(layers[ai],anchorLocToPoint(4,ar.width,ar.height,ar.left,ar.top)); } catch(e) {}
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
            try { var ar=layers[ai].sourceRectAtTime(comp.time,false); applyAnchorShift(layers[ai],anchorLocToPoint(4,ar.width,ar.height,ar.left,ar.top)); } catch(e) {}
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

        // Manual Gap overrides space cells by an exact pixel gap, edge-to-edge,
        // with the resulting grid re-centered on the comp/selection center —
        // taking precedence over both the auto-computed gap and Align Edges,
        // independently per axis.
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
// mode: 0=Horizontal 1=Vertical 2=Both, sizeMode: 0=comp 1=selection 2=keyLayer
// crop: 0=Stretch 1=Crop (proportional — grows the other axis / covers the target)
// move: 0/1 — center each layer's bounds in the target before scaling

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

                var rect = layer.sourceRectAtTime(t, false);
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
// loc: 0-8 (TL,TC,TR, ML,C,MR, BL,BC,BR)
// anchorMode: 0=object (layer source bounds)  1=selection (combined bounds)  2=comp

function lineup_anchorMove(loc, anchorMode, ignoreMasks) {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem && comp.selectedLayers.length > 0)) return "ERROR: No layers selected";
        var labels=["Top Left","Top Center","Top Right","Middle Left","Center","Middle Right","Bottom Left","Bottom Center","Bottom Right"];
        app.beginUndoGroup("Set Anchor: " + labels[loc]);
        var layers = comp.selectedLayers;

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
                applyAnchorShift(layer, anchorLocToPoint(loc,r.width,r.height,r.left,r.top));
            } else if (anchorMode === 1) {
                // Selection: snap to position within combined bounding box of all selected layers
                pasteAnchor(layer, anchorLocToPoint(loc, selMaxX-selMinX, selMaxY-selMinY, selMinX, selMinY));
            } else {
                // Composition: snap to comp bounds
                pasteAnchor(layer, anchorLocToPoint(loc,comp.width,comp.height,0,0));
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

        var nl = comp.layers.addNull();
        nl.name = "Null";
        nl.position.setValue([x, y]);
        var topIdx = 1;
        for (var i=0; i<layers.length; i++) { if (layers[i].index < topIdx || topIdx===1) topIdx = layers[i].index; }
        nl.moveToBeginning();
        if (topIdx > 1) nl.moveBefore(comp.layer(topIdx));
        for (var i=0; i<layers.length; i++) layers[i].parent = nl;
        app.endUndoGroup();
        return "ok";
    } catch (err) {
        try { app.endUndoGroup(); } catch(e) {}
        return "ERROR: " + err.toString();
    }
}

// ── EASE COPY ─────────────────────────────────────────────────────────────────

// KeyframeEase arrays are per-dimension (Position on a 3D layer has 3, Opacity has
// 1, etc). Pasting ease copied from one property onto a differently-dimensioned
// property must resize to fit, or setTemporalEaseAtKey throws (silently swallowed
// by the caller's catch) and the target keeps whatever default ease it already had
// instead of the copied curve. Broadcasts a 1-dim source across all target dims,
// and otherwise pads/truncates by repeating the last value.
function adaptEaseDims(arr, dimN) {
    if (!arr || arr.length === 0 || !dimN || arr.length === dimN) return arr;
    var out = [];
    for (var d=0; d<dimN; d++) out.push(arr[d < arr.length ? d : arr.length-1]);
    return out;
}

// Elementwise (v2 - v1), for either plain numbers (Rotation, Opacity, ...) or
// per-dimension arrays (Position, Scale, ...). Returns null when either side
// is missing/non-numeric so callers can treat "no delta" as "don't know the
// direction" rather than accidentally treating a 0 as "no change".
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

// A copied ease's speed is signed to the direction the source value was
// moving in (see main.js's _easeSegmentSamples, which reconstructs the same
// bezier handles from speed * dt). Pasting that speed verbatim onto a
// segment moving the opposite way — increasing angle's ease pasted onto a
// decreasing one — would ease toward the wrong direction, so per dimension,
// flip the speed's sign whenever the source and target segments disagree on
// direction. Influence (0-100%) has no direction and is left alone.
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

// Applies a copied ease template entry to one target keyframe. Order matters:
// setTemporalEaseAtKey force-promotes both sides of the key to Bezier as a side
// effect (that's the AE API, not a bug here), so it has to run FIRST; the real
// interpolation type — which may be Hold or Linear on one or both sides — is
// (re)applied AFTER, which is what actually restores Hold/Linear. Doing it in the
// old order (type, then ease) let the ease call silently re-promote a just-set
// Hold side back to Bezier, and skipping the ease call for any non-Bezier side (as
// a previous fix did) lost the real ease on the side that *was* Bezier too.
//
// src.inEase/inType and src.outEase/outType may each be null — ease copy only
// captures the side of a keyframe that borders another copied keyframe (see
// lineup_easeCopy), so the first copied keyframe has no inEase and the last has
// no outEase. A null side here means "leave whatever this target keyframe
// already has alone", so it falls back to the target's own current ease/type
// instead of being overwritten with the source's unrelated far side.
// tInDelta/tOutDelta are the target segment's own value deltas, used to flip
// the copied speed's sign when the target is moving the opposite direction
// from the source (see directionalizeEase).
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
        // A keyframe's inEase/outEase describes the segment on that side of it
        // (in = segment from the previous keyframe, out = segment to the next).
        // Only the segments *between two copied keyframes* are a real "copied
        // transition" — the first copied keyframe's in-side and the last one's
        // out-side border keyframes outside the copy, so those sides are left
        // uncaptured (null) rather than grabbing ease data that has nothing to
        // do with what was actually selected. A lone selected keyframe has no
        // such neighbor on either side, so both sides are captured as-is.
        // inDelta/outDelta record which way the value was moving across that
        // segment (see valueDelta), so paste can detect a reversed direction
        // and flip the copied speed's sign (see directionalizeEase).
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

        var template = null;
        for (var l=0; l<layers.length; l++) {
            var res=[]; collectEase(layers[l], res);
            if (res.length > 0) { template=res; break; }
        }
        if (!template) return "";

        _easeClipboard     = template;
        _easeClipboardType = template[0].outType;
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

// Every target in a group shares the same property, so its keyframes' values
// can be snapshotted once per group. Snapshotting up front (rather than
// re-reading keyValue per target inside the paste loop) matters for
// easeValuePaste specifically: it overwrites each target's value as it goes,
// so reading live would mix an already-pasted neighbor's new value with a
// not-yet-pasted one's old value and could misdetect direction mid-group.
function snapshotEaseValues(targets) {
    var vals = [];
    for (var i=0; i<targets.length; i++) {
        try { vals.push(targets[i].prop.keyValue(targets[i].keyIdx)); } catch(e) { vals.push(null); }
    }
    return vals;
}

// The target's own (pre-paste) value deltas across the segments bordering
// targets[t], to compare against the copied src's deltas for a direction
// mismatch (see directionalizeEase). Only computed on the side(s) src
// actually captured.
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

function lineup_easeValuePaste() {
    try {
        var comp = app.project.activeItem;
        if (!(comp instanceof CompItem)) return "ERROR: No active composition";
        if (!_easeClipboard) return "ERROR: No easing copied";
        var n=_easeClipboard.length, layers=comp.selectedLayers;

        var easingsPasted=0, propertiesPasted=0, layersPasted=0;
        app.beginUndoGroup("Paste Ease + Value");
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
                        if (src.value !== null && src.value !== undefined) ref.prop.setValueAtKey(ref.keyIdx, src.value);
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

function lineup_easeClear() { _easeClipboard=null; _easeClipboardType=null; return "ok"; }

// ── Ease preview data (live curve/speed graph) ──────────────────────────────
// Plain-object projection of _easeClipboard for the panel to draw from —
// deliberately NOT the same objects Paste uses (those need real
// KeyframeEase instances for setTemporalEaseAtKey), and interpolation type
// is classified into a plain string here since the panel has no access to
// the KeyframeInterpolationType enum to compare against.
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
        return JSON.stringify(out);
    } catch (err) {
        return "null";
    }
}

// Influence AE's own default (33.33%) gets stretched a bit further out —
// still a gentle ease, just with a bit more of the segment shaped by it.
var LINEUP_BEZIER_DEFAULT_INFLUENCE = 45;

// A fresh temporal ease for a keyframe newly switched to Bezier.
//
// zeroVelocity=true (Ctrl-click): speed always 0, same as AE's own Easy
// Ease keyframe assistant — a simple, predictable default.
//
// zeroVelocity=false (default): speed is the median (average) of this
// keyframe's incoming and outgoing velocity (the neighboring keyframes'
// own value/time deltas), so the new ease reflects the motion already
// passing through this keyframe instead of flattening it. Exception: if
// incoming and outgoing velocity disagree in sign (a peak or valley —
// motion reverses direction right at this keyframe), speed is forced to 0
// instead of averaging two opposite-signed numbers into something that
// doesn't represent either side.
//
// Spatial properties (Position, and Anchor Point/etc. whenever isSpatial)
// get exactly ONE KeyframeEase regardless of how many value dimensions
// they have — AE's temporal ease for a spatial property describes progress
// ALONG the path (a single scalar "how fast in time"), not a per-axis
// rate; the path's actual shape is a separate concept governed by spatial
// tangents. Passing one entry per dimension there is what
// setTemporalEaseAtKey's own "Value array does not have 1 elements" error
// was rejecting. Speed for that one entry is the magnitude of the multi-
// dimensional velocity vector (matching AE's own Graph Editor) — inherently
// non-negative, so the sign-disagreement rule above doesn't apply there;
// the two magnitudes are simply averaged.
//
// Non-spatial properties (Scale, Color, Opacity, Rotation, ...) get one
// KeyframeEase per value dimension instead, each with its OWN signed speed
// (AE's KeyframeEase.speed is meaningfully signed — see directionalizeEase
// above, which flips it to indicate the opposite direction).
//
// Either way, a keyframe with only one neighbor (first/last key) just uses
// that single side's velocity; one with no neighbors at all (a lone
// keyframe) falls back to 0.
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

// Backs the quick-swap interpolation buttons — applies to every currently
// selected keyframe across every selected layer/property (same scope as
// pressing an interpolation shortcut in AE itself), not just whatever the
// graph happens to be showing. kind is one of "hold"/"linear"/"bezier"/
// "autobezier"/"continuousbezier". Auto/Continuous Bezier are both real
// Bezier interpolation underneath — they only differ by the
// setTemporalAutoBezierAtKey/setTemporalContinuousAtKey flags layered on
// top, same API lineup_retimeKey above already relies on to restore them.
//
// setTemporalEaseAtKey has to run BEFORE setInterpolationTypeAtKey, not
// after — same ordering (and the same reason) as applyPastedEase above:
// setTemporalEaseAtKey force-promotes both sides of the key to Bezier as an
// AE API side effect, so calling it AFTER the type was already (re)set is
// what was silently leaving the key on whatever placeholder ease a plain
// script-side type flip gets (near-zero speed, negligible influence) —
// the type call was landing last and nothing after it ever touched ease
// again. Type is (re)applied after ease for the same reason
// applyPastedEase does: it's what actually settles the key on Bezier
// (autoBezier/continuous flags only make sense once that's confirmed, so
// those still come last, mirroring lineup_retimeKey's own ordering).
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
                        // Auto-Bezier computes its own ease from the surrounding keys
                        // once the flag is on — no ease to set by hand, so ordering
                        // relative to the type call doesn't matter here.
                        prop.setInterpolationTypeAtKey(k, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
                        try { prop.setTemporalAutoBezierAtKey(k, true); } catch (e2) {}
                    } else if (kind === "continuousbezier") {
                        // isSpatial (Position, etc.) needs exactly one KeyframeEase
                        // covering the whole path, not one per value dimension — see
                        // _lineup_bezierDefaultEase's own comment for why. Whole
                        // computation+apply stays one try/catch (not just the
                        // setTemporalEaseAtKey call) since _lineup_bezierDefaultEase
                        // itself calls back into the AE DOM and can throw too — left
                        // unguarded, that exception was escaping to the outer
                        // per-keyframe catch and skipping the type change entirely,
                        // which is why interpolation wasn't changing at all.
                        //
                        // Re-applied a second time AFTER setTemporalContinuousAtKey —
                        // turning Continuous on appears to trigger AE's own ease
                        // recompute as a side effect (the same class of thing Auto
                        // Bezier does deliberately), which was overwriting a genuinely
                        // 0 velocity back to some nonzero AE-computed value. Setting
                        // it again last is what makes it actually stick.
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
// Recursively duplicates a comp and every nested precomp used inside it, so the
// copy is fully independent of the original — editing one never touches the
// other. Names are versioned (Comp -> Comp_2 -> Comp_3 ...) and each duplicate
// is placed in the same Project panel folder as its original. A comp used more
// than once inside the same tree is only duplicated once and shared by every
// reference to it, mirroring the original structure.
//
// If precomp layers are selected in the active comp's timeline, each one gets
// its own independent deep duplicate and that layer's source is swapped to it
// in place. Otherwise it deep-duplicates whichever comp(s) are selected in the
// Project panel.

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

// Extension -> target-bucket key. Only file types AE can actually hold as a
// FootageItem are listed; anything else is left where it is rather than guessed at.
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

// Folders drawn from a preset's tree carry an explicit "role" only when the
// panel created them as one of Heist's built-ins (see _structMakeNode in
// main.js) — that's what lets the sorter keep finding "the PSD folder" etc.
// even after the user renames that node. Anything else (every folder in a
// custom preset, or a Heist node the user re-typed a brand new child under)
// has no role, so it's matched here by name instead — same keywords, so
// naming a custom folder "PSD" or "Audio" gets the same routing for free.
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

// Walks a parsed preset tree, creating/reusing folders under `parent` (reusing
// by exact name match, so re-applying the same preset is idempotent). Depth-0
// folders are collected into topFolders (used to tell "part of this structure"
// apart from a pre-existing foreign folder); every folder's role — explicit or
// name-inferred — is recorded into roleFolders (first match wins on collision).
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

        // Recursively pulls every Comp/Footage item out of a foreign folder tree,
        // sorts each one into its proper bucket, then deletes folders left empty
        // behind it. Items we can't classify (no matching extension, or a role
        // this preset doesn't have a folder for) are left in place, which also
        // leaves their containing folder un-deleted — nothing unclassified is
        // ever silently dropped.
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

// ── LINK PROPERTY TO CONTROLLER ───────────────────────────────────────────────

// Climbs parentProperty links from a Property up to the Layer that owns it.
function ownerLayer(prop) {
    var p = prop;
    while (p && !(p instanceof Layer)) p = p.parentProperty;
    return p;
}

// Spatial properties (Position, Anchor Point) can be split into per-axis
// followers in the timeline; a linked expression has to assign a single
// combined array, so merge them back into one property first.
function collapseSeparatedDims(prop) {
    if (!prop.dimensionsSeparated) return;
    var n = prop.value.length, vals = [];
    for (var d=0; d<n; d++) vals.push(prop.getSeparationFollower(d).value);
    prop.dimensionsSeparated = false;
    while (prop.numKeys > 0) prop.removeKey(1);
    prop.setValue(vals);
}

function lineup_linkPropertyToController(offset) {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return "ERROR: No active composition";
        var layers = comp.selectedLayers;
        if (!layers || layers.length < 2) return "ERROR: Select at least 2 layers with the same property selected.";

        var selProps = comp.selectedProperties, props = [];
        for (var i=0; i<selProps.length; i++) if (selProps[i].propertyType === PropertyType.PROPERTY) props.push(selProps[i]);
        if (props.length === 0) return "ERROR: Select a property (e.g. Rotation, Opacity, Position) on the selected layers.";

        var targets = [];
        for (var i=0; i<layers.length; i++) {
            var lyr = layers[i], found = null, matchCount = 0;
            for (var j=0; j<props.length; j++) {
                if (ownerLayer(props[j]) === lyr) { matchCount++; if (!found) found = props[j]; }
            }
            if (matchCount === 0) return "ERROR: Select the same property on every selected layer.";
            if (matchCount > 1) return "ERROR: Select only one property across all selected layers.";
            targets.push({layer: lyr, prop: found});
        }

        var refName = targets[0].prop.matchName;
        for (var i=1; i<targets.length; i++) {
            if (targets[i].prop.matchName !== refName) return "ERROR: Select the same property on every selected layer.";
        }

        var refProp = targets[0].prop, pvt = refProp.propertyValueType;
        var controlMatchName, valIdx=1;
        if (pvt === PropertyValueType.COLOR) controlMatchName = "ADBE Color Control";
        else if (pvt === PropertyValueType.TwoD || pvt === PropertyValueType.TwoD_SPATIAL) controlMatchName = "ADBE Point Control";
        else if (pvt === PropertyValueType.OneD && refProp.unitsText === "degrees") controlMatchName = "ADBE Angle Control";
        else if (pvt === PropertyValueType.OneD) controlMatchName = "ADBE Slider Control";
        else return "ERROR: Unsupported property type for linking.";

        app.beginUndoGroup("Link Property to Controller");

        for (var i=0; i<targets.length; i++) {
            if (targets[i].prop.dimensionsSeparated) collapseSeparatedDims(targets[i].prop);
        }

        var propLabel = refProp.name;
        var nullName = propLabel + " Controller", sfx=2, taken=true;
        while (taken) {
            taken=false;
            for (var li=1; li<=comp.numLayers; li++) {
                if (comp.layer(li).name===nullName) { nullName=propLabel+" Controller "+sfx++; taken=true; break; }
            }
        }

        var nullLayer = comp.layers.addNull();
        nullLayer.name = nullName;

        var fx = nullLayer.property("ADBE Effect Parade").addProperty(controlMatchName);
        fx.name = propLabel;
        var baseValue = targets[0].prop.value;
        fx.property(valIdx).setValue(baseValue);

        var safeNull = nullName.replace(/"/g, '\\"'), safeFx = propLabel.replace(/"/g, '\\"');
        var ctrlRef = 'thisComp.layer("'+safeNull+'").effect("'+safeFx+'")('+valIdx+')';

        for (var i=0; i<targets.length; i++) {
            var prop = targets[i].prop, expr = ctrlRef;
            if (offset) {
                var own = prop.value, diff;
                if (typeof own === "number") diff = own - baseValue;
                else { diff=[]; for (var d=0; d<own.length; d++) diff.push(own[d] - baseValue[d]); }
                expr += (typeof diff === "number") ? (' + ' + diff) : (' + [' + diff.join(",") + ']');
            }
            prop.expression = expr + ';';
            prop.expressionEnabled = true;
        }

        app.endUndoGroup();
        return "Linked \""+propLabel+"\" on "+targets.length+" layers to \""+nullName+"\"";
    } catch (err) {
        try { app.endUndoGroup(); } catch(e) {}
        return "ERROR: " + err.toString();
    }
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

// Captures every keyframe on a leaf property, then rebuilds them at frame-rounded
// times. ExtendScript has no "move this keyframe" call — removing and re-adding is
// the only way to relocate one — so all interpolation/ease/spatial data has to be
// captured up front and reapplied afterward.
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
        // setTemporalEaseAtKey requires the key to already be Bezier on both sides —
        // calling it on a Linear/Hold key silently force-promotes it to Bezier, which
        // is exactly the "snap is adding bezier curves" bug. keyInTemporalEase/
        // keyOutTemporalEase return a value for every key regardless of type, so this
        // has to be gated on the captured interpolation type, not just truthiness.
        if (data[i].inInterp === KeyframeInterpolationType.BEZIER &&
            data[i].outInterp === KeyframeInterpolationType.BEZIER &&
            data[i].inEase && data[i].outEase) {
            try { prop.setTemporalEaseAtKey(idx, data[i].inEase, data[i].outEase); } catch (e) {}
        }
        if (data[i].autoBezier !== undefined) { try { prop.setSpatialAutoBezierAtKey(idx, data[i].autoBezier); } catch (e) {} }
        if (data[i].continuous !== undefined) { try { prop.setSpatialContinuousAtKey(idx, data[i].continuous); } catch (e) {} }
        // Auto-Bezier tangents are recomputed by AE from the (now snapped) neighboring
        // keyframe spacing — forcing back the pre-snap tangent values here would fight
        // that recompute and visibly kink the curve. Only restore explicit tangents for
        // keys that were already in manual (non-auto) Bezier mode.
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

// Rounds each layer's in/out points to the nearest whole frame at the new frame
// rate. Order of assignment matters — AE rejects an inPoint/outPoint write that
// would momentarily put inPoint >= outPoint, so whichever edge isn't crossing
// the other (relative to the layer's *current* points) is set first.
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

// Only un-parented layers are shifted directly: a parented layer's position is in
// its parent's local space, not comp space, so once the parent (also a layer in this
// comp) is shifted, every descendant inherits that shift through the parenting
// transform automatically. Shifting them too would double the offset.
function applyBatchSettingsToComp(comp, s, warnings) {
    if (s.applyDims) {
        var oldW = comp.width, oldH = comp.height;
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

// Always succeeds — even with nothing selected — so the panel can open and show
// "No comp selected" instead of being blocked. Seeds from the top selected comp
// in the Project panel when available, otherwise falls back to sane defaults
// (1920x1080, Square Pixels, 30fps, Full res, 5s duration, 0s start).
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
    applyDims, width, height,
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

        // Indices (into allComps, same order the panel's comp list was built from)
        // the user removed from the batch via the panel's per-row remove button.
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
            applyDims: !!applyDims, width: width, height: height,
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
// Seeded from Batch Comp Settings' own seed call (lineup_getBatchCompSettingsSeed
// above) rather than a separate one — both already filter proj.selection down
// to the exact same set of selected CompItems, so the panel-side JS just
// reuses those names for this tab too (see openBatchCompSettings in main.js).

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

        // orderIndices is a CSV of indices into allComps, in the (possibly
        // reordered, possibly trimmed) order the panel's comp list ended up in —
        // that order, not allComps' original order, drives the numbering.
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
                // Replace every [#], [##], [###]… run with the index, zero-padded to
                // the number of # characters between the brackets, and the semi-secret
                // [A] token with a letter based on position alone.
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

// Always succeeds — even with nothing selected — so the panel can open and show
// "No comp selected" instead of being blocked. Returns the current project's
// folder and base filename (both empty if it's never been saved) so the panel
// can build the suggested save name itself as the comp selection changes.
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

// Combines AE's own "Save" + "Save As" + "Reduce Project": saves the current
// project in place first (so nothing unsaved is left behind), duplicates it to
// a new file, strips the duplicate down to just the chosen comps (asset links
// stay where they are, nothing gets copied/collected), saves that, and leaves
// the new reduced project open as the active one.
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

        // Indices (into allComps, same order the panel's comp list was built from)
        // the user removed from the batch via the panel's per-row remove button.
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

function spellcheck_replace(layerIndex, keyIndex, oldWord, newWord) {
    try {
        app.beginUndoGroup("Spellcheck Fix");
        var comp = app.project.activeItem;
        if (!(comp instanceof CompItem)) { app.endUndoGroup(); return "ERROR:No active composition."; }
        var layer = comp.layer(parseInt(layerIndex, 10));
        if (!(layer instanceof TextLayer)) { app.endUndoGroup(); return "ERROR:Not a text layer."; }
        var srcText = layer.property("ADBE Text Properties").property("ADBE Text Document");
        var ki = parseInt(keyIndex, 10);
        var td = ki > 0 ? srcText.keyValue(ki) : srcText.value;
        td.text = td.text.replace(new RegExp("\\b" + oldWord + "\\b", "gi"), newWord);
        if (ki > 0) { srcText.setValueAtKey(ki, td); } else { srcText.setValue(td); }
        app.endUndoGroup();
        return "OK";
    } catch (e) {
        try { app.endUndoGroup(); } catch (_) {}
        return "ERROR:" + e.message;
    }
}

// ── ACTIVITY TRACKING ─────────────────────────────────────────────────────────
// Read-only snapshot for the Trophy tab's gamification poll (see
// _activityPollTick in main.js). There's no ExtendScript event for "a
// keyframe was added"/"a layer was created"/etc. — the panel calls this on
// a timer and diffs the counts itself to infer new activity, so this just
// reports raw totals plus enough identity info (projectId/compId/
// selectionId) for the caller to tell "the user did something" apart from
// "the user switched to a different project/comp/selection that already
// had this content."
//
// The keyframe count is scoped to the CURRENTLY SELECTED layers only, not
// every layer in the comp — walking every property of every layer on a
// 3-second timer is cheap on a small comp but scales with total comp
// complexity (layers × effects × params), and ExtendScript runs
// synchronously on AE's main thread, so a slow tick reads as an actual UI
// stutter, not just background CPU. Scoping to the selection instead caps
// the walk's cost at "how many layers you have selected" (almost always a
// handful) regardless of how big the comp is. Trade-off: keyframes added to
// layers that aren't selected at poll time go untracked.
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
    // Playhead position — not scored, purely a cheap extra "is the user
    // still doing something" signal for the Trophy timer's inactivity
    // check (scrubbing/playback moves this without necessarily changing
    // any of the counts above).
    var currentTime = isComp ? comp.time : -1;

    var selected = isComp ? comp.selectedLayers : [];
    var selIndices = [];
    for (var s = 0; s < selected.length; s++) {
        try { selIndices.push(selected[s].index); } catch (e) {}
    }
    selIndices.sort(function (a, b) { return a - b; });
    var selectionId = selIndices.join(',');

    var keyframeCount = 0;
    for (var s2 = 0; s2 < selected.length; s2++) {
        try { keyframeCount += _lineup_countKeyframesRecursive(selected[s2]); } catch (e) {}
    }

    var exportsDone = 0;
    var rq = proj.renderQueue;
    for (var r = 1; r <= rq.numItems; r++) {
        try { if (rq.item(r).status === RQItemStatus.DONE) exportsDone++; } catch (e) {}
    }

    return JSON.stringify({
        projectId: projectId,
        compId: compId,
        selectionId: selectionId,
        currentTime: currentTime,
        layerCount: layerCount,
        keyframeCount: keyframeCount,
        exportsDone: exportsDone
    });
}

// Recursively sums numKeys across every leaf property under propGroup
// (Layer objects themselves behave as the top-level property group, so
// this is called directly on each layer — no separate layer-vs-group case
// needed).
function _lineup_countKeyframesRecursive(propGroup) {
    var count = 0;
    for (var i = 1; i <= propGroup.numProperties; i++) {
        var prop;
        try { prop = propGroup.property(i); } catch (e) { continue; }
        if (!prop) continue;
        if (prop.propertyType === PropertyType.PROPERTY) {
            try { if (prop.numKeys) count += prop.numKeys; } catch (e) {}
        } else {
            count += _lineup_countKeyframesRecursive(prop);
        }
    }
    return count;
}
