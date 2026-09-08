import {
  applyGridRootAttributes,
  clearGridRootAttributes,
} from "./utils/attributesManager";
import {
  applyRowgroupRoles,
  clearRowgroupRoles,
  type RowgroupRoleHost,
} from "./utils/rowgroupRoles";
import type { GridRootSnapshot } from "./gridRootStructuralSnapshot";
import {
  ReconcileScheduler,
} from "./reconcileScheduler";

export const ACCESSIBILITY_DIRTY_ROOT = 1 << 0;
export const ACCESSIBILITY_DIRTY_ROW_STRUCTURE = 1 << 1;
export const ACCESSIBILITY_DIRTY_ROW_POSITION = 1 << 2;
export const ACCESSIBILITY_DIRTY_HEADER_TOPOLOGY = 1 << 3;
export const ACCESSIBILITY_DIRTY_HEADER_SORT = 1 << 4;
export const ACCESSIBILITY_DIRTY_HEADER_MENU = 1 << 5;
export const ACCESSIBILITY_DIRTY_HEADER_BINDING = 1 << 6;
export const ACCESSIBILITY_DIRTY_ACTIVE_DESCENDANT = 1 << 7;
export const ACCESSIBILITY_DIRTY_HEADER_SELECTION = 1 << 8;
export const ACCESSIBILITY_DIRTY_ALL =
  ACCESSIBILITY_DIRTY_ROOT |
  ACCESSIBILITY_DIRTY_ROW_STRUCTURE |
  ACCESSIBILITY_DIRTY_ROW_POSITION |
  ACCESSIBILITY_DIRTY_HEADER_TOPOLOGY |
  ACCESSIBILITY_DIRTY_HEADER_SORT |
  ACCESSIBILITY_DIRTY_HEADER_MENU |
  ACCESSIBILITY_DIRTY_HEADER_BINDING |
  ACCESSIBILITY_DIRTY_ACTIVE_DESCENDANT |
  ACCESSIBILITY_DIRTY_HEADER_SELECTION;

export type AccessibilityDirtyScope = number;

export interface AccessibilityHost {
  readonly root: HTMLElement;
  readonly viewport: HTMLElement;
  readonly rowgroup: RowgroupRoleHost | null;
  readonly readSnapshot: () => GridRootSnapshot;
  readonly syncRowStructure: () => void;
  readonly syncRowPosition: () => boolean;
  readonly syncHeaderTopology: () => void;
  readonly syncHeaderBinding: () => boolean;
  readonly syncHeaderSort: () => void;
  readonly syncHeaderSelection: () => void;
  readonly syncHeaderMenu: () => void;
  readonly syncActiveDescendant: () => void;
  readonly clearSemantics: () => void;
}

export class AccessibilityController {
  private host: AccessibilityHost | null = null;
  private readonly scheduler = new ReconcileScheduler(() => this.reconcile());
  private dirtyScopes = 0;
  private mountGeneration = 0;
  private reconciling = false;
  private readonly onViewportScroll = (): void => {
    if (this.host === null) return;
    this.dirtyScopes |=
      ACCESSIBILITY_DIRTY_ROW_POSITION |
      ACCESSIBILITY_DIRTY_HEADER_BINDING;
    this.scheduler.notifyScroll();
  };

  private readonly onViewportScrollEnd = (): void => {
    if (this.host === null) return;
    this.scheduler.notifyScrollEnd();
  };

  attach(host: AccessibilityHost): void {
    if (this.host !== null) {
      this.detach();
    }
    this.mountGeneration =
      this.mountGeneration === Number.MAX_SAFE_INTEGER
        ? 1
        : this.mountGeneration + 1;
    this.host = host;
    this.scheduler.activate(this.mountGeneration);
    host.viewport.addEventListener("scroll", this.onViewportScroll, {
      passive: true,
    });
    host.viewport.addEventListener("scrollend", this.onViewportScrollEnd, {
      passive: true,
    });
    this.markDirty(ACCESSIBILITY_DIRTY_ALL);
    this.scheduler.request();
    this.flushReconcile();
    this.markDirty(ACCESSIBILITY_DIRTY_ALL);
    this.scheduler.requestAfterLayout();
  }

  detach(): void {
    const host = this.host;
    this.mountGeneration =
      this.mountGeneration === Number.MAX_SAFE_INTEGER
        ? 1
        : this.mountGeneration + 1;
    this.scheduler.deactivate();
    this.host = null;
    this.dirtyScopes = 0;
    if (host !== null) {
      host.viewport.removeEventListener("scroll", this.onViewportScroll);
      host.viewport.removeEventListener("scrollend", this.onViewportScrollEnd);
      clearGridRootAttributes(host.root);
      if (host.rowgroup !== null) {
        clearRowgroupRoles(host.rowgroup);
      }
      host.clearSemantics();
    }
  }

