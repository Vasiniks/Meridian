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
import { PencilExperience } from './three/experience'

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const expRef = useRef<PencilExperience | null>(null)
  const [motionPaused, setMotionPaused] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )

  useEffect(() => {
    const canvas =
      canvasRef.current ?? (document.getElementById('gl') as HTMLCanvasElement)
    const exp = new PencilExperience(canvas)
    expRef.current = exp
    setMotionPaused(!exp.isMotionOK())
    if (!exp.isMotionOK()) document.body.classList.add('reduced')
    let cancelled = false
    exp.init().catch(() => {
      /* fallback poster is shown by the experience itself */
    })
    return () => {
      cancelled = true
      void cancelled
      exp.dispose()
      if (expRef.current === exp) expRef.current = null
    }
  }, [])

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
