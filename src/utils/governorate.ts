import { prisma } from "../lib/db";

/**
 * Section 20: governorate -> zone mapping and zone -> exchange fee must be
 * DB-driven, never hardcoded in application logic. This module only
 * contains the seed data used by prisma/seed.ts; runtime lookups always
 * go through the database so an admin can remap without a code deploy.
 */

export const DEFAULT_ZONES: Array<{ name: string; exchangeFeeEgp: number; governorates: string[] }> = [
  {
    name: "Cairo and Giza",
    exchangeFeeEgp: 117.4,
    governorates: ["Cairo", "Giza"],
  },
  {
    name: "Alexandria and Beheira",
    exchangeFeeEgp: 125.4,
    governorates: ["Alexandria", "Beheira"],
  },
  {
    name: "Delta and Canal",
    exchangeFeeEgp: 132.2,
    governorates: [
      "Dakahlia",
      "Qalyubia",
      "Gharbia",
      "Kafr El Sheikh",
      "Monufia",
      "Sharqia",
      "Damietta",
      "Ismailia",
      "Port Said",
      "Suez",
    ],
  },
  {
    name: "North Upper Egypt",
    exchangeFeeEgp: 151.6,
    governorates: ["Beni Suef", "Fayoum", "Minya"],
  },
  {
    name: "South Upper Egypt",
    exchangeFeeEgp: 169.9,
    governorates: ["Asyut", "Sohag", "Qena", "Luxor", "Aswan"],
  },
  {
    name: "Region 6",
    exchangeFeeEgp: 173.3,
    governorates: ["Red Sea", "New Valley (partial - configurable)"],
  },
  {
    name: "Sinai and New Valley",
    exchangeFeeEgp: 192.7,
    governorates: ["North Sinai", "South Sinai", "New Valley", "Matrouh"],
  },
];

/**
 * NOTE: The North/South Upper Egypt and Region 6 governorate lists above
 * are reasonable defaults but were not explicitly enumerated in the spec
 * (only "Delta and Canal" was). FITTEZ admin must review/confirm this
 * mapping in the Settings > Governorate Mapping screen before go-live;
 * everything is editable there without a code change.
 */

// Shopify spells some Egyptian provinces differently from the zone table
// (e.g. "Al Sharqia", "6th of October"). These aliases map them to the names
// used in Settings > Shipping rates. Matching is case-insensitive.
const GOVERNORATE_ALIASES: Record<string, string> = {
  "6th of october": "Giza",
  "6 october": "Giza",
  "october": "Giza",
  "helwan": "Cairo",
  "al sharqia": "Sharqia",
  "ash sharqia": "Sharqia",
  "sharkia": "Sharqia",
  "al qalyubia": "Qalyubia",
  "qalyoubia": "Qalyubia",
  "al gharbia": "Gharbia",
  "al dakahlia": "Dakahlia",
  "dakahlya": "Dakahlia",
  "al monufia": "Monufia",
  "menofia": "Monufia",
  "al beheira": "Beheira",
  "al behera": "Beheira",
  "al minya": "Minya",
  "al fayoum": "Faiyum",
  "fayoum": "Faiyum",
  "al ismailia": "Ismailia",
  "al suez": "Suez",
  "kafr el sheikh": "Kafr el-Sheikh",
  "kafr elsheikh": "Kafr el-Sheikh",
  "al kafr el-sheikh": "Kafr el-Sheikh",
  "al iskandariyah": "Alexandria",
  "al qahirah": "Cairo",
  "al jizah": "Giza",
  "al bahr al ahmar": "Red Sea",
  "matruh": "Matrouh",
  "al wadi al jadid": "New Valley",
  "shamal sina": "North Sinai",
  "janub sina": "South Sinai",
};

async function findRate(name: string) {
  const exact = await prisma.shippingRate.findUnique({ where: { governorateName: name }, include: { zone: true } });
  if (exact) return exact;
  return prisma.shippingRate.findFirst({
    where: { governorateName: { equals: name, mode: "insensitive" } },
    include: { zone: true },
  });
}

export async function resolveZoneForGovernorate(
  storeId: string,
  governorateName: string
): Promise<{ zoneName: string; exchangeFeeEgp: number } | null> {
  const raw = (governorateName || "").trim();
  if (!raw) return null;
  const key = raw.toLowerCase().replace(/\s+/g, " ");
  const candidates = [raw];
  if (GOVERNORATE_ALIASES[key]) candidates.push(GOVERNORATE_ALIASES[key]);
  const stripped = key.replace(/^(al|el|ash)[ -]/, "");
  if (stripped !== key) candidates.push(stripped);

  for (const name of candidates) {
    const rate = await findRate(name);
    if (rate && rate.zone.storeId === storeId && rate.zone.isActive) {
      return { zoneName: rate.zone.name, exchangeFeeEgp: Number(rate.zone.exchangeFeeEgp) };
    }
  }
  return null;
}
