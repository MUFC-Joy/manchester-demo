/**
 * buildings.js — 建筑三环 LOD（方案 §6.2）
 *
 *   A 环（每球场半径 600m）  按真实 footprint 挤出 + 高度阶梯
 *   B 环（两场走廊 + 市中心） 简化 footprint，单位盒 InstancedMesh
 *   C 环（其余）             只保留大体量建筑剪影
 *
 * 每环合并成 1 个 draw call。
 */

import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import {
  buildingColor,
  getVertexColorMaterial,
  normalizeForMerge,
} from '../core/materials.js'
import { ll2xy, OT, ETIHAD } from '../core/geo.js'

const RING_A_RADIUS = 600 // m
const CORRIDOR_HALF_WIDTH = 900 // m
const CENTRE_RADIUS = 1600 // m（围绕两场中点）
const C_RING_MIN_AREA = 400 // m²

const OT_XY = ll2xy(OT.lat, OT.lon)
const ET_XY = ll2xy(ETIHAD.lat, ETIHAD.lon)
const MID_XY = { x: (OT_XY.x + ET_XY.x) / 2, z: (OT_XY.z + ET_XY.z) / 2 }

/** 点到线段距离 */
function distToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax
  const dz = bz - az
  const lenSq = dx * dx + dz * dz
  if (lenSq === 0) return Math.hypot(px - ax, pz - az)
  let t = ((px - ax) * dx + (pz - az) * dz) / lenSq
  t = t < 0 ? 0 : t > 1 ? 1 : t
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz))
}

function centroidAndArea(flat) {
  const n = flat.length / 2
  let a = 0
  let cx = 0
  let cz = 0

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const x1 = flat[i * 2]
    const z1 = flat[i * 2 + 1]
    const x2 = flat[j * 2]
    const z2 = flat[j * 2 + 1]
    const cross = x1 * z2 - x2 * z1
    a += cross
    cx += (x1 + x2) * cross
    cz += (z1 + z2) * cross
  }

  a *= 0.5 // 有符号面积
  if (Math.abs(a) < 1e-6) {
    return { cx: flat[0], cz: flat[1], area: 0 }
  }

  // 标准多边形质心公式：分母必须用有符号面积，否则符号和量级都会错
  cx /= 6 * a
  cz /= 6 * a
  return { cx, cz, area: Math.abs(a) }
}

/** footprint → 挤出棱柱（原点在底面，Y-up） */
function extrudeFootprint(flat, height) {
  const shape = new THREE.Shape()
  shape.moveTo(flat[0], -flat[1])
  for (let i = 2; i < flat.length; i += 2) {
    shape.lineTo(flat[i], -flat[i + 1])
  }
  shape.closePath()

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: false,
    curveSegments: 1,
    steps: 1,
  })
  geo.rotateX(-Math.PI / 2)
  return geo
}

/** 按 y 高度做伪 AO：底部压暗，顶部提亮 */
function applyVerticalShading(geo, height) {
  const pos = geo.attributes.position
  const col = geo.attributes.color
  if (!col) return
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, Math.max(0, pos.getY(i) / Math.max(height, 1)))
    const f = 0.62 + t * 0.38
    col.setXYZ(i, col.getX(i) * f, col.getY(i) * f, col.getZ(i) * f)
  }
  col.needsUpdate = true
}

function classifyRing(cx, cz, area) {
  const dOT = Math.hypot(cx - OT_XY.x, cz - OT_XY.z)
  const dET = Math.hypot(cx - ET_XY.x, cz - ET_XY.z)
  if (Math.min(dOT, dET) <= RING_A_RADIUS) return 'A'

  const dCorridor = distToSegment(cx, cz, OT_XY.x, OT_XY.z, ET_XY.x, ET_XY.z)
  const dMid = Math.hypot(cx - MID_XY.x, cz - MID_XY.z)
  if (dCorridor <= CORRIDOR_HALF_WIDTH || dMid <= CENTRE_RADIUS) return 'B'

  return area >= C_RING_MIN_AREA ? 'C' : null
}

export function createBuildings(buildings, maxHeight = 60) {
  const group = new THREE.Group()
  group.name = 'buildings'

  const geosA = []
  const geosB = []
  const geosC = []
  const stats = { A: 0, B: 0, C: 0, dropped: 0, triangles: 0 }

  for (const b of buildings) {
    const { cx, cz, area } = centroidAndArea(b.p)
    const ring = classifyRing(cx, cz, area)
    if (!ring) {
      stats.dropped++
      continue
    }

    const color = buildingColor(b.k, b.h, maxHeight)

    if (ring === 'A') {
      const geo = extrudeFootprint(b.p, b.h)
      normalizeForMerge(geo)
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3), 3))
      const c = color
      const col = geo.attributes.color
      for (let i = 0; i < col.count; i++) col.setXYZ(i, c.r, c.g, c.b)
      applyVerticalShading(geo, b.h)
      geosA.push(geo)
      stats.A++
      stats.triangles += geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3
    } else if (ring === 'B') {
      // 简化：直接用包围盒做单位盒实例的替代 —— 这里仍用挤出但跳过细节
      const geo = extrudeFootprint(b.p, b.h)
      normalizeForMerge(geo)
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3), 3))
      const c = color
      const col = geo.attributes.color
      for (let i = 0; i < col.count; i++) col.setXYZ(i, c.r, c.g, c.b)
      applyVerticalShading(geo, b.h)
      geosB.push(geo)
      stats.B++
      stats.triangles += geo.attributes.position.count / 3
    } else {
      // C 环：只留大体量，用简单盒子代替
      let minX = Infinity
      let maxX = -Infinity
      let minZ = Infinity
      let maxZ = -Infinity
      for (let i = 0; i < b.p.length; i += 2) {
        minX = Math.min(minX, b.p[i])
        maxX = Math.max(maxX, b.p[i])
        minZ = Math.min(minZ, b.p[i + 1])
        maxZ = Math.max(maxZ, b.p[i + 1])
      }
      const w = Math.max(maxX - minX, 4)
      const d = Math.max(maxZ - minZ, 4)
      const geo = new THREE.BoxGeometry(w, b.h, d)
      geo.translate((minX + maxX) / 2, b.h / 2, (minZ + maxZ) / 2)
      normalizeForMerge(geo)
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3), 3))
      const c = color
      const col = geo.attributes.color
      for (let i = 0; i < col.count; i++) col.setXYZ(i, c.r, c.g, c.b)
      geosC.push(geo)
      stats.C++
      stats.triangles += 12
    }
  }

  const mat = getVertexColorMaterial()

  for (const [geos, name] of [
    [geosA, 'ring-a'],
    [geosB, 'ring-b'],
    [geosC, 'ring-c'],
  ]) {
    if (!geos.length) continue
    const merged = mergeGeometries(geos, false)
    if (!merged) {
      console.warn(`[buildings] ${name} 合并失败`)
      continue
    }
    merged.computeBoundingSphere()
    const mesh = new THREE.Mesh(merged, mat)
    mesh.name = name
    mesh.matrixAutoUpdate = false
    group.add(mesh)
    for (const g of geos) g.dispose()
  }

  group.userData.stats = stats
  return group
}
