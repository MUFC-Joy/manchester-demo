/**
 * roads.js — 道路 / 铁路（方案 §6.3 分层）
 *
 * 折线 → 水平带状几何。每条带子是两个三角形，全部合并成 1 个 draw call。
 */

import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import {
  PALETTE,
  getVertexColorMaterial,
  normalizeForMerge,
} from '../core/materials.js'

const ROAD_WIDTH = [14, 9, 5] // 主干 / 次干 / 支路，米
const ROAD_Y = 1.0 // 略高于地面，避免 z-fighting
const RAIL_WIDTH = 3.4
const RAIL_Y = 1.6

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
    const ax = x1 + nx
    const az = z1 + nz
    const bx = x1 - nx
    const bz = z1 - nz
    const cx = x2 + nx
    const cz = z2 + nz
    const ddx = x2 - nx
    const ddz = z2 - nz

    // 绕序 A→C→B 保证法线朝上
    positions.push(ax, y, az, cx, y, cz, bx, y, bz)
    positions.push(bx, y, bz, cx, y, cz, ddx, y, ddz)
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
  let triangles = 0

  for (const r of roads) {
    const k = Math.min(r.k ?? 2, 2)
    const geo = ribbonGeometry(r.p, ROAD_WIDTH[k], ROAD_Y)
    if (geo) {
      normalizeForMerge(geo)
      byClass[k].push(geo)
    }
  }

  for (let k = 0; k < 3; k++) {
    triangles += mergeAndAdd(group, byClass[k], `road-${k}`, PALETTE.road[k], mat)
  }

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
