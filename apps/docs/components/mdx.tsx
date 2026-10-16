import { Accordion, Accordions } from "fumadocs-ui/components/accordion";
import { Card, Cards } from "fumadocs-ui/components/card";
import { File, Files, Folder } from "fumadocs-ui/components/files";
import { Step, Steps } from "fumadocs-ui/components/steps";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";
import { ApiEndpoint } from "@/components/api-reference";
import { Flow } from "@/components/flow";
import {
  ThemeTokens,
  WidgetOptions,
  WidgetParts,
  WidgetSlots,
} from "@/components/widget-reference";

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    Accordion,
    Accordions,
    ApiEndpoint,
    Card,
    Cards,
    File,
    Files,
    Flow,
    Folder,
    Step,
    Steps,
    Tab,
    Tabs,
    // Rendered from @deskbell/shared, so a page cannot document an option the
    // widget does not have. See components/widget-reference.tsx.
    ThemeTokens,
    WidgetOptions,
    WidgetParts,
    WidgetSlots,
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
