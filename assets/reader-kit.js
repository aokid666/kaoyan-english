/* 阅读增强工具：全文搜索 · 内容编辑并保存 · 便签定位笔记
   纯前端实现（localStorage + 可选 GitHub 云端保存），无后端依赖。 */
(function () {
  'use strict';
  if (window.__nkReaderKit) return;
  window.__nkReaderKit = true;

  var CFG = { owner: 'aokid666', repo: 'kaoyan-english', path: 'writing-notes-5.html', branch: 'main' };
  var NS = 'nk:' + location.pathname + ':';
  var LS = {
    get: function (k) { try { return localStorage.getItem(NS + k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(NS + k, v); return true; } catch (e) { return false; } },
    del: function (k) { try { localStorage.removeItem(NS + k); } catch (e) { } }
  };
  var sheets = [].slice.call(document.querySelectorAll('section.sheet'));
  var state = { editing: false, noteMode: false, notes: [], matches: [], midx: -1, pending: null, editId: null };

  /* ---------- 工具 ---------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return [].slice.call((r || document).querySelectorAll(s)); }
  function toast(msg, ms) {
    var t = $('#nk-toast'); if (!t) return;
    t.textContent = msg; t.classList.add('nk-show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove('nk-show'); }, ms || 2200);
  }
  function sectionText(sec) {
    var out = '', w = document.createTreeWalker(sec, NodeFilter.SHOW_TEXT, null), n;
    while ((n = w.nextNode())) out += n.nodeValue;
    return out;
  }
  // 绝对偏移 -> 文本节点 + 偏移
  function locate(sec, abs) {
    var acc = 0, w = document.createTreeWalker(sec, NodeFilter.SHOW_TEXT, null), n;
    while ((n = w.nextNode())) {
      var len = n.nodeValue.length;
      if (acc + len >= abs) return { node: n, offset: abs - acc };
      acc += len;
    }
    return null;
  }
  // 文本节点+偏移 -> 绝对偏移
  function absOf(sec, node, offset) {
    var acc = 0, w = document.createTreeWalker(sec, NodeFilter.SHOW_TEXT, null), n;
    while ((n = w.nextNode())) {
      if (n === node) return acc + Math.min(offset, n.nodeValue.length);
      acc += n.nodeValue.length;
    }
    return acc;
  }
  function countOcc(text, sn, before) {
    var k = 0, from = 0;
    while (true) { var i = text.indexOf(sn, from); if (i < 0 || i >= before) return k; k++; from = i + 1; }
  }

  /* ---------- 界面骨架 ---------- */
  var root = document.createElement('div');
  root.id = 'nk-root';
  root.innerHTML =
    '<button id="nk-fab" aria-label="阅读工具">☰<span class="nk-badge"></span></button>' +
    '<div id="nk-panel">' +
      '<div class="nk-row" data-act="search"><span class="nk-ic">🔍</span><span class="nk-lab">全文搜索</span></div>' +
      '<div class="nk-bar" id="nk-sbar">' +
        '<input class="nk-input" id="nk-q" placeholder="输入关键词 / 英文单词…" autocomplete="off">' +
        '<div class="nk-inline"><span class="nk-count" id="nk-qc">输入后自动定位</span>' +
          '<button class="nk-btn ghost" data-act="next">下一个 ↓</button>' +
          '<button class="nk-btn ghost" data-act="prev">↑ 上一个</button>' +
        '</div>' +
      '</div>' +
      '<div class="nk-sep"></div>' +
      '<div class="nk-row" data-act="edit"><span class="nk-ic">✏️</span><span class="nk-lab">编辑内容<span class="nk-sub" id="nk-estate">　点击开启</span></span></div>' +
      '<div class="nk-bar" id="nk-ebar">' +
        '<div class="nk-hint">正文可直接改字、改句、删段。改动<b>自动存在这台设备的浏览器里</b>，刷新不丢；想让所有人都看到，用下面的「云端保存」。</div>' +
        '<div class="nk-inline"><button class="nk-btn" data-act="edit-done">完成编辑</button>' +
        '<button class="nk-btn ghost" data-act="edit-reset">恢复原始版本</button></div>' +
      '</div>' +
      '<div class="nk-sep"></div>' +
      '<div class="nk-row" data-act="note"><span class="nk-ic">📌</span><span class="nk-lab">便签 / 定位笔记<span class="nk-sub" id="nk-ncount">　0 条</span></span></div>' +
      '<div class="nk-bar" id="nk-nbar">' +
        '<div class="nk-hint" id="nk-nhint">点下面的按钮开始：进入便签模式后，<b>点正文里任意位置</b>即可在那里钉一条笔记。</div>' +
        '<div class="nk-inline"><button class="nk-btn" data-act="note-mode" id="nk-nmodebtn">开始标注</button>' +
        '<button class="nk-btn ghost" data-act="note-clear">清除全部便签</button></div>' +
      '</div>' +
      '<div id="nk-notes"></div>' +
      '<div id="nk-nedit" class="nk-bar">' +
        '<div class="nk-hint" id="nk-neanchor">—</div>' +
        '<textarea class="nk-input" id="nk-ntext" rows="4" placeholder="写下你的笔记 / 提醒 / 易错点…"></textarea>' +
        '<div class="nk-inline"><button class="nk-btn" data-act="note-save">保存便签</button>' +
        '<button class="nk-btn ghost" data-act="note-del">删除</button>' +
        '<button class="nk-btn ghost" data-act="note-cancel">取消</button></div>' +
      '</div>' +
      '<div class="nk-sep"></div>' +
      '<div class="nk-row" data-act="backup"><span class="nk-ic">💾</span><span class="nk-lab">备份 / 恢复</span></div>' +
      '<div class="nk-bar" id="nk-bbar">' +
        '<div class="nk-hint">导出一个 JSON 文件，可换设备导入；也可用于清空前的留档。</div>' +
        '<div class="nk-inline"><button class="nk-btn" data-act="export">导出备份</button>' +
        '<button class="nk-btn ghost" data-act="import">导入备份</button>' +
        '<button class="nk-btn ghost" data-act="wipe">清空本机改动</button></div>' +
        '<input type="file" id="nk-file" accept=".json,application/json" style="display:none">' +
      '</div>' +
      '<div class="nk-sep"></div>' +
      '<div class="nk-row" data-act="cloud"><span class="nk-ic">☁️</span><span class="nk-lab">云端保存<span class="nk-sub" id="nk-cstate">　未设置</span></span></div>' +
      '<div class="nk-bar" id="nk-cbar">' +
        '<div class="nk-hint">把当前网页内容（含便签）存回服务器，手机 / 电脑 / 同学打开都看到同一版。需要一次性填入 GitHub 令牌，只保存在本机浏览器里。</div>' +
        '<input class="nk-input" id="nk-token" type="password" placeholder="GitHub 令牌 ghp_…" autocomplete="off">' +
        '<div class="nk-inline"><button class="nk-btn" data-act="cloud-save">保存到服务器</button>' +
        '<button class="nk-btn ghost" data-act="cloud-forget">清除令牌</button></div>' +
      '</div>' +
      '<div class="nk-sep"></div>' +
      '<div class="nk-row" data-act="top"><span class="nk-ic">↑</span><span class="nk-lab">回到顶部</span></div>' +
    '</div>' +
    '<div id="nk-toast"></div>';
  document.body.appendChild(root);

  var fab = $('#nk-fab'), panel = $('#nk-panel'), badge = $('.nk-badge', fab);
  function togglePanel(force) {
    var open = force === undefined ? !panel.classList.contains('nk-open') : force;
    panel.classList.toggle('nk-open', open);
  }
  fab.addEventListener('click', function () { togglePanel(); });
  function toggleBar(id, force) {
    var b = $('#' + id);
    var open = force === undefined ? !b.classList.contains('nk-open') : force;
    b.classList.toggle('nk-open', open);
    return open;
  }

  /* ---------- 搜索 ---------- */
  var qInput = $('#nk-q'), qCount = $('#nk-qc');
  function clearHits() {
    $$('mark.nk-hit').forEach(function (m) {
      var p = m.parentNode; p.replaceChild(document.createTextNode(m.textContent), m); p.normalize();
    });
    state.matches = []; state.midx = -1;
  }
  function search(q) {
    clearHits();
    if (!q || q.length < 1) { qCount.textContent = '输入后自动定位'; return; }
    var ql = q.toLowerCase(), hits = [];
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        if (n.parentNode && n.parentNode.closest && n.parentNode.closest('#nk-root')) return NodeFilter.FILTER_REJECT;
        var pn = n.parentNode ? n.parentNode.nodeName : '';
        if (pn === 'SCRIPT' || pn === 'STYLE' || pn === 'TEXTAREA') return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var nodes = [], n;
    while ((n = walker.nextNode())) nodes.push(n);
    nodes.forEach(function (node) {
      var v = node.nodeValue, lv = v.toLowerCase(), i = lv.indexOf(ql);
      if (i < 0) return;
      var frag = document.createDocumentFragment(), pos = 0;
      while (i >= 0) {
        if (i > pos) frag.appendChild(document.createTextNode(v.slice(pos, i)));
        var m = document.createElement('mark');
        m.className = 'nk-hit'; m.textContent = v.slice(i, i + q.length);
        frag.appendChild(m);
        pos = i + q.length;
        i = lv.indexOf(ql, pos);
      }
      if (pos < v.length) frag.appendChild(document.createTextNode(v.slice(pos)));
      node.parentNode.replaceChild(frag, node);
    });
    state.matches = $$('mark.nk-hit');
    if (!state.matches.length) { qCount.textContent = '没有找到「' + q + '」'; return; }
    state.midx = -1; gotoHit(0);
    qCount.textContent = '共 ' + state.matches.length + ' 处';
  }
  function gotoHit(i) {
    if (!state.matches.length) return;
    state.matches.forEach(function (m) { m.classList.remove('cur'); });
    state.midx = (i + state.matches.length) % state.matches.length;
    var m = state.matches[state.midx];
    m.classList.add('cur');
    var y = m.getBoundingClientRect().top + window.pageYOffset - 120;
    window.scrollTo({ top: y, behavior: 'smooth' });
    qCount.textContent = '第 ' + (state.midx + 1) + ' / ' + state.matches.length + ' 处';
  }
  var qtimer = null;
  qInput.addEventListener('input', function () {
    clearTimeout(qtimer);
    var v = qInput.value.trim();
    qtimer = setTimeout(function () { search(v); }, 260);
  });
  qInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); search(qInput.value.trim()); }
  });

  /* ---------- 编辑 ---------- */
  function saveContent(silent) {
    var data = { t: Date.now(), html: sheets.map(function (s) { return s.innerHTML; }) };
    var ok = LS.set('content', JSON.stringify(data));
    $('#nk-estate').textContent = ok ? '　已保存 ' + new Date().toLocaleTimeString().slice(0, 5) : '　保存失败';
    if (!silent) toast(ok ? '已保存到本机浏览器' : '保存失败（可能是隐私模式）');
  }
  var savetimer = null;
  function scheduleSave() {
    $('#nk-estate').textContent = '　编辑中…';
    clearTimeout(savetimer);
    savetimer = setTimeout(function () { saveContent(true); }, 600);
  }
  function setEdit(on) {
    state.editing = on;
    document.body.classList.toggle('nk-editing', on);
    sheets.forEach(function (s) {
      if (on) { s.setAttribute('contenteditable', 'true'); }
      else { s.removeAttribute('contenteditable'); }
    });
    $('#nk-estate').textContent = on ? '　编辑中' : '　点击开启';
    toggleBar('nk-ebar', on);
    if (on) { clearHits(); togglePanel(true); toast('编辑模式已开：直接改正文，自动保存', 2600); }
    else { saveContent(true); toast('编辑结束，已保存', 1800); }
  }
  document.addEventListener('input', function (e) {
    if (!state.editing) return;
    if (e.target && e.target.closest && e.target.closest('#nk-root')) return;
    scheduleSave();
  });

  /* ---------- 便签 / 定位笔记 ---------- */
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function loadNotes() { try { state.notes = JSON.parse(LS.get('notes') || '[]') || []; } catch (e) { state.notes = []; } }
  function saveNotes() { LS.set('notes', JSON.stringify(state.notes)); noteCount(); renderNotes(); renderMarkers(); }
  function noteCount() {
    $('#nk-ncount').textContent = '　' + state.notes.length + ' 条';
    badge.textContent = state.notes.length;
    badge.style.display = state.notes.length ? 'block' : 'none';
  }
  function resolveNote(n) {
    var sec = sheets[n.sec]; if (!sec || !n.snippet) return null;
    var t = sectionText(sec), from = 0, k = 0, idx = -1;
    while (true) {
      var i = t.indexOf(n.snippet, from);
      if (i < 0) break;
      if (k === n.occ) { idx = i; break; }
      k++; from = i + 1;
    }
    if (idx < 0) idx = t.indexOf(n.snippet);
    if (idx < 0) return null;
    return { sec: sec, abs: idx };
  }
  function renderMarkers() {
    $$('.nk-marker').forEach(function (m) { m.parentNode.removeChild(m); });
    state.notes.forEach(function (n) {
      var r = resolveNote(n); n._dead = !r;
      if (!r) return;
      var loc = locate(r.sec, r.abs); if (!loc) { n._dead = true; return; }
      var span = document.createElement('span');
      span.className = 'nk-marker'; span.setAttribute('data-id', n.id); span.setAttribute('title', '便签');
      var rng = document.createRange();
      rng.setStart(loc.node, loc.offset); rng.setEnd(loc.node, loc.offset);
      rng.insertNode(span);
    });
  }
  function renderNotes() {
    var box = $('#nk-notes');
    if (!state.notes.length) { box.innerHTML = '<div class="nk-hint">还没有便签。</div>'; return; }
    var sorted = state.notes.slice().sort(function (a, b) { return (a.sec - b.sec) || (a.ts - b.ts); });
    box.innerHTML = sorted.map(function (n) {
      return '<div class="nk-note' + (n._dead ? ' nk-dead' : '') + '" data-nid="' + n.id + '">' +
        '<div class="nk-nq">' + (n._dead ? '⚠ 位置已变化 · ' : '📍 ') + esc((n.snippet || '').slice(0, 26)) + '…</div>' +
        '<div class="nk-nt">' + esc(n.text).replace(/\n/g, '<br>') + '</div>' +
        '<div class="nk-ops">' +
          '<button class="nk-btn ghost" data-act="note-jump" data-id="' + n.id + '">定位</button>' +
          '<button class="nk-btn ghost" data-act="note-edit" data-id="' + n.id + '">修改</button>' +
          '<button class="nk-btn ghost" data-act="note-remove" data-id="' + n.id + '">删除</button>' +
        '</div></div>';
    }).join('');
  }
  function beginNote(x, y) {
    var rng = document.caretRangeFromPoint ? document.caretRangeFromPoint(x, y) : null;
    if (!rng || !rng.startContainer || rng.startContainer.nodeType !== 3) { toast('请点在正文的文字上'); return; }
    var sec = null;
    for (var i = 0; i < sheets.length; i++) { if (sheets[i].contains(rng.startContainer)) { sec = sheets[i]; break; } }
    if (!sec) { toast('请点在正文的文字上'); return; }
    var abs = absOf(sec, rng.startContainer, rng.startOffset);
    var t = sectionText(sec), snip = t.substr(abs, 36);
    if (!snip.trim()) { toast('这里没有文字，换个位置点'); return; }
    state.pending = { sec: sheets.indexOf(sec), snippet: snip, occ: countOcc(t, snip, abs) };
    state.editId = null;
    $('#nk-neanchor').innerHTML = '新便签锚定在：<b>' + esc(snip.slice(0, 30)) + '…</b>';
    $('#nk-ntext').value = '';
    toggleBar('nk-nedit', true);
    togglePanel(true);
    $('#nk-nedit').scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  function openNote(id) {
    var n = state.notes.filter(function (x) { return x.id === id; })[0];
    if (!n) return;
    state.editId = id; state.pending = null;
    $('#nk-neanchor').innerHTML = '修改便签 · 锚定在：<b>' + esc((n.snippet || '').slice(0, 30)) + '…</b>';
    $('#nk-ntext').value = n.text;
    toggleBar('nk-nedit', true);
    togglePanel(true);
    $('#nk-nedit').scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  function saveNoteFromEditor() {
    var text = $('#nk-ntext').value.trim();
    if (!text) { toast('便签内容是空的'); return; }
    if (state.editId) {
      var n = state.notes.filter(function (x) { return x.id === state.editId; })[0];
      if (n) { n.text = text; n.ts = Date.now(); }
    } else if (state.pending) {
      state.notes.push({
        id: 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        sec: state.pending.sec, snippet: state.pending.snippet, occ: state.pending.occ,
        text: text, ts: Date.now()
      });
    }
    state.pending = null; state.editId = null;
    $('#nk-ntext').value = '';
    toggleBar('nk-nedit', false); toggleBar('nk-nbar', true);
    saveNotes(); toast('便签已保存', 1800);
  }
  function toggleNoteMode() {
    state.noteMode = !state.noteMode;
    document.body.classList.toggle('nk-notemode', state.noteMode);
    $('#nk-nmodebtn').textContent = state.noteMode ? '退出标注模式' : '开始标注';
    $('#nk-nhint').innerHTML = state.noteMode
      ? '<b>标注模式已开：点正文任意位置</b>就能在那里钉一条便签；点已有 📌 可修改。'
      : '点下面的按钮开始：进入便签模式后，<b>点正文里任意位置</b>即可在那里钉一条笔记。';
    if (state.noteMode) { setEdit(false); togglePanel(false); toast('标注模式：点正文任意位置加便签', 2600); }
  }

  /* 内容区点击：标注 / 打开便签 */
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (t.closest && t.closest('#nk-root')) return;
    var mk = t.closest ? t.closest('.nk-marker') : null;
    if (mk) { e.preventDefault(); openNote(mk.getAttribute('data-id')); return; }
    if (state.noteMode) { e.preventDefault(); e.stopPropagation(); beginNote(e.clientX, e.clientY); }
  }, true);

  /* ---------- 备份 / 恢复 ---------- */
  function exportData() {
    var data = {
      app: 'nk-reader-kit', title: document.title, url: location.href,
      exportedAt: new Date().toISOString(),
      content: sheets.map(function (s) { return s.innerHTML; }),
      notes: state.notes
    };
    var blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '写作笔记5-我的标注-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.parentNode && a.parentNode.removeChild(a); }, 5000);
    toast('已导出备份文件', 2600);
  }
  function applyBackup(data) {
    if (data && data.content && data.content.length === sheets.length) {
      data.content.forEach(function (h, i) { sheets[i].innerHTML = h; });
      LS.set('content', JSON.stringify({ t: Date.now(), html: data.content }));
    }
    if (data && data.notes && data.notes.length) {
      var ids = {};
      state.notes.forEach(function (n) { ids[n.id] = 1; });
      data.notes.forEach(function (n) { if (n && n.id && !ids[n.id]) state.notes.push(n); });
      LS.set('notes', JSON.stringify(state.notes));
    }
    noteCount(); renderNotes(); renderMarkers();
  }
  $('#nk-file').addEventListener('change', function (e) {
    var f = e.target.files && e.target.files[0]; if (!f) return;
    var r = new FileReader();
    r.onload = function () {
      try { applyBackup(JSON.parse(r.result)); toast('备份已导入', 2400); }
      catch (err) { toast('导入失败：文件格式不对', 2600); }
    };
    r.readAsText(f);
    e.target.value = '';
  });

  /* ---------- 云端保存（GitHub Contents API） ---------- */
  function b64(str) {
    var bytes = new TextEncoder().encode(str), s = '', CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(s);
  }
  function serializePage() {
    var clone = document.documentElement.cloneNode(true);
    var ui = clone.querySelector('#nk-root'); if (ui) ui.parentNode.removeChild(ui);
    $$('.nk-marker', clone).forEach(function (m) { m.parentNode.removeChild(m); });
    $$('mark.nk-hit', clone).forEach(function (m) {
      m.parentNode.replaceChild(clone.ownerDocument.createTextNode(m.textContent), m);
    });
    $$('[contenteditable]', clone).forEach(function (el) { el.removeAttribute('contenteditable'); });
    $$('body', clone).forEach(function (b) { b.className = String(b.className).replace(/\bnk-[a-z]+\b/g, '').trim(); });
    // 归一化 viewport：去掉浏览器/预览器注入的额外 viewport（例如固定宽度 390）
    $$('meta[name="viewport"]', clone).slice(1).forEach(function (m) { m.parentNode.removeChild(m); });
    var old = clone.querySelector('#nk-notes-data'); if (old) old.parentNode.removeChild(old);
    var sc = clone.ownerDocument.createElement('script');
    sc.type = 'application/json'; sc.id = 'nk-notes-data';
    sc.textContent = JSON.stringify(state.notes).replace(/</g, '\\u003c');
    var body = clone.querySelector('body'); if (body) body.appendChild(sc);
    return '<!DOCTYPE html>\n' + clone.outerHTML;
  }
  function cloudSave() {
    var token = ($('#nk-token').value || LS.get('ghtoken') || '').trim();
    if (!token) { toast('请先填入 GitHub 令牌'); return; }
    LS.set('ghtoken', token);
    var url = 'https://api.github.com/repos/' + CFG.owner + '/' + CFG.repo + '/contents/' + CFG.path;
    var headers = { 'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json' };
    $('#nk-cstate').textContent = '　保存中…';
    toast('正在上传到服务器…', 2000);
    fetch(url + '?ref=' + CFG.branch, { headers: headers })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var body = {
          message: 'web-edit: 网页内编辑保存 ' + new Date().toLocaleString('zh-CN'),
          content: b64(serializePage()),
          branch: CFG.branch
        };
        if (j && j.sha) body.sha = j.sha;
        return fetch(url, {
          method: 'PUT',
          headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
          body: JSON.stringify(body)
        });
      })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (res.ok) {
          var t = new Date().toLocaleTimeString('zh-CN').slice(0, 5);
          $('#nk-cstate').textContent = '　已同步 ' + t;
          LS.set('cloudsync', String(Date.now()));
          toast('已保存到服务器 ✓ 约 1 分钟生效；其他设备若仍看到旧版，等 10 分钟或下拉刷新', 4200);
        } else {
          $('#nk-cstate').textContent = '　失败';
          toast('保存失败：' + ((res.j && res.j.message) || '未知错误'), 3600);
        }
      })
      .catch(function (e) { $('#nk-cstate').textContent = '　失败'; toast('网络错误：' + e.message, 3200); });
  }
  function loadEmbeddedNotes() {
    var el = document.getElementById('nk-notes-data'); if (!el) return;
    try {
      var arr = JSON.parse(el.textContent || '[]') || [];
      arr.forEach(function (n) {
        if (!n || !n.id) return;
        var ex = state.notes.filter(function (x) { return x.id === n.id; })[0];
        if (!ex) state.notes.push(n);
        else if ((n.ts || 0) > (ex.ts || 0)) { ex.text = n.text; ex.ts = n.ts; }
      });
    } catch (e) { }
  }

  /* ---------- 面板事件 ---------- */
  root.addEventListener('click', function (e) {
    var t = e.target.closest('[data-act]'); if (!t) return;
    var act = t.getAttribute('data-act'), id = t.getAttribute('data-id');
    switch (act) {
      case 'search': if (toggleBar('nk-sbar')) qInput.focus(); break;
      case 'next': gotoHit(state.midx + 1); break;
      case 'prev': gotoHit(state.midx - 1); break;
      case 'edit': setEdit(!state.editing); break;
      case 'edit-done': setEdit(false); break;
      case 'edit-reset':
        if (confirm('放弃本机所有编辑，恢复最初版本？（服务器上的内容不受影响）')) { LS.del('content'); location.reload(); }
        break;
      case 'note': toggleBar('nk-nbar'); toggleBar('nk-notes'); break;
      case 'note-mode': toggleNoteMode(); break;
      case 'note-clear':
        if (state.notes.length && confirm('删除全部便签？此操作不可撤销。')) { state.notes = []; saveNotes(); toast('已清除全部便签'); }
        break;
      case 'note-save': saveNoteFromEditor(); break;
      case 'note-del':
        if (state.editId) {
          state.notes = state.notes.filter(function (x) { return x.id !== state.editId; });
          toast('便签已删除');
        }
        state.editId = null; state.pending = null;
        $('#nk-ntext').value = ''; toggleBar('nk-nedit', false); saveNotes();
        break;
      case 'note-cancel': state.editId = null; state.pending = null; toggleBar('nk-nedit', false); break;
      case 'note-jump': {
        var m = $('.nk-marker[data-id="' + id + '"]');
        if (m) { m.scrollIntoView({ block: 'center', behavior: 'smooth' }); m.classList.add('nk-active'); setTimeout(function () { m.classList.remove('nk-active'); }, 1600); }
        else { toast('这条便签的位置已找不到（正文改动较大）'); }
        break;
      }
      case 'note-edit': openNote(id); break;
      case 'note-remove':
        state.notes = state.notes.filter(function (x) { return x.id !== id; });
        saveNotes(); toast('便签已删除');
        break;
      case 'backup': toggleBar('nk-bbar'); break;
      case 'export': exportData(); break;
      case 'import': $('#nk-file').click(); break;
      case 'wipe':
        if (confirm('清空本机保存的编辑与便签？（服务器内容不受影响）')) {
          LS.del('content'); LS.del('notes'); location.reload();
        }
        break;
      case 'cloud': toggleBar('nk-cbar'); break;
      case 'cloud-save': cloudSave(); break;
      case 'cloud-forget': LS.del('ghtoken'); $('#nk-token').value = ''; toast('已清除本机令牌'); break;
      case 'top': window.scrollTo({ top: 0, behavior: 'smooth' }); break;
    }
  });

  /* ---------- 启动 ---------- */
  function init() {
    loadNotes(); loadEmbeddedNotes();
    var saved = LS.get('content');
    if (saved) {
      try {
        var d = JSON.parse(saved);
        if (d && d.html && d.html.length === sheets.length) {
          var same = d.html.every(function (h, i) { return h === sheets[i].innerHTML; });
          if (!same) {
            d.html.forEach(function (h, i) { sheets[i].innerHTML = h; });
            $('#nk-estate').textContent = '　已载入本机版本';
            toast('已载入你在本机保存的编辑版本', 3200);
          }
        }
      } catch (e) { }
    }
    var t = LS.get('ghtoken'); if (t) $('#nk-token').value = t;
    var cs = LS.get('cloudsync');
    if (cs) $('#nk-cstate').textContent = '　上次同步 ' + new Date(Number(cs)).toLocaleString('zh-CN').slice(5, 16);
    noteCount(); renderNotes(); renderMarkers();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.nkReaderKit = { search: search, setEdit: setEdit, notes: function () { return state.notes; } };
})();
