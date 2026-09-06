/**
 * [bookingForm.js] — 예약 폼과 결과 처리.
 *
 * 무엇을 한다: 예약 입력 모달을 열고, 제출 결과(확정/충돌/대기/오류)에 따라 다음 화면을 보여준다.
 *              충돌이면 기존 예약·대체안을 보여주고 선점 요청(사유 필수) 또는 가능 회차만 예약을 제안한다.
 * 의존:        time.js, i18n.js, ui.js, api.js, app.js(state), board.js(refresh)
 * 호출됨:      board.js(빈 칸 클릭, 선점 버튼), 상단 "예약하기" 버튼
 * 주의:        시간 선택지는 표시 범위를 슬롯 단위로 잘라 만든다. 종일 예약은 시작 07:00 종료 21:00 로 표현한다.
 * 정책 근거:   D-07(선점 사유 필수), D-09(제한값), D-10(입력 항목)
 */
window.RB = window.RB || {};

RB.bookingForm = (function () {
  var U = RB.ui, T = RB.time, t = function (k, v) { return RB.i18n.t(k, v); };
  var EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

  /**
   * 참석자 칩 입력. 두 글자 이상 치면 디렉터리(people API)에서 후보를 보여주고,
   * Enter·콤마·Tab 으로 타이핑한 이메일을 칩으로 추가한다. 후보에 없는 주소(CGA 등)도 직접 넣을 수 있다.
   * @returns {{node:Element, values:function():string[]}}
   */
  function guestChips(initial) {
    var chips = (initial || []).map(function (e) { return { email: String(e).toLowerCase(), name: '' }; });  // [{email, name}]
    var input = U.el('input', { type: 'text', placeholder: t('form.guests.ph'), autocomplete: 'off' });
    var list = U.el('div.suggest'); list.hidden = true;
    var box = U.el('div.chips', { onclick: function (e) { if (e.target === box) input.focus(); } }, [input, list]);
    var timer = null, active = -1, items = [];

    function render() {
      box.querySelectorAll('.chip').forEach(function (c) { c.remove(); });
      chips.forEach(function (g, i) {
        var chip = U.el('span.chip' + (EMAIL_RE.test(g.email) ? '' : '.invalid'), { title: g.email }, [
          g.name && g.name !== g.email ? U.el('span.chip-name', null, [g.name]) : null,
          U.el('span.chip-mail', null, [g.name && g.name !== g.email ? g.email : '']),
          !g.name || g.name === g.email ? U.el('span.chip-name', null, [g.email]) : null,
          U.el('button', { type: 'button', 'aria-label': 'remove', onclick: function () { chips.splice(i, 1); render(); input.focus(); } }, ['×'])
        ]);
        box.insertBefore(chip, input);
      });
    }
    function add(email, name) {
      var e = String(email || '').trim().toLowerCase().replace(/[,;]+$/, '');
      if (!e) return;
      if (chips.some(function (c) { return c.email === e; })) return;
      chips.push({ email: e, name: name || '' });
      input.value = ''; hide(); render();
    }
    function hide() { list.hidden = true; items = []; active = -1; }
    function showSuggestions(results) {
      U.clear(list); items = results; active = -1;
      if (!results.length) { hide(); return; }
      results.forEach(function (r, i) {
        list.appendChild(U.el('div.suggest-item', { onmousedown: function (e) { e.preventDefault(); add(r.email, r.name); } }, [
          U.el('span.s-name', null, [r.name]), U.el('span.s-mail', null, [r.email])
        ]));
      });
      list.hidden = false;
    }
    function search(q) {
      RB.people.search(q, chips.map(function (c) { return c.email; })).then(function (res) {
        if (input.value.trim() !== q) return; // 이미 다른 글자를 치고 있다
        showSuggestions(res || []);
      }).catch(function () { hide(); });
    }

    input.addEventListener('input', function () {
      var q = input.value.trim();
      clearTimeout(timer);
      if (!q || (q.indexOf('@') !== -1 && EMAIL_RE.test(q))) { hide(); return; }
      // 로컬 디렉터리가 있으면 즉시, 없으면(서버 검색) 250ms 디바운스
      if (RB.people.ready()) search(q); else timer = setTimeout(function () { search(q); }, 250);
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' && items.length) { e.preventDefault(); active = (active + 1) % items.length; highlight(); }
      else if (e.key === 'ArrowUp' && items.length) { e.preventDefault(); active = (active - 1 + items.length) % items.length; highlight(); }
      else if (e.key === 'Enter' || e.key === ',' || e.key === 'Tab') {
        if (active >= 0 && items[active]) { e.preventDefault(); add(items[active].email, items[active].name); }
        else if (input.value.trim()) { e.preventDefault(); add(input.value); }
        else if (e.key !== 'Tab') e.preventDefault();
      }
      else if (e.key === 'Escape') hide();
      else if (e.key === 'Backspace' && !input.value && chips.length) { chips.pop(); render(); }
    });
    input.addEventListener('blur', function () { setTimeout(function () { if (input.value.trim() && EMAIL_RE.test(input.value.trim())) add(input.value); hide(); }, 150); });
    function highlight() { list.querySelectorAll('.suggest-item').forEach(function (n, i) { n.classList.toggle('active', i === active); }); }

    if (chips.length) render();
    // values(): Enter 를 안 누르고 바로 제출해도 입력창에 남은 주소를 잃지 않도록 먼저 칩으로 옮긴다
    return { node: box, values: function () {
      if (input.value.trim()) add(input.value);
      return chips.map(function (c) { return c.email; });
    } };
  }

  function cfg() { return RB.app.state.config; }
  /** 예약 폼 장소 목록: 활성 공간 전부 + (담당자·관리자에게만) 비활성 공간. Rooms(MAIN) 먼저, Other spaces 뒤에. */
  function resources() {
    var me = RB.app.state.user || {};
    var list = RB.app.state.resources.filter(function (r) {
      if (r.reservable === false) return false;
      return r.active !== false || me.isSuperAdmin || (me.approverOf || []).indexOf(r.calendarId) !== -1;
    });
    var isOther = function (r) { return r.board === 'OTHER' || r.active === false; };
    return list.filter(function (r) { return !isOther(r); }).concat(list.filter(isOther));
  }

  /** 표시 범위를 슬롯으로 나눈 시각 옵션 [{value:분, label:'07:00'}] (endInclusive 면 마지막 경계 포함) */
  function timeOptions(endInclusive) {
    var hm = (cfg().displayHours || '06:00-22:00').split('-');
    var from = T.parseHM(hm[0]), to = T.parseHM(hm[1]), step = cfg().slotMinutes || 30;
    var list = [];
    for (var m = from; endInclusive ? m <= to : m < to; m += step) list.push({ value: m, label: T.fmtHM(m) });
    return list;
  }

  function select(name, options, selected, onchange) {
    var sel = U.el('select.select', { name: name, onchange: onchange || null });
    options.forEach(function (o) {
      sel.appendChild(U.el('option', { value: o.value, selected: String(o.value) === String(selected) }, [o.label]));
    });
    return sel;
  }

  function field(labelKey, control, hint) {
    return U.el('label.field', null, [U.el('span.field-label', null, [t(labelKey), hint ? U.el('small.muted', null, [' ' + hint]) : null]), control]);
  }

  /**
   * 폼 열기.
   * @param {{calendarId?:string, date?:string, startMin?:number, endMin?:number}} preset
   */
  /**
   * 예약 폼. preset.edit 가 있으면 편집 모드(D-25): 방 고정, 제목·참석자·시간만 고치고 `update` 를 부른다.
   * @param {Object} preset {calendarId?, date?, startMin?, endMin?, edit?:{eventId, title, guests:[email], onDone:function}}
   */
  function open(preset) {
    preset = preset || {};
    var edit = preset.edit || null;
    var list = resources();
    if (edit) list = list.filter(function (r) { return r.calendarId === preset.calendarId; });
    if (!list.length) return;
    var maxDate = T.addDays(T.today(), cfg().maxAdvanceDays || 180);
    var initial = {
      calendarId: preset.calendarId || list[0].calendarId,
      date: preset.date || T.today(),
      startMin: preset.startMin !== undefined ? preset.startMin : timeOptions()[0].value,
      endMin: preset.endMin !== undefined ? preset.endMin : timeOptions()[0].value + 60
    };

    var resSel = U.el('select.select', { name: 'calendarId', onchange: updateModeNote });
    (function () {
      var isOther = function (r) { return r.board === 'OTHER' || r.active === false; };
      var groups = [['MAIN', list.filter(function (r) { return !isOther(r); })], ['OTHER', list.filter(isOther)]];
      groups.forEach(function (g) {
        if (!g[1].length) return;
        var og = U.el('optgroup', { label: t('board.group.' + g[0]) });
        g[1].forEach(function (r) {
          og.appendChild(U.el('option', { value: r.calendarId, selected: r.calendarId === initial.calendarId },
            [r.name + (r.aliases && r.aliases.length ? ' · ' + r.aliases[0] : '') + (r.active === false ? ' (' + t('board.inactive') + ')' : '')]));
        });
        resSel.appendChild(og);
      });
    })();
    var dateIn = U.el('input.input', { type: 'date', name: 'date', value: initial.date, min: T.today(), max: maxDate, required: true });
    var startSel = select('start', timeOptions(false), initial.startMin, function () {
      // 시작을 바꾸면 종료를 시작+1h 로 따라가게 해 "종료가 시작보다 앞" 실수를 줄인다
      var s = Number(startSel.value); if (Number(endSel.value) <= s) endSel.value = String(Math.min(s + 60, timeOptions(true).slice(-1)[0].value));
    });
    var endSel = select('end', timeOptions(true).slice(1), initial.endMin);
    if (edit) resSel.disabled = true;
    var titleIn = U.el('input.input', { type: 'text', name: 'title', required: true, maxLength: 80, placeholder: t('form.summary.ph'), value: edit ? edit.title || '' : '' });
    var gradeSel = select('grade', cfg().grades.map(function (g) { return { value: g.code, label: g.label || t('grade.' + g.code) }; }), cfg().grades[cfg().grades.length - 1].code);
    var headIn = U.el('input.input', { type: 'number', name: 'headcount', min: 1, max: 999, placeholder: '' });
    var guests = guestChips(edit ? edit.guests : null);
    var noteIn = U.el('textarea.input', { name: 'note', rows: 2, placeholder: t('form.note.ph') });
    var recSel = select('recFreq', [
      { value: 'none', label: t('rec.none') }, { value: 'weekly', label: t('rec.weekly') },
      { value: 'biweekly', label: t('rec.biweekly') }, { value: 'daily', label: t('rec.daily') }
    ], 'none', function () { recExtra.hidden = recSel.value === 'none'; });
    var untilIn = U.el('input.input', { type: 'date', name: 'until', min: T.today(), max: maxDate });
    var countIn = U.el('input.input', { type: 'number', name: 'count', min: 2, max: 52, placeholder: '' });
    var recExtra = U.el('div.grid-2', null, [field('form.recurrence.until', untilIn), field('form.recurrence.count', countIn)]);
    recExtra.hidden = true;

    var modeNote = U.el('p.note');
    function updateModeNote() {
      var r = list.filter(function (x) { return x.calendarId === resSel.value; })[0];
      // D-26: 그 방의 담당자·슈퍼 관리자 본인은 승인 없이 바로 확정되므로 안내를 다르게
      var me = RB.app.state.user || {};
      var selfApprover = r && (me.isSuperAdmin || (me.approverOf || []).indexOf(r.calendarId) !== -1);
      modeNote.textContent = r && r.mode === 'APPROVAL' ? t(selfApprover ? 'form.approvalNoteSelf' : 'form.approvalNote') : '';
      modeNote.hidden = !modeNote.textContent;
    }
    updateModeNote();

    var errBox = U.el('p.error'); errBox.hidden = true;
    var submitBtn = U.el('button.btn.btn-primary', { type: 'submit' }, [t(edit ? 'btn.save' : 'btn.submit')]);

    var form = U.el('form.form', {
      onsubmit: function (e) {
        e.preventDefault();
        var params = read();
        var problem = validate(params);
        if (problem) { errBox.textContent = problem; errBox.hidden = false; return; }
        errBox.hidden = true; var done = U.busy(submitBtn);
        RB.people.remember(params.guests);
        if (edit) {
          RB.api.call('update', { eventId: edit.eventId, title: params.title, start: params.start, end: params.end, guests: params.guests })
            .then(function (result) { handleUpdate(result, params, edit, errBox); })
            .catch(function (err) { errBox.textContent = t('result.error', { message: err.message || err.code }); errBox.hidden = false; })
            .then(done);
          return;
        }
        RB.api.call('book', params).then(function (result) { handleResult(result, params); })
          .catch(function (err) { U.toast(t('result.error', { message: err.message || err.code }), 'error'); })
          .then(done);
      }
    }, [
      field('form.resource', resSel), modeNote,
      U.el('div.grid-3', null, [field('form.date', dateIn), field('form.start', startSel), field('form.end', endSel)]),
      field('form.summary', titleIn),
      field('form.guests', guests.node, t('form.guests.hint')),
      edit ? U.el('p.note', null, [t('form.editNote')]) : U.el('details.optional', null, [
        U.el('summary', null, [t('form.optional')]),
        U.el('div.grid-2', null, [field('form.grade', gradeSel), field('form.headcount', headIn)]),
        field('form.note', noteIn),
        field('form.recurrence', recSel), recExtra
      ]),
      errBox,
      U.el('div.actions', null, [U.el('button.btn', { type: 'button', onclick: U.closeModal }, [t('btn.cancel')]), submitBtn])
    ]);

    function read() {
      var key = dateIn.value;
      var rec = recSel.value === 'none' ? null : { freq: recSel.value, until: untilIn.value || null, count: countIn.value ? Number(countIn.value) : null };
      return {
        calendarId: resSel.value,
        start: T.make(key, Number(startSel.value)).toISOString(),
        end: T.make(key, Number(endSel.value)).toISOString(),
        title: titleIn.value.trim(), grade: gradeSel.value,
        headcount: headIn.value ? Number(headIn.value) : null, note: noteIn.value.trim() || null,
        guests: guests.values(),
        recurrence: rec
      };
    }
    function validate(p) {
      if (!p.calendarId || !dateIn.value || !p.title) return t('form.err.required');
      if (Number(endSel.value) <= Number(startSel.value)) return t('form.err.order');
      // 편집 중 시작 시각을 그대로 두면(이미 진행 중인 예약의 제목·참석자만 고칠 때) 과거 검사를 건너뛴다
      var startUnchanged = edit && T.dateKey(new Date(p.start)) === initial.date && Number(startSel.value) === initial.startMin;
      if (!startUnchanged && new Date(p.start) < new Date()) return t('form.err.past');
      var bad = (p.guests || []).filter(function (g) { return !EMAIL_RE.test(g); });
      if (bad.length) return t('form.err.guests', { list: bad.join(', ') });
      return null;
    }

    U.modal(form, { title: t(edit ? 'form.editTitle' : 'form.title') });
    setTimeout(function () { titleIn.focus(); }, 50);
  }

  /** 편집 결과 분기(D-25): 저장되면 현황판 캐시를 갱신하고 목록을 다시 그린다. 시간 충돌은 폼 안에 보여준다. */
  function handleUpdate(result, params, edit, errBox) {
    var lang = RB.i18n.get();
    if (result.kind === 'UPDATED') {
      U.closeModal();
      U.toast(result.changed && result.changed.length ? t('result.updated') : t('result.noChange'), 'ok');
      RB.board.removeLocal(edit.eventId);
      RB.board.addLocal({ calendarId: params.calendarId, eventId: edit.eventId, title: params.title, start: params.start, end: params.end, status: 'CONFIRMED', grade: edit.grade || null });
      if (edit.onDone) edit.onDone();
    } else if (result.kind === 'CONFLICT') {
      var c = (result.conflicts || [])[0] || {};
      errBox.textContent = t('result.conflict') + (c.title ? ' ' + c.title + ' (' + T.fmtRange(new Date(c.start), new Date(c.end), lang) + ')' : '');
      errBox.hidden = false;
    } else {
      errBox.textContent = t('result.error', { message: result.message || '' });
      errBox.hidden = false;
    }
  }

  /** 제출 결과 분기 */
  function handleResult(result, params) {
    if (result.kind === 'CONFIRMED') {
      U.closeModal();
      U.toast(result.skipped ? t('result.confirmedPartial', { ok: result.occurrences, skipped: result.skipped }) : t('result.confirmed'), 'ok');
      // 단일 예약은 서버 재조회 없이 바로 그린다. 반복 예약은 회차가 여럿이라 재조회.
      if (result.eventId && !params.recurrence) RB.board.addLocal({ calendarId: params.calendarId, eventId: result.eventId, title: params.title, start: params.start, end: params.end, status: 'CONFIRMED', grade: params.grade });
      else RB.board.refresh();
    } else if (result.kind === 'PENDING') {
      U.closeModal();
      U.toast(t('result.pending'), 'ok');
      var q = result.request || {};
      if (q.eventId && !params.recurrence) RB.board.addLocal({ calendarId: params.calendarId, eventId: q.eventId, title: params.title, start: params.start, end: params.end, status: 'PENDING', grade: params.grade, requestId: q.requestId });
      else RB.board.refresh();
    } else if (result.kind === 'CONFLICT') {
      showConflict(result, params);
    } else {
      U.toast(t('result.error', { message: result.message || '' }), 'error');
    }
  }

  /** 충돌 화면: 기존 예약, 대체안, 선점 요청 / 가능 회차만 */
  function showConflict(result, params) {
    var lang = RB.i18n.get();
    var r = resources().filter(function (x) { return x.calendarId === params.calendarId; })[0];
    var recurring = result.occurrences > 1;

    var conflictList = U.el('ul.list', null, result.conflicts.map(function (c) {
      return U.el('li', null, [T.fmtRange(new Date(c.start), new Date(c.end), lang), ' · ', c.title, ' · ', c.organizerName || '']);
    }));

    var altList = U.el('div.alts', null, (result.alternatives || []).map(function (a) {
      return U.el('button.btn.btn-alt', { type: 'button', onclick: function () {
        U.closeModal();
        open({ calendarId: a.calendarId, date: T.dateKey(new Date(a.start)), startMin: T.minutesOfDay(new Date(a.start)), endMin: T.minutesOfDay(new Date(a.end)) });
      } }, [a.resourceName + ' · ' + T.fmtRange(new Date(a.start), new Date(a.end), lang)]);
    }));

    var reasonIn = U.el('textarea.input', { rows: 3, placeholder: t('conflict.reason.ph') });
    var preemptSection = result.preemptAllowed
      ? U.el('div.section', null, [
        field('conflict.reason', reasonIn),
        U.el('button.btn.btn-warn', { type: 'button', onclick: function (e) {
          if (!reasonIn.value.trim()) { reasonIn.focus(); return; }
          var done = U.busy(e.currentTarget);
          RB.api.call('preempt', { intentKey: result.intentKey, reason: reasonIn.value.trim() })
            .then(function () { U.closeModal(); U.toast(t('result.preemptSent'), 'ok'); RB.board.refresh(); })
            .catch(function (err) { done(); U.toast(t('result.error', { message: err.message || err.code }), 'error'); });
        } }, [t('btn.preempt')])
      ])
      // 보호 구간은 방마다 다르다(Resources 시트 ProtectHours). 값이 없으면 D-07 확정값 12h.
      : (r && r.mode === 'AUTO' ? U.el('p.note', null, [t('conflict.protected', { hours: r.protectHours || cfg().protectHours || 12 })]) : null);

    var body = U.el('div', null, [
      U.el('p.lead', null, [recurring ? t('result.conflictRecurring', { total: result.occurrences, conflicts: result.conflicts.length }) : t('result.conflict')]),
      U.el('h3', null, [t('conflict.existing')]), conflictList,
      (result.alternatives || []).length ? U.el('h3', null, [t('conflict.alternatives')]) : null, altList,
      preemptSection,
      U.el('div.actions', null, [
        U.el('button.btn', { type: 'button', onclick: U.closeModal }, [t('btn.close')]),
        recurring ? U.el('button.btn.btn-primary', { type: 'button', onclick: function (e) {
          var done = U.busy(e.currentTarget);
          RB.api.call('bookFreeOnly', { intentKey: result.intentKey }).then(function (res) { handleResult(res, params); })
            .catch(function (err) { U.toast(t('result.error', { message: err.message || err.code }), 'error'); })
            .then(done);
        } }, [t('btn.freeOnly')]) : null
      ])
    ]);
    U.modal(body, { title: r ? r.name : '', wide: true });
  }

  /**
   * 캘린더 경로(D-18): 이메일 링크 ?complete=R-xxx 로 들어온 DRAFT 요청에 사유를 넣어 제출한다.
   */
  function openComplete(requestId) {
    RB.api.call('draft', { requestId: requestId }).then(function (q) {
      if (!q || q.status !== 'DRAFT') { U.toast(t('complete.notFound'), 'error'); return; }
      var lang = RB.i18n.get();
      var reasonIn = U.el('textarea.input', { rows: 3, placeholder: t('conflict.reason.ph') });
      var btn = U.el('button.btn.btn-warn', { type: 'button', onclick: function () {
        if (!reasonIn.value.trim()) { reasonIn.focus(); return; }
        var done = U.busy(btn);
        RB.api.call('completePreempt', { requestId: requestId, reason: reasonIn.value.trim() })
          .then(function (res) { U.closeModal(); U.toast(res.message || t('result.preemptSent'), 'ok'); RB.board.refresh(); })
          .catch(function (err) { done(); U.toast(t('result.error', { message: err.message || err.code }), 'error'); });
      } }, [t('complete.submit')]);
      var body = U.el('div', null, [
        U.el('p.lead', null, [q.resourceName + ' · ' + T.fmtRange(new Date(q.start), new Date(q.end), lang)]),
        U.el('div.card-title', null, [q.title]),
        U.el('p.muted', null, [t('complete.intro')]),
        (q.conflicts || []).length ? U.el('h3', null, [t('conflict.existing')]) : null,
        U.el('ul.list', null, (q.conflicts || []).map(function (c) {
          return U.el('li', null, [T.fmtRange(new Date(c.start), new Date(c.end), lang), ' · ', c.title, ' · ', c.organizerName || '']);
        })),
        field('conflict.reason', reasonIn),
        U.el('div.actions', null, [U.el('button.btn', { type: 'button', onclick: U.closeModal }, [t('btn.close')]), btn])
      ]);
      U.modal(body, { title: t('complete.title'), wide: true });
    }).catch(function (err) { U.toast(err.message || t('complete.notFound'), 'error'); });
  }

  return { open: open, openComplete: openComplete };
})();
