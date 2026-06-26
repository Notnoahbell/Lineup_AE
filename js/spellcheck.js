/* Lineup CEP - Spellcheck module */

(function () {

    var CACHE_KEY = 'lineup-spellcheck-v1';
    var DICT_PATH = 'data/words_alpha.txt';

    var _wordSet = null;
    var _loading = false;
    var _queue   = [];

    function _parse(content) {
        var set   = Object.create(null);
        var count = 0;
        var len   = content.length;
        var start = 0;

        for (var i = 0; i <= len; i++) {
            var c = i < len ? content.charCodeAt(i) : 10;
            if (c === 10 || c === 13) {
                if (i > start) {
                    var end = (content.charCodeAt(i - 1) === 13) ? i - 1 : i;
                    if (end > start) { set[content.slice(start, end)] = 1; count++; }
                }
                if (c === 13 && i + 1 < len && content.charCodeAt(i + 1) === 10) i++;
                start = i + 1;
            }
        }

        return count >= 1000 ? set : null;
    }

    function _flush() {
        _loading = false;
        var cbs = _queue.splice(0);
        for (var i = 0; i < cbs.length; i++) cbs[i]();
    }

    function _loadFile() {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', DICT_PATH, true);
        xhr.onreadystatechange = function () {
            if (xhr.readyState !== 4) return;
            if (xhr.status === 200 || xhr.status === 0) {
                var parsed = _parse(xhr.responseText);
                if (parsed) {
                    _wordSet = parsed;
                    try { localStorage.setItem(CACHE_KEY, JSON.stringify(parsed)); } catch (e) {}
                }
            }
            _flush();
        };
        xhr.send();
    }

    function _ensureLoaded(cb) {
        if (_wordSet) { cb(); return; }
        _queue.push(cb);
        if (_loading) return;
        _loading = true;

        try {
            var raw = localStorage.getItem(CACHE_KEY);
            if (raw) {
                var parsed = JSON.parse(raw);
                if (parsed && Object.prototype.hasOwnProperty.call(parsed, 'the')) {
                    _wordSet = parsed;
                    _flush();
                    return;
                }
                try { localStorage.removeItem(CACHE_KEY); } catch (e) {}
            }
        } catch (e) {}

        _loadFile();
    }

    function _isWord(w) {
        if (!_wordSet) return false;
        return Object.prototype.hasOwnProperty.call(_wordSet, w.toLowerCase());
    }

    window.SpellCheck = {
        ensureLoaded: _ensureLoaded,
        isLoaded:     function () { return !!_wordSet; },
        isWord:       _isWord,
        clearCache:   function () {
            try { localStorage.removeItem(CACHE_KEY); } catch (e) {}
            _wordSet = null;
        }
    };

})();

var _lastScanIds  = null;
var _compResults  = [];
var _activeCompId = null;

// ── Modal helpers ─────────────────────────────────────────────────────────────

function openSpellModalCurrent() {
    run('spellcheck_getState()', function (json) {
        if (typeof json === 'string' && json.indexOf('ERROR:') === 0) {
            showToast(json.slice(6));
            return;
        }
        var state;
        try { state = JSON.parse(json); } catch (e) { showToast('Could not read project state.'); return; }

        var compId = state.activeCompId || state.lastCompId;
        if (!compId) {
            showToast('No composition is open');
            return;
        }

        document.getElementById('spellOverlay').classList.remove('spell-hidden');
        _doCheckComposition([compId]);
    });
}

function openSpellModalAll() {
    document.getElementById('spellOverlay').classList.remove('spell-hidden');
    _doCheckComposition(null);
}

function closeSpellModal() {
    document.getElementById('spellOverlay').classList.add('spell-hidden');
}

function _spellProgress(on) {
    var el = document.getElementById('spellProgressWrap');
    if (el) el.classList.toggle('active', on);
}

function _spellStatus(msg) {
    var summary = document.getElementById('spellSummary');
    if (summary) summary.classList.remove('visible');
    var body = document.getElementById('spellModalBody');
    if (!body) return;
    body.innerHTML = '';
    var d = document.createElement('div');
    d.className = 'spell-status';
    d.textContent = msg;
    body.appendChild(d);
}

// ── Timecode helper ───────────────────────────────────────────────────────────

