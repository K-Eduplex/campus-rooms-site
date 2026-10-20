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
      var asks = data.yieldRequests || [];
      if (RB.app.updateMineBadge) RB.app.updateMineBadge(asks.length);
      // 나에게 온 양보 질문은 맨 위에(메일 버튼과 같은 처리)
      if (asks.length) {
        host.appendChild(U.el('h2.section-title', null, [t('mine.yield.title')]));
        host.appendChild(U.el('div.cards', null, asks.map(yieldCard)));
      }
      var items = (data.events || []).map(function (e) { return item(e, false); })
        .concat((data.requests || []).map(function (q) { return item(q, true); }));
      if (!items.length) { if (!asks.length) host.appendChild(U.el('p.muted', null, [t('mine.empty')])); return; }
      host.appendChild(U.el('div.cards', null, items));
    }).catch(function (err) { U.clear(host); host.appendChild(U.el('p.error', null, [err.message || t('error.network')])); });
  }

  /** 양보 질문 카드: 누가 무엇을 원하는지, 내 예약, 답 기한, Yes / No. */
  function yieldCard(q) {
    var lang = RB.i18n.get();
    var card, yesBtn, noBtn;
    function answer(ans, btn) {
      U.busy(btn);
      RB.api.call('answerYield', { requestId: q.requestId, answer: ans }).then(function (r) {
        if (r && r.ok === false) U.toast(t('result.error', { message: r.message }), 'error');
        else U.toast((r && r.message) || '', 'ok');
        if (currentHost) render(currentHost);   // 목록과 탭 배지를 서버 기준으로 다시 받는다
      }).catch(function (err) {
        btn.classList.remove('busy'); yesBtn.disabled = false; noBtn.disabled = false;
        U.toast(t('result.error', { message: err.message || err.code }), 'error');
      });
      yesBtn.disabled = true; noBtn.disabled = true;
    }
    yesBtn = U.el('button.btn.btn-success.btn-sm', { type: 'button', onclick: function () {
      U.confirm(t('mine.yield.confirm'), { okLabel: t('mine.yield.yes'), okClass: 'btn-success' }).then(function (yes) { if (yes) answer('yes', yesBtn); });
    } }, [t('mine.yield.yes')]);
    noBtn = U.el('button.btn.btn-sm', { type: 'button', onclick: function () { answer('no', noBtn); } }, [t('mine.yield.no')]);
    var mine = (q.myBookings || []).map(function (b) {
      return U.el('div.muted', null, [t('mine.yield.yourBooking') + ': ' + b.title + ' · ' + T.fmtRange(new Date(b.start), new Date(b.end), lang)]);
    });
    card = U.el('div.card.yield-card', null, [
      U.el('div.card-title', null, [t('mine.yield.asks', { who: q.requesterName || q.requester, room: q.room })]),
      U.el('div', null, [q.title + ' · ' + T.fmtRange(new Date(q.startAt), new Date(q.endAt), lang)]),
      U.el('div.muted', null, [t('mine.yield.reason') + ': ' + (q.reason || '-') + (q.grade ? ' · ' + q.grade : '')])
    ].concat(mine, [
      U.el('div.yield-auto', null, [q.autoYieldAt ? t('mine.yield.auto', { time: T.fmtDateTime(new Date(q.autoYieldAt), lang) }) : t('mine.yield.noAuto')]),
      q.approvalRoom ? U.el('div.muted.small', null, [t('mine.yield.approvalNote')]) : null,
      U.el('div.actions', null, [yesBtn, noBtn])
    ]));
    return card;
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
      // 대신 예약(2026-10-21): 내가 남을 위해 했거나(bookedFor) 남이 나를 위해 한(bookedBy) 예약 표시
      x.bookedFor ? U.el('div.muted.small', null, [t('mine.bookedFor', { who: x.bookedForName || x.bookedFor })]) : null,
      x.bookedBy ? U.el('div.muted.small', null, [t('mine.bookedBy', { who: x.bookedBy })]) : null,
      // 편집이 안 되는 예약은 이유를 한 줄로(캘린더에서 잡은 예약 / 대기 중) — "왜 Edit 이 없지?" 문의 방지
      !isRequest && !x.editable ? U.el('div.muted.small', null, [t(!x.isBot ? 'mine.noEdit.calendar' : 'mine.noEdit.pending')]) : null,
      U.el('div.actions', null, [
        isDraft ? U.el('button.btn.btn-warn.btn-sm', { type: 'button', onclick: function () { RB.bookingForm.openComplete(x.requestId); } }, [t('mine.addReason')]) : null,
        // 사이트 예약(확정, 반복 예약은 회차별)만 편집 가능(D-25). 저장되면 목록을 다시 받는다.
        !isRequest && x.editable ? U.el('button.btn.btn-sm', { type: 'button', onclick: function () {
          RB.bookingForm.open({
            calendarId: x.calendarId, date: T.dateKey(start), startMin: T.minutesOfDay(start), endMin: T.minutesOfDay(end),
            edit: { eventId: x.eventId, title: x.title, guests: x.guests || [], grade: x.grade, organizerEmail: x.organizerEmail, organizerName: x.organizerName, isMine: x.isMine, occurrenceOnly: !!x.recurring, onDone: function () { if (currentHost) render(currentHost); } }
          });
        } }, [t('btn.edit')]) : null,
        U.el('button.btn.btn-danger.btn-sm', { type: 'button', onclick: function () {
          U.confirm(t('confirm.cancel')).then(function (yes) {
            if (!yes) return;
            RB.api.call('cancel', { key: isRequest ? x.requestId : x.eventId, calendarId: x.calendarId })
              .then(function () { U.toast(t('toast.cancelled'), 'ok'); card.remove(); RB.board.removeLocal(isRequest ? x.requestId : x.eventId); })
              .catch(function (err) { U.toast(t('result.error', { message: err.message || err.code }), 'error'); });
          });
        } }, [t(!isRequest && x.recurring ? 'btn.cancelOccurrence' : 'btn.cancelBooking')]),
        // 반복 예약: 이 날짜와 이후 회차를 모두 취소(이전 회차는 남는다)
        !isRequest && x.seriesCancelable ? U.el('button.btn.btn-danger.btn-sm', { type: 'button', onclick: function () {
          U.confirm(t('confirm.cancelFollowing')).then(function (yes) {
            if (!yes) return;
            RB.api.call('cancel', { key: x.eventId, calendarId: x.calendarId, scope: 'following' })
              .then(function () {
                U.toast(t('toast.cancelled'), 'ok');
                if (RB.board && RB.board.refresh) RB.board.refresh();
                if (currentHost) render(currentHost);
              })
              .catch(function (err) { U.toast(t('result.error', { message: err.message || err.code }), 'error'); });
          });
        } }, [t('btn.cancelFollowing')]) : null
      ])
    ]);
    return card;
  }

  return { render: render };
})();
