/**
 * [ui.js] — 화면 공통 부품: 모달, 토스트, 요소 생성 헬퍼.
 *
 * 무엇을 한다: 모든 화면 모듈이 같은 모양의 모달·알림을 쓰도록 한 곳에서 만든다.
 * 의존:        i18n.js
 * 호출됨:      board.js, bookingForm.js, myBookings.js, approvals.js, auth.js
 * 주의:        모달은 한 번에 하나만 연다. 열려 있으면 먼저 닫는다.
 */
window.RB = window.RB || {};

RB.ui = (function () {
  /**
   * 요소 생성 헬퍼. el('div.card.mine', {onclick: fn, title: '..'}, [child, 'text'])
   * 태그 뒤에 .클래스 를 이어 붙일 수 있다.
   */
  function el(spec, attrs, children) {
    var parts = spec.split('.');
    var node = document.createElement(parts[0] || 'div');
    if (parts.length > 1) node.className = parts.slice(1).join(' ');
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k.indexOf('on') === 0 && typeof attrs[k] === 'function') node.addEventListener(k.slice(2), attrs[k]);
      else if (k === 'style' && typeof attrs[k] === 'object') Object.assign(node.style, attrs[k]);
      else if (k === 'dataset') Object.assign(node.dataset, attrs[k]);
      else if (k in node && k !== 'list') node[k] = attrs[k];
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) {
      if (c === null || c === undefined) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

  var modalRoot = null;
  var modalReturnFocus = null;   // 모달을 열기 전에 포커스가 있던 요소
  var modalSeq = 0;

  function modalKey(e) { if (e.key === 'Escape' && modalRoot) { e.preventDefault(); closeModal(); } }

  /**
   * 모달 열기. content 는 DOM 노드. 반환값의 close() 로 닫는다.
   * Esc 로 닫히고, 열면 포커스가 대화상자 안으로 들어가며 닫으면 원래 자리로 돌아간다.
   * @param {Element} content
   * @param {{title?:string, wide?:boolean}} opts
   */
  function modal(content, opts) {
    var prev = document.activeElement;   // closeModal 이 이전 포커스를 지우므로 먼저 기억한다
    if (modalRoot && prev && modalRoot.contains(prev)) prev = modalReturnFocus;   // 모달 위에 모달: 원래 자리를 유지
    closeModal();
    modalReturnFocus = prev;
    opts = opts || {};
    var titleId = 'modal-title-' + (++modalSeq);
    var box = el('div.modal' + (opts.wide ? '.modal-wide' : ''), { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId });
    var head = el('div.modal-head', null, [
      el('h2', { id: titleId }, [opts.title || '']),
      el('button.icon-btn', { type: 'button', 'aria-label': RB.i18n.t('btn.close'), onclick: closeModal }, ['×'])
    ]);
    box.appendChild(head);
    box.appendChild(el('div.modal-body', null, [content]));
    modalRoot = el('div.modal-backdrop', { onclick: function (e) { if (e.target === modalRoot) closeModal(); } }, [box]);
    document.body.appendChild(modalRoot);
    document.body.classList.add('modal-open');
    document.addEventListener('keydown', modalKey);
    var first = box.querySelector('input:not([type=hidden]), select, textarea, button, [href], [tabindex]:not([tabindex="-1"])');
    // 첫 입력칸을 우선한다(닫기 버튼보다 본문). 없으면 첫 포커스 가능 요소, 그것도 없으면 상자 자체.
    var body = box.querySelector('.modal-body');
    var field = body && body.querySelector('input:not([type=hidden]), select, textarea, button');
    if (field) field.focus();
    else if (first) first.focus();
    else { box.tabIndex = -1; box.focus(); }
    return { close: closeModal, box: box };
  }

  function closeModal() {
    document.removeEventListener('keydown', modalKey);
    if (modalRoot && modalRoot.parentNode) modalRoot.parentNode.removeChild(modalRoot);
    var back = modalReturnFocus;
    var wasOpen = !!modalRoot;
    modalRoot = null;
    modalReturnFocus = null;
    document.body.classList.remove('modal-open');
    if (wasOpen && back && document.body.contains(back) && typeof back.focus === 'function') back.focus();
  }

  /** 하단 알림. kind: 'ok' | 'error' | 'info' */
  function toast(text, kind) {
    var host = document.getElementById('toasts');
    var node = el('div.toast.toast-' + (kind || 'info'), null, [text]);
    host.appendChild(node);
    setTimeout(function () { node.classList.add('show'); }, 10);
    setTimeout(function () {
      node.classList.remove('show');
      setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 300);
    }, 3500);
  }

  /** 로그인 카드 ↔ "Signing you in…" 스피너 전환. text 로 단계 문구를 바꿀 수 있다. */
  var slowTimer = null;
  function signingIn(on, text) {
    var form = document.getElementById('login-form'), box = document.getElementById('signing-in');
    if (!form || !box) return;
    form.hidden = !!on; box.hidden = !on;
    var p = document.getElementById('signing-in-text');
    if (p) p.textContent = text || RB.i18n.t('login.signingIn');
    // 4초 넘게 걸리면 서버(Apps Script 콜드 스타트)를 깨우는 중이라는 안내를 덧붙인다
    if (slowTimer) { clearTimeout(slowTimer); slowTimer = null; }
    var old = document.getElementById('signing-in-hint');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    if (on) {
      slowTimer = setTimeout(function () {
        slowTimer = null;
        if (box.hidden || document.getElementById('signing-in-hint')) return;
        box.appendChild(el('p.muted', { id: 'signing-in-hint' }, [RB.i18n.t('login.slowHint')]));
      }, 4000);
    }
  }

  /** 영역 안에 가운데 스피너 + 문구 */
  function loadingBlock(text) {
    return el('div.loading-center', null, [el('div.spinner.small'), el('div', null, [text || RB.i18n.t('loading')])]);
  }

  /**
   * 확인 대화상자 (브라우저 confirm 대체). resolve(true|false)
   * 기본은 예약 취소용(빨간 버튼). 다른 확인에는 opts 로 문구·클래스를 바꾼다.
   * @param {string} text
   * @param {{okLabel?: string, okClass?: string}} [opts] okLabel 기본 btn.cancelBooking, okClass 기본 btn-danger
   */
  function confirm(text, opts) {
    return new Promise(function (resolve) {
      var m;
      var body = el('div', null, [
        el('p', null, [text]),
        el('div.actions', null, [
          el('button.btn', { type: 'button', onclick: function () { m.close(); resolve(false); } }, [RB.i18n.t('btn.close')]),
          el('button.btn.' + ((opts && opts.okClass) || 'btn-danger'), { type: 'button', onclick: function (e) { busy(e.currentTarget); m.close(); resolve(true); } }, [(opts && opts.okLabel) || RB.i18n.t('btn.cancelBooking')])
        ])
      ]);
      m = modal(body, { title: '' });
    });
  }

  /** 등급 배지. 상위 등급(앞쪽)일수록 진하게 — 담당자 화면에서 눈에 띄게(D-07) */
  function gradeBadge(code, grades) {
    if (!code) return null;
    var idx = (grades || []).map(function (g) { return g.code; }).indexOf(code);
    var level = idx === -1 ? 'low' : idx === 0 ? 'top' : idx === 1 ? 'high' : 'low';
    var g = (grades || [])[idx];
    return el('span.badge.grade-' + level, null, [g && g.label ? g.label : RB.i18n.t('grade.' + code)]);
  }

  /** 상단 진행 표시줄. 동시에 여러 호출이 있을 수 있어 카운터로 관리한다. */
  var pending = 0;
  function progress(on) {
    pending = Math.max(0, pending + (on ? 1 : -1));
    var bar = document.getElementById('progress');
    if (bar) bar.hidden = pending === 0;
  }

  /**
   * 버튼을 "처리 중" 상태로. 두 번 눌림 방지 + 스피너.
   * @returns {function} 원래 상태로 되돌리는 함수
   */
  function busy(btn) {
    if (!btn) return function () {};
    btn.classList.add('busy'); btn.disabled = true;
    return function () { btn.classList.remove('busy'); btn.disabled = false; };
  }

  return { el: el, clear: clear, modal: modal, closeModal: closeModal, toast: toast, confirm: confirm, gradeBadge: gradeBadge, progress: progress, busy: busy, signingIn: signingIn, loadingBlock: loadingBlock };
})();
