import { createRoot, type Root } from 'react-dom/client';

const REACT_OVERLAY_MOUNT_ATTR = 'data-lfg-overlay-react-mount';

export function createOverlayReactMount(host: HTMLElement): {
  root: Root;
  mount: HTMLDivElement;
} {
  const mount = document.createElement('div');
  mount.setAttribute(REACT_OVERLAY_MOUNT_ATTR, '');
  host.appendChild(mount);
  const root = createRoot(mount);
  return { root, mount };
}

export function teardownOverlayReactRoot(root: Root, mount: HTMLDivElement): void {
  try {
    root.unmount();
  } catch {
    // Grid destroy may detach the overlay host before unmount runs.
  }
  mount.remove();
}

export function overlayHostHasReactMount(host: HTMLElement): boolean {
  return host.querySelector(`[${REACT_OVERLAY_MOUNT_ATTR}]`) !== null;
}
