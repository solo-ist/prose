import { useState, useEffect } from 'react'
import { Download, RefreshCw, X } from 'lucide-react'
import { Button } from '../ui/button'
import { getApi } from '../../lib/browserApi'

type BannerState = 'available' | 'downloading' | 'ready' | 'dismissed'

export function UpdateBanner() {
  const [state, setState] = useState<BannerState>('dismissed')
  const [version, setVersion] = useState<string>('')
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    const api = getApi()

    const cleanups: (() => void)[] = []

    if (api.onUpdateAvailable) {
      cleanups.push(
        api.onUpdateAvailable((info) => {
          setVersion(info.version)
          setState('available')
        })
      )
    }

    if (api.onDownloadProgress) {
      cleanups.push(
        api.onDownloadProgress((p) => {
          setProgress(Math.round(p.percent))
        })
      )
    }

    if (api.onUpdateDownloaded) {
      cleanups.push(
        api.onUpdateDownloaded(() => {
          setState('ready')
        })
      )
    }

    return () => cleanups.forEach((fn) => fn())
  }, [])

  if (state === 'dismissed') return null

  const handleDownload = async () => {
    setState('downloading')
    setProgress(0)
    try {
      const api = getApi()
      await api.updaterDownload?.()
    } catch {
      setState('available')
    }
  }

  const handleInstall = () => {
    getApi().updaterInstall?.()
  }

  return (
    <div className="flex items-center gap-3 border-b border-border bg-muted/30 px-4 py-1.5 text-xs">
      {state === 'available' && (
        <>
          <span className="text-muted-foreground">
            Version {version} available
          </span>
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={handleDownload}>
            <Download className="mr-1 h-3 w-3" />
            Download
          </Button>
        </>
      )}

      {state === 'downloading' && (
        <span className="text-muted-foreground">
          Downloading update... {progress}%
        </span>
      )}

      {state === 'ready' && (
        <>
          <span className="text-muted-foreground">
            Update ready
          </span>
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={handleInstall}>
            <RefreshCw className="mr-1 h-3 w-3" />
            Restart
          </Button>
        </>
      )}

      <Button
        variant="ghost"
        size="sm"
        className="ml-auto h-5 w-5 p-0 text-muted-foreground hover:text-foreground"
        onClick={() => setState('dismissed')}
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  )
}
