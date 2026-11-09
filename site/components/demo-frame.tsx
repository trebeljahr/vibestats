"use client";

import { type ReactNode, useEffect, useRef } from "react";

type Props = {
  src: string;
  title: string;
  className?: string;
};

// The demo dashboard runs in a sandboxed iframe without allow-same-origin, so
// it cannot see this page's theme, and prefers-color-scheme inside the frame
// reports the OS, not the site's theme toggle. Fumadocs marks the dark theme
// with class="dark" on <html>; send the frame the theme the site shows, on
// load and on every change. The dashboard accepts only "light", "dark" or
// "system" from its direct parent and stores nothing.
export function DemoFrame({ src, title, className }: Props): ReactNode {
  const ref = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    const root = document.documentElement;
    const send = () => {
      const theme = root.classList.contains("dark") ? "dark" : "light";
      // A sandboxed frame has an opaque origin, so "*" is the only target
      // that reaches it. The message carries the theme name and nothing else.
      frame.contentWindow?.postMessage({ vibestatsTheme: theme }, "*");
    };
    send();
    frame.addEventListener("load", send);
    const observer = new MutationObserver(send);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => {
      frame.removeEventListener("load", send);
      observer.disconnect();
    };
  }, []);

  return (
    <iframe
      ref={ref}
      src={src}
      title={title}
      className={className}
      sandbox="allow-scripts"
    />
  );
}
