/**
 * 메인 엔트리 — 씬 구성 → 단지 생성 → UI 연결 → 렌더 루프
 *
 * [구조]
 *   scene
 *    ├ siteGroup                ← 단지 전체. 정북 보정(기본 24°)으로 이 그룹만 돌린다
 *    │   ├ planGround           공식 배치도(db.jpg)를 깐 바닥
 *    │   ├ lake                 중산호수
 *    │   ├ towersGroup          1차 101~109동   ← 그림자·일조 계산 대상
 *    │   ├ phase2Group          2차 9개 동      ← 그림자·일조 계산 대상
 *    │   └ labelsGroup          동 번호
 *    ├ sunLight / sunMarker / sunPath   태양은 실제 방위 기준이라 회전하지 않는다
 *    └ compass                  N/E/S/W
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import {
  BUILDINGS, PHASE2, PHASE2_DEFAULTS, SITE_LOCATION, FLOOR_HEIGHT,
  NORTH_OFFSET_DEG, TYPE_NAMES, px2m,
} from './siteData.js';
import { getSunPosition, sunDirectionVector, kstDate, findSunriseSunset, formatHour, OBSERVER } from './sun.js';
import { computeAllUnits, drawHeatmap, toCSV, HEAT_LEGEND } from './heatmap.js';
import {
  createTower, getUnitAnchor, createWindowFrame, placeWindowFrame,
  setTypeColorMode, selectWing,
} from './buildings.js';
import { UNIT_PLACEMENT, TYPE_COLORS } from './unitData.js';
import {
  createTerrain, createPlanOverlay, createOuterGround, createLake, animateLake,
  createTrees, createLowBlocks, createHills, createCompass, createBuildingLabel,
} from './site.js';
import { analyzeDaylight, createSunPath, createSunMarker, drawDaylightChart } from './analysis.js';

// ────────────────────────────────────────────────────────────
// 1. 기본 씬
// ────────────────────────────────────────────────────────────
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fb6dd);
scene.fog = new THREE.Fog(0x8fb6dd, 2200, 6500);   // 단지는 또렷하게, 먼 산만 흐리게

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 1, 6000);
camera.position.set(-430, 430, 630);   // 단지 전체가 한눈에 들어오는 남서쪽 상공

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI / 2 - 0.02;
controls.target.set(-30, 50, 20);

// ────────────────────────────────────────────────────────────
// 2. 조명 (태양 = 그림자를 만드는 평행광)
// ────────────────────────────────────────────────────────────
const sunLight = new THREE.DirectionalLight(0xfff2d8, 2.2);   // 세기는 updateSun()에서 매번 다시 정한다
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(4096, 4096);
const S = 620;   // 단지 전체(약 1.2km)를 덮는 그림자 범위
Object.assign(sunLight.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 1, far: 3200 });
sunLight.shadow.camera.updateProjectionMatrix();   // 값을 바꿨으면 반드시 갱신해야 그림자가 나온다
sunLight.shadow.bias = -0.0006;
scene.add(sunLight, sunLight.target);

// three.js 최신 버전은 물리 기반 조도를 쓰기 때문에 확산 반사에서 1/π 이 곱해진다.
// 그래서 눈에 보이는 밝기를 맞추려면 광원 세기에 π를 곱해줘야 한다.
const LIGHT_SCALE = Math.PI;

// 그림자가 또렷하게 보이려면 "직사광"이 세고 "확산광"이 약해야 한다.
// 확산광을 너무 키우면 그림자 진 곳까지 밝아져서 일조 차이가 안 보인다.
const hemi = new THREE.HemisphereLight(0xcfe2f5, 0x8a9270, 0.55 * LIGHT_SCALE);
const ambient = new THREE.AmbientLight(0xffffff, 0.16 * LIGHT_SCALE);
scene.add(hemi, ambient);

const sunMarker = createSunMarker();
scene.add(sunMarker, createCompass());
let sunPathLine = null;

// ────────────────────────────────────────────────────────────
// 3. 단지 생성
// ────────────────────────────────────────────────────────────
const siteGroup = new THREE.Group();
siteGroup.rotation.y = THREE.MathUtils.degToRad(NORTH_OFFSET_DEG);  // 나침반 실측 보정
scene.add(siteGroup);

const outerGround = createOuterGround();
const terrain = createTerrain(() => document.getElementById('loading').classList.add('done'));
const planOverlay = createPlanOverlay();
const lake = createLake();
const trees = createTrees();
const lowBlocks = createLowBlocks();
const towersGroup = new THREE.Group();
const phase2Group = new THREE.Group();
const labelsGroup = new THREE.Group();
siteGroup.add(outerGround, terrain, planOverlay, lake, trees, lowBlocks,
              towersGroup, phase2Group, labelsGroup);
scene.add(createHills());   // 원경은 단지와 같이 돌 필요가 없다

const towerMap = {};
BUILDINGS.forEach((b) => {
  const p = px2m(b.px[0], b.px[1]);
  const tower = createTower({ ...b, x: p.x, z: p.z });
  towersGroup.add(tower);
  towerMap[b.id] = tower;

  const label = createBuildingLabel(`${b.id}동 · ${b.floors}F`, tower.userData.height);
  label.position.x = p.x; label.position.z = p.z;
  labelsGroup.add(label);
});

// 2차 동 — 층수를 바꿔가며 볼 수 있도록 통째로 다시 만든다
const phase2Labels = new THREE.Group();
labelsGroup.add(phase2Labels);
function buildPhase2(floors) {
  phase2Group.clear();
  phase2Labels.clear();
  PHASE2.forEach((b) => {
    const p = px2m(b.px[0], b.px[1]);
    const t = createTower({ ...PHASE2_DEFAULTS, ...b, floors, x: p.x, z: p.z });
    // 2차는 주택형이 공개되지 않은 추정값이라, 평형 색을 입히지 않고 중립색으로 둔다
    setTypeColorMode(t, false);
    phase2Group.add(t);
    const label = createBuildingLabel(`${b.id} · ${floors}F`, t.userData.height, true);
    label.position.x = p.x; label.position.z = p.z;
    phase2Labels.add(label);
  });
}
buildPhase2(PHASE2_DEFAULTS.floors);

// 일조 분석 때 "빛을 가로막는 것" (나무는 계절에 따라 변하므로 제외)
const blockers = [towersGroup, phase2Group, lowBlocks];

setTimeout(() => document.getElementById('loading').classList.add('done'), 6000);

// ────────────────────────────────────────────────────────────
// 4. 상태값
// ────────────────────────────────────────────────────────────
const state = {
  date: '2026-12-22', hour: 12, playing: false, viewMode: false, savedCam: null,
  picked: false,   // 사용자가 세대를 고르기 전에는 동에 색을 입히지 않는다
};

// ────────────────────────────────────────────────────────────
// 5. 태양
// ────────────────────────────────────────────────────────────
function updateSun() {
  const { lat, lon, timezone } = OBSERVER;
  const { altitude, azimuth } = getSunPosition(kstDate(state.date, state.hour, timezone), lat, lon);
  const d = sunDirectionVector(altitude, azimuth);

  sunLight.position.set(d.x * 1100, d.y * 1100, d.z * 1100);
  sunLight.target.position.set(0, 0, 0);
  sunLight.target.updateMatrixWorld();
  sunMarker.position.set(d.x * 600, d.y * 600, d.z * 600);

  const day = altitude > 0;
  const s = Math.sin(Math.max(altitude, 0));
  sunMarker.visible = day;
  sunLight.intensity = (day ? 1.5 + s * 1.6 : 0) * LIGHT_SCALE;      // 직사광 (그림자를 만든다)
  hemi.intensity = (day ? 0.35 + s * 0.35 : 0.16) * LIGHT_SCALE;     // 하늘 확산광
  ambient.intensity = (day ? 0.16 : 0.10) * LIGHT_SCALE;

  const t = THREE.MathUtils.clamp(altitude / 0.5, 0, 1);
  const sky = day
    ? new THREE.Color(0xe89a5a).lerp(new THREE.Color(0x8fb6dd), t)
    : new THREE.Color(0x121a2c);
  scene.background = sky;
  scene.fog.color = sky;

  $('sunAlt').textContent = `${(altitude * 180 / Math.PI).toFixed(1)}°`;
  $('sunAz').textContent = `${(azimuth * 180 / Math.PI).toFixed(0)}°`;
}

function updateSunPath() {
  if (sunPathLine) { scene.remove(sunPathLine); sunPathLine.geometry.dispose(); }
  sunPathLine = createSunPath(state.date, 600);
  sunPathLine.visible = $('chkPath').checked;
  scene.add(sunPathLine);

  const { sunrise, sunset, polar } = findSunriseSunset(state.date);
  if (polar) {
    // 고위도에서는 해가 하루 종일 떠 있거나(백야) 아예 뜨지 않는다(극야)
    const label = polar === 'day' ? '백야 ☀' : '극야 ☾';
    $('sunrise').textContent = label;
    $('sunset').textContent = label;
  } else {
    $('sunrise').textContent = formatHour(sunrise);
    $('sunset').textContent = formatHour(sunset);
  }
}

// ────────────────────────────────────────────────────────────
// 6. UI
// ────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

BUILDINGS.forEach((b) => {
  const o = document.createElement('option');
  o.value = b.id;
  o.textContent = `${b.id}동 (${b.floors}층)`;
  $('bldSelect').appendChild(o);
});
$('bldSelect').value = '104';

/** 선택한 동에 맞춰 층 범위와 호수별 주택형 표시를 갱신 */
function syncBuilding() {
  const b = BUILDINGS.find((x) => x.id === $('bldSelect').value);
  $('floorSlider').max = b.floors;
  if (+$('floorSlider').value > b.floors) $('floorSlider').value = b.floors;
  $('floorLabel').textContent = `${$('floorSlider').value}층`;

  const place = UNIT_PLACEMENT[b.id] || [];
  $('hoSelect').innerHTML = '';
  b.types.forEach((t, i) => {
    const o = document.createElement('option');
    o.value = String(i + 1);
    // 호수마다 전면 폭이 달라서 조망 시야도 달라진다 — 목록에서 바로 보이게 한다
    const w = place[i] ? ` · 전면 ${place[i].wid.toFixed(1)}m` : '';
    o.textContent = `${i + 1}호 · ${TYPE_NAMES[t] || t}${w}`;
    $('hoSelect').appendChild(o);
  });
  updateHoSwatch();
}

