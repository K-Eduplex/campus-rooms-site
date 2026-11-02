/**
 * [settings.js] — 관리자 설정 탭 (슈퍼 관리자 전용).
 *
 * 무엇을 한다: 설정 시트 링크, 현재 정책값 요약, 장소 재가져오기 버튼, 설정 점검 실행, 관리자 알림 안내를 보여준다.
 *              값을 직접 편집하는 화면은 만들지 않는다 — 편집은 시트에서(D-13 ⑤).
 * 의존:        i18n.js, ui.js, api.js, app.js(state)
 * 호출됨:      app.js (isSuperAdmin 일 때만 탭 노출)
 * 주의:        importRooms / healthCheck 는 백엔드에서 수십 초 걸릴 수 있다. 버튼을 처리 중 비활성화한다.
 * 정책 근거:   D-13 ⑤, docs/03-운영-FAQ.md
 */
window.RB = window.RB || {};

RB.settings = (function () {
  var U = RB.ui, t = function (k, v) { return RB.i18n.t(k, v); };
  var ZOOM_SUMMARY_LEVELS_MAX = 5;      // 동시 사용 요약에 보여주는 최대 단계(2~5개 이상)
  var ZOOM_ISSUE_LEVEL = 4;             // 이 단계 이상 동시 사용이 있으면 "확인 필요" 판정
  var ZOOM_ISSUE_DATES_MAX = 10;        // 판정 문구에 나열할 날짜 수
  var ZOOM_ERRORS_MAX = 5;              // 일부 실패 문구에 나열할 항목 수
  var MINUTES_PER_HOUR = 60;
  var DECIMAL_SHIFT = 10;               // 소수 첫째 자리 반올림용

  function render(host) {
    U.clear(host);
    var user = RB.app.state.user, cfg = RB.app.state.config;
    host.appendChild(U.el('div.settings', null, [
      introCard(user),
      roomsCard(),
      zoomUsageCard(),
      approvalStatsCard(),
      policyCard(cfg),
      peopleCard(),
      webhookCard(user),
      perfCard(host),
      notifyCard()
    ]));
  }

  /** 카드 안의 버튼 줄(왼쪽 정렬). */
  function actionsRow(buttons) {
    return U.el('div.actions', { style: { justifyContent: 'flex-start' } }, buttons);
  }

  /** 시트 링크 카드. */
  function introCard(user) {
    return U.el('div.card', null, [
      U.el('h3', null, [t('settings.title')]),
      U.el('p', null, [t('settings.intro')]),
      U.el('a.btn.btn-primary', { href: user.sheetUrl || '#', target: '_blank', rel: 'noopener' }, [t('settings.openSheet')])
    ]);
  }

  /** 장소 표의 한 줄: 이름·별칭 / 보드·모드·정원·승인자. */
  function roomRow(r) {
    return U.el('tr', null, [
      U.el('td', null, [r.name + (r.aliases && r.aliases.length ? ' · ' + r.aliases.join(', ') : '')]),
      U.el('td', null, [t('board.group.' + (r.board || 'MAIN')) + (r.active === false ? ' · ' + t('board.inactive') : '') + ' · ' + t('mode.' + r.mode) + (r.capacity ? ' · ' + r.capacity : '') + (r.approvers ? ' · ' + r.approvers.join(', ') : '')])
    ]);
  }

  /** 장소 카드: 재가져오기 버튼과 장소 표. */
  function roomsCard() {
    var importBtn = U.el('button.btn', { type: 'button', onclick: function () { run(importBtn, 'importRooms', importResult); } }, [t('settings.import')]);
    var importOut = U.el('p.muted');
    function importResult(data) {
      importOut.textContent = t('settings.import.done', { added: data.added, total: data.total });
      RB.api.call('resources').then(function (list) { RB.app.state.resources = list; });
    }
    return U.el('div.card', null, [
      U.el('h3', null, [t('settings.rooms')]),
      U.el('p.muted', null, [t('settings.rooms.hint')]),
      actionsRow([importBtn]), importOut,
      U.el('table.kv-table', null, RB.app.state.resources.map(roomRow))
    ]);
  }

  /** 설정 점검 결과를 out 에 그린다. */
  function showHealthChecks(out, data) {
    U.clear(out);
    var bad = data.checks.filter(function (c) { return !c.ok; }).length;
    out.appendChild(U.el('p.' + (bad ? 'error' : 'muted'), null, [bad ? t('settings.health.issues', { n: bad }) : t('settings.health.ok')]));
    out.appendChild(U.el('ul.check-list', null, data.checks.map(function (c) {
      return U.el('li.' + (c.ok ? 'ok' : 'bad'), null, [(c.ok ? '✓ ' : '✗ ') + c.label + (c.detail ? ' — ' + c.detail : '')]);
    })));
  }

  /** 정책값 요약 카드와 설정 점검 버튼. */
  function policyCard(cfg) {
    var healthBtn = U.el('button.btn', { type: 'button', onclick: function () { run(healthBtn, 'healthCheck', function (data) { showHealthChecks(healthOut, data); }); } }, [t('settings.health')]);
    var healthOut = U.el('div');
    return U.el('div.card', null, [
      U.el('h3', null, [t('settings.policy')]),
      U.el('table.kv-table', null, [
        kv('settings.policy.businessHours', cfg.businessHours),
        kv('settings.policy.escalation', cfg.escalationHours),
        kv('settings.policy.expiry', cfg.expiryHours),
        kv('settings.policy.minLead', cfg.minLeadHours),
        kv('settings.policy.protect', cfg.protectHours),
        kv('settings.policy.slot', cfg.slotMinutes),
        kv('settings.policy.display', cfg.displayHours),
        kv('settings.policy.advance', cfg.maxAdvanceDays),
        kv('settings.policy.domains', (cfg.domains || []).join(', ')),
        kv('settings.policy.superAdmins', (cfg.superAdmins || []).join(', ')),
        kv('settings.policy.grades', (cfg.grades || []).map(function (g) { return t('grade.' + g.code); }).join(' > '))
      ]),
      actionsRow([healthBtn]), healthOut
    ]);
  }

  /** 사람 명단 일괄 추가 카드. */
  function peopleCard() {
    var peopleIn = U.el('textarea.input', { rows: 5, placeholder: t('settings.people.ph') });
    var peopleOut = U.el('p.muted');
    var peopleBtn = U.el('button.btn.btn-primary', { type: 'button', onclick: function () {
      if (!peopleIn.value.trim()) { peopleIn.focus(); return; }
      var done = U.busy(peopleBtn);
      RB.api.call('addPeople', { text: peopleIn.value }).then(function (r) {
        peopleOut.textContent = t('settings.people.done', { parsed: r.parsed, added: r.added, updated: r.updated, total: r.total, preview: (r.preview || []).join(', ') });
        peopleIn.value = '';
        try { localStorage.removeItem('rb.dir'); } catch (e) { /* 무시 */ }
        RB.people.load();
      }).catch(function (err) { U.toast(t('result.error', { message: err.message || err.code }), 'error'); }).then(done);
    } }, [t('settings.people.add')]);
    return U.el('div.card', null, [
      U.el('h3', null, [t('settings.people')]),
      U.el('p.muted', null, [t('settings.people.hint')]),
      peopleIn,
      actionsRow([peopleBtn]), peopleOut
    ]);
  }

  /** 알림 웹훅 카드: 저장·해제·시험 발송. */
  function webhookCard(user) {
    var webhookStatus = U.el('p', null, [t(user.webhookConfigured ? 'settings.webhook.status.on' : 'settings.webhook.status.off')]);
    var webhookIn = U.el('input.input', { type: 'url', placeholder: t('settings.webhook.ph'), autocomplete: 'off' });
    var webhookOut = U.el('p.muted');
    function saveWebhook(url) {
      var done = U.busy(webhookBtn);
      RB.api.call('setWebhook', { url: url }).then(function (r) {
        webhookOut.textContent = t(r.configured ? 'settings.webhook.on' : 'settings.webhook.off');
        webhookStatus.textContent = t(r.configured ? 'settings.webhook.status.on' : 'settings.webhook.status.off');
        user.webhookConfigured = r.configured; webhookIn.value = '';
      }).catch(function (err) { U.toast(t('result.error', { message: err.message || err.code }), 'error'); }).then(done);
    }
    var webhookBtn = U.el('button.btn.btn-primary', { type: 'button', onclick: function () { if (!webhookIn.value.trim()) { webhookIn.focus(); return; } saveWebhook(webhookIn.value.trim()); } }, [t('settings.webhook.save')]);
    var webhookOff = U.el('button.btn', { type: 'button', onclick: function () { saveWebhook(''); } }, [t('settings.webhook.clear')]);
    var announceBtn = U.el('button.btn', { type: 'button', onclick: function () { run(announceBtn, 'testAnnounce', function () { webhookOut.textContent = t('settings.testAnnounce.done'); }); } }, [t('settings.testAnnounce')]);
    return U.el('div.card', null, [
      U.el('h3', null, [t('settings.webhook')]),
      U.el('p.muted', null, [t('settings.webhook.hint')]),
      webhookStatus,
      webhookIn,
      actionsRow([webhookBtn, webhookOff, announceBtn]), webhookOut
    ]);
  }

  /** 최근 API 호출 시간표 카드와 새로고침 버튼(화면 전체를 다시 그린다). */
  function perfCard(host) {
    return U.el('div.card', null, [
      U.el('h3', null, [t('settings.perf')]),
      U.el('p.muted', null, [t('settings.perf.hint')]),
      perfTable(),
      actionsRow([U.el('button.btn.btn-sm', { type: 'button', onclick: function () { render(host); } }, [t('settings.perf.refresh')])])
    ]);
  }

  /** 관리자 알림 안내 카드와 시험 메일 버튼. */
  function notifyCard() {
    var testOut = U.el('p.muted');
    var testBtn = U.el('button.btn', { type: 'button', onclick: function () { run(testBtn, 'testEmail', function (r) { testOut.textContent = t('settings.testEmail.done', { sent: r.sent, to: r.to }); }); } }, [t('settings.testEmail')]);
    return U.el('div.card', null, [
      U.el('h3', null, [t('settings.notify')]),
      U.el('p', null, [t('settings.notify.text')]),
      actionsRow([testBtn]), testOut
    ]);
  }

  /** 최근 API 호출 시간표: 액션, 총 대기, 서버 처리, 단계 */
  function perfTable() {
    var rows = RB.api.recent();
    if (!rows.length) return U.el('p.muted', null, ['—']);
    var tbl = U.el('table.kv-table.perf');
    tbl.appendChild(U.el('tr', null, [U.el('th', null, ['Action']), U.el('th', null, ['Total']), U.el('th', null, ['Server']), U.el('th', null, ['Steps'])]));
    rows.forEach(function (r) {
      var steps = (r.steps || []).map(function (s) { return s[0] + ' ' + s[1] + 'ms'; }).join(' → ');
      tbl.appendChild(U.el('tr', null, [
        U.el('td', null, [r.action + (r.error ? ' (' + r.error + ')' : '')]),
        U.el('td', null, [r.total + ' ms']),
        U.el('td', null, [r.server === null ? '–' : r.server + ' ms']),
        U.el('td.muted', null, [steps])
      ]));
    });
    return tbl;
  }

  // ---- Zoom 사용량 카드 ------------------------------------------------------

  /** 판정 문구(문제 없음 / 확인 필요)를 out 에 넣고, 일부 달 조회 실패가 있으면 그 안내를 이어서 넣는다. */
  function appendZoomVerdict(out, data) {
    var c = data.concurrency, months = data.months || [];
    var h4 = (c.minutesAtLeast[ZOOM_ISSUE_LEVEL] || 0) / MINUTES_PER_HOUR;
    var days4 = c.daysAtLeast[ZOOM_ISSUE_LEVEL] || [];
    var verdictClass = h4 === 0 ? 'p' : 'p.error';
    var verdictText = h4 === 0
      ? t('settings.zoomUsage.verdict.ok', { months: months.length })
      : t('settings.zoomUsage.verdict.check', { hours: h4.toFixed(1), days: days4.length, dates: days4.slice(0, ZOOM_ISSUE_DATES_MAX).join(', ') });
    out.appendChild(U.el(verdictClass, null, [verdictText]));
    var errors = data.errors || [];
    if (errors.length) {
      out.appendChild(U.el('p.error', null, [t('settings.zoomUsage.partial', {
        n: errors.length,
        list: errors.slice(0, ZOOM_ERRORS_MAX).map(function (e) { return String(e.account || '').split('@')[0] + ' ' + (e.month || ''); }).join(', ')
      })]));
    }
  }

  /** 동시 사용 요약 한 줄(2·3·4·5개 이상 동시 사용 시간과 날짜 수). */
  function zoomSummaryLine(c) {
    function hrs(n) { return ((c.minutesAtLeast[n] || 0) / MINUTES_PER_HOUR).toFixed(1); }
    function dcount(n) { return (c.daysAtLeast[n] || []).length; }
    return U.el('p.muted', null, [t('settings.zoomUsage.summary', {
      max: c.max, h2: hrs(2), d2: dcount(2), h3: hrs(3), d3: dcount(3), h4: hrs(4), d4: dcount(4), h5: hrs(ZOOM_SUMMARY_LEVELS_MAX), d5: dcount(ZOOM_SUMMARY_LEVELS_MAX)
    })]);
  }

  /** 월 한 줄: 월 이름 + 계정별 "회의 수 / 시간". */
  function zoomMonthRow(data, month) {
    var cells = [U.el('td', null, [month])];
    (data.accounts || []).forEach(function (email) {
      var pam = data.perAccountMonth[email] || {};
      if (pam[month] === null) { cells.push(U.el('td', null, ['–'])); return; }   // 이 달은 Zoom 에서 못 읽음
      var rec = pam[month] || {};
      var meetings = rec.meetings || 0;
      var hours = rec.hours || 0;
      cells.push(U.el('td', null, [meetings + ' / ' + hours]));
    });
    return U.el('tr', null, cells);
  }

  /** 합계 줄: 계정별로 읽은 달의 회의 수·시간을 더한다. */
  function zoomTotalRow(data) {
    var months = data.months || [];
    var totalCells = [U.el('th', null, [t('settings.zoomUsage.total')])];
    (data.accounts || []).forEach(function (email) {
      var pam = data.perAccountMonth[email] || {};
      var meetings = 0;
      var hours = 0;
      months.forEach(function (month) {
        if (pam[month] === null) return;
        var rec = pam[month] || {};
        meetings += rec.meetings || 0;
        hours += Number(rec.hours) || 0;
      });
      var roundedHours = Math.round(hours * DECIMAL_SHIFT) / DECIMAL_SHIFT;
      totalCells.push(U.el('td', null, [meetings + ' / ' + roundedHours]));
    });
    return U.el('tr', null, totalCells);
  }

  /** 월 × 계정 표(최신 달이 위, 맨 아래 합계). */
  function zoomUsageTable(data) {
    var headerCells = [U.el('th', null, [t('settings.zoomUsage.month')])];
    (data.accounts || []).forEach(function (email) {
      headerCells.push(U.el('th', null, [email.split('@')[0]]));
    });
    var rows = [U.el('tr', null, headerCells)];
    (data.months || []).slice().reverse().forEach(function (month) { rows.push(zoomMonthRow(data, month)); });
    rows.push(zoomTotalRow(data));
    return U.el('table.kv-table.perf.usage', null, rows);
  }

  /**
   * Zoom 사용량 API 응답을 out 에 표시하고 새로고침 버튼을 보여준다.
   * @param {HTMLElement} out 결과 영역
   * @param {HTMLElement} refreshBtn 새로고침 버튼
   * @param {Object} data zoomUsage API 응답
   */
  function showZoomUsage(out, refreshBtn, data) {
    U.clear(out);
    appendZoomVerdict(out, data);
    out.appendChild(zoomSummaryLine(data.concurrency));
    out.appendChild(U.el('p.muted', null, [t('settings.zoomUsage.cell')]));
    out.appendChild(U.el('div.table-scroll', null, [zoomUsageTable(data)]));
    var u = data.unavailableMonths || [];
    if (u.length) {
      out.appendChild(U.el('p.muted', null, [t('settings.zoomUsage.unavailable', { from: u[0], to: u[u.length - 1] })]));
    }
    out.appendChild(U.el('p.muted', null, [t('settings.zoomUsage.generated', { at: RB.time.fmtDateTime(new Date(data.generatedAt), RB.i18n.get()) }) + (data.fromCache ? ' ' + t('settings.zoomUsage.cached') : '')]));
    refreshBtn.style.display = '';
  }

  /**
   * Zoom 계정 사용량 카드를 렌더링한다.
   * 첫 로드와 새로고침 버튼을 제공하고, API 응답을 표로 보여준다.
   */
  function zoomUsageCard() {
    var out = U.el('div');
    var loadBtn, refreshBtn;

    /**
     * Zoom 사용량 API를 호출하고 두 버튼을 잠근다.
     * @param {Object} params 빈 객체 또는 { refresh: true }
     * @param {HTMLElement} btn 클릭된 버튼
     */
    function load(params, btn) {
      loadBtn.disabled = true;
      refreshBtn.disabled = true;
      var done = U.busy(btn);
      RB.api.call('zoomUsage', params).then(function (data) { showZoomUsage(out, refreshBtn, data); })
        .catch(function (err) { U.toast(t('result.error', { message: err.message || err.code }), 'error'); })
        .then(function () {
          loadBtn.disabled = false;
          refreshBtn.disabled = false;
          done();
        });
    }

    loadBtn = U.el('button.btn', { type: 'button', onclick: function () { load({}, loadBtn); } }, [t('settings.zoomUsage.load')]);
    refreshBtn = U.el('button.btn', { type: 'button', style: { display: 'none' }, onclick: function () { load({ refresh: true }, refreshBtn); } }, [t('settings.zoomUsage.refresh')]);

    return U.el('div.card', null, [
      U.el('h3', null, [t('settings.zoomUsage')]),
      U.el('p.muted', null, [t('settings.zoomUsage.hint')]),
      actionsRow([loadBtn, refreshBtn]), out
    ]);
  }

  // ---- 승인 응답 현황 카드 ---------------------------------------------------

  /** 이메일의 @ 앞부분. */
  function emailLocal(e) { return String(e || '').split('@')[0]; }
  function statsNum(v) { return v === null || v === undefined ? '–' : String(v); }
  function statsHours(v) { return v === null || v === undefined ? '–' : v.toFixed(1) + ' h'; }
  function statsColumn(key) { return t('settings.approvalStats.col.' + key); }
  /** 제목 칸 목록(heads)과 줄(rows)로 스크롤 가능한 표를 만든다. */
  function statsTable(heads, rows) {
    var trs = [U.el('tr', null, heads.map(function (h) { return U.el('th', null, [statsColumn(h)]); }))].concat(rows);
    return U.el('div.table-scroll', null, [U.el('table.kv-table.perf.usage.left', null, trs)]);
  }
  function statsCell(v) { return U.el('td', null, [String(v)]); }
  /** 만료 건수 칸: 1건 이상이면 경고색. */
  function statsExpiredCell(n) { return n > 0 ? U.el('td', null, [U.el('span.warn-text', null, [String(n)])]) : statsCell(n); }

  /** 응답 대기 중인 요청 구역(제목 + 표 또는 "없음" 안내)을 out 에 넣는다. 제목을 먼저 넣고 표를 만든다. */
  function appendStatsPending(out, pending) {
    out.appendChild(U.el('h4', null, [t('settings.approvalStats.pending')]));
    if (!pending.length) {
      out.appendChild(U.el('p.muted', null, [t('settings.approvalStats.none')]));
      return;
    }
    out.appendChild(statsTable(['request', 'room', 'title', 'starts', 'waiting', 'turn', 'escalated'], pending.map(function (p) {
      return U.el('tr', null, [
        statsCell(p.requestId), statsCell(p.room), statsCell(p.title),
        statsCell(p.startAt ? RB.time.fmtDateTime(new Date(p.startAt), RB.i18n.get()) : ''),
        statsCell(statsHours(p.waitingHours)),
        statsCell(t('settings.approvalStats.stage.' + p.stage) + ': ' + (p.approvers || []).map(emailLocal).join(', ')),
        statsCell(p.escalated ? '✓' : '')
      ]);
    })));
  }

  /** 담당자별 구역을 out 에 넣는다. */
  function appendStatsApprovers(out, byApprover) {
    out.appendChild(U.el('h4', null, [t('settings.approvalStats.byApprover')]));
    out.appendChild(statsTable(['approver', 'rooms', 'assigned', 'decided', 'median', 'longest', 'escalated', 'expired'], byApprover.map(function (a) {
        return U.el('tr', null, [
          statsCell(emailLocal(a.email)), statsCell((a.rooms || []).join(', ')), statsCell(a.assigned), statsCell(a.decided),
          statsCell(statsNum(a.medianHours)), statsCell(statsNum(a.maxHours)), statsCell(a.escalated), statsExpiredCell(a.expired)
        ]);
      })));
  }

  /** 장소별 구역을 out 에 넣는다. */
  function appendStatsRooms(out, byRoom) {
    out.appendChild(U.el('h4', null, [t('settings.approvalStats.byRoom')]));
    out.appendChild(statsTable(['room', 'approvers', 'requests', 'decided', 'median', 'longest', 'escalated', 'expired'], byRoom.map(function (r) {
        return U.el('tr', null, [
          statsCell(r.room), statsCell((r.approvers || []).map(emailLocal).join(', ')), statsCell(r.requests), statsCell(r.decided),
          statsCell(statsNum(r.medianHours)), statsCell(statsNum(r.maxHours)), statsCell(r.escalated), statsExpiredCell(r.expired)
        ]);
      })));
  }

  /** 기존 예약자(양보 질문 대상)별 구역(제목 + 표 또는 "없음" 안내)을 out 에 넣는다. */
  function appendStatsHolders(out, byHolder) {
    out.appendChild(U.el('h4', null, [t('settings.approvalStats.byHolder')]));
    if (!byHolder.length) {
      out.appendChild(U.el('p.muted', null, [t('settings.approvalStats.noneHolder')]));
      return;
    }
    out.appendChild(statsTable(['holder', 'asked', 'yes', 'no', 'noAnswer', 'median', 'longest'], byHolder.map(function (h) {
      return U.el('tr', null, [
        statsCell(emailLocal(h.email)), statsCell(h.asked), statsCell(h.yes), statsCell(h.no), statsExpiredCell(h.noAnswer),
        statsCell(statsNum(h.medianHours)), statsCell(statsNum(h.maxHours))
      ]);
    })));
  }

  /**
   * approvalStats API 응답을 out 에 표시한다.
   * @param {HTMLElement} out 결과 영역
   * @param {Object} data approvalStats API 응답
   */
  function showApprovalStats(out, data) {
    U.clear(out);
    appendStatsPending(out, data.pending || []);
    appendStatsApprovers(out, data.byApprover || []);
    appendStatsRooms(out, data.byRoom || []);
    appendStatsHolders(out, data.byHolder || []);
    out.appendChild(U.el('p.muted', null, [t('settings.approvalStats.note')]));
  }

  /**
   * 승인 응답 현황 카드(읽기 전용). 기간 버튼(30/90일)으로 approvalStats 를 부르고 표 4개를 보여준다.
   * 시간은 업무시간 기준(백엔드 계산).
   */
  function approvalStatsCard() {
    var out = U.el('div');
    var btn30, btn90;

    /**
     * approvalStats API 를 부르고 두 버튼을 잠근다.
     * @param {number} days 30 또는 90
     * @param {HTMLElement} btn 클릭된 버튼
     */
    function load(days, btn) {
      btn30.disabled = true;
      btn90.disabled = true;
      var done = U.busy(btn);
      RB.api.call('approvalStats', { days: days }).then(function (data) { showApprovalStats(out, data); })
        .catch(function (err) { U.toast(t('result.error', { message: err.message || err.code }), 'error'); })
        .then(function () {
          btn30.disabled = false;
          btn90.disabled = false;
          done();
        });
    }

    btn30 = U.el('button.btn', { type: 'button', onclick: function () { load(30, btn30); } }, [t('settings.approvalStats.d30')]);
    btn90 = U.el('button.btn', { type: 'button', onclick: function () { load(90, btn90); } }, [t('settings.approvalStats.d90')]);

    return U.el('div.card', null, [
      U.el('h3', null, [t('settings.approvalStats')]),
      U.el('p.muted', null, [t('settings.approvalStats.hint')]),
      actionsRow([btn30, btn90]), out
    ]);
  }

  function kv(key, value) {
    return U.el('tr', null, [U.el('td', null, [t(key)]), U.el('td', null, [value === undefined || value === null ? '' : String(value)])]);
  }

  /** 버튼을 잠그고 액션을 실행한 뒤 결과 콜백 */
  function run(btn, action, onDone) {
    var done = U.busy(btn);
    RB.api.call(action).then(onDone)
      .catch(function (err) { U.toast(t('result.error', { message: err.message || err.code }), 'error'); })
      .then(done);
  }

  return { render: render };
})();
