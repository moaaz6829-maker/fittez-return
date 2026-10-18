import { PrismaClient } from "@prisma/client";
import { DEFAULT_ZONES } from "../src/utils/governorate";

const prisma = new PrismaClient();

async function main() {
  const shopDomain = process.env.SHOPIFY_SHOP;
  const accessToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;

  if (!shopDomain) {
    throw new Error("Set SHOPIFY_SHOP in your environment before seeding.");
  }
  if (!accessToken) {
    throw new Error(
      "Set SHOPIFY_ADMIN_ACCESS_TOKEN in your environment before seeding -- " +
        "get this from Shopify Admin > Settings > Apps and sales channels > " +
        "Develop apps > (your Custom App) > API credentials."
    );
  }

  const store = await prisma.store.upsert({
    where: { shopDomain },
    create: { shopDomain, accessToken },
    update: { accessToken }, // allow re-seeding after rotating the token
  });

  await prisma.settings.upsert({
    where: { storeId: store.id },
    create: { storeId: store.id },
    update: {},
  });

  for (const zoneDef of DEFAULT_ZONES) {
    const zone = await prisma.shippingZone.upsert({
      where: { storeId_name: { storeId: store.id, name: zoneDef.name } },
      create: { storeId: store.id, name: zoneDef.name, exchangeFeeEgp: zoneDef.exchangeFeeEgp },
      update: { exchangeFeeEgp: zoneDef.exchangeFeeEgp },
    });

    for (const gov of zoneDef.governorates) {
      await prisma.shippingRate.upsert({
        where: { governorateName: gov },
        create: { zoneId: zone.id, governorateName: gov },
        update: { zoneId: zone.id },
      });
    }
  }

  console.log("Seed complete. NOTE: review Settings > Governorate Mapping in the");
  console.log("admin UI -- North/South Upper Egypt and Region 6 governorate lists");
  console.log("were not fully enumerated in the original spec and need FITTEZ sign-off.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
