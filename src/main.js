/**
 * main.js — 装配入口
 *
 * 流程：场景 → 天空 → 地面 → 城市（建筑/道路/水/绿/树/路灯）→ 球场 → 相机 → HUD → 主循环
 *
 * 配准自检：两球场距离必须 ≈ 6.4 km，对不上说明投影或数据错了（方案 §6.1）。
 */

import * as THREE from 'three'

import {
  createScene,
  createRenderer,
  createCamera,
  createLights,
  handleResize,
  IS_MOBILE,
} from './core/scene.js'
import { ll2xy, OT, ETIHAD, OT_ETIHAD_DISTANCE } from './core/geo.js'
import { getBuildingMaterial, getWaterMaterial } from './core/materials.js'

import { createGround } from './city/ground.js'
import { createBuildings } from './city/buildings.js'
import { createRoads } from './city/roads.js'
import { createWater } from './city/water.js'
import { createGreen } from './city/green.js'
import { createTrees, createBuildingGrid } from './city/trees.js'
import { createStreetLights } from './city/streetlights.js'
import { createSky } from './city/sky.js'

import { createOldTrafford } from './stadiums/oldTrafford.js'
import { createEtihad } from './stadiums/etihad.js'

import { createControls } from './camera/controls.js'
import { createTour } from './camera/tour.js'
import { createDayNight } from './core/daynight.js'
import { createEggs } from './egg/egg.js'

import { initHud, setLoadingText, hideLoading, setTitle, updateStats } from './ui/hud.js'

// city.json 单独放 public/，运行时 fetch。
// 若打进 JS 包体，6.7MB 的 JSON 会让手机端 JS 解析卡死（方案 §6.8 移动端不是可选项）。

// ───────────────────────── 主流程 ─────────────────────────

