declare global {
  interface Window {
    LemonSqueezy: {
      Url: {
        Open: (url: string) => void
      }
    }
  }
}

export {}
