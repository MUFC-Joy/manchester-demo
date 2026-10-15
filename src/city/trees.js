/**
 * trees.js — 行道树 + 公园树（风格对齐参考视频：街道两侧的行道树是
 * "城市模型感"的最大单一增量，成本 = 2 个 InstancedMesh）
 *
 * 位置规则：
 *   - 主干/次干道两侧按间距撒树（不进路面）
 *   - 公园/绿地多边形内按面积密度撒树
 *   - 建筑包围盒内一票否决（空间哈希网格加速）
 *   - 远离可视核心（两球场 + 走廊 + 市中心）的树直接砍，省三角形
 */

import * as THREE from 'three'
import { ROAD_WIDTH } from './roads.js'
import { ll2xy, OT, ETIHAD } from '../core/geo.js'

const OT_XY = ll2xy(OT.lat, OT.lon)
const ET_XY = ll2xy(ETIHAD.lat, ETIHAD.lon)
const MID_XY = { x: (OT_XY.x + ET_XY.x) / 2, z: (OT_XY.z + ET_XY.z) / 2 }

const CELL = 100 // 建筑包围盒空间哈希的格边长

/** 建筑包围盒空间哈希：给树/路灯做"别长在楼里"检测 */
export function createBuildingGrid(buildings) {
  const grid = new Map()

  for (const b of buildings) {
    let minX = Infinity
    let maxX = -Infinity
    let minZ = Infinity
    let maxZ = -Infinity
    for (let i = 0; i < b.p.length; i += 2) {
      if (b.p[i] < minX) minX = b.p[i]
      if (b.p[i] > maxX) maxX = b.p[i]
      if (b.p[i + 1] < minZ) minZ = b.p[i + 1]
      if (b.p[i + 1] > maxZ) maxZ = b.p[i + 1]
    }
    const box = { minX, maxX, minZ, maxZ }
    const x0 = Math.floor(minX / CELL)
    const x1 = Math.floor(maxX / CELL)
    const z0 = Math.floor(minZ / CELL)
    const z1 = Math.floor(maxZ / CELL)
    for (let gx = x0; gx <= x1; gx++) {
      for (let gz = z0; gz <= z1; gz++) {
        const key = gx * 100000 + gz
        let list = grid.get(key)
        if (!list) grid.set(key, (list = []))
        list.push(box)
      }
    }
  }

  return {
    /** 点（外扩 pad 米）是否落在任一建筑包围盒内 */
    hits(x, z, pad = 2.5) {
      const gx = Math.floor(x / CELL)
      const gz = Math.floor(z / CELL)
      for (let ix = gx - 1; ix <= gx + 1; ix++) {
        for (let iz = gz - 1; iz <= gz + 1; iz++) {
          const list = grid.get(ix * 100000 + iz)
          if (!list) continue
          for (const b of list) {
            if (x > b.minX - pad && x < b.maxX + pad && z > b.minZ - pad && z < b.maxZ + pad) {
              return true
            }
          }
        }
      }
      return false
    },
  }
}

/** 确定性随机（可复现） */
function mulberry32(seed) {
  let s = seed >>> 0
  return function () {
    s ^= s << 13
    s >>>= 0
    s ^= s >> 17
    s ^= s << 5
    s >>>= 0
    return s / 4294967296
  }
}

function polygonArea(flat) {
  let a = 0
  const n = flat.length / 2
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    a += flat[i * 2] * flat[j * 2 + 1] - flat[j * 2] * flat[i * 2 + 1]
  }
  return Math.abs(a / 2)
}

function pointInPolygon(x, z, flat) {
  let inside = false
  const n = flat.length / 2
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = flat[i * 2]
    const zi = flat[i * 2 + 1]
    const xj = flat[j * 2]
    const zj = flat[j * 2 + 1]
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) {
      inside = !inside
    }
  }
  return inside
}

const MAX_TREES = 1800

