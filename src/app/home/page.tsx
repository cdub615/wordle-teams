import Home from '@/components/home'

// Next prerenders this page but emits `Cache-Control: public, max-age=0,
// must-revalidate`, so an edge PoP that does not already hold it must revalidate
// against the origin — a cold function, ~2s. At this traffic level (a handful of
// visits a day, spread worldwide) that was 28% of requests to this page.
// Declaring a revalidate window emits s-maxage + stale-while-revalidate instead,
// so edges serve immediately and refresh in the background. Deploys still
// invalidate, so the window only bounds how stale a between-deploy edge can get.
export const revalidate = 86400

export default function Page() {
  return <Home redirectForPwa={false} />
}
