// spellchecker.jsx
// Trie-based dictionary for After Effects spellchecking.
// Each TrieNode stores up to 26 children (a-z) and an isEnd flag.
// Runs in Node.js (command-line) or After Effects ExtendScript.

(function (global) {

    // ---- Trie Node ----

    function TrieNode() {
        this.c = {};      // children keyed 0-25 (charCode - 97)
        this.end = false;
    }

    // ---- Trie ----

    function Trie() {
        this.root = new TrieNode();
    }

    Trie.prototype.insert = function (word) {
        var node = this.root;
        for (var i = 0; i < word.length; i++) {
            var idx = word.charCodeAt(i) - 97; // 'a' = 97
            if (!node.c[idx]) node.c[idx] = new TrieNode();
            node = node.c[idx];
        }
        node.end = true;
    };

    // Returns true if the exact word exists in the dictionary.
    Trie.prototype.isWord = function (word) {
        if (!word || word.length === 0) return false;
        var node = this.root;
        var lower = word.toLowerCase();
        for (var i = 0; i < lower.length; i++) {
            var idx = lower.charCodeAt(i) - 97;
            if (idx < 0 || idx > 25) return false; // non-alpha character
            if (!node.c[idx]) return false;
            node = node.c[idx];
        }
        return node.end === true;
    };

    // Returns true if any word in the dictionary starts with the given prefix.
    Trie.prototype.hasPrefix = function (prefix) {
        if (!prefix || prefix.length === 0) return true;
        var node = this.root;
        var lower = prefix.toLowerCase();
        for (var i = 0; i < lower.length; i++) {
            var idx = lower.charCodeAt(i) - 97;
            if (idx < 0 || idx > 25) return false;
            if (!node.c[idx]) return false;
            node = node.c[idx];
        }
        return true;
    };

    // ---- Dictionary Loader ----

    function buildTrie(content) {
        var trie = new Trie();
        var i = 0;
        var len = content.length;
        var wordStart = 0;

        // Parse character by character — faster than split('\n') on large strings
        while (i <= len) {
            var ch = (i < len) ? content[i] : '\n';
            if (ch === '\n' || ch === '\r') {
                if (i > wordStart) {
                    var word = content.substring(wordStart, i).replace(/\r/g, '');
                    if (word.length > 0) trie.insert(word);
                }
                // Skip \r\n pairs
                if (ch === '\r' && i + 1 < len && content[i + 1] === '\n') i++;
                wordStart = i + 1;
            }
            i++;
        }
        return trie;
    }

    function loadDictionary(filePath) {
        var content;
        if (typeof require !== 'undefined') {
            // Node.js
            var fs = require('fs');
            content = fs.readFileSync(filePath, 'utf8');
        } else {
            // ExtendScript (After Effects)
            var file = new File(filePath);
            if (!file.exists) throw new Error('Dictionary not found: ' + filePath);
            file.encoding = 'UTF-8';
            file.open('r');
            content = file.read();
            file.close();
        }
        return buildTrie(content);
    }

    // ---- Public API ----

    var SpellChecker = {
        Trie: Trie,
        loadDictionary: loadDictionary,
        buildTrie: buildTrie
    };

    // ---- Node.js export ----
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = SpellChecker;
    } else {
        global.SpellChecker = SpellChecker;
    }

    // ---- Command-line test harness (Node.js only) ----
    // Run: node spellchecker.jsx <path/to/words_alpha.txt>
    // Then type words at the prompt; Ctrl+C to quit.
    if (typeof process !== 'undefined' && require.main === module) {
        var dictPath = process.argv[2];
        if (!dictPath) {
            process.stderr.write('Usage: node spellchecker.jsx <path/to/words_alpha.txt>\n');
            process.exit(1);
        }

        process.stderr.write('Loading dictionary: ' + dictPath + '\n');
        var t0 = Date.now();
        var trie = loadDictionary(dictPath);
        var elapsed = Date.now() - t0;
        process.stderr.write('Ready in ' + elapsed + 'ms — type a word and press Enter (Ctrl+C to quit):\n');

        var readline = require('readline');
        var rl = readline.createInterface({ input: process.stdin });

        rl.on('line', function (line) {
            var word = line.trim();
            if (!word) return;
            var result = trie.isWord(word);
            process.stdout.write(word + ': ' + (result ? 'VALID' : 'NOT FOUND') + '\n');
        });

        rl.on('close', function () {
            process.exit(0);
        });
    }

}(typeof globalThis !== 'undefined' ? globalThis : this));
