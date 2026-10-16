import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { BellMark } from "@/components/bell-mark";
import { appName, repoHref, siteUrl } from "./shared";

export function baseOptions(): BaseLayoutProps {
  const github = repoHref();

  return {
    nav: {
      title: (
        <>
          <BellMark size={20} className="text-[#2b6b4f]" />
          <span className="font-semibold">{appName}</span>
        </>
      ),
      // Leaving the docs sends you back to the marketing site, which is a
      // different deployment, so this is absolute on purpose.
      url: siteUrl,
    },
    // Omitted entirely before launch: an inert GitHub icon is worse than none.
    ...(github ? { githubUrl: github } : {}),
    links: [
      { text: "Pricing", url: `${siteUrl}/pricing`, external: true },
      { text: "Security", url: `${siteUrl}/security`, external: true },
      { text: "Roadmap", url: `${siteUrl}/#roadmap`, external: true },
    ],
  };
}
