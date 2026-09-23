import { Logger, type Provider } from "@nestjs/common";
import {
  DisabledFileStorage,
  InMemoryFileStorage,
  S3FileStorage,
  type FileStoragePort,
} from "@cadeau/storage";
import { APP_CONFIG, type InjectedAppConfig } from "../../../shared/config/config.tokens";
import { FILE_STORAGE } from "../domain/file-storage.token";

/**
 * Chooses the object store from configuration (EPIC-17 · M17.3).
 *
 * A configured bucket gives the S3 adapter. With none configured, production
 * and staging get {@link DisabledFileStorage} rather than the in-memory one:
 * "uploads vanish when the process restarts" is a data-loss bug, not a
 * convenience, outside development. This used to throw here instead — which
 * took the *entire* API down at boot for a missing setting on one optional
 * feature. That blast radius was the actual bug: messaging.controller.ts's
 * upload route now fails on its own (`FileStorageError` → 503, mapped in
 * `MessagingService.uploadAttachment`), and every other route is unaffected.
 */
export const fileStorageProvider: Provider = {
  provide: FILE_STORAGE,
  inject: [APP_CONFIG],
  useFactory: (config: InjectedAppConfig): FileStoragePort => {
    const s3 = config.storage.s3;
    if (s3 !== undefined) {
      return new S3FileStorage({
        endpoint: s3.endpoint,
        bucket: s3.bucket,
        region: s3.region,
        accessKeyId: s3.accessKeyId,
        secretAccessKey: s3.secretAccessKey,
        ...(s3.sessionToken === undefined ? {} : { sessionToken: s3.sessionToken }),
        forcePathStyle: s3.forcePathStyle,
      });
    }

    if (config.isProduction || config.isStaging) {
      new Logger("FileStorage").error(
        "Object storage is not configured: set S3_ENDPOINT, S3_BUCKET, S3_REGION, " +
          "S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY. Message attachments are disabled " +
          "until then — text-only messaging still works.",
      );
      return new DisabledFileStorage();
    }

    new Logger("FileStorage").warn(
      "No bucket configured — message attachments are kept in memory and will be " +
        "lost when this process exits.",
    );
    return new InMemoryFileStorage();
  },
};
