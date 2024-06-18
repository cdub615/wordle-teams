import AppBar from '@/components/app-bar/app-bar-base'
import { Suspense } from 'react'
import DashboardPreview from './dashboard-preview'
import FeatureCards from './feature-cards'
import Footer from './footer'
import Title from './title'
import DashboardSkeleton from './dashboard-skeleton'

export default async function Home() {
  return (
    <div className='flex flex-col w-full'>
      <AppBar />
      <Title />
      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardPreview />
      </Suspense>
      <FeatureCards />
      <Footer />
    </div>
  )
}
