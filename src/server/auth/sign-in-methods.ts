import { env } from "~/platform/env";

export type SignInMethod = {
  id: string;
  name: string;
  description: string;
  type: "oauth" | "credentials";
};

const socialSignInMethods: SignInMethod[] = [];

if (env.AUTH_WECHAT_ID && env.AUTH_WECHAT_SECRET) {
  socialSignInMethods.push({
    id: "wechat",
    name: "微信",
    description: "适合桌面扫码进入研究空间。",
    type: "oauth",
  });
}

if (env.AUTH_QQ_ID && env.AUTH_QQ_SECRET) {
  socialSignInMethods.push({
    id: "qq",
    name: "QQ",
    description: "适合已有 QQ 登录配置的部署环境。",
    type: "oauth",
  });
}

export const signInMethods: SignInMethod[] = [
  ...socialSignInMethods,
  {
    id: "local-credentials",
    name: "本地账号密码",
    description: "适合本地开发、Docker 演示和内部验证。",
    type: "credentials",
  },
];

export const socialSignInEnabled = socialSignInMethods.length > 0;
