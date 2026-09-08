import { customerReach, isPlatformWide, type AuthUser } from "../../shared/auth";
import { BadRequest, NotFound } from "../../shared/errors";
import { assetRepository, type AssetDto } from "./asset.repository";
import type { AssetStatus } from "./asset.types";
import type { CreateAssetInput, UpdateAssetInput } from "./asset.validators";

export const assetService = {
  list(
    actor: AuthUser,
    opts: { search?: string; status?: AssetStatus; limit?: number },
  ): Promise<AssetDto[]> {
    return assetRepository.findMany(actor, opts);
  },

  async get(id: number, actor: AuthUser): Promise<AssetDto> {
    const asset = await assetRepository.findById(id, actor);
    if (!asset) throw NotFound(`Asset ${id} not found`);
    return asset;
  },

  /**
   * The tenant comes from the actor's REACH, never from the request body alone.
   *
   * Reaching exactly one customer settles it and any `customerId` sent is
   * ignored, so a stale field cannot file an asset elsewhere. Reaching several —
   * or being platform-wide — makes it a real choice, and the value is honoured
   * only if it names a customer the actor actually reaches. Same rule and same
   * shape as `resolveProjectCustomerId`.
   */
  async create(input: CreateAssetInput, actor: AuthUser): Promise<AssetDto> {
    const reach = customerReach(actor);
    const customerId = isPlatformWide(actor)
      ? (input.customerId ?? null)
      : reach.length === 1
        ? reach[0]
        : input.customerId != null && reach.includes(input.customerId)
          ? input.customerId
          : null;
    if (customerId == null) {
      throw BadRequest(
        "customerId is required, and must be a customer you have access to",
      );
    }
    return assetRepository.create(
      {
        assetTag: input.assetTag,
        name: input.name,
        kind: input.kind,
        status: input.status,
        serial: input.serial ?? null,
        location: input.location ?? null,
        ownerId: input.ownerId ?? null,
      },
      actor,
      customerId,
    );
  },

  async update(
    id: number,
    input: UpdateAssetInput,
    actor: AuthUser,
  ): Promise<AssetDto> {
    // `customerId` is never re-assignable — moving an asset between tenants
    // would silently change who can see every ticket it is linked to.
    const { customerId: _ignored, ...data } = input;
    const updated = await assetRepository.update(id, data, actor);
    if (!updated) throw NotFound(`Asset ${id} not found`);
    return updated;
  },

  async retire(id: number, actor: AuthUser): Promise<AssetDto> {
    const retired = await assetRepository.retire(id, actor);
    if (!retired) throw NotFound(`Asset ${id} not found`);
    return retired;
  },
};
