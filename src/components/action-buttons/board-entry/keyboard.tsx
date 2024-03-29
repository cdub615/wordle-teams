import { MutableRefObject } from 'react'
import SimpleKeyboard from 'react-simple-keyboard'
import 'react-simple-keyboard/build/css/index.css'

interface KeyboardProps {
  onKeyPress: (key: string) => void
  keyboardRef: MutableRefObject<any>
}

export default function Keyboard({ onKeyPress, keyboardRef }: KeyboardProps) {
  return (
    <div className='md:invisible md:h-0 pb-2 md:p-0'>
      <SimpleKeyboard
        theme={'hg-theme-default wt-keyboard'}
        keyboardRef={(r) => (keyboardRef.current = r)}
        onKeyPress={onKeyPress}
        layout={{
          default: ['Q W E R T Y U I O P', 'A S D F G H J K L', 'Z X C V B N M {backspace}'],
        }}
        display={{
          '{backspace}': '⌫',
        }}
      />
    </div>
  )
}
