import AppBar from '@/components/app-bar/app-bar-base'
import DashboardPreview from './dashboard-preview'
import FeatureCards from './feature-cards'
import Footer from './footer'
import Hero from './hero'
import Title from './title'

export default async function Home() {
  return (
    <div className='flex flex-col w-full'>
      <AppBar />
      <Title />
      <DashboardPreview />
      <FeatureCards />
      <Footer />
    </div>
  )
}
