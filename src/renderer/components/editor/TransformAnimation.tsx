import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

interface Particle {
  id: number
  x: number
  y: number
  size: number
  delay: number
}

interface TransformAnimationProps {
  isTransforming: boolean
  onComplete: () => void
  children: React.ReactNode
}

/**
 * Transformation animation component for reMarkable read-only to edit mode transition.
 * Features:
 * - Particle "AI glitter" effect
 * - Text opacity/color transition
 * - Smooth fade completion
 */
export function TransformAnimation({
  isTransforming,
  onComplete,
  children
}: TransformAnimationProps) {
  const [particles, setParticles] = useState<Particle[]>([])
  const [showParticles, setShowParticles] = useState(false)

  // Generate particles when transformation starts
  useEffect(() => {
    if (isTransforming) {
      // Create random particles
      const newParticles: Particle[] = []
      for (let i = 0; i < 30; i++) {
        newParticles.push({
          id: i,
          x: Math.random() * 100,
          y: Math.random() * 100,
          size: Math.random() * 4 + 2,
          delay: Math.random() * 0.3
        })
      }
      setParticles(newParticles)
      setShowParticles(true)

      // Complete animation after duration
      const timer = setTimeout(() => {
        setShowParticles(false)
        onComplete()
      }, 800)

      return () => clearTimeout(timer)
    }
  }, [isTransforming, onComplete])

  return (
    <div className="relative">
      {/* Particle layer */}
      <AnimatePresence>
        {showParticles && (
          <div className="absolute inset-0 pointer-events-none overflow-hidden z-10">
            {particles.map((particle) => (
              <motion.div
                key={particle.id}
                className="absolute rounded-full"
                initial={{
                  opacity: 0,
                  scale: 0,
                  left: `${particle.x}%`,
                  top: `${particle.y}%`,
                }}
                animate={{
                  opacity: [0, 1, 0],
                  scale: [0, 1, 0.5],
                  y: [-20, -40],
                }}
                transition={{
                  duration: 0.6,
                  delay: particle.delay,
                  ease: 'easeOut',
                }}
                style={{
                  width: particle.size,
                  height: particle.size,
                  background: `linear-gradient(135deg,
                    hsl(var(--primary)) 0%,
                    hsl(var(--primary) / 0.5) 50%,
                    hsl(var(--accent)) 100%)`,
                  boxShadow: `0 0 ${particle.size * 2}px hsl(var(--primary) / 0.5)`,
                }}
              />
            ))}
          </div>
        )}
      </AnimatePresence>

      {/* Content with transition */}
      <motion.div
        animate={{
          opacity: isTransforming ? [0.8, 1] : 1,
          filter: isTransforming ? ['blur(0.5px)', 'blur(0px)'] : 'blur(0px)',
        }}
        transition={{
          duration: 0.5,
          ease: 'easeOut',
        }}
      >
        {children}
      </motion.div>

      {/* Shimmer overlay */}
      <AnimatePresence>
        {showParticles && (
          <motion.div
            className="absolute inset-0 pointer-events-none z-5"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.1, 0] }}
            transition={{ duration: 0.6 }}
            style={{
              background: `linear-gradient(
                90deg,
                transparent 0%,
                hsl(var(--primary) / 0.1) 50%,
                transparent 100%
              )`,
            }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

/**
 * Hook to manage transformation state
 */
export function useTransformAnimation() {
  const [isTransforming, setIsTransforming] = useState(false)

  const startTransform = useCallback(() => {
    setIsTransforming(true)
  }, [])

  const completeTransform = useCallback(() => {
    setIsTransforming(false)
  }, [])

  return {
    isTransforming,
    startTransform,
    completeTransform,
  }
}
