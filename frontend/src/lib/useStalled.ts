import { useEffect, useState } from 'react'
import { type Job } from '@/domain/types'

/**
 * How long a queued or running job may show no change before the screen says it is taking longer than usual (it goes on
 * waiting). The processor ends a row that nothing has touched for the same time when it is asked to start another job, so
 * Try again after this long either starts a new job or is told the piece is still being prepared (the job is alive after all).
 */
export const STALL_MS = 10 * 60 * 1000

/** What changes when a job makes progress; two reads with the same signature saw no change. */
export function jobSignature(job: Job): string {
  return `${job.id}|${job.status}|${job.progress}|${JSON.stringify(job.parts ?? null)}`
}

/** True once a queued or running job has shown the same signature for STALL_MS; any change, or the job ending, starts the count again. */
export function useStalled(job: Job | null | undefined): boolean {
  const working = job !== null && job !== undefined && (job.status === 'queued' || job.status === 'running')
  const signature = working ? jobSignature(job) : null
  const [stalledOn, setStalledOn] = useState<string | null>(null)
  useEffect(() => {
    if (signature === null) return
    const timer = setTimeout(() => setStalledOn(signature), STALL_MS)
    return () => clearTimeout(timer)
  }, [signature])
  return signature !== null && stalledOn === signature
}
