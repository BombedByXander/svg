import { AwsClient } from "./aws4fetch.mjs";

const DATA_API = "https://ep-round-sun-bcjqrx2v.apirest.c-16.us-east-1.aws.neon.tech/neondb/rest/v1";
const MAX_IMAGE = 3 * 1024 * 1024;
const imageTypes = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

async function readImage(request) {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_IMAGE) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return size ? new Blob(chunks) : null;
}

export async function handleNeonProfileMedia(request, env) {
  const fail = (error, status) => Response.json({ error }, { status });
  if (request.method !== "POST") return fail("Method not allowed.", 405);

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return fail("Sign in to upload an image.", 401);
  const type = request.headers.get("Content-Type");
  if (!Object.hasOwn(imageTypes, type)) return fail("Choose a PNG, JPG, WEBP, or GIF image.", 415);
  const { AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_ENDPOINT_URL_S3, AWS_REGION, S3_BUCKET } = env;
  if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY || !AWS_ENDPOINT_URL_S3 || !S3_BUCKET) {
    return fail("Profile storage is not configured.", 503);
  }

  const identity = await fetch(DATA_API + "/rpc/vaulted_media_user", {
    method: "POST",
    headers: { Authorization: authorization, "Content-Type": "application/json" },
    body: "{}",
  });
  const userId = identity.ok ? await identity.json() : null;
  if (typeof userId !== "string" || !/^[a-f0-9-]{36}$/i.test(userId)) return fail("Sign in to upload an image.", 401);

  const image = await readImage(request);
  if (!image) return fail("Choose an image up to 3 MB.", 413);
  const url = new URL(AWS_ENDPOINT_URL_S3);
  url.pathname = url.pathname.replace(/\/$/, "") + "/" + encodeURIComponent(S3_BUCKET) + "/" + userId + "/" + crypto.randomUUID() + "." + imageTypes[type];
  const s3 = new AwsClient({
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY,
    service: "s3",
    region: AWS_REGION || "us-east-1",
  });
  const result = await s3.fetch(url, {
    method: "PUT",
    headers: { "Content-Type": type, "Cache-Control": "public, max-age=31536000, immutable" },
    body: image,
  });
  if (!result.ok) return fail("Neon could not store the image.", 502);
  return Response.json({ url: url.href });
}
