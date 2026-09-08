const DEMO_ROOT_SELECTOR = ".grid-demo";

/** DOM chrome only — not a grid handle call. */
export function toggleDemoFullscreen(): void {
  const root = document.querySelector(DEMO_ROOT_SELECTOR);
  if (!(root instanceof HTMLElement)) return;
  if (document.fullscreenElement) {
    void document.exitFullscreen();
    return;
  }
  void root.requestFullscreen();
}
