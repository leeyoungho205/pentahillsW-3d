/**
 * 전 세대 일조 히트맵
 *
 * 1차 9개 동의 모든 세대(36개 라인 × 각 층)를 한 번에 계산해서
 * "어느 동 몇 층 몇 호가 해를 얼마나 받는가"를 격자로 보여준다.
 *
 * ── 빠르게 계산하는 요령 ──
 * 세대 하나마다 하루치 광선을 다 쏘면 수십만 번이라 너무 느리다. 그래서:
 *   1) 태양 위치는 하루치를 미리 한 번만 계산해 재사용한다
 *   2) 창이 등지고 있는 시각은 광선을 쏘기 전에 내적으로 걸러낸다 (절반 이상 제거)
 *   3) 라인(호수) 단위로 묶어서 법선·방향 계산을 공유한다
 * 그래도 수만 번이라 화면이 멈추지 않게 동 하나씩 끊어서 계산한다.
 */

import * as THREE from 'three';
import { getSunPosition, sunDirectionVector, kstDate, OBSERVER } from './sun.js';
import { getUnitAnchor } from './buildings.js';
import { BUILDINGS, TYPE_NAMES } from './siteData.js';

const STEP = 10 / 60;          // 10분 간격 — 세대 하나 분석(5분)보다 거칠지만 전체 비교엔 충분

/** 하루치 태양 방향을 미리 계산해 둔다 */
function daySunDirections(ymd) {
  const out = [];
  for (let h = 4; h <= 20; h += STEP) {
    const { altitude, azimuth } = getSunPosition(kstDate(ymd, h), OBSERVER.lat, OBSERVER.lon);
    if (altitude <= 0.01) continue;              // 해가 뜬 시간만
    const d = sunDirectionVector(altitude, azimuth);
    out.push({ hour: h, dir: new THREE.Vector3(d.x, d.y, d.z) });
  }
  return out;
}

/**
 * 전 세대 계산 (동 하나씩 끊어서 진행)
 * @param {object} towerMap  - 동 id → THREE.Group
 * @param {Array} blockers   - 빛을 가로막는 그룹들
 * @param {string} ymd
 * @param {function} onProgress - (완료동수, 전체동수) 콜백
 * @returns {Promise<object>} 결과
 */
export async function computeAllUnits(towerMap, blockers, ymd, onProgress) {
  const suns = daySunDirections(ymd);
  const ray = new THREE.Raycaster();
  ray.far = 3000;

  const result = { ymd, buildings: {}, stats: null };
  let total = 0, pass4h = 0, pass2run = 0, zero = 0;

  for (let bi = 0; bi < BUILDINGS.length; bi++) {
    const b = BUILDINGS[bi];
    const tower = towerMap[b.id];
    const lines = [];

    for (let ho = 1; ho <= 4; ho++) {
      const topFloor = (b.stepTop && b.stepTop[ho]) || b.floors;
      const floors = [];

      // 이 라인이 해를 받을 수 있는 시각만 미리 추린다 (법선은 층과 무관하게 같다)
      const probe = getUnitAnchor(tower, 2, ho);
      const facing = suns.filter((s) => s.dir.dot(probe.normal) > 0.05);

      for (let f = 2; f <= topFloor; f++) {
        const { position } = getUnitAnchor(tower, f, ho);
        let lit = 0, run = 0, best = 0, core = 0;

        for (const s of facing) {
          ray.set(position, s.dir);
          const blocked = ray.intersectObjects(blockers, true).length > 0;
          if (blocked) { run = 0; continue; }
          lit += STEP;
          run += STEP;
          if (run > best) best = run;
          if (s.hour >= 9 && s.hour <= 15) core += STEP;
        }
        // 걸러낸 시각 사이가 끊기면 연속 시간이 과대평가될 수 있어 보수적으로 자른다
        floors.push({ f, total: lit, run: Math.min(best, lit), core });

        total++;
        if (lit >= 4) pass4h++;
        if (best >= 2) pass2run++;
        if (lit < 0.5) zero++;
      }
      lines.push({ ho, type: b.types[ho - 1], typeName: TYPE_NAMES[b.types[ho - 1]], topFloor, floors });
    }
    result.buildings[b.id] = { id: b.id, floors: b.floors, lines };

    if (onProgress) onProgress(bi + 1, BUILDINGS.length);
    await new Promise((r) => setTimeout(r, 0));   // 화면이 멈추지 않게 한 프레임 양보
  }

  result.stats = { total, pass4h, pass2run, zero };
  return result;
}

