/**
 * roads.js — 道路 / 铁路（方案 §6.3 分层）
 *
 * 折线 → 水平带状几何。每条带子是两个三角形，全部合并成 1 个 draw call。
 * 主干道额外铺白色中心虚线（独立合并网格，1 个 draw call）。
 */

import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import {
  PALETTE,
  getVertexColorMaterial,
  normalizeForMerge,
} from '../core/materials.js'

export const ROAD_WIDTH = [14, 9, 5] // 主干 / 次干 / 支路，米
const ROAD_Y = 1.0 // 略高于地面，避免 z-fighting
const DASH_Y = 1.08 // 虚线略高于路面
const RAIL_WIDTH = 3.4
const RAIL_Y = 1.6

/**
 * 道格拉斯-普克简化（渲染前跑，与数据管线的 1.5m 简化解耦）。
 * OSM 道路折线非常密，road-2 原始就占 17.5 万三角形；
 * 容差取 4.5m（远小于最窄路宽 5m），视觉无损，面数砍半以上。
 */
function dpSimplify(flat, tolerance) {
  const n = flat.length / 2
  if (n < 3) return flat

  const keep = new Uint8Array(n)
  keep[0] = keep[n - 1] = 1
  const stack = [[0, n - 1]]

  while (stack.length) {
    const [s, e] = stack.pop()
    if (e - s < 2) continue

    const ax = flat[s * 2]
    const az = flat[s * 2 + 1]
    const bx = flat[e * 2]
    const bz = flat[e * 2 + 1]
    const dx = bx - ax
    const dz = bz - az
    const lenSq = dx * dx + dz * dz

    let maxDist = -1
    let maxIdx = -1
    for (let i = s + 1; i < e; i++) {
      const px = flat[i * 2]
      const pz = flat[i * 2 + 1]
      let d
      if (lenSq === 0) {
        d = Math.hypot(px - ax, pz - az)
      } else {
        const t = ((px - ax) * dx + (pz - az) * dz) / lenSq
        const tt = t < 0 ? 0 : t > 1 ? 1 : t
        d = Math.hypot(px - (ax + tt * dx), pz - (az + tt * dz))
      }
      if (d > maxDist) {
        maxDist = d
        maxIdx = i
      }
    }

    if (maxDist > tolerance) {
      keep[maxIdx] = 1
      stack.push([s, maxIdx], [maxIdx, e])
    }
  }

  const out = []
  for (let i = 0; i < n; i++) {
    if (keep[i]) out.push(flat[i * 2], flat[i * 2 + 1])
  }
  return out
}

/** 折线 → 水平带状几何（法线朝上） */
function ribbonGeometry(flat, width, y) {
  const positions = []
  const n = flat.length / 2
  const hw = width * 0.5

  for (let i = 0; i < n - 1; i++) {
    const x1 = flat[i * 2]
    const z1 = flat[i * 2 + 1]
    const x2 = flat[i * 2 + 2]
    const z2 = flat[i * 2 + 3]

    const dx = x2 - x1
    const dz = z2 - z1
    const len = Math.hypot(dx, dz)
    if (len < 0.5) continue

    const nx = (-dz / len) * hw
    const nz = (dx / len) * hw

    // A=x1+n, B=x1-n, C=x2+n, D=x2-n
    const axx = x1 + nx
    const azz = z1 + nz
    const bxx = x1 - nx
    const bzz = z1 - nz
    const cxx = x2 + nx
    const czz = z2 + nz
    const dxx = x2 - nx
    const dzz = z2 - nz

    // 绕序 A→C→B 保证法线朝上
    positions.push(axx, y, azz, cxx, y, czz, bxx, y, bzz)
    positions.push(bxx, y, bzz, cxx, y, czz, dxx, y, dzz)
  }

  if (!positions.length) return null

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.computeVertexNormals()
  return geo
}

/**
 * 主干道中心虚线：沿折线每 10m 铺一段 3.5m × 0.7m 的白色小条。
 * 只有主干道（k=0）铺，次干道以上帝视角看是干净的灰带。
 */
