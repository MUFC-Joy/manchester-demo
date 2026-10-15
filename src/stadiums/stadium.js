/**
 * stadium.js — 参数化球场碗形生成器
 *
 * 设计说明（与方案 §5-P3 的差异，见 docs/DECISIONS.md D-002）：
 *   方案原计划移植 hszzhua2/stadium-seat-explorer 的老特拉福德生成模块（MIT）。
 *   实际构建时改为自写统一参数化生成器，理由：
 *     ① 该仓库的 OT 模块与它自己的材质系统、座位数据、UI 深度耦合，
 *        抽取成本高于重写，且会破坏本项目的方块风一致性；
 *     ② 两座球场共用一套参数化生成器，风格统一是"白送的"（方案 §3 的原话）。
 *   仓库的地理基准数据（zBearing 250.63°）已采纳，见 core/geo.js 的注释。
 *
 * 结构：草坪 → 围挡草皮 → 阶梯看台（每排 = 竖板 + 座面）→ 外立面 → 悬挑屋顶 → 座椅海 → 灯塔
 * 风格：八边形轮廓近似圆角碗形 —— 城市尺度下读作"圆角"，同时保持方块感。
 */

import * as THREE from 'three'
import { PALETTE, getVertexColorMaterial } from '../core/materials.js'
import { createPitchMesh, createGoals } from './pitch.js'

// ───────────────────────── 几何工具 ─────────────────────────

/** 八边形轮廓（近似圆角矩形），返回 [x, z] 数组 */
function octagon(halfX, halfZ, cut = 0.26) {
  const cx = halfX * cut
  const cz = halfZ * cut
  return [
    [-halfX + cx, -halfZ],
    [halfX - cx, -halfZ],
    [halfX, -halfZ + cz],
    [halfX, halfZ - cz],
    [halfX - cx, halfZ],
    [-halfX + cx, halfZ],
    [-halfX, halfZ - cz],
    [-halfX, -halfZ + cz],
  ]
}

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
}
function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

/**
 * 自动绕序的四边形。按 XZ 平面给出四点，自动翻转成法线朝向 wantNormal。
 * 这样就不用手算绕序了 —— 手算绕序是这个模块最容易翻车的地方。
 */
function quad(acc, a, b, c, d, wantNormal, color) {
  const n = cross(sub(b, a), sub(c, a))
  const flip = dot(n, wantNormal) < 0
  const [p1, p2, p3, p4] = flip ? [a, d, c, b] : [a, b, c, d]
  for (const p of [p1, p2, p3, p1, p3, p4]) {
    acc.pos.push(p[0], p[1], p[2])
    acc.col.push(color.r, color.g, color.b)
  }
}

function newAcc() {
  return { pos: [], col: [] }
}

function accToGeometry(acc) {
  if (!acc.pos.length) return null
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(acc.pos, 3))
  geo.setAttribute('color', new THREE.Float32BufferAttribute(acc.col, 3))
  geo.computeVertexNormals()
  geo.computeBoundingSphere()
  return geo
}

// ───────────────────────── 主生成器 ─────────────────────────

