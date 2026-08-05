import type { INestApplication } from "@nestjs/common";
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from "@nestjs/swagger";
import { ErrorResponseDto } from "../errors/error-response.dto";

/** Path (under server root) where the Swagger UI is served. */
export const OPENAPI_DOCS_PATH = "v1/docs";
/** Path where the raw OpenAPI JSON document is served. */
export const OPENAPI_JSON_PATH = "v1/openapi.json";

/**
 * Builds the OpenAPI document for the `/v1` API and serves both the Swagger UI
 * (at {@link OPENAPI_DOCS_PATH}) and the raw JSON (at {@link OPENAPI_JSON_PATH}).
 * The unified {@link ErrorResponseDto} is registered so its schema is always
 * present for clients. Returns the generated document (useful for tests/export).
 */
export function setupOpenApi(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle("Cadeau CRM API")
    .setDescription("Cadeau CRM BFF — secure, multi-tenant CRM/OMS. All errors share one envelope.")
    .setVersion("1.0")
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config, {
    extraModels: [ErrorResponseDto],
  });

  SwaggerModule.setup(OPENAPI_DOCS_PATH, app, document, {
    jsonDocumentUrl: OPENAPI_JSON_PATH,
    swaggerOptions: { persistAuthorization: true },
  });

  return document;
}
