/**
 * 아파트 동(棟) 3D 생성 모듈
 *
 * 이 단지의 동은 모두 "십자형 탑상형"이다.
 * 가운데 코어(엘리베이터·계단)에 세대 4개가 네 방향으로 붙는 구조라서,
 * 코어 박스 1개 + 날개(wing) 박스 4개로 만든다. 날개 하나 = 한 라인(1호~4호).
 *
 * ── 날개 크기 ──
 * 날개마다 주택형이 다르므로(예: 104동은 152㎡ 2개 + 132㎡ 2개)
 * UNIT_TYPES의 평형별 치수를 그대로 써서 넓은 평형은 더 크고 길게 만든다.
 *
 * ── 각도 규칙 ──
 * siteData의 axis는 "배치도 이미지에서 십자가 돌아간 각도"다.
 * 배치도를 바닥에 깔면 이미지 x축 → 3D +X, 이미지 y축(아래) → 3D +Z 가 되므로
 * 날개 i는 3D 평면에서 (axis + i*90)도 방향을 향한다.
 * three.js의 rotation.y는 반대로 도니까 group.rotation.y = -axis 를 준다.
 *
 * ── 피난층 ──
 * 동·호수 배치도상 전 동 20층은 비거주(X). 하부·피난띠·상부로 나눠 쌓아 띠로 보이게 한다.
 */

import * as THREE from 'three';
import { FLOOR_HEIGHT, UNIT_TYPES, REFUGE_FLOORS } from './siteData.js';
import { UNIT_PLACEMENT, TYPE_COLORS } from './unitData.js';

/** 층마다 창이 반복되는 외벽 텍스처 */
function makeFacadeTexture(repeatX, repeatY) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#eae7e0'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#d2cec5'; g.fillRect(0, 0, 128, 9);          // 층 구분(슬래브) 선
  g.fillStyle = '#41505f';
  g.fillRect(13, 24, 45, 76); g.fillRect(70, 24, 45, 76);     // 창 2개
  g.strokeStyle = '#93a0ae'; g.lineWidth = 3;
  g.strokeRect(13, 24, 45, 76); g.strokeRect(70, 24, 45, 76);

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const PLAIN_WALL = 0xffffff;   // 색상 표시를 껐을 때의 외벽(텍스처 원색)
const PLAIN_ROOF = 0xb5b2ab;
const REFUGE_COLOR = 0x2c333f; // 피난층 띠 — 거주층보다 어둡게

/**
 * 평형 색을 외벽에 입힐 때 쓰는 색
 * 범례 색을 그대로 곱하면 창문이 안 보일 만큼 어두워져서 흰색을 22%만 섞는다.
 *
 * 주의: THREE.Color.lerp 는 선형 색공간에서 섞어서 눈에 보이는 것보다 훨씬 밝아진다.
 *       (#022e48 을 30% 섞으면 회색이 되어버린다) 그래서 sRGB 값에서 직접 섞는다.
 */
function wallTint(type) {
  const hex = TYPE_COLORS[type] || '#ffffff';
  const ch = (i) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  const mix = (v) => Math.round(v + (255 - v) * 0.22);
  return new THREE.Color(`rgb(${mix(ch(0))},${mix(ch(1))},${mix(ch(2))})`);
}

function makeBox(w, h, d, floors, type = null) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const tint = type ? wallTint(type) : new THREE.Color(PLAIN_WALL);
  const roofCol = type ? new THREE.Color(TYPE_COLORS[type]) : new THREE.Color(PLAIN_ROOF);

  const sideX = new THREE.MeshLambertMaterial({ map: makeFacadeTexture(Math.max(1, Math.round(d / 5)), floors), color: tint });
  const sideZ = new THREE.MeshLambertMaterial({ map: makeFacadeTexture(Math.max(1, Math.round(w / 5)), floors), color: tint });
  const roof = new THREE.MeshLambertMaterial({ color: roofCol });

  const mesh = new THREE.Mesh(geo, [sideX, sideX, roof, roof, sideZ, sideZ]);
  mesh.castShadow = true; mesh.receiveShadow = true;
  // 색상 표시를 켜고 끌 수 있도록 두 가지 색을 기억해 둔다
  mesh.userData.palette = { type, tint, roofCol };
  return mesh;
}