export function createStadium(opts = {}) {
  const {
    length = 105,
    width = 68,
    rows = 22, // 看台排数
    rowDepth = 0.92, // 每排进深（米）
    rowHeight = 0.76, // 每排抬高（米）
    bowlMargin = 13, // 草坪边线到第一排的距离
    roofOverhang = 17, // 屋顶向内悬挑
    roofThickness = 2.0,
    roofRise = 4.0, // 屋顶高于最后一排
    // 屋顶按边分段：[0..7] 整圈；[0,2,4,6] 只保留四条长边 → 四块独立大顶 + 角部开口（老特拉福德特征）
    roofSegments = [0, 1, 2, 3, 4, 5, 6, 7],
    facadeThickness = 2.5,
    teamRingColor = null, // 外立面顶圈队色（v2 问题四：远读性优先的风格化处理）
    teamRingHeight = 3.5,
    seatColor = '#c0392b',
    seatSpacing = 2.4,
    floodlightHeight = 46,
    cornerCut = 0.26,
    withRoof = true,
    withFloodlights = true,
    withSeats = true,
  } = opts

  const group = new THREE.Group()

  const concrete = new THREE.Color(PALETTE.standConcrete)
  const seatCol = new THREE.Color(seatColor)
  const roofCol = new THREE.Color(PALETTE.standRoof)

  // ── 草坪 ──
  group.add(createPitchMesh(length, width))
  group.add(createGoals(length))

  // ── 围挡草皮（草坪到看台之间的一圈）──
  const apronAcc = newAcc()
  const apronInner = octagon(length / 2 + 4, width / 2 + 4, cornerCut)
  const apronOuter = octagon(length / 2 + bowlMargin, width / 2 + bowlMargin, cornerCut)
  for (let i = 0; i < 8; i++) {
    const j = (i + 1) % 8
    quad(
      apronAcc,
      [apronInner[i][0], 0.3, apronInner[i][1]],
      [apronOuter[i][0], 0.3, apronOuter[i][1]],
      [apronOuter[j][0], 0.3, apronOuter[j][1]],
      [apronInner[j][0], 0.3, apronInner[j][1]],
      [0, 1, 0],
      new THREE.Color(PALETTE.pitchStripeB)
    )
  }
  const apronGeo = accToGeometry(apronAcc)
  if (apronGeo) {
    const m = new THREE.Mesh(apronGeo, getVertexColorMaterial())
    m.name = 'apron'
    group.add(m)
  }

  // ── 阶梯看台 ──
  const standAcc = newAcc()
  const halfX0 = length / 2 + bowlMargin
  const halfZ0 = width / 2 + bowlMargin

  for (let r = 0; r < rows; r++) {
    const y0 = r * rowHeight
    const y1 = (r + 1) * rowHeight
    const inner = octagon(halfX0 + r * rowDepth, halfZ0 + r * rowDepth, cornerCut)
    const outer = octagon(
      halfX0 + (r + 1) * rowDepth,
      halfZ0 + (r + 1) * rowDepth,
      cornerCut
    )

    for (let i = 0; i < 8; i++) {
      const j = (i + 1) % 8

      // 竖板（面向球场，混凝土）
      const midX = (inner[i][0] + inner[j][0]) / 2
      const midZ = (inner[i][1] + inner[j][1]) / 2
      const outward = [midX, 0, midZ]
      const len = Math.hypot(midX, midZ) || 1
      const wantNormal = [-midX / len, 0, -midZ / len]
      quad(
        standAcc,
        [inner[i][0], y0, inner[i][1]],
        [inner[j][0], y0, inner[j][1]],
        [inner[j][0], y1, inner[j][1]],
        [inner[i][0], y1, inner[i][1]],
        wantNormal,
        concrete
      )

      // 座面（朝上，座椅色 —— 这就是"座椅海"的主体）
      quad(
        standAcc,
        [inner[i][0], y1, inner[i][1]],
        [outer[i][0], y1, outer[i][1]],
        [outer[j][0], y1, outer[j][1]],
        [inner[j][0], y1, inner[j][1]],
        [0, 1, 0],
        seatCol
      )
    }
  }

  // ── 外立面 ──
  const facadeInner = octagon(
    halfX0 + rows * rowDepth,
    halfZ0 + rows * rowDepth,
    cornerCut
  )
  const facadeOuter = octagon(
    halfX0 + rows * rowDepth + facadeThickness,
    halfZ0 + rows * rowDepth + facadeThickness,
    cornerCut
  )
  const topY = rows * rowHeight
  for (let i = 0; i < 8; i++) {
    const j = (i + 1) % 8
    // 外墙
    const midX = (facadeOuter[i][0] + facadeOuter[j][0]) / 2
    const midZ = (facadeOuter[i][1] + facadeOuter[j][1]) / 2
    const len = Math.hypot(midX, midZ) || 1
    quad(
      standAcc,
      [facadeOuter[i][0], 0, facadeOuter[i][1]],
      [facadeOuter[j][0], 0, facadeOuter[j][1]],
      [facadeOuter[j][0], topY, facadeOuter[j][1]],
      [facadeOuter[i][0], topY, facadeOuter[i][1]],
      [midX / len, 0, midZ / len],
      concrete
    )
    // 顶面封边
    quad(
      standAcc,
      [facadeInner[i][0], topY, facadeInner[i][1]],
      [facadeOuter[i][0], topY, facadeOuter[i][1]],
      [facadeOuter[j][0], topY, facadeOuter[j][1]],
      [facadeInner[j][0], topY, facadeInner[j][1]],
      [0, 1, 0],
      concrete
    )
  }

  const standGeo = accToGeometry(standAcc)
  if (standGeo) {
    const m = new THREE.Mesh(standGeo, getVertexColorMaterial())
    m.name = 'stands'
    group.add(m)
  }

  // ── 外立面顶圈队色环（v2 问题四：远看读得出"这是谁的家"）──
  if (teamRingColor) {
    const ringAcc = newAcc()
    const ringCol = new THREE.Color(teamRingColor)
    const y1 = topY
    const y0 = topY - teamRingHeight
    const eps = 0.1 // 沿外法线外推，避免和混凝土外墙 z-fighting

    for (let i = 0; i < 8; i++) {
      const j = (i + 1) % 8
      const ax = facadeOuter[i][0]
      const az = facadeOuter[i][1]
      const bx = facadeOuter[j][0]
      const bz = facadeOuter[j][1]
      // 边的外法线（XZ 平面内，垂直于边、背离中心）
      let nx = bz - az
      let nz = -(bx - ax)
      const nlen = Math.hypot(nx, nz) || 1
      nx /= nlen
      nz /= nlen
      const midX = (ax + bx) / 2
      const midZ = (az + bz) / 2
      if (nx * midX + nz * midZ < 0) {
        nx = -nx
        nz = -nz
      }

      quad(
        ringAcc,
        [ax + nx * eps, y0, az + nz * eps],
        [bx + nx * eps, y0, bz + nz * eps],
        [bx + nx * eps, y1, bz + nz * eps],
        [ax + nx * eps, y1, az + nz * eps],
        [nx, 0, nz],
        ringCol
      )
    }

    const ringGeo = accToGeometry(ringAcc)
    if (ringGeo) {
      const m = new THREE.Mesh(ringGeo, getVertexColorMaterial())
      m.name = 'team-ring'
      group.add(m)
    }
  }

  // ── 悬挑屋顶 ──
  if (withRoof) {
    const roofAcc = newAcc()
    const roofY = topY + roofRise
    const roofInner = octagon(
      halfX0 + rows * rowDepth - roofOverhang,
      halfZ0 + rows * rowDepth - roofOverhang,
      cornerCut
    )
    const roofOuter = octagon(
      halfX0 + rows * rowDepth + facadeThickness + 2,
      halfZ0 + rows * rowDepth + facadeThickness + 2,
      cornerCut
    )

    for (const i of roofSegments) {
      const j = (i + 1) % 8
      // 下表面（朝下）
      quad(
        roofAcc,
        [roofInner[i][0], roofY, roofInner[i][1]],
        [roofOuter[i][0], roofY, roofOuter[i][1]],
        [roofOuter[j][0], roofY, roofOuter[j][1]],
        [roofInner[j][0], roofY, roofInner[j][1]],
        [0, -1, 0],
        roofCol
      )
      // 上表面（朝上）
      quad(
        roofAcc,
        [roofInner[i][0], roofY + roofThickness, roofInner[i][1]],
        [roofOuter[i][0], roofY + roofThickness, roofOuter[i][1]],
        [roofOuter[j][0], roofY + roofThickness, roofOuter[j][1]],
        [roofInner[j][0], roofY + roofThickness, roofInner[j][1]],
        [0, 1, 0],
        roofCol
      )
      // 内圈侧壁
      quad(
        roofAcc,
        [roofInner[i][0], roofY, roofInner[i][1]],
        [roofInner[j][0], roofY, roofInner[j][1]],
        [roofInner[j][0], roofY + roofThickness, roofInner[j][1]],
        [roofInner[i][0], roofY + roofThickness, roofInner[i][1]],
        [0, 0, 0],
        roofCol
      )
    }

    const roofGeo = accToGeometry(roofAcc)
    if (roofGeo) {
      const m = new THREE.Mesh(roofGeo, getVertexColorMaterial())
      m.name = 'roof'
      group.add(m)
    }
  }

  // ── 座椅海（instanced 小方块）──
  if (withSeats) {
    const positions = []
    for (let r = 0; r < rows; r++) {
      const y = (r + 1) * rowHeight + 0.22
      const inner = octagon(halfX0 + r * rowDepth, halfZ0 + r * rowDepth, cornerCut)
      const outer = octagon(
        halfX0 + (r + 1) * rowDepth,
        halfZ0 + (r + 1) * rowDepth,
        cornerCut
      )
      const mid = inner.map((p, i) => [
        (p[0] + outer[i][0]) / 2,
        (p[1] + outer[i][1]) / 2,
      ])
      for (let i = 0; i < 8; i++) {
        const j = (i + 1) % 8
        const ax = mid[i][0]
        const az = mid[i][1]
        const bx = mid[j][0]
        const bz = mid[j][1]
        const segLen = Math.hypot(bx - ax, bz - az)
        const n = Math.max(1, Math.floor(segLen / seatSpacing))
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n
          positions.push([ax + (bx - ax) * t, y, az + (bz - az) * t])
        }
      }
    }

    const count = positions.length
    const seatGeo = new THREE.BoxGeometry(0.62, 0.42, 0.62)
    const seatMat = new THREE.MeshLambertMaterial({ color: seatColor })
    const inst = new THREE.InstancedMesh(seatGeo, seatMat, count)
    inst.name = 'seats'
    const dummy = new THREE.Object3D()
    for (let i = 0; i < count; i++) {
      dummy.position.set(positions[i][0], positions[i][1], positions[i][2])
      dummy.rotation.set(0, 0, 0)
      dummy.updateMatrix()
      inst.setMatrixAt(i, dummy.matrix)
    }
    inst.instanceMatrix.needsUpdate = true
    // 关键：InstancedMesh 的包围球默认按"单个盒子"计算，而不是全部实例的分布。
    // 球场整体远离原点时会被整块剔除，座椅直接消失 —— 必须关掉或手动算包围球。
    inst.frustumCulled = false
    group.add(inst)
    group.userData.seatCount = count
  }

  // ── 四角灯塔 ──
  if (withFloodlights) {
    const lightAcc = newAcc()
    const cornerR = 0.36 * (halfX0 + rows * rowDepth)
    const cornerZ = 0.36 * (halfZ0 + rows * rowDepth)
    const mastCol = new THREE.Color(PALETTE.standRoof)
    const diag = 0.36
    const corners = [
      [-cornerR, -cornerZ],
      [cornerR, -cornerZ],
      [cornerR, cornerZ],
      [-cornerR, cornerZ],
    ]

    for (const [cx, cz] of corners) {
      const yTop = topY + floodlightHeight
      // 简化：一根方柱
      const s = 2.2
      const pts = [
        [cx - s, 0, cz - s],
        [cx + s, 0, cz - s],
        [cx + s, 0, cz + s],
        [cx - s, 0, cz + s],
      ]
      const top = pts.map((p) => [p[0], yTop, p[2]])
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4
        const mx = cx - cx
        quad(
          lightAcc,
          pts[i],
          pts[j],
          top[j],
          top[i],
          [pts[i][0] - cx, 0, pts[i][2] - cz],
          mastCol
        )
      }
      // 灯板
      const bx = 7
      quad(
        lightAcc,
        [cx - bx, yTop, cz - 0.4],
        [cx + bx, yTop, cz - 0.4],
        [cx + bx, yTop + 5, cz - 0.4],
        [cx - bx, yTop + 5, cz - 0.4],
        [0, 0, -1],
        new THREE.Color('#e8e2d0')
      )
      quad(
        lightAcc,
        [cx - bx, yTop, cz + 0.4],
        [cx + bx, yTop, cz + 0.4],
        [cx + bx, yTop + 5, cz + 0.4],
        [cx - bx, yTop + 5, cz + 0.4],
        [0, 0, 1],
        new THREE.Color('#e8e2d0')
      )
    }

    const lightGeo = accToGeometry(lightAcc)
    if (lightGeo) {
      const m = new THREE.Mesh(lightGeo, getVertexColorMaterial())
      m.name = 'floodlights'
      group.add(m)
    }
  }

  group.userData.footprint = {
    halfX: halfX0 + rows * rowDepth + facadeThickness,
    halfZ: halfZ0 + rows * rowDepth + facadeThickness,
    height: topY + (withRoof ? roofRise + roofThickness : 0),
  }

  return group
}

/** 占位盒（P2 用，P3 前先验证配准） */
export function createStadiumPlaceholder(halfX, halfZ, height, color) {
  const geo = new THREE.BoxGeometry(halfX * 2, height, halfZ * 2)
  geo.translate(0, height / 2, 0)
  const mat = new THREE.MeshLambertMaterial({ color })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.name = 'stadium-placeholder'
  return mesh
}
