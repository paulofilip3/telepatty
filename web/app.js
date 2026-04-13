/* Telepatty — Web UI for tmux remote control */
(function () {
    'use strict';

    // --- State ---
    var token = localStorage.getItem('tp-token') || '';
    var wsConnections = [];     // array of { ws, target, el }
    var activeWindow = null;    // "session:winIdx" when viewing a window
    var focusedPane = null;     // target of pane that receives keyboard input
    var contextTarget = null;   // target for action sheet
    var treeData = [];
    var collapsedSessions = {}; // session name -> true if collapsed
    var autoScroll = true;
    var mediaRecorder = null;
    var audioChunks = [];
    var isRecording = false;

    // --- DOM refs ---
    var $ = function (s) { return document.querySelector(s); };
    var authScreen = $('#auth');
    var authInput = $('#auth-token');
    var authBtn = $('#auth-btn');
    var appEl = $('#app');
    var sidebar = $('#sidebar');
    var sidebarOverlay = $('#sidebar-overlay');
    var sidebarToggle = $('#sidebar-toggle');
    var treeEl = $('#tree');
    var terminalEl = $('#terminal');
    var headerTitle = $('#header-title');
    var zoomBtn = $('#zoom-btn');
    var themeBtn = $('#theme-btn');
    var inputText = $('#input-text');
    var sendBtn = $('#send-btn');
    var micBtn = $('#mic-btn');
    var paneActions = $('#pane-actions');
    var paneActionsTitle = $('#pane-actions-title');
    var windowActions = $('#window-actions');
    var windowActionsTitle = $('#window-actions-title');
    var newSessionBtn = $('#new-session-btn');

    // --- API helpers ---
    function apiUrl(path) {
        var base = location.origin;
        var sep = path.indexOf('?') !== -1 ? '&' : '?';
        return base + path + sep + 'token=' + encodeURIComponent(token);
    }

    async function api(method, path, params) {
        params = params || {};
        var qs = new URLSearchParams(params).toString();
        var fullPath = path;
        if (qs) fullPath += (path.indexOf('?') !== -1 ? '&' : '?') + qs;
        var url = apiUrl(fullPath);
        var res = await fetch(url, { method: method });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    }

    // --- Auth ---
    function tryAuth() {
        token = authInput.value.trim();
        if (!token) return;
        localStorage.setItem('tp-token', token);
        api('GET', '/api/tree').then(function (data) {
            authScreen.classList.add('hidden');
            appEl.classList.remove('hidden');
            treeData = data;
            renderTree();
            startTreePolling();
        }).catch(function () {
            authInput.value = '';
            authInput.placeholder = 'invalid token';
            authInput.focus();
        });
    }

    authBtn.addEventListener('click', tryAuth);
    authInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') tryAuth(); });
    if (token) { authInput.value = token; tryAuth(); }

    // --- Theme ---
    themeBtn.addEventListener('click', function () {
        var next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('tp-theme', next);
        document.querySelector('meta[name="theme-color"]').content = next === 'light' ? '#eff1f5' : '#1e1e2e';
    });

    // --- Sidebar ---
    function openSidebar() {
        sidebar.classList.add('open');
        sidebarOverlay.classList.remove('hidden');
        appEl.classList.add('sidebar-open');
    }
    function closeSidebar() {
        sidebar.classList.remove('open');
        sidebarOverlay.classList.add('hidden');
        appEl.classList.remove('sidebar-open');
    }
    sidebarToggle.addEventListener('click', function () {
        sidebar.classList.contains('open') ? closeSidebar() : openSidebar();
    });
    sidebarOverlay.addEventListener('click', closeSidebar);

    // --- Tree rendering (preserves collapsed state) ---
    function renderTree() {
        while (treeEl.firstChild) treeEl.removeChild(treeEl.firstChild);

        for (var si = 0; si < treeData.length; si++) {
            var session = treeData[si];
            var sessionDiv = document.createElement('div');
            sessionDiv.className = 'tree-session';
            if (collapsedSessions[session.name]) sessionDiv.classList.add('collapsed');

            var nameDiv = document.createElement('div');
            nameDiv.className = 'tree-session-name';
            nameDiv.innerHTML = '<svg viewBox="0 0 10 10"><path d="M2 2l4 3-4 3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
            var nameSpan = document.createElement('span');
            nameSpan.textContent = session.name;
            nameDiv.appendChild(nameSpan);
            sessionDiv.appendChild(nameDiv);

            nameDiv.addEventListener('click', (function (sn, sd) {
                return function () {
                    collapsedSessions[sn] = !collapsedSessions[sn];
                    sd.classList.toggle('collapsed');
                };
            })(session.name, sessionDiv));

            var windowsDiv = document.createElement('div');
            windowsDiv.className = 'tree-windows';

            for (var wi = 0; wi < session.windows.length; wi++) {
                var win = session.windows[wi];
                var winKey = session.name + ':' + win.index;
                var winDiv = document.createElement('div');
                winDiv.className = 'tree-window';
                if (activeWindow === winKey) winDiv.classList.add('active');

                var winName = document.createElement('div');
                winName.className = 'tree-window-name';

                var winLabel = document.createElement('span');
                winLabel.className = 'tree-window-label';
                winLabel.textContent = win.index + ': ' + win.name;
                winName.appendChild(winLabel);

                var winCtx = document.createElement('button');
                winCtx.className = 'tree-window-ctx';
                winCtx.textContent = '\u00B7\u00B7\u00B7';
                winCtx.dataset.winkey = winKey;
                winCtx.dataset.session = session.name;
                winName.appendChild(winCtx);

                winDiv.appendChild(winName);

                // Click window label -> connect to window
                winLabel.addEventListener('click', (function (wk, panes) {
                    return function () {
                        connectToWindow(wk, panes);
                        if (window.innerWidth < 768) closeSidebar();
                    };
                })(winKey, win.panes));

                // Window context menu
                winCtx.addEventListener('click', (function (wk, sn) {
                    return function (e) {
                        e.stopPropagation();
                        showWindowActions(wk, sn);
                    };
                })(winKey, session.name));

                for (var pi = 0; pi < win.panes.length; pi++) {
                    var pane = win.panes[pi];
                    var paneDiv = document.createElement('div');
                    paneDiv.className = 'tree-pane';
                    if (focusedPane === pane.target) paneDiv.classList.add('active');

                    var dot = document.createElement('span');
                    dot.className = 'tree-pane-dot';
                    paneDiv.appendChild(dot);

                    var cmd = document.createElement('span');
                    cmd.className = 'tree-pane-cmd';
                    cmd.textContent = pane.pane_index + ': ' + pane.current_command + (pane.zoomed ? ' [Z]' : '');
                    paneDiv.appendChild(cmd);

                    var ctxBtn = document.createElement('button');
                    ctxBtn.className = 'tree-pane-context-btn';
                    ctxBtn.textContent = '\u00B7\u00B7\u00B7';
                    paneDiv.appendChild(ctxBtn);

                    // Click pane -> focus it (and connect to its window)
                    paneDiv.addEventListener('click', (function (target, wk, panes) {
                        return function (e) {
                            if (e.target.closest('.tree-pane-context-btn')) return;
                            connectToWindow(wk, panes, target);
                            if (window.innerWidth < 768) closeSidebar();
                        };
                    })(pane.target, winKey, win.panes));

                    // Pane context menu
                    ctxBtn.addEventListener('click', (function (target) {
                        return function (e) {
                            e.stopPropagation();
                            showPaneActions(target);
                        };
                    })(pane.target));

                    winDiv.appendChild(paneDiv);
                }
                windowsDiv.appendChild(winDiv);
            }
            sessionDiv.appendChild(windowsDiv);
            treeEl.appendChild(sessionDiv);
        }
    }

    var treeInterval = null;
    function startTreePolling() {
        if (treeInterval) clearInterval(treeInterval);
        treeInterval = setInterval(async function () {
            try {
                treeData = await api('GET', '/api/tree');
                renderTree();
            } catch (e) { /* ignore */ }
        }, 3000);
    }

    // --- Close all WebSocket connections ---
    function closeAllWs() {
        for (var i = 0; i < wsConnections.length; i++) {
            try { wsConnections[i].ws.close(); } catch (e) {}
        }
        wsConnections = [];
    }

    // --- Connect to a window (show all panes or zoomed pane) ---
    function connectToWindow(winKey, panes, focusTarget) {
        closeAllWs();
        activeWindow = winKey;
        headerTitle.textContent = winKey;
        zoomBtn.classList.remove('hidden');

        // If a pane is zoomed, show only that pane
        var zoomed = null;
        for (var i = 0; i < panes.length; i++) {
            if (panes[i].zoomed) { zoomed = panes[i]; break; }
        }

        var visiblePanes = zoomed ? [zoomed] : panes;

        // Set focus to requested pane, or active pane, or first pane
        if (focusTarget) {
            focusedPane = focusTarget;
        } else {
            focusedPane = null;
            for (var i = 0; i < visiblePanes.length; i++) {
                if (visiblePanes[i].active) { focusedPane = visiblePanes[i].target; break; }
            }
            if (!focusedPane) focusedPane = visiblePanes[0].target;
        }

        renderTree();

        // Clear terminal
        while (terminalEl.firstChild) terminalEl.removeChild(terminalEl.firstChild);

        if (visiblePanes.length === 1) {
            // Single pane — render directly in terminal div
            terminalEl.className = 'terminal';
            openPaneWs(visiblePanes[0].target, terminalEl);
        } else {
            // Multi-pane — calculate layout from pane positions
            terminalEl.className = 'terminal terminal-multi';
            var totalW = 0, totalH = 0;
            for (var i = 0; i < visiblePanes.length; i++) {
                var p = visiblePanes[i];
                totalW = Math.max(totalW, p.left + p.width);
                totalH = Math.max(totalH, p.top + p.height);
            }
            for (var i = 0; i < visiblePanes.length; i++) {
                var p = visiblePanes[i];
                var cell = document.createElement('div');
                cell.className = 'pane-cell';
                if (p.target === focusedPane) cell.classList.add('pane-focused');
                cell.style.left = (p.left / totalW * 100) + '%';
                cell.style.top = (p.top / totalH * 100) + '%';
                cell.style.width = (p.width / totalW * 100) + '%';
                cell.style.height = (p.height / totalH * 100) + '%';
                cell.dataset.target = p.target;
                terminalEl.appendChild(cell);

                // Click to focus
                cell.addEventListener('click', (function (target) {
                    return function () {
                        focusedPane = target;
                        var cells = terminalEl.querySelectorAll('.pane-cell');
                        for (var j = 0; j < cells.length; j++) {
                            cells[j].classList.toggle('pane-focused', cells[j].dataset.target === target);
                        }
                        renderTree();
                    };
                })(p.target));

                openPaneWs(p.target, cell);
            }
        }
    }

    // --- Open a WebSocket for a single pane, render into el ---
    function openPaneWs(target, el) {
        var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        var url = proto + '//' + location.host + '/ws/terminal?target=' +
            encodeURIComponent(target) + '&token=' + encodeURIComponent(token);
        var ws = new WebSocket(url);
        var conn = { ws: ws, target: target, el: el };
        wsConnections.push(conn);

        ws.onopen = function () { autoScroll = true; };
        ws.onmessage = function (e) {
            var msg = JSON.parse(e.data);
            if (msg.type === 'content') {
                renderTerminalContent(el, msg.data);
            }
        };
        ws.onclose = function () {
            if (activeWindow && conn.el.parentNode) {
                var disc = document.createElement('div');
                disc.style.cssText = 'color:var(--overlay0);padding:8px;';
                disc.textContent = '-- disconnected --';
                conn.el.appendChild(disc);
            }
        };
        ws.onerror = function () { ws.close(); };
    }

    // --- ANSI parser ---
    var ANSI_COLORS = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];

    function parseAnsi(text) {
        var spans = [];
        var cur = { text: '', classes: [], fg: null, bg: null, fgS: null, bgS: null };
        var i = 0;

        function push() {
            if (cur.text) spans.push({ text: cur.text, classes: cur.classes.slice(), fg: cur.fg, bg: cur.bg, fgS: cur.fgS, bgS: cur.bgS });
            cur = { text: '', classes: cur.classes.slice(), fg: cur.fg, bg: cur.bg, fgS: cur.fgS, bgS: cur.bgS };
        }

        while (i < text.length) {
            if (text[i] === '\x1b' && text[i + 1] === '[') {
                push();
                var j = i + 2;
                while (j < text.length && !/[mHJKABCD]/.test(text[j])) j++;
                if (j < text.length && text[j] === 'm') {
                    var params = text.substring(i + 2, j).split(';').map(Number);
                    applySgr(params, cur);
                }
                i = j + 1;
            } else {
                cur.text += text[i];
                i++;
            }
        }
        push();
        return spans;
    }

    function applySgr(params, s) {
        var k = 0;
        while (k < params.length) {
            var p = params[k];
            if (p === 0) { s.classes = []; s.fg = null; s.bg = null; s.fgS = null; s.bgS = null; }
            else if (p === 1) addU(s.classes, 'ansi-bold');
            else if (p === 2) addU(s.classes, 'ansi-dim');
            else if (p === 3) addU(s.classes, 'ansi-italic');
            else if (p === 4) addU(s.classes, 'ansi-underline');
            else if (p === 9) addU(s.classes, 'ansi-strikethrough');
            else if (p >= 30 && p <= 37) { s.fg = 'ansi-fg-' + ANSI_COLORS[p - 30]; s.fgS = null; }
            else if (p === 39) { s.fg = null; s.fgS = null; }
            else if (p >= 40 && p <= 47) { s.bg = 'ansi-bg-' + ANSI_COLORS[p - 40]; s.bgS = null; }
            else if (p === 49) { s.bg = null; s.bgS = null; }
            else if (p >= 90 && p <= 97) { s.fg = 'ansi-fg-bright-' + ANSI_COLORS[p - 90]; s.fgS = null; }
            else if (p >= 100 && p <= 107) { s.bg = 'ansi-bg-bright-' + ANSI_COLORS[p - 100]; s.bgS = null; }
            else if (p === 38 && params[k + 1] === 2) { s.fg = null; s.fgS = 'color:rgb(' + params[k + 2] + ',' + params[k + 3] + ',' + params[k + 4] + ')'; k += 4; }
            else if (p === 48 && params[k + 1] === 2) { s.bg = null; s.bgS = 'background:rgb(' + params[k + 2] + ',' + params[k + 3] + ',' + params[k + 4] + ')'; k += 4; }
            else if (p === 38 && params[k + 1] === 5) { s.fg = null; s.fgS = 'color:' + c256(params[k + 2]); k += 2; }
            else if (p === 48 && params[k + 1] === 5) { s.bg = null; s.bgS = 'background:' + c256(params[k + 2]); k += 2; }
            k++;
        }
    }

    function addU(a, v) { if (a.indexOf(v) === -1) a.push(v); }

    function c256(n) {
        if (n < 16) return ['#45475a','#f38ba8','#a6e3a1','#f9e2af','#89b4fa','#cba6f7','#94e2d5','#cdd6f4','#6c7086','#eba0ac','#a6e3a1','#f9e2af','#74c7ec','#f5c2e7','#89dceb','#cdd6f4'][n];
        if (n >= 232) { var g = 8 + (n - 232) * 10; return 'rgb(' + g + ',' + g + ',' + g + ')'; }
        n -= 16; var r = Math.floor(n / 36), g = Math.floor((n % 36) / 6), b = n % 6;
        return 'rgb(' + (r ? 55 + r * 40 : 0) + ',' + (g ? 55 + g * 40 : 0) + ',' + (b ? 55 + b * 40 : 0) + ')';
    }

    function renderTerminalContent(el, content) {
        var atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
        var lines = content.split('\n');
        var frag = document.createDocumentFragment();
        for (var li = 0; li < lines.length; li++) {
            var lineEl = document.createElement('div');
            lineEl.style.minHeight = '1.4em';
            var spans = parseAnsi(lines[li]);
            for (var si = 0; si < spans.length; si++) {
                var sp = spans[si];
                if (!sp.text) continue;
                var cls = sp.classes.slice();
                if (sp.fg) cls.push(sp.fg);
                if (sp.bg) cls.push(sp.bg);
                var sty = (sp.fgS ? sp.fgS + ';' : '') + (sp.bgS ? sp.bgS + ';' : '');
                if (cls.length || sty) {
                    var el2 = document.createElement('span');
                    if (cls.length) el2.className = cls.join(' ');
                    if (sty) el2.style.cssText = sty;
                    el2.textContent = sp.text;
                    lineEl.appendChild(el2);
                } else {
                    lineEl.appendChild(document.createTextNode(sp.text));
                }
            }
            frag.appendChild(lineEl);
        }
        while (el.firstChild) el.removeChild(el.firstChild);
        el.appendChild(frag);
        if (atBottom || autoScroll) el.scrollTop = el.scrollHeight;
    }

    terminalEl.addEventListener('scroll', function () {
        autoScroll = terminalEl.scrollHeight - terminalEl.scrollTop - terminalEl.clientHeight < 30;
    });

    // --- Input ---
    // Enter: send text + Enter key to tmux. Shift+Enter / Alt+Enter: newline in textarea.
    function sendInput() {
        var text = inputText.value;
        if (!focusedPane) return;
        var conn = wsConnections.find(function (c) { return c.target === focusedPane; });
        if (!conn || conn.ws.readyState !== WebSocket.OPEN) return;
        if (text) conn.ws.send(JSON.stringify({ type: 'keys', data: text }));
        conn.ws.send(JSON.stringify({ type: 'special', data: 'Enter' }));
        inputText.value = '';
    }

    sendBtn.addEventListener('click', sendInput);
    inputText.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
            e.preventDefault();
            sendInput();
        }
        // Shift+Enter and Alt+Enter insert newline naturally (default textarea behavior)
    });

    // --- Esc closes action sheets ---
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            paneActions.classList.add('hidden');
            windowActions.classList.add('hidden');
        }
    });

    // --- Zoom ---
    zoomBtn.addEventListener('click', async function () {
        if (!focusedPane) return;
        try {
            await api('POST', '/api/zoom', { target: focusedPane });
            // Refresh and reconnect
            treeData = await api('GET', '/api/tree');
            renderTree();
            if (activeWindow) {
                var parts = activeWindow.split(':');
                var sess = findSession(parts[0]);
                if (sess) {
                    var win = sess.windows.find(function (w) { return w.index === parts[1]; });
                    if (win) connectToWindow(activeWindow, win.panes, focusedPane);
                }
            }
        } catch (e) { /* ignore */ }
    });

    function findSession(name) {
        for (var i = 0; i < treeData.length; i++) {
            if (treeData[i].name === name) return treeData[i];
        }
        return null;
    }

    // --- Pane action sheet ---
    function showPaneActions(target) {
        contextTarget = target;
        paneActionsTitle.textContent = target;
        paneActions.classList.remove('hidden');
    }

    paneActions.querySelector('.action-sheet-backdrop').addEventListener('click', function () {
        paneActions.classList.add('hidden');
    });

    paneActions.querySelectorAll('.action-sheet-btn').forEach(function (btn) {
        btn.addEventListener('click', async function () {
            var action = btn.dataset.action;
            paneActions.classList.add('hidden');
            if (action === 'cancel' || !contextTarget) return;
            var target = contextTarget;
            try {
                if (action === 'split-v') await api('POST', '/api/split', { target: target, horizontal: 'false' });
                else if (action === 'split-h') await api('POST', '/api/split', { target: target, horizontal: 'true' });
                else if (action === 'zoom') await api('POST', '/api/zoom', { target: target });
                else if (action === 'kill-pane') {
                    await api('DELETE', '/api/pane', { target: target });
                    if (focusedPane === target) disconnectAll();
                }
                treeData = await api('GET', '/api/tree');
                renderTree();
                // Reconnect to window to refresh pane layout
                if (activeWindow) {
                    var parts = activeWindow.split(':');
                    var sess = findSession(parts[0]);
                    if (sess) {
                        var win = sess.windows.find(function (w) { return w.index === parts[1]; });
                        if (win) connectToWindow(activeWindow, win.panes);
                    }
                }
            } catch (e) { console.error('Action failed:', e); }
        });
    });

    // --- Window action sheet ---
    function showWindowActions(winKey, sessionName) {
        contextTarget = { winKey: winKey, session: sessionName };
        windowActionsTitle.textContent = winKey;
        windowActions.classList.remove('hidden');
    }

    windowActions.querySelector('.action-sheet-backdrop').addEventListener('click', function () {
        windowActions.classList.add('hidden');
    });

    windowActions.querySelectorAll('.action-sheet-btn').forEach(function (btn) {
        btn.addEventListener('click', async function () {
            var action = btn.dataset.action;
            windowActions.classList.add('hidden');
            if (action === 'cancel' || !contextTarget) return;
            var ctx = contextTarget;
            try {
                if (action === 'new-window') await api('POST', '/api/window', { session: ctx.session });
                else if (action === 'kill-window') {
                    await api('DELETE', '/api/window', { target: ctx.winKey });
                    if (activeWindow === ctx.winKey) disconnectAll();
                }
                else if (action === 'kill-session') {
                    await api('DELETE', '/api/session', { name: ctx.session });
                    if (activeWindow && activeWindow.startsWith(ctx.session + ':')) disconnectAll();
                }
                treeData = await api('GET', '/api/tree');
                renderTree();
            } catch (e) { console.error('Action failed:', e); }
        });
    });

    function disconnectAll() {
        closeAllWs();
        activeWindow = null;
        focusedPane = null;
        headerTitle.textContent = 'telepatty';
        zoomBtn.classList.add('hidden');
        while (terminalEl.firstChild) terminalEl.removeChild(terminalEl.firstChild);
        terminalEl.className = 'terminal';
        var ph = document.createElement('div');
        ph.className = 'terminal-placeholder';
        var p = document.createElement('p');
        p.textContent = 'select a pane from the sidebar';
        ph.appendChild(p);
        terminalEl.appendChild(ph);
    }

    // --- New session ---
    newSessionBtn.addEventListener('click', async function () {
        var name = prompt('Session name:');
        if (!name) return;
        try {
            await api('POST', '/api/session', { name: name });
            treeData = await api('GET', '/api/tree');
            renderTree();
        } catch (e) { console.error('Failed to create session:', e); }
    });

    // --- Voice input ---
    async function startRecording() {
        try {
            var stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            audioChunks = [];
            mediaRecorder = new MediaRecorder(stream, { mimeType: getSupportedMimeType() });
            mediaRecorder.ondataavailable = function (e) { if (e.data.size > 0) audioChunks.push(e.data); };
            mediaRecorder.onstop = async function () {
                stream.getTracks().forEach(function (t) { t.stop(); });
                await transcribeAudio(new Blob(audioChunks, { type: mediaRecorder.mimeType }));
            };
            mediaRecorder.start();
            isRecording = true;
            micBtn.classList.add('recording');
        } catch (e) { console.error('Mic access denied:', e); }
    }

    function stopRecording() {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
        isRecording = false;
        micBtn.classList.remove('recording');
    }

    function getSupportedMimeType() {
        var types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
        for (var i = 0; i < types.length; i++) { if (MediaRecorder.isTypeSupported(types[i])) return types[i]; }
        return '';
    }

    async function transcribeAudio(blob) {
        var form = new FormData();
        form.append('audio', blob, 'voice.webm');
        try {
            var res = await fetch(apiUrl('/api/transcribe'), { method: 'POST', body: form });
            if (!res.ok) return;
            var data = await res.json();
            if (data.text) { inputText.value = (inputText.value ? inputText.value + ' ' : '') + data.text; inputText.focus(); }
        } catch (e) { console.error('Transcription error:', e); }
    }

    var micHoldTimer = null, micHeld = false;
    micBtn.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        if (isRecording) { stopRecording(); return; }
        micHeld = false;
        micHoldTimer = setTimeout(function () { micHeld = true; startRecording(); }, 200);
    });
    micBtn.addEventListener('pointerup', function (e) {
        e.preventDefault(); clearTimeout(micHoldTimer);
        if (micHeld && isRecording) stopRecording();
        else if (!micHeld && !isRecording) startRecording();
    });
    micBtn.addEventListener('pointerleave', function () {
        clearTimeout(micHoldTimer);
        if (micHeld && isRecording) stopRecording();
    });
})();
