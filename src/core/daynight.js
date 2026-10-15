/**
 * daynight.js — 昼夜切换（方案 §6.6）
 *
 * 两套预烘焙状态 + 2s lerp 过渡，不做实时太阳系统。
 * 白天 = 参考视频同款"白色模型城"：亮蓝天穹、浅色雾、清亮光照。
 * 夜晚 = 深蓝夜空 + 建筑窗格整体亮起 + 路灯光池（由注册表驱动）。
 *
 * 通用插值注册表：其他系统（云/水/路灯/窗格）把"材质属性 + 昼夜两端值"
 * 注册进来，切换时统一插值——新增昼夜联动效果不再需要改本文件的核心逻辑。
 */

import * as THREE from 'three'

export const DAY = {
  sky: '#8ec5e8',
  fog: '#eef5f9',
  fogDensity: 0.00007,
  hemi: 1.2,
  sun: 1.5,
  fill: 0.45,
}

export const NIGHT = {
  sky: '#0a1322',
  fog: '#0a1322',
  fogDensity: 0.00019,
  hemi: 0.22,
  sun: 0.1,
  fill: 0.16,
}

const BUILDING_GLOW = 1.25 // 夜晚窗格自发光强度

export function createDayNight(scene, lights) {
  const state = { night: 0, target: 0 }

  /** 数值/颜色插值条目：{ obj, key, day, night, isColor, alsoVisible } */
  const lerps = []
  /** 天穹重算函数（sky.js 的 setBlend） */
  let domeBlend = null
  /** 建筑材质（窗格 emissiveIntensity） */
  let buildingMat = null

  function apply(n) {
    const sky = new THREE.Color(DAY.sky).lerp(new THREE.Color(NIGHT.sky), n)
    scene.background = sky
    scene.fog.color = new THREE.Color(DAY.fog).lerp(new THREE.Color(NIGHT.fog), n)
    scene.fog.density = DAY.fogDensity + (NIGHT.fogDensity - DAY.fogDensity) * n

    lights.hemi.intensity = DAY.hemi + (NIGHT.hemi - DAY.hemi) * n
    lights.sun.intensity = DAY.sun + (NIGHT.sun - DAY.sun) * n
    lights.fill.intensity = DAY.fill + (NIGHT.fill - DAY.fill) * n

    if (buildingMat) {
      buildingMat.emissiveIntensity = BUILDING_GLOW * n
    }

    for (const e of lerps) {
      if (e.isColor) {
        e.obj[e.key].lerpColors(e.day, e.night, n)
      } else {
        const v = e.day + (e.night - e.day) * n
        e.obj[e.key] = v
        if (e.alsoVisible) e.obj.visible = v > 0.015
      }
    }

    domeBlend?.(n)
  }

  apply(0)

  return {
    /** 注册建筑材质（窗格夜晚亮起） */
    registerWindows(mat) {
      buildingMat = mat
    },

    /**
     * 注册一个昼夜插值：n=0 取 day，n=1 取 night。
     * 颜色传 THREE.Color，数值传 number；alsoVisible = 顺带控制 obj.visible。
     */
    registerLerp(obj, key, day, night, alsoVisible = false) {
      lerps.push({
        obj,
        key,
        day,
        night,
        isColor: day?.isColor === true,
        alsoVisible,
      })
    },

    /** 注册天穹混合函数（sky.js） */
    registerDome(fn) {
      domeBlend = fn
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
        Math.min(1, state.night + (dir * dt) / 2) // 2 秒过渡
      )
      apply(state.night)
    },
  }
}
