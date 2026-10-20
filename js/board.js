/**
 * [board.js] — 현황판 (장소 × 시간 격자).
 * 주의: 현황판 데이터는 사용자별로 localStorage(rb.board.<email>)에 보관되며 로그아웃 때 지운다.
 *
 * 무엇을 한다: 일 보기(세로=장소, 가로=시간)와 주 보기(장소 하나, 세로=요일)를 그린다.
 *              빈 칸 클릭 → 예약 폼, 일정 클릭 → 상세 팝오버.
 * 의존:        config.js, time.js, i18n.js, ui.js, api.js, bookingForm.js, app.js(state)
 * 호출됨:      app.js 가 render() 를 부른다.
 * 주의:        일정 블록은 트랙 위에 절대 위치로 놓는다. 좌표 = (분 - 표시 시작 분) / 슬롯 분 × SLOT_PX.
 *              표시 범위 밖으로 걸친 일정은 잘라서 그린다.
 *              데이터는 항상 **주 단위**로 받아 60초 캐시한다 — 서버 왕복이 2~3초라 날짜 이동마다 부르면 답답하다.
 *              일 보기는 캐시된 주 데이터를 잘라 쓴다. 예약·취소·승인 뒤에는 refresh() 가 캐시를 비운다.
 * 정책 근거:   D-13(현황판 규칙은 02-아키텍처.md 8절)
 */
window.RB = window.RB || {};

