import type { ReactLightFastGridProps } from '../types';

const props: ReactLightFastGridProps = {
  rows: [{ id: 'r1' }],
  columns: [{ field: 'id' }],
  execution: {
    thresholds: {
      sort: 10_000,
      filter: 50_000,
    },
  },
};
void props;

const propsPartial: ReactLightFastGridProps = {
  rows: [],
  columns: [],
  execution: {
    thresholds: { sort: 5_000 },
  },
};
void propsPartial;

const propsOmitted: ReactLightFastGridProps = {
  rows: [],
  columns: [],
};
void propsOmitted;
