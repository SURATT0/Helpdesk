import { prisma } from "../../shared/db";

export type ServiceCatalogEntry = {
  code: string;
  label: string;
  group: string;
  order: number;
  active: boolean;
};

export const serviceCatalogRepository = {
  /**
   * Every row, active or retired — this is the ticket filter's picker data,
   * and a retired code is still a fine thing to filter old tickets by. The
   * intake form never calls this: it builds its own dropdown straight from
   * `config/services.json` (see docs/adding-a-service.md).
   */
  async list(): Promise<ServiceCatalogEntry[]> {
    return prisma.serviceCatalog.findMany({
      select: { code: true, label: true, group: true, order: true, active: true },
      orderBy: [{ order: "asc" }, { label: "asc" }],
    });
  },
};
