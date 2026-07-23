/* Lineup CEP — Panel JavaScript */

var cs = new CSInterface();

// ── Tabs (Home / Tools) ──────────────────────────────────────────────────────
// Settings has no tab of its own — it's always the popup opened by
// openSettingsPopup below.

// Tab order determines slide direction — switching to a LATER tab (home →
// tools) slides right, an EARLIER one (tools → home) slides left.
var TAB_ORDER = ['home', 'tools', 'trophy'];
var _activeTabName = 'home'; // matches the panel/button markup's own default-active tab
var _tabSwitchSeq = 0;

// Slight nudge, not a full slide across — the outgoing panel eases IN
// (slow start, fast finish) while nudging toward the new tab's direction,
// then a hard cut (no cross-fade) swaps which panel is showing, and the
// incoming panel picks up from that SAME offset and eases OUT (fast
// start, slow finish) back to rest. Two separate elements each animating
// one half, split right at the cut, reads as a single continuous S-curve
// flick-and-settle motion. Driven by the Web Animations API rather than a
// CSS transition so it runs on its own animation stack, independent of
// whatever transitions (if any) are defined on these elements elsewhere.
var TAB_SLIDE_PX = 15.4; // +10%
var TAB_SLIDE_OUT_MS = 110;
var TAB_SLIDE_IN_MS = 170;
var TAB_SLIDE_OUT_EASE = 'cubic-bezier(0.95, 0.05, 0.795, 0.035)'; // ease-in, steeper — stays slow longer, then whips much faster into the cut
var TAB_SLIDE_IN_EASE = 'cubic-bezier(0.215, 0.61, 0.355, 1)'; // ease-out — fast, then slow

function switchTab(name) {
    var prevName = _activeTabName;
    if (prevName === name) return;
    _activeTabName = name;
    var mySeq = ++_tabSwitchSeq;

    ['home', 'tools', 'trophy'].forEach(function(n) {
        var btn = document.getElementById('tabBtn-' + n);
        if (btn) btn.classList.toggle('active', n === name);
    });
    // The pencil (Customize Quick Actions & Rearrange...) lives in the
    // shared footer, so it's visible regardless of tab by default — only
    // makes sense on Home (nothing to rearrange on Tools/Trophy).
    var editBtn = document.getElementById('quickActionsEditBtn');
    if (editBtn) editBtn.style.display = (name === 'tools' || name === 'trophy') ? 'none' : '';
    try { localStorage.setItem('lineup-active-tab', name); } catch(e) {}

    var oldPanel = document.getElementById(prevName === 'home' ? 'panel-content' : 'tab-' + prevName);
    var newPanel = document.getElementById(name === 'home' ? 'panel-content' : 'tab-' + name);
    if (!newPanel) return;

    var oldIdx = TAB_ORDER.indexOf(prevName);
    var newIdx = TAB_ORDER.indexOf(name);
    var dir = (oldIdx >= 0 && newIdx >= 0) ? (newIdx - oldIdx) : 0;

    // No real previous panel (first paint) or no direction to slide in —
    // just cut straight to it.
    if (!oldPanel || dir === 0 || !oldPanel.animate) {
        _applyTabPanels(name);
        return;
    }

    var distance = dir > 0 ? -TAB_SLIDE_PX : TAB_SLIDE_PX;
    var outAnim = _tabAnimate(oldPanel,
        [{ transform: 'translateX(0)' }, { transform: 'translateX(' + distance + 'px)' }],
        { duration: TAB_SLIDE_OUT_MS, easing: TAB_SLIDE_OUT_EASE, fill: 'forwards' }
    );
    outAnim.finished.catch(function() {}).then(function() {
        // cancel(), not just clearing style.transform — fill:'forwards'
        // keeps this effect actively applied (compositing on top of any
        // inline style, not stored as one) even once .finished resolves,
        // so leaving it un-canceled meant it would silently reassert
        // itself and reappear the moment THIS SAME panel's own future
        // (non-forwards, temporary) slide-in animation later finished and
        // its effect got removed — which is what was leaving panels
        // ending up visibly offset instead of centered.
        outAnim.cancel();
        if (mySeq !== _tabSwitchSeq) return; // a later switchTab call already landed on the real final state
        _applyTabPanels(name);
        // Starts from the OPPOSITE side of where the outgoing panel just
        // ended, not the same one — outgoing travels 0 → distance (its
        // velocity is toward whatever direction "distance" points), so
        // starting incoming there and animating to 0 would move it back
        // toward the opposite direction, reversing velocity right at the
        // cut. Starting at -distance and animating to 0 instead continues
        // moving toward "distance"'s same direction, which is what
        // actually reads as one uninterrupted motion across the cut.
        var inAnim = _tabAnimate(newPanel,
            [{ transform: 'translateX(' + (-distance) + 'px)' }, { transform: 'translateX(0)' }],
            { duration: TAB_SLIDE_IN_MS, easing: TAB_SLIDE_IN_EASE }
        );
        inAnim.finished.catch(function() {}).then(function() { inAnim.cancel(); });
    });
}

// One element can end up mid-animation on both ends of consecutive
// switches (it was the outgoing panel a moment ago, now it's the
// incoming one, or vice versa) — starting a fresh animate() call without
// canceling whatever's still attached from the last switch left two
// effects fighting over the same transform, which is the other half of
// what could leave a panel visibly offset. Tracked per element, not
// globally, since the outgoing and incoming animations run concurrently
// on two different panels for part of every switch.
var _tabPanelAnims = new WeakMap();
function _tabAnimate(el, keyframes, opts) {
    var prev = _tabPanelAnims.get(el);
    if (prev) prev.cancel();
    var anim = el.animate(keyframes, opts);
    _tabPanelAnims.set(el, anim);
    return anim;
}

function _applyTabPanels(name) {
    ['home', 'tools', 'trophy'].forEach(function(n) {
        var panel = document.getElementById(n === 'home' ? 'panel-content' : 'tab-' + n);
        if (panel) panel.classList.toggle('active', n === name);
    });
    // No .compact re-sync needed here anymore — _syncToolsFilterCompact
    // now measures .tab-bar (always visible/measurable) instead of
    // #tab-tools itself (0 width while hidden), so .compact never goes
    // stale while Tools sits hidden. This used to also run a forced
    // reflow plus a .no-anim transition-suppress dance right here — real
    // blocking work sitting at the cut between the two slide animations,
    // which is what was reading as a jump/stutter on every switch.
    //
    // The scroll-gap class is a separate, narrower case: .tools-grid's
    // own scrollHeight/clientHeight only mean anything while it's actually
    // rendered (0/0 while display:none), so unlike .compact this genuinely
    // can go stale while hidden and does need a real re-check on reveal —
    // but it's just two cheap property reads, no gBCR and no transition to
    // suppress (.tools-grid-scrollable's padding change isn't animated),
    // so it doesn't reintroduce the jump the rest of this used to cause.
    if (name === 'tools') _syncToolsGridScrollGap();
}

function restoreActiveTab() {
    var name;
    try { name = localStorage.getItem('lineup-active-tab'); } catch(e) {}
    if (name === 'tools' || name === 'trophy') switchTab(name);
}

// ── Home layout ──────────────────────────────────────────────────────────────
// Compact's bento boards are two separate 6-column CSS Grids: #homeTopGroup
// (Anchor, Quick Actions, and the Favorite slot — see _favApplyLayout) and
// #homeGrid (Align / Distribute / Sizing / Auto Crop / Sort / Quick Actions
// 2 / Spell Check / Ease Copy, user-reorderable via the Bottom Layout edit
// mode — see _blApplyLayout). --home-anchor-unit, set on #homeTopGroup,
// keeps rowspan-1 boxes there sized to half of Anchor's own rendered
// height, since Anchor's size changes with panel width/zoom.

function _homeBoxes() {
    return Array.prototype.slice.call(document.querySelectorAll('#homeTopGroup .tool-box[data-block-id], #homeGrid .tool-box[data-block-id]'));
}

// Sums Anchor's own natural content (icon grid, toolbar) rather than
// reading the tool-body's own rendered height, which can be stretched
// taller by a tall neighbor sharing its grid row-track. Narrow stack lays
// these children out as a row instead (grid left, controls right — see
// the CSS), so summing them there would wildly overstate the natural
// height; the tallest child is the real height in that layout, same as
// any other row of same-height-cross-axis items.
//
// Non-narrow-stack specifically measures .anchor-tools-group, NOT its
// parent .anchor-mode-line — .anchor-mode-line is flex:1/align-items:
// stretch (fills whatever height is left below the grid AND stretches
// .anchor-tools-group to match, so the toolbar's buttons can actually grow
// into that space instead of leaving it as dead space — see .anchor-mode-
// line's own CSS comment), and reading either of their rendered heights
// back in here would feed that fill straight back into the very number
// driving it: taller row -> bigger sum -> bigger --home-anchor-unit ->
// taller neighbor -> taller shared row -> taller row again, forever.
// .anchor-tools-group's own flex:1/.anchor-mode-btn's and .anchor-null-
// cluster's flex:1 all get temporarily reset to their natural (min-height-
// floored) size for just this one measurement, then restored — giving a
// stable, non-circular number regardless of how much they're actually
// stretched the rest of the time.
function _anchorNaturalHeight() {
    var toolBox = document.querySelector('.tool-box[data-block-id="anchor"]');
    var body    = document.querySelector('.tool-body[data-block-id="anchor"]');
    if (!toolBox || !body) return 0;
    var boxCs = getComputedStyle(toolBox);
    var padding = (parseFloat(boxCs.paddingTop) || 0) + (parseFloat(boxCs.paddingBottom) || 0);

    if (_narrowStack) {
        var max = 0;
        Array.prototype.forEach.call(body.children, function(child) {
            var h = child.getBoundingClientRect().height;
            if (h > max) max = h;
        });
        return max + padding;
    }

    var gap = parseFloat(getComputedStyle(body).rowGap) || 0;
    var anchorRow  = body.querySelector('.anchor-row');
    var toolsGroup = body.querySelector('.anchor-tools-group');
    var rowH = anchorRow ? anchorRow.getBoundingClientRect().height : 0;
    var toolsH = 0;
    if (toolsGroup) {
        var modeBtn     = toolsGroup.querySelector('.anchor-mode-btn');
        var nullCluster = toolsGroup.querySelector('.anchor-null-cluster');
        var prevGroupAlign  = toolsGroup.style.alignSelf;
        var prevModeFlex    = modeBtn     ? modeBtn.style.flex     : '';
        var prevClusterFlex = nullCluster ? nullCluster.style.flex : '';
        toolsGroup.style.alignSelf = 'flex-start';
        if (modeBtn)     modeBtn.style.flex     = '0 0 auto';
        if (nullCluster) nullCluster.style.flex = '0 0 auto';
        toolsH = toolsGroup.getBoundingClientRect().height;
        toolsGroup.style.alignSelf = prevGroupAlign;
        if (modeBtn)     modeBtn.style.flex     = prevModeFlex;
        if (nullCluster) nullCluster.style.flex = prevClusterFlex;
    }
    return rowH + gap + toolsH + padding;
}

function _syncAnchorRowUnit() {
    var grid = document.getElementById('homeTopGroup');
    if (!grid) return;

    // #homeTopGroup itself carries the CSS zoom set in _syncAnchorTiers
    // below (only narrow-stack resets it to ''). getBoundingClientRect()
    // on anything inside that zoomed subtree — which is all
    // _anchorNaturalHeight's own measurements are — reports the value
    // already scaled DOWN by that zoom, since gBCR always answers in the
    // outer/root coordinate space. But --home-anchor-unit is read back by
    // CSS *inside* this same zoomed element, i.e. in its own pre-zoom/
    // local space — feeding a post-zoom measurement straight back in gets
    // zoomed a second time, shrinking the row/box past what its actual
    // (single-zoomed) content needs and letting that content spill out
    // the bottom. Dividing by zoom here converts the measurement back to
    // the local space this property is actually interpreted in.
    var zoom = parseFloat(grid.style.zoom) || 1;

    // Evenly-split arrangement — Quick Actions and Favorite each get half
    // of Anchor's own natural height (see .home-top-group's own
    // --home-anchor-unit fallback comment, and the #sec-quick-actions/
    // #sec-favorite overrides that split it unevenly instead).
    var h = _anchorNaturalHeight();
    if (h > 0) grid.style.setProperty('--home-anchor-unit', (h / zoom / 2) + 'px');
}

// ── Anchor responsive tiers ──────────────────────────────────────────────────
// Two bands, both measured off the same #homeToolGrid width (a former
// third "medium" tier — stacking Anchor's dropdown/Null column once the
// square grid got too cramped to sit beside it — was removed; normal/wide's
// zoom-based scaling now just runs all the way down to
// NARROW_STACK_THRESHOLD instead):
//   width >= NARROW_STACK_THRESHOLD  : normal — Anchor/Quick Actions/
//                                       Favorite scale down together as one
//                                       unit (see #homeTopGroup's zoom
//                                       below) as the panel narrows, so the
//                                       grid, mode button, and Null button
//                                       all shrink in the same proportion
//                                       instead of any one of them crowding
//                                       out of step with the others.
//   width < NARROW_STACK_THRESHOLD   : narrow-stack — every widget,
//                                       including the top group, goes
//                                       full-width/stacked; Anchor's own
//                                       grid+controls sit side by side
//                                       instead, at native scale (the zoom
//                                       above resets to 1 here — full width
//                                       is the intended remedy for this
//                                       range, not shrinking everything
//                                       down further on top of it), all the
//                                       way down — no smaller breakpoint
//                                       below this that hides the controls
//                                       entirely (tried that; it read
//                                       worse, and dragged Quick Actions/
//                                       Favorite's own layout down with it
//                                       since they share this same top-
//                                       group row). The mode button/Null
//                                       cluster split the controls column
//                                       evenly via plain flex-grow (see
//                                       .anchor-mode-btn/.anchor-null-
//                                       cluster's narrow-stack rules) —
//                                       pure CSS, no JS-computed pixel
//                                       heights, so they can never demand
//                                       more than the column's own actual
//                                       height and inflate Anchor's box to
//                                       fit.
//   width < ANCHOR_TINY_THRESHOLD    : narrow-stack, tiny — halfway
//                                       between NARROW_STACK_THRESHOLD and
//                                       the panel's own minimum width
//                                       (CSXS/manifest.xml's MinSize); no
//                                       tighter treatment currently hooks
//                                       into this sub-tier, kept in case a
//                                       future control needs it.
// Tune any of these directly if they kick in too early/late once actually
// seen in AE.
var NARROW_STACK_THRESHOLD = 330;
var ANCHOR_TINY_THRESHOLD = 275; // halfway between NARROW_STACK_THRESHOLD (330) and the panel's own MinSize width (220)
var VECTORTOOLS_TITLE_DROP_WIDTH = 300; // below this, "Shape Tools" drops even in one-line (data-span="6") mode
// #homeTopGroup's own width at the panel's full max-width (570px, minus
// .tool-grid's 10px-each-side padding) — the "zoom:1, no scaling" point the
// ratio below is measured against.
var TOP_GROUP_REFERENCE_WIDTH = 550;
// 0.6 (matching the ratio's own value right at NARROW_STACK_THRESHOLD) read
// as too small/hard to read well before the panel actually got that narrow
// — text and icons were shrinking the whole way down. Floored higher so
// zoom stops shrinking earlier and holds there instead, all the way down
// to NARROW_STACK_THRESHOLD.
var TOP_GROUP_ZOOM_FLOOR = 0.82;

var _narrowStack = false;
var _anchorTiny = false;

function _syncAnchorTiers() {
    var grid = document.getElementById('homeToolGrid');
    var topGroup = document.getElementById('homeTopGroup');
    if (!grid) return;
    var width = grid.getBoundingClientRect().width;

    var isNarrow = width < NARROW_STACK_THRESHOLD;
    var isTiny = isNarrow && width < ANCHOR_TINY_THRESHOLD;
    var narrowChanged = isNarrow !== _narrowStack;

    _narrowStack = isNarrow;
    _anchorTiny = isTiny;
    grid.classList.toggle('narrow-stack', isNarrow);
    grid.classList.toggle('anchor-tiny', isTiny);

    if (topGroup) {
        // #homeTopGroup's OWN rect isn't safe to re-measure here — it
        // already has this same zoom applied to itself, so its reported
        // width would already be shrunk by whatever zoom a previous call
        // set, corrupting the ratio below. #homeToolGrid never gets zoomed
        // itself, so its width (already measured above) stays a stable,
        // un-shrunk reference every time — just subtract its own fixed
        // 20px (10px each side) padding to approximate #homeTopGroup's
        // natural, pre-zoom width.
        var topGroupWidth = width - 20;
        topGroup.style.zoom = isNarrow ? '' :
            String(Math.min(1, Math.max(TOP_GROUP_ZOOM_FLOOR, topGroupWidth / TOP_GROUP_REFERENCE_WIDTH)));
    }

    // Bottom Layout/Quick Actions only care about the narrow-stack band
    // itself — no need to re-pack/re-tile those unless it actually changed.
    if (narrowChanged) {
        _blApplyLayout(); // re-syncs quickactions2's placeholders too (see its tail)
        var qaMainGrid = document.getElementById(QA_INSTANCES.main.gridId);
        if (qaMainGrid) _qaSyncAddTiles('main', qaMainGrid);
    }
    // Settle Align/Distribute/Sort's own label-dropping BEFORE measuring
    // anything below — this used to live behind a second, independent
    // ResizeObserver on this same #homeToolGrid, and while that mostly
    // agreed with this one, nothing guaranteed it ran first. During a
    // continuous shrink, that occasionally left a favorited Sort's ctrl-row
    // still rendered in its wide (wrapped-to-2-lines, taller) form for one
    // tick after Favorite's own box had already committed to its normal
    // height — spilling that extra height past #homeTopGroup's bottom edge
    // for a frame, self-correcting only once something else (switching
    // tabs) forced a fresh, from-scratch pass. Calling it here first,
    // synchronously, guarantees the row is already in its final tightened
    // shape by the time anything downstream renders the box around it.
    _syncCtrlRowLabels();
    _syncVectortoolsTitle(width);
    // Anchor's own natural height depends on which of these tiers/zoom
    // level is active — always recomputed, not just on narrowChanged.
    _syncAnchorRowUnit();
}

// "Shape Tools" — half width (data-span="3") or Favorite always hides it
// (see the static CSS rule); one-line (data-span="6") only hides it once
// the panel itself has gotten genuinely narrow, below
// VECTORTOOLS_TITLE_DROP_WIDTH — narrow-stack forces every widget to
// data-span="6" regardless of real pairing, so this is really what decides
// the title there too, not just a "wide and alone" one-line box.
function _syncVectortoolsTitle(gridWidth) {
    var box = document.querySelector('.tool-box[data-block-id="vectortools"]');
    if (!box) return;
    var oneLine = box.getAttribute('data-span') === '6';
    box.classList.toggle('vectortools-one-line-tiny', oneLine && gridWidth < VECTORTOOLS_TITLE_DROP_WIDTH);
}

function _initAnchorTiers() {
    var grid = document.getElementById('homeToolGrid');
    if (!grid || typeof ResizeObserver === 'undefined') return;
    new ResizeObserver(function() { _syncAnchorTiers(); }).observe(grid);
}

// Cursor-follow spotlight on the anchor grid (see .anchor-grid::before in
// style.css) — same look as the board-editing drag glow, but a single
// element instead of a whole draggable-widget list, so this just runs its
// own small eased-position loop directly, only while the pointer is
// actually over the grid (mouseenter starts it, mouseleave stops it)
// rather than continuously in the background.
var _anchorGlowRAF = null;
var _anchorGlowRawX = -9999, _anchorGlowRawY = -9999;
var _anchorGlowX = -9999, _anchorGlowY = -9999;

function _anchorGlowMove(e) {
    _anchorGlowRawX = e.clientX;
    _anchorGlowRawY = e.clientY;
}

function _anchorGlowTick() {
    var grid = document.querySelector('.anchor-grid');
    if (!grid) { _anchorGlowRAF = null; return; }
    var dx = _anchorGlowRawX - _anchorGlowX, dy = _anchorGlowRawY - _anchorGlowY;
    _anchorGlowX += dx * 0.12;
    _anchorGlowY += dy * 0.12;
    var rect = grid.getBoundingClientRect();
    grid.style.setProperty('--glow-x', (_anchorGlowX - rect.left) + 'px');
    grid.style.setProperty('--glow-y', (_anchorGlowY - rect.top) + 'px');
    _anchorGlowRAF = requestAnimationFrame(_anchorGlowTick);
}

function _initAnchorGridGlow() {
    var grid = document.querySelector('.anchor-grid');
    if (!grid) return;
    grid.addEventListener('mouseenter', function(e) {
        // Snap the eased position to the cursor immediately instead of
        // easing in from off-screen (-9999) — the same reasoning as the
        // drag glow's own "no first-frame snap" comment, just applied at
        // the start of hover here instead of continuously beforehand.
        _anchorGlowRawX = _anchorGlowX = e.clientX;
        _anchorGlowRawY = _anchorGlowY = e.clientY;
        document.addEventListener('mousemove', _anchorGlowMove);
        if (!_anchorGlowRAF) _anchorGlowRAF = requestAnimationFrame(_anchorGlowTick);
    });
    grid.addEventListener('mouseleave', function() {
        document.removeEventListener('mousemove', _anchorGlowMove);
        if (_anchorGlowRAF) { cancelAnimationFrame(_anchorGlowRAF); _anchorGlowRAF = null; }
    });
}

// Align/Distribute's header row (icon + "Align to"/"Distribute to" + select
// + Offset toggle) — and Sort Layers' own (icon + "Sort Layers based on" +
// Property/Axis selects) — used to let their trailing controls wrap onto
// their own line, or spill outside the box, well before the panel was
// actually narrow enough to trigger anything else. The row-specific label
// ("Align to"/"Distribute to"/"Sort Layers based on") drops first (same
// idea as half-width already dropping it outright); Align/Distribute also
// get a second tier, dropping Offset's own word too if that alone still
// isn't enough (keeping just its checkbox/diamond in the top right corner
// — Sort has no equivalent trailing toggle, so this tier is a no-op for
// it). Compact only — Classic's own fixed ~360px column never had this
// complaint and keeps wrapping as normal (see .ctrl-row's own
// flex-wrap:nowrap override, Compact-scoped). Shape Tools' own title
// ("Shape Tools") has its own, simpler rule instead — see
// _syncVectortoolsTitle below, always-hidden at half width/Favorite,
// width-threshold-hidden at full width — not part of this measured-overflow
// mechanism.
function _syncCtrlRowLabels() {
    // .tool-body[data-block-id] (not .tool-box[data-block-id]) — the
    // tool-body itself physically relocates into the Favorite slot's
    // .fav-page when starred (see _favApplyLayout), which has no
    // .tool-box ancestor at all. Anchoring on .tool-box left Sort's row
    // un-measured (so its label never dropped) the whole time it sat
    // favorited, since only Align/Distribute happen to also hide their
    // label unconditionally while favorited and so never showed the same
    // gap.
    var rows = ['alignlayers', 'distribute', 'sort'].map(function(id) {
        return document.querySelector('.tool-body[data-block-id="' + id + '"] .ctrl-row');
    }).filter(Boolean);
    if (!rows.length) return;

    // Batched across all 3 rows — one forced reflow total per pass instead
    // of a separate remove/reflow/read/write/reflow/read cycle PER row
    // (up to 6 forced reflows every time this runs, called from a
    // ResizeObserver that fires continuously during a live resize drag).
    // All the writes for a pass happen first, THEN one reflow, THEN all
    // the reads — same idea as the settled batching pattern used
    // elsewhere in this file (e.g. _blPlayFlip).
    rows.forEach(function(row) { row.classList.remove('ctrl-row-tight', 'ctrl-row-tighter'); });
    void rows[0].offsetWidth; // one forced reflow settles the removals above for every row at once
    var needsTight = rows.map(function(row) { return row.scrollWidth > row.clientWidth + 1; });

    var anyTight = false;
    rows.forEach(function(row, i) {
        if (needsTight[i]) { row.classList.add('ctrl-row-tight'); anyTight = true; } // drop "Align to"/"Distribute to"/"Sort Layers based on" first
    });
    if (!anyTight) return;
    void rows[0].offsetWidth; // one more forced reflow, only if anything actually went tight
    rows.forEach(function(row, i) {
        if (needsTight[i] && row.scrollWidth > row.clientWidth + 1) {
            row.classList.add('ctrl-row-tighter'); // still doesn't fit — drop "Offset" 's own word too (Align/Distribute only; no-op for Sort)
        }
    });
}

// ── Layout mode (Compact / Classic) ──────────────────────────────────────────
// Compact is the bento peg-board above (#homeGrid); Classic is the original
// collapsible-section layout (#homeClassic, its sibling in the markup). Both
// drive the exact same underlying controls: each tool's actual guts live in
// one .tool-body[data-block-id] node, physically relocated between its
// Compact tool-box and its Classic section-body whenever the mode switches —
// so nothing here ever needs two copies of an id or an onclick handler.
var CLASSIC_BLOCK_IDS = ['anchor', 'organize', 'ease', 'alignlayers', 'distribute', 'sizing', 'autocrop', 'sort', 'vectortools'];

function setLayoutMode(mode) {
    if (mode !== 'classic') mode = 'compact';
    try { localStorage.setItem('lineup-layout-mode', mode); } catch(e) {}
    _applyLayoutMode(mode);
}

function restoreLayoutMode() {
    var mode;
    try { mode = localStorage.getItem('lineup-layout-mode'); } catch(e) {}
    _applyLayoutMode(mode === 'classic' ? 'classic' : 'compact');
}

// ── Shared modal backdrop: click-OUTSIDE to close, not drag-ends-outside ────
// A native `click` event fires on the nearest common ancestor of the
// mousedown and mouseup targets — not simply "wherever the button was
// released". Dragging inside a modal (the Color Picker's saturation square,
// a scrub field, Settings' drag-to-reorder section list, ...) and letting
// the cursor drift past the modal's own edge before releasing already
// counts as a "click" on the backdrop under that rule, closing the modal
// even though the user never meant to. Tracking mousedown/mouseup directly
// instead — only closes when BOTH landed straight on the backdrop element
// itself (e.target === e.currentTarget; anything that started or ended on
// a descendant, i.e. inside the modal box, fails this check even after
// bubbling up here) — fixes that without touching any modal's own close
// function or its "click inside the box" stopPropagation guard.
var _overlayBackdropDown = null; // the backdrop element mousedown last landed directly on, or null

function _overlayMouseDown(e) {
    _overlayBackdropDown = (e.target === e.currentTarget) ? e.currentTarget : null;
}
function _overlayMouseUp(e, closeFn) {
    var wasDown = _overlayBackdropDown === e.currentTarget;
    _overlayBackdropDown = null;
    if (wasDown && e.target === e.currentTarget) closeFn();
}

// ── Settings popup ────────────────────────────────────────────────────────────
// Opened via the gear button in the footer — no tab of its own in either
// layout mode (see openSettingsPopup's onclick and switchTab above). Styled
// in CSS like the other .settings-overlay/.settings-modal dialogs
// (.settings-as-popup), with .settings-popup-visible added a frame later so
// the fade-in actually animates instead of snapping in already-visible.
function openSettingsPopup() {
    var panel = document.getElementById('settingsPopup');
    if (!panel) return;
    panel.classList.add('settings-as-popup');
    void panel.offsetWidth; // force reflow so the fade-in below actually starts from opacity:0
    panel.classList.add('settings-popup-visible');
    var clsBlock = document.getElementById('classicSettingsBlock');
    if (clsBlock && clsBlock.classList.contains('classic-sections-open')) _renderClassicSettingsList();
}

function closeSettingsPopup() {
    var panel = document.getElementById('settingsPopup');
    if (!panel || !panel.classList.contains('settings-as-popup')) return;
    panel.classList.remove('settings-popup-visible');
    // .settings-as-popup itself (the fixed-position overlay chrome) only
    // comes off after the fade-out finishes — removing it immediately would
    // snap straight to display:none mid-transition instead of fading.
    setTimeout(function() { panel.classList.remove('settings-as-popup'); }, 160);
}

// ── What's New popup ──────────────────────────────────────────────────────────
// Shown once per upgrade, only for versions listed below that flag something
// worth calling out — a plain patch bump with no entry here stays silent.
// Triggered from update.js's checkForUpdates once the installed manifest
// version is known (see _maybeShowWhatsNew).
var WHATS_NEW = {
    '1.8.6': [
        {
            icon: '<svg viewBox="0 0 20 20" fill="currentColor"><rect x="2" y="2" width="7" height="7" rx="2"/><rect x="11" y="2" width="7" height="7" rx="2"/><rect x="2" y="11" width="7" height="7" rx="2"/><rect x="11" y="11" width="7" height="7" rx="2"/></svg>',
            title: 'Compact Mode',
            body: 'A denser, icon-first layout that fits every tool into a fraction of the vertical space Classic needs — switch anytime from the gear icon in the footer.'
        }
    ],
    '1.9.0': [
        {
            icon: '<svg viewBox="0 0 20 20" fill="currentColor"><rect x="3" y="1.8" width="5.2" height="5.2" rx="1.1"/><circle cx="14" cy="4.2" r="3.1"/><path d="M10,8 L6.4,14.3 L13.6,14.3 Z"/></svg>',
            title: 'Shape Tools',
            body: 'A new toolbar for shape layers — merge/explode paths, cycle stroke caps and joins, consolidate colors onto a shared controller, and a live Fill/Stroke HUD that shows and edits color and stroke width across the whole selection at once, individually or all together.'
        },
        {
            icon: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="8.5" cy="8.5" r="6"/><line x1="13" y1="13" x2="17.5" y2="17.5"/></svg>',
            title: 'Redesigned Help',
            body: "A searchable, paginated rewrite covering every tool — including all of the new Shape Tools."
        }
    ],
    '1.9.1': [
        {
            icon: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="butt" stroke-linejoin="round"><path d="M1,10 L3,10 C7,10 9,7 11,5 L14,5"/><path d="M3,10 C7,10 9,13 11,15 L14,15" stroke-dasharray="2.2,2"/><path d="M14,1.4 L19.6,5 L14,8.6 Z" fill="currentColor" stroke="none"/><path d="M14,11.4 L19.6,15 L14,18.6 Z" fill="currentColor" stroke="none"/></svg>',
            title: 'Shape Tools, cleaned up',
            body: "Merge/Explode got clearer icons, and the toolbar was rebuilt to actually fill its space — including at half width and in the Favorites bar, where it used to leave dead space below the buttons."
        },
        {
            icon: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-linecap="round"><rect x="3" y="3" width="14" height="3.4" rx="0" fill="currentColor" stroke="none"/><rect x="8.3" y="3" width="3.4" height="6.5" rx="0" fill="currentColor" stroke="none"/><rect x="8.3" y="14.5" width="3.4" height="2.8" rx="0" fill="currentColor" stroke="none"/><line x1="4" y1="15.5" x2="18" y2="7.6" stroke-width="2.16"/></svg>',
            title: 'Split Text, rebuilt',
            body: "Now positions each piece using After Effects' own text engine instead of manual measurement — Character and Paragraph modes are back, and every mode lands exactly right, correctly kerned, wrapped, and justified."
        },
        {
            icon: '<svg viewBox="0 0 20 20" fill="currentColor"><rect x="2" y="11" width="11" height="6" rx="1.4" opacity="0.45"/><rect x="4" y="7" width="11" height="6" rx="1.4" opacity="0.7"/><rect x="6" y="3" width="11" height="6" rx="1.4"/></svg>',
            title: 'Smart Stack',
            body: "The Favorites bar now jumps to the page you likely need — Shape Tools the moment you select a shape, Ease Copy the moment you select a keyframe — without fighting a manual swipe. Toggle it off anytime in Settings."
        }
    ],
    '1.9.2': [
        {
            icon: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="10" cy="10" r="3"/><line x1="10" y1="1.5" x2="10" y2="5.5"/><line x1="10" y1="14.5" x2="10" y2="18.5"/><line x1="1.5" y1="10" x2="5.5" y2="10"/><line x1="14.5" y1="10" x2="18.5" y2="10"/></svg>',
            title: 'Anchor Point, redesigned',
            body: "The Based-on dropdown is now an icon+word button with a flyout, Ignore Masks is a square toggle instead of a checkbox, and Null sits beside it — a bordered dropdown look and a raised button look now make it obvious which is which."
        },
        {
            icon: '<svg viewBox="0 0 20 20" fill="currentColor"><path d="M4.37,4.47 Q4,4 4.6,4 L15.4,4 Q16,4 15.63,4.47 L10.16,11.3 Q10,11.5 9.84,11.3 Z M4.6,16 Q4,16 4.37,15.53 L9.84,8.7 Q10,8.5 10.16,8.7 L15.63,15.53 Q16,16 15.4,16 Z"/></svg>',
            title: 'Ease Copy, streamlined',
            body: "The 3 interpolation buttons are now 1 — click for Continuous Bezier, right-click for Linear/Hold. The graph shows what you've copied again, with a small live keyframe count overlaid in the corner."
        }
    ]
};

// lastSeen is only absent on a genuinely fresh install (nothing to compare
// the current version against yet) — record it silently and skip the popup
// so new users aren't shown an "upgrade" notice for the version they just
// installed for the first time.
function _maybeShowWhatsNew(version) {
    if (!version) return;
    var lastSeen = null;
    try { lastSeen = localStorage.getItem('lineup-last-seen-version'); } catch(e) {}
    try { localStorage.setItem('lineup-last-seen-version', version); } catch(e) {}
    if (!lastSeen || lastSeen === version) return;
    if (!WHATS_NEW[version]) return;
    _renderWhatsNew(version);
    openWhatsNewPopup();
}

function _renderWhatsNew(version) {
    var titleEl = document.getElementById('whatsNewTitle');
    if (titleEl) titleEl.textContent = "What's New in v" + version;
    var list = document.getElementById('whatsNewList');
    if (!list) return;
    list.innerHTML = '';
    (WHATS_NEW[version] || []).forEach(function(item) {
        var row = document.createElement('div');
        row.className = 'whatsnew-item';
        row.innerHTML =
            '<div class="whatsnew-item-icon">' + item.icon + '</div>' +
            '<div class="whatsnew-item-text">' +
                '<div class="whatsnew-item-title">' + item.title + '</div>' +
                '<div class="whatsnew-item-body">' + item.body + '</div>' +
            '</div>';
        list.appendChild(row);
    });
}

function openWhatsNewPopup() {
    var panel = document.getElementById('whatsNewPopup');
    if (!panel) return;
    panel.classList.add('whatsnew-as-popup');
    void panel.offsetWidth; // force reflow so the fade-in below actually starts from opacity:0
    panel.classList.add('whatsnew-popup-visible');
}

function closeWhatsNewPopup() {
    var panel = document.getElementById('whatsNewPopup');
    if (!panel || !panel.classList.contains('whatsnew-as-popup')) return;
    panel.classList.remove('whatsnew-popup-visible');
    setTimeout(function() { panel.classList.remove('whatsnew-as-popup'); }, 160);
}

function _applyLayoutMode(mode) {
    var isClassic   = mode === 'classic';
    var compactGrid = document.getElementById('homeGrid');
    var compactTop  = document.getElementById('homeTopGroup');
    var classicGrid = document.getElementById('homeClassic');
    var clsBlock    = document.getElementById('classicSettingsBlock');

    // Classic hides the tab bar and the Quick Actions edit pencil (Settings
    // is reached via the same gear button, #settingsGearBtn, in both modes)
    // — CSS alone handles the actual show/hide (with a fade/collapse
    // transition) off this one class.
    document.body.classList.toggle('layout-classic', isClassic);

    CLASSIC_BLOCK_IDS.forEach(function(id) {
        var body = document.querySelector('.tool-body[data-block-id="' + id + '"]');
        if (!body) return;
        if (isClassic) {
            var target = document.querySelector('#homeClassic .section-body[data-body-for="' + id + '"]');
            if (target && body.parentElement !== target) target.appendChild(body);
        } else if (id === 'organize') {
            // Compact never shows Organize's original controls — it has its
            // own independent, freely-customizable Quick Actions widget
            // instead (#sec-quick-actions, see _renderQuickActions), which
            // shares no markup with Classic's Organize section. The
            // original body just sits stashed here, unused, so Classic can
            // still relocate and show it exactly as before.
            var stash = document.getElementById('sec-organize-original');
            if (stash && body.parentElement !== stash) stash.appendChild(body);
        } else {
            var box = document.querySelector('.tool-box[data-block-id="' + id + '"]');
            if (!box || body.parentElement === box) return;
            box.appendChild(body);
        }
    });

    // Null/Copy-Paste has no Compact home of its own (it's permanently
    // hidden there, kept in #sec-nullcp) — in Classic it docks beside the
    // Anchor grid instead, matching the original layout. Runs after the
    // loop above so #anchorRow (part of Anchor's own relocated tool-body)
    // is already wherever it needs to be for this call.
    var nullcp = document.querySelector('.cp-panel[data-block-id="nullcp"]');
    var anchorRow = document.getElementById('anchorRow');
    if (nullcp && anchorRow) {
        var nullcpHome = isClassic ? anchorRow : document.getElementById('sec-nullcp');
        if (nullcpHome && nullcp.parentElement !== nullcpHome) nullcpHome.appendChild(nullcp);
    }

    if (compactGrid) compactGrid.style.display = isClassic ? 'none' : '';
    if (compactTop)   compactTop.style.display  = isClassic ? 'none' : '';
    if (classicGrid) classicGrid.style.display = isClassic ? '' : 'none';
    // Accordions open/closed (see .classic-sections-open in style.css)
    // rather than an instant display:none swap, so the Settings popup
    // grows/shrinks into it instead of popping.
    if (clsBlock)     clsBlock.classList.toggle('classic-sections-open', isClassic);

    // The Favorite slot only exists in Compact — Classic already moved
    // everything above into its own section-bodies, nothing left to do here.
    if (!isClassic) _favApplyLayout();

    document.querySelectorAll('.layout-mode-btn').forEach(function(btn) {
        btn.classList.toggle('active', btn.getAttribute('data-mode') === mode);
    });

    _applySharedHiddenState();
    if (isClassic) _renderClassicSettingsList();
}

// ── Classic section collapse/expand ──────────────────────────────────────────

function toggleClassicSection(id) {
    var hdr  = document.querySelector('#cls-' + id + ' .section-hdr');
    var body = document.querySelector('#cls-' + id + ' .section-body');
    if (!hdr || !body) return;
    var collapsed = body.classList.toggle('hidden');
    hdr.classList.toggle('collapsed', collapsed);
    try { localStorage.setItem('lineup-cls-sec-' + id, collapsed ? '1' : '0'); } catch(e) {}
}

function restoreClassicCollapsed() {
    CLASSIC_BLOCK_IDS.forEach(function(id) {
        var stored;
        try { stored = localStorage.getItem('lineup-cls-sec-' + id); } catch(e) {}
        if (stored === '1') {
            var hdr  = document.querySelector('#cls-' + id + ' .section-hdr');
            var body = document.querySelector('#cls-' + id + ' .section-body');
            if (hdr)  hdr.classList.add('collapsed');
            if (body) body.classList.add('hidden');
        }
    });
}

// ── Shared hidden-module state ───────────────────────────────────────────────
// Single source of truth for "which tools are hidden," set from Classic's
// Sections list and applied to both layouts — hiding something there hides
// it in Compact's fixed grid too.

function _getHiddenBlockIds() {
    var ids;
    try { ids = JSON.parse(localStorage.getItem('lineup-hidden-blocks')); } catch(e) {}
    return Array.isArray(ids) ? ids : [];
}

function _commitHiddenBlockIds(ids) {
    try { localStorage.setItem('lineup-hidden-blocks', JSON.stringify(ids)); } catch(e) {}
    _applySharedHiddenState();
}

function _applySharedHiddenState() {
    var hidden = _getHiddenBlockIds();
    _homeBoxes().forEach(function(box) {
        var id = box.getAttribute('data-block-id');
        box.classList.toggle('home-hidden', hidden.indexOf(id) !== -1);
    });
    CLASSIC_BLOCK_IDS.forEach(function(id) {
        var sec = document.getElementById('cls-' + id);
        if (sec) sec.classList.toggle('sec-hidden', hidden.indexOf(id) !== -1);
    });
}

// ── High Contrast Mode ──────────────────────────────────────────────────────────

function toggleHighContrast(on) {
    document.body.classList.toggle('high-contrast', !!on);
    try { localStorage.setItem('lineup-high-contrast', on ? '1' : '0'); } catch(e) {}
}

function restoreHighContrast() {
    var on;
    try { on = localStorage.getItem('lineup-high-contrast') === '1'; } catch(e) { on = false; }
    if (on) {
        document.body.classList.add('high-contrast');
        var chk = document.getElementById('highContrastCheck');
        if (chk) chk.checked = true;
    }
}

// ── Smart Stack (Favorites bar auto-page-switch) ─────────────────────────────
// Whether the Favorites bar is allowed to jump pages on its own at all — see
// _pollFavSmartStack below for the actual predictive logic. Defaults on;
// this is purely an escape hatch for anyone who finds the auto-jump
// distracting. Turning it off (or the bar going out of view) resets
// _favSmartWasVisible so a later re-enable recalibrates instead of firing a
// stale edge from whatever changed while it was off.
var _smartStackEnabled = true;

function toggleSmartStack(on) {
    _smartStackEnabled = !!on;
    if (!_smartStackEnabled) _favSmartWasVisible = false;
    try { localStorage.setItem('lineup-smart-stack', _smartStackEnabled ? '1' : '0'); } catch(e) {}
}

function restoreSmartStack() {
    var raw;
    try { raw = localStorage.getItem('lineup-smart-stack'); } catch(e) {}
    _smartStackEnabled = raw !== '0'; // unset (first run) -> on, matching the default above
    var chk = document.getElementById('smartStackCheck');
    if (chk) chk.checked = _smartStackEnabled;
}

// ── Tools search + filter groups ─────────────────────────────────────────────────

var _toolsFilter = 'all';

function setToolsFilter(name) {
    _toolsFilter = name;
    var btns = document.querySelectorAll('.tools-filter-btn');
    for (var i = 0; i < btns.length; i++) {
        btns[i].classList.toggle('active', btns[i].getAttribute('data-filter') === name);
    }
    applyToolsFilter();
}

function applyToolsFilter() {
    var input = document.getElementById('toolsSearchInput');
    var q = input ? input.value.trim().toLowerCase() : '';
    var tiles = document.querySelectorAll('.tools-grid-btn');
    for (var i = 0; i < tiles.length; i++) {
        var tile = tiles[i];
        var title = (tile.getAttribute('title') || '').toLowerCase();
        var group = tile.getAttribute('data-group') || '';
        var matchesGroup  = _toolsFilter === 'all' || group === _toolsFilter;
        var matchesSearch = q.length === 0 || title.indexOf(q) !== -1;
        tile.classList.toggle('tools-grid-btn-hidden', !(matchesGroup && matchesSearch));
    }
    _syncToolsGridScrollGap();
}

// Whether the tool list actually needs to scroll can only be read from the
// DOM (scrollHeight vs. clientHeight) — CSS has no way to select on
// overflow state itself. Toggled here rather than reserving the gap
// unconditionally (tried that first) since a short, filtered list with
// nothing to scroll would otherwise show a big empty gutter on the right
// instead of even padding on all four sides.
function _syncToolsGridScrollGap() {
    var grid = document.querySelector('.tools-grid');
    if (!grid) return;
    grid.classList.toggle('tools-grid-scrollable', grid.scrollHeight > grid.clientHeight + 1);
}

function initToolsSearch() {
    var input = document.getElementById('toolsSearchInput');
    if (!input) return;
    input.addEventListener('input', applyToolsFilter);
}

// As the panel narrows past ~350px, the filter column collapses its text
// labels down to icon-only instead of letting the drawer beside it get
// squeezed illegible. Watches #tab-tools itself (which tracks the panel's
// own width 1:1 up to its own 570px cap) rather than the filter column's
// sub-width — a single toggled breakpoint, not a value tied continuously
// to live resize width, since that showed a legible half-clipped word
// (e.g. "Auto Cro") at whatever width you happened to stop dragging on.
// The CSS transitions on .tools-filter-btn/-label do the actual animating
// the moment .compact flips, so it still reads as a sleek fade+slide
// rather than an instant jump. Same "ResizeObserver on its own width"
// technique _syncAnchorTiers already uses for the Home tab's own zoom.
var TOOLS_FILTER_COMPACT_BREAKPOINT = 350; // #tab-tools width at/below which labels collapse to icon-only

function _syncToolsFilterCompact() {
    var tab = document.getElementById('tab-tools');
    var bar = document.getElementById('tabBarEl');
    if (!tab || !bar) return;
    // Measures .tab-bar, not #tab-tools itself — #tab-tools reports 0
    // width while hidden (display:none, whenever Home is the active tab),
    // which used to mean this went stale (misclassified as .compact) the
    // whole time Tools sat hidden, only correcting itself a frame after
    // switching back. That required a synchronous re-sync (plus a forced
    // reflow, plus a .no-anim transition-suppress) exactly at the tab
    // switch's cut — real, layout-forcing work sitting right in the middle
    // of what's supposed to be a smooth slide, which is what was reading
    // as a jump/stutter there. .tab-bar shares the exact same max-width/
    // centering rules as #tab-tools (see its own CSS comment) so its width
    // is always an accurate stand-in, and it's never display:none in
    // either tab or layout mode (Classic collapses it via opacity/
    // max-height, not display) — so reading its width keeps this
    // continuously correct even while #tab-tools is hidden, and the
    // synchronous re-sync at switch time in _applyTabPanels is no longer
    // needed at all.
    var w = bar.getBoundingClientRect().width;
    tab.classList.toggle('compact', w < TOOLS_FILTER_COMPACT_BREAKPOINT);
    // Column count (1/2/3, its own width breakpoints) and available height
    // (max-height: calc(100vh - 220px)) both change with this same resize,
    // either of which can flip whether the tool list actually overflows.
    _syncToolsGridScrollGap();
}

function _initToolsFilterCompact() {
    var bar = document.getElementById('tabBarEl');
    if (!bar || typeof ResizeObserver === 'undefined') return;
    new ResizeObserver(function() { _syncToolsFilterCompact(); }).observe(bar);
}

// ── Section toggle ────────────────────────────────────────────────────────────

function toggleSection(id) {
    var hdr  = document.querySelector('#sec-' + id + ' .section-hdr');
    var body = document.getElementById('body-' + id);
    var collapsed = body.classList.toggle('hidden');
    hdr.classList.toggle('collapsed', collapsed);
    try { localStorage.setItem('lineup-sec-' + id, collapsed ? '1' : '0'); } catch(e) {}
}

function restoreCollapsed() {
    var ids = ['align','dist','sizing','anchor','ease','sort','autocrop','organize','spell'];
    ids.forEach(function(id) {
        var stored;
        try { stored = localStorage.getItem('lineup-sec-' + id); } catch(e) {}
        if (stored === '1') {
            var body = document.getElementById('body-' + id);
            var hdr  = document.querySelector('#sec-' + id + ' .section-hdr');
            if (body) body.classList.add('hidden');
            if (hdr)  hdr.classList.add('collapsed');
        }
    });
}

// ── Toast notifications ───────────────────────────────────────────────────────

var _toastTimer = null;

function showToast(msg, type) {
    var toast = document.getElementById('toast');
    var msgEl = document.getElementById('toast-msg');
    if (!toast || !msgEl) return;
    msgEl.textContent = msg;
    toast.classList.toggle('toast-info', type === 'info');
    toast.classList.remove('toast-hidden');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(hideToast, 3000);
}

function hideToast() {
    var toast = document.getElementById('toast');
    if (toast) toast.classList.add('toast-hidden');
    clearTimeout(_toastTimer);
}

// ── Favorites ─────────────────────────────────────────────────────────────────
// Backs only the distribute pickers' own star buttons now (favorite a Z/
// Path/Radial/Grid distribute mode — see _makePickerStarBtn). A separate
// right-click "favorite this button" popup used to share this same data,
// pinning favorited buttons into a bar at the top of the panel — that bar
// was removed in an earlier restructure, leaving the popup with nothing to
// do, so it (and the per-button wiring that opened it) was removed too.

var _favorites  = {};

var _FAV_STAR_SVG      = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><polygon points="6,0.8 7.4,4.4 11.2,4.7 8.4,7.2 9.3,11 6,9.1 2.7,11 3.6,7.2 0.8,4.7 4.6,4.4"/></svg>';
var _FAV_STAR_SVG_FILL = '<svg viewBox="0 0 12 12" fill="currentColor" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><polygon points="6,0.8 7.4,4.4 11.2,4.7 8.4,7.2 9.3,11 6,9.1 2.7,11 3.6,7.2 0.8,4.7 4.6,4.4"/></svg>';

function _loadFavorites() {
    try { _favorites = JSON.parse(localStorage.getItem('lineup-favorites') || '{}'); } catch(e) { _favorites = {}; }
}

function _saveFavorites() {
    try { localStorage.setItem('lineup-favorites', JSON.stringify(_favorites)); } catch(e) {}
}

function isFavorited(id) {
    return !!_favorites[id];
}

function toggleFavorite(id) {
    var adding = !_favorites[id];
    if (adding) { _favorites[id] = 1; } else { delete _favorites[id]; }
    _saveFavorites();
    _syncAllPickerStars();
    if (adding) _showFavToast(id);
}

function _showFavToast(id) {
    var btn   = document.querySelector('[data-fav-id="' + id + '"]:not([data-fav-clone])');
    var label = btn ? (btn.title || 'Item') : 'Item';
    var toast = document.getElementById('toast');
    var msgEl = document.getElementById('toast-msg');
    if (!toast || !msgEl) return;
    msgEl.textContent = '★  ' + label + ' favorited';
    toast.className = 'toast toast-fav';
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(hideToast, 2500);
}

function _syncAllPickerStars() {
    var stars = document.querySelectorAll('[data-picker-star]');
    for (var i = 0; i < stars.length; i++) {
        var id     = stars[i].getAttribute('data-picker-star');
        var active = isFavorited(id);
        stars[i].classList.toggle('fav-active', active);
        stars[i].innerHTML = active ? _FAV_STAR_SVG_FILL : _FAV_STAR_SVG;
    }
}

function _makePickerStarBtn(favId) {
    var btn    = document.createElement('button');
    btn.className = 'picker-star-btn';
    btn.setAttribute('data-picker-star', favId);
    btn.title  = 'Favorite';
    btn.type   = 'button';
    var active = isFavorited(favId);
    btn.innerHTML = active ? _FAV_STAR_SVG_FILL : _FAV_STAR_SVG;
    if (active) btn.classList.add('fav-active');
    btn.addEventListener('click', function(e) {
        e.stopPropagation();
        toggleFavorite(favId);
    });
    return btn;
}

// ── Generic evalScript wrapper ────────────────────────────────────────────────

function run(script, onSuccess) {
    cs.evalScript(script, function(result) {
        if (!result || result === 'undefined') return;
        if (result.indexOf('ERROR:') === 0) {
            showToast(result.replace(/^ERROR:\s*/, ''));
            return;
        }
        if (onSuccess) onSuccess(result);
    });
}

// ── Input helpers ─────────────────────────────────────────────────────────────

function numVal(id, fallback) {
    var v = parseFloat(document.getElementById(id).value);
    return isNaN(v) ? (fallback || 0) : v;
}
function selVal(id) {
    var el = document.getElementById(id);
    return el ? parseInt(el.value, 10) : 0;
}
function chkVal(id) {
    var el = document.getElementById(id);
    return (el && el.checked) ? 1 : 0;
}

// ── ALIGN ─────────────────────────────────────────────────────────────────────

function doAlign(idx) {
    var alignToSel   = (selVal('alignMode') === 0) ? 1 : 0;
    var margin       = numVal('marginInput');
    var usePct       = selVal('pixelDropdown');
    var offsetKeys   = chkVal('offsetCheck');
    var useKeyAlign  = _keyAlignEffective() ? 1 : 0;
    run('lineup_align(' + idx + ',' + alignToSel + ',' + margin + ',' + usePct + ',' + offsetKeys + ',' + useKeyAlign + ')');
}

// Whether Left/Center/Right should actually retime keyframes right now —
// keyframes have to be selected AND the override toggle (see
// #keyAlignCheck/toggleKeyAlignOverride) has to still be checked. Passed
// into lineup_align() explicitly (see doAlign) instead of leaving host.jsx
// to re-derive it alone, since the whole point of the toggle is to let the
// user force normal position alignment even while keyframes stay selected.
var _keyframesPresent = false; // raw: does the Timeline have any keyframes selected right now
var _keyAlignMode     = false; // effective: keyframesPresent AND the toggle is checked — drives the icon swap
function _keyAlignEffective() {
    var chk = document.getElementById('keyAlignCheck');
    return _keyframesPresent && (!chk || chk.checked);
}

// Left/Center/Right's own icons/tooltips follow the EFFECTIVE state, not
// raw keyframe presence — unchecking the toggle reverts them to their
// normal-align look even though keyframes are still technically selected,
// since that's what the buttons will actually do at that point.
function _applyKeyAlignMode() {
    var body = document.querySelector('.tool-body[data-block-id="alignlayers"]');
    if (!body) return;
    var on = _keyAlignEffective();
    if (on === _keyAlignMode) return;
    _keyAlignMode = on;
    body.classList.toggle('key-align-mode', on);
    var leftBtn   = document.getElementById('alignLeftBtn');
    var centerBtn = document.getElementById('alignCenterHBtn');
    var rightBtn  = document.getElementById('alignRightBtn');
    if (leftBtn)   leftBtn.title   = on ? 'Align Keyframes to First Keyframe' : 'Align Left';
    if (centerBtn) centerBtn.title = on ? 'Align Keyframes to Playhead/Center' : 'Center Horizontal';
    if (rightBtn)  rightBtn.title  = on ? 'Align Keyframes to Last Keyframe'   : 'Align Right';
}

// Wired to #keyAlignCheck's onchange — a manual click needs the same
// re-evaluation _pollKeyAlignMode's own state change triggers below.
function toggleKeyAlignOverride() {
    _applyKeyAlignMode();
}

// Polls whether any keyframe is currently selected so Align Left/Center/Right
// can live-swap into keyframe-retiming mode (badge + playhead icon), and so
// the keyframe-align override toggle can fade in/out next to "Align to" —
// AE has no "selection changed" event to push this, so a cheap interval is
// the only way to keep it in sync with the Timeline.
function _pollKeyAlignMode() {
    var body = document.querySelector('.tool-body[data-block-id="alignlayers"]');
    // Skip the evalScript round-trip entirely when Align isn't even visible
    // right now (Tools tab active, widget unpinned, etc.) — this poll ran
    // regardless before, and a cs.evalScript call crossing into
    // ExtendScript is one of the more expensive things a CEP panel can do
    // every 300ms, forever, for a check that can't possibly matter yet.
    if (!body || !body.offsetParent) return;
    cs.evalScript('lineup_hasSelectedKeyframes()', function(result) {
        var present = result === '1';
        if (present === _keyframesPresent) return;
        _keyframesPresent = present;

        var toggle = document.getElementById('keyAlignToggle');
        if (toggle) toggle.classList.toggle('key-align-toggle-visible', present);
        if (present) {
            // Resets to checked every time it (re)appears — it never
            // remembers a previous manual uncheck across a fresh
            // keyframe selection.
            var chk = document.getElementById('keyAlignCheck');
            if (chk) chk.checked = true;
        }
        _applyKeyAlignMode();
    });
}

// ── DISTRIBUTE ────────────────────────────────────────────────────────────────

function doDist(horizontal) {
    var mode       = selVal('distMode');
    var offsetKeys = chkVal('distOffsetCheck');
    // Key Layer mode always lines layers up back to back — no user-set spacing.
    run('lineup_distribute(' + horizontal + ',' + mode + ',0,' + offsetKeys + ')');
}

function doDistZ() {
    var mode    = selVal('distMode');
    var spacing = 0; // Key Layer mode always lines layers up back to back
    var zStart  = parseFloat(document.getElementById('zStartInput').value);
    var zEnd    = parseFloat(document.getElementById('zEndInput').value);
    var even    = parseInt(document.getElementById('zEvenInput').value, 10);
    var step    = parseFloat(document.getElementById('zStepInput').value);
    if (isNaN(zStart)) zStart = 0;
    if (isNaN(zEnd))   zEnd   = 1000;
    if (isNaN(even))   even   = 1;
    if (isNaN(step))   step   = 100;
    run('lineup_zDistribute(' + mode + ',' + spacing + ',' + zStart + ',' + zEnd + ',' + even + ',' + step + ')');
}

function doDistPath() {
    var mode    = selVal('distMode');
    var spacing = numVal('pathSpacingInput');
    var rotate  = chkVal('pathRotateCheck');
    run('lineup_pathDistribute(' + mode + ',' + spacing + ',' + rotate + ')');
}

function doDistRadial() {
    var mode    = selVal('distMode');
    var spacing = 0; // Key Layer mode always lines layers up back to back
    var radius  = numVal('radialInput', 500);
    var rotate  = chkVal('rotateCheck');
    run('lineup_radialDistribute(' + mode + ',' + spacing + ',' + radius + ',' + rotate + ')');
}

function doDistGrid() {
    var mode = selVal('distMode');
    var cols = parseInt(document.getElementById('gridColsInput').value, 10) || 3;
    var rows = parseInt(document.getElementById('gridRowsInput').value, 10) || 3;
    var alignEdges = chkVal('alignEdgesCheck');
    var hPad = parseFloat(document.getElementById('gridHPadInput').value);
    var vPad = parseFloat(document.getElementById('gridVPadInput').value);
    var hPadArg = isNaN(hPad) ? 'NaN' : hPad;
    var vPadArg = isNaN(vPad) ? 'NaN' : vPad;
    run('lineup_gridDistribute(' + mode + ',' + cols + ',' + rows + ',' + alignEdges + ',' + hPadArg + ',' + vPadArg + ')');
}

// Align Edges has no effect once both axes have a manual Gap override — dim it for clarity.
function _syncAlignEdgesDim() {
    var grp = document.getElementById('alignEdgesGroup');
    if (!grp) return;
    var h = parseFloat(document.getElementById('gridHPadInput').value);
    var v = parseFloat(document.getElementById('gridVPadInput').value);
    grp.classList.toggle('dimmed', !isNaN(h) && !isNaN(v));
}

// ── SIZING ────────────────────────────────────────────────────────────────────

function doSizeMatch(mode) {
    var sizeMode = selVal('sizeMode');
    var crop     = selVal('sizeFitMode');
    var move     = chkVal('sizeMoveCheck');
    run('lineup_sizeMatch(' + mode + ',' + sizeMode + ',' + crop + ',' + move + ')');
}

function setSizeFitMode(val) {
    document.getElementById('sizeFitMode').value = val;
}

// ── ANCHOR POINT ──────────────────────────────────────────────────────────────
// "Based on" (Object/Selection/Composition) used to be a native <select>
// plus an "Ignore Masks" checkbox. The checkbox is gone — Object mode
// always respects masks now (matches its old default, unchecked, behavior;
// lineup_anchorMove's own ignoreMasks parameter is still there underneath,
// just always passed 0 from here) — and the dropdown is now a custom
// icon+word button + flyout, same pattern as Select Paths/Split Text's own
// AE-native-toolbar flyouts (see _buildAnchorModeCtx/_openAnchorModeCtx
// below), since a native <select> can't show a custom icon in its own
// closed state.
var ANCHOR_MODE_OPTIONS = [
    {
        id: 0, label: 'Object', title: 'Based on: Object — this layer’s own bounds',
        svg: '<svg viewBox="0 0 20 20" fill="currentColor"><circle cx="10" cy="10" r="4.5"/></svg>'
    },
    {
        id: 1, label: 'Selection', title: 'Based on: Selection — combined bounds of every selected layer',
        svg: '<svg viewBox="0 0 20 20" fill="currentColor"><rect x="3" y="3" width="8" height="8" rx="1.2" opacity="0.55"/><rect x="9" y="9" width="8" height="8" rx="1.2"/></svg>'
    },
    {
        id: 2, label: 'Composition', title: 'Based on: Composition — the comp’s own bounds',
        svg: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="2.5" width="15" height="15" rx="1.8"/></svg>'
    }
];
var _anchorMode = 0;

function _anchorModeFindOption(id) {
    for (var i = 0; i < ANCHOR_MODE_OPTIONS.length; i++) {
        if (ANCHOR_MODE_OPTIONS[i].id === id) return ANCHOR_MODE_OPTIONS[i];
    }
    return ANCHOR_MODE_OPTIONS[0];
}

function _anchorModeRefreshButton() {
    var opt = _anchorModeFindOption(_anchorMode);
    var btn = document.getElementById('anchorModeBtn');
    if (!btn) return;
    var icon = document.getElementById('anchorModeBtnIcon');
    var lbl = document.getElementById('anchorModeBtnLbl');
    if (icon) icon.innerHTML = opt.svg;
    if (lbl) lbl.textContent = opt.label;
    btn.title = opt.title;
}

// Not persisted across sessions — the native <select> it replaces never
// was either (always started back at Object/id 0 on reload).
function _anchorModeInit() {
    _anchorModeRefreshButton();
}

function _anchorModeSet(id) {
    _anchorMode = _anchorModeFindOption(id).id;
    _anchorModeRefreshButton();
    _closeAnchorModeCtx();
}

// Click opens the flyout directly — unlike Select Paths/Split Text's own
// left-click-runs/right-click-switches convention, picking a "based on"
// mode doesn't itself DO anything (doAnchor/doCreateNull read whatever's
// currently set whenever their own buttons are clicked), so there's no
// "re-run the last one" action for a left-click to perform instead.
var _anchorModeCtx = null;

function _buildAnchorModeCtx() {
    var el = document.createElement('div');
    el.className = 'fav-ctx shape-sel-ctx';
    var row = document.createElement('div');
    row.className = 'shape-sel-ctx-row';
    ANCHOR_MODE_OPTIONS.forEach(function(opt) {
        var item = document.createElement('button');
        item.type = 'button';
        item.className = 'shape-sel-ctx-icon-btn';
        item.title = opt.title;
        item.innerHTML = opt.svg + '<span class="shape-sel-ctx-lbl">' + opt.label + '</span>';
        item.setAttribute('data-mode', opt.id);
        item.addEventListener('click', function() { _anchorModeSet(opt.id); });
        row.appendChild(item);
    });
    el.appendChild(row);
    document.body.appendChild(el);
    return el;
}

// Anchored to the click itself (via the event's clientX/Y) rather than
// the button's own getBoundingClientRect() — clientX/Y come straight from
// the OS pointer and are never distorted by CSS zoom the way an element's
// gBCR can be in this CEF build (see the old approach this replaced,
// still used as the no-event fallback below: re-parenting into the
// button's own .tab-panel and diffing two gBCR calls, which canceled out
// a single zoom layer like the panel-wide Panel Scale but not the extra,
// independent zoom #homeTopGroup applies on top of it for Anchor/
// Favorites-bar buttons specifically — that stacked distortion was
// throwing the flyout off from where it was actually clicked). Anchoring
// to the pointer sidesteps the whole class of bug instead of trying to
// cancel out an unknown number of nested zooms.
function _openAnchorModeCtx(btn, e) {
    if (!_anchorModeCtx) _anchorModeCtx = _buildAnchorModeCtx();
    var container = btn.closest('.tab-panel') || document.body;
    container.appendChild(_anchorModeCtx);
    var items = _anchorModeCtx.querySelectorAll('.shape-sel-ctx-icon-btn');
    for (var i = 0; i < items.length; i++) {
        items[i].classList.toggle('active', parseInt(items[i].getAttribute('data-mode'), 10) === _anchorMode);
    }
    var cw = container.clientWidth, ch = container.clientHeight;
    _anchorModeCtx.classList.remove('compact');
    var wideFits = (_anchorModeCtx.offsetWidth + 8) <= cw;
    _anchorModeCtx.classList.toggle('compact', !wideFits);

    var containerRect = container.getBoundingClientRect();
    var rect = btn.getBoundingClientRect();
    var cx = (e ? e.clientX : rect.left) - containerRect.left;
    var cy = (e ? e.clientY : rect.top)  - containerRect.top;
    var ctxW = _anchorModeCtx.offsetWidth;
    var ctxH = _anchorModeCtx.offsetHeight;
    var left = Math.min(Math.max(4, cx - ctxW / 2), cw - ctxW - 4);
    var top = (cy + 4 + ctxH <= ch)
        ? cy + 4
        : Math.max(4, cy - ctxH - 4);
    _anchorModeCtx.style.left = left + 'px';
    _anchorModeCtx.style.top  = top + 'px';
    _anchorModeCtx.classList.add('visible');
    setTimeout(function() {
        document.addEventListener('mousedown', _anchorModeCtxOutside);
        document.addEventListener('keydown', _anchorModeCtxKey);
    }, 0);
}

function _closeAnchorModeCtx() {
    if (_anchorModeCtx) _anchorModeCtx.classList.remove('visible');
    document.removeEventListener('mousedown', _anchorModeCtxOutside);
    document.removeEventListener('keydown', _anchorModeCtxKey);
}

function _anchorModeCtxOutside(e) {
    if (_anchorModeCtx && !_anchorModeCtx.contains(e.target)) _closeAnchorModeCtx();
}

function _anchorModeCtxKey(e) {
    if (e.key === 'Escape') _closeAnchorModeCtx();
}

// Not persisted across sessions, matching the mode dropdown above (and the
// checkbox this replaces, which also always reset to unchecked/"respect
// masks" on reload).
var _ignoreMasks = false;

function _ignoreMasksRefreshButton() {
    var btn = document.getElementById('ignoreMasksBtn');
    if (!btn) return;
    btn.classList.toggle('active', _ignoreMasks);
    btn.title = _ignoreMasks ? "Ignore Masks: On" : "Ignore Masks: Off";
}

function doToggleIgnoreMasks() {
    _ignoreMasks = !_ignoreMasks;
    _ignoreMasksRefreshButton();
}

// Keeps the button visually square — it stretches height:100% to match
// .anchor-null-btn's own height now (see .anchor-ignore-masks-btn's CSS
// comment for why that's not aspect-ratio), so width is kept in sync with
// however tall that actually renders, in JS, exactly like the ease-copy
// interpolation button's own square-sync (_easeInterpSquareSync above).
function _anchorIgnoreMasksSquareSync() {
    var btn = document.getElementById('ignoreMasksBtn');
    if (!btn || !btn.offsetParent) return;
    btn.style.width = btn.offsetHeight + 'px';
}

function _initAnchorIgnoreMasksSquare() {
    var cluster = document.querySelector('.anchor-null-cluster');
    if (!cluster || typeof ResizeObserver === 'undefined') return;
    new ResizeObserver(_anchorIgnoreMasksSquareSync).observe(cluster);
    _anchorIgnoreMasksSquareSync();
}

// Same 9 directions the icons used to slide via CSS :hover (index here is
// loc, 0-8, matching the grid's own reading-order layout) — null at index
// 4 (Center) since that one scales instead of translating.
var ANCHOR_HOVER_OFFSETS = [
    [-4, -4], [0, -4], [4, -4],
    [-4, 0],  null,    [4, 0],
    [-4, 4],  [0, 4],  [4, 4]
];
// More than double the hover slide — "all the way to the edge" of the
// button rather than the small hover nudge.
var ANCHOR_SNAP_OFFSETS = [
    [-11, -11], [0, -11], [11, -11],
    [-11, 0],   null,     [11, 0],
    [-11, 11],  [0, 11],  [11, 11]
];
// Smooth deceleration, no overshoot (was cubic-bezier(0.34,1.56,0.64,1),
// an easeOutBack — the >1 middle value is exactly what made it bounce
// past its target before settling; this curve never exceeds 1). A gentler
// falloff than a first pass at this (0.22,1,0.36,1, an easeOutQuint) —
// that one was still snapping to speed almost immediately; this eases
// into it more gradually. Shared by every state change below (hover
// in/out, click) so they all feel like the same motion regardless of
// which one's currently playing.
var ANCHOR_ICON_EASING = 'cubic-bezier(0.33, 1, 0.68, 1)';

function _anchorIconTransform(loc, hovered) {
    if (loc === 4) return hovered ? 'scale(1.12)' : 'scale(1)';
    var off = hovered ? ANCHOR_HOVER_OFFSETS[loc] : [0, 0];
    return 'translate(' + off[0] + 'px, ' + off[1] + 'px)';
}

// One Animation per icon at a time, tracked so a new one can cancel
// whatever's still playing and continue smoothly FROM its current
// (possibly mid-flight) transform instead of snapping there first — this
// is what makes hovering off mid-click, or re-hovering mid-fade-out,
// blend instead of jump. getComputedStyle reads whatever the in-progress
// animation has interpolated to at this exact instant, so restarting from
// it is seamless regardless of when the interruption happens.
var _anchorIconAnims = new WeakMap();

function _anchorAnimateIconTo(svg, toTransform, duration) {
    var prev = _anchorIconAnims.get(svg);
    var from = getComputedStyle(svg).transform;
    if (prev) prev.cancel();
    var anim = svg.animate(
        [{ transform: from }, { transform: toTransform }],
        { duration: duration, easing: ANCHOR_ICON_EASING, fill: 'forwards' }
    );
    _anchorIconAnims.set(svg, anim);
    anim.onfinish = function() {
        // Bake the end state into a plain inline style and let the
        // Animation itself go — leaving fill:'forwards' Animations
        // stacked up indefinitely is what future getComputedStyle reads
        // (the next interruption) would otherwise have to unwind.
        svg.style.transform = toTransform;
        anim.cancel();
        if (_anchorIconAnims.get(svg) === anim) _anchorIconAnims.delete(svg);
    };
    return anim;
}

// Hover in/out — same easing/mechanism as the click punch below, just a
// two-point animation instead of three, and short enough to read as
// immediate. Replaces the old CSS :hover transition entirely (see
// .anchor-btn svg's own comment in style.css for why that couldn't
// coexist with the click animation).
function _anchorHoverIconTo(btn, loc, hovered) {
    var svg = btn && btn.querySelector('svg');
    if (!svg || typeof svg.animate !== 'function') return;
    _anchorAnimateIconTo(svg, _anchorIconTransform(loc, hovered), 180);
}

function _initAnchorBtnHoverAnim() {
    var buttons = document.querySelectorAll('.anchor-grid .anchor-btn');
    for (var i = 0; i < buttons.length; i++) {
        (function(btn, loc) {
            btn.addEventListener('mouseenter', function() { _anchorHoverIconTo(btn, loc, true); });
            btn.addEventListener('mouseleave', function() { _anchorHoverIconTo(btn, loc, false); });
        })(buttons[i], i);
    }
}

// Punches the clicked corner/edge icon out to the edge, then settles back
// to the hover position — an exaggerated continuation of the hover slide
// above, not a replacement for it. If the cursor leaves mid-animation,
// _anchorHoverIconTo's own mouseleave handler (registered independently
// above) fires _anchorAnimateIconTo again and cancels this one — reading
// its current in-flight transform first, so the retarget to rest blends
// instead of snapping, exactly like any other interruption here.
function _animateAnchorClick(loc, btn) {
    var svg = btn && btn.querySelector('svg');
    if (!svg || typeof svg.animate !== 'function') return;
    var edgeTransform = loc === 4
        ? 'scale(1.3)'
        : 'translate(' + ANCHOR_SNAP_OFFSETS[loc][0] + 'px, ' + ANCHOR_SNAP_OFFSETS[loc][1] + 'px)';
    var hoverTransform = _anchorIconTransform(loc, true);
    var prev = _anchorIconAnims.get(svg);
    var from = getComputedStyle(svg).transform;
    if (prev) prev.cancel();
    var anim = svg.animate(
        [{ transform: from }, { transform: edgeTransform }, { transform: hoverTransform }],
        { duration: 346, easing: ANCHOR_ICON_EASING, fill: 'forwards' } // 384 * 0.9
    );
    _anchorIconAnims.set(svg, anim);
    anim.onfinish = function() {
        svg.style.transform = hoverTransform;
        anim.cancel();
        if (_anchorIconAnims.get(svg) === anim) _anchorIconAnims.delete(svg);
    };
}

function doAnchor(loc, btn) {
    _animateAnchorClick(loc, btn);
    run('lineup_anchorMove(' + loc + ',' + _anchorMode + ',' + (_ignoreMasks ? 1 : 0) + ')');
}

function doAnchorCopy() {
    run('lineup_anchorCopy()', function(result) {
        document.getElementById('anchorDisplay').textContent = result;
        document.getElementById('anchorPasteBtn').disabled = false;
    });
}

function doAnchorPaste() {
    run('lineup_anchorPaste()', function() {
        document.getElementById('anchorDisplay').textContent = '—, —';
        document.getElementById('anchorPasteBtn').disabled = true;
    });
}

function doAnchorClear() {
    run('lineup_anchorClear()', function() {
        document.getElementById('anchorDisplay').textContent = '—, —';
        document.getElementById('anchorPasteBtn').disabled = true;
    });
}

function doCreateNull() {
    run('lineup_createNull(' + _anchorMode + ')');
}

// ── EASE COPY ─────────────────────────────────────────────────────────────────
// Copy/Paste operate on the ease clipboard as before, and the preview graph
// is back to showing that same copied ease (not the live Timeline
// selection — see "Ease/keyframe graph" below) — so every one of these
// re-polls the graph immediately after, rather than waiting up to 250ms
// for the next tick to notice the clipboard changed.

function doEaseCopy() {
    run('lineup_easeCopy()', function(result) {
        if (result && result.length > 0) {
            document.querySelector('#easeDisplay .ease-display-text').textContent = result;
            document.getElementById('easePasteBtn').disabled = false;
        }
        _pollEaseGraph();
        _easeSelIndicatorRender();
    });
}

function doEasePaste() {
    run('lineup_easePaste()', function(result) { showToast(result, 'info'); });
}

// The display box now doubles as its own clear button (see #easeDisplay in
// index.html) — textContent is set on the nested .ease-display-text span,
// not the div itself, since the div also holds the hover-only trash icon svg.
function doEaseClear() {
    run('lineup_easeClear()', function() {
        document.querySelector('#easeDisplay .ease-display-text').textContent = '—';
        document.getElementById('easePasteBtn').disabled = true;
        _pollEaseGraph();
        _easeSelIndicatorRender();
    });
}

// Backs the quick-swap interpolation button (see EASE_INTERP_MODES below
// for how it picks which kind to apply) — applies to whatever's currently
// selected in the Timeline (same scope as an AE interpolation shortcut),
// independent of the ease clipboard above. Re-polls immediately after so
// the corner indicator's count/types reflect the new type without waiting
// for the next tick (the graph itself won't change here — it's tracking
// the copied ease, not this live selection).
//
// The Bezier mode defaults to Continuous Bezier (smooth handles linked
// through the keyframe) rather than plain manual Bezier — Alt-click it for
// plain Bezier instead, same modifier convention as Merge/Explode Shapes'
// own keepOriginals toggle elsewhere in this panel. Independently,
// Ctrl-click either Bezier flavor to zero out the new ease's speed (Easy-
// Ease-style) instead of the default median-of-neighboring-velocity — see
// lineup_setKeyframeInterpolation/_lineup_bezierDefaultEase in host.jsx.
function doSetKeyInterpolation(kind, e) {
    if (kind === 'bezier') kind = (e && e.altKey) ? 'bezier' : 'continuousbezier';
    var zeroVelocity = !!(e && e.ctrlKey);
    run('lineup_setKeyframeInterpolation(\'' + kind + '\', ' + zeroVelocity + ')', function(result) {
        if (result) showToast(result, 'info');
        _pollEaseGraph();
    });
}

// One square button instead of 3 small ones (they read too cramped in
// this tight a row) — left-click applies whichever mode is currently
// active (_easeInterpRunActive), right-click opens a flyout to pick
// Linear/Bezier/Hold instead (_openEaseInterpCtx), same left-click-runs/
// right-click-swaps convention — and the same flyout-building approach,
// down to the zoom-safe positioning math — as Select Paths' own
// SHAPE_SEL_MODES/_buildShapeSelCtx/_openShapeSelCtx elsewhere in this
// file. Picking a mode from the flyout both applies it immediately and
// becomes the new left-click default, persisted the same way. Bezier is
// first (not alphabetical) since it's both the default and, per how this
// control actually gets used, the most common pick.
var EASE_INTERP_MODES = [
    {
        id: 'bezier', title: 'Bezier', kind: 'bezier',
        svg: '<svg viewBox="0 0 20 20" fill="currentColor"><path d="M4.37,4.47 Q4,4 4.6,4 L15.4,4 Q16,4 15.63,4.47 L10.16,11.3 Q10,11.5 9.84,11.3 Z M4.6,16 Q4,16 4.37,15.53 L9.84,8.7 Q10,8.5 10.16,8.7 L15.63,15.53 Q16,16 15.4,16 Z"/></svg>'
    },
    {
        id: 'linear', title: 'Linear', kind: 'linear',
        svg: '<svg viewBox="0 0 20 20" fill="currentColor"><rect x="6.2" y="6.2" width="7.6" height="7.6" rx="1" transform="rotate(45 10 10)"/></svg>'
    },
    {
        id: 'hold', title: 'Hold', kind: 'hold',
        svg: '<svg viewBox="0 0 20 20" fill="currentColor"><rect x="5" y="5" width="10" height="10" rx="1"/></svg>'
    }
];
var EASE_INTERP_MODE_KEY = 'lineup-ease-interp-mode';
var _easeInterpMode = 'bezier';

function _easeInterpFindMode(id) {
    for (var i = 0; i < EASE_INTERP_MODES.length; i++) {
        if (EASE_INTERP_MODES[i].id === id) return EASE_INTERP_MODES[i];
    }
    return EASE_INTERP_MODES[0]; // bezier
}

function _easeInterpInit() {
    var saved;
    try { saved = localStorage.getItem(EASE_INTERP_MODE_KEY); } catch (e) {}
    _easeInterpMode = _easeInterpFindMode(saved).id;
    _easeInterpRefreshButton();
}

// Keeps the button visually square (see its CSS comment for why this is
// JS, not aspect-ratio) — width is set to whatever height:100% actually
// rendered as, in real pixels, every time that height can change: once up
// front, then again whenever the row it stretches to fill resizes (panel
// width changes, Panel Scale zoom, switching between Bottom Layout/
// Favorite/Classic, etc.), via ResizeObserver on the row itself rather
// than the button — the button's own width changing as a RESULT of this
// isn't a resize this needs to react to, only its height is.
function _easeInterpSquareSync() {
    var btn = document.getElementById('easeInterpBtn');
    if (!btn || !btn.offsetParent) return;
    btn.style.width = btn.offsetHeight + 'px';
}

function _initEaseInterpSquare() {
    var row = document.querySelector('.ease-panels-row');
    if (!row || typeof ResizeObserver === 'undefined') return;
    new ResizeObserver(_easeInterpSquareSync).observe(row);
    _easeInterpSquareSync();
}

function _easeInterpSetMode(id) {
    _easeInterpMode = _easeInterpFindMode(id).id;
    try { localStorage.setItem(EASE_INTERP_MODE_KEY, _easeInterpMode); } catch (e) {}
    _easeInterpRefreshButton();
}

function _easeInterpRefreshButton() {
    var mode = _easeInterpFindMode(_easeInterpMode);
    var btn = document.getElementById('easeInterpBtn');
    if (!btn) return;
    var svg = btn.querySelector('svg');
    if (svg) svg.outerHTML = mode.svg;
    btn.title = mode.title;
    // Colors the button by type (see .ease-interp-btn[data-mode] in
    // style.css) — a plain data attribute rather than 3 classes since only
    // ever one applies at a time.
    btn.setAttribute('data-mode', mode.id);
}

function _easeInterpRunActive(e) {
    doSetKeyInterpolation(_easeInterpFindMode(_easeInterpMode).kind, e);
}

var _easeInterpCtx = null;

function _buildEaseInterpCtx() {
    var el = document.createElement('div');
    el.className = 'fav-ctx shape-sel-ctx';
    var row = document.createElement('div');
    row.className = 'shape-sel-ctx-row';
    EASE_INTERP_MODES.forEach(function(mode) {
        var item = document.createElement('button');
        item.type = 'button';
        item.className = 'shape-sel-ctx-icon-btn';
        item.title = mode.title;
        item.innerHTML = mode.svg + '<span class="shape-sel-ctx-lbl">' + mode.title + '</span>';
        item.setAttribute('data-mode', mode.id);
        item.addEventListener('click', function(e) {
            _easeInterpSetMode(mode.id);
            doSetKeyInterpolation(mode.kind, e);
            _closeEaseInterpCtx();
        });
        row.appendChild(item);
    });
    el.appendChild(row);
    document.body.appendChild(el);
    return el;
}

// Same cursor-anchored positioning as _openShapeSelCtx (see its own
// comment) — clientX/Y from the event, not the button's own
// getBoundingClientRect(), since the latter can be distorted by CSS zoom
// in this CEF build in a way clientX/Y never are.
function _openEaseInterpCtx(btn, e) {
    if (!_easeInterpCtx) _easeInterpCtx = _buildEaseInterpCtx();
    var container = btn.closest('.tab-panel') || document.body;
    container.appendChild(_easeInterpCtx);
    var items = _easeInterpCtx.querySelectorAll('.shape-sel-ctx-icon-btn');
    for (var i = 0; i < items.length; i++) {
        items[i].classList.toggle('active', items[i].getAttribute('data-mode') === _easeInterpMode);
    }
    var cw = container.clientWidth, ch = container.clientHeight;
    _easeInterpCtx.classList.remove('compact');
    var wideFits = (_easeInterpCtx.offsetWidth + 8) <= cw;
    _easeInterpCtx.classList.toggle('compact', !wideFits);

    var containerRect = container.getBoundingClientRect();
    var rect = btn.getBoundingClientRect();
    var cx = (e ? e.clientX : rect.left) - containerRect.left;
    var cy = (e ? e.clientY : rect.top)  - containerRect.top;
    var ctxW = _easeInterpCtx.offsetWidth;
    var ctxH = _easeInterpCtx.offsetHeight;
    var left = Math.min(Math.max(4, cx - ctxW / 2), cw - ctxW - 4);
    var top = (cy + 4 + ctxH <= ch)
        ? cy + 4
        : Math.max(4, cy - ctxH - 4);
    _easeInterpCtx.style.left = left + 'px';
    _easeInterpCtx.style.top  = top + 'px';
    _easeInterpCtx.classList.add('visible');
    setTimeout(function() {
        document.addEventListener('mousedown', _easeInterpCtxOutside);
        document.addEventListener('keydown', _easeInterpCtxKey);
    }, 0);
}

function _closeEaseInterpCtx() {
    if (_easeInterpCtx) _easeInterpCtx.classList.remove('visible');
    document.removeEventListener('mousedown', _easeInterpCtxOutside);
    document.removeEventListener('keydown', _easeInterpCtxKey);
}

function _easeInterpCtxOutside(e) {
    if (_easeInterpCtx && !_easeInterpCtx.contains(e.target)) _closeEaseInterpCtx();
}

function _easeInterpCtxKey(e) {
    if (e.key === 'Escape') _closeEaseInterpCtx();
}

// ── Ease/keyframe graph (copied-ease value curve) ────────────────────────────
// Only ever visible at half width or in the Favorite slot (see the CSS on
// .ease-preview). Shows the *copied* ease (the same clipboard Copy/Paste
// use — see lineup_easeGetClipboard in host.jsx), not whatever happens to
// be selected in the Timeline right now. The small indicator overlaid in
// its top-left corner (_easeSelIndicatorRender below) mirrors that same
// copied-keyframe count — the exact same string #easeDisplay already
// shows in single-line/Classic mode — rather than tracking the live
// selection independently.
//
// A value-over-time curve with a diamond at each keyframe, normalized to
// the copied keyframes' relative timing. Reconstructs the same speed/
// influence -> bezier curve AE's own graph editor uses (see
// _easeSegmentSamples), sampling each segment as a parametric curve rather
// than trying to invert time -> value, which sidesteps needing to solve
// the cubic for a given time. Multi-dimensional properties (Position,
// Scale, etc.) collapse to their first dimension — one representative
// curve rather than plotting several, since there's no single meaningful
// "value" combining multiple independently-eased dimensions. No bezier
// handle lines are drawn — just the curve and the keyframe markers.
var EASE_PREVIEW_SAMPLES = 24; // per segment
var EASE_PREVIEW_W = 200;
var EASE_PREVIEW_H = 100;
var _easeGraphLastRaw = null;

function _easeBezierPoint(p0, p1, p2, p3, u) {
    var mu = 1 - u;
    return mu*mu*mu*p0 + 3*mu*mu*u*p1 + 3*mu*u*u*p2 + u*u*u*p3;
}

// A keyframe's dimension-0 value, whether it came through as a plain number
// (Opacity, Rotation) or a per-dimension array (Position, Scale, ...).
function _easeDim0(v) {
    if (Array.isArray(v)) return v.length ? v[0] : 0;
    return typeof v === 'number' ? v : 0;
}

// {t, v} samples between two consecutive keyframes, walking the parametric
// bezier directly (exact, no time->value inversion needed).
function _easeSegmentSamples(kA, kB) {
    var tA = kA.time, tB = kB.time, dt = tB - tA;
    if (!(typeof tA === 'number' && typeof tB === 'number' && dt > 0)) return [];
    var vA = _easeDim0(kA.value), vB = _easeDim0(kB.value);
    var out = [];

    if (kA.outType === 'hold') {
        for (var i = 0; i <= EASE_PREVIEW_SAMPLES; i++) {
            out.push({ t: tA + (i / EASE_PREVIEW_SAMPLES) * dt, v: vA });
        }
        return out;
    }
    if (kA.outType === 'linear' && kB.inType === 'linear') {
        for (var j = 0; j <= EASE_PREVIEW_SAMPLES; j++) {
            var uu = j / EASE_PREVIEW_SAMPLES;
            out.push({ t: tA + uu * dt, v: vA + (vB - vA) * uu });
        }
        return out;
    }

    // Bezier (or Bezier mixed with Linear on one side) — reconstruct the
    // control points from speed/influence the same way AE does; a missing/
    // non-Bezier side falls back to a neutral 1/3 influence, 0 speed.
    var outE = (kA.outEase && kA.outEase[0]) || { speed: 0, influence: 100 / 3 };
    var inE  = (kB.inEase  && kB.inEase[0])  || { speed: 0, influence: 100 / 3 };
    var t1 = tA + (outE.influence / 100) * dt;
    var v1 = vA + outE.speed * (t1 - tA);
    var t2 = tB - (inE.influence / 100) * dt;
    var v2 = vB - inE.speed * (tB - t2);

    for (var k = 0; k <= EASE_PREVIEW_SAMPLES; k++) {
        var u = k / EASE_PREVIEW_SAMPLES;
        out.push({ t: _easeBezierPoint(tA, t1, t2, tB, u), v: _easeBezierPoint(vA, v1, v2, vB, u) });
    }
    return out;
}

function _pollEaseGraph() {
    var box = document.getElementById('easePreview');
    if (!box || !box.offsetParent) return;
    // Cheap fallback alongside the ResizeObserver in _initEaseInterpSquare
    // — belt and suspenders for any resize that observer doesn't catch.
    _easeInterpSquareSync();
    cs.evalScript('lineup_easeGetClipboard()', function(result) {
        if (result === _easeGraphLastRaw) return;
        _easeGraphLastRaw = result;
        var clip = null;
        try { clip = JSON.parse(result); } catch(e) {}
        _easePreviewRender(clip && { keys: clip });
    });
}

// Corner badge, top-left of the graph — just mirrors whatever
// #easeDisplay's own text currently is (the exact same "N ⧗" string
// doEaseCopy/doEaseClear already keep it in sync with), so there's no
// separate count/type computation to maintain here at all. Hidden
// whenever that text is the placeholder dash, same as the graph itself
// hiding behind .is-empty when there's nothing copied — both are driven
// by the same clipboard-empty state.
function _easeSelIndicatorRender() {
    var el = document.getElementById('easeSelIndicator');
    var src = document.querySelector('#easeDisplay .ease-display-text');
    if (!el || !src) return;
    var text = src.textContent;
    if (!text || text === '—') {
        el.classList.remove('visible');
        return;
    }
    el.textContent = text;
    el.classList.add('visible');
}

function _easePreviewRender(data) {
    var box = document.getElementById('easePreview');
    if (!box) return;
    var keys = (data && Array.isArray(data.keys)) ? data.keys.filter(function(k) { return typeof k.time === 'number'; }) : [];
    keys.sort(function(a, b) { return a.time - b.time; });

    if (keys.length < 2) {
        box.classList.add('is-empty');
        return;
    }
    box.classList.remove('is-empty');

    var allSamples = [].concat.apply([], keys.slice(0, -1).map(function(k, i) { return _easeSegmentSamples(k, keys[i + 1]); }));
    if (!allSamples.length) { box.classList.add('is-empty'); return; }

    var tMin = keys[0].time, tMax = keys[keys.length - 1].time, tSpan = (tMax - tMin) || 1;
    var vMin = Infinity, vMax = -Infinity;
    allSamples.forEach(function(s) {
        if (s.v < vMin) vMin = s.v;
        if (s.v > vMax) vMax = s.v;
    });
    var vSpan = (vMax - vMin) || 1;

    // 5% margin on both axes, on top of .ease-preview's own CSS padding.
    var X_MARGIN = EASE_PREVIEW_W * 0.05, VALUE_TOP = EASE_PREVIEW_H * 0.05;
    var PLOT_W = EASE_PREVIEW_W - 2 * X_MARGIN, VALUE_H = EASE_PREVIEW_H - 2 * VALUE_TOP;

    function xOf(t) { return X_MARGIN + ((t - tMin) / tSpan) * PLOT_W; }
    function yOfValue(v) { return VALUE_TOP + VALUE_H - ((v - vMin) / vSpan) * VALUE_H; }

    var valuePath = '';
    allSamples.forEach(function(s, i) {
        valuePath += (i === 0 ? 'M' : 'L') + xOf(s.t).toFixed(2) + ',' + yOfValue(s.v).toFixed(2) + ' ';
    });

    var valueEl = document.getElementById('easePreviewValuePath');
    if (valueEl) valueEl.setAttribute('d', valuePath.trim());

    var handlesG = document.getElementById('easePreviewHandles');
    if (handlesG) handlesG.innerHTML = '';

    // Keyframe markers — always a diamond, regardless of the keyframe's
    // real interpolation type. Drawn as a <polygon> with its own vertical/
    // horizontal reach computed from the SVG's ACTUAL rendered pixel size
    // (not its 200x100 viewBox) — the viewBox stretches non-uniformly to
    // fill whatever box .ease-preview-svg ends up at (preserveAspectRatio
    // ="none"), so a plain square rotated 45° in viewBox-local units comes
    // out as a squished rhombus once that uneven stretch is applied, not a
    // symmetric diamond. Sizing each vertex's LOCAL offset as R/scale (R
    // pixels, divided by that axis's own local-unit-to-pixel scale) instead
    // makes it land at exactly R real pixels from center on both axes,
    // canceling the distortion out entirely.
    var pointsG = document.getElementById('easePreviewPoints');
    if (pointsG) {
        pointsG.innerHTML = '';
        var svgEl = document.getElementById('easePreviewSvg');
        var svgRect = svgEl ? svgEl.getBoundingClientRect() : null;
        var sx = (svgRect && svgRect.width)  ? svgRect.width  / EASE_PREVIEW_W : 1;
        var sy = (svgRect && svgRect.height) ? svgRect.height / EASE_PREVIEW_H : 1;
        var R = 5; // desired on-screen half-diagonal, in real pixels
        var rx = R / sx, ry = R / sy;
        var svgNS = 'http://www.w3.org/2000/svg';
        keys.forEach(function(k) {
            var cx = xOf(k.time), cy = yOfValue(_easeDim0(k.value));
            var pts = [
                cx.toFixed(2) + ',' + (cy - ry).toFixed(2),
                (cx + rx).toFixed(2) + ',' + cy.toFixed(2),
                cx.toFixed(2) + ',' + (cy + ry).toFixed(2),
                (cx - rx).toFixed(2) + ',' + cy.toFixed(2)
            ].join(' ');
            var poly = document.createElementNS(svgNS, 'polygon');
            poly.setAttribute('points', pts);
            pointsG.appendChild(poly);
        });
    }
}

// ── Grid Picker ───────────────────────────────────────────────────────────────

var _gridPicker         = null;
var _gridPickerCells    = null;
var _gridPickerWInput   = null;
var _gridPickerHInput   = null;
var _gridPickerHPadInput = null;
var _gridPickerVPadInput = null;
var _gridPickerAlignCb   = null;

function _buildGridPicker() {
    var el = document.createElement('div');
    el.className = 'grid-picker';

    // Top row: W/H inputs + confirm button
    var top = document.createElement('div');
    top.className = 'grid-picker-top';

    function gpLbl(txt) {
        var s = document.createElement('span');
        s.className = 'gp-lbl';
        s.textContent = txt;
        return s;
    }
    function gpInput() {
        var inp = document.createElement('input');
        inp.type = 'text';
        inp.maxLength = 2;
        return inp;
    }

    var wInput = gpInput(); wInput.value = '3';
    var hInput = gpInput(); hInput.value = '3';
    _gridPickerWInput = wInput;
    _gridPickerHInput = hInput;

    var confirmBtn = document.createElement('button');
    confirmBtn.className = 'grid-picker-confirm';
    confirmBtn.title = 'Confirm';
    confirmBtn.innerHTML = '<svg viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1.5,5.5 4.5,8.5 9.5,2.5"/></svg>';

    top.appendChild(gpLbl('W'));
    top.appendChild(wInput);
    top.appendChild(gpLbl('×'));
    top.appendChild(gpLbl('H'));
    top.appendChild(hInput);
    var gpStarBtn = _makePickerStarBtn('dist-grid');
    gpStarBtn.style.marginLeft = 'auto';
    confirmBtn.style.marginLeft = '4px';
    top.appendChild(gpStarBtn);
    top.appendChild(confirmBtn);
    el.appendChild(top);

    // Align Edges sits up top, mirroring the hidden main-panel checkbox, so it
    // doesn't interfere with hovering/clicking the grid cells below.
    var alignRow = document.createElement('div');
    alignRow.className = 'grid-picker-align-row';
    var alignGroup = document.createElement('span');
    alignGroup.id = 'alignEdgesGroup';
    alignGroup.className = 'spacing-group';
    var alignLabel = document.createElement('label');
    alignLabel.className = 'check-label';
    alignLabel.title = 'Align corner layers to composition/selection edges; distribute the rest evenly between them. Ignored on any axis where Gap is set manually.';
    var alignCb = document.createElement('input');
    alignCb.type = 'checkbox';
    _gridPickerAlignCb = alignCb;
    alignLabel.appendChild(alignCb);
    alignLabel.appendChild(document.createTextNode(' Align Edges'));
    alignGroup.appendChild(alignLabel);
    alignRow.appendChild(alignGroup);
    el.appendChild(alignRow);

    alignCb.addEventListener('change', function() {
        var mainEl = document.getElementById('alignEdgesCheck');
        if (mainEl) mainEl.checked = alignCb.checked;
        _syncAlignEdgesDim();
    });

    // Gap row: small icon + input pairs that mirror the main-panel
    // gridHPadInput/gridVPadInput fields, kept in sync both ways. On its own
    // row below W/H so the top row doesn't get cluttered.
    function gapIcon(horizontal) {
        var NS  = 'http://www.w3.org/2000/svg';
        var svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('viewBox', '0 0 20 20');
        svg.setAttribute('fill', 'currentColor');
        svg.setAttribute('class', 'grid-picker-gap-icon');
        svg.innerHTML = horizontal
            ? '<path d="M3,4 L5,4 L5,16 L3,16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
              '<path d="M17,4 L15,4 L15,16 L17,16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
              '<rect x="9" y="9" width="2" height="2" rx="0.4"/>'
            : '<path d="M4,3 L4,5 L16,5 L16,3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
              '<path d="M4,17 L4,15 L16,15 L16,17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
              '<rect x="9" y="9" width="2" height="2" rx="0.4"/>';
        return svg;
    }

    function gapMirrorInput(mainId) {
        var inp = document.createElement('input');
        inp.type = 'text';
        inp.placeholder = 'Auto';
        inp.className = 'grid-picker-gap-input';
        inp.addEventListener('input', function() {
            var raw   = inp.value;
            var clean = raw.replace(/[^0-9.\-]/g, '');
            clean = clean.replace(/(?!^)-/g, '');
            var parts = clean.split('.');
            if (parts.length > 2) clean = parts[0] + '.' + parts.slice(1).join('');
            if (clean !== raw) inp.value = clean;
            var mainEl = document.getElementById(mainId);
            if (mainEl) mainEl.value = inp.value;
            _syncAlignEdgesDim();
        });
        inp.addEventListener('mousemove', function(e) { e.stopPropagation(); });
        return inp;
    }

    var hPadInp = gapMirrorInput('gridHPadInput');
    var vPadInp = gapMirrorInput('gridVPadInput');
    _gridPickerHPadInput = hPadInp;
    _gridPickerVPadInput = vPadInp;

    var gapRow = document.createElement('div');
    gapRow.className = 'grid-picker-gap-row';
    gapRow.appendChild(gapIcon(true));
    gapRow.appendChild(hPadInp);
    gapRow.appendChild(gapIcon(false));
    gapRow.appendChild(vPadInp);
    el.appendChild(gapRow);

    // Grid
    var grid = document.createElement('div');
    grid.className = 'grid-picker-grid';
    var cells = [];
    for (var r = 0; r < 10; r++) {
        for (var c = 0; c < 10; c++) {
            var cell = document.createElement('div');
            cell.className = 'grid-picker-cell';
            cell.dataset.c = c;
            cell.dataset.r = r;
            grid.appendChild(cell);
            cells.push(cell);
        }
    }
    _gridPickerCells = cells;
    el.appendChild(grid);

    document.body.appendChild(el);

    // Hover → update highlight + inputs
    grid.addEventListener('mouseover', function(e) {
        var cell = e.target;
        if (!cell.classList.contains('grid-picker-cell')) return;
        _gridPickerHighlight(parseInt(cell.dataset.c, 10), parseInt(cell.dataset.r, 10));
    });

    // Click cell → commit + close
    grid.addEventListener('click', function(e) {
        var cell = e.target;
        if (!cell.classList.contains('grid-picker-cell')) return;
        _commitGridPicker();
    });

    // Manual input edits → update highlight
    function onWHInput() {
        var c = Math.min(9, Math.max(0, (parseInt(wInput.value, 10) || 1) - 1));
        var r = Math.min(9, Math.max(0, (parseInt(hInput.value, 10) || 1) - 1));
        _gridPickerHighlight(c, r, true); // don't overwrite user-typed values
    }
    wInput.addEventListener('input', onWHInput);
    hInput.addEventListener('input', onWHInput);

    // Stop grid-cell mouseover from propagating through inputs
    wInput.addEventListener('mouseover', function(e) { e.stopPropagation(); });
    hInput.addEventListener('mouseover', function(e) { e.stopPropagation(); });

    // Confirm button → commit + close
    confirmBtn.addEventListener('click', _commitGridPicker);

    return el;
}

function _gridPickerHighlight(maxC, maxR, skipInputs) {
    for (var i = 0; i < _gridPickerCells.length; i++) {
        var c = parseInt(_gridPickerCells[i].dataset.c, 10);
        var r = parseInt(_gridPickerCells[i].dataset.r, 10);
        _gridPickerCells[i].classList.toggle('lit', c <= maxC && r <= maxR);
    }
    if (!skipInputs) {
        if (_gridPickerWInput) _gridPickerWInput.value = maxC + 1;
        if (_gridPickerHInput) _gridPickerHInput.value = maxR + 1;
    }
}

// Clicking a cell or the checkmark both land here — either one now applies
// the grid immediately (same as clicking the main Distribute-in-Grid button
// yourself right after), instead of just stashing cols/rows for later.
function _commitGridPicker() {
    var cols = Math.max(1, parseInt(_gridPickerWInput.value, 10) || 1);
    var rows = Math.max(1, parseInt(_gridPickerHInput.value, 10) || 1);
    document.getElementById('gridColsInput').value = cols;
    document.getElementById('gridRowsInput').value = rows;
    _closeGridPicker();
    doDistGrid();
}

// A near-square cols x rows guess sized to how many layers are selected —
// e.g. 6 selected -> 3x2, 8 -> 3x3 (one empty cell) — rather than a fixed
// default or just whatever was picked last time, which may have nothing to
// do with the CURRENT selection. cols is always >= rows, matching how
// comps are usually wider than tall.
function _gridGuessColsRows(n) {
    if (!n || n < 1) return { cols: 3, rows: 3 };
    var cols = Math.max(1, Math.ceil(Math.sqrt(n)));
    var rows = Math.max(1, Math.ceil(n / cols));
    return { cols: cols, rows: rows };
}

function _openGridPicker(x, y) {
    if (!_gridPicker) _gridPicker = _buildGridPicker();

    cs.evalScript('lineup_getSelectedLayerCount()', function(result) {
        var guess = _gridGuessColsRows(parseInt(result, 10) || 0);
        var rawCols = guess.cols;
        var rawRows = guess.rows;
        _gridPickerHighlight(Math.min(9, rawCols - 1), Math.min(9, rawRows - 1), true);
        _gridPickerWInput.value = rawCols;
        _gridPickerHInput.value = rawRows;

        var mainH = document.getElementById('gridHPadInput');
        var mainV = document.getElementById('gridVPadInput');
        if (_gridPickerHPadInput) _gridPickerHPadInput.value = mainH ? mainH.value : '';
        if (_gridPickerVPadInput) _gridPickerVPadInput.value = mainV ? mainV.value : '';

        var mainAlign = document.getElementById('alignEdgesCheck');
        if (_gridPickerAlignCb) _gridPickerAlignCb.checked = mainAlign ? mainAlign.checked : false;

        // Position near cursor, clamp inside viewport
        var vw = window.innerWidth, vh = window.innerHeight;
        var pw = 190, ph = 246;
        _gridPicker.style.left = Math.min(x + 4, vw - pw - 4) + 'px';
        _gridPicker.style.top  = Math.min(y + 4, vh - ph - 4) + 'px';

        _gridPicker.classList.add('visible');
        _syncAlignEdgesDim();
        _syncAllPickerStars();

        setTimeout(function() {
            document.addEventListener('mousedown', _gridPickerOutside);
            document.addEventListener('keydown',   _gridPickerKey);
        }, 0);
    });
}

function _closeGridPicker() {
    if (_gridPicker) _gridPicker.classList.remove('visible');
    document.removeEventListener('mousedown', _gridPickerOutside);
    document.removeEventListener('keydown',   _gridPickerKey);
}

function _gridPickerOutside(e) {
    if (_gridPicker && !_gridPicker.contains(e.target)) _closeGridPicker();
}

function _gridPickerKey(e) {
    if (e.key === 'Escape') _closeGridPicker();
}

// ── Radial Picker ─────────────────────────────────────────────────────────────

var RADIAL_PW = 176, RADIAL_PH = 108;

var _radialPicker    = null;
var _rpCompW         = 1920, _rpCompH = 1080;
var _rpScale         = RADIAL_PH / 1080;
var _rpCompLeft      = 0,    _rpCompTop = 0;
var _rpCx            = RADIAL_PW / 2, _rpCy = RADIAL_PH / 2;
var _rpRadius        = 500;
var _rpRadiusInput   = null;
var _rpCircle        = null;
var _rpCenterDot     = null;
var _rpCompBg        = null;
var _rpRotate        = false;
var _rpRotateCb      = null;

function _buildRadialPicker() {
    var el = document.createElement('div');
    el.className = 'radial-picker';

    var top = document.createElement('div');
    top.className = 'radial-picker-top';

    function rpLbl(txt) {
        var s = document.createElement('span');
        s.className = 'gp-lbl';
        s.textContent = txt;
        return s;
    }

    var inp = document.createElement('input');
    inp.type = 'text';
    inp.value = '500';
    _rpRadiusInput = inp;

    var confirmBtn = document.createElement('button');
    confirmBtn.className = 'grid-picker-confirm';
    confirmBtn.title = 'Confirm';
    confirmBtn.innerHTML = '<svg viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1.5,5.5 4.5,8.5 9.5,2.5"/></svg>';

    top.appendChild(rpLbl('Radius'));
    top.appendChild(inp);
    top.appendChild(rpLbl('px'));
    var rpStarBtn = _makePickerStarBtn('dist-radial');
    rpStarBtn.style.marginLeft = 'auto';
    confirmBtn.style.marginLeft = '4px';
    top.appendChild(rpStarBtn);
    top.appendChild(confirmBtn);
    el.appendChild(top);

    // Rotate sits up top so it doesn't interfere with dragging in the preview below
    var rotRow = document.createElement('div');
    rotRow.className = 'radial-picker-rotate-row';
    var rotLabel = document.createElement('label');
    rotLabel.className = 'check-label';
    rotLabel.title = 'Auto Rotate each layer outward along the radial angle';
    var rotCb = document.createElement('input');
    rotCb.type = 'checkbox';
    _rpRotateCb = rotCb;
    rotLabel.appendChild(rotCb);
    rotLabel.appendChild(document.createTextNode(' Rotate'));
    rotRow.appendChild(rotLabel);
    el.appendChild(rotRow);

    rotCb.addEventListener('change', function() { _rpRotate = rotCb.checked; });

    var preview = document.createElement('div');
    preview.className = 'radial-preview';

    var compBg = document.createElement('div');
    compBg.className = 'radial-comp-bg';
    _rpCompBg = compBg;
    preview.appendChild(compBg);

    var NS  = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + RADIAL_PW + ' ' + RADIAL_PH);
    svg.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none';

    var ring = document.createElementNS(NS, 'circle');
    ring.setAttribute('fill', 'rgba(36,112,224,0.08)');
    ring.setAttribute('stroke', '#2470e0');
    ring.setAttribute('stroke-width', '2');
    _rpCircle = ring;
    svg.appendChild(ring);

    var dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('r', '2');
    dot.setAttribute('fill', 'rgba(36,112,224,0.55)');
    _rpCenterDot = dot;
    svg.appendChild(dot);

    preview.appendChild(svg);
    el.appendChild(preview);

    document.body.appendChild(el);

    // Cached lazily (first move of each hover) rather than re-measured via
    // getBoundingClientRect on every single mousemove — the preview
    // doesn't move/resize while the mouse is over it. Cleared on
    // mouseleave so a genuinely repositioned/resized popup gets a fresh
    // measurement the next time the mouse enters.
    var previewRect = null;
    preview.addEventListener('mousemove', function(e) {
        if (!previewRect) previewRect = preview.getBoundingClientRect();
        var dx = e.clientX - previewRect.left - _rpCx;
        var dy = e.clientY - previewRect.top  - _rpCy;
        _rpRadius = Math.max(1, Math.round(Math.sqrt(dx * dx + dy * dy) / _rpScale));
        _rpUpdateVisual();
    });
    preview.addEventListener('mouseleave', function() { previewRect = null; });

    preview.addEventListener('click', _commitRadialPicker);

    inp.addEventListener('input', function() {
        var r = parseFloat(inp.value);
        if (!isNaN(r) && r > 0) {
            _rpRadius = r;
            _rpUpdateCircle();
        }
    });
    inp.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') _commitRadialPicker();
    });
    inp.addEventListener('mousemove', function(e) { e.stopPropagation(); });

    confirmBtn.addEventListener('click', _commitRadialPicker);

    return el;
}

function _rpUpdateCircle() {
    if (!_rpCircle) return;
    _rpCircle.setAttribute('cx', _rpCx);
    _rpCircle.setAttribute('cy', _rpCy);
    _rpCircle.setAttribute('r', Math.max(1, _rpRadius * _rpScale));
    if (_rpCenterDot) {
        _rpCenterDot.setAttribute('cx', _rpCx);
        _rpCenterDot.setAttribute('cy', _rpCy);
    }
}

function _rpUpdateVisual() {
    if (_rpRadiusInput && document.activeElement !== _rpRadiusInput) {
        _rpRadiusInput.value = _rpRadius;
    }
    _rpUpdateCircle();
}

function _rpUpdateAspect() {
    _rpScale     = Math.min(RADIAL_PW / _rpCompW, RADIAL_PH / _rpCompH);
    var rw       = _rpCompW * _rpScale;
    var rh       = _rpCompH * _rpScale;
    _rpCompLeft  = (RADIAL_PW - rw) / 2;
    _rpCompTop   = (RADIAL_PH - rh) / 2;
    _rpCx        = _rpCompLeft + rw / 2;
    _rpCy        = _rpCompTop  + rh / 2;
    if (_rpCompBg) {
        _rpCompBg.style.left   = _rpCompLeft + 'px';
        _rpCompBg.style.top    = _rpCompTop  + 'px';
        _rpCompBg.style.width  = rw + 'px';
        _rpCompBg.style.height = rh + 'px';
    }
}

function _openRadialPicker(x, y) {
    cs.evalScript('lineup_getCompSize()', function(result) {
        var w = 1920, h = 1080;
        if (result && result !== 'undefined' && result.indexOf(',') > 0) {
            var parts = result.split(',');
            var pw2 = parseInt(parts[0], 10);
            var ph2 = parseInt(parts[1], 10);
            if (pw2 > 0 && ph2 > 0) { w = pw2; h = ph2; }
        }
        _rpCompW = w; _rpCompH = h;

        if (!_radialPicker) _radialPicker = _buildRadialPicker();

        _rpUpdateAspect();
        _rpRadius = Math.max(1, parseFloat(document.getElementById('radialInput').value) || 500);
        _rpUpdateVisual();

        var mainRotate = document.getElementById('rotateCheck');
        _rpRotate = mainRotate ? mainRotate.checked : false;
        if (_rpRotateCb) _rpRotateCb.checked = _rpRotate;

        var vw = window.innerWidth, vh = window.innerHeight;
        var popW = 192, popH = 180;
        _radialPicker.style.left = Math.min(x + 4, vw - popW - 4) + 'px';
        _radialPicker.style.top  = Math.min(y + 4, vh - popH - 4) + 'px';
        _radialPicker.classList.add('visible');
        _syncAllPickerStars();

        setTimeout(function() {
            document.addEventListener('mousedown', _radialPickerOutside);
            document.addEventListener('keydown',   _radialPickerKey);
        }, 0);
    });
}

function _closeRadialPicker() {
    if (_radialPicker) _radialPicker.classList.remove('visible');
    document.removeEventListener('mousedown', _radialPickerOutside);
    document.removeEventListener('keydown',   _radialPickerKey);
}

function _radialPickerOutside(e) {
    if (_radialPicker && !_radialPicker.contains(e.target)) _closeRadialPicker();
}

function _radialPickerKey(e) {
    if (e.key === 'Escape') _closeRadialPicker();
}

function _commitRadialPicker() {
    var r = Math.max(1, parseFloat(_rpRadiusInput.value) || 1);
    document.getElementById('radialInput').value = r;
    var rotEl = document.getElementById('rotateCheck');
    if (rotEl) rotEl.checked = _rpRotate;
    _closeRadialPicker();
}

// ── Z-Depth Picker ────────────────────────────────────────────────────────────

var Z_MAX_VIS = 5000;
var Z_LOG_EXP = 2.32;  // pos=0.5 → dist≈1000

var _zPicker         = null;
var _zpStart         = 0;
var _zpEnd           = 1000;
var _zpEven          = true;
var _zpStep          = 100;
var _zpStartInput    = null;
var _zpEndInput      = null;
var _zpCustomStepCb  = null;
var _zpStepInput     = null;
var _zpLineEl        = null;
var _zpCamIcon       = null;
var _zpWash          = null;
var _zpHandle        = null;
var _zpDotCont       = null;
var _zpTrackEl       = null;
var _zpTrackRect     = null; // cached once per drag — see the track's own mousedown handler

function _zpDistToPos(dist) {
    if (dist <= 0) return 0;
    return Math.pow(Math.min(dist, Z_MAX_VIS) / Z_MAX_VIS, 1 / Z_LOG_EXP);
}

function _zpPosToDist(pos) {
    return Z_MAX_VIS * Math.pow(Math.max(0, Math.min(1, pos)), Z_LOG_EXP);
}

function _buildZPicker() {
    var el = document.createElement('div');
    el.className = 'z-picker';

    // Input row: Start [input]  spacer  End [input] [✓]
    var inputsRow = document.createElement('div');
    inputsRow.className = 'z-picker-inputs';

    function zpLbl(txt) {
        var s = document.createElement('span');
        s.className = 'gp-lbl';
        s.textContent = txt;
        return s;
    }

    var startInp = document.createElement('input');
    startInp.type = 'text';
    startInp.value = '0';
    _zpStartInput = startInp;

    var endInp = document.createElement('input');
    endInp.type = 'text';
    endInp.value = '1000';
    _zpEndInput = endInp;

    var spacer = document.createElement('span');
    spacer.className = 'z-spacer';

    var confirmBtn = document.createElement('button');
    confirmBtn.className = 'grid-picker-confirm';
    confirmBtn.title = 'Confirm';
    confirmBtn.innerHTML = '<svg viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1.5,5.5 4.5,8.5 9.5,2.5"/></svg>';

    inputsRow.appendChild(zpLbl('Start'));
    inputsRow.appendChild(startInp);
    inputsRow.appendChild(spacer);
    inputsRow.appendChild(zpLbl('End'));
    inputsRow.appendChild(endInp);
    var zpStarBtn = _makePickerStarBtn('dist-z');
    zpStarBtn.style.marginLeft = '4px';
    confirmBtn.style.marginLeft = '4px';
    inputsRow.appendChild(zpStarBtn);
    inputsRow.appendChild(confirmBtn);
    el.appendChild(inputsRow);

    // Depth line row: track with camera icon floating on it at Z=0 position
    var depthRow = document.createElement('div');
    depthRow.className = 'z-picker-depth';

    var track = document.createElement('div');
    track.className = 'z-track';
    _zpTrackEl = track;

    var lineEl = document.createElement('div');
    lineEl.className = 'z-track-line';
    _zpLineEl = lineEl;
    track.appendChild(lineEl);

    var wash = document.createElement('div');
    wash.className = 'z-track-wash';
    _zpWash = wash;
    track.appendChild(wash);

    var dotCont = document.createElement('div');
    dotCont.className = 'z-track-dots';
    _zpDotCont = dotCont;
    track.appendChild(dotCont);

    // Camera icon lives on the line at the position of Z=0
    var camIcon = document.createElement('div');
    camIcon.className = 'z-cam-icon';
    camIcon.innerHTML = '<svg viewBox="0 0 14 14" width="18" height="18" fill="#1e1e1e" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"><rect x="1" y="4" width="8" height="6" rx="1"/><polygon points="9,5.5 13,3.5 13,10.5 9,8.5"/></svg>';
    _zpCamIcon = camIcon;
    track.appendChild(camIcon);

    var handle = document.createElement('div');
    handle.className = 'z-track-handle';
    _zpHandle = handle;
    track.appendChild(handle);

    depthRow.appendChild(track);
    el.appendChild(depthRow);

    // Footer: Custom Step toggle + step input
    var footer = document.createElement('div');
    footer.className = 'z-picker-footer';

    var stepCbLabel = document.createElement('label');
    stepCbLabel.className = 'check-label';
    var stepCb = document.createElement('input');
    stepCb.type = 'checkbox';
    stepCb.checked = false;
    _zpCustomStepCb = stepCb;
    stepCbLabel.appendChild(stepCb);
    stepCbLabel.appendChild(document.createTextNode(' Step'));

    var stepInp = document.createElement('input');
    stepInp.type = 'text';
    stepInp.value = '100';
    stepInp.className = 'z-step-input';
    stepInp.disabled = true;
    _zpStepInput = stepInp;

    footer.appendChild(stepCbLabel);
    footer.appendChild(stepInp);
    el.appendChild(footer);

    stepCb.addEventListener('change', function() {
        _zpEven = !stepCb.checked;
        stepInp.disabled = !stepCb.checked;
        _zpUpdateVisual();
    });

    stepInp.addEventListener('input', function() {
        var v = parseFloat(stepInp.value);
        if (!isNaN(v) && v > 0) { _zpStep = v; _zpUpdateVisual(); }
    });
    stepInp.addEventListener('mousemove', function(e) { e.stopPropagation(); });

    document.body.appendChild(el);

    // Track: drag moves handle only; confirm button commits
    track.addEventListener('mousedown', function(e) {
        e.preventDefault();
        // Cached once — the track doesn't move/resize for the duration of
        // this drag, so re-measuring it via getBoundingClientRect on
        // every single mousemove (_zpOnTrackDrag's old behavior) was
        // avoidable work.
        _zpTrackRect = track.getBoundingClientRect();
        _zpOnTrackDrag(e);
        function onMove(e2) { _zpOnTrackDrag(e2); }
        function onUp() {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            _zpTrackRect = null;
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });

    // Input handlers update pending state only (not hidden inputs)
    startInp.addEventListener('input', function() {
        var v = parseFloat(startInp.value);
        if (!isNaN(v)) {
            _zpStart = v;
            if (_zpStart > _zpEnd) { _zpEnd = _zpStart; endInp.value = _zpEnd; }
            _zpUpdateVisual();
        }
    });
    endInp.addEventListener('input', function() {
        var v = parseFloat(endInp.value);
        if (!isNaN(v)) {
            _zpEnd = v;
            if (_zpEnd < _zpStart) { _zpEnd = _zpStart; endInp.value = _zpEnd; }
            _zpUpdateVisual();
        }
    });

    // Confirm button commits and closes
    confirmBtn.addEventListener('click', _zpCommit);

    startInp.addEventListener('mousemove', function(e) { e.stopPropagation(); });
    endInp.addEventListener('mousemove',   function(e) { e.stopPropagation(); });

    return el;
}

function _zpOnTrackDrag(e) {
    if (!_zpTrackEl) return;
    var rect = _zpTrackRect || _zpTrackEl.getBoundingClientRect(); // fallback for any non-drag caller
    var pos  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    _zpEnd   = Math.round(_zpStart + _zpPosToDist(pos));
    _zpUpdateVisual();
}

function _zpUpdateVisual() {
    var dist = Math.max(0, _zpEnd - _zpStart);
    var pct  = _zpDistToPos(dist) * 100;
    if (_zpWash)   _zpWash.style.width  = pct + '%';
    if (_zpHandle) _zpHandle.style.left = pct + '%';

    // Camera at the Z=0 linear position within [start, end]
    if (_zpCamIcon) {
        var range = _zpEnd - _zpStart;
        var camFrac;
        if (range <= 0) {
            camFrac = _zpStart >= 0 ? 0 : 1;
        } else {
            camFrac = Math.max(0, Math.min(1, (0 - _zpStart) / range));
        }
        _zpCamIcon.style.left = (camFrac * 100) + '%';
    }

    // Step dots — linearly scaled between left edge and handle position
    if (_zpDotCont) {
        _zpDotCont.innerHTML = '';
        if (!_zpEven && _zpStep > 0 && dist > 0) {
            var numSlots = Math.floor(dist / _zpStep) + 1;
            var cap = Math.min(numSlots, 80);
            for (var d = 0; d < cap; d++) {
                var posInRange = d * _zpStep;
                if (posInRange > dist) break;
                var dot = document.createElement('div');
                dot.className = 'z-track-dot';
                dot.style.left = (posInRange / dist * pct) + '%';
                _zpDotCont.appendChild(dot);
            }
        }
    }

    if (_zpStartInput && document.activeElement !== _zpStartInput) _zpStartInput.value = _zpStart;
    if (_zpEndInput   && document.activeElement !== _zpEndInput)   _zpEndInput.value   = _zpEnd;
}

function _zpCommit() {
    var hs = document.getElementById('zStartInput');
    var he = document.getElementById('zEndInput');
    var hev = document.getElementById('zEvenInput');
    var hst = document.getElementById('zStepInput');
    if (hs)  hs.value  = _zpStart;
    if (he)  he.value  = _zpEnd;
    if (hev) hev.value = _zpEven ? '1' : '0';
    if (hst) hst.value = _zpStep;
    _closeZPicker();
}

function _openZPicker(x, y) {
    if (!_zPicker) _zPicker = _buildZPicker();

    var hs  = document.getElementById('zStartInput');
    var he  = document.getElementById('zEndInput');
    var hev = document.getElementById('zEvenInput');
    var hst = document.getElementById('zStepInput');
    _zpStart = hs  ? (parseFloat(hs.value)  || 0)    : 0;
    _zpEnd   = he  ? (parseFloat(he.value)  || 1000) : 1000;
    _zpEven  = hev ? (hev.value !== '0')              : true;
    _zpStep  = hst ? (parseFloat(hst.value) || 100)  : 100;

    if (_zpCustomStepCb) _zpCustomStepCb.checked = !_zpEven;
    if (_zpStepInput)    { _zpStepInput.value = _zpStep; _zpStepInput.disabled = _zpEven; }

    _zpUpdateVisual();

    var vw = window.innerWidth, vh = window.innerHeight;
    var popW = 196, popH = 90;
    _zPicker.style.left = Math.min(x + 4, vw - popW - 4) + 'px';
    _zPicker.style.top  = Math.min(y + 4, vh - popH - 4) + 'px';
    _zPicker.classList.add('visible');
    _syncAllPickerStars();

    setTimeout(function() {
        document.addEventListener('mousedown', _zPickerOutside);
        document.addEventListener('keydown',   _zPickerKey);
    }, 0);
}

function _closeZPicker() {
    if (_zPicker) _zPicker.classList.remove('visible');
    document.removeEventListener('mousedown', _zPickerOutside);
    document.removeEventListener('keydown',   _zPickerKey);
}

function _zPickerOutside(e) {
    if (_zPicker && !_zPicker.contains(e.target)) _closeZPicker();
}

function _zPickerKey(e) {
    if (e.key === 'Escape') _closeZPicker();
}

// ── Path Picker ───────────────────────────────────────────────────────────────
// Decorative sine-wave curve — not the actual selected layer's path, just a
// stand-in for previewing spacing.

var PATH_PW = 176, PATH_PH = 92;
var _PP_X0 = 14, _PP_X1 = 162, _PP_CY = 46, _PP_AMP = 24, _PP_CYCLES = 2;

var _pathPicker      = null;
var _ppSpacing       = 0;
var _ppRotate        = false;
var _ppSpacingInput  = null;
var _ppRotateCb      = null;
var _ppHandle        = null;
var _ppSquaresG      = null;
var _ppPreviewEl     = null;
var _ppSamples       = null;

function _ppCurvePoint(t) {
    var x = _PP_X0 + t * (_PP_X1 - _PP_X0);
    var y = _PP_CY + _PP_AMP * Math.sin(t * _PP_CYCLES * 2 * Math.PI);
    return { x: x, y: y };
}

function _ppBuildSamples() {
    var pts = [], total = 0, steps = 160;
    var prev = _ppCurvePoint(0);
    pts.push({ x: prev.x, y: prev.y, len: 0 });
    for (var i = 1; i <= steps; i++) {
        var t = i / steps;
        var p = _ppCurvePoint(t);
        var dx = p.x - prev.x, dy = p.y - prev.y;
        total += Math.sqrt(dx * dx + dy * dy);
        pts.push({ x: p.x, y: p.y, len: total });
        prev = p;
    }
    for (var i = 0; i < pts.length; i++) pts[i].frac = total > 0 ? pts[i].len / total : 0;
    _ppSamples = pts;
}

function _ppCurveD() {
    if (!_ppSamples) _ppBuildSamples();
    var d = 'M' + _ppSamples[0].x.toFixed(1) + ',' + _ppSamples[0].y.toFixed(1);
    for (var i = 2; i < _ppSamples.length; i += 2) {
        d += ' L' + _ppSamples[i].x.toFixed(1) + ',' + _ppSamples[i].y.toFixed(1);
    }
    var last = _ppSamples[_ppSamples.length - 1];
    d += ' L' + last.x.toFixed(1) + ',' + last.y.toFixed(1);
    return d;
}

function _ppPointAtFrac(frac) {
    if (!_ppSamples) _ppBuildSamples();
    frac = Math.max(0, Math.min(1, frac));
    for (var i = 1; i < _ppSamples.length; i++) {
        if (_ppSamples[i].frac >= frac) {
            var a = _ppSamples[i - 1], b = _ppSamples[i];
            var span = b.frac - a.frac;
            var f = span > 0 ? (frac - a.frac) / span : 0;
            return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
        }
    }
    var last = _ppSamples[_ppSamples.length - 1];
    return { x: last.x, y: last.y };
}

function _ppNearestFrac(mx, my) {
    if (!_ppSamples) _ppBuildSamples();
    var best = 0, bestD = Infinity;
    for (var i = 0; i < _ppSamples.length; i++) {
        var dx = _ppSamples[i].x - mx, dy = _ppSamples[i].y - my;
        var d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = _ppSamples[i].frac; }
    }
    return best;
}

function _buildPathPicker() {
    var el = document.createElement('div');
    el.className = 'path-picker';

    var top = document.createElement('div');
    top.className = 'path-picker-top';

    function ppLbl(txt) {
        var s = document.createElement('span');
        s.className = 'gp-lbl';
        s.textContent = txt;
        return s;
    }

    var inp = document.createElement('input');
    inp.type = 'text';
    inp.value = '0';
    _ppSpacingInput = inp;

    var confirmBtn = document.createElement('button');
    confirmBtn.className = 'grid-picker-confirm';
    confirmBtn.title = 'Confirm';
    confirmBtn.innerHTML = '<svg viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1.5,5.5 4.5,8.5 9.5,2.5"/></svg>';

    top.appendChild(ppLbl('Spacing'));
    top.appendChild(inp);
    top.appendChild(ppLbl('%'));
    var ppStarBtn = _makePickerStarBtn('dist-path');
    ppStarBtn.style.marginLeft = 'auto';
    confirmBtn.style.marginLeft = '4px';
    top.appendChild(ppStarBtn);
    top.appendChild(confirmBtn);
    el.appendChild(top);

    // Rotate sits above the preview so it doesn't interfere with curve-dragging below
    var rotRow = document.createElement('div');
    rotRow.className = 'path-picker-rotate-row';
    var rotLabel = document.createElement('label');
    rotLabel.className = 'check-label';
    rotLabel.title = 'Rotate each layer to follow the path tangent (separate from Radial\'s Rotate)';
    var rotCb = document.createElement('input');
    rotCb.type = 'checkbox';
    _ppRotateCb = rotCb;
    rotLabel.appendChild(rotCb);
    rotLabel.appendChild(document.createTextNode(' Rotate'));
    rotRow.appendChild(rotLabel);
    el.appendChild(rotRow);

    rotCb.addEventListener('change', function() { _ppRotate = rotCb.checked; });

    var preview = document.createElement('div');
    preview.className = 'path-preview';
    _ppPreviewEl = preview;

    var NS  = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + PATH_PW + ' ' + PATH_PH);
    svg.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%';

    var curve = document.createElementNS(NS, 'path');
    curve.setAttribute('d', _ppCurveD());
    curve.setAttribute('fill', 'none');
    curve.setAttribute('stroke', '#4a4a4a');
    curve.setAttribute('stroke-width', '2');
    curve.setAttribute('stroke-linecap', 'round');
    curve.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(curve);

    var squaresG = document.createElementNS(NS, 'g');
    _ppSquaresG = squaresG;
    svg.appendChild(squaresG);

    var handle = document.createElementNS(NS, 'circle');
    handle.setAttribute('r', '4.5');
    handle.setAttribute('fill', '#2470e0');
    handle.setAttribute('stroke', '#1e1e1e');
    handle.setAttribute('stroke-width', '1.5');
    _ppHandle = handle;
    svg.appendChild(handle);

    preview.appendChild(svg);
    el.appendChild(preview);

    document.body.appendChild(el);

    function onCurveDrag(e) {
        var rect = preview.getBoundingClientRect();
        var mx = (e.clientX - rect.left) / rect.width  * PATH_PW;
        var my = (e.clientY - rect.top)  / rect.height * PATH_PH;
        _ppSpacing = _ppNearestFrac(mx, my) * 100;
        _ppUpdateVisual();
    }

    preview.addEventListener('mousedown', function(e) {
        e.preventDefault();
        onCurveDrag(e);
        function onMove(e2) { onCurveDrag(e2); }
        function onUp() {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });

    inp.addEventListener('input', function() {
        var v = parseFloat(inp.value);
        if (!isNaN(v)) { _ppSpacing = Math.max(0, v); _ppUpdateVisual(); }
    });
    inp.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') _ppCommit();
    });
    inp.addEventListener('mousemove', function(e) { e.stopPropagation(); });

    confirmBtn.addEventListener('click', _ppCommit);

    return el;
}

function _ppUpdateVisual() {
    if (_ppSpacingInput && document.activeElement !== _ppSpacingInput) {
        _ppSpacingInput.value = Math.round(_ppSpacing * 10) / 10;
    }

    var frac = ((_ppSpacing % 100) + 100) % 100 / 100;
    var hp = _ppPointAtFrac(frac);
    if (_ppHandle) { _ppHandle.setAttribute('cx', hp.x); _ppHandle.setAttribute('cy', hp.y); }

    // Squares illustrate the back-to-back wrap pattern at the current spacing %
    if (_ppSquaresG) {
        _ppSquaresG.innerHTML = '';
        var NS = 'http://www.w3.org/2000/svg';
        var n = 5, sz = 6;
        for (var i = 0; i < n; i++) {
            var f = (_ppSpacing <= 0) ? (i / n) : (((i * _ppSpacing) % 100) / 100);
            var p = _ppPointAtFrac(f);
            var sq = document.createElementNS(NS, 'rect');
            sq.setAttribute('x', p.x - sz / 2);
            sq.setAttribute('y', p.y - sz / 2);
            sq.setAttribute('width', sz);
            sq.setAttribute('height', sz);
            sq.setAttribute('rx', 1.3);
            sq.setAttribute('fill', i === 0 ? '#2470e0' : 'rgba(36,112,224,0.45)');
            _ppSquaresG.appendChild(sq);
        }
    }
}

function _ppCommit() {
    var s = document.getElementById('pathSpacingInput');
    var r = document.getElementById('pathRotateCheck');
    if (s) s.value = _ppSpacing;
    if (r) r.checked = _ppRotate;
    _closePathPicker();
}

function _openPathPicker(x, y) {
    if (!_pathPicker) _pathPicker = _buildPathPicker();

    var s = document.getElementById('pathSpacingInput');
    var r = document.getElementById('pathRotateCheck');
    _ppSpacing = s ? (parseFloat(s.value) || 0) : 0;
    _ppRotate  = r ? r.checked : false;
    if (_ppRotateCb) _ppRotateCb.checked = _ppRotate;

    _ppUpdateVisual();

    var vw = window.innerWidth, vh = window.innerHeight;
    var popW = 192, popH = 180;
    _pathPicker.style.left = Math.min(x + 4, vw - popW - 4) + 'px';
    _pathPicker.style.top  = Math.min(y + 4, vh - popH - 4) + 'px';
    _pathPicker.classList.add('visible');
    _syncAllPickerStars();

    setTimeout(function() {
        document.addEventListener('mousedown', _pathPickerOutside);
        document.addEventListener('keydown',   _pathPickerKey);
    }, 0);
}

function _closePathPicker() {
    if (_pathPicker) _pathPicker.classList.remove('visible');
    document.removeEventListener('mousedown', _pathPickerOutside);
    document.removeEventListener('keydown',   _pathPickerKey);
}

function _pathPickerOutside(e) {
    if (_pathPicker && !_pathPicker.contains(e.target)) _closePathPicker();
}

function _pathPickerKey(e) {
    if (e.key === 'Escape') _closePathPicker();
}

// ── Properties Picker ────────────────────────────────────────────────────────
// Flat list of every Z / Path / Radial / Grid setting as plain text/checkbox
// inputs (no draggable previews). Edits write straight through to the same
// hidden fields the individual right-click menus read from, so everything is
// saved continuously — closing the popup (Escape or clicking outside) never
// discards anything, unlike the confirm-gated drag pickers above.

var _distPropsPicker  = null;
var _alignPropsPicker = null;
var _propsTextInputs  = [];
var _propsCheckboxes  = [];
var _propsSelects     = [];

function _propsTextInput(mainId, placeholder, width) {
    var inp = document.createElement('input');
    inp.type = 'text';
    if (placeholder) inp.placeholder = placeholder;
    if (width) inp.style.width = width + 'px';
    inp.addEventListener('input', function() {
        var raw   = inp.value;
        var clean = raw.replace(/[^0-9.\-]/g, '');
        clean = clean.replace(/(?!^)-/g, '');
        var parts = clean.split('.');
        if (parts.length > 2) clean = parts[0] + '.' + parts.slice(1).join('');
        if (clean !== raw) inp.value = clean;
        var el = document.getElementById(mainId);
        if (el) el.value = inp.value;
        if (mainId === 'gridHPadInput' || mainId === 'gridVPadInput') _syncAlignEdgesDim();
    });
    inp.addEventListener('mousemove', function(e) { e.stopPropagation(); });
    inp._propsMainId = mainId;
    _propsTextInputs.push(inp);
    return inp;
}

function _propsCheckbox(mainId, inverted) {
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.addEventListener('change', function() {
        var el = document.getElementById(mainId);
        if (!el) return;
        var on = inverted ? !cb.checked : cb.checked;
        if (el.type === 'checkbox') el.checked = on; else el.value = on ? '1' : '0';
        if (mainId === 'alignEdgesCheck') _syncAlignEdgesDim();
    });
    cb._propsMainId   = mainId;
    cb._propsInverted = inverted;
    _propsCheckboxes.push(cb);
    return cb;
}

function _propsSelect(mainId, options) {
    var sel = document.createElement('select');
    options.forEach(function(opt) {
        var o = document.createElement('option');
        o.value = opt.value;
        o.textContent = opt.label;
        sel.appendChild(o);
    });
    sel.addEventListener('change', function() {
        var el = document.getElementById(mainId);
        if (el) el.value = sel.value;
    });
    sel.addEventListener('mousemove', function(e) { e.stopPropagation(); });
    sel._propsMainId = mainId;
    _propsSelects.push(sel);
    return sel;
}

function _propsCloseBtn(closeFn) {
    var btn = document.createElement('button');
    btn.className = 'grid-picker-confirm';
    btn.title = 'Close';
    btn.innerHTML = '<svg viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1.5,5.5 4.5,8.5 9.5,2.5"/></svg>';
    btn.addEventListener('click', closeFn);
    return btn;
}

function _propsHeaderRow(title, closeFn) {
    var row = document.createElement('div');
    row.className = 'props-header-row';
    var h = document.createElement('span');
    h.className = 'props-header-title';
    h.textContent = title;
    row.appendChild(h);
    row.appendChild(_propsCloseBtn(closeFn));
    return row;
}

function _propsCheckLabel(mainId, text, inverted) {
    var label = document.createElement('label');
    label.className = 'check-label';
    label.appendChild(_propsCheckbox(mainId, inverted));
    label.appendChild(document.createTextNode(' ' + text));
    return label;
}

function _propsLbl(text) {
    var s = document.createElement('span');
    s.className = 'gp-lbl';
    s.textContent = text;
    return s;
}

function _propsVsep() {
    var s = document.createElement('span');
    s.className = 'vsep';
    return s;
}

function _propsLine() {
    var row = document.createElement('div');
    row.className = 'props-line';
    return row;
}

function _propsGapIcon(horizontal) {
    var NS  = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 20 20');
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('class', 'grid-picker-gap-icon');
    svg.innerHTML = horizontal
        ? '<path d="M3,4 L5,4 L5,16 L3,16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
          '<path d="M17,4 L15,4 L15,16 L17,16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
          '<rect x="9" y="9" width="2" height="2" rx="0.4"/>'
        : '<path d="M4,3 L4,5 L16,5 L16,3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
          '<path d="M4,17 L4,15 L16,15 L16,17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
          '<rect x="9" y="9" width="2" height="2" rx="0.4"/>';
    return svg;
}

function _propsGroupLbl(text) {
    var l = document.createElement('div');
    l.className = 'props-group-lbl';
    l.textContent = text;
    return l;
}

function _buildDistPropsPicker() {
    var el = document.createElement('div');
    el.className = 'props-picker';

    el.appendChild(_propsHeaderRow('All Distribute Settings', _closeDistPropsPicker));

    el.appendChild(_propsGroupLbl('Radial'));
    var rLine = _propsLine();
    rLine.appendChild(_propsLbl('Radius'));
    rLine.appendChild(_propsTextInput('radialInput', null, 50));
    rLine.appendChild(_propsLbl('px'));
    rLine.appendChild(_propsVsep());
    rLine.appendChild(_propsCheckLabel('rotateCheck', 'Rotate'));
    el.appendChild(rLine);

    el.appendChild(_propsGroupLbl('Path'));
    var pLine = _propsLine();
    pLine.appendChild(_propsLbl('Spacing'));
    pLine.appendChild(_propsTextInput('pathSpacingInput', null, 44));
    pLine.appendChild(_propsLbl('%'));
    pLine.appendChild(_propsVsep());
    pLine.appendChild(_propsCheckLabel('pathRotateCheck', 'Rotate'));
    el.appendChild(pLine);

    el.appendChild(_propsGroupLbl('Grid'));
    var gLine1 = _propsLine();
    gLine1.appendChild(_propsTextInput('gridColsInput', null, 32));
    gLine1.appendChild(_propsLbl('×'));
    gLine1.appendChild(_propsTextInput('gridRowsInput', null, 32));
    gLine1.appendChild(_propsVsep());
    gLine1.appendChild(_propsCheckLabel('alignEdgesCheck', 'Align Edges'));
    el.appendChild(gLine1);

    var gLine2 = _propsLine();
    gLine2.appendChild(_propsGapIcon(true));
    gLine2.appendChild(_propsTextInput('gridHPadInput', 'Auto', 42));
    gLine2.appendChild(_propsGapIcon(false));
    gLine2.appendChild(_propsTextInput('gridVPadInput', 'Auto', 42));
    el.appendChild(gLine2);

    el.appendChild(_propsGroupLbl('Z Depth'));
    var zLine1 = _propsLine();
    zLine1.appendChild(_propsLbl('Start'));
    zLine1.appendChild(_propsTextInput('zStartInput', null, 44));
    zLine1.appendChild(_propsLbl('End'));
    zLine1.appendChild(_propsTextInput('zEndInput', null, 44));
    el.appendChild(zLine1);

    var zLine2 = _propsLine();
    zLine2.appendChild(_propsCheckLabel('zEvenInput', 'Step', true));
    zLine2.appendChild(_propsTextInput('zStepInput', null, 44));
    el.appendChild(zLine2);

    document.body.appendChild(el);
    return el;
}

function _propsRefreshValues() {
    for (var i = 0; i < _propsTextInputs.length; i++) {
        var inp = _propsTextInputs[i];
        var el  = document.getElementById(inp._propsMainId);
        if (el && document.activeElement !== inp) inp.value = el.value;
    }
    for (var j = 0; j < _propsCheckboxes.length; j++) {
        var cb  = _propsCheckboxes[j];
        var el2 = document.getElementById(cb._propsMainId);
        if (!el2) continue;
        var on = el2.type === 'checkbox' ? el2.checked : el2.value !== '0';
        cb.checked = cb._propsInverted ? !on : on;
    }
    for (var k = 0; k < _propsSelects.length; k++) {
        var sel = _propsSelects[k];
        var el3 = document.getElementById(sel._propsMainId);
        if (el3) sel.value = el3.value;
    }
}

function toggleDistProps(e) {
    if (_distPropsPicker && _distPropsPicker.classList.contains('visible')) {
        _closeDistPropsPicker();
    } else {
        _openDistPropsPicker(e.clientX, e.clientY);
    }
}

function _openDistPropsPicker(x, y) {
    if (!_distPropsPicker) _distPropsPicker = _buildDistPropsPicker();
    _propsRefreshValues();

    var vw = window.innerWidth, vh = window.innerHeight;
    var popW = 230, popH = 310;
    _distPropsPicker.style.left = Math.max(4, Math.min(x + 4, vw - popW - 4)) + 'px';
    _distPropsPicker.style.top  = Math.max(4, Math.min(y + 4, vh - popH - 4)) + 'px';
    _distPropsPicker.classList.add('visible');

    setTimeout(function() {
        document.addEventListener('mousedown', _distPropsPickerOutside);
        document.addEventListener('keydown',   _distPropsPickerKey);
    }, 0);
}

function _closeDistPropsPicker() {
    if (_distPropsPicker) _distPropsPicker.classList.remove('visible');
    document.removeEventListener('mousedown', _distPropsPickerOutside);
    document.removeEventListener('keydown',   _distPropsPickerKey);
}

function _distPropsPickerOutside(e) {
    var btn = document.getElementById('distPropsBtn');
    if (_distPropsPicker && !_distPropsPicker.contains(e.target) && !(btn && btn.contains(e.target))) {
        _closeDistPropsPicker();
    }
}

function _distPropsPickerKey(e) {
    if (e.key === 'Escape') _closeDistPropsPicker();
}

function _buildAlignPropsPicker() {
    var el = document.createElement('div');
    el.className = 'props-picker';

    el.appendChild(_propsHeaderRow('All Align Settings', _closeAlignPropsPicker));

    el.appendChild(_propsGroupLbl('Margin'));
    var mLine = _propsLine();
    mLine.appendChild(_propsTextInput('marginInput', null, 44));
    mLine.appendChild(_propsSelect('pixelDropdown', [{ value: '0', label: 'px' }, { value: '1', label: '%' }]));
    mLine.appendChild(_propsVsep());
    mLine.appendChild(_propsCheckLabel('offsetCheck', 'Offset Keys'));
    el.appendChild(mLine);

    document.body.appendChild(el);
    return el;
}

function toggleAlignProps(e) {
    if (_alignPropsPicker && _alignPropsPicker.classList.contains('visible')) {
        _closeAlignPropsPicker();
    } else {
        _openAlignPropsPicker(e.clientX, e.clientY);
    }
}

function _openAlignPropsPicker(x, y) {
    if (!_alignPropsPicker) _alignPropsPicker = _buildAlignPropsPicker();
    _propsRefreshValues();

    var vw = window.innerWidth, vh = window.innerHeight;
    var popW = 200, popH = 110;
    _alignPropsPicker.style.left = Math.max(4, Math.min(x + 4, vw - popW - 4)) + 'px';
    _alignPropsPicker.style.top  = Math.max(4, Math.min(y + 4, vh - popH - 4)) + 'px';
    _alignPropsPicker.classList.add('visible');

    setTimeout(function() {
        document.addEventListener('mousedown', _alignPropsPickerOutside);
        document.addEventListener('keydown',   _alignPropsPickerKey);
    }, 0);
}

function _closeAlignPropsPicker() {
    if (_alignPropsPicker) _alignPropsPicker.classList.remove('visible');
    document.removeEventListener('mousedown', _alignPropsPickerOutside);
    document.removeEventListener('keydown',   _alignPropsPickerKey);
}

function _alignPropsPickerOutside(e) {
    var btn = document.getElementById('alignPropsBtn');
    if (_alignPropsPicker && !_alignPropsPicker.contains(e.target) && !(btn && btn.contains(e.target))) {
        _closeAlignPropsPicker();
    }
}

function _alignPropsPickerKey(e) {
    if (e.key === 'Escape') _closeAlignPropsPicker();
}

// ── LAYER SORT ────────────────────────────────────────────────────────────────

// descend is passed directly from whichever of the two direction buttons
// was clicked (0 = ascending, 1 = descending) rather than read from a
// separate toggle's stored state. The Group-into-a-null option was removed
// as an unnecessary control — lineup_sortLayers still accepts it, so this
// just always passes 0 (its old default/unchecked state).
function doSort(descend) {
    var propIdx = selVal('sortProp');
    var axisIdx = selVal('sortAxis');
    run('lineup_sortLayers(' + propIdx + ',' + axisIdx + ',' + descend + ',0)');
}

function syncSortAxis() {
    var axisEl = document.getElementById('sortAxis');
    if (axisEl) axisEl.disabled = (selVal('sortProp') !== 0);
}

// ── SHAPE TOOLS ───────────────────────────────────────────────────────────────

function doSelectAllPaths() {
    run('lineup_selectAllPaths()');
}

function doSelectAllFills() {
    run('lineup_selectAllFillColors()');
}

function doSelectAllStrokes() {
    run('lineup_selectAllStrokeColors()');
}

// AE's own native tool-group convention (e.g. the Rectangle/Ellipse/
// Polygon flyout): the button itself always shows and runs whichever mode
// was picked last, and right-click opens a small icon-only flyout of the
// alternatives — picking one there both switches AND immediately runs it,
// same as clicking a tool in that flyout selects and activates it in one
// action. Mode is shared/global and persisted (matching there being one
// underlying "current tool", not a per-button-instance choice), and every
// rendered instance of this button (the widget's own, the Tools-tab tile,
// any future Quick Actions clone) is kept in sync via the shared
// .shape-sel-btn class — all found and updated together on every change.
// Every mode's icon is framed in a dashed rounded square — a marquee-
// selection cue (the classic "marching ants" look) so the icon itself
// reads as "this selects something" regardless of which of the three
// it currently shows, not just a shape glyph on its own.
var SHAPE_SEL_FRAME = '<rect x="1.5" y="1.5" width="17" height="17" rx="4" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2.2,2" opacity="0.55"/>';
var SHAPE_SEL_MODES = [
    {
        id: 'path', title: 'Select All Paths', shortLabel: 'Sel. Path', flyoutLabel: 'Path', fn: doSelectAllPaths,
        svg: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-linecap="round">' +
            SHAPE_SEL_FRAME +
            '<path d="M3,15 C3,15 6,5 10,10 C14,15 17,5 17,5" stroke-width="1.5"/>' +
            '<rect x="1.8" y="13.2" width="2.4" height="2.4" rx="0.5" fill="currentColor" stroke="none"/>' +
            '<rect x="8.8" y="8.8" width="2.4" height="2.4" rx="0.5" fill="currentColor" stroke="none"/>' +
            '<rect x="15.8" y="3.8" width="2.4" height="2.4" rx="0.5" fill="currentColor" stroke="none"/></svg>'
    },
    {
        id: 'fill', title: 'Select All Fills', shortLabel: 'Sel. Fill', flyoutLabel: 'Fill', fn: doSelectAllFills,
        svg: '<svg viewBox="0 0 20 20" fill="currentColor">' +
            SHAPE_SEL_FRAME +
            '<rect x="4" y="4" width="12" height="12" rx="2.5"/></svg>'
    },
    {
        id: 'stroke', title: 'Select All Strokes', shortLabel: 'Sel. Stroke', flyoutLabel: 'Stroke', fn: doSelectAllStrokes,
        svg: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor">' +
            SHAPE_SEL_FRAME +
            '<rect x="4" y="4" width="12" height="12" rx="2.5" stroke-width="2.2"/></svg>'
    }
];
var SHAPE_SEL_MODE_KEY = 'lineup-shape-sel-mode';
var _shapeSelMode = 'path';

function _shapeSelFindMode(id) {
    for (var i = 0; i < SHAPE_SEL_MODES.length; i++) {
        if (SHAPE_SEL_MODES[i].id === id) return SHAPE_SEL_MODES[i];
    }
    return SHAPE_SEL_MODES[0];
}

function _shapeSelInit() {
    var saved;
    try { saved = localStorage.getItem(SHAPE_SEL_MODE_KEY); } catch (e) {}
    _shapeSelMode = _shapeSelFindMode(saved).id;
    _shapeSelRefreshButtons();
}

function _shapeSelSetMode(id) {
    _shapeSelMode = _shapeSelFindMode(id).id;
    try { localStorage.setItem(SHAPE_SEL_MODE_KEY, _shapeSelMode); } catch (e) {}
    _shapeSelRefreshButtons();
}

// Only swaps the <svg> (and a text label, if this particular instance has
// one — the Tools-tab tile does, the widget's icon-only button doesn't),
// not the button's own innerHTML wholesale, so this can't clobber
// anything else a given instance happens to contain.
function _shapeSelRefreshButtons() {
    var mode = _shapeSelFindMode(_shapeSelMode);
    document.querySelectorAll('.shape-sel-btn').forEach(function(btn) {
        var svg = btn.querySelector('svg');
        if (svg) svg.outerHTML = mode.svg;
        var label = btn.querySelector('.shape-sel-label');
        if (label) label.textContent = mode.shortLabel;
        btn.title = mode.title;
    });
}

function _shapeSelRunActive() {
    _shapeSelFindMode(_shapeSelMode).fn();
}

// Right-click opens the flyout — each item is an icon plus a text label
// (e.g. "Fill"), matching AE's own tool-group flyout look, with the
// currently-active mode highlighted. The label drops out (icon-only,
// centered — see .shape-sel-ctx.compact) whenever the labeled layout
// wouldn't actually fit the available width; see _openShapeSelCtx.
var _shapeSelCtx = null;

function _buildShapeSelCtx() {
    var el = document.createElement('div');
    el.className = 'fav-ctx shape-sel-ctx';
    var row = document.createElement('div');
    row.className = 'shape-sel-ctx-row';
    SHAPE_SEL_MODES.forEach(function(mode) {
        var item = document.createElement('button');
        item.type = 'button';
        item.className = 'shape-sel-ctx-icon-btn';
        item.title = mode.title;
        item.innerHTML = mode.svg + '<span class="shape-sel-ctx-lbl">' + mode.flyoutLabel + '</span>';
        item.setAttribute('data-mode', mode.id);
        item.addEventListener('click', function() {
            _shapeSelSetMode(mode.id);
            mode.fn();
            _closeShapeSelCtx();
        });
        row.appendChild(item);
    });
    el.appendChild(row);
    document.body.appendChild(el);
    return el;
}

// Anchored to the right-click position itself via the event's clientX/Y,
// not the button's own getBoundingClientRect() — clientX/Y come straight
// from the OS pointer and are never distorted by CSS zoom the way an
// element's gBCR can be in this CEF build. Dimensions are measured BEFORE
// adding .visible: .fav-ctx's base state is opacity:0, not display:none,
// so it's already laid out and measurable without a visible flash at the
// wrong spot first — same trick used here to test-fit the labeled
// layout: try it, measure, and only fall back to icon-only/.compact if it
// wouldn't actually fit, all before anything is shown.
//
// Still positioned relative to the button's own .tab-panel (#panel-content
// or #tab-tools), not the true viewport, and still re-parented into it —
// a favorited widget's buttons live inside #panel-content, which the
// panel-scale slider zooms via CSS zoom (see applyScale), and this popup
// needs to sit inside that same zoomed subtree to scale along with it.
// Positioning FROM the click instead of the button is what actually fixed
// the flyout landing away from its button once Anchor/Favorites-bar
// buttons added a second, independent zoom layer (#homeTopGroup's own, on
// top of Panel Scale) that the old "diff two gBCR calls" approach only
// ever canceled out one layer of.
function _openShapeSelCtx(btn, e) {
    if (!_shapeSelCtx) _shapeSelCtx = _buildShapeSelCtx();
    var container = btn.closest('.tab-panel') || document.body;
    container.appendChild(_shapeSelCtx);
    var items = _shapeSelCtx.querySelectorAll('.shape-sel-ctx-icon-btn');
    for (var i = 0; i < items.length; i++) {
        items[i].classList.toggle('active', items[i].getAttribute('data-mode') === _shapeSelMode);
    }
    // A CEP panel's own width IS the viewport width (no outer window
    // chrome to account for), so the container fills it edge to edge —
    // "horizontally compressed" means the panel itself isn't wide enough
    // for icon+text, not anything to do with where the button happens to
    // sit.
    var cw = container.clientWidth, ch = container.clientHeight;
    _shapeSelCtx.classList.remove('compact');
    var wideFits = (_shapeSelCtx.offsetWidth + 8) <= cw;
    _shapeSelCtx.classList.toggle('compact', !wideFits);

    var containerRect = container.getBoundingClientRect();
    var rect = btn.getBoundingClientRect();
    var cx = (e ? e.clientX : rect.left) - containerRect.left;
    var cy = (e ? e.clientY : rect.top)  - containerRect.top;
    var ctxW = _shapeSelCtx.offsetWidth;
    var ctxH = _shapeSelCtx.offsetHeight;
    var left = Math.min(Math.max(4, cx - ctxW / 2), cw - ctxW - 4);
    var top = (cy + 4 + ctxH <= ch)
        ? cy + 4  // below, the default
        : Math.max(4, cy - ctxH - 4); // not enough room below — flip above instead
    _shapeSelCtx.style.left = left + 'px';
    _shapeSelCtx.style.top  = top + 'px';
    _shapeSelCtx.classList.add('visible');
    setTimeout(function() {
        document.addEventListener('mousedown', _shapeSelCtxOutside);
        document.addEventListener('keydown', _shapeSelCtxKey);
    }, 0);
}

function _closeShapeSelCtx() {
    if (_shapeSelCtx) _shapeSelCtx.classList.remove('visible');
    document.removeEventListener('mousedown', _shapeSelCtxOutside);
    document.removeEventListener('keydown', _shapeSelCtxKey);
}

function _shapeSelCtxOutside(e) {
    if (_shapeSelCtx && !_shapeSelCtx.contains(e.target)) _closeShapeSelCtx();
}

function _shapeSelCtxKey(e) {
    if (e.key === 'Escape') _closeShapeSelCtx();
}

// Split Text — same AE-native-toolbar convention as Select Paths/Fill/
// Stroke above (left-click always runs whichever granularity was picked
// last, right-click opens a flyout of the alternatives that switches AND
// runs immediately), except the button's own icon never changes — there's
// only one "Split Text" glyph, just its title reflecting the current mode.
// Reuses the exact same .shape-sel-ctx/.shape-sel-ctx-row/
// .shape-sel-ctx-icon-btn/.shape-sel-ctx-lbl flyout styling wholesale
// (generic icon+label popover, nothing shape-specific about the CSS
// despite the class name) rather than duplicating an identical stylesheet.
var SPLIT_TEXT_MODES = [
    {
        id: 'line', title: 'Split Text by Line', flyoutLabel: 'Line',
        svg: '<svg viewBox="0 0 20 20" fill="currentColor">' +
            '<rect x="2" y="3" width="16" height="2.4" rx="0.6"/>' +
            '<rect x="2" y="8.8" width="11" height="2.4" rx="0.6" opacity="0.7"/>' +
            '<rect x="2" y="14.6" width="14" height="2.4" rx="0.6" opacity="0.45"/></svg>'
    },
    {
        id: 'word', title: 'Split Text by Word', flyoutLabel: 'Word',
        svg: '<svg viewBox="0 0 20 20" fill="currentColor">' +
            '<rect x="2" y="8.8" width="6.5" height="2.4" rx="0.6"/>' +
            '<rect x="11.5" y="8.8" width="6.5" height="2.4" rx="0.6"/></svg>'
    },
    {
        id: 'paragraph', title: 'Split Text by Paragraph', flyoutLabel: 'Paragraph',
        svg: '<svg viewBox="0 0 20 20" fill="currentColor">' +
            '<rect x="2" y="2.2" width="16" height="2.2" rx="0.55"/>' +
            '<rect x="2" y="5.8" width="11" height="2.2" rx="0.55" opacity="0.7"/>' +
            '<rect x="2" y="12" width="14" height="2.2" rx="0.55"/>' +
            '<rect x="2" y="15.6" width="9" height="2.2" rx="0.55" opacity="0.7"/></svg>'
    },
    {
        id: 'character', title: 'Split Text by Character', flyoutLabel: 'Character',
        svg: '<svg viewBox="0 0 20 20" fill="currentColor">' +
            '<rect x="1.5" y="8.5" width="3" height="3" rx="0.6"/>' +
            '<rect x="6" y="8.5" width="3" height="3" rx="0.6" opacity="0.85"/>' +
            '<rect x="10.5" y="8.5" width="3" height="3" rx="0.6" opacity="0.7"/>' +
            '<rect x="15" y="8.5" width="3" height="3" rx="0.6" opacity="0.55"/></svg>'
    }
];
var SPLIT_TEXT_MODE_KEY = 'lineup-split-text-mode';
var _splitTextMode = 'word';

function _splitTextFindMode(id) {
    for (var i = 0; i < SPLIT_TEXT_MODES.length; i++) {
        if (SPLIT_TEXT_MODES[i].id === id) return SPLIT_TEXT_MODES[i];
    }
    for (var j = 0; j < SPLIT_TEXT_MODES.length; j++) {
        if (SPLIT_TEXT_MODES[j].id === 'word') return SPLIT_TEXT_MODES[j];
    }
    return SPLIT_TEXT_MODES[0];
}

function _splitTextInit() {
    var saved;
    try { saved = localStorage.getItem(SPLIT_TEXT_MODE_KEY); } catch (e) {}
    _splitTextMode = _splitTextFindMode(saved).id;
    _splitTextRefreshButtons();
}

function _splitTextSetMode(id) {
    _splitTextMode = _splitTextFindMode(id).id;
    try { localStorage.setItem(SPLIT_TEXT_MODE_KEY, _splitTextMode); } catch (e) {}
    _splitTextRefreshButtons();
}

function _splitTextRefreshButtons() {
    var mode = _splitTextFindMode(_splitTextMode);
    document.querySelectorAll('.split-text-btn').forEach(function(btn) {
        btn.title = mode.title;
    });
}

function doSplitText(e) {
    var keepOriginals = (e && e.altKey) ? 1 : 0;
    run("lineup_splitText('" + _splitTextMode + "'," + keepOriginals + ")");
}

function _splitTextRunActive(e) {
    doSplitText(e);
}

var _splitTextCtx = null;

function _buildSplitTextCtx() {
    var el = document.createElement('div');
    el.className = 'fav-ctx shape-sel-ctx';
    var row = document.createElement('div');
    row.className = 'shape-sel-ctx-row';
    SPLIT_TEXT_MODES.forEach(function(mode) {
        var item = document.createElement('button');
        item.type = 'button';
        item.className = 'shape-sel-ctx-icon-btn';
        item.title = mode.title;
        item.innerHTML = mode.svg + '<span class="shape-sel-ctx-lbl">' + mode.flyoutLabel + '</span>';
        item.setAttribute('data-mode', mode.id);
        item.addEventListener('click', function(ev) {
            _splitTextSetMode(mode.id);
            doSplitText(ev);
            _closeSplitTextCtx();
        });
        row.appendChild(item);
    });
    el.appendChild(row);
    document.body.appendChild(el);
    return el;
}

// Positioned from the click itself, not the button's own
// getBoundingClientRect() — see the identical reasoning on
// _openShapeSelCtx above (shared bug, same fix: clientX/Y from the event
// aren't distorted by CSS zoom the way an element's gBCR can be here).
// Still re-parented into the button's own .tab-panel so the popup scales
// along with whatever zoom that subtree carries.
function _openSplitTextCtx(btn, e) {
    if (!_splitTextCtx) _splitTextCtx = _buildSplitTextCtx();
    var container = btn.closest('.tab-panel') || document.body;
    container.appendChild(_splitTextCtx);
    var items = _splitTextCtx.querySelectorAll('.shape-sel-ctx-icon-btn');
    for (var i = 0; i < items.length; i++) {
        items[i].classList.toggle('active', items[i].getAttribute('data-mode') === _splitTextMode);
    }
    var cw = container.clientWidth, ch = container.clientHeight;
    _splitTextCtx.classList.remove('compact');
    var wideFits = (_splitTextCtx.offsetWidth + 8) <= cw;
    _splitTextCtx.classList.toggle('compact', !wideFits);

    var containerRect = container.getBoundingClientRect();
    var rect = btn.getBoundingClientRect();
    var cx = (e ? e.clientX : rect.left) - containerRect.left;
    var cy = (e ? e.clientY : rect.top)  - containerRect.top;
    var ctxW = _splitTextCtx.offsetWidth;
    var ctxH = _splitTextCtx.offsetHeight;
    var left = Math.min(Math.max(4, cx - ctxW / 2), cw - ctxW - 4);
    var top = (cy + 4 + ctxH <= ch)
        ? cy + 4
        : Math.max(4, cy - ctxH - 4);
    _splitTextCtx.style.left = left + 'px';
    _splitTextCtx.style.top  = top + 'px';
    _splitTextCtx.classList.add('visible');
    setTimeout(function() {
        document.addEventListener('mousedown', _splitTextCtxOutside);
        document.addEventListener('keydown', _splitTextCtxKey);
    }, 0);
}

function _closeSplitTextCtx() {
    if (_splitTextCtx) _splitTextCtx.classList.remove('visible');
    document.removeEventListener('mousedown', _splitTextCtxOutside);
    document.removeEventListener('keydown', _splitTextCtxKey);
}

function _splitTextCtxOutside(e) {
    if (_splitTextCtx && !_splitTextCtx.contains(e.target)) _closeSplitTextCtx();
}

function _splitTextCtxKey(e) {
    if (e.key === 'Escape') _closeSplitTextCtx();
}

// event is only ever passed from the actual onclick (both the widget's
// own button and its Tools-tab/Quick-Actions tile share this same
// handler) — reading .altKey here, not in host.jsx, since modifier-key
// state is a DOM/JS-side concern; the held state just gets forwarded as
// a plain 0/1 into the eval string like any other option.
function doChangeStrokeType(e) {
    var capOnly = (e && e.altKey) ? 1 : 0;
    run('lineup_changeStrokeType(' + capOnly + ')');
}

function doMergeShapes(e) {
    var keepOriginals = (e && e.altKey) ? 1 : 0;
    run('lineup_mergeShapes(' + keepOriginals + ')');
}

function doExplodeShapes(e) {
    var keepOriginals = (e && e.altKey) ? 1 : 0;
    run('lineup_explodeShapes(' + keepOriginals + ')');
}

function doManageColors() {
    run('lineup_manageColors()', function(result) { showToast(result, 'info'); });
}

// ── SHAPE COLOR HUD ───────────────────────────────────────────────────────────
// Live Fill/Stroke summary at the top of Shape Tools, modeled on AE's own
// Tools-panel Fill/Stroke swatches — see lineup_getShapeColorHud in host.jsx
// for the actual scan (selected shape layers, or every shape layer in the
// comp if none are selected).

var _shapeColorHudLast    = null; // last polled+parsed payload — the edit popup reads from THIS, not a live poll, so its list can't shift under the cursor mid-edit (closing and reopening it refreshes)
var _shapeColorHudLastRaw = '';   // last raw JSON string, to skip re-rendering (and re-touching the DOM) when nothing actually changed

function _hexToRgb01(hex) {
    hex = hex.replace('#', '');
    return [
        parseInt(hex.substring(0, 2), 16) / 255,
        parseInt(hex.substring(2, 4), 16) / 255,
        parseInt(hex.substring(4, 6), 16) / 255
    ];
}
function _rgb01ToHex(rgb) {
    function ch(v) {
        var s = Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16);
        return s.length < 2 ? '0' + s : s;
    }
    return '#' + ch(rgb[0]) + ch(rgb[1]) + ch(rgb[2]);
}

// ── COLOR PICKER (in-panel) ──────────────────────────────────────────────────
// <input type="color"> never opens inside AE's CEP host, and ExtendScript's
// $.colorPicker() only opens the OS-level color panel rather than AE's own
// "Shape Fill/Stroke Color" dialog — that dialog is internal AE UI with no
// scriptable entry point at all. So this is a from-scratch HSB picker living
// in the panel itself (see #cpOverlay in index.html), styled after AE's own
// dialog but narrow to fit the panel's own ~220-280px width (see .cp-modal
// in style.css) rather than matching its wide two-column layout.

function _rgbToHsb(r, g, b) { // r,g,b: 0-255 -> { h: 0-360, s: 0-100, b: 0-100 }
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    var h = 0;
    if (d !== 0) {
        if (max === r) h = 60 * (((g - b) / d) % 6);
        else if (max === g) h = 60 * ((b - r) / d + 2);
        else h = 60 * ((r - g) / d + 4);
    }
    if (h < 0) h += 360;
    return { h: h, s: max === 0 ? 0 : (d / max) * 100, b: max * 100 };
}
function _hsbToRgb(h, s, b) { // h: 0-360, s/b: 0-100 -> [r,g,b] 0-255
    s /= 100; b /= 100;
    var c = b * s;
    var x = c * (1 - Math.abs((h / 60) % 2 - 1));
    var m = b - c;
    var r, g, bl;
    if (h < 60)       { r = c; g = x; bl = 0; }
    else if (h < 120) { r = x; g = c; bl = 0; }
    else if (h < 180) { r = 0; g = c; bl = x; }
    else if (h < 240) { r = 0; g = x; bl = c; }
    else if (h < 300) { r = x; g = 0; bl = c; }
    else              { r = c; g = 0; bl = x; }
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((bl + m) * 255)];
}

var _cpOnApply = null;      // callback(rgb01Array), called only on OK
var _cpH = 0, _cpS = 0, _cpBVal = 100; // current HSB — source of truth while the dialog is open
var _cpHScrub, _cpSScrub, _cpBrScrub, _cpRScrub, _cpGScrub, _cpBScrub;
var _cpSbDragging = false, _cpHueDragging = false;

function _cpInitScrubs() {
    _cpHScrub  = _bcsMakeScrub(document.getElementById('cpH'),  { min: 0, onChange: function(v) { _cpFromHsbField('h', v); } });
    _cpSScrub  = _bcsMakeScrub(document.getElementById('cpS'),  { min: 0, onChange: function(v) { _cpFromHsbField('s', v); } });
    _cpBrScrub = _bcsMakeScrub(document.getElementById('cpBr'), { min: 0, onChange: function(v) { _cpFromHsbField('b', v); } });
    _cpRScrub  = _bcsMakeScrub(document.getElementById('cpR'),  { min: 0, onChange: _cpFromRgbFields });
    _cpGScrub  = _bcsMakeScrub(document.getElementById('cpG'),  { min: 0, onChange: _cpFromRgbFields });
    _cpBScrub  = _bcsMakeScrub(document.getElementById('cpB'),  { min: 0, onChange: _cpFromRgbFields });
    document.getElementById('cpHex').addEventListener('input', _cpHexChanged);
}

function _cpFromHsbField(which, v) {
    if (which === 'h') { _cpH = ((Math.round(v) % 360) + 360) % 360; _cpHScrub.set(_cpH, true); }
    else if (which === 's') { _cpS = Math.min(100, Math.max(0, v)); _cpSScrub.set(_cpS, true); }
    else { _cpBVal = Math.min(100, Math.max(0, v)); _cpBrScrub.set(_cpBVal, true); }
    _cpSyncFromHsb(which === 'h');
}

// Shared onChange for all three RGB scrubs — re-reads all three (rather than
// tracking which one fired) since a from-hex or from-HSB update already set
// all three together, and there's no cheap way to tell "which single field
// did the user just edit" apart from that from in here.
function _cpFromRgbFields() {
    var r = Math.min(255, Math.max(0, _cpRScrub.get()));
    var g = Math.min(255, Math.max(0, _cpGScrub.get()));
    var b = Math.min(255, Math.max(0, _cpBScrub.get()));
    _cpRScrub.set(r, true); _cpGScrub.set(g, true); _cpBScrub.set(b, true);
    var hsb = _rgbToHsb(r, g, b);
    var hueChanged = Math.round(hsb.h) !== Math.round(_cpH);
    _cpH = hsb.h; _cpS = hsb.s; _cpBVal = hsb.b;
    _cpHScrub.set(Math.round(_cpH), true);
    _cpSScrub.set(Math.round(_cpS), true);
    _cpBrScrub.set(Math.round(_cpBVal), true);
    _cpUpdateHexAndSwatch([r, g, b]);
    _cpPositionHandles();
    if (hueChanged) _cpDrawSbCanvas();
}

function _cpHexChanged() {
    var v = document.getElementById('cpHex').value.replace(/[^0-9a-fA-F]/g, '');
    if (v.length !== 6) return; // wait for a full 6-digit value before acting on it
    var rgb01 = _hexToRgb01('#' + v);
    _cpRScrub.set(Math.round(rgb01[0] * 255), true);
    _cpGScrub.set(Math.round(rgb01[1] * 255), true);
    _cpBScrub.set(Math.round(rgb01[2] * 255), true);
    _cpFromRgbFields();
}

// Recomputes RGB/hex/handles from the current HSB state — hueChanged also
// redraws the Saturation/Brightness square, since its own gradient is tinted
// by hue and would otherwise still show the previous color.
function _cpSyncFromHsb(hueChanged) {
    var rgb = _hsbToRgb(_cpH, _cpS, _cpBVal);
    _cpRScrub.set(rgb[0], true);
    _cpGScrub.set(rgb[1], true);
    _cpBScrub.set(rgb[2], true);
    _cpUpdateHexAndSwatch(rgb);
    _cpPositionHandles();
    if (hueChanged) _cpDrawSbCanvas();
}

function _cpUpdateHexAndSwatch(rgb) {
    var hex = _rgb01ToHex([rgb[0] / 255, rgb[1] / 255, rgb[2] / 255]);
    document.getElementById('cpSwatch').style.backgroundColor = hex;
    var hexInput = document.getElementById('cpHex');
    if (document.activeElement !== hexInput) hexInput.value = hex.replace('#', '').toUpperCase();
}

function _cpPositionHandles() {
    var sbWrap = document.getElementById('cpSbWrap');
    var sbHandle = document.getElementById('cpSbHandle');
    sbHandle.style.left = (_cpS / 100 * sbWrap.clientWidth) + 'px';
    sbHandle.style.top  = ((1 - _cpBVal / 100) * sbWrap.clientHeight) + 'px';

    var hueWrap = document.getElementById('cpHueWrap');
    document.getElementById('cpHueHandle').style.top = (_cpH / 360 * hueWrap.clientHeight) + 'px';
}

// Solid hue fill, then a white→transparent gradient across X (saturation)
// and a transparent→black gradient down Y (brightness) layered on top — the
// standard three-layer trick for an HSB square, redrawn only when hue
// changes since S/B alone don't affect it.
function _cpDrawSbCanvas() {
    var canvas = document.getElementById('cpSbCanvas');
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    var w = canvas.width, h = canvas.height;
    var rgb = _hsbToRgb(_cpH, 100, 100);
    ctx.fillStyle = 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')';
    ctx.fillRect(0, 0, w, h);
    var satGrad = ctx.createLinearGradient(0, 0, w, 0);
    satGrad.addColorStop(0, 'rgba(255,255,255,1)');
    satGrad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = satGrad;
    ctx.fillRect(0, 0, w, h);
    var briGrad = ctx.createLinearGradient(0, 0, 0, h);
    briGrad.addColorStop(0, 'rgba(0,0,0,0)');
    briGrad.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = briGrad;
    ctx.fillRect(0, 0, w, h);
}

// Static — every hue 0-360, wrapping back to red at the bottom same as the
// top — drawn once, never needs redrawing since it doesn't depend on state.
function _cpDrawHueCanvas() {
    var canvas = document.getElementById('cpHueCanvas');
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    var w = canvas.width, h = canvas.height;
    var grad = ctx.createLinearGradient(0, 0, 0, h);
    [0, 60, 120, 180, 240, 300, 360].forEach(function(hue) {
        var rgb = _hsbToRgb(hue % 360, 100, 100);
        grad.addColorStop(hue / 360, 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')');
    });
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
}

function _cpSbUpdateFromEvent(e) {
    var rect = document.getElementById('cpSbWrap').getBoundingClientRect();
    var x = Math.min(Math.max(0, e.clientX - rect.left), rect.width);
    var y = Math.min(Math.max(0, e.clientY - rect.top), rect.height);
    _cpS = (x / rect.width) * 100;
    _cpBVal = (1 - y / rect.height) * 100;
    _cpSScrub.set(Math.round(_cpS), true);
    _cpBrScrub.set(Math.round(_cpBVal), true);
    _cpSyncFromHsb(false);
}
function _cpSbMouseDown(e) {
    _cpSbDragging = true;
    _cpSbUpdateFromEvent(e);
    document.addEventListener('mousemove', _cpSbMouseMove);
    document.addEventListener('mouseup', _cpSbMouseUp);
    e.preventDefault();
}
function _cpSbMouseMove(e) { if (_cpSbDragging) _cpSbUpdateFromEvent(e); }
function _cpSbMouseUp() {
    _cpSbDragging = false;
    document.removeEventListener('mousemove', _cpSbMouseMove);
    document.removeEventListener('mouseup', _cpSbMouseUp);
}

function _cpHueUpdateFromEvent(e) {
    var rect = document.getElementById('cpHueWrap').getBoundingClientRect();
    var y = Math.min(Math.max(0, e.clientY - rect.top), rect.height);
    _cpH = (y / rect.height) * 360;
    _cpHScrub.set(Math.round(_cpH), true);
    _cpSyncFromHsb(true);
}
function _cpHueMouseDown(e) {
    _cpHueDragging = true;
    _cpHueUpdateFromEvent(e);
    document.addEventListener('mousemove', _cpHueMouseMove);
    document.addEventListener('mouseup', _cpHueMouseUp);
    e.preventDefault();
}
function _cpHueMouseMove(e) { if (_cpHueDragging) _cpHueUpdateFromEvent(e); }
function _cpHueMouseUp() {
    _cpHueDragging = false;
    document.removeEventListener('mousemove', _cpHueMouseMove);
    document.removeEventListener('mouseup', _cpHueMouseUp);
}

// rgb01: [r,g,b] each 0-1 (AE's own color format). onApply(rgb01) fires only
// on OK — Cancel (or clicking outside/the × button) just closes with no
// callback, leaving the underlying color untouched.
function _openColorPicker(rgb01, title, onApply) {
    _cpOnApply = onApply;
    document.getElementById('cpTitle').textContent = title;
    var rgb = [Math.round(rgb01[0] * 255), Math.round(rgb01[1] * 255), Math.round(rgb01[2] * 255)];
    var hsb = _rgbToHsb(rgb[0], rgb[1], rgb[2]);
    _cpH = hsb.h; _cpS = hsb.s; _cpBVal = hsb.b;
    _cpHScrub.set(Math.round(_cpH), true);
    _cpSScrub.set(Math.round(_cpS), true);
    _cpBrScrub.set(Math.round(_cpBVal), true);
    _cpRScrub.set(rgb[0], true);
    _cpGScrub.set(rgb[1], true);
    _cpBScrub.set(rgb[2], true);
    _cpUpdateHexAndSwatch(rgb);
    _cpDrawSbCanvas();
    document.getElementById('cpOverlay').classList.remove('cp-hidden');
    _cpPositionHandles(); // after unhiding — needs the wrap elements' real (non-zero) layout size
}

function _closeColorPicker(apply) {
    document.getElementById('cpOverlay').classList.add('cp-hidden');
    if (apply && _cpOnApply) {
        _cpOnApply([_cpRScrub.get() / 255, _cpGScrub.get() / 255, _cpBScrub.get() / 255]);
    }
    _cpOnApply = null;
}

// Applies a { type: 'none'|'color'|'mix', value } summary to a Fill/Stroke
// swatch button. Fill paints its background (a solid dot); stroke paints
// its border instead (a ring), so the indicator itself reads as an outline.
function _applySwatchSummary(el, summary, mode) {
    el.classList.remove('vectools-swatch-none', 'vectools-swatch-mix');
    el.style.backgroundColor = '';
    el.style.borderColor = '';
    if (!summary || summary.type === 'none') { el.classList.add('vectools-swatch-none'); return; }
    if (summary.type === 'mix') { el.classList.add('vectools-swatch-mix'); return; }
    var hex = _rgb01ToHex(summary.value);
    if (mode === 'stroke') el.style.borderColor = hex;
    else el.style.backgroundColor = hex;
}

// Direct edits on the HUD's own swatches always override every fill/stroke
// in scope at once — per-instance editing lives in the full popup, opened
// via the Fill/Stroke label instead (see _openFillPopup/_openStrokePopup).
function _pickFillColor() {
    var summary = _shapeColorHudLast && _shapeColorHudLast.fillSummary;
    var current = (summary && summary.type === 'color') ? summary.value : [0.5, 0.5, 0.5];
    _openColorPicker(current, 'Shape Fill Color', function(rgb) {
        run('lineup_setShapeFillColorAll(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')', function() { _pollShapeColorHud(); });
    });
}
function _pickStrokeColor() {
    var summary = _shapeColorHudLast && _shapeColorHudLast.strokeColorSummary;
    var current = (summary && summary.type === 'color') ? summary.value : [0.5, 0.5, 0.5];
    _openColorPicker(current, 'Shape Stroke Color', function(rgb) {
        run('lineup_setShapeStrokeColorAll(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')', function() { _pollShapeColorHud(); });
    });
}

function _renderShapeColorHud(data) {
    var fillSwatch = document.getElementById('vectoolsFillSwatch');
    if (fillSwatch) _applySwatchSummary(fillSwatch, data.fillSummary, 'fill');

    var strokeSwatch = document.getElementById('vectoolsStrokeSwatch');
    if (strokeSwatch) _applySwatchSummary(strokeSwatch, data.strokeColorSummary, 'stroke');

    if (_headerWidthScrub) {
        var w = data.strokeWidthSummary;
        // Always shows *something* — "0 px" rather than going blank when
        // there's no stroke in scope — so the control stays visible/legible
        // (and easy to spot while iterating on the HTML/CSS outside AE,
        // where it never gets real polled data at all).
        var text = (!w || w.type === 'none') ? '0 px' : (w.type === 'mix' ? 'Mix' : (Math.round(w.value * 10) / 10) + ' px');
        _headerWidthScrub.render(text); // no-ops itself while the user is mid-drag/edit
    }
}

// ── Blue scrubbable px number: drag left/right to change, click (no drag)
// to type an exact value — shared by the Shape Tools header's own
// stroke-width field and the Fill/Stroke edit modal's "All Strokes"/
// per-row width cells (see _makeWidthScrub's call sites).
// getValue(): () => current numeric value, read fresh each time a
// drag/edit starts. setValue(v): (v) => apply the new value.
function _makeWidthScrub(el, getValue, setValue) {
    var drag = null, editing = false, lastText = el.textContent;

    function render(text) {
        lastText = text;
        if (!editing && !drag) el.textContent = text;
    }
    function isBusy() { return editing || !!drag; }

    function onMouseDown(e) {
        if (editing) return;
        e.preventDefault();
        drag = { startX: e.clientX, startVal: getValue(), moved: false, lastSent: null };
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }
    function onMouseMove(e) {
        if (!drag) return;
        var dx = e.clientX - drag.startX;
        if (!drag.moved && Math.abs(dx) < 3) return; // dead zone — distinguishes a click from a drag
        drag.moved = true;
        var newVal = Math.max(0, Math.round((drag.startVal + dx * 0.1) * 10) / 10);
        if (newVal === drag.lastSent) return;
        drag.lastSent = newVal;
        el.textContent = newVal + ' px';
        setValue(newVal);
    }
    function onMouseUp() {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        var d = drag;
        drag = null;
        if (d && !d.moved) openEdit(); // a plain click, no drag — edit instead of scrub
    }
    function openEdit() {
        var current = getValue();
        editing = true;
        el.textContent = '';
        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'vectools-fs-width-edit';
        input.value = (current || current === 0) ? current : '';
        el.appendChild(input);
        input.focus();
        input.select();
        var settled = false;
        function commit(apply) {
            if (settled) return;
            settled = true;
            editing = false;
            if (apply) {
                var v = parseFloat(input.value);
                if (!isNaN(v) && v >= 0) { setValue(v); return; }
            }
            el.textContent = lastText; // invalid input, or Escape — just restore the display
        }
        input.addEventListener('blur', function() { commit(true); });
        input.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') input.blur();
            else if (e.key === 'Escape') commit(false);
        });
    }

    el.addEventListener('mousedown', onMouseDown);
    return { render: render, isBusy: isBusy };
}

// Same "always overrides every stroke in scope" behavior as the color
// swatches — per-instance width editing lives in the full popup instead.
var _headerWidthScrub = null;
function _initHeaderWidthScrub() {
    var el = document.getElementById('vectoolsStrokeWidth');
    if (!el) return;
    _headerWidthScrub = _makeWidthScrub(el,
        function() {
            var w = _shapeColorHudLast && _shapeColorHudLast.strokeWidthSummary;
            return (w && w.type === 'value') ? w.value : 0;
        },
        function(v) { run('lineup_setShapeStrokeWidthAll(' + v + ')', function() { _pollShapeColorHud(); }); });
}

// Throttled to 1s (vs Align's 300ms) — this scan can walk every shape layer
// in the whole comp when nothing's selected, meaningfully more work per tick
// than a keyframe-selection check. Same visibility gating as
// _pollKeyAlignMode — skip the evalScript round-trip entirely when Shape
// Tools isn't even visible right now.
// afterUpdate (optional): called once this tick's async round-trip actually
// lands — regardless of whether anything changed — so a caller that just
// made an edit (e.g. the enable-toggle popup) can re-render itself from
// _shapeColorHudLast only once it's genuinely fresh, not before.
function _pollShapeColorHud(afterUpdate) {
    var body = document.querySelector('.tool-body[data-block-id="vectortools"]');
    if (!body || !body.offsetParent) { if (afterUpdate) afterUpdate(); return; }
    cs.evalScript('lineup_getShapeColorHud()', function(result) {
        if (result && result !== 'undefined' && result.indexOf('ERROR:') !== 0 && result !== _shapeColorHudLastRaw) {
            _shapeColorHudLastRaw = result;
            var data = null;
            try { data = JSON.parse(result); } catch (e) {}
            if (data && !data.empty) {
                _shapeColorHudLast = data;
                _renderShapeColorHud(data);
            }
        }
        if (afterUpdate) afterUpdate();
    });
}

// ── Shape Color HUD: edit modal ──────────────────────────────────────────────
// A full popup (#shapeEditOverlay, same convention as Settings/Color Picker)
// rather than a small anchored one, unified across Fill and Stroke as two
// tabs — switching tabs re-renders #shapeEditBody in place. Each tab lists
// every instance found in the last polled snapshot individually (editable
// one at a time, including a per-instance Solid/No Fill(Stroke) checkbox)
// plus a single "All Fills"/"All Strokes" row and Solid/No Fill(Stroke)
// toggle that apply to every instance in scope at once.

var _shapeEditPopupMode = null; // 'fill' | 'stroke' — which tab is active

function _closeShapeEditPopup() {
    var overlay = document.getElementById('shapeEditOverlay');
    if (overlay) overlay.classList.add('shape-edit-hidden');
}

function _shapeEditSyncTabs() {
    Array.prototype.forEach.call(document.querySelectorAll('#shapeEditOverlay .vectools-edit-tab'), function(tab) {
        tab.classList.toggle('active', tab.getAttribute('data-tab') === _shapeEditPopupMode);
    });
}

// Switches tabs within the same open modal instead of closing/reopening.
function _switchShapeEditTab(mode) {
    _shapeEditPopupMode = mode;
    _shapeEditSyncTabs();
    _renderShapeEditPopup();
}

// Solid Fill/Stroke = a plain swatch square; No Fill/Stroke = the exact same
// diagonal-red-slash square already used for "no color anywhere in scope"
// (.vectools-swatch-none — reused as-is, not redrawn) — matches AE's own
// swatch iconography for on/off state.
function _shapeEditOnIcon() {
    return '<span class="vectools-edit-onoff-icon"></span>';
}
function _shapeEditOffIcon() {
    return '<span class="vectools-edit-onoff-icon vectools-swatch-none"></span>';
}

function _renderShapeEditPopup() {
    var data = _shapeColorHudLast;
    var body = document.getElementById('shapeEditBody');
    var isFill = _shapeEditPopupMode === 'fill';
    var items = isFill ? data.fills : data.strokes;
    var allLabel = isFill ? 'All Fills' : 'All Strokes';
    var enabledSummary = isFill ? data.fillEnabledSummary : data.strokeEnabledSummary;
    var onTitle = isFill ? 'Solid Fill' : 'Solid Stroke';
    var offTitle = isFill ? 'No Fill' : 'No Stroke';

    // Solid/No Fill(Stroke) — toggles every instance's own on/off state (the
    // same checkbox AE's Contents panel shows for a Fill/Stroke item), not a
    // color change — see lineup_setShapeFillEnabledAll/lineup_setShapeStrokeEnabledAll.
    var html = '<div class="vectools-edit-onoff-row">' +
        '<button type="button" class="vectools-edit-onoff-btn' + (enabledSummary.type === 'all' ? ' active' : '') + '" data-role="on" title="' + onTitle + '">' + _shapeEditOnIcon() + '</button>' +
        '<button type="button" class="vectools-edit-onoff-btn' + (enabledSummary.type === 'none' ? ' active' : '') + '" data-role="off" title="' + offTitle + '">' + _shapeEditOffIcon() + '</button>' +
        '</div>';

    // Color cells are plain buttons, not <input type="color"> — that picker
    // never opens inside AE's CEP host — clicking one opens the in-panel
    // color picker instead (see _openColorPicker). Width cells are the same
    // blue scrub/click-to-type control as the Shape Tools header's own
    // stroke-width field (see _makeWidthScrub).
    var allWidthText = data.strokeWidthSummary.type === 'value' ? (Math.round(data.strokeWidthSummary.value * 10) / 10) + ' px'
        : (data.strokeWidthSummary.type === 'mix' ? 'Mix' : '0 px');
    html += '<div class="vectools-edit-row vectools-edit-all-row">' +
        '<span class="vectools-edit-row-lbl">' + allLabel + '</span>' +
        '<button type="button" class="vectools-color-input" data-role="all"></button>' +
        (isFill ? '' : '<span class="vectools-fs-width" data-role="all-width">' + allWidthText + '</span>') +
        '</div>';
    if (!items.length) {
        html += '<div class="vectools-edit-empty">No ' + (isFill ? 'fills' : 'strokes') + ' found.</div>';
    } else {
        html += '<div class="vectools-edit-list">';
        items.forEach(function(item, i) {
            var colorVal = isFill ? item.value : item.colorValue;
            var safeLbl = String(item.layerName).replace(/"/g, '&quot;').replace(/</g, '&lt;');
            html += '<div class="vectools-edit-row' + (item.enabled ? '' : ' vectools-edit-row-off') + '">' +
                '<span class="vectools-edit-row-lbl" title="' + safeLbl + '">' + safeLbl + '</span>' +
                '<button type="button" class="vectools-color-input" data-index="' + i + '" style="background-color:' + _rgb01ToHex(colorVal) + '"></button>' +
                (isFill ? '' : '<span class="vectools-fs-width" data-index="' + i + '">' + (Math.round(item.widthValue * 10) / 10) + ' px</span>') +
                '</div>';
        });
        html += '</div>';
    }
    body.innerHTML = html;

    var enableAllFn = isFill ? 'lineup_setShapeFillEnabledAll' : 'lineup_setShapeStrokeEnabledAll';
    var onBtn = body.querySelector('button[data-role="on"]');
    var offBtn = body.querySelector('button[data-role="off"]');
    if (onBtn) onBtn.addEventListener('click', function() {
        run(enableAllFn + '(1)', function() { _pollShapeColorHud(function() { _renderShapeEditPopup(); }); });
    });
    if (offBtn) offBtn.addEventListener('click', function() {
        run(enableAllFn + '(0)', function() { _pollShapeColorHud(function() { _renderShapeEditPopup(); }); });
    });

    var allColorBtn = body.querySelector('button[data-role="all"]');
    if (allColorBtn) {
        var colorSummary = isFill ? data.fillSummary : data.strokeColorSummary;
        var allRgb = colorSummary.type === 'color' ? colorSummary.value : [0.5, 0.5, 0.5];
        if (colorSummary.type === 'color') allColorBtn.style.backgroundColor = _rgb01ToHex(colorSummary.value);
        allColorBtn.addEventListener('click', function() {
            _openColorPicker(allRgb, isFill ? 'All Fills' : 'All Strokes', function(rgb) {
                allRgb = rgb;
                allColorBtn.style.backgroundColor = _rgb01ToHex(rgb);
                var fn = isFill ? 'lineup_setShapeFillColorAll' : 'lineup_setShapeStrokeColorAll';
                run(fn + '(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')', function() { _pollShapeColorHud(); });
            });
        });
    }
    var allWidthEl = body.querySelector('.vectools-fs-width[data-role="all-width"]');
    if (allWidthEl) {
        _makeWidthScrub(allWidthEl,
            function() { return (data.strokeWidthSummary.type === 'value') ? data.strokeWidthSummary.value : 0; },
            function(v) { run('lineup_setShapeStrokeWidthAll(' + v + ')', function() { _pollShapeColorHud(); }); });
    }
    Array.prototype.forEach.call(body.querySelectorAll('button.vectools-color-input[data-index]'), function(btn) {
        var idx = parseInt(btn.getAttribute('data-index'), 10);
        var rowRgb = isFill ? items[idx].value : items[idx].colorValue;
        btn.addEventListener('click', function() {
            _openColorPicker(rowRgb, isFill ? 'Shape Fill Color' : 'Shape Stroke Color', function(rgb) {
                rowRgb = rgb;
                btn.style.backgroundColor = _rgb01ToHex(rgb);
                var fn = isFill ? 'lineup_setShapeFillColorAt' : 'lineup_setShapeStrokeColorAt';
                run(fn + '(' + idx + ',' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')', function() { _pollShapeColorHud(); });
            });
        });
    });
    Array.prototype.forEach.call(body.querySelectorAll('.vectools-fs-width[data-index]'), function(el) {
        var idx = parseInt(el.getAttribute('data-index'), 10);
        _makeWidthScrub(el,
            function() { return items[idx].widthValue; },
            function(v) { run('lineup_setShapeStrokeWidthAt(' + idx + ',' + v + ')', function() { _pollShapeColorHud(); }); });
    });
}

function _openShapeEditPopup(mode) {
    if (!_shapeColorHudLast) return; // nothing polled yet — nothing to show
    _shapeEditPopupMode = mode;
    _shapeEditSyncTabs();
    _renderShapeEditPopup();
    document.getElementById('shapeEditOverlay').classList.remove('shape-edit-hidden');
}
function _openFillPopup()   { _openShapeEditPopup('fill'); }
function _openStrokePopup() { _openShapeEditPopup('stroke'); }

// ── AUTO CROP ─────────────────────────────────────────────────────────────────

function doAutoCrop() {
    var pad    = numVal('autoCropPad');
    var expand = chkVal('autoCropExpand');
    run('lineup_autoCrop(' + pad + ',' + expand + ')');
}

function doCropMaxArea() {
    var pad    = numVal('autoCropPad');
    var expand = chkVal('autoCropExpand');
    run('lineup_cropMaxArea(' + pad + ',' + expand + ')');
}

function doMaskCrop() {
    var pad    = numVal('autoCropPad');
    var expand = chkVal('autoCropExpand');
    run('lineup_maskCrop(' + pad + ',' + expand + ')');
}

// ── Quick Actions (Compact-only, customizable) ───────────────────────────────
// A freely editable icon grid — add or remove any tool from the Tools tab
// catalog. Independent of Classic's Organize section (which keeps its own
// fixed controls, stashed at #sec-organize-original while Compact is
// active — see the 'organize' special case in _applyLayoutMode); the two
// share no markup, so customizing one never touches the other.
//
// Generalized to support more than one bar — QA_INSTANCES holds one entry
// per grid (storage key + DOM id + its own default pins), keyed by the id
// _blApplyLayout uses for the widget as a whole ('main' for the original
// bar up top, 'quickactions2' for the second one addable down in Bottom
// Layout). Every function below takes that key as its first argument.
//
// _editMode is the single flag driving BOTH this and Bottom Layout's
// drag-reorder (see _toggleEditMode) — one pencil, one board-editing
// state, both editable at once.

var QA_INSTANCES = {
    main: {
        storageKey: 'lineup-quick-actions',
        gridId: 'quickActionsGrid',
        defaultIds: ['duplicateCompDeep', 'consolidateProject', 'projectStructure', 'batchCompSettings', 'findReplace', 'compExport']
    },
    quickactions2: {
        storageKey: 'lineup-quick-actions-2',
        gridId: 'quickActionsGrid2',
        defaultIds: []
    }
};
var QA_MAX         = 6; // 'main' bar only — fixed size, always a 3-wide, 2-row cap (3x2), never 3x3
var _editMode        = false;

// 'main' (top group) keeps the same 3x2 cap (3 cols, 2 rows) — same shape
// quickactions2 uses at half width, never the taller 3x3/9 it briefly had —
// except narrow-stack, which forces the whole top group (including this
// bar) full width, where it switches to 6-wide/one-line same as
// quickactions2 does there.
// 'quickactions2' lives in Bottom Layout and can be docked full-width (6 cols,
// capped at one row) or half-width (3 cols, capped at two rows) — either way
// that caps out at 6 tiles, so switching between them never truncates pins.
function _qaGridShape(instKey) {
    if (instKey !== 'quickactions2') return _narrowStack ? { cols: 6, max: QA_MAX } : { cols: 3, max: QA_MAX };
    // The Favorite slot matches whatever shape this bar would have if
    // simply docked at that same width in Bottom Layout (see the CSS): 3x2
    // normally, since the slot itself is always half-width of the top
    // group, or 6-wide/one-line once narrow-stack forces the whole top
    // group (and so the slot) full width instead.
    if (document.querySelector('#sec-favorite .fav-page[data-fav-id="quickactions2"]')) {
        return _narrowStack ? { cols: 6, max: 6 } : { cols: 3, max: 6 };
    }
    var box = _blBoxEl(instKey);
    var span = box ? box.getAttribute('data-span') : '3';
    return span === '6' ? { cols: 6, max: 6 } : { cols: 3, max: 6 };
}
var _qaPopover       = null;
var _qaPopoverInput  = null;
var _qaPopoverGrid   = null;

// Every tool that can be pinned — the Tools tab's own tiles, cloned rather
// than duplicated by hand so Quick Actions can never drift out of sync with
// what's actually available there. Shared by every bar instance.
function _qaCatalog() {
    return Array.prototype.slice.call(document.querySelectorAll('#tab-tools .tools-grid-btn[data-tool-id]'));
}

function _qaGetPinned(instKey) {
    var inst = QA_INSTANCES[instKey];
    var ids;
    try { ids = JSON.parse(localStorage.getItem(inst.storageKey)); } catch(e) {}
    if (!Array.isArray(ids)) ids = inst.defaultIds.slice();
    var validIds = _qaCatalog().map(function(t) { return t.getAttribute('data-tool-id'); });
    return ids.filter(function(id) { return validIds.indexOf(id) !== -1; }).slice(0, _qaGridShape(instKey).max); // drop stale ids + enforce this bar's cap
}

function _qaSavePinned(instKey, ids) {
    _editRecordUndoPoint();
    try { localStorage.setItem(QA_INSTANCES[instKey].storageKey, JSON.stringify(ids)); } catch(e) {}
}

var _qaCloneSeq = 0;

// A couple of catalog icons (e.g. Scan All Compositions) use an internal
// SVG <mask id="..."> referenced via url(#id) — cloneNode duplicates that
// id verbatim, and once two elements share an id, url(#id) resolution
// becomes ambiguous (usually snapping to whichever copy comes first in the
// document), breaking the icon on whichever tile got cloned. Renaming both
// ends of the reference the same way on every clone avoids that.
function _qaCloneCatalogTile(source) {
    var clone = source.cloneNode(true);
    var mask = clone.querySelector('mask[id]');
    if (mask) {
        var oldId = mask.id;
        var newId = oldId + '-qa' + (_qaCloneSeq++);
        mask.id = newId;
        Array.prototype.forEach.call(clone.querySelectorAll('[mask]'), function(el) {
            if (el.getAttribute('mask') === 'url(#' + oldId + ')') el.setAttribute('mask', 'url(#' + newId + ')');
        });
    }
    return clone;
}

// One Quick Actions tile — same icon/title/onclick as its Tools-tab source,
// icon-only (label stripped), plus the edit-mode remove badge.
function _qaBuildTile(instKey, id) {
    var source = _qaCatalog().filter(function(t) { return t.getAttribute('data-tool-id') === id; })[0];
    if (!source) return null;
    var tile = _qaCloneCatalogTile(source);
    tile.classList.remove('tools-grid-btn');
    tile.classList.add('quick-actions-btn');
    tile.removeAttribute('data-group');
    var lbl = tile.querySelector('span');
    if (lbl) lbl.remove();

    var removeBtn = document.createElement('span');
    removeBtn.className = 'quick-actions-remove';
    removeBtn.title = 'Remove from Quick Actions';
    removeBtn.innerHTML = '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="7" cy="7" r="6.3" fill="#1c1c1c" stroke="#3a3a3a" stroke-width="1"/><line x1="4.8" y1="4.8" x2="9.2" y2="9.2"/><line x1="9.2" y1="4.8" x2="4.8" y2="9.2"/></svg>';
    removeBtn.onclick = function(e) {
        e.stopPropagation();
        e.preventDefault();
        _qaRemove(instKey, id);
    };
    tile.appendChild(removeBtn);
    return tile;
}

function _qaCreateAddTile(instKey) {
    var addTile = document.createElement('button');
    addTile.className = 'quick-actions-add-tile';
    addTile.title = 'Add a Quick Action';
    addTile.innerHTML = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><line x1="10" y1="4" x2="10" y2="16"/><line x1="4" y1="10" x2="16" y2="10"/></svg>';
    addTile.onclick = function() { _qaOpenAddPopover(instKey, this); };
    return addTile;
}

// How many total slots (real + placeholder) should be visible for a given
// pinned count — reveals one row at a time (matching the bar's current
// column count/cap, see _qaGridShape) rather than showing the whole grid's
// worth of empty "+" tiles up front. A pinned count that exactly fills a row
// invites the NEXT row; otherwise it just completes the row already in progress.
function _qaAddTileTarget(pinnedCount, shape) {
    if (pinnedCount >= shape.max) return shape.max;
    if (pinnedCount % shape.cols === 0) return Math.min(shape.max, pinnedCount + shape.cols);
    return Math.min(shape.max, Math.ceil(pinnedCount / shape.cols) * shape.cols);
}

// Adds/removes add-tile placeholders (never touches real tiles) so the
// grid always shows exactly _qaAddTileTarget's count — used after any
// change that could shift how many should be visible (entering/leaving
// edit mode, a real tile being added/removed, or the bar's span changing).
function _qaSyncAddTiles(instKey, grid) {
    var shape = _qaGridShape(instKey);
    // Only the 1x6 (single-row) shape reads as one connected bar, like
    // every other tool's .btn-group-wide — the 3-wide 2-row shape keeps
    // its tiles as individually bordered/gapped squares as normal.
    grid.classList.toggle('qa-grid-1x6', shape.cols === 6);
    var pinnedCount = grid.querySelectorAll('.quick-actions-btn').length;
    var target = _editMode ? _qaAddTileTarget(pinnedCount, shape) : pinnedCount;
    var have = grid.querySelectorAll('.quick-actions-add-tile').length;
    var need = target - pinnedCount - have;
    for (var i = 0; i < need; i++) grid.appendChild(_qaCreateAddTile(instKey));
    for (var j = 0; j < -need; j++) {
        var current = grid.querySelectorAll('.quick-actions-add-tile');
        if (!current.length) break;
        grid.removeChild(current[current.length - 1]);
    }
}

// Only rebuilds the real tiles from scratch when the pinned SET has
// actually changed (i.e. the very first render, at page load) — _qaAdd/
// _qaRemove already patch the grid directly and keep it in sync, so by
// the time entering/leaving edit mode calls this again, the existing
// tiles already match _qaGetPinned() exactly. Wiping and replaying their
// pop-in animation anyway on every toggle (even though nothing about them
// changed) was what made switching edit mode on/off feel jumpy — now only
// the add-tile placeholders get added/removed, and real tiles are left
// completely alone.
function _renderQuickActions(instKey) {
    var grid = document.getElementById(QA_INSTANCES[instKey].gridId);
    if (!grid) return;
    var pinned = _qaGetPinned(instKey);
    var existingIds = Array.prototype.map.call(grid.querySelectorAll('.quick-actions-btn'), function(t) {
        return t.getAttribute('data-tool-id');
    });
    var samePinned = existingIds.length === pinned.length && existingIds.every(function(id, i) { return id === pinned[i]; });

    if (!samePinned) {
        grid.innerHTML = '';
        pinned.forEach(function(id) {
            var tile = _qaBuildTile(instKey, id);
            if (tile) {
                tile.classList.add('qa-anim-mode-switch');
                grid.appendChild(tile);
            }
        });
    }

    // Reveals add-tile placeholders one row at a time (see
    // _qaAddTileTarget) rather than the full 3x3 worth up front — also
    // handles clearing them all out when leaving edit mode.
    _qaSyncAddTiles(instKey, grid);
}

// Renders every registered bar — called whenever edit mode toggles, since
// both bars' dashed/+ state depends on it.
function _renderAllQuickActions() {
    Object.keys(QA_INSTANCES).forEach(function(instKey) { _renderQuickActions(instKey); });
}

// The single entry point for the whole board's edit mode — both Quick
// Actions bars' dashed tiles and Bottom Layout's drag-reorder/add-remove
// all switch on together, no more separate pencils.
function _toggleEditMode() {
    _editMode = !_editMode;
    var grid = document.getElementById('homeToolGrid');
    if (grid) grid.classList.toggle('board-editing', _editMode);
    var editBtn = document.getElementById('quickActionsEditBtn');
    if (editBtn) editBtn.classList.toggle('active', _editMode);
    var bar = document.getElementById('editModeBar');
    if (_editMode) {
        _editSnapshot = _captureEditSnapshot();
        _editUndoStack = [];
        _editRedoStack = [];
        _editSyncUndoRedoButtons();
        if (bar) bar.classList.remove('edit-mode-bar-hidden');
        setTimeout(function() { document.addEventListener('mousedown', _editModeOutside); }, 0);
        _blStartGlow();
    } else {
        _editSnapshot = null;
        if (bar) bar.classList.add('edit-mode-bar-hidden');
        document.removeEventListener('mousedown', _editModeOutside);
        _qaCloseAddPopover();
        _blCloseAddPopover();
        _blStopGlow();
    }
    _renderAllQuickActions();
    _blRenderAddRow();
    // Board-editing adds/removes borders and padding right inside the top
    // group (e.g. Quick Actions tiles gaining a dashed border where they
    // had none) — _syncAnchorRowUnit's medium-tier row heights are pinned
    // to exact pixel values computed off Anchor/Quick Actions' rendered
    // height, and nothing re-measures them on its own when only a class
    // toggles (no resize). Left stale, Quick Actions grows into Favorite's
    // frozen track and Anchor's own content (down to the Null button) can
    // overflow the frozen total height. Re-synced here so entering/exiting
    // editing always reflects the current DOM.
    _syncAnchorTiers();
}

// Soft cursor-follow spotlight across every editable widget at once (see
// the CSS comment on .bl-draggable::before) — one shared, eased cursor
// position, continuously written into each widget's own --glow-x/--glow-y
// as a LOCAL offset (cursor position minus that widget's own top-left).
//
// Two perf fixes on top of the original version, both aimed at the same
// problem: this used to re-run document.querySelectorAll AND
// getBoundingClientRect on every editable widget on EVERY animation frame,
// for as long as edit mode stayed open — not just while actively
// dragging — which is exactly the kind of continuous layout-thrashing
// that was making the whole panel feel sluggish in AE.
//   1. The element list and their rects are cached (_blGlowEls/Rects)
//      instead of re-measured every frame. Widget positions only actually
//      change on discrete actions (reorder, add/remove, favorite), not
//      continuously, so a periodic refresh (_blRefreshGlowTargets, every
//      400ms while editing) is imperceptibly stale at worst and cuts the
//      expensive DOM query + gBCR calls by ~24x.
//   2. The cheap part (writing 2 custom properties per widget) still runs
//      every frame for smooth tracking, but is skipped entirely once the
//      eased position has converged to the raw cursor and isn't moving —
//      otherwise this was rewriting identical values 60 times a second
//      the entire time the mouse sat still, which is most of the time
//      this runs.
var _blGlowRAF = null;
var _blGlowRefreshTimer = null;
var _blGlowRawX = -9999, _blGlowRawY = -9999;
var _blGlowX = -9999, _blGlowY = -9999;
var _blGlowEls = [];
var _blGlowRects = [];

function _blGlowMove(e) {
    _blGlowRawX = e.clientX;
    _blGlowRawY = e.clientY;
}

function _blRefreshGlowTargets() {
    _blGlowEls = Array.prototype.slice.call(document.querySelectorAll(
        '#homeToolGrid.board-editing .bl-draggable, #homeToolGrid.board-editing .tool-box-favorite'
    ));
    _blGlowRects = _blGlowEls.map(function(el) { return el.getBoundingClientRect(); });
}

function _blGlowTick() {
    // 0.12 is the "slight delay" — how far the eased position catches up
    // to the raw cursor each frame, same lerp-toward-a-moving-target
    // pattern as the drag ghost's own 3D tilt.
    var dx = _blGlowRawX - _blGlowX, dy = _blGlowRawY - _blGlowY;
    if (Math.abs(dx) > 0.05 || Math.abs(dy) > 0.05) {
        _blGlowX += dx * 0.12;
        _blGlowY += dy * 0.12;
        for (var i = 0; i < _blGlowEls.length; i++) {
            _blGlowEls[i].style.setProperty('--glow-x', (_blGlowX - _blGlowRects[i].left) + 'px');
            _blGlowEls[i].style.setProperty('--glow-y', (_blGlowY - _blGlowRects[i].top) + 'px');
        }
    }
    _blGlowRAF = requestAnimationFrame(_blGlowTick);
}

function _blStartGlow() {
    if (_blGlowRAF) return;
    _blRefreshGlowTargets();
    document.addEventListener('mousemove', _blGlowMove);
    _blGlowRAF = requestAnimationFrame(_blGlowTick);
    _blGlowRefreshTimer = setInterval(_blRefreshGlowTargets, 400);
}

function _blStopGlow() {
    document.removeEventListener('mousemove', _blGlowMove);
    if (_blGlowRAF) { cancelAnimationFrame(_blGlowRAF); _blGlowRAF = null; }
    if (_blGlowRefreshTimer) { clearInterval(_blGlowRefreshTimer); _blGlowRefreshTimer = null; }
}

// ── Edit mode bar (Save / Cancel / Restore to Default) ──────────────────────
// Every edit already saves live to localStorage the moment it happens
// (Quick Actions x2, Bottom Layout, Favorites) — there's no pending/draft
// state to commit. So Save is just "exit, keep what's there"; Cancel
// reverts to a snapshot of those same keys taken the moment edit mode was
// entered, and Restore resets them to their built-in defaults — both swap
// localStorage wholesale and re-render, rather than undoing each step.
var EDIT_SNAPSHOT_KEYS = ['lineup-quick-actions', 'lineup-quick-actions-2', 'lineup-bottom-layout', 'lineup-favorite-widgets'];
var _editSnapshot = null;

function _captureEditSnapshot() {
    var snap = {};
    EDIT_SNAPSHOT_KEYS.forEach(function(key) {
        try { snap[key] = localStorage.getItem(key); } catch(e) { snap[key] = null; }
    });
    return snap;
}

function _restoreEditSnapshot(snap) {
    EDIT_SNAPSHOT_KEYS.forEach(function(key) {
        try {
            if (snap[key] === null) localStorage.removeItem(key);
            else localStorage.setItem(key, snap[key]);
        } catch(e) {}
    });
}

// ── Edit mode undo/redo ───────────────────────────────────────────────────
// Every mutating edit-mode action (Quick Actions x2 add/remove/reorder,
// Bottom Layout drag-reorder, Favorite add/remove) funnels through exactly
// one of _qaSavePinned/_blSaveRows/_favSave regardless of which gesture
// triggered it — recording the pre-mutation snapshot there, once per
// function, covers the whole surface without threading undo bookkeeping
// through every individual drag/click. Same snapshot shape Cancel already
// uses, just kept as a full history instead of a single slot. Both stacks
// reset whenever edit mode is (re)entered — undo history doesn't carry
// across separate editing sessions.
var _editUndoStack = [];
var _editRedoStack = [];

function _editRecordUndoPoint() {
    if (!_editMode) return;
    _editUndoStack.push(_captureEditSnapshot());
    _editRedoStack.length = 0;
    _editSyncUndoRedoButtons();
}

function _editUndo() {
    if (!_editMode || !_editUndoStack.length) return;
    _editRedoStack.push(_captureEditSnapshot());
    _restoreEditSnapshot(_editUndoStack.pop());
    _refreshAllEditableWidgets();
    _editSyncUndoRedoButtons();
}

function _editRedo() {
    if (!_editMode || !_editRedoStack.length) return;
    _editUndoStack.push(_captureEditSnapshot());
    _restoreEditSnapshot(_editRedoStack.pop());
    _refreshAllEditableWidgets();
    _editSyncUndoRedoButtons();
}

function _editSyncUndoRedoButtons() {
    var undoBtn = document.getElementById('editModeUndoBtn');
    var redoBtn = document.getElementById('editModeRedoBtn');
    if (undoBtn) undoBtn.disabled = _editUndoStack.length === 0;
    if (redoBtn) redoBtn.disabled = _editRedoStack.length === 0;
}

// _favApplyLayout already calls _blApplyLayout at its end, so this alone
// covers all three subsystems without redundant passes.
function _refreshAllEditableWidgets() {
    _renderAllQuickActions();
    _favApplyLayout();
}

function _editModeSaveClick() {
    if (_editMode) _toggleEditMode();
}

function _editModeCancelClick() {
    if (!_editMode || !_editSnapshot) return;
    _restoreEditSnapshot(_editSnapshot);
    _refreshAllEditableWidgets();
    _toggleEditMode();
}

// Resets Quick Actions (both bars), Bottom Layout, and Favorites to their
// defaults, then exits edit mode — a full "start over" command, not just
// another edit to keep tweaking.
function _editModeRestoreClick() {
    if (!_editMode) return;
    _qaCloseAddPopover();
    _blCloseAddPopover();
    EDIT_SNAPSHOT_KEYS.forEach(function(key) {
        try { localStorage.removeItem(key); } catch(e) {}
    });
    _refreshAllEditableWidgets();
    _toggleEditMode();
}

// Clicking anywhere outside either Quick Actions widget, the currently
// pinned Bottom Layout boxes, and either add popover exits edit mode —
// everything else on the board is pointer-events:none while editing
// anyway, so there's nothing meaningful to click there besides "I'm done".
// The pencil button itself is also excluded — it lives in the footer,
// well outside either widget, so without this a click on it would first
// get caught here (toggling edit mode off, since mousedown fires before
// click) and then immediately re-toggled back on by the button's own
// onclick, netting out to no change at all.
function _editModeOutside(e) {
    var editBtn = document.getElementById('quickActionsEditBtn');
    if (editBtn && editBtn.contains(e.target)) return;
    // Save/Cancel/Restore live in the bar at the top of the panel, well
    // outside either widget area — same double-toggle risk as the pencil
    // button above (each already calls _toggleEditMode/_editModeCancelClick
    // etc. itself via its own onclick).
    var editBar = document.getElementById('editModeBar');
    if (editBar && editBar.contains(e.target)) return;
    if (_qaPopover && _qaPopover.contains(e.target)) return;
    if (_blPopover && _blPopover.contains(e.target)) return;
    var mainQaBox = document.getElementById('sec-quick-actions');
    if (mainQaBox && mainQaBox.contains(e.target)) return;
    var favBox = document.getElementById('sec-favorite');
    if (favBox && favBox.contains(e.target)) return;
    // Covers the second Quick Actions bar too when it's pinned — it's just
    // another Bottom Layout box (data-block-id="quickactions2") as far as
    // this check is concerned.
    var insideBlBox = _blPinnedIds().some(function(id) {
        var el = _blBoxEl(id);
        return el && el.contains(e.target);
    });
    if (insideBlBox) return;
    if (_blAddRowEl && _blAddRowEl.contains(e.target)) return;
    _toggleEditMode();
}

// Patches the grid in place rather than calling _renderQuickActions, so
// only the removed tile's slot changes — the rest don't replay their
// entrance animation.
function _qaRemove(instKey, id) {
    _qaSavePinned(instKey, _qaGetPinned(instKey).filter(function(x) { return x !== id; }));

    var grid = document.getElementById(QA_INSTANCES[instKey].gridId);
    if (!grid) return;
    var tile = grid.querySelector('.quick-actions-btn[data-tool-id="' + id + '"]');
    if (tile) grid.removeChild(tile);
    // Placeholder count may need to shrink back down a whole row, not
    // just lose one slot — _qaSyncAddTiles handles that either way.
    _qaSyncAddTiles(instKey, grid);
}

// Patches the grid in place rather than calling _renderQuickActions — only
// the newly-pinned tile animates in (with a small bounce, see
// .qa-anim-bounce-in); the rest of the grid doesn't reload/rescale.
function _qaAdd(instKey, id) {
    var ids = _qaGetPinned(instKey);
    if (ids.length >= _qaGridShape(instKey).max) return; // bar's full — the popover shouldn't even be reachable here, but belt and suspenders
    if (ids.indexOf(id) === -1) ids.push(id);
    _qaSavePinned(instKey, ids);
    _qaCloseAddPopover();

    var grid = document.getElementById(QA_INSTANCES[instKey].gridId);
    if (!grid) return;
    var tile = _qaBuildTile(instKey, id);
    if (tile) {
        tile.classList.add('qa-anim-bounce-in');
        var firstAddTile = grid.querySelector('.quick-actions-add-tile');
        if (firstAddTile) grid.insertBefore(tile, firstAddTile);
        else grid.appendChild(tile);
    }
    // Filling the last slot in a row can reveal a whole new row of
    // placeholders rather than just losing one — _qaSyncAddTiles handles
    // that either way.
    _qaSyncAddTiles(instKey, grid);
}

// ── Add-tool popover — a mini version of the Tools tab: a search input and
// a scrollable grid of every not-yet-pinned tool, cloned from the same
// catalog tiles Quick Actions itself pulls from. Bottom Layout's own
// add-widget popover (see _blBuildPopover) reuses the same .qa-add-*
// classes for a consistent look, but keeps separate DOM/state since the
// two list completely different kinds of things.

function _qaBuildPopover() {
    var el = document.createElement('div');
    el.className = 'qa-add-popover';

    var searchRow = document.createElement('div');
    searchRow.className = 'qa-add-search-row';
    // A plain span with an innerHTML svg STRING, not document.createElement('svg')
    // — that creates the element in the wrong (HTML, not SVG) namespace, so
    // none of its child shapes render. Every other dynamically-built icon in
    // this file goes through createElementNS instead; this is simpler still.
    var icon = document.createElement('span');
    icon.className = 'qa-add-search-icon';
    icon.innerHTML = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="8.5" cy="8.5" r="6"/><line x1="13" y1="13" x2="17.5" y2="17.5"/></svg>';
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'qa-add-search-input';
    input.placeholder = 'Search…';
    input.addEventListener('input', _qaFilterPopover);
    searchRow.appendChild(icon);
    searchRow.appendChild(input);
    el.appendChild(searchRow);

    var grid = document.createElement('div');
    grid.className = 'qa-add-grid';
    el.appendChild(grid);

    document.body.appendChild(el);
    _qaPopoverInput = input;
    _qaPopoverGrid  = grid;
    return el;
}

function _qaFilterPopover() {
    var q = _qaPopoverInput.value.trim().toLowerCase();
    var tiles = _qaPopoverGrid.querySelectorAll('.qa-add-tile');
    for (var i = 0; i < tiles.length; i++) {
        var title = (tiles[i].getAttribute('title') || '').toLowerCase();
        tiles[i].classList.toggle('qa-add-tile-hidden', q.length > 0 && title.indexOf(q) === -1);
    }
}

function _qaOpenAddPopover(instKey, anchorEl) {
    if (!_qaPopover) _qaPopover = _qaBuildPopover();

    var pinned = _qaGetPinned(instKey);
    _qaPopoverGrid.innerHTML = '';
    _qaCatalog().forEach(function(source) {
        var id = source.getAttribute('data-tool-id');
        if (pinned.indexOf(id) !== -1) return;
        var tile = _qaCloneCatalogTile(source);
        tile.classList.remove('tools-grid-btn');
        tile.classList.add('qa-add-tile');
        tile.removeAttribute('data-group');
        tile.onclick = function() { _qaAdd(instKey, id); };
        _qaPopoverGrid.appendChild(tile);
    });
    if (_qaPopoverInput) _qaPopoverInput.value = '';

    var rect = anchorEl.getBoundingClientRect();
    var vw = window.innerWidth, vh = window.innerHeight;
    var pw = 220, ph = 230;
    _qaPopover.style.left = Math.max(4, Math.min(rect.left, vw - pw - 4)) + 'px';
    _qaPopover.style.top  = Math.min(rect.bottom + 4, vh - ph - 4) + 'px';
    _qaPopover.classList.add('visible');
    if (_qaPopoverInput) _qaPopoverInput.focus();

    setTimeout(function() {
        document.addEventListener('mousedown', _qaPopoverOutside);
        document.addEventListener('keydown', _qaPopoverKey);
    }, 0);
}

function _qaCloseAddPopover() {
    if (_qaPopover) _qaPopover.classList.remove('visible');
    document.removeEventListener('mousedown', _qaPopoverOutside);
    document.removeEventListener('keydown', _qaPopoverKey);
}

function _qaPopoverOutside(e) {
    if (_qaPopover && !_qaPopover.contains(e.target) && !e.target.closest('.quick-actions-add-tile')) {
        _qaCloseAddPopover();
    }
}

function _qaPopoverKey(e) {
    if (e.key === 'Escape') _qaCloseAddPopover();
}

// ── BOTTOM LAYOUT (Align / Distribute / Sizing / Auto Crop / Sort) ─────────────
// A second customization scope alongside Quick Actions — separate data/
// storage, but both switch on together under the one _editMode/pencil (see
// _toggleEditMode). This one is a fixed set of 5 boxes (no add/remove) that
// can be reordered, docking side-by-side into half-width pairs purely by
// where you drop them — there is no separate full/half toggle. Layout is
// stored as an ordered list of rows: a row is either one id (full-line) or
// two ids (a half+half pair). Width is entirely derived from which kind of
// row a box is in (see _blPack), so dragging a box out of a pair
// automatically leaves its former partner alone as a full-line row, and
// dragging a box onto the side edge of a lone full-line box automatically
// docks them into a pair.

var BL_STORAGE_KEY = 'lineup-bottom-layout';
// Everything that CAN live in the bottom bento grid — pinned/order is
// stored separately (_blGetRows), so not every catalog entry has to be
// shown at once. label/icon here are only used to build the add-widget
// popover (see _blOpenAddPopover); the icon is cloned straight off each
// box's own .qa-collapse-icon rather than duplicated by hand.
var BL_CATALOG = [
    { id: 'alignlayers',   label: 'Align' },
    { id: 'distribute',    label: 'Distribute' },
    { id: 'sizing',        label: 'Sizing' },
    { id: 'autocrop',      label: 'Auto Crop' },
    { id: 'sort',          label: 'Layer Sort' },
    { id: 'quickactions2', label: 'Quick Actions (2nd Bar)' },
    { id: 'spellcheck',    label: 'Spell Check' },
    { id: 'ease',          label: 'Ease Copy' },
    { id: 'vectortools',   label: 'Shape Tools' }
];
var BL_CATALOG_IDS = BL_CATALOG.map(function(c) { return c.id; });
// Shape Tools starts unpinned (like Quick Actions 2/Spell Check/Ease Copy),
// and so does Sort Layers now too — rather than forced into everyone's
// default layout, both are added via the "+" popover instead.
var BL_DEFAULT_ROWS = [ ['alignlayers'], ['distribute'], ['sizing', 'autocrop'] ];

var _blDrag = null; // non-null while a drag is in progress

function _blBoxEl(id) {
    return document.querySelector('#homeGrid .tool-box[data-block-id="' + id + '"]');
}

// A row is 1-2 ids, each a valid catalog id appearing at most once —
// anything else (duplicate, unknown id, stale format) is rejected
// wholesale rather than partially repaired, falling back to the default
// arrangement. Unlike the original fixed-5 version, rows don't have to
// cover every catalog id — entries left out are simply not pinned.
function _blRowsValid(rows) {
    if (!Array.isArray(rows)) return false;
    var seen = [];
    for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        if (!Array.isArray(row) || row.length < 1 || row.length > 2) return false;
        for (var j = 0; j < row.length; j++) {
            if (BL_CATALOG_IDS.indexOf(row[j]) === -1 || seen.indexOf(row[j]) !== -1) return false;
            seen.push(row[j]);
        }
    }
    return true;
}

function _blGetRows() {
    var saved;
    try { saved = JSON.parse(localStorage.getItem(BL_STORAGE_KEY)); } catch(e) {}
    if (_blRowsValid(saved)) return saved;
    return BL_DEFAULT_ROWS.map(function(row) { return row.slice(); });
}

function _blSaveRows(rows) {
    _editRecordUndoPoint();
    try { localStorage.setItem(BL_STORAGE_KEY, JSON.stringify(rows)); } catch(e) {}
}

// Flat, ordered list of every id currently pinned (shown) — the dynamic
// equivalent of the old fixed BL_IDS constant.
function _blPinnedIds() {
    var ids = [];
    _blGetRows().forEach(function(row) { row.forEach(function(id) { ids.push(id); }); });
    return ids;
}

// Catalog entries not currently pinned — what the add-widget popover lists.
// Also excludes whatever's currently favorited: favoriting already pulls a
// widget's real .tool-body out of Bottom Layout (see _favApplyLayout), but
// nothing stopped this popover from still offering it — picking it there
// pinned a brand-new row for the same id and _blApplyLayout moved that one
// tool-body into it, leaving the favorite page it had just been ripped out
// of empty/broken. A widget can only live in one place at a time; if it's
// favorited, that's where it lives.
function _blAvailableIds() {
    var pinned = _blPinnedIds();
    var favorited = _favGet();
    return BL_CATALOG_IDS.filter(function(id) { return pinned.indexOf(id) === -1 && favorited.indexOf(id) === -1; });
}

// A row with 2 ids renders as span 3 + span 3; a row with 1 id renders as
// span 6 — there's no stored "preference" to fall out of sync with this.
function _blPack(rows) {
    var out = [];
    rows.forEach(function(row) {
        if (row.length === 2) {
            out.push({ id: row[0], span: 3 });
            out.push({ id: row[1], span: 3 });
        } else {
            out.push({ id: row[0], span: 6 });
        }
    });
    return out;
}

// Sets each PINNED box's rendered data-span and moves it to the end of
// #homeGrid in row order — .tool-col uses sparse (non-dense) auto-flow, so
// DOM order is what actually determines visual position; this is what
// makes reordering deterministic instead of leaving it to grid
// auto-placement to guess where gaps should be backfilled. Everything in
// the catalog that ISN'T pinned gets .bl-unpinned (display:none) instead —
// it stays in the DOM (so its icon can still be cloned for the add
// popover, and so re-adding it doesn't need to rebuild anything) but takes
// up no grid space.
function _blApplyLayout(rows) {
    rows = rows || _blGetRows();
    var grid = document.getElementById('homeGrid');
    if (!grid) return;
    var spanById = {};
    _blPack(rows).forEach(function(entry) {
        spanById[entry.id] = entry.span; // the real stored span — _narrowStack only overrides what's rendered, never this
        var box = _blBoxEl(entry.id);
        if (!box) return;
        box.classList.remove('bl-unpinned');
        box.setAttribute('data-span', _narrowStack ? 6 : entry.span);
        grid.appendChild(box);
    });
    BL_CATALOG_IDS.forEach(function(id) {
        if (spanById[id]) return;
        var box = _blBoxEl(id);
        if (box) box.classList.add('bl-unpinned');
    });
    _blRenderAddRow();
    // quickactions2's placeholder count depends on its column count (see
    // _qaGridShape), which just changed along with its span above.
    var qa2Grid = document.getElementById(QA_INSTANCES.quickactions2.gridId);
    if (qa2Grid) _qaSyncAddTiles('quickactions2', qa2Grid);
    // Align/Distribute's own available width can change here (a drag
    // docking/undocking them into a pair, or narrow-stack forcing span 6)
    // without #homeToolGrid itself resizing, so _syncAnchorTiers' own
    // resize-driven call wouldn't otherwise re-fire this.
    _syncCtrlRowLabels();
}

function _blCaptureRects(ids) {
    var map = {};
    ids.forEach(function(id) {
        var el = _blBoxEl(id);
        if (el) map[id] = el.getBoundingClientRect();
    });
    return map;
}

// FLIP: after a reflow, snap each box back to where it visually was via an
// inverse transform, then transition that transform away to '' — reads as
// the boxes smoothly sliding/resizing into their new positions. Writes are
// batched across every box (jump to the inverse transform for ALL of them,
// ONE forced reflow, THEN start every transition) rather than forcing a
// separate reflow per box — up to ~7 forced reflows on every drop/add/
// remove down to at most 1, matching the same batched-FLIP pattern already
// used correctly in initSettingsDrag elsewhere in this file.
function _blPlayFlip(ids, oldRects) {
    var moved = [];
    ids.forEach(function(id) {
        var el = _blBoxEl(id);
        var old = oldRects[id];
        if (!el || !old) return;
        var neu = el.getBoundingClientRect();
        var dx = old.left - neu.left;
        var dy = old.top - neu.top;
        if (!dx && !dy) return;
        el.style.transition = 'none';
        el.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
        moved.push(el);
    });
    if (!moved.length) return;
    void moved[0].offsetWidth; // one forced reflow settles every box's jump above at once
    moved.forEach(function(el) {
        el.style.transition = 'transform 0.12s cubic-bezier(0.4, 0, 0.2, 1)';
        el.style.transform = '';
    });
}

// Rows with `id` removed — a row that loses its only id disappears, a pair
// row that loses one id becomes a single (i.e. its old partner
// automatically reverts to full-line, no separate "un-dock" step needed).
function _blRemoveFromRows(rows, id) {
    var out = [];
    rows.forEach(function(row) {
        var filtered = row.filter(function(x) { return x !== id; });
        if (filtered.length) out.push(filtered);
    });
    return out;
}

// Finds whichever .bl-draggable box is actually under the cursor, using
// real hit-testing (elementFromPoint) rather than nearest-by-distance —
// exact and unambiguous, unlike Euclidean "nearest box", which could
// waver between two adjacent boxes right at their shared border. The
// dragged box itself is pointer-events:none while held (see
// .bl-dragging-source) so this always sees through it to whatever's
// actually underneath.
function _blTargetFromPoint(x, y) {
    var el = document.elementFromPoint(x, y);
    while (el && el !== document.body) {
        if (el.classList && el.classList.contains('bl-draggable')) return el;
        el = el.parentElement;
    }
    return null;
}

// Resolves exactly one zone relative to a specific target widget — no dead
// zone at all, every point over a widget resolves to something:
//  - top ~25% of its height -> insert a new full-line row above it
//  - bottom ~25% -> insert a new full-line row below it
//  - remaining middle:
//     - already half-width (paired, no room to dock a third widget in
//       anyway) -> the whole remaining middle is one "swap" zone: trade
//       places with it
//     - otherwise (full width, has room to pair) -> left half docks left,
//       right half docks right
// The top/bottom bands apply either way — losing those for a paired widget
// would make it impossible to insert a new row directly above/below an
// existing pair at all, since dock-left/right and swap both only replace
// what happens in the middle. Narrow stack (see _narrowStack) drops the
// dock-left/right half (and the swap zone) entirely — every widget renders
// full width there regardless of its real stored pairing, so neither a
// left/right split nor a "half-width" swap target would mean anything
// visually. Every point just resolves to before/after off a plain 50/50
// vertical split instead.
// Cumulative offsetLeft/Top from `el` up through its own offsetParent chain
// to `ancestor` — a zoom-independent alternative to getBoundingClientRect,
// same idea as _blOffsetRect elsewhere in this file. Requires `ancestor`
// to actually be a positioned ancestor of `el` (true here: .tool-box is
// position:relative, so it's always its own descendants' offsetParent
// somewhere up the chain).
function _blOffsetFromAncestor(el, ancestor) {
    var x = 0, y = 0;
    while (el && el !== ancestor) {
        x += el.offsetLeft;
        y += el.offsetTop;
        el = el.offsetParent;
    }
    return { x: x, y: y };
}

// cursorX/cursorY are the drag cursor's position relative to targetBox's
// own top-left corner (see _blOnDragMove's own cursor-position math) — NOT
// clientX/clientY compared against targetBox.getBoundingClientRect(),
// which is what this used to do. That comparison quietly broke under any
// panel zoom (the Scale slider defaults to 1.05x, not 1x): every point
// resolved to before/after and dock-left/dock-right or swap never
// triggered — invisible in a plain browser tab (zoom 1, bug never fires)
// but reliably reproducing inside AE's CEF host, matching the exact
// "getBoundingClientRect vs. a CSS zoom" inconsistency _blOffsetRect
// already worked around for this same indicator's own positioning.
function _blZoneForTarget(targetBox, baseline, cursorX, cursorY) {
    var targetId = targetBox.getAttribute('data-block-id');
    var rowIdx = -1, canDock = false, posInRow = -1, rowSize = 0;
    baseline.forEach(function(row, i) {
        var p = row.indexOf(targetId);
        if (p !== -1) { rowIdx = i; canDock = row.length === 1; posInRow = p; rowSize = row.length; }
    });
    if (rowIdx === -1) return null;

    var w = targetBox.offsetWidth, h = targetBox.offsetHeight;

    if (_narrowStack) {
        // posInRow/rowSize travel with the candidate so _blShowIndicator and
        // _blRowsFromCandidate can tell whether the target is mid-pair —
        // a paired logical row renders as two separate stacked full-width
        // rows here, so "before"/"after" a specific widget can mean landing
        // BETWEEN its own pair (see both functions below), not just before/
        // after the pair as a whole the way rowIdx alone would imply.
        return { targetId: targetId, rowIdx: rowIdx, logicalRowIdx: rowIdx, posInRow: posInRow, rowSize: rowSize,
                 mode: cursorY < h / 2 ? 'before' : 'after' };
    }

    var topBand = h * 0.25;
    var bottomBand = h * 0.75;

    if (cursorY < topBand) return { targetId: targetId, rowIdx: rowIdx, mode: 'before' };
    if (cursorY > bottomBand) return { targetId: targetId, rowIdx: rowIdx, mode: 'after' };

    // Already half-width — trading places with it is more useful than
    // previewing a dock that couldn't fit (there's no room for a third
    // widget in an already-full pair), so the whole remaining middle band
    // is one zone regardless of left/right cursor position.
    if (!canDock) {
        return { targetId: targetId, rowIdx: rowIdx, mode: 'swap' };
    }

    return { targetId: targetId, rowIdx: rowIdx, mode: cursorX < w / 2 ? 'dock-left' : 'dock-right' };
}

// originalRows is the pre-pickup arrangement (draggedId still in its own
// slot) — only needed for 'swap', which trades two widgets' exact
// positions and so needs the dragged widget's own slot/partner still
// intact, unlike every other mode here which builds off `baseline`
// (draggedId already removed/collapsed out).
function _blRowsFromCandidate(baseline, draggedId, candidate, originalRows) {
    if (!candidate) return null;

    if (candidate.mode === 'swap') {
        var rows2 = originalRows.map(function(row) { return row.slice(); });
        var dRow = -1, dPos = -1, tRow = -1, tPos = -1;
        rows2.forEach(function(row, i) {
            var dp = row.indexOf(draggedId);      if (dp !== -1) { dRow = i; dPos = dp; }
            var tp = row.indexOf(candidate.targetId); if (tp !== -1) { tRow = i; tPos = tp; }
        });
        if (dRow === -1 || tRow === -1) return rows2;
        rows2[dRow][dPos] = candidate.targetId;
        rows2[tRow][tPos] = draggedId;
        return rows2;
    }

    var rows = baseline.map(function(row) { return row.slice(); });

    if (candidate.mode === 'dock-left' || candidate.mode === 'dock-right') {
        rows[candidate.rowIdx] = candidate.mode === 'dock-left' ? [draggedId, candidate.targetId] : [candidate.targetId, draggedId];
        return rows;
    }

    if (!_narrowStack) {
        rows.splice(candidate.mode === 'after' ? candidate.rowIdx + 1 : candidate.rowIdx, 0, [draggedId]);
        return rows;
    }

    // Narrow-stack: landing 'before'/'after' a widget that sits at the edge
    // of its own logical row still means before/after the row as a whole
    // (pair stays intact). Landing on the INNER edge of a pair (its top half
    // when it's the second widget, or its bottom half when it's the first)
    // means the drop is actually BETWEEN the two — split the pair into two
    // standalone rows with the dragged widget in between, matching exactly
    // where the drop-line indicator shows it landing.
    var row = rows[candidate.logicalRowIdx];
    var atRowEdge = candidate.mode === 'before' ? candidate.posInRow === 0 : candidate.posInRow === row.length - 1;
    if (atRowEdge) {
        rows.splice(candidate.mode === 'after' ? candidate.logicalRowIdx + 1 : candidate.logicalRowIdx, 0, [draggedId]);
    } else {
        rows.splice(candidate.logicalRowIdx, 1, [row[0]], [draggedId], [row[1]]);
    }
    return rows;
}

var _blIndicatorEl = null;
// Lives inside #homeGrid itself (not appended to <body>) so it renders
// through the exact same CSS zoom that subtree can be under (the Scale
// slider — its default is already 1.05x, not 1x) as the widgets it tracks.
// A fixed-to-viewport element positioned from getBoundingClientRect()
// measurements taken *inside* a zoomed ancestor is exactly the setup where
// Chromium/CEF's zoom handling has a long history of inconsistency — being
// a real child of the same zoomed subtree sidesteps that instead of
// depending on it resolving correctly.
function _blIndicator() {
    if (!_blIndicatorEl) {
        _blIndicatorEl = document.createElement('div');
        _blIndicatorEl.className = 'bl-drop-indicator';
        document.getElementById('homeGrid').appendChild(_blIndicatorEl);
    }
    return _blIndicatorEl;
}

// offsetLeft/offsetTop/offsetWidth/offsetHeight describe an element's
// position in the CSS LAYOUT tree, relative to its offsetParent — every
// .bl-draggable .tool-box is a direct child of #homeGrid, which is also
// _blIndicatorEl's own offsetParent (see _blIndicator), so these numbers are
// exactly what the indicator's own top/left/width/height need. Deliberately
// NOT getBoundingClientRect(): that reports the final RENDERED/painted
// position, and #homeGrid's subtree can be under a CSS zoom (the Scale
// slider — its default is already 1.05x, not 1x) that Chromium/CEF has a
// long history of resolving inconsistently for getBoundingClientRect —
// offsetLeft/Top never touch that rendered/zoomed space at all, so there's
// no zoom ambiguity to get wrong in the first place.
function _blOffsetRect(el) {
    if (!el) return null;
    var left = el.offsetLeft, top = el.offsetTop, width = el.offsetWidth, height = el.offsetHeight;
    return { left: left, top: top, width: width, height: height, right: left + width, bottom: top + height };
}

// The rect of whichever row sits at baseline[rowIdx]. Normally either id in
// a paired row shares the same top/bottom by construction, so the first is
// enough — but in narrow-stack every widget is forced full-width (see
// data-span in _blApplyLayout), so a paired row like [align, distribute]
// actually renders as TWO separate stacked full-width rows, not one. Which
// of the pair is actually adjacent to the target then depends on which side
// this row is being measured from: 'last' when it sits ABOVE the target
// (its bottom-most stacked widget is what touches the target), 'first'
// (the default) when it sits BELOW. Returns null past either end (no
// neighboring row there).
function _blRowRect(baseline, rowIdx, edge) {
    if (rowIdx < 0 || rowIdx >= baseline.length) return null;
    var row = baseline[rowIdx];
    var id = (_narrowStack && edge === 'last') ? row[row.length - 1] : row[0];
    return _blOffsetRect(_blBoxEl(id));
}

// Pure visual feedback with zero effect on layout — nothing else on the
// board moves until you actually drop, so there's no moving-target fight
// to land a dock. Two looks depending on what the candidate means:
//  - swap: a dashed box over the WHOLE target widget (an already half-width
//    one — see _blZoneForTarget) — reads as "trade places with this",
//    matching _blRowsFromCandidate's own 'swap' handling exactly.
//  - dock-left/right: a dashed box over the half of the target widget
//    that the dragged box would actually occupy (the target itself will
//    shrink into the other half) — reads as "your box goes here" rather
//    than an abstract line. Transitions left/width so switching sides on
//    the same widget slides rather than snaps.
//  - before/after: a plain dashed line, 90% of the full grid width and
//    centered, regardless of the target's own current width — the
//    inserted row is always full-line even when the target you're
//    hovering is itself only half-width. Positioned at the true midpoint
//    between the two rows on either side of the gap (falling back to a
//    fixed offset past the target's own edge only at the very top/bottom
//    of the board, where there's no neighboring row) — hovering the
//    bottom band of row N and the top band of row N+1 refer to the exact
//    same gap, so both now land the line in the exact same spot instead
//    of two slightly different heights depending on which row's edge you
//    happened to be closer to.
function _blShowIndicator(targetBox, candidate, baseline) {
    var mode = candidate.mode;
    var el = _blIndicator();
    // offsetLeft/Top/Width/Height, not getBoundingClientRect — see
    // _blOffsetRect's own comment for why (avoids relying on how a CSS zoom
    // on an ancestor resolves for getBoundingClientRect, which is where a
    // still-visible position/size mismatch traced back to).
    var r = _blOffsetRect(targetBox);
    var homeGrid = document.getElementById('homeGrid');
    el.style.display = 'block';

    if (mode === 'swap') {
        el.className = 'bl-drop-indicator bl-drop-indicator-box';
        el.style.top    = r.top + 'px';
        el.style.height = r.height + 'px';
        el.style.width  = r.width + 'px';
        el.style.left   = r.left + 'px';
    } else if (mode === 'dock-left' || mode === 'dock-right') {
        el.className = 'bl-drop-indicator bl-drop-indicator-box';
        var halfWidth = (r.width - 8) / 2; // same half-width math .bl-pack uses (8 = grid gap, .tool-col)
        el.style.top    = r.top + 'px';
        el.style.height = r.height + 'px';
        el.style.width  = halfWidth + 'px';
        el.style.left   = (mode === 'dock-left' ? r.left : r.right - halfWidth) + 'px';
    } else {
        el.className = 'bl-drop-indicator bl-drop-indicator-line';
        var lineWidth = homeGrid.offsetWidth * 0.95;
        var THICK = 6;
        el.style.left   = (homeGrid.offsetWidth * 0.025) + 'px';
        el.style.width  = lineWidth + 'px';
        el.style.height = THICK + 'px';

        var neighborRect;
        if (_narrowStack) {
            // The true neighbor here is whichever specific widget sits next
            // to the target — which, for a widget mid-pair, is its OWN
            // pair-mate stacked right there (not "the previous/next LOGICAL
            // row", which for a pair only names ONE of its two members and
            // may not even be the one actually touching the target).
            var row = baseline[candidate.logicalRowIdx];
            if (mode === 'before') {
                neighborRect = candidate.posInRow > 0
                    ? _blOffsetRect(_blBoxEl(row[candidate.posInRow - 1]))
                    : _blRowRect(baseline, candidate.logicalRowIdx - 1, 'last');
            } else {
                neighborRect = candidate.posInRow < row.length - 1
                    ? _blOffsetRect(_blBoxEl(row[candidate.posInRow + 1]))
                    : _blRowRect(baseline, candidate.logicalRowIdx + 1, 'first');
            }
        } else {
            neighborRect = mode === 'before'
                ? _blRowRect(baseline, candidate.rowIdx - 1)
                : _blRowRect(baseline, candidate.rowIdx + 1);
        }
        var centerY;
        if (mode === 'before') {
            centerY = neighborRect ? (neighborRect.bottom + r.top) / 2 : r.top - 6;
        } else {
            centerY = neighborRect ? (r.bottom + neighborRect.top) / 2 : r.bottom + 6;
        }
        el.style.top = (centerY - THICK / 2) + 'px'; // centered on the computed gap midpoint
    }
}

function _blHideIndicator() {
    if (_blIndicatorEl) _blIndicatorEl.style.display = 'none';
}

// Strips id attributes from a subtree — the ghost is a deep clone of the
// real box (buttons, selects, inputs and all, so it looks identical while
// floating), and cloneNode duplicates every id in it verbatim, which
// would otherwise leave two elements answering to the same id in the DOM.
function _blStripIds(el) {
    if (el.id) el.removeAttribute('id');
    Array.prototype.forEach.call(el.querySelectorAll('[id]'), function(child) {
        child.removeAttribute('id');
    });
}

function _blStartDrag(id, startX, startY) {
    var box = _blBoxEl(id);
    if (!box) return;

    var rect = box.getBoundingClientRect();

    // The real box stays exactly where it is — dimmed in place, inert —
    // for the entire drag. Nothing about the grid reflows until the actual
    // drop; a separate floating clone is what follows the cursor. Moving
    // the real box (or re-packing the other 4 around its absence) is what
    // made everything slide around mid-drag before.
    box.classList.add('bl-dragging-source');

    var ghost = box.cloneNode(true);
    _blStripIds(ghost);
    ghost.classList.remove('bl-dragging-source');
    ghost.classList.add('bl-drag-ghost');
    ghost.style.width  = rect.width + 'px';
    ghost.style.height = rect.height + 'px';
    // Narrow stack (see _narrowStack): every widget is full width there, so
    // the ghost is locked to the same left edge it already sits at instead
    // of centering under the cursor — dragging only ever moves it up/down,
    // matching there being nothing to dock left/right into anyway.
    ghost.style.left = (_narrowStack ? rect.left : (startX - rect.width / 2)) + 'px';
    ghost.style.top  = (startY - rect.height / 2) + 'px';
    document.body.appendChild(ghost);

    var originalRows = _blGetRows();
    var favBoxAtStart = _favSlotEl();
    _blDrag = {
        id: id,
        sourceBox: box,
        ghost: ghost,
        heldWidth: rect.width,
        heldHeight: rect.height,
        lockedLeft: rect.left,
        originalRows: originalRows,
        // Precomputed once — _blOnDragMove's no-op check used to
        // JSON.stringify this SAME, never-changing array again on every
        // single mousemove just to compare against it.
        originalRowsJSON: JSON.stringify(originalRows),
        baseline: _blRemoveFromRows(originalRows, id),
        // The Favorite slot doesn't move mid-drag (nothing else is
        // reflowing while the source box stays put), so its rect is
        // measured once here rather than via a fresh getBoundingClientRect
        // on every mousemove.
        favBox: favBoxAtStart,
        favRect: favBoxAtStart ? favBoxAtStart.getBoundingClientRect() : null,
        candidate: null, // {targetId, rowIdx, mode} | null
        // 3D tilt state (see _blTiltTick) — velocity is raw cursor delta
        // per mousemove, tiltX/tiltY are the actual eased rotation the
        // ghost renders. Decaying velocity itself every frame (not just
        // easing rotation toward it) is what makes the tilt flatten back
        // out on its own when the cursor stops, without needing to detect
        // "drag went idle" as a separate case.
        tiltVX: 0, tiltVY: 0,
        tiltX: 0, tiltY: 0,
        tiltLastX: startX, tiltLastY: startY,
        tiltRAF: null
    };
    document.body.classList.add('bl-drag-active');
    document.addEventListener('mousemove', _blOnDragMove);
    document.addEventListener('mouseup', _blOnDragEnd);
    _blDrag.tiltRAF = requestAnimationFrame(_blTiltTick);
}

// Runs every frame for the whole drag, independent of mousemove firing —
// that's what lets the tilt actually decay back to flat once the cursor
// stops moving, rather than freezing at whatever angle it last had.
// Velocity decays geometrically each tick (so it self-zeroes shortly after
// motion stops); the rendered rotation then eases toward that decaying
// velocity-derived target, which is the "follows at a delay" lag — the
// rotation is always chasing a target that's already falling back toward
// zero, never instantly snapping to the cursor's raw motion.
function _blTiltTick() {
    if (!_blDrag) return;
    // Decay 0.82->0.75 (velocity itself dies out faster once motion stops)
    // and ease 0.18->0.24 (rendered rotation catches up to that decaying
    // target faster too) — both tightened so it settles back to flat
    // quicker, independent of the +10% magnitude bump below.
    _blDrag.tiltVX *= 0.75;
    _blDrag.tiltVY *= 0.75;
    // Clamp (19.2->21.1), velocity multiplier (1.68->1.85), and perspective
    // (720->648, see below) all +10% more for a more pronounced tilt.
    var targetY = Math.max(-21.1, Math.min(21.1, _blDrag.tiltVX * 1.85));
    var targetX = Math.max(-21.1, Math.min(21.1, -_blDrag.tiltVY * 1.85));
    _blDrag.tiltX += (targetX - _blDrag.tiltX) * 0.24;
    _blDrag.tiltY += (targetY - _blDrag.tiltY) * 0.24;
    _blDrag.ghost.style.transform =
        'perspective(648px) rotateX(' + _blDrag.tiltX.toFixed(2) + 'deg) rotateY(' + _blDrag.tiltY.toFixed(2) + 'deg)';
    _blDrag.tiltRAF = requestAnimationFrame(_blTiltTick);
}

function _blOnDragMove(e) {
    if (!_blDrag) return;
    _blDrag.ghost.style.left = (_narrowStack ? _blDrag.lockedLeft : (e.clientX - _blDrag.heldWidth / 2)) + 'px';
    _blDrag.ghost.style.top  = (e.clientY - _blDrag.heldHeight / 2) + 'px';

    // Raw per-event cursor delta — _blTiltTick (running every frame,
    // separately) is what actually turns this into the eased, decaying
    // rotation; this just feeds it the latest real motion.
    _blDrag.tiltVX = e.clientX - _blDrag.tiltLastX;
    _blDrag.tiltVY = e.clientY - _blDrag.tiltLastY;
    _blDrag.tiltLastX = e.clientX;
    _blDrag.tiltLastY = e.clientY;

    // Dropping directly onto the Favorite slot stars the dragged widget
    // instead of reordering it (see _blOnDragEnd) — a plain point-in-rect
    // test against #sec-favorite, checked first and independent of the
    // .bl-draggable hit-test below: the favorite slot lives in the
    // top group, a completely separate area from the reorderable board,
    // so the two can never spatially conflict. Both the element and its
    // rect are cached on _blDrag at drag start — nothing else reflows
    // while the source box stays put, so the slot's position can't
    // change mid-drag, and re-measuring it on every single mousemove was
    // pure waste.
    var favBox = _blDrag.favBox;
    var overFav = false;
    if (favBox) {
        var fr = _blDrag.favRect;
        overFav = e.clientX >= fr.left && e.clientX <= fr.right && e.clientY >= fr.top && e.clientY <= fr.bottom;
    }
    _blDrag.overFav = overFav;
    if (favBox) favBox.classList.toggle('bl-fav-drop-target', overFav);
    if (overFav) {
        _blDrag.candidate = null;
        _blHideIndicator();
        return;
    }

    // The source box is still sitting in its real grid slot (just dimmed
    // and pointer-events:none), so hit-testing naturally sees through it —
    // no explicit self-exclusion needed.
    var targetBox = _blTargetFromPoint(e.clientX, e.clientY);
    // e.offsetX/offsetY are relative to e.target itself (whatever's
    // directly under the cursor) — resolved by the browser's own hit-test
    // pipeline rather than a separate getBoundingClientRect() query, so
    // they stay accurate under a panel zoom where gBCR doesn't (see
    // _blZoneForTarget's own comment). Adding e.target's cumulative offset
    // up to targetBox converts that into "cursor position within
    // targetBox" without ever touching gBCR.
    var cursorInBox = targetBox ? _blOffsetFromAncestor(e.target, targetBox) : null;
    var candidate = targetBox
        ? _blZoneForTarget(targetBox, _blDrag.baseline, e.offsetX + cursorInBox.x, e.offsetY + cursorInBox.y)
        : null;

    // The source box's own row is never removed from the board (it's just
    // dimmed in place), so the gap on either side of it isn't real empty
    // space — hovering the widgets immediately above/below it can resolve
    // to "insert right here", which just reconstructs the exact original
    // arrangement. That's not a meaningful placement, and having it show
    // up as its own indicator (redundant with just... not moving it) was
    // confusing, so it's suppressed the same as any other dead zone.
    // originalRowsJSON is precomputed once at drag start (see _blStartDrag)
    // — this array never changes for the duration of the drag, so
    // re-stringifying it here on every mousemove (on top of the candidate
    // side, which does have to be computed fresh) was redundant work.
    if (candidate && JSON.stringify(_blRowsFromCandidate(_blDrag.baseline, _blDrag.id, candidate, _blDrag.originalRows)) === _blDrag.originalRowsJSON) {
        candidate = null;
    }

    _blDrag.candidate = candidate;

    if (candidate) _blShowIndicator(targetBox, candidate, _blDrag.baseline);
    else _blHideIndicator();
}

function _blOnDragEnd() {
    if (!_blDrag) return;
    document.removeEventListener('mousemove', _blOnDragMove);
    document.removeEventListener('mouseup', _blOnDragEnd);
    if (_blDrag.tiltRAF) cancelAnimationFrame(_blDrag.tiltRAF);

    var favBox = _favSlotEl();
    if (favBox) favBox.classList.remove('bl-fav-drop-target');

    // Dropped on the Favorite slot — same _favAdd used by clicking a
    // widget's own star badge (paging/eviction/jump-to-new-page all
    // included), just reached by dragging onto the slot instead. Skips
    // the whole reorder path below entirely; the widget stays exactly
    // where it was on the board (favoriting doesn't remove it from
    // there, same as the star-click path).
    if (_blDrag.overFav) {
        var favId = _blDrag.id;
        _blDrag.sourceBox.classList.remove('bl-dragging-source');
        _blDrag.ghost.remove();
        document.body.classList.remove('bl-drag-active');
        _blDrag = null;
        _favAdd(favId);
        return;
    }

    var finalRows = _blRowsFromCandidate(_blDrag.baseline, _blDrag.id, _blDrag.candidate, _blDrag.originalRows) || _blGetRows();
    var droppedId = _blDrag.id;

    // The other 4 boxes haven't moved all drag long, so their current
    // rects are the correct FLIP starting point — they slide into their
    // new spots. The dropped box itself doesn't: sliding it in from the
    // ghost's floating position read as sliding weirdly, so it instead
    // gets a quick scale-bounce "landing" animation (see .bl-drop-land).
    var otherIds = _blPinnedIds().filter(function(x) { return x !== droppedId; });
    var oldRects = _blCaptureRects(otherIds);

    _blDrag.sourceBox.classList.remove('bl-dragging-source');
    _blDrag.ghost.remove();
    _blHideIndicator();

    _blSaveRows(finalRows);
    _blApplyLayout(finalRows);
    _blPlayFlip(otherIds, oldRects);

    var droppedBox = _blBoxEl(droppedId);
    if (droppedBox) {
        droppedBox.classList.remove('bl-drop-land');
        void droppedBox.offsetWidth; // force reflow so a rapid re-drop of the same box replays the animation
        droppedBox.classList.add('bl-drop-land');
        droppedBox.addEventListener('animationend', function handler() {
            droppedBox.classList.remove('bl-drop-land');
            droppedBox.removeEventListener('animationend', handler);
        });
    }

    document.body.classList.remove('bl-drag-active');
    _blDrag = null;
}

// ── FAVORITE SLOT (top group) ────────────────────────────────────────────────
// #sec-favorite is a fixed half-width slot up in the top group holding a
// sliding stack of up to FAV_MAX BL_CATALOG widgets, one per page,
// physically relocating each real .tool-body the same way Compact/Classic
// already share one (see _applyLayoutMode) rather than cloning anything.
// Defaults to a single Ease Copy page, which otherwise has no Compact home
// of its own. Starring a widget elsewhere pushes a new page onto the end of
// the stack and jumps to it; starring past FAV_MAX evicts the oldest page
// back to Bottom Layout to make room. Each page's own X does the same
// eviction manually — returns that widget to Bottom Layout as a new
// full-line row (see _blAddWidget) rather than leaving the user to re-add
// it. _favApplyLayout is the single place that reconciles _favGet()'s id
// list against the actual DOM (which pages exist, where each one's body
// currently lives) — re-run after every layout-mode switch and after the
// favorite list itself changes.
var FAV_KEY = 'lineup-favorite-widgets';
var FAV_MAX = 3;
var _favActiveIndex = 0;

function _favGet() {
    var raw;
    try { raw = localStorage.getItem(FAV_KEY); } catch(e) {}
    if (raw === null) return ['ease', 'vectortools']; // key never written -> first-run default (page 1, page 2)
    var ids;
    try { ids = JSON.parse(raw); } catch(e) {}
    if (!Array.isArray(ids)) return [];
    var out = [];
    ids.forEach(function(id) {
        if (BL_CATALOG_IDS.indexOf(id) !== -1 && out.indexOf(id) === -1) out.push(id);
    });
    return out.slice(0, FAV_MAX);
}

function _favSave(ids) {
    _editRecordUndoPoint();
    try { localStorage.setItem(FAV_KEY, JSON.stringify(ids)); } catch(e) {}
}

function _favSlotEl()  { return document.getElementById('sec-favorite'); }
function _favTrackEl() { return document.getElementById('favPagesTrack'); }
function _favDotsEl()  { return document.getElementById('favDots'); }

function _favBuildPage(id) {
    var page = document.createElement('div');
    page.className = 'fav-page';
    page.setAttribute('data-fav-id', id);

    // A cloned copy of the widget's own collapse icon (mask-safe — see
    // _qaCloneCatalogTile) so this page can show it during board-editing,
    // same as every other Bottom Layout widget — the original stays behind
    // in the widget's home box, which .tool-body physically leaves.
    var homeBox = _blBoxEl(id);
    var iconSrc = homeBox && homeBox.querySelector('.qa-collapse-icon');
    if (iconSrc) page.appendChild(_qaCloneCatalogTile(iconSrc));

    var badge = document.createElement('button');
    badge.type = 'button';
    badge.className = 'bl-widget-remove';
    badge.title = 'Remove from favorites';
    badge.innerHTML = '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><line x1="4.8" y1="4.8" x2="9.2" y2="9.2"/><line x1="9.2" y1="4.8" x2="4.8" y2="9.2"/></svg>';
    badge.addEventListener('mousedown', function(e) { e.stopPropagation(); });
    badge.addEventListener('click', function(e) {
        e.stopPropagation();
        _favRemoveId(id);
    });
    page.appendChild(badge);
    return page;
}

function _favRenderDots(count) {
    var dots = _favDotsEl();
    if (!dots) return;
    dots.innerHTML = '';
    dots.classList.toggle('fav-dots-hidden', count <= 1);
    for (var i = 0; i < count; i++) {
        var dot = document.createElement('button');
        dot.type = 'button';
        dot.className = 'fav-dot' + (i === _favActiveIndex ? ' active' : '');
        dot.title = 'Page ' + (i + 1);
        (function(idx) {
            dot.addEventListener('click', function() {
                _favLastManualNavAt = Date.now();
                _favGoToPage(idx);
            });
        })(i);
        dots.appendChild(dot);
    }
}

function _favUpdateTrackPosition() {
    var track = _favTrackEl();
    if (track) track.style.transform = 'translateX(-' + (_favActiveIndex * 100) + '%)';
}

function _favGoToPage(index) {
    var count = _favGet().length;
    if (!count) return;
    _favActiveIndex = Math.max(0, Math.min(index, count - 1));
    _favUpdateTrackPosition();
    var dots = _favDotsEl();
    if (dots) {
        Array.prototype.forEach.call(dots.children, function(dot, i) {
            dot.classList.toggle('active', i === _favActiveIndex);
        });
    }
}

// ── Smart Stack polling ──────────────────────────────────────────────────────
// Predictive, not automatic: jumps the Favorites bar to a page at the MOMENT
// its trigger condition newly becomes true (an edge — selection going from
// none to some), not continuously while it stays true. Selecting a shape,
// then leaving it selected while manually swiping to another page, doesn't
// keep dragging you back — only a fresh selection change does that. Two
// current triggers, deliberately not generalized into a table since there
// are only two and each has its own host.jsx call:
//   - Ease Copy ('ease'): a keyframe gets selected (lineup_hasSelectedKeyframes).
//   - Shape Tools ('vectortools'): a shape layer gets selected (lineup_hasSelectedShapeLayer).
// If both edges land on the very same tick (e.g. a selection that includes
// both a shape layer and pre-existing selected keyframes), Ease Copy wins —
// it's checked first below regardless of whether the shape edge also fired.
var _favSmartPrevKeyframes = false;
var _favSmartPrevShapeSel  = false;
var _favSmartWasVisible    = false;
var _favLastManualNavAt    = 0;
var FAV_SMART_STACK_SUPPRESS_MS = 4000; // a manual dot-click/swipe wins for this long before auto-switch can act again

function _pollFavSmartStack() {
    if (!_smartStackEnabled) { _favSmartWasVisible = false; return; }
    var favBox = _favSlotEl();
    var visible = !!(favBox && favBox.offsetParent) && !favBox.classList.contains('fav-empty');
    if (!visible) { _favSmartWasVisible = false; return; }

    var ids = _favGet();
    var easeIdx = ids.indexOf('ease');
    var shapesIdx = ids.indexOf('vectortools');
    var wantEase = easeIdx !== -1;
    var wantShapes = shapesIdx !== -1;
    if (!wantEase && !wantShapes) { _favSmartWasVisible = false; return; }

    // First tick since the bar (re)appeared — calibrate prev-state from
    // whatever's true right now instead of treating it as a fresh edge, so
    // returning to the bar (or re-enabling the setting) never misfires off
    // a selection that was already sitting there before this started
    // watching again.
    var justBecameVisible = !_favSmartWasVisible;
    _favSmartWasVisible = true;

    var pending = 0, keyframesNow = false, shapeSelNow = false;
    var settle = function() {
        pending--;
        if (pending > 0) return;

        if (justBecameVisible) {
            _favSmartPrevKeyframes = keyframesNow;
            _favSmartPrevShapeSel = shapeSelNow;
            return;
        }

        var keyEdge = wantEase && keyframesNow && !_favSmartPrevKeyframes;
        var shapeEdge = wantShapes && shapeSelNow && !_favSmartPrevShapeSel;
        _favSmartPrevKeyframes = keyframesNow;
        _favSmartPrevShapeSel = shapeSelNow;

        if (Date.now() - _favLastManualNavAt < FAV_SMART_STACK_SUPPRESS_MS) return;

        // Ease Copy wins a simultaneous tie (both edges landing on the same
        // tick) — keyEdge is checked first below regardless of shapeEdge.
        if (keyEdge && easeIdx !== _favActiveIndex) _favGoToPage(easeIdx);
        else if (shapeEdge && shapesIdx !== _favActiveIndex) _favGoToPage(shapesIdx);
    };

    if (wantEase) {
        pending++;
        cs.evalScript('lineup_hasSelectedKeyframes()', function(result) {
            keyframesNow = result === '1';
            settle();
        });
    }
    if (wantShapes) {
        pending++;
        cs.evalScript('lineup_hasSelectedShapeLayer()', function(result) {
            shapeSelNow = result === '1';
            settle();
        });
    }
}

// Reconciles _favGet()'s id list against the DOM: drops pages for ids no
// longer favorited (sending their real content home first), builds/
// relocates pages for every currently-favorited id, and re-syncs the dots,
// track position, and Bottom Layout's pinned state to match.
function _favApplyLayout() {
    var favBox = _favSlotEl();
    var track = _favTrackEl();
    if (!favBox || !track) return;
    var ids = _favGet();

    Array.prototype.slice.call(track.querySelectorAll('.fav-page')).forEach(function(page) {
        var pid = page.getAttribute('data-fav-id');
        if (ids.indexOf(pid) === -1) {
            var body = page.querySelector('.tool-body');
            var home = _blBoxEl(pid);
            if (body && home) home.appendChild(body);
            page.remove();
        }
    });

    ids.forEach(function(id) {
        var page = track.querySelector('.fav-page[data-fav-id="' + id + '"]');
        if (!page) page = _favBuildPage(id);
        var homeBox = _blBoxEl(id);
        var body = homeBox && homeBox.querySelector('.tool-body');
        if (body && body.parentElement !== page) page.appendChild(body);
        track.appendChild(page); // (re-)appends in id order, so DOM order always matches
    });

    favBox.classList.toggle('fav-empty', ids.length === 0);
    _favActiveIndex = ids.length ? Math.max(0, Math.min(_favActiveIndex, ids.length - 1)) : 0;
    _favRenderDots(ids.length);
    _favUpdateTrackPosition();

    // Can't be favorited AND pinned in Bottom Layout at the same time —
    // its real content just moved up here.
    var rows = _blGetRows();
    var pinnedIds = _blPinnedIds();
    var needsSave = false;
    ids.forEach(function(id) {
        if (pinnedIds.indexOf(id) !== -1) {
            rows = _blRemoveFromRows(rows, id);
            needsSave = true;
        }
    });
    if (needsSave) _blSaveRows(rows);
    _blApplyLayout();
}

function _favPlayLand() {
    var track = _favTrackEl();
    var page = track && track.children[_favActiveIndex];
    if (!page) return;
    page.classList.remove('bl-drop-land');
    void page.offsetWidth; // force reflow so back-to-back adds each replay the animation
    page.classList.add('bl-drop-land');
    page.addEventListener('animationend', function handler() {
        page.classList.remove('bl-drop-land');
        page.removeEventListener('animationend', handler);
    });
}

// Pushes a new favorite onto the end of the stack and jumps to it. Past
// FAV_MAX, the oldest page is evicted first — sent back to Bottom Layout as
// a new full-line row (see _blAddWidget), same as manual removal below.
function _favAdd(id) {
    if (BL_CATALOG_IDS.indexOf(id) === -1) return;
    var ids = _favGet();
    if (ids.indexOf(id) !== -1) return;
    var evicted = null;
    if (ids.length >= FAV_MAX) evicted = ids.shift();
    ids.push(id);
    _favSave(ids);
    _favActiveIndex = ids.length - 1;
    _favApplyLayout();
    if (evicted) _blAddWidget(evicted);
    _favPlayLand();
}

// A page's own X — un-favorites just that one and returns it to Bottom
// Layout as a new full-line row instead of leaving it unpinned/delisted.
function _favRemoveId(id) {
    var ids = _favGet().filter(function(x) { return x !== id; });
    _favSave(ids);
    _favActiveIndex = ids.length ? Math.min(_favActiveIndex, ids.length - 1) : 0;
    _favApplyLayout();
    _blAddWidget(id);
}

// Wires up EVERY catalog id, not just currently-pinned ones — a box that's
// unpinned (hidden) right now still needs to be drag-ready the moment
// it's added back in, and this only ever runs once, at page load.
function _blInitControls() {
    BL_CATALOG_IDS.forEach(function(id) {
        var box = _blBoxEl(id);
        if (!box) return;
        box.classList.add('bl-draggable');
        // Every other widget collapses to icon-only (inert) while editing,
        // so the whole box can safely be the drag surface. Quick Actions
        // bars stay fully interactive instead (you need to click their
        // tiles/add-tile/remove-badges), so for those specifically a drag
        // can only start from the dedicated .bl-drag-handle — otherwise
        // every click anywhere on the widget picked it up instead of
        // reaching whatever was actually clicked.
        var isQa = box.classList.contains('tool-box-quick-actions');
        box.addEventListener('mousedown', function(e) {
            if (!_editMode || e.button !== 0) return;
            if (isQa && !e.target.closest('.bl-drag-handle')) return;
            e.preventDefault();
            _blStartDrag(id, e.clientX, e.clientY);
        });
    });
    _blInitRemoveBadges();
    _blInitFavBadges();
}

// ── Bottom Layout add/remove — same X-badge / empty "+" tile pattern as
// Quick Actions, scaled up to whole widgets instead of icon tiles. ────────────

// One badge per catalog box, injected once at load (harmless on a
// currently-unpinned/hidden box — it just sits inert until that widget is
// pinned and board-editing is on).
function _blInitRemoveBadges() {
    BL_CATALOG_IDS.forEach(function(id) {
        var box = _blBoxEl(id);
        if (!box || box.querySelector('.bl-widget-remove')) return;
        var badge = document.createElement('button');
        badge.type = 'button';
        badge.className = 'bl-widget-remove';
        badge.title = 'Remove this widget';
        badge.innerHTML = '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><line x1="4.8" y1="4.8" x2="9.2" y2="9.2"/><line x1="9.2" y1="4.8" x2="4.8" y2="9.2"/></svg>';
        // Stops the box's own mousedown (drag-start) listener from firing —
        // without this, tapping the badge would also pick the box up.
        badge.addEventListener('mousedown', function(e) { e.stopPropagation(); });
        badge.addEventListener('click', function(e) {
            e.stopPropagation();
            _blRemoveWidget(id);
        });
        box.appendChild(badge);
    });
}

// Star badge, opposite corner from the remove-X — clicking it pushes that
// widget onto the Favorite slot's stack (see _favAdd), same one-badge-per-
// box injected-once pattern as the remove badges above.
function _blInitFavBadges() {
    BL_CATALOG_IDS.forEach(function(id) {
        var box = _blBoxEl(id);
        if (!box || box.querySelector('.bl-widget-fav')) return;
        var badge = document.createElement('button');
        badge.type = 'button';
        badge.className = 'bl-widget-fav';
        badge.title = 'Add to favorites';
        badge.innerHTML = '<svg viewBox="0 0 14 14" fill="currentColor"><polygon points="7,1.3 8.7,4.9 12.6,5.4 9.8,8 10.5,11.9 7,10 3.5,11.9 4.2,8 1.4,5.4 5.3,4.9"/></svg>';
        badge.addEventListener('mousedown', function(e) { e.stopPropagation(); });
        badge.addEventListener('click', function(e) {
            e.stopPropagation();
            _favAdd(id);
        });
        box.appendChild(badge);
    });
}

// Unpins a widget and FLIPs the remaining pinned ones into their newly
// packed positions — mirrors the drag-drop settle, just triggered by a
// click instead of a drop.
function _blRemoveWidget(id) {
    var beforeIds = _blPinnedIds().filter(function(x) { return x !== id; });
    var oldRects = _blCaptureRects(beforeIds);

    _blSaveRows(_blRemoveFromRows(_blGetRows(), id));
    _blApplyLayout();
    _blPlayFlip(beforeIds, oldRects);
}

// Pins a widget as its own new full-line row at the end, FLIPping the
// already-pinned ones aside and giving the new box the same "landing"
// bounce a drag-drop gets (see .bl-drop-land).
function _blAddWidget(id) {
    var beforeIds = _blPinnedIds();
    var oldRects = _blCaptureRects(beforeIds);

    var rows = _blGetRows();
    rows.push([id]);
    _blSaveRows(rows);
    _blCloseAddPopover();

    _blApplyLayout(rows);
    _blPlayFlip(beforeIds, oldRects);

    var newBox = _blBoxEl(id);
    if (newBox) {
        newBox.classList.remove('bl-drop-land');
        void newBox.offsetWidth; // force reflow so back-to-back adds each replay the animation
        newBox.classList.add('bl-drop-land');
        newBox.addEventListener('animationend', function handler() {
            newBox.classList.remove('bl-drop-land');
            newBox.removeEventListener('animationend', handler);
        });
    }
}

// The dashed "+" affordance — a single full-width row appended after every
// pinned widget, shown only while editing and only when there's actually
// something left to add. Reused (not rebuilt) across renders, just
// inserted/removed from the grid as needed.
var _blAddRowEl = null;

function _blRenderAddRow() {
    var grid = document.getElementById('homeGrid');
    if (!grid) return;
    if (!_blAddRowEl) {
        _blAddRowEl = document.createElement('button');
        _blAddRowEl.type = 'button';
        _blAddRowEl.className = 'tool-box bl-add-row';
        _blAddRowEl.title = 'Add a widget';
        _blAddRowEl.innerHTML = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><line x1="10" y1="4" x2="10" y2="16"/><line x1="4" y1="10" x2="16" y2="10"/></svg>';
        _blAddRowEl.setAttribute('data-span', '6');
        _blAddRowEl.setAttribute('data-rowspan', '1');
        _blAddRowEl.addEventListener('mousedown', function(e) { e.stopPropagation(); }); // never a drag source
        _blAddRowEl.addEventListener('click', function() { _blOpenAddPopover(_blAddRowEl); });
    }
    var show = _editMode && _blAvailableIds().length > 0;
    if (!show) {
        if (_blAddRowEl.parentElement) _blAddRowEl.parentElement.removeChild(_blAddRowEl);
        return;
    }
    grid.appendChild(_blAddRowEl); // _blApplyLayout has already placed every pinned box before this runs, so this always lands last
}

// ── Add-widget popover — same search + scrollable grid pattern as Quick
// Actions' own (.qa-add-popover etc., reused directly for a consistent
// look), but listing whole BL_CATALOG entries instead of Tools-tab tiles.
// Kept as separate state/DOM from Quick Actions' popover since the two
// list entirely different kinds of things.

var _blPopover      = null;
var _blPopoverInput = null;
var _blPopoverGrid  = null;

function _blBuildPopover() {
    var el = document.createElement('div');
    el.className = 'qa-add-popover';

    var searchRow = document.createElement('div');
    searchRow.className = 'qa-add-search-row';
    var icon = document.createElement('span');
    icon.className = 'qa-add-search-icon';
    icon.innerHTML = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="8.5" cy="8.5" r="6"/><line x1="13" y1="13" x2="17.5" y2="17.5"/></svg>';
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'qa-add-search-input';
    input.placeholder = 'Search…';
    input.addEventListener('input', _blFilterPopover);
    searchRow.appendChild(icon);
    searchRow.appendChild(input);
    el.appendChild(searchRow);

    var grid = document.createElement('div');
    grid.className = 'qa-add-grid';
    el.appendChild(grid);

    document.body.appendChild(el);
    _blPopoverInput = input;
    _blPopoverGrid  = grid;
    return el;
}

function _blFilterPopover() {
    var q = _blPopoverInput.value.trim().toLowerCase();
    var tiles = _blPopoverGrid.querySelectorAll('.qa-add-tile');
    for (var i = 0; i < tiles.length; i++) {
        var title = (tiles[i].getAttribute('title') || '').toLowerCase();
        tiles[i].classList.toggle('qa-add-tile-hidden', q.length > 0 && title.indexOf(q) === -1);
    }
}

// Each tile shows the catalog entry's own icon — cloned straight off its
// box's .qa-collapse-icon, so it can never drift out of sync with what the
// widget actually looks like once pinned — plus its label.
function _blBuildCatalogTile(entry) {
    var tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'qa-add-tile';
    tile.title = entry.label;

    var box = _blBoxEl(entry.id);
    var iconSrc = box && box.querySelector('.qa-collapse-icon');
    if (iconSrc) {
        // Reuses _qaCloneCatalogTile purely for its mask-id-renaming logic
        // (generic, not actually Quick-Actions-specific) — Spell Check's
        // icon has an internal <mask id>, and cloning it verbatim would
        // collide with the original still sitting in the DOM.
        var icon = _qaCloneCatalogTile(iconSrc);
        icon.classList.remove('qa-collapse-icon');
        icon.removeAttribute('style'); // drop its collapsed-state opacity:0/centering, irrelevant here
        tile.appendChild(icon);
    }
    var lbl = document.createElement('span');
    lbl.textContent = entry.label;
    tile.appendChild(lbl);

    tile.onclick = function() { _blAddWidget(entry.id); };
    return tile;
}

function _blOpenAddPopover(anchorEl) {
    if (!_blPopover) _blPopover = _blBuildPopover();

    _blPopoverGrid.innerHTML = '';
    var available = _blAvailableIds();
    BL_CATALOG.forEach(function(entry) {
        if (available.indexOf(entry.id) === -1) return;
        _blPopoverGrid.appendChild(_blBuildCatalogTile(entry));
    });
    if (_blPopoverInput) _blPopoverInput.value = '';

    var rect = anchorEl.getBoundingClientRect();
    var vw = window.innerWidth, vh = window.innerHeight;
    var pw = 220, ph = 230;
    _blPopover.style.left = Math.max(4, Math.min(rect.left, vw - pw - 4)) + 'px';
    _blPopover.style.top  = Math.min(rect.bottom + 4, vh - ph - 4) + 'px';
    _blPopover.classList.add('visible');
    if (_blPopoverInput) _blPopoverInput.focus();

    setTimeout(function() {
        document.addEventListener('mousedown', _blPopoverOutside);
        document.addEventListener('keydown', _blPopoverKey);
    }, 0);
}

function _blCloseAddPopover() {
    if (_blPopover) _blPopover.classList.remove('visible');
    document.removeEventListener('mousedown', _blPopoverOutside);
    document.removeEventListener('keydown', _blPopoverKey);
}

function _blPopoverOutside(e) {
    if (_blPopover && !_blPopover.contains(e.target) && !e.target.closest('.bl-add-row')) {
        _blCloseAddPopover();
    }
}

function _blPopoverKey(e) {
    if (e.key === 'Escape') _blCloseAddPopover();
}

// ── ORGANIZE ──────────────────────────────────────────────────────────────────

function doDecompose() {
    run('lineup_decompose()');
}

function doDuplicateCompDeep() {
    run('lineup_duplicateCompDeep()', function(result) {
        showToast(result, 'info');
    });
}

function doConsolidateProject() {
    run('lineup_organizeProject()', function(result) {
        showToast(result, 'info');
    });
}

function doLinkPropertyToController() {
    var offset = chkVal('linkOffsetCheck');
    run('lineup_linkPropertyToController(' + offset + ')', function(result) {
        showToast(result, 'info');
    });
}

// ── Project Structure ───────────────────────────────────────────────────────────

var _structNodeSeq       = 0;
var _structPresets       = [];   // persisted
var _structActiveIdx     = 0;
var _structEditPresets   = [];   // working copy, edited while the modal is open — discarded on Cancel
var _structEditActiveIdx = 0;
var _structCollapsed     = {};   // nodeId -> true, reset each time the modal opens

var _STRUCT_FOLDER_SVG = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2,5.5 a1,1 0 0,1 1,-1 H7 L8.5,6 H17 a1,1 0 0,1 1,1 V15 a1,1 0 0,1 -1,1 H3 a1,1 0 0,1 -1,-1 Z"/></svg>';
var _STRUCT_PLUS_SVG   = '<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="5" y1="1.5" x2="5" y2="8.5"/><line x1="1.5" y1="5" x2="8.5" y2="5"/></svg>';
var _STRUCT_X_SVG      = '<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><line x1="1.5" y1="1.5" x2="8.5" y2="8.5"/><line x1="8.5" y1="1.5" x2="1.5" y2="8.5"/></svg>';
var _STRUCT_TRASH_SVG  = '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><polyline points="3,5 4.5,12 9.5,12 11,5"/><line x1="2" y1="4" x2="12" y2="4"/><line x1="5.5" y1="4" x2="5.5" y2="2.5"/><line x1="8.5" y1="4" x2="8.5" y2="2.5"/><line x1="5.5" y1="2.5" x2="8.5" y2="2.5"/></svg>';
var _STRUCT_GRIP_SVG   = '<svg viewBox="0 0 8 12" fill="currentColor"><circle cx="2" cy="1.5" r="1"/><circle cx="6" cy="1.5" r="1"/><circle cx="2" cy="6" r="1"/><circle cx="6" cy="6" r="1"/><circle cx="2" cy="10.5" r="1"/><circle cx="6" cy="10.5" r="1"/></svg>';
var _STRUCT_CHEV_SVG   = '<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="2.5,3.5 5,6.5 7.5,3.5"/></svg>';

// role is optional metadata carried on built-in Heist nodes so the host-side
// sorter can still find e.g. "the PSD folder" after the user renames it —
// custom folders (role: null) fall back to name-based matching in host.jsx.
function _structMakeNode(name, role, children) {
    return { id: 'n' + (_structNodeSeq++), name: name, role: role || null, children: children || [] };
}

function _structHeistTree() {
    return [
        _structMakeNode('1.COMPS', null, [
            _structMakeNode('1.MASTER', null),
            _structMakeNode('2.BUILD', null),
            _structMakeNode('3.PRECOMPS', 'precomps')
        ]),
        _structMakeNode('2.ASSETS', null, [
            _structMakeNode('3D_RENDERS', null),
            _structMakeNode('AE_RENDERS', null),
            _structMakeNode('ARTWORK', null, [
                _structMakeNode('AI', 'ai'),
                _structMakeNode('PSD', 'psd')
            ]),
            _structMakeNode('AUDIO', 'audio'),
            _structMakeNode('FOOTAGE', 'footage'),
            _structMakeNode('IMAGES', 'images')
        ]),
        _structMakeNode('3.IMPORTED', null, [
            _structMakeNode('AE_PROJECTS', 'imported'),
            _structMakeNode('C4D_SCENES', 'c4d')
        ]),
        _structMakeNode('4.REFERENCES', null, [
            _structMakeNode('BOARDS', null),
            _structMakeNode('OFFLINES', null),
            _structMakeNode('STYLEFRAMES', null)
        ])
    ];
}

function _structHeistPreset() { return { name: 'Heist', tree: _structHeistTree() }; }

function _structCloneTree(nodes) {
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
        out.push({ id: nodes[i].id, name: nodes[i].name, role: nodes[i].role, children: _structCloneTree(nodes[i].children || []) });
    }
    return out;
}

function _structClonePresets(presets) {
    var out = [];
    for (var i = 0; i < presets.length; i++) out.push({ name: presets[i].name, tree: _structCloneTree(presets[i].tree) });
    return out;
}

// Persisted node ids restart from 0 each session — seed the counter past
// whatever's already saved so newly-added nodes can't collide with them.
function _structSeedSeq() {
    var max = 0;
    function walk(nodes) {
        for (var i = 0; i < nodes.length; i++) {
            var m = /^n(\d+)$/.exec(nodes[i].id);
            if (m) { var n = parseInt(m[1], 10); if (n > max) max = n; }
            walk(nodes[i].children || []);
        }
    }
    for (var i = 0; i < _structPresets.length; i++) walk(_structPresets[i].tree);
    _structNodeSeq = max + 1;
}

function _loadStructPresets() {
    var raw = null;
    try { raw = localStorage.getItem('lineup-structure-presets'); } catch(e) {}
    var parsed = null;
    if (raw) { try { parsed = JSON.parse(raw); } catch(e) {} }
    if (parsed && parsed.presets && parsed.presets.length) {
        _structPresets   = parsed.presets;
        _structActiveIdx = (typeof parsed.activeIndex === 'number' && parsed.activeIndex < _structPresets.length) ? parsed.activeIndex : 0;
    } else {
        _structPresets   = [_structHeistPreset()];
        _structActiveIdx = 0;
    }
    _structSeedSeq();
}

function _saveStructPresets() {
    try {
        localStorage.setItem('lineup-structure-presets', JSON.stringify({ presets: _structPresets, activeIndex: _structActiveIdx }));
    } catch(e) {}
}

function openProjectStructure() {
    if (!_structPresets.length) _loadStructPresets();
    _structEditPresets   = _structClonePresets(_structPresets);
    _structEditActiveIdx = Math.min(_structActiveIdx, _structEditPresets.length - 1);
    _structCollapsed      = {};
    var brk = document.getElementById('structBreakCheck');
    if (brk) { try { brk.checked = localStorage.getItem('lineup-break-structure') === '1'; } catch(e) {} }
    _structRenderTabs();
    _structRenderTree();
    document.getElementById('structOverlay').classList.remove('struct-hidden');
}

function closeProjectStructure() {
    var el = document.getElementById('structOverlay');
    if (el) el.classList.add('struct-hidden');
}

function _structRenderTabs() {
    var bar = document.getElementById('structTabs');
    if (!bar) return;
    bar.innerHTML = '';
    for (var i = 0; i < _structEditPresets.length; i++) {
        (function(idx) {
            var preset = _structEditPresets[idx];
            var tab = document.createElement('button');
            tab.type = 'button';
            tab.className = 'struct-tab' + (idx === _structEditActiveIdx ? ' active' : '');

            var lbl = document.createElement('span');
            lbl.className = 'struct-tab-lbl';
            lbl.textContent = preset.name;
            lbl.title = preset.name + ' (double-click to rename)';
            tab.appendChild(lbl);

            var del = document.createElement('span');
            del.className = 'struct-tab-del';
            del.title = 'Delete preset';
            del.innerHTML = _STRUCT_X_SVG;
            tab.appendChild(del);

            tab.addEventListener('click', function(e) {
                if (e.target === del || del.contains(e.target)) return;
                _structEditActiveIdx = idx;
                _structRenderTabs();
                _structRenderTree();
            });
            del.addEventListener('click', function(e) {
                e.stopPropagation();
                _structDeleteTab(idx);
            });
            lbl.addEventListener('dblclick', function(e) {
                e.stopPropagation();
                _structRenameTabStart(idx, lbl);
            });

            bar.appendChild(tab);
        })(i);
    }

    var add = document.createElement('button');
    add.type = 'button';
    add.className = 'struct-tab-add';
    add.title = 'Add preset';
    add.innerHTML = _STRUCT_PLUS_SVG;
    add.addEventListener('click', _structAddPreset);
    bar.appendChild(add);
}

function _structRenameTabStart(idx, lblEl) {
    var preset = _structEditPresets[idx];
    if (!preset) return;
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'struct-tab-lbl-input';
    input.value = preset.name;
    lblEl.parentNode.replaceChild(input, lblEl);
    input.focus();
    input.select();
    function commit() {
        var v = input.value.replace(/^\s+|\s+$/g, '');
        preset.name = v || preset.name;
        _structRenderTabs();
        _structRenderTree();
    }
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        else if (e.key === 'Escape') { e.preventDefault(); input.value = preset.name; input.blur(); }
    });
    input.addEventListener('click', function(e) { e.stopPropagation(); });
}

function _structDeleteTab(idx) {
    _structEditPresets.splice(idx, 1);
    if (_structEditPresets.length === 0) {
        _structEditPresets.push(_structHeistPreset());
        _structEditActiveIdx = 0;
    } else if (idx < _structEditActiveIdx) {
        _structEditActiveIdx--;
    } else if (_structEditActiveIdx >= _structEditPresets.length) {
        _structEditActiveIdx = _structEditPresets.length - 1;
    }
    _structRenderTabs();
    _structRenderTree();
}

function _structUniqueName(base, names) {
    var name = base, n = 2;
    function taken(nm) { for (var i = 0; i < names.length; i++) if (names[i] === nm) return true; return false; }
    while (taken(name)) { name = base + ' ' + n; n++; }
    return name;
}

function _structAddPreset() {
    var names = [];
    for (var i = 0; i < _structEditPresets.length; i++) names.push(_structEditPresets[i].name);
    var preset = { name: _structUniqueName('New Structure', names), tree: [] };
    _structEditPresets.push(preset);
    _structEditActiveIdx = _structEditPresets.length - 1;
    _structRenderTabs();
    _structRenderTree();
    var lbl = document.querySelector('#structTabs .struct-tab.active .struct-tab-lbl');
    if (lbl) _structRenameTabStart(_structEditActiveIdx, lbl);
}

function _structRenderTree() {
    var box = document.getElementById('structTreeBox');
    if (!box) return;
    box.innerHTML = '';
    var preset = _structEditPresets[_structEditActiveIdx];
    if (!preset || preset.tree.length === 0) {
        var empty = document.createElement('div');
        empty.className = 'struct-tree-empty';
        empty.textContent = 'No folders yet — click "+ Add Folder" below.';
        box.appendChild(empty);
        return;
    }
    _structRenderNodes(preset.tree, 0, box);
}

function _structRenderNodes(nodes, depth, container) {
    for (var i = 0; i < nodes.length; i++) {
        (function(node) {
            var hasKids = !!(node.children && node.children.length);

            var row = document.createElement('div');
            row.className = 'struct-node-row';
            row.setAttribute('data-node-id', node.id);
            row.style.marginLeft = (depth * 16) + 'px';

            var handle = document.createElement('span');
            handle.className = 'struct-node-handle';
            handle.title = 'Drag to reorder or nest inside another folder';
            handle.innerHTML = _STRUCT_GRIP_SVG;
            handle.addEventListener('mousedown', function(e) { _structStartDrag(node.id, e); });
            row.appendChild(handle);

            var chevron = document.createElement('span');
            chevron.className = 'struct-node-chevron' + (hasKids ? '' : ' struct-node-chevron-empty') + (_structCollapsed[node.id] ? ' collapsed' : '');
            if (hasKids) {
                chevron.innerHTML = _STRUCT_CHEV_SVG;
                chevron.title = _structCollapsed[node.id] ? 'Expand' : 'Collapse';
                chevron.addEventListener('click', function() {
                    _structCollapsed[node.id] = !_structCollapsed[node.id];
                    _structRenderTree();
                });
            }
            row.appendChild(chevron);

            var icon = document.createElement('span');
            icon.className = 'struct-node-icon';
            icon.innerHTML = _STRUCT_FOLDER_SVG;
            row.appendChild(icon);

            var lbl = document.createElement('span');
            lbl.className = 'struct-node-lbl';
            lbl.textContent = node.name;
            lbl.title = 'Click to rename';
            lbl.addEventListener('click', function() { _structRenameNodeStart(node.id, lbl); });
            row.appendChild(lbl);

            var spacer = document.createElement('span');
            spacer.className = 'struct-node-spacer';
            row.appendChild(spacer);

            var addBtn = document.createElement('button');
            addBtn.type = 'button';
            addBtn.className = 'struct-node-btn';
            addBtn.title = 'Add subfolder';
            addBtn.innerHTML = _STRUCT_PLUS_SVG;
            addBtn.addEventListener('click', function() { _structAddChildFolder(node.id); });
            row.appendChild(addBtn);

            var delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.className = 'struct-node-btn struct-node-del';
            delBtn.title = 'Delete folder';
            delBtn.innerHTML = _STRUCT_TRASH_SVG;
            delBtn.addEventListener('click', function() { _structDeleteNode(node.id); });
            row.appendChild(delBtn);

            container.appendChild(row);
            if (hasKids && !_structCollapsed[node.id]) {
                _structRenderNodes(node.children, depth + 1, container);
            }
        })(nodes[i]);
    }
}

function _structRenameNodeStart(nodeId, lblEl) {
    var found = _structFindNode(nodeId);
    if (!found) return;
    var node = found.node;
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'struct-node-lbl-input';
    input.value = node.name;
    lblEl.parentNode.replaceChild(input, lblEl);
    input.focus();
    input.select();
    function commit() {
        var v = input.value.replace(/^\s+|\s+$/g, '');
        node.name = v || node.name;
        _structRenderTree();
    }
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        else if (e.key === 'Escape') { e.preventDefault(); input.value = node.name; input.blur(); }
    });
}

function _structFindNode(nodeId) {
    var preset = _structEditPresets[_structEditActiveIdx];
    if (!preset) return null;
    function walk(nodes) {
        for (var i = 0; i < nodes.length; i++) {
            if (nodes[i].id === nodeId) return { node: nodes[i], parentArr: nodes, index: i };
            var r = walk(nodes[i].children || []);
            if (r) return r;
        }
        return null;
    }
    return walk(preset.tree);
}

function _structAddChildFolder(nodeId) {
    var found = _structFindNode(nodeId);
    if (!found) return;
    if (!found.node.children) found.node.children = [];
    var names = [];
    for (var i = 0; i < found.node.children.length; i++) names.push(found.node.children[i].name);
    var child = _structMakeNode(_structUniqueName('New Folder', names), null);
    found.node.children.push(child);
    _structRenderTree();
}

function _structAddRootFolder() {
    var preset = _structEditPresets[_structEditActiveIdx];
    if (!preset) return;
    var names = [];
    for (var i = 0; i < preset.tree.length; i++) names.push(preset.tree[i].name);
    var node = _structMakeNode(_structUniqueName('New Folder', names), null);
    preset.tree.push(node);
    _structRenderTree();
}

function _structDeleteNode(nodeId) {
    var found = _structFindNode(nodeId);
    if (!found) return;
    found.parentArr.splice(found.index, 1);
    _structRenderTree();
}

// True if candidateId is somewhere inside ancestorId's own subtree — used to
// block dropping a folder into itself or one of its own descendants.
function _structIsDescendant(candidateId, ancestorId) {
    var ancestor = _structFindNode(ancestorId);
    if (!ancestor) return false;
    function walk(nodes) {
        for (var i = 0; i < nodes.length; i++) {
            if (nodes[i].id === candidateId) return true;
            if (walk(nodes[i].children || [])) return true;
        }
        return false;
    }
    return walk(ancestor.node.children || []);
}

// Moves nodeId out of its current spot and before/after/into targetId. Looks
// targetId up fresh AFTER removing the dragged node so a same-parent reorder
// (where removal shifts sibling indices) still lands in the right place.
function _structMoveNode(nodeId, targetId, mode) {
    var src = _structFindNode(nodeId);
    if (!src) return;
    src.parentArr.splice(src.index, 1);
    var node = src.node;

    var target = _structFindNode(targetId);
    if (!target) { src.parentArr.splice(src.index, 0, node); return; }

    if (mode === 'into') {
        if (!target.node.children) target.node.children = [];
        target.node.children.push(node);
    } else {
        var insertAt = target.index + (mode === 'after' ? 1 : 0);
        target.parentArr.splice(insertAt, 0, node);
    }
    _structRenderTree();
}

function _structStartDrag(nodeId, startEvent) {
    startEvent.preventDefault();
    var box = document.getElementById('structTreeBox');
    if (!box) return;

    var rowEls = Array.prototype.slice.call(box.querySelectorAll('.struct-node-row'));
    var rows = [];
    for (var i = 0; i < rowEls.length; i++) {
        rows.push({ el: rowEls[i], id: rowEls[i].getAttribute('data-node-id'), rect: rowEls[i].getBoundingClientRect() });
    }

    var dragIdx = -1, draggedRow = null, draggedRect = null;
    for (var i = 0; i < rows.length; i++) if (rows[i].id === nodeId) { dragIdx = i; draggedRow = rows[i].el; draggedRect = rows[i].rect; }
    if (!draggedRow) return;
    var rowH = draggedRect.height;

    // Floating preview clone that tracks the cursor — same treatment as the
    // Settings section-reorder drag, so dragging a folder on top of another
    // one to nest it reads the same way that reorder does.
    var ghost = draggedRow.cloneNode(true);
    ghost.className = 'struct-node-row struct-node-ghost';
    ghost.style.cssText = [
        'position:fixed',
        'left:' + draggedRect.left + 'px',
        'top:'  + draggedRect.top  + 'px',
        'width:' + draggedRect.width + 'px',
        'margin-left:0',
        'pointer-events:none',
        'z-index:2000'
    ].join(';');
    document.body.appendChild(ghost);

    // Hide the original row in place — keeps its slot as a fixed gap that the
    // other rows slide around, same technique as the Settings section drag.
    draggedRow.style.visibility = 'hidden';

    var startY = startEvent.clientY, originTop = draggedRect.top;
    var lastTarget = null, lastMode = null;

    function clearShifts() {
        for (var i = 0; i < rows.length; i++) rows[i].el.style.transform = '';
    }

    // Only before/after (sibling reorder) opens a gap — "into" just highlights
    // the target row itself since nothing is being inserted between siblings.
    function applyShifts(insertIdx) {
        for (var i = 0; i < rows.length; i++) {
            if (i === dragIdx) continue;
            var dy = 0;
            if (insertIdx > dragIdx && i > dragIdx && i < insertIdx) dy = -rowH;
            if (insertIdx <= dragIdx && i >= insertIdx && i < dragIdx) dy = rowH;
            rows[i].el.style.transform = dy ? 'translateY(' + dy + 'px)' : '';
        }
    }

    function onMove(ev) {
        ghost.style.top = (originTop + ev.clientY - startY) + 'px';

        if (lastTarget) lastTarget.classList.remove('drag-over-before', 'drag-over-after', 'drag-over-into');
        lastTarget = null; lastMode = null;

        var targetIdx = -1, mode = null;
        for (var i = 0; i < rows.length; i++) {
            var r = rows[i].rect;
            if (ev.clientY < r.top || ev.clientY > r.bottom) continue;
            if (i === dragIdx || _structIsDescendant(rows[i].id, nodeId)) break;
            // Thin edges reorder as a sibling; the wide middle band nests the
            // dragged folder inside whatever row it's dropped on top of.
            var frac = (ev.clientY - r.top) / r.height;
            mode = frac < 0.2 ? 'before' : (frac > 0.8 ? 'after' : 'into');
            targetIdx = i;
            break;
        }

        if (targetIdx === -1) { clearShifts(); return; }

        rows[targetIdx].el.classList.add('drag-over-' + mode);
        lastTarget = rows[targetIdx].el; lastMode = mode;

        if (mode === 'into') clearShifts();
        else applyShifts(mode === 'after' ? targetIdx + 1 : targetIdx);
    }

    function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        var targetEl = lastTarget, mode = lastMode;
        if (lastTarget) lastTarget.classList.remove('drag-over-before', 'drag-over-after', 'drag-over-into');
        clearShifts();
        ghost.remove();
        draggedRow.style.visibility = '';
        if (targetEl && mode) {
            _structMoveNode(nodeId, targetEl.getAttribute('data-node-id'), mode);
        }
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
}

function _structRestoreDefault() {
    for (var i = 0; i < _structEditPresets.length; i++) {
        if (_structEditPresets[i].name === 'Heist') {
            _structEditPresets[i].tree = _structHeistTree();
            _structEditActiveIdx = i;
            _structRenderTabs();
            _structRenderTree();
            return;
        }
    }
    _structEditPresets.push(_structHeistPreset());
    _structEditActiveIdx = _structEditPresets.length - 1;
    _structRenderTabs();
    _structRenderTree();
}

function applyProjectStructure() {
    var preset = _structEditPresets[_structEditActiveIdx];
    if (!preset) return;
    var breakStructure = chkVal('structBreakCheck');

    _structPresets   = _structClonePresets(_structEditPresets);
    _structActiveIdx = _structEditActiveIdx;
    _saveStructPresets();
    try { localStorage.setItem('lineup-break-structure', breakStructure ? '1' : '0'); } catch(e) {}

    var treeJson = JSON.stringify(preset.tree);
    var escaped  = treeJson.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    closeProjectStructure();
    run("lineup_configureProjectStructure('" + escaped + "'," + breakStructure + ")", function(result) {
        showToast(result, 'info');
    });
}

// ── Panel scale ───────────────────────────────────────────────────────────────

// Bumped ~30% up from [0.65, 0.8, 0.95] — reads noticeably too small when
// actually tested at real size inside AE, not just in a browser preview.
// zoom scales the whole Home tab (Compact and Classic both live inside
// #panel-content) as one unit without disturbing any internal flex/grid
// proportions.
var SCALE_FACTORS = [0.85, 1.05, 1.25];

function applyScale(val) {
    var f = SCALE_FACTORS[Math.max(0, Math.min(2, val))];
    var content = document.getElementById('panel-content');
    if (content) content.style.zoom = String(f);

    // Overlay modals (Settings, Help, Batch Comp Settings, Batch Rename, Comp
    // Export) live outside #panel-content, so the zoom above doesn't reach them.
    // Scale each one with a CSS transform instead — transform doesn't affect
    // layout/spacing, just visually scales the box from its own center (the
    // overlay already centers it via flexbox).
    document.querySelectorAll('.settings-modal').forEach(function (m) {
        m.style.transform = 'scale(' + f + ')';
    });
}

function restoreScale() {
    var val = 1;
    try { var s = localStorage.getItem('lineup-scale'); if (s !== null) val = parseInt(s, 10); } catch(e) {}
    if (isNaN(val) || val < 0 || val > 2) val = 1;
    var slider = document.getElementById('scaleSlider');
    if (slider) slider.value = val;
    applyScale(val);
}

// ── Classic section order persistence ────────────────────────────────────────
// Ordering is independent per layout (Compact's own order lives in
// lineup-home-layout) — only hidden-state is shared between the two, via
// _commitHiddenBlockIds/_getHiddenBlockIds above.

function saveClassicOrder() {
    var sections = document.querySelectorAll('#homeClassic .section[data-block-id]');
    var order = [];
    sections.forEach(function(s) { order.push(s.getAttribute('data-block-id')); });
    try { localStorage.setItem('lineup-classic-order', JSON.stringify(order)); } catch(e) {}
}

function restoreClassicOrder() {
    var order;
    try { order = JSON.parse(localStorage.getItem('lineup-classic-order')); } catch(e) {}
    if (!order || !Array.isArray(order) || !order.length) return;
    var content = document.getElementById('homeClassic');
    if (!content) return;
    order.forEach(function(id) {
        var el = document.getElementById('cls-' + id);
        if (el) content.appendChild(el);
    });
}

// ── Classic Sections list (Settings tab) ─────────────────────────────────────
// Rebuilt fresh each time Classic becomes the active layout (or the Settings
// tab is opened while it's active) — the original settings page's own
// drag-to-reorder + toggle-to-hide list, just inline instead of a modal.

function _renderClassicSettingsList() {
    var list = document.getElementById('settingsSectionList');
    if (!list) return;
    var sections = document.querySelectorAll('#homeClassic .section[data-block-id]');

    list.innerHTML = '';
    var rows = [];
    sections.forEach(function(sec) {
        var row = buildSettingsRow(sec);
        if (!row) return;
        // Starts faded/scaled down inline (ahead of the class-driven
        // .settings-sec-row transition — see its own rule in style.css) so
        // each row can be released on its own staggered delay below,
        // instead of every row just popping in together.
        row.style.opacity = '0';
        row.style.transform = 'scale(0.92)';
        list.appendChild(row);
        rows.push(row);
    });
    rows.forEach(function(row, i) {
        setTimeout(function() {
            row.style.opacity = '';
            row.style.transform = '';
        }, i * 35);
    });

    initSettingsDrag();
}

// Always reopens on the grid page (page 1), search cleared — never resumes
// mid-group from whatever was open last time.
function openHelp() {
    document.getElementById('helpOverlay').classList.remove('help-hidden');
    var search = document.getElementById('helpSearchInput');
    if (search) search.value = '';
    _helpSearch('');
    _closeHelpGroup();
}

function closeHelp() {
    document.getElementById('helpOverlay').classList.add('help-hidden');
}

// Grid (page 1) <-> one group's own detail page (page 2+) — only one
// .help-page is ever .help-page-active at a time. Detail pages carry the
// exact same content each group always had; only the grid/pagination
// chrome around them is new.
function _openHelpGroup(id) {
    Array.prototype.forEach.call(document.querySelectorAll('#helpOverlay .help-page'), function(p) {
        p.classList.remove('help-page-active');
    });
    var detail = document.querySelector('.help-page-detail[data-help-group="' + id + '"]');
    if (detail) detail.classList.add('help-page-active');
    var body = document.querySelector('#helpOverlay .help-body');
    if (body) body.scrollTop = 0;
}
function _closeHelpGroup() {
    Array.prototype.forEach.call(document.querySelectorAll('#helpOverlay .help-page'), function(p) {
        p.classList.remove('help-page-active');
    });
    var grid = document.getElementById('helpPageGrid');
    if (grid) grid.classList.add('help-page-active');
}

// Searches every detail page's own .help-key/.help-desc text directly off
// the DOM (hidden pages still have their full text — no separate search
// index to keep in sync with the actual content) and lists matches as
// clickable rows, each jumping straight to its source group's detail page.
// Swaps the grid out for the results list while a query is active; clearing
// the box brings the grid back.
function _helpSearch(query) {
    query = query.trim().toLowerCase();
    var gridEl = document.getElementById('helpGrid');
    var resultsEl = document.getElementById('helpSearchResults');
    if (!gridEl || !resultsEl) return;
    if (!query) {
        gridEl.classList.remove('help-grid-hidden');
        resultsEl.classList.remove('visible');
        resultsEl.innerHTML = '';
        return;
    }
    gridEl.classList.add('help-grid-hidden');
    var html = '';
    var count = 0;
    Array.prototype.forEach.call(document.querySelectorAll('#helpOverlay .help-page-detail'), function(page) {
        var groupId = page.getAttribute('data-help-group');
        var titleEl = page.querySelector('.help-detail-title-text');
        var groupTitle = titleEl ? titleEl.textContent : '';
        Array.prototype.forEach.call(page.querySelectorAll('.help-item'), function(item) {
            var keyEl = item.querySelector('.help-key');
            var descEl = item.querySelector('.help-desc');
            var key = keyEl ? keyEl.textContent : '';
            var desc = descEl ? descEl.textContent : '';
            if ((groupTitle + ' ' + key + ' ' + desc).toLowerCase().indexOf(query) === -1) return;
            count++;
            html += '<button type="button" class="help-result" onclick="_openHelpGroup(\'' + groupId + '\')">' +
                '<span class="help-result-group">' + _helpEsc(groupTitle) + '</span>' +
                '<span class="help-result-key">' + _helpEsc(key) + '</span>' +
                '<span class="help-result-desc">' + _helpEsc(desc) + '</span>' +
                '</button>';
        });
    });
    resultsEl.innerHTML = count ? html : '<div class="help-result-empty">No matches for “' + _helpEsc(query) + '”</div>';
    resultsEl.classList.add('visible');
}
function _helpEsc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildSettingsRow(secEl) {
    var nameEl = secEl.querySelector('.sec-title');
    var iconEl = secEl.querySelector('.sec-icon');
    if (!nameEl || !iconEl) return null;

    var row = document.createElement('div');
    row.className = 'settings-sec-row';
    row.dataset.secId = secEl.id;

    // Drag handle — no draggable attr; mouse events handle everything
    var handle = document.createElement('span');
    handle.className = 'settings-drag-handle';
    handle.innerHTML = '<svg viewBox="0 0 8 12" fill="currentColor"><circle cx="2" cy="1.5" r="1"/><circle cx="6" cy="1.5" r="1"/><circle cx="2" cy="6" r="1"/><circle cx="6" cy="6" r="1"/><circle cx="2" cy="10.5" r="1"/><circle cx="6" cy="10.5" r="1"/></svg>';

    // Icon — clone from section header, swap CSS class for larger size
    var iconClone = iconEl.cloneNode(true);
    iconClone.classList.remove('sec-icon');
    iconClone.classList.add('settings-sec-icon');

    // Name
    var name = document.createElement('span');
    name.className = 'settings-sec-name';
    name.textContent = nameEl.textContent;

    // Toggle
    var label = document.createElement('label');
    label.className = 'settings-toggle';
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !secEl.classList.contains('sec-hidden');
    var track = document.createElement('span');
    track.className = 'toggle-track';
    label.appendChild(cb);
    label.appendChild(track);

    if (!cb.checked) row.classList.add('row-disabled');

    var blockId = secEl.getAttribute('data-block-id');
    cb.addEventListener('change', function() {
        row.classList.toggle('row-disabled', !cb.checked);
        // Hidden state is the one thing shared with Compact — route the
        // toggle through the shared commit instead of just this row's own
        // section, so Compact reflects it the moment you switch back.
        var ids = _getHiddenBlockIds();
        var idx = ids.indexOf(blockId);
        if (!cb.checked && idx === -1) ids.push(blockId);
        if (cb.checked && idx !== -1) ids.splice(idx, 1);
        _commitHiddenBlockIds(ids);
    });

    row.appendChild(handle);
    row.appendChild(iconClone);
    row.appendChild(name);
    row.appendChild(label);
    return row;
}

function applySettingsOrder() {
    var list    = document.getElementById('settingsSectionList');
    var rows    = list.querySelectorAll('.settings-sec-row');
    var content = document.getElementById('homeClassic');
    rows.forEach(function(row) {
        var sec = document.getElementById(row.dataset.secId);
        if (sec) content.appendChild(sec);
    });
    saveClassicOrder();
}

function initSettingsDrag() {
    var list = document.getElementById('settingsSectionList');

    list.querySelectorAll('.settings-drag-handle').forEach(function(handle) {
        handle.addEventListener('mousedown', function(e) {
            e.preventDefault();

            var row = handle.closest('.settings-sec-row');
            if (!row) return;

            var rowEls    = Array.from(list.querySelectorAll('.settings-sec-row'));
            var dragIdx   = rowEls.indexOf(row);
            var origRects = rowEls.map(function(r) { return r.getBoundingClientRect(); });
            var rowH      = origRects[dragIdx].height;
            var shiftAmt  = rowH + 4; // 4px matches CSS gap

            // Ghost — full row clone, X-locked, floats with cursor
            var rect  = origRects[dragIdx];
            var ghost = row.cloneNode(true);
            ghost.className = 'settings-sec-row settings-drag-ghost';
            ghost.style.cssText = [
                'position:fixed',
                'left:' + rect.left + 'px',
                'top:'  + rect.top  + 'px',
                'width:' + rect.width + 'px',
                'pointer-events:none',
                'z-index:2000'
            ].join(';');
            document.body.appendChild(ghost);

            // Hide original row in place (keeps layout slot)
            row.style.visibility = 'hidden';

            var startY    = e.clientY;
            var originTop = rect.top;

            // Given ghost center Y, return the DOM index to insert the row before
            function getInsertIdx(ghostCenterY) {
                var above = 0;
                for (var i = 0; i < rowEls.length; i++) {
                    if (i === dragIdx) continue;
                    if (ghostCenterY > origRects[i].top + origRects[i].height / 2) above++;
                }
                var c = 0;
                for (var i = 0; i < rowEls.length; i++) {
                    if (i === dragIdx) continue;
                    if (c++ === above) return i;
                }
                return rowEls.length;
            }

            // Slide other rows out of the way to show the live insertion point
            function applyShifts(insertIdx) {
                rowEls.forEach(function(r, i) {
                    if (i === dragIdx) return;
                    var dy = 0;
                    if (insertIdx > dragIdx  && i > dragIdx  && i < insertIdx) dy = -shiftAmt;
                    if (insertIdx <= dragIdx && i >= insertIdx && i < dragIdx)  dy =  shiftAmt;
                    r.style.transform = dy ? 'translateY(' + dy + 'px)' : '';
                });
            }

            function onMove(ev) {
                var top = originTop + ev.clientY - startY;
                ghost.style.top = top + 'px';
                applyShifts(getInsertIdx(top + rowH / 2));
            }

            function onUp(ev) {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                ghost.remove();

                var finalIdx = getInsertIdx(originTop + ev.clientY - startY + rowH / 2);

                // Instantly clear transforms before DOM reorder to avoid visual jump
                rowEls.forEach(function(r) { r.style.transition = 'none'; r.style.transform = ''; });
                void list.offsetHeight; // force reflow
                rowEls.forEach(function(r) { r.style.transition = ''; });

                row.style.visibility = '';

                if (finalIdx >= rowEls.length) {
                    list.appendChild(row);
                } else {
                    list.insertBefore(row, rowEls[finalIdx]);
                }
                applySettingsOrder();
            }

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    });
}

// ── Batch Comp Settings ─────────────────────────────────────────────────────────

var BCS_PAR_PRESETS = [1.0, 0.9090909090909091, 1.2121212121212122, 1.0936, 1.4581, 2.0];

var _bcsLocked      = true;
var _bcsLockedRatio = 1;
var _bcsWidthScrub  = null;
var _bcsHeightScrub = null;
var _bcsDurField    = null;
var _bcsStartField  = null;
var _bcsDirty       = false;
var _bcsCompNames   = []; // every comp selected when the panel was opened
var _bcsExcluded    = {}; // index (into _bcsCompNames) -> true, removed from the batch
var _bcsActiveTab   = 'settings'; // 'settings' | 'rename' — Batch Rename lives here as a second tab

function switchBcsTab(tab) {
    _bcsActiveTab = tab;
    document.querySelectorAll('.bcs-ui-tab').forEach(function (btn) {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    document.getElementById('bcsTabSettings').classList.toggle('active', tab === 'settings');
    document.getElementById('bcsTabRename').classList.toggle('active',   tab === 'rename');
}

function _bcsParIndexForValue(v) {
    var best = 0, bestDiff = Infinity;
    for (var i = 0; i < BCS_PAR_PRESETS.length; i++) {
        var diff = Math.abs(BCS_PAR_PRESETS[i] - v);
        if (diff < bestDiff) { bestDiff = diff; best = i; }
    }
    return best;
}

function _bcsCurrentFrameRate() {
    var f = parseFloat(document.getElementById('bcsFrInput').value);
    return (!isNaN(f) && f > 0) ? f : 30;
}

function _bcsFormatSeconds(sec) {
    return String(Math.round(sec * 100) / 100);
}

// Seconds ⟷ Frames field — canonical value is always seconds, converted through
// the Frame Rate field when the unit is switched to Frames.
function _bcsMakeSecondsField(inputId, unitId) {
    var input   = document.getElementById(inputId);
    var unitSel = document.getElementById(unitId);
    var prevMode = unitSel.value;

    function render(seconds) {
        input.value = (unitSel.value === '1')
            ? String(Math.round(seconds * _bcsCurrentFrameRate()))
            : _bcsFormatSeconds(seconds);
    }
    function getSeconds() {
        var v = parseFloat(input.value);
        if (isNaN(v)) return NaN;
        return (unitSel.value === '1') ? v / _bcsCurrentFrameRate() : v;
    }
    unitSel.addEventListener('change', function () {
        var seconds = (prevMode === '1')
            ? (function () { var f = parseFloat(input.value); return isNaN(f) ? 0 : f / _bcsCurrentFrameRate(); })()
            : (parseFloat(input.value) || 0);
        prevMode = unitSel.value;
        render(seconds);
    });
    return { render: render, getSeconds: getSeconds };
}

// Scrubbable number field, mimicking After Effects' blue scrub fields: click-drag
// left/right to change the value, or click without dragging to type an exact one.
function _bcsMakeScrub(el, opts) {
    opts = opts || {};
    var min      = (opts.min !== undefined) ? opts.min : 1;
    var onChange = opts.onChange || function () {};
    var dragging = false, moved = false, startX = 0, startVal = 0;

    function get() { var v = parseInt(el.textContent, 10); return isNaN(v) ? min : v; }
    function set(v, silent) {
        v = Math.max(min, Math.round(v));
        el.textContent = String(v);
        if (!silent) onChange(v);
        return v;
    }

    el.addEventListener('mousedown', function (e) {
        if (el.classList.contains('editing')) return;
        dragging = true; moved = false;
        startX   = e.clientX;
        startVal = get();
        el.classList.add('scrubbing');
        e.preventDefault();
    });

    window.addEventListener('mousemove', function (e) {
        if (!dragging) return;
        var dx = e.clientX - startX;
        if (Math.abs(dx) > 2) moved = true;
        if (!moved) return;
        var mult = e.shiftKey ? 10 : 1;
        set(startVal + Math.round(dx * mult));
    });

    window.addEventListener('mouseup', function () {
        if (!dragging) return;
        dragging = false;
        el.classList.remove('scrubbing');
        if (!moved) _bcsEnterEdit(el, get, set);
    });

    set(get(), true);
    return { get: get, set: set };
}

function _bcsEnterEdit(el, get, set) {
    el.classList.add('editing');
    var current = get();
    el.textContent = '';
    var input = document.createElement('input');
    input.type = 'text';
    input.value = current;
    el.appendChild(input);
    input.focus();
    input.select();

    function commit() {
        var v = parseFloat(input.value);
        el.classList.remove('editing');
        set(isNaN(v) ? current : v);
    }
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') input.blur();
        else if (e.key === 'Escape') { input.value = current; input.blur(); }
        e.stopPropagation();
    });
}

function _bcsBindEnable(checkId, ids) {
    var chk = document.getElementById(checkId);
    function sync() {
        ids.forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.disabled = !chk.checked;
        });
    }
    chk.addEventListener('change', sync);
    sync();
}

function _bcsBindRowEnable(checkId, rowEl) {
    var chk = document.getElementById(checkId);
    function sync() { rowEl.classList.toggle('dimmed', !chk.checked); }
    chk.addEventListener('change', sync);
    sync();
}

function _bcsOnWidthChange(w) {
    if (_bcsLocked) _bcsHeightScrub.set(Math.round(w / _bcsLockedRatio), true);
    _bcsUpdateLockTip();
    _bcsMarkDirty();
}
function _bcsOnHeightChange(h) {
    if (_bcsLocked) _bcsWidthScrub.set(Math.round(h * _bcsLockedRatio), true);
    _bcsUpdateLockTip();
    _bcsMarkDirty();
}

function _bcsUpdateLockTip() {
    var w = _bcsWidthScrub.get(), h = _bcsHeightScrub.get();
    var ratio = (h > 0) ? (Math.max(w, h) / Math.min(w, h)) : 1;
    document.getElementById('bcsLockBtn').title = 'Lock Aspect Ratio (1:' + ratio.toFixed(3) + ')';
}

function toggleBcsLock() {
    _bcsLocked = !_bcsLocked;
    if (_bcsLocked) _bcsLockedRatio = _bcsWidthScrub.get() / _bcsHeightScrub.get();
    document.getElementById('bcsLockBtn').classList.toggle('locked', _bcsLocked);
    _bcsUpdateLockTip();
}

// Apply lights up blue the moment anything in the panel is touched.
function _bcsMarkDirty() {
    if (_bcsDirty) return;
    _bcsDirty = true;
    var btn = document.getElementById('bcsApplyBtn');
    if (btn) btn.classList.add('dirty');
}
function _bcsClearDirty() {
    _bcsDirty = false;
    var btn = document.getElementById('bcsApplyBtn');
    if (btn) btn.classList.remove('dirty');
}

function _bcsInit() {
    _bcsWidthScrub  = _bcsMakeScrub(document.getElementById('bcsWidthScrub'),  { min: 1, onChange: _bcsOnWidthChange });
    _bcsHeightScrub = _bcsMakeScrub(document.getElementById('bcsHeightScrub'), { min: 1, onChange: _bcsOnHeightChange });
    _bcsDurField    = _bcsMakeSecondsField('bcsDurInput',   'bcsDurUnit');
    _bcsStartField  = _bcsMakeSecondsField('bcsStartInput', 'bcsStartUnit');

    _bcsBindEnable('bcsParCheck',   ['bcsParSelect']);
    _bcsBindEnable('bcsFrCheck',    ['bcsFrInput']);
    _bcsBindEnable('bcsResCheck',   ['bcsResSelect']);
    _bcsBindEnable('bcsDurCheck',   ['bcsDurInput', 'bcsDurUnit']);
    _bcsBindEnable('bcsStartCheck', ['bcsStartInput', 'bcsStartUnit']);
    _bcsBindRowEnable('bcsDimsCheck', document.getElementById('bcsDimsControls'));
    _bcsBindRowEnable('bcsFrCheck',   document.getElementById('bcsSnapRow'));

    // Delegated dirty-tracking for every native control in the panel — the scrub
    // fields are custom (no native events while dragging) so they call
    // _bcsMarkDirty() directly from their onChange callbacks above instead.
    var overlay = document.getElementById('bcsOverlay');
    overlay.addEventListener('input',  _bcsMarkDirty);
    overlay.addEventListener('change', _bcsMarkDirty);

    _bcsUpdateLockTip();
}

// Renders from _bcsCompNames / _bcsExcluded — each row has a remove button that
// excludes that comp from the batch without touching the actual Project panel
// selection. Re-run after every removal to refresh the list and empty state.
function _bcsRenderCompList() {
    var list = document.getElementById('bcsCompList');
    list.innerHTML = '';
    var shown = 0;
    for (var i = 0; i < _bcsCompNames.length; i++) {
        if (_bcsExcluded[i]) continue;
        shown++;
        var row = document.createElement('div');
        row.className = 'bcs-comp-row';
        row.innerHTML =
            '<svg viewBox="0 0 14 10" fill="currentColor"><rect x="0.5" y="0.5" width="13" height="9" rx="1.3" fill="none" stroke="currentColor" stroke-width="1"/></svg>' +
            '<span></span>' +
            '<button class="bcs-comp-remove" title="Remove from batch">' +
                '<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><line x1="1.5" y1="1.5" x2="8.5" y2="8.5"/><line x1="8.5" y1="1.5" x2="1.5" y2="8.5"/></svg>' +
            '</button>';
        row.querySelector('span').textContent = _bcsCompNames[i];
        row.querySelector('.bcs-comp-remove').addEventListener('click', (function (idx) {
            return function () {
                _bcsExcluded[idx] = true;
                _bcsMarkDirty();
                _bcsRenderCompList();
            };
        })(i));
        list.appendChild(row);
    }
    if (shown === 0) {
        var empty = document.createElement('div');
        empty.className = 'bcs-complist-empty';
        empty.id = 'bcsCompEmpty';
        empty.textContent = 'No comp selected';
        list.appendChild(empty);
    }
}

// initialTab lets a caller land directly on 'rename' (see openBatchRename,
// kept around purely so the Classic-mode Organize panel's existing "Batch
// Rename" button — a separate, hand-authored UI surface — keeps working
// unchanged) — defaults to the Settings tab otherwise.
function openBatchCompSettings(initialTab) {
    cs.evalScript('lineup_getBatchCompSettingsSeed()', function (result) {
        if (!result || result === 'undefined') {
            // No live ExtendScript bridge — e.g. previewing index.html directly in a
            // browser via Live Server. Fall back to mock data (no comps selected) so
            // the panel can still be opened and tested visually.
            result = '0,1920,1080,1,30,1,5,0|';
        }
        if (result.indexOf('ERROR:') === 0) {
            showToast(result.replace(/^ERROR:\s*/, ''));
            return;
        }
        var bar   = result.split('|');
        var p     = bar[0].split(',');
        var names = bar.slice(1).filter(function (n) { return n.length > 0; });

        var width  = parseInt(p[1], 10) || 1920;
        var height = parseInt(p[2], 10) || 1080;
        var par    = parseFloat(p[3])   || 1;
        var fr     = parseFloat(p[4])   || 30;
        var res    = parseInt(p[5], 10) || 1;
        var dur    = parseFloat(p[6]);
        var start  = parseFloat(p[7])   || 0;

        _bcsCompNames = names;
        _bcsExcluded  = {};
        _bcsRenderCompList();

        _bcsWidthScrub.set(width, true);
        _bcsHeightScrub.set(height, true);
        _bcsLocked = true; // reopen defaulted to linked
        document.getElementById('bcsLockBtn').classList.add('locked');
        _bcsLockedRatio = width / height;
        _bcsUpdateLockTip();

        document.getElementById('bcsParSelect').value = _bcsParIndexForValue(par);
        document.getElementById('bcsFrInput').value   = fr;
        document.getElementById('bcsResSelect').value = res;

        document.getElementById('bcsDurUnit').value   = '0'; // reopen defaulted to Seconds
        document.getElementById('bcsStartUnit').value = '0';
        _bcsDurField.render(isNaN(dur) ? 5 : dur);
        _bcsStartField.render(start);

        _bcsClearDirty();

        // Rename tab shares the exact same "selected comps" source as
        // Settings above (both filter proj.selection down to CompItems),
        // so it's seeded straight from `names` here instead of a second,
        // redundant evalScript round-trip to lineup_getBatchRenameSeed.
        _brnCompNames = names;
        _brnOrder = names.map(function (_, i) { return i; });
        document.getElementById('brnPattern').value = '';
        document.getElementById('brnStart').value   = '1';
        _brnRenderCompList();
        _brnClearDirty();

        switchBcsTab(initialTab === 'rename' ? 'rename' : 'settings');
        document.getElementById('bcsOverlay').classList.remove('bcs-hidden');
    });
}

function closeBatchCompSettings() {
    document.getElementById('bcsOverlay').classList.add('bcs-hidden');
    _brnClearDirty();
    _bcsClearDirty();
}

function applyBatchCompSettings() {
    var applyDims = chkVal('bcsDimsCheck');
    var width     = _bcsWidthScrub.get();
    var height    = _bcsHeightScrub.get();

    var applyPAR = chkVal('bcsParCheck');
    var par      = BCS_PAR_PRESETS[selVal('bcsParSelect')];

    var applyFR   = chkVal('bcsFrCheck');
    var frameRate = numVal('bcsFrInput', 30);
    var snapKeys  = chkVal('bcsSnapCheck');

    var applyRes  = chkVal('bcsResCheck');
    var resFactor = selVal('bcsResSelect');

    var applyDur = chkVal('bcsDurCheck');
    var duration = _bcsDurField.getSeconds();

    var applyStart = chkVal('bcsStartCheck');
    var startTime  = _bcsStartField.getSeconds();

    var includeNested = chkVal('bcsNested');

    var excludedIdx = [];
    for (var i = 0; i < _bcsCompNames.length; i++) {
        if (_bcsExcluded[i]) excludedIdx.push(i);
    }

    if (!applyDims && !applyPAR && !applyFR && !applyRes && !applyDur && !applyStart) {
        showToast('Check at least one setting to apply.');
        return;
    }
    if (applyDims && (width < 1 || height < 1)) {
        showToast('Enter a valid width and height.');
        return;
    }
    if (applyDur && (isNaN(duration) || duration <= 0)) {
        showToast('Enter a valid duration.');
        return;
    }
    if (applyStart && isNaN(startTime)) {
        showToast('Enter a valid start time.');
        return;
    }
    if (_bcsCompNames.length > 0 && excludedIdx.length === _bcsCompNames.length) {
        showToast('All compositions were removed from the list — nothing to apply.');
        return;
    }

    var script = 'lineup_batchApplyCompSettings(' +
        applyDims + ',' + width + ',' + height + ',' +
        applyPAR + ',' + par + ',' +
        applyFR + ',' + frameRate + ',' + snapKeys + ',' +
        applyRes + ',' + resFactor + ',' +
        applyDur + ',' + duration + ',' +
        applyStart + ',' + startTime + ',' +
        includeNested + ',' +
        '"' + excludedIdx.join(',') + '"' + ')';

    cs.evalScript(script, function (result) {
        if (!result || result === 'undefined') { closeBatchCompSettings(); return; }
        if (result.indexOf('ERROR:') === 0) {
            showToast(result.replace(/^ERROR:\s*/, ''));
            return;
        }
        if (result.indexOf('WARN:') === 0) showToast(result.replace(/^WARN:/, ''));
        closeBatchCompSettings();
    });
}

// ── Batch Rename ─────────────────────────────────────────────────────────────

var _brnCompNames = [];   // every comp selected when the panel was opened (stable, by original index)
var _brnOrder     = [];   // original indices, in current (draggable) numbering order — removing a
                           // comp just splices its index out of this array entirely
var _brnDirty     = false;

// Replaces every [#], [##], [###]… run with the index (zero-padded to the number
// of # characters), and the semi-secret [A] token with a spreadsheet-style letter
// (A, B, … Z, AA, AB, …) based on position alone — [A] always starts at A and
// ignores the Start-at field, by design.
function _brnNumberToLetters(num) {
    var s = '';
    while (num > 0) {
        var rem = (num - 1) % 26;
        s = String.fromCharCode(65 + rem) + s;
        num = Math.floor((num - 1) / 26);
    }
    return s;
}
function _brnApplyPattern(pattern, num, letterPos) {
    if (!pattern) return '';
    var out = pattern.replace(/\[#+\]/g, function (m) {
        var width = m.length - 2;
        var s = String(num);
        while (s.length < width) s = '0' + s;
        return s;
    });
    out = out.replace(/\[A\]/g, _brnNumberToLetters(letterPos));
    return out;
}

function _brnMarkDirty() {
    if (_brnDirty) return;
    _brnDirty = true;
    var btn = document.getElementById('brnApplyBtn');
    if (btn) btn.classList.add('dirty');
}
function _brnClearDirty() {
    _brnDirty = false;
    var btn = document.getElementById('brnApplyBtn');
    if (btn) btn.classList.remove('dirty');
}

// Renders a live preview of the resulting names (pattern + index applied in
// _brnOrder) — re-run on every pattern/start-number edit, removal, and reorder.
function _brnRenderCompList() {
    var list    = document.getElementById('brnCompList');
    var pattern = document.getElementById('brnPattern').value;
    var start   = parseInt(document.getElementById('brnStart').value, 10);
    if (isNaN(start)) start = 1;

    list.innerHTML = '';
    for (var pos = 0; pos < _brnOrder.length; pos++) {
        var origIdx  = _brnOrder[pos];
        var origName = _brnCompNames[origIdx];
        var newName  = _brnApplyPattern(pattern, start + pos, pos + 1) || origName;

        var row = document.createElement('div');
        row.className = 'bcs-comp-row';
        row.title = origName;
        row.innerHTML =
            '<button class="bcs-drag-handle" title="Drag to reorder">' +
                '<svg viewBox="0 0 8 12" fill="currentColor"><circle cx="2" cy="1.5" r="1"/><circle cx="6" cy="1.5" r="1"/><circle cx="2" cy="6" r="1"/><circle cx="6" cy="6" r="1"/><circle cx="2" cy="10.5" r="1"/><circle cx="6" cy="10.5" r="1"/></svg>' +
            '</button>' +
            '<svg viewBox="0 0 14 10" fill="currentColor"><rect x="0.5" y="0.5" width="13" height="9" rx="1.3" fill="none" stroke="currentColor" stroke-width="1"/></svg>' +
            '<span class="bcs-comp-name"></span>' +
            '<span class="bcs-comp-orig"></span>' +
            '<button class="bcs-comp-remove" title="Remove from batch">' +
                '<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><line x1="1.5" y1="1.5" x2="8.5" y2="8.5"/><line x1="8.5" y1="1.5" x2="1.5" y2="8.5"/></svg>' +
            '</button>';
        row.querySelector('.bcs-comp-name').textContent = newName;
        row.querySelector('.bcs-comp-orig').textContent = origName;
        row.querySelector('.bcs-comp-remove').addEventListener('click', (function (p) {
            return function () {
                _brnOrder.splice(p, 1);
                _brnMarkDirty();
                _brnRenderCompList();
            };
        })(pos));
        list.appendChild(row);
    }
    if (_brnOrder.length === 0) {
        var empty = document.createElement('div');
        empty.className = 'bcs-complist-empty';
        empty.textContent = 'No comp selected';
        list.appendChild(empty);
    }

    _brnInitDrag();
}

// Lightweight counterpart to _brnRenderCompList for pattern/start-number
// edits specifically — those change every row's displayed name but never
// the row structure, drag handles, or listeners, so there's no need to
// tear down and rebuild the whole list (innerHTML parsing + re-querying +
// re-wiring a remove-click and a drag-handle mousedown per row) on every
// single keystroke. Only used when the row COUNT/ORDER is already known
// to match _brnOrder (i.e. nothing structural changed since the last full
// render) — reorder/remove/init still go through the full rebuild above.
function _brnUpdatePreviewNames() {
    var list    = document.getElementById('brnCompList');
    var pattern = document.getElementById('brnPattern').value;
    var start   = parseInt(document.getElementById('brnStart').value, 10);
    if (isNaN(start)) start = 1;

    var rows = list.querySelectorAll('.bcs-comp-name');
    for (var pos = 0; pos < _brnOrder.length && pos < rows.length; pos++) {
        var origIdx  = _brnOrder[pos];
        var origName = _brnCompNames[origIdx];
        rows[pos].textContent = _brnApplyPattern(pattern, start + pos, pos + 1) || origName;
    }
}

// Drag-to-reorder, same mechanic as the Settings section list: grab the handle,
// a ghost row follows the cursor, other rows slide to show the live insertion
// point, and on release _brnOrder is spliced to match — which changes numbering.
function _brnInitDrag() {
    var list = document.getElementById('brnCompList');
    list.querySelectorAll('.bcs-drag-handle').forEach(function (handle) {
        handle.addEventListener('mousedown', function (e) {
            e.preventDefault();

            var row = handle.closest('.bcs-comp-row');
            if (!row) return;

            var rowEls    = Array.from(list.querySelectorAll('.bcs-comp-row'));
            var dragIdx   = rowEls.indexOf(row);
            var origRects = rowEls.map(function (r) { return r.getBoundingClientRect(); });
            var rowH      = origRects[dragIdx].height;
            var shiftAmt  = rowH + 2; // matches list gap

            var rect  = origRects[dragIdx];
            var ghost = row.cloneNode(true);
            ghost.className = 'bcs-comp-row bcs-comp-drag-ghost';
            ghost.style.cssText = [
                'position:fixed',
                'left:' + rect.left + 'px',
                'top:'  + rect.top  + 'px',
                'width:' + rect.width + 'px',
                'pointer-events:none',
                'z-index:2000'
            ].join(';');
            document.body.appendChild(ghost);
            row.style.visibility = 'hidden';

            var startY    = e.clientY;
            var originTop = rect.top;

            function getInsertIdx(ghostCenterY) {
                var above = 0;
                for (var i = 0; i < rowEls.length; i++) {
                    if (i === dragIdx) continue;
                    if (ghostCenterY > origRects[i].top + origRects[i].height / 2) above++;
                }
                var c = 0;
                for (var i = 0; i < rowEls.length; i++) {
                    if (i === dragIdx) continue;
                    if (c++ === above) return i;
                }
                return rowEls.length;
            }

            function applyShifts(insertIdx) {
                rowEls.forEach(function (r, i) {
                    if (i === dragIdx) return;
                    var dy = 0;
                    if (insertIdx > dragIdx  && i > dragIdx  && i < insertIdx) dy = -shiftAmt;
                    if (insertIdx <= dragIdx && i >= insertIdx && i < dragIdx)  dy =  shiftAmt;
                    r.style.transform = dy ? 'translateY(' + dy + 'px)' : '';
                });
            }

            function onMove(ev) {
                var top = originTop + ev.clientY - startY;
                ghost.style.top = top + 'px';
                applyShifts(getInsertIdx(top + rowH / 2));
            }

            function onUp(ev) {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                ghost.remove();

                var finalIdx  = getInsertIdx(originTop + ev.clientY - startY + rowH / 2);
                var insertAt  = finalIdx > dragIdx ? finalIdx - 1 : finalIdx;
                var moved     = _brnOrder.splice(dragIdx, 1)[0];
                _brnOrder.splice(insertAt, 0, moved);

                _brnMarkDirty();
                _brnRenderCompList(); // rebuilds rows (clears transforms) and renumbers
            }

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    });
}

function _brnInit() {
    document.getElementById('brnPattern').addEventListener('input', function () { _brnUpdatePreviewNames(); _brnMarkDirty(); });
    document.getElementById('brnStart').addEventListener('input',   function () { _brnUpdatePreviewNames(); _brnMarkDirty(); });
}

// Batch Rename is now the second tab of the Batch Comp Settings modal (see
// switchBcsTab/openBatchCompSettings above) rather than its own dialog —
// this just opens that modal straight to the Rename tab, kept as its own
// named function purely so the Classic-mode Organize panel's existing
// "Batch Rename" button (a separate, hand-authored UI surface, untouched
// here) keeps working with no markup changes.
function openBatchRename() {
    openBatchCompSettings('rename');
}

// Wraps a user-typed string as a safely-escaped ExtendScript string literal
// for embedding directly into an evalScript() call.
function _esQuote(str) {
    return '"' + String(str).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n') + '"';
}

function applyBatchRename() {
    var pattern = document.getElementById('brnPattern').value;
    var start   = parseInt(document.getElementById('brnStart').value, 10);
    if (isNaN(start)) start = 1;

    if (!pattern) {
        showToast('Enter a name pattern.');
        return;
    }
    if (_brnOrder.length === 0) {
        showToast('All compositions were removed from the list — nothing to apply.');
        return;
    }

    var script = 'lineup_batchRenameComps(' +
        _esQuote(pattern) + ',' + start + ',' +
        _esQuote(_brnOrder.join(',')) + ')';

    cs.evalScript(script, function (result) {
        if (!result || result === 'undefined') { closeBatchCompSettings(); return; }
        if (result.indexOf('ERROR:') === 0) {
            showToast(result.replace(/^ERROR:\s*/, ''));
            return;
        }
        closeBatchCompSettings();
    });
}

// ── Comp Export ──────────────────────────────────────────────────────────────

var _cexCompNames  = []; // every comp selected when the panel was opened
var _cexExcluded   = {}; // index (into _cexCompNames) -> true, removed from the batch
var _cexFolder     = ''; // current project's folder, for the suggested save location
var _cexProjBase   = ''; // current project's filename, without extension
var _cexPath       = '';
var _cexManualPath = false; // true once the user has Browse'd to a custom location

function _cexSanitizeFilename(name) {
    return String(name).replace(/[\\\/:*?"<>|]/g, '_');
}

function _cexJoinPath(folder, filename) {
    var sep = folder.indexOf('\\') !== -1 ? '\\' : '/';
    return folder.charAt(folder.length - 1) === sep ? folder + filename : folder + sep + filename;
}

// One comp left -> "ProjectName_CompName.aep"; more than one -> "ProjectName_reduced.aep".
function _cexSuggestedPath() {
    var visible = [];
    for (var i = 0; i < _cexCompNames.length; i++) {
        if (!_cexExcluded[i]) visible.push(_cexCompNames[i]);
    }
    var filename = (visible.length === 1)
        ? _cexProjBase + '_' + _cexSanitizeFilename(visible[0]) + '.aep'
        : _cexProjBase + '_reduced.aep';
    return _cexFolder ? _cexJoinPath(_cexFolder, filename) : filename;
}

function _cexRenderCompList() {
    var list = document.getElementById('cexCompList');
    list.innerHTML = '';
    var shown = 0;
    for (var i = 0; i < _cexCompNames.length; i++) {
        if (_cexExcluded[i]) continue;
        shown++;
        var row = document.createElement('div');
        row.className = 'bcs-comp-row';
        row.innerHTML =
            '<svg viewBox="0 0 14 10" fill="currentColor"><rect x="0.5" y="0.5" width="13" height="9" rx="1.3" fill="none" stroke="currentColor" stroke-width="1"/></svg>' +
            '<span></span>' +
            '<button class="bcs-comp-remove" title="Remove from batch">' +
                '<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><line x1="1.5" y1="1.5" x2="8.5" y2="8.5"/><line x1="8.5" y1="1.5" x2="1.5" y2="8.5"/></svg>' +
            '</button>';
        row.querySelector('span').textContent = _cexCompNames[i];
        row.querySelector('.bcs-comp-remove').addEventListener('click', (function (idx) {
            return function () {
                _cexExcluded[idx] = true;
                _cexRenderCompList();
                if (!_cexManualPath) _cexSetPath(_cexSuggestedPath());
            };
        })(i));
        list.appendChild(row);
    }
    if (shown === 0) {
        var empty = document.createElement('div');
        empty.className = 'bcs-complist-empty';
        empty.textContent = 'No comp selected';
        list.appendChild(empty);
    }

    var applyBtn = document.getElementById('cexApplyBtn');
    if (applyBtn) {
        applyBtn.disabled = shown === 0;
        applyBtn.classList.toggle('dirty', shown > 0);
    }
}

function _cexSetPath(path) {
    _cexPath = path || '';
    var el = document.getElementById('cexPath');
    el.textContent = _cexPath || '(no location chosen)';
    el.title = _cexPath;
}

function openCompExport() {
    cs.evalScript('lineup_getCompExportSeed()', function (result) {
        if (!result || result === 'undefined') {
            // No live ExtendScript bridge — preview with nothing selected.
            result = '||';
        }
        if (result.indexOf('ERROR:') === 0) {
            showToast(result.replace(/^ERROR:\s*/, ''));
            return;
        }
        var bar = result.split('|');

        _cexFolder     = bar[0];
        _cexProjBase   = bar[1];
        _cexCompNames  = bar.slice(2).filter(function (n) { return n.length > 0; });
        _cexExcluded   = {};
        _cexManualPath = false;
        _cexRenderCompList();
        _cexSetPath(_cexSuggestedPath());

        document.getElementById('cexOverlay').classList.remove('cex-hidden');
    });
}

function closeCompExport() {
    document.getElementById('cexOverlay').classList.add('cex-hidden');
}

function browseCompExport() {
    var script = 'lineup_pickExportLocation(' + _esQuote(_cexPath) + ')';
    cs.evalScript(script, function (result) {
        if (!result || result === 'undefined') return;
        if (result.indexOf('ERROR:') === 0) {
            showToast(result.replace(/^ERROR:\s*/, ''));
            return;
        }
        if (result.length === 0) return; // user canceled the native dialog
        _cexManualPath = true;
        _cexSetPath(result);
    });
}

function applyCompExport() {
    var excludedIdx = [];
    for (var i = 0; i < _cexCompNames.length; i++) {
        if (_cexExcluded[i]) excludedIdx.push(i);
    }
    if (_cexCompNames.length > 0 && excludedIdx.length === _cexCompNames.length) {
        showToast('All compositions were removed from the list — nothing to export.');
        return;
    }
    if (!_cexPath) {
        showToast('Choose a save location first.');
        return;
    }

    var script = 'lineup_exportReducedProject(' +
        _esQuote(_cexPath) + ',' + _esQuote(excludedIdx.join(',')) + ')';

    cs.evalScript(script, function (result) {
        if (!result || result === 'undefined') { closeCompExport(); return; }
        if (result.indexOf('ERROR:') === 0) {
            showToast(result.replace(/^ERROR:\s*/, ''));
            return;
        }
        showToast('Saved your project, then exported and opened the reduced copy.', 'info');
        closeCompExport();
    });
}

// ── Activity tracking (Trophy tab) ─────────────────────────────────────────
// Gamifies AE usage — a workday streak plus running totals of keyframes
// made, layers created, and exports completed, converted into a score.
// AE's ExtendScript API has no events for any of this (no "keyframe added"/
// "layer created" hook, and undo presses/graph-editor curve edits aren't
// observable at all from a panel — the Timeline never sends CEP its
// keystrokes), so this works entirely by polling a cheap snapshot
// (lineup_getActivitySnapshot in host.jsx) and diffing it against the
// previous poll to infer what changed. Undo presses and curve edits are
// deliberately NOT tracked here — there's no reliable way to attribute
// either without a real event API, and a heuristic (e.g. "count count
// drops as undos") would be indistinguishable from ordinary deletion.
// Keyframe counting is scoped to the currently SELECTED layers only (not
// the whole comp) — walking every property of every layer every 3s scales
// with total comp complexity and runs synchronously on AE's main thread, so
// an unscoped walk could cost real, felt UI stutter on a heavy comp.
// Scoping to the selection caps that cost at "how many layers are
// selected" regardless of comp size, at the price of not counting
// keyframes added to layers that aren't selected at poll time.
var ACTIVITY_KEY = 'lineup-activity';
var ACTIVITY_POLL_MS = 3000; // a background stat, not a live UI sync — no need for anything faster
var ACTIVITY_POINTS = { keyframes: 1, layers: 3, exports: 15 };

var _activityData = null;     // persisted totals/score/streak/history — see _activityLoad
var _activityBaseline = null; // last-seen raw snapshot from host.jsx; NOT persisted — every fresh
                               // panel load (or project/comp switch) just recaptures a starting
                               // point instead of crediting whatever the project already had.

function _activityDefaults() {
    return {
        totals: { keyframes: 0, layers: 0, exports: 0 },
        score: 0,
        streak: { current: 0, best: 0, lastActiveDate: null },
        history: {} // 'YYYY-MM-DD' -> { keyframes, layers, exports, score } — days with any activity
    };
}

function _activityLoad() {
    var data = null;
    try { data = JSON.parse(localStorage.getItem(ACTIVITY_KEY) || 'null'); } catch (e) {}
    _activityData = data || _activityDefaults();
}

function _activitySave() {
    try { localStorage.setItem(ACTIVITY_KEY, JSON.stringify(_activityData)); } catch (e) {}
}

function _activityDateKey(d) {
    var y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
    return y + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
}
function _activityToday() { return _activityDateKey(new Date()); }
function _activityParseDate(key) {
    var parts = key.split('-');
    return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
}
function _activityIsWeekend(d) { var dow = d.getDay(); return dow === 0 || dow === 6; }

// Counts Mon-Fri dates strictly BETWEEN two dates (both ends excluded) —
// this is the whole streak rule in one number: 0 missed workdays in
// between means the streak continues no matter what either date itself
// falls on, which is exactly "skip weekends silently, but a weekend open
// still keeps things going" without needing separate weekend-case logic.
function _activityWorkdaysBetween(start, end) {
    var count = 0;
    var cur = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
    while (cur.getTime() < end.getTime()) {
        if (!_activityIsWeekend(cur)) count++;
        cur.setDate(cur.getDate() + 1);
    }
    return count;
}

// Runs once per calendar day the panel is actually used (a no-op every
// other tick, via the lastActiveDate === today early-out) — extends the
// streak when the gap since last use contains zero missed workdays
// (see _activityWorkdaysBetween above), otherwise resets it to 1.
function _activityCheckStreak() {
    var today = _activityToday();
    var streak = _activityData.streak;
    if (streak.lastActiveDate === today) return;

    if (!streak.lastActiveDate) {
        streak.current = 1;
    } else {
        var gap = _activityWorkdaysBetween(_activityParseDate(streak.lastActiveDate), _activityParseDate(today));
        streak.current = (gap === 0) ? (streak.current + 1) : 1;
    }
    streak.best = Math.max(streak.best || 0, streak.current);
    streak.lastActiveDate = today;
    _activitySave();
}

// Shared by _activityAddPoints and the Trophy timer (which stamps time
// spent into the same per-day record, just without touching score/totals).
function _activityGetOrCreateDay(key) {
    var day = _activityData.history[key];
    if (!day) { day = { keyframes: 0, layers: 0, exports: 0, score: 0, seconds: 0 }; _activityData.history[key] = day; }
    return day;
}

function _activityAddPoints(kind, count) {
    if (!count || count <= 0) return;
    var pts = (ACTIVITY_POINTS[kind] || 0) * count;
    _activityData.totals[kind] = (_activityData.totals[kind] || 0) + count;
    _activityData.score += pts;

    var day = _activityGetOrCreateDay(_activityToday());
    day[kind] += count;
    day.score += pts;
}

// Diffs the latest snapshot against the previous one to award points for
// whatever increased. projectId/compId identity checks gate WHICH deltas
// are trusted this tick: switching to a different project (or just a
// different comp, for the comp-scoped keyframe count) makes for a huge,
// meaningless one-tick jump that isn't "activity" at all — those deltas
// are simply skipped rather than counted, and the new snapshot becomes the
// baseline going forward. The very first tick after a panel load has no
// prior baseline yet either, so it only ever captures one, never scores.
function _activityPollTick() {
    cs.evalScript('lineup_getActivitySnapshot()', function(result) {
        if (!result || result.indexOf('ERROR:') === 0) return;
        var snap;
        try { snap = JSON.parse(result); } catch (e) { return; }

        var baseline = _activityBaseline;
        _activityBaseline = snap;
        if (!baseline) return;

        var projectChanged = baseline.projectId !== snap.projectId;
        var compChanged = baseline.compId !== snap.compId;
        var selectionChanged = baseline.selectionId !== snap.selectionId;
        var timeChanged = baseline.currentTime !== snap.currentTime;

        var dLayers = 0, dExports = 0, dKeyframes = 0;
        if (!projectChanged) {
            dLayers = snap.layerCount - baseline.layerCount;
            dExports = snap.exportsDone - baseline.exportsDone;
            if (dLayers > 0) _activityAddPoints('layers', dLayers);
            if (dExports > 0) _activityAddPoints('exports', dExports);
        }
        // Keyframe count is scoped to the current layer selection (see
        // lineup_getActivitySnapshot) — a selection change alone swings that
        // number just as hard as a project/comp switch does, so it gets the
        // same "don't count this tick, just rebaseline" treatment.
        if (!projectChanged && !compChanged && !selectionChanged) {
            dKeyframes = snap.keyframeCount - baseline.keyframeCount;
            if (dKeyframes > 0) _activityAddPoints('keyframes', dKeyframes);
        }

        // Anything different from last poll — including changes that don't
        // score any points (switching comps, moving the playhead, changing
        // selection) — still counts as "the user is doing something" for
        // the Trophy timer's auto-resume/inactivity check below.
        if (projectChanged || compChanged || selectionChanged || timeChanged ||
            dLayers !== 0 || dExports !== 0 || dKeyframes !== 0) {
            _timerMarkActivity();
        }

        _activitySave();
        _activityRenderTab();
    });
}

// Tiny white clock icon used both here (the streak strip) and in the full
// calendar's day cells — one shared constant instead of repeating the SVG
// markup in both render functions.
var TROPHY_MINI_CLOCK_SVG = '<svg viewBox="0 0 20 20" fill="none" stroke="#ffffff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="7.5"/><path d="M10,5.5 V10 L13,12"/></svg>';

// Finds the date range of the CURRENT streak run — walks backward from the
// most recent active day that's on or before today, extending the range
// through consecutive active days with zero missed-workday gaps between
// them (the same rule _activityCheckStreak uses), stopping at the first
// break. Returns null if there's no active day at all. Used purely for the
// day strip's visual grouping (see _activityRenderDayStrip) — the actual
// streak.current NUMBER is computed independently in _activityCheckStreak.
function _activityCurrentStreakRange() {
    var keys = Object.keys(_activityData.history || {}).sort();
    if (!keys.length) return null;
    var today = _activityToday();

    var anchor = null;
    for (var i = keys.length - 1; i >= 0; i--) {
        if (keys[i] <= today) { anchor = keys[i]; break; }
    }
    if (!anchor) return null;

    var start = anchor;
    var anchorIdx = keys.indexOf(anchor);
    for (var j = anchorIdx; j > 0; j--) {
        var gap = _activityWorkdaysBetween(_activityParseDate(keys[j - 1]), _activityParseDate(keys[j]));
        if (gap !== 0) break;
        start = keys[j - 1];
    }
    return { start: start, end: anchor };
}

function _activityRenderDayStrip() {
    var wrap = document.getElementById('trophyStreakDays');
    if (!wrap) return;
    var todayKey = _activityToday();
    var DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    var streakRange = _activityCurrentStreakRange();

    var cells = [];
    for (var i = 6; i >= 0; i--) {
        var d = new Date();
        d.setDate(d.getDate() - i);
        var key = _activityDateKey(d);
        var day = _activityData.history[key];

        var cls = 'trophy-day-dot';
        if (_activityIsWeekend(d)) cls += ' is-weekend';
        if (day) cls += ' is-active';
        if (key === todayKey) cls += ' is-today';

        var html = '<span class="trophy-day-dot-letter">' + DOW[d.getDay()] + '</span>';
        if (day && day.seconds) {
            html += '<span class="trophy-day-dot-time">' + TROPHY_MINI_CLOCK_SVG + _timerFormat(day.seconds) + '</span>';
        }

        var inStreak = !!(streakRange && key >= streakRange.start && key <= streakRange.end);
        cells.push({ inStreak: inStreak, html: '<div class="' + cls + '">' + html + '</div>' });
    }

    // Group consecutive in-streak cells under one shared .trophy-streak-wrap
    // instead of tinting every active day individually — the streak reads
    // as a single contiguous highlighted subsection instead.
    var out = '';
    var idx = 0;
    while (idx < cells.length) {
        if (cells[idx].inStreak) {
            var groupHtml = '', groupCount = 0;
            while (idx < cells.length && cells[idx].inStreak) {
                groupHtml += cells[idx].html;
                groupCount++;
                idx++;
            }
            out += '<div class="trophy-streak-wrap" style="flex:' + groupCount + '">' + groupHtml + '</div>';
        } else {
            out += cells[idx].html;
            idx++;
        }
    }
    wrap.innerHTML = out;
}

// Score/Keyframes/Layers/Exports show TODAY's numbers, not the all-time
// cumulative — d.score/d.totals still track the all-time sums underneath
// (used by the leaderboard's All-Time tab and unaffected by this), this
// just changes what the Trophy tab itself displays day to day.
function _activityRenderTab() {
    if (!_activityData) return;
    var d = _activityData;
    var today = d.history[_activityToday()] || { keyframes: 0, layers: 0, exports: 0, score: 0 };
    var scoreEl = document.getElementById('trophyScoreValue');
    if (scoreEl) scoreEl.textContent = today.score;
    var kfEl = document.getElementById('trophyStatKeyframes');
    if (kfEl) kfEl.textContent = today.keyframes;
    var layEl = document.getElementById('trophyStatLayers');
    if (layEl) layEl.textContent = today.layers;
    var expEl = document.getElementById('trophyStatExports');
    if (expEl) expEl.textContent = today.exports;
    var streakEl = document.getElementById('trophyStreakCount');
    if (streakEl) streakEl.textContent = d.streak.current;
    var bestEl = document.getElementById('trophyStreakBest');
    if (bestEl) bestEl.textContent = d.streak.best;
    _activityRenderDayStrip();
}

function _activityInit() {
    _activityLoad();
    _activityCheckStreak();
    _activityRenderTab();
}

// ── Enable Scoring (Settings toggle) ─────────────────────────────────────
// Master on/off for the activity poll specifically — that's the one piece
// of this whole feature that can actually cost real performance (it walks
// every property of the selected layers via evalScript every 3s; see
// lineup_getActivitySnapshot in host.jsx), unlike the session timer's own
// plain 1s local setInterval, which stays running either way since it
// isn't what anyone would call "lag." js/leaderboard.js independently
// checks this same localStorage key before its own periodic push/pull, so
// one switch mutes both halves of the background work at once. Defaults
// to ON — absent/anything other than an explicit '0' counts as enabled.
var _activityPollIntervalId = null;

function _scoringEnabled() {
    var v;
    try { v = localStorage.getItem('lineup-scoring-enabled'); } catch (e) {}
    return v !== '0';
}

function _activityApplyScoringEnabled(enabled) {
    var notice = document.getElementById('scoringDisabledNotice');
    if (notice) notice.style.display = enabled ? 'none' : '';
    if (enabled) {
        if (!_activityPollIntervalId) _activityPollIntervalId = setInterval(_activityPollTick, ACTIVITY_POLL_MS);
    } else if (_activityPollIntervalId) {
        clearInterval(_activityPollIntervalId);
        _activityPollIntervalId = null;
    }
}

function toggleScoring(on) {
    try { localStorage.setItem('lineup-scoring-enabled', on ? '1' : '0'); } catch (e) {}
    _activityApplyScoringEnabled(!!on);
}

function restoreScoringSetting() {
    var enabled = _scoringEnabled();
    var chk = document.getElementById('scoringEnabledCheck');
    if (chk) chk.checked = enabled;
    _activityApplyScoringEnabled(enabled);
}

// Called by js/leaderboard.js after it merges cloud-synced history into
// localStorage['lineup-activity'] — this module loaded its own in-memory
// _activityData once at startup and never re-reads localStorage on its
// own, so without this hook a merge would just sit there until the next
// periodic _activitySave() (from _activityPollTick/_timerTick) silently
// overwrote it with this module's stale pre-merge copy. Kept as a small
// public hook rather than main.js reaching into leaderboard.js, or vice
// versa, so the two stay fully decoupled either direction.
window._activityReloadFromCloud = function () {
    _activityLoad();
    _activityCheckStreak();
    var today = _activityToday();
    var day = _activityData.history[today];
    _timerElapsedToday = (day && day.seconds) || 0;
    _activityRenderTab();
    _timerRender();
};

// ── Trophy session timer ─────────────────────────────────────────────────────
// A live "how long have I been working today" clock — starts the moment the
// panel loads (CEP's own AutoVisible setting is what actually ties that to
// "AE just opened"), auto-pauses after 5 minutes with no detected activity,
// and auto-resumes the instant anything happens again — via the same
// activity heartbeat the poll above already computes (_timerMarkActivity),
// plus a cheap local mousedown/keydown listener that catches interaction
// with this panel's own UI without needing an evalScript round-trip at all.
// The manual pause button is NOT a hard stop — it's the exact same "paused"
// state as the inactivity timeout, so any detected activity resumes it
// either way, whether or not the user ever clicks Resume. Doesn't affect
// score; persisted per-day alongside the other stats (see
// _activityGetOrCreateDay) purely so a past day's calendar entry can show
// how long that day's session ran.
var TIMER_INACTIVITY_MS = 5 * 60 * 1000;

var _timerRunning = false;
var _timerElapsedToday = 0; // seconds
var _timerDateKey = null;   // the day _timerElapsedToday currently belongs to
var _lastActivityAt = 0;

function _timerFormat(sec) {
    sec = Math.max(0, Math.floor(sec));
    if (sec < 60) {
        return '0:' + (sec < 10 ? '0' : '') + sec;
    }
    var totalMin = Math.floor(sec / 60);
    if (totalMin < 60) return totalMin + 'm';
    var hr = Math.floor(totalMin / 60);
    var min = totalMin % 60;
    return hr + 'hr ' + min + 'm';
}

function _timerRender() {
    var valueEl = document.getElementById('trophyTimerValue');
    if (valueEl) valueEl.textContent = _timerFormat(_timerElapsedToday);
    var statusEl = document.getElementById('trophyTimerStatus');
    if (statusEl) statusEl.textContent = _timerRunning ? 'Active' : 'Inactive';
    var card = document.getElementById('trophyTimerCard');
    if (card) card.classList.toggle('is-paused', !_timerRunning);
}

// Called both by the activity poll's heartbeat and by this panel's own
// mousedown/keydown listener — resets the inactivity clock, and if the
// timer was paused (manually or via timeout), resumes it.
function _timerMarkActivity() {
    _lastActivityAt = Date.now();
    if (!_timerRunning) {
        _timerRunning = true;
        _timerRender();
    }
}

function _timerToggle() {
    if (_timerRunning) {
        _timerRunning = false;
        _timerRender();
    } else {
        _timerMarkActivity(); // resume + reset the inactivity clock together
    }
}

function _timerTick() {
    var today = _activityToday();
    if (today !== _timerDateKey) {
        // Crossed midnight with the panel left open — start a fresh
        // per-day counter and let the streak roll over too, instead of
        // silently carrying yesterday's seconds into today (or leaving
        // the streak stale until the next manual reload).
        _timerDateKey = today;
        _activityCheckStreak();
        var existing = _activityData.history[today];
        _timerElapsedToday = (existing && existing.seconds) || 0;
    }

    if (_timerRunning) {
        if (Date.now() - _lastActivityAt > TIMER_INACTIVITY_MS) {
            _timerRunning = false;
        } else {
            _timerElapsedToday++;
            _activityGetOrCreateDay(today).seconds = _timerElapsedToday;
            // Saved right here, every second, rather than only relying on
            // the 3s activity poll's own save — that poll skips its very
            // first tick (no baseline yet) and only fires at all while
            // evalScript keeps succeeding, so leaving persistence solely up
            // to it risked losing a few seconds if AE (and the panel with
            // it) closed shortly after a session started. This is what
            // actually guarantees a same-day reopen resumes from the exact
            // last recorded total instead of an occasionally-stale one.
            _activitySave();
        }
    }
    _timerRender();
}

function _timerInit() {
    _timerDateKey = _activityToday();
    var existing = _activityData.history[_timerDateKey];
    _timerElapsedToday = (existing && existing.seconds) || 0;
    _timerRunning = true;
    _lastActivityAt = Date.now();
    document.addEventListener('mousedown', _timerMarkActivity);
    document.addEventListener('keydown', _timerMarkActivity);
    _timerRender();
    setInterval(_timerTick, 1000);
}

// ── Trophy activity calendar (streak card's expanded 365-day view) ─────────
// One traditional Sun-start month grid at a time, paginated (Prev/Next)
// across the past 12 months rather than all stacked into one scroller —
// built fresh on every open/page turn (cheap: at most ~42 cells, plain DOM).
var MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
var CAL_DOW_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
var _trophyCalMonthOffset = 0; // months back from the current month; 0..11

function _activityMonthCells(year, month) {
    var firstDow = new Date(year, month, 1).getDay();
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    var cells = [];
    for (var i = 0; i < firstDow; i++) cells.push(null);
    for (var day = 1; day <= daysInMonth; day++) cells.push(day);
    return cells;
}

function _renderTrophyCalendar() {
    var body = document.getElementById('trophyCalBody');
    if (!body) return;
    body.innerHTML = '';
    var today = new Date();
    var todayKey = _activityToday();

    var d = new Date(today.getFullYear(), today.getMonth() - _trophyCalMonthOffset, 1);
    var y = d.getFullYear(), m = d.getMonth();

    var lbl = document.getElementById('trophyCalMonthLbl');
    if (lbl) lbl.textContent = MONTH_NAMES[m] + ' ' + y;
    var prevBtn = document.getElementById('trophyCalPrevBtn');
    var nextBtn = document.getElementById('trophyCalNextBtn');
    var todayBtn = document.getElementById('trophyCalTodayBtn');
    if (prevBtn) prevBtn.disabled = _trophyCalMonthOffset >= 11;
    if (nextBtn) nextBtn.disabled = _trophyCalMonthOffset <= 0;
    if (todayBtn) todayBtn.disabled = _trophyCalMonthOffset === 0;

    var dowRow = document.createElement('div');
    dowRow.className = 'trophy-cal-dow-row';
    CAL_DOW_LETTERS.forEach(function(l) {
        var s = document.createElement('span');
        s.textContent = l;
        dowRow.appendChild(s);
    });
    body.appendChild(dowRow);

    var grid = document.createElement('div');
    grid.className = 'trophy-cal-grid';
    _activityMonthCells(y, m).forEach(function(dayNum) {
        var cell = document.createElement('button');
        cell.type = 'button';
        if (dayNum === null) {
            cell.className = 'trophy-cal-day is-blank';
            cell.disabled = true;
            grid.appendChild(cell);
            return;
        }
        var key = y + '-' + (m + 1 < 10 ? '0' : '') + (m + 1) + '-' + (dayNum < 10 ? '0' : '') + dayNum;
        var day = _activityData.history[key];
        cell.className = 'trophy-cal-day';
        var html = '<span class="trophy-cal-day-num">' + dayNum + '</span>';
        if (day) {
            cell.classList.add('has-activity');
            if (day.seconds) {
                html += '<span class="trophy-cal-day-time">' + TROPHY_MINI_CLOCK_SVG + _timerFormat(day.seconds) + '</span>';
            }
        }
        cell.innerHTML = html;
        cell.setAttribute('data-date', key);
        if (key === todayKey) cell.classList.add('is-today');
        if (_activityParseDate(key).getTime() > today.getTime()) cell.classList.add('is-future');
        cell.addEventListener('click', function() { _showTrophyCalDay(this.getAttribute('data-date')); });
        grid.appendChild(cell);
    });
    body.appendChild(grid);
}

function _trophyCalResetDetail() {
    var detail = document.getElementById('trophyCalDetail');
    if (detail) detail.innerHTML = '<div class="trophy-cal-detail-empty">Select a day to see stats</div>';
}

function _trophyCalPrevMonth() {
    if (_trophyCalMonthOffset >= 11) return;
    _trophyCalMonthOffset++;
    _renderTrophyCalendar();
    _trophyCalResetDetail();
}
function _trophyCalNextMonth() {
    if (_trophyCalMonthOffset <= 0) return;
    _trophyCalMonthOffset--;
    _renderTrophyCalendar();
    _trophyCalResetDetail();
}
function _trophyCalGoToToday() {
    if (_trophyCalMonthOffset === 0) return;
    _trophyCalMonthOffset = 0;
    _renderTrophyCalendar();
    _trophyCalResetDetail();
}

// Icon+value chips (Time/Keyframes/Layers/Exports/Points) — same icons and
// colors as the tab's own .trophy-stat-tile/.trophy-timer/.trophy-score
// cards, so a day's detail view reads as the same visual language rather
// than a plain text summary.
function _showTrophyCalDay(key) {
    var prevSelected = document.querySelector('.trophy-cal-day.is-selected');
    if (prevSelected) prevSelected.classList.remove('is-selected');
    var cell = document.querySelector('.trophy-cal-day[data-date="' + key + '"]');
    if (cell) cell.classList.add('is-selected');

    var detail = document.getElementById('trophyCalDetail');
    if (!detail) return;
    var d = _activityParseDate(key);
    var label = MONTH_NAMES[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
    var day = _activityData.history[key];

    if (!day) {
        detail.innerHTML = '<div class="trophy-cal-detail-date">' + label + '</div>' +
            '<div class="trophy-cal-detail-empty">No activity this day</div>';
        return;
    }
    detail.innerHTML =
        '<div class="trophy-cal-detail-date">' + label + '</div>' +
        '<div class="trophy-cal-detail-stats">' +
            '<div class="trophy-cal-detail-stat">' +
                '<svg viewBox="0 0 20 20" fill="none" stroke="#6cc0ff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="7.5"/><path d="M10,5.5 V10 L13,12"/></svg>' +
                '<div class="trophy-cal-detail-stat-value">' + _timerFormat(day.seconds || 0) + '</div>' +
                '<div class="trophy-cal-detail-stat-label">Time</div>' +
            '</div>' +
            '<div class="trophy-cal-detail-stat">' +
                '<svg viewBox="0 0 20 20" fill="#7aaaff"><path d="M10,2 L18,10 L10,18 L2,10 Z"/></svg>' +
                '<div class="trophy-cal-detail-stat-value">' + day.keyframes + '</div>' +
                '<div class="trophy-cal-detail-stat-label">Keyframes</div>' +
            '</div>' +
            '<div class="trophy-cal-detail-stat">' +
                '<svg viewBox="0 0 20 20" fill="none" stroke="#7aaaff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="16" height="9" rx="1.5"/><line x1="2" y1="10" x2="18" y2="10"/></svg>' +
                '<div class="trophy-cal-detail-stat-value">' + day.layers + '</div>' +
                '<div class="trophy-cal-detail-stat-label">Layers</div>' +
            '</div>' +
            '<div class="trophy-cal-detail-stat">' +
                '<svg viewBox="0 0 20 20" fill="none" stroke="#7aaaff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10,3 V12"/><polyline points="6.5,8.5 10,12 13.5,8.5"/><path d="M4,13.5 V15.5 A1.2,1.2 0 0,0 5.2,16.7 H14.8 A1.2,1.2 0 0,0 16,15.5 V13.5"/></svg>' +
                '<div class="trophy-cal-detail-stat-value">' + day.exports + '</div>' +
                '<div class="trophy-cal-detail-stat-label">Exports</div>' +
            '</div>' +
            '<div class="trophy-cal-detail-stat">' +
                '<svg viewBox="0 0 20 20" fill="#e8c140"><polygon points="10,2 12.4,7.6 18.5,8.2 13.9,12.2 15.3,18.2 10,15 4.7,18.2 6.1,12.2 1.5,8.2 7.6,7.6"/></svg>' +
                '<div class="trophy-cal-detail-stat-value">' + day.score + '</div>' +
                '<div class="trophy-cal-detail-stat-label">Points</div>' +
            '</div>' +
        '</div>';
}

function _openTrophyCalendar() {
    var overlay = document.getElementById('trophyCalOverlay');
    if (!overlay) return;
    _trophyCalMonthOffset = 0;
    _renderTrophyCalendar();
    _trophyCalResetDetail();
    overlay.classList.remove('trophy-cal-hidden');
}

function _closeTrophyCalendar() {
    var overlay = document.getElementById('trophyCalOverlay');
    if (overlay) overlay.classList.add('trophy-cal-hidden');
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function() {
    restoreActiveTab();
    _shapeSelInit();
    _anchorModeInit();
    _ignoreMasksRefreshButton();
    _initAnchorIgnoreMasksSquare();
    _easeInterpInit();
    _initEaseInterpSquare();
    _easeSelIndicatorRender();
    _splitTextInit();
    _initAnchorTiers();
    _initAnchorGridGlow();
    _initAnchorBtnHoverAnim();
    restoreClassicOrder();
    restoreClassicCollapsed();
    restoreLayoutMode();
    _renderAllQuickActions();
    _blInitControls();
    _blApplyLayout();
    restoreHighContrast();
    restoreSmartStack();
    restoreScoringSetting();
    initToolsSearch();
    _initToolsFilterCompact();
    restoreCollapsed();
    restoreScale();
    _bcsInit();
    _brnInit();
    _cpInitScrubs();
    _cpDrawHueCanvas();
    _initHeaderWidthScrub();
    _activityInit();
    _timerInit();
    setInterval(_pollKeyAlignMode, 300);
    setInterval(_pollShapeColorHud, 1000);
    setInterval(_pollFavSmartStack, 300);
    setInterval(_pollEaseGraph, 250);
    // The activity poll's own interval is started by restoreScoringSetting()
    // above instead of unconditionally here — see _activityApplyScoringEnabled.

    // Distribute pickers' own star buttons (favorite a Z/Path/Radial/Grid
    // distribute mode) persist independently of any UI chrome — just load
    // the saved state so their stars render correctly.
    _loadFavorites();

    var scaleEl = document.getElementById('scaleSlider');
    if (scaleEl) {
        scaleEl.addEventListener('input', function() {
            var val = parseInt(scaleEl.value, 10);
            applyScale(val);
            try { localStorage.setItem('lineup-scale', val); } catch(e) {}
        });
    }

    // Restrict numeric inputs
    ['marginInput','radialInput','gridColsInput','gridRowsInput','gridHPadInput','gridVPadInput','autoCropPad'].forEach(function(id) {
        var el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', function() {
            var raw   = el.value;
            var clean = raw.replace(/[^0-9.\-]/g, '');
            clean = clean.replace(/(?!^)-/g, '');
            var parts = clean.split('.');
            if (parts.length > 2) clean = parts[0] + '.' + parts.slice(1).join('');
            if (clean !== raw) el.value = clean;
            _syncAlignEdgesDim();
        });
    });
    _syncAlignEdgesDim();

    // Grid distribute button: right-click → picker at cursor
    var gridDistBtn = document.getElementById('gridDistBtn');
    if (gridDistBtn) {
        gridDistBtn.addEventListener('contextmenu', function(e) {
            e.preventDefault();
            _openGridPicker(e.clientX, e.clientY);
        });
    }

    // Radial distribute button: right-click → radius picker
    var radialDistBtn = document.getElementById('radialDistBtn');
    if (radialDistBtn) {
        radialDistBtn.addEventListener('contextmenu', function(e) {
            e.preventDefault();
            _openRadialPicker(e.clientX, e.clientY);
        });
    }

    // Z-depth distribute button: right-click → depth range picker
    var zDistBtn = document.getElementById('zDistBtn');
    if (zDistBtn) {
        zDistBtn.addEventListener('contextmenu', function(e) {
            e.preventDefault();
            _openZPicker(e.clientX, e.clientY);
        });
    }

    // Path distribute button: right-click → spacing/rotation picker
    var pathDistBtn = document.getElementById('pathDistBtn');
    if (pathDistBtn) {
        pathDistBtn.addEventListener('contextmenu', function(e) {
            e.preventDefault();
            _openPathPicker(e.clientX, e.clientY);
        });
    }

    // Project Structure: load persisted presets so the modal has data ready
    _loadStructPresets();

});
