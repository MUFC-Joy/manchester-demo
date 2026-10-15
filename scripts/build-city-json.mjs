#!/usr/bin/env node
/**
 * build-city-json.mjs — OSM 原始数据 → 精简 city.json
 *
 * 四件事（方案 §6.3）：
 *   ① Douglas-Peucker 简化轮廓（容差 1.5m）
 *   ② 高度量化到 4m 阶梯（风格 + 省面）
 *   ③ ll2xy 投影 + 顶点网格吸附（方块感）
 *   ④ 输出紧凑单文件 src/data/city.json
 *
 * 用法：node scripts/build-city-json.mjs [p1|full]
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ll2xy, LAT0, LON0 } from '../src/core/geo.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const RAW_DIR = path.join(ROOT, 'data', 'raw')
const OUT_PATH = path.join(ROOT, 'public', 'data', 'city.json')

// ───────────────────────── 风格锚点（方案 §6.4）─────────────────────────
const GRID = 2.0 // 顶点吸附网格（米）—— 方块感的来源之一
const DP_TOL = 1.5 // 轮廓简化容差（米）
const H_STEP = 4 // 高度阶梯（米）
const MIN_AREA = 30 // 小于此面积的建筑直接丢弃（m²）
const MIN_LEN = 8 // 短于此长度的线段丢弃（米）

// ───────────────────────── 确定性伪随机 ─────────────────────────
// 用 OSM id 做种子，保证每次构建结果一致（方案 §9.1 可复现）
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

// ───────────────────────── 几何工具 ─────────────────────────

/** Douglas-Peucker 折线简化 */
function simplify(points, tol) {
  if (points.length <= 3) return points

  const sqTol = tol * tol
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1

  const stack = [[0, points.length - 1]]
  while (stack.length) {
    const [first, last] = stack.pop()
    let maxDist = -1
    let index = -1

    const [ax, ay] = points[first]
    const [bx, by] = points[last]
    const dx = bx - ax
    const dy = by - ay
    const lenSq = dx * dx + dy * dy

    for (let i = first + 1; i < last; i++) {
      const [px, py] = points[i]
      let d
      if (lenSq === 0) {
        d = (px - ax) ** 2 + (py - ay) ** 2
      } else {
        let t = ((px - ax) * dx + (py - ay) * dy) / lenSq
        t = t < 0 ? 0 : t > 1 ? 1 : t
        d = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2
      }
      if (d > maxDist) {
        maxDist = d
        index = i
      }
    }

    if (maxDist > sqTol && index > 0) {
      keep[index] = 1
      stack.push([first, index], [index, last])
    }
  }

  const out = []
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i])
  return out
}

/** 顶点吸附到网格 + 去除连续重复点 */
function snap(points, grid) {
  const out = []
  let prev = null
  for (const [x, y] of points) {
    const sx = Math.round(x / grid) * grid
    const sy = Math.round(y / grid) * grid
    if (prev && prev[0] === sx && prev[1] === sy) continue
    out.push([sx, sy])
    prev = [sx, sy]
  }
  // 首尾若重合，去掉尾点
  if (out.length > 1) {
    const a = out[0]
    const b = out[out.length - 1]
    if (a[0] === b[0] && a[1] === b[1]) out.pop()
  }
  return out
}

/** 多边形面积（鞋带公式，绝对值） */
function polygonArea(pts) {
  let s = 0
  for (let i = 0, n = pts.length; i < n; i++) {
    const [x1, y1] = pts[i]
    const [x2, y2] = pts[(i + 1) % n]
    s += x1 * y2 - x2 * y1
  }
  return Math.abs(s) / 2
}

/** 折线长度 */
function polylineLength(pts) {
  let len = 0
  for (let i = 1; i < pts.length; i++) {
    len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
  }
  return len
}

/** 闭合环是否首尾重合 */
function isClosed(geom) {
  if (geom.length < 4) return false
  const a = geom[0]
  const b = geom[geom.length - 1]
  return a.lat === b.lat && a.lon === b.lon
}