/**
 * 선택한 호수의 평형 색 칩 + 3D 날개 색칠을 갱신
 *
 * 기본 상태에서는 동에 색이 전혀 없고, 세대를 고른 순간
 * 그 날개 하나만 평형 색으로 칠해져서 어디인지 바로 보인다.
 */
function updateHoSwatch() {
  const b = BUILDINGS.find((x) => x.id === $('bldSelect').value);
  const ho = +$('hoSelect').value;
  const t = b.types[ho - 1];
  $('hoSwatch').style.background = TYPE_COLORS[t] || '#888';
  $('hoSwatch').title = TYPE_NAMES[t] || t;

  const colorAll = $('chkType').checked;
  Object.entries(towerMap).forEach(([id, tw]) => {
    // 아직 아무 세대도 고르지 않았으면 전부 기본색으로 둔다
    const pick = state.picked && id === b.id ? ho : null;
    selectWing(tw, pick, colorAll);
  });

  document.querySelectorAll('#typeLegend .legend-item').forEach((el) => {
    el.classList.toggle('on', state.picked && el.dataset.type === t);
  });
}

/** 사용자가 세대를 실제로 고른 시점부터 색 표시를 시작한다 */
function markPicked() {
  state.picked = true;
  updateHoSwatch();
}

/**
 * 평형 색상표 — 배치도 범례와 같은 색.
 * 항목을 누르면 그 평형이 있는 동·호수로 바로 이동한다.
 */
