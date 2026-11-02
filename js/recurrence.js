/**
 * [recurrence.js] — 반복 규칙에서 실제 날짜 목록을 만든다.
 *
 * 무엇을 한다: expand(시작 날짜 키, 반복 규칙) → ['YYYY-MM-DD', ...]. 예약 폼의 날짜 미리보기와 mock.js 가 같이 쓴다.
 *              매일 · 매주(여러 요일·N주 간격) · 격주 · 매월(같은 일자 / n째 요일 / 마지막 요일).
 * 의존:        없음 (다른 RB 모듈을 쓰지 않는다)
 * 호출됨:      bookingForm.js (미리보기), mock.js (expand)
 * 주의:        서버 Recurrence.gs 와 같은 날짜를 만든다 — 한쪽을 고치면 다른 쪽도 고친다.
 *              날짜 키 문자열과 Date.UTC 계산만 쓰므로 브라우저 시간대와 무관하다.
 *              count 가 있으면 count(최대 52)가 우선, 없으면 until(그 날 포함). 둘 다 없으면 시작일 하나.
 */
window.RB = window.RB || {};

RB.recurrence = (function () {
  var CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];   // 월요일부터
  var MAX = 52;
  var DAY = 86400000;            // 하루(ms)
  var DAYS_PER_WEEK = 7;
  var MAX_DAYS_SCAN = 400;       // 매일 전개 상한(안전장치)
  var MAX_WEEKS_SCAN = 400;      // 매주 전개 상한(안전장치)
  var MAX_MONTHS_SCAN = 60;      // 매월 전개 상한(안전장치)

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function key(ms) {
    var d = new Date(ms);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }
  /** 0=월 … 6=일 */
  function isoIndex(ms) { return (new Date(ms).getUTCDay() + 6) % 7; }

  /**
   * 후보 날짜를 모으는 수집기를 만든다. add(ms) 는 끝에 닿았으면 false(전개를 멈춘다).
   * @param {number} limit 최대 개수
   * @param {?string} until 마지막 날짜 키(그 날 포함), 없으면 null
   * @returns {{out: string[], add: function(number): boolean}}
   */
  function makeCollector(limit, until) {
    var out = [];
    function add(ms) {
      if (out.length >= limit) return false;
      var k = key(ms);
      if (until && k > until) return false;
      out.push(k);
      return out.length < limit;
    }
    return { out: out, add: add };
  }

  /** 매일: 시작일부터 하루씩. */
  function expandDaily(startMs, add) {
    for (var i = 0; i < MAX_DAYS_SCAN; i++) { if (!add(startMs + i * DAY)) break; }
  }

  /** 매주·격주: 고른 요일(+시작일의 요일)을 N주 간격으로. */
  function expandWeekly(startMs, rec, add) {
    var interval = rec.freq === 'biweekly' ? 2 : (Number(rec.interval) || 1);
    var picked = {};
    (rec.days || []).forEach(function (c) { if (CODES.indexOf(c) !== -1) picked[c] = true; });
    picked[CODES[isoIndex(startMs)]] = true;
    var monday = startMs - isoIndex(startMs) * DAY;
    var done = false;
    for (var w = 0; w < MAX_WEEKS_SCAN && !done; w++) {
      for (var k = 0; k < CODES.length && !done; k++) {
        if (!picked[CODES[k]]) continue;
        var ms = monday + (w * interval * DAYS_PER_WEEK + k) * DAY;
        if (ms < startMs) continue;
        if (!add(ms)) done = true;
      }
    }
  }

  /** 매월: 같은 일자(date) / n째 요일(nth) / 마지막 요일(last). */
  function expandMonthly(y, mo, d, rec, add) {
    var startMs = Date.UTC(y, mo, d);
    var mode = rec.monthly || 'date';
    var wd = isoIndex(startMs), nth = Math.ceil(d / DAYS_PER_WEEK);
    for (var j = 0; j < MAX_MONTHS_SCAN; j++) {
      var first = Date.UTC(y, mo + j, 1);
      var fy = new Date(first).getUTCFullYear(), fm = new Date(first).getUTCMonth();
      var dim = new Date(Date.UTC(fy, fm + 1, 0)).getUTCDate();
      var day;
      if (mode === 'nth' || mode === 'last') {
        var firstWd = 1 + ((wd - isoIndex(first) + DAYS_PER_WEEK) % DAYS_PER_WEEK);   // 그 달 첫 해당 요일의 일자
        day = mode === 'last' ? firstWd + DAYS_PER_WEEK * Math.floor((dim - firstWd) / DAYS_PER_WEEK) : firstWd + DAYS_PER_WEEK * (nth - 1);
      } else {
        day = d;
      }
      if (day < 1 || day > dim) continue;   // 그 달에 없는 날짜는 건너뜀(당기지 않음)
      var cand = Date.UTC(fy, fm, day);
      if (cand < startMs) continue;
      if (!add(cand)) break;
    }
  }

  /**
   * @param {string} dateKey 시작 날짜 'YYYY-MM-DD'
   * @param {Object} rec {freq, interval?, days?, monthly?, until?, count?}
   * @returns {string[]} 날짜 키 목록 (첫 항목은 시작 날짜)
   */
  function expand(dateKey, rec) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey || '');
    if (!m || !rec || !rec.freq || rec.freq === 'none') return [dateKey];
    if (!rec.count && !rec.until) return [dateKey];

    var limit = rec.count ? Math.min(MAX, Number(rec.count)) : MAX;
    var until = rec.count ? null : (rec.until || null);
    var y = Number(m[1]), mo = Number(m[2]) - 1, d = Number(m[3]);
    var startMs = Date.UTC(y, mo, d);
    var c = makeCollector(limit, until);

    if (rec.freq === 'daily') { expandDaily(startMs, c.add); return c.out; }
    if (rec.freq === 'weekly' || rec.freq === 'biweekly') { expandWeekly(startMs, rec, c.add); return c.out; }
    if (rec.freq === 'monthly') { expandMonthly(y, mo, d, rec, c.add); return c.out; }
    return [dateKey];
  }

  return { expand: expand };
})();
