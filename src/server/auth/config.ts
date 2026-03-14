import type { OAuthConfig } from "@auth/core/providers";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { AuthError, type DefaultSession, type NextAuthConfig } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import WeChatProvider from "next-auth/providers/wechat";

import { env } from "~/env";
import {
  collectAuthSecrets,
  isSecretRotationErrorMessage,
} from "~/server/auth/secret-utils";
import { db } from "~/server/db";

/**
 * Module augmentation for `next-auth` types. Allows us to add custom properties to the `session`
 * object and keep type safety.
 *
 * @see https://next-auth.js.org/getting-started/typescript#module-augmentation
 */
declare module "next-auth" {
  interface Session extends DefaultSession {
    user: {
      id: string;
      // ...other properties
      // role: UserRole;
    } & DefaultSession["user"];
  }

  // interface User {
  //   // ...other properties
  //   // role: UserRole;
  // }
}

/**
 * Options for NextAuth.js used to configure adapters, providers, callbacks, etc.
 *
 * @see https://next-auth.js.org/configuration/options
 */
const localCredentialsUsername = env.AUTH_CREDENTIALS_USERNAME ?? "admin";
const localCredentialsPassword = env.AUTH_CREDENTIALS_PASSWORD ?? "admin123456";
const localCredentialsEmail = "local-user@stock-screening-boost.local";

const authSecrets = collectAuthSecrets({
  authSecret: env.AUTH_SECRET,
  authSecret1: env.AUTH_SECRET_1,
  authSecret2: env.AUTH_SECRET_2,
  authSecret3: env.AUTH_SECRET_3,
  nextAuthSecret: env.NEXTAUTH_SECRET,
});

let hasLoggedSecretRotationWarning = false;

const getAuthCause = (error: AuthError) => {
  if (
    !error.cause ||
    typeof error.cause !== "object" ||
    !("err" in error.cause)
  ) {
    return null;
  }

  const cause = error.cause.err;

  return cause instanceof Error ? cause : null;
};

const logAuthError = (error: Error) => {
  const name = error instanceof AuthError ? error.type : error.name;
  console.error(`[auth][error] ${name}: ${error.message}`);

  if (error instanceof AuthError) {
    const cause = getAuthCause(error);

    if (cause) {
      console.error("[auth][cause]:", cause.stack ?? cause.message);
    }

    return;
  }

  if (error.stack) {
    console.error(error.stack);
  }
};

const authLogger: NonNullable<NextAuthConfig["logger"]> = {
  error(error) {
    if (error instanceof AuthError) {
      const cause = getAuthCause(error);
      if (
        error.type === "JWTSessionError" &&
        isSecretRotationErrorMessage(cause?.message)
      ) {
        if (!hasLoggedSecretRotationWarning) {
          console.warn(
            "[auth][warn] Detected a stale session cookie encrypted with a previous AUTH_SECRET. Auth.js will clear it automatically. After a Docker deploy, keep AUTH_SECRET stable or copy the previous secret into AUTH_SECRET_1 during rotation.",
          );
          hasLoggedSecretRotationWarning = true;
        }

        return;
      }
    }

    logAuthError(error);
  },
};

type WeChatProfile = {
  unionid?: string;
  openid?: string;
  nickname?: string;
  headimgurl?: string;
};

type QQProfile = {
  ret?: number;
  msg?: string;
  nickname?: string;
  figureurl_qq_1?: string;
  figureurl_qq_2?: string;
  figureurl_1?: string;
  figureurl_2?: string;
  openid: string;
};

