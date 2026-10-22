import type { McdlApi } from '../shared/types'

declare global {
  interface Window {
    mcdl: McdlApi
  }
}

export {}
