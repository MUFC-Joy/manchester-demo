/**
 * materials.js — 全项目共享色板与材质
 *
 * 风格统一的锚点（方案 §6.4）：色板做成常量集中管理。
 * 风格基准 = 参考视频的"白色建筑模型"风：白天亮白墙体 + 窗格 + 浅色地面，
 * 夜晚暖黄窗光全亮。方块风不需要 PBR，MeshLambertMaterial 足够。
 */

import * as THREE from 'three'

export const PALETTE = {
  // 地面与铺装（浅色"模型底座"，视频同款）
  ground: '#d4d1c8',
  groundGrid: '#c2beb2',

  // 道路分级（主干 / 次干 / 支路）——支路提亮一档，和主干拉开层次（v2 问题八）
  road: ['#42454a', '#4b4e54', '#5a5d63'],
  rail: '#78787e',

  // 水系（加深压暗贴近真实观感，夜晚由昼夜系统压得更深，v2 问题八）
  water: '#4380a6',
  waterway: '#4380a6',
  waterBank: '#c9c3b4', // 河道岸线描边

  // 绿地（新鲜草绿）
  green: ['#7fb069', '#8fbe77'],
  pitch: '#589a41',

  // 建筑（白 / 米 / 浅灰 / 奶油 / 淡青灰，k 为 buildingClass 返回值）
  building: ['#f6f3ed', '#eae4d9', '#dedbd5', '#f0e9dc', '#d8ddd3'],

  // 球场
  standConcrete: '#b8b2a8',
  standRoof: '#8a847a',
  // 座椅提亮加饱和，远景读得出座椅海（v2 问题四）
  seatOT: '#d84a38',
  seatEtihad: '#5aa8f0',
  pitchStripeA: '#37612a',
  pitchStripeB: '#4e8c3b',
  pitchLine: '#dfe6df',
  goalPost: '#e8e8e8',

  // 天空 / 雾（白天亮蓝，具体随昼夜插值）
  sky: '#92c6e8',
  fog: '#eef5f9',
}

/** 窗格纹理的世界尺寸：一格 = 6m 宽 × 3m 高（4×4 窗为一整块 tile） */
export const WINDOW_TILE_W = 24
export const WINDOW_TILE_H = 12

/** 屋顶取样点：落在窗格贴图的墙面上（白天=白墙，夜晚=黑，屋顶不发光） */
export const ROOF_UV = { x: 0.0156, y: 0.0156 }

/**
 * 程序化窗格贴图：白天 map（白墙+玻璃格）与夜晚 emissiveMap（黑墙+暖亮格）。
 * 两张图窗口位置一致，昼夜切换时窗格"亮起来"而不是换位置。
 * 部分窗户夜晚不亮（约 38%），是夜城真实感的关键。
 */