function _spellTC(seconds, fps) {
    fps = Math.round(fps) || 30;
    var totalF = Math.round(seconds * fps);
    var f = totalF % fps;
    var s = Math.floor(totalF / fps) % 60;
    var m = Math.floor(totalF / fps / 60) % 60;
    var h = Math.floor(totalF / fps / 3600);
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    return pad(h) + ':' + pad(m) + ':' + pad(s) + ':' + pad(f);
}

// ── Composition check ─────────────────────────────────────────────────────────

function doCheckComposition() {
    try { _doCheckComposition(null); } catch (e) { _spellStatus(e.message || String(e)); }
}

function doRescan() {
    if (!_lastScanIds || !_lastScanIds.length) { showToast('Scan a composition first.'); return; }
    try { _doCheckComposition(_lastScanIds); } catch (e) { _spellStatus(e.message || String(e)); }
}

function _processLayers(fps, layers) {
    var groups = [];
    for (var i = 0; i < layers.length; i++) {
        var layer = layers[i];
        var seen  = Object.create(null);
        var bad   = [];
        for (var t = 0; t < layer.texts.length; t++) {
            var textObj = layer.texts[t];
            var tokens  = textObj.text.split(/[^a-zA-Z]/);
            for (var j = 0; j < tokens.length; j++) {
                var tok = tokens[j];
                if (!tok) continue;
                var lower = tok.toLowerCase();
                var key   = lower + ':' + textObj.keyIndex;
                if (seen[key]) continue;
                seen[key] = true;
                if (!SpellCheck.isWord(lower))
                    bad.push({ word: lower, keyIndex: textObj.keyIndex, time: textObj.time });
            }
        }
        if (bad.length > 0)
            groups.push({ index: layer.index, name: layer.name, inPoint: layer.inPoint, fps: fps, words: bad });
    }
    return groups;
}

function _doCheckComposition(forceIds) {
    var tabBar = document.getElementById('spellTabs');
    if (tabBar) tabBar.style.display = 'none';
    _spellProgress(true);
    _spellStatus('Checking...');

    SpellCheck.ensureLoaded(function () {
        if (!SpellCheck.isLoaded()) {
            _spellProgress(false);
            _spellStatus('Dictionary not found - place words_alpha.txt in the extension data/ folder.');
            return;
        }

        _spellStatus('Scanning...');

        var idsArg = (forceIds && forceIds.length) ? "'" + JSON.stringify(forceIds) + "'" : 'null';

        run('spellcheck_getComps(' + idsArg + ')', function (json) {
            _spellProgress(false);

            if (typeof json === 'string' && json.indexOf('ERROR:') === 0) {
                _spellStatus(json.slice(6));
                return;
            }

            var compsData;
            try { compsData = JSON.parse(json); } catch (e) {
                _spellStatus('Could not read compositions.');
                return;
            }

            _lastScanIds  = [];
            _compResults  = [];
            _activeCompId = null;

            for (var c = 0; c < compsData.length; c++) {
                var cd     = compsData[c];
                _lastScanIds.push(cd.id);
                var groups = _processLayers(cd.fps, cd.layers);
                if (groups.length > 0)
                    _compResults.push({ id: cd.id, name: cd.name, label: cd.label, groups: groups });
            }

            if (_compResults.length > 0) _activeCompId = _compResults[0].id;
            _renderTabs();
            _renderActive();
        });
    });
}

// ── Tab management ────────────────────────────────────────────────────────────

var _AE_LABEL_COLORS = [
    '#888888', '#c03030', '#d4a800', '#00a8b8',
    '#d0407a', '#8060c0', '#d88048', '#50b870',
    '#2878d0', '#28904a', '#8030c0', '#d07000',
    '#705030', '#c030c0', '#00b8c8', '#b89060', '#386038'
];

function _labelColor(label) {
    var idx = (typeof label === 'number' && label >= 0) ? label : 0;
    return _AE_LABEL_COLORS[idx % _AE_LABEL_COLORS.length] || '#888888';
}

function _renderTabs() {
    var tabBar = document.getElementById('spellTabs');
    if (!tabBar) return;
    tabBar.innerHTML = '';
    if (_compResults.length <= 1) { tabBar.style.display = 'none'; return; }
    tabBar.style.display = 'flex';
    for (var i = 0; i < _compResults.length; i++) {
        var r        = _compResults[i];
        var isActive = (r.id === _activeCompId);
        var color    = _labelColor(r.label);

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
        icon.style.color = color;
        icon.style.display = 'flex';

        var label = document.createElement('span');
        label.textContent = r.name;

        tab.appendChild(icon);
        tab.appendChild(label);
        tab.addEventListener('click', _spellTabClick);
        tabBar.appendChild(tab);
    }
}

