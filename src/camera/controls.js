/**
 * controls.js — 自由视角限位（方案 §6.7）
 *
 * minDistance / maxPolarAngle 锁死，防止钻进楼里和翻到地下。
 */

import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

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

  return controls
}
