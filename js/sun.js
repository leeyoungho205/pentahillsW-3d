/**
 * 태양 위치 계산기
 *
 * 어떤 날짜·시각에 태양이 하늘의 "어느 높이(고도)"에 "어느 방향(방위)"으로
 * 떠 있는지를 계산한다. NOAA(미국해양대기청)에서 쓰는 표준 천문 계산식을
 * 간단히 옮긴 것으로, 실무에서 쓰기 충분한 정확도(오차 1도 이내)를 가진다.
 *
 * 용어 정리 (처음 보면 어려우니 쉽게 풀면):
 * - 고도(altitude) : 지평선에서 위로 몇 도 올라가 있는가. 0도=지평선, 90도=머리 위
 * - 방위(azimuth)  : 북쪽을 0도로 놓고 시계방향으로 몇 도인가. 90도=동, 180도=남, 270도=서
 */

const DEG = Math.PI / 180;

/** 자바스크립트 Date → 율리우스일(천문학에서 쓰는 통일된 날짜 번호) */
function toJulianDay(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

/**
 * 태양 위치 계산
 * @param {Date}   date - 계산할 시각 (실행 PC의 시간대가 아니라 UTC 기준으로 내부 처리)
 * @param {number} lat  - 위도(도)
 * @param {number} lon  - 경도(도, 동경이 +)
 * @returns {{altitude:number, azimuth:number}} 라디안 단위
 */
export function getSunPosition(date, lat, lon) {
  // J2000(2000년 1월 1일 정오)로부터 며칠이 지났는지
  const d = toJulianDay(date) - 2451545.0;

  const g = DEG * (357.529 + 0.98560028 * d);   // 평균 근점이각
  const q = DEG * (280.459 + 0.98564736 * d);   // 평균 황경
  // 실제 황경 (지구 궤도가 타원이라 생기는 오차를 보정)
  const L = q + DEG * 1.915 * Math.sin(g) + DEG * 0.020 * Math.sin(2 * g);
  const e = DEG * (23.439 - 0.00000036 * d);    // 황도경사각(지구 자전축 기울기)

  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)); // 적경
  const dec = Math.asin(Math.sin(e) * Math.sin(L));              // 적위

  // 그리니치 항성시 → 관측지 항성시 → 시간각
  let gmst = (18.697374558 + 24.06570982441908 * d) % 24;
  if (gmst < 0) gmst += 24;
  const lmst = gmst + lon / 15;
  const H = DEG * (lmst * 15) - ra; // 시간각

  const latR = lat * DEG;
  const altitude = Math.asin(
    Math.sin(latR) * Math.sin(dec) + Math.cos(latR) * Math.cos(dec) * Math.cos(H)
  );
  // 북쪽 0도 기준, 시계방향 방위각
  let azimuth = Math.atan2(
    -Math.sin(H),
    Math.cos(latR) * Math.tan(dec) - Math.sin(latR) * Math.cos(H)
  );
  if (azimuth < 0) azimuth += Math.PI * 2;

  return { altitude, azimuth };
}

/**
 * 고도·방위 → 3D 공간의 태양 방향 벡터
 * 공간 약속: -Z가 북, +X가 동, +Y가 하늘
 * @returns {{x:number,y:number,z:number}} 길이 1인 단위 벡터
 */
export function sunDirectionVector(altitude, azimuth) {
  const cosAlt = Math.cos(altitude);
  return {
    x: Math.sin(azimuth) * cosAlt,   // 동쪽 성분
    y: Math.sin(altitude),           // 높이 성분
    z: -Math.cos(azimuth) * cosAlt,  // 북쪽(-Z) 성분
  };
}

/**
 * 한국 표준시(KST) 기준 날짜·시각으로 Date 만들기
 * @param {string} ymd  - 'YYYY-MM-DD'
 * @param {number} hour - 0~24 (소수 가능, 예: 13.5 = 13시 30분)
 * @param {number} tz   - 시간대 (KST면 9)
 */
export function kstDate(ymd, hour, tz = 9) {
  const [y, m, day] = ymd.split('-').map(Number);
  // UTC 시각 = 현지 시각 - 시간대
  return new Date(Date.UTC(y, m - 1, day, 0, 0, 0) + (hour - tz) * 3600 * 1000);
}

/** 하루 중 해가 떠 있는(고도>0) 시간대의 시작·끝을 찾는다 */
export function findSunriseSunset(ymd, lat, lon, tz = 9) {
  let sunrise = null, sunset = null;
  let prev = -1;
  for (let h = 0; h <= 24; h += 1 / 60) { // 1분 간격으로 훑기
    const { altitude } = getSunPosition(kstDate(ymd, h, tz), lat, lon);
    if (prev < 0 && altitude >= 0 && sunrise === null) sunrise = h;
    if (prev >= 0 && altitude < 0 && sunrise !== null && sunset === null) sunset = h;
    prev = altitude;
  }
  return { sunrise, sunset };
}

/** 소수 시간(13.5) → '13:30' 문자열 */
export function formatHour(h) {
  if (h === null || h === undefined) return '--:--';
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm === 60 ? 0 : mm).padStart(2, '0')}`;
}
