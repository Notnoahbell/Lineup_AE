#target aftereffects

(function () {

    // ---- Word set lookup ----
    // On first run the .txt file is parsed and a flat JSON cache is saved next
    // to this script. Every subsequent run loads the cache via JSON.parse
    // (native C++), so startup goes from ~30s to under a second.

    var wordSet = null;

    function isWord(word) {
        if (!wordSet || !word) return false;
        return wordSet.hasOwnProperty(word.toLowerCase());
    }

    // ---- File helpers ----

    function scriptDir() {
        return new File($.fileName).parent.fsName;
    }

    function readFile(path) {
        var f = new File(path);
        if (!f.exists) return null;
        f.encoding = 'UTF-8';
        f.open('r');
        var s = f.read();
        f.close();
        return s;
    }

    function writeFile(path, content) {
        var f = new File(path);
        f.encoding = 'UTF-8';
        f.open('w');
        f.write(content);
        f.close();
    }

    // ---- Cache ----

    function loadCache(cachePath) {
        var raw = readFile(cachePath);
        if (!raw) return null;
        try { return JSON.parse(raw); } catch (e) { return null; }
    }

    function saveCache(set, cachePath) {
        try { writeFile(cachePath, JSON.stringify(set)); } catch (e) { /* non-fatal */ }
    }

    // ---- Build from .txt ----
    // Parses character-by-character to avoid a 370k-element split() array.

    function buildFromTxt(txtPath) {
        var content = readFile(txtPath);
        if (!content) return null;

        var set = {};
        var len = content.length;
        var wordStart = 0;

        for (var i = 0; i <= len; i++) {
            var ch = (i < len) ? content.charAt(i) : '\n';
            if (ch === '\n' || ch === '\r') {
                if (i > wordStart) {
                    var word = content.substring(wordStart, i);
                    if (word.charAt(word.length - 1) === '\r') word = word.substring(0, word.length - 1);
                    if (word.length > 0) set[word] = true;
                }
                if (ch === '\r' && i + 1 < len && content.charAt(i + 1) === '\n') i++;
                wordStart = i + 1;
            }
        }
        return set;
    }

    // ---- UI ----

    var win = new Window('dialog', 'Spellchecker', undefined, { resizable: false });
    win.orientation = 'column';
    win.alignChildren = ['fill', 'top'];
    win.margins = 14;
    win.spacing = 10;

    var inputGroup = win.add('group');
    inputGroup.orientation = 'row';
    inputGroup.alignChildren = ['left', 'center'];
    inputGroup.spacing = 8;
    inputGroup.add('statictext', undefined, 'Word:');
    var input = inputGroup.add('edittext', [0, 0, 220, 24], '');
    input.active = true;

    var btn = win.add('button', undefined, 'Check Word');
    btn.enabled = false;

    var status = win.add('statictext', undefined, '');
    status.alignment = 'center';
    status.preferredSize.width = 260;

    // ---- Load on show ----

    var cachePath = ''; // resolved inside onShow once $.fileName is valid

    win.onShow = function () {
        cachePath = scriptDir() + '/words_cache.json';

        status.text = 'Loading dictionary…';
        win.update();

        // Fast path: JSON cache already exists
        wordSet = loadCache(cachePath);

        if (wordSet) {
            status.text = 'Dictionary ready.';
            btn.enabled = true;
            input.active = true;
            win.update();
            return;
        }

        // Slow path: first run — build from .txt and save cache
        status.text = 'First run: building cache from words_alpha.txt…';
        win.update();

        var defaultTxt = '~/Downloads/words_alpha.txt';
        wordSet = buildFromTxt(defaultTxt);

        if (!wordSet) {
            status.text = 'Select words_alpha.txt to continue.';
            win.update();
            var picked = File.openDialog('Select dictionary (words_alpha.txt)', 'Text files:*.txt,All files:*.*');
            if (picked) wordSet = buildFromTxt(picked.fsName);
        }

        if (wordSet) {
            status.text = 'Saving cache…';
            win.update();
            saveCache(wordSet, cachePath);
            status.text = 'Dictionary ready.';
            btn.enabled = true;
            input.active = true;
        } else {
            status.text = 'No dictionary loaded.';
        }

        win.update();
    };

    // ---- Handlers ----

    btn.onClick = function () {
        var word = input.text.replace(/^\s+|\s+$/g, '');
        if (!word) { alert('Please enter a word.'); return; }
        alert('"' + word + '" is ' + (isWord(word) ? '' : 'not ') + 'a word.');
    };

    input.onEnterKey = function () {
        if (btn.enabled) btn.onClick();
    };

    win.show();

})();
