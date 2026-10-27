/**
 * 成绩卡 · 四维风格画像 + 1080×1440 分享图
 *
 * 这里只做两件事：
 *   1. 把 engine.js 抛出来的原始样本归一化成四个 0~1 的维度
 *   2. 用 Canvas 手绘一张可以直接发社交平台的竖版图（零外部依赖）
 *
 * 设计约束来自 DESIGN.md：纯白底、#0A0A0A 墨色、标题 weight 300、
 * 彩色只留给"坏消息"——所以卡片上不出现任何彩色。
 */

/** 评级按「每分钟得分」算，否则 120 秒局永远碾压 30 秒局 */
export const RANKS = [
  { min: 2000, name: '灵巧手', en: 'DEXTEROUS' },
  { min: 1400, name: '黄金手指', en: 'GOLD FINGERS' },
  { min: 900, name: '白银手指', en: 'SILVER' },
  { min: 500, name: '青铜手指', en: 'BRONZE' },
  { min: 0, name: '新手', en: 'ROOKIE' },
]

export const rateOf = (score, duration) => (duration > 0 ? (score / duration) * 60 : 0)
export const rankOf = (rate) => RANKS.find((r) => rate >= r.min) || RANKS[RANKS.length - 1]

/**
 * 力度基准：一次"正常"的闭合大约 2 g/s，甩满约 5 g/s。
 * 摄像头模式手势变化慢得多，基准要单独给，否则永远判你"没使劲"。
 */
const POWER_REF = { slider: 5.0, camera: 2.6 }
/** 连击峰值到这个数就算节奏满分 */
const COMBO_REF = 12

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)
const clamp01 = (v) => Math.max(0, Math.min(1, v))

const DIM_LABEL = {
  power: ['力度', 'FORCE'],
  precision: ['精度', 'PRECISION'],
  nerve: ['胆量', 'NERVE'],
  rhythm: ['节奏', 'RHYTHM'],
}

/** 前缀看"激进度"（力度+胆量），后缀看"精细度"（精度+节奏） */
function titleOf({ power, precision, nerve, rhythm }) {
  const aggression = (power + nerve) / 2
  const finesse = (precision + rhythm) / 2

  const prefix =
    aggression >= 0.66
      ? '莽夫型'
      : aggression >= 0.48
        ? '冒险派'
        : aggression >= 0.32
          ? '稳健派'
          : '谨慎派'

  let suffix
  if (finesse >= 0.7) suffix = '外科手'
  else if (finesse >= 0.54) suffix = '绣花手'
  else if (finesse >= 0.4) suffix = power >= 0.5 ? '铁砂掌' : '巧手'
  else suffix = power >= 0.55 ? '铁砂掌' : '糙手'

  return { prefix, suffix, name: `${prefix} · ${suffix}` }
}

const TAGLINE = {
  外科手: '误差在你手里，没有容身之处。',
  绣花手: '手很稳，只是偶尔还会想快一点。',
  巧手: '你知道该用多大劲——大部分时候。',
  铁砂掌: '东西是抓住了，就是碎得有点快。',
  糙手: '手感还没接通，再来一局找找。',
}

function dominantTagline(dims, suffix) {
  const top = dims.reduce((a, b) => (b.v > a.v ? b : a))
  if (top.v >= 0.55) {
    return {
      power: '你的手，比眼睛先动。',
      precision: '每一夹都落在该落的地方。',
      nerve: '易碎的东西，你也敢下手。',
      rhythm: '节奏一起，就没人能打断你。',
    }[top.key]
  }
  return TAGLINE[suffix] || TAGLINE['巧手']
}

/**
 * @param {object} result engine.onEnd 抛出的结果
 * @param {object} meta   { duration }
 */
