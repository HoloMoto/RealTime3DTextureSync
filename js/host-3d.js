import * as THREE from 'https://unpkg.com/three@0.159.0/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.159.0/examples/jsm/controls/OrbitControls.js';

const canvas = document.getElementById('canvas3d');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.xr.enabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const savedSceneBackground = new THREE.Color(0x020617);
scene.background = savedSceneBackground.clone();

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
camera.position.set(0, 0.6, 3.2);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 1.4;
controls.maxDistance = 14;
controls.maxPolarAngle = Math.PI * 0.92;
controls.target.set(0, 0, 0);

const hemi = new THREE.HemisphereLight(0xffffff, 0x334455, 0.9);
scene.add(hemi);
const dir = new THREE.DirectionalLight(0xffffff, 0.5);
dir.position.set(2, 4, 3);
scene.add(dir);

const placeholder = new THREE.TextureLoader().load(
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
);
const mat = new THREE.MeshStandardMaterial({
  map: placeholder,
  roughness: 0.35,
  metalness: 0.15,
});

let currentShape = 'cube';
const meshRestPosition = new THREE.Vector3(0, 0, 0);
const meshArPosition = new THREE.Vector3(0, 1.45, -2.4);
let mesh = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), mat);
scene.add(mesh);

const cubeBtn = document.getElementById('shape-cube');
const sphereBtn = document.getElementById('shape-sphere');
const cubeTb = document.getElementById('shape-cube-tb');
const sphereTb = document.getElementById('shape-sphere-tb');

function updateShapeButtons() {
  const c = currentShape === 'cube';
  cubeBtn.classList.toggle('is-active', c);
  sphereBtn.classList.toggle('is-active', !c);
  cubeTb.classList.toggle('is-active', c);
  sphereTb.classList.toggle('is-active', !c);
}

function setShape(kind) {
  if (kind !== 'cube' && kind !== 'sphere') return;
  if (kind === currentShape) return;
  currentShape = kind;
  mesh.geometry.dispose();
  mesh.geometry =
    kind === 'cube'
      ? new THREE.BoxGeometry(1.2, 1.2, 1.2)
      : new THREE.SphereGeometry(0.78, 48, 32);
  updateShapeButtons();
}

cubeBtn.addEventListener('click', function () {
  setShape('cube');
});
sphereBtn.addEventListener('click', function () {
  setShape('sphere');
});
cubeTb.addEventListener('click', function () {
  setShape('cube');
});
sphereTb.addEventListener('click', function () {
  setShape('sphere');
});

const btnImmersive = document.getElementById('btn-immersive');
const btnExitImmersive = document.getElementById('btn-exit-immersive');
const btnAr = document.getElementById('btn-ar');
const btnGyro = document.getElementById('btn-gyro');

function setImmersive(on) {
  document.body.classList.toggle('view-immersive', on);
  btnImmersive.textContent = on ? '全面表示を終了' : '3D全面表示';
}

btnImmersive.addEventListener('click', function () {
  setImmersive(!document.body.classList.contains('view-immersive'));
});
btnExitImmersive.addEventListener('click', function () {
  setImmersive(false);
});
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape' && document.body.classList.contains('view-immersive')) {
    setImmersive(false);
  }
});

let gyroEnabled = false;

function onDeviceOrientation(e) {
  if (!gyroEnabled || renderer.xr.isPresenting) return;
  const beta = THREE.MathUtils.degToRad(Math.min(90, Math.max(-90, e.beta || 0)));
  const gamma = THREE.MathUtils.degToRad(Math.min(90, Math.max(-90, e.gamma || 0)));
  mesh.rotation.x = beta * 0.7;
  mesh.rotation.y = gamma * 0.7;
}

function setGyro(on) {
  gyroEnabled = on;
  const xrBusy = renderer.xr.isPresenting;
  controls.enabled = !on && !xrBusy;
  if (btnGyro) {
    btnGyro.textContent = on ? 'ジャイロOFF' : 'ジャイロ追従';
    btnGyro.classList.toggle('is-active', on);
  }
  if (!on) {
    window.removeEventListener('deviceorientation', onDeviceOrientation, true);
    mesh.rotation.set(0, 0, 0);
  }
}

