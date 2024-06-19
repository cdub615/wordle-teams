import AppBar from '@/components/app-bar/app-bar-base'
import { Suspense } from 'react'
import DashboardPreview from './dashboard-preview'
import DashboardSkeleton from './dashboard-skeleton'
import FeatureCards from './feature-cards'
import Footer from './footer'
import Title from './title'

export default async function Home({ redirectForPwa = true }: { redirectForPwa?: boolean }) {
  return (
    <div className='flex flex-col w-full'>
      <AppBar />
      <Title />
      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardPreview redirectForPwa={redirectForPwa} />
      </Suspense>
      <FeatureCards />
      <Footer />
    </div>
  )
}
