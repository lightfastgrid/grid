/** Shared pools for deterministic gridDemo row enrichment. */

export const STATUSES = ["Active", "Inactive", "Pending", "Suspended"];

export const STATUS_TONE_MAP = {
  Active: "success",
  Inactive: "inactive",
  Pending: "pending",
  Suspended: "danger",
};

export const TIERS = ["Bronze", "Silver", "Gold", "Platinum", "Diamond"];

export const TIER_TONE_MAP = {
  Bronze: "inactive",
  Silver: "neutral",
  Gold: "warning",
  Platinum: "active",
  Diamond: "success",
};

export const DEPARTMENTS = [
  "Engineering",
  "Sales",
  "Marketing",
  "Finance",
  "Operations",
  "Support",
  "Product",
  "Legal",
];

export const JOB_TITLES = [
  "Solutions Architect",
  "Account Executive",
  "Growth Marketing Manager",
  "Finance Director",
  "Operations Manager",
  "Support Specialist",
  "Product Manager",
  "Legal Operations Lead",
];

export const PRODUCTS = [
  "Analytics Cloud",
  "Commerce Pro",
  "Customer Hub",
  "Data Connect",
  "Developer Platform",
  "Finance Cloud",
  "Marketing Studio",
  "Operations Suite",
  "Security Center",
  "Workflow Studio",
];

/** Reserved `.example` domains keep generated contact data realistic but non-routable. */
export const CUSTOMER_EMAIL_DOMAINS = [
  "acme.example",
  "brightpath.example",
  "evergreen.example",
  "northstar.example",
  "redwood.example",
  "summit.example",
];

export const LANGUAGE_TONE_MAP = {
  English: "active",
  Spanish: "success",
  French: "warning",
  Portuguese: "pending",
  German: "danger",
  Greek: "neutral",
  Icelandic: "neutral",
  Italian: "active",
  Maltese: "inactive",
  Norwegian: "success",
  Swedish: "active",
};

/** Region + sample cities per AG dataset country name. */
export const COUNTRY_META = {
  Argentina: { region: "South America", cities: ["Buenos Aires", "Córdoba", "Rosario"] },
  Belgium: { region: "Europe", cities: ["Brussels", "Antwerp", "Ghent"] },
  Brazil: { region: "South America", cities: ["São Paulo", "Rio de Janeiro", "Brasília"] },
  Colombia: { region: "South America", cities: ["Bogotá", "Medellín", "Cali"] },
  France: { region: "Europe", cities: ["Paris", "Lyon", "Marseille"] },
  Germany: { region: "Europe", cities: ["Berlin", "Munich", "Hamburg"] },
  Greece: { region: "Europe", cities: ["Athens", "Thessaloniki", "Patras"] },
  Iceland: { region: "Europe", cities: ["Reykjavik", "Akureyri", "Kópavogur"] },
  Ireland: { region: "Europe", cities: ["Dublin", "Cork", "Galway"] },
  Italy: { region: "Europe", cities: ["Rome", "Milan", "Naples"] },
  Luxembourg: { region: "Europe", cities: ["Luxembourg City", "Esch-sur-Alzette"] },
  Malta: { region: "Europe", cities: ["Valletta", "Sliema", "Birkirkara"] },
  Norway: { region: "Europe", cities: ["Oslo", "Bergen", "Trondheim"] },
  Peru: { region: "South America", cities: ["Lima", "Arequipa", "Trujillo"] },
  Portugal: { region: "Europe", cities: ["Lisbon", "Porto", "Braga"] },
  Spain: { region: "Europe", cities: ["Madrid", "Barcelona", "Valencia"] },
  Sweden: { region: "Europe", cities: ["Stockholm", "Gothenburg", "Malmö"] },
  "United Kingdom": { region: "Europe", cities: ["London", "Manchester", "Edinburgh"] },
  Uruguay: { region: "South America", cities: ["Montevideo", "Salto", "Paysandú"] },
  Venezuela: { region: "South America", cities: ["Caracas", "Maracaibo", "Valencia"] },
};

export const AVATAR_POOL_SIZE = 48;
