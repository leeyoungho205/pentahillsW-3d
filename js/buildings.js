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
 */

import * as THREE from 'three';
import { FLOOR_HEIGHT, UNIT_TYPES } from './siteData.js';
import { UNIT_PLACEMENT } from './unitData.js';

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

function makeBox(w, h, d, floors, roofColor = 0xb5b2ab) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const sideX = new THREE.MeshLambertMaterial({ map: makeFacadeTexture(Math.max(1, Math.round(d / 5)), floors) });
  const sideZ = new THREE.MeshLambertMaterial({ map: makeFacadeTexture(Math.max(1, Math.round(w / 5)), floors) });
  const roof = new THREE.MeshLambertMaterial({ color: roofColor });
  const mesh = new THREE.Mesh(geo, [sideX, sideX, roof, roof, sideZ, sideZ]);
  mesh.castShadow = true; mesh.receiveShadow = true;
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
 * 동 하나 생성
 * @param {object} cfg - siteData의 BUILDINGS 항목 + {x, z} 미터 좌표
 */
export function createTower(cfg) {
  const group = new THREE.Group();
  const h = cfg.floors * FLOOR_HEIGHT;
  const core = cfg.core;
  const tips = [];   // 날개별 창면까지 거리 — 조망·일조 계산에 쓰인다

  // 1) 코어
  const coreBox = makeBox(core, h, core, cfg.floors);
  coreBox.position.y = h / 2;
  group.add(coreBox);

  // 2) 날개 4개 — 크기·위치는 배치도에서 잰 호수별 실측값을 그대로 쓴다
  const place = UNIT_PLACEMENT[cfg.id];
  const widths = [];
  const lats = [];

  for (let i = 0; i < 4; i++) {
    const ho = wingIndexToHo(cfg, i);
    const m = place && place[ho - 1];
    const fallback = UNIT_TYPES[cfg.types[ho - 1]] || UNIT_TYPES['115A'];

    const tip = m ? m.tip : core / 2 + fallback.len;   // 중심 → 창면 거리
    const wingW = m ? m.wid : fallback.w;              // 세대 전면 폭
    const lat = m ? m.lat : 0;                         // 축에서 옆으로 밀린 정도
    const wingLen = tip - core / 2;
    tips[i] = tip; widths[i] = wingW; lats[i] = lat;

    // 일부 동은 라인마다 최고층이 다르다 (102동처럼 상부가 계단식)
    const topFloor = (cfg.stepTop && cfg.stepTop[ho]) || cfg.floors;
    const wh = topFloor * FLOOR_HEIGHT;

    const angle = i * Math.PI / 2;
    const dist = core / 2 + wingLen / 2;
    const isX = i % 2 === 0;                 // 짝수 라인은 X축, 홀수는 Z축으로 뻗음
    const wing = makeBox(isX ? wingLen : wingW, wh, isX ? wingW : wingLen, topFloor);
    // 축 방향으로 dist, 옆으로 lat 만큼 밀어서 배치도상 실제 위치에 맞춘다
    wing.position.set(
      Math.cos(angle) * dist - Math.sin(angle) * lat,
      wh / 2,
      Math.sin(angle) * dist + Math.cos(angle) * lat
    );
    wing.userData.wingIndex = i;
    group.add(wing);
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
  group.rotation.y = -THREE.MathUtils.degToRad(cfg.axis);   // 배치도 각도 → 3D 회전
  group.userData = { ...cfg, height: h, tips, widths, lats };
  return group;
}

/**
 * 특정 세대(동/층/호)의 창 위치·방향 (월드 좌표)
 *
 * 호수마다 주택형이 달라서 창면까지 거리(tip)와 전면 폭(wid)이 다르다.
 * 그래서 같은 동·같은 층이라도 호수가 다르면 조망 시점이 실제로 달라진다.
 *
 * 반환값
 *  · position : 창면 바로 바깥 (일조 분석·개방감 측정 시작점)
 *  · eye      : 창에서 2.6m 안쪽 거실 눈높이 (조망 카메라 위치)
 *  · normal   : 창이 바라보는 바깥 방향
 *  · wid/tip  : 그 세대의 전면 폭·창면 거리
 */
export function getUnitAnchor(tower, floor, ho) {
  tower.updateMatrixWorld(true);
  const cfg = tower.userData;
  const i = hoToWingIndex(cfg, ho);
  const tip = cfg.tips[i];
  const wid = cfg.widths ? cfg.widths[i] : 10;
  const lat = cfg.lats ? cfg.lats[i] : 0;
  const angle = i * Math.PI / 2;
  const floorY = (floor - 1) * FLOOR_HEIGHT;      // 그 층 바닥 높이
  const y = floorY + 1.62;                        // 서 있을 때 눈높이

  // 축 방향 r, 옆으로 lat 만큼 밀린 실제 세대 위치
  const p = (r) => new THREE.Vector3(
    Math.cos(angle) * r - Math.sin(angle) * lat,
    y,
    Math.sin(angle) * r + Math.cos(angle) * lat
  );

  const position = tower.localToWorld(p(tip + 0.6));   // 창면 바깥 (분석용)
  const normal = tower.localToWorld(p(tip + 1.6)).sub(position).normalize();
  const eye = tower.localToWorld(p(tip - 1.7));        // 창가에 선 위치 (조망 카메라)

  return { position, eye, normal, wid, tip, floorY };
}

/**
 * 조망 모드에서 화면 가장자리에 보이는 창틀·발코니
 * 이게 있어야 "드론에서 본 장면"이 아니라 "우리 집 창밖"처럼 느껴진다.
 * 세대 전면 폭(wid)에 맞춰 크기가 달라지므로 큰 평형일수록 시야가 넓게 트인다.
 */
export function createWindowFrame(wid) {
  const g = new THREE.Group();
  const frame = new THREE.MeshLambertMaterial({ color: 0x2b3038 });
  const slab = new THREE.MeshLambertMaterial({ color: 0x3a4049 });
  const glass = new THREE.MeshLambertMaterial({
    color: 0xa8c4d8, transparent: true, opacity: 0.18, depthWrite: false,
  });

  const openW = wid - 0.8;      // 창 개구부 폭
  const openH = 2.35;           // 개구부 높이 (천장 2.4m 기준)
  const D = 0.5;                // 벽 두께

  // 좌우 벽 (+X가 바깥 방향)
  [-1, 1].forEach((s) => {
    const w = new THREE.Mesh(new THREE.BoxGeometry(D, openH, 0.6), frame);
    w.position.set(0, openH / 2, s * (openW / 2 + 0.3));
    g.add(w);
  });
  // 상부 (천장·인방)
  const head = new THREE.Mesh(new THREE.BoxGeometry(D, 0.55, openW + 1.2), frame);
  head.position.set(0, openH + 0.27, 0);
  g.add(head);
  // 하부 (바닥 슬래브 끝)
  const sill = new THREE.Mesh(new THREE.BoxGeometry(D, 0.35, openW + 1.2), slab);
  sill.position.set(0, -0.17, 0);
  g.add(sill);

  // 발코니 난간 — 창면 바로 앞, 눈높이보다 확실히 낮게 둬서 시야를 가리지 않게 한다
  // (난간 상단 1.0m, 눈높이 1.42m → 시야 아래쪽 1/3 에 걸린다)
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.9, openW), glass);
  panel.position.set(0.16, 0.52, 0);
  g.add(panel);
  const rail = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.07, openW + 0.15), frame);
  rail.position.set(0.16, 1.0, 0);
  g.add(rail);

  g.name = 'windowFrame';
  return g;
}

/** 창틀을 해당 세대 위치·방향에 맞춰 놓는다 */
export function placeWindowFrame(frameGroup, tower, floor, ho) {
  const cfg = tower.userData;
  const i = hoToWingIndex(cfg, ho);
  const tip = cfg.tips[i];
  const lat = cfg.lats ? cfg.lats[i] : 0;
  const angle = i * Math.PI / 2;
  const floorY = (floor - 1) * FLOOR_HEIGHT;

  frameGroup.position.set(
    Math.cos(angle) * tip - Math.sin(angle) * lat,
    floorY + 0.2,
    Math.sin(angle) * tip + Math.cos(angle) * lat
  );
  frameGroup.rotation.set(0, -angle, 0);   // 로컬 +X가 바깥을 향하도록
}
