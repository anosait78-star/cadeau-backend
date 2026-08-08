import { Injectable } from "@nestjs/common";
import { AppErrors } from "../../../shared/errors/app-exception";
import type {
  NormalizedOrder,
  NormalizedProduct,
  StorefrontAdapterPort,
} from "../domain/storefront-adapter.port";

/**
 * The only adapter shipped in v1 (D8): the generic JSON contract IS the
 * expected wire shape, so this is an identity mapping. Payload shape is
 * already validated by the ingestion DTOs (class-validator) before either
 * method runs; this class exists so a future per-platform adapter is a drop-in
 * peer behind the same {@link StorefrontAdapterPort}, never a rewrite of the
 * ingestion pipeline.
 */
@Injectable()
export class GenericJsonAdapter implements StorefrontAdapterPort {
  parseOrder(raw: unknown): NormalizedOrder {
    if (typeof raw !== "object" || raw === null) {
      throw AppErrors.badRequest("Invalid order payload.");
    }
    return raw as NormalizedOrder;
  }

  parseProduct(raw: unknown): NormalizedProduct {
    if (typeof raw !== "object" || raw === null) {
      throw AppErrors.badRequest("Invalid product payload.");
    }
    return raw as NormalizedProduct;
  }
}
