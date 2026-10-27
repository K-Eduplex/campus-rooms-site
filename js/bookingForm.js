/**
 * [bookingForm.js] — 예약 폼과 결과 처리.
 *
 * 무엇을 한다: 예약 입력 모달을 열고, 제출 결과(확정/충돌/대기/오류)에 따라 다음 화면을 보여준다.
 *              충돌이면 기존 예약·대체안을 보여주고 선점 요청(사유 필수) 또는 가능 회차만 예약을 제안한다.
 * 의존:        time.js, recurrence.js, i18n.js, ui.js, api.js, app.js(state), board.js(refresh)
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
  /** 예약 폼 장소 목록: 활성 공간 전부 + (담당자·관리자에게만) 비활성 공간. MAIN, OTHER, ZOOM 순서로 정렬한다. */
  function resources() {
    var me = RB.app.state.user || {};
    var list = RB.app.state.resources.filter(function (r) {
      if (r.reservable === false) return false;
      return r.active !== false || me.isSuperAdmin || (me.approverOf || []).indexOf(r.calendarId) !== -1;
    });
    var byGroup = function (g) { return list.filter(function (r) { return groupOf(r) === g; }); };
    return byGroup('MAIN').concat(byGroup('OTHER'), byGroup('ZOOM'));
  }
  /** @param {Object} r 장소 객체
   * @returns {string} 'ZOOM' | 'OTHER' | 'MAIN'
   * board.js groupOf / Config.gs boardGroupOf_ 와 같은 규칙. */
  function groupOf(r) {
    if (r.kind === 'ZOOM' || r.board === 'ZOOM') return 'ZOOM';
    if (r.board === 'OTHER' || r.active === false) return 'OTHER';
    return 'MAIN';
  }
  /** @param {string} calendarId
   * @returns {boolean} ZOOM 종류 자원인지 여부 */
  function isZoomRes(calendarId) {
    var found = RB.app.state.resources.filter(function (r) { return r.calendarId === calendarId; })[0];
    return !!(found && found.kind === 'ZOOM');
  }
  /** select 를 options 로 다시 채운다. 기존 선택값이 새 범위에 있으면 유지하고, 없으면 첫 항목을 선택한다. */
  function fillSelect(sel, options, keep) {
    U.clear(sel);
    options.forEach(function (o) { sel.appendChild(U.el('option', { value: o.value }, [o.label])); });
    var hasKeep = options.some(function (o) { return String(o.value) === String(keep); });
    if (hasKeep && keep !== undefined) sel.value = String(keep);
    else if (sel.options.length) sel.selectedIndex = 0;
  }

  /** 표시 범위를 슬롯으로 나눈 시각 옵션 [{value:분, label:'07:00'}] (endInclusive 면 마지막 경계 포함; zoom 이면 Zoom 24시간 범위) */
  function timeOptions(endInclusive, zoom) {
    var hours = zoom ? (cfg().zoomDisplayHours || '00:00-24:00') : (cfg().displayHours || '06:00-22:00');
    var hm = hours.split('-');
    var from = T.parseHM(hm[0]), to = T.parseHM(hm[1]), step = cfg().slotMinutes || 30;
    var list = [];
    for (var m = from; endInclusive ? m <= to : m < to; m += step) list.push({ value: m, label: T.fmtHM(m) });
    return list;
  }

  function select(name, options, selected, onchange) {
    var sel = U.el('select.select', { name: name, onchange: onchange || null });
    // 정확히 맞는 값이 없고 숫자(분)면 가장 가까운 선택지를 고른다
    var exact = options.some(function (o) { return String(o.value) === String(selected); });
    var nearest = null;
    if (!exact && options.length && selected !== undefined && selected !== null && isFinite(Number(selected))) {
      nearest = options.reduce(function (best, o) { return Math.abs(Number(o.value) - Number(selected)) < Math.abs(Number(best.value) - Number(selected)) ? o : best; }, options[0]);
    }
    options.forEach(function (o) {
      sel.appendChild(U.el('option', { value: o.value, selected: String(o.value) === String(selected) || o === nearest }, [o.label]));
    });
    return sel;
  }

  /** required 면 라벨 뒤에 빨간 * 를 붙이고(화면낭독기에는 숨김), 입력칸에 aria-required 를 단다. */
  function field(labelKey, control, hint, required) {
    if (required && control.setAttribute) control.setAttribute('aria-required', 'true');
    return U.el('label.field', null, [U.el('span.field-label', null, [t(labelKey), required ? U.el('span.req', { 'aria-hidden': 'true' }, [' *']) : null, hint ? U.el('small.muted', null, [' ' + hint]) : null]), control]);
  }

  /**
   * 폼 열기.
   * @param {{calendarId?:string, date?:string, startMin?:number, endMin?:number}} preset
   */
  /**
   * 예약 폼. preset.edit 가 있으면 편집 모드(D-25): 방 고정, 제목·참석자·시간만 고치고 `update` 를 부른다.
   * @param {Object} preset {calendarId?, date?, startMin?, endMin?, edit?:{eventId, title, guests:[email], zoomHost?, aiSummary?, grade?, organizerEmail?, organizerName?, isMine?, occurrenceOnly?, onDone:function}}
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
    // 칸(슬롯)에 맞지 않는 시각(예: 캘린더에서 잡은 07:15 예약)은 시작은 내림, 종료는 올림해서 선택지에 있게 한다
    var step = cfg().slotMinutes || 30;
    initial.startMin = Math.floor(initial.startMin / step) * step;
    initial.endMin = Math.ceil(initial.endMin / step) * step;
    if (initial.endMin <= initial.startMin) initial.endMin = initial.startMin + step;

    var resSel = U.el('select.select', { name: 'calendarId', onchange: onResourceChange });
    (function () {
      var groups = ['MAIN', 'OTHER', 'ZOOM'].map(function (g) { return [g, list.filter(function (r) { return groupOf(r) === g; })]; });
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
    var zoomInit = isZoomRes(initial.calendarId);
    var startSel = select('start', timeOptions(false, zoomInit), initial.startMin, function () {
      // 시작을 바꾸면 종료를 시작+1h 로 따라가게 해 "종료가 시작보다 앞" 실수를 줄인다
      var s = Number(startSel.value); if (Number(endSel.value) <= s) endSel.value = String(Math.min(s + 60, timeOptions(true, isZoomRes(resSel.value)).slice(-1)[0].value));
    });
    var endSel = select('end', timeOptions(true, zoomInit).slice(1), initial.endMin);
    if (edit) resSel.disabled = true;
    var titleIn = U.el('input.input', { type: 'text', name: 'title', required: true, maxLength: 80, placeholder: t('form.summary.ph'), value: edit ? edit.title || '' : '' });
    // 용도(등급)는 필수: 기본값 없이 빈 칸에서 직접 고른다(2026-10-27 3차). 편집 화면엔 Purpose 칸이 없다.
    var grades = cfg().grades;
    var gradeSel = select('grade', [{ value: '', label: t('form.grade.choose') }].concat(grades.map(function (g) { return { value: g.code, label: g.label || t('grade.' + g.code) }; })), '');
    gradeSel.required = true;
    gradeSel.options[0].disabled = true;
    var guests = guestChips(edit ? edit.guests : null);
    var noteIn = U.el('textarea.input', { name: 'note', rows: 2, placeholder: t('form.note.ph') });
    var recSel = select('recFreq', [
      { value: 'none', label: t('rec.none') }, { value: 'daily', label: t('rec.daily') },
      { value: 'weekly', label: t('rec.weekly') }, { value: 'monthly', label: t('rec.monthly') }
    ], 'none', function () { refreshRec(); });
    var untilIn = U.el('input.input', { type: 'date', name: 'until', min: T.today(), max: maxDate });
    var countIn = U.el('input.input', { type: 'number', name: 'count', min: 2, max: 52, placeholder: '' });
    var recExtra = U.el('div', null, [U.el('div.grid-2', null, [field('form.recurrence.until', untilIn), field('form.recurrence.count', countIn)]), U.el('p.muted.small', null, [t('form.recurrence.count.hint')])]);
    recExtra.hidden = true;
    var recPreview = U.el('p.note.rec-preview');   // 실제로 잡힐 날짜 미리보기
    recPreview.hidden = true;
    // 매주: 간격(1–4주) + 요일 체크. 시작 날짜의 요일은 항상 체크·잠금(날짜가 바뀌면 따라 움직인다)
    var REC_DAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];   // 월요일부터
    var recPicked = {};   // 사용자가 직접 고른 요일
    var recIntervalSel = U.el('select.select', { name: 'recInterval' });
    fillSelect(recIntervalSel, [1, 2, 3, 4].map(function (n) {
      return { value: n, label: n === 1 ? t('rec.weeks.1') : t('rec.weeks.n', { n: n }) };
    }), 1);
    var recDayBoxes = REC_DAYS.map(function (code) {
      var cb = U.el('input', { type: 'checkbox', name: 'recDay', value: code, onchange: function () { recPicked[code] = cb.checked; } });
      return U.el('label', null, [cb, ' ' + t('rec.day.' + code) + '  ']);
    });
    var recWeekly = U.el('div', null, [
      field('form.recurrence.every', recIntervalSel),
      U.el('div.field', null, [U.el('span.field-label', null, [t('form.recurrence.days')]), U.el('div', null, recDayBoxes)])
    ]);
    recWeekly.hidden = true;
    // 매월: 같은 날짜 / n번째 요일 / 마지막 요일. 선택한 날짜에서 선택지를 만든다
    var recMonthlySel = U.el('select.select', { name: 'recMonthly' });
    var recMonthly = field('form.recurrence.monthly', recMonthlySel);
    recMonthly.hidden = true;
    /** 선택한 날짜 → {day, code(MO..SU), daysInMonth}. 날짜가 비었으면 null */
    function recStart() {
      var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateIn.value || '');
      if (!m) return null;
      var y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
      var dow = new Date(y, mo - 1, d).getDay();   // 0=일
      return { day: d, code: REC_DAYS[(dow + 6) % 7], daysInMonth: new Date(y, mo, 0).getDate() };
    }
    /** 반복 칸 아래 미리보기: 서버와 같은 규칙(RB.recurrence)으로 실제 날짜를 보여준다. */
    function updatePreview() {
      var rec = recObj(), st = recStart();
      recPreview.hidden = !rec || !st;
      if (recPreview.hidden) return;
      if (!rec.count && !rec.until) { recPreview.textContent = t('rec.preview.need'); return; }
      var lang = RB.i18n.get();
      var shown = RB.recurrence.expand(dateIn.value, rec).map(function (k) { return T.fmtDate(k, lang); });
      recPreview.textContent = shown.length <= 6
        ? t('rec.preview', { n: shown.length, list: shown.join(', ') })
        : t('rec.preview.many', { n: shown.length, first: shown[0], last: shown[shown.length - 1] });
    }
    function refreshRec() {
      var freq = recSel.value, st = recStart();
      recExtra.hidden = freq === 'none';
      recWeekly.hidden = freq !== 'weekly';
      recMonthly.hidden = freq !== 'monthly';
      recDayBoxes.forEach(function (lab) {
        var cb = lab.firstChild, isStart = !!st && cb.value === st.code;
        cb.disabled = isStart;
        cb.checked = isStart || !!recPicked[cb.value];
        cb.title = isStart ? t('rec.day.start') : '';
      });
      if (st) {
        var prev = recMonthlySel.value, n = Math.ceil(st.day / 7), opts = [{ value: 'date', label: t('rec.monthly.date', { day: st.day }) }];
        if (n <= 4) opts.push({ value: 'nth', label: t('rec.monthly.nth', { nth: t('rec.nth.' + n), weekday: t('rec.weekday.' + st.code) }) });
        if (st.day + 7 > st.daysInMonth) opts.push({ value: 'last', label: t('rec.monthly.last', { weekday: t('rec.weekday.' + st.code) }) });
        fillSelect(recMonthlySel, opts, opts.some(function (o) { return o.value === prev; }) ? prev : 'date');
      }
      updatePreview();
    }
    dateIn.addEventListener('change', refreshRec);
    dateIn.addEventListener('input', refreshRec);
    [recIntervalSel, recMonthlySel, untilIn, countIn].concat(recDayBoxes.map(function (lab) { return lab.firstChild; })).forEach(function (n) {
      n.addEventListener('change', updatePreview);
      n.addEventListener('input', updatePreview);
    });
    refreshRec();

    // 대신 예약(2026-10-21): 체크해야 이메일 칸이 나온다(옵트인). 편집 모드에서는 숨긴다(예약 주인은 바꿀 수 없다).
    var bookForIn = U.el('input.input', { type: 'email', name: 'bookFor', placeholder: t('form.bookFor.ph'), autocomplete: 'off' });
    var bookForField = field('form.bookFor', bookForIn, t('form.bookFor.hint'), true);
    var bookForToggle = U.el('input', { type: 'checkbox', name: 'bookForToggle', onchange: function () {
      bookForBox.hidden = !bookForToggle.checked;
      if (bookForToggle.checked) bookForIn.focus(); else bookForIn.value = '';
    } });
    var bookForRow = U.el('label', null, [bookForToggle, ' ' + t('form.bookFor.toggle')]);
    bookForRow.hidden = !!edit;
    var bookForBox = U.el('div', null, [U.el('p.note', null, [t('form.bookFor.notice')]), bookForField]);
    bookForBox.hidden = true;
    var zoomHostIn = U.el('input.input', { type: 'email', name: 'zoomHost', placeholder: t('form.zoomHost.ph'), autocomplete: 'off' });
    var zoomField = field('form.zoomHost', zoomHostIn, t('form.zoomHost.hint'), true);
    // Zoom 호스트도 대신 예약과 같은 옵트인: 체크해야 호스트 이메일 칸이 나온다. 호스트는 참석자로 초대된다(intentFromParams_).
    var zoomHostToggle = U.el('input', { type: 'checkbox', name: 'zoomHostToggle', onchange: function () {
      zoomHostBox.hidden = !zoomHostToggle.checked;
      if (zoomHostToggle.checked) zoomHostIn.focus(); else zoomHostIn.value = '';
    } });
    var zoomHostRow = U.el('label', null, [zoomHostToggle, ' ' + t('form.zoomHost.toggle')]);
    var zoomHostBox = U.el('div', null, [U.el('p.note', null, [t('form.zoomHost.notice')]), zoomField, edit ? U.el('p.note', null, [t('form.zoomHost.editNote')]) : null]);
    zoomHostBox.hidden = true;
    // 편집 모드(Zoom): 지금 호스트가 있으면 체크하고 칸을 채운다. 체크를 풀고 저장하면 호스트 지우기('' 전송).
    if (edit && edit.zoomHost) { zoomHostToggle.checked = true; zoomHostBox.hidden = false; zoomHostIn.value = edit.zoomHost; }
    // Zoom AI 요약 메일(D-32): 체크해야 요약 메일을 받는다(옵트인). Zoom 방이고 서버 스위치(zoomAiSummary)가 켜졌을 때만 보인다.
    var aiSummaryIn = U.el('input', { type: 'checkbox', name: 'aiSummary' });
    // 새 예약은 Optional 안, 편집 모드는 본문(편집 모드엔 Optional 이 없다). 같은 요소를 한 곳에만 넣는다.
    var aiSummaryRow = U.el('div', null, [U.el('label', null, [aiSummaryIn, ' ' + t('form.aiSummary')]), U.el('p.note', null, [t('form.aiSummary.notice')])]);
    aiSummaryRow.hidden = true;
    if (edit) aiSummaryIn.checked = !!edit.aiSummary;
    var optHint = U.el('small.muted', null, [' ' + t('form.optional.hint')]);   // Optional 안에 뭐가 있는지 한 줄 설명
    var zoomNote = U.el('p.note', null, [t('form.zoomNote')]);
    var modeNote = U.el('p.note');
    function updateModeNote() {
      var r = list.filter(function (x) { return x.calendarId === resSel.value; })[0];
      // D-26: 그 방의 담당자·슈퍼 관리자 본인은 승인 없이 바로 확정되므로 안내를 다르게
      var me = RB.app.state.user || {};
      var selfApprover = r && (me.isSuperAdmin || (me.approverOf || []).indexOf(r.calendarId) !== -1);
      modeNote.textContent = r && r.mode === 'APPROVAL' ? t(selfApprover ? 'form.approvalNoteSelf' : 'form.approvalNote') : '';
      modeNote.hidden = !modeNote.textContent;
    }
    /** 장소가 바뀌면 모드 안내, Zoom 전용 입력 표시, 시간 선택지 범위(Zoom 24h / 일반)를 갱신한다. 편집 모드에서도 Zoom 방이면 호스트 입력을 보인다(예약 전체 날짜에 적용). */
    function onResourceChange() {
      updateModeNote();
      var zoomOn = isZoomRes(resSel.value);
      zoomNote.hidden = !zoomOn || !!edit;   // 새 예약 안내는 편집 모드에서 숨긴다
      zoomHostRow.hidden = !zoomOn;
      if (!zoomOn) { zoomHostToggle.checked = false; zoomHostBox.hidden = true; zoomHostIn.value = ''; }
      aiSummaryRow.hidden = !(zoomOn && cfg().zoomAiSummary);
      if (aiSummaryRow.hidden) aiSummaryIn.checked = false;
      optHint.textContent = ' ' + t(aiSummaryRow.hidden ? 'form.optional.hint' : 'form.optional.hintAi');
      var zoom = isZoomRes(resSel.value);
      fillSelect(startSel, timeOptions(false, zoom), Number(startSel.value));
      fillSelect(endSel, timeOptions(true, zoom).slice(1), Number(endSel.value));
    }
    onResourceChange();

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
          RB.api.call('update', { eventId: edit.eventId, title: params.title, start: params.start, end: params.end, guests: params.guests, zoomHost: isZoomRes(resSel.value) ? params.zoomHost : undefined,
            aiSummary: (isZoomRes(resSel.value) && cfg().zoomAiSummary && aiSummaryIn.checked !== !!edit.aiSummary) ? aiSummaryIn.checked : undefined })   // Zoom 호스트는 항상 보낸다('' = 지우기). aiSummary 는 체크가 처음 값에서 바뀐 때만
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
      edit && edit.occurrenceOnly ? U.el('p.note', null, [t('form.editOccurrence')]) : null,
      edit ? field('form.resource', resSel, null, true) : U.el('div.grid-2.grid-room', null, [field('form.resource', resSel, null, true), field('form.grade', gradeSel, null, true)]), modeNote, zoomNote,
      U.el('div.grid-3', null, [field('form.date', dateIn, null, true), field('form.start', startSel, null, true), field('form.end', endSel, null, true)]),
      field('form.summary', titleIn, null, true),
      bookForRow, bookForBox,
      field('form.guests', guests.node, t('form.guests.hint')),
      zoomHostRow, zoomHostBox, edit ? aiSummaryRow : null,
      edit ? U.el('p.note', null, [t('form.editNote')]) : U.el('details.optional', null, [
        U.el('summary', null, [t('form.optional'), optHint]),
        edit ? null : aiSummaryRow,
        field('form.recurrence', recSel), recWeekly, recMonthly, recExtra, recPreview,
        field('form.note', noteIn)
      ]),
      errBox,
      U.el('div.actions', null, [U.el('button.btn', { type: 'button', onclick: U.closeModal }, [t('btn.cancel')]), submitBtn])
    ]);

    function checkedDays() {
      return recDayBoxes.map(function (lab) { return lab.firstChild; }).filter(function (cb) { return cb.checked; }).map(function (cb) { return cb.value; });
    }
    function read() {
      var key = dateIn.value;
      var rec = recObj();
      return {
        calendarId: resSel.value,
        start: T.make(key, Number(startSel.value)).toISOString(),
        end: T.make(key, Number(endSel.value)).toISOString(),
        title: titleIn.value.trim(), grade: gradeSel.value,
        note: noteIn.value.trim() || null,
        guests: guests.values(),
        bookFor: (bookForToggle.checked && !edit) ? bookForIn.value.trim().toLowerCase() : '',
        zoomHost: (zoomHostToggle.checked && !zoomHostRow.hidden) ? zoomHostIn.value.trim().toLowerCase() : '',
        aiSummary: !aiSummaryRow.hidden && aiSummaryIn.checked,
        recurrence: rec
      };
    }
    /** 지금 입력칸의 반복 규칙. 반복 없음이면 null. read() 와 미리보기가 같이 쓴다. */
    function recObj() {
      var rec = null, wk = recSel.value === 'weekly', mo = recSel.value === 'monthly';
      if (recSel.value !== 'none') rec = {
        freq: recSel.value, until: untilIn.value || null, count: countIn.value ? Number(countIn.value) : null,
        interval: wk ? Number(recIntervalSel.value) : undefined, days: wk ? checkedDays() : undefined, monthly: mo ? recMonthlySel.value : undefined
      };
      return rec;
    }
    function validate(p) {
      if (!p.calendarId || !dateIn.value || !p.title) return t('form.err.required');
      if (!edit && !p.grade) return t('form.err.grade');
      if (Number(endSel.value) <= Number(startSel.value)) return t('form.err.order');
      // 편집 중 시작 시각을 그대로 두면(이미 진행 중인 예약의 제목·참석자만 고칠 때) 과거 검사를 건너뛴다
      var startUnchanged = edit && T.dateKey(new Date(p.start)) === initial.date && Number(startSel.value) === initial.startMin;
      if (!startUnchanged && new Date(p.start) < new Date()) return t('form.err.past');
      var bad = (p.guests || []).filter(function (g) { return !EMAIL_RE.test(g); });
      if (bad.length) return t('form.err.guests', { list: bad.join(', ') });
      if (zoomHostToggle.checked && !zoomHostRow.hidden && !p.zoomHost) return t('form.err.zoomHost');
      if (p.zoomHost && !EMAIL_RE.test(p.zoomHost)) return t('form.err.zoomHost');
      if (bookForToggle.checked && !edit && !p.bookFor) return t('form.err.bookFor');
      if (p.bookFor && !EMAIL_RE.test(p.bookFor)) return t('form.err.bookFor');
      // 대신 예약은 학교 계정만(예약 주인이 사이트에 로그인해야 함, D-31). 외부인은 참석자나 Zoom 호스트로 — 서버까지 가기 전에 안내(2026-10-20)
      var doms = cfg().domains || [];
      if (p.bookFor && doms.length && doms.indexOf(p.bookFor.split('@')[1]) === -1) return t('form.err.bookForDomain', { domains: doms.join(', ') });
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
      var kept = { calendarId: params.calendarId, eventId: edit.eventId, title: params.title, start: params.start, end: params.end, status: 'CONFIRMED', grade: edit.grade || null };
      // 담당자가 남의 예약을 고칠 때 주최자를 내 이름으로 바꾸지 않는다
      if (edit.organizerEmail !== undefined) kept.organizerEmail = edit.organizerEmail;
      if (edit.organizerName !== undefined) kept.organizerName = edit.organizerName;
      if (edit.isMine !== undefined) kept.isMine = edit.isMine;
      RB.board.addLocal(kept);
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
