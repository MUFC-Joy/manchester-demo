/**
 * streetlights.js — 主干道路灯
 *
 * 视频"夜幕降临"的核心氛围：路灯头亮起 + 地面一滩暖光。
 * 三个图层：灯杆（合并网格）/ 灯头（InstancedMesh，透明度 0→1）/ 光池（加法混合圆盘）。
 * 位置沿主干道撒，建筑包围盒内一票否决（复用 trees.js 的空间哈希）。
 */

import * as THREE from 'three'
import { normalizeForMerge } from '../core/materials.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { ROAD_WIDTH } from './roads.js'

const STEP = 60 // 灯距，米
const MAX_LAMPS = 900

export function createStreetLights(roads, grid) {
  const rand = Math.random // 位置不需要可复现（不影响任何验收指标）

  const spots = []
  for (const r of roads ?? []) {
    if ((r.k ?? 2) > 0) continue // 只装主干道
    const flat = r.p
    const offset = ROAD_WIDTH[0] * 0.5 + 1.3
    let carry = rand() * STEP

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
        if (spots.length < MAX_LAMPS) {
          const side = spots.length % 2 === 0 ? 1 : -1
          spots.push({
            x: x1 + ux * s - uz * offset * side,
            z: z1 + uz * s + ux * offset * side,
            angle: Math.atan2(ux, uz),
          })
        }
        s += STEP
      }
      carry = s - len
    }
  }

  const valid = spots.filter((p) => !grid.hits(p.x, p.z, 1.2))
  const count = valid.length

  // ── 灯杆：细长盒子，合并；白天隐形（省面+不挡视线），随灯头一起在夜里显形 ──
  const poleGeos = []
  const poleGeo = new THREE.BoxGeometry(0.22, 6.6, 0.22)
  poleGeo.translate(0, 1 + 3.3, 0)
  for (const p of valid) {
    const g = poleGeo.clone()
    g.rotateY(p.angle)
    g.translate(p.x, 0, p.z)
    poleGeos.push(g)
  }
  const poleMat = new THREE.MeshLambertMaterial({
    color: '#565b63',
    transparent: true,
    opacity: 0,
  })
  const poleMesh = new THREE.Mesh(normalizeForMerge(mergeGeometries(poleGeos, false)), poleMat)
  poleMesh.name = 'lamp-poles'
  poleMesh.matrixAutoUpdate = false
  for (const g of poleGeos) g.dispose()
  poleGeo.dispose()

  // ── 灯头：发光小条，夜里 opacity 0→1 ──
  const headGeo = new THREE.BoxGeometry(0.55, 0.26, 1.7)
  headGeo.translate(0, 7.3, 0)
  const headMat = new THREE.MeshBasicMaterial({
    color: '#ffd27a',
    transparent: true,
    opacity: 0,
    depthWrite: false,
  })
  const heads = new THREE.InstancedMesh(headGeo, headMat, count)
  heads.name = 'lamp-heads'
  heads.frustumCulled = false

  // ── 光池：加法混合圆盘，夜里 opacity 0→0.14 ──
  const poolGeo = new THREE.CircleGeometry(8.5, 14)
  poolGeo.rotateX(-Math.PI / 2)
  poolGeo.translate(0, 1.15, 0)
  const poolMat = new THREE.MeshBasicMaterial({
    color: '#ff9a3d',
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  const pools = new THREE.InstancedMesh(poolGeo, poolMat, count)
  pools.name = 'lamp-pools'
  pools.frustumCulled = false

  const dummy = new THREE.Object3D()
  for (let i = 0; i < count; i++) {
    const p = valid[i]
    dummy.position.set(p.x, 0, p.z)
    dummy.rotation.set(0, p.angle, 0)
    dummy.scale.setScalar(1)
    dummy.updateMatrix()
    heads.setMatrixAt(i, dummy.matrix)
    pools.setMatrixAt(i, dummy.matrix)
  }
  heads.instanceMatrix.needsUpdate = true
  pools.instanceMatrix.needsUpdate = true

  const group = new THREE.Group()
  group.name = 'streetlights'
  group.add(poleMesh, heads, pools)
  group.userData.count = count

  return { group, poleMat, headMat, poolMat }
}
