/**
 * [status.js] — 결재 현황 탭 (장소 담당자·슈퍼 관리자 전용, 읽기 전용).
 *
 * 무엇을 한다: 지금 기다리는 요청(얼마나 기다렸나·누구 차례인가)과 최근 30일 담당자·방·양보 질문 응답 현황을 카드로 보여준다.
 *              탭이 열려 있는 동안 5분마다 스스로 다시 불러온다. 슈퍼 관리자 = 전체, 담당자 = 자기 방만(서버가 좁혀서 준다).
 * 의존:        time.js, i18n.js, ui.js, api.js
 * 호출됨:      app.js (showTab: 열 때 render, 떠날 때 stop)
 * 주의:        시간은 모두 업무시간 기준(서버 계산). 탭을 떠나면 반드시 stop() 으로 타이머를 끈다.
 */
window.RB = window.RB || {};

RB.status = (function () {
  var U = RB.ui, T = RB.time, t = function (k, v) { return RB.i18n.t(k, v); };
  var REFRESH_MS = 300000;   // 5분
  var timer = null;
  var gen = 0;               // 떠난 뒤 늦게 도착한 응답을 버리기 위한 세대 번호

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
    gen++;
  }

  /** 이메일의 @ 앞부분 */
  function local(email) { return String(email || '').split('@')[0]; }
  function hours(v) { return v === null || v === undefined ? '–' : v + ' h'; }

  function render(host) {
    stop();
    var myGen = gen;
    var body = U.el('div.status-body');
    var stamp = U.el('span.muted.small');
    var refreshBtn = U.el('button.btn.btn-sm', { type: 'button', onclick: function () { load(); } }, [t('status.refresh')]);
    U.clear(host);
    host.appendChild(U.el('div.toolbar', null, [
      U.el('h2', null, [t('status.title')]),
      U.el('div.toolbar-group', null, [stamp, refreshBtn])
    ]));
    host.appendChild(body);
    body.appendChild(U.loadingBlock());

    function load() {
      RB.api.call('approvalBoard').then(function (data) {
        if (myGen !== gen) return;
        U.clear(body);
        stamp.textContent = t('status.updated', { time: T.fmtTime(new Date(data.generatedAt || Date.now())) });
        draw(body, data);
      }).catch(function (err) {
        if (myGen !== gen) return;
        U.clear(body);
        body.appendChild(U.el('p.error', null, [err.message || t('error.network')]));
      });
    }

    load();
    timer = setInterval(load, REFRESH_MS);
  }

  function draw(body, data) {
    var sum = data.summary || {};
    var pending = data.pending || [], byApprover = data.byApprover || [], byRoom = data.byRoom || [], byHolder = data.byHolder || [];

    body.appendChild(U.el('div.status-summary', null, [
      statCard(t('status.sum.waiting'), String(sum.waiting || 0), ''),
      statCard(t('status.sum.oldest'), (sum.oldestHours || 0) + ' h', (sum.oldestHours || 0) >= 4 ? 'stat-danger' : ''),
      statCard(t('status.sum.escalated'), String(sum.escalatedNow || 0), sum.escalatedNow > 0 ? 'stat-warn' : ''),
      statCard(t('status.sum.expired'), String(sum.expired30 || 0), sum.expired30 > 0 ? 'stat-warn' : '')
    ]));

    body.appendChild(U.el('h3.section-title', null, [t('status.waiting')]));
    if (!pending.length) body.appendChild(U.el('p.muted', null, [t('status.none')]));
    else body.appendChild(U.el('div.cards', null, pending.map(waitCard)));

    body.appendChild(U.el('h3.section-title', null, [t('status.approvers')]));
    body.appendChild(U.el('div.cards', null, byApprover.map(approverCard)));

    body.appendChild(U.el('h3.section-title', null, [t('status.rooms')]));
    body.appendChild(U.el('div.cards', null, byRoom.map(roomCard)));

    if (byHolder.length) {
      body.appendChild(U.el('h3.section-title', null, [t('status.holders')]));
      body.appendChild(U.el('div.cards', null, byHolder.map(holderCard)));
    }

    body.appendChild(U.el('p.muted.small.status-note', null, [t('status.note') + (data.scope === 'mine' ? ' ' + t('status.mine') : '')]));
  }

  function statCard(label, value, cls) {
    return U.el('div.card.stat-card' + (cls ? '.' + cls : ''), null, [
      U.el('div.stat-value', null, [value]),
      U.el('div.muted.small', null, [label])
    ]);
  }

  /** 라벨: 값 한 줄. warn 이면 경고 강조(색만이 아니라 굵게 + 표식). */
  function metric(label, value, warn) {
    return U.el('div.metric' + (warn ? '.metric-warn' : ''), null, [
      U.el('span.muted', null, [label]),
      U.el('b', null, [(warn ? '⚠ ' : '') + value])
    ]);
  }

  function waitCard(p) {
    var lang = RB.i18n.get();
    var h = p.waitingHours || 0;
    var level = p.escalated || h >= 4 ? 'wait-late' : h >= 2 ? 'wait-warn' : 'wait-ok';
    var turn = p.stage === 'holder'
      ? t('status.turn.holder')
      : t('status.turn.approver') + ': ' + (p.approvers || []).map(local).join(', ');
    return U.el('div.card.wait-card.' + level, null, [
      U.el('div.card-head', null, [
        U.el('span.card-title', null, [p.title || p.requestId]),
        p.escalated ? U.el('span.badge.badge-rejected', null, [t('status.escalated')]) : null
      ]),
      U.el('div.muted', null, [p.room + (p.startAt ? ' · ' + T.fmtDateTime(new Date(p.startAt), lang) : '')]),
      U.el('div.kv', null, [t('status.waited', { h: h })]),
      U.el('div.kv', null, [turn]),
      p.expiresAt ? U.el('div.muted.small', null, [t('status.deadline') + ': ' + T.fmtDateTime(new Date(p.expiresAt), lang)]) : null
    ]);
  }

  function approverCard(a) {
    return U.el('div.card.stat-block' + (a.expired > 0 ? '.stat-warn' : ''), null, [
      U.el('div.card-title', null, [local(a.email)]),
      U.el('div.muted.small', null, [(a.rooms || []).join(', ')]),
      metric(t('status.decided'), (a.decided || 0) + ' / ' + (a.assigned || 0)),
      metric(t('status.median'), hours(a.medianHours)),
      metric(t('status.longest'), hours(a.maxHours)),
      metric(t('status.escalated'), String(a.escalated || 0)),
      metric(t('status.expired'), String(a.expired || 0), a.expired > 0)
    ]);
  }

  function roomCard(r) {
    return U.el('div.card.stat-block' + (r.expired > 0 ? '.stat-warn' : ''), null, [
      U.el('div.card-title', null, [r.room]),
      U.el('div.muted.small', null, [(r.approvers || []).map(local).join(', ')]),
      metric(t('status.decided'), (r.decided || 0) + ' / ' + (r.requests || 0)),
      metric(t('status.median'), hours(r.medianHours)),
      metric(t('status.longest'), hours(r.maxHours)),
      metric(t('status.escalated'), String(r.escalated || 0)),
      metric(t('status.expired'), String(r.expired || 0), r.expired > 0)
    ]);
  }

  function holderCard(h) {
    return U.el('div.card.stat-block' + (h.noAnswer > 0 ? '.stat-warn' : ''), null, [
      U.el('div.card-title', null, [local(h.email)]),
      metric(t('status.asked'), String(h.asked || 0)),
      metric(t('status.yes'), String(h.yes || 0)),
      metric(t('status.no'), String(h.no || 0)),
      metric(t('status.noAnswer'), String(h.noAnswer || 0), h.noAnswer > 0)
    ]);
  }

  return { render: render, stop: stop };
})();
