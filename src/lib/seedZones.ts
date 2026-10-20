import { prisma } from "./db";
import { logger } from "./logger";

/**
 * Exchange-fee zones, based on Bosta's price plan: size L, "Exchange" column,
 * VAT 14% included. Edit fees any time in the app's Settings screen.
 */
const ZONES: Array<{ name: string; fee: number; governorates: string[] }> = [
  { name: "Cairo and Giza", fee: 117.4, governorates: ["Cairo", "Giza"] },
  { name: "Alexandria and Beheira", fee: 125.4, governorates: ["Alexandria", "Beheira"] },
  {
    name: "Delta and Canal",
    fee: 132.2,
    governorates: [
      "Dakahlia", "Qalyubia", "Gharbia", "Kafr el-Sheikh", "Monufia", "Sharqia",
      "Damietta", "Ismailia", "Port Said", "Suez",
    ],
  },
  {
    name: "North Upper Egypt",
    fee: 151.6,
    governorates: ["Faiyum", "Beni Suef", "Minya", "Asyut", "Sohag"],
  },
  {
    name: "South Upper Egypt",
    fee: 169.9,
    governorates: ["Qena", "Luxor", "Aswan", "Red Sea", "Matrouh"],
  },
  { name: "North Coast", fee: 173.3, governorates: [] },
  {
    name: "Sinai and New Valley",
    fee: 192.7,
    governorates: ["North Sinai", "South Sinai", "New Valley"],
  },
];

// Zone names created by the first (placeholder) version of this seed.
const OLD_PLACEHOLDER_ZONES = ["Cairo and Giza", "Alexandria and Delta", "Upper Egypt and Others"];

export async function seedZonesIfEmpty(): Promise<void> {
  try {
    const stores = await prisma.store.findMany({ select: { id: true } });
    for (const store of stores) {
      const existing = await prisma.shippingZone.findMany({ where: { storeId: store.id } });

      // Replace ONLY the untouched placeholder set; never overwrite fees an
      // admin has edited into a different set of zones.
      const isPlaceholder =
        existing.length === 3 &&
        existing.every((z) => OLD_PLACEHOLDER_ZONES.includes(z.name)) &&
        existing.some((z) => z.name === "Alexandria and Delta");

      if (existing.length > 0 && !isPlaceholder) continue;

      if (isPlaceholder) {
        const ids = existing.map((z) => z.id);
        await prisma.shippingRate.deleteMany({ where: { zoneId: { in: ids } } });
        await prisma.shippingZone.deleteMany({ where: { id: { in: ids } } });
      }

      for (const z of ZONES) {
        const zone = await prisma.shippingZone.create({
          data: { storeId: store.id, name: z.name, exchangeFeeEgp: z.fee },
        });
        for (const g of z.governorates) {
          await prisma.shippingRate.upsert({
            where: { governorateName: g },
            update: { zoneId: zone.id },
            create: { zoneId: zone.id, governorateName: g },
          });
        }
      }
      logger.info({ storeId: store.id }, "shipping_zones_seeded");
    }
  } catch (err) {
    logger.error({ err }, "shipping_zones_seed_failed");
  }
}