function buildTypeLegend() {
  // 평형별로 "어느 동 몇 호에 있는지" 목록을 만든다
  const where = {};
  BUILDINGS.forEach((b) => b.types.forEach((t, i) => {
    (where[t] = where[t] || []).push({ id: b.id, ho: i + 1 });
  }));

  const order = ['84A', '84B', '115A', '115B', '123A', '123B', '132A', '132B', '137B', '137C', '152A', '152B'];
  $('typeLegend').innerHTML = order.filter((t) => where[t]).map((t) => {
    const dongs = [...new Set(where[t].map((w) => w.id))].join('·');
    return `<button class="legend-item" data-type="${t}" title="${dongs}동">
      <i style="background:${TYPE_COLORS[t]}"></i>
      <span class="lt">${TYPE_NAMES[t]}</span>
      <span class="ld">${dongs}</span>
    </button>`;
  }).join('');

  $('typeLegend').addEventListener('click', (e) => {
    const btn = e.target.closest('.legend-item');
    if (!btn) return;
    const first = where[btn.dataset.type][0];      // 그 평형이 있는 첫 동·호수로 이동
    $('bldSelect').value = first.id;
    syncBuilding();
    $('hoSelect').value = String(first.ho);
    markPicked();
    if (state.viewMode) enterViewMode();
  });
}
$('bldSelect').addEventListener('change', () => { syncBuilding(); markPicked(); if (state.viewMode) enterViewMode(); });
$('hoSelect').addEventListener('change', () => { markPicked(); if (state.viewMode) enterViewMode(); });
$('floorSlider').addEventListener('input', () => {
  $('floorLabel').textContent = `${$('floorSlider').value}층`;
  if (state.viewMode) enterViewMode();
});
buildTypeLegend();
syncBuilding();

