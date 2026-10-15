/**
 * buildings.js — 建筑三环 LOD（方案 §6.2）
 *
 *   A 环（每球场半径 600m）  按真实 footprint 挤出 + 高度阶梯
 *   B 环（两场走廊 + 市中心） 简化 footprint，同 A 环方式挤出
 *   C 环（其余）             只保留大体量建筑，用简单盒子
 *
 * 三环全部走"窗格贴图"材质：墙面 uv = 世界坐标（米），窗格按 6m×3m 对齐铺贴；
 * 屋顶 uv 固定取样墙面空白点，不铺窗格。每环合并成 1 个 draw call。
 */

import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import {
  buildingColor,
  getBuildingMaterial,
  normalizeForMerge,
  ROOF_UV,
  WINDOW_TILE_W,
  WINDOW_TILE_H,
} from '../core/materials.js'
import { ll2xy, OT, ETIHAD } from '../core/geo.js'

const RING_A_RADIUS = 600 // m
const CORRIDOR_HALF_WIDTH = 900 // m
const CENTRE_RADIUS = 1600 // m（围绕两场中点）
// v2 P1：核心区收缩后三角形预算宽裕，C 环阈值从 500 降到 30（= 数据管线 MIN_AREA），
// 联排住宅（30~100m²）全部找回——"每一条街都有楼"
const C_RING_MIN_AREA = 30 // m²

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

/**
 * 挤出体的自定义 UV 生成器：
 * - 侧面：uv 直接用顶点坐标（米），配合贴图 repeat(1/TILE) 实现世界坐标对齐的窗格
 * - 顶/底面：固定取样墙面空白点，屋顶是干净的颜色而不是窗格
 */
function roofUVSet(n) {
  const arr = []
  for (let i = 0; i < n; i++) arr.push(new THREE.Vector2(ROOF_UV.x, ROOF_UV.y))
  return arr
}

const extrudeUVGenerator = {
  generateTopUV(_geometry, vertices) {
    return roofUVSet(vertices.length / 3)
  },
  generateSideWallUV(_geometry, vertices, indexA, indexB, indexC, indexD) {
    const ax = vertices[indexA * 3]
    const ay = vertices[indexA * 3 + 1]
    const az = vertices[indexA * 3 + 2]
    const bx = vertices[indexB * 3]
    const by = vertices[indexB * 3 + 1]
    const bz = vertices[indexB * 3 + 2]
    const cx = vertices[indexC * 3]
    const cy = vertices[indexC * 3 + 1]
    const cz = vertices[indexC * 3 + 2]
    const dx = vertices[indexD * 3]
    const dy = vertices[indexD * 3 + 1]
    const dz = vertices[indexD * 3 + 2]
    // u = 沿墙的水平坐标，v = 高度——世界坐标对齐，所有楼的窗格大小一致
    if (Math.abs(ay - by) < Math.abs(ax - bx)) {
      return [
        new THREE.Vector2(ax, 1 - az),
        new THREE.Vector2(bx, 1 - bz),
        new THREE.Vector2(cx, 1 - cz),
        new THREE.Vector2(dx, 1 - dz),
      ]
    }
    return [
      new THREE.Vector2(ay, 1 - az),
      new THREE.Vector2(by, 1 - bz),
      new THREE.Vector2(cy, 1 - cz),
      new THREE.Vector2(dy, 1 - dz),
    ]
  },
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
    UVGenerator: extrudeUVGenerator,
  })
  geo.rotateX(-Math.PI / 2)
  return geo
}

/**
 * C 环盒子：BoxGeometry 的 uv 是每面 0~1，按各面实际尺寸缩放成米，
 * 顶/底面同样定到墙面空白点。
 */
function scaleBoxUV(geo, w, h, d) {
  const uv = geo.attributes.uv
  // 面序：+x -x +y -y +z -z；各面 (水平尺寸, 竖直尺寸)
  const dims = [
    [d, h], [d, h],
    [w, d], [w, d],
    [w, h], [w, h],
  ]
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const idx = f * 4 + i
      if (f === 2 || f === 3) {
        uv.setXY(idx, ROOF_UV.x, ROOF_UV.y)
        continue
      }
      uv.setXY(
        idx,
        (uv.getX(idx) * dims[f][0]) / WINDOW_TILE_W,
        (uv.getY(idx) * dims[f][1]) / WINDOW_TILE_H
      )
    }
  }
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

/** 填充顶点色（整几何单色） */
function fillVertexColor(geo, color) {
  const col = new Float32Array(geo.attributes.position.count * 3)
  for (let i = 0; i < col.length; i += 3) {
    col[i] = color.r
    col[i + 1] = color.g
    col[i + 2] = color.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
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

    if (ring === 'A' || ring === 'B') {
      const geo = extrudeFootprint(b.p, b.h)
      normalizeForMerge(geo)
      fillVertexColor(geo, color)
      applyVerticalShading(geo, b.h)
      ;(ring === 'A' ? geosA : geosB).push(geo)
      stats[ring]++
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
      scaleBoxUV(geo, w, b.h, d)
      geo.translate((minX + maxX) / 2, b.h / 2, (minZ + maxZ) / 2)
      normalizeForMerge(geo)
      fillVertexColor(geo, color)
      geosC.push(geo)
      stats.C++
      stats.triangles += 12
    }
  }

  const mat = getBuildingMaterial()

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
