/**
 * [mock.js] — 백엔드 없이 화면을 돌리는 가짜 API.
 *
 * 무엇을 한다: docs/02-아키텍처.md 3절의 API 계약과 같은 모양으로 응답한다. 메모리 안에서
 *              예약·충돌·승인 흐름을 흉내 내므로 화면 개발과 시연에 쓴다.
 * 의존:        config.js, time.js
 * 호출됨:      api.js (mock 모드일 때), auth.js (가짜 로그인 UI)
 * 주의:        실제 정책 판정(보호 구간, 반복 전개 등)은 단순화되어 있다. 정확한 동작은 백엔드가 기준.
 *              새로고침하면 데이터가 초기화된다.
 * 정책 근거:   개발 순서(02-아키텍처.md 10절 1번)
 */
window.RB = window.RB || {};

RB.mock = (function () {
  var T = RB.time;

  // ---- 가짜 사용자 --------------------------------------------------------
  var USERS = {
    user: { email: 'minji.kim@jiu.ac', name: 'Minji Kim', roleKey: 'login.mock.user' },
    approver: { email: 'teacher@cga.sch.id', name: 'Budi Santoso', roleKey: 'login.mock.approver' },
    admin: { email: 'admin@k-eduplex.net', name: 'Admin', roleKey: 'login.mock.admin' }
  };
  var me = null;
  var zoomUsageLoaded = false; // Zoom 사용량 mock: 첫 호출 뒤에는 캐시된 결과처럼 표시

  // ---- 설정 (백엔드 Config 시트에 해당) ------------------------------------
  var CONFIG = {
    slotMinutes: 30,
    displayHours: '07:00-21:00',
    zoomDisplayHours: '00:00-24:00',
    maxAdvanceDays: 180,
    protectHours: 12,
    businessHours: '07:00-19:00',
    escalationHours: 4,
    expiryHours: 24,
    minLeadHours: 2,
    domains: ['jiu.ac', 'k-eduplex.net', 'cga.sch.id'],
    superAdmins: ['admin@k-eduplex.net', 'jhlee@jiu.ac'],
    grades: [
      { code: 'OFFICIAL', label: 'Official event' }, { code: 'CLASS', label: 'Class' },
      { code: 'MEETING', label: 'Meeting' }, { code: 'OTHER', label: 'Other' }
    ]
  };

  // ---- 장소 (Resources 시트) ----------------------------------------------
  var RESOURCES = [
    { calendarId: 'r-m101', name: 'M101', aliases: ['Seminar A'], mode: 'AUTO', kind: 'ROOM', reservable: true, capacity: 20, sortOrder: 1, approvers: ['admin@k-eduplex.net'] },
    { calendarId: 'r-m103', name: 'M103', aliases: [], mode: 'AUTO', kind: 'ROOM', reservable: true, capacity: 20, sortOrder: 2, approvers: ['admin@k-eduplex.net'] },
    { calendarId: 'r-m107a', name: 'M107A', aliases: ['Small meeting'], mode: 'AUTO', kind: 'ROOM', reservable: true, capacity: 8, sortOrder: 3, approvers: ['admin@k-eduplex.net'] },
    { calendarId: 'r-m303', name: 'M303', aliases: ['Media lab'], mode: 'AUTO', kind: 'ROOM', reservable: true, capacity: 30, sortOrder: 4, approvers: ['teacher@cga.sch.id'] },
    { calendarId: 'r-m310', name: 'M310', aliases: [], mode: 'AUTO', kind: 'ROOM', reservable: true, capacity: 40, sortOrder: 5, approvers: ['teacher@cga.sch.id'] },
    { calendarId: 'r-d313', name: 'D313', aliases: ['Manna Hall'], mode: 'APPROVAL', kind: 'ROOM', reservable: true, capacity: 200, sortOrder: 6, approvers: ['teacher@cga.sch.id'] },
    { calendarId: 'r-mb01', name: 'MB01', aliases: ['Basement studio'], mode: 'AUTO', kind: 'ROOM', reservable: true, capacity: 15, sortOrder: 7, approvers: ['admin@k-eduplex.net'], board: 'OTHER', active: true },
    { calendarId: 'r-u101', name: 'U101', aliases: [], mode: 'AUTO', kind: 'ROOM', reservable: true, capacity: 12, sortOrder: 8, approvers: ['admin@k-eduplex.net'], board: 'OTHER', active: false },
    { calendarId: 'r-zoom-blc', name: 'Zoom · BLC', aliases: [], mode: 'APPROVAL', kind: 'ZOOM', reservable: true, capacity: null, sortOrder: 20, approvers: ['admin@k-eduplex.net'], board: 'ZOOM', active: true },
    { calendarId: 'r-zoom-adm', name: '[준비중] Zoom · Admission', aliases: [], mode: 'APPROVAL', kind: 'ZOOM', reservable: true, capacity: null, sortOrder: 21, approvers: ['teacher@cga.sch.id'], board: 'ZOOM', active: false }
  ];

  // ---- 가짜 디렉터리 (참석자 자동완성) --------------------------------------
  var MOCK_DIR = [
    { email: 'staff@jiu.ac', name: 'Seojun Park' }, { email: 'music@jiu.ac', name: 'Woojin Jung' },
    { email: 'club@jiu.ac', name: 'Haneul Lee' }, { email: 'minji.kim@jiu.ac', name: 'Minji Kim' },
    { email: 'its@k-eduplex.net', name: 'IT Support' }, { email: 'admin@k-eduplex.net', name: 'Admin' }
  ];

  // ---- 일정과 요청 (캘린더 + Requests 시트) ---------------------------------
  var events = [];
  var requests = [];
  var seq = 100;
  var intents = {};

  function ev(calendarId, dayOffset, sh, eh, title, email, name, status, grade) {
    var key = T.addDays(T.today(), dayOffset);
    events.push({
      calendarId: calendarId, eventId: 'e' + (++seq), title: title,
      start: T.make(key, sh * 60), end: T.make(key, eh * 60),
      organizerEmail: email, organizerName: name, status: status || 'CONFIRMED', grade: grade || 'MEETING'
    });
    return events[events.length - 1];
  }

  function seed() {
    ev('r-m101', 0, 9, 11, 'Staff meeting', 'staff@jiu.ac', 'Seojun Park', 'CONFIRMED', 'MEETING');
    ev('r-m101', 0, 14, 16, 'Parent consultation', 'minji.kim@jiu.ac', 'Minji Kim', 'CONFIRMED', 'MEETING');
    ev('r-m103', 0, 10, 12, 'Math Olympiad prep', 'teacher@cga.sch.id', 'Budi Santoso', 'CONFIRMED', 'CLASS');
    ev('r-m107a', 0, 13, 13.5, '1:1 interview', 'staff@jiu.ac', 'Seojun Park', 'CONFIRMED', 'OTHER');
    ev('r-m303', 0, 8, 10, 'Video production class', 'minji.kim@jiu.ac', 'Minji Kim', 'CONFIRMED', 'CLASS');
    ev('r-m303', 0, 15, 17, 'Film club editing', 'club@jiu.ac', 'Haneul Lee', 'CONFIRMED', 'OTHER');
    ev('r-m310', 0, 9, 12, 'Science fair setup', 'admin@cga.sch.id', 'Dewi', 'CONFIRMED', 'OFFICIAL');
    ev('r-d313', 0, 18, 20, 'Parent assembly', 'admin@k-eduplex.net', 'Admin', 'CONFIRMED', 'OFFICIAL');
    ev('r-d313', 1, 10, 12, 'Orchestra rehearsal', 'music@jiu.ac', 'Woojin Jung', 'PENDING', 'CLASS');
    ev('r-m101', 1, 9, 10, 'Weekly sync', 'staff@jiu.ac', 'Seojun Park', 'CONFIRMED', 'MEETING');
    ev('r-m303', 2, 14, 16, 'Video production class', 'minji.kim@jiu.ac', 'Minji Kim', 'CONFIRMED', 'CLASS');
    ev('r-m310', 3, 13, 15, 'Parent workshop', 'teacher@cga.sch.id', 'Budi Santoso', 'CONFIRMED', 'MEETING');
    ev('r-m103', 4, 9, 11, 'Admissions info session prep', 'admin@k-eduplex.net', 'Admin', 'CONFIRMED', 'OFFICIAL');
    ev('r-zoom-blc', 1, 20, 21.5, 'Evening language class', 'blc.staff@k-eduplex.net', 'BLC staff', 'CONFIRMED', 'CLASS');

    var pendingEv = events.filter(function (e) { return e.status === 'PENDING'; })[0];
    requests.push({
      requestId: 'R-000201', type: 'BOOK', status: 'PENDING', createdAt: new Date(Date.now() - 3600000),
      requesterEmail: 'music@jiu.ac', requesterName: 'Woojin Jung', calendarId: 'r-d313', resourceName: 'D313',
      title: pendingEv.title, start: pendingEv.start, end: pendingEv.end, grade: 'CLASS', headcount: 60,
      note: 'Need 20 music stands', eventId: pendingEv.eventId, expiresAt: new Date(Date.now() + 20 * 3600000), escalated: false
    });
    pendingEv.requestId = 'R-000201';

    var bumped = events.filter(function (e) { return e.calendarId === 'r-m310' && e.title === 'Parent workshop'; })[0];
    requests.push({
      requestId: 'R-000202', type: 'PREEMPT', status: 'ESCALATED', createdAt: new Date(Date.now() - 6 * 3600000),
      requesterEmail: 'admin@cga.sch.id', requesterName: 'Dewi', calendarId: 'r-m310', resourceName: 'M310',
      title: 'Board meeting', start: bumped.start, end: bumped.end, grade: 'OFFICIAL', headcount: 25,
      reason: 'Foundation board visit confirmed for this date; no other room fits 25 with projector.',
      yields: { 'teacher@cga.sch.id': 'no' }, holderAskedAt: new Date(Date.now() - 5 * 3600000).toISOString(), approversNotifiedAt: new Date(Date.now() - 4 * 3600000).toISOString(),
      conflicts: [bumped], expiresAt: new Date(Date.now() + 4 * 3600000), escalated: true
    });

    var staffMeeting = events.filter(function (e) { return e.title === 'Weekly sync'; })[0];
    requests.push({
      requestId: 'R-000203', type: 'PREEMPT', status: 'DRAFT', createdAt: new Date(Date.now() - 600000),
      requesterEmail: 'minji.kim@jiu.ac', requesterName: 'Minji Kim', calendarId: 'r-m101', resourceName: 'M101',
      title: 'Counselling session', start: staffMeeting.start, end: staffMeeting.end, grade: 'OTHER',
      eventId: 'cal-evt-1', conflicts: [staffMeeting], expiresAt: new Date(Date.now() + 23 * 3600000), escalated: false
    });
  }
  seed();

  // ---- 도우미 --------------------------------------------------------------
  // 데모용 지연. ?mockDelay=2500 처럼 쿼리로 조절한다(기본 150ms).
  function delay(v) { return new Promise(function (r) { setTimeout(function () { r(v); }, Number(new URLSearchParams(location.search).get('mockDelay')) || 150); }); }
  function fail(code, message) { return Promise.reject({ code: code, message: message }); }
  function res(id) { return RESOURCES.filter(function (r) { return r.calendarId === id; })[0]; }
  function isApprover(r) { return me && (me.email === 'admin@k-eduplex.net' || r.approvers.indexOf(me.email) !== -1); }
  function conflictsFor(calendarId, start, end, excludeId) {
    return events.filter(function (e) {
      return e.calendarId === calendarId && e.eventId !== excludeId && T.overlaps(start, end, e.start, e.end);
    });
  }
  function serialize(e) {
    var out = Object.assign({}, e);
    out.start = e.start.toISOString(); out.end = e.end.toISOString();
    if (me) out.isMine = e.organizerEmail === me.email || e.requesterEmail === me.email;
    if (e.conflicts) out.conflicts = e.conflicts.map(serialize);
    if (e.createdAt) out.createdAt = e.createdAt.toISOString();
    if (e.expiresAt) out.expiresAt = e.expiresAt.toISOString();
    return out;
  }

  /** 반복 규칙 → 회차 [{start,end}] (단순 전개, 최대 52회) */
  function expand(p) {
    var start = new Date(p.start), end = new Date(p.end);
    var list = [{ start: start, end: end }];
    var rec = p.recurrence;
    if (!rec || !rec.freq || rec.freq === 'none') return list;
    var stepDays = rec.freq === 'daily' ? 1 : rec.freq === 'weekly' ? 7 : 14;
    var until = rec.until ? T.make(rec.until, 24 * 60) : null;
    var count = rec.count ? Number(rec.count) : 52;
    for (var i = 1; i < count && i < 52; i++) {
      var s = new Date(start.getTime() + i * stepDays * 86400000);
      if (until && s > until) break;
      list.push({ start: s, end: new Date(end.getTime() + i * stepDays * 86400000) });
    }
    return list;
  }

  // ---- API 핸들러 ----------------------------------------------------------
  var handlers = {
    init: function (p) {
      return Promise.all([handlers.me(), handlers.resources(), p && p.from ? handlers.board(p) : Promise.resolve(null)])
        .then(function (r) { return { me: r[0], resources: r[1], board: r[2] }; });
    },

    me: function () {
      var approverOf = RESOURCES.filter(isApprover).map(function (r) { return r.calendarId; });
      var pending = requests.filter(function (q) {
        return (q.status === 'PENDING' || q.status === 'ESCALATED') && isApprover(res(q.calendarId));
      }).length;
      return delay({
        email: me.email, name: me.name, isSuperAdmin: me.email === 'admin@k-eduplex.net',
        approverOf: approverOf, pendingApprovals: pending, config: CONFIG,
        sheetUrl: 'https://docs.google.com/spreadsheets/d/1mbXDwXMDWt8wjIZ0KwZQwrKJ54GOnkTz20jgr2b29Go/edit'
      });
    },

    resources: function () { return delay(RESOURCES.map(function (r) { return Object.assign({}, r); })); },

    board: function (p) {
      var from = new Date(p.from), to = new Date(p.to);
      var g = String(p.group || 'MAIN').toUpperCase();
      // 백엔드 boardGroupOf_ 와 같은 규칙
      var groupOf = function (r) {
        if (r.kind === 'ZOOM' || r.board === 'ZOOM') return 'ZOOM';
        if (r.board === 'OTHER' || r.active === false) return 'OTHER';
        return 'MAIN';
      };
      var inGroup = function (id) { return g === 'ALL' || groupOf(res(id) || {}) === g; };
      var list = events.filter(function (e) { return inGroup(e.calendarId) && T.overlaps(from, to, e.start, e.end); }).map(serialize);
      var pend = requests.filter(function (r) {
        return (r.status === 'PENDING' || r.status === 'ESCALATED') && r.type === 'PREEMPT' && T.overlaps(from, to, r.start, r.end);
      }).map(serialize);
      return delay({ events: list, pending: pend });
    },

    book: function (p) {
      // p.zoomHost 는 데모에서 받기만 하고 무시한다(실제 백엔드가 host key 메일을 보낸다).
      var r = res(p.calendarId);
      if (!r) return fail('BAD_REQUEST', 'unknown room');
      var occ = expand(p);
      var conflicts = [];
      occ.forEach(function (o) { conflicts = conflicts.concat(conflictsFor(r.calendarId, o.start, o.end)); });

      if (conflicts.length) {
        var key = 'i' + (++seq);
        intents[key] = { p: p, occ: occ, conflicts: conflicts };
        var first = occ[0];
        var protectedUntil = new Date(Date.now() + CONFIG.protectHours * 3600000);
        var alternatives = [];
        // 같은 장소 다음 빈 시간
        var dur = first.end - first.start, probe = new Date(first.end.getTime());
        // Zoom 은 24시간(30분 칸 48개) 안에서 찾는다(D-28).
        var probes = r.kind === 'ZOOM' ? 48 : 12;
        for (var i = 0; i < probes && alternatives.length < 1; i++) {
          if (!conflictsFor(r.calendarId, probe, new Date(probe.getTime() + dur)).length) {
            alternatives.push({ calendarId: r.calendarId, resourceName: r.name, start: probe.toISOString(), end: new Date(probe.getTime() + dur).toISOString() });
          }
          probe = new Date(probe.getTime() + CONFIG.slotMinutes * 60000);
        }
        // 같은 시간 다른 장소
        RESOURCES.forEach(function (o) {
          // 같은 종류만: Zoom 계정끼리, 방끼리(방은 자동 수락 방만, D-28)
          var sameKind = (o.kind === 'ZOOM') === (r.kind === 'ZOOM');
          var modeOk = r.kind === 'ZOOM' || o.mode === 'AUTO';
          if (o.calendarId !== r.calendarId && o.active !== false && sameKind && modeOk && alternatives.length < 3 && !conflictsFor(o.calendarId, first.start, first.end).length) {
            alternatives.push({ calendarId: o.calendarId, resourceName: o.name, start: first.start.toISOString(), end: first.end.toISOString() });
          }
        });
        return delay({
          kind: 'CONFLICT', intentKey: key, occurrences: occ.length,
          conflicts: conflicts.map(serialize), alternatives: alternatives,
          preemptAllowed: conflicts.every(function (c) { return c.start > protectedUntil; }) && r.mode === 'AUTO'
        });
      }

      var needsApproval = r.mode === 'APPROVAL' || r.kind === 'ZOOM';   // Zoom 은 승인 방과 같이 취급
      if (needsApproval && !isApprover(r)) {   // D-26: 담당자 본인은 바로 확정
        var evp = pushEvents(r, p, occ, 'PENDING');
        var rq = pushRequest('BOOK', r, p, occ[0], evp[0]);
        return delay({ kind: 'PENDING', request: serialize(rq) });
      }
      var made = pushEvents(r, p, occ, 'CONFIRMED');
      return delay({ kind: 'CONFIRMED', occurrences: occ.length, skipped: 0, eventId: made[0].eventId });
    },

    bookFreeOnly: function (p) {
      var it = intents[p.intentKey];
      if (!it) return fail('BAD_REQUEST', 'intent expired');
      var r = res(it.p.calendarId);
      var free = it.occ.filter(function (o) { return !conflictsFor(r.calendarId, o.start, o.end).length; });
      var made2 = pushEvents(r, it.p, free, 'CONFIRMED');
      return delay({ kind: 'CONFIRMED', occurrences: free.length, skipped: it.occ.length - free.length, eventId: made2.length ? made2[0].eventId : null });
    },

    preempt: function (p) {
      var it = intents[p.intentKey];
      if (!it) return fail('BAD_REQUEST', 'intent expired');
      if (!p.reason || !p.reason.trim()) return fail('BAD_REQUEST', 'reason required');
      var r = res(it.p.calendarId);
      var rq = pushRequest('PREEMPT', r, it.p, it.occ[0], null);
      rq.reason = p.reason; rq.conflicts = it.conflicts;
      return delay({ kind: 'PENDING', request: serialize(rq) });
    },

    /** 디렉터리 전체 (mock) */
    directory: function () {
      return delay({ users: MOCK_DIR.map(function (u) { return { e: u.email, n: u.name }; }), at: Date.now() });
    },

    /** 참석자 자동완성 (mock 디렉터리) */
    people: function (p) {
      var q = String(p.q || '').toLowerCase();
      var dir = MOCK_DIR; var _unused = [
        { email: 'staff@jiu.ac', name: 'Seojun Park' }, { email: 'music@jiu.ac', name: 'Woojin Jung' },
        { email: 'club@jiu.ac', name: 'Haneul Lee' }, { email: 'minji.kim@jiu.ac', name: 'Minji Kim' },
        { email: 'its@k-eduplex.net', name: 'IT Support' }, { email: 'admin@k-eduplex.net', name: 'Admin' }
      ];
      return delay(q.length < 2 ? [] : dir.filter(function (u) { return u.name.toLowerCase().indexOf(q) !== -1 || u.email.indexOf(q) !== -1; }));
    },

    myBookings: function () {
      var mine = events.filter(function (e) { return e.organizerEmail === me.email && e.end > new Date(); })
        .sort(function (a, b) { return a.start - b.start; }).map(serialize)
        .map(function (e) { e.editable = e.status === 'CONFIRMED'; e.guests = e.guests || []; return e; });
      var reqs = requests.filter(function (q) { return q.requesterEmail === me.email && (q.status === 'DRAFT' || (!q.eventId && (q.status === 'PENDING' || q.status === 'ESCALATED'))); }).map(serialize);
      return delay({ events: mine, requests: reqs });
    },

    /** 예약 수정 (D-25 mock): 시간 충돌이면 CONFLICT */
    update: function (p) {
      var e = events.filter(function (x) { return x.eventId === p.eventId; })[0];
      if (!e) return fail('NOT_FOUND', 'no such booking');
      var r = res(e.calendarId);
      if (e.organizerEmail !== me.email && !isApprover(r)) return fail('FORBIDDEN', 'not yours');
      var ns = new Date(p.start), ne = new Date(p.end);
      var changed = [];
      if (ns.getTime() !== e.start.getTime() || ne.getTime() !== e.end.getTime()) {
        if (r.mode === 'APPROVAL') return fail('REJECTED', 'This room requires approval, so a time change needs a new request. Cancel and book again.');
        var c = conflictsFor(r.calendarId, ns, ne).filter(function (x) { return x.eventId !== e.eventId; });
        if (c.length) return delay({ kind: 'CONFLICT', conflicts: c.map(serialize) });
        e.start = ns; e.end = ne; changed.push('time');
      }
      if (p.title && p.title !== e.title) { e.title = p.title; changed.push('title'); }
      if ((p.guests || []).join(',') !== (e.guests || []).join(',')) { e.guests = (p.guests || []).slice(); changed.push('attendees'); }
      return delay({ kind: 'UPDATED', eventId: e.eventId, changed: changed });
    },

    cancel: function (p) {
      var idx = -1;
      events.forEach(function (e, i) { if (e.eventId === p.key) idx = i; });
      if (idx !== -1) {
        var e = events[idx];
        var r = res(e.calendarId);
        if (e.organizerEmail !== me.email && !isApprover(r)) return fail('FORBIDDEN', 'not yours');
        events.splice(idx, 1);
        requests.forEach(function (q) { if (q.eventId === e.eventId && q.status !== 'APPROVED') q.status = 'CANCELLED'; });
        return delay({ ok: true });
      }
      var q = requests.filter(function (x) { return x.requestId === p.key; })[0];
      if (!q) return fail('NOT_FOUND', 'no such booking');
      q.status = 'CANCELLED';
      return delay({ ok: true });
    },

    approvals: function () {
      var mine = requests.filter(function (q) { return isApprover(res(q.calendarId)); });
      var wrap = function (q) { return { request: serialize(q), resource: res(q.calendarId) }; };
      var pending = mine.filter(function (q) { return q.status === 'PENDING' || q.status === 'ESCALATED'; }).map(wrap);
      var decided = mine.filter(function (q) { return ['APPROVED', 'REJECTED', 'EXPIRED'].indexOf(q.status) !== -1 && q.end > new Date(); }).map(wrap);
      return delay({ pending: pending, decided: decided });
    },

    approve: function (p) {
      var q = requests.filter(function (x) { return x.requestId === p.requestId; })[0];
      if (!q) return fail('NOT_FOUND', '');
      q.status = 'APPROVED'; q.approver = me.email; q.decidedAt = new Date().toISOString();
      if (q.type === 'BOOK') {
        events.forEach(function (e) { if (e.eventId === q.eventId) e.status = 'CONFIRMED'; });
      } else {
        (q.conflicts || []).forEach(function (c) {
          var i = events.indexOf(c); if (i !== -1) events.splice(i, 1);
        });
        events.push({
          calendarId: q.calendarId, eventId: 'e' + (++seq), title: q.title, start: q.start, end: q.end,
          organizerEmail: q.requesterEmail, organizerName: q.requesterName, status: 'CONFIRMED', grade: q.grade
        });
      }
      return delay({ ok: true });
    },

    /** 캘린더 경로 DRAFT 조회 (mock: 시드에 R-000203 하나) */
    draft: function (p) {
      var q = requests.filter(function (x) { return x.requestId === p.requestId && x.requesterEmail === me.email; })[0];
      if (!q) return fail('NOT_FOUND', 'Request not found.');
      return delay(serialize(q));
    },

    completePreempt: function (p) {
      var q = requests.filter(function (x) { return x.requestId === p.requestId; })[0];
      if (!q || q.status !== 'DRAFT') return fail('REJECTED', 'This request has already been submitted.');
      if (!p.reason || !p.reason.trim()) return fail('REJECTED', 'A reason is required.');
      q.status = 'PENDING'; q.reason = p.reason.trim(); q.createdAt = new Date();
      return delay({ message: 'Preemption request submitted.', request: serialize(q) });
    },

    /** 관리 콘솔의 리소스 캘린더를 시트로 가져온다 (mock: 비활성 방 2개가 새로 들어온 것으로 흉내) */
    importRooms: function () {
      if (me.email !== 'admin@k-eduplex.net') return fail('FORBIDDEN', 'super admin only');
      return delay({ added: 2, total: RESOURCES.length + 2 });
    },

    testEmail: function () { return delay({ sent: 5, to: me.email }); },
    testAnnounce: function () { return delay({ ok: true, id: '123' }); },

    /** 웹훅 저장 (mock) */
    setWebhook: function (p) {
      if (me.email !== 'admin@k-eduplex.net') return fail('FORBIDDEN', 'super admin only');
      return delay({ ok: true, configured: !!p.url });
    },

    /** People 추가 (mock: 이메일 수만 셈) */
    addPeople: function (p) {
      if (me.email !== 'admin@k-eduplex.net') return fail('FORBIDDEN', 'super admin only');
      var emails = (String(p.text || '').match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || []);
      return delay({ parsed: emails.length, added: emails.length, updated: 0, total: 40 + emails.length, preview: emails.slice(0, 3) });
    },

    /** 설정·권한 점검 (mock: 고정 결과) */
    healthCheck: function () {
      if (me.email !== 'admin@k-eduplex.net') return fail('FORBIDDEN', 'super admin only');
      return delay({ checks: [
        { ok: true, label: 'Web app runs as owner' },
        { ok: true, label: 'Calendar write access', detail: '6 of 6 active rooms' },
        { ok: true, label: 'Approvers resolve to at least one email', detail: '6 rooms' },
        { ok: false, label: 'Chat webhook configured', detail: 'CHAT_WEBHOOK_URL is empty — announcements are off' },
        { ok: true, label: 'Time triggers installed', detail: 'sync 5 min, sweep 15 min' }
      ] });
    },

    // Zoom 사용량 mock: 최근 개월/계정/동시 사용량 보고서를 만든다.
    zoomUsage: function (p) {
      if (me.email !== 'admin@k-eduplex.net') return fail('FORBIDDEN', 'super admin only');
      var now = new Date();
      var y = now.getFullYear();
      var m = now.getMonth() + 1;
      var idx = y * 12 + (m - 1);
      var monthsList = [];
      var unavailable = [];
      for (var j = 11; j >= 0; j--) {
        var cur = idx - j;
        var yy = Math.floor(cur / 12);
        var mm = (cur % 12) + 1;
        var monthStr = yy + '-' + (mm < 10 ? '0' + mm : mm);
        if (j >= 6) {
          unavailable.push(monthStr);
        } else {
          monthsList.push(monthStr);
        }
      }
      var accounts = ['academic2@k-eduplex.net', 'blc@k-eduplex.net', 'cga@k-eduplex.net', 'jiu.academic3@k-eduplex.net', 'official@jiu.ac'].sort();
      var perAccountMonth = {};
      accounts.forEach(function (email, a) {
        perAccountMonth[email] = {};
        monthsList.forEach(function (month, i) {
          var meetings = (a * 3 + i * 2 + (email.length % 4)) % 15;
          var hours = Math.round(meetings * 1.4 * 10) / 10;
          var days = Math.max(0, Math.min(meetings, 5 + i));
          var avgParticipants = Math.round((2 + ((a + i) % 17)) * 10) / 10;
          perAccountMonth[email][month] = { meetings: meetings, hours: hours, days: days, avgParticipants: avgParticipants };
        });
      });
      var curMonth = monthsList[monthsList.length - 1];
      var d1 = curMonth + '-03';
      var d2 = curMonth + '-08';
      var d3 = curMonth + '-12';
      var d4 = curMonth + '-17';
      var d5 = curMonth + '-22';
      // 2개 이상 동시 사용일: 월 순서대로 2·7·12·17·22일을 채워 25일을 만든다(중복 없음, 정렬됨)
      var dates2 = [];
      for (var mi = 0; mi < monthsList.length && dates2.length < 25; mi++) {
        for (var di = 0; di < 5 && dates2.length < 25; di++) {
          var dd = 2 + di * 5;
          dates2.push(monthsList[mi] + '-' + (dd < 10 ? '0' + dd : dd));
        }
      }
      var result = {
        generatedAt: now.toISOString(),
        accounts: accounts,
        months: monthsList,
        perAccountMonth: perAccountMonth,
        concurrency: {
          max: 4,
          minutesAtLeast: { 1: 9000, 2: 1536, 3: 390, 4: 60 },
          daysAtLeast: { 2: dates2, 3: [d1, d2, d3, d4, d5], 4: [d3] }
        },
        unavailableMonths: unavailable,
        errors: [],
        fromCache: !(p && p.refresh) && zoomUsageLoaded
      };
      zoomUsageLoaded = true;
      return delay(result);
    },

    // 승인 응답 현황 mock: 합성 데이터(2건 대기, 담당자 3명, 방 3곳). 기간 버튼에 따라 건수만 늘어난다.
    approvalStats: function (p) {
      if (me.email !== 'admin@k-eduplex.net') return fail('FORBIDDEN', 'super admin only');
      var days = Number(p && p.days) === 90 ? 90 : 30;
      var k = days === 90 ? 3 : 1;
      var now = new Date();
      var HOUR = 3600 * 1000;
      return delay({
        generatedAt: now.toISOString(),
        days: days,
        pending: [
          { requestId: 'R-2041', room: 'D313', title: 'Parent meeting', startAt: new Date(now.getTime() + 30 * HOUR).toISOString(), stage: 'approver', waitingHours: 14.5, approvers: ['teacher@cga.sch.id', 'budi@cga.sch.id'], escalated: true, expiresAt: new Date(now.getTime() + 6 * HOUR).toISOString() },
          { requestId: 'R-2047', room: 'M101', title: 'Robotics club', startAt: new Date(now.getTime() + 52 * HOUR).toISOString(), stage: 'holder', waitingHours: 2, approvers: ['admin@k-eduplex.net'], escalated: false, expiresAt: new Date(now.getTime() + 20 * HOUR).toISOString() }
        ],
        byApprover: [
          { email: 'budi@cga.sch.id', rooms: ['D313'], assigned: 9 * k, decided: 6 * k, medianHours: 9.5, maxHours: 31.5, escalated: 4 * k, expired: 2 },
          { email: 'teacher@cga.sch.id', rooms: ['D313', 'S204'], assigned: 12 * k, decided: 11 * k, medianHours: 2.5, maxHours: 8, escalated: 1 * k, expired: 0 },
          { email: 'admin@k-eduplex.net', rooms: ['M101'], assigned: 5 * k, decided: 5 * k, medianHours: 1, maxHours: 3.5, escalated: 0, expired: 0 }
        ],
        byRoom: [
          { room: 'D313', approvers: ['budi@cga.sch.id', 'teacher@cga.sch.id'], requests: 14 * k, decided: 12 * k, medianHours: 4, maxHours: 31.5, escalated: 5 * k, expired: 2 },
          { room: 'S204', approvers: ['teacher@cga.sch.id'], requests: 7 * k, decided: 7 * k, medianHours: 1.5, maxHours: 4, escalated: 0, expired: 0 },
          { room: 'M101', approvers: ['admin@k-eduplex.net'], requests: 5 * k, decided: 5 * k, medianHours: 1, maxHours: 3.5, escalated: 0, expired: 0 }
        ],
        byHolder: [
          { email: 'rina@cga.sch.id', asked: 5 * k, yes: 1 * k, no: 1 * k, noAnswer: 3, medianHours: 4.5, maxHours: 11 },
          { email: 'teacher@cga.sch.id', asked: 4 * k, yes: 3 * k, no: 1 * k, noAnswer: 0, medianHours: 1.5, maxHours: 3 },
          { email: 'budi@cga.sch.id', asked: 2 * k, yes: 2 * k, no: 0, noAnswer: 0, medianHours: 0.5, maxHours: 1 }
        ]
      });
    },

    reject: function (p) {
      var q = requests.filter(function (x) { return x.requestId === p.requestId; })[0];
      if (!q) return fail('NOT_FOUND', '');
      q.status = 'REJECTED'; q.approver = me.email; q.decidedAt = new Date().toISOString(); q.decisionNote = p.note || ''; q.decisionNote = p.note;
      if (q.type === 'BOOK') {
        var i = -1; events.forEach(function (e, k) { if (e.eventId === q.eventId) i = k; });
        if (i !== -1) events.splice(i, 1);
      }
      return delay({ ok: true });
    }
  };

  function pushEvents(r, p, occ, status) {
    return occ.map(function (o) {
      var e = {
        calendarId: r.calendarId, eventId: 'e' + (++seq), title: p.title, start: o.start, end: o.end,
        organizerEmail: me.email, organizerName: me.name, status: status, grade: p.grade || 'OTHER'
      };
      events.push(e);
      return e;
    });
  }

  function pushRequest(type, r, p, occ, event) {
    var q = {
      requestId: 'R-' + String(++seq).padStart(6, '0'), type: type, status: 'PENDING', createdAt: new Date(),
      requesterEmail: me.email, requesterName: me.name, calendarId: r.calendarId, resourceName: r.name,
      title: p.title, start: occ.start, end: occ.end, grade: p.grade || 'OTHER', headcount: p.headcount, note: p.note,
      eventId: event ? event.eventId : null, expiresAt: new Date(Date.now() + 24 * 3600000), escalated: false
    };
    if (event) event.requestId = q.requestId;
    requests.push(q);
    return q;
  }

  function handle(action, params) {
    // 새로고침 뒤 세션 복원: auth.js 가 저장한 세션의 이메일로 가짜 사용자를 되찾는다
    if (!me) {
      try {
        var saved = JSON.parse(localStorage.getItem('rb.session') || 'null');
        if (saved) Object.keys(USERS).forEach(function (k) { if (USERS[k].email === saved.email) me = USERS[k]; });
      } catch (e) { /* 무시 */ }
    }
    if (!me && action !== 'me') return fail('AUTH', 'not signed in');
    var h = handlers[action];
    return h ? h(params) : fail('BAD_REQUEST', 'unknown action ' + action);
  }

  /** 가짜 로그인 UI: 역할을 골라 들어간다 */
  function renderLogin(host, onPick) {
    var U = RB.ui;
    U.clear(host);
    host.appendChild(U.el('p.muted', null, [RB.i18n.t('login.mockAs')]));
    Object.keys(USERS).forEach(function (k) {
      var u = USERS[k];
      host.appendChild(U.el('button.btn.btn-block', {
        type: 'button',
        onclick: function () { me = u; onPick({ email: u.email, name: u.name }); }
      }, [RB.i18n.t(u.roleKey) + ' · ' + u.email]));
    });
  }

  return { handle: handle, renderLogin: renderLogin };
})();
