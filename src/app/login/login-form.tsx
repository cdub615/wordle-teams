'use client'

import { useFormState, useFormStatus } from 'react-dom'
import { login } from './actions'

const initialState = {
  message: '',
}

function SubmitButton() {
  const { pending } = useFormStatus()

  return (
    <button type='submit' aria-disabled={pending}>
      Add
    </button>
  )
}

export function AddForm() {
  const [state, formAction] = useFormState(login, initialState)

  return (
    <form action={formAction}>
      <label htmlFor='todo'>Enter Task</label>
      <input type='text' id='todo' name='todo' required />
      <SubmitButton />
      <p aria-live='polite' className='sr-only' role='status'>
        {state?.message}
      </p>
    </form>
  )
}
