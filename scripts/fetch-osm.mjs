#!/usr/bin/env node
/**
 * fetch-osm.mjs — 从 Overpass 拉取曼彻斯特区域 OSM 数据
 *
 * 纪律（见方案 §6.3）：
 *   - 分片请求，单片 ≤ 3km 边长
 *   - 串行 + 429/5xx 指数退避重试
 *   - 结果立刻落盘到 data/raw/，运行时零依赖 Overpass
 *
 * 用法：
 *   node scripts/fetch-osm.mjs p1     # 老特拉福德周边 1km²（垂直切片）
 *   node scripts/fetch-osm.mjs full   # 全域 7.8km × 13.3km
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const RAW_DIR = path.join(ROOT, 'data', 'raw')

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
]

const USER_AGENT = 'ManchesterBlockyDemo/0.1 (offline build script; OSM ODbL)'

/** bbox = [south, west, north, east] */
const AREAS = {
  p1: {
    label: 'p1-oldtrafford',
    bbox: [53.458, -2.297, 53.468, -2.285],
    grid: [1, 1],
  },
  full: {
    label: 'full',
    bbox: [53.44, -2.33, 53.51, -2.13],
    grid: [5, 3], // [lonTiles, latTiles] → 15 片，每片约 2.7km × 2.6km
  },
}

const QUERY = (bbox) => `[out:json][timeout:180];
(
  way["building"](${bbox});
  way["highway"](${bbox});
  way["railway"](${bbox});
  way["natural"="water"](${bbox});
  way["waterway"](${bbox});
  way["leisure"~"^(park|pitch|garden)$"](${bbox});
  way["landuse"~"^(grass|forest|meadow|recreation_ground)$"](${bbox});
);
out geom;`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function tileBBoxes({ bbox, grid }) {
  const [south, west, north, east] = bbox
  const [nx, ny] = grid
  const dLat = (north - south) / ny
  const dLon = (east - west) / nx
  const out = []
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      out.push({
        ix,
        iy,
        bbox: [
          south + iy * dLat,
          west + ix * dLon,
          south + (iy + 1) * dLat,
          west + (ix + 1) * dLon,
        ],
      })
    }
  }
  return out
}

async function fetchTile(tile, attempt = 0) {
  const endpoint = ENDPOINTS[attempt % ENDPOINTS.length]
  const body = new URLSearchParams({ data: QUERY(tile.bbox.join(',')) })

  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 200_000)

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': USER_AGENT,
      },
      body,
      signal: ac.signal,
    })

    if (res.status === 429 || res.status === 504 || res.status >= 500) {
      throw Object.assign(new Error(`HTTP ${res.status}`), { retryable: true })
    }
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`)
    }

    const json = await res.json()
    return json
  } finally {
    clearTimeout(timer)
  }
}

async function fetchTileWithRetry(tile, maxAttempts = 5) {
  let lastErr
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const json = await fetchTile(tile, attempt)
      return json
    } catch (err) {
      lastErr = err
      const backoff = Math.min(60_000, 2000 * 2 ** attempt)
      console.warn(
        `    ! tile(${tile.ix},${tile.iy}) 第 ${attempt + 1} 次失败：${err.message}` +
          (attempt + 1 < maxAttempts ? ` — ${Math.round(backoff / 1000)}s 后重试` : '')
      )
      if (attempt + 1 < maxAttempts) await sleep(backoff)
    }
  }
  throw lastErr
}

async function main() {
  const key = process.argv[2] ?? 'p1'
  const area = AREAS[key]
  if (!area) {
    console.error(`未知区域 "${key}"，可选：${Object.keys(AREAS).join(' / ')}`)
    process.exit(1)
  }

  await fs.mkdir(RAW_DIR, { recursive: true })

  const tiles = tileBBoxes(area)
  console.log(`区域：${area.label}`)
  console.log(`bbox：${area.bbox.join(', ')}`)
  console.log(`分片：${tiles.length} 个\n`)

  let totalWays = 0
  let totalBytes = 0

  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i]
    const outPath = path.join(RAW_DIR, `${area.label}_${tile.ix}_${tile.iy}.json`)

    // 已存在则跳过（断点续传）
    try {
      const st = await fs.stat(outPath)
      if (st.size > 0) {
        const cached = JSON.parse(await fs.readFile(outPath, 'utf8'))
        const n = cached.elements?.length ?? 0
        totalWays += n
        totalBytes += st.size
        console.log(`[${i + 1}/${tiles.length}] 已存在，跳过  ${path.basename(outPath)}  (${n} ways)`)
        continue
      }
    } catch {
      /* 不存在，正常抓取 */
    }

    console.log(`[${i + 1}/${tiles.length}] 抓取中  ${tile.bbox.map((v) => v.toFixed(3)).join(', ')}`)
    const json = await fetchTileWithRetry(tile)
    const text = JSON.stringify(json)
    await fs.writeFile(outPath, text, 'utf8')

    const n = json.elements?.length ?? 0
    totalWays += n
    totalBytes += text.length
    console.log(`           ✓ ${n} ways, ${(text.length / 1024).toFixed(0)} KB`)

    if (i + 1 < tiles.length) await sleep(1500) // 礼貌间隔
  }

  console.log(`\n完成。共 ${totalWays} 个 way，落盘 ${(totalBytes / 1024 / 1024).toFixed(1)} MB`)
  console.log(`原始数据：${path.relative(ROOT, RAW_DIR)}/`)
}

main().catch((err) => {
  console.error('\n抓取失败：', err)
  process.exit(1)
})
