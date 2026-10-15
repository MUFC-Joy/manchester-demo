/**
 * oldTrafford.js — 老特拉福德（梦剧场）
 *
 * 形体特征：四个独立大顶 + 角部开口，红座椅海。
 * 位置与朝向来自 core/geo.js 的实测值（zBearing 70.63°，三源互证）。
 */

import { createStadium } from './stadium.js'
import { OT, OT_YAW, ll2xy } from '../core/geo.js'
import { PALETTE } from '../core/materials.js'

export function createOldTrafford(opts = {}) {
  const group = createStadium({
    length: 105,
    width: 68,
    rows: 24,
    rowDepth: 0.95,
    rowHeight: 0.78,
    bowlMargin: 13,
    roofOverhang: 9,
    roofRise: 4.5,
    roofThickness: 2.2,
    // 只保留四条长边 → 四块独立大顶，角部留开口
    roofSegments: [0, 2, 4, 6],
    seatColor: PALETTE.seatOT,
    seatSpacing: 2.4,
    floodlightHeight: 44,
    cornerCut: 0.24,
    ...opts,
  })

  const { x, z } = ll2xy(OT.lat, OT.lon)
  group.position.set(x, 0, z)
  group.rotation.y = OT_YAW
  group.name = 'stadium-old-trafford'
  group.userData.meta = { ...OT, yawDeg: (OT_YAW * 180) / Math.PI }

  return group
}