// 날짜 · 시각
$('dateInput').value = state.date;
$('dateInput').addEventListener('change', (e) => {
  state.date = e.target.value;
  document.querySelectorAll('.preset[data-date]').forEach((p) => p.classList.toggle('on', p.dataset.date === state.date));
  updateSunPath(); updateSun();
});
document.querySelectorAll('.preset[data-date]').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.date = btn.dataset.date;
    $('dateInput').value = state.date;
    document.querySelectorAll('.preset[data-date]').forEach((p) => p.classList.remove('on'));
    btn.classList.add('on');
    updateSunPath(); updateSun();
  });
});
$('timeSlider').addEventListener('input', (e) => {
  state.hour = +e.target.value;
  $('timeLabel').textContent = formatHour(state.hour);
  updateSun();
});
$('playBtn').addEventListener('click', () => {
  state.playing = !state.playing;
  $('playBtn').textContent = state.playing ? '⏸ 정지' : '▶ 하루 시간 흐름 재생';
});

// 정북 보정
$('northSlider').value = NORTH_OFFSET_DEG;
$('northLabel').textContent = `${NORTH_OFFSET_DEG}°`;
$('northSlider').addEventListener('input', (e) => {
  siteGroup.rotation.y = THREE.MathUtils.degToRad(+e.target.value);
  $('northLabel').textContent = `${e.target.value}°`;
  if (state.viewMode) enterViewMode();
});

// 2차 층수
$('p2Slider').addEventListener('input', (e) => {
  $('p2Label').textContent = `${e.target.value}층`;
  buildPhase2(+e.target.value);
  phase2Group.visible = $('chkP2').checked;
});

// 표시 설정
$('chkPlan').addEventListener('change', (e) => { planOverlay.visible = e.target.checked; });
$('chkTree').addEventListener('change', (e) => { trees.visible = e.target.checked; });
$('chkPath').addEventListener('change', (e) => { if (sunPathLine) sunPathLine.visible = e.target.checked; });
$('chkLabel').addEventListener('change', (e) => { labelsGroup.visible = e.target.checked; });
$('chkType').addEventListener('change', updateHoSwatch);
$('chkP2').addEventListener('change', (e) => { phase2Group.visible = e.target.checked; });

$('panelToggle').addEventListener('click', () => {
  const p = $('panel');
  p.classList.toggle('collapsed');
  $('panelToggle').textContent = p.classList.contains('collapsed') ? '▶' : '◀';
});

// ────────────────────────────────────────────────────────────
// 7. 조망 보기
// ────────────────────────────────────────────────────────────
function currentAnchor() {
  scene.updateMatrixWorld(true);          // 회전값이 반영된 최신 좌표로 계산
  const id = $('bldSelect').value;
  const floor = +$('floorSlider').value;
  const ho = +$('hoSelect').value;
  return { ...getUnitAnchor(towerMap[id], floor, ho), id, floor, ho };
}

// 정면 개방감: 창 정면으로 광선을 쏴서 앞을 가로막는 건물까지의 거리
const frontRay = new THREE.Raycaster(); frontRay.far = 2500;
function measureOpenness(position, normal) {
  frontRay.set(position, normal);
  const hits = frontRay.intersectObjects(blockers, true);
  return hits.length ? hits[0].distance : null;
}

// 세대 안에서 내다보는 느낌을 주는 창틀·발코니 (조망 모드에서만 보인다)
let windowFrame = null;

