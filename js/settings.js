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

  function render(host) {
    U.clear(host);
    var user = RB.app.state.user, cfg = RB.app.state.config;

    var importBtn = U.el('button.btn', { type: 'button', onclick: function () { run(importBtn, 'importRooms', importResult); } }, [t('settings.import')]);
    var importOut = U.el('p.muted');
    function importResult(data) {
      importOut.textContent = t('settings.import.done', { added: data.added, total: data.total });
      RB.api.call('resources').then(function (list) { RB.app.state.resources = list; });
    }

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

    var testOut = U.el('p.muted');
    var testBtn = U.el('button.btn', { type: 'button', onclick: function () { run(testBtn, 'testEmail', function (r) { testOut.textContent = t('settings.testEmail.done', { sent: r.sent, to: r.to }); }); } }, [t('settings.testEmail')]);

    var healthBtn = U.el('button.btn', { type: 'button', onclick: function () { run(healthBtn, 'healthCheck', healthResult); } }, [t('settings.health')]);
    var healthOut = U.el('div');
    function healthResult(data) {
      U.clear(healthOut);
      var bad = data.checks.filter(function (c) { return !c.ok; }).length;
      healthOut.appendChild(U.el('p.' + (bad ? 'error' : 'muted'), null, [bad ? t('settings.health.issues', { n: bad }) : t('settings.health.ok')]));
      healthOut.appendChild(U.el('ul.check-list', null, data.checks.map(function (c) {
        return U.el('li.' + (c.ok ? 'ok' : 'bad'), null, [(c.ok ? '✓ ' : '✗ ') + c.label + (c.detail ? ' — ' + c.detail : '')]);
      })));
    }

    host.appendChild(U.el('div.settings', null, [
      U.el('div.card', null, [
        U.el('h3', null, [t('settings.title')]),
        U.el('p', null, [t('settings.intro')]),
        U.el('a.btn.btn-primary', { href: user.sheetUrl || '#', target: '_blank', rel: 'noopener' }, [t('settings.openSheet')])
      ]),
      U.el('div.card', null, [
        U.el('h3', null, [t('settings.rooms')]),
        U.el('p.muted', null, [t('settings.rooms.hint')]),
        U.el('div.actions', { style: { justifyContent: 'flex-start' } }, [importBtn]), importOut,
        U.el('table.kv-table', null, RB.app.state.resources.map(function (r) {
          return U.el('tr', null, [
            U.el('td', null, [r.name + (r.aliases && r.aliases.length ? ' · ' + r.aliases.join(', ') : '')]),
            U.el('td', null, [t('board.group.' + (r.board || 'MAIN')) + (r.active === false ? ' · ' + t('board.inactive') : '') + ' · ' + t('mode.' + r.mode) + (r.capacity ? ' · ' + r.capacity : '') + (r.approvers ? ' · ' + r.approvers.join(', ') : '')])
          ]);
        }))
      ]),
      zoomUsageCard(),
      U.el('div.card', null, [
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
        U.el('div.actions', { style: { justifyContent: 'flex-start' } }, [healthBtn]), healthOut
      ]),
      U.el('div.card', null, [
        U.el('h3', null, [t('settings.people')]),
        U.el('p.muted', null, [t('settings.people.hint')]),
        peopleIn,
        U.el('div.actions', { style: { justifyContent: 'flex-start' } }, [peopleBtn]), peopleOut
      ]),
      U.el('div.card', null, [
        U.el('h3', null, [t('settings.webhook')]),
        U.el('p.muted', null, [t('settings.webhook.hint')]),
        webhookStatus,
        webhookIn,
        U.el('div.actions', { style: { justifyContent: 'flex-start' } }, [webhookBtn, webhookOff, announceBtn]), webhookOut
      ]),
      U.el('div.card', null, [
        U.el('h3', null, [t('settings.perf')]),
        U.el('p.muted', null, [t('settings.perf.hint')]),
        perfTable(),
        U.el('div.actions', { style: { justifyContent: 'flex-start' } }, [U.el('button.btn.btn-sm', { type: 'button', onclick: function () { render(host); } }, [t('settings.perf.refresh')])])
      ]),
      U.el('div.card', null, [
        U.el('h3', null, [t('settings.notify')]),
        U.el('p', null, [t('settings.notify.text')]),
        U.el('div.actions', { style: { justifyContent: 'flex-start' } }, [testBtn]), testOut
      ])
    ]));
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

  /**
   * Zoom 계정 사용량 카드를 렌더링한다.
   * 첫 로드와 새로고침 버튼을 제공하고, API 응답을 표로 보여준다.
   */
  function zoomUsageCard() {
    var out = U.el('div');
    var loadBtn, refreshBtn;

    /**
     * Zoom 사용량 API 응답을 표시한다.
     * @param {Object} data zoomUsage API 응답
     */
    function showResult(data) {
      U.clear(out);
      var acc = data.accounts || [], c = data.concurrency, months = data.months || [];
      var h4 = (c.minutesAtLeast[4] || 0) / 60;
      var days4 = c.daysAtLeast[4] || [];
      var verdictClass = h4 === 0 ? 'p' : 'p.error';
      var verdictText = h4 === 0
        ? t('settings.zoomUsage.verdict.ok', { months: months.length })
        : t('settings.zoomUsage.verdict.check', { hours: h4.toFixed(1), days: days4.length, dates: days4.slice(0, 10).join(', ') });
      out.appendChild(U.el(verdictClass, null, [verdictText]));

      function hrs(n) { return ((c.minutesAtLeast[n] || 0) / 60).toFixed(1); }
      function dcount(n) { return (c.daysAtLeast[n] || []).length; }
      out.appendChild(U.el('p.muted', null, [t('settings.zoomUsage.summary', {
        max: c.max, h3: hrs(3), d3: dcount(3), h4: hrs(4), d4: dcount(4), h5: hrs(5), d5: dcount(5)
      })]));
      out.appendChild(U.el('p.muted', null, [t('settings.zoomUsage.cell')]));

      var headerCells = [U.el('th', null, [t('settings.zoomUsage.month')])];
      acc.forEach(function (email) {
        headerCells.push(U.el('th', null, [email.split('@')[0]]));
      });
      var rows = [U.el('tr', null, headerCells)];

      months.slice().reverse().forEach(function (month) {
        var cells = [U.el('td', null, [month])];
        acc.forEach(function (email) {
          var pam = data.perAccountMonth[email] || {};
          var rec = pam[month] || {};
          var meetings = rec.meetings || 0;
          var hours = rec.hours || 0;
          cells.push(U.el('td', null, [meetings + ' / ' + hours]));
        });
        rows.push(U.el('tr', null, cells));
      });

      var totalCells = [U.el('th', null, [t('settings.zoomUsage.total')])];
      acc.forEach(function (email) {
        var pam = data.perAccountMonth[email] || {};
        var meetings = 0;
        var hours = 0;
        months.forEach(function (month) {
          var rec = pam[month] || {};
          meetings += rec.meetings || 0;
          hours += Number(rec.hours) || 0;
        });
        var roundedHours = Math.round(hours * 10) / 10;
        totalCells.push(U.el('td', null, [meetings + ' / ' + roundedHours]));
      });
      rows.push(U.el('tr', null, totalCells));

      var tbl = U.el('table.kv-table.perf.usage', null, rows);
      out.appendChild(U.el('div.table-scroll', null, [tbl]));

      var u = data.unavailableMonths || [];
      if (u.length) {
        out.appendChild(U.el('p.muted', null, [t('settings.zoomUsage.unavailable', { from: u[0], to: u[u.length - 1] })]));
      }
      out.appendChild(U.el('p.muted', null, [t('settings.zoomUsage.generated', { at: RB.time.fmtDateTime(new Date(data.generatedAt), RB.i18n.get()) }) + (data.fromCache ? ' ' + t('settings.zoomUsage.cached') : '')]));
      refreshBtn.style.display = '';
    }

    /**
     * Zoom 사용량 API를 호출하고 두 버튼을 잠근다.
     * @param {Object} params 빈 객체 또는 { refresh: true }
     * @param {HTMLElement} btn 클릭된 버튼
     */
    function load(params, btn) {
      loadBtn.disabled = true;
      refreshBtn.disabled = true;
      var done = U.busy(btn);
      RB.api.call('zoomUsage', params).then(showResult)
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
      U.el('div.actions', { style: { justifyContent: 'flex-start' } }, [loadBtn, refreshBtn]), out
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
