import { useEffect, useState } from 'react'
import './App.css'
import {
  FALLBACK_PRICING,
  FALLBACK_PRODUCTS,
  fetchBillingProducts,
  fetchCreditPricing,
  type BillingProduct,
} from './billing-api'
import type { CreditPricing } from './credits'
import {
  buildTrackedDownloadUrl,
  describeLoadError,
  fetchLatestRelease,
  type ClientReleaseData,
} from './release-api'
import { Capabilities } from './sections/Capabilities'
import { Consumption } from './sections/Consumption'
import { CtaBanner } from './sections/CtaBanner'
import { DownloadCenter } from './sections/DownloadCenter'
import { Faq } from './sections/Faq'
import { Hero } from './sections/Hero'
import { Innovation } from './sections/Innovation'
import { Philosophy } from './sections/Philosophy'
import { Pricing } from './sections/Pricing'
import { SiteFooter } from './sections/SiteFooter'
import { SiteNav } from './sections/SiteNav'
import { SITE } from './site'

function App() {
  const [release, setRelease] = useState<ClientReleaseData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [products, setProducts] = useState<BillingProduct[]>(FALLBACK_PRODUCTS)
  const [pricing, setPricing] = useState<CreditPricing>(FALLBACK_PRICING)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const [releaseResult, productsResult, pricingResult] = await Promise.allSettled([
        fetchLatestRelease(),
        fetchBillingProducts(),
        fetchCreditPricing(),
      ])

      if (cancelled) {
        return
      }

      if (releaseResult.status === 'fulfilled') {
        setRelease(releaseResult.value)
        setLoadError(null)
      } else {
        setLoadError(describeLoadError(releaseResult.reason))
      }

      if (productsResult.status === 'fulfilled') {
        setProducts(productsResult.value)
      }

      if (pricingResult.status === 'fulfilled') {
        setPricing(pricingResult.value)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const windowsArtifact = release?.artifacts.find((artifact) =>
    artifact.platform.toLowerCase().includes('windows'),
  )
  const downloadUrl = buildTrackedDownloadUrl(
    windowsArtifact?.download_url ?? '/client-releases/download/windows-x64',
    SITE.downloadSource,
  )

  return (
    <div className="release-page">
      <SiteNav />
      <main>
        <Hero
          version={release?.version ?? null}
          publishedAt={release?.published_at ?? null}
          artifact={windowsArtifact}
          downloadUrl={downloadUrl}
          loadError={loadError}
        />
        <Capabilities downloadUrl={downloadUrl} />
        <Innovation />
        <Pricing products={products} downloadUrl={downloadUrl} />
        <Consumption pricing={pricing} products={products} />
        <Philosophy />
        <DownloadCenter
          version={release?.version ?? null}
          publishedAt={release?.published_at ?? null}
          artifact={windowsArtifact}
          downloadUrl={downloadUrl}
          steps={release?.installation_steps ?? []}
        />
        <Faq />
        <CtaBanner downloadUrl={downloadUrl} />
      </main>
      <SiteFooter />
    </div>
  )
}

export default App
