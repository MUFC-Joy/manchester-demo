/**
 * tour.js — 相机飞行叙事（方案 §6.7）
 *
 * 本质：CatmullRomCurve3 位置曲线 + lookAt 目标曲线 + 时长表。
 * 三样全是数据表，改分镜只改表不改代码。
 *
 * 分镜（方案 §5-P4）：
 *   1. 高空开场，缓缓压向城市天际线
 *   2. 沿 Ship Canal 飞向老特拉福德，绕场一周（红座椅海）
 *   3. 沿 Metrolink 线穿过市中心
 *   4. 抵达伊蒂哈德，绕场一周（蓝座椅海）
 *   5. 拉升至全城鸟瞰，双雄传奇墙，"THIS IS MANCHESTER"
 */

import * as THREE from 'three'
import { ll2xy, OT, ETIHAD } from '../core/geo.js'

const OT_XY = ll2xy(OT.lat, OT.lon)
const ET_XY = ll2xy(ETIHAD.lat, ETIHAD.lon)

const CITY = (() => {
  // 市中心（Piccadilly 一带）
  const { x, z } = ll2xy(53.4794, -2.2298)
  return { x, z }
})()

/**
 * 位置曲线关键点
 * 绕场用三点近似半圈：切向进入 → 侧向 → 背向离开
 */
const CAM_POINTS = [
  [2200, 3400, 2700], // 1. 高空开场
  [1200, 1900, 2000], //    下压
  [200, 1100, 1650], //    继续压向天际线
  [-900, 800, 1500], // 2. 转向西南，沿运河
  [-1900, 520, 1420], //    运河沿线
  [-2650, 300, 1150], //    抵近老特拉福德
  [OT_XY.x + 430, 190, OT_XY.z + 380], //    绕场：切向
  [OT_XY.x - 430, 175, OT_XY.z + 330], //    侧向
  [OT_XY.x - 400, 165, OT_XY.z - 400], //    背向
  [-2400, 480, 500], // 3. 离开，向市中心
  [CITY.x - 300, 620, CITY.z + 420], //    Metrolink 走廊
  [CITY.x + 350, 560, CITY.z - 350], //    穿过市中心
  [1900, 480, -850], // 4. 转向伊蒂哈德
  [ET_XY.x - 400, 170, ET_XY.z - 430], //    抵近
  [ET_XY.x + 440, 175, ET_XY.z - 320], //    绕场：侧向
  [ET_XY.x + 380, 165, ET_XY.z + 420], //    背向
  [1600, 1900, 700], // 5. 拉升
  [300, 3700, 2500], //    全城鸟瞰
].map(([x, y, z]) => new THREE.Vector3(x, y, z))

/** 与位置点一一对应的注视目标 */
const LOOK_POINTS = [
  [0, 0, 0],
  [0, 0, 0],
  [0, 0, 0],
  [OT_XY.x, 20, OT_XY.z],
  [OT_XY.x, 20, OT_XY.z],
  [OT_XY.x, 20, OT_XY.z],
  [OT_XY.x, 18, OT_XY.z],
  [OT_XY.x, 18, OT_XY.z],
  [OT_XY.x, 18, OT_XY.z],
  [OT_XY.x, 20, OT_XY.z],
  [CITY.x, 20, CITY.z],
  [CITY.x, 20, CITY.z],
  [ET_XY.x, 20, ET_XY.z],
  [ET_XY.x, 18, ET_XY.z],
  [ET_XY.x, 18, ET_XY.z],
  [ET_XY.x, 18, ET_XY.z],
  [ET_XY.x, 30, ET_XY.z],
  [(OT_XY.x + ET_XY.x) / 2, 0, (OT_XY.z + ET_XY.z) / 2],
].map(([x, y, z]) => new THREE.Vector3(x, y, z))

/**
 * 章节表：index 为 CAM_POINTS 里的关键点序号，用于显示章节字幕。
 * parts 里 hl:true 的片段会以参考视频同款的高亮色渲染。
 */
export const CHAPTERS = [
  {
    at: 0,
    parts: [{ t: '从高空俯瞰这座' }, { t: '真实坐标上的方块城', hl: true }],
  },
  {
    at: 3,
    parts: [{ t: '沿运河飞向' }, { t: '老特拉福德', hl: true }],
  },
  {
    at: 6,
    parts: [{ t: '梦剧场 · ' }, { t: '红色座椅海', hl: true }],
  },
  {
    at: 9,
    parts: [{ t: '穿过' }, { t: '市中心', hl: true }, { t: '的走廊' }],
  },
  {
    at: 12,
    parts: [{ t: '伊蒂哈德 · ' }, { t: '蓝色座椅海', hl: true }],
  },
  {
    at: 16,
    parts: [{ t: 'THIS IS ' }, { t: 'MANCHESTER', hl: true }],
  },
]

