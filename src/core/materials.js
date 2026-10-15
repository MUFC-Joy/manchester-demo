/**
 * materials.js — 全项目共享色板与材质
 *
 * 风格统一的锚点（方案 §6.4）：色板 ≤ 8 色，做成常量集中管理。
 * 方块风不需要 PBR，MeshLambertMaterial 足够，且能省下大量 GPU 开销。
 */

import * as THREE from 'three'

export const PALETTE = {
  // 地面与铺装
  ground: '#3a4a3f',
  groundGrid: '#33423a',

  // 道路分级（主干 / 次干 / 支路）
  road: ['#3b4048', '#333840', '#2b2f36'],
  rail: '#4a4a4f',

  // 水系
  water: '#274a63',
  waterway: '#2b5170',

  // 绿地
  green: ['#3f5a3a', '#4a6b3f'],
  pitch: '#4f7a3f',

  // 建筑（暖灰系，k 为 buildingClass 返回值）
  building: ['#8a8478', '#7d7770', '#9a9086', '#6f6a63'],

  // 球场
  standConcrete: '#6e6a66',
  standRoof: '#4a4744',
  seatOT: '#c0392b',
  seatEtihad: '#4a90d9',
  pitchStripeA: '#3f6b32',
  pitchStripeB: '#477a38',
  pitchLine: '#dfe6df',
  goalPost: '#e8e8e8',

  // 天空 / 雾
  sky: '#1b2430',
  fog: '#1b2430',
}

/** 建筑高度越高越亮，做出城市天际线的层次 */
export function buildingColor(k, height, maxHeight = 60) {
  const base = new THREE.Color(PALETTE.building[k] ?? PALETTE.building[1])
  // 低层压暗，高层提亮（伪 AO / 伪光照层次）
  const t = Math.min(1, height / maxHeight)
  const lift = 0.72 + t * 0.42
  base.multiplyScalar(lift)
  return base
}

/** 统一的顶点色 Lambert 材质（所有静态几何共用） */
let vertexColorMat = null
export function getVertexColorMaterial() {
  if (!vertexColorMat) {
    vertexColorMat = new THREE.MeshLambertMaterial({
      vertexColors: true,
      flatShading: true,
    })
  }
  return vertexColorMat
}

/** 水面材质：轻微自发光，避免在暗场景里全黑 */
let waterMat = null
export function getWaterMaterial() {
  if (!waterMat) {
    waterMat = new THREE.MeshLambertMaterial({
      color: PALETTE.water,
      emissive: new THREE.Color(PALETTE.water).multiplyScalar(0.22),
      flatShading: true,
    })
  }
  return waterMat
}

/** 给几何体刷上统一顶点色 */
export function paintGeometry(geo, color) {
  const n = geo.attributes.position.count
  const arr = new Float32Array(n * 3)
  const c = color instanceof THREE.Color ? color : new THREE.Color(color)
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r
    arr[i * 3 + 1] = c.g
    arr[i * 3 + 2] = c.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3))
  return geo
}

/** 清理合并前不需要的属性，保证所有几何属性集一致 */
export function normalizeForMerge(geo) {
  geo.deleteAttribute('uv')
  geo.deleteAttribute('uv1')
  geo.deleteAttribute('uv2')
  if (geo.groups) geo.clearGroups()
  if (!geo.attributes.normal) geo.computeVertexNormals()
  return geo
}
