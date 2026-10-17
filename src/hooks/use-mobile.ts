import * as React from "react"

const MOBILE_BREAKPOINT = 768

function subscribeToViewport(onChange: () => void) {
  const media = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
  media.addEventListener("change", onChange)
  return () => media.removeEventListener("change", onChange)
}

function getViewportSnapshot() {
  return window.innerWidth < MOBILE_BREAKPOINT
}

export function useIsMobile() {
  return React.useSyncExternalStore(subscribeToViewport, getViewportSnapshot, () => false)
}