/** 피난층 띠용 박스 — 창 텍스처 없이 어두운 단색, 살짝 튀어나오게 */
function makeRefugeBox(w, h, d) {
  const mat = new THREE.MeshLambertMaterial({ color: REFUGE_COLOR });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.isRefuge = true;
  return mesh;
}

/** 날개 인덱스 i가 몇 호인지 (호수는 배치도상 시계방향 1→2→3→4) */
function wingIndexToHo(cfg, i) {
  return ((i - cfg.line1 / 90) % 4 + 4) % 4 + 1;
}

/** 호수(1~4) → 날개 인덱스 */
export function hoToWingIndex(cfg, ho) {
  return ((cfg.line1 / 90) + (ho - 1)) % 4;
}

/**
 * 하부(1~19) + 피난띠(20) + 상부(21~꼭대기) 로 나눠 쌓는다.
 */
function addStackedMass(parent, { sizeX, sizeZ, topFloor, refugeFloor, type }) {
  const parts = [];
  if (topFloor < refugeFloor) {
    parts.push({ from: 1, to: topFloor, refuge: false });
  } else {
    parts.push({ from: 1, to: refugeFloor - 1, refuge: false });
    parts.push({ from: refugeFloor, to: refugeFloor, refuge: true });
    if (topFloor > refugeFloor) parts.push({ from: refugeFloor + 1, to: topFloor, refuge: false });
  }

  parts.forEach(({ from, to, refuge }) => {
    const floors = to - from + 1;
    const partH = floors * FLOOR_HEIGHT;
    const yCenter = (from - 1) * FLOOR_HEIGHT + partH / 2;
    // 피난 띠는 1.04배로 살짝 돌출시켜 외벽에서 띠로 읽히게 한다
    const mesh = refuge
      ? makeRefugeBox(sizeX * 1.04, partH * 0.94, sizeZ * 1.04)
      : makeBox(sizeX, partH, sizeZ, floors, type);
    mesh.position.y = yCenter;
    parent.add(mesh);
  });
}

/**
 * 동 하나 생성
 * @param {object} cfg - siteData의 BUILDINGS 항목 + {x, z} 미터 좌표
 */
export function createTower(cfg) {
  const group = new THREE.Group();
  const h = cfg.floors * FLOOR_HEIGHT;
  const core = cfg.core;
  const tips = [];
  const wingMeshes = [];
  const wingTypes = [];
  const refugeFloor = REFUGE_FLOORS[0];

  // 1) 코어 — 피난 띠 포함
  addStackedMass(group, {
    sizeX: core, sizeZ: core, topFloor: cfg.floors, refugeFloor, type: null,
  });

  // 2) 날개 4개
  const place = UNIT_PLACEMENT[cfg.id];
  const widths = [];
  const lats = [];

  for (let i = 0; i < 4; i++) {
    const ho = wingIndexToHo(cfg, i);
    const m = place && place[ho - 1];
    const fallback = UNIT_TYPES[cfg.types[ho - 1]] || UNIT_TYPES['115A'];

    const tip = m ? m.tip : core / 2 + fallback.len;
    const wingW = m ? m.wid : fallback.w;
    const lat = m ? m.lat : 0;
    const wingLen = tip - core / 2;
    tips[i] = tip; widths[i] = wingW; lats[i] = lat;

    const topFloor = (cfg.stepTop && cfg.stepTop[ho]) || cfg.floors;
    const angle = i * Math.PI / 2;
    const dist = core / 2 + wingLen / 2;
    const isX = i % 2 === 0;
    const type = cfg.types[ho - 1];

    const wingGroup = new THREE.Group();
    wingGroup.userData.wingIndex = i;
    wingGroup.userData.ho = ho;
    addStackedMass(wingGroup, {
      sizeX: isX ? wingLen : wingW,
      sizeZ: isX ? wingW : wingLen,
      topFloor, refugeFloor, type,
    });
    wingGroup.position.set(
      Math.cos(angle) * dist - Math.sin(angle) * lat,
      0,
      Math.sin(angle) * dist + Math.cos(angle) * lat
    );

    // 색칠 대상은 거주층 메시만 (피난 띠 제외)
    const paintTargets = [];
    wingGroup.traverse((obj) => {
      if (obj.isMesh && obj.userData.palette) paintTargets.push(obj);
    });
    wingGroup.userData.paintTargets = paintTargets;
    wingMeshes[i] = wingGroup;
    wingTypes[i] = type;
    group.add(wingGroup);
  }

  // 3) 옥탑
  const crown = new THREE.Mesh(
    new THREE.BoxGeometry(core + 4, 5, core + 4),
    new THREE.MeshLambertMaterial({ color: 0x2f3a4a })
  );
  crown.position.y = h + 2.5;
  crown.castShadow = true;
  group.add(crown);

  group.position.set(cfg.x, 0, cfg.z);
  group.rotation.y = -THREE.MathUtils.degToRad(cfg.axis);
  group.userData = { ...cfg, height: h, tips, widths, lats, wingMeshes, wingTypes };
  return group;
}