const createQQProvider = (options: {
  clientId: string;
  clientSecret: string;
}): OAuthConfig<QQProfile> => ({
  id: "qq",
  name: "QQ",
  type: "oauth",
  checks: ["state"],
  authorization: {
    url: "https://graph.qq.com/oauth2.0/authorize",
    params: {
      scope: "get_user_info",
    },
  },
  token: {
    url: "https://graph.qq.com/oauth2.0/token",
    params: {
      fmt: "json",
    },
  },
  userinfo: {
    url: "https://graph.qq.com/user/get_user_info",
    request: async ({ tokens }: { tokens: { access_token?: string } }) => {
      if (!tokens.access_token) {
        throw new Error("QQ access token is missing.");
      }

      const meUrl = new URL("https://graph.qq.com/oauth2.0/me");
      meUrl.searchParams.set("access_token", tokens.access_token);
      meUrl.searchParams.set("fmt", "json");

      const meData = (await fetch(meUrl).then((response) =>
        response.json(),
      )) as { openid?: string };
      const openid = meData.openid;

      if (!openid) {
        throw new Error("QQ openid is missing.");
      }

      const userInfoUrl = new URL("https://graph.qq.com/user/get_user_info");
      userInfoUrl.searchParams.set("access_token", tokens.access_token);
      userInfoUrl.searchParams.set("oauth_consumer_key", options.clientId);
      userInfoUrl.searchParams.set("openid", openid);

      const userInfo = (await fetch(userInfoUrl).then((response) =>
        response.json(),
      )) as Omit<QQProfile, "openid">;

      return { ...userInfo, openid };
    },
  },
  profile: (profile) => ({
    id: profile.openid,
    name: profile.nickname ?? "QQ 用户",
    email: null,
    image:
      profile.figureurl_qq_2 ??
      profile.figureurl_qq_1 ??
      profile.figureurl_2 ??
      profile.figureurl_1 ??
      null,
  }),
  style: {
    brandColor: "#12B7F5",
  },
  clientId: options.clientId,
  clientSecret: options.clientSecret,
});

const providers: NextAuthConfig["providers"] = [
  CredentialsProvider({
    id: "local-credentials",
    name: "本地账号密码",
    credentials: {
      username: { label: "用户名", type: "text" },
      password: { label: "密码", type: "password" },
    },
    authorize: async (credentials) => {
      const usernameInput = credentials?.username;
      const passwordInput = credentials?.password;

      if (
        typeof usernameInput !== "string" ||
        typeof passwordInput !== "string"
      ) {
        return null;
      }

      if (
        usernameInput.trim() !== localCredentialsUsername ||
        passwordInput !== localCredentialsPassword
      ) {
        return null;
      }

      const user = await db.user.upsert({
        where: { email: localCredentialsEmail },
        create: {
          email: localCredentialsEmail,
          name: localCredentialsUsername,
        },
        update: {
          name: localCredentialsUsername,
        },
      });

      return {
        id: user.id,
        name: user.name,
        email: user.email,
      };
    },
  }),
];

if (env.AUTH_WECHAT_ID && env.AUTH_WECHAT_SECRET) {
  providers.unshift(
    WeChatProvider({
      clientId: env.AUTH_WECHAT_ID,
      clientSecret: env.AUTH_WECHAT_SECRET,
      platformType: "WebsiteApp",
      profile: (profile) => {
        const wechatProfile = profile as WeChatProfile;
        const wechatId = wechatProfile.unionid ?? wechatProfile.openid;

        if (!wechatId) {
          throw new Error("WeChat user id is missing.");
        }

        return {
          id: wechatId,
          name: wechatProfile.nickname ?? "微信用户",
          email: null,
          image: wechatProfile.headimgurl ?? null,
        };
      },
    }),
  );
}

if (env.AUTH_QQ_ID && env.AUTH_QQ_SECRET) {
  providers.unshift(
    createQQProvider({
      clientId: env.AUTH_QQ_ID,
      clientSecret: env.AUTH_QQ_SECRET,
    }),
  );
}

export const authConfig = {
  providers,
  pages: {
    signIn: "/login",
  },
  secret: authSecrets.length > 0 ? authSecrets : undefined,
  logger: authLogger,
  adapter: PrismaAdapter(db),
  session: {
    strategy: "jwt",
  },
  callbacks: {
    jwt: ({ token, user }) => {
      if (user?.id) {
        token.sub = user.id;
      }

      return token;
    },
    session: ({ session, token }) => ({
      ...session,
      user: {
        ...session.user,
        id: token.sub ?? "",
      },
    }),
  },
} satisfies NextAuthConfig;
