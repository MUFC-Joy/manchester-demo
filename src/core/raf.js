/**
 * raf.js — 任何节流状态下都能推进的 requestAnimationFrame
 *
 * 浏览器对"隐藏标签页"和"完全遮挡的窗口"都会暂停 rAF：用户在加载中途
 * 切走/最小化，城市构建会永久卡在"铺天空…"（每一步都 await 下一帧）。
 *
 * nextFrame = 原生 rAF + 定时兜底赛跑：
 *   可见未遮挡 → rAF 赢，满帧率，零额外开销
 *   完全遮挡   → rAF 不来，250ms 定时器兜底（~4fps，够构建和巡游推进）
 *   后台标签页 → setTimeout 被节流到 1s，构建慢速爬完但不卡死
 */

export function nextFrame(cb) {
  let done = false
  const run = (now) => {
    if (done) return
    done = true
    cb(typeof now === 'number' ? now : performance.now())
  }
  requestAnimationFrame(run)
  setTimeout(() => run(performance.now()), 250)
}