async function toggleGyroFromUserGesture() {
  if (gyroEnabled) {
    setGyro(false);
    return;
  }
  if (typeof DeviceOrientationEvent === 'undefined') {
    window.alert('この端末はジャイロに対応していません。');
    return;
  }
  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      const state = await DeviceOrientationEvent.requestPermission();
      if (state !== 'granted') {
        window.alert('ジャイロを使うには許可が必要です。');
        return;
      }
    } catch (err) {
      console.error(err);
      window.alert('ジャイロ許可を取得できませんでした。');
      return;
    }
  }
  window.addEventListener('deviceorientation', onDeviceOrientation, true);
  setGyro(true);
}

if (btnGyro) {
  btnGyro.addEventListener('click', function () {
    toggleGyroFromUserGesture();
  });
}

function applyARVisuals(active) {
  if (active) {
    scene.background = null;
    renderer.setClearColor(0x000000, 0);
  } else {
    scene.background = savedSceneBackground.clone();
    renderer.setClearColor(0x000000, 1);
  }
}

function bindARSessionEnd(session) {
  session.addEventListener('end', function () {
    mesh.position.copy(meshRestPosition);
    applyARVisuals(false);
    controls.enabled = !gyroEnabled;
  });
}

async function tryEnterAR() {
  if (!navigator.xr) {
    window.alert(
      'WebXR が使えません。iPhone / iPad の Safari は現状 WebXR AR に未対応です。Android Chrome か、下の「ジャイロ追従」をお試しください。'
    );
    return;
  }
  let supported = false;
  try {
    supported = await navigator.xr.isSessionSupported('immersive-ar');
  } catch (e) {
    console.warn(e);
  }
  if (!supported) {
    window.alert(
      'このブラウザは AR（immersive-ar）に対応していません。iOS は「ジャイロ追従」をご利用ください。'
    );
    return;
  }
  setGyro(false);
  controls.enabled = false;
  try {
    const session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['local'],
      optionalFeatures: ['dom-overlay', 'hit-test'],
      domOverlay: { root: document.body },
    });
    applyARVisuals(true);
    renderer.xr.setSession(session);
    mesh.position.copy(meshArPosition);
    bindARSessionEnd(session);
  } catch (e1) {
    try {
      const session2 = await navigator.xr.requestSession('immersive-ar', {
        requiredFeatures: ['local'],
      });
      applyARVisuals(true);
      renderer.xr.setSession(session2);
      mesh.position.copy(meshArPosition);
      bindARSessionEnd(session2);
    } catch (e2) {
      console.error(e2);
      controls.enabled = !gyroEnabled;
      window.alert('AR を開始できませんでした（HTTPS・権限・端末を確認）。');
    }
  }
}

if (navigator.xr) {
  navigator.xr.isSessionSupported('immersive-ar').then(function (ok) {
    if (ok && btnAr) {
      btnAr.hidden = false;
      btnAr.disabled = false;
      btnAr.addEventListener('click', tryEnterAR);
    }
  });
} else if (btnAr) {
  btnAr.hidden = false;
  btnAr.disabled = false;
  btnAr.title = 'iOS Safari は WebXR 非対応';
  btnAr.addEventListener('click', function () {
    window.alert(
      'iPhone / iPad の Safari では WebXR AR が利用できません（Apple 側の制限）。\n「ジャイロ追従」で端末の傾きに合わせてモデルを動かせます。\nAndroid の Chrome では AR ボタンが使える場合があります。'
    );
  });
}

function resize() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w === 0 || h === 0) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

renderer.setAnimationLoop(function () {
  if (!renderer.xr.isPresenting && controls.enabled) {
    controls.update();
  }
  if (mat.map && mat.map.isVideoTexture) {
    mat.map.needsUpdate = true;
  }
  renderer.render(scene, camera);
});

window.__webtexSetVideoStream = function (stream) {
  const video = document.createElement('video');
  video.playsInline = true;
  video.muted = true;
  video.autoplay = true;
  video.srcObject = stream;
  video.play().catch(function () {});

  const tex = new THREE.VideoTexture(video);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  if (mat.map && mat.map.dispose) mat.map.dispose();
  mat.map = tex;
  mat.needsUpdate = true;
};
