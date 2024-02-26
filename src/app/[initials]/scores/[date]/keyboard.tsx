import { MutableRefObject } from 'react'
import SimpleKeyboard from 'react-simple-keyboard'
import 'react-simple-keyboard/build/css/index.css'

interface KeyboardProps {
  onKeyPress: (key: string) => void
  keyboardRef: MutableRefObject<any>
}

export default function Keyboard({ onKeyPress, keyboardRef }: KeyboardProps) {
  return (
    <div className='md:invisible md:h-0 sticky bottom-0 pb-2'>
      <SimpleKeyboard
        theme={'hg-theme-default wt-keyboard'}
        keyboardRef={(r) => (keyboardRef.current = r)}
        onKeyPress={onKeyPress}
        layout={{
          default: ['Q W E R T Y U I O P {backspace}', 'A S D F G H J K L', '{back} Z X C V B N M {ent}'],
        }}
        display={{
          '{backspace}': '⌫',
          '{back}': 'Back',
          '{ent}': 'Submit'
        }}
      />
    </div>
  )
}