// ───────────────────────── 高度策略（方案附录 B）─────────────────────────

function parseNumeric(v) {
  if (v == null) return null
  const m = String(v).match(/-?\d+(\.\d+)?/)
  return m ? parseFloat(m[0]) : null
}

function quantizeHeight(tags, area, id) {
  const rand = seededRand(id)
  let h

  const rawHeight = parseNumeric(tags['height'])
  const levels = parseNumeric(tags['building:levels'])

  if (rawHeight != null && rawHeight > 0) {
    h = rawHeight
  } else if (levels != null && levels > 0) {
    h = levels * 3.2
  } else if (area > 2000) {
    h = 15 + rand() * 25 // 大体量：市中心写字楼
  } else if (area > 600) {
    h = 9 + rand() * 10 // 中等：商铺/公共建筑
  } else {
    h = 6 + rand() * 6 // 小体量：联排住宅
  }

  return Math.max(H_STEP, Math.round(h / H_STEP) * H_STEP)
}

// ───────────────────────── 分类 ─────────────────────────

const GREEN_LEISURE = new Set(['park', 'pitch', 'garden'])
const GREEN_LANDUSE = new Set(['grass', 'forest', 'meadow', 'recreation_ground'])

function classify(tags, closed) {
  // 关键排除：球场本身在 OSM 里标为 building=stadium（老特拉福德的四个看台就是
  // 四个独立的 building=stadium way）。它们由 stadiums/ 程序化生成，
  // 若不排除会被挤出成灰色盒子，正好盖住整个碗形看台。
  if (tags.building === 'stadium' || tags.leisure === 'stadium') return null
  if (tags.building && tags.building !== 'no') return 'building'
  if (tags['natural'] === 'water') return 'water'
  if (tags.waterway) return 'waterway'
  if (tags.highway) return 'road'
  if (tags.railway) return 'rail'
  if (closed && GREEN_LEISURE.has(tags.leisure)) return 'green'
  if (closed && GREEN_LANDUSE.has(tags.landuse)) return 'green'
  return null
}

/** 道路分级 → 色板索引 */
function roadClass(tags) {
  const hw = tags.highway
  if (hw === 'motorway' || hw === 'trunk' || hw === 'primary') return 0 // 主干
  if (hw === 'secondary' || hw === 'tertiary') return 1 // 次干
  return 2 // 支路/步道
}

/** 建筑用途 → 色板索引 */
function buildingClass(tags) {
  const b = tags.building
  if (b === 'commercial' || b === 'office' || b === 'retail') return 0
  if (b === 'industrial' || b === 'warehouse') return 2
  if (b === 'church' || b === 'cathedral' || b === 'civic') return 3
  return 1 // 默认住宅
}

// ───────────────────────── 主流程 ─────────────────────────

