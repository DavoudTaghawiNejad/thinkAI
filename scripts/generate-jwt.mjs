#!/usr/bin/env node
// Mints a legacy-format Supabase API key: an HS256 JWT with {role, iss, iat, exp},
// signed with the same JWT_SECRET the self-hosted auth/rest services verify against.
import { createHmac } from "node:crypto";

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

const [, , role, secret] = process.argv;
if (!role || !secret) {
  console.error("Usage: generate-jwt.mjs <role> <secret>");
  process.exit(1);
}

const header = { alg: "HS256", typ: "JWT" };
const now = Math.floor(Date.now() / 1000);
const tenYears = 10 * 365 * 24 * 60 * 60;
const payload = { role, iss: "supabase-self-hosted", iat: now, exp: now + tenYears };

const headerB64 = base64url(JSON.stringify(header));
const payloadB64 = base64url(JSON.stringify(payload));
const signature = createHmac("sha256", secret).update(`${headerB64}.${payloadB64}`).digest();
const sigB64 = base64url(signature);

console.log(`${headerB64}.${payloadB64}.${sigB64}`);