function _spellTabClick() {
    _activeCompId = parseInt(this.dataset.compId, 10);
    _renderTabs();
    _renderActive();
}

function _renderActive() {
    if (_compResults.length === 0) { _renderSpellResults(null, []); return; }
    for (var i = 0; i < _compResults.length; i++) {
        if (_compResults[i].id === _activeCompId) {
            _renderSpellResults(_compResults[i].id, _compResults[i].groups);
            return;
        }
    }
    _renderSpellResults(_compResults[0].id, _compResults[0].groups);
}

// ── Render results ────────────────────────────────────────────────────────────

function _renderSpellResults(compId, groups) {
    var body    = document.getElementById('spellModalBody');
    var summary = document.getElementById('spellSummary');
    if (!body) return;
    body.innerHTML = '';

    if (groups.length === 0) {
        if (summary) summary.classList.remove('visible');
        var ok = document.createElement('div');
        ok.className = 'spell-ok';
        ok.innerHTML = '<svg width="22" height="22" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">'
            + '<path d="M6,2 L14,2 L14,10 Q14,14 10,14 Q6,14 6,10 Z"/>'
            + '<path d="M6,4 Q2,4 2,8 Q2,12 6,11"/>'
            + '<path d="M14,4 Q18,4 18,8 Q18,12 14,11"/>'
            + '<line x1="10" y1="14" x2="10" y2="17"/>'
            + '<line x1="7" y1="17" x2="13" y2="17"/>'
            + '</svg>'
            + '<span>No words misspelled</span>';
        body.appendChild(ok);
        return;
    }

    // Summary bar
    if (summary) {
        var wordCount = 0;
        for (var w = 0; w < groups.length; w++) wordCount += groups[w].words.length;
        var wLabel = wordCount  === 1 ? 'word'  : 'words';
        var lLabel = groups.length === 1 ? 'layer' : 'layers';
        summary.textContent = wordCount + ' ' + wLabel + ' across ' + groups.length + ' ' + lLabel;
        summary.classList.add('visible');
    }

    for (var i = 0; i < groups.length; i++) {
        var g = groups[i];

        var entry = document.createElement('div');
        entry.className = 'spell-entry';

        // Layer name header with paper icon
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
        nameSpan.className = 'spell-layer-name';
        nameSpan.textContent = g.name;
        hdr.appendChild(nameSpan);
        entry.appendChild(hdr);

        // Group words by keyframe, render one row per keyframe
        var kfMap = Object.create(null);
        var kfOrder = [];
        for (var j = 0; j < g.words.length; j++) {
            var we = g.words[j];
            var kk = String(we.keyIndex) + ':' + we.time;
            if (!kfMap[kk]) { kfMap[kk] = { time: we.time, words: [] }; kfOrder.push(kk); }
            kfMap[kk].words.push(we);
        }

        for (var k = 0; k < kfOrder.length; k++) {
            var kf = kfMap[kfOrder[k]];
            var kfRow = document.createElement('div');
            kfRow.className = 'spell-kf-row';

            var wordsWrap = document.createElement('div');
            wordsWrap.className = 'spell-kf-words';

            for (var jj = 0; jj < kf.words.length; jj++) {
                var wordEntry = kf.words[jj];
                var bad = document.createElement('button');
                bad.className = 'spell-bad';
                bad.textContent = wordEntry.word;
                bad.dataset.compId     = compId;
                bad.dataset.layerIndex = g.index;
                bad.dataset.time       = wordEntry.time;
                bad.addEventListener('click', _spellJumpClick);
                wordsWrap.appendChild(bad);
            }

            kfRow.appendChild(wordsWrap);

            var tc = document.createElement('span');
            tc.className = 'spell-tc';
            tc.textContent = _spellTC(kf.time, g.fps);
            kfRow.appendChild(tc);

            entry.appendChild(kfRow);
        }

        body.appendChild(entry);
    }
}

// ── Click handlers ────────────────────────────────────────────────────────────

function _spellJumpClick() {
    run('spellcheck_goto(' + this.dataset.compId + ',' + this.dataset.layerIndex + ',' + this.dataset.time + ')');
}

