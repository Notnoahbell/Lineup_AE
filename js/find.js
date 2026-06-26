/* Lineup CEP - Find in Text module */

var _findActiveTab    = 'basic';
var _findLastQuery    = '';
var _findLastMode     = 'contains';
var _findLastInvert   = false;
var _findCompResults  = [];
var _findActiveCompId = null;

var _FIND_LABEL_COLORS = [
    '#888888', '#c03030', '#d4a800', '#00a8b8',
    '#d0407a', '#8060c0', '#d88048', '#50b870',
    '#2878d0', '#28904a', '#8030c0', '#d07000',
    '#705030', '#c030c0', '#00b8c8', '#b89060', '#386038'
];

// ── Modal helpers ─────────────────────────────────────────────────────────────

function openFindModal() {
    document.getElementById('findOverlay').classList.remove('spell-hidden');
    _focusFindInput();
}

function closeFindModal() {
    document.getElementById('findOverlay').classList.add('spell-hidden');
}

function _focusFindInput() {
    var id    = _findActiveTab === 'advanced' ? 'findInputAdv' : 'findInputBasic';
    var input = document.getElementById(id);
    if (input) { input.select(); setTimeout(function () { input.focus(); }, 40); }
}

function switchFindTab(tab) {
    _findActiveTab = tab;

    var tabs = document.querySelectorAll('.find-ui-tab');
    for (var i = 0; i < tabs.length; i++)
        tabs[i].classList.toggle('active', tabs[i].dataset.tab === tab);

    document.getElementById('findTabBasic').classList.toggle('active',    tab === 'basic');
    document.getElementById('findTabAdvanced').classList.toggle('active', tab === 'advanced');

    var body = document.getElementById('findModalBody');
    if (body) body.innerHTML = '';
    var tabBar = document.getElementById('findTabs');
    if (tabBar) { tabBar.innerHTML = ''; tabBar.style.display = 'none'; }
    _findCompResults  = [];
    _findActiveCompId = null;

    _focusFindInput();
    _updateReplaceBtn();
}

function _findProgress(on) {
    var el = document.getElementById('findProgressWrap');
    if (el) el.classList.toggle('active', on);
}

function _findStatus(msg) {
    var body = document.getElementById('findModalBody');
    if (!body) return;
    body.innerHTML = '';
    var d = document.createElement('div');
    d.className   = 'spell-status';
    d.textContent = msg;
    body.appendChild(d);
}

// ── Timecode ──────────────────────────────────────────────────────────────────

function _findTC(seconds, fps) {
    fps = Math.round(fps) || 30;
    var totalF = Math.round(seconds * fps);
    var f = totalF % fps;
    var s = Math.floor(totalF / fps) % 60;
    var m = Math.floor(totalF / fps / 60) % 60;
    var h = Math.floor(totalF / fps / 3600);
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    return pad(h) + ':' + pad(m) + ':' + pad(s) + ':' + pad(f);
}

// ── Replace button state ──────────────────────────────────────────────────────

function _updateReplaceBtn() {
    var isAdv  = _findActiveTab === 'advanced';
    var replEl = document.getElementById(isAdv ? 'findReplAdv'    : 'findReplBasic');
    var btn    = document.getElementById(isAdv ? 'findReplBtnAdv' : 'findReplBtnBasic');
    if (!btn) return;

    var replVal = replEl ? replEl.value : '';
    var mode    = isAdv ? (document.getElementById('findMode')     || {}).value   || 'contains' : 'contains';
    var invert  = isAdv ? !!(document.getElementById('findNotCheck') || {}).checked             : false;

    var label    = 'Replace';
    var disabled = false;

    if (invert) {
        if (mode === 'contains') { disabled = true; }
        else                     { label = 'Insert'; }
    } else {
        label = replVal === '' ? 'Remove' : 'Replace';
    }

    btn.textContent = label;
    btn.disabled    = disabled;
    btn.classList.toggle('is-remove', !disabled);
}

