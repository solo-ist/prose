import * as React from 'react'
import { cn } from '../../lib/utils'

interface SliderProps {
  value: number
  onChange: (value: number) => void
  min: number
  max: number
  step?: number
  className?: string
}

export function Slider({
  value,
  onChange,
  min,
  max,
  step = 1,
  className
}: SliderProps) {
  return (
    <input
      type="range"
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      min={min}
      max={max}
      step={step}
      className={cn(
        'w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer',
        'accent-primary',
        className
      )}
    />
  )
}
