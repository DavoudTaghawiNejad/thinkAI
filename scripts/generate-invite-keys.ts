import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const COUNT = 100;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function randomEightDigitKey(): string {
  const n = Math.floor(Math.random() * 100_000_000);
  return n.toString().padStart(8, "0");
}

const keys = new Set<string>();
while (keys.size < COUNT) {
  keys.add(randomEightDigitKey());
}
const list = [...keys];

writeFileSync(resolve(root, "invite-keys.txt"), list.join("\n") + "\n");

const values = list.map((key) => `('${key}')`).join(",\n  ");
const sql = `INSERT INTO public.invite_keys (key) VALUES\n  ${values};\n`;
writeFileSync(resolve(root, "supabase/seed-invite-keys.sql"), sql);

console.log(
  `Generated ${list.length} invite keys -> invite-keys.txt and supabase/seed-invite-keys.sql`,
);