export function createTrees({ buildings, roads, green, grid }) {
  const rand = mulberry32(424242)

  // ── 收集候选点 ──
  const candidates = []

  // 1. 行道树：沿主干/次干道，间距撒，交替两侧
  for (const r of roads ?? []) {
    const k = Math.min(r.k ?? 2, 2)
    if (k > 1) continue
    const step = k === 0 ? 70 : 110
    const offset = ROAD_WIDTH[k] * 0.5 + 2.6
    const flat = r.p
    let carry = rand() * step

    for (let i = 0; i < flat.length / 2 - 1; i++) {
      const x1 = flat[i * 2]
      const z1 = flat[i * 2 + 1]
      const x2 = flat[i * 2 + 2]
      const z2 = flat[i * 2 + 3]
      const dx = x2 - x1
      const dz = z2 - z1
      const len = Math.hypot(dx, dz)
      if (len < 1) continue
      const ux = dx / len
      const uz = dz / len

      let s = carry
      while (s <= len) {
        const side = candidates.length % 2 === 0 ? 1 : -1
        candidates.push({
          x: x1 + ux * s - uz * offset * side,
          z: z1 + uz * s + ux * offset * side,
        })
        s += step
      }
      carry = s - len
    }
  }

  // 2. 公园树：绿地多边形内按面积撒
  for (const g of green ?? []) {
    if (g.k === 1) continue // 球场草坪不种树
    const area = polygonArea(g.p)
    const n = Math.min(60, Math.floor(area / 1600))
    if (n < 1) continue

    let minX = Infinity
    let maxX = -Infinity
    let minZ = Infinity
    let maxZ = -Infinity
    for (let i = 0; i < g.p.length; i += 2) {
      if (g.p[i] < minX) minX = g.p[i]
      if (g.p[i] > maxX) maxX = g.p[i]
      if (g.p[i + 1] < minZ) minZ = g.p[i + 1]
      if (g.p[i + 1] > maxZ) maxZ = g.p[i + 1]
    }

    let placed = 0
    let tries = 0
    while (placed < n && tries < n * 8) {
      tries++
      const x = minX + rand() * (maxX - minX)
      const z = minZ + rand() * (maxZ - minZ)
      if (!pointInPolygon(x, z, g.p)) continue
      candidates.push({ x, z })
      placed++
    }
  }

  // ── 过滤：别长在楼里 / 别太远 ──
  // 可视核心：两球场 3.4km + 走廊中点 2.8km（再远的树相机基本看不到）
  const core = (x, z) =>
    Math.hypot(x - OT_XY.x, z - OT_XY.z) < 3400 ||
    Math.hypot(x - ET_XY.x, z - ET_XY.z) < 3400 ||
    Math.hypot(x - MID_XY.x, z - MID_XY.z) < 2800

  const spots = []
  for (const c of candidates) {
    if (spots.length >= MAX_TREES) break
    if (!core(c.x, c.z)) continue
    if (grid.hits(c.x, c.z, 2)) continue
    spots.push(c)
  }

  // ── 两层 InstancedMesh：树干 + 树冠（树冠逐实例变色） ──
  const count = spots.length
  const trunkGeo = new THREE.CylinderGeometry(0.32, 0.5, 2.6, 5, 1, true)
  trunkGeo.translate(0, 1.3, 0)
  const canopyGeo = new THREE.IcosahedronGeometry(2.4, 0)
  canopyGeo.translate(0, 4.1, 0)

  const trunkMat = new THREE.MeshLambertMaterial({
    color: '#7a5c42',
    flatShading: true,
  })
  const canopyMat = new THREE.MeshLambertMaterial({ flatShading: true })

  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, count)
  const canopies = new THREE.InstancedMesh(canopyGeo, canopyMat, count)
  trunks.name = 'tree-trunks'
  canopies.name = 'tree-canopies'
  trunks.frustumCulled = false // 实例散布全城，默认包围球在原点会被整体剔除
  canopies.frustumCulled = false

  const greens = ['#679a4c', '#74a954', '#7fb15e', '#5f8f45', '#8cbb66'].map(
    (c) => new THREE.Color(c)
  )
  const dummy = new THREE.Object3D()
  for (let i = 0; i < count; i++) {
    const s = 0.75 + rand() * 0.55
    const stretch = 0.9 + rand() * 0.35
    dummy.position.set(spots[i].x, 0, spots[i].z)
    dummy.rotation.set(0, rand() * Math.PI * 2, 0)
    dummy.scale.set(s, s * stretch, s)
    dummy.updateMatrix()
    trunks.setMatrixAt(i, dummy.matrix)
    canopies.setMatrixAt(i, dummy.matrix)
    canopies.setColorAt(i, greens[Math.floor(rand() * greens.length)])
  }
  trunks.instanceMatrix.needsUpdate = true
  canopies.instanceMatrix.needsUpdate = true
  canopies.instanceColor.needsUpdate = true

  const group = new THREE.Group()
  group.name = 'trees'
  group.add(trunks, canopies)
  group.userData.count = count
  return group
}