RB.board = (function () {
  var U = RB.ui, T = RB.time, t = function (k, v) { return RB.i18n.t(k, v); };

  var state = { view: 'day', date: T.today(), weekResource: null, events: [], pending: [], preloaded: null, group: 'MAIN' };
  var weekCache = {};   // weekStartKey → {data, at}
  var CACHE_MS = 5 * 60000;   // 서버가 30초 공유 캐시 + 쓰기 시 무효화를 하므로 브라우저는 5분 보관. 내 예약·취소는 로컬 즉시 반영
  var STORE_PREFIX = 'rb.board.';
  var STORE_MAX = 8;
  var STORE_MS = 24 * 3600000;
  var epoch = 0;   // restore/clearPersisted 때 올린다. 이전 epoch 의 비동기 응답은 캐시·저장소·refreshing 을 건드리지 않는다.
  var inflight = {};   // weekKey → 진행 중인 서버 요청 Promise (중복 요청 방지)
  var refreshing = 0;  // 백그라운드 갱신 진행 수. 0 보다 크면 "Updating…" 표시
  var groupsPrefetched = false;  // 다른 그룹 미리 받기는 페이지당 한 번
  var pendingInit = null;  // {key, waiters} — init 응답을 기다리는 현재 주 (expectPreload / preload / releasePreload)

  /** 사용자별 현황판 스냅숏을 localStorage에 저장한다(오래된 주는 버림). */
  function persist() {
    var email = RB.app.state.user && RB.app.state.user.email;
    if (!email) return;
    email = String(email).toLowerCase();
    try {
      var weeks = {};
      var items = [];
      Object.keys(weekCache).forEach(function (key) {
        var hit = weekCache[key];
        if (!hit || hit.loading || !hit.data || !hit.data.events) return;
        if (Date.now() - hit.at > STORE_MS) return;
        items.push({ key: key, at: hit.at, data: hit.data });
      });
      items.sort(function (a, b) { return b.at - a.at; });
      items.slice(0, STORE_MAX).forEach(function (item) { weeks[item.key] = { data: item.data, at: item.at }; });
      localStorage[STORE_PREFIX + email] = JSON.stringify({ v: 1, weeks: weeks });
    } catch (e) { /* storage 사용 불가 등은 무시 */ }
  }

  /** 로그인한 사용자의 저장된 현황판 사본을 복원한다(렌더는 하지 않음). */
  function restore(email) {
    epoch++;
    pendingInit = null;
    weekCache = {};
    inflight = {};
    refreshing = 0;
    state.events = [];   // 이전 사용자의 화면 데이터가 남지 않게
    state.pending = [];
    try {
      var key = STORE_PREFIX + String(email || '').toLowerCase();
      var raw = localStorage[key];
      if (!raw) return;
      var store = JSON.parse(raw);
      if (store.v !== 1 || typeof store.weeks !== 'object' || store.weeks === null) return;
      Object.keys(store.weeks).forEach(function (k) {
        var w = store.weeks[k];
        if (w && w.data && Object.prototype.toString.call(w.data.events) === '[object Array]' && Date.now() - w.at < STORE_MS) {
          weekCache[k] = { data: w.data, at: w.at, stale: true };
        }
      });
    } catch (e) { /* 손상된 JSON 등은 무시 */ }
  }

  /** 로그아웃 시 사용자 현황판 사본을 모두 지운다. */
  function clearPersisted() {
    epoch++;
    pendingInit = null;
    weekCache = {};
    inflight = {};
    refreshing = 0;
    groupsPrefetched = false;
    state.events = [];
    state.pending = [];
    try {
      Object.keys(localStorage).forEach(function (k) {
        if (k.indexOf(STORE_PREFIX) === 0) localStorage.removeItem(k);
      });
    } catch (e) { /* 무시 */ }
  }

  function cfg() { return RB.app.state.config; }
  /** @param {Object} r 장소 객체
   * @returns {string} 'ZOOM' | 'OTHER' | 'MAIN'
   * Config.gs boardGroupOf_ 와 같은 규칙. Zoom 은 활성 여부와 관계없이 자체 탭(D-28), 비활성 방은 Other spaces(D-24). */
  function groupOf(r) {
    if (r.kind === 'ZOOM' || r.board === 'ZOOM') return 'ZOOM';
    if (r.board === 'OTHER' || r.active === false) return 'OTHER';
    return 'MAIN';
  }
  /** Zoom 계정은 활성 상태이거나 해당 자원 담당자·최고 관리자에게만 보인다(private 테스트, D-28). */
  function zoomVisible(r) {
    return r.active !== false || canBook(r);
  }
  /** 현재 그룹의 공간. Zoom 은 zoomVisible 인 계정만 노출한다. */
  function resources() {
    return RB.app.state.resources.filter(function (r) {
      if (r.reservable === false) return false;
      if (groupOf(r) !== state.group) return false;
      return state.group !== 'ZOOM' || zoomVisible(r);
    });
  }
  function hasOtherGroup() {
    return RB.app.state.resources.some(function (r) { return r.reservable !== false && groupOf(r) === 'OTHER'; });
  }
  function hasZoomGroup() {
    return RB.app.state.resources.some(function (r) { return r.reservable !== false && groupOf(r) === 'ZOOM' && zoomVisible(r); });
  }
  /** 비활성 공간을 예약할 수 있는가: 담당자·슈퍼 관리자만 */
  function canBook(r) {
    var me = RB.app.state.user || {};
    return r.active !== false || me.isSuperAdmin || (me.approverOf || []).indexOf(r.calendarId) !== -1;
  }

  /** 표시 범위(분). Zoom 탭은 24시간 기본값을 쓴다. T.parseHM('24:00') 은 1440 을 반환한다. */
  function range() {
    var hours = state.group === 'ZOOM' ? (cfg().zoomDisplayHours || '00:00-24:00') : (cfg().displayHours || '06:00-22:00');
    var hm = hours.split('-');
    return { from: T.parseHM(hm[0]), to: T.parseHM(hm[1]) };
  }
  function slotMin() { return cfg().slotMinutes || 30; }
  function px(minutes) { return (minutes / slotMin()) * RB.config.SLOT_PX; }

  // ---- 데이터 로드 ----------------------------------------------------------
  /** 현재 날짜가 속한 주(월~일) 구간 {from,to,group} (ISO). 일/주 보기 모두 이 구간을 받는다. 캐시 키는 그룹+주. */
  function currentRange() {
    var fromKey = T.weekStart(state.date);
    return { from: T.make(fromKey, 0).toISOString(), to: T.make(T.addDays(fromKey, 7), 0).toISOString(), group: state.group, weekKey: state.group + '|' + fromKey };
  }
  function initialRange() { return currentRange(); }   // weekKey 포함: init 응답 캐시 키를 요청한 주에 맞춘다

  /** init 응답에 실려 온 첫 현황판 데이터(이번 주, MAIN 그룹). 캐시에 넣는다. */
  /** weekKey 가 없는 구간의 캐시 키: 그룹 + 시작 날짜가 속한 주 */
  function rangeKey(r) { return (r.group || 'MAIN') + '|' + T.weekStart(T.dateKey(new Date(r.from))); }

  // init 응답을 요청한 주 캐시로 저장하고, 기다리던 load()를 풀어준다.
  function preload(range, data) {
    var key = range.weekKey || rangeKey(range);   // 화면에 보이는 주가 아니라 요청한 주
    weekCache[key] = { data: data, at: Date.now() };
    persist();
    if (!pendingInit) return;
    if (pendingInit.key !== key) { releasePreload(); return; }   // 기다리던 주와 다르면 대기자를 풀어 준다
    var pi = pendingInit;
    pendingInit = null;
    refreshing--;
    if (pi.waiters.length > 0) {
      pi.waiters.forEach(function (w) { w.resolve(data); });
      syncIndicator();
    } else if (RB.app.state.tab === 'board' && currentRange().weekKey === key) {
      rerender();
    } else {
      syncIndicator();
    }
  }

  // init 응답이 현재 주를 갱신할 예정임을 표시해 같은 요청이 두 번 가지 않게 한다.
  function expectPreload(range) {
    pendingInit = { key: range.weekKey || rangeKey(range), waiters: [] };
    refreshing++;
    syncIndicator();
  }

  // 저장된 사본이 없어서 init 응답을 기다려야 할 때 load()가 쓰는 Promise.
  function awaitPreload(range) {
    return new Promise(function (resolve, reject) {
      pendingInit.waiters.push({ range: range, resolve: resolve, reject: reject });
    });
  }

  // init이 board 데이터 없이 끝나거나 실패하면 일반 새로고침으로 되돌린다.
  function releasePreload() {
    if (!pendingInit) return;
    var pi = pendingInit;
    pendingInit = null;
    refreshing--;
    if (pi.waiters.length > 0) {
      pi.waiters.forEach(function (w) { fetchWeek(w.range).then(w.resolve, w.reject); });
      syncIndicator();
    } else if (RB.app.state.tab === 'board') {
      rerender();
    } else {
      syncIndicator();
    }
  }

  /** 캐시 비우기. 승인 등 다른 사람 데이터가 바뀐 뒤 호출. */
  function invalidate() { weekCache = {}; persist(); }

  /**
   * 내가 만든 예약을 서버 재조회 없이 바로 그린다(서버 왕복 2~5초 절약).
   * @param {Object} ev {calendarId, eventId, title, start:ISO, end:ISO, status, grade}
   */
  function addLocal(ev) {
    var me = RB.app.state.user || {};
    var e = Object.assign({ organizerEmail: me.email, organizerName: me.name, isMine: true, isBot: true, direct: false }, ev);
    var wk = T.weekStart(T.dateKey(new Date(e.start)));
    // 그 방이 속한 그룹의 캐시에 넣는다
    var room = RB.app.state.resources.filter(function (r) { return r.calendarId === e.calendarId; })[0] || {};
    var g = groupOf(room);
    var hit = weekCache[g + '|' + wk];
    if (hit) hit.data.events.push(e);
    persist();
    if (RB.app.state.tab === 'board' && g === state.group && wk === T.weekStart(state.date)) rerender();
  }

  /** 취소한 예약을 화면에서 바로 지운다 */
  function removeLocal(eventId) {
    Object.keys(weekCache).forEach(function (k) {
      var d = weekCache[k].data;
      d.events = d.events.filter(function (e) { return e.eventId !== eventId; });
      d.pending = (d.pending || []).filter(function (p) { return p.requestId !== eventId; });
    });
    persist();
    if (RB.app.state.tab === 'board') rerender();
  }

  /** 지금 주의 앞뒤 주를 백그라운드로 받아 둔다(날짜 이동을 기다리지 않게) */
  function prefetchNeighbors() {
    var wk = T.weekStart(state.date), g = state.group;
    [T.addDays(wk, -7), T.addDays(wk, 7)].forEach(function (k) {
      var key = g + '|' + k;
      var hit = weekCache[key];
      if (hit && (hit.stale || Date.now() - hit.at < CACHE_MS)) return;
      // fetchWeek 가 중복 요청(inflight)을 막고 응답을 캐시·저장한다
      fetchWeek({ from: T.make(k, 0).toISOString(), to: T.make(T.addDays(k, 7), 0).toISOString(), group: g, weekKey: key })
        .catch(function () { /* 미리 받기 실패는 무시 */ });
    });
  }

  /** 다른 그룹도 미리 받아 둔다(페이지당 한 번). */
  function prefetchGroups() {
    if (groupsPrefetched) return;
    groupsPrefetched = true;
    var base = currentRange();
    var wk = T.weekStart(state.date);
    var groups = [];
    if (hasOtherGroup()) groups.push('OTHER');
    if (hasZoomGroup()) groups.push('ZOOM');
    groups.forEach(function (g) {
      if (g === state.group) return;
      var key = g + '|' + wk;
      var hit = weekCache[key];
      if (hit && !hit.loading && !hit.stale && Date.now() - hit.at < CACHE_MS) return;
      fetchWeek({ from: base.from, to: base.to, group: g, weekKey: key }).catch(function () { /* 미리 받기 실패는 무시 */ });
    });
  }

  /** weekKey 하나에 대한 서버 요청을 중복 없이 수행한다. */
  function fetchWeek(range) {
    var key = range.weekKey;
    if (inflight[key]) return inflight[key];
    var ep = epoch;
    var p = RB.api.call('board', { from: range.from, to: range.to, group: range.group }).then(function (data) {
      if (ep === epoch) {
        weekCache[key] = { data: data, at: Date.now() };
        persist();
      }
      if (inflight[key] === p) delete inflight[key];
      return data;
    }, function (err) {
      if (inflight[key] === p) delete inflight[key];
      throw err;
    });
    inflight[key] = p;
    return p;
  }

  /** stale 사본을 보여준 뒤 새 데이터를 받아 다시 그린다. */
  function refreshWeek(range) {
    var ep = epoch;
    refreshing++;
    syncIndicator();
    fetchWeek(range).then(function () {
      if (ep !== epoch) return;
      refreshing--;
      // 성공했을 때만 다시 그린다. 실패 시 재요청 루프를 막기 위해 사본을 그대로 둔다.
      if (RB.app.state.tab === 'board' && currentRange().weekKey === range.weekKey) rerender();
      else syncIndicator();
    }, function () {
      if (ep !== epoch) return;
      refreshing--;
      // 실패하면 사본을 그대로 두고 표시만 갱신한다.
      syncIndicator();
    });
  }

  /** 백그라운드 갱신 건수를 툴바에 표시한다. */
  function syncIndicator() {
    var bar = document.querySelector('#view-board .toolbar-group');
    if (!bar) return;
    var el = bar.querySelector('.board-updating');
    if (refreshing > 0 && !el) bar.appendChild(U.el('span.muted.board-updating', { role: 'status' }, [t('board.updating')]));
    if (refreshing <= 0 && el) bar.removeChild(el);
  }

  function load() {
    var range = currentRange();
    var hit = weekCache[range.weekKey];
    if (hit && hit.loading) hit = null;   // 미리 받기 진행 중이면 정식으로 다시 요청(같은 요청이 두 번 갈 수 있지만 드묾)
    var shownFresh = true;
    var waitingInit = !!pendingInit && pendingInit.key === range.weekKey;
    var p;
    if (hit && hit.stale) {
      p = Promise.resolve(hit.data);
      shownFresh = false;
      if (!waitingInit) refreshWeek(range);
    } else if (hit && Date.now() - hit.at < CACHE_MS) {
      p = Promise.resolve(hit.data);
    } else if (waitingInit) {
      p = awaitPreload(range);
    } else {
      p = fetchWeek(range);
    }
    return p.then(function (data) {
      // 캐시 데이터는 재사용되므로 복사해서 Date 로 바꾼다
      state.events = data.events.map(function (e) { return hydrate(Object.assign({}, e)); });
      state.pending = (data.pending || []).map(function (e) { return hydrate(Object.assign({}, e)); });
      return shownFresh;
    });
  }
  function hydrate(e) { e.start = new Date(e.start); e.end = new Date(e.end); return e; }

  // ---- 렌더링 --------------------------------------------------------------
  function render(host) {
    U.clear(host);
    host.appendChild(toolbar());
    var wrap = U.el('div.board-wrap.loading');
    host.appendChild(wrap);
    // 로딩 중에는 직전 데이터로 그려 두어 화면이 비지 않게 한다(첫 로드면 안내문)
    if (resources().length && state.events.length) wrap.appendChild(state.view === 'day' ? dayGrid() : weekGrid());
    else wrap.appendChild(U.loadingBlock());
    load().then(function (shownFresh) {
      U.clear(wrap); wrap.classList.remove('loading');
      if (!resources().length) { wrap.appendChild(U.el('p.muted', null, [t('board.empty')])); return; }
      wrap.appendChild(state.view === 'day' ? dayGrid() : weekGrid());
      wrap.appendChild(legend());
      setTimeout(prefetchNeighbors, 300);
      if (shownFresh) setTimeout(prefetchGroups, 300);
    }).catch(function (err) {
      U.clear(wrap);
      wrap.appendChild(U.el('p.error', null, [err.message || t('error.network')]));
    });
  }

  function toolbar() {
    var lang = RB.i18n.get();
    var label = state.view === 'day'
      ? T.fmtDate(state.date, lang, true)
      : T.fmtDate(T.weekStart(state.date), lang, true) + ' ~ ' + T.fmtDate(T.addDays(T.weekStart(state.date), 6), lang);

    var step = state.view === 'day' ? 1 : 7;
    var tabs = [groupTab('MAIN')];
    if (hasOtherGroup()) tabs.push(groupTab('OTHER'));
    if (hasZoomGroup()) tabs.push(groupTab('ZOOM'));
    var bar = U.el('div.toolbar', null, [
      U.el('div.toolbar-group', null, [
        tabs.length > 1 ? U.el('div.group-tabs', null, tabs) : null,
        U.el('button.btn', { type: 'button', onclick: function () { state.date = T.today(); rerender(); } }, [t('btn.today')]),
        U.el('button.icon-btn', { type: 'button', 'aria-label': t('board.prev'), onclick: function () { state.date = T.addDays(state.date, -step); rerender(); } }, ['‹']),
        U.el('input.date-input', { type: 'date', 'aria-label': t('board.date'), value: state.date, onchange: function (e) { if (e.target.value) { state.date = e.target.value; rerender(); } } }),
        U.el('button.icon-btn', { type: 'button', 'aria-label': t('board.next'), onclick: function () { state.date = T.addDays(state.date, step); rerender(); } }, ['›']),
        U.el('span.toolbar-label', null, [label]),
        refreshing > 0 ? U.el('span.muted.board-updating', { role: 'status' }, [t('board.updating')]) : null
      ]),
      U.el('div.toolbar-group', null, [
        segment('day'), segment('week'),
        state.view === 'week' ? resourcePicker() : null,
        U.el('button.btn.btn-primary', { type: 'button', onclick: function () { RB.bookingForm.open({}); } }, ['+ ' + t('btn.book')])
      ])
    ]);
    return bar;
  }

  function groupTab(g) {
    return U.el('button.seg' + (state.group === g ? '.active' : ''), {
      type: 'button', onclick: function () { state.group = g; state.weekResource = null; rerender(); }
    }, [t('board.group.' + g)]);
  }

  function segment(view) {
    return U.el('button.seg' + (state.view === view ? '.active' : ''), {
      type: 'button', onclick: function () { state.view = view; rerender(); }
    }, [t('view.' + view)]);
  }

  function resourcePicker() {
    var sel = U.el('select.select', { 'aria-label': t('board.room'), onchange: function (e) { state.weekResource = e.target.value; rerender(); } });
    resources().forEach(function (r) {
      sel.appendChild(U.el('option', { value: r.calendarId, selected: r.calendarId === currentWeekResource() }, [r.name]));
    });
    return sel;
  }
  function currentWeekResource() {
    if (!state.weekResource || !resources().some(function (r) { return r.calendarId === state.weekResource; })) {
      state.weekResource = (resources()[0] || {}).calendarId;
    }
    return state.weekResource;
  }

  function rerender() { render(document.getElementById('view-board')); }
  /** 데이터가 바뀐 뒤(예약·취소·승인): 캐시 비우고 다시 그린다 */
  function refresh() { invalidate(); rerender(); }

  /** 시간 눈금 헤더 (한 시간마다 라벨) */
  function timeHeader() {
    var rg = range();
    var head = U.el('div.track.track-head');
    for (var m = rg.from; m < rg.to; m += 60) {
      head.appendChild(U.el('div.hour-label', { style: { left: px(m - rg.from) + 'px', width: px(60) + 'px' } }, [String(Math.floor(m / 60))]));
    }
    head.style.width = px(rg.to - rg.from) + 'px';
    return head;
  }

  /** 일 보기: 행 = 장소 */
  function dayGrid() {
    var grid = U.el('div.grid');
    grid.appendChild(row(U.el('div.row-label.row-label-head', null, ['']), timeHeader()));
    var dayFrom = T.make(state.date, 0), dayTo = T.make(T.addDays(state.date, 1), 0);
    resources().forEach(function (r) {
      var label = U.el('div.row-label' + (r.active === false ? '.is-inactive' : ''), { title: r.mode === 'APPROVAL' ? t('mode.APPROVAL') : '' }, [
        U.el('div.row-name', null, [r.name, r.mode === 'APPROVAL' ? U.el('span.approval-mark', null, ['*']) : null, r.active === false ? U.el('span.badge', { style: { marginLeft: '6px' } }, [t('board.inactive')]) : null]),
        U.el('div.row-sub', null, [[(r.aliases || []).join(', '), r.capacity ? String(r.capacity) : ''].filter(String).join(' · ')])
      ]);
      var evs = state.events.filter(function (e) { return e.calendarId === r.calendarId && T.overlaps(e.start, e.end, dayFrom, dayTo); });   // 자정을 넘기는 예약도 포함(block() 이 잘라 그림)
      grid.appendChild(row(label, track(r, state.date, evs)));
    });
    return grid;
  }

  /** 주 보기: 행 = 요일, 장소 하나 */
  function weekGrid() {
    var rid = currentWeekResource();
    var r = resources().filter(function (x) { return x.calendarId === rid; })[0];
    var grid = U.el('div.grid');
    grid.appendChild(row(U.el('div.row-label.row-label-head', null, [r.name, r.mode === 'APPROVAL' ? U.el('span.approval-mark', null, ['*']) : null]), timeHeader()));
    var start = T.weekStart(state.date);
    for (var i = 0; i < 7; i++) {
      var key = T.addDays(start, i);
      var dayFrom = T.make(key, 0), dayTo = T.make(T.addDays(key, 1), 0);
      var label = U.el('div.row-label' + (key === T.today() ? '.is-today' : ''), null, [
        U.el('div.row-name', null, [T.fmtDate(key, RB.i18n.get())])
      ]);
      var evs = state.events.filter(function (e) { return e.calendarId === rid && T.overlaps(e.start, e.end, dayFrom, dayTo); });
      grid.appendChild(row(label, track(r, key, evs)));
    }
    return grid;
  }

  function row(label, track) { return U.el('div.row', null, [label, track]); }

  /**
   * 트랙 하나: 배경 슬롯 + 일정 블록.
   * 빈 곳 클릭 → 클릭한 x 좌표를 슬롯으로 환산해 예약 폼을 연다.
   */
  function track(resource, dateKey, evs) {
    var rg = range();
    var node = U.el('div.track', { style: { width: px(rg.to - rg.from) + 'px' } });
    var now = new Date();

    // 지난 시간 음영
    var nowMin = T.dateKey(now) === dateKey ? T.minutesOfDay(now) : (T.make(dateKey, 0) < now ? rg.to : rg.from);
    if (nowMin > rg.from) {
      node.appendChild(U.el('div.past-shade', { style: { width: px(Math.min(nowMin, rg.to) - rg.from) + 'px' } }));
    }
    // 시간 눈금선
    for (var m = rg.from + 60; m < rg.to; m += 60) {
      node.appendChild(U.el('div.hour-line', { style: { left: px(m - rg.from) + 'px' } }));
    }

    node.addEventListener('click', function (e) {
      if (e.target !== node && !e.target.classList.contains('past-shade') && !e.target.classList.contains('hour-line')) return;
      var rect = node.getBoundingClientRect();
      var minute = rg.from + Math.floor((e.clientX - rect.left) / RB.config.SLOT_PX) * slotMin();
      var start = T.make(dateKey, minute);
      if (start < now) { U.toast(t('form.err.past'), 'error'); return; }
      if (!canBook(resource)) { U.toast(t('board.inactiveNotice'), 'error'); return; }
      RB.bookingForm.open({ calendarId: resource.calendarId, date: dateKey, startMin: minute, endMin: Math.min(minute + 60, rg.to) });
    });

    evs.forEach(function (ev) { node.appendChild(block(ev, resource, dateKey, rg)); });
    // 선점 대기 요청은 빗금 테두리로 얹는다 (승인되면 기존 예약이 밀려남을 예고)
    state.pending.filter(function (q) { return q.calendarId === resource.calendarId && T.overlaps(q.start, q.end, T.make(dateKey, 0), T.make(T.addDays(dateKey, 1), 0)); })
      .forEach(function (q) { node.appendChild(block(Object.assign({}, q, { status: 'PENDING', isPreempt: true }), resource, dateKey, rg)); });
    return node;
  }

  function block(ev, resource, dateKey, rg) {
    var s = Math.max(T.minutesOfDay(ev.start), rg.from);
    var e = T.dateKey(ev.end) === dateKey ? Math.min(T.minutesOfDay(ev.end), rg.to) : rg.to;
    if (T.dateKey(ev.start) !== dateKey) s = rg.from;   // 전날부터 이어진 예약은 왼쪽 끝에서 시작
    if (e <= s) return U.el('span');
    var cls = ['event', ev.isMine ? 'mine' : '', ev.status === 'PENDING' ? 'pending' : '', ev.isPreempt ? 'preempt' : '', ev.warning ? 'warning' : '', ev.end < new Date() ? 'past' : ''].filter(Boolean).join(' ');
    var open = function (evt) { evt.stopPropagation(); popover(ev, resource); };
    return U.el('div', {
      className: cls,
      role: 'button',
      tabindex: 0,
      style: { left: px(s - rg.from) + 'px', width: (px(e - s) - 2) + 'px' },
      title: (ev.status === 'PENDING' ? t('legend.pending') + ' · ' : '') + (ev.isMine ? t('legend.mine') + ' · ' : '') + ev.title + ' · ' + (ev.organizerName || ev.requesterName || '') + (ev.warning ? ' ⚠' : ''),
      onclick: open,
      onkeydown: function (evt) {
        if (evt.key === 'Enter' || evt.key === ' ') { evt.preventDefault(); open(evt); }
      }
    }, [U.el('span.event-title', null, [(ev.warning ? '⚠ ' : '') + ev.title])]);
  }

  /** 일정 상세 */
  function popover(ev, resource) {
    var lang = RB.i18n.get();
    var me = RB.app.state.user;
    var isPast = ev.end < new Date();
    var canCancel = !isPast && !ev.isPreempt && (ev.isMine || me.isSuperAdmin || (me.approverOf || []).indexOf(resource.calendarId) !== -1);
    // 시스템이 만든 반복 예약의 회차(ID 가 _YYYYMMDD 또는 _YYYYMMDDTHHMMSSZ 로 끝남) — 담당자·슈퍼 관리자도 이후 회차를 한꺼번에 취소(2026-10-20)
    var isSeries = !!ev.isBot && /_\d{8}(T\d{6}Z)?$/.test(String(ev.eventId || ''));
    var canPreempt = !isPast && !ev.isMine && !ev.isPreempt && resource.kind !== 'ZOOM' && resource.mode === 'AUTO' && ev.status === 'CONFIRMED';

    var body = U.el('div', null, [
      U.el('div.kv', null, [U.el('b', null, [resource.name]), ' · ', T.fmtRange(ev.start, ev.end, lang)]),
      U.el('div.kv', null, [t('popover.organizer') + ': ', ev.organizerName || ev.requesterName || ev.organizerEmail || '']),
      ev.bookedBy && ev.bookedBy !== ev.organizerEmail ? U.el('div.kv', null, [t('mine.bookedBy', { who: ev.bookedBy })]) : null,
      ev.warning ? U.el('p.note', null, [t('board.directWarning')]) : null,
      U.el('div.kv', null, [
        U.el('span.badge.' + (ev.status === 'PENDING' ? 'badge-pending' : 'badge-ok'), null, [t(isPast ? 'popover.past' : 'popover.status.' + ev.status)]),
        ' ', U.gradeBadge(ev.grade, cfg().grades)
      ]),
      U.el('div.actions', null, [
        canPreempt ? U.el('button.btn', { type: 'button', onclick: function () {
          U.closeModal();
          RB.bookingForm.open({ calendarId: resource.calendarId, date: T.dateKey(ev.start), startMin: T.minutesOfDay(ev.start), endMin: T.minutesOfDay(ev.end) });
        } }, [t('btn.preempt')]) : null,
        canCancel ? U.el('button.btn.btn-danger', { type: 'button', onclick: function () {
          U.closeModal();
          U.confirm(t('confirm.cancel')).then(function (yes) {
            if (!yes) return;
            RB.api.call('cancel', { key: ev.eventId || ev.requestId, calendarId: resource.calendarId }).then(function () { U.toast(t('toast.cancelled'), 'ok'); removeLocal(ev.eventId || ev.requestId); })
              .catch(function (err) { U.toast(t('result.error', { message: err.message }), 'error'); });
          });
        } }, [t(isSeries ? 'btn.cancelOccurrence' : 'btn.cancelBooking')]) : null,
        canCancel && isSeries ? U.el('button.btn.btn-danger', { type: 'button', onclick: function () {
          U.closeModal();
          U.confirm(t('confirm.cancelFollowing')).then(function (yes) {
            if (!yes) return;
            RB.api.call('cancel', { key: ev.eventId, calendarId: resource.calendarId, scope: 'following' })
              .then(function () { U.toast(t('toast.cancelled'), 'ok'); refresh(); })
              .catch(function (err) { U.toast(t('result.error', { message: err.message }), 'error'); });
          });
        } }, [t('btn.cancelFollowing')]) : null
      ])
    ]);
    U.modal(body, { title: ev.title });
  }

  function legend() {
    return U.el('div.legend', null, [
      U.el('span.legend-item', null, [U.el('i.swatch.swatch-confirmed'), t('legend.confirmed')]),
      U.el('span.legend-item', null, [U.el('i.swatch.swatch-pending'), t('legend.pending')]),
      U.el('span.legend-item', null, [U.el('i.swatch.swatch-mine'), t('legend.mine')]),
      resources().some(function (r) { return r.mode === 'APPROVAL'; }) ? U.el('span.legend-item', null, [t('legend.approval')]) : null,
      U.el('span.legend-hint', null, [t('legend.hint')])
    ]);
  }

  return { render: render, refresh: refresh, state: state, initialRange: initialRange, preload: preload, invalidate: invalidate, addLocal: addLocal, removeLocal: removeLocal, restore: restore, clearPersisted: clearPersisted, expectPreload: expectPreload, releasePreload: releasePreload };
})();