async function main() {
  initHud()
  setLoadingText('加载城市数据…')

  const cityData = await fetch('./data/city.json').then((r) => {
    if (!r.ok) throw new Error(`city.json 加载失败 HTTP ${r.status}`)
    return r.json()
  })

  const canvas = document.getElementById('app')
  const scene = createScene()
  const renderer = createRenderer(canvas)
  const camera = createCamera()
  const controls = createControls(camera, renderer.domElement)
  const lights = createLights(scene)

  const tick = async (label, fn) => {
    setLoadingText(label)
    await new Promise((r) => requestAnimationFrame(() => r()))
    const t0 = performance.now()
    const out = fn()
    return { out, ms: performance.now() - t0 }
  }

  // ── 天空（天穹 + 云，昼夜联动在下方注册） ──
  const sky = await tick('铺天空…', () => createSky())
  scene.add(sky.out.group)

  // ── 地面 ──
  const ground = await tick('铺设地面…', () => createGround(40000))
  scene.add(ground.out)

  // ── 城市 ──
  const maxH = Math.max(60, ...cityData.buildings.map((b) => b.h))
  const buildings = await tick(
    `挤出建筑（${cityData.buildings.length} 栋）…`,
    () => createBuildings(cityData.buildings, maxH)
  )
  scene.add(buildings.out)

  const roads = await tick(
    `铺设道路（${cityData.roads.length} 段）…`,
    () => createRoads(cityData.roads, cityData.rails)
  )
  scene.add(roads.out)

  const water = await tick('注入水系…', () =>
    createWater(cityData.water, cityData.waterways)
  )
  scene.add(water.out)

  const green = await tick('种植绿地…', () => createGreen(cityData.green))
  scene.add(green.out)

  // ── 树 + 路灯（共用建筑包围盒空间哈希，避免"长在楼里"） ──
  const grid = createBuildingGrid(cityData.buildings)

  const trees = await tick('种树…', () =>
    createTrees({
      buildings: cityData.buildings,
      roads: cityData.roads,
      green: cityData.green,
      grid,
    })
  )
  scene.add(trees.out)

  const lamps = await tick('立路灯…', () => createStreetLights(cityData.roads, grid))
  scene.add(lamps.out.group)

  // ── 球场 ──
  const ot = await tick('建造老特拉福德…', () => createOldTrafford())
  scene.add(ot.out)

  const etihad = await tick('建造伊蒂哈德…', () => createEtihad())
  scene.add(etihad.out)

  // ── 配准自检 ──
  const otPos = ot.out.position
  const etPos = etihad.out.position
  const measured = otPos.distanceTo(etPos)
  const regError = Math.abs(measured - OT_ETIHAD_DISTANCE)
  console.log(
    `[配准] 两球场实测距离 ${measured.toFixed(0)} m，期望 ${OT_ETIHAD_DISTANCE.toFixed(0)} m，误差 ${regError.toFixed(1)} m`
  )
  if (regError > 100) {
    console.warn('[配准] ⚠️ 误差超过 100m，检查 core/geo.js 的投影')
  }
  console.log(
    `[朝向] 老特拉福德 yaw=${ot.out.userData.meta.yawDeg.toFixed(2)}°  ` +
      `伊蒂哈德 yaw=${etihad.out.userData.meta.yawDeg.toFixed(2)}°`
  )

  // ── 相机初始位置：对准老特拉福德 ──
  controls.target.copy(otPos).setY(12)
  camera.position.set(otPos.x + 620, 470, otPos.z + 780)
  controls.update()

  // ── HUD ──
  const bStats = buildings.out.userData.stats
  console.log(
    `[建筑] A环 ${bStats.A} / B环 ${bStats.B} / C环 ${bStats.C} / 丢弃 ${bStats.dropped}`
  )
  console.log(`[树] ${trees.out.userData.count} 棵 · [路灯] ${lamps.out.group.userData.count} 盏`)
  setTitle(
    'MANCHESTER',
    `${OT.name} · ${cityData.buildings.length} 栋建筑 · ` +
      `配准误差 ${regError.toFixed(0)} m`
  )

  // ── 昼夜系统：把所有"跟着天色走"的东西注册进来 ──
  const dayNight = createDayNight(scene, lights)
  dayNight.registerWindows(getBuildingMaterial()) // 建筑窗格夜晚亮起
  dayNight.registerDome(sky.out.setBlend) // 天穹顶点色重算
  const groundPlane = ground.out.getObjectByName('ground-plane')
  if (groundPlane) {
    // 夜晚地面压到深灰蓝——视频的夜城地面比白天深一个数量级
    dayNight.registerLerp(
      groundPlane.material,
      'color',
      new THREE.Color('#d4d1c8'),
      new THREE.Color('#3d424b')
    )
  }
  dayNight.registerLerp(sky.out.cloudMat, 'color', new THREE.Color('#ffffff'), new THREE.Color('#33455e'))
  dayNight.registerLerp(sky.out.cloudMat, 'emissiveIntensity', 0.5, 0.05)
  dayNight.registerLerp(sky.out.cloudMat, 'opacity', 0.95, 0.5)
  dayNight.registerLerp(getWaterMaterial(), 'color', new THREE.Color('#6fb7d6'), new THREE.Color('#0f2f47'))
  dayNight.registerLerp(getWaterMaterial(), 'emissiveIntensity', 0.14, 0.4)
  dayNight.registerLerp(lamps.out.poleMat, 'opacity', 0, 1, true) // 灯杆夜里显形
  dayNight.registerLerp(lamps.out.headMat, 'opacity', 0, 1, true) // 路灯头夜里亮
  dayNight.registerLerp(lamps.out.poolMat, 'opacity', 0, 0.18, true) // 地面光池

  // ── 相机 Tour ──
  const chapterEl = document.getElementById('chapter')
  let chapterTimer = null
  const tour = createTour(camera, controls, {
    onChapter(chapter) {
      if (!chapterEl) return
      // 章节字幕：关键词高亮（参考视频同款的电影字幕条）
      const parts = Array.isArray(chapter) ? chapter : [{ t: String(chapter) }]
      chapterEl.innerHTML = parts
        .map((p) => (p.hl ? `<span class="hl">${p.t}</span>` : p.t))
        .join('')
      chapterEl.classList.add('show')
      clearTimeout(chapterTimer)
      chapterTimer = setTimeout(() => chapterEl.classList.remove('show'), 5200)
    },
    onFinish() {
      btnTour.textContent = '▶ 一键 Tour'
      btnTour.classList.remove('active')
    },
  })

  // ── UI 按钮 ──
  const btnTour = document.getElementById('btn-tour')
  const btnDayNight = document.getElementById('btn-daynight')
  const btnFree = document.getElementById('btn-free')

  btnTour.addEventListener('click', () => {
    if (tour.playing) {
      tour.stop()
    } else {
      btnTour.textContent = '■ 停止 Tour'
      btnTour.classList.add('active')
      tour.start()
    }
  })

  btnDayNight.addEventListener('click', () => {
    dayNight.toggle()
    btnDayNight.textContent = dayNight.isNight ? '☀ 白天' : '🌙 夜景'
    btnDayNight.classList.toggle('active', dayNight.isNight)
  })

  btnFree.addEventListener('click', () => {
    tour.stop()
    // 回到默认视角
    controls.target.copy(otPos).setY(12)
    camera.position.set(otPos.x + 620, 470, otPos.z + 780)
    controls.update()
  })

  // ── 彩蛋：键入 1999（金色奖杯）/ 1000（双色烟花 + 传奇墙）──
  const eggs = createEggs(scene, {
    onSubtitle(text) {
      if (!chapterEl) return
      chapterEl.textContent = text
      chapterEl.classList.add('show')
      clearTimeout(chapterTimer)
      chapterTimer = setTimeout(() => chapterEl.classList.remove('show'), 6000)
    },
  })

  hideLoading()

  // ── 主循环 ──
  handleResize(renderer, camera)

  // 用户拖动 = 中断 Tour（方案 §6.7：别跟用户抢相机）
  let userDragged = false
  const markDrag = () => {
    userDragged = true
  }
  renderer.domElement.addEventListener('pointerdown', markDrag)
  renderer.domElement.addEventListener('wheel', markDrag, { passive: true })

  let last = performance.now()
  let fps = 60
  let acc = 0
  let frames = 0

  function animate(now) {
    requestAnimationFrame(animate)

    const dt = Math.min(0.1, (now - last) / 1000)
    last = now
    acc += dt * 1000
    frames++
    if (acc >= 400) {
      fps = (frames / acc) * 1000
      acc = 0
      frames = 0
    }

    dayNight.update(dt)
    tour.update(dt, userDragged) // dt 已是秒；TOUR_DURATION 也是秒，单位必须一致
    eggs.update(dt)
    userDragged = false

    controls.update()
    renderer.render(scene, camera)

    if (acc === 0) {
      updateStats(
        {
          fps,
          triangles: renderer.info.render.triangles,
          calls: renderer.info.render.calls,
        },
        `建筑 ${bStats.A + bStats.B + bStats.C}${IS_MOBILE ? ' · 移动端' : ''}`
      )
    }
  }

  requestAnimationFrame(animate)

  // 调试用：暴露到全局
  window.__manchester = { scene, camera, renderer, controls, ot: ot.out, etihad: etihad.out }
  window.__tour = tour
}

main().catch((err) => {
  console.error('启动失败：', err)
  const el = document.getElementById('loading-text')
  if (el) el.textContent = '启动失败：' + err.message
})
