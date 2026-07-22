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
import { getSunPosition, sunDirectionVector, kstDate, findSunriseSunset, formatHour } from './sun.js';
import {
  createTower, getUnitAnchor, createWindowFrame, placeWindowFrame,
  setTypeColorMode, highlightWing,
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
const state = { date: '2026-12-22', hour: 12, playing: false, viewMode: false, savedCam: null };

// ────────────────────────────────────────────────────────────
// 5. 태양
// ────────────────────────────────────────────────────────────
function updateSun() {
  const { lat, lon, timezone } = SITE_LOCATION;
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

  const { sunrise, sunset } = findSunriseSunset(state.date, SITE_LOCATION.lat, SITE_LOCATION.lon);
  $('sunrise').textContent = formatHour(sunrise);
  $('sunset').textContent = formatHour(sunset);
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

/** 선택한 호수의 평형 색 칩 + 3D 날개 강조를 갱신 */
function updateHoSwatch() {
  const b = BUILDINGS.find((x) => x.id === $('bldSelect').value);
  const ho = +$('hoSelect').value;
  const t = b.types[ho - 1];
  $('hoSwatch').style.background = TYPE_COLORS[t] || '#888';
  $('hoSwatch').title = TYPE_NAMES[t] || t;

  // 선택한 호수의 날개만 테두리로 강조 (다른 동의 강조는 지운다)
  Object.entries(towerMap).forEach(([id, tw]) => highlightWing(tw, id === b.id ? ho : null));

  // 색상표에서 지금 선택된 평형을 표시
  document.querySelectorAll('#typeLegend .legend-item').forEach((el) => {
    el.classList.toggle('on', el.dataset.type === t);
  });
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
    updateHoSwatch();
    if (state.viewMode) enterViewMode();
  });
}
$('bldSelect').addEventListener('change', () => { syncBuilding(); if (state.viewMode) enterViewMode(); });
$('hoSelect').addEventListener('change', () => { updateHoSwatch(); if (state.viewMode) enterViewMode(); });
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
  document.querySelectorAll('.preset').forEach((p) => p.classList.toggle('on', p.dataset.date === state.date));
  updateSunPath(); updateSun();
});
document.querySelectorAll('.preset').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.date = btn.dataset.date;
    $('dateInput').value = state.date;
    document.querySelectorAll('.preset').forEach((p) => p.classList.remove('on'));
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
$('chkType').addEventListener('change', (e) => {
  Object.values(towerMap).forEach((t) => setTypeColorMode(t, e.target.checked));
});
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

$('viewBtn').addEventListener('click', enterViewMode);
$('backBtn').addEventListener('click', exitViewMode);

// ────────────────────────────────────────────────────────────
// 8. 일조 분석
// ────────────────────────────────────────────────────────────
$('analyzeBtn').addEventListener('click', () => {
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
// 9. 렌더 루프
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

$('timeLabel').textContent = formatHour(state.hour);
updateSunPath();
updateSun();
requestAnimationFrame(animate);

// 디버깅용
window.__app = { scene, camera, controls, state, towerMap, siteGroup, updateSun };

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
