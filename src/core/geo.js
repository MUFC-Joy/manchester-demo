/**
 * geo.js — 全项目唯一的地理投影来源
 *
 * 约定（方案 §6.1）：
 *   - 全项目用局部平面坐标（米），不用经纬度渲染
 *   - 原点 = 两球场连线中点
 *   - Three.js 是 Y-up：地面是 XZ 平面，Y 是高度
 *   - 北 = -Z（屏幕上方）
 *
 * 这是全项目唯一做坐标换向的地方，其他模块只面对 {x, z} 平面坐标。
 *
 * ── 球场朝向：实测数据（方案 §6.1 要求"必须实测"）──────────────────
 *
 * Old Trafford — 三个独立来源互证：
 *   ① hszzhua2/stadium-seat-explorer 的 OLD_TRAFFORD_GEO_REFERENCE
 *      zBearing = 250.63°（+Z 指向 Stretford End），即长轴 70.63°
 *      来源：OSM way/165256230，MIT
 *   ② Nominatim 拉取球场建筑轮廓 way/99403577
 *      最长直边 115.9 m，方位 70.13°
 *   ③ PCA 主成分分析同一轮廓 → 73.69°
 *   ① 与 ② 相差仅 0.5°，判定可信。本项目取 70.63°。
 *
 * Etihad Stadium — 实测：
 *   Nominatim way/26329734 轮廓为弧形（最长边仅 24.5 m），直边法失效。
 *   改用球场草坪：OSM way/136117083（leisure=pitch, sport=soccer, surface=grass,
 *   距球场中心仅 12 m，115 × 85 m）→ 长轴 159.9°。
 *   周边同园区训练场 / 田径场长轴集中在 156~166°，朝向互相印证。
 *
 * 注意：以上均为地图量测值，非测绘级数据。
 */

export const LAT0 = 53.4731
export const LON0 = -2.2459

const M_PER_DEG_LAT = 111320
const M_PER_DEG_LON = 111320 * Math.cos((LAT0 * Math.PI) / 180) // ≈ 66270

/** 经纬度 → 局部平面米制坐标。x 向东为正，z 向南为正（北 = -z） */
export function ll2xy(lat, lon) {
  return {
    x: (lon - LON0) * M_PER_DEG_LON,
    z: -(lat - LAT0) * M_PER_DEG_LAT,
  }
}

/**
 * 方位角（度，从正北顺时针）→ Three.js 绕 Y 轴旋转角（弧度）
 *
 * 使物体本地 +X 轴指向该方位。
 * 推导：绕 Y 旋转 a 后 (1,0,0) → (cos a, 0, -sin a)；
 *       方位 θ 在世界中对应 (sin θ, 0, -cos θ)；
 *       联立得 a = π/2 − θ。
 */
export function yawFromBearing(bearingDeg) {
  return Math.PI / 2 - (bearingDeg * Math.PI) / 180
}

/** 全域 bbox：[south, west, north, east] */
export const BBOX = [53.44, -2.33, 53.51, -2.13]

/** 两座球场真实坐标 + 草坪长轴方位（度） */
export const OT = {
  id: 'old-trafford',
  name: 'Old Trafford',
  lat: 53.4630704,
  lon: -2.2913486,
  pitchBearing: 70.63,
  capacity: 74310,
  seatColor: 'seatOT',
}

export const ETIHAD = {
  id: 'etihad',
  name: 'Etihad Stadium',
  lat: 53.4831448,
  lon: -2.2005273,
  pitchBearing: 159.9,
  capacity: 53400,
  seatColor: 'seatEtihad',
}

/** 由 pitchBearing 推出的模型 yaw（弧度），本地 +X = 草坪长轴 */
export const OT_YAW = yawFromBearing(OT.pitchBearing)
export const ETIHAD_YAW = yawFromBearing(ETIHAD.pitchBearing)

/** 标准草坪尺寸（米）。OSM 量测含缓冲区，模型用国际标准值 */
export const PITCH = { length: 105, width: 68 }

/** 两球场直线距离（米）—— 放好后做配准断言用 */
export const OT_ETIHAD_DISTANCE = (() => {
  const a = ll2xy(OT.lat, OT.lon)
  const b = ll2xy(ETIHAD.lat, ETIHAD.lon)
  return Math.hypot(a.x - b.x, a.z - b.z)
})()