// ── Search ────────────────────────────────────────────────────────────────────

function doFindSearch() {
    var isAdv   = _findActiveTab === 'advanced';
    var inputEl = document.getElementById(isAdv ? 'findInputAdv' : 'findInputBasic');
    var modeEl  = isAdv ? document.getElementById('findMode')     : null;
    var notEl   = isAdv ? document.getElementById('findNotCheck') : null;
    var query   = inputEl ? inputEl.value.trim() : '';
    if (!query) return;

    _findLastQuery  = query;
    _findLastMode   = modeEl ? modeEl.value   : 'contains';
    _findLastInvert = notEl  ? notEl.checked  : false;

    var tabBar = document.getElementById('findTabs');
    if (tabBar) tabBar.style.display = 'none';
    _findProgress(true);
    _findStatus('Searching…');

    run('spellcheck_getComps(null)', function (json) {
        _findProgress(false);

        if (typeof json === 'string' && json.indexOf('ERROR:') === 0) {
            _findStatus(json.slice(6));
            return;
        }

        var compsData;
        try { compsData = JSON.parse(json); } catch (e) {
            _findStatus('Could not read compositions.');
            return;
        }

        _findCompResults  = [];
        _findActiveCompId = null;

        var lq = query.toLowerCase();

        for (var c = 0; c < compsData.length; c++) {
            var cd     = compsData[c];
            var groups = _findProcessLayers(lq, _findLastMode, _findLastInvert, cd.fps, cd.layers);
            if (groups.length > 0)
                _findCompResults.push({ id: cd.id, name: cd.name, label: cd.label, groups: groups });
        }

        if (_findCompResults.length > 0) _findActiveCompId = _findCompResults[0].id;
        _findRenderTabs();
        _findRenderActive();
    });
}

// ── Replace ───────────────────────────────────────────────────────────────────

function doFindReplace() {
    var isAdv   = _findActiveTab === 'advanced';
    var inputEl = document.getElementById(isAdv ? 'findInputAdv'  : 'findInputBasic');
    var replEl  = document.getElementById(isAdv ? 'findReplAdv'   : 'findReplBasic');
    var modeEl  = isAdv ? document.getElementById('findMode')     : null;
    var notEl   = isAdv ? document.getElementById('findNotCheck') : null;

    var query   = inputEl ? inputEl.value.trim() : '';
    var replStr = replEl  ? replEl.value          : '';
    var mode    = modeEl  ? modeEl.value          : 'contains';
    var invert  = notEl   ? notEl.checked         : false;

    if (!query) return;
    if (invert && mode === 'contains') return;

    var ids    = _findCompResults.map(function (r) { return r.id; });
    var params = JSON.stringify({ query: query, repl: replStr, mode: mode, invert: invert, ids: ids.length ? ids : null });

    _findStatus('Replacing…');
    _findProgress(true);

    run("find_replace('" + params.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "')", function (json) {
        _findProgress(false);

        if (typeof json === 'string' && json.indexOf('ERROR:') === 0) {
            showToast(json.slice(6));
            _findStatus('');
            return;
        }

        var result;
        try { result = JSON.parse(json); } catch (e) { showToast('Replace failed.'); return; }

        var n = result.count  || 0;
        var L = result.layers || 0;
        var action = invert ? 'Inserted' : (replStr === '' ? 'Removed' : 'Replaced');
        showToast(action + ' ' + n + (n !== 1 ? ' instances' : ' instance') + ' on ' + L + (L !== 1 ? ' layers' : ' layer'));

        // Re-run find to refresh results
        doFindSearch();
    });
}

// ── Match logic ───────────────────────────────────────────────────────────────

function _findTextMatches(lText, lq, mode) {
    if (mode === 'starts') return lText.indexOf(lq) === 0;
    if (mode === 'ends')   return lText.length >= lq.length && lText.lastIndexOf(lq) === lText.length - lq.length;
    /* contains */         return lText.indexOf(lq) !== -1;
}