function enterViewMode() {
  const a = currentAnchor();
  if (!state.viewMode) {
    state.savedCam = { pos: camera.position.clone(), target: controls.target.clone() };
    state.viewMode = true;
    labelsGroup.visible = false;
    scene.getObjectByName('compass').visible = false;
    controls.maxPolarAngle = Math.PI;      // 세대에서는 하늘까지 올려다볼 수 있게
  }

  // 창틀은 세대 전면 폭에 맞춰 만든다 → 큰 평형일수록 시야가 넓게 트인다
  const tower = towerMap[a.id];
  if (windowFrame && windowFrame.parent) windowFrame.parent.remove(windowFrame);
  windowFrame = createWindowFrame(a.wid);
  tower.add(windowFrame);
  placeWindowFrame(windowFrame, tower, a.floor, a.ho);

  // 카메라는 창 바깥이 아니라 거실 안쪽 눈높이에 둔다
  camera.position.copy(a.eye);
  controls.target.copy(a.eye.clone().add(a.normal.clone().multiplyScalar(60)));
  camera.fov = 66;
  camera.updateProjectionMatrix();

  const b = BUILDINGS.find((x) => x.id === a.id);
  const type = b.types[a.ho - 1];
  const dist = measureOpenness(a.position, a.normal);
  const openText = dist === null ? '<b>정면 막힘 없음</b>' : `정면 <b>${dist.toFixed(0)}m</b> 앞 건물`;

  $('viewBadge').innerHTML =
    `<i class="swatch" style="background:${TYPE_COLORS[type] || '#888'}"></i>` +
    `<b>${a.id}동 ${a.floor}층 ${a.ho}호</b> ${TYPE_NAMES[type] || ''} · ` +
    `지상 ${a.floorY.toFixed(0)}m · 전면폭 ${a.wid.toFixed(1)}m · ${openText}`;
  $('viewBadge').classList.remove('hidden');
  $('backBtn').classList.remove('hidden');
}

function exitViewMode() {
  state.viewMode = false;
  if (windowFrame && windowFrame.parent) { windowFrame.parent.remove(windowFrame); windowFrame = null; }
  camera.position.copy(state.savedCam.pos);
  controls.target.copy(state.savedCam.target);
  camera.fov = 50;
  camera.updateProjectionMatrix();
  labelsGroup.visible = $('chkLabel').checked;
  scene.getObjectByName('compass').visible = true;
  controls.maxPolarAngle = Math.PI / 2 - 0.02;
  $('viewBadge').classList.add('hidden');
  $('backBtn').classList.add('hidden');
}

$('viewBtn').addEventListener('click', () => { markPicked(); enterViewMode(); });
$('backBtn').addEventListener('click', exitViewMode);

// ────────────────────────────────────────────────────────────
// 8. 일조 분석
// ────────────────────────────────────────────────────────────
$('analyzeBtn').addEventListener('click', () => {
  markPicked();
  const a = currentAnchor();
  const r = analyzeDaylight(a.position, a.normal, blockers, state.date);
  const box = $('resultBox');
  box.classList.remove('hidden');

  const ok = r.coreHours >= 4 || r.longestRun >= 2;
  $('resultNums').innerHTML = `
    <div class="stat ${r.totalHours >= 4 ? 'good' : 'bad'}"><i>총 일조</i><b>${r.totalHours.toFixed(1)}h</b></div>
    <div class="stat"><i>연속 최대</i><b>${r.longestRun.toFixed(1)}h</b></div>
    <div class="stat"><i>09~15시</i><b>${r.coreHours.toFixed(1)}h</b></div>`;
  drawDaylightChart($('chart'), r);

  const old = box.querySelector('.verdict');
  if (old) old.remove();
  const v = document.createElement('div');
  v.className = `verdict ${ok ? 'ok' : 'ng'}`;
  v.innerHTML = ok
    ? `✅ ${a.id}동 ${a.floor}층 ${a.ho}호 — 일반적인 일조 기준(09~15시 4시간 또는 연속 2시간)을 만족합니다.`
    : `⚠️ ${a.id}동 ${a.floor}층 ${a.ho}호 — 이 날짜엔 일조가 부족합니다. 층을 올리거나 다른 호수와 비교해 보세요.`;
  box.appendChild(v);
});

// 같은 동에서 1~4호를 한 번에 비교
$('compareBtn').addEventListener('click', () => {
  markPicked();
  const id = $('bldSelect').value;
  const floor = +$('floorSlider').value;
  const b = BUILDINGS.find((x) => x.id === id);
  scene.updateMatrixWorld(true);

  const rows = [1, 2, 3, 4].map((ho) => {
    const { position, normal, wid } = getUnitAnchor(towerMap[id], floor, ho);
    const r = analyzeDaylight(position, normal, blockers, state.date);
    const open = measureOpenness(position, normal);
    const t = b.types[ho - 1];
    return { ho, t, type: TYPE_NAMES[t] || '', wid, r, open };
  });
  const best = Math.max(...rows.map((x) => x.r.totalHours));

  $('compareBox').classList.remove('hidden');
  $('compareTitle').textContent = `${id}동 ${floor}층 · ${state.date}`;
  $('compareTable').innerHTML =
    `<tr><th>호</th><th>주택형</th><th>전면</th><th>총 일조</th><th>09~15시</th><th>정면 개방</th></tr>` +
    rows.map((x) => `<tr class="${x.r.totalHours === best ? 'best' : ''}">
      <td><i class="swatch" style="background:${TYPE_COLORS[x.t] || '#888'}"></i>${x.ho}호</td>
      <td>${x.type}</td><td>${x.wid.toFixed(1)}m</td>
      <td>${x.r.totalHours.toFixed(1)}h</td><td>${x.r.coreHours.toFixed(1)}h</td>
      <td>${x.open === null ? '개방' : `${x.open.toFixed(0)}m`}</td></tr>`).join('');
});

