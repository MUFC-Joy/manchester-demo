/**
 * pitch.js — 程序化草坪贴图（方案 §6.5）
 *
 * 一个 canvas 搞定条纹 + 白线，成本几乎为零，观感提升最大的一笔。
 * 不需要找贴图，也就没有版权问题。
 */

import * as THREE from 'three'
import { PALETTE } from '../core/materials.js'

const PX_PER_M = 8

export function createPitchTexture(lengthM = 105, widthM = 68) {
  const W = Math.round(lengthM * PX_PER_M)
  const H = Math.round(widthM * PX_PER_M)

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const g = canvas.getContext('2d')
  const m = (v) => v * PX_PER_M

  // ── 剪草条纹 ──
  const STRIPES = 14
  const sw = W / STRIPES
  for (let i = 0; i < STRIPES; i++) {
    g.fillStyle = i % 2 === 0 ? PALETTE.pitchStripeA : PALETTE.pitchStripeB
    g.fillRect(i * sw, 0, sw + 1, H)
  }

  // ── 白线 ──
  const MARGIN = 2.0 // 边线到画布边缘的余量（米）
  const x0 = m(MARGIN)
  const y0 = m(MARGIN)
  const w = W - m(MARGIN) * 2
  const h = H - m(MARGIN) * 2
  const cx = x0 + w / 2
  const cy = y0 + h / 2

  g.strokeStyle = PALETTE.pitchLine
  g.fillStyle = PALETTE.pitchLine
  g.lineWidth = Math.max(2, m(0.12))
  g.lineCap = 'round'

  // 边线
  g.strokeRect(x0, y0, w, h)

  // 中线
  g.beginPath()
  g.moveTo(cx, y0)
  g.lineTo(cx, y0 + h)
  g.stroke()

  // 中圈 + 中点
  g.beginPath()
  g.arc(cx, cy, m(9.15), 0, Math.PI * 2)
  g.stroke()
  g.beginPath()
  g.arc(cx, cy, m(0.35), 0, Math.PI * 2)
  g.fill()

  // 两端：球门区 + 罚球区 + 罚球点 + 罚球弧
  const PEN_DEPTH = 16.5
  const PEN_HALF = 20.16
  const GOAL_AREA_DEPTH = 5.5
  const GOAL_AREA_HALF = 9.16

  for (const side of [0, 1]) {
    const sx = side === 0 ? x0 : x0 + w
    const dir = side === 0 ? 1 : -1

    // 罚球区
    g.strokeRect(
      side === 0 ? sx : sx - m(PEN_DEPTH),
      cy - m(PEN_HALF),
      m(PEN_DEPTH),
      m(PEN_HALF * 2)
    )

    // 球门区
    g.strokeRect(
      side === 0 ? sx : sx - m(GOAL_AREA_DEPTH),
      cy - m(GOAL_AREA_HALF),
      m(GOAL_AREA_DEPTH),
      m(GOAL_AREA_HALF * 2)
    )

    // 罚球点
    const spotX = sx + dir * m(11)
    g.beginPath()
    g.arc(spotX, cy, m(0.35), 0, Math.PI * 2)
    g.fill()

    // 罚球弧
    g.beginPath()
    const start = side === 0 ? -Math.PI / 2.6 : Math.PI - Math.PI / 2.6
    g.arc(spotX, cy, m(9.15), start, start + Math.PI / 1.3)
    g.stroke()
  }

  // 角球弧
  const CORNERS = [
    [x0, y0, 0, Math.PI / 2],
    [x0 + w, y0, Math.PI / 2, Math.PI],
    [x0 + w, y0 + h, Math.PI, Math.PI * 1.5],
    [x0, y0 + h, Math.PI * 1.5, Math.PI * 2],
  ]
  for (const [ax, ay, s, e] of CORNERS) {
    g.beginPath()
    g.arc(ax, ay, m(1), s, e)
    g.stroke()
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  tex.needsUpdate = true
  return tex
}

/** 草坪平面（本地 X = 长轴，Z = 短轴，贴在 y=0） */
export function createPitchMesh(lengthM = 105, widthM = 68) {
  const margin = 4 // 草皮比场地线大一圈
  const geo = new THREE.PlaneGeometry(lengthM + margin * 2, widthM + margin * 2)
  geo.rotateX(-Math.PI / 2)
  geo.translate(0, 0.35, 0)

  const mat = new THREE.MeshLambertMaterial({
    map: createPitchTexture(lengthM + margin * 2, widthM + margin * 2),
  })

  const mesh = new THREE.Mesh(geo, mat)
  mesh.name = 'pitch'
  return mesh
}

/** 球门：两根立柱 + 横梁 + 球网（用线框示意） */
export function createGoals(lengthM = 105) {
  const group = new THREE.Group()
  group.name = 'goals'

  const POST_R = 0.12
  const GOAL_W = 7.32
  const GOAL_H = 2.44
  const DEPTH = 2.0

  const mat = new THREE.MeshLambertMaterial({ color: PALETTE.goalPost })
  const netMat = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.35,
  })

  for (const side of [-1, 1]) {
    const x = (side * lengthM) / 2
    const goal = new THREE.Group()

    const postGeo = new THREE.CylinderGeometry(POST_R, POST_R, GOAL_H, 6)
    for (const zs of [-1, 1]) {
      const post = new THREE.Mesh(postGeo, mat)
      post.position.set(0, GOAL_H / 2, (zs * GOAL_W) / 2)
      goal.add(post)
    }

    const barGeo = new THREE.CylinderGeometry(POST_R, POST_R, GOAL_W, 6)
    barGeo.rotateX(Math.PI / 2)
    const bar = new THREE.Mesh(barGeo, mat)
    bar.position.set(0, GOAL_H, 0)
    goal.add(bar)

    // 球网示意
    const pts = []
    const bx = -side * DEPTH
    for (let i = 0; i <= 6; i++) {
      const z = -GOAL_W / 2 + (GOAL_W * i) / 6
      pts.push(0, 0, z, bx, 0, z)
      pts.push(0, GOAL_H, z, bx, GOAL_H * 0.75, z)
    }
    const netGeo = new THREE.BufferGeometry()
    netGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    goal.add(new THREE.LineSegments(netGeo, netMat))

    goal.position.x = x
    group.add(goal)
  }

  return group
}
