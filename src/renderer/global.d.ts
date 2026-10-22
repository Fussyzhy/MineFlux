import type { MinefluxApi } from '../shared/types'

declare global {
  interface Window {
    mineflux: MinefluxApi
  }
}

export {}
