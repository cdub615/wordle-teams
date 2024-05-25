import AppBar from '@/components/app-bar/app-bar-base'
import { GeistSans } from 'geist/font/sans'
import DashboardPreview from './dashboard-preview'
import FeatureCards from './feature-cards'
import Footer from './footer'
import Hero from './hero'

export default async function Home() {
  // TODO update feature cards gradients, add images and feature descriptions
  // give top title piece room to breathe and make it cooler
  return (
    <div className='flex flex-col w-full'>
      <AppBar />
      <div className='flex flex-col space-y-2 justify-center my-6 md:my-12'>
        <h1 className={`${GeistSans.className} text-center text-3xl md:text-6xl`}>Compete with friends</h1>
        <span className='text-muted-foreground text-lg text-center md:leading-loose'>
          Keep score among friends to establish Wordle bragging rights
        </span>
      </div>
      <DashboardPreview />
      <Hero />
      <FeatureCards />
      <Footer />
    </div>
  )
}
