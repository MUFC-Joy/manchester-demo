/**
 * green.js — 公园 / 草地 / 球场绿地
 */

import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { PALETTE, getVertexColorMaterial, normalizeForMerge } from '../core/materials.js'

const GREEN_Y = 0.6

function polygonGeometry(flat, yLift = 0) {
  const shape = new THREE.Shape()
  shape.moveTo(flat[0], -flat[1])
  for (let i = 2; i < flat.length; i += 2) {
    shape.lineTo(flat[i], -flat[i + 1])
  }
  shape.closePath()

  const geo = new THREE.ShapeGeometry(shape, 1)
  geo.rotateX(-Math.PI / 2)
  geo.translate(0, GREEN_Y + yLift, 0)
  return geo
}

export function createGreen(green) {
  const group = new THREE.Group()
  group.name = 'green'

  const buckets = [[], []] // 0 = 一般绿地, 1 = 球场草坪
  // 相邻绿地多边形常互相压边，同一高度会 z-fight 闪烁（v2 问题七）：
  // 逐块错开 2cm 一档，肉眼无感，深度冲突消失
  let seq = 0
  for (const g of green ?? []) {
    const lift = (seq++ % 6) * 0.02
    const geo = polygonGeometry(g.p, lift)
    normalizeForMerge(geo)
    buckets[g.k === 1 ? 1 : 0].push(geo)
  }

  const mat = getVertexColorMaterial()
  const names = ['green-general', 'green-pitch']

  for (let i = 0; i < 2; i++) {
    const geos = buckets[i]
    if (!geos.length) continue
    const merged = mergeGeometries(geos, false)
    if (!merged) continue

    const c = new THREE.Color(i === 1 ? PALETTE.pitch : PALETTE.green[0])
    const cnt = merged.attributes.position.count
    const arr = new Float32Array(cnt * 3)
    for (let j = 0; j < cnt; j++) {
      arr[j * 3] = c.r
      arr[j * 3 + 1] = c.g
      arr[j * 3 + 2] = c.b
    }
    merged.setAttribute('color', new THREE.BufferAttribute(arr, 3))
    merged.computeBoundingSphere()

    const mesh = new THREE.Mesh(merged, mat)
    mesh.name = names[i]
    mesh.matrixAutoUpdate = false
    group.add(mesh)

    for (const g of geos) g.dispose()
  }

  return group
}