// ────────────────────────── 그리기 ──────────────────────────

/** 일조 시간 → 색 */
export function hoursToColor(h) {
  if (h >= 6) return '#2f9e5f';       // 아주 좋음
  if (h >= 4) return '#7cc353';       // 기준 충족
  if (h >= 2) return '#f2c744';       // 아쉬움
  if (h >= 0.5) return '#e8823c';     // 나쁨
  return '#8f3f4e';                   // 거의 안 듦
}

export const HEAT_LEGEND = [
  ['#2f9e5f', '6시간+'], ['#7cc353', '4~6시간'], ['#f2c744', '2~4시간'],
  ['#e8823c', '0.5~2시간'], ['#8f3f4e', '거의 없음'],
];

/**
 * 히트맵을 캔버스에 그린다
 * 가로 = 36개 라인(동별 1~4호), 세로 = 층 (위가 고층)
 * @returns {object} 셀 위치 정보 (클릭 처리에 사용)
 */
export function drawHeatmap(canvas, data, selected) {
  const g = canvas.getContext('2d');
  const ids = Object.keys(data.buildings);
  const maxFloor = Math.max(...ids.map((id) => data.buildings[id].floors));

  const CW = 15, CH = 9;                       // 셀 크기
  const LEFT = 34, TOP = 42, GAP = 10;         // 여백 · 동 사이 간격

  const width = LEFT + ids.length * (4 * CW + GAP) + 10;
  const height = TOP + maxFloor * CH + 16;
  canvas.width = width * devicePixelRatio;
  canvas.height = height * devicePixelRatio;
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  g.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);

  g.clearRect(0, 0, width, height);
  const cells = [];

  ids.forEach((id, bi) => {
    const b = data.buildings[id];
    const x0 = LEFT + bi * (4 * CW + GAP);

    // 동 이름
    g.fillStyle = '#e8edf7';
    g.font = 'bold 11px sans-serif';
    g.textAlign = 'center';
    g.fillText(`${id}동`, x0 + 2 * CW, 14);

    b.lines.forEach((line, li) => {
      const x = x0 + li * CW;
      g.fillStyle = '#95a0b8';
      g.font = '9px sans-serif';
      g.fillText(String(line.ho), x + CW / 2, 30);

      line.floors.forEach((cell) => {
        const y = TOP + (maxFloor - cell.f) * CH;
        g.fillStyle = hoursToColor(cell.total);
        g.fillRect(x + 1, y, CW - 2, CH - 1);
        cells.push({ x: x + 1, y, w: CW - 2, h: CH - 1, id, ho: line.ho, floor: cell.f, cell });

        if (selected && selected.id === id && selected.ho === line.ho && selected.floor === cell.f) {
          g.strokeStyle = '#ffffff'; g.lineWidth = 2;
          g.strokeRect(x, y - 1, CW, CH + 1);
        }
      });
    });
  });

  // 층 눈금 (10층 단위)
  g.fillStyle = '#95a0b8';
  g.font = '9px sans-serif';
  g.textAlign = 'right';
  for (let f = 10; f <= maxFloor; f += 10) {
    const y = TOP + (maxFloor - f) * CH;
    g.fillText(`${f}층`, LEFT - 6, y + 7);
  }

  return { cells, width, height };
}

/** 결과를 CSV로 (분양 상담·엑셀 검토용) */
export function toCSV(data) {
  const rows = [['동', '호', '주택형', '층', '총일조(h)', '연속최대(h)', '09-15시(h)', '기준충족']];
  Object.values(data.buildings).forEach((b) => {
    b.lines.forEach((line) => {
      line.floors.forEach((c) => {
        rows.push([
          b.id, `${line.ho}호`, line.typeName, c.f,
          c.total.toFixed(1), c.run.toFixed(1), c.core.toFixed(1),
          (c.core >= 4 || c.run >= 2) ? 'O' : 'X',
        ]);
      });
    });
  });
  return '﻿' + rows.map((r) => r.join(',')).join('\n');   // BOM: 엑셀 한글 깨짐 방지
}
