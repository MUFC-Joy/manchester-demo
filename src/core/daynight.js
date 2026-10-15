/**
 * daynight.js — 昼夜切换（方案 §6.6）
 *
 * 两套预烘焙状态 + 2s lerp 过渡，不做实时太阳系统。
 * 默认态 = 当前已验证的色调（偏阴郁的灰蓝，方块城很有质感）。
 * 夜间态 = 压暗 + 天空/雾转深蓝 + 城市窗光 + 球场灯塔亮起。
 */

import * as THREE from 'three'
import { PALETTE } from './materials.js'

export const DAY = {
  sky: '#1b2430',
  fog: '#1b2430',
  fogDensity: 0.000085,
  hemi: 2.2,
  sun: 2.6,
  fill: 0.85,
  windows: 0, // 窗光透明度
}

export const NIGHT = {
  sky: '#0a1018',
  fog: '#0a1018',
  fogDensity: 0.00021,
  hemi: 0.55,
  sun: 0.18,
  fill: 0.3,
  windows: 1,
}

const _c1 = new THREE.Color()
const _c2 = new THREE.Color()

export function createDayNight(scene, lights, renderer) {
  const state = { night: 0, target: 0 }
  let windowMesh = null

  const skyMat = scene.background instanceof THREE.Color ? null : null

  function apply(n) {
    const sky = _c1.set(DAY.sky).lerp(_c2.set(NIGHT.sky), n)
    scene.background = sky.clone()
    scene.fog.color = _c1.set(DAY.fog).lerp(_c2.set(NIGHT.fog), n).clone()
    scene.fog.density =
      DAY.fogDensity + (NIGHT.fogDensity - DAY.fogDensity) * n

    lights.hemi.intensity = DAY.hemi + (NIGHT.hemi - DAY.hemi) * n
    lights.sun.intensity = DAY.sun + (NIGHT.sun - DAY.sun) * n
    lights.fill.intensity = DAY.fill + (NIGHT.fill - DAY.fill) * n

    if (windowMesh) {
      windowMesh.material.opacity = n
      windowMesh.visible = n > 0.01
    }
  }

  apply(0)

  return {
    /** 注册窗光图层（city/nightLights.js 产出） */
    registerWindows(mesh) {
      windowMesh = mesh
      windowMesh.material.opacity = 0
      windowMesh.visible = false
    },

    toggle() {
      state.target = state.target > 0.5 ? 0 : 1
    },

    get isNight() {
      return state.target > 0.5
    },

    /** 每帧调用，dt 秒 */
    update(dt) {
      if (Math.abs(state.night - state.target) < 0.001) return
      const dir = Math.sign(state.target - state.night)
      state.night = Math.max(
        0,
        Math.min(1, state.night + dir * dt / 2) // 2 秒过渡
      )
      apply(state.night)
    },
  }
}
