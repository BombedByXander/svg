import { AwsClient } from "./aws4fetch.mjs";

const DATA_API = "https://ep-round-sun-bcjqrx2v.apirest.c-16.us-east-1.aws.neon.tech/neondb/rest/v1";
const STORAGE_ENDPOINT = "https://br-holy-thunder-bcl6s6bt.storage.c-16.us-east-1.aws.neon.tech";
const PROFILE_BUCKET = "berri-profile-media";
const MAX_IMAGE = 3 * 1024 * 1024;
const imageTypes = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

async function verifiedUserId(authorization) {
  let subject;
  try {
    const claims = authorization.slice(7).split(".")[1];
    subject = JSON.parse(atob(claims.replace(/-/g, "+").replace(/_/g, "/"))).sub;
  } catch {
    return null;
  }
  if (typeof subject !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(subject)) return null;

  // The subject is only a filter. Neon validates the JWT and lets signed-in
  // users read their own wallet row through its existing RLS policy.
  const wallet = new URL(DATA_API + "/shop_wallets");
  wallet.search = new URLSearchParams({ select: "user_id", user_id: "eq." + subject, limit: "1" });
  const result = await fetch(wallet, { headers: { Authorization: authorization }, redirect: "manual" });
  if (!result.ok) return null;
  const [row] = await result.json();
  return row?.user_id === subject ? subject : null;
}

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
  if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
    return fail("Profile storage is not configured.", 503);
  }

  let userId;
  try {
    userId = await verifiedUserId(authorization);
  } catch {
    return fail("Vaulted could not verify your session. Try again shortly.", 502);
  }
  if (!userId) return fail("Sign in to upload an image.", 401);

  const image = await readImage(request);
  if (!image) return fail("Choose an image up to 3 MB.", 413);
  const url = new URL(AWS_ENDPOINT_URL_S3 || STORAGE_ENDPOINT);
  url.pathname = url.pathname.replace(/\/$/, "") + "/" + encodeURIComponent(S3_BUCKET || PROFILE_BUCKET) + "/" + userId + "/" + crypto.randomUUID() + "." + imageTypes[type];
  const s3 = new AwsClient({
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY,
    service: "s3",
    region: AWS_REGION || "us-east-1",
  });
  let result;
  try {
    result = await s3.fetch(url, {
      method: "PUT",
      headers: { "Content-Type": type, "Cache-Control": "public, max-age=31536000, immutable" },
      body: image,
      redirect: "manual",
    });
  } catch {
    return fail("Vaulted could not reach profile storage. Try again shortly.", 502);
  }
  if (!result.ok) return fail("Neon could not store the image.", 502);
  return Response.json({ url: url.href });
}