function _findProcessLayers(lq, mode, invert, fps, layers) {
    var groups = [];
    for (var i = 0; i < layers.length; i++) {
        var layer   = layers[i];
        var matches = [];
        var seen    = Object.create(null);
        for (var t = 0; t < layer.texts.length; t++) {
            var textObj = layer.texts[t];
            var hit     = _findTextMatches(textObj.text.toLowerCase(), lq, mode);
            if (invert) hit = !hit;
            if (!hit) continue;
            var key = String(textObj.keyIndex) + ':' + textObj.time;
            if (seen[key]) continue;
            seen[key] = true;
            matches.push({ text: textObj.text, keyIndex: textObj.keyIndex, time: textObj.time });
        }
        if (matches.length > 0)
            groups.push({ index: layer.index, name: layer.name, inPoint: layer.inPoint, fps: fps, matches: matches });
    }
    return groups;
}

// ── Comp tabs ─────────────────────────────────────────────────────────────────

function _findLabelColor(label) {
    var idx = (typeof label === 'number' && label >= 0) ? label : 0;
    return _FIND_LABEL_COLORS[idx % _FIND_LABEL_COLORS.length] || '#888888';
}

function _findRenderTabs() {
    var tabBar = document.getElementById('findTabs');
    if (!tabBar) return;
    tabBar.innerHTML = '';
    if (_findCompResults.length <= 1) { tabBar.style.display = 'none'; return; }
    tabBar.style.display = 'flex';

    for (var i = 0; i < _findCompResults.length; i++) {
        var r        = _findCompResults[i];
        var isActive = (r.id === _findActiveCompId);
        var color    = _findLabelColor(r.label);

        var tab = document.createElement('button');
        tab.className      = 'spell-tab' + (isActive ? ' active' : '');
        tab.dataset.compId = r.id;

        var icon = document.createElement('span');
        icon.innerHTML = '<svg width="9" height="8" viewBox="0 0 9 8" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linecap="round">'
            + '<rect x="0.5" y="0.5" width="8" height="7" rx="0.8"/>'
            + '<line x1="0.5" y1="2.5" x2="8.5" y2="2.5"/>'
            + '<line x1="3" y1="0.5" x2="3" y2="2.5"/>'
            + '<line x1="5.8" y1="0.5" x2="5.8" y2="2.5"/>'
            + '</svg>';
        icon.style.color   = color;
        icon.style.display = 'flex';

        var lbl = document.createElement('span');
        lbl.textContent = r.name;

        tab.appendChild(icon);
        tab.appendChild(lbl);
        tab.addEventListener('click', _findTabClick);
        tabBar.appendChild(tab);
    }
}

function _findTabClick() {
    _findActiveCompId = parseInt(this.dataset.compId, 10);
    _findRenderTabs();
    _findRenderActive();
}

function _findRenderActive() {
    if (_findCompResults.length === 0) { _findRenderResults(null, []); return; }
    for (var i = 0; i < _findCompResults.length; i++) {
        if (_findCompResults[i].id === _findActiveCompId) {
            _findRenderResults(_findCompResults[i].id, _findCompResults[i].groups);
            return;
        }
    }
    _findRenderResults(_findCompResults[0].id, _findCompResults[0].groups);
}

// ── Render results ────────────────────────────────────────────────────────────

