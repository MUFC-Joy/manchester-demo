/**
 * hud.js — 顶部标题 / 底部图例与统计
 */

const els = {}

export function initHud() {
  els.title = document.getElementById('title')
  els.subtitle = document.getElementById('subtitle')
  els.stats = document.getElementById('stats')
  els.loading = document.getElementById('loading')
  els.loadingText = document.getElementById('loading-text')
}

export function setLoadingText(text) {
  if (els.loadingText) els.loadingText.textContent = text
}

export function hideLoading() {
  if (!els.loading) return
  els.loading.classList.add('is-hidden')
  setTimeout(() => els.loading?.remove(), 600)
}

export function setTitle(main, sub) {
  if (els.title) els.title.textContent = main
  if (els.subtitle) els.subtitle.textContent = sub
}

let lastText = ''
export function updateStats(info, extra) {
  if (!els.stats) return
  const text =
    `${Math.round(info.fps)} FPS · ` +
    `${(info.triangles / 1000).toFixed(0)}k 面 · ` +
    `${info.calls} draw calls` +
    (extra ? ` · ${extra}` : '')
  if (text !== lastText) {
    els.stats.textContent = text
    lastText = text
  }
}
