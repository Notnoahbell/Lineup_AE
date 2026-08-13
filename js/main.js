/* Lineup CEP — Panel JavaScript */

var cs = new CSInterface();

// ── Tabs (Home / Tools) ──────────────────────────────────────────────────────
// Settings has no tab of its own — it's the popup opened by openSettingsPopup.

// Tab order determines slide direction — later tab slides right, earlier slides left.
var TAB_ORDER = ['home', 'tools', 'trophy'];
var _activeTabName = 'home'; // matches the panel/button markup's own default-active tab
var _tabSwitchSeq = 0;

// Slight nudge with a hard cut mid-slide (not a full cross-fade) — reads as one continuous S-curve flick-and-settle motion.
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
    // Classic's own Trophy toggle — same active/inactive convention as the tab buttons.
    var classicTrophyBtn = document.getElementById('classicTrophyBtn');
    if (classicTrophyBtn) classicTrophyBtn.classList.toggle('active', name === 'trophy');
    // The pencil lives in the shared footer but only makes sense on Home.
    var editBtn = document.getElementById('quickActionsEditBtn');
    if (editBtn) editBtn.style.display = (name === 'tools' || name === 'trophy') ? 'none' : '';
    try { localStorage.setItem('lineup-active-tab', name); } catch(e) {}

    var oldPanel = document.getElementById(prevName === 'home' ? 'panel-content' : 'tab-' + prevName);
    var newPanel = document.getElementById(name === 'home' ? 'panel-content' : 'tab-' + name);
    if (!newPanel) return;

    var oldIdx = TAB_ORDER.indexOf(prevName);
    var newIdx = TAB_ORDER.indexOf(name);
    var dir = (oldIdx >= 0 && newIdx >= 0) ? (newIdx - oldIdx) : 0;

    // No real previous panel or no direction to slide in — just cut straight to it.
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
        // cancel(), not just clear style.transform — fill:'forwards' would otherwise silently reassert itself later.
        outAnim.cancel();
        if (mySeq !== _tabSwitchSeq) return; // a later switchTab call already landed on the real final state
        _applyTabPanels(name);
        // Starts from the opposite side of the outgoing panel's end so velocity continues in the same direction across the cut.
        var inAnim = _tabAnimate(newPanel,
            [{ transform: 'translateX(' + (-distance) + 'px)' }, { transform: 'translateX(0)' }],
            { duration: TAB_SLIDE_IN_MS, easing: TAB_SLIDE_IN_EASE }
        );
        inAnim.finished.catch(function() {}).then(function() { inAnim.cancel(); });
    });
}

// Tracked per element (not globally) since outgoing/incoming animations can run concurrently on different panels.
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
    // .tools-body's bottom fade can go stale while hidden (e.g. panel resized on another tab), so re-check on arrival.
    if (name === 'tools') {
        _syncToolsBodyFade();
        _animateToolsGridIn();
    }
}

// Distance (px) of scroll over which a fade ramps from 0 to full strength — matches the fade band's
// own height, so it's fully gone by the time that band would otherwise have started overlapping
// content past the edge.
var TOOLS_FADE_DISTANCE = 90;

// Which edge(s) still have more content to scroll to, and how MUCH, can only be read from the DOM
// (scrollTop/scrollHeight/clientHeight) — each fade is a continuous 0..1 ramp off actual distance
// scrolled from that edge (not just an on/off "does it overflow at all"), so it visibly retracts as
// you approach an edge instead of holding full strength right up until scroll hits exactly 0/max and
// then vanishing all at once. A short/filtered list with no overflow at all computes 0 for both.
function _syncToolsBodyFade() {
    var grid = document.querySelector('.tools-grid');
    var body = document.querySelector('.tools-body');
    if (!grid || !body) return;
    var maxScroll = grid.scrollHeight - grid.clientHeight;
    var topT = 0, bottomT = 0;
    if (maxScroll > 0) {
        topT    = Math.max(0, Math.min(1, grid.scrollTop / TOOLS_FADE_DISTANCE));
        bottomT = Math.max(0, Math.min(1, (maxScroll - grid.scrollTop) / TOOLS_FADE_DISTANCE));
    }
    body.style.setProperty('--fade-top-t', topT.toFixed(3));
    body.style.setProperty('--fade-bottom-t', bottomT.toFixed(3));
}

function _initToolsBodyFadeScroll() {
    var grid = document.querySelector('.tools-grid');
    if (!grid) return;
    grid.addEventListener('scroll', _syncToolsBodyFade);
}

function restoreActiveTab() {
    var mode;
    try { mode = localStorage.getItem('lineup-layout-mode'); } catch(e) {}
    var name;
    try { name = localStorage.getItem('lineup-active-tab'); } catch(e) {}
    if (mode === 'classic') {
        // Classic hides the tab bar entirely (no Tools), but Trophy has its own footer button so it can still restore.
        if (name === 'trophy') switchTab(name);
        return;
    }
    if (mode === 'toolbar') {
        // Toolbar hides the tab bar and footer entirely, so neither tab ever restores.
        return;
    }
    if (name === 'tools' || name === 'trophy') switchTab(name);
}

// Classic's footer Trophy button only ever has Home underneath it, so "toggle"
// means "go there, or back if already there" — unlike switchTab's one-way
// "go to this specific tab".
function _toggleClassicTrophyTab() {
    switchTab(_activeTabName === 'trophy' ? 'home' : 'trophy');
}

// ── Home layout ──────────────────────────────────────────────────────────────
// Compact's bento boards are two 6-col CSS Grids, #homeTopGroup and #homeGrid; --home-anchor-unit sizes rowspan-1 boxes to half of Anchor's rendered height.

function _homeBoxes() {
    return Array.prototype.slice.call(document.querySelectorAll('#homeTopGroup .tool-box[data-block-id], #homeGrid .tool-box[data-block-id]'));
}

// Sums Anchor's natural content (not the stretched tool-body height) to avoid a
// circular feedback loop with --home-anchor-unit. Non-narrow-stack temporarily
// resets .anchor-tools-group's flex to its natural size just for this measurement.
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
        var modeCluster = toolsGroup.querySelector('.anchor-mode-cluster');
        var nullCluster = toolsGroup.querySelector('.anchor-null-cluster');
        var prevGroupAlign  = toolsGroup.style.alignSelf;
        var prevModeFlex    = modeCluster ? modeCluster.style.flex : '';
        var prevClusterFlex = nullCluster ? nullCluster.style.flex : '';
        toolsGroup.style.alignSelf = 'flex-start';
        if (modeCluster) modeCluster.style.flex = '0 0 auto';
        if (nullCluster) nullCluster.style.flex = '0 0 auto';
        toolsH = toolsGroup.getBoundingClientRect().height;
        toolsGroup.style.alignSelf = prevGroupAlign;
        if (modeCluster) modeCluster.style.flex = prevModeFlex;
        if (nullCluster) nullCluster.style.flex = prevClusterFlex;
    }
    return rowH + gap + toolsH + padding;
}

function _syncAnchorRowUnit() {
    var grid = document.getElementById('homeTopGroup');
    if (!grid) return;

    // gBCR reports zoomed-down values but --home-anchor-unit is read in pre-zoom space — divide by zoom to avoid double-shrinking.
    var zoom = parseFloat(grid.style.zoom) || 1;

    // Quick Actions and Favorite each get half of Anchor's natural height by default.
    var h = _anchorNaturalHeight();
    if (h > 0) grid.style.setProperty('--home-anchor-unit', (h / zoom / 2) + 'px');
}

// ── Anchor responsive tiers ──────────────────────────────────────────────────
// Two bands off #homeToolGrid width: below NARROW_STACK_THRESHOLD every widget goes full-width/stacked; below ANCHOR_TINY_THRESHOLD is a "tiny" sub-tier nothing hooks into yet.
var NARROW_STACK_THRESHOLD = 330;
var ANCHOR_TINY_THRESHOLD = 275; // halfway between NARROW_STACK_THRESHOLD (330) and the panel's own MinSize width (220)
var VECTORTOOLS_TITLE_DROP_WIDTH = 300; // below this, "Shape Tools" drops even in one-line (data-span="6") mode
// #homeTopGroup's width at the panel's full max-width — the "zoom:1" reference point.
var TOP_GROUP_REFERENCE_WIDTH = 550;
// Floored higher than the raw ratio (0.6) so text/icons stop shrinking before it gets hard to read.
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
        // Use #homeToolGrid's width (never zoomed) minus its 20px padding, not #homeTopGroup's own already-zoomed rect.
        var topGroupWidth = width - 20;
        topGroup.style.zoom = isNarrow ? '' :
            String(Math.min(1, Math.max(TOP_GROUP_ZOOM_FLOOR, topGroupWidth / TOP_GROUP_REFERENCE_WIDTH)));
    }

    // Bottom Layout/Quick Actions only care about the narrow-stack band, so only re-tile when it changed.
    if (narrowChanged) {
        _blApplyLayout(); // re-syncs quickactions2's placeholders too (see its tail)
        var qaMainGrid = document.getElementById(QA_INSTANCES.main.gridId);
        if (qaMainGrid) _qaSyncAddTiles('main', qaMainGrid);
    }
    // Settle label-dropping synchronously before measuring below, to avoid a one-frame height spill during continuous shrink.
    _syncCtrlRowLabels();
    _syncVectortoolsTitle(width);
    // Anchor's natural height depends on the active tier/zoom, so always recompute — not just on narrowChanged.
    _syncAnchorRowUnit();
}

// Half-width/Favorite always hides "Shape Tools" via CSS; one-line (data-span="6")
// only hides it below VECTORTOOLS_TITLE_DROP_WIDTH — which also governs narrow-stack
// since that forces every widget to data-span="6" regardless of real pairing.
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

// Cursor-follow spotlight on the anchor grid — runs its own eased-position loop only while the pointer is over the grid.
// The 3x3 and 5x5 grids (see _buildAnchor5x5Grid) each need their own listeners since only one is ever
// visible at a time, so _anchorGlowActiveGrid tracks whichever one the pointer most recently entered.
var _anchorGlowRAF = null;
var _anchorGlowActiveGrid = null;
var _anchorGlowRawX = -9999, _anchorGlowRawY = -9999;
var _anchorGlowX = -9999, _anchorGlowY = -9999;

function _anchorGlowMove(e) {
    _anchorGlowRawX = e.clientX;
    _anchorGlowRawY = e.clientY;
}

function _anchorGlowTick() {
    var grid = _anchorGlowActiveGrid;
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
    var grids = document.querySelectorAll('.anchor-row .anchor-grid');
    for (var i = 0; i < grids.length; i++) {
        (function(grid) {
            grid.addEventListener('mouseenter', function(e) {
                // Snap the eased position to the cursor immediately instead of easing in from off-screen.
                _anchorGlowActiveGrid = grid;
                _anchorGlowRawX = _anchorGlowX = e.clientX;
                _anchorGlowRawY = _anchorGlowY = e.clientY;
                document.addEventListener('mousemove', _anchorGlowMove);
                if (!_anchorGlowRAF) _anchorGlowRAF = requestAnimationFrame(_anchorGlowTick);
            });
            grid.addEventListener('mouseleave', function() {
                document.removeEventListener('mousemove', _anchorGlowMove);
                if (_anchorGlowRAF) { cancelAnimationFrame(_anchorGlowRAF); _anchorGlowRAF = null; }
                _anchorGlowActiveGrid = null;
            });
        })(grids[i]);
    }
}

// Align/Distribute/Sort's header row drops its label first, then Align/Distribute
// also drop "Offset"'s own word if still overflowing (Sort has no such toggle).
// Compact only; Shape Tools' title uses a separate, simpler rule (see below).
function _syncCtrlRowLabels() {
    // Anchor on .tool-body, not .tool-box — tool-body relocates into the Favorite slot when starred, which has no .tool-box ancestor.
    var rows = ['alignlayers', 'distribute', 'sort'].map(function(id) {
        return document.querySelector('.tool-body[data-block-id="' + id + '"] .ctrl-row');
    }).filter(Boolean);
    if (!rows.length) return;

    // Batched across all 3 rows — one forced reflow per pass instead of one per row (called continuously during resize).
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

// ── Layout mode (Compact / Classic / Toolbar) ────────────────────────────────
// Each tool's .tool-body node physically relocates between Compact's tool-box and Classic's section-body; Toolbar hosts fresh single-action clones instead and is never routed by CLASSIC_BLOCK_IDS.
var CLASSIC_BLOCK_IDS = ['anchor', 'organize', 'ease', 'markers', 'alignlayers', 'distribute', 'sizing', 'autocrop', 'sort', 'vectortools'];

function setLayoutMode(mode) {
    if (mode !== 'classic' && mode !== 'toolbar') mode = 'compact';
    try { localStorage.setItem('lineup-layout-mode', mode); } catch(e) {}
    // Switching to Classic mid-session may be sitting on Tools right now, which Classic hides — force Home first so the user isn't stranded.
    if (mode === 'classic' && _activeTabName === 'tools') switchTab('home');
    // Toolbar hides the tab bar and footer entirely, so force Home away from either Tools or Trophy.
    if (mode === 'toolbar' && _activeTabName !== 'home') switchTab('home');
    _applyLayoutMode(mode);
}

function restoreLayoutMode() {
    var mode;
    try { mode = localStorage.getItem('lineup-layout-mode'); } catch(e) {}
    _applyLayoutMode(mode === 'classic' ? 'classic' : (mode === 'toolbar' ? 'toolbar' : 'compact'));
}

// ── Shared modal backdrop: click-OUTSIDE to close, not drag-ends-outside ────
// Tracks mousedown/mouseup directly (only closes if BOTH land on the backdrop itself) since a native click's target can be the backdrop even when a drag started/ended inside the modal.
var _overlayBackdropDown = null; // the backdrop element mousedown last landed directly on, or null

function _overlayMouseDown(e) {
    _overlayBackdropDown = (e.target === e.currentTarget) ? e.currentTarget : null;
}
function _overlayMouseUp(e, closeFn) {
    var wasDown = _overlayBackdropDown === e.currentTarget;
    _overlayBackdropDown = null;
    if (wasDown && e.target === e.currentTarget) closeFn();
}

// ── Resizable modal "screens" ─────────────────────────────────────────────────
// Drag-to-resize for the scrollable item list inside Batch Comp Settings, Batch Rename, Bulk
// Replace, and Comp Export (any .bcs-complist, wired up generically via .bcs-resize-handle's
// data-resize-target — see the markup in index.html). The handle lives on the list itself, not the
// modal shell around it: the modal has no explicit height of its own, so growing the list directly
// is what makes the whole modal grow to fit it, rather than resizing a fixed-size shell around a
// still-tiny list.
var BCS_LIST_MIN_HEIGHT = 60;
var BCS_LIST_MAX_HEIGHT = 640;

function _bcsResizeStart(e, handle) {
    var list = document.getElementById(handle.getAttribute('data-resize-target'));
    if (!list) return;
    e.preventDefault();
    var startY = e.clientY;
    // getBoundingClientRect() reports real/rendered pixels (already multiplied by the modal's own
    // zoom — see _uiZoom), but the height this sets below is read in LOCAL px inside that zoomed
    // modal, where 1 local px renders as _uiZoom real px. Dividing here converts back to local units
    // before combining with the (still-real-pixel) mouse delta below — skip it and the list would
    // grow/shrink faster or slower than the cursor itself whenever the panel scale isn't 1.
    var startHeight = list.getBoundingClientRect().height / _uiZoom;
    // CSS caps this list at 92px by default (see .bcs-complist) so short lists shrink to fit instead
    // of leaving dead space — that same cap would otherwise clamp any drag right back down to 92px,
    // so lifting it here (once, on first drag) is what actually lets the list grow past it.
    list.style.maxHeight = BCS_LIST_MAX_HEIGHT + 'px';
    handle.classList.add('dragging');

    function onMove(ev) {
        var h = startHeight + (ev.clientY - startY) / _uiZoom;
        h = Math.max(BCS_LIST_MIN_HEIGHT, Math.min(BCS_LIST_MAX_HEIGHT, h));
        list.style.height = h + 'px';
    }
    function onUp() {
        handle.classList.remove('dragging');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
}

function _initBcsResizeHandles() {
    var handles = document.querySelectorAll('.bcs-resize-handle');
    for (var i = 0; i < handles.length; i++) {
        (function(handle) {
            handle.addEventListener('mousedown', function(e) { _bcsResizeStart(e, handle); });
        })(handles[i]);
    }
}

// ── Settings popup ────────────────────────────────────────────────────────────
// Opened via the gear button; no tab of its own. Styled like other .settings-overlay
// dialogs, with .settings-popup-visible added a frame later so the fade-in animates.
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
    // .settings-as-popup only comes off after the fade-out finishes, not immediately, to avoid snapping mid-transition.
    setTimeout(function() { panel.classList.remove('settings-as-popup'); }, 160);
}

// ── What's New popup ──────────────────────────────────────────────────────────
// Shown once per upgrade for versions listed below; a plain patch bump with no entry stays silent.
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
    ],
    '1.9.5': [
        {
            icon: '<svg viewBox="0 0 20 20" fill="currentColor"><rect x="2" y="2" width="7" height="7" rx="2"/><rect x="11" y="2" width="7" height="7" rx="2"/><rect x="2" y="11" width="7" height="7" rx="2"/><rect x="11" y="11" width="7" height="7" rx="2"/></svg>',
            title: 'Toolbar Mode',
            body: "A third layout, alongside Compact and Classic — just a clean, paginated grid of the tool buttons you choose. No header or footer; right-click the grid for Settings."
        },
        {
            icon: '<svg viewBox="-11.6 -11.6 42.7 42.7" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><defs><mask id="whatsNewSmartSelectMask" maskUnits="userSpaceOnUse" x="-13" y="-13" width="46" height="46"><rect x="-13" y="-13" width="46" height="46" fill="#fff" stroke="none"/><path d="M11,11 L16.92,25.3 L20.65,19.78 L26.59,16.27 Z" fill="#000" stroke="#000" stroke-width="7.85" stroke-linejoin="round"/></mask></defs><rect x="-5.96" y="-5.96" width="30.35" height="30.35" rx="7.14" stroke-width="2.78" stroke-dasharray="3.93,3.57" opacity="0.55" mask="url(#whatsNewSmartSelectMask)"/><path d="M-2.21,-11.49 Q0.089,-4.507 7.07,-2.21 Q0.089,0.089 -2.21,7.07 Q-4.507,0.089 -11.49,-2.21 Q-4.507,-4.507 -2.21,-11.49 Z" fill="currentColor" stroke="none"/><path d="M11,11 L16.92,25.3 L20.65,19.78 L26.59,16.27 Z" fill="currentColor" stroke="currentColor" stroke-width="3.21" stroke-linejoin="round"/></svg>',
            title: 'Smart Select',
            body: "Select, Link, and Merge are now one button — click to rerun whichever you used last, right-click to switch between them."
        }
    ],
    '1.10.0': [
        {
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" stroke-linecap="round"><path d="M3.9 4a8.1 8.1 0 0 0 16.2 0Z"/><path d="M8 12L6 21M16 12L18 21M7 16h10"/></svg>',
            title: 'BBQC Companion Panel',
            body: "BBQC now ships alongside Lineup and stays updated automatically. If you don't have it installed, this update will offer to set it up — or install it anytime from Settings."
        }
    ]
};

// lastSeen is only absent on a genuinely fresh install — record it silently and
// skip the popup so new users aren't shown an "upgrade" notice on first install.
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
    var isToolbar   = mode === 'toolbar';
    var isCompact   = !isClassic && !isToolbar;
    var compactGrid = document.getElementById('homeGrid');
    var compactTop  = document.getElementById('homeTopGroup');
    var classicGrid = document.getElementById('homeClassic');
    var toolbarGrid = document.getElementById('homeToolbar');
    var clsBlock    = document.getElementById('classicSettingsBlock');

    // Classic/Toolbar both hide the tab bar and Quick Actions edit pencil via CSS off these two classes.
    document.body.classList.toggle('layout-classic', isClassic);
    document.body.classList.toggle('layout-toolbar', isToolbar);
    // Re-check the held-Alt 5x5 grid (Compact-only) — switching mode via a menu/click doesn't release
    // Alt, so without this it could stay stuck showing 5x5 after landing on Classic/Toolbar.
    _syncAnchorAltGrid();

    // Toolbar has no composite panels of its own, so this loop never routes anything there — non-Classic always lands back in Compact.
    CLASSIC_BLOCK_IDS.forEach(function(id) {
        var body = document.querySelector('.tool-body[data-block-id="' + id + '"]');
        if (!body) return;
        if (isClassic) {
            var target = document.querySelector('#homeClassic .section-body[data-body-for="' + id + '"]');
            if (target && body.parentElement !== target) target.appendChild(body);
        } else if (id === 'organize') {
            // Compact never shows Organize's original controls (it has its own Quick Actions widget) — stashed here unused so Classic can still relocate it.
            var stash = document.getElementById('sec-organize-original');
            if (stash && body.parentElement !== stash) stash.appendChild(body);
        } else {
            var box = document.querySelector('.tool-box[data-block-id="' + id + '"]');
            if (!box || body.parentElement === box) return;
            box.appendChild(body);
        }
    });

    // Null/Copy-Paste has no Compact/Toolbar home (kept hidden in #sec-nullcp); in Classic it docks beside the Anchor grid.
    var nullcp = document.querySelector('.cp-panel[data-block-id="nullcp"]');
    var anchorRow = document.getElementById('anchorRow');
    if (nullcp && anchorRow) {
        var nullcpHome = isClassic ? anchorRow : document.getElementById('sec-nullcp');
        if (nullcpHome && nullcp.parentElement !== nullcpHome) nullcpHome.appendChild(nullcp);
    }

    if (compactGrid) compactGrid.style.display = isCompact ? '' : 'none';
    if (compactTop)   compactTop.style.display  = isCompact ? '' : 'none';
    if (classicGrid) classicGrid.style.display = isClassic ? '' : 'none';
    if (toolbarGrid)  toolbarGrid.style.display = isToolbar ? '' : 'none';
    // Accordion open/closed (not instant display:none) so the Settings popup grows/shrinks into it.
    if (clsBlock)     clsBlock.classList.toggle('classic-sections-open', isClassic);

    // The Favorite slot only exists in Compact.
    if (isCompact) _favApplyLayout();

    document.querySelectorAll('.layout-mode-btn').forEach(function(btn) {
        btn.classList.toggle('active', btn.getAttribute('data-mode') === mode);
    });

    _applySharedHiddenState();
    if (isClassic) _renderClassicSettingsList();
    if (isToolbar) _toolbarRender();

    // Forces the activity poll off while Toolbar is active, restoring the saved preference on switch-away; no animation since Trophy is never visible during a mode switch.
    _activityApplyScoringEnabled(_scoringShouldBeActive(), false);
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
// Single source of truth for "which tools are hidden," applied to both layouts.

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
// Whether the bar can auto-jump pages at all; disabling resets _favSmartWasVisible so re-enabling recalibrates instead of firing a stale edge.
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
    // Only on an actual group switch, not every search keystroke (applyToolsFilter alone handles
    // that) — retyping a search on every character would make the tiles reflow-animate constantly.
    _animateToolsGridIn();
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
    _syncToolsBodyFade();
}

// ── Tools favorites + alphabetical ordering ──────────────────────────────────
// Separate namespace from _favorites/lineup-favorites (the distribute pickers'
// star buttons) — same star SVGs, different thing being favorited.

var _toolsFavorites = {};

function _loadToolsFavorites() {
    try { _toolsFavorites = JSON.parse(localStorage.getItem('lineup-tools-favorites') || '{}'); } catch(e) { _toolsFavorites = {}; }
}

function _saveToolsFavorites() {
    try { localStorage.setItem('lineup-tools-favorites', JSON.stringify(_toolsFavorites)); } catch(e) {}
}

function _isToolFavorited(id) {
    return !!_toolsFavorites[id];
}

function _toggleToolFavorite(id) {
    if (_toolsFavorites[id]) { delete _toolsFavorites[id]; } else { _toolsFavorites[id] = 1; }
    _saveToolsFavorites();
    _sortToolsGrid();
}

// Reorders tiles alphabetically by their label (favorites first, alphabetical
// within each group), and syncs each tile's favorite badge. appendChild on an
// already-attached node moves it rather than duplicating, so this can safely
// re-run on every toggle without rebuilding the grid.
function _sortToolsGrid() {
    var grid = document.querySelector('.tools-grid');
    if (!grid) return;
    var tiles = Array.prototype.slice.call(grid.querySelectorAll('.tools-grid-btn[data-tool-id]'));
    tiles.forEach(function(t) {
        var fav = _isToolFavorited(t.getAttribute('data-tool-id'));
        t.classList.toggle('is-favorite', fav);
    });
    tiles.sort(function(a, b) {
        var favA = _isToolFavorited(a.getAttribute('data-tool-id'));
        var favB = _isToolFavorited(b.getAttribute('data-tool-id'));
        if (favA !== favB) return favA ? -1 : 1;
        var labelA = (a.querySelector('span') || {}).textContent || '';
        var labelB = (b.querySelector('span') || {}).textContent || '';
        return labelA.toLowerCase().localeCompare(labelB.toLowerCase());
    });
    tiles.forEach(function(t) { grid.appendChild(t); });
    _syncToolsBodyFade();
}

// Right-click on a tile flips open a single-item "Favorite"/"Remove Favorite"
// flyout, built on the same generic .fav-ctx shell as _shapeSelCtx.
var _toolsFavCtx = null;
var _toolsFavCtxBtn = null;
var _toolsFavCtxTileId = null;

function _buildToolsFavCtx() {
    var el = document.createElement('div');
    el.className = 'fav-ctx';
    var row = document.createElement('div');
    row.className = 'shape-sel-ctx-row';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'shape-sel-ctx-icon-btn';
    btn.addEventListener('click', function() {
        if (_toolsFavCtxTileId) _toggleToolFavorite(_toolsFavCtxTileId);
        _closeToolsFavCtx();
    });
    row.appendChild(btn);
    el.appendChild(row);
    document.body.appendChild(el);
    _toolsFavCtxBtn = btn;
    return el;
}

function _openToolsFavCtx(tile, e) {
    if (!_toolsFavCtx) _toolsFavCtx = _buildToolsFavCtx();
    var container = tile.closest('.tab-panel') || document.body;
    container.appendChild(_toolsFavCtx);
    _toolsFavCtxTileId = tile.getAttribute('data-tool-id');
    var active = _isToolFavorited(_toolsFavCtxTileId);
    _toolsFavCtxBtn.classList.toggle('active', active);
    _toolsFavCtxBtn.innerHTML = (active ? _FAV_STAR_SVG_FILL : _FAV_STAR_SVG) +
        '<span class="shape-sel-ctx-lbl">' + (active ? 'Remove Favorite' : 'Favorite') + '</span>';

    var containerRect = container.getBoundingClientRect();
    var cw = container.clientWidth, ch = container.clientHeight;
    var cx = e.clientX - containerRect.left;
    var cy = e.clientY - containerRect.top;
    var ctxW = _toolsFavCtx.offsetWidth;
    var ctxH = _toolsFavCtx.offsetHeight;
    var left = Math.min(Math.max(4, cx), cw - ctxW - 4);
    var top = (cy + ctxH <= ch) ? cy : Math.max(4, cy - ctxH);
    _toolsFavCtx.style.left = left + 'px';
    _toolsFavCtx.style.top = top + 'px';
    _toolsFavCtx.classList.add('visible');
    setTimeout(function() {
        document.addEventListener('mousedown', _toolsFavCtxOutside);
        document.addEventListener('keydown', _toolsFavCtxKey);
    }, 0);
}

function _closeToolsFavCtx() {
    if (_toolsFavCtx) _toolsFavCtx.classList.remove('visible');
    _toolsFavCtxTileId = null;
    document.removeEventListener('mousedown', _toolsFavCtxOutside);
    document.removeEventListener('keydown', _toolsFavCtxKey);
}

function _toolsFavCtxOutside(e) {
    if (_toolsFavCtx && !_toolsFavCtx.contains(e.target)) _closeToolsFavCtx();
}

function _toolsFavCtxKey(e) {
    if (e.key === 'Escape') _closeToolsFavCtx();
}

function _initToolsFavContextMenu() {
    var grid = document.querySelector('.tools-grid');
    if (!grid) return;
    grid.addEventListener('contextmenu', function(e) {
        var tile = e.target.closest ? e.target.closest('.tools-grid-btn[data-tool-id]') : null;
        if (!tile) return;
        // Smart Select/Link/Merge, Select Paths/Fill/Stroke, and Split Text already open
        // their own mode-picker flyout on right-click — Favorite is folded into that
        // instead (see _syncFavRowInCtx), so this standalone popup steps aside for them.
        if (tile.classList.contains('smart-btn') || tile.classList.contains('shape-sel-btn') || tile.classList.contains('split-text-btn')) return;
        e.preventDefault();
        _openToolsFavCtx(tile, e);
    });
}

// Row-staggered "slide up + subtle 3D tilt" reveal for the tools drawer — plays whenever the visible
// tile set changes wholesale (arriving on the Tools tab, switching filter groups), not on every
// hover/interaction. Rows are grouped by matching offsetTop rather than the grid's current column
// count (which varies by panel width) — more robust than parsing computed grid-template-columns, and
// naturally correct at any breakpoint since CSS Grid already lays same-row tiles out at identical tops.
var _toolsTileAnims = new WeakMap();
var TOOLS_ROW_STAGGER_MS = 60;
var TOOLS_TILE_INTRO_MS = 320;

function _toolsAnimateTileIn(tile, row) {
    var prev = _toolsTileAnims.get(tile);
    if (prev) prev.cancel();
    var anim = tile.animate(
        [
            { opacity: 0, transform: 'perspective(420px) translateY(26px) rotateX(40deg)' },
            { opacity: 1, transform: 'perspective(420px) translateY(0) rotateX(0deg)' }
        ],
        {
            duration: TOOLS_TILE_INTRO_MS,
            delay: row * TOOLS_ROW_STAGGER_MS,
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
            fill: 'both'
        }
    );
    _toolsTileAnims.set(tile, anim);
    anim.onfinish = function() {
        tile.style.opacity = '';
        tile.style.transform = '';
        anim.cancel();
        if (_toolsTileAnims.get(tile) === anim) _toolsTileAnims.delete(tile);
    };
}

function _animateToolsGridIn() {
    var grid = document.querySelector('.tools-grid');
    if (!grid || typeof grid.animate !== 'function') return;
    var tiles = Array.prototype.filter.call(grid.querySelectorAll('.tools-grid-btn'), function (t) {
        return !t.classList.contains('tools-grid-btn-hidden');
    });
    if (!tiles.length) return;

    var row = 0, lastTop = null;
    for (var i = 0; i < tiles.length; i++) {
        var top = tiles[i].offsetTop;
        if (lastTop !== null && top !== lastTop) row++;
        lastTop = top;
        _toolsAnimateTileIn(tiles[i], row);
    }
}

function initToolsSearch() {
    var input = document.getElementById('toolsSearchInput');
    if (!input) return;
    input.addEventListener('input', applyToolsFilter);
}

// Past ~350px the filter column collapses text labels to icon-only, toggled as a single breakpoint (not tied continuously to width) to avoid a half-clipped label mid-drag.
var TOOLS_FILTER_COMPACT_BREAKPOINT = 350; // #tab-tools width at/below which labels collapse to icon-only

function _syncToolsFilterCompact() {
    var tab = document.getElementById('tab-tools');
    var bar = document.getElementById('tabBarEl');
    if (!tab || !bar) return;
    // Measures .tab-bar (never display:none, same width rules as #tab-tools), not #tab-tools itself which reports 0 width while hidden.
    var w = bar.getBoundingClientRect().width;
    tab.classList.toggle('compact', w < TOOLS_FILTER_COMPACT_BREAKPOINT);
    // Column count and available height both change with this resize, either of which can flip whether the list overflows.
    _syncToolsBodyFade();
}

