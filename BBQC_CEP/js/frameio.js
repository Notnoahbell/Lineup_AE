(function () {
  'use strict';

  // Frame.io v4 REST API client for the BBQC panel, using Adobe IMS OAuth.
  //
  // Sign-in uses the OAuth Authorization Code + PKCE flow against a
  // "Single Page App" (public, no client secret) credential from Adobe
  // Developer Console. The CEP manifest enables Node.js (mixed context),
  // so while sign-in is in progress this file runs a short-lived local
  // HTTPS server on the loopback address to catch the redirect Adobe sends
  // back — the user just signs in in their browser and the panel picks
  // the result up on its own. No pasting, no manual localhost URL entry.
  // Adobe IMS requires an HTTPS redirect URI even for 127.0.0.1, so the
  // listener uses a bundled self-signed cert (certs/localhost-*.pem,
  // generated once for this repo — see certs/README if that file exists);
  // the browser will show a one-time "not private" warning on that cert
  // that needs a "proceed anyway" click before the tokens land.
  //
  // Tokens live in a JSON file on disk (see getTokenFilePath() below), not
  // in the panel's localStorage — this is per-machine, not tied to this
  // specific Adobe app's CEF storage partition, and survives cache clears.

  var API_BASE = 'https://api.frame.io/v4';
  var IMS_AUTHORIZE_URL = 'https://ims-na1.adobelogin.com/ims/authorize/v2';
  var IMS_TOKEN_URL = 'https://ims-na1.adobelogin.com/ims/token/v3';

  // ---------------------------------------------------------
  // App configuration — set once by the developer, not the user.
  //
  // In Adobe Developer Console, add a "Single Page App" OAuth credential
  // (PKCE, no secret) to the project and register this exact redirect URI
  // on it: https://127.0.0.1:8734/callback
  // ---------------------------------------------------------
  var CLIENT_ID = '477ebe8e6f4e43d0989409072e18f21c';
  var REDIRECT_URI = 'https://127.0.0.1:8734/callback';
  var AUTH_SERVER_PORT = 8734;
  // NEEDS LIVE VERIFICATION: this is Adobe's documented default scope list
  // for user-authentication OAuth flows; adjust if Adobe IMS reports an
  // invalid_scope error for this client.
  var OAUTH_SCOPE = 'openid email profile offline_access additional_info.roles';

  var nodeRequire = (typeof require === 'function') ? require : null;
  var nodeHttps = nodeRequire ? nodeRequire('https') : null;
  var nodeCrypto = nodeRequire ? nodeRequire('crypto') : null;
  var nodeFs = nodeRequire ? nodeRequire('fs') : null;
  var nodePath = nodeRequire ? nodeRequire('path') : null;
  var nodeOs = nodeRequire ? nodeRequire('os') : null;
  var NODE_READY = !!(nodeHttps && nodeCrypto && nodeFs && nodePath && nodeOs);

  // document.currentScript is only valid while this file is first
  // executing — capture its src now, since extensionRoot() below is only
  // actually called later, from the Sign In click handler.
  var THIS_SCRIPT_SRC = document.currentScript && document.currentScript.src;

  // The extension's install directory, derived from this script's own
  // file:// URL (no CSInterface is loaded in this panel to ask for it).
  function extensionRoot() {
    try {
      if (!THIS_SCRIPT_SRC) return null;
      var pathname = decodeURIComponent(new URL(THIS_SCRIPT_SRC).pathname);
      if (process.platform === 'win32' && /^\/[A-Za-z]:\//.test(pathname)) pathname = pathname.slice(1);
      return nodePath.dirname(nodePath.dirname(pathname)); // js/frameio.js -> extension root
    } catch (e) { return null; }
  }

  function loadTlsOptions() {
    var root = extensionRoot();
    if (!root) throw new Error('Could not resolve the extension\'s install directory.');
    var certDir = nodePath.join(root, 'certs');
    return {
      key: nodeFs.readFileSync(nodePath.join(certDir, 'localhost-key.pem')),
      cert: nodeFs.readFileSync(nodePath.join(certDir, 'localhost-cert.pem'))
    };
  }

  var cachedToken = null; // { value, expiresAt }
  var activeServer = null;
  var pendingAuth = null; // { state, codeVerifier }, set by beginSignIn()

  // ---------------------------------------------------------
  // Token file (per-machine, not per-AE-profile)
  // ---------------------------------------------------------

  function getTokenFilePath() {
    var base = process.platform === 'win32'
      ? (process.env.APPDATA || nodePath.join(nodeOs.homedir(), 'AppData', 'Roaming'))
      : nodePath.join(nodeOs.homedir(), 'Library', 'Application Support');
    var dir = nodePath.join(base, 'BBQC');
    try { nodeFs.mkdirSync(dir, { recursive: true }); } catch (e) {}
    return nodePath.join(dir, 'frameio-auth.json');
  }

  function readTokenFile() {
    if (!NODE_READY) return null;
    try {
      var raw = nodeFs.readFileSync(getTokenFilePath(), 'utf8');
      return JSON.parse(raw);
    } catch (e) { return null; }
  }

  function writeTokenFile(data) {
    if (!NODE_READY) return;
    try { nodeFs.writeFileSync(getTokenFilePath(), JSON.stringify(data, null, 2), 'utf8'); } catch (e) {}
  }

  function clearTokenFile() {
    if (!NODE_READY) return;
    try { nodeFs.unlinkSync(getTokenFilePath()); } catch (e) {}
  }

  function isConnected() {
    var stored = readTokenFile();
    return !!(stored && stored.refreshToken);
  }

  function disconnect() {
    clearTokenFile();
    cachedToken = null;
  }

  function shallowCopy(obj) {
    var out = {};
    for (var k in obj) if (obj.hasOwnProperty(k)) out[k] = obj[k];
    return out;
  }

  // ---------------------------------------------------------
  // OAuth: interactive sign-in (PKCE, auto-captured redirect)
  // ---------------------------------------------------------

  function tryOpenInBrowser(url) {
    try {
      if (window.cep && window.cep.util && window.cep.util.openURLInDefaultBrowser) {
        window.cep.util.openURLInDefaultBrowser(url);
        return;
      }
      if (window.__adobe_cep__ && window.__adobe_cep__.openURLInDefaultBrowser) {
        window.__adobe_cep__.openURLInDefaultBrowser(url);
        return;
      }
    } catch (e) {}
    try {
      if (!nodeRequire) return;
      var exec = nodeRequire('child_process').exec;
      if (process.platform === 'win32') exec('start "" "' + url + '"');
      else if (process.platform === 'darwin') exec('open "' + url + '"');
      else exec('xdg-open "' + url + '"');
    } catch (e) {}
  }

  function base64url(buf) {
    return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function buildAuthorizeUrl(codeChallenge, state) {
    return IMS_AUTHORIZE_URL +
      '?client_id=' + encodeURIComponent(CLIENT_ID) +
      '&redirect_uri=' + encodeURIComponent(REDIRECT_URI) +
      '&scope=' + encodeURIComponent(OAUTH_SCOPE) +
      '&response_type=code' +
      '&code_challenge=' + encodeURIComponent(codeChallenge) +
      '&code_challenge_method=S256' +
      '&state=' + encodeURIComponent(state);
  }

  function callbackPage(title, message) {
    return '<!doctype html><html><head><meta charset="utf-8"><title>' + title + '</title></head>' +
      '<body style="font-family:-apple-system,Segoe UI,sans-serif;text-align:center;padding:64px 24px;color:#222;">' +
      '<h2 style="margin-bottom:8px;">' + title + '</h2><p>' + message + '</p></body></html>';
  }

  function stopServer(server) {
    if (activeServer === server) activeServer = null;
    try { server.close(); } catch (e) {}
  }

  // Opens the system browser to Adobe's sign-in page and listens on the
  // loopback redirect until Adobe sends the user back with a code (or an
  // error). Resolves with testConnection()'s result once tokens are in
  // hand. If onUrlReady is given, it's called with the authorize URL as
  // soon as it's built, so the caller can offer it as a manual fallback
  // link in case the automatic browser-open didn't work.
  function beginSignIn(onUrlReady) {
    if (!NODE_READY) {
      return Promise.reject(new Error('Node.js integration is not enabled for this extension (check CSXS/manifest.xml).'));
    }
    if (!CLIENT_ID || CLIENT_ID.indexOf('REPLACE_WITH') === 0) {
      return Promise.reject(new Error('BBQC is missing its Adobe OAuth Client ID (frameio.js CLIENT_ID) — this is a one-time setup step for the developer, not something you enter.'));
    }
    if (activeServer) {
      return Promise.reject(new Error('A sign-in is already in progress — finish it in your browser, or wait a moment and try again.'));
    }

    var tlsOptions;
    try {
      tlsOptions = loadTlsOptions();
    } catch (e) {
      return Promise.reject(new Error('Could not load the local HTTPS certificate needed for sign-in (certs/localhost-*.pem): ' + e.message));
    }

    return new Promise(function (resolve, reject) {
      var codeVerifier = base64url(nodeCrypto.randomBytes(48));
      var codeChallenge = base64url(nodeCrypto.createHash('sha256').update(codeVerifier).digest());
      var state = base64url(nodeCrypto.randomBytes(16));
      pendingAuth = { state: state, codeVerifier: codeVerifier };

      var server = nodeHttps.createServer(tlsOptions, function (req, res) {
        var reqUrl;
        try { reqUrl = new URL(req.url, 'https://127.0.0.1:' + AUTH_SERVER_PORT); } catch (e) { res.writeHead(400); res.end(); return; }
        if (reqUrl.pathname !== '/callback') { res.writeHead(404); res.end(); return; }

        var code = reqUrl.searchParams.get('code');
        var returnedState = reqUrl.searchParams.get('state');
        var errorParam = reqUrl.searchParams.get('error');
        var errorDesc = reqUrl.searchParams.get('error_description');

        var auth = pendingAuth;
        pendingAuth = null;
        stopServer(server);
        clearTimeout(timeout);

        if (errorParam) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(callbackPage('Sign-in cancelled', 'You can close this tab and return to After Effects.'));
          reject(new Error(errorDesc || errorParam));
          return;
        }
        if (!auth || !code || returnedState !== auth.state) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(callbackPage('Sign-in failed', 'That link didn’t match the sign-in BBQC started. Close this tab and try again from After Effects.'));
          reject(new Error('Sign-in state mismatch — start again from the panel.'));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(callbackPage('Signed in', 'You can close this tab and return to After Effects.'));

        exchangeCodeForTokens(code, auth.codeVerifier).then(resolve, reject);
      });

      var timeout = setTimeout(function () {
        pendingAuth = null;
        stopServer(server);
        reject(new Error('Sign-in timed out waiting for your browser. Click Sign In to try again.'));
      }, 5 * 60 * 1000);

      server.on('error', function (err) {
        pendingAuth = null;
        clearTimeout(timeout);
        activeServer = null;
        reject(new Error('Could not start the local sign-in listener on port ' + AUTH_SERVER_PORT + ': ' + err.message));
      });

      server.listen(AUTH_SERVER_PORT, '127.0.0.1', function () {
        activeServer = server;
        var authorizeUrl = buildAuthorizeUrl(codeChallenge, state);
        if (onUrlReady) { try { onUrlReady(authorizeUrl); } catch (e) {} }
        tryOpenInBrowser(authorizeUrl);
      });
    });
  }

  function imsTokenRequest(params) {
    var body = Object.keys(params).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }).join('&');

    return fetch(IMS_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body
    }).then(function (res) {
      return res.text().then(function (text) {
        var json = null;
        try { json = JSON.parse(text); } catch (e) {}
        if (!res.ok) {
          throw new Error('Adobe IMS error: ' + ((json && (json.error_description || json.error)) || text || res.status));
        }
        return json;
      });
    });
  }

  function applyTokenResponse(tokenResponse) {
    cachedToken = {
      value: tokenResponse.access_token,
      expiresAt: Date.now() + (Math.max(60, (tokenResponse.expires_in || 3600) - 60) * 1000)
    };
    if (tokenResponse.refresh_token) {
      writeTokenFile({ refreshToken: tokenResponse.refresh_token, updatedAt: Date.now() });
    }
  }

  function exchangeCodeForTokens(code, codeVerifier) {
    return imsTokenRequest({
      grant_type: 'authorization_code',
      code: code,
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      code_verifier: codeVerifier
    }).then(function (tokenResponse) {
      applyTokenResponse(tokenResponse);
      return testConnection();
    });
  }

  function refreshAccessToken() {
    var stored = readTokenFile();
    if (!stored || !stored.refreshToken) return Promise.reject(new Error('Not connected to Frame.io yet. Click Sign In.'));

    return imsTokenRequest({
      grant_type: 'refresh_token',
      refresh_token: stored.refreshToken,
      client_id: CLIENT_ID
    }).then(function (tokenResponse) {
      applyTokenResponse(tokenResponse);
      return cachedToken.value;
    }).catch(function (err) {
      // Refresh token is likely expired/revoked — force a fresh interactive
      // sign-in next time rather than retrying silently forever.
      clearTokenFile();
      throw new Error('Your Frame.io session expired. Click Sign In again. (' + err.message + ')');
    });
  }

  function getAccessToken() {
    if (cachedToken && cachedToken.expiresAt > Date.now()) return Promise.resolve(cachedToken.value);
    return refreshAccessToken();
  }

  // ---------------------------------------------------------
  // Low-level Frame.io API request helper
  // ---------------------------------------------------------

  function apiRequest(path, options) {
    options = options || {};
    return getAccessToken().then(function (token) {
      var headers = options.headers ? shallowCopy(options.headers) : {};
      headers['Authorization'] = 'Bearer ' + token;
      if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';

      return fetch(API_BASE + path, {
        method: options.method || 'GET',
        headers: headers,
        body: options.body
      }).then(function (res) {
        return res.text().then(function (text) {
          return { status: res.status, statusText: res.statusText, ok: res.ok, text: text };
        });
      });
    }).then(function (res) {
      if (res.status === 204) return null;
      var json = null;
      try { json = res.text ? JSON.parse(res.text) : null; } catch (e) {}
      if (!res.ok) {
        var message = (json && json.errors && json.errors[0] && json.errors[0].detail) || res.text || (res.status + ' ' + res.statusText);
        throw new Error('Frame.io API error (' + res.status + '): ' + message);
      }
      return json;
    });
  }

  // ---------------------------------------------------------
  // Accounts / shares / files / comments
  // ---------------------------------------------------------

  function listAccounts() {
    return apiRequest('/accounts').then(function (json) { return (json && json.data) || []; });
  }

  // Frame.io's V4 API has no "list a share's assets" or "resolve a share
  // link" endpoint (confirmed against a live account — every guess at
  // /accounts/{id}/shares, /collections/{id}/*, and /shares/{id}/assets
  // 404s; their own migration guide says as much). What *does* work: a
  // pasted share link's short URL (f.io/...) HTTP-redirects to
  // https://<host>/share/{shareId}/view/{id}, where {id} is either a
  // version_stack id (GET .../version_stacks/{id} -> data.head_version.id
  // is the real file id) or, if the link already carries a
  // "?version={fileId}" query param, the file id itself. So instead of
  // listing anything, we follow the redirect and read the id out of the
  // URL the browser would land on.
  //
  // The same /view/{id}(?version={fileId}) shape also appears in the
  // address bar while viewing a specific asset directly inside a project
  // in the Frame.io web app — https://next.frame.io/project/{projectId}/
  // view/{id} — with no share involved at all. That link needs no redirect
  // (it's already final) and no shareId; everything else about resolving
  // it down to an account + file id is identical.

  function followRedirects(startUrl, hopsLeft) {
    hopsLeft = hopsLeft === undefined ? 8 : hopsLeft;
    return new Promise(function (resolve, reject) {
      var parsed;
      try { parsed = new URL(startUrl); } catch (e) { reject(new Error('That doesn’t look like a valid link.')); return; }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') { resolve(startUrl); return; }

      var lib = parsed.protocol === 'http:' ? nodeRequire('http') : nodeHttps;
      var req = lib.request({
        method: 'GET',
        hostname: parsed.hostname,
        port: parsed.port || undefined,
        path: parsed.pathname + parsed.search,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      }, function (res) {
        res.resume(); // discard body — we only need headers
        var loc = res.headers.location;
        if (loc && res.statusCode >= 300 && res.statusCode < 400 && hopsLeft > 0) {
          var nextUrl;
          try { nextUrl = new URL(loc, startUrl).toString(); } catch (e) { resolve(startUrl); return; }
          followRedirects(nextUrl, hopsLeft - 1).then(resolve, reject);
        } else {
          resolve(startUrl);
        }
      });
      req.on('error', reject);
      req.setTimeout(10000, function () { req.destroy(new Error('Timed out reaching ' + startUrl)); });
      req.end();
    });
  }

  function parseShareUrl(finalUrl) {
    var versionId = null;
    try { versionId = new URL(finalUrl).searchParams.get('version'); } catch (e) {}

    var shareMatch = String(finalUrl).match(/\/share\/([0-9a-f-]{36})(?:\/view\/([0-9a-f-]{36}))?/i);
    if (shareMatch) return { shareId: shareMatch[1], viewId: shareMatch[2] || null, versionId: versionId };

    var projectViewMatch = String(finalUrl).match(/\/project\/[0-9a-f-]{36}\/view\/([0-9a-f-]{36})/i);
    if (projectViewMatch) return { shareId: null, viewId: projectViewMatch[1], versionId: versionId };

    return null;
  }

  // Tries each account the credential can see until one recognizes `id` —
  // either as a version_stack (resolved down to its head_version's file
  // id) or, failing that, as a file id directly.
  function resolveFileAcrossAccounts(accounts, id) {
    var chain = Promise.resolve(null);
    accounts.forEach(function (account) {
      chain = chain.then(function (found) {
        if (found) return found;
        return apiRequest('/accounts/' + account.id + '/version_stacks/' + id).then(function (json) {
          var headVersion = json && json.data && json.data.head_version;
          return { accountId: account.id, fileId: (headVersion && headVersion.id) || id };
        }).catch(function () {
          return apiRequest('/accounts/' + account.id + '/files/' + id).then(function () {
            return { accountId: account.id, fileId: id };
          }).catch(function () { return null; });
        });
      });
    });
    return chain;
  }

  // Resolves a pasted Frame.io link — either a share link (f.io/... or
  // .../share/{id}/view/{id}) or a plain in-app asset view link
  // (next.frame.io/project/{id}/view/{id}, copied straight from the
  // browser's address bar while viewing an asset) — down to
  // { accountId, fileId, shareId }. shareId is null for view links, since
  // there's no share involved.
  function resolveShareLink(url) {
    url = String(url || '').trim();
    if (!url) return Promise.reject(new Error('Paste a Frame.io link first.'));
    if (!NODE_READY) return Promise.reject(new Error('Node.js integration is not enabled for this extension (check CSXS/manifest.xml).'));

    // If the pasted URL already matches a known shape (a full share link,
    // or a project view link), parse it directly — do NOT probe it over
    // the network first. Project view links only load inside the user's
    // logged-in Frame.io session; an unauthenticated request to one here
    // would just get redirected to a login page, destroying the very path
    // we're trying to read. Only short links that truly need resolving
    // (f.io/...) fall through to followRedirects.
    var direct = parseShareUrl(url);
    var resolved = direct ? Promise.resolve(url) : followRedirects(url);

    return resolved.then(function (finalUrl) {
      var parsed = direct || parseShareUrl(finalUrl);
      if (!parsed) throw new Error('Could not find an asset in that link. Paste a Frame.io share link, or the address-bar link while viewing an asset.');
      var targetId = parsed.versionId || parsed.viewId;
      if (!targetId) throw new Error('That link doesn’t point to a specific asset. Open the file in Frame.io, then copy the link again.');

      return listAccounts().then(function (accounts) {
        if (!accounts.length) throw new Error('This credential has no accessible Frame.io accounts.');
        return resolveFileAcrossAccounts(accounts, targetId).then(function (found) {
          if (!found) throw new Error('Could not find that asset in any accessible Frame.io account.');
          return { accountId: found.accountId, fileId: found.fileId, shareId: parsed.shareId };
        });
      });
    });
  }

  // The flat file object has no frame-rate field — it lives in a separate
  // technical-metadata resource. Best-effort: if this fails or the field
  // isn't present, toSeconds() below falls back to treating the comment's
  // frame number as if it were already seconds (better than nothing).
  function getAssetFrameRate(accountId, fileId) {
    return apiRequest('/accounts/' + accountId + '/files/' + fileId + '/metadata').then(function (json) {
      var entries = (json && json.data && json.data.metadata) || [];
      for (var i = 0; i < entries.length; i++) {
        if (String(entries[i].field_definition_name || '').toLowerCase() === 'frame rate') {
          var fps = Number(entries[i].value);
          if (fps > 0) return fps;
        }
      }
      return null;
    }).catch(function () { return null; });
  }

  function listAllComments(accountId, fileId) {
    var all = [];
    function page(after) {
      var qs = '?include=owner&page_size=50' + (after ? '&after=' + encodeURIComponent(after) : '');
      return apiRequest('/accounts/' + accountId + '/files/' + fileId + '/comments' + qs).then(function (json) {
        var data = (json && json.data) || [];
        all = all.concat(data);
        var next = json && json.links && json.links.next;
        if (next) return page(next);
        return all;
      });
    }
    return page(null);
  }

  // Confirmed against Frame.io's own migration guide and live data:
  // `timestamp` is a 1-indexed frame number ("the framestamp the comment
  // is left on (starting from 1), not the timestamp"), not seconds and
  // not tied to the AE composition's frame rate at all — it only ever
  // needs the asset's own frame rate to convert to real seconds.
  function toSeconds(comment, assetFrameRate) {
    var frame = comment.timestamp;
    if (frame === null || frame === undefined) return 0;
    if (assetFrameRate && assetFrameRate > 0) return (Number(frame) - 1) / Number(assetFrameRate);
    return Number(frame) || 0;
  }

  // ---------------------------------------------------------
  // Public: connection test + sync orchestration
  // ---------------------------------------------------------

  function testConnection() {
    return listAccounts().then(function (accounts) {
      return { ok: true, accountCount: accounts.length };
    });
  }

  function commentTitle(comment) {
    var author = (comment.owner && (comment.owner.name || comment.owner.email)) || 'Frame.io';
    return author;
  }

  function syncShareLink(url) {
    return resolveShareLink(url).then(function (resolved) {
      return getAssetFrameRate(resolved.accountId, resolved.fileId).then(function (assetFrameRate) {
        return listAllComments(resolved.accountId, resolved.fileId).then(function (comments) {
          var items = comments
            .filter(function (c) { return !c.parent_id; }) // top-level only
            .map(function (c) {
              return {
                commentId: c.id,
                shareId: resolved.shareId,
                title: commentTitle(c),
                note: c.text || '',
                timeSeconds: toSeconds(c, assetFrameRate)
              };
            });
          items.sort(function (a, b) { return a.timeSeconds - b.timeSeconds; });
          return { shareId: resolved.shareId, items: items, assetFrameRate: assetFrameRate };
        });
      });
    });
  }

  window.BBQCFrameIO = {
    isConnected: isConnected,
    beginSignIn: beginSignIn,
    disconnect: disconnect,
    testConnection: testConnection,
    syncShareLink: syncShareLink
  };
})();
