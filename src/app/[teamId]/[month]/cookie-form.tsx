'use client'

import { useEffect } from 'react'
import setCookies from './actions'

export default function CookieForm({ teamId, month }: { teamId: string; month: string }) {
  useEffect(() => {
    document.getElementById('set-cookies')?.click()
  }, [])
  return (
    <form action={setCookies}>
      <input hidden name='teamId' value={teamId} readOnly />
      <input hidden name='month' value={month} readOnly />
      <button hidden type='submit' id='set-cookies'></button>
    </form>
  )
}
