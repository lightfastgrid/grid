import "./loadingSkeleton.css";

const SKELETON_ROWS = 20;
const SKELETON_COLUMNS = 9;

const HEADER_GROUPS = [
  { span: 3 },
  { span: 2 },
  { span: 3 },
  { span: 1 },
] as const;

function SkeletonBar({ wide = false }: { wide?: boolean }) {
  return (
    <span
      className={`grid-loading-skeleton-bar${wide ? " grid-loading-skeleton-bar-wide" : ""}`}
    />
  );
}

/**
 * Full-grid loading skeleton for gridDemo.
 *
 * The overlay host is styled full-bleed via `className` on the loading
 * overlay options.
 */
export function GridLoadingSkeleton() {
  return (
    <div className="grid-loading-skeleton">

      <div className="grid-loading-skeleton-table">
        <div className="grid-loading-skeleton-row grid-loading-skeleton-group-row">
          {HEADER_GROUPS.map((group, index) => (
            <div
              key={index}
              className="grid-loading-skeleton-group"
              style={{ flex: group.span }}
            >
              <SkeletonBar wide />
            </div>
          ))}
        </div>

        <div className="grid-loading-skeleton-row grid-loading-skeleton-header-row">
          {Array.from({ length: SKELETON_COLUMNS }, (_, index) => (
            <div key={index} className="grid-loading-skeleton-cell">
              <SkeletonBar />
            </div>
          ))}
        </div>

        {Array.from({ length: SKELETON_ROWS }, (_, rowIndex) => (
          <div
            key={rowIndex}
            className="grid-loading-skeleton-row grid-loading-skeleton-body-row"
          >
            {Array.from({ length: SKELETON_COLUMNS }, (_, colIndex) => (
              <div key={colIndex} className="grid-loading-skeleton-cell">
                <SkeletonBar wide={colIndex === 0} />
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="grid-loading-skeleton-footer">
        <SkeletonBar wide />
        <div className="grid-loading-skeleton-footer-pages">
          {Array.from({ length: 4 }, (_, index) => (
            <span key={index} className="grid-loading-skeleton-page" />
          ))}
        </div>
        <SkeletonBar />
      </div>
    </div>
  );
}
