/** 结算页用的小雷达图：和分享卡同一个数据形状，只是换成 SVG */
const C = 100
const R = 54
const LP = R + 20 // 标签距中心的距离

export default function Radar({ dims, size = 176 }) {
  const angles = dims.map((_, i) => -Math.PI / 2 + (i * Math.PI) / 2)
  const pt = (i, k) => [C + Math.cos(angles[i]) * R * k, C + Math.sin(angles[i]) * R * k]

  const ring = (k) =>
    dims.map((_, i) => pt(i, k).map((n) => n.toFixed(2)).join(',')).join(' ')

  const shape = dims
    .map((d, i) => pt(i, Math.max(0.06, d.v)).map((n) => n.toFixed(2)).join(','))
    .join(' ')

  return (
    <svg
      className="radar"
      width={size}
      height={size}
      viewBox="0 0 200 200"
      role="img"
      aria-label="四维风格雷达"
    >
      {[0.25, 0.5, 0.75, 1].map((k) => (
        <polygon key={k} points={ring(k)} className="radar-grid" />
      ))}
      {dims.map((d, i) => {
        const [x, y] = pt(i, 1)
        return <line key={d.key} x1={C} y1={C} x2={x} y2={y} className="radar-grid" />
      })}
      <polygon points={shape} className="radar-fill" />
      {dims.map((d, i) => {
        const [x, y] = pt(i, Math.max(0.06, d.v))
        return <circle key={d.key} cx={x} cy={y} r="2.6" className="radar-dot" />
      })}
      {dims.map((d, i) => {
        const top = i === 0
        const bottom = i === 2
        const right = i === 1
        // 上下轴居中排两行，左右轴靠边对齐；全部落在 200 的视窗内
        const x = top || bottom ? C : right ? C + LP : C - LP
        const anchor = top || bottom ? 'middle' : right ? 'start' : 'end'
        const labelY = top ? C - LP - 14 : bottom ? C + LP + 4 : C - 3
        const valueY = top ? C - LP + 2 : bottom ? C + LP + 20 : C + 14
        return (
          <g key={d.key}>
            <text x={x} y={labelY} textAnchor={anchor} className="radar-label">
              {d.label}
            </text>
            <text x={x} y={valueY} textAnchor={anchor} className="radar-value">
              {Math.round(d.v * 100)}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
