import { PrismaClient } from "@prisma/client";
import { SEED_COUNTS, seedDatabase } from "./seed-fn";

const prisma = new PrismaClient();

seedDatabase(prisma)
  .then(() => {
    console.log(
      `Seeded ${SEED_COUNTS.customers} customers, ${SEED_COUNTS.teams} teams, ${SEED_COUNTS.users} users, ${SEED_COUNTS.categories} categories, ${SEED_COUNTS.tickets} tickets (${SEED_COUNTS.closedHistory} of them closed, spread back over several years), ${SEED_COUNTS.assets} assets, ${SEED_COUNTS.kbArticles} KB articles.`,
    );
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