  requestReconcile(
    scopes: AccessibilityDirtyScope,
    afterLayout = true,
  ): void {
    if (this.host === null) return;
    this.markDirty(scopes);
    if (afterLayout) {
      this.scheduler.requestAfterLayout();
    } else {
      this.scheduler.request();
    }
  }

  /** Run all foundation scopes now (tests and explicit recovery only). */
  reconcileNow(): void {
    this.markDirty(ACCESSIBILITY_DIRTY_ALL);
    this.scheduler.request();
    this.flushReconcile();
  }

  /**
   * Publish a low-latency scope without draining layout-sensitive work that
   * is already waiting for renderer bindings. Overlay and menu updates use
   * this boundary so they cannot consume a pending structural reconcile.
   */
  reconcileImmediate(scopes: AccessibilityDirtyScope): void {
    const host = this.host;
    if (host === null || scopes === 0) return;
    if (this.reconciling) {
      this.requestReconcile(scopes);
      return;
    }

    this.reconciling = true;
    try {
      this.reconcileScopes(host, scopes);
    } catch (error) {
      if (this.host === host) {
        this.markDirty(scopes);
        this.scheduler.requestAfterLayout();
      }
      throw error;
    } finally {
      this.reconciling = false;
    }
  }

  private markDirty(scopes: AccessibilityDirtyScope): void {
    this.dirtyScopes |= scopes;
    if ((this.dirtyScopes & ACCESSIBILITY_DIRTY_ROW_STRUCTURE) !== 0) {
      this.dirtyScopes &= ~ACCESSIBILITY_DIRTY_ROW_POSITION;
    }
    if ((this.dirtyScopes & ACCESSIBILITY_DIRTY_HEADER_TOPOLOGY) !== 0) {
      this.dirtyScopes &=
        ~(
          ACCESSIBILITY_DIRTY_HEADER_BINDING |
          ACCESSIBILITY_DIRTY_HEADER_SORT |
          ACCESSIBILITY_DIRTY_HEADER_SELECTION |
          ACCESSIBILITY_DIRTY_HEADER_MENU
        );
    }
  }

  private reconcile(): void {
    const host = this.host;
    if (host === null || this.dirtyScopes === 0 || this.reconciling) return;
    const scopes = this.dirtyScopes;
    this.dirtyScopes = 0;
    this.reconciling = true;

    try {
      this.reconcileScopes(host, scopes);
    } catch (error) {
      if (this.host === host) {
        this.markDirty(scopes);
      }
      throw error;
    } finally {
      this.reconciling = false;
    }

    if (this.host === host && this.dirtyScopes !== 0) {
      this.scheduler.requestAfterLayout();
    }
  }

  private reconcileScopes(
    host: AccessibilityHost,
    scopes: AccessibilityDirtyScope,
  ): void {
    if ((scopes & ACCESSIBILITY_DIRTY_ROOT) !== 0) {
      applyGridRootAttributes(host.root, host.readSnapshot());
      if (host.rowgroup !== null) {
        applyRowgroupRoles(host.rowgroup);
      }
    }

    if ((scopes & ACCESSIBILITY_DIRTY_ROW_STRUCTURE) !== 0) {
      host.syncRowStructure();
    } else if ((scopes & ACCESSIBILITY_DIRTY_ROW_POSITION) !== 0) {
      if (!host.syncRowPosition()) {
        this.markDirty(ACCESSIBILITY_DIRTY_ROW_STRUCTURE);
      }
    }

    if ((scopes & ACCESSIBILITY_DIRTY_HEADER_TOPOLOGY) !== 0) {
      host.syncHeaderTopology();
    } else {
      if ((scopes & ACCESSIBILITY_DIRTY_HEADER_BINDING) !== 0) {
        if (!host.syncHeaderBinding()) {
          this.markDirty(ACCESSIBILITY_DIRTY_HEADER_TOPOLOGY);
        }
      }
      if ((scopes & ACCESSIBILITY_DIRTY_HEADER_SORT) !== 0) {
        host.syncHeaderSort();
      }
      if ((scopes & ACCESSIBILITY_DIRTY_HEADER_SELECTION) !== 0) {
        host.syncHeaderSelection();
      }
      if ((scopes & ACCESSIBILITY_DIRTY_HEADER_MENU) !== 0) {
        host.syncHeaderMenu();
      }
    }

    if ((scopes & ACCESSIBILITY_DIRTY_ACTIVE_DESCENDANT) !== 0) {
      host.syncActiveDescendant();
    }
  }

  flushReconcile(): void {
    this.scheduler.flush();
  }
}