export function buildProfile(result, meta = {}) {
  const stats = result.stats || {}
  const camMode = Boolean(stats.camMode)
  const duration = meta.duration || 90
  const rate = rateOf(result.score, duration)
  const rank = rankOf(rate)

  const powerSamples = stats.power || []
  const nerveSamples = stats.nerve || []
  const gaps = stats.gaps || []

  // 没有样本时给中性值，避免"这一局没出易碎物"被判成胆小
  const power = powerSamples.length
    ? clamp01(mean(powerSamples) / POWER_REF[camMode ? 'camera' : 'slider'])
    : 0.5
  const nerve = nerveSamples.length ? clamp01(mean(nerveSamples)) : 0.5
  const precision = gaps.length ? clamp01(1 - mean(gaps)) : 0
  const rhythm = clamp01((stats.maxCombo ?? result.maxCombo ?? 0) / COMBO_REF)

  const ids = ['power', 'precision', 'nerve', 'rhythm']
  const values = { power, precision, nerve, rhythm }
  const dims = ids.map((key) => ({
    key,
    label: DIM_LABEL[key][0],
    en: DIM_LABEL[key][1],
    v: values[key],
  }))

  const title = titleOf(values)
  // 一个都没抓住时，四维里有两维是"没数据"的中性值，
  // 硬套公式会给出"冒险派"这种看不出来的结论——单独给一句话
  const empty = !result.caught

  return {
    dims,
    values,
    title: empty ? { prefix: '—', suffix: '—', name: '手感未接通' } : title,
    tagline: empty ? '一个都没抓住。下一局，先别急着合拢。' : dominantTagline(dims, title.suffix),
    score: result.score,
    caught: result.caught,
    perfects: result.perfects,
    maxCombo: stats.maxCombo ?? result.maxCombo ?? 0,
    rate: result.rate,
    perMinute: rate,
    duration,
    rank,
    camMode,
    fragSeen: stats.fragSeen || 0,
    fragBroken: stats.fragBroken || 0,
  }
}

// ---------------------------------------------------------------- 绘图

const INK = '#0A0A0A'
const MUTED = 'rgba(10,10,10,0.45)'
const FAINT = 'rgba(10,10,10,0.09)'
const CJK = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'
const font = (weight, size) => `${weight} ${size}px Inter, ${CJK}`

/** 逐字绘制以支持字间距（Canvas 的 letterSpacing 兼容性不稳） */
function tracked(ctx, text, x, y, spacing, align = 'left') {
  const chars = [...text]
  const widths = chars.map((ch) => ctx.measureText(ch).width)
  const total = widths.reduce((a, b) => a + b, 0) + spacing * Math.max(0, chars.length - 1)
  let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x
  const prev = ctx.textAlign
  ctx.textAlign = 'left'
  chars.forEach((ch, i) => {
    ctx.fillText(ch, cx, y)
    cx += widths[i] + spacing
  })
  ctx.textAlign = prev
}

async function ensureFonts() {
  if (!document.fonts?.load) return
  try {
    await Promise.all([
      document.fonts.load(font(300, 210)),
      document.fonts.load(font(400, 28)),
      document.fonts.load(font(500, 64)),
    ])
    await document.fonts.ready
  } catch {
    /* 字体没加载上就退回系统字，不阻塞出图 */
  }
}

function drawRadar(ctx, cx, cy, R, dims) {
  // 四轴：上、右、下、左
  const angles = dims.map((_, i) => -Math.PI / 2 + (i * Math.PI) / 2)
  const pt = (i, k) => [cx + Math.cos(angles[i]) * R * k, cy + Math.sin(angles[i]) * R * k]

  // 网格环
  ctx.lineWidth = 1.5
  ctx.strokeStyle = FAINT
  for (let k = 1; k <= 4; k++) {
    ctx.beginPath()
    for (let i = 0; i < 4; i++) {
      const [x, y] = pt(i, k / 4)
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    }
    ctx.closePath()
    ctx.stroke()
  }

  // 轴线
  for (let i = 0; i < 4; i++) {
    const [x, y] = pt(i, 1)
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.lineTo(x, y)
    ctx.stroke()
  }

  // 数据面
  ctx.beginPath()
  dims.forEach((d, i) => {
    const [x, y] = pt(i, Math.max(0.06, d.v))
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
  })
  ctx.closePath()
  ctx.fillStyle = 'rgba(10,10,10,0.07)'
  ctx.fill()
  ctx.lineWidth = 3
  ctx.strokeStyle = INK
  ctx.lineJoin = 'round'
  ctx.stroke()

  // 顶点
  dims.forEach((d, i) => {
    const [x, y] = pt(i, Math.max(0.06, d.v))
    ctx.beginPath()
    ctx.arc(x, y, 7, 0, Math.PI * 2)
    ctx.fillStyle = INK
    ctx.fill()
  })

  // 标签：名字在上、数值在下，整体贴在轴外，和 SVG 那版保持同一套坐标逻辑
  const dist = R + 34
  ctx.textBaseline = 'alphabetic'
  dims.forEach((d, i) => {
    const val = String(Math.round(d.v * 100))

    if (i === 0 || i === 2) {
      const top = i === 0
      ctx.textAlign = 'center'
      ctx.fillStyle = INK
      ctx.font = font(400, 34)
      ctx.fillText(d.label, cx, top ? cy - dist - 12 : cy + dist + 4)
      ctx.fillStyle = MUTED
      ctx.font = font(300, 30)
      ctx.fillText(val, cx, top ? cy - dist + 14 : cy + dist + 36)
    } else {
      const right = i === 1
      const x = cx + (right ? dist : -dist)
      ctx.textAlign = right ? 'left' : 'right'
      ctx.fillStyle = INK
      ctx.font = font(400, 34)
      ctx.fillText(d.label, x, cy - 6)
      ctx.fillStyle = MUTED
      ctx.font = font(300, 30)
      ctx.fillText(val, x, cy + 26)
    }
  })
  ctx.textAlign = 'left'
}

