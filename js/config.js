/**
 * [config.js] — 배포별로 바뀌는 값만 모아둔다.
 *
 * 무엇을 한다: API 주소, Google 로그인 클라이언트 ID, 타임존처럼 "이 설치"에만 해당하는 값을 정의한다.
 *              그 밖의 정책값(슬롯 분, 표시 시간대, 등급 목록)은 백엔드 `me` 응답으로 받는다.
 * 의존:        없음. 모든 스크립트보다 먼저 로드된다.
 * 호출됨:      api.js, auth.js, time.js 가 RB.config 를 읽는다.
 * 주의:        비밀값을 넣지 않는다. CLIENT_ID 는 공개값이라 괜찮다.
 *              MOCK 이 true 이거나 주소에 ?mock=1 이 있으면 백엔드 대신 mock.js 가 응답한다.
 * 정책 근거:   D-02(구조), D-03(로그인), D-04(호스팅)
 */
window.RB = window.RB || {};

RB.config = {
  // Apps Script 웹앱 배포 URL (소유자 권한 실행). HANDOFF.md 6절 "인프라" 참조.
  API_URL: 'https://script.google.com/macros/s/AKfycbzITvPbXwBH_6ljQlpLrMxp-Hrv2pb9UOLHOrHgOkh_nb01w2fOrjzuJ7iYX-rKVPcYpQ/exec',

  // Google Identity Services 클라이언트 ID(공개값). GCP 의 `Room Booking web` 클라이언트 — HANDOFF.md 6절 참조.
  CLIENT_ID: '704749344755-rmu2v4on2jli8ehu0521a4q5if2u0nqd.apps.googleusercontent.com',

  // 모든 시간 표시·계산은 이 타임존 기준. 보는 사람의 PC 시간대는 무시한다.
  // Asia/Jakarta 는 UTC+7 고정(서머타임 없음)이라 오프셋 상수로 계산해도 안전하다.
  TIMEZONE: 'Asia/Jakarta',
  TZ_OFFSET_MIN: 7 * 60,

  // true 면 항상 mock 모드. 개발·시연용. 배포본은 false.
  MOCK: false,

  // 화면 언어. D-12 확정: 영어만 사용. 다른 언어가 필요해지면 i18n/<lang>.js 를 추가하고 여기 적는다.
  LANGS: ['en'],

  // 현황판 한 슬롯(30분)의 픽셀 너비. 화면 밀도 조정용.
  SLOT_PX: 26
};