// ────────────────────────────────────────────────────────────
// 9. 전 세대 일조 히트맵
// ────────────────────────────────────────────────────────────
let heatData = null;

$('heatBtn').addEventListener('click', async () => {
  const btn = $('heatBtn');
  btn.disabled = true;
  $('heatBox').classList.remove('hidden');

  heatData = await computeAllUnits(towerMap, blockers, state.date, (done, all) => {
    $('heatProgress').textContent = `계산 중… ${done}/${all}개 동`;
  });

  const s = heatData.stats;
  const pct = (n) => `${((n / s.total) * 100).toFixed(0)}%`;
  $('heatProgress').innerHTML =
    `<b>${state.date}</b> 기준 · 총 <b>${s.total.toLocaleString()}세대</b><br>` +
    `일조 4시간 이상 <b>${s.pass4h.toLocaleString()}</b>세대 (${pct(s.pass4h)}) · ` +
    `연속 2시간 이상 <b>${s.pass2run.toLocaleString()}</b>세대 (${pct(s.pass2run)}) · ` +
    `거의 안 드는 세대 <b>${s.zero.toLocaleString()}</b> (${pct(s.zero)})`;

  $('heatLegend').innerHTML = HEAT_LEGEND
    .map(([c, t]) => `<span><i style="background:${c}"></i>${t}</span>`).join('');
  redrawHeatmap();
  btn.disabled = false;
});

function redrawHeatmap() {
  if (!heatData) return;
  const sel = { id: $('bldSelect').value, ho: +$('hoSelect').value, floor: +$('floorSlider').value };
  heatCells = drawHeatmap($('heatCanvas'), heatData, state.picked ? sel : null).cells;
}
let heatCells = [];

// 히트맵 칸을 누르면 그 세대로 이동한다
$('heatCanvas').addEventListener('click', (e) => {
  const r = $('heatCanvas').getBoundingClientRect();
  const mx = e.clientX - r.left, my = e.clientY - r.top;
  const hit = heatCells.find((c) => mx >= c.x && mx <= c.x + c.w && my >= c.y && my <= c.y + c.h);
  if (!hit) return;
  selectUnit(hit.id, hit.ho, hit.floor);
});

$('heatClose').addEventListener('click', () => $('heatBox').classList.add('hidden'));