function _initToolsFilterCompact() {
    var bar = document.getElementById('tabBarEl');
    if (!bar || typeof ResizeObserver === 'undefined') return;
    new ResizeObserver(function() { _syncToolsFilterCompact(); }).observe(bar);
}

// Cursor-follow spotlight per tile — same recipe as the Anchor Point grid's own glow
// (_anchorGlowTick/_initAnchorGridGlow), but scoped to whichever single tile in the tools drawer is
// currently hovered rather than one fixed container, since the drawer can hold dozens of tiles and
// only ever one is ever glowing at a time.
var _toolsGlowRAF = null;
var _toolsGlowActiveBtn = null;
var _toolsGlowRawX = -9999, _toolsGlowRawY = -9999;
var _toolsGlowX = -9999, _toolsGlowY = -9999;

// Max tilt in either axis for the cursor-driven "3D card" rotation below — a cursor sitting right at
// a tile's edge maps to exactly this many degrees, center maps to 0.
var TOOLS_TILT_MAX_DEG = 12;

function _toolsGlowTick() {
    var btn = _toolsGlowActiveBtn;
    if (!btn) { _toolsGlowRAF = null; return; }
    var dx = _toolsGlowRawX - _toolsGlowX, dy = _toolsGlowRawY - _toolsGlowY;
    _toolsGlowX += dx * 0.16;
    _toolsGlowY += dy * 0.16;
    var rect = btn.getBoundingClientRect();
    var localX = _toolsGlowX - rect.left, localY = _toolsGlowY - rect.top;
    btn.style.setProperty('--glow-x', localX + 'px');
    btn.style.setProperty('--glow-y', localY + 'px');
    // Reuses the same eased local position the glow above just computed, normalized to -1..1 across
    // the tile, so the tilt settles with the same easing feel as the glow rather than snapping to the
    // raw cursor. Moving right tilts the tile around Y (right edge recedes); moving down tilts it
    // around X (bottom edge recedes) — the combination reads as the card tipping toward the cursor.
    var nx = rect.width  ? Math.max(-1, Math.min(1, (localX / rect.width)  * 2 - 1)) : 0;
    var ny = rect.height ? Math.max(-1, Math.min(1, (localY / rect.height) * 2 - 1)) : 0;
    btn.style.setProperty('--tilt-x', (-ny * TOOLS_TILT_MAX_DEG).toFixed(2) + 'deg');
    btn.style.setProperty('--tilt-y', (nx * TOOLS_TILT_MAX_DEG).toFixed(2) + 'deg');
    _toolsGlowRAF = requestAnimationFrame(_toolsGlowTick);
}

function _initToolsGridGlow() {
    var grid = document.querySelector('.tools-grid');
    if (!grid) return;
    grid.addEventListener('mousemove', function(e) {
        var btn = e.target.closest ? e.target.closest('.tools-grid-btn') : null;
        if (btn !== _toolsGlowActiveBtn) {
            // Snap straight to the cursor on entering a new tile instead of easing in from wherever
            // the glow last sat on the previous one — avoids a "flying" glow crossing the gap between tiles.
            _toolsGlowActiveBtn = btn;
            if (btn) { _toolsGlowRawX = _toolsGlowX = e.clientX; _toolsGlowRawY = _toolsGlowY = e.clientY; }
        } else {
            _toolsGlowRawX = e.clientX;
            _toolsGlowRawY = e.clientY;
        }
        if (btn && !_toolsGlowRAF) _toolsGlowRAF = requestAnimationFrame(_toolsGlowTick);
    });
    grid.addEventListener('mouseleave', function() { _toolsGlowActiveBtn = null; });
}

// ── Section toggle ────────────────────────────────────────────────────────────

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
// Backs only the distribute pickers' star buttons now — a separate favorite-button-bar feature that once shared this data was removed.

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

// Whether Left/Center/Right should retime keyframes — keyframes selected AND the override toggle checked. Passed into lineup_align() explicitly rather than re-derived in host.jsx.
var _keyframesPresent = false; // raw: does the Timeline have any keyframes selected right now
var _keyAlignMode     = false; // effective: keyframesPresent AND the toggle is checked — drives the icon swap
// Sticky across selection changes — set the moment the user manually unchecks the toggle, and
// only cleared by manually checking it again (see toggleKeyAlignOverride). Without this,
// _pollKeyAlignMode force-checked the toggle back on every time keyframes were freshly selected,
// so anyone who just wants to nudge layer position visually while keyframes happen to be
// selected had to keep re-unchecking it every single time instead of once.
var _keyAlignUserDisabled = false;
function _keyAlignEffective() {
    var chk = document.getElementById('keyAlignCheck');
    return _keyframesPresent && (!chk || chk.checked);
}

// Icons/tooltips follow the EFFECTIVE state, not raw keyframe presence — unchecking
// the toggle reverts them to normal-align look since that's what they'll actually do.
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
// Only fires on a genuine user click (setting .checked from JS elsewhere does not raise
// 'change'), so this is exactly the "explicit" signal _keyAlignUserDisabled needs: unchecking it
// here is what sets the override; checking it again is the only thing that clears it.
function toggleKeyAlignOverride() {
    var chk = document.getElementById('keyAlignCheck');
    _keyAlignUserDisabled = !!(chk && !chk.checked);
    _applyKeyAlignMode();
}

// Polls whether any keyframe is selected so Align Left/Center/Right can live-swap
// into retiming mode and the override toggle can fade in/out — AE has no
// "selection changed" event, so a cheap interval is the only way to stay in sync.
function _pollKeyAlignMode() {
    var body = document.querySelector('.tool-body[data-block-id="alignlayers"]');
    // Skip the evalScript round-trip entirely when Align isn't visible — a cs.evalScript call is expensive to run every 300ms for nothing.
    if (!body || !body.offsetParent) return;
    cs.evalScript('lineup_hasSelectedKeyframes()', function(result) {
        var present = result === '1';
        if (present === _keyframesPresent) return;
        _keyframesPresent = present;

        var toggle = document.getElementById('keyAlignToggle');
        if (toggle) toggle.classList.toggle('key-align-toggle-visible', present);
        if (present && !_keyAlignUserDisabled) {
            // Defaults to checked every time it (re)appears — UNLESS the user explicitly
            // unchecked it before, in which case _keyAlignUserDisabled leaves it alone here and
            // it just stays unchecked (see toggleKeyAlignOverride).
            var chk = document.getElementById('keyAlignCheck');
            if (chk) chk.checked = true;
        }
        // The toggle's own width (max-width) jumps instantly, not CSS-transitioned — only its
        // opacity fades (see .key-align-toggle) — so the row's real final width is already in
        // place by the very next line; no need to wait on anything before re-measuring. Re-syncs
        // here because normally only a panel RESIZE re-runs _syncCtrlRowLabels, and this toggle
        // appearing/disappearing never resizes anything, so nothing else catches the row
        // overflowing once the toggle's width is added (see the tight/tighter comment block in
        // style.css for the label-dropping this re-engages).
        _syncCtrlRowLabels();
        _applyKeyAlignMode();
    });
}

// ── STAGGER KEYFRAMES ─────────────────────────────────────────────────────────
// Cascades selected keyframes across layers; the preview is an abstracted mockup (fixed row count, 0-1 fraction span) rather than the real selection, computed client-side until Apply.

var STAGGER_DEMO_ROWS   = 6;
var STAGGER_MOCKUP_W    = 200;
var STAGGER_MOCKUP_H    = 135;
var STAGGER_MOCKUP_MARGIN = 14; // keeps diamonds/handles off the very left/right edge

var _staggerLayers        = []; // [{layerIndex, layerName}], Timeline stacking order — real selection, used only for Apply
var _staggerFrameDuration = 1 / 30;
var _staggerOffsets       = []; // seconds, parallel to _staggerLayers — used only for Apply
var _staggerStepFrames    = 2;
var _staggerStepSeconds   = 2 / 30;
var _staggerGroupSizeVal  = 1;
var _staggerCurveEnabled  = false;
var _staggerCurveP1       = { x: 1 / 3, y: 1 / 3 }; // x = layer-progress fraction, y = offset fraction (semantics unchanged by the transposed on-screen mapping below)
var _staggerCurveP2       = { x: 2 / 3, y: 2 / 3 };
var _staggerDragHandle    = null; // 'p1' or 'p2' while a curve handle drag is in progress
var _staggerRandomEnabled = false;
var _staggerRandomSeed    = 1; // same seed -> same arrangement every time, see _staggerSeededRandom
var _staggerReversed      = false; // false = top-down (Timeline stacking order), true = bottom-up
var _staggerStepFramesScrub, _staggerTotalScrub, _staggerGroupSizeScrub, _staggerRandomSeedScrub;
var _staggerUnitMode = 'frames'; // 'frames' | 'seconds' — shared by every _makeStaggerUnitScrub instance (Step and Total), so ctrl/cmd+clicking either one flips both together

// Fixed reference shapes (not the editable preset list below) — Ease In/Out pin
// progress to the shared extreme, Ease In-Out pins each handle to its own corner;
// values are deliberately more extreme than CSS's standard 0.42/0.58.
var STAGGER_EASE_IN_OUT = { p1: { x: 0,    y: 0.5 },  p2: { x: 1, y: 0.5 } };
var STAGGER_EASE_IN     = { p1: { x: 1,    y: 0 },    p2: { x: 1, y: 1 } };
var STAGGER_EASE_OUT    = { p1: { x: 0,    y: 0 },    p2: { x: 0, y: 1 } };

var STAGGER_MAX_PRESETS = 6;
var STAGGER_PRESETS_STORAGE_KEY = 'lineup-stagger-presets';
// User-visible, editable preset list, persisted across sessions; the 3 base presets are flagged builtin:true so they can't be deleted.
var _staggerPresets = [];

function _staggerLoadPresets() {
    try {
        var raw = localStorage.getItem(STAGGER_PRESETS_STORAGE_KEY);
        if (raw) {
            var parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length) { _staggerPresets = parsed; return; }
        }
    } catch (e) {}
    _staggerPresets = [
        { label: 'Ease In-Out', builtin: true, p1: { x: STAGGER_EASE_IN_OUT.p1.x, y: STAGGER_EASE_IN_OUT.p1.y }, p2: { x: STAGGER_EASE_IN_OUT.p2.x, y: STAGGER_EASE_IN_OUT.p2.y } },
        { label: 'Ease In',     builtin: true, p1: { x: STAGGER_EASE_IN.p1.x,     y: STAGGER_EASE_IN.p1.y },     p2: { x: STAGGER_EASE_IN.p2.x,     y: STAGGER_EASE_IN.p2.y } },
        { label: 'Ease Out',    builtin: true, p1: { x: STAGGER_EASE_OUT.p1.x,    y: STAGGER_EASE_OUT.p1.y },    p2: { x: STAGGER_EASE_OUT.p2.x,    y: STAGGER_EASE_OUT.p2.y } }
    ];
}
function _staggerSavePresets() {
    try { localStorage.setItem(STAGGER_PRESETS_STORAGE_KEY, JSON.stringify(_staggerPresets)); } catch (e) {}
}

function openStaggerPopup() {
    var overlay = document.getElementById('staggerOverlay');
    if (!overlay) return;
    cs.evalScript('lineup_getStaggerLayerGroups()', function(result) {
        var data = null;
        try { data = JSON.parse(result); } catch (e) {}
        if (!data || !data.layers || !data.layers.length) {
            showToast('No layers with selected keyframes');
            return;
        }
        _staggerLayers        = data.layers;
        _staggerFrameDuration = data.frameDuration || (1 / 30);
        _staggerStepFrames    = 2;
        _staggerStepSeconds   = 2 * _staggerFrameDuration;
        _staggerGroupSizeVal  = 1;
        _staggerReversed      = false;

        if (_staggerStepFramesScrub)  _staggerStepFramesScrub.render();
        if (_staggerGroupSizeScrub)   _staggerGroupSizeScrub.render();
        if (_staggerRandomSeedScrub)  _staggerRandomSeedScrub.render();
        var directionBtn = document.getElementById('staggerDirectionBtn');
        if (directionBtn) directionBtn.classList.remove('is-reversed');
        _staggerRenderPresetList();
        _staggerSetRandomEnabled(false);
        _staggerSetCurveEnabled(false); // also recomputes + renders the mockup

        overlay.classList.remove('stagger-hidden');
    });
}

function closeStaggerPopup() {
    var overlay = document.getElementById('staggerOverlay');
    if (overlay) overlay.classList.add('stagger-hidden');
}

// Generic scrubbable number control, same drag/click-to-type interaction as
// Shape Tools' stroke-width scrub. Returns {render, isBusy} so callers can force
// a redraw after changing the underlying value some other way.
function _makeStaggerScrub(el, opts) {
    var getValue = opts.getValue, setValue = opts.setValue;
    var decimals = opts.decimals || 0;
    var suffix = opts.suffix || '';
    var sensitivity = opts.sensitivity || 0.1;
    var min = (typeof opts.min === 'number') ? opts.min : -Infinity;
    var step = opts.step || 0; // 0 = continuous; otherwise snaps the dragged value to this increment
    var drag = null, editing = false;

    function fmt(v) {
        var n = decimals > 0 ? parseFloat(v.toFixed(decimals)) : Math.round(v);
        return n + suffix;
    }
    function quantize(v) { return step > 0 ? Math.round(v / step) * step : v; }
    function render() { if (!editing && !drag) el.textContent = fmt(getValue()); }
    function isBusy() { return editing || !!drag; }

    function onMouseDown(e) {
        if (editing) return;
        e.preventDefault();
        drag = { startX: e.clientX, startVal: getValue(), moved: false };
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }
    function onMouseMove(e) {
        if (!drag) return;
        var dx = e.clientX - drag.startX;
        if (!drag.moved && Math.abs(dx) < 3) return; // dead zone = click vs drag
        drag.moved = true;
        var mult = e.shiftKey ? 10 : 1;
        var newVal = quantize(drag.startVal + dx * sensitivity * mult);
        if (newVal < min) newVal = min;
        el.textContent = fmt(newVal);
        setValue(newVal);
    }
    function onMouseUp() {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        var d = drag; drag = null;
        if (d && !d.moved) openEdit(); // plain click -> type instead of scrub
    }
    function openEdit() {
        editing = true;
        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'stagger-scrub-edit';
        input.value = getValue();
        el.textContent = '';
        el.appendChild(input);
        input.focus();
        input.select();
        function commit() {
            var v = parseFloat(input.value);
            editing = false;
            if (!isNaN(v)) setValue(v < min ? min : v);
            render();
        }
        input.addEventListener('blur', commit);
        input.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') input.blur();
            else if (e.key === 'Escape') { editing = false; render(); }
        });
    }

    el.addEventListener('mousedown', onMouseDown);
    render();
    return { render: render, isBusy: isBusy };
}

// Same interaction as _makeStaggerScrub, but always tracks its value in FRAMES
// (seconds is always derived, never stored) and renders as frames by default.
// Ctrl/Cmd+click flips a per-control display flag to seconds without touching the value.
function _makeStaggerUnitScrub(el, opts) {
    var getFrames = opts.getFrames, setFrames = opts.setFrames;
    var sensitivity = opts.sensitivity || 0.05;
    var min = (typeof opts.min === 'number') ? opts.min : -Infinity;
    var drag = null, editing = false;

    function fmt(frames) {
        if (_staggerUnitMode === 'seconds') {
            return parseFloat((frames * _staggerFrameDuration).toFixed(3)) + ' s';
        }
        return (Math.round(frames * 100) / 100) + ' f';
    }
    function render() { if (!editing && !drag) el.textContent = fmt(getFrames()); }
    function isBusy() { return editing || !!drag; }

    function onMouseDown(e) {
        if (editing) return;
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            // Shared across every unit-scrub instance — flip once and re-render all so Step/Total never show different units.
            _staggerUnitMode = (_staggerUnitMode === 'frames') ? 'seconds' : 'frames';
            _staggerRenderUnitScrubs();
            return; // unit toggle only — never starts a drag or opens edit
        }
        e.preventDefault();
        drag = { startX: e.clientX, startVal: getFrames(), moved: false };
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }
    function onMouseMove(e) {
        if (!drag) return;
        var dx = e.clientX - drag.startX;
        if (!drag.moved && Math.abs(dx) < 3) return; // dead zone = click vs drag
        drag.moved = true;
        var mult = e.shiftKey ? 10 : 1;
        var newVal = drag.startVal + dx * sensitivity * mult;
        if (newVal < min) newVal = min;
        el.textContent = fmt(newVal);
        setFrames(newVal);
    }
    function onMouseUp() {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        var d = drag; drag = null;
        if (d && !d.moved) openEdit(); // plain click -> type instead of scrub
    }
    function openEdit() {
        editing = true;
        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'stagger-scrub-edit';
        // Typed value is in whatever unit is currently displayed, matching what the user sees.
        input.value = _staggerUnitMode === 'seconds' ? (getFrames() * _staggerFrameDuration) : getFrames();
        el.textContent = '';
        el.appendChild(input);
        input.focus();
        input.select();
        function commit() {
            var v = parseFloat(input.value);
            editing = false;
            if (!isNaN(v)) {
                var framesVal = _staggerUnitMode === 'seconds' ? (v / (_staggerFrameDuration || 1)) : v;
                setFrames(framesVal < min ? min : framesVal);
            }
            render();
        }
        input.addEventListener('blur', commit);
        input.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') input.blur();
            else if (e.key === 'Escape') { editing = false; render(); }
        });
    }

    el.addEventListener('mousedown', onMouseDown);
    render();
    return { render: render, isBusy: isBusy };
}

// Re-renders every _makeStaggerUnitScrub instance after _staggerUnitMode
// flips, so Step and Total switch frames/seconds together as one bar.
function _staggerRenderUnitScrubs() {
    if (_staggerStepFramesScrub) _staggerStepFramesScrub.render();
    if (_staggerTotalScrub) _staggerTotalScrub.render();
}

function _staggerInitScrubs() {
    var framesEl = document.getElementById('staggerStepFrames');
    var totalEl = document.getElementById('staggerTotalReadout');
    var groupEl = document.getElementById('staggerGroupSize');
    if (framesEl) {
        _staggerStepFramesScrub = _makeStaggerUnitScrub(framesEl, {
            sensitivity: 0.05,
            getFrames: function() { return _staggerStepFrames; },
            setFrames: function(v) {
                _staggerStepFrames = v;
                _staggerStepSeconds = v * _staggerFrameDuration;
                _staggerRecomputeOffsets();
            }
        });
    }
    if (totalEl) {
        // Scrubbing Total behaves like dragging the ruler — both funnel through _staggerApplyTotalSpanFrames.
        _staggerTotalScrub = _makeStaggerUnitScrub(totalEl, {
            sensitivity: STAGGER_RULER_DRAG_FRAMES_PER_PX,
            min: 0,
            getFrames: function() { return _staggerRulerTotalSpanFrames; },
            setFrames: function(v) { _staggerApplyTotalSpanFrames(v); }
        });
    }
    if (groupEl) {
        _staggerGroupSizeScrub = _makeStaggerScrub(groupEl, {
            decimals: 0, suffix: '', sensitivity: 0.05, min: 1,
            getValue: function() { return _staggerGroupSizeVal; },
            setValue: function(v) {
                _staggerGroupSizeVal = Math.max(1, Math.round(v));
                _staggerRecomputeOffsets();
            }
        });
    }
    var randomSeedEl = document.getElementById('staggerRandomSeed');
    if (randomSeedEl) {
        _staggerRandomSeedScrub = _makeStaggerScrub(randomSeedEl, {
            decimals: 0, suffix: '', sensitivity: 0.25, min: 0,
            getValue: function() { return _staggerRandomSeed; },
            setValue: function(v) {
                _staggerRandomSeed = Math.max(0, Math.round(v));
                _staggerRecomputeOffsets();
            }
        });
    }
}

// The button's .is-active class IS the enabled state and doubles as the preset
// sub-panel's show/hide control. Curve and Random are mutually exclusive — only
// the "turning on" branch cross-disables the other, so this can't recurse.
function _staggerSetCurveEnabled(on) {
    var wasEnabled = _staggerCurveEnabled;
    _staggerCurveEnabled = on;
    if (on) {
        if (_staggerRandomEnabled) _staggerSetRandomEnabled(false);
        if (!wasEnabled) {
            // Ease In-Out reads as a more useful starting shape than a straight diagonal (indistinguishable from curve-off) — just the default.
            _staggerCurveP1 = { x: STAGGER_EASE_IN_OUT.p1.x, y: STAGGER_EASE_IN_OUT.p1.y };
            _staggerCurveP2 = { x: STAGGER_EASE_IN_OUT.p2.x, y: STAGGER_EASE_IN_OUT.p2.y };
        }
    }
    var btn = document.getElementById('staggerCurveToggleBtn');
    if (btn) btn.classList.toggle('is-active', on);
    // #staggerCurvePanel always stays visible now — no show/hide here, unlike #staggerRandomPanel below.
    var showHide = on ? '' : 'none';
    ['staggerCurvePath', 'staggerCurveHandle1', 'staggerCurveHandle2', 'staggerCurveHandleLine1', 'staggerCurveHandleLine2'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.style.display = showHide;
    });
    _staggerRecomputeOffsets(); // re-renders the mockup, which draws the curve path/handles when enabled
}

function _staggerToggleCurve() {
    _staggerSetCurveEnabled(!_staggerCurveEnabled);
}

// Random Settings toggle — mirrors _staggerSetCurveEnabled/#staggerCurveToggleBtn
// exactly (button IS the enabled state, doubles as the sub-panel's show/hide),
// and cross-disables Curve the same way Curve cross-disables Random above.
function _staggerSetRandomEnabled(on) {
    _staggerRandomEnabled = on;
    if (on && _staggerCurveEnabled) _staggerSetCurveEnabled(false);
    var btn = document.getElementById('staggerRandomToggleBtn');
    if (btn) btn.classList.toggle('is-active', on);
    var panel = document.getElementById('staggerRandomPanel');
    if (panel) panel.style.display = on ? 'block' : 'none';
    _staggerRecomputeOffsets();
}

function _staggerToggleRandom() {
    _staggerSetRandomEnabled(!_staggerRandomEnabled);
}

// The only way to get a new arrangement without hand-typing a seed — Math.random()
// picks the seed once (like a dice roll), then everything computed from it is deterministic.
function _staggerRerollSeed() {
    _staggerRandomSeed = Math.floor(Math.random() * 1000000);
    if (_staggerRandomSeedScrub) _staggerRandomSeedScrub.render();
    _staggerRecomputeOffsets();
}

// Flips which end of the layer stack starts the cascade (top-down vs bottom-up).
// The arrow icon rotates 180° via .is-reversed rather than swapping glyphs, so it
// reads as one small animation instead of an instant icon swap.
function _staggerToggleDirection() {
    _staggerReversed = !_staggerReversed;
    var btn = document.getElementById('staggerDirectionBtn');
    if (btn) btn.classList.toggle('is-reversed', _staggerReversed);
    _staggerRecomputeOffsets();
}

function _staggerApplyPresetAt(idx) {
    var preset = _staggerPresets[idx];
    if (!preset) return;
    // Presets always mean "use curve mode" (enabling it if needed) — runs before applying preset values since enabling resets to the Ease In-Out default first.
    if (!_staggerCurveEnabled) _staggerSetCurveEnabled(true);
    _staggerCurveP1 = { x: preset.p1.x, y: preset.p1.y };
    _staggerCurveP2 = { x: preset.p2.x, y: preset.p2.y };
    _staggerRecomputeOffsets();
}

function _staggerRemovePresetAt(idx) {
    if (_staggerPresets[idx] && _staggerPresets[idx].builtin) return; // the 3 base presets aren't removable — defensive, the UI never renders a delete control for them anyway
    _staggerPresets.splice(idx, 1);
    _staggerSavePresets();
    _staggerRenderPresetList();
}

// Saves whatever curve is CURRENTLY on the mockup as a new preset — capped
// at STAGGER_MAX_PRESETS (the add button itself is hidden past that, see
// _staggerRenderPresetList, so this is mostly a defensive re-check).
function _staggerAddPreset() {
    if (_staggerPresets.length >= STAGGER_MAX_PRESETS) return;
    _staggerPresets.push({
        label: 'Custom ' + (_staggerPresets.length + 1),
        p1: { x: _staggerCurveP1.x, y: _staggerCurveP1.y },
        p2: { x: _staggerCurveP2.x, y: _staggerCurveP2.y }
    });
    _staggerSavePresets();
    _staggerRenderPresetList();
}

// Renders one thumb per preset, each tracing that preset's curve in standard
// x=progress/y=output orientation (not the main mockup's transposed mapping,
// which would look sideways as a small standalone S-curve icon).
function _staggerRenderPresetList() {
    var list = document.getElementById('staggerPresetList');
    if (!list) return;
    list.innerHTML = '';
    var svgNS = 'http://www.w3.org/2000/svg';

    _staggerPresets.forEach(function(preset, idx) {
        var thumb = document.createElement('button');
        thumb.className = 'stagger-preset-thumb';
        thumb.title = preset.label;
        thumb.onclick = function() { _staggerApplyPresetAt(idx); };

        var svg = document.createElementNS(svgNS, 'svg');
        svg.setAttribute('viewBox', '0 0 32 32');
        svg.setAttribute('class', 'stagger-preset-thumb-svg');
        var path = document.createElementNS(svgNS, 'path');
        var d = '', STEPS = 12;
        // Same transposed orientation as the main mockup overlay — plotting it the "textbook" way would look sideways relative to what the preset draws.
        for (var i = 0; i <= STEPS; i++) {
            var u = i / STEPS;
            var v = _staggerCubicBezierY(u, preset.p1, preset.p2);
            var px = v * 32, py = u * 32;
            d += (i === 0 ? 'M' : 'L') + px.toFixed(1) + ',' + py.toFixed(1) + ' ';
        }
        path.setAttribute('d', d.trim());
        path.setAttribute('class', 'stagger-preset-thumb-path');
        svg.appendChild(path);
        thumb.appendChild(svg);

        // The 3 base presets (builtin:true) can't be removed — only user-added ones get a delete control.
        if (!preset.builtin) {
            var del = document.createElement('span');
            del.className = 'stagger-preset-del';
            del.title = 'Remove preset';
            del.textContent = '×';
            del.onclick = function(e) { e.stopPropagation(); _staggerRemovePresetAt(idx); };
            thumb.appendChild(del);
        }

        list.appendChild(thumb);
    });

    if (_staggerPresets.length < STAGGER_MAX_PRESETS) {
        var addBtn = document.createElement('button');
        addBtn.className = 'stagger-preset-add-btn';
        addBtn.title = 'Save the current curve as a preset';
        addBtn.textContent = '+';
        addBtn.onclick = _staggerAddPreset;
        list.appendChild(addBtn);
    }
}

// 'random' takes priority over 'curve' — the two are mutually exclusive (each
// turns the other off), so at most one is ever active; this is just the fallback order.
function _staggerCurrentMode() {
    if (_staggerRandomEnabled) return 'random';
    if (_staggerCurveEnabled) return 'curve';
    return 'linear';
}

// Deterministic hash of (seed, index) -> [0,1), not a stateful PRNG stream — any
// index can be looked up independently and always gets the same value for a seed.
// Math.imul keeps the multiplications exact 32-bit ops (plain "*" loses precision past 2^53).
function _staggerSeededRandom(seed, index) {
    var x = (Math.imul(seed | 0, 374761393) + Math.imul(index | 0, 668265263)) | 0;
    x = Math.imul(x ^ (x >>> 13), 1274126177);
    x = x ^ (x >>> 16);
    return (x >>> 0) / 4294967296; // uint32 -> [0,1)
}

// Fraction-per-row shape shared by the real offset math and the demo mockup; groupSize clusters N rows onto one shared value via effIndex.
// reversed remaps row i to (n-1-i) before grouping, so groups stay physically consecutive from whichever end starts the cascade.
function _staggerComputeFractions(n, groupSize, mode, p1, p2, randomSeed, reversed) {
    var totalSteps = Math.floor((n - 1) / groupSize);
    var fractions = [];
    for (var i = 0; i < n; i++) {
        var pos = reversed ? (n - 1 - i) : i;
        var effIndex = Math.floor(pos / groupSize);
        var linearFrac = totalSteps > 0 ? (effIndex / totalSteps) : 0;
        var frac;
        if (mode === 'random') frac = _staggerSeededRandom(randomSeed, effIndex);
        else if (mode === 'curve') frac = _staggerCubicBezierY(linearFrac, p1, p2);
        else frac = linearFrac;
        fractions.push(frac);
    }
    return fractions;
}

// Recomputes the REAL per-layer offsets (seconds) used by Apply, then
// re-renders the abstracted mockup (which uses its own fixed demo row count,
// not these real offsets).
function _staggerRecomputeOffsets() {
    var n = _staggerLayers.length;
    if (n > 0) {
        var groupSize = Math.max(1, Math.round(_staggerGroupSizeVal));
        var totalSteps = Math.floor((n - 1) / groupSize);
        var mode = _staggerCurrentMode();
        var fractions = _staggerComputeFractions(n, groupSize, mode, _staggerCurveP1, _staggerCurveP2, _staggerRandomSeed, _staggerReversed);
        var offsets = [];
        for (var i = 0; i < n; i++) offsets.push(fractions[i] * _staggerStepSeconds * totalSteps);
        _staggerOffsets = offsets;
    }
    _staggerRenderMockup();
    _staggerRenderRuler();
}

// ── Timeline ruler ───────────────────────────────────────────────────────────
// Real comp frames/timecode; spans the stagger's own total duration, same zoom philosophy as the mockup.

var _staggerRulerTotalSpanFrames = 0; // stashed by the last render, read by the drag handler

// Candidate tick spacings (frames), smallest first — snaps to whichever looks clean at the current zoom.
var STAGGER_NICE_TICK_INTERVALS = [1, 2, 5, 10, 15, 20, 25, 30, 50, 60, 90, 120, 150, 200, 300, 600, 1200];

function _staggerNiceTickInterval(totalSpanFrames, targetTicks) {
    var rough = totalSpanFrames / targetTicks;
    for (var i = 0; i < STAGGER_NICE_TICK_INTERVALS.length; i++) {
        if (STAGGER_NICE_TICK_INTERVALS[i] >= rough) return STAGGER_NICE_TICK_INTERVALS[i];
    }
    return STAGGER_NICE_TICK_INTERVALS[STAGGER_NICE_TICK_INTERVALS.length - 1];
}

// "05f"/"25f" short form within the first minute, "1:00f" full form once
// minutes roll over (or forced at frame 0, so the ruler's own origin always
// reads as a complete, unambiguous timecode).
function _staggerFormatTimecode(frame, forceFull) {
    var f = Math.round(frame);
    var mins = Math.floor(f / 60);
    var rem = f - mins * 60;
    var remStr = (rem < 10 ? '0' : '') + rem;
    if (forceFull || mins > 0) return mins + ':' + remStr + 'f';
    return remStr + 'f';
}

function _staggerRenderRuler() {
    var ticksEl = document.getElementById('staggerRulerTicks');
    if (!ticksEl) return;
    ticksEl.innerHTML = '';

    var n = _staggerLayers.length || STAGGER_DEMO_ROWS;
    var groupSize = Math.max(1, Math.round(_staggerGroupSizeVal));
    var totalSteps = Math.floor((n - 1) / groupSize);
    var totalSpanFrames = Math.max(0, _staggerStepFrames * totalSteps);
    _staggerRulerTotalSpanFrames = totalSpanFrames;

    // Total field is its own scrub control (_staggerInitScrubs); respects its busy/editing state instead of being overwritten here.
    if (_staggerTotalScrub) _staggerTotalScrub.render();

    var displaySpan = totalSpanFrames > 0 ? totalSpanFrames : 1;
    var tickInterval = _staggerNiceTickInterval(displaySpan, 7);
    var numTicks = Math.max(1, Math.floor(displaySpan / tickInterval));

    for (var i = 0; i <= numTicks; i++) {
        var frame = i * tickInterval;
        var pct = (frame / displaySpan) * 100;
        if (pct > 100.5) break;
        var tick = document.createElement('div');
        tick.className = 'stagger-ruler-tick';
        tick.style.left = Math.min(pct, 100).toFixed(2) + '%';
        var label = document.createElement('span');
        label.className = 'stagger-ruler-label';
        label.textContent = _staggerFormatTimecode(frame, frame === 0);
        tick.appendChild(label);
        ticksEl.appendChild(tick);
    }
}

