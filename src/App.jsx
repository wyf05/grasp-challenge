import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { Plus } from 'lucide-react'
import HandLab from './HandLab.jsx'
import Game from './Game.jsx'
import GestureLab from './GestureLab.jsx'
import Sandbox from './Sandbox.jsx'

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

function GridMark() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
      <circle cx="2.6" cy="2.6" r="1.35" fill="currentColor" />
      <circle cx="7.4" cy="2.6" r="1.35" fill="currentColor" />
      <circle cx="2.6" cy="7.4" r="1.35" fill="currentColor" />
      <circle cx="7.4" cy="7.4" r="1.35" fill="currentColor" />
    </svg>
  )
}

export default function App() {
  const hash = useHash()

  // 开发期调参入口：/#lab
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
    <main className="page">
      {/* 背景视频 */}
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

      {/* 顶部导航 */}
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

          <button type="button" className="pill pill--solid">
            <span className="pill-circle">
              <Plus size={12} strokeWidth={3} />
            </span>
            <span className="pill-solid-label">Menu</span>
          </button>

          <div className="tag-pill">
            <span>Dexterous Grasping</span>
            <span>Force Control</span>
          </div>
        </div>

        <div className="nav-right">
          <button type="button" className="pill pill--soft">
            <span className="pill-circle pill-circle--dark">
              <GridMark />
            </span>
            <span className="pill-soft-label">Adaptive Grip</span>
          </button>
        </div>
      </motion.nav>

      {/* 底部内容 */}
      <motion.footer
        className="footer"
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.5, duration: 1, ease: EASE }}
      >
        <div className="footer-left">
          <motion.div
            className="subtitle"
            initial={{ y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.6, duration: 0.8, ease: EASE }}
          >
            <span className="dot" />
            <span>90-Second Dexterous Challenge · 2026</span>
          </motion.div>

          <motion.h1
            className="heading"
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.8, duration: 0.8, ease: EASE }}
          >
            Grip It Tight.
            <br />
            Or Watch It Fall.
          </motion.h1>

          <motion.div
            className="buttons"
            initial={{ y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 1, duration: 0.8, ease: EASE }}
          >
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                location.hash = '#play'
              }}
            >
              Start Challenge
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                location.hash = '#gesture'
              }}
            >
              How It Works
            </button>
          </motion.div>

          <motion.button
            type="button"
            className="link-btn"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.15, duration: 0.6, ease: EASE }}
            onClick={() => {
              location.hash = '#sandbox'
            }}
          >
            摄像头沙盒：捏气球 / 指尖生花 ↗
          </motion.button>
        </div>

        <motion.div
          className="footer-right"
          initial={{ y: 16, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 1.1, duration: 0.8, ease: EASE }}
        >
          <span className="chip">Dexterous</span>
          <span className="chip">Tactile</span>
          <span className="chip">Precision</span>
        </motion.div>
      </motion.footer>
    </main>
  )
}
