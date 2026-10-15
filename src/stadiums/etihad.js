/**
 * etihad.js — 伊蒂哈德球场
 *
 * 形体特征：连续环形顶（索网意象），浅蓝座椅海。
 * 位置与朝向来自 core/geo.js 的实测值（草坪长轴 159.9°，OSM way/136117083）。
 */

import { createStadium } from './stadium.js'
import { ETIHAD, ETIHAD_YAW, ll2xy } from '../core/geo.js'
import { PALETTE } from '../core/materials.js'

export function createEtihad(opts = {}) {
  const group = createStadium({
    length: 105,
    width: 68,
    rows: 22,
    rowDepth: 0.92,
    rowHeight: 0.76,
    bowlMargin: 13,
    roofOverhang: 8,
    roofRise: 3.6,
    roofThickness: 1.9,
    // 整圈连续屋顶
    roofSegments: [0, 1, 2, 3, 4, 5, 6, 7],
    seatColor: PALETTE.seatEtihad,
    seatSpacing: 2.4,
    floodlightHeight: 38,
    cornerCut: 0.34, // 伊蒂哈德转角更圆
    ...opts,
  })

  const { x, z } = ll2xy(ETIHAD.lat, ETIHAD.lon)
  group.position.set(x, 0, z)
  group.rotation.y = ETIHAD_YAW
  group.name = 'stadium-etihad'
  group.userData.meta = { ...ETIHAD, yawDeg: (ETIHAD_YAW * 180) / Math.PI }

  return group
}