const camCurve = new THREE.CatmullRomCurve3(CAM_POINTS, false, 'centripetal', 0.5)
const lookCurve = new THREE.CatmullRomCurve3(LOOK_POINTS, false, 'centripetal', 0.5)

export const TOUR_DURATION = 78 // 秒
export const TOUR_SPEEDS = [0.5, 1, 1.5, 2]

export function createTour(camera, controls, { onChapter, onFinish } = {}) {
  let playing = false
  let t = 0
  let chapterIdx = -1
  let speed = 1 // 倍速（v2 问题六）

  /** 把相机摆到参数 t（0~1）对应的位置（位置/目标都按缓动曲线取） */
  function placeAt(tRaw) {
    const e = tRaw < 0.5 ? 2 * tRaw * tRaw : 1 - Math.pow(-2 * tRaw + 2, 2) / 2
    camera.position.copy(camCurve.getPointAt(Math.min(1, Math.max(0, e))))
    controls.target.copy(lookCurve.getPointAt(Math.min(1, Math.max(0, e))))
    controls.update()
  }

  const start = (fromT = 0) => {
    playing = true
    t = Math.min(0.999, Math.max(0, fromT))
    chapterIdx = -1
    controls.enabled = false
    placeAt(t)
  }

  const stop = () => {
    if (!playing) return
    playing = false
    controls.enabled = true
    onFinish?.()
  }

  /** 点击进度条跳转：t ∈ [0,1] */
  const seek = (t01) => {
    if (!playing) return
    t = Math.min(0.999, Math.max(0, t01))
    chapterIdx = -1 // 强制重发当前章节字幕
    placeAt(t)
  }

  /** 上一章 / 下一章：跳到章节起点（dir = -1 | 1） */
  const chapterJump = (dir) => {
    if (!playing) return
    const n = CAM_POINTS.length - 1
    let idx = 0
    for (let i = CHAPTERS.length - 1; i >= 0; i--) {
      if (t >= CHAPTERS[i].at / n) {
        idx = i
        break
      }
    }
    // 前进：跳到下一章；后退：若已离开本章开头较多，先回本章开头
    let target = idx
    if (dir > 0) target = Math.min(CHAPTERS.length - 1, idx + 1)
    else if (t - CHAPTERS[idx].at / n > 0.02) target = idx
    else target = Math.max(0, idx - 1)

    t = CHAPTERS[target].at / n + 0.001
    chapterIdx = -1
    placeAt(t)
  }

  /**
   * 每帧调用。返回当前章节名（或 null）。
   * 用户拖动鼠标 = 立刻中断 Tour，别跟用户抢相机（方案 §6.7）
   */
  function update(dt, userInteracted) {
    if (userInteracted && playing) {
      stop()
      return null
    }
    if (!playing) return null

    t += (dt * speed) / TOUR_DURATION

    if (t >= 1) {
      stop()
      // 收尾定格在全城鸟瞰
      camera.position.copy(camCurve.getPointAt(1))
      controls.target.copy(lookCurve.getPointAt(1))
      controls.update()
      onChapter?.(CHAPTERS[CHAPTERS.length - 1].parts)
      return CHAPTERS[CHAPTERS.length - 1]
    }

    placeAt(t)

    // 章节字幕
    for (let i = CHAPTERS.length - 1; i >= 0; i--) {
      if (t >= CHAPTERS[i].at / (CAM_POINTS.length - 1)) {
        if (chapterIdx !== i) {
          chapterIdx = i
          onChapter?.(CHAPTERS[i].parts)
        }
        return CHAPTERS[i]
      }
    }
    return null
  }

  return {
    start,
    stop,
    update,
    seek,
    chapterJump,
    setSpeed(s) {
      speed = s
    },
    get speed() {
      return speed
    },
    get playing() {
      return playing
    },
    get progress() {
      return Math.min(1, t)
    },
  }
}

/** Tour 用完要把控制权还给用户时，把 target 归位到当前注视点 */
export function syncControlsToCamera(controls, camera) {
  const dir = new THREE.Vector3()
  camera.getWorldDirection(dir)
  controls.target.copy(camera.position).addScaledVector(dir, 300)
  controls.update()
}