function makeWindowTextures() {
  const SIZE = 256
  const CELL = 64 // 4×4 窗

  // 确定性随机，保证每次构建完全一致
  let s = 20260415
  const rand = () => {
    s ^= s << 13
    s >>>= 0
    s ^= s >> 17
    s ^= s << 5
    s >>>= 0
    return s / 4294967296
  }

  const day = document.createElement('canvas')
  const glow = document.createElement('canvas')
  day.width = day.height = glow.width = glow.height = SIZE
  const dctx = day.getContext('2d')
  const gctx = glow.getContext('2d')

  // 墙体：白天纯白（乘建筑顶点色成各楼色差）；夜晚全黑
  dctx.fillStyle = '#ffffff'
  dctx.fillRect(0, 0, SIZE, SIZE)
  gctx.fillStyle = '#000000'
  gctx.fillRect(0, 0, SIZE, SIZE)

  // 窗洞在 cell 内留 14/12px 墙沿，保证 (0.0156,0.0156) 附近是墙
  const glassShades = ['#8d979e', '#7c8890', '#98a2a9']
  for (let cy = 0; cy < 4; cy++) {
    for (let cx = 0; cx < 4; cx++) {
      const x = cx * CELL + 14
      const y = cy * CELL + 12
      const w = CELL - 28
      const h = CELL - 26

      dctx.fillStyle = glassShades[(cx * 4 + cy) % 3]
      dctx.fillRect(x, y, w, h)
      // 玻璃上沿一条浅色反光
      dctx.fillStyle = 'rgba(255,255,255,0.35)'
      dctx.fillRect(x, y, w, 4)

      if (rand() < 0.62) {
        // 亮窗：暖黄，中心更亮，模拟室内灯
        gctx.fillStyle = '#ffb95e'
        gctx.fillRect(x, y, w, h)
        gctx.fillStyle = '#ffe2a6'
        gctx.fillRect(x + 3, y + 3, w - 6, h - 6)
      } else if (rand() < 0.35) {
        // 微光窗（比黑亮一点，夜里读得出"有人没开灯"）
        gctx.fillStyle = '#4a3418'
        gctx.fillRect(x, y, w, h)
      }
      // 其余保持全黑 = 熄灯窗
    }
  }

  const dayTex = new THREE.CanvasTexture(day)
  const glowTex = new THREE.CanvasTexture(glow)
  for (const t of [dayTex, glowTex]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.magFilter = THREE.NearestFilter // 窗格边缘锐利，保持方块感
    // 斜视角远处的摩尔纹（看起来像马赛克）= 缺各向异性过滤（v2 问题七）；
    // 16 = 桌面 GPU 的常见上限，斜视角窗格比 8 再清晰一档
    t.anisotropy = 16
    t.repeat.set(1 / WINDOW_TILE_W, 1 / WINDOW_TILE_H) // uv 单位 = 米
    t.colorSpace = THREE.SRGBColorSpace
  }
  return { dayTex, glowTex }
}

/** 建筑高度越高越亮（很轻的分层，白墙风格下压暗太多会显脏） */
export function buildingColor(k, height, maxHeight = 60) {
  const base = new THREE.Color(PALETTE.building[k % PALETTE.building.length] ?? PALETTE.building[1])
  const t = Math.min(1, height / maxHeight)
  base.multiplyScalar(0.88 + t * 0.12)
  return base
}

/**
 * 建筑共用材质：顶点色（每楼色差）× 窗格贴图（世界坐标对齐）。
 * 夜晚由昼夜系统拉起 emissiveIntensity，窗格整体"亮灯"。
 */
let buildingMat = null
export function getBuildingMaterial() {
  if (!buildingMat) {
    const { dayTex, glowTex } = makeWindowTextures()
    buildingMat = new THREE.MeshLambertMaterial({
      vertexColors: true,
      map: dayTex,
      emissive: new THREE.Color('#ffd9a0'),
      emissiveMap: glowTex,
      emissiveIntensity: 0, // 白天不发光，昼夜系统控制
      flatShading: true,
    })
  }
  return buildingMat
}

/** 统一的顶点色 Lambert 材质（道路/绿地/水面等静态几何共用） */
let vertexColorMat = null
export function getVertexColorMaterial() {
  if (!vertexColorMat) {
    vertexColorMat = new THREE.MeshLambertMaterial({
      vertexColors: true,
      flatShading: true,
    })
  }
  return vertexColorMat
}

/** 水面材质：轻微自发光，颜色由昼夜系统在亮蓝/深蓝间插值 */
let waterMat = null
export function getWaterMaterial() {
  if (!waterMat) {
    waterMat = new THREE.MeshLambertMaterial({
      color: PALETTE.water,
      emissive: new THREE.Color('#2c4a5e'),
      emissiveIntensity: 0.14,
      flatShading: true,
    })
  }
  return waterMat
}

/** 给几何体刷上统一顶点色 */
export function paintGeometry(geo, color) {
  const n = geo.attributes.position.count
  const arr = new Float32Array(n * 3)
  const c = color instanceof THREE.Color ? color : new THREE.Color(color)
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r
    arr[i * 3 + 1] = c.g
    arr[i * 3 + 2] = c.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3))
  return geo
}

/** 清理合并前不需要的属性，保证所有几何属性集一致（uv 保留——建筑窗格贴图依赖它） */
export function normalizeForMerge(geo) {
  geo.deleteAttribute('uv1')
  geo.deleteAttribute('uv2')
  if (geo.groups) geo.clearGroups()
  if (!geo.attributes.normal) geo.computeVertexNormals()
  return geo
}