$('csvBtn').addEventListener('click', () => {
  if (!heatData) return;
  const blob = new Blob([toCSV(heatData)], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `펜타힐즈_일조분석_${state.date}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
});

/** 동·호·층을 한 번에 선택 (히트맵·3D 클릭·URL 이 공통으로 쓴다) */
function selectUnit(id, ho, floor) {
  $('bldSelect').value = id;
  syncBuilding();
  $('hoSelect').value = String(ho);
  $('floorSlider').value = String(floor);
  $('floorLabel').textContent = `${floor}층`;
  markPicked();
  redrawHeatmap();
  writeUrl();
  if (state.viewMode) enterViewMode();
}

// ────────────────────────────────────────────────────────────
// 10. 3D 화면에서 동을 직접 클릭해 선택
// ────────────────────────────────────────────────────────────
const pickRay = new THREE.Raycaster();
let downAt = null;

canvas.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('pointerup', (e) => {
  if (!downAt) return;
  // 화면을 돌리려고 드래그한 경우는 선택으로 치지 않는다
  const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
  downAt = null;
  if (moved > 5 || state.viewMode) return;

  const r = canvas.getBoundingClientRect();
  pickRay.setFromCamera(new THREE.Vector2(
    ((e.clientX - r.left) / r.width) * 2 - 1,
    -((e.clientY - r.top) / r.height) * 2 + 1,
  ), camera);

  const hit = pickRay.intersectObjects([towersGroup], true)[0];
  if (!hit) return;

  // 맞은 메시가 어느 동의 몇 호 날개인지 거슬러 올라간다
  let obj = hit.object;
  while (obj && obj.userData.ho === undefined) obj = obj.parent;
  if (!obj) return;
  const tower = obj.parent;
  if (!tower || !tower.userData.id) return;

  // 클릭한 높이를 층으로 환산
  const b = BUILDINGS.find((x) => x.id === tower.userData.id);
  const topFloor = (b.stepTop && b.stepTop[obj.userData.ho]) || b.floors;
  const floor = Math.min(topFloor, Math.max(2, Math.round(hit.point.y / FLOOR_HEIGHT) + 1));
  selectUnit(tower.userData.id, obj.userData.ho, floor);
});

// ────────────────────────────────────────────────────────────
// 11. 🎓 학습 모드 — 위도와 자전축 기울기를 바꿔본다
// ────────────────────────────────────────────────────────────
const REAL_LAT = SITE_LOCATION.lat;

function updateLearnInfo() {
  const lat = OBSERVER.lat, tilt = OBSERVER.obliquity;
  $('latLabel').textContent = `${lat.toFixed(1)}°`;
  $('tiltLabel').textContent = `${tilt.toFixed(1)}°`;

  // 하지·동지 정오의 태양 고도 (남중고도 = 90 − |위도 − 적위|)
  const noon = (dec) => 90 - Math.abs(lat - dec);
  const summer = noon(tilt), winter = noon(-tilt);

  let msg;
  if (tilt < 1) {
    msg = '자전축이 <b>거의 서 있어서 계절이 사라졌습니다.</b> 하지와 동지의 태양 높이가 같아집니다.';
  } else if (Math.abs(lat) >= 90 - tilt) {
    msg = '극권 안쪽입니다. <b>백야와 극야</b>가 나타납니다.';
  } else if (tilt > 35) {
    msg = '기울기가 커서 <b>계절 차이가 극단적</b>입니다. 여름과 겨울의 태양 높이 차가 벌어집니다.';
  } else {
    msg = '기울어진 자전축 때문에 <b>여름엔 해가 높고 겨울엔 낮아집니다.</b> 이것이 계절의 원인입니다.';
  }

  $('learnInfo').innerHTML =
    `하지 정오 <b>${summer.toFixed(1)}°</b> · 동지 정오 <b>${winter.toFixed(1)}°</b> ` +
    `<span class="gap">(차이 ${(summer - winter).toFixed(1)}°)</span><br>${msg}`;

  // 실제 조건이 아니면 분석 수치를 실제로 오해하지 않도록 표시해 둔다
  const off = Math.abs(lat - REAL_LAT) > 0.05 || Math.abs(tilt - OBSERVER.REAL_OBLIQUITY) > 0.05;
  $('learnBadge').classList.toggle('hidden', !off);
}

function applyLearn() {
  updateLearnInfo();
  updateSunPath();
  updateSun();
  heatData = null;                       // 조건이 바뀌었으니 히트맵은 다시 계산해야 한다
  $('heatBox').classList.add('hidden');
}

$('latSlider').addEventListener('input', (e) => { OBSERVER.lat = +e.target.value; applyLearn(); });
$('tiltSlider').addEventListener('input', (e) => { OBSERVER.obliquity = +e.target.value; applyLearn(); });
document.querySelectorAll('.lat-preset').forEach((btn) => {
  btn.addEventListener('click', () => {
    OBSERVER.lat = +btn.dataset.lat;
    $('latSlider').value = OBSERVER.lat;
    applyLearn();
  });
});
$('learnReset').addEventListener('click', () => {
  OBSERVER.lat = REAL_LAT;
  OBSERVER.obliquity = OBSERVER.REAL_OBLIQUITY;
  $('latSlider').value = REAL_LAT;
  $('tiltSlider').value = OBSERVER.REAL_OBLIQUITY;
  applyLearn();
});

// ────────────────────────────────────────────────────────────
// 12. 주소(URL)로 상태 공유
// ────────────────────────────────────────────────────────────
function writeUrl() {
  const p = new URLSearchParams({
    b: $('bldSelect').value, h: $('hoSelect').value, f: $('floorSlider').value,
    d: state.date, t: state.hour.toFixed(2), n: $('northSlider').value, p2: $('p2Slider').value,
  });
  if (state.viewMode) p.set('v', '1');
  if (Math.abs(OBSERVER.lat - REAL_LAT) > 0.05) p.set('lat', OBSERVER.lat.toFixed(1));
  if (Math.abs(OBSERVER.obliquity - OBSERVER.REAL_OBLIQUITY) > 0.05) p.set('tilt', OBSERVER.obliquity.toFixed(1));
  history.replaceState(null, '', '#' + p.toString());
}

function readUrl() {
  if (!location.hash || location.hash.length < 2) return false;
  const p = new URLSearchParams(location.hash.slice(1));
  const set = (id, key) => { if (p.has(key)) $(id).value = p.get(key); };

  if (p.has('lat')) { OBSERVER.lat = +p.get('lat'); $('latSlider').value = OBSERVER.lat; }
  if (p.has('tilt')) { OBSERVER.obliquity = +p.get('tilt'); $('tiltSlider').value = OBSERVER.obliquity; }
  if (p.has('d')) { state.date = p.get('d'); $('dateInput').value = state.date; }
  if (p.has('t')) {
    state.hour = +p.get('t');
    $('timeSlider').value = state.hour;
    $('timeLabel').textContent = formatHour(state.hour);
  }
  set('northSlider', 'n'); set('p2Slider', 'p2');

  siteGroup.rotation.y = THREE.MathUtils.degToRad(+$('northSlider').value);
  $('northLabel').textContent = `${$('northSlider').value}°`;
  if (p.has('p2')) { $('p2Label').textContent = `${$('p2Slider').value}층`; buildPhase2(+$('p2Slider').value); }

  document.querySelectorAll('.preset[data-date]').forEach((el) => el.classList.toggle('on', el.dataset.date === state.date));

  if (p.has('b')) {
    $('bldSelect').value = p.get('b');
    syncBuilding();
    if (p.has('h')) $('hoSelect').value = p.get('h');
    if (p.has('f')) { $('floorSlider').value = p.get('f'); $('floorLabel').textContent = `${p.get('f')}층`; }
    markPicked();
  }
  updateLearnInfo();
  if (p.get('v') === '1') setTimeout(enterViewMode, 0);
  return true;
}

$('shareBtn').addEventListener('click', async () => {
  writeUrl();
  try {
    await navigator.clipboard.writeText(location.href);
    $('shareBtn').textContent = '✅ 주소를 복사했습니다';
  } catch {
    $('shareBtn').textContent = '주소창의 링크를 복사하세요';
  }
  setTimeout(() => { $('shareBtn').textContent = '🔗 이 화면 링크 복사'; }, 2000);
});

// 같은 탭에 공유 링크를 붙여넣었을 때도 반영되게 한다
// (writeUrl 은 replaceState 라 hashchange 를 일으키지 않으므로 무한 반복 걱정은 없다)
addEventListener('hashchange', () => {
  if (state.viewMode) exitViewMode();
  if (readUrl()) { updateSunPath(); updateSun(); }
});

// 상태가 바뀔 때마다 주소를 갱신 (연속 조작 중엔 몰아서)
let urlTimer = null;
const queueUrl = () => { clearTimeout(urlTimer); urlTimer = setTimeout(writeUrl, 400); };
['bldSelect', 'hoSelect', 'floorSlider', 'dateInput', 'timeSlider', 'northSlider', 'p2Slider',
 'latSlider', 'tiltSlider'].forEach((id) => {
  $(id).addEventListener('change', queueUrl);
  $(id).addEventListener('input', queueUrl);
});

// ────────────────────────────────────────────────────────────
// 13. 렌더 루프
// ────────────────────────────────────────────────────────────
let last = performance.now();
function animate(now) {
  requestAnimationFrame(animate);
  const dt = (now - last) / 1000; last = now;

  if (state.playing) {
    state.hour += dt * 2;                 // 1초에 약 2시간
    if (state.hour > 24) state.hour -= 24;
    $('timeSlider').value = state.hour;
    $('timeLabel').textContent = formatHour(state.hour);
    updateSun();
  }
  animateLake(lake, now / 1000);
  controls.update();
  renderer.render(scene, camera);
}

readUrl();                       // 공유 링크로 들어왔으면 그 상태로 복원
$('timeLabel').textContent = formatHour(state.hour);
updateLearnInfo();
updateSunPath();
updateSun();
requestAnimationFrame(animate);

// 디버깅용
window.__app = {
  scene, camera, controls, state, towerMap, siteGroup, updateSun,
  get heatCells() { return heatCells; },
  get heatData() { return heatData; },
};

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
