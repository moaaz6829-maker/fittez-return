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

export async function resolveZoneForGovernorate(
  storeId: string,
  governorateName: string
): Promise<{ zoneName: string; exchangeFeeEgp: number } | null> {
  const rate = await prisma.shippingRate.findUnique({
    where: { governorateName },
    include: { zone: true },
  });

  if (!rate || rate.zone.storeId !== storeId || !rate.zone.isActive) {
    return null;
  }

  return {
    zoneName: rate.zone.name,
    exchangeFeeEgp: Number(rate.zone.exchangeFeeEgp),
  };
}