function dashGeometry(flat) {
  const positions = []
  const n = flat.length / 2
  const DW = 0.35 // 半宽
  const DASH = 3.5
  const GAP = 14

  let carry = 0
  for (let i = 0; i < n - 1; i++) {
    const x1 = flat[i * 2]
    const z1 = flat[i * 2 + 1]
    const x2 = flat[i * 2 + 2]
    const z2 = flat[i * 2 + 3]
    const dx = x2 - x1
    const dz = z2 - z1
    const len = Math.hypot(dx, dz)
    if (len < 0.5) continue

    const ux = dx / len
    const uz = dz / len
    const nx = -uz * DW
    const nz = ux * DW

    let s = carry
    while (s + DASH <= len) {
      const sx = x1 + ux * s
      const sz = z1 + uz * s
      const ex = x1 + ux * (s + DASH)
      const ez = z1 + uz * (s + DASH)
      // 虚线四边形（两三角）
      positions.push(
        sx + nx, DASH_Y, sz + nz,
        ex + nx, DASH_Y, ez + nz,
        sx - nx, DASH_Y, sz - nz,
        sx - nx, DASH_Y, sz - nz,
        ex + nx, DASH_Y, ez + nz,
        ex - nx, DASH_Y, ez - nz
      )
      s += GAP
    }
    carry = s - len
  }

  if (!positions.length) return null
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.computeVertexNormals()
  return geo
}

function mergeAndAdd(group, geos, name, colorHex, material) {
  if (!geos.length) return 0
  const merged = mergeGeometries(geos, false)
  if (!merged) {
    console.warn(`[roads] ${name} 合并失败`)
    return 0
  }
  // 统一刷色
  const c = new THREE.Color(colorHex)
  const cnt = merged.attributes.position.count
  const arr = new Float32Array(cnt * 3)
  for (let i = 0; i < cnt; i++) {
    arr[i * 3] = c.r
    arr[i * 3 + 1] = c.g
    arr[i * 3 + 2] = c.b
  }
  merged.setAttribute('color', new THREE.BufferAttribute(arr, 3))
  merged.computeBoundingSphere()

  const mesh = new THREE.Mesh(merged, material)
  mesh.name = name
  mesh.matrixAutoUpdate = false
  group.add(mesh)

  for (const g of geos) g.dispose()
  return cnt / 3
}

export function createRoads(roads, rails) {
  const group = new THREE.Group()
  group.name = 'roads'
  const mat = getVertexColorMaterial()

  const byClass = [[], [], []]
  const dashGeos = []
  let triangles = 0

  for (const r of roads) {
    const k = Math.min(r.k ?? 2, 2)
    // 主干道保留更多细节（虚线沿它铺），次干/支路简化更狠
    const flat = dpSimplify(r.p, k === 0 ? 2.5 : 4.5)
    const geo = ribbonGeometry(flat, ROAD_WIDTH[k], ROAD_Y)
    if (geo) {
      normalizeForMerge(geo)
      byClass[k].push(geo)
      if (k === 0) {
        const dash = dashGeometry(flat)
        if (dash) {
          normalizeForMerge(dash)
          dashGeos.push(dash)
        }
      }
    }
  }

  for (let k = 0; k < 3; k++) {
    triangles += mergeAndAdd(group, byClass[k], `road-${k}`, PALETTE.road[k], mat)
  }
  triangles += mergeAndAdd(group, dashGeos, 'road-dashes', '#f2f2ee', mat)

  // 铁路
  const railGeos = []
  for (const r of rails ?? []) {
    const geo = ribbonGeometry(r.p, RAIL_WIDTH, RAIL_Y)
    if (geo) {
      normalizeForMerge(geo)
      railGeos.push(geo)
    }
  }
  triangles += mergeAndAdd(group, railGeos, 'rail', PALETTE.rail, mat)

  group.userData.triangles = triangles
  return group
}
