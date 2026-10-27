import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import HandLab from './HandLab.jsx'
import Game from './Game.jsx'
import GestureLab from './GestureLab.jsx'
import Sandbox from './Sandbox.jsx'
import Guide, { shouldAutoShowGuide } from './Guide.jsx'

const EASE = [0.16, 1, 0.3, 1]

function useHash() {
  const [hash, setHash] = useState(() =>
    typeof location === 'undefined' ? '' : location.hash
  )
  useEffect(() => {
    const on = () => setHash(location.hash)
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return hash
}

const VIDEO_SRC =
  'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260508_215831_c6a8989c-d716-4d8d-8745-e972a2eec711.mp4'

function LogoMark() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect
        x="3"
        y="6.5"
        width="17"
        height="5.2"
        rx="2.6"
        fill="#0A0A0A"
        transform="rotate(-35 11.5 9.1)"
      />
      <rect
        x="5.5"
        y="13"
        width="12.5"
        height="5.2"
        rx="2.6"
        fill="#0A0A0A"
        transform="rotate(-35 11.75 15.6)"
      />
    </svg>
  )
}

/** 三个玩法入口：先说"是什么"，再说"要不要摄像头"，最后才是细节 */
const ENTRIES = [
  {
    no: '01',
    href: '#play',
    name: '抓取挑战',
    en: 'Grasp Challenge',
    desc: '90 秒，物体从上方落下。把开口调到刚好夹住，停在抓取区里夹稳。鸡蛋和玻璃杯经不起猛合。',
    tags: ['滑轨 / 手势', '有成绩卡'],
    primary: true,
  },
  {
    no: '02',
    href: '#gesture',
    name: '手势实验室',
    en: 'Gesture Lab',
    desc: '摄像头把手上 21 个关节点画在屏幕上，五指伸直度、开合度实时读数。五个手势做对就点亮。',
    tags: ['需要摄像头'],
  },
  {
    no: '03',
    href: '#sandbox',
    name: '捏气球',
    en: 'Stress Purge',
    desc: '60 秒，一屏气球。捏住手指，让指尖碰到气球就炸；空处捏住拖动可以平移视角。',
    tags: ['需要摄像头', '带音效'],
  },
]

const go = (href) => {
  location.hash = href
}

export default function App() {
  const hash = useHash()
  const [guide, setGuide] = useState(false)

  // 第一次来先讲清楚这是什么，之后不再自动弹
  useEffect(() => {
    if (hash === '' || hash === '#') setGuide(shouldAutoShowGuide())
  }, [hash])

  if (hash === '#lab') return <HandLab />

  if (hash === '#gesture') {
    return <GestureLab onExit={() => { location.hash = '' }} />
  }

  if (hash === '#play') {
    return <Game onExit={() => { location.hash = '' }} />
  }

  if (hash === '#sandbox') {
    return <Sandbox onExit={() => { location.hash = '' }} />
  }

  return (
    <>
      <main className="page">
        <div className="video-frame" aria-hidden="true">
          <motion.div
            className="video-wrap"
            initial={{ opacity: 0, scale: 1.05 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 1.8, ease: EASE }}
          >
            <video className="video" src={VIDEO_SRC} autoPlay muted playsInline loop />
          </motion.div>
        </div>

        <motion.nav
          className="nav"
          initial={{ y: -16, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.8, ease: EASE }}
        >
          <div className="nav-left">
            <div className="brand">
              <LogoMark />
              <span className="brand-name">DexKinetics</span>
            </div>
            <span className="brand-sub">灵巧手 · 隔空交互</span>
          </div>

          <div className="nav-right">
            <button type="button" className="nav-link" onClick={() => setGuide(true)}>
              怎么玩
            </button>
          </div>
        </motion.nav>

        <motion.footer
          className="footer footer--home"
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.4, duration: 1, ease: EASE }}
        >
          <div className="footer-left">
            <motion.div
              className="subtitle"
              initial={{ y: 16, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.5, duration: 0.8, ease: EASE }}
            >
              <span className="dot" />
              <span>90 秒灵巧手挑战 · 2026</span>
            </motion.div>

            <motion.h1
              className="heading"
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.6, duration: 0.8, ease: EASE }}
            >
              Grip It Tight.
              <br />
              Or Watch It Fall.
            </motion.h1>

            <motion.p
              className="heading-cn"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.8, duration: 0.8, ease: EASE }}
            >
              握紧，或者看着它掉下去。三件用手玩的小事，选一个开始。
            </motion.p>
          </div>

          <div className="entries">
            {ENTRIES.map((e, i) => (
              <motion.button
                key={e.href}
                type="button"
                className={'entry' + (e.primary ? ' entry--primary' : '')}
                onClick={() => go(e.href)}
                initial={{ y: 18, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.85 + i * 0.08, duration: 0.7, ease: EASE }}
              >
                <span className="entry-head">
                  <span className="entry-no">{e.no}</span>
                  <span className="entry-name">{e.name}</span>
                  <span className="entry-arrow">↗</span>
                </span>
                <span className="entry-en">{e.en}</span>
                <span className="entry-desc">{e.desc}</span>
                <span className="entry-tags">
                  {e.tags.map((t) => (
                    <span key={t} className="entry-tag">
                      {t}
                    </span>
                  ))}
                </span>
              </motion.button>
            ))}
          </div>

          <p className="home-note">
            全部在浏览器本地运行，摄像头画面不会上传。没开摄像头也能玩抓取挑战（用滑轨）。
          </p>
        </motion.footer>
      </main>

      <Guide open={guide} onClose={() => setGuide(false)} />
    </>
  )
}
