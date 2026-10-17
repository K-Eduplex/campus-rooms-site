/**
 * [myBookings.js] — 내 예약 목록과 취소.
 *
 * 무엇을 한다: 앞으로의 내 예약(확정·대기)과 내 선점 요청을 시간순으로 보여주고 취소·수정(D-25)한다.
 * 의존:        time.js, i18n.js, ui.js, api.js
 * 호출됨:      app.js
 * 주의:        지난 예약은 보여주지 않는다(백엔드가 거른다).
 * 정책 근거:   D-13 ③, D-25(수정)
 */
window.RB = window.RB || {};

RB.myBookings = (function () {
  var U = RB.ui, T = RB.time, t = function (k, v) { return RB.i18n.t(k, v); };
  var currentHost = null;   // 편집 저장 뒤 목록을 다시 그릴 때 쓴다

  function render(host) {
    currentHost = host;
    U.clear(host);
    host.appendChild(U.loadingBlock());
    RB.api.call('myBookings').then(function (data) {
      U.clear(host);
      var items = (data.events || []).map(function (e) { return item(e, false); })
        .concat((data.requests || []).map(function (q) { return item(q, true); }));
      if (!items.length) { host.appendChild(U.el('p.muted', null, [t('mine.empty')])); return; }
      host.appendChild(U.el('div.cards', null, items));
    }).catch(function (err) { U.clear(host); host.appendChild(U.el('p.error', null, [err.message || t('error.network')])); });
  }

  function item(x, isRequest) {
    var lang = RB.i18n.get();
    var start = new Date(x.start), end = new Date(x.end);
    var res = RB.app.state.resources.filter(function (r) { return r.calendarId === x.calendarId; })[0];
    var isDraft = isRequest && x.status === 'DRAFT';
    var statusKey = isDraft ? 'mine.draft' : isRequest ? 'mine.request' : x.status === 'PENDING' ? 'mine.pending' : 'mine.confirmed';
    var card = U.el('div.card', null, [
      U.el('div.card-head', null, [
        U.el('b', null, [res ? res.name : x.resourceName || '']),
        U.el('span.badge.' + (statusKey === 'mine.confirmed' ? 'badge-ok' : 'badge-pending'), null, [t(statusKey)])
      ]),
      U.el('div.card-title', null, [x.title]),
      U.el('div.muted', null, [T.fmtRange(start, end, lang), x.requestId ? ' · ' + x.requestId : '']),
      // 편집이 안 되는 예약은 이유를 한 줄로(캘린더에서 잡은 예약 / 반복 / 대기 중) — "왜 Edit 이 없지?" 문의 방지
      !isRequest && !x.editable ? U.el('div.muted.small', null, [t(!x.isBot ? 'mine.noEdit.calendar' : x.recurring ? 'mine.noEdit.recurring' : 'mine.noEdit.pending')]) : null,
      U.el('div.actions', null, [
        isDraft ? U.el('button.btn.btn-warn.btn-sm', { type: 'button', onclick: function () { RB.bookingForm.openComplete(x.requestId); } }, [t('mine.addReason')]) : null,
        // 사이트 예약(단일 회차·확정)만 편집 가능(D-25). 저장되면 목록을 다시 받는다.
        !isRequest && x.editable ? U.el('button.btn.btn-sm', { type: 'button', onclick: function () {
          RB.bookingForm.open({
            calendarId: x.calendarId, date: T.dateKey(start), startMin: T.minutesOfDay(start), endMin: T.minutesOfDay(end),
            edit: { eventId: x.eventId, title: x.title, guests: x.guests || [], grade: x.grade, organizerEmail: x.organizerEmail, organizerName: x.organizerName, isMine: x.isMine, onDone: function () { if (currentHost) render(currentHost); } }
          });
        } }, [t('btn.edit')]) : null,
        U.el('button.btn.btn-danger.btn-sm', { type: 'button', onclick: function () {
          U.confirm(t('confirm.cancel')).then(function (yes) {
            if (!yes) return;
            RB.api.call('cancel', { key: isRequest ? x.requestId : x.eventId, calendarId: x.calendarId })
              .then(function () { U.toast(t('toast.cancelled'), 'ok'); card.remove(); RB.board.removeLocal(isRequest ? x.requestId : x.eventId); })
              .catch(function (err) { U.toast(t('result.error', { message: err.message || err.code }), 'error'); });
          });
        } }, [t('btn.cancelBooking')])
      ])
    ]);
    return card;
  }

  return { render: render };
})();
