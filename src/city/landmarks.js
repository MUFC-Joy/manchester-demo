/**
 * landmarks.js — 轻量地标标签层（v2 问题七 / P5）
 *
 * 17 个中英双语标签（用户拍板：双语），每帧把锚点投影到屏幕坐标，
 * 纯 DOM 定位——17 个元素的开销可以忽略。
 * 相机背面的标签自动隐藏；整体可由 HUD 按钮开关。
 */

import * as THREE from 'three'
import { ll2xy } from '../core/geo.js'

const LANDMARKS = [
  { en: 'Old Trafford', zh: '老特拉福德球场', lat: 53.46307, lon: -2.29135, y: 40, tone: 'ot' },
  { en: 'Etihad Stadium', zh: '伊蒂哈德球场', lat: 53.48314, lon: -2.20053, y: 40, tone: 'et' },
  { en: 'Manchester Town Hall', zh: '曼城市政厅', lat: 53.47718, lon: -2.24370, y: 34 },
  { en: 'Manchester Cathedral', zh: '曼彻斯特大教堂', lat: 53.48620, lon: -2.24480, y: 16 },
  { en: 'National Football Museum', zh: '国家足球博物馆', lat: 53.48630, lon: -2.24230, y: 14 },
  { en: 'Deansgate Square', zh: '迪恩斯盖特广场塔楼', lat: 53.47180, lon: -2.24950, y: 72 },
  { en: 'Piccadilly Station', zh: '皮卡迪利车站', lat: 53.47730, lon: -2.23090, y: 14 },
  { en: 'Victoria Station', zh: '维多利亚车站', lat: 53.48790, lon: -2.24570, y: 14 },
  { en: 'Salford Quays', zh: '索尔福德码头', lat: 53.47050, lon: -2.29300, y: 10 },
  { en: 'MediaCityUK', zh: '媒体城', lat: 53.47270, lon: -2.29920, y: 26 },
  { en: 'Castlefield', zh: '城堡区', lat: 53.47340, lon: -2.25300, y: 8 },
  { en: 'Northern Quarter', zh: '北角区', lat: 53.48450, lon: -2.23600, y: 8 },
  { en: 'Chinatown', zh: '中国城', lat: 53.47670, lon: -2.24020, y: 8 },
  { en: 'Philips Park', zh: '菲利普斯公园', lat: 53.48480, lon: -2.20400, y: 6 },
  { en: 'Mayfield Park', zh: '梅菲尔德公园', lat: 53.47650, lon: -2.22950, y: 6 },
  // 水系标签（用户问"这是真实的运河吗"——让地图自解释）
  { en: 'Rochdale Canal', zh: '罗奇代尔运河', lat: 53.47490, lon: -2.23890, y: 5 },
  { en: 'Manchester Ship Canal', zh: '曼彻斯特海船运河', lat: 53.46950, lon: -2.28800, y: 5 },
]

export function createLandmarks() {
  const container = document.createElement('div')
  container.id = 'labels'
  container.dataset.on = '1'
  document.body.appendChild(container)

  const items = LANDMARKS.map((m) => {
    const { x, z } = ll2xy(m.lat, m.lon)
    const el = document.createElement('div')
    el.className = 'label'
    if (m.tone) el.classList.add(`label-${m.tone}`)
    el.innerHTML = `<span class="en">${m.en}</span><span class="zh">${m.zh}</span>`
    container.appendChild(el)
    return { el, pos: new THREE.Vector3(x, m.y, z) }
  })

  const v = new THREE.Vector3()

  return {
    group: container,

    /** 每帧调用：把标签锚点投影到屏幕坐标 */
    update(camera, renderer) {
      const w = renderer.domElement.clientWidth
      const h = renderer.domElement.clientHeight
      for (const it of items) {
        v.copy(it.pos).project(camera)
        // 投影到相机背后时 z 会越过 [-1,1]，直接隐藏
        if (v.z > 1) {
          it.el.style.display = 'none'
          continue
        }
        it.el.style.display = ''
        it.el.style.left = `${((v.x + 1) / 2) * w}px`
        it.el.style.top = `${((1 - v.y) / 2) * h}px`
      }
    },

    toggle(on) {
      container.dataset.on = on ? '1' : '0'
    },

    get enabled() {
      return container.dataset.on === '1'
    },
  }
}
