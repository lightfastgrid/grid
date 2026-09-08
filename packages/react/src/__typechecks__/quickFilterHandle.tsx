import { createRef } from 'react';

import type { ReactLightFastGridHandle } from '../types';

const gridRef = createRef<ReactLightFastGridHandle>();

const commaParser = (text: string) =>
  text.split(',').map((part) => part.trim()).filter(Boolean);

const orMatcher = ({ rowText, queryParts }: { rowText: string; queryParts: string[] }) =>
  queryParts.length === 0 || queryParts.some((part) => rowText.includes(part));

gridRef.current?.setQuickFilterText('english');
gridRef.current?.clearQuickFilter();
gridRef.current?.getQuickFilterText();
gridRef.current?.isQuickFilterPresent();

gridRef.current?.setQuickFilterConfig(false);
gridRef.current?.setQuickFilterConfig(true);
gridRef.current?.setQuickFilterConfig({ enabled: false });
gridRef.current?.setQuickFilterConfig({ enabled: true });
gridRef.current?.setQuickFilterConfig({ enabled: true, includeHiddenColumns: true });
gridRef.current?.setQuickFilterConfig({ enabled: true, includeHiddenColumns: false });
gridRef.current?.setQuickFilterConfig({ enabled: true, cache: 'auto' });
gridRef.current?.setQuickFilterConfig({ enabled: true, cache: true });
gridRef.current?.setQuickFilterConfig({ enabled: true, cache: false });
gridRef.current?.setQuickFilterConfig({ enabled: true, prewarm: 'auto' });
gridRef.current?.setQuickFilterConfig({ enabled: true, prewarm: true });
gridRef.current?.setQuickFilterConfig({ enabled: true, prewarm: false });
gridRef.current?.setQuickFilterConfig({ enabled: true, parser: commaParser });
gridRef.current?.setQuickFilterConfig({ enabled: true, matcher: orMatcher });
gridRef.current?.setQuickFilterConfig(undefined);
gridRef.current?.setQuickFilterConfig({});

void gridRef;
