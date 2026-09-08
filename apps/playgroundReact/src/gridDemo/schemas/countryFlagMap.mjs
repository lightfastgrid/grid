/**
 * Country name → flag image URL for gridDemo.
 *
 * Performance:
 * - Use pooled `imageText` shells, not per-cell renderers.
 * - Map country value → URL in column `cellShell` (JSON-safe); no per-row URL field.
 * - Only ~20 unique countries in this dataset → ~20 cached HTTP requests total.
 * - Virtualization rebinds pooled `<img>` src in place while scrolling.
 *
 * flagcdn w20 ≈ tiny PNGs suitable for 22px shell thumbnails.
 */
export const COUNTRY_FLAG_SRC_MAP = {
  Argentina: "https://flagcdn.com/w20/ar.png",
  Belgium: "https://flagcdn.com/w20/be.png",
  Brazil: "https://flagcdn.com/w20/br.png",
  Colombia: "https://flagcdn.com/w20/co.png",
  France: "https://flagcdn.com/w20/fr.png",
  Germany: "https://flagcdn.com/w20/de.png",
  Greece: "https://flagcdn.com/w20/gr.png",
  Iceland: "https://flagcdn.com/w20/is.png",
  Ireland: "https://flagcdn.com/w20/ie.png",
  Italy: "https://flagcdn.com/w20/it.png",
  Luxembourg: "https://flagcdn.com/w20/lu.png",
  Malta: "https://flagcdn.com/w20/mt.png",
  Norway: "https://flagcdn.com/w20/no.png",
  Peru: "https://flagcdn.com/w20/pe.png",
  Portugal: "https://flagcdn.com/w20/pt.png",
  Spain: "https://flagcdn.com/w20/es.png",
  Sweden: "https://flagcdn.com/w20/se.png",
  "United Kingdom": "https://flagcdn.com/w20/gb.png",
  Uruguay: "https://flagcdn.com/w20/uy.png",
  Venezuela: "https://flagcdn.com/w20/ve.png",
};
