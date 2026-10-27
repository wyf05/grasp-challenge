import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'

const KEY = 'dex.guide.v1'

export function shouldAutoShowGuide() {
  try {
    return localStorage.getItem(KEY) !== 'off'
  } catch {
    return true
  }
}

const ROWS = [
  {
    no: '01',
    name: '抓取挑战',
    how: '物体从上方落下，看它外围的虚线框宽度，把底部开口调到一样宽。停在抓取区里保持一瞬就夹住。太早合拢会落空，合得太猛鸡蛋和玻璃杯会碎。',
    note: '滑轨拖动即可，也可以开摄像头用手势控制。',
  },
  {
    no: '02',
    name: '手势实验室',
    how: '把手抬到摄像头前，屏幕会画出你手上的 21 个关节点，旁边实时显示开合度、拇指轴和五指伸直程度。',
    note: '张开、握拳、捏合、OK、剪刀手——做对哪个，下面的卡片就亮哪个。',
  },
  {
    no: '03',
    name: '摄像头沙盒',
    how: '捏气球：捏合指尖碰到气球就爆，在空处捏合并拖动可以平移视角。',
    note: '指尖生花：张开手掌花就开，握拳收回花苞，开满一会儿会换下一朵。',
  },
]

export default function Guide({ open, onClose }) {
  const [dontShow, setDontShow] = useState(true)

  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const close = () => {
    try {
      localStorage.setItem(KEY, dontShow ? 'off' : 'on')
    } catch {
      /* 隐私模式下写不了 localStorage，忽略即可 */
    }
    onClose()
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="guide"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.28 }}
          onClick={close}
        >
          <motion.div
            className="guide-card"
            initial={{ y: 18, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 10, opacity: 0 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
          >
            <span className="guide-eyebrow">先看这里</span>
            <h2 className="guide-title">三件用手玩的小事</h2>
            <p className="guide-lead">
              都是用摄像头读你的手：不需要手柄，也不需要装任何东西。
            </p>

            <div className="guide-rows">
              {ROWS.map((r) => (
                <div className="guide-row" key={r.no}>
                  <span className="guide-no">{r.no}</span>
                  <div className="guide-body">
                    <span className="guide-name">{r.name}</span>
                    <span className="guide-how">{r.how}</span>
                    {r.note && <span className="guide-note">{r.note}</span>}
                  </div>
                </div>
              ))}
            </div>

            <p className="guide-foot">
              摄像头画面全部在本地计算，不会上传。没有摄像头也能玩抓取挑战——用底部滑轨拖动即可。
            </p>

            <div className="guide-actions">
              <button type="button" className="btn btn--primary" onClick={close}>
                知道了，开始
              </button>
              <label className="guide-check">
                <input
                  type="checkbox"
                  checked={dontShow}
                  onChange={(e) => setDontShow(e.target.checked)}
                />
                <span>下次不再自动弹出</span>
              </label>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
