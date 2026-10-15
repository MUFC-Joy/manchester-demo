/**
 * egg.js — 彩蛋（方案 §5-P5）
 *
 * 键盘输入缓冲，两个彩蛋成本都极低：
 *   键入 1999 → 老特拉福德上空升起金色奖杯 + 字幕"补时 3 分钟，诺坎普之夜"
 *   键入 1000 → 全城红蓝双色烟花 + 两座球场大屏滚动曼联/曼城传奇名录
 */

import * as THREE from 'three'
import { ll2xy, OT, ETIHAD } from '../core/geo.js'
import { LEGENDS } from './legends.js'

const OT_XY = ll2xy(OT.lat, OT.lon)
const ET_XY = ll2xy(ETIHAD.lat, ETIHAD.lon)

export function createEggs(scene, { onSubtitle } = {}) {
  let buffer = ''

  // ── 彩蛋 1：金色奖杯 ──
  const trophy = new THREE.Group()
  const gold = new THREE.MeshBasicMaterial({ color: 0xf5c542 })
  const goldDark = new THREE.MeshBasicMaterial({ color: 0xd4a017 })

  const cupGeo = new THREE.CylinderGeometry(5, 2.2, 9, 12)
  const cup = new THREE.Mesh(cupGeo, gold)
  cup.position.y = 12
  trophy.add(cup)

  const stemGeo = new THREE.CylinderGeometry(1.1, 1.6, 5, 10)
  const stem = new THREE.Mesh(stemGeo, goldDark)
  stem.position.y = 5.5
  trophy.add(stem)

  const baseGeo = new THREE.BoxGeometry(7, 2.2, 7)
  const base = new THREE.Mesh(baseGeo, goldDark)
  base.position.y = 1.6
  trophy.add(base)

  trophy.position.set(OT_XY.x, 120, OT_XY.z)
  trophy.visible = false
  scene.add(trophy)

  let trophyAnim = null

  function showTrophy() {
    trophy.visible = true
    trophy.scale.setScalar(0.01)
    trophyAnim = { t: 0, duration: 2.2 }
    onSubtitle?.('补时 3 分钟 · 诺坎普之夜 · 1999')
  }

  // ── 彩蛋 2：全城红蓝烟花 ──
  const BURSTS = 6
  const PER_BURST = 900
  const COUNT = BURSTS * PER_BURST

  const positions = new Float32Array(COUNT * 3)
  const colors = new Float32Array(COUNT * 3)
  const velocities = []
  const origins = []
  const life = new Float32Array(COUNT)

  const burstCenters = [
    [OT_XY.x, 90, OT_XY.z, new THREE.Color(0xff5a4a)],
    [OT_XY.x - 150, 70, OT_XY.z + 120, new THREE.Color(0xff8a5a)],
    [ET_XY.x, 90, ET_XY.z, new THREE.Color(0x5aa9ff)],
    [ET_XY.x + 150, 70, ET_XY.z - 120, new THREE.Color(0x7ad4ff)],
    [(OT_XY.x + ET_XY.x) / 2, 130, (OT_XY.z + ET_XY.z) / 2, new THREE.Color(0xffd98a)],
    [(OT_XY.x + ET_XY.x) / 2 - 300, 110, (OT_XY.z + ET_XY.z) / 2 - 250, new THREE.Color(0xffffff)],
  ]

  let idx = 0
  for (let b = 0; b < BURSTS; b++) {
    const [bx, by, bz, col] = burstCenters[b]
    for (let i = 0; i < PER_BURST; i++, idx++) {
      origins.push([bx, by, bz])
      colors[idx * 3] = col.r
      colors[idx * 3 + 1] = col.g
      colors[idx * 3 + 2] = col.b

      // 均匀球面方向
      const u = Math.random() * 2 - 1
      const th = Math.random() * Math.PI * 2
      const r = Math.sqrt(1 - u * u)
      const speed = 28 + Math.random() * 55
      velocities.push([
        r * Math.cos(th) * speed,
        u * speed * 0.85 + 18,
        r * Math.sin(th) * speed,
      ])
      life[idx] = 0
      positions[idx * 3] = bx
      positions[idx * 3 + 1] = by
      positions[idx * 3 + 2] = bz
    }
  }

  const fwGeo = new THREE.BufferGeometry()
  fwGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  fwGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  const fwMat = new THREE.PointsMaterial({
    size: 6,
    vertexColors: true,
    transparent: true,
    opacity: 0,
    sizeAttenuation: true,
    depthWrite: false,
  })
  const fireworks = new THREE.Points(fwGeo, fwMat)
  fireworks.visible = false
  fireworks.frustumCulled = false
  scene.add(fireworks)

  let fwAnim = null

  function showFireworks() {
    fireworks.visible = true
    fwMat.opacity = 1
    for (let i = 0; i < COUNT; i++) life[i] = 0
    fwAnim = { t: 0, duration: 5.5 }
    onSubtitle?.('THIS IS MANCHESTER')
    startLegendScroll()
  }

  // ── 传奇名录滚动（两座球场上空的"传奇墙"）──
  const legendGroups = []
  function makeLegendWall(list, x, z, color) {
    const group = new THREE.Group()
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0 })

    list.forEach((name, i) => {
      const geo = new THREE.PlaneGeometry(8 + name.length * 2.4, 7)
      const m = mat.clone()
      const mesh = new THREE.Mesh(geo, m)
      mesh.position.set(0, 40 + i * 11, 0)
      group.add(mesh)
    })

    group.position.set(x, 0, z)
    group.visible = false
    scene.add(group)
    legendGroups.push({ group, mat, count: list.length, elapsed: 0 })
    return group
  }

  function startLegendScroll() {
    const otNames = LEGENDS.manUtd.tier1.concat(LEGENDS.manUtd.tier2)
    const etNames = LEGENDS.manCity.tier1.concat(LEGENDS.manCity.tier2)
    makeLegendWall(otNames, OT_XY.x, OT_XY.z + 130, 0xff5a4a)
    makeLegendWall(etNames, ET_XY.x, ET_XY.z - 130, 0x5aa9ff)
  }

  // ── 键盘输入 ──
  function onKey(e) {
    if (e.key < '0' || e.key > '9') return
    buffer = (buffer + e.key).slice(-4)
    if (buffer === '1999') {
      buffer = ''
      showTrophy()
    } else if (buffer === '1000') {
      buffer = ''
      showFireworks()
    }
  }

  window.addEventListener('keydown', onKey)

  // ── 动画 ──
  function update(dt) {
    // 奖杯升起 + 缓慢自转
    if (trophyAnim) {
      trophyAnim.t += dt
      const k = Math.min(1, trophyAnim.t / trophyAnim.duration)
      const ease = 1 - Math.pow(1 - k, 3)
      trophy.scale.setScalar(0.01 + ease * 0.99)
      trophy.rotation.y += dt * 0.5
      if (trophyAnim.t > 14) {
        trophy.visible = false
        trophyAnim = null
      }
    }

    // 烟花
    if (fwAnim) {
      fwAnim.t += dt
      const k = fwAnim.t / fwAnim.duration
      fwMat.opacity = Math.max(0, 1 - k)
      for (let i = 0; i < COUNT; i++) {
        if (life[i] > fwAnim.duration) continue
        life[i] += dt
        const t = life[i]
        velocities[i][1] -= 22 * dt // 重力
        positions[i * 3] += velocities[i][0] * dt
        positions[i * 3 + 1] += velocities[i][1] * dt
        positions[i * 3 + 2] += velocities[i][2] * dt
      }
      fwGeo.attributes.position.needsUpdate = true
      if (k >= 1) {
        fireworks.visible = false
        fwAnim = null
        for (const lg of legendGroups) lg.group.visible = false
      }
    }

    // 传奇墙逐条淡入 + 上移
    for (const lg of legendGroups) {
      if (!lg.group.visible) continue
      lg.elapsed += dt
      lg.group.children.forEach((mesh, i) => {
        const appear = lg.elapsed - i * 0.28
        const a = Math.max(0, Math.min(1, appear / 0.5))
        mesh.material.opacity = a
        mesh.position.y = 40 + i * 11 + Math.max(0, lg.elapsed - i * 0.28) * 2.2
      })
      lg.group.children.forEach((mesh) => {
        if (mesh.material.opacity <= 0) mesh.visible = false
        else mesh.visible = true
      })
    }
  }

  function dispose() {
    window.removeEventListener('keydown', onKey)
  }

  return { update, dispose }
}
