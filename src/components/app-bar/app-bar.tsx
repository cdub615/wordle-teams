import BottomBar from './bottom-bar'
import TopBar from './top-bar'

export default async function AppBar({ variant }: { variant: 'top' | 'bottom' }) {
  if (variant === 'top') return <TopBar />
  else if (variant === 'bottom') return <BottomBar />
}