async function main() {
  const key = process.argv[2] ?? 'p1'

  let files
  try {
    files = (await fs.readdir(RAW_DIR)).filter((f) => f.endsWith('.json'))
  } catch {
    console.error(`找不到 ${RAW_DIR}，请先运行 npm run fetch-osm`)
    process.exit(1)
  }

  // 只处理与区域匹配的分片（p1_* 或 full_*）
  const prefix = key === 'p1' ? 'p1-oldtrafford' : 'full'
  files = files.filter((f) => f.startsWith(prefix))
  if (!files.length) {
    console.error(`没有匹配 "${prefix}" 的分片，先运行：node scripts/fetch-osm.mjs ${key}`)
    process.exit(1)
  }

  console.log(`读取 ${files.length} 个分片…`)

  // 按 way id 去重（分片边界会重叠）
  const ways = new Map()
  for (const f of files) {
    const json = JSON.parse(await fs.readFile(path.join(RAW_DIR, f), 'utf8'))
    for (const el of json.elements ?? []) {
      if (el.type !== 'way' || !el.geometry) continue
      if (!ways.has(el.id)) ways.set(el.id, el)
    }
  }
  console.log(`去重后 ${ways.size} 个 way`)

  const out = {
    meta: {
      origin: { lat: LAT0, lon: LON0 },
      source: 'OpenStreetMap contributors (ODbL)',
      grid: GRID,
      heightStep: H_STEP,
    },
    buildings: [],
    roads: [],
    rails: [],
    water: [],
    waterways: [],
    green: [],
  }

  const skipped = { tiny: 0, degenerate: 0, unclassified: 0 }

  for (const [id, el] of ways) {
    const tags = el.tags ?? {}
    const closed = isClosed(el.geometry)
    const kind = classify(tags, closed)
    if (!kind) {
      skipped.unclassified++
      continue
    }

    // 经纬度 → 米制局部坐标
    let pts = el.geometry.map((g) => {
      const { x, z } = ll2xy(g.lat, g.lon)
      return [x, z]
    })

    const isPolygon = kind === 'building' || kind === 'water' || kind === 'green'

    if (isPolygon) {
      if (!closed) {
        skipped.degenerate++
        continue
      }
      pts = simplify(pts, DP_TOL)
      pts = snap(pts, GRID)
      if (pts.length < 3) {
        skipped.degenerate++
        continue
      }
      const area = polygonArea(pts)
      if (area < MIN_AREA) {
        skipped.tiny++
        continue
      }

      // 扁平化输出，坐标取整省体积
      const flat = []
      for (const [x, y] of pts) flat.push(Math.round(x), Math.round(y))

      if (kind === 'building') {
        out.buildings.push({
          p: flat,
          h: quantizeHeight(tags, area, id),
          k: buildingClass(tags),
        })
      } else if (kind === 'water') {
        out.water.push({ p: flat })
      } else {
        out.green.push({ p: flat, k: tags.leisure === 'pitch' ? 1 : 0 })
      }
    } else {
      // 线要素
      pts = simplify(pts, DP_TOL)
      if (polylineLength(pts) < MIN_LEN) {
        skipped.tiny++
        continue
      }
      const flat = []
      for (const [x, y] of pts) flat.push(Math.round(x), Math.round(y))

      if (kind === 'road') {
        out.roads.push({ p: flat, k: roadClass(tags) })
      } else if (kind === 'rail') {
        out.rails.push({ p: flat })
      } else {
        out.waterways.push({
          p: flat,
          w: tags.waterway === 'river' ? 26 : tags.waterway === 'canal' ? 18 : 8,
        })
      }
    }
  }

  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true })
  const text = JSON.stringify(out)
  await fs.writeFile(OUT_PATH, text, 'utf8')

  // ── 报告 ──
  const heights = out.buildings.map((b) => b.h)
  const maxH = heights.length ? Math.max(...heights) : 0
  const avgH = heights.length ? heights.reduce((a, b) => a + b, 0) / heights.length : 0
  const verts = out.buildings.reduce((a, b) => a + b.p.length / 2, 0)

  console.log('\n─── 构建结果 ───')
  console.log(`建筑   ${out.buildings.length} 栋（顶点 ${verts}，平均高 ${avgH.toFixed(1)}m，最高 ${maxH}m）`)
  console.log(`道路   ${out.roads.length} 段`)
  console.log(`铁路   ${out.rails.length} 段`)
  console.log(`水面   ${out.water.length} 块`)
  console.log(`水道   ${out.waterways.length} 段`)
  console.log(`绿地   ${out.green.length} 块`)
  console.log(`丢弃   过小 ${skipped.tiny} / 退化 ${skipped.degenerate} / 未分类 ${skipped.unclassified}`)
  console.log(`\n输出   ${path.relative(ROOT, OUT_PATH)}  ${(text.length / 1024).toFixed(0)} KB`)
  console.log(`       gzip 后约 ${(text.length / 1024 / 3).toFixed(0)} KB`)
}

main().catch((err) => {
  console.error('构建失败：', err)
  process.exit(1)
})
