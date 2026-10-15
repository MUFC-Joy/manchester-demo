/**
 * controls.js — 地图式键位 + 自由视角限位（方案 §6.7 + v2 问题三）
 *
 * 键位对齐地图软件的直觉（v2 用户拍板）：
 *   左键拖动 = 平移（去任何地方）· 右键拖动 = 旋转视角 · 滚轮 = 缩放
 *   双击地面 = 相机飞到该点（带 0.8s 缓动）
 * minDistance / maxPolarAngle 锁死，防止钻进楼里和翻到地下。
 */

import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

const GROUND_PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
const FLY_DURATION = 0.8 // 双击飞行时长（秒）

export function createControls(camera, domElement) {
  const controls = new OrbitControls(camera, domElement)

  controls.enableDamping = true
  controls.dampingFactor = 0.075
  controls.rotateSpeed = 0.55
  controls.zoomSpeed = 0.9
  controls.panSpeed = 0.7

  controls.minDistance = 80
  controls.maxDistance = 16000
  controls.maxPolarAngle = THREE.MathUtils.degToRad(88)
  controls.minPolarAngle = THREE.MathUtils.degToRad(2)

  controls.screenSpacePanning = false
  controls.target.set(0, 0, 0)

  // 地图式键位：左键平移、右键旋转、滚轮缩放（v2 问题三）
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.PAN,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.ROTATE,
  }
  // 触屏：单指平移、双指捏合缩放 + 旋转
  controls.touches = {
    ONE: THREE.TOUCH.PAN,
    TWO: THREE.TOUCH.DOLLY_ROTATE,
  }

  // ── 双击地面飞行（v2 问题三）──
  const raycaster = new THREE.Raycaster()
  const ndc = new THREE.Vector2()
  // 保存 target→camera 的相对偏移，飞行时整体平移，视角朝向保持不变
  const tween = {
    active: false,
    t: 0,
    fromCam: new THREE.Vector3(),
    toCam: new THREE.Vector3(),
    fromTgt: new THREE.Vector3(),
    toTgt: new THREE.Vector3(),
  }

  function startFlyTo(hit) {
    const offset = new THREE.Vector3().subVectors(camera.position, controls.target)
    tween.fromCam.copy(camera.position)
    tween.fromTgt.copy(controls.target)
    tween.toTgt.copy(hit)
    tween.toCam.copy(hit).add(offset)
    tween.t = 0
    tween.active = true
  }

  domElement.addEventListener('dblclick', (e) => {
    if (!controls.enabled || tween.active) return
    const rect = domElement.getBoundingClientRect()
    ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(ndc, camera)
    const hit = new THREE.Vector3()
    if (raycaster.ray.intersectPlane(GROUND_PLANE, hit)) {
      // 别飞出限位范围
      const dist = hit.distanceTo(camera.position)
      if (dist >= controls.minDistance && dist <= controls.maxDistance) {
        startFlyTo(hit)
      }
    }
  })

  // 包一层 update：推进飞行动画（自计时，不改变外部调用约定）
  const origUpdate = controls.update.bind(controls)
  let lastTime = performance.now()
  controls.update = function () {
    const now = performance.now()
    const dt = Math.min(0.1, (now - lastTime) / 1000)
    lastTime = now

    if (tween.active) {
      tween.t += dt / FLY_DURATION
      // easeInOutCubic
      const p = tween.t < 0.5 ? 4 * tween.t ** 3 : 1 - (-2 * tween.t + 2) ** 3 / 2
      const k = Math.min(1, p)
      camera.position.lerpVectors(tween.fromCam, tween.toCam, k)
      controls.target.lerpVectors(tween.fromTgt, tween.toTgt, k)
      if (tween.t >= 1) tween.active = false
    }
    return origUpdate()
  }

  return controls
}
