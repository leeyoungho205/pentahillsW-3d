/**
 * 일조(日照) 분석 모듈
 *
 * 원리는 아주 단순하다:
 *   "그 세대 창문에서 태양 쪽으로 광선을 하나 쏴 본다.
 *    가는 길에 다른 동이 걸리면 그 시각엔 해가 안 드는 것이다."
 * 이걸 하루 전체(일출~일몰)에 대해 5분 간격으로 반복해서 합치면 일조시간이 나온다.
 *
 * 한국 아파트 일조권 기준(공동주택 기준)은 보통
 *   - 동지 기준 09:00~15:00 사이에 연속 2시간 이상, 또는 하루 총 4시간 이상
 * 이므로 동짓날로 분석하면 가장 불리한 조건을 볼 수 있다.
 */

import * as THREE from 'three';
import { getSunPosition, sunDirectionVector, kstDate, OBSERVER } from './sun.js';


const raycaster = new THREE.Raycaster();
raycaster.far = 3000;

/**
 * 하루 동안의 일조 여부를 5분 간격으로 계산
 * @param {THREE.Vector3} position  - 창문 위치(월드 좌표)
 * @param {THREE.Vector3} normal    - 창이 바라보는 방향(월드 좌표)
 * @param {THREE.Object3D[]} blockers - 빛을 가로막을 수 있는 물체들
 * @param {string} ymd              - 'YYYY-MM-DD'
 * @returns {{samples:Array, totalHours:number, longestRun:number, coreHours:number}}
 */
export function analyzeDaylight(position, normal, blockers, ymd) {
  const { lat, lon, timezone } = OBSERVER;
  const step = 5 / 60; // 5분
  const samples = [];

  let lit = 0, longestRun = 0, run = 0, coreLit = 0;

  for (let h = 4; h <= 20; h += step) {
    const { altitude, azimuth } = getSunPosition(kstDate(ymd, h, timezone), lat, lon);

    let state = 'night';
    if (altitude > 0.01) {
      const d = sunDirectionVector(altitude, azimuth);
      const dir = new THREE.Vector3(d.x, d.y, d.z);

      // 창이 등지고 있는 방향이면 애초에 직사광이 안 들어온다
      if (dir.dot(normal) <= 0.05) {
        state = 'behind';
      } else {
        raycaster.set(position, dir);
        const hits = raycaster.intersectObjects(blockers, true);
        state = hits.length > 0 ? 'blocked' : 'sun';
      }
    }

    samples.push({ hour: h, state, altitude });

    if (state === 'sun') {
      lit += step;
      run += step;
      if (run > longestRun) longestRun = run;
      if (h >= 9 && h <= 15) coreLit += step; // 일조권 판단 핵심 시간대
    } else {
      run = 0;
    }
  }

  return {
    samples,
    totalHours: lit,
    longestRun,
    coreHours: coreLit,
  };
}

/**
 * 하루 동안 태양이 지나가는 궤적을 선으로 그린다 (교육/직관용)
 * @param {string} ymd
 * @param {number} radius - 궤적 반지름(m)
 */
export function createSunPath(ymd, radius = 500) {
  const { lat, lon, timezone } = OBSERVER;
  const points = [];

  for (let h = 0; h <= 24; h += 0.1) {
    const { altitude, azimuth } = getSunPosition(kstDate(ymd, h, timezone), lat, lon);
    if (altitude < 0) continue; // 지평선 아래는 그리지 않음
    const d = sunDirectionVector(altitude, azimuth);
    points.push(new THREE.Vector3(d.x * radius, d.y * radius, d.z * radius));
  }

  const geo = new THREE.BufferGeometry().setFromPoints(points);
  const mat = new THREE.LineBasicMaterial({ color: 0xffc94d, transparent: true, opacity: 0.9 });
  const line = new THREE.Line(geo, mat);
  line.name = 'sunPath';
  return line;
}

/** 하늘의 태양을 표시할 노란 구슬 */
export function createSunMarker() {
  const sun = new THREE.Mesh(
    new THREE.SphereGeometry(14, 24, 24),
    new THREE.MeshBasicMaterial({ color: 0xffd75e })
  );
  sun.name = 'sunMarker';

  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(26, 24, 24),
    new THREE.MeshBasicMaterial({ color: 0xffd75e, transparent: true, opacity: 0.22 })
  );
  sun.add(glow);
  return sun;
}

/** 일조 분석 결과를 가로 막대 그래프(캔버스)로 그린다 */
export function drawDaylightChart(canvas, result) {
  const g = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  g.clearRect(0, 0, W, H);

  const startH = 4, endH = 20;
  const colors = {
    sun: '#ffc83d',      // 직사광 들어옴
    blocked: '#8e6ad6',  // 다른 동에 가림
    behind: '#3d4a63',   // 창 반대편
    night: '#161b28',    // 해가 없음
  };

  const barTop = 8, barH = 34;
  result.samples.forEach((s) => {
    const x = ((s.hour - startH) / (endH - startH)) * W;
    const w = (5 / 60 / (endH - startH)) * W + 1;
    g.fillStyle = colors[s.state];
    g.fillRect(x, barTop, w, barH);
  });

  // 시간 눈금
  g.fillStyle = '#95a0b8';
  g.font = '11px sans-serif';
  g.textAlign = 'center';
  for (let h = 6; h <= 19; h += 2) {
    const x = ((h - startH) / (endH - startH)) * W;
    g.fillRect(x, barTop + barH, 1, 5);
    g.fillText(`${h}`, x, barTop + barH + 18);
  }

  // 09~15시(일조권 판단 구간) 표시
  const x9 = ((9 - startH) / (endH - startH)) * W;
  const x15 = ((15 - startH) / (endH - startH)) * W;
  g.strokeStyle = 'rgba(255,255,255,0.55)';
  g.setLineDash([4, 3]);
  g.lineWidth = 1;
  g.strokeRect(x9, barTop - 3, x15 - x9, barH + 6);
  g.setLineDash([]);
}
