/**
 * nightLights.js — 城市窗光（方案 §6.6）
 *
 * 夜景的窗光是"伪的"：每栋楼顶随机贴 1~3 个发光小面片。
 * 全城合计几万个 instance，一个 draw call。
 * MeshBasicMaterial 不受光照，天然就是"亮"的，透明度由昼夜系统控制。
 */

import * as THREE from 'three'

const WINDOW_COLOR = 0xffd98a // 暖黄
const SIZE_X = 3.4
const SIZE_Y = 2.2

export function createNightWindows(buildings, maxHeight = 60) {
  const positions = []

  // 确定性伪随机（与 build-city-json 的种子策略一致，保证可复现）
  function seededRand(seed) {
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

  for (const b of buildings) {
    const rand = seededRand(b.p[0] * 7919 + b.p[1])
    const n = 2 + Math.floor(rand() * 3) // 2~4 个

    // footprint 包围盒
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
    const cx = (minX + maxX) / 2
    const cz = (minZ + maxZ) / 2

    // 窗光贴在楼顶上方。注意：建筑是实心挤出体，如果把窗光放在
    // 0.45~0.95 倍楼高处，它会被埋在实心几何体里完全看不见（本会话实测踩坑）。
    for (let i = 0; i < n; i++) {
      const y = b.h + 0.7 // 坐在楼顶上
      const jx = (rand() - 0.5) * (maxX - minX) * 0.55
      const jz = (rand() - 0.5) * (maxZ - minZ) * 0.55
      positions.push([cx + jx, y, cz + jz])
    }
  }

  const count = positions.length
  // 用小方块而不是平面片：平面片在低机位下侧对相机会完全看不见，
  // 方块从任意角度都至少露出一个面，夜景才读得出"窗光"
  const geo = new THREE.BoxGeometry(SIZE_X, SIZE_Y, SIZE_X)

  const mat = new THREE.MeshBasicMaterial({
    color: WINDOW_COLOR,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  })

  const inst = new THREE.InstancedMesh(geo, mat, count)
  inst.name = 'night-windows'
  inst.frustumCulled = false // 同球场座椅：默认包围球在原点，会被整块剔除

  const dummy = new THREE.Object3D()
  for (let i = 0; i < count; i++) {
    dummy.position.set(positions[i][0], positions[i][1], positions[i][2])
    dummy.rotation.set(0, 0, 0)
    dummy.updateMatrix()
    inst.setMatrixAt(i, dummy.matrix)
  }
  inst.instanceMatrix.needsUpdate = true

  return inst
}
