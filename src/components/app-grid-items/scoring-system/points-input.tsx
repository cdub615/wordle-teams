import { Dispatch, SetStateAction, useState } from "react"
import { Input } from "@/components/ui/input"

interface PointsInputProps {
  points: number[]
  setPoints: Dispatch<SetStateAction<number[]>>
  index: number
  min?: number
  max?: number
  initialValue?: string
}

export function PointsInput({ points, setPoints, index, min = -100, max = 100, initialValue = "" }: PointsInputProps) {
  const [value, setValue] = useState(String(initialValue ?? ""))

  function handleChange(e: any) {
    const val = e.target.value

    // Allow empty or just "-" temporarily
    if (val === "" || val === "-") {
      setValue(val)
      return
    }

    const num = Number(val)
    if (!isNaN(num)) {
      // Clamp only if user has typed a complete number
      const clamped = Math.max(min, Math.min(max, num))
      setValue(String(clamped))
      const newPoints = [...points]
      newPoints[index] = clamped
      setPoints(newPoints)
    }
  }


  return (
    <Input
      type="text"
      value={value}
      name={`points[${index}]`}
      required
      onChange={handleChange}
    />
  )
}

