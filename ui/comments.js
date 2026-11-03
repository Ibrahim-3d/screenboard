/* Comment pins for any page served by the board. Zero dependencies.
   C toggles comment mode · click to drop a pin · drag a pin to move it · Esc closes.
   Runs in three places: a page on its own (pins + list), a page inside a board frame (pins; the board holds the list,
   the popup and the shared store), and the board itself (board.html defines window.BOARD first). */
(function () {
  'use strict';
  if (window.CM) return;
  const BASE = new URL('.', document.currentScript ? document.currentScript.src : location.href).pathname; // ".../__<name>/"
  let host = null;
  try { if (parent !== window && parent.BOARD && parent.CM) host = parent; } catch { /* cross-origin parent */ }
  const IS_BOARD = !!window.BOARD;
  const IS_PAGE = !IS_BOARD;
  const IS_HUB = !host; // the window that owns the store, the popup and the list
  const hub = () => (host ? host.CM : window.CM);
  const store = host ? host.CM.store : makeStore();
  const CM = (window.CM = { store, ready: false });
  const $ = (s, r = document) => r.querySelector(s);
  const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const num = (id) => parseInt(String(id).slice(1), 10) || id;
  const when = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); };
  const typing = (e) => e.target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName);

  function makeStore() {
    const s = {
      pins: [], mode: false, cfg: null, error: '', status: 'open', ls: new Set(), last: '',
      on(f) { s.ls.add(f); }, off(f) { s.ls.delete(f); },
      emit() { [...s.ls].forEach((f) => { try { f(); } catch { s.ls.delete(f); } }); },
      async req(body) {
        try {
          const r = await fetch(BASE + 'api/comments', body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' });
          const j = await r.json();
          if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
          const t = JSON.stringify(j);
          const changed = t !== s.last || s.error;
          s.last = t; s.pins = j; s.error = '';
          if (changed) s.emit();
          return true;
        } catch (e) { s.error = 'Not saved: ' + (e.message || e); s.emit(); return false; }
      },
      load: () => s.req(), save: (pin) => s.req({ pin }), remove: (id) => s.req({ delete: id }),
      setMode(m) { s.mode = m; s.emit(); }, setStatus(v) { s.status = v; s.emit(); },
    };
    const c = window.BOARD && window.BOARD.cfg ? Promise.resolve(window.BOARD.cfg) : fetch(BASE + 'api/config').then((r) => r.json());
    c.then((v) => { s.cfg = v; s.emit(); }).catch(() => { s.error = 'Comment server not reachable'; s.emit(); });
    s.load();
    setInterval(() => !document.hidden && s.load(), 4000);
    return s;
  }
  const cfg = () => store.cfg || { rootSelector: 'body', anchorAttrs: ['id'], authors: ['human', 'agent'], frames: [] };
  const passes = (p) => store.status === 'all' || p.status === store.status;

  // ---------- styles (tool chrome, independent of the page's own design) ----------
  const css = h('style', null, `
  #cm-pins{position:fixed;inset:0;pointer-events:none;z-index:2147483000}
  .cm-pin{position:absolute;width:26px;height:26px;border-radius:13px 13px 13px 2px;background:#ff5c1f;color:#fff;font:600 12px/26px system-ui,sans-serif;text-align:center;pointer-events:auto;cursor:grab;box-shadow:0 0 0 2px #fff,0 2px 8px rgb(0 0 0/.3);transform-origin:0 0;user-select:none}
  .cm-pin.res{background:#9aa0a6}.cm-pin.draft{background:#1f1f1f}.cm-pin.drag{cursor:grabbing;opacity:.85}
  html.cm-on [data-cm-root],html.cm-on [data-cm-root] *{cursor:crosshair!important}
  #cm-chip{height:28px;padding:0 10px;border:1px solid #c9ccd1;border-radius:14px;background:#fff;color:#1f1f1f;font:500 12px/26px system-ui,sans-serif;cursor:pointer;display:inline-flex;gap:6px;align-items:center}
  #cm-chip.fixed{position:fixed;top:6px;right:8px;z-index:2147483001}
  #cm-chip[aria-pressed="true"]{background:#1f1f1f;color:#fff;border-color:#1f1f1f}
  #cm-chip b{min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:#ff5c1f;color:#fff;font:600 11px/18px system-ui,sans-serif}
  #cm-chip.err b{background:#d93025}
  #cm-side{position:fixed;top:44px;right:0;bottom:0;width:320px;z-index:2147483001;background:#fff;color:#1f1f1f;border-left:1px solid #e3e5e8;display:flex;flex-direction:column;font:13px/1.45 system-ui,sans-serif;box-shadow:-8px 0 24px rgb(0 0 0/.08)}
  #cm-side.fixed{top:0}
  #cm-side[hidden]{display:none}
  #cm-side .hd{display:flex;gap:4px;padding:10px 12px;border-bottom:1px solid #eceef0}
  #cm-side .hd button,.cm-pop button{height:26px;padding:0 9px;border:1px solid #d5d8dc;border-radius:6px;background:#fff;color:#1f1f1f;font:500 12px system-ui,sans-serif;cursor:pointer}
  #cm-side .hd button[aria-pressed="true"]{background:#1f1f1f;color:#fff;border-color:#1f1f1f}
  #cm-side .err{padding:8px 12px;color:#b3261e;font-size:12px}
  #cm-side ol{list-style:none;margin:0;padding:0;overflow:auto;flex:1}
  #cm-side li{display:grid;grid-template-columns:26px 1fr;gap:4px 10px;padding:10px 12px;border-bottom:1px solid #f0f1f3;cursor:pointer}
  #cm-side li:hover{background:#f6f7f8}
  #cm-side li .n{width:22px;height:22px;border-radius:11px 11px 11px 2px;background:#ff5c1f;color:#fff;font:600 11px/22px system-ui;text-align:center}
  #cm-side li.res .n{background:#9aa0a6}
  #cm-side li .t{overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
  #cm-side li .m{grid-column:2;color:#6b7075;font-size:12px}
  #cm-side .empty{padding:16px 12px;color:#6b7075}
  .cm-pop{position:fixed;z-index:2147483002;width:300px;background:#fff;color:#1f1f1f;border-radius:10px;box-shadow:0 2px 6px rgb(0 0 0/.12),0 12px 32px rgb(0 0 0/.18);font:13px/1.45 system-ui,sans-serif;padding:10px 12px}
  .cm-pop .bar{display:flex;gap:4px;align-items:center;margin-bottom:6px}.cm-pop .bar .sp{flex:1}
  .cm-pop .msg{padding:6px 0;border-top:1px solid #f0f1f3;white-space:pre-wrap;word-break:break-word}.cm-pop .msg:first-of-type{border-top:0}
  .cm-pop .who{color:#6b7075;font-size:12px}
  .cm-pop .msgs{max-height:260px;overflow:auto}
  .cm-pop textarea{width:100%;box-sizing:border-box;min-height:54px;margin-top:6px;padding:6px 8px;border:1px solid #d5d8dc;border-radius:6px;font:13px/1.4 system-ui,sans-serif;resize:vertical}
  .cm-pop .act{display:flex;justify-content:flex-end;gap:4px;margin-top:6px}
  .cm-pop .pri{background:#1f1f1f!important;color:#fff!important;border-color:#1f1f1f!important}`);
  document.head.appendChild(css);

  // ---------- keys (every window) ----------
  addEventListener('keydown', (e) => {
    if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'KeyC' || e.key === 'c' || e.key === 'C') { e.preventDefault(); store.setMode(!store.mode); } // code: the C key on any layout
    else if (e.key === 'Escape' && (store.mode || hub().popupOpen())) {
      e.stopImmediatePropagation();
      if (hub().popupOpen()) hub().closePopup(); else store.setMode(false);
    }
  }, true);

  // ================= hub: popup, list, chip =================
  if (IS_HUB) {
    let pop = null; // { el, target, onClose }
    CM.popupOpen = () => !!pop;
    CM.closePopup = () => { if (!pop) return; const p = pop; pop = null; p.el.remove(); p.onClose && p.onClose(); };
    CM.popup = (target, x, y, onClose) => {
      CM.closePopup();
      const el = h('div', 'cm-pop');
      pop = { el, target, onClose };
      document.body.appendChild(el);
      fillPopup();
      const r = el.getBoundingClientRect();
      el.style.left = Math.max(8, Math.min(x + 18, innerWidth - r.width - 8)) + 'px';
      el.style.top = Math.max(8, Math.min(y - 20, innerHeight - r.height - 8)) + 'px';
      const ta = $('textarea', el);
      ta && ta.focus();
    };
    function fillPopup() {
      if (!pop) return;
      const { el, target } = pop;
      const keep = $('textarea', el) ? $('textarea', el).value : '';
      el.replaceChildren();
      const [human] = cfg().authors;
      const ta = h('textarea');
      ta.value = keep;
      const bar = h('div', 'bar');
      const close = h('button', null, '×');
      close.setAttribute('aria-label', 'Close');
      close.onclick = () => CM.closePopup();
      if (target.draft) {
        bar.append(h('b', null, 'New comment'), h('span', 'sp'), close);
        ta.placeholder = 'Comment';
        ta.setAttribute('aria-label', 'Comment');
        const ok = h('button', 'pri', 'Comment');
        const submit = async () => {
          if (!ta.value.trim()) return;
          ok.disabled = true;
          if (await store.save({ ...target.draft, text: ta.value.trim(), author: human, status: 'open', thread: [] })) CM.closePopup();
          else ok.disabled = false;
        };
        ok.onclick = submit;
        ta.onkeydown = (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(); };
        const cancel = h('button', null, 'Cancel');
        cancel.onclick = () => CM.closePopup();
        const act = h('div', 'act');
        act.append(cancel, ok);
        el.append(bar, ta, act);
        return;
      }
      const p = store.pins.find((x) => x.id === target.id);
      if (!p) return CM.closePopup();
      const res = h('button', null, p.status === 'open' ? 'Resolve' : 'Reopen');
      res.onclick = () => store.save({ id: p.id, status: p.status === 'open' ? 'resolved' : 'open' });
      const del = h('button', null, 'Delete');
      del.onclick = async () => { if (confirm(`Delete comment #${num(p.id)}?`)) { await store.remove(p.id); CM.closePopup(); } };
      bar.append(h('b', null, '#' + num(p.id)), h('span', 'sp'), res, del, close);
      const msgs = h('div', 'msgs');
      [{ author: p.author, text: p.text, createdAt: p.createdAt }, ...(p.thread || [])].forEach((m) => {
        const d = h('div', 'msg');
        d.append(h('div', 'who', `${m.author} · ${when(m.createdAt)}`), document.createTextNode(m.text));
        msgs.append(d);
      });
      ta.placeholder = 'Reply';
      ta.setAttribute('aria-label', 'Reply');
      const send = h('button', 'pri', 'Reply');
      const submit = async () => {
        if (!ta.value.trim()) return;
        const t = ta.value.trim();
        ta.value = '';
        if (!(await store.save({ id: p.id, thread: [...(p.thread || []), { author: human, text: t, createdAt: new Date().toISOString() }] }))) ta.value = t;
      };
      send.onclick = submit;
      ta.onkeydown = (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(); };
      const act = h('div', 'act');
      act.append(send);
      el.append(bar, msgs, ta, act);
      msgs.scrollTop = msgs.scrollHeight;
    }
    addEventListener('pointerdown', (e) => { if (pop && !pop.el.contains(e.target) && !e.target.closest('.cm-pin')) CM.closePopup(); }, true);

    // chip with the open count, always visible; the list opens with comment mode
    const chip = h('button');
    chip.id = 'cm-chip';
    chip.type = 'button';
    chip.onclick = () => store.setMode(!store.mode);
    const slot = $('#cm-slot');
    if (slot) slot.append(chip); else { chip.classList.add('fixed'); document.body.appendChild(chip); }
    const side = h('aside');
    side.id = 'cm-side';
    side.hidden = true;
    if (!slot) side.classList.add('fixed');
    document.body.appendChild(side);
    const where = (p) => {
      const fr = cfg().frames.find((f) => f.id === p.frame);
      return fr ? [fr.device, fr.label].filter(Boolean).join(' ') : p.screen;
    };
    function renderHub() {
      const open = store.pins.filter((p) => p.status === 'open').length;
      chip.replaceChildren(document.createTextNode('Comments'), h('b', null, store.error ? '!' : String(open)));
      chip.classList.toggle('err', !!store.error);
      chip.title = store.error || '';
      chip.setAttribute('aria-pressed', store.mode);
      const was = !side.hidden;
      side.hidden = !store.mode;
      document.documentElement.classList.toggle('cm-side-open', store.mode);
      if (was !== store.mode) dispatchEvent(new Event('resize'));
      if (!store.mode) return CM.closePopup();
      side.replaceChildren();
      const hd = h('div', 'hd');
      [['open', 'Open'], ['resolved', 'Resolved'], ['all', 'All']].forEach(([v, t]) => {
        const b = h('button', null, t);
        b.setAttribute('aria-pressed', store.status === v);
        b.onclick = () => store.setStatus(v);
        hd.append(b);
      });
      side.append(hd);
      if (store.error) side.append(h('div', 'err', store.error));
      const list = store.pins.filter(passes);
      if (!list.length) side.append(h('div', 'empty', store.status === 'open' ? 'No open comments' : 'No comments'));
      const ol = h('ol');
      list.forEach((p) => {
        const li = h('li', p.status === 'resolved' ? 'res' : '');
        const replies = (p.thread || []).length;
        li.append(h('span', 'n', String(num(p.id))), h('span', 't', p.text), h('span', 'm', `${where(p)}${replies ? ` · ${replies} ${replies === 1 ? 'reply' : 'replies'}` : ''}`));
        li.onclick = () => (IS_BOARD ? window.BOARD.focus(p) : CM.show(p.id));
        ol.append(li);
      });
      side.append(ol);
      fillPopup();
    }
    store.on(renderHub);
    renderHub();
  }

  // ================= page: pins anchored to elements =================
  if (IS_PAGE) {
    const layer = h('div');
    layer.id = 'cm-pins';
    document.body.appendChild(layer);
    const frameId = host && frameElement ? frameElement.dataset.frame || null : null;
    const zoom = () => (host ? host.BOARD.zoomOf(frameElement) : 1);
    const screenKey = () => decodeURIComponent(location.pathname + location.hash);
    const shows = (p) => {
      if (frameId && p.frame && p.frame !== frameId) return false; // desktop and phone frames keep their own pins
      const k = screenKey();
      return p.screen === k || (p.screen.includes('#') && k.startsWith(p.screen + '/'));
    };
    const roots = () => [...document.querySelectorAll(cfg().rootSelector)].filter((r) => r.getClientRects().length);
    const markRoots = () => document.querySelectorAll(cfg().rootSelector).forEach((r) => r.hasAttribute('data-cm-root') || r.setAttribute('data-cm-root', ''));
    const toHub = (x, y) => { if (!host) return { x, y }; const r = frameElement.getBoundingClientRect(); return { x: r.left + x * zoom(), y: r.top + y * zoom() }; };
    let draft = null;

    function selectorFor(el, root) {
      const parts = [];
      for (; el && el !== root; el = el.parentElement) {
        let a = null;
        for (const at of cfg().anchorAttrs) {
          const v = el.getAttribute(at);
          if (v == null || v === '') continue;
          const s = at === 'id' ? '#' + CSS.escape(v) : `[${at}="${v.replace(/["\\]/g, '\\$&')}"]`;
          if (root.querySelectorAll(s).length === 1) { a = s; break; }
        }
        if (a) { parts.unshift(a); return parts.join(' > '); }
        let i = 1;
        for (let s = el.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === el.tagName) i++;
        parts.unshift(`${el.tagName.toLowerCase()}:nth-of-type(${i})`);
      }
      return parts.length ? ':scope > ' + parts.join(' > ') : ':scope';
    }
    // What an agent can grep for: tag, id/class and the start of the element's text.
    function hintFor(el) {
      const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 3).map((c) => '.' + c).join('') : '';
      const text = (el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('alt') || '').replace(/\s+/g, ' ').trim().slice(0, 80);
      return `<${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${cls}>${text ? ' ' + text : ''}`.slice(0, 300);
    }
    function q(root, sel) {
      if (sel === ':scope') return root;
      try { return root.querySelector(sel); } catch { return null; }
    }
    function resolve(p) {
      for (const root of roots()) {
        const parts = p.selector.split(' > ');
        for (let n = parts.length; n > 0; n--) {
          const el = q(root, parts.slice(0, n).join(' > '));
          if (el && (n === parts.length || el !== root || parts[0] === ':scope')) return { el, exact: n === parts.length, root };
        }
      }
      return null;
    }
    function pointOf(p) {
      const hit = resolve(p);
      if (!hit) return null;
      let { el, exact } = hit;
      let r = el.getBoundingClientRect();
      while (!r.width && !r.height && el.parentElement) { el = el.parentElement; r = el.getBoundingClientRect(); exact = false; }
      const x = r.left + (r.width * (exact ? p.x : 50)) / 100;
      const y = r.top + (r.height * (exact ? p.y : 50)) / 100;
      for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
          const c = a.getBoundingClientRect();
          if (x < c.left - 1 || x > c.right + 1 || y < c.top - 1 || y > c.bottom + 1) return null;
        }
      }
      return { x, y };
    }
    // Pins keep one screen size at any board zoom.
    function place(el, x, y) {
      const k = 1 / zoom();
      el.style.left = x + 'px';
      el.style.top = y - 26 * k + 'px';
      el.style.transform = `scale(${k})`;
    }
    function render() {
      document.documentElement.classList.toggle('cm-on', store.mode);
      markRoots();
      layer.replaceChildren();
      if (draft) { const d = h('div', 'cm-pin draft', '+'); place(d, draft.cx, draft.cy); layer.append(d); }
      if (!store.mode) return;
      store.pins.filter((p) => passes(p) && shows(p)).forEach((p) => {
        const pt = pointOf(p);
        if (!pt) return;
        const d = h('div', 'cm-pin' + (p.status === 'resolved' ? ' res' : ''), String(num(p.id)));
        d.dataset.id = p.id;
        d.title = p.text;
        place(d, pt.x, pt.y);
        layer.append(d);
      });
    }
    let raf = 0;
    const later = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); };
    CM.relayout = later;
    store.on(later);
    if (host) addEventListener('pagehide', () => store.off(later));
    addEventListener('resize', later);
    addEventListener('scroll', later, true);
    addEventListener('hashchange', later);
    new MutationObserver((ms) => { if (ms.some((m) => !layer.contains(m.target) && m.target !== layer)) later(); }).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });

    // comment mode swallows clicks inside the anchor roots; a click drops a pin
    const inRoot = (t) => roots().find((r) => r.contains(t));
    const block = (e) => {
      if (!store.mode || e.target.closest('#cm-pins, #cm-chip, #cm-side, .cm-pop')) return;
      if (!inRoot(e.target)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.type === 'click') newPin(e);
    };
    ['pointerdown', 'mousedown', 'mouseup', 'pointerup', 'click', 'dblclick', 'contextmenu'].forEach((t) => addEventListener(t, block, true));
    if (host) addEventListener('pointerdown', () => host.CM.popupOpen() && host.CM.closePopup(), true);

    function anchorAt(x, y, target) {
      const el = target.closest('svg') || target;
      const root = inRoot(el);
      if (!root) return null;
      const r = el.getBoundingClientRect();
      return { screen: screenKey(), frame: frameId, selector: selectorFor(el, root), hint: hintFor(el), x: ((x - r.left) / (r.width || 1)) * 100, y: ((y - r.top) / (r.height || 1)) * 100 };
    }
    function newPin(e) {
      const a = anchorAt(e.clientX, e.clientY, e.target);
      if (!a) return;
      draft = { cx: e.clientX, cy: e.clientY };
      render();
      const pt = toHub(e.clientX, e.clientY);
      hub().popup({ draft: a }, pt.x, pt.y, () => { draft = null; later(); });
    }

    // drag a pin to move it; a plain click opens it
    layer.addEventListener('pointerdown', (e) => {
      const pin = e.target.closest('.cm-pin[data-id]');
      if (!pin) return;
      e.preventDefault();
      const sx = e.clientX, sy = e.clientY;
      let moved = false;
      pin.setPointerCapture(e.pointerId);
      pin.onpointermove = (ev) => {
        if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
        moved = true;
        pin.classList.add('drag');
        place(pin, ev.clientX, ev.clientY);
      };
      pin.onpointerup = (ev) => {
        pin.onpointermove = pin.onpointerup = null;
        if (!moved) { const pt = toHub(ev.clientX, ev.clientY); return hub().popup({ id: pin.dataset.id }, pt.x, pt.y); }
        layer.style.display = 'none';
        const under = document.elementFromPoint(ev.clientX, ev.clientY);
        layer.style.display = '';
        const a = under && anchorAt(ev.clientX, ev.clientY, under);
        if (a) store.save({ id: pin.dataset.id, ...a }); else later();
      };
    });

    // open a pin by id: go to its screen first (same page, other hash), then pop it up
    CM.show = (id) => {
      const p = store.pins.find((x) => x.id === id);
      if (!p) return;
      if (!store.mode) store.setMode(true);
      const [pp, hash] = p.screen.split('#');
      if (!shows(p) && pp === location.pathname && hash !== undefined) location.hash = hash;
      let tries = 0;
      const go = () => {
        const pt = pointOf(p);
        if (!pt && tries++ < 10) return setTimeout(go, 80);
        const c = pt || { x: innerWidth / 2, y: innerHeight / 3 };
        const hp = toHub(c.x, c.y);
        hub().popup({ id }, hp.x, hp.y);
      };
      setTimeout(go, 60);
    };

    // inside a board frame: Space-pan and Ctrl+wheel zoom still drive the board
    if (host) {
      addEventListener('keydown', (e) => { if (e.code === 'Space' && !e.repeat && !typing(e)) { e.preventDefault(); host.BOARD.space(true); } });
      addEventListener('keyup', (e) => e.code === 'Space' && host.BOARD.space(false));
      addEventListener('wheel', (e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); host.BOARD.wheel(e, frameElement); } }, { passive: false });
    }
    render();
  }
  CM.ready = true;
})();