// Back-computes Step from a target TOTAL span, dividing across the same step count the mockup/Apply math uses — keeps this in sync rather than a parallel concept.
function _staggerApplyTotalSpanFrames(newSpanFrames) {
    var n = _staggerLayers.length || STAGGER_DEMO_ROWS;
    var groupSize = Math.max(1, Math.round(_staggerGroupSizeVal));
    var totalSteps = Math.floor((n - 1) / groupSize);
    var newStepFrames = totalSteps > 0 ? (newSpanFrames / totalSteps) : newSpanFrames;
    _staggerStepFrames = newStepFrames;
    _staggerStepSeconds = newStepFrames * _staggerFrameDuration;
    if (_staggerStepFramesScrub) _staggerStepFramesScrub.render();
    _staggerRecomputeOffsets(); // also re-renders the ruler (and Total's own scrub) itself
}

// Ruler drag (anywhere, not just the edge) stretches/compresses total span; FIXED frames-per-pixel rate (not derived from span) keeps small spans responsive.
var STAGGER_RULER_DRAG_FRAMES_PER_PX = 0.5;

function _staggerInitRulerDrag() {
    var ruler = document.getElementById('staggerRuler');
    if (!ruler) return;
    ruler.addEventListener('mousedown', function(e) {
        e.preventDefault();
        var startX = e.clientX;
        var startSpan = _staggerRulerTotalSpanFrames || 1;
        document.body.style.cursor = 'ew-resize';
        function onMove(e2) {
            var dx = e2.clientX - startX;
            var deltaFrames = dx * STAGGER_RULER_DRAG_FRAMES_PER_PX;
            _staggerApplyTotalSpanFrames(Math.max(0, startSpan + deltaFrames));
        }
        function onUp() {
            document.body.style.cursor = '';
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
}

// Newton-Raphson cubic-bezier X(t)->t solve (same approach browsers use for CSS cubic-bezier()); endpoints fixed at (0,0)/(1,1), P1/P2 are the draggable handles.
function _staggerBezierComponent(p1, p2, t) {
    var mt = 1 - t;
    return 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t;
}
function _staggerBezierComponentDerivative(p1, p2, t) {
    var mt = 1 - t;
    return 3 * mt * mt * p1 + 6 * mt * t * (p2 - p1) + 3 * t * t * (1 - p2);
}
function _staggerCubicBezierY(x, p1, p2) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    var t = x;
    for (var i = 0; i < 8; i++) {
        var err = _staggerBezierComponent(p1.x, p2.x, t) - x;
        var d = _staggerBezierComponentDerivative(p1.x, p2.x, t);
        if (Math.abs(d) < 1e-6) break;
        t -= err / d;
        if (t < 0) t = 0; else if (t > 1) t = 1;
    }
    return _staggerBezierComponent(p1.y, p2.y, t);
}

// Row i's vertical center in the mockup svg (200x120, DEMO_ROWS stacked
// top to bottom) and a fraction's horizontal position within the margin-
// inset offset span.
function _staggerRowY(i) { return (i + 0.5) / STAGGER_DEMO_ROWS * STAGGER_MOCKUP_H; }
function _staggerFracToX(f) { return STAGGER_MOCKUP_MARGIN + f * (STAGGER_MOCKUP_W - 2 * STAGGER_MOCKUP_MARGIN); }

// Curve overlay mapping, TRANSPOSED from a standard ease editor: norm.x (progress) -> screen Y, norm.y (offset) -> screen X, into the mockup's own layout.
// P1/P2 keep their original x=progress/y=offset meaning; only the on-screen axes swap. topY/botY anchor to actual row centers, not the full 0-120 height.
function _staggerCurveToSvg(norm) {
    var topY = _staggerRowY(0), botY = _staggerRowY(STAGGER_DEMO_ROWS - 1);
    return { x: _staggerFracToX(norm.y), y: topY + norm.x * (botY - topY) };
}
function _staggerSvgToCurve(svgX, svgY) {
    var topY = _staggerRowY(0), botY = _staggerRowY(STAGGER_DEMO_ROWS - 1);
    var x = (svgY - topY) / ((botY - topY) || 1);
    var y = (svgX - STAGGER_MOCKUP_MARGIN) / (STAGGER_MOCKUP_W - 2 * STAGGER_MOCKUP_MARGIN);
    if (x < 0) x = 0; else if (x > 1) x = 1;
    if (y < 0) y = 0; else if (y > 1) y = 1;
    return { x: x, y: y };
}
// viewBox (200x120) rarely matches rendered aspect ratio, and preserveAspectRatio="none" stretches non-uniformly, so shapes sized in viewBox units get squished.
// Scaling radius by 1/sx, 1/sy (this function) cancels that out — same fix _easePreviewRender uses for its keyframe dots.
function _staggerSvgScale() {
    var svgEl = document.getElementById('staggerMockupSvg');
    var rect = svgEl ? svgEl.getBoundingClientRect() : null;
    return {
        sx: (rect && rect.width)  ? rect.width  / STAGGER_MOCKUP_W : 1,
        sy: (rect && rect.height) ? rect.height / STAGGER_MOCKUP_H : 1
    };
}

function _staggerUpdateCurveHandleEls() {
    var h1 = document.getElementById('staggerCurveHandle1');
    var h2 = document.getElementById('staggerCurveHandle2');
    var l1 = document.getElementById('staggerCurveHandleLine1');
    var l2 = document.getElementById('staggerCurveHandleLine2');
    var scale = _staggerSvgScale();
    var HR = 5; // desired on-screen radius, in real pixels
    var hrx = HR / scale.sx, hry = HR / scale.sy;
    var p1s = _staggerCurveToSvg(_staggerCurveP1);
    var p2s = _staggerCurveToSvg(_staggerCurveP2);
    if (h1) { h1.setAttribute('cx', p1s.x); h1.setAttribute('cy', p1s.y); h1.setAttribute('rx', hrx.toFixed(2)); h1.setAttribute('ry', hry.toFixed(2)); }
    if (h2) { h2.setAttribute('cx', p2s.x); h2.setAttribute('cy', p2s.y); h2.setAttribute('rx', hrx.toFixed(2)); h2.setAttribute('ry', hry.toFixed(2)); }
    if (l1) { l1.setAttribute('x1', _staggerFracToX(0)); l1.setAttribute('y1', _staggerRowY(0)); l1.setAttribute('x2', p1s.x); l1.setAttribute('y2', p1s.y); }
    if (l2) { l2.setAttribute('x1', _staggerFracToX(1)); l2.setAttribute('y1', _staggerRowY(STAGGER_DEMO_ROWS - 1)); l2.setAttribute('x2', p2s.x); l2.setAttribute('y2', p2s.y); }
}
function _staggerRenderCurvePath() {
    _staggerUpdateCurveHandleEls();
    var pathEl = document.getElementById('staggerCurvePath');
    if (!pathEl) return;
    var d = '', STEPS = 24;
    for (var i = 0; i <= STEPS; i++) {
        var u = i / STEPS;
        var v = _staggerCubicBezierY(u, _staggerCurveP1, _staggerCurveP2);
        var svg = _staggerCurveToSvg({ x: u, y: v });
        d += (i === 0 ? 'M' : 'L') + svg.x.toFixed(2) + ',' + svg.y.toFixed(2) + ' ';
    }
    pathEl.setAttribute('d', d.trim());
}

// Renders the abstracted mockup: STAGGER_DEMO_ROWS bars with one diamond each, positioned per _staggerComputeFractions using the DEMO row count (not real selection), plus curve overlay when enabled.
function _staggerRenderMockup() {
    var barsG = document.getElementById('staggerMockupBars');
    if (!barsG) return;
    barsG.innerHTML = '';
    var svgNS = 'http://www.w3.org/2000/svg';

    var groupSize = Math.max(1, Math.round(_staggerGroupSizeVal));
    var fractions = _staggerComputeFractions(STAGGER_DEMO_ROWS, groupSize, _staggerCurrentMode(), _staggerCurveP1, _staggerCurveP2, _staggerRandomSeed, _staggerReversed);
    var barH = (STAGGER_MOCKUP_H / STAGGER_DEMO_ROWS) * 0.8; // thick bars, evenly flexed rows with a bit more breathing room between them

    // Sized per-axis (not one shared radius) so the diamond is symmetric in real pixels — see _staggerSvgScale.
    var scale = _staggerSvgScale();
    var R = 5; // desired on-screen half-diagonal, in real pixels (20% larger than the previous 4.2)
    var Rx = R / scale.sx, Ry = R / scale.sy;

    for (var i = 0; i < STAGGER_DEMO_ROWS; i++) {
        var y = _staggerRowY(i);

        // Flat, uniformly-colored bars — these are abstract demo rows, not real layers, so there's nothing meaningful to color them by.
        var bar = document.createElementNS(svgNS, 'rect');
        bar.setAttribute('x', '2');
        bar.setAttribute('y', (y - barH / 2).toFixed(2));
        bar.setAttribute('width', (STAGGER_MOCKUP_W - 4).toFixed(2));
        bar.setAttribute('height', barH.toFixed(2));
        bar.setAttribute('rx', '2.5');
        bar.setAttribute('class', 'stagger-mockup-bar');
        barsG.appendChild(bar);

        var dx = _staggerFracToX(fractions[i]);
        var dia = document.createElementNS(svgNS, 'polygon');
        dia.setAttribute('points', [
            dx.toFixed(2) + ',' + (y - Ry).toFixed(2),
            (dx + Rx).toFixed(2) + ',' + y.toFixed(2),
            dx.toFixed(2) + ',' + (y + Ry).toFixed(2),
            (dx - Rx).toFixed(2) + ',' + y.toFixed(2)
        ].join(' '));
        dia.setAttribute('class', 'stagger-mockup-diamond');
        barsG.appendChild(dia);
    }

    if (_staggerCurveEnabled) _staggerRenderCurvePath();
}

// Drag wiring for the 2 curve handles — same mousedown/mousemove/mouseup-on-document pattern used throughout this file, not Pointer Events.
// Attached once at init since the handle elements are static markup, not created per popup open.
function _staggerInitCurveEditor() {
    var svgEl = document.getElementById('staggerMockupSvg');
    var h1 = document.getElementById('staggerCurveHandle1');
    var h2 = document.getElementById('staggerCurveHandle2');
    if (!svgEl || !h1 || !h2) return;

    function startDrag(which) {
        return function(e) {
            e.preventDefault();
            _staggerDragHandle = which;
            var rect = svgEl.getBoundingClientRect();
            function onMove(e2) {
                var localX = (e2.clientX - rect.left) / rect.width * STAGGER_MOCKUP_W;
                var localY = (e2.clientY - rect.top) / rect.height * STAGGER_MOCKUP_H;
                var norm = _staggerSvgToCurve(localX, localY);
                if (_staggerDragHandle === 'p1') _staggerCurveP1 = norm;
                else if (_staggerDragHandle === 'p2') _staggerCurveP2 = norm;
                _staggerRecomputeOffsets();
            }
            function onUp() {
                _staggerDragHandle = null;
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            }
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        };
    }
    h1.addEventListener('mousedown', startDrag('p1'));
    h2.addEventListener('mousedown', startDrag('p2'));
}

// Panel resize changes the svg's rendered pixel size but doesn't trigger any other re-render, so without this the scale-corrected rx/ry (_staggerSvgScale) would go stale and look stretched.
function _staggerInitMockupResizeObserver() {
    var svgEl = document.getElementById('staggerMockupSvg');
    if (!svgEl || typeof ResizeObserver === 'undefined') return;
    new ResizeObserver(function() { _staggerRenderMockup(); }).observe(svgEl);
}

function applyStaggerFromPopup() {
    if (!_staggerLayers.length) { closeStaggerPopup(); return; }
    var payload = [];
    for (var i = 0; i < _staggerLayers.length; i++) {
        payload.push({ layerIndex: _staggerLayers[i].layerIndex, offsetSeconds: _staggerOffsets[i] || 0 });
    }
    var payloadJson = JSON.stringify(payload);
    var escaped = payloadJson.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    run("lineup_staggerKeyframes('" + escaped + "')", function() {
        closeStaggerPopup();
    });
}

// ── LAYER STAGGER ─────────────────────────────────────────────────────────────
// Standalone counterpart to Stagger Keyframes: cascades each layer's own startTime instead of retiming keyframes; reuses the keyframe tool's non-keyframe-specific math, mirrors the rest as a parallel `_layerStagger*` set.

var _layerStaggerLayers        = []; // [{layerIndex, layerName, startTime}], Timeline stacking order — real selection, used only for Apply
var _layerStaggerFrameDuration = 1 / 30;
var _layerStaggerOffsets       = []; // seconds, parallel to _layerStaggerLayers — used only for Apply
var _layerStaggerStepFrames    = 2;
var _layerStaggerStepSeconds   = 2 / 30;
var _layerStaggerGroupSizeVal  = 1;
var _layerStaggerCurveEnabled  = false;
var _layerStaggerCurveP1       = { x: 1 / 3, y: 1 / 3 };
var _layerStaggerCurveP2       = { x: 2 / 3, y: 2 / 3 };
var _layerStaggerDragHandle    = null; // 'p1' or 'p2' while a curve handle drag is in progress
var _layerStaggerRandomEnabled = false;
var _layerStaggerRandomSeed    = 1;
var _layerStaggerReversed      = false; // false = top-down (Timeline stacking order), true = bottom-up
var _layerStaggerStepFramesScrub, _layerStaggerTotalScrub, _layerStaggerGroupSizeScrub, _layerStaggerRandomSeedScrub;
var _layerStaggerUnitMode = 'frames'; // 'frames' | 'seconds' — shared by Step and Total, same as the keyframe tool's own _staggerUnitMode

var LAYERSTAGGER_MAX_PRESETS = 6;
var LAYERSTAGGER_PRESETS_STORAGE_KEY = 'lineup-layerstagger-presets'; // independent of the keyframe tool's own saved presets
var _layerStaggerPresets = [];

function _layerStaggerLoadPresets() {
    try {
        var raw = localStorage.getItem(LAYERSTAGGER_PRESETS_STORAGE_KEY);
        if (raw) {
            var parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length) { _layerStaggerPresets = parsed; return; }
        }
    } catch (e) {}
    _layerStaggerPresets = [
        { label: 'Ease In-Out', builtin: true, p1: { x: STAGGER_EASE_IN_OUT.p1.x, y: STAGGER_EASE_IN_OUT.p1.y }, p2: { x: STAGGER_EASE_IN_OUT.p2.x, y: STAGGER_EASE_IN_OUT.p2.y } },
        { label: 'Ease In',     builtin: true, p1: { x: STAGGER_EASE_IN.p1.x,     y: STAGGER_EASE_IN.p1.y },     p2: { x: STAGGER_EASE_IN.p2.x,     y: STAGGER_EASE_IN.p2.y } },
        { label: 'Ease Out',    builtin: true, p1: { x: STAGGER_EASE_OUT.p1.x,    y: STAGGER_EASE_OUT.p1.y },    p2: { x: STAGGER_EASE_OUT.p2.x,    y: STAGGER_EASE_OUT.p2.y } }
    ];
}
function _layerStaggerSavePresets() {
    try { localStorage.setItem(LAYERSTAGGER_PRESETS_STORAGE_KEY, JSON.stringify(_layerStaggerPresets)); } catch (e) {}
}

function openLayerStaggerPopup() {
    var overlay = document.getElementById('layerStaggerOverlay');
    if (!overlay) return;
    cs.evalScript('lineup_getLayerStaggerGroups()', function(result) {
        var data = null;
        try { data = JSON.parse(result); } catch (e) {}
        if (!data || !data.layers || !data.layers.length) {
            showToast('No layers selected');
            return;
        }
        _layerStaggerLayers        = data.layers;
        _layerStaggerFrameDuration = data.frameDuration || (1 / 30);
        _layerStaggerStepFrames    = 2;
        _layerStaggerStepSeconds   = 2 * _layerStaggerFrameDuration;
        _layerStaggerGroupSizeVal  = 1;
        _layerStaggerReversed      = false;

        if (_layerStaggerStepFramesScrub) _layerStaggerStepFramesScrub.render();
        if (_layerStaggerGroupSizeScrub)  _layerStaggerGroupSizeScrub.render();
        if (_layerStaggerRandomSeedScrub) _layerStaggerRandomSeedScrub.render();
        var directionBtn = document.getElementById('layerStaggerDirectionBtn');
        if (directionBtn) directionBtn.classList.remove('is-reversed');
        _layerStaggerRenderPresetList();
        _layerStaggerSetRandomEnabled(false);
        _layerStaggerSetCurveEnabled(false); // also recomputes + renders the mockup

        overlay.classList.remove('stagger-hidden');
    });
}

function closeLayerStaggerPopup() {
    var overlay = document.getElementById('layerStaggerOverlay');
    if (overlay) overlay.classList.add('stagger-hidden');
}

// Same as _makeStaggerUnitScrub, but tracks _layerStagger*'s own frame/unit-mode state — kept separate since the original already hardcodes _stagger* directly.
function _makeLayerStaggerUnitScrub(el, opts) {
    var getFrames = opts.getFrames, setFrames = opts.setFrames;
    var sensitivity = opts.sensitivity || 0.05;
    var min = (typeof opts.min === 'number') ? opts.min : -Infinity;
    var drag = null, editing = false;

    function fmt(frames) {
        if (_layerStaggerUnitMode === 'seconds') {
            return parseFloat((frames * _layerStaggerFrameDuration).toFixed(3)) + ' s';
        }
        return (Math.round(frames * 100) / 100) + ' f';
    }
    function render() { if (!editing && !drag) el.textContent = fmt(getFrames()); }
    function isBusy() { return editing || !!drag; }

    function onMouseDown(e) {
        if (editing) return;
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            _layerStaggerUnitMode = (_layerStaggerUnitMode === 'frames') ? 'seconds' : 'frames';
            _layerStaggerRenderUnitScrubs();
            return;
        }
        e.preventDefault();
        drag = { startX: e.clientX, startVal: getFrames(), moved: false };
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }
    function onMouseMove(e) {
        if (!drag) return;
        var dx = e.clientX - drag.startX;
        if (!drag.moved && Math.abs(dx) < 3) return;
        drag.moved = true;
        var mult = e.shiftKey ? 10 : 1;
        var newVal = drag.startVal + dx * sensitivity * mult;
        if (newVal < min) newVal = min;
        el.textContent = fmt(newVal);
        setFrames(newVal);
    }
    function onMouseUp() {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        var d = drag; drag = null;
        if (d && !d.moved) openEdit();
    }
    function openEdit() {
        editing = true;
        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'stagger-scrub-edit';
        input.value = _layerStaggerUnitMode === 'seconds' ? (getFrames() * _layerStaggerFrameDuration) : getFrames();
        el.textContent = '';
        el.appendChild(input);
        input.focus();
        input.select();
        function commit() {
            var v = parseFloat(input.value);
            editing = false;
            if (!isNaN(v)) {
                var framesVal = _layerStaggerUnitMode === 'seconds' ? (v / (_layerStaggerFrameDuration || 1)) : v;
                setFrames(framesVal < min ? min : framesVal);
            }
            render();
        }
        input.addEventListener('blur', commit);
        input.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') input.blur();
            else if (e.key === 'Escape') { editing = false; render(); }
        });
    }

    el.addEventListener('mousedown', onMouseDown);
    render();
    return { render: render, isBusy: isBusy };
}

function _layerStaggerRenderUnitScrubs() {
    if (_layerStaggerStepFramesScrub) _layerStaggerStepFramesScrub.render();
    if (_layerStaggerTotalScrub) _layerStaggerTotalScrub.render();
}

function _layerStaggerInitScrubs() {
    var framesEl = document.getElementById('layerStaggerStepFrames');
    var totalEl = document.getElementById('layerStaggerTotalReadout');
    var groupEl = document.getElementById('layerStaggerGroupSize');
    if (framesEl) {
        _layerStaggerStepFramesScrub = _makeLayerStaggerUnitScrub(framesEl, {
            sensitivity: 0.05,
            getFrames: function() { return _layerStaggerStepFrames; },
            setFrames: function(v) {
                _layerStaggerStepFrames = v;
                _layerStaggerStepSeconds = v * _layerStaggerFrameDuration;
                _layerStaggerRecomputeOffsets();
            }
        });
    }
    if (totalEl) {
        _layerStaggerTotalScrub = _makeLayerStaggerUnitScrub(totalEl, {
            sensitivity: STAGGER_RULER_DRAG_FRAMES_PER_PX,
            min: 0,
            getFrames: function() { return _layerStaggerRulerTotalSpanFrames; },
            setFrames: function(v) { _layerStaggerApplyTotalSpanFrames(v); }
        });
    }
    if (groupEl) {
        _layerStaggerGroupSizeScrub = _makeStaggerScrub(groupEl, {
            decimals: 0, suffix: '', sensitivity: 0.05, min: 1,
            getValue: function() { return _layerStaggerGroupSizeVal; },
            setValue: function(v) {
                _layerStaggerGroupSizeVal = Math.max(1, Math.round(v));
                _layerStaggerRecomputeOffsets();
            }
        });
    }
    var randomSeedEl = document.getElementById('layerStaggerRandomSeed');
    if (randomSeedEl) {
        _layerStaggerRandomSeedScrub = _makeStaggerScrub(randomSeedEl, {
            decimals: 0, suffix: '', sensitivity: 0.25, min: 0,
            getValue: function() { return _layerStaggerRandomSeed; },
            setValue: function(v) {
                _layerStaggerRandomSeed = Math.max(0, Math.round(v));
                _layerStaggerRecomputeOffsets();
            }
        });
    }
}

function _layerStaggerSetCurveEnabled(on) {
    var wasEnabled = _layerStaggerCurveEnabled;
    _layerStaggerCurveEnabled = on;
    if (on) {
        if (_layerStaggerRandomEnabled) _layerStaggerSetRandomEnabled(false);
        if (!wasEnabled) {
            _layerStaggerCurveP1 = { x: STAGGER_EASE_IN_OUT.p1.x, y: STAGGER_EASE_IN_OUT.p1.y };
            _layerStaggerCurveP2 = { x: STAGGER_EASE_IN_OUT.p2.x, y: STAGGER_EASE_IN_OUT.p2.y };
        }
    }
    var btn = document.getElementById('layerStaggerCurveToggleBtn');
    if (btn) btn.classList.toggle('is-active', on);
    var showHide = on ? '' : 'none';
    ['layerStaggerCurvePath', 'layerStaggerCurveHandle1', 'layerStaggerCurveHandle2', 'layerStaggerCurveHandleLine1', 'layerStaggerCurveHandleLine2'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.style.display = showHide;
    });
    _layerStaggerRecomputeOffsets();
}

function _layerStaggerToggleCurve() {
    _layerStaggerSetCurveEnabled(!_layerStaggerCurveEnabled);
}

function _layerStaggerSetRandomEnabled(on) {
    _layerStaggerRandomEnabled = on;
    if (on && _layerStaggerCurveEnabled) _layerStaggerSetCurveEnabled(false);
    var btn = document.getElementById('layerStaggerRandomToggleBtn');
    if (btn) btn.classList.toggle('is-active', on);
    var panel = document.getElementById('layerStaggerRandomPanel');
    if (panel) panel.style.display = on ? 'block' : 'none';
    _layerStaggerRecomputeOffsets();
}

function _layerStaggerToggleRandom() {
    _layerStaggerSetRandomEnabled(!_layerStaggerRandomEnabled);
}

function _layerStaggerRerollSeed() {
    _layerStaggerRandomSeed = Math.floor(Math.random() * 1000000);
    if (_layerStaggerRandomSeedScrub) _layerStaggerRandomSeedScrub.render();
    _layerStaggerRecomputeOffsets();
}

function _layerStaggerToggleDirection() {
    _layerStaggerReversed = !_layerStaggerReversed;
    var btn = document.getElementById('layerStaggerDirectionBtn');
    if (btn) btn.classList.toggle('is-reversed', _layerStaggerReversed);
    _layerStaggerRecomputeOffsets();
}

function _layerStaggerApplyPresetAt(idx) {
    var preset = _layerStaggerPresets[idx];
    if (!preset) return;
    if (!_layerStaggerCurveEnabled) _layerStaggerSetCurveEnabled(true);
    _layerStaggerCurveP1 = { x: preset.p1.x, y: preset.p1.y };
    _layerStaggerCurveP2 = { x: preset.p2.x, y: preset.p2.y };
    _layerStaggerRecomputeOffsets();
}

function _layerStaggerRemovePresetAt(idx) {
    if (_layerStaggerPresets[idx] && _layerStaggerPresets[idx].builtin) return;
    _layerStaggerPresets.splice(idx, 1);
    _layerStaggerSavePresets();
    _layerStaggerRenderPresetList();
}

function _layerStaggerAddPreset() {
    if (_layerStaggerPresets.length >= LAYERSTAGGER_MAX_PRESETS) return;
    _layerStaggerPresets.push({
        label: 'Custom ' + (_layerStaggerPresets.length + 1),
        p1: { x: _layerStaggerCurveP1.x, y: _layerStaggerCurveP1.y },
        p2: { x: _layerStaggerCurveP2.x, y: _layerStaggerCurveP2.y }
    });
    _layerStaggerSavePresets();
    _layerStaggerRenderPresetList();
}

function _layerStaggerRenderPresetList() {
    var list = document.getElementById('layerStaggerPresetList');
    if (!list) return;
    list.innerHTML = '';
    var svgNS = 'http://www.w3.org/2000/svg';

    _layerStaggerPresets.forEach(function(preset, idx) {
        var thumb = document.createElement('button');
        thumb.className = 'stagger-preset-thumb';
        thumb.title = preset.label;
        thumb.onclick = function() { _layerStaggerApplyPresetAt(idx); };

        var svg = document.createElementNS(svgNS, 'svg');
        svg.setAttribute('viewBox', '0 0 32 32');
        svg.setAttribute('class', 'stagger-preset-thumb-svg');
        var path = document.createElementNS(svgNS, 'path');
        var d = '', STEPS = 12;
        for (var i = 0; i <= STEPS; i++) {
            var u = i / STEPS;
            var v = _staggerCubicBezierY(u, preset.p1, preset.p2);
            var px = v * 32, py = u * 32;
            d += (i === 0 ? 'M' : 'L') + px.toFixed(1) + ',' + py.toFixed(1) + ' ';
        }
        path.setAttribute('d', d.trim());
        path.setAttribute('class', 'stagger-preset-thumb-path');
        svg.appendChild(path);
        thumb.appendChild(svg);

        if (!preset.builtin) {
            var del = document.createElement('span');
            del.className = 'stagger-preset-del';
            del.title = 'Remove preset';
            del.textContent = '×';
            del.onclick = function(e) { e.stopPropagation(); _layerStaggerRemovePresetAt(idx); };
            thumb.appendChild(del);
        }

        list.appendChild(thumb);
    });

    if (_layerStaggerPresets.length < LAYERSTAGGER_MAX_PRESETS) {
        var addBtn = document.createElement('button');
        addBtn.className = 'stagger-preset-add-btn';
        addBtn.title = 'Save the current curve as a preset';
        addBtn.textContent = '+';
        addBtn.onclick = _layerStaggerAddPreset;
        list.appendChild(addBtn);
    }
}

function _layerStaggerCurrentMode() {
    if (_layerStaggerRandomEnabled) return 'random';
    if (_layerStaggerCurveEnabled) return 'curve';
    return 'linear';
}

// Mirrors _staggerRecomputeOffsets exactly, just against _layerStagger* state, calling the same shared _staggerComputeFractions.
function _layerStaggerRecomputeOffsets() {
    var n = _layerStaggerLayers.length;
    if (n > 0) {
        var groupSize = Math.max(1, Math.round(_layerStaggerGroupSizeVal));
        var totalSteps = Math.floor((n - 1) / groupSize);
        var mode = _layerStaggerCurrentMode();
        var fractions = _staggerComputeFractions(n, groupSize, mode, _layerStaggerCurveP1, _layerStaggerCurveP2, _layerStaggerRandomSeed, _layerStaggerReversed);
        var offsets = [];
        for (var i = 0; i < n; i++) offsets.push(fractions[i] * _layerStaggerStepSeconds * totalSteps);
        _layerStaggerOffsets = offsets;
    }
    _layerStaggerRenderMockup();
    _layerStaggerRenderRuler();
}

var _layerStaggerRulerTotalSpanFrames = 0; // stashed by the last render, read by the drag handler

function _layerStaggerRenderRuler() {
    var ticksEl = document.getElementById('layerStaggerRulerTicks');
    if (!ticksEl) return;
    ticksEl.innerHTML = '';

    var n = _layerStaggerLayers.length || STAGGER_DEMO_ROWS;
    var groupSize = Math.max(1, Math.round(_layerStaggerGroupSizeVal));
    var totalSteps = Math.floor((n - 1) / groupSize);
    var totalSpanFrames = Math.max(0, _layerStaggerStepFrames * totalSteps);
    _layerStaggerRulerTotalSpanFrames = totalSpanFrames;

    if (_layerStaggerTotalScrub) _layerStaggerTotalScrub.render();

    var displaySpan = totalSpanFrames > 0 ? totalSpanFrames : 1;
    var tickInterval = _staggerNiceTickInterval(displaySpan, 7);
    var numTicks = Math.max(1, Math.floor(displaySpan / tickInterval));

    for (var i = 0; i <= numTicks; i++) {
        var frame = i * tickInterval;
        var pct = (frame / displaySpan) * 100;
        if (pct > 100.5) break;
        var tick = document.createElement('div');
        tick.className = 'stagger-ruler-tick';
        tick.style.left = Math.min(pct, 100).toFixed(2) + '%';
        var label = document.createElement('span');
        label.className = 'stagger-ruler-label';
        label.textContent = _staggerFormatTimecode(frame, frame === 0);
        tick.appendChild(label);
        ticksEl.appendChild(tick);
    }
}

function _layerStaggerApplyTotalSpanFrames(newSpanFrames) {
    var n = _layerStaggerLayers.length || STAGGER_DEMO_ROWS;
    var groupSize = Math.max(1, Math.round(_layerStaggerGroupSizeVal));
    var totalSteps = Math.floor((n - 1) / groupSize);
    var newStepFrames = totalSteps > 0 ? (newSpanFrames / totalSteps) : newSpanFrames;
    _layerStaggerStepFrames = newStepFrames;
    _layerStaggerStepSeconds = newStepFrames * _layerStaggerFrameDuration;
    if (_layerStaggerStepFramesScrub) _layerStaggerStepFramesScrub.render();
    _layerStaggerRecomputeOffsets();
}

