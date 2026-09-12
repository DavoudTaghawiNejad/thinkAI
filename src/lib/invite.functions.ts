import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const signUpWithInvite = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        email: z.string().email(),
        password: z.string().min(6),
        key: z.string().length(8),
        displayName: z.string().trim().min(1).max(80),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { redeemInviteAndCreateUser } = await import("./invite.server");
    return redeemInviteAndCreateUser(data);
  });
