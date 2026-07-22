/**
 * 대지(사이트) 3D 생성 모듈 — "배치도 사진"이 아니라 실제 지형처럼 만든다
 *
 * · 바닥      : 배치도를 픽셀 분류해 잔디·수목·아스팔트·보도·모래로 다시 칠한 terrain.png
 * · 호수      : 실제 수면 (잔물결이 흐르는 노멀맵 + 반사)
 * · 수목      : 배치도에서 뽑아낸 1,600여 그루를 인스턴싱으로 심는다
 * · 원경      : 경산 일대처럼 멀리 낮은 산을 둘러 배경을 만든다
 * · 저층부    : 상가·커뮤니티 블록
 */

import * as THREE from 'three';
import { TERRAIN, LAKE_OUTLINE_PX, PX_TO_M, px2m } from './siteData.js';
import { TREE_DATA, LOW_BLOCKS } from './sceneryData.js';

// ────────────────────────── 지형 바닥 ──────────────────────────
export function createTerrain(onLoad) {
  const geo = new THREE.PlaneGeometry(TERRAIN.width, TERRAIN.depth);
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });

  new THREE.TextureLoader().load('./assets/terrain.png', (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    mat.map = tex;
    mat.needsUpdate = true;
    if (onLoad) onLoad();
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(TERRAIN.center.x, 0, TERRAIN.center.z);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return mesh;
}

/** 검증용: 원본 배치도를 지형 위에 반투명하게 겹쳐 본다 (기본 꺼짐) */
export function createPlanOverlay() {
  const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.75, depthWrite: false });
  new THREE.TextureLoader().load('./assets/db.jpg', (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    // 원본 이미지 전체(1100x1134) 중 지형과 같은 구간만 잘라 쓴다
    tex.offset.set(0, 1 - TERRAIN.y1 / 1134);
    tex.repeat.set(1, (TERRAIN.y1 - TERRAIN.y0) / 1134);
    mat.map = tex; mat.needsUpdate = true;
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(TERRAIN.width, TERRAIN.depth), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(TERRAIN.center.x, 0.35, TERRAIN.center.z);
  mesh.visible = false;
  mesh.name = 'planOverlay';
  return mesh;
}

/** 지형보다 훨씬 넓은 바깥 지면 (안개 너머까지 깔아 끝단이 안 보이게) */
export function createOuterGround() {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(9000, 9000),
    // 지형 텍스처 가장자리와 같은 색이라 판 경계가 눈에 띄지 않는다
    new THREE.MeshLambertMaterial({ color: 0x959f8b })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -0.4;
  mesh.receiveShadow = true;
  return mesh;
}

// ────────────────────────── 호수 ──────────────────────────
/** 잔물결용 노멀맵을 캔버스로 만든다 */
function makeRippleNormal() {
  const N = 256;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d');
  const img = g.createImageData(N, N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      // 파장이 다른 사인파를 겹쳐 물결 높이를 만들고, 그 기울기를 법선으로 바꾼다
      const h = (u, v) =>
        Math.sin(u * 0.20) * 0.5 + Math.sin(v * 0.31 + u * 0.07) * 0.35 + Math.sin((u + v) * 0.13) * 0.3;
      const dx = h(x + 1, y) - h(x - 1, y);
      const dy = h(x, y + 1) - h(x, y - 1);
      const i = (y * N + x) * 4;
      img.data[i] = 128 + dx * 90;
      img.data[i + 1] = 128 + dy * 90;
      img.data[i + 2] = 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(14, 14);
  return tex;
}

export function createLake() {
  const shape = new THREE.Shape();
  LAKE_OUTLINE_PX.forEach(([x, y], i) => {
    const p = px2m(x, y);
    if (i === 0) shape.moveTo(p.x, p.z); else shape.lineTo(p.x, p.z);
  });
  shape.closePath();

  const geo = new THREE.ShapeGeometry(shape);
  // ShapeGeometry는 XY 평면에 만들어지므로 UV를 물결 크기에 맞게 다시 잡아준다
  const pos = geo.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) / 60;
    uv[i * 2 + 1] = pos.getY(i) / 60;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));

  const ripple = makeRippleNormal();
  const mat = new THREE.MeshPhongMaterial({
    color: 0x2a6f96, shininess: 110, specular: 0xd6f0ff,
    normalMap: ripple, normalScale: new THREE.Vector2(0.5, 0.5),
    transparent: true, opacity: 0.92,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = Math.PI / 2;
  mesh.position.y = 0.2;
  mesh.name = 'lake';
  mesh.userData.ripple = ripple;
  return mesh;
}

/** 물결이 천천히 흐르게 (렌더 루프에서 호출) */
export function animateLake(lake, t) {
  const r = lake.userData.ripple;
  if (!r) return;
  r.offset.x = t * 0.010;
  r.offset.y = t * 0.006;
}

// ────────────────────────── 수목 ──────────────────────────
/**
 * 배치도에서 뽑은 나무 위치에 인스턴싱으로 나무를 심는다.
 * 1,600그루를 개별 메시로 만들면 무거우니 줄기·수관 각각 InstancedMesh 하나씩만 쓴다.
 */
export function createTrees() {
  const n = TREE_DATA.length / 3;
  const trunkGeo = new THREE.CylinderGeometry(0.28, 0.42, 3.2, 5);
  const crownGeo = new THREE.IcosahedronGeometry(2.6, 0);

  const trunk = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x5c4633 }), n);
  const crown = new THREE.InstancedMesh(crownGeo, new THREE.MeshLambertMaterial({ color: 0x4e7f42 }), n);
  crown.castShadow = true;
  trunk.castShadow = true;

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const color = new THREE.Color();

  for (let i = 0; i < n; i++) {
    const px = TREE_DATA[i * 3], py = TREE_DATA[i * 3 + 1], s = TREE_DATA[i * 3 + 2];
    const p = px2m(px, py);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (i * 2.399) % (Math.PI * 2));

    m.compose(new THREE.Vector3(p.x, 1.6 * s, p.z), q, new THREE.Vector3(s, s, s));
    trunk.setMatrixAt(i, m);

    m.compose(new THREE.Vector3(p.x, (3.2 + 2.2) * s, p.z), q, new THREE.Vector3(s, s * 1.15, s));
    crown.setMatrixAt(i, m);

    // 수관 색을 조금씩 다르게 해서 심어놓은 티가 덜 나게
    color.setHSL(0.26 + ((i * 37) % 11) * 0.004, 0.34, 0.28 + ((i * 53) % 13) * 0.006);
    crown.setColorAt(i, color);
  }
  trunk.instanceMatrix.needsUpdate = true;
  crown.instanceMatrix.needsUpdate = true;
  if (crown.instanceColor) crown.instanceColor.needsUpdate = true;

  const g = new THREE.Group();
  g.add(trunk, crown);
  g.name = 'trees';
  return g;
}

