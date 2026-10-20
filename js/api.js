/**
 * [api.js] — 백엔드 호출 래퍼.
 *
 * 무엇을 한다: {idToken, action, params} 를 Apps Script 웹앱에 POST 하고 {ok, data|error} 를 돌려준다.
 *              mock 모드면 네트워크 대신 RB.mock.handle() 로 보낸다.
 * 의존:        config.js, auth.js(토큰), mock.js(선택)
 * 호출됨:      board.js, bookingForm.js, myBookings.js, approvals.js, app.js
 * 주의:        Content-Type 을 text/plain 으로 보내야 CORS 프리플라이트 없이 Apps Script 에 닿는다.
 *              (application/json 은 프리플라이트가 붙고 Apps Script 가 이를 처리하지 못한다.)
 *              오류는 예외로 던진다: {code, message}. code 'AUTH' 면 호출부가 재로그인 처리.
 *              조회만 시간 제한 후 최대 2번 재시도 — Google 응답 경로가 가끔 30초 이상 붙잡거나 404 를 줘서(2026-10-20 측정). 쓰기는 이미 처리됐을 수 있어 다시 보내지 않는다.
 * 정책 근거:   D-02, D-03 · 계약은 docs/02-아키텍처.md 3절
 */
window.RB = window.RB || {};

RB.api = (function () {
  function isMock() {
    return RB.config.MOCK || /[?&]mock=1/.test(location.search);
  }

  /**
   * 액션 호출. 성공 시 data, 실패 시 {code, message} 예외.
   * @param {string} action  'me' | 'resources' | 'board' | 'book' | ...
   * @param {Object} params
   * @returns {Promise<*>}
   */
  var recent = [];   // 최근 호출 기록 [{action, total, server, steps, error, attempts, at}] — Settings 탭 성능표. attempts = 보낸 횟수(mock 은 0)
  function log(action, t0, meta, err, attempts) {
    recent.unshift({ action: action, total: Date.now() - t0, server: meta ? meta.ms : null, steps: meta ? meta.steps : null, error: err ? (err.code || 'ERR') : '', attempts: attempts || 0, at: new Date() });
    if (recent.length > 25) recent.pop();
  }

  // 조회 액션: 전송 실패(시간 초과·fetch 실패·JSON 아님)면 다시 보낸다. 여기 없는 액션(쓰기·모르는 액션)은 한 번만 보낸다.
  var READ_ACTIONS = ['session', 'init', 'me', 'resources', 'board', 'people', 'directory', 'myBookings', 'approvals', 'approvalBoard', 'approvalStats', 'zoomUsage', 'healthCheck'];
  // 서버 계산이 오래 걸리는 조회는 더 긴 시간 제한을 쓴다.
  var SLOW_READ_ACTIONS = ['zoomUsage', 'approvalStats', 'healthCheck'];
  function isRead(action) { return READ_ACTIONS.indexOf(action) >= 0; }
  // 설정은 호출할 때마다 RB.config 에서 읽는다. 기본값은 여기 둔다.
  function timeoutFor(action) {
    if (!isRead(action)) return RB.config.API_WRITE_TIMEOUT_MS || 60000;
    return SLOW_READ_ACTIONS.indexOf(action) >= 0 ? (RB.config.API_SLOW_TIMEOUT_MS || 90000) : (RB.config.API_TIMEOUT_MS || 15000);
  }

  function call(action, params) {
    var t0 = Date.now();
    var st = { attempts: 0 };   // 실제로 보낸 횟수(재시도 포함)
    RB.ui.progress(true);
    var p = isMock()
      ? RB.mock.handle(action, params || {}).then(function (d) { return { data: d, meta: null }; })
      : send(action, params || {}, st);
    return p.then(function (r) { RB.ui.progress(false); log(action, t0, r.meta, null, st.attempts); return r.data; },
      function (err) { RB.ui.progress(false); log(action, t0, null, err, st.attempts); throw err; });
  }

  /**
   * 액션 하나를 보낸다. 조회는 전송 실패 시 대기 후 다시 보내고, 쓰기는 한 번만 보낸다.
   * 서버가 {ok:false} 로 답한 오류는 다시 보내지 않는다.
   * @param {Object} st  {attempts} — 보낸 횟수를 센다
   */
  function send(action, params, st) {
    var delays = isRead(action) ? (RB.config.API_RETRY_DELAYS_MS || [1000, 3000]) : [];
    return attempt(action, params, st, delays, 0);
  }

  function attempt(action, params, st, delays, i) {
    st.attempts++;
    // 토큰이 만료됐을 수 있으니 보내기 전에 매번 갱신한다
    return RB.auth.ensureFresh()
      .then(function () { return post(action, params); })
      .then(function (json) {
        if (!json || json.ok !== true) {
          var err = (json && json.error) || { code: 'UNKNOWN', message: '' };
          if (err.code === 'AUTH') RB.auth.onAuthError(err);
          throw err;
        }
        return { data: json.data, meta: json.meta || null };
      }, function (err) {
        if (!(err && err.transport)) throw err;   // 전송 실패가 아니면 그대로 넘긴다
        if (i < delays.length) {
          return wait(delays[i]).then(function () { return attempt(action, params, st, delays, i + 1); });
        }
        throw { code: 'NETWORK', message: RB.i18n.t(isRead(action) ? 'error.network' : 'error.networkWrite') };
      });
  }

  function wait(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  /**
   * 한 번 보낸다. 액션의 시간 제한이 지나면 fetch 를 중단(abort)한다.
   * 응답 JSON 을 돌려주고, 전송 실패(중단·fetch 실패·JSON 아님)면 {transport:true} 로 던진다.
   */
  function post(action, params) {
    // 세션 토큰이 있으면 그걸로, 없으면(session 교환 직전) Google ID 토큰으로 인증한다
    var body = JSON.stringify({
      sessionToken: RB.auth.sessionToken(),
      idToken: RB.auth.sessionToken() ? undefined : RB.auth.token(),
      action: action,
      params: params || {}
    });

    var opts = { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: body };
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = null;
    if (ctrl) {
      opts.signal = ctrl.signal;
      timer = setTimeout(function () { ctrl.abort(); }, timeoutFor(action));
    }

    return fetch(RB.config.API_URL, opts)
      .then(function (res) { return res.json(); })
      .then(function (json) { clearTimeout(timer); return json; },
        function () { clearTimeout(timer); throw { code: 'NETWORK', transport: true }; });
  }

  return { call: call, isMock: isMock, recent: function () { return recent.slice(); } };
})();