function _layerStaggerInitRulerDrag() {
    var ruler = document.getElementById('layerStaggerRuler');
    if (!ruler) return;
    ruler.addEventListener('mousedown', function(e) {
        e.preventDefault();
        var startX = e.clientX;
        var startSpan = _layerStaggerRulerTotalSpanFrames || 1;
        document.body.style.cursor = 'ew-resize';
        function onMove(e2) {
            var dx = e2.clientX - startX;
            var deltaFrames = dx * STAGGER_RULER_DRAG_FRAMES_PER_PX;
            _layerStaggerApplyTotalSpanFrames(Math.max(0, startSpan + deltaFrames));
        }
        function onUp() {
            document.body.style.cursor = '';
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
}

// Fixed decorative width for each mockup bar, as a fraction of the usable span — unlike the keyframe tool's full-width bars, these need real width AND a shifting position.
var LAYERSTAGGER_BAR_WIDTH_FRAC = 0.35;

function _layerStaggerBarWidthPx() {
    return (STAGGER_MOCKUP_W - 2 * STAGGER_MOCKUP_MARGIN) * LAYERSTAGGER_BAR_WIDTH_FRAC;
}
// A bar's own LEFT edge for a given fraction — narrower range than _staggerFracToX since it reserves room for the bar's own width.
function _layerStaggerFracToX(f) {
    var barW = _layerStaggerBarWidthPx();
    var startRange = (STAGGER_MOCKUP_W - 2 * STAGGER_MOCKUP_MARGIN) - barW;
    return STAGGER_MOCKUP_MARGIN + f * startRange;
}

// Same transposed mapping as _staggerCurveToSvg, built on _layerStaggerFracToX so the curve tracks each bar's LEFT EDGE rather than a point position.
function _layerStaggerCurveToSvg(norm) {
    var topY = _staggerRowY(0), botY = _staggerRowY(STAGGER_DEMO_ROWS - 1);
    return { x: _layerStaggerFracToX(norm.y), y: topY + norm.x * (botY - topY) };
}
function _layerStaggerSvgToCurve(svgX, svgY) {
    var topY = _staggerRowY(0), botY = _staggerRowY(STAGGER_DEMO_ROWS - 1);
    var barW = _layerStaggerBarWidthPx();
    var startRange = (STAGGER_MOCKUP_W - 2 * STAGGER_MOCKUP_MARGIN) - barW;
    var x = (svgY - topY) / ((botY - topY) || 1);
    var y = (svgX - STAGGER_MOCKUP_MARGIN) / (startRange || 1);
    if (x < 0) x = 0; else if (x > 1) x = 1;
    if (y < 0) y = 0; else if (y > 1) y = 1;
    return { x: x, y: y };
}

function _layerStaggerSvgScale() {
    var svgEl = document.getElementById('layerStaggerMockupSvg');
    var rect = svgEl ? svgEl.getBoundingClientRect() : null;
    return {
        sx: (rect && rect.width)  ? rect.width  / STAGGER_MOCKUP_W : 1,
        sy: (rect && rect.height) ? rect.height / STAGGER_MOCKUP_H : 1
    };
}

function _layerStaggerUpdateCurveHandleEls() {
    var h1 = document.getElementById('layerStaggerCurveHandle1');
    var h2 = document.getElementById('layerStaggerCurveHandle2');
    var l1 = document.getElementById('layerStaggerCurveHandleLine1');
    var l2 = document.getElementById('layerStaggerCurveHandleLine2');
    var scale = _layerStaggerSvgScale();
    var HR = 5;
    var hrx = HR / scale.sx, hry = HR / scale.sy;
    var p1s = _layerStaggerCurveToSvg(_layerStaggerCurveP1);
    var p2s = _layerStaggerCurveToSvg(_layerStaggerCurveP2);
    if (h1) { h1.setAttribute('cx', p1s.x); h1.setAttribute('cy', p1s.y); h1.setAttribute('rx', hrx.toFixed(2)); h1.setAttribute('ry', hry.toFixed(2)); }
    if (h2) { h2.setAttribute('cx', p2s.x); h2.setAttribute('cy', p2s.y); h2.setAttribute('rx', hrx.toFixed(2)); h2.setAttribute('ry', hry.toFixed(2)); }
    if (l1) { l1.setAttribute('x1', _layerStaggerFracToX(0)); l1.setAttribute('y1', _staggerRowY(0)); l1.setAttribute('x2', p1s.x); l1.setAttribute('y2', p1s.y); }
    if (l2) { l2.setAttribute('x1', _layerStaggerFracToX(1)); l2.setAttribute('y1', _staggerRowY(STAGGER_DEMO_ROWS - 1)); l2.setAttribute('x2', p2s.x); l2.setAttribute('y2', p2s.y); }
}
function _layerStaggerRenderCurvePath() {
    _layerStaggerUpdateCurveHandleEls();
    var pathEl = document.getElementById('layerStaggerCurvePath');
    if (!pathEl) return;
    var d = '', STEPS = 24;
    for (var i = 0; i <= STEPS; i++) {
        var u = i / STEPS;
        var v = _staggerCubicBezierY(u, _layerStaggerCurveP1, _layerStaggerCurveP2);
        var svg = _layerStaggerCurveToSvg({ x: u, y: v });
        d += (i === 0 ? 'M' : 'L') + svg.x.toFixed(2) + ',' + svg.y.toFixed(2) + ' ';
    }
    pathEl.setAttribute('d', d.trim());
}

// Same STAGGER_DEMO_ROWS demo rows as the keyframe tool's mockup, but each bar has a FIXED width and its LEFT EDGE shifts — no keyframe diamond.
function _layerStaggerRenderMockup() {
    var barsG = document.getElementById('layerStaggerMockupBars');
    if (!barsG) return;
    barsG.innerHTML = '';
    var svgNS = 'http://www.w3.org/2000/svg';

    var groupSize = Math.max(1, Math.round(_layerStaggerGroupSizeVal));
    var fractions = _staggerComputeFractions(STAGGER_DEMO_ROWS, groupSize, _layerStaggerCurrentMode(), _layerStaggerCurveP1, _layerStaggerCurveP2, _layerStaggerRandomSeed, _layerStaggerReversed);
    var barH = (STAGGER_MOCKUP_H / STAGGER_DEMO_ROWS) * 0.8;
    var barW = _layerStaggerBarWidthPx();

    for (var i = 0; i < STAGGER_DEMO_ROWS; i++) {
        var y = _staggerRowY(i);
        var x = _layerStaggerFracToX(fractions[i]);

        var bar = document.createElementNS(svgNS, 'rect');
        bar.setAttribute('x', x.toFixed(2));
        bar.setAttribute('y', (y - barH / 2).toFixed(2));
        bar.setAttribute('width', barW.toFixed(2));
        bar.setAttribute('height', barH.toFixed(2));
        bar.setAttribute('rx', '2.5');
        bar.setAttribute('class', 'stagger-mockup-bar');
        barsG.appendChild(bar);
    }

    if (_layerStaggerCurveEnabled) _layerStaggerRenderCurvePath();
}

function _layerStaggerInitCurveEditor() {
    var svgEl = document.getElementById('layerStaggerMockupSvg');
    var h1 = document.getElementById('layerStaggerCurveHandle1');
    var h2 = document.getElementById('layerStaggerCurveHandle2');
    if (!svgEl || !h1 || !h2) return;

    function startDrag(which) {
        return function(e) {
            e.preventDefault();
            _layerStaggerDragHandle = which;
            var rect = svgEl.getBoundingClientRect();
            function onMove(e2) {
                var localX = (e2.clientX - rect.left) / rect.width * STAGGER_MOCKUP_W;
                var localY = (e2.clientY - rect.top) / rect.height * STAGGER_MOCKUP_H;
                var norm = _layerStaggerSvgToCurve(localX, localY);
                if (_layerStaggerDragHandle === 'p1') _layerStaggerCurveP1 = norm;
                else if (_layerStaggerDragHandle === 'p2') _layerStaggerCurveP2 = norm;
                _layerStaggerRecomputeOffsets();
            }
            function onUp() {
                _layerStaggerDragHandle = null;
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            }
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        };
    }
    h1.addEventListener('mousedown', startDrag('p1'));
    h2.addEventListener('mousedown', startDrag('p2'));
}

function _layerStaggerInitMockupResizeObserver() {
    var svgEl = document.getElementById('layerStaggerMockupSvg');
    if (!svgEl || typeof ResizeObserver === 'undefined') return;
    new ResizeObserver(function() { _layerStaggerRenderMockup(); }).observe(svgEl);
}

function applyLayerStaggerFromPopup() {
    if (!_layerStaggerLayers.length) { closeLayerStaggerPopup(); return; }
    var payload = [];
    for (var i = 0; i < _layerStaggerLayers.length; i++) {
        payload.push({ layerIndex: _layerStaggerLayers[i].layerIndex, offsetSeconds: _layerStaggerOffsets[i] || 0 });
    }
    var payloadJson = JSON.stringify(payload);
    var escaped = payloadJson.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    run("lineup_staggerLayerStarts('" + escaped + "')", function() {
        closeLayerStaggerPopup();
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
// "Based on" replaces the old <select>+Ignore Masks checkbox; wide tier gets an icon+word flyout, narrow-stack a single icon button that cycles modes.
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
    if (btn) {
        var icon = document.getElementById('anchorModeBtnIcon');
        var lbl  = document.getElementById('anchorModeBtnLbl');
        if (icon) icon.innerHTML = opt.svg;
        if (lbl) lbl.textContent = opt.label;
        btn.title = opt.title;
    }
    // Keep Classic's native <select> in sync too, so switching layout modes or either control never leaves the other stale.
    var select = document.getElementById('anchorModeSelectClassic');
    if (select) select.value = String(opt.id);
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

// Every click just advances to the next mode and wraps back to Object. Narrow-stack only — wide still opens the flyout instead.
function _anchorModeCycle() {
    _anchorModeSet((_anchorMode + 1) % ANCHOR_MODE_OPTIONS.length);
}

// Dispatches by tier: narrow-stack cycles, wide opens the flyout to pick a mode directly.
function _anchorModeBtnClick(btn, e) {
    if (_narrowStack) _anchorModeCycle();
    else _openAnchorModeCtx(btn, e);
}

// Click opens the flyout directly — picking a "based on" mode doesn't DO anything itself, so there's no "re-run the last one" action for left-click.
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

// Anchored to the click itself (event's clientX/Y), not the button's own getBoundingClientRect() — clientX/Y are never distorted by CSS zoom in this CEF build, sidestepping nested-zoom gBCR bugs.
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

// Not persisted across sessions, matching the mode dropdown above (and the checkbox this replaces).
var _ignoreMasks = false;

function _ignoreMasksRefreshButton() {
    var btn = document.getElementById('ignoreMasksBtn');
    if (btn) {
        btn.classList.toggle('active', _ignoreMasks);
        btn.title = _ignoreMasks ? "Ignore Masks: On" : "Ignore Masks: Off";
    }
    // Classic's own plain checkbox — kept in sync here too, same reasoning as the mode select above.
    var check = document.getElementById('ignoreMasksCheckClassic');
    if (check) check.checked = _ignoreMasks;
}

function doToggleIgnoreMasks() {
    _ignoreMasks = !_ignoreMasks;
    _ignoreMasksRefreshButton();
}

// Keeps the button visually square in JS (stretches height:100% to match .anchor-null-btn), same approach as _easeInterpSquareSync.
function _anchorIgnoreMasksSquareSync() {
    var btn = document.getElementById('ignoreMasksBtn');
    if (!btn || !btn.offsetParent) return;
    btn.style.width = btn.offsetHeight + 'px';
}

function _initAnchorIgnoreMasksSquare() {
    var cluster = document.querySelector('.anchor-mode-cluster');
    if (!cluster || typeof ResizeObserver === 'undefined') return;
    new ResizeObserver(_anchorIgnoreMasksSquareSync).observe(cluster);
    _anchorIgnoreMasksSquareSync();
}

// Generalized past the original fixed 9-direction (3x3) offset tables so the same hover/click animation
// serves any n x n grid (currently 3 or 5, via the held-Alt tier — see _buildAnchor5x5Grid). loc is a
// row-major index into the n x n grid; magnitude is the full-scale px offset at a grid's outer edge —
// interior points (5x5's non-border cells) get a fraction of it based on how far off-center they sit.
// Returns null for the exact center cell (odd n only), which scales instead of translating.
function _anchorOffsetFor(loc, n, magnitude) {
    var col = loc % n, row = Math.floor(loc / n);
    var mid = (n - 1) / 2;
    if (col === mid && row === mid) return null;
    return [(col - mid) / mid * magnitude, (row - mid) / mid * magnitude];
}
// Hover nudge vs. "punch to the edge" on click — the latter is more than double, same ratio the original fixed 3x3 tables used.
var ANCHOR_HOVER_MAGNITUDE = 4;
var ANCHOR_SNAP_MAGNITUDE = 11;
// Smooth deceleration, no overshoot (a >1 middle value would bounce past target) — shared by every state change so they all feel like the same motion.
var ANCHOR_ICON_EASING = 'cubic-bezier(0.33, 1, 0.68, 1)';

function _anchorIconTransform(loc, hovered, n) {
    var off = _anchorOffsetFor(loc, n, hovered ? ANCHOR_HOVER_MAGNITUDE : 0);
    if (!off) return hovered ? 'scale(1.12)' : 'scale(1)';
    return 'translate(' + off[0] + 'px, ' + off[1] + 'px)';
}

// One Animation per icon at a time; a new one cancels whatever's playing and continues from its current mid-flight transform instead of snapping, so interruptions blend.
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
        // Bake end state into inline style and release the Animation, so fill:'forwards' Animations don't stack up for future getComputedStyle reads to unwind.
        svg.style.transform = toTransform;
        anim.cancel();
        if (_anchorIconAnims.get(svg) === anim) _anchorIconAnims.delete(svg);
    };
    return anim;
}

// Hover in/out — same easing/mechanism as the click punch below, just two-point instead of three. Replaces the old CSS :hover transition entirely.
function _anchorHoverIconTo(btn, loc, hovered, n) {
    var svg = btn && btn.querySelector('svg');
    if (!svg || typeof svg.animate !== 'function') return;
    _anchorAnimateIconTo(svg, _anchorIconTransform(loc, hovered, n), 180);
}

// Reads each grid's own data-grid-size rather than assuming 3 — the 3x3 and 5x5 grids sit side by side
// in the DOM (see index.html) with only one ever visible (display:grid) at a time.
function _initAnchorBtnHoverAnim() {
    var grids = document.querySelectorAll('.anchor-row .anchor-grid');
    for (var g = 0; g < grids.length; g++) {
        var grid = grids[g];
        var n = parseInt(grid.getAttribute('data-grid-size'), 10) || 3;
        var buttons = grid.querySelectorAll('.anchor-btn');
        for (var i = 0; i < buttons.length; i++) {
            // n passed in explicitly (not just closed over) — it's declared with var in the outer
            // loop over grids, so without this every handler here would share whatever grid's n
            // the loop last landed on instead of its own grid's.
            (function(btn, loc, gridN) {
                btn.addEventListener('mouseenter', function() { _anchorHoverIconTo(btn, loc, true, gridN); });
                btn.addEventListener('mouseleave', function() { _anchorHoverIconTo(btn, loc, false, gridN); });
            })(buttons[i], i, n);
        }
    }
}

// Punches the clicked icon out to the edge, then settles back to hover position; if the cursor leaves mid-animation, the mouseleave handler cancels and blends into this one.
function _animateAnchorClick(loc, btn, n) {
    var svg = btn && btn.querySelector('svg');
    if (!svg || typeof svg.animate !== 'function') return;
    var snapOff = _anchorOffsetFor(loc, n, ANCHOR_SNAP_MAGNITUDE);
    var edgeTransform = snapOff ? 'translate(' + snapOff[0] + 'px, ' + snapOff[1] + 'px)' : 'scale(1.3)';
    var hoverTransform = _anchorIconTransform(loc, true, n);
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

function doAnchor(loc, btn, gridSize) {
    var n = gridSize || 3;
    _animateAnchorClick(loc, btn, n);
    run('lineup_anchorMove(' + loc + ',' + _anchorMode + ',' + (_ignoreMasks ? 1 : 0) + ',' + n + ')');
}

// Right-click on any anchor button: create a null at that grid location instead of moving the
// layer's own anchor point there. Still driven by the same Based-on dropdown (_anchorMode) as a
// left-click, and reuses left-click's own snap animation as the visual confirmation of where it fired.
function doAnchorNull(loc, btn, gridSize) {
    var n = gridSize || 3;
    _animateAnchorClick(loc, btn, n);
    run('lineup_createNullAtAnchor(' + loc + ',' + n + ',' + _anchorMode + ',' + (_ignoreMasks ? 1 : 0) + ')');
}

// ── Held-Alt 5x5 anchor grid (Compact only) ─────────────────────────────────
// Same icon language as the static 3x3 markup in index.html: corner bracket at the 4 true corners,
// a straight edge line along the border cells between them, the center square at the exact middle
// (odd grid sizes only), and a plain dot for every other interior cell — there's no natural
// corner/edge metaphor for e.g. "25% across, one row down", so those just mark their spot.
function _anchorBtnIconSvg(row, col, n) {
    var last = n - 1;
    var isTop = row === 0, isBottom = row === last, isLeft = col === 0, isRight = col === last;
    if (isTop && isLeft)     return '<path d="M7,15 L7,9.5 Q7,7 9.5,7 L15,7"/>';
    if (isTop && isRight)    return '<path d="M17,15 L17,9.5 Q17,7 14.5,7 L9,7"/>';
    if (isBottom && isLeft)  return '<path d="M7,9 L7,14.5 Q7,17 9.5,17 L15,17"/>';
    if (isBottom && isRight) return '<path d="M17,9 L17,14.5 Q17,17 14.5,17 L9,17"/>';
    if (isTop)    return '<line x1="8" y1="8" x2="16" y2="8"/>';
    if (isBottom) return '<line x1="8" y1="16" x2="16" y2="16"/>';
    if (isLeft)   return '<line x1="8" y1="8" x2="8" y2="16"/>';
    if (isRight)  return '<line x1="16" y1="8" x2="16" y2="16"/>';
    if (row === last / 2 && col === last / 2) return '<rect x="8.5" y="8.5" width="7" height="7" rx="1.8"/>';
    return '<circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none"/>';
}

function _buildAnchor5x5Grid() {
    var grid = document.getElementById('anchorGrid5x5');
    if (!grid || grid.childElementCount) return;
    var n = 5, html = '';
    for (var row = 0; row < n; row++) {
        for (var col = 0; col < n; col++) {
            var loc = row * n + col;
            var pct = Math.round(100 / (n - 1));
            var title = 'Anchor ' + (col * pct) + '%, ' + (row * pct) + '%';
            html += '<button class="anchor-btn" title="' + title + '" onclick="doAnchor(' + loc + ', this, ' + n + ')" ' +
                'oncontextmenu="doAnchorNull(' + loc + ', this, ' + n + '); return false;">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
                _anchorBtnIconSvg(row, col, n) + '</svg></button>';
        }
    }
    grid.innerHTML = html;
}

// Tracked globally (not just while hovering the grid) so the swap can react the instant Alt is
// pressed/released anywhere in the panel, matching how modifier-key tool switches behave elsewhere
// (e.g. host apps' own Alt/Option grid tools) rather than requiring the cursor to already be over it.
var _anchorAltHeld = false;

function _isCompactLayout() {
    return !document.body.classList.contains('layout-classic') && !document.body.classList.contains('layout-toolbar');
}

// The 4 corners, 4 edge midpoints, and center sit at the exact same fractional position in both grids
// (loc%3/2 and loc%5/4 both resolve to 0, 0.5, or 1 — see anchorLocToPoint in host.jsx), which is why
// they already share the same corner/edge/center icons. Keyed by 3x3 loc, valued by its coincident 5x5 loc.
var ANCHOR_5X5_LOC_FROM_3X3 = { 0:0, 1:2, 2:4, 3:10, 4:12, 5:14, 6:20, 7:22, 8:24 };
var ANCHOR_3X3_LOC_FROM_5X5 = (function() {
    var out = {};
    for (var k in ANCHOR_5X5_LOC_FROM_3X3) out[ANCHOR_5X5_LOC_FROM_3X3[k]] = parseInt(k, 10);
    return out;
})();

// loc === DOM order, same convention _initAnchorBtnHoverAnim already relies on.
function _anchorGridButtonRects(grid) {
    var buttons = grid.querySelectorAll('.anchor-btn');
    var out = {};
    for (var i = 0; i < buttons.length; i++) out[i] = buttons[i].getBoundingClientRect();
    return out;
}

// One Animation per button at a time — same cancel-and-continue pattern as _anchorIconAnims, so a
// rapid double-tap of Alt (or a click landing mid-swap) blends into whatever's currently running
// instead of the two fighting over the same transform/opacity.
var _anchorBtnSwapAnims = new WeakMap();

function _anchorRunBtnAnim(btn, keyframes, duration) {
    var prev = _anchorBtnSwapAnims.get(btn);
    if (prev) prev.cancel();
    var anim = btn.animate(keyframes, { duration: duration, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'both' });
    _anchorBtnSwapAnims.set(btn, anim);
    anim.onfinish = function() {
        btn.style.transform = '';
        btn.style.opacity = '';
        btn.style.transformOrigin = '';
        anim.cancel();
        if (_anchorBtnSwapAnims.get(btn) === anim) _anchorBtnSwapAnims.delete(btn);
    };
    return anim;
}

// FLIP: rects were captured from the outgoing grid BEFORE it was hidden, so this plays each surviving
// button (corners/edges/center) moving/scaling from its old screen position to its new one, instead of
// the old cross-fade — reads as the same button relocating, not one disappearing and another appearing
// in its place. Buttons with no counterpart in the outgoing grid split into two treatments:
// - Interior ring cells (the 5x5's 8 non-border, non-center dots) bloom in from the grid's own center
//   point: transform-origin is set per-button to that shared center (rather than each button's own
//   center, the default), so a plain scale-down-to-1 reads as contracting into place from the middle of
//   the grid. Looks clean here since these sit well clear of the grid's own edge.
// - Border cells (the 8 remaining edge-line buttons flanking each side's FLIP-mapped midpoint) sit right
//   at the grid's own frame, where that same off-center scale instead read as an odd slide/clip against
//   it — those just get a plain, slower fade instead.
function _flipAnchorGridButtons(toGrid, fromRects, mapToFromLoc) {
    var buttons = toGrid.querySelectorAll('.anchor-btn');
    var n = parseInt(toGrid.getAttribute('data-grid-size'), 10) || Math.round(Math.sqrt(buttons.length));
    var gridRect = toGrid.getBoundingClientRect();
    var gcx = gridRect.left + gridRect.width / 2, gcy = gridRect.top + gridRect.height / 2;
    for (var loc = 0; loc < buttons.length; loc++) {
        var btn = buttons[loc];
        if (typeof btn.animate !== 'function') continue;
        var fromLoc = mapToFromLoc[loc];
        var fromRect = fromLoc !== undefined ? fromRects[fromLoc] : null;
        if (fromRect && fromRect.width && fromRect.height) {
            var toRect = btn.getBoundingClientRect();
            var dx = (fromRect.left + fromRect.width / 2) - (toRect.left + toRect.width / 2);
            var dy = (fromRect.top + fromRect.height / 2) - (toRect.top + toRect.height / 2);
            var sx = fromRect.width / toRect.width, sy = fromRect.height / toRect.height;
            _anchorRunBtnAnim(btn, [
                { transform: 'translate(' + dx + 'px, ' + dy + 'px) scale(' + sx + ', ' + sy + ')', opacity: 1 },
                { transform: 'none', opacity: 1 }
            ], 240);
            continue;
        }
        var col = loc % n, row = Math.floor(loc / n);
        var onBorder = row === 0 || row === n - 1 || col === 0 || col === n - 1;
        if (onBorder) {
            _anchorRunBtnAnim(btn, [{ opacity: 0 }, { opacity: 1 }], 420);
        } else {
            var btnRect = btn.getBoundingClientRect();
            btn.style.transformOrigin = (gcx - btnRect.left) + 'px ' + (gcy - btnRect.top) + 'px';
            _anchorRunBtnAnim(btn, [
                { transform: 'scale(1.08)', opacity: 0 },
                { transform: 'scale(1)', opacity: 1 }
            ], 380);
        }
    }
}

function _syncAnchorAltGrid() {
    var showAlt = _anchorAltHeld && _isCompactLayout();
    var wasAlt = document.body.classList.contains('anchor-alt-5x5');
    if (showAlt === wasAlt) return;

    var grid3 = document.querySelector('.anchor-grid-3x3');
    var grid5 = document.getElementById('anchorGrid5x5');
    if (!grid3 || !grid5) { document.body.classList.toggle('anchor-alt-5x5', showAlt); return; }

    // Measure the outgoing grid while it's still visible, THEN swap, THEN measure/animate the incoming
    // one — getBoundingClientRect() forces a synchronous layout, so no rAF is needed between these steps.
    var fromGrid = showAlt ? grid3 : grid5;
    var fromRects = _anchorGridButtonRects(fromGrid);
    document.body.classList.toggle('anchor-alt-5x5', showAlt);
    var toGrid = showAlt ? grid5 : grid3;
    var mapToFromLoc = showAlt ? ANCHOR_3X3_LOC_FROM_5X5 : ANCHOR_5X5_LOC_FROM_3X3;
    _flipAnchorGridButtons(toGrid, fromRects, mapToFromLoc);
}

// Alt released via keyup while the panel has focus is the common case, but Alt can also go missing
// with no keyup at all (Alt-Tab away, or the OS/host app intercepting it for its own menu) — window
// blur and visibilitychange both force it back off so the grid never gets stuck on 5x5.
//
// preventDefault() on both is required, not cosmetic: a bare Alt tap left unhandled is the Windows
// accelerator for toggling the host app's own menu-mnemonic focus (After Effects' menu bar), which
// steals keyboard focus away from this CEP panel's webview entirely — every Alt press after the first
// would then go to After Effects instead of here, until the user clicked back into the panel. Blocking
// the default here keeps the key event (and focus) inside the panel.
function _initAnchorAltGrid() {
    document.addEventListener('keydown', function(e) {
        if (e.key !== 'Alt') return;
        e.preventDefault();
        if (_anchorAltHeld) return;
        _anchorAltHeld = true;
        _syncAnchorAltGrid();
    });
    document.addEventListener('keyup', function(e) {
        if (e.key !== 'Alt') return;
        e.preventDefault();
        _anchorAltHeld = false;
        _syncAnchorAltGrid();
    });
    window.addEventListener('blur', function() { _anchorAltHeld = false; _syncAnchorAltGrid(); });
    document.addEventListener('visibilitychange', function() {
        if (document.hidden) { _anchorAltHeld = false; _syncAnchorAltGrid(); }
    });
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
// Preview graph shows the copied ease, not the live Timeline selection — each op re-polls the graph immediately rather than waiting for the next tick.

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

// Display box doubles as its own clear button — textContent is set on the nested .ease-display-text span, since the div also holds the hover-only trash icon svg.
function doEaseClear() {
    run('lineup_easeClear()', function() {
        document.querySelector('#easeDisplay .ease-display-text').textContent = '—';
        document.getElementById('easePasteBtn').disabled = true;
        _pollEaseGraph();
        _easeSelIndicatorRender();
    });
}

// ── MARKER CONTROLS ──────────────────────────────────────────────────────────
// Same selection-driven scope as Ease Copy: a selected layer (or nothing, meaning the active comp) is both the read and write target.

// No separate count readout to update — the preview strip is the only feedback now, and
// _renderMarkerPreview (called via _refreshMarkerPreview below) drives Paste/Trash's disabled
// state directly off the clipboard it just fetched, so there's nothing else to sync here.
function doMarkerCopy() {
    run('lineup_markerCopy()', function() { _refreshMarkerPreview(); });
}

// Default paste replaces the target's markers; Alt+click appends alongside whatever's already there instead.
function doMarkerPaste(event) {
    var append = !!(event && event.altKey);
    run('lineup_markerPaste(' + (append ? 1 : 0) + ')', function(result) { showToast(result, 'info'); });
}

function doMarkerClear() {
    run('lineup_markerClear()', function() { _refreshMarkerPreview(); });
}

// Approximates After Effects' default marker/label swatches (index 0 = "None", 1-16 the
// standard label colors) — label colors are user-customizable in AE's own preferences, which
// scripting has no direct read access to, so this is a best-effort visual match, not a live read.
var MARKER_LABEL_COLORS = [
    '#7a7a7a', '#e0524a', '#d1c24a', '#6fd0c4', '#e08fd0', '#a89be0', '#e0a97a', '#8fd0b0',
    '#6f9fe0', '#7fc46a', '#a06fd0', '#e0954a', '#a67c52', '#d060a0', '#5fc0d0', '#c2b280', '#4f7a4a'
];

function _formatMarkerTime(seconds) {
    return (Math.round(seconds * 100) / 100) + 's';
}

// Small icons swapped into the Paste button (see _updateMarkerPasteScopeIcon) so the comp-vs-
// layer target is obvious at a glance instead of needing a sentence of explanatory text — a
// plain rounded-rect outline for "the composition itself", two overlapping ones for "layer(s)".
var MARKER_SCOPE_ICON_COMP  = '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="1" y="2.5" width="12" height="9" rx="1.6"/></svg>';
var MARKER_SCOPE_ICON_LAYER = '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="1" y="4" width="9" height="8" rx="1.4"/><rect x="4" y="1.5" width="9" height="8" rx="1.4"/></svg>';

// data.scope/data.layerCount come from lineup_markerGetClipboard, computed fresh off the CURRENT
// Project/Timeline selection every call — not the clipboard's own recorded scope — so this tracks
// whatever Paste would actually target right now, live as the user's selection changes.
function _updateMarkerPasteScopeIcon(data) {
    var iconEl = document.getElementById('markerPasteScopeIcon');
    if (!iconEl) return;

    if (!data || !data.scope) {
        iconEl.innerHTML = '';
        iconEl.title = '';
        return;
    }

    if (data.scope === 'layer') {
        var count = data.layerCount || 1;
        iconEl.innerHTML = MARKER_SCOPE_ICON_LAYER +
            (count > 1 ? ('<span class="marker-paste-scope-count">' + count + '</span>') : '');
        iconEl.title = 'Will paste onto ' + count + (count === 1 ? ' selected layer' : ' selected layers');
    } else {
        iconEl.innerHTML = MARKER_SCOPE_ICON_COMP;
        iconEl.title = 'Will paste onto the composition';
    }
}

var _markerPreviewLastRaw = null;

// Per-marker delay step for the left-to-right pop-in (see _renderMarkerPreview/
// marker-anim-pop/marker-anim-grow/marker-anim-fade below) — big enough that the sweep actually
// reads as sequential rather than "everything faded in at once" with just 2-4 markers (the
// common case), while a dozen markers still finish staggering in well under a second.
var MARKER_CHIP_STAGGER_MS = 90;
// Fingerprint of the last-ANIMATED markers array — separate from _markerPreviewLastRaw (which
// also changes on a plain scope/layerCount poll tick) so the pop-in only plays for a real
// content change, not every 250ms refresh.
var _markerChipsFingerprint = null;

// Re-renders on an actual clipboard OR paste-target change (dedup via the raw JSON string —
// lineup_markerGetClipboard's scope/layerCount are part of that same string, so a selection
// change alone still counts as "changed" here). Called after every Copy/Clear, once at startup
// to sync the strip with any clipboard left over from a prior panel session, and polled on the
// same 250ms cadence as _pollEaseGraph so the Paste button's comp/layer indicator stays live as
// the user's selection changes while the panel just sits open — gated on offsetParent the same
// way that poll is, so it's a no-op whenever Marker Controls isn't actually visible.
function _refreshMarkerPreview() {
    var box = document.getElementById('markerPreview');
    if (!box || !box.offsetParent) return;
    cs.evalScript('lineup_markerGetClipboard()', function(result) {
        if (!result || result === 'undefined') return;
        if (result === _markerPreviewLastRaw) return;
        _markerPreviewLastRaw = result;
        var data = null;
        try { data = JSON.parse(result); } catch (e) {}
        _renderMarkerPreview(data);
    });
}

// Flat top with rounded corners, tapering to a single point at the bottom — an upside-down
// rounded pentagon, same silhouette as AE's own marker glyphs. clip-path can't round a pointed
// shape's corners, so this is drawn as a real SVG path instead of a CSS-only span.
var MARKER_FLAG_VIEWBOX = '0 0 9 11';
var MARKER_FLAG_PATH = 'M1.5,0 H7.5 A1.5,1.5 0 0 1 9,1.5 V6.5 L4.5,11 L0,6.5 V1.5 A1.5,1.5 0 0 1 1.5,0 Z';

// .marker-chip-flag (the positioned/sized element) is a plain DIV wrapping the
// <svg>, not the <svg> itself — an <svg> is a *replaced* element, and replaced
// elements resolve auto height from their intrinsic ratio rather than an
// absolutely-positioned top+bottom span, so it was quietly NOT stretching to
// the bar's bottom edge. The div (non-replaced) reliably fills that span; the
// svg inside just takes width/height:100% of it.
function _buildMarkerFlagSvg(color) {
    var svgNS = 'http://www.w3.org/2000/svg';
    var wrap = document.createElement('div');
    wrap.className = 'marker-chip-flag';

    var svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', MARKER_FLAG_VIEWBOX);
    // Stretches the path to fill the div's box instead of letterboxing/
    // centering at the pentagon's native 7:11 ratio.
    svg.setAttribute('preserveAspectRatio', 'none');
    var path = document.createElementNS(svgNS, 'path');
    path.setAttribute('d', MARKER_FLAG_PATH);
    path.setAttribute('fill', color);
    path.setAttribute('stroke', 'rgba(0,0,0,0.5)');
    path.setAttribute('stroke-width', '0.75');
    // Keeps the outline a consistent 0.75 (real, non-stretched) units on
    // every edge despite the svg's own non-uniform x/y scale from the
    // preserveAspectRatio="none" stretch above — without this, the stroke
    // would render visibly thicker on the pentagon's horizontal edges than
    // its vertical ones whenever the bar's height differs from 11px.
    path.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.appendChild(path);
    wrap.appendChild(svg);
    return wrap;
}

// Picks a "nice" tick interval (seconds) so a ruler across the given span shows roughly 5-8
// ticks regardless of how long the copied layer/comp actually is — the same round-number-step
// idea any timeline ruler/graph axis uses, just a fixed candidate list instead of a log-scale calc.
var MARKER_RULER_STEPS = [0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200];
function _pickMarkerRulerStep(span) {
    var raw = span / 6;
    for (var i = 0; i < MARKER_RULER_STEPS.length; i++) {
        if (MARKER_RULER_STEPS[i] >= raw) return MARKER_RULER_STEPS[i];
    }
    return MARKER_RULER_STEPS[MARKER_RULER_STEPS.length - 1];
}

// A small time ruler along the very top of the strip — ticks/labels at 0, step, 2*step, ... up
// to span, in the same 0%-100% coordinate space as .marker-layer-bar and the chips below it, so
// a marker's on-screen position can be read against actual comp/layer time, not just eyeballed
// relative to the other markers.
function _buildMarkerTimelineRuler(span) {
    var ruler = document.createElement('div');
    ruler.className = 'marker-preview-ruler';

    var step  = _pickMarkerRulerStep(span);
    var count = Math.floor(span / step + 1e-6);

    for (var i = 0; i <= count; i++) {
        var t   = i * step;
        var pct = Math.min((t / span) * 100, 100);

        var tick = document.createElement('div');
        tick.className = 'marker-ruler-tick';
        tick.style.left = pct + '%';
        ruler.appendChild(tick);

        var label = document.createElement('span');
        label.className = 'marker-ruler-label';
        label.style.left = pct + '%';
        // First tick hugs the left edge, last hugs the right — centered would run the labels at
        // either end off the edge of the (overflow:hidden) preview box.
        label.style.transform = (i === 0) ? 'translateX(0)' : (pct >= 99) ? 'translateX(-100%)' : 'translateX(-50%)';
        label.textContent = _formatMarkerTime(t);
        ruler.appendChild(label);
    }

    return ruler;
}

// Draws the source layer/comp itself as a rectangle (.marker-layer-bar, sized to data.span —
// the real layer/comp duration, not just the first-to-last-marker stretch), then lays one
// .marker-chip per copied marker over it: a pentagon flag at its relative start time, a solid
// colored region across the bar for its duration (if any), and a text tag with its comment —
// the "tags, colors, and durations" readout of what got copied, against the layer it came from.
// Also the sole source of truth for Paste/Trash's disabled state, so it stays in sync with the
// clipboard whether that changed via Copy, Clear, or (on panel load) a prior session entirely.
function _renderMarkerPreview(data) {
    var box   = document.getElementById('markerPreview');
    var track = document.getElementById('markerPreviewTrack');
    if (!box || !track) return;

    var markers = (data && Array.isArray(data.markers)) ? data.markers.slice() : [];

    var pasteBtn = document.getElementById('markerPasteBtn');
    var clearBtn = document.getElementById('markerClearBtn');
    if (pasteBtn) pasteBtn.disabled = markers.length === 0;
    if (clearBtn) clearBtn.disabled = markers.length === 0;
    _updateMarkerPasteScopeIcon(markers.length === 0 ? null : data);

    track.innerHTML = '';

    if (markers.length === 0) {
        box.classList.add('is-empty');
        return;
    }
    box.classList.remove('is-empty');
    markers.sort(function(a, b) { return a.relTime - b.relTime; });

    // The "markers placed left to right" pop-in only plays when the actual copied markers
    // changed (a real Copy/Clear) — not on every 250ms poll tick, most of which fire because
    // scope/layerCount changed (the user picked a different layer) with the same clipboard.
    var chipsFingerprint = JSON.stringify(markers);
    var shouldAnimate = chipsFingerprint !== _markerChipsFingerprint;
    _markerChipsFingerprint = chipsFingerprint;

    // Falls back to the markers' own extent (padded) only for stale/odd data with no span —
    // the normal case always has data.span from lineup_markerGetClipboard.
    var span = (data && data.span > 0) ? data.span : 0;
    if (span <= 0) {
        var tMax = 0;
        for (var i = 0; i < markers.length; i++) tMax = Math.max(tMax, markers[i].relTime + (markers[i].duration || 0));
        span = Math.max(tMax, 0.001) * 1.08;
    }

    track.appendChild(_buildMarkerTimelineRuler(span));

    var bar = document.createElement('div');
    bar.className = 'marker-layer-bar';
    track.appendChild(bar);

    for (var i = 0; i < markers.length; i++) {
        var m = markers[i];
        var color   = MARKER_LABEL_COLORS[m.label] || MARKER_LABEL_COLORS[0];
        var leftPct = Math.min(Math.max((m.relTime / span) * 100, 0), 100);
        // Markers are already sorted left-to-right (by relTime) above, so the loop index alone
        // gives a clean left-to-right stagger — no separate position-based delay math needed.
        var animDelay = (i * MARKER_CHIP_STAGGER_MS) + 'ms';

        if (m.duration > 0) {
            var region = document.createElement('div');
            region.className = 'marker-chip-region';
            region.style.left = leftPct + '%';
            region.style.width = Math.max((Math.min(m.duration, span - m.relTime) / span) * 100, 0.8) + '%';
            // The bar's own dark grey (#222222, matching .marker-layer-bar's background) at the
            // marker's start (left), fading into its real label color by the duration's end
            // (right) — reads as the color "arriving" at the end of the duration rather than a
            // flat block, with the region blending into the bar itself at its own start.
            region.style.background = 'linear-gradient(90deg, #222222 0%, ' + color + ' 100%)';
            if (shouldAnimate) {
                region.classList.add('marker-anim-grow');
                region.style.animationDelay = animDelay;
            }
            bar.appendChild(region);
        }

        var chip = document.createElement('div');
        chip.className = 'marker-chip';
        chip.style.left = leftPct + '%';
        chip.title = (m.comment || '(no comment)') + ' — ' + _formatMarkerTime(m.relTime) +
            (m.duration > 0 ? (' · ' + _formatMarkerTime(m.duration) + ' duration') : '');

        var flagEl = _buildMarkerFlagSvg(color);
        if (shouldAnimate) {
            flagEl.classList.add('marker-anim-pop');
            flagEl.style.animationDelay = animDelay;
        }
        chip.appendChild(flagEl);

        if (m.comment) {
            var tag = document.createElement('span');
            tag.className = 'marker-chip-tag';
            tag.textContent = m.comment;
            if (shouldAnimate) {
                tag.classList.add('marker-anim-fade');
                tag.style.animationDelay = animDelay;
            }
            chip.appendChild(tag);
        }

        track.appendChild(chip);
    }
}

// Backs the quick-swap interpolation button; applies to the live Timeline selection, independent of the ease clipboard. Re-polls immediately for the corner indicator.
// Bezier defaults to Continuous Bezier — Alt-click for plain Bezier. Ctrl-click either flavor to zero the new ease's speed (Easy-Ease-style) instead of median velocity.
function doSetKeyInterpolation(kind, e) {
    if (kind === 'bezier') kind = (e && e.altKey) ? 'bezier' : 'continuousbezier';
    var zeroVelocity = !!(e && e.ctrlKey);
    run('lineup_setKeyframeInterpolation(\'' + kind + '\', ' + zeroVelocity + ')', function(result) {
        if (result) showToast(result, 'info');
        _pollEaseGraph();
    });
}

// One square button instead of 3 (too cramped): left-click runs the active mode, right-click flyout picks and becomes the new default — same convention as Select Paths.
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

// Keeps the button visually square in JS; ResizeObserver on the row (not the button) since only the row's height change should re-sync width.
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
    // Colors the button by type via a plain data attribute rather than 3 classes since only ever one applies at a time.
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

// Same cursor-anchored positioning as _openShapeSelCtx — clientX/Y from the event, not gBCR, since the latter can be distorted by CSS zoom here.
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
// Shows the *copied* ease (clipboard), not the live Timeline selection; multi-dimensional properties get one independently-normalized line per dimension.
var EASE_PREVIEW_SAMPLES = 24; // per segment
var EASE_PREVIEW_W = 200;
var EASE_PREVIEW_H = 100;
var EASE_DIM_COLORS = ['#7aaaff', '#e05555', '#5ec47a', '#c084e0']; // matches the original single-line blue at dim 0, so a scalar property's graph looks unchanged
var _easeGraphLastRaw = null;

function _easeBezierPoint(p0, p1, p2, p3, u) {
    var mu = 1 - u;
    return mu*mu*mu*p0 + 3*mu*mu*u*p1 + 3*mu*u*u*p2 + u*u*u*p3;
}

// A keyframe's value along one dimension: plain number (Opacity, always dim 0) or per-dimension array (Position, Scale, ...).
function _easeDimValue(v, dim) {
    if (Array.isArray(v)) return dim < v.length ? v[dim] : 0;
    return (dim === 0 && typeof v === 'number') ? v : 0;
}

// How many value dimensions the copied keyframes have. Reads the first array-valued key found rather than assuming keys[0], in case a key serializes differently.
function _easeNumDims(keys) {
    for (var i = 0; i < keys.length; i++) {
        if (Array.isArray(keys[i].value)) return Math.max(1, keys[i].value.length);
    }
    return 1;
}

// Spatial properties (Position) carry exactly ONE shared ease entry regardless of value dimension count, so this falls back to entry 0 when dim has none of its own.
function _easeDimEase(easeArr, dim) {
    if (!easeArr || !easeArr.length) return { speed: 0, influence: 100 / 3 };
    return easeArr[dim] || easeArr[0];
}

// A hold or linear-both-sides segment has no meaningful bezier handles; shared by the sampler and handle-drawing pass so they never disagree.
function _easeSegmentIsBezier(kA, kB) {
    return kA.outType !== 'hold' && !(kA.outType === 'linear' && kB.inType === 'linear');
}

// Bezier control points {t1,v1,t2,v2}, reconstructed from speed/influence like AE does; shared by _easeSegmentSamples and _easePreviewRender's handle lines so geometry never disagrees.
function _easeSegmentControlPoints(kA, kB, dim) {
    var tA = kA.time, tB = kB.time, dt = tB - tA;
    var vA = _easeDimValue(kA.value, dim), vB = _easeDimValue(kB.value, dim);
    var outE = _easeDimEase(kA.outEase, dim);
    var inE  = _easeDimEase(kB.inEase, dim);
    // Both sides CAN legitimately be 100% influence at once (a valid extreme ease); left as raw values so control points can cross in time, same as AE's own graph.
    var outInf = outE.influence, inInf = inE.influence;
    var t1 = tA + (outInf / 100) * dt;
    var v1 = vA + outE.speed * (t1 - tA);
    var t2 = tB - (inInf / 100) * dt;
    var v2 = vB - inE.speed * (tB - t2);
    return { t1: t1, v1: v1, t2: t2, v2: v2 };
}

// {t, v} samples between two consecutive keyframes for one dimension,
// walking the parametric bezier directly (exact, no time->value inversion
// needed).
function _easeSegmentSamples(kA, kB, dim) {
    var tA = kA.time, tB = kB.time, dt = tB - tA;
    if (!(typeof tA === 'number' && typeof tB === 'number' && dt > 0)) return [];
    var vA = _easeDimValue(kA.value, dim), vB = _easeDimValue(kB.value, dim);
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

    var cp = _easeSegmentControlPoints(kA, kB, dim);
    for (var k = 0; k <= EASE_PREVIEW_SAMPLES; k++) {
        var u = k / EASE_PREVIEW_SAMPLES;
        out.push({ t: _easeBezierPoint(tA, cp.t1, cp.t2, tB, u), v: _easeBezierPoint(vA, cp.v1, cp.v2, vB, u) });
    }
    return out;
}

function _pollEaseGraph() {
    var box = document.getElementById('easePreview');
    if (!box || !box.offsetParent) return;
    // Cheap fallback alongside the ResizeObserver — belt and suspenders for any resize it doesn't catch.
    _easeInterpSquareSync();
    cs.evalScript('lineup_easeGetClipboard()', function(result) {
        if (result === _easeGraphLastRaw) return;
        _easeGraphLastRaw = result;
        // {keys, is3D} — is3D is the copied layer's real threeDLayer flag, not derived from array lengths (see _easePreviewRender).
        var clip = null;
        try { clip = JSON.parse(result); } catch(e) {}
        _easePreviewRender(clip);
    });
}

// Corner badge just mirrors #easeDisplay's own text, so there's no separate count/type computation to maintain here. Hidden when that text is the placeholder dash.
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

    // Value/ease array LENGTH isn't reliable: a 2D layer's Scale can carry a vestigial Z ease entry. data.is3D (the real threeDLayer flag) is authoritative instead.
    var numDims = _easeNumDims(keys);
    if (!(data && data.is3D)) numDims = Math.min(numDims, 2);
    var tMin = keys[0].time, tMax = keys[keys.length - 1].time, tSpan = (tMax - tMin) || 1;

    // 5% margin on both axes, on top of .ease-preview's CSS padding.
    var X_MARGIN = EASE_PREVIEW_W * 0.05, VALUE_TOP = EASE_PREVIEW_H * 0.05;
    var PLOT_W = EASE_PREVIEW_W - 2 * X_MARGIN, VALUE_H = EASE_PREVIEW_H - 2 * VALUE_TOP;
    function xOf(t) { return X_MARGIN + ((t - tMin) / tSpan) * PLOT_W; }

    var handlesG = document.getElementById('easePreviewHandles');
    if (handlesG) handlesG.innerHTML = '';
    var pathsG = document.getElementById('easePreviewValuePaths');
    var pointsG = document.getElementById('easePreviewPoints');
    if (pathsG) pathsG.innerHTML = '';
    if (pointsG) pointsG.innerHTML = '';

    // Keyframe markers are always a diamond. Sized as R/scale per axis (not fixed viewBox units) so preserveAspectRatio="none" stretch doesn't squish it into a rhombus.
    var svgEl = document.getElementById('easePreviewSvg');
    var svgRect = svgEl ? svgEl.getBoundingClientRect() : null;
    var sx = (svgRect && svgRect.width)  ? svgRect.width  / EASE_PREVIEW_W : 1;
    var sy = (svgRect && svgRect.height) ? svgRect.height / EASE_PREVIEW_H : 1;
    var R = 5; // desired on-screen half-diagonal, in real pixels
    var rx = R / sx, ry = R / sy;
    var svgNS = 'http://www.w3.org/2000/svg';

    // Every dimension shares ONE vertical scale (combined min/max), matching AE's own graph editor — per-axis normalization would erase genuine amplitude differences between axes.
    var samplesByDim = {};
    var vMin = Infinity, vMax = -Infinity;
    for (var d = 0; d < numDims; d++) {
        var samples = [];
        for (var i = 0; i < keys.length - 1; i++) {
            samples = samples.concat(_easeSegmentSamples(keys[i], keys[i + 1], d));
        }
        samplesByDim[d] = samples;
        samples.forEach(function(s) {
            if (s.v < vMin) vMin = s.v;
            if (s.v > vMax) vMax = s.v;
        });
    }
    var vSpan = (vMax - vMin) || 1;
    function yOfValue(v) { return VALUE_TOP + VALUE_H - ((v - vMin) / vSpan) * VALUE_H; }

    // Draw order puts dimension 0 (blue) LAST so that when linked dimensions share identical eases and overlap exactly, blue always wins SVG paint order.
    var drawOrder = [];
    for (var d = 1; d < numDims; d++) drawOrder.push(d);
    drawOrder.push(0);

    var anySamples = false;
    for (var oi = 0; oi < drawOrder.length; oi++) {
        var dim = drawOrder[oi];
        var allSamples = samplesByDim[dim];
        if (!allSamples.length) continue;
        anySamples = true;

        (function(color) {

            var valuePath = '';
            allSamples.forEach(function(s, si) {
                valuePath += (si === 0 ? 'M' : 'L') + xOf(s.t).toFixed(2) + ',' + yOfValue(s.v).toFixed(2) + ' ';
            });
            if (pathsG) {
                var pathEl = document.createElementNS(svgNS, 'path');
                pathEl.setAttribute('class', 'ease-preview-value-path');
                pathEl.setAttribute('d', valuePath.trim());
                pathEl.style.stroke = color; // inline style, not setAttribute — needs to outrank the CSS class's own default stroke
                pathsG.appendChild(pathEl);
            }

            if (pointsG) {
                keys.forEach(function(k) {
                    var cx = xOf(k.time), cy = yOfValue(_easeDimValue(k.value, dim));
                    var pts = [
                        cx.toFixed(2) + ',' + (cy - ry).toFixed(2),
                        (cx + rx).toFixed(2) + ',' + cy.toFixed(2),
                        cx.toFixed(2) + ',' + (cy + ry).toFixed(2),
                        (cx - rx).toFixed(2) + ',' + cy.toFixed(2)
                    ].join(' ');
                    var poly = document.createElementNS(svgNS, 'polygon');
                    poly.setAttribute('points', pts);
                    poly.style.stroke = color;
                    pointsG.appendChild(poly);
                });
            }

            // Bezier handles: a thin line from each keyframe to its control point (_easeSegmentControlPoints), with a dot at the far end; skipped for hold/linear segments.
            if (handlesG) {
                var HR = 3; // smaller than the keyframe diamonds' own R, same real-pixel-radius trick
                var hrx = HR / sx, hry = HR / sy;
                function appendHandle(x0, y0, x1, y1) {
                    var line = document.createElementNS(svgNS, 'line');
                    line.setAttribute('x1', x0.toFixed(2));
                    line.setAttribute('y1', y0.toFixed(2));
                    line.setAttribute('x2', x1.toFixed(2));
                    line.setAttribute('y2', y1.toFixed(2));
                    line.setAttribute('class', 'ease-preview-handle-line');
                    line.style.stroke = color;
                    handlesG.appendChild(line);

                    var dot = document.createElementNS(svgNS, 'ellipse');
                    dot.setAttribute('cx', x1.toFixed(2));
                    dot.setAttribute('cy', y1.toFixed(2));
                    dot.setAttribute('rx', hrx.toFixed(2));
                    dot.setAttribute('ry', hry.toFixed(2));
                    dot.setAttribute('class', 'ease-preview-handle-dot');
                    dot.style.fill = color;
                    handlesG.appendChild(dot);
                }
                for (var hi = 0; hi < keys.length - 1; hi++) {
                    var hkA = keys[hi], hkB = keys[hi + 1];
                    if (!_easeSegmentIsBezier(hkA, hkB)) continue;
                    var cp = _easeSegmentControlPoints(hkA, hkB, dim);
                    var ax = xOf(hkA.time), ay = yOfValue(_easeDimValue(hkA.value, dim));
                    var bx = xOf(hkB.time), by = yOfValue(_easeDimValue(hkB.value, dim));
                    appendHandle(ax, ay, xOf(cp.t1), yOfValue(cp.v1));
                    appendHandle(bx, by, xOf(cp.t2), yOfValue(cp.v2));
                }
            }
        })(EASE_DIM_COLORS[dim % EASE_DIM_COLORS.length]);
    }

    if (!anySamples) { box.classList.add('is-empty'); return; }
    box.classList.remove('is-empty');
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

    // Align Edges sits up top, mirroring the hidden main-panel checkbox, so it doesn't interfere with the grid cells below.
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

    // Gap row: icon + input pairs mirroring the main-panel gridHPadInput/gridVPadInput fields, kept in sync both ways.
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

// Clicking a cell or the checkmark both land here and apply the grid immediately, instead of just stashing cols/rows for later.
function _commitGridPicker() {
    var cols = Math.max(1, parseInt(_gridPickerWInput.value, 10) || 1);
    var rows = Math.max(1, parseInt(_gridPickerHInput.value, 10) || 1);
    document.getElementById('gridColsInput').value = cols;
    document.getElementById('gridRowsInput').value = rows;
    _closeGridPicker();
    doDistGrid();
}

// A near-square cols x rows guess sized to the current selection (e.g. 6 -> 3x2); cols always >= rows, matching how comps are usually wider than tall.
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

    // Cached lazily on first hover move rather than re-measured every mousemove; cleared on mouseleave so a repositioned popup gets a fresh measurement.
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
        // Cached once — the track doesn't move/resize for the drag's duration, so per-mousemove re-measuring was avoidable work.
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
// Decorative sine-wave curve — not the actual selected layer's path, just a stand-in for previewing spacing.

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
// Flat list of every Z/Path/Radial/Grid setting; edits write straight to the same hidden fields, so closing the popup never discards anything (unlike drag pickers above).

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

// descend comes directly from whichever direction button was clicked. Group-into-a-null was removed as a control; lineup_sortLayers still accepts it, always passed 0.
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

// AE's native tool-group convention, mode shared/global via .shape-sel-btn; every icon framed in a dashed "marching ants" square so it reads as "this selects something".
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

// Only swaps the <svg> and label (if present), not the button's own innerHTML wholesale, so this can't clobber anything else a given instance contains.
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

// Right-click flyout: icon+label per item, active mode highlighted; label drops to icon-only (.compact) when it wouldn't fit — see _openShapeSelCtx.
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

// Some Tools tab tiles (Smart Select/Link/Merge, Select Paths/Fill/Stroke, Split
// Text) already own a right-click mode-picker flyout, built on this same .fav-ctx
// shell — rather than stack a second favorite-only popup on top of theirs, Favorite
// is folded in as a trailing row (see the 3 call sites below and
// _initToolsFavContextMenu's exclusion of these tiles' own classes). Only appears
// when btn is the Tools tab's own tile (has data-tool-id) — the Home widget's copy
// of the same button, which shares this flyout, has nothing to favorite.
function _syncFavRowInCtx(ctxEl, btn, closeFn) {
    var row = ctxEl.querySelector('.shape-sel-ctx-row');
    var oldDivider = ctxEl.querySelector('.tools-fav-ctx-divider');
    var oldBtn = ctxEl.querySelector('.tools-fav-ctx-btn');
    if (oldDivider) oldDivider.parentNode.removeChild(oldDivider);
    if (oldBtn) oldBtn.parentNode.removeChild(oldBtn);
    if (!(btn.classList.contains('tools-grid-btn') && btn.hasAttribute('data-tool-id'))) return;
    var id = btn.getAttribute('data-tool-id');
    var active = _isToolFavorited(id);
    var divider = document.createElement('div');
    divider.className = 'tools-fav-ctx-divider';
    row.appendChild(divider);
    var favBtn = document.createElement('button');
    favBtn.type = 'button';
    favBtn.className = 'shape-sel-ctx-icon-btn tools-fav-ctx-btn';
    favBtn.classList.toggle('active', active);
    favBtn.innerHTML = (active ? _FAV_STAR_SVG_FILL : _FAV_STAR_SVG) +
        '<span class="shape-sel-ctx-lbl">' + (active ? 'Remove Favorite' : 'Favorite') + '</span>';
    favBtn.addEventListener('click', function() {
        _toggleToolFavorite(id);
        closeFn();
    });
    row.appendChild(favBtn);
}

// Anchored to the click's clientX/Y (not gBCR, which CSS zoom can distort here). Measured before .visible (opacity:0 base is already laid out) to test-fit labeled vs .compact.
// Re-parented into the button's own .tab-panel so the popup scales along with that subtree's Panel Scale/zoom, same fix as _openAnchorModeCtx.
function _openShapeSelCtx(btn, e) {
    if (!_shapeSelCtx) _shapeSelCtx = _buildShapeSelCtx();
    var container = btn.closest('.tab-panel') || document.body;
    container.appendChild(_shapeSelCtx);
    var items = _shapeSelCtx.querySelectorAll('.shape-sel-ctx-icon-btn');
    for (var i = 0; i < items.length; i++) {
        items[i].classList.toggle('active', items[i].getAttribute('data-mode') === _shapeSelMode);
    }
    _syncFavRowInCtx(_shapeSelCtx, btn, _closeShapeSelCtx);
    // A CEP panel's own width IS the viewport width, so "horizontally compressed" means the panel itself isn't wide enough for icon+text.
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

// Split Text — same AE-native-toolbar convention as Select Paths/Fill/Stroke, except the icon never changes, just its title. Reuses .shape-sel-ctx flyout styling wholesale.
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

// Positioned from the click itself, same reasoning/fix as _openShapeSelCtx above; still re-parented into the button's .tab-panel to scale with its zoom.
function _openSplitTextCtx(btn, e) {
    if (!_splitTextCtx) _splitTextCtx = _buildSplitTextCtx();
    var container = btn.closest('.tab-panel') || document.body;
    container.appendChild(_splitTextCtx);
    var items = _splitTextCtx.querySelectorAll('.shape-sel-ctx-icon-btn');
    for (var i = 0; i < items.length; i++) {
        items[i].classList.toggle('active', items[i].getAttribute('data-mode') === _splitTextMode);
    }
    _syncFavRowInCtx(_splitTextCtx, btn, _closeSplitTextCtx);
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

// Smart Select/Link/Merge — same toolbar convention as Select Paths/Fill/Stroke; icon switches to match since these three are unrelated. fn is each mode's real doSmart*() directly, not a wrapper, so per-mode toast/callback behavior stays intact.
var SMART_MODES = [
    {
        id: 'select', title: 'Smart Select', shortLabel: 'Smart Select', flyoutLabel: 'Select', fn: doSmartSelect,
        svg: '<svg viewBox="-11.6 -11.6 42.7 42.7" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
            '<defs><mask id="smartSelectCursorMask" maskUnits="userSpaceOnUse" x="-13" y="-13" width="46" height="46">' +
            '<rect x="-13" y="-13" width="46" height="46" fill="#fff" stroke="none"/>' +
            '<path d="M11,11 L16.92,25.3 L20.65,19.78 L26.59,16.27 Z" fill="#000" stroke="#000" stroke-width="7.85" stroke-linejoin="round"/>' +
            '</mask></defs>' +
            '<rect x="-5.96" y="-5.96" width="30.35" height="30.35" rx="7.14" stroke-width="2.78" stroke-dasharray="3.93,3.57" opacity="0.55" mask="url(#smartSelectCursorMask)"/>' +
            '<path d="M-2.21,-11.49 Q0.089,-4.507 7.07,-2.21 Q0.089,0.089 -2.21,7.07 Q-4.507,0.089 -11.49,-2.21 Q-4.507,-4.507 -2.21,-11.49 Z" fill="currentColor" stroke="none"/>' +
            '<path d="M11,11 L16.92,25.3 L20.65,19.78 L26.59,16.27 Z" fill="currentColor" stroke="currentColor" stroke-width="3.21" stroke-linejoin="round"/></svg>'
    },
    {
        id: 'link', title: 'Smart Link — multiple layers share one null, each offset from the first layer\'s value', shortLabel: 'Smart Link', flyoutLabel: 'Link', fn: doSmartLink,
        svg: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M5,3 L1,3 L1,17 L5,17"/>' +
            '<path d="M15,3 L19,3 L19,17 L15,17"/>' +
            '<line x1="5" y1="6.5" x2="15" y2="6.5"/>' +
            '<line x1="5" y1="10" x2="15" y2="10"/>' +
            '<line x1="5" y1="13.5" x2="15" y2="13.5"/></svg>'
    },
    {
        id: 'merge', title: 'Smart Merge', shortLabel: 'Smart Merge', flyoutLabel: 'Merge', fn: doSmartMerge,
        svg: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
            '<line x1="1.5" y1="10" x2="8.2" y2="10"/>' +
            '<polyline points="6,7.3 8.5,10 6,12.7"/>' +
            '<line x1="18.5" y1="10" x2="11.8" y2="10"/>' +
            '<polyline points="14,7.3 11.5,10 14,12.7"/>' +
            '<path d="M4.6,0.3 Q5.3178,2.4822 7.5,3.2 Q5.3178,3.9178 4.6,6.1 Q3.8822,3.9178 1.7,3.2 Q3.8822,2.4822 4.6,0.3 Z" fill="currentColor" stroke="none"/></svg>'
    }
];
var SMART_MODE_KEY = 'lineup-smart-mode';
var _smartMode = 'select';

function _smartFindMode(id) {
    for (var i = 0; i < SMART_MODES.length; i++) {
        if (SMART_MODES[i].id === id) return SMART_MODES[i];
    }
    return SMART_MODES[0];
}

function _smartInit() {
    var saved;
    try { saved = localStorage.getItem(SMART_MODE_KEY); } catch (e) {}
    _smartMode = _smartFindMode(saved).id;
    _smartRefreshButtons();
}

function _smartSetMode(id) {
    _smartMode = _smartFindMode(id).id;
    try { localStorage.setItem(SMART_MODE_KEY, _smartMode); } catch (e) {}
    _smartRefreshButtons();
}

// Only swaps the <svg> and label text, not the button's own innerHTML wholesale — see _shapeSelRefreshButtons.
function _smartRefreshButtons() {
    var mode = _smartFindMode(_smartMode);
    document.querySelectorAll('.smart-btn').forEach(function(btn) {
        var svg = btn.querySelector('svg');
        if (svg) svg.outerHTML = mode.svg;
        var label = btn.querySelector('.smart-label');
        if (label) label.textContent = mode.shortLabel;
        btn.title = mode.title;
    });
}

function _smartRunActive() {
    _smartFindMode(_smartMode).fn();
}

var _smartCtx = null;

function _buildSmartCtx() {
    var el = document.createElement('div');
    el.className = 'fav-ctx shape-sel-ctx';
    var row = document.createElement('div');
    row.className = 'shape-sel-ctx-row';
    SMART_MODES.forEach(function(mode) {
        var item = document.createElement('button');
        item.type = 'button';
        item.className = 'shape-sel-ctx-icon-btn';
        item.title = mode.title;
        item.innerHTML = mode.svg + '<span class="shape-sel-ctx-lbl">' + mode.flyoutLabel + '</span>';
        item.setAttribute('data-mode', mode.id);
        item.addEventListener('click', function() {
            _smartSetMode(mode.id);
            mode.fn();
            _closeSmartCtx();
        });
        row.appendChild(item);
    });
    el.appendChild(row);
    document.body.appendChild(el);
    return el;
}

// Same positioning/measuring approach as _openShapeSelCtx — see its own comment for why.
function _openSmartCtx(btn, e) {
    if (!_smartCtx) _smartCtx = _buildSmartCtx();
    var container = btn.closest('.tab-panel') || document.body;
    container.appendChild(_smartCtx);
    var items = _smartCtx.querySelectorAll('.shape-sel-ctx-icon-btn');
    for (var i = 0; i < items.length; i++) {
        items[i].classList.toggle('active', items[i].getAttribute('data-mode') === _smartMode);
    }
    _syncFavRowInCtx(_smartCtx, btn, _closeSmartCtx);
    var cw = container.clientWidth, ch = container.clientHeight;
    _smartCtx.classList.remove('compact');
    var wideFits = (_smartCtx.offsetWidth + 8) <= cw;
    _smartCtx.classList.toggle('compact', !wideFits);

    var containerRect = container.getBoundingClientRect();
    var rect = btn.getBoundingClientRect();
    var cx = (e ? e.clientX : rect.left) - containerRect.left;
    var cy = (e ? e.clientY : rect.top)  - containerRect.top;
    var ctxW = _smartCtx.offsetWidth;
    var ctxH = _smartCtx.offsetHeight;
    var left = Math.min(Math.max(4, cx - ctxW / 2), cw - ctxW - 4);
    var top = (cy + 4 + ctxH <= ch)
        ? cy + 4
        : Math.max(4, cy - ctxH - 4);
    _smartCtx.style.left = left + 'px';
    _smartCtx.style.top  = top + 'px';
    _smartCtx.classList.add('visible');
    setTimeout(function() {
        document.addEventListener('mousedown', _smartCtxOutside);
        document.addEventListener('keydown', _smartCtxKey);
    }, 0);
}

function _closeSmartCtx() {
    if (_smartCtx) _smartCtx.classList.remove('visible');
    document.removeEventListener('mousedown', _smartCtxOutside);
    document.removeEventListener('keydown', _smartCtxKey);
}

function _smartCtxOutside(e) {
    if (_smartCtx && !_smartCtx.contains(e.target)) _closeSmartCtx();
}

function _smartCtxKey(e) {
    if (e.key === 'Escape') _closeSmartCtx();
}

// .altKey is read here, not in host.jsx, since modifier-key state is a DOM/JS-side concern; forwarded as a plain 0/1 into the eval string.
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
// Live Fill/Stroke summary modeled on AE's Tools-panel swatches; lineup_getShapeColorHud in host.jsx scans selected shape layers, or all if none selected.

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
// Neither <input type="color"> nor ExtendScript's $.colorPicker() can open AE's own Fill/Stroke dialog, so this is a from-scratch HSB picker styled after it but narrow.

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

// Shared onChange for all three RGB scrubs — re-reads all three rather than tracking which one fired, since there's no cheap way to tell which field the user just edited.
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

// Recomputes RGB/hex/handles from HSB; hueChanged also redraws the Sat/Brightness square since its gradient is tinted by hue.
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

// Standard three-layer HSB square trick: solid hue, white→transparent across X, transparent→black down Y. Redrawn only when hue changes.
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

// Static — every hue 0-360, wrapping to red at the bottom same as top — drawn once, never redrawn since it doesn't depend on state.
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

// rgb01: [r,g,b] each 0-1 (AE's color format). onApply fires only on OK; Cancel/outside-click/× just closes with no callback.
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

// Applies a { type: 'none'|'color'|'mix', value } summary to a swatch. Fill paints background (a dot); stroke paints border (a ring).
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

// Direct edits on the HUD's own swatches always override every fill/stroke in scope; per-instance editing lives in the full popup instead.
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
        // Always shows *something* — "0 px" rather than blank when there's no stroke in scope — so the control stays visible/legible.
        var text = (!w || w.type === 'none') ? '0 px' : (w.type === 'mix' ? 'Mix' : (Math.round(w.value * 10) / 10) + ' px');
        _headerWidthScrub.render(text); // no-ops itself while the user is mid-drag/edit
    }
}

// Blue scrubbable px number: drag to change, click (no drag) to type exactly — shared by the header's stroke-width field and the edit modal's width cells.
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

// Same "always overrides every stroke in scope" behavior as the color swatches — per-instance editing lives in the full popup.
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

// Throttled to 1s (vs Align's 300ms) since this scan can walk every shape layer in the comp; skips the round-trip when Shape Tools isn't visible.
// afterUpdate fires once this tick's round-trip lands (regardless of change), so a caller can re-render from _shapeColorHudLast only once it's fresh.
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
// Full popup, unified across Fill/Stroke as two tabs (switching re-renders #shapeEditBody); lists every polled instance plus an "All Fills/Strokes" row.

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

// Solid Fill/Stroke = plain swatch square; No Fill/Stroke reuses the diagonal-red-slash .vectools-swatch-none square — matches AE's on/off iconography.
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

    // Solid/No Fill(Stroke) toggles every instance's on/off state (AE's Contents-panel checkbox), not a color change.
    var html = '<div class="vectools-edit-onoff-row">' +
        '<button type="button" class="vectools-edit-onoff-btn' + (enabledSummary.type === 'all' ? ' active' : '') + '" data-role="on" title="' + onTitle + '">' + _shapeEditOnIcon() + '</button>' +
        '<button type="button" class="vectools-edit-onoff-btn' + (enabledSummary.type === 'none' ? ' active' : '') + '" data-role="off" title="' + offTitle + '">' + _shapeEditOffIcon() + '</button>' +
        '</div>';

    // Color cells are plain buttons (not <input type="color">, which never opens in CEP) that open the in-panel picker; width cells reuse _makeWidthScrub.
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
// Freely editable icon grid pinning any Tools-tab tool; generalized to multiple bars via QA_INSTANCES, sharing _editMode with Bottom Layout's drag-reorder.

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

// 'main' keeps a fixed 3x2 cap (6-wide/one-line in narrow-stack), but unlike quickactions2 never gets connected-bar chrome — stays individually bordered squares.
// 'quickactions2' docks full-width (6 cols x1 row) or half-width (3 cols x2 rows) in Bottom Layout — both cap at 6 tiles, so switching never truncates pins.
function _qaGridShape(instKey) {
    if (instKey !== 'quickactions2') return _narrowStack ? { cols: 6, max: QA_MAX } : { cols: 3, max: QA_MAX };
    // Favorite slot matches whatever shape this bar would have if simply docked at that width in Bottom Layout.
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

// Every tool that can be pinned — Tools tab tiles cloned rather than duplicated by hand, so Quick Actions can never drift out of sync.
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

// A couple of catalog icons use an internal SVG <mask id="..."> referenced via url(#id); cloneNode duplicates the id verbatim, so both ends get renamed per clone.
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

// Total slots (real + placeholder) to show — reveals one row at a time rather than the whole grid's worth of empty "+" tiles up front.
function _qaAddTileTarget(pinnedCount, shape) {
    if (pinnedCount >= shape.max) return shape.max;
    if (pinnedCount % shape.cols === 0) return Math.min(shape.max, pinnedCount + shape.cols);
    return Math.min(shape.max, Math.ceil(pinnedCount / shape.cols) * shape.cols);
}

// Adds/removes add-tile placeholders (never touches real tiles) so the grid always shows exactly _qaAddTileTarget's count.
function _qaSyncAddTiles(instKey, grid) {
    var shape = _qaGridShape(instKey);
    // Only quickactions2's 1x6 (single-row) shape reads as one connected bar; 'main' stays individually bordered squares at any column count.
    grid.classList.toggle('qa-grid-1x6', shape.cols === 6 && instKey !== 'main');
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

// Only rebuilds real tiles when the pinned SET actually changed (first render); replaying pop-in on every edit-mode toggle made it feel jumpy, so real tiles are left alone otherwise.
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

    // Reveals add-tile placeholders one row at a time; also clears them all out when leaving edit mode.
    _qaSyncAddTiles(instKey, grid);
}

// Renders every registered bar — called whenever edit mode toggles, since both bars' dashed/+ state depends on it.
function _renderAllQuickActions() {
    Object.keys(QA_INSTANCES).forEach(function(instKey) { _renderQuickActions(instKey); });
}

// The single entry point for the whole board's edit mode — both Quick Actions bars and Bottom Layout's drag-reorder switch on together, one pencil.
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
        _toolbarCloseAddPopover();
        _closeToolbarCtx();
        _blStopGlow();
    }
    _renderAllQuickActions();
    _blRenderAddRow();
    if (document.body.classList.contains('layout-toolbar')) _toolbarRender();
    // Board-editing changes borders/padding, but medium-tier row heights are pinned pixel values that don't re-measure on a class toggle — re-synced here.
    _syncAnchorTiers();
}

// Soft cursor-follow spotlight across every editable widget, via shared eased cursor position written to --glow-x/y; element rects cached and refreshed only every 400ms for perf.
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
    // 0.12 is the "slight delay" — how far the eased position catches up to the raw cursor each frame, same lerp pattern as the drag ghost's 3D tilt.
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
// Every edit already saves live to localStorage, so Save is just "exit"; Cancel/Restore swap localStorage wholesale from a snapshot/defaults and re-render.
var EDIT_SNAPSHOT_KEYS = ['lineup-quick-actions', 'lineup-quick-actions-2', 'lineup-bottom-layout', 'lineup-favorite-widgets', 'lineup-toolbar-buttons'];
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
// Every mutating action funnels through _qaSavePinned/_blSaveRows/_favSave, which record the pre-mutation snapshot there — no bookkeeping per drag/click needed.
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

// _favApplyLayout already calls _blApplyLayout at its end; Toolbar Mode is mutually exclusive with Compact, so it's a separate branch rather than a 4th always-run call.
function _refreshAllEditableWidgets() {
    _renderAllQuickActions();
    _favApplyLayout();
    if (document.body.classList.contains('layout-toolbar')) _toolbarRender();
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

// Resets all three widget systems to their defaults, then exits edit mode — a full "start over", not just another edit to keep tweaking.
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

// Clicking outside every editable widget/popover exits edit mode; the pencil button and edit bar are excluded too, else mousedown-before-click would double-toggle.
function _editModeOutside(e) {
    var editBtn = document.getElementById('quickActionsEditBtn');
    if (editBtn && editBtn.contains(e.target)) return;
    var editBar = document.getElementById('editModeBar');
    if (editBar && editBar.contains(e.target)) return;
    if (_qaPopover && _qaPopover.contains(e.target)) return;
    if (_blPopover && _blPopover.contains(e.target)) return;
    if (_toolbarPopover && _toolbarPopover.contains(e.target)) return;
    if (_toolbarCtx && _toolbarCtx.contains(e.target)) return;
    var mainQaBox = document.getElementById('sec-quick-actions');
    if (mainQaBox && mainQaBox.contains(e.target)) return;
    var favBox = document.getElementById('sec-favorite');
    if (favBox && favBox.contains(e.target)) return;
    // Toolbar Mode only exempts an actual tile or add-tile (.toolbar-remove nests inside .toolbar-btn); empty grid space etc. falls through and exits.
    if (e.target.closest && e.target.closest('.toolbar-btn, .toolbar-add-tile')) return;
    // Covers the second Quick Actions bar too when pinned — it's just another Bottom Layout box as far as this check is concerned.
    var insideBlBox = _blPinnedIds().some(function(id) {
        var el = _blBoxEl(id);
        return el && el.contains(e.target);
    });
    if (insideBlBox) return;
    if (_blAddRowEl && _blAddRowEl.contains(e.target)) return;
    _toggleEditMode();
}

// Patches the grid in place rather than calling _renderQuickActions, so only the removed tile's slot changes and the rest don't replay their entrance animation.
function _qaRemove(instKey, id) {
    _qaSavePinned(instKey, _qaGetPinned(instKey).filter(function(x) { return x !== id; }));

    var grid = document.getElementById(QA_INSTANCES[instKey].gridId);
    if (!grid) return;
    var tile = grid.querySelector('.quick-actions-btn[data-tool-id="' + id + '"]');
    if (tile) grid.removeChild(tile);
    // Placeholder count may need to shrink back a whole row, not just lose one slot — _qaSyncAddTiles handles that either way.
    _qaSyncAddTiles(instKey, grid);
}

// Patches the grid in place — only the newly-pinned tile bounces in (.qa-anim-bounce-in); the rest of the grid doesn't reload/rescale.
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
    // Filling the last row slot can reveal a whole new row of placeholders — _qaSyncAddTiles handles that either way.
    _qaSyncAddTiles(instKey, grid);
}

// ── Add-tool popover — mini Tools-tab: search input + grid of not-yet-pinned tools. Bottom Layout's own popover reuses the same .qa-add-* classes but separate DOM/state.

function _qaBuildPopover() {
    var el = document.createElement('div');
    el.className = 'qa-add-popover';

    var searchRow = document.createElement('div');
    searchRow.className = 'qa-add-search-row';
    // A plain span with an innerHTML svg STRING, not document.createElement('svg') — that would create it in the wrong (HTML) namespace, so nothing renders.
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

// ── TOOLBAR MODE ─────────────────────────────────────────────────────────────
// User-assembled grid of fixed-size buttons; same catalog/clone approach as Quick Actions, but its own uncapped membership list and auto-paginating layout.
var TOOLBAR_KEY = 'lineup-toolbar-buttons';
var TOOLBAR_TILE_SIZE = 45; // px (64 * 0.7, ~30% smaller) — must match .toolbar-page's minmax()/grid-auto-rows in style.css
var TOOLBAR_TILE_GAP  = 6;  // px (8 * 0.7) — must match .toolbar-page's own gap in style.css
var _toolbarActiveIndex = 0;
var _toolbarLastPerPage = null; // cached page capacity — lets a resize tick skip a rebuild when it hasn't actually changed

function _toolbarGetIds() {
    var ids;
    try { ids = JSON.parse(localStorage.getItem(TOOLBAR_KEY)); } catch(e) {}
    if (!Array.isArray(ids)) ids = [];
    var validIds = _qaCatalog().map(function(t) { return t.getAttribute('data-tool-id'); });
    return ids.filter(function(id) { return validIds.indexOf(id) !== -1; }); // drop stale ids only — no cap, ever
}

function _toolbarSaveIds(ids) {
    _editRecordUndoPoint();
    try { localStorage.setItem(TOOLBAR_KEY, JSON.stringify(ids)); } catch(e) {}
}

// Set right before a rebuild that should animate in only ONE tile — otherwise every tile would replay its entrance animation on every add/remove/resize.
var _toolbarRenderAnimHint = null;

function _toolbarAdd(id) {
    var ids = _toolbarGetIds();
    if (ids.indexOf(id) === -1) ids.push(id);
    _toolbarSaveIds(ids);
    _toolbarCloseAddPopover();
    _toolbarRenderAnimHint = { id: id, cls: 'toolbar-anim-bounce-in' };
    _toolbarRender();
}

function _toolbarRemove(id) {
    _toolbarSaveIds(_toolbarGetIds().filter(function(x) { return x !== id; }));
    _toolbarRender();
}

// One Toolbar tile — mirrors _qaBuildTile exactly, including reuse of _qaCloneCatalogTile for the SVG mask-id clone-collision fix.
function _toolbarBuildTile(id) {
    var source = _qaCatalog().filter(function(t) { return t.getAttribute('data-tool-id') === id; })[0];
    if (!source) return null;
    var tile = _qaCloneCatalogTile(source);
    tile.classList.remove('tools-grid-btn');
    tile.classList.add('toolbar-btn');
    tile.removeAttribute('data-group');
    var lbl = tile.querySelector('span');
    if (lbl) lbl.remove();

    var removeBtn = document.createElement('span');
    removeBtn.className = 'toolbar-remove';
    removeBtn.title = 'Remove from Toolbar';
    removeBtn.innerHTML = '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="7" cy="7" r="6.3" fill="#1c1c1c" stroke="#3a3a3a" stroke-width="1"/><line x1="4.8" y1="4.8" x2="9.2" y2="9.2"/><line x1="9.2" y1="4.8" x2="4.8" y2="9.2"/></svg>';
    removeBtn.onclick = function(e) {
        e.stopPropagation();
        e.preventDefault();
        _toolbarRemove(id);
    };
    tile.appendChild(removeBtn);

    // Drag-to-reorder only while editing, and not when mousedown started on the remove badge (needs its own click to fire normally).
    tile.addEventListener('mousedown', function(e) {
        if (e.button !== 0 || !_editMode) return;
        if (e.target.closest('.toolbar-remove')) return;
        _toolbarDragStart(e, id, tile);
    });

    return tile;
}

function _toolbarCreateAddTile() {
    var addTile = document.createElement('button');
    addTile.type = 'button';
    addTile.className = 'toolbar-add-tile';
    addTile.title = 'Add a Toolbar Button';
    addTile.innerHTML = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><line x1="10" y1="4" x2="10" y2="16"/><line x1="4" y1="10" x2="16" y2="10"/></svg>';
    addTile.onclick = function(e) { _toolbarOpenAddPopover(e); };
    return addTile;
}

// ── Drag-to-reorder — grid is one flat left-to-right/top-to-bottom sequence, not 2D: drop ON a tile swaps, drop near an edge inserts before/after. Current page only.
var _toolbarDrag = null;
var _toolbarDragIndicatorEl = null;

function _toolbarDragStart(e, id, tileEl) {
    e.preventDefault();
    var page = tileEl.closest('.toolbar-page');
    if (!page) return;

    var rect = tileEl.getBoundingClientRect();
    var ghost = tileEl.cloneNode(true);
    ghost.classList.add('toolbar-drag-ghost');
    ghost.style.position = 'fixed';
    ghost.style.left = rect.left + 'px';
    ghost.style.top = rect.top + 'px';
    ghost.style.width = rect.width + 'px';
    ghost.style.height = rect.height + 'px';
    document.body.appendChild(ghost);

    tileEl.classList.add('toolbar-drag-source');

    _toolbarDrag = {
        id: id,
        tileEl: tileEl,
        page: page,
        ghost: ghost,
        offsetX: e.clientX - rect.left,
        offsetY: e.clientY - rect.top,
        pending: null
    };

    document.body.classList.add('toolbar-dragging-active');
    document.addEventListener('mousemove', _toolbarDragMove);
    document.addEventListener('mouseup', _toolbarDragEnd);
}

// Center ~50% of a hovered tile means "swap"; outer ~25% either side means "insert before/after" — deliberately X-only, per the section comment above.
function _toolbarDragMove(e) {
    var drag = _toolbarDrag;
    if (!drag) return;
    drag.ghost.style.left = (e.clientX - drag.offsetX) + 'px';
    drag.ghost.style.top  = (e.clientY - drag.offsetY) + 'px';

    var tiles = Array.prototype.filter.call(
        drag.page.querySelectorAll('.toolbar-btn'),
        function(t) { return t !== drag.tileEl; }
    );

    var target = null, targetRect = null;
    for (var i = 0; i < tiles.length; i++) {
        var r = tiles[i].getBoundingClientRect();
        if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
            target = tiles[i];
            targetRect = r;
            break;
        }
    }

    _toolbarClearDropHighlight();

    if (!target) {
        drag.pending = null;
        return;
    }

    var targetId = target.getAttribute('data-tool-id');
    var relX = (e.clientX - targetRect.left) / targetRect.width;

    if (relX < 0.25) {
        drag.pending = { type: 'insert-before', targetId: targetId };
        _toolbarShowDragIndicator(targetRect, 'left');
    } else if (relX > 0.75) {
        drag.pending = { type: 'insert-after', targetId: targetId };
        _toolbarShowDragIndicator(targetRect, 'right');
    } else {
        drag.pending = { type: 'swap', targetId: targetId };
        target.classList.add('toolbar-drop-target-swap');
    }
}

// Positioned at the exact MIDPOINT of the gap next to targetRect (not a fixed offset), so hovering A's right 25% and B's left 25% land on the identical pixel.
function _toolbarShowDragIndicator(targetRect, side) {
    if (!_toolbarDragIndicatorEl) {
        _toolbarDragIndicatorEl = document.createElement('div');
        _toolbarDragIndicatorEl.className = 'toolbar-drag-indicator';
        document.body.appendChild(_toolbarDragIndicatorEl);
    }
    var el = _toolbarDragIndicatorEl;
    var indicatorWidth = 4;
    var midpoint = side === 'left'
        ? targetRect.left - TOOLBAR_TILE_GAP / 2
        : targetRect.right + TOOLBAR_TILE_GAP / 2;
    el.style.top = targetRect.top + 'px';
    el.style.height = targetRect.height + 'px';
    el.style.left = (midpoint - indicatorWidth / 2) + 'px';
    el.classList.add('visible');
}

function _toolbarClearDropHighlight() {
    Array.prototype.forEach.call(document.querySelectorAll('.toolbar-drop-target-swap'), function(el) {
        el.classList.remove('toolbar-drop-target-swap');
    });
    if (_toolbarDragIndicatorEl) _toolbarDragIndicatorEl.classList.remove('visible');
}

function _toolbarDragEnd() {
    var drag = _toolbarDrag;
    if (!drag) return;
    document.removeEventListener('mousemove', _toolbarDragMove);
    document.removeEventListener('mouseup', _toolbarDragEnd);
    document.body.classList.remove('toolbar-dragging-active');

    drag.ghost.remove();
    drag.tileEl.classList.remove('toolbar-drag-source');
    _toolbarClearDropHighlight();

    if (drag.pending) {
        var ids = _toolbarGetIds();
        var fromIdx = ids.indexOf(drag.id);
        var targetIdx = ids.indexOf(drag.pending.targetId);
        if (fromIdx !== -1 && targetIdx !== -1 && fromIdx !== targetIdx) {
            if (drag.pending.type === 'swap') {
                var tmp = ids[fromIdx];
                ids[fromIdx] = ids[targetIdx];
                ids[targetIdx] = tmp;
            } else {
                ids.splice(fromIdx, 1);
                var newTargetIdx = ids.indexOf(drag.pending.targetId);
                var insertAt = drag.pending.type === 'insert-before' ? newTargetIdx : newTargetIdx + 1;
                ids.splice(insertAt, 0, drag.id);
            }
            _toolbarSaveIds(ids);
            _toolbarRenderAnimHint = { id: drag.id, cls: 'toolbar-anim-drop-land' };
        }
    }

    _toolbarDrag = null;
    _toolbarRender();
}

// Tiles keep normal pointer-events while editing (unlike Quick Actions' tiles) since drag-to-reorder needs real mouse events; the click action is suppressed via this capture-phase listener instead.
function _initToolbarDragSuppression() {
    var container = document.getElementById('homeToolbar');
    if (!container) return;
    container.addEventListener('click', function(e) {
        if (!_editMode) return;
        if (e.target.closest('.toolbar-remove') || e.target.closest('.toolbar-add-tile')) return;
        if (e.target.closest('.toolbar-btn')) {
            e.stopPropagation();
            e.preventDefault();
        }
    }, true);
}

// How many tiles fit one axis — rounds up one MORE than fully fits when half a tile's space remains, deliberately overflowing (clipped by overflow:hidden) rather than leaving a dead gap.
function _toolbarCountAxis(available) {
    var full = Math.floor((available + TOOLBAR_TILE_GAP) / (TOOLBAR_TILE_SIZE + TOOLBAR_TILE_GAP));
    var usedFull = full * TOOLBAR_TILE_SIZE + Math.max(0, full - 1) * TOOLBAR_TILE_GAP;
    var remaining = available - usedFull;
    if (remaining >= TOOLBAR_TILE_GAP + TOOLBAR_TILE_SIZE / 2) full += 1;
    return Math.max(1, full);
}

// cols is also what _toolbarRender uses for grid-template-columns inline — CSS auto-fill can't express "one more column, allowed to overflow".
function _toolbarComputeGrid() {
    var pages = document.getElementById('toolbarPages');
    if (!pages) return { cols: 1, rows: 1 };
    return {
        cols: _toolbarCountAxis(pages.clientWidth),
        rows: _toolbarCountAxis(pages.clientHeight)
    };
}

function _toolbarPageCapacity() {
    var grid = _toolbarComputeGrid();
    return grid.cols * grid.rows;
}

// Full rebuild rather than an in-place patch (unlike _qaAdd/_qaRemove) — inserting/removing one id can shift every later id onto a different page.
function _toolbarRender() {
    var container = document.getElementById('homeToolbar');
    var track = document.getElementById('toolbarPagesTrack');
    if (!container || !track) return;

    var ids = _toolbarGetIds();
    var isEmpty = ids.length === 0;
    container.classList.toggle('toolbar-empty', isEmpty && !_editMode);
    if (isEmpty && !_editMode) {
        track.innerHTML = '';
        _toolbarRenderDots(0);
        return;
    }

    var grid = _toolbarComputeGrid();
    var perPage = Math.max(1, grid.cols * grid.rows);
    _toolbarLastPerPage = perPage;
    // +1 while editing reserves a trailing add-tile, which auto-paginates onto its own page once the last real page is full.
    var pageCount = Math.max(1, Math.ceil((ids.length + (_editMode ? 1 : 0)) / perPage));

    track.innerHTML = '';
    for (var p = 0; p < pageCount; p++) {
        var page = document.createElement('div');
        page.className = 'toolbar-page';
        // Explicit column count (not CSS auto-fill) — see _toolbarCountAxis for why this must be computed in JS.
        page.style.gridTemplateColumns = 'repeat(' + grid.cols + ', ' + TOOLBAR_TILE_SIZE + 'px)';
        var startIdx = p * perPage;
        var pageIds = ids.slice(startIdx, startIdx + perPage);
        pageIds.forEach(function(id) {
            var tile = _toolbarBuildTile(id);
            if (!tile) return;
            if (_toolbarRenderAnimHint && _toolbarRenderAnimHint.id === id) {
                tile.classList.add(_toolbarRenderAnimHint.cls);
            }
            page.appendChild(tile);
        });
        if (_editMode && startIdx + pageIds.length === ids.length) page.appendChild(_toolbarCreateAddTile());
        track.appendChild(page);
    }
    _toolbarRenderAnimHint = null;

    _toolbarActiveIndex = Math.max(0, Math.min(_toolbarActiveIndex, pageCount - 1));
    _toolbarRenderDots(pageCount);
    _toolbarUpdateTrackPosition();
}

function _toolbarRepaginate() {
    if (!document.body.classList.contains('layout-toolbar')) return;
    if (Math.max(1, _toolbarPageCapacity()) === _toolbarLastPerPage) return; // capacity unchanged, skip the rebuild
    _toolbarRender();
}

function _initToolbarResize() {
    var pages = document.getElementById('toolbarPages');
    if (!pages || typeof ResizeObserver === 'undefined') return;
    new ResizeObserver(function() { _toolbarRepaginate(); }).observe(pages);
}

// Dots carousel — same mechanics as the Favorites slot's _favRenderDots/etc, but page count is dynamic (recomputed from button count and live size).
function _toolbarRenderDots(count) {
    var dots = document.getElementById('toolbarDots');
    if (!dots) return;
    dots.innerHTML = '';
    dots.classList.toggle('toolbar-dots-hidden', count <= 1);
    for (var i = 0; i < count; i++) {
        var dot = document.createElement('button');
        dot.type = 'button';
        dot.className = 'toolbar-dot' + (i === _toolbarActiveIndex ? ' active' : '');
        dot.title = 'Page ' + (i + 1);
        (function(idx) {
            dot.addEventListener('click', function() { _toolbarGoToPage(idx); });
        })(i);
        dots.appendChild(dot);
    }
}

function _toolbarUpdateTrackPosition() {
    var track = document.getElementById('toolbarPagesTrack');
    if (track) track.style.transform = 'translateX(-' + (_toolbarActiveIndex * 100) + '%)';
}

function _toolbarGoToPage(index) {
    var track = document.getElementById('toolbarPagesTrack');
    var count = track ? track.children.length : 0;
    if (!count) return;
    _toolbarActiveIndex = Math.max(0, Math.min(index, count - 1));
    _toolbarUpdateTrackPosition();
    var dots = document.getElementById('toolbarDots');
    if (dots) {
        Array.prototype.forEach.call(dots.children, function(dot, i) {
            dot.classList.toggle('active', i === _toolbarActiveIndex);
        });
    }
}

function _toolbarEmptyHintClick(e) {
    if (!_editMode) _toggleEditMode();
    _toolbarOpenAddPopover(e);
}

// ── Add-button popover — mini Tools-tab, reuses the same .qa-add-* CSS classes as Quick Actions/Bottom Layout's popovers but keeps separate DOM/state.
var _toolbarPopover      = null;
var _toolbarPopoverInput = null;
var _toolbarPopoverGrid  = null;

function _toolbarBuildPopover() {
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
    input.addEventListener('input', _toolbarFilterPopover);
    searchRow.appendChild(icon);
    searchRow.appendChild(input);
    el.appendChild(searchRow);

    var grid = document.createElement('div');
    grid.className = 'qa-add-grid';
    el.appendChild(grid);

    document.body.appendChild(el);
    _toolbarPopoverInput = input;
    _toolbarPopoverGrid  = grid;
    return el;
}

function _toolbarFilterPopover() {
    var q = _toolbarPopoverInput.value.trim().toLowerCase();
    var tiles = _toolbarPopoverGrid.querySelectorAll('.qa-add-tile');
    for (var i = 0; i < tiles.length; i++) {
        var title = (tiles[i].getAttribute('title') || '').toLowerCase();
        tiles[i].classList.toggle('qa-add-tile-hidden', q.length > 0 && title.indexOf(q) === -1);
    }
}

function _toolbarOpenAddPopover(e) {
    if (!_toolbarPopover) _toolbarPopover = _toolbarBuildPopover();

    var added = _toolbarGetIds();
    _toolbarPopoverGrid.innerHTML = '';
    _qaCatalog().forEach(function(source) {
        var id = source.getAttribute('data-tool-id');
        if (added.indexOf(id) !== -1) return;
        var tile = _qaCloneCatalogTile(source);
        tile.classList.remove('tools-grid-btn');
        tile.classList.add('qa-add-tile');
        tile.removeAttribute('data-group');
        tile.onclick = function() { _toolbarAdd(id); };
        _toolbarPopoverGrid.appendChild(tile);
    });
    if (_toolbarPopoverInput) _toolbarPopoverInput.value = '';

    // Anchored to the click itself (e.clientX/Y), not below the triggering element, since Toolbar Mode's small panel makes "below, flip up" inconsistent.
    var vw = window.innerWidth, vh = window.innerHeight;
    var pw = 220, ph = 230;
    _toolbarPopover.style.left = Math.max(4, Math.min(e.clientX, vw - pw - 4)) + 'px';
    _toolbarPopover.style.top  = Math.max(4, Math.min(e.clientY, vh - ph - 4)) + 'px';
    _toolbarPopover.classList.add('visible');
    if (_toolbarPopoverInput) _toolbarPopoverInput.focus();

    setTimeout(function() {
        document.addEventListener('mousedown', _toolbarPopoverOutside);
        document.addEventListener('keydown', _toolbarPopoverKey);
    }, 0);
}

function _toolbarCloseAddPopover() {
    if (_toolbarPopover) _toolbarPopover.classList.remove('visible');
    document.removeEventListener('mousedown', _toolbarPopoverOutside);
    document.removeEventListener('keydown', _toolbarPopoverKey);
}

function _toolbarPopoverOutside(e) {
    if (_toolbarPopover && !_toolbarPopover.contains(e.target) &&
        !e.target.closest('.toolbar-add-tile, #toolbarEmptyHint')) {
        _toolbarCloseAddPopover();
    }
}

function _toolbarPopoverKey(e) {
    if (e.key === 'Escape') _toolbarCloseAddPopover();
}

// ── Right-click context menu — Toolbar Mode has no footer, so right-click anywhere on the grid is the only way to reach Settings/edit; reuses the .fav-ctx/.shape-sel-ctx-* flyout shell.
var _toolbarCtx = null;

function _buildToolbarCtx() {
    var el = document.createElement('div');
    el.className = 'fav-ctx shape-sel-ctx';
    var row = document.createElement('div');
    row.className = 'shape-sel-ctx-row';

    // Toggles either direction — Toolbar Mode has no header bar to Save/exit from, so this item is the only way both in and back out.
    var editItem = document.createElement('button');
    editItem.type = 'button';
    editItem.className = 'shape-sel-ctx-icon-btn';
    editItem.setAttribute('data-toolbar-ctx-edit', '1');
    editItem.addEventListener('click', function() {
        _closeToolbarCtx();
        _toggleEditMode();
    });

    var settingsItem = document.createElement('button');
    settingsItem.type = 'button';
    settingsItem.className = 'shape-sel-ctx-icon-btn';
    settingsItem.title = 'Open Settings';
    settingsItem.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="2.2"/><path d="M8,1.5 L8.65,2.9 A4.9,4.9 0 0,1 9.9,3.55 L11.3,2.8 L12.5,4 L11.75,5.4 A4.9,4.9 0 0,1 12.4,6.65 L13.8,7.3 L13.8,8.7 L12.4,9.35 A4.9,4.9 0 0,1 11.75,10.6 L12.5,12 L11.3,13.2 L9.9,12.45 A4.9,4.9 0 0,1 8.65,13.1 L8,14.5 L7.35,13.1 A4.9,4.9 0 0,1 6.1,12.45 L4.7,13.2 L3.5,12 L4.25,10.6 A4.9,4.9 0 0,1 3.6,9.35 L2.2,8.7 L2.2,7.3 L3.6,6.65 A4.9,4.9 0 0,1 4.25,5.4 L3.5,4 L4.7,2.8 L6.1,3.55 A4.9,4.9 0 0,1 7.35,2.9 Z"/></svg><span class="shape-sel-ctx-lbl">Settings</span>';
    settingsItem.addEventListener('click', function() {
        _closeToolbarCtx();
        openSettingsPopup();
    });

    row.appendChild(editItem);
    row.appendChild(settingsItem);
    el.appendChild(row);
    document.body.appendChild(el);
    return el;
}

// Positioned so its top-left lands at the click (standard context-menu placement, unlike the centered mode-flyouts above), clamped within #homeToolbar.
function _openToolbarCtx(e) {
    if (!_toolbarCtx) _toolbarCtx = _buildToolbarCtx();
    var container = document.getElementById('homeToolbar') || document.body;
    container.appendChild(_toolbarCtx);

    var editItem = _toolbarCtx.querySelector('[data-toolbar-ctx-edit]');
    if (editItem) {
        if (_editMode) {
            editItem.title = 'Done editing';
            editItem.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="3,8.5 6.5,12 13,4"/></svg><span class="shape-sel-ctx-lbl">Done Editing</span>';
        } else {
            editItem.title = 'Add or remove Toolbar buttons';
            editItem.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M11,2.5 L13.5,5 L5,13.5 L2,14 L2.5,11 Z"/><line x1="9.3" y1="4.2" x2="11.8" y2="6.7"/></svg><span class="shape-sel-ctx-lbl">Edit Toolbar</span>';
        }
    }

    var cw = container.clientWidth, ch = container.clientHeight;
    var containerRect = container.getBoundingClientRect();
    var cx = e.clientX - containerRect.left;
    var cy = e.clientY - containerRect.top;
    var ctxW = _toolbarCtx.offsetWidth, ctxH = _toolbarCtx.offsetHeight;
    var left = Math.min(Math.max(4, cx), cw - ctxW - 4);
    var top  = Math.min(Math.max(4, cy), ch - ctxH - 4);
    _toolbarCtx.style.left = left + 'px';
    _toolbarCtx.style.top  = top + 'px';
    _toolbarCtx.classList.add('visible');

    setTimeout(function() {
        document.addEventListener('mousedown', _toolbarCtxOutside);
        document.addEventListener('keydown', _toolbarCtxKey);
    }, 0);
}

function _closeToolbarCtx() {
    if (_toolbarCtx) _toolbarCtx.classList.remove('visible');
    document.removeEventListener('mousedown', _toolbarCtxOutside);
    document.removeEventListener('keydown', _toolbarCtxKey);
}

function _toolbarCtxOutside(e) {
    if (_toolbarCtx && !_toolbarCtx.contains(e.target)) _closeToolbarCtx();
}

function _toolbarCtxKey(e) {
    if (e.key === 'Escape') _closeToolbarCtx();
}

// ── BOTTOM LAYOUT (Align / Distribute / Sizing / Auto Crop / Sort) ─────────────
// A second customization scope, separate data but sharing the one _editMode/pencil. Layout is an ordered list of rows (1 id = full-line, 2 ids = half+half pair);
// width is entirely derived from which kind of row a box is in (_blPack), so dragging out of a pair auto-reverts the ex-partner to full-line, and vice versa for docking.

var BL_STORAGE_KEY = 'lineup-bottom-layout';
// Everything that CAN live in the bottom bento grid; pinned/order is stored separately (_blGetRows). label/icon here only build the add-widget popover.
var BL_CATALOG = [
    { id: 'alignlayers',   label: 'Align' },
    { id: 'distribute',    label: 'Distribute' },
    { id: 'sizing',        label: 'Sizing' },
    { id: 'autocrop',      label: 'Auto Crop' },
    { id: 'sort',          label: 'Layer Sort' },
    { id: 'quickactions2', label: 'Quick Actions (2nd Bar)' },
    { id: 'spellcheck',    label: 'Spell Check' },
    { id: 'ease',          label: 'Ease Copy' },
    { id: 'markers',       label: 'Marker Controls' },
    { id: 'vectortools',   label: 'Shape Tools' }
];
var BL_CATALOG_IDS = BL_CATALOG.map(function(c) { return c.id; });
// Shape Tools and Sort Layers both start unpinned — added via the "+" popover rather than forced into everyone's default layout.
var BL_DEFAULT_ROWS = [ ['alignlayers'], ['distribute'], ['sizing', 'autocrop'] ];

var _blDrag = null; // non-null while a drag is in progress

function _blBoxEl(id) {
    return document.querySelector('#homeGrid .tool-box[data-block-id="' + id + '"]');
}

// A row is 1-2 ids, each valid and appearing at most once — anything else is rejected wholesale, falling back to the default arrangement.
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

// Flat, ordered list of every id currently pinned — the dynamic equivalent of the old fixed BL_IDS constant.
function _blPinnedIds() {
    var ids = [];
    _blGetRows().forEach(function(row) { row.forEach(function(id) { ids.push(id); }); });
    return ids;
}

// Catalog entries not pinned, also excluding whatever's favorited — a widget can only live in one place, and favoriting already pulled it out of Bottom Layout.
function _blAvailableIds() {
    var pinned = _blPinnedIds();
    var favorited = _favGet();
    return BL_CATALOG_IDS.filter(function(id) { return pinned.indexOf(id) === -1 && favorited.indexOf(id) === -1; });
}

// A row with 2 ids renders as span 3+3; a row with 1 id renders as span 6 — no stored "preference" to fall out of sync with this.
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

// Sets each pinned box's data-span and moves it to the end of #homeGrid in row order — .tool-col's sparse auto-flow means DOM order determines position.
// Unpinned catalog entries get .bl-unpinned (display:none) but stay in the DOM, so their icon can still be cloned for the add popover.
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
    // quickactions2's placeholder count depends on its column count, which just changed along with its span above.
    var qa2Grid = document.getElementById(QA_INSTANCES.quickactions2.gridId);
    if (qa2Grid) _qaSyncAddTiles('quickactions2', qa2Grid);
    // Align/Distribute's available width can change here without #homeToolGrid resizing, so _syncAnchorTiers' resize-driven call wouldn't otherwise re-fire this.
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

// FLIP: snap each box back via an inverse transform, then transition it away to ''. Writes batched across every box (one forced reflow, not one per box) — same pattern as initSettingsDrag.
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

// Rows with `id` removed — a row losing its only id disappears; a pair row losing one id becomes a single, no separate "un-dock" step needed.
function _blRemoveFromRows(rows, id) {
    var out = [];
    rows.forEach(function(row) {
        var filtered = row.filter(function(x) { return x !== id; });
        if (filtered.length) out.push(filtered);
    });
    return out;
}

// Real hit-testing (elementFromPoint), not nearest-by-distance, which could waver right at a shared border; the dragged box is pointer-events:none so this sees through it.
function _blTargetFromPoint(x, y) {
    var el = document.elementFromPoint(x, y);
    while (el && el !== document.body) {
        if (el.classList && el.classList.contains('bl-draggable')) return el;
        el = el.parentElement;
    }
    return null;
}

// No dead zone: top/bottom ~25% inserts a row above/below; the middle is swap (if already paired) or dock-left/dock-right (if room to pair). Narrow-stack drops dock/swap entirely — plain before/after 50/50 split.
// Cumulative offsetLeft/Top up through `el`'s offsetParent chain to `ancestor` — a zoom-independent alternative to getBoundingClientRect, same idea as _blOffsetRect.
function _blOffsetFromAncestor(el, ancestor) {
    var x = 0, y = 0;
    while (el && el !== ancestor) {
        x += el.offsetLeft;
        y += el.offsetTop;
        el = el.offsetParent;
    }
    return { x: x, y: y };
}

// cursorX/cursorY are relative to targetBox's own top-left, NOT clientX/Y vs. getBoundingClientRect() — the latter quietly broke under panel zoom (Scale slider default 1.05x).
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
        // posInRow/rowSize travel with the candidate so downstream code can tell if the target is mid-pair, since a pair renders as two stacked full-width rows here.
        return { targetId: targetId, rowIdx: rowIdx, logicalRowIdx: rowIdx, posInRow: posInRow, rowSize: rowSize,
                 mode: cursorY < h / 2 ? 'before' : 'after' };
    }

    var topBand = h * 0.25;
    var bottomBand = h * 0.75;

    if (cursorY < topBand) return { targetId: targetId, rowIdx: rowIdx, mode: 'before' };
    if (cursorY > bottomBand) return { targetId: targetId, rowIdx: rowIdx, mode: 'after' };

    // Already half-width — no room to dock a third widget, so the whole remaining middle band is one "swap" zone regardless of left/right cursor position.
    if (!canDock) {
        return { targetId: targetId, rowIdx: rowIdx, mode: 'swap' };
    }

    return { targetId: targetId, rowIdx: rowIdx, mode: cursorX < w / 2 ? 'dock-left' : 'dock-right' };
}

// originalRows is the pre-pickup arrangement, only needed for 'swap' (which needs the dragged widget's own slot intact); every other mode builds off `baseline` instead.
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

    // Narrow-stack: landing at the outer edge of a logical row keeps the pair intact; landing on the pair's INNER edge splits it into two rows with the dragged widget between.
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
// Lives inside #homeGrid itself (not <body>) so it renders under the same CSS zoom as the widgets it tracks, sidestepping CEF's zoom/gBCR inconsistency.
function _blIndicator() {
    if (!_blIndicatorEl) {
        _blIndicatorEl = document.createElement('div');
        _blIndicatorEl.className = 'bl-drop-indicator';
        document.getElementById('homeGrid').appendChild(_blIndicatorEl);
    }
    return _blIndicatorEl;
}

// offsetLeft/Top/Width/Height (not getBoundingClientRect) since #homeGrid's subtree can be under CSS zoom that CEF resolves inconsistently for gBCR; offset* never touches that.
function _blOffsetRect(el) {
    if (!el) return null;
    var left = el.offsetLeft, top = el.offsetTop, width = el.offsetWidth, height = el.offsetHeight;
    return { left: left, top: top, width: width, height: height, right: left + width, bottom: top + height };
}

// The rect of whichever row sits at baseline[rowIdx]. In narrow-stack a pair renders as two stacked rows, so edge picks 'last'/'first' depending on which side is adjacent.
function _blRowRect(baseline, rowIdx, edge) {
    if (rowIdx < 0 || rowIdx >= baseline.length) return null;
    var row = baseline[rowIdx];
    var id = (_narrowStack && edge === 'last') ? row[row.length - 1] : row[0];
    return _blOffsetRect(_blBoxEl(id));
}

// Pure visual feedback, zero layout effect. swap: dashed box over the whole target. dock-left/right: dashed box over the half the dragged box would occupy. before/after: a full-width dashed line at the true midpoint of the gap between rows.
function _blShowIndicator(targetBox, candidate, baseline) {
    var mode = candidate.mode;
    var el = _blIndicator();
    // offsetLeft/Top/Width/Height, not getBoundingClientRect — see _blOffsetRect.
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
            // The true neighbor is whichever specific widget sits next to the target — for a mid-pair widget, that's its own pair-mate, not "the next logical row".
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

// Strips id attributes from the ghost (a deep clone of the real box), since cloneNode duplicates every id verbatim, leaving duplicates in the DOM.
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

    // The real box stays put, dimmed/inert, for the whole drag — a floating clone follows the cursor instead, so nothing reflows until the actual drop.
    box.classList.add('bl-dragging-source');

    var ghost = box.cloneNode(true);
    _blStripIds(ghost);
    ghost.classList.remove('bl-dragging-source');
    ghost.classList.add('bl-drag-ghost');
    ghost.style.width  = rect.width + 'px';
    ghost.style.height = rect.height + 'px';
    // Narrow-stack: every widget is full width, so the ghost is locked to its own left edge instead of centering under the cursor — drag only moves it up/down.
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
        // Precomputed once — avoids re-stringifying this never-changing array on every mousemove.
        originalRowsJSON: JSON.stringify(originalRows),
        baseline: _blRemoveFromRows(originalRows, id),
        // The Favorite slot doesn't move mid-drag, so its rect is measured once here rather than via gBCR on every mousemove.
        favBox: favBoxAtStart,
        favRect: favBoxAtStart ? favBoxAtStart.getBoundingClientRect() : null,
        candidate: null, // {targetId, rowIdx, mode} | null
        // 3D tilt state: velocity decays every frame (not just eased rotation), so the tilt self-flattens when the cursor stops without a separate "idle" case.
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

// Runs every frame independent of mousemove, so the tilt decays back to flat once the cursor stops rather than freezing at its last angle.
function _blTiltTick() {
    if (!_blDrag) return;
    // Velocity decay (0.75) and rotation ease (0.24) both tightened so it settles back to flat quickly, independent of the +10% magnitude bump below.
    _blDrag.tiltVX *= 0.75;
    _blDrag.tiltVY *= 0.75;
    // Clamp/velocity multiplier/perspective all +10% for a more pronounced tilt.
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

    // Raw per-event cursor delta; _blTiltTick (running every frame) turns this into the eased, decaying rotation.
    _blDrag.tiltVX = e.clientX - _blDrag.tiltLastX;
    _blDrag.tiltVY = e.clientY - _blDrag.tiltLastY;
    _blDrag.tiltLastX = e.clientX;
    _blDrag.tiltLastY = e.clientY;

    // Dropping directly onto the Favorite slot stars the widget instead of reordering it — a point-in-rect test against the cached rect, checked first.
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

    // Source box is pointer-events:none, so hit-testing naturally sees through it — no explicit self-exclusion needed.
    var targetBox = _blTargetFromPoint(e.clientX, e.clientY);
    // e.offsetX/Y are relative to e.target via the browser's own hit-test, staying accurate under panel zoom where gBCR doesn't (see _blZoneForTarget).
    var cursorInBox = targetBox ? _blOffsetFromAncestor(e.target, targetBox) : null;
    var candidate = targetBox
        ? _blZoneForTarget(targetBox, _blDrag.baseline, e.offsetX + cursorInBox.x, e.offsetY + cursorInBox.y)
        : null;

    // The source box's row is only dimmed, not removed, so a candidate that just reconstructs the original arrangement isn't a meaningful placement — suppress it.
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

    // Dropped on the Favorite slot — same _favAdd as the star badge, just reached by dragging; skips the reorder path, widget stays where it was on the board.
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

    // The other boxes haven't moved, so their current rects are the correct FLIP start; the dropped box instead gets a scale-bounce "landing" animation.
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
// Fixed half-width slot holding a sliding stack of up to FAV_MAX widgets, physically relocating each real .tool-body rather than cloning.
// Starring pushes a new page and jumps to it; past FAV_MAX evicts the oldest back to Bottom Layout. _favApplyLayout reconciles _favGet()'s ids against the DOM.
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

    // A cloned (mask-safe) copy of the widget's collapse icon so this page can show it during board-editing, same as every other Bottom Layout widget.
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
// Predictive: jumps to a page on the EDGE its trigger newly becomes true (selection none->some), not continuously while true, so manual swiping isn't fought.
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

    // First tick since the bar (re)appeared — calibrate prev-state from what's true right now instead of treating it as a fresh edge.
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

        // Ease Copy wins a simultaneous tie — keyEdge is checked first regardless of shapeEdge.
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

// Reconciles _favGet()'s id list against the DOM: drops/builds/relocates pages, re-syncs dots/track position, and Bottom Layout's pinned state.
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

    // Can't be favorited AND pinned in Bottom Layout at once — its real content just moved up here.
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

// Pushes a new favorite onto the stack and jumps to it. Past FAV_MAX, the oldest page is evicted first, sent back to Bottom Layout as a new full-line row.
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

// A page's own X — un-favorites just that one and returns it to Bottom Layout as a new full-line row instead of leaving it unpinned/delisted.
function _favRemoveId(id) {
    var ids = _favGet().filter(function(x) { return x !== id; });
    _favSave(ids);
    _favActiveIndex = ids.length ? Math.min(_favActiveIndex, ids.length - 1) : 0;
    _favApplyLayout();
    _blAddWidget(id);
}

// Wires up EVERY catalog id, not just pinned ones — an unpinned box still needs to be drag-ready the moment it's added back in; runs once, at page load.
function _blInitControls() {
    BL_CATALOG_IDS.forEach(function(id) {
        var box = _blBoxEl(id);
        if (!box) return;
        box.classList.add('bl-draggable');
        // Every other widget collapses to icon-only while editing, so the whole box is the drag surface. Quick Actions stays interactive, so drag must start from .bl-drag-handle only.
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

// ── Bottom Layout add/remove — same X-badge/empty "+" tile pattern as Quick Actions, scaled up to whole widgets. ────────────

// One badge per catalog box, injected once at load — harmless on an unpinned box, just inert until pinned and board-editing is on.
function _blInitRemoveBadges() {
    BL_CATALOG_IDS.forEach(function(id) {
        var box = _blBoxEl(id);
        if (!box || box.querySelector('.bl-widget-remove')) return;
        var badge = document.createElement('button');
        badge.type = 'button';
        badge.className = 'bl-widget-remove';
        badge.title = 'Remove this widget';
        badge.innerHTML = '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><line x1="4.8" y1="4.8" x2="9.2" y2="9.2"/><line x1="9.2" y1="4.8" x2="4.8" y2="9.2"/></svg>';
        // Stops the box's own mousedown (drag-start) from firing — else tapping the badge would also pick the box up.
        badge.addEventListener('mousedown', function(e) { e.stopPropagation(); });
        badge.addEventListener('click', function(e) {
            e.stopPropagation();
            _blRemoveWidget(id);
        });
        box.appendChild(badge);
    });
}

// Star badge, opposite corner from the remove-X — clicking it pushes that widget onto the Favorite slot's stack (_favAdd), same injected-once pattern.
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

// Unpins a widget and FLIPs the remaining pinned ones into their newly packed positions — mirrors the drag-drop settle, triggered by a click instead.
function _blRemoveWidget(id) {
    var beforeIds = _blPinnedIds().filter(function(x) { return x !== id; });
    var oldRects = _blCaptureRects(beforeIds);

    _blSaveRows(_blRemoveFromRows(_blGetRows(), id));
    _blApplyLayout();
    _blPlayFlip(beforeIds, oldRects);
}

// Pins a widget as a new full-line row at the end, FLIPping the already-pinned ones aside and giving the new box the same "landing" bounce a drag-drop gets.
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

// The dashed "+" affordance — a full-width row shown only while editing and only when there's something left to add. Reused across renders, not rebuilt.
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

// ── Add-widget popover — same search+grid pattern as Quick Actions' popover (.qa-add-popover reused), but listing BL_CATALOG entries instead of tool tiles.

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

// Each tile shows the catalog entry's icon, cloned off its box's .qa-collapse-icon so it can't drift out of sync, plus its label.
function _blBuildCatalogTile(entry) {
    var tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'qa-add-tile';
    tile.title = entry.label;

    var box = _blBoxEl(entry.id);
    var iconSrc = box && box.querySelector('.qa-collapse-icon');
    if (iconSrc) {
        // Reuses _qaCloneCatalogTile purely for its mask-id-renaming logic — Spell Check's icon has an internal <mask id> that would collide otherwise.
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

function doSmartSelect() {
    run('lineup_smartSelect()');
}

function doSmartMerge() {
    run('lineup_smartMerge()', function(result) {
        showToast(result, 'info');
    });
}

function doSmartLink() {
    run('lineup_smartLink()', function(result) {
        if (result.indexOf('ERROR:') === 0) {
            showToast(result.replace(/^ERROR:\s*/, ''));
        } else {
            showToast(result, 'info');
        }
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

    // Floating preview clone that tracks the cursor — same treatment as the Settings section-reorder drag.
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

    // Hide the original row in place — keeps its slot as a fixed gap other rows slide around, same technique as the Settings section drag.
    draggedRow.style.visibility = 'hidden';

    var startY = startEvent.clientY, originTop = draggedRect.top;
    var lastTarget = null, lastMode = null;

    function clearShifts() {
        for (var i = 0; i < rows.length; i++) rows[i].el.style.transform = '';
    }

    // Only before/after (sibling reorder) opens a gap — "into" just highlights the target row since nothing inserts between siblings.
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
            // Thin edges reorder as a sibling; the wide middle band nests the dragged folder inside whatever row it's dropped on.
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

// Bumped ~30% up from [0.65, 0.8, 0.95] — reads too small at real size inside AE. zoom scales the whole Home tab as one unit without disturbing flex/grid proportions.
var SCALE_FACTORS = [0.85, 1.05, 1.25];

// Kept in sync by applyScale — every drag interaction inside a .settings-modal (the resize handle,
// Bulk Replace's card swap) needs this to convert real/rendered mouse-pixel deltas into the LOCAL
// CSS px values those zoomed modals expect; see the comments in _bcsResizeStart/_brlDragMove below
// for why skipping the division would make a drag track faster or slower than the cursor.
var _uiZoom = 1;

function applyScale(val) {
    var f = SCALE_FACTORS[Math.max(0, Math.min(2, val))];
    _uiZoom = f;
    var content = document.getElementById('panel-content');
    if (content) content.style.zoom = String(f);

    // Overlay modals live outside #panel-content, so the zoom above doesn't reach them. This used to
    // match it with transform:scale() instead — which stretches the modal's already-rasterized
    // pixels rather than re-laying it out, and reads visibly soft/blurry at any non-1 factor. zoom
    // re-lays-out and re-rasterizes at the target size, same as #panel-content above, so it stays crisp.
    document.querySelectorAll('.settings-modal').forEach(function (m) {
        m.style.zoom = String(f);
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
// Ordering is independent per layout; only hidden-state is shared, via _commitHiddenBlockIds/_getHiddenBlockIds above.

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
// Rebuilt fresh each time Classic becomes active — the original settings page's drag-to-reorder + toggle-to-hide list, just inline instead of a modal.

function _renderClassicSettingsList() {
    var list = document.getElementById('settingsSectionList');
    if (!list) return;
    var sections = document.querySelectorAll('#homeClassic .section[data-block-id]');

    list.innerHTML = '';
    var rows = [];
    sections.forEach(function(sec) {
        var row = buildSettingsRow(sec);
        if (!row) return;
        // Starts faded/scaled down inline so each row can release on its own staggered delay below, instead of all popping in together.
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

// Grid (page 1) <-> one group's detail page (page 2+) — only one .help-page is ever .help-page-active at a time.
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

// Searches every detail page's .help-key/.help-desc text directly off the DOM (no separate search index) and lists matches, each jumping to its source page.
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
        // Hidden state is shared with Compact — route through the shared commit so Compact reflects it the moment you switch back.
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
    _bcsBindRowEnable('bcsDimsCheck', document.getElementById('bcsScaleRow'));
    _bcsBindRowEnable('bcsFrCheck',   document.getElementById('bcsSnapRow'));

    // Delegated dirty-tracking for every native control; scrub fields are custom (no native events while dragging), so they call _bcsMarkDirty() directly instead.
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

function openBatchCompSettings() {
    cs.evalScript('lineup_getBatchCompSettingsSeed()', function (result) {
        if (!result || result === 'undefined') {
            // No live ExtendScript bridge (e.g. previewing in a browser) — fall back to mock data so the panel can still be opened and tested visually.
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

        document.getElementById('bcsOverlay').classList.remove('bcs-hidden');
    });
}

function closeBatchCompSettings() {
    document.getElementById('bcsOverlay').classList.add('bcs-hidden');
    _bcsClearDirty();
}

function applyBatchCompSettings() {
    var applyDims   = chkVal('bcsDimsCheck');
    var width       = _bcsWidthScrub.get();
    var height      = _bcsHeightScrub.get();
    var scaleContent = chkVal('bcsScaleCheck');

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
        applyDims + ',' + width + ',' + height + ',' + scaleContent + ',' +
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
// Targets the active comp's selected layers when any are selected, else the
// comps selected in the Project panel — same "layers first, else comps" rule
// the host applies when it actually performs the rename (see
// lineup_getBatchRenameSeed/lineup_batchRenameApply in host.jsx).

var _brnNames      = [];     // every target's current name when the panel was opened (stable, by original index)
var _brnCompMeta   = [];     // parallel to _brnNames — {frameRate,width,height,duration} when targeting comps, else null per entry
var _brnTargetType = 'comps'; // 'comps' | 'layers', from the seed — gates the comp-info Replace tokens
var _brnExcluded   = {};     // index (into _brnNames) -> true, removed from the batch
var _brnDirty      = false;

// Wraps a user-typed string as a safely-escaped ExtendScript string literal
// for embedding directly into an evalScript() call.
function _esQuote(str) {
    return '"' + String(str).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n') + '"';
}

// Spreadsheet-style column letters: 1 -> A, 2 -> B, … 26 -> Z, 27 -> AA, …
function _brnNumberToLetters(num) {
    var s = '';
    while (num > 0) {
        var rem = (num - 1) % 26;
        s = String.fromCharCode(65 + rem) + s;
        num = Math.floor((num - 1) / 26);
    }
    return s;
}

// Replace can enumerate across the batch: every run of [#]/[##]/[###]… becomes
// a zero-padded counter (width = number of #'s) starting from `num`, and the
// semi-secret [A] token becomes a letter by position alone (ignores Start at,
// always starts at A) — same tokens the old numbered-pattern rename used.
function _brnApplyReplaceTokens(replaceStr, num, letterPos) {
    if (!replaceStr) return replaceStr;
    var out = replaceStr.replace(/\[#+\]/g, function (m) {
        var width = m.length - 2;
        var s = String(num);
        while (s.length < width) s = '0' + s;
        return s;
    });
    out = out.replace(/\[A\]/g, _brnNumberToLetters(letterPos));
    return out;
}

// Trims floating-point noise (e.g. 23.976 reported as 23.976000000000002) without flattening legitimate NTSC decimals like 29.97/23.976 down to one place.
function _brnFormatFrameRate(fr) {
    return String(Math.round(fr * 1000) / 1000);
}

// Ignores pixel aspect ratio by design — this is the frame's width:height ratio (e.g. 1920x1080 -> "1.8"), not the pixel shape.
function _brnFormatAspectRatio(width, height) {
    if (!height) return '';
    return (Math.round((width / height) * 10) / 10).toFixed(1);
}

// Largest-unit duration: h:mm:ss.s, m:ss.s, or just s.s — never frames, seconds always carry exactly one decimal.
function _brnFormatDuration(totalSeconds) {
    var t = Math.max(0, totalSeconds);
    var hrs  = Math.floor(t / 3600);
    var mins = Math.floor((t % 3600) / 60);
    var secs = Math.round((t - hrs * 3600 - mins * 60) * 10) / 10;
    if (secs >= 60) { secs -= 60; mins += 1; }
    if (mins >= 60) { mins -= 60; hrs += 1; }

    function pad2(n) { return (n < 10 ? '0' : '') + n; }
    function secStr(s) { return (s < 10 ? '0' : '') + s.toFixed(1); }

    if (hrs > 0)  return hrs + ':' + pad2(mins) + ':' + secStr(secs);
    if (mins > 0) return mins + ':' + secStr(secs);
    return secs.toFixed(1);
}

// Comp-only Replace tokens — meaningless for a layer (no frame rate/dimensions/duration of its own), so callers only pass
// a non-null meta when _brnTargetType is 'comps'; left untouched otherwise.
function _brnApplyCompTokens(str, meta) {
    if (!str || !meta) return str;
    var w = meta.width, h = meta.height;
    return str
        .replace(/\[frameRate\]/g, _brnFormatFrameRate(meta.frameRate))
        .replace(/\[aspectRatio\]/g, _brnFormatAspectRatio(w, h))
        .replace(/\[dimension\]/g, w + 'x' + h)
        .replace(/\[width\]/g, String(w))
        .replace(/\[height\]/g, String(h))
        .replace(/\[duration\]/g, _brnFormatDuration(meta.duration));
}

// Find is a regex, so plain text ("Light") matches that substring anywhere in
// the name, while ^ / $ match the empty position at the start/end of the name
// — replacing there effectively prepends/appends the Replace text. Falls back
// to the original name on an empty or invalid pattern (e.g. unmatched paren)
// rather than throwing mid-preview; the host performs the same validation
// before actually applying, so a bad pattern surfaces as a toast on Apply.
function _brnComputeName(origName, findStr, replaceStr, num, letterPos, meta) {
    if (!findStr) return origName;
    try {
        var repl = _brnApplyCompTokens(replaceStr, meta);
        repl = _brnApplyReplaceTokens(repl, num, letterPos);
        return origName.replace(new RegExp(findStr, 'g'), repl);
    } catch (e) {
        return origName;
    }
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

// Renders from _brnNames / _brnExcluded — each row has a remove button that
// excludes that item from the batch without touching the actual AE selection.
function _brnRenderList() {
    var list    = document.getElementById('brnCompList');
    var findStr = document.getElementById('brnFind').value;
    var replStr = document.getElementById('brnReplace').value;
    var start   = parseInt(document.getElementById('brnStart').value, 10);
    if (isNaN(start)) start = 1;

    list.innerHTML = '';
    var shown = 0;
    var pos   = 0; // 0-based position among kept rows — drives [#]/[A] enumeration
    for (var i = 0; i < _brnNames.length; i++) {
        if (_brnExcluded[i]) continue;
        shown++;
        var origName = _brnNames[i];
        var newName  = _brnComputeName(origName, findStr, replStr, start + pos, pos + 1, _brnCompMeta[i]);
        pos++;

        var row = document.createElement('div');
        row.className = 'bcs-comp-row';
        row.title = origName;
        row.innerHTML =
            '<svg viewBox="0 0 14 10" fill="currentColor"><rect x="0.5" y="0.5" width="13" height="9" rx="1.3" fill="none" stroke="currentColor" stroke-width="1"/></svg>' +
            '<span class="bcs-comp-name"></span>' +
            '<span class="bcs-comp-orig"></span>' +
            '<button class="bcs-comp-remove" title="Remove from batch">' +
                '<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><line x1="1.5" y1="1.5" x2="8.5" y2="8.5"/><line x1="8.5" y1="1.5" x2="1.5" y2="8.5"/></svg>' +
            '</button>';
        row.querySelector('.bcs-comp-name').textContent = newName;
        row.querySelector('.bcs-comp-orig').textContent = (newName !== origName) ? origName : '';
        row.querySelector('.bcs-comp-remove').addEventListener('click', (function (idx) {
            return function () {
                _brnExcluded[idx] = true;
                _brnMarkDirty();
                _brnRenderList();
            };
        })(i));
        list.appendChild(row);
    }
    if (shown === 0) {
        var empty = document.createElement('div');
        empty.className = 'bcs-complist-empty';
        empty.textContent = 'No comp or layer selected';
        list.appendChild(empty);
    }
}

// Lightweight counterpart to _brnRenderList for find/replace/start-number
// edits: only updates displayed names, no rebuild, since row count is unchanged.
function _brnUpdatePreviewNames() {
    var list    = document.getElementById('brnCompList');
    var findStr = document.getElementById('brnFind').value;
    var replStr = document.getElementById('brnReplace').value;
    var start   = parseInt(document.getElementById('brnStart').value, 10);
    if (isNaN(start)) start = 1;

    var nameEls = list.querySelectorAll('.bcs-comp-name');
    var origEls = list.querySelectorAll('.bcs-comp-orig');
    var pos = 0;
    for (var i = 0; i < _brnNames.length && pos < nameEls.length; i++) {
        if (_brnExcluded[i]) continue;
        var origName = _brnNames[i];
        var newName  = _brnComputeName(origName, findStr, replStr, start + pos, pos + 1, _brnCompMeta[i]);
        nameEls[pos].textContent = newName;
        origEls[pos].textContent = (newName !== origName) ? origName : '';
        pos++;
    }
}

function _brnInit() {
    document.getElementById('brnFind').addEventListener('input',    function () { _brnUpdatePreviewNames(); _brnMarkDirty(); });
    document.getElementById('brnReplace').addEventListener('input', function () { _brnUpdatePreviewNames(); _brnMarkDirty(); });
    document.getElementById('brnStart').addEventListener('input',   function () { _brnUpdatePreviewNames(); _brnMarkDirty(); });
}

function openBatchRename() {
    cs.evalScript('lineup_getBatchRenameSeed()', function (result) {
        if (!result || result === 'undefined') {
            // No live ExtendScript bridge (e.g. previewing in a browser) — fall back to mock data so the panel can still be opened and tested visually.
            result = 'comps|';
        }
        if (result.indexOf('ERROR:') === 0) {
            showToast(result.replace(/^ERROR:\s*/, ''));
            return;
        }
        var bar = result.split('|');
        _brnTargetType = bar[0] === 'layers' ? 'layers' : 'comps';
        var entries = bar.slice(1).filter(function (n) { return n.length > 0; });

        _brnNames    = [];
        _brnCompMeta = [];
        for (var i = 0; i < entries.length; i++) {
            if (_brnTargetType === 'comps') {
                // name<TAB>frameRate<TAB>width<TAB>height<TAB>duration — see lineup_getBatchRenameSeed in host.jsx.
                var f = entries[i].split('\t');
                _brnNames.push(f[0]);
                _brnCompMeta.push({
                    frameRate: parseFloat(f[1]) || 0,
                    width:     parseInt(f[2], 10) || 0,
                    height:    parseInt(f[3], 10) || 0,
                    duration:  parseFloat(f[4]) || 0
                });
            } else {
                _brnNames.push(entries[i]);
                _brnCompMeta.push(null);
            }
        }
        _brnExcluded = {};

        document.getElementById('brnFind').value    = '';
        document.getElementById('brnReplace').value = '';
        document.getElementById('brnStart').value   = '1';
        document.getElementById('brnCompInfoHelpBtn').classList.toggle('bcs-hidden', _brnTargetType !== 'comps');
        _brnRenderList();
        _brnClearDirty();

        document.getElementById('brnOverlay').classList.remove('bcs-hidden');
    });
}

function closeBatchRename() {
    document.getElementById('brnOverlay').classList.add('bcs-hidden');
    _brnClearDirty();
}

function applyBatchRename() {
    var findStr = document.getElementById('brnFind').value;
    var replStr = document.getElementById('brnReplace').value;
    var start   = parseInt(document.getElementById('brnStart').value, 10);
    if (isNaN(start)) start = 1;

    if (!findStr) {
        showToast('Enter a value to find.');
        return;
    }

    var excludedIdx = [];
    for (var i = 0; i < _brnNames.length; i++) {
        if (_brnExcluded[i]) excludedIdx.push(i);
    }
    if (_brnNames.length > 0 && excludedIdx.length === _brnNames.length) {
        showToast('All items were removed from the list — nothing to apply.');
        return;
    }

    var script = 'lineup_batchRenameApply(' +
        _esQuote(findStr) + ',' + _esQuote(replStr) + ',' +
        _esQuote(excludedIdx.join(',')) + ',' + start + ')';

    cs.evalScript(script, function (result) {
        if (!result || result === 'undefined') { closeBatchRename(); return; }
        if (result.indexOf('ERROR:') === 0) {
            showToast(result.replace(/^ERROR:\s*/, ''));
            return;
        }
        closeBatchRename();
    });
}

// ── Bulk Replace ──────────────────────────────────────────────────────────────
// Pairs the Project panel's current selection (fixed at open time, in panel order) with a set of
// files chosen from disk (fixed at pick time, in file-dialog return order) positionally. Neither
// order is guaranteed to match the order the user actually clicked things in, so nothing is ever
// sent to lineup_bulkReplaceApply until the paired list below has been shown back to the user —
// removing a row just drops that pairing from the batch; the underlying AE selection is untouched.

var _brlItems    = []; // [{id, name, ext}] — the valid footage items from the selection, in panel order
var _brlFiles    = []; // [{path, name}] — the picked replacement files, in file-dialog order
var _brlExcluded = {}; // index into the paired range (0..min(items,files)-1) -> true, removed from the batch
var _brlSkipped  = 0;  // non-footage items (comps, folders, solids) present in the selection at open time

function _brlPlural(count, singular) {
    return count + ' ' + singular + (count === 1 ? '' : 's');
}

// Three visual categories plus a catch-all, each with their own icon next to the item being replaced
// (see _brlRenderList) — same image/video/3D groupings host.jsx's STRUCTURE_EXT_MAP uses for project
// organization, just split back out to three (not collapsed to one "media" bucket) since images and
// video read as visually distinct things, not two flavors of the same icon.
var BRL_IMAGE_EXTS = { psd:1, psb:1, ai:1, eps:1, jpg:1, jpeg:1, png:1, gif:1, bmp:1, tif:1, tiff:1, tga:1, webp:1, svg:1, exr:1, dpx:1, hdr:1 };
var BRL_VIDEO_EXTS = { mov:1, mp4:1, avi:1, mxf:1, mkv:1, wmv:1, m4v:1, webm:1, mpg:1, mpeg:1, m2v:1, r3d:1, braw:1 };
var BRL_3D_EXTS     = { c4d:1, obj:1, fbx:1, dae:1, abc:1, gltf:1, glb:1 };

// Frame + sun + mountains — the classic "image" glyph.
var BRL_IMAGE_ICON_SVG = '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="2" width="11" height="10" rx="1.5"/><circle cx="5" cy="5.3" r="1.1"/><path d="M1.5,10.5 L5,7 L7.5,9.2 L9.5,6.8 L12.5,10"/></svg>';
// Frame + play triangle — plain video glyph, distinct from the image frame above.
var BRL_VIDEO_ICON_SVG = '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="2.5" width="11" height="9" rx="1.5"/><path d="M6,5 L9.5,7 L6,9 Z" fill="currentColor" stroke="none"/></svg>';
// Circle-with-highlight (sphere) — 3D scene files only, not a stand-in for images/video too.
var BRL_3D_ICON_SVG = '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"><circle cx="7" cy="7" r="5.3"/><path d="M4.2,4.8 A2.3,2.3 0 0,1 5.6,3.6" fill="none"/></svg>';
// Plain document with a folded corner — same visual language as Comp Export's own icon elsewhere,
// scaled down, for every other filetype (audio, anything unrecognized).
var BRL_FILE_ICON_SVG = '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5,1.5 H8 L10.5,4 V12.5 H3.5 Z"/><path d="M8,1.5 V4 H10.5"/></svg>';

function _brlItemIconSvg(ext) {
    var e = (ext || '').toLowerCase();
    if (BRL_IMAGE_EXTS[e]) return BRL_IMAGE_ICON_SVG;
    if (BRL_VIDEO_EXTS[e]) return BRL_VIDEO_ICON_SVG;
    if (BRL_3D_EXTS[e])    return BRL_3D_ICON_SVG;
    return BRL_FILE_ICON_SVG;
}

function openBulkReplace() {
    cs.evalScript('lineup_bulkReplaceGetSelection()', function (result) {
        if (!result || result === 'undefined') return;
        if (result.indexOf('ERROR:') === 0) {
            showToast(result.replace(/^ERROR:\s*/, ''));
            return;
        }
        var data;
        try { data = JSON.parse(result); } catch (e) { return; }
        if (!data.items || !data.items.length) {
            showToast('Select one or more footage items in the Project panel first.');
            return;
        }

        _brlItems    = data.items;
        _brlFiles    = [];
        _brlExcluded = {};
        _brlSkipped  = data.skipped || 0;

        _brlRenderList();
        document.getElementById('brlOverlay').classList.remove('bcs-hidden');
    });
}

function closeBulkReplace() {
    document.getElementById('brlOverlay').classList.add('bcs-hidden');
}

function _brlPickFiles() {
    cs.evalScript('lineup_bulkReplacePickFiles()', function (result) {
        if (!result || result === 'undefined') return;
        if (result.indexOf('ERROR:') === 0) {
            showToast(result.replace(/^ERROR:\s*/, ''));
            return;
        }
        var data;
        try { data = JSON.parse(result); } catch (e) { return; }
        if (data.canceled) return; // user backed out of the dialog — leave the modal as it was

        _brlFiles    = data.files || [];
        _brlExcluded = {};
        _brlRenderList();
    });
}

// ── Bulk Replace: drag a row's file card onto another to swap their files ──────
// Items never move — only the file half of each pairing does — so the draggable unit is just the
// small file card inset on the row's right side (see .brl-file-card), not the whole row: pick the
// card up, hover another row's card, drop to trade files with it.
var _brlDrag = null; // {idx, card, startX, startY, overIdx} while a drag is in progress

function _brlDragMove(e) {
    if (!_brlDrag) return;
    // clientX/Y are real/rendered pixels; translate() below is read in LOCAL px inside the modal's
    // own zoom (see _uiZoom/applyScale) — dividing keeps the card tracking the cursor 1:1 regardless
    // of panel scale instead of drifting ahead of or behind it.
    var dx = (e.clientX - _brlDrag.startX) / _uiZoom;
    var dy = (e.clientY - _brlDrag.startY) / _uiZoom;
    _brlDrag.card.style.transform = 'translate(' + dx + 'px, ' + dy + 'px)';

    var cards = document.getElementById('brlList').querySelectorAll('.brl-file-card');
    var overCard = null;
    for (var i = 0; i < cards.length; i++) {
        if (cards[i] === _brlDrag.card) continue;
        var r = cards[i].getBoundingClientRect();
        if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
            overCard = cards[i];
            break;
        }
    }
    for (var j = 0; j < cards.length; j++) cards[j].classList.toggle('brl-drop-target', cards[j] === overCard);
    _brlDrag.overIdx = overCard ? parseInt(overCard.getAttribute('data-idx'), 10) : null;
}

function _brlDragEnd() {
    if (!_brlDrag) return;
    document.removeEventListener('mousemove', _brlDragMove);
    document.removeEventListener('mouseup', _brlDragEnd);

    if (_brlDrag.overIdx !== null && _brlDrag.overIdx !== _brlDrag.idx) {
        var a = _brlDrag.idx, b = _brlDrag.overIdx;
        var tmp = _brlFiles[a]; _brlFiles[a] = _brlFiles[b]; _brlFiles[b] = tmp;
    }
    _brlDrag = null;
    _brlRenderList(); // rebuilds every row fresh — clears the dragged card's inline transform/classes for free
}

function _brlDragStart(e, card, idx) {
    e.preventDefault();
    _brlDrag = { idx: idx, card: card, startX: e.clientX, startY: e.clientY, overIdx: null };
    card.classList.add('brl-dragging');
    document.addEventListener('mousemove', _brlDragMove);
    document.addEventListener('mouseup', _brlDragEnd);
}

// Renders the paired range (0..min(items,files)-1, minus excluded rows) plus a note covering
// anything that didn't make it into a pair — skipped-at-selection items, or a items/files count
// mismatch from the file pick.
function _brlRenderList() {
    var list     = document.getElementById('brlList');
    var note     = document.getElementById('brlNote');
    var applyBtn = document.getElementById('brlApplyBtn');
    list.innerHTML = '';

    var pairCount = Math.min(_brlItems.length, _brlFiles.length);
    var shown = 0;
    for (var i = 0; i < pairCount; i++) {
        if (_brlExcluded[i]) continue;
        shown++;
        var item = _brlItems[i], file = _brlFiles[i];

        var row = document.createElement('div');
        row.className = 'bcs-comp-row';
        row.innerHTML =
            _brlItemIconSvg(item.ext) +
            '<span class="bcs-comp-name"></span>' +
            '<div class="brl-file-card">' +
                '<span class="brl-file-name"></span>' +
            '</div>' +
            '<button class="bcs-comp-remove" title="Remove from batch">' +
                '<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><line x1="1.5" y1="1.5" x2="8.5" y2="8.5"/><line x1="8.5" y1="1.5" x2="1.5" y2="8.5"/></svg>' +
            '</button>';
        var nameEl = row.querySelector('.bcs-comp-name');
        nameEl.textContent = item.name;
        nameEl.title       = item.name; // per-element tooltip — the row no longer carries one combined title, so each abridged name shows its own full text on hover
        var card = row.querySelector('.brl-file-card');
        card.setAttribute('data-idx', i);
        card.title = file.name;
        row.querySelector('.brl-file-name').textContent = file.name;
        card.addEventListener('mousedown', (function (idx, cardEl) {
            return function (e) { _brlDragStart(e, cardEl, idx); };
        })(i, card));
        row.querySelector('.bcs-comp-remove').addEventListener('click', (function (idx) {
            return function () {
                _brlExcluded[idx] = true;
                _brlRenderList();
            };
        })(i));
        list.appendChild(row);
    }
    if (shown === 0) {
        var empty = document.createElement('div');
        empty.className = 'bcs-complist-empty';
        empty.textContent = _brlFiles.length ? 'Nothing left to replace' : 'Choose replacement files to build the list';
        list.appendChild(empty);
    }

    var notes = [];
    if (_brlSkipped > 0) notes.push(_brlPlural(_brlSkipped, 'item') + " in your selection weren't replaceable footage and were skipped");
    if (_brlFiles.length && _brlItems.length !== _brlFiles.length) {
        var extra = _brlItems.length - _brlFiles.length;
        notes.push(extra > 0
            ? _brlPlural(extra, 'item') + ' left over with no file chosen — pick again with matching counts, or remove them above'
            : _brlPlural(-extra, 'file') + ' left over, unused');
    }
    note.textContent = notes.join('. ');

    applyBtn.disabled = shown === 0;
}

function applyBulkReplace() {
    var ids = [], paths = [];
    for (var i = 0; i < Math.min(_brlItems.length, _brlFiles.length); i++) {
        if (_brlExcluded[i]) continue;
        ids.push(_brlItems[i].id);
        paths.push(_brlFiles[i].path);
    }
    if (!ids.length) {
        showToast('Nothing to replace.');
        return;
    }

    var script = 'lineup_bulkReplaceApply(' + _esQuote(JSON.stringify(ids)) + ',' + _esQuote(JSON.stringify(paths)) + ')';
    cs.evalScript(script, function (result) {
        if (!result || result === 'undefined') { closeBulkReplace(); return; }
        if (result.indexOf('ERROR:') === 0) {
            showToast(result.replace(/^ERROR:\s*/, ''));
            return;
        }
        closeBulkReplace();
        showToast(result, 'info');
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
// Gamifies AE usage: workday streak + running totals -> score. AE has no events for any of this, so it polls a cheap snapshot (lineup_getActivitySnapshot) and diffs against the previous poll.
// Undo/curve edits aren't tracked (no reliable way to attribute them). Keyframe counting is scoped to SELECTED layers only, capping poll cost regardless of comp size.
var ACTIVITY_KEY = 'lineup-activity';
var ACTIVITY_POLL_MS = 3000; // a background stat, not a live UI sync — no need for anything faster
var ACTIVITY_POINTS = { layers: 5, keyframes: 10, fx: 15 };

var _activityData = null;     // persisted totals/score/streak/history — see _activityLoad
var _activityBaseline = null; // last-seen raw snapshot from host.jsx; NOT persisted — a fresh load/switch just recaptures a starting point

function _activityDefaults() {
    return {
        totals: { layers: 0, keyframes: 0, fx: 0 },
        score: 0,
        streak: { current: 0, best: 0, lastActiveDate: null },
        history: {} // 'YYYY-MM-DD' -> { layers, keyframes, fx, score } — days with any activity
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

// Counts Mon-Fri dates strictly BETWEEN two dates (both ends excluded) — the whole streak rule in one number: 0 missed workdays means the streak continues.
function _activityWorkdaysBetween(start, end) {
    var count = 0;
    var cur = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
    while (cur.getTime() < end.getTime()) {
        if (!_activityIsWeekend(cur)) count++;
        cur.setDate(cur.getDate() + 1);
    }
    return count;
}

// Runs once per calendar day (no-op via lastActiveDate === today) — extends the streak if the gap has zero missed workdays, otherwise resets to 1.
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
    if (!day) { day = { layers: 0, keyframes: 0, fx: 0, score: 0, seconds: 0 }; _activityData.history[key] = day; }
    return day;
}

function _activityAddPoints(kind, count) {
    if (!count || count <= 0) return;
    var pts = (ACTIVITY_POINTS[kind] || 0) * count;
    _activityData.totals[kind] = (_activityData.totals[kind] || 0) + count;
    _activityData.score += pts;

    var day = _activityGetOrCreateDay(_activityToday());
    // A day recorded before this kind existed in the schema has no such key yet — guard against NaN-forever the same way totals[kind] above does.
    day[kind] = (day[kind] || 0) + count;
    day.score += pts;
}

// Diffs the latest snapshot against the previous one to award points. A genuine project SWITCH (projectSwitch below) makes a meaningless one-tick jump, so that tick's deltas are skipped and the new snapshot just becomes the baseline.
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
        var numItemsChanged = baseline.numItems !== snap.numItems;
        var selectionChanged = baseline.selectionId !== snap.selectionId;
        var propSelectionChanged = baseline.propSelectionId !== snap.propSelectionId;
        var timeChanged = baseline.currentTime !== snap.currentTime;

        // A Save As changes projectId without touching layers/selection, so gating purely on projectId threw away legitimate credit. compId alone isn't a safe "real switch" signal either — it's only unique within a single project, so a freshly opened project's active comp (or lack of one, right after File > Open) can coincidentally match the previous project's compId, letting that whole project's layerCount jump through uncaught. numItems changing too is a much harder coincidence, so either signal changing is enough to distrust this tick.
        var projectSwitch = projectChanged && (compChanged || numItemsChanged);

        var dLayers = 0, dKeyframes = 0, dFx = 0;
        if (!projectSwitch) {
            dLayers = snap.layerCount - baseline.layerCount;
            if (dLayers > 0) _activityAddPoints('layers', dLayers);
        }
        // Keyframe count is scoped to comp.selectedProperties, so a row-selection change swings it as hard as a project switch — same rebaseline treatment. fx is scoped to layer selection instead.
        if (!projectSwitch && !propSelectionChanged) {
            dKeyframes = snap.keyframeCount - baseline.keyframeCount;
            if (dKeyframes > 0) _activityAddPoints('keyframes', dKeyframes);
        }
        if (!projectSwitch && !selectionChanged) {
            dFx = snap.fxCount - baseline.fxCount;
            if (dFx > 0) _activityAddPoints('fx', dFx);
        }

        // Anything different from last poll, even changes that score no points, still counts as "the user is doing something" for the Trophy timer below.
        if (projectChanged || compChanged || selectionChanged || propSelectionChanged || timeChanged ||
            dLayers !== 0 || dKeyframes !== 0 || dFx !== 0) {
            _timerMarkActivity();
        }

        _activitySave();
        _activityRenderTab();
    });
}

// Tiny white clock icon used both in the streak strip and the calendar's day cells — one shared constant instead of repeating the SVG markup.
var TROPHY_MINI_CLOCK_SVG = '<svg viewBox="0 0 20 20" fill="none" stroke="#ffffff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="7.5"/><path d="M10,5.5 V10 L13,12"/></svg>';

// Finds the date range of the CURRENT streak run, walking backward through consecutive active days with zero missed-workday gaps. Used only for the day strip's visual grouping — streak.current itself is computed independently in _activityCheckStreak.
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

    // Group consecutive in-streak cells under one shared .trophy-streak-wrap instead of tinting each day individually, so the streak reads as one contiguous subsection.
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

// Shows TODAY's numbers, not the all-time cumulative — d.score/d.totals still track all-time sums underneath for the leaderboard's All-Time tab.
function _activityRenderTab() {
    if (!_activityData) return;
    var d = _activityData;
    var today = d.history[_activityToday()] || { layers: 0, keyframes: 0, fx: 0, score: 0 };
    var scoreEl = document.getElementById('trophyScoreValue');
    if (scoreEl) scoreEl.textContent = today.score;
    var layEl = document.getElementById('trophyStatLayers');
    if (layEl) layEl.textContent = today.layers || 0;
    var kfEl = document.getElementById('trophyStatKeyframes');
    if (kfEl) kfEl.textContent = today.keyframes || 0;
    var fxEl = document.getElementById('trophyStatFx');
    // || 0, not a bare today.fx — a pre-fx-schema day has no such key, and undefined renders as a genuinely blank tile, not "0".
    if (fxEl) fxEl.textContent = today.fx || 0;
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
// Master on/off for the activity poll specifically (the one piece that costs real performance); js/leaderboard.js checks the same key so one switch mutes both. Defaults to ON.
var _activityPollIntervalId = null;

function _scoringEnabled() {
    var v;
    try { v = localStorage.getItem('lineup-scoring-enabled'); } catch (e) {}
    return v !== '0';
}

// Toolbar Mode has no Trophy access at all, so the poll is forced off while active WITHOUT touching the saved preference, resuming correctly on switch-out.
function _scoringShouldBeActive() {
    return _scoringEnabled() && !document.body.classList.contains('layout-toolbar');
}

// Animates shown<->collapsed via max-height/width as inline style (CSS can't interpolate to/from 'auto') — pins current size first, then animates to/from 0, since transitions can't target 'auto'.
// display:none only applied once collapse finishes (removed before expand starts), so the parent's `gap` stops reserving space, canceled by a matching negative margin mid-transition.
// animate=false snaps straight to final state — used on initial page load, where a fade would look like a flash of the "wrong" layout.
function _trophySetCollapsed(el, collapsed, isRow, animate) {
    if (!el) return;
    var sizeProp = isRow ? 'maxWidth' : 'maxHeight';
    var marginProp = isRow ? 'marginRight' : 'marginTop';

    // Toggling rapidly would otherwise leave the PRIOR call's transitionend listener attached, stomping display/max-* back to stale state — clear it first.
    if (el._trophyCollapseHandler) {
        el.removeEventListener('transitionend', el._trophyCollapseHandler);
        el._trophyCollapseHandler = null;
    }

    if (!animate) {
        var prevTransition = el.style.transition;
        el.style.transition = 'none';
        el.style.display = collapsed ? 'none' : '';
        el.style[sizeProp] = collapsed ? '0px' : '';
        el.style.opacity = collapsed ? '0' : '';
        el.style[marginProp] = collapsed ? '-10px' : '';
        el.style.pointerEvents = collapsed ? 'none' : '';
        void el.offsetHeight; // flush before restoring the transition, or it'd animate this snap too
        el.style.transition = prevTransition;
        return;
    }

    if (collapsed) {
        // getBoundingClientRect, not scrollWidth/scrollHeight — the score card's width comes from flex-grow, not content, so scrollWidth undershoots and caused a visible "pop".
        var startSize = isRow ? el.getBoundingClientRect().width : el.getBoundingClientRect().height;
        el.style[sizeProp] = startSize + 'px';
        void el.offsetHeight;
        requestAnimationFrame(function () {
            el.style[sizeProp] = '0px';
            el.style.opacity = '0';
            el.style[marginProp] = '-10px'; // cancels the parent's own 10px gap while this is mid-collapse
            el.style.pointerEvents = 'none';
        });
        el._trophyCollapseHandler = function (e) {
            if (e.target !== el || e.propertyName.indexOf('max-') !== 0) return;
            el.style.display = 'none';
            el.removeEventListener('transitionend', el._trophyCollapseHandler);
            el._trophyCollapseHandler = null;
        };
        el.addEventListener('transitionend', el._trophyCollapseHandler);
    } else {
        el.style.display = '';
        el.style[marginProp] = ''; // restore before measuring, so the target size reflects the real expanded box
        el.style[sizeProp] = ''; // momentarily unconstrained — the box needs to actually resolve its real size (flex-grow for a row item, content height for a block) to measure it accurately, since that's what determines the box size once the cap is released at the end anyway
        el.style.opacity = '0';
        void el.offsetHeight; // reflow now, before reading the rect below, or it'd measure stale layout
        var targetSize = (isRow ? el.getBoundingClientRect().width : el.getBoundingClientRect().height) + 'px';
        el.style[sizeProp] = '0px'; // re-clamp before the next paint so the fully-expanded state never actually flashes on screen
        void el.offsetHeight;
        requestAnimationFrame(function () {
            el.style[sizeProp] = targetSize;
            el.style.opacity = '1';
            el.style.pointerEvents = '';
        });
        el._trophyCollapseHandler = function (e) {
            if (e.target !== el || e.propertyName.indexOf('max-') !== 0) return;
            el.style[sizeProp] = ''; // release the cap so later growth (e.g. the leaderboard list) isn't clipped
            el.removeEventListener('transitionend', el._trophyCollapseHandler);
            el._trophyCollapseHandler = null;
        };
        el.addEventListener('transitionend', el._trophyCollapseHandler);
    }
}

// With the poll off, score/stats/leaderboard would sit frozen showing stale numbers, so scoring-off collapses the Trophy tab to just the timer + streak widget, which stay meaningful either way.
function _activityApplyScoringLayout(enabled, animate) {
    _trophySetCollapsed(document.querySelector('.trophy-score-card'), !enabled, true, animate);
    _trophySetCollapsed(document.querySelector('.trophy-stats-grid'), !enabled, false, animate);
    _trophySetCollapsed(document.querySelector('.trophy-leaderboard-card'), !enabled, false, animate);
}

function _activityApplyScoringEnabled(enabled, animate) {
    _activityApplyScoringLayout(enabled, animate);
    if (enabled) {
        if (!_activityPollIntervalId) _activityPollIntervalId = setInterval(_activityPollTick, ACTIVITY_POLL_MS);
    } else if (_activityPollIntervalId) {
        clearInterval(_activityPollIntervalId);
        _activityPollIntervalId = null;
    }
}

function toggleScoring(on) {
    try { localStorage.setItem('lineup-scoring-enabled', on ? '1' : '0'); } catch (e) {}
    // Only animate if Trophy is the visible tab right now — animating while its ancestor is display:none would measure a bogus all-zero rect and pin a stuck target.
    _activityApplyScoringEnabled(!!on, _activeTabName === 'trophy');
}

function restoreScoringSetting() {
    var enabled = _scoringEnabled();
    var chk = document.getElementById('scoringEnabledCheck');
    // Checkbox reflects the real saved preference regardless of mode — just hidden entirely in Toolbar Mode, not actually flipped off.
    if (chk) chk.checked = enabled;
    _activityApplyScoringEnabled(_scoringShouldBeActive(), false); // page load — snap to the saved state, don't animate into it
}

// Called by js/leaderboard.js after it merges cloud-synced history — without this hook, this module's in-memory _activityData would silently overwrite the merge on the next periodic save.
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
// "How long working today" clock: starts on panel load, auto-pauses after 5min inactivity, auto-resumes on any activity (heartbeat or local mousedown/keydown).
// Manual pause is NOT a hard stop — same "paused" state as the inactivity timeout, so any activity resumes it regardless. Doesn't affect score; persisted per-day.
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

// Called by both the activity poll's heartbeat and this panel's mousedown/keydown listener — resets the inactivity clock and resumes if paused.
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
        // Crossed midnight with the panel left open — start a fresh per-day counter and let the streak roll over too.
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
            // Saved every second here, not just relying on the 3s activity poll's save, so closing shortly after a session start doesn't lose a few seconds.
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
// One Sun-start month grid at a time, paginated across the past 12 months, built fresh on every open/page turn (cheap: at most ~42 cells).
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

// Icon+value chips — same icons/colors as the tab's own stat-tile/timer/score cards, so a day's detail view reads as the same visual language.
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

    var timeChip =
        '<div class="trophy-cal-detail-stat">' +
            '<svg viewBox="0 0 20 20" fill="none" stroke="#6cc0ff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="7.5"/><path d="M10,5.5 V10 L13,12"/></svg>' +
            '<div class="trophy-cal-detail-stat-value">' + _timerFormat(day.seconds || 0) + '</div>' +
            '<div class="trophy-cal-detail-stat-label">Time</div>' +
        '</div>';

    // A day recorded while scoring was off has time but no score data at all; showing zeroed-out chips reads as broken, so those days collapse to just the Time chip.
    var hasScoreData = !!(day.layers || day.keyframes || day.fx || day.score);
    if (!hasScoreData) {
        detail.innerHTML =
            '<div class="trophy-cal-detail-date">' + label + '</div>' +
            '<div class="trophy-cal-detail-stats">' + timeChip + '</div>';
        return;
    }

    detail.innerHTML =
        '<div class="trophy-cal-detail-date">' + label + '</div>' +
        '<div class="trophy-cal-detail-stats">' +
            timeChip +
            '<div class="trophy-cal-detail-stat">' +
                '<svg viewBox="0 0 20 20" fill="none" stroke="#7aaaff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="16" height="9" rx="1.5"/><line x1="2" y1="10" x2="18" y2="10"/></svg>' +
                '<div class="trophy-cal-detail-stat-value">' + (day.layers || 0) + '</div>' +
                '<div class="trophy-cal-detail-stat-label">Layers</div>' +
            '</div>' +
            '<div class="trophy-cal-detail-stat">' +
                '<svg viewBox="0 0 20 20" fill="#7aaaff"><path d="M10,2 L18,10 L10,18 L2,10 Z"/></svg>' +
                '<div class="trophy-cal-detail-stat-value">' + (day.keyframes || 0) + '</div>' +
                '<div class="trophy-cal-detail-stat-label">Keyframes</div>' +
            '</div>' +
            '<div class="trophy-cal-detail-stat">' +
                '<svg viewBox="0 0 20 20" fill="#7aaaff"><path d="M10,2 C10,6 11,9 15,9 C11,9 10,12 10,16 C10,12 9,9 5,9 C9,9 10,6 10,2 Z"/></svg>' +
                '<div class="trophy-cal-detail-stat-value">' + (day.fx || 0) + '</div>' +
                '<div class="trophy-cal-detail-stat-label">Effects</div>' +
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
    _refreshMarkerPreview();
    _splitTextInit();
    _smartInit();
    _initAnchorTiers();
    _initToolbarResize();
    _initToolbarDragSuppression();
    _buildAnchor5x5Grid();
    _initAnchorAltGrid();
    _initAnchorGridGlow();
    _initAnchorBtnHoverAnim();
    _initBcsResizeHandles();
    _initToolsGridGlow();
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
    _initToolsBodyFadeScroll();
    _loadToolsFavorites();
    _sortToolsGrid();
    _initToolsFavContextMenu();
    restoreCollapsed();
    restoreScale();
    _bcsInit();
    _brnInit();
    _cpInitScrubs();
    _cpDrawHueCanvas();
    _initHeaderWidthScrub();
    _activityInit();
    _timerInit();
    _staggerInitCurveEditor();
    _staggerInitMockupResizeObserver();
    _staggerInitRulerDrag();
    _staggerInitScrubs();
    _staggerLoadPresets();
    _staggerRenderPresetList();
    _layerStaggerInitCurveEditor();
    _layerStaggerInitMockupResizeObserver();
    _layerStaggerInitRulerDrag();
    _layerStaggerInitScrubs();
    _layerStaggerLoadPresets();
    _layerStaggerRenderPresetList();
    setInterval(_pollKeyAlignMode, 300);
    setInterval(_pollShapeColorHud, 1000);
    setInterval(_pollFavSmartStack, 300);
    setInterval(_pollEaseGraph, 250);
    setInterval(_refreshMarkerPreview, 250);
    // The activity poll's interval is started by restoreScoringSetting() instead of unconditionally here — see _activityApplyScoringEnabled.

    // Distribute pickers' star buttons persist independently of any UI chrome — just load the saved state so their stars render correctly.
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
