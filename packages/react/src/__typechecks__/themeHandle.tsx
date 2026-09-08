/**
 * Type-level proof that `LightFastGridHandle` exposes the theme API
 * and accepts string, object, and undefined inputs.
 */
import type { LightFastGridHandle } from '@lightfastgrid/core';
import { createRef } from 'react';

const gridRef = createRef<LightFastGridHandle>();

// String themes.
gridRef.current?.setTheme("dark");
gridRef.current?.setTheme("light");
gridRef.current?.setTheme("my-custom");

// Object theme.
gridRef.current?.setTheme({ base: "light", accentColor: "#2563eb", radius: "md" });
gridRef.current?.setTheme({ base: "dark" });
gridRef.current?.setTheme({});

// Density option.
gridRef.current?.setTheme({ base: "light", density: "compact" });
gridRef.current?.setTheme({ base: "dark", density: "standard" });
gridRef.current?.setTheme({ base: "light", density: "comfortable" });
gridRef.current?.setTheme({ base: "light", accentColor: "#2563eb", radius: "md", density: "compact" });

// Reset to default.
gridRef.current?.setTheme(undefined);
gridRef.current?.setTheme();

void gridRef;
