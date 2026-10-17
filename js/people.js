/**
 * [people.js] — 참석자 자동완성용 로컬 디렉터리.
 *
 * 무엇을 한다: 로그인 뒤 백그라운드로 `directory`(이름·이메일 전체 목록)를 한 번 받아 localStorage 에 12시간 보관하고,
 *              입력 중에는 서버를 부르지 않고 이 목록에서 즉시 필터링한다. 최근에 초대한 사람은 위에 올린다.
 *              목록이 아직 없으면(첫 로그인 직후 몇 초) 서버 검색 `people` 로 대체한다.
 * 의존:        api.js
 * 호출됨:      app.js(load), bookingForm.js(search, remember)
 * 주의:        디렉터리는 같은 테넌트 사용자만. 목록 크기(수천 명)는 localStorage 에 충분히 들어간다.
 */
window.RB = window.RB || {};

RB.people = (function () {
  var DIR_KEY = 'rb.dir', RECENT_KEY = 'rb.recent';
  var TTL = 12 * 3600000;
  var dir = null;        // [{e, n}]
  var loading = null;

  function read(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; } }
  function write(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* 저장소 차단·용량 초과 */ } }

  /** 로그인 뒤 호출. 신선한 사본이 있으면 즉시, 없으면 백그라운드로 받는다. */
  function load() {
    var saved = read(DIR_KEY);
    var key = (RB.app.state.config && RB.app.state.config.directoryKey) || '';
    if (saved && saved.at && Date.now() - saved.at < TTL && Array.isArray(saved.users) && (saved.key || '') === key) { dir = saved.users; return Promise.resolve(dir); }
    if (loading) return loading;
    loading = RB.api.call('directory').then(function (res) {
      dir = res.users || [];
      write(DIR_KEY, { users: dir, at: Date.now(), key: key });
      loading = null;
      return dir;
    }).catch(function () { loading = null; return dir || []; });
    return loading;
  }

  function ready() { return !!dir; }

  /** 최근 초대한 사람(최대 20명). 예약 제출 시 기록. */
  function remember(emails) {
    var recent = read(RECENT_KEY) || [];
    (emails || []).forEach(function (e) {
      recent = recent.filter(function (x) { return x !== e; });
      recent.unshift(e);
    });
    write(RECENT_KEY, recent.slice(0, 20));
  }

  /**
   * 로컬 검색. 이름/이메일이 q 로 시작하는 것을 먼저, 포함하는 것을 다음에. 최근 초대는 맨 위.
   * @returns {Promise<Array<{email,name}>>}
   */
  function search(q, exclude) {
    var term = String(q || '').trim().toLowerCase();
    if (term.length < 1) return Promise.resolve([]);
    var taken = {}; (exclude || []).forEach(function (e) { taken[e] = true; });

    if (!dir) {
      // 아직 목록이 없으면 서버 검색(2글자 이상)으로 대체
      if (term.length < 2) return Promise.resolve([]);
      return RB.api.call('people', { q: term }).then(function (res) {
        return (res || []).filter(function (r) { return !taken[r.email]; });
      });
    }

    var recent = read(RECENT_KEY) || [];
    var starts = [], contains = [];
    for (var i = 0; i < dir.length; i++) {
      var u = dir[i];
      if (taken[u.e]) continue;
      var name = String(u.n || '').toLowerCase(), local = String(u.e || '').split('@')[0];
      var words = name.split(/\s+/);
      if (words.some(function (w) { return w.indexOf(term) === 0; }) || local.indexOf(term) === 0) starts.push(u);
      else if (name.indexOf(term) !== -1 || String(u.e || '').indexOf(term) !== -1) contains.push(u);
      if (starts.length >= 40) break;
    }
    var rank = function (u) { var r = recent.indexOf(u.e); return r === -1 ? 999 : r; };
    starts.sort(function (a, b) { return rank(a) - rank(b) || String(a.n || '').localeCompare(String(b.n || '')); });
    return Promise.resolve(starts.concat(contains).slice(0, 8).map(function (u) { return { email: u.e, name: u.n }; }));
  }

  return { load: load, ready: ready, search: search, remember: remember };
})();