function _htmlEsc(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _findSnippet(text, query, mode, invert) {
    if (invert) {
        return text.length > 64 ? _htmlEsc(text.slice(0, 64)) + '…' : _htmlEsc(text);
    }

    var lText = text.toLowerCase();
    var lq    = query.toLowerCase();
    var idx   = (mode === 'ends') ? lText.length - lq.length : lText.indexOf(lq);

    if (idx < 0) return text.length > 64 ? _htmlEsc(text.slice(0, 64)) + '…' : _htmlEsc(text);

    var WING   = 28;
    var start  = Math.max(0, idx - WING);
    var end    = Math.min(text.length, idx + query.length + WING);
    var chunk  = text.slice(start, end);
    var offset = idx - start;

    return (start > 0 ? '…' : '')
        + _htmlEsc(chunk.slice(0, offset))
        + '<mark class="find-mark">' + _htmlEsc(chunk.slice(offset, offset + query.length)) + '</mark>'
        + _htmlEsc(chunk.slice(offset + query.length))
        + (end < text.length ? '…' : '');
}

function _findRenderResults(compId, groups) {
    var body = document.getElementById('findModalBody');
    if (!body) return;
    body.innerHTML = '';

    if (!groups || groups.length === 0) {
        var none = document.createElement('div');
        none.className   = 'find-none';
        none.textContent = 'no results found';
        body.appendChild(none);
        return;
    }

    for (var i = 0; i < groups.length; i++) {
        var g = groups[i];

        var entry = document.createElement('div');
        entry.className = 'spell-entry';

        var hdr = document.createElement('div');
        hdr.className = 'spell-layer-hdr';
        hdr.innerHTML = '<svg width="11" height="13" viewBox="0 0 11 13" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">'
            + '<path d="M1.5,0.5 L7,0.5 L10,3.5 L10,12.5 L1.5,12.5 Z"/>'
            + '<path d="M7,0.5 L7,3.5 L10,3.5"/>'
            + '<line x1="3" y1="5.5" x2="8.5" y2="5.5"/>'
            + '<line x1="3" y1="7.5" x2="8.5" y2="7.5"/>'
            + '<line x1="3" y1="9.5" x2="6.5" y2="9.5"/>'
            + '</svg>';
        var nameSpan = document.createElement('span');
        nameSpan.className   = 'spell-layer-name';
        nameSpan.textContent = g.name;
        hdr.appendChild(nameSpan);
        entry.appendChild(hdr);

        for (var j = 0; j < g.matches.length; j++) {
            var match = g.matches[j];

            var row = document.createElement('div');
            row.className          = 'spell-kf-row find-result-row';
            row.dataset.compId     = compId;
            row.dataset.layerIndex = g.index;
            row.dataset.time       = match.time;
            row.addEventListener('click', _findJumpClick);

            var textEl = document.createElement('div');
            textEl.className = 'find-match-text';
            textEl.innerHTML = _findSnippet(match.text, _findLastQuery, _findLastMode, _findLastInvert);

            var tc = document.createElement('span');
            tc.className   = 'spell-tc';
            tc.textContent = _findTC(match.time, g.fps);

            row.appendChild(textEl);
            row.appendChild(tc);
            entry.appendChild(row);
        }

        body.appendChild(entry);
    }
}

// ── Jump ──────────────────────────────────────────────────────────────────────

function _findJumpClick() {
    run('spellcheck_goto(' + this.dataset.compId + ',' + this.dataset.layerIndex + ',' + this.dataset.time + ')');
}

// ── Keyboard & init ───────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function () {
    function bindInput(id) {
        var el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('keydown', function (e) {
            if (e.key === 'Enter')  doFindSearch();
            if (e.key === 'Escape') closeFindModal();
        });
    }
    bindInput('findInputBasic');
    bindInput('findInputAdv');

    // Replace button label updates
    ['findReplBasic', 'findReplAdv'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.addEventListener('input', _updateReplaceBtn);
    });

    var notChk = document.getElementById('findNotCheck');
    var notLbl = document.getElementById('findNotLabel');
    if (notChk) {
        notChk.addEventListener('change', function () {
            if (notLbl) notLbl.classList.toggle('active', notChk.checked);
            _updateReplaceBtn();
        });
    }

    var modeEl = document.getElementById('findMode');
    if (modeEl) modeEl.addEventListener('change', _updateReplaceBtn);

    _updateReplaceBtn();
});