// ────────────────────────── 저층부 ──────────────────────────
export function createLowBlocks() {
  const group = new THREE.Group();
  const wall = new THREE.MeshLambertMaterial({ color: 0xcfc9bd });
  const roof = new THREE.MeshLambertMaterial({ color: 0x6a6f78 });

  LOW_BLOCKS.forEach(([px, py, lenPx, widPx, rot], i) => {
    const p = px2m(px, py);
    const w = lenPx * PX_TO_M, d = widPx * PX_TO_M;
    const h = 9 + (i % 3) * 5;                    // 3~6층 정도

    const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wall);
    box.position.set(p.x, h / 2, p.z);
    box.rotation.y = -THREE.MathUtils.degToRad(rot);
    box.castShadow = true; box.receiveShadow = true;
    group.add(box);

    const cap = new THREE.Mesh(new THREE.BoxGeometry(w * 0.98, 0.8, d * 0.98), roof);
    cap.position.set(p.x, h + 0.4, p.z);
    cap.rotation.y = box.rotation.y;
    cap.castShadow = true;
    group.add(cap);
  });
  group.name = 'lowBlocks';
  return group;
}

// ────────────────────────── 원경(먼 산) ──────────────────────────
/** 경산 일대처럼 멀리 낮은 산줄기를 둘러 배경을 만든다 */
export function createHills() {
  const group = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0x5b6b52, fog: true });
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

  for (let i = 0; i < 26; i++) {
    const ang = (i / 26) * Math.PI * 2 + rnd() * 0.12;
    const dist = 1500 + rnd() * 900;
    const r = 260 + rnd() * 380;
    const h = 70 + rnd() * 180;
    const hill = new THREE.Mesh(new THREE.ConeGeometry(r, h, 9), mat);
    hill.position.set(Math.cos(ang) * dist, h / 2 - 12, Math.sin(ang) * dist);
    hill.rotation.y = rnd() * 3;
    group.add(hill);
  }
  group.name = 'hills';
  return group;
}

// ────────────────────────── 방위 · 라벨 ──────────────────────────
/** N/E/S/W 방위 표시 — 단지를 돌려도 고정이라 항상 진짜 북쪽을 가리킨다 */
export function createCompass() {
  const group = new THREE.Group();
  [['N', '#ff5a5a', 0, -360], ['E', '#ffffff', 360, 0],
   ['S', '#ffffff', 0, 360], ['W', '#ffffff', -360, 0]].forEach(([text, color, x, z]) => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = color; g.font = 'bold 96px sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
    s.scale.set(48, 48, 1);
    s.position.set(x, 40, z);
    group.add(s);
  });
  group.name = 'compass';
  return group;
}

/** 동 번호 라벨 */
export function createBuildingLabel(text, height, dim = false) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = dim ? 'rgba(40,46,60,0.72)' : 'rgba(20,26,38,0.88)';
  g.roundRect(24, 34, 208, 60, 14); g.fill();
  g.fillStyle = dim ? '#c8cede' : '#ffffff';
  g.font = 'bold 46px sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 128, 64);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  s.scale.set(38, 19, 1);
  s.position.y = height + 18;
  return s;
}