/** 날개 하나를 평형 색 / 기본 외벽색으로 칠한다 (피난 띠는 건드리지 않음) */
function paintWing(wing, colored) {
  const targets = wing.userData.paintTargets
    || (wing.isMesh && wing.userData.palette ? [wing] : []);
  targets.forEach((mesh) => {
    const p = mesh.userData.palette;
    if (!p) return;
    mesh.material.forEach((m, idx) => {
      const isRoof = idx === 2 || idx === 3;
      if (isRoof) m.color.copy(colored ? p.roofCol : new THREE.Color(PLAIN_ROOF));
      else m.color.copy(colored ? p.tint : new THREE.Color(PLAIN_WALL));
    });
  });
}

/** 동 전체를 평형 색 / 기본색으로 */
export function setTypeColorMode(tower, on) {
  (tower.userData.wingMeshes || []).forEach((w) => w && paintWing(w, on));
}

/**
 * 선택한 호수의 날개만 평형 색으로 칠한다.
 * @param {number|null} ho
 * @param {boolean} colorAll
 */
export function selectWing(tower, ho, colorAll = false) {
  const cfg = tower.userData;
  const sel = ho == null ? -1 : hoToWingIndex(cfg, ho);
  (cfg.wingMeshes || []).forEach((w, i) => w && paintWing(w, colorAll || i === sel));

  const old = tower.getObjectByName('wingHighlight');
  if (old) { old.geometry.dispose(); old.material.dispose(); tower.remove(old); }

  if (sel < 0 || !colorAll) return;
  const wing = cfg.wingMeshes[sel];
  if (!wing) return;
  const target = (wing.userData.paintTargets && wing.userData.paintTargets[0]) || null;
  if (!target || !target.geometry) return;
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(target.geometry),
    new THREE.LineBasicMaterial({ color: 0xffd23d, depthTest: false, transparent: true, opacity: 0.95 })
  );
  edges.position.copy(wing.position);
  edges.position.y += target.position.y;
  edges.renderOrder = 999;
  edges.name = 'wingHighlight';
  tower.add(edges);
}

/**
 * 4베이 전면에서 방별 창 위치
 * 공식 평면도 기준 전면(좌→우): 침실 · 침실 · 거실 · 안방.
 * B형은 좌우가 뒤집힌 거울형으로 본다.
 *
 * @param {'living'|'master'} room
 */
export function roomWindowLayout(fullWid, type, room = 'living') {
  const bay = fullWid / 4;
  const mirror = typeof type === 'string' && type.endsWith('B');
  let bayIndex = room === 'master' ? 3 : 2;
  if (mirror) bayIndex = 3 - bayIndex;
  const along = (bayIndex - 1.5) * bay;
  const winW = room === 'master' ? fullWid * 0.24 : fullWid * 0.30;
  // 확장형: 거실은 발코니 흡수, 안방만 발코니 잔존
  const hasBalcony = room === 'master';
  return { along, winW, hasBalcony, room };
}

