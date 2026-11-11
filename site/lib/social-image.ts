// The link preview: app/opengraph-image.jpg and twitter-image.jpg (file
// convention), the og-wordmark card in docs/marketing/social-preview as JPEG.
// A page that sets its own openGraph/twitter names them, or it loses them.
export const SOCIAL_IMAGE_ALT =
  "vibestats logo and the line Your AI coding history, day by day, and what it would cost at API prices, above an activity heatmap for Claude Code, Codex, Gemini CLI, Goose, Cline and claude.ai";

export const SOCIAL_IMAGE = {
  url: "/opengraph-image.jpg",
  type: "image/jpeg",
  width: 1200,
  height: 630,
  alt: SOCIAL_IMAGE_ALT,
};

export const TWITTER_IMAGE = { ...SOCIAL_IMAGE, url: "/twitter-image.jpg" };
