/**
 * [app.js] — 진입점. 로그인 → 사용자·설정·장소 로드 → 탭 전환.
 *
 * 무엇을 한다: 전역 상태(RB.app.state)를 보관하고, 로그인 전후 화면을 바꾸고, 탭을 그린다.
 * 의존:        모든 모듈. index.html 맨 마지막에 로드된다.
 * 호출됨:      DOMContentLoaded
 * 주의:        상태는 여기 한 곳에만 둔다. 다른 모듈은 RB.app.state 를 읽기만 한다.
 */
window.RB = window.RB || {};

RB.app = (function () {
  var U = RB.ui, t = function (k, v) { return RB.i18n.t(k, v); };

  var state = { user: null, config: null, resources: [], tab: 'board' };
  var TABS = ['board', 'mine', 'approvals', 'status', 'settings'];

  var $ = function (id) { return document.getElementById(id); };

  function init() {
    RB.i18n.applyDom();

    if (RB.api.isMock()) $('mock-banner').hidden = false;

    RB.auth.init({ buttonEl: $('login-button'), signedIn: onSignedIn, signedOut: onSignedOut });
    $('signout').addEventListener('click', function () { RB.auth.signOut(); });

    TABS.forEach(function (tab) {
      $('tab-' + tab).addEventListener('click', function () { showTab(tab); });
    });
  }

  var SNAP_KEY = 'rb.snapshot';   // {email, me, resources} — 다음 로그인 때 첫 화면을 즉시 그리기 위한 사본

  function applyUser(me, resources) {
    state.user = me; state.config = me.config; state.resources = resources;
    U.signingIn(false);
    $('login').hidden = true; $('app').hidden = false;
    $('user-name').textContent = me.name || me.email;
    $('tab-approvals').hidden = !(me.isSuperAdmin || (me.approverOf || []).length);
    $('tab-status').hidden = !(me.isSuperAdmin || (me.approverOf || []).length);
    $('tab-settings').hidden = !me.isSuperAdmin;
    updateBadge(me.pendingApprovals || 0);
    updateMineBadge(me.pendingYields || 0);
  }

  function onSignedIn(profile) {
    var range = RB.board.initialRange();
    // 1) 이전 세션의 사본이 있으면 먼저 그린다(서버 왕복 2~3초를 기다리지 않게). 현황판은 서버에서 온다.
    var snap = null;
    try { snap = JSON.parse(localStorage.getItem(SNAP_KEY) || 'null'); } catch (e) { snap = null; }
    var painted = false;
    if (snap && snap.email === profile.email && snap.me && snap.resources) {
      applyUser(snap.me, snap.resources);
      RB.board.restore(profile.email);   // 사용자별 현황판 사본을 먼저 그린다(갱신은 뒤에서)
      RB.board.expectPreload(range);   // 이번 주는 init 응답을 기다린다(같은 요청을 두 번 보내지 않게)
      showTab('board');
      painted = true;
    }
    // 2) 서버에서 최신 상태 + 이번 주 현황판을 한 번에 받는다
    if (!painted) U.signingIn(true, t('login.loadingRooms'));
    RB.api.call('init', range).then(function (res) {
      if (res.session) RB.auth.setSession(res.session);   // 첫 로그인: init 이 세션까지 준다(다른 호출보다 먼저 저장)
      try { localStorage.setItem(SNAP_KEY, JSON.stringify({ email: profile.email, me: res.me, resources: res.resources })); } catch (e) { /* 무시 */ }
      applyUser(res.me, res.resources);
      if (res.board) RB.board.preload(range, res.board);
      else RB.board.releasePreload();
      RB.people.load();   // 참석자 자동완성용 디렉터리를 백그라운드로 받아 둔다
      if (!painted) showTab('board');   // 사본으로 이미 그린 경우: preload/releasePreload 가 현황판을 다시 그렸다
      var m = location.search.match(/[?&]complete=(R-\d+)/i);
      if (m) RB.bookingForm.openComplete(m[1].toUpperCase());
    }).catch(function (err) {
      RB.board.releasePreload();
      U.toast(err.message || t('error.network'), 'error');
      U.signingIn(false);
      if (!painted) RB.auth.signOut();
    });
  }

  function onSignedOut() {
    state.user = null;
    $('user-name').textContent = '';
    $('app').hidden = true; $('login').hidden = false;
    if (RB.api.isMock()) RB.auth.init({ buttonEl: $('login-button'), signedIn: onSignedIn, signedOut: onSignedOut });
  }

  function showTab(tab) {
    if (state.tab === 'status' && tab !== 'status' && RB.status && RB.status.stop) RB.status.stop();   // 현황 탭을 떠나면 자동 갱신을 멈춘다
    state.tab = tab;
    TABS.forEach(function (k) {
      $('tab-' + k).classList.toggle('active', k === tab);
      $('view-' + k).hidden = k !== tab;
    });
    if (tab === 'board') RB.board.render($('view-board'));
    if (tab === 'mine') RB.myBookings.render($('view-mine'));
    if (tab === 'approvals') RB.approvals.render($('view-approvals'));
    if (tab === 'status') RB.status.render($('view-status'));
    if (tab === 'settings') RB.settings.render($('view-settings'));
  }

  /** 승인 탭의 대기 건수 배지. 승인 탭이 처리할 때마다 갱신한다. */
  function updateBadge(n) {
    var b = $('approvals-badge');
    b.hidden = !n;
    b.textContent = n ? t('approvals.badge', { n: n }) : '';
  }

  /** 내 예약 탭의 '나에게 온 양보 질문' 건수 배지. */
  function updateMineBadge(n) {
    var b = $('mine-badge');
    b.hidden = !n;
    b.textContent = n ? t('approvals.badge', { n: n }) : '';
  }

  document.addEventListener('DOMContentLoaded', init);

  return { state: state, showTab: showTab, updateBadge: updateBadge, updateMineBadge: updateMineBadge };
})();
