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

  // 2) 날개 4개 — 각 날개는 그 라인의 주택형 크기를 따른다
  for (let i = 0; i < 4; i++) {
    const ho = wingIndexToHo(cfg, i);
    const t = UNIT_TYPES[cfg.types[ho - 1]] || UNIT_TYPES['115A'];
    const wingLen = t.len, wingW = t.w;
    tips[i] = core / 2 + wingLen;

    // 일부 동은 라인마다 최고층이 다르다 (102동처럼 상부가 계단식)
    const topFloor = (cfg.stepTop && cfg.stepTop[ho]) || cfg.floors;
    const wh = topFloor * FLOOR_HEIGHT;

    const angle = i * Math.PI / 2;
    const dist = core / 2 + wingLen / 2;
    const isX = i % 2 === 0;                 // 짝수 라인은 X축, 홀수는 Z축으로 뻗음
    const wing = makeBox(isX ? wingLen : wingW, wh, isX ? wingW : wingLen, topFloor);
    wing.position.set(Math.cos(angle) * dist, wh / 2, Math.sin(angle) * dist);
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
  group.userData = { ...cfg, height: h, tips };
  return group;
}

/**
 * 특정 세대(동/층/호)의 창 위치와 창이 바라보는 방향(월드 좌표)
 * → 조망 시점 카메라와 일조 분석에 함께 쓰인다
 */
export function getUnitAnchor(tower, floor, ho) {
  tower.updateMatrixWorld(true);
  const cfg = tower.userData;
  const i = hoToWingIndex(cfg, ho);
  const tip = cfg.tips[i];
  const angle = i * Math.PI / 2;
  const y = (floor - 0.5) * FLOOR_HEIGHT + 1.2;   // 해당 층 눈높이

  // 창면보다 0.6m 바깥에서 시작해야 자기 벽에 가려지지 않는다
  const p = (r) => new THREE.Vector3(Math.cos(angle) * r, y, Math.sin(angle) * r);
  const position = tower.localToWorld(p(tip + 0.6));
  const normal = tower.localToWorld(p(tip + 1.6)).sub(position).normalize();
  return { position, normal };
}