/**
 * 특정 세대(동/층/호)의 창 위치·방향 (월드 좌표)
 * @param {'living'|'master'} room
 */
export function getUnitAnchor(tower, floor, ho, room = 'living') {
  tower.updateMatrixWorld(true);
  const cfg = tower.userData;
  const i = hoToWingIndex(cfg, ho);
  const tip = cfg.tips[i];
  const fullWid = cfg.widths ? cfg.widths[i] : 10;
  const baseLat = cfg.lats ? cfg.lats[i] : 0;
  const type = cfg.types[ho - 1];
  const { along, winW, hasBalcony } = roomWindowLayout(fullWid, type, room);
  const lat = baseLat + along;
  const angle = i * Math.PI / 2;
  const floorY = (floor - 1) * FLOOR_HEIGHT;
  const y = floorY + 1.62;

  const p = (r) => new THREE.Vector3(
    Math.cos(angle) * r - Math.sin(angle) * lat,
    y,
    Math.sin(angle) * r + Math.cos(angle) * lat
  );

  const position = tower.localToWorld(p(tip + 0.6));
  const normal = tower.localToWorld(p(tip + 1.6)).sub(position).normalize();
  const eye = tower.localToWorld(p(tip - 1.7));

  return { position, eye, normal, wid: winW, fullWid, tip, floorY, room, hasBalcony };
}

/**
 * 조망 모드 창틀·발코니
 * 안방은 발코니 난간, 거실(확장형)은 난장만.
 */
export function createWindowFrame(wid, { hasBalcony = false } = {}) {
  const g = new THREE.Group();
  const frame = new THREE.MeshLambertMaterial({ color: 0x2b3038 });
  const slab = new THREE.MeshLambertMaterial({ color: 0x3a4049 });
  const glass = new THREE.MeshLambertMaterial({
    color: 0xa8c4d8, transparent: true, opacity: 0.18, depthWrite: false,
  });

  const openW = Math.max(2.5, wid - 0.4);
  const openH = 2.35;
  const D = 0.5;

  [-1, 1].forEach((s) => {
    const w = new THREE.Mesh(new THREE.BoxGeometry(D, openH, 0.6), frame);
    w.position.set(0, openH / 2, s * (openW / 2 + 0.3));
    g.add(w);
  });
  const head = new THREE.Mesh(new THREE.BoxGeometry(D, 0.55, openW + 1.2), frame);
  head.position.set(0, openH + 0.27, 0);
  g.add(head);
  const sill = new THREE.Mesh(new THREE.BoxGeometry(D, 0.35, openW + 1.2), slab);
  sill.position.set(0, -0.17, 0);
  g.add(sill);

  if (hasBalcony) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.9, openW), glass);
    panel.position.set(0.16, 0.52, 0);
    g.add(panel);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.07, openW + 0.15), frame);
    rail.position.set(0.16, 1.0, 0);
    g.add(rail);
  }

  g.name = 'windowFrame';
  return g;
}

/** 창틀을 해당 세대·방 위치·방향에 맞춰 놓는다 */
export function placeWindowFrame(frameGroup, tower, floor, ho, room = 'living') {
  const cfg = tower.userData;
  const i = hoToWingIndex(cfg, ho);
  const tip = cfg.tips[i];
  const fullWid = cfg.widths ? cfg.widths[i] : 10;
  const baseLat = cfg.lats ? cfg.lats[i] : 0;
  const type = cfg.types[ho - 1];
  const { along } = roomWindowLayout(fullWid, type, room);
  const lat = baseLat + along;
  const angle = i * Math.PI / 2;
  const floorY = (floor - 1) * FLOOR_HEIGHT;

  frameGroup.position.set(
    Math.cos(angle) * tip - Math.sin(angle) * lat,
    floorY + 0.2,
    Math.sin(angle) * tip + Math.cos(angle) * lat
  );
  frameGroup.rotation.set(0, -angle, 0);
}
