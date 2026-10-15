/**
 * scene.js — 渲染器 / 相机 / 灯光 / 雾 / 天空
 *
 * 性能纪律（方案 §6.2）：
 *   - 关闭全场景阴影
 *   - FogExp2 是免费的性能工具，同时给画面加氛围
 *   - pixelRatio 上限 2（移动端 1.5）
 */

import * as THREE from 'three'
import { PALETTE } from './materials.js'

export const IS_MOBILE =
  /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
  (navigator.maxTouchPoints > 1 && window.innerWidth < 900)

export function createScene() {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(PALETTE.sky)
  scene.fog = new THREE.FogExp2(PALETTE.fog, IS_MOBILE ? 0.00013 : 0.000085)

  return scene
}

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: !IS_MOBILE,
    powerPreference: 'high-performance',
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, IS_MOBILE ? 1.5 : 2))
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.shadowMap.enabled = false // 全场景关阴影
  // ACES 柔化高光：白墙风格下没有它，亮面会直接削平成纯白（视频的"软白"就来自这类滚降）
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.12
  return renderer
}

export function createCamera() {
  const cam = new THREE.PerspectiveCamera(
    50,
    window.innerWidth / window.innerHeight,
    5,
    60000
  )
  cam.position.set(0, 1400, 2200)
  return cam
}

export function createLights(scene) {
  // 半球光：天空色 + 地面色，便宜且能给出自然的户外感
  const hemi = new THREE.HemisphereLight(0xbdd3e8, PALETTE.ground, 2.2)
  scene.add(hemi)

  // 主方向光：太阳
  const sun = new THREE.DirectionalLight(0xfff2dc, 2.6)
  sun.position.set(-1800, 2600, 1400)
  scene.add(sun)

  // 补光：从反方向压一点，避免暗面死黑
  const fill = new THREE.DirectionalLight(0x9fb8d0, 0.85)
  fill.position.set(1600, 900, -1800)
  scene.add(fill)

  return { hemi, sun, fill }
}

export function handleResize(renderer, camera) {
  const onResize = () => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
  }
  window.addEventListener('resize', onResize)
  return onResize
}
