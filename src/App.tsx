import { useEffect, useRef, useState } from 'react'
import Chrome from './components/Chrome'
import Hero from './components/Hero'
import Detail from './components/Detail'
import Exploded from './components/Exploded'
import Xray from './components/Xray'
import Mechanism from './components/Mechanism'
import Reassembly from './components/Reassembly'
import Philosophy from './components/Philosophy'
import Lineup from './components/Lineup'
import Buy from './components/Buy'
import Footer from './components/Footer'
import FrameFallback from './components/FrameFallback'
import { PencilExperience } from './three/experience'
import { registerModules } from './three/registerModules'
import { startPointer } from './fx/pointer'

function useStaticMode(): boolean {
  if (typeof window === 'undefined') return false
  if (new URLSearchParams(window.location.search).has('static')) return true
  try {
    const test = document.createElement('canvas')
    if (!test.getContext('webgl2') && !test.getContext('webgl')) return true
  } catch {
    return true
  }
  const cores = navigator.hardwareConcurrency || 8
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory || 8
  const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } })
    .connection?.saveData
  return cores <= 2 || mem <= 2 || saveData === true
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const expRef = useRef<PencilExperience | null>(null)
  const [staticMode, setStaticMode] = useState(useStaticMode)
  const [failReason, setFailReason] = useState<string | null>(null)
  const [motionPaused, setMotionPaused] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )

  useEffect(() => startPointer(), [])

  useEffect(() => {
    if (staticMode) return
    const canvas =
      canvasRef.current ?? (document.getElementById('gl') as HTMLCanvasElement)
    const exp = new PencilExperience(canvas)
    registerModules(exp)
    expRef.current = exp
    ;(window as unknown as { __exp?: unknown }).__exp = exp
    setMotionPaused(!exp.isMotionOK())
    if (!exp.isMotionOK()) document.body.classList.add('reduced')
    // 3D unavailable on this device → still frames instead of a blank canvas
    exp.onFail = (reason) => {
      setFailReason(reason)
      setStaticMode(true)
    }
    void exp.init()
    return () => {
      exp.onFail = null
      exp.dispose()
      if (expRef.current === exp) expRef.current = null
    }
  }, [staticMode])

  const toggleMotion = () => {
    const exp = expRef.current
    const next = !motionPaused
    setMotionPaused(next)
    if (exp) exp.setMotionOK(!next)
    else document.body.classList.toggle('reduced', next)
  }

  return (
    <>
      <Chrome motionPaused={motionPaused} onToggleMotion={toggleMotion} />
      {staticMode && <FrameFallback reason={failReason} />}
      <main id="main">
        <Hero />
        <Detail />
        <Exploded />
        <Xray />
        <Mechanism />
        <Reassembly />
        <Philosophy />
        <Lineup />
        <Buy onVariantChange={(v) => expRef.current?.setVariant(v)} />
      </main>
      <Footer />
    </>
  )
}
