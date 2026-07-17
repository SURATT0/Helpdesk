import { PrismaClient } from "@prisma/client";
import { SEED_COUNTS, seedDatabase } from "./seed-fn";

const prisma = new PrismaClient();

seedDatabase(prisma)
  .then(() => {
    console.log(
      `Seeded ${SEED_COUNTS.teams} teams, ${SEED_COUNTS.users} users, ${SEED_COUNTS.categories} categories, ${SEED_COUNTS.tickets} tickets.`,
    );
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
