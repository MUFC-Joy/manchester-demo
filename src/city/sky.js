/**
 * sky.js — 渐变天穹 + 低多边形云
 *
 * 视频的白天画面有干净的蓝天渐变和几朵软云；原实现是纯色背景，天空是空的。
 * 天穹 = 顶点色球（BackSide），昼夜系统按 n 重算顶点色（顶点很少，代价可忽略）。
 * 云 = 若干压扁的二十面体球合并成一个 mesh，颜色/自发光也由昼夜系统插值。
 */

import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

const RADIUS = 26000

const DAY_HORIZON = new THREE.Color('#eef5f9')
const DAY_ZENITH = new THREE.Color('#8ec5e8')
const NIGHT_HORIZON = new THREE.Color('#141d2e')
const NIGHT_ZENITH = new THREE.Color('#04070d')

/** 确定性随机 */
function mulberry32(seed) {
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

function createDome() {
  const geo = new THREE.SphereGeometry(RADIUS, 24, 14)
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.BackSide,
    fog: false,
    depthWrite: false,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.name = 'sky-dome'
  mesh.renderOrder = -10

  const pos = geo.attributes.position
  const colors = new Float32Array(pos.count * 3)
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))

  const tmp = new THREE.Color()

  /** n=0 白天 → n=1 夜晚，重算穹顶顶点色 */
  function setBlend(n) {
    const horizon = tmp.copy(DAY_HORIZON).lerp(NIGHT_HORIZON, n)
    const zenith = new THREE.Color().copy(DAY_ZENITH).lerp(NIGHT_ZENITH, n)
    for (let i = 0; i < pos.count; i++) {
      const t = Math.min(1, Math.max(0, pos.getY(i) / RADIUS))
      // 用平滑曲线让地平线附近的过渡带更宽
      const k = Math.pow(t, 0.75)
      const r = horizon.r + (zenith.r - horizon.r) * k
      const g = horizon.g + (zenith.g - horizon.g) * k
      const b = horizon.b + (zenith.b - horizon.b) * k
      colors[i * 3] = r
      colors[i * 3 + 1] = g
      colors[i * 3 + 2] = b
    }
    geo.attributes.color.needsUpdate = true
  }

  setBlend(0)
  return { mesh, setBlend }
}

function createClouds() {
  const rand = mulberry32(20261015)
  const blobGeos = []

  // 16 朵云 × 每朵 3~5 个压扁球，散布在城市上空
  for (let c = 0; c < 16; c++) {
    const cx = (rand() - 0.5) * 17000
    const cz = (rand() - 0.5) * 17000
    const cy = 1100 + rand() * 900
    const blobs = 3 + Math.floor(rand() * 3)
    const scale = 60 + rand() * 130

    for (let b = 0; b < blobs; b++) {
      const r = scale * (0.55 + rand() * 0.5)
      const geo = new THREE.SphereGeometry(r, 7, 5)
      geo.scale(1, 0.55, 1)
      geo.translate(
        cx + (rand() - 0.5) * scale * 1.6,
        cy + (rand() - 0.5) * 30,
        cz + (rand() - 0.5) * scale * 1.1
      )
      blobGeos.push(geo)
    }
  }

  const geometry = mergeGeometries(blobGeos, false)
  for (const g of blobGeos) g.dispose()

  const mat = new THREE.MeshLambertMaterial({
    color: '#ffffff',
    emissive: '#ffffff',
    emissiveIntensity: 0.5,
    transparent: true,
    opacity: 0.95,
    flatShading: true,
  })

  const mesh = new THREE.Mesh(geometry, mat)
  mesh.name = 'clouds'
  mesh.frustumCulled = false
  return { mesh, mat }
}

export function createSky() {
  const group = new THREE.Group()
  group.name = 'sky'

  const dome = createDome()
  const clouds = createClouds()
  group.add(dome.mesh, clouds.mesh)

  return {
    group,
    /** 昼夜系统每帧过渡时调用（n: 0 白天 → 1 夜晚） */
    setBlend: dome.setBlend,
    cloudMat: clouds.mat,
  }
}
