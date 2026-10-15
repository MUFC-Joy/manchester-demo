#!/usr/bin/env node
/**
 * build-city-json.mjs — OSM 原始数据 → 精简 city.json
 *
 * 五件事（方案 §6.3 + v2 改造 P1）：
 *   ① 核心区 bbox 过滤：线要素（道路/铁路/水道）裁剪到边界，面要素任一顶点在内即整体保留
 *   ② Douglas-Peucker 简化轮廓（容差 1.5m）
 *   ③ 高度量化到 4m 阶梯（风格 + 省面）
 *   ④ ll2xy 投影 + 顶点网格吸附（方块感）
 *   ⑤ 输出紧凑单文件 public/data/city.json
 *
 * 用法：node scripts/build-city-json.mjs full
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ll2xy, LAT0, LON0, CORE_BBOX, OT, ETIHAD } from '../src/core/geo.js'

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

/** 多边形质心（质心公式，退化时返回 null） */
function polygonCentroid(pts, area) {
  let cx = 0
  let cz = 0
  let s = 0
  for (let i = 0, n = pts.length; i < n; i++) {
    const [x1, y1] = pts[i]
    const [x2, y2] = pts[(i + 1) % n]
    const cross = x1 * y2 - x2 * y1
    s += cross
    cx += (x1 + x2) * cross
    cz += (y1 + y2) * cross
  }
  if (Math.abs(s) < 1e-6) return null
  return [cx / (3 * s), cz / (3 * s)]
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

// ───────────────────────── 核心区过滤（v2 P1）─────────────────────────

/** 核心区矩形（米制局部坐标） */
const CORE = (() => {
  const [south, west, north, east] = CORE_BBOX
  const a = ll2xy(south, west)
  const b = ll2xy(north, east)
  // ll2xy 里 z 南为正、北为负，minZ 取北边、maxZ 取南边
  return { minX: a.x, maxX: b.x, minZ: b.z, maxZ: a.z }
})()

function inCore(x, z) {
  return x >= CORE.minX && x <= CORE.maxX && z >= CORE.minZ && z <= CORE.maxZ
}

/** Liang–Barsky：线段对核心区矩形求交，返回裁剪后的 [x1,z1,x2,z2] 或 null */
function clipSegment(x1, z1, x2, z2) {
  const dx = x2 - x1
  const dz = z2 - z1
  let t0 = 0
  let t1 = 1
  const edges = [
    [-dx, x1 - CORE.minX],
    [dx, CORE.maxX - x1],
    [-dz, z1 - CORE.minZ],
    [dz, CORE.maxZ - z1],
  ]
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return null
    } else {
      const t = q / p
      if (p < 0) {
        if (t > t1) return null
        if (t > t0) t0 = t
      } else {
        if (t < t0) return null
        if (t < t1) t1 = t
      }
    }
  }
  return [
    x1 + dx * t0, z1 + dz * t0,
    x1 + dx * t1, z1 + dz * t1,
  ]
}

/**
 * 折线裁剪到核心区：可能被切成多段（穿越边界的情况）。
 * 返回 [x,z] 数组的数组。
 */
function clipLineToCore(pts) {
  const runs = []
  let cur = null
  for (let i = 0; i < pts.length - 1; i++) {
    const seg = clipSegment(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1])
    if (!seg) {
      if (cur && cur.length >= 2) runs.push(cur)
      cur = null
      continue
    }
    const [ax, az, bx, bz] = seg
    if (cur && Math.hypot(cur[cur.length - 1][0] - ax, cur[cur.length - 1][1] - az) < 0.5) {
      cur.push([bx, bz])
    } else {
      if (cur && cur.length >= 2) runs.push(cur)
      cur = [[ax, az], [bx, bz]]
    }
  }
  if (cur && cur.length >= 2) runs.push(cur)
  return runs
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
      // 保留几何更长的版本：兜底数据源按 bbox 截断过边缘时，短版不覆盖长版
      const prev = ways.get(el.id)
      if (!prev || prev.geometry.length < el.geometry.length) ways.set(el.id, el)
    }
  }
  console.log(`去重后 ${ways.size} 个 way`)

  const out = {
    meta: {
      origin: { lat: LAT0, lon: LON0 },
      source: 'OpenStreetMap contributors (ODbL)',
      coreBbox: CORE_BBOX,
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

  const skipped = { tiny: 0, degenerate: 0, unclassified: 0, outside: 0, stadium: 0 }

  // 两座球场中心（米制）——球场完全程序化生成（v2 问题四/九）：
  //   ① 剔除压在球场上的 OSM 草坪多边形（OT way/165256230）
  //   ② 剔除球场轮廓内的建筑 way——老特拉福德四个看台是 building=stadium（classify 已排除），
  //      但伊蒂哈德四个看台是 building=grandstand、另有 building=yes 的连接体（way/187164870 等），
  //      都会被当成普通建筑挤出成灰色巨环盖住整个碗形看台。实测两场看台质心距中心 65~108m，
  //      周边真实建筑最近 139m（OT）/170m（ET），130m 半径可以干净区分。
  const OT_XY = ll2xy(OT.lat, OT.lon)
  const ET_XY = ll2xy(ETIHAD.lat, ETIHAD.lon)
  const inStadiumBowl = (x, z) =>
    Math.hypot(x - OT_XY.x, z - OT_XY.z) < 130 ||
    Math.hypot(x - ET_XY.x, z - ET_XY.z) < 130

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
      // 核心区过滤：任一顶点在核心区内才整体保留（建筑不切半）
      if (!pts.some(([x, z]) => inCore(x, z))) {
        skipped.outside++
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

      // 球场范围内：OSM 草坪（问题九）和建筑 way（伊蒂哈德 grandstand 巨环）全部剔除
      if (kind === 'green' || kind === 'building') {
        const c = polygonCentroid(pts, area)
        if (c && inStadiumBowl(c[0], c[1])) {
          skipped.stadium++
          continue
        }
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
      // 线要素：裁剪到核心区（可能切成多段）
      const runs = clipLineToCore(pts)
      for (const run of runs) {
        const simplified = simplify(run, DP_TOL)
        if (polylineLength(simplified) < MIN_LEN) {
          skipped.tiny++
          continue
        }
        const flat = []
        for (const [x, y] of simplified) flat.push(Math.round(x), Math.round(y))

        if (kind === 'road') {
          out.roads.push({ p: flat, k: roadClass(tags) })
        } else if (kind === 'rail') {
          out.rails.push({ p: flat })
        } else {
          out.waterways.push({
            p: flat,
            // 大运河最宽、河次之、小溪最窄（v2 问题八：分级明显）
            w: tags.waterway === 'canal' ? 30 : tags.waterway === 'river' ? 22 : 9,
          })
        }
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
  console.log(`丢弃   过小 ${skipped.tiny} / 退化 ${skipped.degenerate} / 未分类 ${skipped.unclassified} / 核心区外 ${skipped.outside} / 球场内 ${skipped.stadium}`)
  console.log(`\n输出   ${path.relative(ROOT, OUT_PATH)}  ${(text.length / 1024).toFixed(0)} KB`)
  console.log(`       gzip 后约 ${(text.length / 1024 / 3).toFixed(0)} KB`)
}

main().catch((err) => {
  console.error('构建失败：', err)
  process.exit(1)
})
