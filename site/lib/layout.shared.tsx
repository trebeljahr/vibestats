import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: "vibestats",
    },
    links: [
      {
        text: "Demo",
        url: "/demo",
      },
      {
        text: "Docs",
        url: "/docs",
        active: "nested-url",
      },
      {
        text: "GitHub",
        url: "https://github.com/trebeljahr/vibestats",
        external: true,
      },
    ],
    githubUrl:
      process.env.NEXT_PUBLIC_GITHUB_URL ??
      "https://github.com/trebeljahr/vibestats",
  };
}
