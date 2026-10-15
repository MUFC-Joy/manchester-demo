/**
 * water.js — 水面与水道（方案 §6.3）
 *
 * 曼彻斯特的识别度有一半来自水系：曼彻斯特运河（Ship Canal）、Irwell、Medlock。
 * 多边形水面用 ShapeGeometry 平铺，线状水道用带宽带子。
 */

import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import {
  PALETTE,
  getWaterMaterial,
  getVertexColorMaterial,
  normalizeForMerge,
} from '../core/materials.js'

const WATER_Y = 0.4
const WATERWAY_Y = 0.7

function polygonGeometry(flat) {
  const shape = new THREE.Shape()
  shape.moveTo(flat[0], -flat[1])
  for (let i = 2; i < flat.length; i += 2) {
    shape.lineTo(flat[i], -flat[i + 1])
  }
  shape.closePath()

  const geo = new THREE.ShapeGeometry(shape, 1)
  geo.rotateX(-Math.PI / 2)
  geo.translate(0, WATER_Y, 0)
  return geo
}

function ribbonGeometry(flat, width, y) {
  const positions = []
  const hw = width * 0.5
  const n = flat.length / 2

  for (let i = 0; i < n - 1; i++) {
    const x1 = flat[i * 2]
    const z1 = flat[i * 2 + 1]
    const x2 = flat[i * 2 + 2]
    const z2 = flat[i * 2 + 3]
    const dx = x2 - x1
    const dz = z2 - z1
    const len = Math.hypot(dx, dz)
    if (len < 1) continue

    const nx = (-dz / len) * hw
    const nz = (dx / len) * hw

    positions.push(
      x1 + nx, y, z1 + nz,
      x2 + nx, y, z2 + nz,
      x1 - nx, y, z1 - nz,
      x1 - nx, y, z1 - nz,
      x2 + nx, y, z2 + nz,
      x2 - nx, y, z2 - nz
    )
  }

  if (!positions.length) return null
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.computeVertexNormals()
  return geo
}

export function createWater(water, waterways) {
  const group = new THREE.Group()
  group.name = 'water'

  // 多边形水面
  const polyGeos = []
  for (const w of water ?? []) {
    const geo = polygonGeometry(w.p)
    normalizeForMerge(geo)
    polyGeos.push(geo)
  }

  if (polyGeos.length) {
    const merged = mergeGeometries(polyGeos, false)
    if (merged) {
      merged.computeBoundingSphere()
      const mesh = new THREE.Mesh(merged, getWaterMaterial())
      mesh.name = 'water-areas'
      mesh.matrixAutoUpdate = false
      group.add(mesh)
    }
    for (const g of polyGeos) g.dispose()
  }

  // 线状水道：先铺一层浅色岸线（宽 4m、低 12cm），水带叠在上面——读得出"这是河"（v2 问题八）
  const bankGeos = []
  const lineGeos = []
  for (const w of waterways ?? []) {
    const width = w.w ?? 8
    const bank = ribbonGeometry(w.p, width + 4, WATERWAY_Y - 0.12)
    if (bank) {
      normalizeForMerge(bank)
      bankGeos.push(bank)
    }
    const geo = ribbonGeometry(w.p, width, WATERWAY_Y)
    if (geo) {
      normalizeForMerge(geo)
      lineGeos.push(geo)
    }
  }

  if (bankGeos.length) {
    const merged = mergeGeometries(bankGeos, false)
    if (merged) {
      const cnt = merged.attributes.position.count
      const c = new THREE.Color(PALETTE.waterBank)
      const arr = new Float32Array(cnt * 3)
      for (let i = 0; i < cnt; i++) {
        arr[i * 3] = c.r
        arr[i * 3 + 1] = c.g
        arr[i * 3 + 2] = c.b
      }
      merged.setAttribute('color', new THREE.BufferAttribute(arr, 3))
      merged.computeBoundingSphere()
      const mesh = new THREE.Mesh(merged, getVertexColorMaterial())
      mesh.name = 'waterway-banks'
      mesh.matrixAutoUpdate = false
      group.add(mesh)
    }
    for (const g of bankGeos) g.dispose()
  }

  if (lineGeos.length) {
    const merged = mergeGeometries(lineGeos, false)
    if (merged) {
      const cnt = merged.attributes.position.count
      const c = new THREE.Color(PALETTE.waterway)
      const arr = new Float32Array(cnt * 3)
      for (let i = 0; i < cnt; i++) {
        arr[i * 3] = c.r
        arr[i * 3 + 1] = c.g
        arr[i * 3 + 2] = c.b
      }
      merged.setAttribute('color', new THREE.BufferAttribute(arr, 3))
      merged.computeBoundingSphere()
      const mesh = new THREE.Mesh(merged, getVertexColorMaterial())
      mesh.name = 'waterways'
      mesh.matrixAutoUpdate = false
      group.add(mesh)
    }
    for (const g of lineGeos) g.dispose()
  }

  return group
}
