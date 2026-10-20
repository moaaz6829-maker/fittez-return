import { prisma } from "./db";
import { logger } from "./logger";

/**
 * One-time automatic seed of exchange-fee zones + governorates.
 * Runs at startup and ONLY if the store has no shipping zones yet, so it never
 * overwrites fees edited later in the admin dashboard.
 * The fees below are starting values -- change them in the app's Settings.
 */
const ZONES: Array<{ name: string; fee: number; governorates: string[] }> = [
  { name: "Cairo and Giza", fee: 60, governorates: ["Cairo", "Giza"] },
  {
    name: "Alexandria and Delta",
    fee: 70,
    governorates: [
      "Alexandria", "Qalyubia", "Gharbia", "Dakahlia", "Sharqia", "Monufia",
      "Beheira", "Kafr el-Sheikh", "Damietta", "Port Said", "Ismailia", "Suez",
    ],
  },
  {
    name: "Upper Egypt and Others",
    fee: 90,
    governorates: [
      "Faiyum", "Beni Suef", "Minya", "Asyut", "Sohag", "Qena", "Luxor", "Aswan",
      "Red Sea", "Matrouh", "New Valley", "North Sinai", "South Sinai",
    ],
  },
];

export async function seedZonesIfEmpty(): Promise<void> {
  try {
    const stores = await prisma.store.findMany({ select: { id: true } });
    for (const store of stores) {
      const existing = await prisma.shippingZone.count({ where: { storeId: store.id } });
      if (existing > 0) continue;
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
