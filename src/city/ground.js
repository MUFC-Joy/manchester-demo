/**
 * ground.js — 地面底板
 *
 * 浅色"模型底座"风格（参考视频同款）：亮白地面 + 极淡的街区网格。
 */

import * as THREE from 'three'
import { PALETTE } from '../core/materials.js'

export function createGround(size = 40000) {
  const group = new THREE.Group()
  group.name = 'ground'

  const geo = new THREE.PlaneGeometry(size, size, 1, 1)
  geo.rotateX(-Math.PI / 2)
  const mat = new THREE.MeshLambertMaterial({ color: PALETTE.ground })
  const plane = new THREE.Mesh(geo, mat)
  plane.position.y = 0
  plane.name = 'ground-plane'
  group.add(plane)

  // 100m 网格：淡淡的街区划分感，浅色地面上若隐若现
  const divisions = Math.min(400, Math.round(size / 100))
  const grid = new THREE.GridHelper(size, divisions, PALETTE.groundGrid, PALETTE.groundGrid)
  grid.position.y = 0.25
  grid.material.opacity = 0.28
  grid.material.transparent = true
  grid.material.depthWrite = false
  grid.name = 'ground-grid'
  group.add(grid)

  return group
}
