/**
 * [auth.js] — Google 로그인(GIS)과 토큰 보관.
 *
 * 무엇을 한다: Google Identity Services 버튼을 그리고, 받은 ID 토큰을 메모리에 보관한다.
 *              토큰 만료(exp)를 스스로 확인하고, 백엔드가 AUTH 오류를 주면 로그아웃 처리한다.
 *              mock 모드에서는 가짜 사용자 선택 UI 를 대신 보여준다.
 * 의존:        config.js, i18n.js, (실모드) https://accounts.google.com/gsi/client
 * 호출됨:      app.js 가 init() 을 부르고 onSignedIn 콜백을 받는다. api.js 가 token() 을 읽는다.
 * 주의:        Google ID 토큰은 1시간짜리라 백엔드 세션 토큰(12시간)으로 바꿔 localStorage 에 보관한다.
 *              첫 로그인: 'session' 을 따로 부르지 않고 app 의 init 을 ID 토큰으로 불러 그 응답에서 세션을 받는다
 *              (setSession — 콜드 스타트 왕복 1회 절약). 세션 만료 후 갱신: GIS 에 새 ID 토큰을 요청해 'session' 으로 교환한다.
 * 정책 근거:   D-03
 */
window.RB = window.RB || {};

RB.auth = (function () {
  var SESSION_KEY = 'rb.session';   // {token, exp, email, name}
  var session = null;
  var idToken = null;
  var profile = null;      // {email, name, picture} — 토큰 payload 에서 읽음. 서버가 최종 검증.
  var onSignedIn = null;
  var onSignedOut = null;
  var gisReady = false;
  var refreshWaiters = [];  // ensureFresh 가 새 토큰을 기다리는 콜백들

  /** JWT payload 디코딩 (검증은 하지 않는다 — 서버 몫) */
  function decode(jwt) {
    try {
      var payload = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(decodeURIComponent(escape(atob(payload))));
    } catch (e) { return null; }
  }

  function token() { return idToken; }
  function sessionToken() { return session && session.exp > Date.now() ? session.token : null; }
  function user() { return profile; }

  function saveSession(s) {
    session = s;
    try { s ? localStorage.setItem(SESSION_KEY, JSON.stringify(s)) : localStorage.removeItem(SESSION_KEY); } catch (e) { /* 저장소 차단 */ }
  }

  /** Google ID 토큰 → 백엔드 세션 토큰 교환 */
  function exchange() {
    if (idToken === 'mock') { saveSession({ token: 'mock', exp: Date.now() + 12 * 3600000, email: profile.email, name: profile.name }); return Promise.resolve(); }
    session = null;
    return RB.api.call('session').then(function (s) {
      saveSession({ token: s.token, exp: s.exp, email: s.user.email, name: s.user.name });
    });
  }

  /** init 응답이 가져온 세션({token, exp, user})을 저장한다. */
  function setSession(s) {
    if (!s || !s.token || !s.user) return;
    saveSession({ token: s.token, exp: s.exp, email: s.user.email, name: s.user.name });
    if (profile) { profile.email = s.user.email || profile.email; profile.name = s.user.name || profile.name; }
  }

  /** 세션 기준 만료 판정(60초 여유). 세션이 없으면 ID 토큰 기준. */
  function isExpired() {
    if (session) return session.exp - 60000 < Date.now();
    if (!idToken) return true;
    var p = decode(idToken);
    return !p || !p.exp || (p.exp * 1000 - 60000) < Date.now();
  }

  function handleCredential(response) {
    var wasSignedIn = !!idToken;
    if (!wasSignedIn) RB.ui.signingIn(true);
    idToken = response.credential;
    var p = decode(idToken) || {};
    profile = { email: p.email, name: p.name, picture: p.picture };
    if (!wasSignedIn) {   // 첫 로그인: 세션은 init 응답이 가져온다
      if (onSignedIn) onSignedIn(profile);
      return;
    }
    exchange().then(function () {
      // 세션 갱신을 기다리던 호출들을 깨운다
      var waiters = refreshWaiters; refreshWaiters = [];
      waiters.forEach(function (w) { w.resolve(); });
    }).catch(function (err) {
      var waiters = refreshWaiters; refreshWaiters = [];
      waiters.forEach(function (w) { w.reject && w.reject(err); });
      RB.ui.toast(err && err.message ? err.message : RB.i18n.t('login.expired'), 'error');
      signOut();
    });
  }

  function signOut() {
    RB.ui.signingIn(false);
    idToken = null; profile = null; saveSession(null);
    try { sessionStorage.removeItem('rb.idt'); } catch (e) { /* 무시 — 예전 버전이 남긴 ID 토큰 사본 정리 */ }
    try { localStorage.removeItem('rb.snapshot'); localStorage.removeItem('rb.recent'); } catch (e) { /* 무시 */ }   // 개인정보: 디렉터리 캐시·최근 초대자
    RB.board && RB.board.clearPersisted && RB.board.clearPersisted();   // 개인정보: 현황판 사본 삭제
    if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect();
    if (onSignedOut) onSignedOut();
  }

  /**
   * API 호출 전에 토큰이 살아 있는지 확인하고, 만료(임박)면 GIS 에 새 토큰을 요청한다.
   * 8초 안에 새 토큰이 오지 않으면 AUTH 오류 → 로그인 화면.
   */
  function ensureFresh() {
    if (idToken === 'mock' || !isExpired()) return Promise.resolve();
    if (!session && idToken) return Promise.resolve(); // 세션 교환 호출 자체
    if (!gisReady) return Promise.reject({ code: 'AUTH', message: RB.i18n.t('login.expired') });
    return new Promise(function (resolve, reject) {
      var waiter = null;
      var timer = setTimeout(function () {
        refreshWaiters = refreshWaiters.filter(function (w) { return w !== waiter; });
        onAuthError({ message: 'expired' });
        reject({ code: 'AUTH', message: RB.i18n.t('login.expired') });
      }, 8000);
      waiter = { resolve: function () { clearTimeout(timer); resolve(); }, reject: function (e) { clearTimeout(timer); reject(e); } };
      refreshWaiters.push(waiter);
      try { google.accounts.id.prompt(); } catch (e) { clearTimeout(timer); reject({ code: 'AUTH', message: RB.i18n.t('login.expired') }); }
    });
  }

  /** 백엔드가 AUTH 오류를 돌려줬을 때. 서버가 보낸 이유를 그대로 보여준다(원인 구분용). */
  function onAuthError(err) {
    signOut();
    RB.ui.toast(err && err.message ? err.message : RB.i18n.t('login.expired'), 'error');
  }

  /**
   * 로그인 UI 초기화.
   * @param {{signedIn:function, signedOut:function, buttonEl:Element}} opts
   */
  function init(opts) {
    onSignedIn = opts.signedIn;
    onSignedOut = opts.signedOut;

    // 새로고침: 유효한 세션이 남아 있으면 GIS 를 기다리지 않고 바로 들어간다 (mock 모드도 동일)
    var savedSession = null;
    try { savedSession = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { savedSession = null; }
    if (savedSession && savedSession.exp > Date.now() + 60000) {
      session = savedSession;
      idToken = savedSession.token === 'mock' ? 'mock' : 'session';
      profile = { email: savedSession.email, name: savedSession.name };
      if (onSignedIn) onSignedIn(profile);
    } else {
      saveSession(null);
    }

    if (RB.api.isMock()) { RB.mock.renderLogin(opts.buttonEl, mockSignIn); return; }

    // 클라이언트 ID 가 아직 없으면 GIS 를 띄우지 않는다(Google 400 오류 화면 대신 안내).
    if (!RB.config.CLIENT_ID) {
      opts.buttonEl.appendChild(RB.ui.el('p.note', null, [RB.i18n.t('login.notConfigured')]));
      return;
    }

    var script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = function () {
      google.accounts.id.initialize({
        client_id: RB.config.CLIENT_ID,
        callback: handleCredential,
        auto_select: true,
        itp_support: true,
        use_fedcm_for_prompt: true
      });
      gisReady = true;
      google.accounts.id.renderButton(opts.buttonEl, { theme: 'outline', size: 'large', width: 280 });
      if (!idToken) google.accounts.id.prompt(); // One Tap: 이미 로그인된 브라우저면 클릭 없이 진행
    };
    document.head.appendChild(script);
  }

  /** mock 모드 로그인: mock.js 가 고른 가짜 사용자를 그대로 받는다 */
  function mockSignIn(fakeProfile) {
    RB.ui.signingIn(true);
    idToken = 'mock';
    profile = fakeProfile;
    exchange().then(function () { if (onSignedIn) onSignedIn(profile); });
  }

  return { init: init, token: token, sessionToken: sessionToken, setSession: setSession, user: user, isExpired: isExpired, signOut: signOut, onAuthError: onAuthError, ensureFresh: ensureFresh };
})();