/**
 * 画一张 1080×1440 的竖版成绩卡。
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function renderShareCard(p) {
  await ensureFonts()

  const W = 1080
  const H = 1440
  const PAD = 88
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')

  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, W, H)
  ctx.textBaseline = 'alphabetic'

  // ---- 页眉
  ctx.fillStyle = MUTED
  ctx.font = font(500, 26)
  tracked(ctx, 'DEXKINETICS', PAD, 104, 5.5)
  ctx.font = font(400, 24)
  ctx.fillStyle = 'rgba(10,10,10,0.35)'
  ctx.textAlign = 'right'
  ctx.fillText(p.camMode ? '手势模式' : '滑轨模式', W - PAD, 104)

  ctx.strokeStyle = FAINT
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(PAD, 140)
  ctx.lineTo(W - PAD, 140)
  ctx.stroke()

  // ---- 总分
  ctx.textAlign = 'left'
  ctx.fillStyle = MUTED
  ctx.font = font(400, 26)
  tracked(ctx, '总分', PAD, 218, 3)

  ctx.fillStyle = INK
  ctx.font = font(300, 210)
  ctx.fillText(String(p.score), PAD, 396)

  // 评级单独一行：分数位数涨到 5 位也不会挤在一起
  ctx.font = font(400, 30)
  ctx.fillStyle = 'rgba(10,10,10,0.55)'
  ctx.fillText(`${p.rank.name} · ${Math.round(p.perMinute)} 分/分钟`, PAD, 452)

  // ---- 雷达（数据面 550~920，标签 494~1002）
  drawRadar(ctx, W / 2, 735, 185, p.dims)

  // ---- 称号
  ctx.textAlign = 'center'
  ctx.fillStyle = INK
  ctx.font = font(500, 66)
  ctx.fillText(p.title.name, W / 2, 1105)

  ctx.fillStyle = 'rgba(10,10,10,0.52)'
  ctx.font = font(300, 32)
  ctx.fillText(p.tagline, W / 2, 1165)

  // ---- 数字行
  ctx.fillStyle = 'rgba(10,10,10,0.4)'
  ctx.font = font(400, 26)
  const bits = [
    `抓取 ${p.caught}`,
    `完美 ${p.perfects}`,
    `最高连击 ${p.maxCombo}`,
    `${Math.round(p.rate * 100)}% 成功率`,
  ]
  tracked(ctx, bits.join('   ·   '), W / 2, 1232, 1, 'center')

  // ---- 页脚
  ctx.strokeStyle = FAINT
  ctx.beginPath()
  ctx.moveTo(PAD, 1312)
  ctx.lineTo(W - PAD, 1312)
  ctx.stroke()

  ctx.fillStyle = 'rgba(10,10,10,0.35)'
  ctx.font = font(400, 24)
  tracked(ctx, '抬起手，隔空抓东西', PAD, 1360, 2)
  ctx.textAlign = 'right'
  ctx.fillText(`${p.duration}s 局`, W - PAD, 1360)

  return canvas
}

/** canvas → Blob URL，交给 <img> 显示 / <a download> 保存 */
export function canvasToUrl(canvas) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob ? URL.createObjectURL(blob) : ''), 'image/png')
  })
}
